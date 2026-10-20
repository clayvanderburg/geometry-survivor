import test from 'node:test';
import assert from 'node:assert/strict';

// Plasma Grenades: single-stat formulas, LV 1 parity, Breakthroughs worth exactly x BT_TRANSFORM_DPS,
// element from the damage-type cards, and live headless fights (plain and with each transform).
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, makeBuild, levelBuild, BT_TRANSFORM_DPS, BREAKTHROUGH_LEVELS } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, loadoutAllows, eligibleUpgrades } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, weaponTags } = await import('../js/loadout.js');
const { describeUpgrade, describeWeaponPick, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { grenadeElement, GRENADE_ELEMENTS, Grenades } = await import('../js/grenades.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { WEAPONS } = await import('../js/loadout.js');

const near = (a, b, tol = 1e-9) => Math.abs(a / b - 1) < tol;
const dps = (b) => POTENTIAL_DPS.grenades(b);

test('Plasma Grenades are a slot weapon with source grenade, explosive area tags and five single-stat cards', () => {
  const w = WEAPON_BY_ID.grenades;
  assert.equal(w.name, 'Plasma Grenades');
  assert.deepEqual(w.tagSources, ['grenade']);
  assert.deepEqual(WEAPON_TAGS.grenade, ['projectile', 'explosive', 'area']);
  for (const t of weaponTags('grenades')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.grenade, 'grenades');
  assert.ok(DAMAGE_SOURCE_COLORS.grenade);
  const groups = buildSourceGroups(WEAPONS);
  assert.equal(groups.grenade, 'grenades');
  assert.equal(groups.emp, 'grenades');
  assert.deepEqual(STAT_CARDS.grenades.map((c) => c.stat), ['damage', 'count', 'rate', 'radius', 'range']);
  assert.deepEqual(STAT_CARDS.grenades.map((c) => POWER_STATS.has(c.stat)), [true, true, true, false, false]);
  assert.equal(STAT_CARDS.grenades.find((c) => c.stat === 'count').maxLevel, 5);
  assert.equal(STAT_CARDS.grenades.find((c) => c.stat === 'rate').maxLevel, 8);
  for (const c of STAT_CARDS.grenades) assert.match(c.summary, /^Plasma Grenades:/);
  // "volley" belongs to rockets and missiles only.
  const text = [w.summary, ...STAT_CARDS.grenades.map((c) => c.summary), ...Object.values(TRANSFORMS.grenades).map((t) => t.summary), UPGRADE_BY_ID.evo_emp.summary].join(' ');
  assert.doesNotMatch(text, /volley/i);
});

test('every grenade formula reads only its own rank', () => {
  const F = { count: W.grenadeCount, rate: W.grenadeCooldown, radius: W.grenadeBlastRadius, range: W.grenadeRange, damage: W.grenadeDamageMult };
  const base = levelBuild('grenades', 1);
  for (const card of STAT_CARDS.grenades) {
    const b = makeBuild('grenades', 5, { [card.stat]: 4 });
    for (const [stat, f] of Object.entries(F)) {
      if (stat === card.stat) assert.notEqual(f(b), f(base), `${card.id} changes ${stat}`);
      else assert.equal(f(b), f(base), `${card.id} must not change ${stat}`);
    }
  }
  assert.equal(W.grenadeCount(base), 2);
  assert.equal(W.grenadeCooldown(base), 2.2);
  assert.equal(W.grenadeBlastRadius(base), 95);
});

test('LV 1 Plasma Grenades sit on DPS_TARGET(1); damage, rate and count ranks scale like every weapon', () => {
  assert.ok(near(dps(levelBuild('grenades', 1)), DPS_TARGET(1)));
  for (let r = 1; r <= 8; r++) {
    assert.ok(near(dps(makeBuild('grenades', 1 + r, { damage: r })), DPS_TARGET(1) * DAMAGE_GROWTH ** r), `damage x${r}`);
    assert.ok(near(dps(makeBuild('grenades', 1 + r, { rate: r })), DPS_TARGET(1) * (1 + RATE_STEP * r)), `rate x${r}`);
  }
  for (let r = 1; r <= 5; r++) assert.ok(near(dps(makeBuild('grenades', 1 + r, { count: r })), DPS_TARGET(1) * (2 + r) / 2), `count x${r}`);
  for (const stat of ['radius', 'range']) assert.ok(near(dps(makeBuild('grenades', 5, { [stat]: 4 })), DPS_TARGET(1)), `${stat} is utility`);
});

test('each grenade transform is worth exactly x BT_TRANSFORM_DPS, alone and stacked, at any stat mix', () => {
  const mixes = [{}, { damage: 3 }, { count: 2, rate: 3 }, { radius: 2, range: 3, damage: 1 }];
  const combos = [{ 6: 'transform' }, { 12: 'transform' }, { 18: 'transform' }, { 6: 'transform', 12: 'transform' },
    { 6: 'transform', 18: 'transform' }, { 12: 'transform', 18: 'transform' }, { 6: 'transform', 12: 'transform', 18: 'transform' }];
  for (const ranks of mixes) {
    const plain = dps(makeBuild('grenades', 12, ranks));
    for (const bt of combos) {
      const n = Object.keys(bt).length;
      assert.ok(near(dps(makeBuild('grenades', 12, ranks, bt)), plain * BT_TRANSFORM_DPS ** n), `${JSON.stringify(ranks)} ${JSON.stringify(bt)}`);
    }
  }
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.grenades[m].summary, /Plasma Grenade/);
  assert.deepEqual(BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.grenades[m].name), ['Cluster Grenades', 'Lingering Cloud', 'Gravity Grenade']);
});

