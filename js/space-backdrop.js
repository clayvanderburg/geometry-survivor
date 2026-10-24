// Deep-space backdrop behind the reactive warp grid: a faint nebula wash, three parallax star layers with a
// slow twinkle, a dark distant planet, a rare shooting star, and dust motes near the camera that streak
// when the ship dashes. Subtle on purpose: nothing here is brighter than the dimmest enemy or pickup
// (MAX_LUMA, tests/space-backdrop.test.js), and REDUCE EFFECTS keeps only the still starfield.
//
// Cheap: every still layer is drawn once into an offscreen canvas (re-made only when the view or render
// scale changes); a frame is a few drawImage calls plus ~30 tiny twinkles and ~24 motes. The game clears
// each frame by fading the last one (afterglow), so the backdrop is drawn at that fade's alpha, which keeps
// its brightness steady instead of stacking up.
import { isReduceEffects } from './juice.js';

// Brightest any backdrop pixel may get (relative luminance, 0..1). The dimmest enemy body (violet,
// hsl(272, 100%, 62%)) is about 0.19; tests/space-backdrop.test.js checks every enemy hue against this.
export const MAX_LUMA = 0.15;

// Relative luminance of an 'r, g, b' string (sRGB), and the most opaque a colour may be drawn over the
// near-black field without passing MAX_LUMA.
export function luma(rgb) {
  const [r, g, b] = rgb.split(',').map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const alphaCap = (rgb) => Math.min(1, MAX_LUMA / luma(rgb));

// Star layers, far to near: parallax (share of camera motion), tile size, star count, size, and brightness
// as a share of the colour's alpha cap. Depth reads from size and count, not from brighter cores.
export const STAR_LAYERS = Object.freeze([
  { parallax: 0.04, tile: 640, count: 420, size: [0.4, 0.85], alpha: [0.3, 0.75] },
  { parallax: 0.1, tile: 720, count: 170, size: [0.55, 1.15], alpha: [0.45, 0.9] },
  { parallax: 0.2, tile: 820, count: 60, size: [0.75, 1.5], alpha: [0.6, 1] }
]);
export const TWINKLES = 28;
export const MOTES = 24;
export const SHOOTING_STAR_GAP = [30, 60]; // s between shooting stars
const NEBULA_PARALLAX = 0.015;
const PLANET_PARALLAX = 0.025;

// A seeded random (the sky is the same every run, so it reads as a place).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296);
}
const lerp = (a, b, t) => a + (b - a) * t;
const makeCanvas = (w, h) => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

// Star colours: mostly white-blue, a few warm and a few violet (the synthwave palette, very faint).
const STAR_TINTS = ['220, 232, 255', '200, 220, 255', '255, 236, 214', '214, 196, 255'];

export class SpaceBackdrop {
  constructor({ seed = 7331 } = {}) {
    this.seed = seed;
    this.tiles = null;
    this.tileScale = 0;
    this.nebula = null;
    this.planet = null;
    this.viewKey = '';
    const r = rng(seed ^ 0x51ed);
    this.twinkles = Array.from({ length: TWINKLES }, () => ({ x: r(), y: r(), phase: r() * Math.PI * 2, speed: 0.4 + r() * 0.7, size: 0.8 + r() * 0.9, tint: STAR_TINTS[Math.floor(r() * STAR_TINTS.length)] }));
    this.motes = Array.from({ length: MOTES }, () => ({ x: r(), y: r(), z: 1.12 + r() * 0.25, a: 0.05 + r() * 0.07 }));
    this.time = 0;
    this.nextShot = lerp(SHOOTING_STAR_GAP[0] * 0.5, SHOOTING_STAR_GAP[1] * 0.5, r());
    this.shot = null;
    this.shotRng = rng(seed ^ 0xbeef);
  }

