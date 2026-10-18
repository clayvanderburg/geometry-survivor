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
// A run is written to its version's board and to the all-time board. Writes are compare-and-swap on the
// blob's ETag and retried on conflict, so two runs submitted at the same moment both land. Rate limiting
// keeps one small blob per hashed client IP.
//
// Anti-cheat is deliberately "not trivially broken", not secure: the browser reports its own score,
// so anyone who reads this file can submit a believable fake run. See README "Global leaderboard".
import { createHash, randomUUID } from 'node:crypto';
import { NAME_PATTERN, sanitizeCallsign, ALL_TIME, BOARD_VERSIONS } from '../../js/leaderboard-rules.js';
import { GAME_VERSION, compareVersions } from '../../js/version.js';

export const STORE_NAME = 'leaderboard';
export const BOARD_KEY = 'board-v1'; // all-time board (it predates versioning, so its old runs have no version)
export const VERSION_BOARD_PREFIX = 'board-v1@';
export const RATE_PREFIX = 'ratelimit/';
export const MIGRATION_PREFIX = 'migrations/';

// One-time board cleanups. Each runs once per store: the first /api/scores request after it deploys
// removes every matching entry from every board (all-time and per version), then writes a marker blob
// so it never runs again. A purge matches by callsign (`names`) and/or by one run's fingerprint
// (`version`, `wave`, `minScore`..`maxScore`); every field given must match. Later runs are kept.
export const PURGES = Object.freeze([
  // The developer's test runs, cleared for a fresh start with the rebuilt Void Armory.
  { id: 'purge-madking-nox-v1', names: ['MADKING', 'NOX'] },
  // The developer's ~87M wave-36 run on 0.16.0 (from before the v0.17 weapon rework), removed on request.
  { id: 'purge-dev-87m-v0160-v1', version: '0.16.0', wave: 36, minScore: 80e6, maxScore: 95e6 }
]);

// Does a board entry match a purge rule?
export function purgeMatches(purge, e) {
  if (purge.names && !purge.names.map((n) => sanitizeCallsign(n)).includes(sanitizeCallsign(e.name))) return false;
  if (purge.version !== undefined && e.version !== purge.version) return false;
  if (purge.wave !== undefined && e.wave !== purge.wave) return false;
  if (purge.minScore !== undefined && !(e.score >= purge.minScore)) return false;
  if (purge.maxScore !== undefined && !(e.score <= purge.maxScore)) return false;
  return true;
}

// Blob key of a board: 'all' -> the all-time board, '0.9.0' -> board-v1@0.9.0.
export function boardKey(version) {
  return version === ALL_TIME ? BOARD_KEY : VERSION_BOARD_PREFIX + version;
}

