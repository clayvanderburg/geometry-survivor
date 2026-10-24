// Cloud save client: keeps a copy of the pilot's progress at /api/save under a recovery code (see
// netlify/lib/cloud-save.mjs). No accounts: the code is the key, made by the server on the first backup and
// shown to the player once (it can be viewed again in the SAVE screen).
//
// Backups are quiet and never block play. A change to the save marks it dirty; the game asks for a backup
// after each run and when the Armory changes (backupSoon), which waits a few seconds (so a burst of changes
// is one backup) and at least MIN_INTERVAL_MS after the last one. A failed backup is retried a few times;
// if it still fails the save stays dirty (remembered on the device) and goes up at the next launch. A
// backup sends `base`, the cloud copy it last saw; when another device changed it meanwhile (409), the two
// are merged (js/save-transfer.js mergeSaves: the best of each, never doubled cores) and sent again.
// Turning cloud save off stops every request (nothing is sent); the code is kept so it can be turned on again.
import { mergeSaves, normalizeCode } from './save-transfer.js';

export const SAVE_ENDPOINT = '/api/save';
export const CLOUD_STATE_KEY = 'vexolith_cloud_v1';
export const CLOUD_ON_KEY = 'vexolith_cloud_on';
export const DEBOUNCE_MS = 4000;
export const MIN_INTERVAL_MS = 15_000;
export const BACKUP_RETRIES = 2;
export const RETRY_BASE_MS = 2000;
const CONFLICT_PAUSE_MS = 1100;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Fingerprint of what a backup carries (not when it was exported), to skip sending an unchanged save.
export function bundleHash(bundle) {
  const text = JSON.stringify([bundle?.save, bundle?.settings]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

export class CloudSave {
  // getBundle(): this device's save as a bundle; applyMerged(save): adopt a merged save in place (a 409).
  constructor({ endpoint = SAVE_ENDPOINT, fetchImpl, storage = defaultStorage(), getBundle, applyMerged, onChange, sleep = defaultSleep, now = () => Date.now(), timeoutMs = 8000 } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl !== undefined ? fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.storage = storage;
    this.getBundle = getBundle;
    this.applyMerged = applyMerged;
    this.onChange = onChange;
    this.sleep = sleep;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.state = this.load();
    this.timer = null;
    this.flushing = null;
    this.lastAttempt = 0;
    this.error = '';
  }

  load() {
    try {
      const s = JSON.parse(this.storage?.getItem(CLOUD_STATE_KEY) || '{}');
      return {
        code: typeof s.code === 'string' ? s.code : null,
        updated: typeof s.updated === 'string' ? s.updated : null,
        lastHash: typeof s.lastHash === 'string' ? s.lastHash : null,
        dirty: !!s.dirty,
        codeShown: s.codeShown !== false
      };
    } catch {
      return { code: null, updated: null, lastHash: null, dirty: false, codeShown: true };
    }
  }

  persist() {
    try { this.storage?.setItem(CLOUD_STATE_KEY, JSON.stringify(this.state)); } catch { /* storage blocked */ }
    this.onChange?.(this.status());
  }

  get on() {
    try { return this.storage?.getItem(CLOUD_ON_KEY) !== '0'; } catch { return true; }
  }

  setOn(on) {
    try { this.storage?.setItem(CLOUD_ON_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
    clearTimeout(this.timer);
    if (on && this.state.dirty) this.backupSoon();
    this.onChange?.(this.status());
  }

  status() {
    return { on: this.on, code: this.state.code, updated: this.state.updated, pending: this.state.dirty, error: this.error, codeShown: this.state.codeShown };
  }

  // The recovery code has been shown to the player (the one-time "write this down" card).
  markCodeShown() {
    if (this.state.codeShown) return;
    this.state.codeShown = true;
    this.persist();
  }

  // The local save changed (cheap; no request). backupSoon() sends it.
  noteChange() {
    if (this.state.dirty) return;
    this.state.dirty = true;
    this.persist();
  }

  // A backup in a few seconds (after a run, an Armory purchase, or at launch when one is still pending).
  backupSoon(delay = DEBOUNCE_MS) {
    if (!this.on || !this.fetchImpl) return;
    clearTimeout(this.timer);
    const wait = Math.max(delay, this.lastAttempt + MIN_INTERVAL_MS - this.now());
    this.timer = setTimeout(() => { this.flush(); }, wait);
  }

  async post(body) {
    if (typeof this.fetchImpl !== 'function') return { ok: false, status: 0, data: null };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal: controller?.signal
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { ok: res.ok && !!data, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  // Sends the save if it changed since the last backup. Resolves { ok, reason }. Calls share one send.
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async flushOnce() {
    if (!this.on) return { ok: false, reason: 'off' };
    if (!this.state.dirty && this.state.code) return { ok: true, reason: 'clean' };
    let result = { ok: false, reason: 'unavailable' };
    for (let attempt = 0; attempt <= BACKUP_RETRIES; attempt++) {
      if (attempt > 0) await this.sleep(RETRY_BASE_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      if (!this.on) return { ok: false, reason: 'off' };
      this.lastAttempt = this.now();
      result = await this.sendOnce();
      if (result.ok || !result.retry) break;
    }
    this.error = result.ok ? '' : result.reason;
    this.onChange?.(this.status());
    return result;
  }

  async sendOnce(conflicts = 0) {
    const bundle = this.getBundle();
    const hash = bundleHash(bundle);
    if (this.state.code && hash === this.state.lastHash) {
      this.state.dirty = false;
      this.persist();
      return { ok: true, reason: 'unchanged' };
    }
    const res = this.state.code
      ? await this.post({ op: 'backup', code: this.state.code, base: this.state.updated, bundle })
      : await this.post({ op: 'create', bundle });
    if (res.ok) {
      if (res.data.code) {
        this.state.code = res.data.code;
        this.state.codeShown = false; // shown once, on the next screen that has room for it
      }
      this.state.updated = res.data.updated || this.state.updated;
      this.state.lastHash = hash;
      this.state.dirty = false;
      this.persist();
      return { ok: true, reason: res.data.code ? 'created' : 'backed-up' };
    }
    if (res.status === 409 && res.data?.bundle?.save && conflicts < 2) {
      // Another device backed up meanwhile: keep the best of both here, then send that.
      this.applyMerged?.(mergeSaves(bundle.save, res.data.bundle.save));
      this.state.updated = res.data.updated;
      await this.sleep(CONFLICT_PAUSE_MS); // the server allows one try with a code a second
      return this.sendOnce(conflicts + 1);
    }
    if (res.status === 404 && this.state.code) {
      // The cloud copy is gone (deleted from another device): the next backup makes a new code.
      this.state.code = null;
      this.state.updated = null;
      this.persist();
      return { ok: false, reason: 'missing', retry: true };
    }
    const retry = res.status === 0 || res.status >= 500 || res.status === 429;
    return { ok: false, reason: res.status === 429 ? 'cooldown' : res.status === 0 ? 'offline' : res.status >= 500 ? 'unavailable' : 'rejected', status: res.status, retry };
  }

  // Looks up a save by code (for RESTORE). Resolves { bundle, updated, code } or { error, status }.
  async fetchByCode(typed) {
    const code = normalizeCode(typed);
    if (!code) return { error: 'That is not a recovery code (VX-XXXX-XXXX-XXXX).', status: 400 };
    const res = await this.post({ op: 'restore', code });
    if (res.ok && res.data?.bundle) return { bundle: res.data.bundle, updated: res.data.updated, code };
    const error = res.status === 404 ? 'No save under that code. Check it and try again.'
      : res.status === 429 ? (res.data?.locked ? 'Too many wrong codes. Try again in a few minutes.' : 'One moment, then try again.')
        : res.status === 400 ? 'That is not a recovery code (VX-XXXX-XXXX-XXXX).'
          : 'The cloud save could not be reached. Try again later.';
    return { error, status: res.status };
  }

  // After a restore: this device now backs up to `code` (its cloud copy at `updated`). `force` sends this
  // device's save over the cloud copy right away (KEEP THIS DEVICE).
  async adopt(code, updated, { force = false } = {}) {
    this.state.code = code;
    this.state.updated = updated;
    this.state.lastHash = null;
    this.state.dirty = true;
    this.state.codeShown = true;
    this.persist();
    if (!force || !this.on) return { ok: true };
    const bundle = this.getBundle();
    const res = await this.post({ op: 'backup', code, base: updated, force: true, bundle });
    if (res.ok) {
      this.state.updated = res.data.updated;
      this.state.lastHash = bundleHash(bundle);
      this.state.dirty = false;
      this.persist();
    }
    return { ok: res.ok };
  }

  // Deletes the cloud copy and forgets the code on this device.
  async deleteCloud() {
    if (!this.state.code) return { ok: true };
    const res = await this.post({ op: 'delete', code: this.state.code });
    if (res.ok || res.status === 404) {
      this.state = { code: null, updated: null, lastHash: null, dirty: true, codeShown: true };
      this.persist();
      return { ok: true };
    }
    return { ok: false };
  }
}
