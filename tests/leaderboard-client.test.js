// Browser-side leaderboard client (js/leaderboard.js): offline/timeout fallback, submit states, tabs.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  GlobalLeaderboard, requestJson, buildBoardView, SUBMIT_RETRIES, buildRunPayload, describeSubmit, normalizeTab, syncTabButtons, OFFLINE_NOTES, buildVersionOptions, renderVersionOptions, renderBoardView, normalizeBoardVersion,
  renderModeOptions, buildModeOptions
} = await import('../js/leaderboard.js');
const { Game } = await import('../js/main.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { GAME_VERSION, LEGACY_VERSION_LABEL } = await import('../js/version.js');
const { ALL_TIME } = await import('../js/leaderboard-rules.js');

const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const htmlResponse = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/html' } });
const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

const LOCAL = [
  { id: 'loc-1', name: 'MADKING', score: 9000, multiplier: 3.2, wave: 5, kills: 80, timeStr: '01:40' },
  { id: 'loc-2', name: 'MADKING', score: 4000, multiplier: 1.5, wave: 3, kills: 40, timeStr: '00:58' }
];
const GLOBAL = [
  { id: 'g1', name: 'ACE', score: 500000, wave: 14, level: 20, kills: 1500, multiplier: 40, time: 305.2, date: '2026-10-17T10:00:00.000Z' },
  { id: 'g2', name: 'MADKING', score: 9000, wave: 5, level: 7, kills: 80, multiplier: 3.2, time: 100, date: '2026-10-17T11:00:00.000Z' },
  { id: 'g3', name: 'OTHER', score: 800, wave: 2, level: 3, kills: 10, multiplier: 1.4, time: 30, date: '2026-10-17T11:30:00.000Z' }
];
const RUN = { name: 'MadKing', score: 9000, wave: 5, level: 7, kills: 80, multiplier: 3.21, time: 100.456 };

test('a network error falls back to the local board with an OFFLINE note', async () => {
  const board = new GlobalLeaderboard({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, storage: memoryStorage() });
  await board.refresh();
  assert.equal(board.status, 'offline');
  assert.equal(board.reason, 'offline');
  const view = buildBoardView({ tab: 'global', board, local: LOCAL, pilotName: 'MADKING' });
  assert.equal(view.tab, 'global');
  assert.equal(view.source, 'local');
  assert.equal(view.offline, true);
  assert.equal(view.note, OFFLINE_NOTES.offline);
  assert.match(view.note, /OFFLINE/);
  assert.deepEqual(view.rows.map(r => r.name), ['MADKING', 'MADKING']);
});

test('the local dev server (static 404 page, no function) counts as unavailable, not a crash', async () => {
  const board = new GlobalLeaderboard({ fetchImpl: async () => htmlResponse(404, 'Not found'), storage: memoryStorage() });
  await board.refresh();
  assert.equal(board.status, 'offline');
  assert.equal(board.reason, 'unavailable');
  assert.match(buildBoardView({ tab: 'global', board, local: LOCAL }).note, /OFFLINE/);
  const result = await board.submit(RUN);
  assert.deepEqual([result.ok, result.reason], [false, 'unavailable']);
});

test('a slow server times out instead of hanging the board', async () => {
  let aborted = false;
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  });
  const started = Date.now();
  const res = await requestJson(fetchImpl, '/api/scores', { timeoutMs: 30 });
  assert.deepEqual([res.ok, res.reason], [false, 'timeout']);
  assert.ok(Date.now() - started < 1000);
  assert.equal(aborted, true, 'the request is aborted');

  const board = new GlobalLeaderboard({ fetchImpl: () => new Promise(() => {}), timeoutMs: 20, storage: memoryStorage() });
  await board.refresh();
  assert.equal(board.reason, 'timeout');
  assert.equal(buildBoardView({ tab: 'global', board, local: LOCAL }).note, OFFLINE_NOTES.timeout);
});

