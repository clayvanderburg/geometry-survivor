import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Electric Shield Field: a defensive slot weapon with a fixed SHOCK element. Trigger radius, recharge,
// stuns through the shared SHOCK rules (immunity and boss / lieutenant resistance), STATUS card gating,
// the three Breakthroughs, and a hard guarantee that it never touches the ship's shield.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, weaponDamage, fieldRadius, shockStun } = await import('../js/weapon-scaling.js');
const { statusState } = await import('../js/status-effects.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, makeBuild, levelBuild, weaponBuild, weaponElement } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, eligibleUpgrades, ownedElements, applyBreakthrough } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, WEAPONS, weaponTags } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { weaponChipsHtml } = await import('../js/run-overview.js');
const { ShockField, repulseScale } = await import('../js/shock-field.js');
const { TUNING } = await import('../js/config.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function withRandom(fn, value) {
  const orig = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  try { return fn(); } finally { Math.random = orig; }
}

// A headless game with only the field equipped and the given still enemies (placed by distance from the ship).
function fieldGame({ cards = [], bt = {}, foes = [] } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'shockfield');
  p.loadout = ['shockfield'];
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { shockfield: bt };
  g.enemyManager.enemies.length = 0;
  for (const f of foes) addFoe(g, f);
  const bySource = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, bySource, field: g.shockField };
}

function addFoe(g, { d, a = 0, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the field (no enemy movement, spawns or other weapons), like Game.update does each tick.
const tick = (g, n = 1) => { for (let i = 0; i < n; i++) g.shockField.update(DT, g); };

test('Electric Shield Field is a DEFENSIVE slot weapon: source shockfield, SHOCK + AREA tags, four single-stat cards', () => {
  const w = WEAPON_BY_ID.shockfield;
  assert.equal(w.name, 'Electric Shield Field');
  assert.equal(w.category, 'DEFENSIVE');
  assert.deepEqual(w.tagSources, ['shockfield']);
  assert.deepEqual(WEAPON_TAGS.shockfield, ['shock', 'area']);
  for (const t of weaponTags('shockfield')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.shockfield, 'shockfield');
  assert.ok(DAMAGE_SOURCE_COLORS.shockfield);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['shockfield', 'fieldlash', 'thunderclap']) assert.equal(groups[stat], 'shockfield', stat);
  assert.deepEqual(STAT_CARDS.shockfield.map((c) => c.stat), ['damage', 'recharge', 'radius', 'stun']);
  assert.deepEqual(STAT_CARDS.shockfield.map((c) => POWER_STATS.has(c.stat)), [true, true, false, false]);
  assert.equal(ELEMENT_CARDS.shockfield, undefined, 'no element cards: SHOCK is built in');
  for (const c of STAT_CARDS.shockfield) assert.match(c.summary, /^Electric Shield Field:/);
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.shockfield[m].summary, /Electric Shield Field/);
  assert.deepEqual(BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.shockfield[m].name), ['Arc Lash', 'Repulsor Surge', 'Thunderclap Overcharge']);
  // Every player-facing text says it is not shield HP and never claims to repair it.
  for (const text of [w.summary, UPGRADE_BY_ID.shockfield.summary]) assert.match(text, /never repairs your shield/);
  for (const text of [...STAT_CARDS.shockfield.map((c) => c.summary), ...Object.values(TRANSFORMS.shockfield).map((t) => t.summary)]) {
    assert.doesNotMatch(text, /repair|restore|regenerat|heal/i, text);
  }
});

