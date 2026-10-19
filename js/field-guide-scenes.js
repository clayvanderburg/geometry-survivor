// Field Guide previews: tiny looping scenes that show each hostile doing its thing, simulated and drawn
// with the game's own code (EnemyManager AI + draw, archetype telegraphs, lieutenant/boss auras,
// enemy orbs, ParticleSystem and the crab ship renderer). A scripted dummy ship kites and fires
// plain bolts so dodges, shield plates, splits and links have something to react to.
// Fixed 60 Hz steps like the game; the UI only steps scenes whose canvas is on screen.
import { TUNING } from './config.js';
import { EnemyManager, BOSS_NAME } from './enemies.js';
import { ParticleSystem } from './particles.js';
import { drawCrabShip, drawPlayerShield, shieldTouches } from './ship-renderer.js';
import { BRUISER, shieldBlocks, bounceFromShip, lieutenantTypes } from './archetypes.js';
import { rollLieutenant, LIEUTENANT_WARMUP } from './lieutenants.js';
import { bossDef } from './bosses.js';
import { SERPENT, spawnSerpent } from './serpents.js';
import { spawnWing } from './squadrons.js';
import { wellPullScale, playerPullShare } from './gravity.js';

export const PREVIEW_DT = 1 / 60;
export const PREVIEW_ASPECT = 9 / 16;
const GRID_STUB = { applyImpulse() {} };
const PARTICLE_STUB = { applyGravityWell() {}, spawnShockwave() {} };
const BOLT_SPEED = 9;
const BOLT_DAMAGE = 11;
const BG = '#04060f';