test('navigator.onLine === false skips the request entirely', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    let calls = 0;
    const res = await requestJson(async () => { calls++; return jsonResponse(200, {}); }, '/api/scores');
    assert.deepEqual([res.ok, res.reason, calls], [false, 'offline', 0]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('no fetch at all (very old browser) still resolves', async () => {
  const board = new GlobalLeaderboard({ fetchImpl: null, storage: null });
  await board.refresh();
  assert.equal(board.status, 'offline');
  assert.equal((await board.submit(RUN)).ok, false);
});

test('a loaded board shows global rows; the player\'s own runs are marked by callsign and by remembered id', async () => {
  const storage = memoryStorage();
  storage.setItem('vexolith_global_runs_v1', JSON.stringify(['g3']));
  const board = new GlobalLeaderboard({ fetchImpl: async () => jsonResponse(200, { entries: GLOBAL, total: 3, boardSize: 100 }), storage });
  const pending = board.refresh();
  assert.equal(board.status, 'loading');
  const loading = buildBoardView({ tab: 'global', board, local: LOCAL });
  assert.equal(loading.source, 'global');
  assert.match(loading.note, /SYNCING/);
  assert.equal(loading.rows.length, 0);
  await pending;
  const view = buildBoardView({ tab: 'global', board, local: LOCAL, pilotName: 'madking', newGlobalId: 'g2' });
  assert.equal(view.source, 'global');
  assert.equal(view.offline, undefined);
  assert.deepEqual(view.rows.map(r => [r.rank, r.name, r.mine, r.isNew]), [
    [1, 'ACE', false, false], [2, 'MADKING', true, true], [3, 'OTHER', true, false]
  ]);
  // GLOBAL opens on the shared ALL-TIME board: each row carries its version, LV and time move to the tooltip.
  assert.equal(view.rows[0].meta, 'W14');
  assert.equal(view.rows[0].version, LEGACY_VERSION_LABEL);
  assert.equal(view.rows[0].date, '2026-10-17 · W14 · LV20 · 05:05');
});

test('submit: success remembers the run id, adopts the returned board and reports the global rank', async () => {
  const storage = memoryStorage();
  let sent = null;
  const fetchImpl = async (url, init) => {
    assert.equal(url, '/api/scores');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    sent = JSON.parse(init.body);
    return jsonResponse(201, { accepted: true, onBoard: true, rank: 12, allTimeRank: 12, id: 'new-run', name: 'MADKING', censored: false, entries: GLOBAL, total: 3, boardSize: 100 });
  };
  const board = new GlobalLeaderboard({ fetchImpl, storage });
  board.setVersion(GAME_VERSION); // filtered to this version, so the returned version board is shown
  const result = await board.submit(RUN);
  const { nonce, ...fields } = sent;
  assert.deepEqual(fields, { name: 'MADKING', score: 9000, wave: 5, level: 7, kills: 80, multiplier: 3.2, time: 100.46, version: GAME_VERSION, mode: 'normal' });
  assert.match(nonce, /^[A-Za-z0-9_-]{16,64}$/, 'every run carries a nonce, so a retry never lands twice');
  assert.equal(result.ok, true);
  assert.equal(result.rank, 12);
  assert.equal(board.status, 'ready');
  assert.equal(board.entries.length, 3);
  assert.deepEqual(JSON.parse(storage.getItem('vexolith_global_runs_v1')), ['new-run']);
  assert.deepEqual(describeSubmit(result), { text: `◎ GLOBAL RANK #12 · v${GAME_VERSION}`, tone: 'gold' });
  assert.ok(new GlobalLeaderboard({ storage }).myIds.has('new-run'), 'ids survive a reload');
});

test('submit: server refusals map to cooldown / rejected, network failures flip the board offline', async () => {
  const cases = [
    [() => jsonResponse(429, { error: 'slow down' }), 'cooldown', /COOLING DOWN/],
    [() => jsonResponse(422, { error: 'run rejected: wave does not match' }), 'rejected', /REJECTED/],
    [() => jsonResponse(400, { error: 'bad name' }), 'rejected', /REJECTED/],
    [() => jsonResponse(503, { error: 'busy' }), 'unavailable', /OFFLINE/],
    [() => { throw new TypeError('offline'); }, 'offline', /OFFLINE/]
  ];
  for (const [respond, reason, text] of cases) {
    const board = new GlobalLeaderboard({ fetchImpl: async () => respond(), storage: memoryStorage(), sleep: async () => {} });
    const result = await board.submit(RUN);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.match(describeSubmit(result).text, text);
  }
  const board = new GlobalLeaderboard({ fetchImpl: async () => { throw new TypeError('offline'); }, storage: memoryStorage(), sleep: async () => {} });
  await board.submit(RUN);
  assert.equal(buildBoardView({ tab: 'global', board, local: LOCAL }).source, 'local');
});

test('a zero-score run is not sent', async () => {
  let calls = 0;
  const board = new GlobalLeaderboard({ fetchImpl: async () => { calls++; return jsonResponse(201, {}); }, storage: memoryStorage() });
  const result = await board.submit({ ...RUN, score: 0 });
  assert.deepEqual([result.reason, calls], ['skipped', 0]);
  assert.match(describeSubmit(result).text, /NOTHING TO UPLINK/);
});

test('buildRunPayload folds any callsign into the server alphabet', () => {
  assert.equal(buildRunPayload({ ...RUN, name: '  josé   ñandú ✦ ' }).name, 'JOSE NANDU');
  assert.equal(buildRunPayload({ ...RUN, name: '🚀🚀' }).name, 'PILOT');
  assert.equal(buildRunPayload({ ...RUN, name: undefined }).name, 'PILOT');
  assert.equal(buildRunPayload({ ...RUN, name: 'X'.repeat(30) }).name.length, 18);
  const p = buildRunPayload({ name: 'A', score: 12.9, wave: NaN, level: 0, kills: -3, multiplier: 0.2, time: -1 });
  assert.deepEqual(p, { name: 'A', score: 12, wave: 1, level: 1, kills: 0, multiplier: 1, time: 0, version: GAME_VERSION, mode: 'normal' });
});

test('tabs: GLOBAL is the default, MY RUNS shows the local board, unknown tabs fall back to GLOBAL', () => {
  assert.equal(normalizeTab(undefined), 'global');
  assert.equal(normalizeTab('bogus'), 'global');
  assert.equal(normalizeTab('local'), 'local');
  const board = { status: 'ready', entries: GLOBAL, isMine: () => false };
  const local = buildBoardView({ tab: 'local', board, local: LOCAL, newLocalId: 'loc-2' });
  assert.equal(local.tab, 'local');
  assert.equal(local.source, 'local');
  assert.match(local.note, /THIS DEVICE/);
  assert.deepEqual(local.rows.map(r => [r.name, r.meta, r.isNew]), [['MADKING', 'W5 · x3.2 · 01:40', false], ['MADKING', 'W3 · x1.5 · 00:58', true]]);
  assert.equal(buildBoardView({ tab: 'global', board, local: LOCAL }).source, 'global');
  assert.match(buildBoardView({ tab: 'global', board: { status: 'ready', entries: [] }, local: LOCAL }).note, /BE THE FIRST/);
});

test('syncTabButtons marks exactly one tab active on every board panel', () => {
  const button = (tab) => {
    const classes = new Set();
    const attrs = {};
    return {
      dataset: { boardTab: tab }, attrs, classes,
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      setAttribute: (k, v) => { attrs[k] = v; }
    };
  };
  const buttons = [button('global'), button('local'), button('global'), button('local')];
  syncTabButtons(buttons, 'local');
  assert.deepEqual(buttons.map(b => b.classes.has('active')), [false, true, false, true]);
  assert.deepEqual(buttons.map(b => b.attrs['aria-selected']), ['false', 'true', 'false', 'true']);
  syncTabButtons(buttons, 'nonsense');
  assert.deepEqual(buttons.map(b => b.classes.has('active')), [true, false, true, false]);
});

test('game over: runs flown with the dev tuner are kept off the global board', async () => {
  let submitted = 0;
  const fake = {
    globalBoard: { submit: async () => { submitted++; return { ok: true, id: 'x', rank: 1 }; } },
    runTainted: true,
    renderBoards() {}
  };
  Game.prototype.submitGlobalRun.call(fake, RUN);
  assert.deepEqual(fake.globalSubmit, { reason: 'tainted' });
  assert.match(describeSubmit(fake.globalSubmit).text, /DEV TUNER/);

  fake.runTainted = false;
  const key = Object.keys(DEFAULT_TUNING).find(k => typeof DEFAULT_TUNING[k] === 'number' && !/Volume$/.test(k));
  TUNING[key] = DEFAULT_TUNING[key] + 1;
  Game.prototype.submitGlobalRun.call(fake, RUN);
  assert.deepEqual(fake.globalSubmit, { reason: 'tainted' }, 'saved tuner changes count too');
  TUNING[key] = DEFAULT_TUNING[key];
  assert.equal(submitted, 0);

  // Pause-menu volume sliders are player settings: moving them mid-run keeps the run eligible.
  const live = { state: 'PLAYING', runTainted: false, sound: { applyTuning() {} }, player: null };
  TUNING.musicVolume = DEFAULT_TUNING.musicVolume + 0.5;
  TUNING.sfxVolume = DEFAULT_TUNING.sfxVolume + 0.5;
  try { Game.prototype.applyLiveTuning.call(live); } catch { /* the rest of the live-apply path needs a full game */ }
  assert.equal(live.runTainted, false, 'volume changes do not taint the run');
  fake.runTainted = false;
  Game.prototype.submitGlobalRun.call(fake, RUN);
  assert.deepEqual(fake.globalSubmit, { pending: true }, 'saved volume settings do not block submission');
  await new Promise(resolve => setTimeout(resolve, 0));
  TUNING.musicVolume = DEFAULT_TUNING.musicVolume;
  TUNING.sfxVolume = DEFAULT_TUNING.sfxVolume;
  submitted = 0;

  Game.prototype.submitGlobalRun.call(fake, RUN);
  assert.deepEqual(fake.globalSubmit, { pending: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submitted, 1);
  assert.equal(fake.lastGlobalRunId, 'x');
  assert.equal(fake.globalSubmit.rank, 1);
});

test('game over: a late answer for an older run does not overwrite the newer run\'s rank', async () => {
  let release;
  const fake = {
    globalBoard: { submit: () => new Promise(resolve => { release = resolve; }) },
    runTainted: false,
    renderBoards() {}
  };
  Game.prototype.submitGlobalRun.call(fake, RUN);
  const first = release;
  fake.globalBoard.submit = async () => ({ ok: true, id: 'second', rank: 3 });
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  first({ ok: true, id: 'first', rank: 99 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fake.lastGlobalRunId, 'second');
  assert.equal(fake.globalSubmit.rank, 3);
});

test('the harness-style game without a board (no constructor) never submits', () => {
  const fake = {};
  assert.doesNotThrow(() => Game.prototype.submitGlobalRun.call(fake, RUN));
  assert.equal(fake.globalSubmit, undefined);
});

// --- Versioned boards ------------------------------------------------------------------------------

// A fake /api/scores that answers GETs per ?version= and records every URL.
function versionedApi(boards, { versions = [GAME_VERSION] } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const version = new URL(url, 'https://game.example').searchParams.get('version');
    return jsonResponse(200, { version, current: GAME_VERSION, versions, entries: boards[version] || [], total: (boards[version] || []).length, boardSize: 100 });
  };
  return { urls, fetchImpl };
}

test('GLOBAL opens on the shared ALL-TIME board; the selector filters by version, caches boards and drops stale answers', async () => {
  const OLD = [{ ...GLOBAL[0], id: 'o1', name: 'OLDTIMER', version: '0.0.1' }];
  const api = versionedApi({ [GAME_VERSION]: GLOBAL.map(e => ({ ...e, version: GAME_VERSION })), all: [...OLD, ...GLOBAL] }, { versions: [GAME_VERSION, '0.0.1'] });
  const board = new GlobalLeaderboard({ fetchImpl: api.fetchImpl, storage: memoryStorage() });
  assert.equal(board.version, 'all', 'one shared board by default: it never resets between versions');
  board.setVersion(GAME_VERSION);
  await board.refresh();
  assert.equal(api.urls[0], `/api/scores?version=${GAME_VERSION}`);
  assert.deepEqual(board.versions, [GAME_VERSION, '0.0.1']);
  const view = buildBoardView({ tab: 'global', board, local: LOCAL });
  assert.equal(view.board, GAME_VERSION);
  assert.equal(view.note, `TOP 100 // v${GAME_VERSION}`);
  assert.ok(view.rows.every(r => r.version === ''), 'a single-version board needs no per-row version');
  assert.deepEqual(view.versions.map(o => [o.label, o.active, o.current]), [
    ['ALL-TIME', false, false], [`v${GAME_VERSION}`, true, true], ['v0.0.1', false, false]
  ]);

  assert.equal(board.setVersion('all'), true);
  assert.equal(board.status, 'loading', 'nothing cached for ALL-TIME yet');
  assert.equal(board.entries.length, 0, 'the previous board is not shown under the new label');
  await board.refresh();
  assert.equal(api.urls.at(-1), '/api/scores?version=all');
  assert.deepEqual(board.entries.map(e => e.name), ['OLDTIMER', 'ACE', 'MADKING', 'OTHER']);

  assert.equal(board.setVersion(GAME_VERSION), true);
  assert.equal(board.status, 'ready', 'switching back shows the cached board at once');
  assert.equal(board.entries.length, 3);
  assert.equal(board.setVersion(GAME_VERSION), false, 'no-op when already selected');
  assert.equal(board.setVersion('garbage'), false, 'junk selects the current version');
  assert.equal(normalizeBoardVersion('garbage'), GAME_VERSION);

  // A slow answer for a board the player already left is cached, not shown.
  let release;
  const slow = new GlobalLeaderboard({ fetchImpl: (url) => new Promise(resolve => { release = () => resolve(api.fetchImpl(url)); }), storage: memoryStorage() });
  assert.equal(slow.version, 'all');
  const pending = slow.refresh();
  slow.setVersion(GAME_VERSION);
  release();
  await pending;
  assert.equal(slow.version, GAME_VERSION);
  assert.equal(slow.entries.length, 0, 'the ALL-TIME answer did not land on the version board');
  assert.equal(slow.cache.get('normal|all').entries.length, 4);
});

test('the ALL-TIME view shows each run\'s version; runs from before versioning read pre-0.9', () => {
  const entries = [
    { ...GLOBAL[0], version: GAME_VERSION },
    { ...GLOBAL[1], version: null },
    { ...GLOBAL[2] }
  ];
  const view = buildBoardView({ tab: 'global', board: { status: 'ready', version: 'all', entries, versions: [] }, local: LOCAL });
  assert.equal(view.board, 'all');
  assert.equal(view.note, 'TOP 100 // ALL-TIME');
  assert.deepEqual(view.rows.map(r => r.version), [`v${GAME_VERSION}`, LEGACY_VERSION_LABEL, LEGACY_VERSION_LABEL]);
  assert.equal(LEGACY_VERSION_LABEL, 'pre-0.9');
  assert.deepEqual(view.versions[0], { id: 'all', label: 'ALL-TIME', current: false, active: true });
  const empty = buildBoardView({ tab: 'global', board: { status: 'ready', entries: [] }, local: LOCAL });
  assert.equal(empty.note, `NO v${GAME_VERSION} RUNS YET // BE THE FIRST`);
  // Offline and MY RUNS have no selector.
  assert.deepEqual(buildBoardView({ tab: 'local', board: { status: 'ready', entries }, local: LOCAL }).versions, []);
  assert.deepEqual(buildBoardView({ tab: 'global', board: { status: 'offline', reason: 'offline' }, local: LOCAL }).versions, []);
});

test('version options: ALL-TIME first, then the current version and other versions with runs, newest first', () => {
  const ids = (opts) => opts.map(o => o.id);
  assert.deepEqual(ids(buildVersionOptions({ current: '0.9.0' })), ['all', '0.9.0']);
  assert.deepEqual(ids(buildVersionOptions({ current: '0.10.0', versions: ['0.9.0', '0.10.0', '0.9.2', 'junk', null, '1.0'] })),
    ['all', '0.10.0', '0.9.2', '0.9.0'], 'semver order (0.10 > 0.9), junk dropped, no duplicates');
  const opts = buildVersionOptions({ current: '0.10.0', versions: ['0.9.2'], selected: '0.9.2' });
  assert.deepEqual(opts.map(o => [o.label, o.active, o.current]), [['ALL-TIME', false, false], ['v0.10.0', false, true], ['v0.9.2', true, false]]);
});

test('submit sends the game version and the game-over line names it; an unknown version reads as outdated', async () => {
  let sent = null;
  const board = new GlobalLeaderboard({
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return jsonResponse(201, { accepted: true, onBoard: true, rank: 4, allTimeRank: 9, version: sent.version, id: 'v-run', name: 'MADKING', entries: GLOBAL, total: 3, boardSize: 100 });
    },
    storage: memoryStorage()
  });
  board.setVersion('all'); // the player was looking at ALL-TIME when the run ended
  const result = await board.submit(RUN);
  assert.equal(sent.version, GAME_VERSION);
  assert.deepEqual([result.rank, result.allTimeRank, result.version], [4, 9, GAME_VERSION]);
  assert.deepEqual(describeSubmit(result), { text: `◎ GLOBAL RANK #9 · v${GAME_VERSION}`, tone: 'gold' }, 'the headline rank is all-time');
  assert.equal(board.entries.length, 0, 'the version board answer is cached, not shown under ALL-TIME');
  assert.equal(board.cache.get(`normal|${GAME_VERSION}`).entries.length, 3);
  assert.match(describeSubmit({ ok: true, rank: 7, allTimeRank: null, version: GAME_VERSION, boardSize: 100 }).text, new RegExp(`#7 ON v${GAME_VERSION.replace(/\./g, '\\.')} // OUTSIDE ALL-TIME TOP 100`));
  assert.match(describeSubmit({ ok: true, rank: null, allTimeRank: null, version: GAME_VERSION, boardSize: 100 }).text, /OUTSIDE GLOBAL TOP 100/);

  const stale = new GlobalLeaderboard({ fetchImpl: async () => jsonResponse(422, { error: 'unknown game version: reload the game to get the latest build' }), storage: memoryStorage() });
  const refused = await stale.submit(RUN);
  assert.equal(refused.reason, 'outdated');
  assert.deepEqual(describeSubmit(refused), { text: 'OUTDATED GAME VERSION // RELOAD TO RANK GLOBALLY', tone: 'danger' });
});

test('after a submit only a board the answer did not carry (another version) is re-read', async () => {
  let refreshed = 0;
  const fake = {
    globalBoard: { version: 'all', refresh() { refreshed++; return Promise.resolve(this); }, submit: async () => ({ ok: true, id: 'r', rank: 2, version: GAME_VERSION }) },
    runTainted: false,
    renderBoards() {},
    refreshGlobalBoard() { refreshed++; }
  };
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(refreshed, 0, 'ALL-TIME came back with the answer: no re-read from the CDN cache');
  fake.globalBoard.version = GAME_VERSION;
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(refreshed, 0, 'nor the run\'s own version board');
  fake.globalBoard.version = '0.0.1';
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(refreshed, 1, 'a different version board on screen is re-read');
});

test('submit adopts the all-time board from the answer; a stale CDN copy of it is ignored', async () => {
  const older = [{ ...GLOBAL[0], id: 'old-top' }];
  const fresh = [...older, { ...GLOBAL[1], id: 'my-run' }];
  let gets = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === 'POST') {
      assert.equal(init.cache, 'no-store');
      return jsonResponse(201, { accepted: true, onBoard: true, rank: 2, allTimeRank: 2, id: 'my-run', version: GAME_VERSION, entries: fresh, total: 2, updated: '2026-10-17T12:00:05.000Z',
        allTime: { entries: fresh, total: 2, updated: '2026-10-17T12:00:05.000Z' }, boardSize: 100 });
    }
    gets++;
    assert.equal(init.cache, 'default', 'GETs may use the CDN cache');
    // The CDN's copy from before the run landed.
    return jsonResponse(200, { version: 'all', entries: older, total: 1, updated: '2026-10-17T12:00:00.000Z', boardSize: 100 });
  };
  const board = new GlobalLeaderboard({ fetchImpl, storage: memoryStorage(), sleep: async () => {} });
  assert.equal(board.version, ALL_TIME);
  const result = await board.submit(RUN);
  assert.equal(result.ok, true);
  assert.deepEqual(board.entries.map(e => e.id), ['old-top', 'my-run'], 'shown at once from the answer');
  await board.refresh();
  assert.equal(gets, 1);
  assert.deepEqual(board.entries.map(e => e.id), ['old-top', 'my-run'], 'the older CDN copy does not wipe the run out');
  assert.equal(board.status, 'ready');
  // A newer board (someone else's run since) is taken.
  const newer = new GlobalLeaderboard({ fetchImpl: async () => jsonResponse(200, { version: 'all', entries: older, total: 1, updated: '2026-10-17T13:00:00.000Z' }), storage: memoryStorage() });
  newer.adopt({ entries: fresh, total: 2, updated: '2026-10-17T12:00:05.000Z' }, ALL_TIME);
  await newer.refresh();
  assert.deepEqual(newer.entries.map(e => e.id), ['old-top']);
});

