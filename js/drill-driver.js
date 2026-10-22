// Drill Driver (weapon id `harpoon`, kept for stats history): a PRIMARY slot weapon. While firing, the ship
// spins up a drill bit at its nose and fires it along the turret aim. The bit bores through every enemy on
// its line once (each one behind takes W.harpoonPierceKeep of the last, kill or not)
// and through rock: it breaks rock worth W.harpoonDrill rock HP per bit (x the ship's drill speed) and bites
// to a stop in the first rock it can't finish. Bedrock always stops it, and so does an armored serpent plate.
// Rock a bit breaks is your mining: it counts as rocks mined and drops its ore like a drill bite. A spent bit
// crumbles where it stops; a new one is already spinning up at the nose.
//
// Nothing here ever moves an enemy toward the ship: every hit's knockback points away from the ship
// (awayKnock), and contact damage works exactly as it does for every other weapon.
//
// Breakthroughs: Twin Drills (two bits per launch, fanned apart), Drill Spin (a bit spins in place where it
// stops, grinding everything round its tip), Ricochet Bits (a spent bit caroms on to up to W.chainLeaps
// more enemies near its tip), and in the pool Detonator Bit (the bit screws into the first enemy that survives
// it and blows) and Tunnel Bore (the bore it leaves keeps cutting for a moment).
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'harpoon';
// stats 'harpoonspin', 'harpoonchain', 'harpoonblast', 'harpoontunnel' for the Breakthrough hits).
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, areaMult } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { kickShipRecoil } from './ship-renderer.js';

export const DRILL_HUE = 48;         // drill gold (the ship's drillJawColor)
const BIT_COLOR = '#00ffaa';         // the ship's drill colour while it bites (drillActiveColor)
const THREAD_COLOR = '#ffcc00';      // gold threads (drillJawColor)
const MAX_SWEEP = 24;                // enemies one tick of flight can bore (a dense line still hits them all over a few ticks)
const MAX_BITS = 24;                 // bits in the air at once (a safety cap; a normal build has 2-6)
const BLAST_KNOCK = 2.5;             // Detonator Bit knockback, px/tick, always away from the ship
const TRAIL = 6;                     // trail points kept per bit

// Enemies a bit can hit: alive and hittable.
const target = (e) => !e.dead && !e.invulnerable;

// Point (px, py) against segment (ax, ay) -> (bx, by): squared distance and the position t along it (0..1).
function segDist(px, py, ax, ay, bx, by, out) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  out.t = t;
  return cx * cx + cy * cy;
}

// Knockback of `k` px/tick pointing from the ship to the enemy: a drill hit never shoves anything toward you.
function awayKnock(game, e, k, out) {
  const p = game.player;
  let dx = e.x - p.x, dy = e.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > 1e-6) { dx /= d; dy /= d; } else { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
  out.x = dx * k;
  out.y = dy * k;
  return out;
}

// Where a new bit leaves the hull: on the aim line, just past the nose.
export function drillMuzzle(p, out = { x: 0, y: 0 }) {
  const nose = (p.radius || 15) * 1.25;
  out.x = p.x + Math.cos(p.angle) * nose;
  out.y = p.y + Math.sin(p.angle) * nose;
  return out;
}

export class DrillDriver {
  constructor() {
    this.bits = [];
    this.tunnels = [];
    this.sweep = [];
    this.seg = { t: 0 };
    this.kick = { x: 0, y: 0 };
    this.muzzle = { x: 0, y: 0 };
    this.broken = [];
    this.clear();
  }

  // Run reset: no bits out, the next one is spun up and ready.
  clear() {
    this.bits.length = 0;
    this.tunnels.length = 0;
    this.cd = 0;
    this.cycle = 0;
    this.time = 0;
    this.shotId = 0;
    this.shots = 0;
    this.rocksBroken = 0;
    this.blasts = 0;
    this.muzzleFlash = 0;
    this.sweep.length = 0;
  }

  // Spin-up of the next bit, 0 (just fired) .. 1 (ready).
  get charge() {
    return this.cycle > 0 ? Math.max(0, Math.min(1, 1 - this.cd / this.cycle)) : 1;
  }

