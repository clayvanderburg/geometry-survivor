import test from 'node:test';
import assert from 'node:assert/strict';

// Enemy variety: new archetypes (movement + attacks), hostile orbs, lieutenants and wave pacing.
// Browser services are stubbed; tests drive the real EnemyManager / Game code paths.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const elements = new Map();
function element() {
  const classes = new Set(['hidden']);
  return {
    textContent: '', innerHTML: '', style: {}, offsetWidth: 0, value: '',
    get className() { return [...classes].join(' '); },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    appendChild() {}, addEventListener() {}
  };
}
globalThis.document = {
  activeElement: null,
  getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  createElement: element
};

const { Game } = await import('../js/main.js');
const { EnemyManager, damageRampAt, emergeFactor } = await import('../js/enemies.js');
const { EnemyBulletPool } = await import('../js/enemy-bullets.js');
const { DamageNumbers } = await import('../js/damage-numbers.js');
const {
  ARCHETYPE_INFO, BRUISER, GUNNER, BLINKER, CONDUIT, WAVE_PACKS, pickWavePack, lieutenantTypes, shieldBlocks, bruiserChargeLength
} = await import('../js/archetypes.js');
const { rollLieutenant, LIEUTENANT_WARMUP, LT_MODIFIERS } = await import('../js/lieutenants.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');

const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);
const NEW_TYPES = Object.keys(ARCHETYPE_INFO);

// Seeded generator so lieutenant rolls and AI timers are reproducible.
function seeded(seed = 7) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function arena({ rocks = [] } = {}) {
  const manager = new EnemyManager();
  const asteroidManager = {
    asteroids: rocks, isDrilling: false, drillingRocks: [], cellSize: 140,
    getNearbyAsteroids() { return rocks; }, cellsFor() { return 1; }, update() {}
  };
  manager.terrain = asteroidManager;
  const banners = [];
  const game = Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager,
    player: {
      x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, drillAngle: 0, hp: 100, maxHp: 100, invuln: 0, dashTimer: 0, dashCooldown: 0, bombs: 2,
      xp: 0, xpToNext: 1e9, level: 1, upgradeLevels: {},
      stats: { moveSpeed: TUNING.moveSpeed, luck: 1, xpMultiplier: 1, magnetRadius: 145, damage: 11, coreDropMult: 1, fireRate: 0, drillScale: 1.15 }, weapons: {}
    },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} }, damageNumbers: new DamageNumbers(),
    state: 'PLAYING', pendingBossSpawns: [], wave: 1, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 1e9,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, kills: 0, score: 0, coresDroppedThisWave: 0,
    shake: 0, chromaFlash: 0, hitStopTicks: 0, slowMoTicks: 0, bossCardTimer: 0, ltCardTimer: 0, ltCard: null, lieutenantWave: 0,
    seenArchetypes: new Set(),
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [],
    showBanner(m) { banners.push(m); }, updateHUD() {}, pollGamepad() { return null; }, triggerGameOver() { this.state = 'GAMEOVER'; },
    spawnAroundPlayer() { return { x: this.player.x + 500, y: this.player.y }; }
  });
  return { game, manager, banners };
}

function addEnemy(manager, type, x, y, extra = {}) {
  manager.queueSpawn(type, x, y, 1, { instant: true, ...extra });
  manager.update(0.02, { x: 2000, y: 2000 }, [], silent, silent, 4200, 4200);
  return manager.enemies[manager.enemies.length - 1];
}

const step = (manager, player, n = 1) => {
  for (let i = 0; i < n; i++) manager.update(1 / 60, player, [], silent, silent, 4200, 4200);
};

