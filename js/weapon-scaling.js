// Per-level scaling for the autonomous weapons and synergies.
// main.js fires every weapon through these, and upgrade cards preview them, so a card's
// BEFORE -> AFTER numbers can never drift from what the weapon actually does.
import { TUNING } from './config.js';

export const WEAPON_SCALING = {
  // Prism Split (per level): extra blaster bolts, and extra angle between neighbouring bolts.
  // The spread is per gap, so the fan's total width grows with both bolt count and level.
  // 0.04 (was 0.11): at 0.11 the even-count fan left the aimed target in the gap between the inner
  // bolts beyond ~110 px at LV 1, and LV 7 wrapped 16 bolts over 782° (docs/BALANCE_REPORT.md).
  multishotBolts: 2,
  multishotSpread: 0.04,

  // Swarm Micro-Missiles
  missileSalvo: (lv) => 1 + lv,
  missileSpeed: (lv) => 9.5 + lv * 0.8,
  missileDamageMult: (lv) => 1.8 + lv * 0.35,
  missileCooldown: (lv) => Math.max(0.65, 1.9 - lv * 0.22),
  missileBlastRadius: 75,

  // Tesla Arc Emitter (Storm Protocol detonations chain at a fixed level)
  lightningJumps: (lv) => 3 + lv * 2,
  lightningDamageMult: (lv) => 1.4 + lv * 0.35,
  lightningCooldown: (lv) => Math.max(0.55, 1.65 - lv * 0.2),
  stormChainLevel: 2,

  // Vortex Singularity: light per-tick core damage so packs clump, then a collapse pulse over 85% of the pull radius
  singularityCooldown: (lv) => Math.max(2.2, 4.5 - lv * 0.5),
  singularityCoreRadius: (lv) => 14 + lv * 3,
  singularityPullRadius: (lv) => 150 + lv * 25,
  singularityDamageMult: (lv) => 0.14 + lv * 0.05,
  singularityCollapseDamageMult: (lv) => 10 + lv * 5,
  singularityCollapseRadiusFrac: 0.85,

  // Aegis Orbiting Blades (damage per tick of contact)
  orbitalBlades: (lv) => 1 + lv,
  orbitalRadius: (lv) => 62 + lv * 6,
  orbitalSpin: (lv) => 3.2 + lv * 0.4,
  orbitalDamageMult: 0.35,

  // Volatile Shatter
  shrapnelChance: (lv) => Math.min(1, 0.45 + lv * 0.12),
  shrapnelShards: (lv) => 3 + lv,
  shrapnelDamageMult: 0.75,

  // Phase Nova Thrusters
  novaRadius: (lv) => 140 + lv * 35,
  novaDamage: (lv) => 35 * lv,
  dashCooldown: (lv, base) => Math.max(0.2, base - lv * 0.14),

  // Proximity Mines (deployable): dropped behind the ship on a timer while a slot is free; they arm
  // after TUNING.mineArmTime, burst when an enemy enters the trigger ring, and self-detonate at the end of the fuse.
  mineCooldown: (lv) => Math.max(0.8, 2.2 - lv * 0.22),
  mineMaxActive: (lv) => 2 + lv,
  mineLifetime: (lv) => 9 + lv * 1.5,
  mineTriggerRadius: (lv) => 44 + lv * 4,
  mineBlastRadius: (lv) => 80 + lv * 10,
  mineDamageMult: (lv) => 3.2 + lv * 0.7,

  // Sentry Turret (deployable): planted at the ship, shoots the nearest enemy it can see past cover.
  turretCooldown: (lv) => Math.max(4.5, 8.5 - lv * 0.6),
  turretMaxActive: (lv) => 1 + Math.floor(lv / 3),
  turretDuration: (lv) => 5 + lv,
  turretRange: (lv) => 300 + lv * 25,
  turretFireRate: (lv) => 2.6 + lv * 0.5,
  turretDamageMult: (lv) => 0.8 + lv * 0.1,
  turretBoltSpeed: 13,

  // Escort Drones (deployable): 1-3 gunships flying in formation behind the hull.
  droneCount: (lv) => Math.min(3, 1 + Math.floor(lv / 2)),
  droneFireRate: (lv) => 1.6 + lv * 0.3,
  droneRange: (lv) => 260 + lv * 20,
  droneDamageMult: (lv) => 0.55 + lv * 0.08,
  droneBoltSpeed: 15,

  // Golden synergies
  helixArms: 2,
  helixDamageMult: 0.8,
  tectonicBlastRadius: 135,
  tectonicDamageMult: 2.6,
  // Siege Battery: every turret bolt that hits bursts like a small mine.
  siegeShellRadius: 52,
  siegeShellDamageMult: 0.7,
  // Critical hits: chance is additive per card level, damage is the crit multiplier.
  // Supercritical multiplies the crit *bonus* (multiplier - 1) against status-afflicted targets.
  critChanceStep: 0.05,
  critDamageStep: 0.25,
  supercritChance: 0.1,
  supercritBonusMult: 1.5,

  // Tag cards: additive damage bonus per level for every weapon carrying the tag; AREA scales radii.
  tagDamageStep: { kinetic: 0.2, explosive: 0.3, electric: 0.3 },
  areaStep: 0.15,

  // BURN (Thermite Rounds): each primary-bolt hit adds a stack and refreshes the timer;
  // stacks tick together every burnTickInterval seconds.
  burnStackDpsMult: (lv) => 0.3 + lv * 0.15,
  burnMaxStacks: (lv) => 3 + lv,
  burnDuration: 3,
  burnTickInterval: 0.5,

  // CHILL (Cryo Payload): missile blasts slow movement; it refreshes, it does not stack.
  chillSlow: (lv) => 0.25 + lv * 0.05,
  chillDuration: (lv) => 1.8 + lv * 0.3,

  // CORRODE (Nanite Swarm): each arc hit adds a stack of +damage taken from every source, up to a cap.
  corrodePerStack: 0.05,
  corrodeMaxStacks: (lv) => 4 + lv,
  corrodeDuration: 4
};

