// SAVE screen (💾 on the title): cloud backup with a recovery code, restore from a code, and EXPORT / IMPORT
// SAVE as a copyable code or a .json file (js/save-transfer.js, js/cloud-save.js). Restoring or importing
// always shows what the other save holds first; when this device has progress of its own the player picks
// the cloud/imported save, this device's, or a merge of both. Replacing the save reloads the game.
import { buildBundle, encodeSaveCode, parseSaveText, summarizeSave, mergeSaves, hasMoreProgress, validateBundle } from './save-transfer.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('en-US');

export function summaryLine(sum) {
  return `❖ ${num(sum.cores)} CORES · ARMORY ${num(sum.armoryRanks)} RANKS · WEAPONS ${sum.unlocked}/${sum.totalWeapons} · ${num(sum.runs)} RUNS`;
}

// "2 MIN AGO" style, for the last backup.
export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'JUST NOW';
  if (s < 3600) return `${Math.round(s / 60)} MIN AGO`;
  if (s < 86400) return `${Math.round(s / 3600)} H AGO`;
  return `${Math.round(s / 86400)} DAYS AGO`;
}

// The cloud status line: { text, tone }.
export function cloudStatusText(status, now = Date.now()) {
  if (!status.on) return { text: 'CLOUD SAVE OFF // NOTHING IS SENT', tone: 'dim' };
  if (!status.code) return { text: status.pending ? 'BACKING UP SOON // YOUR RECOVERY CODE IS MADE ON THE FIRST BACKUP' : 'YOUR FIRST RUN CREATES YOUR RECOVERY CODE', tone: 'dim' };
  if (status.pending) return { text: `WAITING TO BACK UP${status.error === 'offline' || status.error === 'unavailable' ? ' // CLOUD UNREACHABLE, WILL RETRY' : ''}`, tone: 'cyan' };
  return { text: `☁ BACKED UP ${agoText(status.updated, now)}`, tone: 'good' };
}

async function copyText(text, fallbackEl) {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      fallbackEl?.select?.();
      return !!globalThis.document?.execCommand?.('copy');
    } catch { return false; }
  }
}

export class SaveUI {
  // getSave(): this device's progression save; getSettings(): its whitelisted settings; apply({ save,
  // settings }): replace this device's save (and settings) and reload; cloud: a CloudSave.
  constructor({ root, getSave, getSettings, apply, cloud, version = '', onClose } = {}) {
    this.root = root;
    this.body = root?.querySelector('#save-body');
    this.getSave = getSave;
    this.getSettings = getSettings;
    this.apply = apply;
    this.cloud = cloud;
    this.version = version;
    this.onClose = onClose;
    this.view = 'home';
    this.pending = null;   // { source: 'cloud' | 'import', bundle, code, updated }
    this.showCode = false;
    this.exportText = '';
    this.message = { text: '', tone: 'dim' };
    this.isOpen = false;
    root?.addEventListener('click', (e) => this.onClick(e));
    root?.addEventListener('change', (e) => this.onInput(e));
    root?.querySelector('#btn-save-close')?.addEventListener('click', () => this.close());
  }

