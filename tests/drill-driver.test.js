import test from 'node:test';
import assert from 'node:assert/strict';

// Drill Driver (weapon id `harpoon`): a PRIMARY, KINETIC, aimed single-target weapon that launches the
// ship's own front drills on a cable and reels them back. Boring out and back, mining (breaks rock as the
// ship's own mining, bites into rock it can't finish, bedrock stops it), the five Breakthroughs, the card
// previews, and the two promises: no enemy is ever moved toward the ship, and the weapon adds no contact hits.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, rateStep, POTENTIAL_DPS, WEAPON_TAGS, WEAPON_CLASS, SOURCE_WEAPON, weaponDamage } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, TRANSFORMS, EXTRA_TRANSFORMS, ELEMENT_CARDS, BREAKTHROUGH_LEVELS, BT_TRANSFORM_DPS, makeBuild, weaponBuild } = await import('../js/weapon-levels.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, WEAPONS } = await import('../js/loadout.js');
const { describeWeaponPick, describeUpgrade, describeBreakthrough } = await import('../js/upgrade-cards.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { buildSourceGroups } = await import('../js/run-stats.js');
const { PIXIE_WEAPON_LINES } = await import('../js/pixie.js');
const { DrillDriver } = await import('../js/drill-driver.js');

const DT = 1 / 60;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const ALL_TRANSFORMS = ['twin', 'spin', 'chain', 'detonate', 'tunnel'];

// A headless game with only the Drill Driver equipped, aiming along +x, no rocks unless a test adds them.
function drillGame({ cards = [], bt = {}, foes = [] } = {}) {
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
  g.hitEnemy = function (e, dmg, source, kx = 0, ky = 0, flash, stat = source) {
    bySource[stat] = (bySource[stat] || 0) + dmg;
    hits.push({ e, dmg, stat, kx, ky, x: e.x, y: e.y });
    return hit.call(this, e, dmg, source, kx, ky, flash, stat);
  };
  return { g, p, bySource, hits, foes: foesOut, drill: g.drillDriver };
}

function addFoe(g, { x, y = 0, hp = 1e7, ...extra }) {
  const p = g.player;
  const e = g.enemyManager.getArchetype('swarmer', 1);
  Object.assign(e, { x: p.x + x, y: p.y + y, vx: 0, vy: 0, speed: 0, hp, maxHp: hp, trail: e.trail || [] }, extra);
  g.enemyManager.enemies.push(e);
  return e;
}

// Step only the Drill Driver, like Game.update does each tick.
const tick = (g, n = 1, firing = true) => { for (let i = 0; i < n; i++) g.drillDriver.update(DT, g, firing); };
// Pull the trigger for one tick, then let that throw play out (out, spin, ricochets, a lodged blast, back, dock).
const oneShot = (g) => { tick(g, 1); tick(g, 150, false); };
// Breakthroughs that install one transform by id, at its home milestone (earlier ones Across the Board).
function btWith(id) {
  const home = Object.entries(TRANSFORMS.harpoon).find(([, t]) => t.id === id)?.[0] ?? EXTRA_TRANSFORMS.harpoon.find((t) => t.id === id).home;
  const bt = {};
  for (const m of BREAKTHROUGH_LEVELS) if (m <= Number(home)) bt[m] = m === Number(home) ? id : 'boost';
  return bt;
}

test('Drill Driver is a PRIMARY, KINETIC, aimed slot weapon with five single-stat cards (id harpoon kept)', () => {
  const w = WEAPON_BY_ID.harpoon;
  assert.equal(w.name, 'Drill Driver');
  assert.equal(w.category, 'PRIMARY');
  assert.deepEqual(w.tagSources, ['harpoon']);
  assert.deepEqual(WEAPON_TAGS.harpoon, ['projectile', 'kinetic']);
  assert.equal(SOURCE_WEAPON.harpoon, 'harpoon');
  assert.equal(WEAPON_CLASS.harpoon, 'aimed');
  assert.ok(DAMAGE_SOURCE_COLORS.harpoon);
  const groups = buildSourceGroups(WEAPONS);
  for (const stat of ['harpoon', 'harpoonreel', 'harpoonspin', 'harpoonchain', 'harpoonblast', 'harpoontunnel']) assert.equal(groups[stat], 'harpoon', stat);
  assert.deepEqual(STAT_CARDS.harpoon.map((c) => c.stat), ['damage', 'rate', 'range', 'pierce', 'drill']);
  assert.deepEqual(STAT_CARDS.harpoon.map((c) => POWER_STATS.has(c.stat)), [true, true, false, false, false]);
  assert.equal(ELEMENT_CARDS.harpoon, undefined);
  for (const c of STAT_CARDS.harpoon) assert.match(c.summary, /^Drill Driver:/);
  for (const m of BREAKTHROUGH_LEVELS) assert.match(TRANSFORMS.harpoon[m].summary, /Drill Driver/);
  assert.deepEqual([...BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS.harpoon[m].id), ...EXTRA_TRANSFORMS.harpoon.map((t) => t.id)], ALL_TRANSFORMS);
  assert.ok(UPGRADE_BY_ID.harpoon?.isCore);
});

