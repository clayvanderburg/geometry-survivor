// Hangar save data (docs/HANGAR_DESIGN.md §6.1): one `hangar` object in the save, created only while the
// Hangar flag is on (js/hangar-flag.js), so a save that never saw the Hangar stays byte-for-byte what it
// was. normalizeSave (progression.js) keeps it through a round trip once it exists. DOM-free.
//
//   ship      the ship picked in the Hangar (flown when the flag is on)
//   ships     unlocked ship ids (VEXOLITH is always owned)
//   weapons   weapons unlocked by feats or mastery (on top of the ones unlocked from the start)
//   feats     { featId: 'YYYY-MM-DD' } completed feats
//   badges    badge ids earned by badge-only feats
//   fresh     'ship:mantis' / 'weapon:flamethrower' / 'feat:kills_1500' / 'badge:x': unlocked, not seen yet
//   career    lifetime counters (CAREER_COUNTERS), best waves cleared per mode, best Endless wave and
//             most rocks mined in one run
//   mastery   { weaponId: 0..4 } mastery tier per weapon
//   veteran   the save had runs before the Hangar existed: the newly locked weapons stay unlocked for it
import { MODE_IDS } from './modes.js';

export const DEFAULT_SHIP = 'vexolith';
// Lifetime counters (small integers). Only NORMAL and HARDCORE runs add to them (BLITZ has its own feats).
export const CAREER_COUNTERS = Object.freeze([
  'kills', 'bossKills', 'rocksMined', 'dashes', 'shieldDamage', 'afflicted', 'frozen', 'goldSpent', 'runs', 'campaigns'
]);
export const MASTERY_MAX = 4;

const ID = /^[a-z0-9_]{1,40}$/;
const FRESH_ID = /^(ship|weapon|feat|badge):[a-z0-9_]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IDS = 200;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const int = (v, max = Number.MAX_SAFE_INTEGER) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
const ids = (list, re = ID) => (Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string' && re.test(x)))].slice(0, MAX_IDS) : []);

export function emptyCareer() {
  return { ...Object.fromEntries(CAREER_COUNTERS.map((k) => [k, 0])), bestWave: Object.fromEntries(MODE_IDS.map((m) => [m, 0])), bestEndlessWave: 0, bestRocksRun: 0 };
}

// Sanitized ids, bounded counters; unknown but well-formed ids are kept (a save from a newer build).
export function normalizeHangar(value) {
  const src = obj(value);
  const career = emptyCareer();
  const c = obj(src.career);
  for (const k of CAREER_COUNTERS) career[k] = int(c[k]);
  for (const m of MODE_IDS) career.bestWave[m] = int(obj(c.bestWave)[m], 100000);
  career.bestEndlessWave = int(c.bestEndlessWave, 100000);
  career.bestRocksRun = int(c.bestRocksRun, 100000);
  const feats = {};
  for (const [id, date] of Object.entries(obj(src.feats)).slice(0, MAX_IDS)) {
    if (ID.test(id)) feats[id] = typeof date === 'string' && DATE.test(date) ? date : '1970-01-01';
  }
  const mastery = {};
  for (const [id, tier] of Object.entries(obj(src.mastery)).slice(0, MAX_IDS)) {
    if (ID.test(id) && int(tier, MASTERY_MAX) > 0) mastery[id] = int(tier, MASTERY_MAX);
  }
  const ships = ids(src.ships);
  if (!ships.includes(DEFAULT_SHIP)) ships.unshift(DEFAULT_SHIP);
  const ship = typeof src.ship === 'string' && ships.includes(src.ship) ? src.ship : DEFAULT_SHIP;
  return {
    ship,
    ships,
    weapons: ids(src.weapons),
    feats,
    badges: ids(src.badges),
    fresh: ids(src.fresh, FRESH_ID),
    career,
    mastery,
    veteran: src.veteran === true
  };
}

// A new hangar for an existing save: runs played seed `runs`, the local highscores seed the best wave
// cleared per mode (the last boss wave below the wave reached), and a save with runs is a veteran.
export function newHangar(save = {}) {
  const h = normalizeHangar({});
  const runs = int(save.totalRuns);
  h.career.runs = runs;
  h.veteran = runs > 0;
  for (const e of Array.isArray(save.highscores) ? save.highscores : []) {
    if (typeof e?.id !== 'string' || e.id.startsWith('seed-') || !MODE_IDS.includes(e.mode)) continue;
    const cleared = Math.floor(Math.max(0, int(e.wave) - 1) / 5) * 5;
    h.career.bestWave[e.mode] = Math.max(h.career.bestWave[e.mode], cleared);
  }
  return h;
}

// Apply a feat's reward ({ ship }, { weapon }, { badge }, any mix). Returns the fresh ids it added.
export function grantReward(h, reward = {}) {
  const added = [];
  const add = (list, kind, id) => {
    if (typeof id !== 'string' || !ID.test(id) || h[list].includes(id)) return;
    h[list].push(id);
    h.fresh.push(`${kind}:${id}`);
    added.push(`${kind}:${id}`);
  };
  add('ships', 'ship', reward.ship);
  add('weapons', 'weapon', reward.weapon);
  add('badges', 'badge', reward.badge);
  return added;
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);
