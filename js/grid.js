// World-Space Reactive Spring-Mass Warping Neon Grid (Camera-Culled for 10x Sector Map)
import { TUNING } from './config.js';

// Explosion ripples live in a fixed pool. When it is full a new ripple only replaces the weakest
// running one if it is stronger, and small pops are skipped once the pool is mostly busy.
export const MAX_RIPPLES = 24;
const RIPPLE_BUSY = Math.floor(MAX_RIPPLES * 0.75);
const RIPPLE_SMALL = 70; // blast radius (px) under which a ripple is skippable when busy

// Lit segments are batched into one stroke per (hue, brightness) bucket instead of one per point.
const HUE_BUCKETS = 30;
const GLOW_LEVELS = 8;
const GLOW_MAX = 1.5; // point energy cap
const GLOW_MIN = 0.07; // dimmer segments are not drawn lit
const GLOW_RUN = 12; // segments per stroked path
// Ship light: each line near the ship is cut into short pieces, each lit by the falloff at its own
// distance from the ship and drawn in one of LIGHT_LEVELS brightness bands (solid hairline strokes
// cost a fraction of a gradient stroke on CPU-rastered canvases).
const LIGHT_LEVELS = 12;
const LIGHT_PIECES = 4; // per grid segment

// Ship light: brightness at distance s (0 = centre, 1 = rim). Radial, smooth, zero slope at the rim.
export function lightFalloff(s) {
  if (!(s < 1)) return 0;
  const k = 1 - s * s;
  return k * k;
}

