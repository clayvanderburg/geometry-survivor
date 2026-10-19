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
    card('turret', 'turret_count', 'count', 'Sentry Turret Count', 'turretMaxActive', 'Sentry Turret: carry one more turret.', cap(6)),
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
  ],
  gas: [
    card('gas', 'gas_damage', 'damage', 'Gas Trail Toxicity', 'gasDamage', 'Corrosive Gas Trail: a nastier brew. Only damage per gas tick.'),
    card('gas', 'gas_rate', 'rate', 'Gas Trail Reactivity', 'gasTickRate', 'Corrosive Gas Trail: the gas eats into hulls more often. Only tick rate.', cap(8)),
    card('gas', 'gas_radius', 'radius', 'Gas Trail Plume Size', 'gasRadius', 'Corrosive Gas Trail: wider clouds. Only cloud size.'),
    card('gas', 'gas_linger', 'linger', 'Gas Trail Linger', 'gasLife', 'Corrosive Gas Trail: clouds hang in the air longer before they thin out. Only cloud lifetime.')
  ],
  flamethrower: [
    card('flamethrower', 'flamethrower_damage', 'damage', 'Flamethrower Plasma Fuel', 'flameDamage', 'Flamethrower: hotter fuel. Only flame damage.'),
    card('flamethrower', 'flamethrower_rate', 'rate', 'Flamethrower Fuel Pump', 'flameTickRate', 'Flamethrower: pumps more fuel, so the flames scorch more often. Only scorch rate.', cap(8)),
    card('flamethrower', 'flamethrower_range', 'range', 'Flamethrower Nozzle Pressure', 'flameRange', 'Flamethrower: the flames reach further. Only flame length.', cap(8)),
    card('flamethrower', 'flamethrower_cone', 'cone', 'Flamethrower Wide Nozzle', 'flameCone', 'Flamethrower: a wider cone of fire. Only cone width.', cap(8)),
    card('flamethrower', 'flamethrower_burn', 'burn', 'Flamethrower Sticky Gel', 'flamethrower:burnMax', 'Flamethrower: the fuel clings and burns hotter: a stronger FIRE burn on everything it touches.', cap(4))
  ],
  shockfield: [
    card('shockfield', 'shockfield_damage', 'damage', 'Shock Field Voltage', 'fieldDamage', 'Electric Shield Field: a harder jolt. Only discharge damage.'),
    card('shockfield', 'shockfield_recharge', 'recharge', 'Shock Field Capacitors', 'fieldCooldown', 'Electric Shield Field: recharges faster between discharges. Only recharge time.', cap(4)),
    card('shockfield', 'shockfield_radius', 'radius', 'Shock Field Radius', 'fieldRadius', 'Electric Shield Field: a wider field. Only its radius.', cap(8)),
    card('shockfield', 'shockfield_stun', 'stun', 'Shock Field Stun Coils', 'fieldStun', 'Electric Shield Field: its SHOCK stuns longer and more often. Only the stun.', cap(4))
  ]
};

export const STAT_CARD_LIST = Object.values(STAT_CARDS).flat();
export const STAT_CARD_BY_ID = Object.fromEntries(STAT_CARD_LIST.map((c) => [c.id, c]));

// --- Element infusion (v0.34) ----------------------------------------------------------------------
// Five weapons can carry an ELEMENT: FIRE (burn), FROST (chill), CORROSIVE (corrode) or SHOCK (stun).
// Each has one element card per element ("Autocannon: Thermite Rounds"), offered only in level-up hands
// (never in supply caches). The first one taken LOCKS that weapon's element for the run: the other three
// are never offered again, and more cards of the same element are rank-ups (stronger status). Like stat
// cards, every rank raises the weapon's level by 1 and counts toward LV 18 and its Breakthroughs.
// Rank state lives in player.weapons under the card id (`blaster_fire`), so status-effects.js reads it
// per hit with plain property lookups. The numbers per rank live in weapon-scaling.js.
export const ELEMENTS = ['fire', 'frost', 'corrode', 'shock'];
export const ELEMENT_WEAPONS = ['blaster', 'rockets', 'missiles', 'lightning', 'grenades'];
export const ELEMENT_MAX_RANKS = 5;
// label: what cards and the HUD say; status: the status effect (TAG_INFO key, weapon-scaling.js).
export const ELEMENT_INFO = {
  fire: { id: 'fire', label: 'FIRE', status: 'burn', color: '#ff5a2e', hue: 18 },
  frost: { id: 'frost', label: 'FROST', status: 'chill', color: '#8fe8ff', hue: 192 },
  corrode: { id: 'corrode', label: 'CORROSIVE', status: 'corrode', color: '#7dff4a', hue: 100 },
  shock: { id: 'shock', label: 'SHOCK', status: 'shock', color: '#f4ff52', hue: 62 }
};

