// Shared Gravity-Well Physics: one falloff curve for black holes, singularities, grid, bullets & pickups
// All forces are per fixed 60 Hz tick (px/tick²), like the rest of the simulation.

// Ship thrust per tick is moveSpeed * 0.22 (see Game.update). Wells may never out-pull this share of it,
// so holding away from any stack of black holes still nets >= 55% of move speed.
export const PLAYER_ESCAPE_THRUST_SHARE = 0.45;
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

// Largest pull the ship can feel at a given move speed (see PLAYER_ESCAPE_THRUST_SHARE).
export function playerPullCap(moveSpeed) {
  return Math.max(0, moveSpeed) * SHIP_THRUST_PER_TICK * PLAYER_ESCAPE_THRUST_SHARE;
}
