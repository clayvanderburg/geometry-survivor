import test from 'node:test';
import assert from 'node:assert/strict';

// Browser adapters only: game modules and scheduling logic below are the production code.
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = undefined;
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { SoundEngine } = await import('../js/audio.js');
const { EnemyManager } = await import('../js/enemies.js');
const { SpatialIndex } = await import('../js/spatial-index.js');
const { ParticleSystem } = await import('../js/particles.js');
const { WarpGrid } = await import('../js/grid.js');

test('audio survives inaccessible storage and rejects invalid saved gains', () => {
  const original = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
    assert.equal(new SoundEngine().masterVolumePct, 100);
    for (const [stored, expected] of [['Infinity', 100], ['NaN', 100], ['999', 200], ['-20', 0], ['75', 75]]) {
      globalThis.localStorage = { getItem: () => stored };
      assert.equal(new SoundEngine().masterVolumePct, expected);
    }
    const engine = new SoundEngine();
    engine.setMasterVolume(NaN);
    assert.equal(engine.masterVolumePct, 75);
  } finally { globalThis.localStorage = original; }
});

test('scheduler drops overdue events while preserving musical step phase', () => {
  const engine = new SoundEngine();
  engine.ctx = { currentTime: 60 };
  engine.isPlayingMusic = true;
  engine.nextNoteTime = 0.05;
  const scheduled = [];
  engine.triggerStep = (step, time) => scheduled.push({ step, time });
  const stepDuration = 60 / engine.bpm / 4;
  const missed = Math.ceil((60 - 0.05) / stepDuration);
  engine.scheduleMusic();
  assert.ok(scheduled.length <= 2, 'a timer gap must not allocate hundreds of overdue notes');
  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0].step, missed % 64);
  assert.ok(scheduled.every(event => event.time >= 60 && event.time < 60.1));
});

test('future scheduled beat keeps the currently audible beat pulse', () => {
  const engine = new SoundEngine();
  engine.ctx = { currentTime: 10.1 };
  engine.isPlayingMusic = true;
  engine.lastBeatTime = 10;
  for (const method of ['playKick', 'playBassNote', 'playSnare', 'playHiHat', 'playArpNote', 'playChordPad']) engine[method] = () => {};
  engine.triggerStep(4, 10.2, 0.1);
  assert.ok(engine.getBeatPulse() > 0);
  assert.equal(engine.lastBeatTime, 10);
  engine.ctx.currentTime = 10.2;
  assert.equal(engine.getBeatPulse(), 1);
  assert.equal(engine.lastBeatTime, 10.2);
});

test('audio disposal clears timer and releases context and buses', async () => {
  const engine = new SoundEngine();
  let closed = false;
  engine.ctx = { state: 'running', close: async () => { closed = true; } };
  engine.isPlayingMusic = true;
  engine.schedulerId = setInterval(() => {}, 1000);
  engine.masterGain = { disconnect() {} };
  await engine.dispose();
  assert.equal(closed, true);
  assert.equal(engine.ctx, null);
  assert.equal(engine.schedulerId, null);
  assert.equal(engine.isPlayingMusic, false);
});

test('enemy budget includes pending packs and releases slots on clear', () => {
  const manager = new EnemyManager({ maxEnemies: 3 });
  assert.equal(manager.queueSpawn('swarmer', 10, 10), true);
  manager.spawnBoidSwarm(100, 100, 20, 1, 4200, 4200);
  assert.equal(manager.spawnIndicators.length, 3);
  assert.equal(manager.queueSpawn('boss', 10, 10), false);
  manager.clear();
  assert.equal(manager.queueSpawn('boss', 10, 10), true);
});

test('spatial queries retain every exact neighbor after cell crossings', () => {
  const index = new SpatialIndex(128);
  const points = Array.from({ length: 120 }, (_, i) => ({ x: (i * 107) % 1200 - 100, y: (i * 193) % 1200 - 100 }));
  index.rebuild(points);
  points[0].x = 900;
  points[0].y = 901;
  index.update(points[0]);
  for (const radius of [28, 80, 120, 220]) {
    for (const center of points) {
      const found = new Set(index.query(center.x, center.y, radius));
      for (const point of points) {
        if (Math.hypot(point.x - center.x, point.y - center.y) <= radius) assert.ok(found.has(point));
      }
    }
  }
  assert.ok([...index.query(-1000, -1000, 80)].length === 0);
});