test('LV 1-18 numbers: radius, damage, recharge and stun each move only with their own card; potential sits on the curve', () => {
  const b1 = levelBuild('shockfield', 1);
  assert.equal(W.fieldRadius(b1), 125);
  assert.equal(W.fieldCooldown(b1), 2.2);
  assert.equal(W.fieldStunRank(b1), 1);
  assert.ok(near(POTENTIAL_DPS.shockfield(b1), DPS_TARGET(1)));
  // LV 1 discharge damage per enemy, in base damage: DPS_TARGET(1) x 2.2 s, valued at one target.
  assert.equal(W.fieldHitShare, 1);
  assert.ok(near(W.fieldDamageMult(b1), DPS_TARGET(1) * 2.2));
  const maxed = makeBuild('shockfield', 18, { damage: 5, recharge: 4, radius: 8, stun: 4 });
  assert.ok(near(W.fieldCooldown(maxed), 2.2 / 2.6), 'four Capacitor ranks: at most about one discharge a second');
  assert.ok(W.fieldCooldown(maxed) > 0.8, 'never fires constantly');
  assert.equal(W.fieldRadius(maxed), 125 + 24 * 8);
  assert.equal(W.fieldStunRank(maxed), 5);
  const caps = Object.fromEntries(STAT_CARDS.shockfield.map((c) => [c.stat, c.maxLevel]));
  assert.deepEqual(caps, { damage: 11, recharge: 4, radius: 8, stun: 4 });
  // Area scales the field (Field Amplifier).
  const p = fieldGame().p;
  assert.equal(fieldRadius(p), 125);
  p.stats.areaMult = 1.3;
  assert.ok(near(fieldRadius(p), 162.5));
});

test('SHOCK is built in: it counts as a SHOCK weapon for STATUS cards and the Shock Amplifier; Stun Coils rank it', () => {
  const { p } = fieldGame();
  p.loadout = ['blaster', 'shockfield'];
  assert.deepEqual(weaponElement(p, 'shockfield'), { element: 'shock', rank: 1, fixed: true });
  assert.ok(ownedElements(p).has('shock'));
  const offered = new Set(eligibleUpgrades(p).map((u) => u.id));
  for (const id of ['status_potency', 'status_application', 'status_duration', 'shock_conductor', 'shock_damage']) assert.ok(offered.has(id), `${id} offered`);
  for (const id of ['fire_damage', 'frost_damage', 'corrode_damage']) assert.ok(!offered.has(id), `${id} not offered`);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.shockfield_stun, levelJump: 2 });
  assert.equal(weaponElement(p, 'shockfield').rank, 3);
  assert.equal(weaponElement(p, 'shockfield').rank, W.fieldStunRank(weaponBuild(p, 'shockfield')));
  applyBreakthrough(p, 'shockfield', 6, 'boost');
  assert.equal(weaponElement(p, 'shockfield').rank, 4, 'ACROSS THE BOARD adds a Stun rank (a UTILITY stat)');
  // Shock Amplifier: discharges hit harder.
  const before = weaponDamage(p, 'shockfield');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.shock_damage, levelJump: 1 });
  assert.ok(near(weaponDamage(p, 'shockfield'), before * (1 + W.elementDamageStep)));
  // Without the field, nothing is SHOCK any more.
  discardWeapon(p, 'shockfield');
  assert.equal(weaponElement(p, 'shockfield'), null);
  assert.ok(!ownedElements(p).has('shock'));
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === 'shock_conductor'));
});

test('trigger radius: nothing happens until an enemy crosses the field, then everything inside is hit once', () => {
  const r = 125;
  const { g, field, bySource } = fieldGame({ foes: [{ d: 400 }] });
  const outside = g.enemyManager.enemies[0];
  const edge = r + outside.radius;
  outside.x = g.player.x + edge + 6; // just outside the reach
  tick(g, 120);
  assert.equal(field.discharges, 0, 'no discharge while nothing is inside');
  assert.equal(outside.hp, outside.maxHp);
  assert.equal(field.charge, 1);
  const inner = addFoe(g, { d: 40, a: 2 });
  const rim = addFoe(g, { d: edge - 2, a: 4 });
  tick(g);
  assert.equal(field.discharges, 1);
  const dmg = weaponDamage(g.player, 'shockfield');
  assert.ok(near(bySource.shockfield, dmg * 2), 'both enemies inside take one full discharge each');
  assert.ok(inner.hp < inner.maxHp && rim.hp < rim.maxHp);
  assert.equal(outside.hp, outside.maxHp, 'the one outside is untouched');
});

