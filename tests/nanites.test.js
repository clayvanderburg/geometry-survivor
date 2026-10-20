import test from 'node:test';
import assert from 'node:assert/strict';

// Nanite Swarm: registry wiring, single-stat formulas, LV 1 parity, Breakthroughs worth exactly
// x BT_TRANSFORM_DPS, the fixed CORROSIVE element, the swarm itself (launching at the densest pack, one
// bite per enemy per tick, growth on kills, dispersal), each Breakthrough, a live fight and cheap drawing.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, WEAPON_CLASS, sourceElement, weaponDamage, naniteRadius } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, ELEMENT_CARDS, FIXED_ELEMENTS, makeBuild, levelBuild, weaponElement, BT_TRANSFORM_DPS } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, eligibleUpgrades, ownedElements } = await import('../js/upgrades.js');
const { WEAPONS, WEAPON_BY_ID, weaponTags, weaponLevel } = await import('../js/loadout.js');
const { describeUpgrade, describeWeaponPick, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { NaniteSwarm, swarmRadius, SWARM_MAIN, SWARM_FISSION, SWARM_PLAGUE } = await import('../js/nanites.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { applyOnHitStatuses } = await import('../js/status-effects.js');

const near = (a, b, tol = 1e-9) => Math.abs(a / b - 1) < tol;
const dps = (b) => POTENTIAL_DPS.nanites(b);
const silent = new Proxy({}, { get: () => () => {} });

test('Nanite Swarm is a DEPLOYABLE slot weapon with source nanite, AREA + CORRODE tags and five single-stat cards', () => {
  const w = WEAPON_BY_ID.nanites;
  assert.equal(w.name, 'Nanite Swarm');
  assert.equal(w.category, 'DEPLOYABLE');
  assert.deepEqual(w.tagSources, ['nanite']);
  assert.deepEqual(WEAPON_TAGS.nanite, ['deployable', 'area', 'corrode']);
  for (const t of weaponTags('nanites')) assert.ok(TAG_INFO[t], t);
  assert.equal(SOURCE_WEAPON.nanite, 'nanites');
  assert.equal(WEAPON_CLASS.nanites, 'area');
  assert.ok(DAMAGE_SOURCE_COLORS.nanite);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['nanite', 'nanite_fission', 'nanite_plague', 'corrode_nanites']) assert.equal(groups[stat], 'nanites', stat);
  assert.deepEqual(STAT_CARDS.nanites.map((c) => c.stat), ['damage', 'rate', 'radius', 'duration', 'cooldown']);
  assert.deepEqual(STAT_CARDS.nanites.map((c) => POWER_STATS.has(c.stat)), [true, true, false, true, true]);
  assert.ok(STAT_CARDS.nanites.reduce((a, c) => a + c.maxLevel, 0) >= 17, 'the cards reach LV 18');
  for (const c of STAT_CARDS.nanites) assert.match(c.summary, /^Nanite Swarm:/);
  assert.equal(ELEMENT_CARDS.nanites, undefined, 'no element cards: it is born CORROSIVE');
  assert.equal(UPGRADE_BY_ID.nanites.isCore, true);
  for (const lv of [6, 12, 18]) assert.match(TRANSFORMS.nanites[lv].summary, /Nanite Swarm/);
});

test('every nanite formula reads only its own rank; LV 1 numbers', () => {
  const F = { rate: W.naniteTick, radius: W.naniteRadius, duration: W.naniteLife, cooldown: W.naniteCooldown, damage: W.naniteDamageMult };
  const base = levelBuild('nanites', 1);
  for (const card of STAT_CARDS.nanites) {
    const b = makeBuild('nanites', 5, { [card.stat]: 4 });
    for (const [stat, f] of Object.entries(F)) {
      if (stat === card.stat) assert.notEqual(f(b), f(base), `${card.id} changes ${stat}`);
      else assert.equal(f(b), f(base), `${card.id} must not change ${stat}`);
    }
  }
  assert.equal(W.naniteRadius(base), 58);
  assert.equal(W.naniteLife(base), 4);
  assert.equal(W.naniteTick(base), 0.25);
  assert.equal(W.naniteCooldown(base), 3);
});

test('LV 1 sits on DPS_TARGET(1); damage, bite rate, launch rate and lifetime are POWER; swarm size is utility', () => {
  assert.ok(near(dps(levelBuild('nanites', 1)), DPS_TARGET(1)));
  for (let r = 1; r <= 6; r++) {
    assert.ok(near(dps(makeBuild('nanites', 1 + r, { damage: r })), DPS_TARGET(1) * DAMAGE_GROWTH ** r), `damage x${r}`);
    assert.ok(near(dps(makeBuild('nanites', 1 + r, { rate: r })), DPS_TARGET(1) * (1 + RATE_STEP * r)), `bite rate x${r}`);
    assert.ok(near(dps(makeBuild('nanites', 1 + r, { cooldown: r })), DPS_TARGET(1) * (1 + RATE_STEP * r)), `launch rate x${r}`);
    assert.ok(near(dps(makeBuild('nanites', 1 + r, { duration: r })), DPS_TARGET(1) * (1 + 0.2 * r)), `lifetime x${r}`);
  }
  assert.ok(near(dps(makeBuild('nanites', 5, { radius: 4 })), DPS_TARGET(1)), 'radius is utility');
});

test('each nanite transform is worth exactly x BT_TRANSFORM_DPS, alone and stacked, at any stat mix', () => {
  const mixes = [{}, { damage: 3 }, { rate: 4 }, { radius: 2, duration: 3, cooldown: 2, damage: 1 }];
  const combos = [{ 6: 'transform' }, { 12: 'transform' }, { 18: 'transform' }, { 6: 'transform', 12: 'transform' },
    { 6: 'transform', 18: 'transform' }, { 6: 'transform', 12: 'transform', 18: 'transform' }];
  for (const ranks of mixes) {
    const plain = dps(makeBuild('nanites', 12, ranks));
    for (const bt of combos) {
      const n = Object.keys(bt).length;
      assert.ok(near(dps(makeBuild('nanites', 12, ranks, bt)), plain * BT_TRANSFORM_DPS ** n), `${JSON.stringify(ranks)} ${JSON.stringify(bt)}`);
    }
  }
});

function freshPlayer({ cards = [], bt = {}, only = true } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  if (only) discardWeapon(p, 'blaster');
  acquireWeapon(p, 'nanites');
  for (const [id, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: lv });
  p.breakthroughs = { nanites: bt };
  return { g, p };
}
const dummy = (g, x, y, hp = 1e7) => {
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x, y, vx: 0, vy: 0, hp, maxHp: hp, trail: e.trail || [] });
  g.enemyManager.enemies.push(e);
  return e;
};
const step = (g, ticks) => { for (let i = 0; i < ticks; i++) g.nanites.update(1 / 60, g); };
const tally = (g) => {
  const by = {};
  const hit = g.hitEnemy;
  g.hitEnemy = function (e, dmg, source, kx, ky, flash, stat = source) {
    by[stat] = (by[stat] || 0) + dmg;
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return by;
};

test('fixed CORROSIVE element: corrode rank follows the level, STATUS cards unlock, acid is credited to the swarm', () => {
  assert.equal(FIXED_ELEMENTS.nanites, 'corrode');
  const { p } = freshPlayer();
  assert.deepEqual(weaponElement(p, 'nanites'), { element: 'corrode', rank: 1, fixed: true });
  assert.equal(sourceElement(p, 'nanite'), 'corrode');
  assert.ok(ownedElements(p).has('corrode'));
  const offered = new Set(eligibleUpgrades(p).map((u) => u.id));
  for (const id of ['status_potency', 'corrode_damage']) assert.ok(offered.has(id), `${id} offered with only the swarm`);
  assert.ok(![...offered].some((id) => UPGRADE_BY_ID[id].elementCard), 'never an element card for it');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.nanites_damage, levelJump: 5 });
  assert.equal(weaponLevel(p, 'nanites'), 6);
  assert.equal(weaponElement(p, 'nanites').rank, 2);
  const e = { type: 'swarmer', hp: 100, maxHp: 100, radius: 10 };
  applyOnHitStatuses(p, e, 'nanite', weaponDamage(p, 'nanite'));
  assert.ok(e.st.corrode > 0);
  assert.equal(e.st.corrodeStat, 'corrode_nanites');
});