// Scene scripts. `w` is the world width shown (height follows the 16:9 canvas); `loop` restarts it.
// setup(s) places things, tick(s, dt) drives the dummy ship, onSpawn(s, e) tweaks a fresh hull,
// onKill(s, e) reacts to a kill. Enemy behaviour itself is always the real AI.
const SCENES = {
  swarmer: {
    w: 420, loop: 7,
    setup(s) { s.home(0.72, 0.5); s.manager.spawnBoidSwarm(s.W * 0.18, s.H * 0.5, 10, 1, s.W, s.H); },
    tick(s) {
      s.kite(s.W * 0.72, s.H * 0.5, 34, 1.6);
      s.autoFire(0.16);
      if (s.count() < 3 && s.every(1.5)) s.manager.spawnBoidSwarm(s.W * 0.15, s.H * (0.3 + Math.random() * 0.4), 8, 1, s.W, s.H);
    }
  },
  pinwheel: {
    w: 420, loop: 8,
    setup(s) {
      s.home(0.75, 0.5);
      for (let k = 0; k < 3; k++) s.spawn('pinwheel', s.W * 0.12, s.H * (0.25 + k * 0.25));
    },
    tick(s) {
      s.kite(s.W * 0.75, s.H * 0.5, 40, 1.2);
      s.autoFire(0.2);
      if (s.count() === 0 && s.every(1)) for (let k = 0; k < 3; k++) s.spawn('pinwheel', s.W * 0.1, s.H * (0.25 + k * 0.25));
    }
  },
  weaver: {
    w: 400, loop: 8,
    setup(s) { s.home(0.8, 0.5); s.spawn('weaver', s.W * 0.2, s.H * 0.35); s.spawn('weaver', s.W * 0.2, s.H * 0.65); },
    tick(s) {
      s.hold();
      s.autoFire(0.24);
      if (s.count() === 0 && s.every(1)) s.spawn('weaver', s.W * 0.15, s.H * 0.5);
    }
  },
  splitter: {
    w: 420, loop: 9,
    setup(s) { s.home(0.8, 0.5); s.spawn('splitter', s.W * 0.25, s.H * 0.5); },
    tick(s) {
      s.hold();
      s.autoFire(0.13);
      if (s.count() === 0 && s.every(1.4)) s.spawn('splitter', s.W * 0.22, s.H * 0.5);
    },
    onKill(s, e) { if (e.type === 'splitter') s.splitterBurst(e); }
  },
  mini_splitter: {
    w: 380, loop: 7,
    setup(s) { s.home(0.8, 0.5); s.burstAt = 0.4; },
    tick(s) {
      s.hold();
      if (s.t > 0.9) s.autoFire(0.16);
      if (s.burstAt !== null && s.t >= s.burstAt) {
        s.burstAt = null;
        s.splitterBurst({ x: s.W * 0.3, y: s.H * 0.5, rotation: Math.random() * 6, radius: 20, sides: 6, hue: 42 });
      }
      if (s.count() === 0 && s.burstAt === null) s.burstAt = s.t + 1;
    }
  },
  blackhole: {
    w: 560, loop: 10,
    setup(s) {
      s.home(0.74, 0.7);
      s.spawn('blackhole', s.W * 0.45, s.H * 0.5);
    },
    onSpawn(s, e) { if (e.type === 'blackhole') { e.speed = 0; e.vx = 0; e.vy = 0; } },
    tick(s, dt) {
      const v = s.find('blackhole');
      s.hold();
      if (!v) return;
      v.vx = 0;
      v.vy = 0;
      const pull = TUNING.blackholePullRadius ?? 200;
      // Sparks and infall streams drift in from the rim; a few swarmers get dragged into orbit.
      if (s.every(0.12)) {
        const a = Math.random() * Math.PI * 2;
        s.particles.spawnExplosionSparks(v.x + Math.cos(a) * pull * 0.9, v.y + Math.sin(a) * pull * 0.9, 3, 348 + Math.random() * 40, 0.5, 2.5, 2);
      }
      if (Math.random() < 0.6) s.particles.spawnInfall(v, pull * 0.9, v.hue, 1);
      if (s.count('swarmer') < 4 && s.every(0.9)) {
        const a = Math.random() * Math.PI * 2;
        s.spawn('swarmer', v.x + Math.cos(a) * pull * 0.8, v.y + Math.sin(a) * pull * 0.5);
      }
      // Shots crossing the rim bend toward the core, exactly like the game's bullet bend.
      for (const b of s.bolts) {
        const k = wellPullScale(v.x - b.x, v.y - b.y, pull, TUNING.blackholeBulletBend ?? 0.22, v.radius);
        b.vx += (v.x - b.x) * k;
        b.vy += (v.y - b.y) * k;
      }
      s.tug = playerPullShare(Math.hypot(v.x - s.player.x, v.y - s.player.y), pull, v.radius);
      if (s.every(0.3)) s.fireAt(v.x + (Math.random() - 0.5) * 60, v.y - pull * 0.65);
    },
    noContactKill: true
  },
  bruiser: {
    w: 540, loop: 9,
    setup(s) { s.home(0.74, 0.5); s.spawn('bruiser', s.W * 0.22, s.H * 0.5); s.dodge = 1; },
    onSpawn(s, e) { if (e.type === 'bruiser') e.aiTimer = 0.35; },
    tick(s, dt) {
      const b = s.find('bruiser');
      const p = s.player;
      if (b && ((b.state === 'windup' && b.aiTimer < BRUISER.windup * 0.4) || b.state === 'charge')) {
        // Lane locked: sidestep out of it.
        if (b.state === 'windup' && !s.stepping) { s.stepping = true; s.dodge = -s.dodge; }
        p.y += s.dodge * 3.4;
        p.y = Math.max(40, Math.min(s.H - 40, p.y));
      } else {
        s.stepping = false;
        p.y += (s.H * 0.5 - p.y) * 0.03;
      }
      p.walkCycle += 0.2;
      if (!b || b.state !== 'windup') s.autoFire(0.2);
      if (s.count('bruiser') === 0 && s.every(1.2)) s.spawn('bruiser', s.W * 0.15, s.H * 0.5);
    }
  },
  gunner: {
    w: 580, loop: 9,
    setup(s) { s.home(0.16, 0.5); s.spawn('gunner', s.W * 0.75, s.H * 0.4); },
    onSpawn(s, e) { if (e.type === 'gunner') e.aiTimer = 0.4; },
    tick(s) {
      const p = s.player;
      p.y = s.H * 0.5 + Math.sin(s.t * 1.6) * s.H * 0.28;
      p.drillAngle = Math.sin(s.t * 1.6) > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.walkCycle += 0.2;
      s.autoFire(0.45);
      if (s.count() === 0 && s.every(1)) s.spawn('gunner', s.W * 0.8, s.H * 0.5);
    }
  },
  shielder: {
    w: 460, loop: 10,
    setup(s) { s.home(0.5, 0.5); s.spawn('shielder', s.W * 0.5, s.H * 0.5); },
    onSpawn(s, e) { if (e.type === 'shielder') e.speed = 0.35; },
    tick(s) {
      // Circle the plates faster than they can turn: front shots spark off, flank shots land.
      const e = s.find('shielder');
      const cx = e ? e.x : s.W * 0.5;
      const cy = e ? e.y : s.H * 0.5;
      const a = -0.3 + s.t * 1.15;
      const p = s.player;
      p.x = cx + Math.cos(a) * 165;
      p.y = cy + Math.sin(a) * 105;
      p.drillAngle = a + Math.PI / 2;
      p.walkCycle += 0.25;
      s.autoFire(0.14);
      if (s.count('shielder') === 0 && s.every(1)) s.spawn('shielder', s.W * 0.5, s.H * 0.5);
    }
  },
  blinker: {
    w: 520, loop: 9,
    setup(s) { s.home(0.5, 0.5); s.spawn('blinker', s.W * 0.15, s.H * 0.3); },
    onSpawn(s, e) { if (e.type === 'blinker') e.aiTimer = 0.6; },
    tick(s) {
      s.kite(s.W * 0.5, s.H * 0.5, 26, 1.4);
      s.autoFire(0.3);
      if (s.count() === 0 && s.every(1)) s.spawn('blinker', s.W * 0.12, s.H * 0.5);
    }
  },
  conduit: {
    w: 600, loop: 10,
    setup(s) {
      s.home(0.9, 0.5);
      s.spawn('conduit', s.W * 0.42, s.H * 0.5);
      s.spawn('swarmer', s.W * 0.3, s.H * 0.35);
      s.spawn('swarmer', s.W * 0.3, s.H * 0.65);
    },
    tick(s) {
      const p = s.player;
      p.y = s.H * 0.5 + Math.sin(s.t * 1.2) * s.H * 0.3;
      p.walkCycle += 0.2;
      s.autoFire(0.5, (e) => e.type !== 'conduit');
      if (s.count('swarmer') < 2 && s.every(1.1)) {
        const c = s.find('conduit');
        if (c) s.spawn('swarmer', c.x - 60, c.y + (Math.random() - 0.5) * 120);
      }
    }
  },
  lieutenant: {
    w: 560, loop: 10,
    setup(s) {
      s.home(0.82, 0.5);
      const lt = rollLieutenant(7, lieutenantTypes(7));
      s.manager.queueSpawn(lt.type, s.W * 0.4, s.H * 0.5, 1, { warmup: LIEUTENANT_WARMUP, lieutenant: lt });
    },
    tick(s) {
      s.kite(s.W * 0.82, s.H * 0.5, 30, 1.3);
      // Burst fire with pauses, so the regen pulse and modifier arcs get a moment to read.
      if ((s.t % 2.6) < 1.4) s.autoFire(0.12);
    },
    onKill(s, e) { s.splitCopies(e); }
  },
  mayfly: {
    w: 440, loop: 8,
    setup(s) { s.home(0.78, 0.5); s.cloud(); },
    tick(s) {
      s.kite(s.W * 0.74, s.H * 0.5, 46, 1.5);
      s.autoFire(0.1);
      if (s.count() < 4 && s.every(1.6)) s.cloud();
    }
  },
  hulk: {
    w: 560, loop: 10,
    setup(s) { s.home(0.8, 0.5); s.spawn('hulk', s.W * 0.25, s.H * 0.5); },
    tick(s) {
      s.kite(s.W * 0.78, s.H * 0.5, 50, 0.9);
      s.autoFire(0.1);
      if (s.count('hulk') === 0 && s.every(1.2)) s.spawn('hulk', s.W * 0.2, s.H * 0.5);
    },
    noContactKill: true
  },
  brood_queen: {
    w: 680, loop: 12,
    setup(s) {
      s.home(0.82, 0.5);
      s.manager.queueSpawn('brood_queen', s.W * 0.4, s.H * 0.5, 1, { warmup: 1.2, wave: 1 });
    },
    tick(s) {
      s.kite(s.W * 0.66, s.H * 0.5, s.H * 0.34, 0.8);
      if (s.t > 1.4) s.autoFire(0.12);
      // Speed the fight along so the preview reaches her half-HP scatter and the mayfly burst.
      const q = s.find('brood_queen');
      if (q && s.t > 6 && !q.enraged) q.hp = Math.min(q.hp, q.maxHp * 0.49);
      if (q && s.t > 9.5) s.kill(q);
      s.bossEntrance();
    },
    onKill(s, e) { if (e.isBoss) bossDef(e.type)?.onDeath?.(e, s.manager); }
  },
  serpent: {
    w: 560, loop: 10,
    setup(s) { s.home(0.8, 0.5); s.serpent(); },
    tick(s) {
      s.kite(s.W * 0.78, s.H * 0.5, 40, 1.1);
      s.autoFire(0.14);
      if (s.count() === 0 && s.every(1.2)) s.serpent();
    },
    noContactKill: true
  },
  ouroboros: {
    w: 900, loop: 14,
    setup(s) {
      s.home(0.62, 0.5);
      s.manager.queueSpawn('ouroboros', s.W * 0.25, s.H * 0.5, 1, { warmup: 1.2, wave: 1 });
    },
    tick(s) {
      const q = s.find('ouroboros');
      // Holds still while it coils (so the noose reads), kites otherwise.
      if (!q || q.state === 'wind') s.kite(s.W * 0.62, s.H * 0.5, s.H * 0.22, 0.7);
      if (s.t > 1.4) s.autoFire(0.12, e => !e.leader);
      if (q && s.t > 5 && !q.enraged) q.hp = Math.min(q.hp, q.maxHp * 0.49);
      if (q && s.t > 12.6) s.kill(q);
      s.bossEntrance();
    },
    noContactKill: true
  },
  kestrel: {
    w: 640, loop: 9,
    setup(s) { s.home(0.6, 0.5); spawnWing(s.manager, s.W * 0.08, s.H * 0.3, 1, 2, { angle: 0.3, extra: { instant: true } }); },
    tick(s) {
      s.kite(s.W * 0.6, s.H * 0.5, 30, 1.2);
      if (s.t > 2) s.autoFire(0.16);
      if (s.count() === 0 && s.every(1)) spawnWing(s.manager, s.W * 0.08, s.H * 0.7, 1, 2, { angle: -0.3, extra: { instant: true } });
    }
  },
  wing_commander: {
    w: 900, loop: 13,
    setup(s) {
      s.home(0.55, 0.5);
      s.manager.queueSpawn('wing_commander', s.W * 0.15, s.H * 0.5, 1, { warmup: 1.2, wave: 1 });
    },
    tick(s) {
      s.kite(s.W * 0.55, s.H * 0.5, s.H * 0.25, 0.6);
      if (s.t > 1.4) s.autoFire(0.12, e => e.isBoss);
      const q = s.find('wing_commander');
      if (q && s.t > 7 && !q.enraged) q.hp = Math.min(q.hp, q.maxHp * 0.49);
      if (q && s.t > 11.5) s.kill(q);
      s.bossEntrance();
    },
    onKill(s, e) { if (e.isBoss) bossDef(e.type)?.onDeath?.(e, s.manager); },
    noContactKill: true
  },
  carrier: {
    w: 640, loop: 10,
    setup(s) { s.home(0.3, 0.5); s.spawn('carrier', s.W * 0.85, s.H * 0.5); },
    tick(s) {
      s.kite(s.W * 0.3, s.H * 0.5, 30, 1.3);
      if (s.t > 3) s.autoFire(0.14);
      if (s.count('carrier') === 0 && s.every(1.5)) s.spawn('carrier', s.W * 0.9, s.H * 0.5);
    }
  },
  drone: {
    w: 520, loop: 8,
    setup(s) { s.home(0.7, 0.5); },
    tick(s) {
      s.kite(s.W * 0.7, s.H * 0.5, 60, 2.2);
      s.autoFire(0.2);
      if (s.count() < 3 && s.every(0.6)) s.spawn('drone', s.W * 0.05, s.H * (0.2 + Math.random() * 0.6), { attach: { aimAngle: 0, lifeT: 6 } });
    }
  },
  hive_carrier: {
    w: 900, loop: 14,
    setup(s) {
      s.home(0.72, 0.5);
      s.manager.queueSpawn('hive_carrier', s.W * 0.35, s.H * 0.5, 1, { warmup: 1.2, wave: 1 });
    },
    tick(s) {
      s.kite(s.W * 0.72, s.H * 0.5, s.H * 0.25, 0.7);
      if (s.t > 1.4) s.autoFire(0.1, e => e.mount || (e.isBoss && !e.deflect));
      // Speed the fight along: the bays fall one by one, then the exposed core.
      if (s.t > 5 && s.every(1.2)) { const bay = s.manager.enemies.find(e => e.mount && !e.dead); if (bay) s.kill(bay); }
      const q = s.find('hive_carrier');
      if (q && s.t > 12.8) s.kill(q);
      s.bossEntrance();
    },
    noContactKill: true
  },
  boss: {
    w: 640, loop: 11,
    setup(s) {
      s.home(0.5, 0.5);
      s.manager.queueSpawn('boss', s.W * 0.5, s.H * 0.5, 1, { warmup: 1.6, name: BOSS_NAME, epithet: 'WAVE 3 WARDEN' });
    },
    tick(s) {
      s.kite(s.W * 0.5, s.H * 0.5, s.H * 0.36, 0.7);
      if (s.t > 1.8) s.autoFire(0.22);
      s.bossEntrance();
    },
    noContactKill: true
  }
};

