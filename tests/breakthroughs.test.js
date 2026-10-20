import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon Breakthroughs at LV 4 / 8 / 12: when they trigger, what they record, and that every transform
// actually runs in the live game (damage dealt, nothing thrown).
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, pendingBreakthroughs, applyBreakthrough, discardWeapon } = await import('../js/upgrades.js');
const { STAT_CARDS, TRANSFORMS, milestonesCrossed, rdLine, RD_LINES, BREAKTHROUGH_LEVELS } = await import('../js/weapon-levels.js');
const { describeBreakthrough } = await import('../js/upgrade-cards.js');

function freshGame() {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  return g;
}

test('milestones are crossed once each, even when a rolled jump leaps over one', () => {
  assert.deepEqual(milestonesCrossed(5, 6), [6]);
  assert.deepEqual(milestonesCrossed(5, 8), [6]);
  assert.deepEqual(milestonesCrossed(11, 18), [12, 18]);
  assert.deepEqual(milestonesCrossed(6, 11), []);
  assert.deepEqual(BREAKTHROUGH_LEVELS, [6, 12, 18]);
});

test('a +5 card that leaps past LV 6 and LV 12 queues both Breakthroughs, lowest first', () => {
  const g = freshGame();
  const p = g.player;
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.blaster_damage, levelJump: 5 }); // LV 6
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.multishot, levelJump: 1 });      // LV 7
  p.breakthroughs = {};
  p.breakthroughsOffered = {};
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.firerate, levelJump: 5 });      // LV 12
  assert.deepEqual(pendingBreakthroughs(p, 'blaster'), [6, 12]);
  g.state = 'UPGRADE';
  g.closeUpgradeModal();
  assert.equal(g.handPhase, 'breakthrough');
  assert.deepEqual(g.breakthrough, { weaponId: 'blaster', level: 6 });
  g.selectUpgrade(1); // ACROSS THE BOARD
  assert.equal(g.handPhase, 'breakthrough', 'the LV 12 Breakthrough follows at once');
  assert.deepEqual(g.breakthrough, { weaponId: 'blaster', level: 12 });
  g.selectUpgrade(0);
  assert.deepEqual(p.breakthroughs.blaster, { 6: 'boost', 12: 'transform' });
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(pendingBreakthroughs(p, 'blaster'), []);
});

test('Breakthrough cards name their weapon, show the DPS gain, and are one-shot', () => {
  const p = freshGame().player;
  acquireWeapon(p, 'singularity');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.singularity_pull, levelJump: 3 });
  const t = describeBreakthrough(p, 'singularity', 6, 'transform');
  const b = describeBreakthrough(p, 'singularity', 6, 'boost');
  assert.equal(t.name, 'Twin Singularities');
  assert.equal(t.category, 'VORTEX SINGULARITY');
  assert.match(t.summary, /Vortex Singularity/);
  assert.match(t.headline, /\+22% DPS/);
  assert.match(b.summary, /Vortex Singularity/);
  assert.ok(Math.abs(b.dpsGain - 0.18) < 1e-6, 'Across the Board: +18% damage, plus utility ranks');
  assert.equal(applyBreakthrough(p, 'singularity', 6, 'transform'), true);
  assert.equal(applyBreakthrough(p, 'singularity', 6, 'boost'), false, 'one choice per milestone');
  discardWeapon(p, 'singularity');
  assert.equal(p.breakthroughs.singularity, undefined, 'a discard drops its Breakthroughs');
});

test('every transform names its weapon in the summary', () => {
  const NAMES = { blaster: 'Autocannon', rockets: 'Rocket Pod', missiles: 'Swarm Missile', lightning: 'Tesla Arc', singularity: 'Vortex Singularit',
    orbitals: 'Orbit Blade', mines: 'Proximity Mines', turret: 'Sentry Turret', drones: 'Escort Drone', grenades: 'Plasma Grenade', gas: 'Corrosive Gas Trail',
    flamethrower: 'Flamethrower',
    cryospray: 'Cryo Sprayer', acidspray: 'Acid Sprayer',
    shockfield: 'Electric Shield Field' };
  for (const id of Object.keys(TRANSFORMS)) assert.ok(NAMES[id], `${id} needs a name to check`);
  for (const [id, byLevel] of Object.entries(TRANSFORMS)) {
    for (const m of BREAKTHROUGH_LEVELS) assert.match(byLevel[m].summary, new RegExp(NAMES[id]), `${id} LV ${m}`);
  }
  assert.equal(rdLine(0, 'Tesla Arc Emitter').includes('Tesla Arc Emitter'), true);
  assert.equal(rdLine(-1, 'X'), RD_LINES.at(-1).replace('{weapon}', 'X'));
});

