// Weapon levels 1-12, single-stat cards and Breakthroughs.
//
// Every slot weapon (Autocannon included) has a level from 1 to WEAPON_MAX_LEVEL. Equipping it is LV 1;
// every stat card for that weapon raises ONLY its own stat, and the weapon level by 1 (a +N rarity jump
// raises both by N, clamped so the weapon never passes LV 12). The level itself adds nothing: it counts
// cards toward the LV 4 / 8 / 12 Breakthroughs. POWER cards (damage, fire rate / reload / cooldown,
// count) each add damage output; UTILITY cards (size, radius, pull, reach, lifetime) add none, so a
// weapon built for damage matches every other weapon built for damage, and utility is a trade-off.
//
// At LV 4, 8 and 12 the weapon reaches a BREAKTHROUGH: pick a transform (a new way the weapon works)
// or ACROSS THE BOARD (a flat damage boost and +1 rank in every UTILITY stat of that weapon). Both are worth
// about the same potential DPS (BT_TRANSFORM_DPS vs BT_BOOST_DPS, pinned by tests).
//
// No DOM and no game imports, so tests, the card previews and the balance harness can all use it.

export const WEAPON_MAX_LEVEL = 12;
export const BREAKTHROUGH_LEVELS = [4, 8, 12];
// Potential-DPS multiplier of one Breakthrough choice (tests/breakthroughs.test.js pins both).
export const BT_TRANSFORM_DPS = 1.22;
export const BT_BOOST_DPS = 1.18;
// ACROSS THE BOARD: free ranks added to every UTILITY stat of the weapon (not counted toward its level).
// POWER stats get none: +1 Prism Split, fire rate and damage at once would multiply far past a transform.
export const BT_BOOST_RANKS = 1;

// Single-stat cards per weapon. `stat` is the rank key read by weapon-scaling.js; `headline` the
// STAT_ROWS id shown enlarged on the card; maxLevel is the most ranks one card can take (the weapon
// cap of LV 12 usually bites first). Ids of the old Autocannon lines are kept, so saves, locks and
// strategies keep working.
const card = (weapon, id, stat, name, headline, summary, extra = {}) => ({ weapon, id, stat, name, headline, summary, maxLevel: WEAPON_MAX_LEVEL - 1, ...extra });
const cap = (maxLevel) => ({ maxLevel });