  // Star tiles at render scale `rs` (crisp on high-DPI screens, capped at 2).
  buildTiles(rs) {
    const scale = Math.min(2, Math.max(1, rs));
    if (this.tiles && this.tileScale === scale) return;
    this.tileScale = scale;
    this.tiles = STAR_LAYERS.map((layer, i) => {
      const c = makeCanvas(layer.tile * scale, layer.tile * scale);
      const ctx = c?.getContext?.('2d');
      if (!ctx) return null;
      ctx.scale(scale, scale);
      const r = rng(this.seed + i * 977);
      for (let n = 0; n < layer.count; n++) {
        const x = r() * layer.tile, y = r() * layer.tile;
        const size = lerp(layer.size[0], layer.size[1], r() ** 2);
        const tint = STAR_TINTS[r() < 0.82 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2)];
        const a = lerp(layer.alpha[0], layer.alpha[1], r() ** 2) * alphaCap(tint);
        if (size > 1) {
          // A soft halo makes the bigger stars read without a brighter core.
          ctx.fillStyle = `rgba(${tint}, ${a * 0.18})`;
          ctx.beginPath();
          ctx.arc(x, y, size * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${tint}, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      return c;
    });
  }

  // The nebula and the planet for a view of w x h (CSS px), drawn once per view size.
  buildView(w, h) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (this.viewKey === key) return;
    this.viewKey = key;
    // Nebula: soft violet / teal clouds at low resolution (it is all blur anyway), stretched over a
    // view-and-a-bit so its slow parallax never shows an edge.
    const nw = 320, nh = Math.round(320 * (h / w)) || 180;
    const neb = makeCanvas(nw, nh);
    const nctx = neb?.getContext?.('2d');
    if (nctx) {
      const r = rng(this.seed ^ 0xa11);
      const clouds = [
        ['112, 48, 168', 0.07], ['40, 120, 150', 0.055], ['150, 40, 120', 0.045], ['60, 70, 170', 0.05], ['112, 48, 168', 0.04]
      ];
      for (const [rgb, a] of clouds) {
        const x = r() * nw, y = r() * nh, rad = (0.35 + r() * 0.45) * Math.max(nw, nh);
        const g = nctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${rgb}, ${a})`);
        g.addColorStop(0.55, `rgba(${rgb}, ${a * 0.45})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        nctx.fillStyle = g;
        nctx.fillRect(0, 0, nw, nh);
      }
    }
    this.nebula = neb;
    // A dark planet low on the left (the radar sits on the right): a near-black disc with a faint violet rim lit from above.
    const pr = Math.round(Math.min(w, h) * 0.26);
    const pc = makeCanvas(pr * 2.4, pr * 2.4);
    const pctx = pc?.getContext?.('2d');
    if (pctx) {
      const cx = pr * 1.2, cy = pr * 1.2;
      const halo = pctx.createRadialGradient(cx, cy, pr * 0.9, cx, cy, pr * 1.2);
      halo.addColorStop(0, 'rgba(120, 80, 200, 0.06)');
      halo.addColorStop(1, 'rgba(120, 80, 200, 0)');
      pctx.fillStyle = halo;
      pctx.fillRect(0, 0, pc.width, pc.height);
      const body = pctx.createRadialGradient(cx - pr * 0.3, cy - pr * 0.45, pr * 0.1, cx, cy, pr);
      body.addColorStop(0, 'rgb(22, 18, 40)');
      body.addColorStop(0.7, 'rgb(10, 9, 22)');
      body.addColorStop(1, 'rgb(5, 5, 13)');
      pctx.fillStyle = body;
      pctx.beginPath();
      pctx.arc(cx, cy, pr, 0, Math.PI * 2);
      pctx.fill();
      pctx.strokeStyle = 'rgba(150, 110, 230, 0.16)';
      pctx.lineWidth = Math.max(1, pr * 0.012);
      pctx.beginPath();
      pctx.arc(cx, cy, pr - 1, Math.PI * 1.05, Math.PI * 1.75);
      pctx.stroke();
    }
    this.planet = pc;
    this.planetR = pr;
  }

  // Advances the shooting star and the twinkle clock (seconds).
  update(dt) {
    this.time += dt;
    if (this.shot) {
      this.shot.t += dt;
      if (this.shot.t >= this.shot.life) this.shot = null;
    } else if ((this.nextShot -= dt) <= 0) {
      const r = this.shotRng;
      this.nextShot = lerp(SHOOTING_STAR_GAP[0], SHOOTING_STAR_GAP[1], r());
      const fromLeft = r() < 0.5;
      this.shot = { t: 0, life: 0.9 + r() * 0.5, x: fromLeft ? 0.05 + r() * 0.4 : 0.55 + r() * 0.4, y: 0.05 + r() * 0.35, dx: fromLeft ? 1 : -1, dy: 0.32 + r() * 0.25, len: 0.18 + r() * 0.12 };
    }
  }

