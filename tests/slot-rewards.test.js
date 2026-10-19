import test from 'node:test';
import assert from 'node:assert/strict';

// Slot rewards (js/slot-rewards.js): level-up hands grow with weapons equipped (2 / 3 / 3 / 4 cards),
// slots 3 and 5 add +5% damage to every weapon, the weapon filling slot 6 starts with its LV 6
// Breakthrough (once per run), and the NEW WEAPON pick can be rerolled with gold (40, 80, 160...).
// The balance harness stubs the browser and builds a real Game, so the level-up flow is the game's own.
const h = await import('../tools/balance/harness.mjs');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { PAD } = await import('../js/gamepad.js');
const { acquireWeapon, discardWeapon, pendingBreakthroughs, applyUpgradeLevels, rollWeaponPicks, UPGRADE_BY_ID } = await import('../js/upgrades.js');
const { ownedWeapons, unownedWeapons, weaponLevel } = await import('../js/loadout.js');
const { weaponDamage } = await import('../js/weapon-scaling.js');
const { describeNewWeapon, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { handSizeFor, loadoutDamageMult, loadoutDamageMultFor, slotReward } = await import('../js/slot-rewards.js');
const { weaponRerollCost } = await import('../js/gold.js');

const odds = (chance, pity = 99) => ({
  newWeaponChanceBy1: chance, newWeaponChanceBy2: chance, newWeaponChanceBy3: chance, newWeaponChanceBy4: chance, newWeaponChanceBy5: chance,
  newWeaponPity: pity, newWeaponPityOne: pity
});

function withTuning(values, fn) {
  const saved = { ...TUNING };
  Object.assign(TUNING, values);
  try { return fn(); } finally { Object.assign(TUNING, saved); }
}

function freshGame(weapons = [], gold = 0) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.gold = gold;
  for (const id of weapons) acquireWeapon(g.player, id);
  return g;
}

const ALL_BUT_BLASTER = ['rockets', 'missiles', 'lightning', 'singularity', 'orbitals', 'mines', 'turret', 'drones', 'grenades'];

test('tuning: slot damage bonus and the weapon pick reroll price live in TUNING', () => {
  assert.equal(DEFAULT_TUNING.slotDamageBonus, 0.05);
  assert.equal(DEFAULT_TUNING.goldWeaponRerollCost, 40);
  const keys = TUNING_SCHEMA.flatMap((grp) => grp.items).map((i) => i.key);
  for (const k of ['slotDamageBonus', 'goldWeaponRerollCost']) assert.ok(keys.includes(k), k);
});

test('hand size: 2 cards with one weapon, 3 with two or three, 4 from four', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(handSizeFor), [2, 3, 3, 4, 4, 4]);
  for (const [extra, size] of [[0, 2], [1, 3], [2, 3], [3, 4], [5, 4]]) {
    const g = freshGame(ALL_BUT_BLASTER.slice(0, extra));
    withTuning(odds(0), () => g.triggerLevelUp());
    assert.equal(g.currentChoices.length, size, `${extra + 1} weapons`);
    g.handRerolls = 0;
    g.gold = 100;
    g.rerollHand();
    assert.equal(g.currentChoices.length, size, 'a reroll keeps the size');
  }
  // One weapon and a NEW WEAPON card: it takes one of the two cards.
  const g = freshGame();
  withTuning(odds(1), () => g.triggerLevelUp());
  assert.equal(g.currentChoices.length, 2);
  assert.equal(g.currentChoices.filter((c) => c.isNewWeapon).length, 1);
});

test('damage: +5% for every weapon at 3 equipped and +10% at 5; a discard takes it back', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => +loadoutDamageMultFor(n).toFixed(3)), [1, 1, 1.05, 1.05, 1.1, 1.1]);
  const g = freshGame();
  const p = g.player;
  const base = weaponDamage(p, 'blaster');
  const ratio = () => weaponDamage(p, 'blaster') / base;
  acquireWeapon(p, 'rockets');
  assert.equal(ratio(), 1);
  acquireWeapon(p, 'missiles');
  assert.ok(Math.abs(ratio() - 1.05) < 1e-9, '3 weapons');
  acquireWeapon(p, 'lightning');
  acquireWeapon(p, 'mines');
  assert.ok(Math.abs(ratio() - 1.1) < 1e-9, '5 weapons');
  discardWeapon(p, 'mines');
  assert.ok(Math.abs(ratio() - 1.05) < 1e-9, 'back to 4 weapons');
  // Fixtures without a loadout get no bonus.
  assert.equal(loadoutDamageMult({ stats: {} }), 1);
});

