import test from 'node:test';
import assert from 'node:assert/strict';

// Flamethrower: registry wiring, single-stat formulas, LV 1 parity, Breakthroughs worth exactly
// x BT_TRANSFORM_DPS, the built-in FIRE element (STATUS card gating, Fire Amplifier, its softer burn),
// the cone itself (reach, width, falloff, only while firing), asteroid cover, each Breakthrough, a live
// fight in the full game loop and cheap drawing.
const h = await import('../tools/balance/harness.mjs');
const {
  WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, sourceElement, weaponDamage,
  flameRange, statusDotShare
} = await import('../js/weapon-scaling.js');
const {
  STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, FIXED_ELEMENTS, ELEMENT_MAX_RANKS, makeBuild, levelBuild, weaponBuild, weaponElement,
  flameBurnRank, BT_TRANSFORM_DPS, BREAKTHROUGH_LEVELS
} = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, eligibleUpgrades, ownedElements, applyBreakthrough } = await import('../js/upgrades.js');
const { WEAPONS, WEAPON_BY_ID, weaponTags } = await import('../js/loadout.js');
const { describeUpgrade, describeWeaponPick, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { Flamethrower, FLAME_RAYS } = await import('../js/flamethrower.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { applyOnHitStatuses } = await import('../js/status-effects.js');
const { weaponChipsHtml } = await import('../js/run-overview.js');

const near = (a, b, tol = 1e-9) => Math.abs(a / b - 1) < tol;
const dps = (b) => POTENTIAL_DPS.flamethrower(b);
const silent = new Proxy({}, { get: () => () => {} });

// A fresh run's player carrying only the Flamethrower, aiming east from (1000, 1000).
function flamePlayer({ cards = [], bt = {} } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  discardWeapon(p, 'blaster');
  acquireWeapon(p, 'flamethrower');
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { flamethrower: bt };
  Object.assign(p, { x: 1000, y: 1000, vx: 0, vy: 0, angle: 0 });
  return p;
}

// A minimal game around a Flamethrower: hits are recorded (and apply statuses like Game.hitEnemy).
// The nozzle is held on the ship's heading (no spin) unless `spin` is set, so geometry tests can aim it.
function rig(p, enemies, rocks = [], { spin = false } = {}) {
  const hits = [];
  const roar = [];
  const blasts = [];
  const game = {
    player: p, enemyManager: { enemies }, particles: silent, camX: 0, camY: 0, width: 4200, height: 4200,
    asteroidManager: { getNearbyAsteroids: () => rocks, cellsFor: () => 3 },
    sound: { setFlameRoar: (v) => roar.push(v), playFlameBurst() {} },
    weaponFx: { pools: [], addPool(x) { this.pools.push(x); } },
    hitEnemy(e, dmg, source) { hits.push({ e, dmg, source }); applyOnHitStatuses(p, e, source, dmg); },
    damageEnemiesInRadius(x, y, radius, dmg, hue, source, knock) { blasts.push({ x, y, radius, dmg, source, knock }); }
  };
  const ft = new Flamethrower();
  if (!spin) ft.swing = function (pl) { if (this.swivel === null) this.swivel = pl.angle; };
  return { game, hits, roar, blasts, ft };
}
const enemy = (p, dx, dy, r = 10) => ({ type: 'swarmer', x: p.x + dx, y: p.y + dy, radius: r, hp: 1e6, maxHp: 1e6 });
const run = (r, seconds, firing = true) => { for (let i = 0; i < Math.round(seconds * 60); i++) r.ft.update(1 / 60, r.game, firing); };
const hitSet = (r) => new Set(r.hits.map((x) => x.e));

test('the Flamethrower is a PRIMARY slot weapon with source flame, AREA + BURN tags and six single-stat cards', () => {
  const w = WEAPON_BY_ID.flamethrower;
  assert.equal(w.name, 'Flamethrower');
  assert.equal(w.category, 'PRIMARY');
  assert.deepEqual(w.tagSources, ['flame']);
  assert.deepEqual(WEAPON_TAGS.flame, ['area', 'burn']);
  for (const t of weaponTags('flamethrower')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.flame, 'flamethrower');
  assert.ok(DAMAGE_SOURCE_COLORS.flame);
  const groups = buildSourceGroups(WEAPONS);
  assert.equal(groups.flame, 'flamethrower');
  assert.equal(groups.burn_flamethrower, 'flamethrower', 'its burn ticks are credited to it');
  assert.deepEqual(STAT_CARDS.flamethrower.map((c) => c.stat), ['damage', 'rate', 'range', 'cone', 'burn', 'nozzles']); // Spin Rotor retired in v0.46 (a dead pick)
  assert.deepEqual(STAT_CARDS.flamethrower.map((c) => POWER_STATS.has(c.stat)), [true, true, false, false, false, true]);
  for (const c of STAT_CARDS.flamethrower) assert.match(c.summary, /^Flamethrower:/);
  assert.equal(ELEMENT_CARDS.flamethrower, undefined, 'no element cards: FIRE is built in');
  assert.deepEqual(BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.flamethrower[m].name), ['Fireballs', 'Napalm Puddles', 'Inferno Ring']);
});

test('every flame formula reads only its own rank; LV 1 numbers', () => {
  const F = { rate: W.flameTickRate, range: W.flameRange, cone: W.flameConeHalf, turn: W.flameTurnRate, burn: W.flameBurnRank, nozzles: W.flameNozzles, damage: W.flameDamageMult };
  const base = levelBuild('flamethrower', 1);
  for (const card of STAT_CARDS.flamethrower) {
    const b = makeBuild('flamethrower', 5, { [card.stat]: 3 });
    for (const [stat, f] of Object.entries(F)) {
      if (stat === card.stat) assert.notEqual(f(b), f(base), `${card.id} changes ${stat}`);
      else assert.equal(f(b), f(base), `${card.id} must not change ${stat}`);
    }
  }
  assert.equal(W.flameTickRate(base), 8);
  assert.equal(W.flameRange(base), 280);
  assert.equal(W.flameConeHalf(base), 0.275);
  assert.equal(W.flameBurnRank(base), 1);
  assert.equal(W.flameBurnRank(makeBuild('flamethrower', 18, { burn: 4 }, { 6: 'boost', 12: 'boost' })), ELEMENT_MAX_RANKS, 'burn rank caps at 5');
});

test('LV 1 sits on DPS_TARGET(1); damage and rate ranks scale like every weapon; reach, cone and burn are utility', () => {
  assert.ok(near(dps(levelBuild('flamethrower', 1)), DPS_TARGET(1)));
  for (let r = 1; r <= 8; r++) {
    assert.ok(near(dps(makeBuild('flamethrower', 1 + r, { damage: r })), DPS_TARGET(1) * DAMAGE_GROWTH ** r), `damage x${r}`);
    assert.ok(near(dps(makeBuild('flamethrower', 1 + r, { rate: r })), DPS_TARGET(1) * (1 + RATE_STEP * r)), `rate x${r}`);
  }
  for (const stat of ['range', 'cone', 'burn']) assert.ok(near(dps(makeBuild('flamethrower', 5, { [stat]: 4 })), DPS_TARGET(1)), `${stat} is utility`);
});

test('each flame transform is worth exactly x BT_TRANSFORM_DPS, alone and stacked, at any stat mix', () => {
  const mixes = [{}, { damage: 3 }, { rate: 3, range: 2 }, { cone: 2, burn: 3, damage: 1 }];
  const combos = [{ 6: 'transform' }, { 12: 'transform' }, { 18: 'transform' }, { 6: 'transform', 12: 'transform' },
    { 6: 'transform', 18: 'transform' }, { 12: 'transform', 18: 'transform' }, { 6: 'transform', 12: 'transform', 18: 'transform' }];
  for (const ranks of mixes) {
    const plain = dps(makeBuild('flamethrower', 12, ranks));
    for (const bt of combos) {
      const n = Object.keys(bt).length;
      assert.ok(near(dps(makeBuild('flamethrower', 12, ranks, bt)), plain * BT_TRANSFORM_DPS ** n), `${JSON.stringify(ranks)} ${JSON.stringify(bt)}`);
    }
  }
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.flamethrower[m].summary, /Flamethrower/);
});

