import test from 'node:test';
import assert from 'node:assert/strict';

// Neon grid: even ship light, springier pushes, explosion ripples. Browser services are stubbed.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { WarpGrid, MAX_RIPPLES, lightFalloff } = await import('../js/grid.js');
const { TUNING } = await import('../js/config.js');

const SP = 68;
const VIEW = [0, 0, 3000, 3000];

// A canvas stand-in that records every stroke: its style, width and the segments in its path.
function recorder() {
  const strokes = [];
  let path = [];
  let pen = null;
  const ctx = {
    strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() {}, restore() {},
    beginPath() { path = []; pen = null; },
    moveTo(x, y) { pen = [x, y]; },
    lineTo(x, y) { path.push([pen[0], pen[1], x, y]); pen = [x, y]; },
    stroke() { strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, segs: path.slice() }); }
  };
  return { ctx, strokes };
}

// Lit (energy) segments keyed by their midpoint relative to (cx, cy), mapped to "style|width".
function litSegments(strokes, cx, cy) {
  const lit = new Map();
  for (const s of strokes) {
    if (typeof s.style !== 'string' || !s.style.startsWith('hsla')) continue;
    for (const [x1, y1, x2, y2] of s.segs) {
      lit.set(`${Math.round((x1 + x2) / 2 - cx)},${Math.round((y1 + y2) / 2 - cy)}`, `${s.style}|${s.width}`);
    }
  }
  return lit;
}

test('the ship light is a smooth radial falloff, identical in all 8 directions, centred on the ship', () => {
  const grid = new WarpGrid(3000, 3000, SP);
  grid.update(...VIEW);
  // Deliberately off the lattice: the old glow snapped to whichever grid point happened to be nearest.
  const sx = 1500 + SP * 0.37, sy = 1500 + SP * 0.81;
  grid.setLight(sx, sy, 240, 1, 188);
  const peak = grid.lightAt(sx, sy);
  assert.ok(peak > 0.9);
  for (const d of [20, 55, 110, 170, 230]) {
    const ring = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ring.push(grid.lightAt(sx + Math.cos(a) * d, sy + Math.sin(a) * d));
    }
    for (const v of ring) assert.ok(Math.abs(v - ring[0]) < 1e-9, `uneven light at ${d}px: ${ring.map(v => v.toFixed(4)).join(' ')}`);
    assert.ok(ring[0] < peak && ring[0] > 0, `light fades smoothly out to the rim (${d}px)`);
  }
  assert.equal(grid.lightAt(sx + 241, sy), 0, 'nothing is lit past the light radius');
  assert.equal(lightFalloff(0), 1);
  assert.equal(lightFalloff(1), 0);

  // The drawn light: pieces of horizontal AND vertical lines, each as bright as the falloff at its own
  // distance from the ship (so brightness depends on distance alone), the same total on every side.
  const { ctx, strokes } = recorder();
  grid.draw(ctx, ...VIEW);
  const alpha = (style) => Number(/,\s*([\d.]+)\)$/.exec(style)[1]);
  const lightStrokes = strokes.filter(st => typeof st.style === 'string' && st.style.startsWith('hsla(188'));
  assert.ok(lightStrokes.length >= 6, 'the light is drawn in several brightness bands');
  const bands = lightStrokes.map(st => {
    const d = st.segs.map(([x1, y1, x2, y2]) => Math.hypot((x1 + x2) / 2 - sx, (y1 + y2) / 2 - sy));
    return { a: alpha(st.style), lo: Math.min(...d), hi: Math.max(...d) };
  }).sort((p, q) => q.a - p.a);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i].lo >= bands[i - 1].hi - 1e-6, 'a brighter band always sits closer to the ship');
  }
  assert.ok(bands.at(-1).hi < 240, 'nothing past the light radius is lit');
  const sides = { left: 0, right: 0, up: 0, down: 0 };
  let horiz = 0, vert = 0;
  for (const st of lightStrokes) {
    for (const [x1, y1, x2, y2] of st.segs) {
      const mx = (x1 + x2) / 2 - sx, my = (y1 + y2) / 2 - sy;
      const w = alpha(st.style);
      if (Math.abs(mx) >= Math.abs(my)) sides[mx < 0 ? 'left' : 'right'] += w;
      else sides[my < 0 ? 'up' : 'down'] += w;
      if (y1 === y2) horiz += w; else vert += w;
    }
  }
  const total = Object.values(sides).reduce((a, b) => a + b, 0);
  for (const [side, w] of Object.entries(sides)) {
    assert.ok(Math.abs(w / total - 0.25) < 0.03, `the ${side} side gets ${(100 * w / total).toFixed(1)}% of the light`);
  }
  assert.ok(Math.abs(horiz / (horiz + vert) - 0.5) < 0.03, 'horizontal and vertical lines are lit alike');
  // It is consumed by the draw, so a stale position can never trail the ship.
  assert.equal(grid.light.on, false);
  const again = recorder();
  grid.draw(again.ctx, ...VIEW);
  assert.equal(again.strokes.filter(st => String(st.style).startsWith('hsla')).length, 0);
});

