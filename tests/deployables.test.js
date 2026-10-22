import test from 'node:test';
import assert from 'node:assert/strict';

// Deployables (Proximity Mines, Sentry Turret, Escort Drones, Siege Battery). Browser services are
// stubbed; the DOM stub keeps one element per id so the HUD tags the game rendered can be read back.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const makeElement = () => ({
  textContent: '', innerHTML: '', className: '', style: {}, children: [],
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild(c) { this.children.push(c); }
});
const elements = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  },
  createElement: makeElement
};
const { Game } = await import('../js/main.js');
const { Deployables, isDeployableTarget, TURRET_SCALE, TURRET_BASE, TURRET_SPACING } = await import('../js/deployables.js');
const { DamageNumbers, DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { UPGRADE_POOL, applyUpgradeLevels, rollUpgrades } = await import('../js/upgrades.js');
const { describeUpgrade } = await import('../js/upgrade-cards.js');
const { WEAPON_SCALING: W, DRONE_MAX, DRONE_START, POTENTIAL_DPS, LV1_TRIM, droneFrontFor } = await import('../js/weapon-scaling.js');
const { levelBuild, weaponBuild, makeBuild, BT_TRANSFORM_DPS } = await import('../js/weapon-levels.js');
const L = (id, lv = 1) => levelBuild(id, lv);

const silent = new Proxy({}, { get: () => () => {} });
const DT = 1 / 60;
const byId = (id) => UPGRADE_POOL.find((u) => u.id === id);
const enemy = (x, y, extra = {}) => ({ type: 'swarmer', x, y, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, radius: 10, hue: 1, score: 1, xp: 1, sides: 4, rotation: 0, ...extra });

function arena({ enemies = [], rocks = [] } = {}) {
  Object.assign(TUNING, DEFAULT_TUNING);
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies, spawnIndicators: [], maxEnemies: 200, update() {}, queueSpawn() {} },
    asteroidManager: { asteroids: rocks, isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return this.asteroids; }, update() {} },
    player: { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, drillAngle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, xp: 0, xpToNext: 1e9, level: 1,
      stats: { moveSpeed: 5, luck: 1, xpMultiplier: 1, magnetRadius: 145, damage: 10, coreDropMult: 1, fireRate: 0, pierce: 1 }, weapons: {}, upgradeLevels: {} },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} }, damageNumbers: new DamageNumbers(), deployables: new Deployables(),
    state: 'PLAYING', pendingBossSpawns: [], wave: 1, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 1e9,
    camX: 1360, camY: 1640, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, kills: 0, score: 0, coresDroppedThisWave: 0, shake: 0,
    hitStopTicks: 0, slowMoTicks: 0, keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], singularityTimer: 1e9,
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
}

const tick = (g, seconds) => { for (let t = 0; t < Math.round(seconds * 60); t++) g.deployables.update(DT, g); };

test('mines drop in the ship wake, ignore enemies until armed, then burst for the previewed damage', () => {
  const g = arena();
  g.player.weapons.mines = 1;
  g.player.vx = 5; // flying +x: the wake is -x
  tick(g, 0.52);
  const d = g.deployables;
  assert.equal(d.mineCount, 1);
  const m = d.mines[0];
  assert.ok(m.x < g.player.x && Math.abs(m.y - g.player.y) < 1e-9, 'mine sits behind the ship');

  // An enemy parked on the unarmed mine does not set it off.
  const e = enemy(m.x, m.y);
  g.enemyManager.enemies.push(e);
  tick(g, TUNING.mineArmTime - m.age - 2 * DT);
  assert.equal(d.mineCount, 1, 'unarmed mines never detonate');
  assert.equal(e.hp, e.maxHp);
  tick(g, 3 * DT);
  assert.equal(d.mineCount, 0);
  assert.ok(Math.abs(e.maxHp - e.hp - 10 * W.mineDamageMult(L('mines'))) < 1e-6, 'blast deals the card value');
  assert.equal(e.dmgNum.source, 'mine');
});

