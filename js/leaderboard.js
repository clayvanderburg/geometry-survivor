// Global leaderboard client: fetches/submits runs at /api/scores (a Netlify Function) and builds the
// title and game-over board views. Every network path has a timeout and resolves to a status object;
// nothing here throws or blocks play. Without the function (local dev server, offline, slow network)
// the GLOBAL tab falls back to the local board with an OFFLINE note.
//
// One shared board that never resets: the GLOBAL tab opens on ALL-TIME, where every run shows the game
// version it was flown on. Runs are sent with GAME_VERSION and also filed per version, so a compact
// selector can filter the board to a single version.
//
// Each game mode (js/modes.js) has its own boards: runs are sent with their mode, and a NORMAL / HARDCORE
// / BLITZ switch beside the version selector picks the mode on screen, for MY RUNS too.
import { sanitizeCallsign, formatRunTime, ALL_TIME } from './leaderboard-rules.js';
import { GAME_VERSION, compareVersions, isVersionString, versionLabel } from './version.js';
import { MODES, MODE_IDS, DEFAULT_MODE, normalizeMode } from './modes.js';

export const SCORES_ENDPOINT = '/api/scores';
export const BOARD_TABS = ['global', 'local'];
const MY_RUNS_KEY = 'vexolith_global_runs_v1';
const MY_RUNS_MAX = 100;
const FALLBACK_NAME = 'PILOT';

