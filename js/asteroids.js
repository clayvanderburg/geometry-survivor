// Destructible Geometric Asteroid Clusters & Dedicated Crab-Claw Rotary Drilling
import { TUNING } from './config.js';
import { miningDpsFor } from './pursuit.js';

// Elite mining: a lieutenant/boss grinds the rock(s) it is pressed against on its way to the ship.
export const ELITE_GRIND_CONTACT = 6; // px of surface gap that still counts as pressed against the rock
export const ELITE_GRIND_MAX_ROCKS = 2; // rocks one elite grinds at once (the two most squarely in its way)

// Sector layout. Rocks are small and many (TUNING.rockSizeMult 0.8, ~2x the old 1.15x count at a
// similar share of the map); a cluster keeps the old footprint and packs more rocks into it.
export const CLUSTER_SPREAD = 224; // px from a cluster's centre along its main axis (before elongation)
export const CLUSTER_ROCKS_MIN = 28; // placement attempts per cluster (overlapping rocks are skipped)
export const CLUSTER_ROCKS_RANGE = 26;
export const ROCK_HP_BASE = 22; // plain rock HP = (base + radius x 1.05) x rockHpMult
export const CORE_VEIN_RADIUS = 85; // deep cores only within this distance of the cluster centre
export const CORE_VEIN_CHANCE = 0.08;
export const SHIELD_VEIN_CHANCE = 0.07;
export const REPLENISH_SHARE = 0.76; // a cluster respawns each wave while fewer rocks than this share remain

// Numeric spatial-hash key (no string building per query: ~1000 rocks are probed many times a tick).
// Unique for cell coordinates in [-1024, 3071], far beyond the arena.
const cellKey = (gx, gy) => (gx + 1024) * 4096 + (gy + 1024);

// Per-rock render cache: the outline as a Path2D (browser only) and the rock's resting colors.
function rockLook(a) {
  if (a.look) return a.look;
  const isRich = a.oreType !== 'rock';
  let path = null;
  if (typeof Path2D !== 'undefined') {
    path = new Path2D();
    for (let v = 0; v < a.verts.length; v++) {
      const pt = a.verts[v];
      if (v === 0) path.moveTo(pt.x, pt.y);
      else path.lineTo(pt.x, pt.y);
    }
    path.closePath();
  }
  a.look = {
    isRich,
    path,
    cos: Math.cos(a.rotation),
    sin: Math.sin(a.rotation),
    fill: isRich ? `hsla(${a.hue}, 75%, 14%, 0.92)` : 'rgba(7, 13, 28, 0.92)',
    flashFill: `hsla(${a.hue}, 80%, 32%, 0.9)`,
    stroke: `hsla(${a.hue}, 100%, ${isRich ? 64 : 52}%, ${isRich ? 0.92 : 0.68})`,
    core: `hsla(${a.hue}, 100%, 78%, 0.85)`
  };
  return a.look;
}

// Crack network (visual only), in the rock's local frame: 3-4 jagged branches that start where the
// drill bit in and wander across the rock, some forking. Each segment opens at a damage fraction
// (`at`, 0..1) along its branch, so the cracks visibly spread as the rock is ground down.
export function rockCracks(a, originX, originY) {
  if (a.cracks) return a.cracks;
  const r = a.radius;
  let ox = originX, oy = originY;
  const od = Math.hypot(ox, oy);
  if (!(od > 0)) { const v = a.verts[0]; ox = v.x; oy = v.y; }
  else if (od > r * 0.9) { ox *= (r * 0.9) / od; oy *= (r * 0.9) / od; }
  const segs = [];
  const inward = Math.atan2(-oy, -ox);
  const branches = 3 + (Math.random() < 0.5 ? 1 : 0);
  const walk = (x, y, heading, len, start, span, depth) => {
    const steps = 3 + Math.floor(Math.random() * 2);
    const step = len / steps;
    for (let i = 0; i < steps; i++) {
      heading += (Math.random() - 0.5) * 0.9;
      let nx = x + Math.cos(heading) * step;
      let ny = y + Math.sin(heading) * step;
      const d = Math.hypot(nx, ny);
      if (d > r * 0.92) { nx *= (r * 0.92) / d; ny *= (r * 0.92) / d; }
      const at = start + (span * (i + 1)) / steps;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, at0: start + (span * i) / steps, at, depth });
      if (depth === 0 && i === 1 && Math.random() < 0.7) {
        walk(nx, ny, heading + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.5), len * 0.5, at, Math.min(span * 0.6, 0.98 - at), 1);
      }
      x = nx; y = ny;
    }
  };
  for (let b = 0; b < branches; b++) {
    const heading = inward + ((b - (branches - 1) / 2) * 1.1) + (Math.random() - 0.5) * 0.4;
    walk(ox, oy, heading, r * (1.1 + Math.random() * 0.5), 0.04 + b * 0.05, 0.75, 0);
  }
  a.cracks = { ox, oy, segs };
  return a.cracks;
}