test('Minefield Triad tosses its triangle toward the nearest enemy, at most triadToss out; with nobody near it drops in the wake', () => {
  const centre = (d) => d.mines.slice(0, 3).reduce((c, m) => ({ x: c.x + m.x / 3, y: c.y + m.y / 3 }), { x: 0, y: 0 });
  const g = arena({ enemies: [enemy(2300, 2000)] });
  g.player.weapons.mines = 18;
  g.player.breakthroughs = { mines: { 18: 'transform' } };
  tick(g, 0.52);
  assert.equal(g.deployables.mineCount, W.triadCount);
  let c = centre(g.deployables);
  assert.ok(Math.abs(c.x - (2000 + W.triadToss)) < 1e-6 && Math.abs(c.y - 2000) < 1e-6, 'a short toss toward the enemy');
  const far = arena({ enemies: [enemy(2000 + W.triadRange + 50, 2000)] });
  far.player.weapons.mines = 18;
  far.player.breakthroughs = { mines: { 18: 'transform' } };
  tick(far, 0.52);
  c = centre(far.deployables);
  assert.ok(c.x < 2000, 'out of range: in the wake behind the ship');
});

test('active mines respect the level cap and self-detonate at the end of their fuse', () => {
  const g = arena();
  let bursts = 0;
  g.sound = { playExplosion() { bursts++; } };
  g.player.weapons.mines = 1;
  tick(g, 9);
  assert.equal(g.deployables.mineCount, W.mineMaxActive(L('mines')), 'cap holds while no enemy triggers them');
  assert.equal(bursts, 0);
  tick(g, W.mineLifetime(L('mines')) - 8.3);
  assert.equal(bursts, 1, 'the first mine fused out');
  assert.equal(g.deployables.mineCount, W.mineMaxActive(L('mines')), 'and its free slot is refilled at once');
});

test('a sentry turret deploys at the ship, skips targets behind cover, and fires turret bolts', () => {
  const blocked = enemy(2100, 2000);
  const clear = enemy(2000, 2200);
  const rock = { x: 2050, y: 2000, radius: 20, hp: 100 };
  const g = arena({ enemies: [blocked, clear], rocks: [rock] });
  g.player.weapons.turret = 1;
  tick(g, W.turretStillTime + 0.1);
  const d = g.deployables;
  assert.equal(d.turretCount, 1, 'standing still plants the first charge');
  d.turretTimer = 99; // just this turret
  assert.deepEqual([d.turrets[0].x, d.turrets[0].y], [2000, 2000]);
  tick(g, 0.5);
  assert.equal(d.turrets[0].target, clear, 'nearest enemy is behind a rock, so the turret takes the clear shot');
  assert.ok(g.bullets.length > 0);
  for (const b of g.bullets) {
    assert.equal(b.source, 'turret');
    assert.ok(Math.abs(Math.atan2(b.vy, b.vx) - Math.PI / 2) < 1e-6, 'bolts fly at the visible target');
    assert.equal(b.damage, 10 * W.turretDamageMult(L('turret')));
  }
  // Removing the cover lets it retarget the nearest.
  rock.hp = 0;
  tick(g, 0.25);
  assert.equal(d.turrets[0].target, blocked);
  d.turretReloadT = -99; // no reload overflow in this test
  tick(g, W.turretDuration(L('turret')));
  assert.equal(d.turretCount, 0, 'turret expires after its lifetime');
});

test('turret line of sight uses the bolt width, so it never fires forever into a rock it grazes', () => {
  // The line to `grazed` clears the rock by 2px, less than a turret bolt's radius: the bullet sweep
  // would stop every bolt, so the turret must treat that target as covered and take the clear one.
  const grazed = enemy(2200, 2000);
  const clear = enemy(2000, 2300);
  const rock = { x: 2100, y: 2022, radius: 20, hp: 100 };
  const g = arena({ enemies: [grazed, clear], rocks: [rock] });
  g.player.weapons.turret = 1;
  tick(g, W.turretStillTime + 0.1);
  const d = g.deployables;
  d.turretTimer = 99; // just this turret: the other charge would plant elsewhere with a clear line
  tick(g, 0.3);
  assert.equal(d.turretCount, 1);
  assert.equal(d.turrets[0].target, clear);
  for (let t = 0; t < 60; t++) { d.update(DT, g); g.updateBullets(DT); }
  assert.ok(clear.hp < clear.maxHp, 'the visible target takes the bolts');
  assert.equal(grazed.hp, grazed.maxHp);
});

