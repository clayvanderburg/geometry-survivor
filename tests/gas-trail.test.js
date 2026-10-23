import test from 'node:test';
import assert from 'node:assert/strict';

// Corrosive Gas Trail: registry wiring, single-stat formulas, LV 1 parity, Breakthroughs worth exactly
// x BT_TRANSFORM_DPS, the fixed CORROSIVE element (STATUS card gating, Corrosive Amplifier), the trail
// itself (venting, one tick per enemy, corrosion, fading), each Breakthrough, and cheap drawing.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, corrodeCap, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, sourceElement, weaponDamage, gasCloudRadius } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, FIXED_ELEMENTS, makeBuild, levelBuild, weaponBuild, weaponElement, BT_TRANSFORM_DPS, BREAKTHROUGH_LEVELS } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, eligibleUpgrades, ownedElements } = await import('../js/upgrades.js');
const { WEAPONS, WEAPON_BY_ID, weaponTags, weaponLevel } = await import('../js/loadout.js');
const { describeUpgrade, describeWeaponPick, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { GasTrail, puffRadius } = await import('../js/gas-trail.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { applyOnHitStatuses, damageTakenMult } = await import('../js/status-effects.js');
const { weaponChipsHtml } = await import('../js/run-overview.js');

const near = (a, b, tol = 1e-9) => Math.abs(a / b - 1) < tol;
const dps = (b) => POTENTIAL_DPS.gas(b);
const silent = new Proxy({}, { get: () => () => {} });

test('Corrosive Gas Trail is a slot weapon with source gas, AREA + CORRODE tags and four single-stat cards', () => {
  const w = WEAPON_BY_ID.gas;
  assert.equal(w.name, 'Corrosive Gas Trail');
  assert.equal(w.category, 'AUTONOMOUS');
  assert.deepEqual(w.tagSources, ['gas']);
  assert.deepEqual(WEAPON_TAGS.gas, ['area', 'corrode']);
  for (const t of weaponTags('gas')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.gas, 'gas');
  assert.ok(DAMAGE_SOURCE_COLORS.gas);
  const groups = buildSourceGroups(WEAPONS);
  assert.equal(groups.gas, 'gas');
  assert.equal(groups.gas_pocket, 'gas', 'Volatile Pockets bursts count for the gas');
  assert.equal(groups.gas_shroud, 'gas', 'Toxic Shroud ticks count for the gas');
  assert.deepEqual(STAT_CARDS.gas.map((c) => c.stat), ['damage', 'rate', 'radius', 'linger']);
  assert.deepEqual(STAT_CARDS.gas.map((c) => POWER_STATS.has(c.stat)), [true, true, false, false]);
  assert.ok(STAT_CARDS.gas.reduce((a, c) => a + c.maxLevel, 0) >= 17, 'the cards reach LV 18');
  for (const c of STAT_CARDS.gas) assert.match(c.summary, /^Corrosive Gas Trail:/);
  assert.equal(ELEMENT_CARDS.gas, undefined, 'no element cards: it is born CORROSIVE');
  assert.equal(UPGRADE_BY_ID.gas.isCore, true);
});

test('every gas formula reads only its own rank; LV 1 numbers', () => {
  const F = { rate: W.gasTick, radius: W.gasRadius, linger: W.gasLife, damage: W.gasDamageMult };
  const base = levelBuild('gas', 1);
  for (const card of STAT_CARDS.gas) {
    const b = makeBuild('gas', 5, { [card.stat]: 4 });
    for (const [stat, f] of Object.entries(F)) {
      if (stat === card.stat) assert.notEqual(f(b), f(base), `${card.id} changes ${stat}`);
      else assert.equal(f(b), f(base), `${card.id} must not change ${stat}`);
    }
  }
  assert.equal(W.gasRadius(base), 46);
  assert.equal(W.gasLife(base), 2.6);
  assert.equal(W.gasTick(base), 0.3);
});

test('LV 1 gas sits on DPS_TARGET(1); damage and rate ranks scale like every weapon; size and linger are utility', () => {
  assert.ok(near(dps(levelBuild('gas', 1)), DPS_TARGET(1)));
  for (let r = 1; r <= 8; r++) {
    assert.ok(near(dps(makeBuild('gas', 1 + r, { damage: r })), DPS_TARGET(1) * DAMAGE_GROWTH ** r), `damage x${r}`);
    assert.ok(near(dps(makeBuild('gas', 1 + r, { rate: r })), DPS_TARGET(1) * (1 + RATE_STEP * r)), `rate x${r}`);
  }
  for (const stat of ['radius', 'linger']) assert.ok(near(dps(makeBuild('gas', 5, { [stat]: 4 })), DPS_TARGET(1)), `${stat} is utility`);
  // A tick is valued at gasHitShare (a trail usually holds several enemies), so one tick hits for less.
  assert.ok(near(W.gasDamageMult(levelBuild('gas', 1)) / W.gasTick(levelBuild('gas', 1)) * W.gasHitShare, DPS_TARGET(1)));
});

test('each gas transform is worth exactly x BT_TRANSFORM_DPS, alone and stacked, at any stat mix', () => {
  const mixes = [{}, { damage: 3 }, { rate: 4 }, { radius: 2, linger: 3, damage: 1 }];
  const combos = [{ 6: 'transform' }, { 12: 'transform' }, { 18: 'transform' }, { 6: 'transform', 12: 'transform' },
    { 6: 'transform', 18: 'transform' }, { 12: 'transform', 18: 'transform' }, { 6: 'transform', 12: 'transform', 18: 'transform' }];
  for (const ranks of mixes) {
    const plain = dps(makeBuild('gas', 12, ranks));
    for (const bt of combos) {
      const n = Object.keys(bt).length;
      assert.ok(near(dps(makeBuild('gas', 12, ranks, bt)), plain * BT_TRANSFORM_DPS ** n), `${JSON.stringify(ranks)} ${JSON.stringify(bt)}`);
    }
  }
  assert.deepEqual(BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.gas[m].name), ['Seeking Miasma', 'Volatile Pockets', 'Toxic Shroud']);
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.gas[m].summary, /Corrosive Gas Trail/);
});