test('submit retries a busy server or a dropped connection quietly, with the same nonce', async () => {
  const sent = [];
  const sleeps = [];
  const retries = [];
  const replies = [
    () => jsonResponse(503, { error: 'leaderboard busy, try again', partial: false }),
    () => { throw new TypeError('network'); },
    () => jsonResponse(201, { accepted: true, onBoard: true, rank: 4, allTimeRank: 9, id: 'landed', version: GAME_VERSION, entries: GLOBAL, total: 3 })
  ];
  const board = new GlobalLeaderboard({
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return replies[sent.length - 1](); },
    storage: memoryStorage(),
    sleep: async (ms) => { sleeps.push(ms); }
  });
  const result = await board.submit(RUN, { onRetry: (n) => retries.push(n) });
  assert.equal(result.ok, true);
  assert.equal(result.allTimeRank, 9);
  assert.equal(sent.length, 3);
  assert.ok(sent.every(p => p.nonce === sent[0].nonce), 'one nonce for every try');
  assert.deepEqual(retries, [1, 2]);
  assert.ok(sleeps[0] >= 2000, 'a 503 waits at least its retry-after (2 s)');
  assert.ok(sleeps[1] >= 1500 && sleeps[1] <= 2500, 'then exponential backoff with jitter');
  assert.equal(result.retry, undefined, 'internal retry flags stay internal');
  assert.notEqual(board.status, 'offline');
  assert.deepEqual(describeSubmit({ pending: true, retrying: 1 }), { text: '◎ GLOBAL BOARD BUSY // RETRYING UPLINK…', tone: 'cyan' });
});

