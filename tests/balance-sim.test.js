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
    // Starting weapons (Rocket Pods) already fire at LV 1 in the baseline: their source must grow.
    const own = Object.keys(r.dps).filter(k => r.dps[k] > 0 && (!(k in base.dps) || (w.id === 'rockets' && k === 'rocket' && r.dps[k] > base.dps[k] * 1.25)));
    assert.ok(own.length > 0, `${w.id} produced no damage source of its own: ${JSON.stringify(r.dps)}`);
  }
});

test('time-to-kill only counts enemies a weapon actually hit (Supernova sweeps and rams are excluded)', () => {
  const m = h.createMetrics();
  const game = { wave: 4, elapsedTime: 10 };
  m.kill({ type: 'swarmer', bornAt: 8 }, 'supernova', game);
  m.kill({ type: 'swarmer', bornAt: 8, firstHitAt: 9.5, hitsTaken: 1 }, 'blaster', game);
  m.kill({ type: 'swarmer', bornAt: 8, firstHitAt: 9, hitsTaken: 3 }, 'blaster', game);
  assert.equal(m.killsByType.swarmer, 3);
  const t = m.ttk['swarmer|4'];
  assert.equal(t.n, 2);
  assert.equal(t.oneHit, 1);
  assert.equal(t.hits, 4);
});

test('weapon discovery installs each card on a real fresh-run player', () => {
  const byId = Object.fromEntries(h.classifyUpgrades().map(c => [c.id, c]));
  for (const u of h.UPGRADE_POOL) assert.ok(byId[u.id], `${u.id} classified`);
  assert.equal(byId.missiles.isWeapon, true);
  assert.equal(byId.pierce.isWeapon, false);
  assert.equal(byId.multishot.isWeapon, false);
});

test('strategies cover every upgrade automatically and drop unknown ids', () => {
  const pool = [{ id: 'alpha', name: 'A' }, { id: 'evo', name: 'E', isSynergy: true }];
  const list = buildStrategies(pool, { focus: true });
  assert.ok(list.some(s => s.name === 'focus:alpha'));
  assert.ok(!list.some(s => s.name === 'focus:evo'));
  for (const s of list) assert.ok(s.priorities.every(id => id === 'synergy' || id === 'new_weapon' || id === 'alpha'));
  assert.deepEqual(buildStrategies(pool, { only: ['focus:alpha'] }).map(s => s.name), ['focus:alpha']);
});

test('card picks follow strategy priority, with evolutions matched by "synergy"', () => {
  const choices = [{ id: 'magnet' }, { id: 'evo_x', isSynergy: true }, { id: 'pierce' }];
  assert.equal(h.pickCard(choices, { priorities: ['pierce', 'synergy'] }), 2);
  assert.equal(h.pickCard(choices, { priorities: ['synergy', 'pierce'] }), 1);
});

test('strategies take NEW WEAPON and equip their preferred weapons', () => {
  const hand = [{ id: 'magnet' }, { id: 'new_weapon', isNewWeapon: true }, { id: 'pierce' }];
  assert.equal(h.pickCard(hand, { priorities: ['new_weapon', 'pierce'] }), 1);
  const picks = [{ id: 'weapon:orbitals', weaponId: 'orbitals', isWeaponPick: true }, { id: 'weapon:missiles', weaponId: 'missiles', isWeaponPick: true }];
  assert.equal(h.pickCard(picks, { priorities: [], weapons: ['missiles', 'orbitals'] }), 1);
  const focus = buildStrategies([{ id: 'missiles', name: 'M' }], { only: ['focus:missiles'] })[0];
  assert.deepEqual(focus.priorities, ['missiles', 'new_weapon']);
  assert.deepEqual(focus.weapons, ['missiles']);
});