test('grenade cards preview their own stat; the NEW WEAPON pick and Breakthrough cards name Plasma Grenades', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  const pick = describeWeaponPick(p, 'grenades');
  assert.equal(pick.headline, 'PLASMA GRENADES', 'a weapon pick leads with the weapon, not a stat');
  acquireWeapon(p, 'grenades');
  assert.equal(describeUpgrade(p, { ...UPGRADE_BY_ID.grenades_count, levelJump: 1 }).headline, '+1 GRENADES / THROW');
  assert.equal(describeUpgrade(p, { ...UPGRADE_BY_ID.grenades_damage, levelJump: 1 }).headline, `+${Math.round((DAMAGE_GROWTH - 1) * 100)}% GRENADE DAMAGE`);
  const range = describeUpgrade(p, { ...UPGRADE_BY_ID.grenades_range, levelJump: 1 });
  assert.deepEqual(range.rows.map((r) => r.id), ['grenadeRange']);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.grenades_rate, levelJump: 3 });
  const t = describeBreakthrough(p, 'grenades', 6, 'transform');
  assert.equal(t.name, 'Cluster Grenades');
  assert.equal(t.category, 'PLASMA GRENADES');
  assert.match(t.headline, /\+22% DPS/);
});

test('grenade element cards are offered with grenades, lock the element for good, and leave with the weapon', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  discardWeapon(p, 'blaster');
  const ids = ['grenades_fire', 'grenades_frost', 'grenades_corrode', 'grenades_shock'];
  for (const id of ids) assert.equal(loadoutAllows(p, UPGRADE_BY_ID[id]), false, id);
  acquireWeapon(p, 'grenades');
  for (const id of ids) {
    assert.equal(loadoutAllows(p, UPGRADE_BY_ID[id]), true, `${id} with grenades`);
    assert.match(UPGRADE_BY_ID[id].name, /^Plasma Grenades: /);
    assert.match(UPGRADE_BY_ID[id].summary, /Plasma Grenade/);
  }
  assert.deepEqual(eligibleUpgrades(p).filter((u) => u.elementCard).map((u) => u.id), ids, 'all four on offer before a pick');
  assert.equal(grenadeElement(p), GRENADE_ELEMENTS.plasma);
  const card = describeUpgrade(p, { ...UPGRADE_BY_ID.grenades_frost, levelJump: 1 });
  assert.ok(card.rows.some((r) => r.id === 'grenadeElement' && r.before === 'PLASMA' && r.after === 'FROST'), 'the card previews the element');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.grenades_frost, levelJump: 1 });
  assert.equal(grenadeElement(p).id, 'frost');
  assert.equal(grenadeElement(p).hue, GRENADE_ELEMENTS.frost.hue);
  assert.deepEqual(eligibleUpgrades(p).filter((u) => u.elementCard).map((u) => u.id), ['grenades_frost'], 'locked: only FROST rank-ups');
  discardWeapon(p, 'grenades');
  assert.equal(p.upgradeLevels.grenades_frost, undefined, 'the element left with its weapon');
  assert.equal(grenadeElement(p), GRENADE_ELEMENTS.plasma);
});