test('a second turret planted by a parked ship steps aside, but never into a rock', () => {
  // Parked (drilling) beside a rock: the old sidestep (+90° from the aim) landed inside it, where
  // the turret could never see a target for its whole lifetime.
  const target = enemy(2300, 2000);
  const rock = { x: 2000, y: 2060, radius: 40, hp: 100 };
  const g = arena({ enemies: [target], rocks: [rock] });
  g.player.weapons.turret = 3;
  const d = g.deployables;
  d.deployTurret(g, L('turret'));
  d.deployTurret(g, L('turret'));
  assert.equal(d.turretCount, 2);
  const [a, b] = d.turrets;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= TURRET_SPACING, 'turrets do not stack');
  assert.ok(Math.hypot(b.x - rock.x, b.y - rock.y) > rock.radius + 10, 'the sidestep avoids the rock');
  tick(g, 0.5);
  assert.equal(b.target, target, 'and the new turret can shoot');
});

// Ship heading +x: which drones fly ahead of the hull (the front pair) and which behind it (the back row).
const formation = (g) => {
  const d = g.deployables.drones.slice(0, g.deployables.droneCount);
  return { front: d.filter((u) => u.x > g.player.x), back: d.filter((u) => u.x < g.player.x) };
};

test('escort drones fly in formation round the hull, fire drone bolts, and never target vortex portals', () => {
  const portal = enemy(2150, 2000, { type: 'blackhole', radius: 22 });
  const g = arena({ enemies: [portal] });
  assert.equal(isDeployableTarget(portal), false);
  g.player.weapons.drones = 3;
  g.player.upgradeLevels.drones_wingmen = 1; // the starting front pair and the back-row centre
  tick(g, 2);
  const d = g.deployables;
  assert.equal(d.droneCount, 3);
  assert.equal(d.droneCount, W.droneCount(weaponBuild(g.player, 'drones')));
  for (let i = 0; i < d.droneCount; i++) {
    const drone = d.drones[i];
    assert.ok(Math.hypot(drone.x - g.player.x, drone.y - g.player.y) < TUNING.droneFormationRadius * 1.6 + 6);
  }
  const { front, back } = formation(g);
  assert.equal(front.length, 2);
  assert.equal(back.length, 1);
  assert.ok(Math.abs(back[0].y - g.player.y) < 8, 'a lone back drone flies the centre slot');
  assert.ok(front[0].y < g.player.y !== front[1].y < g.player.y, 'the front pair flanks the nose');
  assert.equal(g.bullets.length, 0, 'the only enemy is a portal');

  const target = enemy(2150, 2050);
  g.enemyManager.enemies.push(target);
  tick(g, 1);
  assert.ok(g.bullets.length >= 3);
  const build = weaponBuild(g.player, 'drones');
  const lead = 10 * W.droneDamageMult(build), wing = 10 * W.droneWingDamageMult(build);
  assert.ok(Math.abs(wing / lead - W.droneWingHitShare) < 1e-12, 'wingmen fly lighter guns than the flight lead');
  const is = (x, v) => Math.abs(x / v - 1) < 1e-9;
  assert.ok(g.bullets.every((b) => b.source === 'drone' && (is(b.damage, lead) || is(b.damage, wing))));
  assert.ok(g.bullets.some((b) => is(b.damage, lead)) && g.bullets.some((b) => is(b.damage, wing)));
  g.player.upgradeLevels.drones_wingmen = 0;
  tick(g, DT);
  assert.equal(d.droneCount, DRONE_START, 'LV 1 flies the lead and one wingman');
});

test('escort drones start as a front pair at LV 1, and every slot sits 6 px roomier than its formation radius', () => {
  assert.equal(DRONE_START, 2);
  assert.equal(W.droneCount(levelBuild('drones', 1)), 2);
  // Two drones share the same LV 1 potential one drone had: the start adds coverage, not a DPS jump.
  assert.ok(Math.abs(POTENTIAL_DPS.drones(levelBuild('drones', 1)) - 3 * LV1_TRIM.drones) < 1e-9);
  const g = arena();
  g.player.weapons.drones = 1;
  tick(g, 2);
  const f = formation(g);
  assert.equal(f.front.length, 2);
  assert.equal(f.back.length, 0);
  // Pair slot (0.55, ±1.05) of the 54 px radius, pushed 6 px out (± the 3 px bob).
  const want = Math.hypot(0.55, 1.05) * TUNING.droneFormationRadius + 6;
  for (const u of f.front) assert.ok(Math.abs(Math.hypot(u.x - g.player.x, u.y - g.player.y) - want) < 4, `drone at ${Math.hypot(u.x - g.player.x, u.y - g.player.y).toFixed(1)} px`);
});

