// Browser-side leaderboard client (js/leaderboard.js): offline/timeout fallback, submit states, tabs.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  GlobalLeaderboard, requestJson, buildBoardView, buildRunPayload, describeSubmit, normalizeTab, syncTabButtons, OFFLINE_NOTES
} = await import('../js/leaderboard.js');
const { Game } = await import('../js/main.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

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
  assert.equal(view.rows[0].meta, 'W14 · LV20 · 05:05');
  assert.equal(view.rows[0].date, '2026-10-17');
});

test('submit: success remembers the run id, adopts the returned board and reports the global rank', async () => {
  const storage = memoryStorage();
  let sent = null;
  const fetchImpl = async (url, init) => {
    assert.equal(url, '/api/scores');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    sent = JSON.parse(init.body);
    return jsonResponse(201, { accepted: true, onBoard: true, rank: 12, id: 'new-run', name: 'MADKING', censored: false, entries: GLOBAL, total: 3, boardSize: 100 });
  };
  const board = new GlobalLeaderboard({ fetchImpl, storage });
  const result = await board.submit(RUN);
  assert.deepEqual(sent, { name: 'MADKING', score: 9000, wave: 5, level: 7, kills: 80, multiplier: 3.2, time: 100.46 });
  assert.equal(result.ok, true);
  assert.equal(result.rank, 12);
  assert.equal(board.status, 'ready');
  assert.equal(board.entries.length, 3);
  assert.deepEqual(JSON.parse(storage.getItem('vexolith_global_runs_v1')), ['new-run']);
  assert.deepEqual(describeSubmit(result), { text: '◎ GLOBAL RANK #12', tone: 'gold' });
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
    const board = new GlobalLeaderboard({ fetchImpl: async () => respond(), storage: memoryStorage() });
    const result = await board.submit(RUN);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.match(describeSubmit(result).text, text);
  }
  const board = new GlobalLeaderboard({ fetchImpl: async () => { throw new TypeError('offline'); }, storage: memoryStorage() });
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
  assert.deepEqual(p, { name: 'A', score: 12, wave: 1, level: 1, kills: 0, multiplier: 1, time: 0 });
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
  const key = Object.keys(DEFAULT_TUNING).find(k => typeof DEFAULT_TUNING[k] === 'number');
  TUNING[key] = DEFAULT_TUNING[key] + 1;
  Game.prototype.submitGlobalRun.call(fake, RUN);
  assert.deepEqual(fake.globalSubmit, { reason: 'tainted' }, 'saved tuner changes count too');
  TUNING[key] = DEFAULT_TUNING[key];
  assert.equal(submitted, 0);

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
