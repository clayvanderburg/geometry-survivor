// Geometric Enemy Archetypes & Emergent Boids Swarm Intelligence
import { TUNING } from './config.js';
import { SpatialIndex } from './spatial-index.js';
import { GRAVITY_DRIFT_DRAG, wellPullScale } from './gravity.js';
import { EnemyBulletPool } from './enemy-bullets.js';
import {
  archetypeStats, updateArchetype, speedCap, traceArchetype, drawArchetypeOverlay, drawConduitLinks, isArchetype, SHIELDER
} from './archetypes.js';
import { applyLieutenant, drawLieutenantAura, drawLieutenantBar, drawLieutenantTelegraph } from './lieutenants.js';

export const BOSS_NAME = 'PRISMATIC DREADNOUGHT';
const BOSS_TELEGRAPH_RADIUS = 150;
const CHILL_GLOW = 'rgba(120, 225, 255, 0.75)';

// --- Difficulty ramp (TUNING "Difficulty Ramp" group) ------------------------------------------
// Enemy HP scale of a wave (bosses and lieutenants included; speed caps also read it):
// (waveHpStart + waveHpPerWave·(w−1)) · waveHpGrowth^(w − waveHpGrowthFrom), compounding only past that wave.
export function waveScaleAt(wave) {
  const start = TUNING.waveHpStart ?? 1;
  const perWave = TUNING.waveHpPerWave ?? 0.25;
  const growth = TUNING.waveHpGrowth ?? 1.09;
  const from = TUNING.waveHpGrowthFrom ?? 6;
  return (start + (wave - 1) * perWave) * Math.pow(growth, Math.max(0, wave - from));
}

// Contact and plasma-orb damage multiplier of a wave: damageRampBase, plus damageRampPerWave per wave
// after damageRampFrom.
export function damageRampAt(wave) {
  return (TUNING.damageRampBase ?? 1) + Math.max(0, wave - (TUNING.damageRampFrom ?? 5)) * (TUNING.damageRampPerWave ?? 0.08);
}

// XP carried by a kill at a given wave: the enemy's base XP × (1 + xpPerWave·(w−1)).
export function xpScaleAt(wave) {
  return 1 + Math.max(0, wave - 1) * (TUNING.xpPerWave ?? 0);
}

// Seconds between wave packs: spawnIntervalStart − spawnIntervalPerWave·w, never below spawnIntervalMin.
export function spawnIntervalAt(wave) {
  return Math.max(TUNING.spawnIntervalMin ?? 0.75, (TUNING.spawnIntervalStart ?? 2.6) - wave * (TUNING.spawnIntervalPerWave ?? 0.14));
}

// Head count of a wave pack after the global pack-size multiplier (at least one).
export function packSize(count) {
  return Math.max(1, Math.round(count * (TUNING.packSizeMult ?? 1)));
}

// Contact damage of a hull touching the ship at a given wave (bosses hit harder).
export function contactDamageAt(e, wave) {
  return (e.isBoss ? 38 : 18 * (e.contactMult || 1)) * damageRampAt(wave);
}

// Per-tick decay of hit knockback displacement (fixed 60 Hz): total travel ≈ impulse × 5.
export const KNOCKBACK_DECAY = 0.8;

export class EnemyManager {
  constructor({ maxEnemies = 200 } = {}) {
    const budget = Number(maxEnemies);
    this.maxEnemies = Number.isFinite(budget) ? Math.max(1, Math.floor(budget)) : 200;
    this.enemyIndex = new SpatialIndex(128);
    this.bulletIndex = new SpatialIndex(128);
    this.enemies = [];
    this.spawnIndicators = [];
    // Bosses that materialized this tick; the game drains this to stage their entrance.
    this.bossArrivals = [];
    this.lieutenantArrivals = [];
    // Gunner plasma orbs (pooled). The game moves them and resolves hits against the ship.
    this.enemyBullets = new EnemyBulletPool();
    // Optional terrain (AsteroidManager) so blinkers never land inside rock; null in unit tests.
    this.terrain = null;
    // One reused scratch object handed to archetype AI each tick (no per-enemy allocation).
    this.aiEnv = { player: null, dirX: 0, dirY: 0, dist: 0, dt: 0, sepX: 0, sepY: 0, grid: null, particles: null, width: 0, height: 0 };
  }

  clear() {
    this.enemyIndex.rebuild([]);
    this.bulletIndex.rebuild([]);
    this.enemies = [];
    this.spawnIndicators = [];
    this.bossArrivals = [];
    this.lieutenantArrivals = [];
    this.enemyBullets.clear();
  }

