// Weapon Range: a sandbox on top of the real Game simulation. Pick a loadout (levels, stat ranks,
// elements, Breakthroughs, status cards and synergies), throw out target dummies and read live DPS per damage
// source against each weapon's potential DPS. Weapons fire through the normal code paths, so they
// behave exactly as in a run.
//
// While the range is active the game runs no waves, bosses, lieutenants or level-ups; the ship can't
// be hurt; kills drop nothing (no XP, caches, cores or score) and the run is never recorded or uploaded.
// main.js keeps a handful of one-line hooks (startGame, update, hitEnemy, killEnemy, game over); the
// panel lives in js/weapon-range-ui.js. Everything else here is DOM-free, so tests drive it headless.
import { WEAPON_MAX_LEVEL, BREAKTHROUGH_LEVELS, STAT_CARDS, ELEMENTS, ELEMENT_CARDS, ELEMENT_MAX_RANKS, ELEMENT_WEAPONS, FIXED_ELEMENTS, elementKey, makeBuild } from './weapon-levels.js';
import { WEAPONS, WEAPON_BY_ID, STARTING_WEAPONS, weaponSlots, weaponLevel } from './loadout.js';
import { UPGRADE_BY_ID, acquireWeapon, applyUpgradeLevels, applyBreakthrough, markBreakthroughOffered, loadoutAllows } from './upgrades.js';
import { waveScaleAt, LIGHT_ENEMY_TYPES } from './enemies.js';
import { DAMAGE_SOURCE_COLORS } from './damage-numbers.js';
import { buildSourceGroups } from './run-stats.js';
import { weaponPotentialDps } from './upgrade-cards.js';
import { TUNING } from './config.js';
import { defaultStatsStorage } from './stats-client.js';

export const RANGE_STORAGE_KEY = 'vexolith_weapon_range';

// Rolling DPS window (seconds) and its bucket size.
export const DPS_WINDOW = 5;
const DPS_BUCKET = 0.25;

// "Infinite" dummies: HP far past any hit, topped back up every tick.
export const INFINITE_HP = 1e9;
export const MAX_DUMMIES = 60;
export const MAX_WAVE = 60;
const RESPAWN_DELAY = 1; // seconds before a killed dummy reappears at its post
// Stationary dummies drift back to their post once knockback and gravity pulls let go (per tick).
const HOME_PULL = 0.03;

export const RANGE_FORMATIONS = [
  { id: 'ring', label: 'RING' },
  { id: 'close', label: 'CLOSE' },
  { id: 'pack', label: 'PACK' },
  { id: 'line', label: 'LINE' },
  { id: 'scatter', label: 'SCATTER' }
];

// Every regular hull (bosses stay out: their arrival runs the boss encounter). MIXED cycles them.
export const RANGE_TARGETS = [
  { id: 'swarmer', label: 'SWARMER' },
  { id: 'pinwheel', label: 'PINWHEEL' },
  { id: 'weaver', label: 'WEAVER' },
  { id: 'splitter', label: 'SPLITTER' },
  { id: 'blackhole', label: 'VORTEX' },
  { id: 'bruiser', label: 'BRUISER' },
  { id: 'gunner', label: 'GUNNER' },
  { id: 'shielder', label: 'SHIELDER' },
  { id: 'blinker', label: 'BLINKER' },
  { id: 'conduit', label: 'CONDUIT' },
  { id: 'mixed', label: 'MIXED' }
];
const MIXED_TYPES = RANGE_TARGETS.map((t) => t.id).filter((id) => id !== 'mixed');

export const DUMMY_COUNTS = [1, 3, 6, 12, 24, 40, 60];

