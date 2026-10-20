import test from 'node:test';
import assert from 'node:assert/strict';

// Bedrock (js/asteroids.js): unbreakable rock for level design. Walls are gapless, nothing breaks it
// (drill-claws, elite grinding, boss portal blasts), it blocks the ship, it never counts toward
// replenishing the sector, clusters fill in round it, and elites steer round it instead of plowing.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { AsteroidManager, BEDROCK_RADIUS, BEDROCK_SPACING, isBedrock } = await import('../js/asteroids.js');
const { steerAroundRocks } = await import('../js/pursuit.js');

const DT = 1 / 60;
const silent = new Proxy({}, { get: () => () => {} });
const reset = () => Object.assign(TUNING, DEFAULT_TUNING);

function ship(x, y, angle = 0) {
  return { x, y, vx: 0, vy: 0, radius: 15, angle, drillAngle: angle, stats: { miningSpeed: 9999, miningRange: 60 } };
}

test('a bedrock wall has no gaps a ship could slip through', () => {
  const am = new AsteroidManager(4200, 4200);
  const pieces = am.addBedrockWall([{ x: 1000, y: 1000 }, { x: 1600, y: 1000 }, { x: 1600, y: 1500 }]);
  assert.ok(pieces.length > 10);
  assert.ok(pieces.every(isBedrock));
  for (let i = 1; i < pieces.length; i++) {
    const gap = Math.hypot(pieces[i].x - pieces[i - 1].x, pieces[i].y - pieces[i - 1].y);
    assert.ok(gap <= BEDROCK_RADIUS * BEDROCK_SPACING + 1e-6, `gap ${gap}`);
  }
  assert.ok(Math.hypot(pieces.at(-1).x - 1600, pieces.at(-1).y - 1500) < BEDROCK_RADIUS, 'reaches the end point');
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

test('bedrock never counts toward replenishing, and clusters are never placed on it', () => {
  reset();
  TUNING.bedrockFormations = 8;
  const am = new AsteroidManager(4200, 4200);
  am.generateSector(2100, 2100);
  const bedrock = am.asteroids.filter(isBedrock);
  assert.ok(bedrock.length > 20, `${bedrock.length} bedrock pieces`);
  assert.equal(am.sectorRockCount, am.asteroids.length - bedrock.length);
  for (const r of am.asteroids) {
    if (isBedrock(r)) continue;
    for (const b of bedrock) assert.ok(Math.hypot(r.x - b.x, r.y - b.y) >= (r.radius + b.radius) * 0.8 - 1e-6, 'rock on bedrock');
  }
  // Mine out the breakable rock: replenish asks for more even though the bedrock remains.
  am.asteroids = am.asteroids.filter(isBedrock);
  assert.equal(am.needsReplenish(), true);
  for (let c = 0; c < 30; c++) am.spawnCluster(300 + Math.random() * 3600, 300 + Math.random() * 3600);
  for (const r of am.asteroids) {
    if (isBedrock(r)) continue;
    for (const b of bedrock) assert.ok(Math.hypot(r.x - b.x, r.y - b.y) >= r.radius + b.radius, 'replenished rock on bedrock');
  }
  reset();
});

test('the standard sector has no bedrock', () => {
  reset();
  const am = new AsteroidManager(4200, 4200);
  am.generateSector(2100, 2100);
  assert.equal(am.asteroids.filter(isBedrock).length, 0);
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
