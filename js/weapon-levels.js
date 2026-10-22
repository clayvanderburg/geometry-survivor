// Weapon levels 1-12, single-stat cards and Breakthroughs.
//
// Every slot weapon (Autocannon included) has a level from 1 to WEAPON_MAX_LEVEL. Equipping it is LV 1;
// every stat card for that weapon raises ONLY its own stat, and the weapon level by 1 (a +N rarity jump
// raises both by N, clamped so the weapon never passes LV 18). The level itself adds nothing: it counts
// cards toward the LV 6 / 12 / 18 Breakthroughs. POWER cards (damage, fire rate / reload / cooldown,
// count) each add damage output; UTILITY cards (size, radius, pull, reach, lifetime) add none, so a
// weapon built for damage matches every other weapon built for damage, and utility is a trade-off.
//
// At LV 6, 12 and 18 the weapon reaches a BREAKTHROUGH: pick 1 of 3 options drawn from its pool
// (docs/BREAKTHROUGH_POOLS.md, Deep Rock Galactic: Survivor's overclocks): transforms (a new way the weapon
// works) and FLATS (ACROSS THE BOARD: a flat damage boost and +1 rank in every UTILITY stat; OVERTUNED CORE:
// damage only). Every option is worth about the same potential DPS (BT_FLATS / BT_TRANSFORM_DPS, pinned by tests).
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
// OVERTUNED CORE: damage only, a little under a transform (DRG: Survivor's clean overclocks), so the
// transforms stay the exciting pick.
export const BT_OVERTUNED_DPS = 1.2;

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
    // Deep Rock Galactic: Survivor's LMG upgrades (Bigger Cogs, Tighten Springs, Loosen Bolts, Add Punch).
    // turret_redeploy keeps its id (it was the slot recharge, now charge reload); Count and Lifetime are
    // retired (RETIRED_STAT_CARDS).
    card('turret', 'turret_damage', 'damage', 'Sentry Turret Bigger Cogs', 'turretDamage', 'Sentry Turret: heavier bolts. Only bolt damage.'),
    card('turret', 'turret_rate', 'rate', 'Sentry Turret Tighten Springs', 'turretFireRate', 'Sentry Turret: shoots faster. Only fire rate.', cap(8)),
    card('turret', 'turret_redeploy', 'reload', 'Sentry Turret Loosen Bolts', 'turretReload', 'Sentry Turret: turret charges come back faster, so more turrets are out at once. Only reload speed.', cap(8)),
    card('turret', 'turret_pierce', 'pierce', 'Sentry Turret Add Punch', 'turretPierce', 'Sentry Turret: each bolt punches through one more enemy (each one behind takes a little less). Only pierce.', cap(4))
  ],
  drones: [
    card('drones', 'drones_damage', 'damage', 'Escort Drone Guns', 'droneDamage', 'Escort Drones: heavier guns. Only bolt damage.'),
    card('drones', 'drones_rate', 'rate', 'Escort Drone Fire Rate', 'droneFireRate', 'Escort Drones: each drone shoots faster.', cap(8)),
    card('drones', 'drones_wingmen', 'wingmen', 'Escort Drone Wingmen', 'droneCount', 'Escort Drones: one more drone joins the formation (the front pair, then the back row).', { maxLevel: 4 }),
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
    card('flamethrower', 'flamethrower_turn', 'turn', 'Flamethrower Spin Rotor', 'flameTurn', 'Flamethrower: the nozzle spins round the ship faster. Only spin speed.', cap(6)),
    card('flamethrower', 'flamethrower_burn', 'burn', 'Flamethrower Sticky Gel', 'flamethrower:burn', 'Flamethrower: the fuel clings and burns hotter: a stronger FIRE burn on everything it touches.', cap(4)),
    card('flamethrower', 'flamethrower_nozzles', 'nozzles', 'Flamethrower Extra Nozzle', 'flameNozzles', 'Flamethrower: one more nozzle, spaced evenly round the spin: one more stream of fire.', cap(3))
  ],
  cryospray: [
    card('cryospray', 'cryospray_damage', 'damage', 'Cryo Sprayer Supercooled Mix', 'cryoDamage', 'Cryo Sprayer: colder coolant. Only spray damage.'),
    card('cryospray', 'cryospray_rate', 'rate', 'Cryo Sprayer Coolant Pump', 'cryoTickRate', 'Cryo Sprayer: pumps more coolant, so the spray hits more often. Only spray rate.', cap(8)),
    card('cryospray', 'cryospray_range', 'range', 'Cryo Sprayer Nozzle Pressure', 'cryoRange', 'Cryo Sprayer: the spray reaches further. Only spray length.', cap(8)),
    card('cryospray', 'cryospray_cone', 'cone', 'Cryo Sprayer Wide Nozzle', 'cryoCone', 'Cryo Sprayer: a wider cone of frost. Only cone width.', cap(8)),
    card('cryospray', 'cryospray_turn', 'turn', 'Cryo Sprayer Spin Rotor', 'cryoTurn', 'Cryo Sprayer: the nozzle spins round the ship faster. Only spin speed.', cap(6)),
    card('cryospray', 'cryospray_chill', 'chill', 'Cryo Sprayer Deep Freeze', 'cryospray:chill', 'Cryo Sprayer: a stronger FROST rank: more cold per hit, a harder slow and longer freezes.', cap(4)),
    card('cryospray', 'cryospray_nozzles', 'nozzles', 'Cryo Sprayer Extra Nozzle', 'cryoNozzles', 'Cryo Sprayer: one more nozzle, spaced evenly round the spin: one more stream of frost.', cap(3))
  ],
  acidspray: [
    card('acidspray', 'acidspray_damage', 'damage', 'Acid Sprayer Concentrate', 'acidDamage', 'Acid Sprayer: a stronger acid. Only spray damage.'),
    card('acidspray', 'acidspray_rate', 'rate', 'Acid Sprayer Pump', 'acidTickRate', 'Acid Sprayer: pumps more acid, so the spray hits more often. Only spray rate.', cap(8)),
    card('acidspray', 'acidspray_range', 'range', 'Acid Sprayer Nozzle Pressure', 'acidRange', 'Acid Sprayer: the spray reaches further. Only spray length.', cap(8)),
    card('acidspray', 'acidspray_cone', 'cone', 'Acid Sprayer Wide Nozzle', 'acidCone', 'Acid Sprayer: a wider cone of acid. Only cone width.', cap(8)),
    card('acidspray', 'acidspray_turn', 'turn', 'Acid Sprayer Spin Rotor', 'acidTurn', 'Acid Sprayer: the nozzle spins round the ship faster. Only spin speed.', cap(6)),
    card('acidspray', 'acidspray_etch', 'acid', 'Acid Sprayer Etching Agent', 'acidspray:corrodeMax', 'Acid Sprayer: a stronger CORROSIVE rank: more corrosion per hit and a higher damage-taken cap.', cap(4)),
    card('acidspray', 'acidspray_nozzles', 'nozzles', 'Acid Sprayer Extra Nozzle', 'acidNozzles', 'Acid Sprayer: one more nozzle, spaced evenly round the spin: one more stream of acid.', cap(3))
  ],
  shockfield: [
    card('shockfield', 'shockfield_damage', 'damage', 'Shock Field Voltage', 'fieldDamage', 'Electric Shield Field: a harder jolt. Only discharge damage.'),
    card('shockfield', 'shockfield_recharge', 'recharge', 'Shock Field Capacitors', 'fieldCooldown', 'Electric Shield Field: recharges faster between discharges. Only recharge time.', cap(4)),
    card('shockfield', 'shockfield_radius', 'radius', 'Shock Field Radius', 'fieldRadius', 'Electric Shield Field: a wider field. Only its radius.', cap(8)),
    card('shockfield', 'shockfield_stun', 'stun', 'Shock Field Stun Coils', 'fieldStun', 'Electric Shield Field: its SHOCK stuns longer and more often. Only the stun.', cap(4))
  ],
  raillance: [
    card('raillance', 'raillance_damage', 'damage', 'Rail Lance Slug Mass', 'railDamage', 'Rail Lance: a heavier slug. Only damage per lance.'),
    card('raillance', 'raillance_rate', 'rate', 'Rail Lance Capacitor Bank', 'railCycle', 'Rail Lance: charges faster, so it fires more often. Only charge time.', cap(6)),
    card('raillance', 'raillance_count', 'count', 'Rail Lance Split Rails', 'railLances', 'Rail Lance: one more lance per shot, fanned out beside the first.', cap(3)),
    card('raillance', 'raillance_width', 'width', 'Rail Lance Flux Lens', 'railWidth', 'Rail Lance: a wider line that clips more enemies. Only its width.', cap(6)),
    card('raillance', 'raillance_pierce', 'pierce', 'Rail Lance Penetrator Core', 'railKeep', 'Rail Lance: loses less damage for every enemy it pierces. Only the pierce falloff.', cap(5))
  ],
  glaive: [
    card('glaive', 'glaive_damage', 'damage', 'Glaive Edge', 'glaiveDamage', 'Glaive Discs: keener edges. Only damage per hit.'),
    card('glaive', 'glaive_count', 'count', 'Glaive Disc Count', 'glaiveCount', 'Glaive Discs: one more disc per throw.', cap(4)),
    card('glaive', 'glaive_chain', 'chain', 'Glaive Ricochet', 'glaiveBounces', 'Glaive Discs: each disc ricochets to one more enemy. Only ricochets.', cap(6)),
    card('glaive', 'glaive_rate', 'rate', 'Glaive Launcher', 'glaiveCooldown', 'Glaive Discs: throws more often. Only throw rate.', cap(8)),
    card('glaive', 'glaive_speed', 'speed', 'Glaive Spin', 'glaiveSpeed', 'Glaive Discs: faster discs. Only disc speed.', cap(6))
  ],
  nanites: [
    card('nanites', 'nanites_damage', 'damage', 'Nanite Swarm Acid Enzymes', 'naniteDamage', 'Nanite Swarm: a hungrier strain. Only damage per bite.'),
    card('nanites', 'nanites_rate', 'rate', 'Nanite Swarm Hunger', 'naniteTickRate', 'Nanite Swarm: the nanites bite more often. Only bite rate.', cap(8)),
    card('nanites', 'nanites_radius', 'radius', 'Nanite Swarm Cloud Size', 'naniteRadius', 'Nanite Swarm: wider swarms. Only swarm size.', cap(8)),
    card('nanites', 'nanites_duration', 'duration', 'Nanite Swarm Endurance', 'naniteLife', 'Nanite Swarm: each swarm holds together longer before it disperses. Only lifetime.', cap(8)),
    card('nanites', 'nanites_launch', 'cooldown', 'Nanite Swarm Fabricator', 'naniteCooldown', 'Nanite Swarm: a fresh swarm launches sooner. Only launch rate.', cap(6))
  ],
  harpoon: [
    card('harpoon', 'harpoon_damage', 'damage', 'Claw Harpoon Tungsten Bit', 'harpoonDamage', 'Claw Harpoon: a harder drill bit. Only damage per hit.'),
    card('harpoon', 'harpoon_rate', 'rate', 'Claw Harpoon Winch Motor', 'harpoonRate', 'Claw Harpoon: a faster winch throws and reels in the claw more often. Only throw rate.', cap(8)),
    card('harpoon', 'harpoon_range', 'range', 'Claw Harpoon Tether Length', 'harpoonRange', 'Claw Harpoon: a longer tether, so the claw flies further. Only reach.', cap(8)),
    card('harpoon', 'harpoon_grapple', 'grapple', 'Claw Harpoon Grapple Hooks', 'harpoonHook', 'Claw Harpoon: stronger hooks reel in bigger enemies. Only the size it can yank.', cap(6)),
    card('harpoon', 'harpoon_drill', 'drill', 'Claw Harpoon Rock Drill', 'harpoonDrill', 'Claw Harpoon: the claw bores through more rock per throw before it bites to a stop. Only mining.', cap(8))
  ],
  quake: [
    card('quake', 'quake_damage', 'damage', 'Graviton Mortar Dense Core', 'quakeDamage', 'Graviton Mortar: denser charges. Only gravity wave damage.'),
    card('quake', 'quake_count', 'count', 'Graviton Mortar Barrels', 'quakeShells', 'Graviton Mortar: one more charge per volley, aimed at the next pack.', cap(4)),
    card('quake', 'quake_rate', 'rate', 'Graviton Mortar Autoloader', 'quakeCooldown', 'Graviton Mortar: fires volleys more often. Only fire rate.', cap(8)),
    card('quake', 'quake_radius', 'radius', 'Graviton Mortar Wave Radius', 'quakeRadius', 'Graviton Mortar: the gravity waves ripple out wider. Only wave size.'),
    card('quake', 'quake_bore', 'bore', 'Graviton Mortar Tidal Shear', 'quakeRock', 'Graviton Mortar: its gravity waves tear at the rocks they pass (the base waves leave rocks alone); more ranks break them sooner, and broken rocks count as mined. Only rock damage.', cap(6))
  ]
};

