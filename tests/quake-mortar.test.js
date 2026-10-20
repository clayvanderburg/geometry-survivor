import test from 'node:test';
import assert from 'node:assert/strict';

// Quake Mortar: an autonomous EXPLOSIVE AREA weapon. Volleys go to the densest packs, each shell lands as
// an expanding shockwave ring that hits every enemy once as its front passes, shoves it outward and
// cracks rocks (a broken rock counts as mined, bedrock never cracks). The three Breakthroughs, card
// previews, pools and the registry wiring.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, LV1_TRIM, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, WEAPON_CLASS, weaponDamage, quakeRadius } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, levelBuild, weaponBuild, weaponElement } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, WEAPONS, weaponTags } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');

const DT = 1 / 60;

// A headless game with only the mortar equipped and the given still enemies (offsets from the ship).
function quakeGame({ cards = [], bt = {}, foes = [] } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'quake');
  discardWeapon(p, 'blaster');
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { quake: bt };
  g.enemyManager.enemies.length = 0;
  g.asteroidManager.asteroids = [];
  g.asteroidManager.rebuildSpatialHash();
  for (const f of foes) addFoe(g, f);
  const bySource = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    e.quakeHits = (e.quakeHits || 0) + 1;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, bySource, qm: g.quakeMortar };
}

function addFoe(g, { x, y, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: p.x + x, y: p.y + y, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the mortar, like Game.update does each tick.
const tick = (g, n = 1) => { for (let i = 0; i < n; i++) g.quakeMortar.update(DT, g); };
const volley = (g) => { g.quakeMortar.timer = 0; tick(g, Math.ceil((W.quakeFlight * 1.1 + W.quakeRingTime * 1.4) / DT)); };

test('Quake Mortar is an AUTONOMOUS slot weapon: source quake, EXPLOSIVE + AREA, area class, five single-stat cards', () => {
  const w = WEAPON_BY_ID.quake;
  assert.equal(w.name, 'Quake Mortar');
  assert.equal(w.category, 'AUTONOMOUS');
  assert.deepEqual(WEAPON_TAGS.quake, ['explosive', 'area']);
  for (const t of weaponTags('quake')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.quake, 'quake');
  assert.equal(WEAPON_CLASS.quake, 'area');
  assert.ok(DAMAGE_SOURCE_COLORS.quake);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['quake', 'quake_skip', 'quake_fault', 'quake_epicenter']) assert.equal(groups[stat], 'quake', stat);
  assert.deepEqual(STAT_CARDS.quake.map((c) => c.stat), ['damage', 'count', 'rate', 'radius', 'bore']);
  assert.deepEqual(STAT_CARDS.quake.map((c) => POWER_STATS.has(c.stat)), [true, true, true, false, false]);
  assert.equal(ELEMENT_CARDS.quake, undefined, 'no element cards');
  for (const c of STAT_CARDS.quake) assert.match(c.summary, /^Quake Mortar:/);
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.quake[m].summary, /Quake Mortar/);
  assert.equal(LV1_TRIM.quake, 0.33);
  assert.ok(Math.abs(POTENTIAL_DPS.quake(levelBuild('quake', 1)) / (DPS_TARGET(1) * 0.33) - 1) < 1e-9);
});

test('a volley goes to the densest pack, not the nearest straggler', () => {
  const foes = [{ x: 90, y: 0 }];
  for (let k = 0; k < 6; k++) foes.push({ x: -300 + Math.cos(k) * 30, y: 120 + Math.sin(k) * 30 });
  const { g, qm } = quakeGame({ foes });
  qm.timer = 0;
  tick(g);
  assert.equal(qm.shellCount, W.quakeShells(levelBuild('quake', 1)));
  const p = g.player;
  const first = qm.shells.slice(0, qm.shellCount).map((s) => Math.hypot(s.lx - (p.x - 300), s.ly - (p.y + 120)));
  assert.ok(Math.min(...first) < 40, `a shell lands on the pack (${Math.min(...first).toFixed(0)} px off)`);
});

test('the ring hits every enemy once as its front passes, full at the impact and less at the rim, and shoves it outward', () => {
  const { g, p, qm } = quakeGame({ foes: [{ x: 200, y: 0 }] });
  const r = quakeRadius(p);
  const center = addFoe(g, { x: 0, y: 260 });
  const rim = addFoe(g, { x: r - 4, y: 260 });
  const outside = addFoe(g, { x: r + 40, y: 260 });
  const dmg = weaponDamage(p, 'quake');
  qm.quake(g, center.x, center.y, r, dmg, 0, W.quakeKnock, 'quake', false);
  tick(g, Math.ceil(W.quakeRingTime / DT) + 2);
  assert.equal(center.quakeHits, 1);
  assert.equal(rim.quakeHits, 1, 'the rim is hit exactly once');
  assert.equal(outside.quakeHits, undefined, 'nothing past the ring');
  assert.ok(Math.abs((1e7 - center.hp) - dmg) / dmg < 0.35, 'about full damage at the impact (crits aside)');
  assert.ok(rim.knockX > 0, 'shoved outward');
  assert.equal(qm.ringCount, 0, 'the ring is gone after its life');
});

