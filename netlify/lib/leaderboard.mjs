// Global leaderboard logic behind /api/scores (see netlify/functions/scores.mjs).
// Storage-agnostic so tests can drive it with an in-memory store: anything with
// getWithMetadata(key, { type: 'json' }), setJSON(key, value, { onlyIfMatch | onlyIfNew }) and
// (optionally) list({ prefix }), which is the @netlify/blobs Store API.
//
// Boards are JSON blobs ({ version, updated, entries }) holding the top BOARD_SIZE runs:
//   board-v1@<game version>  one per game version (from VERSIONED_SINCE on), so a balance patch starts
//                            a fresh race and old high scores can't crowd it out;
//   board-v1                 the all-time board: every run of every version, each entry tagged with its
//                            version. Runs from before versioning have no version ("pre-0.9").
// Those are the NORMAL boards. HARDCORE and BLITZ runs (js/modes.js) race on their own pair of boards,
// the same keys with the mode's suffix: board-v1-hc / board-v1-hc@<version>, board-v1-blitz /
// board-v1-blitz@<version>. A run without a `mode` (older clients) is NORMAL.
// A run is written to its version's board and to the all-time board. Writes are compare-and-swap on the
// blob's ETag and retried on conflict (full-jitter backoff), so runs submitted at the same moment all land;
// a run that still can't get in after WRITE_ATTEMPTS answers 503 and frees its cooldown slot, so the game's
// quiet retry gets through. A run may carry a client `nonce`: its id is derived from it, so a retried
// submission replaces itself instead of landing twice. Rate limiting keeps one small blob per hashed client
// IP per RATE_BUCKET_MS window (ratelimit/<bucket>/<hash>): only the current and previous windows are ever
// read, and each function instance sweeps older windows once per window.
// GET answers are cached on Netlify's CDN for a few seconds (GET_CDN_CACHE); every board carries `updated`
// (its last write), so the game ignores a cached board older than one it already holds, and the POST
// answer returns every board the run landed on, so a pilot's own run shows at once.
//
// Anti-cheat is deliberately "not trivially broken", not secure: the browser reports its own score,
// so anyone who reads this file can submit a believable fake run. See README "Global leaderboard".
import { createHash, randomUUID } from 'node:crypto';
import { createRateLimiter, writeConditions } from './rate-limit.mjs';

export { writeConditions };
import { NAME_PATTERN, sanitizeCallsign, ALL_TIME, BOARD_VERSIONS } from '../../js/leaderboard-rules.js';
import { GAME_VERSION, compareVersions } from '../../js/version.js';
import { MODE_IDS, DEFAULT_MODE, isMode, modeWaveLength } from '../../js/modes.js';
import { CAMPAIGN_WAVES } from '../../js/wave-plan.js';
import { waveBonusTotal, VICTORY_BONUS } from '../../js/score-bonus.js';

export const STORE_NAME = 'leaderboard';
export const BOARD_KEY = 'board-v1'; // all-time board (it predates versioning, so its old runs have no version)
export const VERSION_BOARD_PREFIX = 'board-v1@';
export const RATE_PREFIX = 'ratelimit/';
export const MIGRATION_PREFIX = 'migrations/';

// GET answers on Netlify's CDN: fresh for 15 s, then served stale for up to 30 s more while one request
// refreshes it. Browsers never cache them (cache-control), and each ?version / ?mode is its own entry.
export const GET_CDN_CACHE = 'public, s-maxage=15, stale-while-revalidate=30';
export const GET_CACHE_HEADERS = Object.freeze({
  'cache-control': 'public, max-age=0, must-revalidate',
  'netlify-cdn-cache-control': GET_CDN_CACHE,
  'netlify-vary': 'query=version|mode'
});

// A client nonce: random, 16-64 URL-safe characters. Anything else is ignored (the run gets a fresh id).
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
// Entry id for a nonce: a hash, so the public id never reveals the nonce that could replace the entry.
export const nonceId = (nonce) => 'r' + createHash('sha256').update(`run:${nonce}`).digest('hex').slice(0, 24);

// Rate-limit window of a time, and the blob key of one client in it.
export const rateBucket = (t, limits = LIMITS) => Math.floor(t / limits.RATE_BUCKET_MS);
export const rateKey = (bucket, ipHash) => `${RATE_PREFIX}${bucket}/${ipHash}`;

