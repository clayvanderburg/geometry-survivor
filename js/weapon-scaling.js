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

  // Vortex Singularity: damage is per tick on the core, then x collapseMult when it implodes
  singularityCooldown: (lv) => Math.max(2.2, 4.5 - lv * 0.5),
  singularityCoreRadius: (lv) => 14 + lv * 3,
  singularityPullRadius: (lv) => 150 + lv * 25,
  singularityDamageMult: (lv) => 0.35 + lv * 0.12,
  singularityCollapseMult: 14,

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
