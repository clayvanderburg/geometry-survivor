import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = undefined;
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { ParticleSystem } = await import('../js/particles.js');
const { DEFAULT_TUNING } = await import('../js/config.js');

const tick = (fx, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) fx.update(1 / 60, 1e5, 1e5); };

test('tesla bolts linger 0.2-0.35 s and re-jag while fading', () => {
  const fx = new ParticleSystem();
  const bolt = fx.spawnLightning(0, 0, 200, 0, 275);
  assert.ok(bolt.maxLife >= 0.2 && bolt.maxLife <= 0.35);
  const before = Array.from(bolt.off);
  tick(fx, 0.1);
  assert.equal(fx.lightnings.length, 1, 'still visible after 0.1 s');
  assert.notDeepEqual(Array.from(bolt.off), before, 're-jagged');
  assert.equal(bolt.off[0], 0);
  assert.equal(bolt.off[bolt.off.length - 1], 0, 'ends stay pinned to emitter and target');
  tick(fx, 0.3);
  assert.equal(fx.lightnings.length, 0);
});

test('vfxLinger scales weapon effect lifetimes; inward rings keep gameplay timing', () => {
  const fx = new ParticleSystem();
  fx.tuning = { vfxLinger: 2, vfxIntensity: 1 };
  assert.ok(Math.abs(fx.spawnLightning(0, 0, 100, 0).maxLife - 0.56) < 1e-9);
  fx.spawnShockwave(0, 0, 50, 190, 3, 0.4);
  fx.spawnShockwave(0, 0, 50, 190, 3, 0.4, true);
  assert.ok(Math.abs(fx.shockwaves[0].maxLife - 0.8) < 1e-9);
  assert.equal(fx.shockwaves[1].maxLife, 0.4);
  assert.equal(DEFAULT_TUNING.vfxIntensity, 1);
  assert.equal(DEFAULT_TUNING.vfxLinger, 1);
});

test('weapon effect pools stay bounded under a long barrage', () => {
  const fx = new ParticleSystem();
  for (let i = 0; i < 500; i++) {
    fx.spawnLightning(i, 0, i + 120, 40, 275);
    fx.spawnFlash(i, 0, 20, 275);
    fx.spawnTrail([{ x: i, y: 0 }, { x: i + 10, y: 5 }], 325);
  }
  assert.ok(fx.lightnings.length <= 72);
  assert.ok(fx.flashCount <= fx.flashes.length);
  assert.ok(fx.trails.length <= 48);
  tick(fx, 1.5);
  assert.equal(fx.lightnings.length + fx.flashCount + fx.trails.length, 0);
  fx.spawnFlash(0, 0, 10);
  fx.clear();
  assert.equal(fx.flashCount, 0);
});
