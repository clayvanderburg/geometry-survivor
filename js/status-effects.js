// Damage types / status effects: BURN (plasma DoT), CHILL (cryo slow) and CORRODE (nanite armor erosion).
// Statuses live on the enemy (`e.st`, allocated once on first application). Game.hitEnemy applies them
// on hit and scales incoming damage by corrosion; updateStatusEffects ticks them at the fixed 60 Hz.
// Every number comes from weapon-scaling.js, so upgrade card previews stay exact.
import { WEAPON_SCALING as W, TAG_INFO, burnStackDps, chillSlow, corrodePerStack } from './weapon-scaling.js';

export const STATUS_COLORS = { burn: TAG_INFO.burn.color, chill: TAG_INFO.chill.color, corrode: TAG_INFO.corrode.color };

// Damage-over-time sources: they never crit and never re-apply statuses.
export const DOT_SOURCES = { burn: true };

// Embers are capped per tick so a burning 200-enemy swarm stays cheap.
const MAX_EMBERS_PER_TICK = 4;
const TICK_EPSILON = 1e-6;

function stateOf(e) {
  return e.st || (e.st = { burn: 0, burnMax: 1, burnT: 0, burnTick: 0, burnDps: 0, chillT: 0, slow: 0, corrode: 0, corrodeMax: 1, corrodeT: 0, stamp: -1 });
}

// Anything flagged invulnerable shrugs statuses off (vortexes are ordinary, killable enemies).
export const statusImmune = (e) => !!e.invulnerable;

export function isAfflicted(e) {
  const s = e.st;
  return !!s && (s.burn > 0 || s.chillT > 0 || s.corrode > 0);
}

// Corroded hulls take more damage from every source (DoTs included).
export function damageTakenMult(e) {
  const s = e.st;
  return s && s.corrode > 0 ? 1 + s.corrode * corrodePerStack() : 1;
}

export function applyBurn(p, e, lv) {
  const s = stateOf(e);
  if (s.burn === 0) s.burnTick = 0; // a fresh ignition waits one full interval before its first tick
  s.burnMax = W.burnMaxStacks(lv);
  s.burn = Math.min(s.burnMax, s.burn + 1);
  s.burnT = W.burnDuration;
  s.burnDps = burnStackDps(p, lv);
}

export function applyChill(e, lv) {
  const s = stateOf(e);
  const slow = chillSlow(lv, e.isBoss);
  s.slow = s.chillT > 0 ? Math.max(s.slow, slow) : slow;
  s.chillT = Math.max(s.chillT, W.chillDuration(lv));
  e.speedScale = 1 - s.slow;
}

export function applyCorrode(e, lv) {
  const s = stateOf(e);
  s.corrodeMax = W.corrodeMaxStacks(lv);
  s.corrode = Math.min(s.corrodeMax, s.corrode + 1);
  s.corrodeT = W.corrodeDuration;
}

// Which weapon applies which damage type (one card each).
export function applyOnHitStatuses(p, e, source) {
  if (e.dead || statusImmune(e)) return;
  const w = p.weapons;
  if (source === 'blaster') {
    if (w.thermite) applyBurn(p, e, w.thermite);
  } else if (source === 'missile') {
    if (w.cryo) applyChill(e, w.cryo);
  } else if (source === 'lightning') {
    if (w.nanite) applyCorrode(e, w.nanite);
  }
}

