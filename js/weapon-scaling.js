// Per-level scaling for the autonomous weapons and synergies.
// main.js fires every weapon through these, and upgrade cards preview them, so a card's
// BEFORE -> AFTER numbers can never drift from what the weapon actually does.
export const WEAPON_SCALING = {
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
  siegeShellDamageMult: 0.7
};
