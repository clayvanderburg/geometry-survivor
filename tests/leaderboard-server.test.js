// /api/scores handler (netlify/lib/leaderboard.mjs) against an in-memory stand-in for a Netlify Blobs store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScoresHandler, LIMITS, BOARD_KEY, VERSION_BOARD_PREFIX, RATE_PREFIX, CENSORED_NAME, containsProfanity, checkPlausibility,
  validateRun, rankEntries, maxScoreFor, boardKey, checkVersion
} from '../netlify/lib/leaderboard.mjs';
import { sanitizeCallsign, BOARD_VERSIONS } from '../js/leaderboard-rules.js';
import { GAME_VERSION } from '../js/version.js';

const CURRENT_KEY = VERSION_BOARD_PREFIX + GAME_VERSION;

// Same contract as @netlify/blobs Store for what the handler uses: getWithMetadata, conditional setJSON
// and list({ prefix }).
class FakeStore {
  constructor({ etags = true, list = true } = {}) {
    this.etags = etags; // the local `netlify dev` blob sandbox returns no ETag on reads
    if (!list) this.list = undefined; // a store without list() still serves boards
    this.blobs = new Map();
    this.version = 0;
    this.writes = 0;
    this.beforeSet = null; // async (key, value) hook to simulate a concurrent writer
  }
  async getWithMetadata(key, { type } = {}) {
    assert.equal(type, 'json');
    await null;
    const entry = this.blobs.get(key);
    return entry ? { data: JSON.parse(entry.body), etag: this.etags ? entry.etag : undefined, metadata: {} } : null;
  }
  async setJSON(key, value, opts = {}) {
    if (this.beforeSet) await this.beforeSet(key, value);
    await null;
    const current = this.blobs.get(key);
    if (opts.onlyIfNew && current) return { modified: false };
    if (opts.onlyIfMatch && (!current || current.etag !== opts.onlyIfMatch)) return { modified: false };
    this.put(key, value);
    return { modified: true, etag: this.blobs.get(key).etag };
  }
  async list({ prefix = '' } = {}) {
    await null;
    return { blobs: [...this.blobs].filter(([key]) => key.startsWith(prefix)).map(([key, v]) => ({ key, etag: v.etag })), directories: [] };
  }
  put(key, value) {
    this.writes++;
    this.blobs.set(key, { body: JSON.stringify(value), etag: `"v${++this.version}"` });
  }
  // Defaults to the all-time board (board-v1), which every run lands on.
  board(key = BOARD_KEY) {
    const entry = this.blobs.get(key);
    return entry ? JSON.parse(entry.body).entries : [];
  }
}

function setup(overrides = {}, storeOptions) {
  const store = new FakeStore(storeOptions);
  let clock = Date.parse('2026-10-17T12:00:00Z');
  let ids = 0;
  const handler = createScoresHandler({
    store: () => store,
    now: () => clock,
    sleep: async () => {},
    newId: () => `run-${++ids}`,
    log: null,
    ...overrides
  });
  return { store, handler, advance: (ms) => { clock += ms; } };
}

// A believable 5-minute run from the current game version.
const run = (extra = {}) => ({ name: 'NOVA', score: 2_000_000, wave: 14, level: 20, kills: 1500, multiplier: 40.3, time: 300.5, version: GAME_VERSION, ...extra });

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

function post(handler, body, { ip = freshIp(), contentType = 'application/json', raw } = {}) {
  const req = new Request('https://game.example/api/scores', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: raw !== undefined ? raw : JSON.stringify(body)
  });
  return handler(req, { ip });
}
const get = (handler, version = GAME_VERSION) => handler(new Request('https://game.example/api/scores' + (version === null ? '' : `?version=${encodeURIComponent(version)}`)), { ip: '1.1.1.1' });
const body = (res) => res.json();

