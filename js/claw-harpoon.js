// Claw Harpoon: a PRIMARY slot weapon. While firing, the ship throws its port drill-claw on a tether
// along the turret aim. On the way out the claw pierces every enemy on its line once (each one behind
// takes TUNING.pierceFalloff of the last, like Autocannon bolts) and drills through rock: it breaks
// rock worth W.harpoonDrill rock HP per throw (x the ship's drill speed), and bites to a stop in the
// first rock it can't finish. Bedrock always stops it, and so does an armored serpent plate. The
// first small enemy it hits (hull radius up to W.harpoonHookSize, never a boss or lieutenant) is
// hooked: the winch reels it back into your other claw, which crushes it (W.harpoonCrushShare of a hit).
// Rock the claw breaks is your mining: it counts as rocks mined and drops its ore like a claw bite.
//
// Breakthroughs: Seismic Slam (LV 6: every reel-in snaps the claws shut in a blast at the nose),
// Drill Spin (LV 12: the claw spins in place at the end of each throw, grinding everything round its
// tip, rock included) and Chain Harpoon (LV 18: from the end of each throw the claw leaps on to up to
// W.chainLeaps more enemies near the tip, skewering each).
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'harpoon';
// stats 'harpooncrush', 'harpoonslam', 'harpoonspin', 'harpoonchain' for the extra hits).
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, areaMult } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { kickShipRecoil } from './ship-renderer.js';

export const HARPOON_HUE = 48;       // drill-jaw gold (the crab's drillJawColor)
const CLAW_COLOR = '#00ffaa';        // the crab's drill colour while it bites (drillActiveColor)
const JAW_COLOR = '#ffcc00';         // its pincer jaws (drillJawColor)
const CABLE_COLOR = '#00f3ff';       // carapace cyan
const MAX_SWEEP = 24;                // enemies one tick of flight can skewer (a dense line still hits them all over a few ticks)

// Enemies the claw can hit: alive and hittable.
const target = (e) => !e.dead && !e.invulnerable;
// A hooked catch can't ram the ship while the winch holds it, nor for this long after it lets go
// (e.noContactUntil, checked by Game's contact loop): the claw hauls it inside the shield outline.
const RELEASE_GRACE = 0.6; // s
// A catch that survives the crush is flung this far past the ship's hull, so it doesn't land on it.
const RELEASE_FLING = 26; // px
const SLAM_KNOCK = 3; // Seismic Slam knockback, px/tick, always away from the ship
// Small enough to yank (never a boss or a lieutenant, never an armored plate).
export const hookable = (e, size) => !e.isBoss && !e.isLieutenant && !e.deflect && !e.leader && e.type !== 'gate' && (e.radius || 0) <= size;

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

// World position of the port drill-claw socket (where the claw sits when it is home): the same mount
// ship-renderer.js draws the port drill at.
export function clawSocket(p, out = { x: 0, y: 0 }) {
  const r = p.radius || 15;
  const a = p.clawAngles?.[0] ?? p.drillAngle ?? p.hullAngle ?? p.angle ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  const lx = r * 1.42, ly = -r * 0.78;
  out.x = p.x + lx * c - ly * s;
  out.y = p.y + lx * s + ly * c;
  return out;
}

export class ClawHarpoon {
  constructor() {
    this.sweep = [];
    this.seg = { t: 0 };
    this.socket = { x: 0, y: 0 };
    this.broken = [];
    this.clear();
  }

  // Run reset: the claw is home and ready.
  clear() {
    this.phase = 'ready';
    this.cd = 0;
    this.time = 0;
    this.phaseT = 0;
    this.throwId = 0;
    this.catch = null;
    this.tipX = this.tipY = 0;
    this.dirX = 1; this.dirY = 0;
    this.throws = 0;
    this.hooks = 0;
    this.crushes = 0;
    this.rocksBroken = 0;
    this.leapsLeft = 0;
    this.leapTarget = null;
    this.spinTick = 0;
    this.biteFlash = 0;
    this.slamFlash = 0;
    this.snapFlash = 0; // the tether whipping taut (full reach, a bite or a hook)
    this.sweep.length = 0;
  }

