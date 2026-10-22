// Weapon scaling: every weapon formula, read by the firing code (main.js, deployables.js) and by the
// upgrade-card previews, so a card's BEFORE -> AFTER numbers can never drift from what the weapon does.
//
// Weapon formulas take a *build* (weapon-levels.js makeBuild / weaponBuild): the weapon level `lv`
// (1-12, plus evolution bonus levels), the effective rank of each of its stats `r` (stat-card ranks +
// ACROSS THE BOARD ranks), the transforms taken at LV 4 / 8 / 12 (`t4`, `t8`, `t12`) and the number of
// ACROSS THE BOARD boosts (`atb`). Each stat formula reads ONLY its own rank, so a stat card changes
// exactly the stat it names: the Damage card is the only card that changes damage per hit.
import { TUNING } from './config.js';
import { BT_TRANSFORM_DPS, BT_BOOST_DPS, BT_OVERTUNED_DPS, levelBuild, weaponBuild, ELEMENTS, ELEMENT_KEYS, FIXED_ELEMENTS, ELEMENT_MAX_RANKS, flameBurnRank } from './weapon-levels.js';
import { loadoutDamageMult } from './slot-rewards.js';

// Weapon balance rule: at LV 1 every weapon has the same POTENTIAL DPS (DPS_TARGET(1)). After that each
// stat reads only its own rank. POWER ranks add damage output (Damage: x DAMAGE_GROWTH hit damage per
// rank, compounding; fire rate / reload / cooldown: +RATE_STEP attacks per second; count: one more
// projectile), so a weapon built for damage matches every other weapon built for damage. UTILITY ranks
// (size, radius, pull, reach, lifetime, spin, pierce) add no potential DPS: they are the trade-off.
// Potential = every attack lands on a target (each missile, arc chain (later jumps at lightningJumpShare), mine, bolt, singularity core tick
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
export const buildBudget = (b) => DPS_TARGET(b.lv) * Math.pow(BT_BOOST_DPS, b.atb) * Math.pow(BT_OVERTUNED_DPS, b.ot || 0) * Math.pow(BT_TRANSFORM_DPS, b.transforms);

// Per-rank steps of the POWER stats shared by every weapon.
// x1.5 compounding (tuned with tools/balance-sim.mjs so mixed builds keep pace with the enemy HP ramp).
export const DAMAGE_GROWTH = 1.42; // Damage card: x1.42 damage per hit per rank (compounding; 1.5 before v0.29, 1.45 before v0.31)
export const RATE_STEP = 0.4;     // fire rate / reload / cooldown cards: +40% attacks per second per rank
// Deliberate departures from the shared curve (README *Weapon levels*). CARD_STEP_TRIM scales a weapon's
// Damage-card bonus and fire-rate step per rank (Autocannon 0.8: x1.336 damage and +32% fire rate per
// rank, from live player data in v0.36.1). LV1_TRIM scales its LV 1 hit damage, and so its whole curve:
// offensive weapons are tuned up to the Autocannon's real output (card benches, Clay's runs), since the
// potential model over-rates splash and burst hits that overkill or miss. Rocket Pods 1.5 (under target in
// player data at every level); Swarm Missiles 0.7 (Clay: 0.5 from v0.36.1 cut too deep, real runs had them
// far under the Autocannon). FIRE_RATE_TRIM fires a weapon that much faster at the same hit damage, so it
// multiplies DPS at every level: Swarm Missiles x1.3. Together missiles sit at 0.91 of the curve, ~1.82x
// their v0.42 DPS, about level with the Autocannon at LV 1-6 in player data. Escort Drones 3.6, Sentry
// Turret 2.8 and Glaive Discs 3.5 bring the automatic class to its WEAPON_CLASS target (below). Escort Drones
// also take the Autocannon's 0.8 card steps (v0.45; 2.7 on full steps before), so they track it to LV 18
// (73-85% of it at LV 1-18 in the card bench, where full steps had them at 122-134% by LV 12-18). The turret was 4.2 before its
// DRG: Survivor rework (v0.43.4): fewer turrets out (10 s / 6 s reload = 1.67) carry heavier bolts that
// pierce, so less of the curve is lost to overkill. Glaive Discs also take the Autocannon's 0.8 card steps, so
// they track it at every level (kept on target to LV 18 against level-matched HP, not only at LV 3 / 6). Graviton Mortar (id quake) 0.33: its waves
// roll over whole packs (~3.5 enemies per ring in sim runs, 12-19 in the dense card bench), so on the
// shared curve it out-damaged the Autocannon ~2.5x in the pack bench; 0.33 holds it about even in total.
export const CARD_STEP_TRIM = Object.freeze({ blaster: 0.8, glaive: 0.8, harpoon: 0.8, drones: 0.8 }); // the Claw Harpoon (aimed, like the Autocannon) climbs on its curve
export const LV1_TRIM = Object.freeze({ missiles: 0.7, rockets: 1.5, drones: 3.6, turret: 2.8, raillance: 2, glaive: 3.5, harpoon: 2.9, quake: 0.33 });
export const FIRE_RATE_TRIM = Object.freeze({ missiles: 1.3 });
const lv1Trim = (id) => LV1_TRIM[id] ?? 1;

// Class-based balance rule (Clay, v0.43.1): a weapon's REALIZED damage per target, at equal weapon level,
// as a share of the Autocannon's (the aimed single-target reference). The shared potential curve above is
// the model the trims are applied to; this is what they aim at, measured in the card bench
// (tests/weapon-balance.test.js). Automatic single-target weapons give up a little for aiming themselves.
// Area weapons hit several enemies, so they deal less to each one but about as much in total against a
// pack (`pack`). Close-range defensive weapons sit lower by design: the last line of defense. Only the
// `enforced` classes are tested today: the area and defensive numbers wait for the Balance lane's
// measurement of real enemies hit per blast / pass, so the tests record where those weapons sit instead.
export const WEAPON_CLASS = Object.freeze({
  blaster: 'aimed',
  drones: 'auto', turret: 'auto', glaive: 'auto',
  rockets: 'area', missiles: 'area', grenades: 'area', gas: 'area', flamethrower: 'area', cryospray: 'area', acidspray: 'area',
  lightning: 'area', mines: 'area', singularity: 'area', // chains, blasts and pulls also hit several enemies
  shockfield: 'defensive', orbitals: 'defensive',
  raillance: 'aimed', // slow, huge aimed hits that pierce the whole line: held to the Autocannon in the card bench
  nanites: 'area',
  harpoon: 'aimed', // Claw Harpoon: its mining and yank are utility, not DPS
  quake: 'area'
});
export const CLASS_TARGET = Object.freeze({
  aimed: Object.freeze({ perTarget: 1, enforced: true }),
  auto: Object.freeze({ perTarget: 0.85, enforced: true }),
  area: Object.freeze({ perTarget: [0.6, 0.7], pack: 1, enforced: false }),
  defensive: Object.freeze({ perTarget: 'below auto', enforced: false })
});
const fireRateTrim = (id) => FIRE_RATE_TRIM[id] ?? 1;
export const damageGrowth = (id) => 1 + (DAMAGE_GROWTH - 1) * (CARD_STEP_TRIM[id] ?? 1);
export const rateStep = (id) => RATE_STEP * (CARD_STEP_TRIM[id] ?? 1);
// Hit damage multiplier of a build: its Damage ranks, ACROSS THE BOARD and OVERTUNED CORE picks (nothing else).
export const hitMult = (b) => Math.pow(damageGrowth(b.id), b.r.damage || 0) * Math.pow(BT_BOOST_DPS, b.atb) * Math.pow(BT_OVERTUNED_DPS, b.ot || 0);
// Hit-damage rescale for transforms: the build's attack units with and without its transforms, so the
// transforms together add exactly BT_TRANSFORM_DPS each, however many extra attacks they make.
const noTransforms = (b) => ({ ...b, t4: false, t8: false, t12: false, tf: new Set(), transforms: 0 });
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
// Escort Drones flying at once (deployables.js pool size): a front pair and a back row of 3.
export const DRONE_MAX = 8;
// Drones in the FRONT row for a formation of n (the rest fly in the BACK row). One balanced fill order for
// every drone, from Wingmen cards and the LV 6 Escort Squadron alike: 1 front centre, then the front pair,
// the back row up to 3, the front centre (6), then the back row's outer sides (7, 8): 3 in front, 5 behind.
export const droneFrontFor = (n) => (n <= 2 ? n : n <= 5 ? 2 : 3);
export const TURRET_MAX_ACTIVE = 12; // 10 s lifetime / 1.43 s fastest reload (7 out) + a full bank of 3, with room