test('cards preview their own stat; the pick and Breakthrough cards name the weapon', () => {
  const { p } = freshPlayer();
  const rows = (id) => describeUpgrade(p, { ...UPGRADE_BY_ID[id], levelJump: 1 }).rows.map((r) => r.label);
  assert.ok(rows('nanites_damage').includes('Bite damage'));
  assert.ok(rows('nanites_rate').includes('Bites / s'));
  assert.ok(rows('nanites_radius').includes('Swarm radius'));
  assert.ok(rows('nanites_duration').includes('Swarm lifetime'));
  assert.ok(rows('nanites_launch').includes('Swarm launch'));
  assert.equal(describeWeaponPick(p, 'nanites').name, 'Nanite Swarm');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.nanites_damage, levelJump: 5 });
  const t = describeBreakthrough(p, 'nanites', 6, 'transform');
  assert.equal(t.name, 'Fission Bloom');
  assert.equal(t.category, 'NANITE SWARM');
  assert.match(t.headline, /\+22% DPS/);
});

test('a launch flies to the densest pack in range and bursts into a swarm there', () => {
  const { g, p } = freshPlayer();
  dummy(g, p.x - 300, p.y); // a straggler
  const pack = [];
  for (let k = 0; k < 6; k++) pack.push(dummy(g, p.x + 250 + (k % 3) * 18, p.y + 120 + Math.floor(k / 3) * 18));
  dummy(g, p.x + 2000, p.y); // out of range
  step(g, 90);
  const n = g.nanites;
  assert.equal(n.launched, 1);
  assert.equal(n.count, 1, 'the canister landed');
  const s = n.swarms[0];
  assert.equal(s.kind, SWARM_MAIN);
  assert.ok(Math.hypot(s.x - (p.x + 268), s.y - (p.y + 129)) < 40, `landed on the pack (${(s.x - p.x).toFixed(0)}, ${(s.y - p.y).toFixed(0)})`);
  // Nothing in range: no launch, and it keeps looking.
  const empty = freshPlayer();
  dummy(empty.g, empty.p.x + 2000, empty.p.y);
  step(empty.g, 120);
  assert.equal(empty.g.nanites.launched, 0);
});

