// Anonymous run-stats upload (POST /api/stats) and the SHARE ANONYMOUS STATS setting. Fire-and-forget:
// every path has a timeout and resolves to a status, nothing throws or blocks the game-over screen.
// Skipped: opted-out players, dev-tuner runs (not comparable) and runs under 20 s (js/stats-rules.js).
import { requestJson } from './leaderboard.js';
import { statsSkipReason, fitPayload } from './stats-rules.js';

export const STATS_ENDPOINT = '/api/stats';
export const SHARE_STATS_KEY = 'vexolith_share_stats';
// Posting runs to the public GLOBAL leaderboard: also on unless the player unchecked it ('0').
export const POST_GLOBAL_KEY = 'vexolith_post_global';

export function defaultStatsStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// Sharing is on unless the player turned it off ('0'). Blocked storage reads as the default.
export function readShareStats(storage) {
  try { return storage?.getItem(SHARE_STATS_KEY) !== '0'; } catch { return true; }
}

export function readPostGlobal(storage) {
  try { return storage?.getItem(POST_GLOBAL_KEY) !== '0'; } catch { return true; }
}

export function writePostGlobal(storage, on) {
  try {
    if (!storage) return false;
    storage.setItem(POST_GLOBAL_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export function writeShareStats(storage, on) {
  try {
    if (!storage) return false;
    storage.setItem(SHARE_STATS_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// Resolves { ok: true } or { ok: false, reason } where reason is optout | tainted | short (not sent)
// or offline | timeout | unavailable | cooldown | rejected (sent, did not land).
export async function uploadRunStats(summary, { share = true, tainted = false, fetchImpl, timeoutMs = 5000, endpoint = STATS_ENDPOINT } = {}) {
  const skip = statsSkipReason({ share, tainted, time: summary?.time });
  if (skip) return { ok: false, reason: skip };
  const impl = fetchImpl !== undefined ? fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  try {
    const res = await requestJson(impl, endpoint, { method: 'POST', body: fitPayload(summary), timeoutMs });
    if (res.ok && res.data?.accepted) return { ok: true };
    if (res.reason === 'http') return { ok: false, reason: res.status === 429 ? 'cooldown' : res.status >= 500 ? 'unavailable' : 'rejected', status: res.status };
    return { ok: false, reason: res.reason || 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

// One short line for the RUN REPORT: what happened to this run's anonymous stats.
export function describeStatsUpload(state) {
  if (!state) return '';
  if (state.pending) return 'SENDING ANONYMOUS STATS…';
  if (state.ok) return 'ANONYMOUS STATS SENT // THANKS, PILOT';
  switch (state.reason) {
    case 'optout': return 'ANONYMOUS STATS OFF (TITLE CHECKBOX OR PAUSE MENU)';
    case 'tainted': return 'DEV TUNER USED // STATS NOT SENT';
    case 'short': return 'SHORT RUN // STATS NOT SENT';
    case 'cooldown': return 'STATS UPLINK COOLING DOWN';
    case 'rejected': return 'STATS NOT ACCEPTED';
    default: return 'OFFLINE // STATS NOT SENT';
  }
}
