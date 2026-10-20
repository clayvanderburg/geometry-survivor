import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { Game } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');
const { TUNING } = await import('../js/config.js');
const silent = new Proxy({}, { get: () => () => {} });

function cappedWaveGame() {
  const manager = new EnemyManager();
  manager.enemies = Array.from({ length: manager.maxEnemies }, (_, i) => ({ x: 100 + i, y: 100, radius: 10, hp: 100, type: 'swarmer' }));
  // Freeze physical motion to isolate wave scheduling; admission is the real implementation.
  manager.update = () => {};
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 100, dashTimer: 0, dashCooldown: 0, stats: { moveSpeed: 5, luck: 1, xpMultiplier: 1, magnetRadius: 145 }, weapons: {} },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave: 4, waveTimer: TUNING.waveLength, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 99,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [],
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
}

test('a scheduled boss waits for a full enemy cap and enters after a slot opens', () => {
  const g = cappedWaveGame();
  g.update(1 / 60);
  assert.equal(g.wave, 5);
  assert.equal(g.enemyManager.enemies.length + g.enemyManager.spawnIndicators.length, 200);
  g.enemyManager.enemies.pop();
  g.update(1 / 60);
  assert.ok(g.enemyManager.spawnIndicators.some(spawn => spawn.config.isBoss) || g.enemyManager.enemies.some(enemy => enemy.isBoss), 'wave-5 boss must not disappear permanently when admission is temporarily full');
});


test('multiple delayed bosses retain FIFO wave scaling, announce only admission, and never duplicate', () => {
  const g = cappedWaveGame();
  // The boss warning (klaxon + HUD strip) is the announcement; it must fire only on admission.
  let warnings = 0; g.sound = { ...silent, playBossWarning() { warnings++; }, setMusicState() {} };
  g.update(1 / 60);
  const wave5Scale = g.getWaveScale();
  assert.deepEqual(g.pendingBossSpawns.map(request => request.wave), [5]);
  assert.equal(warnings, 0);
  g.wave = 9; g.waveTimer = TUNING.waveLength;
  g.update(1 / 60);
  const wave10Scale = g.getWaveScale();
  assert.deepEqual(g.pendingBossSpawns.map(request => request.wave), [5, 10]);
  g.enemyManager.enemies.splice(-2);
  g.update(1 / 60);
  const bosses = g.enemyManager.spawnIndicators.filter(spawn => spawn.config.isBoss);
  assert.equal(bosses.length, 2);
  // Wave 10 is a major boss: 1.8x the minor-boss HP formula.
  assert.deepEqual(bosses.map(spawn => spawn.config.maxHp), [650 * wave5Scale * TUNING.bossHpMult * TUNING.campaignBossHpMult * TUNING.enemyHpMult, 650 * wave10Scale * TUNING.bossHpMult * TUNING.campaignBossHpMult * 1.8 * TUNING.enemyHpMult]);
  assert.equal(g.pendingBossSpawns.length, 0);
  assert.equal(g.enemyManager.enemies.length + g.enemyManager.spawnIndicators.length, 200);
  assert.equal(warnings, 2);
  g.update(1 / 60);
  assert.equal(g.enemyManager.spawnIndicators.length, 2);
  assert.equal(warnings, 2);
});

test('restarting clears delayed bosses and previous pending indicators', () => {
  const g = cappedWaveGame();
  g.update(1 / 60);
  assert.equal(g.pendingBossSpawns.length, 1);
  g.progression.getBonuses = () => ({ bonusHp: 0, extraBombs: 0, moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 });
  g.asteroidManager.generateSector = () => {};
  g.resetRun();
  assert.deepEqual(g.pendingBossSpawns, []);
  assert.deepEqual(g.enemyManager.spawnIndicators, []);
  assert.equal(g.wave, 1);
});

test('scheduled bosses receive newly freed slots before ordinary spawning', () => {
  const g = cappedWaveGame();
  g.update(1 / 60);
  g.enemyManager.enemies.pop(); g.spawnCooldown = 0;
  let bossPresentWhenOrdinarySpawned = false;
  g.spawnWavePack = () => { bossPresentWhenOrdinarySpawned = g.enemyManager.spawnIndicators.some(spawn => spawn.config.isBoss); };
  g.update(1 / 60);
  assert.equal(bossPresentWhenOrdinarySpawned, true);
  assert.equal(g.enemyManager.enemies.length + g.enemyManager.spawnIndicators.length, 200);
});

test('splitter death respects the remaining population budget', () => {
  const g = cappedWaveGame();
  const splitter = g.enemyManager.enemies[0];
  Object.assign(splitter, { type: 'splitter', score: 95, xp: 4, rotation: 0, hue: 42, sides: 6 });
  Object.assign(g, { kills: 0, score: 0, coresDroppedThisWave: 0 });
  Object.assign(g.player.stats, { coreDropMult: 1, damage: 11 });
  g.killEnemy(splitter);
  assert.equal(g.enemyManager.enemies.length, 199);
  assert.equal(g.enemyManager.spawnIndicators.length, 1);
  assert.equal(g.enemyManager.spawnIndicators[0].type, 'mini_splitter');
  assert.equal(g.kills, 1);
  assert.equal(g.score, 95);
});