export const WEAPON_SCALING = {
  // --- Autocannon (stats: damage, prism, rate, pierce) -----------------------------------------------
  // Plasma Charge raises bolt damage; Prism Split adds a pair of streams in the fixed PRISM_STREAMS
  // order; Hyper-Capacitor adds RATE_STEP fire rate per rank (linear); Phase Piercer +1 pierce per rank.
  multishotBolts: 2,
  blasterRateStep: rateStep('blaster'),
  blasterRateMult: (b) => 1 + W.blasterRateStep * (b.r.rate || 0),
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
  wingRocketCooldown: (b) => 0.5 / rateMult(b.r.reload), // 0.65 s before the weapons pass, 1 s before v0.39.8
  wingRocketBlastRadius: (b) => 50 * (1 + 0.12 * b.r.radius),
  wingRocketBlastShare: 0.5,
  wingRocketSpeed: 11, // 8.5 before v0.39.8
  wingRocketLife: 1.3, // same reach as before (1.6 s at 8.5)
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
  wingRocketDamageMult: (b) => lv1Trim('rockets') * lv1('rockets', 'rockets', (b0) => DPS_TARGET(1) * W.wingRocketCooldown(b0) / (W.wingRocketCount(b0) * W.rocketUnits(b0))) * hitMult(b) * tfScale(b, W.rocketUnits),

  // --- Swarm Micro-Missiles (stats: damage, salvo, reload, radius) --------------------------------
  missileSalvo: (b) => 2 + b.r.salvo,
  missileCooldown: (b) => 1.44 / fireRateTrim('missiles') / rateMult(b.r.reload), // 1.44 s before the weapons pass
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
  missileDamageMult: (b) => lv1Trim('missiles') * lv1('missiles', 'missiles', (b0) => DPS_TARGET(1) * W.missileCooldown(b0) * fireRateTrim('missiles') / (W.missileSalvo(b0) * W.missileUnits(b0))) * hitMult(b) * tfScale(b, W.missileUnits),

  // --- Tesla Arc Emitter (stats: damage, chain, recharge, reach) ----------------------------------
  // Storm Protocol detonations chain at a fixed level (no stat ranks, no Breakthroughs).
  lightningJumps: (b) => 5 + 2 * b.r.chain,
  lightningCooldown: (b) => 1.55 / rateMult(b.r.recharge),
  lightningRange: (b) => 420 + 35 * b.r.reach, // +40% (was 300 + 25/rank)
  lightningChains: (b) => (b.t4 ? 2 : 1),
  // Potential counts the first jump of a chain as a full hit and every later jump at lightningJumpShare:
  // like a blast's splash, the extra jumps land on whatever pack is near, so a chain is valued close to
  // one target (it was every jump at full value before v0.42.2, which left each jump hitting far too soft).
  lightningJumpShare: 0.15,
  lightningJumpUnits: (b) => 1 + W.lightningJumpShare * (W.lightningJumps(b) - 1),
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
  lightningUnits: (b) => W.lightningChains(b) * W.lightningJumpUnits(b) * (1 + (b.t8 ? W.orbShare : 0) + (b.t12 ? W.strikeShare * W.strikeHitShare : 0)),
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
  // Transforms are rescaled against the core as it really grinds (Lifetime ranks lengthen the grind but not
  // the aftershock or the minis), so each one adds exactly BT_TRANSFORM_DPS at any Lifetime.
  singularityTfUnits: (b) => {
    const core = (1 - SINGULARITY_COLLAPSE_SHARE) * W.singularityLife(b) / lv1('singularityLife', 'singularity', W.singularityLife) + SINGULARITY_COLLAPSE_SHARE;
    return (b.t4 ? 1 + W.twinUnitShare : 1) * (core + (b.t8 ? W.aftershockShare : 0) + (b.t12 ? W.cascadeShare * W.cascadeHitShare : 0));
  },
  singularityCastDamage: (b) => lv1('singularity', 'singularity', (b0) => DPS_TARGET(1) * W.singularityCooldown(b0) / W.singularityUnits(b0)) * hitMult(b) * tfScale(b, W.singularityTfUnits),
  singularityDamageMult: (b) => W.singularityCastDamage(b) * (1 - SINGULARITY_COLLAPSE_SHARE) / (lv1('singularityLife', 'singularity', W.singularityLife) * 60),
  singularityCollapseDamageMult: (b) => W.singularityCastDamage(b) * SINGULARITY_COLLAPSE_SHARE,
  aftershockDamageMult: (b) => W.singularityCastDamage(b) * W.aftershockShare,
  cascadeDamageMult: (b) => W.singularityCastDamage(b) * W.cascadeShare / W.cascadeMinis * (1 - SINGULARITY_COLLAPSE_SHARE) / (W.cascadeLife * 60),
  cascadeCollapseDamageMult: (b) => W.singularityCastDamage(b) * W.cascadeShare / W.cascadeMinis * SINGULARITY_COLLAPSE_SHARE,

  // --- Aegis Orbiting Blades (stats: damage, count, radius, spin, size) ---------------------------
  // Damage per tick of contact; a pass lasts ORBITAL_REF_CONTACT px of arc, so spin and blade size never
  // change the potential (they sweep more distinct enemies instead).
  orbitalBlades: (b) => 2 + b.r.count,
  // LV 1 ring 155 px at 6.3 rad/s (103 px / 4.85 before the weapons pass: +50% / +30%). Reach and Spin
  // ranks keep about their old absolute steps (+10 px, +0.47 rad/s), so a maxed ring stays on screen and
  // its blades never move further per tick than ORBITAL_REF_CONTACT (they cannot skip past a swarmer).
  orbitalRadius: (b) => 155 + 10 * b.r.radius,
  orbitalSpin: (b) => 6.3 * (1 + 0.075 * b.r.spin),
  orbitalBladeRadius: (b) => 18 * (1 + 0.15 * (b?.r?.size || 0)),
  // Transforms: Counter-Rotating Ring (a second ring at counterRadiusMult x radius, spinning the other
  // way), Blade Fling (each blade flings a saw disc every flingEvery s), Nova Ring (each blade bursts
  // every novaEvery s). Fling and nova are each worth 22% of the rings' contact damage.
  counterRadiusMult: 1.3, // 1.45 before the weapons pass (the inner ring is wider now)
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
  // On-kill shards at a flat shrapnelDamageMult x base damage. Not on the DPS curve (it needs kills), like
  // the dash nova. A supporting passive (Clay, v0.43.4): v0.42.4 tripled the shards at full damage, so a
  // strong build took ~20% of its damage from shards; shards now hit for 0.3x (0.75x before, / 2.5).
  // The burst chance reaches 100% only at LV 8 (it hit 100% at LV 5 before, where every kill bursting set
  // off chain reactions: the card bench output tripled from LV 4 to LV 5).
  shrapnelChance: (lv) => Math.min(1, 0.4 + lv * 0.075), // 0.45 + 0.12 / LV before v0.43.4
  shrapnelShards: (lv) => 1 + 3 * lv, // 4 at LV 1, +3 per level (25 at LV 8)
  shrapnelDamageMult: 0.3,

  // Phase Nova Thrusters
  novaRadius: (lv) => 140 + lv * 35,
  novaDamage: (lv) => 35 * lv,
  dashCooldown: (lv, base) => Math.max(0.2, base - lv * 0.14),
  // Blink Drive: the dash becomes a teleport of blinkDistance(lv) px along the move direction (the aim
  // when parked), landing short of any rock in the way.
  blinkDistance: (lv) => 220 + 60 * (Math.max(1, lv) - 1),
  // Phase Dash: a burst of dashSpeedMult x move speed (px/tick) for dashDuration s. Dash Extender cards
  // stretch the burst (and a blink) by dashDistanceStep per rank; the dash's invulnerability stretches with it.
  dashDuration: 0.22,
  dashSpeedMult: 3.1,
  dashInvuln: 0.32,
  dashDistanceStep: 0.2,
  dashDistanceMult: (lv) => 1 + W.dashDistanceStep * Math.max(0, lv || 0),
  // Distance (px) a burst dash covers: the speed is held for the whole burst.
  dashDistance: (moveSpeed, lv) => W.dashDuration * W.dashDistanceMult(lv) * 60 * moveSpeed * W.dashSpeedMult,

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

  // --- Sentry Turret (stats: damage, rate, reload, pierce) ---------------------------------------
  // Deep Rock Galactic: Survivor's LMG Gun Platform (v0.43.4). You hold turret CHARGES (2; Extra Capacity
  // +1). Stand still for turretStillTime s and every held charge goes down, turretDropStill s apart, at the
  // ship. One charge comes back every turretReload s; a charge that comes back while you already hold
  // the most you can carry deploys by itself (so turrets trickle out on the move too). Each turret fires
  // for turretDuration s, then breaks down. Planted turrets stay put (Tank Tracks makes them follow you).
  // Overflow means no charge is ever wasted, so the turrets out on average are turretDuration /
  // turretReload, whatever the charge count: Reload Speed is POWER, charges only change the burst you can
  // drop at once.
  turretCharges: (b) => 2 + (b.r?.charges || 0) + (b.t4 ? 1 : 0), // r.charges: REPLICATOR ARRAY ranks (no card)
  turretReload: (b) => 6 / rateMult(b.r.reload),
  turretDuration: () => 10,
  turretStillTime: 0.5,
  turretDropStill: 0.25,
  turretRange: () => 476, // +40% (was 340)
  turretFireRate: (b) => 6.1 * rateMult(b.r.rate) * (b.t12 ? W.overloadRate : 1),
  turretPierce: (b) => 2 + (b?.r?.pierce || 0), // enemies one bolt can hit (each one behind takes a little less)
  // Turrets out on average (the potential counts them; never above the pool).
  turretAverageActive: (b) => Math.min(TURRET_MAX_ACTIVE, W.turretDuration(b) / W.turretReload(b)),
  turretBoltSpeed: 13,
  // Breakthroughs = DRG's overclocks: Extra Capacity (LV 6: +1 charge), Tank Tracks (LV 12: planted turrets
  // roll after the ship at turretFollowSpeed px/s, ~43% of its cruising speed as in DRG, into a ring
  // turretFollowRadius px around it), LMG Overload (LV 18: x overloadRate fire rate, each bolt lighter).
  // Extra Capacity and Tank Tracks add no attacks, so their rescale makes every bolt BT_TRANSFORM_DPS harder.
  turretFollowSpeed: 130, // 43% of the ship's 300 px/s base cruise
  turretFollowRadius: 95,
  overloadRate: 2,
  overloadSpread: 0.07, // rad: LMG Overload sprays a little
  turretShotUnits: (b) => (b.t12 ? W.overloadRate : 1),
  turretUnits: (b) => W.turretAverageActive(b) * W.turretFireRate(b),
  turretDamageMult: (b) => lv1Trim('turret') * lv1('turret', 'turret', (b0) => DPS_TARGET(1) / W.turretUnits(b0)) * hitMult(b) * tfScale(b, W.turretShotUnits),

  // --- Escort Drones (stats: damage, rate, wingmen, range) ----------------------------------------
  // Formation: up to 3 in front of the nose and 5 behind the hull, DRONE_MAX in all, filled in one balanced
  // order (droneFrontFor): Wingmen ranks give up to 5 (front pair + back row of 3), Escort Squadron (LV 6)
  // adds 3 more (front centre + the back row's sides). Drones past DRONE_MAX are never wasted: droneSquad
  // counts them and their guns ride on the others.
  droneSquad: (b) => 1 + b.r.wingmen + (b.t4 ? W.squadronRow : 0),
  droneCount: (b) => Math.min(DRONE_MAX, W.droneSquad(b)),
  droneFront: (b) => droneFrontFor(W.droneCount(b)),
  squadronRow: 3,
  // The first drone is the flight LEAD; every drone after it is a lighter WINGMAN whose bolts hit for
  // droneWingHitShare of the lead's. A formation picks a target per drone, so it wastes far less on overkill
  // than one heavy gun: at full value, Wingmen ranks ran ~130% of the Autocannon's Prism Split rank for rank
  // in the card bench (~90% at 0.6). Adding a wingman changes no other drone, so each card still changes
  // only its own stat. Surplus drones past DRONE_MAX add their guns to the wingmen in the formation.
  droneWingHitShare: 0.6,
  droneValue: (b) => 1 + W.droneWingHitShare * (W.droneSquad(b) - 1),
  droneWingDamageMult: (b) => (W.droneCount(b) > 1 ? W.droneDamageMult(b) * W.droneWingHitShare * (W.droneSquad(b) - 1) / (W.droneCount(b) - 1) : 0),
  droneFireRate: (b) => 7.6 * (1 + rateStep('drones') * (b.r.rate || 0)), // card steps trimmed like the Autocannon's (CARD_STEP_TRIM)
  droneRange: (b) => 784 + 35 * b.r.range, // base doubled in v0.38.1 (was 392; 280 + 25/rank before that)
  droneBoltSpeed: 15,
  // Transforms: Escort Squadron (the back row of 3), Homing Bolts, Micro-Missile Pods (each drone
  // launches a homing micro-missile every podEvery s worth 22% of its bolt damage).
  homingTurn: 0.16,
  podEvery: 2.5,
  podShare: 0.22,
  podBlast: 60,
  droneUnits: (b) => W.droneValue(b) * W.droneFireRate(b) * (1 + (b.t12 ? W.podShare : 0)),
  droneDamageMult: (b) => lv1Trim('drones') * lv1('drones', 'drones', (b0) => DPS_TARGET(1) / W.droneUnits(b0)) * hitMult(b) * tfScale(b, W.droneUnits),
  podDamageMult: (b) => W.podShare * W.droneFireRate(b) * W.podEvery * W.droneDamageMult(b), // the lead's; a wingman's pods scale with its bolts

  // --- Plasma Grenades (stats: damage, count, rate, radius, range) --------------------------------
  // Autonomous: every throw interval the ship lobs `count` grenades at the nearest enemies in throw
  // range (or along its aim). Each one arcs for grenadeFlight s, sits armed for grenadeFuse s with a
  // blinking light, then bursts. Its element (and hue) is the one its element card locked in
  // (grenades.js grenadeElement): FIRE burns, FROST chills, CORROSIVE corrodes, SHOCK stuns.
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

  // --- Corrosive Gas Trail (stats: damage, rate, radius, linger) -----------------------------------
  // The ship vents puffs of CORROSIVE gas from its tail as it flies (gas-trail.js): a new puff every
  // gasPuffSpacing x the cloud radius of travel, and a hovering ship keeps topping up its last puff
  // instead of stacking new ones. Every gasTick s each enemy inside ANY cloud takes one tick (clouds
  // never stack on one enemy) and a CORRODE stack. Its element is fixed (weapon-levels.js FIXED_ELEMENTS).
  // A cloud swells in over gasGrow s and shrinks away over the last gasFade share of its life.
  // Potential counts one tick per tick interval on one target; a trail usually holds several enemies,
  // so each tick is valued at gasHitShare (the per-tick damage is that much lower).
  gasRadius: (b) => 46 * (1 + 0.36 * b.r.radius), // +12% / rank before v0.38.1
  gasLife: (b) => 2.6 + 1.2 * (b?.r?.linger || 0), // +0.4 s / rank before v0.38.1
  gasTick: (b) => 0.3 / rateMult(b.r.rate),
  gasPuffSpacing: 0.7,
  // Every dash also vents one giant round cloud where the ship was: gasDashRadiusMult x the cloud radius,
  // lingering gasDashLifeMult x as long. Overlapping clouds never stack on one enemy, so it adds reach
  // (more enemies gassed at once), not potential DPS.
  gasDashRadiusMult: 2.6,
  gasDashLifeMult: 1.5,
  gasGrow: 0.35,
  gasFade: 0.3,
  gasHitShare: 3,
  // Transforms: Seeking Miasma (clouds creep toward the nearest enemy within seekRange at seekSpeed px/s:
  // no extra attacks, so every tick hits BT_TRANSFORM_DPS harder), Volatile Pockets (every pocketEvery s a
  // pocket that arms for pocketArm s, then bursts when an enemy comes within its trigger, or at
  // pocketFuse, for pocketShare of the gas DPS over pocketEvery, valued at pocketHitShare), Toxic Shroud
  // (a cloud shroudRadiusMult x the cloud radius around the hull that ticks with the trail for
  // shroudShare of a tick, valued at shroudHitShare).
  seekRange: 280,
  seekSpeed: 70,
  pocketEvery: 1.2,
  pocketArm: 0.35,
  pocketFuse: 1.8,
  pocketTriggerFrac: 0.6,
  pocketRadiusMult: 1.9,
  pocketShare: 0.5,
  pocketHitShare: 1.6, // a pocket burst on the chasing pack catches a few enemies: valued at this share
  shroudRadiusMult: 2,
  shroudShare: 0.5,
  shroudHitShare: 1.4, // the shroud holds whatever is closing in on the hull: valued at this share
  gasUnits: (b) => W.gasHitShare + (b.t8 ? W.pocketShare * W.pocketHitShare : 0) + (b.t12 ? W.shroudShare * W.shroudHitShare : 0),
  gasDamageMult: (b) => lv1('gas', 'gas', (b0) => DPS_TARGET(1) * W.gasTick(b0) / W.gasUnits(b0)) * hitMult(b) * tfScale(b, W.gasUnits),
  pocketDamageMult: (b) => W.pocketShare * W.gasDamageMult(b) * W.pocketEvery / W.gasTick(b),
  shroudDamageMult: (b) => W.shroudShare * W.gasDamageMult(b),

  // --- Flamethrower (stats: damage, rate, range, cone, turn, burn, nozzles) ------------------------
  // A continuous cone of fire along the turret aim (like the Autocannon), sprayed while firing. Every
  // scorch (flameTickRate per second) hits everything inside the cone, near hits full and the tip at
  // 1 - flameEdgeFalloff, and sets it on FIRE (its built-in element: weapon-levels.js FIXED_ELEMENTS,
  // rank flameBurnRank = 1 + Sticky Gel ranks). Asteroids are cover: the flames stop at a rock face, so
  // a rock shadows the slice of the cone behind it while the rest burns on (flamethrower.js).
  // Potential counts a scorch on flameHitShare targets: the cone always catches a pack and its burn is
  // free (other weapons pay an element card for theirs), so each scorch hits that much softer.
  flameTickRate: (b) => 8 * rateMult(b.r.rate),
  flameRange: (b) => 280 + 40 * (b?.r?.range || 0), // 195 + 20 per rank before v0.39.1, 254 base before v0.39.3
  flameConeHalf: (b) => 0.275 + 0.04 * (b?.r?.cone || 0), // radians either side of the nozzle (~32 deg wide at LV 1; 0.55 before v0.42.1, 0.3 before it spun); +0.09 per rank before v0.39.3
  flameBurnRank,
  // The nozzle never aims: it spins round the ship at this many radians per second (one turn every
  // ~5 s at LV 1), +35% per Spin Rotor rank.
  flameTurnRate: (b) => 1.2 * (1 + 0.35 * (b?.r?.turn || 0)),
  flameEdgeFalloff: 0.35,
  flameHitShare: 0.45, // 2.2 while it aimed: a spinning cone only sweeps a given pack part of the time
  // Extra Nozzle cards (POWER, like Prism Split): flameNozzles(b) identical streams spaced evenly round
  // the spin, each extra one valued at flameNozzleShare of a stream (cones that sweep past each other
  // catch fewer fresh enemies).
  flameNozzles: (b) => 1 + (b?.r?.nozzles || 0),
  flameNozzleShare: 0.6,
  flameNozzleMult: (b) => 1 + W.flameNozzleShare * (W.flameNozzles(b) - 1),
  // Transforms: the LV 6 burst (one per sprayer: Fireballs lobbed from every nozzle to the tip of its
  // stream every flameBurstEvery s; Shatter, a frozen enemy the spray hits bursts in ice shards;
  // Meltdown, a corroded enemy the spray kills bursts in acid; the last two at most once every
  // flameBurstEvery / nozzles s), each burst a flameBurstRadius blast worth flameBurstShare of a
  // nozzle's one-target stream DPS over flameBurstEvery, valued at flameBurstHitShare and scaled with
  // the nozzles), Napalm Puddles (a burning puddle at the
  // flames' tip every flamePuddleEvery s, worth flamePuddleShare of the stream's one-target DPS per
  // target over its life), Inferno Ring (every flameRingEvery s a ring of fire of flameRingRadiusMult x
  // the reach, worth flameRingShare of the stream's one-target DPS over that interval, valued at
  // flameRingHitShare: it hits the whole pack around you).
  flameBurstEvery: 1,
  flameBurstShare: 0.12,
  flameBurstHitShare: 1.5,
  flameBurstRadius: 70,
  flameBurstFlight: 0.3, // s a fireball flies before it bursts
  flamePuddleEvery: 0.5,
  flamePuddleLife: 2.5,
  flamePuddleTick: 0.25,
  flamePuddleRadius: 42,
  flamePuddleShare: 0.5,
  flamePuddleHitShare: 1.5,
  flameRingEvery: 2.5,
  flameRingRadiusMult: 1.3,
  flameRingShare: 0.25,
  flameRingHitShare: 2,
  flameRingKnock: 2.4,
  flameUnits: (b) => W.flameNozzleMult(b) * (W.flameHitShare + (b.t4 ? W.flameBurstShare * W.flameBurstHitShare : 0))
    + (b.t8 ? W.flamePuddleShare * W.flamePuddleHitShare : 0) + (b.t12 ? W.flameRingShare * W.flameRingHitShare : 0),
  // Damage of one scorch on one target.
  flameDamageMult: (b) => lv1('flamethrower', 'flamethrower', (b0) => DPS_TARGET(1) / (W.flameTickRate(b0) * W.flameUnits(b0))) * hitMult(b) * tfScale(b, W.flameUnits),
  // One target's damage per second from the stream (the unit puddles and the ring are measured in).
  flameStreamDps: (b) => W.flameTickRate(b) * W.flameDamageMult(b),
  flameBurstDamageMult: (b) => W.flameBurstShare * W.flameStreamDps(b) * W.flameBurstEvery,
  flamePuddleDamageMult: (b) => W.flamePuddleShare * W.flameStreamDps(b) * W.flamePuddleEvery / (W.flamePuddleLife / W.flamePuddleTick),
  flameRingDamageMult: (b) => W.flameRingShare * W.flameStreamDps(b) * W.flameRingEvery,

  // --- Electric Shield Field (stats: damage, recharge, radius, stun) -------------------------------
  // A defensive field round the hull (js/shock-field.js). Once charged, the first enemy to cross its
  // radius sets off a DISCHARGE that hits everything inside for the same damage and SHOCKs it (its
  // element is fixed: rank fieldStunRank, through the shared stun rules), then it recharges for
  // fieldCooldown s. It never touches the ship's shield. Potential counts one discharge per cooldown
  // on one target (fieldHitShare), like a mine blast: the crowd it catches is mostly fodder that dies to
  // the first jolt, so it realizes less than the damage dealers (measured in the balance harness).
  fieldRadius: (b) => 125 + 24 * (b?.r?.radius || 0), // +12 per rank before v0.39.7
  fieldCooldown: (b) => 2.2 / rateMult(b.r.recharge),
  fieldStunRank: (b) => Math.min(ELEMENT_MAX_RANKS, 1 + (b?.r?.stun || 0)),
  fieldHitShare: 1,
  fieldKnock: 1.2, // a light outward shove on every discharge
  // Transforms: Arc Lash (each discharge also arcs into the lashArcs nearest enemies within lashRangeMult x
  // the radius but outside the field, for lashShare of the discharge each, valued at lashHitShare), Repulsor Surge (discharges
  // throw enemies out by repulseImpulse px/tick of drift and cut the dash cooldown by dashRefund s: no
  // extra attacks, so every discharge hits BT_TRANSFORM_DPS harder), Thunderclap Overcharge (every
  // discharge banks a charge, up to overchargeStore; a full bank fires a thunderclap over
  // overchargeRadiusMult x the radius for overchargeShare of a discharge as soon as overchargePack
  // enemies are inside it or a boss or lieutenant enters the field, valued at overchargeHitShare).
  lashArcs: 3,
  lashShare: 0.35,
  lashHitShare: 0.35, // an arc lands on one straggler while a discharge lands on the whole crowd inside: valued at this share
  lashRangeMult: 2.2,
  repulseImpulse: 8,
  dashRefund: 0.5,
  overchargeStore: 3,
  overchargeShare: 1.2,
  overchargeRadiusMult: 1.6,
  overchargePack: 8,
  overchargeHitShare: 1.25, // it only fires on a pack of 8+ in a wider ring: valued a little above a discharge
  fieldUnits: (b) => W.fieldHitShare + (b.t4 ? W.lashArcs * W.lashShare * W.lashHitShare : 0)
    + (b.t12 ? W.fieldHitShare * W.overchargeShare * W.overchargeHitShare / W.overchargeStore : 0),
  // Damage of one discharge to each enemy in the field.
  fieldDamageMult: (b) => lv1('shockfield', 'shockfield', (b0) => DPS_TARGET(1) * W.fieldCooldown(b0) / W.fieldUnits(b0)) * hitMult(b) * tfScale(b, W.fieldUnits),

  // --- Rail Lance (stats: damage, rate, count, width, pierce) ----------------------------------------
  // A PRIMARY aimed weapon (js/rail-lance.js). While firing it charges for railCharge s, then fires a
  // hair-thin line along the aim that pierces every enemy (and every rock) to the screen edge, then vents
  // for the rest of its cycle. Each enemy behind the first takes railKeep of the hit before it. Capacitor
  // Bank (+RATE_STEP shots/s per rank), Split Rails (+1 lance per rank, fanned railSpread apart), Flux Lens
  // (a wider hit line; utility) and Penetrator Core (less lost per enemy pierced; utility). Potential counts
  // every lance on one target, like an Autocannon bolt.
  railCycle: (b) => 1 / rateMult(b.r.rate),       // s per shot at LV 1: 0.8 s charge + 0.2 s vent
  railChargeShare: 0.8,
  railCharge: (b) => W.railCycle(b) * W.railChargeShare,
  railLances: (b) => 1 + (b.r.count || 0),
  railSpread: 0.12,                               // rad between Split Rails lances
  railWidth: (b) => 6 * (1 + 0.5 * (b.r.width || 0)), // px half-width of the hit line (plus the enemy's hull); +6 px full width per Flux Lens (was +3.6)
  railKeep: (b) => Math.min(1, 0.8 + 0.04 * (b.r.pierce || 0)), // share carried past each enemy pierced
  railKnock: 1.6,
  // Transforms: Magnetic Rail (while charging, enemies within magnetRange of the aim line are dragged onto it
  // at magnetPull px/s, so each lance lines up more of a pack: valued at magnetHitShare lances), Ion Wake
  // (each lance leaves an ionized line for wakeLife s that ticks everything on it every wakeTick s, wakeShare
  // of a hit in all, valued at wakeHitShare: like a gas cloud, the line catches what walks into it),
  // Overload Shot (every overloadEvery-th shot is overloadWidth x as wide and hits overloadMult x as hard,
  // valued at overloadHitShare). The hit shares are measured in the card bench so each transform realizes
  // about BT_TRANSFORM_DPS (v0.44 playtest: valued as single hits, the three carried ~x2.2 instead of ~x1.8).
  magnetRange: 120,
  magnetPull: 110, // 150 before the playtest retune
  magnetHitShare: 1.3,
  wakeLife: 1.2,
  wakeTick: 0.2,
  wakeShare: 0.5,
  wakeHitShare: 1.25,
  overloadEvery: 3,
  overloadMult: 2,
  overloadWidth: 3,
  overloadHitShare: 1,
  railOverloadAvg: (b) => (b.t12 ? (W.overloadEvery - 1 + W.overloadMult * W.overloadHitShare) / W.overloadEvery : 1),
  railUnits: (b) => (b.t4 ? W.magnetHitShare : 1) * (1 + (b.t8 ? W.wakeShare * W.wakeHitShare : 0)) * W.railOverloadAvg(b),
  // Damage of one lance hit on the first enemy in its line (an Overload Shot hits overloadMult x this).
  railDamageMult: (b) => lv1Trim('raillance') * lv1('raillance', 'raillance', (b0) => DPS_TARGET(1) * W.railCycle(b0) / (W.railLances(b0) * W.railUnits(b0))) * hitMult(b) * tfScale(b, W.railUnits),
  // One Ion Wake tick on one enemy.
  railWakeDamageMult: (b) => W.railDamageMult(b) * W.wakeShare / (W.wakeLife / W.wakeTick),

  // --- Glaive Discs (stats: damage, count, chain, rate, speed) ------------------------------------
  // An autonomous kinetic weapon (js/glaive.js). Every throw interval the ship flings glaiveCount spinning
  // discs at the nearest enemies in glaiveThrowRange. A disc that hits ricochets to the nearest enemy it
  // has not just hit within glaiveRicochetRange (or swings back onto the same one when it is alone), up to
  // glaiveBounces ricochets, so one disc lands 1 + glaiveBounces hits. Rocks and the shields of plated
  // hulls bounce it too. Every bounce (enemy, rock or shield) sheds glaiveSpeedLoss of its speed; a disc
  // that slows under glaiveMinSpeedShare of its launch speed, or outlives glaiveLife, fades out.
  // Potential counts every ricochet as a full hit on one target (a disc only ricochets when it finds
  // one), so realized damage sits on the potential when enemies are about; the automatic class trim
  // (LV1_TRIM) is set from the card bench like the Drones' and Turret's.
  glaiveCount: (b) => 2 + (b.r.count || 0),
  glaiveBounces: (b) => 4 + (b.r.chain || 0),
  glaiveCooldown: (b) => 1.2 / (1 + rateStep('glaive') * (b.r.rate || 0)), // card steps trimmed like the Autocannon's (CARD_STEP_TRIM)
  glaiveSpeed: (b) => 560 * (1 + 0.12 * (b?.r?.speed || 0)), // px/s at launch
  glaiveSpeedLoss: 0.07,        // share of its speed a disc sheds per bounce
  glaiveMinSpeedShare: 0.4,     // ... and it fades once under this share of its launch speed
  glaiveLife: 3,                // s
  glaiveThrowRange: 520,
  glaiveRicochetRange: 300,
  glaiveRadius: 11,
  glaiveTurn: 9,                // rad/s the disc can steer toward its next ricochet target
  // Transforms: Fission Discs (a disc's first hit splits it into two twins that each carry the remaining
  // ricochets for fissionShare of the hit), Momentum Edge (bounces speed a disc up instead of slowing it
  // and every ricochet hits momentumGrowth x harder than the last, compounding), Boomerang Recall (a spent
  // disc swings back to the ship, slicing up to recallHits enemies on the way for recallShare each,
  // valued at recallHitShare: the way back only crosses enemies that sit on it).
  fissionShare: 0.6,
  momentumGrowth: 1.1,
  momentumSpeedGain: 0.06,
  momentumMaxSpeed: 1.6,        // x launch speed
  recallHits: 4,
  recallShare: 0.7,
  recallHitShare: 0.5,
  recallSpeed: 1.25,            // x launch speed on the way home
  // Hits one disc lands, in units of one plain hit.
  glaiveDiscUnits: (b) => {
    const n = W.glaiveBounces(b);
    let units = 1;
    for (let k = 1; k <= n; k++) units += (b.t4 ? 2 * W.fissionShare : 1) * (b.t8 ? W.momentumGrowth ** k : 1);
    if (b.t12) units += W.recallHits * W.recallShare * W.recallHitShare * (b.t4 ? 2 : 1);
    return units;
  },
  glaiveUnits: (b) => W.glaiveCount(b) * W.glaiveDiscUnits(b) / W.glaiveCooldown(b),
  // Damage of a plain disc hit (the first; ricochets scale it by their transform factors).
  glaiveDamageMult: (b) => lv1Trim('glaive') * lv1('glaive', 'glaive', (b0) => DPS_TARGET(1) / W.glaiveUnits(b0)) * hitMult(b) * tfScale(b, W.glaiveUnits),

  // --- Nanite Swarm (stats: damage, rate, radius, duration, cooldown) -------------------------------
  // A DEPLOYABLE (nanites.js): every naniteCooldown s a canister flies to the densest pack within
  // naniteRange and bursts into a swarm that drifts with that pack, eats it, grows naniteGrowPerKill per
  // kill (up to naniteGrowMax) and disperses after naniteLife s. Every naniteTick s each enemy inside ANY
  // swarm takes one bite (swarms never stack on one enemy) and a CORRODE stack (fixed element,
  // weapon-levels.js FIXED_ELEMENTS). Potential counts the swarms out on average (naniteUptime: lifetime
  // over launch interval, as a launch avoids packs a swarm already holds) each biting naniteHitShare
  // targets per tick: a swarm only eats what it reaches, so more and longer-lived swarms are POWER
  // (Fabricator, Endurance) and only swarm size is UTILITY.
  naniteRadius: (b) => 66 * (1 + 0.12 * (b?.r?.radius || 0)),
  naniteLife: (b) => 4 * (1 + 0.2 * (b?.r?.duration || 0)),
  naniteTick: (b) => 0.25 / rateMult(b.r.rate),
  naniteCooldown: (b) => 3 / rateMult(b.r.cooldown),
  naniteUptime: (b) => W.naniteLife(b) / W.naniteCooldown(b),
  naniteRange: 460,
  naniteSpeed: 420,   // canister flight, px/s
  naniteDrift: 60,    // px/s a swarm follows its pack
  naniteGrow: 0.3,    // s to swell in
  naniteFade: 0.6,    // s to disperse at the end
  naniteGrowPerKill: 0.04,
  naniteGrowMax: 1.25,
  // Set in the card bench against level-appropriate HP (LV 1 / 6 / 12 / 18 at waves 3 / 10 / 20 / 30): a
  // damage-built swarm deals about as much in total as the Autocannon (~90-115%, the area class), while each
  // swarm bite lands on ~3 enemies (so ~30% of it per target).
  naniteHitShare: 0.85,
  // Transforms: Fission Bloom (a swarm buds a daughter of fissionRadiusMult size and fissionLifeMult life
  // every fissionKills kills, up to fissionMax, that flies to the next pack: valued at fissionHitShare of
  // a swarm), Gray Goo (kills feed the swarm: +gooLifePerKill s of life (up to gooLifeMax) and growth up
  // to gooGrowMax: no extra attacks, so every bite hits BT_TRANSFORM_DPS harder), Nanite Plague (bitten
  // enemies stay infected plagueWindow s; one that dies to anything bursts into a plague swarm of
  // plagueRadiusMult size for plagueLife s, at most one per plagueEvery s and plagueMax alive: valued at
  // plagueHitShare of a swarm).
  fissionKills: 3,
  fissionMax: 3,
  fissionRadiusMult: 0.75,
  fissionLifeMult: 0.75,
  fissionHitShare: 0.6,
  gooLifePerKill: 0.12,
  gooLifeMax: 1.2,
  gooGrowMax: 1.55,
  plagueWindow: 3,
  plagueRadiusMult: 0.6,
  plagueLife: 1.8,
  plagueEvery: 0.2,
  plagueMax: 5,
  plagueHitShare: 0.8,
  naniteUnits: (b) => W.naniteHitShare + (b.t4 ? W.fissionHitShare : 0) + (b.t12 ? W.plagueHitShare : 0),
  // Damage of one bite to each enemy inside a swarm (daughters and plague swarms bite the same).
  naniteDamageMult: (b) => lv1('nanites', 'nanites', (b0) => DPS_TARGET(1) * W.naniteTick(b0) / (W.naniteUnits(b0) * W.naniteUptime(b0))) * hitMult(b) * tfScale(b, W.naniteUnits),

  // --- Claw Harpoon (stats: damage, rate, range, grapple, drill) -----------------------------------
  // Fires one drill claw on a tether along the turret aim while firing (js/claw-harpoon.js). The claw
  // flies out to harpoonRange, piercing every enemy on its line once (each one behind takes
  // TUNING.pierceFalloff of the last, like Autocannon bolts) and drilling through rock: it breaks rock
  // worth harpoonDrill rock HP per throw (x the ship's drill speed) and bites to a stop in the first rock
  // it can't break (bedrock always stops it). The first small enemy it hits (hull radius up to
  // harpoonHookSize, never a boss or lieutenant) is hooked and reeled back into your other claw, which
  // crushes it for harpoonCrushShare of a hit. One throw per harpoonCooldown: out, reel back, ready.
  // Potential counts the throw hit plus the crush on one target.
  harpoonCooldown: (b) => 0.45 / (1 + rateStep('harpoon') * (b.r.rate || 0)),
  harpoonRange: (b) => 330 + 40 * (b?.r?.range || 0),
  harpoonHookSize: (b) => 17 + 5 * (b?.r?.grapple || 0),
  harpoonDrill: (b) => 130 * (1 + 0.6 * (b?.r?.drill || 0)),
  harpoonTipRadius: 9,
  harpoonPierceKeep: 0.7, // damage kept past each enemy that survives the hit; a kill costs the claw no momentum
  harpoonCrushShare: 0.5,
  // Share of a throw's cycle spent flying out and reeling back (the rest is the claw back in its socket).
  // A faster winch (Rate cards) flies and reels faster; the reach (Range cards) never changes the cycle.
  harpoonOutShare: 0.36,
  harpoonBackShare: 0.36,
  // Transforms: Seismic Slam (every reel-in snaps your claws shut in a slamRadius blast at the nose worth
  // slamShare of a hit, valued at slamHitShare), Drill Spin (the claw spins in place at the end of each
  // throw for spinShare of the cycle, grinding everything round its tip spinTicks times for spinShare of
  // a hit in total, valued at spinHitShare; it drills rock there too), Chain Harpoon (from the end of
  // each throw the claw leaps on to up to chainLeaps more enemies within chainRange of the tip, piercing
  // each for chainShare of a hit, valued at chainHitShare, hooking one if it has no catch yet).
  slamShare: 0.45,
  slamRadius: 85,
  slamHitShare: 1.2, // the claws snap shut on whatever is pressing on your nose: a small pack
  spinShare: 0.6,
  spinTicks: 6,
  spinTime: 0.2, // share of the cycle the claw spins (taken from its idle time in the socket)
  spinRadius: 58,
  spinHitShare: 1.1,
  chainLeaps: 3,
  chainShare: 0.4,
  chainRange: 220,
  chainTime: 0.04, // share of the cycle each leap takes
  chainHitShare: 0.75, // a leap lands on whoever is near the tip, not always a fresh target: valued at this share
  harpoonUnits: (b) => 1 + W.harpoonCrushShare + (b.t4 ? W.slamShare * W.slamHitShare : 0)
    + (b.t8 ? W.spinShare * W.spinHitShare : 0) + (b.t12 ? W.chainLeaps * W.chainShare * W.chainHitShare : 0),
  // Damage of one throw hit on the first enemy on its line.
  harpoonDamageMult: (b) => lv1Trim('harpoon') * lv1('harpoon', 'harpoon', (b0) => DPS_TARGET(1) * W.harpoonCooldown(b0) / W.harpoonUnits(b0)) * hitMult(b) * tfScale(b, W.harpoonUnits),

  // --- Graviton Mortar, id quake (stats: damage, count, rate, radius, bore) -------------------------
  // Autonomous: every volley interval the mortar lobs `count` graviton charges at the densest packs within
  // quakeRange (quake-mortar.js). Each charge flies quakeFlight s, then bursts into a gravity wave that
  // rolls out to quakeRadius over quakeRingTime s: every enemy the front passes takes one hit (full at the
  // burst, quakeEdgeFalloff less at the rim) and is shoved outward, and every rock it passes takes
  // quakeRockDamage of mining damage, but only with Tidal Shear (stat `bore`, UTILITY): the base weapon
  // never mines (Clay). Only card ranks count, not Across the Board's free utility rank, so taking the
  // boost never turns mining on. Spacetime Fractures shatter rock on their own (faultRockDamage, plus any
  // Tidal Shear). Rocks broken either way count as mined. A wave is valued at one hit per target.
  quakeShells: (b) => 2 + b.r.count,
  quakeCooldown: (b) => 2.6 / rateMult(b.r.rate),
  quakeRadius: (b) => 120 * (1 + 0.12 * b.r.radius),
  // x the ship's mining speed / 75: 0 without Tidal Shear; a plain rock (~85 HP) takes 4 waves at 1 rank, 1 at 6.
  quakeRockDamage: (b) => {
    const r = Math.max(0, (b?.r?.bore || 0) - (b?.atb || 0));
    return r > 0 ? 25 * (1 + 0.5 * (r - 1)) : 0;
  },
  faultRockDamage: 45, // a fracture snapping shut shears any rock it crosses (x mining speed / 75), Tidal Shear adds to it
  quakeRange: 480,
  quakeFlight: 0.85,
  quakeRingTime: 0.5,
  quakeEdgeFalloff: 0.3,
  quakeKnock: 3.2,
  // Transforms: Rebound Pulse (a burst charge rebounds to the next pack skipBounces times, each rebound a
  // wave skipRadiusFrac the size for skipShare of the damage, valued at skipHitShare), Spacetime Fractures
  // (every main burst tears faultCount seams faultLengthMult x the wave radius long that snap shut
  // faultDelay s later for faultShare, valued at faultHitShare), Graviton Surge (every epicenterEvery-th
  // volley the hull releases a wave of epicenterRadiusMult x the radius for epicenterShare of a whole
  // volley, valued at epicenterHitShare: it lands on whatever is crowding the ship). The ids (skip, fault,
  // epicenter) are kept from the weapon's first theme.
  skipBounces: 2,
  skipShare: 0.5,
  skipRadiusFrac: 0.65,
  skipRange: 280,
  skipFlight: 0.4,
  skipHitShare: 0.3, // smaller rings landing after the main ring thinned the pack: card bench (realized ~ the boost)
  faultCount: 3,
  faultShare: 0.5,
  faultLengthMult: 1.9,
  faultWidth: 24,
  faultDelay: 0.35,
  faultHitShare: 0.15, // a thin line catches few enemies the ring missed: card bench (realized ~ the boost)
  epicenterEvery: 3,
  epicenterShare: 0.8,
  epicenterRadiusMult: 2,
  epicenterKnockMult: 2.2,
  epicenterHitShare: 1.7, // a ship-sized ring lands on the whole crowd closing in: card bench (realized ~ the boost)
  quakeUnits: (b) => 1 + (b.t4 ? W.skipBounces * W.skipShare * W.skipHitShare : 0) + (b.t8 ? W.faultCount * W.faultShare * W.faultHitShare : 0)
    + (b.t12 ? W.epicenterShare * W.epicenterHitShare / W.epicenterEvery : 0),
  // Damage of one quake ring (main impact) to each enemy it passes.
  quakeDamageMult: (b) => lv1Trim('quake') * lv1('quake', 'quake', (b0) => DPS_TARGET(1) * W.quakeCooldown(b0) / (W.quakeShells(b0) * W.quakeUnits(b0))) * hitMult(b) * tfScale(b, W.quakeUnits),

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

  // Elements (weapon-levels.js ELEMENT_CARDS): `lv` below is the rank of a weapon's element card (1-5).
  // STACKS (Deep Rock Galactic: Survivor style): every hit of an element weapon adds stacks of its status,
  // stacksPerDamage per base damage the hit deals times the element's potency (elementPotency(lv) x Status
  // Potency). Stacks are uncapped: every statusTick s they tick (damage, slow, freeze rolls, spreading),
  // then a fifth of them wears off (statusDecay); below statusMinStacks they are gone. So a stack is worth
  // 1 / statusDecay ticks, and a weapon's DoT is a fixed share of its own hit damage (statusDotShare).
  // Stacks follow damage (not a flat count per hit) so slow, heavy weapons and fast, light ones build
  // statuses at the same rate for the same damage.
  statusTick: 0.5,
  statusDecay: 0.2,
  statusMinStacks: 1,
  stacksPerDamage: 10,
  elementPotency: (lv) => 1 + 0.25 * (Math.max(1, lv) - 1),

  // BURN (FIRE): the strongest DoT. Each tick a burning enemy may set the nearest enemy within
  // burnSpreadReach of its hull alight with burnSpreadShare of its stacks.
  burnPerStack: 0.007, // x base damage per stack per tick (35% of a hit's damage as burn at rank 1)
  burnSpreadChance: 0.25,
  burnSpreadShare: 0.5,
  burnSpreadReach: 36,
  burnSpreadMinStacks: 5,

  // COLD (FROST): no damage. Cold stacks slow the target (up to chillSlow(lv) at the freeze threshold)
  // and every tick may FREEZE it (freezeTickChance x pressure^2, certain at full pressure). The threshold
  // is cold worth freezeHpShare of the target's max HP, so tough hulls take longer to freeze (bosses x
  // freezeResistBoss, lieutenants x freezeResistLieutenant). A frozen enemy stops dead and can't attack
  // for freezeDuration(lv) s and takes frozenDamageTaken more damage; then its cold is gone and it can't
  // freeze again for freezeImmunity s.
  chillSlow: (lv) => 0.3 + 0.05 * (Math.max(1, lv) - 1),
  freezeHpShare: 0.3,
  freezeTickChance: 0.35,
  freezeDuration: (lv) => 1.2 + 0.15 * (Math.max(1, lv) - 1),
  freezeImmunity: 1.5,
  freezeResistLieutenant: 1.5,
  freezeResistBoss: 3,
  frozenDamageTaken: 0.25,

  // CORRODE (CORROSIVE): a light DoT, and every stack makes the target take corrodeVulnPerStack more
  // damage from every source (DoTs included), up to corrodeCap(lv).
  corrodeDotPerStack: 0.0035,
  corrodeVulnPerStack: 0.004,
  corrodeCap: (lv) => 0.3 + 0.075 * (Math.max(1, lv) - 1),

  // SHOCK: every hit is a quick zap stun (shockStun(lv) s), or with chance shockLongChance(lv) a long
  // shockLongStun s stun. Stunned enemies stop moving and attacking; when a stun ends the enemy is
  // stun-immune for stunImmunity s, so nothing is stun-locked. Shock stacks only hurt while the target
  // touches another enemy (within shockTouchGap px, hull to hull): each tick it then takes its shock DoT
  // and CONDUCTS shockConductShare of its stacks into up to shockConductMax touching enemies with fewer,
  // zapping them too, so a packed swarm (a vortex's ball) lights up end to end. Shocked targets are
  // also easier to crit: +shockCritPerStack crit chance per stack, up to shockCritCap.
  // Bosses and lieutenants resist stuns (TUNING shockBossMult / shockLieutenantMult of the duration) and
  // shake stuns off for longer (stunImmunityBoss / stunImmunityLieutenant).
  shockDotPerStack: 0.0035,
  shockTouchGap: 6,
  shockConductShare: 0.35,
  shockConductMax: 4,
  shockConductMinStacks: 5,
  shockCritPerStack: 0.0015,
  shockCritCap: 0.2,
  shockStun: (lv) => 0.12 + 0.02 * (Math.max(1, lv) - 1),
  shockLongChance: (lv) => 0.2 + 0.03 * (Math.max(1, lv) - 1),
  shockLongStun: 1.2,
  stunImmunity: 0.75,
  stunImmunityLieutenant: 1.5,
  stunImmunityBoss: 3,
  shockLongChanceMax: 0.6,

  // Global status cards (upgrades.js, category STATUS). None of them raises a weapon's level.
  // Status Potency: +15% stacks per hit for every element.
  potencyStep: 0.15,
  // Status Reactions (id status_application): fire spreads +5% more often, the freeze threshold drops 8%,
  // +2% long-stun chance, +5% corrode cap per rank.
  applicationSpreadStep: 0.05,
  applicationFreezeStep: 0.08,
  applicationShockStep: 0.02,
  applicationCorrodeStep: 0.05,
  // Status Duration: stacks wear off 5% slower per rank (a fifth per tick -> 0.19, 0.18 ...; never below
  // half, so overcharged cards top out at twice the ticks), freezes last +10% and stuns +5% longer.
  durationStep: 0.05,
  durationFreezeStep: 0.1,
  durationStunStep: 0.05,
  // Shock Conductor: +4% long-stun chance, stuns +10% longer and +5% of the stacks conducted per rank.
  conductorChanceStep: 0.04,
  conductorDurationStep: 0.1,
  conductorShareStep: 0.05,
  // Element damage cards: weapons of that element hit +15% harder per rank, and their DoT ticks too.
  elementDamageStep: 0.15
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
    const chains = W.lightningChains(b) * W.lightningJumpUnits(b) * W.lightningDamageMult(b); // later jumps at lightningJumpShare
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
  turret: (b) => W.turretAverageActive(b) * W.turretFireRate(b) * W.turretDamageMult(b),
  drones: (b) => (W.droneDamageMult(b) + (W.droneCount(b) - 1) * W.droneWingDamageMult(b)) / W.droneDamageMult(b)
    * (W.droneFireRate(b) * W.droneDamageMult(b) + (b.t12 ? W.podDamageMult(b) / W.podEvery : 0)),
  grenades: (b) => {
    const blast = W.grenadeDamageMult(b);
    const bomblets = b.t4 ? W.grenadeClusterBomblets * W.grenadeClusterShare * W.grenadeClusterHitShare * blast : 0; // most hop onto other enemies
    const cloud = b.t8 ? W.cloudShare * blast : 0; // every cloud tick on one target
    return W.grenadeCount(b) * (blast + bomblets + cloud) * (b.t12 ? W.gravityHitShare : 1) / W.grenadeCooldown(b);
  },
  gas: (b) => (W.gasDamageMult(b) * W.gasHitShare + (b.t12 ? W.shroudDamageMult(b) * W.shroudHitShare : 0)) / W.gasTick(b)
    + (b.t8 ? W.pocketDamageMult(b) * W.pocketHitShare / W.pocketEvery : 0),
  flamethrower: (b) => {
    const stream = W.flameStreamDps(b) * W.flameHitShare * W.flameNozzleMult(b); // every nozzle
    const bursts = b.t4 ? W.flameBurstDamageMult(b) / W.flameBurstEvery * W.flameBurstHitShare * W.flameNozzleMult(b) : 0;
    const puddles = b.t8 ? W.flamePuddleDamageMult(b) * (W.flamePuddleLife / W.flamePuddleTick) / W.flamePuddleEvery * W.flamePuddleHitShare : 0;
    const ring = b.t12 ? W.flameRingDamageMult(b) / W.flameRingEvery * W.flameRingHitShare : 0;
    return stream + bursts + puddles + ring;
  },
  // The Cryo Sprayer and Acid Sprayer are the Flamethrower's twins: the same cone, numbers and
  // Breakthrough shapes (W.flame* formulas read only the build's ranks), with FROST / CORROSIVE built in.
  cryospray: (b) => POTENTIAL_DPS.flamethrower(b),
  acidspray: (b) => POTENTIAL_DPS.flamethrower(b),
  shockfield: (b) => {
    const d = W.fieldDamageMult(b);
    const discharge = W.fieldHitShare * d;
    const lash = b.t4 ? W.lashArcs * W.lashShare * W.lashHitShare * d : 0; // arcs at their hit share
    const clap = b.t12 ? discharge * W.overchargeShare * W.overchargeHitShare / W.overchargeStore : 0; // one per overchargeStore discharges
    return (discharge + lash + clap) / W.fieldCooldown(b);
  },
  raillance: (b) => W.railLances(b) * W.railDamageMult(b) * W.railUnits(b) / W.railCycle(b),
  glaive: (b) => W.glaiveUnits(b) * W.glaiveDamageMult(b),
  nanites: (b) => W.naniteDamageMult(b) * W.naniteUnits(b) * W.naniteUptime(b) / W.naniteTick(b),
  harpoon: (b) => W.harpoonUnits(b) * W.harpoonDamageMult(b) / W.harpoonCooldown(b),
  // One volley: every charge's wave, rebounds and fractures, plus its share of the Graviton Surge.
  quake: (b) => W.quakeShells(b) * W.quakeDamageMult(b) * W.quakeUnits(b) / W.quakeCooldown(b)
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
  grenade: ['projectile', 'explosive', 'area'],
  gas: ['area', 'corrode'],
  flame: ['area', 'burn'],
  cryo: ['area', 'chill'],
  acid: ['area', 'corrode'],
  shockfield: ['electric', 'area'],
  rail: ['kinetic'],
  glaive: ['projectile', 'kinetic'],
  nanite: ['deployable', 'area', 'corrode'],
  harpoon: ['projectile', 'kinetic'],
  quake: ['explosive', 'area']
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
  shock: { label: 'SHOCK', color: '#f4ff52' },
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
  drone: 'drones', siege: 'turret', grenade: 'grenades', gas: 'gas', flame: 'flamethrower', cryo: 'cryospray', acid: 'acidspray', shockfield: 'shockfield',
  rail: 'raillance', glaive: 'glaive',
  nanite: 'nanites',
  harpoon: 'harpoon',
  quake: 'quake'
};