test('GET on an empty store returns an empty board, uncached', async () => {
  const { handler } = setup();
  const res = await get(handler);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'same origin: no CORS headers');
  assert.deepEqual(await body(res), { version: GAME_VERSION, current: GAME_VERSION, versions: [], entries: [], total: 0, boardSize: LIMITS.BOARD_SIZE });
});

test('POST stores a run and GET returns it with name, score, wave, level, time, date and version', async () => {
  const { handler } = setup();
  const res = await post(handler, run({ extra: 'ignored' }));
  assert.equal(res.status, 201);
  const out = await body(res);
  assert.equal(out.rank, 1);
  assert.equal(out.onBoard, true);
  assert.equal(out.id, 'run-1');
  assert.equal(out.version, GAME_VERSION);
  assert.equal(out.allTimeRank, 1);
  const [entry] = (await body(await get(handler))).entries;
  assert.deepEqual(entry, {
    id: 'run-1', name: 'NOVA', score: 2_000_000, wave: 14, level: 20, kills: 1500, multiplier: 40.3, time: 300.5,
    date: '2026-10-17T12:00:00.000Z', version: GAME_VERSION
  });
});

test('runs are ranked by score, ties go to the earlier run', async () => {
  const { handler, advance } = setup();
  assert.equal((await body(await post(handler, run({ name: 'MID', score: 500_000 })))).rank, 1);
  assert.equal((await body(await post(handler, run({ name: 'LOW', score: 100_000 })))).rank, 2);
  assert.equal((await body(await post(handler, run({ name: 'TOP', score: 900_000 })))).rank, 1);
  advance(1000);
  assert.equal((await body(await post(handler, run({ name: 'TIE', score: 500_000 })))).rank, 3, 'a tie ranks below the earlier run');
  const names = (await body(await get(handler))).entries.map(e => e.name);
  assert.deepEqual(names, ['TOP', 'MID', 'TIE', 'LOW']);
});

test('board keeps only the top N, GET returns the public top slice, and a low run is reported off-board', async () => {
  const limits = { ...LIMITS, BOARD_SIZE: 5, PUBLIC_SIZE: 3 };
  const { handler, store } = setup({ limits });
  for (let i = 1; i <= 7; i++) await post(handler, run({ name: `P${i}`, score: i * 10_000 }));
  assert.deepEqual(store.board().map(e => e.name), ['P7', 'P6', 'P5', 'P4', 'P3']);
  assert.deepEqual(store.board(CURRENT_KEY).map(e => e.name), ['P7', 'P6', 'P5', 'P4', 'P3']);
  const pub = await body(await get(handler));
  assert.deepEqual(pub.entries.map(e => e.name), ['P7', 'P6', 'P5']);
  assert.equal(pub.total, 5);
  const writes = store.writes;
  const low = await body(await post(handler, run({ name: 'LOW', score: 5_000 })));
  assert.equal(low.accepted, true);
  assert.equal(low.onBoard, false);
  assert.equal(low.rank, null);
  assert.equal(store.writes, writes + 1, 'only the rate-limit blob is written for an off-board run');
  assert.equal(low.allTimeRank, null);
});

test('one callsign holds at most MAX_PER_NAME places', async () => {
  const { handler, store } = setup();
  for (let i = 1; i <= LIMITS.MAX_PER_NAME + 2; i++) await post(handler, run({ name: 'SPAM', score: i * 1000 }));
  const spam = store.board().filter(e => e.name === 'SPAM');
  assert.equal(spam.length, LIMITS.MAX_PER_NAME);
  assert.equal(spam[0].score, (LIMITS.MAX_PER_NAME + 2) * 1000, 'keeps the best ones');
  assert.deepEqual(rankEntries([{ name: 'A', score: 1, id: 'x' }, { name: 'B', score: 2, id: 'y' }]).map(e => e.name), ['B', 'A']);
});

