// Shared Gravity-Well Physics: one falloff curve for black holes, singularities, grid, bullets & pickups
// All forces are per fixed 60 Hz tick (px/tick²), like the rest of the simulation.

import { TUNING } from './config.js';

// Ship thrust per tick is moveSpeed * 0.22 (see Game.update). The tug on the ship is a share of that
// thrust (TUNING blackholePlayerPull*), and no setting or stack of wells may exceed this hard ceiling,
// so holding away always nets at least 20% of move speed (1.0 px/tick at base, still faster than a
// drifting vortex's 0.95).
export const MAX_PLAYER_PULL_SHARE = 0.8;
export const SHIP_THRUST_PER_TICK = 0.22;

// External gravity velocity on enemies decays by this each tick, so a steady pull `a` settles at
// a / (1 - drag) px/tick of drift on top of the enemy's own (speed-capped) steering.
export const GRAVITY_DRIFT_DRAG = 0.88;

// Quadratic ease: 1 at the core, 0.625 at half radius, 0.34 at three-quarters, 0 at the rim.
export function wellFalloff(dist, radius) {
  if (!(dist < radius) || radius <= 0) return 0;
  const t = 1 - Math.max(0, dist) / radius;
  return t * (1.5 - 0.5 * t);
}

// Scale k such that (dx * k, dy * k) is the inward acceleration toward a well offset by (dx, dy).
// Inside `minDist` the pull eases linearly to zero (a soft spring) so bodies resting on the core don't jitter.
export function wellPullScale(dx, dy, radius, strength, minDist = 6) {
  const dSq = dx * dx + dy * dy;
  if (!(dSq < radius * radius)) return 0;
  const core = Math.max(1, Math.min(minDist, radius * 0.5));
  const d = Math.sqrt(dSq);
  if (d < core) return (strength * wellFalloff(core, radius)) / core;
  return (strength * wellFalloff(d, radius)) / d;
}

const clampShare = (v, fallback) => Math.max(0, Math.min(MAX_PLAYER_PULL_SHARE, Number.isFinite(v) ? v : fallback));

// Share of the ship's thrust one vortex pulls with at `dist` from its centre: the edge share at the rim,
// rising linearly to the inner share at innerAt × radius from the core, then holding that share.
// Inside the vortex's own hull (`coreRadius`) it eases to zero so a ship resting on the centre is still.
export function playerPullShare(dist, radius, coreRadius = 0, tuning = TUNING) {
  if (!(dist < radius) || radius <= 0) return 0;
  const edge = clampShare(tuning.blackholePlayerPullEdge, 0.5);
  const inner = clampShare(tuning.blackholePlayerPullInner, 0.75);
  const innerAt = Math.max(0, Math.min(1, tuning.blackholePlayerPullInnerAt ?? 0.5));
  const innerR = radius * innerAt;
  let share = inner;
  if (dist > innerR) share = edge + (inner - edge) * ((radius - dist) / (radius - innerR));
  const core = Math.max(0, Math.min(coreRadius, innerR));
  if (dist < core) share *= dist / core;
  return share;
}

// Largest share of thrust the summed pull of every vortex may reach (always below 100%).
export function playerPullCapShare(tuning = TUNING) {
  return Math.max(clampShare(tuning.blackholePlayerPullEdge, 0.5), clampShare(tuning.blackholePlayerPullInner, 0.75));
}

// Largest pull the ship can feel at a given move speed, in px/tick².
export function playerPullCap(moveSpeed, tuning = TUNING) {
  return Math.max(0, moveSpeed) * SHIP_THRUST_PER_TICK * playerPullCapShare(tuning);
}
