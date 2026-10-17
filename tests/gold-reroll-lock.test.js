import test from 'node:test';
import assert from 'node:assert/strict';

// Gold (per-run currency from gold veins) and the level-up hand's REROLL / LOCK. The balance harness
// stubs the browser and builds a real Game, so resetRun, triggerLevelUp and selectUpgrade are the game's own.
const h = await import('../tools/balance/harness.mjs');
const { Game } = await import('../js/main.js');
const { PAD } = await import('../js/gamepad.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { eligibleUpgrades, applyUpgradeLevels, discardWeapon, acquireWeapon, UPGRADE_BY_ID } = await import('../js/upgrades.js');
const { ownedWeapons, unownedWeapons } = await import('../js/loadout.js');
const {
  GOLD_ICON, goldPerVein, goldCoins, rerollCost, lockCost, trySpend, refreshLockedCard, rollHandAround
} = await import('../js/gold.js');

// Hands and rerolls carry no NEW WEAPON card unless a test asks for one (it would open the weapon
// pick instead of applying a card), so slot-by-slot checks are deterministic.
Object.assign(TUNING, { newWeaponChance: 0, newWeaponPity: 99 });

function freshGame(gold = 0) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.gold = gold;
  return g;
}

function withTuning(values, fn) {
  const saved = { ...TUNING };
  Object.assign(TUNING, values);
  try { return fn(); } finally { Object.assign(TUNING, saved); }
}

// A hand of exactly 3 regular cards (no NEW WEAPON) so slots are predictable.
const plainHand = (g) => withTuning({ newWeaponChance: 0, newWeaponPity: 99 }, () => g.triggerLevelUp());
const ids = (g) => g.currentChoices.map((c) => c.id);
const offerable = (p, c) => c.isNewWeapon || eligibleUpgrades(p).some((u) => u.id === c.id);

test('gold knobs live in TUNING with the requested defaults', () => {
  assert.equal(DEFAULT_TUNING.goldRerollCost, 20);
  assert.equal(DEFAULT_TUNING.goldRerollGrowth, 2);
  assert.equal(DEFAULT_TUNING.goldLockCost, 5);
  assert.ok(DEFAULT_TUNING.goldPerVein >= 1);
  const keys = TUNING_SCHEMA.flatMap((grp) => grp.items).map((i) => i.key);
  for (const k of ['goldPerVein', 'goldVeinChance', 'goldRerollCost', 'goldRerollGrowth', 'goldLockCost']) assert.ok(keys.includes(k), k);
});

test('a gold vein drops gold coins (no XP) that are magnetized and collected into the run wallet', () => {
  const g = freshGame();
  const p = g.player;
  const rock = { x: p.x + 300, y: p.y, radius: 20, sides: 6, rotation: 0, hue: 46, oreType: 'gold_vein', hp: 0, maxHp: 40, brokenBy: 'elite' };
  g.onRockShattered(rock);
  const coins = g.geoms.filter((x) => x.isGold);
  assert.equal(coins.reduce((a, c) => a + c.gold, 0), goldPerVein(), 'elite-broken veins drop gold for the ship too');
  assert.ok(coins.every((c) => c.xp === 0 && !c.isCore));
  assert.deepEqual(goldCoins(3), [1, 1, 1]);
  assert.deepEqual(goldCoins(14), [3, 3, 2, 2, 2, 2]);
  assert.deepEqual(goldCoins(0), []);
  // Pull them in: within the magnet radius they home onto the ship and are collected.
  const xpBefore = p.xp;
  const levelBefore = p.level;
  for (const c of coins) { c.x = p.x + 60; c.y = p.y; c.vx = 0; c.vy = 0; }
  g.enemyManager.enemies.length = 0;
  for (let t = 0; t < 60 && g.geoms.some((x) => x.isGold); t++) { p.invuln = 1; g.update(1 / 60); }
  assert.equal(g.geoms.filter((x) => x.isGold).length, 0, 'all coins collected');
  assert.equal(g.gold, goldPerVein());
  assert.equal(g.goldEarned, goldPerVein());
  assert.ok(p.level === levelBefore && p.xp === xpBefore, 'gold is not XP');
  // Gold is per run.
  g.resetRun();
  assert.equal(g.gold, 0);
  assert.equal(g.carriedLock, null);
});