test('submit gives up visibly after its retries, and a lost answer (429 on a retry) waits out the cooldown once', async () => {
  let posts = 0;
  const down = new GlobalLeaderboard({ fetchImpl: async () => { posts++; throw new TypeError('network'); }, storage: memoryStorage(), sleep: async () => {} });
  const failed = await down.submit(RUN);
  assert.equal(posts, 1 + SUBMIT_RETRIES);
  assert.equal(failed.ok, false);
  assert.equal(down.status, 'offline', 'the GLOBAL tab falls back to local runs');
  assert.match(describeSubmit(failed).text, /OFFLINE \/\/ RUN SAVED LOCALLY/);

  // No API at all (the local server's 404 page) is not retried.
  posts = 0;
  const local = new GlobalLeaderboard({ fetchImpl: async () => { posts++; return { ok: false, status: 404, headers: { get: () => 'text/html' } }; }, storage: memoryStorage(), sleep: async () => { throw Error('no retry'); } });
  assert.equal((await local.submit(RUN)).reason, 'unavailable');
  assert.equal(posts, 1);

  // A first-try 429 is a real cooldown: no retry.
  posts = 0;
  const cooling = new GlobalLeaderboard({ fetchImpl: async () => { posts++; return jsonResponse(429, { error: 'slow down', retryAfter: 12 }); }, storage: memoryStorage(), sleep: async () => {} });
  assert.equal((await cooling.submit(RUN)).reason, 'cooldown');
  assert.equal(posts, 1);

  // A timeout (the run landed, the answer was lost), then the cooldown, then success with the same nonce.
  const sleeps = [];
  const seq = [
    () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
    () => jsonResponse(429, { error: 'slow down', retryAfter: 18 }),
    () => jsonResponse(201, { accepted: true, onBoard: true, rank: 3, id: 'once', version: GAME_VERSION, entries: GLOBAL, total: 3 })
  ];
  posts = 0;
  const lost = new GlobalLeaderboard({ fetchImpl: async () => seq[posts++](), storage: memoryStorage(), sleep: async (ms) => { sleeps.push(ms); } });
  const ok = await lost.submit(RUN);
  assert.equal(ok.ok, true);
  assert.equal(ok.id, 'once');
  assert.ok(sleeps[1] >= 18_000, 'the retry waited out the cooldown');
});