test('recharge: one discharge per cooldown even with enemies parked inside; Capacitors shorten it; the HUD gauge fills', () => {
  const { g, field } = fieldGame({ foes: [{ d: 60 }, { d: 80, a: 3 }] });
  tick(g, Math.round(10 * 60));
  // t = 0, 2.2, 4.4, 6.6, 8.8 s
  assert.equal(field.discharges, 5);
  assert.ok(field.timer > 0 && field.charge < 1);
  const fast = fieldGame({ cards: [['shockfield_recharge', 4]], foes: [{ d: 60 }] });
  tick(fast.g, Math.round(10 * 60));
  const cd = W.fieldCooldown(weaponBuild(fast.p, 'shockfield'));
  assert.equal(fast.field.discharges, Math.floor(10 / cd) + 1);
  // HUD: a chip gauge in tenths, glowing once charged.
  const half = fieldGame({ foes: [{ d: 60 }] });
  tick(half.g);
  tick(half.g, Math.round(2.2 * 60 * 0.5) + 1);
  assert.equal(half.field.hudCharge(), 0.5);
  const html = weaponChipsHtml(half.p, { shockfield: half.field.hudCharge() });
  assert.match(html, /weapon-slot-chip charge"[^>]*--charge:0\.5/);
  assert.match(weaponChipsHtml(half.p, { shockfield: 1 }), /charge ready/);
  assert.doesNotMatch(weaponChipsHtml(half.p), /charge/, 'other strips carry no gauge');
});

test('stuns go through the shared SHOCK rules: stun immunity is respected, bosses and lieutenants resist', () => {
  const { g, field } = fieldGame({ foes: [{ d: 50 }, { d: 70, a: 2, isBoss: true, radius: 30 }, { d: 70, a: 4, isLieutenant: true }, { d: 60, a: 5 }] });
  const [plain, boss, lt, immune] = g.enemyManager.enemies;
  statusState(immune).stunImmT = 0.8;
  withRandom(() => tick(g), 0.99); // no crits, no long stuns
  assert.equal(field.discharges, 1);
  const p = g.player;
  assert.ok(near(plain.st.stunT, shockStun(p, 1)), `plain ${plain.st.stunT}`);
  assert.ok(near(boss.st.stunT, shockStun(p, 1) * TUNING.shockBossMult), `boss ${boss.st.stunT}`);
  assert.ok(near(lt.st.stunT, shockStun(p, 1) * TUNING.shockLieutenantMult), `lieutenant ${lt.st.stunT}`);
  assert.equal(immune.st.stunT, 0, 'a stun-immune enemy is not stunned');
  // A long stun rolls like any SHOCK hit (20% at rank 1, more with Stun Coils).
  const long = fieldGame({ foes: [{ d: 50 }] });
  withRandom(() => tick(long.g), 0.1);
  assert.equal(long.g.enemyManager.enemies[0].st.stunLong, true);
  // Stun Coils lengthen the short stun.
  const coils = fieldGame({ cards: [['shockfield_stun', 4]], foes: [{ d: 50 }] });
  withRandom(() => tick(coils.g), 0.99);
  assert.ok(near(coils.g.enemyManager.enemies[0].st.stunT, shockStun(coils.p, 5)));
});

test('it never touches the shield: no write to player.hp or maxHp, in any Breakthrough, in HARDCORE too', () => {
  const src = fs.readFileSync(path.join(root, 'js/shock-field.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bhp\b|maxHp/, 'the field module never reads or writes shield values');
  for (const mode of ['normal', 'hardcore']) {
    const { g, p, field } = fieldGame({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' },
      foes: Array.from({ length: 12 }, (_, k) => ({ d: 60 + (k % 3) * 40, a: k })) });
    g.mode = p.mode = mode;
    let hp = 40;
    let maxHp = 75;
    Object.defineProperty(p, 'hp', { get: () => hp, set: () => assert.fail('player.hp written'), configurable: true });
    Object.defineProperty(p, 'maxHp', { get: () => maxHp, set: () => assert.fail('player.maxHp written'), configurable: true });
    p.dashCooldown = 1;
    tick(g, 60 * 12);
    assert.ok(field.discharges >= 3 && field.thunderclaps >= 1);
    assert.equal(p.hp, 40);
    assert.equal(p.maxHp, 75);
  }
});

test('Breakthroughs: each transform adds exactly BT_TRANSFORM_DPS; the cards describe them', () => {
  for (const m of BREAKTHROUGH_LEVELS) {
    const plain = POTENTIAL_DPS.shockfield(makeBuild('shockfield', m, { damage: 2 }));
    const t = POTENTIAL_DPS.shockfield(makeBuild('shockfield', m, { damage: 2 }, { [m]: 'transform' }));
    assert.ok(near(t, plain * BT_TRANSFORM_DPS, 1e-9), `LV ${m}`);
  }
  const { p } = fieldGame({ cards: [['shockfield_damage', 5]] });
  const card = describeBreakthrough(p, 'shockfield', 6, 'transform');
  assert.equal(card.id, 'bt:shockfield:6:lash');
  assert.equal(card.name, 'Arc Lash');
  assert.equal(card.category, 'SHOCK FIELD');
  assert.ok(Math.abs(card.dpsGain - 0.22) < 0.01 && card.rows[0].id === 'potentialDps' && !/DPS/.test(card.headline));
  assert.ok(card.rows.some((r) => r.id === 'fieldLash'));
  assert.ok(describeBreakthrough(p, 'shockfield', 12, 'transform').rows.some((r) => r.id === 'fieldDashRefund'));
  assert.ok(describeBreakthrough(p, 'shockfield', 18, 'transform').rows.some((r) => r.id === 'fieldClap'));
});

test('Arc Lash (LV 6): arcs into the 3 nearest enemies beyond the field, within reach, and stuns them', () => {
  const r = 125;
  const foes = [{ d: 50 }, { d: r * 1.4, a: 1 }, { d: r * 1.6, a: 2 }, { d: r * 1.8, a: 3 }, { d: r * 2.0, a: 4 }, { d: r * 3, a: 5 }];
  const { g, p, bySource } = fieldGame({ bt: { 6: 'transform' }, foes });
  const [, a, b, c, d, far] = g.enemyManager.enemies;
  withRandom(() => tick(g), 0.99);
  const dmg = weaponDamage(p, 'shockfield');
  assert.ok(near(bySource.fieldlash, 3 * dmg * W.lashShare), 'three arcs at lashShare of a discharge each');
  for (const e of [a, b, c]) assert.ok(e.hp < e.maxHp && e.st?.stunT > 0, 'the nearest three are hit and stunned');
  assert.equal(d.hp, d.maxHp, 'only three arcs');
  assert.equal(far.hp, far.maxHp, 'beyond reach');
});

test('Repulsor Surge (LV 12): discharges throw enemies outward (bosses hold), harder hits, and shave the dash cooldown', () => {
  const { g, p } = fieldGame({ bt: { 12: 'transform' }, foes: [{ d: 60, a: 0 }, { d: 70, a: Math.PI, isBoss: true, radius: 30 }] });
  const [e, boss] = g.enemyManager.enemies;
  p.dashCooldown = 1.2;
  tick(g);
  assert.ok(e.gvx > 5, `thrown outward (east): ${e.gvx}`);
  assert.ok(!(Math.abs(boss.gvx || 0) > 0), 'bosses hold their ground');
  assert.equal(repulseScale({ isBoss: true, radius: 30 }), 0);
  assert.ok(repulseScale({ isLieutenant: true, radius: 10 }) < repulseScale({ radius: 10 }));
  assert.ok(near(p.dashCooldown, 1.2 - W.dashRefund), `dash ${p.dashCooldown}`);
  const plain = weaponDamage(p, 'shockfield', makeBuild('shockfield', 12));
  assert.ok(near(weaponDamage(p, 'shockfield'), plain * BT_TRANSFORM_DPS), 'no extra attacks: every discharge hits x1.22');
});

test('Thunderclap Overcharge (LV 18): discharges bank charge; a full bank bursts when a pack or a boss closes in', () => {
  const r = 125;
  const { g, p, field, bySource } = fieldGame({ bt: { 18: 'transform' }, foes: [{ d: 50 }] });
  tick(g, Math.round(2.2 * 60 * 2) + 2); // three discharges (t = 0, 2.2, 4.4)
  assert.equal(field.discharges, 3);
  assert.equal(field.store, W.overchargeStore);
  assert.equal(field.thunderclaps, 0, 'one enemy is not a pack');
  // A pack closes in (inside the wider clap ring but outside the field): the clap fires at once, mid-recharge.
  for (let k = 0; k < W.overchargePack - 1; k++) addFoe(g, { d: r * 1.35, a: k });
  const before = bySource.thunderclap || 0;
  tick(g);
  assert.equal(field.thunderclaps, 1);
  assert.equal(field.store, 0);
  const dmg = weaponDamage(p, 'shockfield') * W.overchargeShare;
  assert.ok(near(bySource.thunderclap - before, dmg * W.overchargePack), 'every enemy in the clap ring takes it');
  // A boss stepping into the field sets off a full bank on its own.
  const boss = fieldGame({ bt: { 18: 'transform' }, foes: [{ d: 50 }] });
  boss.field.store = W.overchargeStore;
  boss.field.timer = 2;
  addFoe(boss.g, { d: 90, a: 2, isBoss: true, radius: 30 });
  tick(boss.g);
  assert.equal(boss.field.thunderclaps, 1);
});

test('live fight: the field defends on its own through the normal game loop, all transforms included', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  acquireWeapon(p, 'shockfield');
  p.loadout = ['shockfield'];
  p.breakthroughs = { shockfield: { 6: 'transform', 12: 'transform', 18: 'transform' } };
  const bySource = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const e = g.enemyManager.getArchetype('swarmer', 1);
    const d = 90 + (k % 4) * 60;
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  g.mouse = { x: 0, y: 0, down: false };
  for (let i = 0; i < 60 * 24; i++) {
    g.update(DT);
    g.state = 'PLAYING'; // level-ups from the wave spawns would pause the fight
  }
  for (const stat of ['shockfield', 'fieldlash', 'thunderclap']) assert.ok(bySource[stat] > 0, `${stat} dealt damage`);
});

test('cards preview the field exactly: pick card leads with its radius, Stun Coils with the stun', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const pick = describeWeaponPick(g.player, 'shockfield');
  assert.equal(pick.name, 'Electric Shield Field');
  assert.ok(pick.rows.some((r) => r.id === 'fieldRadius' && r.after === '125'));
  assert.ok(pick.rows.some((r) => r.id === 'fieldCooldown' && r.after === '2.20s'));
  acquireWeapon(g.player, 'shockfield');
  const coils = describeUpgrade(g.player, { ...UPGRADE_BY_ID.shockfield_stun, levelJump: 1 });
  assert.match(coils.headline, /STUN/);
  assert.equal(coils.toLevel, 2);
  const cap = describeUpgrade(g.player, { ...UPGRADE_BY_ID.shockfield_recharge, levelJump: 1 });
  assert.ok(cap.rows.some((r) => r.id === 'fieldCooldown'));
  // The field is a ShockField module the game owns, reset with the run.
  assert.ok(g.shockField instanceof ShockField);
});
