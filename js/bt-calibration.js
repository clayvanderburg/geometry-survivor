// Breakthrough calibration (card bench). The potential model holds every transform at exactly
// BT_TRANSFORM_DPS, but what a transform *realizes* in a fight depends on how its extra attacks land
// (overkill, splash on packs, misses), so some realized far more than Across the Board and some far less,
// which made the pick in a 3-card Breakthrough hand obvious.
//
// TF_REALIZED[weapon][transform] = [LV 6, LV 12, LV 18]: how much more a transform realizes than the model
// credits it with, measured in the card bench (tools/balance/bt-bench.mjs). A weapon with that transform
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
// Every transform in every pool needs an entry here (tests/bt-calibration.test.js): bench new ones first.
export const BT_BENCH_BAND = Object.freeze([1.05, 1.3]);
export const BT_CONTROL_BAND = Object.freeze([0.95, 1.3]);
export const BT_SPRAYER_BAND = Object.freeze([0.85, 1.0]);
export const BT_REALIZED_RANGE = Object.freeze([0.6, 1.7]);
export const BT_SPRAYERS = Object.freeze(['flamethrower', 'cryospray', 'acidspray']);
export const BT_CONTROL = Object.freeze({
  shockfield: ['lash', 'repulse'], raillance: ['magnet'], grenades: ['gravity'], flamethrower: ['ring'],
  cryospray: ['shatter', 'slicks', 'blizzard'], acidspray: ['caustic'], quake: ['epicenter', 'lens']
});

export const TF_REALIZED = {
  blaster: { flak: [0.75, 1, 1], ricochet: [0.66, 1, 1], arc: [0.6, 1, 1], slug: [0.9, 1, 1], hotbarrel: [0.6, 1, 1] },
  rockets: { tandem: [1, 1, 1], napalm: [1, 1, 1], mirv: [1, 1, 1.09], shrapnel: [0.81, 0.94, 0.85], thunder: [0.69, 0.69, 0.81] },
  missiles: { cluster: [1, 1.12, 1], rain: [1, 1, 1], nuke: [1, 0.73, 1], hunter: [0.72, 1, 0.79], echo: [0.92, 1, 0.62] },
  lightning: { fork: [1.7, 1, 1.57], orb: [1.23, 1, 1], strike: [1.7, 1, 1.24] },
  singularity: { twin: [1.7, 1, 1], aftershock: [0.85, 1, 1], cascade: [0.73, 1, 0.83] },
  orbitals: { counter: [0.94, 1, 1], fling: [0.69, 1, 0.74], nova: [0.6, 1, 1] },
  mines: { cluster: [1, 0.95, 1], seeker: [1, 1, 1], triad: [1.15, 1, 1] },
  turret: { capacity: [1, 1, 1], mobile: [0.72, 0.8, 0.75], overload: [0.66, 1, 1], gift: [0.65, 0.64, 0.8], link: [0.7, 0.64, 0.8] },
  drones: { wingman: [1.24, 1.49, 1.16], homing: [1, 1, 1], pods: [1, 1, 1], overdrive: [1, 0.88, 0.92], kamikaze: [1.3, 0.88, 0.88] },
  grenades: { cluster: [1.1, 1.42, 1], cloud: [0.69, 0.63, 0.69], gravity: [1, 1.7, 1.45] },
  gas: { seek: [0.6, 1, 1], pockets: [0.6, 0.6, 0.6], shroud: [0.6, 0.6, 0.6] },
  flamethrower: { fireballs: [0.6, 0.6, 0.6], napalm: [0.6, 0.6, 0.6], ring: [1, 1.7, 1] },
  cryospray: { shatter: [0.6, 0.6, 0.6], slicks: [0.6, 0.6, 0.6], blizzard: [0.73, 1.4, 0.91] },
  acidspray: { meltdown: [0.6, 0.6, 0.6], pools: [0.6, 0.6, 0.6], caustic: [1, 1.7, 1] },
  shockfield: { lash: [1, 1, 1], repulse: [1, 1, 1], overcharge: [1, 1, 1] },
  raillance: { magnet: [1.69, 1.25, 1], wake: [1, 1.19, 1], overload: [1, 1, 1], static: [1.2, 1.3, 1], reflect: [1.25, 1, 1] },
  glaive: { fission: [1, 1.13, 1], momentum: [0.84, 0.87, 0.92], recall: [1, 1, 1], shatter: [1, 1, 1], arcdisc: [0.85, 1, 1] },
  nanites: { fission: [1, 1.39, 1.69], goo: [1, 1, 1], plague: [0.6, 0.65, 0.83] },
  harpoon: { slam: [1, 1, 0.78], spin: [0.89, 1, 0.84], chain: [0.86, 1, 0.6], whip: [1, 1, 1], tesla: [1, 1.12, 0.85] },
  quake: { skip: [0.79, 1, 0.72], fault: [0.92, 0.8, 0.82], epicenter: [1, 0.95, 0.95], crush: [0.8, 0.68, 0.72], lens: [1, 1, 1] }
};