test('built-in FIRE: rank from Sticky Gel and ACROSS THE BOARD, STATUS cards and the Fire Amplifier unlock and apply', () => {
  assert.equal(FIXED_ELEMENTS.flamethrower, 'fire');
  const p = flamePlayer();
  assert.deepEqual(weaponElement(p, 'flamethrower'), { element: 'fire', rank: 1, fixed: true });
  assert.equal(sourceElement(p, 'flame'), 'fire');
  assert.ok(ownedElements(p).has('fire'));
  const offered = new Set(eligibleUpgrades(p).map((u) => u.id));
  for (const id of ['status_potency', 'status_application', 'status_duration', 'fire_damage']) assert.ok(offered.has(id), `${id} is offered`);
  for (const id of ['shock_conductor', 'frost_damage', 'corrode_damage', 'shock_damage']) assert.ok(!offered.has(id), `${id} is not`);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.flamethrower_burn, levelJump: 2 });
  assert.equal(weaponElement(p, 'flamethrower').rank, 3);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.flamethrower_damage, levelJump: 3 }); // LV 6
  applyBreakthrough(p, 'flamethrower', 6, 'boost');
  assert.equal(weaponElement(p, 'flamethrower').rank, 4, 'ACROSS THE BOARD adds a utility rank');
  assert.equal(weaponElement(p, 'flamethrower').rank, flameBurnRank(weaponBuild(p, 'flamethrower')), 'the cheap per-hit rank matches the build');
  const before = weaponDamage(p, 'flame');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.fire_damage, levelJump: 1 });
  assert.ok(near(weaponDamage(p, 'flame') / before, 1 + W.elementDamageStep), 'Fire Amplifier boosts the flames');
  assert.ok(statusDotShare(p, 'fire', 4) > statusDotShare(p, 'fire', 1), 'a higher burn rank burns more of each scorch');
  assert.match(weaponChipsHtml(p), /FIRE/, 'the HUD chip wears FIRE');
  discardWeapon(p, 'flamethrower');
  assert.equal(weaponElement(p, 'flamethrower'), null);
  assert.ok(!ownedElements(p).has('fire'));
});

