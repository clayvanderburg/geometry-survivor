// Graviton Mortar (weapon id 'quake', kept from its first name so saves and run stats keep working): an
// autonomous slot weapon. Every volley interval the mortar lobs `count` graviton charges at the densest
// packs in range (or around the ship when nothing is in range). A charge arcs over the field with a
// targeting reticle under it, then bursts into a GRAVITY WAVE: space-time pinches in, then a ring rolls
// out through the warp grid. Every enemy the wave front passes takes one hit (full at the burst, a
// little less at the rim) and is shoved outward. The base weapon never touches rocks: with Tidal Shear
// cards every rock a wave passes takes mining damage, and Spacetime Fractures shear the rocks they cross,
// so mining is an opt-in upgrade (a broken rock counts as mined, ore and all).
//
// Breakthroughs: Rebound Pulse (a burst charge rebounds to the next pack twice, pulsing again in smaller
// waves), Spacetime Fractures (every main burst tears three seams in space-time that snap shut a moment
// later) and Graviton Surge (every third volley the hull itself releases a huge wave around the ship).
//
// Charges, waves and fractures live in fixed pools (each wave keeps its own reusable hit sets, so an
// enemy or rock is hit once per wave) and are simulated only from Game.update, so pause, hit-stop and
// slow-mo freeze them with the rest of the world. Damage goes through Game.hitEnemy (source 'quake').
import { WEAPON_SCALING as W, weaponDamage, quakeRadius } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { isDeployableTarget } from './deployables.js';

const HUE = 32;            // graviton amber-gold; the wave front burns white-hot
const LENS = 300;          // magenta ghost ring a few px out: the wave lensing the light behind it
const SEAM = 186;          // cyan edge of a spacetime fracture (gold on the other side)
const SHELL_POOL = 48;     // shells in flight: up to 6 per volley (+2 skips each), a volley every ~0.5 s at max rate
const RING_POOL = 40;      // live rings (each ~0.5 s), skips and Epicenter slams included
const FAULT_POOL = 36;     // fissures waiting to erupt or fading (3 per main impact)
const MAX_CANDIDATES = 24; // nearest enemies scored as pack centres for a volley
const LEAD = 0.6;          // share of a target's motion over the flight the shell leads

const ease = (k) => 1 - (1 - k) * (1 - k); // the ring rolls out fast, then slows as it spreads
// Charge height along the flight (the top-down view's arc over the field): it climbs quickly, hangs near
// the apex, then drops hard onto the reticle (the last third falls faster than it rose), so every burst
// reads as a heavy slam.
const shellHeight = (h, k) => {
  const q = Math.pow(Math.min(1, Math.max(0, k)), 0.72);
  return h * 4 * q * (1 - q);
};

export class QuakeMortar {
  constructor() {
    this.shells = Array.from({ length: SHELL_POOL }, () => ({
      sx: 0, sy: 0, lx: 0, ly: 0, x: 0, y: 0, z: 0, h: 0, age: 0, flight: 0, damage: 0, radius: 0, rock: 0, skips: 0, scale: 1, spin: 0, stat: 'quake', fault: false
    }));
    this.rings = Array.from({ length: RING_POOL }, () => ({
      x: 0, y: 0, age: 0, life: 0, radius: 0, prevR: 0, damage: 0, rock: 0, knock: 0, stat: 'quake', big: false, hit: new Set(), rocks: [], rocksHit: new Set()
    }));
    this.faults = Array.from({ length: FAULT_POOL }, () => ({
      x1: 0, y1: 0, x2: 0, y2: 0, age: 0, delay: 0, damage: 0, rock: 0, erupted: false, jag: new Float32Array(6)
    }));
    this.cand = new Array(MAX_CANDIDATES).fill(null);
    this.candD = new Float64Array(MAX_CANDIDATES);
    this.score = new Float64Array(MAX_CANDIDATES);
    this.picks = [];
    this.broken = [];
    this.clear();
  }

