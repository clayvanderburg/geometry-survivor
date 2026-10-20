import test from 'node:test';
import assert from 'node:assert/strict';

// Rail Lance: a PRIMARY, KINETIC aimed weapon. Charge then fire, a line that pierces every enemy and rock to
// the screen edge (each enemy behind the first takes railKeep of the one before), single-stat cards, the
// three Breakthroughs (Magnetic Rail, Ion Wake, Overload Shot) and the registries every weapon needs.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, LV1_TRIM, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, WEAPON_CLASS, weaponDamage } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, makeBuild, levelBuild, weaponBuild } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, weaponTags } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { weaponChipsHtml } = await import('../js/run-overview.js');
const { RailLance, reachToEdge, magnetScale } = await import('../js/rail-lance.js');

const DT = 1 / 60;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A headless game with only the Rail Lance equipped, aiming along +x, and still enemies at (dx, dy) off the ship.
function railGame({ cards = [], bt = {}, foes = [] } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'raillance');
  p.loadout = ['raillance'];
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { raillance: bt };
  p.angle = 0;
  p.stats.critChance = 0;
  g.camX = p.x - g.width / 2;
  g.camY = p.y - g.height / 2;
  g.enemyManager.enemies.length = 0;
  const foesOut = foes.map((f) => addFoe(g, f));
  const hits = [];
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    hits.push({ e, dmg, source, stat });
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, hits, foes: foesOut, rail: g.railLance };
}

