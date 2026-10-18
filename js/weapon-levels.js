// Weapon levels 1-12, single-stat cards and Breakthroughs.
//
// Every slot weapon (Autocannon included) has a level from 1 to WEAPON_MAX_LEVEL. Equipping it is LV 1;
// every stat card for that weapon raises ONLY its own stat, and the weapon level by 1 (a +N rarity jump
// raises both by N, clamped so the weapon never passes LV 18). The level itself adds nothing: it counts
// cards toward the LV 6 / 12 / 18 Breakthroughs. POWER cards (damage, fire rate / reload / cooldown,
// count) each add damage output; UTILITY cards (size, radius, pull, reach, lifetime) add none, so a
// weapon built for damage matches every other weapon built for damage, and utility is a trade-off.
//
// At LV 6, 12 and 18 the weapon reaches a BREAKTHROUGH: pick a transform (a new way the weapon works)
// or ACROSS THE BOARD (a flat damage boost and +1 rank in every UTILITY stat of that weapon). Both are worth
// about the same potential DPS (BT_TRANSFORM_DPS vs BT_BOOST_DPS, pinned by tests).
//
// No DOM and no game imports, so tests, the card previews and the balance harness can all use it.

export const WEAPON_MAX_LEVEL = 18;
export const BREAKTHROUGH_LEVELS = [6, 12, 18];
// Potential-DPS multiplier of one Breakthrough choice (tests/breakthroughs.test.js pins both).
export const BT_TRANSFORM_DPS = 1.22;
export const BT_BOOST_DPS = 1.18;
// ACROSS THE BOARD: free ranks added to every UTILITY stat of the weapon (not counted toward its level).
// POWER stats get none: +1 Prism Split, fire rate and damage at once would multiply far past a transform.
export const BT_BOOST_RANKS = 1;

// Single-stat cards per weapon. `stat` is the rank key read by weapon-scaling.js; `headline` the
// STAT_ROWS id shown enlarged on the card; maxLevel is the most ranks one card can take (the weapon
// cap of LV 18 usually bites first). Ids of the old Autocannon lines are kept, so saves, locks and
// strategies keep working.
// A card takes at most CARD_MAX_RANKS ranks (11: Damage tops out at x1.5^11, sizes at their old ceilings),
// so reaching LV 18 takes a mix of cards.
export const CARD_MAX_RANKS = 11;
const card = (weapon, id, stat, name, headline, summary, extra = {}) => ({ weapon, id, stat, name, headline, summary, maxLevel: CARD_MAX_RANKS, ...extra });
const cap = (maxLevel) => ({ maxLevel });