  // Queue an enemy with a brief neon materialization warning ring (Geometry Wars style).
  // `extra.warmup` lengthens the ring into a telegraph; the slot is reserved for its whole duration.
  queueSpawn(type, x, y, waveScale = 1, extra = {}) {
    if (this.enemies.length + this.spawnIndicators.length >= this.maxEnemies) return false;
    const config = this.getArchetype(type, waveScale, extra);
    const hpMult = TUNING.enemyHpMult ?? 1.0;
    const spdMult = TUNING.enemySpeedMult ?? 1.0;
    config.hp *= hpMult;
    config.maxHp *= hpMult;
    config.speed *= spdMult;
    config.speedScale = (config.speedScale || 1) * spdMult;
    this.spawnIndicators.push({
      type,
      x,
      y,
      config,
      timer: extra.instant ? 0.02 : (extra.warmup ?? 0.55),
      maxTimer: extra.warmup ?? 0.55
    });
    return true;
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
    if (extra.lieutenant) {
      return applyLieutenant(this.getArchetype(type, waveScale), extra.lieutenant, this.getArchetype('boss', waveScale).maxHp);
    }
    if (isArchetype(type)) return archetypeStats(type, waveScale);
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
        // Softened (balance report: splitters caused most deaths): lighter contact hit, a touch slower.
        return {
          hp: 14 * waveScale,
          maxHp: 14 * waveScale,
          speed: 3.8,
          contactMult: 0.6,
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
          vRot: 0.04
        };
      case 'boss':
        return {
          hp: 650 * waveScale * (TUNING.bossHpMult ?? 1),
          maxHp: 650 * waveScale * (TUNING.bossHpMult ?? 1),
          speed: 1.35,
          radius: 36,
          sides: 8,
          hue: 185, // Prismatic Cyan/Gold
          score: 1500,
          xp: 30,
          vRot: 0.03,
          isBoss: true,
          name: extra.name || BOSS_NAME,
          epithet: extra.epithet || ''
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
        const spawned = {
          type: sp.type,
          x: sp.x,
          y: sp.y,
          vx: c.vx !== undefined ? c.vx : Math.cos(angle) * 1.5,
          vy: c.vy !== undefined ? c.vy : Math.sin(angle) * 1.5,
          gvx: 0, // External gravity drift (black holes / singularities), applied past the speed cap
          gvy: 0,
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
          knockX: 0,
          knockY: 0,
          dmgNum: null, // last floating damage number (DamageNumbers fast path)
          trail: [],
          isBoss: !!c.isBoss,
          name: c.name || null,
          epithet: c.epithet || null,
          pulsePhase: Math.random() * Math.PI * 2,
          // Archetype AI + lieutenant state (see archetypes.js / lieutenants.js); inert for legacy types.
          state: sp.type === 'gunner' ? 'idle' : sp.type === 'blinker' ? 'drift' : 'advance',
          aiTimer: 1 + Math.random() * 1.5,
          aimAngle: angle,
          strafeSign: Math.random() < 0.5 ? -1 : 1,
          speedScale: c.speedScale || 1,
          burstSpeed: 0,
          knockMult: c.knockMult ?? 1,
          baseKnockMult: c.knockMult ?? 1,
          contactMult: c.contactMult || 1,
          sturdy: !!c.sturdy,
          armor: c.armor || 0,
          cadence: c.cadence || 1,
          regen: c.regen || 0,
          splits: c.splits || 0,
          volley: c.volley || 1,
          shieldArc: c.shieldArc || 0,
          shieldAngle: angle,
          shieldRadius: c.radius + SHIELDER.plateGap,
          shieldFlash: 0,
          linked: 0,
          links: [],
          sinceHit: 99,
          blinkX: 0,
          blinkY: 0,
          isLieutenant: !!c.isLieutenant,
          mods: c.mods || null
        };
        this.enemies.push(spawned);
        if (spawned.isBoss) this.bossArrivals.push(spawned);
        else if (spawned.isLieutenant) this.lieutenantArrivals.push(spawned);
        grid.applyImpulse(sp.x, sp.y, 12, 65, c.hue);
        this.spawnIndicators.splice(i, 1);
      }
    }

    const enemies = this.enemies;
    const len = enemies.length;
    this.enemyIndex.rebuild(enemies);
    this.bulletIndex.rebuild(bullets);
    const enemyOrder = new Map(enemies.map((enemy, index) => [enemy, index]));
    const maxRadius = enemies.reduce((max, enemy) => Math.max(max, enemy.radius), 0);
    const env = this.aiEnv;
    env.player = player;
    env.dt = dt;
    env.grid = grid;
    env.particles = particles;
    env.width = width;
    env.height = height;

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

