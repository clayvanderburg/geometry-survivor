// Flamethrower: a PRIMARY slot weapon. A nozzle spins slowly round the ship (it never aims and sprays the
// whole time it is equipped) and sprays a short cone of fire. Every scorch
// (W.flameTickRate per second) hits everything inside the cone, near hits full and the tip at
// 1 - W.flameEdgeFalloff, with source 'flame': status-effects.js sets it on FIRE at the weapon's built-in
// rank (weapon-levels.js FIXED_ELEMENTS / fixedElementRank), so the STATUS cards and Fire Amplifier work
// on it like on any FIRE weapon.
//
// ASTEROIDS ARE COVER. Each nozzle casts RAYS rays across its cone and every ray stops at the first rock
// face, so a rock shadows only the slice of the cone behind it (enemies there are safe) and the rest of
// the cone burns on. The flames are drawn clipped the same way, so what you see is what burns.
//
// Extra Nozzle cards add identical streams (up to MAX_NOZZLES), spaced evenly round the spin.
//
// Breakthroughs: the LV 6 burst (Fireballs: every W.flameBurstEvery s each nozzle lobs a fireball that
// bursts at the tip of its flames), Napalm Puddles (burning puddles splash down at the flames' tip,
// weapon-fx.js pools) and Inferno Ring (every few seconds a ring of fire rolls out all round the ship and
// shoves enemies back).
//
// The same engine drives the Cryo Sprayer (FROST: Shatter, frost slicks, Blizzard Ring) and the Acid
// Sprayer (CORROSIVE: Meltdown, acid pools, Caustic Ring): `new Flamethrower(kind)` with a SPRAY_KINDS
// key. They share the Flamethrower's numbers (W.flame* formulas read only the build's ranks); only the
// weapon, damage source, LV 6 burst trigger, colours, puddle look and sound differ. Shatter bursts a
// FROZEN enemy the spray hits in ice shards, Meltdown a corroded enemy the spray kills in acid; both at
// most once every W.flameBurstEvery / nozzles s. Bursts are run-stats sub-sources (fireball / shatter /
// meltdown).
//
// Flame puffs live in a fixed pool (nothing is allocated while spraying) and are drawn in three batched
// fills (hot core, flame, smoke-red tail), so a long spray over a 200-enemy swarm stays cheap. Everything
// is simulated from Game.update only, so pause, hit-stop and slow-mo freeze it with the world.
import { WEAPON_SCALING as W, weaponDamage, flameRange, areaMult } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import * as BTX from './bt-extras.js'; // pool Breakthroughs: the whirl and the pack-seeking nozzle

export const FLAME_RAYS = 9;      // rays across one nozzle's cone, each clipped at the first rock
const MAX_PUFFS = 240;
import { setMountSpray } from './hardpoints.js';
const PUFF_LIFE = 0.32;           // s a flame puff lives (it travels the nozzle's reach in that time)
const PUFFS_PER_TICK = 3;         // per nozzle per 60 Hz tick
export const MAX_NOZZLES = 4;     // 1 + Extra Nozzle cards (cap 3)
const ROCK_LICK = 6;              // px the flames lick into a rock face

// Per-weapon look and identity. phase: starting heading offset. bands: [age from, age to, puff colour, growth] for the three batched fills.
export const SPRAY_KINDS = {
  flamethrower: {
    weapon: 'flamethrower', source: 'flame', burst: 'fireball', phase: 0, hue: 28, ringHue2: 46, puddleHue: 22, puddleLook: 'fire', sound: 'flame',
    wedge: [255, 120, 30], glow: [255, 210, 110],
    bands: [[0, 0.22, 'rgba(255, 244, 200, 0.5)', 0.7], [0.22, 0.6, 'rgba(255, 168, 46, 0.3)', 1], [0.6, 1.01, 'rgba(255, 78, 24, 0.17)', 1.25]]
  },
  cryospray: {
    weapon: 'cryospray', source: 'cryo', burst: 'shatter', phase: (Math.PI * 2) / 3, hue: 192, ringHue2: 205, puddleHue: 192, puddleLook: 'frost', sound: 'cryo',
    wedge: [120, 220, 255], glow: [215, 248, 255],
    bands: [[0, 0.22, 'rgba(240, 253, 255, 0.5)', 0.7], [0.22, 0.6, 'rgba(140, 224, 255, 0.3)', 1], [0.6, 1.01, 'rgba(96, 156, 255, 0.17)', 1.25]]
  },
  acidspray: {
    weapon: 'acidspray', source: 'acid', burst: 'meltdown', phase: (Math.PI * 4) / 3, hue: 100, ringHue2: 80, puddleHue: 100, puddleLook: 'corrode', sound: 'acid',
    wedge: [130, 255, 60], glow: [210, 255, 150],
    bands: [[0, 0.22, 'rgba(236, 255, 196, 0.5)', 0.7], [0.22, 0.6, 'rgba(150, 255, 60, 0.3)', 1], [0.6, 1.01, 'rgba(70, 176, 30, 0.17)', 1.25]]
  }
};