export const STAT_CARD_LIST = Object.values(STAT_CARDS).flat();
// Stat cards that no longer exist, by id: old run stats still name them, and nothing else reads them
// (runs are not saved mid-run, and a weapon's ranks are looked up only for its current cards).
export const RETIRED_STAT_CARDS = Object.freeze({
  turret_count: 'Sentry Turret Count (retired)',
  turret_lifetime: 'Sentry Turret Lifetime (retired)'
});
export const STAT_CARD_BY_ID = Object.fromEntries(STAT_CARD_LIST.map((c) => [c.id, c]));

// --- Element infusion (v0.34) ----------------------------------------------------------------------
// Four weapons can carry an ELEMENT: FIRE (burn), FROST (chill), CORROSIVE (corrode) or SHOCK (stun).
// Each has one element card per element ("Autocannon: Thermite Rounds"), offered only in level-up hands
// (never in supply caches). The first one taken LOCKS that weapon's element for the run: the other three
// are never offered again, and more cards of the same element are rank-ups (stronger status). Like stat
// cards, every rank raises the weapon's level by 1 and counts toward LV 18 and its Breakthroughs.
// Rank state lives in player.weapons under the card id (`blaster_fire`), so status-effects.js reads it
// per hit with plain property lookups. The numbers per rank live in weapon-scaling.js.
export const ELEMENTS = ['fire', 'frost', 'corrode', 'shock'];
export const ELEMENT_WEAPONS = ['blaster', 'rockets', 'missiles', 'grenades'];
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
  grenades: { fire: 'Thermite Charge', frost: 'Cryo Charge', corrode: 'Nanite Charge', shock: 'Shock Charge' }
};
const ELEMENT_WEAPON_TEXT = {
  blaster: 'Autocannon bolts (Pulsar Helix too)', rockets: 'Rocket Pod hits and blasts', missiles: 'Swarm Missile blasts',
  grenades: 'Plasma Grenade blasts, bomblets and clouds'
};
const ELEMENT_EFFECT_TEXT = {
  fire: 'set targets on FIRE: hits pile on burn stacks that tick hard and spread to enemies beside them. More ranks add more stacks.',
  frost: 'build COLD: targets slow as it builds, then FREEZE solid and take extra damage. More ranks freeze faster, longer and slow harder.',
  corrode: 'CORRODE targets: acid ticks, and every stack makes them take more damage from everything. More ranks stack faster and cap higher.',
  shock: 'SHOCK targets: a quick zap stun, sometimes a long one, and shock arcs between enemies that touch. More ranks stun longer and more often.'
};
export const ELEMENT_WEAPON_LABEL = {
  blaster: 'Autocannon', rockets: 'Rocket Pods', missiles: 'Swarm Missiles', lightning: 'Tesla Arc', grenades: 'Plasma Grenades',
  // Built-in elements (FIXED_ELEMENTS): no element cards, but the same status rows.
  flamethrower: 'Flamethrower', cryospray: 'Cryo Sprayer', acidspray: 'Acid Sprayer', gas: 'Gas Trail', nanites: 'Nanite Swarm'
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
// The Cryo Sprayer (FROST) and Acid Sprayer (CORROSIVE) rank theirs like the Flamethrower, from Deep Freeze / Etching Agent.
// The Tesla Arc is lightning, so it is always SHOCK (Clay, v0.43.1; it took Stun Arcs and the other element
// cards before): its rank follows its level like the Gas Trail's, so it needs no extra card.
// The Nanite Swarm is always CORROSIVE (it eats hulls): its rank follows its level like the Gas Trail's.
export const FIXED_ELEMENTS = { gas: 'corrode', flamethrower: 'fire', cryospray: 'frost', acidspray: 'corrode', shockfield: 'shock', lightning: 'shock', nanites: 'corrode' };
export const fixedElementRank = (lv) => Math.min(ELEMENT_MAX_RANKS, 1 + Math.floor(Math.max(0, lv) / 6));
// Sprayer element rank from a build: 1 + its element stat ranks (burn / chill / acid; one per sprayer).
export const flameBurnRank = (b) => Math.min(ELEMENT_MAX_RANKS, 1 + (b?.r?.burn || b?.r?.chill || b?.r?.acid || 0));
// A sprayer's element rank read straight from its element card ranks and Breakthroughs (no build
// allocated: status-effects.js asks on every hit). Equals flameBurnRank(weaponBuild(p, weapon)).
const sprayElementRank = (weapon, cardId) => (p) => {
  const bt = p?.breakthroughs?.[weapon];
  let atb = 0;
  if (bt) for (const m of BREAKTHROUGH_LEVELS) if (bt[m] === 'boost') atb++;
  return Math.min(ELEMENT_MAX_RANKS, 1 + (p?.upgradeLevels?.[cardId] || 0) + atb * BT_BOOST_RANKS);
};
export const flameElementRank = sprayElementRank('flamethrower', 'flamethrower_burn');
export const cryoElementRank = sprayElementRank('cryospray', 'cryospray_chill');
export const acidElementRank = sprayElementRank('acidspray', 'acidspray_etch');
// Electric Shield Field SHOCK rank, the same way from its Stun Coils ranks (equals W.fieldStunRank of its build).
export function fieldElementRank(p) {
  const bt = p?.breakthroughs?.shockfield;
  let atb = 0;
  if (bt) for (const m of BREAKTHROUGH_LEVELS) if (bt[m] === 'boost') atb++;
  return Math.min(ELEMENT_MAX_RANKS, 1 + (p?.upgradeLevels?.shockfield_stun || 0) + atb * BT_BOOST_RANKS);
}
// Fixed-element weapons whose rank does not follow the level rule above.
const FIXED_ELEMENT_RANK = { flamethrower: flameElementRank, cryospray: cryoElementRank, acidspray: acidElementRank, shockfield: fieldElementRank };

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
  grenades: 'PLASMA GRENADES', gas: 'GAS TRAIL', flamethrower: 'FLAMETHROWER', cryospray: 'CRYO SPRAYER', acidspray: 'ACID SPRAYER', shockfield: 'SHOCK FIELD',
  raillance: 'RAIL LANCE',
  glaive: 'GLAIVE DISCS',
  nanites: 'NANITE SWARM',
  harpoon: 'CLAW HARPOON',
  quake: 'GRAVITON MORTAR'
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
    6: tf('capacity', 'Extra Capacity', 'Sentry Turret: carry one more turret charge, and every bolt hits harder.'),
    12: tf('mobile', 'Tank Tracks', 'Sentry Turrets roll after you instead of staying where they were planted, and their bolts hit harder.'),
    18: tf('overload', 'LMG Overload', 'Sentry Turrets fire twice as fast with a little spray; each bolt a bit lighter.')
  },
  drones: {
    6: tf('wingman', 'Escort Squadron', 'Escort Drones: 3 more drones join the formation (up to 8: 3 in front, 5 behind). Drones past 8 add their guns to the rest.'),
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
    6: tf('fireballs', 'Fireballs', 'Every second each Flamethrower nozzle lobs a fireball that bursts at the tip of its flames, scorching and igniting everything around it, and the nozzle spins faster.'),
    12: tf('napalm', 'Napalm Puddles', 'Flamethrower fuel splashes down at the tip of the flames as burning napalm puddles that keep scorching whatever walks through, and the nozzle spins faster.'),
    18: tf('ring', 'Inferno Ring', 'Every few seconds the Flamethrower vents a ring of fire that rolls out all around you, scorching and shoving back everything it passes.')
  },
  cryospray: {
    6: tf('shatter', 'Shatter', 'When the Cryo Sprayer hits a FROZEN enemy it shatters in a burst of ice shards that hits and chills everything around it, and the nozzle spins faster.'),
    12: tf('slicks', 'Frost Slicks', 'Cryo Sprayer coolant splashes down at the tip of the spray as freezing slicks that keep chilling whatever crosses them, and the nozzle spins faster.'),
    18: tf('blizzard', 'Blizzard Ring', 'Every few seconds the Cryo Sprayer vents a ring of frost that rolls out all around you, chilling and shoving back everything it passes.')
  },
  acidspray: {
    6: tf('meltdown', 'Meltdown', 'Corroded enemies the Acid Sprayer kills melt down in an acid splash that hits and corrodes everything around them, and the nozzle spins faster.'),
    12: tf('pools', 'Acid Pools', 'Acid Sprayer acid splashes down at the tip of the spray as caustic pools that keep eating whatever crosses them, and the nozzle spins faster.'),
    18: tf('caustic', 'Caustic Ring', 'Every few seconds the Acid Sprayer vents a ring of acid that rolls out all around you, corroding and shoving back everything it passes.')
  },
  shockfield: {
    6: tf('lash', 'Arc Lash', 'Every Electric Shield Field discharge also lashes arcs out at the 3 nearest enemies beyond the field, stunning them too.'),
    12: tf('repulse', 'Repulsor Surge', 'Electric Shield Field discharges hurl enemies back and hit harder, and each one that lands recharges your Phase Dash faster.'),
    18: tf('overcharge', 'Thunderclap Overcharge', 'The Electric Shield Field banks charge with every discharge. When a big pack or a boss closes in, it releases it all in a wide thunderclap.')
  },
  raillance: {
    6: tf('magnet', 'Magnetic Rail', 'While the Rail Lance charges, its field drags nearby enemies onto the firing line, and every lance hits harder.'),
    12: tf('wake', 'Ion Wake', 'Every Rail Lance shot leaves a crackling ion line that keeps zapping whatever stands on it or walks through.'),
    18: tf('overload', 'Overload Shot', 'Every third Rail Lance shot is an Overload: a beam three times as wide that hits twice as hard.')
  },
  glaive: {
    6: tf('fission', 'Fission Discs', 'A Glaive Disc splits in two on its first hit. Both twins ricochet on through the pack with every bounce the disc had left.'),
    12: tf('momentum', 'Momentum Edge', 'Glaive Discs feed on impact: every bounce speeds them up instead of slowing them, and every ricochet hits harder than the last.'),
    18: tf('recall', 'Boomerang Recall', 'Spent Glaive Discs no longer fade: they swing back to your ship, slicing through the enemies on the way home.')
  },
  nanites: {
    6: tf('fission', 'Fission Bloom', 'Every few kills a Nanite Swarm buds off a daughter swarm that flies to the next pack and eats it too.'),
    12: tf('goo', 'Gray Goo', 'Nanite Swarms feed on what they kill: every kill keeps the swarm alive longer and lets it swell far past its usual size.'),
    18: tf('plague', 'Nanite Plague', 'Enemies a Nanite Swarm bites carry the plague: when one dies to anything, a small swarm bursts from the wreck and keeps eating.')
  },
  harpoon: {
    6: tf('slam', 'Seismic Slam', 'Every time the Claw Harpoon reels in, your claws snap shut in a seismic slam that hits everything round your nose.'),
    12: tf('spin', 'Drill Spin', 'At the end of every throw the Claw Harpoon spins in place, grinding every enemy and rock round its tip before it reels back.'),
    18: tf('chain', 'Chain Harpoon', 'At the end of every throw the Claw Harpoon leaps on to up to 3 more enemies near its tip, skewering each one before it reels back.')
  },
  quake: {
    6: tf('skip', 'Rebound Pulse', 'Graviton Mortar charges rebound after they burst: each one springs to the next pack twice, pulsing again in smaller gravity waves.'),
    12: tf('fault', 'Spacetime Fractures', 'Every Graviton Mortar burst tears three seams in space-time that snap shut a moment later, hitting everything along them and shattering any rock they cross.'),
    18: tf('epicenter', 'Graviton Surge', 'Every third Graviton Mortar volley your own hull releases a huge gravity wave around the ship, hurling back everything close.')
  }
};

