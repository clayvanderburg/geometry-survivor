// Corrosive Gas Trail: an autonomous slot weapon. The ship vents puffs of CORROSIVE gas from its tail as
// it flies; each puff swells in, lingers, then thins away. Every gas tick, each enemy inside ANY cloud
// takes one tick of damage (overlapping clouds never stack on one enemy) and a CORRODE stack (its element
// is fixed: weapon-levels.js FIXED_ELEMENTS, applied by status-effects.js like any infused weapon). It
// rewards kiting: lead a chasing pack through your own wake.
//
// Breakthroughs: Seeking Miasma (clouds creep toward the nearest enemy), Volatile Pockets (every
// W.pocketEvery s a pocket that swells, then bursts when an enemy comes close) and Toxic Shroud (a cloud
// that wraps the hull and follows the ship, ticking with the trail).
//
// Puffs and pockets live in fixed pools (nothing is allocated while venting or ticking) and are simulated
// only from Game.update, so pause, hit-stop and slow-mo freeze them with the rest of the world. A hovering
// ship keeps topping up its last puff instead of stacking new ones, so a parked ship holds one cloud.
// Drawing is a handful of batched paths (the clouds are one union fill), under the enemies.
// Every hit has source 'gas' (CORRODE, damage-number colour); run stats split out the pocket bursts and
// the shroud as 'gas_pocket' / 'gas_shroud' (run-stats.js SUB_SOURCES).
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, gasCloudRadius } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { isDeployableTarget } from './deployables.js';

export const GAS_HUE = 122;     // sickly neon green body; rims run teal, bubbles acid
const RIM_HUE = 166;
const BUBBLE_HUE = 92;
const MAX_PUFFS = 96;           // >= puffs alive at once: life / (spacing x radius / ship speed), oldest recycled past it
const MAX_POCKETS = 8;          // >= pockets alive at once (one every ~1.2 s, ~1.8 s fuse at most)
const SEEK_RETARGET = 0.3;      // s between a seeking cloud's target picks
const POCKET_KNOCK = 0.9;
const DRIFT = 14;               // px/s a fresh puff drifts back from the tail (fading)
const HISS_EVERY = 1.1;         // s between vent hisses while the trail grows

// Current radius of a puff: it swells in over W.gasGrow s and shrinks to a quarter over the last
// W.gasFade of its life. Damage reads the same radius the cloud is drawn at.
export function puffRadius(f) {
  const grow = Math.min(1, f.age / W.gasGrow);
  const left = Math.max(0, Math.min(1, (f.life - f.age) / (f.life * W.gasFade)));
  return f.radius * (0.6 + 0.4 * grow) * (0.25 + 0.75 * left);
}