test('Game.setBoardVersion switches the board and re-syncs it', () => {
  const calls = [];
  const fake = {
    globalBoard: new GlobalLeaderboard({ fetchImpl: null, storage: memoryStorage() }),
    refreshGlobalBoard() { calls.push(this.globalBoard.version); }
  };
  Game.prototype.setBoardVersion.call(fake, 'all');
  Game.prototype.setBoardVersion.call(fake, GAME_VERSION);
  assert.deepEqual(calls, ['all', GAME_VERSION]);
  assert.doesNotThrow(() => Game.prototype.setBoardVersion.call({}, 'all'));
});

// Minimal DOM stand-in for renderVersionOptions / renderBoardView.
class FakeEl {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.classes = new Set();
    this.textContent = '';
    this.classList = {
      toggle: (c, on = !this.classes.has(c)) => (on ? this.classes.add(c) : this.classes.delete(c)),
      add: (c) => this.classes.add(c),
      contains: (c) => this.classes.has(c)
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get lastChild() { return this.children.at(-1) || null; }
  appendChild(el) { this.children.push(el); return el; }
  prepend(el) { this.children.unshift(el); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  querySelectorAll(sel) {
    const all = (el) => el.children.flatMap(c => [c, ...all(c)]);
    return sel === '[data-board-version]' ? all(this).filter(c => 'boardVersion' in c.dataset) : [];
  }
}
const fakeDoc = { createElement: (tag) => new FakeEl(tag, fakeDoc) };

test('renderVersionOptions: focusable buttons built once, active mark moves without rebuilding', () => {
  const container = new FakeEl('div', fakeDoc);
  container.classes.add('hidden');
  renderVersionOptions(container, buildVersionOptions({ current: GAME_VERSION, versions: ['0.0.1'] }));
  assert.equal(container.classes.has('hidden'), false);
  const buttons = container.querySelectorAll('[data-board-version]');
  assert.deepEqual(buttons.map(b => [b.tagName, b.textContent, b.classes.has('active'), b.attrs['aria-pressed']]), [
    ['BUTTON', 'ALL-TIME', false, 'false'], ['BUTTON', `v${GAME_VERSION}`, true, 'true'], ['BUTTON', 'v0.0.1', false, 'false']
  ]);
  renderVersionOptions(container, buildVersionOptions({ current: GAME_VERSION, versions: ['0.0.1'], selected: 'all' }));
  const again = container.querySelectorAll('[data-board-version]');
  assert.ok(again.every((b, i) => b === buttons[i]), 'same elements, so controller focus survives');
  assert.deepEqual(again.map(b => b.classes.has('active')), [true, false, false]);
  renderVersionOptions(container, []);
  assert.equal(container.classes.has('hidden'), true, 'hidden on MY RUNS / offline');

  // ALL-TIME rows carry a version tag in their meta cell.
  const list = new FakeEl('div', fakeDoc);
  const view = buildBoardView({ tab: 'global', board: { status: 'ready', version: 'all', entries: [{ ...GLOBAL[0], version: null }] }, local: [] });
  renderBoardView(list, null, view);
  assert.equal(list.children[0].className, 'hs-head', 'a pinned column head comes first');
  assert.deepEqual(list.children[0].children.map(c => c.textContent), ['#', 'PILOT', 'RUN', 'SCORE']);
  const meta = list.children[1].children[2];
  assert.equal(meta.children[0].textContent, LEGACY_VERSION_LABEL);
  assert.equal(meta.children[0].classes.has('legacy'), true);
});

test('unchecking "Post my runs to the public GLOBAL leaderboard" keeps runs local', async () => {
  const { readPostGlobal, writePostGlobal, POST_GLOBAL_KEY } = await import('../js/stats-client.js');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readPostGlobal(storage), true, 'checked by default');
  writePostGlobal(storage, false);
  assert.equal(store.get(POST_GLOBAL_KEY), '0');
  assert.equal(readPostGlobal(storage), false, 'the choice is remembered');
  assert.equal(readPostGlobal({ getItem() { throw Error('blocked'); } }), true, 'blocked storage reads as the default');

  let submitted = 0;
  const fake = { postGlobal: false, runTainted: false, globalBoard: { submit: async () => { submitted++; return { ok: true }; } }, renderBoards() {} };
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(submitted, 0, 'nothing is sent');
  assert.deepEqual(fake.globalSubmit, { reason: 'optout' });
  assert.deepEqual(describeSubmit(fake.globalSubmit), { text: 'GLOBAL POSTING OFF // RUN SAVED LOCALLY', tone: 'dim' });
});

// --- Game modes (js/modes.js): each mode has its own boards ----------------------------------------

test('modes: a HARDCORE run is sent with its mode, its answer is filed under the HARDCORE board, and the line says so', async () => {
  let sent = null;
  const board = new GlobalLeaderboard({
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return jsonResponse(201, { accepted: true, onBoard: true, rank: 2, allTimeRank: 3, version: GAME_VERSION, mode: 'hardcore', id: 'hc-run', name: 'MADKING', entries: GLOBAL, total: 3, boardSize: 100 });
    },
    storage: memoryStorage()
  });
  const result = await board.submit({ ...RUN, mode: 'hardcore' });
  assert.equal(sent.mode, 'hardcore');
  assert.equal(result.mode, 'hardcore');
  assert.equal(board.cache.get(`hardcore|${GAME_VERSION}`).entries.length, 3);
  assert.equal(board.cache.get(`normal|${GAME_VERSION}`), undefined, 'never filed under NORMAL');
  assert.deepEqual(describeSubmit(result), { text: `◎ GLOBAL RANK #3 · HARDCORE · v${GAME_VERSION}`, tone: 'gold' });
  assert.equal(buildRunPayload({ ...RUN, mode: 'blitz' }).mode, 'blitz');
  assert.equal(buildRunPayload({ ...RUN, mode: 'nope' }).mode, 'normal');
});