test('energized lines glow evenly on both axes around their source (no right/down skew)', () => {
  const grid = new WarpGrid(3000, 3000, SP);
  grid.update(...VIEW);
  const cx = SP * 22, cy = SP * 22; // a lattice point, so the true glow has 4-fold symmetry
  grid.applyImpulse(cx, cy, 0, 230, 190); // light only: no displacement
  const { ctx, strokes } = recorder();
  grid.draw(ctx, ...VIEW);
  const lit = litSegments(strokes, cx, cy);
  assert.ok(lit.size >= 16, `only ${lit.size} segments lit`);
  for (const [key, look] of lit) {
    const [x, y] = key.split(',').map(Number);
    for (const [mx, my] of [[-x, y], [x, -y], [-x, -y], [y, x], [-y, -x]]) {
      assert.equal(lit.get(`${mx},${my}`), look, `segment at (${x},${y}) has no matching mirror at (${mx},${my})`);
    }
  }
});

test('the muzzle nudge adds no glow, so firing never lights an off-centre blob', () => {
  const grid = new WarpGrid(3000, 3000, SP);
  grid.update(...VIEW);
  grid.applyImpulse(1500, 1500, 5.5, 110, 188, 0);
  assert.ok(grid.points.every(pt => pt.energy === 0));
  assert.ok(grid.points.some(pt => pt.vx !== 0 || pt.vy !== 0));
});

// Peak displacement (px) of points around `dist` from a ripple's centre, and the ticks it lived.
function rippleRun(blastRadius, dist = 300) {
  const grid = new WarpGrid(3000, 3000, SP);
  grid.update(...VIEW);
  const cx = 1500, cy = 1500;
  const rp = grid.ripple(cx, cy, blastRadius, 30);
  const snapshot = { reach: rp.reach, kick: rp.kick, speed: rp.speed, width: rp.width };
  const ring = grid.points.filter(pt => Math.abs(Math.hypot(pt.ox - cx, pt.oy - cy) - dist) < SP / 2);
  let peak = 0, glow = 0, life = 0;
  for (let t = 0; t < 400; t++) {
    grid.update(...VIEW);
    if (grid.activeRipples()) life = t + 1;
    for (const pt of ring) {
      peak = Math.max(peak, Math.hypot(pt.x - pt.ox, pt.y - pt.oy));
      glow = Math.max(glow, pt.energy);
    }
  }
  return { ...snapshot, peak, glow, life };
}