// One-time board cleanups. Each runs once per store: the first /api/scores request after it deploys
// removes every matching entry from every board (all-time and per version), then writes a marker blob
// so it never runs again. A purge matches by callsign (`names`), by one run's fingerprint (`version`,
// `wave`, `minScore`..`maxScore`) and/or by every run flown before a version (`beforeVersion`, including
// runs with no version); every field given must match. Later runs are kept.
export const PURGES = Object.freeze([
  // The developer's test runs, cleared for a fresh start with the rebuilt Void Armory.
  { id: 'purge-madking-nox-v1', names: ['MADKING', 'NOX'] },
  // The developer's ~87M wave-36 run on 0.16.0 (from before the v0.17 weapon rework), removed on request.
  { id: 'purge-dev-87m-v0160-v1', version: '0.16.0', wave: 36, minScore: 80e6, maxScore: 95e6 },
  // Fresh start for v0.31.0 (second harder pass): every board of every mode, all-time included.
  { id: 'wipe-before-v0310', beforeVersion: '0.31.0' },
  // The developer's test runs again (v0.33.0), with their Void Cores and armory reset on the device.
  { id: 'purge-madking-nox-v2', names: ['MADKING', 'NOX'] }
]);

// Does a board entry match a purge rule?
export function purgeMatches(purge, e) {
  if (purge.names && !purge.names.map((n) => sanitizeCallsign(n)).includes(sanitizeCallsign(e.name))) return false;
  if (purge.version !== undefined && e.version !== purge.version) return false;
  if (purge.wave !== undefined && e.wave !== purge.wave) return false;
  if (purge.minScore !== undefined && !(e.score >= purge.minScore)) return false;
  if (purge.maxScore !== undefined && !(e.score <= purge.maxScore)) return false;
  if (purge.beforeVersion !== undefined && typeof e.version === 'string' && compareVersions(e.version, purge.beforeVersion) >= 0) return false;
  return true;
}

// Board key suffix per game mode. NORMAL has none, so its keys never change.
export const MODE_BOARD_SUFFIX = Object.freeze({ normal: '', hardcore: '-hc', blitz: '-blitz' });

// Prefix of a mode's per-version boards: board-v1@, board-v1-hc@, board-v1-blitz@.
export function versionBoardPrefix(mode = DEFAULT_MODE) {
  return `${BOARD_KEY}${MODE_BOARD_SUFFIX[mode]}@`;
}

// Blob key of a board: 'all' -> the all-time board, '0.9.0' -> board-v1@0.9.0; in HARDCORE board-v1-hc
// and board-v1-hc@0.9.0, in BLITZ board-v1-blitz and board-v1-blitz@0.9.0.
export function boardKey(version, mode = DEFAULT_MODE) {
  return version === ALL_TIME ? BOARD_KEY + MODE_BOARD_SUFFIX[mode] : versionBoardPrefix(mode) + version;
}

export const LIMITS = Object.freeze({
  BOARD_SIZE: 100,       // runs kept in the blob
  PUBLIC_SIZE: 100,      // runs returned by GET and POST: the whole board (the GLOBAL list scrolls)
  MAX_PER_NAME: 5,       // one callsign can't flood the board
  COOLDOWN_MS: 20_000,   // per-IP gap between submissions
  MAX_BODY_BYTES: 2048,
  WRITE_ATTEMPTS: 10,
  BACKOFF_BASE_MS: 30,   // compare-and-swap retry pause: random 0..min(cap, base * 2^attempt) ("full jitter")
  BACKOFF_CAP_MS: 600,
  RATE_BUCKET_MS: 10 * 60_000, // rate-limit blobs are keyed by this window; older windows are swept
  SWEEP_MAX_DELETES: 500 // per sweep, so one request never spends long cleaning up
});

// Hard field ranges: anything outside is malformed, not merely implausible.
const FIELDS = {
  score: { min: 1, max: 1e13, int: true },
  wave: { min: 1, max: 2000, int: true },
  level: { min: 1, max: 5000, int: true },
  kills: { min: 0, max: 1e8, int: true },
  multiplier: { min: 1, max: 1e6, int: false },
  time: { min: 1, max: 6 * 3600, int: false } // seconds survived
};

