// Upgrade card previews: headline benefit + exact BEFORE -> AFTER stats.
// Numbers are never hand-written: describeUpgrade() installs the upgrade (with its rolled level jump)
// on a deep copy of the player and diffs STAT_ROWS, which read the same values and WEAPON_SCALING
// formulas the game simulates with.
import { TUNING } from './config.js';
import { RARITY, rarityFor, applyUpgradeLevels, applyBreakthrough, levelJumpChances, acquireWeapon, UPGRADE_BY_ID } from './upgrades.js';
import {
  WEAPON_SCALING as W, TAG_INFO, prismNewestGroup, weaponDamage, areaMult, missileBlastRadius, singularityPullRadius, novaRadius,
  tectonicBlastRadius, mineBlastRadius, wingRocketBlastRadius, critChance, critDamage, critMultiplier, burnStackDps, chillSlow, corrodePerStack,
  blasterStreams, blasterFireRate, blasterPierce, POTENTIAL_DPS, DPS_TARGET, tagDamageMult, grenadeBlastRadius
} from './weapon-scaling.js';
import { grenadeElement } from './grenades.js';
import { WEAPON_BY_ID, ownsWeapon, ownedWeapons, weaponSlots, weaponTags, weaponLevel } from './loadout.js';
import {
  STAT_CARD_BY_ID, WEAPON_MAX_LEVEL, WEAPON_BADGE, TRANSFORMS, BOOST_NAME, BT_BOOST_RANKS, BT_BOOST_DPS, boostSummary,
  weaponBuild, levelBuild
} from './weapon-levels.js';

const MAX_ROWS = 6;
// Jackpot caches with more than 3 rewards wrap to two rows of cards; fewer rows keep them on one screen.
export const COMPACT_MAX_ROWS = 3;
const int = (v) => String(Math.round(v));
const dec1 = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));
const secs = (v) => `${v.toFixed(2)}s`;
const pct = (v) => `${Math.round(v * 100)}%`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const pct2 = (v) => `${(v * 100).toFixed(2)}%`;
const mult = (v) => `${v.toFixed(2)}x`;
const bonus = (v) => `+${Math.round(v * 100)}%`;
const tagBonus = (v) => bonus(v - 1);
const tagBoost = (p, tag) => p.stats.tagDamage?.[tag] ?? 1;
const lv = (p, key) => p.weapons[key] || 0;
const owned = (p, key, fn) => (lv(p, key) > 0 ? fn(lv(p, key)) : null);
const sec1 = (v) => `${v.toFixed(1)}s`;
// A weapon's rows show only while it is equipped (any weapon, Autocannon included, can be discarded);
// `fn` gets the weapon's build (level, stat ranks, Breakthroughs).
const wb = (p, id, fn) => (ownsWeapon(p, id) ? fn(weaponBuild(p, id)) : null);
// Deployable hits scale with bolt damage and the tuner's deployable multiplier (same as deployables.js).