function freshPlayer({ cards = [], bt = {}, only = true } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  if (only) discardWeapon(p, 'blaster');
  acquireWeapon(p, 'gas');
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { gas: bt };
  return { g, p };
}

test('fixed CORROSIVE element: corrode rank follows the level, STATUS cards and the Amplifier unlock and apply', () => {
  assert.equal(FIXED_ELEMENTS.gas, 'corrode');
  const { p } = freshPlayer();
  assert.deepEqual(weaponElement(p, 'gas'), { element: 'corrode', rank: 1, fixed: true });
  assert.equal(sourceElement(p, 'gas'), 'corrode');
  assert.ok(ownedElements(p).has('corrode'), 'counts as a CORROSIVE weapon');
  const offered = new Set(eligibleUpgrades(p).map((u) => u.id));
  for (const id of ['status_potency', 'status_application', 'status_duration', 'corrode_damage']) assert.ok(offered.has(id), `${id} offered with only the gas trail`);
  for (const id of ['shock_conductor', 'fire_damage', 'frost_damage', 'shock_damage']) assert.ok(!offered.has(id), `${id} needs another element`);
  assert.ok(![...offered].some((id) => UPGRADE_BY_ID[id].elementCard), 'never an element card for it');
  assert.match(weaponChipsHtml(p), /Gas Trail LV 1 <span class="weapon-el"[^>]*>CORROSIVE</, 'the HUD chip shows its element');

  // Rank 2 / 3 / 4 at LV 6 / 12 / 18.
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.gas_damage, levelJump: 5 });
  assert.equal(weaponLevel(p, 'gas'), 6);
  assert.equal(weaponElement(p, 'gas').rank, 2);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.gas_radius, levelJump: 6 });
  assert.equal(weaponElement(p, 'gas').rank, 3);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.gas_linger, levelJump: 6 });
  assert.equal(weaponLevel(p, 'gas'), 18);
  assert.equal(weaponElement(p, 'gas').rank, 4);

  // Corrosive Amplifier makes the gas itself hit harder.
  const before = weaponDamage(p, 'gas');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.corrode_damage, levelJump: 1 });
  assert.ok(near(weaponDamage(p, 'gas'), before * (1 + W.elementDamageStep)));

  // A gas hit corrodes at the trail's rank: stacks follow its damage, damage taken stops at the rank's cap.
  const e = { type: 'swarmer', hp: 100, maxHp: 100, radius: 10 };
  applyOnHitStatuses(p, e, 'gas', weaponDamage(p, 'gas'));
  assert.ok(e.st.corrode > 0 && damageTakenMult(e) > 1);
  assert.equal(e.st.corrodeStat, 'corrode_gas', 'acid ticks are credited to the trail');
  for (let i = 0; i < 200; i++) applyOnHitStatuses(p, e, 'gas', weaponDamage(p, 'gas'));
  assert.ok(Math.abs(damageTakenMult(e) - (1 + corrodeCap(p, 4))) < 1e-9, 'capped at rank 4');
  discardWeapon(p, 'gas');
  assert.equal(weaponElement(p, 'gas'), null, 'the element leaves with the weapon');
});

