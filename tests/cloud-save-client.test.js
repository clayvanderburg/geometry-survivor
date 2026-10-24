// Cloud save client (js/cloud-save.js) wired straight to the /api/save handler with an in-memory store:
// first backup makes the code, unchanged saves send nothing, the off switch sends nothing, two devices
// merge instead of overwriting, failures stay pending for the next launch, and restore errors read well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSave, CLOUD_STATE_KEY, CLOUD_ON_KEY } from '../js/cloud-save.js';
import { createSaveHandler, newCode } from '../netlify/lib/cloud-save.mjs';
import { buildBundle, saveWealth } from '../js/save-transfer.js';
import { normalizeSave } from '../js/progression.js';
import { requestPersistentStorage, PERSIST_ASKED_KEY } from '../js/save-setup.js';
import { cloudStatusText } from '../js/save-ui.js';

class FakeStore {
  constructor() { this.blobs = new Map(); this.v = 0; }
  async getWithMetadata(key) { const e = this.blobs.get(key); return e ? { data: JSON.parse(e.body), etag: e.etag } : null; }
  async setJSON(key, value, opts = {}) {
    const cur = this.blobs.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    this.blobs.set(key, { body: JSON.stringify(value), etag: `"v${++this.v}"` });
    return { modified: true };
  }
  async delete(key) { this.blobs.delete(key); }
  async list({ prefix = '' } = {}) { return { blobs: [...this.blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

// A world: one server, a clock, and devices (each its own storage and save).
function world() {
  const store = new FakeStore();
  let clock = Date.parse('2026-10-24T12:00:00Z');
  const handler = createSaveHandler({ store: () => store, now: () => clock, salt: 's', log: null });
  let requests = 0;
  let down = false;
  const device = (ip, cores = 100) => {
    const storage = memory();
    const dev = { save: { ...normalizeSave({}), cores }, storage };
    const fetchImpl = async (url, init) => {
      requests++;
      if (down) throw new TypeError('offline');
      return handler(new Request('https://game.example' + url, { method: init.method, headers: init.headers, body: init.body }), { ip });
    };
    dev.make = () => new CloudSave({
      fetchImpl, storage, sleep: async (ms) => { clock += ms; }, now: () => clock,
      getBundle: () => buildBundle({ save: dev.save, now: clock }),
      applyMerged: (s) => { dev.save = s; }
    });
    dev.cloud = dev.make();
    return dev;
  };
  return { device, advance: (ms) => { clock += ms; }, requests: () => requests, setDown: (v) => { down = v; } };
}

test('the first backup makes the recovery code (shown once); an unchanged save sends nothing; OFF sends nothing', async () => {
  const w = world();
  const a = w.device('203.0.113.1');
  a.cloud.noteChange();
  assert.equal((await a.cloud.flush()).reason, 'created');
  const st = a.cloud.status();
  assert.match(st.code, /^VX-/);
  assert.equal(st.codeShown, false, 'the "write this down" card shows next');
  assert.equal(st.pending, false);
  a.cloud.markCodeShown();
  assert.equal(JSON.parse(a.storage.getItem(CLOUD_STATE_KEY)).codeShown, true);
  const n = w.requests();
  a.cloud.noteChange();
  assert.equal((await a.cloud.flush()).reason, 'unchanged');
  assert.equal(w.requests(), n, 'nothing sent for an unchanged save');
  a.cloud.setOn(false);
  assert.equal(a.storage.getItem(CLOUD_ON_KEY), '0');
  a.save = { ...a.save, cores: 999 };
  a.cloud.noteChange();
  assert.equal((await a.cloud.flush()).reason, 'off');
  assert.equal(w.requests(), n, 'cloud save off: no request at all');
  assert.equal(cloudStatusText(a.cloud.status()).text, 'CLOUD SAVE OFF // NOTHING IS SENT');
});

test('two devices on one code merge instead of overwriting each other, without doubling cores', async () => {
  const w = world();
  const a = w.device('203.0.113.2', 300);
  a.cloud.noteChange();
  await a.cloud.flush();
  const code = a.cloud.status().code;
  // Device B restores the code and adopts it.
  const b = w.device('203.0.113.3', 100);
  w.advance(2000);
  const got = await b.cloud.fetchByCode(code);
  b.save = got.bundle.save;
  await b.cloud.adopt(code, got.updated);
  // B earns cores and backs up; A (still on the old base) earns differently and backs up: 409, merge, resend.
  b.save = { ...b.save, cores: 800 };
  b.cloud.noteChange();
  w.advance(20_000);
  assert.equal((await b.cloud.flush()).ok, true);
  a.save = { ...a.save, unlocks: { stats: { kills: 7000 }, weapons: ['grenades'], fresh: [] } };
  a.cloud.noteChange();
  w.advance(20_000);
  const r = await a.cloud.flush();
  assert.equal(r.ok, true);
  assert.equal(a.save.cores, 800, 'A took B\'s cores in the merge');
  assert.deepEqual(a.save.unlocks.weapons, ['grenades']);
  assert.equal(saveWealth(a.save), 800, 'the larger wealth, not 300 + 800');
  w.advance(2000);
  const cloud = await b.cloud.fetchByCode(code);
  assert.deepEqual(cloud.bundle.save.unlocks.weapons, ['grenades'], 'the merged save is what the cloud holds now');
});

test('a backup that cannot get through stays pending on the device and goes up at the next launch', async () => {
  const w = world();
  const a = w.device('203.0.113.4');
  w.setDown(true);
  a.cloud.noteChange();
  const r = await a.cloud.flush();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'offline');
  assert.equal(a.cloud.status().pending, true);
  assert.match(cloudStatusText(a.cloud.status()).text, /FIRST BACKUP/);
  // Next launch: a fresh client reads the pending flag from storage.
  w.setDown(false);
  const next = a.make();
  assert.equal(next.status().pending, true);
  assert.equal((await next.flush()).reason, 'created');
  assert.equal(next.status().pending, false);
});

test('restore errors read well; the persistent-storage request is made once', async () => {
  const w = world();
  const a = w.device('203.0.113.6');
  assert.match((await a.cloud.fetchByCode(newCode())).error, /No save under that code/);
  w.advance(2000);
  assert.match((await a.cloud.fetchByCode('nonsense')).error, /not a recovery code/);
  let asked = 0;
  const nav = { storage: { persist: async () => { asked++; return true; } } };
  const store = memory();
  assert.equal(requestPersistentStorage(store, nav), true);
  assert.equal(requestPersistentStorage(store, nav), false, 'never asked twice');
  assert.equal(asked, 1);
  assert.equal(store.getItem(PERSIST_ASKED_KEY), '1');
  assert.equal(requestPersistentStorage(memory(), {}), false, 'no Storage API: nothing to ask');
});
