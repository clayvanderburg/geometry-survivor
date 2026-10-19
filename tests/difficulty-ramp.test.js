import test from 'node:test';
import assert from 'node:assert/strict';

// Difficulty Ramp tuning group: every per-wave growth term the game uses (wave length, enemy HP scale,
// pack cadence and size, contact/orb damage ramp, kill XP) is read live from TUNING. These tests pin
// the wiring with non-default values, so they hold whatever the shipped defaults are.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const fakeElement = () => ({
  textContent: '', innerHTML: '', style: {}, value: '', offsetWidth: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {}, addEventListener() {}
});
globalThis.document = { getElementById: fakeElement, createElement: fakeElement, querySelectorAll: () => [], activeElement: null };

const { Game } = await import('../js/main.js');
const { EnemyManager, waveScaleAt, damageRampAt, xpScaleAt, spawnIntervalAt, packSize, contactDamageAt, easeIn } = await import('../js/enemies.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const fieldGuide = await import('../js/field-guide.js');
const { hpBudgetScale } = await import('../js/waves.js');
const silent = new Proxy({}, { get: () => () => {} });

const RAMP_KEYS = [
  'waveLength', 'waveHpStart', 'waveHpStartLight', 'waveHpPerWave', 'waveHpGrowth', 'waveHpGrowthFrom', 'waveHpGrowthRamp', 'spawnIntervalStart', 'spawnIntervalTau', 'spawnIntervalMin',
  'packSizeMult', 'swarmPackPerWave', 'swarmPackMax', 'skirmishPackPerWave', 'skirmishPackMax', 'splitterPackPerWave', 'splitterPackMax',
  'mayflyPackPerWave', 'mayflyPackMax', 'hpBudget', 'hpBudgetMin', 'hpBudgetMax',
  'bossHpMult', 'damageRampBase', 'damageRampFrom', 'damageRampPerWave', 'damageRampSmooth', 'xpPerWave'
];

function withTuning(values, fn) {
  Object.assign(TUNING, DEFAULT_TUNING, values);
  try { return fn(); } finally { Object.assign(TUNING, DEFAULT_TUNING); }
}

function rampGame({ wave = 1 } = {}) {
  const manager = new EnemyManager();
  manager.update = () => {};
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: {
      x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, bombs: 0,
      stats: { moveSpeed: 5, luck: 1, xpMultiplier: 1, magnetRadius: 145, coreDropMult: 1, damage: 11 }, weapons: {}, upgradeLevels: {}, xp: 0, xpToNext: 1e9, level: 1
    },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 99,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], seenArchetypes: new Set(),
    score: 0, kills: 0, shake: 0, chromaFlash: 0, coresDroppedThisWave: 0, lieutenantWave: 0,
    showBanner() {}, updateHUD() {}, announceArchetype() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
}

test('every Difficulty Ramp key is in the tuner group with an in-range default', () => {
  const group = TUNING_SCHEMA.find(g => /Difficulty Ramp/.test(g.group));
  assert.ok(group, 'Difficulty Ramp group exists');
  const keys = group.items.map(i => i.key);
  assert.deepEqual(keys, RAMP_KEYS);
  for (const item of group.items) {
    assert.equal(typeof DEFAULT_TUNING[item.key], 'number', `${item.key} has a numeric default`);
    assert.ok(DEFAULT_TUNING[item.key] >= item.min && DEFAULT_TUNING[item.key] <= item.max, `${item.key} default within range`);
  }
  assert.ok(DEFAULT_TUNING.lieutenantDelay < DEFAULT_TUNING.waveLength, 'lieutenants still arrive inside their wave');
});

test('enemy HP scale follows the linear and compound ramp terms, for the game and the Field Guide', () => {
  withTuning({ waveHpStart: 2, waveHpPerWave: 0.5, waveHpGrowth: 1.1, waveHpGrowthFrom: 4, waveHpGrowthRamp: 0 }, () => {
    for (const wave of [1, 4, 5, 12, 40]) {
      const expected = (2 + (wave - 1) * 0.5) * Math.pow(1.1, Math.max(0, wave - 4));
      assert.ok(Math.abs(waveScaleAt(wave) - expected) < 1e-9, `wave ${wave}`);
      assert.equal(Game.prototype.getWaveScale.call({ wave }), waveScaleAt(wave));
      assert.equal(fieldGuide.waveScaleAt(wave), waveScaleAt(wave));
    }
    // Every spawned hull (bosses and lieutenants included) reads the same scale.
    const g = rampGame({ wave: 9 });
    g.enemyManager.queueSpawn('swarmer', 0, 0, g.getWaveScale(), { instant: true });
    assert.ok(Math.abs(g.enemyManager.spawnIndicators[0].config.maxHp - 10 * TUNING.enemyHpMult * waveScaleAt(9)) < 1e-9);
  });
});