// Cases outside their band that damage numbers can't fix (the bench barely moves when their damage does,
// or the fix would cost more boss damage than BT_REALIZED_RANGE allows): flagged for a mechanics pass.
const SPRAYER_REACH = 'sprayer reach: realized capped by the cone, not damage (sprayer pass)';
export const BT_BENCH_EXEMPT = Object.freeze({
  'lightning|fork|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'lightning|orb|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'lightning|strike|12': 'chains one-shot the bench pack: hit count, not damage, sets realized',
  'singularity|twin|6': 'a second core doubles the pull area; capped at BT_REALIZED_RANGE',
  'singularity|aftershock|12': 'damage-insensitive in the bench',
  'singularity|cascade|12': 'damage-insensitive in the bench',
  'orbitals|fling|12': 'damage-insensitive in the bench',
  'orbitals|nova|12': 'damage-insensitive in the bench',
  'orbitals|nova|18': 'damage-insensitive in the bench',
  'mines|triad|12': 'three mines cover three times the ground: hit count, not damage',
  'mines|cluster|18': 'damage-insensitive in the bench',
  'gas|seek|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|seek|12': 'damage-insensitive in the bench',
  'gas|pockets|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|pockets|12': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|pockets|18': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|6': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|12': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  'gas|shroud|18': 'gas trails barely reach the bench pack; capped at BT_REALIZED_RANGE',
  ...Object.fromEntries(['flamethrower|fireballs', 'flamethrower|napalm', 'cryospray|shatter', 'cryospray|slicks', 'acidspray|meltdown', 'acidspray|pools']
    .flatMap((k) => [6, 12, 18].map((m) => [`${k}|${m}`, SPRAYER_REACH]))),
  'cryospray|blizzard|6': SPRAYER_REACH,
  'flamethrower|ring|12': 'a hair over the sprayer band at BT_REALIZED_RANGE (the ring hits the whole pack)',
  'acidspray|caustic|12': 'a hair over the sprayer band at BT_REALIZED_RANGE (the ring hits the whole pack)',
  'shockfield|lash|6': 'a discharge kills everything inside the field: damage-insensitive (defensive class)',
  'shockfield|repulse|6': 'knockback (control); a discharge kills everything inside: damage-insensitive',
  'shockfield|repulse|12': 'knockback (control); a discharge kills everything inside: damage-insensitive',
  'shockfield|repulse|18': 'knockback (control); a discharge kills everything inside: damage-insensitive',
  'shockfield|overcharge|6': 'a discharge kills everything inside the field: damage-insensitive (defensive class)',
  'shockfield|overcharge|12': 'a discharge kills everything inside the field: damage-insensitive (defensive class)',
  'shockfield|overcharge|18': 'the banked thunderclap clears whole packs: damage-insensitive (defensive class)',
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