  get out() {
    return this.phase !== 'ready';
  }

  update(dt, game, firing) {
    const p = game.player;
    this.time += dt;
    if (this.biteFlash > 0) this.biteFlash = Math.max(0, this.biteFlash - dt);
    if (this.slamFlash > 0) this.slamFlash = Math.max(0, this.slamFlash - dt);
    if (this.snapFlash > 0) this.snapFlash = Math.max(0, this.snapFlash - dt);
    if (!((p?.weapons?.harpoon || 0) > 0)) {
      if (this.out || this.catch) this.clear();
      if (p) p.harpoonOut = false;
      return;
    }
    if (this.cd > 0) this.cd = this.cd - dt > 1e-9 ? this.cd - dt : 0;
    const b = weaponBuild(p, 'harpoon');
    if (this.phase === 'ready') {
      if (firing && this.cd <= 0) this.launch(game, b);
    } else {
      this.phaseT += dt;
      if (this.phase === 'out') this.flyOut(game, b, dt);
      else if (this.phase === 'spin') this.spin(game, b);
      else if (this.phase === 'chain') this.leap(game, b);
      if (this.phase === 'back') this.reel(game, b);
    }
    this.holdCatch(game);
    p.harpoonOut = this.out;
  }

  launch(game, b) {
    const p = game.player;
    this.game = game;
    const cycle = W.harpoonCooldown(b);
    this.cycle = cycle;
    this.cd = cycle;
    this.throwId++;
    this.throws++;
    this.dmg = weaponDamage(p, 'harpoon', b);
    this.pierceMult = 1;
    this.range = W.harpoonRange(b);
    this.speed = this.range / (cycle * W.harpoonOutShare);
    this.drillLeft = W.harpoonDrill(b) * ((p.stats?.miningSpeed || TUNING.miningSpeed || 75) / (TUNING.miningSpeed || 75));
    const s = clawSocket(p, this.socket);
    this.dirX = Math.cos(p.angle);
    this.dirY = Math.sin(p.angle);
    // The claw kicks out of its socket onto the aim line at the nose, so it flies exactly where you aim
    // (the tether still runs back to the socket).
    const nose = (p.radius || 15) * 1.2;
    this.tipX = p.x + this.dirX * nose;
    this.tipY = p.y + this.dirY * nose;
    this.dist = 0;
    this.catch = null;
    this.setPhase('out');
    // Launch kick: the turret recoils, a gold muzzle flash and spark spray at the nose, a nudge of shake.
    kickShipRecoil(p, 1);
    game.particles.spawnFlash?.(this.tipX, this.tipY, 16, HARPOON_HUE, 0.08);
    game.particles.spawnDirectionalSparks?.(this.tipX, this.tipY, p.angle, 0.45, 6, HARPOON_HUE, 8);
    game.grid?.applyImpulse?.(this.tipX, this.tipY, 10, 60, HARPOON_HUE);
    game.addShake?.(1.2);
    game.sound.playHarpoonLaunch?.();
  }

  // The tether whips taut: a bright flash along the cable and a plucked twang.
  snap(game = this.game) {
    this.snapFlash = 0.14;
    game?.sound.playHarpoonSnap?.(!!this.catch);
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseT = 0;
    if (phase === 'back') {
      this.backX = this.tipX;
      this.backY = this.tipY;
      this.reelSoundAt = 0;
    }
  }

  // End of the outward flight (full reach or a bite): spin, leap, or reel back.
  endOfThrow(b) {
    this.snap();
    if (b.t8 && this.phase === 'out') {
      this.setPhase('spin');
      this.spinTick = 0;
      this.drillLeft += W.harpoonDrill(b) * W.spinShare; // the spinning bit chews a little more rock
      return;
    }
    if (b.t12 && (this.phase === 'out' || this.phase === 'spin')) {
      this.setPhase('chain');
      this.leapsLeft = W.chainLeaps;
      this.leapTarget = null;
      return;
    }
    this.setPhase('back');
  }