test('every enemy inside any swarm takes one bite per tick (overlaps never stack), corrodes, and enemies outside take none', () => {
  const { g, p } = freshPlayer();
  const n = g.nanites;
  n.update(1 / 60, g); // read the build
  const e = dummy(g, p.x + 300, p.y);
  const far = dummy(g, p.x + 300, p.y + 400);
  n.launchT = 1e9;
  const a = n.addSwarm(e.x, e.y, 60, 10, SWARM_MAIN);
  const b = n.addSwarm(e.x + 10, e.y, 60, 10, SWARM_MAIN);
  a.age = b.age = 1;
  const by = tally(g);
  const hits = [];
  const hit = g.hitEnemy;
  g.hitEnemy = function (x, dmg, ...rest) { if (x === e) hits.push(dmg); return hit.call(this, x, dmg, ...rest); };
  n.tickT = 0;
  step(g, 60);
  const ticks = Math.round(1 / W.naniteTick(levelBuild('nanites', 1)));
  assert.ok(Math.abs(hits.length - ticks) <= 1, `${hits.length} bites in 1 s (${ticks} ticks)`);
  assert.ok(near(hits[0], weaponDamage(p, 'nanite')));
  assert.equal(far.hp, far.maxHp, 'outside every swarm: untouched');
  assert.ok(e.st.corrode > 0, 'bites corrode');
  assert.ok(by.nanite > 0);
});

test('kills grow the swarm (up to its cap); a swarm disperses at the end of its life', () => {
  const { g, p } = freshPlayer();
  const n = g.nanites;
  n.update(1 / 60, g);
  n.launchT = 1e9;
  const s = n.addSwarm(p.x + 300, p.y, 60, 3, SWARM_MAIN);
  s.age = 1;
  for (let k = 0; k < 20; k++) dummy(g, p.x + 300 + (k % 5) * 4, p.y + Math.floor(k / 5) * 4, 1);
  n.tickT = 0;
  step(g, 2);
  assert.ok(s.kills >= 10, `${s.kills} kills`);
  assert.equal(s.grow, W.naniteGrowMax, 'capped growth');
  assert.ok(n.kills >= 10);
  step(g, 60 * 2.5);
  assert.equal(n.count, 0, 'dispersed');
  // The radius swells in and shrinks to nothing as it disperses.
  const t = { age: 0, life: 4, radius: 60, grow: 1 };
  assert.ok(swarmRadius(t) < 60 && swarmRadius({ ...t, age: 2 }) === 60 && swarmRadius({ ...t, age: 4 }) === 0);
});