test('cards preview their own stat; the pick and Breakthrough cards name the Flamethrower', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  assert.equal(describeWeaponPick(p, 'flamethrower').headline, 'FLAMETHROWER');
  acquireWeapon(p, 'flamethrower');
  const reach = describeUpgrade(p, { ...UPGRADE_BY_ID.flamethrower_range, levelJump: 1 });
  assert.match(reach.headline, /^\+\d+% FLAME REACH$/); // a relative gain, never a pixel count
  assert.deepEqual(reach.rows.map((r) => r.id), ['flameRange']);
  assert.match(describeUpgrade(p, { ...UPGRADE_BY_ID.flamethrower_cone, levelJump: 2 }).headline, /CONE WIDTH/);
  const gel = describeUpgrade(p, { ...UPGRADE_BY_ID.flamethrower_burn, levelJump: 1 });
  assert.ok(gel.rows.some((r) => r.id === 'flamethrower:burn'), 'Sticky Gel shows the burn it adds');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.flamethrower_rate, levelJump: 5 });
  const t = describeBreakthrough(p, 'flamethrower', 6, 'transform');
  assert.equal(t.name, 'Fireballs');
  assert.equal(t.category, 'FLAMETHROWER');
  assert.match(t.headline, /\+22% DPS/);
});

test('the cone: hits what is in front within reach and width, harder up close, always on while equipped, and roars', () => {
  const p = flamePlayer();
  const close = enemy(p, 60, 0), tip = enemy(p, 245, 0), edge = enemy(p, Math.cos(0.28) * 120, Math.sin(0.28) * 120);
  const beyond = enemy(p, 330, 0), behind = enemy(p, -80, 0), side = enemy(p, 0, 100), wide = enemy(p, Math.cos(0.9) * 120, Math.sin(0.9) * 120);
  const r = rig(p, [close, tip, edge, beyond, behind, side, wide]);
  run(r, 1, false); // no aiming or trigger: it sprays whenever it is equipped
  r.hits.length = 0;
  run(r, 1);
  const hit = hitSet(r);
  for (const [name, e] of Object.entries({ close, tip, edge })) assert.ok(hit.has(e), `${name} burns`);
  for (const [name, e] of Object.entries({ beyond, behind, side, wide })) assert.ok(!hit.has(e), `${name} is safe`);
  const scorches = r.hits.filter((x) => x.e === close).length;
  assert.ok(scorches >= 7 && scorches <= 9, `~8 scorches a second (${scorches})`);
  assert.ok(r.hits.every((x) => x.source === 'flame'));
  const per = (e) => r.hits.find((x) => x.e === e).dmg;
  assert.ok(per(close) > per(tip) * 1.3, 'the tip of the flames is cooler');
  const nz = r.ft.nozzles[0]; // distances run from the muzzle
  assert.ok(near(per(close), weaponDamage(p, 'flame') * (1 - W.flameEdgeFalloff * ((close.x - nz.x - close.radius) / nz.range)), 1e-6));
  assert.ok(close.st.burn > 0 && close.st.burnStat === 'burn_flamethrower', 'scorched enemies burn, credited to the Flamethrower');
  assert.deepEqual(r.roar, [1]);
  p.weapons.flamethrower = 0;
  r.ft.update(1 / 60, r.game, true);
  assert.deepEqual(r.roar, [1, 0], 'the roar fades when the weapon is gone');
});

