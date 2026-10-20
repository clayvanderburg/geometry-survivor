// Persistent Highscore Leaderboard & Meta-Progression (the Void Armory, bought with Void Cores)
import { MODE_IDS, normalizeMode } from './modes.js';
import { normalizeHangar, newHangar } from './hangar-save.js';

const SAVE_KEY = 'vectra_survivor_save_v2';
// Local highscores ("MY RUNS") kept per game mode.
export const LOCAL_TOP = 8;

// Void Armory: permanent single-stat upgrades bought with Void Cores. Each rank adds a small `per` step;
// rank n (0-based) costs round(baseCost * growth^n), so early ranks are quick and late ranks are a grind.
// Sized for roughly 70-95 hours of typical play to max everything (~700 cores/hour before Void Core Gain;
// see docs/BALANCE_REPORT.md). `fmt` picks how `per` reads on the card: pct (+1.5%), pts (+0.4% points),
// flat (+4), sec (+0.02 s). Negative steps are reductions (damage taken, dash cooldown, reroll cost).
export const ARMORY_VERSION = 2; // bump to reset everyone's ranks and cores again (see normalizeSave)
export const STARTING_CORES = 15;
// One-time wipe of the developer's test pilots: a save flying one of these callsigns loses its Void Cores,
// armory ranks and the local runs under those names, once per DEV_WIPE id.
export const DEV_WIPE = Object.freeze({ id: 'nox-madking-v0330', names: Object.freeze(['NOX', 'MADKING']) });

export const ARMORY_CATEGORIES = [
  { id: 'offense', label: 'OFFENSE', icon: '✦' },
  { id: 'defense', label: 'DEFENSE', icon: '◈' },
  { id: 'mobility', label: 'MOBILITY', icon: '➤' },
  { id: 'economy', label: 'ECONOMY', icon: '❖' },
  { id: 'utility', label: 'UTILITY', icon: '✧' }
];

// The last rank of every upgrade costs about ARMORY_TOP_COST cores: each one's growth is steepened to get
// there (never flattened; Deep-Core Extractor and Supernova Reserve already cost more).
export const ARMORY_TOP_COST = 1000;