test('gas cards preview their own stat; the pick and Breakthrough cards name the weapon; STATUS cards show the gas corrosion', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  assert.equal(describeWeaponPick(p, 'gas').headline, 'CORROSIVE GAS TRAIL');
  acquireWeapon(p, 'gas');
  assert.equal(describeUpgrade(p, { ...UPGRADE_BY_ID.gas_rate, levelJump: 1 }).headline, `+${Math.round(RATE_STEP * 100)}% GAS TICK RATE`);
  assert.equal(describeUpgrade(p, { ...UPGRADE_BY_ID.gas_damage, levelJump: 1 }).headline, `+${Math.round((DAMAGE_GROWTH - 1) * 100)}% GAS DAMAGE`);
  assert.deepEqual(describeUpgrade(p, { ...UPGRADE_BY_ID.gas_linger, levelJump: 1 }).rows.map((r) => r.id), ['gasLife']);
  const size = describeUpgrade(p, { ...UPGRADE_BY_ID.gas_radius, levelJump: 1 });
  assert.equal(size.rows[0].id, 'gasRadius');
  const potency = describeUpgrade(p, { ...UPGRADE_BY_ID.status_potency, levelJump: 1 });
  assert.ok(potency.rows.some((r) => r.id === 'gasAcid'), 'Status Potency previews the gas acid');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.gas_damage, levelJump: 5 });
  const t = describeBreakthrough(p, 'gas', 6, 'transform');
  assert.equal(t.id, 'bt:gas:6:seek');
  assert.equal(t.name, 'Seeking Miasma');
  assert.equal(t.category, 'GAS TRAIL');
  assert.ok(Math.abs(t.dpsGain - 0.22) < 0.01 && t.rows[0].id === 'potentialDps' && !/DPS/.test(t.headline));
  const b = describeBreakthrough(p, 'gas', 6, 'boost');
  assert.match(b.summary, /Corrosive Gas Trail/);
  assert.ok(b.rows.some((r) => r.id === 'gasRadius') && b.rows.some((r) => r.id === 'gasLife'), 'Across the Board: wider, longer clouds');
});