export const STAT_CARDS = {
  blaster: [
    card('blaster', 'blaster_damage', 'damage', 'Autocannon Plasma Charge', 'damage', 'Autocannon: hotter bolts. Only damage per bolt.'),
    card('blaster', 'multishot', 'prism', 'Prism Split', 'bulletCount', 'Autocannon: adds a pair of streams (rear, then sides, then diagonals). Your forward pair never moves.', cap(5)),
    card('blaster', 'firerate', 'rate', 'Hyper-Capacitor', 'fireRate', 'Autocannon: fire faster. Only fire rate.', cap(8)),
    card('blaster', 'pierce', 'pierce', 'Phase Piercer', 'pierce', 'Autocannon: each bolt slices through one more target (each one behind takes a little less).', cap(6))
  ],
  rockets: [
    card('rockets', 'rockets_damage', 'damage', 'Wing Rocket Warheads', 'rocketDamage', 'Wing Rockets: heavier warheads. Only damage per rocket.'),
    card('rockets', 'rockets_count', 'count', 'Wing Rocket Pods', 'rocketCount', 'Wing Rockets: one more rocket per volley.', cap(6)),
    card('rockets', 'rockets_reload', 'reload', 'Wing Rocket Launch Rails', 'rocketCooldown', 'Wing Rockets: shorter time between volleys.', cap(8)),
    card('rockets', 'rockets_radius', 'radius', 'Wing Rocket Blast Size', 'rocketBlast', 'Wing Rockets: wider blasts. Only blast size.')
  ],
  missiles: [
    card('missiles', 'missiles_damage', 'damage', 'Swarm Missile Warheads', 'missileDamage', 'Swarm Missiles: heavier warheads. Only damage per missile.'),
    card('missiles', 'missiles_salvo', 'salvo', 'Swarm Missile Salvo Size', 'missileSalvo', 'Swarm Missiles: one more missile per salvo.', cap(8)),
    card('missiles', 'missiles_reload', 'reload', 'Swarm Missile Reload', 'missileCooldown', 'Swarm Missiles: shorter time between salvos.', cap(8)),
    card('missiles', 'missiles_radius', 'radius', 'Swarm Missile Blast Size', 'missileBlast', 'Swarm Missiles: wider blasts. Only blast size.')
  ],
  lightning: [
    card('lightning', 'lightning_damage', 'damage', 'Tesla Arc Voltage', 'lightningDamage', 'Tesla Arc: higher voltage. Only damage per jump.'),
    card('lightning', 'lightning_chain', 'chain', 'Tesla Arc Chain Length', 'lightningJumps', 'Tesla Arc: each discharge jumps to more enemies. Only chain length.', cap(6)),
    card('lightning', 'lightning_recharge', 'recharge', 'Tesla Arc Recharge', 'lightningCooldown', 'Tesla Arc: discharges more often.', cap(8)),
    card('lightning', 'lightning_reach', 'reach', 'Tesla Arc Reach', 'lightningReach', 'Tesla Arc: each jump reaches further. Only reach.')
  ],
  singularity: [
    card('singularity', 'singularity_pull', 'pull', 'Vortex Pull Radius', 'singularityPull', 'Vortex Singularity: a wider pull. Only pull radius (the pull still fades hard toward the rim).'),
    card('singularity', 'singularity_damage', 'damage', 'Vortex Implosion Damage', 'singularityCollapse', 'Vortex Singularity: harder core grind and collapse. Only damage.'),
    card('singularity', 'singularity_duration', 'duration', 'Vortex Lifetime', 'singularityLife', 'Vortex Singularity: each singularity lasts longer before it collapses. Only lifetime.'),
    card('singularity', 'singularity_cooldown', 'cooldown', 'Vortex Cooldown', 'singularityCooldown', 'Vortex Singularity: launches more often. Only cooldown.', cap(8)),
    card('singularity', 'singularity_core', 'core', 'Vortex Core Size', 'singularityCore', 'Vortex Singularity: a bigger core grinds a wider area. Only core size.', cap(6))
  ],
  orbitals: [
    card('orbitals', 'orbitals_damage', 'damage', 'Orbit Blade Edge', 'orbitalDamage', 'Orbit Blades: sharper edges. Only blade damage.'),
    card('orbitals', 'orbitals_count', 'count', 'Orbit Blade Count', 'orbitalBlades', 'Orbit Blades: one more blade on the ring.', cap(6)),
    card('orbitals', 'orbitals_radius', 'radius', 'Orbit Blade Reach', 'orbitalRadius', 'Orbit Blades: the ring orbits further out. Only orbit distance.'),
    card('orbitals', 'orbitals_spin', 'spin', 'Orbit Blade Spin', 'orbitalSpin', 'Orbit Blades: the ring spins faster, so the blades sweep more enemies.'),
    card('orbitals', 'orbitals_size', 'size', 'Orbit Blade Size', 'orbitalBladeSize', 'Orbit Blades: bigger saw blades. Only blade size.', cap(8))
  ],
  mines: [
    card('mines', 'mines_damage', 'damage', 'Proximity Mine Charge', 'mineDamage', 'Proximity Mines: bigger charges. Only blast damage.'),
    card('mines', 'mines_capacity', 'capacity', 'Proximity Mine Capacity', 'mineMaxActive', 'Proximity Mines: one more mine can be armed at once.', cap(8)),
    card('mines', 'mines_rate', 'rate', 'Proximity Mine Drop Rate', 'mineCooldown', 'Proximity Mines: drops mines more often. Only drop rate.', cap(8)),
    card('mines', 'mines_radius', 'radius', 'Proximity Mine Blast Size', 'mineBlastRadius', 'Proximity Mines: wider blasts. Only blast size.'),
    card('mines', 'mines_fuse', 'fuse', 'Proximity Mine Fuse', 'mineLifetime', 'Proximity Mines: armed mines wait longer before self-detonating. Only lifetime.', cap(6))
  ],
  turret: [
    card('turret', 'turret_damage', 'damage', 'Sentry Turret Bolts', 'turretDamage', 'Sentry Turret: heavier bolts. Only bolt damage.'),
    card('turret', 'turret_rate', 'rate', 'Sentry Turret Fire Rate', 'turretFireRate', 'Sentry Turret: shoots faster.', cap(8)),
    card('turret', 'turret_lifetime', 'lifetime', 'Sentry Turret Lifetime', 'turretDuration', 'Sentry Turret: each turret stays deployed longer. Only lifetime.'),
    card('turret', 'turret_redeploy', 'redeploy', 'Sentry Turret Redeploy', 'turretCooldown', 'Sentry Turret: plants a new turret sooner.')
  ],
  drones: [
    card('drones', 'drones_damage', 'damage', 'Escort Drone Guns', 'droneDamage', 'Escort Drones: heavier guns. Only bolt damage.'),
    card('drones', 'drones_rate', 'rate', 'Escort Drone Fire Rate', 'droneFireRate', 'Escort Drones: each drone shoots faster.', cap(8)),
    card('drones', 'drones_wingmen', 'wingmen', 'Escort Drone Wingmen', 'droneCount', 'Escort Drones: one more drone joins the formation.', { maxLevel: 2 }),
    card('drones', 'drones_range', 'range', 'Escort Drone Range', 'droneRange', 'Escort Drones: drones engage targets further out. Only range.')
  ],
  grenades: [
    card('grenades', 'grenades_damage', 'damage', 'Plasma Grenade Charge', 'grenadeDamage', 'Plasma Grenades: hotter plasma cores. Only blast damage.'),
    card('grenades', 'grenades_count', 'count', 'Plasma Grenade Bandolier', 'grenadeCount', 'Plasma Grenades: one more grenade per throw.', cap(5)),
    card('grenades', 'grenades_rate', 'rate', 'Plasma Grenade Throw Rate', 'grenadeCooldown', 'Plasma Grenades: throws more often. Only throw rate.', cap(8)),
    card('grenades', 'grenades_radius', 'radius', 'Plasma Grenade Blast Size', 'grenadeBlast', 'Plasma Grenades: wider blasts. Only blast size.'),
    card('grenades', 'grenades_range', 'range', 'Plasma Grenade Throw Range', 'grenadeRange', 'Plasma Grenades: lobs reach targets further out. Only throw range.')
  ]
};

