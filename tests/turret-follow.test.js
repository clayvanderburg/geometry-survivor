import test from 'node:test';
import assert from 'node:assert/strict';

// Sentry Turret: up to 9 turrets with Sentry Turret Count, and the LV 12 Mobile Sentries transform makes
// planted turrets drift after the ship.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, TURRET_MAX_ACTIVE } = await import('../js/weapon-scaling.js');
const { makeBuild, STAT_CARDS, TRANSFORMS } = await import('../js/weapon-levels.js');
const { acquireWeapon } = await import('../js/upgrades.js');

test('Sentry Turret Count goes up to 9 turrets', () => {
  assert.equal(STAT_CARDS.turret.find((c) => c.stat === 'count').maxLevel, 6);
  assert.equal(TURRET_MAX_ACTIVE, 9);
  assert.equal(W.turretMaxActive(makeBuild('turret', 7, { count: 6 })), 9);
  assert.equal(TRANSFORMS.turret[12].id, 'mobile');
  assert.equal(TRANSFORMS.turret[18].id, 'mortar', 'Mortar Battery stays');
});

function turretGame(bt) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  acquireWeapon(p, 'turret');
  p.loadout = ['turret'];
  p.weapons.turret = 18;
  p.breakthroughs = { turret: bt };
  g.spawnWavePack = () => {};
  // A far-off immortal target keeps the turrets deploying.
  const e = g.enemyManager.getArchetype('bruiser', 1);
  g.enemyManager.enemies.push(Object.assign(e, { x: p.x + 300, y: p.y, vx: 0, vy: 0, speed: 0, hp: 1e9, maxHp: 1e9, trail: e.trail || [] }));
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  return g;
}

test('Mobile Sentries: planted turrets drift after the ship; without it they stay put', () => {
  for (const [bt, follows] of [[{ 6: 'boost', 12: 'transform', 18: 'boost' }, true], [{ 6: 'boost', 12: 'boost', 18: 'boost' }, false]]) {
    const g = turretGame(bt);
    const d = g.deployables;
    assert.ok(d.turretCount >= 3, 'turrets planted');
    const before = d.turrets.slice(0, d.turretCount).map((t) => ({ t, x: t.x, y: t.y }));
    g.player.x += 600; // the ship moves away
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const moved = before.map(({ t, x, y }) => Math.hypot(t.x - x, t.y - y));
    if (follows) {
      assert.ok(moved.every((m) => m > W.turretFollowSpeed * 0.8 && m <= W.turretFollowSpeed * 1.01 + 1), `each turret drifts ~${W.turretFollowSpeed} px in a second: ${moved.map(Math.round)}`);
    } else {
      assert.ok(moved.every((m) => m < 1e-9), 'planted turrets stay where they are');
    }
  }
});