const ELEMENT_NAMES = {
  blaster: { fire: 'Thermite Rounds', frost: 'Cryo Rounds', corrode: 'Nanite Rounds', shock: 'Shock Rounds' },
  rockets: { fire: 'Incendiary Warheads', frost: 'Cryo Warheads', corrode: 'Nanite Warheads', shock: 'Shock Warheads' },
  missiles: { fire: 'Thermite Payload', frost: 'Cryo Payload', corrode: 'Nanite Payload', shock: 'Shock Payload' },
  lightning: { fire: 'Searing Arcs', frost: 'Cryo Arcs', corrode: 'Nanite Swarm', shock: 'Stun Arcs' },
  grenades: { fire: 'Thermite Charge', frost: 'Cryo Charge', corrode: 'Nanite Charge', shock: 'Shock Charge' }
};
const ELEMENT_WEAPON_TEXT = {
  blaster: 'Autocannon bolts (Pulsar Helix too)', rockets: 'Rocket Pod hits and blasts', missiles: 'Swarm Missile blasts',
  lightning: 'Tesla arcs', grenades: 'Plasma Grenade blasts, bomblets and clouds'
};
const ELEMENT_EFFECT_TEXT = {
  fire: 'set targets on FIRE: every hit adds a burn stack. More ranks burn hotter and stack higher.',
  frost: 'CHILL targets, slowing them (bosses resist most of it). More ranks slow harder and longer.',
  corrode: 'CORRODE targets: every stack makes them take more damage from everything. More ranks stack higher.',
  shock: 'SHOCK targets: a short stun, sometimes a long one. More ranks stun longer and more often.'
};
export const ELEMENT_WEAPON_LABEL = {
  blaster: 'Autocannon', rockets: 'Rocket Pods', missiles: 'Swarm Missiles', lightning: 'Tesla Arc', grenades: 'Plasma Grenades',
  flamethrower: 'Flamethrower' // built-in FIRE (FIXED_ELEMENTS): no element cards, but the same status rows
};
// player.weapons / upgradeLevels key of a weapon's element card.
export const elementKey = (weapon, element) => `${weapon}_${element}`;

export const ELEMENT_CARDS = Object.fromEntries(ELEMENT_WEAPONS.map((weapon) => [weapon, ELEMENTS.map((element) => ({
  weapon,
  element,
  id: elementKey(weapon, element),
  name: `${ELEMENT_WEAPON_LABEL[weapon]}: ${ELEMENT_NAMES[weapon][element]}`,
  summary: `${ELEMENT_WEAPON_TEXT[weapon]} ${ELEMENT_EFFECT_TEXT[element]} Locks this weapon's element for the run.`,
  maxLevel: ELEMENT_MAX_RANKS
}))]));
export const ELEMENT_CARD_LIST = Object.values(ELEMENT_CARDS).flat();
export const ELEMENT_CARD_BY_ID = Object.fromEntries(ELEMENT_CARD_LIST.map((c) => [c.id, c]));

// The weapon a level card belongs to (stat cards and element cards both raise their weapon's level).
export const levelCardWeapon = (id) => STAT_CARD_BY_ID[id]?.weapon || ELEMENT_CARD_BY_ID[id]?.weapon || null;

// Weapons born with an element instead of taking element cards (never infusable, never re-locked).
// Their element counts like an infused one (STATUS cards, Amplifiers, Supercritical, HUD tag); its rank
// grows with the weapon level (fixedElementRank: 1 at LV 1, +1 at each Breakthrough level).
// The Flamethrower always burns: its FIRE rank is 1 + its Sticky Gel ('burn' stat) ranks instead
// (ACROSS THE BOARD's free utility rank included), up to ELEMENT_MAX_RANKS (FIXED_ELEMENT_RANK).
// The Electric Shield Field is always SHOCK: its rank is 1 + its Stun Coils ('stun' stat) ranks the same way.
export const FIXED_ELEMENTS = { gas: 'corrode', flamethrower: 'fire', shockfield: 'shock' };
export const fixedElementRank = (lv) => Math.min(ELEMENT_MAX_RANKS, 1 + Math.floor(Math.max(0, lv) / 6));
export const flameBurnRank = (b) => Math.min(ELEMENT_MAX_RANKS, 1 + (b?.r?.burn || 0));
// Flamethrower FIRE rank read straight from the card ranks and Breakthroughs (no build allocated:
// status-effects.js asks on every flame hit). Equals flameBurnRank(weaponBuild(p, 'flamethrower')).
export function flameElementRank(p) {
  const bt = p?.breakthroughs?.flamethrower;
  let atb = 0;
  if (bt) for (const m of BREAKTHROUGH_LEVELS) if (bt[m] === 'boost') atb++;
  return Math.min(ELEMENT_MAX_RANKS, 1 + (p?.upgradeLevels?.flamethrower_burn || 0) + atb * BT_BOOST_RANKS);
}
// Electric Shield Field SHOCK rank, the same way from its Stun Coils ranks (equals W.fieldStunRank of its build).
export function fieldElementRank(p) {
  const bt = p?.breakthroughs?.shockfield;
  let atb = 0;
  if (bt) for (const m of BREAKTHROUGH_LEVELS) if (bt[m] === 'boost') atb++;
  return Math.min(ELEMENT_MAX_RANKS, 1 + (p?.upgradeLevels?.shockfield_stun || 0) + atb * BT_BOOST_RANKS);
}
// Fixed-element weapons whose rank does not follow the level rule above.
const FIXED_ELEMENT_RANK = { flamethrower: flameElementRank, shockfield: fieldElementRank };