test('malformed submissions get 400/405/413/415 and never touch the store', async () => {
  const { handler, store } = setup();
  const cases = [
    [run({ name: undefined }), 400],
    [run({ name: '' }), 400],
    [run({ name: '   ' }), 400],
    [run({ name: 'A'.repeat(19) }), 400],
    [run({ name: 'ZOË' }), 400],
    [run({ name: '<script>' }), 400],
    [run({ name: '🚀ROCKET' }), 400],
    [run({ score: -5 }), 400],
    [run({ score: 0 }), 400],
    [run({ score: '1000' }), 400],
    [run({ score: 1e14 }), 400],
    [run({ wave: 0 }), 400],
    [run({ level: null }), 400],
    [run({ kills: -1 }), 400],
    [run({ multiplier: 0.5 }), 400],
    [run({ time: 0 }), 400],
    [run({ time: 99_999 }), 400],
    [[run()], 400]
  ];
  for (const [payload, status] of cases) {
    const res = await post(handler, payload);
    assert.equal(res.status, status, JSON.stringify(payload));
    assert.match((await body(res)).error, /\w/);
  }
  assert.equal((await post(handler, null, { raw: '{not json' })).status, 400);
  assert.equal((await post(handler, run(), { contentType: 'text/plain' })).status, 415);
  assert.equal((await post(handler, null, { raw: JSON.stringify(run({ pad: 'x'.repeat(4000) })) })).status, 413);
  const put = await handler(new Request('https://game.example/api/scores', { method: 'PUT', body: '{}' }), {});
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'GET, HEAD, POST');
  const del = await handler(new Request('https://game.example/api/scores', { method: 'DELETE' }), {});
  assert.equal(del.status, 405, 'no unauthenticated delete');
  assert.equal(store.writes, 0);
});

test('fields are normalised: integers floored, multiplier/time to one decimal, name trimmed and upper-cased', async () => {
  const { run: clean, censored } = validateRun(run({ name: '  ace   of  void ', score: 1234.9, wave: 14.2, multiplier: 3.14159, time: 300.56 }));
  assert.equal(censored, false);
  assert.equal(clean.name, 'ACE OF VOID');
  assert.equal(clean.score, 1234);
  assert.equal(clean.wave, 14);
  assert.equal(clean.multiplier, 3.1);
  assert.equal(clean.time, 300.6);
});

test('plausibility: impossible runs are rejected with 422', async () => {
  const { handler, store } = setup();
  const rejects = [
    [run({ wave: 30 }), /wave/],                                   // 300 s is wave 14, not 30
    [run({ time: 30, wave: 2, level: 5, kills: 400, score: 1e9 }), /score too high/], // far beyond what 30 s can earn
    [run({ kills: 50_000 }), /too many kills/],                    // 166 kills a second (the sim peaks near 23)
    [run({ level: 150 }), /level/],                                // way past the XP curve (~5 levels a minute)
    [run({ kills: 3, multiplier: 900, score: 50_000 }), /multiplier/], // the multiplier needs pickups
    [run({ kills: 10, score: 5_000_000 }), /score too high/]       // far beyond the multiplier curve for 10 kills
  ];
  for (const [payload, reason] of rejects) {
    const res = await post(handler, payload);
    assert.equal(res.status, 422, JSON.stringify(payload));
    assert.match((await body(res)).error, /^run rejected: /);
    assert.match(checkPlausibility(validateRun(payload).run), reason);
  }
  assert.equal(store.board().length, 0);
});

test('plausibility: the envelope admits strong real runs', () => {
  // Early/mid shapes from play; the last is the best run of the headless balance sim
  // (expert bot, god mode, maxed meta, 15-minute cap).
  const real = [
    { time: 45, wave: 3, level: 6, kills: 120, multiplier: 9, score: 15_000 },
    { time: 300, wave: 14, level: 22, kills: 4000, multiplier: 160, score: 30_000_000 },
    { time: 893.6, wave: 41, level: 78, kills: 19_797, multiplier: 3000, score: 2_046_679_694 }
  ];
  for (const r of real) assert.equal(checkPlausibility(r), null, JSON.stringify(r));
  assert.ok(maxScoreFor(894, 19_797) > 5 * 2_046_679_694, 'several-fold headroom over the sim best');
});