function addFoe(g, { dx, dy = 0, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: p.x + dx, y: p.y + dy, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the lance, trigger held, like Game.update does each tick.
const tick = (g, n = 1, fire = true) => { for (let i = 0; i < n; i++) g.railLance.update(DT, g, fire); };
const ticksToCharge = (b) => Math.ceil(W.railCharge(b) / DT - 1e-6);

test('Rail Lance is a PRIMARY KINETIC aimed slot weapon with five single-stat cards and three Breakthroughs', () => {
  const w = WEAPON_BY_ID.raillance;
  assert.equal(w.category, 'PRIMARY');
  assert.deepEqual(w.tagSources, ['rail']);
  assert.deepEqual(WEAPON_TAGS.rail, ['kinetic']);
  for (const t of weaponTags('raillance')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.rail, 'raillance');
  assert.equal(WEAPON_CLASS.raillance, 'aimed');
  assert.ok(DAMAGE_SOURCE_COLORS.rail);
  const groups = buildSourceGroups([w]);
  for (const stat of ['rail', 'ionwake', 'overload']) assert.equal(groups[stat], 'raillance', stat);
  assert.deepEqual(STAT_CARDS.raillance.map((c) => c.stat), ['damage', 'rate', 'count', 'width', 'pierce']);
  assert.deepEqual(STAT_CARDS.raillance.map((c) => POWER_STATS.has(c.stat)), [true, true, true, false, false]);
  assert.equal(ELEMENT_CARDS.raillance, undefined, 'no element cards');
  for (const c of STAT_CARDS.raillance) assert.match(c.summary, /^Rail Lance:/);
  assert.deepEqual(BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.raillance[m].name), ['Magnetic Rail', 'Ion Wake', 'Overload Shot']);
  assert.ok(UPGRADE_BY_ID.raillance.isCore);
});

test('LV 1: charges ~0.8 s and fires about once a second, on the curve times its LV1_TRIM', () => {
  const b = levelBuild('raillance', 1);
  assert.ok(near(W.railCharge(b), 0.8));
  assert.ok(near(W.railCycle(b), 1));
  assert.equal(W.railLances(b), 1);
  assert.equal(LV1_TRIM.raillance, 2);
  assert.ok(near(POTENTIAL_DPS.raillance(b), DPS_TARGET(1) * LV1_TRIM.raillance));
  // Capacitor Bank is capped so even a maxed lance still charges visibly.
  const caps = Object.fromEntries(STAT_CARDS.raillance.map((c) => [c.stat, c.maxLevel]));
  assert.ok(W.railCharge(makeBuild('raillance', 18, { rate: caps.rate })) >= 0.2);
  assert.ok(W.railKeep(makeBuild('raillance', 18, { pierce: caps.pierce + 3 })) <= 1, 'never gains damage while piercing');
});

test('charges while the trigger is held, fires once per cycle, and holds a full charge when released', () => {
  const { g, p, hits } = railGame({ foes: [{ dx: 200 }] });
  const b = weaponBuild(p, 'raillance');
  const n = ticksToCharge(b);
  tick(g, n - 1);
  assert.equal(hits.length, 0, 'no shot before the charge completes');
  assert.ok(g.railLance.hudCharge() >= 0.9);
  tick(g, 1);
  assert.equal(hits.length, 1, 'fires the tick the charge completes');
  assert.equal(g.railLance.hudCharge(), 0, 'gauge empties on the shot');
  tick(g, Math.round(5 / DT));
  assert.equal(hits.length, 1 + 5, 'one shot per 1 s cycle');
  // Released mid-charge: the charge waits; it never fires without the trigger.
  const r = railGame({ foes: [{ dx: 200 }] });
  tick(r.g, n + 2, false);
  assert.equal(r.hits.length, 0);
  tick(r.g, n);
  assert.equal(r.hits.length, 1);
});

test('the lance pierces every enemy on its line, nearest first, each behind taking railKeep of the one before', () => {
  const { g, p, hits, foes } = railGame({ foes: [{ dx: 300 }, { dx: 120 }, { dx: 520 }, { dx: 200, dy: 80 }] });
  tick(g, ticksToCharge(weaponBuild(p, 'raillance')));
  const dmg = weaponDamage(p, 'rail');
  const keep = W.railKeep(weaponBuild(p, 'raillance'));
  assert.deepEqual(hits.map((x) => x.e), [foes[1], foes[0], foes[2]], 'off-line enemy is missed, the rest hit in order');
  hits.forEach((x, k) => assert.ok(near(x.dmg, dmg * keep ** k), `enemy ${k}`));
  // Penetrator Core keeps more past each enemy.
  assert.ok(W.railKeep(makeBuild('raillance', 3, { pierce: 2 })) > keep);
});

test('it reaches the screen edge (and no further), and rocks never stop it', () => {
  const { g, p, hits } = railGame({ foes: [{ dx: 600 }, { dx: 700 }] });
  // A rock right in the line.
  g.asteroidManager.asteroids = [{ x: p.x + 150, y: p.y, radius: 60, hp: 100, maxHp: 100 }];
  g.asteroidManager.rebuildSpatialHash?.();
  tick(g, ticksToCharge(weaponBuild(p, 'raillance')));
  assert.deepEqual(hits.map((x) => x.e.x - p.x), [600], 'hits beyond the rock up to the edge; nothing off screen');
  assert.equal(g.asteroidManager.asteroids[0].hp, 100, 'weapons never hurt rocks');
  assert.ok(near(reachToEdge(0, 0, 1, 0, -10, -10, 50, 10), 50));
  assert.ok(near(reachToEdge(0, 0, 0, -1, -10, -10, 50, 10), 10));
  assert.equal(reachToEdge(99, 0, 1, 0, -10, -10, 50, 10), 0);
});

test('Split Rails fans extra lances round the aim; Flux Lens widens the line', () => {
  const off = Math.tan(W.railSpread) * 400;
  const split = railGame({ cards: [['raillance_count', 2]], foes: [{ dx: 400 }, { dx: 400, dy: off }, { dx: 400, dy: -off }] });
  tick(split.g, ticksToCharge(weaponBuild(split.p, 'raillance')));
  assert.equal(new Set(split.hits.map((x) => x.e)).size, 3, 'three lances, three targets');
  const thin = railGame({ foes: [{ dx: 300, dy: 26 }] });
  tick(thin.g, ticksToCharge(weaponBuild(thin.p, 'raillance')));
  const wide = railGame({ cards: [['raillance_width', 6]], foes: [{ dx: 300, dy: 26 }] });
  tick(wide.g, ticksToCharge(weaponBuild(wide.p, 'raillance')));
  assert.equal(thin.hits.length, 0);
  assert.equal(wide.hits.length, 1);
});

test('Magnetic Rail drags enemies near the line onto it while charging (bosses hold); every lance hits x1.22', () => {
  const { g, p, foes } = railGame({ bt: { 6: 'transform' }, foes: [{ dx: 250, dy: 90 }, { dx: 250, dy: 90, isBoss: true, radius: 40 }, { dx: 250, dy: -200 }] });
  tick(g, 20);
  assert.ok(foes[0].y - p.y < 90 - 30, 'pulled toward the line');
  assert.equal(foes[1].y - p.y, 90, 'bosses hold their ground');
  assert.equal(foes[2].y - p.y, -200, 'out of reach');
  assert.equal(magnetScale({ isBoss: true }), 0);
  const plain = W.railDamageMult(makeBuild('raillance', 6));
  assert.ok(near(W.railDamageMult(makeBuild('raillance', 6, {}, { 6: 'transform' })), plain * BT_TRANSFORM_DPS));
});

test('Ion Wake: the line keeps ticking whatever stands on it for wakeLife s, wakeShare of a hit in all', () => {
  const { g, p, hits } = railGame({ bt: { 12: 'transform' }, foes: [{ dx: 300 }] });
  const b = weaponBuild(p, 'raillance');
  tick(g, ticksToCharge(b));
  const lance = hits.filter((x) => x.stat === 'rail');
  assert.equal(lance.length, 1);
  // Walk in a fresh enemy right after the shot: the wake still bites it.
  const late = addFoe(g, { dx: 450, dy: 2 });
  tick(g, Math.round(W.wakeLife / DT) + 2, false);
  const wake = hits.filter((x) => x.stat === 'ionwake');
  const ticks = Math.round(W.wakeLife / W.wakeTick);
  assert.equal(wake.filter((x) => x.e === late).length, ticks, 'one tick every wakeTick s');
  const perTick = lance[0].dmg * W.wakeShare / ticks;
  for (const x of wake) assert.ok(near(x.dmg, perTick, 1e-6));
  assert.equal(g.railLance.wakeCount, 0, 'the wake is gone after its life');
});

test('Overload Shot: every third shot is a wider beam that hits overloadMult x as hard', () => {
  const { g, p, hits } = railGame({ bt: { 18: 'transform' }, foes: [{ dx: 300 }, { dx: 300, dy: 20 }] });
  const b = weaponBuild(p, 'raillance');
  tick(g, ticksToCharge(b) + Math.round(2 * W.railCycle(b) / DT));
  const stats = hits.map((x) => x.stat);
  assert.deepEqual(stats.filter((s) => s === 'rail').length, 2, 'two plain shots on the centre target');
  const over = hits.filter((x) => x.stat === 'overload');
  assert.equal(over.length, 2, 'the wide beam also clips the enemy beside the line');
  const plain = hits.find((x) => x.stat === 'rail');
  assert.ok(near(over[0].dmg, plain.dmg * W.overloadMult));
});

test('cards, the weapon pick and Breakthrough cards preview exact Rail Lance numbers; the HUD chip shows the charge', () => {
  const { g, p } = railGame();
  const pick = describeWeaponPick(h.createHeadlessGame().player ?? p, 'raillance');
  assert.ok(pick);
  const dmgCard = describeUpgrade(p, { ...UPGRADE_BY_ID.raillance_damage, levelJump: 1 });
  assert.ok(dmgCard.rows.some((r) => r.id === 'railDamage'));
  const rate = describeUpgrade(p, { ...UPGRADE_BY_ID.raillance_rate, levelJump: 1 });
  assert.ok(rate.rows.some((r) => r.id === 'railCycle'));
  assert.ok(describeBreakthrough(p, 'raillance', 6, 'transform').rows.some((r) => r.id === 'railMagnet'));
  assert.ok(describeBreakthrough(p, 'raillance', 12, 'transform').rows.some((r) => r.id === 'railWake'));
  assert.ok(describeBreakthrough(p, 'raillance', 18, 'transform').rows.some((r) => r.id === 'railOverload'));
  tick(g, 24);
  assert.match(weaponChipsHtml(p, { raillance: g.railLance.hudCharge() }), /charge/);
  assert.ok(g.railLance instanceof RailLance);
});

test('it runs in a live fight through Game.update and draws without errors', () => {
  const { g, p, foes } = railGame({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, foes: [{ dx: 200 }, { dx: 260, dy: 30 }, { dx: 330, dy: -40 }] });
  p.invuln = 1e9;
  g.autoFire = true;
  g.autoAim = true;
  for (let i = 0; i < 60 * 4; i++) g.update(DT);
  assert.ok(foes.some((e) => e.hp < e.maxHp));
  const calls = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.railLance.draw(calls, g);
  g.railLance.chargeShare = 0.5;
  g.railLance.fired = false;
  g.railLance.draw(calls, g);
});
