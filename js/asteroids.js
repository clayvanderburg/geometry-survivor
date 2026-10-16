// Destructible Geometric Asteroid Clusters & Dedicated Crab-Claw Rotary Drilling
import { TUNING } from './config.js';

export class AsteroidManager {
  constructor(worldWidth, worldHeight) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.asteroids = [];
    this.isDrilling = false;
    this.drillingRocks = [];
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

      this.spawnCluster(cx, cy);
    }

    this.rebuildSpatialHash();
  }

  spawnCluster(cx, cy) {
    const numRocks = 18 + Math.floor(Math.random() * 18);
    const mainAngle = Math.random() * Math.PI * 2;
    const elongation = 1.2 + Math.random() * 1.4;
    const sizeMult = TUNING.rockSizeMult ?? 1.0;
    const hpMult = TUNING.rockHpMult ?? 1.0;

    const placed = [];
    for (let i = 0; i < numRocks; i++) {
      const spreadA = mainAngle + (Math.random() - 0.5) * 2.2;
      const dist = Math.pow(Math.random(), 0.65) * 195 * sizeMult;
      const rx = cx + Math.cos(spreadA) * dist * elongation + (Math.random() - 0.5) * 45;
      const ry = cy + Math.sin(spreadA) * dist + (Math.random() - 0.5) * 45;

      const radius = (26 + Math.random() * 22) * sizeMult;

      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        const other = placed[j];
        const minDist = (radius + other.radius) * 0.68;
        if (Math.hypot(rx - other.x, ry - other.y) < minDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const distFromCore = Math.hypot(rx - cx, ry - cy);
      const roll = Math.random();
      let oreType = 'rock';
      let maxHp = (40 + radius * 1.05) * hpMult;
      let hue = 205;

      if (distFromCore < 85 && roll < 0.14) {
        oreType = 'core_vein';
        maxHp = 80 * hpMult;
        hue = 285;
      } else if (roll < 0.18) {
        oreType = 'gold_vein';
        maxHp = 58 * hpMult;
        hue = 46;
      } else if (roll < 0.25) {
        oreType = 'shield_vein';
        maxHp = 48 * hpMult;
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
        x: Math.max(80, Math.min(this.worldWidth - 80, rx)),
        y: Math.max(80, Math.min(this.worldHeight - 80, ry)),
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

  rebuildSpatialHash() {
    this.spatialGrid.clear();
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      const gx = Math.floor(a.x / this.cellSize);
      const gy = Math.floor(a.y / this.cellSize);
      const key = `${gx},${gy}`;
      if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
      this.spatialGrid.get(key).push(a);
    }
  }

  getNearbyAsteroids(x, y, rangeCells = 2) {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const result = [];
    for (let dx = -rangeCells; dx <= rangeCells; dx++) {
      for (let dy = -rangeCells; dy <= rangeCells; dy++) {
        const cell = this.spatialGrid.get(`${gx + dx},${gy + dy}`);
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

    const nearbyPlayerRocks = this.getNearbyAsteroids(player.x, player.y, 2);
    const miningDps = player.stats.miningSpeed || 125;
    const drillReach = player.stats.miningRange || 52; // Close-quarters physical claw-drill reach!

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

      // If within the Crab Ship's front Drill-Claws (or touching hull), grind the rock!
      if (distLeft <= drillReach || distRight <= drillReach || distCenter <= player.radius + 14) {
        this.isDrilling = true;
        this.drillingRocks.push(rock);

        // Both claws engaging same rock deals bonus twin-drill torque!
        const dualBonus = (distLeft <= drillReach && distRight <= drillReach) ? (TUNING.dualClawBonus ?? 1.45) : 1.0;
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

    // 2. Bullets vs Asteroids: Weapons DO NOT mine asteroids! Asteroids act as solid cover.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const nearBullet = this.getNearbyAsteroids(b.x, b.y, 1);
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
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const nearEnemy = this.getNearbyAsteroids(e.x, e.y, 1);
      for (let j = 0; j < nearEnemy.length; j++) {
        const rock = nearEnemy[j];
        if (rock.hp <= 0) continue;
        const dx = e.x - rock.x;
        const dy = e.y - rock.y;
        const dSq = dx * dx + dy * dy;
        const minDist = e.radius + rock.radius;
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

  // Only used when Phase Dashing directly through rock with Drill Claws
  damageRocksInRadius(cx, cy, radius, dmg, onRockShattered) {
    const nearby = this.getNearbyAsteroids(cx, cy, Math.ceil(radius / this.cellSize) + 1);
    let destroyedAny = false;
    for (let i = 0; i < nearby.length; i++) {
      const rock = nearby[i];
      if (rock.hp <= 0) continue;
      if (Math.hypot(rock.x - cx, rock.y - cy) <= radius + rock.radius) {
        rock.hp -= dmg;
        rock.hitFlash = 1;
        if (rock.hp <= 0) destroyedAny = true;
      }
    }
    if (destroyedAny) {
      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        if (this.asteroids[i].hp <= 0) {
          const rock = this.asteroids.splice(i, 1)[0];
          onRockShattered(rock);
        }
      }
      this.rebuildSpatialHash();
    }
  }

  draw(ctx, camX, camY, viewW, viewH) {
    ctx.save();

    const minX = camX - 70;
    const maxX = camX + viewW + 70;
    const minY = camY - 70;
    const maxY = camY + viewH + 70;

    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      if (a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;

      const hpRatio = Math.max(0, a.hp / a.maxHp);
      const isRich = a.oreType !== 'rock';

      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rotation);

      ctx.fillStyle = a.hitFlash > 0
        ? `hsla(${a.hue}, 80%, 32%, 0.9)`
        : isRich
        ? `hsla(${a.hue}, 75%, 14%, 0.92)`
        : 'rgba(7, 13, 28, 0.92)';

      ctx.beginPath();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = a.hitFlash > 0
        ? '#ffffff'
        : `hsla(${a.hue}, 100%, ${isRich ? 64 : 52}%, ${isRich ? 0.92 : 0.68})`;
      ctx.lineWidth = isRich ? 2.6 : 1.9;
      ctx.stroke();

      if (isRich) {
        const rCore = a.radius * 0.42;
        ctx.strokeStyle = `hsla(${a.hue}, 100%, 78%, 0.85)`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let s = 0; s < 4; s++) {
          const sa = (s * Math.PI) / 2;
          const vx = Math.cos(sa) * rCore;
          const vy = Math.sin(sa) * rCore;
          if (s === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
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

      ctx.restore();
    }

    ctx.restore();
  }
}