export const LIMITS = Object.freeze({
  BOARD_SIZE: 100,       // runs kept in the blob
  PUBLIC_SIZE: 50,       // runs returned by GET
  MAX_PER_NAME: 5,       // one callsign can't flood the board
  COOLDOWN_MS: 20_000,   // per-IP gap between submissions
  MAX_BODY_BYTES: 2048,
  WRITE_ATTEMPTS: 8
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

// Plausibility envelope. Fitted to the headless balance sim (tools/balance-sim.mjs --god --skill expert
// --meta 8, 15-minute cap): the best run reached wave 41, level 78, 19.8k kills and 2.05 billion points
// in 894 s (score/t^2.5 ~ 86, score/kills^2 ~ 5.2, ~23 kills/s, ~5 levels/min), then widened 3-10x.
// Waves tick every 22 s of play (main.js). Score grows faster than linearly because every pickup
// raises the multiplier that later kills are paid with, so the score bounds are polynomial.
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

export function maxScoreFor(time, kills) {
  const P = PLAUSIBILITY;
  return Math.min(P.SCORE_TIME_COEF * time ** 2.5, P.SCORE_KILL_COEF * (kills + 20) ** 2) + P.SCORE_SLACK;
}

// Returns null when the run looks like something the game can produce, else a short reason.
export function checkPlausibility(run) {
  const P = PLAUSIBILITY;
  const expectedWave = 1 + Math.floor(run.time / P.WAVE_SECONDS);
  if (Math.abs(run.wave - expectedWave) > P.WAVE_SLACK) return 'wave does not match time survived';
  if (run.kills > P.KILLS_PER_SECOND * run.time + P.KILLS_SLACK) return 'too many kills for time survived';
  if (run.level > P.LEVEL_BASE + P.LEVELS_PER_SECOND * run.time) return 'level too high for time survived';
  if (run.multiplier > 1 + P.MULT_PER_KILL * run.kills) return 'multiplier too high for kills';
  if (run.score > maxScoreFor(run.time, run.kills)) return 'score too high for time survived and kills';
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

// Compare-and-swap options for a blob read as `current` (null when it didn't exist). Netlify Blobs
// returns an ETag on every read in production; the local `netlify dev` sandbox doesn't, and there we
// fall back to a plain last-writer-wins write rather than failing every submission.
export function writeConditions(current) {
  if (!current) return { onlyIfNew: true };
  return current.etag ? { onlyIfMatch: current.etag } : {};
}

// options.store(): returns the Store (called per request, after Netlify has set up the blob context).
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
    return { entries: readBoard(result?.data), conditions: writeConditions(result) };
  }

  // Versions whose board blob exists (i.e. that have runs), newest first. One list call; a store
  // without list() or a failing list just reports none, the board itself still loads.
  async function versionsWithRuns(blobs) {
    if (typeof blobs.list !== 'function') return [];
    try {
      const listing = await blobs.list({ prefix: VERSION_BOARD_PREFIX });
      const found = new Set((listing?.blobs || []).map(b => String(b.key).slice(VERSION_BOARD_PREFIX.length)));
      return versions.filter(v => found.has(v)).sort((a, b) => compareVersions(b, a));
    } catch (err) {
      log?.warn?.('[scores] list failed', err);
      return [];
    }
  }

  async function handleGet(req, blobs) {
    const query = new URL(req.url).searchParams.get('version');
    const { board, error } = boardFromQuery(query, versions);
    if (error) return json(400, { error, current: currentVersion });
    const [{ entries }, withRuns] = await Promise.all([getBoard(blobs, boardKey(board)), versionsWithRuns(blobs)]);
    return json(200, {
      version: board,
      current: currentVersion,
      versions: withRuns,
      entries: entries.slice(0, limits.PUBLIC_SIZE).map(publicEntry),
      total: entries.length,
      boardSize: limits.BOARD_SIZE
    });
  }

  // Claims this IP's submission slot. Conditional write, so parallel requests can't all slip through.
  async function claimRateSlot(blobs, ipHash, t) {
    const key = RATE_PREFIX + ipHash;
    const prev = await blobs.getWithMetadata(key, { type: 'json' });
    const last = Number(prev?.data?.t) || 0;
    if (prev && t - last < limits.COOLDOWN_MS) return Math.ceil((limits.COOLDOWN_MS - (t - last)) / 1000);
    const write = await blobs.setJSON(key, { t }, writeConditions(prev));
    return write.modified ? 0 : Math.ceil(limits.COOLDOWN_MS / 1000);
  }

  // Merges one entry into a board blob. Resolves { ranked, rank } (rank null when it didn't make the
  // board, in which case nothing is written) or { busy: true } after WRITE_ATTEMPTS conflicts.
  async function insertEntry(blobs, key, entry, extra = {}) {
    for (let attempt = 0; attempt < limits.WRITE_ATTEMPTS; attempt++) {
      const { entries, conditions } = await getBoard(blobs, key);
      const ranked = rankEntries([...entries.filter(e => e.id !== entry.id), entry], limits);
      const index = ranked.findIndex((e) => e.id === entry.id);
      if (index === -1) return { ranked, rank: null };
      const write = await blobs.setJSON(key, { version: 1, ...extra, updated: entry.date, entries: ranked }, conditions);
      if (write.modified) return { ranked, rank: index + 1 };
      // Someone else wrote first: re-read and merge again after a jittered, growing pause so
      // simultaneous writers fall out of lockstep.
      await sleep(Math.floor(Math.random() * Math.min(400, 25 * 2 ** attempt)));
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
    // An unknown version is refused before the cooldown: it's a stale or dev build, not a probe.
    const version = checkVersion(body.version, versions);
    if (version.error) return json(422, { error: version.error, current: currentVersion });
    run.version = version.version;

    const t = now();
    const retryAfter = await claimRateSlot(blobs, hashIp(clientIp(req, context), salt), t);
    if (retryAfter > 0) {
      return json(429, { error: 'slow down: one run per pilot every few seconds', retryAfter }, { 'retry-after': String(retryAfter) });
    }

    const implausible = checkPlausibility(run);
    if (implausible) return json(422, { error: `run rejected: ${implausible}` });

    const entry = { id: newId(), ...run, date: new Date(t).toISOString() };
    // The run's own version board first (that's the rank the game shows), then the all-time board.
    // A pre-versioning client's run only has the all-time board.
    const own = run.version
      ? await insertEntry(blobs, boardKey(run.version), entry, { gameVersion: run.version })
      : await insertEntry(blobs, BOARD_KEY, entry);
    if (own.busy) return json(503, { error: 'leaderboard busy, try again' }, { 'retry-after': '2' });
    let allTimeRank = run.version ? null : own.rank;
    if (run.version) {
      // Best effort: the run is already on its version's board, so a contended all-time board doesn't
      // turn the submission into an error.
      const allTime = await insertEntry(blobs, BOARD_KEY, entry);
      if (allTime.busy) log?.warn?.('[scores] all-time board busy, run kept on its version board', entry.id);
      else allTimeRank = allTime.rank;
    }
    return json(201, {
      accepted: true, onBoard: own.rank !== null, rank: own.rank, allTimeRank,
      version: run.version, board: run.version || ALL_TIME, current: currentVersion,
      id: entry.id, name: entry.name, censored,
      entries: own.ranked.slice(0, limits.PUBLIC_SIZE).map(publicEntry), total: own.ranked.length, boardSize: limits.BOARD_SIZE
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
      await sleep(Math.floor(Math.random() * Math.min(400, 25 * 2 ** attempt)));
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
        const keys = [BOARD_KEY];
        if (typeof blobs.list === 'function') {
          const listing = await blobs.list({ prefix: VERSION_BOARD_PREFIX });
          for (const b of listing?.blobs || []) keys.push(String(b.key));
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
      const blobs = req.method === 'GET' || req.method === 'HEAD' || req.method === 'POST' ? store() : null;
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
