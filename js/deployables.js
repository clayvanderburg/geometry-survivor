// Deployables: Proximity Mines, Sentry Turrets and Escort Drones.
// Every unit lives in a fixed pool (nothing is allocated while placing or simulating them) and is
// simulated only from Game.update, so pause, hit-stop and slow-mo freeze them with the rest of the
// world. They are not enemies and never enter the enemy list, so they don't count toward the enemy
// cap. Per-level numbers come from WEAPON_SCALING (the formulas the upgrade cards preview), and all
// damage goes through Game.hitEnemy: turret/drone bolts ride the shared bullet sweep (asteroid
// cover blocks them), mine bursts use Game.damageEnemiesInRadius.
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, mineBlastRadius, siegeShellRadius, TURRET_MAX_ACTIVE } from './weapon-scaling.js';
import { weaponBuild, levelBuild } from './weapon-levels.js';

export const DEPLOYABLE_HUES = { mine: 8, turret: 208, drone: 82 };

const MINE_POOL = 36;   // >= W.mineMaxActive at max level (capacity 11, x3 with Minefield Triad)
const TURRET_POOL = TURRET_MAX_ACTIVE; // >= W.turretMaxActive at max level
const DRONE_POOL = 4;   // W.droneCount: up to 3, plus 1 with the Extra Wingman Breakthrough
const TRAIL_LEN = 9;    // drone thruster trail samples (one per tick)
const RETARGET_TIME = 0.2;       // seconds between nearest-target searches per turret/drone
const LOS_CANDIDATES = 3;        // nearest targets tried before giving up on a blocked line of sight
const TURRET_TURN_RATE = 9;      // barrel slew, rad/s
const TURRET_AIM_TOLERANCE = 0.3;
// Sentry turret size: the body is drawn at TURRET_SCALE x its unit geometry (hex 11, ring 19, barrel
// 17), and every size-dependent distance (muzzle, rock clearance, spacing, sidesteps, view pad and
// deploy/expire rings) scales with it.
export const TURRET_SCALE = 2;
const TURRET_MUZZLE_UNIT = 17;   // barrel length in unit geometry (drawn under the scale)
const TURRET_MUZZLE = TURRET_MUZZLE_UNIT * TURRET_SCALE; // world px from the turret centre to where bolts spawn
const TURRET_BOLT_RADIUS = 3.3;
export const TURRET_BASE = 14 * TURRET_SCALE;    // base hex radius plus a little clearance from rock surfaces
export const TURRET_SPACING = 34 * TURRET_SCALE; // a new turret never sits closer than this to a live one
const SIDESTEPS = [38, -38, 76, -76, 114, -114].map((v) => v * TURRET_SCALE); // sideways offsets tried when the ship's spot is taken
const DRONE_BOLT_RADIUS = 2.6;
const MINE_KNOCK = 1.6;
const BOLT_KNOCK = 0.9;
// Formation slots (radians from the hull heading, radius scale): one drone trails directly behind,
// two fly a V off the rear quarters, the third closes the V behind them.
const DRONE_SLOTS = [[2.35, 1], [-2.35, 1], [Math.PI, 1.3], [Math.PI, 2.1]];

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Deployables never chase what can't die: Vortex portals (type 'blackhole') and anything invulnerable.
export function isDeployableTarget(e) {
  return !e.dead && e.type !== 'blackhole' && !e.invulnerable;
}