export const STAT_CARDS = {
  blaster: [
    card('blaster', 'blaster_damage', 'damage', 'Autocannon Plasma Charge', 'damage', 'Autocannon: hotter bolts. Only damage per bolt.'),
    card('blaster', 'multishot', 'prism', 'Prism Split', 'bulletCount', 'Autocannon: adds a pair of streams (rear, then sides, then diagonals). Your forward pair never moves.', cap(5)),
    card('blaster', 'firerate', 'rate', 'Hyper-Capacitor', 'fireRate', 'Autocannon: fire faster. Only fire rate.', cap(8)),
    card('blaster', 'pierce', 'pierce', 'Phase Piercer', 'pierce', 'Autocannon: each bolt slices through one more target (each one behind takes a little less).', cap(6))
  ],
  rockets: [
    card('rockets', 'rockets_damage', 'damage', 'Rocket Pod Warheads', 'rocketDamage', 'Rocket Pods: heavier warheads. Only damage per rocket.'),
    card('rockets', 'rockets_count', 'count', 'Rocket Pod Tubes', 'rocketCount', 'Rocket Pods: one more rocket per volley.', cap(6)),
    card('rockets', 'rockets_reload', 'reload', 'Rocket Pod Launch Rails', 'rocketCooldown', 'Rocket Pods: shorter time between volleys.', cap(8)),
    card('rockets', 'rockets_radius', 'radius', 'Rocket Pod Blast Size', 'rocketBlast', 'Rocket Pods: wider blasts. Only blast size.')
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
    card('turret', 'turret_count', 'count', 'Sentry Turret Count', 'turretMaxActive', 'Sentry Turret: carry one more turret.', cap(3)),
    card('turret', 'turret_lifetime', 'lifetime', 'Sentry Turret Lifetime', 'turretDuration', 'Sentry Turret: each turret stays deployed longer. Only lifetime.'),
    card('turret', 'turret_redeploy', 'redeploy', 'Sentry Turret Recharge', 'turretCooldown', 'Sentry Turret: an expired turret is ready to plant again sooner. Only recharge.')
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
  blaster: 'AUTOCANNON', rockets: 'ROCKET PODS', missiles: 'SWARM MISSILES', lightning: 'TESLA ARC',
  singularity: 'VORTEX SINGULARITY', orbitals: 'ORBIT BLADES', mines: 'PROXIMITY MINES', turret: 'SENTRY TURRET', drones: 'ESCORT DRONES',
  grenades: 'PLASMA GRENADES'
};

// Transforms: one per weapon per milestone (30 in all), each changing how the weapon works.
const tf = (id, name, summary) => ({ id, name, summary });
export const TRANSFORMS = {
  blaster: {
    6: tf('flak', 'Flak Rounds', 'Autocannon bolts burst in a small flak blast wherever they hit.'),
    12: tf('ricochet', 'Ricochet Rounds', 'Autocannon bolts ricochet off enemies and asteroids into fresh targets.'),
    18: tf('arc', 'Arc Rounds', 'Every Autocannon hit arcs cyan lightning into 2 nearby enemies.')
  },
  rockets: {
    6: tf('tandem', 'Tandem Warheads', 'Rocket Pod rockets blast twice: a second, delayed detonation rocks the same spot.'),
    12: tf('napalm', 'Napalm Trail', 'Rocket Pod rockets streak fire and leave a burning napalm pool where they burst.'),
    18: tf('mirv', 'MIRV Rockets', 'Each Rocket Pod rocket splits into three mini-rockets mid-flight, each homing on its own target ahead.')
  },
  missiles: {
    6: tf('cluster', 'Cluster Bomblets', 'Each Swarm Missile throws four bomblets that hop onto nearby enemies past its blast and pop a moment later.'),
    12: tf('rain', 'Orbital Rain', 'Swarm Missiles launch out of sight and crash down on marked targets from above in wider blasts.'),
    18: tf('nuke', 'Tactical Nuke', 'Every fourth Swarm Missile salvo is one huge nuke with a giant blast.')
  },
  lightning: {
    6: tf('fork', 'Forked Chains', 'Tesla Arc forks: two chains leap out at once, each a little weaker.'),
    12: tf('orb', 'Ball Lightning', 'Each Tesla Arc discharge also drops a crackling orb on the nearest enemy that zaps whatever is close.'),
    18: tf('strike', 'Thunderstrike', 'Every Tesla Arc chain ends in a lightning strike from above on its last target and anything right beside it, stronger the more enemies the chain hit.')
  },
  singularity: {
    6: tf('twin', 'Twin Singularities', 'Vortex Singularity launches two singularities at once: the second goes after enemies on your far side.'),
    12: tf('aftershock', 'Aftershock Collapse', 'Vortex Singularity pulls from further out and collapses twice: a tighter second implosion follows.'),
    18: tf('cascade', 'Hawking Cascade', 'Collapsing Vortex Singularities spit out three mini-singularities that drift onto nearby enemies and implode in turn.')
  },
  orbitals: {
    6: tf('counter', 'Counter-Rotating Ring', 'Orbit Blades gain a second, wider ring that spins the other way.'),
    12: tf('fling', 'Blade Fling', 'Orbit Blades fling spinning saw discs outward every few seconds.'),
    18: tf('nova', 'Nova Ring', 'Every few seconds each Orbit Blade bursts in a green nova, then reforms.')
  },
  mines: {
    6: tf('cluster', 'Cluster Mines', 'Proximity Mines scatter three bomblets that pop just after the main blast.'),
    12: tf('seeker', 'Seeker Mines', 'Armed Proximity Mines crawl toward the nearest enemy.'),
    18: tf('triad', 'Minefield Triad', 'Proximity Mines drop in triangles of three, each a little weaker, tossed out toward the nearest enemy.')
  },
  turret: {
    6: tf('twin', 'Twin Barrels', 'Sentry Turrets fire two bolts per shot, side by side.'),
    12: tf('rail', 'Piercing Rail', 'Every fifth Sentry Turret shot is a heavy rail slug that punches through three enemies in a line.'),
    18: tf('mortar', 'Mortar Battery', 'Sentry Turrets also lob mortar shells that crash down on enemies in range.')
  },
  drones: {
    6: tf('wingman', 'Extra Wingman', 'Escort Drones gain one more drone in the formation (past the usual 3).'),
    12: tf('homing', 'Homing Bolts', 'Escort Drone bolts curve onto their targets.'),
    18: tf('pods', 'Micro-Missile Pods', 'Escort Drones launch homing micro-missiles every few seconds.')
  },
  grenades: {
    6: tf('cluster', 'Cluster Grenades', 'Plasma Grenades split as they land: bomblets hop onto nearby enemies past the blast and pop a moment later.'),
    12: tf('cloud', 'Lingering Cloud', 'Plasma Grenade blasts leave a cloud that burns, freezes or corrodes (by its element) everything inside.'),
    18: tf('gravity', 'Gravity Grenade', 'Armed Plasma Grenades drag nearby enemies in, harder as the fuse burns down, then blast.')
  }
};

// Which stats add damage output (POWER) vs. only shape the weapon (UTILITY): tests and the Field Guide.
// A longer-lived singularity grinds longer, so its lifetime is POWER too. Everything else (size, radius,
// pull, reach, range, spin, pierce, capacity, fuse, turret lifetime and recharge: turret DPS is counted
// with every turret out) is UTILITY.
export const POWER_STATS = new Set(['damage', 'rate', 'reload', 'recharge', 'cooldown', 'count', 'salvo', 'chain', 'prism', 'wingmen', 'duration']);

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
// taking LV 5 -> 8 gives [6]; LV 11 -> 18 gives [12, 18].
export function milestonesCrossed(from, to) {
  return BREAKTHROUGH_LEVELS.filter((m) => from < m && to >= m);
}

// Chosen Breakthroughs of a weapon: { 6: 'transform' | 'boost', 12: ..., 18: ... }.
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
  // t4 / t8 / t12 name the first, second and third Breakthrough (now at LV 6 / 12 / 18).
  const [m1, m2, m3] = BREAKTHROUGH_LEVELS;
  return { id, lv, r, atb, t4: !!t[m1], t8: !!t[m2], t12: !!t[m3], transforms: (t[m1] ? 1 : 0) + (t[m2] ? 1 : 0) + (t[m3] ? 1 : 0) };
}

// Build of an owned weapon. `levelKey` is the player.weapons key holding its level (loadout.js).
export function weaponBuild(p, id, lv = null) {
  const level = lv ?? (id === 'blaster' ? Math.max(1, p.weapons?.blaster || 0) : (p.weapons?.[id] || 0));
  return makeBuild(id, level, statRanks(p, id), weaponBreakthroughs(p, id));
}

// A weapon at a level with no stat ranks and no Breakthroughs (Storm Protocol's fixed chain level).
export const levelBuild = (id, lv) => makeBuild(id, lv);
