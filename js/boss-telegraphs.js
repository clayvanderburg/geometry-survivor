// Boss telegraphs: pooled, telegraphed area attacks for the bosses (js/bosses.js). Each one shows its
// footprint first (a warning that fills in and flashes faster as it nears), then goes live for a
// moment and hits the ship once if it is inside. Three shapes:
//   zone(x, y, r)            a circle that detonates (Brood Queen egg clutches, the Eclipse nova)
//   lane(x1, y1, x2, y2, w)  a strip, optionally swept by a blast front (Wing Commander airstrikes,
//                            Progenitor pseudopods)
//   wave(x, y, ...)          an expanding ring with safe gaps (Event Horizon gravity waves)
// EnemyManager owns the pool: it advances the timers (update) and draws it; Game resolves hits
// against the ship each tick through the same callback as plasma orbs (hitPlayer), so damage rides
// the wave's damage ramp, is skipped during a dash's invulnerability and lands in the run stats.
// Timers are seconds; speeds are px per fixed 60 Hz tick.

import { flashScale } from './juice.js'; // REDUCE EFFECTS dims the blast glow

export const HAZARD = {
  cap: 64,           // live hazards at once (a new one past the cap is skipped)
  live: 0.14,        // s a zone / lane stays live after it detonates (the hit window)
  flash: 0.32,       // s the detonation glow lingers on screen
  hue: 0             // default warning hue (danger red)
};

const TAU = Math.PI * 2;

// Shortest distance from (px, py) to the segment (x1, y1)-(x2, y2), and where along it (0..1).
function segment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / len2));
  return { d: Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t)), t };
}

const wrap = (a) => {
  a %= TAU;
  return a < 0 ? a + TAU : a;
};

// True when angle `a` lies inside one of the wave's safe gaps.
function inGap(h, a) {
  for (let k = 0; k < h.gaps.length; k++) {
    const d = Math.abs(wrap(a - h.gaps[k] + Math.PI) - Math.PI);
    if (d < h.gapWidth * 0.5) return true;
  }
  return false;
}

export class BossTelegraphs {
  constructor(capacity = HAZARD.cap) {
    this.capacity = capacity;
    this.active = [];
    this.free = [];
  }

  get count() {
    return this.active.length;
  }

  clear() {
    while (this.active.length) this.free.push(this.active.pop());
  }

  take(kind, o) {
    if (this.active.length >= this.capacity) return null;
    const h = this.free.pop() || {};
    h.kind = kind;
    h.x = o.x; h.y = o.y; h.x2 = o.x2 ?? o.x; h.y2 = o.y2 ?? o.y;
    h.r = o.r ?? 0; h.w = o.w ?? 0;
    h.warn = Math.max(0.05, o.warn ?? 1);
    h.t = h.warn;               // counts down through the warning, then the live window
    h.state = 'warn';
    h.damage = o.damage ?? 20;
    h.from = o.from || null;    // the boss kind for the run stats
    h.hue = o.hue ?? HAZARD.hue;
    h.sweep = o.sweep ?? 0;     // lane: s the blast front takes to run its length (0: all at once)
    h.speed = o.speed ?? 0;     // wave: ring growth px/tick
    h.rMax = o.rMax ?? 0;
    h.gaps = o.gaps || [];
    h.gapWidth = o.gapWidth ?? 0.5;
    h.hit = false;
    h.age = 0;
    h.glow = 0;
    h.onFire = o.onFire || null; // (h, fx) called once as it goes live (sound, spawns)
    h.follow = o.follow || null; // a hull the hazard rides until it goes live (a wave from a drifting core)
    this.active.push(h);
    return h;
  }

  zone(x, y, r, o = {}) {
    return this.take('zone', { ...o, x, y, r });
  }

  lane(x1, y1, x2, y2, w, o = {}) {
    return this.take('lane', { ...o, x: x1, y: y1, x2, y2, w });
  }

  // An expanding ring from (x, y): r0 → rMax at `speed` px/tick, `w` thick, with safe `gaps` (angles).
  // `follow`: a hull it stays centred on until it goes live.
  wave(x, y, o = {}) {
    return this.take('wave', { ...o, x, y, r: o.r0 ?? 40, w: o.w ?? 16 });
  }

