// HATCHERY: a slow, armored hive that creeps to the edge of the fight and breeds HATCHLINGS until you
// kill it. Priority-target play: go and get it, or drown in its brood.
//   BROOD    — every `hatchEvery` s (while the ship is within `wakeRange`) it incubates for `incubate` s:
//              the pods on its rim swell and a ring closes in, then `hatch` hatchlings burst out.
//   CAPS     — at most `maxBrood` of its hatchlings alive at once and `broodTotal` over its life (the
//              pods on its rim show how many are left); it never hatches into the last `headroom` slots
//              of the enemy budget, and every hatchling counts toward that budget like any other hull.
//   ORPHANS  — kill the hatchery and its whole brood withers with it, popping in a quick cascade.
// HATCHLINGS circle the ship, brake and flare (`cue`), then dive straight through where you are; one
// that connects pops on impact. Timers are seconds; speeds are px per fixed 60 Hz tick.
import { turnToward } from './serpents.js';

export const HATCHERY = {
  hold: 380, band: 90, wakeRange: 950,
  hatchEvery: 4.5, incubate: 1.4, hatch: 2, maxBrood: 6, broodTotal: 24, pods: 6, headroom: 24,
  knockMult: 0.15
};
export const HATCHLING = {
  orbit: 125, orbitJitter: 35, spin: 1.7, circleMin: 1.3, circleMax: 2.6, cue: 0.4, dive: 0.45, diveSpeed: 7,
  launchKick: 3.2, witherMin: 0.08, witherMax: 0.5
};

// Hatchlings of this hatchery still alive or on their way in.
export function broodOf(e, m) {
  let n = 0;
  for (const o of m.enemies) if (o.parent === e && !o.dead) n++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.parent === e) n++;
  return n;
}

const roomFor = (m) => m.maxEnemies - HATCHERY.headroom - (m.enemies.length + m.spawnIndicators.length);
const podAngle = (e, k) => e.rotation + (k * Math.PI * 2) / HATCHERY.pods;
export const broodLeft = (e) => Math.max(0, HATCHERY.broodTotal - (e.born || 0));

export function updateHatchery(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  // Creeps in to `hold` and sits there, backing off slowly if you crowd it.
  const radial = dist > HATCHERY.hold + HATCHERY.band ? 1 : dist < HATCHERY.hold - HATCHERY.band ? -0.5 : 0;
  const ax = radial > 0 ? env.moveX : dirX;
  const ay = radial > 0 ? env.moveY : dirY;
  e.vx = (e.vx + ax * radial * e.speed * 0.1 + env.sepX) * 0.9;
  e.vy = (e.vy + ay * radial * e.speed * 0.1 + env.sepY) * 0.9;
  e.podCursor ||= 0;
  if (e.incubT > 0) {
    e.incubT -= dt;
    if (e.incubT <= 0) hatch(e, m, env);
    return;
  }
  if (broodLeft(e) <= 0) return; // spent: just a slow, armored husk now
  e.broodT = Math.max(0, (e.broodT ?? HATCHERY.hatchEvery * 0.4) - dt * (e.cadence || 1));
  if (e.broodT > 0 || dist > HATCHERY.wakeRange) return;
  if (broodOf(e, m) >= HATCHERY.maxBrood || roomFor(m) <= 0) return; // waits with a full nest
  e.incubT = HATCHERY.incubate;
  e.broodT = HATCHERY.hatchEvery;
}

// The pods burst: up to `hatch` hatchlings, within every cap.
function hatch(e, m, env) {
  e.incubT = 0;
  const n = Math.min(HATCHERY.hatch, broodLeft(e), HATCHERY.maxBrood - broodOf(e, m), roomFor(m));
  const scale = m.waveScaleFor('hatchling', m.wave);
  const toShip = Math.atan2(env.dirY, env.dirX);
  for (let k = 0; k < n; k++) {
    const a = podAngle(e, e.podCursor % HATCHERY.pods);
    const x = e.x + Math.cos(a) * e.radius * 1.1;
    const y = e.y + Math.sin(a) * e.radius * 1.1;
    const ok = m.queueSpawn('hatchling', x, y, scale, {
      instant: true, vx: Math.cos(a) * HATCHLING.launchKick, vy: Math.sin(a) * HATCHLING.launchKick,
      attach: {
        parent: e, state: 'orbit', aimAngle: a, rotation: a,
        aiTimer: HATCHLING.circleMin + Math.random() * (HATCHLING.circleMax - HATCHLING.circleMin),
        hatchA: toShip + Math.PI + (Math.random() - 0.5), hatchDir: (e.podCursor % 2) ? 1 : -1,
        hatchR: HATCHLING.orbit + (Math.random() - 0.5) * 2 * HATCHLING.orbitJitter
      }
    });
    if (!ok) break;
    e.podCursor++;
    e.born = (e.born || 0) + 1;
    env.particles?.spawnShockwave?.(x, y, 26, e.hue, 2, 0.22);
  }
  if (n > 0) env.grid?.applyImpulse(e.x, e.y, 16, 90, e.hue);
}

