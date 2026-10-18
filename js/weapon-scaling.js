// Weapon scaling: every weapon formula, read by the firing code (main.js, deployables.js) and by the
// upgrade-card previews, so a card's BEFORE -> AFTER numbers can never drift from what the weapon does.
//
// Weapon formulas take a *build* (weapon-levels.js makeBuild / weaponBuild): the weapon level `lv`
// (1-12, plus evolution bonus levels), the effective rank of each of its stats `r` (stat-card ranks +
// ACROSS THE BOARD ranks), the transforms taken at LV 4 / 8 / 12 (`t4`, `t8`, `t12`) and the number of
// ACROSS THE BOARD boosts (`atb`). Each stat formula reads ONLY its own rank, so a stat card changes
// exactly the stat it names: the Damage card is the only card that changes damage per hit.
import { TUNING } from './config.js';
import { BT_TRANSFORM_DPS, BT_BOOST_DPS, levelBuild, weaponBuild } from './weapon-levels.js';

// Weapon balance rule: at LV 1 every weapon has the same POTENTIAL DPS (DPS_TARGET(1)). After that each
// stat reads only its own rank. POWER ranks add damage output (Damage: x DAMAGE_GROWTH hit damage per
// rank, compounding; fire rate / reload / cooldown: +RATE_STEP attacks per second; count: one more
// projectile), so a weapon built for damage matches every other weapon built for damage. UTILITY ranks
// (size, radius, pull, reach, lifetime, spin, pierce) add no potential DPS: they are the trade-off.
// Potential = every attack lands on a target (each missile, arc jump, mine, bolt, singularity core tick
// + collapse, each orbit-blade pass over an enemy on the ring, and each extra attack a transform adds:
// flak, bomblets, napalm, orbs, strikes...); splash on extra targets is not counted. Transform attacks
// that land unlike a main hit are valued at a share measured in the Weapon Range (the *HitShare
// constants): below 1 for bomblets and splits that catch fewer enemies, above 1 for strikes, shells and
// pulls that catch a whole pack.
// Breakthroughs: a transform multiplies potential by BT_TRANSFORM_DPS (its hit damage is rescaled so the
// new attacks add exactly that), ACROSS THE BOARD x BT_BOOST_DPS and BT_BOOST_RANKS to every UTILITY stat.
// DPS_TARGET is the LV 1 reference (and the old level curve the balance tools still report against).
export const DPS_TARGET = (lv) => 3 * Math.pow(Math.max(0, lv), 1.5);

// Potential DPS budget of a build: the level curve times its Breakthrough multipliers.
export const buildBudget = (b) => DPS_TARGET(b.lv) * Math.pow(BT_BOOST_DPS, b.atb) * Math.pow(BT_TRANSFORM_DPS, b.transforms);

// Per-rank steps of the POWER stats shared by every weapon.
// x1.5 compounding (tuned with tools/balance-sim.mjs so mixed builds keep pace with the enemy HP ramp).
export const DAMAGE_GROWTH = 1.42; // Damage card: x1.42 damage per hit per rank (compounding; 1.5 before v0.29, 1.45 before v0.31)
export const RATE_STEP = 0.4;     // fire rate / reload / cooldown cards: +40% attacks per second per rank
// Hit damage multiplier of a build: its Damage ranks and ACROSS THE BOARD boosts (nothing else).
export const hitMult = (b) => Math.pow(DAMAGE_GROWTH, b.r.damage || 0) * Math.pow(BT_BOOST_DPS, b.atb);
// Hit-damage rescale for transforms: the build's attack units with and without its transforms, so the
// transforms together add exactly BT_TRANSFORM_DPS each, however many extra attacks they make.
const noTransforms = (b) => ({ ...b, t4: false, t8: false, t12: false, transforms: 0 });
const tfScale = (b, units) => (b.transforms ? Math.pow(BT_TRANSFORM_DPS, b.transforms) * units(noTransforms(b)) / units(b) : 1);
const rateMult = (rank) => 1 + RATE_STEP * (rank || 0);
// LV 1 hit damage of a weapon, solved once from its rank-0 build so LV 1 sits on DPS_TARGET(1).
const lv1Cache = new Map();
const lv1 = (key, id, solve) => {
  if (!lv1Cache.has(key)) lv1Cache.set(key, solve(levelBuild(id, 1)));
  return lv1Cache.get(key);
};

// Reference target for orbit-blade contact: a typical swarmer hull plus the blade's hit radius.
const ORBITAL_REF_CONTACT = 2 * (14 + 18); // at LV 1 blade size (Blade Size adds no potential)
// Share of a singularity's potential that comes from the collapse pulse (the rest is core grind).
const SINGULARITY_COLLAPSE_SHARE = 0.45;
// Sentry turrets alive at once can never exceed this (deployables.js pool size).
export const TURRET_MAX_ACTIVE = 9; // 3 + Sentry Turret Count (cap 6)