test('slot 6: that weapon starts with its LV 6 Breakthrough, once per run, in place of its LV 6 one', () => {
  const g = freshGame(['rockets', 'missiles', 'lightning', 'mines']);
  const p = g.player;
  assert.deepEqual(pendingBreakthroughs(p, 'mines'), [], 'slot 5 gets no Breakthrough');
  // Take the 6th weapon through the real level-up flow.
  withTuning(odds(1), () => g.triggerLevelUp());
  g.selectUpgrade(g.currentChoices.findIndex((c) => c.isNewWeapon));
  assert.equal(g.handPhase, 'weapon');
  const id = g.currentChoices[0].weaponId;
  g.selectUpgrade(0);
  assert.equal(ownedWeapons(p).length, 6);
  assert.equal(weaponLevel(p, id), 1);
  assert.equal(g.handPhase, 'breakthrough', 'the Breakthrough opens right away');
  assert.deepEqual(g.breakthrough, { weaponId: id, level: 6 });
  g.selectUpgrade(0);
  assert.equal(g.state, 'PLAYING');
  assert.equal(p.breakthroughs[id][6], 'transform');
  // It counts as the LV 6 Breakthrough: reaching LV 6 offers nothing more, LV 12 still does.
  const card = UPGRADE_BY_ID[`${id}_damage`] || Object.values(UPGRADE_BY_ID).find((u) => u.id.startsWith(id));
  applyUpgradeLevels(p, { ...card, levelJump: 5 });
  assert.ok(weaponLevel(p, id) >= 6);
  assert.deepEqual(pendingBreakthroughs(p, id), []);
  // Discarding it and filling slot 6 again gives nothing: once per run.
  discardWeapon(p, id);
  const next = unownedWeapons(p).find((w) => w !== id);
  acquireWeapon(p, next);
  assert.equal(ownedWeapons(p).length, 6);
  assert.deepEqual(pendingBreakthroughs(p, next), []);
});

test('NEW WEAPON card: a banner says what the slot unlocks', () => {
  const g = freshGame();
  const p = g.player;
  const expect = { 2: '3 CARD CHOICES', 3: '+5% DAMAGE', 4: '4 CARD CHOICES', 5: '+5% DAMAGE', 6: 'FREE BREAKTHROUGH' };
  for (const [slot, short] of Object.entries(expect)) {
    const d = describeNewWeapon(p);
    assert.equal(d.reward.slot, Number(slot));
    assert.equal(d.reward.short, short);
    const html = renderUpgradeCard(d, '[1]').html;
    assert.match(html, new RegExp(`SLOT ${slot} UNLOCKS`));
    assert.ok(html.includes(short));
    acquireWeapon(p, unownedWeapons(p)[0]);
  }
  assert.match(slotReward(5).text, /\+10% total/);
  assert.equal(slotReward(1), null);
  assert.equal(slotReward(7), null);
});

test('weapon pick reroll: 40 then 80 gold, fresh weapons first, off when nothing new is left', () => {
  assert.deepEqual([0, 1, 2].map((n) => weaponRerollCost(n)), [40, 80, 160]);
  const g = freshGame([], 1000);
  withTuning(odds(1), () => g.triggerLevelUp());
  g.selectUpgrade(g.currentChoices.findIndex((c) => c.isNewWeapon));
  assert.equal(g.handPhase, 'weapon');
  const first = g.currentChoices.map((c) => c.weaponId);
  assert.equal(g.rerollHand(), true);
  assert.equal(g.gold, 960);
  const second = g.currentChoices.map((c) => c.weaponId);
  assert.equal(second.length, 3);
  assert.ok(second.every((id) => !first.includes(id)), '9 weapons left: all 3 are new');
  assert.equal(g.handleUpgradeKey('KeyR'), true, '[R] rerolls the pick');
  assert.equal(g.gold, 880);
  g.handleUpgradePad({ pressed: (b) => b === PAD.X, buttons: [] });
  assert.equal(g.gold, 720, 'controller X rerolls the pick');
  // Not enough gold: nothing changes.
  g.gold = 100;
  const shown = g.currentChoices;
  assert.equal(g.rerollHand(), false);
  assert.equal(g.currentChoices, shown);
  assert.equal(g.gold, 100);
  g.selectUpgrade(0);
  assert.equal(g.state, 'PLAYING');
  // The next pick starts at 40 again.
  g.gold = 1000;
  withTuning(odds(1), () => g.triggerLevelUp());
  g.selectUpgrade(g.currentChoices.findIndex((c) => c.isNewWeapon));
  assert.equal(g.weaponRerollPrice(), 40);
  // Rerolled picks only repeat weapons when too few others are left.
  const few = freshGame(['rockets', 'missiles', 'lightning', 'singularity', 'orbitals']).player;
  for (let i = 0; i < 20; i++) {
    const avoid = rollWeaponPicks(few, 3).map((c) => c.weaponId);
    const again = rollWeaponPicks(few, 3, avoid).map((c) => c.weaponId);
    assert.equal(again.filter((id) => !avoid.includes(id)).length, Math.min(3, unownedWeapons(few).length - 3));
  }
});

test('weapon pick reroll is off when every weapon left is already on offer', () => {
  const g = freshGame(ALL_BUT_BLASTER.slice(0, 4), 1000);
  withTuning({ ...odds(1), weaponSlots: 10 }, () => {
    for (const id of ['orbitals', 'mines']) acquireWeapon(g.player, id);
    g.triggerLevelUp();
    g.selectUpgrade(g.currentChoices.findIndex((c) => c.isNewWeapon));
    assert.equal(unownedWeapons(g.player).length, 3);
    assert.equal(g.canRerollWeaponPick(), false);
    assert.equal(g.rerollHand(), false);
    assert.equal(g.gold, 1000);
  });
});
