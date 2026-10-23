import test from 'node:test';
import assert from 'node:assert/strict';

// Glaive Discs: an autonomous kinetic weapon (automatic single-target class). Throws at the nearest
// enemies, ricochet chains that land exactly 1 + ricochets hits, the lone-target swing back, rock and
// plate bounces, the speed lost per bounce, the three Breakthroughs, card previews, and it never touches
// the ship's shield. The class target (~85% of the Autocannon in the card bench) is in weapon-balance.test.js.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, WEAPON_CLASS, weaponDamage } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, makeBuild, levelBuild, weaponBuild } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, WEAPONS, weaponTags } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { GlaiveDiscs } = await import('../js/glaive.js');

const DT = 1 / 60;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A headless game with only the Glaive Discs equipped, no rocks, and the given still enemies.
function glaiveGame({ cards = [], bt = {}, foes = [] } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'glaive');
  p.loadout = ['glaive'];
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { glaive: bt };
  g.asteroidManager.asteroids.length = 0;
  g.asteroidManager.rebuildSpatialHash();
  g.enemyManager.enemies.length = 0;
  for (const f of foes) addFoe(g, f);
  const log = [];
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    log.push({ e, dmg, stat });
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, log, glaive: g.glaive };
}

function addFoe(g, { d = 0, a = 0, x, y, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: x ?? p.x + Math.cos(a) * d, y: y ?? p.y + Math.sin(a) * d, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the discs; after the first throw the launcher is held, so one throw can be counted.
function runOneThrow(g, seconds = 6) {
  g.glaive.update(DT, g);
  g.glaive.timer = 1e9;
  for (let i = 0; i < seconds * 60; i++) g.glaive.update(DT, g);
}

const pack = (n, d = 140, spacing = 70) => Array.from({ length: n }, (_, k) => ({ d: d + (k % 3) * spacing, a: (k / n) * Math.PI * 2 }));

test('Glaive Discs is an AUTONOMOUS automatic single-target weapon: source glaive, PROJECTILE + KINETIC, four single-stat cards', () => {
  const w = WEAPON_BY_ID.glaive;
  assert.equal(w.name, 'Glaive Discs');
  assert.equal(w.category, 'AUTONOMOUS');
  assert.deepEqual(WEAPON_TAGS.glaive, ['projectile', 'kinetic']);
  for (const t of weaponTags('glaive')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.glaive, 'glaive');
  assert.equal(WEAPON_CLASS.glaive, 'auto');
  assert.ok(DAMAGE_SOURCE_COLORS.glaive);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['glaive', 'glaive_recall']) assert.equal(groups[stat], 'glaive', stat);
  assert.deepEqual(STAT_CARDS.glaive.map((c) => c.stat), ['damage', 'count', 'chain', 'rate']); // Glaive Spin retired in v0.46 (a dead pick)
  assert.deepEqual(STAT_CARDS.glaive.map((c) => POWER_STATS.has(c.stat)), [true, true, true, true]);
  assert.equal(ELEMENT_CARDS.glaive, undefined);
  for (const c of STAT_CARDS.glaive) assert.match(c.summary, /^Glaive Discs:/);
  for (const m of BREAKTHROUGH_LEVELS) assert.ok(TRANSFORMS.glaive[m], `transform at LV ${m}`);
  const b = levelBuild('glaive', 1);
  assert.equal(W.glaiveCount(b), 2);
  assert.equal(W.glaiveBounces(b), 4);
  assert.ok(near(W.glaiveCooldown(b), 1.2));
});

test('the potential counts every ricochet as a full hit: count x (1 + ricochets) per throw', () => {
  const b = makeBuild('glaive', 4, { count: 1, chain: 2 });
  assert.equal(W.glaiveDiscUnits(b), 1 + W.glaiveBounces(b));
  assert.ok(near(POTENTIAL_DPS.glaive(b), W.glaiveCount(b) * (1 + W.glaiveBounces(b)) * W.glaiveDamageMult(b) / W.glaiveCooldown(b)));
  // Every Breakthrough is exactly a transform's worth.
  for (const m of BREAKTHROUGH_LEVELS) {
    const plain = POTENTIAL_DPS.glaive(makeBuild('glaive', m, { damage: 2 }));
    const t = POTENTIAL_DPS.glaive(makeBuild('glaive', m, { damage: 2 }, { [m]: 'transform' }));
    assert.ok(near(t, plain * BT_TRANSFORM_DPS), `LV ${m}`);
  }
});

test('throws one disc at each of the nearest enemies in range, and holds the throw while none is', () => {
  const far = glaiveGame({ foes: [{ d: W.glaiveThrowRange + 60 }] });
  far.glaive.update(DT, far.g);
  assert.equal(far.glaive.count, 0, 'nothing in range: no throw');
  assert.equal(far.glaive.timer, 0, 'the throw is held, ready');

  const { g, glaive } = glaiveGame({ foes: [{ d: 200, a: 0 }, { d: 220, a: Math.PI }, { d: 400, a: 1.5 }] });
  glaive.update(DT, g);
  assert.equal(glaive.count, 2);
  assert.equal(glaive.throws, 1);
  assert.ok(near(glaive.timer, W.glaiveCooldown(weaponBuild(g.player, 'glaive'))));
  const heads = glaive.discs.filter((d) => d.active).map((d) => Math.sign(d.vx)).sort();
  assert.deepEqual(heads, [-1, 1], 'one disc at each of the two nearest');
});

test('a disc lands exactly 1 + ricochets hits on a pack, spread over several enemies', () => {
  const { g, log } = glaiveGame({ foes: pack(12) });
  runOneThrow(g);
  const b = weaponBuild(g.player, 'glaive');
  assert.equal(log.length, W.glaiveCount(b) * (1 + W.glaiveBounces(b)));
  assert.ok(log.every((x) => x.stat === 'glaive'));
  assert.ok(log.every((x) => near(x.dmg, weaponDamage(g.player, 'glaive', b))), 'no Breakthroughs: every hit is a full hit');
  assert.ok(new Set(log.map((x) => x.e)).size >= 4, 'ricochets spread through the pack');
  assert.equal(g.glaive.count, 0, 'spent discs fade out');
});

test('Glaive Ricochet and Disc Count cards add hits; a lone enemy takes every hit as the disc swings back round', () => {
  const more = glaiveGame({ cards: [['glaive_chain', 2], ['glaive_count', 1]], foes: pack(12) });
  runOneThrow(more.g);
  assert.equal(more.log.length, 3 * (1 + 6));

  const lone = glaiveGame({ foes: [{ d: 160 }] });
  runOneThrow(lone.g);
  assert.equal(lone.log.length, 2 * 5, 'single target: the full chain lands on it');
});

test('every bounce sheds speed; a slowed disc fades early', () => {
  const { g, glaive } = glaiveGame({ foes: pack(12) });
  glaive.update(DT, g);
  const d = glaive.discs.find((x) => x.active);
  const launch = d.launch;
  for (let i = 0; i < 120 && d.active && d.hits < 3; i++) glaive.update(DT, g);
  assert.ok(near(d.speed, launch * (1 - W.glaiveSpeedLoss) ** d.hits, 1e-6), `speed ${d.speed} after ${d.hits} hits`);
  // A disc already under the minimum speed fades on its next step without hitting anything.
  d.speed = launch * W.glaiveMinSpeedShare * 0.9;
  glaive.update(DT, g);
  assert.ok(d.fade > 0 || !d.active);
});

test('rocks bounce discs back without spending a ricochet; armored plates spend one and take no damage', () => {
  const { g, glaive, p, log } = glaiveGame({ foes: [{ d: 300 }] });
  const rock = g.asteroidManager.makeRock(p.x + 120, p.y, 30, 'rock');
  g.asteroidManager.rebuildSpatialHash();
  glaive.update(DT, g);
  glaive.timer = 1e9;
  const d = glaive.discs.find((x) => x.active);
  const left = d.left;
  for (let i = 0; i < 30 && d.vx > 0; i++) glaive.update(DT, g);
  assert.ok(d.vx < 0, 'bounced back off the rock');
  assert.equal(d.left, left, 'no ricochet spent');
  assert.ok(d.speed < d.launch);
  assert.ok(rock.hp > 0);
  assert.equal(log.length, 0);

  const plated = glaiveGame({ foes: [{ d: 150, deflect: true }, { d: 150, a: Math.PI }] });
  runOneThrow(plated.g);
  const armored = plated.g.enemyManager.enemies[0];
  assert.equal(armored.hp, armored.maxHp, 'plates deflect every disc');
});

test('Fission Discs: the first hit splits a disc and both twins carry the ricochets left, at fissionShare', () => {
  const { g, log } = glaiveGame({ bt: { 6: 'transform' }, cards: [['glaive_damage', 5]], foes: pack(14) });
  runOneThrow(g);
  const b = weaponBuild(g.player, 'glaive');
  const n = W.glaiveBounces(b);
  assert.equal(log.length, W.glaiveCount(b) * (1 + 2 * n));
  const full = weaponDamage(g.player, 'glaive', b);
  assert.equal(log.filter((x) => near(x.dmg, full)).length, W.glaiveCount(b), 'one full first hit per disc');
  assert.equal(log.filter((x) => near(x.dmg, full * W.fissionShare)).length, W.glaiveCount(b) * 2 * n);
});

test('Momentum Edge: bounces speed discs up and every ricochet hits momentumGrowth x harder than the last', () => {
  const { g, glaive, log } = glaiveGame({ bt: { 6: 'boost', 12: 'transform' }, cards: [['glaive_damage', 11]], foes: pack(12) });
  glaive.update(DT, g);
  glaive.timer = 1e9;
  const d = glaive.discs.find((x) => x.active);
  for (let i = 0; i < 360; i++) glaive.update(DT, g);
  const first = log.map((x) => x.dmg);
  const b = weaponBuild(g.player, 'glaive');
  const base = weaponDamage(g.player, 'glaive', b);
  const expected = [];
  for (let k = 0; k <= W.glaiveBounces(b); k++) expected.push(base * W.momentumGrowth ** k);
  for (const v of expected) assert.equal(first.filter((x) => near(x, v)).length, W.glaiveCount(b), `a hit of ${v.toFixed(1)} per disc`);
  assert.ok(d.speed > d.launch, 'sped up');
});

test('Boomerang Recall: spent discs fly home slicing enemies on the way (glaive_recall), then vanish at the ship', () => {
  const { g, glaive, log } = glaiveGame({ bt: { 6: 'boost', 12: 'boost', 18: 'transform' }, cards: [['glaive_damage', 11], ['glaive_count', 6]], foes: pack(18, 120, 60) });
  runOneThrow(g, 8);
  const recall = log.filter((x) => x.stat === 'glaive_recall');
  assert.ok(recall.length > 0, 'the way home hits');
  const b = weaponBuild(g.player, 'glaive');
  for (const x of recall) assert.ok(near(x.dmg, weaponDamage(g.player, 'glaive', b) * W.recallShare));
  assert.ok(recall.length <= W.glaiveCount(b) * W.recallHits);
  assert.equal(glaive.count, 0, 'every disc made it home');
});

test('a live fight with all three transforms deals damage and never touches the shield', () => {
  const { g, p, log } = glaiveGame({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, cards: [['glaive_damage', 6], ['glaive_count', 2]], foes: pack(24, 120, 50) });
  p.hp = p.maxHp = 100;
  for (let i = 0; i < 600; i++) g.glaive.update(DT, g);
  assert.equal(p.hp, 100);
  assert.ok(log.some((x) => x.stat === 'glaive'));
  assert.ok(log.some((x) => x.stat === 'glaive_recall'));
});

test('cards preview the discs exactly: the pick leads with discs per throw, each card with its own stat', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const pick = describeWeaponPick(g.player, 'glaive');
  assert.equal(pick.name, 'Glaive Discs');
  assert.ok(pick.rows.some((r) => r.id === 'glaiveCount' && r.after === '2'));
  acquireWeapon(g.player, 'glaive');
  const chain = describeUpgrade(g.player, { ...UPGRADE_BY_ID.glaive_chain, levelJump: 1 });
  assert.match(chain.headline, /\+1 RICOCHET/);
  assert.equal(chain.toLevel, 2);
  for (const [m, row] of [[6, 'glaiveFission'], [12, 'glaiveMomentum'], [18, 'glaiveRecall']]) {
    const card = describeBreakthrough(g.player, 'glaive', m, 'transform');
    assert.equal(card.category, 'GLAIVE DISCS');
    assert.match(card.headline, /\+22% DPS/);
    assert.ok(card.rows.some((r) => r.id === row), `${m}: ${row}`);
  }
  assert.ok(g.glaive instanceof GlaiveDiscs);
});