test('profanity filter: offensive callsigns are censored, innocent ones pass', async () => {
  for (const name of ['FUCK', 'F U C K', 'FUUUCK', 'SH1T', 'ASS', 'A.S.S', 'BIG DICK', 'XXBITCHXX', 'N1GGA', 'NAZI SCUM', 'SEXY ACE']) {
    assert.equal(containsProfanity(name), true, name);
  }
  for (const name of ['COCKPIT ACE', 'GRAPE', 'CLASSIC', 'SPICE', 'NIGHTHAWK', 'ASSASSIN', 'MADKING', 'VOID // HUNTER', 'TITAN', 'DICKENS', 'AS', 'HOEDOWN']) {
    assert.equal(containsProfanity(name), false, name);
  }
  const { handler, store } = setup();
  const res = await body(await post(handler, run({ name: 'SH1T PILOT' })));
  assert.equal(res.censored, true);
  assert.equal(res.name, CENSORED_NAME);
  assert.equal(store.board()[0].name, CENSORED_NAME);
});

test('every callsign the game sends is one the server accepts', () => {
  for (const typed of ['madking', 'José Ñandú', '  void   //  hunter ', 'ace<script>', '🚀🚀', 'x'.repeat(40), 'R2-D2!', "O'NEIL", 'ÅSA', 'ＦＵＬＬ']) {
    const name = sanitizeCallsign(typed) || 'PILOT';
    assert.ok(!validateRun(run({ name })).error, `${typed} -> ${name}`);
  }
});

test('rate limit: one submission per IP per cooldown, keyed by a hashed IP', async () => {
  const { handler, store, advance } = setup();
  assert.equal((await post(handler, run(), { ip: '203.0.113.9' })).status, 201);
  const second = await post(handler, run({ name: 'AGAIN' }), { ip: '203.0.113.9' });
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('retry-after')) > 0);
  assert.equal((await post(handler, run({ name: 'OTHER' }), { ip: '198.51.100.7' })).status, 201, 'other IPs are unaffected');
  advance(LIMITS.COOLDOWN_MS + 1);
  assert.equal((await post(handler, run({ name: 'LATER' }), { ip: '203.0.113.9' })).status, 201);
  const keys = [...store.blobs.keys()].filter(k => k.startsWith(RATE_PREFIX));
  assert.equal(keys.length, 2);
  for (const key of keys) {
    assert.match(key, /^ratelimit\/[0-9a-f]{32}$/);
    assert.ok(!key.includes('203.0.113.9'), 'raw IPs are never stored');
  }
  // Without context.ip the Netlify client-IP header is used.
  const viaHeader = (name) => handler(new Request('https://game.example/api/scores', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '192.0.2.44' }, body: JSON.stringify(run({ name }))
  }), {});
  assert.equal((await viaHeader('H1')).status, 201);
  assert.equal((await viaHeader('H2')).status, 429);
});

test('rate limit: parallel requests from one IP cannot all slip through', async () => {
  const { handler, store } = setup();
  const results = await Promise.all([1, 2, 3, 4].map(i => post(handler, run({ name: `BURST${i}` }), { ip: '203.0.113.50' })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 429, 429, 429]);
  assert.equal(store.board().length, 1);
});

test('rejected submissions (400) do not burn the cooldown; implausible ones (422) do', async () => {
  const { handler } = setup();
  assert.equal((await post(handler, run({ score: -1 }), { ip: '203.0.113.60' })).status, 400);
  assert.equal((await post(handler, run(), { ip: '203.0.113.60' })).status, 201);
  assert.equal((await post(handler, run({ wave: 99 }), { ip: '203.0.113.61' })).status, 422);
  assert.equal((await post(handler, run(), { ip: '203.0.113.61' })).status, 429, 'probing the plausibility bounds is rate limited');
});