// Plausibility envelope. Re-checked for the 50-wave campaign, ENDLESS and the progress bonuses (2026-10-20):
// 30-minute god-mode expert sim runs into ENDLESS (W66-72, 17-30k kills, 273-305M, the FINAL STAND holding
// wave 50 for minutes) and the live board's best (W48, 28.2k kills, 1.13B in 1055 s) all sit 60x+ under the
// score bound, under 30 kills/s and far under the level bound, so the coefficients stay; what changed is
// the wave check (wave 50+ may lag the clock) and the flat bonuses added to the score bound (maxScoreFor).
// Originally fitted to the headless balance sim (tools/balance-sim.mjs --god --skill expert
// --meta 8, 15-minute cap): the best run reached wave 41, level 78, 19.8k kills and 2.05 billion points
// in 894 s (score/t^2.5 ~ 86, score/kills^2 ~ 5.2, ~23 kills/s, ~5 levels/min), then widened 3-10x.
// Waves tick every 22 s of play (main.js), or every waveLength seconds of the run's mode overlay (BLITZ:
// js/modes.js). Score grows faster than linearly because every pickup raises the multiplier that later
// kills are paid with, so the score bounds are polynomial.
export const PLAUSIBILITY = Object.freeze({
  WAVE_SECONDS: 22,
  WAVE_SLACK: 1,
  KILLS_PER_SECOND: 60,
  KILLS_SLACK: 100,
  LEVEL_BASE: 10,
  LEVELS_PER_SECOND: 0.25,
  SCORE_TIME_COEF: 600,   // score <= 600 * t^2.5 ...
  SCORE_KILL_COEF: 60,    // ... and <= 60 * (kills + 20)^2 ...
  SCORE_SLACK: 50_000,    // ... plus a flat allowance for very short runs
  MULT_PER_KILL: 8
});

// Combat score is bounded by time and kills; the progress bonuses (js/score-bonus.js) are flat and known from
// the wave alone, so they are added on top: every wave below the run's own, plus the VICTORY bonus once the
// run is past the campaign (a won run's results show its last wave, 50 or more).
export function maxScoreFor(time, kills, wave = 0) {
  const P = PLAUSIBILITY;
  const bonus = waveBonusTotal(wave) + (wave >= CAMPAIGN_WAVES ? VICTORY_BONUS : 0);
  return Math.min(P.SCORE_TIME_COEF * time ** 2.5, P.SCORE_KILL_COEF * (kills + 20) ** 2) + P.SCORE_SLACK + bonus;
}

// Returns null when the run looks like something the game can produce, else a short reason.
export function checkPlausibility(run, mode = DEFAULT_MODE) {
  const P = PLAUSIBILITY;
  const waveLength = modeWaveLength(mode, P.WAVE_SECONDS);
  const expectedWave = 1 + Math.floor(run.time / waveLength);
  // Wave 50 (the FINAL STAND, js/final-stand.js) has no timer, so from there on a run's wave may lag its
  // time by however long the stand took; it can never run ahead.
  const lateWave = run.wave >= CAMPAIGN_WAVES && run.time >= (CAMPAIGN_WAVES - 1 - P.WAVE_SLACK) * waveLength;
  if (lateWave ? run.wave > expectedWave + P.WAVE_SLACK : Math.abs(run.wave - expectedWave) > P.WAVE_SLACK) return 'wave does not match time survived';
  if (run.kills > P.KILLS_PER_SECOND * run.time + P.KILLS_SLACK) return 'too many kills for time survived';
  if (run.level > P.LEVEL_BASE + P.LEVELS_PER_SECOND * run.time) return 'level too high for time survived';
  if (run.multiplier > 1 + P.MULT_PER_KILL * run.kills) return 'multiplier too high for kills';
  if (run.score > maxScoreFor(run.time, run.kills, run.wave)) return 'score too high for time survived and kills';
  return null;
}

