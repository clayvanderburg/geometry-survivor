import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon floor (js/weapon-floor.js): by player LV 6 / 12 / 18 / 24 / 30 the ship must carry 2 / 3 / 4 / 5 / 6
// weapons. A level-up under the floor is a forced CHOOSE A WEAPON pick (1 of 3, gold reroll, not skippable);
// at or above it the hand is the normal one. The balance harness builds a real Game, so the level-up flow
// is the game's own.
const h = await import('../tools/balance/harness.mjs');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { MODES } = await import('../js/modes.js');
const { acquireWeapon, discardWeapon, xpToNextLevel, UPGRADE_POOL } = await import('../js/upgrades.js');
const { WEAPONS, ownedWeapons } = await import('../js/loadout.js');
const { weaponFloor, weaponFloorDue, WEAPON_FLOOR_STEP } = await import('../js/weapon-floor.js');

const noNewWeapon = {
  newWeaponChanceBy1: 0, newWeaponChanceBy2: 0, newWeaponChanceBy3: 0, newWeaponChanceBy4: 0, newWeaponChanceBy5: 0,
  newWeaponPity: 99, newWeaponPityOne: 99
};

function withTuning(values, fn) {
  const saved = { ...TUNING };
  Object.assign(TUNING, values);
  try { return fn(); } finally { Object.assign(TUNING, saved); }
}

// A run at player `level` (the level the next triggerLevelUp is for) carrying `weapons` on top of the Autocannon.
function freshGame(level, weapons = [], gold = 0) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  g.gold = gold;
  g.player.level = level;
  for (const id of weapons) acquireWeapon(g.player, id);
  return g;
}

// Seeded Math.random (an LCG) so a test always rolls the same cards.
function withSeed(seed, fn) {
  const saved = Math.random;
  let x = (seed * 7919) >>> 0;
  Math.random = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
  try { return fn(); } finally { Math.random = saved; }
}

const levelUp = (g) => withTuning(noNewWeapon, () => g.triggerLevelUp());
const isForced = (g) => g.state === 'UPGRADE' && g.handPhase === 'weapon';