// Non-weapon cards the panel can install, by group. Tectonic Claw Bore is left out: it needs asteroids,
// and the range has none.
export const RANGE_MOD_GROUPS = [
  // Elements are per weapon (LOADOUT tab); these are the global STATUS cards that strengthen them.
  { id: 'status', label: 'STATUS', ids: ['status_potency', 'status_application', 'status_duration', 'shock_conductor', 'fire_damage', 'frost_damage', 'corrode_damage', 'shock_damage'] },
  { id: 'synergies', label: 'SYNERGIES', ids: ['evo_pulsar', 'evo_tempest', 'evo_siege', 'evo_emp', 'evo_supercrit'] },
  { id: 'general', label: 'GENERAL', ids: ['overdrive', 'crit_chance', 'crit_damage', 'tag_kinetic', 'tag_explosive', 'tag_electric', 'tag_area', 'shrapnel', 'thrusters'] }
];
export const RANGE_MOD_IDS = RANGE_MOD_GROUPS.flatMap((g) => g.ids);

// Readout names for damage stats (hitEnemy `stat`); weapons not listed use their HUD name.
const STAT_LABELS = {
  blaster: 'Autocannon', helix: 'Pulsar Helix', rocket: 'Rocket Pods', missile: 'Swarm Missiles', storm: 'Storm Protocol',
  lightning: 'Tesla Arc', emp: 'EMP Grenades', singularity: 'Vortex Core', collapse: 'Vortex Collapse', orbital: 'Orbit Blades',
  mine: 'Proximity Mines', turret: 'Sentry Turret', siege: 'Siege Battery', drone: 'Escort Drones', grenade: 'Plasma Grenades', gas: 'Gas Trail', gas_pocket: 'Gas Pockets', gas_shroud: 'Toxic Shroud',
  burn: 'Burn', burn_blaster: 'Autocannon Burn', burn_rockets: 'Rocket Pod Burn', burn_missiles: 'Missile Burn', burn_lightning: 'Tesla Burn',
  burn_grenades: 'Grenade Burn', flame: 'Flamethrower', burn_flamethrower: 'Flamethrower Burn', corrode: 'Acid', shock: 'Shock Arcs', cryo: 'Cryo Sprayer', acid: 'Acid Sprayer', fireball: 'Fireballs', shatter: 'Shatter', meltdown: 'Meltdown',
  corrode_gas: 'Gas Trail Acid', shock_shockfield: 'Shock Field Arcs', shockfield: 'Shock Field', fieldlash: 'Arc Lash', thunderclap: 'Thunderclap', glaive: 'Glaive Discs', glaive_recall: 'Boomerang Recall', shrapnel: 'Volatile Shatter', nova: 'Phase Nova', supernova: 'Supernova', blackhole: 'Vortex Burst', other: 'Other'
};
// Status DoT ticks: '<weapon> Burn' / '<weapon> Acid' / '<weapon> Shock' unless named above.
const DOT_LABEL = { burn: 'Burn', corrode: 'Acid', shock: 'Shock' };
for (const w of WEAPONS) for (const dot of Object.keys(DOT_LABEL)) STAT_LABELS[`${dot}_${w.id}`] ||= `${w.hudName} ${DOT_LABEL[dot]}`;
const STAT_GROUP = buildSourceGroups(WEAPONS);
// Weapon credited with each stat in the LIVE / POTENTIAL compare. Status DoT ticks are left out: a weapon's
// potential DPS does not count its element.
const WEAPON_OF = { ...STAT_GROUP, burn: null, corrode: null, shock: null,
  ...Object.fromEntries([...ELEMENT_WEAPONS, ...Object.keys(FIXED_ELEMENTS)].flatMap((id) => ['burn', 'corrode', 'shock'].map((dot) => [`${dot}_${id}`, null]))) };

const clampInt = (v, lo, hi, fallback = lo) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const pick = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);

// --- Builds from the panel config -------------------------------------------------------------

