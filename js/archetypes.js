// Combat-breadth enemy archetypes: each has its own silhouette, movement AND attack, not just more HP.
//   BRUISER  — slow, heavy, shrugs off knockback; winds up, then charges down a telegraphed lane.
//   GUNNER   — holds range and fires slow plasma orbs after a visible aim (js/enemy-bullets.js).
//   SHIELDER — frontal shield plates eat projectiles; flank it or use area damage.
//   BLINKER  — shimmers, marks its landing point with a reticle and tether, then teleports to your flank.
//   CONDUIT  — support: beams link nearby allies (less damage taken, more speed). Kill it first.
// Timers are seconds; speeds and steering are px per fixed 60 Hz tick, like the rest of the sim.
import { TUNING } from './config.js';
import { enemyKind } from './run-stats.js';
import { unlockWaveOf } from './wave-plan.js';

// Introduced on boss waves (js/wave-plan.js): a type never spawns before its unlock wave, and its first
// spawn in a run shows an intel card.
export const ARCHETYPE_INFO = {
  bruiser: { label: 'BRUISER', unlockWave: unlockWaveOf('bruiser'), intro: 'HEAVY HULL · CHARGES DOWN A MARKED LANE — SIDESTEP IT' },
  gunner: { label: 'GUNNER', unlockWave: unlockWaveOf('gunner'), intro: 'HOLDS RANGE · FIRES SLOW PLASMA ORBS — DODGE OR HIDE BEHIND ROCK' },
  shielder: { label: 'AEGIS SHIELDER', unlockWave: unlockWaveOf('shielder'), intro: 'FRONT PLATES BLOCK SHOTS — FLANK IT OR USE AREA DAMAGE' },
  blinker: { label: 'BLINKER', unlockWave: unlockWaveOf('blinker'), intro: 'FLICKERS, THEN TELEPORTS TO THE MARKED RING — KEEP MOVING' },
  conduit: { label: 'CONDUIT', unlockWave: unlockWaveOf('conduit'), intro: 'LINKED ALLIES TAKE 30% LESS DAMAGE AND MOVE 20% FASTER — KILL IT FIRST' }
};

// Kill-feedback tiers (see DEATH_FX in main.js): heavy hulls die harder than skirmishers.
export const ARCHETYPE_DEATH_TIER = { bruiser: 2, gunner: 1, shielder: 2, blinker: 1, conduit: 2 };

// Durable hulls show a thin HP ring for a moment after each hit, so "this one takes longer" reads.
export const HP_RING_TYPES = new Set(['splitter', 'bruiser', 'shielder', 'conduit']);

export const BRUISER = { windup: 0.8, charge: 0.5, recover: 0.9, cooldown: 3.2, chargeSpeed: 8.5, triggerRange: 380, knockMult: 0.25, turnRate: 2.2 };
export const GUNNER = { range: 380, band: 60, aimTime: 0.6, cooldown: 2.6, fireRange: 720, volleySpread: 0.2 };
export const SHIELDER = { arcHalf: 1.05, turnRate: 0.9, plateGap: 11, plates: 3 };
// telegraph: 1.0 s (was 0.6). In a dense late wave a pilot needs ~0.3 s to spot the reticle and ~0.25 s
// to react; at 0.6 s that left almost no time to move, at 1.0 s it leaves ~0.45 s (~130 px at base
// speed), enough to step off the landing line without making the blink harmless.
// landClear: the ship can drift onto the marked point during the wind-up, so the arrival is pushed out
// to at least this far from the ship, and arriveGrace keeps the hull from dealing contact damage for a
// moment after it lands: the blink itself never hits, only the lunge that follows.
export const BLINKER = { cooldown: 2.6, telegraph: 1.0, minDist: 130, maxDist: 250, lunge: 1.6, landClear: 110, arriveGrace: 0.25 };
export const CONDUIT = { linkRadius: 240, maxLinks: 4, armor: 0.3, haste: 0.2, keepAway: 320, linkHold: 0.25 };

// Archetypes a lieutenant can be built from at this wave (fodder and vortexes never lead).
export function lieutenantTypes(wave) {
  const types = ['pinwheel', 'weaver', 'splitter'];
  for (const type of Object.keys(ARCHETYPE_INFO)) {
    if (wave >= ARCHETYPE_INFO[type].unlockWave) types.push(type);
  }
  return types;
}