test('Nozzle Pressure and Wide Nozzle reach further and wider', () => {
  const p = flamePlayer({ cards: [['flamethrower_range', 4], ['flamethrower_cone', 4]] });
  const far = enemy(p, 380, 0), wide = enemy(p, Math.cos(0.4) * 120, Math.sin(0.4) * 120); // outside the LV 1 cone (±0.275 rad)
  const r = rig(p, [far, wide]);
  run(r, 0.5);
  assert.ok(hitSet(r).has(far) && hitSet(r).has(wide));
  assert.equal(flameRange(p), 280 + 4 * 40);
});

test('asteroids are cover: a rock shadows only the slice of the cone behind it', () => {
  const p = flamePlayer();
  const hidden = enemy(p, 150, 0);
  const clear = enemy(p, Math.cos(0.27) * 150, Math.sin(0.27) * 150);
  const rock = { x: p.x + 100, y: p.y, radius: 14, hp: 50 };
  const r = rig(p, [hidden, clear], [rock]);
  run(r, 1);
  assert.ok(!hitSet(r).has(hidden), 'the enemy behind the rock is safe');
  assert.ok(hitSet(r).has(clear), 'the rest of the cone still burns');
  const nz = r.ft.nozzles[0];
  const mid = (FLAME_RAYS - 1) / 2;
  assert.ok(nz.reach[mid] < 100 && nz.reach[0] === nz.range, 'the middle rays stop at the rock face');
  // A shattered rock no longer blocks, and a rock the nozzle sits inside (drilling) never does.
  rock.hp = 0;
  r.hits.length = 0;
  run(r, 0.5);
  assert.ok(hitSet(r).has(hidden));
  Object.assign(rock, { hp: 50, x: p.x + 15, radius: 30 });
  r.hits.length = 0;
  run(r, 0.5);
  assert.ok(hitSet(r).has(hidden), 'flames spray out of a rock the claws are inside');
});