test('no claws, harpoons, hooks or yanks in anything the player reads about the Drill Driver', () => {
  const texts = [
    WEAPON_BY_ID.harpoon.name, WEAPON_BY_ID.harpoon.hudName, UPGRADE_BY_ID.harpoon.summary, WEAPON_BY_ID.harpoon.summary,
    ...STAT_CARDS.harpoon.flatMap((c) => [c.name, c.summary]),
    ...BREAKTHROUGH_LEVELS.flatMap((m) => [TRANSFORMS.harpoon[m].name, TRANSFORMS.harpoon[m].summary]),
    ...EXTRA_TRANSFORMS.harpoon.flatMap((t) => [t.name, t.summary]),
    ...PIXIE_WEAPON_LINES.harpoon.map(([line]) => line)
  ];
  for (const t of texts) assert.doesNotMatch(t, /claw|harpoon|yank|hook|grapple|crush/i, t);
});

test('the ship launches its own drills, arms taking turns, one per cycle; they leave the arm and dock again', () => {
  const { g, p, drill } = drillGame({ foes: [{ x: 200 }] });
  tick(g, 30, false);
  assert.equal(drill.shots, 0, 'no trigger, no throw');
  tick(g, 1);
  assert.equal(drill.shots, 1);
  assert.deepEqual(p.drillOut, [true, false], 'the port drill left its arm (the renderer hides it there)');
  const b = weaponBuild(p, 'harpoon');
  const cycle = Math.ceil(W.harpoonCooldown(b) / DT);
  tick(g, cycle - 3);
  assert.equal(drill.shots, 1, 'one throw per cycle');
  tick(g, 4);
  assert.equal(drill.shots, 2);
  assert.deepEqual(p.drillOut, [true, true], 'the starboard drill took the next turn');
  tick(g, 2 * cycle, false);
  assert.ok(drill.docks >= 2, 'both drills reeled home');
  assert.deepEqual(p.drillOut, [false, false]);
  const fast = makeBuild('harpoon', 4, { rate: 3 });
  assert.ok(near(W.harpoonCooldown(fast), W.harpoonCooldown(b) / (1 + rateStep('harpoon') * 3)));
  assert.ok(near(rateStep('harpoon'), rateStep('blaster') * 1.3), 'Winch Motor ranks are 1.3x the Autocannon\'s rate steps');
  assert.ok(W.harpoonOutShare + W.harpoonBackShare < 2 && W.twinOutShare + W.twinBackShare < 1, 'each drill is home before its next turn');
});

