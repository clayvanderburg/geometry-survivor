import test from 'node:test';
import assert from 'node:assert/strict';

// The asteroid field: many small rocks (about twice the old count at ~2/3 the size) covering a similar
// share of the arena, gold veins at TUNING.goldVeinChance, and a spatial hash that still finds them.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { AsteroidManager, CLUSTER_SPREAD, REPLENISH_SHARE } = await import('../js/asteroids.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

function sectors(n = 4) {
  const original = Math.random;
  const out = [];
  try {
    for (let i = 0; i < n; i++) {
      Math.random = seeded(100 + i);
      const am = new AsteroidManager(4200, 4200);
      am.generateSector(2100, 2100);
      out.push(am);
    }
  } finally {
    Math.random = original;
  }
  return out;
}

test('the field has ~2x the old ~465 rocks at ~2/3 the size and no more rock coverage', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const fields = sectors();
  const rocks = fields.flatMap((am) => am.asteroids.filter((r) => !r.unbreakable)); // mineable rock (bedrock: tests/bedrock.test.js)
  const count = rocks.length / fields.length;
  const meanR = rocks.reduce((a, r) => a + r.radius, 0) / rocks.length;
  const coverage = rocks.reduce((a, r) => a + Math.PI * r.radius ** 2, 0) / fields.length / 4200 ** 2;
  assert.ok(count >= 850 && count <= 1150, `rock count ${count}`);
  assert.ok(meanR >= 26 && meanR <= 31, `mean radius ${meanR} (old 41.8)`);
  assert.ok(coverage <= 0.155, `coverage ${coverage} (old ~0.149)`);
  // Rock HP shrinks with size so a plain rock still drills in about a second at base speed.
  const plain = rocks.filter((r) => r.oreType === 'rock');
  const meanHp = plain.reduce((a, r) => a + r.maxHp, 0) / plain.length;
  assert.ok(meanHp / TUNING.miningSpeed < 1.3, `plain rock ${meanHp} HP`);
  // Ore mix: gold at its TUNING share, deep cores rare, shield crystals in between.
  const share = (ore) => rocks.filter((r) => r.oreType === ore).length / rocks.length;
  assert.ok(Math.abs(share('gold_vein') - TUNING.goldVeinChance) < 0.03, `gold share ${share('gold_vein')}`);
  assert.ok(share('core_vein') > 0 && share('core_vein') < 0.03, `core share ${share('core_vein')}`);
  assert.ok(share('shield_vein') > 0.04 && share('shield_vein') < 0.1);
  assert.ok(CLUSTER_SPREAD > 200, 'clusters keep their footprint');
});

test('spatial queries find every rock near a point and cellsFor tracks the smaller max radius', () => {
  const [am] = sectors(1);
  assert.ok(Math.max(...am.asteroids.filter((r) => !r.unbreakable).map((r) => r.radius)) < 45, 'mineable rocks stay small');
  assert.ok(am.maxRockRadius < 72, 'bedrock collision pieces stay modest too');
  for (const probe of [{ x: 600, y: 900 }, { x: 2100, y: 2100 }, { x: 3900, y: 300 }]) {
    const reach = 60;
    const want = am.asteroids.filter((r) => Math.hypot(r.x - probe.x, r.y - probe.y) - r.radius <= reach);
    const got = am.getNearbyAsteroids(probe.x, probe.y, am.cellsFor(reach));
    for (const r of want) assert.ok(got.includes(r), 'rock within reach is returned');
  }
  assert.deepEqual(am.getNearbyAsteroids(-5000, -5000, 1), [], 'far outside the arena: nothing');
});

test('a mined-out sector replenishes below a share of its starting rock count', () => {
  const [am] = sectors(1);
  assert.equal(am.needsReplenish(), false);
  am.asteroids.length = Math.floor(am.sectorRockCount * REPLENISH_SHARE) - 1;
  assert.equal(am.needsReplenish(), true);
});
