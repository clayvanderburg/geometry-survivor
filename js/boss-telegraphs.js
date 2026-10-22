// Boss telegraphs: pooled, telegraphed area attacks for every boss (minors in js/bosses.js, majors in
// js/bosses-major.js). Each one shows its footprint first (a warning that fills in and flashes faster as
// it nears), then goes live and hits the ship once if it is inside. Three shapes:
//   zone(x, y, r)            a circle that detonates (Brood Queen egg clutches, the Eclipse nova, Hive
//                            Carrier shells, the Prism's nova)
//   lane(x1, y1, x2, y2, w)  a strip, optionally swept by a blast front (Wing Commander airstrikes,
//                            Progenitor pseudopods, Architect blueprints, Prism beams and spokes)
//   wave(x, y, ...)          an expanding ring with safe gaps (Event Horizon gravity waves, the
//                            Conductor's downbeat)
// plus two show-only kinds: label (a world-space callout such as "SHIELD DOWN" over a boss) and fx (a
// delayed shockwave / spark burst: staged death explosions).
// `look` picks how a shape is drawn and goes off: the default, or the major bosses' 'reticle' (target
// circle), 'blueprint' (a dashed line that prints into a laser wall) and 'shock' (a rolling shock ring).
// EnemyManager owns the pool: it advances the timers (update) and draws it; Game resolves hits against
// the ship each tick through the same callback as plasma orbs (hitPlayer), so damage rides the wave's
// damage ramp, is skipped during a dash's invulnerability and lands in the run stats.
// Timers are seconds; speeds are px per fixed 60 Hz tick.

import { flashScale } from './juice.js'; // REDUCE EFFECTS dims the blast glow

export const HAZARD = {
  cap: 160,          // hazards at once, labels and fx included (a new one past the cap is skipped)
  live: 0.14,        // s a zone / lane stays live after it detonates (the hit window)
  flash: 0.32,       // s the detonation glow lingers on screen
  hue: 0             // default warning hue (danger red)
};

// Glow after going off, per look (default: HAZARD.flash).
const LOOK_FLASH = { reticle: 0.3, blueprint: 0, shock: 0 };

