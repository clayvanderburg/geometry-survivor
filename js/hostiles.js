// Campaign hostiles (see js/wave-plan.js): enemy types that debut alongside a boss. Same contract as
// js/archetypes.js: stats, per-tick AI, a body silhouette traced inside EnemyManager's two-pass stroke
// and an optional world-space overlay.
//   MAYFLY — tiny, twitchy bugs in big clouds; one tap kills them, standing still is what hurts.
//   HULK   — the old Prismatic Dreadnought hull, demoted to a slow, armored bullet sponge.
//   SERPENT — a winding head with a body that blocks shots (js/serpents.js); kill the head.
//   KESTREL — darts in V formation making strafing runs (js/squadrons.js); kill the leader to scatter them.
//   CARRIER — hangs back at range and launches homing DRONES (tiny kamikazes that burn out after a while).
//   GATE    — two pylons and a beam (js/gates.js): fly through the beam to detonate it, shoot the hub to break it.
//   MITOSIS — a cell that slowly grows and, at full size, splits in two. Kill it early.
//   REPULSOR — a field that shoves your bullets away, guarding itself and whatever stands inside it.
//   LANCER  — plants itself, telegraphs a line, then fires a sweeping beam (js/lancers.js).
//   BORER   — tunnels through rock, bore-charges down a marked lane and spits gravel while it digs (js/borers.js).
//   HATCHERY — a slow armored hive that breeds HATCHLINGS (circling dive-bombers) until killed (js/hatcheries.js).
// Timers are seconds; speeds and steering are px per fixed 60 Hz tick, like the rest of the sim.
import { unlockWaveOf } from './wave-plan.js';
import { SERPENT, windToward } from './serpents.js';
import { KESTREL, updateKestrel, traceKestrel } from './squadrons.js';
import { turnToward } from './serpents.js';
import { GATE, updateGate, traceGate, drawGateBeam } from './gates.js';
import { LANCE, lanceCycle, traceLancer, drawLanceAim, drawBeam } from './lancers.js';
import { BORER, updateBorer, traceBorer, drawBoreLane } from './borers.js';
import { HATCHERY, updateHatchery, updateHatchling, traceHatchery, traceHatchling, drawIncubation, drawDiveCue } from './hatcheries.js';
import { hpRingAlpha } from './archetypes.js';

export const CARRIER = { range: 430, band: 70, launchEvery: 3.2, launch: 2, maxDrones: 6 };
export const DRONE = { speed: 4.3, turnRate: 2.6, life: 7, launchKick: 3.5 };
export const MITOSIS = { growTime: 7, maxScale: 1.8, cap: 26, wobble: 0.35 };
// push: max heading swing per tick (rad) at the core. Each bolt turned drains 1 charge; at 0 the field
// overloads (down for `overload` s), then comes back full.
export const REPULSOR = { field: 125, push: 0.55, hold: 300, charge: 12, overload: 2.5 };

export const MAYFLY = { jitterMin: 0.12, jitterMax: 0.38, spread: 1.25, burst: 1.6 };
export const HULK = { knockMult: 0.1, contactMult: 1.8 };