export const STAT_CARD_LIST = Object.values(STAT_CARDS).flat();
export const STAT_CARD_BY_ID = Object.fromEntries(STAT_CARD_LIST.map((c) => [c.id, c]));

// Category badge on a weapon's stat and Breakthrough cards: the weapon's name, so every card says
// which weapon it upgrades.
export const WEAPON_BADGE = {
  blaster: 'AUTOCANNON', rockets: 'WING ROCKETS', missiles: 'SWARM MISSILES', lightning: 'TESLA ARC',
  singularity: 'VORTEX SINGULARITY', orbitals: 'ORBIT BLADES', mines: 'PROXIMITY MINES', turret: 'SENTRY TURRET', drones: 'ESCORT DRONES',
  grenades: 'PLASMA GRENADES'
};

// Transforms: one per weapon per milestone (30 in all), each changing how the weapon works.
const tf = (id, name, summary) => ({ id, name, summary });
export const TRANSFORMS = {
  blaster: {
    4: tf('flak', 'Flak Rounds', 'Autocannon bolts burst in a small flak blast wherever they hit.'),
    8: tf('ricochet', 'Ricochet Rounds', 'Autocannon bolts that hit ricochet into the nearest other enemy.'),
    12: tf('arc', 'Arc Rounds', 'Every Autocannon hit arcs cyan lightning into 2 nearby enemies.')
  },
  rockets: {
    4: tf('tandem', 'Tandem Warheads', 'Wing Rockets blast twice: a second, delayed detonation rocks the same spot.'),
    8: tf('napalm', 'Napalm Trail', 'Wing Rockets streak fire and leave a burning napalm pool where they burst.'),
    12: tf('mirv', 'MIRV Rockets', 'Each Wing Rocket splits into three mini-rockets mid-flight.')
  },
  missiles: {
    4: tf('cluster', 'Cluster Bomblets', 'Each Swarm Missile scatters four bomblets that pop a moment after its blast.'),
    8: tf('rain', 'Orbital Rain', 'Swarm Missiles launch out of sight and crash down on marked targets from above.'),
    12: tf('nuke', 'Tactical Nuke', 'Every fourth Swarm Missile salvo is one huge nuke with a giant blast.')
  },
  lightning: {
    4: tf('fork', 'Forked Chains', 'Tesla Arc forks: two chains leap out at once, each a little weaker.'),
    8: tf('orb', 'Ball Lightning', 'Each Tesla Arc discharge also drops a crackling orb that zaps nearby enemies.'),
    12: tf('strike', 'Thunderstrike', 'Every Tesla Arc chain ends in a lightning strike from above that blasts the area.')
  },
  singularity: {
    4: tf('twin', 'Twin Singularities', 'Vortex Singularity launches two slightly weaker singularities at once: more damage in total.'),
    8: tf('aftershock', 'Aftershock Collapse', 'Each Vortex Singularity collapses twice: a tighter second implosion follows.'),
    12: tf('cascade', 'Hawking Cascade', 'Collapsing Vortex Singularities spit out three mini-singularities that implode in turn.')
  },
  orbitals: {
    4: tf('counter', 'Counter-Rotating Ring', 'Orbit Blades gain a second, wider ring that spins the other way.'),
    8: tf('fling', 'Blade Fling', 'Orbit Blades fling spinning saw discs outward every few seconds.'),
    12: tf('nova', 'Nova Ring', 'Every few seconds each Orbit Blade bursts in a green nova, then reforms.')
  },
  mines: {
    4: tf('cluster', 'Cluster Mines', 'Proximity Mines scatter three bomblets that pop just after the main blast.'),
    8: tf('seeker', 'Seeker Mines', 'Armed Proximity Mines crawl toward the nearest enemy.'),
    12: tf('triad', 'Minefield Triad', 'Proximity Mines drop in triangles of three, each a little weaker.')
  },
  turret: {
    4: tf('twin', 'Twin Barrels', 'Sentry Turrets fire two bolts per shot, side by side.'),
    8: tf('rail', 'Piercing Rail', 'Every fifth Sentry Turret shot is a rail slug that pierces a whole line.'),
    12: tf('mortar', 'Mortar Battery', 'Sentry Turrets also lob mortar shells that crash down on enemies in range.')
  },
  drones: {
    4: tf('wingman', 'Extra Wingman', 'Escort Drones gain one more drone in the formation (past the usual 3).'),
    8: tf('homing', 'Homing Bolts', 'Escort Drone bolts curve onto their targets.'),
    12: tf('pods', 'Micro-Missile Pods', 'Escort Drones launch homing micro-missiles every few seconds.')
  },
  grenades: {
    4: tf('cluster', 'Cluster Grenades', 'Plasma Grenades split as they land: bomblets scatter and pop a moment later.'),
    8: tf('cloud', 'Lingering Cloud', 'Plasma Grenade blasts leave a cloud that burns, freezes or corrodes (by its element) everything inside.'),
    12: tf('gravity', 'Gravity Grenade', 'Armed Plasma Grenades pull nearby enemies in toward themselves, then blast harder.')
  }
};