test('Extra Nozzle cards add identical streams spaced evenly round the spin, each worth flameNozzleShare of a stream', () => {
  const p = flamePlayer({ cards: [['flamethrower_nozzles', 1]] });
  const behind = enemy(p, -120, 0), behindFar = enemy(p, -320, 0), front = enemy(p, 120, 0), side = enemy(p, 0, 120);
  const r = rig(p, [behind, behindFar, front, side]);
  run(r, 1);
  const hit = hitSet(r);
  assert.ok(hit.has(behind) && hit.has(front), 'two streams: front and back');
  assert.ok(!hit.has(behindFar) && !hit.has(side));
  assert.equal(r.ft.nozzles[1].range, r.ft.nozzles[0].range, 'both streams are the same size');
  assert.equal(r.hits.filter((x) => x.e === front).length, r.hits.filter((x) => x.e === behind).length, 'both nozzles scorch at the same rate');
  // Three cards: four streams a quarter turn apart.
  const q = flamePlayer({ cards: [['flamethrower_nozzles', 3]] });
  const four = [enemy(q, 120, 0), enemy(q, 0, 120), enemy(q, -120, 0), enemy(q, 0, -120)];
  const rq = rig(q, four);
  run(rq, 0.5);
  for (const e of four) assert.ok(hitSet(rq).has(e), 'every quarter is sprayed');
  assert.equal(rq.ft.nozzles.filter((n) => n.on).length, 4);
  assert.equal(UPGRADE_BY_ID.flamethrower_nozzles.maxLevel, 3);
  // Potential: each extra stream adds flameNozzleShare of one.
  for (let n = 1; n <= 3; n++) assert.ok(near(dps(makeBuild('flamethrower', 1 + n, { nozzles: n })), dps(levelBuild('flamethrower', 1)) * (1 + W.flameNozzleShare * n)));
});

test('Fireballs: every second each nozzle lobs a fireball that bursts at the tip of its flames', () => {
  const p = flamePlayer({ bt: { 6: 'transform' }, cards: [['flamethrower_nozzles', 1]] });
  const r = rig(p, [enemy(p, 100, 0)]);
  const fx = r.game.weaponFx;
  fx.events = [];
  fx.schedule = (e) => fx.events.push(e);
  run(r, 1.6);
  assert.equal(fx.events.length, 4, 'two volleys (one shortly after the spray starts), one fireball per nozzle');
  const b = weaponBuild(p, 'flamethrower');
  for (const e of fx.events) {
    assert.equal(e.source, 'flame');
    assert.equal(e.kind, 'fireball', 'run stats count them as fireballs');
    assert.ok(near(e.damage, weaponDamage(p, 'flame') / W.flameDamageMult(b) * W.flameBurstDamageMult(b)));
    assert.ok(Math.abs(Math.hypot(e.x - p.x, e.y - p.y) - flameRange(p) * 0.9) < 20, 'near the tip');
  }
});

test('Napalm Puddles: burning puddles splash down at the tip of the flames', () => {
  const p = flamePlayer({ bt: { 12: 'transform' } });
  const r = rig(p, [enemy(p, 100, 0)]);
  run(r, 1.6);
  const pools = r.game.weaponFx.pools;
  assert.ok(pools.length >= 3, `${pools.length} puddles`);
  for (const pool of pools) {
    assert.equal(pool.source, 'flame');
    assert.equal(pool.look, 'fire');
    assert.ok(pool.x > p.x + 60 && pool.x < p.x + 300 && Math.abs(pool.y - p.y) < 80, 'in front, near the tip');
    assert.ok(near(pool.damage, weaponDamage(p, 'flame') / W.flameDamageMult(weaponBuild(p, 'flamethrower')) * W.flamePuddleDamageMult(weaponBuild(p, 'flamethrower'))));
  }
});

test('Inferno Ring: every few seconds a ring of fire rolls out round the ship and shoves enemies back', () => {
  const p = flamePlayer({ bt: { 18: 'transform' } });
  const r = rig(p, [enemy(p, -150, 0)]);
  run(r, W.flameRingEvery + 1.3);
  assert.equal(r.blasts.length, 2, 'one ring shortly after the spray starts, then one every flameRingEvery s');
  const b = r.blasts[0];
  assert.equal(b.source, 'flame');
  assert.equal(b.x, p.x);
  assert.ok(near(b.radius, flameRange(p) * W.flameRingRadiusMult));
  assert.ok(b.knock > 0 && b.dmg > 0);
});

