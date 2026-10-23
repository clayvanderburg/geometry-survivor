// Drill Driver (weapon id `harpoon`, kept for stats history): a PRIMARY slot weapon. While firing, the ship
// LAUNCHES ITS OWN FRONT DRILLS: a drill leaves its arm on a bright cable, spinning, flies out along the turret
// aim to W.harpoonRange, then reels back in and docks. It bores every enemy it passes on the way out AND on
// the way back (each once per pass; each one behind takes W.harpoonPierceKeep of the last), and drills rock on
// the way out: it breaks rock worth W.harpoonDrill rock HP per throw (x the ship's drill speed) and bites to a
// stop in the first rock it can't finish (then reels back from there). Bedrock and armored serpent plates stop
// it too. Rock it breaks is your mining (rocks mined, ore drops). The two arms take turns.
//
// NOTHING IS EVER GRIPPED, CARRIED OR PULLED: enemies stay where they are, every hit's knockback points away
// from the ship (awayKnock), and contact damage works exactly as it does for every other weapon.
//
// Breakthroughs: Twin Drills (both drills fire at once, fanned apart), Drill Spin (the drill spins where it
// stops, grinding everything round its tip), Ricochet Bits (from the end of its throw the drill bounces
// between up to W.chainLeaps enemies before it reels in), and in the pool Detonator Bit (the drill screws into
// the first enemy that survives it, blows a charge there, then reels in) and Tunnel Bore (the line a drill
// bored keeps cutting for a moment).
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'harpoon'; stats
// 'harpoonreel' for the way back, 'harpoonspin', 'harpoonchain', 'harpoonblast', 'harpoontunnel').
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, areaMult } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { kickShipRecoil } from './ship-renderer.js';

export const DRILL_HUE = 48;         // drill gold (the ship's drillJawColor)
const DRILL_COLOR = '#00ffaa';       // the ship's drill colour while it bites (drillActiveColor)
const THREAD_COLOR = '#ffcc00';      // gold threads (drillJawColor)
const CABLE_COLOR = '#7ffcff';       // bright cyan cable core
const HEAD_SCALE = 1.9;              // the launched drill is drawn big so it reads mid-fight
const MAX_SWEEP = 24;                // enemies one tick of flight can bore (a dense line still hits them all over a few ticks)
const BLAST_KNOCK = 2.5;             // Detonator Bit knockback, px/tick, always away from the ship
const TRAIL = 7;                     // trail points kept per drill
const BASE_CYCLE = 0.4;              // W.harpoonCooldown at LV 1: spins and lodges shorten as the winch speeds up past it

// Enemies a drill can hit: alive and hittable.
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

// World position of an arm's drill mount (arm 0 port, 1 starboard): where ship-renderer.js draws that drill.
export function drillSocket(p, arm, out = { x: 0, y: 0 }) {
  const r = p.radius || 15;
  const a = p.clawAngles?.[arm] ?? p.drillAngle ?? p.hullAngle ?? p.angle ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  const lx = r * 1.42 + 8, ly = (arm ? 1 : -1) * r * 0.78;
  out.x = p.x + lx * c - ly * s;
  out.y = p.y + lx * s + ly * c;
  return out;
}

const newDrill = (arm) => ({
  arm, phase: 'home', phaseT: 0, throwId: 0,
  x: 0, y: 0, dirX: 1, dirY: 0, dist: 0, range: 0, speed: 0, sx: 0, sy: 0,
  dmg: 0, keep: 0.75, pierceMult: 1, drillLeft: 0, outT: 0, backT: 0,
  pace: 1, extraT: 0, spun: false, spinTick: 0, leapt: false, leapsLeft: 0, leapTarget: null, leapFromX: 0, leapFromY: 0,
  lodged: null, lodgeX: 0, lodgeY: 0, backX: 0, backY: 0, reelSoundAt: 0,
  trail: [], flash: 0
});

export class DrillDriver {
  constructor() {
    this.drills = [newDrill(0), newDrill(1)];
    this.tunnels = [];
    this.sweep = [];
    this.seg = { t: 0 };
    this.kick = { x: 0, y: 0 };
    this.socket = { x: 0, y: 0 };
    this.broken = [];
    this.clear();
  }