// World point -> the rock's local frame (where its outline and cracks live).
function toLocal(a, wx, wy) {
  const look = rockLook(a);
  const dx = wx - a.x, dy = wy - a.y;
  return { x: dx * look.cos + dy * look.sin, y: -dx * look.sin + dy * look.cos };
}

// Independent drill claws: a rock within CLAW_FRONT_ARC of the hull heading (and in reach) pulls both
// claws onto it; otherwise the port claw takes the nearest rock on the left and the starboard claw the
// nearest on the right, each swinging up to CLAW_SWING_MAX off the heading. Returns the target angle
// of each claw: [port, starboard] (the hull heading when it has nothing to bite).
export const CLAW_FRONT_ARC = 0.42; // rad either side of dead ahead (~24 deg)
export const CLAW_SWING_MAX = 2.6;  // rad each claw swings out to its own side (~150 deg)
export function clawTargets(p, rocks, reach) {
  const hull = p.hullAngle ?? p.angle ?? 0;
  let front = null, frontD = Infinity;
  const side = [null, null], sideD = [Infinity, Infinity], sideA = [hull, hull];
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock.hp <= 0) continue;
    const dx = rock.x - p.x, dy = rock.y - p.y;
    const d = Math.hypot(dx, dy) - rock.radius;
    if (d > reach) continue;
    const a = Math.atan2(dy, dx);
    const rel = Math.atan2(Math.sin(a - hull), Math.cos(a - hull));
    if (Math.abs(rel) <= CLAW_FRONT_ARC) {
      if (d < frontD) { frontD = d; front = a; }
    } else if (Math.abs(rel) <= CLAW_SWING_MAX) {
      const k = rel < 0 ? 0 : 1;
      if (d < sideD[k]) { sideD[k] = d; side[k] = rock; sideA[k] = a; }
    }
  }
  return front !== null ? [front, front] : sideA;
}

// Damage stages that knock a chunk off a rock while it is ground down (fractions of max HP left).
const CHIP_STAGES = [0.66, 0.33];

// Drill/grind bookkeeping shared by the ship's claws and elites: contact point, heat, and a chunk
// breaking off at each CHIP_STAGES threshold.
function grindFx(rock, cx, cy, hue, particles) {
  rock.lastGrindX = cx;
  rock.lastGrindY = cy;
  rock.heat = Math.min(1, (rock.heat || 0) + 0.12);
  const stage = rock.chipStage || 0;
  if (stage < CHIP_STAGES.length && rock.hp > 0 && rock.hp / rock.maxHp <= CHIP_STAGES[stage]) {
    rock.chipStage = stage + 1;
    if (particles) {
      const out = Math.atan2(cy - rock.y, cx - rock.x);
      particles.spawnPolygonShatter(cx, cy, rock.radius * 0.32, 3, out, hue, 0.55);
      particles.spawnDirectionalSparks(cx, cy, out, 1.2, 5, hue, 6);
      particles.spawnFlash?.(cx, cy, rock.radius * 0.5, hue, 0.1);
    }
  }
}

