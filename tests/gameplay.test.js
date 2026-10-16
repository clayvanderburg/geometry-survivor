import test from 'node:test';
import assert from 'node:assert/strict';

// Browser services are deliberately stubbed; tests call the real gameplay methods.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game } = await import('../js/main.js');
const { UPGRADE_POOL, rollUpgrades } = await import('../js/upgrades.js');
const silent = new Proxy({}, { get: () => () => {} });
const enemy = (type = 'swarmer', extra = {}) => ({ type, x: 200, y: 200, hp: 100, maxHp: 100, radius: 10, hue: 1, score: 1, xp: 1, ...extra });
function game(enemies = []) {
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies, queueSpawn() {} },
    asteroidManager: { asteroids: [], cellSize: 140, getNearbyAsteroids() { return this.asteroids; } },
    sound: silent, particles: silent, grid: silent,
    player: { stats: { luck: 1, coreDropMult: 1, damage: 20 }, weapons: {}, upgradeLevels: {}, bombs: 0, hp: 100, maxHp: 100, x: 2000, y: 2000, xp: 0, xpToNext: 12, level: 1 },
    state: 'PLAYING', worldWidth: 4200, worldHeight: 4200, wave: 1, shake: 0, kills: 0,
    chests: [], bullets: [], geoms: [], score: 0, multiplier: 1, coresDroppedThisWave: 0,
    updateHUD() {}, progression: { addCores() {} }
  });
}
const bullet = (extra = {}) => ({ x: 172, y: 200, vx: 14, vy: 0, radius: 3.8, life: 1.25, pierce: 3, damage: 10, hue: 1, ...extra });

test('black-hole chain kills remove each enemy and award each death exactly once', () => {
  const g = game([enemy('swarmer', { hp: 1 }), enemy('swarmer', { hp: 1 }), enemy('blackhole', { hp: 1 })]);
  assert.doesNotThrow(() => g.damageEnemiesInRadius(200, 200, 200, 100));
  assert.equal(g.enemyManager.enemies.length, 0);
  assert.equal(g.kills, 3);
  assert.equal(g.score, 3);
});

test('piercing projectile hits a large target once across multiple ticks', () => {
  const boss = enemy('boss', { radius: 36, hp: 1000, isBoss: true });
  const g = game([boss]); g.bullets = [bullet()];
  for (let n = 0; n < 3; n++) g.updateBullets(1 / 60);
  assert.equal(boss.hp, 990);
  assert.equal(g.bullets[0].pierce, 2);
});

test('swept collision catches an enemy crossed between projectile endpoints', () => {
  const e = enemy(); const g = game([e]);
  g.bullets = [bullet({ x: 180, vx: 14 * 1.15 ** 7, pierce: 1 })];
  g.updateBullets(1 / 60);
  assert.equal(e.hp, 90);
  assert.equal(g.bullets.length, 0);
});

test('swept collision resolves near targets first and respects intervening cover', () => {
  const behind = enemy('swarmer', { x: 260 });
  const front = enemy('swarmer', { x: 160 });
  const g = game([behind, front]);
  g.asteroidManager.asteroids = [{ x: 200, y: 200, radius: 12, hp: 100 }];
  g.bullets = [bullet({ x: 100, vx: 200, pierce: 3 })];
  g.updateBullets(1 / 60);
  assert.equal(front.hp, 90);
  assert.equal(behind.hp, 100);
  assert.equal(g.bullets.length, 0);
});

test('shrapnel from a projectile kill is retained for the next tick', () => {
  const g = game([enemy('blackhole', { hp: 1 })]);
  g.killEnemy = function(e) { e.dead = true; this.enemyManager.enemies = []; this.bullets.push(bullet({ x: 700 })); };
  g.bullets = [bullet({ x: 180, vx: 40, pierce: 1 })];
  g.updateBullets(1 / 60);
  assert.equal(g.bullets.length, 1);
  assert.equal(g.bullets[0].x, 700);
});

test('pending XP grants consecutive choices after selecting the preceding upgrade', () => {
  const g = game(); g.player.xp = 100;
  const choice = { id: 'test', maxLevel: 5, levelJump: 1, apply() {} };
  g.triggerLevelUp = function() { this.state = 'UPGRADE'; this.currentChoices = [choice]; };
  g.processPendingLevelUps();
  assert.equal(g.player.level, 2);
  g.selectUpgrade(0);
  assert.equal(g.player.level, 3);
  assert.equal(g.state, 'UPGRADE');
  assert.equal(g.player.xp, 66);
});

test('shared upgrade application honors lucky level jumps and caps ranks', () => {
  const g = game(); let applications = 0;
  const u = { id: 'test', maxLevel: 3, levelJump: 3, apply() { applications++; } };
  g.player.upgradeLevels.test = 1;
  assert.equal(g.applyUpgrade(u), 2);
  assert.equal(applications, 2);
  assert.equal(g.player.upgradeLevels.test, 3);
});

test('upgrade roll returns unique eligible choices with valid rank jumps', () => {
  const g = game(); g.player.stats.luck = 5;
  for (let i = 0; i < 100; i++) {
    const choices = rollUpgrades(g.player, 3);
    assert.equal(new Set(choices.map(u => u.id)).size, choices.length);
    for (const u of choices) {
      assert.ok(u.levelJump >= 1 && u.levelJump <= u.maxLevel);
      assert.ok(!u.req || u.req(g.player));
      assert.ok(UPGRADE_POOL.some(candidate => candidate.id === u.id));
    }
  }
});


test('swept rock broadphase matches an independent distance oracle for large rocks and long segments', async () => {
  const { AsteroidManager } = await import('../js/asteroids.js');
  let seed = 123456789;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let trial = 0; trial < 150; trial++) {
    const g = game(); const manager = new AsteroidManager(4200, 4200);
    manager.asteroids = Array.from({ length: 25 }, () => ({ x: 400 + random() * 3000, y: 400 + random() * 3000, radius: 10 + random() * 400, hp: 100 }));
    manager.rebuildSpatialHash(); g.asteroidManager = manager;
    const x0 = 500 + random() * 2500, y0 = 500 + random() * 2500;
    const x1 = 500 + random() * 2500, y1 = 500 + random() * 2500;
    const dx = x1 - x0, dy = y1 - y0;
    const expected = manager.asteroids.some(rock => {
      const t = Math.max(0, Math.min(1, ((rock.x - x0) * dx + (rock.y - y0) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(rock.x - x0 - t * dx, rock.y - y0 - t * dy) <= rock.radius + 3.8;
    });
    g.bullets = [bullet({ x: x0, y: y0, vx: dx, vy: dy })];
    g.updateBullets(1 / 60);
    assert.equal(g.bullets.length === 0, expected, 'trial ' + trial);
  }
});

test('relic caches apply multi-level upgrade rolls rather than discarding their jump', () => {
  const g = game();
  Object.assign(g.player.stats, { miningSpeed: 75, miningRange: 43, drillScale: 1, luck: 1 });
  const original = Math.random;
  try {
    Math.random = () => 0;
    g.openRelicChest({ guaranteedSuper: false });
    assert.equal(g.player.upgradeLevels.mining_speed, 6);
    assert.equal(g.player.stats.miningSpeed, 75 * 1.5 ** 6 * (g.player.weapons.tectonicBore ? 1.9 : 1));
  } finally { Math.random = original; }
});