// Intel card text for a hostile's first appearance in a run (same shape as ARCHETYPE_INFO).
export const HOSTILE_INFO = {
  mayfly: { label: 'MAYFLY', unlockWave: unlockWaveOf('mayfly'), intro: 'TINY TWITCHY CLOUDS · ONE HIT EACH — KEEP MOVING, SWEEP THEM' },
  hulk: { label: 'HULK', unlockWave: unlockWaveOf('hulk'), intro: 'SLOW ARMORED SPONGE · SOAKS SHOTS AND BLOCKS LANES — KITE AROUND IT' },
  serpent: { label: 'SERPENT', unlockWave: unlockWaveOf('serpent'), intro: 'ONLY THE HEAD TAKES DAMAGE · THE BODY BLOCKS SHOTS — AIM FOR THE HEAD' },
  kestrel: { label: 'KESTREL WING', unlockWave: unlockWaveOf('kestrel'), intro: 'V FORMATIONS ON STRAFING RUNS · SIDESTEP THE LINE — DOWN THE LEADER TO SCATTER THEM' },
  carrier: { label: 'CARRIER', unlockWave: unlockWaveOf('carrier'), intro: 'HANGS BACK AND LAUNCHES HOMING DRONES — CHASE IT DOWN OR OUTRUN THE DRONES' },
  gate: { label: 'LASER GATE', unlockWave: unlockWaveOf('gate'), intro: 'FLY THROUGH THE BEAM TO DETONATE IT · THE PYLONS HURT — LURE A CROWD CLOSE FIRST' },
  repulsor: { label: 'REPULSOR', unlockWave: unlockWaveOf('repulsor'), intro: 'ITS FIELD SHOVES BULLETS AWAY · USE AREA DAMAGE, ARCS, MISSILES OR A DASH NOVA' },
  lancer: { label: 'LANCER', unlockWave: unlockWaveOf('lancer'), intro: 'AIMS A LINE, LOCKS (RED), THEN SWEEPS A BEAM — STEP OFF THE LINE, NOT ALONG IT' },
  borer: { label: 'BORER', unlockWave: unlockWaveOf('borer'), intro: 'TUNNELS THROUGH ROCK · CHARGES DOWN A MARKED LANE · SPITS GRAVEL WHILE IT DIGS — DON\'T HIDE BEHIND ROCK' },
  hatchery: { label: 'HATCHERY', unlockWave: unlockWaveOf('hatchery'), intro: 'BREEDS DIVING HATCHLINGS UNTIL IT DIES · KILL THE HIVE AND ITS BROOD DIES WITH IT' },
  mitosis: { label: 'MITOSIS CELL', unlockWave: unlockWaveOf('mitosis'), intro: 'GROWS, THEN SPLITS IN TWO · KILL IT WHILE IT IS SMALL' },
  hatchling: { label: 'HATCHLING', unlockWave: unlockWaveOf('hatchling'), intro: 'CIRCLES, FLARES, THEN DIVES THROUGH YOU · SIDESTEP THE DIVE' },
  drone: { label: 'DRONE', unlockWave: unlockWaveOf('drone'), intro: 'HOMING KAMIKAZE FROM A CARRIER · BURNS OUT AFTER A FEW SECONDS — KEEP MOVING' }
};

export const isHostileKind = (type) => Object.hasOwn(HOSTILE_INFO, type);

export function hostileKindStats(type, waveScale) {
  switch (type) {
    case 'mayfly':
      return {
        hp: 4 * waveScale, maxHp: 4 * waveScale,
        speed: 4.1 + Math.min(1.6, waveScale * 0.12),
        radius: 6, sides: 3, hue: 62, // Electric lime
        score: 12, xp: 1, vRot: 0.2, contactMult: 0.5
      };
    case 'hulk':
      return {
        hp: 300 * waveScale, maxHp: 300 * waveScale,
        speed: 1.0,
        radius: 32, sides: 8, hue: 185, // The Dreadnought's prismatic cyan
        score: 600, xp: 18, vRot: 0.02,
        knockMult: HULK.knockMult, contactMult: HULK.contactMult, sturdy: true
      };
    case 'serpent':
      // The head; body segments take these over in bindSegment (js/serpents.js).
      return {
        hp: 55 * waveScale, maxHp: 55 * waveScale,
        speed: SERPENT.speed + Math.min(0.9, waveScale * 0.06),
        radius: SERPENT.headRadius, sides: 6, hue: 245, // Royal indigo
        score: 140, xp: 6, vRot: 0, sturdy: true, knockMult: 0.4
      };
    case 'kestrel':
      return {
        hp: 24 * waveScale, maxHp: 24 * waveScale,
        speed: KESTREL.speed,
        radius: 11, sides: 3, hue: 30, // Afterburner amber
        score: 70, xp: 3, vRot: 0
      };
    case 'carrier':
      return {
        hp: 110 * waveScale, maxHp: 110 * waveScale,
        speed: 1.25 + Math.min(0.5, waveScale * 0.03),
        radius: 21, sides: 6, hue: 120, // Hangar green
        score: 160, xp: 9, vRot: 0, knockMult: 0.4
      };
    case 'gate':
      return {
        hp: 30 * waveScale, maxHp: 30 * waveScale,
        speed: 1.1,
        radius: 13, sides: 4, hue: 55, // Hazard yellow
        score: 150, xp: 5, vRot: 0, knockMult: 0.2
      };
    case 'mitosis':
      return {
        hp: 22 * waveScale, maxHp: 22 * waveScale,
        speed: 1.5 + Math.min(0.6, waveScale * 0.04),
        radius: 11, sides: 7, hue: 95, // Cytoplasm lime
        score: 50, xp: 2, vRot: 0.02
      };
    case 'repulsor':
      return {
        hp: 45 * waveScale, maxHp: 45 * waveScale,
        speed: 1.5 + Math.min(0.6, waveScale * 0.04),
        radius: 15, sides: 6, hue: 205, // Field azure
        score: 130, xp: 6, vRot: 0.04
      };
    case 'lancer':
      return {
        hp: 40 * waveScale, maxHp: 40 * waveScale,
        speed: 1.9 + Math.min(0.8, waveScale * 0.05),
        radius: 13, sides: 4, hue: 0, // Beam red
        score: 120, xp: 5, vRot: 0
      };
    case 'borer':
      return {
        hp: 95 * waveScale, maxHp: 95 * waveScale,
        speed: 1.55 + Math.min(0.6, waveScale * 0.04),
        radius: 18, sides: 3, hue: 34, // Drill-bit bronze
        score: 150, xp: 8, vRot: 0, knockMult: BORER.knockMult, contactMult: 1.3, sturdy: true
      };
    case 'hatchery':
      return {
        hp: 240 * waveScale, maxHp: 240 * waveScale,
        speed: 0.9,
        radius: 26, sides: 6, hue: 8, // Brood scarlet
        score: 400, xp: 14, vRot: 0.006, knockMult: HATCHERY.knockMult, contactMult: 1.2, sturdy: true
      };
    case 'hatchling':
      return {
        hp: 5 * waveScale, maxHp: 5 * waveScale,
        speed: 4.4,
        radius: 8, sides: 4, hue: 8,
        score: 6, xp: 0, vRot: 0, contactMult: 0.45
      };
    case 'drone':
      return {
        hp: 6 * waveScale, maxHp: 6 * waveScale,
        speed: DRONE.speed,
        radius: 7, sides: 3, hue: 120,
        score: 8, xp: 0, vRot: 0, contactMult: 0.6
      };
    default:
      return null;
  }
}

