// Electric Shield Field: a defensive slot weapon. A charged field rings the hull. Once charged, the first
// enemy to cross its radius sets off a DISCHARGE: every enemy inside takes the same hit, is shoved out and
// SHOCKed (stunned) through the shared stun rules (status-effects.js: no refresh while stunned, stun
// immunity afterwards, bosses and lieutenants resist), then the field recharges for its cooldown.
// Its element is fixed (weapon-levels.js FIXED_ELEMENTS), so the SHOCK STATUS cards and the Shock
// Amplifier strengthen it like any SHOCK weapon.
//
// It is a weapon, not shield HP: nothing here reads or writes player.hp / maxHp, and contact damage is
// unchanged (enemies inside the field still hurt on touch).
//
// Breakthroughs: Arc Lash (LV 6: each discharge also arcs into the nearest enemies just outside the
// field), Repulsor Surge (LV 12: discharges throw enemies back and shave the Phase Dash cooldown) and
// Thunderclap Overcharge (LV 18: discharges bank charge; a full bank bursts in a wide thunderclap as
// soon as a big pack, a boss or a lieutenant closes in).
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'shockfield').
import { WEAPON_SCALING as W, weaponDamage, fieldRadius } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';

export const FIELD_HUE = 188;     // electric cyan
const MAX_BOLTS = 6;              // discharge bolts drawn per discharge (all enemies are still hit)
const MAX_LASH = 8;               // >= W.lashArcs
const CLAP_KNOCK = 2.4;
const CRACKLE_BOLTS = 5;          // jagged sparks round a charged ring
const HUD_STEPS = 10;             // HUD charge gauge resolution (keeps the chip HTML from changing every tick)

// Enemies the field can hit and that set it off: anything alive and not invulnerable.
const fieldTarget = (e) => !e.dead && !e.invulnerable;

// Share of the Repulsor Surge shove a hull takes: bosses hold their ground, lieutenants and heavy hulls
// move less.
export function repulseScale(e) {
  if (e.isBoss) return 0;
  const mass = Math.min(1, (14 / Math.max(6, e.radius || 10)) ** 2);
  return e.isLieutenant ? mass * 0.5 : mass;
}

