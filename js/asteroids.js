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

// Bedrock: unbreakable rock for level design (permanent walls and boundaries). Nothing breaks it: not the
// drill-claws, elite grinding, boss portals or blasts. It blocks ships, enemies and shots like any rock,
// elites steer round it instead of plowing through, and new clusters are never placed on it.
// Lay it with addBedrock / addBedrockWall, then rebuildSpatialHash(). TUNING.bedrockFormations scatters
// a few random walls and arcs through the generated sector (0 in the standard sector).
export const BEDROCK_RADIUS = 38;
export const BEDROCK_SPACING = 1.15; // piece spacing along a wall, in piece radii (under 2, so no gaps)
export const BEDROCK_HP = 1e9; // never drained; finite so every `hp > 0` check treats it as solid
export const BEDROCK_HUE = 268;
export const isBedrock = (rock) => !!rock?.unbreakable;

// Numeric spatial-hash key (no string building per query: ~1000 rocks are probed many times a tick).
// Unique for cell coordinates in [-1024, 3071], far beyond the arena.
const cellKey = (gx, gy) => (gx + 1024) * 4096 + (gy + 1024);

// Per-rock render cache: the outline as a Path2D (browser only) and the rock's resting colors.
function rockLook(a) {
  if (a.look) return a.look;
  const bedrock = isBedrock(a);
  const isRich = a.oreType !== 'rock' && !bedrock;
  let path = null;
  let inner = null;
  if (typeof Path2D !== 'undefined') {
    path = new Path2D();
    for (let v = 0; v < a.verts.length; v++) {
      const pt = a.verts[v];
      if (v === 0) path.moveTo(pt.x, pt.y);
      else path.lineTo(pt.x, pt.y);
    }
    path.closePath();
    if (bedrock) {
      // Bedrock wears an inset facet so it reads as solid slab, not drillable rock.
      inner = new Path2D();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) inner.moveTo(pt.x * 0.58, pt.y * 0.58);
        else inner.lineTo(pt.x * 0.58, pt.y * 0.58);
      }
      inner.closePath();
    }
  }
  if (bedrock) {
    a.look = {
      isRich: false,
      bedrock: true,
      path,
      inner,
      cos: Math.cos(a.rotation),
      sin: Math.sin(a.rotation),
      fill: 'rgba(15, 11, 28, 0.97)',
      stroke: `hsla(${a.hue}, 45%, 74%, 0.95)`,
      core: `hsla(${a.hue}, 70%, 58%, 0.55)`
    };
    return a.look;
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

    // Bedrock first, so the clusters fill in round it.
    const formations = Math.max(0, Math.round(TUNING.bedrockFormations ?? 0));
    for (let f = 0; f < formations; f++) this.spawnBedrockFormation({ x: centerX, y: centerY, radius: 600 });

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

    this.sectorRockCount = this.breakableCount();
    this.rebuildSpatialHash();
  }

  // Rocks that can be mined (everything but bedrock).
  breakableCount() {
    let n = 0;
    for (let i = 0; i < this.asteroids.length; i++) if (!this.asteroids[i].unbreakable) n++;
    return n;
  }

  // Mined-out sectors get a fresh cluster each wave while the breakable rock count is below
  // REPLENISH_SHARE of the sector's starting count (bedrock never counts: it can't be mined out).
  needsReplenish() {
    return this.breakableCount() < (this.sectorRockCount || 0) * REPLENISH_SHARE;
  }

  // One unbreakable piece. Breakable rock it lands on is cleared away (no ore drops). Returns the piece.
  addBedrock(x, y, radius = BEDROCK_RADIUS) {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const r = this.asteroids[i];
      if (!r.unbreakable && Math.hypot(r.x - x, r.y - y) < (r.radius + radius) * 0.8) this.asteroids.splice(i, 1);
    }
    const sides = 6 + Math.floor(Math.random() * 2);
    const verts = [];
    for (let s = 0; s < sides; s++) {
      const a = (s * Math.PI * 2) / sides;
      const rJitter = radius * (0.9 + Math.random() * 0.14);
      verts.push({ x: Math.cos(a) * rJitter, y: Math.sin(a) * rJitter });
    }
    const rock = {
      x,
      y,
      radius,
      sides,
      verts,
      rotation: Math.random() * Math.PI * 2,
      oreType: 'bedrock',
      unbreakable: true,
      hp: BEDROCK_HP,
      maxHp: BEDROCK_HP,
      hue: BEDROCK_HUE,
      hitFlash: 0
    };
    this.asteroids.push(rock);
    return rock;
  }

  // A gapless wall of bedrock along a polyline ([{ x, y }, ...]): pieces overlap so nothing slips
  // between them. Returns the pieces laid.
  addBedrockWall(points, radius = BEDROCK_RADIUS) {
    const pieces = [];
    if (!points?.length) return pieces;
    const step = radius * BEDROCK_SPACING;
    pieces.push(this.addBedrock(points[0].x, points[0].y, radius));
    let carry = 0; // distance already walked past the last piece
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let d = step - carry;
      while (d <= len) {
        const t = d / len;
        pieces.push(this.addBedrock(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius));
        d += step;
      }
      carry = len - (d - step);
    }
    const last = points[points.length - 1];
    const tail = pieces[pieces.length - 1];
    if (Math.hypot(tail.x - last.x, tail.y - last.y) > step * 0.35) pieces.push(this.addBedrock(last.x, last.y, radius));
    return pieces;
  }

  // A random bedrock wall, bend or arc somewhere in the arena, kept out of `avoid` ({ x, y, radius }).
  spawnBedrockFormation(avoid = null) {
    const margin = 420;
    let cx = 0;
    let cy = 0;
    for (let tries = 0; tries < 20; tries++) {
      cx = margin + Math.random() * (this.worldWidth - margin * 2);
      cy = margin + Math.random() * (this.worldHeight - margin * 2);
      if (!avoid || Math.hypot(cx - avoid.x, cy - avoid.y) > avoid.radius + 300) break;
    }
    const angle = Math.random() * Math.PI * 2;
    const kind = Math.floor(Math.random() * 3);
    const points = [];
    if (kind === 0) {
      // Straight wall
      const half = 160 + Math.random() * 220;
      points.push({ x: cx - Math.cos(angle) * half, y: cy - Math.sin(angle) * half });
      points.push({ x: cx + Math.cos(angle) * half, y: cy + Math.sin(angle) * half });
    } else if (kind === 1) {
      // Bend: two legs meeting at a corner
      const legA = 200 + Math.random() * 200;
      const legB = 200 + Math.random() * 200;
      const turn = angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI * (0.4 + Math.random() * 0.2));
      points.push({ x: cx + Math.cos(angle) * legA, y: cy + Math.sin(angle) * legA });
      points.push({ x: cx, y: cy });
      points.push({ x: cx + Math.cos(turn) * legB, y: cy + Math.sin(turn) * legB });
    } else {
      // Arc: part of a ring, open on one side
      const r = 190 + Math.random() * 140;
      const sweep = Math.PI * (0.55 + Math.random() * 0.6);
      const steps = 10;
      for (let s = 0; s <= steps; s++) {
        const a = angle - sweep / 2 + (sweep * s) / steps;
        points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    const pad = BEDROCK_RADIUS + 40;
    for (const pt of points) {
      pt.x = Math.max(pad, Math.min(this.worldWidth - pad, pt.x));
      pt.y = Math.max(pad, Math.min(this.worldHeight - pad, pt.y));
    }
    return this.addBedrockWall(points);
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
    const bedrock = this.asteroids.filter(isBedrock);

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
      for (let j = 0; j < bedrock.length; j++) {
        const w = bedrock[j];
        if (Math.hypot(x - w.x, y - w.y) < radius + w.radius + 4) {
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
      if (rock.hp <= 0 || rock.unbreakable) continue;
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

  // Dedicated Crab-Claw Rotary Drilling & Obstacle Physics (Weapons do NOT mine rocks; only your Claws do!)
  update(dt, player, enemies, bullets, onRockShattered, particles) {
    this.isDrilling = false;
    this.drillingRocks = [];

    for (let i = 0; i < this.asteroids.length; i++) {
      if (this.asteroids[i].hitFlash > 0) {
        this.asteroids[i].hitFlash = Math.max(0, this.asteroids[i].hitFlash - dt * 6);
      }
    }

    const miningDps = player.stats.miningSpeed || 75;
    const drillReach = player.stats.miningRange || 43; // Close-quarters physical claw-drill reach!
    // Claw tips sit ~1.73 hull radii from the centre; upgraded reach can exceed the old fixed ±2 cells.
    const nearbyPlayerRocks = this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(drillReach + player.radius * 1.75)));

    // Calculate the world positions of the Crab Ship's Left & Right Front Drill Claws
    const clawHeading = player.drillAngle !== undefined ? player.drillAngle : player.angle;
    const fwdX = Math.cos(clawHeading);
    const fwdY = Math.sin(clawHeading);
    const sideX = -fwdY;
    const sideY = fwdX;

    const clawForwardOffset = player.radius * 1.45;
    const clawSpreadOffset = player.radius * 0.95;

    const leftClawX = player.x + fwdX * clawForwardOffset + sideX * clawSpreadOffset;
    const leftClawY = player.y + fwdY * clawForwardOffset + sideY * clawSpreadOffset;
    const rightClawX = player.x + fwdX * clawForwardOffset - sideX * clawSpreadOffset;
    const rightClawY = player.y + fwdY * clawForwardOffset - sideY * clawSpreadOffset;

    let destroyedAny = false;

    // 1. Check Crab Drill-Claws & Hull Engagement with Asteroids
    for (let i = 0; i < nearbyPlayerRocks.length; i++) {
      const rock = nearbyPlayerRocks[i];
      if (rock.hp <= 0) continue;

      const distLeft = Math.hypot(rock.x - leftClawX, rock.y - leftClawY) - rock.radius;
      const distRight = Math.hypot(rock.x - rightClawX, rock.y - rightClawY) - rock.radius;
      const distCenter = Math.hypot(rock.x - player.x, rock.y - player.y) - rock.radius;

      // If within the Crab Ship's front Drill-Claws (or touching hull), grind the rock! Bedrock only blocks.
      if (!rock.unbreakable && (distLeft <= drillReach || distRight <= drillReach || distCenter <= player.radius + 14)) {
        this.isDrilling = true;
        this.drillingRocks.push(rock);

        // Both claws engaging same rock deals bonus twin-drill torque!
        const dualBonus = (distLeft <= drillReach && distRight <= drillReach) ? (TUNING.dualClawBonus ?? 1.25) : 1.0;
        rock.hp -= miningDps * dualBonus * dt;
        rock.hitFlash = 0.85;

        // Spray high-velocity rock-grinding sparks off the drill claws!
        if (Math.random() < 0.75) {
          const sparkX = distLeft < distRight ? leftClawX : rightClawX;
          const sparkY = distLeft < distRight ? leftClawY : rightClawY;
          particles.spawnDirectionalSparks(
            sparkX,
            sparkY,
            clawHeading + Math.PI + (Math.random() - 0.5) * 0.8,
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
        if (grinds && !rock.unbreakable) {
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
    rock.lastGrindX = cx;
    rock.lastGrindY = cy;
    rock.hp -= dps * dt;
    rock.hitFlash = 0.85;
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 32;
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
    if (base) {
      ctx.setTransform(
        base.a * cos + base.c * sin, base.b * cos + base.d * sin,
        base.c * cos - base.a * sin, base.d * cos - base.b * sin,
        base.a * a.x + base.c * a.y + base.e, base.b * a.x + base.d * a.y + base.f
      );
    } else {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rotation);
    }
    if (look.bedrock) {
      this.drawBedrockPiece(ctx, a, look);
      if (!base) ctx.restore();
      return;
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

    if (hpRatio < 0.9) {
      const crackAlpha = Math.min(1, (1 - hpRatio) * 1.25);
      ctx.strokeStyle = `hsla(${isRich ? a.hue : 42}, 100%, 82%, ${crackAlpha})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const crackCount = hpRatio < 0.45 ? 4 : 2;
      for (let c = 0; c < crackCount; c++) {
        const pt = a.verts[(c * 2) % a.verts.length];
        ctx.moveTo(0, 0);
        ctx.lineTo(pt.x * (1 - hpRatio * 0.45), pt.y * (1 - hpRatio * 0.45));
      }
      ctx.stroke();
    }
    if (!base) ctx.restore();
  }

  // Bedrock: a near-black slab with a bright pale-violet rim and an inset facet. No cracks or flashes.
  drawBedrockPiece(ctx, a, look) {
    const path = look.path;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = look.fill;
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
    ctx.strokeStyle = look.stroke;
    ctx.lineWidth = 3.2;
    if (path) ctx.stroke(path); else ctx.stroke();
    if (look.inner) {
      ctx.strokeStyle = look.core;
      ctx.lineWidth = 1.6;
      ctx.stroke(look.inner);
    }
  }
}
