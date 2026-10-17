// Browser-side leaderboard client (js/leaderboard.js): offline/timeout fallback, submit states, tabs.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  GlobalLeaderboard, requestJson, buildBoardView, buildRunPayload, describeSubmit, normalizeTab, syncTabButtons, OFFLINE_NOTES, buildVersionOptions, renderVersionOptions, renderBoardView, normalizeBoardVersion
} = await import('../js/leaderboard.js');
const { Game } = await import('../js/main.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { GAME_VERSION, LEGACY_VERSION_LABEL } = await import('../js/version.js');

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
  assert.deepEqual(sent, { name: 'MADKING', score: 9000, wave: 5, level: 7, kills: 80, multiplier: 3.2, time: 100.46, version: GAME_VERSION });
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
  assert.deepEqual(p, { name: 'A', score: 12, wave: 1, level: 1, kills: 0, multiplier: 1, time: 0, version: GAME_VERSION });
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

test('GLOBAL opens on the current version; the selector switches boards, caches them and drops stale answers', async () => {
  const OLD = [{ ...GLOBAL[0], id: 'o1', name: 'OLDTIMER', version: '0.0.1' }];
  const api = versionedApi({ [GAME_VERSION]: GLOBAL.map(e => ({ ...e, version: GAME_VERSION })), all: [...OLD, ...GLOBAL] }, { versions: [GAME_VERSION, '0.0.1'] });
  const board = new GlobalLeaderboard({ fetchImpl: api.fetchImpl, storage: memoryStorage() });
  assert.equal(board.version, GAME_VERSION, 'current version by default');
  await board.refresh();
  assert.equal(api.urls[0], `/api/scores?version=${GAME_VERSION}`);
  assert.deepEqual(board.versions, [GAME_VERSION, '0.0.1']);
  const view = buildBoardView({ tab: 'global', board, local: LOCAL });
  assert.equal(view.board, GAME_VERSION);
  assert.equal(view.note, `TOP 50 // v${GAME_VERSION}`);
  assert.ok(view.rows.every(r => r.version === ''), 'a single-version board needs no per-row version');
  assert.deepEqual(view.versions.map(o => [o.label, o.active, o.current]), [
    [`v${GAME_VERSION}`, true, true], ['v0.0.1', false, false], ['ALL-TIME', false, false]
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
  slow.setVersion('all');
  const pending = slow.refresh();
  slow.setVersion(GAME_VERSION);
  release();
  await pending;
  assert.equal(slow.version, GAME_VERSION);
  assert.equal(slow.entries.length, 0, 'the ALL-TIME answer did not land on the version board');
  assert.equal(slow.cache.get('all').entries.length, 4);
});

test('the ALL-TIME view shows each run\'s version; runs from before versioning read pre-0.9', () => {
  const entries = [
    { ...GLOBAL[0], version: GAME_VERSION },
    { ...GLOBAL[1], version: null },
    { ...GLOBAL[2] }
  ];
  const view = buildBoardView({ tab: 'global', board: { status: 'ready', version: 'all', entries, versions: [] }, local: LOCAL });
  assert.equal(view.board, 'all');
  assert.equal(view.note, 'TOP 50 // ALL-TIME');
  assert.deepEqual(view.rows.map(r => r.version), [`v${GAME_VERSION}`, LEGACY_VERSION_LABEL, LEGACY_VERSION_LABEL]);
  assert.equal(LEGACY_VERSION_LABEL, 'pre-0.9');
  assert.deepEqual(view.versions.at(-1), { id: 'all', label: 'ALL-TIME', current: false, active: true });
  const empty = buildBoardView({ tab: 'global', board: { status: 'ready', entries: [] }, local: LOCAL });
  assert.equal(empty.note, `NO v${GAME_VERSION} RUNS YET // BE THE FIRST`);
  // Offline and MY RUNS have no selector.
  assert.deepEqual(buildBoardView({ tab: 'local', board: { status: 'ready', entries }, local: LOCAL }).versions, []);
  assert.deepEqual(buildBoardView({ tab: 'global', board: { status: 'offline', reason: 'offline' }, local: LOCAL }).versions, []);
});

test('version options: current version always offered, other versions with runs newest first, ALL-TIME last', () => {
  const ids = (opts) => opts.map(o => o.id);
  assert.deepEqual(ids(buildVersionOptions({ current: '0.9.0' })), ['0.9.0', 'all']);
  assert.deepEqual(ids(buildVersionOptions({ current: '0.10.0', versions: ['0.9.0', '0.10.0', '0.9.2', 'junk', null, '1.0'] })),
    ['0.10.0', '0.9.2', '0.9.0', 'all'], 'semver order (0.10 > 0.9), junk dropped, no duplicates');
  const opts = buildVersionOptions({ current: '0.10.0', versions: ['0.9.2'], selected: '0.9.2' });
  assert.deepEqual(opts.map(o => [o.label, o.active, o.current]), [['v0.10.0', false, true], ['v0.9.2', true, false], ['ALL-TIME', false, false]]);
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
  assert.deepEqual(describeSubmit(result), { text: `◎ GLOBAL RANK #4 · v${GAME_VERSION}`, tone: 'gold' });
  assert.equal(board.entries.length, 0, 'the version board answer is cached, not shown under ALL-TIME');
  assert.equal(board.cache.get(GAME_VERSION).entries.length, 3);
  assert.match(describeSubmit({ ok: true, rank: null, version: GAME_VERSION, boardSize: 100 }).text, new RegExp(`OUTSIDE v${GAME_VERSION.replace(/\./g, '\\.')} TOP 100`));

  const stale = new GlobalLeaderboard({ fetchImpl: async () => jsonResponse(422, { error: 'unknown game version: reload the game to get the latest build' }), storage: memoryStorage() });
  const refused = await stale.submit(RUN);
  assert.equal(refused.reason, 'outdated');
  assert.deepEqual(describeSubmit(refused), { text: 'OUTDATED GAME VERSION // RELOAD TO RANK GLOBALLY', tone: 'danger' });
});

test('game over on another board (ALL-TIME) re-reads it after the submit so the new run shows there too', async () => {
  let refreshed = 0;
  const fake = {
    globalBoard: { version: 'all', refresh() { refreshed++; return Promise.resolve(this); }, submit: async () => ({ ok: true, id: 'r', rank: 2, version: GAME_VERSION }) },
    runTainted: false,
    renderBoards() {},
    refreshGlobalBoard() { refreshed++; }
  };
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(refreshed, 1);
  fake.globalBoard.version = GAME_VERSION;
  Game.prototype.submitGlobalRun.call(fake, RUN);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(refreshed, 1, 'the run\'s own board came back with the answer');
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
    ['BUTTON', `v${GAME_VERSION}`, true, 'true'], ['BUTTON', 'v0.0.1', false, 'false'], ['BUTTON', 'ALL-TIME', false, 'false']
  ]);
  renderVersionOptions(container, buildVersionOptions({ current: GAME_VERSION, versions: ['0.0.1'], selected: 'all' }));
  const again = container.querySelectorAll('[data-board-version]');
  assert.ok(again.every((b, i) => b === buttons[i]), 'same elements, so controller focus survives');
  assert.deepEqual(again.map(b => b.classes.has('active')), [false, false, true]);
  renderVersionOptions(container, []);
  assert.equal(container.classes.has('hidden'), true, 'hidden on MY RUNS / offline');

  // ALL-TIME rows carry a version tag in their meta cell.
  const list = new FakeEl('div', fakeDoc);
  const view = buildBoardView({ tab: 'global', board: { status: 'ready', version: 'all', entries: [{ ...GLOBAL[0], version: null }] }, local: [] });
  renderBoardView(list, null, view);
  const meta = list.children[0].children[2];
  assert.equal(meta.children[0].textContent, LEGACY_VERSION_LABEL);
  assert.equal(meta.children[0].classes.has('legacy'), true);
});