export class GasTrail {
  constructor() {
    this.puffs = Array.from({ length: MAX_PUFFS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, radius: 0, r: 0, target: null, retarget: 0, seed: 0 }));
    this.pockets = Array.from({ length: MAX_POCKETS }, () => ({ x: 0, y: 0, age: 0, radius: 0, damage: 0, target: null, retarget: 0, seed: 0 }));
    this.clear();
  }

  // Run reset: every cloud and pocket gone.
  clear() {
    this.count = 0;
    this.pocketCount = 0;
    this.last = null;
    this.time = 0;
    this.tickT = 0;
    this.tickEvery = 0.3;
    this.pocketT = 0;
    this.hissT = 0;
    this.damage = 0;
    this.radius = 0;
    this.life = 0;
    this.seek = false;
    this.shroudR = 0;
    this.shroudDamage = 0;
    this.shipX = 0;
    this.shipY = 0;
    this.puffsDropped = 0;
    this.pocketsBurst = 0;
    for (const f of this.puffs) f.target = null;
    for (const k of this.pockets) k.target = null;
  }

  get activeCount() {
    return this.count + this.pocketCount;
  }

  update(dt, game) {
    const p = game.player;
    const owned = (p.weapons.gas || 0) > 0;
    if (!owned) {
      this.shroudR = 0;
      if (this.count === 0 && this.pocketCount === 0) return;
    }
    this.time += dt;
    this.hissT -= dt;
    if (owned) {
      const b = weaponBuild(p, 'gas');
      this.radius = gasCloudRadius(p, b);
      this.life = W.gasLife(b);
      this.tickEvery = W.gasTick(b);
      this.damage = weaponDamage(p, 'gas', b);
      this.seek = b.t4;
      this.shroudR = b.t12 ? this.radius * W.shroudRadiusMult : 0;
      this.shroudDamage = this.damage * W.shroudShare;
      this.shipX = p.x;
      this.shipY = p.y;
      this.vent(game, p);
      if (b.t8) {
        this.pocketT -= dt;
        if (this.pocketT <= 0) {
          this.pocketT += W.pocketEvery;
          this.dropPocket(game, p, b);
        }
      }
    }
    this.updatePuffs(dt, game);
    this.updatePockets(dt, game);
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = Math.max(0, this.tickT + this.tickEvery);
      this.tick(game);
    }
  }

  // Where the gas leaves the hull: behind the ship's motion (behind its heading when parked).
  tail(p, out) {
    const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.5;
    const back = moving ? Math.atan2(-p.vy, -p.vx) : (p.hullAngle ?? p.angle ?? 0) + Math.PI;
    const off = (p.radius || 15) + this.radius * 0.45;
    out.x = p.x + Math.cos(back) * off;
    out.y = p.y + Math.sin(back) * off;
    out.a = back;
    return out;
  }

  // A new puff once the tail has moved W.gasPuffSpacing cloud radii from the last one; a hovering
  // ship tops its last puff up (back to full size, current numbers) instead.
  vent(game, p) {
    const t = this.tail(p, this._tail || (this._tail = { x: 0, y: 0, a: 0 }));
    const last = this.last;
    if (last && last.age < last.life && Math.hypot(t.x - last.x, t.y - last.y) < this.radius * W.gasPuffSpacing) {
      last.age = Math.min(last.age, W.gasGrow);
      last.life = this.life;
      last.radius = this.radius;
      return;
    }
    const f = this.addPuff(t.x, t.y, this.radius, this.life);
    f.vx = Math.cos(t.a) * DRIFT;
    f.vy = Math.sin(t.a) * DRIFT;
    this.last = f;
    this.puffsDropped++;
    if (this.hissT <= 0) {
      this.hissT = HISS_EVERY;
      game.sound.playGasVent?.();
    }
  }

  // A puff from the pool (the oldest one is recycled when it is full).
  addPuff(x, y, radius, life) {
    let f;
    if (this.count < MAX_PUFFS) f = this.puffs[this.count++];
    else {
      f = this.puffs[0];
      for (let i = 1; i < this.count; i++) if (this.puffs[i].age / this.puffs[i].life > f.age / f.life) f = this.puffs[i];
    }
    f.x = x;
    f.y = y;
    f.vx = 0;
    f.vy = 0;
    f.age = 0;
    f.life = life;
    f.radius = radius;
    f.r = radius * 0.6;
    f.target = null;
    f.retarget = Math.random() * SEEK_RETARGET;
    f.seed = Math.random();
    return f;
  }

  updatePuffs(dt, game) {
    const decay = Math.max(0, 1 - 1.6 * dt);
    for (let i = this.count - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      if (f.age >= f.life) {
        // Swap-remove keeps live puffs packed; `f` keeps its data until the slot is reused.
        if (this.last === f) this.last = null;
        f.target = null;
        this.puffs[i] = this.puffs[this.count - 1];
        this.puffs[--this.count] = f;
        continue;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= decay;
      f.vy *= decay;
      if (this.seek) this.creep(f, game, dt, W.seekSpeed, f.radius * 0.25);
      f.r = puffRadius(f);
    }
  }

  // Seeking Miasma: drift toward the nearest enemy within W.seekRange (re-picked every SEEK_RETARGET s),
  // settling once it is `near` px away so a cloud parks on its target instead of jittering through it.
  creep(o, game, dt, speed, near) {
    o.retarget -= dt;
    if (o.retarget <= 0 || !o.target || o.target.dead) {
      o.retarget = SEEK_RETARGET;
      o.target = this.nearest(game, o.x, o.y, W.seekRange);
    }
    const e = o.target;
    if (!e || e.dead) return;
    const dx = e.x - o.x;
    const dy = e.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d <= near) return;
    const step = Math.min(d - near, speed * dt);
    o.x += (dx / d) * step;
    o.y += (dy / d) * step;
  }

  nearest(game, x, y, range) {
    const enemies = game.enemyManager.enemies;
    let best = null;
    let bestSq = range * range;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!isDeployableTarget(e)) continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq < bestSq) { bestSq = dSq; best = e; }
    }
    return best;
  }

  // One gas tick: every enemy inside any cloud takes this.damage (and a CORRODE stack, through
  // hitEnemy); with Toxic Shroud, every enemy in the shroud also takes this.shroudDamage.
  tick(game) {
    const enemies = game.enemyManager.enemies;
    if (enemies.length === 0 || (this.count === 0 && this.shroudR <= 0)) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const f = this.puffs[i];
      if (f.x - f.r < minX) minX = f.x - f.r;
      if (f.x + f.r > maxX) maxX = f.x + f.r;
      if (f.y - f.r < minY) minY = f.y - f.r;
      if (f.y + f.r > maxY) maxY = f.y + f.r;
    }
    const sx = this.shipX, sy = this.shipY, sr = this.shroudR;
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (i >= enemies.length) continue; // a kill this tick shifted the list
      const e = enemies[i];
      if (e.dead) continue;
      const er = (e.radius || 10) * 0.6;
      if (e.x + er >= minX && e.x - er <= maxX && e.y + er >= minY && e.y - er <= maxY) {
        for (let k = 0; k < this.count; k++) {
          const f = this.puffs[k];
          const r = f.r + er;
          const dx = e.x - f.x;
          const dy = e.y - f.y;
          if (dx * dx + dy * dy <= r * r) {
            game.hitEnemy(e, this.damage, 'gas', 0, 0, 0.22);
            break;
          }
        }
      }
      if (sr > 0 && !e.dead) {
        const r = sr + er;
        if ((e.x - sx) ** 2 + (e.y - sy) ** 2 <= r * r) game.hitEnemy(e, this.shroudDamage, 'gas', 0, 0, 0.22, 'gas_shroud');
      }
    }
  }

  // Volatile Pockets: a pocket dropped at the tail, worth W.pocketShare of the gas DPS over W.pocketEvery.
  dropPocket(game, p, b) {
    if (this.pocketCount >= MAX_POCKETS) return;
    const t = this.tail(p, this._tail || (this._tail = { x: 0, y: 0, a: 0 }));
    const k = this.pockets[this.pocketCount++];
    k.x = t.x;
    k.y = t.y;
    k.age = 0;
    k.radius = this.radius * W.pocketRadiusMult;
    k.damage = weaponDamage(p, 'gas', b) * W.pocketShare * W.pocketEvery / W.gasTick(b);
    k.target = null;
    k.retarget = 0;
    k.seed = Math.random();
  }

  updatePockets(dt, game) {
    const enemies = game.enemyManager.enemies;
    for (let i = this.pocketCount - 1; i >= 0; i--) {
      const k = this.pockets[i];
      k.age += dt;
      if (this.seek) this.creep(k, game, dt, W.seekSpeed * 1.2, 0);
      let burst = k.age >= W.pocketFuse;
      if (!burst && k.age >= W.pocketArm) {
        const trigger = k.radius * W.pocketTriggerFrac;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (!isDeployableTarget(e)) continue;
          const r = trigger + e.radius;
          if ((e.x - k.x) ** 2 + (e.y - k.y) ** 2 <= r * r) { burst = true; break; }
        }
      }
      if (!burst) continue;
      k.target = null;
      this.pockets[i] = this.pockets[this.pocketCount - 1];
      this.pockets[--this.pocketCount] = k;
      this.burst(game, k);
    }
  }

  burst(game, k) {
    const fx = game.particles;
    fx.spawnFlash?.(k.x, k.y, k.radius * 0.45, BUBBLE_HUE, 0.16);
    fx.spawnShockwave?.(k.x, k.y, k.radius, GAS_HUE, 3, 0.35);
    fx.spawnShockwave?.(k.x, k.y, k.radius * 0.45, RIM_HUE, 2, 0.22);
    fx.spawnExplosionSparks?.(k.x, k.y, 12, BUBBLE_HUE, 1.6, 8, 1.8);
    game.sound.playGasBurst?.();
    this.pocketsBurst++;
    game.damageEnemiesInRadius(k.x, k.y, k.radius, k.damage, GAS_HUE, 'gas', POCKET_KNOCK, TUNING.splashEdgeFalloff ?? 0.4, 'gas_pocket');
    // The burst spills a fresh cloud where it went off (more ground covered, no extra damage stacking).
    if (this.radius > 0 && this.life > 0) this.addPuff(k.x, k.y, this.radius * 1.15, this.life * 0.6);
  }

  // ---- Rendering (world space, under the enemies). Animation runs on this.time, so it freezes with the sim. ----
  inView(game, x, y, pad) {
    return x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
  }

  // Clouds: one union fill for the body and one for the denser cores (overlaps never pile up into an
  // opaque blob that hides enemies), turning teal wisps and rising acid bubbles; pockets as swelling
  // bubbles with a pulsing rim. Four to six batched paths a frame however many puffs are out.
  drawGround(ctx, game) {
    const shroud = this.shroudR > 0 && (game.player?.weapons?.gas || 0) > 0 && game.state !== 'GAMEOVER'; // no ship, no shroud
    if (this.count === 0 && this.pocketCount === 0 && !shroud) return;
    const vfx = TUNING.vfxIntensity ?? 1;
    const t = this.time;
    const a = (v) => Math.min(1, v * vfx);
    const sx = game.player?.x ?? this.shipX;
    const sy = game.player?.y ?? this.shipY;
    const sr = shroud ? this.shroudR * (0.97 + 0.03 * Math.sin(t * 2.4)) : 0;
    ctx.save();

    // Body and cores.
    for (let pass = 0; pass < 2; pass++) {
      const scale = pass === 0 ? 1 : 0.55;
      ctx.fillStyle = pass === 0 ? `hsla(${GAS_HUE}, 100%, 46%, ${a(0.11)})` : `hsla(${GAS_HUE + 18}, 100%, 56%, ${a(0.07)})`;
      ctx.beginPath();
      for (let i = 0; i < this.count; i++) {
        const f = this.puffs[i];
        if (!this.inView(game, f.x, f.y, f.r)) continue;
        const r = f.r * scale;
        ctx.moveTo(f.x + r, f.y);
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      }
      if (sr > 0) {
        ctx.moveTo(sx + sr * scale, sy);
        ctx.arc(sx, sy, sr * scale, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Wisps: a turning arc on each cloud, three round the shroud.
    ctx.strokeStyle = `hsla(${RIM_HUE}, 100%, 62%, ${a(0.36)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const f = this.puffs[i];
      if (!this.inView(game, f.x, f.y, f.r)) continue;
      const q = f.seed * 6.283 + t * (f.seed > 0.5 ? 0.9 : -0.9);
      const r = f.r * 0.82;
      ctx.moveTo(f.x + Math.cos(q) * r, f.y + Math.sin(q) * r);
      ctx.arc(f.x, f.y, r, q, q + 1.3);
    }
    if (sr > 0) {
      for (let s = 0; s < 3; s++) {
        const q = t * 0.7 + (s * Math.PI * 2) / 3;
        ctx.moveTo(sx + Math.cos(q) * sr * 0.92, sy + Math.sin(q) * sr * 0.92);
        ctx.arc(sx, sy, sr * 0.92, q, q + 1.1);
      }
    }
    ctx.stroke();

    // Bubbles: rise from a fixed spot in half the clouds, swell, pop and start over.
    ctx.strokeStyle = `hsla(${BUBBLE_HUE}, 100%, 66%, ${a(0.45)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const f = this.puffs[i];
      if (f.seed > 0.5 || !this.inView(game, f.x, f.y, f.r)) continue;
      const ph = (t * 0.8 + f.seed * 7) % 1;
      const q = f.seed * 40;
      const bx = f.x + Math.cos(q) * f.r * 0.45;
      const by = f.y + Math.sin(q) * f.r * 0.4 - ph * f.r * 0.3;
      const br = 1.5 + 3 * ph;
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.stroke();

    // Volatile pockets: a swelling bubble, a rim that pulses faster as the fuse runs out, and the
    // blast ring once armed.
    for (let i = 0; i < this.pocketCount; i++) {
      const k = this.pockets[i];
      if (!this.inView(game, k.x, k.y, k.radius)) continue;
      const fuse = Math.min(1, k.age / W.pocketFuse);
      const armed = k.age >= W.pocketArm;
      const pulse = 0.5 + 0.5 * Math.sin(k.age * (8 + 20 * fuse) + k.seed * 6);
      const r = 9 + 9 * Math.min(1, k.age / W.pocketArm) + 3 * pulse;
      ctx.fillStyle = `hsla(${BUBBLE_HUE}, 100%, 55%, ${a(0.22 + 0.15 * pulse)})`;
      ctx.beginPath();
      ctx.arc(k.x, k.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${BUBBLE_HUE}, 100%, 72%, ${a(0.7 + 0.3 * pulse)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (armed) {
        ctx.strokeStyle = `hsla(${GAS_HUE}, 100%, 60%, ${a(0.12 + 0.2 * fuse)})`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(k.x, k.y, k.radius * W.pocketTriggerFrac, t * 1.5, t * 1.5 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
}
