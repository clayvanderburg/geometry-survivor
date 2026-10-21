import test from 'node:test';
import assert from 'node:assert/strict';

// Claw Harpoon: a PRIMARY, KINETIC, aimed single-target weapon that throws one of the crab's drill-claws
// on a tether. Pierce along its line, the yank (hook size, never bosses or lieutenants, crushed clear of
// the hull), mining (breaks rock as the ship's own mining, bites into rock it can't finish, bedrock
// stops it), the three Breakthroughs and the card previews.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, WEAPON_TAGS, WEAPON_CLASS, SOURCE_WEAPON, weaponDamage } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, makeBuild, weaponBuild } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, WEAPONS } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { ClawHarpoon, hookable } = await import('../js/claw-harpoon.js');

const DT = 1 / 60;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A headless game with only the harpoon equipped, aiming along +x, no rocks unless a test adds them.
function harpoonGame({ cards = [], bt = {}, foes = [] } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'harpoon');
  p.loadout = ['harpoon'];
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { harpoon: bt };
  p.angle = 0;
  g.asteroidManager.asteroids = [];
  g.asteroidManager.rebuildSpatialHash();
  g.enemyManager.enemies.length = 0;
  const foesOut = foes.map((f) => addFoe(g, f));
  const bySource = {};
  const hits = [];
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    hits.push({ e, dmg, stat });
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, bySource, hits, foes: foesOut, claw: g.clawHarpoon };
}

function addFoe(g, { x, y = 0, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: p.x + x, y: p.y + y, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the harpoon, like Game.update does each tick.
const tick = (g, n = 1, firing = true) => { for (let i = 0; i < n; i++) g.clawHarpoon.update(DT, g, firing); };
// Ticks of one whole throw (out, reel, home) at a build's cycle.
const throwTicks = (b) => Math.ceil(W.harpoonCooldown(b) / DT) + 2;
// Pull the trigger for one tick, then let that one throw play out (extra ticks for Breakthrough leaps).
const oneThrow = (g, extra = 0) => { tick(g, 1); tick(g, throwTicks(weaponBuild(g.player, 'harpoon')) + extra, false); };

test('Claw Harpoon is a PRIMARY, KINETIC, aimed slot weapon with five single-stat cards', () => {
  const w = WEAPON_BY_ID.harpoon;
  assert.equal(w.name, 'Claw Harpoon');
  assert.equal(w.category, 'PRIMARY');
  assert.deepEqual(w.tagSources, ['harpoon']);
  assert.deepEqual(WEAPON_TAGS.harpoon, ['projectile', 'kinetic']);
  assert.equal(SOURCE_WEAPON.harpoon, 'harpoon');
  assert.equal(WEAPON_CLASS.harpoon, 'aimed');
  assert.ok(DAMAGE_SOURCE_COLORS.harpoon);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['harpoon', 'harpooncrush', 'harpoonslam', 'harpoonspin', 'harpoonchain']) assert.equal(groups[stat], 'harpoon', stat);
  assert.deepEqual(STAT_CARDS.harpoon.map((c) => c.stat), ['damage', 'rate', 'range', 'grapple', 'drill']);
  assert.deepEqual(STAT_CARDS.harpoon.map((c) => POWER_STATS.has(c.stat)), [true, true, false, false, false]);
  assert.equal(ELEMENT_CARDS.harpoon, undefined);
  for (const c of STAT_CARDS.harpoon) assert.match(c.summary, /^Claw Harpoon:/);
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.harpoon[m].summary, /Claw Harpoon/);
  assert.ok(UPGRADE_BY_ID.harpoon?.isCore);
});

test('a throw flies only while firing, once per cycle; Winch Motor cards shorten the cycle', () => {
  const { g, p, claw } = harpoonGame({ foes: [{ x: 200 }] });
  tick(g, 30, false);
  assert.equal(claw.throws, 0, 'no trigger, no throw');
  tick(g, 1);
  assert.equal(claw.throws, 1);
  assert.ok(p.harpoonOut, 'the ship renders its port drill as out on the tether');
  const b = weaponBuild(p, 'harpoon');
  tick(g, throwTicks(b) - 4);
  assert.equal(claw.throws, 1, 'one throw per cycle');
  tick(g, 6);
  assert.equal(claw.throws, 2);
  const fast = makeBuild('harpoon', 4, { rate: 3 });
  assert.ok(near(W.harpoonCooldown(fast), W.harpoonCooldown(b) / (1 + 0.32 * 3)), 'Autocannon-sized +32% rate steps');
});