export function isArchetype(type) {
  return Object.hasOwn(ARCHETYPE_INFO, type);
}

export function archetypeStats(type, waveScale) {
  switch (type) {
    case 'bruiser':
      return {
        hp: 150 * waveScale, maxHp: 150 * waveScale,
        speed: 1.15 + Math.min(0.6, waveScale * 0.05),
        radius: 25, sides: 5, hue: 18, // Molten orange-red
        score: 140, xp: 11, vRot: 0,
        knockMult: BRUISER.knockMult, contactMult: 1.5, sturdy: true
      };
    case 'gunner':
      return {
        hp: 36 * waveScale, maxHp: 36 * waveScale,
        speed: 2.0 + Math.min(1.0, waveScale * 0.06),
        radius: 14, sides: 4, hue: 95, // Acid chartreuse
        score: 80, xp: 3, vRot: 0
      };
    case 'shielder':
      return {
        hp: 70 * waveScale, maxHp: 70 * waveScale,
        speed: 1.45 + Math.min(0.8, waveScale * 0.06),
        radius: 17, sides: 6, hue: 205, // Azure
        score: 110, xp: 6, vRot: 0,
        shieldArc: SHIELDER.arcHalf
      };
    case 'blinker':
      return {
        hp: 26 * waveScale, maxHp: 26 * waveScale,
        speed: 2.7 + Math.min(1.4, waveScale * 0.1),
        radius: 12, sides: 4, hue: 300, // Orchid
        score: 75, xp: 3, vRot: 0.06
      };
    case 'conduit':
      return {
        hp: 60 * waveScale, maxHp: 60 * waveScale,
        speed: 1.8,
        radius: 15, sides: 3, hue: 165, // Aqua
        score: 120, xp: 5, vRot: 0.03
      };
    default:
      return null;
  }
}

// Damage multiplier from armor (lieutenant modifier) and a Conduit link. Bosses/fodder: 1.
export function damageTakenMult(e) {
  return (1 - (e.armor || 0)) * (e.linked > 0 ? 1 - CONDUIT.armor : 1);
}

