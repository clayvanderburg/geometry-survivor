import test from 'node:test';
import assert from 'node:assert/strict';

// The asteroid field: solid masses of small nodes and loose clusters of classic rocks, covering about the
// share of the arena the classic field did and paying about as much ore, and a spatial hash that still
// finds every rock.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { AsteroidManager, CLUSTER_SPREAD, REPLENISH_SHARE, MASS_NODE_MIN, MASS_NODE_RANGE, ROCK_REF } = await import('../js/asteroids.js');
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

// Share of the arena covered by mineable rock (sampled: packed mass nodes overlap, so summed areas overstate it).
function coverageOf(am, samples = 20000) {
  let hit = 0;
  for (let k = 0; k < samples; k++) {
    const x = Math.random() * 4200, y = Math.random() * 4200;
    if (am.getNearbyAsteroids(x, y, 1).some((r) => !r.unbreakable && (r.x - x) ** 2 + (r.y - y) ** 2 < r.radius ** 2)) hit++;
  }
  return hit / samples;
}

// The classic field (v0.42: ~930 loose rocks) averaged ~0.127 coverage, ~138 gold, ~65 shield and ~8 core veins.
test('the field covers as much of the arena and pays as much ore as the classic field', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const fields = sectors(6);
  const per = (fn) => fields.reduce((t, am) => t + fn(am), 0) / fields.length;
  const ore = (type) => per((am) => am.asteroids.filter((r) => r.oreType === type).length);
  const coverage = per((am) => coverageOf(am, 8000));
  assert.ok(coverage > 0.1 && coverage < 0.15, `coverage ${coverage}`);
  assert.ok(ore('gold_vein') > 110 && ore('gold_vein') < 170, `gold veins ${ore('gold_vein')}`);
  assert.ok(ore('shield_vein') > 45 && ore('shield_vein') < 90, `shield veins ${ore('shield_vein')}`);
  assert.ok(ore('core_vein') > 3 && ore('core_vein') < 16, `core veins ${ore('core_vein')}`);
  // Loose rocks keep the classic size, and a plain one still drills in about a second at base speed.
  const loose = fields.flatMap((am) => am.asteroids.filter((r) => !r.unbreakable && !r.mass));
  const meanR = loose.reduce((a, r) => a + r.radius, 0) / loose.length;
  assert.ok(meanR >= 26 && meanR <= 31, `loose rock mean radius ${meanR}`);
  const plain = loose.filter((r) => r.oreType === 'rock');
  assert.ok(plain.reduce((a, r) => a + r.maxHp, 0) / plain.length / TUNING.miningSpeed < 1.3, 'plain rock HP');
  assert.ok(CLUSTER_SPREAD > 200, 'loose clusters keep their footprint');
});

test('about half the clusters are solid masses: small nodes packed into one piece, ore in seams', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const [am] = sectors(1);
  const masses = am.groups.filter((g) => g.kind === 'mass');
  const loose = am.groups.filter((g) => g.kind === 'loose');
  assert.ok(masses.length >= 12 && loose.length >= 12, `${masses.length} masses, ${loose.length} loose clusters`);
  const sizeMult = TUNING.rockSizeMult;
  for (const g of masses) {
    const nodes = g.nodes;
    if (nodes.length < 8) continue; // squeezed by a wall or the start zone
    // One connected piece, tightly packed: every node overlaps a neighbour by a good margin.
    for (const a of nodes) {
      assert.ok(a.radius >= MASS_NODE_MIN * sizeMult - 1e-6 && a.radius <= (MASS_NODE_MIN + MASS_NODE_RANGE) * sizeMult + 1e-6);
      // (a node grown onto a bedrock core may hang off the bedrock rather than another rock node)
      assert.ok(am.getNearbyAsteroids(a.x, a.y, 1).some((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < (a.radius + b.radius) * 0.8), 'packed');
    }
    // HP scales with area: a node half the classic rock's radius has about a quarter of its HP.
    const plain = nodes.filter((r) => r.oreType === 'rock');
    for (const r of plain) {
      const ref = ROCK_REF * sizeMult;
      assert.ok(Math.abs(r.maxHp / ((r.radius / ref) ** 2) - plain[0].maxHp / ((plain[0].radius / ref) ** 2)) < 1e-6, 'HP per area');
    }
  }
  // Veins come in seams: most vein nodes touch another node of the same ore.
  const veins = masses.flatMap((g) => g.nodes.filter((r) => r.oreType === 'gold_vein' || r.oreType === 'shield_vein'));
  const inSeam = veins.filter((a) => veins.some((b) => b !== a && b.oreType === a.oreType && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius));
  assert.ok(inSeam.length / veins.length > 0.5, `${inSeam.length}/${veins.length} vein nodes in seams`);
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