test('write conflicts are retried against the fresh board, so concurrent runs both land', async () => {
  const { handler, store } = setup();
  const rival = { id: 'rival', name: 'RIVAL', score: 3_000_000, wave: 14, level: 20, kills: 1500, multiplier: 40, time: 300, date: '2026-10-17T11:59:59.000Z', version: GAME_VERSION };
  const sneaked = new Set();
  store.beforeSet = async (key) => {
    if (key.startsWith(RATE_PREFIX) || sneaked.has(key)) return;
    sneaked.add(key); // another function instance writes between our read and our conditional write
    store.put(key, { version: 1, entries: [rival] });
  };
  const res = await body(await post(handler, run()));
  assert.equal(res.rank, 2);
  assert.equal(res.allTimeRank, 2);
  assert.deepEqual([...sneaked].sort(), [BOARD_KEY, CURRENT_KEY], 'both boards hit a conflict and were retried');
  assert.deepEqual(store.board(CURRENT_KEY).map(e => e.name), ['RIVAL', 'NOVA']);
  assert.deepEqual(store.board().map(e => e.name), ['RIVAL', 'NOVA']);
});

test('many simultaneous submissions from different players all end up on the board', async () => {
  // Real (jittered) backoff here: lockstep retries are exactly what the jitter is for.
  const { handler, store } = setup({ sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)) });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(handler, run({ name: `PILOT ${i}`, score: 100_000 + i }))));
  assert.ok(results.every(r => r.status === 201));
  assert.equal(store.board().length, 8);
  assert.deepEqual(store.board().map(e => e.score), Array.from({ length: 8 }, (_, i) => 100_007 - i));
});

test('a board that never stops changing gives up with 503 instead of looping', async () => {
  const { handler, store } = setup();
  store.beforeSet = async (key) => {
    if (key === CURRENT_KEY) store.put(CURRENT_KEY, { version: 1, entries: [] });
  };
  const res = await post(handler, run());
  assert.equal(res.status, 503);
  assert.ok(res.headers.get('retry-after'));
  assert.equal(store.board().length, 0, 'nothing reaches the all-time board either');
});

test('a contended all-time board does not fail a run that already made its version board', async () => {
  const { handler, store } = setup();
  store.beforeSet = async (key) => {
    if (key === BOARD_KEY) store.put(BOARD_KEY, { version: 1, entries: [] });
  };
  const res = await post(handler, run());
  assert.equal(res.status, 201);
  const out = await body(res);
  assert.deepEqual([out.rank, out.allTimeRank], [1, null]);
  assert.deepEqual(store.board(CURRENT_KEY).map(e => e.name), ['NOVA']);
});

test('a broken store returns 500 JSON, not an exception', async () => {
  const handler = createScoresHandler({ store: () => ({ getWithMetadata: async () => { throw new Error('blobs down'); } }), log: null });
  const res = await get(handler);
  assert.equal(res.status, 500);
  assert.equal((await body(res)).error, 'leaderboard unavailable');
});

test('a hand-edited or corrupt board blob is tolerated', async () => {
  const { handler, store } = setup();
  store.put(BOARD_KEY, { entries: [null, 'junk', { name: 'OK', score: 5 }, { name: 7, score: 9 }] });
  const res = await body(await get(handler, 'all'));
  assert.deepEqual(res.entries.map(e => e.name), ['OK']);
});