// A build for `weapon`: the one given, a level-only build for a number (Storm Protocol's chain), or
// the player's own build of that weapon.
export function sourceBuild(p, weapon, b) {
  if (b && typeof b === 'object') return b;
  const id = SOURCE_WEAPON[weapon];
  if (typeof b === 'number') return levelBuild(id, b);
  return weaponBuild(p, id);
}

// Base damage of every weapon: the damage stat times the slot reward for weapons equipped (slot-rewards.js).
export const baseDamage = (p) => p.stats.damage * loadoutDamageMult(p);

// Per-hit damage (before crits and status modifiers) for every weapon. `b` is the weapon's build (or
// a level number for a build without stat ranks; omitted = the player's own build).
export function weaponDamage(p, weapon, b) {
  const d = baseDamage(p);
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
    case 'gas': base = d * W.gasDamageMult(sourceBuild(p, weapon, b)); break;
    case 'flame': case 'cryo': case 'acid': base = d * W.flameDamageMult(sourceBuild(p, weapon, b)); break;
    case 'shockfield': base = d * W.fieldDamageMult(sourceBuild(p, weapon, b)); break;
    case 'rail': base = d * W.railDamageMult(sourceBuild(p, weapon, b)); break;
    case 'glaive': base = d * W.glaiveDamageMult(sourceBuild(p, weapon, b)); break;
    case 'nanite': base = d * W.naniteDamageMult(sourceBuild(p, weapon, b)); break;
    case 'harpoon': base = d * W.harpoonDamageMult(sourceBuild(p, weapon, b)); break;
    case 'quake': base = d * W.quakeDamageMult(sourceBuild(p, weapon, b)); break;
    default: return d;
  }
  return base * tagDamageMult(p, weapon) * elementDamageMult(p, sourceElement(p, weapon));
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
export const gasCloudRadius = (p, b = weaponBuild(p, 'gas')) => W.gasRadius(b) * areaMult(p);
export const flameRange = (p, b = weaponBuild(p, 'flamethrower')) => W.flameRange(b) * areaMult(p);
export const fieldRadius = (p, b = weaponBuild(p, 'shockfield')) => W.fieldRadius(b) * areaMult(p);
export const naniteRadius = (p, b = weaponBuild(p, 'nanites')) => W.naniteRadius(b) * areaMult(p);
export const quakeRadius = (p, b = weaponBuild(p, 'quake')) => W.quakeRadius(b) * areaMult(p);