// The ranks a weapon at `level` gets in AUTO mode: level - 1 ranks dealt round-robin over its stat
// cards in card order (Damage first), skipping cards at their cap. Keyed by stat card id.
export function autoRanks(id, level) {
  const cards = STAT_CARDS[id] || [];
  const out = Object.fromEntries(cards.map((c) => [c.id, 0]));
  let left = clampInt(level, 1, WEAPON_MAX_LEVEL) - 1;
  while (left > 0) {
    let placed = false;
    for (const c of cards) {
      if (left > 0 && out[c.id] < c.maxLevel) {
        out[c.id]++;
        left--;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return out;
}

// CUSTOM ranks, each within its card cap and all together within the LV 18 weapon cap (card order wins).
// `budget` is the ranks left for stat cards (an element's ranks take their share first).
export function clampRanks(id, ranks = {}, budget = WEAPON_MAX_LEVEL - 1) {
  const out = {};
  for (const c of STAT_CARDS[id] || []) {
    const n = Math.min(clampInt(ranks[c.id], 0, c.maxLevel, 0), budget);
    out[c.id] = n;
    budget -= n;
  }
  return out;
}

// The entry's element ({ element, rank }) or null: only element-capable weapons take one. Its rank counts
// toward the weapon level like a stat card's (weapon-levels.js ELEMENT_CARDS).
export function entryElement(w) {
  if (!ELEMENT_CARDS[w?.id] || !ELEMENTS.includes(w.element)) return null;
  return { element: w.element, rank: clampInt(w.elementRank, 1, ELEMENT_MAX_RANKS, 1) };
}
const elementRanks = (w) => entryElement(w)?.rank || 0;

// Stat card ranks an entry installs, and the weapon level they give (LV 1 for equipping it, plus its
// element's ranks). AUTO deals the level's ranks to the element first, then round-robin to the stats.
export const entryRanks = (w) => (w.custom
  ? clampRanks(w.id, w.ranks, WEAPON_MAX_LEVEL - 1 - elementRanks(w))
  : autoRanks(w.id, Math.max(1, w.level - elementRanks(w))));
export const entryLevel = (w) => 1 + Object.values(entryRanks(w)).reduce((a, b) => a + b, 0) + elementRanks(w);

// Breakthroughs an entry has at its level (each milestone reached: its choice, TRANSFORM by default).
export function entryBreakthroughs(w) {
  const lv = entryLevel(w);
  const out = {};
  for (const m of BREAKTHROUGH_LEVELS) if (lv >= m) out[m] = w.bt?.[m] === 'boost' ? 'boost' : 'transform';
  return out;
}

// The weapon build the formulas will see once the entry is installed (weapon-levels.js makeBuild).
export function entryBuild(w) {
  const byStat = {};
  const ranks = entryRanks(w);
  for (const c of STAT_CARDS[w.id] || []) byStat[c.stat] = ranks[c.id] || 0;
  return makeBuild(w.id, entryLevel(w), byStat, entryBreakthroughs(w));
}

export function defaultRangeConfig() {
  return {
    weapons: STARTING_WEAPONS.map((id) => ({ id, level: 1, custom: false, ranks: clampRanks(id), bt: {}, element: null, elementRank: 1 })),
    mods: {},
    dummies: { count: 12, formation: 'ring', type: 'swarmer', hp: 'infinite', wave: 6, move: 'still', respawn: true }
  };
}

// Any stored or hand-edited config -> a valid one (unknown weapons and mods dropped, numbers clamped).
export function sanitizeRangeConfig(raw) {
  const def = defaultRangeConfig();
  const src = raw && typeof raw === 'object' ? raw : {};
  const weapons = [];
  for (const w of Array.isArray(src.weapons) ? src.weapons : def.weapons) {
    if (!w || !WEAPON_BY_ID[w.id] || weapons.some((x) => x.id === w.id) || weapons.length >= weaponSlots()) continue;
    const bt = {};
    for (const m of BREAKTHROUGH_LEVELS) if (w.bt?.[m] === 'boost' || w.bt?.[m] === 'transform') bt[m] = w.bt[m];
    const custom = w.custom === true;
    const element = ELEMENT_CARDS[w.id] && ELEMENTS.includes(w.element) ? w.element : null;
    const elementRank = clampInt(w.elementRank, 1, ELEMENT_MAX_RANKS, 1);
    const ranks = clampRanks(w.id, w.ranks && typeof w.ranks === 'object' ? w.ranks : {}, WEAPON_MAX_LEVEL - 1 - (element ? elementRank : 0));
    weapons.push({ id: w.id, level: clampInt(w.level, 1, WEAPON_MAX_LEVEL, 1), custom, ranks, bt, element, elementRank });
  }
  const mods = {};
  for (const id of RANGE_MOD_IDS) {
    const lv = clampInt(src.mods?.[id], 0, UPGRADE_BY_ID[id]?.maxLevel ?? 0, 0);
    if (lv > 0) mods[id] = lv;
  }
  const d = src.dummies && typeof src.dummies === 'object' ? src.dummies : {};
  const dd = def.dummies;
  const dummies = {
    count: clampInt(d.count, 1, MAX_DUMMIES, dd.count),
    formation: pick(d.formation, RANGE_FORMATIONS, dd.formation),
    type: pick(d.type, RANGE_TARGETS, dd.type),
    hp: d.hp === 'wave' ? 'wave' : 'infinite',
    wave: clampInt(d.wave, 1, MAX_WAVE, dd.wave),
    move: d.move === 'ai' ? 'ai' : 'still',
    respawn: d.respawn !== false
  };
  return { weapons, mods, dummies };
}

// Storage may be missing or blocked (even reading `localStorage` can throw): the range then starts from
// the defaults every time.
export function loadRangeConfig(storage = defaultStatsStorage()) {
  try {
    const text = storage?.getItem(RANGE_STORAGE_KEY);
    if (text) return sanitizeRangeConfig(JSON.parse(text));
  } catch (_e) { /* Storage may be blocked, or hold something unreadable. */ }
  return defaultRangeConfig();
}

export function saveRangeConfig(config, storage = defaultStatsStorage()) {
  try {
    storage?.setItem(RANGE_STORAGE_KEY, JSON.stringify(config));
  } catch (_e) {}
}

// Rebuild the ship from its run-start snapshot (upgrades.js snapshotBase) with exactly the panel's
// loadout: each weapon equipped and its stat cards installed through applyUpgradeLevels, its
// Breakthroughs recorded, then the mods the loadout allows (a synergy needs all of its weapons).
export function applyRangeLoadout(p, config) {
  if (p.base) {
    p.stats = structuredClone(p.base.stats);
    p.weapons = structuredClone(p.base.weapons);
    p.maxHp = p.base.maxHp;
  }
  p.upgradeLevels = {};
  p.loadout = [];
  p.breakthroughs = {};
  p.breakthroughsOffered = {};
  for (const w of config.weapons) {
    if (!acquireWeapon(p, w.id)) continue;
    for (const [cardId, n] of Object.entries(entryRanks(w))) {
      if (n > 0) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[cardId], levelJump: n });
    }
    const el = entryElement(w);
    if (el) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[elementKey(w.id, el.element)], levelJump: el.rank });
    const lv = weaponLevel(p, w.id);
    for (const [m, kind] of Object.entries(entryBreakthroughs(w))) {
      if (lv < Number(m)) continue;
      applyBreakthrough(p, w.id, Number(m), kind);
      markBreakthroughOffered(p, w.id, Number(m));
    }
  }
  for (const id of RANGE_MOD_IDS) {
    const u = UPGRADE_BY_ID[id];
    const lv = config.mods?.[id] || 0;
    if (u && lv > 0 && loadoutAllows(p, u)) applyUpgradeLevels(p, { ...u, levelJump: lv });
  }
  p.hp = p.maxHp;
  return p;
}