// The major bosses' hit rules, spread into their hazards' options: the whole hull counts (slack 1), a
// hit a dash shrugs off still spends the hazard (spend), and a landed hit shakes harder.
export const MAJOR_HIT = { slack: 1, spend: true, shake: 14 };

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
export function inGap(h, a) {
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
    while (this.active.length) this.release(this.active.length - 1);
  }

  // Options shared by every kind: delay (s before it appears at all), hue, from (the boss kind for the
  // run stats), owner (a hull: the hazard vanishes if it dies), follow (a hull it rides; a damaging
  // hazard only until it goes live). Damaging kinds also take: warn (s; 0 goes live at once), damage
  // (an orb hit before the wave ramp), onFire(h, fx) (called once as it goes live: sound, spawns), look,
  // live (s it stays live; a lane adds its sweep), window (s it can hit for once live; default: while
  // live), slack (the share of the hull radius that counts; 0.5: grazing an edge is a miss), spend (a
  // dodged hit spends it), rehit (a held beam may hit again this many s after a hit), shake.
  take(kind, o) {
    if (this.active.length >= this.capacity) return null;
    const h = this.free.pop() || {};
    h.kind = kind;
    h.look = o.look || null;
    h.x = o.x; h.y = o.y; h.x2 = o.x2 ?? o.x; h.y2 = o.y2 ?? o.y;
    h.r = o.r ?? 0; h.w = o.w ?? 0;
    h.delay = o.delay ?? 0;
    h.warn = o.warn === 0 ? 0 : Math.max(0.05, o.warn ?? 1);
    h.t = h.warn;               // counts down through the warning, then the live window
    h.state = 'warn';
    h.live = o.live ?? HAZARD.live;
    h.window = o.window ?? Infinity;
    h.hitT = Infinity;
    h.damage = o.damage ?? 20;
    h.from = o.from || null;
    h.hue = o.hue ?? HAZARD.hue;
    h.slack = o.slack ?? 0.5;
    h.spend = !!o.spend;
    h.shake = o.shake ?? null;
    h.rehit = o.rehit ?? 0;
    h.hitCd = 0;
    h.sweep = o.sweep ?? 0;     // lane: s the blast front takes to run its length (0: all at once)
    h.speed = o.speed ?? 0;     // wave: ring growth px/tick
    h.rMax = o.rMax ?? 0;
    h.gaps = o.gaps || [];
    h.gapWidth = o.gapWidth ?? 0.5;
    h.text = o.text ?? '';      // label
    h.life = h.maxLife = o.life ?? 0;
    h.dur = o.dur ?? 0;         // fx: shockwave duration
    h.sparks = o.sparks ?? 0;
    h.hit = false;
    h.cancel = false;
    h.age = 0;
    h.glow = 0;
    h.onFire = o.onFire || null;
    h.follow = o.follow || null;
    h.owner = o.owner || null;
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

  // A callout floating up over (x, y) for `life` s; `follow`: a hull it stays over.
  label(x, y, text, o = {}) {
    return this.take('label', { hue: 48, life: 1.6, ...o, x, y, text });
  }

  // A shockwave `radius` px (and `sparks`) `delay` s from now. No damage.
  fx(x, y, o = {}) {
    return this.take('fx', { radius: 300, hue: 48, width: 5, dur: 0.5, ...o, x, y, r: o.radius ?? 300, w: o.width ?? 5 });
  }

  // Takes a hazard off the field without it going off (a boss changing phase, or dying).
  cancel(h) {
    if (h) h.cancel = true;
  }

  // Timers and detonation effects. `fx` carries particles / grid / sound (any may be missing).
  update(dt, fx = {}) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      if (h.cancel || h.owner?.dead) {
        this.release(i);
        continue;
      }
      if (h.delay > 0) {
        h.delay -= dt;
        continue;
      }
      h.age += dt;
      if (h.kind === 'label') {
        h.life -= dt;
        if (h.follow && !h.follow.dead) {
          h.x = h.follow.x;
          h.y = h.follow.y - h.follow.radius * 2.4;
        }
        if (h.life <= 0) this.release(i);
        continue;
      }
      if (h.kind === 'fx') {
        fx.particles?.spawnShockwave?.(h.x, h.y, h.r, h.hue, h.w, h.dur);
        if (h.sparks) fx.particles?.spawnExplosionSparks?.(h.x, h.y, h.sparks, h.hue, 3, 18, 2.6);
        fx.grid?.applyImpulse?.(h.x, h.y, 50, h.r, h.hue);
        this.release(i);
        continue;
      }
      h.t -= dt;
      if (h.state === 'warn') {
        if (h.follow && !h.follow.dead) {
          h.x = h.follow.x;
          h.y = h.follow.y;
        }
        if (h.t > 0) continue;
        h.follow = null;
        h.state = 'live';
        h.glow = LOOK_FLASH[h.look] ?? HAZARD.flash;
        h.t = h.kind === 'wave' ? Infinity : h.live + h.sweep;
        h.hitT = h.window;
        this.detonate(h, fx);
        h.onFire?.(h, fx);
        if (h.warn > 0) continue; // an unwarned hazard acts on the tick it appears
      } else {
        h.hitT -= dt;
      }
      if (h.glow > 0) h.glow = Math.max(0, h.glow - dt);
      if (h.hitCd > 0) h.hitCd -= dt;
      if (h.hit && h.rehit > 0 && h.hitCd <= 0) h.hit = false;
      if (h.kind === 'wave') {
        h.r += h.speed * 60 * dt;
        if (h.r - h.w > h.rMax) this.release(i);
        continue;
      }
      if (h.kind === 'lane' && h.sweep > 0 && h.t > h.live && fx.particles) {
        // The blast front: a pop of fire every few ticks as it runs down the lane.
        const k = 1 - (h.t - h.live) / h.sweep;
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
      if (h.look === 'reticle') {
        p?.spawnShockwave?.(h.x, h.y, h.r * 1.35, h.hue, 4, 0.32);
        p?.spawnExplosionSparks?.(h.x, h.y, 10, h.hue, 3, 10, 2.2);
        fx.grid?.applyImpulse?.(h.x, h.y, 30, h.r * 1.6, h.hue);
        return;
      }
      p?.spawnFlash?.(h.x, h.y, h.r * 1.6 * flashScale(), h.hue, 0.2);
      p?.spawnShockwave?.(h.x, h.y, h.r * 1.25, h.hue, 4, 0.3);
      p?.spawnExplosionSparks?.(h.x, h.y, 12, h.hue, 2, 9, 2.2);
      fx.grid?.applyImpulse?.(h.x, h.y, 26, h.r * 1.6, h.hue);
    } else if (h.kind === 'lane' && !h.sweep) {
      const mx = (h.x + h.x2) / 2;
      const my = (h.y + h.y2) / 2;
      const half = Math.hypot(h.x2 - h.x, h.y2 - h.y) * 0.5;
      if (h.look === 'blueprint') {
        p?.spawnLightning?.(h.x, h.y, h.x2, h.y2, h.hue, 1.6, 0.25, 0);
        fx.grid?.applyImpulse?.(mx, my, 25, half, h.hue);
      } else {
        fx.grid?.applyImpulse?.(mx, my, 20, half, h.hue);
      }
    } else if (h.kind === 'wave' && h.look !== 'shock') {
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
    h.owner = null;
    this.free.push(h);
  }

  // Is the ship (centre px, py, radius pr) inside live hazard h right now? Only `slack` of the hull
  // radius counts (half by default, so grazing an edge is a miss).
  touches(h, px, py, pr) {
    const slack = pr * h.slack;
    if (h.kind === 'zone') return Math.hypot(px - h.x, py - h.y) < h.r + slack;
    if (h.kind === 'lane') {
      const s = segment(px, py, h.x, h.y, h.x2, h.y2);
      if (s.d > h.w * 0.5 + slack) return false;
      if (!(h.sweep > 0)) return true;
      // Only the blast front hurts: the stretch it is passing over right now.
      const k = Math.min(1, 1 - (h.t - h.live) / h.sweep);
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
  // b.damage (scaled by the wave ramp), b.from and b.shake, and returns true when the hit landed (false
  // during a dash or a hit's invulnerability). Each hazard lands at most one hit (a held beam: one per
  // rehit), and at most one lands per call; a dodged hazard stays armed unless it is `spend`.
  hitPlayer(player, onHit) {
    if (!player || !onHit) return false;
    const pr = player.radius ?? 15;
    let landed = false;
    for (const h of this.active) {
      if (h.state !== 'live' || h.hit || h.hitT < 0 || h.delay > 0 || !this.touches(h, player.x, player.y, pr)) continue;
      if (!landed && onHit({ x: player.x, y: player.y, damage: h.damage, from: h.from, shake: h.shake })) landed = true;
      else if (!h.spend) continue;
      h.hit = true;
      h.hitCd = h.rehit;
    }
    return landed;
  }

  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    const list = this.active;
    if (!list.length) return;
    for (const h of list) {
      if (h.delay > 0 || h.kind === 'fx') continue;
      const reach = h.kind === 'wave' ? h.r + h.w : h.kind === 'lane' ? Math.hypot(h.x2 - h.x, h.y2 - h.y) + h.w : h.kind === 'label' ? 200 : h.r + 20;
      if (h.x + reach < camX || h.y + reach < camY || h.x - reach > camX + viewW || h.y - reach > camY + viewH) continue;
      if (h.kind === 'zone') (h.look === 'reticle' ? drawReticle : drawZone)(ctx, h);
      else if (h.kind === 'lane') (h.look === 'blueprint' ? drawBlueprint : drawLane)(ctx, h);
      else if (h.kind === 'wave') (h.look === 'shock' ? drawShock : drawWave)(ctx, h);
      else drawLabel(ctx, h);
    }
  }
}

// Warning: a dashed rim crawling round, a disc that fills from the centre out as it nears, flashing
// faster at the end. Live: a white-hot disc that fades.
function drawZone(ctx, h) {
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

// Target circle: a dashed rim with crosshair ticks, an inner red disc that fills toward the rim as the
// fuse burns, flashing faster near the end; then a white-hot flash on detonation.
function drawReticle(ctx, h) {
  if (h.state === 'live') {
    const k = Math.max(0, h.glow / LOOK_FLASH.reticle);
    ctx.fillStyle = `hsla(${h.hue}, 100%, 75%, ${0.35 * k})`;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r * (1 + (1 - k) * 0.25), 0, TAU);
    ctx.fill();
    return;
  }
  const left = Math.max(0, h.t);
  const t = 1 - left / h.warn;
  const flash = 0.5 + 0.5 * Math.cos(left * Math.PI * (6 + t * 14));
  ctx.strokeStyle = `hsla(${flash > 0.5 ? 0 : h.hue}, 100%, 62%, ${0.6 + 0.4 * t})`;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  const spin = h.age * 1.5;
  for (let k = 0; k < 8; k++) {
    const a = spin + (k * Math.PI) / 4;
    ctx.moveTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
    ctx.arc(h.x, h.y, h.r, a, a + 0.5);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.moveTo(h.x + Math.cos(a) * h.r * 1.18, h.y + Math.sin(a) * h.r * 1.18);
    ctx.lineTo(h.x + Math.cos(a) * h.r * 0.82, h.y + Math.sin(a) * h.r * 0.82);
  }
  ctx.stroke();
  ctx.fillStyle = `hsla(0, 100%, 55%, ${0.12 + 0.26 * t})`;
  ctx.beginPath();
  ctx.arc(h.x, h.y, h.r * t, 0, TAU);
  ctx.fill();
}

// Warning: the strip's outline with chevrons filling in down its length. Live: a hot core line
// (swept lanes burn behind their blast front).
function drawLane(ctx, h) {
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
    const front = h.sweep > 0 ? Math.min(1, 1 - (h.t - h.live) / h.sweep) : 1;
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

// Blueprint line while it prints (thin dashes crawling, brightening), then a two-pass laser wall.
function drawBlueprint(ctx, h) {
  if (h.state === 'warn') {
    const left = Math.max(0, h.t);
    const t = 1 - left / h.warn;
    const flash = 0.5 + 0.5 * Math.cos(left * Math.PI * (5 + t * 12));
    ctx.save();
    ctx.setLineDash?.([14, 10]);
    ctx.lineDashOffset = -h.age * 60;
    ctx.strokeStyle = `hsla(${h.hue}, 100%, ${60 + flash * 20}%, ${0.35 + 0.5 * t})`;
    ctx.lineWidth = 1.5 + t * 2;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x2, h.y2);
    ctx.stroke();
    ctx.setLineDash?.([]);
    // The wall's width, faintly, so the danger zone reads.
    ctx.strokeStyle = `hsla(${h.hue}, 100%, 60%, ${0.06 + 0.12 * t})`;
    ctx.lineWidth = h.w;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x2, h.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const k = Math.max(0, Math.min(1, h.t / (h.live || 1)));
  ctx.lineCap = 'round';
  ctx.strokeStyle = `hsla(${h.hue}, 100%, 60%, ${0.5 * k})`;
  ctx.lineWidth = h.w * (1.2 + 0.4 * k);
  ctx.beginPath();
  ctx.moveTo(h.x, h.y);
  ctx.lineTo(h.x2, h.y2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 240, ${0.9 * k})`;
  ctx.lineWidth = h.w * 0.35;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// Warning: the ring at its start radius and a bright spoke down each safe gap. Live: the ring
// itself, drawn as arcs that skip the gaps.
function drawWave(ctx, h) {
  const k = h.state === 'warn' ? 1 - Math.max(0, h.t) / h.warn : 1;
  if (h.state === 'warn') {
    ctx.strokeStyle = `hsla(140, 100%, 70%, ${0.25 + k * 0.55})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const g of h.gaps) {
      const c = Math.cos(g), s = Math.sin(g);
      ctx.moveTo(h.x + c * h.r, h.y + s * h.r);
      ctx.lineTo(h.x + c * (h.r + 60 + 160 * k), h.y + s * (h.r + 60 + 160 * k));
    }
    ctx.stroke();
  }
  const alpha = h.state === 'warn' ? 0.25 + k * 0.4 : 0.85;
  const steps = 48;
  const step = TAU / steps;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${h.hue}, 100%, 60%, ${alpha * 0.45})` : `hsla(${h.hue}, 100%, 78%, ${alpha})`;
    ctx.lineWidth = pass === 0 ? h.w : Math.max(2, h.w * 0.25);
    ctx.beginPath();
    let open = false;
    for (let s = 0; s <= steps; s++) {
      const a = s * step;
      const x = h.x + Math.cos(a) * h.r;
      const y = h.y + Math.sin(a) * h.r;
      if (inGap(h, a)) { open = false; continue; }
      if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Shock ring: a bright band with its gaps left dark, gap edges marked by short white ticks; it fades
// out over its last 120 px.
function drawShock(ctx, h) {
  const fade = Math.max(0, Math.min(1, (h.rMax + h.w - h.r) / 120));
  const n = h.gaps.length;
  const arcs = [];
  if (n === 0) arcs.push([0, TAU]);
  else {
    const g = h.gaps.map(wrap).sort((a, b) => a - b);
    for (let k = 0; k < n; k++) {
      const a0 = g[k] + h.gapWidth / 2;
      const a1 = (k + 1 < n ? g[k + 1] : g[0] + TAU) - h.gapWidth / 2;
      if (a1 > a0) arcs.push([a0, a1]);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${h.hue}, 100%, 55%, ${0.35 * fade})` : `hsla(${h.hue}, 100%, 82%, ${0.9 * fade})`;
    ctx.lineWidth = pass === 0 ? h.w : h.w * 0.3;
    ctx.beginPath();
    for (const [a0, a1] of arcs) {
      ctx.moveTo(h.x + Math.cos(a0) * h.r, h.y + Math.sin(a0) * h.r);
      ctx.arc(h.x, h.y, h.r, a0, a1);
    }
    ctx.stroke();
  }
  if (n) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * fade})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a0, a1] of arcs) {
      for (const a of [a0, a1]) {
        ctx.moveTo(h.x + Math.cos(a) * (h.r - h.w), h.y + Math.sin(a) * (h.r - h.w));
        ctx.lineTo(h.x + Math.cos(a) * (h.r + h.w), h.y + Math.sin(a) * (h.r + h.w));
      }
    }
    ctx.stroke();
  }
}

// A callout that pops in, drifts up and fades.
function drawLabel(ctx, h) {
  const k = Math.min(1, h.life / 0.4, (h.maxLife - h.life) / 0.12 + 0.2);
  const y = h.y - (h.maxLife - h.life) * 14;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = 'bold 20px "Orbitron", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 * k})`;
  ctx.strokeText(h.text, h.x, y);
  ctx.fillStyle = `hsla(${h.hue}, 100%, 70%, ${k})`;
  ctx.fillText(h.text, h.x, y);
  ctx.restore();
}
