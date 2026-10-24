import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon unlocks (js/weapon-unlocks.js): 8 open weapons on a fresh save, 12 behind themed goals. The headless
// harness builds a real Game; `unlocks: true` attaches the tracker so its runs draw only unlocked weapons.
const h = await import('../tools/balance/harness.mjs');
const {
  OPEN_WEAPONS, UNLOCK_GOALS, UNLOCK_STATS, GOAL_BY_WEAPON, LOCKABLE_WEAPONS, UnlockTracker, normalizeUnlocks,
  availableWeapons, isWeaponUnlocked, goalProgress, goalText, nearestGoals, mergeStats, unlockOverride
} = await import('../js/weapon-unlocks.js');
const { WEAPONS, START_WEAPON_CHOICES, unownedWeapons, ownedWeapons, weaponSlots } = await import('../js/loadout.js');
const { rollWeaponPicks, rollLevelUpHand, canOfferNewWeapon, acquireWeapon, rollUpgrades, NEW_WEAPON_ID } = await import('../js/upgrades.js');
const { weaponFloor, weaponFloorDue } = await import('../js/weapon-floor.js');
const { recipesAdvanced, recipeReachable } = await import('../js/evolution-recipes.js');
const { ELEMENT_WEAPONS } = await import('../js/weapon-levels.js');
const { applyBurn, applyChill, applyCorrode, applyShockStacks, updateStatusEffects } = await import('../js/status-effects.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { ProgressionManager, normalizeSave } = await import('../js/progression.js');
const { weaponsHTML } = await import('../js/field-guide-ui.js');
const { unlockToastHTML, revealCardHTML, teaserHTML, unlockedCount } = await import('../js/unlock-ui.js');

const LOCKED = WEAPONS.map((w) => w.id).filter((id) => !OPEN_WEAPONS.includes(id));

function memoryStorage() {
  const store = new Map();
  return { store, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
}

// A real headless game on a fresh save with the tracker attached.
function freshGame(start = null) {
  globalThis.localStorage = memoryStorage();
  const g = h.createHeadlessGame({ unlocks: true });
  g.resetRun('normal', start);
  g.state = 'PLAYING';
  g.enemyManager.enemies.length = 0;
  return g;
}

const enemy = (extra = {}) => ({
  type: 'pinwheel', x: 2100, y: 2000, vx: 0, vy: 0, hp: 10, maxHp: 10, speed: 2, radius: 12, hue: 200,
  score: 1, xp: 1, sides: 4, rotation: 0, vRot: 0, pulsePhase: 0, hitFlash: 0, knockX: 0, knockY: 0, trail: [], ...extra
});
const killOne = (g, extra = {}) => {
  const e = enemy({ hp: 0, ...extra });
  g.enemyManager.enemies.push(e);
  g.killEnemy(e);
  return e;
};

test('8 weapons are open, the other 12 each have one goal; every weapon is accounted for', () => {
  assert.equal(OPEN_WEAPONS.length, 8);
  assert.deepEqual([...OPEN_WEAPONS], [...START_WEAPON_CHOICES], 'the run-start choices are the open set');
  assert.equal(UNLOCK_GOALS.length, 12);
  assert.deepEqual([...LOCKABLE_WEAPONS].sort(), [...LOCKED].sort());
  for (const g of UNLOCK_GOALS) {
    assert.ok(UNLOCK_STATS[g.stat], `${g.weapon}: known counter ${g.stat}`);
    assert.ok(g.need > 0 && Number.isInteger(g.need), `${g.weapon}: a whole-number target`);
    assert.ok(g.hint && g.hint.length < 90, `${g.weapon}: a short hint`);
  }
});

test('every goal is reachable with the open weapons (no goal needs a locked one)', () => {
  // Element goals need an element card on an open weapon.
  const elementCarriers = ELEMENT_WEAPONS.filter((id) => OPEN_WEAPONS.includes(id));
  assert.ok(elementCarriers.length >= 2, 'open weapons take FIRE / FROST / CORROSIVE / SHOCK cards');
  // Deployable kills come from the open Sentry Turret / Escort Drones.
  assert.ok(OPEN_WEAPONS.includes('turret') && OPEN_WEAPONS.includes('drones'));
  // No goal names a locked weapon in its hint.
  for (const g of UNLOCK_GOALS) {
    for (const id of LOCKED) assert.ok(!g.hint.includes(WEAPONS.find((w) => w.id === id).name), `${g.weapon} hint names locked ${id}`);
  }
});

test('goals are paced: the first ones are small, the last are long hauls', () => {
  const kills = UNLOCK_GOALS.filter((g) => g.stat === 'kills').map((g) => g.need);
  assert.ok(Math.min(...kills) <= 5000, 'a kill goal lands in the first run or two');
  assert.ok(Math.max(...kills) >= 50000, 'the last kill goal is a long haul');
  assert.equal(UNLOCK_GOALS[0].stat, 'kills', 'the first goal needs nothing special');
});

test('a fresh save draws only the open weapons: NEW WEAPON picks, rerolls and hands never offer a locked one', () => {
  const g = freshGame('blaster');
  assert.deepEqual([...g.player.weaponPool].sort(), [...OPEN_WEAPONS].sort());
  assert.deepEqual(unownedWeapons(g.player).sort(), OPEN_WEAPONS.filter((id) => id !== 'blaster').sort());
  for (let i = 0; i < 200; i++) {
    const picks = rollWeaponPicks(g.player, 3, i % 2 ? ['rockets', 'missiles'] : []);
    assert.equal(picks.length, 3, 'the pick stays a full 1 of 3');
    for (const c of picks) assert.ok(OPEN_WEAPONS.includes(c.weaponId), `offered locked ${c.weaponId}`);
  }
  // A reroll of the pick through the game's own path stays in the pool too.
  g.currentChoices = rollWeaponPicks(g.player, 3);
  g.handPhase = 'weapon';
  g.state = 'UPGRADE';
  g.gold = 9999;
  for (let i = 0; i < 20; i++) {
    g.rerollHand?.();
    for (const c of g.currentChoices) if (c.weaponId) assert.ok(OPEN_WEAPONS.includes(c.weaponId));
  }
  // Level-up hands: no card for a locked weapon's lines.
  g.state = 'PLAYING';
  for (let i = 0; i < 200; i++) {
    for (const c of rollLevelUpHand(g.player, 4)) {
      if (c.owners?.length) assert.ok(c.owners.some((o) => !LOCKED.includes(o)), `${c.id} belongs only to locked weapons`);
      if (c.weapon) assert.ok(!LOCKED.includes(c.weapon), `${c.id} is a locked weapon's card`);
    }
  }
  // Alien Tech Caches roll from the same pool.
  for (let i = 0; i < 100; i++) for (const c of rollUpgrades(g.player, 3, { cache: true })) assert.ok(!LOCKED.includes(c.weapon));
});

test('the weapon floor and 5 slots still fill with only 8 weapons: no shrunken picks', () => {
  const g = freshGame('blaster');
  const p = g.player;
  for (const level of [6, 12, 18, 24]) {
    p.level = level;
    while (weaponFloorDue(p, level)) {
      const picks = rollWeaponPicks(p, 3);
      assert.equal(picks.length, 3, `CHOOSE A WEAPON at LV ${level} still shows 3`);
      acquireWeapon(p, picks[0].weaponId);
    }
    assert.equal(ownedWeapons(p).length, weaponFloor(level), `floor met at LV ${level}`);
  }
  assert.equal(ownedWeapons(p).length, weaponSlots());
  assert.equal(canOfferNewWeapon(p), false, 'slots full');
  assert.ok(ownedWeapons(p).every((id) => OPEN_WEAPONS.includes(id)));
});

test('evolution hints never point at a recipe that needs a locked weapon', () => {
  const g = freshGame('missiles');
  const p = g.player;
  assert.equal(recipeReachable(p, 'evo_tempest'), false, 'Storm Protocol needs the locked Tesla Arc');
  assert.equal(recipeReachable(p, 'evo_pulsar'), true);
  const after = structuredClone(p);
  acquireWeapon(after, 'rockets');
  after.loadout = [...ownedWeapons(p)];
  for (const v of recipesAdvanced(p, structuredClone({ ...p, upgradeLevels: { ...p.upgradeLevels, missiles: 2 } }), 6)) {
    assert.notEqual(v.id, 'evo_tempest');
    assert.notEqual(v.id, 'evo_emp');
    assert.notEqual(v.id, 'evo_siege');
  }
  // Once Tesla Arc is unlocked the hint can come back.
  p.weaponPool = [...p.weaponPool, 'lightning'];
  assert.equal(recipeReachable(p, 'evo_tempest'), true);
});

test('each goal counts from the real game event', () => {
  const g = freshGame('blaster');
  const t = g.unlocks;
  const p = g.player;
  Object.assign(p, { x: 2000, y: 2000 });
  killOne(g);
  assert.equal(t.run.kills, 1, 'kills');
  killOne(g, { isBoss: true, type: 'boss' });
  assert.equal(t.run.bosses, 1, 'bosses');
  killOne(g, { hp: 3 }); // popped on the shield (hp left: a ram)
  assert.equal(t.run.rams, 1, 'rams');
  killOne(g, { lastStat: 'turret' });
  killOne(g, { lastStat: 'drone' });
  killOne(g, { lastStat: 'siege' }); // Siege Battery shells are the turret's
  assert.equal(t.run.deployKills, 3, 'turret and drone kills');
  killOne(g, { lastStat: 'blaster' });
  assert.equal(t.run.kills, 7);
  assert.equal(t.run.deployKills, 3, 'an Autocannon kill is not a deployable kill');

  // Ore veins: the ship's drill, not an elite grinding through.
  g.onRockShattered({ x: 0, y: 0, radius: 20, sides: 6, rotation: 0, hue: 48, oreType: 'gold_vein' });
  g.onRockShattered({ x: 0, y: 0, radius: 20, sides: 6, rotation: 0, hue: 140, oreType: 'shield_vein' });
  g.onRockShattered({ x: 0, y: 0, radius: 20, sides: 6, rotation: 0, hue: 200, oreType: 'rock' });
  g.onRockShattered({ x: 0, y: 0, radius: 20, sides: 6, rotation: 0, hue: 48, oreType: 'gold_vein', brokenBy: 'elite' });
  assert.equal(t.run.veins, 2, 'veins');

  // Dashes: only one that fires (not on cooldown).
  g.asteroidManager.getNearbyAsteroids = () => [];
  p.dashCooldown = 0;
  g.triggerDash();
  g.triggerDash(); // on cooldown now
  assert.equal(t.run.dashes, 1, 'dashes');

  // Statuses: each enemy once per status, on its first tick.
  const tough = () => { const e = enemy({ hp: 1e6, maxHp: 1e6 }); g.enemyManager.enemies.push(e); return e; };
  const a = tough(), b = tough(), c = tough(), d = tough();
  applyBurn(p, a, 1, 50, 'blaster');
  applyBurn(p, b, 1, 50, 'blaster');
  applyCorrode(p, c, 1, 50, 'rockets');
  applyShockStacks(p, d, 1, 50, 'missiles');
  for (let i = 0; i < 12; i++) updateStatusEffects(g, 0.25);
  applyBurn(p, a, 1, 50, 'blaster'); // the same hull again: no second count
  for (let i = 0; i < 4; i++) updateStatusEffects(g, 0.25);
  assert.equal(t.run.burned, 2, 'burned');
  assert.equal(t.run.corroded, 1, 'corroded');
  assert.equal(t.run.shocked, 1, 'shocked');
  const f = enemy({ hp: 400, maxHp: 400 }); // the freeze threshold scales with max HP
  g.enemyManager.enemies.push(f);
  for (let i = 0; i < 200 && !t.run.frozen; i++) {
    f.hp = f.maxHp; // frostbite ticks must not kill it first
    applyChill(p, f, 5, 60, 'blaster');
    updateStatusEffects(g, 0.25);
  }
  assert.equal(t.run.frozen, 1, 'frozen');

  // Wave: the best of one run.
  t.reach('wave', 12);
  t.reach('wave', 9);
  assert.equal(t.run.wave, 12);
  assert.equal(goalProgress(GOAL_BY_WEAPON.shockfield, t.stats()).have, 12);
});

test('progress is lifetime: run tallies add up across runs; one-run goals keep the best', () => {
  const merged = mergeStats({ kills: 1000, wave: 14 }, { kills: 250, wave: 9, bogus: 5 });
  assert.deepEqual(merged, { kills: 1250, wave: 14 });
  assert.equal(goalText(GOAL_BY_WEAPON.cryospray, 87), 'Freeze enemies 87/300');
  assert.equal(goalText(GOAL_BY_WEAPON.shockfield, 12), 'Reach wave 30 (best 12)');
});

test('finishing a goal mid-run unlocks the weapon at once: saved, joins the pool, raises the toast', () => {
  const g = freshGame('blaster');
  const seen = [];
  g.unlocks.onUnlock = (goal) => seen.push(goal.weapon);
  const first = UNLOCK_GOALS[0];
  g.unlocks.save.stats[first.stat] = first.need - 1; // one short from earlier runs
  g.unlocks.rebuildPending();
  assert.ok(!g.player.weaponPool.includes(first.weapon));
  killOne(g);
  assert.deepEqual(seen, [first.weapon]);
  assert.ok(g.player.weaponPool.includes(first.weapon), 'offered from now on in this run');
  assert.ok(unownedWeapons(g.player).includes(first.weapon));
  assert.ok(g.unlocks.save.weapons.includes(first.weapon));
  assert.deepEqual(g.unlocks.freshUnlocks(), [first.weapon], 'owed a reveal card at game over');
  killOne(g);
  assert.deepEqual(seen, [first.weapon], 'never unlocks twice');
  // The save on disk already has it (no wait for the run to end).
  const saved = JSON.parse([...globalThis.localStorage.store.values()][0]);
  assert.ok(saved.unlocks.weapons.includes(first.weapon));
});

test('unlocks persist across sessions; the reveal clears once shown; blocked storage never breaks a run', () => {
  globalThis.localStorage = memoryStorage();
  const prog = new ProgressionManager();
  const t = new UnlockTracker(prog);
  const player = {};
  t.startRun(player);
  for (let i = 0; i < 310; i++) t.bump('frozen');
  t.bump('kills', 400);
  t.endRun();
  const again = new ProgressionManager();
  assert.ok(again.data.unlocks.weapons.includes('cryospray'));
  assert.equal(again.data.unlocks.stats.frozen, 310);
  assert.equal(again.data.unlocks.stats.kills, 400);
  const t2 = new UnlockTracker(again);
  const p2 = {};
  t2.startRun(p2);
  assert.ok(p2.weaponPool.includes('cryospray'), 'next run draws it');
  assert.deepEqual(t2.freshUnlocks(), ['cryospray']);
  t2.markRevealed();
  assert.deepEqual(new ProgressionManager().data.unlocks.fresh, []);

  // An abandoned run (no game over) still banks its tally on the next start.
  t2.bump('kills', 50);
  t2.startRun({});
  assert.equal(new ProgressionManager().data.unlocks.stats.kills, 450);

  // Storage that throws: everything still works in memory.
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const blocked = new ProgressionManager();
  const tb = new UnlockTracker(blocked);
  const pb = {};
  tb.startRun(pb);
  assert.deepEqual([...pb.weaponPool].sort(), [...OPEN_WEAPONS].sort());
  tb.bump('kills', UNLOCK_GOALS[0].need);
  assert.ok(pb.weaponPool.includes(UNLOCK_GOALS[0].weapon), 'unlocked for this session');
});

test('save data is sanitised: unknown ids and counters drop, fresh only lists unlocked weapons', () => {
  const u = normalizeUnlocks({ stats: { kills: 12.7, frozen: -4, nope: 9, wave: 'x' }, weapons: ['cryospray', 'blaster', 'nonsense', 'cryospray'], fresh: ['cryospray', 'gas'] });
  assert.deepEqual(u, { stats: { kills: 12 }, weapons: ['cryospray'], fresh: ['cryospray'] });
  assert.deepEqual(normalizeUnlocks(null), { stats: {}, weapons: [], fresh: [] });
  assert.deepEqual(normalizeSave({}).unlocks, { stats: {}, weapons: [], fresh: [] }, 'a fresh save has nothing unlocked');
  assert.deepEqual(availableWeapons(normalizeSave({}).unlocks).sort(), [...OPEN_WEAPONS].sort());
});

test('the testing override lifts every lock (Live Tuning toggle and ?unlockall=1)', async () => {
  try {
    assert.equal(DEFAULT_TUNING.unlockAllWeapons, 0, 'off by default');
    assert.ok(TUNING_SCHEMA.flatMap((grp) => grp.items).some((i) => i.key === 'unlockAllWeapons'), 'in the Live Tuning studio');
    TUNING.unlockAllWeapons = 1;
    assert.equal(unlockOverride(), true);
    assert.equal(availableWeapons({ weapons: [] }), null, 'no pool: every weapon');
    assert.equal(isWeaponUnlocked({ weapons: [] }, 'nanites'), true);
    const g = freshGame('blaster');
    assert.equal(g.player.weaponPool, null);
    assert.equal(unownedWeapons(g.player).length, WEAPONS.length - 1);
    assert.equal(g.runTainted, true, 'a run with everything unlocked stays off the leaderboard');
  } finally {
    TUNING.unlockAllWeapons = 0;
  }
  // The URL flag (read once when the module loads).
  const prev = globalThis.location;
  globalThis.location = { search: '?foo=1&unlockall=1' };
  try {
    const fresh = await import('../js/weapon-unlocks.js?url-flag');
    assert.equal(fresh.unlockOverride({ unlockAllWeapons: 0 }), true);
    assert.equal(fresh.availableWeapons({ weapons: [] }), null);
  } finally {
    globalThis.location = prev;
  }
  assert.equal(unlockOverride(), false);
});

test('the balance tools and headless fixtures still reach all 20 weapons (no tracker, no pool)', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  assert.equal(g.player.weaponPool, undefined);
  assert.equal(unownedWeapons(g.player).length, WEAPONS.length - 1);
});

test('panels: the Field Guide arsenal shows locked silhouettes with goal and progress; toast, reveal and teaser', () => {
  const unlocks = normalizeUnlocks({ weapons: ['grenades'], stats: { frozen: 87 } });
  const html = weaponsHTML(null, { unlocks, stats: unlocks.stats });
  assert.equal((html.match(/weapon-locked/g) || []).length, 11, '11 still locked');
  assert.match(html, /Freeze enemies 87\/300/);
  assert.match(html, /9 \/ 20 WEAPONS UNLOCKED/);
  assert.match(html, new RegExp(`your ${weaponSlots()} weapon slots`));
  assert.equal((weaponsHTML(null).match(/weapon-locked/g) || []).length, 0, 'no unlock data: nothing locked');
  assert.deepEqual(unlockedCount(unlocks), { have: 9, total: 20 });

  const goal = GOAL_BY_WEAPON.cryospray;
  assert.match(unlockToastHTML(goal), /NEW WEAPON UNLOCKED/);
  assert.match(unlockToastHTML(goal), /Cryo Sprayer/);
  assert.match(revealCardHTML(goal), /Cryo Sprayer/);
  assert.match(revealCardHTML(goal), /assets\/weapons\/cryospray\.webp/);
  const near = nearestGoals(unlocks, unlocks.stats, 2);
  assert.equal(near.length, 2);
  assert.equal(near[0].goal.weapon, 'cryospray', 'the closest goal first');
  // A new pilot is pointed at the next few goals, not the long haul that shares their counter.
  const early = nearestGoals(normalizeUnlocks({ stats: { kills: 4000 } }), { kills: 4000 }, 2).map((x) => x.goal.weapon);
  assert.ok(!early.includes('nanites'), early.join());
  assert.equal(early[0], 'grenades');
  // Locked weapons are listed after the unlocked ones.
  assert.ok(html.indexOf('data-entry="nanites"') > html.indexOf('data-entry="grenades"'));
  assert.ok(html.indexOf('data-entry="lightning"') > html.indexOf('data-entry="turret"'));
  assert.match(teaserHTML(near, unlocks.stats), /NEXT UNLOCKS/);
});

test('the game-over reveal shows only when something was unlocked, then opens the results', async () => {
  const { UnlockUI } = await import('../js/unlock-ui.js');
  const g = freshGame('blaster');
  const ui = new UnlockUI(g); // the headless fixture has no UI: build one on the stubbed document
  let done = 0;
  assert.equal(ui.reveal(() => done++), false, 'nothing unlocked: straight to the results');
  g.unlocks.bump('kills', UNLOCK_GOALS[0].need);
  assert.equal(ui.reveal(() => done++), true);
  assert.equal(ui.revealOpen, true);
  assert.deepEqual(g.unlocks.freshUnlocks(), [], 'shown once');
  assert.equal(ui.handleKey({ code: 'Enter', preventDefault() {} }), true, 'keys are swallowed while it shows');
  assert.equal(ui.revealOpen, true, 'a press carried over from the death screen does not skip it');
  ui.revealAt = -1e9; // past the grace period
  ui.handleKey({ code: 'Enter', preventDefault() {} });
  assert.equal(ui.revealOpen, false);
  assert.equal(done, 1);
});