// A headless fight with only Plasma Grenades equipped, against a ring of real swarmers.
function grenadeFight({ bt = {}, cards = [], extra = [], ticks = 60 * 6, ring = 24 } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  acquireWeapon(p, 'grenades');
  for (const id of extra) acquireWeapon(p, id);
  p.loadout = ['grenades', ...extra];
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { grenades: bt };
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const e = g.enemyManager.getArchetype('swarmer', 1);
    const d = 120 + (k % 4) * 45;
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  g.autoFire = true;
  g.autoAim = true;
  g.mouse = { x: 0, y: 0, down: false };
  const bySource = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  const seen = { flying: 0, armed: 0, pools: 0, bomblets: 0, maxActive: 0, pulled: 0 };
  for (let i = 0; i < ticks; i++) {
    g.update(1 / 60);
    const gr = g.grenades;
    seen.maxActive = Math.max(seen.maxActive, gr.activeCount);
    for (let k = 0; k < gr.count; k++) gr.items[k].landed ? seen.armed++ : seen.flying++;
    seen.pools = Math.max(seen.pools, g.weaponFx.pools.filter((x) => x.source === 'grenade' && x.look).length);
    seen.bomblets = Math.max(seen.bomblets, g.weaponFx.events.filter((x) => x.source === 'grenade').length);
    if (g.enemyManager.enemies.some((e) => Math.abs(e.gvx || 0) > 0.05)) seen.pulled++;
  }
  return { g, p, bySource, seen };
}

test('live fight: Plasma Grenades arc, arm, then blast for damage on their own', () => {
  const { g, bySource, seen } = grenadeFight();
  assert.ok(seen.flying > 0 && seen.armed > 0, 'grenades fly, then sit armed');
  assert.ok(bySource.grenade > 0, 'grenade blasts deal damage');
  assert.equal(Object.keys(bySource).filter((s) => s !== 'grenade').length, 0, `only grenades fire: ${Object.keys(bySource)}`);
  assert.ok(g.enemyManager.enemies.filter((e) => e.hp < e.maxHp).length >= 6, 'blasts catch several enemies');
});

test('live fight: each grenade transform runs and deals damage', () => {
  const cluster = grenadeFight({ bt: { 6: 'transform' } });
  assert.ok(cluster.seen.bomblets > 0, 'Cluster Grenades scatter bomblets');
  assert.ok(cluster.bySource.grenade > 0);
  const cloud = grenadeFight({ bt: { 12: 'transform' } });
  assert.ok(cloud.seen.pools > 0, 'Lingering Cloud leaves clouds');
  assert.equal(cloud.g.weaponFx.pools.find((x) => x.source === 'grenade')?.look ?? 'plasma', 'plasma', 'a plain plasma cloud without damage-type cards');
  assert.ok(cloud.bySource.grenade > 0);
  const gravity = grenadeFight({ bt: { 18: 'transform' } });
  assert.ok(gravity.seen.pulled > 0, 'Gravity Grenades pull enemies in');
  assert.ok(gravity.bySource.grenade > 0);
  const all = grenadeFight({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, cards: [['grenades_count', 5], ['grenades_rate', 6]], ticks: 60 * 10 });
  assert.ok(all.bySource.grenade > 0);
  assert.ok(all.seen.maxActive <= all.g.grenades.items.length, 'the pool never overflows');
});

test('FIRE grenades burn; FROST chill; CORROSIVE corrode; SHOCK stun; clouds take the element', () => {
  const fire = grenadeFight({ cards: [['grenades_fire', 1]], bt: { 12: 'transform' } });
  assert.ok(fire.g.enemyManager.enemies.some((e) => e.st?.burn > 0), 'grenade hits ignite');
  assert.ok(fire.bySource.burn_grenades > 0, 'burn ticks deal damage, credited to the grenades');
  assert.ok(fire.g.weaponFx.pools.some((x) => x.source === 'grenade' && x.look === 'fire' && x.hue === GRENADE_ELEMENTS.fire.hue), 'a fire cloud');
  const frost = grenadeFight({ cards: [['grenades_frost', 1]] });
  assert.ok(frost.g.enemyManager.enemies.some((e) => e.st?.cold > 0 || e.st?.frozenT > 0 || e.st?.freezeImmT > 0), 'grenade hits chill');
  const acid = grenadeFight({ cards: [['grenades_corrode', 1]] });
  assert.ok(acid.g.enemyManager.enemies.some((e) => e.st?.corrode > 0), 'grenade hits corrode');
  const shock = grenadeFight({ cards: [['grenades_shock', 1]], bt: { 12: 'transform' } });
  assert.ok(shock.g.enemyManager.enemies.some((e) => e.st?.stunT > 0 || e.st?.stunImmT > 0), 'grenade hits stun');
  assert.ok(shock.g.weaponFx.pools.some((x) => x.source === 'grenade' && x.look === 'shock' && x.hue === GRENADE_ELEMENTS.shock.hue), 'a shock cloud');
});