  // Timers and detonation effects. `fx` carries particles / grid / sound (any may be missing).
  update(dt, fx = {}) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      h.age += dt;
      h.t -= dt;
      if (h.state === 'warn') {
        if (h.follow && !h.follow.dead) {
          h.x = h.follow.x;
          h.y = h.follow.y;
        }
        if (h.t > 0) continue;
        h.follow = null;
        h.state = 'live';
        h.glow = HAZARD.flash;
        h.t = h.kind === 'wave' ? Infinity : HAZARD.live + h.sweep;
        this.detonate(h, fx);
        h.onFire?.(h, fx);
        continue;
      }
      if (h.glow > 0) h.glow = Math.max(0, h.glow - dt);
      if (h.kind === 'wave') {
        h.r += h.speed * 60 * dt;
        if (h.r - h.w > h.rMax) this.release(i);
        continue;
      }
      if (h.kind === 'lane' && h.sweep > 0 && h.t > HAZARD.live && fx.particles) {
        // The blast front: a pop of fire every few ticks as it runs down the lane.
        const k = 1 - (h.t - HAZARD.live) / h.sweep;
        if (((h.age * 60) | 0) % 3 === 0) {
          const x = h.x + (h.x2 - h.x) * k;
          const y = h.y + (h.y2 - h.y) * k;
          fx.particles.spawnFlash?.(x, y, h.w * 1.3 * flashScale(), 28, 0.16);
          fx.particles.spawnExplosionSparks?.(x, y, 4, 28, 2, 7, 2);
        }
      }
      if (h.t <= 0 && h.glow <= 0) this.release(i);
    }
  }

  detonate(h, fx) {
    const p = fx.particles;
    if (h.kind === 'zone') {
      p?.spawnFlash?.(h.x, h.y, h.r * 1.6 * flashScale(), h.hue, 0.2);
      p?.spawnShockwave?.(h.x, h.y, h.r * 1.25, h.hue, 4, 0.3);
      p?.spawnExplosionSparks?.(h.x, h.y, 12, h.hue, 2, 9, 2.2);
      fx.grid?.applyImpulse?.(h.x, h.y, 26, h.r * 1.6, h.hue);
    } else if (h.kind === 'lane' && !h.sweep) {
      const mx = (h.x + h.x2) / 2;
      const my = (h.y + h.y2) / 2;
      fx.grid?.applyImpulse?.(mx, my, 20, Math.hypot(h.x2 - h.x, h.y2 - h.y) * 0.5, h.hue);
    } else if (h.kind === 'wave') {
      fx.grid?.applyImpulse?.(h.x, h.y, 40, h.r * 3, h.hue);
    }
  }

  release(i) {
    const list = this.active;
    const h = list[i];
    list[i] = list[list.length - 1];
    list.pop();
    h.onFire = null;
    h.follow = null;
    this.free.push(h);
  }

  // Is the ship (centre px, py, radius pr) inside live hazard h right now? Generous to the pilot:
  // only half the hull radius counts, so grazing an edge is a miss.
  touches(h, px, py, pr) {
    const slack = pr * 0.5;
    if (h.kind === 'zone') return Math.hypot(px - h.x, py - h.y) < h.r + slack;
    if (h.kind === 'lane') {
      const s = segment(px, py, h.x, h.y, h.x2, h.y2);
      if (s.d > h.w * 0.5 + slack) return false;
      if (!(h.sweep > 0)) return true;
      // Only the blast front hurts: the stretch it is passing over right now.
      const k = Math.min(1, 1 - (h.t - HAZARD.live) / h.sweep);
      return s.t <= k + 0.04 && s.t >= k - 0.2;
    }
    if (h.kind === 'wave') {
      const d = Math.hypot(px - h.x, py - h.y);
      if (Math.abs(d - h.r) > h.w * 0.5 + slack) return false;
      return !inGap(h, Math.atan2(py - h.y, px - h.x));
    }
    return false;
  }

  // Resolve hits on the ship. `onHit(b)` is Game's plasma-orb callback: it reads b.x/b.y (sparks),
  // b.damage (scaled by the wave ramp) and b.from, and returns true when the hit landed (false during
  // a dash or a hit's invulnerability). Each hazard lands at most one hit.
  hitPlayer(player, onHit) {
    if (!player || !onHit) return false;
    const pr = player.radius ?? 15;
    for (const h of this.active) {
      if (h.state !== 'live' || h.hit || !this.touches(h, player.x, player.y, pr)) continue;
      if (onHit({ x: player.x, y: player.y, damage: h.damage, from: h.from })) {
        h.hit = true;
        return true;
      }
    }
    return false;
  }

  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    const list = this.active;
    if (!list.length) return;
    for (const h of list) {
      const reach = h.kind === 'wave' ? h.r + h.w : h.kind === 'lane' ? Math.hypot(h.x2 - h.x, h.y2 - h.y) + h.w : h.r + 10;
      if (h.x + reach < camX || h.y + reach < camY || h.x - reach > camX + viewW || h.y - reach > camY + viewH) continue;
      if (h.kind === 'zone') this.drawZone(ctx, h);
      else if (h.kind === 'lane') this.drawLane(ctx, h);
      else this.drawWave(ctx, h);
    }
  }

  // Warning: a dashed rim crawling round, a disc that fills from the centre out as it nears, flashing
  // faster at the end. Live: a white-hot disc that fades.
  drawZone(ctx, h) {
    if (h.state === 'warn') {
      const k = 1 - Math.max(0, h.t) / h.warn;
      const flash = 0.5 + 0.5 * Math.cos(h.t * Math.PI * (6 + k * 16));
      ctx.fillStyle = `hsla(${h.hue}, 100%, 55%, ${0.08 + k * 0.14})`;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * k, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsla(${h.hue}, 100%, 66%, ${0.5 + k * 0.3 + flash * 0.2})`;
      ctx.lineWidth = 2 + k * 1.5;
      ctx.beginPath();
      const n = 14;
      for (let s = 0; s < n; s++) {
        const a0 = (s / n) * TAU + h.age * 1.6;
        ctx.moveTo(h.x + Math.cos(a0) * h.r, h.y + Math.sin(a0) * h.r);
        ctx.arc(h.x, h.y, h.r, a0, a0 + (TAU / n) * 0.55);
      }
      ctx.stroke();
      return;
    }
    const g = h.glow / HAZARD.flash;
    if (g <= 0) return;
    ctx.fillStyle = `hsla(${h.hue}, 100%, 80%, ${0.35 * g})`;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, TAU);
    ctx.fill();
  }

  // Warning: the strip's outline with chevrons filling in down its length. Live: a hot core line
  // (swept lanes burn behind their blast front).
  drawLane(ctx, h) {
    const len = Math.hypot(h.x2 - h.x, h.y2 - h.y) || 1;
    const a = Math.atan2(h.y2 - h.y, h.x2 - h.x);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(a);
    const half = h.w * 0.5;
    if (h.state === 'warn') {
      const k = 1 - Math.max(0, h.t) / h.warn;
      const flash = 0.5 + 0.5 * Math.cos(h.t * Math.PI * (6 + k * 16));
      ctx.fillStyle = `hsla(${h.hue}, 100%, 55%, ${0.04 + k * 0.1})`;
      ctx.fillRect(0, -half, len, h.w);
      ctx.strokeStyle = `hsla(${h.hue}, 100%, 62%, ${0.3 + k * 0.4 + flash * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -half); ctx.lineTo(len, -half);
      ctx.moveTo(0, half); ctx.lineTo(len, half);
      const n = Math.max(2, Math.floor(len / Math.max(40, h.w * 1.2)));
      for (let s = 0; s < n; s++) {
        if (s / n > k) break;
        const x = len * ((s + 0.5) / n);
        ctx.moveTo(x - half * 0.6, -half * 0.6);
        ctx.lineTo(x, 0);
        ctx.lineTo(x - half * 0.6, half * 0.6);
      }
      ctx.stroke();
    } else {
      const g = Math.max(0, h.glow / HAZARD.flash);
      const front = h.sweep > 0 ? Math.min(1, 1 - (h.t - HAZARD.live) / h.sweep) : 1;
      ctx.fillStyle = `hsla(${h.hue}, 100%, 70%, ${0.18 + 0.3 * g})`;
      ctx.fillRect(0, -half, len * front, h.w);
      ctx.strokeStyle = `rgba(255, 245, 230, ${0.4 + 0.5 * g})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len * front, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Warning: the arcs at their start radius and a dashed spoke out of each, where it will sweep. Live:
  // the arcs themselves, rolling outward.
  drawWave(ctx, h) {
    const k = h.state === 'warn' ? 1 - Math.max(0, h.t) / h.warn : 1;
    if (h.state === 'warn') {
      // Where each arc will sweep: a dashed spoke in the hazard's hue out of the middle of every arc.
      const g0 = [...h.gaps].map(wrap).sort((p, q) => p - q);
      ctx.strokeStyle = `hsla(${h.hue}, 100%, 70%, ${0.25 + k * 0.55})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      for (let i = 0; i < g0.length; i++) {
        const mid = (g0[i] + (i + 1 < g0.length ? g0[i + 1] : g0[0] + TAU)) / 2;
        const c = Math.cos(mid), s = Math.sin(mid);
        ctx.moveTo(h.x + c * h.r, h.y + s * h.r);
        ctx.lineTo(h.x + c * (h.r + 60 + 160 * k), h.y + s * (h.r + 60 + 160 * k));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const alpha = h.state === 'warn' ? 0.25 + k * 0.4 : 0.85;
    // The solid arcs, drawn exactly between the gaps (a glow a little wider than the hit, then a hot core).
    const gaps = [...h.gaps].map(wrap).sort((p, q) => p - q);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? `hsla(${h.hue}, 100%, 60%, ${alpha * 0.45})` : `hsla(${h.hue}, 100%, 78%, ${alpha})`;
      ctx.lineWidth = pass === 0 ? h.w + 6 : Math.max(2.5, h.w * 0.4);
      ctx.beginPath();
      if (!gaps.length) {
        ctx.moveTo(h.x + h.r, h.y);
        ctx.arc(h.x, h.y, h.r, 0, TAU);
      }
      for (let i = 0; i < gaps.length; i++) {
        const a0 = gaps[i] + h.gapWidth / 2;
        const a1 = (i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + TAU) - h.gapWidth / 2;
        if (a1 <= a0) continue;
        ctx.moveTo(h.x + Math.cos(a0) * h.r, h.y + Math.sin(a0) * h.r);
        ctx.arc(h.x, h.y, h.r, a0, a1);
      }
      ctx.stroke();
    }
  }
}
