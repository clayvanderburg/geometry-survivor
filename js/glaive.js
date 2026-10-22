// Glaive Discs: an autonomous kinetic slot weapon. Every throw interval the ship flings spinning discs at
// the nearest enemies. A disc that hits ricochets to the nearest enemy it has not just hit (or arcs back
// round onto the same one when it is alone), up to its ricochet count, then fades. Rocks bounce it too,
// and so do the plates of shielded or armored hulls (that bounce spends a ricochet and deals nothing).
// Every bounce sheds a little speed; a disc that has slowed too far, or outlived its life, fades out.
//
// Breakthroughs: Fission Discs (LV 6: the first hit splits a disc into two twins that share out the rest
// of its ricochets), Momentum Edge (LV 12: bounces speed a disc up and every ricochet hits harder than the
// last), Boomerang Recall (LV 18: a spent disc swings back to the ship, slicing enemies on the way home).
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'glaive',
// stat 'glaive_recall' for the way home). Discs live in a fixed pool; a full pool skips the extra discs.
import { WEAPON_SCALING as W, weaponDamage, projectileSpeedMult } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import * as BTX from './bt-extras.js'; // pool Breakthroughs: Shatter Edge, Arc Discs
import { shieldBlocks } from './archetypes.js';

export const GLAIVE_HUE = 24;     // molten orange
const POOL = 96;
const TRAIL = 6;                  // trail samples per disc (one per tick)
const MAX_SUBSTEP = 14;           // px a disc may travel per collision step
const KNOCK = 1.4;
const SPIN = 22;                  // rad/s of the drawn spin
const FADE = 0.18;                // s a spent disc takes to vanish
const SOUND_HITS_PER_TICK = 2;
const POP = 0.13;                // s of the squash-and-flash pop after every bounce
const DRAW_SCALE = 1.35;         // drawn a little larger than the hit circle so it reads in a crowd

// Anything alive, hittable and worth chasing (no Vortex portals, no invulnerable hulls).
const targetable = (e) => !e.dead && !e.invulnerable && e.type !== 'blackhole';

function makeDisc() {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, speed: 0, launch: 0, life: 0, fade: 0, pop: 0,
    left: 0, hits: 0, twin: false, target: null, last: null, recall: false, recallLeft: 0,
    recalled: [], spin: 0, tx: new Float32Array(TRAIL), ty: new Float32Array(TRAIL), trail: 0
  };
}

export class GlaiveDiscs {
  constructor() {
    this.discs = Array.from({ length: POOL }, makeDisc);
    this.picks = [];
    this.clear();
  }

  // Run reset: no discs out, ready to throw.
  clear() {
    for (const d of this.discs) this.free(d);
    this.count = 0;
    this.timer = 0;
    this.throws = 0;
    this.time = 0;
    this.soundHits = 0;
  }

  free(d) {
    d.active = false;
    d.target = d.last = null;
    d.recalled.length = 0;
  }

  spawn() {
    for (const d of this.discs) if (!d.active) return d;
    return null;
  }

  update(dt, game) {
    const p = game.player;
    this.time += dt;
    this.soundHits = 0;
    const equipped = (p?.weapons?.glaive || 0) > 0;
    if (!equipped && this.count === 0) return;
    const b = equipped ? weaponBuild(p, 'glaive') : null;
    if (b) {
      if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
      if (this.timer <= 0 && this.throwDiscs(game, p, b)) this.timer = W.glaiveCooldown(b);
    }
    let n = 0;
    for (const d of this.discs) {
      if (!d.active) continue;
      this.step(d, dt, game, b);
      if (d.active) n++;
    }
    this.count = n;
  }