export const WEAPON_SCALING = {
  // --- Autocannon (stats: damage, prism, rate, pierce) -----------------------------------------------
  // Plasma Charge raises bolt damage; Prism Split adds a pair of streams in the fixed PRISM_STREAMS
  // order; Hyper-Capacitor adds RATE_STEP fire rate per rank (linear); Phase Piercer +1 pierce per rank.
  multishotBolts: 2,
  blasterRateStep: RATE_STEP,
  blasterRateMult: (b) => rateMult(b.r.rate),
  blasterExtraStreams: (b) => W.multishotBolts * b.r.prism,
  blasterExtraPierce: (b) => b.r.pierce,
  // Transforms: Flak Rounds (a small blast at every hit), Ricochet Rounds (a hit spawns one ricochet
  // bolt at 60% damage), Arc Rounds (every hit arcs into 2 nearby enemies for 30% each).
  flakShare: 0.5,
  flakRadius: 46,
  ricochetShare: 0.6,
  ricochetRange: 240,
  ricochetClaimTime: 0.3, // s a ricochet's pick stays claimed, so the next bolts bounce elsewhere
  // Ricochets land ~95%, but ACROSS THE BOARD's free Pierce ranks carry bolts on through crowds (worth 0 in
  // this model), so the bounce is valued at this share of a full ricochet to keep the transform level with it.
  ricochetValue: 0.25,
  arcRoundJumps: 2,
  arcRoundShare: 0.3,
  arcRoundRange: 150,
  blasterUnits: (b) => (1 + (b.t4 ? W.flakShare : 0) + (b.t12 ? W.arcRoundJumps * W.arcRoundShare : 0)) * (1 + (b.t8 ? W.ricochetShare * W.ricochetValue : 0)),
  blasterDamageMult: (b) => hitMult(b) * tfScale(b, W.blasterUnits),

  // --- Rocket Pods (stats: damage, count, reload, radius) -----------------------------------------
  // Dumbfire rockets from the flank pods, fired along the turret aim. Direct hit + a blast worth
  // wingRocketBlastShare of the hit, centred on the target.
  wingRocketCount: (b) => 2 + b.r.count,
  wingRocketCooldown: (b) => 1 / rateMult(b.r.reload),
  wingRocketBlastRadius: (b) => 50 * (1 + 0.12 * b.r.radius),
  wingRocketBlastShare: 0.5,
  wingRocketSpeed: 8.5,
  wingRocketLife: 1.6,
  // Transforms: Tandem Warheads (a second blast after tandemDelay), Napalm Trail (a burning pool worth
  // napalmShare of the hit, ticking every napalmTick for napalmLife), MIRV (splits into 3 homing
  // mini-rockets after mirvTime; a rocket that hits before splitting carries all three payloads).
  tandemShare: 0.5,
  tandemDelay: 0.24,
  napalmShare: 0.33,
  napalmLife: 2,
  napalmTick: 0.25,
  mirvSplit: 3,
  mirvTime: 0.24,
  mirvRange: 320, // mini-rockets home on the nearest enemies this far ahead of the split
  mirvHoming: 0.12, // rad per tick
  mirvHitShare: 0.85, // three small payloads cover no more ground than one rocket's blast: each valued at this share
  rocketUnits: (b) => (1 + W.wingRocketBlastShare + (b.t4 ? W.tandemShare : 0) + (b.t8 ? W.napalmShare : 0)) * (b.t12 ? W.mirvSplit * W.mirvHitShare : 1),
  // Damage of one rocket hit (one mini-rocket with MIRV).
  wingRocketDamageMult: (b) => lv1('rockets', 'rockets', (b0) => DPS_TARGET(1) * W.wingRocketCooldown(b0) / (W.wingRocketCount(b0) * W.rocketUnits(b0))) * hitMult(b) * tfScale(b, W.rocketUnits),

  // --- Swarm Micro-Missiles (stats: damage, salvo, reload, radius) --------------------------------
  missileSalvo: (b) => 2 + b.r.salvo,
  missileCooldown: (b) => 1.44 / rateMult(b.r.reload),
  missileBlastRadius: (b) => 75 * (1 + 0.12 * b.r.radius),
  missileSpeed: 11,
  // Missiles lock targets within missileRange of the ship (about half a screen) and self-destruct after
  // missileLife s, so a salvo never chases across the whole view.
  missileRange: 460,
  missileLife: 1.6,
  // Transforms: Cluster Bomblets (4 bomblets at 30% each, valued at clusterHitShare), Orbital Rain
  // (strikes from above on marked targets after rainDelay, rainRadiusMult wider), Tactical Nuke (every
  // 4th salvo is one nuke worth nukeUnits salvos, valued at nukeHitShare).
  clusterBomblets: 4,
  clusterShare: 0.3,
  clusterDelay: 0.3,
  clusterRadiusFrac: 0.42,
  clusterSpread: 2, // bomblets hop onto enemies up to 2 blast radii out (the rest scatter)
  clusterHitShare: 0.3, // a bomblet catches about a third of the enemies a missile blast does: valued at this share
  rainDelay: 0.55,
  rainRadiusMult: 1.15, // warheads from above blast wider (like ACROSS THE BOARD's Blast Size rank): utility, no potential
  nukeEvery: 4,
  nukeUnits: 1.88,
  nukeRadiusMult: 2.2,
  nukeHitShare: 2, // the giant blast catches about twice the enemies of a missile blast: valued at this share
  missileUnits: (b) => (1 + (b.t4 ? W.clusterBomblets * W.clusterShare * W.clusterHitShare : 0)) * (b.t12 ? (W.nukeEvery - 1 + W.nukeUnits * W.nukeHitShare) / W.nukeEvery : 1),
  missileDamageMult: (b) => lv1('missiles', 'missiles', (b0) => DPS_TARGET(1) * W.missileCooldown(b0) / (W.missileSalvo(b0) * W.missileUnits(b0))) * hitMult(b) * tfScale(b, W.missileUnits),

  // --- Tesla Arc Emitter (stats: damage, chain, recharge, reach) ----------------------------------
  // Storm Protocol detonations chain at a fixed level (no stat ranks, no Breakthroughs).
  lightningJumps: (b) => 5 + 2 * b.r.chain,
  lightningCooldown: (b) => 1.55 / rateMult(b.r.recharge),
  lightningRange: (b) => 420 + 35 * b.r.reach, // +40% (was 300 + 25/rank)
  lightningChains: (b) => (b.t4 ? 2 : 1),
  // Transforms: Forked Chains (2 chains), Ball Lightning (an orb dropped on the nearest enemy, worth
  // orbShare of the jumps that landed, orbZaps zaps over orbLife), Thunderstrike (each chain ends in a strike worth
  // strikeShare of that chain's jumps that landed, valued at strikeHitShare).
  orbShare: 0.22,
  orbZaps: 10,
  orbLife: 2,
  orbRange: 160,
  orbDrift: 0.8, // px per tick (fading) as the orb drifts on from the enemy it dropped on
  strikeShare: 0.22,
  strikeRadius: 55,
  strikeFalloff: 0.8, // hits hard at the struck enemy, fading to 20% at the rim
  strikeHitShare: 2, // a strike on a pack catches its neighbours too (a lone chain cannot): valued at this share
  lightningUnits: (b) => W.lightningChains(b) * W.lightningJumps(b) * (1 + (b.t8 ? W.orbShare : 0) + (b.t12 ? W.strikeShare * W.strikeHitShare : 0)),
  lightningDamageMult: (b) => lv1('lightning', 'lightning', (b0) => DPS_TARGET(1) * W.lightningCooldown(b0) / W.lightningUnits(b0)) * hitMult(b) * tfScale(b, W.lightningUnits),
  stormChainLevel: 2,

  // --- Vortex Singularity (stats: pull, damage, duration, cooldown, core) -------------------------
  // Light per-tick core grind so packs clump, then a collapse pulse over 85% of the pull radius. The
  // pull fades hard toward the rim (gravity.js singularityPullScale) and the collapse falls to 25% at
  // its rim (TUNING.singularityCollapseEdgeFalloff): stat cards and transforms never change either.
  singularityPullRadius: (b) => 175 + 25 * b.r.pull + (b.t8 ? W.aftershockPull : 0),
  singularityLife: (b) => 2.6 + 0.3 * b.r.duration,
  singularityCooldown: (b) => 4 / rateMult(b.r.cooldown),
  singularityCoreRadius: (b) => 22 * (1 + 0.15 * (b?.r?.core || 0)),
  singularityCollapseRadiusFrac: 0.85,
  // Transforms: Twin Singularities (2 cores, each pulling at twinPullScale and valued as twinUnitShare extra), Aftershock Collapse (a
  // wider pull and a second collapse at 60% radius worth aftershockShare), Hawking Cascade (3 mini-singularities worth
  // cascadeShare in total, valued at cascadeHitShare, each drifting onto its own nearby enemy, grinding and
  // collapsing like a small core).
  singularityCount: (b) => (b.t4 ? 2 : 1),
  twinPullScale: 1,
  twinUnitShare: 0.5, // the second core flies the other way and often finds fewer enemies: valued at half
  aftershockShare: 0.22,
  aftershockDelay: 0.6,
  aftershockRadiusFrac: 0.6,
  aftershockPull: 25, // its heavier core pulls one Pull rank further, so the second implosion has a crowd to catch
  cascadeMinis: 3,
  cascadeShare: 0.22,
  cascadeHitShare: 0.5, // a mini's small pull and implosion catch about half what its share of a core would: valued at this share
  cascadeLife: 1.1,
  cascadeRadiusFrac: 0.45,
  cascadePullScale: 0.6,
  singularityUnits: (b) => (b.t4 ? 1 + W.twinUnitShare : 1) * (1 + (b.t8 ? W.aftershockShare : 0) + (b.t12 ? W.cascadeShare * W.cascadeHitShare : 0)),
  // Damage of one core per cast (grind over its LV 1 lifetime + collapse), in base damage: the LV 1 value
  // times the build's hit multiplier. Grind is per tick, so a Lifetime card grinds longer at the same rate.
  singularityCastDamage: (b) => lv1('singularity', 'singularity', (b0) => DPS_TARGET(1) * W.singularityCooldown(b0) / W.singularityUnits(b0)) * hitMult(b) * tfScale(b, W.singularityUnits),
  singularityDamageMult: (b) => W.singularityCastDamage(b) * (1 - SINGULARITY_COLLAPSE_SHARE) / (lv1('singularityLife', 'singularity', W.singularityLife) * 60),
  singularityCollapseDamageMult: (b) => W.singularityCastDamage(b) * SINGULARITY_COLLAPSE_SHARE,
  aftershockDamageMult: (b) => W.singularityCastDamage(b) * W.aftershockShare,
  cascadeDamageMult: (b) => W.singularityCastDamage(b) * W.cascadeShare / W.cascadeMinis * (1 - SINGULARITY_COLLAPSE_SHARE) / (W.cascadeLife * 60),
  cascadeCollapseDamageMult: (b) => W.singularityCastDamage(b) * W.cascadeShare / W.cascadeMinis * SINGULARITY_COLLAPSE_SHARE,

  // --- Aegis Orbiting Blades (stats: damage, count, radius, spin, size) ---------------------------
  // Damage per tick of contact; a pass lasts ORBITAL_REF_CONTACT px of arc, so spin and blade size never
  // change the potential (they sweep more distinct enemies instead).
  orbitalBlades: (b) => 2 + b.r.count,
  orbitalRadius: (b) => 103 + 10 * b.r.radius,
  orbitalSpin: (b) => 4.85 * (1 + 0.12 * b.r.spin),
  orbitalBladeRadius: (b) => 18 * (1 + 0.15 * (b?.r?.size || 0)),
  // Transforms: Counter-Rotating Ring (a second ring at counterRadiusMult x radius, spinning the other
  // way), Blade Fling (each blade flings a saw disc every flingEvery s), Nova Ring (each blade bursts
  // every novaEvery s). Fling and nova are each worth 22% of the rings' contact damage.
  counterRadiusMult: 1.45,
  flingEvery: 2.5,
  flingShare: 0.22,
  flingSpeed: 9,
  flingPierce: 3,
  flingLife: 0.9,
  novaEvery: 4,
  novaShare: 0.22,
  novaRadius: 70,
  orbitalPassesContactTicksPerSec: (b) => W.orbitalBlades(b) * ORBITAL_REF_CONTACT / (2 * Math.PI * W.orbitalRadius(b)) * 60 * (b.t4 ? 1 + 1 / W.counterRadiusMult : 1),
  orbitalUnits: (b) => W.orbitalPassesContactTicksPerSec(b) * (1 + (b.t8 ? W.flingShare : 0) + (b.t12 ? W.novaShare : 0)),
  // A wider ring passes an enemy less often, so its blades hit harder per pass to match: Reach adds no DPS.
  orbitalDamageMult: (b) => lv1('orbitals', 'orbitals', (b0) => DPS_TARGET(1) / W.orbitalUnits(b0)) * hitMult(b) * tfScale(b, W.orbitalUnits)
    * W.orbitalRadius(b) / W.orbitalRadius(levelBuild('orbitals', 1)),
  flingDamageMult: (b) => W.flingShare * W.orbitalPassesContactTicksPerSec(b) * W.flingEvery / W.orbitalBlades(b) * W.orbitalDamageMult(b),
  orbitalNovaDamageMult: (b) => W.novaShare * W.orbitalPassesContactTicksPerSec(b) * W.novaEvery / W.orbitalBlades(b) * W.orbitalDamageMult(b),

  // --- Volatile Shatter (passive, no slot) --------------------------------------------------------
  // On-kill shards at a flat 0.75x base damage. Not on the DPS curve (it needs kills), like the dash nova.
  shrapnelChance: (lv) => Math.min(1, 0.45 + lv * 0.12),
  shrapnelShards: (lv) => 3 + lv,
  shrapnelDamageMult: 0.75,

  // Phase Nova Thrusters
  novaRadius: (lv) => 140 + lv * 35,
  novaDamage: (lv) => 35 * lv,
  dashCooldown: (lv, base) => Math.max(0.2, base - lv * 0.14),

  // --- Proximity Mines (stats: damage, capacity, rate, radius, fuse) ------------------------------
  // Dropped behind the ship on a timer while a slot is free; they arm after TUNING.mineArmTime, burst
  // when an enemy enters the trigger ring, and self-detonate at the end of the fuse.
  mineCooldown: (b) => 2 / rateMult(b.r.rate),
  mineMaxActive: (b) => (3 + b.r.capacity) * (b.t12 ? W.triadCount : 1),
  mineLifetime: (b) => 10.5 + 2 * (b?.r?.fuse || 0),
  mineTriggerRadius: () => 48,
  mineBlastRadius: (b) => 120 * (1 + 0.12 * b.r.radius), // wide, but well inside the old 2x (180)
  // Transforms: Cluster Mines (3 bomblets at 25% each, valued at mineClusterHitShare), Seeker Mines
  // (armed mines crawl toward the nearest enemy), Minefield Triad (3 mines per drop, sharing the damage,
  // tossed toward the nearest enemy).
  mineClusterBomblets: 3,
  mineClusterShare: 0.25,
  mineClusterDelay: 0.35,
  mineClusterHitShare: 0.3, // a small bomblet catches about a third of the crowd the mine's wide blast does: valued at this share
  seekerSpeed: 1.6,
  seekerRange: 280,
  triadCount: 3,
  triadSpacing: 36,
  triadRange: 400, // a triad is tossed toward the nearest enemy this close to the ship (else dropped in the wake)...
  triadToss: 150, // ...landing at most this far out: a crowd that holds back still ends up within a Seeker Mine's reach
  mineUnits: (b) => (b.t12 ? W.triadCount : 1) * (1 + (b.t4 ? W.mineClusterBomblets * W.mineClusterShare * W.mineClusterHitShare : 0)),
  mineDamageMult: (b) => lv1('mines', 'mines', (b0) => DPS_TARGET(1) * W.mineCooldown(b0) / W.mineUnits(b0)) * hitMult(b) * tfScale(b, W.mineUnits),

  // --- Sentry Turret (stats: damage, rate, lifetime, redeploy) ------------------------------------
  // Planted at the ship, shoots the nearest enemy it can see past cover. Live turrets at once follow
  // lifetime / redeploy (never above TURRET_MAX_ACTIVE).
  // Deep Rock Galactic: Survivor style: you carry turretMaxActive turrets (3 at LV 1). Standing still you
  // plant every ready one in quick succession (turretDropStill s apart); on the move one every
  // turretDropMoving s. A turret lasts turretDuration s; its slot then recharges for turretCooldown s.
  // Potential DPS counts every turret out (the user-facing rule: DPS is measured with all of them down),
  // so Lifetime and Redeploy are UTILITY (they keep them out more of the time).
  turretCooldown: (b) => 2.5 / (1 + 0.25 * b.r.redeploy), // was 5 s
  turretDuration: (b) => 10 + 1.5 * b.r.lifetime,
  turretMaxActive: (b) => Math.min(TURRET_MAX_ACTIVE, 3 + (b.r.count || 0)),
  turretDropStill: 0.25,
  turretDropMoving: 1.2,
  turretRange: () => 476, // +40% (was 340)
  turretFireRate: (b) => 6.1 * rateMult(b.r.rate),
  // Turrets counted for potential DPS: all of them out.
  turretAverageActive: (b) => W.turretMaxActive(b),
  turretBoltSpeed: 13,
  // Transforms: Twin Barrels (2 bolts per shot), Mobile Sentries (planted turrets drift after the ship at
  // turretFollowSpeed px/s into a ring turretFollowRadius px around it: no extra attacks, so its rescale
  // makes every bolt BT_TRANSFORM_DPS harder), Mortar Battery (a shell every
  // mortarEvery s worth 22% of the turret's bolt damage, valued at mortarHitShare).
  turretBarrels: (b) => (b.t4 ? 2 : 1),
  turretFollowSpeed: 105, // px/s: about a third of the ship's cruising speed, so they trail behind
  turretFollowRadius: 95,
  mortarEvery: 1.5,
  mortarShare: 0.22,
  mortarRadius: 60,
  mortarDelay: 0.7,
  mortarFalloff: 0.8, // hits hard at the target, fading to 20% at the rim
  mortarHitShare: 1.75, // a shell on a pack catches its neighbours too: valued at this share
  turretShotUnits: (b) => W.turretBarrels(b),
  turretUnits: (b) => W.turretAverageActive(b) * W.turretFireRate(b) * W.turretShotUnits(b) * (1 + (b.t12 ? W.mortarShare * W.mortarHitShare : 0)),
  turretDamageMult: (b) => lv1('turret', 'turret', (b0) => DPS_TARGET(1) / W.turretUnits(b0)) * hitMult(b) * tfScale(b, (x) => W.turretShotUnits(x) * (1 + (x.t12 ? W.mortarShare * W.mortarHitShare : 0))),
  mortarDamageMult: (b) => W.mortarShare * W.turretFireRate(b) * W.turretShotUnits(b) * W.mortarEvery * W.turretDamageMult(b),

  // --- Escort Drones (stats: damage, rate, wingmen, range) ----------------------------------------
  droneCount: (b) => Math.min(3, 1 + b.r.wingmen) + (b.t4 ? 1 : 0),
  droneFireRate: (b) => 7.6 * rateMult(b.r.rate),
  droneRange: (b) => 392 + 35 * b.r.range, // +40% (was 280 + 25/rank)
  droneBoltSpeed: 15,
  // Transforms: Extra Wingman (+1 drone past the cap), Homing Bolts, Micro-Missile Pods (each drone
  // launches a homing micro-missile every podEvery s worth 22% of its bolt damage).
  homingTurn: 0.16,
  podEvery: 2.5,
  podShare: 0.22,
  podBlast: 60,
  droneUnits: (b) => W.droneCount(b) * W.droneFireRate(b) * (1 + (b.t12 ? W.podShare : 0)),
  droneDamageMult: (b) => lv1('drones', 'drones', (b0) => DPS_TARGET(1) / W.droneUnits(b0)) * hitMult(b) * tfScale(b, W.droneUnits),
  podDamageMult: (b) => W.podShare * W.droneFireRate(b) * W.podEvery * W.droneDamageMult(b),

  // --- Plasma Grenades (stats: damage, count, rate, radius, range) --------------------------------
  // Autonomous: every throw interval the ship lobs `count` grenades at the nearest enemies in throw
  // range (or along its aim). Each one arcs for grenadeFlight s, sits armed for grenadeFuse s with a
  // blinking light, then bursts. Its element (and hue) comes from the damage-type cards owned
  // (grenades.js grenadeElement): Thermite burns, Cryo Payload chills, Nanite Swarm corrodes.
  grenadeCount: (b) => 2 + b.r.count,
  grenadeCooldown: (b) => 2.2 / rateMult(b.r.rate),
  grenadeBlastRadius: (b) => 95 * (1 + 0.12 * b.r.radius),
  grenadeRange: (b) => 330 + 40 * (b?.r?.range || 0),
  grenadeFlight: 0.5,
  grenadeFuse: 0.75,
  // Transforms: Cluster Grenades (on landing, grenadeClusterBomblets bomblets worth grenadeClusterShare
  // each pop grenadeClusterDelay s later), Lingering Cloud (a cloud worth cloudShare of the blast, ticking
  // every cloudTick for cloudLife), Gravity Grenade (armed grenades pull enemies in for gravityFuse s, each
  // enemy toward the grenade pulling it hardest, then blast: no extra attacks; the packed blast is valued at
  // gravityHitShare, so every blast hits BT_TRANSFORM_DPS / gravityHitShare as hard).
  grenadeClusterBomblets: 5,
  grenadeClusterShare: 0.2,
  grenadeClusterDelay: 0.45,
  grenadeClusterRadiusFrac: 0.5,
  grenadeClusterSpread: 2.2, // bomblets hop onto enemies up to 2.2 blast radii out (the rest scatter 1-2.2 radii out)
  cloudShare: 0.3,
  cloudLife: 2.5,
  cloudTick: 0.25,
  cloudRadiusFrac: 0.85,
  gravityFuse: 1.1,
  gravityPullRadiusMult: 1.8,
  gravityPull: 0.6,
  gravityRamp: 2, // the pull builds up as the fuse burns down (none on landing, x3 at the blast; grenades.js gravityRamp)
  grenadeClusterHitShare: 0.2, // bomblets land past the blast and catch fewer enemies: valued at this share
  gravityHitShare: 1.3, // the pull packs about a third more enemies into every blast: valued at this share
  grenadeUnits: (b) => (1 + (b.t4 ? W.grenadeClusterBomblets * W.grenadeClusterShare * W.grenadeClusterHitShare : 0) + (b.t8 ? W.cloudShare : 0)) * (b.t12 ? W.gravityHitShare : 1),
  grenadeDamageMult: (b) => lv1('grenades', 'grenades', (b0) => DPS_TARGET(1) * W.grenadeCooldown(b0) / (W.grenadeCount(b0) * W.grenadeUnits(b0))) * hitMult(b) * tfScale(b, W.grenadeUnits),
  // SYNERGY: EMP Grenades (Plasma Grenades + Tesla Arc): each blast arcs into empArcs enemies within
  // empRange x the blast radius for empShare of the blast damage each. Off the DPS curve, like Storm Protocol.
  empArcs: 3,
  empShare: 0.35,
  empRangeMult: 1.5,

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

// Autocannon numbers for a player: streams, fire rate and pierce are the player's base stats plus the
// build's ranks (cards never touch the base stats, so tuner and Armory changes stay live).
export const blasterStreams = (p, b = weaponBuild(p, 'blaster')) => p.stats.bulletCount + W.blasterExtraStreams(b);
export const blasterFireRate = (p, b = weaponBuild(p, 'blaster')) => p.stats.fireRate * W.blasterRateMult(b);
export const blasterPierce = (p, b = weaponBuild(p, 'blaster')) => p.stats.pierce + W.blasterExtraPierce(b);

// Potential DPS (x base damage) per weapon build, from its counts, cooldowns and hit damage, with
// every transform's extra attacks. Tests hold every weapon to buildBudget (DPS_TARGET(level) x its
// Breakthrough multipliers) at every level and stat mix; the balance tool reports it alongside real runs.
// Autocannon is expressed against its own LV 1 (x DPS_TARGET(1)), so it sits on the same curve.
export const POTENTIAL_DPS = {
  blaster: (b) => DPS_TARGET(1) * (1 + b.r.prism) * W.blasterRateMult(b) * W.blasterDamageMult(b)
    * (1 + (b.t4 ? W.flakShare : 0) + (b.t12 ? W.arcRoundJumps * W.arcRoundShare : 0)) * (1 + (b.t8 ? W.ricochetShare * W.ricochetValue : 0)),
  rockets: (b) => W.wingRocketCount(b) * (b.t12 ? W.mirvSplit * W.mirvHitShare : 1) * W.wingRocketDamageMult(b)
    * (1 + W.wingRocketBlastShare + (b.t4 ? W.tandemShare : 0) + (b.t8 ? W.napalmShare : 0)) / W.wingRocketCooldown(b),
  missiles: (b) => {
    const salvo = W.missileSalvo(b) * W.missileDamageMult(b) * (1 + (b.t4 ? W.clusterBomblets * W.clusterShare * W.clusterHitShare : 0)); // bomblets valued at their hit share
    const avg = b.t12 ? ((W.nukeEvery - 1) * salvo + W.nukeUnits * W.nukeHitShare * salvo) / W.nukeEvery : salvo; // the nuke at its hit share
    return avg / W.missileCooldown(b);
  },
  lightning: (b) => {
    const chains = W.lightningChains(b) * W.lightningJumps(b) * W.lightningDamageMult(b);
    const strikes = b.t12 ? W.strikeShare * W.strikeHitShare * chains : 0;
    const orb = b.t8 ? W.orbShare * chains : 0;
    return (chains + strikes + orb) / W.lightningCooldown(b);
  },
  singularity: (b) => {
    const core = W.singularityDamageMult(b) * W.singularityLife(b) * 60 + W.singularityCollapseDamageMult(b);
    const after = b.t8 ? W.aftershockDamageMult(b) : 0;
    const minis = b.t12 ? W.cascadeMinis * (W.cascadeDamageMult(b) * W.cascadeLife * 60 + W.cascadeCollapseDamageMult(b)) * W.cascadeHitShare : 0;
    return (b.t4 ? 1 + W.twinUnitShare : 1) * (core + after + minis) / W.singularityCooldown(b); // the twin often holds other enemies
  },
  orbitals: (b) => W.orbitalPassesContactTicksPerSec(b) * W.orbitalDamageMult(b)
    + (b.t8 ? W.orbitalBlades(b) / W.flingEvery * W.flingDamageMult(b) : 0)
    + (b.t12 ? W.orbitalBlades(b) / W.novaEvery * W.orbitalNovaDamageMult(b) : 0),
  mines: (b) => (b.t12 ? W.triadCount : 1) * W.mineDamageMult(b) * (1 + (b.t4 ? W.mineClusterBomblets * W.mineClusterShare * W.mineClusterHitShare : 0)) / W.mineCooldown(b),
  turret: (b) => W.turretAverageActive(b) * (W.turretFireRate(b) * W.turretShotUnits(b) * W.turretDamageMult(b)
    + (b.t12 ? W.mortarDamageMult(b) * W.mortarHitShare / W.mortarEvery : 0)),
  drones: (b) => W.droneCount(b) * (W.droneFireRate(b) * W.droneDamageMult(b) + (b.t12 ? W.podDamageMult(b) / W.podEvery : 0)),
  grenades: (b) => {
    const blast = W.grenadeDamageMult(b);
    const bomblets = b.t4 ? W.grenadeClusterBomblets * W.grenadeClusterShare * W.grenadeClusterHitShare * blast : 0; // most hop onto other enemies
    const cloud = b.t8 ? W.cloudShare * blast : 0; // every cloud tick on one target
    return W.grenadeCount(b) * (blast + bomblets + cloud) * (b.t12 ? W.gravityHitShare : 1) / W.grenadeCooldown(b);
  }
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
  siege: ['deployable', 'explosive', 'area'],
  grenade: ['projectile', 'explosive', 'area']
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

// Damage source -> the slot weapon whose build sets its numbers.
export const SOURCE_WEAPON = {
  blaster: 'blaster', helix: 'blaster', rocket: 'rockets', missile: 'missiles', lightning: 'lightning',
  singularity: 'singularity', collapse: 'singularity', orbital: 'orbitals', mine: 'mines', turret: 'turret',
  drone: 'drones', siege: 'turret', grenade: 'grenades'
};

// A build for `weapon`: the one given, a level-only build for a number (Storm Protocol's chain), or
// the player's own build of that weapon.
export function sourceBuild(p, weapon, b) {
  if (b && typeof b === 'object') return b;
  const id = SOURCE_WEAPON[weapon];
  if (typeof b === 'number') return levelBuild(id, b);
  return weaponBuild(p, id);
}

// Per-hit damage (before crits and status modifiers) for every weapon. `b` is the weapon's build (or
// a level number for a build without stat ranks; omitted = the player's own build).
export function weaponDamage(p, weapon, b) {
  const d = p.stats.damage;
  let base;
  switch (weapon) {
    case 'blaster': base = d * W.blasterDamageMult(sourceBuild(p, weapon, b)); break;
    case 'helix': {
      // Pulsar Helix bolts hit like Autocannon bolts (Damage ranks and boosts), at helixDamageMult.
      base = d * W.helixDamageMult * hitMult(sourceBuild(p, weapon, b));
      break;
    }
    case 'shrapnel': base = d * W.shrapnelDamageMult; break;
    case 'orbital': base = d * W.orbitalDamageMult(sourceBuild(p, weapon, b)); break;
    case 'missile': base = d * W.missileDamageMult(sourceBuild(p, weapon, b)); break;
    case 'lightning': base = d * W.lightningDamageMult(sourceBuild(p, weapon, b)); break;
    case 'singularity': base = d * W.singularityDamageMult(sourceBuild(p, weapon, b)); break;
    case 'collapse': return d * W.singularityCollapseDamageMult(sourceBuild(p, weapon, b)) * (TUNING.singularityCollapseMult ?? 1) * tagDamageMult(p, 'singularity');
    case 'nova': base = W.novaDamage(b ?? 0); break;
    case 'tectonic': base = d * W.tectonicDamageMult; break;
    case 'rocket': base = d * W.wingRocketDamageMult(sourceBuild(p, weapon, b)); break;
    case 'mine': base = d * W.mineDamageMult(sourceBuild(p, weapon, b)) * (TUNING.deployableDamageMult ?? 1); break;
    case 'turret': base = d * W.turretDamageMult(sourceBuild(p, weapon, b)) * (TUNING.deployableDamageMult ?? 1); break;
    case 'drone': base = d * W.droneDamageMult(sourceBuild(p, weapon, b)) * (TUNING.deployableDamageMult ?? 1); break;
    case 'siege': base = d * W.turretDamageMult(sourceBuild(p, weapon, b)) * W.siegeShellDamageMult * (TUNING.deployableDamageMult ?? 1); break;
    case 'grenade': base = d * W.grenadeDamageMult(sourceBuild(p, weapon, b)); break;
    default: return d;
  }
  return base * tagDamageMult(p, weapon);
}

// Radii scaled by the AREA tag (missile blasts, singularity pull/collapse, dash nova, tectonic blast).
export const missileBlastRadius = (p, b = weaponBuild(p, 'missiles')) => W.missileBlastRadius(b) * areaMult(p);
export const wingRocketBlastRadius = (p, b = weaponBuild(p, 'rockets')) => W.wingRocketBlastRadius(b) * areaMult(p);
export const singularityPullRadius = (p, b = weaponBuild(p, 'singularity')) => W.singularityPullRadius(b) * areaMult(p);
export const novaRadius = (p, lv) => W.novaRadius(lv) * areaMult(p);
export const tectonicBlastRadius = (p) => W.tectonicBlastRadius * areaMult(p);
export const mineBlastRadius = (p, b = weaponBuild(p, 'mines')) => W.mineBlastRadius(b) * areaMult(p);
export const siegeShellRadius = (p) => W.siegeShellRadius * areaMult(p);
export const grenadeBlastRadius = (p, b = weaponBuild(p, 'grenades')) => W.grenadeBlastRadius(b) * areaMult(p);

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
