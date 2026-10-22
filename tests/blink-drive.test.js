import test from 'node:test';
import assert from 'node:assert/strict';

// Blink Drive: a UTILITY card that turns Phase Dash into a teleport. The headless harness runs the real
// Game.triggerDash / Game.blink, cards and gas trail.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, upgradeKind, canOvercharge, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_SCALING: W, gasCloudRadius } = await import('../js/weapon-scaling.js');
const { describeUpgrade } = await import('../js/upgrade-cards.js');

function freshGame() {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.enemyManager.enemies.length = 0;
  const p = g.player;
  Object.assign(p, { x: 2000, y: 2000, vx: 0, vy: 0, angle: 0, dashCooldown: 0 });
  g.asteroidManager.getNearbyAsteroids = () => [];
  return { g, p };
}
const install = (p, lv = 1) => applyUpgradeLevels(p, { ...UPGRADE_BY_ID.blink_drive, levelJump: lv });

test('Blink Drive is a 3-rank UTILITY card that never overcharges, and its card previews the blink', () => {
  const u = UPGRADE_BY_ID.blink_drive;
  assert.equal(u.category, 'UTILITY');
  assert.equal(u.maxLevel, 3);
  assert.equal(upgradeKind(u), 'general');
  assert.equal(canOvercharge(u), false);
  const { p } = freshGame();
  const card = describeUpgrade(p, { ...u, levelJump: 1 });
  assert.equal(card.headline, 'DASH BLINKS');
  install(p);
  assert.equal(describeUpgrade(p, { ...u, levelJump: 1 }).headline, `+${Math.round((W.blinkDistance(2) / W.blinkDistance(1) - 1) * 100)}% BLINK DISTANCE`);
});

test('without the card the dash is the old speed burst; with it the ship teleports the blink distance along its motion', () => {
  const plain = freshGame();
  plain.p.vx = 3;
  plain.g.triggerDash();
  assert.equal(plain.p.x, 2000, 'a normal dash does not move the ship at once');
  assert.ok(plain.p.vx > plain.p.stats.moveSpeed * 3, 'it bursts forward');

  const { g, p } = freshGame();
  install(p);
  p.vx = 0; p.vy = 3; // flying south
  g.triggerDash();
  assert.ok(Math.abs(p.x - 2000) < 1e-6 && Math.abs(p.y - (2000 + W.blinkDistance(1))) < 1e-6, `landed at ${p.x}, ${p.y}`);
  assert.ok(p.invuln > 0, 'still invulnerable through the dash window');
  assert.ok(p.dashCooldown > 0, 'and it costs the dash cooldown');
  assert.ok(Math.abs(p.vy - p.stats.moveSpeed) < 1e-9, 'cruising on at normal speed');
  // Parked: it blinks along the aim. More ranks blink further.
  const q = freshGame();
  install(q.p, 3);
  q.p.angle = Math.PI;
  q.g.triggerDash();
  assert.ok(Math.abs(q.p.x - (2000 - W.blinkDistance(3))) < 1e-6);
});

test('the blink stops at the arena wall and short of rocks', () => {
  const { g, p } = freshGame();
  install(p);
  p.x = g.worldWidth - 100;
  p.vx = 3;
  g.triggerDash();
  assert.ok(p.x <= g.worldWidth - (p.radius + 24) + 1e-9, 'inside the arena');
  const r = freshGame();
  install(r.p);
  const rock = { x: 2000 + W.blinkDistance(1), y: 2000, radius: 60, hp: 100 };
  r.g.asteroidManager.getNearbyAsteroids = () => [rock];
  r.p.vx = 3;
  r.g.triggerDash();
  assert.ok(Math.hypot(rock.x - r.p.x, rock.y - r.p.y) >= rock.radius + r.p.radius, 'lands clear of the rock');
  assert.ok(r.p.x > 2000, 'but still blinks forward');
});

test('the gas cloud stays where the ship took off; the dash nova goes off where it lands', () => {
  const { g, p } = freshGame();
  install(p);
  acquireWeapon(p, 'gas');
  applyUpgradeLevels(p, UPGRADE_BY_ID.thrusters);
  const near = g.enemyManager.getArchetype('swarmer', 1);
  g.enemyManager.enemies.push(Object.assign(near, { x: 2000 + W.blinkDistance(1) + 20, y: 2000, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, trail: near.trail || [] }));
  p.vx = 3;
  g.update(1 / 60); // the trail learns its cloud size
  p.x = 2000; p.y = 2000; p.vx = 3; p.vy = 0;
  g.triggerDash();
  const cloud = g.gasTrail.puffs[g.gasTrail.count - 1];
  assert.ok(Math.abs(cloud.x - 2000) < 1e-6, 'the dash cloud is at the take-off point');
  assert.ok(Math.abs(cloud.radius - gasCloudRadius(p) * W.gasDashRadiusMult) < 1e-6);
  assert.ok(near.hp < near.maxHp, 'the nova hit the enemy at the landing point');
});

test('Phase Dash Extender: 5 ranks, +20% dash distance each (blinks too), invulnerable for the whole dash', () => {
  const u = UPGRADE_BY_ID.dash_range;
  assert.equal(u.category, 'UTILITY');
  assert.equal(u.maxLevel, 5);
  assert.equal(canOvercharge(u), false);
  const travel = (ranks) => {
    const { g, p } = freshGame();
    if (ranks) applyUpgradeLevels(p, { ...u, levelJump: ranks });
    p.vx = 1; p.vy = 0;
    g.triggerDash();
    const invuln = p.invuln;
    const x0 = 2000;
    while (p.dashTimer > 0) g.update(1 / 60);
    return { dist: p.x - x0, invuln, timer: W.dashDuration * W.dashDistanceMult(ranks) };
  };
  const base = travel(0);
  const far = travel(5);
  assert.ok(far.dist > base.dist * 1.8, `rank 5 dashes ~2x as far (${base.dist.toFixed(0)} -> ${far.dist.toFixed(0)} px)`);
  assert.ok(far.invuln >= far.timer, 'untouchable for the whole dash');
  // The card previews the dash distance; with Blink Drive it stretches the blink instead.
  const { p } = freshGame();
  const card = describeUpgrade(p, { ...u, levelJump: 1 });
  const before = W.dashDistance(p.stats.moveSpeed, 0), after = W.dashDistance(p.stats.moveSpeed, 1);
  assert.equal(card.headline, `+${Math.round((after / before - 1) * 100)}% DASH DISTANCE`);
  const q = freshGame();
  install(q.p);
  applyUpgradeLevels(q.p, { ...u, levelJump: 2 });
  q.p.vx = 3;
  q.g.triggerDash();
  assert.ok(Math.abs(q.p.x - (2000 + W.blinkDistance(1) * W.dashDistanceMult(2))) < 1e-6, 'a longer blink');
});

test('upgrade cards never show pixel counts: size and reach read as relative gains', async () => {
  const { STAT_ROWS } = await import('../js/upgrade-cards.js');
  const { p } = freshGame();
  for (const row of STAT_ROWS) {
    for (const text of [row.unit, row.label, row.fmt?.(120)]) assert.ok(!/\bpx\b/i.test(String(text ?? '')), `${row.id}: "${text}"`);
    if (row.newText) assert.ok(!/\bpx\b/i.test(row.newText(120, row)), `${row.id} newText`);
  }
  assert.equal(STAT_ROWS.find((r) => r.id === 'railWidth').headline, 'size');
  void p;
});
