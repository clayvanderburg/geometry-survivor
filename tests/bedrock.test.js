import test from 'node:test';
import assert from 'node:assert/strict';

// Bedrock (js/asteroids.js): unbreakable rock made of overlapping nodes: clumps (blobs, ridges, arms) in
// all sizes, walls and the arena border. Nothing breaks it (drill-claws, elite grinding, boss portal
// blasts), it blocks the ship, it never counts toward replenishing the sector, asteroids coat it without
// burying it (most clumps are an asteroid's hard core, drawn over the rock so it shows), and elites steer round it instead of plowing.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { AsteroidManager, BEDROCK_RADIUS, BORDER_GAP, isBedrock } = await import('../js/asteroids.js');
const { steerAroundRocks } = await import('../js/pursuit.js');

const DT = 1 / 60;
const silent = new Proxy({}, { get: () => () => {} });
const reset = () => Object.assign(TUNING, DEFAULT_TUNING);

function ship(x, y, angle = 0) {
  return { x, y, vx: 0, vy: 0, radius: 15, angle, drillAngle: angle, stats: { miningSpeed: 9999, miningRange: 60 } };
}

// Two nodes touch when their circles overlap; a clump is one piece when every node can reach every other.
function connected(nodes) {
  const seen = new Set([nodes[0]]);
  const stack = [nodes[0]];
  while (stack.length) {
    const a = stack.pop();
    for (const b of nodes) {
      if (!seen.has(b) && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) { seen.add(b); stack.push(b); }
    }
  }
  return seen.size === nodes.length;
}

test('a bedrock clump is one connected piece of overlapping nodes, in all shapes and sizes', () => {
  const sizes = [];
  for (let i = 0; i < 40; i++) {
    const am = new AsteroidManager(4200, 4200);
    const size = 45 + (i % 8) * 25;
    const nodes = am.addBedrockClump(2000, 2000, size);
    assert.ok(nodes.length >= 3, `${nodes.length} nodes`);
    assert.ok(nodes.every((r) => isBedrock(r) && r.group === nodes[0].group), 'one draw group');
    assert.ok(connected(nodes), 'connected');
    for (const r of nodes) {
      assert.ok(r.radius >= 14 && r.radius <= 46, `node radius ${r.radius}`);
      assert.ok(Math.hypot(r.x - 2000, r.y - 2000) <= size + 1e-6, 'within its size');
    }
    const span = Math.max(...nodes.map((r) => Math.hypot(r.x - 2000, r.y - 2000) + r.radius));
    sizes.push(span);
  }
  assert.ok(Math.min(...sizes) < 80 && Math.max(...sizes) > 160, `small and big clumps (${Math.min(...sizes).toFixed(0)}-${Math.max(...sizes).toFixed(0)} px)`);
});

test('a bedrock wall is a chain of overlapping nodes from end to end', () => {
  const am = new AsteroidManager(4200, 4200);
  const nodes = am.addBedrockWall([{ x: 1000, y: 1000 }, { x: 1600, y: 1000 }, { x: 1600, y: 1500 }], BEDROCK_RADIUS);
  assert.ok(nodes.length > 15);
  for (let i = 1; i < nodes.length; i++) {
    const [a, b] = [nodes[i - 1], nodes[i]];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < (a.radius + b.radius) * 0.9, 'neighbours overlap');
  }
  assert.ok(Math.hypot(nodes.at(-1).x - 1600, nodes.at(-1).y - 1500) < 1e-6, 'reaches the end point');
  am.rebuildSpatialHash();
  assert.equal(am.groups.length, 1, 'one draw group');
  am.asteroids = [];
  am.rebuildSpatialHash();
  assert.deepEqual(am.groups, [], 'a cleared field draws nothing');
});

test('the drill-claws, elites and boss portals never break bedrock', () => {
  reset();
  const am = new AsteroidManager(4200, 4200);
  const rock = am.addBedrock(2000, 2000);
  am.rebuildSpatialHash();
  const shattered = [];
  const p = ship(2000 - BEDROCK_RADIUS - 16, 2000);
  const boss = { x: 2000 + BEDROCK_RADIUS + 30, y: 2000, vx: -2, vy: 0, radius: 30, isBoss: true, type: 'boss' };
  for (let i = 0; i < 600; i++) am.update(DT, p, [boss], [], (r) => shattered.push(r), silent);
  assert.equal(rock.hp, rock.maxHp);
  assert.equal(am.isDrilling, false, 'claws do not engage bedrock');
  assert.equal(am.blastRocks(2000, 2000, 300, (r) => shattered.push(r)), 0);
  assert.equal(shattered.length, 0);
  assert.ok(am.asteroids.includes(rock));
  // It still blocks: the ship is held outside it.
  p.x = 2000 - 10;
  am.update(DT, p, [], [], () => {}, silent);
  assert.ok(Math.hypot(p.x - 2000, p.y - 2000) >= BEDROCK_RADIUS + p.radius - 1e-6, 'pushed out');
});