const BASE_META_UPGRADES = [
  // OFFENSE
  { id: 'damage', cat: 'offense', name: 'Plasma Overcharge', icon: '✦', color: '#ff007f', stat: 'weapon damage', per: 0.015, fmt: 'pct', maxRank: 40, baseCost: 9, growth: 1.12 },
  { id: 'critChance', cat: 'offense', name: 'Deadeye Lattice', icon: '◎', color: '#ffcc00', stat: 'crit chance', per: 0.004, fmt: 'pts', maxRank: 25, baseCost: 15, growth: 1.15 },
  { id: 'critDamage', cat: 'offense', name: 'Fracture Rounds', icon: '✶', color: '#ff9b3d', stat: 'crit damage', per: 0.02, fmt: 'pct', maxRank: 25, baseCost: 15, growth: 1.15 },
  { id: 'area', cat: 'offense', name: 'Field Expander', icon: '◯', color: '#c79bff', stat: 'area size (blasts, pulls, auras)', per: 0.01, fmt: 'pct', maxRank: 25, baseCost: 18, growth: 1.15 },
  // DEFENSE
  { id: 'maxHp', cat: 'defense', name: 'Aegis Shield Matrix', icon: '◈', color: '#00f3ff', stat: 'max shield', per: 2, fmt: 'flat', maxRank: 40, baseCost: 8, growth: 1.11 },
  // MOBILITY
  { id: 'moveSpeed', cat: 'mobility', name: 'Vector Thrusters', icon: '➤', color: '#00ff88', stat: 'move speed', per: 0.008, fmt: 'pct', maxRank: 25, baseCost: 12, growth: 1.14 },
  { id: 'dash', cat: 'mobility', name: 'Blink Coils', icon: '⇢', color: '#5aa8ff', stat: 'dash cooldown', per: -0.01, fmt: 'pct', maxRank: 25, baseCost: 15, growth: 1.14 },
  { id: 'dashDistance', cat: 'mobility', name: 'Afterburner Jets', icon: '⇥', color: '#7fd4ff', stat: 'dash distance', per: 0.02, fmt: 'pct', maxRank: 25, baseCost: 15, growth: 1.14 },
  // ECONOMY
  { id: 'coreYield', cat: 'economy', name: 'Deep-Core Extractor', icon: '❖', color: '#d68fff', stat: 'Void Core gain', per: 0.02, fmt: 'pct', maxRank: 40, baseCost: 15, growth: 1.12 },
  { id: 'xpGain', cat: 'economy', name: 'Geom Resonator', icon: '⬡', color: '#6dff9e', stat: 'XP gain', per: 0.01, fmt: 'pct', maxRank: 30, baseCost: 12, growth: 1.13 },
  { id: 'goldGain', cat: 'economy', name: 'Gold Assayer', icon: '◆', color: '#ffcc00', stat: 'gold from gold veins', per: 0.04, fmt: 'pct', maxRank: 20, baseCost: 15, growth: 1.15 },
  { id: 'startGold', cat: 'economy', name: 'Prospector Stake', icon: '⛁', color: '#ffe14d', stat: 'starting gold', per: 2, fmt: 'flat', maxRank: 15, baseCost: 18, growth: 1.17 },
  { id: 'mining', cat: 'economy', name: 'Rotary Claw Drive', icon: '⚙', color: '#00f3ff', stat: 'mining speed', per: 0.03, fmt: 'pct', maxRank: 25, baseCost: 9, growth: 1.13 },
  // UTILITY
  { id: 'luck', cat: 'utility', name: 'Quantum Fortune', icon: '🍀', color: '#9d4edd', stat: 'luck', per: 0.02, fmt: 'pct', maxRank: 25, baseCost: 15, growth: 1.15 },
  { id: 'magnet', cat: 'utility', name: 'Vacuum Array', icon: '⊛', color: '#b6ff4a', stat: 'pickup radius', per: 0.02, fmt: 'pct', maxRank: 25, baseCost: 9, growth: 1.13 },
  { id: 'reroll', cat: 'utility', name: 'Probability Engine', icon: '↻', color: '#ffcc00', stat: 'reroll cost', per: -0.02, fmt: 'pct', maxRank: 15, baseCost: 22, growth: 1.17 },
  { id: 'miningReach', cat: 'utility', name: 'Extended Claws', icon: '⟟', color: '#7fd4ff', stat: 'drill reach', per: 0.02, fmt: 'pct', maxRank: 15, baseCost: 12, growth: 1.15 },
  { id: 'bombs', cat: 'utility', name: 'Supernova Reserve', icon: '✸', color: '#ffcc00', stat: 'starting Supernova bomb', per: 1, fmt: 'flat', maxRank: 3, baseCost: 400, growth: 3 }
];
// An upgrade's growth steepened so its last rank costs about ARMORY_TOP_COST.
const topCostGrowth = (u) => Math.max(u.growth, Math.pow(ARMORY_TOP_COST / u.baseCost, 1 / Math.max(1, u.maxRank - 1)));
export const META_UPGRADES = BASE_META_UPGRADES.map((u) => ({ ...u, growth: topCostGrowth(u) }));

export const META_BY_ID = Object.fromEntries(META_UPGRADES.map((u) => [u.id, u]));

// Armory revisions: CHANGING AN UPGRADE'S EFFECT OR COST CURVE BUMPS ITS REVISION HERE (`id: next number`;
// an upgrade not listed is revision 1). A save remembers the revision each upgrade was bought at; when the
// build's is newer, the cores the player actually paid for that upgrade (`paid`, whatever the price curve
// was then) are refunded in full and its ranks reset. Removing an upgrade adds it to RETIRED_UPGRADES instead.
export const ARMORY_REVISIONS = Object.freeze({
  // v0.43.3, toward a full Armory of ~3x power (see armoryPower):
  damage: 2, // +1.5% per rank (was +1%)
  maxHp: 2 // +2 shield per rank (was +1.5)
});
const MAX_REFUND_NOTES = 24;

// Cost of buying rank `rank` + 1 (rank is the current rank).
export function armoryCost(upg, rank) {
  return Math.round(upg.baseCost * Math.pow(upg.growth, Math.max(0, rank)));
}

// Cores spent to reach the ranks in `ranks` (an { id: rank } map): what REFUND ALL pays back.
export function armorySpent(ranks = {}) {
  let cores = 0;
  for (const upg of META_UPGRADES) {
    for (let n = 0; n < (ranks[upg.id] || 0); n++) cores += armoryCost(upg, n);
  }
  return cores;
}