// Which stats add damage output (POWER) vs. only shape the weapon (UTILITY): tests and the Field Guide.
// A longer-lived singularity grinds longer, so its lifetime is POWER too. Everything else (size, radius,
// pull, reach, range, spin, pierce, capacity, fuse) is UTILITY. Sentry Turret reload is POWER: more
// charges back means more turrets out.
export const POWER_STATS = new Set(['damage', 'rate', 'reload', 'recharge', 'cooldown', 'count', 'salvo', 'chain', 'prism', 'wingmen', 'duration', 'nozzles']);

// REPLICATOR ARRAY (global card, v0.45): each rank adds +1 rank to the "how many" stat of every equipped
// weapon that has one (COUNT_STATS), as a bonus outside the weapon level like ACROSS THE BOARD's ranks, so
// Breakthrough timing never moves. The card ranks + Replicator ranks of a count stat never pass that stat
// card's own cap (a weapon already at its cap gets nothing), and the count card's own room shrinks to match.
// `stat` is the build rank key; `card` the weapon's count card (null: the Sentry Turret has no count card,
// so its bonus is a turret charge, kept in r.charges); `cap` its rank cap; `per` the amount one rank adds
// and `unit` the word on the card headline. Weapons missing here (Vortex Singularity, Gas Trail, Shock
// Field, Nanite Swarm, Claw Harpoon) have no count stat and get nothing.
export const REPLICATOR_ID = 'replicator_array';
export const REPLICATOR_MAX_RANKS = 2;
const countStat = (stat, card, cap, per, unit) => ({ stat, card, cap, per, unit });
export const COUNT_STATS = Object.freeze({
  blaster: countStat('prism', 'multishot', 5, 2, 'STREAMS'),
  rockets: countStat('count', 'rockets_count', 6, 1, 'ROCKET'),
  missiles: countStat('salvo', 'missiles_salvo', 8, 1, 'MISSILE'),
  lightning: countStat('chain', 'lightning_chain', 6, 2, 'ARC JUMPS'),
  orbitals: countStat('count', 'orbitals_count', 6, 1, 'BLADE'),
  mines: countStat('capacity', 'mines_capacity', 8, 1, 'MINE'),
  turret: countStat('charges', null, 2, 1, 'TURRET'),
  drones: countStat('wingmen', 'drones_wingmen', 4, 1, 'DRONE'),
  grenades: countStat('count', 'grenades_count', 5, 1, 'GRENADE'),
  flamethrower: countStat('nozzles', 'flamethrower_nozzles', 3, 1, 'NOZZLE'),
  cryospray: countStat('nozzles', 'cryospray_nozzles', 3, 1, 'NOZZLE'),
  acidspray: countStat('nozzles', 'acidspray_nozzles', 3, 1, 'NOZZLE'),
  raillance: countStat('count', 'raillance_count', 3, 1, 'LANCE'),
  glaive: countStat('count', 'glaive_count', 4, 1, 'DISC'),
  quake: countStat('count', 'quake_count', 4, 1, 'CHARGE')
});
export const replicatorRanks = (p) => p?.upgradeLevels?.[REPLICATOR_ID] || 0;
// Replicator ranks a weapon actually gets (0..ranks): what fits under its count cap after its own card ranks.
export function replicatorBonus(id, cardRanks, ranks) {
  const cs = COUNT_STATS[id];
  return cs && ranks > 0 ? Math.max(0, Math.min(ranks, cs.cap - (cardRanks || 0))) : 0;
}
// Count ranks a weapon can still take from one more Replicator rank (its card ranks + bonus under the cap).
export function countRoom(p, id) {
  const cs = COUNT_STATS[id];
  if (!cs) return 0;
  const own = cs.card ? p?.upgradeLevels?.[cs.card] || 0 : 0;
  return Math.max(0, cs.cap - own - replicatorBonus(id, own, replicatorRanks(p)));
}