// --- Dummy formations -------------------------------------------------------------------------

// Spawn points around (x, y): RING round the ship, a CLOSE ring inside the Shock Field and the Orbit Blade ring, a tight PACK
// ahead of it, a LINE stretching away along the aim (a pierce test) or a random SCATTER. `angle` is the
// ship's aim; `bounds` keeps points inside the world.
export function formationPoints(formation, count, { x, y, angle = 0, bounds = null } = {}, rand = Math.random) {
  const n = clampInt(count, 1, MAX_DUMMIES);
  const ax = Math.cos(angle), ay = Math.sin(angle);
  const pts = [];
  for (let i = 0; i < n; i++) {
    let px, py;
    if (formation === 'pack') {
      // Sunflower spiral round a centre 340 px ahead: even spacing at any count.
      const r = 21 * Math.sqrt(i + 0.5);
      const a = i * 2.39996;
      px = x + ax * 340 + Math.cos(a) * r;
      py = y + ay * 340 + Math.sin(a) * r;
    } else if (formation === 'line') {
      const gap = Math.max(22, Math.min(46, 900 / n));
      px = x + ax * (170 + i * gap);
      py = y + ay * (170 + i * gap);
    } else if (formation === 'scatter') {
      const inner = 160, outer = 560;
      const r = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner));
      const a = rand() * Math.PI * 2;
      px = x + Math.cos(a) * r;
      py = y + Math.sin(a) * r;
    } else {
      const r = formation === 'close' ? Math.max(112, (n * 30) / (Math.PI * 2)) : Math.max(240, (n * 46) / (Math.PI * 2));
      const a = angle + (i / n) * Math.PI * 2;
      px = x + Math.cos(a) * r;
      py = y + Math.sin(a) * r;
    }
    if (bounds) {
      px = Math.max(bounds.pad, Math.min(bounds.width - bounds.pad, px));
      py = Math.max(bounds.pad, Math.min(bounds.height - bounds.pad, py));
    }
    pts.push({ x: px, y: py });
  }
  return pts;
}