  // Run reset: nothing in the air, the first volley shortly after the run starts.
  clear() {
    this.shellCount = 0;
    this.ringCount = 0;
    this.faultCount = 0;
    this.timer = 0.8;
    this.time = 0;
    this.volleys = 0;
    // Bench / test counters: rings that went off and the enemies their fronts hit.
    this.ringsFired = 0;
    this.ringHits = 0;
    this.cand.fill(null);
    for (const r of this.rings) { r.hit.clear(); r.rocksHit.clear(); r.rocks.length = 0; }
  }

  get activeCount() {
    return this.shellCount + this.ringCount + this.faultCount;
  }

  update(dt, game) {
    const p = game.player;
    const owned = (p.weapons.quake || 0) > 0;
    if (!owned && this.activeCount === 0) return;
    this.time += dt;
    if (owned) {
      this.timer -= dt;
      if (this.timer <= 0 && game.enemyManager.enemies.length > 0) {
        const b = weaponBuild(p, 'quake');
        this.fireVolley(game, b);
        this.timer = W.quakeCooldown(b);
      }
    }
    // Shells: fly, then land as a quake (skips spawn the next shell from the landing).
    for (let i = this.shellCount - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      s.spin += dt * 4;
      const k = Math.min(1, s.age / s.flight);
      s.x = s.sx + (s.lx - s.sx) * k;
      s.y = s.sy + (s.ly - s.sy) * k;
      s.z = shellHeight(s.h, k);
      if (k < 1) continue;
      this.shells[i] = this.shells[this.shellCount - 1];
      this.shells[--this.shellCount] = s;
      this.land(game, s);
    }
    // Rings: the front rolls out and hits what it passes.
    for (let i = this.ringCount - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      this.sweep(game, r);
      if (r.age < r.life) continue;
      this.rings[i] = this.rings[this.ringCount - 1];
      this.rings[--this.ringCount] = r;
    }
    // Fault lines: glow while the crack runs, then erupt along their length once.
    for (let i = this.faultCount - 1; i >= 0; i--) {
      const f = this.faults[i];
      f.age += dt;
      if (!f.erupted && f.age >= f.delay) this.erupt(game, f);
      if (f.age < f.delay + 0.35) continue;
      this.faults[i] = this.faults[this.faultCount - 1];
      this.faults[--this.faultCount] = f;
    }
    this.flushRocks(game);
  }

