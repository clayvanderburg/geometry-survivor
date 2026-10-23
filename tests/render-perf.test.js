import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, sparkRgb } from '../js/particles.js';
import { GlowSprites } from '../js/glow-sprite.js';

// Render performance pass (tools/perf-bench.cjs): the optimizations must not change what is drawn.

test('sparkRgb is the 8-bit colour of hsl(hue, 100%, 68%)', () => {
  assert.equal(sparkRgb(0), '#ff5c5c');
  assert.equal(sparkRgb(120), '#5cff5c');
  assert.equal(sparkRgb(240), '#5c5cff');
  assert.equal(sparkRgb(360), sparkRgb(0));
  assert.equal(sparkRgb(-30), sparkRgb(330));
  // Fractional hues (sparks jitter theirs) land between their neighbours.
  assert.match(sparkRgb(203.37), /^#[0-9a-f]{6}$/);
});

test('sparks are pooled, keep their colour and stay under the cap', () => {
  const ps = new ParticleSystem();
  ps.spawnExplosionSparks(0, 0, 50, 200);
  assert.equal(ps.sparks.length, 50);
  for (const s of ps.sparks) assert.equal(s.rgb, sparkRgb(s.hue));
  const spent = new Set(ps.sparks);
  for (let i = 0; i < 120; i++) ps.update(1 / 60, 10000, 10000); // every spark burns out
  assert.equal(ps.sparks.length, 0);
  assert.equal(ps.sparkPool.length, 50);
  ps.spawnDirectionalSparks(5, 5, 0, 1, 1, 90);
  assert.ok(ps.sparkPool.length === 49 && spent.has(ps.sparks[0]), 'a new spark reuses a spent one');
  assert.equal(ps.sparks[0].hue >= 80 && ps.sparks[0].hue <= 100, true);
  ps.spawnExplosionSparks(0, 0, 2000, 30);
  ps.update(1 / 60, 10000, 10000);
  assert.equal(ps.sparks.length, 1800);
});

test('glow sprites: one cached canvas per shape, size step and render scale', () => {
  const made = [];
  const fakeCtx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const glows = new GlowSprites(() => { const c = { getContext: () => fakeCtx() }; made.push(c); return c; });
  const opts = { blur: 12, color: '#ffcc00', fill: 'hsla(46, 100%, 52%, 0.92)', path: () => {} };
  const a = glows.get('coin', 8, 1, opts);
  assert.equal(glows.get('coin', 8.04, 1, opts), a, 'radii within 1/16 px share a sprite');
  assert.notEqual(glows.get('coin', 8.5, 1, opts), a);
  assert.notEqual(glows.get('coin', 8, 1.5, opts), a);
  assert.equal(made.length, 3);
  // Big enough for the blur: half-size >= radius + 1.5 x blur.
  assert.ok(a.canvas.width / 2 >= 8 + 18);
  // No canvas (tests, workers): draw() reports it so the caller falls back to shadowBlur.
  const none = new GlowSprites(() => null);
  assert.equal(none.draw({ drawImage() { throw new Error('no'); } }, 'coin', 8, 1, opts), false);
});