test('a store that returns no ETags (local netlify dev sandbox) still accepts runs, last writer wins', async () => {
  const { handler, store, advance } = setup({}, { etags: false });
  assert.equal((await post(handler, run({ name: 'ONE', score: 10 }), { ip: '203.0.113.70' })).status, 201);
  assert.equal((await post(handler, run({ name: 'TWO', score: 20 }))).status, 201);
  assert.equal((await post(handler, run({ name: 'AGAIN' }), { ip: '203.0.113.70' })).status, 429, 'rate limit still applies');
  advance(LIMITS.COOLDOWN_MS + 1);
  assert.equal((await post(handler, run({ name: 'THREE', score: 30 }), { ip: '203.0.113.70' })).status, 201);
  assert.deepEqual(store.board().map(e => e.name), ['THREE', 'TWO', 'ONE']);
});

// --- Versioned boards ------------------------------------------------------------------------------

test('every run lands on its version board (board-v1@<version>) and on the all-time board', async () => {
  const { handler, store } = setup();
  assert.equal(boardKey(GAME_VERSION), CURRENT_KEY);
  assert.equal(boardKey('all'), BOARD_KEY);
  await post(handler, run({ name: 'ONE', score: 300_000 }));
  await post(handler, run({ name: 'TWO', score: 500_000 }));
  assert.deepEqual(store.board(CURRENT_KEY).map(e => [e.name, e.version]), [['TWO', GAME_VERSION], ['ONE', GAME_VERSION]]);
  assert.deepEqual(store.board().map(e => [e.name, e.version]), [['TWO', GAME_VERSION], ['ONE', GAME_VERSION]]);
  assert.equal(JSON.parse(store.blobs.get(CURRENT_KEY).body).gameVersion, GAME_VERSION);
  const current = await body(await get(handler));
  assert.equal(current.version, GAME_VERSION);
  assert.deepEqual(current.versions, [GAME_VERSION], 'versions that have runs');
  const all = await body(await get(handler, 'all'));
  assert.equal(all.version, 'all');
  assert.deepEqual(all.entries.map(e => [e.name, e.version]), [['TWO', GAME_VERSION], ['ONE', GAME_VERSION]]);
});

test('a new version starts a fresh board; an older cached client still lands on its own version board', async () => {
  // Simulate the release after this one: the server knows both versions, the old one is still cached somewhere.
  const old = GAME_VERSION;
  const next = '99.0.0';
  const versions = [next, ...BOARD_VERSIONS];
  const { handler, store } = setup({ versions, currentVersion: next });
  assert.equal((await post(handler, run({ name: 'OLD CHAMP', score: 9_000_000, version: old }))).status, 201);
  const fresh = await body(await post(handler, run({ name: 'NEW PILOT', score: 100_000, version: next })));
  assert.equal(fresh.rank, 1, 'old high scores do not crowd the new version');
  assert.equal(fresh.allTimeRank, 2, 'but they still count all-time');
  assert.equal(fresh.version, next);
  const late = await body(await post(handler, run({ name: 'STALE TAB', score: 50_000, version: old })));
  assert.deepEqual([late.version, late.rank], [old, 2], 'an older known version goes to its own board');
  assert.deepEqual(store.board(VERSION_BOARD_PREFIX + next).map(e => e.name), ['NEW PILOT']);
  assert.deepEqual(store.board(VERSION_BOARD_PREFIX + old).map(e => e.name), ['OLD CHAMP', 'STALE TAB']);
  assert.deepEqual(store.board().map(e => e.name), ['OLD CHAMP', 'NEW PILOT', 'STALE TAB']);
  const res = await body(await get(handler, next));
  assert.deepEqual(res.versions, [next, old], 'newest first');
  assert.equal(res.current, next);
  assert.deepEqual((await body(await get(handler, old))).entries.map(e => e.name), ['OLD CHAMP', 'STALE TAB']);
});