test('the claw pierces every enemy on its line once, out to its reach; damage drops past survivors, not past kills', () => {
  const reach = W.harpoonRange(weaponBuild(harpoonGame().p, 'harpoon'));
  const { g, p, hits, foes } = harpoonGame({ foes: [{ x: 100 }, { x: 180 }, { x: 260 }, { x: reach + 80 }, { x: 150, y: 90 }] });
  oneThrow(g);
  const dmg = weaponDamage(p, 'harpoon');
  const throwHits = hits.filter((x) => x.stat === 'harpoon');
  assert.deepEqual(throwHits.map((x) => foes.indexOf(x.e)), [0, 1, 2], 'line order, nothing past reach or off the line');
  assert.ok(near(throwHits[0].dmg, dmg) && near(throwHits[1].dmg, dmg * W.harpoonPierceKeep) && near(throwHits[2].dmg, dmg * W.harpoonPierceKeep ** 2));

  // A kill costs no momentum: the enemy behind a one-shot target takes the full hit.
  const k = harpoonGame({ foes: [{ x: 100, hp: 1 }, { x: 180 }] });
  oneThrow(k.g);
  const after = k.hits.filter((x) => x.stat === 'harpoon');
  assert.ok(k.foes[0].dead || k.foes[0].hp <= 0);
  assert.ok(near(after[1].dmg, weaponDamage(k.p, 'harpoon')));
});

test('the first small enemy is yanked into the other claw and crushed, held clear of the hull', () => {
  const { g, p, claw, bySource, foes } = harpoonGame({ foes: [{ x: 160 }, { x: 240 }] });
  const b = weaponBuild(p, 'harpoon');
  tick(g, Math.ceil(W.harpoonCooldown(b) * W.harpoonOutShare / DT) + 1);
  assert.equal(claw.catch, foes[0], 'hooked the first hull');
  for (let i = 0; i < throwTicks(b); i++) {
    tick(g, 1, false);
    const e = foes[0];
    assert.ok(Math.hypot(e.x - p.x, e.y - p.y) >= p.radius + e.radius + 5, 'never pulled into the ship');
  }
  assert.equal(claw.crushes, 1);
  assert.ok(near(bySource.harpooncrush, weaponDamage(p, 'harpoon') * W.harpoonCrushShare));
  assert.ok(Math.hypot(foes[1].x - p.x - 240, foes[1].y - p.y) < 1, 'the second stays where it was');
});

test('bosses, lieutenants and big hulls are never yanked; Grapple Hooks reel in bigger ones', () => {
  const size = W.harpoonHookSize(makeBuild('harpoon', 1));
  assert.ok(hookable({ radius: size }, size));
  assert.ok(!hookable({ radius: size + 1 }, size));
  assert.ok(!hookable({ radius: 10, isBoss: true }, size));
  assert.ok(!hookable({ radius: 10, isLieutenant: true }, size));
  assert.ok(!hookable({ radius: 10, deflect: true }, size));
  const { g, p, claw } = harpoonGame({ foes: [{ x: 160, radius: size + 6 }] });
  oneThrow(g);
  assert.equal(claw.hooks, 0, 'too big to yank');
  const big = harpoonGame({ cards: [['harpoon_grapple', 2]], foes: [{ x: 160, radius: size + 6 }] });
  oneThrow(big.g);
  assert.equal(big.claw.hooks, 1, 'two Grapple Hooks ranks reel it in');
});

test('mining: rock the claw breaks counts as your mining and it flies on; rock it cannot finish stops it; bedrock is untouched', () => {
  const { g, p, claw, foes } = harpoonGame({ foes: [{ x: 260 }] });
  const am = g.asteroidManager;
  const rock = am.makeRock(p.x + 140, p.y, 16, 'rock');
  rock.hp = rock.maxHp = 60;
  am.rebuildSpatialHash();
  const mined = g.rocksMined;
  oneThrow(g);
  assert.ok(!am.asteroids.includes(rock), 'the rock broke');
  assert.equal(g.rocksMined, mined + 1, 'counted as rocks mined');
  assert.equal(claw.rocksBroken, 1);
  assert.ok(foes[0].hp < foes[0].maxHp, 'and the claw flew on to the enemy behind it');

  const budget = W.harpoonDrill(weaponBuild(p, 'harpoon'));
  const tough = harpoonGame({ foes: [{ x: 260 }] });
  const big = tough.g.asteroidManager.makeRock(tough.p.x + 140, tough.p.y, 16, 'rock');
  big.hp = big.maxHp = budget + 50;
  tough.g.asteroidManager.rebuildSpatialHash();
  oneThrow(tough.g);
  assert.ok(near(big.hp, 50, 1e-6), 'the drill budget comes off the rock');
  assert.equal(tough.foes[0].hp, tough.foes[0].maxHp, 'the claw bit in and stopped');

  const bed = harpoonGame({ foes: [{ x: 260 }] });
  const wall = bed.g.asteroidManager.addBedrock(bed.p.x + 140, bed.p.y, 20);
  bed.g.asteroidManager.rebuildSpatialHash();
  oneThrow(bed.g);
  assert.equal(wall.hp, wall.maxHp, 'bedrock never breaks');
  assert.equal(bed.foes[0].hp, bed.foes[0].maxHp, 'bedrock stops the claw');

  // Rock Drill cards bore deeper (and drill-speed upgrades help).
  assert.ok(near(W.harpoonDrill(makeBuild('harpoon', 3, { drill: 2 })), budget * 2.2));
});

