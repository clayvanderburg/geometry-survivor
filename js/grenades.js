// Plasma Grenades: an autonomous slot weapon. Every throw interval the ship lobs `count` grenades at the
// nearest enemies in throw range (or along its aim when none is in range). Each grenade arcs through the
// air with a little bounce, sits armed for a short fuse with a blinking light, then bursts in an area
// blast. Breakthroughs: Cluster Grenades (bomblets scatter on landing), Lingering Cloud (the blast leaves
// a damaging cloud) and Gravity Grenade (armed grenades pull enemies in before they blast).
//
// One weapon, several elements: the damage-type cards the player owns set the grenade's element and hue
// (grenadeElement). Every grenade hit has source 'grenade', so status-effects.js applies burn / chill /
// corrode for each card owned, to the blast, the bomblets and the cloud alike.
//
// Grenades live in a fixed pool (nothing is allocated while throwing or simulating them) and are
// simulated only from Game.update, so pause, hit-stop and slow-mo freeze them with the rest of the world.
// Damage goes through Game.damageEnemiesInRadius / hitEnemy; bomblets and clouds run in weapon-fx.js.
import { WEAPON_SCALING as W, weaponDamage, grenadeBlastRadius } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { wellPullScale } from './gravity.js';
import { isDeployableTarget } from './deployables.js';

// Element per damage-type card (status-effects.js), with the blast / cloud hue. Plasma is the plain one.
export const GRENADE_ELEMENTS = {
  plasma: { id: 'plasma', label: 'PLASMA', hue: 162, card: null },
  fire: { id: 'fire', label: 'FIRE', hue: 18, card: 'thermite' },
  frost: { id: 'frost', label: 'FROST', hue: 192, card: 'cryo' },
  corrode: { id: 'corrode', label: 'CORROSIVE', hue: 100, card: 'nanite' }
};
const ELEMENT_ORDER = ['fire', 'frost', 'corrode'];

// The grenade's element: the damage-type card with the highest level (ties: fire, frost, corrode), or
// plasma when none is owned. Every owned card still applies its status on grenade hits.
export function grenadeElement(p) {
  let best = GRENADE_ELEMENTS.plasma;
  let bestLv = 0;
  for (const id of ELEMENT_ORDER) {
    const el = GRENADE_ELEMENTS[id];
    const lv = p.weapons?.[el.card] || 0;
    if (lv > bestLv) { best = el; bestLv = lv; }
  }
  return best;
}

const POOL = 64;          // >= grenades alive at once: up to 7 per throw, a throw every ~0.5 s, ~1.3-1.6 s each
const MAX_TARGETS = 8;    // >= W.grenadeCount at max rank (2 + 5)
const KNOCK = 1.7;
const ARC_SPLIT = 0.8;    // share of the flight spent on the main arc; the rest is one small bounce
const ARC_REACH = 0.9;    // share of the throw distance covered by the main arc
const LEAD = 0.5;         // share of the target's motion over the flight that the throw leads

export class Grenades {
  constructor() {
    this.items = Array.from({ length: POOL }, () => ({
      x: 0, y: 0, z: 0, sx: 0, sy: 0, lx: 0, ly: 0, h: 0, age: 0, flight: 0, fuse: 0, armedT: 0, landed: false,
      damage: 0, radius: 0, hue: 0, element: 'plasma', cluster: false, cloud: false, gravity: false, emp: false, pullRadius: 0, spin: 0
    }));
    this.targets = new Array(MAX_TARGETS).fill(null);
    this.targetD = new Float64Array(MAX_TARGETS);
    this.clear();
  }

  // Run reset: every grenade gone, the first throw shortly after the run starts.
  clear() {
    this.count = 0;
    this.timer = 0.6;
    this.time = 0;
    this.throws = 0;
    this.targets.fill(null);
  }

  get activeCount() {
    return this.count;
  }