test('reroll costs 20 → 40 → 80 within a hand and resets to 20 on the next level-up', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => rerollCost(n)), [20, 40, 80, 160]);
  withTuning({ goldRerollCost: 10, goldRerollGrowth: 1.5 }, () => assert.deepEqual([0, 1, 2].map((n) => rerollCost(n)), [10, 15, 23]));
  assert.equal(lockCost(), 5);
  const g = freshGame(200);
  plainHand(g);
  assert.ok(g.rerollHand());
  assert.equal(g.gold, 180);
  assert.ok(g.rerollHand());
  assert.equal(g.gold, 140);
  assert.ok(g.rerollHand());
  assert.equal(g.gold, 60);
  assert.equal(g.handRerolls, 3);
  assert.equal(g.goldSpent, 140);
  g.selectUpgrade(0);
  plainHand(g);
  assert.equal(g.handRerolls, 0);
  assert.ok(g.rerollHand());
  assert.equal(g.gold, 40, 'back to 20 on a new level-up');
});

test('gold never goes below 0: unaffordable rerolls and locks change nothing', () => {
  assert.equal(trySpend({ gold: 4 }, 5), false);
  assert.equal(trySpend({ gold: 5 }, -1), false);
  const wallet = { gold: 5 };
  assert.equal(trySpend(wallet, 5), true);
  assert.equal(wallet.gold, 0);
  const g = freshGame(30);
  plainHand(g);
  assert.ok(g.rerollHand());
  assert.equal(g.gold, 10);
  const before = g.currentChoices;
  assert.equal(g.rerollHand(), false, '40 needed, 10 held');
  assert.equal(g.gold, 10);
  assert.equal(g.currentChoices, before, 'hand unchanged');
  g.gold = 4;
  assert.equal(g.toggleCardLock(0), false);
  assert.equal(g.handLock, null);
  assert.equal(g.gold, 4);
});

test('a reroll keeps the locked card in its slot and rolls the rest by the normal rules', () => {
  const g = freshGame(10000);
  const p = g.player;
  plainHand(g);
  assert.ok(g.toggleCardLock(1));
  assert.equal(g.gold, 9995);
  const locked = g.currentChoices[1];
  for (let i = 0; i < 6; i++) {
    g.handRerolls = 0; // keep each reroll at the base cost
    assert.ok(g.rerollHand());
    assert.equal(g.currentChoices[1], locked, 'locked card stays in place');
    assert.equal(g.currentChoices.length, 3);
    assert.equal(g.currentChoices.filter((c) => c.id === locked.id).length, 1, 'never duplicated');
    for (const c of g.currentChoices) assert.ok(offerable(p, c), `${c.id} obeys gating`);
    assert.ok(g.currentChoices.every((c) => c.levelJump >= 1));
  }
});

test('rerolls do not advance the NEW WEAPON pity counter (it counts level-ups)', () => {
  const g = freshGame(10000);
  g.player.newWeaponDrought = 1;
  withTuning({ newWeaponChance: 0, newWeaponPity: 3 }, () => {
    g.triggerLevelUp();
    for (let i = 0; i < 5; i++) { g.handRerolls = 0; g.rerollHand(); }
  });
  assert.equal(g.player.newWeaponDrought, 2, 'one level-up worth of drought');
  // With pity due, every reroll of that hand still offers NEW WEAPON.
  const g2 = freshGame(10000);
  g2.player.newWeaponDrought = 2;
  withTuning({ newWeaponChance: 0, newWeaponPity: 3 }, () => {
    g2.triggerLevelUp();
    assert.ok(g2.currentChoices.some((c) => c.isNewWeapon));
    for (let i = 0; i < 5; i++) { g2.handRerolls = 0; g2.rerollHand(); assert.ok(g2.currentChoices.some((c) => c.isNewWeapon)); }
  });
});

