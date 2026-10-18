// Spawn placement: where a new hostile appears. Pure helpers over a game-like object
// ({ player, camX, camY, width, height, zoom?, worldWidth, worldHeight, asteroidManager }), so tests
// and tools can drive them without a canvas. Knobs live in TUNING (Spawn Placement & Pursuit group).
//
// Default: a ring just outside the visible view, `spawnRingMarginMin`–`spawnRingMarginMax` px past the
// screen edge in world space. The ring is built around the view swept along the ship's motion for the
// spawn warm-up, so a point ahead of a running ship is still off screen when the enemy materializes.
// `spawnAheadBias` of spawns aim at the side the ship is heading (so it meets enemies instead of being
// chased forever); the rest pick any side. Points outside the arena or inside rock are rejected, so a
// ship hugging a wall gets its spawns from the open sides. Only when no ring point is valid does a
// spawn fall back to a visible spot, at least `spawnMinDist` px from the ship, and the caller gives it
// the long on-screen telegraph (`spawnOnscreenTelegraph`).
import { TUNING } from './config.js';

export const SPAWN_ARENA_PAD = 90; // keep spawns this far inside the arena wall
export const SPAWN_ROCK_CLEARANCE = 28; // and this far from any rock surface
export const SPAWN_WARMUP = 0.55; // default materialization ring for off-screen spawns (seconds)
const AHEAD_SPREAD = 1.2; // ± radians around the heading for "ahead" spawns (~±70°)
const MIN_HEADING_SPEED = 0.8; // px/tick; slower than this the ship has no heading
const MAX_LEAD = 400; // px the swept view may run ahead of the camera
const ONSCREEN_INSET = 60; // visible fallback points stay this far inside the screen edge

// The camera rect in world space (accounts for an optional zoom factor > 0).
export function spawnView(game) {
  const zoom = game.zoom > 0 ? game.zoom : 1;
  const w = (game.width || 1280) / zoom;
  const h = (game.height || 720) / zoom;
  const p = game.player || { x: w / 2, y: h / 2 };
  return { x: Number.isFinite(game.camX) ? game.camX : p.x - w / 2, y: Number.isFinite(game.camY) ? game.camY : p.y - h / 2, w, h };
}

// True when a hull of radius r at (x, y) shows any part inside `view`.
export function inView(view, x, y, r = 0) {
  return x + r >= view.x && x - r <= view.x + view.w && y + r >= view.y && y - r <= view.y + view.h;
}

// Inside the arena (with room for `pad`) and clear of rock.
export function isOpenSpawn(game, x, y, pad = 0) {
  const edge = Math.max(SPAWN_ARENA_PAD, pad + 40);
  if (!(x >= edge && y >= edge && x <= game.worldWidth - edge && y <= game.worldHeight - edge)) return false;
  const am = game.asteroidManager;
  if (!am?.getNearbyAsteroids) return true;
  const rocks = am.getNearbyAsteroids(x, y, am.cellsFor ? am.cellsFor(SPAWN_ROCK_CLEARANCE) : 1);
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock.hp !== undefined && rock.hp <= 0) continue;
    const min = rock.radius + SPAWN_ROCK_CLEARANCE;
    const dx = x - rock.x;
    const dy = y - rock.y;
    if (dx * dx + dy * dy < min * min) return false;
  }
  return true;
}

// Point where a ray from the rect's centre at `angle` crosses the rect grown by `margin` on every side.
export function ringPoint(rect, angle, margin) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = rect.w / 2 + margin;
  const hh = rect.h / 2 + margin;
  const k = Math.min(Math.abs(c) > 1e-9 ? hw / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? hh / Math.abs(s) : Infinity);
  return { x: rect.x + rect.w / 2 + c * k, y: rect.y + rect.h / 2 + s * k };
}

function ringMargins(tuning) {
  const min = Math.max(0, tuning.spawnRingMarginMin ?? 40);
  return { min, max: Math.max(min, tuning.spawnRingMarginMax ?? 160) };
}