test('live fight: the Flamethrower fires in the full game loop with every transform; the puff pool stays bounded', () => {
  // Seeded: spawns, steering and sparks are random, and an unlucky draw used to fail this now and then.
  const realRandom = Math.random;
  let seed = 424242;
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  try { liveFight(); } finally { Math.random = realRandom; }
});

function liveFight() {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  discardWeapon(p, 'blaster');
  acquireWeapon(p, 'flamethrower');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.flamethrower_rate, levelJump: 8 });
  p.breakthroughs = { flamethrower: { 6: 'transform', 12: 'transform', 18: 'transform' } };
  g.asteroidManager.asteroids = [];
  g.asteroidManager.rebuildSpatialHash();
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    const e = g.enemyManager.getArchetype('swarmer', 1);
    const d = 70 + (k % 4) * 40;
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  g.autoFire = true;
  g.autoAim = true;
  const bySource = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  let maxPuffs = 0;
  for (let i = 0; i < 60 * 6; i++) {
    g.update(1 / 60);
    maxPuffs = Math.max(maxPuffs, g.flamethrower.activeCount);
  }
  assert.ok(bySource.flame > 0, 'the flames deal damage');
  assert.ok(bySource.burn_flamethrower > 0, 'and their burn ticks');
  assert.ok(g.flamethrower.rings >= 2, 'Inferno Rings went off');
  assert.ok(maxPuffs > 0 && maxPuffs <= g.flamethrower.puffs.length);
  const s = g.finishRunStats();
  assert.ok(s.weapons.flamethrower?.dmg > 0, 'run stats credit the Flamethrower');
  g.state = 'PAUSED';
  let roar = null;
  g.sound = { ...silent, setFlameRoar: (v) => { roar = v; } };
  g.update(1 / 60);
  assert.equal(roar, 0, 'the roar stops under the pause menu');
}

test('drawing costs a fixed handful of fills however many flames are in the air', () => {
  const p = flamePlayer({ bt: { 6: 'transform' }, cards: [['flamethrower_cone', 8]] });
  const r = rig(p, []);
  run(r, 0.4);
  assert.ok(r.ft.count > 50, `${r.ft.count} puffs in the air`);
  let fills = 0, strokes = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'fill' ? () => { fills++; } : k === 'stroke' ? () => { strokes++; } : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  r.ft.draw(ctx, { camX: 0, camY: 0, width: 4200, height: 4200 });
  assert.ok(fills <= 5 && strokes === 0, `${fills} fills, ${strokes} strokes`);
});

test('the nozzle ignores the aim and spins slowly round the ship', () => {
  const spun = (cards) => {
    const p = flamePlayer({ cards });
    const r = rig(p, [], [], { spin: true });
    run(r, 1 / 60);
    const a0 = r.ft.swivel;
    p.angle = Math.PI / 2; // the aim moves: the nozzle doesn't care
    run(r, 0.5);
    return ((r.ft.swivel - a0) + Math.PI * 4) % (Math.PI * 2);
  };
  const lv1 = W.flameTurnRate(levelBuild('flamethrower', 1));
  assert.ok(lv1 > 1.2 && lv1 < 2.2, `a steady spin (${lv1.toFixed(2)} rad/s, a turn every ${(2 * Math.PI / lv1).toFixed(1)} s)`);
  assert.equal(lv1, 1.2 * W.flameTurnTrim.flamethrower, 'the Flamethrower spins faster than its twins');
  assert.equal(W.flameTurnRate(levelBuild('cryospray', 1)), 1.2);
  assert.ok(Math.abs(spun([]) - lv1 * 0.5) < 0.03, 'turns at a steady rate whatever the aim');
  const p = flamePlayer();
  const r = rig(p, [], [], { spin: true });
  run(r, 0.5, false);
  assert.ok(r.ft.nozzles[0].on, 'it sprays without the trigger');
  assert.ok(Math.abs(r.ft.nozzles[0].angle - r.ft.swivel) < 1e-9, 'the cone points where the nozzle has spun to');
});