const W = WEAPON_SCALING;

// Weapon tags: what each damage source *is*. Tag cards boost every source carrying their tag, and
// upgrade cards show them as chips. Keys are the weapons below, not damage-number sources.
export const WEAPON_TAGS = {
  blaster: ['projectile', 'kinetic'],
  helix: ['projectile', 'kinetic'],
  shrapnel: ['projectile', 'kinetic'],
  orbital: ['orbital', 'kinetic'],
  missile: ['projectile', 'explosive', 'area'],
  lightning: ['electric'],
  singularity: ['gravity', 'area'],
  nova: ['area'],
  tectonic: ['explosive', 'area'],
  mine: ['deployable', 'explosive', 'area'],
  turret: ['deployable', 'projectile', 'kinetic'],
  drone: ['deployable', 'projectile', 'kinetic'],
  siege: ['deployable', 'explosive', 'area']
};

// Chip label + neon per tag (weapon families, damage types and crits share one palette).
export const TAG_INFO = {
  projectile: { label: 'PROJECTILE', color: '#7ffbff' },
  kinetic: { label: 'KINETIC', color: '#d6dde8' },
  explosive: { label: 'EXPLOSIVE', color: '#ff9b3d' },
  electric: { label: 'ELECTRIC', color: '#c79bff' },
  area: { label: 'AREA', color: '#ffe45c' },
  orbital: { label: 'ORBITAL', color: '#6dff9e' },
  gravity: { label: 'GRAVITY', color: '#ff6ad5' },
  crit: { label: 'CRIT', color: '#ffd84a' },
  burn: { label: 'BURN', color: '#ff5a2e' },
  chill: { label: 'CHILL', color: '#8fe8ff' },
  corrode: { label: 'CORRODE', color: '#7dff4a' },
  deployable: { label: 'DEPLOYABLE', color: '#5aa8ff' }
};

