import test from 'node:test';
import assert from 'node:assert/strict';

// Browser services are stubbed; tests drive the real Game.update pickup loop.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');
const { TUNING } = await import('../js/config.js');
const silent = new Proxy({}, { get: () => () => {} });

function arena() {
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: new EnemyManager(),
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, xp: 0, xpToNext: 1e9, level: 1,
      stats: { moveSpeed: TUNING.moveSpeed, luck: 1, xpMultiplier: 1, magnetRadius: 145, damage: 11, coreDropMult: 1, fireRate: 0 }, weapons: {} },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave: 1, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 1e9,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, kills: 0, score: 0, coresDroppedThisWave: 0, shake: 0,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], singularityTimer: 1e9,
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
}

const geom = (x, y, extra = {}) => ({ isCore: false, x, y, vx: 0, vy: 0, xp: 1, rotation: 0, hue: 145, magnetized: false, ...extra });

test('dropped XP geoms, Void Cores and gold never expire', () => {
  const game = arena();
  game.geoms = [geom(3000, 3000), geom(3100, 3000, { isCore: true, coreAmount: 1, xp: 2 }), geom(3000, 3100, { isGold: true, gold: 1, xp: 0 })];
  for (let t = 0; t < 60 * 120; t++) game.update(1 / 60); // two minutes away from them
  assert.equal(game.geoms.length, 3, 'all pickups still on the field');
  game.player.x = 3030; game.player.y = 3030; // circle back
  for (let t = 0; t < 120; t++) game.update(1 / 60);
  assert.equal(game.geoms.length, 0, 'all collected on return');
  assert.equal(game.player.xp, 3);
});

test('past the cap, the oldest loose XP geoms merge into neighbours without losing XP', () => {
  const game = arena();
  const n = 500;
  for (let k = 0; k < n; k++) game.geoms.push(geom(100 + (k % 50) * 20, 100 + Math.floor(k / 50) * 20, { xp: 3 }));
  const core = geom(4000, 4000, { isCore: true, coreAmount: 1, xp: 2 });
  game.geoms.push(core);
  game.mergeLooseGeoms();
  const loose = game.geoms.filter(g => !g.isCore);
  assert.equal(loose.length, 400);
  assert.equal(loose.reduce((a, g) => a + g.xp, 0), n * 3, 'total XP kept');
  assert.ok(game.geoms.includes(core), 'Void Cores are never merged away');
  assert.ok(loose.some(g => g.merged > 0));
});