test('a drill bores every enemy on its line on the way out AND on the way back, out to its reach', () => {
  const b1 = makeBuild('harpoon', 1);
  const reach = W.harpoonRange(b1);
  const { g, p, hits, foes, drill } = drillGame({ foes: [{ x: 100 }, { x: 180 }, { x: 260 }, { x: reach + 120 }, { x: 150, y: 90 }] });
  oneShot(g);
  const dmg = weaponDamage(p, 'harpoon');
  const keep = W.harpoonPierceKeep(b1);
  const outHits = hits.filter((x) => x.stat === 'harpoon');
  const backHits = hits.filter((x) => x.stat === 'harpoonreel');
  assert.deepEqual(outHits.map((x) => foes.indexOf(x.e)), [0, 1, 2], 'line order on the way out, nothing past reach or off the line');
  assert.deepEqual(backHits.map((x) => foes.indexOf(x.e)), [2, 1, 0], 'and again, far to near, on the way back');
  assert.ok(near(outHits[0].dmg, dmg) && near(outHits[1].dmg, dmg * keep) && near(outHits[2].dmg, dmg * keep ** 2));
  assert.ok(near(backHits[0].dmg, dmg * W.reelShare));
  assert.equal(drill.docks, 1, 'and it docks');
  assert.ok(near(W.harpoonPierceKeep(makeBuild('harpoon', 3, { pierce: 2 })), keep + 0.1));
  assert.equal(W.harpoonPierceKeep(makeBuild('harpoon', 6, { pierce: 5 })), 1);
});

test('mining: rock a drill breaks counts as your mining and it flies on; rock it cannot finish stops it; bedrock is untouched', () => {
  const { g, p, drill, foes, hits } = drillGame({ foes: [{ x: 260 }] });
  const am = g.asteroidManager;
  const rock = am.makeRock(p.x + 140, p.y, 16, 'rock');
  rock.hp = rock.maxHp = 60;
  am.rebuildSpatialHash();
  const mined = g.rocksMined;
  oneShot(g);
  assert.ok(!am.asteroids.includes(rock), 'the rock broke');
  assert.equal(g.rocksMined, mined + 1, 'counted as rocks mined');
  assert.equal(drill.rocksBroken, 1);
  assert.ok(hits.some((x) => x.stat === 'harpoon' && x.e === foes[0]), 'and the drill flew on to the enemy behind it');

  const budget = W.harpoonDrill(weaponBuild(p, 'harpoon'));
  const tough = drillGame({ foes: [{ x: 260 }] });
  const big = tough.g.asteroidManager.makeRock(tough.p.x + 140, tough.p.y, 16, 'rock');
  big.hp = big.maxHp = budget + 50;
  tough.g.asteroidManager.rebuildSpatialHash();
  oneShot(tough.g);
  assert.ok(near(big.hp, 50, 1e-6), 'the drill budget comes off the rock');
  assert.equal(tough.foes[0].hp, tough.foes[0].maxHp, 'the drill bit in and stopped');
  assert.equal(tough.drill.docks, 1, 'then reeled home');

  const bed = drillGame({ foes: [{ x: 260 }] });
  const wall = bed.g.asteroidManager.addBedrock(bed.p.x + 140, bed.p.y, 20);
  bed.g.asteroidManager.rebuildSpatialHash();
  oneShot(bed.g);
  assert.equal(wall.hp, wall.maxHp, 'bedrock never breaks');
  assert.equal(bed.foes[0].hp, bed.foes[0].maxHp, 'bedrock stops the drill');

  assert.ok(near(W.harpoonDrill(makeBuild('harpoon', 3, { drill: 2 })), budget * 2.2));
});

test('Breakthroughs: each adds exactly BT_TRANSFORM_DPS, wherever it is taken', () => {
  for (const id of ALL_TRANSFORMS) {
    for (const m of BREAKTHROUGH_LEVELS) {
      const plain = POTENTIAL_DPS.harpoon(makeBuild('harpoon', m, { damage: 2 }));
      const t = POTENTIAL_DPS.harpoon(makeBuild('harpoon', m, { damage: 2 }, { [m]: id }));
      assert.ok(near(t, plain * BT_TRANSFORM_DPS, 1e-6), `${id} at LV ${m}`);
    }
  }
});