// Which stats add damage output (POWER) vs. only shape the weapon (UTILITY): tests and the Field Guide.
// Turret lifetime and redeploy keep more turrets firing at once, and a longer-lived singularity grinds
// longer, so those are POWER too. Everything else (size, radius, pull, reach, range, spin, pierce,
// capacity, fuse) is UTILITY.
export const POWER_STATS = new Set(['damage', 'rate', 'reload', 'recharge', 'cooldown', 'count', 'salvo', 'chain', 'prism', 'wingmen', 'lifetime', 'redeploy', 'duration']);

export const BOOST_NAME = 'Across the Board';
export const boostSummary = (weaponName) => `${weaponName}: +${Math.round((BT_BOOST_DPS - 1) * 100)}% damage and +${BT_BOOST_RANKS} to every size, reach and range stat. No new tricks, just more of the same.`;

// In-world R&D lines for the Breakthrough header ({weapon} is the weapon's name).
export const RD_LINES = [
  'Bridge, this is R&D: we cracked something in the {weapon} telemetry. Pick which prototype goes into production.',
  'Your science and engineering team made an exciting discovery in the {weapon}. Sign off on one build.',
  'Science bay here. The {weapon} just did something it should not be able to do. We want to do it again.',
  'Engineering: two {weapon} blueprints, one fabricator slot. Your call, pilot.',
  'R&D to pilot: the {weapon} field data is in and it is beautiful. Which version do we print?',
  'Somebody in the lab overclocked the {weapon} and nothing exploded. Pick the keeper.',
  'Prototype bay: two new {weapon} configurations are ready. One ships today.',
  'Chief engineer here. We rewired the {weapon} core and found headroom. Spend it.'
];