      env.dirX = dirX;
      env.dirY = dirY;
      env.dist = distPlayer;
      if (isArchetype(e.type)) this.softSeparation(e, i, enemyOrder, maxRadius, env);
      if (updateArchetype(e, this, env)) {
        // Driven by archetypes.js (Bruiser, Gunner, Shielder, Blinker, Conduit).
      } else if (e.type === 'swarmer') {
        // Boids Flocking: Separation + Alignment + Cohesion + Player Seek
        let sepX = 0, sepY = 0;
        let alignX = 0, alignY = 0;
        let cohX = 0, cohY = 0;
        let neighbors = 0;

        // Query only nearby enemies while retaining the original sampling parity.
        const step = len > 90 ? 2 : 1;
        for (const other of this.enemyIndex.query(e.x, e.y, 80)) {
          const j = enemyOrder.get(other);
          if (i === j || j % step !== i % step) continue;
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
        for (const b of this.bulletIndex.query(e.x, e.y, 120)) {
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
        // Crimson Gravity Well: pulls nearby enemies/sparks (grid funnel, ship, bullet & geom pulls live in Game)
        e.vx = (e.vx + dirX * 0.12) * 0.94;
        e.vy = (e.vy + dirY * 0.12) * 0.94;
        const pullRadius = TUNING.blackholePullRadius ?? 200;
        const enemyPull = TUNING.blackholeEnemyPull ?? 0.45;
        particles.applyGravityWell(e.x, e.y, 1.4, pullRadius);

        // Drag nearby non-blackhole enemies into a swirling orbit (drift bypasses their speed cap)
        for (const other of this.enemyIndex.query(e.x, e.y, pullRadius)) {
          if (e === other) continue;
          if (other.type === 'blackhole' || other.isBoss) continue;
          const gx = e.x - other.x;
          const gy = e.y - other.y;
          const k = wellPullScale(gx, gy, pullRadius, enemyPull, e.radius);
          other.gvx = (other.gvx || 0) + (gx - gy * 0.3) * k;
          other.gvy = (other.gvy || 0) + (gy + gx * 0.3) * k;
        }
      } else {
        // Pinwheels, Splitters, Mini-Splitters, Bosses
        let softSepX = 0, softSepY = 0;
        for (const other of this.enemyIndex.query(e.x, e.y, e.radius + maxRadius + 6)) {
          const j = enemyOrder.get(other);
          if (i === j) continue;
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

      // Normalize max speed (a Bruiser charge raises the cap; Conduit links add haste;
      // CHILL lowers it through speedScale, see status-effects.js)
      const cap = speedCap(e) * (e.speedScale ?? 1);
      const curSpd = Math.hypot(e.vx, e.vy);
      if (curSpd > cap) {
        e.vx = (e.vx / curSpd) * cap;
        e.vy = (e.vy / curSpd) * cap;
      }

      // Gravity drift rides on top of the capped steering, then bleeds off.
      const gvx = e.gvx || 0;
      const gvy = e.gvy || 0;
      e.x += e.vx + gvx;
      e.y += e.vy + gvy;
      e.gvx = gvx * GRAVITY_DRIFT_DRAG;
      e.gvy = gvy * GRAVITY_DRIFT_DRAG;

      // Hit knockback is a separate decaying displacement, so it is not erased by the speed clamp
      // above and never feeds back into flocking velocity (swarms flinch, then keep flowing).
      if (e.knockX || e.knockY) {
        e.x += e.knockX;
        e.y += e.knockY;
        e.knockX *= KNOCKBACK_DECAY;
        e.knockY *= KNOCKBACK_DECAY;
        if (Math.abs(e.knockX) + Math.abs(e.knockY) < 0.02) e.knockX = e.knockY = 0;
      }

      // Arena wall bounce
      const pad = e.radius + 8;
      if (e.x < pad) { e.x = pad; e.vx *= -0.8; }
      if (e.x > width - pad) { e.x = width - pad; e.vx *= -0.8; }
      if (e.y < pad) { e.y = pad; e.vy *= -0.8; }
      if (e.y > height - pad) { e.y = height - pad; e.vy *= -0.8; }

      this.enemyIndex.update(e);

      // Save short neon ribbon trail for fast movers (and charging / hasted elites)
      if (e.type === 'swarmer' || e.type === 'weaver' || e.type === 'mini_splitter' || e.burstSpeed > 0 || e.cadence > 1) {
        e.trail.push({ x: e.x, y: e.y });
        if (e.trail.length > 6) e.trail.shift();
      } else if (e.trail.length) {
        e.trail.length = 0; // a finished charge drops its ribbon
      }
    }
  }

  // Soft hull-to-hull separation for the archetypes in archetypes.js (written into env.sepX/sepY).
  softSeparation(e, i, enemyOrder, maxRadius, env) {
    let sx = 0;
    let sy = 0;
    for (const other of this.enemyIndex.query(e.x, e.y, e.radius + maxRadius + 6)) {
      if (enemyOrder.get(other) === i) continue;
      const ox = e.x - other.x;
      const oy = e.y - other.y;
      const minD = e.radius + other.radius + 6;
      const dSq = ox * ox + oy * oy;
      if (dSq < minD * minD && dSq > 0.1) {
        const d = Math.sqrt(dSq);
        sx += (ox / d) * 0.35;
        sy += (oy / d) * 0.35;
      }
    }
    env.sepX = sx;
    env.sepY = sy;
  }

  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    const visible = (x, y, r) => x + r >= camX && y + r >= camY && x - r <= camX + viewW && y - r <= camY + viewH;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1. Draw Materializing Spawn Rings
    for (let i = 0; i < this.spawnIndicators.length; i++) {
      const sp = this.spawnIndicators[i];
      if (sp.config.isBoss) {
        if (visible(sp.x, sp.y, BOSS_TELEGRAPH_RADIUS + 10)) this.drawBossTelegraph(ctx, sp);
        continue;
      }
      if (sp.config.isLieutenant) {
        if (visible(sp.x, sp.y, sp.config.radius * 3.6 + 10)) drawLieutenantTelegraph(ctx, sp);
        continue;
      }
      if (!visible(sp.x, sp.y, sp.config.radius * 2.6 + 4)) continue;
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
      const padding = e.type === 'blackhole' ? (TUNING.blackholePullRadius ?? 200) + 4
        : e.type === 'conduit' ? 250
        : e.type === 'bruiser' && e.state === 'windup' ? 300
        : e.type === 'blinker' && e.state === 'telegraph' ? 280
        : e.type === 'gunner' && e.state === 'aim' ? 190
        : e.radius * (e.isBoss || e.isLieutenant ? 2.2 : 1.4) + 24;
      if (!visible(e.x, e.y, padding) && !e.trail.some(point => visible(point.x, point.y, 4))) continue;
      // Hit pop: the hull swells briefly with the white flash so every connecting shot reads.
      const pulse = 1 + Math.sin(e.pulsePhase) * 0.08 + e.hitFlash * 0.14;
      const r = e.radius * pulse;
      // Chilled hulls frost over until the slow wears off: an ice-blue glow around a pale
      // version of their own hue, so the archetype stays recognisable.
      const chilled = e.st && e.st.chillT > 0;
      const color = e.hitFlash > 0
        ? '#ffffff'
        : chilled ? `hsl(${e.hue}, 70%, 82%)` : `hsl(${e.hue}, 100%, 62%)`;
      const glowColor = chilled ? CHILL_GLOW : `hsla(${e.hue}, 100%, 55%, 0.42)`;

      // Ribbon Trail
      // Tapered ribbon: fades toward the tail, brightest at the enemy.
      for (let t = 1; t < e.trail.length; t++) {
        const k = t / (e.trail.length - 1);
        ctx.strokeStyle = `hsla(${e.hue}, 100%, ${58 + k * 10}%, ${0.1 + k * 0.32})`;
        ctx.lineWidth = 1.2 + k * 1.6;
        ctx.beginPath();
        ctx.moveTo(e.trail[t - 1].x, e.trail[t - 1].y);
        ctx.lineTo(e.trail[t].x, e.trail[t].y);
        ctx.stroke();
      }

      if (e.type === 'blackhole') this.drawBlackholeAura(ctx, e, r);
      if (e.type === 'conduit') drawConduitLinks(ctx, e);

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
        } else if (isArchetype(e.type)) {
          traceArchetype(ctx, e, r);
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

      drawArchetypeOverlay(ctx, e, r);
      if (e.isLieutenant) {
        drawLieutenantAura(ctx, e, r);
        drawLieutenantBar(ctx, e, r);
      }
      if (e.isBoss) this.drawBossAura(ctx, e, r);

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

    // Hostile plasma orbs ride above the hulls so they are never hidden by a crowd.
    this.enemyBullets.draw(ctx, camX, camY, viewW, viewH);

    ctx.restore();
  }

  // Accretion disc, photon ring and a faint dashed rim marking where the pull starts (no gradients).
  drawBlackholeAura(ctx, e, r) {
    const pullRadius = TUNING.blackholePullRadius ?? 200;
    const spin = e.pulsePhase * 0.3;
    ctx.save();
    ctx.translate(e.x, e.y);

    // Pull rim: 24 slowly crawling dash arcs in one path (cheaper than setLineDash on a big circle)
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 66%, 0.34)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const dashStep = (Math.PI * 2) / 24;
    for (let k = 0; k < 24; k++) {
      const a0 = k * dashStep + spin * 0.12;
      ctx.moveTo(Math.cos(a0) * pullRadius, Math.sin(a0) * pullRadius);
      ctx.arc(0, 0, pullRadius, a0, a0 + dashStep * 0.35);
    }
    ctx.stroke();

    // Two tilted, counter-rotating accretion ellipses: hot orange inside, crimson outside
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = k === 0 ? 'hsla(22, 100%, 62%, 0.6)' : `hsla(${e.hue}, 100%, 66%, 0.42)`;
      ctx.lineWidth = k === 0 ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (2.05 + k * 0.55), r * (0.6 + k * 0.22), k === 0 ? spin : -spin * 0.7 + 1.1, 0, Math.PI * 2);
      ctx.stroke();
    }