test('every new archetype spawns, moves and stays finite for ten seconds next to the ship', () => {
  resetTuning();
  const manager = new EnemyManager();
  const player = { x: 2000, y: 2000, radius: 15, stats: { drillScale: 1.15 } };
  for (const [i, type] of NEW_TYPES.entries()) manager.queueSpawn(type, 1700 + i * 120, 1650, 1.5, { instant: true });
  for (let i = 0; i < 4; i++) manager.queueSpawn('pinwheel', 1800 + i * 40, 1700, 1, { instant: true });
  step(manager, player, 600);
  assert.equal(manager.enemies.length, NEW_TYPES.length + 4);
  for (const e of manager.enemies) {
    assert.ok([e.x, e.y, e.vx, e.vy, e.hp, e.rotation].every(Number.isFinite), `${e.type} stays finite`);
  }
  assert.ok(manager.enemyBullets.count > 0, 'the gunner fired at the ship');
});

test('archetypes join the spawn table progressively, and a zero weight disables a pack', () => {
  resetTuning();
  const seen = wave => {
    const rand = seeded(wave);
    const packs = new Set();
    for (let i = 0; i < 4000; i++) packs.add(pickWavePack(wave, rand));
    return packs;
  };
  assert.deepEqual([...seen(1)].sort(), ['blackhole', 'skirmish', 'splitter', 'swarm']);
  for (const type of NEW_TYPES) {
    const unlock = ARCHETYPE_INFO[type].unlockWave;
    assert.ok(!seen(unlock - 1).has(type), `${type} never spawns before wave ${unlock}`);
    assert.ok(seen(unlock).has(type), `${type} spawns from wave ${unlock}`);
  }
  assert.deepEqual(NEW_TYPES.map(t => ARCHETYPE_INFO[t].unlockWave), [2, 3, 4, 5, 6], 'one new archetype per wave');
  TUNING.spawnWeightGunner = 0;
  assert.ok(!seen(9).has('gunner'));
  for (const pack of WAVE_PACKS) TUNING[pack.weightKey] = 0;
  assert.equal(pickWavePack(9, seeded()), 'swarm', 'all-zero weights fall back to a swarm');
  resetTuning();
});

test('spawn packs keep the continuous timer and cap: no pack exceeds the population budget', () => {
  resetTuning();
  const { game, manager } = arena();
  game.wave = 12;
  for (let i = 0; i < 400; i++) {
    game.spawnWavePack();
    assert.ok(manager.enemies.length + manager.spawnIndicators.length <= manager.maxEnemies);
  }
  assert.equal(manager.spawnIndicators.length, manager.maxEnemies, 'packs fill to the cap and stop there');
});

test('bruiser: winds up on a lane that locks before the charge, then charges and recovers', () => {
  resetTuning();
  const manager = new EnemyManager();
  const player = { x: 2300, y: 2000 };
  const b = addEnemy(manager, 'bruiser', 2000, 2000);
  b.aiTimer = 0;
  step(manager, player);
  assert.equal(b.state, 'windup');
  // Move the ship sideways after the lane locks: the bruiser keeps its locked heading.
  const lockTicks = Math.ceil(BRUISER.windup * 0.6 * 60) + 1;
  step(manager, player, lockTicks);
  const locked = b.aimAngle;
  step(manager, { x: 2000, y: 2300 }, 5);
  assert.equal(b.aimAngle, locked, 'the last 40% of the wind-up is a fixed, dodgeable lane');
  let ticks = 0;
  while (b.state === 'windup' && ticks < 120) { step(manager, player); ticks++; }
  assert.equal(b.state, 'charge');
  step(manager, player, 3);
  assert.ok(Math.hypot(b.vx, b.vy) > b.speed * 3, 'the charge far exceeds its walking speed');
  assert.ok(bruiserChargeLength(b) > 200);
  while (b.state === 'charge') step(manager, player);
  assert.equal(b.state, 'recover');
  assert.equal(b.burstSpeed, 0);
});

