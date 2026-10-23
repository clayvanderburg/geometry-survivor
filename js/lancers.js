// Lancer beams: a hull plants itself, telegraphs a line at the ship, then fires a beam along that line
// and sweeps it to one marked side. Shared by the LANCER hostile and the enraged Eclipse Twin (js/bosses.js).
// A hull with a live beam (or a twin tether) carries e.beam = { x1, y1, x2, y2, width }; Game checks
// the ship against every e.beam each tick (Game.beamContact) and the beam is drawn by drawBeam.
// Timers are seconds; speeds are px per fixed 60 Hz tick.
import { isReduceEffects } from './juice.js';

// aimTime 1.35 s (was 0.9, +50%): the line tracks the ship for 0.85 s, then LOCKS for the last lockAt
// 0.5 s (was 0.3) and never moves again; the last flashAt 0.25 s it flashes white (about to fire).
// The beam fires along the locked line and sweeps `sweep` rad to the side marked from the start of the
// aim (lanceDir, was a coin flip at fire time across BOTH sides), so stepping off the line to the
// unmarked side always dodges it.
// Stagger: at most maxActive lancers aim or fire at once across the field, and a new one starts aiming
// at least stagger s after the last one did (EnemyManager keeps env.lanceGate).
export const LANCE = {
  range: 330, band: 70, aimTime: 1.35, lockAt: 0.5, flashAt: 0.25, fireTime: 0.85, sweep: 0.7, length: 560, width: 7,
  cooldown: 2.6, damageMult: 1.4, maxActive: 2, stagger: 0.35
};

const isLancing = (e) => e.lanceState === 'aim' || e.lanceState === 'fire';

// Per-tick shared lance budget for EnemyManager: how many hulls are aiming or firing right now, and the
// stagger countdown before the next may start.
export function updateLanceGate(gate, enemies, dt) {
  gate.wait = Math.max(0, (gate.wait || 0) - dt);
  let active = 0;
  for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead && isLancing(enemies[i])) active++;
  gate.active = active;
  return gate;
}

// One lance cycle on a hull that is already in place. States: 'idle' → 'aim' → 'fire' → 'idle'.
// Returns true while the hull should hold still (aiming or firing).
export function lanceCycle(e, env, { cooldown = LANCE.cooldown, length = LANCE.length } = {}) {
  const { dt, player } = env;
  e.lanceT = (e.lanceT ?? cooldown * (0.5 + Math.random() * 0.5)) - dt;
  if (e.lanceState === 'aim') {
    // Tracks the ship, then locks for the last lockAt seconds (that is your cue to move).
    if (e.lanceT > LANCE.lockAt) {
      e.lanceAngle = Math.atan2(player.y - e.y, player.x - e.x);
      e.lanceShipD = Math.hypot(player.x - e.x, player.y - e.y); // the wedge is drawn out to just past the ship
    }
    if (e.lanceT <= 0) {
      e.lanceState = 'fire';
      e.lanceT = LANCE.fireTime;
    }
    e.beam = null;
    return true;
  }
  if (e.lanceState === 'fire') {
    const k = 1 - Math.max(0, e.lanceT) / LANCE.fireTime;
    e.beam = beamFrom(e, e.lanceAngle + e.lanceDir * LANCE.sweep * k, length);
    if (e.lanceT <= 0) {
      e.lanceState = 'idle';
      e.lanceT = cooldown * (0.85 + Math.random() * 0.3);
      e.beam = null;
    }
    return true;
  }
  e.beam = null;
  if (e.lanceT <= 0 && env.dist < length * 0.9) {
    const gate = env.lanceGate;
    if (gate && (gate.wait > 0 || gate.active >= LANCE.maxActive)) {
      e.lanceT = 0.1 + Math.random() * 0.2; // the field is busy: wait for a slot
      return false;
    }
    if (gate) {
      gate.wait = LANCE.stagger;
      gate.active++;
    }
    e.lanceState = 'aim';
    e.lanceT = LANCE.aimTime;
    e.lanceAngle = Math.atan2(player.y - e.y, player.x - e.x);
    e.lanceShipD = env.dist;
    e.lanceDir = Math.random() < 0.5 ? -1 : 1;
    env.sound?.playLanceCharge?.(LANCE.aimTime, LANCE.lockAt, LANCE.flashAt);
  }
  return false;
}

export function beamFrom(e, angle, length = LANCE.length, width = LANCE.width) {
  const x1 = e.x + Math.cos(angle) * e.radius;
  const y1 = e.y + Math.sin(angle) * e.radius;
  return { x1, y1, x2: x1 + Math.cos(angle) * length, y2: y1 + Math.sin(angle) * length, width };
}

// Distance from (px, py) to a beam segment.
export function beamGap(b, px, py) {
  const vx = b.x2 - b.x1;
  const vy = b.y2 - b.y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - b.x1) * vx + (py - b.y1) * vy) / len2));
  return Math.hypot(px - (b.x1 + vx * t), py - (b.y1 + vy * t));
}

