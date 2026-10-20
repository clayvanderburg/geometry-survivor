// Pursuit helpers: every hostile chaser keeps closing on the ship wherever it is on the map.
//   - Rock detours: a cheap look-ahead along the line to the ship (the asteroid spatial hash, a few
//     cells, re-probed every PROBE_TICKS ticks per enemy). When a rock blocks that line the enemy
//     steers along the rock's tangent, on a sticky side, until the line is clear. No pathfinding.
//   - Catch-up pace: an enemy that is off screen AND more than `pursuitCatchupStart` px from the ship
//     moves faster, ramping to `pursuitCatchupMax`× over CATCHUP_RAMP px. Chosen over teleporting
//     stragglers back to the spawn ring: the hull you ran from is the one that arrives, it streams in
//     visibly on the minimap, and nothing ever changes speed on screen.
//   - Elites (lieutenants and bosses) skip the detour while elite mining is on: they plow straight at
//     the ship and grind through whatever rock is in the way (AsteroidManager.update, section 3).
// Vortexes (internal type 'blackhole') never take part: they drift, they don't chase.
import { TUNING } from './config.js';

export const PROBE_TICKS = 4;
export const DETOUR_HOLD = 0.3; // seconds a detour persists after its last blocked probe
export const DETOUR_FLIP = 1.5; // seconds between progress checks while detouring
export const DETOUR_MIN_PROGRESS = 30; // px a detouring enemy must cover per check, else it tries the other side
export const CATCHUP_RAMP = 900; // px over which catch-up pace ramps from 1× to the max
const LOOKAHEAD = 80; // px beyond the hull checked for rock
const VIEW_PAD = 60; // a hull this close to the screen edge counts as on screen (no catch-up)

export const pursues = (e) => e.type !== 'blackhole';

// Elites = the Field Guide ELITES group: lieutenants and bosses.
export const isElite = (e) => !!(e && (e.isBoss || e.isLieutenant));

// Elite drill DPS, read live: the ship's BASE mining speed (TUNING.miningSpeed, no upgrades or meta
// bonuses) × eliteMiningMult. 0 when the eliteMining toggle is off.
export function eliteMiningDps(tuning = TUNING) {
  if (!((tuning.eliteMining ?? 1) >= 0.5)) return 0;
  return Math.max(0, (tuning.miningSpeed ?? 75) * (tuning.eliteMiningMult ?? 1));
}

// Rock-miners: elites, plus serpent heads (their bodies glide over rock behind them) and borers.
export const minesRock = (e) => isElite(e) || (e?.type === 'serpent' && !e.leader) || e?.type === 'borer';

// This enemy's drill DPS: the elite base, × bossMiningMult for bosses (they bust right through) and
// × serpentMiningMult for serpent heads.
export function miningDpsFor(e, tuning = TUNING) {
  const base = eliteMiningDps(tuning);
  if (!(base > 0) || !minesRock(e)) return 0;
  if (e.isBoss) return base * (tuning.bossMiningMult ?? 4);
  // A borer's drill: borerMiningMult, and boreMiningMult mid-charge (rock in its lane shatters).
  if (e.type === 'borer') return base * (e.state === 'bore' ? (tuning.boreMiningMult ?? 30) : (tuning.borerMiningMult ?? 3));
  if (!e.isLieutenant) return base * (tuning.serpentMiningMult ?? 2);
  return base;
}

// True when this enemy goes through rock instead of round it.
export const plowsThroughRock = (e, tuning = TUNING) => miningDpsFor(e, tuning) > 0;

// Writes the steering direction into `out` ({ x, y }, unit length): straight at the ship, or along a
// blocking rock's tangent. `probe` says whether this tick re-checks the look-ahead.
export function steerAroundRocks(e, dirX, dirY, dist, terrain, dt, probe, out) {
  out.x = dirX;
  out.y = dirY;
  if (!terrain?.getNearbyAsteroids || !pursues(e)) return out;
  if (plowsThroughRock(e)) {
    // Straight line: rock in the way is ground down on contact, never steered round.
    e.detourRock = null;
    e.detourT = undefined;
    e.detourSide = 0;
    return out;
  }

  if (probe) {
    const reach = Math.min(dist, e.radius + LOOKAHEAD);
    const midX = e.x + dirX * reach * 0.5;
    const midY = e.y + dirY * reach * 0.5;
    const rocks = terrain.getNearbyAsteroids(midX, midY, 1);
    let block = null;
    let blockS = Infinity;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (rock.hp !== undefined && rock.hp <= 0) continue;
      const rx = rock.x - e.x;
      const ry = rock.y - e.y;
      const s = rx * dirX + ry * dirY; // distance along the line to the ship
      if (s <= 0 || s > reach + rock.radius || s > dist) continue;
      const lateral = Math.abs(dirX * ry - dirY * rx);
      if (lateral < rock.radius + e.radius + 4 && s < blockS) {
        block = rock;
        blockS = s;
      }
    }
    if (block) {
      e.detourRock = block;
      e.detourT = DETOUR_HOLD;
      if (!e.detourSide) {
        // Go round the side the line to the ship already leans toward (ties: the enemy's strafe side).
        const nx = e.x - block.x;
        const ny = e.y - block.y;
        const tDot = -ny * dirX + nx * dirY;
        e.detourSide = Math.abs(tDot) > 1e-6 ? Math.sign(tDot) : (e.strafeSign || 1);
        e.detourAge = 0;
        e.detourX = e.x;
        e.detourY = e.y;
      }
    }
  }

  if (!(e.detourT > 0) || !e.detourRock || e.detourRock.hp <= 0) {
    if (e.detourT !== undefined) {
      e.detourT -= dt;
      if (e.detourT < -1) e.detourSide = 0; // clear path for a second: forget the side
    }
    return out;
  }
  e.detourT -= dt;
  e.detourAge = (e.detourAge || 0) + dt;
  if (e.detourAge > DETOUR_FLIP) {
    // Wedged in a concave pocket (barely moved since the last check): try the other way round.
    if (Math.hypot(e.x - e.detourX, e.y - e.detourY) < DETOUR_MIN_PROGRESS) e.detourSide = -e.detourSide;
    e.detourAge = 0;
    e.detourX = e.x;
    e.detourY = e.y;
  }
  const rock = e.detourRock;
  let nx = e.x - rock.x;
  let ny = e.y - rock.y;
  const d = Math.hypot(nx, ny) || 1;
  nx /= d;
  ny /= d;
  const side = e.detourSide || 1;
  let sx = -ny * side + nx * 0.25 + dirX * 0.35;
  let sy = nx * side + ny * 0.25 + dirY * 0.35;
  const len = Math.hypot(sx, sy) || 1;
  out.x = sx / len;
  out.y = sy / len;
  return out;
}

// Movement multiplier for an enemy `dist` px from the ship: >1 only while it is off screen and far away.
export function catchupPace(e, dist, view, tuning = TUNING) {
  if (!pursues(e)) return 1;
  const start = tuning.pursuitCatchupStart ?? 900;
  const max = tuning.pursuitCatchupMax ?? 1.8;
  if (!(dist > start) || !(max > 1)) return 1;
  if (view) {
    const r = e.radius + VIEW_PAD;
    if (e.x + r >= view.x && e.x - r <= view.x + view.w && e.y + r >= view.y && e.y - r <= view.y + view.h) return 1;
  }
  return 1 + (max - 1) * Math.min(1, (dist - start) / CATCHUP_RAMP);
}