test('bruisers shrug off knockback and survive ramming the ship; swarmers still pop', () => {
  resetTuning();
  const { game, manager } = arena();
  const b = addEnemy(manager, 'bruiser', 2600, 2000);
  const p = addEnemy(manager, 'pinwheel', 2600, 2400);
  game.hitEnemy(b, 1, 'blaster', 1.3, 0);
  game.hitEnemy(p, 1, 'blaster', 1.3, 0);
  const massOnly = (p.radius * p.radius) / (b.radius * b.radius);
  assert.ok(Math.abs(b.knockX - p.knockX * massOnly * BRUISER.knockMult) < 1e-9, 'bruiser takes a quarter of mass-scaled knockback');

  const ram = addEnemy(manager, 'bruiser', 2010, 2000);
  ram.x = 2010; ram.y = 2000;
  game.update(1 / 60);
  assert.ok(manager.enemies.includes(ram), 'a sturdy bruiser bounces off instead of dying on contact');
  assert.ok(game.player.hp < 100);
  assert.ok(Math.abs(100 - game.player.hp - 18 * 1.5 * damageRampAt(game.wave)) < 1e-9, 'bruiser contact hits 1.5x harder');
});

test('gunner holds its range band and fires a slow orb only after a visible aim', () => {
  resetTuning();
  const manager = new EnemyManager();
  const player = { x: 2000, y: 2000, radius: 15, stats: { drillScale: 1.15 } };
  const close = addEnemy(manager, 'gunner', 2120, 2000);
  const far = addEnemy(manager, 'gunner', 1000, 2000);
  close.aiTimer = far.aiTimer = 99;
  step(manager, player, 240);
  const dist = e => Math.hypot(e.x - player.x, e.y - player.y);
  assert.ok(dist(close) > 260, `a crowded gunner backs off (now ${dist(close).toFixed(0)}px)`);
  assert.ok(dist(far) < 860, `a distant gunner closes in (now ${dist(far).toFixed(0)}px)`);

  manager.enemies = [close];
  close.aiTimer = 0;
  step(manager, player);
  assert.equal(close.state, 'aim');
  const aimTicks = Math.round(GUNNER.aimTime * 60);
  step(manager, player, aimTicks - 2);
  assert.equal(manager.enemyBullets.count, 0, 'no shot during the aim telegraph');
  step(manager, player, 3);
  assert.equal(manager.enemyBullets.count, 1);
  const orb = manager.enemyBullets.active[0];
  assert.ok(Math.abs(Math.hypot(orb.vx, orb.vy) - TUNING.enemyBulletSpeed) < 1e-9);
  assert.ok(TUNING.enemyBulletSpeed < TUNING.moveSpeed, 'orbs are slower than the ship, so they can be outrun');
});

test('enemy orbs are pooled, blocked by rock, absorbed by the shield and skip a dash', () => {
  resetTuning();
  const pool = new EnemyBulletPool(4);
  const player = { x: 2000, y: 2000, radius: 15, drillAngle: 0, stats: { drillScale: 1.15 } };
  const first = pool.spawn(100, 100, 1, 0, 5);
  pool.update(5, player, null, silent, 4200, 4200, () => true);
  assert.equal(pool.count, 0, 'expired orbs return to the pool');
  assert.equal(pool.spawn(100, 100, 1, 0, 5), first, 'and are reused, not reallocated');
  pool.clear();
  for (let i = 0; i < 6; i++) pool.spawn(100, 100 + i, 1, 0, 5);
  assert.equal(pool.count, 4, 'the live cap holds');
  pool.clear();

  const rock = { x: 1700, y: 2000, radius: 30, hp: 10 };
  const terrain = { getNearbyAsteroids: () => [rock], cellsFor: () => 1 };
  pool.spawn(1600, 2000, 4, 0, 5);
  let hits = 0;
  for (let t = 0; t < 120; t++) pool.update(1 / 60, player, terrain, silent, 4200, 4200, () => { hits++; return true; });
  assert.equal(hits, 0, 'rock cover eats the orb');
  assert.equal(pool.count, 0);

  const { game, manager } = arena();
  game.wave = 1;
  manager.enemyBullets.spawn(1900, 2000, 4, 0, TUNING.enemyBulletDamage);
  for (let t = 0; t < 40 && manager.enemyBullets.count; t++) game.updateEnemyBullets(1 / 60);
  assert.equal(manager.enemyBullets.count, 0);
  assert.equal(game.player.hp, 100 - TUNING.enemyBulletDamage * damageRampAt(1), 'the shield outline takes the orb at its listed damage (wave-1 ramp)');

  game.player.invuln = 1;
  manager.enemyBullets.spawn(1900, 2000, 4, 0, TUNING.enemyBulletDamage);
  for (let t = 0; t < 30; t++) game.updateEnemyBullets(1 / 60);
  assert.equal(game.player.hp, 100 - TUNING.enemyBulletDamage * damageRampAt(1), 'a dash (invulnerability) passes straight through');
  assert.equal(manager.enemyBullets.count, 1, 'the orb flies on past the ship');

  game.triggerSupernova();
  assert.equal(manager.enemyBullets.count, 0, 'a supernova wipes hostile orbs');
});

