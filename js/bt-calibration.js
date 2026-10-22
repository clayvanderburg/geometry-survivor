// Breakthrough calibration (card bench). The potential model holds every transform at exactly
// BT_TRANSFORM_DPS, but what a transform *realizes* in a fight depends on how its extra attacks land
// (overkill, splash on packs, misses), so some realized far more than Across the Board and some far less,
// which made the pick in a 3-card Breakthrough hand obvious.
//
// TF_REALIZED[weapon][transform] = [LV 6, LV 12, LV 18]: how much more a transform realizes than the model
// credits it with, measured on the blend bench (`node tools/balance/bt-bench.mjs --seeds 6`): the geometric mean
// of two chasing swarms as dense round the ship as in real runs, one chasing a bot-like tight loop (`real`),
// one a human-like wide kite (`kite`), so no option is an outlier under either play style; targets at the
// wave a weapon reaches that level. A weapon with that transform hits 1 / value as hard (all its damage, so the transform's mechanics are untouched), and its potential
// DPS counts the value back in, so the potential model still adds exactly BT_TRANSFORM_DPS. Between
// milestones the value is interpolated on the weapon level (clamped outside LV 6-18). Values stay within
// BT_REALIZED_RANGE so a transform's single-target (boss) damage never moves more than that.
//
// Target: each transform realizes BT_BENCH_BAND x Across the Board at each milestone (earlier milestones
// Across the Board). Transforms that trade damage for control (BT_CONTROL) may sit lower. The sprayers
// sit a little under Across the Board (BT_SPRAYER_BAND): their realized damage rides on how fast the cone
// sweeps the swarm, so Across the Board's free Spin Rotor rank outvalues any damage number; the LV 6 burst
// and puddle transforms build in a Spin Rotor rank to match (W.flameTfTurnRanks).
// BT_BENCH_EXEMPT lists the (weapon, transform, milestone) cases damage numbers can't bring into band.
// The Electric Shield Field is defensive (CLASS_TARGET.defensive): it sits lower by design, and its
// discharge kills everything inside, so its options barely move with damage; they stay at 1.
// Every transform in every pool needs an entry here (tests/bt-calibration.test.js): bench new ones first.
export const BT_BENCH_BAND = Object.freeze([1.05, 1.3]);
export const BT_CONTROL_BAND = Object.freeze([0.95, 1.3]);
export const BT_SPRAYER_BAND = Object.freeze([0.85, 1.0]);
export const BT_REALIZED_RANGE = Object.freeze([0.6, 1.7]);
export const BT_SPRAYERS = Object.freeze(['flamethrower', 'cryospray', 'acidspray']);
export const BT_CONTROL = Object.freeze({
  shockfield: ['lash', 'repulse'], raillance: ['magnet'], grenades: ['gravity'], flamethrower: ['ring'],
  cryospray: ['shatter', 'slicks', 'blizzard'], acidspray: ['caustic'], quake: ['epicenter', 'lens'], mines: ['shock'], orbitals: ['vortex']
});

