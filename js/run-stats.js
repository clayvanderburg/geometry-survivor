// In-run gameplay statistics: who dealt the damage, what killed the ship, which cards were offered and
// picked. Pure (no DOM, no game imports) so tests, the headless balance sim and the browser share it.
// The game feeds it from a handful of one-line hooks in main.js; finish() returns the run summary that
// the RUN REPORT draws and js/stats-client.js uploads (schema in js/stats-rules.js).
//
// Damage attribution: every weapon hit carries a `stat` id (normally the hitEnemy `source`; a few
// sub-sources are split out: 'burn_<weapon>', 'corrode_<weapon>', 'shock_<weapon>', 'helix', 'storm', 'collapse', 'siege'). Each stat id belongs to a
// group: a loadout weapon (by its `tagSources`, see buildSourceGroups) or a non-weapon group such as
// 'shrapnel', 'nova', 'supernova' or 'ram'. Unknown ids are their own group, so a new weapon shows up
// without changes here. Damage is effective damage (overkill excluded), counted once per hit.
//
// Per weapon level: while a weapon sits at level L the tracker sums seconds, damage, damage in units of
// the player's base damage (DPS_TARGET is expressed in those units), the damage and kills of ALL
// sources in the same window (for "share while at LV L") and the weapon's own kills. Levels are
// sampled by the game (sync) a few times a second, so a change lands within ~0.25 s of play.

// Sub-sources that belong to a weapon even though they are not one of its tagSources.
export const SUB_SOURCES = Object.freeze({
  burn: 'blaster',        // burn ticks from before v0.34 (only Autocannon could burn)
  // Status DoT ticks (FIRE burn, CORROSIVE acid, SHOCK while touching), credited to the weapon whose
  // hits applied the stacks (status-effects.js): burn_<weapon>, corrode_<weapon>, shock_<weapon>.
  ...Object.fromEntries(['blaster', 'rockets', 'missiles', 'lightning', 'grenades', 'gas', 'flamethrower', 'shockfield', 'cryospray', 'acidspray', 'nanites']
    .flatMap((id) => ['burn', 'corrode', 'shock'].map((dot) => [`${dot}_${id}`, id]))),
  helix: 'blaster',       // Pulsar Helix bolts (Autocannon evolution)
  storm: 'missiles',      // Storm Protocol chain lightning, fired by missile detonations
  collapse: 'singularity',// Vortex Singularity collapse pulse
  siege: 'turret',        // Siege Battery shell bursts on turret bolts
  emp: 'grenades',        // EMP Grenades arcs, fired by Plasma Grenade blasts
  gas_pocket: 'gas',      // Corrosive Gas Trail: Volatile Pockets bursts
  gas_shroud: 'gas',      // Corrosive Gas Trail: Toxic Shroud ticks
  fireball: 'flamethrower', // Flamethrower Fireballs (LV 6 Breakthrough)
  shatter: 'cryospray',   // Cryo Sprayer Shatter bursts
  meltdown: 'acidspray',  // Acid Sprayer Meltdown splashes
  fieldlash: 'shockfield',   // Arc Lash arcs (Electric Shield Field Breakthrough)
  thunderclap: 'shockfield', // Thunderclap Overcharge bursts (Electric Shield Field Breakthrough)
  ionwake: 'raillance',      // Ion Wake ticks (Rail Lance Breakthrough)
  overload: 'raillance',      // Overload Shot beams (Rail Lance Breakthrough)
  glaive_recall: 'glaive',   // Boomerang Recall return-trip slices (Glaive Discs Breakthrough)
  nanite_fission: 'nanites', // Nanite Swarm: Fission Bloom daughter swarms
  nanite_plague: 'nanites',   // Nanite Swarm: Nanite Plague swarms
  harpooncrush: 'harpoon',  // Claw Harpoon: a reeled-in catch crushed in the other claw
  harpoonslam: 'harpoon',   // Claw Harpoon: Seismic Slam (LV 6 Breakthrough)
  harpoonspin: 'harpoon',   // Claw Harpoon: Drill Spin (LV 12 Breakthrough)
  harpoonchain: 'harpoon',   // Claw Harpoon: Chain Harpoon leaps (LV 18 Breakthrough)
  quake_skip: 'quake',       // Graviton Mortar: Rebound Pulse waves
  quake_fault: 'quake',      // Graviton Mortar: Spacetime Fractures snapping shut
  quake_epicenter: 'quake'   // Graviton Mortar: Graviton Surge waves
});