  // Nearest `count` targets within throw range, nearest first (fewer when fewer are about).
  pickTargets(game, p, count) {
    const picks = this.picks;
    picks.length = 0;
    const range = W.glaiveThrowRange;
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!targetable(e) || e.deflect) continue;
      const dSq = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (dSq > range * range) continue;
      if (picks.length === count && dSq >= picks[count - 1].dSq) continue;
      let j = picks.length < count ? picks.length : count - 1;
      picks[j] = { e, dSq };
      while (j > 0 && picks[j - 1].dSq > dSq) {
        const t = picks[j - 1];
        picks[j - 1] = picks[j];
        picks[j] = t;
        j--;
      }
    }
    return picks;
  }

  // One throw: a disc at each of the nearest enemies, doubling up round the list when there are fewer.
  // Nothing in range: hold the throw until something is.
  throwDiscs(game, p, b) {
    const n = W.glaiveCount(b);
    const picks = this.pickTargets(game, p, n);
    if (!picks.length) return false;
    const speed = W.glaiveSpeed(b) * projectileSpeedMult(p); // Velocity Coils
    for (let i = 0; i < n; i++) {
      const d = this.spawn();
      if (!d) break;
      const t = picks[i % picks.length].e;
      const round = Math.floor(i / picks.length);
      const a = Math.atan2(t.y - p.y, t.x - p.x) + (round ? (round % 2 ? 1 : -1) * 0.35 * Math.ceil(round / 2) : 0);
      const off = (p.radius || 15) + 6;
      d.active = true;
      d.x = p.x + Math.cos(a) * off;
      d.y = p.y + Math.sin(a) * off;
      d.speed = d.launch = speed;
      d.vx = Math.cos(a) * speed;
      d.vy = Math.sin(a) * speed;
      d.life = 0;
      d.fade = 0;
      d.left = W.glaiveBounces(b);
      d.hits = 0;
      d.twin = false;
      d.target = t;
      d.last = null;
      d.recall = false;
      d.recallLeft = 0;
      d.recalled.length = 0;
      d.spin = Math.random() * Math.PI * 2;
      d.pop = 0;
      d.trail = 0;
    }
    this.throws++;
    game.sound.playGlaiveThrow?.(n);
    return true;
  }

  step(d, dt, game, b) {
    if (d.pop > 0) d.pop = Math.max(0, d.pop - dt);
    d.spin += SPIN * dt * (d.recall ? 1.4 : 1);
    // Trail: newest sample first.
    for (let k = TRAIL - 1; k > 0; k--) {
      d.tx[k] = d.tx[k - 1];
      d.ty[k] = d.ty[k - 1];
    }
    d.tx[0] = d.x;
    d.ty[0] = d.y;
    d.trail = Math.min(TRAIL, d.trail + 1);
    if (d.fade > 0) {
      d.fade -= dt;
      d.x += d.vx * dt * 0.3;
      d.y += d.vy * dt * 0.3;
      if (d.fade <= 0) this.free(d);
      return;
    }
    d.life += dt;
    if (!b) return this.spend(d, game, null); // unequipped mid-flight
    if (d.recall) return this.stepRecall(d, dt, game, b);
    if (d.life > W.glaiveLife || d.speed < d.launch * W.glaiveMinSpeedShare) return this.spend(d, game, b);

    // Steer toward the current target (re-pick when it died).
    if (d.target && !targetable(d.target)) d.target = this.nearest(game, d.x, d.y, W.glaiveRicochetRange, d.last, null);
    if (d.target) this.steer(d, d.target.x, d.target.y, W.glaiveTurn, dt);

    const dist = d.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
    for (let s = 0; s < steps && d.active && d.fade <= 0 && !d.recall; s++) {
      d.x += d.vx * dt / steps;
      d.y += d.vy * dt / steps;
      this.bounceRocks(d, game, b);
      this.bounceWalls(d, game, b);
      this.collideEnemies(d, game, b);
    }
  }

  // Turn the velocity toward (x, y) by at most `rate` rad/s, keeping the speed.
  steer(d, x, y, rate, dt) {
    const want = Math.atan2(y - d.y, x - d.x);
    const cur = Math.atan2(d.vy, d.vx);
    let diff = want - cur;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    const turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
    const a = cur + turn;
    d.vx = Math.cos(a) * d.speed;
    d.vy = Math.sin(a) * d.speed;
  }

  setSpeed(d, speed) {
    const k = speed / (d.speed || 1);
    d.speed = speed;
    d.vx *= k;
    d.vy *= k;
  }

  // A bounce: Momentum Edge speeds the disc up (to a cap), otherwise it sheds W.glaiveSpeedLoss.
  bounceSpeed(d, b) {
    if (b?.t8) this.setSpeed(d, Math.min(d.launch * W.momentumMaxSpeed, d.speed * (1 + W.momentumSpeedGain)));
    else this.setSpeed(d, d.speed * (1 - W.glaiveSpeedLoss));
  }

  // Rocks are solid: reflect off the rock's surface. Costs speed, never a ricochet.
  bounceRocks(d, game, b) {
    const am = game.asteroidManager;
    if (!am?.asteroids?.length) return;
    const near = am.getNearbyAsteroids(d.x, d.y, am.cellsFor(W.glaiveRadius));
    for (let j = 0; j < near.length; j++) {
      const rock = near[j];
      if (rock.hp <= 0) continue;
      const dx = d.x - rock.x;
      const dy = d.y - rock.y;
      const reach = rock.radius + W.glaiveRadius;
      const dSq = dx * dx + dy * dy;
      if (dSq >= reach * reach) continue;
      const dist = Math.sqrt(dSq) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      d.x = rock.x + nx * (reach + 0.5);
      d.y = rock.y + ny * (reach + 0.5);
      const dot = d.vx * nx + d.vy * ny;
      if (dot < 0) {
        d.vx -= 2 * dot * nx;
        d.vy -= 2 * dot * ny;
      }
      this.bounceSpeed(d, b);
      d.pop = POP;
      game.particles.spawnDirectionalSparks(d.x - nx * W.glaiveRadius, d.y - ny * W.glaiveRadius, Math.atan2(ny, nx), 0.9, 6, GLAIVE_HUE + 20, 7);
      game.particles.spawnFlash?.(d.x - nx * W.glaiveRadius, d.y - ny * W.glaiveRadius, 10, GLAIVE_HUE + 30, 0.07);
      if (this.soundHits++ < SOUND_HITS_PER_TICK) game.sound.playGlaiveRicochet?.(0, 'rock');
      return;
    }
  }

  // The world's edge bounces it back like a rock.
  bounceWalls(d, game, b) {
    const r = W.glaiveRadius;
    const ww = game.worldWidth || Infinity;
    const wh = game.worldHeight || Infinity;
    let hit = false;
    if (d.x < r && d.vx < 0) { d.vx = -d.vx; hit = true; }
    if (d.x > ww - r && d.vx > 0) { d.vx = -d.vx; hit = true; }
    if (d.y < r && d.vy < 0) { d.vy = -d.vy; hit = true; }
    if (d.y > wh - r && d.vy > 0) { d.vy = -d.vy; hit = true; }
    if (hit) this.bounceSpeed(d, b);
  }

  // Nearest targetable enemy within `range` of (x, y), skipping `skip` and `skip2`.
  nearest(game, x, y, range, skip, skip2) {
    let best = null;
    let bestSq = range * range;
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e === skip || e === skip2 || !targetable(e) || e.deflect) continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  collideEnemies(d, game, b) {
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // The enemy it just bounced off is skipped unless the disc has swung back round onto it on purpose.
      if (!targetable(e) || (e === d.last && e !== d.target)) continue;
      const dx = e.x - d.x;
      const dy = e.y - d.y;
      const reach = e.radius + W.glaiveRadius;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (e === d.last && d.vx * dx + d.vy * dy <= 0) continue; // still leaving it
      this.impact(d, e, game, b);
      return;
    }
  }

  // A disc meets enemy `e`: a plate deflects it (spends a ricochet), anything else takes the hit.
  impact(d, e, game, b) {
    const dist = Math.hypot(e.x - d.x, e.y - d.y) || 1;
    const nx = (d.x - e.x) / dist; // from the hull out toward the disc
    const ny = (d.y - e.y) / dist;
    const plated = e.deflect || (e.shieldArc && shieldBlocks(e, e.x + nx * (e.shieldRadius || e.radius), e.y + ny * (e.shieldRadius || e.radius), d.vx, d.vy));
    if (plated) {
      e.hitFlash = Math.max(e.hitFlash || 0, 0.35);
      game.particles.spawnDirectionalSparks(d.x, d.y, Math.atan2(ny, nx), 0.8, 6, 50, 7);
      if (this.soundHits++ < SOUND_HITS_PER_TICK) game.sound.playGlaiveRicochet?.(0, 'plate');
    } else {
      const dmg = this.hitDamage(d, game, b);
      d.hits++;
      game.hitEnemy(e, dmg, 'glaive', (d.vx / d.speed) * KNOCK, (d.vy / d.speed) * KNOCK, 1, 'glaive');
      if (d.hits > 1) BTX.glaiveArc(game, b, d.last, e, dmg);
      game.particles.spawnDirectionalSparks(d.x, d.y, Math.atan2(d.vy, d.vx), 0.7, 5, GLAIVE_HUE + 15, 8);
      game.particles.spawnShockwave(e.x, e.y, e.radius + 14, GLAIVE_HUE + Math.min(30, d.hits * 4), 2, 0.12);
      if (this.soundHits++ < SOUND_HITS_PER_TICK) game.sound.playGlaiveRicochet?.(d.hits, 'enemy');
    }
    d.pop = POP;
    // Fission Discs: the first hit splits the disc; both twins carry the ricochets it had left.
    let twin = null;
    if (b.t4 && !d.twin && !plated) {
      d.twin = true;
      twin = this.spawn();
      if (twin) {
        Object.assign(twin, { active: true, x: d.x, y: d.y, speed: d.speed, launch: d.launch, life: d.life, fade: 0, left: d.left, hits: d.hits, twin: true, recall: false, recallLeft: 0, spin: d.spin + 1, trail: 0 });
        twin.recalled.length = 0;
        twin.tx.fill(d.x);
        twin.ty.fill(d.y);
      }
      if (twin) twin.pop = POP;
      game.particles.spawnFlash?.(d.x, d.y, 22, GLAIVE_HUE + 30, 0.12);
      game.particles.spawnShockwave(d.x, d.y, 30, GLAIVE_HUE + 35, 2.5, 0.16);
      game.sound.playGlaiveSplit?.();
    }
    this.ricochet(d, e, nx, ny, game, b, null);
    if (twin) this.ricochet(twin, e, nx, ny, game, b, d.target);
  }

  // After a bounce off `e`: spend a ricochet and head for the next enemy, or fade (or fly home).
  ricochet(d, e, nx, ny, game, b, avoid) {
    d.last = e;
    if (d.left <= 0) return this.spend(d, game, b);
    d.left--;
    // Reflect off the hull so the bounce reads, then steer for the next target.
    const dot = d.vx * nx + d.vy * ny;
    if (dot < 0) {
      d.vx -= 2 * dot * nx;
      d.vy -= 2 * dot * ny;
    }
    this.bounceSpeed(d, b);
    const next = this.nearest(game, d.x, d.y, W.glaiveRicochetRange, e, avoid) || this.nearest(game, d.x, d.y, W.glaiveRicochetRange, e, null);
    d.target = next || (targetable(e) && !e.deflect ? e : null); // alone: swing back round onto it
    if (next) {
      // Ricochets snap most of the way onto the next target: a bounce, not a slow curve.
      const a = Math.atan2(next.y - d.y, next.x - d.x);
      const cur = Math.atan2(d.vy, d.vx);
      let diff = a - cur;
      diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
      const turned = cur + diff * 0.85;
      d.vx = Math.cos(turned) * d.speed;
      d.vy = Math.sin(turned) * d.speed;
    }
  }

  // Damage of the disc's next hit: Momentum Edge grows every ricochet; Fission twins carry their share.
  hitDamage(d, game, b) {
    let dmg = weaponDamage(game.player, 'glaive', b);
    if (d.hits > 0) {
      if (d.twin) dmg *= W.fissionShare;
      if (b.t8) dmg *= W.momentumGrowth ** d.hits;
    }
    return dmg;
  }

  // Out of ricochets, speed or life: Boomerang Recall flies it home, otherwise it fades.
  spend(d, game, b) {
    if (b?.t12 && !d.recall) {
      d.recall = true;
      d.recallLeft = W.recallHits;
      d.recalled.length = 0;
      d.life = 0;
      d.target = null;
      this.setSpeed(d, d.launch * W.recallSpeed);
      return;
    }
    d.fade = FADE;
    d.target = null;
    game.particles.spawnExplosionSparks(d.x, d.y, 5, GLAIVE_HUE + 10, 1.5, 6, 1.6);
    BTX.glaiveShatter(game, b, d, weaponDamage(game.player, 'glaive', b));
  }

  // Boomerang Recall: home on the ship, slicing each enemy on the way once (up to recallHits).
  stepRecall(d, dt, game, b) {
    const p = game.player;
    // Tightens its turn as it goes so it always makes it home.
    this.steer(d, p.x, p.y, W.glaiveTurn * (1 + d.life * 3), dt);
    const steps = Math.max(1, Math.ceil(d.speed * dt / MAX_SUBSTEP));
    const enemies = game.enemyManager.enemies;
    for (let s = 0; s < steps; s++) {
      d.x += d.vx * dt / steps;
      d.y += d.vy * dt / steps;
      const home = (p.radius || 15) + W.glaiveRadius;
      if ((d.x - p.x) ** 2 + (d.y - p.y) ** 2 <= home * home || d.life > 2.5) {
        this.free(d);
        game.particles.spawnFlash?.(p.x, p.y, 14, GLAIVE_HUE, 0.08);
        game.particles.spawnShockwave(p.x, p.y, (p.radius || 15) + 16, GLAIVE_HUE + 20, 2, 0.14, true);
        game.sound.playGlaiveCatch?.();
        return;
      }
      if (d.recallLeft <= 0) continue;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!targetable(e) || e.deflect || d.recalled.includes(e)) continue;
        const reach = e.radius + W.glaiveRadius;
        if ((e.x - d.x) ** 2 + (e.y - d.y) ** 2 > reach * reach) continue;
        d.recalled.push(e);
        d.recallLeft--;
        const dmg = weaponDamage(p, 'glaive', b) * W.recallShare;
        game.hitEnemy(e, dmg, 'glaive', (d.vx / d.speed) * KNOCK, (d.vy / d.speed) * KNOCK, 0.8, 'glaive_recall');
        d.pop = POP;
        game.particles.spawnDirectionalSparks(e.x, e.y, Math.atan2(d.vy, d.vx), 0.6, 5, GLAIVE_HUE + 30, 7);
        if (this.soundHits++ < SOUND_HITS_PER_TICK) game.sound.playGlaiveRicochet?.(3, 'enemy');
        if (d.recallLeft <= 0) break;
      }
    }
  }

  // ---- Rendering (additive, above the enemies). Animation runs on sim state, so it freezes with the sim. ----
  // Each disc is a neon ring with three swept blades round a bright hub, spinning, with a short fading
  // trail. Momentum Edge heats the colour toward white-gold with every hit; recalling discs run paler.
  draw(ctx, game) {
    if (this.count === 0) return;
    const x0 = game.camX - 40, y0 = game.camY - 40;
    const x1 = game.camX + game.width + 40, y1 = game.camY + game.height + 40;
    const r0 = W.glaiveRadius * DRAW_SCALE;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Trails, one batched stroke.
    ctx.lineWidth = 4;
    ctx.strokeStyle = `hsla(${GLAIVE_HUE}, 100%, 55%, 0.4)`;
    ctx.beginPath();
    for (const d of this.discs) {
      if (!d.active || d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1 || d.trail < 2) continue;
      ctx.moveTo(d.x, d.y);
      for (let k = 0; k < d.trail; k++) ctx.lineTo(d.tx[k], d.ty[k]);
    }
    ctx.stroke();
    for (const d of this.discs) {
      if (!d.active || d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      const alpha = d.fade > 0 ? Math.max(0, d.fade / FADE) : 1;
      // Juice: pops 35% bigger and white-hot on every bounce (ease-out), and scales in over its first 0.08 s.
      const pop = d.pop / POP;
      const kick = pop * pop;
      const grow = d.recall || d.life >= 0.08 ? 1 : 0.55 + 0.45 * (d.life / 0.08);
      const r = r0 * grow * (1 + 0.35 * kick);
      const heat = Math.min(1, d.hits / 8);
      const hue = d.recall ? GLAIVE_HUE + 22 : GLAIVE_HUE + heat * 24;
      const light = Math.min(92, 54 + heat * 22 + kick * 30);
      // Glow.
      ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${(0.22 + 0.25 * kick) * alpha})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      // Rim.
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `hsla(${hue}, 100%, ${light + 8}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      // Three swept blades.
      ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${alpha})`;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = d.spin + (k * Math.PI * 2) / 3;
        ctx.moveTo(d.x + Math.cos(a) * r * 0.5, d.y + Math.sin(a) * r * 0.5);
        ctx.lineTo(d.x + Math.cos(a + 0.55) * r * 1.25, d.y + Math.sin(a + 0.55) * r * 1.25);
        ctx.lineTo(d.x + Math.cos(a + 0.95) * r * 0.55, d.y + Math.sin(a + 0.95) * r * 0.55);
      }
      ctx.fill();
      // Hub.
      ctx.fillStyle = `rgba(255, 245, 225, ${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