test('Fission Bloom: a main swarm buds daughters every few kills that fly to the next pack (nanite_fission damage)', () => {
  const { g, p } = freshPlayer({ bt: { 6: 'transform' } });
  const n = g.nanites;
  n.update(1 / 60, g);
  n.launchT = 1e9;
  const s = n.addSwarm(p.x + 200, p.y, 60, 10, SWARM_MAIN);
  s.age = 1;
  for (let k = 0; k < W.fissionKills; k++) dummy(g, p.x + 200 + k * 3, p.y, 1);
  for (let k = 0; k < 6; k++) dummy(g, p.x - 200 + (k % 3) * 15, p.y + Math.floor(k / 3) * 15); // the next pack
  const by = tally(g);
  n.tickT = 0;
  step(g, 90);
  assert.equal(s.buds, 1, 'one bud per fissionKills kills');
  const d = n.swarms.slice(0, n.count).find((x) => x.kind === SWARM_FISSION);
  assert.ok(d, 'a daughter landed');
  assert.ok(d.x < p.x, 'on the other pack');
  assert.ok(near(d.radius, s.radius * W.fissionRadiusMult, 0.1));
  assert.ok(by.nanite_fission > 0, 'daughters bite as nanite_fission');
  // No Breakthrough: no buds.
  const plain = freshPlayer();
  plain.g.nanites.update(1 / 60, plain.g);
  plain.g.nanites.launchT = 1e9;
  const q = plain.g.nanites.addSwarm(plain.p.x + 200, plain.p.y, 60, 10, SWARM_MAIN);
  q.age = 1;
  for (let k = 0; k < 8; k++) dummy(plain.g, plain.p.x + 200, plain.p.y, 1);
  plain.g.nanites.tickT = 0;
  step(plain.g, 30);
  assert.equal(q.buds, 0);
});

test('Gray Goo: kills keep the swarm alive longer and let it grow past the usual cap', () => {
  const { g, p } = freshPlayer({ bt: { 12: 'transform' } });
  const n = g.nanites;
  n.update(1 / 60, g);
  n.launchT = 1e9;
  const s = n.addSwarm(p.x + 300, p.y, 60, 3, SWARM_MAIN);
  s.age = 1;
  for (let k = 0; k < 40; k++) dummy(g, p.x + 300 + (k % 5) * 4, p.y + Math.floor(k / 5) * 4, 1);
  n.tickT = 0;
  step(g, 2);
  assert.ok(near(s.life, 3 + W.gooLifeMax), `life ${s.life}`);
  assert.ok(s.grow > W.naniteGrowMax && s.grow <= W.gooGrowMax);
});

test('Nanite Plague: a bitten enemy that dies to anything bursts into a plague swarm (nanite_plague damage)', () => {
  const { g, p } = freshPlayer({ bt: { 18: 'transform' } });
  const n = g.nanites;
  n.update(1 / 60, g);
  n.launchT = 1e9;
  const s = n.addSwarm(p.x + 300, p.y, 40, 0.6, SWARM_MAIN);
  s.age = 0.4;
  const e = dummy(g, p.x + 300, p.y);
  const neighbour = dummy(g, p.x + 420, p.y);
  n.tickT = 0;
  step(g, 1);
  assert.ok(e.naniteInfected > 0 && n.infected.includes(e), 'bitten: infected');
  step(g, 60);
  assert.equal(n.count, 0, 'the swarm is gone');
  // Another weapon kills it: the plague bursts out of the wreck.
  const by = tally(g);
  g.hitEnemy(e, 1e9, 'blaster');
  assert.ok(e.dead);
  neighbour.x = e.x + 10;
  step(g, 20);
  const plague = n.swarms.slice(0, n.count).find((x) => x.kind === SWARM_PLAGUE);
  assert.ok(plague, 'a plague swarm at the wreck');
  assert.ok(Math.hypot(plague.x - e.x, plague.y - e.y) < 20);
  assert.ok(by.nanite_plague > 0, 'it bites as nanite_plague');
  assert.equal(n.infected.includes(e), false, 'the dead are dropped');
  // Uninfected kills and kills without the Breakthrough spawn nothing.
  const plain = freshPlayer();
  plain.g.nanites.update(1 / 60, plain.g);
  plain.g.nanites.launchT = 1e9;
  const q = plain.g.nanites.addSwarm(plain.p.x + 300, plain.p.y, 40, 0.6, SWARM_MAIN);
  q.age = 0.4;
  const x = dummy(plain.g, plain.p.x + 300, plain.p.y);
  plain.g.nanites.tickT = 0;
  step(plain.g, 60);
  plain.g.hitEnemy(x, 1e9, 'blaster');
  step(plain.g, 20);
  assert.equal(plain.g.nanites.count, 0);
});