test('floor table: 2 weapons by LV 6, 3 by 12, 4 by 18, 5 by 24, all 6 by 30', () => {
  assert.equal(WEAPON_FLOOR_STEP, 6);
  assert.equal(DEFAULT_TUNING.weaponFloorStep, 6);
  assert.ok(TUNING_SCHEMA.flatMap((grp) => grp.items).some((i) => i.key === 'weaponFloorStep'), 'tunable in the dev tuner');
  const at = (lv) => weaponFloor(lv);
  assert.deepEqual([1, 5, 6, 11, 12, 17, 18, 23, 24, 29, 30, 60].map(at), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  // Tightened to every 5 levels.
  assert.deepEqual([5, 10, 15, 20, 25].map((lv) => withTuning({ weaponFloorStep: 5 }, () => weaponFloor(lv))), [2, 3, 4, 5, 6]);
  // Never above the weapon slots.
  assert.equal(withTuning({ weaponSlots: 4 }, () => weaponFloor(30)), 4);
});

test('under the floor the level-up is one forced CHOOSE A WEAPON pick of 3 unequipped weapons', () => {
  const g = freshGame(6);
  levelUp(g);
  assert.ok(isForced(g), 'weapon pick, not a hand');
  assert.equal(g.currentChoices.length, 3);
  assert.ok(g.currentChoices.every((c) => c.isWeaponPick && !ownedWeapons(g.player).includes(c.weaponId)));
  // Not skippable: Escape does nothing.
  g.handleUpgradeKey('Escape');
  assert.ok(isForced(g));
  const pick = g.currentChoices[1].weaponId;
  g.selectUpgrade(1);
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(ownedWeapons(g.player), ['blaster', pick]);
});

test('gold rerolls the forced pick like the NEW WEAPON pick', () => {
  const g = freshGame(12, ['rockets'], 1000);
  levelUp(g);
  assert.ok(isForced(g));
  const before = g.currentChoices.map((c) => c.weaponId);
  assert.ok(g.rerollHand());
  assert.ok(isForced(g));
  assert.equal(g.currentChoices.length, 3);
  assert.notDeepEqual(g.currentChoices.map((c) => c.weaponId), before);
  assert.ok(g.gold < 1000, 'paid in gold');
});

test('at or above the floor nothing changes: the normal hand rolls', () => {
  for (const [level, extra] of [[1, []], [5, []], [6, ['rockets']], [12, ['rockets', 'missiles']], [30, WEAPONS.map((w) => w.id).filter((id) => id !== 'blaster').slice(0, 5)]]) {
    const g = freshGame(level, extra);
    levelUp(g);
    assert.equal(g.handPhase, 'hand', `LV ${level} with ${extra.length + 1} weapons`);
    assert.ok(g.currentChoices.every((c) => !c.isWeaponPick));
  }
  // Optional NEW WEAPON cards still appear earlier, before the floor asks for one.
  const g = freshGame(2);
  withTuning({ ...noNewWeapon, newWeaponChanceBy1: 1 }, () => g.triggerLevelUp());
  assert.equal(g.handPhase, 'hand');
  assert.ok(g.currentChoices.some((c) => c.isNewWeapon));
});

test('a multi-level jump forces one pick per level-up that is still under the floor', () => {
  const g = freshGame(11);
  const p = g.player;
  p.xpToNext = xpToNextLevel(p.level);
  p.xp = p.xpToNext + xpToNextLevel(p.level + 1) + 1; // enough for LV 12 and LV 13
  withTuning(noNewWeapon, () => {
    g.processPendingLevelUps();
    assert.equal(p.level, 12);
    assert.ok(isForced(g), 'LV 12 with 1 weapon: pick');
    g.selectUpgrade(0);
    assert.equal(p.level, 13);
    assert.ok(isForced(g), 'LV 13 with 2 weapons: still under 3, pick again');
    g.selectUpgrade(0);
  });
  assert.equal(ownedWeapons(p).length, 3);
  assert.equal(g.state, 'PLAYING');
});

test('a discard can drop the ship under the floor, which forces a pick at the next level-up', () => {
  const g = freshGame(7, ['rockets']);
  levelUp(g);
  assert.equal(g.handPhase, 'hand');
  g.selectUpgrade(0);
  discardWeapon(g.player, 'rockets');
  g.player.level++;
  levelUp(g);
  assert.ok(isForced(g));
});

test('supply caches never force a weapon: only the next level-up does', () => withSeed(104, () => {
  const g = freshGame(18, ['rockets']);
  g.openRelicChest({ guaranteedSuper: true });
  assert.equal(g.state, 'CHEST');
  assert.equal(ownedWeapons(g.player).length, 2, 'the cache added no weapon');
  g.closeChestModal();
  // A cache card can take a weapon to LV 6 and open its Breakthrough (seed 104 does): never a weapon pick.
  while (g.state === 'UPGRADE') {
    assert.equal(g.handPhase, 'breakthrough', 'no weapon pick on closing the cache');
    g.selectUpgrade(0);
  }
  assert.equal(g.state, 'PLAYING');
  assert.equal(ownedWeapons(g.player).length, 2);
  levelUp(g);
  assert.ok(isForced(g));
}));

test('a gold lock waits through a forced pick and comes back in the next hand', () => withSeed(47, () => {
  const g = freshGame(5, [], 1000);
  // No element cards: taking one sets the weapon's element and rightly drops a locked element card of the
  // same weapon (the old unseeded test hit that ~0.5% of the time).
  g.player.banished = Object.fromEntries(UPGRADE_POOL.filter((u) => u.elementCard).map((u) => [u.id, true]));
  levelUp(g);
  assert.equal(g.handPhase, 'hand');
  assert.ok(g.toggleCardLock(0));
  const locked = g.currentChoices[0];
  const passAt = 1;
  g.selectUpgrade(passAt); // pass the locked card over: it carries to the next hand
  while (g.state === 'UPGRADE') g.selectUpgrade(0); // a Breakthrough, if that pick reached LV 6
  g.player.level = 6;
  levelUp(g);
  assert.ok(isForced(g));
  g.selectUpgrade(0);
  g.player.level = 7;
  levelUp(g);
  assert.equal(g.handPhase, 'hand');
  assert.ok(g.currentChoices.some((c) => c.id === locked.id), 'the locked card is back');
}));

test('flag off: the run flies without a floor (Weapon Range; a future mastery mode)', () => {
  const g = freshGame(18);
  g.player.weaponFloor = false;
  assert.equal(weaponFloorDue(g.player), false);
  levelUp(g);
  assert.equal(g.handPhase, 'hand');
  // Every mode keeps it on today; a run reads it from its mode.
  for (const m of Object.values(MODES)) assert.equal(m.weaponFloor, true, m.id);
  assert.equal(freshGame(1).player.weaponFloor, true);
  const r = h.createHeadlessGame();
  r.range = { ...(r.range || {}), active: true, onRunStart() {} };
  r.resetRun();
  assert.equal(r.player.weaponFloor, false, 'off in the Weapon Range');
});

test('no free slot or no weapon left to offer: the normal hand rolls', () => {
  const all = WEAPONS.map((w) => w.id).filter((id) => id !== 'blaster');
  withTuning({ weaponSlots: 20 }, () => {
    const g = freshGame(90, all); // every weapon owned, the floor (16) out of reach
    assert.equal(ownedWeapons(g.player).length, WEAPONS.length);
    assert.equal(weaponFloorDue(g.player), false);
    levelUp(g);
    assert.notEqual(g.handPhase, 'weapon');
  });
  // No free slot (guard: can't happen below 6 weapons with the default slots).
  const p = { level: 30, loadout: ['blaster', 'rockets'], upgradeLevels: {} };
  assert.equal(withTuning({ weaponSlots: 2 }, () => weaponFloorDue(p)), false);
});