// The aim telegraph, drawn above hulls and particles (EnemyManager.drawTopTelegraphs) so the busy late
// field never hides it. Every element sits on a dark under-stroke so it reads on the bright grid:
//   tracking  — marching dashes from the hull through the ship, thickening and brightening;
//   locked    — the line goes solid red and stops moving, the marked sweep side fills in as a wedge with
//               an arrow, and a charge orb swells at the muzzle;
//   last 0.25 s — the line flashes white-hot (a steady white with REDUCE EFFECTS: no strobing).
export function drawLanceAim(ctx, e) {
  if (e.lanceState !== 'aim') return;
  const t = Math.min(1, Math.max(0, 1 - e.lanceT / LANCE.aimTime));
  const locked = e.lanceT <= LANCE.lockAt;
  const firing = e.lanceT <= LANCE.flashAt;
  const calm = isReduceEffects();
  const strobe = calm ? 1 : 0.5 + 0.5 * Math.cos(e.lanceT * Math.PI * 28);
  const b = beamFrom(e, e.lanceAngle);
  const a = e.lanceAngle;
  const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
  const ux = (b.x2 - b.x1) / L;
  const uy = (b.y2 - b.y1) / L;
  const dir = e.lanceDir || 1;

  // 1. The sweep wedge: the side the beam will swing to, out to just past the ship (where it matters),
  // faint while tracking and firmer once locked, with a rim arc and an arrow at the ship's distance.
  const R = Math.min(L, Math.max(140, (e.lanceShipD || L) + 90));
  const wedge = locked ? 0.1 + (firing ? 0.06 * strobe : 0) : 0.03 + 0.04 * t;
  ctx.fillStyle = `hsla(0, 100%, 55%, ${wedge})`;
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.arc(b.x1, b.y1, R, a, a + dir * LANCE.sweep, dir < 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `hsla(0, 100%, 65%, ${locked ? 0.55 : 0.2 + 0.2 * t})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(b.x1, b.y1, R, a, a + dir * LANCE.sweep, dir < 0);
  ctx.stroke();
  // Arrow on the ship's arc pointing the way the beam swings.
  const ad = Math.min(R - 20, (e.lanceShipD || R) + 30);
  const ra = a + dir * Math.min(LANCE.sweep * 0.5, 60 / Math.max(60, ad));
  const rx = b.x1 + Math.cos(ra) * ad;
  const ry = b.y1 + Math.sin(ra) * ad;
  const tx = -Math.sin(ra) * dir;
  const ty = Math.cos(ra) * dir;
  const nx = Math.cos(ra);
  const ny = Math.sin(ra);
  const arrow = (w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(rx - tx * 14 + nx * 9, ry - ty * 14 + ny * 9);
    ctx.lineTo(rx + tx * 6, ry + ty * 6);
    ctx.lineTo(rx - tx * 14 - nx * 9, ry - ty * 14 - ny * 9);
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(4, 2, 8, 0.7)';
  arrow(6);
  ctx.strokeStyle = `hsla(0, 100%, 72%, ${locked ? 0.95 : 0.35 + 0.4 * t})`;
  arrow(2.4);

  // 2. Dark under-stroke so the line reads over the grid, sparks and other hulls.
  const w = 1.6 + 2.4 * t + (firing ? 1.6 : 0);
  ctx.strokeStyle = 'rgba(4, 2, 8, 0.75)';
  ctx.lineWidth = w + 4;
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();

  // 3. The line itself.
  if (firing) {
    ctx.strokeStyle = `hsla(0, 100%, 60%, ${0.55 + 0.3 * strobe})`;
    ctx.lineWidth = w + 5;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 + 0.25 * strobe})`;
  } else {
    if (locked) {
      // Red glow under a pale-hot core: reads against the red wedge and the magenta swarm alike.
      ctx.strokeStyle = 'hsla(0, 100%, 58%, 0.8)';
      ctx.lineWidth = w + 3;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    ctx.strokeStyle = locked ? 'hsl(0, 100%, 86%)' : `hsla(${e.hue}, 100%, 72%, ${0.55 + 0.4 * t})`;
  }
  ctx.lineWidth = w;
  ctx.beginPath();
  if (locked) {
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
  } else {
    // Dashes marching out from the hull toward the ship.
    const dash = 16;
    const phase = ((LANCE.aimTime - e.lanceT) * 120) % (dash * 2);
    for (let d = phase - dash * 2; d < L; d += dash * 2) {
      const d0 = Math.max(0, d);
      const d1 = Math.min(L, d + dash);
      if (d1 <= d0) continue;
      ctx.moveTo(b.x1 + ux * d0, b.y1 + uy * d0);
      ctx.lineTo(b.x1 + ux * d1, b.y1 + uy * d1);
    }
  }
  // End tick: where the beam stops.
  ctx.moveTo(b.x2 - uy * 9, b.y2 + ux * 9);
  ctx.lineTo(b.x2 + uy * 9, b.y2 - ux * 9);
  ctx.stroke();

  // 4. Charge orb at the muzzle, swelling through the wind-up.
  ctx.fillStyle = firing ? `rgba(255, 255, 255, ${0.7 + 0.3 * strobe})` : `hsla(0, 100%, ${60 + 25 * t}%, ${0.45 + 0.5 * t})`;
  ctx.beginPath();
  ctx.arc(b.x1, b.y1, 2.5 + 5.5 * t, 0, Math.PI * 2);
  ctx.fill();
}

// A live beam: a wide glow and a white-hot core.
export function drawBeam(ctx, b, hue) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${hue}, 100%, 60%, 0.45)` : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = pass === 0 ? b.width * 2.6 : b.width * 0.7;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }
}

// Lancer silhouette: a long spear-like hull with a lens at the tip.
export function traceLancer(ctx, r) {
  ctx.moveTo(r * 1.6, 0);
  ctx.lineTo(r * 0.2, r * 0.55);
  ctx.lineTo(-r * 1.1, r * 0.35);
  ctx.lineTo(-r * 1.1, -r * 0.35);
  ctx.lineTo(r * 0.2, -r * 0.55);
  ctx.closePath();
  ctx.moveTo(r * 1.1, 0);
  ctx.arc(r * 0.9, 0, r * 0.2, 0, Math.PI * 2);
}
