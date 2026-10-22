// Deployables: Proximity Mines, Sentry Turrets and Escort Drones.
// Every unit lives in a fixed pool (nothing is allocated while placing or simulating them) and is
// simulated only from Game.update, so pause, hit-stop and slow-mo freeze them with the rest of the
// world. They are not enemies and never enter the enemy list, so they don't count toward the enemy
// cap. Per-level numbers come from WEAPON_SCALING (the formulas the upgrade cards preview), and all
// damage goes through Game.hitEnemy: turret/drone bolts ride the shared bullet sweep (asteroid
// cover blocks them), mine bursts use Game.damageEnemiesInRadius.
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, mineBlastRadius, siegeShellRadius, TURRET_MAX_ACTIVE, DRONE_MAX } from './weapon-scaling.js';
import { weaponBuild, levelBuild } from './weapon-levels.js';

export const DEPLOYABLE_HUES = { mine: 8, turret: 208, drone: 82 };

const MINE_POOL = 36;   // >= W.mineMaxActive at max level (capacity 11, x3 with Minefield Triad)
const TURRET_POOL = TURRET_MAX_ACTIVE; // >= W.turretMaxActive at max level
const DRONE_POOL = DRONE_MAX; // W.droneCount: up to 3 in front and 5 behind
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
const TURRET_LAND = 0.22; // s: the slam-in animation of a fresh turret
const TURRET_FOLD = 0.3;  // s: the fold-away at the end of its lifetime (it stops firing)
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
export const TURRET_BASE = 14 * TURRET_SCALE;    // base hex radius plus a little clearance from rock surfaces
export const TURRET_SPACING = 34 * TURRET_SCALE; // a new turret never sits closer than this to a live one
const SIDESTEPS = [38, -38, 76, -76, 114, -114].map((v) => v * TURRET_SCALE); // sideways offsets tried when the ship's spot is taken
const DRONE_BOLT_RADIUS = 2.6;
const MINE_KNOCK = 1.6;
const BOLT_KNOCK = 0.9;
// Formation (ship frame, x forward / y starboard, in units of droneFormationRadius): a FRONT ROW of up to 3
// round the nose and a BACK ROW of up to 5 in a shallow chevron behind the hull. Each row spreads
// symmetrically to fit however many fly in it; how many go in front is droneFrontFor (weapon-scaling.js):
// up to 5 as a front pair + back row of 3, then Escort Squadron's 3 take the front centre and the back
// row's outer sides (8: 3 in front, 5 behind).
const DRONE_FRONT_ROWS = [[], [[1.45, 0]], [[0.55, -1.05], [0.55, 1.05]], [[0.55, -1.05], [1.45, 0], [0.55, 1.05]]]; // the centre slot clears the nose
const DRONE_BACK_ROWS = [
  [],
  [[-1.35, 0]],
  [[-1.15, -0.8], [-1.15, 0.8]],
  [[-1.15, -1.15], [-1.4, 0], [-1.15, 1.15]],
  [[-0.95, -1.75], [-1.3, -0.6], [-1.3, 0.6], [-0.95, 1.75]],
  [[-0.85, -2.1], [-1.15, -1.15], [-1.4, 0], [-1.15, 1.15], [-0.85, 2.1]]
];
function droneSlot(i, front, back) {
  return i < front ? DRONE_FRONT_ROWS[front][i] : DRONE_BACK_ROWS[back][i - front];
}
const DRONE_SLOT_PUSH = 6;     // px every slot sits beyond its droneFormationRadius spot (Clay, v0.45: a roomier formation)
const DRONE_LAUNCH_GAP = 0.07; // s between drones launching together (a squadron peels off one by one)
const DRONE_DOCK_DIST = 7;     // px from its slot where a launching drone docks (snap ring + chirp)

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
    this.turrets = Array.from({ length: TURRET_POOL }, () => ({ x: 0, y: 0, life: 0, maxLife: 0, aim: 0, fireAcc: 0, target: null, retarget: 0, flash: 0, packing: false }));
    this.drones = Array.from({ length: DRONE_POOL }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, angle: 0, fireAcc: 0, target: null, retarget: 0, flash: 0, podT: 0, launch: 0, flight: 0, docked: true, pop: 0,
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
    // Sentry Turret charges (DRG: Survivor's LMG Gun Platform): held charges (null until the turret is
    // first equipped, then a full bank), the reload toward the next one, the gap between drops and how
    // long the ship has stood still.
    this.turretCharges = null;
    this.turretReloadT = 0;
    this.turretTimer = 0;
    this.turretStill = 0;
    this.time = 0;
    this.maxRock = -1;
  }

  // Turret bank for the HUD chip (held charges plus the reload toward the next, as a share of a full
  // bank, in tenths); null until the turret is equipped.
  turretHudCharge(p) {
    if (this.turretCharges === null || !p.weapons?.turret) return null;
    const lv = weaponBuild(p, 'turret');
    const max = W.turretCharges(lv);
    const held = this.turretCharges >= max ? max : this.turretCharges + Math.min(1, this.turretReloadT / W.turretReload(lv));
    return Math.floor((held / max) * 10) / 10;
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
  // Deep Rock Galactic: Survivor rules: stand still turretStillTime s and every held charge goes down,
  // turretDropStill s apart. A charge comes back every turretReload s; one that comes back while the bank
  // is full deploys by itself, wherever the ship is.
  updateTurrets(dt, game, level) {
    const p = game.player;
    if (level) {
      const max = W.turretCharges(level);
      if (this.turretCharges === null) this.turretCharges = max; // first equipped: a full bank
      this.turretCharges = Math.min(this.turretCharges, max);
      const room = this.turretCount < TURRET_POOL;
      const reload = W.turretReload(level);
      this.turretReloadT += dt;
      if (this.turretReloadT >= reload) {
        if (this.turretCharges < max) {
          this.turretCharges++;
          this.turretReloadT -= reload;
        } else if (room) {
          this.deployTurret(game, level); // overflow: the bank is full, so this one goes straight down
          this.turretReloadT -= reload;
        } else this.turretReloadT = reload; // every turret in the pool is out: hold it
      }
      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.6;
      this.turretStill = moving ? 0 : this.turretStill + dt;
      this.turretTimer -= dt;
      if (this.turretStill >= W.turretStillTime && this.turretTimer <= 0 && this.turretCharges > 0 && this.turretCount < TURRET_POOL) {
        this.turretCharges--;
        this.deployTurret(game, level);
        this.turretTimer = W.turretDropStill;
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
        game.particles.spawnShockwave(t.x, t.y, 34 * TURRET_SCALE, DEPLOYABLE_HUES.turret, 2, 0.22, true);
        game.particles.spawnExplosionSparks(t.x, t.y, 12, DEPLOYABLE_HUES.turret, 1, 5, 1.6);
        continue;
      }
      if (t.life < TURRET_FOLD) {
        // Packing up: the barrel winds down and folds away (deployables draw), no more rounds.
        if (!t.packing) { t.packing = true; game.sound.playTurretPackUp?.(); }
        t.aim += dt * 6 * (1 - t.life / TURRET_FOLD);
        continue;
      }
      // Tank Tracks: roll after the ship into a ring around it, each turret at its own spot on the ring.
      if (lv.t8) this.followShip(t, i, p, dt);
      t.target = this.trackTarget(game, t, t.x, t.y, range, TURRET_BOLT_RADIUS, dt);
      const tgt = t.target;
      if (!tgt) {
        t.aim += dt * 0.9; // idle sweep
        t.fireAcc = Math.min(1, t.fireAcc + dt * rate);
        continue;
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
    t.target = null;
    t.retarget = 0;
    t.flash = 0;
    t.packing = false;
    // Landing: a ring, sparks kicked out sideways, a dent in the grid and a heavy clunk.
    game.particles.spawnShockwave(t.x, t.y, 48 * TURRET_SCALE, DEPLOYABLE_HUES.turret, 2.5, 0.25);
    game.particles.spawnExplosionSparks(t.x, t.y, 10, DEPLOYABLE_HUES.turret, 1, 4, 1.2);
    game.grid.applyImpulse(t.x, t.y, 18, 90, DEPLOYABLE_HUES.turret);
    game.sound.playTurretDeploy?.();
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
    // LMG Overload: a little spray.
    const aim = level.t12 ? t.aim + (Math.random() - 0.5) * 2 * W.overloadSpread : t.aim;
    const b = this.fireBolt(game, t.x, t.y, aim, TURRET_MUZZLE, W.turretBoltSpeed, damage,
      DEPLOYABLE_HUES.turret, TURRET_BOLT_RADIUS, 'turret', W.turretRange(level));
    b.pierce = W.turretPierce(level);
    b.sweepX = t.x; // the barrel is long; sweep from the turret centre so enemies sitting on it are hit
    b.sweepY = t.y;
    if (p.weapons.siegeBattery) {
      b.blastRadius = siegeShellRadius(p);
      b.blastDamage = weaponDamage(p, 'siege', level);
      b.blastStat = 'siege'; // run stats: shell bursts are Siege Battery damage
      b.hue = 24; // amber-hot shells read as explosive
    }
    t.flash = 1;
    if (game.sound.playTurretShot) game.sound.playTurretShot();
    else game.sound.playLaser(0.72);
  }

  // ---- Escort Drones ----
  updateDrones(dt, game, level) {
    const p = game.player;
    const want = level ? Math.min(DRONE_POOL, W.droneCount(level)) : 0;
    let launching = 0;
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
      // Launch: drones joining together (a squadron) peel off the hull one by one and fly out to their
      // slots, then dock with a snap ring and a chirp that climbs along the row.
      d.launch = launching++ * DRONE_LAUNCH_GAP;
      d.flight = 0;
      d.docked = false;
      d.pop = 0;
    }
    while (this.droneCount > want) this.drones[--this.droneCount].target = null;
    const n = this.droneCount;
    if (n === 0) return;

    const heading = p.hullAngle ?? p.drillAngle ?? p.angle;
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const spacing = TUNING.droneFormationRadius ?? 54;
    const front = Math.min(n, W.droneFront(level));
    const back = n - front;
    const shipSpeed = Math.hypot(p.vx || 0, p.vy || 0);
    const range = W.droneRange(level);
    const rate = W.droneFireRate(level);
    const leadDamage = weaponDamage(p, 'drone', level);
    const wingDamage = leadDamage * W.droneWingDamageMult(level) / W.droneDamageMult(level);
    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      const damage = i === 0 ? leadDamage : wingDamage; // the flight lead carries the heavy gun
      const [fx, fy] = droneSlot(i, front, back);
      const len = Math.hypot(fx, fy);
      const r = (len * spacing + DRONE_SLOT_PUSH + Math.sin(this.time * 3 + i * 2.1) * 3) / len; // a gentle bob, out of phase per drone
      const tx = p.x + (fx * cos - fy * sin) * r;
      const ty = p.y + (fx * sin + fy * cos) * r;
      if (d.launch > 0) {
        // Still in the hangar: ride the hull until its turn, then kick out toward the slot.
        d.launch -= dt;
        d.x = p.x;
        d.y = p.y;
        if (d.launch > 0) continue;
        d.vx = (tx - p.x) * 0.22;
        d.vy = (ty - p.y) * 0.22;
        game.particles.spawnShockwave(p.x, p.y, 28, DEPLOYABLE_HUES.drone, 2, 0.2);
      }
      // Damped spring: keeps station at full thrust (a few ship-speeds of lag) and swings on turns.
      d.vx = (d.vx + (tx - d.x) * 0.09) * 0.74;
      d.vy = (d.vy + (ty - d.y) * 0.09) * 0.74;
      d.x += d.vx;
      d.y += d.vy;
      if (Math.abs(tx - d.x) + Math.abs(ty - d.y) > 600) { d.x = tx; d.y = ty; d.vx = d.vy = 0; d.trailCount = 0; }
      if (!d.docked) {
        d.flight += dt;
        // Docked once on station (the spring trails a few ship-speeds behind at full thrust) or after 0.5 s.
        if (Math.hypot(tx - d.x, ty - d.y) < DRONE_DOCK_DIST + shipSpeed * 4 || d.flight > 0.5) {
          d.docked = true;
          d.pop = 1;
          game.particles.spawnShockwave(d.x, d.y, 20, DEPLOYABLE_HUES.drone, 2.5, 0.22);
          game.particles.spawnFlash?.(d.x, d.y, 16, DEPLOYABLE_HUES.drone, 0.12);
          game.sound.playDroneDock?.(i);
        }
      }
      if (d.pop > 0) d.pop = Math.max(0, d.pop - dt * 3.5);

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
      // Slam in: drops from 1.5x, squashes past full size and settles (ease-out-back) over TURRET_LAND s,
      // the barrel unfolding just after. Packing up it folds and shrinks over the last TURRET_FOLD s.
      const age = t.maxLife - t.life;
      const land = easeOutBack(Math.min(1, age / TURRET_LAND));
      const fold = Math.min(1, t.life / TURRET_FOLD);
      const unfold = Math.min(1, Math.max(0, (age - 0.06) / 0.14), fold);
      const s = (1.5 - 0.5 * land) * (0.6 + 0.4 * fold) * TURRET_SCALE;
      const ending = t.life < 1.5 && Math.sin(this.time * 18) < 0;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      if (fold < 1) ctx.rotate((1 - fold) * 1.4); // a twist as it folds away
      // Recoil: every round kicks the whole body back along the aim.
      if (t.flash > 0) ctx.translate(-Math.cos(t.aim) * t.flash * 1.3, -Math.sin(t.aim) * t.flash * 1.3);
      // Landing flash: a white-hot hex for the first instants on the ground.
      if (age < 0.14) {
        ctx.fillStyle = `hsla(${ht}, 100%, 92%, ${0.85 * (1 - age / 0.14)})`;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + Math.PI / 6;
          if (k === 0) ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
          else ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        }
        ctx.closePath();
        ctx.fill();
      }
      // Lifetime ring: faint full track, bright arc for the time left (blinks in the last 1.5 s); it
      // sweeps full as the turret powers up.
      const ringFrac = frac * Math.min(1, age / 0.3);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = `hsla(${ht}, 100%, 60%, 0.14)`;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${ht}, 100%, ${ending ? 85 : 64}%, ${ending ? 0.5 : 0.9})`;
      ctx.beginPath();
      ctx.arc(0, 0, 19, -Math.PI / 2, -Math.PI / 2 + ringFrac * Math.PI * 2);
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
      // Rotating twin barrel + hub (the barrels slide back on every round and unfold / fold with the body).
      ctx.rotate(t.aim);
      const muzzle = 2 + (TURRET_MUZZLE_UNIT - 2) * unfold - 3.2 * t.flash;
      ctx.strokeStyle = `hsla(${ht}, 100%, 72%, 1)`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(2, -2.6); ctx.lineTo(muzzle, -2.6);
      ctx.moveTo(2, 2.6); ctx.lineTo(muzzle, 2.6);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(-4, -4, 8, 8);
      if (t.flash > 0.05 && unfold > 0.9) {
        // Muzzle flash: a hot core plus a short forward spike.
        ctx.fillStyle = `hsla(${ht - 20}, 100%, 82%, ${t.flash})`;
        ctx.beginPath();
        ctx.arc(TURRET_MUZZLE_UNIT + 2, 0, 3 + t.flash * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(TURRET_MUZZLE_UNIT + 2, -2.2 * t.flash);
        ctx.lineTo(TURRET_MUZZLE_UNIT + 2 + 9 * t.flash, 0);
        ctx.lineTo(TURRET_MUZZLE_UNIT + 2, 2.2 * t.flash);
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
      if (d.launch > 0 || !this.inView(game, d.x, d.y, 60)) continue;
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
      if (d.pop > 0) {
        // Dock snap: a ring that tightens onto the drone while its hull pops up and settles.
        ctx.strokeStyle = `hsla(${hd}, 100%, 75%, ${d.pop * 0.9})`;
        ctx.lineWidth = 1.5 + d.pop * 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 9 + d.pop * 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      const s = (i === 0 ? 1.25 : 1) * (1 + 0.45 * d.pop * d.pop); // the flight lead (heavy gun) flies a bigger hull
      if (s !== 1) ctx.scale(s, s);
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
