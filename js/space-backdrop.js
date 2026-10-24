// Deep-space backdrop behind the reactive warp grid: a faint nebula wash, a dark distant planet and a
// still starfield, nearer stars with a slow twinkle, a rare shooting star, and dust motes near the camera
// that streak when the ship dashes. Subtle on purpose: nothing here is brighter than the dimmest enemy body
// (MAX_LUMA, tests/space-backdrop.test.js), and REDUCE EFFECTS keeps only the still starfield.
//
// Cheap: the game ends every frame's clear by fading the last frame toward the background (the afterglow).
// The backdrop IS that fade: one opaque pre-rendered sky (base colour, nebula, far and middle stars, the
// planet) a little larger than the view, panned with a gentle parallax and drawn at the fade's alpha in
// place of the flat fill. So it costs one full-screen draw the frame was already paying for, plus about a
// hundred tiny ones (near stars, twinkles, motes). The sky is redrawn only when the view or render scale
// changes.
import { isReduceEffects } from './juice.js';

// Brightest any backdrop pixel may get (relative luminance, 0..1). The dimmest enemy body (violet,
// hsl(272, 100%, 62%)) is about 0.19; tests/space-backdrop.test.js checks every enemy hue against this.
export const MAX_LUMA = 0.15;
export const BASE_RGB = '3, 4, 11'; // the field colour (the old flat fade)

// Relative luminance of an 'r, g, b' string (sRGB), and the most opaque a colour may be drawn over the
// near-black field without passing MAX_LUMA.
export function luma(rgb) {
  const [r, g, b] = rgb.split(',').map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const alphaCap = (rgb) => Math.min(1, MAX_LUMA / luma(rgb));

// The sky pans with SKY_PARALLAX of the camera (so across the whole sector it moves a couple of hundred px);
// the near stars move NEAR_PARALLAX, dust motes a little faster than the world itself.
export const SKY_PARALLAX = 0.05;
export const NEAR_PARALLAX = 0.18;
// Stars per million px of sky (far, middle); size; brightness as a share of the cap.
export const STAR_LAYERS = Object.freeze([
  { density: 380, size: [0.4, 0.85], alpha: [0.3, 0.75] },
  { density: 150, size: [0.55, 1.15], alpha: [0.45, 0.9] }
]);
export const NEAR_STARS = 70;
export const TWINKLES = 28;
export const MOTES = 24;
export const SHOOTING_STAR_GAP = [30, 60]; // s between shooting stars
const MAX_SKY_PIXELS = 4.5e6; // the sky canvas's backing store (1080p at 1x is ~2.5M, a phone at 1.5x ~1.3M)

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
const tintOf = (r) => STAR_TINTS[r() < 0.82 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2)];

export class SpaceBackdrop {
  constructor({ seed = 7331 } = {}) {
    this.seed = seed;
    this.sky = { full: null, calm: null };
    this.skyKey = '';
    const r = rng(seed ^ 0x51ed);
    this.near = Array.from({ length: NEAR_STARS }, () => {
      const tint = tintOf(r);
      const size = lerp(0.7, 1.5, r() ** 2);
      return { x: r(), y: r(), size, tint, a: lerp(0.6, 1, r()) * alphaCap(tint) };
    });
    this.twinkles = Array.from({ length: TWINKLES }, () => ({ x: r(), y: r(), phase: r() * Math.PI * 2, speed: 0.4 + r() * 0.7, size: 0.8 + r() * 0.9, tint: STAR_TINTS[Math.floor(r() * STAR_TINTS.length)] }));
    this.motes = Array.from({ length: MOTES }, () => ({ x: r(), y: r(), z: 1.12 + r() * 0.25, a: 0.05 + r() * 0.07 }));
    this.time = 0;
    this.nextShot = lerp(SHOOTING_STAR_GAP[0] * 0.5, SHOOTING_STAR_GAP[1] * 0.5, r());
    this.shot = null;
    this.shotRng = rng(seed ^ 0xbeef);
  }

