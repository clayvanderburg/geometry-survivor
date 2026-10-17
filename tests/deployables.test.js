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
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');

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
  assert.ok(Math.abs(e.maxHp - e.hp - 10 * W.mineDamageMult(1)) < 1e-6, 'blast deals the card value');
  assert.equal(e.dmgNum.source, 'mine');
});

test('active mines respect the level cap and self-detonate at the end of their fuse', () => {
  const g = arena();
  let bursts = 0;
  g.sound = { playExplosion() { bursts++; } };
  g.player.weapons.mines = 1;
  tick(g, 9);
  assert.equal(g.deployables.mineCount, W.mineMaxActive(1), 'cap holds while no enemy triggers them');
  assert.equal(bursts, 0);
  tick(g, W.mineLifetime(1) - 8.3);
  assert.equal(bursts, 1, 'the first mine fused out');
  assert.equal(g.deployables.mineCount, W.mineMaxActive(1), 'and its free slot is refilled at once');
});

test('a sentry turret deploys at the ship, skips targets behind cover, and fires turret bolts', () => {
  const blocked = enemy(2100, 2000);
  const clear = enemy(2000, 2200);
  const rock = { x: 2050, y: 2000, radius: 20, hp: 100 };
  const g = arena({ enemies: [blocked, clear], rocks: [rock] });
  g.player.weapons.turret = 1;
  tick(g, 0.8);
  const d = g.deployables;
  assert.equal(d.turretCount, 1);
  assert.deepEqual([d.turrets[0].x, d.turrets[0].y], [2000, 2000]);
  tick(g, 0.5);
  assert.equal(d.turrets[0].target, clear, 'nearest enemy is behind a rock, so the turret takes the clear shot');
  assert.ok(g.bullets.length > 0);
  for (const b of g.bullets) {
    assert.equal(b.source, 'turret');
    assert.ok(Math.abs(Math.atan2(b.vy, b.vx) - Math.PI / 2) < 1e-6, 'bolts fly at the visible target');
    assert.equal(b.damage, 10 * W.turretDamageMult(1));
  }
  // Removing the cover lets it retarget the nearest.
  rock.hp = 0;
  tick(g, 0.25);
  assert.equal(d.turrets[0].target, blocked);
  tick(g, W.turretDuration(1));
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
  tick(g, 1.3);
  const d = g.deployables;
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
  d.deployTurret(g, 3);
  d.deployTurret(g, 3);
  assert.equal(d.turretCount, 2);
  const [a, b] = d.turrets;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= TURRET_SPACING, 'turrets do not stack');
  assert.ok(Math.hypot(b.x - rock.x, b.y - rock.y) > rock.radius + 10, 'the sidestep avoids the rock');
  tick(g, 0.5);
  assert.equal(b.target, target, 'and the new turret can shoot');
});

test('escort drones fly in formation behind the hull, fire drone bolts, and never target vortex portals', () => {
  const portal = enemy(2150, 2000, { type: 'blackhole', radius: 22 });
  const g = arena({ enemies: [portal] });
  assert.equal(isDeployableTarget(portal), false);
  g.player.weapons.drones = 4;
  tick(g, 2);
  const d = g.deployables;
  assert.equal(d.droneCount, W.droneCount(4));
  for (let i = 0; i < d.droneCount; i++) {
    const drone = d.drones[i];
    assert.ok(drone.x < g.player.x, `drone ${i} trails behind a ship heading +x`);
    assert.ok(Math.hypot(drone.x - g.player.x, drone.y - g.player.y) < TUNING.droneFormationRadius * 1.5);
  }
  assert.equal(g.bullets.length, 0, 'the only enemy is a portal');

  const target = enemy(2150, 2050);
  g.enemyManager.enemies.push(target);
  tick(g, 1);
  assert.ok(g.bullets.length >= 3);
  assert.ok(g.bullets.every((b) => b.source === 'drone' && b.damage === 10 * W.droneDamageMult(4)));
  g.player.weapons.drones = 1;
  tick(g, DT);
  assert.equal(d.droneCount, 1);
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
    const bolt = 10 * W.turretDamageMult(1);
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
  assert.equal(describeUpgrade(p, byId('mines')).headline, `PROXIMITY MINES // ${W.mineMaxActive(1)} ACTIVE`);
  assert.equal(describeUpgrade(p, byId('turret')).headline, `SENTRY TURRET // ${W.turretMaxActive(1)} ACTIVE`);
  assert.equal(describeUpgrade(p, byId('drones')).headline, '+1 ESCORT DRONE');
  applyUpgradeLevels(p, { ...byId('turret'), levelJump: 2 });
  assert.equal(describeUpgrade(p, byId('turret')).headline, '+1 SENTRY TURRET');
  const rows = describeUpgrade(p, byId('turret')).rows;
  assert.deepEqual(rows.find((r) => r.id === 'turretDuration'), { id: 'turretDuration', label: 'Turret lifetime', before: '7.0s', after: '8.0s' });
  applyUpgradeLevels(p, byId('drones'));
  assert.equal(describeUpgrade(p, byId('drones')).headline, '+1 ESCORT DRONE');
  for (const id of ['mines', 'turret', 'drones', 'evo_siege']) {
    assert.ok(byId(id).tags.includes('deployable'), `${id} is tagged deployable`);
  }
  assert.ok(!byId('evo_siege').req(p), 'turret alone does not unlock Siege Battery');
  applyUpgradeLevels(p, byId('mines'));
  assert.ok(byId('evo_siege').req(p));
  assert.equal(describeUpgrade(p, byId('evo_siege')).headline, `TURRET SHELLS BURST // ${(10 * W.turretDamageMult(2) * W.siegeShellDamageMult).toFixed(1)} DMG`);
  // Shuffle draws all tie, so offered cards follow pool order among what is eligible.
  p.upgradeLevels = Object.fromEntries(UPGRADE_POOL.filter((u) => !['mines', 'turret', 'drones'].includes(u.id)).map((u) => [u.id, u.maxLevel]));
  const original = Math.random;
  Math.random = () => 0.99;
  try {
    assert.deepEqual(rollUpgrades(p, 3).map((u) => u.id).sort(), ['drones', 'mines', 'turret']);
  } finally { Math.random = original; }
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
  d.deployTurret(g, 1);
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

test('a live turret fires its doubled rate of half-damage bolts', () => {
  const target = enemy(2200, 2000);
  const g = arena({ enemies: [target] });
  g.player.weapons.turret = 1;
  tick(g, 0.8);
  assert.equal(g.deployables.turretCount, 1);
  g.bullets = [];
  tick(g, 2);
  const bolts = g.bullets.filter((b) => b.source === 'turret');
  // 2 s at 6.1 bolts/s (was 3.05/s): about 12 bolts, each half the old damage.
  assert.ok(Math.abs(bolts.length - 2 * W.turretFireRate(1)) <= 1, `${bolts.length} bolts in 2 s`);
  for (const b of bolts) assert.equal(b.damage, 10 * W.turretDamageMult(1));
});

test('a turret bolt still hits an enemy sitting inside its long barrel', () => {
  const close = enemy(2012, 2000); // inside the 34 px muzzle
  const g = arena({ enemies: [close] });
  g.player.weapons.turret = 1;
  g.deployables.fireTurretBolt(g, { x: 2000, y: 2000, aim: 0, flash: 0 }, 1);
  g.updateBullets(DT);
  assert.ok(close.hp < close.maxHp, 'point-blank enemy takes the bolt');
});