test('Twin Drills launch both drills; Drill Spin grinds where the drill stops; Ricochet Bits bounce before the reel', () => {
  const reach = W.harpoonRange(makeBuild('harpoon', 1));
  const twin = drillGame({ bt: btWith('twin'), foes: [{ x: 300, y: 300 * Math.tan(W.twinSpread / 2) + 12 }, { x: 300, y: -300 * Math.tan(W.twinSpread / 2) - 12 }] });
  tick(twin.g, 1);
  assert.deepEqual(twin.p.drillOut, [true, true], 'both drills left the arms');
  tick(twin.g, 90, false);
  assert.deepEqual(new Set(twin.hits.filter((x) => x.stat === 'harpoon').map((x) => twin.foes.indexOf(x.e))), new Set([0, 1]));
  assert.equal(twin.drill.docks, 2);
  const spin = drillGame({ bt: btWith('spin'), foes: [{ x: reach + 30, y: 30 }] });
  oneShot(spin.g);
  assert.equal(spin.hits.filter((x) => x.stat === 'harpoonspin').length, W.spinTicks);
  const chain = drillGame({ bt: btWith('chain'), foes: [100, 160, 220, 280].map((y) => ({ x: reach - 40, y })) });
  oneShot(chain.g);
  assert.equal(chain.hits.filter((x) => x.stat === 'harpoonchain').length, W.chainLeaps);
  assert.equal(chain.drill.docks, 1, 'then it reels in');
});

test('Detonator Bit screws into the first enemy that survives it, blows, then reels in; Tunnel Bore keeps cutting its line', () => {
  const det = drillGame({ bt: btWith('detonate'), foes: [{ x: 120 }, { x: 140, y: 40 }, { x: 220 }] });
  tick(det.g, 1);
  tick(det.g, Math.ceil(0.15 / DT), false);
  const d = det.drill.drills[0];
  assert.equal(d.phase, 'lodge');
  assert.equal(d.lodged, det.foes[0], 'it rides in the enemy it bored');
  tick(det.g, Math.ceil(W.detDelay / DT) + 2, false);
  const blast = det.hits.filter((x) => x.stat === 'harpoonblast');
  assert.deepEqual(new Set(blast.map((x) => det.foes.indexOf(x.e))), new Set([0, 1]), 'the blast catches the one beside it too');
  assert.equal(det.hits.filter((x) => x.stat === 'harpoon' && x.e === det.foes[2]).length, 0, 'a lodged drill bores no further out');
  assert.equal(det.drill.blasts, 1);
  tick(det.g, 90, false);
  assert.equal(det.drill.docks, 1, 'then it reels home');

  const reach = W.harpoonRange(makeBuild('harpoon', 1));
  const tun = drillGame({ bt: btWith('tunnel') });
  tick(tun.g, 1);
  const b = weaponBuild(tun.p, 'harpoon');
  tick(tun.g, Math.ceil(W.harpoonCooldown(b) * W.harpoonOutShare / DT) + 2, false);
  assert.equal(tun.drill.tunnels.length, 1, 'the throw leaves its bore');
  const crosser = addFoe(tun.g, { x: reach / 2, y: 70 });
  crosser.y = tun.p.y + 6;
  tick(tun.g, Math.ceil(W.tunnelLife / DT) + 2, false);
  const cuts = tun.hits.filter((x) => x.stat === 'harpoontunnel' && x.e === crosser);
  assert.ok(cuts.length >= 3, `the bore keeps cutting (${cuts.length} ticks)`);
  assert.equal(tun.drill.tunnels.length, 0, 'and closes after tunnelLife');
});

test('no enemy is ever moved toward the ship: the weapon never moves enemies, and every knock points away', () => {
  const foes = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const r = 28 + (k % 4) * 60;
    foes.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  for (const bt of [...ALL_TRANSFORMS.map(btWith), { 6: 'twin', 12: 'detonate', 18: 'chain' }, { 6: 'tunnel', 12: 'spin', 18: 'transform' }]) {
    const s = drillGame({ bt, foes });
    const p = s.p;
    for (let i = 0; i < 300; i++) {
      p.angle = (i / 300) * Math.PI * 4; // sweep the aim round so drills fly everywhere
      const before = s.foes.map((e) => [e.x, e.y]);
      tick(s.g, 1);
      s.foes.forEach((e, j) => assert.ok(e.x === before[j][0] && e.y === before[j][1], 'the Drill Driver itself never moves an enemy'));
    }
    assert.ok(s.hits.length > 20, `the drills hit (${JSON.stringify(bt)})`);
    assert.ok(s.hits.some((x) => x.stat === 'harpoonreel'), 'including on the way back');
    for (const x of s.hits) {
      const dot = (x.x - p.x) * x.kx + (x.y - p.y) * x.ky;
      assert.ok(dot >= -1e-9, `${x.stat} knock points away from the ship (${JSON.stringify(bt)})`);
    }
  }
});