test('a locked card passed over is guaranteed in the next hand, with one fewer random card', () => {
  const g = freshGame(100);
  plainHand(g);
  g.toggleCardLock(2);
  const locked = g.currentChoices[2];
  g.selectUpgrade(0);
  assert.equal(g.carriedLock.card, locked);
  plainHand(g);
  assert.equal(g.currentChoices.length, 3);
  assert.equal(g.currentChoices[2].id, locked.id, 'back in its slot');
  assert.equal(g.currentChoices[2].levelJump, Math.min(locked.levelJump, locked.maxLevel - (g.player.upgradeLevels[locked.id] || 0)));
  assert.equal(g.handLock.card, g.currentChoices[2], 'shown locked');
  assert.equal(g.carriedLock, null);
  assert.equal(g.gold, 95, 'carrying it costs nothing more');
  // The hook rolls count - 1 random cards around a lock.
  const counts = [];
  const hand = rollHandAround(g.player, 3, { card: locked, slot: 1 }, (pl, n) => { counts.push(n); return [{ id: 'a' }, { id: 'b' }]; });
  assert.deepEqual(counts, [2]);
  assert.deepEqual(hand.map((c) => c.id), ['a', locked.id, 'b']);
  assert.deepEqual(rollHandAround(g.player, 3, null, (pl, n) => Array.from({ length: n }, (_, i) => ({ id: i }))).length, 3);
  // A random roll that keeps repeating the locked card is topped up, so the hand stays full.
  const stubborn = rollHandAround(g.player, 3, { card: { id: 'x' }, slot: 0 }, () => [{ id: 'x' }, { id: 'a' }], () => [{ id: 'x' }, { id: 'a' }, { id: 'b' }]);
  assert.deepEqual(stubborn.map((c) => c.id), ['x', 'a', 'b']);
  // A locked NEW WEAPON takes the hand's NEW WEAPON spot: the rest is a plain roll, even at 100% odds.
  const nwHand = rollHandAround(g.player, 3, { card: { id: 'new_weapon', isNewWeapon: true }, slot: 2 }, () => assert.fail('no NEW WEAPON roll'), (pl, n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` })));
  assert.deepEqual(nwHand.map((c) => c.id), ['u0', 'u1', 'new_weapon']);
  // Taking the locked card applies it and uses the lock up.
  const before = g.player.upgradeLevels[locked.id] || 0;
  g.selectUpgrade(2);
  assert.ok((g.player.upgradeLevels[locked.id] || 0) > before);
  assert.equal(g.carriedLock, null);
  plainHand(g);
  assert.equal(g.handLock, null);
});

test('only one card can be locked; unlocking refunds nothing', () => {
  const g = freshGame(100);
  plainHand(g);
  g.toggleCardLock(0);
  g.toggleCardLock(1);
  assert.equal(g.handLock.card, g.currentChoices[1]);
  assert.equal(g.handLock.slot, 1);
  assert.equal(g.gold, 90, 'moving the lock pays again');
  g.toggleCardLock(1);
  assert.equal(g.handLock, null);
  assert.equal(g.gold, 90, 'no refund');
  g.selectUpgrade(0);
  assert.equal(g.carriedLock, null, 'nothing carried once unlocked');
});

test('a carried lock that is no longer valid is dropped with a note', () => {
  // Maxed out before the next level-up (e.g. by a supply cache).
  const g = freshGame(100);
  plainHand(g);
  const idx = g.currentChoices.findIndex((c) => !c.isNewWeapon && !c.isSynergy);
  g.toggleCardLock(idx);
  const locked = g.currentChoices[idx];
  g.selectUpgrade(idx === 0 ? 1 : 0);
  applyUpgradeLevels(g.player, { ...UPGRADE_BY_ID[locked.id], levelJump: 99 });
  plainHand(g);
  assert.equal(g.handLock, null);
  assert.ok(!g.currentChoices.some((c) => c === locked));
  assert.match(g.lockNote, /lock dropped/);

  // Its weapon discarded.
  const g2 = freshGame();
  assert.equal(refreshLockedCard(g2.player, { ...UPGRADE_BY_ID.rockets, levelJump: 3 }), null, 'Wing Rockets not equipped');
  acquireWeapon(g2.player, 'rockets');
  assert.equal(refreshLockedCard(g2.player, { ...UPGRADE_BY_ID.rockets, levelJump: 3 }).id, 'rockets', 'valid while Wing Rockets are equipped');
  discardWeapon(g2.player, 'rockets');
  assert.equal(refreshLockedCard(g2.player, { ...UPGRADE_BY_ID.rockets, levelJump: 1 }), null);

  // Level jump trimmed to the levels left.
  const g3 = freshGame();
  const multi = UPGRADE_BY_ID.multishot;
  applyUpgradeLevels(g3.player, { ...multi, levelJump: multi.maxLevel - 1 });
  assert.equal(refreshLockedCard(g3.player, { ...multi, levelJump: 3 }).levelJump, 1);
});

test('a locked NEW WEAPON card carries over as NEW WEAPON, and drops when no slot is free', () => {
  const g = freshGame(100);
  withTuning({ newWeaponChance: 1 }, () => g.triggerLevelUp());
  const nw = g.currentChoices.findIndex((c) => c.isNewWeapon);
  assert.ok(nw >= 0);
  g.toggleCardLock(nw);
  g.selectUpgrade(nw === 0 ? 1 : 0);
  assert.ok(g.carriedLock.card.isNewWeapon);
  withTuning({ newWeaponChance: 1 }, () => g.triggerLevelUp());
  assert.equal(g.currentChoices.filter((c) => c.isNewWeapon).length, 1, 'exactly one NEW WEAPON card');
  assert.ok(g.currentChoices[nw].isNewWeapon && g.handLock.card === g.currentChoices[nw]);
  assert.equal(g.player.newWeaponDrought, 0);
  // Taking it opens the weapon pick; rerolls and locks are off there.
  g.selectUpgrade(nw);
  assert.equal(g.handPhase, 'weapon');
  assert.ok(g.currentChoices.every((c) => c.isWeaponPick));
  assert.equal(g.rerollHand(), false);
  assert.equal(g.toggleCardLock(0), false);
  assert.equal(g.carriedLock, null);
  g.selectUpgrade(0);
  assert.equal(g.state, 'PLAYING');

  // Every slot filled before the next level-up: the NEW WEAPON lock is dropped.
  const g2 = freshGame(100);
  withTuning({ newWeaponChance: 1 }, () => g2.triggerLevelUp());
  const i2 = g2.currentChoices.findIndex((c) => c.isNewWeapon);
  g2.toggleCardLock(i2);
  g2.selectUpgrade(i2 === 0 ? 1 : 0);
  for (const id of unownedWeapons(g2.player)) acquireWeapon(g2.player, id);
  assert.equal(ownedWeapons(g2.player).length, 6);
  plainHand(g2);
  assert.equal(g2.handLock, null);
  assert.ok(!g2.currentChoices.some((c) => c.isNewWeapon));
  assert.match(g2.lockNote, /NEW WEAPON lock dropped/);
});

test('keyboard in the level-up modal: R rerolls, Shift+1-3 locks, 1-3 picks; R leaves the radar alone', () => {
  const g = freshGame(100);
  g.radarVisible = true;
  plainHand(g);
  const first = g.currentChoices;
  assert.equal(g.handleUpgradeKey('KeyR'), true);
  assert.notEqual(g.currentChoices, first);
  assert.equal(g.gold, 80);
  assert.equal(g.radarVisible, true, 'R does not toggle the radar here');
  assert.equal(g.handleUpgradeKey('Digit2', true), true);
  assert.equal(g.handLock.slot, 1);
  assert.equal(g.handleUpgradeKey('Numpad2', true), true);
  assert.equal(g.handLock, null, 'Shift+2 again unlocks');
  assert.equal(g.handleUpgradeKey('KeyQ'), false);
  g.handleUpgradeKey('Digit1');
  assert.equal(g.state, 'PLAYING');
  assert.equal(g.handleUpgradeKey('KeyR'), false, 'nothing outside the modal');
});

test('controller in the level-up modal: X rerolls, Y locks the focused card, A still picks', () => {
  const pad = (...down) => ({ pressed: (b) => down.includes(b), navX: 0, navY: 0, buttons: [] });
  const g = freshGame(100);
  plainHand(g);
  let activated = 0;
  g.gpActive = true;
  g.menuState = 'UPGRADE';
  g.menuGrace = 0;
  g.menuNav = { focused: g.choiceCardEls[2], update() {}, activate() { activated++; }, setFocus(el) { this.focused = el; }, clear() {} };
  const saved = globalThis.document.getElementById;
  globalThis.document.getElementById = () => ({ querySelector: () => null, querySelectorAll: () => [], appendChild() {} });
  try {
    g.updateMenuController(pad(PAD.Y), 1 / 60);
    assert.equal(g.handLock?.slot, 2, 'Y locks the focused card');
    assert.equal(g.gold, 95);
    assert.equal(activated, 0, 'Y does not pick');
    const before = g.currentChoices;
    g.updateMenuController(pad(PAD.X), 1 / 60);
    assert.notEqual(g.currentChoices, before, 'X rerolls');
    assert.equal(g.currentChoices[2], g.handLock.card, 'the lock holds through the reroll');
    assert.equal(g.gold, 75);
    assert.equal(g.menuNav.focused, g.choiceCardEls[2], 'focus stays on the same card slot');
    g.updateMenuController(pad(PAD.A), 1 / 60);
    assert.equal(activated, 1, 'A activates the focused card as before');
    g.gold = 0;
    g.updateMenuController(pad(PAD.X), 1 / 60);
    assert.equal(g.gold, 0);
  } finally {
    globalThis.document.getElementById = saved;
  }
});

test('the level-up modal shows the gold counter, reroll cost and lock toggles', () => {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const classes = new Set();
      els.set(id, {
        id, textContent: '', innerHTML: '', disabled: false, title: '', style: {}, offsetWidth: 0,
        classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) },
        appendChild() {}, querySelector: () => null, addEventListener() {}
      });
    }
    return els.get(id);
  };
  const saved = globalThis.document.getElementById;
  globalThis.document.getElementById = el;
  try {
    const g = freshGame(25);
    plainHand(g);
    assert.equal(el('hand-gold-count').textContent, `${GOLD_ICON} 25 GOLD`);
    assert.match(el('btn-reroll-hand').innerHTML, /↻ REROLL · 20 ◆/);
    assert.equal(el('btn-reroll-hand').disabled, false);
    assert.equal(el('hand-goldbar').classList.contains('hidden'), false);
    g.rerollHand();
    assert.match(el('btn-reroll-hand').innerHTML, /REROLL · 40 ◆/);
    assert.equal(el('btn-reroll-hand').disabled, true, 'disabled when unaffordable, cost still shown');
    assert.ok(el('hand-gold-count').classList.contains('gold-flash-spend'), 'counter flashes on spend');
    g.gold = 0;
    g.addGold(3);
    assert.equal(g.gold, 3);
    assert.ok(el('gold-hud-display').classList.contains('gold-flash-gain'), 'HUD counter flashes on gain');
  } finally {
    globalThis.document.getElementById = saved;
  }
});

test('a carried-over lock is still the only lock: locking another card in the new hand moves it', () => {
  const g = freshGame(100);
  plainHand(g);
  g.toggleCardLock(2);
  const first = g.currentChoices[2];
  g.selectUpgrade(0); // pass it over: it carries into the next hand, still locked
  plainHand(g);
  assert.equal(g.handLock.card.id, first.id);
  const other = g.currentChoices.findIndex((c) => c !== g.handLock.card);
  g.toggleCardLock(other);
  assert.equal(g.handLock.card, g.currentChoices[other], 'the lock moved to the new card');
  assert.equal(g.currentChoices.filter((c) => g.handLock?.card === c).length, 1, 'exactly one locked card');
  const moved = g.currentChoices[other];
  g.selectUpgrade((other + 1) % g.currentChoices.length); // pass over the newly locked card
  assert.equal(g.carriedLock.card, moved, 'only the new lock carries over; the old one is gone');
});