// headline: 'count' (+N UNIT), 'pct' (+N% UNIT), 'points' (+N% UNIT for ratio stats like luck),
// or a function(before, after). newText: headline when the row comes online (before is null).
export const STAT_ROWS = [
  // Build-wide modifiers first, so crit, tag and Reactor Overdrive cards lead with their own row
  { id: 'allDamage', label: 'Base damage (all weapons)', get: (p) => p.stats.damage, fmt: dec1, headline: 'pct', unit: 'DAMAGE · ALL WEAPONS' },
  { id: 'critChance', label: 'Crit chance', get: (p) => critChance(p), fmt: pct, headline: 'points', unit: 'CRIT CHANCE' },
  { id: 'critDamage', label: 'Crit damage', get: (p) => critDamage(p), fmt: mult, headline: 'points', unit: 'CRIT DAMAGE' },
  { id: 'critAverage', label: 'Avg bonus from crits', get: (p) => critChance(p) * (critDamage(p) - 1), fmt: (v) => `+${(v * 100).toFixed(1)}%` },
  { id: 'critAfflicted', label: 'Crit vs afflicted', get: (p) => (p.weapons.supercritical ? critMultiplier(p, true) : null), fmt: mult, newText: (a, row) => `AFFLICTED CRITS // ${row.fmt(a)}` },
  { id: 'kineticDamage', label: 'KINETIC damage bonus', get: (p) => tagBoost(p, 'kinetic'), fmt: tagBonus, headline: 'points', unit: 'KINETIC DAMAGE' },
  { id: 'explosiveDamage', label: 'EXPLOSIVE damage bonus', get: (p) => tagBoost(p, 'explosive'), fmt: tagBonus, headline: 'points', unit: 'EXPLOSIVE DAMAGE' },
  { id: 'electricDamage', label: 'ELECTRIC damage bonus', get: (p) => tagBoost(p, 'electric'), fmt: tagBonus, headline: 'points', unit: 'ELECTRIC DAMAGE' },
  { id: 'areaSize', label: 'AREA size', get: (p) => areaMult(p), fmt: pct, headline: 'points', unit: 'AREA SIZE' },

  // Autocannon (primary blaster). Each weapon's rows read its build (weapon-levels.js), so a stat card
  // shows exactly its own stat plus the damage per hit its new level brings.
  { id: 'bulletCount', label: 'Projectiles', get: (p) => wb(p, 'blaster', (b) => blasterStreams(p, b)), fmt: int, headline: 'count', unit: 'AUTOCANNON PROJECTILES' },
  { id: 'prismLayout', label: 'Newest streams', get: (p) => wb(p, 'blaster', (b) => blasterStreams(p, b)), fmt: (v) => prismNewestGroup(v) },
  { id: 'fireRate', label: 'Fire rate', get: (p) => wb(p, 'blaster', (b) => blasterFireRate(p, b)), fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'AUTOCANNON FIRE RATE' },
  { id: 'bulletSpeed', label: 'Bolt speed', get: (p) => wb(p, 'blaster', () => p.stats.bulletSpeed), fmt: dec1, headline: 'pct', unit: 'BOLT SPEED' },
  { id: 'pierce', label: 'Pierce', get: (p) => wb(p, 'blaster', (b) => blasterPierce(p, b)), fmt: int, headline: 'count', unit: 'AUTOCANNON PIERCE' },
  { id: 'damage', label: 'Bolt damage', get: (p) => wb(p, 'blaster', (b) => weaponDamage(p, 'blaster', b)), fmt: dec1, headline: 'pct', unit: 'AUTOCANNON DAMAGE' },

  // Rocket Pods
  { id: 'rocketCount', label: 'Rockets / volley', get: (p) => wb(p, 'rockets', W.wingRocketCount), fmt: int, headline: 'count', unit: 'ROCKETS / VOLLEY', newText: (a) => `ROCKET PODS // ${a} / VOLLEY` },
  { id: 'rocketDamage', label: 'Rocket hit', get: (p) => wb(p, 'rockets', (b) => weaponDamage(p, 'rocket', b)), fmt: dec1, headline: 'pct', unit: 'ROCKET DAMAGE' },
  { id: 'rocketCooldown', label: 'Rocket volley interval', get: (p) => wb(p, 'rockets', W.wingRocketCooldown), fmt: secs, headline: 'pct', unit: 'ROCKET VOLLEY INTERVAL' },
  { id: 'rocketBlast', label: 'Rocket blast radius', get: (p) => wb(p, 'rockets', (b) => wingRocketBlastRadius(p, b)), fmt: int, headline: 'count', unit: 'ROCKET BLAST RADIUS' },
  { id: 'helixBolts', label: 'Spiral bolts per Autocannon shot', get: (p) => (p.weapons.pulsarHelix ? W.helixArms : null), fmt: int, headline: 'count', unit: 'SPIRAL BOLTS PER AUTOCANNON SHOT', newText: (a) => `+${a} SPIRAL BOLTS` },
  { id: 'helixDamage', label: 'Helix bolt damage', get: (p) => (p.weapons.pulsarHelix ? weaponDamage(p, 'helix') : null), fmt: dec1 },

  // Swarm Micro-Missiles + Storm Protocol
  { id: 'missileSalvo', label: 'Missiles / salvo', get: (p) => wb(p, 'missiles', W.missileSalvo), fmt: int, headline: 'count', unit: 'MISSILES / SALVO' },
  { id: 'missileCooldown', label: 'Salvo cooldown', get: (p) => wb(p, 'missiles', W.missileCooldown), fmt: secs, headline: 'pct', unit: 'MISSILE RELOAD' },
  { id: 'missileDamage', label: 'Missile damage', get: (p) => wb(p, 'missiles', (b) => weaponDamage(p, 'missile', b)), fmt: dec1, headline: 'pct', unit: 'MISSILE DAMAGE' },
  { id: 'missileBlast', label: 'Missile blast radius', get: (p) => wb(p, 'missiles', (b) => missileBlastRadius(p, b)), fmt: int, headline: 'count', unit: 'MISSILE BLAST RADIUS' },
  { id: 'stormChain', label: 'Detonation lightning', get: (p) => (p.weapons.stormProtocol ? W.lightningJumps(levelBuild('lightning', W.stormChainLevel)) : null), fmt: (v) => `${v} jumps`, newText: () => 'MISSILES CHAIN LIGHTNING' },
  { id: 'stormDamage', label: 'Detonation arc damage', get: (p) => (p.weapons.stormProtocol ? weaponDamage(p, 'lightning', W.stormChainLevel) : null), fmt: dec1 },

  // Tesla Arc Emitter
  { id: 'lightningJumps', label: 'Arc jumps', get: (p) => wb(p, 'lightning', W.lightningJumps), fmt: int, headline: 'count', unit: 'ARC JUMPS' },
  { id: 'lightningChains', label: 'Arc chains / discharge', get: (p) => wb(p, 'lightning', W.lightningChains), fmt: int },
  { id: 'lightningCooldown', label: 'Arc cooldown', get: (p) => wb(p, 'lightning', W.lightningCooldown), fmt: secs, headline: 'pct', unit: 'ARC COOLDOWN' },
  { id: 'lightningReach', label: 'Arc jump reach', get: (p) => wb(p, 'lightning', W.lightningRange), fmt: int, headline: 'count', unit: 'ARC REACH' },
  { id: 'lightningDamage', label: 'Arc damage / jump', get: (p) => wb(p, 'lightning', (b) => weaponDamage(p, 'lightning', b)), fmt: dec1, headline: 'pct', unit: 'ARC DAMAGE' },

  // Vortex Singularity
  { id: 'singularityPull', label: 'Pull radius', get: (p) => wb(p, 'singularity', (b) => singularityPullRadius(p, b)), fmt: int, headline: 'count', unit: 'PULL RADIUS', newText: (a) => `SINGULARITIES // ${a} PULL RADIUS` },
  { id: 'singularityCount', label: 'Singularities / launch', get: (p) => wb(p, 'singularity', W.singularityCount), fmt: int },
  { id: 'singularityCooldown', label: 'Singularity cooldown', get: (p) => wb(p, 'singularity', W.singularityCooldown), fmt: secs, headline: 'pct', unit: 'VORTEX COOLDOWN' },
  { id: 'singularityLife', label: 'Singularity duration', get: (p) => wb(p, 'singularity', W.singularityLife), fmt: sec1, headline: (b, a) => `+${(a - b).toFixed(1)}s VORTEX DURATION` },
  { id: 'singularityCollapse', label: 'Collapse damage', get: (p) => wb(p, 'singularity', (b) => weaponDamage(p, 'collapse', b)), fmt: dec1, headline: 'pct', unit: 'IMPLOSION DAMAGE' },
  { id: 'singularityCore', label: 'Core radius', get: (p) => wb(p, 'singularity', W.singularityCoreRadius), fmt: int, headline: 'count', unit: 'CORE RADIUS' },
  { id: 'singularityGrind', label: 'Core grind / tick', get: (p) => wb(p, 'singularity', (b) => weaponDamage(p, 'singularity', b)), fmt: dec1 },

  // Aegis Orbiting Blades
  { id: 'orbitalBlades', label: 'Orbit blades', get: (p) => wb(p, 'orbitals', W.orbitalBlades), fmt: int, headline: 'count', unit: 'ORBIT BLADES' },
  { id: 'orbitalRadius', label: 'Orbit radius', get: (p) => wb(p, 'orbitals', W.orbitalRadius), fmt: int, headline: 'count', unit: 'ORBIT RADIUS' },
  { id: 'orbitalSpin', label: 'Orbit spin', get: (p) => wb(p, 'orbitals', W.orbitalSpin), fmt: (v) => `${v.toFixed(2)} rad/s`, headline: 'pct', unit: 'ORBIT SPIN' },
  { id: 'orbitalBladeSize', label: 'Blade size', get: (p) => wb(p, 'orbitals', W.orbitalBladeRadius), fmt: int, headline: 'pct', unit: 'BLADE SIZE' },
  { id: 'orbitalDamage', label: 'Blade damage / tick', get: (p) => wb(p, 'orbitals', (b) => weaponDamage(p, 'orbital', b)), fmt: dec1, headline: 'pct', unit: 'BLADE DAMAGE' },

  // Volatile Shatter
  { id: 'shrapnelShards', label: 'Shards / burst', get: (p) => owned(p, 'shrapnel', W.shrapnelShards), fmt: int, headline: 'count', unit: 'SHARDS / BURST' },
  { id: 'shrapnelChance', label: 'Burst chance / kill', get: (p) => owned(p, 'shrapnel', W.shrapnelChance), fmt: pct },
  { id: 'shrapnelDamage', label: 'Shard damage', get: (p) => owned(p, 'shrapnel', () => weaponDamage(p, 'shrapnel')), fmt: dec1 },

  // Deployables: Proximity Mines, Sentry Turret (+ Siege Battery), Escort Drones
  { id: 'mineMaxActive', label: 'Max active mines', get: (p) => wb(p, 'mines', W.mineMaxActive), fmt: int, headline: 'count', unit: 'MAX ACTIVE MINES', newText: (a) => `PROXIMITY MINES // ${a} ACTIVE` },
  { id: 'mineDamage', label: 'Mine blast damage', get: (p) => wb(p, 'mines', (b) => weaponDamage(p, 'mine', b)), fmt: dec1, headline: 'pct', unit: 'MINE DAMAGE' },
  { id: 'mineCooldown', label: 'Mine drop interval', get: (p) => wb(p, 'mines', W.mineCooldown), fmt: secs, headline: 'pct', unit: 'MINE DROP INTERVAL' },
  { id: 'mineBlastRadius', label: 'Mine blast radius', get: (p) => wb(p, 'mines', (b) => mineBlastRadius(p, b)), fmt: int, headline: 'count', unit: 'MINE BLAST RADIUS' },
  { id: 'mineTrigger', label: 'Mine trigger radius', get: (p) => wb(p, 'mines', W.mineTriggerRadius), fmt: int },
  { id: 'mineLifetime', label: 'Mine fuse', get: (p) => wb(p, 'mines', W.mineLifetime), fmt: sec1, headline: (b, a) => `+${(a - b).toFixed(1)}s MINE FUSE` },
  { id: 'turretMaxActive', label: 'Max active turrets', get: (p) => wb(p, 'turret', W.turretMaxActive), fmt: int, headline: (b, a) => `+${a - b} SENTRY TURRET${a - b > 1 ? 'S' : ''}`, newText: (a) => `SENTRY TURRET // ${a} ACTIVE` },
  { id: 'turretFireRate', label: 'Turret fire rate', get: (p) => wb(p, 'turret', W.turretFireRate), fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'TURRET FIRE RATE' },
  { id: 'turretDuration', label: 'Turret lifetime', get: (p) => wb(p, 'turret', W.turretDuration), fmt: sec1, headline: (b, a) => `+${(a - b).toFixed(1)}s TURRET LIFETIME` },
  { id: 'turretCooldown', label: 'Turret deploy cooldown', get: (p) => wb(p, 'turret', W.turretCooldown), fmt: secs, headline: 'pct', unit: 'TURRET REDEPLOY TIME' },
  { id: 'turretRange', label: 'Turret range', get: (p) => wb(p, 'turret', W.turretRange), fmt: int },
  { id: 'turretDamage', label: 'Turret bolt damage', get: (p) => wb(p, 'turret', (b) => weaponDamage(p, 'turret', b)), fmt: dec1, headline: 'pct', unit: 'TURRET DAMAGE' },
  { id: 'siegeShell', label: 'Turret shell burst', get: (p) => (p.weapons.siegeBattery && ownsWeapon(p, 'turret') ? weaponDamage(p, 'siege') : null), fmt: dec1, newText: (a, row) => `TURRET SHELLS BURST // ${row.fmt(a)} DMG` },
  { id: 'droneCount', label: 'Escort drones', get: (p) => wb(p, 'drones', W.droneCount), fmt: int, headline: (b, a) => `+${a - b} ESCORT DRONE${a - b > 1 ? 'S' : ''}`, newText: (a) => `+${a} ESCORT DRONE${a > 1 ? 'S' : ''}` },
  { id: 'droneFireRate', label: 'Drone fire rate (each)', get: (p) => wb(p, 'drones', W.droneFireRate), fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'DRONE FIRE RATE' },
  { id: 'droneRange', label: 'Drone range', get: (p) => wb(p, 'drones', W.droneRange), fmt: int, headline: 'count', unit: 'DRONE RANGE' },
  { id: 'droneDamage', label: 'Drone bolt damage', get: (p) => wb(p, 'drones', (b) => weaponDamage(p, 'drone', b)), fmt: dec1, headline: 'pct', unit: 'DRONE DAMAGE' },

  // Plasma Grenades (+ EMP Grenades)
  { id: 'grenadeCount', label: 'Grenades / throw', get: (p) => wb(p, 'grenades', W.grenadeCount), fmt: int, headline: 'count', unit: 'GRENADES / THROW', newText: (a) => `PLASMA GRENADES // ${a} / THROW` },
  { id: 'grenadeDamage', label: 'Grenade blast damage', get: (p) => wb(p, 'grenades', (b) => weaponDamage(p, 'grenade', b)), fmt: dec1, headline: 'pct', unit: 'GRENADE DAMAGE' },
  { id: 'grenadeCooldown', label: 'Throw interval', get: (p) => wb(p, 'grenades', W.grenadeCooldown), fmt: secs, headline: 'pct', unit: 'GRENADE THROW INTERVAL' },
  { id: 'grenadeBlast', label: 'Grenade blast radius', get: (p) => wb(p, 'grenades', (b) => grenadeBlastRadius(p, b)), fmt: int, headline: 'count', unit: 'GRENADE BLAST RADIUS' },
  { id: 'grenadeRange', label: 'Throw range', get: (p) => wb(p, 'grenades', W.grenadeRange), fmt: int, headline: 'count', unit: 'GRENADE THROW RANGE' },
  { id: 'grenadeElement', label: 'Grenade element', get: (p) => wb(p, 'grenades', () => grenadeElement(p).label), fmt: (v) => v },
  { id: 'empArcs', label: 'EMP arcs / grenade blast', get: (p) => (p.weapons.empGrenades && ownsWeapon(p, 'grenades') ? W.empArcs : null), fmt: int, newText: (a) => `GRENADE BLASTS ARC // ${a} ZAPS` },

  // Drill-claws + Tectonic Claw Bore
  { id: 'miningSpeed', label: 'Mining speed', get: (p) => p.stats.miningSpeed, fmt: int, headline: 'pct', unit: 'MINING SPEED' },
  { id: 'miningRange', label: 'Claw reach', get: (p) => p.stats.miningRange, fmt: int },
  { id: 'drillScale', label: 'Claw size', get: (p) => p.stats.drillScale, fmt: mult },
  { id: 'tectonicBlast', label: 'Drill blast damage', get: (p) => (p.weapons.tectonicBore ? weaponDamage(p, 'tectonic') : null), fmt: dec1, newText: (a, row) => `ASTEROIDS DETONATE // ${row.fmt(a)} DMG` },
  { id: 'tectonicRadius', label: 'Drill blast radius', get: (p) => (p.weapons.tectonicBore ? tectonicBlastRadius(p) : null), fmt: int },

  // Luck
  { id: 'luck', label: 'Luck', get: (p) => p.stats.luck, fmt: pct, headline: 'points', unit: 'LUCK' },
  { id: 'doubleRoll', label: '+2 level (uncommon) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.doubleChance - c.tripleChance; }, fmt: pct1 },
  { id: 'tripleRoll', label: '+3 level (rare) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.tripleChance - c.quadChance; }, fmt: pct1 },
  { id: 'quadRoll', label: '+4 level (epic) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.quadChance - c.pentaChance; }, fmt: pct2 },
  { id: 'pentaRoll', label: '+5 level (legendary) chance', get: (p) => levelJumpChances(p.stats.luck || 1).pentaChance, fmt: pct2 },

  // Geom Attractor Field
  { id: 'magnetRadius', label: 'Pickup radius', get: (p) => p.stats.magnetRadius, fmt: int, headline: 'pct', unit: 'PICKUP RADIUS' },
  { id: 'xpMultiplier', label: 'XP gain', get: (p) => p.stats.xpMultiplier, fmt: mult, headline: 'pct', unit: 'XP GAIN' },
  { id: 'bombs', label: 'Supernova bombs', get: (p) => p.bombs, fmt: int, headline: 'count', unit: 'BOMBS' },

  // Phase Nova Thrusters
  { id: 'moveSpeed', label: 'Move speed', get: (p) => p.stats.moveSpeed, fmt: (v) => v.toFixed(2), headline: 'pct', unit: 'MOVE SPEED' },
  { id: 'maxHp', label: 'Max shield', get: (p) => p.maxHp, fmt: int, headline: 'count', unit: 'MAX SHIELD' },
  { id: 'hp', label: 'Shield now', get: (p) => p.hp, fmt: int },
  { id: 'dashCooldown', label: 'Dash cooldown', get: (p) => W.dashCooldown(lv(p, 'dashNova'), TUNING.dashCooldownBase ?? 1.5), fmt: secs },
  { id: 'novaRadius', label: 'Dash nova radius', get: (p) => owned(p, 'dashNova', (l) => novaRadius(p, l)), fmt: int },
  { id: 'novaDamage', label: 'Dash nova damage', get: (p) => owned(p, 'dashNova', (l) => weaponDamage(p, 'nova', l)), fmt: int },

  // Damage types (status effects, see status-effects.js)
  { id: 'burnMax', label: 'Max burn DPS / target', get: (p) => owned(p, 'thermite', (l) => burnStackDps(p, l) * W.burnMaxStacks(l)), fmt: dec1, headline: 'pct', unit: 'MAX BURN DPS', newText: (a, row) => `HITS IGNITE // ${row.fmt(a)} BURN DPS` },
  { id: 'burnStack', label: 'Burn DPS / stack', get: (p) => owned(p, 'thermite', (l) => burnStackDps(p, l)), fmt: dec1 },
  { id: 'burnStacks', label: 'Burn max stacks', get: (p) => owned(p, 'thermite', W.burnMaxStacks), fmt: int },
  { id: 'burnDuration', label: 'Burn duration', get: (p) => owned(p, 'thermite', () => W.burnDuration), fmt: secs },
  { id: 'chillSlow', label: 'Chill slow', get: (p) => owned(p, 'cryo', (l) => chillSlow(l)), fmt: pct, headline: 'points', unit: 'CHILL SLOW', newText: (a, row) => `BLASTS CHILL // -${row.fmt(a)} SPEED` },
  { id: 'chillBoss', label: 'Chill slow on bosses', get: (p) => owned(p, 'cryo', (l) => chillSlow(l, true)), fmt: pct },
  { id: 'chillDuration', label: 'Chill duration', get: (p) => owned(p, 'cryo', W.chillDuration), fmt: secs },
  { id: 'corrodeMax', label: 'Max damage taken', get: (p) => owned(p, 'nanite', (l) => corrodePerStack() * W.corrodeMaxStacks(l)), fmt: bonus, headline: (b, a) => `+${Math.round((a - b) * 100)}% MAX CORRODE`, newText: (a, row) => `HITS CORRODE // ${row.fmt(a)} DMG TAKEN` },
  { id: 'corrodeStack', label: 'Damage taken / stack', get: (p) => owned(p, 'nanite', () => corrodePerStack()), fmt: bonus },
  { id: 'corrodeStacks', label: 'Corrode max stacks', get: (p) => owned(p, 'nanite', W.corrodeMaxStacks), fmt: int },
  { id: 'corrodeDuration', label: 'Corrode duration', get: (p) => owned(p, 'nanite', () => W.corrodeDuration), fmt: secs }
];

const ROW_BY_ID = Object.fromEntries(STAT_ROWS.map((row) => [row.id, row]));

// Plain-data deep copy (the player holds only numbers, flags and nested plain objects).
function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key in value) out[key] = deepCopy(value[key]);
    return out;
  }
  return value;
}