test('escort drones: up to 5 from Wingmen (2 front, 3 behind); Escort Squadron adds 3 in the same balanced order (3 front, 5 behind)', () => {
  // One fill order for every drone: front centre, front pair, back row to 3, front centre, back sides.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(droneFrontFor), [1, 2, 2, 2, 2, 3, 3, 3]);
  const g = arena();
  const docks = [];
  g.sound = new Proxy({}, { get: (_, k) => (k === 'playDroneDock' ? (slot) => docks.push(slot) : () => {}) });
  g.player.weapons.drones = 5;
  g.player.upgradeLevels.drones_wingmen = 3;
  tick(g, 2);
  let f = formation(g);
  assert.equal(g.deployables.droneCount, 5);
  assert.equal(f.front.length, 2);
  assert.equal(f.back.length, 3);
  assert.deepEqual(docks, [0, 1, 2, 3, 4]);

  // LV 6 Escort Squadron on the full 5: 3 more peel off one by one, to 8 (3 in front, 5 behind).
  g.player.weapons.drones = 6;
  g.player.breakthroughs = { drones: { 6: 'transform' } };
  tick(g, DT);
  assert.equal(g.deployables.droneCount, DRONE_MAX);
  assert.equal(DRONE_MAX, 8);
  assert.ok(g.deployables.drones[7].launch > g.deployables.drones[6].launch, 'the squadron launches one drone at a time');
  tick(g, 2);
  f = formation(g);
  assert.equal(f.front.length, 3);
  assert.equal(f.back.length, 5);
  const y = (u) => u.y - g.player.y;
  assert.ok(Math.abs(f.front.reduce((a, u) => a + y(u), 0)) < 12 && Math.abs(f.back.reduce((a, u) => a + y(u), 0)) < 12, 'both rows balanced port and starboard');
  assert.ok(g.deployables.drones.slice(0, 8).every((u) => u.pop === 0 && u.docked));

  // The squadron with no Wingmen ranks follows the same order: 5 drones are the front pair + 3 behind.
  const s = arena();
  s.player.weapons.drones = 6;
  s.player.breakthroughs = { drones: { 6: 'transform' } };
  tick(s, 2);
  f = formation(s);
  assert.equal(s.deployables.droneCount, 5);
  assert.equal(f.front.length, 2);
  assert.equal(f.back.length, 3);

  // Drones past 8 never go to waste: their guns ride on the rest (a Replicator rank on a full squadron).
  const over = makeBuild('drones', 10, { wingmen: 4 }, { 6: 'transform' });
  assert.equal(W.droneSquad(over), 9);
  assert.equal(W.droneCount(over), DRONE_MAX);
  assert.ok(Math.abs(W.droneWingDamageMult(over) / W.droneDamageMult(over) - W.droneWingHitShare * 8 / 7) < 1e-12, 'the surplus gun rides on the 7 wingmen');
  // The squadron is the same damage step as before: each extra drone is a wingman gun.
  const five = makeBuild('drones', 10, { wingmen: 3 });
  const five6 = makeBuild('drones', 10, { wingmen: 3 }, { 6: 'transform' });
  assert.equal(W.droneCount(five6), 8);
  assert.ok(Math.abs(POTENTIAL_DPS.drones(five6) / POTENTIAL_DPS.drones(five) - BT_TRANSFORM_DPS) < 1e-9);
});

test('deployables freeze under hit-stop and pause, and never join the enemy list', () => {
  const g = arena({ enemies: [enemy(2300, 2200)] });
  g.player.weapons.mines = 3;
  g.player.weapons.turret = 3;
  g.player.weapons.drones = 3;
  for (let t = 0; t < 120; t++) g.update(DT);
  const d = g.deployables;
  assert.ok(d.mineCount > 0 && d.turretCount > 0 && d.droneCount > 0);
  assert.equal(g.enemyManager.enemies.length, 1);
  const snap = () => JSON.stringify([d.time, d.mines[0].age, d.turrets[0].life, d.drones[0].x, d.drones[0].y]);
  const before = snap();
  g.hitStopTicks = 3;
  for (let t = 0; t < 3; t++) g.update(DT);
  assert.equal(snap(), before, 'hit-stop holds deployables');
  g.state = 'PAUSED';
  for (let t = 0; t < 30; t++) g.update(DT);
  assert.equal(snap(), before, 'pause holds deployables');
  g.state = 'PLAYING';
  g.update(DT);
  assert.notEqual(snap(), before);
});