test('live fight: the swarm works on its own in the full game loop with every transform, and the pools stay bounded', (t) => {
  // Seeded, so the fight (launch picks, spawns, crits) plays out the same every run.
  let seed = 12345;
  t.mock.method(Math, 'random', () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648));
  const { g, p } = freshPlayer({ bt: { 6: 'transform', 12: 'transform', 18: 'transform' }, cards: [['nanites_launch', 6], ['nanites_duration', 6]] });
  const by = tally(g);
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r = 120 + (k % 6) * 50;
    dummy(g, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 400);
  }
  g.autoFire = true;
  g.autoAim = true;
  g.mouse = { x: 0, y: 0, down: false };
  let maxSwarms = 0;
  for (let i = 0; i < 60 * 20; i++) {
    g.state = 'PLAYING'; // skip level-up screens
    g.update(1 / 60);
    maxSwarms = Math.max(maxSwarms, g.nanites.count);
  }
  assert.ok(by.nanite > 0 && by.nanite_fission > 0 && by.nanite_plague > 0, `every part deals damage: ${JSON.stringify(Object.keys(by))}`);
  assert.ok(maxSwarms <= g.nanites.swarms.length && g.nanites.canCount <= g.nanites.canisters.length, 'pools never overflow');
  assert.ok(g.nanites.infected.length <= 96);
  g.resetRun();
  assert.equal(g.nanites.activeCount, 0, 'a new run clears every swarm');
  assert.equal(g.nanites.infected.length, 0);
});

test('drawing costs a fixed handful of paths however many swarms are out, and skips swarms off screen', () => {
  const counts = (swarms) => {
    const { g, p } = freshPlayer({ bt: { 18: 'transform' } });
    g.nanites.update(1 / 60, g);
    for (let i = 0; i < swarms; i++) g.nanites.addSwarm(p.x + (i % 6) * 40 - 100, p.y + Math.floor(i / 6) * 40 - 60, 60, 4, i % 3).age = 1;
    g.nanites.updateSwarms(0, g);
    g.camX = p.x - 640;
    g.camY = p.y - 360;
    g.width = 1280;
    g.height = 720;
    let fills = 0, strokes = 0;
    const ctx = new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'fill') return () => { fills++; };
        if (key === 'stroke') return () => { strokes++; };
        return () => {};
      },
      set(target, key, value) { target[key] = value; return true; }
    });
    g.nanites.drawGround(ctx, g);
    return { fills, strokes };
  };
  const few = counts(2);
  const many = counts(20);
  assert.deepEqual(many, few, 'paths do not grow with the swarm count');
  assert.ok(many.fills + many.strokes <= 6);
  const { g, p } = freshPlayer();
  g.nanites.update(1 / 60, g);
  g.nanites.addSwarm(p.x, p.y, 60, 4, SWARM_MAIN).age = 1;
  g.nanites.updateSwarms(0, g);
  g.camX = p.x + 5000;
  let arcs = 0, lines = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'arc' ? () => { arcs++; } : k === 'lineTo' ? () => { lines++; } : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.nanites.drawGround(ctx, g);
  assert.equal(arcs + lines, 0);
  assert.equal(new NaniteSwarm().drawGround(silent, g), undefined, 'an empty swarm draws nothing');
});

test('the swarm radius follows the AREA multiplier and Cloud Size cards', () => {
  const { p } = freshPlayer({ cards: [['nanites_radius', 3]] });
  assert.ok(near(naniteRadius(p), W.naniteRadius(makeBuild('nanites', 4, { radius: 3 })) * (p.stats.areaMult ?? 1)));
});