  // Run reset: both drills home, ready.
  clear() {
    for (let i = 0; i < 2; i++) this.drills[i] = newDrill(i);
    this.tunnels.length = 0;
    this.cd = 0;
    this.cycle = 0;
    this.time = 0;
    this.nextArm = 0;
    this.passId = 0;
    this.shots = 0;
    this.docks = 0;
    this.rocksBroken = 0;
    this.blasts = 0;
    this.sweep.length = 0;
  }

  // Drills currently away from the ship (the renderer hides their cones on the arms).
  get out() {
    return this.drills.some((d) => d.phase !== 'home');
  }

  update(dt, game, firing) {
    const p = game.player;
    this.time += dt;
    if (!((p?.weapons?.harpoon || 0) > 0)) {
      if (this.out || this.tunnels.length) this.clear();
      if (p) p.drillOut = null;
      return;
    }
    this.game = game;
    if (this.cd > 0) this.cd = this.cd - dt > 1e-9 ? this.cd - dt : 0;
    const b = weaponBuild(p, 'harpoon');
    if (firing && this.cd <= 0) this.launch(game, b);
    for (const d of this.drills) {
      if (d.phase === 'home') continue;
      d.phaseT += dt;
      if (d.phase === 'spin' || d.phase === 'chain' || d.phase === 'lodge') d.extraT += dt;
      if (d.flash > 0) d.flash = Math.max(0, d.flash - dt);
      if (d.phase === 'out') this.fly(game, b, d, dt);
      else if (d.phase === 'spin') this.spin(game, b, d);
      else if (d.phase === 'chain') this.leap(game, b, d);
      else if (d.phase === 'lodge') this.lodge(game, b, d);
      if (d.phase === 'back') this.reel(game, b, d);
    }
    this.cutTunnels(game, dt);
    p.drillOut = [this.drills[0].phase !== 'home', this.drills[1].phase !== 'home'];
  }

  // Fire the next drill (Twin Drills: both, when both are home). Waits if the drill whose turn it is is out.
  launch(game, b) {
    const p = game.player;
    const twin = !!b.t4;
    let arms;
    if (twin) {
      arms = this.drills.filter((d) => d.phase === 'home').map((d) => d.arm);
      if (arms.length < 2) return;
    } else {
      const order = [this.nextArm, 1 - this.nextArm];
      const arm = order.find((a) => this.drills[a].phase === 'home');
      if (arm === undefined) return;
      arms = [arm];
      this.nextArm = 1 - arm;
    }
    const cycle = W.harpoonCooldown(b);
    this.cycle = cycle;
    this.cd = cycle;
    this.shots++;
    const outShare = twin ? W.twinOutShare : W.harpoonOutShare;
    const range = W.harpoonRange(b);
    const dmg = weaponDamage(p, 'harpoon', b);
    const drillBudget = W.harpoonDrill(b) * ((p.stats?.miningSpeed || TUNING.miningSpeed || 75) / (TUNING.miningSpeed || 75));
    for (const arm of arms) {
      const d = this.drills[arm];
      const s = drillSocket(p, arm, this.socket);
      const a = p.angle + (twin ? (arm ? 1 : -1) * W.twinSpread / 2 : 0);
      Object.assign(d, {
        phase: 'out', phaseT: 0, throwId: ++this.passId,
        x: s.x, y: s.y, sx: s.x, sy: s.y, dirX: Math.cos(a), dirY: Math.sin(a),
        dist: 0, range, speed: range / (cycle * outShare), outT: cycle * outShare, backT: cycle * (twin ? W.twinBackShare : W.harpoonBackShare),
        pace: Math.min(1, cycle / BASE_CYCLE), dmg, keep: W.harpoonPierceKeep(b), pierceMult: 1, drillLeft: drillBudget,
        extraT: 0, spun: false, spinTick: 0, leapt: false, leapsLeft: 0, leapTarget: null, lodged: null, flash: 0
      });
      d.trail.length = 0;
      // Launch kick: a flash and a spark spray off the arm as the drill leaves it.
      game.particles.spawnFlash?.(s.x, s.y, 22, DRILL_HUE, 0.09);
      game.particles.spawnDirectionalSparks?.(s.x, s.y, a, 0.5, 8, DRILL_HUE, 10);
      game.grid?.applyImpulse?.(s.x, s.y, 14, 80, DRILL_HUE);
    }
    kickShipRecoil(p, twin ? 1.3 : 1);
    game.addShake?.(twin ? 1.8 : 1.3);
    game.sound.playDrillLaunch?.(arms.length);
  }

