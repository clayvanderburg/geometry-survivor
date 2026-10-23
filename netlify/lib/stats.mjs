// Anonymous gameplay statistics behind /api/stats (see netlify/functions/stats.mjs).
// Storage-agnostic like ../lib/leaderboard.mjs, so tests drive it with an in-memory store: anything with
// get / getWithMetadata(key, { type: 'json' }), setJSON(key, value, { onlyIfNew | onlyIfMatch }) and
// list({ prefix, paginate, directories }), which is the @netlify/blobs Store API.
//
// Layout of the "stats" store:
//   runs/<version>/<yyyy-mm-dd>/<random id>.json   one blob per run: never rewritten, so no write conflicts
//   summary/<version|all>[~<armory tier>].json     cached aggregate, recomputed when older than CACHE_MS
//   ratelimit/<salted ip hash>                     { t } of the last upload from that client
// No callsign and no IP is stored: the rate limit keys on a salted SHA-256 of the IP (same as /api/scores).
//
//   POST /api/stats                      one run summary (js/run-stats.js) -> 201 { accepted: true }
//                                        or 400 / 413 / 415 / 422 / 429
//   GET  /api/stats/summary?version=v|all[&armory=none|partial|maxed|unknown]
//                                        the aggregate (js/stats-aggregate.js) of the newest runs, optionally
//                                        only those flown with one Void Armory tier (js/stats-rules.js)
import { randomUUID } from 'node:crypto';
import { KNOWN_VERSIONS } from '../../js/changelog.js';
import { GAME_VERSION, compareVersions } from '../../js/version.js';
import { sanitizeRunStats, STATS_LIMITS, ARMORY_TIERS } from '../../js/stats-rules.js';
import { aggregateRuns } from '../../js/stats-aggregate.js';
import { clientIp, hashIp, writeConditions } from './leaderboard.mjs';

export const STATS_STORE = 'stats';
export const RUNS_PREFIX = 'runs/';
export const SUMMARY_PREFIX = 'summary/';
export const STATS_RATE_PREFIX = 'ratelimit/';
export const ALL = 'all';

export const STATS_SERVER_LIMITS = Object.freeze({
  MAX_BODY_BYTES: STATS_LIMITS.MAX_BODY_BYTES,
  COOLDOWN_MS: 15_000,          // one upload per client every 15 s (a run is at least 20 s long)
  CACHE_MS: 10 * 60_000,        // the aggregate is recomputed when older than this
  MAX_RUNS_SCANNED: 1500,       // newest runs read per recompute
  MAX_KEYS_LISTED: 20_000,      // list() pages are followed until this many keys
  FETCH_CONCURRENCY: 24,
  WRITE_ATTEMPTS: 3
});

const VERSION_KEY = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

// ?armory= for the summary: one Armory tier, or none given (every run). Returns { armory } or { error }.
export function summaryArmory(value) {
  if (value === null || value === undefined || value === '' || value === ALL) return { armory: null };
  if (ARMORY_TIERS.includes(value)) return { armory: value };
  return { error: `unknown armory tier: use ${ARMORY_TIERS.join(', ')} or leave it out` };
}

export const runKey = (version, date, id) => `${RUNS_PREFIX}${version}/${date.toISOString().slice(0, 10)}/${id}.json`;
export const summaryKey = (version, armory = null) => `${SUMMARY_PREFIX}${version}${armory ? `~${armory}` : ''}.json`;
// Bump when the cached summary's shape changes, so stale caches are recomputed (2: armory tiers; 3: the same-time
// index, levelIndex and vsAutocannon).
export const SUMMARY_CACHE_VERSION = 3;
export const runsPrefix = (version) => (version === ALL ? RUNS_PREFIX : `${RUNS_PREFIX}${version}/`);

// ?version= for the summary: a known game version or 'all' (the default). Returns { version } or { error }.
export function summaryVersion(value, versions = KNOWN_VERSIONS) {
  if (value === null || value === undefined || value === '' || value === ALL) return { version: ALL };
  if (versions.includes(value)) return { version: value };
  return { error: 'unknown version: use ?version=all or a known game version' };
}

// Newest first: by date folder, then version, then key (random ids keep ties stable).
export function newestFirst(keys) {
  const parts = (k) => k.slice(RUNS_PREFIX.length).split('/');
  return [...keys].sort((a, b) => {
    const [va, da] = parts(a), [vb, db] = parts(b);
    return String(db).localeCompare(String(da)) || compareVersions(vb, va) || b.localeCompare(a);
  });
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
  });
}

// Every key under `prefix`, following list() pages, stopping after `max` keys. Tolerates a store whose
// list() returns one promise (no pagination) instead of an async iterable of pages.
export async function listKeys(blobs, prefix, max) {
  if (typeof blobs.list !== 'function') return { keys: [], truncated: false };
  const keys = [];
  let truncated = false;
  const take = (page) => {
    for (const b of page?.blobs || []) {
      if (keys.length >= max) { truncated = true; return false; }
      keys.push(b.key);
    }
    return true;
  };
  const listing = blobs.list({ prefix, paginate: true });
  if (listing && typeof listing[Symbol.asyncIterator] === 'function') {
    for await (const page of listing) if (!take(page)) break;
  } else {
    take(await listing);
  }
  return { keys, truncated };
}

