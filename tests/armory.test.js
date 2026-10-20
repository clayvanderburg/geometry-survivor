import test from 'node:test';
import assert from 'node:assert/strict';

// Void Armory (permanent upgrades): single-stat, many small ranks, escalating costs, a one-time reset of
// old saves, and every upgrade actually reaching the run. The balance harness builds a real headless Game.
const h = await import('../tools/balance/harness.mjs');
const {
  META_UPGRADES, META_BY_ID, ARMORY_CATEGORIES, ARMORY_VERSION, STARTING_CORES, armoryCost, armoryBonuses, formatArmoryValue, armorySpent,
  normalizeSave, ProgressionManager
} = await import('../js/progression.js');
const { TUNING } = await import('../js/config.js');
const { rerollCost, goldPerVein } = await import('../js/gold.js');

function gameWithRanks(ranks) {
  const g = h.createHeadlessGame();
  Object.assign(g.progression.data.ranks, ranks);
  g.resetRun();
  g.state = 'PLAYING';
  return g;
}

test('every armory upgrade is a single stat with many small, escalating ranks', () => {
  assert.ok(META_UPGRADES.length >= 18, 'lots of options');
  const ids = new Set();
  for (const u of META_UPGRADES) {
    assert.ok(!ids.has(u.id)); ids.add(u.id);
    assert.ok(ARMORY_CATEGORIES.some((c) => c.id === u.cat), `${u.id} has a category`);
    assert.equal(typeof u.stat, 'string');
    assert.ok(Number.isFinite(u.per) && u.per !== 0);
    assert.ok(u.growth > 1, `${u.id} costs escalate`);
    if (u.id !== 'bombs') assert.ok(u.maxRank >= 15, `${u.id} goes far`);
    for (let r = 1; r < u.maxRank; r++) assert.ok(armoryCost(u, r) >= armoryCost(u, r - 1));
  }
  // Early ranks are cheap (a first run buys something); maxing everything is a long grind.
  assert.ok(META_UPGRADES.filter((u) => armoryCost(u, 0) <= 15).length >= 8);
  const total = META_UPGRADES.reduce((sum, u) => sum + Array.from({ length: u.maxRank }, (_, r) => armoryCost(u, r)).reduce((a, b) => a + b, 0), 0);
  assert.ok(total > 50_000, `max-out total ${total} cores (~700 cores/hour before Void Core Gain)`);
});

test('bonuses: each rank adds its single step; reductions are capped', () => {
  const none = armoryBonuses({});
  assert.equal(none.damageMult, 1);
  assert.equal(none.extraBombs, 0);
  const b = armoryBonuses({ damage: 10, armor: 30, dash: 25, maxHp: 5, critChance: 5, startGold: 3, bombs: 2 });
  assert.ok(Math.abs(b.damageMult - 1.1) < 1e-9);
  assert.ok(Math.abs(b.damageTakenMult - 0.88) < 1e-9, '30 ranks of plating: -12% damage taken');
  assert.ok(Math.abs(b.dashCooldownMult - 0.75) < 1e-9);
  assert.equal(b.bonusHp, 7.5);
  assert.ok(Math.abs(b.critChanceBonus - 0.02) < 1e-9);
  assert.equal(b.startGold, 6);
  assert.equal(b.extraBombs, 2);
  assert.equal(formatArmoryValue(META_BY_ID.damage, 10), '+10%');
  assert.equal(formatArmoryValue(META_BY_ID.armor, 10), '-4.0%');
  assert.equal(formatArmoryValue(META_BY_ID.maxHp, 3), '+5');
});

test('an old save is reset once (ranks + cores), keeping callsign, high scores and the Field Guide', () => {
  const old = { pilotName: 'VEGA', cores: 9999, totalRuns: 40, ranks: { damage: 8, maxHp: 8, haste: 6 },
    guide: { seen: ['swarmer'], fresh: [] }, highscores: [{ id: 'r1', name: 'VEGA', score: 99999, wave: 50, multiplier: 30, kills: 9000, timeStr: '18:20' }] };
  const save = normalizeSave(old);
  assert.equal(save.cores, STARTING_CORES);
  assert.ok(Object.values(save.ranks).every((r) => r === 0));
  assert.equal(save.armory, ARMORY_VERSION);
  assert.equal(save.armoryResetNotice, true);
  assert.equal(save.pilotName, 'VEGA');
  assert.equal(save.totalRuns, 40);
  assert.deepEqual(save.guide.seen, ['swarmer']);
  assert.equal(save.highscores[0].score, 99999);
  // Loading the migrated save again keeps new progress (no second wipe); the notice stays until dismissed.
  save.cores = 500; save.ranks.damage = 3;
  const again = normalizeSave(JSON.parse(JSON.stringify(save)));
  assert.equal(again.cores, 500);
  assert.equal(again.ranks.damage, 3);
  assert.equal(again.armoryResetNotice, true);
  // A brand-new player gets no notice.
  assert.equal(normalizeSave({}).armoryResetNotice, false);
});