export const BOOST_NAME = 'Across the Board';
export const boostSummary = (weaponName) => `${weaponName}: +${Math.round((BT_BOOST_DPS - 1) * 100)}% damage and +${BT_BOOST_RANKS} to every size, reach and range stat. No new tricks, just more of the same.`;

// In-world R&D lines for the Breakthrough header ({weapon} is the weapon's name).
export const RD_LINES = [
  'Bridge, this is R&D: we cracked something in the {weapon} telemetry. Pick which prototype goes into production.',
  'Your science and engineering team made an exciting discovery in the {weapon}. Sign off on one build.',
  'Science bay here. The {weapon} just did something it should not be able to do. We want to do it again.',
  'Engineering: three {weapon} blueprints, one fabricator slot. Your call, pilot.',
  'R&D to pilot: the {weapon} field data is in and it is beautiful. Which version do we print?',
  'Somebody in the lab overclocked the {weapon} and nothing exploded. Pick the keeper.',
  'Prototype bay: three new {weapon} configurations are ready. One ships today.',
  'Chief engineer here. We rewired the {weapon} core and found headroom. Spend it.'
];

export const rdLine = (index, weaponName) => RD_LINES[((index % RD_LINES.length) + RD_LINES.length) % RD_LINES.length].replace('{weapon}', weaponName);

