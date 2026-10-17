import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game } = await import('../js/main.js');
const { WEAPON_SCALING: W, prismStreams, prismNewestGroup } = await import('../js/weapon-scaling.js');
const deg = (r) => Math.round((r * 180) / Math.PI);

test('Prism Split adds stream pairs in a fixed order: forward, rear, sides, diagonals, flanks', () => {
  const s = (n) => prismStreams(n).map((x) => [deg(x.angle), x.lateral]);
  assert.deepEqual(s(2), [[0, -7], [0, 7]], 'two parallel forward streams to start');
  assert.deepEqual(s(4).slice(2), [[180, -7], [180, 7]], 'then two straight out the back');
  assert.deepEqual(s(6).slice(4), [[-90, 0], [90, 0]], 'then one out each side');
  assert.deepEqual(s(8).slice(6).map((x) => x[0]), [-40, 40], 'then forward diagonals');
  assert.deepEqual(s(10).slice(8).map((x) => x[0]), [-140, 140], 'then rear diagonals');
  assert.deepEqual(s(12).slice(10).map((x) => x[0]), [-20, 20], 'then flanks, forward-most first');
  for (let n = 4; n <= 20; n += 2) {
    assert.deepEqual(prismStreams(n).slice(0, n - 2), prismStreams(n - 2), `adding streams at ${n} never moves existing ones`);
  }
  assert.equal(prismNewestGroup(2), 'FORWARD');
  assert.equal(prismNewestGroup(4), 'REAR');
  assert.equal(prismNewestGroup(20), 'FORWARD x2', 'past the last slot the order doubles up');
});

function game() {
  const silent = new Proxy({}, { get: () => () => {} });
  return Object.assign(Object.create(Game.prototype), {
    bullets: [], sound: silent, grid: silent, helixAngle: 0,
    player: { x: 1000, y: 1000, radius: 15, angle: 0, drillAngle: Math.PI / 2, weapons: {}, stats: { damage: 10, bulletCount: 2, bulletSpeed: 14, pierce: 1 } }
  });
}

test('the forward pair fires straight along the aim, side by side', () => {
  const g = game();
  g.firePrimaryWeapon();
  assert.equal(g.bullets.length, 2);
  for (const b of g.bullets) {
    assert.ok(Math.abs(b.vy) < 1e-9 && b.vx > 0, 'both bolts travel straight along the aim');
  }
  assert.ok(Math.abs(g.bullets[0].y - g.bullets[1].y - -14) < 1e-9 || Math.abs(g.bullets[1].y - g.bullets[0].y - -14) < 1e-9);
});

test('wing rockets launch from both wing tips along the hull heading, not the turret aim', () => {
  const g = game(); // turret aims +x, hull heads +y
  g.fireWingRockets();
  assert.equal(g.bullets.length, 2);
  for (const r of g.bullets) {
    assert.equal(r.source, 'rocket');
    assert.ok(Math.abs(r.vx) < 1e-9 && r.vy === W.wingRocketSpeed, 'flies along the hull heading');
    assert.equal(r.damage, 10 * W.wingRocketDamageMult);
    assert.equal(r.blastDamage, r.damage * W.wingRocketBlastShare);
  }
  const xs = g.bullets.map((r) => r.x - 1000).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] + 15 * 1.12) < 1e-9 && Math.abs(xs[1] - 15 * 1.12) < 1e-9, 'one from each wing tip');
});
