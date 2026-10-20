import test from 'node:test';
import assert from 'node:assert/strict';

// Regression checks for the second engineering audit. Browser services are stubbed.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game } = await import('../js/main.js');
const { AsteroidManager } = await import('../js/asteroids.js');
const { WarpGrid } = await import('../js/grid.js');

function spawner(px, py) {
  return Object.assign(Object.create(Game.prototype), {
    worldWidth: 4200, worldHeight: 4200, player: { x: px, y: py },
    asteroidManager: { getNearbyAsteroids() { return []; } }
  });
}

test('spawns keep their minimum distance when the player hugs a wall or corner', () => {
  for (const [px, py] of [[39, 2100], [39, 39], [4161, 4161], [2100, 39]]) {
    const g = spawner(px, py);
    for (let n = 0; n < 2000; n++) {
      const pt = g.spawnAroundPlayer(440, 760);
      assert.ok(Math.hypot(pt.x - px, pt.y - py) >= 440, `spawn too close to (${px}, ${py})`);
      assert.ok(pt.x >= 90 && pt.x <= 4110 && pt.y >= 90 && pt.y <= 4110);
    }
  }
});

test('a new sector never starts with a rock on or beside the player', () => {
  const m = new AsteroidManager(4200, 4200);
  for (let n = 0; n < 300; n++) {
    m.generateSector(2100, 2100);
    for (const rock of m.asteroids) {
      assert.ok(Math.hypot(rock.x - 2100, rock.y - 2100) >= rock.radius + 250);
    }
  }
});

test('rocks leave a passable gap at the arena wall', () => {
  const m = new AsteroidManager(4200, 4200);
  for (let n = 0; n < 50; n++) {
    m.generateSector(2100, 2100);
    const wall = m.asteroids.filter((r) => r.slab?.border);
    for (const rock of m.asteroids) {
      if (rock.unbreakable) continue; // the bedrock wall itself
      assert.ok(rock.x - rock.radius >= 59.99 && rock.x + rock.radius <= 4140.01);
      assert.ok(rock.y - rock.radius >= 59.99 && rock.y + rock.radius <= 4140.01);
      // A ship (30 px across) fits between mineable rock and the wall's collision.
      const near = wall.filter((w) => Math.abs(w.x - rock.x) < 200 && Math.abs(w.y - rock.y) < 200);
      for (const w of near) assert.ok(Math.hypot(w.x - rock.x, w.y - rock.y) - w.radius - rock.radius > 32, 'gap to the bedrock wall');
    }
  }
});

test('rock pushout cannot shove the ship or an enemy outside the arena', () => {
  const m = new AsteroidManager(4200, 4200);
  m.asteroids = [{ x: 80, y: 2000, radius: 55, hp: 1e9, maxHp: 1e9, hitFlash: 0 }];
  m.rebuildSpatialHash();
  const player = { x: 39, y: 2000, radius: 15, angle: 0, stats: { miningSpeed: 0, miningRange: 43 } };
  const boss = { x: 44, y: 2010, vx: 0, vy: 0, radius: 36 };
  const silent = new Proxy({}, { get: () => () => {} });
  m.update(1 / 60, player, [boss], [], () => {}, silent);
  assert.ok(player.x >= 39);
  assert.ok(boss.x >= 44);
});

test('grid forces only touch the simulated region, so offscreen points cannot build up velocity', () => {
  const grid = new WarpGrid(4200, 4200);
  grid.update(0, 0, 1280, 720);
  for (let n = 0; n < 600; n++) grid.applyImplosion(3800, 3800, 14, 185);
  assert.ok(grid.points.every(pt => pt.vx === 0 && pt.vy === 0));
});