// Milestones passed when a weapon goes from level `from` to `to` (each once, in order): a +3 card
// taking LV 5 -> 8 gives [6]; LV 11 -> 18 gives [12, 18].
export function milestonesCrossed(from, to) {
  return BREAKTHROUGH_LEVELS.filter((m) => from < m && to >= m);
}

// Chosen Breakthroughs of a weapon: { 6: option, 12: ..., 18: ... }. An option is a transform id
// ('flak'), a flat id ('boost' | 'overtuned'), or the legacy 'transform' (the milestone's home transform).
export const weaponBreakthroughs = (p, id) => p.breakthroughs?.[id] || {};

// --- Breakthrough pools (docs/BREAKTHROUGH_POOLS.md) -----------------------------------------------------
// Flats: shared by every weapon, no new mechanic. `dps` is the potential-DPS multiplier of one pick.
export const BT_FLATS = Object.freeze({
  boost: Object.freeze({ id: 'boost', name: 'Across the Board', dps: BT_BOOST_DPS }),
  overtuned: Object.freeze({ id: 'overtuned', name: 'Overtuned Core', dps: BT_OVERTUNED_DPS })
});
export const overtunedSummary = (weaponName) => `${weaponName}: +${Math.round((BT_OVERTUNED_DPS - 1) * 100)}% damage on every hit. No new tricks, no extras: just a hotter core.`;
// Draw weights of a transform: at its home milestone, and at any other one.
export const BT_HOME_WEIGHT = 3;
export const BT_AWAY_WEIGHT = 1;
// Chance the middle card is a transform (it is a flat otherwise).
export const BT_MIDDLE_TRANSFORM_CHANCE = 0.5;

