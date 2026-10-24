// Cloud save behind /api/save (see netlify/functions/save.mjs): a pilot's progress kept under a recovery
// code, with no accounts and nothing personal. Storage-agnostic like ./leaderboard.mjs, so tests drive it
// with an in-memory store.
//
// The recovery code (`VX-XXXX-XXXX-XXXX`, 12 symbols from a 32-letter alphabet without 0/O/1/I: 60 bits) is
// a bearer secret. It is made here with crypto randomness, shown to the player once, and stored only as
// a salted hash: `save/<sha256(salt:code)>` = { schema, updated, bundle }. A bundle is validated and
// cleaned with js/save-transfer.js (the same rules the game uses), capped at MAX_BUNDLE_BYTES, and never
// read by the leaderboard: runs are checked on their own there.
//
//   POST /api/save { op: 'create',  bundle }                -> 201 { code, updated }
//   POST /api/save { op: 'backup',  code, bundle, base }    -> 200 { updated } | 409 { updated, bundle } (the
//                                                              cloud copy changed since `base`: merge, retry)
//   POST /api/save { op: 'restore', code }                  -> 200 { updated, bundle }
//   POST /api/save { op: 'delete',  code }                  -> 200 { deleted: true }
//   An unknown code is a 404. Codes go in the body, never the URL, so they stay out of logs.
// Rate limits (per hashed IP, ./rate-limit.mjs): one create a minute, one backup every few seconds, and
// restore / backup / delete with a code at most one try a second; FAIL_LIMIT wrong codes in a window lock
// that client out of code lookups until the window ends, so codes can't be guessed.
import { createHash, randomInt } from 'node:crypto';
import { validateBundle, MAX_BUNDLE_BYTES } from '../../js/save-transfer.js';
import { clientIp, hashIp } from './leaderboard.mjs';
import { createRateLimiter, writeConditions } from './rate-limit.mjs';

export const SAVE_STORE = 'saves';
export const SAVE_PREFIX = 'save/';
export const SAVE_SCHEMA = 1;
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 symbols: 5 bits each, no 0 O 1 I
export const CODE_GROUPS = 3;
export const CODE_GROUP_LEN = 4;

export const SAVE_LIMITS = Object.freeze({
  MAX_BODY_BYTES: MAX_BUNDLE_BYTES + 1024,
  CREATE_COOLDOWN_MS: 60_000,
  BACKUP_COOLDOWN_MS: 5_000,
  LOOKUP_COOLDOWN_MS: 1_000,   // between two tries with a code (restore, backup, delete)
  FAIL_LIMIT: 5,               // wrong codes per FAIL_WINDOW_MS before code lookups are refused
  FAIL_WINDOW_MS: 15 * 60_000,
  RATE_WINDOW_MS: 10 * 60_000,
  WRITE_ATTEMPTS: 3
});

// A fresh code: VX- then three groups of four.
export function newCode(rand = randomInt) {
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let s = '';
    for (let i = 0; i < CODE_GROUP_LEN; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
    groups.push(s);
  }
  return `VX-${groups.join('-')}`;
}

// A typed code in canonical form (case, spaces and dashes don't matter), or null.
export function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const s = value.toUpperCase().replace(/[\s-]+/g, '').replace(/^VX/, '');
  const len = CODE_GROUPS * CODE_GROUP_LEN;
  if (s.length !== len || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g++) groups.push(s.slice(g * CODE_GROUP_LEN, (g + 1) * CODE_GROUP_LEN));
  return `VX-${groups.join('-')}`;
}

export const codeKey = (code, salt) => SAVE_PREFIX + createHash('sha256').update(`save:${salt}:${code}`).digest('hex');

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
  });
}