export const TF_REALIZED = {
  blaster: { flak: [0.62, 1, 1], ricochet: [0.66, 0.93, 1], arc: [0.6, 0.9, 0.89], slug: [0.9, 0.93, 1], hotbarrel: [0.6, 1, 1] },
  rockets: { tandem: [1, 1, 1], napalm: [1, 1, 1], mirv: [1.08, 1.24, 1.17], shrapnel: [0.81, 0.88, 0.85], thunder: [0.69, 0.63, 0.81] },
  missiles: { cluster: [1, 1, 0.67], rain: [0.82, 0.77, 0.78], nuke: [0.64, 0.73, 0.68], hunter: [1, 1, 0.79], echo: [0.92, 1, 0.6] },
  lightning: { fork: [1, 1.7, 1], orb: [1, 1.1, 1], strike: [1, 1, 1], lattice: [1, 1.1, 1], conductor: [1.1, 1.7, 1.1] },
  singularity: { twin: [1.7, 1, 1], aftershock: [0.85, 0.6, 0.88], cascade: [0.6, 0.6, 0.75], accretion: [0.66, 0.6, 0.65], whitehole: [0.95, 0.6, 1.15] },
  orbitals: { counter: [1, 1, 1], fling: [0.6, 0.75, 0.64], nova: [0.6, 0.6, 0.6], frenzy: [0.8, 0.7, 0.85], vortex: [1.25, 1.3, 1.3] },
  mines: { cluster: [1, 1, 0.6], seeker: [1, 1, 0.66], triad: [1.67, 1.61, 1.53], shock: [0.85, 0.8, 0.62], napalm: [1, 1.7, 0.7] },
  turret: { capacity: [0.6, 0.6, 0.78], mobile: [0.9, 1, 1], overload: [0.66, 0.66, 0.79], gift: [0.6, 0.6, 0.75], link: [0.6, 0.62, 0.78] },
  drones: { wingman: [1.12, 1.49, 1.15], homing: [1, 1, 1], pods: [1, 1, 0.82], overdrive: [1, 0.88, 0.92], kamikaze: [1.1, 0.75, 0.75] },
  grenades: { cluster: [1, 1.42, 1], cloud: [0.6, 0.69, 0.6], gravity: [1.58, 1.7, 1.45], sticky: [0.6, 0.75, 0.62], geyser: [0.95, 1.15, 0.85] },
  gas: { seek: [0.6, 0.6, 0.6], pockets: [0.6, 0.6, 0.6], shroud: [0.6, 0.6, 0.6], tendrils: [0.75, 0.75, 0.75], spores: [0.65, 0.6, 0.62] },
  flamethrower: { fireballs: [0.91, 1, 0.68], napalm: [0.6, 0.64, 0.6], ring: [1, 1.7, 1.53], whirl: [0.85, 0.8, 0.7], seeker: [1.15, 0.95, 0.85] },
  cryospray: { shatter: [0.62, 0.82, 0.6], slicks: [0.6, 0.62, 0.6], blizzard: [0.71, 1, 0.95], whirl: [0.85, 0.7, 0.65], seeker: [1, 1, 1] },
  acidspray: { meltdown: [0.73, 0.83, 0.6], pools: [0.6, 0.87, 0.6], caustic: [1, 1.7, 1.4], whirl: [0.8, 1, 0.65], seeker: [0.9, 1, 0.8] },
  shockfield: { lash: [1, 1, 1], repulse: [1, 1, 1], overcharge: [1, 1, 1], pulse: [1, 1, 1], capacitor: [1, 1, 1] },
  raillance: { magnet: [1, 1, 1], wake: [1, 1.16, 1], overload: [0.6, 1, 1], static: [1.2, 1.45, 1], reflect: [1.1, 1, 1] },
  glaive: { fission: [1, 1.13, 1], momentum: [0.84, 0.87, 0.9], recall: [1, 1, 1], shatter: [1, 1, 1], arcdisc: [0.85, 1, 1] },
  nanites: { fission: [0.6, 0.79, 0.85], goo: [0.6, 0.66, 0.7], plague: [0.6, 0.6, 0.6], needles: [0.8, 0.7, 0.62], ravenous: [0.72, 0.68, 0.7] },
  harpoon: { slam: [0.93, 1, 0.78], spin: [0.89, 1, 0.92], chain: [1, 1.26, 0.6], whip: [1, 1, 1], tesla: [1, 1.12, 0.85] },
  quake: { skip: [0.79, 0.6, 0.72], fault: [1, 0.65, 0.75], epicenter: [1, 0.95, 0.95], crush: [0.8, 0.6, 0.72], lens: [0.9, 0.85, 0.85] }
};

