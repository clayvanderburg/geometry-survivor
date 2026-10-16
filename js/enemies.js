// Geometric Enemy Archetypes & Emergent Boids Swarm Intelligence
import { TUNING } from './config.js';

export class EnemyManager {
  constructor() {
    this.enemies = [];
    this.spawnIndicators = [];
  }

  clear() {
    this.enemies = [];
    this.spawnIndicators = [];
  }

  // Queue an enemy with a brief neon materialization warning ring (Geometry Wars style)
  queueSpawn(type, x, y, waveScale = 1, extra = {}) {
    const config = this.getArchetype(type, waveScale, extra);
    const hpMult = TUNING.enemyHpMult ?? 1.0;
    const spdMult = TUNING.enemySpeedMult ?? 1.0;
    config.hp *= hpMult;
    config.maxHp *= hpMult;
    config.speed *= spdMult;
    this.spawnIndicators.push({
      type,
      x,
      y,
      config,
      timer: extra.instant ? 0.02 : 0.55,
      maxTimer: 0.55
    });
  }

  // Spawn a coordinated Boid Swarm pack
  spawnBoidSwarm(centerX, centerY, count, waveScale, width, height) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 16 + Math.random() * 55;
      const sx = Math.max(30, Math.min(width - 30, centerX + Math.cos(angle) * dist));
      const sy = Math.max(30, Math.min(height - 30, centerY + Math.sin(angle) * dist));
      this.queueSpawn('swarmer', sx, sy, waveScale);
    }
  }

  getArchetype(type, waveScale = 1, extra = {}) {
    switch (type) {
      case 'swarmer':
        return {
          hp: 10 * waveScale,
          maxHp: 10 * waveScale,
          speed: 3.3 + Math.min(2.2, waveScale * 0.15),
          radius: 10,
          sides: 4,
          hue: 325, // Neon Magenta
          score: 25,
          xp: 1,
          vRot: 0.08
        };
      case 'pinwheel':
        return {
          hp: 26 * waveScale,
          maxHp: 26 * waveScale,
          speed: 2.1 + Math.min(1.5, waveScale * 0.1),
          radius: 15,
          sides: 4,
          hue: 272, // Electric Violet
          score: 45,
          xp: 2,
          vRot: 0.065
        };
      case 'weaver':
        return {
          hp: 22 * waveScale,
          maxHp: 22 * waveScale,
          speed: 3.6 + Math.min(1.8, waveScale * 0.12),
          radius: 13,
          sides: 3,
          hue: 150, // Emerald Green
          score: 60,
          xp: 2,
          vRot: 0.1
        };
      case 'splitter':
        return {
          hp: 58 * waveScale,
          maxHp: 58 * waveScale,
          speed: 1.75 + Math.min(1.2, waveScale * 0.08),
          radius: 20,
          sides: 6,
          hue: 42, // Golden Orange
          score: 95,
          xp: 4,
          vRot: -0.045
        };
      case 'mini_splitter':
        return {
          hp: 14 * waveScale,
          maxHp: 14 * waveScale,
          speed: 4.3,
          radius: 9,
          sides: 3,
          hue: 50,
          score: 20,
          xp: 1,
          vRot: 0.18,
          vx: extra.vx || 0,
          vy: extra.vy || 0
        };
      case 'blackhole':
        return {
          hp: 135 * waveScale,
          maxHp: 135 * waveScale,
          speed: 0.95,
          radius: 22,
          sides: 12,
          hue: 348, // Crimson Singularity
          score: 250,
          xp: 8,
          vRot: 0.04,
          absorbed: 0
        };
      case 'boss':
        return {
          hp: 650 * waveScale,
          maxHp: 650 * waveScale,
          speed: 1.35,
          radius: 36,
          sides: 8,
          hue: 185, // Prismatic Cyan/Gold
          score: 1500,
          xp: 30,
          vRot: 0.03,
          isBoss: true
        };
      default:
        return {
          hp: 20 * waveScale,
          maxHp: 20 * waveScale,
          speed: 2.2,
          radius: 14,
          sides: 4,
          hue: 200,
          score: 30,
          xp: 1,
          vRot: 0.05
        };
    }
  }

  update(dt, player, bullets, grid, particles, width, height) {
    // 1. Update materializing spawn rings
    for (let i = this.spawnIndicators.length - 1; i >= 0; i--) {
      const sp = this.spawnIndicators[i];
      sp.timer -= dt;
      if (sp.timer <= 0) {
        const c = sp.config;
        const angle = Math.random() * Math.PI * 2;
        this.enemies.push({
          type: sp.type,
          x: sp.x,
          y: sp.y,
          vx: c.vx !== undefined ? c.vx : Math.cos(angle) * 1.5,
          vy: c.vy !== undefined ? c.vy : Math.sin(angle) * 1.5,
          hp: c.hp,
          maxHp: c.maxHp,
          speed: c.speed,
          radius: c.radius,
          sides: c.sides,
          hue: c.hue,
          score: c.score,
          xp: c.xp,
          rotation: Math.random() * Math.PI * 2,
          vRot: c.vRot,
          hitFlash: 0,
          trail: [],
          absorbed: c.absorbed || 0,
          isBoss: !!c.isBoss,
          pulsePhase: Math.random() * Math.PI * 2
        });
        grid.applyImpulse(sp.x, sp.y, 12, 65, c.hue);
        this.spawnIndicators.splice(i, 1);
      }
    }

    const enemies = this.enemies;
    const len = enemies.length;

    // 2. Update active enemies with emergent behaviors
    for (let i = 0; i < len; i++) {
      const e = enemies[i];
      e.rotation += e.vRot;
      e.pulsePhase += dt * 6;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6);

      const dxPlayer = player.x - e.x;
      const dyPlayer = player.y - e.y;
      const distPlayer = Math.hypot(dxPlayer, dyPlayer) || 1;
      const dirX = dxPlayer / distPlayer;
      const dirY = dyPlayer / distPlayer;

      if (e.type === 'swarmer') {
        // Boids Flocking: Separation + Alignment + Cohesion + Player Seek
        let sepX = 0, sepY = 0;
        let alignX = 0, alignY = 0;
        let cohX = 0, cohY = 0;
        let neighbors = 0;

        // Sample nearby enemies for fast O(N) bounded flocking
        const step = len > 90 ? 2 : 1;
        for (let j = i % step; j < len; j += step) {
          if (i === j) continue;
          const other = enemies[j];
          const ox = other.x - e.x;
          const oy = other.y - e.y;
          const dSq = ox * ox + oy * oy;
          if (dSq < 6400 && dSq > 0.01) { // within 80px
            const d = Math.sqrt(dSq);
            if (d < 28) {
              sepX -= (ox / d) * (28 - d) * 0.12;
              sepY -= (oy / d) * (28 - d) * 0.12;
            }
            if (other.type === 'swarmer') {
              alignX += other.vx;
              alignY += other.vy;
              cohX += other.x;
              cohY += other.y;
              neighbors++;
            }
          }
        }

        let steerX = dirX * 0.42 + sepX;
        let steerY = dirY * 0.42 + sepY;

        if (neighbors > 0) {
          alignX /= neighbors;
          alignY /= neighbors;
          cohX = cohX / neighbors - e.x;
          cohY = cohY / neighbors - e.y;
          const cohLen = Math.hypot(cohX, cohY) || 1;
          steerX += alignX * 0.08 + (cohX / cohLen) * 0.14;
          steerY += alignY * 0.08 + (cohY / cohLen) * 0.14;
        }

        // Sinusoidal swarm swirl
        const swirl = Math.sin(e.pulsePhase * 0.7 + i) * 0.22;
        steerX += -dirY * swirl;
        steerY += dirX * swirl;

        e.vx = (e.vx + steerX) * 0.92;
        e.vy = (e.vy + steerY) * 0.92;
      } else if (e.type === 'weaver') {
        // Emerald Weaver: dodges incoming player bullets!
        let dodgeX = 0;
        let dodgeY = 0;
        for (let bIdx = 0; bIdx < bullets.length; bIdx++) {
          const b = bullets[bIdx];
          const bx = e.x - b.x;
          const by = e.y - b.y;
          const dSq = bx * bx + by * by;
          if (dSq < 14400) { // within 120px
            // Check if bullet is heading toward weaver
            const dot = bx * b.vx + by * b.vy;
            if (dot > 0) {
              // Perpendicular dodge vector
              const cross = bx * b.vy - by * b.vx;
              const sign = cross >= 0 ? 1 : -1;
              const bSpd = Math.hypot(b.vx, b.vy) || 1;
              dodgeX += (-b.vy / bSpd) * sign * 1.35;
              dodgeY += (b.vx / bSpd) * sign * 1.35;
            }
          }
        }
        e.vx = (e.vx + dirX * 0.45 + dodgeX) * 0.88;
        e.vy = (e.vy + dirY * 0.45 + dodgeY) * 0.88;
        e.rotation = Math.atan2(e.vy, e.vx);
      } else if (e.type === 'blackhole') {
        // Crimson Gravity Well: warps the grid inward & pulls nearby enemies/sparks
        e.vx = (e.vx + dirX * 0.12) * 0.94;
        e.vy = (e.vy + dirY * 0.12) * 0.94;
        const pullRadius = 185 + e.absorbed * 12;
        grid.applyImplosion(e.x, e.y, 14 + e.absorbed * 2, pullRadius, 348, 0.35);
        particles.applyGravityWell(e.x, e.y, 1.4, pullRadius);

        // Gently tug nearby non-blackhole enemies into orbit
        for (let j = 0; j < len; j++) {
          if (i === j) continue;
          const other = enemies[j];
          if (other.type === 'blackhole' || other.isBoss) continue;
          const gx = e.x - other.x;
          const gy = e.y - other.y;
          const gdSq = gx * gx + gy * gy;
          if (gdSq < pullRadius * pullRadius && gdSq > 25) {
            const gd = Math.sqrt(gdSq);
            other.vx += (gx / gd) * 0.25;
            other.vy += (gy / gd) * 0.25;
          }
        }
      } else {
        // Pinwheels, Splitters, Mini-Splitters, Bosses
        let softSepX = 0, softSepY = 0;
        for (let j = 0; j < len; j += 2) {
          if (i === j) continue;
          const other = enemies[j];
          const ox = e.x - other.x;
          const oy = e.y - other.y;
          const minD = e.radius + other.radius + 6;
          const dSq = ox * ox + oy * oy;
          if (dSq < minD * minD && dSq > 0.1) {
            const d = Math.sqrt(dSq);
            softSepX += (ox / d) * 0.35;
            softSepY += (oy / d) * 0.35;
          }
        }
        e.vx = (e.vx + dirX * 0.32 + softSepX) * 0.91;
        e.vy = (e.vy + dirY * 0.32 + softSepY) * 0.91;

        if (e.isBoss && Math.sin(e.pulsePhase) > 0.92) {
          grid.applyImpulse(e.x, e.y, 10, 120, e.hue);
        }
      }

      // Normalize max speed
      const curSpd = Math.hypot(e.vx, e.vy);
      if (curSpd > e.speed) {
        e.vx = (e.vx / curSpd) * e.speed;
        e.vy = (e.vy / curSpd) * e.speed;
      }

      e.x += e.vx;
      e.y += e.vy;

      // Arena wall bounce
      const pad = e.radius + 8;
      if (e.x < pad) { e.x = pad; e.vx *= -0.8; }
      if (e.x > width - pad) { e.x = width - pad; e.vx *= -0.8; }
      if (e.y < pad) { e.y = pad; e.vy *= -0.8; }
      if (e.y > height - pad) { e.y = height - pad; e.vy *= -0.8; }

      // Save short neon ribbon trail for fast movers
      if (e.type === 'swarmer' || e.type === 'weaver' || e.type === 'mini_splitter') {
        e.trail.push({ x: e.x, y: e.y });
        if (e.trail.length > 6) e.trail.shift();
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1. Draw Materializing Spawn Rings
    for (let i = 0; i < this.spawnIndicators.length; i++) {
      const sp = this.spawnIndicators[i];
      const t = 1 - sp.timer / sp.maxTimer;
      const r = sp.config.radius * (2.6 - t * 1.6);
      ctx.strokeStyle = `hsla(${sp.config.hue}, 100%, 65%, ${t * 0.85})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Draw Enemies
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const pulse = 1 + Math.sin(e.pulsePhase) * 0.08;
      const r = e.radius * pulse;
      const color = e.hitFlash > 0
        ? '#ffffff'
        : `hsl(${e.hue}, 100%, 62%)`;
      const glowColor = `hsla(${e.hue}, 100%, 55%, 0.42)`;

      // Ribbon Trail
      if (e.trail.length > 1) {
        ctx.strokeStyle = `hsla(${e.hue}, 100%, 60%, 0.28)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.trail[0].x, e.trail[0].y);
        for (let t = 1; t < e.trail.length; t++) {
          ctx.lineTo(e.trail[t].x, e.trail[t].y);
        }
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rotation);

      // Outer soft glow pass + inner crisp vector pass
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? glowColor : color;
        ctx.lineWidth = pass === 0 ? 5.5 : 2.2;

        ctx.beginPath();
        if (e.type === 'swarmer') {
          // Sleek elongated diamond
          ctx.moveTo(r * 1.25, 0);
          ctx.lineTo(0, r * 0.78);
          ctx.lineTo(-r * 1.25, 0);
          ctx.lineTo(0, -r * 0.78);
          ctx.closePath();
        } else if (e.type === 'pinwheel') {
          // Square + inner pinwheel blades
          ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
          ctx.moveTo(-r * 0.8, -r * 0.8);
          ctx.lineTo(r * 0.8, r * 0.8);
          ctx.moveTo(r * 0.8, -r * 0.8);
          ctx.lineTo(-r * 0.8, r * 0.8);
        } else if (e.type === 'weaver') {
          // Sharp dart arrowhead
          ctx.moveTo(r * 1.3, 0);
          ctx.lineTo(-r, -r * 0.95);
          ctx.lineTo(-r * 0.45, 0);
          ctx.lineTo(-r, r * 0.95);
          ctx.closePath();
        } else if (e.type === 'blackhole') {
          // Pulsing event horizon circle + inner accretion ring
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.moveTo(r * 0.55, 0);
          ctx.arc(0, 0, r * 0.55, 0, Math.PI * 1.5);
        } else {
          // Regular Polygon (Splitter Hexagon, Mini Triangle, Boss Octagon)
          for (let s = 0; s < e.sides; s++) {
            const a = (s * Math.PI * 2) / e.sides;
            const vx = Math.cos(a) * r;
            const vy = Math.sin(a) * r;
            if (s === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
          }
          ctx.closePath();

          // Inner sacred geometry detail for Splitters and Bosses
          if (e.type === 'splitter' || e.isBoss) {
            const innerR = r * 0.55;
            for (let s = 0; s < e.sides; s++) {
              const a = -e.rotation * 2 + (s * Math.PI * 2) / e.sides;
              const vx = Math.cos(a) * innerR;
              const vy = Math.sin(a) * innerR;
              if (s === 0) ctx.moveTo(vx, vy);
              else ctx.lineTo(vx, vy);
            }
            ctx.closePath();
          }
        }
        ctx.stroke();
      }

      ctx.restore();

      // Boss HP bar floating above polyhedron
      if (e.isBoss) {
        const bw = 56;
        const bh = 5;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(e.x - bw * 0.5, e.y - e.radius - 14, bw, bh);
        ctx.fillStyle = '#00f3ff';
        ctx.fillRect(e.x - bw * 0.5, e.y - e.radius - 14, bw * Math.max(0, e.hp / e.maxHp), bh);
      }
    }

    ctx.restore();
  }
}