  update(dt, game, firing) {
    const p = game.player;
    this.time += dt;
    if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    if (!((p?.weapons?.harpoon || 0) > 0)) {
      if (this.bits.length || this.tunnels.length) this.clear();
      return;
    }
    this.game = game;
    if (this.cd > 0) this.cd = this.cd - dt > 1e-9 ? this.cd - dt : 0;
    const b = weaponBuild(p, 'harpoon');
    if (firing && this.cd <= 0) this.launch(game, b);
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const bit = this.bits[i];
      bit.phaseT += dt;
      if (bit.flash > 0) bit.flash = Math.max(0, bit.flash - dt);
      if (bit.phase === 'fly') this.fly(game, b, bit, dt);
      else if (bit.phase === 'spin') this.spin(game, b, bit);
      else if (bit.phase === 'chain') this.leap(game, b, bit);
      else if (bit.phase === 'lodge') this.lodge(game, b, bit);
      if (bit.phase === 'done') this.bits.splice(i, 1);
    }
    this.cutTunnels(game, dt);
  }

  launch(game, b) {
    const p = game.player;
    const cycle = W.harpoonCooldown(b);
    this.cycle = cycle;
    this.cd = cycle;
    this.shotId++;
    this.shots++;
    const dmg = weaponDamage(p, 'harpoon', b);
    const m = drillMuzzle(p, this.muzzle);
    const angles = b.t4 ? [p.angle - W.twinSpread / 2, p.angle + W.twinSpread / 2] : [p.angle];
    for (let k = 0; k < angles.length && this.bits.length < MAX_BITS; k++) {
      const a = angles[k];
      this.bits.push({
        id: this.shotId * 4 + k, // each bit hits an enemy once; twin bits are separate bits
        x: m.x, y: m.y, sx: m.x, sy: m.y,
        dirX: Math.cos(a), dirY: Math.sin(a),
        dist: 0,
        range: W.harpoonRange(b),
        dmg,
        pierceMult: 1,
        keep: W.harpoonPierceKeep(b),
        drillLeft: W.harpoonDrill(b) * ((p.stats?.miningSpeed || TUNING.miningSpeed || 75) / (TUNING.miningSpeed || 75)),
        phase: 'fly', phaseT: 0,
        spun: false, spinTick: 0,
        leapsLeft: 0, leapTarget: null,
        lodged: null,
        trail: [],
        flash: 0
      });
    }
    // Launch kick: the turret recoils, a gold muzzle flash and spark spray, a ripple and a nudge of shake.
    this.muzzleFlash = 0.1;
    kickShipRecoil(p, b.t4 ? 1.2 : 1);
    game.particles.spawnFlash?.(m.x, m.y, 18, DRILL_HUE, 0.08);
    game.particles.spawnDirectionalSparks?.(m.x, m.y, p.angle, 0.5, 7, DRILL_HUE, 9);
    game.grid?.applyImpulse?.(m.x, m.y, 12, 70, DRILL_HUE);
    game.addShake?.(b.t4 ? 1.6 : 1.2);
    game.sound.playDrillLaunch?.(b.t4 ? 2 : 1);
  }

  fly(game, b, bit, dt) {
    const step = Math.min(bit.range - bit.dist, W.harpoonSpeed * dt);
    const ax = bit.x, ay = bit.y;
    let bx = ax + bit.dirX * step, by = ay + bit.dirY * step;
    // Rock first: a bite or a bedrock clang cuts the sweep short at the rock face.
    const stop = this.drillRocks(game, bit, ax, ay, bx, by);
    if (stop) { bx = stop.x; by = stop.y; }
    this.bore(game, b, bit, ax, ay, bx, by);
    if (bit.phase !== 'fly') return; // an armored plate stopped it (bore left the tip on it)
    bit.trail.push(ax, ay);
    if (bit.trail.length > TRAIL * 2) bit.trail.splice(0, 2);
    bit.x = bx; bit.y = by;
    bit.dist += Math.hypot(bx - ax, by - ay);
    if (stop || bit.dist >= bit.range - 1e-6) this.spent(game, b, bit);
  }

  // Bore every enemy the tip passes this tick, nearest first, each once per bit.
  bore(game, b, bit, ax, ay, bx, by) {
    const enemies = game.enemyManager.enemies;
    const hits = this.sweep;
    hits.length = 0;
    const tip = W.harpoonTipRadius;
    const seg = this.seg;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.drillBit === bit.id) continue;
      const reach = (e.radius || 10) + tip;
      if (segDist(e.x, e.y, ax, ay, bx, by, seg) > reach * reach) continue;
      hits.push({ e, t: seg.t });
      if (hits.length >= MAX_SWEEP) break;
    }
    if (!hits.length) return;
    hits.sort((u, v) => u.t - v.t);
    const ang = Math.atan2(bit.dirY, bit.dirX);
    for (let k = 0; k < hits.length; k++) {
      const e = hits[k].e;
      if (e.dead) continue;
      e.drillBit = bit.id;
      const kick = awayKnock(game, e, 3, this.kick);
      if (e.deflect) {
        // An armored plate: the bit clangs off it and is spent there.
        bit.x = ax + (bx - ax) * hits[k].t;
        bit.y = ay + (by - ay) * hits[k].t;
        game.hitEnemy(e, bit.dmg * bit.pierceMult, 'harpoon', kick.x, kick.y, 1, 'harpoon');
        this.clang(game, bit, bit.x, bit.y);
        this.spent(game, b, bit);
        hits.length = 0;
        return;
      }
      game.hitEnemy(e, bit.dmg * bit.pierceMult, 'harpoon', kick.x, kick.y, 1, 'harpoon');
      const survived = !e.dead && e.hp > 0;
      bit.pierceMult *= bit.keep; // every enemy bored costs the bit some bite, kill or not
      bit.flash = 0.12;
      // Screw-through: sparks spray off both sides of the hull and chips fly out the back.
      game.particles.spawnDirectionalSparks?.(e.x, e.y, ang, 0.9, 4, DRILL_HUE, 6);
      game.particles.spawnDirectionalSparks?.(e.x, e.y, ang + Math.PI, 0.6, 2, 30, 4);
      game.sound.playDrillHit?.('enemy');
      if (survived && b.tf?.has('detonate')) {
        // Detonator Bit: it screws into the first enemy that survives it and stays there.
        bit.lodged = e;
        bit.lodgeX = -bit.dirX * (e.radius || 10) * 0.4;
        bit.lodgeY = -bit.dirY * (e.radius || 10) * 0.4;
        bit.x = e.x + bit.lodgeX;
        bit.y = e.y + bit.lodgeY;
        this.spent(game, b, bit);
        break;
      }
    }
    hits.length = 0;
  }

  // End of a bit's flight (full reach, a bite, bedrock or a plate): spin, ricochet, lodge, or crumble.
  spent(game, b, bit) {
    if (bit.phase === 'fly') this.tunnel(game, b, bit);
    if (bit.phase === 'done') return;
    if (b.t8 && !bit.spun) {
      bit.spun = true;
      bit.phase = 'spin';
      bit.phaseT = 0;
      bit.spinTick = 0;
      bit.drillLeft += W.harpoonDrill(b) * W.spinShare; // the spinning bit chews a little more rock
      return;
    }
    if (b.t12 && !bit.leapt) {
      bit.leapt = true;
      bit.phase = 'chain';
      bit.phaseT = 0;
      bit.leapsLeft = W.chainLeaps;
      bit.leapTarget = null;
      return;
    }
    if (b.tf?.has('detonate') && bit.phase !== 'lodge') {
      bit.phase = 'lodge';
      bit.phaseT = 0;
      game.sound.playDrillHit?.('lodge');
      return;
    }
    this.crumble(game, bit);
  }

  // A spent bit shatters into gold chips where it stopped.
  crumble(game, bit) {
    bit.phase = 'done';
    game.particles.spawnExplosionSparks?.(bit.x, bit.y, 5, DRILL_HUE, 0.8, 3.5, 1.4);
  }

  // Drill the rocks on the segment, nearest first. Returns the stop point when the bit bites into a rock
  // it can't finish (or hits bedrock), else null. Rock it breaks is the ship's mining.
  drillRocks(game, bit, ax, ay, bx, by) {
    const am = game.asteroidManager;
    if (!am?.asteroids?.length) return null;
    const tip = W.harpoonTipRadius;
    const len = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const near = am.getNearbyAsteroids(mx, my, am.cellsFor(len / 2 + tip));
    const seg = this.seg;
    let list = null;
    for (let i = 0; i < near.length; i++) {
      const rock = near[i];
      if (rock.hp <= 0 || rock.drillBit === bit.id) continue;
      const reach = rock.radius + tip;
      if (segDist(rock.x, rock.y, ax, ay, bx, by, seg) > reach * reach) continue;
      (list ||= []).push({ rock, t: seg.t });
    }
    if (!list) return null;
    list.sort((u, v) => u.t - v.t);
    let stop = null;
    for (let k = 0; k < list.length && !stop; k++) {
      const rock = list[k].rock;
      // Where the tip meets the rock face along the flight line.
      const face = this.faceOnLine(rock, ax, ay, bx, by, tip);
      if (rock.unbreakable) {
        stop = face;
        this.clang(game, bit, face.x, face.y);
        break;
      }
      rock.drillBit = bit.id;
      if (!this.chew(game, bit, rock, face.x, face.y)) stop = face;
    }
    this.flushRocks(game);
    return stop;
  }

  // Take what the bit's drill budget allows out of one rock. True when it broke.
  chew(game, bit, rock, cx, cy) {
    const am = game.asteroidManager;
    const bite = Math.min(bit.drillLeft, rock.hp);
    if (bite <= 0) {
      this.biteFx(game, bit, rock, cx, cy, false);
      return false;
    }
    bit.drillLeft -= bite;
    rock.hp -= bite;
    rock.hitFlash = 0.85;
    rock.heat = Math.min(1, (rock.heat || 0) + 0.5);
    rock.lastGrindX = cx;
    rock.lastGrindY = cy;
    am.free?.(rock);
    const broke = rock.hp <= 0;
    this.biteFx(game, bit, rock, cx, cy, broke);
    if (broke) this.broken.push(rock);
    return broke;
  }

  // Rock chips: sparks in the ore's colour fly back off the face, and a crunch when the bit bites in.
  biteFx(game, bit, rock, cx, cy, broke) {
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 42;
    const back = Math.atan2(-bit.dirY, -bit.dirX);
    game.particles.spawnDirectionalSparks?.(cx, cy, back, 1.1, broke ? 6 : 9, hue, 8);
    game.particles.spawnExplosionSparks?.(cx, cy, broke ? 2 : 4, hue, 0.7, 2.6, 2.5);
    bit.flash = 0.18;
    game.sound.playDrillHit?.('rock');
  }

  // Broken rocks go through the game's shatter path (ore, sound, counted as rocks mined).
  flushRocks(game) {
    if (!this.broken.length) return;
    const am = game.asteroidManager;
    for (const rock of this.broken) {
      const i = am.asteroids.indexOf(rock);
      if (i >= 0) am.asteroids.splice(i, 1);
      am.loosenAround?.(rock);
      game.onRockShattered?.(rock);
      this.rocksBroken++;
    }
    this.broken.length = 0;
    am.rebuildSpatialHash();
  }

  // First point on segment a -> b whose distance to the rock centre is radius + tip (or the nearest point).
  faceOnLine(rock, ax, ay, bx, by, tip) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const fx = ax - rock.x, fy = ay - rock.y;
    const R = rock.radius + tip;
    const bq = fx * ux + fy * uy;
    const c = fx * fx + fy * fy - R * R;
    const disc = bq * bq - c;
    let t = disc >= 0 ? -bq - Math.sqrt(disc) : -bq;
    t = Math.max(0, Math.min(len, t));
    return { x: ax + ux * t, y: ay + uy * t };
  }

  clang(game, bit, x, y) {
    bit.flash = 0.25;
    game.particles.spawnExplosionSparks?.(x, y, 8, 270, 1.2, 6, 2);
    game.particles.spawnFlash?.(x, y, 14, 270, 0.1);
    game.sound.playDrillHit?.('bedrock');
  }

  // Drill Spin: the bit holds where it stopped and grinds everything round its tip.
  spin(game, b, bit) {
    const total = W.spinTime;
    const due = Math.min(W.spinTicks, Math.floor((bit.phaseT / total) * W.spinTicks + 1e-9) + 1);
    while (bit.spinTick < due) {
      bit.spinTick++;
      const r = W.spinRadius * areaMult(game.player);
      this.ring(game, bit.x, bit.y, r, bit.dmg * W.spinShare / W.spinTicks, 0.6, 'harpoonspin');
      this.grindRocks(game, bit, r * 0.6);
      game.particles.spawnExplosionSparks?.(bit.x, bit.y, 3, DRILL_HUE, 1.4, 5, 1.6);
      if (bit.spinTick === 1) game.sound.playDrillSpin?.(total);
    }
    if (bit.phaseT >= total - 1e-9) this.spent(game, b, bit);
  }

  // Spin drilling: chew every rock touching the spin core (bedrock just sparks).
  grindRocks(game, bit, r) {
    const am = game.asteroidManager;
    if (!am?.asteroids?.length || bit.drillLeft <= 0) return;
    const near = am.getNearbyAsteroids(bit.x, bit.y, am.cellsFor(r));
    for (let i = 0; i < near.length; i++) {
      const rock = near[i];
      if (rock.hp <= 0 || rock.unbreakable) continue;
      const d = Math.hypot(rock.x - bit.x, rock.y - bit.y);
      if (d > rock.radius + r) continue;
      const k = (d || 1);
      this.chew(game, bit, rock, rock.x + (bit.x - rock.x) / k * rock.radius, rock.y + (bit.y - rock.y) / k * rock.radius);
      if (bit.drillLeft <= 0) break;
    }
    this.flushRocks(game);
  }

  // Ricochet Bits: the spent bit caroms to the nearest enemy it hasn't bored yet, up to W.chainLeaps times.
  leap(game, b, bit) {
    const each = W.chainTime;
    if (!bit.leapTarget || bit.leapTarget.dead) {
      if (bit.leapsLeft <= 0 || !(bit.leapTarget = this.nearestFresh(game, bit))) {
        bit.leapTarget = null;
        bit.leapsLeft = 0;
        this.spent(game, b, bit);
        return;
      }
      bit.leapFromX = bit.x;
      bit.leapFromY = bit.y;
      bit.phaseT = 0;
      bit.trail.length = 0;
      game.sound.playDrillHit?.('ricochet');
    }
    const e = bit.leapTarget;
    const k = Math.min(1, bit.phaseT / each);
    bit.x = bit.leapFromX + (e.x - bit.leapFromX) * k;
    bit.y = bit.leapFromY + (e.y - bit.leapFromY) * k;
    if (k < 1) return;
    bit.leapsLeft--;
    bit.leapTarget = null;
    const dx = e.x - bit.leapFromX, dy = e.y - bit.leapFromY;
    const d = Math.hypot(dx, dy) || 1;
    bit.dirX = dx / d; bit.dirY = dy / d;
    e.drillBit = bit.id;
    const kick = awayKnock(game, e, 2, this.kick);
    game.hitEnemy(e, bit.dmg * W.chainShare, 'harpoon', kick.x, kick.y, 1, 'harpoonchain');
    bit.flash = 0.12;
    game.particles.spawnDirectionalSparks?.(e.x, e.y, Math.atan2(dy, dx), 0.8, 5, DRILL_HUE, 6);
    game.sound.playDrillHit?.('enemy');
  }

  nearestFresh(game, bit) {
    const enemies = game.enemyManager.enemies;
    let best = null, bestD = W.chainRange * W.chainRange;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.deflect || e.drillBit === bit.id) continue;
      const d = (e.x - bit.x) ** 2 + (e.y - bit.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // Detonator Bit: the bit rides in the enemy it screwed into (or sits where it stopped), then blows.
  lodge(game, b, bit) {
    const e = bit.lodged;
    if (e && !e.dead) { bit.x = e.x + bit.lodgeX; bit.y = e.y + bit.lodgeY; }
    if (bit.phaseT < W.detDelay) return;
    const r = W.detRadius * areaMult(game.player);
    this.ring(game, bit.x, bit.y, r, bit.dmg * W.detShare, BLAST_KNOCK, 'harpoonblast');
    this.blasts++;
    game.particles.spawnFlash?.(bit.x, bit.y, r * 0.8, 36, 0.12);
    game.particles.spawnShockwave?.(bit.x, bit.y, r, DRILL_HUE, 3, 0.22);
    game.particles.spawnExplosionSparks?.(bit.x, bit.y, 12, 30, 1.6, 7, 2);
    game.particles.spawnPolygonShatter?.(bit.x, bit.y, 8, 4, Math.atan2(bit.dirY, bit.dirX), DRILL_HUE, 0.5);
    game.addShake?.(2.2);
    game.sound.playDrillBlast?.();
    bit.phase = 'done';
  }

  // A ring of damage at (cx, cy): the same reach and falloff as Game.damageEnemiesInRadius, but the knockback
  // points away from the SHIP, not the ring's centre (a ring beyond an enemy would otherwise shove it at you).
  ring(game, cx, cy, rad, dmg, knock, stat) {
    const falloff = TUNING.splashEdgeFalloff ?? 0.4;
    const enemies = game.enemyManager.enemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > rad + e.radius) continue;
      const reach = Math.max(0, Math.min(1, (d - e.radius) / rad));
      const kick = awayKnock(game, e, knock, this.kick);
      game.hitEnemy(e, dmg * (1 - falloff * reach), 'harpoon', kick.x, kick.y, 0.6, stat);
    }
    game.grid?.ripple?.(cx, cy, rad, DRILL_HUE);
  }

  // Tunnel Bore: the line a bit bored keeps cutting for W.tunnelLife s.
  tunnel(game, b, bit) {
    if (!b.tf?.has('tunnel')) return;
    if (Math.hypot(bit.x - bit.sx, bit.y - bit.sy) < 8) return;
    this.tunnels.push({ ax: bit.sx, ay: bit.sy, bx: bit.x, by: bit.y, life: W.tunnelLife, tickT: 0, dmg: bit.dmg, seed: Math.random() * 10 });
  }

  cutTunnels(game, dt) {
    const tunnels = this.tunnels;
    if (!tunnels.length) return;
    const enemies = game.enemyManager.enemies;
    const seg = this.seg;
    const ticks = W.tunnelLife / W.tunnelTick;
    for (let i = tunnels.length - 1; i >= 0; i--) {
      const t = tunnels[i];
      t.life -= dt;
      t.tickT -= dt;
      if (t.tickT <= 1e-9) {
        t.tickT += W.tunnelTick;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (!target(e) || e.deflect) continue;
          const reach = (e.radius || 10) + W.tunnelWidth;
          if (segDist(e.x, e.y, t.ax, t.ay, t.bx, t.by, seg) > reach * reach) continue;
          const kick = awayKnock(game, e, 0.6, this.kick);
          game.hitEnemy(e, t.dmg * W.tunnelShare / ticks, 'harpoon', kick.x, kick.y, 0.4, 'harpoontunnel');
          game.particles.spawnExplosionSparks?.(e.x, e.y, 2, DRILL_HUE, 0.8, 3, 1.2);
        }
      }
      if (t.life <= 0) tunnels.splice(i, 1);
    }
  }

  // ---- Rendering (world layer, over enemies). Animation runs on this.time, so it freezes with the sim. ----
  // Tunnels under everything; each bit is a spinning drill cone (green, white core, gold threads scrolling
  // to the tip) with a short gold streak behind it; the next bit spins up at the nose, faster as it charges.
  draw(ctx, game) {
    const p = game.player;
    if (!((p?.weapons?.harpoon || 0) > 0)) return;
    const t = this.time;
    for (const tn of this.tunnels) this.drawTunnel(ctx, tn, t);
    for (const bit of this.bits) {
      const tr = bit.trail;
      if (tr.length >= 2 && (bit.phase === 'fly' || bit.phase === 'chain')) {
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass === 0 ? `hsla(${DRILL_HUE}, 100%, 55%, 0.35)` : 'rgba(255, 250, 220, 0.6)';
          ctx.lineWidth = pass === 0 ? 7 : 2;
          ctx.beginPath();
          ctx.moveTo(tr[0], tr[1]);
          for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
          ctx.lineTo(bit.x, bit.y);
          ctx.stroke();
        }
      }
      const spinning = bit.phase === 'spin';
      const blink = bit.phase === 'lodge' ? (Math.sin(bit.phaseT * 40) > 0 ? 1 : 0) : 0;
      this.drawBit(ctx, bit.x, bit.y, Math.atan2(bit.dirY, bit.dirX), 1.35, t * (spinning ? 22 : 12), spinning ? t * 40 : 0, blink);
      if (spinning) {
        const r = W.spinRadius * areaMult(p);
        ctx.strokeStyle = `hsla(${DRILL_HUE}, 100%, 70%, 0.45)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a0 = t * 22 + (k * Math.PI * 2) / 3;
          ctx.moveTo(bit.x + Math.cos(a0) * r * 0.8, bit.y + Math.sin(a0) * r * 0.8);
          ctx.arc(bit.x, bit.y, r * 0.8, a0, a0 + 1.1);
        }
        ctx.stroke();
      }
      if (bit.flash > 0) {
        ctx.fillStyle = `rgba(255, 240, 180, ${Math.min(1, bit.flash * 5)})`;
        ctx.beginPath();
        ctx.arc(bit.x, bit.y, 5 + 12 * bit.flash, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The next bit spinning up at the nose: it slides forward and its threads race faster as it charges,
    // with a white glint the moment it's ready.
    if (game.state === 'GAMEOVER') return;
    const c = this.charge;
    const m = drillMuzzle(p, this.muzzle);
    const back = (1 - c) * 6;
    const mx = m.x - Math.cos(p.angle) * back, my = m.y - Math.sin(p.angle) * back;
    ctx.globalAlpha = 0.45 + 0.55 * c;
    this.drawBit(ctx, mx, my, p.angle, 0.7 + 0.3 * c, t * (4 + 18 * c * c), 0, 0);
    ctx.globalAlpha = 1;
    if (this.muzzleFlash > 0) {
      ctx.fillStyle = `rgba(255, 236, 160, ${Math.min(1, this.muzzleFlash * 8)})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7 + 40 * this.muzzleFlash, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // One drill bit: base at 0, point at 16.5 (the ship's own drill shape), threads scrolling at `thread`.
  drawBit(ctx, x, y, heading, scale, thread, roll, hot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading + roll);
    ctx.scale(scale, scale);
    const drillLen = 16.5, half = 6.2;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? (hot ? '#ff5533' : BIT_COLOR) : '#ffffff';
      ctx.lineWidth = pass === 0 ? 4.8 : 2;
      ctx.beginPath();
      ctx.moveTo(drillLen, 0);
      ctx.lineTo(0, -half);
      ctx.lineTo(-3.5, 0);
      ctx.lineTo(0, half);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = THREAD_COLOR;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const ph = ((thread + k / 3) % 1 + 1) % 1;
      const tx = ph * (drillLen - 2);
      const h = half * (1 - ph);
      ctx.moveTo(tx, -h);
      ctx.lineTo(tx + 2.2, h);
    }
    ctx.stroke();
    ctx.restore();
  }

  // A churning bore: a dark channel with a hot gold core and grit ticks crawling along it, fading out.
  drawTunnel(ctx, tn, t) {
    const a = Math.max(0, Math.min(1, tn.life / W.tunnelLife));
    const dx = tn.bx - tn.ax, dy = tn.by - tn.ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(20, 12, 4, ${0.55 * a})`;
    ctx.lineWidth = W.tunnelWidth * 1.6;
    ctx.beginPath();
    ctx.moveTo(tn.ax, tn.ay);
    ctx.lineTo(tn.bx, tn.by);
    ctx.stroke();
    ctx.strokeStyle = `hsla(${DRILL_HUE}, 100%, 60%, ${0.55 * a})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 230, 160, ${0.7 * a})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const n = Math.floor(len / 16);
    for (let i = 0; i < n; i++) {
      const f = ((i * 16 + (t * 140 + tn.seed * 30)) % len) / len;
      const x = tn.ax + dx * f, y = tn.ay + dy * f;
      const w = W.tunnelWidth * 0.6 * (i % 2 ? 1 : -1);
      ctx.moveTo(x - uy * w, y + ux * w);
      ctx.lineTo(x + ux * 4, y + uy * 4);
    }
    ctx.stroke();
  }
}