test('boss HP multiplier scales bosses, and lieutenants through their share of boss HP', () => {
  const manager = new EnemyManager();
  const lt = { type: 'pinwheel', name: 'X', epithet: 'Y', mods: ['hasted'] };
  const [boss1, lt1] = withTuning({ bossHpMult: 1 }, () => [manager.getArchetype('boss', 4).maxHp, manager.getArchetype('pinwheel', 4, { lieutenant: lt }).maxHp]);
  const [boss2, lt2] = withTuning({ bossHpMult: 2 }, () => [manager.getArchetype('boss', 4).maxHp, manager.getArchetype('pinwheel', 4, { lieutenant: lt }).maxHp]);
  assert.equal(boss1, 650 * 4);
  assert.equal(boss2, 2 * boss1);
  assert.ok(lt2 > lt1, 'lieutenants follow boss HP');
  assert.equal(withTuning({ bossHpMult: 2 }, () => manager.getArchetype('swarmer', 4).maxHp), 40, 'regular hulls are unaffected');
});

test('waves advance every waveLength seconds and bosses stay on every third wave', () => {
  withTuning({ waveLength: 31 }, () => {
    const g = rampGame({ wave: 2 });
    g.waveTimer = 30.9;
    g.update(1 / 60);
    assert.equal(g.wave, 2, 'not yet');
    g.waveTimer = 31;
    g.update(1 / 60);
    assert.equal(g.wave, 3);
    assert.equal(g.waveTimer, 0);
    assert.ok(g.enemyManager.spawnIndicators.some(sp => sp.config.isBoss) || g.pendingBossSpawns.length === 1, 'wave 3 schedules a boss');
  });
});

test('pack cadence reads the spawn-interval ramp', () => {
  withTuning({ spawnIntervalStart: 3, spawnIntervalTau: 5, spawnIntervalMin: 1.2 }, () => {
    assert.ok(Math.abs(spawnIntervalAt(5) - (1.2 + 1.8 / Math.E)) < 1e-9, 'one tau closes 63% of the gap');
    assert.ok(spawnIntervalAt(60) > 1.2 && spawnIntervalAt(60) - 1.2 < 0.001, 'approaches the floor without a corner');
    const g = rampGame({ wave: 5 });
    g.spawnCooldown = 0;
    g.spawnWavePack = () => {};
    g.update(1 / 60);
    assert.ok(Math.abs(g.spawnCooldown - spawnIntervalAt(5) * hpBudgetScale(5)) < 1e-9, 'the HP budget paces packs');
  });
  withTuning({ spawnIntervalStart: 3, spawnIntervalTau: 5, spawnIntervalMin: 1.2, hpBudget: 0 }, () => {
    const g = rampGame({ wave: 5 });
    g.spawnCooldown = 0;
    g.spawnWavePack = () => {};
    g.update(1 / 60);
    assert.ok(Math.abs(g.spawnCooldown - spawnIntervalAt(5)) < 1e-9, 'with the budget off, the plain ramp');
  });
});

test('pack sizes read the per-wave growth, caps and the global multiplier', () => {
  const queued = (values, pack, wave) => withTuning({ packSizeMult: 1, swarmPackPerWave: 2, swarmPackMax: 34, skirmishPackMax: 99, splitterPackMax: 99, ...values, spawnWeightSwarm: 0, spawnWeightSkirmish: 0, spawnWeightSplitter: 0, spawnWeightBlackhole: 0,
    spawnWeightBruiser: 0, spawnWeightGunner: 0, spawnWeightShielder: 0, spawnWeightBlinker: 0, spawnWeightConduit: 0, spawnWeightMayfly: 0, spawnWeightHulk: 0, [pack]: 1 }, () => {
    const g = rampGame({ wave });
    g.spawnWavePack();
    return g.enemyManager.spawnIndicators.length;
  });
  assert.equal(queued({ swarmPackPerWave: 3, swarmPackMax: 99 }, 'spawnWeightSwarm', 10), 12 + 30);
  assert.equal(queued({ swarmPackPerWave: 3, swarmPackMax: 20 }, 'spawnWeightSwarm', 10), 20);
  assert.equal(queued({ swarmPackPerWave: 3, swarmPackMax: 20, packSizeMult: 1.5 }, 'spawnWeightSwarm', 10), 30);
  assert.equal(queued({ skirmishPackPerWave: 1 }, 'spawnWeightSkirmish', 10), 3 + 10);
  assert.equal(queued({ splitterPackPerWave: 0.5 }, 'spawnWeightSplitter', 10), 2 + 5);
  assert.equal(queued({ splitterPackPerWave: 0.5, packSizeMult: 0.5 }, 'spawnWeightSplitter', 10), 4);
  assert.equal(queued({ splitterPackPerWave: 0.5, splitterPackMax: 5 }, 'spawnWeightSplitter', 10), 5);
  assert.equal(queued({ skirmishPackPerWave: 1, skirmishPackMax: 8 }, 'spawnWeightSkirmish', 10), 8);
  assert.equal(queued({ packSizeMult: 2 }, 'spawnWeightBlinker', 9), 6, 'capped packs scale too');
  assert.equal(queued({ mayflyPackPerWave: 1 }, 'spawnWeightMayfly', 8), 12 + 5, 'mayfly clouds grow from their debut wave');
  assert.equal(queued({ mayflyPackPerWave: 1, mayflyPackMax: 14 }, 'spawnWeightMayfly', 8), 14);
  withTuning({ packSizeMult: 0.25 }, () => assert.equal(packSize(1), 1, 'never below one hull'));
});