function readRows(player) {
  return STAT_ROWS.map((row) => {
    const v = row.get(player);
    return v === null || v === undefined || Number.isNaN(v) ? null : v;
  });
}

function headlineText(row, before, after) {
  if (before === null) {
    if (row.newText) return row.newText(after, row);
    if (row.headline === 'count') return `+${row.fmt(after)} ${row.unit}`;
    return `NEW // ${row.fmt(after)} ${row.unit || row.label.toUpperCase()}`;
  }
  if (typeof row.headline === 'function') return row.headline(before, after);
  const sign = after >= before ? '+' : '';
  if (row.headline === 'pct') return `${sign}${Math.round((after / before - 1) * 100)}% ${row.unit}`;
  if (row.headline === 'points') return `${sign}${Math.round((after - before) * 100)}% ${row.unit}`;
  if (row.headline === 'count') return `${sign}${Math.round(after - before)} ${row.unit}`;
  return `${row.label.toUpperCase()} ${row.fmt(before)} → ${row.fmt(after)}`;
}

// Everything a card shows, computed by installing `upg` on a copy of `player`.
// Rows list only stats whose displayed value changes; `hiddenRows` counts any beyond maxRows.
// Rows whose displayed value differs between two readRows() snapshots.
function diffRows(before, after) {
  const changed = [];
  STAT_ROWS.forEach((row, i) => {
    const b = before[i];
    const a = after[i];
    if (a === null && b === null) return;
    const bText = b === null ? '—' : row.fmt(b);
    const aText = a === null ? '—' : row.fmt(a);
    if (bText !== aText) changed.push({ id: row.id, label: row.label, before: bText, after: aText, b, a });
  });
  return changed;
}

