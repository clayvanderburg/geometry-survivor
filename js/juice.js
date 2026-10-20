// Game feel ("juice") helpers, visual and audio only: easing curves, a pooled tween list, burst
// presets for the big moments, and the REDUCE EFFECTS accessibility setting every effect respects.
// Other modules (bosses, weapons, UI) can call these instead of hand-rolling their own.

export const REDUCE_EFFECTS_STORAGE_KEY = 'vexolith_reduce_effects';

// --- Easing (t in 0..1 → 0..1; outBack/outElastic overshoot a little) -----------------------------
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
export const EASE = Object.freeze({
  linear: t => clamp01(t),
  inQuad: t => clamp01(t) ** 2,
  outQuad: t => { t = clamp01(t); return 1 - (1 - t) * (1 - t); },
  inOutQuad: t => { t = clamp01(t); return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; },
  outCubic: t => 1 - (1 - clamp01(t)) ** 3,
  outExpo: t => { t = clamp01(t); return t === 1 ? 1 : 1 - 2 ** (-10 * t); },
  outBack: t => { t = clamp01(t); const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outElastic: t => {
    t = clamp01(t);
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: t => {
    t = clamp01(t);
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  }
});

export const lerp = (a, b, t) => a + (b - a) * t;

// Hue (0..360) of a '#rrggbb' colour, for feeding CSS-palette colours (rarities, weapons) to the
// hue-based particle spawns. Greys and bad input give `fallback`.
export function hueOf(hex, fallback = 190) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d < 0.08) return fallback;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

// A 0 → 1 → 0 bump over `t` in 0..1 (fast attack, eased release): pulses, flashes, pops.
export function pulse(t, attack = 0.2) {
  t = clamp01(t);
  if (t < attack) return EASE.outQuad(t / attack);
  return 1 - EASE.inOutQuad((t - attack) / (1 - attack));
}

// --- Tweens: fixed pool, no allocation per frame --------------------------------------------------
// tweens.add({ duration, delay, ease, onUpdate(v, t), onDone }) drives v from 0 to 1 (eased).
export class Tweens {
  constructor(capacity = 64) {
    this.pool = Array.from({ length: capacity }, () => ({ active: false, t: 0, delay: 0, duration: 1, ease: EASE.linear, onUpdate: null, onDone: null }));
  }

  add({ duration = 0.3, delay = 0, ease = EASE.outCubic, onUpdate = null, onDone = null } = {}) {
    // Full: reuse the most advanced tween (it is nearly done anyway) after finishing it.
    let slot = this.pool.find(s => !s.active);
    if (!slot) {
      slot = this.pool.reduce((a, b) => (b.t / b.duration > a.t / a.duration ? b : a));
      this.finish(slot);
    }
    Object.assign(slot, { active: true, t: 0, delay, duration: Math.max(1e-4, duration), ease, onUpdate, onDone });
    return slot;
  }

  finish(s) {
    s.active = false;
    s.onUpdate?.(1, 1);
    s.onDone?.();
  }

  get count() { return this.pool.reduce((n, s) => n + (s.active ? 1 : 0), 0); }

  update(dt) {
    for (const s of this.pool) {
      if (!s.active) continue;
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.t += dt;
      if (s.t >= s.duration) this.finish(s);
      else s.onUpdate?.(s.ease(s.t / s.duration), s.t / s.duration);
    }
  }

  clear() { for (const s of this.pool) s.active = false; }
}

// --- REDUCE EFFECTS (accessibility) ---------------------------------------------------------------
// On: no screen shake, softer full-screen flashes, half the particles and no decorative UI motion
// (body.reduce-effects in CSS). Defaults to the OS "reduce motion" preference until the player picks.
export function prefersReducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch (_e) { return false; }
}

