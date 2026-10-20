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
  const rock = Object.assign(am.asteroids[0], { x: p.x - 34, y: p.y - 30, radius: 18, hp: 1e9, maxHp: 1e9 });
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
  // The rock is up and behind on the port (left) side: the port claw swings to it, starboard stays home.
  assert.ok(Math.abs(wrap(p.clawAngles[0] - toRock)) < 0.4, `port claw points at the rock (${p.clawAngles[0].toFixed(2)} vs ${toRock.toFixed(2)})`);
  assert.ok(Math.abs(wrap(p.clawAngles[1] - p.hullAngle)) < 0.2, 'starboard claw stays along the hull');
});

// Independent claws: a rock dead ahead pulls both claws onto it; otherwise each claw takes the nearest
// rock on its own side, and two rocks ground at once share the twin-claw torque.
function clawRig(rocks) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.x = 2000; p.y = 2000; p.vx = p.vy = 0;
  p.hullAngle = 0;
  g.enemyManager.enemies.length = 0;
  g.spawnWavePack = () => {};
  const am = g.asteroidManager;
  const template = am.asteroids[0];
  am.asteroids.length = 0;
  for (const r of rocks) am.asteroids.push({ ...template, look: null, cracks: null, x: p.x + r.dx, y: p.y + r.dy, radius: 14, hp: 1e6, maxHp: 1e6, oreType: 'rock' });
  am.rebuildSpatialHash();
  const run = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      g.update(1 / 60);
      p.x = 2000; p.y = 2000; p.vx = p.vy = 0; p.hullAngle = 0;
    }
  };
  return { g, p, am, run };
}

test('a rock dead ahead pulls both claws onto it, even with rocks on both flanks', () => {
  const { p, am, run } = clawRig([{ dx: 52, dy: 0 }, { dx: 10, dy: -50 }, { dx: 10, dy: 50 }]);
  run(30);
  assert.ok(Math.abs(wrap(p.clawAngles[0])) < 0.25 && Math.abs(wrap(p.clawAngles[1])) < 0.25, `both claws ahead (${p.clawAngles.map((a) => a.toFixed(2))})`);
  const ahead = am.asteroids[0];
  assert.ok(ahead.hp < ahead.maxHp, 'the rock ahead is being drilled');
});

test('with nothing ahead each claw takes its own side, and the two rocks share the twin torque', () => {
  const { p, am, run } = clawRig([{ dx: 8, dy: -50 }, { dx: 8, dy: 50 }]);
  run(40);
  assert.ok(wrap(p.clawAngles[0]) < -0.8, `port claw swings left (${p.clawAngles[0].toFixed(2)})`);
  assert.ok(wrap(p.clawAngles[1]) > 0.8, `starboard claw swings right (${p.clawAngles[1].toFixed(2)})`);
  assert.deepEqual(p.clawDrilling, [true, true]);
  // One more second: each rock loses half the twin-claw rate, the pair the same as one rock under both.
  const [port, star] = am.asteroids;
  const before = [port.hp, star.hp];
  run(60);
  const dps = p.stats.miningSpeed || 75;
  const half = (dps * 1.25) / 2;
  for (const [i, rock] of [port, star].entries()) {
    const lost = before[i] - rock.hp;
    assert.ok(Math.abs(lost - half) < half * 0.05, `rock ${i} lost ${lost.toFixed(1)} (expected ~${half.toFixed(1)})`);
  }
});