// Cheap hash so the charged ring's crackle jumps around a few times a second without Math.random in draw.
const hash = (k, frame) => {
  const v = Math.sin(k * 12.9898 + frame * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export class ShockField {
  constructor() {
    this.hits = [];
    this.lashT = new Array(MAX_LASH).fill(null);
    this.lashD = new Float64Array(MAX_LASH);
    this.clear();
  }

  // Run reset: charged and empty.
  clear() {
    this.active = false;
    this.timer = 0;
    this.duration = 1;
    this.store = 0;
    this.radius = 0;
    this.time = 0;
    this.flash = 0;     // s left of the post-discharge snap on the ring
    this.clapFlash = 0; // same for a thunderclap
    this.discharges = 0;
    this.thunderclaps = 0;
    this.hits.length = 0;
  }

  // 0 (just fired) .. 1 (charged).
  get charge() {
    return this.timer > 0 ? Math.max(0, 1 - this.timer / this.duration) : 1;
  }

  // Charge for the HUD chip, in HUD_STEPS steps; null while the field is not equipped.
  hudCharge() {
    return this.active ? Math.floor(this.charge * HUD_STEPS) / HUD_STEPS : null;
  }

  update(dt, game) {
    const p = game.player;
    this.time += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.clapFlash > 0) this.clapFlash = Math.max(0, this.clapFlash - dt);
    if (!((p?.weapons?.shockfield || 0) > 0)) {
      if (this.active) this.clear();
      return;
    }
    this.active = true;
    const b = weaponBuild(p, 'shockfield');
    const r = fieldRadius(p, b);
    this.radius = r;
    if (this.timer > 0) this.timer = this.timer - dt > 1e-9 ? this.timer - dt : 0; // no float drift past a tick
    if (!b.t12) this.store = 0;
    else if (this.store >= W.overchargeStore && this.packClosing(game, p, r)) this.thunderclap(game, b, r);
    if (this.timer <= 0 && this.anyInside(game, p, r)) this.discharge(game, b, r);
  }

  anyInside(game, p, r) {
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!fieldTarget(e)) continue;
      const reach = r + e.radius;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
    return false;
  }

  // Thunderclap trigger: overchargePack enemies inside the clap radius, or a boss or lieutenant in the field.
  packClosing(game, p, r) {
    const enemies = game.enemyManager.enemies;
    const r2 = r * W.overchargeRadiusMult;
    let n = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!fieldTarget(e)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dSq = dx * dx + dy * dy;
      if ((e.isBoss || e.isLieutenant) && dSq <= (r + e.radius) ** 2) return true;
      if (dSq <= (r2 + e.radius) ** 2 && ++n >= W.overchargePack) return true;
    }
    return false;
  }

  // Everything inside radius `r` of the ship, into this.hits (a snapshot: kills splice the live list).
  collect(game, p, r) {
    const hits = this.hits;
    hits.length = 0;
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!fieldTarget(e)) continue;
      const reach = r + e.radius;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy <= reach * reach) hits.push(e);
    }
    return hits;
  }

  // Hit everything collected for `dmg`, shoving it outward (Repulsor Surge: a hard throw instead).
  strike(game, p, dmg, knock, repulse, stat) {
    const hits = this.hits;
    const fx = game.particles;
    let bolts = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      if (bolts < MAX_BOLTS) {
        bolts++;
        fx.spawnLightning(p.x + nx * (p.radius || 15), p.y + ny * (p.radius || 15), e.x, e.y, FIELD_HUE, stat === 'thunderclap' ? 1.5 : 1.1, 0.22);
      }
      game.hitEnemy(e, dmg, 'shockfield', nx * knock, ny * knock, 1, stat);
      if (repulse && !e.dead) {
        const k = W.repulseImpulse * repulseScale(e);
        e.gvx = (e.gvx || 0) + nx * k;
        e.gvy = (e.gvy || 0) + ny * k;
      }
    }
    const n = hits.length;
    hits.length = 0;
    return n;
  }

  discharge(game, b, r) {
    const p = game.player;
    const dmg = weaponDamage(p, 'shockfield', b);
    this.collect(game, p, r);
    const n = this.strike(game, p, dmg, b.t8 ? 0 : W.fieldKnock, b.t8, 'shockfield');
    if (b.t4) this.lash(game, p, r, dmg);
    // Repulsor Surge: a discharge that lands shaves the Phase Dash cooldown (never the shield).
    if (b.t8 && n > 0 && p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - W.dashRefund);
    if (b.t12) this.store = Math.min(W.overchargeStore, this.store + 1);
    this.timer = this.duration = W.fieldCooldown(b);
    this.discharges++;
    this.flash = 0.28;
    const fx = game.particles;
    fx.spawnShockwave(p.x, p.y, r, FIELD_HUE, 3, 0.26);
    fx.spawnShockwave(p.x, p.y, r * 0.55, 200, 2, 0.18);
    fx.spawnFlash?.(p.x, p.y, 26, FIELD_HUE, 0.12);
    if (b.t8) fx.spawnShockwave(p.x, p.y, r * 1.45, FIELD_HUE + 10, 2.5, 0.34);
    game.grid.applyImpulse?.(p.x, p.y, 30, r * 1.1, FIELD_HUE);
    game.grid.ripple?.(p.x, p.y, r, FIELD_HUE);
    game.sound.playFieldDischarge?.(n);
  }

  // Arc Lash: arcs from the field's edge into the nearest enemies outside it (within lashRangeMult x r).
  lash(game, p, r, dmg) {
    const enemies = game.enemyManager.enemies;
    const t = this.lashT;
    const d = this.lashD;
    const max = Math.min(MAX_LASH, W.lashArcs);
    const far = r * W.lashRangeMult;
    let n = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!fieldTarget(e)) continue;
      const dSq = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (dSq <= (r + e.radius) ** 2 || dSq > far * far || (n === max && dSq >= d[n - 1])) continue;
      let j = n < max ? n++ : n - 1;
      while (j > 0 && d[j - 1] > dSq) {
        t[j] = t[j - 1];
        d[j] = d[j - 1];
        j--;
      }
      t[j] = e;
      d[j] = dSq;
    }
    for (let k = 0; k < n; k++) {
      const e = t[k];
      t[k] = null;
      if (e.dead) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      game.particles.spawnLightning(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, e.x, e.y, FIELD_HUE + 12, 1, 0.24);
      game.hitEnemy(e, dmg * W.lashShare, 'shockfield', 0, 0, 0.6, 'fieldlash');
    }
    return n;
  }

  // Thunderclap Overcharge: the banked charge bursts over a wider ring, independent of the recharge.
  thunderclap(game, b, r) {
    const p = game.player;
    const r2 = r * W.overchargeRadiusMult;
    const dmg = weaponDamage(p, 'shockfield', b) * W.overchargeShare;
    this.collect(game, p, r2);
    this.strike(game, p, dmg, CLAP_KNOCK, b.t8, 'thunderclap');
    this.store = 0;
    this.thunderclaps++;
    this.clapFlash = 0.4;
    const fx = game.particles;
    fx.spawnFlash?.(p.x, p.y, 60, 195, 0.2);
    fx.spawnShockwave(p.x, p.y, r2, FIELD_HUE, 5, 0.42);
    fx.spawnShockwave(p.x, p.y, r2 * 0.7, 55, 3, 0.3);
    fx.spawnExplosionSparks(p.x, p.y, 18, FIELD_HUE, 3, 14, 2);
    game.grid.applyImpulse?.(p.x, p.y, 60, r2 * 1.2, FIELD_HUE);
    game.grid.ripple?.(p.x, p.y, r2, FIELD_HUE, 1.2);
    game.addShake?.(5);
    game.sound.playThunderclap?.();
  }

  // ---- Rendering (additive world layer, under enemies). Animation runs on this.time, so it freezes with the sim. ----
  // A faint ring at the field radius with a charge arc filling clockwise; once charged the ring brightens
  // and crackles. A discharge snaps it outward; banked Overcharge shows as pips on the ring.
  draw(ctx, game) {
    if (!this.active || !(this.radius > 0)) return;
    const p = game.player;
    const r = this.radius;
    const t = this.time;
    const charge = this.charge;
    const ready = this.timer <= 0;
    const x = p.x, y = p.y;

    // Track ring.
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `hsla(${FIELD_HUE}, 100%, 70%, ${ready ? 0.22 : 0.08 + 0.1 * charge})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (!ready) {
      // Charge arc: brightens as it fills.
      ctx.lineWidth = 2;
      ctx.strokeStyle = `hsla(${FIELD_HUE}, 100%, ${62 + 18 * charge}%, ${0.2 + 0.45 * charge})`;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
      ctx.stroke();
    } else {
      // Charged: a pulsing white-cyan ring with jagged sparks crawling round it.
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      ctx.lineWidth = 2 + pulse * 0.8;
      ctx.strokeStyle = `hsla(${FIELD_HUE}, 100%, 82%, ${0.45 + 0.2 * pulse})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      const frame = Math.floor(t * 12);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(235, 255, 255, 0.8)';
      ctx.beginPath();
      for (let k = 0; k < CRACKLE_BOLTS; k++) {
        const a0 = (k / CRACKLE_BOLTS) * Math.PI * 2 + hash(k, frame) * 1.2 + t * 0.6;
        const span = 0.22 + hash(k + 9, frame) * 0.2;
        for (let s = 0; s <= 3; s++) {
          const a = a0 + (span * s) / 3;
          const rr = r + (s === 0 || s === 3 ? 0 : (hash(k * 4 + s, frame) - 0.5) * 12);
          if (s === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
      }
      ctx.stroke();
    }

    // Discharge snap: the ring kicks outward and fades.
    if (this.flash > 0) {
      const k = 1 - this.flash / 0.28;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.strokeStyle = `hsla(${FIELD_HUE}, 100%, 88%, ${0.8 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + 0.18 * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Overcharge pips (Thunderclap Overcharge): one per banked charge.
    if (this.store > 0 || this.clapFlash > 0) {
      const max = W.overchargeStore;
      ctx.fillStyle = this.store >= max ? 'rgba(255, 250, 200, 0.95)' : `hsla(${FIELD_HUE}, 100%, 80%, 0.85)`;
      ctx.beginPath();
      for (let i = 0; i < this.store; i++) {
        const a = -Math.PI / 2 + ((i - (max - 1) / 2) * 0.16);
        const px = x + Math.cos(a) * (r + 9);
        const py = y + Math.sin(a) * (r + 9);
        ctx.moveTo(px + 3.2, py);
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}