// Kill-feedback tier (DEATH_FX in main.js).
export const HOSTILE_DEATH_TIER = { mayfly: 0, hulk: 3, serpent: 1, kestrel: 1, carrier: 2, drone: 0, gate: 2, mitosis: 1, repulsor: 2, lancer: 1, borer: 2, hatchery: 3, hatchling: 0 };

// Fast movers that leave a neon ribbon.
export const HOSTILE_TRAILS = new Set(['mayfly', 'kestrel', 'drone', 'hatchling']);

function updateMayfly(e, m, env) {
  const { dirX, dirY, dt } = env;
  // Every fraction of a second it snaps to a new heading within ±spread of the ship, with a kick:
  // jittery, hard to lead, but always drifting your way.
  if (e.aiTimer > MAYFLY.jitterMax) e.aiTimer = 0; // fresh spawn: pick a heading at once
  e.aiTimer -= dt;
  if (e.aiTimer <= 0) {
    e.aiTimer = MAYFLY.jitterMin + Math.random() * (MAYFLY.jitterMax - MAYFLY.jitterMin);
    e.aimAngle = Math.atan2(env.moveY, env.moveX) + (Math.random() * 2 - 1) * MAYFLY.spread;
    e.vx += Math.cos(e.aimAngle) * MAYFLY.burst;
    e.vy += Math.sin(e.aimAngle) * MAYFLY.burst;
  }
  e.vx = (e.vx + Math.cos(e.aimAngle) * 0.25 + dirX * 0.05) * 0.93;
  e.vy = (e.vy + Math.sin(e.aimAngle) * 0.25 + dirY * 0.05) * 0.93;
}

function updateHulk(e, m, env) {
  e.vx = (e.vx + env.moveX * 0.12 + env.sepX) * 0.92;
  e.vy = (e.vy + env.moveY * 0.12 + env.sepY) * 0.92;
}

function updateSerpent(e, m, env) {
  windToward(e, env, { speed: e.speed });
}