// Total effect at `rank` as card text: "+15%", "+1.25%", "+2.0% pts", "+40", "+0.20 s", "-7.5%".
export function formatArmoryValue(upg, rank) {
  const v = upg.per * rank;
  const sign = v < 0 ? '-' : '+';
  const a = Math.abs(v);
  if (upg.fmt === 'flat') return `${sign}${Math.round(a)}`;
  if (upg.fmt === 'sec') return `${sign}${a.toFixed(2)} s`;
  // One decimal under 10% (two when needed: +1.25%), whole numbers above unless a half shows (+12.5%).
  const n = Math.round(a * 10000) / 100;
  const pct = n < 10 ? (Number.isInteger(n * 10) ? n.toFixed(1) : n.toFixed(2)) : String(Math.round(n * 10) / 10);
  return upg.fmt === 'pts' ? `${sign}${pct}% pts` : `${sign}${pct}%`;
}

// Bonuses from ranks (an { id: rank } map). Pure, so the balance sim and tests can use it.
export function armoryBonuses(ranks = {}) {
  const r = (id) => ranks[id] || 0;
  const step = (id) => r(id) * META_BY_ID[id].per;
  return {
    damageMult: 1 + step('damage'),
    critChanceBonus: step('critChance'),
    critDamageBonus: step('critDamage'),
    areaMult: 1 + step('area'),
    bonusHp: step('maxHp'),
    moveSpeedMult: 1 + step('moveSpeed'),
    dashCooldownMult: Math.max(0.5, 1 + step('dash')),
    dashDistanceMult: 1 + step('dashDistance'),
    coreMult: 1 + step('coreYield'),
    xpMult: 1 + step('xpGain'),
    goldMult: 1 + step('goldGain'),
    startGold: step('startGold'),
    miningMult: 1 + step('mining'),
    luckBonus: step('luck'),
    magnetMult: 1 + step('magnet'),
    rerollCostMult: Math.max(0.5, 1 + step('reroll')),
    miningRangeMult: 1 + step('miningReach'),
    extraBombs: r('bombs')
  };
}

// Total power of a set of ranks against a bare ship: offense × defense, the number the Armory is sized by
// (a full Armory is about 3x; tests/armory.test.js pins it). Offense is expected damage per hit (damage ×
// crits); defense is effective shield on a mid-campaign ship (POWER_REF: 75 base + one Shield Capacitor,
// plus passive regen over a 30 s fight). Utility (speed, dash, area, XP, economy,
// starting bombs) is left out: it helps, but by how much depends on the build and the pilot.
export const POWER_REF = Object.freeze({ shield: 95, regen: 0.6, window: 30, critChance: 0.05, critDamage: 1.5 });

export function armoryPower(ranks = {}, ref = POWER_REF) {
  const b = armoryBonuses(ranks);
  const crit = (chance, dmg) => 1 + chance * (dmg - 1);
  const offense = b.damageMult * crit(ref.critChance + b.critChanceBonus, ref.critDamage + b.critDamageBonus) / crit(ref.critChance, ref.critDamage);
  const shield = ref.shield + b.bonusHp;
  const defense = (shield + ref.regen * ref.window) / (ref.shield + ref.regen * ref.window);
  return { offense, defense, total: offense * defense };
}

const DEFAULT_HIGHSCORES = [
  { id: 'seed-1', name: 'VEXOLITH // PRIME', score: 125000, multiplier: 14.5, wave: 10, kills: 420, timeStr: '03:40' },
  { id: 'seed-2', name: 'VOID // HUNTER', score: 48500, multiplier: 8.4, wave: 6, kills: 210, timeStr: '02:12' },
  { id: 'seed-3', name: 'NEON // DRIFTER', score: 18200, multiplier: 4.2, wave: 3, kills: 95, timeStr: '01:05' }
];

export function normalizePilotName(value) {
  return typeof value === 'string' ? value.trim().toUpperCase().slice(0, 18) || 'MADKING' : 'MADKING';
}

// The best LOCAL_TOP runs of each game mode, best first (entries without a mode are NORMAL runs).
export function topRunsPerMode(entries) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  return MODE_IDS.flatMap(mode => sorted.filter(e => normalizeMode(e.mode) === mode).slice(0, LOCAL_TOP))
    .sort((a, b) => b.score - a.score);
}

function boundedInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