// Drive the trail directly on a real headless game (stationary enemies, the ship moved by hand).
function stepTrail(g, ticks, move = null) {
  for (let i = 0; i < ticks; i++) {
    if (move) move(g.player, i);
    g.gasTrail.update(1 / 60, g);
  }
}
const dummy = (g, x, y, hp = 1e7) => {
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x, y, vx: 0, vy: 0, hp, maxHp: hp, trail: e.trail || [] });
  g.enemyManager.enemies.push(e);
  return e;
};
const tally = (g) => {
  const by = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    by[stat] = (by[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return by;
};
const flyRight = (speed = 4) => (p) => { p.vx = speed; p.vy = 0; p.x += speed; };

test('the trail: puffs vent behind a moving ship, spaced out; a hovering ship keeps one cloud topped up', () => {
  const { g, p } = freshPlayer();
  const x0 = p.x;
  stepTrail(g, 60, flyRight(4));
  const gt = g.gasTrail;
  const R = gasCloudRadius(p);
  assert.ok(gt.count >= 6, `a trail of puffs (${gt.count})`);
  assert.ok(gt.puffs.slice(0, gt.count).every((f) => f.x < p.x), 'every puff is behind the ship');
  assert.ok(gt.puffs.slice(0, gt.count).every((f) => f.x > x0 - R * 2), 'and along its path');
  // Hovering: the count stops growing and the last cloud never fades.
  p.vx = p.vy = 0;
  stepTrail(g, 30);
  const hovering = gt.count;
  const last = gt.last;
  stepTrail(g, 60 * 6);
  assert.ok(gt.count <= hovering, 'no new puffs while parked');
  assert.equal(gt.count, 1, 'the old trail faded, the parked cloud stays');
  assert.equal(gt.last, last, 'topped up, not replaced');
  assert.ok(near(puffRadius(last), R, 1e-6), 'held at full size');
});

test('gas ticks hit enemies inside a cloud once per tick (overlaps never stack), corrode them, and miss enemies outside', () => {
  const { g, p } = freshPlayer();
  const by = tally(g);
  stepTrail(g, 40, flyRight(3)); // a dense, overlapping trail
  const gt = g.gasTrail;
  const inside = gt.puffs[0];
  const e = dummy(g, inside.x, inside.y);
  const far = dummy(g, p.x + 900, p.y + 900);
  // Count overlapping clouds over the enemy.
  const over = gt.puffs.slice(0, gt.count).filter((f) => Math.hypot(f.x - e.x, f.y - e.y) < f.r).length;
  assert.ok(over >= 2, `the enemy sits in ${over} overlapping clouds`);
  const hits = [];
  const hit = g.hitEnemy;
  g.hitEnemy = function (x, dmg, ...rest) { if (x === e) hits.push(dmg); return hit.call(this, x, dmg, ...rest); };
  const ticks = 60;
  stepTrail(g, ticks, flyRight(3));
  const expected = Math.floor(ticks / 60 / W.gasTick(weaponBuild(p, 'gas')));
  assert.ok(hits.length >= expected - 1 && hits.length <= expected + 1, `one hit per gas tick (${hits.length} vs ~${expected})`);
  assert.ok(near(hits[0], weaponDamage(p, 'gas')), 'a tick deals the gas damage');
  assert.ok(e.st?.corrode > 0, 'gas corrodes');
  assert.equal(far.hp, far.maxHp, 'an enemy outside the gas is untouched');
  assert.ok(by.gas > 0);
});

test('clouds swell in, then thin out and vanish after their lifetime (Gas Trail Linger keeps them longer)', () => {
  const { g, p } = freshPlayer();
  stepTrail(g, 1, flyRight(4));
  const f = g.gasTrail.puffs[0];
  const R = gasCloudRadius(p);
  assert.ok(f.r < R, 'a fresh puff starts small');
  const life = W.gasLife(weaponBuild(p, 'gas'));
  stepTrail(g, Math.round(life * 0.5 * 60), flyRight(4));
  assert.ok(near(f.r, R, 1e-6), 'full size mid-life');
  discardWeapon(p, 'gas');
  stepTrail(g, Math.round(life * 60) + 5);
  assert.equal(g.gasTrail.count, 0, 'every cloud is gone after its lifetime, and a discarded trail vents no more');
  const { p: p2 } = freshPlayer({ cards: [['gas_linger', 3]] });
  assert.ok(W.gasLife(weaponBuild(p2, 'gas')) > life);
});

test('Seeking Miasma: clouds creep toward the nearest enemy', () => {
  const { g, p } = freshPlayer({ bt: { 6: 'transform' } });
  stepTrail(g, 20, flyRight(4));
  p.vx = 0;
  const gt = g.gasTrail;
  const f = gt.puffs[0];
  const e = dummy(g, f.x, f.y - 180);
  const d0 = Math.hypot(e.x - f.x, e.y - f.y);
  stepTrail(g, 60);
  const d1 = Math.hypot(e.x - f.x, e.y - f.y);
  assert.ok(d1 < d0 - W.seekSpeed * 0.7, `the cloud crept ${Math.round(d0 - d1)} px toward the enemy`);
  // Without the transform the cloud stays put (just the small drift off the tail).
  const plain = freshPlayer();
  stepTrail(plain.g, 20, flyRight(4));
  const q = plain.g.gasTrail.puffs[0];
  const e2 = dummy(plain.g, q.x, q.y - 180);
  const q0 = Math.hypot(e2.x - q.x, e2.y - q.y);
  stepTrail(plain.g, 60);
  assert.ok(Math.abs(Math.hypot(e2.x - q.x, e2.y - q.y) - q0) < 15);
});

test('Volatile Pockets: a pocket swells, then bursts on an enemy that comes close (gas_pocket damage)', () => {
  const { g, p } = freshPlayer({ bt: { 12: 'transform' } });
  const by = tally(g);
  stepTrail(g, 2, flyRight(3));
  const gt = g.gasTrail;
  assert.equal(gt.pocketCount, 1, 'a pocket at the tail');
  const k = gt.pockets[0];
  const e = dummy(g, k.x + 20, k.y);
  stepTrail(g, Math.ceil(W.pocketArm * 60) + 2);
  assert.ok(gt.pocketsBurst >= 1, 'it burst once armed');
  assert.ok(by.gas_pocket > 0 && e.hp < e.maxHp, 'the burst hurt the enemy');
  // Unprovoked pockets burst at the end of their fuse.
  const lone = freshPlayer({ bt: { 12: 'transform' } });
  stepTrail(lone.g, 2, flyRight(3));
  stepTrail(lone.g, Math.ceil(W.pocketFuse * 60) + 2);
  assert.ok(lone.g.gasTrail.pocketsBurst >= 1);
});

test('Toxic Shroud: a cloud round the hull follows the ship and ticks anything close (gas_shroud damage)', () => {
  const { g, p } = freshPlayer({ bt: { 18: 'transform' } });
  const by = tally(g);
  stepTrail(g, 1);
  const R = g.gasTrail.shroudR;
  assert.ok(near(R, gasCloudRadius(p) * W.shroudRadiusMult), 'shroud radius');
  // An enemy beside the ship (ahead of it, nowhere near the trail) takes shroud ticks.
  const e = dummy(g, p.x + R * 0.6, p.y);
  stepTrail(g, 60);
  assert.ok(by.gas_shroud > 0 && e.hp < e.maxHp, 'the shroud ticks');
  // It follows the ship.
  p.x += 500;
  const e2 = dummy(g, p.x - R * 0.6, p.y);
  stepTrail(g, 60);
  assert.ok(e2.hp < e2.maxHp, 'the shroud moved with the hull');
  discardWeapon(p, 'gas');
  stepTrail(g, 2);
  assert.equal(g.gasTrail.shroudR, 0, 'gone with the weapon');
});

test('live fight: the gas trail fires on its own in the full game loop with every transform, and the pools stay bounded', () => {
  const { g, p } = freshPlayer({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, cards: [['gas_rate', 6], ['gas_linger', 6]] });
  const by = tally(g);
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    dummy(g, p.x + Math.cos(a) * (90 + (k % 5) * 50), p.y + Math.sin(a) * (90 + (k % 5) * 50));
  }
  g.autoFire = true;
  g.autoAim = true;
  g.mouse = { x: 0, y: 0, down: false };
  let maxPuffs = 0;
  for (let i = 0; i < 60 * 10; i++) {
    // Circle through the pack.
    const a = i / 60;
    p.x += Math.cos(a) * 4;
    p.y += Math.sin(a) * 4;
    g.update(1 / 60);
    maxPuffs = Math.max(maxPuffs, g.gasTrail.count);
  }
  assert.ok(by.gas > 0 && by.gas_pocket > 0 && by.gas_shroud > 0, `every part deals damage: ${JSON.stringify(Object.keys(by))}`);
  assert.ok(maxPuffs <= g.gasTrail.puffs.length && g.gasTrail.pocketCount <= g.gasTrail.pockets.length, 'pools never overflow');
  assert.ok(g.enemyManager.enemies.some((e) => e.st?.corrode > 0), 'the pack corrodes');
  g.resetRun();
  assert.equal(g.gasTrail.activeCount, 0, 'a new run clears the trail');
});

test('drawing costs a fixed handful of paths however long the trail is, and skips clouds off screen', () => {
  const counts = (n) => {
    const { g, p } = freshPlayer({ bt: { 18: 'transform' } });
    g.camX = p.x - 640;
    g.camY = p.y - 360;
    stepTrail(g, n, flyRight(2));
    g.camX = p.x - 640;
    let fills = 0, strokes = 0, arcs = 0;
    const ctx = new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'fill') return () => { fills++; };
        if (key === 'stroke') return () => { strokes++; };
        if (key === 'arc') return () => { arcs++; };
        return () => {};
      },
      set(target, key, value) { target[key] = value; return true; }
    });
    g.gasTrail.drawGround(ctx, g);
    return { fills, strokes, arcs, puffs: g.gasTrail.count };
  };
  const short = counts(10);
  const long = counts(150);
  assert.ok(long.puffs > short.puffs * 3, 'a much longer trail');
  assert.equal(long.fills, short.fills, 'fills do not grow with the puff count');
  assert.equal(long.strokes, short.strokes, 'strokes do not grow with the puff count');
  assert.ok(long.fills + long.strokes <= 6);
  // Off screen: nothing but the (empty) batches.
  const { g } = freshPlayer();
  stepTrail(g, 60, flyRight(4));
  g.camX = g.player.x + 5000;
  let arcs = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'arc' ? () => { arcs++; } : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.gasTrail.drawGround(ctx, g);
  assert.equal(arcs, 0);
  assert.equal(new GasTrail().drawGround(silent, g), undefined, 'an empty trail draws nothing');
});