export function loadReduceEffects() {
  try {
    const v = globalThis.localStorage?.getItem(REDUCE_EFFECTS_STORAGE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_e) { /* Storage may be unavailable in private or embedded contexts. */ }
  return prefersReducedMotion();
}

export function saveReduceEffects(on) {
  try {
    globalThis.localStorage?.setItem(REDUCE_EFFECTS_STORAGE_KEY, on ? '1' : '0');
  } catch (_e) {}
}

const state = { reduced: false };

export function setReduceEffects(on) {
  state.reduced = !!on;
  globalThis.document?.body?.classList?.toggle('reduce-effects', state.reduced);
}

export const isReduceEffects = () => state.reduced;

// Multipliers effects read every frame.
export const shakeScale = () => (state.reduced ? 0 : 1);
export const flashScale = () => (state.reduced ? 0.3 : 1);

// Particle budget: full up to ~120 enemies, easing to 55% by 260 so dense late waves stay readable
// and cheap; Reduce Effects halves it on top.
export function particleDensity(enemyCount = 0) {
  const crowd = enemyCount <= 120 ? 1 : Math.max(0.55, 1 - ((enemyCount - 120) / 140) * 0.45);
  return crowd * (state.reduced ? 0.5 : 1);
}

// --- Burst presets ----------------------------------------------------------------------------
// burst(fx, name, x, y, opts): fx = { particles, grid } (either may be missing). opts.hue overrides
// the preset colour, opts.scale sizes it. Every call is a handful of pooled particle spawns.
let lastPickupGlint = -Infinity;
export const BURSTS = Object.freeze({
  // The ship levels up: a bright bloom, two rings and a sparkle of embers.
  levelUp(fx, x, y, { hue = 145, scale = 1 } = {}) {
    fx.particles?.spawnFlash?.(x, y, 60 * scale, hue, 0.26);
    fx.particles?.spawnShockwave?.(x, y, 120 * scale, 55, 3, 0.36);
    fx.particles?.spawnExplosionSparks?.(x, y, Math.round(22 * scale), hue, 1.5, 9, 2.4);
  },
  // A weapon unlock or Breakthrough: a gold-white flash plus a wide colored halo.
  unlock(fx, x, y, { hue = 280, scale = 1 } = {}) {
    fx.particles?.spawnFlash?.(x, y, 140 * scale, hue, 0.45);
    fx.particles?.spawnFlash?.(x, y, 60 * scale, 52, 0.25);
    fx.particles?.spawnShockwave?.(x, y, 300 * scale, hue, 6, 0.6);
    fx.particles?.spawnShockwave?.(x, y, 160 * scale, 52, 3, 0.42);
    fx.particles?.spawnExplosionSparks?.(x, y, Math.round(40 * scale), hue, 2, 15, 2.6);
    fx.grid?.applyImpulse?.(x, y, 70 * scale, 300 * scale, hue);
    fx.grid?.ripple?.(x, y, 300 * scale, hue, 1.2);
  },
  // A level-up card is taken: a snap flash and a tight ring in the card's colour.
  pick(fx, x, y, { hue = 190, scale = 1 } = {}) {
    fx.particles?.spawnFlash?.(x, y, 44 * scale, hue, 0.18);
    fx.particles?.spawnShockwave?.(x, y, 90 * scale, hue, 3.5, 0.28);
    fx.particles?.spawnExplosionSparks?.(x, y, Math.round(14 * scale), hue, 2, 8, 2.2);
  },
  // An XP geom lands: a tiny glint (cheap enough for a big hoover).
  pickup(fx, x, y, { hue = 150, scale = 1 } = {}) {
    if ((fx.particles?.density ?? 1) < 0.8) return; // dense waves / REDUCE EFFECTS: skip the glints
    // At most one glint per 70 ms, so hoovering a big cluster doesn't white out the ship.
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (now - lastPickupGlint < 70) return;
    lastPickupGlint = now;
    fx.particles?.spawnFlash?.(x, y, 11 * scale, hue, 0.09);
  },
  // Gold: a warm glint with a couple of sparks.
  gold(fx, x, y, { hue = 48, scale = 1 } = {}) {
    fx.particles?.spawnFlash?.(x, y, 20 * scale, hue, 0.14);
    fx.particles?.spawnExplosionSparks?.(x, y, 3, hue, 1, 4, 1.8);
  },
  // A Void Core: a violet flourish ring and a soft bloom.
  core(fx, x, y, { hue = 285, scale = 1 } = {}) {
    fx.particles?.spawnFlash?.(x, y, 46 * scale, hue, 0.3);
    fx.particles?.spawnShockwave?.(x, y, 60 * scale, hue, 2.5, 0.4);
    fx.particles?.spawnExplosionSparks?.(x, y, 10, hue, 1, 6, 2.2);
  },
  // The shield takes a hit: short arcs crackle around its rim (opts.r = shield radius).
  shieldCrackle(fx, x, y, { hue = 190, scale = 1, r = 26 } = {}) {
    const arcs = Math.max(2, Math.round(3 * scale));
    for (let i = 0; i < arcs; i++) {
      const a = Math.random() * Math.PI * 2, span = 0.7 + Math.random() * 0.6;
      fx.particles?.spawnLightning?.(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a + span) * r, y + Math.sin(a + span) * r, hue, 1.2, 0.16, 0);
    }
  },
  // Dash take-off: a fan of speed streaks thrown out behind the ship (opts.angle = travel direction).
  dash(fx, x, y, { hue = 188, scale = 1, angle = 0 } = {}) {
    fx.particles?.spawnDirectionalSparks?.(x, y, angle + Math.PI, 0.55, Math.round(14 * scale), hue, 13);
  },
  // A ring sized to whatever popped (radius r).
  pop(fx, x, y, { hue = 190, scale = 1, r = 12 } = {}) {
    fx.particles?.spawnShockwave?.(x, y, r * 3 * scale, hue, 2, 0.24);
    fx.grid?.ripple?.(x, y, r * 4 * scale, hue);
  }
});

export function burst(fx, name, x, y, opts = {}) {
  const preset = BURSTS[name];
  if (!preset || !fx) return false;
  preset(fx, x, y, opts);
  return true;
}