// A stat card's level line is its weapon's level (LV 3 -> LV 4 / 18), not the card's own rank.
export function describeUpgrade(player, upg, maxRows = MAX_ROWS) {
  const sc = STAT_CARD_BY_ID[upg.id];
  const fromLevel = sc ? weaponLevel(player, sc.weapon) : (player.upgradeLevels[upg.id] || 0);
  const before = readRows(player);
  const copy = deepCopy(player);
  const jump = applyUpgradeLevels(copy, upg);
  const after = readRows(copy);
  const changed = diffRows(before, after);

  const lead = changed.find((r) => r.id === upg.headline) || changed[0];
  const headline = lead ? headlineText(ROW_BY_ID[lead.id], lead.b, lead.a) : upg.name.toUpperCase();
  const rarity = rarityFor(upg, jump);

  return {
    id: upg.id,
    name: upg.name,
    category: upg.category,
    tags: (upg.tags || []).filter((t) => TAG_INFO[t]),
    summary: upg.summary || '',
    isSynergy: !!upg.isSynergy,
    rarity,
    rarityLabel: RARITY[rarity].label,
    color: RARITY[rarity].color,
    jump,
    fromLevel,
    toLevel: sc ? weaponLevel(copy, sc.weapon) : fromLevel + jump,
    maxLevel: sc ? WEAPON_MAX_LEVEL : upg.maxLevel,
    weapon: sc ? sc.weapon : null,
    bonus: bonusLevels(copy, sc ? sc.weapon : upg.id),
    headline,
    rows: changed.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, changed.length - maxRows)
  };
}