  // The sky for a w x h view over a worldW x worldH sector: big enough to pan SKY_PARALLAX of the camera's
  // whole range. `calm` leaves out the nebula and the planet (REDUCE EFFECTS).
  buildSky(w, h, rs, worldW, worldH, calm) {
    const key = `${Math.round(w)}x${Math.round(h)}@${rs}|${worldW}x${worldH}`;
    if (this.skyKey !== key) { this.skyKey = key; this.sky = { full: null, calm: null }; }
    const which = calm ? 'calm' : 'full';
    if (this.sky[which] !== null) return this.sky[which];
    const W = w + Math.max(0, worldW - w) * SKY_PARALLAX + 4;
    const H = h + Math.max(0, worldH - h) * SKY_PARALLAX + 4;
    // At the canvas's own resolution the per-frame draw is a plain pixel-aligned copy (the cheapest image
    // draw there is); a huge sky drops resolution and pays for a scaled draw instead.
    const scale = Math.min(rs, Math.sqrt(MAX_SKY_PIXELS / (W * H)));
    const c = makeCanvas(W * scale, H * scale);
    const ctx = c?.getContext?.('2d');
    if (!ctx) { this.sky[which] = false; return false; }
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgb(${BASE_RGB})`;
    ctx.fillRect(0, 0, W, H);
    if (!calm) this.paintNebula(ctx, W, H);
    for (let i = 0; i < STAR_LAYERS.length; i++) {
      const L = STAR_LAYERS[i];
      const r = rng(this.seed + i * 977);
      const count = Math.round((L.density * W * H) / 1e6);
      for (let n = 0; n < count; n++) {
        const x = r() * W, y = r() * H;
        const size = lerp(L.size[0], L.size[1], r() ** 2);
        const tint = tintOf(r);
        const a = lerp(L.alpha[0], L.alpha[1], r() ** 2) * alphaCap(tint);
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
    }
    if (!calm) this.paintPlanet(ctx, W, H, Math.min(w, h));
    this.sky[which] = { canvas: c, W, H, scale };
    return this.sky[which];
  }

  // Soft violet / teal clouds, painted at low resolution and stretched (it is all blur anyway).
  paintNebula(ctx, W, H) {
    const nw = 256, nh = Math.max(64, Math.round(256 * (H / W)));
    const neb = makeCanvas(nw, nh);
    const nctx = neb?.getContext?.('2d');
    if (!nctx) return;
    const r = rng(this.seed ^ 0xa11);
    const clouds = [['112, 48, 168', 0.07], ['40, 120, 150', 0.055], ['150, 40, 120', 0.045], ['60, 70, 170', 0.05], ['112, 48, 168', 0.04]];
    for (const [rgb, a] of clouds) {
      const x = r() * nw, y = r() * nh, rad = (0.35 + r() * 0.45) * Math.max(nw, nh);
      const g = nctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${rgb}, ${a})`);
      g.addColorStop(0.55, `rgba(${rgb}, ${a * 0.45})`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      nctx.fillStyle = g;
      nctx.fillRect(0, 0, nw, nh);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(neb, 0, 0, W, H);
  }