test('enemy spatial behavior runs with mixed archetypes and nearby projectiles', () => {
  const manager = new EnemyManager();
  for (const [i, type] of ['swarmer', 'weaver', 'blackhole', 'pinwheel', 'splitter'].entries()) manager.queueSpawn(type, 100 + i * 20, 100, 1, { instant: true });
  manager.update(1 / 30, { x: 1000, y: 1000 }, [{ x: 110, y: 110, vx: 3, vy: 2 }], { applyImpulse() {}, applyImplosion() {} }, { applyGravityWell() {} }, 4200, 4200);
  assert.equal(manager.enemies.length, 5);
  assert.ok(manager.enemies.every(enemy => [enemy.x, enemy.y, enemy.vx, enemy.vy].every(Number.isFinite)));
});

test('offscreen effects and enemy indicators issue no canvas draws', () => {
  let calls = 0;
  const ctx = new Proxy({}, { get: () => () => { calls++; }, set: () => true });
  const particles = new ParticleSystem();
  particles.spawnExplosionSparks(1000, 1000, 5, 190);
  particles.spawnShockwave(1000, 1000, 100, 190);
  particles.spawnLightning(1000, 1000, 1100, 1100);
  particles.spawnFloatText(1000, 1000, 'far');
  particles.draw(ctx, 0, 0, 100, 100);
  assert.equal(calls, 2, 'only save and restore are needed');
  calls = 0;
  const enemies = new EnemyManager();
  enemies.queueSpawn('swarmer', 1000, 1000);
  enemies.draw(ctx, 0, 0, 100, 100);
  assert.equal(calls, 2);
});

test('new run reset removes residual particle and grid impulses', () => {
  const particles = new ParticleSystem();
  particles.spawnExplosionSparks(100, 100, 3, 190);
  particles.clear();
  assert.equal(particles.sparks.length, 0);
  const grid = new WarpGrid(500, 500);
  grid.applyImpulse(200, 200, 30, 150);
  assert.ok(grid.points.some(point => point.energy > 0));
  grid.reset();
  assert.ok(grid.points.every(point => point.x === point.ox && point.y === point.oy && point.vx === 0 && point.vy === 0 && point.energy === 0));
});


test('final audio safety stage preserves quiet gain and bounds overload after compressor', async () => {
  const original = window.AudioContext;
  const parameter = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), destinations: [], connect(target) { this.destinations.push(target); }, disconnect() { this.disconnected = true; } });
  const compressor = node();
  for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) compressor[key] = parameter();
  const limiter = node();
  const destination = {};
  const ctx = { currentTime: 0, state: 'running', destination, createDynamicsCompressor: () => compressor, createWaveShaper: () => limiter, createGain: node, createBiquadFilter: node, close: async () => {} };
  window.AudioContext = function () { return ctx; };
  try {
    const engine = new SoundEngine();
    engine.startMusic = () => {};
    engine.init();
    assert.deepEqual(compressor.destinations, [limiter]);
    assert.deepEqual(limiter.destinations, [destination]);
    assert.equal(limiter.oversample, 'none');
    const curve = limiter.curve;
    for (let i = 0; i < curve.length; i++) {
      const input = (i / (curve.length - 1)) * 2 - 1;
      assert.ok(Number.isFinite(curve[i]));
      assert.ok(Math.abs(curve[i]) <= 0.980001);
      if (Math.abs(input) <= 0.8) assert.ok(Math.abs(curve[i] - input) < 1e-7);
      assert.ok(Math.abs(curve[i]) <= Math.abs(input) + 1e-7, 'saturation must not amplify input');
      if (i > 0) assert.ok(curve[i] >= curve[i - 1], 'transfer must be monotonic');
    }
    await engine.dispose();
    assert.equal(limiter.disconnected, true);
    assert.equal(engine.outputLimiter, null);
  } finally { window.AudioContext = original; }
});