test('every dash vents one giant round cloud that gasses enemies far outside the trail; no gas weapon, no cloud', () => {
  const { g, p } = freshPlayer();
  g.enemyManager.enemies.length = 0;
  const r = gasCloudRadius(p) * W.gasDashRadiusMult;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  // Just inside the dash cloud, far outside an ordinary puff, on the side the ship dashes away from.
  g.enemyManager.enemies.push(Object.assign(e, { x: p.x - r * 0.8, y: p.y, vx: 0, vy: 0, speed: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  p.vx = 3; p.vy = 0;
  const before = g.gasTrail.count;
  g.triggerDash();
  assert.equal(g.gasTrail.dashClouds, 1);
  assert.equal(g.gasTrail.count, before + 1);
  const cloud = g.gasTrail.puffs[g.gasTrail.count - 1];
  assert.ok(near(cloud.radius, r), 'giant: gasDashRadiusMult x the cloud radius');
  assert.ok(near(cloud.life, W.gasLife(weaponBuild(p, 'gas')) * W.gasDashLifeMult));
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  assert.ok(e.hp < e.maxHp && e.st?.corrode > 0, 'the enemy in the dash cloud is gassed and corroded');

  const dry = h.createHeadlessGame();
  dry.resetRun();
  dry.state = 'PLAYING';
  dry.triggerDash();
  assert.equal(dry.gasTrail.dashClouds, 0, 'no Gas Trail, no dash cloud');
});
