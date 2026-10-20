import test from 'node:test';
import assert from 'node:assert/strict';

// Cryo Sprayer (FROST) and Acid Sprayer (CORROSIVE): the Flamethrower's twins. Same spinning cone and
// numbers (js/flamethrower.js with a SPRAY_KINDS kind), their own weapon, damage source, cards, puddles,
// ring and sound. The headless harness stubs the browser, so the real loadout, cards and statuses run.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, discardWeapon, eligibleUpgrades, ownedElements } = await import('../js/upgrades.js');
const { WEAPONS, WEAPON_BY_ID, weaponTags } = await import('../js/loadout.js');
const { STAT_CARDS, TRANSFORMS, FIXED_ELEMENTS, weaponElement, weaponBuild, makeBuild, flameBurnRank } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, WEAPON_TAGS, TAG_INFO, SOURCE_WEAPON, sourceElement, weaponDamage } = await import('../js/weapon-scaling.js');
const { describeUpgrade, describeWeaponPick } = await import('../js/upgrade-cards.js');
const { Flamethrower, SPRAY_KINDS } = await import('../js/flamethrower.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { applyOnHitStatuses, damageTakenMult } = await import('../js/status-effects.js');

const silent = new Proxy({}, { get: () => () => {} });
const near = (a, b, tol = 1e-9) => Math.abs(a / b - 1) < tol;
const SPRAYERS = { cryospray: { source: 'cryo', element: 'frost', card: 'cryospray_chill', look: 'frost', burst: 'shatter' }, acidspray: { source: 'acid', element: 'corrode', card: 'acidspray_etch', look: 'corrode', burst: 'meltdown' } };

function sprayPlayer(id, { cards = [], bt = {} } = {}) {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  discardWeapon(p, 'blaster');
  acquireWeapon(p, id);
  for (const [cid, lv] of cards) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[cid], levelJump: lv });
  p.breakthroughs = { [id]: bt };
  Object.assign(p, { x: 1000, y: 1000, vx: 0, vy: 0, angle: 0 });
  return p;
}

function rig(p, kind, enemies) {
  const hits = [];
  const roar = [];
  const blasts = [];
  const game = {
    player: p, enemyManager: { enemies }, particles: silent, camX: 0, camY: 0, width: 4200, height: 4200,
    asteroidManager: { getNearbyAsteroids: () => [], cellsFor: () => 3 },
    sound: { setFlameRoar: (v, k) => roar.push([v, k]), playFlameBurst() {} },
    weaponFx: { pools: [], addPool(x) { this.pools.push(x); } },
    hitEnemy(e, dmg, source) { hits.push({ e, dmg, source }); applyOnHitStatuses(p, e, source, dmg); },
    damageEnemiesInRadius(x, y, radius, dmg, hue, source, knock) { blasts.push({ x, y, radius, dmg, source, knock }); }
  };
  const ft = new Flamethrower(kind);
  ft.swing = function (pl) { if (this.swivel === null) this.swivel = pl.angle; }; // hold the nozzle east
  return { game, hits, roar, blasts, ft };
}
const enemy = (p, dx, dy) => ({ type: 'swarmer', x: p.x + dx, y: p.y + dy, radius: 10, hp: 1e6, maxHp: 1e6 });
const run = (r, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) r.ft.update(1 / 60, r.game, true); };

test('two new PRIMARY weapons with their own source, tags, colour, run-stats group and seven cards', () => {
  const groups = buildSourceGroups(WEAPONS);
  for (const [id, s] of Object.entries(SPRAYERS)) {
    const w = WEAPON_BY_ID[id];
    assert.equal(w.category, 'PRIMARY');
    assert.deepEqual(w.tagSources, [s.source]);
    assert.equal(SOURCE_WEAPON[s.source], id);
    assert.equal(groups[s.source], id);
    assert.equal(groups[`corrode_${id}`], id, 'its DoT ticks count as its damage');
    assert.ok(DAMAGE_SOURCE_COLORS[s.source]);
    for (const t of WEAPON_TAGS[s.source]) assert.ok(TAG_INFO[t], t);
    assert.ok(weaponTags(id).includes('area'));
    assert.equal(STAT_CARDS[id].length, 7);
    assert.ok(STAT_CARDS[id].some((c) => c.stat === 'nozzles'), 'an Extra Nozzle card');
    assert.equal(groups[s.burst], id, 'its LV 6 burst counts as its damage');
    assert.equal(SPRAY_KINDS[id].source, s.source);
    for (const m of [6, 12, 18]) assert.ok(TRANSFORMS[id][m].summary.includes(w.name));
    assert.equal(describeWeaponPick(sprayPlayer('blaster'), id).headline, w.name.toUpperCase());
  }
});