// --- DPS meter ----------------------------------------------------------------------------------

// Damage per key over a rolling window, in DPS_BUCKET slices, plus totals since the last reset.
// `now` is simulation time in seconds (a paused game stops the clock).
export class DpsMeter {
  constructor({ window = DPS_WINDOW, bucket = DPS_BUCKET } = {}) {
    this.window = window;
    this.bucket = bucket;
    this.reset(0);
  }

  reset(now = 0) {
    this.start = now;
    this.buckets = []; // [{ i, sums: { key: dmg } }], oldest first
    this.totals = {};
    this.total = 0;
  }

  record(key, dmg, now) {
    if (!(dmg > 0)) return;
    const i = Math.floor(now / this.bucket);
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.i !== i) {
      b = { i, sums: {} };
      this.buckets.push(b);
      const oldest = i - Math.ceil(this.window / this.bucket);
      while (this.buckets.length && this.buckets[0].i <= oldest) this.buckets.shift();
    }
    b.sums[key] = (b.sums[key] || 0) + dmg;
    this.totals[key] = (this.totals[key] || 0) + dmg;
    this.total += dmg;
  }

  // { byKey: { key: dps }, total: dps } over the buckets inside the window (or since the reset).
  rates(now) {
    const first = Math.floor((now - this.window) / this.bucket) + 1;
    const span = Math.max(this.bucket, now - Math.max(this.start, first * this.bucket));
    const byKey = {};
    let total = 0;
    for (const b of this.buckets) {
      if (b.i < first) continue;
      for (const [k, v] of Object.entries(b.sums)) {
        byKey[k] = (byKey[k] || 0) + v / span;
        total += v / span;
      }
    }
    return { byKey, total };
  }

  elapsed(now) {
    return Math.max(0, now - this.start);
  }
}

// --- Range controller ---------------------------------------------------------------------------