export class WarpGrid {
  constructor(worldWidth, worldHeight, spacing = 68) {
    this.spacing = spacing;
    this.stiffness = 0.04;
    this.neighborStiffness = 0.065;
    this.damping = 0.915; // base; TUNING.gridSpring stretches or shortens the ring-down
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => ({
      active: false, x: 0, y: 0, r: 0, speed: 0, width: 0, kick: 0, glow: 0, reach: 0, hue: 190
    }));
    this.light = { on: false, x: 0, y: 0, radius: 0, intensity: 0, hue: 188 };
    this.lightStyles = new Map();
    this.lightCounts = new Uint32Array(LIGHT_LEVELS);
    this.lightBuf = new Float32Array(0);
    this.lightLevel = new Uint8Array(0);
    this.glowStyles = new Array(HUE_BUCKETS * GLOW_LEVELS);
    this.glowCounts = new Uint32Array(HUE_BUCKETS * GLOW_LEVELS + 1);
    this.segs = new Int32Array(0);
    this.segKeys = new Uint16Array(0);
    this.segOrder = new Int32Array(0);
    this.resize(worldWidth, worldHeight);
  }

  resize(worldWidth, worldHeight) {
    this.width = worldWidth;
    this.height = worldHeight;
    this.cols = Math.ceil(worldWidth / this.spacing) + 1;
    this.rows = Math.ceil(worldHeight / this.spacing) + 1;
    this.points = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * this.spacing;
        const y = r * this.spacing;
        const isBorder = r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1;
        this.points.push({
          x,
          y,
          ox: x,
          oy: y,
          vx: 0,
          vy: 0,
          energy: 0,
          hue: 195,
          pinned: isBorder
        });
      }
    }
  }

  reset() {
    for (const point of this.points) {
      point.x = point.ox;
      point.y = point.oy;
      point.vx = point.vy = point.energy = 0;
    }
    for (const rp of this.ripples) rp.active = false;
    this.light.on = false;
    this.simBounds = null;
  }

  // Restricts forces to the region update() integrates; offscreen points would otherwise
  // accumulate velocity indefinitely and snap when the camera arrives.
  forceBounds(px, py, radius) {
    const b = this.simBounds;
    return {
      minCol: Math.max(b ? b.minC : 1, Math.floor((px - radius) / this.spacing)),
      maxCol: Math.min(b ? b.maxC : this.cols - 2, Math.ceil((px + radius) / this.spacing)),
      minRow: Math.max(b ? b.minR : 1, Math.floor((py - radius) / this.spacing)),
      maxRow: Math.min(b ? b.maxR : this.rows - 2, Math.ceil((py + radius) / this.spacing))
    };
  }

  // Outward shove; `glow` scales how much it lights the lines (0 = push only).
  applyImpulse(px, py, force, radius, hue = 190, glow = 1) {
    force *= (TUNING.gridWarpMult ?? 1.0);
    if (!Number.isFinite(force) || !(radius > 0) || !Number.isFinite(px + py)) return;
    const rSq = radius * radius;
    const { minCol, maxCol, minRow, maxRow } = this.forceBounds(px, py, radius);

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = pt.x - px;
        const dy = pt.y - py;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 0.001) {
          const dist = Math.sqrt(dSq);
          const falloff = 1 - dist / radius;
          const strength = (force * falloff * falloff) / dist;
          pt.vx += dx * strength;
          pt.vy += dy * strength;
          if (glow > 0) {
            pt.energy = Math.min(GLOW_MAX, pt.energy + falloff * 0.85 * glow);
            if (hue !== null) pt.hue = hue;
          }
        }
      }
    }
  }

  applyImplosion(px, py, force, radius, hue = 330, swirl = 0.25) {
    force *= (TUNING.gridWarpMult ?? 1.0);
    if (!Number.isFinite(force) || !(radius > 0) || !Number.isFinite(px + py)) return;
    const rSq = radius * radius;
    const { minCol, maxCol, minRow, maxRow } = this.forceBounds(px, py, radius);

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = px - pt.x;
        const dy = py - pt.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 4) {
          const dist = Math.sqrt(dSq);
          const falloff = 1 - dist / radius;
          const pull = (force * falloff) / dist;
          pt.vx += (dx + -dy * swirl) * pull;
          pt.vy += (dy + dx * swirl) * pull;
          pt.energy = Math.min(GLOW_MAX, pt.energy + falloff * 0.45);
          pt.hue = hue;
        }
      }
    }
  }

  // Smooth gravity funnel: each point is eased toward an inward offset that peaks near the core
  // (measured from its rest position, never past the centre), so wells read as a deep, stable dent
  // that follows a moving well instead of a tangle of over-pulled lines.
  applyWell(px, py, depth, radius, hue = 330, swirl = 0.2) {
    depth *= (TUNING.gridWarpMult ?? 1.0);
    if (!(depth > 0) || !(radius > 0) || !Number.isFinite(depth + px + py)) return;
    const rSq = radius * radius;
    const gain = 0.16;
    const { minCol, maxCol, minRow, maxRow } = this.forceBounds(px, py, radius);

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = px - pt.ox;
        const dy = py - pt.oy;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 1) {
          const dist = Math.sqrt(dSq);
          const t = 1 - dist / radius;
          const sink = Math.min(dist * 0.8, depth * t * (1.5 - 0.5 * t)) / dist;
          const tx = pt.ox + (dx - dy * swirl) * sink;
          const ty = pt.oy + (dy + dx * swirl) * sink;
          pt.vx += (tx - pt.x) * gain;
          pt.vy += (ty - pt.y) * gain;
          pt.energy = Math.min(GLOW_MAX, Math.max(pt.energy, t * 2.6));
          if (t > 0.08) pt.hue = hue;
        }
      }
    }
  }

  // The ship's bow wave: points near the hull are eased outward (zero at the centre, peaking a third
  // of the way out, fading to the rim) by an amount that grows with speed. When the ship moves on they
  // spring back and overshoot, leaving a wobbling wake. Offsets are taken from rest positions and
  // their slope stays under 1, so neighbouring points can't cross.
  applyWake(px, py, vx = 0, vy = 0, radius = 170) {
    const mult = (TUNING.gridWakeMult ?? 1.0) * (TUNING.gridWarpMult ?? 1.0);
    if (!(mult > 0) || !(radius > 0) || !Number.isFinite(px + py + vx + vy)) return;
    const speed = Math.min(30, Math.hypot(vx, vy));
    const amp = Math.min(radius * 0.4, (8 + speed * 4.5) * mult);
    const rSq = radius * radius;
    const inner = radius * 0.32;
    const gain = 0.12;
    const { minCol, maxCol, minRow, maxRow } = this.forceBounds(px, py, radius);

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = pt.ox - px;
        const dy = pt.oy - py;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 0.25) {
          const dist = Math.sqrt(dSq);
          const t = 1 - dist / radius;
          const push = (amp * t * t * Math.min(1, dist / inner)) / dist;
          pt.vx += (pt.ox + dx * push - pt.x) * gain;
          pt.vy += (pt.oy + dy * push - pt.y) * gain;
        }
      }
    }
  }

  // An explosion's ring wave, sized by its blast radius (`power` scales it for set pieces). The ring
  // travels out, kicks the lines it crosses outward (the springs bounce them back behind it) and
  // brightens them in the blast's hue. Returns the pool slot, or null when skipped.
  ripple(px, py, blastRadius, hue = 190, power = 1) {
    const mult = (TUNING.gridRippleMult ?? 1.0) * (TUNING.gridWarpMult ?? 1.0);
    const size = blastRadius * power;
    if (!(size > 0) || !(mult > 0) || !Number.isFinite(size + px + py)) return null;
    const s = Math.min(size, 1600);
    const kick = Math.min(3.2, 0.55 + Math.sqrt(s) * 0.085) * mult;
    const glow = Math.min(1.4, 0.45 + Math.sqrt(s) * 0.05);
    const reach = Math.min(2400, 160 + s * 2.6);
    const speed = 7 + Math.sqrt(s) * 0.5;
    const width = 30 + Math.sqrt(s) * 3.2;

    let free = null;
    let weakest = null;
    let weakestPower = Infinity;
    let busy = 0;
    for (const rp of this.ripples) {
      if (!rp.active) {
        free ||= rp;
        continue;
      }
      busy++;
      // A blast landing on a ripple that has only just left the same spot joins it.
      const near = Math.max(28, rp.width * 0.5);
      if (rp.r < rp.width && (rp.x - px) ** 2 + (rp.y - py) ** 2 < near * near) {
        if (kick > rp.kick) rp.hue = hue;
        rp.kick = Math.min(3.2 * mult, Math.max(rp.kick, kick) + Math.min(rp.kick, kick) * 0.25);
        rp.glow = Math.max(rp.glow, glow);
        rp.reach = Math.max(rp.reach, reach);
        rp.speed = Math.max(rp.speed, speed);
        rp.width = Math.max(rp.width, width);
        return rp;
      }
      const left = rp.kick * (1 - rp.r / rp.reach);
      if (left < weakestPower) {
        weakestPower = left;
        weakest = rp;
      }
    }
    if (busy >= RIPPLE_BUSY && blastRadius < RIPPLE_SMALL) return null;
    let slot = free;
    if (!slot) {
      if (!(kick > weakestPower)) return null;
      slot = weakest;
    }
    slot.active = true;
    slot.x = px;
    slot.y = py;
    slot.r = 0;
    slot.kick = kick;
    slot.glow = glow;
    slot.reach = reach;
    slot.speed = speed;
    slot.width = width;
    slot.hue = hue;
    return slot;
  }

  // At rest in the simulated region: no ripple running, no point moving or glowing visibly (the springs
  // ring down asymptotically, so "visibly" is a hundredth of a pixel per tick and 1% glow).
  settled() {
    if (this.activeRipples() > 0) return false;
    const b = this.simBounds;
    if (!b) return true;
    const pts = this.points;
    for (let r = b.minR; r <= b.maxR; r++) {
      const rowOffset = r * this.cols;
      for (let c = b.minC; c <= b.maxC; c++) {
        const pt = pts[rowOffset + c];
        if (Math.abs(pt.vx) + Math.abs(pt.vy) > 0.01 || pt.energy > 0.01) return false;
      }
    }
    return true;
  }

  activeRipples() {
    let n = 0;
    for (const rp of this.ripples) if (rp.active) n++;
    return n;
  }

  // Advances each ripple and pushes the band of points it is crossing (only inside simBounds).
  stepRipples() {
    const pts = this.points;
    const cols = this.cols;
    for (const rp of this.ripples) {
      if (!rp.active) continue;
      rp.r += rp.speed;
      if (rp.r - rp.width >= rp.reach) {
        rp.active = false;
        continue;
      }
      const fade = Math.max(0, 1 - rp.r / rp.reach);
      const kick = rp.kick * fade * Math.sqrt(fade);
      const glow = rp.glow * fade;
      const w = rp.width;
      const inner = Math.max(0, rp.r - w);
      const outer = rp.r + w;
      const innerSq = inner * inner;
      const outerSq = outer * outer;
      const { minCol, maxCol, minRow, maxRow } = this.forceBounds(rp.x, rp.y, outer);

      for (let r = minRow; r <= maxRow; r++) {
        const rowOffset = r * cols;
        for (let c = minCol; c <= maxCol; c++) {
          const pt = pts[rowOffset + c];
          const dx = pt.ox - rp.x;
          const dy = pt.oy - rp.y;
          const dSq = dx * dx + dy * dy;
          if (dSq >= outerSq || dSq < innerSq || dSq < 1) continue;
          const dist = Math.sqrt(dSq);
          const u = (dist - rp.r) / w; // -1 (behind the crest) .. 1 (ahead of it)
          const band = 1 - u * u;
          // Points closer to the centre than a band width get a gentler kick, so a fresh ring can't
          // fling the innermost points past their neighbours (radial spokes).
          const k = (kick * band * Math.min(1, dist / w)) / dist;
          pt.vx += dx * k;
          pt.vy += dy * k;
          const lit = glow * band;
          if (lit > pt.energy) {
            pt.energy = Math.min(GLOW_MAX, lit);
            pt.hue = rp.hue;
          }
        }
      }
    }
  }

  update(camX = 0, camY = 0, viewW = 1920, viewH = 1080) {
    const cols = this.cols;
    const rows = this.rows;
    const pts = this.points;
    const sp = this.spacing;
    const nStiff = this.neighborStiffness;
    const stiff = this.stiffness;
    // Springier grid = slower ring-down after a shove (more overshoot), clamped so it always settles.
    const spring = TUNING.gridSpring ?? 1.0;
    const damping = Math.min(0.955, Math.max(0.8, 1 - (1 - this.damping) / Math.max(0.2, spring)));

    // Only simulate active camera region (+4 cell margin) for instant performance on huge maps
    const minC = Math.max(1, Math.floor(camX / sp) - 4);
    const maxC = Math.min(cols - 2, Math.ceil((camX + viewW) / sp) + 4);
    const minR = Math.max(1, Math.floor(camY / sp) - 4);
    const maxR = Math.min(rows - 2, Math.ceil((camY + viewH) / sp) + 4);
    const b = this.simBounds || (this.simBounds = { minC, maxC, minR, maxR });
    b.minC = minC;
    b.maxC = maxC;
    b.minR = minR;
    b.maxR = maxR;

    this.stepRipples();

    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c <= maxC; c++) {
        const idx = rowOffset + c;
        const pt = pts[idx];
        const left = pts[idx - 1];
        const right = pts[idx + 1];
        const up = pts[idx - cols];
        const down = pts[idx + cols];

        const avgX = (left.x + right.x + up.x + down.x) * 0.25;
        const avgY = (left.y + right.y + up.y + down.y) * 0.25;

        pt.vx += (avgX - pt.x) * nStiff;
        pt.vy += (avgY - pt.y) * nStiff;
      }
    }

    // Displacement is clamped to a few cells and speed to most of a cell per tick, so even absurd
    // forces can't fling points across the map (or to NaN); the springs always pull them home.
    const maxDisp = sp * Math.max(0.5, TUNING.gridMaxWarp ?? 2.6);
    const maxDispSq = maxDisp * maxDisp;
    const maxV = sp * 0.8;
    const maxVSq = maxV * maxV;
    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c <= maxC; c++) {
        const pt = pts[rowOffset + c];
        if (pt.pinned) continue;

        const dx = pt.ox - pt.x;
        const dy = pt.oy - pt.y;

        let vx = (pt.vx + dx * stiff) * damping;
        let vy = (pt.vy + dy * stiff) * damping;
        const vSq = vx * vx + vy * vy;
        if (!(vSq <= maxVSq)) {
          const k = Number.isFinite(vSq) ? maxV / Math.sqrt(vSq) : 0;
          vx *= k;
          vy *= k;
          if (!Number.isFinite(vx + vy)) vx = vy = 0;
        }
        pt.vx = vx;
        pt.vy = vy;

        pt.x += vx;
        pt.y += vy;

        const offX = pt.x - pt.ox;
        const offY = pt.y - pt.oy;
        if (offX * offX + offY * offY > maxDispSq) {
          const d = Math.hypot(offX, offY);
          pt.x = pt.ox + (offX / d) * maxDisp;
          pt.y = pt.oy + (offY / d) * maxDisp;
        }

        pt.energy *= 0.93;
      }
    }
  }

  // The ship's light for the next draw(): centred on (x, y), lighting every line within `radius` by
  // the same radial falloff. It is consumed by draw(), so it never lags behind the ship.
  setLight(x, y, radius = 230, intensity = 1, hue = 188) {
    const l = this.light;
    l.intensity = intensity * (TUNING.gridShipLight ?? 1.0);
    l.on = l.intensity > 0 && radius > 0 && Number.isFinite(x + y + radius + l.intensity);
    l.x = x;
    l.y = y;
    l.radius = radius;
    l.hue = hue;
  }

  // Ship light brightness at a world point (0 when off); drawLight() bands each line piece by it.
  lightAt(x, y) {
    const l = this.light;
    if (!l.on) return 0;
    return l.intensity * lightFalloff(Math.hypot(x - l.x, y - l.y) / l.radius);
  }

  glowStyle(key) {
    let style = this.glowStyles[key];
    if (!style) {
      const hue = Math.floor(key / GLOW_LEVELS) * (360 / HUE_BUCKETS);
      const level = key % GLOW_LEVELS;
      const alpha = Math.min(0.92, ((level + 1) / GLOW_LEVELS) * GLOW_MAX * 0.68);
      style = this.glowStyles[key] = `hsla(${hue}, 100%, ${60 + level * 2}%, ${alpha.toFixed(3)})`;
    }
    return style;
  }

  // Lit segments in view: each segment's brightness is the mean of its two endpoints' energy, so a
  // glow spreads evenly along both axes around its source. Segments are stored as idx * 2 + axis
  // (0 = to the right, 1 = downward) with a (hue, level) key, then counting-sorted into buckets.
  collectGlow(minC, maxC, minR, maxR) {
    const pts = this.points;
    const cols = this.cols;
    const cap = (maxC - minC + 1) * (maxR - minR + 1) * 2;
    if (this.segs.length < cap) {
      this.segs = new Int32Array(cap);
      this.segKeys = new Uint16Array(cap);
      this.segOrder = new Int32Array(cap);
    }
    const segs = this.segs;
    const keys = this.segKeys;
    const counts = this.glowCounts;
    counts.fill(0);
    const scale = GLOW_LEVELS / GLOW_MAX;
    let n = 0;
    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c <= maxC; c++) {
        const idx = rowOffset + c;
        const pt = pts[idx];
        for (let axis = 0; axis < 2; axis++) {
          if (axis === 0 ? c === maxC : r === maxR) continue;
          const other = pts[axis === 0 ? idx + 1 : idx + cols];
          const e = (pt.energy + other.energy) * 0.5;
          if (e < GLOW_MIN) continue;
          const hue = pt.energy >= other.energy ? pt.hue : other.hue;
          const hb = Math.round((((hue % 360) + 360) % 360) / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
          const key = hb * GLOW_LEVELS + Math.min(GLOW_LEVELS - 1, Math.floor(e * scale));
          segs[n] = idx * 2 + axis;
          keys[n] = key;
          counts[key + 1]++;
          n++;
        }
      }
    }
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const order = this.segOrder;
    for (let i = 0; i < n; i++) order[counts[keys[i]]++] = segs[i];
    // counts[k] now holds the end of bucket k (its start is counts[k - 1], or 0).
    return n;
  }

  lightStyle(level) {
    const l = this.light;
    const key = l.hue * LIGHT_LEVELS + level;
    let style = this.lightStyles.get(key);
    if (!style) {
      const a = ((level + 0.5) / LIGHT_LEVELS) * 0.9;
      style = `hsla(${l.hue}, 100%, ${58 + level * 1.5}%, ${a.toFixed(3)})`;
      this.lightStyles.set(key, style);
    }
    return style;
  }

  // The ship's light, consumed here: pieces of every line within its radius, banded by the light at
  // each piece's midpoint. Brightness depends only on distance from the ship, so it is even on both
  // axes and in every direction, and it is centred on wherever the ship is this frame.
  drawLight(ctx, minC, maxC, minR, maxR) {
    const l = this.light;
    l.on = false;
    const pts = this.points;
    const cols = this.cols;
    const sp = this.spacing;
    const reach = l.radius + sp * 2.6; // displaced points can sit up to gridMaxWarp cells from rest
    const c0 = Math.max(minC, Math.floor((l.x - reach) / sp));
    const c1 = Math.min(maxC, Math.ceil((l.x + reach) / sp));
    const r0 = Math.max(minR, Math.floor((l.y - reach) / sp));
    const r1 = Math.min(maxR, Math.ceil((l.y + reach) / sp));
    if (c0 >= c1 || r0 >= r1) return;
    const cap = (c1 - c0 + 1) * (r1 - r0 + 1) * 2 * LIGHT_PIECES;
    if (this.lightBuf.length < cap * 4) {
      this.lightBuf = new Float32Array(cap * 4);
      this.lightLevel = new Uint8Array(cap);
    }
    const buf = this.lightBuf;
    const lv = this.lightLevel;
    const counts = this.lightCounts.fill(0);
    const rSq = l.radius * l.radius;
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const a = pts[r * cols + c];
        for (let axis = 0; axis < 2; axis++) {
          if (axis === 0 ? c === c1 : r === r1) continue;
          const b = pts[axis === 0 ? r * cols + c + 1 : (r + 1) * cols + c];
          const dx = (b.x - a.x) / LIGHT_PIECES;
          const dy = (b.y - a.y) / LIGHT_PIECES;
          for (let k = 0; k < LIGHT_PIECES; k++) {
            const x1 = a.x + dx * k;
            const y1 = a.y + dy * k;
            const mx = x1 + dx * 0.5 - l.x;
            const my = y1 + dy * 0.5 - l.y;
            const dSq = mx * mx + my * my;
            if (dSq >= rSq) continue;
            const v = Math.min(1, l.intensity * lightFalloff(Math.sqrt(dSq) / l.radius));
            const level = Math.min(LIGHT_LEVELS - 1, Math.floor(v * LIGHT_LEVELS));
            if (v < 0.04) continue;
            buf[n * 4] = x1;
            buf[n * 4 + 1] = y1;
            buf[n * 4 + 2] = x1 + dx;
            buf[n * 4 + 3] = y1 + dy;
            lv[n] = level;
            counts[level]++;
            n++;
          }
        }
      }
    }
    for (let level = 0; level < LIGHT_LEVELS; level++) {
      if (counts[level] === 0) continue;
      ctx.strokeStyle = this.lightStyle(level);
      ctx.lineWidth = level >= LIGHT_LEVELS - 3 ? 1.6 : 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (lv[i] !== level) continue;
        ctx.moveTo(buf[i * 4], buf[i * 4 + 1]);
        ctx.lineTo(buf[i * 4 + 2], buf[i * 4 + 3]);
      }
      ctx.stroke();
    }
  }

  draw(ctx, camX = 0, camY = 0, viewW = 1920, viewH = 1080) {
    const cols = this.cols;
    const rows = this.rows;
    const pts = this.points;
    const sp = this.spacing;

    const minC = Math.max(0, Math.floor(camX / sp) - 2);
    const maxC = Math.min(cols - 1, Math.ceil((camX + viewW) / sp) + 2);
    const minR = Math.max(0, Math.floor(camY / sp) - 2);
    const maxR = Math.min(rows - 1, Math.ceil((camY + viewH) / sp) + 2);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 175, 255, 0.14)';
    ctx.beginPath();

    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      ctx.moveTo(pts[rowOffset + minC].x, pts[rowOffset + minC].y);
      for (let c = minC + 1; c <= maxC; c++) {
        const pt = pts[rowOffset + c];
        ctx.lineTo(pt.x, pt.y);
      }
    }

    for (let c = minC; c <= maxC; c++) {
      ctx.moveTo(pts[minR * cols + c].x, pts[minR * cols + c].y);
      for (let r = minR + 1; r <= maxR; r++) {
        const pt = pts[r * cols + c];
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';

    // Energized lines, grouped by (hue, brightness) bucket so each style is set once. A bucket is
    // stroked in short runs of neighbouring segments: one huge self-overlapping path is much slower
    // to rasterize than a few small ones. Dim buckets stay hairlines; the hottest draw thicker.
    if (this.collectGlow(minC, maxC, minR, maxR) > 0) {
      const counts = this.glowCounts;
      const order = this.segOrder;
      let start = 0;
      for (let key = 0; key < HUE_BUCKETS * GLOW_LEVELS; key++) {
        const end = counts[key];
        if (end === start) continue;
        const level = key % GLOW_LEVELS;
        ctx.lineWidth = level < 2 ? 1 : level < 6 ? 1.6 : 2;
        ctx.strokeStyle = this.glowStyle(key);
        for (let i = start; i < end; i++) {
          if ((i - start) % GLOW_RUN === 0) {
            if (i > start) ctx.stroke();
            ctx.beginPath();
          }
          const code = order[i];
          const idx = code >> 1;
          const a = pts[idx];
          const b = pts[(code & 1) === 0 ? idx + 1 : idx + cols];
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        start = end;
      }
    }

    if (this.light.on) this.drawLight(ctx, minC, maxC, minR, maxR);

    ctx.restore();
  }
}