// The NEW WEAPON card: opens a pick of 1 of 3 unequipped weapons for a free slot.
export function describeNewWeapon(player) {
  const used = ownedWeapons(player).length;
  const slots = weaponSlots();
  return {
    id: 'new_weapon',
    name: 'NEW WEAPON',
    category: 'LOADOUT',
    tags: [],
    summary: 'Choose 1 of 3 weapons for a free slot. Its level-ups and upgrades join your hands from then on.',
    isSynergy: false,
    isNewWeapon: true,
    rarity: 'weapon',
    rarityLabel: 'LOADOUT',
    color: RARITY.weapon.color,
    jump: 1,
    headline: 'CHOOSE 1 OF 3 WEAPONS',
    rows: [{ id: 'slots', label: 'Weapon slots used', before: `${used} / ${slots}`, after: `${used + 1} / ${slots}` }],
    hiddenRows: 0,
    levelHtml: `SLOT ${used + 1} OF ${slots}`
  };
}

// A weapon offered after NEW WEAPON: its summary, tags and exact LV 1 stats (installed on a copy).
export function describeWeaponPick(player, weaponId, maxRows = MAX_ROWS) {
  const weapon = WEAPON_BY_ID[weaponId];
  const before = readRows(player);
  const copy = deepCopy(player);
  acquireWeapon(copy, weaponId);
  const changed = diffRows(before, readRows(copy));
  const levelUpg = UPGRADE_BY_ID[weapon.levelId];
  const lead = changed.find((r) => r.id === levelUpg?.headline) || changed[0];
  const maxLevel = WEAPON_MAX_LEVEL;
  return {
    id: `weapon:${weaponId}`,
    weaponId,
    name: weapon.name,
    category: weapon.category,
    tags: weaponTags(weaponId).filter((t) => TAG_INFO[t]),
    summary: weapon.summary,
    isSynergy: false,
    isWeaponPick: true,
    rarity: 'weapon',
    rarityLabel: RARITY.weapon.label,
    color: RARITY.weapon.color,
    jump: 1,
    headline: lead ? headlineText(ROW_BY_ID[lead.id], lead.b, lead.a) : weapon.name.toUpperCase(),
    rows: changed.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, changed.length - maxRows),
    levelHtml: `EQUIP // LV 1<span class="upg-max"> / ${maxLevel}</span>`
  };
}