export const OFFLINE_NOTES = {
  offline: 'OFFLINE // SHOWING YOUR LOCAL RUNS',
  timeout: 'OFFLINE // GLOBAL BOARD NOT RESPONDING, SHOWING LOCAL RUNS',
  unavailable: 'OFFLINE // GLOBAL BOARD UNAVAILABLE, SHOWING LOCAL RUNS'
};

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// One request with a timeout. Resolves { ok, status, data } or { ok: false, reason, status }.
export async function requestJson(fetchImpl, url, { method = 'GET', body, timeoutMs = 4500 } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'unavailable', status: 0 };
  if (globalThis.navigator && globalThis.navigator.onLine === false) return { ok: false, reason: 'offline', status: 0 };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ ok: false, reason: 'timeout', status: 0 });
    }, timeoutMs);
  });
  const attempt = (async () => {
    try {
      const res = await fetchImpl(url, {
        method,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller?.signal
      });
      let data = null;
      const type = res.headers?.get?.('content-type') || '';
      if (type.includes('application/json')) {
        try { data = await res.json(); } catch { data = null; }
      }
      // No JSON at all (e.g. the local static server's 404 page): the function isn't deployed here.
      if (!data) return { ok: false, reason: 'unavailable', status: res.status };
      if (!res.ok) return { ok: false, reason: 'http', status: res.status, data };
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'offline', status: 0 };
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function cleanEntries(list) {
  return (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.score));
}

// The game-side run report. The callsign is folded into the server's alphabet first so the submit
// can't fail on a name the title screen happily accepted. `version` is the game version the run was
// flown on; the server files the run on that version's board (and the all-time board) of its `mode`.
export function buildRunPayload({ name, score, wave, level, kills, multiplier, time, version = GAME_VERSION, mode = DEFAULT_MODE }) {
  const int = (v, min) => Math.max(min, Math.floor(Number(v) || 0));
  return {
    name: sanitizeCallsign(name) || FALLBACK_NAME,
    score: int(score, 0),
    wave: int(wave, 1),
    level: int(level, 1),
    kills: int(kills, 0),
    multiplier: Math.max(1, Math.round((Number(multiplier) || 1) * 10) / 10),
    time: Math.max(0, Math.round((Number(time) || 0) * 100) / 100),
    version,
    mode: normalizeMode(mode)
  };
}

// A board selection: ALL_TIME, a version string, or (anything else) the current version.
export function normalizeBoardVersion(value, current = GAME_VERSION) {
  if (value === ALL_TIME) return ALL_TIME;
  return isVersionString(value) ? value : current;
}

// The version selector under the GLOBAL tab: the current version, every other version the server
// reports runs for (newest first), with ALL-TIME first. Each option: { id, label, current, active }.
export function buildVersionOptions({ current = GAME_VERSION, versions = [], selected = current } = {}) {
  const ids = [...new Set([current, ...(Array.isArray(versions) ? versions : []).filter(isVersionString)])]
    .sort((a, b) => compareVersions(b, a));
  const active = normalizeBoardVersion(selected, current);
  return [
    { id: ALL_TIME, label: 'ALL-TIME', current: false, active: active === ALL_TIME },
    ...ids.map(id => ({ id, label: versionLabel(id), current: id === current, active: id === active }))
  ];
}

// The mode switch beside the version selector: one option per mode, { id, label, active }.
export function buildModeOptions(selected = DEFAULT_MODE) {
  const active = normalizeMode(selected);
  return MODE_IDS.map(id => ({ id, label: MODES[id].label, active: id === active }));
}

// Cache key of one board: a mode and a version.
const boardId = (mode, version) => `${mode}|${version}`;

export class GlobalLeaderboard {
  constructor({ endpoint = SCORES_ENDPOINT, fetchImpl, timeoutMs = 4500, storage = defaultStorage(), version = GAME_VERSION } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl !== undefined ? fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.timeoutMs = timeoutMs;
    this.storage = storage;
    this.current = version; // the version this client is: its runs go to this board
    this.version = ALL_TIME; // the board on screen: ALL_TIME (default) or a single version as a filter
    this.mode = DEFAULT_MODE; // ...of this game mode (each mode has its own boards)
    this.versions = [];     // versions the server reports runs for
    this.cache = new Map(); // 'mode|version' -> { entries, total }, so switching back is instant
    this.status = 'idle'; // idle | loading | ready | offline
    this.reason = '';
    this.entries = [];
    this.total = 0;
    this.boardSize = 100;
    this.myIds = this.loadMyIds();
    this.inflight = null;
    this.inflightBoard = null;
  }

  loadMyIds() {
    try {
      const list = JSON.parse(this.storage?.getItem(MY_RUNS_KEY) || '[]');
      return new Set(Array.isArray(list) ? list.filter(id => typeof id === 'string').slice(-MY_RUNS_MAX) : []);
    } catch {
      return new Set();
    }
  }

  rememberId(id) {
    if (typeof id !== 'string') return;
    this.myIds.add(id);
    try { this.storage?.setItem(MY_RUNS_KEY, JSON.stringify([...this.myIds].slice(-MY_RUNS_MAX))); } catch { /* storage blocked */ }
  }

  // NORMAL boards keep the URL older builds used (no mode parameter).
  boardUrl(version = this.version, mode = this.mode) {
    const url = `${this.endpoint}?version=${encodeURIComponent(version)}`;
    return mode === DEFAULT_MODE ? url : `${url}&mode=${encodeURIComponent(mode)}`;
  }

  // Puts the cached copy of the selected board on screen (or nothing until it loads).
  showSelected() {
    const cached = this.cache.get(boardId(this.mode, this.version));
    this.entries = cached ? cached.entries : [];
    this.total = cached ? cached.total : 0;
    if (this.status !== 'offline') this.status = cached ? 'ready' : 'loading';
  }

  // Switches the board on screen (call refresh() after). Returns false when nothing changed.
  setVersion(value) {
    const next = normalizeBoardVersion(value, this.current);
    if (next === this.version) return false;
    this.version = next;
    this.showSelected();
    return true;
  }

  // Switches the mode on screen, keeping the version filter (call refresh() after). Returns false when
  // nothing changed.
  setMode(value) {
    const next = normalizeMode(value);
    if (next === this.mode) return false;
    this.mode = next;
    this.showSelected();
    return true;
  }

  // Takes a server board (a GET or POST answer) for `version` of `mode`. It only replaces what's on
  // screen when that board is the selected one; a late answer for a board the player switched away from
  // is cached.
  adopt(data, version = this.version, mode = this.mode) {
    const entries = cleanEntries(data?.entries);
    const total = Number(data?.total) || entries.length;
    const shown = version === this.version && mode === this.mode;
    if (Array.isArray(data?.versions) && shown) this.versions = data.versions.filter(isVersionString);
    if (Number(data?.boardSize) > 0) this.boardSize = Number(data.boardSize);
    this.cache.set(boardId(mode, version), { entries, total });
    if (!shown) return;
    this.entries = entries;
    this.total = total;
    this.status = 'ready';
    this.reason = '';
  }

  // Loads the top 50 of the selected board. Concurrent calls for the same board share one request.
  // Resolves to this (never rejects).
  refresh() {
    const { version, mode } = this;
    const id = boardId(mode, version);
    if (this.inflight && this.inflightBoard === id) return this.inflight;
    if (this.status !== 'ready') this.status = 'loading';
    const request = requestJson(this.fetchImpl, this.boardUrl(version, mode), { timeoutMs: this.timeoutMs }).then((res) => {
      if (res.ok) this.adopt(res.data, version, mode);
      else if (version === this.version && mode === this.mode) {
        this.status = 'offline';
        this.reason = res.reason === 'http' ? 'unavailable' : res.reason;
      }
      return this;
    }).catch(() => {
      this.status = 'offline';
      this.reason = 'unavailable';
      return this;
    }).finally(() => {
      if (this.inflight === request) {
        this.inflight = null;
        this.inflightBoard = null;
      }
    });
    this.inflight = request;
    this.inflightBoard = id;
    return request;
  }

  // Submits one run, tagged with this client's version and the run's mode. Resolves
  // { ok, rank, allTimeRank, onBoard, id, name, censored, version, mode } or { ok: false, reason, status, error }.
  // The answer carries the run's own version board, which is adopted (and shown if it's the selected one).
  async submit(run) {
    const payload = buildRunPayload({ ...run, version: this.current });
    if (payload.score < 1) return { ok: false, reason: 'skipped' };
    try {
      const res = await requestJson(this.fetchImpl, this.endpoint, { method: 'POST', body: payload, timeoutMs: this.timeoutMs + 1500 });
      if (res.ok && res.data?.accepted) {
        this.rememberId(res.data.id);
        const version = res.data.version === undefined ? payload.version : res.data.version;
        this.adopt(res.data, version || ALL_TIME, payload.mode);
        return {
          ok: true,
          rank: Number.isInteger(res.data.rank) ? res.data.rank : null,
          allTimeRank: Number.isInteger(res.data.allTimeRank) ? res.data.allTimeRank : null,
          onBoard: !!res.data.onBoard,
          id: res.data.id,
          name: res.data.name,
          censored: !!res.data.censored,
          version,
          mode: payload.mode,
          boardSize: this.boardSize
        };
      }
      if (res.reason === 'http') {
        const error = typeof res.data?.error === 'string' ? res.data.error : '';
        const reason = res.status === 429 ? 'cooldown' : res.status >= 500 ? 'unavailable'
          : res.status === 422 && /unknown game version/i.test(error) ? 'outdated' : 'rejected';
        return { ok: false, reason, status: res.status, error };
      }
      // Network trouble: the GLOBAL tab falls back to local runs with the matching OFFLINE note.
      this.status = 'offline';
      this.reason = res.reason || 'unavailable';
      return { ok: false, reason: this.reason, status: res.status };
    } catch {
      return { ok: false, reason: 'unavailable', status: 0 };
    }
  }

  isMine(entry, pilotName) {
    if (this.myIds.has(entry.id)) return true;
    const callsign = sanitizeCallsign(pilotName);
    return !!callsign && entry.name === callsign;
  }
}

export function normalizeTab(tab) {
  return BOARD_TABS.includes(tab) ? tab : 'global';
}

function localRows(local, newLocalId) {
  return (Array.isArray(local) ? local : []).map((entry, idx) => ({
    key: entry.id || 'local-' + idx,
    rank: idx + 1,
    name: entry.name,
    meta: `W${entry.wave} · x${Number(entry.multiplier).toFixed(1)} · ${entry.timeStr}`,
    score: Number(entry.score) || 0,
    mine: false,
    isNew: !!newLocalId && entry.id === newLocalId
  }));
}

// Local runs of one mode (entries saved before modes existed are NORMAL runs).
export function localRunsOf(local, mode = DEFAULT_MODE) {
  return (Array.isArray(local) ? local : []).filter(entry => normalizeMode(entry?.mode) === mode);
}

// Pure view model for one board panel: which rows to draw, the note under the tabs, the mode switch and
// the version selector options (only for a reachable GLOBAL board).
//   board: a GlobalLeaderboard (or { status, reason, entries, isMine, version, mode, current, versions })
//   local: progression highscores of every mode (filtered to the board's mode); newGlobalId/newLocalId:
//   the run just finished (highlighted NEW).
export function buildBoardView({ tab, board, local, pilotName = '', newGlobalId = null, newLocalId = null }) {
  const active = normalizeTab(tab);
  const mode = normalizeMode(board?.mode);
  const modes = buildModeOptions(mode);
  const modeTag = mode === DEFAULT_MODE ? '' : MODES[mode].label;
  const mine = localRows(localRunsOf(local, mode), newLocalId);
  if (active === 'local') {
    return { tab: 'local', source: 'local', note: `THIS DEVICE // YOUR TOP 8${modeTag ? ` ${modeTag}` : ''} RUNS`, rows: mine, mode, modes, versions: [] };
  }
  const status = board?.status || 'offline';
  if (status === 'offline') {
    return { tab: 'global', source: 'local', offline: true, note: OFFLINE_NOTES[board?.reason] || OFFLINE_NOTES.offline, rows: mine, mode, modes, versions: [] };
  }
  const current = board.current || GAME_VERSION;
  const boardVersion = normalizeBoardVersion(board.version, current);
  const allTime = boardVersion === ALL_TIME;
  const entries = status === 'ready' || board.entries?.length ? board.entries || [] : [];
  const rows = entries.map((entry, idx) => {
    const mine = typeof board.isMine === 'function' ? board.isMine(entry, pilotName) : false;
    const stats = `W${entry.wave} · LV${entry.level} · ${formatRunTime(entry.time)}`;
    const date = typeof entry.date === 'string' ? entry.date.slice(0, 10) : '';
    return {
      key: entry.id || 'global-' + idx,
      rank: idx + 1,
      name: entry.name,
      // The all-time board mixes versions, so each row says which one it was flown on ("pre-0.9" if unknown).
      // The tag takes the room of LV and time there (still in the row's tooltip), so callsigns stay readable.
      meta: allTime ? `W${entry.wave}` : stats,
      version: allTime ? versionLabel(entry.version) : '',
      score: Number(entry.score) || 0,
      date: allTime ? [date, stats].filter(Boolean).join(' · ') : date,
      mine,
      isNew: !!newGlobalId && entry.id === newGlobalId
    };
  });
  const scope = (modeTag ? `${modeTag} // ` : '') + (allTime ? 'ALL-TIME' : versionLabel(boardVersion));
  let note = `TOP 50 // ${scope}`;
  if (status !== 'ready') note = 'SYNCING GLOBAL BOARD…';
  else if (!rows.length) note = allTime && !modeTag ? 'NO GLOBAL RUNS YET // BE THE FIRST' : `NO ${scope} RUNS YET // BE THE FIRST`;
  const versions = buildVersionOptions({ current, versions: board.versions, selected: boardVersion });
  return { tab: 'global', source: 'global', note, rows, board: boardVersion, mode, modes, versions };
}

// Game-over line for the submit state: { text, tone } where tone is gold | cyan | dim | danger.
export function describeSubmit(state) {
  if (!state) return { text: '', tone: 'dim' };
  if (state.pending) return { text: '◎ UPLINKING RUN TO GLOBAL BOARD…', tone: 'cyan' };
  if (state.reason === 'optout') return { text: 'GLOBAL POSTING OFF // RUN SAVED LOCALLY', tone: 'dim' };
  if (state.reason === 'tainted') return { text: 'DEV TUNER USED // RUN NOT SENT TO GLOBAL BOARD', tone: 'dim' };
  if (state.reason === 'skipped') return { text: 'NO SCORE // NOTHING TO UPLINK', tone: 'dim' };
  if (state.ok) {
    const censor = state.censored ? ' // CALLSIGN FILTERED' : '';
    // A HARDCORE or BLITZ run ranks on its own mode's boards, and the version tag says which.
    const mode = normalizeMode(state.mode);
    const version = [mode === DEFAULT_MODE ? '' : MODES[mode].label, isVersionString(state.version) ? versionLabel(state.version) : '']
      .filter(Boolean).join(' · ');
    // The headline rank is on the shared all-time board; the run's version rides along beside it.
    const rank = state.allTimeRank === undefined ? state.rank : state.allTimeRank;
    if (rank) return { text: `◎ GLOBAL RANK #${rank}${version ? ` · ${version}` : ''}${censor}`, tone: 'gold' };
    if (state.rank && version) return { text: `◎ #${state.rank} ON ${version} // OUTSIDE ALL-TIME TOP ${state.boardSize || 100}${censor}`, tone: 'cyan' };
    return { text: `OUTSIDE GLOBAL TOP ${state.boardSize || 100} // KEEP FLYING${censor}`, tone: 'cyan' };
  }
  if (state.reason === 'cooldown') return { text: 'GLOBAL UPLINK COOLING DOWN // RUN SAVED LOCALLY', tone: 'dim' };
  if (state.reason === 'outdated') return { text: 'OUTDATED GAME VERSION // RELOAD TO RANK GLOBALLY', tone: 'danger' };
  if (state.reason === 'rejected') return { text: 'GLOBAL BOARD REJECTED THIS RUN // SAVED LOCALLY', tone: 'danger' };
  return { text: 'OFFLINE // RUN SAVED LOCALLY', tone: 'dim' };
}

// Marks the active tab on a set of tab buttons ([data-board-tab]).
export function syncTabButtons(buttons, tab) {
  const active = normalizeTab(tab);
  for (const btn of buttons) {
    const on = btn.dataset?.boardTab === active;
    btn.classList?.toggle('active', on);
    btn.setAttribute?.('aria-selected', on ? 'true' : 'false');
  }
}

// Draws the version selector (buttons with data-board-version, so the controller MenuNavigator reaches
// them) into its container. Buttons are only rebuilt when the set of versions changes, so a focused
// button survives re-renders; otherwise just the active marks move.
export function renderVersionOptions(container, options) {
  if (!container) return;
  container.classList.toggle('hidden', !options.length);
  const signature = options.map(o => o.id).join('|');
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    const doc = container.ownerDocument;
    const label = doc.createElement('span');
    label.className = 'board-ver-label';
    label.textContent = 'VERSION';
    const buttons = options.map((o) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'board-ver' + (o.id === ALL_TIME ? ' all-time' : '');
      btn.dataset.boardVersion = o.id;
      btn.textContent = o.label;
      btn.title = o.id === ALL_TIME ? 'Every run of every version' : o.current ? 'The version you are playing' : `Runs flown on ${o.label}`;
      return btn;
    });
    container.replaceChildren(label, ...buttons);
  }
  for (const btn of container.querySelectorAll('[data-board-version]')) {
    const option = options.find(o => o.id === btn.dataset.boardVersion);
    btn.classList.toggle('active', !!option?.active);
    btn.classList.toggle('current', !!option?.current);
    btn.setAttribute('aria-pressed', option?.active ? 'true' : 'false');
  }
}