  flyOut(game, b, dt) {
    const step = Math.min(this.range - this.dist, this.speed * dt);
    const ax = this.tipX, ay = this.tipY;
    let bx = ax + this.dirX * step, by = ay + this.dirY * step;
    // Rock first: a bite or a bedrock clang cuts the sweep short at the rock face.
    const stop = this.drillRocks(game, ax, ay, bx, by);
    if (stop) { bx = stop.x; by = stop.y; }
    this.skewer(game, ax, ay, bx, by);
    if (this.phase !== 'out') return; // an armored plate stopped it (skewer left the tip on it)
    this.tipX = bx; this.tipY = by;
    this.dist += Math.hypot(bx - ax, by - ay);
    if (stop || this.dist >= this.range - 1e-6) this.endOfThrow(b);
  }

  // Hit every enemy the tip passes this tick, nearest first, each once per throw.
  skewer(game, ax, ay, bx, by) {
    const enemies = game.enemyManager.enemies;
    const hits = this.sweep;
    hits.length = 0;
    const tip = W.harpoonTipRadius;
    const seg = this.seg;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.harpoonThrow === this.throwId) continue;
      const reach = (e.radius || 10) + tip;
      if (segDist(e.x, e.y, ax, ay, bx, by, seg) > reach * reach) continue;
      hits.push({ e, t: seg.t });
      if (hits.length >= MAX_SWEEP) break;
    }
    if (!hits.length) return;
    hits.sort((u, v) => u.t - v.t);
    const p = game.player;
    const hookSize = W.harpoonHookSize(weaponBuild(p, 'harpoon'));
    for (let k = 0; k < hits.length; k++) {
      const e = hits[k].e;
      if (e.dead) continue;
      e.harpoonThrow = this.throwId;
      if (e.deflect) {
        // An armored plate: the claw clangs off it and reels back from there.
        this.tipX = ax + (bx - ax) * hits[k].t;
        this.tipY = ay + (by - ay) * hits[k].t;
        game.hitEnemy(e, this.dmg * this.pierceMult, 'harpoon', this.dirX * 2, this.dirY * 2, 1, 'harpoon');
        this.clang(game, this.tipX, this.tipY);
        this.setPhase('back');
        hits.length = 0;
        return;
      }
      game.hitEnemy(e, this.dmg * this.pierceMult, 'harpoon', this.dirX * 3, this.dirY * 3, 1, 'harpoon');
      if (!e.dead && e.hp > 0) this.pierceMult *= W.harpoonPierceKeep; // a kill costs the claw no momentum
      game.particles.spawnDirectionalSparks?.(e.x, e.y, Math.atan2(this.dirY, this.dirX), 0.7, 3, HARPOON_HUE, 5);
      if (!this.catch && !e.dead && hookable(e, hookSize)) this.hook(game, e);
      else game.sound.playHarpoonHit?.('enemy');
    }
    hits.length = 0;
  }

  hook(game, e) {
    this.catch = e;
    this.hooks++;
    this.biteFlash = 0.18;
    this.snapFlash = 0.14;
    game.particles.spawnFlash?.(e.x, e.y, (e.radius || 10) * 1.6, HARPOON_HUE, 0.12);
    game.particles.spawnShockwave?.(e.x, e.y, (e.radius || 10) * 2.2, HARPOON_HUE, 2, 0.16);
    game.sound.playHarpoonHit?.('hook');
  }

  // Drill the rocks on the segment, nearest first. Returns the stop point when the claw bites into a
  // rock it can't finish (or hits bedrock), else null. Rock it breaks is the ship's mining.
  drillRocks(game, ax, ay, bx, by) {
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
      if (rock.hp <= 0 || rock.harpoonThrow === this.throwId) continue;
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
        this.clang(game, face.x, face.y);
        break;
      }
      rock.harpoonThrow = this.throwId;
      if (!this.chew(game, rock, face.x, face.y)) stop = face;
    }
    this.flushRocks(game);
    return stop;
  }

  // Take what the drill budget allows out of one rock. True when it broke.
  chew(game, rock, cx, cy) {
    const am = game.asteroidManager;
    const bite = Math.min(this.drillLeft, rock.hp);
    if (bite <= 0) {
      this.biteFx(game, rock, cx, cy, false);
      return false;
    }
    this.drillLeft -= bite;
    rock.hp -= bite;
    rock.hitFlash = 0.85;
    rock.heat = Math.min(1, (rock.heat || 0) + 0.5);
    rock.lastGrindX = cx;
    rock.lastGrindY = cy;
    am.free?.(rock);
    const broke = rock.hp <= 0;
    this.biteFx(game, rock, cx, cy, broke);
    if (broke) this.broken.push(rock);
    return broke;
  }

  biteFx(game, rock, cx, cy, broke) {
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 42;
    const back = Math.atan2(-this.dirY, -this.dirX);
    game.particles.spawnDirectionalSparks?.(cx, cy, back, 1.1, broke ? 5 : 8, hue, 7);
    if (!broke) {
      game.particles.spawnExplosionSparks?.(cx, cy, 3, hue, 0.6, 2.4, 3);
      this.biteFlash = 0.22;
      game.sound.playHarpoonHit?.('rock');
    }
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

  clang(game, x, y) {
    this.biteFlash = 0.25;
    game.particles.spawnExplosionSparks?.(x, y, 8, 270, 1.2, 6, 2);
    game.particles.spawnFlash?.(x, y, 14, 270, 0.1);
    game.sound.playHarpoonHit?.('bedrock');
  }

  // Drill Spin: the claw holds at the end of its throw and grinds everything round its tip.
  spin(game, b) {
    const total = this.cycle * W.spinTime;
    const due = Math.min(W.spinTicks, Math.floor((this.phaseT / total) * W.spinTicks + 1e-9) + 1);
    while (this.spinTick < due) {
      this.spinTick++;
      const r = W.spinRadius * areaMult(game.player);
      game.damageEnemiesInRadius(this.tipX, this.tipY, r, this.dmg * W.spinShare / W.spinTicks, HARPOON_HUE, 'harpoon', 0.6, undefined, 'harpoonspin');
      this.grindRocks(game, r * 0.6);
      game.particles.spawnExplosionSparks?.(this.tipX, this.tipY, 3, HARPOON_HUE, 1.4, 5, 1.6);
      if (this.spinTick === 1) game.sound.playHarpoonSpin?.(total);
    }
    if (this.phaseT >= total - 1e-9) this.endOfThrow(b);
  }

  // Spin drilling: chew every rock touching the spin core (bedrock just sparks).
  grindRocks(game, r) {
    const am = game.asteroidManager;
    if (!am?.asteroids?.length || this.drillLeft <= 0) return;
    const near = am.getNearbyAsteroids(this.tipX, this.tipY, am.cellsFor(r));
    for (let i = 0; i < near.length; i++) {
      const rock = near[i];
      if (rock.hp <= 0 || rock.unbreakable) continue;
      const d = Math.hypot(rock.x - this.tipX, rock.y - this.tipY);
      if (d > rock.radius + r) continue;
      const k = (d || 1);
      this.chew(game, rock, rock.x + (this.tipX - rock.x) / k * rock.radius, rock.y + (this.tipY - rock.y) / k * rock.radius);
      if (this.drillLeft <= 0) break;
    }
    this.flushRocks(game);
  }

  // Chain Harpoon: leap from the tip to the nearest enemy not yet skewered this throw, up to W.chainLeaps.
  leap(game, b) {
    const each = this.cycle * W.chainTime;
    if (!this.leapTarget || this.leapTarget.dead) {
      if (this.leapsLeft <= 0 || !(this.leapTarget = this.nearestFresh(game))) {
        this.leapTarget = null;
        this.setPhase('back');
        return;
      }
      this.leapFromX = this.tipX;
      this.leapFromY = this.tipY;
      this.phaseT = 0;
    }
    const e = this.leapTarget;
    const k = Math.min(1, this.phaseT / each);
    this.tipX = this.leapFromX + (e.x - this.leapFromX) * k;
    this.tipY = this.leapFromY + (e.y - this.leapFromY) * k;
    if (k < 1) return;
    this.leapsLeft--;
    this.leapTarget = null;
    const dx = e.x - this.leapFromX, dy = e.y - this.leapFromY;
    const d = Math.hypot(dx, dy) || 1;
    this.dirX = dx / d; this.dirY = dy / d;
    e.harpoonThrow = this.throwId;
    game.hitEnemy(e, this.dmg * W.chainShare, 'harpoon', this.dirX * 2, this.dirY * 2, 1, 'harpoonchain');
    game.particles.spawnDirectionalSparks?.(e.x, e.y, Math.atan2(dy, dx), 0.8, 4, HARPOON_HUE, 6);
    if (!this.catch && !e.dead && hookable(e, W.harpoonHookSize(b))) this.hook(game, e);
    else game.sound.playHarpoonHit?.('enemy');
  }

  nearestFresh(game) {
    const enemies = game.enemyManager.enemies;
    let best = null, bestD = W.chainRange * W.chainRange;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.deflect || e === this.catch || e.harpoonThrow === this.throwId) continue;
      const d = (e.x - this.tipX) ** 2 + (e.y - this.tipY) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // Reel the claw (and its catch) back into the socket, which moves with the ship.
  reel(game, b) {
    const p = game.player;
    const total = this.cycle * W.harpoonBackShare;
    const k = Math.min(1, this.phaseT / total);
    // With a catch the winch YANKS (fast out of the gate, settling into the socket); empty, it eases both ends.
    const ease = this.catch ? 1 - (1 - k) ** 3 : k * k * (3 - 2 * k);
    const s = clawSocket(p, this.socket);
    this.tipX = this.backX + (s.x - this.backX) * ease;
    this.tipY = this.backY + (s.y - this.backY) * ease;
    if (this.phaseT >= (this.reelSoundAt || 0)) {
      this.reelSoundAt = this.phaseT + 0.06;
      if (k < 0.9) game.sound.playHarpoonReel?.();
    }
    if (k < 1) return;
    this.dock(game, b);
  }

  // Home: crush the catch in the other claw, slam (Seismic Slam), ready for the next throw.
  dock(game, b) {
    const p = game.player;
    const e = this.catch;
    const nx = Math.cos(p.angle), ny = Math.sin(p.angle);
    if (e && !e.dead) {
      this.holdCatch(game);
      game.hitEnemy(e, this.dmg * W.harpoonCrushShare, 'harpoon', nx * 4, ny * 4, 1, 'harpooncrush');
      if (!e.dead) this.fling(game, e);
      this.crushes++;
      game.particles.spawnPolygonShatter?.(e.x, e.y, (e.radius || 10) * 0.7, 3, Math.atan2(ny, nx), HARPOON_HUE, 0.5);
      game.particles.spawnExplosionSparks?.(e.x, e.y, 10, HARPOON_HUE, 1.6, 7, 2);
      game.particles.spawnFlash?.(e.x, e.y, (e.radius || 10) * 1.8, 50, 0.1);
      game.particles.spawnShockwave?.(e.x, e.y, (e.radius || 10) * 2.6, HARPOON_HUE, 2.5, 0.2);
      game.addShake?.(2.5);
      kickShipRecoil(p, 0.8);
      game.sound.playHarpoonCrush?.();
    }
    this.catch = null;
    if (b.t4) {
      const r = (p.radius || 15);
      const cx = p.x + nx * r * 1.8, cy = p.y + ny * r * 1.8;
      const rad = W.slamRadius * areaMult(p);
      this.slam(game, cx, cy, rad, this.dmg * W.slamShare);
      game.particles.spawnShockwave?.(cx, cy, rad, HARPOON_HUE, 4, 0.26);
      game.particles.spawnShockwave?.(cx, cy, rad * 0.55, 170, 2, 0.18);
      game.grid?.applyImpulse?.(cx, cy, 40, rad * 1.2, HARPOON_HUE);
      game.addShake?.(2.5);
      this.slamFlash = 0.22;
      game.sound.playHarpoonSlam?.();
    }
    this.setPhase('ready');
    this.tipX = this.socket.x;
    this.tipY = this.socket.y;
  }

  // Seismic Slam's blast at the nose. Same reach and falloff as Game.damageEnemiesInRadius, but the
  // knockback points away from the SHIP, not the blast centre: centred on the nose, a radial shove threw
  // anything beside or behind it back across the hull, into the ship.
  slam(game, cx, cy, rad, dmg) {
    const p = game.player;
    const falloff = TUNING.splashEdgeFalloff ?? 0.4;
    for (const e of [...game.enemyManager.enemies].reverse()) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > rad + e.radius) continue;
      const reach = Math.max(0, Math.min(1, (d - e.radius) / rad));
      let ox = e.x - p.x, oy = e.y - p.y;
      const od = Math.hypot(ox, oy);
      if (od > 1e-6) { ox /= od; oy /= od; } else { ox = Math.cos(p.angle); oy = Math.sin(p.angle); }
      game.hitEnemy(e, dmg * (1 - falloff * reach), 'harpoon', ox * SLAM_KNOCK, oy * SLAM_KNOCK, 1, 'harpoonslam');
    }
    game.grid?.ripple?.(cx, cy, rad, HARPOON_HUE);
  }

  // A catch that survives the crush is thrown clear of the ship (past the claws and the shield) and moving
  // away, so it can't hit the ship the moment the winch lets go.
  fling(game, e) {
    const p = game.player;
    let dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) { dx /= d; dy /= d; } else { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
    const out = (p.radius || 15) * 2.4 + (e.radius || 10) + RELEASE_FLING;
    e.x = p.x + dx * Math.max(d, out);
    e.y = p.y + dy * Math.max(d, out);
    e.vx = dx * 5; e.vy = dy * 5;
    e.noContactUntil = (game.elapsedTime || 0) + RELEASE_GRACE;
  }

  // Pin the catch to the claw tip, kept just clear of the hull, and keep it from ramming the ship while held.
  holdCatch(game) {
    const p = game.player;
    const e = this.catch;
    if (!e) return;
    if (e.dead) { this.catch = null; return; }
    e.noContactUntil = (game.elapsedTime || 0) + RELEASE_GRACE;
    let x = this.tipX, y = this.tipY;
    const hold = (p.radius || 15) + (e.radius || 10) + 6;
    const dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < hold) {
      const ux = d > 1e-6 ? dx / d : Math.cos(p.angle), uy = d > 1e-6 ? dy / d : Math.sin(p.angle);
      x = p.x + ux * hold;
      y = p.y + uy * hold;
    }
    e.x = x; e.y = y;
    e.vx = 0; e.vy = 0;
    e.knockX = 0; e.knockY = 0;
  }

  // ---- Rendering (world layer, over enemies). Animation runs on this.time, so it freezes with the sim. ----
  // A cyan-cored steel tether from the port socket to the claw: taut on the way out, slack and wobbling
  // as it reels. The claw is the crab's own drill bit (green cone, white core, spinning threads) between
  // two gold pincer jaws: open while it flies, clamped shut on a catch.
  draw(ctx, game) {
    if (!this.out) return;
    const p = game.player;
    const s = clawSocket(p, this.socket);
    const tx = this.tipX, ty = this.tipY;
    const dx = tx - s.x, dy = ty - s.y;
    const len = Math.hypot(dx, dy);
    const t = this.time;
    // A hooked catch pulls the tether taut; an empty reel lets it go slack. A snap straightens it with a flash.
    const snap = this.snapFlash > 0 ? this.snapFlash / 0.14 : 0;
    const slack = (this.catch ? 0.15 : this.phase === 'back' ? 1 : this.phase === 'out' ? 0.25 : 0.5) * (1 - snap);
    const ux = len > 1e-6 ? dx / len : this.dirX, uy = len > 1e-6 ? dy / len : this.dirY;
    const px = -uy, py = ux;

    // Tether: a dark sheath under a bright core, with a gentle wave along it.
    if (len > 2) {
      const n = Math.max(2, Math.min(24, Math.round(len / 18)));
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? 'rgba(4, 18, 34, 0.9)' : snap > 0 ? '#ffffff' : this.catch ? JAW_COLOR : CABLE_COLOR;
        ctx.globalAlpha = pass === 0 ? 1 : 0.85;
        ctx.lineWidth = pass === 0 ? 4.5 : 1.8 + 1.6 * snap + (this.catch ? 0.6 : 0);
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const wave = Math.sin(f * Math.PI) * Math.sin(f * 9 - t * 26) * 3.2 * slack;
          const x = s.x + dx * f + px * wave, y = s.y + dy * f + py * wave;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Cable links: small gold ticks every ~22 px.
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = JAW_COLOR;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const links = Math.floor(len / 22);
      for (let i = 1; i <= links; i++) {
        const f = (i * 22) / len;
        const wave = Math.sin(f * Math.PI) * Math.sin(f * 9 - t * 26) * 3.2 * slack;
        const x = s.x + dx * f + px * wave, y = s.y + dy * f + py * wave;
        ctx.moveTo(x - px * 2.4, y - py * 2.4);
        ctx.lineTo(x + px * 2.4, y + py * 2.4);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Claw head, pointing along its flight (spinning in Drill Spin).
    const heading = this.phase === 'back' ? Math.atan2(-uy, -ux) + Math.PI : Math.atan2(this.dirY, this.dirX);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(this.phase === 'spin' ? heading + t * 40 : heading);
    const scale = 1.4;
    ctx.scale(scale, scale);
    const shut = this.catch || this.phase === 'back' ? 1 : 0;
    const jaw = 0.55 - 0.4 * shut;
    // Pincer jaws (open while it flies, shut on a catch).
    ctx.strokeStyle = JAW_COLOR;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(-4, side * 6);
      ctx.lineTo(4 + Math.cos(jaw) * 8, side * (6 + Math.sin(jaw) * 7));
      ctx.lineTo(10 + Math.cos(jaw) * 6, side * (3 + Math.sin(jaw) * 4));
    }
    ctx.stroke();
    // Drill cone: the crab's bit (base at 0, point at 16.5).
    const drillLen = 16.5, half = 6.2;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? CLAW_COLOR : '#ffffff';
      ctx.lineWidth = pass === 0 ? 4.8 : 2;
      ctx.beginPath();
      ctx.moveTo(drillLen, 0);
      ctx.lineTo(0, -half);
      ctx.lineTo(-3.5, 0);
      ctx.lineTo(0, half);
      ctx.closePath();
      ctx.stroke();
    }
    // Helical threads scrolling toward the tip.
    ctx.strokeStyle = JAW_COLOR;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const phase = ((t * 9 + k / 3) % 1 + 1) % 1;
      const x = phase * (drillLen - 2);
      const h = half * (1 - phase);
      ctx.moveTo(x, -h);
      ctx.lineTo(x + 2.2, h);
    }
    ctx.stroke();
    ctx.restore();

    // Drill Spin: motion arcs round the tip.
    if (this.phase === 'spin') {
      const r = W.spinRadius * areaMult(p);
      ctx.strokeStyle = `hsla(${HARPOON_HUE}, 100%, 70%, 0.45)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a0 = t * 22 + (k * Math.PI * 2) / 3;
        ctx.moveTo(tx + Math.cos(a0) * r * 0.8, ty + Math.sin(a0) * r * 0.8);
        ctx.arc(tx, ty, r * 0.8, a0, a0 + 1.1);
      }
      ctx.stroke();
    }

    // A bite or a clang: a short hot glint at the tip.
    if (this.biteFlash > 0) {
      ctx.fillStyle = `rgba(255, 240, 180, ${Math.min(1, this.biteFlash * 4)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 6 + 10 * this.biteFlash, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
