// /api/scores handler (netlify/lib/leaderboard.mjs) against an in-memory stand-in for a Netlify Blobs store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScoresHandler, LIMITS, BOARD_KEY, VERSION_BOARD_PREFIX, RATE_PREFIX, CENSORED_NAME, containsProfanity, checkPlausibility,
  validateRun, rankEntries, maxScoreFor, boardKey, checkVersion, checkMode, PURGES, MIGRATION_PREFIX
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
    purges: [], // one-time cleanups have their own test
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
  assert.deepEqual(await body(res), { version: GAME_VERSION, mode: 'normal', current: GAME_VERSION, versions: [], entries: [], total: 0, boardSize: LIMITS.BOARD_SIZE });
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

test('GET and POST return the whole board: up to 100 runs (the GLOBAL list scrolls through them)', async () => {
  assert.equal(LIMITS.PUBLIC_SIZE, LIMITS.BOARD_SIZE);
  assert.equal(LIMITS.BOARD_SIZE, 100);
  const { handler, store } = setup();
  let last;
  for (let i = 1; i <= 104; i++) last = await body(await post(handler, run({ name: `P${i}`, score: 1_000_000 + i * 1000 })));
  assert.equal(store.board().length, 100);
  const pub = await body(await get(handler, 'all'));
  assert.equal(pub.entries.length, 100);
  assert.equal(pub.total, 100);
  assert.equal(pub.entries[0].name, 'P104');
  assert.equal(pub.entries[99].name, 'P5');
  assert.equal(last.entries.length, 100, 'the submit answer carries the whole board too');
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

test('plausibility: a FINAL STAND win may sit on wave 50+ longer than the wave clock, never ahead of it', () => {
  const won = { time: 1600, wave: 50, level: 70, kills: 20_000, multiplier: 60, score: 150_000_000 };
  assert.equal(checkPlausibility(won), null, 'a long stand: wave 50 at 1600 s (the clock alone says 73)');
  assert.equal(checkPlausibility({ ...won, wave: 55 }), null, 'endless after a long stand');
  assert.match(checkPlausibility({ ...won, wave: 80 }), /wave does not match/, 'never ahead of the clock');
  assert.match(checkPlausibility({ ...won, time: 900 }), /wave does not match/, 'wave 50 needs the time to get there');
  assert.match(checkPlausibility({ ...won, wave: 40 }), /wave does not match/, 'only the stand may lag');
  assert.equal(checkPlausibility({ ...won, time: 1100 * 14 / 22, kills: 9000 }, 'blitz'), null, 'BLITZ: its own clock');
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

test('one-time purge: removes only the listed callsigns from every board, once, and keeps later runs', async () => {
  const { store, handler } = setup({ purges: [PURGES[0]] });
  assert.deepEqual(PURGES[0].names, ['MADKING', 'NOX']);
  const entry = (id, name, score) => ({ id, name, score, wave: 10, level: 15, kills: 900, multiplier: 10, time: 200, date: '2026-10-17T00:00:00.000Z', version: GAME_VERSION });
  store.put(BOARD_KEY, { version: 1, entries: [entry('a', 'MADKING', 900), entry('b', 'ACE', 800), entry('c', 'NOX', 700), entry('d', 'NOXIOUS', 600)] });
  store.put(CURRENT_KEY, { version: 1, gameVersion: GAME_VERSION, entries: [entry('a', 'MADKING', 900), entry('b', 'ACE', 800)] });
  store.put(VERSION_BOARD_PREFIX + '0.9.0', { version: 1, entries: [entry('e', 'NOX', 500)] });

  // Two first requests at once: both may run the purge, it is idempotent.
  await Promise.all([get(handler, 'all'), get(handler, GAME_VERSION)]);
  assert.deepEqual(store.board().map((e) => e.name), ['ACE', 'NOXIOUS'], 'exact callsigns only; other pilots stay');
  assert.deepEqual(store.board(CURRENT_KEY).map((e) => e.name), ['ACE']);
  assert.deepEqual(store.board(VERSION_BOARD_PREFIX + '0.9.0'), []);
  // Marker written (its count is per instance: concurrent first requests split the work).
  const marker = JSON.parse(store.blobs.get(MIGRATION_PREFIX + PURGES[0].id).body);
  assert.deepEqual(marker.rule.names, ['MADKING', 'NOX']);

  // After the purge, MADKING can post again and the run stays, even on a fresh function instance.
  const res = await post(handler, run({ name: 'madking' }));
  assert.equal(res.status, 201);
  const fresh = createScoresHandler({ store: () => store, log: null, sleep: async () => {}, purges: [PURGES[0]] });
  await get(fresh, 'all');
  assert.ok(store.board().some((e) => e.name === 'MADKING'), 'the marker stops it from running again');
});

test('one-time purge of a single run: matches its version, wave and score, nothing else', async () => {
  const rule = PURGES.find((p) => p.id === 'purge-dev-87m-v0160-v1');
  assert.ok(rule && !rule.names, 'matches by fingerprint, not callsign');
  const { store, handler } = setup({ purges: [rule] });
  const e = (id, score, wave, version) => ({ id, name: 'PILOT', score, wave, level: 30, kills: 9000, multiplier: 10, time: 900, date: '2026-10-17T00:00:00.000Z', version });
  store.put(BOARD_KEY, { version: 1, entries: [e('x', 87100000, 36, '0.16.0'), e('y', 51000000, 71, '0.18.1'), e('z', 87100000, 37, '0.16.0'), e('w', 60000000, 36, '0.16.0')] });
  store.put(VERSION_BOARD_PREFIX + '0.16.0', { version: 1, entries: [e('x', 87100000, 36, '0.16.0'), e('w', 60000000, 36, '0.16.0')] });
  await get(handler, 'all');
  assert.deepEqual(store.board().map((r) => r.id), ['y', 'z', 'w']);
  assert.deepEqual(store.board(VERSION_BOARD_PREFIX + '0.16.0').map((r) => r.id), ['w']);
});

test('v0.31.0 wipe: every run from before 0.31.0 (and with no version) leaves every board of every mode', async () => {
  const rule = PURGES.find((p) => p.id === 'wipe-before-v0310');
  assert.equal(rule?.beforeVersion, '0.31.0');
  const { store, handler } = setup({ purges: [rule] });
  const e = (id, version) => ({ id, name: 'PILOT', score: 1000, wave: 10, level: 15, kills: 900, multiplier: 10, time: 200, date: '2026-10-17T00:00:00.000Z', version });
  store.put(BOARD_KEY, { version: 1, entries: [e('a', '0.30.0'), e('b', null), e('c', '0.31.0'), e('d', '0.9.0')] });
  store.put(VERSION_BOARD_PREFIX + '0.29.0', { version: 1, entries: [e('x', '0.29.0')] });
  store.put('board-v1-hc', { version: 1, entries: [e('h', '0.28.0')] });
  store.put('board-v1-blitz@0.28.0', { version: 1, entries: [e('z', '0.28.0')] });
  await get(handler, 'all');
  assert.deepEqual(store.board().map((r) => r.id), ['c']);
  assert.deepEqual(store.board(VERSION_BOARD_PREFIX + '0.29.0'), []);
  assert.deepEqual(store.board('board-v1-hc'), []);
  assert.deepEqual(store.board('board-v1-blitz@0.28.0'), []);
});

test('version tabs start at 0.31.0: older versions have no board and their runs are refused', () => {
  assert.ok(BOARD_VERSIONS.length && BOARD_VERSIONS.every((v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n) >= 31000));
  assert.ok(checkVersion('0.30.0').error);
  assert.ok(checkVersion('0.16.0').error);
  assert.equal(checkVersion(GAME_VERSION).version, GAME_VERSION);
});

test('a failing purge never blocks the board', async () => {
  const { store, handler } = setup({ purges: [{ id: 'boom', names: ['ACE'] }] });
  store.put(BOARD_KEY, { version: 1, entries: [] });
  const realList = store.list;
  store.list = async () => { throw new Error('list down'); };
  const res = await get(handler, 'all');
  assert.equal(res.status, 200);
  assert.equal(store.blobs.has(MIGRATION_PREFIX + 'boom'), false, 'no marker, so it retries later');
  store.list = realList;
});

// --- Game modes (js/modes.js): HARDCORE and BLITZ race on their own boards ---------------------------

const getMode = (handler, mode, version = GAME_VERSION) =>
  handler(new Request(`https://game.example/api/scores?version=${encodeURIComponent(version)}${mode === null ? '' : `&mode=${encodeURIComponent(mode)}`}`), { ip: '1.1.1.1' });

test('board keys per mode: NORMAL keeps board-v1 / board-v1@<v>, HARDCORE and BLITZ get their own pair', () => {
  assert.equal(boardKey('all'), 'board-v1');
  assert.equal(boardKey(GAME_VERSION), `board-v1@${GAME_VERSION}`);
  assert.equal(boardKey('all', 'normal'), 'board-v1');
  assert.equal(boardKey('all', 'hardcore'), 'board-v1-hc');
  assert.equal(boardKey(GAME_VERSION, 'hardcore'), `board-v1-hc@${GAME_VERSION}`);
  assert.equal(boardKey('all', 'blitz'), 'board-v1-blitz');
  assert.equal(boardKey(GAME_VERSION, 'blitz'), `board-v1-blitz@${GAME_VERSION}`);
  assert.deepEqual(checkMode(undefined), { mode: 'normal' }, 'older clients send no mode');
  assert.deepEqual(checkMode('hardcore'), { mode: 'hardcore' });
  for (const bad of ['HARDCORE', 'hc', '', 1, {}, [], 'normal ']) assert.ok(checkMode(bad).error, `${JSON.stringify(bad)} is refused`);
});

test('a HARDCORE run lands on the HARDCORE boards only; NORMAL boards are untouched', async () => {
  const { store, handler } = setup();
  const res = await post(handler, run({ name: 'IRONMAN', mode: 'hardcore' }));
  assert.equal(res.status, 201);
  const data = await body(res);
  assert.deepEqual([data.mode, data.rank, data.allTimeRank], ['hardcore', 1, 1]);
  assert.deepEqual(store.board(`board-v1-hc@${GAME_VERSION}`).map((e) => e.name), ['IRONMAN']);
  assert.deepEqual(store.board('board-v1-hc').map((e) => e.name), ['IRONMAN']);
  assert.equal(store.blobs.has(BOARD_KEY), false, 'nothing written to the NORMAL all-time board');
  assert.equal(store.blobs.has(CURRENT_KEY), false, 'nor to the NORMAL version board');

  // A NORMAL run (no mode, like an older client) still goes to the NORMAL boards.
  assert.equal((await post(handler, run({ name: 'CLASSIC' }))).status, 201);
  assert.deepEqual(store.board().map((e) => e.name), ['CLASSIC']);
  assert.deepEqual(store.board('board-v1-hc').map((e) => e.name), ['IRONMAN']);

  // GET: ?mode= picks the boards; without it, NORMAL. Each mode lists its own versions.
  const hc = await body(await getMode(handler, 'hardcore', 'all'));
  assert.deepEqual([hc.mode, hc.entries.map((e) => e.name), hc.versions], ['hardcore', ['IRONMAN'], [GAME_VERSION]]);
  const normal = await body(await get(handler, 'all'));
  assert.deepEqual([normal.mode, normal.entries.map((e) => e.name)], ['normal', ['CLASSIC']]);
  const blitz = await body(await getMode(handler, 'blitz'));
  assert.deepEqual([blitz.entries, blitz.versions], [[], []]);
});

test('mode is validated strictly: a bad POST mode is a 400 that never burns the cooldown, a bad ?mode= a 400', async () => {
  const { store, handler } = setup();
  const ip = freshIp();
  for (const mode of ['HARDCORE', 'god', 7, '']) {
    const res = await post(handler, run({ mode }), { ip });
    assert.equal(res.status, 400, `mode ${JSON.stringify(mode)}`);
    assert.match((await body(res)).error, /mode/);
  }
  assert.equal(store.writes, 0);
  assert.equal((await post(handler, run({ mode: 'blitz', wave: 22 }), { ip })).status, 201, 'the cooldown was not burned');
  assert.equal((await getMode(handler, 'bogus')).status, 400);
  assert.equal((await getMode(handler, '')).status, 200, 'an empty ?mode= is NORMAL');
});

test('plausibility follows the mode\'s wave clock: BLITZ waves are shorter', async () => {
  // 300 s of BLITZ (14 s waves) reaches wave 22; NORMAL (22 s) wave 14.
  const blitzRun = { ...run(), wave: 22 };
  assert.equal(checkPlausibility(blitzRun, 'blitz'), null);
  assert.match(checkPlausibility(blitzRun), /wave does not match/);
  assert.match(checkPlausibility(run(), 'blitz'), /wave does not match/);
  assert.equal(checkPlausibility(run(), 'hardcore'), null, 'HARDCORE keeps NORMAL pacing');
  const { handler } = setup();
  assert.equal((await post(handler, run({ wave: 22, mode: 'blitz' }))).status, 201);
  assert.equal((await post(handler, run({ wave: 22 }))).status, 422);
});

test('purges apply to every mode\'s boards', async () => {
  const { store, handler } = setup({ purges: [{ id: 'purge-test', names: ['NOX'] }] });
  const entry = (id, name) => ({ id, name, score: 900, wave: 10, level: 15, kills: 900, multiplier: 10, time: 200, date: '2026-10-17T00:00:00.000Z', version: GAME_VERSION });
  const keys = [BOARD_KEY, CURRENT_KEY, 'board-v1-hc', `board-v1-hc@${GAME_VERSION}`, 'board-v1-blitz', 'board-v1-blitz@0.9.0'];
  for (const key of keys) store.put(key, { version: 1, entries: [entry('a', 'NOX'), entry('b', 'ACE')] });
  await get(handler, 'all');
  for (const key of keys) assert.deepEqual(store.board(key).map((e) => e.name), ['ACE'], key);
});

test('deploy previews and branch deploys use their own test board; production keeps the live one', async () => {
  const { deployContext, storeNameFor } = await import('../netlify/lib/deploy-context.mjs');
  const { STORE_NAME } = await import('../netlify/lib/leaderboard.mjs');
  assert.equal(deployContext({ deploy: { context: 'production' } }), 'production');
  assert.equal(deployContext({ deploy: { context: 'deploy-preview' } }), 'deploy-preview');
  assert.equal(deployContext({}, (k) => (k === 'CONTEXT' ? 'branch-deploy' : undefined)), 'branch-deploy', 'the CONTEXT env var as a fallback');
  assert.equal(deployContext(undefined), 'production', 'no context at all: production, as before');
  assert.equal(storeNameFor(STORE_NAME, 'production'), 'leaderboard', 'the live store name never changes');
  for (const ctx of ['deploy-preview', 'branch-deploy', 'dev']) assert.equal(storeNameFor(STORE_NAME, ctx), 'leaderboard-preview');

  // The handler opens the store for each request's own deploy context.
  const stores = new Map();
  const { handler } = setup({ store: (context) => {
    const name = storeNameFor(STORE_NAME, deployContext(context));
    if (!stores.has(name)) stores.set(name, new FakeStore());
    return stores.get(name);
  } });
  const postIn = (ctx, payload) => handler(new Request('https://game.example/api/scores', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  }), { ip: freshIp(), deploy: { context: ctx } });
  assert.equal((await postIn('deploy-preview', run({ name: 'PREVIEW ACE' }))).status, 201);
  assert.equal((await postIn('production', run({ name: 'LIVE ACE' }))).status, 201);
  assert.deepEqual(stores.get('leaderboard').board().map(e => e.name), ['LIVE ACE'], 'the preview run never reaches the live board');
  assert.deepEqual(stores.get('leaderboard-preview').board().map(e => e.name), ['PREVIEW ACE']);
});

test('stats: preview runs go to the stats-preview store', async () => {
  const { createStatsHandler, STATS_STORE } = await import('../netlify/lib/stats.mjs');
  const { deployContext, storeNameFor } = await import('../netlify/lib/deploy-context.mjs');
  const opened = [];
  const handler = createStatsHandler({ store: (context) => { opened.push(storeNameFor(STATS_STORE, deployContext(context))); return { list: async () => ({ blobs: [] }), get: async () => null, getWithMetadata: async () => null, setJSON: async () => ({ modified: true }) }; }, log: null });
  await handler(new Request('https://game.example/api/stats/summary'), { deploy: { context: 'deploy-preview' } });
  await handler(new Request('https://game.example/api/stats/summary'), { deploy: { context: 'production' } });
  assert.deepEqual(opened, ['stats-preview', 'stats']);
});

test('plausibility refit: long 50-wave + ENDLESS runs with the progress bonuses are admitted', async () => {
  const { waveBonusTotal, VICTORY_BONUS } = await import('../js/score-bonus.js');
  const runs = [
    // 30-minute god-mode expert sim runs (balance-sim --god --skill expert --meta 8 --max-minutes 30), wave 50's
    // FINAL STAND won and continued into ENDLESS. The first sat on wave 50 long enough to trail the clock by
    // 16 waves, which the old wave check rejected.
    { time: 1795, wave: 66, level: 40, kills: 16_851, multiplier: 900, score: 273_386_586 },
    { time: 1793, wave: 72, level: 45, kills: 27_475, multiplier: 900, score: 300_918_701 },
    { time: 1794, wave: 71, level: 50, kills: 29_976, multiplier: 900, score: 305_137_465 },
    // The live board's best (0.34.0, W48), and the W59 campaign win with its new bonuses.
    { time: 1055.2, wave: 48, level: 61, kills: 28_238, multiplier: 219, score: 1_133_414_078 },
    { time: 1277.2, wave: 59, level: 55, kills: 15_853, multiplier: 49.8, score: 107_966_306 + waveBonusTotal(58) + VICTORY_BONUS },
    // A slow win on few kills: the bonuses alone exceed what the kill bound allows for its combat.
    { time: 1300, wave: 50, level: 40, kills: 1200, multiplier: 30, score: 2_000_000 + waveBonusTotal(50) + VICTORY_BONUS },
    // A two-hour ENDLESS marathon at the sim's late kill rate.
    { time: 7200, wave: 200, level: 200, kills: 120_000, multiplier: 5000, score: 1e10 }
  ];
  for (const r of runs) assert.equal(checkPlausibility(r), null, JSON.stringify(r));
  // The bonuses are only allowed where the wave earns them.
  assert.match(checkPlausibility({ time: 700, wave: 32, level: 40, kills: 1200, multiplier: 30, score: 2_000_000 + VICTORY_BONUS }), /score too high/);
  assert.ok(maxScoreFor(1300, 1200, 50) - maxScoreFor(1300, 1200, 49) >= VICTORY_BONUS, 'wave 50+ carries the VICTORY bonus');
});