// Off-screen ring spawn for a hull/pack of radius `pad` (its centre sits pad px further out, so the
// whole pack starts off screen). Returns { x, y, onScreen } — onScreen only for the visible fallback.
export function pickSpawnPoint(game, { pad = 0, warmup = SPAWN_WARMUP, rand = Math.random, tuning = TUNING } = {}) {
  const p = game.player;
  const view = spawnView(game);
  const minDist = (tuning.spawnMinDist ?? 260) + pad;
  const margins = ringMargins(tuning);

  // Sweep the view along the ship's current motion for the warm-up, so "just off screen" still holds
  // when the enemy materializes.
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  const lead = speed > 0 ? Math.min(MAX_LEAD, speed * warmup * 60) / speed : 0;
  const lx = (p.vx || 0) * lead;
  const ly = (p.vy || 0) * lead;
  const rect = {
    x: view.x + Math.min(0, lx),
    y: view.y + Math.min(0, ly),
    w: view.w + Math.abs(lx),
    h: view.h + Math.abs(ly)
  };
  const heading = speed > MIN_HEADING_SPEED ? Math.atan2(p.vy, p.vx) : null;
  const aheadBias = Math.max(0, Math.min(1, tuning.spawnAheadBias ?? 0.5));

  const tryAngle = (angle) => {
    const margin = margins.min + rand() * (margins.max - margins.min) + pad;
    const pt = ringPoint(rect, angle, margin);
    if (Math.hypot(pt.x - p.x, pt.y - p.y) < minDist) return null;
    if (inView(view, pt.x, pt.y, pad)) return null;
    return isOpenSpawn(game, pt.x, pt.y, pad) ? { x: pt.x, y: pt.y, onScreen: false } : null;
  };

  const first = heading !== null && rand() < aheadBias
    ? heading + (rand() * 2 - 1) * AHEAD_SPREAD
    : rand() * Math.PI * 2;
  let found = tryAngle(first);
  for (let attempt = 0; !found && attempt < 10; attempt++) found = tryAngle(rand() * Math.PI * 2);
  // Walls or rock on most sides: sweep the whole ring before giving up on off-screen.
  const offset = rand() * Math.PI * 2;
  for (let k = 0; !found && k < 32; k++) found = tryAngle(offset + (k / 32) * Math.PI * 2);
  return found || pickOnscreenSpawn(game, { pad, rand, tuning });
}

// Visible spawn (sandbox, or the rare case with no room off screen): inside the view, at least
// spawnMinDist (+ pad) from the ship, inside the arena and clear of rock. The caller adds the long telegraph.
export function pickOnscreenSpawn(game, { pad = 0, rand = Math.random, tuning = TUNING, minDist: min = null } = {}) {
  const p = game.player;
  const view = spawnView(game);
  const minDist = (min ?? tuning.spawnMinDist ?? 260) + pad;
  const inset = ONSCREEN_INSET + pad;
  const spanX = Math.max(0, view.w - inset * 2);
  const spanY = Math.max(0, view.h - inset * 2);
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = view.x + inset + rand() * spanX;
    const y = view.y + inset + rand() * spanY;
    if (Math.hypot(x - p.x, y - p.y) >= minDist && isOpenSpawn(game, x, y, pad)) return { x, y, onScreen: true };
  }
  // Tiny view or a crowded field: a circle at exactly the minimum distance.
  const offset = rand() * Math.PI * 2;
  for (let k = 0; k < 16; k++) {
    const a = offset + (k / 16) * Math.PI * 2;
    const x = p.x + Math.cos(a) * minDist;
    const y = p.y + Math.sin(a) * minDist;
    if (isOpenSpawn(game, x, y, pad)) return { x, y, onScreen: inView(view, x, y, pad) };
  }
  // Last resort: toward the arena centre, which always has room beyond the minimum distance.
  const a = Math.atan2(game.worldHeight / 2 - p.y, game.worldWidth / 2 - p.x);
  const x = p.x + Math.cos(a) * minDist;
  const y = p.y + Math.sin(a) * minDist;
  return { x, y, onScreen: inView(view, x, y, pad) };
}

// A pack member at `center` + (dx, dy): the offset point when it is open, else the pack centre.
export function packMemberPoint(game, center, dx, dy) {
  const x = center.x + dx;
  const y = center.y + dy;
  return isOpenSpawn(game, x, y) ? { x, y, onScreen: center.onScreen } : center;
}