// Speed cap this tick: charge bursts override it, Conduit links add haste.
export function speedCap(e) {
  return (e.burstSpeed || e.speed) * (e.linked > 0 ? 1 + CONDUIT.haste : 1);
}

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function turnToward(current, target, maxStep) {
  const d = wrapAngle(target - current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

// True when a projectile reaching (hx, hy) on the shield ring while moving (vx, vy) hits a plate.
// Plates cover ±shieldArc around shieldAngle; shots from the flanks or behind reach the hull.
export function shieldBlocks(e, hx, hy, vx, vy) {
  if (!e.shieldArc) return false;
  const ox = hx - e.x;
  const oy = hy - e.y;
  if (ox * vx + oy * vy >= 0) return false; // must be travelling inward
  return Math.abs(wrapAngle(Math.atan2(oy, ox) - e.shieldAngle)) <= e.shieldArc;
}

// A sturdy hull (Bruiser, Lieutenant) survives ramming the ship: it bounces off instead of popping.
export function bounceFromShip(e, px, py) {
  const dx = e.x - px;
  const dy = e.y - py;
  const d = Math.hypot(dx, dy) || 1;
  e.knockX = (dx / d) * 4;
  e.knockY = (dy / d) * 4;
  e.vx *= 0.2;
  e.vy *= 0.2;
  if (e.type === 'bruiser' && e.state === 'charge') endCharge(e);
}

function endCharge(e) {
  e.state = 'recover';
  e.aiTimer = BRUISER.recover;
  e.burstSpeed = 0;
  e.knockMult = e.baseKnockMult;
}

export function bruiserChargeLength(e) {
  return BRUISER.chargeSpeed * (e.speedScale || 1) * BRUISER.charge * 60;
}

// --- Per-type AI. `env` is reused by EnemyManager every tick: { player, dirX, dirY, moveX, moveY, dist, dt,
//     sepX, sepY, grid, particles, width, height }. dirX/dirY point straight at the ship (aim, shields);
//     moveX/moveY are the approach direction bent round blocking rock (js/pursuit.js), used to close in.
//     `m` is the EnemyManager (enemyIndex, enemyBullets, terrain).

function updateBruiser(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  const toPlayer = Math.atan2(dirY, dirX);
  e.aiTimer -= dt * (e.state === 'advance' ? e.cadence : 1);
  if (e.state === 'advance') {
    e.aimAngle = turnToward(e.aimAngle, toPlayer, BRUISER.turnRate * dt);
    e.vx = (e.vx + env.moveX * 0.2 + env.sepX) * 0.9;
    e.vy = (e.vy + env.moveY * 0.2 + env.sepY) * 0.9;
    if (e.aiTimer <= 0 && dist < BRUISER.triggerRange && dist > e.radius + 30) {
      e.state = 'windup';
      e.aiTimer = BRUISER.windup;
    }
  } else if (e.state === 'windup') {
    // Tracks the ship for the first 60% of the wind-up, then the lane locks: sidestep it.
    if (e.aiTimer > BRUISER.windup * 0.4) e.aimAngle = turnToward(e.aimAngle, toPlayer, BRUISER.turnRate * 1.5 * dt);
    e.vx *= 0.8;
    e.vy *= 0.8;
    if (e.aiTimer <= 0) {
      e.state = 'charge';
      e.aiTimer = BRUISER.charge;
      e.burstSpeed = BRUISER.chargeSpeed * (e.speedScale || 1);
      e.knockMult = 0;
      env.grid?.applyImpulse(e.x, e.y, 30, 120, e.hue);
    }
  } else if (e.state === 'charge') {
    e.vx = Math.cos(e.aimAngle) * e.burstSpeed;
    e.vy = Math.sin(e.aimAngle) * e.burstSpeed;
    if (e.aiTimer <= 0) endCharge(e);
  } else {
    // Recover: vents and nearly stops — the punish window.
    e.vx *= 0.85;
    e.vy *= 0.85;
    if (e.aiTimer <= 0) {
      e.state = 'advance';
      e.aiTimer = BRUISER.cooldown * (0.8 + Math.random() * 0.4);
    }
  }
  e.rotation = e.aimAngle;
}

function updateGunner(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  e.aimAngle = turnToward(e.aimAngle, Math.atan2(dirY, dirX), 4 * dt);
  e.rotation = e.aimAngle;
  const radial = dist > GUNNER.range + GUNNER.band ? 1 : dist < GUNNER.range - GUNNER.band ? -1 : 0;
  const strafe = e.strafeSign * (radial === 0 ? 0.2 : 0.08);
  const plant = e.state === 'aim' ? 0.35 : 1;
  // Closing in follows the rock-aware approach; backing off and strafing use the straight line.
  const rx = radial > 0 ? env.moveX : dirX;
  const ry = radial > 0 ? env.moveY : dirY;
  e.vx = (e.vx + (rx * radial * 0.3 - dirY * strafe) * plant + env.sepX) * 0.9;
  e.vy = (e.vy + (ry * radial * 0.3 + dirX * strafe) * plant + env.sepY) * 0.9;

  if (e.state === 'aim') {
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      fireGunner(e, m);
      e.state = 'idle';
      e.aiTimer = GUNNER.cooldown * (0.85 + Math.random() * 0.3);
    }
  } else {
    e.aiTimer -= dt * e.cadence;
    if (e.aiTimer <= 0 && dist < GUNNER.fireRange) {
      e.state = 'aim';
      e.aiTimer = GUNNER.aimTime;
    }
  }
}

function fireGunner(e, m) {
  const pool = m.enemyBullets;
  if (!pool) return;
  const speed = TUNING.enemyBulletSpeed ?? 4.2;
  const dmg = (TUNING.enemyBulletDamage ?? 12) * (e.isLieutenant ? 1.3 : 1);
  const n = e.volley || 1;
  const muzzle = e.radius * 1.5;
  for (let k = 0; k < n; k++) {
    const a = e.aimAngle + (k - (n - 1) / 2) * GUNNER.volleySpread;
    const b = pool.spawn(e.x + Math.cos(e.aimAngle) * muzzle, e.y + Math.sin(e.aimAngle) * muzzle, Math.cos(a) * speed, Math.sin(a) * speed, dmg, e.isLieutenant ? 9 : 7.5);
    if (b) b.from = enemyKind(e); // run stats: who shot the ship
  }
  e.knockX -= Math.cos(e.aimAngle) * 1.2; // recoil
  e.knockY -= Math.sin(e.aimAngle) * 1.2;
  e.hitFlash = Math.max(e.hitFlash, 0.35);
  m.shotsFired = (m.shotsFired || 0) + 1;
}

function updateShielder(e, m, env) {
  e.vx = (e.vx + env.moveX * 0.2 + env.sepX) * 0.9;
  e.vy = (e.vy + env.moveY * 0.2 + env.sepY) * 0.9;
  e.rotation = e.shieldAngle;
}

function updateBlinker(e, m, env) {
  const { dirX, dirY, dist, dt, player } = env;
  if (e.state === 'telegraph') {
    e.vx *= 0.75;
    e.vy *= 0.75;
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      if (!clearLanding(e, m, env)) {
        // The ship's shove left no clear spot: fizzle and try again shortly.
        e.state = 'drift';
        e.aiTimer = 0.4;
        return;
      }
      const fromX = e.x;
      const fromY = e.y;
      e.x = e.blinkX;
      e.y = e.blinkY;
      e.trail.length = 0;
      e.state = 'drift';
      e.aiTimer = BLINKER.cooldown * (0.8 + Math.random() * 0.4);
      e.arriveT = BLINKER.arriveGrace;
      // Lunge out of the blink so the arrival is a threat, not a free target.
      const ldx = player.x - e.x;
      const ldy = player.y - e.y;
      const ld = Math.hypot(ldx, ldy) || 1;
      e.vx = (ldx / ld) * e.speed * BLINKER.lunge;
      e.vy = (ldy / ld) * e.speed * BLINKER.lunge;
      env.particles?.spawnShockwave?.(fromX, fromY, e.radius * 3, e.hue, 2, 0.22, true);
      env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 3.2, e.hue, 3, 0.3);
      env.grid?.applyImpulse(e.x, e.y, 18, 90, e.hue);
      env.sound?.playBlinkWarp?.();
    }
    return;
  }
  const swirl = e.strafeSign * 0.24;
  e.vx = (e.vx + env.moveX * 0.32 - dirY * swirl + env.sepX) * 0.9;
  e.vy = (e.vy + env.moveY * 0.32 + dirX * swirl + env.sepY) * 0.9;
  e.aiTimer -= dt * e.cadence;
  if (e.aiTimer <= 0 && dist < 760) {
    if (pickBlinkTarget(e, m, env)) {
      e.state = 'telegraph';
      e.aiTimer = BLINKER.telegraph;
      env.sound?.playBlinkCharge?.();
    } else {
      e.aiTimer = 0.3; // nowhere safe to land: try again shortly
    }
  }
}