test('buying: costs escalate, insufficient cores and max rank refuse, the notice dismisses', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set('vectra_survivor_save_v2', JSON.stringify({ pilotName: 'ACE', cores: 50 }));
  const prog = new ProgressionManager();
  assert.equal(prog.data.armoryResetNotice, true, 'old save: reset notice');
  assert.equal(JSON.parse(store.get('vectra_survivor_save_v2')).armory, ARMORY_VERSION, 'the reset is persisted at once');
  prog.data.cores = 30;
  const dmg = META_BY_ID.damage;
  assert.equal(prog.getUpgradeCost(dmg), 9);
  assert.equal(prog.buyUpgrade('damage'), true);
  assert.equal(prog.data.cores, 21);
  assert.equal(prog.getUpgradeCost(dmg), armoryCost(dmg, 1));
  assert.ok(armoryCost(dmg, 1) > 9);
  prog.data.cores = 5;
  assert.equal(prog.buyUpgrade('damage'), false, 'not enough cores');
  assert.equal(prog.data.cores, 5);
  prog.data.ranks.bombs = META_BY_ID.bombs.maxRank;
  prog.data.cores = 1e9;
  assert.equal(prog.buyUpgrade('bombs'), false, 'max rank');
  assert.equal(prog.buyUpgrade('nope'), false);
  prog.dismissArmoryNotice();
  assert.equal(JSON.parse(store.get('vectra_survivor_save_v2')).armoryResetNotice, false);
});

test('REFUND ALL resets every rank and pays back exactly what was spent', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set('vectra_survivor_save_v2', JSON.stringify({ armory: ARMORY_VERSION, pilotName: 'ACE', cores: 2000 }));
  const prog = new ProgressionManager();
  assert.equal(prog.refundAll(), 0, 'nothing bought, nothing refunded');
  assert.equal(prog.data.cores, 2000);
  for (const id of ['damage', 'damage', 'damage', 'maxHp', 'luck', 'bombs']) assert.equal(prog.buyUpgrade(id), true);
  const spent = 2000 - prog.data.cores;
  assert.equal(armorySpent(prog.data.ranks), spent);
  assert.equal(prog.refundAll(), spent);
  assert.equal(prog.data.cores, 2000, 'every core back');
  assert.ok(META_UPGRADES.every((u) => prog.getRank(u.id) === 0), 'every rank back to 0');
  const saved = JSON.parse(store.get('vectra_survivor_save_v2'));
  assert.equal(saved.cores, 2000, 'persisted');
  assert.equal(saved.ranks.damage, 0);
});

