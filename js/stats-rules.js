// Anonymous run statistics: the rules shared by the game (js/stats-client.js), the /api/stats Netlify
// Function (netlify/lib/stats.mjs, which bundles this file) and the dashboard. No DOM, no dependencies
// beyond the shared version/changelog modules.
//
// A run summary (built by js/run-stats.js) holds no callsign, no IP and nothing else about the player:
//   schema 1, version, time (s), wave, level, score, kills, died, cause (enemy kind of the fatal hit)
//   levelTimes  [seconds at which LV 2, 3, ... were reached]
//   gold        { earned, spent, rerolls, locks, banishes }
//   loadout     [{ id, lv }] at the end of the run
//   weapons     { group: { dmg, kills, owned?, from?, curve?, tl?: [[t, lv]], lv?: { L: [secs, dmg,
//                 dmg/base, allDmg, kills, allKills, DPS_TARGET(L)] } } }
//   sources     { stat id: damage }  (sub-sources such as burn, helix, collapse, storm, siege)
//   enemies     { kind: [spawned, killed, ttkSeconds, ttkN, damageToPlayer, hitsOnPlayer] }
//   cards       { card id: [offered, picked, eligible hands, expected draws, draws] }   weaponPicks { weapon id: same }
import { KNOWN_VERSIONS } from './changelog.js';

export const STATS_SCHEMA = 1;

export const STATS_LIMITS = Object.freeze({
  MAX_BODY_BYTES: 16 * 1024,
  MIN_RUN_SECONDS: 20,        // shorter runs (quick restarts) are not sent
  MAX_RUN_SECONDS: 6 * 3600,
  MAX_GROUPS: 32,
  MAX_LEVELS: 40,             // level buckets per weapon
  MAX_LEVEL: 999,
  MAX_TIMELINE: 40,
  MAX_LEVEL_TIMES: 200,
  MAX_KINDS: 40,
  MAX_CARDS: 160,
  MAX_SOURCES: 40,
  MAX_LOADOUT: 12,
  MAX_DAMAGE: 1e13,
  MAX_COUNT: 1e8
});

// Ids are short lower-case tokens: weapon, card, source and enemy ids ("evo_pulsar", "mini_splitter").
export const STAT_ID = /^[a-z0-9][a-z0-9_:.-]{0,39}$/;

// Why a run's stats are not sent, or null when they are: the player opted out, the dev tuner touched
// the run (not comparable), or the run was too short to say anything.
export function statsSkipReason({ share = true, tainted = false, time = 0 } = {}) {
  if (!share) return 'optout';
  if (tainted) return 'tainted';
  if (!(Number(time) >= STATS_LIMITS.MIN_RUN_SECONDS)) return 'short';
  return null;
}