test('every weapon runs with all three transforms in a live fight, dealing damage without errors', () => {
  for (const id of Object.keys(STAT_CARDS)) {
    const g = freshGame();
    const p = g.player;
    p.invuln = 1e9;
    p.hp = p.maxHp = 1e9;
    if (id !== 'blaster') { acquireWeapon(p, id); p.loadout = [id]; } // only this weapon fires
    p.breakthroughs = { [id]: { 6: 'transform', 12: 'transform', 18: 'transform' } };
    // A dense pack right next to the ship so every weapon finds targets.
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const e = g.enemyManager.getArchetype('swarmer', 1);
      g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * (60 + (k % 4) * 40), y: p.y + Math.sin(a) * (60 + (k % 4) * 40),
        vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
    }
    g.autoFire = true;
    g.autoAim = true;
    g.mouse = { x: 0, y: 0, down: false };
    for (let i = 0; i < 60 * 8; i++) g.update(1 / 60);
    const hurt = g.enemyManager.enemies.filter((e) => e.hp < e.maxHp).length;
    assert.ok(hurt > 0, `${id} with all transforms dealt no damage`);
  }
});

test('a milestone is offered once per run, even if its choice never recorded; a discard resets it', async () => {
  const { markBreakthroughOffered } = await import('../js/upgrades.js');
  const p = freshGame().player;
  acquireWeapon(p, 'rockets');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.rockets_damage, levelJump: 5 }); // LV 6
  assert.deepEqual(pendingBreakthroughs(p, 'rockets'), [6]);
  markBreakthroughOffered(p, 'rockets', 6);
  assert.deepEqual(pendingBreakthroughs(p, 'rockets'), [], 'shown once: never again this run');
  discardWeapon(p, 'rockets');
  acquireWeapon(p, 'rockets');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.rockets_damage, levelJump: 5 });
  assert.deepEqual(pendingBreakthroughs(p, 'rockets'), [6], 're-equipped weapon starts fresh');
});

// A fresh game with one weapon and its LV 18 transform, plus still enemies at (dx, dy) off the ship.
async function transformFight(id, lv, at) {
  const g = freshGame();
  const p = g.player;
  p.invuln = 1e9;
  acquireWeapon(p, id);
  p.loadout = [id];
  p.breakthroughs = { [id]: { 18: 'transform' } };
  g.asteroidManager.asteroids = [];
  g.asteroidManager.getNearbyAsteroids = () => [];
  g.enemyManager.enemies = [];
  for (const [dx, dy] of at) {
    const e = g.enemyManager.getArchetype('swarmer', 1);
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + dx, y: p.y + dy, vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  const { makeBuild } = await import('../js/weapon-levels.js');
  return { g, p, b: makeBuild(id, lv, {}, { 18: 'transform' }) };
}

test('Thunderstrike carries strikeShare of the jumps that landed, so a lone target takes one jump\'s share', async () => {
  const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
  for (const at of [[[150, 0]], [[150, 0], [210, 0], [270, 0]]]) {
    const { g, b } = await transformFight('lightning', 18, at);
    const hits = [];
    const hitEnemy = g.hitEnemy.bind(g);
    g.hitEnemy = (e, dmg, ...rest) => { hits.push(dmg); return hitEnemy(e, dmg, ...rest); };
    g.fireChainLightning(b);
    const strikes = g.weaponFx.events.filter((ev) => ev.style === 'thunder');
    assert.equal(hits.length, at.length, 'every enemy takes one jump');
    assert.equal(strikes.length, 1);
    assert.ok(Math.abs(strikes[0].damage / (Math.min(...hits) * at.length * W.strikeShare) - 1) < 1e-9, `${at.length} jumps landed`);
  }
});

test('Hawking Cascade minis drift onto their own nearby enemies, and spread out when there are none', async () => {
  const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
  const { g, p, b } = await transformFight('singularity', 18, [[150, 0], [0, 160], [-170, 0], [600, 600]]);
  const sg = { x: p.x, y: p.y, radius: 22, pullRadius: 300, collapseRadius: 255, cascade: b };
  g.singularities = [];
  g.spawnCascade(sg);
  assert.equal(g.singularities.length, W.cascadeMinis);
  const near = g.enemyManager.enemies.slice(0, 3);
  for (const e of near) {
    const aimed = g.singularities.filter((m) => Math.abs(Math.atan2(m.vy, m.vx) - Math.atan2(e.y - p.y, e.x - p.x)) < 1e-9);
    assert.equal(aimed.length, 1, 'one mini heads for each nearby enemy');
  }
  // Drifting on the singularity drag, the first mini comes to rest on the nearest enemy as it implodes.
  const m = g.singularities[0];
  let x = m.x, y = m.y, vx = m.vx, vy = m.vy;
  for (let t = 0; t < W.cascadeLife * 60; t++) { x += vx; y += vy; vx *= 0.985; vy *= 0.985; }
  assert.ok(Math.hypot(x - near[0].x, y - near[0].y) < 1);
  g.enemyManager.enemies = [];
  g.singularities = [];
  g.spawnCascade(sg);
  assert.equal(g.singularities.length, W.cascadeMinis);
  assert.ok(g.singularities.every((s) => Math.hypot(s.vx, s.vy) > 0), 'with nobody near they still burst out');
});