test('resetRun clears every deployable', () => {
  const g = arena();
  g.player.weapons.mines = 2;
  g.player.weapons.turret = 2;
  g.player.weapons.drones = 2;
  g.enemyManager.enemies.push(enemy(2100, 2100));
  tick(g, 3);
  assert.ok(g.deployables.activeCount > 0);
  Object.assign(g, {
    progression: { getBonuses: () => ({ bonusHp: 0, extraBombs: 0, moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 }), addCores() {}, data: { cores: 0 } },
    particles: { clear() {} }, grid: { reset() {} },
    enemyManager: { clear() {}, enemies: [], spawnIndicators: [] },
    asteroidManager: { generateSector() {} }
  });
  g.resetRun();
  assert.equal(g.deployables.activeCount, 0);
  assert.equal(g.deployables.time, 0);
  assert.equal(g.player.weapons.mines, 0);
});

test('Siege Battery shells burst into neighbours through the shared bullet sweep', () => {
  // Exact full-damage checks; blast edge falloff has its own test.
  const savedFalloff = TUNING.splashEdgeFalloff;
  TUNING.splashEdgeFalloff = 0;
  try {
    const hit = enemy(2100, 2000);
    const near = enemy(2100, 2035);
    const g = arena({ enemies: [hit, near] });
    TUNING.splashEdgeFalloff = 0;
    g.player.weapons.turret = 1;
    g.player.weapons.mines = 1;
    applyUpgradeLevels(g.player, byId('evo_siege'));
    assert.equal(g.player.weapons.siegeBattery, 1);
    g.deployables.fireTurretBolt(g, { x: 2000, y: 2000, aim: 0, flash: 0 }, 1);
    for (let t = 0; t < 30 && g.bullets.length; t++) g.updateBullets(DT);
    const bolt = 10 * W.turretDamageMult(L('turret'));
    assert.ok(Math.abs(hit.maxHp - hit.hp - bolt * (1 + W.siegeShellDamageMult)) < 1e-6, 'direct hit + burst');
    assert.ok(Math.abs(near.maxHp - near.hp - bolt * W.siegeShellDamageMult) < 1e-6, 'neighbour takes the burst');
    assert.equal(near.dmgNum.source, 'turret');
  } finally {
    TUNING.splashEdgeFalloff = savedFalloff;
  }
});

test('deployable cards preview exact numbers and Siege Battery needs mines + turret', () => {
  const g = arena();
  const p = g.player;
  assert.equal(describeUpgrade(p, byId('mines')).headline, `PROXIMITY MINES // ${W.mineMaxActive(L('mines'))} ACTIVE`);
  assert.equal(describeUpgrade(p, byId('turret')).headline, `SENTRY TURRET // ${W.turretCharges(L('turret'))} CHARGES`);
  assert.equal(describeUpgrade(p, byId('drones')).headline, '+2 ESCORT DRONES');
  applyUpgradeLevels(p, byId('turret'));
  // A stat card shows only its own stat.
  const punch = describeUpgrade(p, byId('turret_pierce'));
  assert.equal(punch.headline, '+1 TURRET PIERCE');
  assert.deepEqual(punch.rows.map((r) => r.id), ['turretPierce']);
  assert.deepEqual(punch.rows[0], { id: 'turretPierce', label: 'Turret bolt pierce', before: '2', after: '3' });
  const bolts = describeUpgrade(p, byId('turret_redeploy'));
  assert.deepEqual(bolts.rows.map((r) => r.id), ['turretReload']);
  assert.deepEqual(bolts.rows[0], { id: 'turretReload', label: 'Turret charge reload', before: '6.00s', after: '4.29s' });
  applyUpgradeLevels(p, byId('drones'));
  assert.equal(describeUpgrade(p, byId('drones_wingmen')).headline, '+1 ESCORT DRONE');
  for (const id of ['mines', 'turret', 'drones', 'evo_siege']) {
    assert.ok(byId(id).tags.includes('deployable'), `${id} is tagged deployable`);
  }
  assert.ok(!byId('evo_siege').req(p), 'turret alone does not unlock Siege Battery');
  applyUpgradeLevels(p, byId('mines'));
  assert.ok(byId('evo_siege').req(p));
  assert.equal(describeUpgrade(p, byId('evo_siege')).headline, `TURRET SHELLS BURST // ${(10 * W.turretDamageMult(L('turret')) * W.siegeShellDamageMult).toFixed(1)} DMG`);
  // With everything else maxed, hands offer only the equipped deployables' stat cards (never their
  // equip lines: weapons come from NEW WEAPON cards).
  const deployable = (u) => ['mines', 'turret', 'drones'].includes(u.weapon);
  p.upgradeLevels = Object.fromEntries(UPGRADE_POOL.filter((u) => !deployable(u)).map((u) => [u.id, u.maxLevel]));
  for (const id of ['mines', 'turret', 'drones']) p.upgradeLevels[id] = 1;
  const offered = rollUpgrades(p, 3);
  assert.equal(offered.length, 3);
  for (const u of offered) assert.ok(u.statCard && deployable(u), u.id);
});