test('unknown game versions are rejected with 422 before the cooldown and never stored', async () => {
  const { handler, store } = setup();
  const preVersioning = ['0.1.0', '0.8.1'].filter(v => !BOARD_VERSIONS.includes(v));
  assert.equal(preVersioning.length, 2, 'changelog versions from before versioning have no board');
  for (const version of ['9.9.9', 'banana', '', 7, true, { v: 1 }, ' 0.9.0', ...preVersioning]) {
    const res = await post(handler, run({ version }), { ip: '203.0.113.80' });
    assert.equal(res.status, 422, JSON.stringify(version));
    const out = await body(res);
    assert.match(out.error, /unknown game version/);
    assert.equal(out.current, GAME_VERSION);
  }
  assert.equal(store.writes, 0, 'no board and no rate-limit write');
  assert.equal((await post(handler, run(), { ip: '203.0.113.80' })).status, 201, 'the cooldown was not burned');
  assert.deepEqual(checkVersion(GAME_VERSION), { version: GAME_VERSION });
  assert.deepEqual(checkVersion(undefined), { version: null });
});

test('GET picks the board from ?version=: a version, all, or (no parameter) all-time for older clients', async () => {
  const { handler } = setup();
  await post(handler, run());
  assert.equal((await body(await get(handler, null))).version, 'all');
  assert.equal((await body(await get(handler, ''))).version, 'all');
  for (const bad of ['9.9.9', '0.1.0', 'ALL', 'latest']) {
    const res = await get(handler, bad);
    assert.equal(res.status, 400, bad);
    assert.match((await body(res)).error, /unknown version/);
  }
});

test('the legacy board-v1 (runs from before versioning) stays readable as the all-time board', async () => {
  const { handler, store } = setup();
  const legacy = [
    { id: 'old-1', name: 'FIRST', score: 4_000_000, wave: 14, level: 20, kills: 1500, multiplier: 40, time: 300, date: '2026-10-17T09:00:00.000Z' },
    { id: 'old-2', name: 'SECOND', score: 1_000_000, wave: 14, level: 20, kills: 1500, multiplier: 40, time: 300, date: '2026-10-17T09:30:00.000Z' }
  ];
  store.put(BOARD_KEY, { version: 1, updated: '2026-10-17T09:30:00.000Z', entries: legacy });
  const before = await body(await get(handler, 'all'));
  assert.deepEqual(before.entries.map(e => [e.name, e.version]), [['FIRST', null], ['SECOND', null]], 'legacy runs report version null (shown as pre-0.9)');
  assert.deepEqual((await body(await get(handler))).entries, [], 'the current version starts empty');

  const res = await body(await post(handler, run({ name: 'NOVA', score: 2_000_000 })));
  assert.deepEqual([res.rank, res.allTimeRank], [1, 2]);
  assert.deepEqual((await body(await get(handler, 'all'))).entries.map(e => [e.name, e.version]),
    [['FIRST', null], ['NOVA', GAME_VERSION], ['SECOND', null]], 'new runs rank against the legacy ones all-time');
  assert.deepEqual((await body(await get(handler))).entries.map(e => e.name), ['NOVA']);
});

test('a client from before versioning (no version field) is still accepted, onto the all-time board only', async () => {
  const { handler, store } = setup();
  const { version, ...legacyRun } = run({ name: 'CACHED' });
  assert.equal(version, GAME_VERSION);
  const res = await post(handler, legacyRun);
  assert.equal(res.status, 201);
  const out = await body(res);
  assert.deepEqual([out.version, out.board, out.rank, out.allTimeRank], [null, 'all', 1, 1]);
  assert.deepEqual(store.board().map(e => [e.name, e.version ?? null]), [['CACHED', null]]);
  assert.equal(store.blobs.has(CURRENT_KEY), false);
  assert.deepEqual((await body(await get(handler))).versions, []);
});

test('a store without list() (or a failing one) still serves boards, just without the version list', async () => {
  const { handler } = setup({}, { list: false });
  await post(handler, run());
  const res = await body(await get(handler));
  assert.deepEqual([res.versions, res.entries.length], [[], 1]);
  const broken = setup();
  broken.store.list = async () => { throw new Error('list down'); };
  await post(broken.handler, run());
  assert.deepEqual((await body(await get(broken.handler))).versions, []);
});
