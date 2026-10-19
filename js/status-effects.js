// Status effects of the four elements: BURN (FIRE, a DoT), CHILL (FROST, a slow), CORRODE (CORROSIVE,
// +damage taken) and STUN (SHOCK, a short freeze). Each element-capable weapon carries at most one
// element (weapon-levels.js ELEMENT_CARDS); its hits apply that element's status at the element card's
// rank. Statuses live on the enemy (`e.st`, allocated once on first application). Game.hitEnemy applies
// them on hit and scales incoming damage by corrosion; updateStatusEffects ticks them at the fixed 60 Hz;
// EnemyManager.update freezes stunned enemies. Every number comes from weapon-scaling.js, so upgrade
// card previews stay exact.
import {
  WEAPON_SCALING as W, TAG_INFO, SOURCE_WEAPON, burnStackDps, burnMaxStacks, burnDuration, chillSlow, chillDuration,
  corrodePerStack, corrodeMaxStacks, corrodeDuration, doubleStackChance, shockStun, shockLongStun, shockLongChance, stunResist, stunImmunity
} from './weapon-scaling.js';
import { ELEMENT_KEYS, FIXED_ELEMENTS, weaponElement } from './weapon-levels.js';

export const STATUS_COLORS = { burn: TAG_INFO.burn.color, chill: TAG_INFO.chill.color, corrode: TAG_INFO.corrode.color, shock: TAG_INFO.shock.color };

// Damage-over-time sources: they never crit and never re-apply statuses.
export const DOT_SOURCES = { burn: true };

// Burn ticks are credited to the weapon that lit the fire (run-stats.js SUB_SOURCES: burn_<weapon>).
export const BURN_STATS = Object.fromEntries([...Object.keys(ELEMENT_KEYS), ...Object.keys(FIXED_ELEMENTS)].map((id) => [id, `burn_${id}`]));

// Embers and sparks are capped per tick so a burning (or stunned) 200-enemy swarm stays cheap.
const MAX_EMBERS_PER_TICK = 4;
const MAX_SPARKS_PER_TICK = 3;
const TICK_EPSILON = 1e-6;

function stateOf(e) {
  return e.st || (e.st = {
    burn: 0, burnMax: 1, burnT: 0, burnTick: 0, burnDps: 0, burnStat: 'burn', chillT: 0, slow: 0, corrode: 0, corrodeMax: 1, corrodeT: 0,
    corrodePer: 0, stunT: 0, stunMax: 0, stunLong: false, stunImmT: 0, stamp: -1
  });
}

// Anything flagged invulnerable shrugs statuses off (vortexes are ordinary, killable enemies).
export const statusImmune = (e) => !!e.invulnerable;

export function isAfflicted(e) {
  const s = e.st;
  return !!s && (s.burn > 0 || s.chillT > 0 || s.corrode > 0 || s.stunT > 0);
}

export const isStunned = (e) => !!e.st && e.st.stunT > 0;

// Corroded hulls take more damage from every source (DoTs included).
export function damageTakenMult(e) {
  const s = e.st;
  return s && s.corrode > 0 ? 1 + s.corrode * s.corrodePer : 1;
}

const stacksPerHit = (p) => (Math.random() < doubleStackChance(p) ? 2 : 1);

export function applyBurn(p, e, lv, weapon = 'blaster') {
  const s = stateOf(e);
  const burning = s.burn > 0;
  if (!burning) s.burnTick = 0; // a fresh ignition waits one full interval before its first tick
  const max = burnMaxStacks(p, lv);
  const dps = burnStackDps(p, lv, weapon);
  // Two weapons on fire may feed one blaze: it keeps the stronger stack cap and stack DPS.
  s.burnMax = burning ? Math.max(s.burnMax, max) : max;
  s.burnDps = burning ? Math.max(s.burnDps, dps) : dps;
  s.burn = Math.min(s.burnMax, s.burn + stacksPerHit(p));
  s.burnT = burnDuration(p);
  s.burnStat = BURN_STATS[weapon] || 'burn';
}

export function applyChill(e, lv, p = null) {
  const s = stateOf(e);
  const slow = chillSlow(lv, e.isBoss, p);
  s.slow = s.chillT > 0 ? Math.max(s.slow, slow) : slow;
  s.chillT = Math.max(s.chillT, chillDuration(p, lv));
  e.speedScale = 1 - s.slow;
}

export function applyCorrode(e, lv, p = null) {
  const s = stateOf(e);
  const corroding = s.corrode > 0;
  const max = corrodeMaxStacks(p, lv);
  const per = corrodePerStack(p);
  s.corrodeMax = corroding ? Math.max(s.corrodeMax, max) : max;
  s.corrodePer = corroding ? Math.max(s.corrodePer, per) : per;
  s.corrode = Math.min(s.corrodeMax, s.corrode + stacksPerHit(p));
  s.corrodeT = corrodeDuration(p);
}

// SHOCK: stuns an enemy that is neither stunned nor stun-immune (no refresh while stunned, so a stream
// of hits can never chain stuns). Bosses and lieutenants keep only part of the stun.
export function applyShock(e, lv, p = null) {
  const s = stateOf(e);
  if (s.stunT > 0 || s.stunImmT > 0) return false;
  const long = Math.random() < shockLongChance(p, lv);
  const t = (long ? shockLongStun(p) : shockStun(p, lv)) * stunResist(e);
  if (!(t > 0)) return false;
  s.stunT = t;
  s.stunMax = t;
  s.stunLong = long;
  return true;
}