test('HUD tags, damage colours and tuning cover the deployables', () => {
  const g = arena();
  delete g.updateHUD; // use the real HUD
  g.getBossHudModel = () => null;
  g.updateBossHUD = () => {};
  g.progression = { data: { cores: 0 } };
  for (const id of ['mines', 'turret', 'drones']) applyUpgradeLevels(g.player, byId(id));
  g.updateHUD();
  const tags = elements.get('active-weapons-bar').innerHTML;
  for (const name of ['Proximity Mines LV 1', 'Sentry Turret LV 1', 'Escort Drones LV 1']) assert.ok(tags.includes(name), name);
  const colors = new Set(Object.values(DAMAGE_SOURCE_COLORS));
  assert.equal(colors.size, Object.keys(DAMAGE_SOURCE_COLORS).length, 'every source has its own colour');
  for (const s of ['mine', 'turret', 'drone']) assert.ok(DAMAGE_SOURCE_COLORS[s]);
  const keys = TUNING_SCHEMA.find((grp) => /Deployables/.test(grp.group)).items.map((i) => i.key);
  for (const k of ['deployableDamageMult', 'mineArmTime', 'droneFormationRadius']) {
    assert.ok(keys.includes(k));
    assert.ok(k in DEFAULT_TUNING);
  }
});

test('the sentry turret is twice its old size: body, placement clearance and muzzle', () => {
  assert.equal(TURRET_SCALE, 2);
  assert.equal(TURRET_BASE, 28, 'rock clearance (hex 22 + margin) was 14');
  assert.equal(TURRET_SPACING, 68, 'turret spacing was 34');
  const target = enemy(2300, 2000);
  const g = arena({ enemies: [target] });
  g.player.weapons.turret = 1;
  const d = g.deployables;
  d.deployTurret(g, L('turret'));
  const t = d.turrets[0];
  t.life = t.maxLife - 1; // fully popped in
  // Bolts leave from the tip of the doubled barrel (34 px out, was 17).
  d.fireTurretBolt(g, t, 1);
  const bolt = g.bullets[0];
  assert.ok(Math.abs(Math.hypot(bolt.x - t.x, bolt.y - t.y) - 34) < 1e-9);
  // Drawn size: the lifetime ring (unit radius 19) under the canvas scale.
  let scale = 1;
  const arcs = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'scale' ? (sx) => { scale = sx; }
      : k === 'arc' ? (x, y, r) => arcs.push(r * scale)
      : () => {}),
    set: () => true
  });
  d.drawGround(ctx, g);
  assert.equal(scale, 2);
  assert.equal(Math.max(...arcs), 38, 'lifetime ring radius was 19 px');
  // A rock that a 14 px base cleared now blocks the spot under the ship.
  const rock = { x: 2000, y: 2040, radius: 18, hp: 100 };
  const g2 = arena({ rocks: [rock] });
  assert.equal(g2.deployables.turretSpotClear(g2, 2000, 2000, 0), false);
  rock.y = 2000 + 18 + TURRET_BASE + 1;
  assert.equal(g2.deployables.turretSpotClear(g2, 2000, 2000, 0), true);
});

