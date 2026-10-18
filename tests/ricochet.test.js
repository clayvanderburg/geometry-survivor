import test from 'node:test';
import assert from 'node:assert/strict';

// Ricochet Rounds: bounces fan out over a pack instead of piling onto one neighbour, skip enemies the
// bolt's own Flak burst already hit, still glance off with nobody in range, and bounce off asteroids.
const h = await import('../tools/balance/harness.mjs');
const { Game } = await import('../js/main.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
const { WeaponRange, sanitizeRangeConfig } = await import('../js/weapon-range.js');

const silent = new Proxy({}, { get: () => () => {} });

function field(enemies) {
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies: enemies.map(([x, y]) => ({ x, y, radius: 12, hp: 100, maxHp: 100, type: 'swarmer' })) },
    bullets: [], particles: silent, elapsedTime: 10
  });
}

const bolt = (extra = {}) => ({ x: 0, y: 0, vx: 20, vy: 0, damage: 10, radius: 3.8, ricochet: 1, hitEnemies: new Set(), ...extra });
const heading = (b) => Math.atan2(b.vy, b.vx);

test('a stream of ricochets claims different targets instead of all bouncing into the nearest one', () => {
  const g = field([[60, 0], [0, 90], [-100, 0], [0, -110]]);
  const picks = new Set();
  for (let k = 0; k < 4; k++) {
    const t = g.ricochetTarget(0, 0, bolt());
    t.ricochetAt = g.elapsedTime;
    picks.add(t);
  }
  assert.equal(picks.size, 4, 'four bolts, four different targets');
  g.elapsedTime += W.ricochetClaimTime + 0.01;
  assert.equal(g.ricochetTarget(0, 0, bolt()), g.enemyManager.enemies[0], 'claims expire: the nearest is fair game again');
});

test('with Flak, ricochets skip enemies inside the bolt\'s own burst', () => {
  const g = field([[30, 0], [160, 0]]);
  assert.equal(g.ricochetTarget(0, 0, bolt({ flak: true, blastRadius: 46 })), g.enemyManager.enemies[1]);
  assert.equal(g.ricochetTarget(0, 0, bolt()), g.enemyManager.enemies[0], 'plain bolts still take the nearest');
});

test('a ricochet with nobody to find still glances off at an angle', () => {
  const g = field([]);
  g.boltBreakthroughs(bolt(), null, 0, 0);
  assert.equal(g.bullets.length, 1);
  const turn = Math.abs(heading(g.bullets[0]));
  assert.ok(turn > 0.5 && turn < 1.2, `glances off ${turn.toFixed(2)} rad from the shot`);
  assert.equal(g.bullets[0].ricochet, undefined, 'a ricochet never bounces again');
});

test('Ricochet Rounds bounce off asteroids (reflecting, or snapping onto an enemy near the reflection)', () => {
  const rock = { x: 100, y: 0, radius: 30, hp: 50 };
  const g = field([]);
  g.ricochetOffRock(bolt(), rock, 70, 0);
  assert.equal(g.bullets.length, 1);
  assert.ok(g.bullets[0].vx < 0 && Math.abs(g.bullets[0].vy) < 1e-9, 'a head-on hit comes straight back');
  const g2 = field([[0, 40]]);
  g2.ricochetOffRock(bolt(), rock, 70, 0);
  const b = g2.bullets[0];
  assert.ok(Math.abs(heading(b) - Math.atan2(40, -68)) < 1e-6, 'snaps onto the enemy near the reflected path');
});

test('live: in the Weapon Range, nearly every Ricochet Rounds bounce lands on another enemy', () => {
  const g = h.createHeadlessGame();
  g.range = new WeaponRange(g, { storage: null });
  g.range.config = sanitizeRangeConfig({ weapons: [{ id: 'blaster', level: 12, bt: { 6: 'transform', 12: 'transform' } }], dummies: { count: 24, formation: 'ring', type: 'swarmer', move: 'still' } });
  g.spawnWavePack = () => {};
  g.resetRun();
  g.range.active = true;
  g.state = 'PLAYING';
  g.range.onRunStart();
  let spawned = 0, landed = 0;
  const spawn = g.spawnRicochet;
  g.spawnRicochet = function (...a) {
    spawned++;
    spawn.apply(this, a);
    const hits = this.bullets.at(-1).hitEnemies;
    const add = hits.add.bind(hits);
    hits.add = (e) => { landed++; return add(e); };
  };
  for (let i = 0; i < 4 * 60; i++) g.update(1 / 60);
  assert.ok(spawned > 40, `ricochets fly (${spawned})`);
  assert.ok(landed / spawned > 0.8, `most land (${landed}/${spawned})`);
});
