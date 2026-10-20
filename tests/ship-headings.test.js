import test from 'node:test';
import assert from 'node:assert/strict';

// The hull (wings, rocket pods, shield) faces where the ship flies; only the drill arms swing round
// to the rock being drilled.
const h = await import('../tools/balance/harness.mjs');

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('flying right past a rock behind the ship: the hull keeps facing right, the drills turn to the rock', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  g.enemyManager.enemies.length = 0;
  g.spawnWavePack = () => {};
  const am = g.asteroidManager;
  // One rock just behind and above the ship, inside drill reach, nothing else around.
  const rock = Object.assign(am.asteroids.find((r) => !r.unbreakable), { x: p.x - 34, y: p.y - 30, radius: 18, hp: 1e9, maxHp: 1e9 });
  am.asteroids.length = 0;
  am.asteroids.push(rock);
  am.rebuildSpatialHash();
  g.keys.KeyD = true;
  for (let i = 0; i < 12; i++) {
    g.update(1 / 60);
    p.x = 2000; p.y = 2000; // hold position: the ship pushes against its own velocity, rock stays behind
    rock.x = p.x - 34; rock.y = p.y - 30;
    am.rebuildSpatialHash();
  }
  assert.ok(Math.abs(wrap(p.hullAngle)) < 0.2, `hull faces the flight direction (${p.hullAngle.toFixed(2)})`);
  const toRock = Math.atan2(rock.y - p.y, rock.x - p.x);
  assert.ok(am.isDrilling, 'the rock is being drilled');
  assert.ok(Math.abs(wrap(p.drillAngle - toRock)) < 0.4, `drills point at the rock (${p.drillAngle.toFixed(2)} vs ${toRock.toFixed(2)})`);
});