// Product of the player's tag-damage multipliers over the weapon's tags (1 when none are boosted).
export function tagDamageMult(p, weapon) {
  const boosts = p.stats.tagDamage;
  const tags = WEAPON_TAGS[weapon];
  if (!boosts || !tags) return 1;
  let m = 1;
  for (let i = 0; i < tags.length; i++) m *= boosts[tags[i]] ?? 1;
  return m;
}

export const areaMult = (p) => p.stats.areaMult ?? 1;

// Per-hit damage (before crits and status modifiers) for every weapon. `lv` is the weapon level.
export function weaponDamage(p, weapon, lv = 0) {
  const d = p.stats.damage;
  let base;
  switch (weapon) {
    case 'blaster': base = d; break;
    case 'helix': base = d * W.helixDamageMult; break;
    case 'shrapnel': base = d * W.shrapnelDamageMult; break;
    case 'orbital': base = d * W.orbitalDamageMult; break;
    case 'missile': base = d * W.missileDamageMult(lv); break;
    case 'lightning': base = d * W.lightningDamageMult(lv); break;
    case 'singularity': base = d * W.singularityDamageMult(lv); break;
    case 'collapse': return d * W.singularityCollapseDamageMult(lv) * (TUNING.singularityCollapseMult ?? 1) * tagDamageMult(p, 'singularity');
    case 'nova': base = W.novaDamage(lv); break;
    case 'tectonic': base = d * W.tectonicDamageMult; break;
    case 'mine': base = d * W.mineDamageMult(lv) * (TUNING.deployableDamageMult ?? 1); break;
    case 'turret': base = d * W.turretDamageMult(lv) * (TUNING.deployableDamageMult ?? 1); break;
    case 'drone': base = d * W.droneDamageMult(lv) * (TUNING.deployableDamageMult ?? 1); break;
    case 'siege': base = d * W.turretDamageMult(lv) * W.siegeShellDamageMult * (TUNING.deployableDamageMult ?? 1); break;
    default: return d;
  }
  return base * tagDamageMult(p, weapon);
}

// Radii scaled by the AREA tag (missile blasts, singularity pull/collapse, dash nova, tectonic blast).
export const missileBlastRadius = (p) => W.missileBlastRadius * areaMult(p);
export const singularityPullRadius = (p, lv) => W.singularityPullRadius(lv) * areaMult(p);
export const novaRadius = (p, lv) => W.novaRadius(lv) * areaMult(p);
export const tectonicBlastRadius = (p) => W.tectonicBlastRadius * areaMult(p);
export const mineBlastRadius = (p, lv) => W.mineBlastRadius(lv) * areaMult(p);
export const siegeShellRadius = (p) => W.siegeShellRadius * areaMult(p);

// Crits. A player without crit stats never crits (test fixtures); resetRun seeds the tuned base.
export const critChance = (p) => Math.min(1, p.stats.critChance ?? 0);
export const critDamage = (p) => p.stats.critDamage ?? (TUNING.baseCritDamage ?? 1.5);
export function critMultiplier(p, afflicted = false) {
  const cd = critDamage(p);
  return afflicted && p.weapons.supercritical ? 1 + (cd - 1) * W.supercritBonusMult : cd;
}

// Damage-type numbers at a given card level, including their tuner multipliers.
export const burnStackDps = (p, lv) => p.stats.damage * W.burnStackDpsMult(lv) * (TUNING.burnDamageMult ?? 1);
export const chillSlow = (lv, isBoss = false) => Math.min(0.9, W.chillSlow(lv) * (TUNING.chillSlowMult ?? 1)) * (isBoss ? (TUNING.chillBossMult ?? 0.4) : 1);
export const corrodePerStack = () => W.corrodePerStack * (TUNING.corrodeMult ?? 1);
