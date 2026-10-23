import test from 'node:test';
import assert from 'node:assert/strict';

// Rocket Pods: every launch sound puts its rockets on screen. Regression (v0.46.0 playtest): while the ship
// mined, the pod buried in the rock face launched inside the rock and its rocket died on its first tick,
// unseen, under the launch sound; and a rocket stopped by cover vanished in two sparks.
const h = await import('../tools/balance/harness.mjs');
const { acquireWeapon } = await import('../js/upgrades.js');
const { weaponBuild } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');

// The ship held still at (2000, 2000) facing right, one target up-right, and optionally a rock touching
// the hull on the (dx, dy) side. Returns launch times and how many frames each rocket was drawn.
function volleys(side, seconds = 5) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  acquireWeapon(p, 'rockets');
  g.spawnWavePack = () => {};
  g.enemyManager.enemies.length = 0;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  g.enemyManager.enemies.push(Object.assign(e, { x: p.x + 400, y: p.y - 200, hp: 1e9, maxHp: 1e9, trail: [] }));
  g.enemyManager.update = () => {};
  const am = g.asteroidManager;
  const template = am.asteroids.find((r) => !r.unbreakable);
  am.asteroids.length = 0;
  const R = 60;
  const rock = side && Object.assign({ ...template, look: null, cracks: null }, { radius: R, hp: 1e9, maxHp: 1e9, oreType: 'rock' });
  if (rock) am.asteroids.push(rock);
  g.autoFire = true;
  g.autoAim = true;
  g.mouse = { x: 0, y: 0, down: false };
  let clock = 0;
  const launches = [];
  let bursts = 0;
  g.sound = new Proxy({}, { get: (t, k) => (k === 'playRocketLaunch' ? () => launches.push(clock) : () => {}) });
  const burst = g.rocketRockBurst.bind(g);
  g.rocketRockBurst = (...a) => { bursts++; return burst(...a); };
  const frames = new Map();
  for (let i = 0; i < seconds * 60; i++) {
    p.x = 2000; p.y = 2000; p.vx = p.vy = 0; p.hullAngle = 0;
    if (rock) { rock.x = p.x + side[0] * (p.radius + R - 4); rock.y = p.y + side[1] * (p.radius + R - 4); am.rebuildSpatialHash(); }
    g.update(1 / 60);
    clock += 1 / 60;
    for (const b of g.bullets) if (b.kind === 'rocket') frames.set(b, (frames.get(b) || 0) + 1);
  }
  return { g, p, launches, frames: [...frames.values()], bursts };
}

test('every Rocket Pod launch sound puts its rockets on screen, on a steady beat', () => {
  for (const side of [null, [0, 1], [0, -1], [-1, 0]]) {
    const { p, launches, frames } = volleys(side);
    const count = W.wingRocketCount(weaponBuild(p, 'rockets'));
    assert.ok(launches.length >= 8, `${side}: volleys fired`);
    assert.equal(frames.length, launches.length * count, `${side}: ${count} rockets per launch sound`);
    assert.ok(frames.every((n) => n >= 4), `${side}: every rocket is drawn for several frames`);
    const cd = W.wingRocketCooldown(weaponBuild(p, 'rockets'));
    for (let i = 1; i < launches.length; i++) {
      const gap = launches[i] - launches[i - 1];
      assert.ok(Math.abs(gap / cd - 1) <= 0.1, `${side}: interval ${gap.toFixed(3)} s within 10% of ${cd} s`);
    }
  }
});

test('a rocket stopped by cover bursts on the rock face, and no damage gets through', () => {
  const { g, launches, frames, bursts } = volleys([1, 0]); // nose in the rock, target beyond it
  assert.equal(frames.length, launches.length * 2, 'the rockets still launch');
  assert.equal(bursts, frames.length, 'each one bursts on the rock');
  assert.equal(g.enemyManager.enemies[0].hp, 1e9, 'the rock is cover');
});