test('explosion ripples scale with blast size: bigger blasts ripple further, harder and longer', () => {
  const pop = rippleRun(40), rocket = rippleRun(110), nuke = rippleRun(260);
  for (const [small, big] of [[pop, rocket], [rocket, nuke]]) {
    assert.ok(big.reach > small.reach, 'reach grows');
    assert.ok(big.kick > small.kick, 'amplitude grows');
    assert.ok(big.life > small.life, `lifetime grows (${small.life} -> ${big.life} ticks)`);
  }
  assert.ok(pop.peak < 6, `a small pop barely reaches 300px (${pop.peak.toFixed(1)}px)`);
  assert.ok(nuke.peak > 15, `a big blast visibly bends lines 300px out (${nuke.peak.toFixed(1)}px)`);
  assert.ok(nuke.peak > rocket.peak && nuke.glow > rocket.glow, 'and lights them brighter as it passes');
  assert.ok(nuke.peak < SP * 0.8, 'without folding lines over each other');
  assert.ok(nuke.life < 120, 'every ripple ends within two seconds');
  const saved = TUNING.gridRippleMult;
  try {
    TUNING.gridRippleMult = 0;
    assert.equal(new WarpGrid(600, 600).ripple(300, 300, 200), null, 'gridRippleMult 0 turns ripples off');
  } finally {
    TUNING.gridRippleMult = saved;
  }
});

test('the ripple pool is capped: small pops are skipped or merged under load, big blasts still land', () => {
  const grid = new WarpGrid(6000, 6000, SP);
  grid.update(0, 0, 6000, 6000);
  for (let i = 0; i < 300; i++) grid.ripple(200 + (i % 25) * 220, 200 + Math.floor(i / 25) * 400, 30 + (i % 7) * 5, 190);
  assert.ok(grid.activeRipples() <= MAX_RIPPLES);
  assert.equal(grid.ripples.length, MAX_RIPPLES, 'the pool never grows');
  assert.equal(grid.ripple(3000, 3000, 25, 190), null, 'a tiny pop is skipped when the pool is busy');
  const big = grid.ripple(3100, 3100, 600, 48, 1.3);
  assert.ok(big && big.active && big.x === 3100, 'a big blast takes the weakest slot');
  assert.equal(grid.ripple(3104, 3098, 120, 30), big, 'a blast on the same spot merges into the fresh ripple');
  assert.ok(grid.activeRipples() <= MAX_RIPPLES);
  for (let t = 0; t < 400; t++) grid.update(0, 0, 6000, 6000);
  assert.equal(grid.activeRipples(), 0, 'every ripple runs out');
  grid.ripple(500, 500, 200);
  grid.reset();
  assert.equal(grid.activeRipples(), 0, 'a new run clears ripples');
});

test('ripples only move points inside the simulated region', () => {
  const grid = new WarpGrid(4200, 4200);
  grid.update(0, 0, 1280, 720);
  grid.ripple(3800, 3800, 600, 30, 1.4);
  for (let n = 0; n < 60; n++) {
    grid.stepRipples();
  }
  assert.ok(grid.points.every(pt => pt.vx === 0 && pt.vy === 0));
});

test('the ship wake bends lines away from the hull without folding them, then springs back', () => {
  const grid = new WarpGrid(3000, 3000, SP);
  const rowsInOrder = () => {
    for (let r = 1; r < grid.rows - 1; r++) {
      for (let c = 1; c < grid.cols - 1; c++) {
        const a = grid.points[r * grid.cols + c], right = grid.points[r * grid.cols + c + 1], down = grid.points[(r + 1) * grid.cols + c];
        if (!(right.x > a.x) || !(down.y > a.y)) return false;
      }
    }
    return true;
  };
  let x = 600, y = 1500;
  let maxPush = 0;
  for (let t = 0; t < 180; t++) {
    grid.update(...VIEW);
    x += 9; // a dash-speed pass straight across
    grid.applyWake(x, y, 9, 0);
    if (t % 10 === 0) assert.ok(rowsInOrder(), `lines folded at tick ${t}`);
    for (const pt of grid.points) {
      if (Math.abs(pt.ox - x) < 40 && Math.abs(pt.oy - y) < 120 && Math.abs(pt.oy - y) > 30) {
        maxPush = Math.max(maxPush, Math.abs(pt.y - y) - Math.abs(pt.oy - y));
      }
    }
  }
  assert.ok(maxPush > 12, `lines beside the hull are pushed outward (${maxPush.toFixed(1)}px)`);
  for (let t = 0; t < 900; t++) grid.update(...VIEW);
  assert.ok(grid.points.every(pt => Math.hypot(pt.x - pt.ox, pt.y - pt.oy) < 0.5), 'the wake settles back to rest');
});