test('every armory stat reaches the run', () => {
  const base = gameWithRanks({});
  const g = gameWithRanks({ damage: 10, critChance: 10, critDamage: 10, area: 10, maxHp: 10, armor: 20, phase: 5,
    moveSpeed: 10, dash: 20, coreYield: 10, xpGain: 10, goldGain: 10, startGold: 5, mining: 10, luck: 10, magnet: 10, reroll: 10, miningReach: 10, bombs: 1 });
  const p = g.player, b = base.player;
  const near = (a, e, msg) => assert.ok(Math.abs(a - e) < 1e-6, `${msg}: ${a} vs ${e}`);
  near(p.stats.damage, b.stats.damage * 1.1, 'damage');
  near(p.stats.critChance, b.stats.critChance + 0.04, 'crit chance');
  near(p.stats.critDamage, b.stats.critDamage + 0.2, 'crit damage');
  near(p.stats.areaMult, 1.1, 'area');
  near(p.maxHp, b.maxHp + 15, 'max shield');
  near(p.stats.moveSpeed, b.stats.moveSpeed * 1.08, 'move speed');
  near(p.stats.coreDropMult, b.stats.coreDropMult * 1.2, 'core gain');
  near(p.stats.xpMultiplier, b.stats.xpMultiplier * 1.1, 'xp');
  near(p.stats.miningSpeed, b.stats.miningSpeed * 1.3, 'mining speed');
  near(p.stats.miningRange, b.stats.miningRange * 1.2, 'drill reach');
  near(p.stats.luck, b.stats.luck + 0.2, 'luck');
  near(p.stats.magnetRadius, b.stats.magnetRadius * 1.2, 'pickup radius');
  assert.equal(p.bombs, b.bombs + 1);
  assert.equal(g.gold, 10, 'starting gold');
  near(g.rerollPrice(), Math.round(rerollCost(0) * 0.8), 'reroll discount');
  near(p.goldMult, 1.4, 'gold per vein');
  // Damage taken and post-hit invulnerability.
  p.hp = p.maxHp = 100; b.hp = b.maxHp = 100;
  g.damagePlayer(20); base.damagePlayer(20);
  near(100 - p.hp, 18.4, 'plating: -8% damage taken');
  near(p.invuln, b.invuln + 0.05, 'phase buffer');
  // Dash cooldown.
  g.triggerDash(); base.triggerDash();
  near(p.dashCooldown, b.dashCooldown * 0.8, 'dash cooldown');
  // Live tuning recompute keeps the armory bonuses (crit and drill reach included).
  g.applyLiveTuning();
  near(p.stats.critChance, b.stats.critChance + 0.04, 'crit chance after a live retune');
  near(p.stats.miningRange, b.stats.miningRange * 1.2, 'drill reach after a live retune');
  assert.ok(goldPerVein() >= 1);
});

test('the retired Chronos Capacitor (Autocannon fire rate) refunds every core spent on it, once', async () => {
  const { normalizeSave, retiredRefund, armoryCost, RETIRED_UPGRADES } = await import('../js/progression.js');
  const spent = [0, 1, 2, 3, 4, 5, 6].reduce((n, r) => n + armoryCost(RETIRED_UPGRADES.fireRate, r), 0);
  assert.equal(retiredRefund({ fireRate: 7 }), spent);
  const save = normalizeSave({ armory: 2, cores: 100, ranks: { damage: 3, fireRate: 7 } });
  assert.equal(save.cores, 100 + spent, 'cores come back');
  assert.equal(save.ranks.fireRate, undefined, 'the upgrade is gone from the save');
  assert.equal(save.ranks.damage, 3);
  assert.equal(normalizeSave(save).cores, 100 + spent, 'a second load does not refund again');
});

test('every upgrade\'s last rank costs about ARMORY_TOP_COST cores (or more, never cheaper than before)', async () => {
  const { META_UPGRADES, armoryCost, ARMORY_TOP_COST } = await import('../js/progression.js');
  for (const u of META_UPGRADES) {
    const last = armoryCost(u, u.maxRank - 1);
    assert.ok(last >= ARMORY_TOP_COST * 0.98, `${u.id}: last rank ${last}`);
    assert.ok(armoryCost(u, 0) === Math.round(u.baseCost), `${u.id}: first rank stays cheap`);
  }
});

test('the developer\'s test pilots (NOX, MADKING) lose cores, ranks and their local runs once', async () => {
  const { normalizeSave, DEV_WIPE, STARTING_CORES } = await import('../js/progression.js');
  const run = (name, score) => ({ id: name + score, name, score, wave: 10, multiplier: 2, kills: 100, timeStr: '03:00', mode: 'normal' });
  const old = { armory: 2, pilotName: 'madking', cores: 5000, ranks: { damage: 20 }, highscores: [run('MADKING', 900), run('NOX', 800), run('ACE', 700)] };
  const save = normalizeSave(old);
  assert.equal(save.cores, STARTING_CORES);
  assert.equal(save.ranks.damage, 0);
  assert.deepEqual(save.highscores.map((e) => e.name), ['ACE']);
  assert.equal(save.devWipe, DEV_WIPE.id);
  save.cores = 300; save.ranks.damage = 2;
  const again = normalizeSave(save);
  assert.equal(again.cores, 300, 'only once');
  assert.equal(again.ranks.damage, 2);
  const other = normalizeSave({ armory: 2, pilotName: 'VEGA', cores: 5000, ranks: { damage: 20 } });
  assert.equal(other.cores, 5000, 'other pilots keep everything');
  assert.equal(other.ranks.damage, 20);
});