test('modes: the switch reads ?mode= boards (NORMAL keeps the old URL) and keeps the version filter', async () => {
  const urls = [];
  const board = new GlobalLeaderboard({
    fetchImpl: async (url) => {
      urls.push(url);
      const mode = new URL(url, 'https://game.example').searchParams.get('mode') || 'normal';
      return jsonResponse(200, { mode, versions: [GAME_VERSION], entries: mode === 'blitz' ? GLOBAL.slice(0, 1) : GLOBAL, total: 3, boardSize: 100 });
    },
    storage: memoryStorage()
  });
  await board.refresh();
  assert.equal(urls[0], '/api/scores?version=all');
  assert.equal(board.setMode('blitz'), true);
  assert.equal(board.status, 'loading');
  await board.refresh();
  assert.equal(urls[1], '/api/scores?version=all&mode=blitz');
  assert.equal(board.entries.length, 1);
  const view = buildBoardView({ tab: 'global', board, local: LOCAL });
  assert.equal(view.note, 'TOP 100 // BLITZ // ALL-TIME');
  assert.deepEqual(view.modes.map((m) => [m.label, m.active]), [['NORMAL', false], ['HARDCORE', false], ['BLITZ', true]]);
  assert.deepEqual(view.rows.length, 1);
  assert.equal(board.setMode('blitz'), false);
  board.setMode('normal');
  assert.equal(board.status, 'ready', 'switching back is instant from the cache');
  assert.equal(board.entries.length, 3);
  // MY RUNS is filtered to the mode on screen (saved runs without a mode are NORMAL).
  board.setMode('hardcore');
  assert.deepEqual(buildBoardView({ tab: 'local', board, local: [...LOCAL, { ...LOCAL[0], id: 'h', mode: 'hardcore' }] }).rows.map(r => r.key), ['h']);
});