// Field Guide unlocks: `seen` ids (hostiles met in any run) and `fresh` ids (unlocked, not yet read in
// the guide: they carry a NEW badge). Ids are guide entry ids (see js/field-guide.js); unknown but
// well-formed ids are kept so a save from a newer build survives a round trip.
const GUIDE_ID = /^[a-z0-9_]{1,40}$/;
const GUIDE_MAX_IDS = 200;

export function normalizeGuide(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const ids = (list) => Array.isArray(list)
    ? [...new Set(list.filter(id => typeof id === 'string' && GUIDE_ID.test(id)))].slice(0, GUIDE_MAX_IDS)
    : [];
  const seen = ids(source.seen);
  const fresh = ids(source.fresh).filter(id => seen.includes(id));
  return { seen, fresh };
}

// Armory upgrades that were removed: a save still holding ranks in one gets every core it spent on them
// back once (the ranks then drop out of the save). Chronos Capacitor boosted only the Autocannon, while
// every other weapon is built in the run, so it went in v0.27.3. Ablative Plating (damage taken) and Phase
// Buffer (post-hit invulnerability) made way for Afterburner Jets (dash distance) in v0.42.5; they were
// priced on the ARMORY_TOP_COST curve, so their refund is too.
export const RETIRED_UPGRADES = Object.freeze({
  fireRate: { name: 'Chronos Capacitor', baseCost: 12, growth: 1.13, maxRank: 30 },
  armor: { name: 'Ablative Plating', baseCost: 18, growth: topCostGrowth({ baseCost: 18, growth: 1.14, maxRank: 30 }), maxRank: 30 },
  phase: { name: 'Phase Buffer', baseCost: 22, growth: topCostGrowth({ baseCost: 22, growth: 1.18, maxRank: 15 }), maxRank: 15 }
});

// Cores spent on ranks of retired upgrades in a save's `ranks`.
export function retiredRefund(sourceRanks = {}) {
  return retiredRefunds(sourceRanks).reduce((cores, r) => cores + r.cores, 0);
}

function retiredRefunds(sourceRanks = {}) {
  const out = [];
  for (const [id, upg] of Object.entries(RETIRED_UPGRADES)) {
    const rank = boundedInteger(sourceRanks[id], 0, 0, upg.maxRank);
    let cores = 0;
    for (let n = 0; n < rank; n++) cores += armoryCost(upg, n);
    if (cores > 0) out.push({ id, name: upg.name || id, cores });
  }
  return out;
}

// Pending "Armory update" refund notes: [{ id, name, cores }] shown until the player dismisses them.
function normalizeRefundNotes(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((n) => n && typeof n === 'object' && typeof n.id === 'string')
    .map((n) => ({ id: n.id.slice(0, 40), name: typeof n.name === 'string' ? n.name.slice(0, 40) : n.id.slice(0, 40), cores: boundedInteger(n.cores, 0) }))
    .filter((n) => n.cores > 0).slice(0, MAX_REFUND_NOTES);
}

// Cores the save actually paid per upgrade. Saves from before this field are priced on the current curve.
function normalizePaid(sourcePaid, ranks) {
  const paid = sourcePaid && typeof sourcePaid === 'object' && !Array.isArray(sourcePaid) ? sourcePaid : {};
  return Object.fromEntries(META_UPGRADES.map((u) => {
    if (!ranks[u.id]) return [u.id, 0];
    let curve = 0;
    for (let n = 0; n < ranks[u.id]; n++) curve += armoryCost(u, n);
    return [u.id, boundedInteger(paid[u.id], curve)];
  }));
}