export class WeaponRange {
  constructor(game, { storage = defaultStatsStorage() } = {}) {
    this.game = game;
    this.storage = storage;
    this.active = false;
    this.config = loadRangeConfig(storage);
    this.meter = new DpsMeter();
    this.sources = {}; // stat -> hitEnemy source (colours stats without their own, e.g. helix, emp)
    this.respawns = [];
    this.potential = {}; // weapon id -> potential DPS of the installed build
    this.view = null; // RangePanel (js/weapon-range-ui.js) in the browser
    this.viewTick = 0;
  }

  get now() {
    return this.game.elapsedTime || 0;
  }

  // From the title screen: the panel, then a fresh run that startGame hands back to onRunStart.
  enter() {
    this.active = true;
    this.view?.show();
    this.game.startGame();
  }

  exit() {
    this.active = false;
    this.respawns = [];
    this.view?.hide();
    this.game.returnToTitle();
  }

  // Called by startGame instead of the first wave: an empty field, the panel's loadout and dummies.
  onRunStart() {
    const am = this.game.asteroidManager;
    am.asteroids = [];
    am.rebuildSpatialHash();
    this.respawns = [];
    this.applyLoadout();
    this.resetMeter();
    this.spawnDummies();
    this.view?.render();
  }

  // Replace the config (the panel edits a copy) and apply it live.
  setConfig(next) {
    const before = this.config.dummies;
    this.config = sanitizeRangeConfig(next);
    saveRangeConfig(this.config, this.storage);
    if (!this.active) return;
    this.applyLoadout();
    const d = this.config.dummies;
    if (d.hp !== before.hp || d.wave !== before.wave || d.move !== before.move) this.restyleDummies();
  }

  applyLoadout() {
    const g = this.game;
    applyRangeLoadout(g.player, this.config);
    g.wave = this.config.dummies.wave; // splitter children and wave-scaled numbers follow the HP wave
    this.potential = {};
    for (const id of g.player.loadout) this.potential[id] = weaponPotentialDps(g.player, id) || 0;
  }

  resetMeter() {
    this.meter.reset(this.now);
  }

  // Throw out `count` dummies in the chosen formation around the ship.
  spawnDummies() {
    const g = this.game;
    const d = this.config.dummies;
    const p = g.player;
    const pts = formationPoints(d.formation, d.count, { x: p.x, y: p.y, angle: p.angle || 0, bounds: { width: g.worldWidth, height: g.worldHeight, pad: 40 } });
    let n = 0;
    pts.forEach((pt, i) => {
      if (this.spawnDummy(d.type === 'mixed' ? MIXED_TYPES[i % MIXED_TYPES.length] : d.type, pt.x, pt.y)) n++;
    });
    return n;
  }

  // Queue one dummy through the normal spawn path; its tag (copied onto the enemy) holds its post,
  // its normal speed and its wave HP so movement and HP settings can change live.
  spawnDummy(type, x, y) {
    const em = this.game.enemyManager;
    const d = this.config.dummies;
    if (!em.queueSpawn(type, x, y, waveScaleAt(d.wave, { light: LIGHT_ENEMY_TYPES.has(type) }), { instant: true })) return false;
    const c = em.spawnIndicators[em.spawnIndicators.length - 1].config;
    c.tag = { range: true, type, homeX: x, homeY: y, speed: c.speed, hp: c.maxHp };
    this.styleDummy(c);
    return true;
  }

  // HP and movement settings on a dummy (or its spawn config). `refill` resets wave HP to full.
  styleDummy(e, refill = false) {
    const d = this.config.dummies;
    const tag = e.tag;
    e.speed = d.move === 'still' ? 0 : tag.speed;
    if (d.hp === 'infinite') e.maxHp = e.hp = INFINITE_HP;
    else if (refill || e.maxHp === INFINITE_HP) e.maxHp = e.hp = tag.hp;
  }