export class AsteroidManager {
  constructor(worldWidth, worldHeight) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.asteroids = [];
    this.isDrilling = false;
    this.drillingRocks = [];
    // Elite grinding this tick: count of rock contacts and the one nearest the ship (for the sound).
    this.eliteGrinds = 0;
    this.eliteGrindX = 0;
    this.eliteGrindY = 0;
    this.cellSize = 140;
    this.spatialGrid = new Map();
  }

  generateSector(centerX, centerY) {
    this.asteroids = [];
    this.isDrilling = false;
    this.drillingRocks = [];

    const clusterCount = Math.round(TUNING.clusterCount ?? 38);
    for (let c = 0; c < clusterCount; c++) {
      let cx = 260 + Math.random() * (this.worldWidth - 520);
      let cy = 260 + Math.random() * (this.worldHeight - 520);

      if (Math.hypot(cx - centerX, cy - centerY) < 400) {
        cx += (cx < centerX ? -440 : 440);
        cy += (cy < centerY ? -440 : 440);
      }

      this.spawnCluster(cx, cy, { x: centerX, y: centerY, radius: 250 });
    }

    this.sectorRockCount = this.asteroids.length;
    this.rebuildSpatialHash();
  }

  // Mined-out sectors get a fresh cluster each wave while the rock count is below REPLENISH_SHARE of
  // the sector's starting count.
  needsReplenish() {
    return this.asteroids.length < (this.sectorRockCount || 0) * REPLENISH_SHARE;
  }

  // `avoid` ({ x, y, radius }) keeps every rock clear of a point, e.g. the player.
  // A cluster's footprint is fixed (CLUSTER_SPREAD); rock size only sets how many rocks fit in it, so
  // smaller rocks (TUNING.rockSizeMult) give a denser field of more, smaller rocks rather than a smaller one.
  spawnCluster(cx, cy, avoid = null) {
    const numRocks = CLUSTER_ROCKS_MIN + Math.floor(Math.random() * CLUSTER_ROCKS_RANGE);
    const mainAngle = Math.random() * Math.PI * 2;
    const elongation = 1.2 + Math.random() * 1.4;
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const hpMult = TUNING.rockHpMult ?? 1.6;
    // Vein HP was set for the old 1.15x rocks: it shrinks with rock size so drilling time per area holds.
    const veinHp = hpMult * Math.min(1, sizeMult / 1.15);
    const goldChance = Math.max(0, TUNING.goldVeinChance ?? 0.15);

    const placed = [];
    for (let i = 0; i < numRocks; i++) {
      const spreadA = mainAngle + (Math.random() - 0.5) * 2.2;
      const dist = Math.pow(Math.random(), 0.65) * CLUSTER_SPREAD;
      const rx = cx + Math.cos(spreadA) * dist * elongation + (Math.random() - 0.5) * 45;
      const ry = cy + Math.sin(spreadA) * dist + (Math.random() - 0.5) * 45;

      const radius = (26 + Math.random() * 22) * sizeMult;
      // Leave a wall gap wide enough for the ship to pass.
      const edge = Math.max(80, radius + 60);
      const x = Math.max(edge, Math.min(this.worldWidth - edge, rx));
      const y = Math.max(edge, Math.min(this.worldHeight - edge, ry));
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < radius + avoid.radius) continue;

      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        const other = placed[j];
        const minDist = (radius + other.radius) * 0.68;
        if (Math.hypot(x - other.x, y - other.y) < minDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const distFromCore = Math.hypot(x - cx, y - cy);
      const roll = Math.random();
      let oreType = 'rock';
      let maxHp = (ROCK_HP_BASE + radius * 1.05) * hpMult;
      let hue = 205;

      // Deep cores sit near the cluster's heart; the rest roll gold, then shield, then plain rock.
      const coreBand = distFromCore < CORE_VEIN_RADIUS ? CORE_VEIN_CHANCE : 0;
      if (roll < coreBand) {
        oreType = 'core_vein';
        maxHp = 80 * veinHp;
        hue = 285;
      } else if (roll < coreBand + goldChance) {
        oreType = 'gold_vein';
        maxHp = 58 * veinHp;
        hue = 46;
      } else if (roll < coreBand + goldChance + SHIELD_VEIN_CHANCE) {
        oreType = 'shield_vein';
        maxHp = 48 * veinHp;
        hue = 155;
      }

      const sides = 6 + Math.floor(Math.random() * 3);
      const verts = [];
      for (let s = 0; s < sides; s++) {
        const a = (s * Math.PI * 2) / sides;
        const rJitter = radius * (0.82 + Math.random() * 0.32);
        verts.push({
          x: Math.cos(a) * rJitter,
          y: Math.sin(a) * rJitter
        });
      }

      const rock = {
        x,
        y,
        radius,
        sides,
        verts,
        rotation: Math.random() * Math.PI * 2,
        oreType,
        hp: maxHp,
        maxHp,
        hue,
        hitFlash: 0
      };

      placed.push(rock);
      this.asteroids.push(rock);
    }
  }

  // Blow up every rock touching a circle (a boss's portal opening): each goes through the normal shatter
  // path as if an elite broke it (ore drops, not counted as your mining). Returns how many broke.
  blastRocks(x, y, radius, onRockShattered) {
    let broken = 0;
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const rock = this.asteroids[i];
      if (rock.hp <= 0) continue;
      const reach = radius + rock.radius;
      if ((rock.x - x) ** 2 + (rock.y - y) ** 2 > reach * reach) continue;
      rock.hp = 0;
      rock.brokenBy = 'elite';
      this.asteroids.splice(i, 1);
      onRockShattered?.(rock);
      broken++;
    }
    if (broken) this.rebuildSpatialHash();
    return broken;
  }

  rebuildSpatialHash() {
    this.spatialGrid.clear();
    this.maxRockRadius = this.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      const gx = Math.floor(a.x / this.cellSize);
      const gy = Math.floor(a.y / this.cellSize);
      const key = cellKey(gx, gy);
      let cell = this.spatialGrid.get(key);
      if (!cell) this.spatialGrid.set(key, (cell = []));
      cell.push(a);
    }
  }

  // Cell range that covers every rock whose surface is within `reach` of a point.
  cellsFor(reach) {
    return Math.ceil((reach + (this.maxRockRadius || 0)) / this.cellSize);
  }

  getNearbyAsteroids(x, y, rangeCells = 2) {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const result = [];
    for (let dx = -rangeCells; dx <= rangeCells; dx++) {
      for (let dy = -rangeCells; dy <= rangeCells; dy++) {
        const cell = this.spatialGrid.get(cellKey(gx + dx, gy + dy));
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            result.push(cell[i]);
          }
        }
      }
    }
    return result;
  }

  // Where each drill claw should point this tick (clawTargets over the rocks in claw reach).
  clawAims(player) {
    const reach = player.radius * 1.75 + (player.stats?.miningRange || 43);
    return clawTargets(player, this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(reach))), reach);
  }

  // Dedicated Crab-Claw Rotary Drilling & Obstacle Physics (Weapons do NOT mine rocks; only your Claws do!)
  update(dt, player, enemies, bullets, onRockShattered, particles) {
    this.isDrilling = false;
    this.drillingRocks = [];

    for (let i = 0; i < this.asteroids.length; i++) {
      if (this.asteroids[i].hitFlash > 0) {
        this.asteroids[i].hitFlash = Math.max(0, this.asteroids[i].hitFlash - dt * 6);
      }
      if (this.asteroids[i].heat > 0) this.asteroids[i].heat = Math.max(0, this.asteroids[i].heat - dt * 1.6);
    }

    const miningDps = player.stats.miningSpeed || 75;
    const drillReach = player.stats.miningRange || 43; // Close-quarters physical claw-drill reach!
    // Claw tips sit ~1.73 hull radii from the centre; upgraded reach can exceed the old fixed ±2 cells.
    const nearbyPlayerRocks = this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(drillReach + player.radius * 1.75)));

    // World positions of the two drill claws. Each arm swings on its own heading (player.clawAngles:
    // [port claw, starboard claw], see clawTargets), else both follow the shared drillAngle.
    // "Left"/"right" here are the claws at local +y / -y of their heading (starboard / port).
    const clawHeading = player.drillAngle !== undefined ? player.drillAngle : player.angle;
    const clawForwardOffset = player.radius * 1.45;
    const clawSpreadOffset = player.radius * 0.95;
    const clawPos = (heading, side) => {
      const fx = Math.cos(heading), fy = Math.sin(heading);
      return [player.x + fx * clawForwardOffset - fy * clawSpreadOffset * side, player.y + fy * clawForwardOffset + fx * clawSpreadOffset * side];
    };
    const [leftClawX, leftClawY] = clawPos(player.clawAngles?.[1] ?? clawHeading, 1);
    const [rightClawX, rightClawY] = clawPos(player.clawAngles?.[0] ?? clawHeading, -1);

    let destroyedAny = false;

    // 1. Check Crab Drill-Claws & Hull Engagement with Asteroids. First who touches what: when the
    // claws grind two different rocks (and share none), each runs at half the twin-claw torque, so
    // two rocks at once mine the same total as both claws on one.
    const touches = [];
    let anyLeft = false, anyRight = false, shared = false;
    for (let i = 0; i < nearbyPlayerRocks.length; i++) {
      const rock = nearbyPlayerRocks[i];
      if (rock.hp <= 0) continue;
      const distLeft = Math.hypot(rock.x - leftClawX, rock.y - leftClawY) - rock.radius;
      const distRight = Math.hypot(rock.x - rightClawX, rock.y - rightClawY) - rock.radius;
      const distCenter = Math.hypot(rock.x - player.x, rock.y - player.y) - rock.radius;
      const l = distLeft <= drillReach, r = distRight <= drillReach;
      anyLeft ||= l;
      anyRight ||= r;
      shared ||= l && r;
      touches.push({ rock, distLeft, distRight, distCenter, l, r });
    }
    const twinTorque = TUNING.dualClawBonus ?? 1.25;
    const split = anyLeft && anyRight && !shared;
    player.clawDrilling = [anyRight, anyLeft];

    for (let i = 0; i < touches.length; i++) {
      const { rock, distLeft, distRight, distCenter, l, r } = touches[i];

      // If within the Crab Ship's front Drill-Claws (or touching hull), grind the rock!
      if (l || r || distCenter <= player.radius + 14) {
        this.isDrilling = true;
        this.drillingRocks.push(rock);

        // Both claws engaging same rock deals bonus twin-drill torque; split claws share it.
        const torque = l && r ? twinTorque : (l || r) && split ? twinTorque / 2 : 1.0;
        rock.hp -= miningDps * torque * dt;
        rock.hitFlash = 0.85;
        {
          // Contact point: the rock face toward the nearer claw.
          const cx0 = distLeft < distRight ? leftClawX : rightClawX;
          const cy0 = distLeft < distRight ? leftClawY : rightClawY;
          const cd = Math.hypot(cx0 - rock.x, cy0 - rock.y) || 1;
          const gx = rock.x + ((cx0 - rock.x) / cd) * rock.radius, gy = rock.y + ((cy0 - rock.y) / cd) * rock.radius;
          const ghue = rock.oreType !== 'rock' ? rock.hue : 42;
          grindFx(rock, gx, gy, ghue, particles);
          // Grinding embers: slow glowing chips and a flicker of light at the bite.
          if (Math.random() < 0.25) particles.spawnExplosionSparks(gx, gy, 1, ghue, 0.5, 2.4, 3);
          if (Math.random() < 0.05) particles.spawnFlash?.(gx, gy, 8, ghue, 0.07);
        }

        // Spray high-velocity rock-grinding sparks off the drill claws!
        if (Math.random() < 0.75) {
          const sparkX = distLeft < distRight ? leftClawX : rightClawX;
          const sparkY = distLeft < distRight ? leftClawY : rightClawY;
          particles.spawnDirectionalSparks(
            sparkX,
            sparkY,
            ((distLeft < distRight ? player.clawAngles?.[1] : player.clawAngles?.[0]) ?? clawHeading) + Math.PI + (Math.random() - 0.5) * 0.8,
            1.3,
            2,
            rock.oreType !== 'rock' ? rock.hue : 42,
            8.5
          );
        }

        if (rock.hp <= 0) {
          destroyedAny = true;
        }
      }

      // Solid physical collision so you feel yourself boring through the rock face
      const dx = player.x - rock.x;
      const dy = player.y - rock.y;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = player.radius + rock.radius;
      if (dist < minDist) {
        const overlap = minDist - dist;
        player.x += (dx / dist) * overlap;
        player.y += (dy / dist) * overlap;
      }
    }
    // Pushout must not move the ship past the arena wall (same pad as Game.update).
    const playerPad = player.radius + 24;
    player.x = Math.max(playerPad, Math.min(this.worldWidth - playerPad, player.x));
    player.y = Math.max(playerPad, Math.min(this.worldHeight - playerPad, player.y));

    // 2. Bullets vs Asteroids: Weapons DO NOT mine asteroids! Asteroids act as solid cover.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const nearBullet = this.getNearbyAsteroids(b.x, b.y, this.cellsFor(b.radius));
      for (let j = 0; j < nearBullet.length; j++) {
        const rock = nearBullet[j];
        if (rock.hp <= 0) continue;
        const dx = b.x - rock.x;
        const dy = b.y - rock.y;
        const hitR = rock.radius + b.radius;
        if (dx * dx + dy * dy <= hitR * hitR) {
          particles.spawnDirectionalSparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 0.9, 2, b.hue, 4);
          bullets.splice(i, 1);
          break;
        }
      }
    }

    // 3. Enemies vs Asteroids (Enemies are blocked and funneled through your carved tunnels!)
    // Elites (lieutenants, bosses) are blocked too, but grind the rock they press into at the ship's
    // BASE drill DPS (eliteMiningDps: TUNING.miningSpeed × eliteMiningMult, no player upgrades).
    // Bosses grind at bossMiningMult × that and serpent heads at serpentMiningMult × (miningDpsFor).
    this.eliteGrinds = 0;
    let grindBest = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.leader) continue; // serpent body plates glide over rock behind their head
      const eliteDps = miningDpsFor(e);
      const grinds = eliteDps > 0;
      const contact = grinds ? ELITE_GRIND_CONTACT : 0;
      // Up to two touched rocks, ranked by how squarely they sit in the way: on the line to the ship
      // or along the hull's own heading, whichever is squarer (a coiling boss mines where it goes).
      let g0 = null, g1 = null, s0 = 0, s1 = 0;
      const toShip = grinds ? Math.hypot(player.x - e.x, player.y - e.y) || 1 : 1;
      const spd = grinds ? Math.hypot(e.vx, e.vy) : 0;
      const nearEnemy = this.getNearbyAsteroids(e.x, e.y, this.cellsFor(e.radius + contact));
      for (let j = 0; j < nearEnemy.length; j++) {
        const rock = nearEnemy[j];
        if (rock.hp <= 0) continue;
        const dx = e.x - rock.x;
        const dy = e.y - rock.y;
        const dSq = dx * dx + dy * dy;
        const minDist = e.radius + rock.radius;
        if (grinds) {
          const touch = minDist + contact;
          // Pressed against it, and the rock is on the ship's side of the elite (it is in the way).
          if (dSq < touch * touch && dSq > 0.01) {
            const d = Math.sqrt(dSq);
            const shipAhead = ((player.x - e.x) * -dx + (player.y - e.y) * -dy) / (toShip * d);
            const ahead = spd > 0.5 ? Math.max(shipAhead, (e.vx * -dx + e.vy * -dy) / (spd * d)) : shipAhead;
            if (ahead > s0) { g1 = g0; s1 = s0; g0 = rock; s0 = ahead; }
            else if (ahead > s1) { g1 = rock; s1 = ahead; }
          }
        }
        if (dSq < minDist * minDist && dSq > 0.01) {
          const dist = Math.sqrt(dSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          e.x += nx * overlap;
          e.y += ny * overlap;

          const dot = e.vx * nx + e.vy * ny;
          if (dot < 0) {
            e.vx -= nx * dot * 1.1;
            e.vy -= ny * dot * 1.1;
          }
        }
      }
      if (g0) {
        const grind = g1 && ELITE_GRIND_MAX_ROCKS > 1 ? 2 : 1;
        for (let k = 0; k < grind; k++) {
          const rock = k === 0 ? g0 : g1;
          if (this.grindRock(rock, e, eliteDps, dt, particles)) destroyedAny = true;
          const d = (rock.x - player.x) ** 2 + (rock.y - player.y) ** 2;
          this.eliteGrinds++;
          if (d < grindBest) {
            grindBest = d;
            this.eliteGrindX = rock.lastGrindX;
            this.eliteGrindY = rock.lastGrindY;
          }
        }
      }
      // Keep pushout inside the arena (same pad as EnemyManager's wall clamp).
      const pad = e.radius + 8;
      e.x = Math.max(pad, Math.min(this.worldWidth - pad, e.x));
      e.y = Math.max(pad, Math.min(this.worldHeight - pad, e.y));
    }

    // 4. Process Shattered Rocks
    if (destroyedAny) {
      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const rock = this.asteroids[i];
        if (rock.hp <= 0) {
          this.asteroids.splice(i, 1);
          onRockShattered(rock);
        }
      }
      this.rebuildSpatialHash();
    }
  }

  // One elite's grind on one rock for this tick: the same hp drain + hit flash (and so the same crack
  // and flash rendering) as the ship's drill, sparks/debris at the contact point scaled by the live
  // vfxIntensity (the flash also follows vfxLinger). Returns true when this grind broke the rock;
  // it is tagged `brokenBy = 'elite'` so the shatter handler can tell it from the player's drill.
  grindRock(rock, e, dps, dt, particles) {
    let nx = e.x - rock.x;
    let ny = e.y - rock.y;
    const d = Math.hypot(nx, ny) || 1;
    nx /= d;
    ny /= d;
    const cx = rock.x + nx * rock.radius;
    const cy = rock.y + ny * rock.radius;
    rock.hp -= dps * dt;
    rock.hitFlash = 0.85;
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 32;
    grindFx(rock, cx, cy, hue, particles);
    const vfx = typeof particles?.intensity === 'number' ? particles.intensity : 1;
    if (particles && Math.random() < 0.55) {
      // Sparks spray back off the face along the rock's normal, either side of the elite's hull.
      const count = Math.max(1, Math.round((1 + Math.random() * 2) * vfx));
      const out = Math.atan2(ny, nx);
      particles.spawnDirectionalSparks(cx, cy, out + (Math.random() < 0.5 ? 1 : -1) * 0.9, 1.1, count, hue, 7);
      if (Math.random() < 0.18) particles.spawnExplosionSparks(cx, cy, 1, hue, 0.6, 2.2, 3.2); // slow rock chips
      if (Math.random() < 0.12) particles.spawnFlash?.(cx, cy, 9 + e.radius * 0.15, hue, 0.12);
    }
    if (rock.hp <= 0) {
      rock.brokenBy = 'elite';
      return true;
    }
    return false;
  }

  // Rocks in view only (via the spatial grid), each drawn with one setTransform from the camera
  // transform instead of save/translate/rotate/restore, and a cached outline path and colors.
  draw(ctx, camX, camY, viewW, viewH) {
    const pad = 70;
    const minX = camX - pad;
    const maxX = camX + viewW + pad;
    const minY = camY - pad;
    const maxY = camY + viewH + pad;
    const base = ctx.getTransform ? ctx.getTransform() : null;
    const cs = this.cellSize;
    const gx0 = Math.floor(minX / cs) - 1, gx1 = Math.floor(maxX / cs) + 1;
    const gy0 = Math.floor(minY / cs) - 1, gy1 = Math.floor(maxY / cs) + 1;

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cell = this.spatialGrid.get(cellKey(gx, gy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i];
          if (a.hp <= 0 || a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;
          this.drawRock(ctx, a, base);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (base) ctx.setTransform(base);
  }

  drawRock(ctx, a, base) {
    const look = rockLook(a);
    const { cos, sin } = look;
    // A rock being ground shudders a pixel or so.
    const jit = a.hitFlash > 0.4 ? 1.3 : 0;
    const px = a.x + (jit ? (Math.random() - 0.5) * jit * 2 : 0);
    const py = a.y + (jit ? (Math.random() - 0.5) * jit * 2 : 0);
    if (base) {
      ctx.setTransform(
        base.a * cos + base.c * sin, base.b * cos + base.d * sin,
        base.c * cos - base.a * sin, base.d * cos - base.b * sin,
        base.a * px + base.c * py + base.e, base.b * px + base.d * py + base.f
      );
    } else {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a.rotation);
    }
    const hpRatio = Math.max(0, a.hp / a.maxHp);
    const isRich = look.isRich;
    const flashing = a.hitFlash > 0;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = flashing ? look.flashFill : look.fill;
    let path = look.path;
    if (!path) {
      ctx.beginPath();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    }
    if (path) ctx.fill(path); else ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = flashing ? '#ffffff' : look.stroke;
    ctx.lineWidth = isRich ? 2.6 : 1.9;
    if (path) ctx.stroke(path); else ctx.stroke();

    if (isRich) {
      const rCore = a.radius * 0.42;
      ctx.strokeStyle = look.core;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(rCore, 0);
      ctx.lineTo(0, rCore);
      ctx.lineTo(-rCore, 0);
      ctx.lineTo(0, -rCore);
      ctx.closePath();
      ctx.stroke();
    }

    // Cracks spread from where the drill bit in, glowing hotter as the rock nears breaking; a
    // white-hot spot marks the contact while it is being ground.
    const dmg = 1 - hpRatio;
    if (dmg > 0.03) {
      let cracks = a.cracks;
      if (!cracks) {
        const o = a.lastGrindX != null ? toLocal(a, a.lastGrindX, a.lastGrindY) : { x: 0, y: 0 };
        cracks = rockCracks(a, o.x, o.y);
      }
      const hue = isRich ? a.hue : 34;
      const open = Math.min(1, dmg * 1.15);
      ctx.beginPath();
      for (let i = 0; i < cracks.segs.length; i++) {
        const s = cracks.segs[i];
        if (s.at0 >= open) continue;
        const k = Math.min(1, (open - s.at0) / (s.at - s.at0));
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x1 + (s.x2 - s.x1) * k, s.y1 + (s.y2 - s.y1) * k);
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = `hsla(${hue}, 100%, 55%, ${0.25 + 0.35 * dmg})`;
      ctx.lineWidth = 3.4 + 2 * dmg;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 100%, ${78 + 18 * dmg}%, ${0.55 + 0.45 * dmg})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const heat = a.heat || 0;
      if (heat > 0.05 && a.lastGrindX != null) {
        const hot = toLocal(a, a.lastGrindX, a.lastGrindY);
        ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.25 * heat})`;
        ctx.beginPath();
        ctx.arc(hot.x, hot.y, 4 + 5 * heat, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 250, 235, ${0.6 * heat})`;
        ctx.beginPath();
        ctx.arc(hot.x, hot.y, 1.5 + 2 * heat, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!base) ctx.restore();
  }
}