// Holds ~CARRIER.range from the ship, strafing, and launches drones from both flanks.
function updateCarrier(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  const radial = dist > CARRIER.range + CARRIER.band ? 1 : dist < CARRIER.range - CARRIER.band ? -1 : 0;
  const strafe = e.strafeSign * 0.06;
  const rx = radial > 0 ? env.moveX : dirX;
  const ry = radial > 0 ? env.moveY : dirY;
  e.vx = (e.vx + rx * radial * 0.18 - dirY * strafe + env.sepX) * 0.92;
  e.vy = (e.vy + ry * radial * 0.18 + dirX * strafe + env.sepY) * 0.92;
  e.rotation = turnToward(e.rotation, Math.atan2(dirY, dirX), 1.5 * dt);
  e.aiTimer -= dt * e.cadence;
  if (e.aiTimer <= 0) {
    e.aiTimer = CARRIER.launchEvery;
    launchDrones(e, m, CARRIER.launch, CARRIER.maxDrones, m.waveScaleFor('drone', m.wave));
  }
}

// Launch up to `n` drones out of a hull's flanks while it has fewer than `cap` alive. Shared with the
// Hive Carrier's bays (js/bosses.js).
export function launchDrones(e, m, n, cap, waveScale) {
  let alive = 0;
  for (const o of m.enemies) if (o.parent === e && !o.dead) alive++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.parent === e) alive++;
  for (let k = 0; k < n && alive < cap; k++, alive++) {
    const side = k % 2 === 0 ? 1 : -1;
    const a = e.rotation + side * Math.PI / 2;
    m.queueSpawn('drone', e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, waveScale, {
      instant: true, vx: Math.cos(a) * DRONE.launchKick, vy: Math.sin(a) * DRONE.launchKick,
      attach: { parent: e, aimAngle: a, lifeT: DRONE.life }
    });
  }
}

// Wobbles toward the ship while it grows (radius and max HP scale up together); at full size it splits:
// it shrinks back and a twin buds off beside it, unless the field already holds MITOSIS.cap cells.
function updateMitosis(e, m, env) {
  const { dt } = env;
  e.baseRadius ||= e.radius;
  e.baseMaxHp ||= e.maxHp;
  e.growT = (e.growT || 0) + dt;
  const k = Math.min(1, e.growT / MITOSIS.growTime);
  const scale = 1 + (MITOSIS.maxScale - 1) * k;
  const maxHp = e.baseMaxHp * scale;
  e.hp += maxHp - e.maxHp; // growing heals by the same amount the max rises
  e.maxHp = maxHp;
  e.radius = e.baseRadius * scale;
  const w = Math.sin(e.pulsePhase * 0.5) * MITOSIS.wobble;
  e.vx = (e.vx + (env.moveX - env.dirY * w) * 0.12 + env.sepX) * 0.93;
  e.vy = (e.vy + (env.moveY + env.dirX * w) * 0.12 + env.sepY) * 0.93;
  if (k < 1) return;
  let cells = 0;
  for (const o of m.enemies) if (o.type === 'mitosis' && !o.dead) cells++;
  for (const sp of m.spawnIndicators) if (sp.type === 'mitosis') cells++;
  if (cells >= MITOSIS.cap) return; // crowded: it stays big until room frees up
  const a = Math.random() * Math.PI * 2;
  const frac = Math.max(0.2, e.hp / e.maxHp);
  e.growT = 0;
  e.maxHp = e.baseMaxHp;
  e.hp = e.baseMaxHp * frac;
  e.radius = e.baseRadius;
  e.knockX += Math.cos(a) * 3;
  e.knockY += Math.sin(a) * 3;
  m.queueSpawn('mitosis', e.x - Math.cos(a) * e.radius, e.y - Math.sin(a) * e.radius, m.waveScaleFor('mitosis', m.wave), {
    instant: true, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3
  });
}

// Closes to lance range and plants itself to aim and fire; strafes while it waits.
function updateLancer(e, m, env) {
  const { dirX, dirY, dist } = env;
  if (lanceCycle(e, env)) {
    e.vx *= 0.85;
    e.vy *= 0.85;
    e.rotation = e.lanceAngle;
    return;
  }
  const radial = dist > LANCE.range + LANCE.band ? 0.22 : dist < LANCE.range - LANCE.band ? -0.18 : 0;
  e.vx = (e.vx + (radial > 0 ? env.moveX : dirX) * radial - dirY * e.strafeSign * 0.08 + env.sepX) * 0.9;
  e.vy = (e.vy + (radial > 0 ? env.moveY : dirY) * radial + dirX * e.strafeSign * 0.08 + env.sepY) * 0.9;
  e.rotation = Math.atan2(dirY, dirX);
}

