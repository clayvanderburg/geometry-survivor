import test from 'node:test';
import assert from 'node:assert/strict';

// Dev tuner live retune (Game.applyLiveTuning): stats are rebuilt from runStartPlayer plus each owned card's
// own apply(), so a retune with unchanged TUNING is a no-op and a tuned base scales through the cards.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, discardWeapon, acquireWeapon } = await import('../js/upgrades.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

function upgradedGame() {
  Object.assign(TUNING, DEFAULT_TUNING);
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  for (const [id, levelJump] of [['mining_speed', 3], ['overdrive', 2], ['magnet', 2], ['thrusters', 1], ['evo_tectonic', 1]]) {
    applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump });
  }
  return g;
}

test('a live retune with unchanged TUNING leaves an upgraded ship exactly as it was', () => {
  const g = upgradedGame();
  const p = g.player;
  assert.equal(p.upgradeLevels.mining_speed, 3);
  assert.equal(p.upgradeLevels.evo_tectonic, 1);
  const before = structuredClone({ stats: p.stats, weapons: p.weapons, maxHp: p.maxHp, radius: p.radius });
  g.applyLiveTuning();
  assert.deepEqual({ stats: p.stats, weapons: p.weapons, maxHp: p.maxHp, radius: p.radius }, before);
  g.applyLiveTuning();
  assert.deepEqual(p.stats, before.stats, 'repeated retunes do not compound');
});

test('mining_speed scales only mining speed through a retune (no reach or drill size drift)', () => {
  const g = upgradedGame();
  const p = g.player;
  g.applyLiveTuning();
  const b = p.base.stats;
  assert.ok(Math.abs(p.stats.miningSpeed - b.miningSpeed * 1.12 ** 3 * 1.9) < 1e-9);
  assert.ok(Math.abs(p.stats.miningRange - b.miningRange * 1.3) < 1e-9, 'reach: Tectonic Bore only');
  assert.ok(Math.abs(p.stats.drillScale - b.drillScale * 1.25) < 1e-9, 'drill size: Tectonic Bore only');
});

test('a tuned base value scales through the owned cards', () => {
  const g = upgradedGame();
  const p = g.player;
  const before = structuredClone(p.stats);
  TUNING.baseDamage = DEFAULT_TUNING.baseDamage * 2;
  TUNING.miningSpeed = DEFAULT_TUNING.miningSpeed * 1.5;
  try {
    g.applyLiveTuning();
    assert.ok(Math.abs(p.stats.damage - before.damage * 2) < 1e-9, `damage ${p.stats.damage} vs ${before.damage * 2}`);
    assert.ok(Math.abs(p.stats.miningSpeed - before.miningSpeed * 1.5) < 1e-9);
    for (const k of ['moveSpeed', 'fireRate', 'magnetRadius', 'xpMultiplier', 'miningRange', 'drillScale', 'luck', 'critChance', 'critDamage']) {
      assert.equal(p.stats[k], before[k], `${k} untouched`);
    }
    // The run-start snapshot follows the tuner, so a discard keeps the tuned base.
    acquireWeapon(p, 'missiles');
    const tuned = p.stats.damage;
    discardWeapon(p, 'missiles');
    assert.ok(Math.abs(p.stats.damage - tuned) < 1e-9);
  } finally {
    Object.assign(TUNING, DEFAULT_TUNING);
  }
  g.applyLiveTuning();
  assert.deepEqual(p.stats, before, 'resetting the tuner restores the original stats');
});