  fly(game, b, d, dt) {
    const step = Math.min(d.range - d.dist, d.speed * dt);
    const ax = d.x, ay = d.y;
    let bx = ax + d.dirX * step, by = ay + d.dirY * step;
    // Rock first: a bite or a bedrock clang cuts the sweep short at the rock face.
    const stop = this.drillRocks(game, d, ax, ay, bx, by);
    if (stop) { bx = stop.x; by = stop.y; }
    this.bore(game, b, d, ax, ay, bx, by, 'harpoon');
    if (d.phase !== 'out') return; // a plate or a Detonator lodge ended the flight inside bore
    this.trailPush(d, ax, ay);
    d.x = bx; d.y = by;
    d.dist += Math.hypot(bx - ax, by - ay);
    if (stop || d.dist >= d.range - 1e-6) this.endOfThrow(game, b, d);
  }

  trailPush(d, x, y) {
    d.trail.push(x, y);
    if (d.trail.length > TRAIL * 2) d.trail.splice(0, 2);
  }

  // Bore every enemy the tip passes this tick, nearest first, each once per pass (out, then back).
  bore(game, b, d, ax, ay, bx, by, stat) {
    const enemies = game.enemyManager.enemies;
    const hits = this.sweep;
    hits.length = 0;
    const tip = W.harpoonTipRadius;
    const seg = this.seg;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.drillPass === d.throwId) continue;
      const reach = (e.radius || 10) + tip;
      if (segDist(e.x, e.y, ax, ay, bx, by, seg) > reach * reach) continue;
      hits.push({ e, t: seg.t });
      if (hits.length >= MAX_SWEEP) break;
    }
    if (!hits.length) return;
    hits.sort((u, v) => u.t - v.t);
    const ang = Math.atan2(by - ay, bx - ax);
    const out = d.phase === 'out';
    const share = out ? 1 : W.reelShare;
    for (let k = 0; k < hits.length; k++) {
      const e = hits[k].e;
      if (e.dead) continue;
      e.drillPass = d.throwId;
      const kick = awayKnock(game, e, 3, this.kick);
      game.hitEnemy(e, d.dmg * share * d.pierceMult, 'harpoon', kick.x, kick.y, 1, stat);
      const survived = !e.dead && e.hp > 0;
      d.pierceMult *= d.keep; // every enemy bored costs the drill some bite, kill or not
      d.flash = 0.12;
      // Screw-through: sparks spray off both sides of the hull and chips fly out the back.
      game.particles.spawnDirectionalSparks?.(e.x, e.y, ang, 0.9, 6, DRILL_HUE, 7);
      game.particles.spawnDirectionalSparks?.(e.x, e.y, ang + Math.PI, 0.6, 3, 30, 5);
      game.particles.spawnFlash?.(e.x, e.y, (e.radius || 10) * 1.2, DRILL_HUE, 0.06);
      game.sound.playDrillHit?.('enemy');
      if (!out) continue;
      if (e.deflect) {
        // An armored plate: the drill clangs off it and reels back from there.
        d.x = ax + (bx - ax) * hits[k].t;
        d.y = ay + (by - ay) * hits[k].t;
        this.clang(game, d, d.x, d.y);
        this.endOfThrow(game, b, d, true);
        break;
      }
      if (survived && b.tf?.has('detonate') && !d.lodged) {
        // Detonator Bit: it screws into the first enemy that survives it and stays there (the enemy moves
        // freely; the drill rides along).
        d.lodged = e;
        d.lodgeX = -d.dirX * (e.radius || 10) * 0.4;
        d.lodgeY = -d.dirY * (e.radius || 10) * 0.4;
        d.x = e.x + d.lodgeX;
        d.y = e.y + d.lodgeY;
        this.endOfThrow(game, b, d);
        break;
      }
    }
    hits.length = 0;
  }

  setPhase(d, phase) {
    d.phase = phase;
    d.phaseT = 0;
    if (phase === 'back') {
      d.backX = d.x;
      d.backY = d.y;
      d.throwId = ++this.passId; // the way back is a fresh pass: everything on it gets bored again
      d.pierceMult = 1;
      d.reelSoundAt = 0;
      d.trail.length = 0;
      // Time spent spinning, lodged or ricocheting comes off the reel (down to a third of it), so the arm
      // is home for its next turn anyway.
      d.backT = Math.max(d.backT / 3, d.backT - d.extraT);
    }
  }

  // End of the outward flight (full reach, a bite, bedrock, a plate or a Detonator lodge): lodge, spin,
  // ricochet, then reel back.
  endOfThrow(game, b, d, plate = false) {
    if (d.phase === 'out') {
      this.tunnel(game, b, d);
      if (d.lodged) {
        this.setPhase(d, 'lodge');
        game.sound.playDrillHit?.('lodge');
        return;
      }
    }
    if (!plate && b.t8 && !d.spun) {
      d.spun = true;
      this.setPhase(d, 'spin');
      d.spinTick = 0;
      d.drillLeft += W.harpoonDrill(b) * W.spinShare; // the spinning drill chews a little more rock
      return;
    }
    if (!plate && b.t12 && !d.leapt) {
      d.leapt = true;
      this.setPhase(d, 'chain');
      d.leapsLeft = W.chainLeaps;
      d.leapTarget = null;
      return;
    }
    this.setPhase(d, 'back');
  }

  // Drill the rocks on the segment, nearest first. Returns the stop point when the drill bites into a rock
  // it can't finish (or hits bedrock), else null. Rock it breaks is the ship's mining.
  drillRocks(game, d, ax, ay, bx, by) {
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
      if (rock.hp <= 0 || rock.drillPass === d.throwId) continue;
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
        this.clang(game, d, face.x, face.y);
        break;
      }
      rock.drillPass = d.throwId;
      if (!this.chew(game, d, rock, face.x, face.y)) stop = face;
    }
    this.flushRocks(game);
    return stop;
  }

  // Take what the drill budget allows out of one rock. True when it broke.
  chew(game, d, rock, cx, cy) {
    const am = game.asteroidManager;
    const bite = Math.min(d.drillLeft, rock.hp);
    if (bite <= 0) {
      this.biteFx(game, d, rock, cx, cy, false);
      return false;
    }
    d.drillLeft -= bite;
    rock.hp -= bite;
    rock.hitFlash = 0.85;
    rock.heat = Math.min(1, (rock.heat || 0) + 0.5);
    rock.lastGrindX = cx;
    rock.lastGrindY = cy;
    am.free?.(rock);
    const broke = rock.hp <= 0;
    this.biteFx(game, d, rock, cx, cy, broke);
    if (broke) this.broken.push(rock);
    return broke;
  }

  // Rock chips: sparks in the ore's colour fly back off the face, and a crunch when the drill bites in.
  biteFx(game, d, rock, cx, cy, broke) {
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 42;
    const back = Math.atan2(-d.dirY, -d.dirX);
    game.particles.spawnDirectionalSparks?.(cx, cy, back, 1.1, broke ? 7 : 10, hue, 8);
    game.particles.spawnExplosionSparks?.(cx, cy, broke ? 3 : 5, hue, 0.7, 2.6, 2.5);
    d.flash = 0.18;
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

  clang(game, d, x, y) {
    d.flash = 0.25;
    game.particles.spawnExplosionSparks?.(x, y, 8, 270, 1.2, 6, 2);
    game.particles.spawnFlash?.(x, y, 14, 270, 0.1);
    game.sound.playDrillHit?.('bedrock');
  }

  // Drill Spin: the drill holds where it stopped and grinds everything round its tip.
  spin(game, b, d) {
    const total = W.spinTime * d.pace;
    const due = Math.min(W.spinTicks, Math.floor((d.phaseT / total) * W.spinTicks + 1e-9) + 1);
    while (d.spinTick < due) {
      d.spinTick++;
      const r = W.spinRadius * areaMult(game.player);
      this.ring(game, d.x, d.y, r, d.dmg * W.spinShare / W.spinTicks, 0.6, 'harpoonspin');
      this.grindRocks(game, d, r * 0.6);
      game.particles.spawnExplosionSparks?.(d.x, d.y, 3, DRILL_HUE, 1.4, 5, 1.6);
      if (d.spinTick === 1) game.sound.playDrillSpin?.(total);
    }
    if (d.phaseT >= total - 1e-9) this.endOfThrow(game, b, d);
  }

  // Spin drilling: chew every rock touching the spin core (bedrock just sparks).
  grindRocks(game, d, r) {
    const am = game.asteroidManager;
    if (!am?.asteroids?.length || d.drillLeft <= 0) return;
    const near = am.getNearbyAsteroids(d.x, d.y, am.cellsFor(r));
    for (let i = 0; i < near.length; i++) {
      const rock = near[i];
      if (rock.hp <= 0 || rock.unbreakable) continue;
      const dist = Math.hypot(rock.x - d.x, rock.y - d.y);
      if (dist > rock.radius + r) continue;
      const k = (dist || 1);
      this.chew(game, d, rock, rock.x + (d.x - rock.x) / k * rock.radius, rock.y + (d.y - rock.y) / k * rock.radius);
      if (d.drillLeft <= 0) break;
    }
    this.flushRocks(game);
  }

  // Ricochet Bits: from the end of its throw the drill bounces to the nearest enemy it hasn't bored this
  // throw, up to W.chainLeaps times, then reels in.
  leap(game, b, d) {
    const each = W.chainTime;
    if (!d.leapTarget || d.leapTarget.dead) {
      if (d.leapsLeft <= 0 || !(d.leapTarget = this.nearestFresh(game, d))) {
        d.leapTarget = null;
        d.leapsLeft = 0;
        this.endOfThrow(game, b, d);
        return;
      }
      d.leapFromX = d.x;
      d.leapFromY = d.y;
      d.phaseT = 0;
      d.trail.length = 0;
      game.sound.playDrillHit?.('ricochet');
    }
    const e = d.leapTarget;
    const k = Math.min(1, d.phaseT / each);
    this.trailPush(d, d.x, d.y);
    d.x = d.leapFromX + (e.x - d.leapFromX) * k;
    d.y = d.leapFromY + (e.y - d.leapFromY) * k;
    if (k < 1) return;
    d.leapsLeft--;
    d.leapTarget = null;
    const dx = e.x - d.leapFromX, dy = e.y - d.leapFromY;
    const len = Math.hypot(dx, dy) || 1;
    d.dirX = dx / len; d.dirY = dy / len;
    e.drillPass = d.throwId;
    const kick = awayKnock(game, e, 2, this.kick);
    game.hitEnemy(e, d.dmg * W.chainShare, 'harpoon', kick.x, kick.y, 1, 'harpoonchain');
    d.flash = 0.14;
    game.particles.spawnDirectionalSparks?.(e.x, e.y, Math.atan2(dy, dx), 0.8, 6, DRILL_HUE, 7);
    game.sound.playDrillHit?.('enemy');
  }

  nearestFresh(game, d) {
    const enemies = game.enemyManager.enemies;
    let best = null, bestD = W.chainRange * W.chainRange;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!target(e) || e.deflect || e.drillPass === d.throwId) continue;
      const q = (e.x - d.x) ** 2 + (e.y - d.y) ** 2;
      if (q < bestD) { bestD = q; best = e; }
    }
    return best;
  }

  // Detonator Bit: the drill rides in the enemy it screwed into (the enemy is never held), then blows.
  lodge(game, b, d) {
    const e = d.lodged;
    if (e && !e.dead) { d.x = e.x + d.lodgeX; d.y = e.y + d.lodgeY; }
    if (d.phaseT < W.detDelay * d.pace) return;
    const r = W.detRadius * areaMult(game.player);
    this.ring(game, d.x, d.y, r, d.dmg * W.detShare, BLAST_KNOCK, 'harpoonblast');
    this.blasts++;
    game.particles.spawnFlash?.(d.x, d.y, r * 0.8, 36, 0.12);
    game.particles.spawnShockwave?.(d.x, d.y, r, DRILL_HUE, 3, 0.22);
    game.particles.spawnExplosionSparks?.(d.x, d.y, 12, 30, 1.6, 7, 2);
    game.particles.spawnPolygonShatter?.(d.x, d.y, 8, 4, Math.atan2(d.dirY, d.dirX), DRILL_HUE, 0.5);
    game.addShake?.(2.2);
    game.sound.playDrillBlast?.();
    d.lodged = null;
    this.endOfThrow(game, b, d);
  }

  // A ring of damage at (cx, cy): the same reach and falloff as Game.damageEnemiesInRadius, but the knockback
  // points away from the SHIP, not the ring's centre (a ring beyond an enemy would otherwise shove it at you).
  ring(game, cx, cy, rad, dmg, knock, stat) {
    const falloff = TUNING.splashEdgeFalloff ?? 0.4;
    const enemies = game.enemyManager.enemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) continue;
      const dist = Math.hypot(e.x - cx, e.y - cy);
      if (dist > rad + e.radius) continue;
      const reach = Math.max(0, Math.min(1, (dist - e.radius) / rad));
      const kick = awayKnock(game, e, knock, this.kick);
      game.hitEnemy(e, dmg * (1 - falloff * reach), 'harpoon', kick.x, kick.y, 0.6, stat);
    }
    game.grid?.ripple?.(cx, cy, rad, DRILL_HUE);
  }

  // Reel the drill back into its arm (which moves with the ship), boring everything on the way back.
  reel(game, b, d) {
    const p = game.player;
    const k = Math.min(1, d.phaseT / d.backT);
    // The winch starts hard and eases into the dock.
    const ease = 1 - (1 - k) * (1 - k);
    const s = drillSocket(p, d.arm, this.socket);
    const ax = d.x, ay = d.y;
    const bx = d.backX + (s.x - d.backX) * ease, by = d.backY + (s.y - d.backY) * ease;
    this.bore(game, b, d, ax, ay, bx, by, 'harpoonreel');
    this.trailPush(d, ax, ay);
    d.x = bx; d.y = by;
    if (d.phaseT >= d.reelSoundAt) {
      d.reelSoundAt = d.phaseT + 0.07;
      if (k < 0.92) game.sound.playDrillReel?.(k);
    }
    if (k < 1) return;
    this.dock(game, d, s);
  }

  // Home: the drill slams back onto its arm with a clank and a spark burst.
  dock(game, d, s) {
    d.phase = 'home';
    d.phaseT = 0;
    d.trail.length = 0;
    this.docks++;
    game.particles.spawnExplosionSparks?.(s.x, s.y, 6, DRILL_HUE, 1, 4, 1.4);
    game.particles.spawnFlash?.(s.x, s.y, 12, 190, 0.07);
    kickShipRecoil(game.player, 0.5);
    game.sound.playDrillDock?.();
  }

  // Tunnel Bore: the line a drill bored on the way out keeps cutting for W.tunnelLife s.
  tunnel(game, b, d) {
    if (!b.tf?.has('tunnel')) return;
    if (Math.hypot(d.x - d.sx, d.y - d.sy) < 8) return;
    this.tunnels.push({ ax: d.sx, ay: d.sy, bx: d.x, by: d.y, life: W.tunnelLife, tickT: 0, dmg: d.dmg, seed: Math.random() * 10 });
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
  // Tunnels under everything; for each launched drill a bright cable from its arm, a gold motion streak, and
  // the drill itself drawn big (the ship's own cone, white core, gold threads racing to the tip).
  draw(ctx, game) {
    const p = game.player;
    if (!((p?.weapons?.harpoon || 0) > 0)) return;
    const t = this.time;
    for (const tn of this.tunnels) this.drawTunnel(ctx, tn, t);
    for (const d of this.drills) {
      if (d.phase === 'home') continue;
      const s = drillSocket(p, d.arm, this.socket);
      this.drawCable(ctx, s.x, s.y, d, t);
      const tr = d.trail;
      if (tr.length >= 2) {
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass === 0 ? `hsla(${DRILL_HUE}, 100%, 55%, 0.4)` : 'rgba(255, 250, 220, 0.75)';
          ctx.lineWidth = pass === 0 ? 11 : 3;
          ctx.beginPath();
          ctx.moveTo(tr[0], tr[1]);
          for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
        }
      }
      // The drill points along its flight on the way out and back at the ship on the way in (tip first,
      // as it bores back).
      const heading = d.phase === 'back' ? Math.atan2(s.y - d.y, s.x - d.x) : Math.atan2(d.dirY, d.dirX);
      const spinning = d.phase === 'spin';
      const hot = d.phase === 'lodge' && Math.sin(d.phaseT * 40) > 0;
      // Soft glow behind the head so it pops off the busy background.
      ctx.fillStyle = `hsla(${DRILL_HUE}, 100%, 60%, 0.22)`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 20, 0, Math.PI * 2);
      ctx.fill();
      this.drawHead(ctx, d.x, d.y, heading, HEAD_SCALE, t * (spinning ? 22 : 14), spinning ? t * 40 : 0, hot);
      if (spinning) {
        const r = W.spinRadius * areaMult(p);
        ctx.strokeStyle = `hsla(${DRILL_HUE}, 100%, 70%, 0.5)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a0 = t * 22 + (k * Math.PI * 2) / 3;
          ctx.moveTo(d.x + Math.cos(a0) * r * 0.8, d.y + Math.sin(a0) * r * 0.8);
          ctx.arc(d.x, d.y, r * 0.8, a0, a0 + 1.1);
        }
        ctx.stroke();
      }
      if (d.flash > 0) {
        ctx.fillStyle = `rgba(255, 240, 180, ${Math.min(1, d.flash * 5)})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 8 + 16 * d.flash, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The cable: a dark sheath under a bright cyan-white core with gold link ticks; taut on the way out, a
  // little slack wobble while it reels in.
  drawCable(ctx, sx, sy, d, t) {
    const dx = d.x - sx, dy = d.y - sy;
    const len = Math.hypot(dx, dy);
    if (len < 3) return;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const slack = d.phase === 'back' ? 1 : 0.2;
    const n = Math.max(2, Math.min(28, Math.round(len / 16)));
    const point = (f) => {
      const wave = Math.sin(f * Math.PI) * Math.sin(f * 9 - t * 26) * 4 * slack;
      return [sx + dx * f + px * wave, sy + dy * f + py * wave];
    };
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(4, 18, 34, 0.9)' : pass === 1 ? 'rgba(0, 243, 255, 0.45)' : CABLE_COLOR;
      ctx.lineWidth = pass === 0 ? 6 : pass === 1 ? 5 : 2.2;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const [x, y] = point(i / n);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = THREAD_COLOR;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    const links = Math.floor(len / 20);
    for (let i = 1; i <= links; i++) {
      const [x, y] = point((i * 20) / len);
      ctx.moveTo(x - px * 3, y - py * 3);
      ctx.lineTo(x + px * 3, y + py * 3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // One drill head: the ship's own drill shape (base at 0, point at 16.5), threads scrolling at `thread`.
  drawHead(ctx, x, y, heading, scale, thread, roll, hot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading + roll);
    ctx.scale(scale, scale);
    const drillLen = 16.5, half = 6.2;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? (hot ? '#ff5533' : DRILL_COLOR) : '#ffffff';
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