// Crits. A player without crit stats never crits (test fixtures); resetRun seeds the tuned base.
export const critChance = (p) => Math.min(1, p.stats.critChance ?? 0);
export const critDamage = (p) => p.stats.critDamage ?? (TUNING.baseCritDamage ?? 1.5);
export function critMultiplier(p, afflicted = false) {
  const cd = critDamage(p);
  return afflicted && p.weapons.supercritical ? 1 + (cd - 1) * W.supercritBonusMult : cd;
}

// --- Elements and status effects -------------------------------------------------------------------
// Numbers at a weapon's element rank `lv`, including the tuner multipliers and the global STATUS cards
// (player.stats: statusPotency / statusApplication / statusDuration / shockConductor ranks and
// elementDamage multipliers). `p` may be omitted for the bare card numbers.
const rk = (p, key) => p?.stats?.[key] || 0;
export const statusPotency = (p) => 1 + W.potencyStep * rk(p, 'statusPotency');
// Weapons of `element` deal this multiple of their damage (Element damage cards).
export const elementDamageMult = (p, element) => (element ? p?.stats?.elementDamage?.[element] ?? 1 : 1);
// Element of the weapon a damage source belongs to, or null ('helix' -> blaster's, 'rocket' -> rockets'...).
export function sourceElement(p, source) {
  const id = SOURCE_WEAPON[source];
  if (id && FIXED_ELEMENTS[id]) return FIXED_ELEMENTS[id];
  const keys = id && ELEMENT_KEYS[id];
  const w = p?.weapons;
  if (!keys || !w) return null;
  for (let i = 0; i < keys.length; i++) if (w[keys[i]] > 0) return ELEMENTS[i];
  return null;
}