// At the moment of the blink: if the ship drifted onto the marked point, push the landing out to
// BLINKER.landClear along the ship → mark line. False when that spot is rock or off the arena.
export function clearLanding(e, m, env) {
  const { player, width, height } = env;
  const dx = e.blinkX - player.x;
  const dy = e.blinkY - player.y;
  const d = Math.hypot(dx, dy);
  if (d >= BLINKER.landClear) return true;
  // Dead on top of the mark: push out on the side the blinker came from.
  const ux = d > 1e-6 ? dx / d : (e.x - player.x) / (Math.hypot(e.x - player.x, e.y - player.y) || 1);
  const uy = d > 1e-6 ? dy / d : (e.y - player.y) / (Math.hypot(e.x - player.x, e.y - player.y) || 1);
  const x = player.x + ux * BLINKER.landClear;
  const y = player.y + uy * BLINKER.landClear;
  const pad = e.radius + 30;
  if (x < pad || y < pad || x > width - pad || y > height - pad) return false;
  if (terrainBlocked(m.terrain, x, y, e.radius + 6)) return false;
  e.blinkX = x;
  e.blinkY = y;
  return true;
}

// Flank landing point: swung 40–85° around the ship, 130–250 px out, clear of rock and walls.
function pickBlinkTarget(e, m, env) {
  const { player, dist, width, height } = env;
  const base = Math.atan2(e.y - player.y, e.x - player.x);
  const r = Math.max(BLINKER.minDist, Math.min(BLINKER.maxDist, dist * 0.55));
  for (let attempt = 0; attempt < 2; attempt++) {
    const side = attempt === 0 ? e.strafeSign : -e.strafeSign;
    const a = base + side * (0.7 + Math.random() * 0.8);
    const x = player.x + Math.cos(a) * r;
    const y = player.y + Math.sin(a) * r;
    const pad = e.radius + 30;
    if (x < pad || y < pad || x > width - pad || y > height - pad) continue;
    if (terrainBlocked(m.terrain, x, y, e.radius + 6)) continue;
    e.blinkX = x;
    e.blinkY = y;
    return true;
  }
  return false;
}

