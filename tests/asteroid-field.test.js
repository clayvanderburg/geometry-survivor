import test from 'node:test';
import assert from 'node:assert/strict';

// The asteroid field: solid masses of small nodes (plus small groups and singles) covering about the share
// of the arena the classic field did and paying about as much ore, every node breaking at the same rate,
// the mining phases (solid -> freed chunk -> broken), and a spatial hash that still finds every rock.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { AsteroidManager, REPLENISH_SHARE, MASS_NODE_MIN, MASS_NODE_RANGE } = await import('../js/asteroids.js');
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
  assert.ok(coverage > 0.09 && coverage < 0.15, `coverage ${coverage}`);
  assert.ok(ore('gold_vein') > 110 && ore('gold_vein') < 170, `gold veins ${ore('gold_vein')}`);
  assert.ok(ore('shield_vein') > 45 && ore('shield_vein') < 90, `shield veins ${ore('shield_vein')}`);
  assert.ok(ore('core_vein') > 3 && ore('core_vein') < 16, `core veins ${ore('core_vein')}`);
  // Every node takes the same time to break: plain rock has the classic rock's HP (~a second at base
  // drill speed) whatever its size, and each vein type its own classic HP.
  const rocks = fields.flatMap((am) => am.asteroids.filter((r) => !r.unbreakable));
  for (const type of ['rock', 'gold_vein', 'shield_vein', 'core_vein']) {
    const hps = new Set(rocks.filter((r) => r.oreType === type).map((r) => r.maxHp.toFixed(6)));
    assert.equal(hps.size, 1, `${type}: one HP for every node`);
  }
  const plainHp = rocks.find((r) => r.oreType === 'rock').maxHp;
  assert.ok(plainHp / TUNING.miningSpeed > 0.8 && plainHp / TUNING.miningSpeed < 1.3, `plain node ${plainHp} HP`);
});

test('every asteroid is a solid mass of small nodes packed into one piece, with small groups and singles between', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const [am] = sectors(1);
  const groups = am.groups.filter((g) => g.kind === 'mass');
  const sizes = groups.map((g) => g.nodes.length);
  assert.ok(sizes.filter((n) => n >= 25).length >= 25, `${sizes.filter((n) => n >= 25).length} big masses`);
  assert.ok(sizes.filter((n) => n === 1).length >= 8, 'singles');
  assert.ok(sizes.filter((n) => n >= 2 && n <= 7).length >= 8, 'small groups');
  const sizeMult = TUNING.rockSizeMult;
  for (const g of groups) {
    for (const a of g.nodes) {
      assert.ok(a.radius >= MASS_NODE_MIN * sizeMult - 1e-6 && a.radius <= (MASS_NODE_MIN + MASS_NODE_RANGE) * sizeMult + 1e-6);
      assert.ok(!a.freed, 'untouched rock starts solid');
      if (g.nodes.length < 2) continue;
      // One connected, tightly packed piece (a node grown onto a bedrock core may hang off the bedrock).
      assert.ok(am.getNearbyAsteroids(a.x, a.y, 1).some((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < (a.radius + b.radius) * 0.8), 'packed');
    }
  }
  // Veins come in seams: most vein nodes touch another node of the same ore.
  const veins = groups.flatMap((g) => g.nodes.filter((r) => r.oreType === 'gold_vein' || r.oreType === 'shield_vein'));
  const inSeam = veins.filter((a) => veins.some((b) => b !== a && b.oreType === a.oreType && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius));
  assert.ok(inSeam.length / veins.length > 0.5, `${inSeam.length}/${veins.length} vein nodes in seams`);
});

test('mining phases: a node comes free when ground, and its neighbours come free when it breaks', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const am = new AsteroidManager(4200, 4200);
  const nodes = am.spawnMassCluster(2000, 2000, null, { reach: 120 });
  am.rebuildSpatialHash();
  const target = nodes.reduce((best, n) => (n.x < best.x ? n : best));
  const silent = new Proxy({}, { get: () => () => {} });
  const p = { x: target.x - target.radius - 18, y: target.y, vx: 0, vy: 0, radius: 15, angle: 0, hullAngle: 0, drillAngle: 0, stats: { miningSpeed: 75, miningRange: 43 } };
  const touching = nodes.filter((n) => n !== target && Math.hypot(n.x - target.x, n.y - target.y) < n.radius + target.radius);
  am.update(1 / 60, p, [], [], () => {}, silent);
  assert.ok(target.freed, 'ground node comes free');
  assert.ok(target.group.dirty, 'its group redraws without it');
  const broken = [];
  for (let i = 0; i < 300 && !broken.includes(target); i++) {
    p.x = target.x - target.radius - 18; p.y = target.y;
    am.update(1 / 60, p, [], [], (r) => broken.push(r), silent);
  }
  assert.ok(broken.includes(target), 'it breaks');
  assert.ok(touching.length && touching.every((n) => n.freed || n.hp <= 0), 'the rock touching it came free');
  assert.ok(nodes.some((n) => !n.freed), 'the rest of the mass stays solid');
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