test('built-in elements: FROST and CORROSIVE, ranked by Deep Freeze / Etching Agent; STATUS cards unlock', () => {
  for (const [id, s] of Object.entries(SPRAYERS)) {
    assert.equal(FIXED_ELEMENTS[id], s.element);
    const p = sprayPlayer(id);
    assert.deepEqual(weaponElement(p, id), { element: s.element, rank: 1, fixed: true });
    assert.equal(sourceElement(p, s.source), s.element);
    assert.ok(ownedElements(p).has(s.element));
    const offered = new Set(eligibleUpgrades(p).map((u) => u.id));
    assert.ok(offered.has('status_potency') && offered.has(`${s.element}_damage`));
    assert.ok(![...offered].some((u) => UPGRADE_BY_ID[u].elementCard), 'never an element card');
    applyUpgradeLevels(p, { ...UPGRADE_BY_ID[s.card], levelJump: 2 });
    assert.equal(weaponElement(p, id).rank, 3);
    assert.equal(flameBurnRank(weaponBuild(p, id)), 3, 'the build rank matches');
    const card = describeUpgrade(p, { ...UPGRADE_BY_ID[s.card], levelJump: 1 });
    assert.ok(card.rows.some((r) => r.id.startsWith(`${id}:`)), `${s.card} previews its status`);
    discardWeapon(p, id);
    assert.equal(weaponElement(p, id), null);
  }
});

test('same potential as the Flamethrower at every level and Breakthrough mix', () => {
  for (const id of Object.keys(SPRAYERS)) {
    for (const bt of [{}, { 6: 'transform' }, { 6: 'transform', 12: 'transform', 18: 'boost' }]) {
      const ranks = { damage: 3, rate: 2, range: 1 };
      assert.ok(near(POTENTIAL_DPS[id](makeBuild(id, 12, ranks, bt)), POTENTIAL_DPS.flamethrower(makeBuild('flamethrower', 12, ranks, bt))));
    }
    assert.ok(near(POTENTIAL_DPS[id](makeBuild(id, 1)), DPS_TARGET(1)));
  }
});

test('the cone chills and freezes (Cryo) or corrodes (Acid) what it sprays, with its own loop sound', () => {
  const cp = sprayPlayer('cryospray');
  const close = enemy(cp, 60, 0);
  close.maxHp = close.hp = 60; // a light hull freezes fast
  const behind = enemy(cp, -80, 0);
  const cr = rig(cp, 'cryospray', [close, behind]);
  run(cr, 1);
  assert.ok(cr.hits.every((x) => x.source === 'cryo'));
  assert.ok(close.st.frozenT > 0 || close.st.freezeImmT > 0 || close.st.cold > 0, 'the sprayed hull chills');
  assert.equal(behind.st, undefined, 'nothing behind the nozzle');
  assert.deepEqual(cr.roar[0], [1, 'cryo']);

  const ap = sprayPlayer('acidspray');
  const target = enemy(ap, 80, 0);
  const ar = rig(ap, 'acidspray', [target]);
  run(ar, 1);
  assert.ok(ar.hits.every((x) => x.source === 'acid'));
  assert.ok(target.st.corrode > 0 && damageTakenMult(target) > 1, 'corroded');
  assert.equal(target.st.corrodeStat, 'corrode_acidspray');
  assert.ok(ar.hits[0].dmg > 0 && ar.hits[0].dmg <= weaponDamage(ap, 'acid'), 'hits at its own damage (less toward the tip)');
  assert.deepEqual(ar.roar[0], [1, 'acid']);
});

test('LV 12 puddles take the element look and source; LV 18 rings use the sprayer source', () => {
  for (const [id, s] of Object.entries(SPRAYERS)) {
    const p = sprayPlayer(id, { bt: { 12: 'transform', 18: 'transform' } });
    const r = rig(p, id, [enemy(p, 100, 0)]);
    run(r, W.flameRingEvery + 1.3);
    assert.ok(r.game.weaponFx.pools.length >= 3);
    for (const pool of r.game.weaponFx.pools) {
      assert.equal(pool.source, s.source);
      assert.equal(pool.look, s.look);
    }
    assert.equal(r.blasts.length, 2);
    assert.ok(r.blasts.every((b) => b.source === s.source));
  }
});

