import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
let osReduce = false;
globalThis.matchMedia = q => ({ matches: q.includes('reduced-motion') && osReduce });
const bodyClasses = new Set();
globalThis.document = { body: { classList: { toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)) } } };

const J = await import('../js/juice.js');
const { ParticleSystem } = await import('../js/particles.js');

test('easing curves start at 0, end at 1 and clamp outside 0..1', () => {
  for (const [name, f] of Object.entries(J.EASE)) {
    assert.ok(Math.abs(f(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${name}(1)`);
    assert.equal(f(-1), f(0), `${name} clamps below`);
    assert.equal(f(2), f(1), `${name} clamps above`);
  }
  assert.ok(J.EASE.outBack(0.7) > 1, 'outBack overshoots');
  assert.equal(J.pulse(0), 0);
  assert.equal(J.pulse(0.2), 1);
  assert.ok(Math.abs(J.pulse(1)) < 1e-9);
});

test('tweens run their delay, ease to 1, call onDone once and reuse the pool', () => {
  const tw = new J.Tweens(2);
  const seen = [];
  let done = 0;
  tw.add({ duration: 0.2, delay: 0.1, ease: J.EASE.linear, onUpdate: v => seen.push(v), onDone: () => done++ });
  tw.update(0.1);
  assert.equal(seen.length, 0, 'still in its delay');
  tw.update(0.1);
  assert.ok(Math.abs(seen.at(-1) - 0.5) < 1e-9);
  tw.update(0.2);
  assert.equal(seen.at(-1), 1);
  assert.equal(done, 1);
  assert.equal(tw.count, 0);
  // A full pool finishes its most advanced tween to make room (no growth, no lost onDone).
  let finished = 0;
  tw.add({ duration: 1, onDone: () => finished++ });
  tw.update(0.5);
  tw.add({ duration: 1 });
  tw.add({ duration: 1 });
  assert.equal(finished, 1);
  assert.equal(tw.pool.length, 2);
});

test('REDUCE EFFECTS follows the OS preference until the player picks, then persists', () => {
  storage.clear();
  osReduce = true;
  assert.equal(J.loadReduceEffects(), true);
  osReduce = false;
  assert.equal(J.loadReduceEffects(), false);
  J.saveReduceEffects(true);
  assert.equal(J.loadReduceEffects(), true);
  J.setReduceEffects(true);
  assert.ok(bodyClasses.has('reduce-effects'));
  assert.equal(J.shakeScale(), 0);
  assert.ok(J.flashScale() < 1);
  assert.equal(J.particleDensity(0), 0.5);
  J.setReduceEffects(false);
  assert.ok(!bodyClasses.has('reduce-effects'));
  assert.equal(J.shakeScale(), 1);
});

test('particle density thins sparks in dense waves but never below 55%', () => {
  J.setReduceEffects(false);
  assert.equal(J.particleDensity(50), 1);
  assert.equal(J.particleDensity(120), 1);
  assert.ok(J.particleDensity(200) < 1);
  assert.equal(J.particleDensity(1000), 0.55);
  const ps = new ParticleSystem();
  ps.spawnExplosionSparks(0, 0, 20, 100);
  assert.equal(ps.sparks.length, 20, 'standalone systems keep full density');
  ps.density = 0.5;
  ps.spawnExplosionSparks(0, 0, 20, 100);
  assert.equal(ps.sparks.length, 30);
});

test('burst presets only spawn through the fx handles they are given', () => {
  const calls = [];
  const rec = new Proxy({}, { get: (_t, k) => (...a) => calls.push(k) });
  for (const name of Object.keys(J.BURSTS)) {
    calls.length = 0;
    assert.equal(J.burst({ particles: rec, grid: rec }, name, 10, 10, { hue: 100 }), true);
    assert.ok(calls.length > 0, name);
    assert.equal(J.burst({}, name, 0, 0), true, `${name} tolerates missing handles`);
  }
  assert.equal(J.burst({ particles: rec }, 'nope', 0, 0), false);
});