export const rdLine = (index, weaponName) => RD_LINES[((index % RD_LINES.length) + RD_LINES.length) % RD_LINES.length].replace('{weapon}', weaponName);

// Milestones passed when a weapon goes from level `from` to `to` (each once, in order): a +3 card
// taking LV 3 -> 6 gives [4]; LV 7 -> 12 gives [8, 12].
export function milestonesCrossed(from, to) {
  return BREAKTHROUGH_LEVELS.filter((m) => from < m && to >= m);
}

// Chosen Breakthroughs of a weapon: { 4: 'transform' | 'boost', 8: ..., 12: ... }.
export const weaponBreakthroughs = (p, id) => p.breakthroughs?.[id] || {};

// Ranks a player holds in each stat of a weapon (card levels from upgradeLevels).
export function statRanks(p, id) {
  const out = {};
  for (const c of STAT_CARDS[id] || []) out[c.stat] = p.upgradeLevels?.[c.id] || 0;
  return out;
}

// Everything the weapon formulas need: level (with any evolution bonus level), effective ranks
// (card ranks + ACROSS THE BOARD ranks), which transforms are installed and how many boosts.
export function makeBuild(id, lv, ranks = {}, bt = {}) {
  let atb = 0;
  const t = {};
  for (const m of BREAKTHROUGH_LEVELS) {
    if (bt[m] === 'boost') atb++;
    else if (bt[m] === 'transform') t[m] = true;
  }
  const r = {};
  for (const c of STAT_CARDS[id] || []) r[c.stat] = (ranks[c.stat] || 0) + (POWER_STATS.has(c.stat) ? 0 : atb * BT_BOOST_RANKS);
  return { id, lv, r, atb, t4: !!t[4], t8: !!t[8], t12: !!t[12], transforms: (t[4] ? 1 : 0) + (t[8] ? 1 : 0) + (t[12] ? 1 : 0) };
}

// Build of an owned weapon. `levelKey` is the player.weapons key holding its level (loadout.js).
export function weaponBuild(p, id, lv = null) {
  const level = lv ?? (id === 'blaster' ? Math.max(1, p.weapons?.blaster || 0) : (p.weapons?.[id] || 0));
  return makeBuild(id, level, statRanks(p, id), weaponBreakthroughs(p, id));
}

// A weapon at a level with no stat ranks and no Breakthroughs (Storm Protocol's fixed chain level).
export const levelBuild = (id, lv) => makeBuild(id, lv);
