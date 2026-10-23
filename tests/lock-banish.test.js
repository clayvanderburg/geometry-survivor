import test from 'node:test';
import assert from 'node:assert/strict';

// Clay (v0.46.0): LOCK / BANISH are big buttons in their own strip under each card, outside the card's
// click area, so a near-miss never picks the card; and BANISH removes the whole card (every rank, OVERCHARGE,
// rarity-floor tier) from every hand type for the rest of the run.
const h = await import('../tools/balance/harness.mjs');
const { TUNING } = await import('../js/config.js');
const { UPGRADE_BY_ID, acquireWeapon, applyUpgradeLevels, eligibleUpgrades, rollUpgrades, rollLevelUpHand, cardInclusionOdds } = await import('../js/upgrades.js');
const { refreshLockedCard, banishCost } = await import('../js/gold.js');

const odds = (chance) => ({
  newWeaponChanceBy1: chance, newWeaponChanceBy2: chance, newWeaponChanceBy3: chance, newWeaponChanceBy4: chance, newWeaponChanceBy5: chance,
  newWeaponPity: 99, newWeaponPityOne: 99
});
Object.assign(TUNING, odds(0));

function handGame(gold = 500) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.gold = gold;
  for (const id of ['rockets', 'missiles', 'lightning']) acquireWeapon(g.player, id);
  return g;
}

// A small DOM with real children, listeners and bubbling clicks (the harness's fake drops listeners).
function miniDom() {
  const make = (tag = 'div') => {
    const el = {
      tagName: tag, children: [], parentNode: null, listeners: {}, style: { setProperty() {} }, className: '', innerHTML: '', textContent: '', title: '',
      classList: { add() {}, remove() {}, contains: () => false },
      setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], remove() {},
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      append(...cs) { cs.forEach((c) => el.appendChild(c)); },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      click() {
        let stopped = false;
        const ev = { target: el, stopPropagation() { stopped = true; } };
        for (let n = el; n && !stopped; n = n.parentNode) for (const fn of n.listeners.click || []) fn(ev);
      }
    };
    return el;
  };
  const byId = new Map();
  return { make, getElementById: (id) => { if (!byId.has(id)) byId.set(id, make()); return byId.get(id); } };
}
const contains = (root, el) => root === el || root.children.some((c) => contains(c, el));

test('LOCK and BANISH sit in a strip under the card, outside it: pressing them never picks the card', () => {
  const dom = miniDom();
  const doc = globalThis.document;
  const saved = { createElement: doc.createElement, getElementById: doc.getElementById };
  const realNow = performance.now.bind(performance);
  let now = 1e6;
  performance.now = () => now;
  doc.createElement = dom.make;
  doc.getElementById = dom.getElementById;
  try {
    const g = handGame();
    g.triggerLevelUp();
    now += 1000; // past the click guard
    const picks = [];
    const select = g.selectUpgrade.bind(g);
    g.selectUpgrade = (i) => { picks.push(i); return select(i); };
    const grid = dom.getElementById('upgrade-choices');
    const card = g.choiceCardEls[1];
    const lock = g.choiceLockEls[1];
    const banish = g.choiceBanishEls[1];
    assert.ok(lock && banish, 'level-up hands get the action strip');
    assert.ok(!contains(card, lock) && !contains(card, banish), 'the buttons are not inside the card');
    const slot = grid.children[1];
    assert.equal(slot.className, 'card-slot');
    assert.equal(slot.children[0], card);
    assert.equal(slot.children[1].className, 'card-actions');
    assert.match(lock.innerHTML, /LOCK/);
    assert.match(banish.innerHTML, new RegExp(`BANISH.*${banishCost()}`));

    lock.click();
    assert.deepEqual(picks, [], 'LOCK did not pick the card');
    assert.equal(g.handLock?.slot, 1);
    const id = g.currentChoices[2].id;
    g.choiceBanishEls[2].click();
    assert.deepEqual(picks, [], 'arming BANISH did not pick the card');
    assert.equal(g.banishArmed, 2);
    g.choiceBanishEls[2].click();
    assert.equal(g.player.banished[id], true);
    assert.deepEqual(picks, [], 'BANISH did not pick the card');
    now += 1000; // the banish re-dealt the hand: past its click guard again
    // A click on the gap (the slot itself) does nothing; a click on the card still picks it.
    g.choiceCardEls[0].parentNode.click();
    assert.deepEqual(picks, []);
    g.choiceCardEls[0].click();
    assert.deepEqual(picks, [0], 'the card itself still picks');

    // Weapon picks and Breakthroughs have no strip.
    const p = handGame();
    p.openWeaponPick();
    assert.equal(p.choiceLockEls.filter(Boolean).length, 0);
  } finally {
    doc.createElement = saved.createElement;
    doc.getElementById = saved.getElementById;
    performance.now = realNow;
  }
});

test('a card banished at rank 2 never comes back: hands, rerolls, banish refills, caches, locks, odds', () => {
  const g = handGame();
  const p = g.player;
  const id = 'firerate';
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: 2 });
  assert.equal(p.upgradeLevels[id], 2);
  assert.ok(eligibleUpgrades(p).some((u) => u.id === id), 'offerable before the banish');
  // Banish it from a real hand.
  g.triggerLevelUp();
  g.currentChoices[0] = { ...UPGRADE_BY_ID[id], levelJump: 3 };
  g.banishCard(0, true);
  assert.equal(p.banished[id], true);
  const seen = (cards) => cards.some((c) => c.id === id);
  for (let i = 0; i < 200; i++) {
    assert.ok(!seen(rollLevelUpHand(p, 4)), 'level-up hand');
    assert.ok(!seen(rollUpgrades(p, 4, { cache: true })), 'supply cache');
  }
  for (let i = 0; i < 20; i++) {
    g.rerollHand();
    assert.ok(!seen(g.currentChoices), 'reroll');
  }
  assert.ok(!cardInclusionOdds(p, 4).has?.(id) || cardInclusionOdds(p, 4).get(id) === 0, 'never in the odds');
  assert.equal(refreshLockedCard(p, { ...UPGRADE_BY_ID[id], levelJump: 1 }), null, 'a carried lock on it is dropped');
  // Every rank, any rolled tier, and OVERCHARGE: it is the card id that is gone.
  p.upgradeLevels[id] = 0;
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === id));
  // A rarity-floor card (Phase Piercer, always RARE) banished at rank 1 is gone too.
  p.banished.pierce = true;
  for (let i = 0; i < 100; i++) assert.ok(!rollLevelUpHand(p, 4).some((c) => c.id === 'pierce'));
  // Other cards of the same weapon stay.
  assert.ok(eligibleUpgrades(p).some((u) => u.id === 'multishot'));
});