test('bedrock never counts toward replenishing; rock may coat it but never buries it, and keeps a gap from the wall', () => {
  reset();
  TUNING.bedrockFormations = 8;
  TUNING.bedrockFormationChance = 1;
  const am = new AsteroidManager(4200, 4200);
  am.generateSector(2100, 2100);
  const bedrock = am.asteroids.filter(isBedrock);
  assert.ok(bedrock.length > 20, `${bedrock.length} bedrock nodes`);
  assert.equal(am.sectorRockCount, am.asteroids.length - bedrock.length);
  const check = (label) => {
    for (const r of am.asteroids) {
      if (isBedrock(r)) continue;
      for (const b of bedrock) {
        const d = Math.hypot(r.x - b.x, r.y - b.y);
        if (b.border) assert.ok(d >= r.radius + b.radius + BORDER_GAP - 1e-6, `${label}: rock against the wall`);
        else assert.ok(d >= b.radius * 0.75 - 1e-6, `${label}: rock buried in bedrock`);
      }
    }
  };
  check('sector');
  // Mine out the breakable rock: replenish asks for more even though the bedrock remains.
  am.asteroids = am.asteroids.filter(isBedrock);
  assert.equal(am.needsReplenish(), true);
  for (let c = 0; c < 30; c++) am.spawnCluster(300 + Math.random() * 3600, 300 + Math.random() * 3600);
  check('replenished');
  reset();
});

test('the standard sector is walled in, and gets several bedrock clumps, most of them the core of an asteroid', () => {
  reset();
  let clumps = 0, buried = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const am = new AsteroidManager(4200, 4200);
    am.generateSector(2100, 2100);
    assert.ok(am.bordered, 'walled in');
    const border = am.asteroids.filter((r) => r.border);
    // The wall hugs every edge: no stretch of edge without a node over it.
    for (let t = 0; t <= 4200; t += 40) {
      for (const [x, y] of [[t, 0], [t, 4200], [0, t], [4200, t]]) {
        assert.ok(border.some((r) => Math.hypot(r.x - x, r.y - y) < r.radius), `gap in the wall at ${x},${y}`);
      }
    }
    const groups = new Map();
    for (const r of am.asteroids) if (isBedrock(r) && !r.border) groups.set(r.group, [...(groups.get(r.group) || []), r]);
    for (const nodes of groups.values()) {
      clumps++;
      for (const r of nodes) assert.ok(Math.hypot(r.x - 2100, r.y - 2100) > 400, 'clear of the start');
      const coated = am.asteroids.filter((o) => !o.unbreakable && nodes.some((b) => Math.hypot(o.x - b.x, o.y - b.y) < o.radius + b.radius)).length;
      if (coated >= 6) buried++;
    }
  }
  const mean = clumps / N;
  assert.ok(mean > 3.5 && mean < 6.5, `about 5 clumps per sector (${mean})`);
  assert.ok(buried / clumps > 0.6, `most clumps are the hard core of an asteroid (${buried}/${clumps})`);
});

test('with the wall switched off the field is open (the game draws a boundary line instead)', () => {
  reset();
  TUNING.bedrockBorder = 0;
  TUNING.bedrockFormations = 0;
  const am = new AsteroidManager(4200, 4200);
  am.generateSector(2100, 2100);
  assert.equal(am.bordered, false);
  assert.equal(am.asteroids.filter(isBedrock).length, 0);
  reset();
});

test('elites plow through plain rock but steer round bedrock', () => {
  reset();
  const out = { x: 0, y: 0 };
  const plain = new AsteroidManager(4200, 4200);
  plain.asteroids.push({ x: 2080, y: 2000, radius: 40, hp: 50, maxHp: 50, oreType: 'rock' });
  plain.rebuildSpatialHash();
  const lt = { x: 2000, y: 2000, radius: 20, isLieutenant: true, type: 'pinwheel' };
  steerAroundRocks(lt, 1, 0, 600, plain, DT, true, out);
  assert.deepEqual([out.x, out.y], [1, 0], 'straight through plain rock');

  const walled = new AsteroidManager(4200, 4200);
  walled.addBedrock(2080, 2000);
  walled.rebuildSpatialHash();
  const lt2 = { x: 2000, y: 2000, radius: 20, isLieutenant: true, type: 'pinwheel', strafeSign: 1 };
  steerAroundRocks(lt2, 1, 0, 600, walled, DT, true, out);
  assert.ok(lt2.detourRock && isBedrock(lt2.detourRock), 'detours round bedrock');
  assert.ok(Math.abs(out.y) > 0.3);
});