  update(dt, game) {
    const p = game.player;
    const owned = (p.weapons.grenades || 0) > 0;
    if (!owned && this.count === 0) return;
    this.time += dt;
    if (owned) {
      this.timer -= dt;
      if (this.timer <= 0 && game.enemyManager.enemies.length > 0) {
        const b = weaponBuild(p, 'grenades');
        this.throwGrenades(game, b);
        this.timer = W.grenadeCooldown(b);
      }
    }
    for (let i = this.count - 1; i >= 0; i--) {
      const g = this.items[i];
      g.age += dt;
      g.spin += dt * (g.landed ? 2 : 11);
      if (!g.landed) {
        const k = Math.min(1, g.age / g.flight);
        let f;
        if (k < ARC_SPLIT) {
          f = ARC_REACH * k / ARC_SPLIT;
          g.z = g.h * Math.sin(Math.PI * k / ARC_SPLIT);
        } else {
          const q = (k - ARC_SPLIT) / (1 - ARC_SPLIT);
          f = ARC_REACH + (1 - ARC_REACH) * q;
          g.z = g.h * 0.16 * Math.sin(Math.PI * q); // the little bounce
        }
        g.x = g.sx + (g.lx - g.sx) * f;
        g.y = g.sy + (g.ly - g.sy) * f;
        if (k >= 1) this.land(game, g);
        continue;
      }
      g.armedT += dt;
      if (g.gravity) this.pull(game, g);
      if (g.armedT >= g.fuse) {
        // Swap-remove keeps live grenades packed; `g` keeps its data until the slot is reused.
        this.items[i] = this.items[this.count - 1];
        this.items[--this.count] = g;
        this.explode(game, g);
      }
    }
  }

