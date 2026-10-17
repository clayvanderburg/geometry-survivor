// Global leaderboard client: fetches/submits runs at /api/scores (a Netlify Function) and builds the
// title and game-over board views. Every network path has a timeout and resolves to a status object;
// nothing here throws or blocks play. Without the function (local dev server, offline, slow network)
// the GLOBAL tab falls back to the local board with an OFFLINE note.
import { sanitizeCallsign, formatRunTime } from './leaderboard-rules.js';

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
// can't fail on a name the title screen happily accepted.
export function buildRunPayload({ name, score, wave, level, kills, multiplier, time }) {
  const int = (v, min) => Math.max(min, Math.floor(Number(v) || 0));
  return {
    name: sanitizeCallsign(name) || FALLBACK_NAME,
    score: int(score, 0),
    wave: int(wave, 1),
    level: int(level, 1),
    kills: int(kills, 0),
    multiplier: Math.max(1, Math.round((Number(multiplier) || 1) * 10) / 10),
    time: Math.max(0, Math.round((Number(time) || 0) * 100) / 100)
  };
}

export class GlobalLeaderboard {
  constructor({ endpoint = SCORES_ENDPOINT, fetchImpl, timeoutMs = 4500, storage = defaultStorage() } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl !== undefined ? fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.timeoutMs = timeoutMs;
    this.storage = storage;
    this.status = 'idle'; // idle | loading | ready | offline
    this.reason = '';
    this.entries = [];
    this.total = 0;
    this.boardSize = 100;
    this.myIds = this.loadMyIds();
    this.inflight = null;
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

  adopt(data) {
    this.entries = cleanEntries(data?.entries);
    this.total = Number(data?.total) || this.entries.length;
    if (Number(data?.boardSize) > 0) this.boardSize = Number(data.boardSize);
    this.status = 'ready';
    this.reason = '';
  }

  // Loads the top 50. Concurrent calls share one request. Resolves to this (never rejects).
  refresh() {
    if (this.inflight) return this.inflight;
    if (this.status !== 'ready') this.status = 'loading';
    this.inflight = requestJson(this.fetchImpl, this.endpoint, { timeoutMs: this.timeoutMs }).then((res) => {
      if (res.ok) this.adopt(res.data);
      else {
        this.status = 'offline';
        this.reason = res.reason === 'http' ? 'unavailable' : res.reason;
      }
      return this;
    }).catch(() => {
      this.status = 'offline';
      this.reason = 'unavailable';
      return this;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  // Submits one run. Resolves { ok, rank, onBoard, id, name, censored } or { ok: false, reason, status, error }.
  async submit(run) {
    const payload = buildRunPayload(run);
    if (payload.score < 1) return { ok: false, reason: 'skipped' };
    try {
      const res = await requestJson(this.fetchImpl, this.endpoint, { method: 'POST', body: payload, timeoutMs: this.timeoutMs + 1500 });
      if (res.ok && res.data?.accepted) {
        this.rememberId(res.data.id);
        this.adopt(res.data);
        return {
          ok: true,
          rank: Number.isInteger(res.data.rank) ? res.data.rank : null,
          onBoard: !!res.data.onBoard,
          id: res.data.id,
          name: res.data.name,
          censored: !!res.data.censored,
          boardSize: this.boardSize
        };
      }
      if (res.reason === 'http') {
        const reason = res.status === 429 ? 'cooldown' : res.status >= 500 ? 'unavailable' : 'rejected';
        return { ok: false, reason, status: res.status, error: typeof res.data?.error === 'string' ? res.data.error : '' };
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

// Pure view model for one board panel: which rows to draw and what note to show under the tabs.
//   board: a GlobalLeaderboard (or { status, reason, entries, isMine })
//   local: progression highscores; newGlobalId/newLocalId: the run just finished (highlighted NEW).
export function buildBoardView({ tab, board, local, pilotName = '', newGlobalId = null, newLocalId = null }) {
  const active = normalizeTab(tab);
  if (active === 'local') {
    return { tab: 'local', source: 'local', note: 'THIS DEVICE // YOUR TOP 8 RUNS', rows: localRows(local, newLocalId) };
  }
  const status = board?.status || 'offline';
  if (status === 'offline') {
    return { tab: 'global', source: 'local', offline: true, note: OFFLINE_NOTES[board?.reason] || OFFLINE_NOTES.offline, rows: localRows(local, newLocalId) };
  }
  const entries = status === 'ready' || board.entries?.length ? board.entries || [] : [];
  const rows = entries.map((entry, idx) => {
    const mine = typeof board.isMine === 'function' ? board.isMine(entry, pilotName) : false;
    return {
      key: entry.id || 'global-' + idx,
      rank: idx + 1,
      name: entry.name,
      meta: `W${entry.wave} · LV${entry.level} · ${formatRunTime(entry.time)}`,
      score: Number(entry.score) || 0,
      date: typeof entry.date === 'string' ? entry.date.slice(0, 10) : '',
      mine,
      isNew: !!newGlobalId && entry.id === newGlobalId
    };
  });
  let note = 'ALL PILOTS // TOP 50';
  if (status !== 'ready') note = 'SYNCING GLOBAL BOARD…';
  else if (!rows.length) note = 'NO GLOBAL RUNS YET // BE THE FIRST';
  return { tab: 'global', source: 'global', note, rows };
}

// Game-over line for the submit state: { text, tone } where tone is gold | cyan | dim | danger.
export function describeSubmit(state) {
  if (!state) return { text: '', tone: 'dim' };
  if (state.pending) return { text: '◎ UPLINKING RUN TO GLOBAL BOARD…', tone: 'cyan' };
  if (state.reason === 'tainted') return { text: 'DEV TUNER USED // RUN NOT SENT TO GLOBAL BOARD', tone: 'dim' };
  if (state.reason === 'skipped') return { text: 'NO SCORE // NOTHING TO UPLINK', tone: 'dim' };
  if (state.ok) {
    const censor = state.censored ? ' // CALLSIGN FILTERED' : '';
    return state.rank
      ? { text: `◎ GLOBAL RANK #${state.rank}${censor}`, tone: 'gold' }
      : { text: `OUTSIDE GLOBAL TOP ${state.boardSize || 100} // KEEP FLYING${censor}`, tone: 'cyan' };
  }
  if (state.reason === 'cooldown') return { text: 'GLOBAL UPLINK COOLING DOWN // RUN SAVED LOCALLY', tone: 'dim' };
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
    };
    cell('hs-rank', `#${row.rank}`);
    cell('hs-name', row.name + (row.isNew ? ' ★ NEW' : row.mine ? ' ◆' : ''));
    cell('hs-meta', row.meta);
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
