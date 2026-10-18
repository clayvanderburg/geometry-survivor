// Breakthrough weapon effects that outlive the shot that made them: timed blasts (cluster bomblets,
// tandem warheads, strikes from above, tactical nukes, aftershock implosions, mortar shells, orbit-blade
// novas, thunderstrikes), napalm pools and ball-lightning orbs. Damage goes through the game's own
// damageEnemiesInRadius / hitEnemy, so crits, statuses, damage numbers and kills work as for any hit.
//
// Everything lives in capped arrays simulated only from Game.update (pause, hit-stop and slow-mo
// freeze it), and is drawn in world space with TUNING.vfxIntensity; particles keep vfxLinger.
import { TUNING } from './config.js';

const MAX_EVENTS = 180;
const MAX_POOLS = 48;
const MAX_ORBS = 16;

// Per-style look of a timed blast: does it show a target reticle while pending, how big is the burst.
const STYLE = {
  pop: { reticle: false },
  tandem: { reticle: false },
  strike: { reticle: true },
  nuke: { reticle: true },
  thunder: { reticle: false },
  mortar: { reticle: true },
  implode: { reticle: false },
  nova: { reticle: false }
};

export class WeaponEffects {
  constructor() {
    this.clear();
  }

  clear() {
    this.events = [];
    this.pools = [];
    this.orbs = [];
    this.time = 0;
  }

  get activeCount() {
    return this.events.length + this.pools.length + this.orbs.length;
  }

  // A blast landing after `delay` s at (x, y): { x, y, delay, radius, damage, hue, source, style,
  // knock?, falloff?, cluster?: { count, share, radiusFrac, delay } } (cluster = bomblets on landing).
  schedule(e) {
    if (this.events.length >= MAX_EVENTS) return false;
    this.events.push({ knock: 1.2, falloff: TUNING.splashEdgeFalloff ?? 0.4, ...e, t: e.delay, maxT: Math.max(1e-6, e.delay) });
    return true;
  }

