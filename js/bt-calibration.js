// Breakthrough calibration (card bench). The potential model holds every transform at exactly
// BT_TRANSFORM_DPS, but what a transform *realizes* in a fight depends on how its extra attacks land
// (overkill, splash on packs, misses), so some realized far more than Across the Board and some far less,
// which made the pick in a 3-card Breakthrough hand obvious.
//
// TF_REALIZED[weapon][transform] = [LV 6, LV 12, LV 18]: how much more a transform realizes than the model
// credits it with, measured on the reference bench (`node tools/balance/bt-bench.mjs --bench real --seeds 6`: a
// chasing swarm as dense round the ship as in real runs, targets at the wave a weapon reaches that level). A weapon with that transform
// hits 1 / value as hard (all its damage, so the transform's mechanics are untouched), and its potential
// DPS counts the value back in, so the potential model still adds exactly BT_TRANSFORM_DPS. Between
// milestones the value is interpolated on the weapon level (clamped outside LV 6-18). Values stay within
// BT_REALIZED_RANGE so a transform's single-target (boss) damage never moves more than that.
//
// Target: each transform realizes BT_BENCH_BAND x Across the Board at each milestone (earlier milestones
// Across the Board). Transforms that trade damage for control (BT_CONTROL) may sit lower. The sprayers
// sit a little under Across the Board (BT_SPRAYER_BAND): their realized damage is capped by how many
// targets the cone reaches, so Across the Board's free Turn / Range ranks outvalue any damage number.
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
  cryospray: ['shatter', 'slicks', 'blizzard'], acidspray: ['caustic'], quake: ['epicenter']
});

export const TF_REALIZED = {
  blaster: { flak: [0.62, 1, 1], ricochet: [0.66, 1, 1], arc: [0.6, 0.9, 0.89], slug: [0.9, 0.93, 1], hotbarrel: [0.6, 1, 1] },
  rockets: { tandem: [1, 1, 1], napalm: [1, 1, 1], mirv: [1, 1, 1], shrapnel: [0.81, 0.94, 0.85], thunder: [0.69, 0.69, 0.81] },
  missiles: { cluster: [1, 1, 0.67], rain: [0.82, 1, 0.78], nuke: [1, 0.73, 0.68], hunter: [0.72, 1, 0.79], echo: [0.92, 1, 0.62] },
  lightning: { fork: [1.7, 1.7, 1.57], orb: [1.23, 1.7, 1], strike: [1.7, 1.7, 1] },
  singularity: { twin: [1.7, 1, 1], aftershock: [0.85, 0.6, 0.88], cascade: [0.73, 0.6, 0.75] },
  orbitals: { counter: [0.87, 1, 0.92], fling: [0.6, 0.75, 0.64], nova: [0.6, 1, 0.6] },
  mines: { cluster: [1, 1, 0.6], seeker: [1, 1, 1], triad: [1, 1.61, 1] },
  turret: { capacity: [0.6, 0.6, 0.78], mobile: [0.72, 0.8, 0.75], overload: [0.66, 0.66, 0.94] },
  drones: { wingman: [1.12, 1.49, 1], homing: [0.89, 1, 1], pods: [1, 1, 0.82] },
  grenades: { cluster: [1, 1.42, 1], cloud: [0.6, 0.63, 0.6], gravity: [1, 1.7, 1.45] },
  gas: { seek: [0.6, 0.6, 0.6], pockets: [0.6, 0.6, 0.6], shroud: [0.6, 0.6, 0.6] },
  flamethrower: { fireballs: [0.6, 0.6, 0.6], napalm: [0.6, 0.6, 0.6], ring: [1.06, 1.7, 1.53] },
  cryospray: { shatter: [0.6, 0.6, 0.6], slicks: [0.6, 0.6, 0.6], blizzard: [0.77, 1.4, 1.07] },
  acidspray: { meltdown: [0.6, 0.6, 0.6], pools: [0.6, 0.6, 0.6], caustic: [1, 1.7, 1.05] },
  shockfield: { lash: [1, 1, 1], repulse: [1, 1, 1], overcharge: [1, 1, 1] },
  raillance: { magnet: [1, 1, 1], wake: [1, 1, 1], overload: [0.6, 1, 1] },
  glaive: { fission: [1, 1.13, 1], momentum: [0.84, 0.87, 0.92], recall: [1, 1, 1] },
  nanites: { fission: [0.6, 0.79, 1], goo: [0.6, 1, 1], plague: [0.6, 0.6, 0.83] },
  harpoon: { slam: [1, 1, 0.78], spin: [0.89, 1, 0.84], chain: [0.86, 1, 0.6] },
  quake: { skip: [0.79, 0.6, 0.72], fault: [0.92, 0.65, 0.75], epicenter: [1, 0.95, 0.95] }
};

// Cases outside their band that damage numbers can't fix (the bench barely moves when their damage does,
// or the fix would cost more boss damage than BT_REALIZED_RANGE allows): flagged for a mechanics pass.
const SPRAYER_REACH = 'sprayer reach: realized capped by the cone, not damage (sprayer pass)';
export const BT_BENCH_EXEMPT = Object.freeze({
  'lightning|fork|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'lightning|orb|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'lightning|strike|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'singularity|cascade|12': 'damage-insensitive in the bench',
  'orbitals|fling|12': 'damage-insensitive in the bench',
  'orbitals|nova|12': 'damage-insensitive in the bench',
  'orbitals|nova|18': 'damage-insensitive in the bench',
  'singularity|cascade|6': 'damage-insensitive on the reference bench (at the BT_REALIZED_RANGE floor)',
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
  ...Object.fromEntries(['flamethrower|fireballs|6', 'flamethrower|fireballs|12', 'flamethrower|fireballs|18', 'flamethrower|napalm|6',
    'flamethrower|napalm|12', 'flamethrower|napalm|18', 'cryospray|shatter|6', 'cryospray|shatter|12', 'cryospray|slicks|6', 'cryospray|slicks|12',
    'cryospray|slicks|18', 'acidspray|meltdown|6', 'acidspray|meltdown|18', 'acidspray|pools|6', 'acidspray|pools|18'].map((k) => [k, SPRAYER_REACH])),
  'flamethrower|ring|12': 'a hair over the sprayer band at BT_REALIZED_RANGE (the ring hits the whole pack)',
  'acidspray|caustic|12': 'a hair over the sprayer band at BT_REALIZED_RANGE (the ring hits the whole pack)',
  'shockfield|repulse|6': 'knockback (control); a discharge kills everything inside: damage-insensitive',
  'shockfield|repulse|12': 'knockback (control); a discharge kills everything inside: damage-insensitive',
  'raillance|overload|12': 'damage-insensitive in the bench (one lance already kills)',
  'raillance|overload|18': 'damage-insensitive in the bench (one lance already kills)'
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