function terrainBlocked(terrain, x, y, r) {
  if (!terrain?.getNearbyAsteroids) return false;
  const rocks = terrain.getNearbyAsteroids(x, y, terrain.cellsFor ? terrain.cellsFor(r) : 1);
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock.hp <= 0) continue;
    const dx = x - rock.x;
    const dy = y - rock.y;
    const min = rock.radius + r;
    if (dx * dx + dy * dy < min * min) return true;
  }
  return false;
}

function updateConduit(e, m, env) {
  const { dirX, dirY, dist } = env;
  // Link the nearest few allies in range (re-asserted every tick; links lapse 0.25 s after breaking).
  e.links.length = 0;
  let cx = 0;
  let cy = 0;
  const reach = CONDUIT.linkRadius;
  for (const other of m.enemyIndex.query(e.x, e.y, reach)) {
    if (other === e || other.dead || other.isBoss || other.type === 'conduit' || other.type === 'blackhole') continue;
    const ox = other.x - e.x;
    const oy = other.y - e.y;
    if (ox * ox + oy * oy > reach * reach) continue;
    other.linked = CONDUIT.linkHold;
    e.links.push(other);
    cx += ox;
    cy += oy;
    if (e.links.length >= CONDUIT.maxLinks) break;
  }
  // Hang back behind its pack: hold ~320 px from the ship and drift toward the linked allies.
  const radial = dist > CONDUIT.keepAway + 60 ? 0.22 : dist < CONDUIT.keepAway - 40 ? -0.3 : 0;
  let ax = (radial > 0 ? env.moveX : dirX) * radial;
  let ay = (radial > 0 ? env.moveY : dirY) * radial;
  if (e.links.length > 0) {
    const n = e.links.length;
    const len = Math.hypot(cx / n, cy / n) || 1;
    if (len > 70) {
      ax += (cx / n / len) * 0.12;
      ay += (cy / n / len) * 0.12;
    }
  }
  e.vx = (e.vx + ax + env.sepX) * 0.9;
  e.vy = (e.vy + ay + env.sepY) * 0.9;
}

const AI = { bruiser: updateBruiser, gunner: updateGunner, shielder: updateShielder, blinker: updateBlinker, conduit: updateConduit };

// Every tick, for every enemy: shield tracking, link decay, regeneration, then the type's own AI.
// Returns true when the type is driven here (EnemyManager skips its legacy steering).
export function updateArchetype(e, m, env) {
  const dt = env.dt;
  if (e.linked > 0) e.linked = Math.max(0, e.linked - dt);
  e.sinceHit = (e.sinceHit || 0) + dt;
  if (e.shieldFlash > 0) e.shieldFlash = Math.max(0, e.shieldFlash - dt * 5);
  if (e.shieldArc) e.shieldAngle = turnToward(e.shieldAngle, Math.atan2(env.dirY, env.dirX), SHIELDER.turnRate * e.cadence * dt);
  if (e.arriveT > 0) e.arriveT = Math.max(0, e.arriveT - dt);
  if (e.regen > 0 && e.sinceHit > 1.5 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.regen * dt);
  const ai = AI[e.type];
  if (!ai) return false;
  ai(e, m, env);
  return true;
}

// --- Drawing -------------------------------------------------------------------------------