test('shield plates block shots from the front; flank shots and area damage reach the hull', () => {
  // Exact full-damage checks; blast edge falloff has its own test.
  const savedFalloff = TUNING.splashEdgeFalloff;
  TUNING.splashEdgeFalloff = 0;
  try {
    resetTuning();
    const { game, manager } = arena();
    TUNING.splashEdgeFalloff = 0;
    const s = addEnemy(manager, 'shielder', 2400, 2000);
    s.x = 2400; s.y = 2000; s.shieldAngle = Math.PI; // plates face the ship at (2000, 2000)
    s.hp = s.maxHp = 1000;
    const shoot = (x, y, vx, vy) => {
      game.bullets = [{ x, y, vx, vy, damage: 10, pierce: 1, hue: 186, radius: 4, life: 1 }];
      for (let t = 0; t < 30 && game.bullets.length; t++) game.updateBullets(1 / 60);
    };
    shoot(2300, 2000, 14, 0);
    assert.equal(s.hp, 1000, 'a frontal shot is stopped by the plates');
    assert.equal(s.shieldFlash, 1);
    shoot(2500, 2000, -14, 0);
    assert.equal(s.hp, 990, 'a shot from behind hits the hull');
    shoot(2400, 1900, 0, 14);
    assert.equal(s.hp, 980, 'a shot from the flank hits the hull');
    game.damageEnemiesInRadius(2380, 2000, 60, 10);
    assert.equal(s.hp, 970, 'area damage ignores the plates');
    assert.equal(shieldBlocks(s, 2000, 2000, -1, 0), false, 'only inbound shots can be blocked');
    assert.equal(shieldBlocks(s, 2000, 2000, 1, 0), true);
  
    // A piercing shot that kills a hull in front of a shielder is not then stopped by dead plates.
    const fodder = addEnemy(manager, 'swarmer', 2250, 2000);
    fodder.x = 2250; fodder.y = 2000; fodder.hp = 1;
    const doomed = addEnemy(manager, 'shielder', 2330, 2000);
    doomed.x = 2330; doomed.y = 2000; doomed.shieldAngle = Math.PI; doomed.dead = false;
    game.bullets = [{ x: 2200, y: 2000, vx: 150, vy: 0, damage: 10, pierce: 3, hue: 186, radius: 4, life: 1 }];
    const kill = game.killEnemy.bind(game);
    game.killEnemy = (e, b) => { kill(e, b); if (e === fodder) doomed.dead = true; };
    game.updateBullets(1 / 60);
    delete game.killEnemy;
    assert.equal(doomed.shieldFlash, 0, 'plates of a hull that died mid-segment block nothing');
    assert.equal(game.bullets.length, 1, 'the shot flies on');
  } finally {
    TUNING.splashEdgeFalloff = savedFalloff;
  }
});

test('auto-aim prefers a hittable target over a shielder facing the ship, until it is flanked', () => {
  resetTuning();
  const { game, manager } = arena();
  const s = addEnemy(manager, 'shielder', 2150, 2000);
  const p = addEnemy(manager, 'pinwheel', 2350, 2000);
  s.x = 2150; s.y = 2000; p.x = 2350; p.y = 2000;
  s.shieldAngle = Math.PI;
  assert.equal(game.findAutoAimTarget(2000, 2000), p, 'plates facing the ship: aim at the pinwheel');
  assert.equal(game.findNearestEnemy(2000, 2000), s, 'homing weapons still take the nearest');
  s.shieldAngle = Math.PI / 2;
  assert.equal(game.findAutoAimTarget(2000, 2000), s, 'flanked: the shielder is fair game again');
});