// Every transform a weapon can draw: { id, name, summary, home, slot } (slot 0 / 1 / 2 sets the build's
// t4 / t8 / t12 flag, so the weapon code reads it wherever it was taken). Transforms added later go in
// EXTRA_TRANSFORMS[weapon] as { id, name, summary, home } and are read with b.tf.has(id). A transform that
// builds on another one lists it in `requires` (it is drawn only once those are installed); `notBefore`
// keeps one out of milestones under it (use the home milestone for "home tier or later").
export const EXTRA_TRANSFORMS = {
  blaster: [
    { id: 'slug', home: 6, name: 'Tracer Slugs', summary: 'Every fourth Autocannon shot is a heavy tracer slug: a big, hot bolt that hits far harder and punches through two more enemies.' },
    { id: 'hotbarrel', home: 12, name: 'Hot Barrel', summary: 'Keep the Autocannon firing and its barrel heats up, firing faster and faster (up to +60%) as the bolts glow from cyan to white-hot orange.' }
  ],
  rockets: [
    { id: 'shrapnel', home: 6, name: 'Shrapnel Shells', summary: 'Every Rocket Pod blast sprays a ring of jagged shrapnel that tears through the enemies around it.' },
    { id: 'thunder', home: 18, name: 'Rolling Thunder', summary: 'Rocket Pod rockets drop a string of charges along their flight path that blow one after another behind them.' }
  ],
  missiles: [
    { id: 'hunter', home: 6, name: 'Hunter-Killer', summary: 'Every Swarm Missile blast launches a hunter micro-missile at the nearest enemy beyond it.' },
    { id: 'echo', home: 12, name: 'Echo Salvo', summary: 'A moment after each Swarm Missile salvo, a phantom echo salvo at half strength follows it onto the same targets.' }
  ]
};
export function transformPool(id) {
  const out = BREAKTHROUGH_LEVELS.map((m, slot) => TRANSFORMS[id]?.[m] && { ...TRANSFORMS[id][m], home: m, slot }).filter(Boolean);
  for (const t of EXTRA_TRANSFORMS[id] || []) out.push({ ...t, slot: -1 });
  return out;
}
// Can transform `t` be drawn at milestone `m` with `taken` (a Set of installed transform ids)?
export const transformEligible = (t, m, taken) =>
  !taken.has(t.id) && (t.requires || []).every((r) => taken.has(r)) && m >= (t.notBefore || 0);