// Draws the mode switch (buttons with data-board-mode, reachable by the controller MenuNavigator) into its
// container: built once, then only the active mark moves, so a focused button survives re-renders.
export function renderModeOptions(container, options) {
  if (!container) return;
  container.classList.toggle('hidden', !options.length);
  if (!container.dataset.built) {
    container.dataset.built = '1';
    const doc = container.ownerDocument;
    const label = doc.createElement('span');
    label.className = 'board-ver-label';
    label.textContent = 'MODE';
    const buttons = options.map((o) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = `board-ver board-mode mode-${o.id}`;
      btn.dataset.boardMode = o.id;
      btn.textContent = o.label;
      btn.title = `${MODES[o.id].label} runs: ${MODES[o.id].tagline.toLowerCase()}`;
      return btn;
    });
    container.replaceChildren(label, ...buttons);
  }
  for (const btn of container.querySelectorAll('[data-board-mode]')) {
    const on = !!options.find(o => o.id === btn.dataset.boardMode)?.active;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// Draws a view into a list element and its note element (DOM only; logic is in buildBoardView).
export function renderBoardView(listEl, noteEl, view) {
  if (noteEl) {
    noteEl.textContent = view.note;
    noteEl.classList.toggle('offline', !!view.offline);
  }
  if (!listEl) return;
  const doc = listEl.ownerDocument;
  listEl.replaceChildren();
  if (!view.rows.length) {
    const empty = doc.createElement('div');
    empty.className = 'hs-empty';
    empty.textContent = view.source === 'global' && view.note.startsWith('SYNCING') ? '· · ·' : 'NO RUNS YET';
    listEl.appendChild(empty);
    return;
  }
  let newEl = null;
  for (const row of view.rows) {
    const el = doc.createElement('div');
    el.className = 'hs-row' + (row.isNew ? ' hs-current' : '') + (row.mine ? ' hs-mine' : '');
    if (row.date) el.title = row.date;
    const cell = (cls, text) => {
      const span = doc.createElement('span');
      span.className = cls;
      span.textContent = text;
      el.appendChild(span);
      return span;
    };
    cell('hs-rank', `#${row.rank}`);
    cell('hs-name', row.name + (row.isNew ? ' ★ NEW' : row.mine ? ' ◆' : ''));
    const meta = cell('hs-meta', row.meta);
    if (row.version) {
      const tag = doc.createElement('span');
      tag.className = 'hs-ver' + (row.version.startsWith('pre-') ? ' legacy' : '');
      tag.textContent = row.version;
      meta.prepend(tag);
    }
    cell('hs-score', row.score.toLocaleString());
    listEl.appendChild(el);
    if (row.isNew) newEl = { el, key: row.key };
  }
  // Centre the run just finished once (not on every re-render, so manual scrolling sticks).
  if (newEl && listEl.dataset.scrolledTo !== newEl.key && listEl.clientHeight > 0) {
    listEl.dataset.scrolledTo = newEl.key;
    listEl.scrollTop = Math.max(0, newEl.el.offsetTop - (listEl.clientHeight - newEl.el.offsetHeight) / 2);
  }
}