// Damage that is not a loadout weapon's.
export const OTHER_GROUPS = Object.freeze({
  shrapnel: 'shrapnel',   // Volatile Shatter (passive)
  nova: 'nova',           // Phase Nova dash burst
  tectonic: 'tectonic',   // Tectonic Claw Bore drill blasts
  supernova: 'supernova', // bomb
  blackhole: 'hazard',    // a dying Vortex's burst hitting other enemies
  ram: 'ram',             // enemies that popped on the shield
  other: 'other'
});

// stat id -> group id. `weapons` is loadout.js WEAPONS (id + tagSources).
export function buildSourceGroups(weapons = []) {
  const map = { ...OTHER_GROUPS, ...SUB_SOURCES };
  for (const w of weapons) {
    map[w.id] = w.id;
    for (const s of w.tagSources || []) map[s] = w.id;
  }
  return Object.freeze(map);
}

// Bosses are their own type ('boss' for the Dreadnought stand-in); a boss's body plates count as the boss.
export const enemyKind = (e) => (e?.isBoss ? String(e.type || 'boss')
  : typeof e?.bossBody === 'string' ? e.bossBody
  : e?.isLieutenant ? 'lieutenant' : String(e?.type || 'unknown'));

const LIMIT = { levelTimes: 200, timeline: 40, groups: 32, kinds: 40, cards: 160, sources: 40 };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r0 = (v) => Math.round(v);

export class RunStats {
  // dpsTarget(lv): the design potential DPS (x base damage) at a weapon level; onCurve(id): whether the
  // weapon is held to it. Both come from js/weapon-scaling.js in the game; tests pass their own.
  // mode: the run's game mode id (js/modes.js), carried into the summary so stats can tell modes apart.
  constructor({ version = '', mode = 'normal', groups = buildSourceGroups(), dpsTarget = null, onCurve = () => false } = {}) {
    this.version = version;
    this.mode = mode;
    this.groupOf = groups;
    this.dpsTarget = typeof dpsTarget === 'function' ? dpsTarget : null;
    this.onCurve = onCurve;
    this.groups = new Map();  // group -> record
    this.sources = new Map(); // stat -> damage
    this.enemies = new Map(); // kind -> [spawned, killed, ttkSum, ttkN, dmgToPlayer, hitsOnPlayer]
    // card id -> [offered, picked, eligible hands, expected random draws, random draws]: the last three
    // measure fairness (drawn vs expected, given only the hands where the card could appear).
    this.cards = new Map();
    this.weaponPicks = new Map(); // weapon id -> same row, for the NEW WEAPON pick
    this.totalDmg = 0;
    this.totalKills = 0;
    this.baseDamage = 1;
    this.levelTimes = [];
    this.lastLevel = 1;
    this.rerolls = 0;
    this.locks = 0;
    this.cause = null;
    this.finished = null;
  }

  group(id) {
    let rec = this.groups.get(id);
    if (!rec) {
      if (this.groups.size >= LIMIT.groups) id = 'other';
      rec = this.groups.get(id);
      if (!rec) {
        rec = { id, dmg: 0, kills: 0, lv: 0, since: 0, acquired: null, owned: 0, cur: null, levels: new Map(), timeline: [] };
        this.groups.set(id, rec);
      }
    }
    return rec;
  }

  // One landed hit (amount = effective damage). Called from Game.hitEnemy; must stay cheap.
  damage(stat, amount) {
    if (!(amount > 0)) return;
    const id = this.groupOf[stat] || stat;
    const rec = this.groups.get(id) || this.group(id);
    rec.dmg += amount;
    this.totalDmg += amount;
    const cur = rec.cur;
    if (cur) {
      cur.dmg += amount;
      cur.norm += amount / this.baseDamage;
    }
    if (this.sources.size < LIMIT.sources || this.sources.has(stat)) this.sources.set(stat, (this.sources.get(stat) || 0) + amount);
  }

  enemyRow(kind) {
    let row = this.enemies.get(kind);
    if (!row) {
      if (this.enemies.size >= LIMIT.kinds) kind = 'other';
      row = this.enemies.get(kind) || [0, 0, 0, 0, 0, 0];
      this.enemies.set(kind, row);
    }
    return row;
  }

