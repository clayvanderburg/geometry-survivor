// Breakthrough calibration (card bench). The potential model holds every transform at exactly
// BT_TRANSFORM_DPS, but what a transform *realizes* in a fight depends on how its extra attacks land
// (overkill, splash on packs, misses), so some realized far more than Across the Board and some far less,
// which made the pick in a 3-card Breakthrough hand obvious.
//
// TF_REALIZED[weapon][transform] = [LV 6, LV 12, LV 18]: how much more a transform realizes than the model
// gives it credit for, measured in the card bench (tools/balance/bt-bench.mjs). A weapon with that transform
// hits 1 / value as hard (all its damage, so the transform's mechanics are untouched), and its potential
// DPS counts the value back in, so the potential model still adds exactly BT_TRANSFORM_DPS. Between
// milestones the value is interpolated on the weapon level (clamped outside LV 6-18).
//
// Target: each transform realizes BT_BENCH_BAND x Across the Board at each milestone (earlier milestones
// Across the Board). The sprayers are held against Overtuned Core instead (BT_BENCH_REF): Across the
// Board's free Turn / Range ranks realize about 2x Overtuned on them (a weapon-level issue, flagged).
// Transforms that trade damage for control sit at the bottom of the band (BT_CONTROL).
export const BT_BENCH_BAND = Object.freeze([1.05, 1.3]);
export const BT_BENCH_TARGET = 1.17;
export const BT_BENCH_REF = Object.freeze({ flamethrower: 'overtuned', cryospray: 'overtuned', acidspray: 'overtuned' });
export const BT_CONTROL = Object.freeze({});
export const BT_CONTROL_TARGET = 1.08;

export const TF_REALIZED = {};

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