test('blinker shows its landing ring for the full telegraph, then lands on a clear flank', () => {
  resetTuning();
  const rocks = [{ x: 2200, y: 1800, radius: 60, hp: 50 }];
  const { manager } = arena({ rocks });
  const player = { x: 2000, y: 2000 };
  const b = addEnemy(manager, 'blinker', 2400, 2000);
  b.aiTimer = 0;
  step(manager, player);
  assert.equal(b.state, 'telegraph');
  const dest = { x: b.blinkX, y: b.blinkY };
  const d = Math.hypot(dest.x - player.x, dest.y - player.y);
  assert.ok(d >= BLINKER.minDist - 1e-9 && d <= BLINKER.maxDist + 1e-9, 'lands 130–250 px from the ship, never on it');
  assert.ok(Math.hypot(dest.x - rocks[0].x, dest.y - rocks[0].y) > rocks[0].radius + b.radius, 'never inside rock');
  const before = { x: b.x, y: b.y };
  step(manager, player, Math.round(BLINKER.telegraph * 60) - 2);
  assert.ok(Math.hypot(b.x - before.x, b.y - before.y) < 20, 'stays put while the ring telegraphs');
  step(manager, player, 3);
  assert.equal(b.state, 'drift');
  assert.ok(Math.hypot(b.x - dest.x, b.y - dest.y) < b.speed * 4, 'teleported to the marked ring');
});

test('conduit links nearby allies: they take 30% less damage and move faster until the link breaks', () => {
  resetTuning();
  const { game, manager } = arena();
  const c = addEnemy(manager, 'conduit', 2500, 2500);
  const ally = addEnemy(manager, 'pinwheel', 2600, 2500);
  const loner = addEnemy(manager, 'pinwheel', 3200, 3200);
  step(manager, game.player);
  assert.ok(c.links.includes(ally));
  assert.ok(!c.links.includes(loner));
  ally.hp = loner.hp = 100;
  game.hitEnemy(ally, 10, 'blaster');
  game.hitEnemy(loner, 10, 'blaster');
  assert.equal(ally.hp, 100 - 10 * (1 - CONDUIT.armor));
  assert.equal(loner.hp, 90);
  game.killEnemy(c);
  step(manager, game.player, Math.ceil(CONDUIT.linkHold * 60) + 1);
  assert.equal(ally.linked, 0, 'links lapse once the conduit dies');
});

test('lieutenant rolls are reproducible and their modifiers fit the archetype', () => {
  resetTuning();
  const a = rollLieutenant(8, lieutenantTypes(8), seeded(3));
  const b = rollLieutenant(8, lieutenantTypes(8), seeded(3));
  assert.deepEqual(a, b);
  assert.equal(a.mods.length, 2, 'two modifiers from wave 7');
  assert.equal(rollLieutenant(2, lieutenantTypes(2), seeded(4)).mods.length, 1, 'one modifier early');
  assert.ok(a.epithet.startsWith('THE ') && a.name.length >= 4);
  for (let i = 0; i < 200; i++) {
    const lt = rollLieutenant(9, lieutenantTypes(9), seeded(i), 'shielder');
    assert.ok(!lt.mods.includes('shielded'), 'a shielder lieutenant never rolls a redundant shield');
    assert.ok(lt.mods.every(m => LT_MODIFIERS[m]));
  }
  assert.ok(!lieutenantTypes(9).includes('swarmer') && !lieutenantTypes(9).includes('blackhole'));
  assert.ok(!lieutenantTypes(2).includes('gunner'), 'lieutenants only use archetypes the wave has unlocked');
});