test('rings crack rocks: mining damage per ring, a broken rock counts as mined, bedrock never cracks; Bore Charge only adds rock damage', () => {
  const { g, p, qm } = quakeGame({ foes: [{ x: 600, y: 0 }] });
  const am = g.asteroidManager;
  const rock = am.makeRock(p.x + 60, p.y, 22, 'rock');
  const bed = am.addBedrock(p.x - 60, p.y, 30);
  am.rebuildSpatialHash();
  const mined = g.rocksMined || 0;
  const per = W.quakeRockDamage(weaponBuild(p, 'quake')) * (p.stats.miningSpeed || 75) / 75;
  qm.quake(g, p.x, p.y, 120, 1, per, 0, 'quake', false);
  tick(g, 40);
  assert.ok(Math.abs((rock.maxHp - rock.hp) - per) < 1e-6, 'one ring, one rock hit');
  assert.equal(bed.hp, bed.maxHp, 'bedrock untouched');
  while (am.asteroids.includes(rock)) {
    qm.quake(g, p.x, p.y, 120, 1, per, 0, 'quake', false);
    tick(g, 40);
  }
  assert.equal(g.rocksMined, mined + 1, 'counted as mined');
  assert.ok(am.asteroids.includes(bed));
  const b0 = levelBuild('quake', 1);
  const b = weaponBuild(p, 'quake');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.quake_bore, levelJump: 2 });
  const b2 = weaponBuild(p, 'quake');
  assert.equal(W.quakeRockDamage(b2), W.quakeRockDamage(b0) * 2);
  assert.equal(W.quakeDamageMult(b2), W.quakeDamageMult(b), 'Bore Charge adds no damage');
});

test('Skipping Shells: every landed shell skips on twice, each skip a smaller quake', () => {
  const foes = [];
  for (let k = 0; k < 4; k++) foes.push({ x: 300 + k * 6, y: 0 }, { x: 300 + 220 + k * 6, y: 40 }, { x: 300 + 420, y: 80 + k * 6 });
  const { g, bySource, qm } = quakeGame({ cards: [['quake_damage', 5]], bt: { 6: 'transform' }, foes });
  qm.timer = 0;
  tick(g);
  const shells = qm.shellCount;
  tick(g, 200);
  assert.ok(bySource.quake > 0 && bySource.quake_skip > 0, JSON.stringify(bySource));
  assert.equal(qm.ringsFired, shells * (1 + W.skipBounces), 'each shell quakes three times');
});

test('Fault Lines: each main impact tears three fissures that erupt along their length', () => {
  const { g, p, bySource, qm } = quakeGame({ cards: [['quake_damage', 11]], bt: { 6: 'boost', 12: 'transform' }, foes: [{ x: 300, y: 0 }] });
  const r = quakeRadius(p);
  const along = addFoe(g, { x: 300 + r * 1.6, y: 0 });
  qm.timer = 0;
  tick(g);
  tick(g, Math.ceil(W.quakeFlight * 1.1 / DT));
  assert.equal(qm.faultCount, W.faultCount * W.quakeShells(weaponBuild(p, 'quake')));
  tick(g, 40);
  assert.ok(bySource.quake_fault > 0, 'the fissure toward the straggler hits it');
  assert.ok(along.quakeHits >= 1);
});

test('Epicenter: every third volley the hull slams a ring twice the radius', () => {
  const { g, p, bySource, qm } = quakeGame({ cards: [['quake_damage', 11]], bt: { 6: 'boost', 12: 'boost', 18: 'transform' }, foes: [{ x: 300, y: 0 }] });
  const close = addFoe(g, { x: quakeRadius(p) * 1.5, y: -200 });
  for (let v = 0; v < 2; v++) volley(g);
  assert.ok(!bySource.quake_epicenter, 'nothing on the first two volleys');
  volley(g);
  assert.ok(bySource.quake_epicenter > 0);
  assert.ok(close.quakeHits >= 1, 'the slam reaches 2x the ring radius around the ship');
});

test('pools stay bounded under a long barrage, and a discarded mortar finishes its rings then idles', () => {
  const foes = [];
  for (let k = 0; k < 60; k++) foes.push({ x: Math.cos(k) * (120 + k * 5), y: Math.sin(k) * (120 + k * 5) });
  const { g, p, qm } = quakeGame({ cards: [['quake_rate', 8], ['quake_count', 4], ['quake_damage', 6]], bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, foes });
  for (let i = 0; i < 1200; i++) {
    tick(g);
    assert.ok(qm.shellCount <= qm.shells.length && qm.ringCount <= qm.rings.length && qm.faultCount <= qm.faults.length);
  }
  discardWeapon(p, 'quake');
  tick(g, 200);
  assert.equal(qm.activeCount, 0);
  const fired = qm.ringsFired;
  tick(g, 400);
  assert.equal(qm.ringsFired, fired, 'no more volleys once discarded');
});

test('card previews: the pick shows its volley, each card only its own stat, Breakthroughs their new rows', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  const pick = describeWeaponPick(p, 'quake');
  assert.ok(pick.rows.some((r) => r.id === 'quakeShells'), JSON.stringify(pick.rows));
  acquireWeapon(p, 'quake');
  const rows = (id) => describeUpgrade(p, UPGRADE_BY_ID[id], 1).rows.map((r) => r.id);
  assert.ok(rows('quake_damage').includes('quakeDamage'));
  assert.ok(!rows('quake_radius').includes('quakeDamage') && rows('quake_radius').includes('quakeRadius'));
  assert.ok(!rows('quake_bore').includes('quakeDamage') && rows('quake_bore').includes('quakeRock'));
  p.weapons.quake = 6;
  for (const [lv, row] of [[6, 'quakeSkip'], [12, 'quakeFault'], [18, 'quakeEpicenter']]) {
    const card = describeBreakthrough(p, 'quake', lv, 'transform');
    assert.ok(card.rows.some((r) => r.id === row), `${lv}: ${JSON.stringify(card.rows)}`);
  }
  assert.equal(weaponElement(p, 'quake'), null);
});
