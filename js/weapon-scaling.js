// Per-level scaling for the autonomous weapons and synergies.
// main.js fires every weapon through these, and upgrade cards preview them, so a card's
// BEFORE -> AFTER numbers can never drift from what the weapon actually does.
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

  // Golden synergies
  helixArms: 2,
  helixDamageMult: 0.8,
  tectonicBlastRadius: 135,
  tectonicDamageMult: 2.6
};
