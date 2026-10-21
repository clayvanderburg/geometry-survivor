import test from 'node:test';
import assert from 'node:assert/strict';

// Space-time rifts (js/rifts.js): the timer, where a rift opens and where a jump comes out, and the jump
// itself on the real Game (headless balance harness): the ship flies in, is held invulnerable, comes out
// on the far side of the map with the camera, and the rift seals.
const saved = new Map();
globalThis.localStorage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => saved.set(k, String(v)), removeItem: (k) => saved.delete(k) };

const h = await import('../tools/balance/harness.mjs');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { RiftManager, RIFT, riftOpening, insideRift, pickRiftExit } = await import('../js/rifts.js');
const { AsteroidManager } = await import('../js/asteroids.js');

const DT = 1 / 60;
const reset = () => Object.assign(TUNING, DEFAULT_TUNING);

function run() {
  reset();
  const g = h.createHeadlessGame({});
  g.resetRun('normal');
  g.state = 'PLAYING';
  g.spawnWavePack = () => {};
  g.updateLieutenantSchedule = () => {};
  g.asteroidManager.asteroids = [];
  g.asteroidManager.rebuildSpatialHash();
  return g;
}

const tick = (g, n) => { for (let i = 0; i < n; i++) g.update(DT); };

test('the first rift waits for its delay, opens near the ship and seals on its own', () => {
  const g = run();
  TUNING.riftFirstDelay = 2;
  g.rifts.clear();
  tick(g, 60);
  assert.equal(g.rifts.active, null, 'nothing before the first delay');
  tick(g, 70);
  const r = g.rifts.active;
  assert.ok(r, 'a rift opened');
  const d = Math.hypot(r.x - g.player.x, r.y - g.player.y);
  assert.ok(d >= TUNING.riftSpawnMin - 1 && d <= TUNING.riftSpawnMax + 1, `opened ${d.toFixed(0)} px from the ship`);
  assert.equal(r.phase, 'tear');
  tick(g, Math.ceil((RIFT.tearTime + TUNING.riftOpenTime + RIFT.sealTime) / DT) + 5);
  assert.equal(g.rifts.active, null, 'sealed and gone');
  // The countdown keeps ticking after the seal: up to 10 frames from when the rift opened inside the
  // 70-tick window, plus the 5 spare ticks above, so allow 20 frames below the minimum.
  assert.ok(g.rifts.timer >= TUNING.riftIntervalMin - 20 * DT && g.rifts.timer <= TUNING.riftIntervalMax, 'next one is on the interval');
  reset();
});

test('flying into an open rift jumps the ship to the far side of the map', () => {
  const g = run();
  const p = g.player;
  p.x = 900; p.y = 1000;
  const r = g.rifts.openNow(g);
  assert.ok(r);
  tick(g, Math.ceil(RIFT.tearTime / DT) + 2);
  assert.equal(r.phase, 'open');
  // Park the ship in the rift.
  p.x = r.x; p.y = r.y; p.vx = 0; p.vy = 0;
  tick(g, 1);
  assert.ok(g.rifts.holdsShip(), 'the jump began');
  assert.ok(p.invuln > RIFT.transitIn + RIFT.transitOut, 'invulnerable through the jump');
  const fromX = r.x, fromY = r.y;
  tick(g, Math.ceil(RIFT.transitIn / DT) + 2);
  const jump = Math.hypot(p.x - fromX, p.y - fromY);
  assert.ok(jump >= RIFT.minJump, `jumped ${jump.toFixed(0)} px`);
  // The exit is a random clear spot within exitSpread of the entry's mirror point (the field is empty here).
  const mirror = Math.hypot(p.x - (g.worldWidth - fromX), p.y - (g.worldHeight - fromY));
  assert.ok(mirror <= RIFT.exitSpread + 1, `came out on the far side, ${mirror.toFixed(0)} px from the mirror point`);
  assert.ok(Math.abs(g.camX + g.width / 2 - p.x) < g.width && Math.abs(g.camY + g.height / 2 - p.y) < g.height, 'camera cut to the ship');
  assert.equal(r.phase, 'seal', 'entry rift seals behind the ship');
  assert.equal(g.rifts.shipPose().scale < 1, true, 'still popping out');
  tick(g, Math.ceil(RIFT.transitOut / DT) + 2);
  assert.equal(g.rifts.holdsShip(), false, 'pilot has the ship back');
  assert.ok(p.invuln > 0, 'a moment of exit invulnerability');
  assert.equal(g.rifts.jumps, 1);
  reset();
});

test('an exit rift cannot be entered, and a rift that is still tearing or sealing lets the ship pass', () => {
  const m = new RiftManager();
  const r = m.makeRift(1000, 1000);
  assert.equal(insideRift(r, 1000, 1000), false, 'just torn: too narrow');
  r.phase = 'open';
  assert.equal(insideRift(r, 1000, 1000), true);
  assert.equal(insideRift(r, 1000, 1000 + r.radius * 2), false, 'beside the lens');
  r.phase = 'seal'; r.t = 0;
  assert.equal(insideRift(r, 1000, 1000), false);
  const exit = m.makeRift(2000, 2000, true);
  assert.equal(insideRift(exit, 2000, 2000), false);
  assert.deepEqual(riftOpening({ phase: 'open' }), { crack: 1, aperture: 1 });
});

test('a jump never lands in rock and stays inside the arena', () => {
  reset();
  const am = new AsteroidManager(4200, 4200);
  am.generateSector(2100, 2100);
  const game = { worldWidth: 4200, worldHeight: 4200, player: { radius: 15 }, asteroidManager: am, enemyManager: { enemies: [] } };
  for (let i = 0; i < 200; i++) {
    const x = 300 + Math.random() * 3600;
    const y = 300 + Math.random() * 3600;
    const out = pickRiftExit(game, x, y);
    assert.ok(out.x >= RIFT.exitMargin && out.x <= 4200 - RIFT.exitMargin && out.y >= RIFT.exitMargin && out.y <= 4200 - RIFT.exitMargin);
    if (out.blast) continue;
    assert.ok(Math.hypot(out.x - x, out.y - y) >= RIFT.minJump);
    for (const rock of am.getNearbyAsteroids(out.x, out.y, 2)) {
      assert.ok(Math.hypot(rock.x - out.x, rock.y - out.y) >= rock.radius + 15, 'clear of rock');
    }
  }
});

test('rifts can be switched off, and none open in the Weapon Range', () => {
  const g = run();
  TUNING.riftsEnabled = 0;
  TUNING.riftFirstDelay = 0;
  g.rifts.clear();
  tick(g, 120);
  assert.equal(g.rifts.active, null, 'off');
  TUNING.riftsEnabled = 1;
  g.range = { active: true, tick() {} };
  g.rifts.update(DT, g);
  g.rifts.update(DT, g);
  assert.equal(g.rifts.active, null, 'range');
  g.range = null;
  reset();
});