// Tick timers and burn damage. Burn ticks go through game.hitEnemy (source 'burn'), which can kill
// and splice; a per-tick stamp keeps a shifted enemy from being ticked twice.
export function updateStatusEffects(game, dt) {
  const enemies = game.enemyManager.enemies;
  const stamp = (game.statusStamp = (game.statusStamp || 0) + 1);
  const particles = game.particles;
  let embers = 0;
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (i >= enemies.length) continue;
    const e = enemies[i];
    const s = e.st;
    if (!s || e.dead || s.stamp === stamp) continue;
    s.stamp = stamp;

    if (s.chillT > 0) {
      s.chillT -= dt;
      if (s.chillT <= TICK_EPSILON) {
        s.chillT = 0;
        s.slow = 0;
        e.speedScale = 1;
      }
    }
    if (s.corrode > 0) {
      s.corrodeT -= dt;
      if (s.corrodeT <= TICK_EPSILON) s.corrode = 0;
    }
    if (s.burn > 0) {
      s.burnT -= dt;
      s.burnTick += dt;
      if (s.burnTick >= W.burnTickInterval - TICK_EPSILON) {
        s.burnTick -= W.burnTickInterval;
        game.hitEnemy(e, s.burnDps * s.burn * W.burnTickInterval, 'burn', 0, 0, 0.25);
        if (e.dead) continue;
      }
      if (s.burnT <= TICK_EPSILON) {
        s.burn = 0;
        s.burnT = 0;
      } else if (embers < MAX_EMBERS_PER_TICK && Math.random() < 0.06 + s.burn * 0.01) {
        embers++;
        particles.spawnDirectionalSparks(e.x + (Math.random() - 0.5) * e.radius, e.y - e.radius * 0.4, -Math.PI / 2, 0.7, 1, 16, 2.4);
      }
    }
  }
}

// Status overlays in three batched strokes (one path per type), drawn over the enemy hulls:
// BURN a flickering broken ring whose arcs lengthen with stacks, CHILL frost spikes around an
// ice-tinted hull (tint lives in EnemyManager.draw), CORRODE a ring gauge filling toward its stack cap.
export function drawStatusEffects(ctx, enemies, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
  let burning = 0, chilled = 0, corroded = 0;
  for (let i = 0; i < enemies.length; i++) {
    const s = enemies[i].st;
    if (!s) continue;
    if (s.burn > 0) burning++;
    if (s.chillT > 0) chilled++;
    if (s.corrode > 0) corroded++;
  }
  if (!burning && !chilled && !corroded) return;

  const visible = (e, pad) => e.x + pad >= camX && e.y + pad >= camY && e.x - pad <= camX + viewW && e.y - pad <= camY + viewH;
  ctx.save();
  // Plain source-over with butt caps: additive 'lighter' about doubled the raster cost of these
  // overlays on a fully afflicted 200-enemy swarm, and the solid neon reads the same on the dark field.
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'butt';

  if (burning) {
    ctx.strokeStyle = 'rgba(255, 110, 46, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.burn <= 0 || !visible(e, e.radius * 2)) continue;
      const r = e.radius * 1.32 + Math.sin(e.pulsePhase * 3.1) * 1.5;
      const len = 0.35 + 0.95 * (s.burn / s.burnMax);
      const spin = -e.pulsePhase * 0.9;
      for (let k = 0; k < 3; k++) {
        const a = spin + (k * Math.PI * 2) / 3;
        ctx.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        ctx.arc(e.x, e.y, r, a, a + len);
      }
    }
    ctx.stroke();
  }

  if (chilled) {
    ctx.strokeStyle = 'rgba(160, 238, 255, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.chillT <= 0 || !visible(e, e.radius * 2)) continue;
      const r0 = e.radius * 1.2;
      const r1 = e.radius * 1.2 + 5 + s.slow * 8;
      const spin = e.rotation * 0.25;
      for (let k = 0; k < 6; k++) {
        const a = spin + (k * Math.PI) / 3;
        const c = Math.cos(a), d = Math.sin(a);
        ctx.moveTo(e.x + c * r0, e.y + d * r0);
        ctx.lineTo(e.x + c * r1, e.y + d * r1);
      }
    }
    ctx.stroke();
  }

  if (corroded) {
    ctx.strokeStyle = 'rgba(110, 255, 70, 0.95)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.corrode <= 0 || !visible(e, e.radius * 2.2)) continue;
      // A gauge that fills clockwise from the top as stacks build; a closed ring means capped.
      // (One arc per enemy: per-stack pips cost several times more fill on a corroded swarm.)
      const r = e.radius * 1.5 + 3;
      const a0 = -Math.PI / 2;
      const a1 = a0 + (Math.PI * 2 - 0.5) * (s.corrode / s.corrodeMax) + 0.5 * (s.corrode >= s.corrodeMax ? 1 : 0);
      ctx.moveTo(e.x + Math.cos(a0) * r, e.y + Math.sin(a0) * r);
      ctx.arc(e.x, e.y, r, a0, a1);
    }
    ctx.stroke();
  }

  ctx.restore();
}
