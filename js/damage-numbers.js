// Floating Damage Numbers: pooled, canvas-drawn, aggregated per enemy + weapon source.
// Rapid hits on one target merge into a single rising total, and the live count is hard-capped
// so a 200-enemy screen stays readable (and cheap) instead of turning into a wall of digits.
import { TUNING } from './config.js';

export const DAMAGE_NUMBERS_STORAGE_KEY = 'vexolith_damage_numbers';

// One readable colour per damage source, matched to each weapon's own neon so numbers say who hit.
export const DAMAGE_SOURCE_COLORS = {
  blaster: '#7ffbff',     // Primary twin blaster (and Pulsar Helix arms)
  missile: '#ff9b3d',     // Swarm missiles / explosive splash
  lightning: '#c79bff',   // Chain lightning arcs
  orbital: '#6dff9e',     // Orbiting blades
  singularity: '#ff6ad5', // Vortex singularity grind + collapse
  supernova: '#ffe45c',   // Supernova bomb
  other: '#e8eef8'        // Shrapnel, dash nova, tectonic bore, black-hole bursts
};

const MERGE_WINDOW = 0.3;   // seconds since the last hit that still count as "the same burst"
const MERGE_MAX_AGE = 1.0;  // a burst becomes a fresh number after this long, so totals read as ~DPS
const LIFE = 0.7;           // seconds a number lingers after its last hit
const RISE_SPEED = 46;      // px/s upward drift
const POP_DECAY = 7;        // merge "pop" scale bump decays per second

export function loadDamageNumbersEnabled() {
  try {
    return localStorage.getItem(DAMAGE_NUMBERS_STORAGE_KEY) !== '0';
  } catch (_e) { /* Storage may be unavailable in private or embedded contexts. */ }
  return true;
}

export function saveDamageNumbersEnabled(on) {
  try {
    localStorage.setItem(DAMAGE_NUMBERS_STORAGE_KEY, on ? '1' : '0');
  } catch (_e) {}
}

// Exact integers up to 99,999; beyond that a compact "123.4K" keeps boss totals narrow.
export function formatDamage(value) {
  const v = Math.max(1, Math.round(value));
  if (v < 100000) return String(v);
  if (v < 1e7) return `${(v / 1000).toFixed(1)}K`;
  return `${(v / 1e6).toFixed(1)}M`;
}

// Gentle log scale: 10 dmg ≈ 15px, 100 ≈ 18px, 1000 ≈ 21px, capped at 26px (before the tuning scale).
export function damageFontSize(value) {
  return Math.min(26, 12 + 3.2 * Math.log10(Math.max(1, value)));
}

export class DamageNumbers {
  constructor({ capacity = 120 } = {}) {
    this.enabled = loadDamageNumbersEnabled();
    // Fixed pool: entries are recycled, never allocated during play.
    this.pool = Array.from({ length: capacity }, () => ({
      target: null, source: 'blaster', value: 0, text: '', x: 0, y: 0, ox: 0, oy: 0, rise: 0,
      life: 0, age: 0, sinceHit: 0, pop: 0, size: 12
    }));
    this.count = 0;
    this.fontCache = new Map();
  }

  get cap() {
    return Math.max(1, Math.min(this.pool.length, Math.round(TUNING.damageNumberCap ?? 48)));
  }