export function updateHatchling(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  // Orphaned: its hatchery is dead, so it withers a moment later (the brood pops in a cascade).
  if (e.parent?.dead) {
    e.witherT ??= HATCHLING.witherMin + Math.random() * (HATCHLING.witherMax - HATCHLING.witherMin);
    e.witherT -= dt;
    if (e.witherT <= 0 && !e.doomQueued) {
      e.doomQueued = true;
      m.doomed.push(e);
    }
  }
  const toShip = Math.atan2(dirY, dirX);
  e.aiTimer -= dt;
  if (e.state === 'cue') {
    // Brakes and flares, nose on the ship: the dive is coming.
    e.vx *= 0.82;
    e.vy *= 0.82;
    e.aimAngle = turnToward(e.aimAngle, toShip, 10 * dt);
    e.rotation = e.aimAngle;
    if (e.aiTimer <= 0) {
      e.state = 'dive';
      e.aiTimer = HATCHLING.dive;
      e.burstSpeed = HATCHLING.diveSpeed * (e.speedScale || 1);
      e.vx = Math.cos(e.aimAngle) * e.burstSpeed;
      e.vy = Math.sin(e.aimAngle) * e.burstSpeed;
    }
    return;
  }
  if (e.state === 'dive') {
    // Straight through where you were: no steering, so a sidestep makes it miss.
    if (e.aiTimer <= 0) {
      e.state = 'orbit';
      e.burstSpeed = 0;
      e.aiTimer = HATCHLING.circleMin + Math.random() * (HATCHLING.circleMax - HATCHLING.circleMin);
      e.hatchA = toShip + Math.PI; // pick the circle up again from the far side
    }
    e.rotation = Math.atan2(e.vy, e.vx);
    return;
  }
  // Orbit: circle the ship at hatchR; far off, home in first.
  e.hatchA = (e.hatchA ?? toShip + Math.PI) + (e.hatchDir || 1) * HATCHLING.spin * dt;
  const r = e.hatchR || HATCHLING.orbit;
  const px = e.x + dirX * dist;
  const py = e.y + dirY * dist;
  let tx = px + Math.cos(e.hatchA) * r - e.x;
  let ty = py + Math.sin(e.hatchA) * r - e.y;
  if (dist > r * 2.5) {
    tx = env.moveX;
    ty = env.moveY;
  }
  const len = Math.hypot(tx, ty) || 1;
  e.vx += ((tx / len) * e.speed - e.vx) * 0.14;
  e.vy += ((ty / len) * e.speed - e.vy) * 0.14;
  e.rotation = Math.atan2(e.vy, e.vx);
  e.aimAngle = e.rotation;
  if (e.aiTimer <= 0 && dist < r * 1.8) {
    e.state = 'cue';
    e.aiTimer = HATCHLING.cue;
  }
}

// A honeycomb hive: a hexagon round a counter-turning inner cell, ribbed to its rim, with egg pods on
// its corners. Only pods with a hatchling left in them show; the ones about to hatch swell.
export function traceHatchery(ctx, e, r) {
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3;
    if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const spin = -(e.rotation || 0) * 3;
  for (let s = 0; s < 6; s++) {
    const a = spin + (s * Math.PI) / 3;
    if (s === 0) ctx.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
    else ctx.lineTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
  }
  ctx.closePath();
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3 + Math.PI / 6;
    ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
    ctx.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
  }
  const shown = Math.min(HATCHERY.pods, broodLeft(e));
  const t = e.incubT > 0 ? 1 - e.incubT / HATCHERY.incubate : 0;
  const due = e.incubT > 0 ? Math.min(HATCHERY.hatch, shown) : 0;
  const cursor = e.podCursor || 0;
  for (let k = 0; k < shown; k++) {
    const slot = (cursor + k) % HATCHERY.pods;
    const a = (slot * Math.PI * 2) / HATCHERY.pods;
    const swell = k < due ? 1 + t * 0.7 + Math.sin(t * 30) * 0.08 * t : 1;
    const pr = r * 0.2 * swell;
    const cx = Math.cos(a) * r * 1.08;
    const cy = Math.sin(a) * r * 1.08;
    ctx.moveTo(cx + pr, cy);
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  }
}

// A larva dart: a diamond body with two forward mandibles.
export function traceHatchling(ctx, e, r) {
  ctx.moveTo(r * 0.9, 0);
  ctx.lineTo(0, r * 0.65);
  ctx.lineTo(-r * 1.2, 0);
  ctx.lineTo(0, -r * 0.65);
  ctx.closePath();
  ctx.moveTo(r * 0.35, r * 0.45);
  ctx.lineTo(r * 1.45, r * 0.7);
  ctx.moveTo(r * 0.35, -r * 0.45);
  ctx.lineTo(r * 1.45, -r * 0.7);
}

// Incubation: a ring that closes in on the hive and brightens until the pods burst.
export function drawIncubation(ctx, e, r) {
  if (!(e.incubT > 0)) return;
  const t = 1 - e.incubT / HATCHERY.incubate;
  ctx.strokeStyle = `hsla(${e.hue}, 100%, ${65 + t * 20}%, ${0.25 + t * 0.6})`;
  ctx.lineWidth = 1.5 + t * 2.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * (2.6 - t * 1.3), 0, Math.PI * 2);
  ctx.stroke();
}

// The dive cue: a short flaring tick from the hatchling toward the ship.
export function drawDiveCue(ctx, e, r) {
  if (e.state !== 'cue') return;
  const t = 1 - Math.max(0, e.aiTimer) / HATCHLING.cue;
  const len = r * (3 + t * 5);
  ctx.strokeStyle = `hsla(${e.hue}, 100%, 80%, ${0.35 + t * 0.55})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(e.x + Math.cos(e.aimAngle) * r * 1.6, e.y + Math.sin(e.aimAngle) * r * 1.6);
  ctx.lineTo(e.x + Math.cos(e.aimAngle) * (r * 1.6 + len), e.y + Math.sin(e.aimAngle) * (r * 1.6 + len));
  ctx.stroke();
  ctx.setLineDash([]);
}