export const PREVIEW_IDS = Object.keys(SCENES);

export class GuidePreview {
  constructor(id) {
    this.id = id;
    this.def = SCENES[id];
    if (!this.def) throw new Error(`No field guide preview for ${id}`);
    this.W = this.def.w;
    this.H = Math.round(this.def.w * PREVIEW_ASPECT);
    this.manager = new EnemyManager({ maxEnemies: 40 });
    this.particles = new ParticleSystem();
    this.bolts = [];
    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, radius: TUNING.shipRadius ?? 15, angle: 0, drillAngle: 0, walkCycle: 0,
      hp: 100, maxHp: 100, invuln: 0, shieldFlash: 0, stats: { drillScale: TUNING.drillScale ?? 1.15 }
    };
    this.orbHit = (b) => {
      this.player.shieldFlash = 1;
      this.particles.spawnExplosionSparks(b.x, b.y, 8, 14, 2, 7, 2);
      return true;
    };
    this.reset();
  }

  reset() {
    this.manager.clear();
    this.particles.clear();
    this.bolts.length = 0;
    this.t = 0;
    this.fireTimer = 0.3;
    this.timers = {};
    this.known = new Set();
    this.tug = 0;
    this.burstAt = null;
    this.stepping = false;
    this.def.setup(this);
  }

  // --- script helpers ---
  home(fx, fy) {
    this.homeX = this.W * fx;
    this.homeY = this.H * fy;
    this.player.x = this.homeX;
    this.player.y = this.homeY;
    this.player.drillAngle = Math.PI;
  }

  hold() {
    const p = this.player;
    p.x += (this.homeX - p.x) * 0.05;
    p.y += (this.homeY - p.y) * 0.05;
  }

  kite(cx, cy, r, speed) {
    const p = this.player;
    const a = this.t * speed;
    p.x = cx + Math.cos(a) * r;
    p.y = cy + Math.sin(a) * r;
    p.drillAngle = a + Math.PI / 2;
    p.walkCycle += 0.25;
  }

  spawn(type, x, y, extra = {}) {
    return this.manager.queueSpawn(type, x, y, 1, { instant: true, ...extra });
  }

  find(type) {
    return this.manager.enemies.find(e => e.type === type && !e.dead) || null;
  }

  count(type = null) {
    let n = this.manager.spawnIndicators.length;
    for (const e of this.manager.enemies) if (!type || e.type === type) n++;
    return n;
  }

  // True once per `interval` seconds per call site (keyed by interval).
  every(interval) {
    const due = this.timers[interval] ?? 0;
    if (this.t < due) return false;
    this.timers[interval] = this.t + interval;
    return true;
  }

  fireAt(tx, ty) {
    const p = this.player;
    const a = Math.atan2(ty - p.y, tx - p.x);
    p.angle = a;
    this.bolts.push({ x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, vx: Math.cos(a) * BOLT_SPEED, vy: Math.sin(a) * BOLT_SPEED, life: 1.4, plateChecked: false });
  }

  autoFire(interval, filter = null) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.manager.enemies) {
      if (e.type === 'blackhole' || (filter && !filter(e))) continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) this.player.angle = Math.atan2(best.y - this.player.y, best.x - this.player.x);
    this.fireTimer -= PREVIEW_DT;
    if (!best || this.fireTimer > 0) return;
    this.fireTimer = interval;
    this.fireAt(best.x, best.y);
  }

  // A boss arrival flourish (shockwaves and sparks, like Game.onBossArrived).
  bossEntrance() {
    for (const e of this.manager.bossArrivals) {
      this.particles.spawnShockwave(e.x, e.y, 320, 48, 6, 0.6);
      this.particles.spawnShockwave(e.x, e.y, 200, e.hue, 4, 0.45);
      this.particles.spawnExplosionSparks(e.x, e.y, 30, 48, 3, 14, 2.4);
    }
    this.manager.bossArrivals.length = 0;
  }

  // A serpent winding in from the left edge.
  serpent() {
    spawnSerpent(this.manager, 'serpent', this.W * 0.12, this.H * 0.5, 1, SERPENT.segments, { angle: 0, extra: { instant: true } });
  }

  // A mayfly cloud drifting in from the left edge.
  cloud() {
    for (let k = 0; k < 10; k++) this.spawn('mayfly', this.W * (0.06 + Math.random() * 0.1), this.H * (0.3 + Math.random() * 0.4));
  }

  // The splitter death burst from Game.killEnemy: three fast minis thrown outward.
  splitterBurst(e) {
    this.particles.spawnShockwave(e.x, e.y, e.radius * 2.4, e.hue, 3, 0.2);
    for (let k = 0; k < 3; k++) {
      const a = e.rotation + (k * Math.PI * 2) / 3;
      this.manager.queueSpawn('mini_splitter', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, 1, { instant: true, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5 });
    }
  }

  // A SPLITTING lieutenant bursts into regular copies of its archetype (Game.killEnemy).
  splitCopies(e) {
    for (let k = 0; k < (e.splits || 0); k++) {
      const a = e.rotation + (k * Math.PI * 2) / e.splits;
      this.spawn(e.type, e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius);
    }
  }

  kill(e, fromContact = false) {
    const list = this.manager.enemies;
    const i = list.indexOf(e);
    if (i === -1) return;
    list.splice(i, 1);
    e.dead = true;
    this.particles.spawnPolygonShatter(e.x, e.y, e.radius * 0.7, e.sides, -e.rotation, e.hue, 0.8);
    this.particles.spawnExplosionSparks(e.x, e.y, 10, e.hue, 2, 9, 2);
    this.particles.spawnShockwave(e.x, e.y, e.radius * 2.2, e.hue, 2, 0.2);
    if (!fromContact) this.def.onKill?.(this, e);
  }

  hit(e, b) {
    if (e.deflect) {
      e.hitFlash = Math.max(e.hitFlash, 0.35);
      this.particles.spawnImpact(b.x, b.y, Math.atan2(-b.vy, -b.vx), 5, 0.08);
      return;
    }
    e.hp -= BOLT_DAMAGE * (e.armor ? 1 - e.armor : 1) * (e.linked > 0 ? 0.7 : 1);
    e.hitFlash = 1;
    e.sinceHit = 0;
    e.knockX += b.vx * 0.06 * (e.knockMult ?? 1) * (e.isBoss ? 0 : 1);
    e.knockY += b.vy * 0.06 * (e.knockMult ?? 1) * (e.isBoss ? 0 : 1);
    this.particles.spawnImpact(b.x, b.y, Math.atan2(b.vy, b.vx), 7, 0.1);
    if (e.hp <= 0) this.kill(e);
  }

  updateBolts() {
    const enemies = this.manager.enemies;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life -= PREVIEW_DT;
      let dead = b.life <= 0 || b.x < -20 || b.y < -20 || b.x > this.W + 20 || b.y > this.H + 20;
      for (let k = 0; !dead && k < enemies.length; k++) {
        const e = enemies[k];
        if (e.type === 'blackhole') continue;
        const d = Math.hypot(b.x - e.x, b.y - e.y);
        if (e.shieldArc && d < e.shieldRadius + 3) {
          if (!b.plateChecked && shieldBlocks(e, b.x, b.y, b.vx, b.vy)) {
            e.shieldFlash = 1;
            this.particles.spawnDirectionalSparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 0.9, 5, 195, 6);
            dead = true;
            break;
          }
          b.plateChecked = true;
        }
        if (d < e.radius + 4) {
          this.hit(e, b);
          dead = true;
        }
      }
      if (dead) this.bolts.splice(i, 1);
    }
  }

  updateContacts() {
    const p = this.player;
    const enemies = this.manager.enemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!shieldTouches(p, TUNING, e.x, e.y, e.radius)) continue;
      p.shieldFlash = 1;
      if (e.sturdy || e.isBoss || e.type === 'blackhole' || this.def.noContactKill) bounceFromShip(e, p.x, p.y);
      else this.kill(e, true);
    }
  }

  step(dt = PREVIEW_DT) {
    this.t += dt;
    if (this.t >= this.def.loop) {
      this.reset();
      return;
    }
    for (const e of this.manager.enemies) {
      if (this.known.has(e)) continue;
      this.known.add(e);
      this.def.onSpawn?.(this, e);
    }
    this.def.tick(this, dt);
    this.manager.update(dt, this.player, this.bolts, GRID_STUB, this.particles, this.W, this.H);
    this.manager.lieutenantArrivals.length = 0;
    for (const e of this.manager.doomed.splice(0)) this.kill(e);
    this.manager.enemyBullets.update(dt, this.player, null, this.particles, this.W, this.H, this.orbHit);
    this.updateBolts();
    this.updateContacts();
    this.particles.update(dt, this.W, this.H);
    if (this.player.shieldFlash > 0) this.player.shieldFlash = Math.max(0, this.player.shieldFlash - dt * 4);
  }

  drawBackdrop(ctx) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.strokeStyle = 'rgba(60, 110, 200, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < this.W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, this.H); }
    for (let y = 40; y < this.H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(this.W, y); }
    ctx.stroke();
  }

  // `scale` maps world px to canvas px (canvas width / W).
  draw(ctx, scale) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.drawBackdrop(ctx);
    const v = this.def === SCENES.blackhole ? this.find('blackhole') : null;
    if (v) {
      ctx.fillStyle = 'rgba(1, 1, 5, 0.94)';
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    this.manager.draw(ctx);
    this.drawBolts(ctx);
    if (v && this.tug > 0) this.drawTether(ctx, v);
    const now = this.t * 1000;
    drawPlayerShield(ctx, this.player, 0, TUNING, this.t * 1.4, now);
    drawCrabShip(ctx, this.player, TUNING, false, now);
    this.particles.draw(ctx);
    ctx.restore();
  }

  drawBolts(ctx) {
    if (!this.bolts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? `hsla(${TUNING.bulletColorHue ?? 186}, 100%, 60%, 0.55)` : '#ffffff';
      ctx.lineWidth = pass === 0 ? 8 : 3;
      ctx.beginPath();
      for (const b of this.bolts) {
        ctx.moveTo(b.x - b.vx * 1.4, b.y - b.vy * 1.4);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // The gravity tether the game draws while a vortex tugs the ship.
  drawTether(ctx, w) {
    const p = this.player;
    const d = Math.hypot(w.x - p.x, w.y - p.y) || 1;
    const ux = (w.x - p.x) / d;
    const uy = (w.y - p.y) / d;
    ctx.save();
    ctx.setLineDash([4, 9]);
    ctx.lineDashOffset = -this.t * 40;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `hsla(${w.hue}, 100%, 66%, ${0.1 + this.tug * 0.65})`;
    ctx.beginPath();
    ctx.moveTo(p.x + ux * (p.radius + 10), p.y + uy * (p.radius + 10));
    ctx.lineTo(w.x - ux * w.radius * 1.2, w.y - uy * w.radius * 1.2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// Locked entries: the hostile's real silhouette, flattened to one dark tone (no animation).
const SILHOUETTE = {
  swarmer: ['swarmer', 120], pinwheel: ['pinwheel', 140], weaver: ['weaver', 130], splitter: ['splitter', 170],
  mini_splitter: ['mini_splitter', 100], blackhole: ['blackhole', 220], bruiser: ['bruiser', 200], gunner: ['gunner', 140],
  shielder: ['shielder', 170], blinker: ['blinker', 130], conduit: ['conduit', 150], lieutenant: ['bruiser', 260], boss: ['boss', 360],
  mayfly: ['mayfly', 70], hulk: ['hulk', 320], brood_queen: ['brood_queen', 340], serpent: ['serpent', 110], ouroboros: ['ouroboros', 260],
  kestrel: ['kestrel', 90], wing_commander: ['wing_commander', 260],
  carrier: ['carrier', 150], drone: ['drone', 60], hive_carrier: ['hive_carrier', 300]
};

export function drawSilhouette(ctx, id, canvasW, canvasH) {
  const [type, w] = SILHOUETTE[id] || [id, 160];
  const h = w * PREVIEW_ASPECT;
  const m = new EnemyManager({ maxEnemies: 2 });
  m.queueSpawn(type, w / 2, h / 2, 1, { instant: true });
  const sp = m.spawnIndicators[0];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (sp) {
    sp.timer = 0;
    m.update(0, { x: w * 4, y: h / 2 }, [], GRID_STUB, PARTICLE_STUB, w, h);
    const e = m.enemies[0];
    if (e) {
      e.rotation = type === 'weaver' || type === 'gunner' || type === 'bruiser' ? 0 : e.rotation;
      e.pulsePhase = 0;
      e.trail.length = 0;
      ctx.setTransform(canvasW / w, 0, 0, canvasW / w, 0, 0);
      m.draw(ctx);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#26324a';
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.restore();
}
