import test from 'node:test';
import assert from 'node:assert/strict';

// Breakthrough calibration (js/bt-calibration.js): every transform realizes about the same damage in the
// card bench (tools/balance/bt-bench.mjs), so no option in a 3-card Breakthrough hand is the obvious pick,
// while the potential model still adds exactly BT_TRANSFORM_DPS per transform.
await import('../tools/balance/harness.mjs'); // headless globals before any game module
const bb = await import('../tools/balance/bt-bench.mjs');
const { TF_REALIZED, BT_REALIZED_RANGE, BT_BENCH_EXEMPT, BT_BENCH_BAND, BT_SPRAYER_BAND, BT_SPRAYERS, tfRealizedAt } = await import('../js/bt-calibration.js');
const { STAT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, transformPool, makeBuild } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W, POTENTIAL_DPS } = await import('../js/weapon-scaling.js');

test('every transform in every pool is calibrated on the card bench, within BT_REALIZED_RANGE', () => {
  const [lo, hi] = BT_REALIZED_RANGE;
  for (const id of Object.keys(STAT_CARDS)) {
    const pool = transformPool(id).map((t) => t.id);
    assert.deepEqual(Object.keys(TF_REALIZED[id] || {}).sort(), [...pool].sort(), `${id}: TF_REALIZED must list exactly its pool (bench new transforms with tools/balance/bt-bench.mjs)`);
    for (const t of pool) {
      const v = TF_REALIZED[id][t];
      assert.equal(v.length, BREAKTHROUGH_LEVELS.length, `${id}:${t} needs a value per milestone`);
      for (const x of v) assert.ok(x >= lo && x <= hi, `${id}:${t} ${x} outside ${lo}-${hi}`);
    }
  }
  for (const key of Object.keys(BT_BENCH_EXEMPT)) {
    const [id, t, m] = key.split('|');
    assert.ok(TF_REALIZED[id]?.[t] && BREAKTHROUGH_LEVELS.includes(Number(m)), `exemption ${key} names no transform`);
  }
});

test('the calibration rescales the weapon\'s hits but not its potential: still exactly BT_TRANSFORM_DPS', () => {
  // Autocannon Flak at LV 6 realizes 1 / 0.75 as hard; between milestones the value is interpolated.
  assert.equal(tfRealizedAt('blaster', 'flak', 6), TF_REALIZED.blaster.flak[0]);
  assert.ok(Math.abs(tfRealizedAt('blaster', 'flak', 9) - (TF_REALIZED.blaster.flak[0] + TF_REALIZED.blaster.flak[1]) / 2) < 1e-9);
  assert.equal(tfRealizedAt('blaster', 'flak', 1), TF_REALIZED.blaster.flak[0], 'slot-6 bonus Breakthrough at LV 1 uses the LV 6 value');
  const plain = makeBuild('blaster', 6, { damage: 2 });
  const flak = makeBuild('blaster', 6, { damage: 2 }, { 6: 'flak' });
  const units = W.blasterUnits(plain) / W.blasterUnits(flak);
  assert.ok(Math.abs(W.blasterDamageMult(flak) / W.blasterDamageMult(plain) - BT_TRANSFORM_DPS * units / TF_REALIZED.blaster.flak[0]) < 1e-9);
  for (const id of Object.keys(STAT_CARDS)) {
    for (const t of transformPool(id)) {
      for (const m of BREAKTHROUGH_LEVELS) {
        const base = POTENTIAL_DPS[id](makeBuild(id, m, { damage: 2 }));
        const with1 = POTENTIAL_DPS[id](makeBuild(id, m, { damage: 2 }, { [m]: t.id }));
        assert.ok(Math.abs(with1 / base - BT_TRANSFORM_DPS) < 1e-6, `${id}:${t.id} LV ${m}: x${(with1 / base).toFixed(4)}`);
      }
    }
  }
});

// A cheap live check on the bench (2 seeds, pack + chase): the transforms that were the worst outliers
// before calibration (0.78x to 1.6x Across the Board) now realize within the band, with a noise margin.
test('card bench: the old outliers realize within the band against Across the Board', async () => {
  const cases = [['blaster', 6, 'arc'], ['rockets', 18, 'mirv'], ['drones', 12, 'wingman'], ['raillance', 6, 'wake'], ['flamethrower', 6, 'ring']];
  const NOISE = 0.1;
  for (const [id, lv, option] of cases) {
    const [lo, hi] = BT_SPRAYERS.includes(id) ? BT_SPRAYER_BAND : BT_BENCH_BAND;
    const ratio = (await bb.benchOption(id, lv, option, { seeds: 2 })) / (await bb.benchOption(id, lv, 'boost', { seeds: 2 }));
    assert.ok(ratio >= lo - NOISE && ratio <= hi + NOISE, `${id}:${option} LV ${lv} realizes ${ratio.toFixed(2)}x Across the Board`);
  }
});