test('SYNERGY: EMP Grenades needs grenades + Tesla Arc, names both, and arcs lightning off every blast', () => {
  const evo = UPGRADE_BY_ID.evo_emp;
  assert.ok(evo.isSynergy);
  assert.match(evo.summary, /Plasma Grenade/);
  assert.match(evo.summary, /Tesla Arc/);
  assert.equal(evo.category, 'GRENADES + TESLA ARC');
  const fight = grenadeFight({ extra: ['lightning'], cards: [['evo_emp', 1]] });
  assert.equal(fight.p.weapons.empGrenades, 1);
  assert.ok(fight.bySource.emp > 0, 'EMP arcs deal damage');
  discardWeapon(fight.p, 'lightning');
  assert.equal(fight.p.upgradeLevels.evo_emp, undefined, 'EMP leaves with Tesla Arc');
});

test('a throw spreads its grenades around the ship instead of piling into one direction', () => {
  // A dense pack to the east (nearest) and a few stragglers west, north and south: a 4-grenade throw
  // should hit each side once, not drop four grenades on the eastern pack.
  const gr = new Grenades();
  const p = { x: 0, y: 0 };
  const enemies = [];
  for (let k = 0; k < 8; k++) enemies.push({ x: 100 + k * 6, y: (k % 3) * 8, hp: 1, maxHp: 1 });
  enemies.push({ x: -200, y: 0, hp: 1, maxHp: 1 }, { x: 0, y: -210, hp: 1, maxHp: 1 }, { x: 0, y: 220, hp: 1, maxHp: 1 });
  const n = gr.spreadTargets({ enemyManager: { enemies } }, p, 400, 4);
  assert.equal(n, 4);
  const sides = new Set(gr.picks.slice(0, n).map((e) => Math.round(Math.atan2(e.y, e.x) / (Math.PI / 2))));
  assert.equal(sides.size, 4, 'one grenade per side');
  assert.equal(gr.picks[0], enemies[0], 'the nearest enemy is still the first pick');
});

test('Cluster Grenade bomblets scatter past the main blast', () => {
  const { g } = grenadeFight({ bt: { 6: 'transform' }, ticks: 60 * 4 });
  let far = 0, total = 0;
  const scatter = g.weaponFx.scatter.bind(g.weaponFx);
  g.weaponFx.scatter = (x, y, count, spread, radius, ...rest) => {
    const before = g.weaponFx.events.length;
    scatter(x, y, count, spread, radius, ...rest);
    for (const e of g.weaponFx.events.slice(before)) {
      total++;
      if (Math.hypot(e.x - x, e.y - y) > W.grenadeBlastRadius(levelBuild('grenades', 1)) * 0.95) far++;
    }
  };
  for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
  assert.ok(total > 0, 'bomblets scattered');
  assert.ok(far / total > 0.9, `most bomblets land outside the blast (${far}/${total})`);
});

test('Gravity Grenade: the pull builds up over the fuse, and an enemy in reach of two falls toward the one pulling hardest', async () => {
  const { gravityRamp } = await import('../js/grenades.js');
  const { wellPullScale } = await import('../js/gravity.js');
  assert.equal(gravityRamp(0), 0, 'no pull on landing');
  assert.equal(gravityRamp(1), W.gravityRamp + 1, 'strongest as it blasts');
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += gravityRamp((i + 0.5) / 1000);
  assert.ok(Math.abs(sum / 1000 - 1) < 1e-3, 'averages the old steady pull over the fuse');
  const gr = new Grenades();
  const arm = (x) => Object.assign(gr.items[gr.count++], { x, y: 0, landed: true, gravity: true, armedT: 0.5, fuse: 1, pullRadius: 200 });
  arm(-60);
  arm(100);
  const e = { x: 0, y: 0, hp: 1, maxHp: 1 };
  gr.pull({ enemyManager: { enemies: [e] }, particles: {} });
  const k = wellPullScale(-60, 0, 200, W.gravityPull * gravityRamp(0.5), 10);
  assert.ok(near(e.gvx, -60 * k), 'pulled by the nearer grenade alone, not dragged by both');
});