const wrap = (a) => ((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;

export class Flamethrower {
  constructor(kind = 'flamethrower') {
    this.kind = SPRAY_KINDS[kind];
    this.puffs = Array.from({ length: MAX_PUFFS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, maxAge: 1, size: 1 }));
    // Up to MAX_NOZZLES nozzles: origin, aim, half-angle, reach and the clipped reach per ray.
    this.nozzles = Array.from({ length: MAX_NOZZLES }, () => ({ on: false, x: 0, y: 0, angle: 0, half: 0, range: 0, reach: new Float64Array(FLAME_RAYS) }));
    this.clear();
  }

  // Run reset: no flames, timers rewound.
  clear() {
    this.count = 0;
    this.tickAcc = 0.6;
    this.puddleT = 0.25;
    this.ringT = 1.2;
    this.burstT = 0.5; // Fireballs: time to the next volley; Shatter / Meltdown: cooldown before the next burst
    this.bursts = 0;
    this.pendingBursts = [];
    this.firing = false;
    this.heat = 0;
    this.time = 0;
    this.scorches = 0;
    this.rings = 0;
    this.swivel = null; // the spinning nozzle's heading (radians); null until the weapon is first owned
    for (const n of this.nozzles) n.on = false;
  }

  get activeCount() {
    return this.count;
  }

  // `wantFire`: the player is firing this tick (Game.update's shouldFire).
  update(dt, game, wantFire) {
    const p = game.player;
    const k = this.kind;
    const owned = (p.weapons[k.weapon] || 0) > 0;
    if (owned) this.swing(p, weaponBuild(p, k.weapon), dt, game);
    // No aiming at all: the nozzle spins round the ship and sprays the whole time it's equipped.
    const firing = owned;
    if (!firing && this.count === 0 && this.heat === 0) {
      if (this.firing) this.silence(game);
      return;
    }
    this.time += dt;
    if (firing !== this.firing) {
      this.firing = firing;
      game.sound.setFlameRoar?.(firing ? 1 : 0, k.sound);
      if (firing) this.tickAcc = Math.max(this.tickAcc, 0.6); // the first scorch lands almost at once
    }
    this.heat = firing ? Math.min(1, this.heat + dt * 10) : Math.max(0, this.heat - dt * 6);
    if (firing) {
      const b = weaponBuild(p, k.weapon);
      this.aim(game, p, b);
      this.tickAcc += dt * W.flameTickRate(b);
      if (this.tickAcc >= 1) {
        const n = Math.floor(this.tickAcc);
        this.tickAcc -= n;
        this.scorch(game, p, b, n);
      }
      if (b.t4) {
        this.burstT -= dt;
        if (k.burst === 'fireball' && this.burstT <= 0) {
          this.burstT += W.flameBurstEvery;
          this.fireballs(game, p, b);
        }
      }
      if (b.t8) {
        this.puddleT -= dt;
        if (this.puddleT <= 0) {
          this.puddleT += W.flamePuddleEvery;
          this.puddle(game, p, b);
        }
      }
      if (b.t12) {
        this.ringT -= dt;
        if (this.ringT <= 0) {
          this.ringT += W.flameRingEvery;
          this.ring(game, p, b);
        }
      }
      for (const nz of this.nozzles) if (nz.on) this.spray(nz, p);
      setMountSpray(p, k.weapon, this.swivel, Math.min(MAX_NOZZLES, W.flameNozzles(b)), true); // rim nozzle heads (hardpoints.js)
    } else {
      for (const nz of this.nozzles) nz.on = false;
    }
    // Puffs fly straight on and die at the end of their (clipped) reach.
    for (let i = this.count - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.age >= f.maxAge) {
        this.puffs[i] = this.puffs[this.count - 1];
        this.puffs[--this.count] = f;
      }
    }
  }

  // Quiet the roar (the game left PLAYING, or the weapon was discarded mid-spray).
  silence(game) {
    this.firing = false;
    for (const nz of this.nozzles) nz.on = false;
    game.sound?.setFlameRoar?.(0, this.kind.sound);
  }

  // The nozzle ignores the aim: it turns steadily round the ship (clockwise) at flameTurnRate. Each kind
  // starts a third of a turn apart (`phase`), so two or three sprayers fan out instead of stacking.
  swing(p, b, dt, game = null) {
    if (this.swivel === null) this.swivel = p.angle + (this.kind.phase || 0);
    // Pool Breakthroughs (bt-extras.js) may whirl the nozzle or steer it at the pack.
    this.swivel = wrap(this.swivel + (game ? BTX.sprayTurn(this, game, p, b, dt, flameRange(p, b)) : W.flameTurnRate(b) * dt));
  }

  // Place the nozzles on the turret and clip each ray of their cones at the first rock face.
  aim(game, p, b) {
    const range = flameRange(p, b);
    const half = W.flameConeHalf(b);
    const rocks = game.asteroidManager?.getNearbyAsteroids?.(p.x, p.y, game.asteroidManager.cellsFor?.(range + 20) ?? Math.ceil(range / 140) + 1) || [];
    const count = Math.min(MAX_NOZZLES, W.flameNozzles(b));
    for (let k = 0; k < this.nozzles.length; k++) {
      const nz = this.nozzles[k];
      nz.on = k < count;
      if (!nz.on) continue;
      nz.angle = (this.swivel ?? p.angle) + (k * Math.PI * 2) / count;
      nz.half = half;
      nz.range = range;
      const muzzle = (p.radius || 15) * 0.95;
      nz.x = p.x + Math.cos(nz.angle) * muzzle;
      nz.y = p.y + Math.sin(nz.angle) * muzzle;
      clipRays(nz, rocks);
    }
  }

  // Clipped reach of a nozzle at `off` radians from its aim (linear between the two nearest rays).
  reachAt(nz, off) {
    const u = Math.max(0, Math.min(FLAME_RAYS - 1, ((off + nz.half) / (2 * nz.half)) * (FLAME_RAYS - 1)));
    const i = Math.min(FLAME_RAYS - 2, Math.floor(u));
    const t = u - i;
    return nz.reach[i] * (1 - t) + nz.reach[i + 1] * t;
  }

  // Share of a scorch an enemy takes from this nozzle: 0 outside the cone or in a rock's shadow, else
  // full at the muzzle fading to 1 - flameEdgeFalloff at the tip.
  coverage(nz, e) {
    const dx = e.x - nz.x;
    const dy = e.y - nz.y;
    const r = e.radius || 10;
    const dSq = dx * dx + dy * dy;
    const far = nz.range + r;
    if (dSq > far * far) return 0;
    const d = Math.sqrt(dSq) || 1;
    if (d > r) {
      const off = wrap(Math.atan2(dy, dx) - nz.angle);
      if (Math.abs(off) > nz.half + Math.asin(Math.min(1, r / d))) return 0;
      if (d - r > this.reachAt(nz, Math.max(-nz.half, Math.min(nz.half, off)))) return 0;
    }
    return 1 - W.flameEdgeFalloff * Math.max(0, Math.min(1, (d - r) / nz.range));
  }

  // One or more scorches: everything in a cone takes the hit once (the best nozzle's share). With the
  // LV 6 Breakthrough, Shatter (a FROZEN enemy hit) or Meltdown (a corroded enemy killed) bursts it,
  // once the burst cooldown is ready; bursts go off after the sweep so no kill shifts the list mid-loop.
  scorch(game, p, b, n) {
    const k = this.kind;
    const source = k.source;
    const damage = weaponDamage(p, source, b) * n;
    const enemies = game.enemyManager.enemies;
    const trigger = b.t4 && k.burst !== 'fireball' ? k.burst : null;
    const pending = this.pendingBursts;
    pending.length = 0;
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (i >= enemies.length) continue;
      const e = enemies[i];
      if (e.dead || e.invulnerable) continue;
      let share = 0;
      for (let j = 0; j < this.nozzles.length; j++) {
        const nz = this.nozzles[j];
        if (nz.on) share = Math.max(share, this.coverage(nz, e));
      }
      if (share <= 0) continue;
      const frozen = trigger === 'shatter' && e.st?.frozenT > 0;
      const corroded = trigger === 'meltdown' && e.st?.corrode > 0;
      game.hitEnemy(e, damage * share, source, 0, 0, 0.3);
      if (this.burstT <= 0 && (frozen || (corroded && (e.dead || e.hp <= 0)))) {
        pending.push(e.x, e.y);
        this.burstT = W.flameBurstEvery / Math.max(1, W.flameNozzles(b));
      }
    }
    for (let j = 0; j < pending.length; j += 2) this.burst(game, p, b, pending[j], pending[j + 1], 0);
    this.scorches += n;
  }

  // Fireballs: every nozzle lobs a fireball to the tip of its (clipped) stream, bursting a moment later.
  fireballs(game, p, b) {
    for (const nz of this.nozzles) {
      if (!nz.on) continue;
      const reach = this.reachAt(nz, 0) * 0.9;
      this.burst(game, p, b, nz.x + Math.cos(nz.angle) * reach, nz.y + Math.sin(nz.angle) * reach, W.flameBurstFlight, nz.x, nz.y);
    }
  }

  // One LV 6 burst at (x, y): a blast through the shared damage path (so it applies the sprayer's
  // element), after `delay` s when lobbed from (fromX, fromY), at once otherwise.
  burst(game, p, b, x, y, delay = 0, fromX = x, fromY = y) {
    const k = this.kind;
    const radius = W.flameBurstRadius * areaMult(p);
    const damage = weaponDamage(p, k.source, b) / W.flameDamageMult(b) * W.flameBurstDamageMult(b);
    if (delay > 0 && game.weaponFx?.schedule) {
      game.weaponFx.schedule({ x, y, fromX, fromY, delay, radius, damage, hue: k.hue, source: k.source, style: k.burst === 'fireball' ? 'fireball' : 'pop', kind: k.burst, knock: 1, size: 7 });
    } else {
      game.particles?.spawnShockwave?.(x, y, radius, k.hue, 4, 0.3);
      game.particles?.spawnExplosionSparks?.(x, y, 12, k.hue, 1, 4, 3);
      game.damageEnemiesInRadius(x, y, radius, damage, k.hue, k.source, 1, undefined, k.burst);
    }
    game.sound?.playFlameBurst?.(k.sound);
    this.bursts++;
  }

  // Napalm Puddles: a burning puddle splashes down near the tip of the front flames.
  puddle(game, p, b) {
    const nz = this.nozzles[0];
    const off = (Math.random() - 0.5) * nz.half * 1.2;
    const reach = this.reachAt(nz, off) * (0.7 + Math.random() * 0.25);
    const x = nz.x + Math.cos(nz.angle + off) * reach;
    const y = nz.y + Math.sin(nz.angle + off) * reach;
    const k = this.kind;
    const damage = weaponDamage(p, k.source, b) / W.flameDamageMult(b) * W.flamePuddleDamageMult(b);
    game.weaponFx?.addPool({ x, y, radius: W.flamePuddleRadius * areaMult(p), life: W.flamePuddleLife, tick: W.flamePuddleTick,
      damage, hue: k.puddleHue, source: k.source, look: k.puddleLook });
  }

  // Inferno Ring: a ring of fire rolls out round the ship, scorching and shoving everything it passes.
  ring(game, p, b) {
    const radius = flameRange(p, b) * W.flameRingRadiusMult;
    const k = this.kind;
    const damage = weaponDamage(p, k.source, b) / W.flameDamageMult(b) * W.flameRingDamageMult(b);
    const fx = game.particles;
    fx.spawnShockwave(p.x, p.y, radius, k.hue, 6, 0.42);
    fx.spawnShockwave(p.x, p.y, radius * 0.7, k.ringHue2, 3, 0.32);
    fx.spawnFlash?.(p.x, p.y, 34, k.hue, 0.16);
    // A ring of puffs racing outward with the shockwave.
    const n = 30;
    for (let k = 0; k < n && this.count < MAX_PUFFS; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.15;
      const f = this.puffs[this.count++];
      const speed = radius / 0.42;
      f.x = p.x + Math.cos(a) * 18;
      f.y = p.y + Math.sin(a) * 18;
      f.vx = Math.cos(a) * speed;
      f.vy = Math.sin(a) * speed;
      f.age = 0;
      f.life = f.maxAge = 0.4;
      f.size = 5;
    }
    game.damageEnemiesInRadius(p.x, p.y, radius, damage, k.hue, k.source, W.flameRingKnock);
    game.sound.playFlameBurst?.(k.sound);
    this.rings++;
  }

  // New puffs for one nozzle this tick: spread across the cone (denser in the middle), each dying at
  // its ray's clipped reach so the flames stop at rock faces.
  spray(nz, p) {
    for (let k = 0; k < PUFFS_PER_TICK && this.count < MAX_PUFFS; k++) {
      const off = (Math.random() + Math.random() - 1) * nz.half * 0.95;
      const a = nz.angle + off;
      const speed = (nz.range / PUFF_LIFE) * (0.85 + Math.random() * 0.25);
      const reach = this.reachAt(nz, off);
      const f = this.puffs[this.count++];
      f.x = nz.x;
      f.y = nz.y;
      f.vx = Math.cos(a) * speed + (p.vx || 0) * 30; // carry some of the ship's drift (px/tick -> px/s, halved)
      f.vy = Math.sin(a) * speed + (p.vy || 0) * 30;
      f.age = 0;
      f.life = PUFF_LIFE;
      f.maxAge = Math.min(PUFF_LIFE, (reach + ROCK_LICK) / speed);
      f.size = 2.5 + nz.half * 6;
    }
  }

  // ---- Rendering (additive layer, world space, over the enemies). ----
  draw(ctx, game) {
    if (this.count === 0 && this.heat === 0) return;
    const camX = game.camX, camY = game.camY, w = game.width, h = game.height;
    const k = this.kind;
    // Faint wedge of each live nozzle along its clipped rays: the exact area that burns.
    if (this.heat > 0) {
      ctx.fillStyle = `rgba(${k.wedge.join(', ')}, ${0.07 * this.heat})`;
      ctx.beginPath();
      for (const nz of this.nozzles) {
        if (!nz.on) continue;
        ctx.moveTo(nz.x, nz.y);
        for (let k = 0; k < FLAME_RAYS; k++) {
          const a = nz.angle - nz.half + (2 * nz.half * k) / (FLAME_RAYS - 1);
          ctx.lineTo(nz.x + Math.cos(a) * nz.reach[k], nz.y + Math.sin(a) * nz.reach[k]);
        }
        ctx.closePath();
      }
      ctx.fill();
    }
    // Three bands by age: a hot core near the nozzle, the body of the spray, a tail that fades out.
    for (const [lo, hi, color, grow] of k.bands) {
      ctx.fillStyle = color;
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < this.count; i++) {
        const f = this.puffs[i];
        const t = f.age / f.life;
        if (t < lo || t >= hi) continue;
        if (f.x < camX - 40 || f.y < camY - 40 || f.x > camX + w + 40 || f.y > camY + h + 40) continue;
        const r = (f.size + t * 16) * grow;
        ctx.moveTo(f.x + r, f.y);
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        any = true;
      }
      if (any) ctx.fill();
    }
    // Nozzle glow.
    if (this.heat > 0) {
      ctx.fillStyle = `rgba(${k.glow.join(', ')}, ${0.55 * this.heat})`;
      ctx.beginPath();
      for (const nz of this.nozzles) {
        if (!nz.on) continue;
        const r = 5 + Math.sin(this.time * 47) * 1.2;
        ctx.moveTo(nz.x + r, nz.y);
        ctx.arc(nz.x, nz.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}

// Clip each ray of a nozzle's cone at the first rock it meets (ray / circle, flames licking ROCK_LICK px
// into the face). Rocks the nozzle sits inside (the claws are drilling) don't block.
export function clipRays(nz, rocks) {
  for (let k = 0; k < FLAME_RAYS; k++) nz.reach[k] = nz.range;
  for (let j = 0; j < rocks.length; j++) {
    const r = rocks[j];
    if (!(r.hp > 0)) continue;
    const cx = r.x - nz.x;
    const cy = r.y - nz.y;
    const rr = r.radius;
    const cSq = cx * cx + cy * cy;
    if (cSq > (nz.range + rr) ** 2 || cSq <= rr * rr) continue;
    const c = Math.sqrt(cSq);
    // Skip rocks well outside the cone.
    if (Math.abs(wrap(Math.atan2(cy, cx) - nz.angle)) > nz.half + Math.asin(Math.min(1, rr / c)) + 0.05) continue;
    for (let k = 0; k < FLAME_RAYS; k++) {
      const a = nz.angle - nz.half + (2 * nz.half * k) / (FLAME_RAYS - 1);
      const dx = Math.cos(a), dy = Math.sin(a);
      const proj = cx * dx + cy * dy;
      if (proj <= 0) continue;
      const perpSq = cSq - proj * proj;
      if (perpSq >= rr * rr) continue;
      const hit = proj - Math.sqrt(rr * rr - perpSq) + ROCK_LICK;
      if (hit < nz.reach[k]) nz.reach[k] = Math.max(0, hit);
    }
  }
}