test('one lieutenant per non-boss wave, after the delay, behind any pending boss', () => {
  resetTuning();
  const { game, manager } = arena();
  const lieutenantsQueued = () => manager.spawnIndicators.filter(sp => sp.config.isLieutenant).length;
  game.wave = 1;
  game.waveTimer = TUNING.waveLength - 1;
  game.updateLieutenantSchedule();
  assert.equal(lieutenantsQueued(), 0, 'none before lieutenantFirstWave');

  game.wave = 2;
  game.waveTimer = TUNING.lieutenantDelay - 0.1;
  game.updateLieutenantSchedule();
  assert.equal(lieutenantsQueued(), 0, 'waits for the delay');
  game.waveTimer = TUNING.lieutenantDelay;
  game.updateLieutenantSchedule();
  game.updateLieutenantSchedule();
  assert.equal(lieutenantsQueued(), 1, 'exactly one per wave');
  // Elites make an entrance: on screen, well clear of the ship, over eliteEntranceTime.
  const sp = manager.spawnIndicators[0];
  assert.equal(sp.maxTimer, TUNING.eliteEntranceTime);
  assert.ok(sp.maxTimer > LIEUTENANT_WARMUP, 'slower than the old off-screen materialize');

  game.wave = 3;
  game.updateLieutenantSchedule();
  assert.equal(lieutenantsQueued(), 1, 'boss waves (every 3rd) get no lieutenant');

  game.wave = 4;
  game.pendingBossSpawns = [{ wave: 3, waveScale: 1 }];
  game.updateLieutenantSchedule();
  assert.equal(lieutenantsQueued(), 1, 'a boss still waiting for a slot keeps priority');
  game.pendingBossSpawns = [];
  manager.maxEnemies = manager.enemies.length + manager.spawnIndicators.length;
  game.updateLieutenantSchedule();
  assert.equal(game.lieutenantWave, 2, 'a full cap defers the lieutenant instead of skipping the wave');
  manager.maxEnemies = 200;
  game.updateLieutenantSchedule();
  assert.equal(game.lieutenantWave, 4);
  assert.equal(lieutenantsQueued(), 2);
});

test('lieutenants: elite stats, arrival card, sturdy vs contact/supernova, elite kill tier and reward', () => {
  resetTuning();
  const { game, manager } = arena();
  game.wave = 4;
  const lt = rollLieutenant(4, ['bruiser'], seeded(11), 'bruiser');
  lt.mods = ['armored'];
  const e = addEnemy(manager, 'bruiser', 2600, 2000, { lieutenant: lt });
  const plain = manager.getArchetype('bruiser', 1);
  assert.equal(e.isLieutenant, true);
  const boss = manager.getArchetype('boss', 1);
  assert.equal(e.maxHp, boss.maxHp * TUNING.lieutenantHpShare * 1.5, 'a heavy bruiser lieutenant gets the top heft (x1.5)');
  assert.ok(plain.maxHp < e.maxHp && e.maxHp < boss.maxHp, 'tougher than its archetype, short of a boss');
  for (const type of lieutenantTypes(9)) {
    const hp = manager.getArchetype(type, 2, { lieutenant: { type, name: 'X', epithet: 'Y', mods: ['hasted'] } }).maxHp;
    const bossHp = manager.getArchetype('boss', 2).maxHp;
    assert.ok(hp >= bossHp * 0.3 && hp <= bossHp * 0.6, `${type} lieutenant is 30–60% of a boss (${hp.toFixed(0)} / ${bossHp})`);
  }
  assert.equal(manager.lieutenantArrivals.length, 1);
  game.update(1 / 60);
  assert.equal(manager.lieutenantArrivals.length, 0, 'arrivals are drained once staged');
  assert.equal(game.ltCard.kind, 'arrival');
  assert.equal(game.ltCard.name, lt.name);
  assert.match(game.ltCard.detail, /ARMORED · [\d,]+ HP/);
  game.updateLieutenantHUD();
  assert.equal(document.getElementById('lt-card').classList.contains('hidden'), false);
  assert.equal(document.getElementById('lt-card-name').textContent, lt.name);

  e.hp = 1000;
  game.hitEnemy(e, 100, 'blaster');
  assert.equal(e.hp, 940, 'ARMORED takes 40% less damage');

  game.player.x = e.x; game.player.y = e.y;
  e.sinceHit = 5;
  game.triggerSupernova();
  assert.ok(manager.enemies.includes(e), 'a supernova strips HP from a lieutenant instead of erasing it');
  assert.equal(e.sinceHit, 0, 'the supernova counts as a hit (pauses regeneration)');
  game.player.x = 2000; game.player.y = 2000;

  game.hitStopTicks = 0;
  game.shake = 0;
  const cores = game.geoms.filter(g => g.isCore).length;
  e.hp = 1;
  game.hitEnemy(e, 50, 'blaster');
  assert.ok(!manager.enemies.includes(e));
  assert.equal(game.hitStopTicks, 1, 'lieutenants take the elite kill tier (1-tick hit-stop)');
  assert.ok(game.shake > 0);
  assert.equal(game.geoms.filter(g => g.isCore).length - cores, TUNING.lieutenantCoreReward, 'guaranteed Void Core reward');
  assert.equal(game.ltCard.kind, 'defeat');
  assert.match(game.ltCard.detail, /\+1 ❖ VOID CORE/);
});