  // Draws the backdrop in screen space over a w x h view (CSS px). `alpha` is the frame's afterglow fade,
  // `rs` the render scale, `ship` the player (dust streaks with its velocity while it dashes).
  draw(ctx, { camX, camY, w, h, rs = 1, alpha = 1, ship = null, worldW = 4200, worldH = 4200 }) {
    if (!(w > 0 && h > 0)) return;
    this.buildTiles(rs);
    this.buildView(w, h);
    const calm = isReduceEffects();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';

    // Nebula (still), a view-and-a-bit wide, barely moving.
    if (this.nebula && !calm) {
      const pad = 0.15;
      const ox = -(camX * NEBULA_PARALLAX) % (w * pad) - w * pad * 0.5;
      const oy = -(camY * NEBULA_PARALLAX) % (h * pad) - h * pad * 0.5;
      ctx.drawImage(this.nebula, ox, oy, w * (1 + pad), h * (1 + pad));
    }
    // Stars, far to near, tiled.
    if (this.tiles) {
      for (let i = 0; i < STAR_LAYERS.length; i++) {
        const tile = this.tiles[i];
        if (!tile) continue;
        const L = STAR_LAYERS[i];
        const size = L.tile;
        const ox = -(((camX * L.parallax) % size) + size) % size;
        const oy = -(((camY * L.parallax) % size) + size) % size;
        for (let y = oy; y < h; y += size) for (let x = ox; x < w; x += size) ctx.drawImage(tile, x, y, size, size);
      }
    }
    if (!calm) {
      // The planet: fixed in the sky (it hardly moves however far you fly), low on the left.
      if (this.planet) {
        const pr = this.planetR;
        const px = w * 0.12 - (camX - worldW / 2) * PLANET_PARALLAX - pr * 1.2;
        const py = h * 0.92 - (camY - worldH / 2) * PLANET_PARALLAX - pr * 1.2;
        ctx.drawImage(this.planet, px, py);
      }
      // Twinkles: a few brighter stars breathing slowly (they ride the middle layer).
      const L = STAR_LAYERS[1];
      for (const s of this.twinkles) {
        const k = 0.5 + 0.5 * Math.sin(this.time * s.speed + s.phase);
        const x = ((s.x * w - camX * L.parallax) % w + w) % w;
        const y = ((s.y * h - camY * L.parallax) % h + h) % h;
        ctx.fillStyle = `rgba(${s.tint}, ${(0.45 + 0.55 * k) * alphaCap(s.tint)})`;
        ctx.fillRect(x - s.size / 2, y - s.size / 2, s.size, s.size);
      }
      // Shooting star: a short fading streak.
      if (this.shot) {
        const s = this.shot;
        const k = s.t / s.life;
        const fade = Math.sin(Math.PI * k);
        const hx = (s.x + s.dx * 0.5 * k) * w, hy = (s.y + s.dy * 0.5 * k) * h;
        const len = s.len * w;
        const n = Math.hypot(s.dx, s.dy);
        const tx = hx - (s.dx / n) * len, ty = hy - (s.dy / n) * len;
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(200, 220, 255, 0)');
        g.addColorStop(1, `rgba(225, 235, 255, ${alphaCap('225, 235, 255') * fade})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }
      // Dust motes near the camera (they move a little faster than the world); a dash stretches them
      // into streaks along the ship's motion.
      const dashing = (ship?.dashTimer || 0) > 0;
      const vx = ship?.vx || 0, vy = ship?.vy || 0;
      ctx.lineCap = 'round';
      for (const m of this.motes) {
        const x = ((m.x * w - camX * m.z) % w + w) % w;
        const y = ((m.y * h - camY * m.z) % h + h) % h;
        if (dashing) {
          ctx.strokeStyle = `rgba(190, 220, 255, ${Math.min(alphaCap('190, 220, 255'), m.a * 1.6)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - vx * 2.2 * m.z, y - vy * 2.2 * m.z);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(190, 220, 255, ${m.a})`;
          ctx.fillRect(x, y, 1.2, 1.2);
        }
      }
    }
    ctx.restore();
  }
}
