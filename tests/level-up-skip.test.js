import test from 'node:test';
import assert from 'node:assert/strict';

// SKIP on the level-up hand: no card, skipReward() gold (half a first reroll), a lock carries over,
// keyboard [K], controller LB twice, and not on Breakthroughs or the forced CHOOSE A WEAPON pick.
const h = await import('../tools/balance/harness.mjs');
const { PAD } = await import('../js/gamepad.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { acquireWeapon } = await import('../js/upgrades.js');
const { skipReward, rerollCost } = await import('../js/gold.js');

const odds = (chance, pity = 99) => ({
  newWeaponChanceBy1: chance, newWeaponChanceBy2: chance, newWeaponChanceBy3: chance, newWeaponChanceBy4: chance, newWeaponChanceBy5: chance,
  newWeaponPity: pity, newWeaponPityOne: pity
});
Object.assign(TUNING, odds(0));

function handGame(gold = 0) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.gold = gold;
  for (const id of ['rockets', 'missiles', 'lightning']) acquireWeapon(g.player, id);
  g.triggerLevelUp();
  return g;
}

test('skip reward: a TUNING knob, 10 gold, half a first reroll', () => {
  assert.equal(DEFAULT_TUNING.goldSkipReward, 10);
  assert.equal(skipReward(), 10);
  assert.ok(skipReward() < rerollCost(0), 'skipping is never a gold farm');
  assert.ok(TUNING_SCHEMA.flatMap((grp) => grp.items).some((i) => i.key === 'goldSkipReward'));
});

test('SKIP takes no card, banks the gold and closes the hand', () => {
  const g = handGame(3);
  const levels = { ...g.player.upgradeLevels };
  assert.equal(g.state, 'UPGRADE');
  assert.equal(g.skipHand(), true);
  assert.equal(g.state, 'PLAYING');
  assert.equal(g.gold, 13);
  assert.equal(g.goldEarned, 10);
  assert.deepEqual(g.player.upgradeLevels, levels, 'no card was installed');
  assert.equal(g.runStats.skips, 1);
  assert.equal(g.skipHand(), false, 'nothing to skip once the hand is gone');
});

test('a locked card survives a skip and comes back next level-up', () => {
  const g = handGame(50);
  g.toggleCardLock(1);
  const locked = g.currentChoices[1];
  g.skipHand();
  g.triggerLevelUp();
  assert.equal(g.currentChoices[1].id, locked.id);
  assert.equal(g.handLock?.card.id, locked.id);
});

test('keyboard [K] skips; controller LB arms, a second LB skips, another button disarms', () => {
  const g = handGame();
  assert.equal(g.handleUpgradeKey('KeyK'), true);
  assert.equal(g.state, 'PLAYING');

  const pad = (button) => ({ pressed: (b) => b === button, buttons: [] });
  const p = handGame();
  p.gpActive = true;
  p.menuNav = { focused: p.choiceCardEls[0], update() {}, activate() {}, setFocus(el) { this.focused = el; }, clear() {} };
  p.handleUpgradePad(pad(PAD.LB));
  assert.equal(p.skipArmed, true);
  assert.equal(p.state, 'UPGRADE', 'one LB (also dash) only arms');
  p.handleUpgradePad(pad(PAD.B));
  assert.equal(p.skipArmed, false, 'another button disarms');
  p.handleUpgradePad(pad(PAD.LB));
  p.handleUpgradePad(pad(PAD.LB));
  assert.equal(p.state, 'PLAYING');
  assert.equal(p.gold, 10);
});

test('no SKIP on a Breakthrough or a NEW WEAPON pick', () => {
  const g = handGame();
  g.openWeaponPick();
  assert.equal(g.handPhase, 'weapon');
  assert.equal(g.skipHand(), false);
  assert.equal(g.handleUpgradeKey('KeyK'), false);
  g.handPhase = 'breakthrough';
  assert.equal(g.skipHand(), false);
  assert.equal(g.gold, 0);
});

test('the SKIP button shows the reward and the hotkeys, and hides outside level-up hands', () => {
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
    const g = handGame();
    assert.match(el('btn-skip-hand').innerHTML, /⏭ SKIP · \+10 ◆ <span class="hand-key">\[K\] \/ LB×2<\/span>/);
    assert.equal(el('btn-skip-hand').classList.contains('hidden'), false);
    g.skipHand(false);
    assert.match(el('btn-skip-hand').innerHTML, /CONFIRM SKIP/);
    assert.ok(el('btn-skip-hand').classList.contains('armed'));
    g.openWeaponPick();
    assert.ok(el('btn-skip-hand').classList.contains('hidden'));
  } finally {
    globalThis.document.getElementById = saved;
  }
});