// Stacks one hit adds: per base damage dealt, times the element rank's potency and Status Potency.
export const stacksPerBaseDamage = (p, lv) => W.stacksPerDamage * W.elementPotency(lv) * statusPotency(p);
export const stacksForHit = (p, lv, dmg) => (dmg > 0 ? (dmg / Math.max(1e-9, baseDamage(p))) * stacksPerBaseDamage(p, lv) : 0);
// Share of the stacks that wear off every tick (Status Duration slows it), and the ticks one stack lives
// on average (1 / decay: the first tick lands before any decay).
export const statusDecay = (p) => W.statusDecay * Math.max(0.5, 1 - W.durationStep * rk(p, 'statusDuration'));
// DoT per stack per tick, x base damage applied by the caller (status-effects.js multiplies by baseDamage).
const DOT_PER_STACK = { fire: () => W.burnPerStack, corrode: () => W.corrodeDotPerStack, shock: () => W.shockDotPerStack };
const DOT_TUNING = { fire: 'burnDamageMult', corrode: 'corrodeMult', shock: null };
export const dotPerStack = (p, element) => (DOT_PER_STACK[element] ? baseDamage(p) * DOT_PER_STACK[element]()
  * (DOT_TUNING[element] ? TUNING[DOT_TUNING[element]] ?? 1 : 1) * elementDamageMult(p, element) : 0);