// Game versions that have stored runs (from the runs/<version>/ folders), newest first.
export async function versionsWithRuns(blobs) {
  if (typeof blobs.list !== 'function') return [];
  try {
    const listing = await blobs.list({ prefix: RUNS_PREFIX, directories: true });
    const found = (listing?.directories || []).map((d) => String(d).slice(RUNS_PREFIX.length).replace(/\/$/, '')).filter((v) => VERSION_KEY.test(v));
    return [...new Set(found)].sort((a, b) => compareVersions(b, a));
  } catch {
    return [];
  }
}

async function readJson(blobs, key) {
  const result = typeof blobs.getWithMetadata === 'function'
    ? await blobs.getWithMetadata(key, { type: 'json' })
    : { data: await blobs.get(key, { type: 'json' }) };
  return result || null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch { out[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createStatsHandler({
  store,
  now = () => Date.now(),
  salt = 'vexolith-survivor',
  newId = () => randomUUID(),
  limits = STATS_SERVER_LIMITS,
  versions = KNOWN_VERSIONS,
  currentVersion = GAME_VERSION,
  log = console
} = {}) {
  async function claimRateSlot(blobs, ipHash, t) {
    const key = STATS_RATE_PREFIX + ipHash;
    const prev = await readJson(blobs, key);
    const last = Number(prev?.data?.t) || 0;
    if (prev?.data && t - last < limits.COOLDOWN_MS) return Math.ceil((limits.COOLDOWN_MS - (t - last)) / 1000);
    const write = await blobs.setJSON(key, { t }, writeConditions(prev?.data ? prev : null));
    return write?.modified === false ? Math.ceil(limits.COOLDOWN_MS / 1000) : 0;
  }

  async function handlePost(req, context, blobs) {
    const type = req.headers.get('content-type') || '';
    if (!/^application\/json\b/i.test(type)) return json(415, { error: 'content-type must be application/json' });
    const declared = Number(req.headers.get('content-length'));
    if (declared > limits.MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > limits.MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }); }
    const { run, error, status } = sanitizeRunStats(body, versions);
    if (error) return json(status, { error, current: currentVersion });

    const t = now();
    const retryAfter = await claimRateSlot(blobs, hashIp(clientIp(req, context), salt), t);
    if (retryAfter > 0) return json(429, { error: 'slow down', retryAfter }, { 'retry-after': String(retryAfter) });

    const date = new Date(t);
    for (let attempt = 0; attempt < limits.WRITE_ATTEMPTS; attempt++) {
      const key = runKey(run.version, date, newId());
      const write = await blobs.setJSON(key, { ...run, received: date.toISOString() }, { onlyIfNew: true });
      if (write?.modified !== false) return json(201, { accepted: true, version: run.version });
    }
    return json(503, { error: 'stats store busy' }, { 'retry-after': '5' });
  }

  async function computeSummary(blobs, version, armory) {
    const { keys, truncated } = await listKeys(blobs, runsPrefix(version), limits.MAX_KEYS_LISTED);
    const chosen = newestFirst(keys.filter((k) => k.endsWith('.json'))).slice(0, limits.MAX_RUNS_SCANNED);
    const runs = (await mapLimit(chosen, limits.FETCH_CONCURRENCY, async (key) => (await readJson(blobs, key))?.data))
      .filter((r) => r && typeof r === 'object');
    const t = now();
    return {
      ...aggregateRuns(runs, { version, source: 'players', generatedAt: new Date(t).toISOString(), armory }),
      computedAt: t,
      stored: keys.length,
      scanned: chosen.length,
      truncated: truncated || keys.length > chosen.length
    };
  }

  async function handleSummary(req, blobs) {
    const params = new URL(req.url).searchParams;
    const { version, error } = summaryVersion(params.get('version'), versions);
    if (error) return json(400, { error, current: currentVersion });
    const { armory, error: armoryError } = summaryArmory(params.get('armory'));
    if (armoryError) return json(400, { error: armoryError, current: currentVersion });
    const key = summaryKey(version, armory);
    const cached = await readJson(blobs, key);
    let summary = cached?.data;
    const fresh = summary && Number.isFinite(summary.computedAt) && now() - summary.computedAt < limits.CACHE_MS && summary.schemaVersion === SUMMARY_CACHE_VERSION;
    if (!fresh) {
      summary = { ...(await computeSummary(blobs, version, armory)), schemaVersion: SUMMARY_CACHE_VERSION };
      // Last writer wins: concurrent recomputes produce the same aggregate.
      try { await blobs.setJSON(key, summary); } catch (err) { log?.warn?.('[stats] summary cache write failed', err); }
    }
    const withRuns = await versionsWithRuns(blobs);
    return json(200, { ...summary, cached: !!fresh, current: currentVersion, versions: withRuns, knownVersions: versions });
  }

  return async function handler(req, context) {
    try {
      const path = new URL(req.url).pathname.replace(/\/+$/, '');
      if (path.endsWith('/summary')) {
        if (req.method === 'GET' || req.method === 'HEAD') return await handleSummary(req, store(context));
        return json(405, { error: 'method not allowed' }, { allow: 'GET, HEAD' });
      }
      if (req.method === 'POST') return await handlePost(req, context, store(context));
      return json(405, { error: 'method not allowed' }, { allow: 'POST' });
    } catch (err) {
      log?.error?.('[stats]', err);
      return json(500, { error: 'stats unavailable' });
    }
  };
}
