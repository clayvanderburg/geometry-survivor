// Per-level scaling for the autonomous weapons and synergies.
// main.js fires every weapon through these, and upgrade cards preview them, so a card's
// BEFORE -> AFTER numbers can never drift from what the weapon actually does.
import { TUNING } from './config.js';

// Weapon balance rule: every autonomous weapon has the same POTENTIAL DPS at the same level, in
// multiples of the player's base damage per second. Potential = every attack lands on a target
// (each missile, arc jump, mine, bolt, singularity core tick + collapse, and each orbit-blade pass
// over an enemy sitting on the ring); splash on extra targets is not counted. Each weapon keeps its
// own counts, cooldowns and ranges; its damage per hit is solved from this curve, so changing a
// count or cooldown re-balances the hit damage automatically. How easy each weapon is to use
// (tracking, range, uptime in real fights) is tuned separately.
export const DPS_TARGET = (lv) => 3 * Math.pow(lv, 1.5);

// Reference target for orbit-blade contact: a typical swarmer hull plus the blade's hit radius.
const ORBITAL_REF_CONTACT = 2 * (14 + 18);
// Share of the singularity's potential that comes from the collapse pulse (the rest is core grind).
const SINGULARITY_COLLAPSE_SHARE = 0.45;
const SINGULARITY_LIFE_TICKS = 2.6 * 60;