test('splitting and regenerating lieutenants behave as labelled', () => {
  resetTuning();
  const { game, manager } = arena();
  const split = addEnemy(manager, 'gunner', 2600, 2000, { lieutenant: { type: 'gunner', name: 'VEXAX', epithet: 'THE MANIFOLD GUNNER', mods: ['splitting'] } });
  game.killEnemy(split);
  const copies = manager.spawnIndicators.filter(sp => sp.type === 'gunner');
  assert.equal(copies.length, 3);
  assert.ok(copies.every(sp => !sp.config.isLieutenant), 'the splits are regular gunners');

  manager.spawnIndicators.length = 0;
  const regen = addEnemy(manager, 'blinker', 3000, 2000, { lieutenant: { type: 'blinker', name: 'NYXON', epithet: 'THE UNDYING BLINKER', mods: ['regenerating'] } });
  assert.equal(regen.isLieutenant, true);
  regen.hp = regen.maxHp * 0.5;
  game.hitEnemy(regen, 1, 'blaster');
  step(manager, game.player, 60);
  assert.equal(regen.hp, regen.maxHp * 0.5 - 1, 'no regeneration within 1.5 s of a hit');
  step(manager, game.player, 120);
  assert.ok(regen.hp > regen.maxHp * 0.5, 'then it knits back together');
});

test('first spawn of each new archetype shows one intel card; sandbox buttons spawn them', () => {
  resetTuning();
  const { game, manager, banners } = arena();
  game.announceArchetype('gunner');
  assert.equal(game.ltCard.kind, 'intel');
  assert.equal(game.ltCard.name, ARCHETYPE_INFO.gunner.label);
  const id = game.ltCard.id;
  game.announceArchetype('gunner');
  assert.equal(game.ltCard.id, id, 'only once per run');

  // A newcomer pack refused by the enemy cap is not announced (it stays unseen for the next pack).
  game.ltCardTimer = 0;
  game.wave = 9;
  for (const pack of WAVE_PACKS) TUNING[pack.weightKey] = 0;
  TUNING.spawnWeightBlinker = 1;
  const cap = manager.maxEnemies;
  manager.maxEnemies = manager.enemies.length + manager.spawnIndicators.length;
  game.spawnWavePack();
  assert.equal(game.seenArchetypes.has('blinker'), false);
  manager.maxEnemies = cap;
  game.spawnWavePack();
  assert.equal(game.seenArchetypes.has('blinker'), true);
  assert.equal(game.ltCard.name, ARCHETYPE_INFO.blinker.label);
  manager.spawnIndicators.length = 0;
  resetTuning();
  game.wave = 1;

  Object.assign(game, {
    progression: { getBonuses: () => ({ moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 }), addCores() {} },
    sound: { ...silent, applyTuning() {} }
  });
  for (const action of ['SPAWN_BRUISER', 'SPAWN_GUNNER', 'SPAWN_SHIELDER', 'SPAWN_BLINKER', 'SPAWN_CONDUIT', 'SPAWN_LIEUTENANT']) game.applyLiveTuning(action);
  assert.deepEqual(manager.spawnIndicators.map(sp => sp.type).slice(0, 5), NEW_TYPES);
  assert.equal(manager.spawnIndicators.at(-1).config.isLieutenant, true);
  manager.maxEnemies = manager.spawnIndicators.length + manager.enemies.length;
  game.applyLiveTuning('SPAWN_LIEUTENANT');
  assert.match(banners.at(-1), /LIEUTENANT NOT SPAWNED/);
});