  // A dark planet low on the left (the radar sits on the right): a near-black disc with a faint violet rim
  // lit from above, placed at the middle of the sky so it shows low-left wherever the camera is.
  paintPlanet(ctx, W, H, view) {
    const pr = Math.round(view * 0.26);
    const cx = W * 0.5 - view * 0.62, cy = H * 0.5 + view * 0.62;
    const halo = ctx.createRadialGradient(cx, cy, pr * 0.9, cx, cy, pr * 1.2);
    halo.addColorStop(0, 'rgba(120, 80, 200, 0.06)');
    halo.addColorStop(1, 'rgba(120, 80, 200, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - pr * 1.2, cy - pr * 1.2, pr * 2.4, pr * 2.4);
    const body = ctx.createRadialGradient(cx - pr * 0.3, cy - pr * 0.45, pr * 0.1, cx, cy, pr);
    body.addColorStop(0, 'rgb(22, 18, 40)');
    body.addColorStop(0.7, 'rgb(10, 9, 22)');
    body.addColorStop(1, 'rgb(5, 5, 13)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 110, 230, 0.16)';
    ctx.lineWidth = Math.max(1, pr * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, pr - 1, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
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

  // Paints the backdrop in screen space over a w x h view (CSS px), at `alpha` (the frame's afterglow fade).
  // `rs` is the render scale, `ship` the player (dust streaks with its velocity while it dashes). Returns
  // false when there is no canvas to paint with (headless): the caller then does its flat fade.
  draw(ctx, { camX, camY, w, h, rs = 1, alpha = 1, ship = null, worldW = 4200, worldH = 4200 }) {
    if (!(w > 0 && h > 0)) return false;
    const calm = isReduceEffects();
    const sky = this.buildSky(w, h, rs, worldW, worldH, calm);
    if (!sky) return false;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    const ox = Math.max(0, Math.min(sky.W - w, camX * SKY_PARALLAX));
    const oy = Math.max(0, Math.min(sky.H - h, camY * SKY_PARALLAX));
    if (sky.scale === rs) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(sky.canvas, -Math.round(ox * rs), -Math.round(oy * rs));
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
    } else {
      const s = sky.scale;
      ctx.drawImage(sky.canvas, ox * s, oy * s, w * s, h * s, 0, 0, w, h);
    }

    // Near stars: a sparser, faster layer drawn live (tiny squares), wrapping over the view.
    const wrap = (v, size) => ((v % size) + size) % size;
    for (const st of this.near) {
      const x = wrap(st.x * w - camX * NEAR_PARALLAX, w), y = wrap(st.y * h - camY * NEAR_PARALLAX, h);
      ctx.fillStyle = `rgba(${st.tint}, ${st.a})`;
      ctx.fillRect(x - st.size / 2, y - st.size / 2, st.size, st.size);
    }
    if (!calm) {
      // Twinkles: a few stars breathing slowly.
      for (const t of this.twinkles) {
        const k = 0.5 + 0.5 * Math.sin(this.time * t.speed + t.phase);
        const x = wrap(t.x * w - camX * NEAR_PARALLAX * 0.6, w), y = wrap(t.y * h - camY * NEAR_PARALLAX * 0.6, h);
        ctx.fillStyle = `rgba(${t.tint}, ${(0.45 + 0.55 * k) * alphaCap(t.tint)})`;
        ctx.fillRect(x - t.size / 2, y - t.size / 2, t.size, t.size);
      }
      // Shooting star: a short fading streak.
      if (this.shot) {
        const sh = this.shot;
        const k = sh.t / sh.life;
        const fade = Math.sin(Math.PI * k);
        const hx = (sh.x + sh.dx * 0.5 * k) * w, hy = (sh.y + sh.dy * 0.5 * k) * h;
        const n = Math.hypot(sh.dx, sh.dy);
        const tx = hx - (sh.dx / n) * sh.len * w, ty = hy - (sh.dy / n) * sh.len * w;
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
      // Dust motes near the camera (a little faster than the world); a dash stretches them into streaks.
      const dashing = (ship?.dashTimer || 0) > 0;
      const vx = ship?.vx || 0, vy = ship?.vy || 0;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1;
      for (const m of this.motes) {
        const x = wrap(m.x * w - camX * m.z, w), y = wrap(m.y * h - camY * m.z, h);
        if (dashing) {
          ctx.strokeStyle = `rgba(190, 220, 255, ${Math.min(alphaCap('190, 220, 255'), m.a * 1.6)})`;
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
    return true;
  }
}