  enemySpawned(e, t) {
    if (!e) return;
    e.spawnedAt = t;
    this.enemyRow(enemyKind(e))[0]++;
  }

  // A kill. `stat` is the killing blow's stat id; t is run time (for spawn -> death time-to-kill).
  kill(stat, e, t) {
    const id = this.groupOf[stat] || stat;
    const rec = this.groups.get(id) || this.group(id);
    rec.kills++;
    if (rec.cur) rec.cur.kills++;
    this.totalKills++;
    const row = this.enemyRow(enemyKind(e));
    row[1]++;
    if (Number.isFinite(e?.spawnedAt) && t >= e.spawnedAt) {
      row[2] += t - e.spawnedAt;
      row[3]++;
    }
  }

  // Shield damage taken from an enemy of `kind`; `fatal` marks the hit that ended the run.
  playerHit(kind, amount, fatal = false) {
    if (!(amount > 0)) return;
    const row = this.enemyRow(kind || 'unknown');
    row[4] += amount;
    row[5]++;
    if (fatal) this.cause = kind || 'unknown';
  }

  // --- Cards ---------------------------------------------------------------------------------------
  // Cards shown in a level-up hand (ids; 'new_weapon' is the NEW WEAPON card). skip: a card already
  // counted (the locked card staying through a reroll).
  offered(cards, skip = null) {
    for (const c of cards || []) {
      if (!c || c === skip || typeof c.id !== 'string') continue;
      if (c.isWeaponPick) {
        this.bump(this.weaponPicks, c.weaponId, 0);
      } else this.bump(this.cards, c.id, 0);
    }
  }

  // One random draw: `odds` (Map id -> chance, every eligible card) and the cards it actually drew.
  handOdds(odds, drawn = [], map = this.cards) {
    for (const [id, p] of odds || []) {
      const row = this.row(map, id);
      if (!row) continue;
      row[2]++;
      row[3] += p;
    }
    for (const c of drawn) {
      const row = this.row(map, c.isWeaponPick ? c.weaponId : c.id);
      if (row) row[4]++;
    }
  }

  // The NEW WEAPON pick shows `shown` of the unequipped weapons, uniformly.
  weaponPickOdds(unowned, shown) {
    const n = (unowned || []).length;
    if (!n) return;
    const p = Math.min(1, (shown || []).length / n);
    this.handOdds(new Map(unowned.map((id) => [id, p])), shown, this.weaponPicks);
  }

  picked(card) {
    if (!card) return;
    if (card.isWeaponPick) this.bump(this.weaponPicks, card.weaponId, 1);
    else if (typeof card.id === 'string') this.bump(this.cards, card.id, 1);
  }

  row(map, id) {
    if (typeof id !== 'string') return null;
    let row = map.get(id);
    if (!row) {
      if (map.size >= LIMIT.cards) return null;
      row = [0, 0, 0, 0, 0];
      map.set(id, row);
    }
    return row;
  }

  bump(map, id, slot) {
    const row = this.row(map, id);
    if (row) row[slot]++;
  }

  reroll() { this.rerolls++; }
  banish() { this.banishes = (this.banishes || 0) + 1; }
  skip() { this.skips = (this.skips || 0) + 1; }
  lock() { this.locks++; }

  // --- Levels --------------------------------------------------------------------------------------
  // Player level reached at time t (every level in between is stamped at t).
  levelReached(level, t) {
    while (this.lastLevel < level) {
      this.lastLevel++;
      if (this.levelTimes.length < LIMIT.levelTimes) this.levelTimes.push(r1(t));
    }
  }

  // levels: { weaponId: level } for every equipped weapon. Weapons missing from it were discarded.
  // baseDamage: the player's base damage per hit (DPS_TARGET units).
  sync(levels, t, baseDamage = this.baseDamage) {
    // Normalized damage is divided per hit, so a damage upgrade only affects hits after it.
    if (baseDamage > 0) this.baseDamage = baseDamage;
    for (const rec of this.groups.values()) {
      if (rec.lv > 0 && !(levels && rec.id in levels)) this.setLevel(rec, 0, t);
    }
    if (!levels) return;
    for (const id in levels) {
      const lv = Math.max(0, Math.floor(levels[id]) || 0);
      const rec = this.group(id);
      if (rec.lv !== lv) this.setLevel(rec, lv, t);
    }
  }