// Escorts the pack at mid range (its field is a shield for whatever stands in it).
function updateRepulsor(e, m, env) {
  const { dirX, dirY, dist } = env;
  if (e.repelFlash > 0) e.repelFlash = Math.max(0, e.repelFlash - env.dt * 4);
  if (e.fieldCharge === undefined) e.fieldCharge = REPULSOR.charge;
  if (e.overloadT > 0) {
    e.overloadT -= env.dt;
    if (e.overloadT <= 0) e.fieldCharge = REPULSOR.charge;
  }
  const radial = dist > REPULSOR.hold + 60 ? 0.14 : dist < REPULSOR.hold - 60 ? -0.12 : 0;
  e.vx = (e.vx + (radial > 0 ? env.moveX : dirX) * radial - dirY * e.strafeSign * 0.05 + env.sepX) * 0.92;
  e.vy = (e.vy + (radial > 0 ? env.moveY : dirY) * radial + dirX * e.strafeSign * 0.05 + env.sepY) * 0.92;
}

// Homes on the ship with a limited turn rate; burns out (no reward) after DRONE.life seconds.
function updateDrone(e, m, env) {
  e.lifeT = (e.lifeT ?? DRONE.life) - env.dt;
  if (e.lifeT <= 0 && !e.doomQueued) {
    e.doomQueued = true;
    e.noReward = true;
    m.doomed.push(e);
  }
  e.aimAngle = turnToward(e.aimAngle, Math.atan2(env.moveY, env.moveX), DRONE.turnRate * env.dt);
  e.vx += (Math.cos(e.aimAngle) * e.speed - e.vx) * 0.12;
  e.vy += (Math.sin(e.aimAngle) * e.speed - e.vy) * 0.12;
  e.rotation = Math.atan2(e.vy, e.vx);
}

const AI = { mayfly: updateMayfly, hulk: updateHulk, serpent: updateSerpent, kestrel: updateKestrel, carrier: updateCarrier, drone: updateDrone, gate: updateGate, mitosis: updateMitosis, repulsor: updateRepulsor, lancer: updateLancer, borer: updateBorer, hatchery: updateHatchery, hatchling: updateHatchling };

// Returns true when the type is driven here (EnemyManager skips its legacy steering).
export function updateHostileKind(e, m, env) {
  const ai = AI[e.type];
  if (!ai) return false;
  ai(e, m, env);
  return true;
}

export function traceHostileKind(ctx, e, r) {
  if (e.type === 'mayfly') {
    // A dart with two flickering wings; veterans grow extra wing pairs.
    const flap = 0.55 + Math.sin(e.pulsePhase * 4) * 0.35;
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r * 0.9, r * 0.45);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r * 0.9, -r * 0.45);
    ctx.closePath();
    const pairs = e.tier || 1;
    for (let k = 0; k < pairs; k++) {
      const x = r * (0.3 - k * 0.45);
      ctx.moveTo(x, 0);
      ctx.lineTo(x - r * 0.4, r * (1.2 + k * 0.2) * flap);
      ctx.moveTo(x, 0);
      ctx.lineTo(x - r * 0.4, -r * (1.2 + k * 0.2) * flap);
    }
  } else if (e.type === 'kestrel') {
    traceKestrel(ctx, r);
  } else if (e.type === 'carrier') {
    // A long hexagonal hull with two flank hangar doors and a bridge.
    ctx.moveTo(r * 1.3, 0);
    ctx.lineTo(r * 0.7, r * 0.8);
    ctx.lineTo(-r * 0.9, r * 0.8);
    ctx.lineTo(-r * 1.2, 0);
    ctx.lineTo(-r * 0.9, -r * 0.8);
    ctx.lineTo(r * 0.7, -r * 0.8);
    ctx.closePath();
    ctx.rect(-r * 0.5, r * 0.45, r * 0.8, r * 0.35);
    ctx.rect(-r * 0.5, -r * 0.8, r * 0.8, r * 0.35);
    ctx.moveTo(r * 0.75, 0);
    ctx.arc(r * 0.6, 0, r * 0.15, 0, Math.PI * 2);
  } else if (e.type === 'gate') {
    traceGate(ctx, e, r);
  } else if (e.type === 'lancer') {
    traceLancer(ctx, r);
  } else if (e.type === 'borer') {
    traceBorer(ctx, e, r);
  } else if (e.type === 'hatchery') {
    traceHatchery(ctx, e, r);
  } else if (e.type === 'hatchling') {
    traceHatchling(ctx, e, r);
  } else if (e.type === 'repulsor') {
    polygon(ctx, 6, r, 0);
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    }
    ctx.moveTo(r * 0.3, 0);
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  } else if (e.type === 'mitosis') {
    traceCell(ctx, e, r);
  } else if (e.type === 'drone') {
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r, r * 0.8);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r, -r * 0.8);
    ctx.closePath();
  } else if (e.type === 'hulk') {
    // The Dreadnought's octagon with a counter-rotating inner core and four armor ribs.
    polygon(ctx, 8, r, 0);
    polygon(ctx, 8, r * 0.55, -e.rotation * 3);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 8;
      ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
  }
}