    // White-hot photon ring hugging the event horizon
    ctx.strokeStyle = 'rgba(255, 236, 242, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Warning telegraph at a reserved boss spawn: a hazard ring that closes in on the point while
  // a gold core swells, flashing faster as arrival nears. Driven by the sim timer, not wall time.
  drawBossTelegraph(ctx, sp) {
    const t = Math.max(0, Math.min(1, 1 - sp.timer / sp.maxTimer));
    const flash = 0.5 + 0.5 * Math.cos(sp.timer * Math.PI * (5 + t * 7));
    const ringR = BOSS_TELEGRAPH_RADIUS * (1 - t * 0.62);
    const spin = sp.timer * 1.6;

    ctx.lineWidth = 4;
    ctx.strokeStyle = `hsla(${flash > 0.5 ? 348 : 48}, 100%, 60%, ${0.45 + flash * 0.45})`;
    for (let s = 0; s < 10; s++) {
      const a = spin + (s * Math.PI * 2) / 10;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, ringR, a, a + 0.36);
      ctx.stroke();
    }

    // Crosshair ticks lock onto the arrival point.
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 42, 85, ${0.35 + flash * 0.4})`;
    ctx.beginPath();
    for (let s = 0; s < 4; s++) {
      const a = -spin * 0.5 + (s * Math.PI) / 2;
      const c = Math.cos(a), d = Math.sin(a);
      ctx.moveTo(sp.x + c * (ringR + 10), sp.y + d * (ringR + 10));
      ctx.lineTo(sp.x + c * (ringR * 0.45), sp.y + d * (ringR * 0.45));
    }
    ctx.stroke();

    const coreR = sp.config.radius * (0.25 + t * 0.85);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `hsla(48, 100%, 65%, ${0.35 + t * 0.6})`;
    ctx.beginPath();
    for (let s = 0; s < 8; s++) {
      const a = spin * 2 + (s * Math.PI) / 4;
      if (s === 0) ctx.moveTo(sp.x + Math.cos(a) * coreR, sp.y + Math.sin(a) * coreR);
      else ctx.lineTo(sp.x + Math.cos(a) * coreR, sp.y + Math.sin(a) * coreR);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Boss silhouette: a counter-rotating gold spike crown and a broken magenta halo around the
  // cyan octagon, so a boss reads instantly against the regular polygons.
  drawBossAura(ctx, e, r) {
    const crown = -e.rotation * 1.5;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'hsla(48, 100%, 62%, 0.9)';
    ctx.beginPath();
    for (let s = 0; s < 8; s++) {
      const a = crown + (s * Math.PI * 2) / 8;
      const a0 = a - 0.16, a1 = a + 0.16;
      ctx.moveTo(e.x + Math.cos(a0) * r * 1.16, e.y + Math.sin(a0) * r * 1.16);
      ctx.lineTo(e.x + Math.cos(a) * r * 1.62, e.y + Math.sin(a) * r * 1.62);
      ctx.lineTo(e.x + Math.cos(a1) * r * 1.16, e.y + Math.sin(a1) * r * 1.16);
    }
    ctx.stroke();

    const halo = e.rotation * 0.6;
    const haloR = r * (1.95 + Math.sin(e.pulsePhase * 0.5) * 0.06);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `hsla(325, 100%, 62%, ${0.45 + Math.sin(e.pulsePhase) * 0.15})`;
    for (let s = 0; s < 6; s++) {
      const a = halo + (s * Math.PI * 2) / 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, haloR, a, a + 0.62);
      ctx.stroke();
    }
  }
}