export class Deployables {
  constructor() {
    this.mines = Array.from({ length: MINE_POOL }, () => ({ x: 0, y: 0, age: 0, life: 0, trigger: 0, blast: 0, damage: 0, spin: 0, cluster: false, seeker: false }));
    this.turrets = Array.from({ length: TURRET_POOL }, () => ({ x: 0, y: 0, life: 0, maxLife: 0, aim: 0, fireAcc: 0, target: null, retarget: 0, flash: 0, mortarT: 0 }));
    this.drones = Array.from({ length: DRONE_POOL }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, angle: 0, fireAcc: 0, target: null, retarget: 0, flash: 0, podT: 0,
      trailX: new Float32Array(TRAIL_LEN), trailY: new Float32Array(TRAIL_LEN), trailHead: 0, trailCount: 0
    }));
    this.clear();
  }

  // Run reset: every unit gone, timers back to their opening delay.
  clear() {
    this.mineCount = 0;
    this.turretCount = 0;
    this.droneCount = 0;
    for (const t of this.turrets) t.target = null;
    for (const d of this.drones) { d.target = null; d.trailCount = 0; }
    this.mineTimer = 0.5;
    this.turretTimer = 0.8; // first plant of a run
    // Recharge timers of turret slots whose turret expired (a slot is ready again when its timer ends).
    this.turretRecharge = [];
    this.time = 0;
    this.maxRock = -1;
  }

  get activeCount() {
    return this.mineCount + this.turretCount + this.droneCount;
  }

  update(dt, game) {
    const w = game.player.weapons;
    if (!(w.mines || w.turret || w.drones) && this.activeCount === 0) return;
    this.time += dt;
    this.maxRock = -1; // recomputed lazily for this tick's line-of-sight checks
    // Each weapon's build (stat-card ranks + Breakthroughs), or null while it isn't equipped.
    const p = game.player;
    this.updateMines(dt, game, w.mines ? weaponBuild(p, 'mines') : null);
    this.updateTurrets(dt, game, w.turret ? weaponBuild(p, 'turret') : null);
    this.updateDrones(dt, game, w.drones ? weaponBuild(p, 'drones') : null);
  }

  // ---- Proximity Mines ----
  updateMines(dt, game, level) {
    if (level) {
      this.mineTimer -= dt;
      // At the active cap the timer stays primed, so a new mine drops as soon as a slot frees.
      if (this.mineTimer <= 0 && this.mineCount < Math.min(MINE_POOL, W.mineMaxActive(level))) {
        // Minefield Triad: three mines per drop, in a small triangle tossed toward the nearest enemy.
        const n = level.t12 ? W.triadCount : 1;
        const toward = level.t12 ? this.nearestMineTarget(game, game.player.x, game.player.y, W.triadRange) : null;
        for (let k = 0; k < n && this.mineCount < MINE_POOL; k++) this.dropMine(game.player, level, n > 1 ? k : -1, toward);
        game.sound?.playMineDrop?.();
        this.mineTimer = W.mineCooldown(level);
      }
    }
    const armTime = TUNING.mineArmTime ?? 0.6;
    const enemies = game.enemyManager.enemies;
    for (let i = this.mineCount - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.age += dt;
      let fire = m.age >= m.life;
      if (!fire && m.seeker && m.age >= armTime) this.crawlMine(game, m, dt);
      if (!fire && m.age >= armTime) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (!isDeployableTarget(e)) continue;
          const dx = e.x - m.x;
          const dy = e.y - m.y;
          const r = m.trigger + e.radius;
          if (dx * dx + dy * dy <= r * r) { fire = true; break; }
        }
      }
      if (fire) {
        // Swap-remove keeps live mines packed; `m` keeps its data until the slot is reused.
        this.mines[i] = this.mines[this.mineCount - 1];
        this.mines[--this.mineCount] = m;
        this.detonateMine(game, m);
      }
    }
  }

  // Mines drop in the ship's wake (behind its motion, or behind the turret when parked); Minefield Triad
  // tosses its triangle up to W.triadToss toward enemy `toward` instead (in the wake when there is none).
  dropMine(p, level, corner = -1, toward = null) {
    const moving = Math.hypot(p.vx, p.vy) > 0.5;
    const back = moving ? Math.atan2(-p.vy, -p.vx) : p.angle + Math.PI;
    const off = (p.radius || 15) + 12;
    const m = this.mines[this.mineCount++];
    if (toward) {
      const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
      const toss = Math.min(d, W.triadToss);
      m.x = p.x + ((toward.x - p.x) / d) * toss;
      m.y = p.y + ((toward.y - p.y) / d) * toss;
    } else {
      m.x = p.x + Math.cos(back) * off;
      m.y = p.y + Math.sin(back) * off;
    }
    if (corner >= 0) {
      const a = back + (corner * Math.PI * 2) / W.triadCount;
      m.x += Math.cos(a) * W.triadSpacing;
      m.y += Math.sin(a) * W.triadSpacing;
    }
    m.cluster = level.t4;
    m.seeker = level.t8;
    m.age = 0;
    m.life = W.mineLifetime(level);
    m.trigger = W.mineTriggerRadius(level);
    m.blast = mineBlastRadius(p, level);
    m.damage = weaponDamage(p, 'mine', level);
    m.spin = this.time * 1.7;
  }

  detonateMine(game, m) {
    const hue = DEPLOYABLE_HUES.mine;
    game.particles.spawnFlash?.(m.x, m.y, m.blast * 0.4, hue, 0.2);
    game.particles.spawnShockwave(m.x, m.y, m.blast, hue, 4, 0.42);
    game.particles.spawnShockwave(m.x, m.y, m.blast * 0.4, 40, 2.5, 0.24);
    game.particles.spawnExplosionSparks(m.x, m.y, 18, hue, 2, 10, 2.2);
    game.sound.playExplosion(0.7);
    game.damageEnemiesInRadius(m.x, m.y, m.blast, m.damage, hue, 'mine', MINE_KNOCK);
    // Cluster Mines: bomblets pop just after the main blast.
    if (m.cluster) game.weaponFx?.scatter(m.x, m.y, W.mineClusterBomblets, m.blast * 0.7, m.blast * 0.4, m.damage * W.mineClusterShare, W.mineClusterDelay, hue, 'mine');
  }

  // Nearest valid enemy within `range` of (x, y), or null.
  nearestMineTarget(game, x, y, range) {
    const enemies = game.enemyManager.enemies;
    let best = null;
    let bestSq = range * range;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!isDeployableTarget(e)) continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq < bestSq) { bestSq = dSq; best = e; }
    }
    return best;
  }

  // Seeker Mines: an armed mine crawls toward the nearest enemy in seekerRange.
  crawlMine(game, m, dt) {
    const best = this.nearestMineTarget(game, m.x, m.y, W.seekerRange);
    if (!best) return;
    const d = Math.hypot(best.x - m.x, best.y - m.y) || 1;
    const step = W.seekerSpeed * dt * 60;
    m.x += ((best.x - m.x) / d) * step;
    m.y += ((best.y - m.y) / d) * step;
  }

  // ---- Sentry Turrets ----
  updateTurrets(dt, game, level) {
    const p = game.player;
    if (level) {
      this.turretTimer -= dt;
      for (let k = this.turretRecharge.length - 1; k >= 0; k--) {
        this.turretRecharge[k] -= dt;
        if (this.turretRecharge[k] <= 0) this.turretRecharge.splice(k, 1);
      }
      // Ready turrets: the carried total minus those planted and those still recharging. Parked, they go
      // down in quick succession; on the move, one every turretDropMoving s.
      const ready = Math.min(TURRET_POOL, W.turretMaxActive(level)) - this.turretCount - this.turretRecharge.length;
      if (this.turretTimer <= 0 && ready > 0 && this.anyTargetNear(game, p.x, p.y, W.turretRange(level) * 1.5)) {
        this.deployTurret(game, level);
        const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.6;
        this.turretTimer = moving ? W.turretDropMoving : W.turretDropStill;
      }
    }
    // Live turrets fire at the player's current turret level, so an upgrade improves them at once.
    const lv = level || levelBuild('turret', 1); // turrets already planted keep firing after a discard
    const range = W.turretRange(lv);
    const rate = W.turretFireRate(lv);
    for (let i = this.turretCount - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.life -= dt;
      if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 9);
      if (t.life <= 0) {
        t.target = null;
        this.turrets[i] = this.turrets[this.turretCount - 1];
        this.turrets[--this.turretCount] = t;
        this.turretRecharge.push(W.turretCooldown(lv)); // its slot recharges before it can be planted again
        game.particles.spawnShockwave(t.x, t.y, 34 * TURRET_SCALE, DEPLOYABLE_HUES.turret, 2, 0.22, true);
        game.particles.spawnExplosionSparks(t.x, t.y, 8, DEPLOYABLE_HUES.turret, 1, 5, 1.6);
        continue;
      }
      // Mobile Sentries: drift after the ship into a ring around it, each turret at its own spot on the ring.
      if (lv.t8) this.followShip(t, i, p, dt);
      t.target = this.trackTarget(game, t, t.x, t.y, range, TURRET_BOLT_RADIUS, dt);
      const tgt = t.target;
      if (!tgt) {
        t.aim += dt * 0.9; // idle sweep
        t.fireAcc = Math.min(1, t.fireAcc + dt * rate);
        continue;
      }
      // Mortar Battery: a shell lobbed onto the target every mortarEvery s.
      if (lv.t12) {
        t.mortarT -= dt;
        if (t.mortarT <= 0) {
          t.mortarT += W.mortarEvery;
          game.weaponFx?.schedule({ x: tgt.x, y: tgt.y, fromX: t.x, fromY: t.y, delay: W.mortarDelay, radius: W.mortarRadius * (p.stats.areaMult ?? 1),
            damage: weaponDamage(p, 'turret', lv) * W.mortarDamageMult(lv) / W.turretDamageMult(lv), hue: DEPLOYABLE_HUES.turret, source: 'turret', style: 'mortar', knock: MINE_KNOCK, falloff: W.mortarFalloff });
        }
      }
      const want = Math.atan2(tgt.y - t.y, tgt.x - t.x);
      const diff = wrapAngle(want - t.aim);
      const step = TURRET_TURN_RATE * dt;
      t.fireAcc += dt * rate;
      if (Math.abs(diff) <= Math.max(step, TURRET_AIM_TOLERANCE)) {
        t.aim = want;
        while (t.fireAcc >= 1) {
          t.fireAcc -= 1;
          this.fireTurretBolt(game, t, lv);
        }
      } else {
        t.aim += Math.sign(diff) * step;
        t.fireAcc = Math.min(t.fireAcc, 1);
      }
    }
  }

  // Moves turret `t` (live index `i`) toward its spot on a ring around the ship, at turretFollowSpeed.
  followShip(t, i, p, dt) {
    const n = Math.max(1, this.turretCount);
    const a = (i / n) * Math.PI * 2 + (p.hullAngle ?? p.angle ?? 0) + Math.PI; // the ring trails behind
    const tx = p.x + Math.cos(a) * W.turretFollowRadius;
    const ty = p.y + Math.sin(a) * W.turretFollowRadius;
    const dx = tx - t.x, dy = ty - t.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const step = Math.min(d, W.turretFollowSpeed * dt);
    t.x += (dx / d) * step;
    t.y += (dy / d) * step;
  }

  deployTurret(game, level) {
    const p = game.player;
    const t = this.turrets[this.turretCount++];
    t.x = p.x;
    t.y = p.y;
    // Don't stack a new turret on a live one when the ship is parked: step sideways to the first
    // spot clear of turrets and rock (a turret inside a rock could never see a target). If none is
    // clear, stay under the ship.
    if (!this.turretSpotClear(game, t.x, t.y, this.turretCount - 1)) {
      const side = p.angle + Math.PI / 2;
      for (let k = 0; k < SIDESTEPS.length; k++) {
        const x = p.x + Math.cos(side) * SIDESTEPS[k];
        const y = p.y + Math.sin(side) * SIDESTEPS[k];
        if (this.turretSpotClear(game, x, y, this.turretCount - 1)) {
          t.x = x;
          t.y = y;
          break;
        }
      }
    }
    t.life = t.maxLife = W.turretDuration(level);
    t.aim = p.angle;
    t.fireAcc = 1;
    t.mortarT = W.mortarEvery;
    t.target = null;
    t.retarget = 0;
    t.flash = 0;
    game.particles.spawnShockwave(t.x, t.y, 48 * TURRET_SCALE, DEPLOYABLE_HUES.turret, 2.5, 0.25);
    game.grid.applyImpulse(t.x, t.y, 12, 70, DEPLOYABLE_HUES.turret);
  }

  // A turret spot is clear when no other live turret sits within TURRET_SPACING, it is inside the
  // arena, and no rock overlaps the turret base.
  turretSpotClear(game, x, y, others) {
    for (let i = 0; i < others; i++) {
      const o = this.turrets[i];
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < TURRET_SPACING * TURRET_SPACING) return false;
    }
    if (x < 30 || y < 30 || x > game.worldWidth - 30 || y > game.worldHeight - 30) return false;
    const am = game.asteroidManager;
    if (!am || !am.asteroids || am.asteroids.length === 0) return true;
    const rocks = am.getNearbyAsteroids(x, y, am.cellsFor ? am.cellsFor(TURRET_BASE) : 2);
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      const r = rock.radius + TURRET_BASE;
      if (rock.hp > 0 && (rock.x - x) ** 2 + (rock.y - y) ** 2 < r * r) return false;
    }
    return true;
  }

  fireTurretBolt(game, t, level) {
    const p = game.player;
    const damage = weaponDamage(p, 'turret', level);
    // Twin Barrels: two bolts side by side.
    const barrels = W.turretBarrels(level);
    for (let k = 0; k < barrels; k++) {
      const lateral = barrels > 1 ? (k === 0 ? -5 : 5) * TURRET_SCALE : 0;
      const ox = -Math.sin(t.aim) * lateral, oy = Math.cos(t.aim) * lateral;
      const b = this.fireBolt(game, t.x + ox, t.y + oy, t.aim, TURRET_MUZZLE, W.turretBoltSpeed, damage,
        DEPLOYABLE_HUES.turret, TURRET_BOLT_RADIUS, 'turret', W.turretRange(level));
      b.sweepX = t.x + ox; // the barrel is long; sweep from the turret centre so enemies sitting on it are hit
      b.sweepY = t.y + oy;
      if (p.weapons.siegeBattery) {
        b.blastRadius = siegeShellRadius(p);
        b.blastDamage = weaponDamage(p, 'siege', level);
        b.blastStat = 'siege'; // run stats: shell bursts are Siege Battery damage
        b.hue = 24; // amber-hot shells read as explosive
      }
    }
    t.flash = 1;
    if (game.sound.playTurretShot) game.sound.playTurretShot();
    else game.sound.playLaser(0.72);
  }

  // ---- Escort Drones ----
  updateDrones(dt, game, level) {
    const p = game.player;
    const want = level ? Math.min(DRONE_POOL, W.droneCount(level)) : 0;
    while (this.droneCount < want) {
      const d = this.drones[this.droneCount++];
      d.x = p.x;
      d.y = p.y;
      d.vx = d.vy = 0;
      d.angle = p.angle;
      d.fireAcc = this.droneCount / (want + 1); // staggered so a formation doesn't fire in one clap
      d.target = null;
      d.retarget = 0;
      d.flash = 0;
      d.trailCount = 0;
      d.podT = W.podEvery * (0.5 + this.droneCount / (want + 1));
      game.particles.spawnShockwave(p.x, p.y, 28, DEPLOYABLE_HUES.drone, 2, 0.2);
    }
    while (this.droneCount > want) this.drones[--this.droneCount].target = null;
    const n = this.droneCount;
    if (n === 0) return;

    const heading = p.hullAngle ?? p.drillAngle ?? p.angle;
    const spacing = TUNING.droneFormationRadius ?? 54;
    const range = W.droneRange(level);
    const rate = W.droneFireRate(level);
    const damage = weaponDamage(p, 'drone', level);
    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      const [slotAngle, slotScale] = n === 1 ? DRONE_SLOTS[2] : DRONE_SLOTS[i];
      const r = spacing * (n === 1 ? 1 : slotScale) + Math.sin(this.time * 3 + i * 2.1) * 3;
      const tx = p.x + Math.cos(heading + slotAngle) * r;
      const ty = p.y + Math.sin(heading + slotAngle) * r;
      // Damped spring: keeps station at full thrust (a few ship-speeds of lag) and swings on turns.
      d.vx = (d.vx + (tx - d.x) * 0.09) * 0.74;
      d.vy = (d.vy + (ty - d.y) * 0.09) * 0.74;
      d.x += d.vx;
      d.y += d.vy;
      if (Math.abs(tx - d.x) + Math.abs(ty - d.y) > 600) { d.x = tx; d.y = ty; d.vx = d.vy = 0; d.trailCount = 0; }

      d.trailX[d.trailHead] = d.x;
      d.trailY[d.trailHead] = d.y;
      d.trailHead = (d.trailHead + 1) % TRAIL_LEN;
      if (d.trailCount < TRAIL_LEN) d.trailCount++;
      if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 10);

      d.target = this.trackTarget(game, d, d.x, d.y, range, DRONE_BOLT_RADIUS, dt);
      const tgt = d.target;
      const face = tgt ? Math.atan2(tgt.y - d.y, tgt.x - d.x) : heading;
      d.angle += wrapAngle(face - d.angle) * 0.3;
      d.fireAcc += dt * rate;
      if (!tgt) {
        d.fireAcc = Math.min(d.fireAcc, 1);
        continue;
      }
      // Micro-Missile Pods: a homing micro-missile with a small blast every podEvery s.
      if (level.t12) {
        d.podT -= dt;
        if (d.podT <= 0) {
          d.podT += W.podEvery;
          const pod = this.fireBolt(game, d.x, d.y, face + (Math.random() - 0.5) * 1.2, 6, W.droneBoltSpeed * 0.55, damage * W.podDamageMult(level) / W.droneDamageMult(level) / 2,
            40, 3.6, 'drone', range * 1.6);
          pod.homing = 0.12;
          pod.target = tgt;
          pod.blastRadius = W.podBlast * (p.stats.areaMult ?? 1);
          pod.blastDamage = pod.damage;
          pod.life += 0.6;
        }
      }
      while (d.fireAcc >= 1) {
        d.fireAcc -= 1;
        const bolt = this.fireBolt(game, d.x, d.y, face, 9, W.droneBoltSpeed, damage, DEPLOYABLE_HUES.drone, DRONE_BOLT_RADIUS, 'drone', range);
        // Homing Bolts: curve onto the drone's target.
        if (level.t8) { bolt.homing = W.homingTurn; bolt.target = tgt; bolt.life += 0.2; }
        d.flash = 1;
        game.sound.playDroneShot?.();
      }
    }
  }

  // ---- Shared targeting & bolts ----
  // Keep a unit's target while it stays valid and in range; re-pick the nearest visible one every
  // RETARGET_TIME seconds (or at once when the old target dies or leaves range).
  trackTarget(game, unit, x, y, range, boltRadius, dt) {
    unit.retarget -= dt;
    let tgt = unit.target;
    if (tgt) {
      const reach = range + tgt.radius;
      if (!isDeployableTarget(tgt) || (tgt.x - x) ** 2 + (tgt.y - y) ** 2 > reach * reach) tgt = null;
    }
    if (!tgt || unit.retarget <= 0) {
      tgt = this.acquireTarget(game, x, y, range, boltRadius);
      unit.retarget = RETARGET_TIME;
    }
    return tgt;
  }

  // Nearest valid enemy within range whose line of fire is not blocked by an asteroid. Tries the
  // nearest few candidates without sorting or allocating.
  acquireTarget(game, x, y, range, boltRadius = 0) {
    const enemies = game.enemyManager.enemies;
    let skip0 = null;
    let skip1 = null;
    for (let attempt = 0; attempt < LOS_CANDIDATES; attempt++) {
      let best = null;
      let bestSq = Infinity;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e === skip0 || e === skip1 || !isDeployableTarget(e)) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const dSq = dx * dx + dy * dy;
        const reach = range + e.radius;
        if (dSq < bestSq && dSq <= reach * reach) {
          bestSq = dSq;
          best = e;
        }
      }
      if (!best) return null;
      if (this.clearShot(game, x, y, best, boltRadius)) return best;
      if (attempt === 0) skip0 = best;
      else skip1 = best;
    }
    return null;
  }

  anyTargetNear(game, x, y, range) {
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (isDeployableTarget(e) && (e.x - x) ** 2 + (e.y - y) ** 2 <= range * range) return true;
    }
    return false;
  }

  // Same cover rule as the bullet sweep: a rock surface within a bolt's radius of the line between
  // the muzzle and the target's hull blocks (otherwise a grazing rock would eat every bolt).
  clearShot(game, x0, y0, e, boltRadius = 0) {
    const am = game.asteroidManager;
    if (!am || !am.asteroids || am.asteroids.length === 0) return true;
    if (this.maxRock < 0) {
      this.maxRock = am.maxRockRadius ?? am.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    }
    const dx = e.x - x0;
    const dy = e.y - y0;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = Math.max(0, dist - e.radius);
    const x1 = x0 + (dx / dist) * reach;
    const y1 = y0 + (dy / dist) * reach;
    const cells = Math.ceil((reach / 2 + this.maxRock + boltRadius) / am.cellSize);
    const rocks = am.getNearbyAsteroids((x0 + x1) / 2, (y0 + y1) / 2, cells);
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (rock.hp <= 0) continue;
      if (game.segmentHitTime(x0, y0, x1, y1, rock.x, rock.y, rock.radius + boltRadius) !== null) return false;
    }
    return true;
  }

  fireBolt(game, x, y, angle, muzzle, speed, damage, hue, radius, source, range) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const b = {
      x: x + cos * muzzle,
      y: y + sin * muzzle,
      vx: cos * speed,
      vy: sin * speed,
      damage,
      pierce: 1,
      hue,
      radius,
      life: range / (speed * 60) + 0.12,
      source,
      knock: BOLT_KNOCK
    };
    game.bullets.push(b);
    return b;
  }

  // ---- Rendering (additive layer, world space). Animation runs on this.time, so it freezes with the sim. ----
  inView(game, x, y, pad) {
    return x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
  }

  // Mines and turrets sit on the ground layer, under enemies.
  drawGround(ctx, game) {
    if (this.mineCount === 0 && this.turretCount === 0) return;
    const armTime = TUNING.mineArmTime ?? 0.6;
    const hm = DEPLOYABLE_HUES.mine;
    for (let i = 0; i < this.mineCount; i++) {
      const m = this.mines[i];
      if (!this.inView(game, m.x, m.y, m.trigger + 10)) continue;
      const armed = m.age >= armTime;
      ctx.save();
      ctx.translate(m.x, m.y);
      if (!armed) {
        // Arming: dim diamond with a charge ring filling clockwise.
        const k = m.age / armTime;
        ctx.strokeStyle = `hsla(${hm}, 60%, 55%, 0.55)`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 10, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.stroke();
        ctx.rotate(m.spin);
        ctx.strokeRect(-3.5, -3.5, 7, 7);
      } else {
        // Armed: blink speeds up as the fuse runs out; the trigger ring breathes with it.
        const left = m.life - m.age;
        const freq = left < 2 ? 9 : 3.2;
        const pulse = 0.5 + 0.5 * Math.sin((this.time + m.spin) * freq * Math.PI);
        ctx.strokeStyle = `hsla(${hm}, 100%, 60%, ${0.12 + pulse * 0.16})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, m.trigger, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(m.spin + this.time * 0.9);
        ctx.strokeStyle = `hsla(${hm}, 100%, 62%, 0.95)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(9, 0); ctx.lineTo(0, 9); ctx.lineTo(-9, 0);
        ctx.closePath();
        ctx.moveTo(-12.5, 0); ctx.lineTo(-9.5, 0);
        ctx.moveTo(12.5, 0); ctx.lineTo(9.5, 0);
        ctx.moveTo(0, -12.5); ctx.lineTo(0, -9.5);
        ctx.moveTo(0, 12.5); ctx.lineTo(0, 9.5);
        ctx.stroke();
        ctx.fillStyle = `hsla(${hm + 30}, 100%, ${60 + pulse * 30}%, ${0.5 + pulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(0, 0, 2.4 + pulse * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const ht = DEPLOYABLE_HUES.turret;
    for (let i = 0; i < this.turretCount; i++) {
      const t = this.turrets[i];
      if (!this.inView(game, t.x, t.y, 40 * TURRET_SCALE)) continue;
      const frac = Math.max(0, t.life / t.maxLife);
      const popIn = Math.min(1, (t.maxLife - t.life) / 0.15);
      const s = (0.6 + 0.4 * popIn) * TURRET_SCALE;
      const ending = t.life < 1.5 && Math.sin(this.time * 18) < 0;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      // Lifetime ring: faint full track, bright arc for the time left (blinks in the last 1.5 s).
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = `hsla(${ht}, 100%, 60%, 0.14)`;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${ht}, 100%, ${ending ? 85 : 64}%, ${ending ? 0.5 : 0.9})`;
      ctx.beginPath();
      ctx.arc(0, 0, 19, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      // Hexagonal base.
      ctx.strokeStyle = `hsla(${ht}, 100%, 62%, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 6;
        if (k === 0) ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
        else ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
      }
      ctx.closePath();
      ctx.stroke();
      // Rotating twin barrel + hub.
      ctx.rotate(t.aim);
      ctx.strokeStyle = `hsla(${ht}, 100%, 72%, 1)`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(2, -2.6); ctx.lineTo(TURRET_MUZZLE_UNIT - 2 * t.flash, -2.6);
      ctx.moveTo(2, 2.6); ctx.lineTo(TURRET_MUZZLE_UNIT - 2 * t.flash, 2.6);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(-4, -4, 8, 8);
      if (t.flash > 0.05) {
        ctx.fillStyle = `hsla(${ht - 20}, 100%, 80%, ${t.flash})`;
        ctx.beginPath();
        ctx.arc(TURRET_MUZZLE_UNIT + 2, 0, 3 + t.flash * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Escort drones fly above the ground layer, next to the ship.
  drawEscorts(ctx, game) {
    const hd = DEPLOYABLE_HUES.drone;
    for (let i = 0; i < this.droneCount; i++) {
      const d = this.drones[i];
      if (!this.inView(game, d.x, d.y, 60)) continue;
      // Thruster trail: oldest sample faint and thin, newest bright and thick.
      const n = d.trailCount;
      for (let s = 1; s < n; s++) {
        const a = (d.trailHead - n + s - 1 + TRAIL_LEN) % TRAIL_LEN;
        const b = (a + 1) % TRAIL_LEN;
        const k = s / (n - 1);
        ctx.strokeStyle = `hsla(${hd}, 100%, ${55 + k * 15}%, ${0.08 + k * 0.45})`;
        ctx.lineWidth = 0.8 + k * 2.2;
        ctx.beginPath();
        ctx.moveTo(d.trailX[a], d.trailY[a]);
        ctx.lineTo(d.trailX[b], d.trailY[b]);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      ctx.strokeStyle = `hsla(${hd}, 100%, 62%, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, 5.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-6, -5.5);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = d.flash > 0.05 ? `hsla(${hd}, 100%, 85%, ${0.6 + d.flash * 0.4})` : '#ffffff';
      ctx.beginPath();
      ctx.arc(d.flash > 0.05 ? 10 : 1.5, 0, d.flash > 0.05 ? 2 + d.flash * 2 : 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