test('two turrets out fire at the base rate each, and their bolts carry the card damage', () => {
  const target = enemy(2200, 2000);
  const g = arena({ enemies: [target] });
  g.player.weapons.turret = 1;
  tick(g, 1);
  assert.equal(g.deployables.turretCount, 2);
  g.bullets = [];
  tick(g, 2);
  const bolts = g.bullets.filter((b) => b.source === 'turret');
  // 2 turrets x 2 s x 6.1 bolts/s.
  assert.ok(Math.abs(bolts.length - 2 * 2 * W.turretFireRate(L('turret'))) <= 3, `${bolts.length} bolts in 2 s`);
  for (const b of bolts) assert.equal(b.damage, 10 * W.turretDamageMult(L('turret')));
});

test('a turret bolt still hits an enemy sitting inside its long barrel', () => {
  const close = enemy(2012, 2000); // inside the 34 px muzzle
  const g = arena({ enemies: [close] });
  g.player.weapons.turret = 1;
  g.deployables.fireTurretBolt(g, { x: 2000, y: 2000, aim: 0, flash: 0 }, 1);
  g.updateBullets(DT);
  assert.ok(close.hp < close.maxHp, 'point-blank enemy takes the bolt');
});

test('Sentry Turrets (DRG: Survivor rules): stand still to plant every held charge; charges reload; a full bank overflows', () => {
  const lv = L('turret');
  assert.equal(W.turretCharges(lv), 2);
  assert.equal(W.turretReload(lv), 6);
  assert.equal(W.turretDuration(lv), 10);
  const parked = arena({ enemies: [enemy(2300, 2000)] });
  parked.player.weapons.turret = 1;
  tick(parked, W.turretStillTime - 0.1);
  assert.equal(parked.deployables.turretCount, 0, 'nothing until the ship has stood still turretStillTime');
  tick(parked, 0.15 + W.turretDropStill);
  assert.equal(parked.deployables.turretCount, 2, 'then every held charge goes down, turretDropStill apart');
  assert.equal(parked.deployables.turretCharges, 0);
  tick(parked, 6 - (W.turretStillTime + 0.05 + W.turretDropStill) + 0.05);
  assert.equal(parked.deployables.turretCount, 3, 'a reloaded charge goes straight down while you stand still');

  // On the move nothing is planted while the bank is short of full, and a charge that comes back to a
  // full bank deploys by itself.
  const moving = arena({ enemies: [enemy(2300, 2000)] });
  moving.player.weapons.turret = 1;
  moving.player.vx = 3;
  tick(moving, 5.9);
  assert.equal(moving.deployables.turretCount, 0, 'moving: charges stay in the bank');
  assert.equal(moving.deployables.turretCharges, 2);
  tick(moving, 0.2);
  assert.equal(moving.deployables.turretCount, 1, 'overflow: the reload past a full bank deploys');
  assert.equal(moving.deployables.turretCharges, 2);

  // A turret breaks down after its lifetime; Loosen Bolts reloads faster.
  tick(moving, 6);
  assert.equal(moving.deployables.turretCount, 2);
  tick(moving, 4.1);
  assert.equal(moving.deployables.turretCount, 1, 'the first expired after 10 s');
  assert.ok(Math.abs(W.turretReload(makeBuild('turret', 3, { reload: 2 })) - 6 / 1.8) < 1e-9);
});

test('Sentry Turret: Extra Capacity adds a charge, Add Punch pierces, the HUD chip shows the bank', () => {
  assert.equal(W.turretCharges(makeBuild('turret', 6, {}, { 6: 'transform' })), 3);
  assert.equal(W.turretPierce(makeBuild('turret', 3, { pierce: 2 })), 4, 'two enemies per bolt, +1 per Add Punch');
  const g = arena({ enemies: [enemy(2300, 2000)] });
  g.player.weapons.turret = 1;
  g.player.vx = 3;
  assert.equal(g.deployables.turretHudCharge(g.player), null, 'nothing before the turret runs');
  tick(g, 0.1);
  assert.equal(g.deployables.turretHudCharge(g.player), 1, 'a full bank');
  g.player.vx = 0;
  tick(g, W.turretStillTime + W.turretDropStill + 0.1);
  assert.equal(g.deployables.turretHudCharge(g.player), 0, 'both planted');
  tick(g, 2.5);
  assert.equal(g.deployables.turretHudCharge(g.player), 0.2, 'the next charge is past a third of its reload: a fifth of the bank');
  const b = g.bullets.find((x) => x.source === 'turret') || (g.deployables.fireTurretBolt(g, g.deployables.turrets[0], L('turret')), g.bullets.at(-1));
  assert.equal(b.pierce, 2);
});