export const transformById = (id, tfId) => transformPool(id).find((t) => t.id === tfId) || null;

// The option id behind a stored choice ('transform' means the milestone's home transform).
export const btOptionId = (id, m, v) => (v === 'transform' ? TRANSFORMS[id]?.[m]?.id ?? null : v ?? null);
// What a stored choice is: { kind: 'transform', transform } or { kind: flat id, flat }, or null.
export function btOption(id, m, v) {
  const opt = btOptionId(id, m, v);
  if (!opt) return null;
  if (BT_FLATS[opt]) return { id: opt, kind: opt, flat: BT_FLATS[opt], name: BT_FLATS[opt].name };
  const t = transformById(id, opt);
  return t ? { id: opt, kind: 'transform', transform: t, name: t.name } : null;
}
// Transform ids a weapon already has installed.
export function takenTransforms(id, bt = {}) {
  const out = new Set();
  for (const m of BREAKTHROUGH_LEVELS) {
    const o = btOption(id, m, bt[m]);
    if (o?.kind === 'transform') out.add(o.id);
  }
  return out;
}

// Weighted pick without replacement from `items` ({ w } each); null when empty.
function weightedTake(items, rng) {
  const total = items.reduce((s, it) => s + it.w, 0);
  if (!items.length || total <= 0) return null;
  let roll = rng() * total;
  const i = items.findIndex((it) => (roll -= it.w) < 0);
  return items.splice(i < 0 ? items.length - 1 : i, 1)[0];
}