// Potential DPS of a weapon for this player (base damage x the weapon's potential, tag bonuses
// included). Autocannon counts its real LV 1 output (streams x fire rate) as its starting point.
export function weaponPotentialDps(p, id, b = weaponBuild(p, id)) {
  if (!ownsWeapon(p, id) || !POTENTIAL_DPS[id]) return null;
  const SRC = { blaster: 'blaster', rockets: 'rocket', missiles: 'missile', lightning: 'lightning', singularity: 'singularity', orbitals: 'orbital', mines: 'mine', turret: 'turret', drones: 'drone', grenades: 'grenade' };
  let v = POTENTIAL_DPS[id](b) * p.stats.damage * tagDamageMult(p, SRC[id]);
  if (id === 'blaster') v *= (p.stats.bulletCount * p.stats.fireRate) / DPS_TARGET(1);
  if (['mines', 'turret', 'drones'].includes(id)) v *= TUNING.deployableDamageMult ?? 1;
  return v;
}

// One of the two Breakthrough choices at a weapon milestone: kind 'transform' (TRANSFORMS[id][level])
// or 'boost' (ACROSS THE BOARD). Rows are the exact before -> after stats with the choice installed on
// a copy of the player, led by the weapon's potential DPS.
export function describeBreakthrough(player, weaponId, level, kind, maxRows = MAX_ROWS) {
  const weapon = WEAPON_BY_ID[weaponId];
  const before = readRows(player);
  const copy = deepCopy(player);
  applyBreakthrough(copy, weaponId, level, kind);
  const changed = diffRows(before, readRows(copy));
  const dpsBefore = weaponPotentialDps(player, weaponId);
  const dpsAfter = weaponPotentialDps(copy, weaponId);
  const gain = dpsBefore ? dpsAfter / dpsBefore - 1 : 0;
  const rows = [{ id: 'potentialDps', label: `${weapon.hudName} potential DPS`, before: dec1(dpsBefore || 0), after: dec1(dpsAfter || 0) }, ...changed];
  const transform = kind === 'transform' ? TRANSFORMS[weaponId][level] : null;
  const rarity = kind === 'transform' ? 'transform' : 'boost';
  return {
    id: `bt:${weaponId}:${level}:${kind}`,
    weaponId,
    level,
    kind,
    name: transform ? transform.name : BOOST_NAME,
    category: WEAPON_BADGE[weaponId],
    tags: weaponTags(weaponId).filter((t) => TAG_INFO[t]),
    summary: transform ? transform.summary : boostSummary(weapon.name),
    isSynergy: false,
    isBreakthrough: true,
    rarity,
    rarityLabel: RARITY[rarity].label,
    color: RARITY[rarity].color,
    jump: 1,
    headline: transform
      ? `⚛ ${transform.name.toUpperCase()} // +${Math.round(gain * 100)}% DPS`
      : `+${Math.round((BT_BOOST_DPS - 1) * 100)}% DAMAGE + UTILITY // +${Math.round(gain * 100)}% DPS`,
    rows: rows.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, rows.length - maxRows),
    levelHtml: `⚛ BREAKTHROUGH // ${weapon.name.toUpperCase()} LV ${level}`,
    dpsGain: gain
  };
}

