// Deep-space backdrop (js/space-backdrop.js): never brighter than the dimmest enemy, REDUCE EFFECTS keeps
// only the still starfield, the still layers are drawn once, and a frame is a handful of draw calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpaceBackdrop, MAX_LUMA, luma, alphaCap, STAR_LAYERS, SHOOTING_STAR_GAP } from '../js/space-backdrop.js';
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

test('still layers are pre-rendered once; REDUCE EFFECTS keeps only the starfield; drawn at the afterglow alpha', () => {
  const made = [];
  globalThis.document = { createElement: () => { const c = { getContext: () => recorder().ctx }; made.push(c); return c; } };
  try {
    const sky = new SpaceBackdrop();
    const view = { camX: 1000, camY: 900, w: 1280, h: 720, rs: 1, alpha: 0.5, ship: { vx: 3, vy: 0, dashTimer: 0 } };
    const full = recorder();
    sky.draw(full.ctx, view);
    const canvases = made.length;
    assert.equal(canvases, STAR_LAYERS.length + 2, 'three star tiles, the nebula and the planet');
    sky.draw(recorder().ctx, { ...view, camX: 1300 });
    assert.equal(made.length, canvases, 'nothing is re-rendered when the camera moves');
    assert.equal(full.calls.alpha[0], 0.5, 'drawn at the frame\'s afterglow fade');
    assert.ok(full.calls.drawImage <= 20, `a few tile draws: ${full.calls.drawImage}`);
    setReduceEffects(true);
    const calm = recorder();
    sky.time = 10;
    sky.draw(calm.ctx, { ...view, ship: { vx: 9, vy: 0, dashTimer: 1 } });
    setReduceEffects(false);
    assert.equal(calm.calls.fillRect + calm.calls.stroke, 0, 'no twinkles, motes or shooting star');
    assert.equal(calm.calls.drawImage, full.calls.drawImage - 2, 'no nebula or planet, the same stars');
    // A higher render scale re-renders the tiles crisp (once).
    sky.draw(recorder().ctx, { ...view, rs: 2 });
    assert.equal(made.length, canvases + STAR_LAYERS.length);
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
  assert.doesNotThrow(() => sky.draw(recorder().ctx, { camX: 0, camY: 0, w: 800, h: 600 }));
});