  // Pack centres for a volley, into this.picks: each nearby enemy is scored by how many others stand
  // inside one ring radius of it; the best goes first, then each next pick is the best one that is not
  // already under an earlier pick's ring, so a volley spreads over the packs instead of stacking.
  // Candidates are the nearest enemies between minD and range of (x, y).
  pickPacks(game, x, y, minD, range, radius, max) {
    const enemies = game.enemyManager.enemies;
    const c = this.cand, d = this.candD, score = this.score;
    let n = 0;
    const rangeSq = range * range, minSq = minD * minD;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!isDeployableTarget(e)) continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq > rangeSq || dSq < minSq || (n === MAX_CANDIDATES && dSq >= d[n - 1])) continue;
      let j = n < MAX_CANDIDATES ? n++ : n - 1;
      while (j > 0 && d[j - 1] > dSq) { c[j] = c[j - 1]; d[j] = d[j - 1]; j--; }
      c[j] = e;
      d[j] = dSq;
    }
    const rSq = radius * radius;
    for (let i = 0; i < n; i++) {
      const e = c[i];
      let s = 0;
      for (let k = 0; k < enemies.length; k++) {
        const o = enemies[k];
        if (!o.dead && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= rSq) s++;
      }
      score[i] = s - Math.sqrt(d[i]) / range * 0.5; // nearer packs win ties
    }
    const picks = this.picks;
    picks.length = 0;
    for (let k = 0; k < max; k++) {
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (!c[i]) continue;
        let taken = false;
        for (let j = 0; j < picks.length; j++) if ((c[i].x - picks[j].x) ** 2 + (c[i].y - picks[j].y) ** 2 < rSq) { taken = true; break; }
        if (!taken && (best < 0 || score[i] > score[best])) best = i;
      }
      if (best < 0) break;
      picks.push(c[best]);
      c[best] = null;
    }
    for (let i = 0; i < n; i++) c[i] = null;
    return picks.length;
  }

  fireVolley(game, b) {
    const p = game.player;
    const n = W.quakeShells(b);
    const range = W.quakeRange;
    const radius = quakeRadius(p, b);
    const found = this.pickPacks(game, p.x, p.y, 0, range, radius, n);
    const damage = weaponDamage(p, 'quake', b);
    const mine = (p.stats.miningSpeed || 75) / 75;
    const rock = W.quakeRockDamage(b) * mine;
    this.faultRock = (W.faultRockDamage + W.quakeRockDamage(b)) * mine;
    const lead = W.quakeFlight * 60 * LEAD;
    for (let k = 0; k < n && this.shellCount < SHELL_POOL; k++) {
      let tx, ty;
      if (found > 0) {
        const e = this.picks[k % found];
        tx = e.x + (e.vx || 0) * lead;
        ty = e.y + (e.vy || 0) * lead;
        if (k >= found) {
          // More shells than packs: the extras land just past the pack's ring, around it.
          const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
          tx += Math.cos(a) * radius * 0.9;
          ty += Math.sin(a) * radius * 0.9;
        }
      } else {
        const a = p.angle + (k / n) * Math.PI * 2;
        tx = p.x + Math.cos(a) * range * 0.55;
        ty = p.y + Math.sin(a) * range * 0.55;
      }
      let dx = tx - p.x, dy = ty - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > range) { dx *= range / dist; dy *= range / dist; }
      this.launch(p.x + (dx / dist) * (p.radius || 15) * 0.5, p.y + (dy / dist) * (p.radius || 15) * 0.5, p.x + dx, p.y + dy,
        W.quakeFlight * (0.92 + 0.16 * (k / Math.max(1, n - 1))), damage, radius, rock, b.t4 ? W.skipBounces : 0, 1, 'quake', b.t8);
    }
    for (let k = 0; k < this.picks.length; k++) this.picks[k] = null;
    this.volleys++;
    const fx = game.particles;
    fx.spawnFlash?.(p.x, p.y, 22, HUE, 0.14);
    fx.spawnShockwave(p.x, p.y, 30, HUE, 2.5, 0.22);
    game.sound.playQuakeLaunch?.(n);
    if (b.t12 && this.volleys % W.epicenterEvery === 0) this.epicenter(game, damage * W.epicenterShare * n, radius * W.epicenterRadiusMult, rock);
  }

  launch(sx, sy, lx, ly, flight, damage, radius, rock, skips, scale, stat, fault) {
    if (this.shellCount >= SHELL_POOL) return;
    const s = this.shells[this.shellCount++];
    s.sx = s.x = sx; s.sy = s.y = sy;
    s.lx = lx; s.ly = ly;
    s.z = 0;
    s.h = (60 + Math.hypot(lx - sx, ly - sy) * 0.35) * scale;
    s.age = 0;
    s.flight = flight;
    s.damage = damage;
    s.radius = radius;
    s.rock = rock;
    s.skips = skips;
    s.scale = scale;
    s.stat = stat;
    s.fault = fault;
    s.spin = Math.random() * Math.PI * 2;
  }

  land(game, s) {
    this.quake(game, s.lx, s.ly, s.radius, s.damage, s.rock, W.quakeKnock * s.scale, s.stat, false);
    if (s.fault) this.tearFaults(game, s);
    if (s.skips > 0) this.skip(game, s);
  }

  // A gravity wave bursts at (x, y). `big` waves (Graviton Surge) draw heavier.
  quake(game, x, y, radius, damage, rock, knock, stat, big) {
    if (this.ringCount < RING_POOL) {
      const r = this.rings[this.ringCount++];
      r.x = x; r.y = y;
      r.age = 0;
      r.life = W.quakeRingTime * (big ? 1.3 : 1);
      r.radius = radius;
      r.prevR = -1;
      r.damage = damage;
      r.rock = rock;
      r.knock = knock;
      r.stat = stat;
      r.big = big;
      r.hit.clear();
      r.rocksHit.clear();
      r.rocks.length = 0;
      const am = game.asteroidManager;
      if (am && rock > 0) {
        const near = am.getNearbyAsteroids(x, y, am.cellsFor(radius));
        for (let i = 0; i < near.length; i++) if (!near[i].unbreakable && near[i].hp > 0) r.rocks.push(near[i]);
      }
      this.ringsFired++;
    }
    const fx = game.particles;
    const small = radius / 120;
    const heft = Math.min(1.6, small);
    // Pinch, then release: space-time snaps inward onto the burst point (an inward ring and an implosion
    // of the warp grid), then the wave rolls out (a white-hot flash, a gold ring and the grid ripple).
    fx.spawnShockwave(x, y, radius * 0.42, LENS, 2.5 * heft + 1, 0.12, true);
    game.grid?.applyImplosion?.(x, y, big ? 26 : 14 * heft, radius * 0.7, HUE, 0.15);
    fx.spawnFlash?.(x, y, radius * 0.45, HUE + 12, 0.18);
    fx.spawnShockwave(x, y, radius * 0.18, 50, 5 * heft + 1, 0.12);
    fx.spawnShockwave(x, y, radius * 0.35, HUE, 3, 0.2);
    fx.spawnExplosionSparks(x, y, Math.round(8 + 8 * small), HUE, 2, 9, 2.2);
    game.grid?.applyImpulse(x, y, big ? 80 : 46 * Math.min(1.5, small), radius * 1.3, HUE);
    game.grid?.ripple?.(x, y, radius, HUE, big ? 1.8 : 1.2);
    game.sound.playQuakeImpact?.(big ? 1.4 : Math.min(1, 0.55 + 0.45 * small));
    game.addShake?.(big ? 8 : 1.5 + 2 * Math.min(1, small * small)); // a skip barely nudges, a full shell thuds
  }

  // The ring front between last tick's radius and this one's hits everything it crosses, once.
  sweep(game, r) {
    const k = Math.min(1, r.age / r.life);
    const cur = r.radius * ease(k);
    const prev = r.prevR;
    r.prevR = cur;
    const enemies = game.enemyManager.enemies;
    const fall = W.quakeEdgeFalloff;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!isDeployableTarget(e) || r.hit.has(e)) continue;
      const dx = e.x - r.x, dy = e.y - r.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d - e.radius > cur || d + e.radius < prev) continue;
      r.hit.add(e);
      this.ringHits++;
      const u = d || 1;
      const reach = Math.max(0, Math.min(1, (d - e.radius) / r.radius));
      game.hitEnemy(e, r.damage * (1 - fall * reach), 'quake', (dx / u) * r.knock, (dy / u) * r.knock, 1, r.stat);
      if (i >= enemies.length) i = enemies.length; // a kill can shrink the list mid-sweep
    }
    for (let i = 0; i < r.rocks.length; i++) {
      const rock = r.rocks[i];
      if (rock.hp <= 0 || r.rocksHit.has(rock)) continue;
      const d = Math.hypot(rock.x - r.x, rock.y - r.y);
      if (d - rock.radius > cur || d + rock.radius < prev) continue;
      r.rocksHit.add(rock);
      this.crackRock(game, rock, r.x, r.y, r.rock);
    }
  }

  // Rock damage from a ring or fissure, from (fx, fy): the same cracks, flash and chips as the drill.
  crackRock(game, rock, fx, fy, dmg) {
    const am = game.asteroidManager;
    if (!am?.quakeRock) return;
    if (am.quakeRock(rock, fx, fy, dmg, game.particles)) this.broken.push(rock);
  }

  // Rocks broken this tick leave the field through the normal shatter path (counted as mined).
  flushRocks(game) {
    if (this.broken.length === 0) return;
    const am = game.asteroidManager;
    for (let i = 0; i < this.broken.length; i++) {
      const rock = this.broken[i];
      const at = am.asteroids.indexOf(rock);
      if (at < 0) continue;
      am.asteroids.splice(at, 1);
      am.loosenAround?.(rock);
      game.onRockShattered?.(rock);
    }
    this.broken.length = 0;
    am.rebuildSpatialHash();
  }

  // Skipping Shells: the shell hops on to the densest pack just past its own ring (or straight on).
  skip(game, s) {
    const first = s.stat === 'quake';
    const radius = first ? s.radius * W.skipRadiusFrac : s.radius;
    const found = this.pickPacks(game, s.lx, s.ly, s.radius * (first ? 1 : 1.3), W.skipRange + s.radius, radius, 1);
    const best = found > 0 ? this.picks[0] : null;
    this.picks.length = 0;
    let tx, ty;
    if (best) {
      tx = best.x; ty = best.y;
    } else {
      const dx = s.lx - s.sx, dy = s.ly - s.sy;
      const len = Math.hypot(dx, dy) || 1;
      tx = s.lx + (dx / len) * W.skipRange * 0.6;
      ty = s.ly + (dy / len) * W.skipRange * 0.6;
    }
    const damage = first ? s.damage * W.skipShare : s.damage;
    this.launch(s.lx, s.ly, tx, ty, W.skipFlight, damage, radius, s.rock, s.skips - 1, 0.55, 'quake_skip', false);
  }

  // Fault Lines: three fissures from the impact, each torn toward its own enemy past the ring (the
  // nearest ones at least 50 degrees apart), the rest spaced evenly round the impact.
  tearFaults(game, s) {
    const len = s.radius * W.faultLengthMult;
    const n = this.pickPacks(game, s.lx, s.ly, s.radius * 0.7, len, W.faultWidth * 3, MAX_CANDIDATES);
    const angles = this.faultAngles || (this.faultAngles = []);
    angles.length = 0;
    for (let i = 0; i < n && angles.length < W.faultCount; i++) {
      const e = this.picks[i];
      const a = Math.atan2(e.y - s.ly, e.x - s.lx);
      let ok = true;
      for (let j = 0; j < angles.length; j++) if (Math.abs(((a - angles[j]) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.87) { ok = false; break; }
      if (ok) angles.push(a);
    }
    for (let i = 0; i < this.picks.length; i++) this.picks[i] = null;
    this.picks.length = 0;
    const a0 = angles.length ? angles[0] : Math.random() * Math.PI * 2;
    for (let k = angles.length; k < W.faultCount; k++) angles.push(a0 + (k * Math.PI * 2) / W.faultCount);
    for (let k = 0; k < W.faultCount && this.faultCount < FAULT_POOL; k++) {
      const a = angles[k];
      const f = this.faults[this.faultCount++];
      f.x1 = s.lx; f.y1 = s.ly;
      f.x2 = s.lx + Math.cos(a) * len;
      f.y2 = s.ly + Math.sin(a) * len;
      f.age = 0;
      f.delay = W.faultDelay * (0.85 + 0.3 * Math.random());
      f.damage = s.damage * W.faultShare;
      f.rock = this.faultRock || 0;
      f.erupted = false;
      for (let j = 0; j < f.jag.length; j++) f.jag[j] = (Math.random() - 0.5) * 2;
    }
  }

  erupt(game, f) {
    f.erupted = true;
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const enemies = game.enemyManager.enemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!isDeployableTarget(e)) continue;
      const t = (e.x - f.x1) * ux + (e.y - f.y1) * uy;
      if (t < 0 || t > len) continue;
      const side = (e.x - f.x1) * -uy + (e.y - f.y1) * ux;
      if (Math.abs(side) > W.faultWidth + e.radius) continue;
      const s = side >= 0 ? 1 : -1; // thrown off the fissure, sideways
      game.hitEnemy(e, f.damage, 'quake', -uy * s * W.quakeKnock * 0.8, ux * s * W.quakeKnock * 0.8, 1, 'quake_fault');
      if (i >= enemies.length) i = enemies.length;
    }
    const am = game.asteroidManager;
    if (am && f.rock > 0) {
      const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
      const near = am.getNearbyAsteroids(mx, my, am.cellsFor(len / 2));
      for (let i = 0; i < near.length; i++) {
        const rock = near[i];
        if (rock.unbreakable || rock.hp <= 0) continue;
        const t = (rock.x - f.x1) * ux + (rock.y - f.y1) * uy;
        const side = Math.abs((rock.x - f.x1) * -uy + (rock.y - f.y1) * ux);
        if (t >= -rock.radius && t <= len + rock.radius && side <= W.faultWidth + rock.radius) this.crackRock(game, rock, f.x1 + ux * t, f.y1 + uy * t, f.rock);
      }
    }
    // The seam snaps shut: light spills off both edges and the warp grid kinks along its whole length.
    const fx = game.particles;
    for (let k = 1; k <= 4; k++) {
      const q = k / 4;
      const x = f.x1 + dx * q, y = f.y1 + dy * q;
      fx.spawnDirectionalSparks?.(x, y, Math.atan2(ux, -uy), 0.6, 2, SEAM, 7);
      fx.spawnDirectionalSparks?.(x, y, Math.atan2(-ux, uy), 0.6, 2, HUE, 7);
      game.grid?.applyImpulse(x, y, 16, 70, SEAM);
    }
    fx.spawnFlash?.(f.x2, f.y2, 26, SEAM, 0.14);
    game.sound.playQuakeFault?.();
  }

  // Graviton Surge: the hull itself releases a huge gravity wave around the ship.
  epicenter(game, damage, radius, rock) {
    const p = game.player;
    this.quake(game, p.x, p.y, radius, damage, rock, W.quakeKnock * W.epicenterKnockMult, 'quake_epicenter', true);
    game.particles.spawnShockwave(p.x, p.y, radius * 0.6, LENS, 5, 0.3);
    game.requestHitStop?.(1);
  }

  // ---- Rendering (additive layer, world space). Animation runs on this.time, so it freezes with the sim. ----
  inView(game, x, y, pad) {
    return x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
  }

  // Field layer (under enemies): targeting reticles, spacetime fractures and the gravity waves.
  drawGround(ctx, game) {
    if (this.activeCount === 0) return;
    const t = this.time;
    // Reticles: a crosshair diamond at the burst point that closes in as the charge drops, and a faint
    // ghost of the wave it will throw.
    for (let i = 0; i < this.shellCount; i++) {
      const s = this.shells[i];
      if (!this.inView(game, s.lx, s.ly, s.radius)) continue;
      const k = Math.min(1, s.age / s.flight);
      const m = (18 - 9 * k) * (0.6 + 0.4 * s.scale);
      ctx.strokeStyle = `hsla(${HUE}, 100%, 62%, ${0.25 + 0.5 * k})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.lx, s.ly - m); ctx.lineTo(s.lx + m, s.ly); ctx.lineTo(s.lx, s.ly + m); ctx.lineTo(s.lx - m, s.ly); ctx.closePath();
      ctx.moveTo(s.lx - m * 1.6, s.ly); ctx.lineTo(s.lx - m * 1.1, s.ly);
      ctx.moveTo(s.lx + m * 1.1, s.ly); ctx.lineTo(s.lx + m * 1.6, s.ly);
      ctx.moveTo(s.lx, s.ly - m * 1.6); ctx.lineTo(s.lx, s.ly - m * 1.1);
      ctx.moveTo(s.lx, s.ly + m * 1.1); ctx.lineTo(s.lx, s.ly + m * 1.6);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${HUE}, 100%, 60%, ${0.05 + 0.12 * k})`;
      ctx.setLineDash?.([6, 8]);
      ctx.beginPath();
      ctx.arc(s.lx, s.ly, s.radius, t * 0.6, t * 0.6 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash?.([]);
    }
    // Fractures: a seam that tears out from the burst, split into a gold and a cyan edge that drift apart
    // as it opens; when it snaps shut it flares white and fades.
    for (let i = 0; i < this.faultCount; i++) {
      const f = this.faults[i];
      if (!this.inView(game, (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, Math.hypot(f.x2 - f.x1, f.y2 - f.y1))) continue;
      const run = Math.min(1, f.age / f.delay);
      const after = f.erupted ? Math.min(1, (f.age - f.delay) / 0.35) : 0;
      const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const nx = -dy * 0.03, ny = dx * 0.03;
      const segs = f.jag.length;
      const gap = f.erupted ? 0 : 1 + 3 * run; // the edges part while the seam is open
      for (let side = -1; side <= 1; side += 2) {
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        for (let j = 1; j <= segs; j++) {
          const q = (j / segs) * run;
          const jit = j < segs ? f.jag[j - 1] : 0;
          const o = gap * side * Math.sin(Math.PI * Math.min(1, j / segs));
          ctx.lineTo(f.x1 + dx * q + nx * jit + px * o, f.y1 + dy * q + ny * jit + py * o);
        }
        if (f.erupted) {
          ctx.strokeStyle = `hsla(${side < 0 ? SEAM : HUE}, 100%, 75%, ${0.45 * (1 - after)})`;
          ctx.lineWidth = 8 * (1 - after) + 2;
          ctx.stroke();
          ctx.strokeStyle = `hsla(0, 0%, 100%, ${0.85 * (1 - after)})`;
          ctx.lineWidth = 1.6;
        } else {
          ctx.strokeStyle = `hsla(${side < 0 ? SEAM : HUE}, 100%, 66%, ${0.35 + 0.55 * run})`;
          ctx.lineWidth = 1.6;
        }
        ctx.stroke();
      }
    }
    // Gravity waves: a thin white-hot front with a gold glow, a magenta ghost just outside it (lensing),
    // and a cyan echo trailing inside, all fading as the wave spreads.
    for (let i = 0; i < this.ringCount; i++) {
      const r = this.rings[i];
      if (!this.inView(game, r.x, r.y, r.radius + 20)) continue;
      const k = Math.min(1, r.age / r.life);
      const cur = r.radius * ease(k);
      const fade = 1 - k;
      const w = (r.big ? 1.6 : 1) * (1 + 1.4 * Math.max(0, 1 - k / 0.18)); // a fat, punchy front at the burst that thins as it spreads
      ctx.strokeStyle = `hsla(${HUE}, 100%, 58%, ${0.5 * fade})`;
      ctx.lineWidth = 12 * w * fade + 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, cur, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${HUE + 12}, 100%, 92%, ${Math.min(1, 1.2 * fade)})`;
      ctx.lineWidth = 3.2 * w;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${LENS}, 100%, 70%, ${0.6 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, cur + 4 + 6 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${SEAM}, 100%, 72%, ${0.5 * fade})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, cur * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Air layer (over enemies): charges in flight, lifted by their arc.
  drawAir(ctx, game) {
    if (this.shellCount === 0) return;
    for (let i = 0; i < this.shellCount; i++) {
      const s = this.shells[i];
      if (!this.inView(game, s.x, s.y - s.z, 40)) continue;
      // Trail: a few fading points back along the arc, so the charge's weight and drop read in motion.
      const kk = Math.min(1, s.age / s.flight);
      for (let j = 1; j <= 4; j++) {
        const kj = Math.max(0, kk - j * 0.035);
        const tx = s.sx + (s.lx - s.sx) * kj, ty = s.sy + (s.ly - s.sy) * kj - shellHeight(s.h, kj);
        ctx.fillStyle = `hsla(${j % 2 ? HUE : LENS}, 100%, 66%, ${0.45 - j * 0.1})`;
        ctx.beginPath();
        ctx.arc(tx, ty, (5 - j) * s.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      const lift = 1 + s.z / 160;
      const r = 6.5 * s.scale * lift;
      const y = s.y - s.z;
      // A graviton charge: a hot core in a soft halo, with a tilted orbit ring spinning round it.
      ctx.fillStyle = `hsla(${HUE}, 100%, 55%, 0.22)`;
      ctx.beginPath();
      ctx.arc(s.x, y, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(s.x, y);
      ctx.rotate(s.spin);
      ctx.strokeStyle = `hsla(${LENS}, 100%, 72%, 0.9)`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.6, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = `hsla(${HUE}, 100%, 66%, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `hsla(${HUE + 15}, 100%, 88%, 0.95)`;
      ctx.beginPath();
      ctx.arc(s.x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