export function normalizeSave(value, revisions = ARMORY_REVISIONS) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceRanks = source.ranks && typeof source.ranks === 'object' ? source.ranks : {};
  const ranks = Object.fromEntries(META_UPGRADES.map(upgrade => [upgrade.id,
    boundedInteger(sourceRanks[upgrade.id], 0, 0, upgrade.maxRank)]));
  const savedScores = Array.isArray(source.highscores) ? source.highscores.filter(entry =>
    entry && typeof entry === 'object' && typeof entry.score === 'number' && Number.isFinite(entry.score)
  ).map((entry, index) => ({
    id: typeof entry.id === 'string' ? entry.id : 'legacy-' + index,
    name: normalizePilotName(entry.name),
    score: boundedInteger(entry.score, 0),
    multiplier: typeof entry.multiplier === 'number' && Number.isFinite(entry.multiplier) ? Math.max(1, entry.multiplier) : 1,
    wave: boundedInteger(entry.wave, 1, 1),
    kills: boundedInteger(entry.kills, 0),
    timeStr: typeof entry.timeStr === 'string' && /^\d{2,}:\d{2}$/.test(entry.timeStr) ? entry.timeStr : '00:00',
    mode: normalizeMode(entry.mode)
  })) : [];
  // An existing save from before ARMORY_VERSION had the old six bundled upgrades: its ranks and cores
  // are reset once (callsign, high scores, Field Guide and runs played are kept) and a notice is shown.
  const legacyArmory = Object.keys(source).length > 0 && source.armory !== ARMORY_VERSION;
  const devWipe = source.devWipe !== DEV_WIPE.id && typeof source.pilotName === 'string' && DEV_WIPE.names.includes(normalizePilotName(source.pilotName));
  const keptScores = devWipe ? savedScores.filter((e) => !DEV_WIPE.names.includes(e.name)) : savedScores;
  const reset = legacyArmory || devWipe;

  const paid = reset ? normalizePaid({}, {}) : normalizePaid(source.paid, ranks);
  let cores = reset ? STARTING_CORES : boundedInteger(source.cores, STARTING_CORES);
  const notes = reset ? [] : normalizeRefundNotes(source.refundNotes);
  const hasRevs = source.armoryRevs && typeof source.armoryRevs === 'object' && !Array.isArray(source.armoryRevs);
  const armoryRevs = {};
  for (const u of META_UPGRADES) {
    const current = revisions[u.id] || 1;
    // A save from before revisions existed (or an upgrade new to it) is already at the current revision.
    const saved = hasRevs ? boundedInteger(source.armoryRevs[u.id], current, 1) : current;
    armoryRevs[u.id] = current;
    if (!reset && saved < current && paid[u.id] > 0) {
      cores = Math.min(Number.MAX_SAFE_INTEGER, cores + paid[u.id]);
      notes.push({ id: u.id, name: u.name, cores: paid[u.id] });
      paid[u.id] = 0;
      ranks[u.id] = 0;
    }
  }
  if (!reset) {
    for (const r of retiredRefunds(sourceRanks)) { cores = Math.min(Number.MAX_SAFE_INTEGER, cores + r.cores); notes.push(r); }
  }
  return {
    pilotName: normalizePilotName(source.pilotName),
    cores,
    totalRuns: boundedInteger(source.totalRuns, 0),
    ranks: reset ? Object.fromEntries(META_UPGRADES.map((u) => [u.id, 0])) : ranks,
    paid,
    armoryRevs,
    refundNotes: normalizeRefundNotes(notes),
    armory: ARMORY_VERSION,
    devWipe: DEV_WIPE.id, // the wipe check has run for this save (see DEV_WIPE)
    armoryResetNotice: legacyArmory || source.armoryResetNotice === true,
    guide: normalizeGuide(source.guide),
    highscores: keptScores.length ? topRunsPerMode(keptScores) : DEFAULT_HIGHSCORES.map(entry => ({ ...entry, mode: 'normal' })),
    // Hangar data (js/hangar-save.js) exists only once the Hangar flag created it; a save without it gets none.
    ...(source.hangar !== undefined ? { hangar: normalizeHangar(source.hangar) } : {})
  };
}