  restyleDummies() {
    const em = this.game.enemyManager;
    const wave = this.config.dummies.wave;
    const hpMult = TUNING.enemyHpMult ?? 1;
    const each = (tag, target) => {
      tag.hp = em.getArchetype(tag.type, waveScaleAt(wave, { light: LIGHT_ENEMY_TYPES.has(tag.type) })).maxHp * hpMult;
      this.styleDummy(target, true);
    };
    for (const e of em.enemies) if (e.tag?.range) each(e.tag, e);
    for (const sp of em.spawnIndicators) if (sp.config.tag?.range) each(sp.config.tag, sp.config);
  }

  clearDummies() {
    this.game.enemyManager.clear();
    this.respawns = [];
  }

  // Once per simulation tick while the range is active (instead of waves and spawns).
  tick() {
    const g = this.game;
    const p = g.player;
    p.hp = p.maxHp;
    const d = this.config.dummies;
    for (const e of g.enemyManager.enemies) {
      const tag = e.tag;
      if (!tag?.range) continue;
      if (d.hp === 'infinite') e.hp = e.maxHp;
      if (d.move === 'still' && !e.knockX && !e.knockY && Math.abs(e.gvx || 0) + Math.abs(e.gvy || 0) < 0.05) {
        e.x += (tag.homeX - e.x) * HOME_PULL;
        e.y += (tag.homeY - e.y) * HOME_PULL;
      }
    }
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      if (this.now < r.at) continue;
      this.respawns.splice(i, 1);
      if (this.active) this.spawnDummy(r.type, r.x, r.y);
    }
    if ((++this.viewTick % 12) === 0) this.view?.tick();
  }

  // Game.hitEnemy: damage that landed (after armour, crits and corrosion; overkill included).
  recordHit(stat, source, dmg) {
    this.meter.record(stat, dmg, this.now);
    this.sources[stat] = source;
  }

  // Game.killEnemy: a range dummy comes back at its post a moment later.
  onKill(e) {
    if (!e.tag?.range || !this.config.dummies.respawn) return;
    this.respawns.push({ type: e.tag.type, x: e.tag.homeX, y: e.tag.homeY, at: this.now + RESPAWN_DELAY });
  }

  // Everything the readout shows: rolling DPS per damage stat and in total, damage since the reset,
  // and per weapon its live DPS (all of its stats) against the build's potential DPS.
  readout() {
    const now = this.now;
    const { byKey, total } = this.meter.rates(now);
    const keys = new Set([...Object.keys(this.meter.totals), ...Object.keys(byKey)]);
    const rows = [...keys].map((stat) => {
      const source = this.sources[stat] || stat;
      const group = STAT_GROUP[stat];
      return {
        stat,
        label: STAT_LABELS[stat] || WEAPON_BY_ID[group]?.hudName || stat,
        color: DAMAGE_SOURCE_COLORS[stat] || DAMAGE_SOURCE_COLORS[source] || WEAPON_BY_ID[group]?.color || DAMAGE_SOURCE_COLORS.other,
        dps: byKey[stat] || 0,
        dealt: this.meter.totals[stat] || 0
      };
    }).sort((a, b) => b.dps - a.dps || b.dealt - a.dealt);
    const p = this.game.player;
    const weapons = (p?.loadout || []).map((id) => {
      let live = 0;
      for (const [stat, v] of Object.entries(byKey)) if (WEAPON_OF[stat] === id) live += v;
      const w = WEAPON_BY_ID[id];
      return { id, name: w.hudName, color: w.color, level: weaponLevel(p, id), potential: this.potential[id] || 0, live };
    });
    const elapsed = this.meter.elapsed(now);
    return {
      total,
      dealt: this.meter.total,
      elapsed,
      average: elapsed > 0 ? this.meter.total / elapsed : 0,
      potential: weapons.reduce((a, w) => a + w.potential, 0),
      rows,
      weapons
    };
  }
}