test('Breakthroughs: each adds exactly BT_TRANSFORM_DPS; Seismic Slam, Drill Spin and Chain Harpoon each hit', () => {
  for (const m of BREAKTHROUGH_LEVELS) {
    const plain = POTENTIAL_DPS.harpoon(makeBuild('harpoon', m, { damage: 2 }));
    const t = POTENTIAL_DPS.harpoon(makeBuild('harpoon', m, { damage: 2 }, { [m]: 'transform' }));
    assert.ok(near(t, plain * BT_TRANSFORM_DPS), `LV ${m}`);
  }
  // Seismic Slam: an enemy by the nose is hit on the reel-in, even with nothing hooked.
  const slam = harpoonGame({ bt: { 6: 'transform' }, foes: [{ x: 30, y: 26, radius: 30 }] });
  oneThrow(slam.g);
  assert.ok(slam.bySource.harpoonslam > 0, 'slam');
  // Drill Spin: an enemy beside the tip (off the line) is ground at the end of the throw.
  const reach = W.harpoonRange(makeBuild('harpoon', 1));
  const spin = harpoonGame({ bt: { 6: 'boost', 12: 'transform' }, foes: [{ x: reach + 20, y: 30 }] });
  oneThrow(spin.g);
  assert.ok(spin.bySource.harpoonspin > 0, 'spin');
  assert.equal(spin.hits.filter((x) => x.stat === 'harpoonspin').length, W.spinTicks);
  // Chain Harpoon: leaps from the tip to up to chainLeaps enemies nearby.
  const chain = harpoonGame({ bt: { 6: 'boost', 12: 'boost', 18: 'transform' }, foes: [100, 160, 220, 280].map((y) => ({ x: reach - 40, y })) });
  oneThrow(chain.g, 6);
  assert.equal(chain.hits.filter((x) => x.stat === 'harpoonchain').length, W.chainLeaps);
});

test('cards preview the harpoon: the pick leads with its reach; stat and Breakthrough cards show their rows', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const pick = describeWeaponPick(g.player, 'harpoon');
  assert.equal(pick.name, 'Claw Harpoon');
  assert.ok(pick.rows.some((r) => r.id === 'harpoonRange' && r.after === String(W.harpoonRange(makeBuild('harpoon', 1)))));
  acquireWeapon(g.player, 'harpoon');
  for (const id of ['harpoon_damage', 'harpoon_rate', 'harpoon_range', 'harpoon_grapple', 'harpoon_drill']) {
    const card = describeUpgrade(g.player, { ...UPGRADE_BY_ID[id], levelJump: 1 });
    assert.equal(card.toLevel, 2, id);
    assert.ok(card.rows.some((r) => r.id === UPGRADE_BY_ID[id].headline), `${id} shows its stat`);
  }
  const rows = { 6: 'harpoonSlam', 12: 'harpoonSpin', 18: 'harpoonChain' };
  for (const m of BREAKTHROUGH_LEVELS) {
    const card = describeBreakthrough(g.player, 'harpoon', m, 'transform');
    assert.equal(card.name, TRANSFORMS.harpoon[m].name);
    assert.equal(card.category, 'CLAW HARPOON');
    assert.ok(card.rows.some((r) => r.id === rows[m]), `LV ${m} row`);
  }
  assert.ok(g.clawHarpoon instanceof ClawHarpoon, 'the game owns one, reset with the run');
});

test('a live fight: the harpoon deals damage through the normal game loop', () => {
  const { g, p, bySource } = harpoonGame();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    addFoe(g, { x: Math.cos(a) * (90 + (k % 4) * 50), y: Math.sin(a) * (90 + (k % 4) * 50) });
  }
  g.autoFire = true;
  g.autoAim = true;
  for (let i = 0; i < 60 * 4; i++) {
    g.update(DT);
    g.state = 'PLAYING';
    p.invuln = 1;
  }
  assert.ok(bySource.harpoon > 0);
});