// Apply the element of the weapon behind `source` (Autocannon bolts and Pulsar Helix bolts share the
// Autocannon's; Storm Protocol and EMP arcs are Tesla arcs; Corrosive Gas Trail is always CORROSIVE, Electric Shield Field always SHOCK).
// Weapons without an element apply nothing.
export function applyOnHitStatuses(p, e, source) {
  if (e.dead || statusImmune(e)) return;
  const weapon = SOURCE_WEAPON[source];
  const el = weapon && weaponElement(p, weapon);
  if (!el) return;
  const lv = el.rank;
  switch (el.element) { // one element per weapon
    case 'fire': applyBurn(p, e, lv, weapon); break;
    case 'frost': applyChill(e, lv, p); break;
    case 'corrode': applyCorrode(e, lv, p); break;
    case 'shock': applyShock(e, lv, p); break;
  }
}

// Tick timers and burn damage. Burn ticks go through game.hitEnemy (source 'burn'), which can kill
// and splice; a per-tick stamp keeps a shifted enemy from being ticked twice.
export function updateStatusEffects(game, dt) {
  const enemies = game.enemyManager.enemies;
  const stamp = (game.statusStamp = (game.statusStamp || 0) + 1);
  const particles = game.particles;
  let embers = 0;
  let sparks = 0;
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (i >= enemies.length) continue;
    const e = enemies[i];
    const s = e.st;
    if (!s || e.dead || s.stamp === stamp) continue;
    s.stamp = stamp;

    if (s.stunT > 0) {
      s.stunT -= dt;
      if (s.stunT <= TICK_EPSILON) {
        s.stunT = 0;
        s.stunImmT = stunImmunity(e);
      } else if (sparks < MAX_SPARKS_PER_TICK && Math.random() < 0.08) {
        sparks++;
        particles.spawnExplosionSparks?.(e.x + (Math.random() - 0.5) * e.radius * 1.6, e.y + (Math.random() - 0.5) * e.radius * 1.6, 2, 62, 0.6, 3, 1.6);
      }
    } else if (s.stunImmT > 0) {
      s.stunImmT = Math.max(0, s.stunImmT - dt);
    }
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
        game.hitEnemy(e, s.burnDps * s.burn * W.burnTickInterval, 'burn', 0, 0, 0.25, s.burnStat || 'burn');
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

// Cheap per-enemy hash so crackle bolts jump around a few times a second without Math.random in draw.
const crackle = (e, k, frame) => {
  const v = Math.sin((e.x * 0.013 + e.y * 0.007 + k * 12.9898 + frame * 78.233)) * 43758.5453;
  return v - Math.floor(v);
};

// Status overlays in four batched strokes (one path per type), drawn over the enemy hulls:
// BURN a flickering broken ring whose arcs lengthen with stacks, CHILL frost spikes around an
// ice-tinted hull (tint lives in EnemyManager.draw), CORRODE a ring gauge filling toward its stack cap,
// STUN jagged electric arcs crackling round a yellow-flashing hull (long stuns crackle harder).
export function drawStatusEffects(ctx, enemies, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
  let burning = 0, chilled = 0, corroded = 0, stunned = 0;
  for (let i = 0; i < enemies.length; i++) {
    const s = enemies[i].st;
    if (!s) continue;
    if (s.burn > 0) burning++;
    if (s.chillT > 0) chilled++;
    if (s.corrode > 0) corroded++;
    if (s.stunT > 0) stunned++;
  }
  if (!burning && !chilled && !corroded && !stunned) return;

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

  if (stunned) {
    ctx.strokeStyle = 'rgba(244, 255, 82, 0.95)';
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.stunT <= 0 || !visible(e, e.radius * 2.4)) continue;
      // Bolts re-roll ~12 times a second (from the stun clock), so the crackle flickers in place.
      const frame = Math.floor(s.stunT * 12);
      const bolts = s.stunLong ? 4 : 3;
      const r0 = e.radius * 0.7;
      const r1 = e.radius * 1.55 + 4;
      for (let k = 0; k < bolts; k++) {
        const a = (k / bolts) * Math.PI * 2 + crackle(e, k, frame) * 1.6;
        const c = Math.cos(a), d = Math.sin(a);
        // A three-segment zigzag from inside the hull out past its rim.
        const j1 = (crackle(e, k + 7, frame) - 0.5) * e.radius * 0.7;
        const j2 = (crackle(e, k + 13, frame) - 0.5) * e.radius * 0.7;
        const m1 = r0 + (r1 - r0) * 0.38, m2 = r0 + (r1 - r0) * 0.7;
        ctx.moveTo(e.x + c * r0, e.y + d * r0);
        ctx.lineTo(e.x + c * m1 - d * j1, e.y + d * m1 + c * j1);
        ctx.lineTo(e.x + c * m2 - d * j2, e.y + d * m2 + c * j2);
        ctx.lineTo(e.x + c * r1, e.y + d * r1);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}
