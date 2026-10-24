// /api/save (netlify/lib/cloud-save.mjs) against an in-memory Netlify Blobs stand-in: recovery codes,
// create / backup / restore / delete, the size cap, schema checks, and the rate limits that stop a code
// from being guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveHandler, SAVE_LIMITS, SAVE_PREFIX, newCode, normalizeCode, codeKey, CODE_ALPHABET } from '../netlify/lib/cloud-save.mjs';
import { buildBundle, MAX_BUNDLE_BYTES } from '../js/save-transfer.js';
import { normalizeSave } from '../js/progression.js';

class FakeStore {
  constructor() { this.blobs = new Map(); this.v = 0; }
  async getWithMetadata(key) { await null; const e = this.blobs.get(key); return e ? { data: JSON.parse(e.body), etag: e.etag } : null; }
  async setJSON(key, value, opts = {}) {
    await null;
    const cur = this.blobs.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    this.blobs.set(key, { body: JSON.stringify(value), etag: `"v${++this.v}"` });
    return { modified: true };
  }
  async delete(key) { await null; this.blobs.delete(key); }
  async list({ prefix = '' } = {}) { await null; return { blobs: [...this.blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
  keys(prefix = '') { return [...this.blobs.keys()].filter((k) => k.startsWith(prefix)); }
}

function setup(overrides = {}) {
  const store = new FakeStore();
  let clock = Date.parse('2026-10-24T12:00:00Z');
  const handler = createSaveHandler({ store: () => store, now: () => clock, salt: 'test-salt', log: null, ...overrides });
  return { store, handler, advance: (ms) => { clock += ms; } };
}
let ipN = 0;
const freshIp = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
function call(handler, body, { ip = freshIp(), raw, type = 'application/json', method = 'POST' } = {}) {
  const init = { method, headers: { 'content-type': type } };
  if (method !== 'GET') init.body = raw ?? JSON.stringify(body);
  return handler(new Request('https://game.example/api/save', init), { ip });
}
const bundle = (cores = 500) => buildBundle({ save: { ...normalizeSave({}), cores, pilotName: 'NOVA' }, settings: { vexolith_radar: '0' }, version: '0.46.0' });

test('recovery codes: VX-XXXX-XXXX-XXXX from 32 unambiguous symbols (60 bits), typed loosely, stored only as a salted hash', async () => {
  assert.equal(CODE_ALPHABET.length, 32);
  for (const c of '0O1I') assert.ok(!CODE_ALPHABET.includes(c), `no ${c}`);
  const codes = new Set(Array.from({ length: 500 }, () => newCode()));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, /^VX-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeCode(' vx 2345-6789 abcd '), 'VX-2345-6789-ABCD');
  assert.equal(normalizeCode('2345 6789 ABCD'), 'VX-2345-6789-ABCD');
  for (const bad of ['VX-0000-0000-0000', 'VX-2345-6789-ABC', 'VX-2345-6789-ABCDE', '', null, 42]) assert.equal(normalizeCode(bad), null);

  const { handler, store } = setup();
  const res = await call(handler, { op: 'create', bundle: bundle() });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { code } = await res.json();
  assert.match(code, /^VX-/);
  const keys = store.keys(SAVE_PREFIX);
  assert.deepEqual(keys, [codeKey(code, 'test-salt')]);
  assert.ok(!JSON.stringify([...store.blobs]).includes(code.slice(3)), 'the code itself is stored nowhere');
  assert.notEqual(codeKey(code, 'other-salt'), keys[0], 'the hash is salted');
});

test('create -> restore -> backup -> restore round trip, and delete', async () => {
  const { handler, advance } = setup();
  const ip = '203.0.113.5';
  const made = await (await call(handler, { op: 'create', bundle: bundle(500) }, { ip })).json();
  advance(2000);
  const got = await call(handler, { op: 'restore', code: made.code.toLowerCase() }, { ip });
  assert.equal(got.status, 200);
  const g = await got.json();
  assert.equal(g.bundle.save.cores, 500);
  assert.equal(g.updated, made.updated);
  advance(SAVE_LIMITS.BACKUP_COOLDOWN_MS);
  const up = await call(handler, { op: 'backup', code: made.code, base: made.updated, bundle: bundle(900) }, { ip });
  assert.equal(up.status, 200);
  const { updated } = await up.json();
  assert.ok(updated > made.updated);
  advance(2000);
  assert.equal((await (await call(handler, { op: 'restore', code: made.code }, { ip })).json()).bundle.save.cores, 900);
  advance(2000);
  assert.equal((await call(handler, { op: 'delete', code: made.code }, { ip })).status, 200);
  advance(2000);
  assert.equal((await call(handler, { op: 'restore', code: made.code }, { ip })).status, 404);
});

test('a backup over a cloud copy that changed since the device last saw it is refused with that copy (409), unless forced', async () => {
  const { handler, advance } = setup();
  const made = await (await call(handler, { op: 'create', bundle: bundle(500) })).json();
  advance(10_000);
  const other = await (await call(handler, { op: 'backup', code: made.code, base: made.updated, bundle: bundle(700) })).json();
  advance(10_000);
  const stale = await call(handler, { op: 'backup', code: made.code, base: made.updated, bundle: bundle(100) });
  assert.equal(stale.status, 409);
  const s = await stale.json();
  assert.equal(s.updated, other.updated);
  assert.equal(s.bundle.save.cores, 700, 'the device gets the newer copy to merge with');
  advance(10_000);
  assert.equal((await call(handler, { op: 'backup', code: made.code, base: 'whatever', force: true, bundle: bundle(100) })).status, 200);
});

test('saves are schema-checked and size-capped; only POST', async () => {
  const { handler, store } = setup();
  assert.equal((await call(handler, { op: 'create', bundle: { game: 'nope', schema: 1, save: {} } })).status, 422);
  assert.equal((await call(handler, { op: 'create', bundle: { ...bundle(), schema: 7 } })).status, 422);
  assert.equal((await call(handler, { op: 'create' })).status, 422);
  const big = JSON.stringify({ op: 'create', bundle: { ...bundle(), save: { junk: 'x'.repeat(MAX_BUNDLE_BYTES + 2000) } } });
  assert.equal((await call(handler, null, { raw: big })).status, 413);
  assert.equal((await call(handler, null, { raw: '{bad' })).status, 400);
  assert.equal((await call(handler, { op: 'create', bundle: bundle() }, { type: 'text/plain' })).status, 415);
  assert.equal((await call(handler, { op: 'steal' })).status, 400);
  assert.equal((await call(handler, null, { method: 'GET' })).status, 405);
  assert.equal(store.keys(SAVE_PREFIX).length, 0);
  // A save is cleaned like a local one: ranks capped, unknown fields gone.
  const ok = await (await call(handler, { op: 'create', bundle: { ...bundle(), save: { ...bundle().save, ranks: { damage: 1e9 }, isAdmin: true } } })).json();
  const stored = JSON.parse(store.blobs.get(codeKey(ok.code, 'test-salt')).body);
  assert.equal(stored.bundle.save.isAdmin, undefined);
  assert.ok(stored.bundle.save.ranks.damage <= 40);
});

test('rate limits: one create a minute; a wrong code costs a failure and FAIL_LIMIT failures lock code lookups out', async () => {
  const { handler, advance } = setup();
  const ip = '198.51.100.20';
  assert.equal((await call(handler, { op: 'create', bundle: bundle() }, { ip })).status, 201);
  assert.equal((await call(handler, { op: 'create', bundle: bundle() }, { ip })).status, 429);
  const made = await (await call(handler, { op: 'create', bundle: bundle() })).json();
  // One try a second with a code.
  const guess = () => call(handler, { op: 'restore', code: newCode() }, { ip });
  assert.equal((await guess()).status, 404);
  assert.equal((await guess()).status, 429, 'too fast');
  for (let i = 1; i < SAVE_LIMITS.FAIL_LIMIT; i++) { advance(SAVE_LIMITS.LOOKUP_COOLDOWN_MS); assert.equal((await guess()).status, 404); }
  advance(SAVE_LIMITS.LOOKUP_COOLDOWN_MS);
  const locked = await call(handler, { op: 'restore', code: made.code }, { ip });
  assert.equal(locked.status, 429, 'locked out, even with the right code');
  const body = await locked.json();
  assert.equal(body.locked, true);
  assert.ok(body.retryAfter > 0 && body.retryAfter <= SAVE_LIMITS.FAIL_WINDOW_MS / 1000);
  assert.equal((await call(handler, { op: 'restore', code: made.code })).status, 200, 'other clients are unaffected');
  advance(SAVE_LIMITS.FAIL_WINDOW_MS);
  assert.equal((await call(handler, { op: 'restore', code: made.code }, { ip })).status, 200, 'the lockout ends with its window');
  // Wrong-code backups and deletes count as failures too.
  const ip2 = '198.51.100.21';
  for (let i = 0; i < SAVE_LIMITS.FAIL_LIMIT; i++) { advance(SAVE_LIMITS.LOOKUP_COOLDOWN_MS); await call(handler, { op: i % 2 ? 'delete' : 'backup', code: newCode(), bundle: bundle(), base: null }, { ip: ip2 }); }
  advance(SAVE_LIMITS.LOOKUP_COOLDOWN_MS);
  assert.equal((await call(handler, { op: 'restore', code: made.code }, { ip: ip2 })).status, 429);
});
