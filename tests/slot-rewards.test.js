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
const { WEAPONS, ownedWeapons, unownedWeapons, weaponLevel } = await import('../js/loadout.js');
const { weaponDamage } = await import('../js/weapon-scaling.js');
const { describeNewWeapon, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { handSizeFor, loadoutDamageMult, loadoutDamageMultFor, slotReward, slotTip, SLOT_TIP_SEEN_KEY, readSlotTipSeen } = await import('../js/slot-rewards.js');
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
  const pick = g.currentChoices[0].option;
  g.selectUpgrade(0);
  assert.equal(g.state, 'PLAYING');
  assert.equal(p.breakthroughs[id][6], pick);
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

test('NEW WEAPON card: the slot bonus is the message, with no summary or stat rows', () => {
  const g = freshGame();
  const p = g.player;
  const expect = { 2: '+1 CARD CHOICE', 3: '+5% DAMAGE', 4: '+1 CARD CHOICE', 5: '+5% DAMAGE', 6: 'FREE BREAKTHROUGH' };
  for (const [slot, short] of Object.entries(expect)) {
    const d = describeNewWeapon(p);
    assert.equal(d.reward.slot, Number(slot));
    assert.equal(d.reward.short, short);
    assert.deepEqual(d.rows, []);
    const html = renderUpgradeCard(d, '[1]').html;
    assert.match(html, new RegExp(`SLOT ${slot} BONUS`));
    assert.ok(html.includes(short));
    assert.ok(!html.includes('upg-summary') && !html.includes('upg-stats') && !html.includes('upg-headline'), 'no extra text');
    acquireWeapon(p, unownedWeapons(p)[0]);
  }
  assert.match(slotReward(2).text, /3 cards instead of 2/);
  assert.match(slotReward(5).text, /\+10% total/);
  assert.equal(slotReward(1), null);
  assert.equal(slotReward(7), null);
});

test('slot tip: opens once over the first hand with a NEW WEAPON card, and only GOT IT / a key / a button closes it', () => {
  const tip = slotTip(6);
  assert.deepEqual(tip.rewards.map((r) => r.slot), [2, 3, 4, 5, 6]);
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const g = freshGame();
    g.slotTipSeen = undefined; // a device that has never seen it
    withTuning(odds(0), () => g.triggerLevelUp());
    assert.ok(!g.slotTipOpen, 'no NEW WEAPON card: no tip');
    g.selectUpgrade(0);
    withTuning(odds(1), () => g.triggerLevelUp());
    assert.equal(g.slotTipOpen, true);
    assert.equal(store.get(SLOT_TIP_SEEN_KEY), '1');
    assert.ok(readSlotTipSeen());
    // Picks, digits and pad buttons don't go through to the cards while it is open.
    const choices = g.currentChoices;
    g.selectUpgrade(0);
    assert.equal(g.currentChoices, choices);
    assert.equal(g.handleUpgradeKey('Digit1'), true);
    assert.equal(g.slotTipOpen, false, 'a digit closes it');
    assert.equal(g.state, 'UPGRADE', '...without picking a card');
    // Never again, on this game or a new one on the same device.
    g.slotTipSeen = true;
    const g2 = freshGame();
    g2.slotTipSeen = undefined;
    withTuning(odds(1), () => g2.triggerLevelUp());
    assert.ok(!g2.slotTipOpen);
    // Controller: A closes it without picking.
    store.clear();
    const g3 = freshGame();
    g3.slotTipSeen = undefined;
    withTuning(odds(1), () => g3.triggerLevelUp());
    assert.equal(g3.slotTipOpen, true);
    assert.equal(g3.handleUpgradePad({ pressed: (b) => b === PAD.A, buttons: [] }), true);
    assert.equal(g3.slotTipOpen, false);
    assert.equal(g3.state, 'UPGRADE');
  } finally {
    globalThis.localStorage = saved;
  }
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
  // Enough slots that a free one is left after owning everything but three weapons, however many the game has.
  withTuning({ ...odds(1), weaponSlots: WEAPONS.length + 2 }, () => {
    // Own everything but three weapons, so the pick offers all that's left.
    while (unownedWeapons(g.player).length > 3) acquireWeapon(g.player, unownedWeapons(g.player)[0].id ?? unownedWeapons(g.player)[0]);
    g.triggerLevelUp();
    g.selectUpgrade(g.currentChoices.findIndex((c) => c.isNewWeapon));
    assert.equal(unownedWeapons(g.player).length, 3);
    assert.equal(g.canRerollWeaponPick(), false);
    assert.equal(g.rerollHand(), false);
    assert.equal(g.gold, 1000);
  });
});