test('a springier grid overshoots and rings longer after a shove, and always settles', () => {
  const ringDown = (spring) => {
    const saved = TUNING.gridSpring;
    TUNING.gridSpring = spring;
    try {
      const grid = new WarpGrid(3000, 3000, SP);
      grid.update(...VIEW);
      grid.applyImpulse(1500, 1500, 40, 220, 190);
      const pt = grid.points.find(p => p.ox === SP * 22 + SP * 2 && p.oy === SP * 22);
      let overshoot = 0, settled = 0;
      for (let t = 0; t < 1200; t++) {
        grid.update(...VIEW);
        overshoot = Math.max(overshoot, -(pt.x - pt.ox)); // swinging back past its rest point
        if (Math.hypot(pt.x - pt.ox, pt.y - pt.oy) > 0.5) settled = t;
      }
      return { overshoot, settled };
    } finally {
      TUNING.gridSpring = saved;
    }
  };
  const stiff = ringDown(0.5), base = ringDown(1), loose = ringDown(2);
  assert.ok(base.overshoot > 1, `lines overshoot their rest point (${base.overshoot.toFixed(1)}px)`);
  assert.ok(loose.overshoot > base.overshoot && base.overshoot > stiff.overshoot);
  assert.ok(loose.settled > base.settled && base.settled > stiff.settled);
  assert.ok(loose.settled < 1199, 'even the springiest grid settles');
});

test('no NaN, runaway or permanent tangle after extreme forces', () => {
  const grid = new WarpGrid(3000, 3000, SP);
  grid.update(...VIEW);
  grid.applyImpulse(1500, 1500, 1e308, 5000, 190);
  grid.applyImpulse(1500, 1500, 1e308, 5000, 190);
  grid.applyImpulse(1500, 1500, Infinity, 400, 190);
  grid.applyImpulse(1500, 1500, NaN, 400, 190);
  grid.applyImpulse(NaN, 1500, 50, 400, 190);
  grid.applyImplosion(1400, 1600, 1e300, 3000, 330, 5);
  grid.applyImplosion(1400, 1600, -Infinity, 300, 330);
  grid.applyWell(1600, 1400, 1e300, 2000, 330, 3);
  grid.applyWell(1600, 1400, Infinity, 200, 330);
  grid.applyWake(1500, 1500, 1e200, -1e200, 400);
  grid.applyWake(1500, 1500, NaN, 0);
  for (let i = 0; i < 100; i++) grid.ripple(1500 + i, 1500 - i, 1e9, 30, 1e9);
  assert.equal(grid.ripple(1500, 1500, NaN, 30), null);
  assert.equal(grid.ripple(1500, 1500, Infinity, 30), null);
  assert.equal(grid.ripple(1500, 1500, -50, 30), null);
  const maxDisp = SP * TUNING.gridMaxWarp + 1e-6;
  const finite = () => grid.points.every(pt => [pt.x, pt.y, pt.vx, pt.vy, pt.energy].every(Number.isFinite));
  for (let t = 0; t < 300; t++) {
    grid.update(...VIEW);
    if (t < 60) grid.applyImpulse(1500, 1500, 1e6, 900, 190);
    assert.ok(finite(), `non-finite grid state at tick ${t}`);
  }
  assert.ok(grid.points.every(pt => Math.hypot(pt.x - pt.ox, pt.y - pt.oy) <= maxDisp), 'displacement stays clamped');
  for (let t = 0; t < 1500; t++) grid.update(...VIEW);
  assert.ok(grid.points.every(pt => Math.hypot(pt.x - pt.ox, pt.y - pt.oy) < 0.5), 'every line springs back to rest');
  const { ctx } = recorder();
  grid.setLight(NaN, 1500);
  grid.draw(ctx, ...VIEW);
});