// --- Callsign filter -------------------------------------------------------------------------------
// Small on purpose. SUBSTRINGS are caught anywhere once spaces/punctuation and leetspeak are removed;
// TOKENS only as whole words (or the whole name), so COCKPIT, GRAPE, SPICE and CLASSIC stay legal.
const SUBSTRINGS = [
  'FUCK', 'FUK', 'FCUK', 'SHIT', 'CUNT', 'NIGG', 'FAGGOT', 'BITCH', 'WHORE', 'SLUT', 'KIKE', 'RETARD',
  'WANKER', 'TWAT', 'JIZZ', 'PUSSY', 'COCKSUCK', 'MOTHERF', 'DILDO', 'PENIS', 'VAGINA', 'HITLER',
  'ASSHOLE', 'PORN', 'BUTTHOLE'
];
const TOKENS = [
  'ASS', 'ASSES', 'ARSE', 'DICK', 'DICKS', 'COCK', 'COCKS', 'CUM', 'TIT', 'TITS', 'PISS', 'SEX', 'SEXY',
  'RAPE', 'RAPED', 'RAPIST', 'NAZI', 'NAZIS', 'KKK', 'SPIC', 'CHINK', 'FAG', 'FAGS', 'DYKE', 'TRANNY',
  'COON', 'GOOK', 'NONCE', 'BOOB', 'BOOBS', 'ANAL', 'ANUS', 'HOE', 'HOES', 'PEDO', 'HEIL', 'WANK'
];
const LEET = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B', 9: 'G', '@': 'A', $: 'S', '!': 'I', '+': 'T' };
const squeeze = (s) => s.replace(/(.)\1+/g, '$1');

export function containsProfanity(name) {
  const plain = String(name).toUpperCase().replace(/[0-9@$!+]/g, (c) => LEET[c] ?? c);
  const compact = plain.replace(/[^A-Z]/g, '');
  const squeezed = squeeze(compact);
  for (const word of SUBSTRINGS) {
    if (compact.includes(word)) return true;
    if (squeeze(word) === word && squeezed.includes(word)) return true; // FUUUCK, SHIIIT
  }
  const tokens = plain.split(/[^A-Z]+/).filter(Boolean);
  for (const word of TOKENS) {
    if (compact === word) return true; // "A S S"
    for (const token of tokens) {
      if (token === word || (token.length >= word.length && squeeze(token) === squeeze(word))) return true;
    }
  }
  return false;
}

export const CENSORED_NAME = 'CENSORED PILOT';