export class ProgressionManager {
  constructor() {
    this.data = this.load();
    // Persist a one-time armory reset or developer-pilot wipe right away.
    let wipeCheckPending = false;
    try { wipeCheckPending = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')?.devWipe !== DEV_WIPE.id; } catch { /* unreadable: load() already fell back */ }
    let revsChanged = false;
    try { revsChanged = JSON.stringify(JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')?.armoryRevs) !== JSON.stringify(this.data.armoryRevs); } catch { /* unreadable */ }
    if (this.data.armoryResetNotice || wipeCheckPending || revsChanged) this.save();
    this.onExternalChange = null;
    // Another tab saved: adopt its data so our next save() doesn't overwrite its purchases/scores.
    globalThis.addEventListener?.('storage', (e) => {
      if (e.key !== SAVE_KEY) return;
      this.data = this.load();
      this.onExternalChange?.();
    });
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return normalizeSave(raw ? JSON.parse(raw) : {});
    } catch (e) {
      console.warn('Failed to load save data:', e);
      return normalizeSave({});
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save data:', e);
    }
  }

  setPilotName(name) {
    const clean = normalizePilotName(name);
    this.data.pilotName = clean;
    this.save();
    return clean;
  }

  getRank(id) {
    return this.data.ranks[id] || 0;
  }

  getUpgradeCost(upg) {
    return armoryCost(upg, this.getRank(upg.id));
  }

  canBuy(upg) {
    const rank = this.getRank(upg.id);
    if (rank >= upg.maxRank) return false;
    return this.data.cores >= this.getUpgradeCost(upg);
  }

  buyUpgrade(id) {
    const upg = META_BY_ID[id];
    if (!upg || !this.canBuy(upg)) return false;
    const cost = this.getUpgradeCost(upg);
    this.data.cores -= cost;
    this.data.ranks[id] = this.getRank(id) + 1;
    this.data.paid[id] = (this.data.paid[id] || 0) + cost;
    this.save();
    return true;
  }

  // REFUND ALL: every rank back to 0 and every core spent on them back in the wallet. Returns the refund.
  refundAll() {
    const refund = this.armorySpent();
    if (refund <= 0) return 0;
    this.data.ranks = Object.fromEntries(META_UPGRADES.map((u) => [u.id, 0]));
    this.data.paid = Object.fromEntries(META_UPGRADES.map((u) => [u.id, 0]));
    this.data.cores = Math.min(Number.MAX_SAFE_INTEGER, this.data.cores + refund);
    this.save();
    return refund;
  }

  // Cores actually paid for the current ranks (what REFUND ALL returns).
  armorySpent() {
    return Object.values(this.data.paid).reduce((a, c) => a + c, 0);
  }

  dismissRefundNotes() {
    if (!this.data.refundNotes.length) return;
    this.data.refundNotes = [];
    this.save();
  }

  dismissArmoryNotice() {
    if (!this.data.armoryResetNotice) return;
    this.data.armoryResetNotice = false;
    this.save();
  }

  addCores(amount) {
    this.data.cores = Math.min(Number.MAX_SAFE_INTEGER, this.data.cores + boundedInteger(amount, 0, 0));
    this.save();
  }

  getBonuses() {
    return armoryBonuses(this.data.ranks);
  }

  // The Hangar's save data, created on first use (only while the Hangar flag is on: js/hangar-flag.js).
  // Seeded from this save (runs played, best waves; a save with runs is a veteran).
  hangar() {
    if (!this.data.hangar) {
      this.data.hangar = newHangar(this.data);
      this.save();
    }
    return this.data.hangar;
  }

  isGuideUnlocked(id) {
    return this.data.guide.seen.includes(id);
  }

  // Unlocks guide entries (one save for the batch). Returns the ids that were actually new.
  unlockGuideEntries(ids) {
    const guide = this.data.guide;
    const added = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !GUIDE_ID.test(id) || guide.seen.includes(id) || guide.seen.length >= GUIDE_MAX_IDS) continue;
      guide.seen.push(id);
      guide.fresh.push(id);
      added.push(id);
    }
    if (added.length) this.save();
    return added;
  }

  // Entries the player has now looked at lose their NEW badge.
  markGuideViewed(ids) {
    const guide = this.data.guide;
    const before = guide.fresh.length;
    guide.fresh = guide.fresh.filter(id => !ids.includes(id));
    if (guide.fresh.length !== before) this.save();
  }

  // Saves a finished run on this device's board of its mode. Returns its id and its local rank in that mode.
  recordRun({ name, score, multiplier, wave, kills, timeStr, mode }) {
    this.data.totalRuns++;
    const cleanName = this.setPilotName(name || this.data.pilotName);
    const entryId = globalThis.crypto?.randomUUID?.() || 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const entry = {
      id: entryId,
      name: cleanName,
      score,
      multiplier,
      wave,
      kills,
      timeStr,
      mode: normalizeMode(mode)
    };

    this.data.highscores = topRunsPerMode([...this.data.highscores, entry]);
    this.save();

    const rankIndex = this.data.highscores.filter((h) => h.mode === entry.mode).findIndex((h) => h.id === entryId);
    return {
      entryId,
      rank: rankIndex !== -1 ? rankIndex + 1 : null
    };
  }

  updateHighscoreName(entryId, newName) {
    const cleanName = this.setPilotName(newName);
    const entry = this.data.highscores.find((h) => h.id === entryId);
    if (entry) {
      entry.name = cleanName;
      this.save();
      return true;
    }
    return false;
  }
}