  open() {
    if (!this.root) return false;
    this.view = 'home';
    this.pending = null;
    this.exportText = '';
    this.message = { text: '', tone: 'dim' };
    this.showCode = false;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.render();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  bundle() {
    return buildBundle({ save: this.getSave(), settings: this.getSettings(), version: this.version });
  }

  say(text, tone = 'dim') {
    this.message = { text, tone };
    this.render();
  }

  firstStop() {
    return this.root?.querySelector('[data-save-action]:not([disabled])') || null;
  }

  scrollBy(dy) {
    if (this.body) this.body.scrollTop += dy;
  }

  render() {
    if (!this.body) return;
    const mine = summarizeSave(this.getSave());
    const head = this.root.querySelector('#save-summary');
    if (head) head.textContent = `THIS DEVICE: ${summaryLine(mine)}`;
    this.body.innerHTML = this.view === 'confirm' ? this.confirmHTML(mine) : this.homeHTML();
    if (this.view === 'confirm') this.body.scrollTop = 0;
  }

  homeHTML() {
    const status = this.cloud?.status() || { on: false };
    const line = cloudStatusText(status);
    const code = status.code ? (this.showCode ? status.code : `VX-${status.code.slice(3).replace(/[A-Z0-9]/g, '•')}`) : '';
    const msg = this.message.text ? `<div class="save-msg tone-${this.message.tone}" role="status">${esc(this.message.text)}</div>` : '';
    return `${msg}
      <section class="save-sec">
        <h3 class="save-h">☁ CLOUD SAVE</h3>
        <label class="consent-check"><input type="checkbox" data-save-action="toggle-cloud" ${status.on ? 'checked' : ''} /> <span>Back up my progress to the cloud <i>(no account; no name, email or IP stored)</i></span></label>
        <div class="save-status tone-${line.tone}">${esc(line.text)}</div>
        ${status.code ? `<div class="save-code-row"><span class="save-code-label">RECOVERY CODE</span><code class="save-code" data-save-code>${esc(code)}</code>
          <button class="neon-btn save-btn" data-save-action="show-code">${this.showCode ? 'HIDE' : 'SHOW'}</button>
          <button class="neon-btn save-btn" data-save-action="copy-code">COPY</button></div>
          <p class="save-note">Write this code down. It's the only way to get this progress back on another device, or after clearing this browser's data.</p>` : ''}
        <div class="save-actions">
          <button class="neon-btn save-btn" data-save-action="backup-now" ${status.on ? '' : 'disabled'}>☁ BACK UP NOW</button>
          ${status.code ? '<button class="neon-btn save-btn danger" data-save-action="delete-cloud">DELETE CLOUD COPY</button>' : ''}
        </div>
      </section>
      <section class="save-sec">
        <h3 class="save-h">⇩ RESTORE FROM A RECOVERY CODE</h3>
        <div class="save-actions">
          <input id="save-code-input" class="name-input save-input" type="text" maxlength="24" placeholder="VX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />
          <button class="neon-btn save-btn" data-save-action="restore">RESTORE</button>
        </div>
      </section>
      <section class="save-sec">
        <h3 class="save-h">⇄ EXPORT / IMPORT SAVE</h3>
        <div class="save-actions">
          <button class="neon-btn save-btn" data-save-action="export">EXPORT SAVE</button>
          <button class="neon-btn save-btn" data-save-action="download">⤓ DOWNLOAD .JSON</button>
        </div>
        ${this.exportText ? `<textarea id="save-export-text" class="save-text" readonly rows="3">${esc(this.exportText)}</textarea>
          <div class="save-actions"><button class="neon-btn save-btn" data-save-action="copy-export">COPY SAVE CODE</button></div>` : ''}
        <textarea id="save-import-text" class="save-text" rows="3" placeholder="Paste a save code (VXSAVE1...) or the contents of a save .json file" spellcheck="false"></textarea>
        <div class="save-actions">
          <button class="neon-btn save-btn" data-save-action="import">IMPORT SAVE</button>
          <label class="neon-btn save-btn save-file-btn" data-save-action="pick-file" tabindex="0">LOAD .JSON FILE<input id="save-import-file" type="file" accept=".json,application/json" hidden /></label>
        </div>
      </section>`;
  }

  confirmHTML(mine) {
    const p = this.pending;
    const other = summarizeSave(p.bundle.save);
    const label = p.source === 'cloud' ? 'CLOUD SAVE' : 'IMPORTED SAVE';
    const localHasProgress = mine.runs > 0 || hasMoreProgress(this.getSave(), p.bundle.save);
    const ahead = hasMoreProgress(this.getSave(), p.bundle.save);
    const col = (title, s) => `<div class="save-col"><div class="save-col-h">${esc(title)}</div>
      <div>PILOT <b>${esc(s.pilot)}</b></div><div>❖ <b>${num(s.cores)}</b> CORES (${num(s.wealth)} IN ALL)</div>
      <div>ARMORY <b>${num(s.armoryRanks)}</b> RANKS</div><div>WEAPONS <b>${s.unlocked}/${s.totalWeapons}</b></div>
      <div><b>${num(s.runs)}</b> RUNS · FIELD GUIDE <b>${s.guide}</b></div></div>`;
    const buttons = [
      `<button class="neon-btn save-btn primary" data-save-action="use-other">USE THE ${label}</button>`,
      localHasProgress && p.source === 'cloud' ? '<button class="neon-btn save-btn" data-save-action="keep-device">KEEP THIS DEVICE\'S</button>' : '',
      localHasProgress ? '<button class="neon-btn save-btn" data-save-action="merge">MERGE BOTH</button>' : '',
      '<button class="neon-btn save-btn" data-save-action="cancel">CANCEL</button>'
    ].join('');
    return `<section class="save-sec">
        <h3 class="save-h">${p.source === 'cloud' ? '⇩ RESTORE FROM CLOUD' : '⇄ IMPORT SAVE'}</h3>
        ${ahead ? '<div class="save-msg tone-cyan">This device has progress the other save doesn\'t. Pick which to keep, or merge them.</div>' : ''}
        <div class="save-compare">${col('THIS DEVICE', mine)}${col(label, other)}</div>
        <p class="save-note">MERGE keeps the best of both: every unlock and Field Guide entry, the higher Armory ranks and goal counters, and the larger wealth (cores, counting the ones spent in the Armory). Cores are never added twice.${p.source === 'cloud' ? ' KEEP THIS DEVICE\'S sends this device\'s save over the cloud copy.' : ''} Using another save reloads the game.</p>
        <div class="save-actions">${buttons}</div>
      </section>`;
  }

  // Shows the other save's summary and the choices (a cloud restore or an import).
  confirm(pending) {
    this.pending = pending;
    this.view = 'confirm';
    this.render();
  }

  async onClick(e) {
    const el = e.target.closest?.('[data-save-action]');
    if (!el || !this.root.contains(el) || el.matches('input[type=checkbox]')) return;
    const action = el.dataset.saveAction;
    if (action === 'pick-file') return; // the label opens the file picker itself
    e.preventDefault();
    await this.run(action);
  }

  async onInput(e) {
    const el = e.target;
    if (el?.dataset?.saveAction === 'toggle-cloud') {
      this.cloud?.setOn(el.checked);
      this.render();
    } else if (el?.id === 'save-import-file' && el.files?.[0]) {
      const file = el.files[0];
      if (file.size > 256 * 1024) return this.say('That file is too large to be a save.', 'danger');
      this.importText(await file.text());
    }
  }

  importText(text) {
    const { bundle, error } = parseSaveText(text);
    if (error) return this.say(`Can't import: ${error}.`, 'danger');
    this.confirm({ source: 'import', bundle });
  }

  async run(action) {
    const cloud = this.cloud;
    switch (action) {
      case 'show-code': this.showCode = !this.showCode; return this.render();
      case 'copy-code': {
        const ok = await copyText(cloud.status().code);
        cloud.markCodeShown();
        return this.say(ok ? 'Recovery code copied. Keep it somewhere safe.' : 'Copy failed: select the code and copy it by hand.', ok ? 'good' : 'danger');
      }
      case 'backup-now': {
        cloud.noteChange();
        this.say('Backing up…', 'cyan');
        const r = await cloud.flush();
        return this.say(r.ok ? 'Backed up.' : r.reason === 'cooldown' ? 'Backed up a moment ago. Try again in a few seconds.' : 'The cloud save could not be reached. It will retry later.', r.ok ? 'good' : 'danger');
      }
      case 'delete-cloud': {
        const r = await cloud.deleteCloud();
        if (r.ok) cloud.setOn(false);
        return this.say(r.ok ? 'Cloud copy deleted. Cloud save is off; turn it on to back up under a new code.' : 'Could not delete the cloud copy. Try again later.', r.ok ? 'good' : 'danger');
      }
      case 'restore': {
        const code = this.root.querySelector('#save-code-input')?.value || '';
        if (!code.trim()) return this.say('Type your recovery code (VX-XXXX-XXXX-XXXX).', 'danger');
        this.say('Looking up that code…', 'cyan');
        const r = await cloud.fetchByCode(code);
        if (r.error) return this.say(r.error, 'danger');
        const checked = validateBundle(r.bundle);
        if (checked.error) return this.say(`That cloud save can't be used: ${checked.error}.`, 'danger');
        return this.confirm({ source: 'cloud', bundle: checked.bundle, code: r.code, updated: r.updated });
      }
      case 'export': {
        this.exportText = encodeSaveCode(this.bundle());
        this.render();
        return this.say('Your save code is below. Copy it, or download the .json file.', 'good');
      }
      case 'copy-export': {
        const ok = await copyText(this.exportText, this.root.querySelector('#save-export-text'));
        return this.say(ok ? 'Save code copied.' : 'Copy failed: select the code and copy it by hand.', ok ? 'good' : 'danger');
      }
      case 'download': {
        const doc = this.root.ownerDocument;
        const blob = new Blob([JSON.stringify(this.bundle(), null, 2)], { type: 'application/json' });
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vexolith-save-${new Date().toISOString().slice(0, 10)}.json`;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return this.say('Save downloaded.', 'good');
      }
      case 'import': return this.importText(this.root.querySelector('#save-import-text')?.value || '');
      case 'cancel': this.view = 'home'; this.pending = null; return this.render();
      case 'use-other': {
        const p = this.pending;
        if (p.source === 'cloud') await cloud.adopt(p.code, p.updated);
        return this.apply({ save: p.bundle.save, settings: p.bundle.settings });
      }
      case 'merge': {
        const p = this.pending;
        const merged = mergeSaves(this.getSave(), p.bundle.save);
        if (p.source === 'cloud') await cloud.adopt(p.code, p.updated);
        return this.apply({ save: merged, settings: this.getSettings() });
      }
      case 'keep-device': {
        const p = this.pending;
        const r = await cloud.adopt(p.code, p.updated, { force: true });
        this.view = 'home';
        this.pending = null;
        return this.say(r.ok ? 'Kept this device\'s save. It now backs up under that code.' : 'Kept this device\'s save. It will back up under that code when the cloud is reachable.', 'good');
      }
      default: return undefined;
    }
  }
}

// The one-time "write this down" card for a new recovery code, in `el` (title and game-over screens).
export function renderCodeCallout(el, cloud) {
  if (!el) return;
  const s = cloud?.status();
  const show = !!(s?.on && s.code && !s.codeShown);
  el.classList.toggle('hidden', !show);
  if (!show) return;
  if (el.dataset.code === s.code) return;
  el.dataset.code = s.code;
  el.innerHTML = `<div class="cloud-callout-h">☁ YOUR CLOUD SAVE IS ON</div>
    <div class="save-code-row"><span class="save-code-label">RECOVERY CODE</span><code class="save-code">${esc(s.code)}</code>
    <button class="neon-btn save-btn" data-callout="copy">COPY</button><button class="neon-btn save-btn primary" data-callout="ok">GOT IT</button></div>
    <p class="save-note">Write this down: it's the only way to restore your progress on another device or after clearing this browser's data. You can see it again under 💾 SAVE.</p>`;
  el.onclick = async (e) => {
    const b = e.target.closest?.('[data-callout]');
    if (!b) return;
    if (b.dataset.callout === 'copy') {
      try { await globalThis.navigator.clipboard.writeText(s.code); b.textContent = 'COPIED'; } catch { b.textContent = 'COPY BY HAND'; }
    } else {
      cloud.markCodeShown();
    }
  };
}