// --- Validation ------------------------------------------------------------------------------------
// Returns { run, censored } or { error } (a 400 message). Unknown fields are ignored.
export function validateRun(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  if (typeof body.name !== 'string') return { error: 'name is required' };
  const name = body.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  // The game sends sanitizeCallsign() output, so anything else did not come from the game.
  if (!NAME_PATTERN.test(name) || sanitizeCallsign(name) !== name) {
    return { error: 'name must be 1-18 letters, digits, spaces or _-./!?#*+:\'' };
  }
  const run = {};
  for (const [key, rule] of Object.entries(FIELDS)) {
    const value = body[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${key} must be a number` };
    if (value < rule.min || value > rule.max) return { error: `${key} out of range` };
    run[key] = rule.int ? Math.floor(value) : Math.round(value * 10) / 10;
  }
  const censored = containsProfanity(name);
  run.name = censored ? CENSORED_NAME : name;
  return { run, censored };
}

// --- Board -----------------------------------------------------------------------------------------
// Higher score first; on a tie the earlier run keeps the higher place.
export function compareEntries(a, b) {
  return b.score - a.score || String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));
}

// Sorted, at most MAX_PER_NAME runs per callsign, trimmed to BOARD_SIZE.
export function rankEntries(entries, limits = LIMITS) {
  const perName = new Map();
  const out = [];
  for (const entry of [...entries].sort(compareEntries)) {
    const n = perName.get(entry.name) || 0;
    if (n >= limits.MAX_PER_NAME) continue;
    perName.set(entry.name, n + 1);
    out.push(entry);
    if (out.length >= limits.BOARD_SIZE) break;
  }
  return out;
}

// Board blob -> clean entries; tolerates a missing or hand-edited blob.
export function readBoard(data) {
  const list = data && Array.isArray(data.entries) ? data.entries : [];
  return list.filter((e) => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.score));
}

// version is null for runs from before versioning (shown as "pre-0.9").
export function publicEntry(e) {
  return {
    id: e.id, name: e.name, score: e.score, wave: e.wave, level: e.level,
    kills: e.kills, multiplier: e.multiplier, time: e.time, date: e.date,
    version: typeof e.version === 'string' ? e.version : null
  };
}

// --- Game version ----------------------------------------------------------------------------------
// The game sends `version` (GAME_VERSION) with every run. A known version (including an older one, from
// a cached client) goes to that version's board. A run with no version at all comes from a client that
// predates versioning: it only goes to the all-time board, like every run before it. Anything else is
// a version this server doesn't know (a 422, so the client keeps the run locally).
// Returns { version } (a string, or null for a pre-versioning client) or { error }.
export function checkVersion(value, versions = BOARD_VERSIONS) {
  if (value === undefined || value === null) return { version: null };
  if (typeof value === 'string' && versions.includes(value)) return { version: value };
  return { error: 'unknown game version: reload the game to get the latest build' };
}

// --- Game mode -------------------------------------------------------------------------------------
// The game sends `mode` with every run; older clients send none, which is a NORMAL run. Anything other
// than an exact mode id is malformed (a 400). Returns { mode } or { error }.
export function checkMode(value) {
  if (value === undefined || value === null) return { mode: DEFAULT_MODE };
  if (isMode(value)) return { mode: value };
  return { error: `mode must be one of ${MODE_IDS.join(', ')}` };
}

// Which mode's boards a GET reads: ?mode=<id>, NORMAL without the parameter. Returns { mode } or { error }.
export function modeFromQuery(value) {
  if (value === null || value === '') return { mode: DEFAULT_MODE };
  if (isMode(value)) return { mode: value };
  return { error: `unknown mode: use ?mode=${MODE_IDS.join('|')}` };
}

// Which board a GET reads: ?version=<v> or ?version=all. Without the parameter (older clients) the
// all-time board, which is what /api/scores returned before boards were split by version.
// Returns { board } ('all' or a version) or { error }.
export function boardFromQuery(value, versions = BOARD_VERSIONS) {
  if (value === null || value === '' || value === ALL_TIME) return { board: ALL_TIME };
  if (versions.includes(value)) return { board: value };
  return { error: 'unknown version: use ?version=all or a known game version' };
}

// --- HTTP ------------------------------------------------------------------------------------------
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

export function clientIp(req, context) {
  const forwarded = req.headers.get('x-forwarded-for');
  return context?.ip || req.headers.get('x-nf-client-connection-ip') || (forwarded ? forwarded.split(',')[0].trim() : '') || 'unknown';
}

export function hashIp(ip, salt) {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Full-jitter backoff before compare-and-swap attempt `attempt` (0-based) retries.
export function backoffMs(attempt, limits = LIMITS, random = Math.random) {
  return Math.floor(random() * Math.min(limits.BACKOFF_CAP_MS, limits.BACKOFF_BASE_MS * 2 ** attempt));
}

// options.store(context): returns the Store (called per request with the Netlify context, after Netlify has
// set up the blob context; production and previews get different stores, see deploy-context.mjs).
// options.versions / currentVersion: the game versions with boards (newest first) and the live one;
// they default to the shared changelog, tests pass their own to simulate a version bump.
export function createScoresHandler({
  store,
  now = () => Date.now(),
  salt = 'vexolith-survivor',
  sleep = defaultSleep,
  newId = () => randomUUID(),
  limits = LIMITS,
  versions = BOARD_VERSIONS,
  currentVersion = GAME_VERSION,
  purges = PURGES,
  log = console
} = {}) {
  async function getBoard(blobs, key) {
    const result = await blobs.getWithMetadata(key, { type: 'json' });
    const updated = typeof result?.data?.updated === 'string' ? result.data.updated : null;
    return { entries: readBoard(result?.data), conditions: writeConditions(result), updated };
  }

  // Versions whose board blob exists in a mode (i.e. that have runs), newest first. One list call; a
  // store without list() or a failing list just reports none, the board itself still loads.
  async function versionsWithRuns(blobs, mode) {
    if (typeof blobs.list !== 'function') return [];
    const prefix = versionBoardPrefix(mode);
    try {
      const listing = await blobs.list({ prefix });
      const found = new Set((listing?.blobs || []).map(b => String(b.key).slice(prefix.length)));
      return versions.filter(v => found.has(v)).sort((a, b) => compareVersions(b, a));
    } catch (err) {
      log?.warn?.('[scores] list failed', err);
      return [];
    }
  }

  async function handleGet(req, blobs) {
    const params = new URL(req.url).searchParams;
    const { board, error } = boardFromQuery(params.get('version'), versions);
    if (error) return json(400, { error, current: currentVersion });
    const { mode, error: modeError } = modeFromQuery(params.get('mode'));
    if (modeError) return json(400, { error: modeError, current: currentVersion });
    const [{ entries, updated }, withRuns] = await Promise.all([getBoard(blobs, boardKey(board, mode)), versionsWithRuns(blobs, mode)]);
    return json(200, {
      version: board,
      mode,
      current: currentVersion,
      versions: withRuns,
      entries: entries.slice(0, limits.PUBLIC_SIZE).map(publicEntry),
      total: entries.length,
      boardSize: limits.BOARD_SIZE,
      updated
    }, GET_CACHE_HEADERS);
  }

  // Per-IP cooldown in RATE_BUCKET_MS windows, swept once per window (./rate-limit.mjs).
  const rate = createRateLimiter({ prefix: RATE_PREFIX, cooldownMs: limits.COOLDOWN_MS, windowMs: limits.RATE_BUCKET_MS, sweepMaxDeletes: limits.SWEEP_MAX_DELETES, log });

  // Merges one entry into a board blob (replacing an earlier copy of the same id: a retried submission).
  // Resolves { ranked, rank, updated } (rank null when it didn't make the board, in which case nothing is
  // written) or { busy: true } after WRITE_ATTEMPTS conflicts.
  async function insertEntry(blobs, key, entry, extra = {}) {
    for (let attempt = 0; attempt < limits.WRITE_ATTEMPTS; attempt++) {
      const { entries, conditions, updated } = await getBoard(blobs, key);
      const ranked = rankEntries([...entries.filter(e => e.id !== entry.id), entry], limits);
      const index = ranked.findIndex((e) => e.id === entry.id);
      if (index === -1) return { ranked, rank: null, updated };
      const write = await blobs.setJSON(key, { version: 1, ...extra, updated: entry.date, entries: ranked }, conditions);
      if (write.modified) return { ranked, rank: index + 1, updated: entry.date };
      // Someone else wrote first: re-read and merge again after a full-jitter, growing pause so
      // simultaneous writers fall out of lockstep.
      await sleep(backoffMs(attempt, limits));
    }
    return { busy: true };
  }

  async function handlePost(req, context, blobs) {
    const type = req.headers.get('content-type') || '';
    // JSON only: a cross-site page can't send this without a CORS preflight, which we never approve.
    if (!/^application\/json\b/i.test(type)) return json(415, { error: 'content-type must be application/json' });
    const declared = Number(req.headers.get('content-length'));
    if (declared > limits.MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    const text = await req.text();
    if (text.length > limits.MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }); }

    const { run, censored, error } = validateRun(body);
    if (error) return json(400, { error });
    const { mode, error: modeError } = checkMode(body.mode);
    if (modeError) return json(400, { error: modeError });
    // An unknown version is refused before the cooldown: it's a stale or dev build, not a probe.
    const version = checkVersion(body.version, versions);
    if (version.error) return json(422, { error: version.error, current: currentVersion });
    run.version = version.version;

    const t = now();
    const { retryAfter, key: slotKey } = await rate.claim(blobs, hashIp(clientIp(req, context), salt), t);
    await rate.sweepSoon(blobs, t, context);
    if (retryAfter > 0) {
      return json(429, { error: 'slow down: one run per pilot every few seconds', retryAfter }, { 'retry-after': String(retryAfter) });
    }

    const implausible = checkPlausibility(run, mode);
    if (implausible) return json(422, { error: `run rejected: ${implausible}` });

    const nonce = typeof body.nonce === 'string' && NONCE_PATTERN.test(body.nonce) ? body.nonce : null;
    const entry = { id: nonce ? nonceId(nonce) : newId(), ...run, date: new Date(t).toISOString() };
    // The run's own version board first (that's the rank the game shows), then the all-time board, both
    // of the run's mode. A pre-versioning client's run only has the all-time board.
    const allTimeKey = boardKey(ALL_TIME, mode);
    const own = run.version
      ? await insertEntry(blobs, boardKey(run.version, mode), entry, { gameVersion: run.version })
      : await insertEntry(blobs, allTimeKey, entry);
    const busy = async (partial) => {
      await rate.release(blobs, slotKey); // the game's retry isn't refused
      return json(503, { error: 'leaderboard busy, try again', partial }, { 'retry-after': '2' });
    };
    if (own.busy) return busy(false);
    let allTimeRank = run.version ? null : own.rank;
    let allTime = null;
    if (run.version) {
      // The run is on its version's board. If the all-time board stays too busy, the answer is still a
      // 503 so the game retries; the retry replaces this copy (same id) and tries the all-time board again.
      allTime = await insertEntry(blobs, allTimeKey, entry);
      if (allTime.busy) {
        log?.warn?.('[scores] all-time board busy, asking the client to retry', entry.id);
        return busy(true);
      }
      allTimeRank = allTime.rank;
    }
    const board = (b) => ({ entries: b.ranked.slice(0, limits.PUBLIC_SIZE).map(publicEntry), total: b.ranked.length, updated: b.updated });
    return json(201, {
      accepted: true, onBoard: own.rank !== null, rank: own.rank, allTimeRank,
      version: run.version, board: run.version || ALL_TIME, mode, current: currentVersion,
      id: entry.id, name: entry.name, censored,
      ...board(own), boardSize: limits.BOARD_SIZE,
      // The all-time board too (a version run lands on both), so the game never re-reads it from the CDN.
      ...(allTime ? { allTime: board(allTime) } : {})
    });
  }

  // Removes a purge's matching entries from one board, compare-and-swap like insertEntry. Resolves the
  // number removed.
  async function purgeBoard(blobs, key, purge) {
    for (let attempt = 0; attempt < limits.WRITE_ATTEMPTS; attempt++) {
      const result = await blobs.getWithMetadata(key, { type: 'json' });
      if (!result) return 0;
      const entries = readBoard(result.data);
      const kept = entries.filter((e) => !purgeMatches(purge, e));
      if (kept.length === entries.length) return 0;
      const write = await blobs.setJSON(key, { ...result.data, entries: kept }, writeConditions(result));
      if (write.modified) return entries.length - kept.length;
      await sleep(backoffMs(attempt, limits));
    }
    throw new Error(`purge: ${key} stayed busy`);
  }

  // Runs any PURGES whose marker is missing. Idempotent (a second concurrent run finds nothing left to
  // remove), and the marker is written last, so a crash midway just retries on the next request.
  // Never blocks the request: a failure is logged and the board is served as it is.
  const purgesDone = new Set();
  async function runPurges(blobs) {
    for (const purge of purges) {
      if (purgesDone.has(purge.id)) continue;
      try {
        const marker = MIGRATION_PREFIX + purge.id;
        if (await blobs.getWithMetadata(marker, { type: 'json' })) { purgesDone.add(purge.id); continue; }
        // Every board of every mode: the all-time boards and each mode's version boards.
        const keys = MODE_IDS.map(mode => boardKey(ALL_TIME, mode));
        if (typeof blobs.list === 'function') {
          for (const mode of MODE_IDS) {
            const listing = await blobs.list({ prefix: versionBoardPrefix(mode) });
            for (const b of listing?.blobs || []) keys.push(String(b.key));
          }
        }
        let removed = 0;
        for (const key of keys) removed += await purgeBoard(blobs, key, purge);
        await blobs.setJSON(marker, { id: purge.id, rule: purge, removed, done: new Date(now()).toISOString() });
        purgesDone.add(purge.id);
        log?.info?.(`[scores] ${purge.id}: removed ${removed} entries`);
      } catch (err) {
        log?.warn?.(`[scores] ${purge.id} failed, will retry`, err);
      }
    }
  }

  return async function handler(req, context) {
    try {
      const blobs = req.method === 'GET' || req.method === 'HEAD' || req.method === 'POST' ? store(context) : null;
      if (blobs) await runPurges(blobs);
      if (req.method === 'GET' || req.method === 'HEAD') return await handleGet(req, blobs);
      if (req.method === 'POST') return await handlePost(req, context, blobs);
      return json(405, { error: 'method not allowed' }, { allow: 'GET, HEAD, POST' });
    } catch (err) {
      log?.error?.('[scores]', err);
      return json(500, { error: 'leaderboard unavailable' });
    }
  };
}
