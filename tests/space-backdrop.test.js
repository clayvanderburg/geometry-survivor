// Deep-space backdrop (js/space-backdrop.js): never brighter than the dimmest enemy, REDUCE EFFECTS keeps
// only the still starfield, the sky is pre-rendered once, and a frame is one full-screen draw plus tiny ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpaceBackdrop, MAX_LUMA, luma, alphaCap, STAR_LAYERS, SHOOTING_STAR_GAP, NEAR_STARS, TWINKLES, MOTES } from '../js/space-backdrop.js';
import { setReduceEffects } from '../js/juice.js';

// sRGB relative luminance of hsl(h, s%, l%).
function hslLuma(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return luma([f(0), f(8), f(4)].map((c) => Math.round(c * 255)).join(', '));
}

test('no backdrop pixel is brighter than the dimmest enemy body', () => {
  const hues = [...readFileSync(new URL('../js/enemies.js', import.meta.url), 'utf8').matchAll(/hue: (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(hues.length > 5);
  const dimmest = Math.min(...hues.map((h) => hslLuma(h, 100, 62))); // enemy bodies: hsl(hue, 100%, 62%)
  assert.ok(MAX_LUMA < dimmest, `MAX_LUMA ${MAX_LUMA} under the dimmest enemy ${dimmest.toFixed(3)}`);
  for (const tint of ['220, 232, 255', '200, 220, 255', '255, 236, 214', '214, 196, 255', '225, 235, 255', '190, 220, 255']) {
    assert.ok(alphaCap(tint) * luma(tint) <= MAX_LUMA + 1e-9, `${tint} capped`);
  }
  for (const L of STAR_LAYERS) assert.ok(L.alpha[1] <= 1, 'star alpha is a share of the cap');
});

// A context that records draw calls.
function recorder() {
  const calls = { drawImage: 0, fillRect: 0, arc: 0, stroke: 0, alpha: [] };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in calls && typeof calls[k] === 'number') return () => { calls[k]++; };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { if (k === 'globalAlpha') calls.alpha.push(v); t[k] = v; return true; }
  });
  return { ctx, calls };
}

test('the sky is pre-rendered once per view; REDUCE EFFECTS keeps only the starfield; drawn at the afterglow alpha', () => {
  const made = [];
  globalThis.document = { createElement: () => { const c = { getContext: () => recorder().ctx }; made.push(c); return c; } };
  try {
    const sky = new SpaceBackdrop();
    const view = { camX: 1000, camY: 900, w: 1280, h: 720, rs: 1, alpha: 0.5, ship: { vx: 3, vy: 0, dashTimer: 0 } };
    const full = recorder();
    assert.equal(sky.draw(full.ctx, view), true);
    const canvases = made.length;
    assert.equal(canvases, 2, 'the sky and its low-res nebula');
    sky.draw(recorder().ctx, { ...view, camX: 1300 });
    assert.equal(made.length, canvases, 'nothing is re-rendered when the camera moves');
    assert.equal(full.calls.alpha[0], 0.5, 'drawn at the frame\'s afterglow fade');
    assert.equal(full.calls.drawImage, 1, 'one full-screen draw (it replaces the flat fade)');
    assert.ok(full.calls.fillRect <= NEAR_STARS + TWINKLES + MOTES, `a hundred-odd tiny squares: ${full.calls.fillRect}`);
    setReduceEffects(true);
    const calm = recorder();
    sky.time = 10;
    sky.draw(calm.ctx, { ...view, ship: { vx: 9, vy: 0, dashTimer: 1 } });
    setReduceEffects(false);
    assert.equal(made.length, canvases + 1, 'a calm sky (no nebula or planet) is rendered once');
    assert.equal(calm.calls.stroke, 0, 'no shooting star or dash streaks');
    assert.equal(calm.calls.fillRect, NEAR_STARS, 'only the still near stars: no twinkles or motes');
    assert.equal(calm.calls.drawImage, 1);
    // A new render scale or view size re-renders the sky (once).
    sky.draw(recorder().ctx, { ...view, rs: 1.5 });
    sky.draw(recorder().ctx, { ...view, rs: 1.5, camX: 10 });
    assert.equal(made.length, canvases + 3);
  } finally {
    delete globalThis.document;
  }
});

test('a shooting star comes every 30-60 s and fades out; headless (no canvas) draws nothing and never throws', () => {
  const sky = new SpaceBackdrop();
  let shots = 0, was = false;
  for (let t = 0; t < 600; t += 0.1) {
    sky.update(0.1);
    if (sky.shot && !was) shots++;
    was = !!sky.shot;
  }
  assert.ok(shots >= 600 / SHOOTING_STAR_GAP[1] - 1 && shots <= 600 / SHOOTING_STAR_GAP[0] + 2, `${shots} in 10 minutes`);
  assert.equal(sky.draw(recorder().ctx, { camX: 0, camY: 0, w: 800, h: 600 }), false, 'the caller falls back to its flat fade');
});