  setEnabled(on) {
    this.enabled = !!on;
    saveDamageNumbersEnabled(this.enabled);
    if (!this.enabled) this.clear();
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  clear() {
    for (let i = 0; i < this.count; i++) this.pool[i].target = null;
    this.count = 0;
  }

  // Record `amount` damage dealt to enemy `e` by `source`. Returns the live entry, or null when
  // numbers are off or the spot is saturated (that hit simply goes unlabelled).
  add(e, amount, source = 'blaster') {
    if (!this.enabled || !(amount > 0)) return null;

    // Fast path: the enemy remembers its most recent number.
    let n = e.dmgNum;
    if (!n || n.target !== e || n.source !== source || n.life <= 0) {
      n = null;
      for (let i = 0; i < this.count; i++) {
        const c = this.pool[i];
        if (c.target === e && c.source === source) { n = c; break; }
      }
    }

    if (n && n.sinceHit <= MERGE_WINDOW && n.age <= MERGE_MAX_AGE) {
      n.value += amount;
      n.sinceHit = 0;
      n.life = LIFE;
      n.pop = 1;
      // Ride along with the target while it is still being hit (drift only once hits stop), unless
      // that would slide onto another live number — pulled clusters (singularity) then stay legible.
      const nx = e.x + n.ox;
      const ny = e.y - e.radius - 6 + n.oy;
      const rise = n.rise * 0.5;
      if (!this.blocked(nx, ny - rise, n.text.length, n.size, n)) {
        n.x = nx;
        n.y = ny;
        n.rise = rise;
      }
    } else {
      if (n) n.target = null; // retire the old burst; it keeps floating as a finished total
      const ox = ((this.count * 7) % 11) - 5; // tiny deterministic jitter
      const oy = this.freeLane(e.x + ox, e.y - e.radius - 6, formatDamage(amount).length, damageFontSize(amount));
      if (oy === null) return null;
      n = this.acquire();
      n.target = e;
      n.source = source;
      n.value = amount;
      n.ox = ox;
      n.oy = oy;
      n.x = e.x + n.ox;
      n.y = e.y - e.radius - 6 + n.oy;
      n.rise = 0;
      n.age = 0;
      n.sinceHit = 0;
      n.life = LIFE;
      n.pop = 0.6;
    }
    n.text = formatDamage(n.value);
    n.size = damageFontSize(n.value);
    e.dmgNum = n;
    return n;
  }

  // Packed swarms put many targets on one spot: step a new number up (at most 3 lanes) past any
  // live number already printed there, so values stack into a short column instead of overprinting.
  // Returns null when every lane is taken — that spot is already saturated with readable numbers.
  freeLane(x, y, chars = 2, size = 15) {
    const step = Math.max(14, Math.round(size * 0.8 * (TUNING.damageNumberScale ?? 1.0)));
    let oy = 0;
    for (let lane = 0; lane < 3; lane++) {
      if (!this.blocked(x, y + oy, chars, size)) return oy;
      oy -= step;
    }
    return null;
  }

  // Would a `chars`-wide label of `size` px drawn at (x, y) collide with a live number (other than
  // `self`)? Widths come from each label's drawn size (heavy digits are ~0.62em wide, plus
  // the outline and a small gap so adjacent totals never fuse into one long number), so wide
  // totals like "2203" keep clear of their neighbours too.
  blocked(x, y, chars, size, self = null) {
    const scale = TUNING.damageNumberScale ?? 1.0;
    const halfW = chars * size * 0.33 * scale + 3;
    for (let i = 0; i < this.count; i++) {
      const c = this.pool[i];
      if (c === self) continue;
      const cs = c.size * scale;
      if (Math.abs(c.x - x) < halfW + c.text.length * cs * 0.33 + 3 &&
          Math.abs(c.y - c.rise - y) < Math.max(12, 0.75 * Math.max(size * scale, cs))) return true;
    }
    return false;
  }

  // Take a free pool slot, or recycle the number closest to expiring when the cap is reached.
  acquire() {
    const cap = this.cap;
    if (this.count < cap) return this.pool[this.count++];
    // Cap lowered live: drop the overflow first.
    while (this.count > cap) this.pool[--this.count].target = null;
    let victim = 0;
    for (let i = 1; i < this.count; i++) {
      if (this.pool[i].life < this.pool[victim].life) victim = i;
    }
    this.pool[victim].target = null;
    return this.pool[victim];
  }

  update(dt) {
    for (let i = this.count - 1; i >= 0; i--) {
      const n = this.pool[i];
      n.age += dt;
      n.sinceHit += dt;
      n.life -= dt;
      n.rise += RISE_SPEED * dt;
      if (n.pop > 0) n.pop = Math.max(0, n.pop - dt * POP_DECAY);
      if (n.target && n.target.dead) n.target = null;
      if (n.life <= 0) {
        // Swap-remove keeps live entries packed at the front of the pool.
        n.target = null;
        const last = this.pool[--this.count];
        this.pool[this.count] = n;
        this.pool[i] = last;
      }
    }
  }

  font(px) {
    let f = this.fontCache.get(px);
    if (!f) {
      f = `900 ${px}px system-ui, sans-serif`;
      this.fontCache.set(px, f);
    }
    return f;
  }

  // World-space draw (call inside the camera transform). Dark outline + solid fill stays legible
  // over additive neon, and source-over keeps overlapping numbers from blowing out to white.
  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    if (!this.enabled || this.count === 0) return;
    const scale = TUNING.damageNumberScale ?? 1.0;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3, 4, 11, 0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i < this.count; i++) {
      const n = this.pool[i];
      const y = n.y - n.rise;
      if (n.x < camX - 60 || n.x > camX + viewW + 60 || y < camY - 40 || y > camY + viewH + 40) continue;
      const px = Math.round(n.size * scale * (1 + n.pop * 0.28));
      ctx.font = this.font(px);
      ctx.globalAlpha = Math.min(1, n.life / 0.25);
      ctx.strokeText(n.text, n.x, y);
      ctx.fillStyle = DAMAGE_SOURCE_COLORS[n.source] || DAMAGE_SOURCE_COLORS.other;
      ctx.fillText(n.text, n.x, y);
    }
    ctx.restore();
  }
}