export const isStatsVersion = (v, versions = KNOWN_VERSIONS) => typeof v === 'string' && versions.includes(v);

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const num = (v, max, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : 0);
const int = (v, max, min = 0) => Math.floor(num(v, max, min));
const dec = (v, max, digits = 1) => { const f = 10 ** digits; return Math.round(num(v, max) * f) / f; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const entries = (v, max) => (isObj(v) ? Object.entries(v).filter(([k]) => STAT_ID.test(k)).slice(0, max) : []);

// Validates and clamps an uploaded summary. Returns { run } or { error, status } (400 / 422).
// Unknown fields are dropped, out-of-range numbers clamped, malformed ids skipped.
export function sanitizeRunStats(body, versions = KNOWN_VERSIONS) {
  const L = STATS_LIMITS;
  if (!isObj(body)) return { error: 'body must be a JSON object', status: 400 };
  if (body.schema !== STATS_SCHEMA) return { error: 'unsupported stats schema', status: 400 };
  if (!isStatsVersion(body.version, versions)) return { error: 'unknown game version', status: 422 };
  if (typeof body.time !== 'number' || !Number.isFinite(body.time)) return { error: 'time must be a number', status: 400 };
  if (body.time < L.MIN_RUN_SECONDS) return { error: 'run too short', status: 422 };
  const t = dec(body.time, L.MAX_RUN_SECONDS);
  const run = {
    schema: STATS_SCHEMA,
    version: body.version,
    time: t,
    wave: int(body.wave, 5000, 1),
    level: int(body.level, 5000, 1),
    score: int(body.score, 1e13),
    kills: int(body.kills, L.MAX_COUNT),
    died: body.died !== false,
    cause: typeof body.cause === 'string' && STAT_ID.test(body.cause) ? body.cause : null,
    levelTimes: (Array.isArray(body.levelTimes) ? body.levelTimes : []).slice(0, L.MAX_LEVEL_TIMES).map((v) => dec(v, t)),
    gold: {
      earned: int(body.gold?.earned, L.MAX_COUNT), spent: int(body.gold?.spent, L.MAX_COUNT),
      rerolls: int(body.gold?.rerolls, 1e5), locks: int(body.gold?.locks, 1e5), banishes: int(body.gold?.banishes, 1e5)
    },
    loadout: (Array.isArray(body.loadout) ? body.loadout : [])
      .filter((w) => isObj(w) && typeof w.id === 'string' && STAT_ID.test(w.id)).slice(0, L.MAX_LOADOUT)
      .map((w) => ({ id: w.id, lv: int(w.lv, L.MAX_LEVEL) })),
    weapons: {},
    sources: {},
    enemies: {},
    cards: {},
    weaponPicks: {}
  };
  for (const [id, w] of entries(body.weapons, L.MAX_GROUPS)) {
    if (!isObj(w)) continue;
    const out = { dmg: dec(w.dmg, L.MAX_DAMAGE, 0), kills: int(w.kills, L.MAX_COUNT) };
    if (isObj(w.lv)) {
      out.owned = dec(w.owned, t);
      out.from = dec(w.from, t);
      out.curve = w.curve === 1 ? 1 : 0;
      out.tl = (Array.isArray(w.tl) ? w.tl : []).slice(0, L.MAX_TIMELINE)
        .filter((p) => Array.isArray(p) && p.length === 2).map(([a, b]) => [dec(a, t), int(b, L.MAX_LEVEL)]);
      out.lv = {};
      let n = 0;
      for (const [lv, row] of Object.entries(w.lv)) {
        const level = Number(lv);
        if (!Number.isInteger(level) || level < 1 || level > L.MAX_LEVEL || !Array.isArray(row) || n >= L.MAX_LEVELS) continue;
        const secs = dec(row[0], t);
        if (!(secs > 0)) continue;
        out.lv[level] = [secs, dec(row[1], L.MAX_DAMAGE, 0), dec(row[2], L.MAX_DAMAGE, 2), dec(row[3], L.MAX_DAMAGE, 0),
          int(row[4], L.MAX_COUNT), int(row[5], L.MAX_COUNT), dec(row[6], 1e9, 2)];
        n++;
      }
    }
    run.weapons[id] = out;
  }
  for (const [id, v] of entries(body.sources, L.MAX_SOURCES)) run.sources[id] = dec(v, L.MAX_DAMAGE, 0);
  for (const [id, v] of entries(body.enemies, L.MAX_KINDS)) {
    if (!Array.isArray(v)) continue;
    const killed = int(v[1], L.MAX_COUNT);
    const ttkN = Math.min(killed, int(v[3], L.MAX_COUNT));
    run.enemies[id] = [int(v[0], L.MAX_COUNT), killed, dec(v[2], t * Math.max(1, ttkN)), ttkN, dec(v[4], 1e9, 0), int(v[5], L.MAX_COUNT)];
  }
  for (const key of ['cards', 'weaponPicks']) {
    for (const [id, v] of entries(body[key], L.MAX_CARDS)) {
      if (!Array.isArray(v)) continue;
      const offered = int(v[0], 1e5);
      const eligible = int(v[2], 1e5);
      // [offered, picked, eligible hands, expected random draws, random draws]
      run[key][id] = [offered, Math.min(offered, int(v[1], 1e5)), eligible, dec(v[3], eligible, 0), Math.min(eligible, int(v[4], 1e5))];
    }
  }
  return { run };
}

export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

// Trims a summary until it fits the upload limit: timelines first, then the rarest cards, sources
// and enemy kinds. Typical runs are 2-6 KB and come back untouched. Returns a new object.
export function fitPayload(run, maxBytes = STATS_LIMITS.MAX_BODY_BYTES) {
  if (jsonBytes(run) <= maxBytes) return run;
  const out = structuredClone(run);
  const steps = [
    () => { for (const w of Object.values(out.weapons || {})) if (w.tl) w.tl = w.tl.slice(0, 8); },
    () => { out.levelTimes = (out.levelTimes || []).slice(0, 100); },
    () => { for (const w of Object.values(out.weapons || {})) delete w.tl; },
    () => { out.cards = Object.fromEntries(Object.entries(out.cards || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 60)); },
    () => { out.sources = Object.fromEntries(Object.entries(out.sources || {}).sort((a, b) => b[1] - a[1]).slice(0, 16)); },
    () => { out.enemies = Object.fromEntries(Object.entries(out.enemies || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 20)); },
    () => { out.levelTimes = []; },
    () => { out.cards = {}; out.weaponPicks = {}; },
    // Pathological: keep each weapon's 12 longest-held levels, then the 16 biggest damage groups.
    () => { for (const w of Object.values(out.weapons || {})) if (w.lv) w.lv = Object.fromEntries(Object.entries(w.lv).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12)); },
    () => { out.weapons = Object.fromEntries(Object.entries(out.weapons || {}).sort((a, b) => b[1].dmg - a[1].dmg).slice(0, 16)); }
  ];
  for (const step of steps) {
    step();
    if (jsonBytes(out) <= maxBytes) return out;
  }
  return out;
}
