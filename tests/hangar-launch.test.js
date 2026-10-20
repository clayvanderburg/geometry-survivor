import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 4: launching a ship (its kit or its start pick), the first ship quirks, and the results strip.
const h = await import('../tools/balance/harness.mjs');
const { ownedWeapons, START_WEAPON_CHOICES, WEAPONS } = await import('../js/loadout.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');
const { startChoices, runKit } = await import('../js/hangar-run.js');
const { eligibleUpgrades } = await import('../js/upgrades.js');
const { HERMIT_HOLD, MANTIS_DASH_REFUND, REVENANT_BOSS_DAMAGE } = await import('../js/ship-quirks.js');
const { nextFeat } = await import('../js/feats.js');
const { newHangar } = await import('../js/hangar-save.js');
const { resultsStripHTML } = await import('../js/hangar-ui.js');
const { FEAT_BY_ID } = await import('../js/feats.js');

const launchable = (g) => Object.assign(g, { ctx: new Proxy({}, { get: () => () => {} }) });
const shipGame = (ship, startWeapon = null) => {
  const g = h.createHeadlessGame();
  g.shipOverride = ship;
  g.resetRun('normal', startWeapon);
  return g;
};

test('flag off: the start pick and kit are exactly as before', () => {
  setHangarEnabled(false, { persist: false });
  const g = h.createHeadlessGame();
  g.resetRun('normal', 'rockets');
  assert.deepEqual(startChoices(g), START_WEAPON_CHOICES);
  assert.equal(runKit(g, 'rockets'), null);
  assert.deepEqual(ownedWeapons(g.player), ['rockets']);
});

test('fixed-kit ships start with their kit and skip the pick; pick ships use it; SOVEREIGN picks anything', () => {
  assert.deepEqual(ownedWeapons(shipGame('mantis', 'rockets').player), ['blaster'], 'MANTIS: Autocannon whatever was picked');
  assert.deepEqual(ownedWeapons(shipGame('brood').player), ['drones', 'turret']);
  assert.deepEqual(ownedWeapons(shipGame('hermit').player), ['shockfield']);
  assert.deepEqual(startChoices(shipGame('mantis')), []);
  assert.deepEqual(ownedWeapons(shipGame('lancer', 'missiles').player), ['missiles']);
  assert.deepEqual(startChoices(shipGame('lancer')), START_WEAPON_CHOICES);
  assert.deepEqual(ownedWeapons(shipGame('sovereign', 'gas').player), ['gas']);
  assert.equal(startChoices(shipGame('sovereign')).length, WEAPONS.length);
  const magpie = h.createHeadlessGame();
  magpie.shipOverride = 'gambler';
  magpie.startWeapon = 'rockets';
  magpie.resetRun('normal', null);
  assert.deepEqual(ownedWeapons(magpie.player), ['rockets'], 'MAGPIE: the last start pick, no pop-up');
  assert.deepEqual(startChoices(magpie), []);
});

test('a fixed-kit ship launches straight from LAUNCH, a pick ship opens its pick', () => {
  const g = launchable(h.createHeadlessGame()).enableStartPick();
  g.shipOverride = 'wasp';
  g.state = 'TITLE';
  g.startGame();
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(ownedWeapons(g.player), ['rockets']);
  const s = launchable(h.createHeadlessGame()).enableStartPick();
  s.shipOverride = 'sovereign';
  s.state = 'TITLE';
  s.startGame();
  assert.equal(s.startPickOpen, true);
  assert.equal(s.startPickCards.length, WEAPONS.length);
});

test('MANTIS: a crit kill refunds dash cooldown', () => {
  const g = shipGame('mantis');
  g.state = 'PLAYING';
  g.player.dashCooldown = 1;
  const e = { type: 'drone', x: 0, y: 0, hp: 0, radius: 10, sides: 3, hue: 0, lastCrit: true };
  g.enemyManager.enemies.push(e);
  g.killEnemy(e);
  assert.ok(Math.abs(g.player.dashCooldown - (1 - MANTIS_DASH_REFUND)) < 1e-9);
});

test('HERMIT: the first breaking hit holds the shield at 1; the second does not', () => {
  const g = shipGame('hermit');
  g.player.hp = 10;
  assert.equal(g.damagePlayer(50), false);
  assert.equal(g.player.hp, 1);
  assert.ok(g.player.invuln >= HERMIT_HOLD);
  assert.equal(g.damagePlayer(50), true, 'once per run');
  const crab = shipGame('vexolith');
  crab.player.hp = 10;
  assert.equal(crab.damagePlayer(50), true);
});

test('PYRE: a burning death passes FIRE to the nearest neighbour', () => {
  const g = shipGame('pyre');
  const dead = { type: 'drone', x: 0, y: 0, hp: 0, radius: 10, sides: 3, hue: 0, st: { burn: 10, cold: 0, corrode: 0, frozenMax: 0, burnStat: 'burn' } };
  const near = { type: 'drone', x: 60, y: 0, hp: 50, radius: 10 };
  const far = { type: 'drone', x: 900, y: 0, hp: 50, radius: 10 };
  g.enemyManager.enemies.push(dead, near, far);
  g.killEnemy(dead);
  assert.ok(near.st?.burn > 0, 'the neighbour burns');
  assert.equal(far.st, undefined);
});

test('REVENANT: HARDCORE shield rules in NORMAL, and every boss kill adds damage for the run', () => {
  const g = shipGame('revenant');
  assert.equal(eligibleUpgrades(g.player).some((u) => u.shieldCard), false, 'no shield cards');
  const crab = shipGame('vexolith');
  assert.ok(eligibleUpgrades(crab.player).some((u) => u.shieldCard));
  const before = g.player.stats.damage;
  const boss = { type: 'drone', x: 0, y: 0, hp: 0, radius: 10, sides: 3, hue: 0, isBoss: true };
  g.enemyManager.enemies.push(boss);
  g.killEnemy(boss);
  assert.ok(Math.abs(g.player.stats.damage - before * (1 + REVENANT_BOSS_DAMAGE)) < 1e-9);
  assert.ok(Math.abs(g.player.base.stats.damage - g.player.stats.damage) < 1e-9, 'kept through a discard rebuild');
});

test('results strip: this run\'s unlocks and the closest feat still to do', () => {
  const hg = newHangar({});
  hg.career.rocksMined = 390;
  assert.equal(nextFeat(hg).feat.id, 'rocks_400');
  const html = resultsStripHTML([{ feat: FEAT_BY_ID.kills_1500, added: ['ship:mantis'] }], hg);
  assert.match(html, /NEW IN THE HANGAR/);
  assert.match(html, /EXTERMINATOR — MANTIS JOINS THE HANGAR/);
  assert.match(html, /DEEP CORE: 10 ROCKS TO GO → PROSPECTOR/);
});

test('tuner UNLOCK ALL grants every ship (preview helper)', async () => {
  const { unlockAllShips } = await import('../js/hangar-run.js');
  const { SHIPS } = await import('../js/ships.js');
  const g = h.createHeadlessGame();
  unlockAllShips(g.progression);
  assert.equal(g.progression.data.hangar.ships.length, SHIPS.length);
});