// Body silhouette in local (rotated) coordinates; called inside EnemyManager's two-pass stroke.
export function traceArchetype(ctx, e, r) {
  if (e.type === 'bruiser') {
    // Heavy pentagon, inner armor plate and a forward ram.
    polygon(ctx, 5, r, 0);
    polygon(ctx, 5, r * 0.55, 0);
    ctx.moveTo(r * 0.82, -r * 0.5);
    ctx.lineTo(r * 1.32, 0);
    ctx.lineTo(r * 0.82, r * 0.5);
  } else if (e.type === 'gunner') {
    // Squat trapezoid hull with a long twin barrel pointing at the ship.
    ctx.moveTo(r * 0.45, -r * 0.6);
    ctx.lineTo(r * 0.45, r * 0.6);
    ctx.lineTo(-r * 0.85, r * 0.95);
    ctx.lineTo(-r * 0.85, -r * 0.95);
    ctx.closePath();
    ctx.moveTo(r * 0.45, -r * 0.22);
    ctx.lineTo(r * 1.55, -r * 0.22);
    ctx.moveTo(r * 0.45, r * 0.22);
    ctx.lineTo(r * 1.55, r * 0.22);
  } else if (e.type === 'shielder') {
    polygon(ctx, 6, r * 0.85, Math.PI / 6);
    ctx.moveTo(r * 0.3, 0);
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  } else if (e.type === 'blinker') {
    // Four-point star; it collapses toward a dot while the blink charges.
    const k = e.state === 'telegraph' ? 1 - 0.5 * (1 - e.aiTimer / BLINKER.telegraph) : 1;
    const o = r * 1.3 * k;
    const n = r * 0.36 * k;
    ctx.moveTo(o, 0);
    ctx.lineTo(n, n);
    ctx.lineTo(0, o);
    ctx.lineTo(-n, n);
    ctx.lineTo(-o, 0);
    ctx.lineTo(-n, -n);
    ctx.lineTo(0, -o);
    ctx.lineTo(n, -n);
    ctx.closePath();
  } else if (e.type === 'conduit') {
    // Triangle through a ring: a relay pylon.
    ctx.moveTo(r * 0.7, 0);
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    polygon(ctx, 3, r * 1.2, -Math.PI / 2);
  }
}

function polygon(ctx, sides, radius, phase) {
  for (let s = 0; s < sides; s++) {
    const a = phase + (s * Math.PI * 2) / sides;
    if (s === 0) ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    else ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  ctx.closePath();
}

// Links are drawn under the bodies so the beams read as tethers into each ally.
export function drawConduitLinks(ctx, e) {
  if (e.type !== 'conduit' || e.links.length === 0) return;
  const flicker = 0.55 + Math.sin(e.pulsePhase * 2.2) * 0.25;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${e.hue}, 100%, 55%, ${0.22 * flicker})` : `hsla(${e.hue}, 100%, 82%, ${0.75 * flicker})`;
    ctx.lineWidth = pass === 0 ? 5 : 1.4;
    ctx.beginPath();
    for (let i = 0; i < e.links.length; i++) {
      const o = e.links[i];
      if (o.dead) continue;
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(o.x, o.y);
    }
    ctx.stroke();
  }
  // Small diamond on each linked ally marks who is buffed.
  ctx.strokeStyle = `hsla(${e.hue}, 100%, 75%, 0.8)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < e.links.length; i++) {
    const o = e.links[i];
    if (o.dead) continue;
    const d = o.radius + 5;
    ctx.moveTo(o.x + d, o.y);
    ctx.lineTo(o.x, o.y + d);
    ctx.lineTo(o.x - d, o.y);
    ctx.lineTo(o.x, o.y - d);
    ctx.closePath();
  }
  ctx.stroke();
}