export function createSaveHandler({ store, now = () => Date.now(), salt = 'vexolith-survivor', limits = SAVE_LIMITS, newCodeFn = newCode, log = console } = {}) {
  const limiter = (name, cooldownMs) => createRateLimiter({ prefix: `ratelimit/${name}/`, cooldownMs, windowMs: limits.RATE_WINDOW_MS, log });
  const createRate = limiter('create', limits.CREATE_COOLDOWN_MS);
  const backupRate = limiter('backup', limits.BACKUP_COOLDOWN_MS);
  const lookupRate = limiter('lookup', limits.LOOKUP_COOLDOWN_MS);
  const failPrefix = 'ratelimit/fail/';
  const failBucket = (t) => Math.floor(t / limits.FAIL_WINDOW_MS);
  const failKey = (t, ip) => `${failPrefix}${failBucket(t)}/${ip}`;

  async function failures(blobs, t, ip) {
    const cur = await blobs.getWithMetadata(failKey(t, ip), { type: 'json' });
    return Number(cur?.data?.n) || 0;
  }
  async function addFailure(blobs, t, ip) {
    const key = failKey(t, ip);
    for (let i = 0; i < 3; i++) {
      const cur = await blobs.getWithMetadata(key, { type: 'json' });
      const write = await blobs.setJSON(key, { n: (Number(cur?.data?.n) || 0) + 1 }, writeConditions(cur));
      if (write?.modified !== false) return;
    }
  }
  const lockedFor = (t) => Math.ceil(((failBucket(t) + 1) * limits.FAIL_WINDOW_MS - t) / 1000);

  // A code lookup (restore, backup, delete): the lockout, then the per-try cooldown. Resolves a refusal
  // Response or null.
  async function gateLookup(blobs, t, ip) {
    if (await failures(blobs, t, ip) >= limits.FAIL_LIMIT) {
      const retryAfter = lockedFor(t);
      return json(429, { error: 'too many wrong codes: try again later', retryAfter, locked: true }, { 'retry-after': String(retryAfter) });
    }
    const { retryAfter } = await lookupRate.claim(blobs, ip, t);
    if (retryAfter > 0) return json(429, { error: 'slow down', retryAfter }, { 'retry-after': String(retryAfter) });
    return null;
  }

  async function readSave(blobs, code) {
    const key = codeKey(code, salt);
    const cur = await blobs.getWithMetadata(key, { type: 'json' });
    return { key, cur, data: cur?.data && typeof cur.data === 'object' ? cur.data : null };
  }

  async function handle(req, context, blobs) {
    const type = req.headers.get('content-type') || '';
    if (!/^application\/json\b/i.test(type)) return json(415, { error: 'content-type must be application/json' });
    const declared = Number(req.headers.get('content-length'));
    if (declared > limits.MAX_BODY_BYTES) return json(413, { error: 'save too large' });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > limits.MAX_BODY_BYTES) return json(413, { error: 'save too large' });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid request' });
    const op = body.op;
    const t = now();
    const ip = hashIp(clientIp(req, context), salt);
    const sweep = Promise.all([createRate, backupRate, lookupRate].map((r) => r.sweep(blobs, t)));
    if (typeof context?.waitUntil === 'function') context.waitUntil(sweep); else await sweep;

    if (op === 'create') {
      const { bundle, error } = validateBundle(body.bundle);
      if (error) return json(422, { error: `save rejected: ${error}` });
      const { retryAfter } = await createRate.claim(blobs, ip, t);
      if (retryAfter > 0) return json(429, { error: 'slow down', retryAfter }, { 'retry-after': String(retryAfter) });
      const updated = new Date(t).toISOString();
      for (let i = 0; i < limits.WRITE_ATTEMPTS; i++) {
        const code = newCodeFn();
        const write = await blobs.setJSON(codeKey(code, salt), { schema: SAVE_SCHEMA, updated, bundle }, { onlyIfNew: true });
        if (write?.modified !== false) return json(201, { code, updated });
      }
      return json(503, { error: 'try again' }, { 'retry-after': '2' });
    }

    if (op !== 'backup' && op !== 'restore' && op !== 'delete') return json(400, { error: 'op must be create, backup, restore or delete' });
    const code = normalizeCode(body.code);
    if (!code) return json(400, { error: 'that is not a recovery code' });
    let bundle = null;
    if (op === 'backup') {
      const checked = validateBundle(body.bundle);
      if (checked.error) return json(422, { error: `save rejected: ${checked.error}` });
      bundle = checked.bundle;
    }
    const refused = await gateLookup(blobs, t, ip);
    if (refused) return refused;
    const { key, cur, data } = await readSave(blobs, code);
    if (!data) {
      await addFailure(blobs, t, ip);
      return json(404, { error: 'no save under that code' });
    }

    if (op === 'restore') return json(200, { updated: data.updated, bundle: data.bundle });
    if (op === 'delete') {
      await blobs.delete(key);
      return json(200, { deleted: true });
    }
    // backup: only over the copy this device last saw (`base`), unless it says `force` (the player chose
    // to replace the cloud copy with this device's).
    if (!body.force && body.base !== data.updated) return json(409, { error: 'the cloud save changed', updated: data.updated, bundle: data.bundle });
    const { retryAfter } = await backupRate.claim(blobs, ip, t);
    if (retryAfter > 0) return json(429, { error: 'slow down', retryAfter }, { 'retry-after': String(retryAfter) });
    const updated = new Date(Math.max(t, Date.parse(data.updated) + 1 || t)).toISOString();
    const write = await blobs.setJSON(key, { schema: SAVE_SCHEMA, updated, bundle }, writeConditions(cur));
    if (write?.modified === false) {
      const again = await readSave(blobs, code);
      return json(409, { error: 'the cloud save changed', updated: again.data?.updated, bundle: again.data?.bundle });
    }
    return json(200, { updated });
  }

  return async function handler(req, context) {
    try {
      if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, { allow: 'POST' });
      return await handle(req, context, store(context));
    } catch (err) {
      log?.error?.('[save]', err);
      return json(500, { error: 'cloud save unavailable' });
    }
  };
}