// Levels an evolution adds on top of a weapon's own level (Storm Protocol adds a missile launcher).
export function bonusLevels(player, id) {
  if (id === 'missiles' && player.weapons?.stormProtocol) return { amount: 1, label: 'STORM' };
  return null;
}

export function bonusText(bonus) {
  return bonus ? ` <span class="lv-bonus">+${bonus.amount} ${bonus.label}</span>` : '';
}

// Same wording everywhere: level cards "LV 2 → LV 3", caches "INSTALLED // LV 2 → LV 3", HUD "LV 3".
export function levelText(d, installed = false) {
  if (d.levelHtml) return d.levelHtml;
  if (d.isSynergy) return installed ? '★ EVOLUTION INSTALLED ★' : '★ EVOLUTION // UNLOCK ★';
  const from = d.fromLevel === 0 ? 'NEW' : `LV ${d.fromLevel}`;
  return `${installed ? 'INSTALLED // ' : ''}${from} → LV ${d.toLevel}${bonusText(d.bonus)}<span class="upg-max"> / ${d.maxLevel}</span>`;
}

// Returns { className, html } for an .upgrade-option card (level-up choice or cache reward).
export function renderUpgradeCard(d, keyLabel, installed = false) {
  const ribbon = d.jump > 1
    ? `<div class="upg-jump-ribbon">${'★'.repeat(d.jump - 1)} +${d.jump} LEVELS</div>`
    : '';
  const rows = d.rows.map((r) => `
          <div class="upg-stat"><span class="upg-stat-label">${r.label}</span><span class="upg-stat-val"><span class="upg-before">${r.before}</span> → <b>${r.after}</b></span></div>`).join('');
  const tags = d.tags && d.tags.length
    ? `<div class="upg-tags">${d.tags.map((t) => `<span class="upg-tag" style="--tag:${TAG_INFO[t].color}">${TAG_INFO[t].label}</span>`).join('')}</div>`
    : '';
  const more = d.hiddenRows ? `<div class="upg-stat upg-stat-more">+${d.hiddenRows} more stat${d.hiddenRows > 1 ? 's' : ''} improved</div>` : '';
  return {
    className: `upgrade-option rarity-${d.rarity}${d.jump > 1 ? ` jump-${d.jump}` : ''}${d.isNewWeapon ? ' new-weapon-card' : ''}${d.isWeaponPick ? ' weapon-pick-card' : ''}${d.isBreakthrough ? ' breakthrough-card' : ''}`,
    html: `
      ${ribbon}
      <div>
        <div class="upg-top">
          <span class="upg-key">${keyLabel}</span>
          <span class="upg-badge">${d.rarityLabel === d.category ? d.category : `${d.rarityLabel} · ${d.category}`}</span>
        </div>
        <div class="upg-name">${d.name}</div>${tags}
        <div class="upg-headline">${d.headline}</div>
        <div class="upg-summary">${d.summary}</div>
        <div class="upg-stats">${rows}${more}
        </div>
      </div>
      <div class="upg-level">${levelText(d, installed)}</div>
    `
  };
}