test('enemy variety tuning keys have schema entries with in-range defaults', () => {
  const items = new Map(TUNING_SCHEMA.flatMap(g => g.items).map(i => [i.key, i]));
  const keys = [...WAVE_PACKS.map(p => p.weightKey), 'enemyBulletSpeed', 'enemyBulletDamage', 'lieutenantHpShare', 'lieutenantMaxMods',
    'lieutenantFirstWave', 'lieutenantDelay', 'lieutenantCoreReward'];
  assert.ok(!('lieutenantHpMult' in DEFAULT_TUNING));
  for (const key of keys) {
    const item = items.get(key);
    assert.ok(item, `${key} is exposed in the tuner`);
    assert.ok(DEFAULT_TUNING[key] >= item.min && DEFAULT_TUNING[key] <= item.max, `${key} default within range`);
  }
  assert.ok(DEFAULT_TUNING.lieutenantDelay < DEFAULT_TUNING.waveLength, 'lieutenants arrive inside their wave');
});

test('a new run clears orbs, lieutenant schedule and intel memory', () => {
  resetTuning();
  const manager = new EnemyManager();
  manager.enemyBullets.spawn(10, 10, 1, 1, 5);
  manager.lieutenantArrivals.push({});
  manager.clear();
  assert.equal(manager.enemyBullets.count, 0);
  assert.equal(manager.lieutenantArrivals.length, 0);

  const g = Object.create(Game.prototype);
  Object.assign(g, {
    progression: { getBonuses: () => ({ moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1, extraBombs: 0, bonusHp: 0 }) },
    particles: { clear() {} }, grid: { reset() {} }, enemyManager: manager,
    asteroidManager: { generateSector() {} }, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, keys: {}, mouse: {},
    updateHUD() {}, lieutenantWave: 5, ltCardTimer: 2, seenArchetypes: new Set(['gunner'])
  });
  g.resetRun();
  assert.equal(g.lieutenantWave, 0);
  assert.equal(g.ltCardTimer, 0);
  assert.equal(g.seenArchetypes.size, 0);
});

test('elites spawn on screen away from the ship, then emerge at a crawl that ramps to full speed', async () => {
  resetTuning();
  const { pickOnscreenSpawn } = await import('../js/spawn-placement.js');
  const game = { player: { x: 2000, y: 2000 }, camX: 1360, camY: 1640, width: 1280, height: 720, zoom: 1, worldWidth: 4200, worldHeight: 4200,
    asteroidManager: { getNearbyAsteroids: () => [] } };
  for (let k = 0; k < 20; k++) {
    const pos = pickOnscreenSpawn(game, { pad: 40, minDist: TUNING.eliteSpawnMinDist });
    assert.ok(Math.hypot(pos.x - 2000, pos.y - 2000) >= TUNING.eliteSpawnMinDist + 40 - 1e-9);
  }
  const e = { emergeT: TUNING.eliteEmergeTime, emergeMax: TUNING.eliteEmergeTime };
  assert.ok(Math.abs(emergeFactor(e) - 0.15) < 1e-9, 'arrives at a crawl');
  e.emergeT = TUNING.eliteEmergeTime / 2;
  assert.ok(emergeFactor(e) > 0.15 && emergeFactor(e) < 1);
  e.emergeT = 0;
  assert.equal(emergeFactor(e), 1);
  assert.equal(emergeFactor({}), 1, 'ordinary enemies are never slowed');
});