  // Up to `max` nearest valid enemies within `range` of (x, y), nearest first, into this.targets.
  nearestTargets(game, x, y, range, max) {
    const enemies = game.enemyManager.enemies;
    const t = this.targets;
    const d = this.targetD;
    let n = 0;
    if (max <= 0) return 0;
    const rangeSq = range * range;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!isDeployableTarget(e)) continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq > rangeSq || (n === max && dSq >= d[n - 1])) continue;
      let j = n < max ? n++ : n - 1;
      while (j > 0 && d[j - 1] > dSq) {
        t[j] = t[j - 1];
        d[j] = d[j - 1];
        j--;
      }
      t[j] = e;
      d[j] = dSq;
    }
    return n;
  }

  throwGrenades(game, b) {
    const p = game.player;
    const n = W.grenadeCount(b);
    const range = W.grenadeRange(b);
    const found = this.nearestTargets(game, p.x, p.y, range, Math.min(n, MAX_TARGETS));
    const radius = grenadeBlastRadius(p, b);
    const damage = weaponDamage(p, 'grenade', b);
    const el = grenadeElement(p);
    const emp = !!p.weapons.empGrenades && (p.weapons.lightning || 0) > 0;
    const lead = W.grenadeFlight * 60 * LEAD;
    for (let k = 0; k < n && this.count < POOL; k++) {
      let tx, ty;
      if (found > 0) {
        const e = this.targets[k % found];
        tx = e.x + (e.vx || 0) * lead;
        ty = e.y + (e.vy || 0) * lead;
        if (k >= found) {
          // More grenades than targets: spread the extras around the pack.
          const a = Math.random() * Math.PI * 2;
          const r = radius * (0.35 + 0.4 * Math.random());
          tx += Math.cos(a) * r;
          ty += Math.sin(a) * r;
        }
      } else {
        // Nothing in range: a fan along the aim.
        const a = p.angle + (k - (n - 1) / 2) * 0.32;
        tx = p.x + Math.cos(a) * range * 0.6;
        ty = p.y + Math.sin(a) * range * 0.6;
      }
      // Never land past the throw range (leading a fast target can push the spot out).
      let dx = tx - p.x;
      let dy = ty - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > range) {
        dx *= range / dist;
        dy *= range / dist;
      }
      const g = this.items[this.count++];
      g.sx = g.x = p.x + (dx / dist) * (p.radius || 15) * 0.6;
      g.sy = g.y = p.y + (dy / dist) * (p.radius || 15) * 0.6;
      g.lx = p.x + dx;
      g.ly = p.y + dy;
      g.z = 0;
      g.h = 34 + Math.min(range, Math.hypot(dx, dy)) * 0.18;
      g.age = 0;
      g.flight = W.grenadeFlight * (0.9 + 0.2 * (k / Math.max(1, n - 1)));
      g.fuse = b.t12 ? W.gravityFuse : W.grenadeFuse;
      g.armedT = 0;
      g.landed = false;
      g.damage = damage;
      g.radius = radius;
      g.hue = el.hue;
      g.element = el.id;
      g.cluster = b.t4;
      g.cloud = b.t8;
      g.gravity = b.t12;
      g.emp = emp;
      g.pullRadius = radius * W.gravityPullRadiusMult;
      g.spin = Math.random() * Math.PI * 2;
    }
    for (let k = 0; k < MAX_TARGETS; k++) this.targets[k] = null;
    this.throws++;
    const fx = game.particles;
    fx.spawnFlash?.(p.x, p.y, 16 + Math.min(n, 7) * 2, el.hue, 0.12);
    fx.spawnShockwave(p.x, p.y, 26 + Math.min(n, 7) * 2, el.hue, 2, 0.2);
    game.sound.playLaser?.(0.42);
  }

  land(game, g) {
    g.landed = true;
    g.armedT = 0;
    g.z = 0;
    g.x = g.lx;
    g.y = g.ly;
    const fx = game.particles;
    fx.spawnShockwave(g.x, g.y, 20, g.hue, 1.6, 0.18);
    fx.spawnExplosionSparks(g.x, g.y, 3, g.hue, 1, 4, 1.4);
    // Cluster Grenades: the grenade splits as it lands; bomblets scatter and pop a moment later.
    if (g.cluster) {
      game.weaponFx?.scatter(g.x, g.y, W.grenadeClusterBomblets, g.radius * 0.95, Math.max(30, g.radius * W.grenadeClusterRadiusFrac),
        g.damage * W.grenadeClusterShare, W.grenadeClusterDelay, g.hue, 'grenade');
    }
    if (g.gravity) {
      fx.spawnShockwave(g.x, g.y, g.pullRadius, g.hue, 2.5, g.fuse, true);
      if (this.throwSound !== this.throws) {
        this.throwSound = this.throws; // one implosion cue per throw, not per grenade
        game.sound.playImplosion?.();
      }
    }
  }

  // Gravity Grenade: an armed grenade drags nearby enemies in (bosses and portals hold their ground).
  pull(game, g) {
    const R = g.pullRadius;
    const enemies = game.enemyManager.enemies;
    const strength = W.gravityPull * (0.6 + 0.8 * Math.min(1, g.armedT / g.fuse));
    game.particles.applyGravityWell?.(g.x, g.y, 1.2, R);
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (e.isBoss || !isDeployableTarget(e)) continue;
      const dx = g.x - e.x;
      const dy = g.y - e.y;
      const k = wellPullScale(dx, dy, R, strength, 10);
      if (k === 0) continue;
      e.gvx = (e.gvx || 0) + (dx - dy * 0.3) * k;
      e.gvy = (e.gvy || 0) + (dy + dx * 0.3) * k;
    }
  }

  explode(game, g) {
    const fx = game.particles;
    const r = g.radius;
    fx.spawnFlash?.(g.x, g.y, r * 0.5, g.hue, 0.2);
    fx.spawnShockwave(g.x, g.y, r, g.hue, 4, 0.4);
    fx.spawnShockwave(g.x, g.y, r * 0.42, g.hue + 25, 2.5, 0.24);
    fx.spawnExplosionSparks(g.x, g.y, g.gravity ? 22 : 14, g.hue, 2, 10, 2);
    if (g.gravity) fx.spawnShockwave(g.x, g.y, r * 0.3, 320, 3, 0.22);
    game.sound.playMissileImpact?.(0.8);
    game.damageEnemiesInRadius(g.x, g.y, r, g.damage, g.hue, 'grenade', KNOCK);
    // Lingering Cloud: a cloud of the grenade's element that hits everything inside every tick.
    if (g.cloud) {
      const ticks = W.cloudLife / W.cloudTick;
      game.weaponFx?.addPool({ x: g.x, y: g.y, radius: r * W.cloudRadiusFrac, life: W.cloudLife, tick: W.cloudTick,
        damage: g.damage * W.cloudShare / ticks, hue: g.hue, source: 'grenade', look: g.element });
    }
    if (g.emp) this.emp(game, g);
  }

  // SYNERGY: EMP Grenades: the blast arcs Tesla lightning into the nearest enemies around it.
  emp(game, g) {
    const n = this.nearestTargets(game, g.x, g.y, g.radius * W.empRangeMult, W.empArcs);
    for (let k = 0; k < n; k++) {
      const e = this.targets[k];
      this.targets[k] = null;
      if (e.dead) continue;
      game.particles.spawnLightning(g.x, g.y, e.x, e.y, 275, 1.1, 0.2);
      game.hitEnemy(e, g.damage * W.empShare, 'lightning', 0, 0, 0.6, 'emp');
    }
    if (n > 0) game.sound.playArcZap?.(n);
  }

  // ---- Rendering (additive layer, world space). Animation runs on this.time, so it freezes with the sim. ----
  inView(game, x, y, pad) {
    return x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
  }

  // Ground layer (under enemies): landing markers for grenades in flight, armed grenades with their
  // blinking light, fuse ring and (Gravity Grenade) the swirling pull.
  drawGround(ctx, game) {
    if (this.count === 0) return;
    const t = this.time;
    for (let i = 0; i < this.count; i++) {
      const g = this.items[i];
      if (!this.inView(game, g.landed ? g.x : g.lx, g.landed ? g.y : g.ly, (g.gravity ? g.pullRadius : g.radius) + 10)) continue;
      const hue = g.hue;
      if (!g.landed) {
        // Landing marker: a small ring that tightens as the grenade comes down.
        const k = Math.min(1, g.age / g.flight);
        ctx.strokeStyle = `hsla(${hue}, 100%, 62%, ${0.2 + 0.4 * k})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(g.lx, g.ly, 16 - 8 * k, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const k = Math.min(1, g.armedT / g.fuse);
      // Fuse ring at the blast radius: faint track, an arc that fills as the fuse burns down.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.08 + 0.1 * k})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 100%, 66%, ${0.3 + 0.35 * k})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
      if (g.gravity) {
        // Pull field: three arcs spiralling inward, tightening as the blast nears.
        const rr = g.pullRadius * (1 - 0.55 * k);
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.25 + 0.35 * k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let s = 0; s < 3; s++) {
          const a = -t * 5 + (s * Math.PI * 2) / 3;
          ctx.moveTo(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr);
          ctx.arc(g.x, g.y, rr, a, a + 1.1);
        }
        ctx.stroke();
        ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.06 + 0.08 * k})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, rr * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      this.drawBody(ctx, g, g.x, g.y, 1);
      // Blinking arm light: faster as the fuse runs out.
      const blink = Math.sin(g.armedT * Math.PI * 2 * (3 + 9 * k)) > 0;
      if (blink) {
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, 0.35)`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 9 + 4 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(g.x, g.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Air layer (over enemies): grenades in flight, lifted by their arc height, with a short streak.
  drawAir(ctx, game) {
    if (this.count === 0) return;
    for (let i = 0; i < this.count; i++) {
      const g = this.items[i];
      if (g.landed || !this.inView(game, g.x, g.y - g.z, 30)) continue;
      const lift = 1 + g.z / 120; // a little bigger at the top of the arc
      // Ground glow under the grenade (where it is over the field).
      ctx.fillStyle = `hsla(${g.hue}, 100%, 55%, 0.18)`;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 6 * lift, 3 * lift, 0, 0, Math.PI * 2);
      ctx.fill();
      // Streak back toward the thrower.
      const dx = g.lx - g.sx;
      const dy = g.ly - g.sy;
      const len = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = `hsla(${g.hue}, 100%, 65%, 0.5)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(g.x - (dx / len) * 12, g.y - g.z - (dy / len) * 12 + 3);
      ctx.lineTo(g.x, g.y - g.z);
      ctx.stroke();
      this.drawBody(ctx, g, g.x, g.y - g.z, lift);
    }
  }

  // The grenade itself: a spinning hex shell around a hot core.
  drawBody(ctx, g, x, y, scale) {
    const r = 6.5 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(g.spin);
    ctx.strokeStyle = `hsla(${g.hue}, 100%, 64%, 0.95)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s < 6; s++) {
      const a = (s * Math.PI) / 3;
      if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, 0);
    ctx.lineTo(r * 0.55, 0);
    ctx.stroke();
    ctx.fillStyle = `hsla(${g.hue}, 100%, 78%, 0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