// World-space telegraphs and attachments drawn over the body: charge lanes, aim lines, shield
// plates, blink destinations and the post-hit HP ring.
export function drawArchetypeOverlay(ctx, e, r) {
  if (e.type === 'bruiser' && e.state === 'windup') drawChargeLane(ctx, e);
  else if (e.type === 'gunner' && e.state === 'aim') drawGunnerAim(ctx, e);
  else if (e.type === 'blinker' && e.state === 'telegraph') drawBlinkShimmer(ctx, e, r);
  if (e.shieldArc) drawShieldPlates(ctx, e);
  // The HP ring stays up while the hull is damaged: bright for 2 s after a hit, then a dimmer steady ring.
  if (HP_RING_TYPES.has(e.type) && !e.isLieutenant && e.hp < e.maxHp) {
    const pct = Math.max(0, e.hp / e.maxHp);
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${hpRingAlpha(e)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const ringR = e.shieldArc ? e.shieldRadius + 8 : r * 1.45 + 6; // clear of the shield plates
    ctx.arc(e.x, e.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
  }
}

// HP ring opacity: 0.75 right after a hit, easing to a steady 0.35 two seconds later.
export function hpRingAlpha(e) {
  const fresh = Math.max(0, 1 - (e.sinceHit ?? 2) / 2);
  return 0.35 + 0.4 * fresh;
}

function drawChargeLane(ctx, e) {
  const t = 1 - Math.max(0, e.aiTimer) / BRUISER.windup;
  const locked = e.aiTimer <= BRUISER.windup * 0.4;
  const len = bruiserChargeLength(e) + e.radius;
  const w = e.radius;
  const flash = 0.5 + 0.5 * Math.cos(e.aiTimer * Math.PI * (locked ? 16 : 8));
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.aimAngle);
  ctx.strokeStyle = `hsla(${locked ? 0 : e.hue}, 100%, 62%, ${0.25 + t * 0.4 + flash * 0.2})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(e.radius * 0.6, -w, len, w * 2);
  // Chevrons fill the lane from the bruiser outward as the wind-up completes.
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  const count = 4;
  for (let k = 0; k < count; k++) {
    if (k / count > t) break;
    const x = e.radius + (len - e.radius) * ((k + 0.5) / count);
    ctx.moveTo(x - w * 0.45, -w * 0.6);
    ctx.lineTo(x, 0);
    ctx.lineTo(x - w * 0.45, w * 0.6);
  }
  ctx.stroke();
  ctx.restore();
}

function drawGunnerAim(ctx, e) {
  const t = 1 - Math.max(0, e.aiTimer) / GUNNER.aimTime;
  const mx = e.x + Math.cos(e.aimAngle) * e.radius * 1.55;
  const my = e.y + Math.sin(e.aimAngle) * e.radius * 1.55;
  // Dashed sight line toward the ship, brightening as the shot charges.
  ctx.strokeStyle = `hsla(14, 100%, 62%, ${0.15 + t * 0.5})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const d0 = 12 + k * 26;
    ctx.moveTo(mx + Math.cos(e.aimAngle) * d0, my + Math.sin(e.aimAngle) * d0);
    ctx.lineTo(mx + Math.cos(e.aimAngle) * (d0 + 13), my + Math.sin(e.aimAngle) * (d0 + 13));
  }
  ctx.stroke();
  // Charging orb at the muzzle.
  ctx.fillStyle = `hsla(14, 100%, ${60 + t * 30}%, ${0.4 + t * 0.6})`;
  ctx.beginPath();
  ctx.arc(mx, my, 2 + t * 5, 0, Math.PI * 2);
  ctx.fill();
}

// Wind-up progress 0..1 and the "locked" last 30% (the reticle turns white and strobes).
function blinkCharge(e) {
  const t = Math.min(1, Math.max(0, 1 - e.aiTimer / BLINKER.telegraph));
  return { t, locked: t >= 0.7 };
}