export const WEAPON_SCALING = {
  // Prism Split (per level): adds one pair of blaster streams in the fixed PRISM_STREAMS order.
  multishotBolts: 2,

  // Wing Rockets (starting weapon, leveled like the others): dumbfire rockets from the outer wing tips,
  // always fired along the hull's heading. Direct hit + a small blast centred on the target (the blast
  // is a share of the hit, so a rocket deals hit x (1 + blast share) to whatever it strikes). Rockets
  // alternate wings; odd counts put the extra rocket on the left. Count rises where the DPS curve can
  // absorb it without lowering damage per hit, and the cooldown shortens on the other levels.
  wingRocketCount: (lv) => [2, 2, 2, 2, 3, 4, 4, 5, 6][Math.max(0, Math.min(8, lv))],
  wingRocketCooldown: (lv) => [1, 1, 0.9, 0.8, 0.8, 0.8, 0.7, 0.7, 0.7][Math.max(0, Math.min(8, lv))],
  wingRocketDamageMult: (lv) => DPS_TARGET(lv) * W.wingRocketCooldown(lv) / (W.wingRocketCount(lv) * (1 + W.wingRocketBlastShare)),
  wingRocketBlastShare: 0.5,
  wingRocketBlastRadius: (lv) => 46 + lv * 4,
  wingRocketSpeed: 8.5,
  wingRocketLife: 1.6,

  // Swarm Micro-Missiles: salvos come 25% faster than the original 1.9 s - 0.1/LV (floor 1.2 s) curve,
  // so each missile carries 20% less damage at the same potential DPS.
  missileSalvo: (lv) => 1 + lv,
  missileSpeed: (lv) => 9.5 + lv * 0.8,
  missileDamageMult: (lv) => DPS_TARGET(lv) * W.missileCooldown(lv) / W.missileSalvo(lv),
  missileCooldown: (lv) => Math.max(0.96, 1.52 - lv * 0.08),
  missileBlastRadius: 75,

  // Tesla Arc Emitter (Storm Protocol detonations chain at a fixed level)
  lightningJumps: (lv) => 3 + lv * 2,
  lightningDamageMult: (lv) => DPS_TARGET(lv) * W.lightningCooldown(lv) / W.lightningJumps(lv),
  lightningCooldown: (lv) => Math.max(0.95, 1.65 - lv * 0.1),
  stormChainLevel: 2,

  // Vortex Singularity: light per-tick core damage so packs clump, then a collapse pulse over 85% of the pull radius
  singularityCooldown: (lv) => Math.max(2.2, 4.5 - lv * 0.5),
  singularityCoreRadius: (lv) => 14 + lv * 3,
  singularityPullRadius: (lv) => 150 + lv * 25,
  singularityDamageMult: (lv) => DPS_TARGET(lv) * W.singularityCooldown(lv) * (1 - SINGULARITY_COLLAPSE_SHARE) / SINGULARITY_LIFE_TICKS,
  singularityCollapseDamageMult: (lv) => DPS_TARGET(lv) * W.singularityCooldown(lv) * SINGULARITY_COLLAPSE_SHARE,
  singularityCollapseRadiusFrac: 0.85,

  // Aegis Orbiting Blades (damage per tick of contact; a pass lasts ORBITAL_REF_CONTACT px of arc)
  orbitalBlades: (lv) => 1 + lv,
  orbitalRadius: (lv) => 95 + lv * 8,
  orbitalSpin: (lv) => 4.4 + lv * 0.45,
  orbitalBladeRadius: 18,
  orbitalDamageMult: (lv) => DPS_TARGET(lv) / (W.orbitalPassesContactTicksPerSec(lv)),
  orbitalPassesContactTicksPerSec: (lv) => W.orbitalBlades(lv) * ORBITAL_REF_CONTACT / (2 * Math.PI * W.orbitalRadius(lv)) * 60,

  // Volatile Shatter (passive, no slot): on-kill shards at a flat 0.75x base damage. It is not on the
  // DPS curve (it needs kills to fire), like the dash nova.
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
  mineDamageMult: (lv) => DPS_TARGET(lv) * W.mineCooldown(lv),

  // Sentry Turret (deployable): planted at the ship, shoots the nearest enemy it can see past cover.
  turretCooldown: (lv) => Math.max(5.5, 8.5 - lv * 0.5),
  turretMaxActive: (lv) => 1 + Math.floor(lv / 3),
  turretDuration: (lv) => 5 + lv,
  turretRange: (lv) => 300 + lv * 25,
  // Bolts per second per live turret: twice the original 2.6 + 0.45/LV, at half the damage per bolt.
  turretFireRate: (lv) => 5.2 + lv * 0.9,
  turretDamageMult: (lv) => DPS_TARGET(lv) / (W.turretAverageActive(lv) * W.turretFireRate(lv)),
  // Mean live turrets: one per cooldown, each lasting its lifetime, never above the active cap.
  turretAverageActive: (lv) => Math.min(W.turretMaxActive(lv), W.turretDuration(lv) / W.turretCooldown(lv)),
  turretBoltSpeed: 13,

  // Escort Drones (deployable): 1-3 gunships flying in formation behind the hull.
  droneCount: (lv) => Math.min(3, lv),
  droneFireRate: (lv) => 1.6 + lv * 0.3,
  droneRange: (lv) => 260 + lv * 20,
  droneDamageMult: (lv) => DPS_TARGET(lv) / (W.droneCount(lv) * W.droneFireRate(lv)),
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

// Prism Split stream layout, in unlock order. Each group is a pair of streams; existing streams never
// move, so the first pair always fires straight ahead where the player aims. Angles are degrees from
// the aim; `parallel` pairs fire side by side (offset `lateral` px) instead of mirrored left/right.
// Past the last group the order repeats (doubling up) with a small extra offset.
export const PRISM_STREAMS = [
  { name: 'FORWARD', angle: 0, parallel: true },
  { name: 'REAR', angle: 180, parallel: true },
  { name: 'SIDES', angle: 90 },
  { name: 'FORWARD DIAGONALS', angle: 40 },
  { name: 'REAR DIAGONALS', angle: 140 },
  { name: 'FORWARD FLANKS', angle: 20 },
  { name: 'WIDE FLANKS', angle: 65 },
  { name: 'REAR FLANKS', angle: 115 },
  { name: 'TAIL FLANKS', angle: 160 }
];
const PRISM_LATERAL = 7;

// Every stream for a volley of `count` bolts: { angle (radians from aim), lateral (px sideways) }.
export function prismStreams(count) {
  const streams = [];
  for (let i = 0; i < count; i++) {
    const pair = Math.floor(i / 2);
    const group = PRISM_STREAMS[pair % PRISM_STREAMS.length];
    const layer = Math.floor(pair / PRISM_STREAMS.length);
    const side = i % 2 === 0 ? -1 : 1;
    const extra = layer * 5;
    if (group.parallel) {
      streams.push({ angle: (group.angle * Math.PI) / 180, lateral: side * (PRISM_LATERAL + extra) });
    } else {
      streams.push({ angle: (side * group.angle * Math.PI) / 180, lateral: extra ? side * extra : 0 });
    }
  }
  return streams;
}

// Name of the newest stream pair at this bolt count (shown on the Prism Split card).
export function prismNewestGroup(count) {
  const pair = Math.max(0, Math.ceil(count / 2) - 1);
  const name = PRISM_STREAMS[pair % PRISM_STREAMS.length].name;
  return pair >= PRISM_STREAMS.length ? `${name} x2` : name;
}

// Potential DPS (x base damage) per autonomous weapon, from its counts, cooldowns and hit damage.
// Tests hold every weapon to DPS_TARGET at every level; the balance tool reports it alongside real runs.
export const POTENTIAL_DPS = {
  rockets: (lv) => W.wingRocketCount(lv) * W.wingRocketDamageMult(lv) * (1 + W.wingRocketBlastShare) / W.wingRocketCooldown(lv),
  missiles: (lv) => W.missileSalvo(lv) * W.missileDamageMult(lv) / W.missileCooldown(lv),
  lightning: (lv) => W.lightningJumps(lv) * W.lightningDamageMult(lv) / W.lightningCooldown(lv),
  singularity: (lv) => (W.singularityDamageMult(lv) * SINGULARITY_LIFE_TICKS + W.singularityCollapseDamageMult(lv)) / W.singularityCooldown(lv),
  orbitals: (lv) => W.orbitalPassesContactTicksPerSec(lv) * W.orbitalDamageMult(lv),
  mines: (lv) => W.mineDamageMult(lv) / W.mineCooldown(lv),
  turret: (lv) => W.turretAverageActive(lv) * W.turretFireRate(lv) * W.turretDamageMult(lv),
  drones: (lv) => W.droneCount(lv) * W.droneFireRate(lv) * W.droneDamageMult(lv)
};

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
  rocket: ['projectile', 'explosive', 'area'],
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
    case 'orbital': base = d * W.orbitalDamageMult(lv); break;
    case 'missile': base = d * W.missileDamageMult(lv); break;
    case 'lightning': base = d * W.lightningDamageMult(lv); break;
    case 'singularity': base = d * W.singularityDamageMult(lv); break;
    case 'collapse': return d * W.singularityCollapseDamageMult(lv) * (TUNING.singularityCollapseMult ?? 1) * tagDamageMult(p, 'singularity');
    case 'nova': base = W.novaDamage(lv); break;
    case 'tectonic': base = d * W.tectonicDamageMult; break;
    case 'rocket': base = d * W.wingRocketDamageMult(Math.max(1, lv)); break;
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
export const wingRocketBlastRadius = (p, lv) => W.wingRocketBlastRadius(Math.max(1, lv)) * areaMult(p);
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
