// Upgrade card previews: headline benefit + exact BEFORE -> AFTER stats.
// Numbers are never hand-written: describeUpgrade() installs the upgrade (with its rolled level jump)
// on a deep copy of the player and diffs STAT_ROWS, which read the same values and WEAPON_SCALING
// formulas the game simulates with.
import { TUNING } from './config.js';
import { RARITY, rarityFor, applyUpgradeLevels, applyBreakthrough, levelJumpChances, acquireWeapon, UPGRADE_BY_ID } from './upgrades.js';
import {
  WEAPON_SCALING as W, TAG_INFO, prismNewestGroup, weaponDamage, areaMult, missileBlastRadius, singularityPullRadius, novaRadius,
  tectonicBlastRadius, mineBlastRadius, wingRocketBlastRadius, critChance, critDamage, critMultiplier, chillSlow,
  blasterStreams, blasterFireRate, blasterPierce, POTENTIAL_DPS, DPS_TARGET, tagDamageMult, grenadeBlastRadius, gasCloudRadius, flameRange, fieldRadius,
  shockStun, shockLongStun, shockLongChance, statusPotency, statusDecay, statusDotShare, stacksPerBaseDamage, burnSpreadChance,
  freezeShare, freezeDuration, corrodeCap, shockConductShare, stunDurationMult, elementDamageMult, baseDamage
} from './weapon-scaling.js';
import { grenadeElement } from './grenades.js';
import { WEAPON_BY_ID, ownsWeapon, ownedWeapons, weaponSlots, weaponTags, weaponLevel } from './loadout.js';
import { slotReward } from './slot-rewards.js';
import { clipHTML, breakthroughClip } from './weapon-media.js';
import {
  WEAPON_MAX_LEVEL, WEAPON_BADGE, TRANSFORMS, BOOST_NAME, BT_BOOST_RANKS, BT_BOOST_DPS, boostSummary,
  weaponBuild, levelBuild, levelCardWeapon, weaponElement, ELEMENTS, ELEMENT_INFO, ELEMENT_WEAPONS, ELEMENT_WEAPON_LABEL
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
const rank = (p, key) => p.stats?.[key] || 0;
const lv = (p, key) => p.weapons[key] || 0;
const owned = (p, key, fn) => (lv(p, key) > 0 ? fn(lv(p, key)) : null);
const blinkRank = (p) => p.upgradeLevels?.blink_drive || 0;
const dashRank = (p) => Math.min(UPGRADE_BY_ID.dash_range.maxLevel, p.upgradeLevels?.dash_range || 0);
const sec1 = (v) => `${v.toFixed(1)}s`;
// A weapon's rows show only while it is equipped (any weapon, Autocannon included, can be discarded);
// `fn` gets the weapon's build (level, stat ranks, Breakthroughs).
const wb = (p, id, fn) => (ownsWeapon(p, id) ? fn(weaponBuild(p, id)) : null);
// Deployable hits scale with bolt damage and the tuner's deployable multiplier (same as deployables.js).

// Rows of one element-capable weapon: its element, then the numbers of the status it applies (null while
// the weapon is not equipped or carries another element, so a card only shows what it changes).
function elementRows(w) {
  const L = ELEMENT_WEAPON_LABEL[w];
  const at = (p, want, fn) => {
    if (!ownsWeapon(p, w)) return null;
    const e = weaponElement(p, w);
    return e && e.element === want ? fn(e.rank) : null;
  };
  const rows = [
    { id: `${w}:burn`, label: `${L} burn (of hit damage)`, get: (p) => at(p, 'fire', (lv) => statusDotShare(p, 'fire', lv)), fmt: bonus, headline: 'points', unit: 'BURN DAMAGE', newText: (a, row) => `HITS IGNITE // ${row.fmt(a)} AS BURN` },
    { id: `${w}:burnStacks`, label: `${L} burn stacks / base dmg`, get: (p) => at(p, 'fire', (lv) => stacksPerBaseDamage(p, lv)), fmt: dec1 },
    { id: `${w}:burnSpread`, label: `${L} fire spread / tick`, get: (p) => at(p, 'fire', () => burnSpreadChance(p)), fmt: pct },
    { id: `${w}:chill`, label: `${L} max chill slow`, get: (p) => at(p, 'frost', (lv) => chillSlow(lv, false, p)), fmt: pct, headline: 'points', unit: 'CHILL SLOW', newText: (a, row) => `HITS CHILL // -${row.fmt(a)} SPEED` },
    { id: `${w}:coldStacks`, label: `${L} cold stacks / base dmg`, get: (p) => at(p, 'frost', (lv) => stacksPerBaseDamage(p, lv)), fmt: dec1 },
    { id: `${w}:freeze`, label: `${L} freeze`, get: (p) => at(p, 'frost', (lv) => freezeDuration(p, lv)), fmt: secs },
    { id: `${w}:corrodeMax`, label: `${L} max damage taken`, get: (p) => at(p, 'corrode', (lv) => corrodeCap(p, lv)), fmt: bonus, headline: (b, a) => `+${Math.round((a - b) * 100)}% MAX CORRODE`, newText: (a, row) => `HITS CORRODE // ${row.fmt(a)} DMG TAKEN` },
    { id: `${w}:acid`, label: `${L} acid (of hit damage)`, get: (p) => at(p, 'corrode', (lv) => statusDotShare(p, 'corrode', lv)), fmt: bonus },
    { id: `${w}:stun`, label: `${L} zap stun`, get: (p) => at(p, 'shock', (lv) => shockStun(p, lv)), fmt: secs, headline: (b, a) => `+${(a - b).toFixed(2)}s STUN`, newText: (a, row) => `HITS ZAP // ${row.fmt(a)} STUN` },
    { id: `${w}:stunLong`, label: `${L} long-stun chance`, get: (p) => at(p, 'shock', (lv) => shockLongChance(p, lv)), fmt: pct },
    { id: `${w}:stunLongTime`, label: `${L} long stun`, get: (p) => at(p, 'shock', () => shockLongStun(p)), fmt: secs },
    { id: `${w}:shockArc`, label: `${L} shock arcs (of hit damage)`, get: (p) => at(p, 'shock', (lv) => statusDotShare(p, 'shock', lv)), fmt: bonus }
  ];
  // Plasma Grenades show their element on the 'grenadeElement' row.
  if (w !== 'grenades') {
    rows.unshift({ id: `${w}:element`, label: `${L} element`, get: (p) => {
      if (!ownsWeapon(p, w)) return null;
      const e = weaponElement(p, w);
      return e ? ELEMENT_INFO[e.element].label : null;
    }, fmt: (v) => v });
  }
  return rows;
}

// headline: 'count' (+N UNIT), 'pct' (+N% UNIT, or N.N× UNIT from triple up), 'points' (+N% UNIT for ratio stats like luck),
// or a function(before, after). newText: headline when the row comes online (before is null).
export const STAT_ROWS = [
  // Build-wide modifiers first, so crit, tag and Reactor Overdrive cards lead with their own row
  { id: 'allDamage', label: 'Base damage (all weapons)', get: (p) => baseDamage(p), fmt: dec1, headline: 'pct', unit: 'DAMAGE · ALL WEAPONS' },
  { id: 'critChance', label: 'Crit chance', get: (p) => critChance(p), fmt: pct, headline: 'points', unit: 'CRIT CHANCE' },
  { id: 'critDamage', label: 'Crit damage', get: (p) => critDamage(p), fmt: mult, headline: 'points', unit: 'CRIT DAMAGE' },
  { id: 'critAverage', label: 'Avg bonus from crits', get: (p) => critChance(p) * (critDamage(p) - 1), fmt: (v) => `+${(v * 100).toFixed(1)}%` },
  { id: 'critAfflicted', label: 'Crit vs afflicted', get: (p) => (p.weapons.supercritical ? critMultiplier(p, true) : null), fmt: mult, newText: (a, row) => `AFFLICTED CRITS // ${row.fmt(a)}` },
  { id: 'kineticDamage', label: 'KINETIC damage bonus', get: (p) => tagBoost(p, 'kinetic'), fmt: tagBonus, headline: 'points', unit: 'KINETIC DAMAGE' },
  { id: 'explosiveDamage', label: 'EXPLOSIVE damage bonus', get: (p) => tagBoost(p, 'explosive'), fmt: tagBonus, headline: 'points', unit: 'EXPLOSIVE DAMAGE' },
  { id: 'electricDamage', label: 'ELECTRIC damage bonus', get: (p) => tagBoost(p, 'electric'), fmt: tagBonus, headline: 'points', unit: 'ELECTRIC DAMAGE' },
  { id: 'areaSize', label: 'AREA size', get: (p) => areaMult(p), fmt: pct, headline: 'points', unit: 'AREA SIZE' },
  // Global STATUS cards (they lead with their own row; each infused weapon's rows below show the effect)
  { id: 'statusPotency', label: 'Status stacks per hit', get: (p) => statusPotency(p), fmt: tagBonus, headline: 'points', unit: 'STATUS STACKS' },
  { id: 'statusApplication', label: 'Fire spread chance / tick', get: (p) => burnSpreadChance(p), fmt: pct, headline: 'points', unit: 'FIRE SPREAD' },
  { id: 'statusFreeze', label: 'Freeze threshold (of max HP)', get: (p) => freezeShare(p), fmt: pct },
  { id: 'statusCorrodeCap', label: 'Corrode cap bonus', get: (p) => rank(p, 'statusApplication') * W.applicationCorrodeStep, fmt: bonus },
  { id: 'statusDuration', label: 'Stacks lost per tick', get: (p) => statusDecay(p), fmt: pct, headline: (b, a) => `${Math.round(b * 100)}% → ${Math.round(a * 100)}% STACK DECAY` },
  { id: 'stunLongChance', label: 'Long-stun chance bonus', get: (p) => shockLongChance(p, 1) - W.shockLongChance(1), fmt: bonus, headline: 'points', unit: 'LONG-STUN CHANCE' },
  { id: 'stunDuration', label: 'Stun duration', get: (p) => stunDurationMult(p), fmt: tagBonus, headline: 'points', unit: 'STUN DURATION' },
  { id: 'shockConduct', label: 'Shock conducted / tick', get: (p) => shockConductShare(p), fmt: pct },
  ...ELEMENTS.map((el) => ({ id: `${el}Damage`, label: `${ELEMENT_INFO[el].label} damage bonus`, get: (p) => elementDamageMult(p, el), fmt: tagBonus, headline: 'points', unit: `${ELEMENT_INFO[el].label} DAMAGE` })),

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
  // Flamethrower (FIRE is built in: its burn rows come from elementRows('flamethrower') below)
  { id: 'flameDamage', label: 'Flame damage / scorch', get: (p) => wb(p, 'flamethrower', (b) => weaponDamage(p, 'flame', b)), fmt: dec1, headline: 'pct', unit: 'FLAME DAMAGE' },
  { id: 'flameTickRate', label: 'Scorches / s', get: (p) => wb(p, 'flamethrower', W.flameTickRate), fmt: (v) => `${v.toFixed(1)}/s`, headline: 'pct', unit: 'FLAME SCORCH RATE' },
  { id: 'flameRange', label: 'Flame reach', get: (p) => wb(p, 'flamethrower', (b) => flameRange(p, b)), fmt: int, headline: 'count', unit: 'FLAME REACH', newText: (a) => `FLAMETHROWER // ${a} PX REACH` },
  { id: 'flameCone', label: 'Cone width', get: (p) => wb(p, 'flamethrower', (b) => (W.flameConeHalf(b) * 360) / Math.PI), fmt: (v) => `${Math.round(v)}°`, headline: (b, a) => `+${Math.round(a - b)}° CONE WIDTH` },
  { id: 'flameTurn', label: 'Spin speed', get: (p) => wb(p, 'flamethrower', (b) => (W.flameTurnRate(b) * 180) / Math.PI), fmt: (v) => `${Math.round(v)}°/s`, headline: (b, a) => `+${Math.round(a - b)}°/S SPIN SPEED` },
  { id: 'flameNozzles', label: 'Nozzles', get: (p) => wb(p, 'flamethrower', W.flameNozzles), fmt: int, headline: 'count', unit: 'NOZZLE' },
  { id: 'flameBurst', label: 'Fireball burst damage', get: (p) => wb(p, 'flamethrower', (b) => (b.t4 ? weaponDamage(p, 'flame', b) / W.flameDamageMult(b) * W.flameBurstDamageMult(b) : null)), fmt: dec1, newText: (a, row) => `FIREBALLS // ${row.fmt(a)} DMG` },
  { id: 'flamePuddle', label: 'Napalm puddle damage / tick', get: (p) => wb(p, 'flamethrower', (b) => (b.t8 ? weaponDamage(p, 'flame', b) / W.flameDamageMult(b) * W.flamePuddleDamageMult(b) : null)), fmt: dec1, newText: () => 'NAPALM PUDDLES' },
  { id: 'flameRing', label: 'Inferno Ring damage', get: (p) => wb(p, 'flamethrower', (b) => (b.t12 ? weaponDamage(p, 'flame', b) / W.flameDamageMult(b) * W.flameRingDamageMult(b) : null)), fmt: dec1, newText: () => `INFERNO RING EVERY ${W.flameRingEvery}s` },
  // Cryo Sprayer (FROST is built in: its status rows come from elementRows('cryospray') below; the Flamethrower's formulas)
  { id: 'cryoDamage', label: 'Spray damage / hit', get: (p) => wb(p, 'cryospray', (b) => weaponDamage(p, 'cryo', b)), fmt: dec1, headline: 'pct', unit: 'SPRAY DAMAGE' },
  { id: 'cryoTickRate', label: 'Spray hits / s', get: (p) => wb(p, 'cryospray', W.flameTickRate), fmt: (v) => `${v.toFixed(1)}/s`, headline: 'pct', unit: 'SPRAY RATE' },
  { id: 'cryoRange', label: 'Spray reach', get: (p) => wb(p, 'cryospray', (b) => flameRange(p, b)), fmt: int, headline: 'count', unit: 'SPRAY REACH', newText: (a) => `CRYO SPRAYER // ${a} PX REACH` },
  { id: 'cryoCone', label: 'Cone width', get: (p) => wb(p, 'cryospray', (b) => (W.flameConeHalf(b) * 360) / Math.PI), fmt: (v) => `${Math.round(v)}°`, headline: (b, a) => `+${Math.round(a - b)}° CONE WIDTH` },
  { id: 'cryoTurn', label: 'Spin speed', get: (p) => wb(p, 'cryospray', (b) => (W.flameTurnRate(b) * 180) / Math.PI), fmt: (v) => `${Math.round(v)}°/s`, headline: (b, a) => `+${Math.round(a - b)}°/S SPIN SPEED` },
  { id: 'cryoNozzles', label: 'Nozzles', get: (p) => wb(p, 'cryospray', W.flameNozzles), fmt: int, headline: 'count', unit: 'NOZZLE' },
  { id: 'cryoBurst', label: 'Shatter burst damage', get: (p) => wb(p, 'cryospray', (b) => (b.t4 ? weaponDamage(p, 'cryo', b) / W.flameDamageMult(b) * W.flameBurstDamageMult(b) : null)), fmt: dec1, newText: (a, row) => `SHATTER // ${row.fmt(a)} DMG` },
  { id: 'cryoPuddle', label: 'Frost slick damage / tick', get: (p) => wb(p, 'cryospray', (b) => (b.t8 ? weaponDamage(p, 'cryo', b) / W.flameDamageMult(b) * W.flamePuddleDamageMult(b) : null)), fmt: dec1, newText: () => 'FROST SLICK' },
  { id: 'cryoRing', label: 'Blizzard Ring damage', get: (p) => wb(p, 'cryospray', (b) => (b.t12 ? weaponDamage(p, 'cryo', b) / W.flameDamageMult(b) * W.flameRingDamageMult(b) : null)), fmt: dec1, newText: () => `BLIZZARD RING EVERY ${W.flameRingEvery}s` },
  // Acid Sprayer (CORROSIVE is built in: its status rows come from elementRows('acidspray') below; the Flamethrower's formulas)
  { id: 'acidDamage', label: 'Spray damage / hit', get: (p) => wb(p, 'acidspray', (b) => weaponDamage(p, 'acid', b)), fmt: dec1, headline: 'pct', unit: 'SPRAY DAMAGE' },
  { id: 'acidTickRate', label: 'Spray hits / s', get: (p) => wb(p, 'acidspray', W.flameTickRate), fmt: (v) => `${v.toFixed(1)}/s`, headline: 'pct', unit: 'SPRAY RATE' },
  { id: 'acidRange', label: 'Spray reach', get: (p) => wb(p, 'acidspray', (b) => flameRange(p, b)), fmt: int, headline: 'count', unit: 'SPRAY REACH', newText: (a) => `ACID SPRAYER // ${a} PX REACH` },
  { id: 'acidCone', label: 'Cone width', get: (p) => wb(p, 'acidspray', (b) => (W.flameConeHalf(b) * 360) / Math.PI), fmt: (v) => `${Math.round(v)}°`, headline: (b, a) => `+${Math.round(a - b)}° CONE WIDTH` },
  { id: 'acidTurn', label: 'Spin speed', get: (p) => wb(p, 'acidspray', (b) => (W.flameTurnRate(b) * 180) / Math.PI), fmt: (v) => `${Math.round(v)}°/s`, headline: (b, a) => `+${Math.round(a - b)}°/S SPIN SPEED` },
  { id: 'acidNozzles', label: 'Nozzles', get: (p) => wb(p, 'acidspray', W.flameNozzles), fmt: int, headline: 'count', unit: 'NOZZLE' },
  { id: 'acidBurst', label: 'Meltdown burst damage', get: (p) => wb(p, 'acidspray', (b) => (b.t4 ? weaponDamage(p, 'acid', b) / W.flameDamageMult(b) * W.flameBurstDamageMult(b) : null)), fmt: dec1, newText: (a, row) => `MELTDOWN // ${row.fmt(a)} DMG` },
  { id: 'acidPuddle', label: 'Acid pool damage / tick', get: (p) => wb(p, 'acidspray', (b) => (b.t8 ? weaponDamage(p, 'acid', b) / W.flameDamageMult(b) * W.flamePuddleDamageMult(b) : null)), fmt: dec1, newText: () => 'ACID POOL' },
  { id: 'acidRing', label: 'Caustic Ring damage', get: (p) => wb(p, 'acidspray', (b) => (b.t12 ? weaponDamage(p, 'acid', b) / W.flameDamageMult(b) * W.flameRingDamageMult(b) : null)), fmt: dec1, newText: () => `CAUSTIC RING EVERY ${W.flameRingEvery}s` },
  { id: 'empArcs', label: 'EMP arcs / grenade blast', get: (p) => (p.weapons.empGrenades && ownsWeapon(p, 'grenades') ? W.empArcs : null), fmt: int, newText: (a) => `GRENADE BLASTS ARC // ${a} ZAPS` },

  // Corrosive Gas Trail (always CORROSIVE: its corrode rank follows its level, weapon-levels.js fixedElementRank)
  { id: 'gasRadius', label: 'Gas cloud radius', get: (p) => wb(p, 'gas', (b) => gasCloudRadius(p, b)), fmt: int, headline: 'count', unit: 'GAS CLOUD RADIUS' },
  { id: 'gasDamage', label: 'Gas damage / tick', get: (p) => wb(p, 'gas', (b) => weaponDamage(p, 'gas', b)), fmt: dec1, headline: 'pct', unit: 'GAS DAMAGE' },
  { id: 'gasTickRate', label: 'Gas ticks / s', get: (p) => wb(p, 'gas', (b) => 1 / W.gasTick(b)), fmt: (v) => `${v.toFixed(1)}/s`, headline: 'pct', unit: 'GAS TICK RATE' },
  { id: 'gasLife', label: 'Cloud linger', get: (p) => wb(p, 'gas', W.gasLife), fmt: sec1, headline: (b, a) => `+${(a - b).toFixed(1)}s CLOUD LINGER` },
  { id: 'gasCorrode', label: 'Gas max damage taken', get: (p) => wb(p, 'gas', () => { const e = weaponElement(p, 'gas'); return e ? corrodeCap(p, e.rank) : null; }), fmt: bonus, headline: (b, a) => `+${Math.round((a - b) * 100)}% MAX CORRODE` },
  { id: 'gasAcid', label: 'Gas acid (of hit damage)', get: (p) => wb(p, 'gas', () => { const e = weaponElement(p, 'gas'); return e ? statusDotShare(p, 'corrode', e.rank) : null; }), fmt: bonus },
  { id: 'gasSeek', label: 'Clouds creep toward enemies', get: (p) => wb(p, 'gas', (b) => (b.t4 ? W.seekSpeed : null)), fmt: (v) => `${Math.round(v)} px/s`, newText: () => 'CLOUDS HUNT ENEMIES' },
  { id: 'gasPocket', label: 'Volatile pocket burst', get: (p) => wb(p, 'gas', (b) => (b.t8 ? weaponDamage(p, 'gas', b) * W.pocketShare * W.pocketEvery / W.gasTick(b) : null)), fmt: dec1, newText: (a, row) => `GAS POCKETS BURST // ${row.fmt(a)} DMG` },
  { id: 'gasShroud', label: 'Toxic shroud radius', get: (p) => wb(p, 'gas', (b) => (b.t12 ? gasCloudRadius(p, b) * W.shroudRadiusMult : null)), fmt: int, newText: (a) => `TOXIC SHROUD // ${a} RADIUS` },
  // Electric Shield Field (fixed SHOCK element: its stun rows read the field's own rank)
  { id: 'fieldRadius', label: 'Field radius', get: (p) => wb(p, 'shockfield', (b) => fieldRadius(p, b)), fmt: int, headline: 'count', unit: 'FIELD RADIUS', newText: (a) => `SHOCK FIELD // ${a} RADIUS` },
  { id: 'fieldDamage', label: 'Discharge damage', get: (p) => wb(p, 'shockfield', (b) => weaponDamage(p, 'shockfield', b)), fmt: dec1, headline: 'pct', unit: 'DISCHARGE DAMAGE' },
  { id: 'fieldCooldown', label: 'Field recharge', get: (p) => wb(p, 'shockfield', W.fieldCooldown), fmt: secs, headline: 'pct', unit: 'FIELD RECHARGE' },
  { id: 'fieldStun', label: 'Field stun', get: (p) => wb(p, 'shockfield', (b) => shockStun(p, W.fieldStunRank(b))), fmt: secs, headline: (b, a) => `+${(a - b).toFixed(2)}s STUN` },
  { id: 'fieldStunLong', label: 'Field long-stun chance', get: (p) => wb(p, 'shockfield', (b) => shockLongChance(p, W.fieldStunRank(b))), fmt: pct },
  { id: 'fieldLash', label: 'Arc Lash arcs / discharge', get: (p) => wb(p, 'shockfield', (b) => (b.t4 ? W.lashArcs : null)), fmt: int, newText: (a) => `DISCHARGES LASH // ${a} ARCS` },
  { id: 'fieldDashRefund', label: 'Dash recharge / discharge', get: (p) => wb(p, 'shockfield', (b) => (b.t8 ? W.dashRefund : null)), fmt: secs, newText: (a, row) => `DISCHARGES REPULSE // -${row.fmt(a)} DASH` },
  { id: 'fieldClap', label: 'Thunderclap radius', get: (p) => wb(p, 'shockfield', (b) => (b.t12 ? fieldRadius(p, b) * W.overchargeRadiusMult : null)), fmt: int, newText: (a, row) => `THUNDERCLAP // ${row.fmt(a)} RADIUS` },

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

  // Phase Nova Thrusters (move speed, dash) and Shield Capacitor (shield)
  { id: 'moveSpeed', label: 'Move speed', get: (p) => p.stats.moveSpeed, fmt: (v) => v.toFixed(2), headline: 'pct', unit: 'MOVE SPEED' },
  { id: 'maxHp', label: 'Max shield', get: (p) => p.maxHp, fmt: int, headline: 'count', unit: 'MAX SHIELD' },
  { id: 'hp', label: 'Shield now', get: (p) => p.hp, fmt: int },
  { id: 'dashCooldown', label: 'Dash cooldown', get: (p) => W.dashCooldown(lv(p, 'dashNova'), TUNING.dashCooldownBase ?? 1.5), fmt: secs },
  { id: 'dashDistance', label: 'Dash distance', get: (p) => (blinkRank(p) > 0 ? null : W.dashDistance(p.stats.moveSpeed, dashRank(p)) * (p.dashDistanceMult ?? 1)), fmt: int, headline: 'count', unit: 'PX DASH' },
  { id: 'blinkDistance', label: 'Blink distance', get: (p) => (blinkRank(p) > 0 ? W.blinkDistance(blinkRank(p)) * W.dashDistanceMult(dashRank(p)) * (p.dashDistanceMult ?? 1) : null), fmt: int, headline: 'count', unit: 'PX BLINK', newText: (a) => `DASH BLINKS // ${a} PX` },
  { id: 'novaRadius', label: 'Dash nova radius', get: (p) => owned(p, 'dashNova', (l) => novaRadius(p, l)), fmt: int },
  { id: 'novaDamage', label: 'Dash nova damage', get: (p) => owned(p, 'dashNova', (l) => weaponDamage(p, 'nova', l)), fmt: int },

  // Elements (status-effects.js): each infused weapon's status at its element rank
  ...ELEMENT_WEAPONS.flatMap(elementRows),
  ...elementRows('flamethrower'),
  ...elementRows('cryospray'),
  ...elementRows('acidspray')
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

const trimDec = (v) => v.toFixed(1).replace(/\.0$/, '');

function headlineText(row, before, after) {
  if (before === null) {
    if (row.newText) return row.newText(after, row);
    if (row.headline === 'count') return `+${row.fmt(after)} ${row.unit}`;
    return `NEW // ${row.fmt(after)} ${row.unit || row.label.toUpperCase()}`;
  }
  if (typeof row.headline === 'function') return row.headline(before, after);
  const sign = after >= before ? '+' : '';
  // Compounding ranks (a +4 damage card is 1.5^4 = 5.06x) read as a multiplier once they triple the stat.
  if (row.headline === 'pct') return after / before >= 3 ? `${trimDec(after / before)}× ${row.unit}` : `${sign}${Math.round((after / before - 1) * 100)}% ${row.unit}`;
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

// A level card's (stat or element card) level line is its weapon's level (LV 3 -> LV 4 / 18), not the
// card's own rank.
export function describeUpgrade(player, upg, maxRows = MAX_ROWS) {
  const weapon = levelCardWeapon(upg.id);
  const sc = weapon ? { weapon } : null;
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
  const reward = used + 1 <= slots ? slotReward(used + 1) : null;
  return {
    id: 'new_weapon',
    name: 'NEW WEAPON',
    category: 'LOADOUT',
    tags: [],
    // The slot's bonus is the whole message: no headline, summary or stat rows next to it.
    summary: reward ? '' : 'Choose 1 of 3 weapons for a free slot.',
    isSynergy: false,
    isNewWeapon: true,
    rarity: 'weapon',
    rarityLabel: 'LOADOUT',
    color: RARITY.weapon.color,
    jump: 1,
    headline: reward ? '' : 'CHOOSE 1 OF 3 WEAPONS',
    rows: [],
    hiddenRows: 0,
    levelHtml: `SLOT ${used + 1} OF ${slots}`,
    // What filling this slot unlocks (slot-rewards.js), shown big on the card.
    reward: reward && { ...reward, slot: used + 1 }
  };
}

// Banner for a slot reward ({ slot, short, text, kind }): the NEW WEAPON card and the weapon pick header.
export const slotRewardHtml = (r) => (r
  ? `<div class="upg-slot-reward reward-${r.kind}"><span class="upg-slot-reward-label">SLOT ${r.slot} BONUS</span><b>${r.short}</b><span class="upg-slot-reward-text">${r.text}</span></div>`
  : '');

// The one-time slot rewards tip (slot-rewards.js slotTip): title, one line, a chip per slot bonus, GOT IT.
export const slotTipHtml = (tip) => `<div class="slot-tip-card" role="dialog" aria-labelledby="slot-tip-title">
    <div class="slot-tip-kicker">⬡ NEW: SLOT BONUSES</div>
    <h3 id="slot-tip-title" class="slot-tip-title">${tip.title}</h3>
    <p class="slot-tip-line">${tip.line}</p>
    <div class="slot-tip-rewards">${tip.rewards.map((r) => `<div class="slot-tip-reward reward-${r.kind}"><span>WEAPON ${r.slot}</span><b>${r.short}</b></div>`).join('')}</div>
    <button type="button" class="neon-btn primary-btn slot-tip-ok" data-slot-tip-ok>GOT IT</button>
  </div>`;

// A weapon offered after NEW WEAPON: its summary, tags and exact LV 1 stats (installed on a copy).
export function describeWeaponPick(player, weaponId, maxRows = MAX_ROWS) {
  const weapon = WEAPON_BY_ID[weaponId];
  const before = readRows(player);
  const copy = deepCopy(player);
  acquireWeapon(copy, weaponId);
  const changed = diffRows(before, readRows(copy));
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
    // The weapon itself is the headline (its LV 1 numbers are in the rows), so the pick doesn't read
    // like a "+1 / +5" stat upgrade.
    headline: weapon.name.toUpperCase(),
    rows: changed.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, changed.length - maxRows),
    levelHtml: `EQUIP // LV 1<span class="upg-max"> / ${maxLevel}</span>`
  };
}

// Potential DPS of a weapon for this player (base damage x the weapon's potential, tag bonuses
// included). Autocannon counts its real LV 1 output (streams x fire rate) as its starting point.
export function weaponPotentialDps(p, id, b = weaponBuild(p, id)) {
  if (!ownsWeapon(p, id) || !POTENTIAL_DPS[id]) return null;
  const SRC = { blaster: 'blaster', rockets: 'rocket', missiles: 'missile', lightning: 'lightning', singularity: 'singularity', orbitals: 'orbital', mines: 'mine', turret: 'turret', drones: 'drone', grenades: 'grenade', gas: 'gas', flamethrower: 'flame', cryospray: 'cryo', acidspray: 'acid', shockfield: 'shockfield' };
  let v = POTENTIAL_DPS[id](b) * baseDamage(p) * tagDamageMult(p, SRC[id]) * elementDamageMult(p, weaponElement(p, id)?.element);
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
// " / 5", or " / 5 · ⚡ OVERCHARGE" for a card stacked past its max (upgrades.js overchargeReady).
export const maxText = (level, maxLevel) => `<span class="upg-max"> / ${maxLevel}${level > maxLevel ? ' · <span class="upg-overcharge">⚡ OVERCHARGE</span>' : ''}</span>`;

export function levelText(d, installed = false) {
  if (d.levelHtml) return d.levelHtml;
  if (d.isSynergy) return installed ? '★ EVOLUTION INSTALLED ★' : '★ EVOLUTION // UNLOCK ★';
  const from = d.fromLevel === 0 ? 'NEW' : `LV ${d.fromLevel}`;
  return `${installed ? 'INSTALLED // ' : ''}${from} → LV ${d.toLevel}${bonusText(d.bonus)}${maxText(d.toLevel, d.maxLevel)}`;
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
  // A Breakthrough's TRANSFORM card shows it in action (the generic boost has nothing new to show).
  const clip = d.isBreakthrough && d.kind === 'transform' ? clipHTML(breakthroughClip(d.weaponId, d.level), `${d.name} in action`) : '';
  return {
    className: `upgrade-option rarity-${d.rarity}${d.jump > 1 ? ` jump-${d.jump}` : ''}${d.isNewWeapon ? ' new-weapon-card' : ''}${d.isWeaponPick ? ' weapon-pick-card' : ''}${d.isBreakthrough ? ' breakthrough-card' : ''}`,
    html: `
      ${ribbon}
      <div>
        <div class="upg-top">
          <span class="upg-key">${keyLabel}</span>
          <span class="upg-badge">${d.rarityLabel === d.category ? d.category : `${d.rarityLabel} · ${d.category}`}</span>
        </div>
        <div class="upg-name">${d.name}</div>${tags}${clip}
        ${d.headline ? `<div class="upg-headline">${d.headline}</div>` : ''}${slotRewardHtml(d.reward)}
        ${d.summary ? `<div class="upg-summary">${d.summary}</div>` : ''}
        ${rows || more ? `<div class="upg-stats">${rows}${more}
        </div>` : ''}
      </div>
      <div class="upg-level">${levelText(d, installed)}</div>
    `
  };
}