// Pre-blink shimmer on the hull: a flickering white-hot halo and four sparkle rays that grow as it charges.
function drawBlinkShimmer(ctx, e, r) {
  const { t, locked } = blinkCharge(e);
  const flick = 0.55 + 0.45 * Math.sin(e.aiTimer * (locked ? 70 : 38));
  ctx.strokeStyle = `hsla(${e.hue}, 100%, ${78 + 22 * t}%, ${(0.35 + 0.5 * t) * flick})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * (2.1 - 0.6 * t), 0, Math.PI * 2);
  const ray = r * (1.4 + 1.6 * t);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2 + e.aiTimer * 3;
    ctx.moveTo(e.x + Math.cos(a) * r * 0.9, e.y + Math.sin(a) * r * 0.9);
    ctx.lineTo(e.x + Math.cos(a) * ray, e.y + Math.sin(a) * ray);
  }
  ctx.stroke();
}

// Landing telegraph, drawn above the hulls AND the particles (EnemyManager.drawTopTelegraphs) so a crowd
// or an explosion never hides it: a dark backing disc that cuts the clutter under the mark, a reticle
// ring that closes in and turns white for the last 30%, corner brackets, a filling core, and a
// dark-backed tether with dashes marching from the blinker to the mark.
export function drawBlinkTelegraph(ctx, e) {
  const { t, locked } = blinkCharge(e);
  const ease = 1 - (1 - t) * (1 - t);
  const x = e.blinkX;
  const y = e.blinkY;
  const R = e.radius * (4.4 - 2.2 * ease);
  const strobe = locked ? 0.5 + 0.5 * Math.cos(e.aiTimer * 50) : 1;
  const bright = locked ? `rgba(255, 255, 255, ${0.7 + 0.3 * strobe})` : `hsla(${e.hue}, 100%, 78%, ${0.75 + 0.25 * t})`;
  const dx = x - e.x;
  const dy = y - e.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Tether endpoints stop at the hull and the ring, so the line never crosses either.
  const sx = e.x + ux * e.radius * 1.6;
  const sy = e.y + uy * e.radius * 1.6;
  const ex = x - ux * (R + 4);
  const ey = y - uy * (R + 4);

  // 1. Dark backing: disc under the mark plus a dark under-stroke for the tether and ring.
  ctx.fillStyle = `rgba(3, 2, 10, ${0.45 + 0.2 * t})`;
  ctx.beginPath();
  ctx.arc(x, y, R + 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(3, 2, 10, 0.75)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.moveTo(x + R, y);
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Tether: dashes marching toward the mark, brightening with the charge.
  ctx.strokeStyle = `hsla(${e.hue}, 100%, 80%, ${0.45 + 0.45 * t})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const segLen = len - e.radius * 1.6 - R - 4;
  if (segLen > 0) {
    const dash = 14;
    const phase = ((1 - e.aiTimer) * 90) % (dash * 2);
    for (let d0 = phase - dash * 2; d0 < segLen; d0 += dash * 2) {
      const a0 = Math.max(0, d0);
      const a1 = Math.min(segLen, d0 + dash);
      if (a1 <= a0) continue;
      ctx.moveTo(sx + ux * a0, sy + uy * a0);
      ctx.lineTo(sx + ux * a1, sy + uy * a1);
    }
  }
  ctx.stroke();

  // 3. Filling core: the landing spot fills up as the blink charges.
  ctx.fillStyle = locked ? `rgba(255, 255, 255, ${0.25 + 0.25 * strobe})` : `hsla(${e.hue}, 100%, 70%, ${0.12 + 0.3 * t})`;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, R * (0.2 + 0.55 * ease)), 0, Math.PI * 2);
  ctx.fill();

  // 4. Reticle ring and four corner brackets that rotate in and lock square.
  ctx.strokeStyle = bright;
  ctx.lineWidth = locked ? 3.2 : 2.6;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  const spin = (1 - ease) * 1.6;
  const B = R + 8;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2 + spin;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // A chevron pointing in at the mark.
    ctx.moveTo(x + ca * (B + 7) - sa * 7, y + sa * (B + 7) + ca * 7);
    ctx.lineTo(x + ca * B, y + sa * B);
    ctx.lineTo(x + ca * (B + 7) + sa * 7, y + sa * (B + 7) - ca * 7);
  }
  ctx.stroke();
}

function drawShieldPlates(ctx, e) {
  const R = e.shieldRadius;
  const seg = (e.shieldArc * 2) / SHIELDER.plates;
  const gap = 0.07;
  const hit = e.shieldFlash || 0;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0
      ? `hsla(200, 100%, 60%, ${0.35 + hit * 0.3})`
      : hit > 0.05 ? '#ffffff' : 'hsl(195, 100%, 84%)';
    ctx.lineWidth = pass === 0 ? 7 : 3;
    ctx.beginPath();
    for (let k = 0; k < SHIELDER.plates; k++) {
      const a0 = e.shieldAngle - e.shieldArc + k * seg + gap;
      const a1 = a0 + seg - gap * 2;
      ctx.moveTo(e.x + Math.cos(a0) * R, e.y + Math.sin(a0) * R);
      ctx.arc(e.x, e.y, R, a0, a1);
    }
    ctx.stroke();
  }
}
