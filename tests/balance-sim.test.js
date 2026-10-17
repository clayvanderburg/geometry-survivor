import test from 'node:test';
import assert from 'node:assert/strict';

// The balance harness stubs browser services itself and drives the real Game simulation.
const h = await import('../tools/balance/harness.mjs');
const { buildStrategies } = await import('../tools/balance/strategies.mjs');

const quick = { name: 'random', priorities: [] };

test('simulated runs are deterministic per seed and leave Math.random and TUNING untouched', () => {
  const random = Math.random;
  const tuning = JSON.stringify(h.TUNING);
  const a = h.simulateRun({ strategy: quick, seed: 'det:1', maxSeconds: 25, tuning: { enemyHpMult: 1.3 } });
  const b = h.simulateRun({ strategy: quick, seed: 'det:1', maxSeconds: 25, tuning: { enemyHpMult: 1.3 } });
  const c = h.simulateRun({ strategy: quick, seed: 'det:2', maxSeconds: 25, tuning: { enemyHpMult: 1.3 } });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.dealt, c.dealt);
  assert.equal(Math.random, random);
  assert.equal(JSON.stringify(h.TUNING), tuning);
  assert.ok(a.kills > 0 && a.dealt.blaster > 0, 'the bot pilot fights with the real blaster');
});

test('the bot pilot is mortal: a brutal tuning ends the run with a recorded killer', () => {
  const r = h.simulateRun({ strategy: quick, seed: 'mortal', maxSeconds: 240, tuning: { enemyHpMult: 3, enemySpeedMult: 2 } });
  assert.equal(r.died, true);
  assert.ok(r.time < 240);
  assert.ok(r.killer, 'the killing blow is attributed to an enemy type');
  const taken = Object.values(r.taken).reduce((s, t) => s + t.dmg, 0);
  assert.ok(taken >= 100, `shield damage is tracked by enemy type (${taken})`);
});

test('every weapon card in UPGRADE_POOL is discovered and deals damage under its own source', () => {
  const classes = h.classifyUpgrades();
  const weapons = classes.filter(c => c.isWeapon && !c.isSynergy);
  assert.ok(weapons.length >= 5);
  const bench = { ...h.BENCH, seconds: 5 };
  const base = h.benchUpgrade({ scenario: 'chase', bench });
  for (const w of weapons) {
    const r = h.benchUpgrade({ upgradeId: w.id, level: 3, scenario: 'chase', bench });
    const own = Object.keys(r.dps).filter(k => !(k in base.dps) && r.dps[k] > 0);
    assert.ok(own.length > 0, `${w.id} produced no damage source of its own: ${JSON.stringify(r.dps)}`);
  }
});

test('strategies cover every upgrade automatically and drop unknown ids', () => {
  const pool = [{ id: 'alpha', name: 'A' }, { id: 'evo', name: 'E', isSynergy: true }];
  const list = buildStrategies(pool, { focus: true });
  assert.ok(list.some(s => s.name === 'focus:alpha'));
  assert.ok(!list.some(s => s.name === 'focus:evo'));
  for (const s of list) assert.ok(s.priorities.every(id => id === 'synergy' || id === 'alpha'));
  assert.deepEqual(buildStrategies(pool, { only: ['focus:alpha'] }).map(s => s.name), ['focus:alpha']);
});

test('card picks follow strategy priority, with evolutions matched by "synergy"', () => {
  const choices = [{ id: 'magnet' }, { id: 'evo_x', isSynergy: true }, { id: 'pierce' }];
  assert.equal(h.pickCard(choices, { priorities: ['pierce', 'synergy'] }), 2);
  assert.equal(h.pickCard(choices, { priorities: ['synergy', 'pierce'] }), 1);
});