  setLevel(rec, lv, t) {
    this.closeSegment(rec, t);
    if (rec.lv === 0 && lv > 0 && rec.acquired === null) rec.acquired = t;
    rec.lv = lv;
    rec.since = t;
    if (rec.timeline.length < LIMIT.timeline) rec.timeline.push([r1(t), lv]);
    if (lv > 0) {
      let bucket = rec.levels.get(lv);
      if (!bucket) {
        bucket = { secs: 0, dmg: 0, norm: 0, allDmg: 0, kills: 0, allKills: 0 };
        rec.levels.set(lv, bucket);
      }
      bucket.dmg0 = this.totalDmg;
      bucket.kills0 = this.totalKills;
      rec.cur = bucket;
    } else rec.cur = null;
  }

  closeSegment(rec, t) {
    const cur = rec.cur;
    if (!cur || rec.lv <= 0) return;
    const dt = Math.max(0, t - rec.since);
    cur.secs += dt;
    rec.owned += dt;
    cur.allDmg += this.totalDmg - cur.dmg0;
    cur.allKills += this.totalKills - cur.kills0;
    cur.dmg0 = this.totalDmg;
    cur.kills0 = this.totalKills;
    rec.since = t;
  }

  // Ends the run and returns the summary (see js/stats-rules.js for the field list). Idempotent.
  // `armory`: { ranks: { id: rank }, spent } of the Void Armory the run was flown with (omitted: not sent).
  finish({ time = 0, wave = 1, level = 1, score = 0, kills = 0, died = true, gold = {}, loadout = [], armory = null } = {}) {
    if (this.finished) return this.finished;
    for (const rec of this.groups.values()) this.closeSegment(rec, time);
    const weapons = {};
    for (const rec of this.groups.values()) {
      if (!(rec.dmg > 0) && !rec.kills && !rec.levels.size) continue;
      const out = { dmg: r0(rec.dmg), kills: rec.kills };
      if (rec.levels.size) {
        out.owned = r1(rec.owned);
        out.from = r1(rec.acquired ?? 0);
        out.curve = this.onCurve(rec.id) ? 1 : 0;
        out.tl = rec.timeline;
        out.lv = {};
        for (const [lv, b] of [...rec.levels].sort((a, b) => a[0] - b[0])) {
          if (!(b.secs > 0)) continue;
          const target = this.dpsTarget && out.curve ? r2(this.dpsTarget(lv)) : 0;
          // [seconds, damage, damage / base damage, all damage, kills, all kills, DPS_TARGET(lv)]
          out.lv[lv] = [r1(b.secs), r0(b.dmg), r2(b.norm), r0(b.allDmg), b.kills, b.allKills, target];
        }
      }
      weapons[rec.id] = out;
    }
    const pairs = (map) => Object.fromEntries([...map].map(([k, v]) => [k, [v[0], v[1], v[2], Math.round(v[3] * 1000) / 1000, v[4]]]));
    this.finished = {
      schema: 1,
      version: this.version,
      mode: this.mode,
      time: r1(time),
      wave: Math.floor(wave),
      level: Math.floor(level),
      score: Math.floor(score),
      kills: Math.floor(kills),
      died: !!died,
      cause: died ? this.cause || 'unknown' : null,
      levelTimes: [...this.levelTimes],
      gold: { earned: r0(gold.earned || 0), spent: r0(gold.spent || 0), rerolls: this.rerolls, locks: this.locks, banishes: this.banishes || 0, skips: this.skips || 0 },
      loadout: (loadout || []).map(({ id, lv }) => ({ id, lv })),
      weapons,
      sources: Object.fromEntries([...this.sources].map(([k, v]) => [k, r0(v)])),
      // [spawned, killed, spawn->death seconds summed, deaths timed, damage to player, hits on player]
      enemies: Object.fromEntries([...this.enemies].map(([k, v]) => [k, [v[0], v[1], r1(v[2]), v[3], r0(v[4]), v[5]]])),
      cards: pairs(this.cards),
      weaponPicks: pairs(this.weaponPicks)
    };
    if (armory) {
      this.finished.armory = Object.fromEntries(Object.entries(armory.ranks || {}).filter(([, r]) => r > 0));
      this.finished.armorySpent = Math.max(0, Math.round(armory.spent || 0));
    }
    return this.finished;
  }
}