// A weapon's element and its rank ({ element, rank }), or null when it has none. Reads player.weapons
// (kept in step with the card ranks by the cards' apply()).
export const ELEMENT_KEYS = Object.fromEntries(ELEMENT_WEAPONS.map((weapon) => [weapon, ELEMENTS.map((el) => elementKey(weapon, el))]));

export function weaponElement(p, weapon) {
  const w = p?.weapons;
  const fixed = FIXED_ELEMENTS[weapon];
  if (fixed) return w?.[weapon] > 0 ? { element: fixed, rank: FIXED_ELEMENT_RANK[weapon] ? FIXED_ELEMENT_RANK[weapon](p) : fixedElementRank(w[weapon]), fixed: true } : null;
  const keys = ELEMENT_KEYS[weapon];
  if (!w || !keys) return null;
  for (let i = 0; i < keys.length; i++) {
    const rank = w[keys[i]];
    if (rank > 0) return { element: ELEMENTS[i], rank };
  }
  return null;
}

// Elements carried by the player's weapons (owned or not: callers pass owned ids when it matters).
export function elementsOf(p, weapons = [...ELEMENT_WEAPONS, ...Object.keys(FIXED_ELEMENTS)]) {
  const out = new Set();
  for (const id of weapons) {
    const el = weaponElement(p, id);
    if (el) out.add(el.element);
  }
  return out;
}

// Category badge on a weapon's stat and Breakthrough cards: the weapon's name, so every card says
// which weapon it upgrades.
export const WEAPON_BADGE = {
  blaster: 'AUTOCANNON', rockets: 'ROCKET PODS', missiles: 'SWARM MISSILES', lightning: 'TESLA ARC',
  singularity: 'VORTEX SINGULARITY', orbitals: 'ORBIT BLADES', mines: 'PROXIMITY MINES', turret: 'SENTRY TURRET', drones: 'ESCORT DRONES',
  grenades: 'PLASMA GRENADES', gas: 'GAS TRAIL', flamethrower: 'FLAMETHROWER', shockfield: 'SHOCK FIELD'
};

// Transforms: one per weapon per milestone, each changing how the weapon works.
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
    12: tf('mobile', 'Mobile Sentries', 'Sentry Turrets slowly follow you around instead of staying where they were planted, and their bolts hit harder.'),
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
  },
  gas: {
    6: tf('seek', 'Seeking Miasma', 'Corrosive Gas Trail clouds creep toward the nearest enemy instead of hanging where you left them, and eat harder.'),
    12: tf('pockets', 'Volatile Pockets', 'Corrosive Gas Trail leaves a volatile gas pocket every second or so: it swells, then bursts in a corrosive blast when an enemy comes close.'),
    18: tf('shroud', 'Toxic Shroud', 'Corrosive Gas Trail wraps your hull in a lasting cloud that follows you everywhere and eats anything that gets close.')
  },
  flamethrower: {
    6: tf('twin', 'Twin Nozzle', 'The Flamethrower grows a second nozzle that sprays fire straight behind you, a little shorter than the front one.'),
    12: tf('napalm', 'Napalm Puddles', 'Flamethrower fuel splashes down at the tip of the flames as burning napalm puddles that keep scorching whatever walks through.'),
    18: tf('ring', 'Inferno Ring', 'Every few seconds the Flamethrower vents a ring of fire that rolls out all around you, scorching and shoving back everything it passes.')
  },
  shockfield: {
    6: tf('lash', 'Arc Lash', 'Every Electric Shield Field discharge also lashes arcs out at the 3 nearest enemies beyond the field, stunning them too.'),
    12: tf('repulse', 'Repulsor Surge', 'Electric Shield Field discharges hurl enemies back and hit harder, and each one that lands recharges your Phase Dash faster.'),
    18: tf('overcharge', 'Thunderclap Overcharge', 'The Electric Shield Field banks charge with every discharge. When a big pack or a boss closes in, it releases it all in a wide thunderclap.')
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