test('modes: Game.setBoardMode switches and re-syncs; game over submits the run\'s mode', async () => {
  const calls = [];
  const fake = {
    globalBoard: new GlobalLeaderboard({ fetchImpl: null, storage: memoryStorage() }),
    refreshGlobalBoard() { calls.push(this.globalBoard.mode); }
  };
  Game.prototype.setBoardMode.call(fake, 'hardcore');
  assert.deepEqual(calls, ['hardcore']);
  assert.doesNotThrow(() => Game.prototype.setBoardMode.call({}, 'blitz'));

  let posted = null;
  const game = { globalBoard: { version: 'all', mode: 'blitz', submit: async (r) => { posted = r; return { ok: true, id: 'b', rank: 1, version: GAME_VERSION, mode: 'blitz' }; } }, runTainted: false, renderBoards() {}, refreshGlobalBoard() {} };
  Game.prototype.submitGlobalRun.call(game, { ...RUN, mode: 'blitz' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(posted.mode, 'blitz');
});

test('renderModeOptions: three focusable buttons built once, the active mark moves', () => {
  const container = new FakeEl('div', fakeDoc);
  container.querySelectorAll = (sel) => (sel === '[data-board-mode]' ? container.children.filter(c => 'boardMode' in c.dataset) : []);
  renderModeOptions(container, buildModeOptions('normal'));
  const first = container.children.slice();
  assert.deepEqual(first.slice(1).map(b => [b.tagName, b.dataset.boardMode, b.textContent]), [['BUTTON', 'normal', 'NORMAL'], ['BUTTON', 'hardcore', 'HARDCORE'], ['BUTTON', 'blitz', 'BLITZ']]);
  renderModeOptions(container, buildModeOptions('blitz'));
  assert.deepEqual(container.children, first, 'not rebuilt');
  assert.deepEqual(first.slice(1).map(b => b.attrs['aria-pressed']), ['false', 'false', 'true']);
});

test('renderBoardView: 100 rows under the column head, medal classes, a controller scroll stop and a YOU #n jump', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...GLOBAL[0], id: `r${i}`, name: i === 61 ? 'MADKING' : `P${i}`, score: 1e6 - i }));
  const board = { status: 'ready', version: 'all', entries, boardSize: 100, isMine: (e) => e.name === 'MADKING' };
  const view = buildBoardView({ tab: 'global', board, local: [], pilotName: 'MADKING' });
  assert.equal(view.rows.length, 100);
  assert.equal(view.note, 'TOP 100 // ALL-TIME');
  const list = new FakeEl('div', fakeDoc);
  renderBoardView(list, null, view);
  const rows = list.children.filter(c => c.classes.has('hs-row'));
  assert.equal(rows.length, 100);
  assert.deepEqual(rows.slice(0, 4).map(r => ['hs-top1', 'hs-top2', 'hs-top3'].find(c => r.classes.has(c)) || ''), ['hs-top1', 'hs-top2', 'hs-top3', '']);
  assert.ok(rows[61].classes.has('hs-mine'));
  const jump = list.children.at(-1);
  assert.equal(jump.tagName, 'BUTTON');
  assert.ok(jump.classes.has('hs-jump'));
  assert.equal(jump.dataset.rank, '62');
  assert.equal(jump.dataset.target, rows[61].dataset.rowKey);
  assert.ok('gpScroll' in list.dataset && 'gpNav' in list.dataset, 'the d-pad can focus and scroll the board');
  // An empty board is no scroll stop.
  renderBoardView(list, null, buildBoardView({ tab: 'global', board: { ...board, entries: [] }, local: [] }));
  assert.equal('gpScroll' in list.dataset, false);
});