test('no new contact hits: a swarm closing on the ship lands no more hits with the Drill Driver than without it', () => {
  const contacts = (armed) => {
    const rnd = Math.random;
    Math.random = h.seededRandom('drill-contact'); // the same swarm both times
    try {
      const g = h.createHeadlessGame();
      g.resetRun();
      g.state = 'PLAYING';
      const p = g.player;
      if (armed) {
        acquireWeapon(p, 'harpoon');
        p.breakthroughs = { harpoon: { 6: 'twin', 12: 'detonate', 18: 'chain' } };
      }
      p.loadout = armed ? ['harpoon'] : [];
      p.weapons.blaster = 0;
      g.asteroidManager.asteroids = [];
      g.asteroidManager.rebuildSpatialHash();
      g.enemyManager.enemies.length = 0;
      g.enemyManager.spawnTimer = 1e9;
      g.autoFire = true;
      g.autoAim = true;
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        const e = g.enemyManager.getArchetype('swarmer', 1);
        Object.assign(e, { x: p.x + Math.cos(a) * 260, y: p.y + Math.sin(a) * 260, hp: 1e9, maxHp: 1e9, trail: e.trail || [] });
        g.enemyManager.enemies.push(e);
      }
      let n = 0;
      const dmg = g.damagePlayer;
      g.damagePlayer = function (...args) { n++; return dmg.apply(this, args); };
      for (let i = 0; i < 60 * 5; i++) {
        p.hp = p.maxHp;
        p.shield = p.maxShield;
        g.update(DT);
        g.state = 'PLAYING';
      }
      return n;
    } finally {
      Math.random = rnd;
    }
  };
  const without = contacts(false);
  const withDrill = contacts(true);
  assert.ok(without > 0, `the swarm reaches the ship (${without} hits)`);
  assert.ok(withDrill <= without, `with the Drill Driver ${withDrill} contact hits, without ${without}`);
});

test('cards preview the Drill Driver: the pick leads with its reach; stat and Breakthrough cards show their rows', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const pick = describeWeaponPick(g.player, 'harpoon');
  assert.equal(pick.name, 'Drill Driver');
  assert.ok(pick.rows.some((r) => r.id === 'harpoonRange' && r.after === String(W.harpoonRange(makeBuild('harpoon', 1)))));
  acquireWeapon(g.player, 'harpoon');
  for (const id of ['harpoon_damage', 'harpoon_rate', 'harpoon_range', 'harpoon_pierce', 'harpoon_drill']) {
    const card = describeUpgrade(g.player, { ...UPGRADE_BY_ID[id], levelJump: 1 });
    assert.equal(card.toLevel, 2, id);
    assert.ok(card.rows.some((r) => r.id === UPGRADE_BY_ID[id].headline), `${id} shows its stat`);
  }
  const rows = { twin: 'harpoonTwin', spin: 'harpoonSpin', chain: 'harpoonChain', detonate: 'harpoonBlast', tunnel: 'harpoonTunnel' };
  for (const id of ALL_TRANSFORMS) {
    const m = Object.keys(btWith(id)).map(Number).pop();
    const card = describeBreakthrough(g.player, 'harpoon', m, id);
    assert.equal(card.category, 'DRILL DRIVER');
    assert.ok(card.rows.some((r) => r.id === rows[id]), `${id} row`);
  }
  assert.ok(g.drillDriver instanceof DrillDriver, 'the game owns one, reset with the run');
});

test('a live fight: the Drill Driver deals damage through the normal game loop', () => {
  const { g, p, bySource } = drillGame();
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
  assert.ok(bySource.harpoon > 0 && bySource.harpoonreel > 0);
});