// Cases outside their band that damage numbers can't fix (the bench barely moves when their damage does,
// or the fix would cost more boss damage than BT_REALIZED_RANGE allows): flagged for a mechanics pass.
const SPRAYER_REACH = 'puddles land where the cone already was: realized capped by reach, not damage (at the BT_REALIZED_RANGE floor)';
export const BT_BENCH_EXEMPT = Object.freeze({
  'singularity|cascade|12': 'damage-insensitive in the bench',
  'orbitals|fling|12': 'damage-insensitive in the bench',
  'orbitals|nova|12': 'damage-insensitive in the bench',
  'orbitals|nova|18': 'damage-insensitive in the bench',
  'mines|seeker|6': 'damage-insensitive: the mines crawl onto enemies, so more damage per blast changes little',
  'mines|seeker|18': 'damage-insensitive: the mines crawl onto enemies, so more damage per blast changes little',
  'nanites|plague|6': 'plague swarms need kills to spread; at the BT_REALIZED_RANGE floor',
  'nanites|plague|12': 'plague swarms need kills to spread; at the BT_REALIZED_RANGE floor',
  'mines|triad|12': 'three mines cover three times the ground: hit count, not damage',
  'gas|seek|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|seek|12': 'damage-insensitive in the bench',
  'gas|pockets|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|pockets|12': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|pockets|18': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|12': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|18': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  ...Object.fromEntries(['cryospray|slicks|18', 'acidspray|meltdown|18'].map((k) => [k, SPRAYER_REACH])),
  // Defensive by design (CLASS_TARGET.defensive): under kiting its Across the Board baseline is tiny, so every
  // ratio swings; its options stay at 1.
  ...Object.fromEntries(['lash', 'repulse', 'overcharge', 'pulse', 'capacitor'].flatMap((t) => [6, 12, 18].map((m) => [`shockfield|${t}|${m}`, 'defensive class: discharges kill everything inside the field, so damage barely matters']))),
  'grenades|gravity|12': 'the pull packs the crowd into every blast (control); capped at BT_REALIZED_RANGE',
  'mines|seeker|12': 'damage-insensitive: the mines crawl onto enemies, so more damage per blast changes little',
  'mines|cluster|18': 'damage-insensitive in the bench',
  'raillance|overload|6': 'damage-insensitive in the bench (one lance already kills)',
  'nanites|fission|6': 'daughter swarms need kills to bud: damage-insensitive at LV 6',
  'acidspray|caustic|12': 'a hair over the sprayer band at BT_REALIZED_RANGE (the ring hits the whole pack)',
  'raillance|overload|12': 'damage-insensitive in the bench (one lance already kills)',
  'raillance|overload|18': 'damage-insensitive in the bench (one lance already kills)',
  'gas|spores|18': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|spores|12': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'orbitals|frenzy|12': 'damage-insensitive at LV 12 like fling and nova (blades grind everything they touch)',
  'mines|napalm|12': 'the pool holds the trailing pack at LV 12 (like triad 12): over the band at the BT_REALIZED_RANGE cap',
  'quake|crush|12': 'damage-insensitive at LV 12 at the BT_REALIZED_RANGE floor (skip and fault sit there too)',
});

const MILESTONES = [6, 12, 18];
// Realized-value correction of one transform at weapon level `lv`.
export function tfRealizedAt(weapon, tf, lv) {
  const v = TF_REALIZED[weapon]?.[tf];
  if (!v) return 1;
  if (lv <= MILESTONES[0]) return v[0];
  if (lv >= MILESTONES[2]) return v[2];
  const i = lv < MILESTONES[1] ? 0 : 1;
  const t = (lv - MILESTONES[i]) / (MILESTONES[i + 1] - MILESTONES[i]);
  return v[i] + (v[i + 1] - v[i]) * t;
}

// Correction of a whole build (every installed transform).
export function tfRealized(b) {
  let v = 1;
  for (const t of b.tf || []) v *= tfRealizedAt(b.id, t, b.lv);
  return v;
}