test('contact and plasma-orb damage share the damage ramp', () => {
  withTuning({ damageRampBase: 1, damageRampFrom: 10, damageRampPerWave: 0.2, damageRampSmooth: 0 }, () => {
    assert.equal(damageRampAt(10), 1);
    assert.ok(Math.abs(damageRampAt(15) - 2) < 1e-9);
    const g = rampGame({ wave: 15 });
    assert.ok(Math.abs(g.contactDamage({ contactMult: 1 }) - 36) < 1e-9);
    assert.ok(Math.abs(contactDamageAt({ isBoss: true }, 15) - 76) < 1e-9);
    assert.ok(Math.abs(g.enemyBulletDamage({ damage: 12 }) - 24) < 1e-9);
  });
  withTuning({ damageRampBase: 0.5, damageRampFrom: 10, damageRampPerWave: 0.1, damageRampSmooth: 0 }, () => {
    assert.equal(damageRampAt(3), 0.5);
    assert.ok(Math.abs(contactDamageAt({ contactMult: 1 }, 20) - 18 * 1.5) < 1e-9);
  });
});

test('kill XP grows with xpPerWave', () => {
  const dropped = (values, wave) => withTuning(values, () => {
    const g = rampGame({ wave });
    const e = g.enemyManager.getArchetype('splitter', 1);
    Object.assign(e, { x: 2500, y: 2500, vx: 0, vy: 0, dead: false, rotation: 0, sides: 6, hue: 0 });
    g.enemyManager.enemies.push(e);
    g.killEnemy(e, true);
    return g.geoms.filter(x => !x.isCore).reduce((a, x) => a + x.xp, 0);
  });
  assert.equal(dropped({ xpPerWave: 0 }, 11), 4);
  assert.equal(dropped({ xpPerWave: 0.1 }, 11), 8);
  withTuning({ xpPerWave: 0.05 }, () => assert.ok(Math.abs(xpScaleAt(21) - 2) < 1e-9));
});

test('light swarm fodder keeps the light HP start; tougher hulls get the extra early HP', async () => {
  const { LIGHT_ENEMY_TYPES } = await import('../js/enemies.js');
  for (const t of ['swarmer', 'pinwheel', 'weaver', 'mini_splitter']) assert.ok(LIGHT_ENEMY_TYPES.has(t), t);
  for (const t of ['splitter', 'bruiser', 'gunner', 'shielder', 'blinker', 'conduit', 'boss']) assert.ok(!LIGHT_ENEMY_TYPES.has(t), t);
  withTuning({ waveHpStart: 2.5, waveHpStartLight: 1, waveHpPerWave: 0.25, waveHpGrowth: 1.065, waveHpGrowthFrom: 25 }, () => {
    assert.equal(waveScaleAt(1, { light: true }), 1);
    assert.equal(waveScaleAt(1), 2.5);
    const g = Object.create(Game.prototype);
    g.wave = 1;
    assert.equal(g.getWaveScale('swarmer'), 1);
    assert.equal(g.getWaveScale('bruiser'), 2.5);
    assert.equal(g.getWaveScale(), 2.5);
  });
});

test('spawn density: the pre-0.13 amounts, a touch denser since v0.29 and v0.31', () => {
  assert.equal(DEFAULT_TUNING.spawnIntervalStart, 2.6);
  assert.equal(DEFAULT_TUNING.spawnIntervalTau, 7);
  assert.equal(DEFAULT_TUNING.spawnIntervalMin, 0.65);
  assert.equal(DEFAULT_TUNING.packSizeMult, 1.2);
});

test('the difficulty ramps ease in: no corner where HP compounding, damage ramp or spawn floor switch on', () => {
  // easeIn: 0 at the start, slope rising smoothly to 1, then a straight line.
  assert.equal(easeIn(-3, 10), 0);
  assert.ok(Math.abs(easeIn(10, 10) - 5) < 1e-9 && Math.abs(easeIn(20, 10) - 15) < 1e-9);
  withTuning({}, () => {
    // The per-wave growth of every ramp changes gradually: no wave jumps far above its neighbours.
    const growth = (f, w) => f(w + 1) / f(w);
    for (let w = 2; w < 80; w++) {
      assert.ok(Math.abs(growth(waveScaleAt, w + 1) - growth(waveScaleAt, w)) < 0.01, `HP growth eases at wave ${w}`);
      assert.ok(Math.abs((damageRampAt(w + 2) - damageRampAt(w + 1)) - (damageRampAt(w + 1) - damageRampAt(w))) < 0.006, `damage ramp eases at wave ${w}`);
      assert.ok(spawnIntervalAt(w + 1) < spawnIntervalAt(w), `packs keep tightening at wave ${w}`);
    }
  });
});