// Post-hit HP ring for the hulk, so "this one takes a while" reads.
export function drawHostileOverlay(ctx, e, r) {
  if (e.type === 'borer') {
    drawBoreLane(ctx, e);
    if (e.isLieutenant || e.hp >= e.maxHp) return;
  } else if (e.type === 'hatchery') {
    drawIncubation(ctx, e, r);
    if (e.isLieutenant || e.hp >= e.maxHp) return;
  } else if (e.type === 'hatchling') {
    drawDiveCue(ctx, e, r);
    return;
  } else if (e.type === 'lancer') {
    drawLanceAim(ctx, e);
    if (e.beam) drawBeam(ctx, e.beam, e.hue);
    return;
  }
  if (e.type === 'repulsor') {
    // The field: a rippling dashed bubble that flares when it turns a shot and dims as it drains;
    // overloaded, only a sputtering stub of it shows.
    if (e.overloadT > 0) {
      ctx.strokeStyle = `hsla(${e.hue}, 60%, 60%, ${0.15 + Math.random() * 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    const flare = (e.repelFlash || 0) * (0.4 + 0.6 * (e.fieldCharge ?? REPULSOR.charge) / REPULSOR.charge);
    ctx.strokeStyle = `hsla(${e.hue}, 100%, ${70 + flare * 20}%, ${0.25 + flare * 0.5})`;
    ctx.lineWidth = 1.6 + flare * 2;
    ctx.beginPath();
    const R = REPULSOR.field * (1 + Math.sin(e.pulsePhase * 0.7) * 0.03);
    for (let k = 0; k < 20; k++) {
      const a0 = (k / 20) * Math.PI * 2 + e.pulsePhase * 0.1;
      ctx.moveTo(e.x + Math.cos(a0) * R, e.y + Math.sin(a0) * R);
      ctx.arc(e.x, e.y, R, a0, a0 + 0.18);
    }
    ctx.stroke();
    return;
  }
  if (e.type === 'gate') {
    drawGateBeam(ctx, e);
    return;
  }
  if ((e.type !== 'hulk' && e.type !== 'borer' && e.type !== 'hatchery') || e.isLieutenant || e.hp >= e.maxHp) return;
  const pct = Math.max(0, e.hp / e.maxHp);
  ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${hpRingAlpha(e)})`;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 1.3 + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  ctx.stroke();
}

// A wobbling membrane round one nucleus that pinches into two as the cell nears its split.
export function traceCell(ctx, e, r) {
  const k = Math.min(1, (e.growT || 0) / MITOSIS.growTime);
  const n = 14;
  for (let s = 0; s <= n; s++) {
    const a = (s / n) * Math.PI * 2;
    const pinch = 1 - 0.25 * k * k * Math.abs(Math.sin(a)); // waist forms across the split axis
    const wob = 1 + Math.sin(a * 3 + e.pulsePhase) * 0.06;
    const x = Math.cos(a) * r * wob * (1 + 0.15 * k);
    const y = Math.sin(a) * r * wob * pinch;
    if (s === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  const off = r * 0.45 * k;
  for (const x of off > 1 ? [off, -off] : [0]) {
    ctx.moveTo(x + r * 0.3, 0);
    ctx.arc(x, 0, r * 0.3, 0, Math.PI * 2);
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