// Share of a hit's damage that comes back later as its element's DoT (burn, acid, or shock while touching).
export const statusDotShare = (p, element, lv) => (DOT_PER_STACK[element] ? stacksPerBaseDamage(p, lv) * DOT_PER_STACK[element]()
  * (DOT_TUNING[element] ? TUNING[DOT_TUNING[element]] ?? 1 : 1) * elementDamageMult(p, element) / statusDecay(p) : 0);
// Kept for card previews written against the old burn model: burn damage per second a stack deals.
export const burnStackDps = (p) => dotPerStack(p, 'fire') / W.statusTick;
export const burnSpreadChance = (p) => Math.min(1, W.burnSpreadChance + W.applicationSpreadStep * rk(p, 'statusApplication'));
// FROST: slow at the freeze threshold, the threshold in stacks for an enemy, and how long a freeze lasts.
export const chillSlow = (lv, isBoss = false, p = null) =>
  Math.min(0.9, W.chillSlow(lv) * (TUNING.chillSlowMult ?? 1)) * (isBoss ? (TUNING.chillBossMult ?? 0.4) : 1);
export const freezeResist = (e) => (e?.isBoss ? W.freezeResistBoss : e?.isLieutenant ? W.freezeResistLieutenant : 1);
export const freezeShare = (p) => W.freezeHpShare * Math.max(0.2, 1 - W.applicationFreezeStep * rk(p, 'statusApplication'));
export const freezeThreshold = (p, e) => Math.max(W.statusMinStacks, freezeShare(p) * ((e?.maxHp || 1) / Math.max(1e-9, baseDamage(p))) * W.stacksPerDamage * freezeResist(e));
export const freezeDuration = (p, lv) => W.freezeDuration(lv) * (1 + W.durationFreezeStep * rk(p, 'statusDuration'));
// CORRODE: damage taken per stack and the cap at a rank.
export const corrodeVulnPerStack = () => W.corrodeVulnPerStack * (TUNING.corrodeMult ?? 1);
export const corrodeCap = (p, lv) => W.corrodeCap(lv) + W.applicationCorrodeStep * rk(p, 'statusApplication');
// SHOCK: share of the stacks conducted into touching enemies each tick.
export const shockConductShare = (p) => Math.min(0.9, W.shockConductShare + W.conductorShareStep * rk(p, 'shockConductor'));
// Stun lengths (before boss / lieutenant resistance) and the long-stun chance.
export const stunDurationMult = (p) => 1 + W.durationStunStep * rk(p, 'statusDuration') + W.conductorDurationStep * rk(p, 'shockConductor');
export const shockStun = (p, lv) => W.shockStun(lv) * stunDurationMult(p);
export const shockLongStun = (p) => W.shockLongStun * stunDurationMult(p);
export const shockLongChance = (p, lv) => Math.min(W.shockLongChanceMax, W.shockLongChance(lv)
  + W.applicationShockStep * rk(p, 'statusApplication') + W.conductorChanceStep * rk(p, 'shockConductor'));
// Share of a stun (and of a freeze) an elite keeps (bosses barely feel it) and how long it then shrugs stuns off.
export const stunResist = (e) => (e?.isBoss ? TUNING.shockBossMult ?? 0.2 : e?.isLieutenant ? TUNING.shockLieutenantMult ?? 0.5 : 1);
export const stunImmunity = (e) => (e?.isBoss ? W.stunImmunityBoss : e?.isLieutenant ? W.stunImmunityLieutenant : W.stunImmunity);
