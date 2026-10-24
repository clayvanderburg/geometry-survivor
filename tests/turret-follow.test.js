import test from 'node:test';
import assert from 'node:assert/strict';

// Sentry Turret: the Breakthroughs are DRG: Survivor's overclocks, and the LV 12 Formation Thrusters transform
// (id 'mobile', once Mobile Sentries) makes deployed turrets fly after the ship.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, TURRET_MAX_ACTIVE } = await import('../js/weapon-scaling.js');
const { makeBuild, STAT_CARDS, TRANSFORMS } = await import('../js/weapon-levels.js');
const { acquireWeapon } = await import('../js/upgrades.js');

test('Sentry Turret Breakthroughs follow the DRG overclocks: Extra Capacity, Formation Thrusters, LMG Overload', () => {
  assert.deepEqual([6, 12, 18].map((m) => TRANSFORMS.turret[m].id), ['capacity', 'mobile', 'overload']);
  assert.deepEqual([6, 12, 18].map((m) => TRANSFORMS.turret[m].name), ['Extra Capacity', 'Formation Thrusters', 'LMG Overload']);
  assert.deepEqual(STAT_CARDS.turret.map((c) => c.stat), ['damage', 'rate', 'reload', 'pierce']);
  assert.equal(W.turretFireRate(makeBuild('turret', 18, {}, { 18: 'transform' })), 2 * W.turretFireRate(makeBuild('turret', 18)), 'LMG Overload doubles the fire rate');
  // The pool holds every turret the fastest reload keeps out, plus a full bank.
  const fastest = makeBuild('turret', 18, { reload: 8 }, { 6: 'transform' });
  assert.ok(TURRET_MAX_ACTIVE >= Math.ceil(W.turretDuration(fastest) / W.turretReload(fastest)) + W.turretCharges(fastest));
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

test('Formation Thrusters: deployed turrets fly after the ship on lit jets; without it they hold position', () => {
  for (const [bt, follows] of [[{ 6: 'boost', 12: 'transform', 18: 'boost' }, true], [{ 6: 'boost', 12: 'boost', 18: 'boost' }, false]]) {
    const g = turretGame(bt);
    const d = g.deployables;
    assert.ok(d.turretCount >= 2, 'turrets planted');
    const before = d.turrets.slice(0, d.turretCount).map((t) => ({ t, x: t.x, y: t.y }));
    g.player.x += 600; // the ship moves away
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const moved = before.map(({ t, x, y }) => Math.hypot(t.x - x, t.y - y));
    if (follows) {
      assert.ok(moved.every((m) => m > W.turretFollowSpeed * 0.8 && m <= W.turretFollowSpeed * 1.01 + 1), `each turret drifts ~${W.turretFollowSpeed} px in a second: ${moved.map(Math.round)}`);
      assert.ok(before.every(({ t }) => t.jet > 0.5 && t.jetX > 0.9), 'their thrusters burn, pointed along the way they fly');
    } else {
      assert.ok(moved.every((m) => m < 1e-9), 'planted turrets stay where they are');
    }
  }
});
