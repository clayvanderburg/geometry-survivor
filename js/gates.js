// Gates (Geometry Wars laser gates): two pylons joined by a crackling beam around a small hub.
//   - Shoot the hub and the gate breaks like any hull.
//   - FLY THROUGH THE BEAM and it detonates: a big blast that wrecks every hostile nearby (bosses too),
//     at no cost to you. The best gate is the one you lure a crowd next to.
//   - The pylons are solid: touching one hurts like a hull.
// A gate drifts slowly toward the ship, spinning. The Architect (js/bosses.js) also builds them, and
// drops cages of them that close in round the ship (`cage`).
// Timers are seconds; speeds are px per fixed 60 Hz tick.

export const GATE = {
  armLen: 72, pylonRadius: 9, drift: 0.05, spin: 0.7, blastRadius: 220, blastDamage: 90,
  cageSpeed: 34, cageMin: 95
};

// Pylon end points of a gate.
export function gatePylons(e) {
  const L = e.armLen || GATE.armLen;
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  return [{ x: e.x + c * L, y: e.y + s * L }, { x: e.x - c * L, y: e.y - s * L }];
}

// Distance from (px, py) to the beam between the pylons, and how far along it the closest point is (0..1).
export function beamDistance(e, px, py) {
  const [a, b] = gatePylons(e);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
  return { d: Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)), t };
}

// Per-tick AI: drift and spin, or ride a closing cage ring round its centre.
export function updateGate(e, m, env) {
  const { dt } = env;
  if (e.cage) {
    const c = e.cage;
    c.r = Math.max(GATE.cageMin, c.r - GATE.cageSpeed * dt);
    c.t -= dt;
    e.x = c.cx + Math.cos(c.a) * c.r;
    e.y = c.cy + Math.sin(c.a) * c.r;
    e.vx = 0;
    e.vy = 0;
    e.rotation = c.a + Math.PI / 2; // tangent to the ring: the beams wall it in
    if (c.t <= 0) e.cage = null; // the cage holds a while, then its gates drift free
    return;
  }
  e.vx = (e.vx + env.moveX * GATE.drift) * 0.95;
  e.vy = (e.vy + env.moveY * GATE.drift) * 0.95;
  e.rotation += GATE.spin * (e.strafeSign || 1) * dt;
}

// Body in local (rotated) coordinates: the hub ring, the two pylons, and the beam between them.
export function traceGate(ctx, e, r) {
  const L = e.armLen || GATE.armLen;
  const p = GATE.pylonRadius;
  ctx.moveTo(r * 0.7, 0);
  ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  for (const x of [L, -L]) {
    ctx.moveTo(x + p, 0);
    ctx.lineTo(x, p);
    ctx.lineTo(x - p, 0);
    ctx.lineTo(x, -p);
    ctx.closePath();
  }
  ctx.moveTo(-L + p, 0);
  ctx.lineTo(-r * 0.7, 0);
  ctx.moveTo(r * 0.7, 0);
  ctx.lineTo(L - p, 0);
}

// The crackle: a white jagged line along the beam over the stroke, so it reads as live current.
export function drawGateBeam(ctx, e) {
  const [a, b] = gatePylons(e);
  const steps = 8;
  ctx.strokeStyle = `rgba(255, 255, 220, ${0.45 + Math.sin(e.pulsePhase * 3) * 0.2})`;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const nl = Math.hypot(nx, ny) || 1;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const j = (Math.sin(e.pulsePhase * 7 + k * 2.3) * 4) / nl;
    ctx.lineTo(a.x + (b.x - a.x) * t + nx * j, a.y + (b.y - a.y) * t + ny * j);
  }
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