// The 3 options of a weapon's Breakthrough at milestone `m`, given what it already has (`bt`): option ids,
// shuffled. Card 1 is a transform, card 2 a transform or a flat, card 3 a flat; at least one of each, never
// a duplicate, a transform already installed never comes back, and none comes before what it `requires`.
// A short pool fills with flats.
export const BT_HAND_SIZE = 3;
export function drawBreakthroughOptions(id, m, bt = {}, rng = Math.random) {
  const taken = takenTransforms(id, bt);
  const tfs = transformPool(id).filter((t) => transformEligible(t, m, taken)).map((t) => ({ id: t.id, w: t.home === m ? BT_HOME_WEIGHT : BT_AWAY_WEIGHT }));
  const flats = Object.keys(BT_FLATS).map((f) => ({ id: f, w: 1 }));
  const hand = [];
  const first = weightedTake(tfs, rng);
  if (first) hand.push(first.id);
  const middle = (rng() < BT_MIDDLE_TRANSFORM_CHANCE && weightedTake(tfs, rng)) || weightedTake(flats, rng);
  if (middle) hand.push(middle.id);
  while (hand.length < BT_HAND_SIZE) {
    const next = weightedTake(flats, rng) || weightedTake(tfs, rng);
    if (!next) break;
    hand.push(next.id);
  }
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  return hand;
}

// Ranks a player holds in each stat of a weapon (card levels from upgradeLevels).
export function statRanks(p, id) {
  const out = {};
  for (const c of STAT_CARDS[id] || []) out[c.stat] = p.upgradeLevels?.[c.id] || 0;
  return out;
}

// Everything the weapon formulas need: level (with any evolution bonus level), effective ranks
// (card ranks + ACROSS THE BOARD ranks), which transforms are installed and how many boosts.
// `replicator`: REPLICATOR ARRAY ranks, added to the weapon's COUNT_STATS stat up to its cap.
// `tf` is the set of installed transform ids; `ot` counts OVERTUNED CORE picks.
export function makeBuild(id, lv, ranks = {}, bt = {}, replicator = 0) {
  let atb = 0;
  let ot = 0;
  const tf = new Set();
  const t = [false, false, false];
  for (const m of BREAKTHROUGH_LEVELS) {
    const o = btOption(id, m, bt[m]);
    if (!o) continue;
    if (o.kind === 'boost') atb++;
    else if (o.kind === 'overtuned') ot++;
    else if (o.kind === 'transform') {
      tf.add(o.id);
      if (o.transform.slot >= 0) t[o.transform.slot] = true;
    }
  }
  const r = {};
  for (const c of STAT_CARDS[id] || []) r[c.stat] = (ranks[c.stat] || 0) + (POWER_STATS.has(c.stat) ? 0 : atb * BT_BOOST_RANKS);
  const cs = COUNT_STATS[id];
  if (cs && replicator > 0) r[cs.stat] = (r[cs.stat] || 0) + replicatorBonus(id, ranks[cs.stat], replicator);
  // t4 / t8 / t12: the weapon's first, second and third transform (home LV 6 / 12 / 18) is installed,
  // at whichever milestone it was taken.
  return { id, lv, r, atb, ot, tf, t4: t[0], t8: t[1], t12: t[2], transforms: tf.size };
}

// Build of an owned weapon. `levelKey` is the player.weapons key holding its level (loadout.js).
export function weaponBuild(p, id, lv = null) {
  const level = lv ?? (id === 'blaster' ? Math.max(1, p.weapons?.blaster || 0) : (p.weapons?.[id] || 0));
  return makeBuild(id, level, statRanks(p, id), weaponBreakthroughs(p, id), replicatorRanks(p));
}

// A weapon at a level with no stat ranks and no Breakthroughs (Storm Protocol's fixed chain level).
export const levelBuild = (id, lv) => makeBuild(id, lv);