test('three sprayers run side by side in a live game without errors', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  for (const id of ['flamethrower', 'cryospray', 'acidspray']) acquireWeapon(p, id);
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const e = g.enemyManager.getArchetype('swarmer', 1);
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * (40 + (k % 3) * 30), y: p.y + Math.sin(a) * (40 + (k % 3) * 30),
      vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  for (let i = 0; i < 60 * 8; i++) g.update(1 / 60);
  assert.ok(g.cryoSprayer.scorches > 0 && g.acidSprayer.scorches > 0, 'both new sprayers fired');
  const es = g.enemyManager.enemies;
  assert.ok(es.some((e) => e.st && (e.st.cold > 0 || e.st.frozenT > 0 || e.st.freezeImmT > 0)), 'something got cold');
  assert.ok(es.some((e) => e.st && e.st.corrode > 0), 'something corroded');
  assert.ok(es.some((e) => e.st && e.st.burn > 0), 'something burns');
});

test('Shatter: a FROZEN enemy the Cryo Sprayer hits bursts in ice shards, at most once per burst cooldown', () => {
  const p = sprayPlayer('cryospray', { bt: { 6: 'transform' } });
  const frozen = enemy(p, 80, 0);
  frozen.st = { tickT: 0, stamp: -1, burn: 0, cold: 0, coldMax: 1, coldRank: 0, slow: 1, frozenT: 5, frozenMax: 5, freezeImmT: 0,
    corrode: 0, corrodeCap: 0, shock: 0, shockRank: 0, stunT: 0, stunMax: 0, stunLong: false, stunImmT: 0 };
  const plain = enemy(p, 150, 0);
  const r = rig(p, 'cryospray', [frozen, plain]);
  r.ft.burstT = 0;
  run(r, 0.4);
  const shatters = r.blasts.filter((b) => b.source === 'cryo');
  assert.equal(shatters.length, 1, 'one shatter within the cooldown');
  assert.ok(Math.abs(shatters[0].x - frozen.x) < 1e-9, 'centred on the frozen enemy');
  const b = weaponBuild(p, 'cryospray');
  assert.ok(near(shatters[0].dmg, weaponDamage(p, 'cryo') / W.flameDamageMult(b) * W.flameBurstDamageMult(b)));
  // No Breakthrough, no shatter.
  const q = sprayPlayer('cryospray');
  const f2 = enemy(q, 80, 0);
  f2.st = { ...frozen.st };
  const rq = rig(q, 'cryospray', [f2]);
  rq.ft.burstT = 0;
  run(rq, 0.4);
  assert.equal(rq.blasts.length, 0);
});

test('Meltdown: a corroded enemy the Acid Sprayer kills splashes acid; an uncorroded kill does not', () => {
  const p = sprayPlayer('acidspray', { bt: { 6: 'transform' } });
  const weak = enemy(p, 80, 0);
  const r = rig(p, 'acidspray', [weak]);
  // The rig's hitEnemy only records: let hits take hp and flag kills like Game.hitEnemy.
  const record = r.game.hitEnemy;
  r.game.hitEnemy = (e, dmg, source) => { record(e, dmg, source); e.hp -= dmg; if (e.hp <= 0) e.dead = true; };
  run(r, 0.2);
  assert.ok(weak.st?.corrode > 0, 'corroded by the spray');
  weak.hp = 1; // the next scorch kills it
  r.ft.burstT = 0;
  run(r, 0.3);
  const splashes = r.blasts.filter((b) => b.source === 'acid');
  assert.equal(splashes.length, 1, 'one acid splash where it died');
  assert.ok(Math.abs(splashes[0].x - weak.x) < 1e-9);
  const clean = enemy(p, 80, 0);
  clean.hp = 1;
  const r2 = rig(p, 'acidspray', [clean]);
  r2.game.hitEnemy = (e, dmg) => { e.hp -= dmg; if (e.hp <= 0) e.dead = true; }; // no statuses: never corroded
  r2.ft.burstT = 0;
  run(r2, 0.3);
  assert.equal(r2.blasts.length, 0, 'no corrosion, no meltdown');
});
