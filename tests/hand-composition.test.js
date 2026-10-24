import test from 'node:test';
import assert from 'node:assert/strict';

// Hand composition (upgrades.js handWeights): weapon cards hold TUNING.handWeaponShare of a level-up hand's
// weight whatever the loadout, so global and utility cards keep turning up with a full loadout and weapon cards
// keep their majority with 1. Supply caches keep the raw weights.
const h = await import('../tools/balance/harness.mjs');
const { handWeights, isWeaponCard, eligibleUpgrades, cardWeight, acquireWeapon } = await import('../js/upgrades.js');
const { TUNING } = await import('../js/config.js');
const { handComposition } = await import('../tools/hand-composition.mjs');

function player(weapons) {
  const g = h.createHeadlessGame();
  g.resetRun();
  for (const id of weapons) acquireWeapon(g.player, id);
  return g.player;
}

const weaponShare = (p, pool, weights) => {
  let w = 0, all = 0;
  pool.forEach((u, i) => { all += weights[i]; if (isWeaponCard(u)) w += weights[i]; });
  return w / all;
};

test('weapon cards hold handWeaponShare of a level-up hand\'s weight with 1 to 5 weapons (a full loadout)', () => {
  const extra = ['rockets', 'missiles', 'lightning', 'glaive'];
  for (let n = 0; n <= extra.length; n++) {
    const p = player(extra.slice(0, n));
    const pool = eligibleUpgrades(p);
    const share = weaponShare(p, pool, handWeights(p, pool));
    assert.ok(Math.abs(share - (TUNING.handWeaponShare ?? 0.55)) < 1e-9, `${n + 1} weapons: ${share}`);
  }
});

test('the rescale only moves weapon cards as a group: ratios inside each group are unchanged', () => {
  const p = player(['rockets', 'missiles', 'lightning', 'glaive']);
  const pool = eligibleUpgrades(p);
  const raw = pool.map((u) => cardWeight(u, p.stats.luck || 1, p));
  const w = handWeights(p, pool);
  const ratio = (pick) => {
    const idx = pool.map((u, i) => i).filter((i) => pick(pool[i]));
    return idx.map((i) => w[i] / raw[i]);
  };
  for (const group of [ratio(isWeaponCard), ratio((u) => !isWeaponCard(u))]) {
    assert.ok(group.length > 1);
    for (const r of group) assert.ok(Math.abs(r - group[0]) < 1e-9, 'one factor per group');
  }
  assert.ok(ratio((u) => !isWeaponCard(u)).every((r) => Math.abs(r - 1) < 1e-9), 'non-weapon cards keep their raw weights');
});

test('supply caches keep the raw weights', () => {
  const p = player(['rockets', 'missiles', 'lightning']);
  const pool = eligibleUpgrades(p, { cache: true });
  const raw = pool.map((u) => cardWeight(u, p.stats.luck || 1, p));
  assert.deepEqual(handWeights(p, pool, undefined, { cache: true }), raw);
});

test('real hands: weapon cards are 50-70% of offers and most 4-card hands hold a non-weapon card, at any loadout', () => {
  for (const n of [1, 3, 5]) {
    const r = handComposition(n, { players: 40, hands: 20, seed: 'test' });
    assert.ok(r.weapon > 0.5 && r.weapon < 0.7, `${n} weapons: weapon cards ${(r.weapon * 100).toFixed(0)}% of offers`);
    assert.ok(r.global > 0.15, `${n} weapons: global cards ${(r.global * 100).toFixed(0)}% of offers`);
    if (r.handSize >= 4) assert.ok(r.handsWithOther > 0.8, `${n} weapons: ${(r.handsWithOther * 100).toFixed(0)}% of hands hold a non-weapon card`);
  }
});

test('the global cards turn up about as often as Reactor Overdrive; Replicator Array stays rare', () => {
  const r = handComposition(5, { players: 60, hands: 25, seed: 'parity' });
  const od = r.perCard.overdrive;
  assert.ok(od > 0.04, `Overdrive in ${(od * 100).toFixed(1)}% of hands`);
  for (const id of ['tempo_core', 'cooldown_matrix', 'velocity_coils', 'tag_area']) {
    const ratio = (r.perCard[id] || 0) / od;
    assert.ok(ratio > 0.6 && ratio < 1.6, `${id}: ${ratio.toFixed(2)}x Overdrive's offer rate`);
  }
  assert.ok((r.perCard.replicator_array || 0) < od / 2, 'Replicator Array stays rare');
});