  // Scatter `count` bomblets around (x, y), each a small pop worth damage after `delay` s.
  scatter(x, y, count, spread, radius, damage, delay, hue, source) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const d = spread * (0.45 + Math.random() * 0.55);
      this.schedule({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, fromX: x, fromY: y, delay: delay * (0.85 + Math.random() * 0.3), radius, damage, hue, source, style: 'pop', knock: 0.8 });
    }
  }

  // A burning pool: every `tick` s for `life` s it hits everything inside for `damage`.
  addPool(p) {
    if (this.pools.length >= MAX_POOLS) this.pools.shift();
    this.pools.push({ tickT: 0, ...p, maxLife: p.life });
  }

  // Ball lightning: drifts along (vx, vy), zapping the nearest enemy within `range` `zaps` times over `life` s.
  addOrb(o) {
    if (this.orbs.length >= MAX_ORBS) this.orbs.shift();
    this.orbs.push({ zapT: o.life / o.zaps, ...o, zapsTotal: o.zaps, maxLife: o.life, spin: Math.random() * 6 });
  }

  update(dt, game) {
    this.time += dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t -= dt;
      if (e.t > 0) continue;
      this.events[i] = this.events[this.events.length - 1];
      this.events.pop();
      this.detonate(game, e);
    }

    const enemies = game.enemyManager.enemies;
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.life -= dt;
      p.tickT -= dt;
      if (p.tickT <= 0) {
        p.tickT += p.tick;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (e.dead) continue;
          const r = p.radius + e.radius;
          if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= r * r) game.hitEnemy(e, p.damage, p.source, 0, 0, 0.35);
        }
        if (Math.random() < 0.7) game.particles.spawnExplosionSparks(p.x + (Math.random() - 0.5) * p.radius, p.y + (Math.random() - 0.5) * p.radius, 2, p.hue, 0.5, 2.5, 1.8);
      }
      if (p.life <= 0) this.pools.splice(i, 1);
    }

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.x += o.vx;
      o.y += o.vy;
      o.vx *= 0.97;
      o.vy *= 0.97;
      o.life -= dt;
      o.spin += dt * 9;
      o.zapT -= dt;
      if (o.zapT <= 0 && o.zaps > 0) {
        o.zapT += o.maxLife / Math.max(1, o.zapsTotal);
        let best = null;
        let bestSq = o.range * o.range;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.dead) continue;
          const dSq = (e.x - o.x) ** 2 + (e.y - o.y) ** 2;
          if (dSq < bestSq) { bestSq = dSq; best = e; }
        }
        o.zaps--;
        if (best) {
          game.particles.spawnLightning(o.x, o.y, best.x, best.y, o.hue, 0.9, 0.18);
          game.particles.spawnFlash?.(best.x, best.y, 12 + best.radius, o.hue, 0.12);
          game.hitEnemy(best, o.damage, 'lightning', 0, 0, 0.6);
        }
      }
      if (o.life <= -0.05 || o.zaps <= 0) {
        game.particles.spawnShockwave(o.x, o.y, 40, o.hue, 2, 0.25);
        this.orbs.splice(i, 1);
      }
    }
  }

  detonate(game, e) {
    const fx = game.particles;
    const r = e.radius;
    switch (e.style) {
      case 'nuke':
        fx.spawnFlash?.(e.x, e.y, r * 0.8, 45, 0.4);
        fx.spawnShockwave(e.x, e.y, r, 30, 8, 0.7);
        fx.spawnShockwave(e.x, e.y, r * 0.55, 55, 5, 0.45);
        fx.spawnShockwave(e.x, e.y, r * 1.25, 10, 2, 0.9);
        fx.spawnExplosionSparks(e.x, e.y, 60, 35, 4, 18, 3);
        game.grid.applyImpulse(e.x, e.y, 110, r * 1.4, 40);
        game.shake = Math.min(26, Math.max(game.shake, 12 * (TUNING.screenShakeMult ?? 1)));
        game.sound.playExplosion?.(1.2);
        break;
      case 'thunder':
        fx.spawnLightning(e.x + (Math.random() - 0.5) * 40, e.y - 520, e.x, e.y, e.hue, 2.2, 0.32);
        fx.spawnLightning(e.x + (Math.random() - 0.5) * 60, e.y - 480, e.x, e.y, e.hue, 1.2, 0.26);
        fx.spawnFlash?.(e.x, e.y, r * 0.6, e.hue, 0.24);
        fx.spawnShockwave(e.x, e.y, r, e.hue, 4, 0.4);
        fx.spawnExplosionSparks(e.x, e.y, 22, e.hue, 2, 12, 2);
        game.sound.playArcZap?.(6);
        break;
      case 'implode':
        fx.spawnShockwave(e.x, e.y, r, e.hue, 5, 0.4, true);
        fx.spawnShockwave(e.x, e.y, r * 0.35, 320, 3, 0.25);
        fx.spawnFlash?.(e.x, e.y, r * 0.35, 320, 0.22);
        fx.spawnExplosionSparks(e.x, e.y, 26, e.hue, 3, 12, 2.2);
        game.grid.applyImpulse(e.x, e.y, 50, r * 1.2, e.hue);
        game.sound.playImplosion?.();
        break;
      case 'nova':
        fx.spawnFlash?.(e.x, e.y, r * 0.55, e.hue, 0.18);
        fx.spawnShockwave(e.x, e.y, r, e.hue, 3, 0.3);
        fx.spawnExplosionSparks(e.x, e.y, 10, e.hue, 2, 9, 1.8);
        break;
      case 'strike':
      case 'mortar':
        // A streak from above, then the blast.
        fx.spawnLightning(e.x, e.y - 360, e.x, e.y, e.hue, e.style === 'mortar' ? 1.4 : 1, 0.14, 0);
        fx.spawnFlash?.(e.x, e.y, r * 0.5, e.hue, 0.2);
        fx.spawnShockwave(e.x, e.y, r, e.hue, 4, 0.4);
        fx.spawnExplosionSparks(e.x, e.y, 16, e.hue, 2, 11, 2);
        game.sound.playMissileImpact?.(0.8);
        break;
      default:
        // pop (bomblets) and tandem (second warhead): a quick hot ring.
        fx.spawnFlash?.(e.x, e.y, r * 0.45, e.hue, 0.14);
        fx.spawnShockwave(e.x, e.y, r, e.hue, e.style === 'tandem' ? 4 : 2.5, e.style === 'tandem' ? 0.34 : 0.24);
        fx.spawnExplosionSparks(e.x, e.y, e.style === 'tandem' ? 14 : 6, e.hue, 2, 9, 1.8);
        if (e.style === 'tandem') game.sound.playMissileImpact?.(0.7);
    }
    if (e.damage > 0) game.damageEnemiesInRadius(e.x, e.y, r, e.damage, e.hue, e.source, e.knock, e.falloff, e.kind);
    e.after?.(game, e);
    if (e.cluster) {
      const c = e.cluster;
      this.scatter(e.x, e.y, c.count, r * 0.9, Math.max(36, r * c.radiusFrac), e.damage * c.share, c.delay, c.hue ?? e.hue, e.source);
    }
  }

  // World-space drawing (additive layer): pending reticles and bomblets, napalm pools, orbs.
  draw(ctx, game) {
    if (this.activeCount === 0) return;
    const vfx = TUNING.vfxIntensity ?? 1;
    const t = this.time;
    const view = (x, y, pad) => x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
    ctx.save();
    for (const p of this.pools) {
      if (!view(p.x, p.y, p.radius)) continue;
      const k = Math.max(0, p.life / p.maxLife);
      const flicker = 0.75 + 0.25 * Math.sin(t * 23 + p.x);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 50%, ${Math.min(1, 0.16 * k * flicker * vfx)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${p.hue + 15}, 100%, 62%, ${Math.min(1, 0.55 * k * vfx)})`;
      ctx.lineWidth = 2 * vfx;
      ctx.beginPath();
      for (let s = 0; s < 10; s++) {
        const a = (s / 10) * Math.PI * 2 + t * 0.7;
        const rr = p.radius * (0.82 + 0.18 * Math.sin(t * 9 + s * 2.3));
        if (s === 0) ctx.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
        else ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.stroke();
    }
    for (const e of this.events) {
      if (!view(e.x, e.y, e.radius + 20)) continue;
      const k = 1 - Math.max(0, e.t) / e.maxT;
      if (STYLE[e.style]?.reticle) {
        // Target reticle: a ring closing in with crosshair ticks, brighter as impact nears.
        const rr = e.radius * (1.3 - 0.3 * k);
        ctx.strokeStyle = `hsla(${e.hue}, 100%, 62%, ${Math.min(1, (0.25 + 0.6 * k) * vfx)})`;
        ctx.lineWidth = (e.style === 'nuke' ? 3 : 1.8) * vfx;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, rr, t * 2, t * 2 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const a = q * Math.PI / 2 + Math.PI / 4;
          ctx.moveTo(e.x + Math.cos(a) * rr * 0.35, e.y + Math.sin(a) * rr * 0.35);
          ctx.lineTo(e.x + Math.cos(a) * rr * 0.6, e.y + Math.sin(a) * rr * 0.6);
        }
        ctx.stroke();
        if (e.style === 'mortar' || e.style === 'nuke' || e.style === 'strike') {
          // The falling shell: a hot dot dropping in from above.
          const h = (1 - k) * 260;
          ctx.fillStyle = `hsla(${e.hue}, 100%, 75%, ${Math.min(1, 0.9 * vfx)})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y - h, (e.style === 'nuke' ? 7 : 3.5) * vfx, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.style === 'pop' && e.fromX !== undefined) {
        // Bomblet in flight from its parent blast to where it pops.
        const bx = e.fromX + (e.x - e.fromX) * Math.min(1, k * 1.6);
        const by = e.fromY + (e.y - e.fromY) * Math.min(1, k * 1.6);
        ctx.fillStyle = `hsla(${e.hue}, 100%, ${70 + 25 * k}%, 0.95)`;
        ctx.beginPath();
        ctx.arc(bx, by, (2.6 + 1.6 * Math.sin(t * 30)) * vfx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const o of this.orbs) {
      if (!view(o.x, o.y, 30)) continue;
      const pulse = 0.7 + 0.3 * Math.sin(t * 17 + o.spin);
      ctx.fillStyle = `hsla(${o.hue}, 100%, 70%, ${Math.min(1, 0.35 * vfx)})`;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 13 * pulse * vfx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${o.hue}, 100%, 82%, 0.95)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let s = 0; s < 7; s++) {
        const a = o.spin + s * 0.9;
        const rr = 6 + (s % 2) * 6 * pulse;
        if (s === 0) ctx.moveTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
        else ctx.lineTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
