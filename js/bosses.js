// Named bosses (see js/wave-plan.js for who leads which wave). Each boss is a definition with:
//   name, epithet, tier ('minor' | 'major'), hue,
//   stats(waveScale)          -> extra config fields over the shared boss base (HP, score, XP, crown)
//   onArrive(e, m)            -> called once as it materializes (spawn its escort)
//   update(e, m, env)         -> per-tick AI (env as in js/archetypes.js)
//   trace(ctx, e, r)          -> body silhouette, local rotated coordinates
//   overlay?(ctx, e, r)       -> world-space extras drawn over the body
//   onDeath?(e, m)            -> called by Game.killEnemy (death bursts)
// A boss wave whose boss is not defined here gets the Prismatic Dreadnought ('boss', js/enemies.js).
// Timers are seconds; speeds and steering are px per fixed 60 Hz tick.
import { TUNING } from './config.js';
import { SERPENT, spawnSerpent, spawnBody, coilPath, windToward, liveOf, turnToward, traceSerpentHead } from './serpents.js';
import { spawnWing, flyRuns, wingmenOf, slotOffset } from './squadrons.js';
import { launchDrones, traceCell } from './hostiles.js';
import { lanceCycle, drawLanceAim, drawBeam, beamFrom } from './lancers.js';

// Shared base: the Dreadnought's numbers. Major bosses carry more HP and pay out more.
export const BOSS_BASE_HP = 650;
export const BOSS_TIER = {
  minor: { hp: 1, score: 1500, xp: 30, cores: 3 },
  major: { hp: 1.8, score: 2600, xp: 50, cores: 5 }
};

export function bossHp(waveScale, tier = 'minor') {
  return BOSS_BASE_HP * waveScale * (TUNING.bossHpMult ?? 1) * (TUNING.campaignBossHpMult ?? 1) * (BOSS_TIER[tier]?.hp ?? 1);
}

// --- Minor-boss presentation (the wave 5/15/25/35/45 bosses) ---------------------------------
// Shared bits for their entrance flourish, phase change and death bloom. Sound cues are procedural
// (js/boss-sfx.js) on the game's SoundEngine (m.sound: null in tests and previews); effects use the
// particles and grid the manager hands its AI each tick (m.aiEnv).
export const BOSS_INTRO = 1.4; // s of entrance halo drawn over a minor boss after it materializes
const cue = (m, name) => m.sound?.playBossCue?.(name);
// Hazard damage (js/boss-telegraphs.js) as a share of a boss's contact hit; the game applies the wave ramp.
const hazardDamage = (share) => (TUNING.bossContactDamage ?? 48) * share;

// The arrival beat: set the halo clock, a ring in the boss's own hue and its entrance sting.
function arriveFx(e, m, sting) {
  e.introT = BOSS_INTRO;
  const env = m.aiEnv || {};
  env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 6, e.hue, 4, 0.6);
  env.particles?.spawnFlash?.(e.x, e.y, e.radius * 3, e.hue, 0.3);
  cue(m, sting);
}

// Half-HP phase change: rings in the boss's hue and a red snap ring, a flash, sparks, a grid shove,
// and the phase stinger. The hull flashes white for a beat (e.phaseFlash, drawn by drawBossFlair).
function phaseShift(e, m, env, reach = 320) {
  e.phaseFlash = 1;
  env.particles?.spawnShockwave?.(e.x, e.y, reach, e.hue, 6, 0.55);
  env.particles?.spawnShockwave?.(e.x, e.y, reach * 0.55, 0, 3, 0.4);
  env.particles?.spawnFlash?.(e.x, e.y, e.radius * 4, e.hue, 0.25);
  env.particles?.spawnExplosionSparks?.(e.x, e.y, 30, e.hue, 3, 14, 2.4);
  env.grid?.applyImpulse?.(e.x, e.y, 70, reach, e.hue);
  cue(m, 'boss_phase');
}

// Death bloom on top of Game.onBossDefeated: a petal burst of sparks in the boss's colours and
// staggered rings, so each minor boss goes out in its own palette.
function deathBloom(e, m, hues, sting) {
  const p = m.aiEnv?.particles;
  hues.forEach((hue, i) => {
    p?.spawnShockwave?.(e.x, e.y, e.radius * (5 + i * 3), hue, 5 - i, 0.5 + i * 0.18);
    p?.spawnExplosionSparks?.(e.x, e.y, 26, hue, 2 + i, 16 + i * 4, 2.6);
  });
  p?.spawnFlash?.(e.x, e.y, e.radius * 6, hues[0], 0.4);
  p?.spawnPolygonShatter?.(e.x, e.y, e.radius * 1.4, e.sides, e.rotation, hues[hues.length - 1], 1.6);
  m.aiEnv?.grid?.ripple?.(e.x, e.y, e.radius * 12, hues[0], 1.4);
  cue(m, sting);
}

// Entrance halo (contracting rings and a crown of ticks while e.introT runs down) and the phase-change
// flash ring. Called from each minor boss's overlay; also ticks the two clocks down.
function drawBossFlair(ctx, e, r, dt = 1 / 60) {
  if (e.introT > 0) {
    const k = e.introT / BOSS_INTRO;
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 75%, ${0.8 * k})`;
    ctx.lineWidth = 2 + 3 * k;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * (1.4 + k * 2.6), 0, Math.PI * 2);
    ctx.moveTo(e.x + r * (1.2 + k * 1.2), e.y);
    ctx.arc(e.x, e.y, r * (1.2 + k * 1.2), 0, Math.PI * 2);
    const n = 12;
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + k * 2;
      const r0 = r * (1.6 + k * 1.8);
      ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
      ctx.lineTo(e.x + Math.cos(a) * (r0 + r * 0.5), e.y + Math.sin(a) * (r0 + r * 0.5));
    }
    ctx.stroke();
    e.introT = Math.max(0, e.introT - dt);
  }
  if (e.phaseFlash > 0) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * e.phaseFlash})`;
    ctx.lineWidth = 3 + 5 * e.phaseFlash;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * (1.2 + (1 - e.phaseFlash) * 2.5), 0, Math.PI * 2);
    ctx.stroke();
    e.phaseFlash = Math.max(0, e.phaseFlash - dt * 1.5);
  }
}

// A locked-on lane telegraph from a hull (the Queen's spear): dashed edges, chevrons filling in.
function drawLaneTell(ctx, x, y, angle, len, width, k, hue = 0) {
  const half = width * 0.5;
  const flash = 0.5 + 0.5 * Math.cos(k * Math.PI * (8 + k * 14));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.04 + k * 0.1})`;
  ctx.fillRect(0, -half, len, width);
  ctx.strokeStyle = `hsla(${hue}, 100%, 62%, ${0.3 + k * 0.45 + flash * 0.2})`;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(0, -half); ctx.lineTo(len, -half);
  ctx.moveTo(0, half); ctx.lineTo(len, half);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  const n = 6;
  for (let s = 0; s < n && s / n <= k; s++) {
    const cx = len * ((s + 0.5) / n);
    ctx.moveTo(cx - half * 0.6, -half * 0.6);
    ctx.lineTo(cx, 0);
    ctx.lineTo(cx - half * 0.6, half * 0.6);
  }
  ctx.stroke();
  ctx.restore();
}

// --- BROOD QUEEN (wave 5, minor) ------------------------------------------------------------
// A giant winged swarmer wrapped in a halo of circling swarmers. Every few seconds the ones nearest
// you peel off: some dive straight in, some circle you first. Her signature is the SWARM SPEAR: she
// screeches, holds still and draws her brood into a line aimed at you behind a red lane, then hurls
// the whole line down it. At half HP the brood scatters, she speeds up, births divers and lobs EGG
// CLUTCHES: three marked circles round you that burst (and hatch) a moment later. She dies in a
// mayfly burst.
export const QUEEN = {
  ring: 16, orbitR: 118, orbitSpin: 1.5, peelEvery: 3.2, peelCount: 5, hatchEvery: 1.3,
  rageAt: 0.5, speed: 2.6, rageSpeed: 3.3, rageSpawnEvery: 1.9, rageSpawn: 2, deathMayflies: 14,
  circleR: 170, circleSpin: 2.2, circleTime: [1.4, 2.4], diveKick: 5, radius: 46,
  // Swarm spear: every spearEvery s (the first after spearFirst), up to spearCount orbiters line up
  // over spearWindup s (the lane locks for the last spearLock s), then fly spearLen px at spearSpeed.
  spearFirst: 5, spearEvery: 7, spearWindup: 1.2, spearLock: 0.35, spearCount: 8, spearGap: 34,
  spearSpeed: 9.5, spearLen: 560, spearWidth: 48,
  // Egg clutch (from half HP): eggs zones of eggR px round the ship, bursting after eggWarn s for
  // eggDamage of her contact hit, each hatching one swarmer.
  eggEvery: 3.6, eggs: 3, eggR: 66, eggSpread: 118, eggWarn: 1.35, eggDamage: 0.4
};

function queenOrbiters(e, m) {
  const out = [];
  for (const o of m.enemies) if (o.anchor === e && !o.dead) out.push(o);
  return out;
}

// Ring size including orbiters still materializing (so a fresh ring is never topped up twice).
function ringSize(e, m) {
  let n = queenOrbiters(e, m).length;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.anchor === e) n++;
  return n;
}

// Spawn one brood swarmer. `orbit` swarmers join her ring; otherwise it dives at the ship.
function hatch(e, m, x, y, orbit, player) {
  const attach = orbit
    ? { anchor: e, orbitA: Math.atan2(y - e.y, x - e.x), orbitR: QUEEN.orbitR * (0.82 + Math.random() * 0.36) }
    : null;
  const extra = { instant: true, attach };
  if (!orbit && player) {
    const a = Math.atan2(player.y - y, player.x - x);
    extra.vx = Math.cos(a) * QUEEN.diveKick;
    extra.vy = Math.sin(a) * QUEEN.diveKick;
  }
  return m.queueSpawn('swarmer', x, y, m.waveScaleFor('swarmer', e.bossWave), extra);
}

// Break an orbiter loose: half dive straight in, half circle the ship for a moment first.
function release(o, player, dive) {
  o.anchor = null;
  o.spearSlot = undefined;
  if (dive) {
    const a = Math.atan2(player.y - o.y, player.x - o.x);
    o.vx = Math.cos(a) * QUEEN.diveKick;
    o.vy = Math.sin(a) * QUEEN.diveKick;
  } else {
    o.circleT = QUEEN.circleTime[0] + Math.random() * (QUEEN.circleTime[1] - QUEEN.circleTime[0]);
    o.circleA = Math.atan2(o.y - player.y, o.x - player.x);
  }
}

// Start a spear: the orbiters nearest the ship take the slots of a line from her nose.
function startSpear(e, m, player) {
  const ring = queenOrbiters(e, m);
  if (ring.length < 3) return false;
  e.state = 'spear';
  e.spearT = QUEEN.spearWindup;
  e.spearAngle = Math.atan2(player.y - e.y, player.x - e.x);
  ring.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
  ring.slice(0, QUEEN.spearCount).forEach((o, k) => { o.spearSlot = k; });
  cue(m, 'queen_screech');
  return true;
}

// Hurl the spear: every slotted orbiter flies down the locked lane at once.
function throwSpear(e, m, env) {
  const c = Math.cos(e.spearAngle);
  const s = Math.sin(e.spearAngle);
  for (const o of queenOrbiters(e, m)) {
    if (o.spearSlot === undefined) continue;
    o.anchor = null;
    o.spearSlot = undefined;
    o.spearFlyT = (QUEEN.spearLen / QUEEN.spearSpeed) / 60;
    o.burstSpeed = QUEEN.spearSpeed * (o.speedScale ?? 1);
    o.vx = c * o.burstSpeed;
    o.vy = s * o.burstSpeed;
  }
  env.particles?.spawnDirectionalSparks?.(e.x + c * e.radius, e.y + s * e.radius, e.spearAngle, 0.5, 18, e.hue, 14);
  env.grid?.applyImpulse?.(e.x, e.y, 40, 200, e.hue);
  cue(m, 'queen_spear');
}

// From half HP: three egg zones round the ship (one under it), each hatching a swarmer as it bursts.
function layClutch(e, m, player) {
  const base = Math.random() * Math.PI * 2;
  for (let k = 0; k < QUEEN.eggs; k++) {
    const a = base + (k / QUEEN.eggs) * Math.PI * 2;
    const d = k === 0 ? 0 : QUEEN.eggSpread;
    const x = player.x + Math.cos(a) * d + (player.vx || 0) * 12;
    const y = player.y + Math.sin(a) * d + (player.vy || 0) * 12;
    m.bossTelegraphs?.zone(x, y, QUEEN.eggR, {
      warn: QUEEN.eggWarn + k * 0.12, hue: 335, damage: hazardDamage(QUEEN.eggDamage), from: e.type,
      onFire: (h) => {
        cue(m, 'egg_pop');
        if (!e.dead) m.queueSpawn('swarmer', h.x, h.y, m.waveScaleFor('swarmer', e.bossWave), { instant: true });
      }
    });
  }
  cue(m, 'egg_toss');
}

const broodQueen = {
  ram: { range: 320, when: (e) => e.state !== 'spear' }, // js/boss-ram.js: the shared telegraphed charge
  name: 'BROOD QUEEN', epithet: 'MOTHER OF THE SWARM', tier: 'minor', hue: 325, debut: ['mayfly'],
  stats: () => ({ speed: QUEEN.speed, radius: QUEEN.radius, sides: 4, vRot: 0 }),
  onArrive(e, m) {
    e.aiTimer = QUEEN.peelEvery;
    e.hatchT = QUEEN.hatchEvery;
    e.spearCd = QUEEN.spearFirst;
    e.state = 'hunt';
    e.enraged = false;
    for (let k = 0; k < QUEEN.ring; k++) {
      const a = (k / QUEEN.ring) * Math.PI * 2;
      hatch(e, m, e.x + Math.cos(a) * QUEEN.orbitR, e.y + Math.sin(a) * QUEEN.orbitR, true);
    }
    arriveFx(e, m, 'queen_screech');
  },
  update(e, m, env) {
    const { dt, player } = env;
    if (e.state === 'spear') {
      // Holding still, the lane tracks the ship, then locks; the spear flies when the windup ends.
      e.vx *= 0.85;
      e.vy *= 0.85;
      e.spearT -= dt;
      if (e.spearT > QUEEN.spearLock) {
        const want = Math.atan2(player.y - e.y, player.x - e.x);
        e.spearAngle = turnToward(e.spearAngle, want, 3 * dt);
      }
      e.rotation = e.spearAngle;
      if (e.spearT <= 0) {
        throwSpear(e, m, env);
        e.state = 'hunt';
        e.spearCd = QUEEN.spearEvery;
        e.aiTimer = Math.max(e.aiTimer, 1.2); // a beat before the next peel
      }
      if (!e.enraged && e.hp > e.maxHp * QUEEN.rageAt) return;
    }
    if (e.state !== 'spear') {
      e.vx = (e.vx + env.moveX * 0.25) * 0.92;
      e.vy = (e.vy + env.moveY * 0.25) * 0.92;
      if (Math.hypot(e.vx, e.vy) > 0.05) e.rotation = Math.atan2(e.vy, e.vx);
    }

    if (!e.enraged && e.hp <= e.maxHp * QUEEN.rageAt) {
      // The brood scatters: every orbiter breaks loose at once (a spear in progress included).
      e.enraged = true;
      e.state = 'hunt';
      e.speed = QUEEN.rageSpeed; // the speed cap applies chill (speedScale) on top
      e.aiTimer = QUEEN.rageSpawnEvery;
      e.eggT = 1.2;
      queenOrbiters(e, m).forEach((o, i) => release(o, player, i % 2 === 0));
      phaseShift(e, m, env, 280);
      cue(m, 'queen_screech');
      return;
    }

    e.aiTimer -= dt;
    if (e.enraged) {
      if (e.aiTimer <= 0) {
        e.aiTimer = QUEEN.rageSpawnEvery;
        for (let k = 0; k < QUEEN.rageSpawn; k++) {
          const a = e.rotation + (k - 0.5) * 1.2;
          hatch(e, m, e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, false, player);
        }
      }
      e.eggT -= dt;
      if (e.eggT <= 0 && e.ramState !== 'charge') {
        e.eggT = QUEEN.eggEvery;
        layClutch(e, m, player);
      }
      return;
    }

    e.spearCd -= dt;
    if (e.spearCd <= 0 && !e.ramState) {
      if (env.dist < QUEEN.spearLen * 1.1 && startSpear(e, m, player)) return;
      e.spearCd = 1; // too far, or the ring is thin: try again shortly
    }

    const ring = queenOrbiters(e, m);
    if (e.aiTimer <= 0 && ring.length > 0) {
      // Peel the ones on the ship's side of the ring.
      e.aiTimer = QUEEN.peelEvery;
      ring.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
      ring.slice(0, QUEEN.peelCount).forEach((o, i) => release(o, player, i % 2 === 0));
      env.particles?.spawnShockwave?.(e.x, e.y, 140, e.hue, 3, 0.3);
    }
    e.hatchT -= dt;
    if (e.hatchT <= 0) {
      e.hatchT = QUEEN.hatchEvery;
      if (ringSize(e, m) < QUEEN.ring) hatch(e, m, e.x, e.y, true);
    }
  },
  trace(ctx, e, r) {
    // Carapace: a giant swarmer diamond with a nested, breathing inner diamond.
    ctx.moveTo(r * 1.25, 0);
    ctx.lineTo(0, r * 0.8);
    ctx.lineTo(-r * 1.25, 0);
    ctx.lineTo(0, -r * 0.8);
    ctx.closePath();
    const k = 0.5 + Math.sin(e.pulsePhase * 0.8) * 0.06;
    ctx.moveTo(r * 1.25 * k, 0);
    ctx.lineTo(0, r * 0.8 * k);
    ctx.lineTo(-r * 1.25 * k, 0);
    ctx.lineTo(0, -r * 0.8 * k);
    ctx.closePath();
    // A crown of three spikes on her head and a stinger tail.
    ctx.moveTo(r * 1.25, 0); ctx.lineTo(r * 1.7, 0);
    ctx.moveTo(r * 0.95, r * 0.22); ctx.lineTo(r * 1.45, r * 0.5);
    ctx.moveTo(r * 0.95, -r * 0.22); ctx.lineTo(r * 1.45, -r * 0.5);
    ctx.moveTo(-r * 1.25, 0); ctx.lineTo(-r * 1.6, r * 0.12); ctx.lineTo(-r * 1.85, 0); ctx.lineTo(-r * 1.6, -r * 0.12); ctx.closePath();
    // Two pairs of fluttering wings (faster when enraged).
    const beat = Math.sin(e.pulsePhase * (e.enraged ? 4.5 : 3));
    for (const s of [1, -1]) {
      const f = 1 + beat * 0.18;
      ctx.moveTo(r * 0.25, s * r * 0.6);
      ctx.quadraticCurveTo(r * 0.1, s * r * 1.9 * f, -r * 0.75, s * r * 1.55 * f);
      ctx.quadraticCurveTo(-r * 0.45, s * r * 0.95, -r * 0.1, s * r * 0.7);
      ctx.moveTo(-r * 0.25, s * r * 0.55);
      ctx.quadraticCurveTo(-r * 0.7, s * r * 1.35 * f, -r * 1.35, s * r * 1.05 * f);
      ctx.quadraticCurveTo(-r * 0.9, s * r * 0.6, -r * 0.55, s * r * 0.4);
    }
    // Brood sacs at the side tips, pulsing out of step.
    for (const [x, y, ph] of [[0, r * 0.8, 0], [0, -r * 0.8, 1.6]]) {
      const sr = r * (0.16 + Math.sin(e.pulsePhase * 1.4 + ph) * 0.03);
      ctx.moveTo(x + sr, y);
      ctx.arc(x, y, sr, 0, Math.PI * 2);
    }
  },
  overlay(ctx, e, r) {
    drawBossFlair(ctx, e, r);
    if (e.state === 'spear') {
      // The spear lane, locking on, and the brood drawn into a line along it.
      const k = 1 - Math.max(0, e.spearT) / QUEEN.spearWindup;
      drawLaneTell(ctx, e.x + Math.cos(e.spearAngle) * r, e.y + Math.sin(e.spearAngle) * r, e.spearAngle, QUEEN.spearLen, QUEEN.spearWidth, k, 340);
    }
    if (e.enraged) {
      // Enraged: a ragged magenta corona.
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 65%, ${0.35 + 0.2 * Math.sin(e.pulsePhase * 2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let s = 0; s < 10; s++) {
        const a = (s / 10) * Math.PI * 2 + e.pulsePhase * 0.3;
        const r0 = r * 1.9;
        const r1 = r * (2.2 + 0.25 * Math.sin(e.pulsePhase * 3 + s));
        ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
        ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
      }
      ctx.stroke();
    }
  },
  onDeath(e, m) {
    for (let k = 0; k < QUEEN.deathMayflies; k++) {
      const a = (k / QUEEN.deathMayflies) * Math.PI * 2 + Math.random() * 0.3;
      m.queueSpawn('mayfly', e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, m.waveScaleFor('mayfly', e.bossWave), {
        instant: true, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6
      });
    }
    deathBloom(e, m, [325, 300, 48], 'queen_death');
  }
};

// --- OUROBOROS (wave 6, major) ---------------------------------------------------------------
// A giant serpent. Only its crowned head can be hurt; the long body blocks shots and stings on
// contact. While healthy it winds after you and every few seconds sheds its tail as a small serpent.
// From half HP it hunts: it COILS round the ship in a tightening ring (dash out through the gap where
// head meets tail), REARS with a marked strike lane, STRIKES down it, then winds free and coils again.
export const OURO = {
  segments: 26, gap: 30, headRadius: 30, bodyRadius: 22, tailRadius: 12,
  speed: 2.4, rageSpeed: 3.0, turnRate: 1.7, weave: 0.6, weaveRate: 1.3,
  shedEvery: 7, shedSegments: 3, shedMin: 12, spawnSegments: 6,
  coilAt: 0.5, coilTime: 4.2, coilR0: 330, coilR1: 135, coilSpeed: 3.6,
  rearTime: 0.7, strikeTime: 0.55, strikeSpeed: 10.5, windTime: 3,
  // Arrival: the body lies coiled round the head (turns arriveSpacing apart) and the head holds still
  // for arriveRest s before it starts to unwind.
  arriveSpacing: 52, arriveRest: 1
};

// Live body segments of a serpent head, front to tail.
function bodyOf(e) {
  const out = [];
  for (const ref of e.bodyRefs || []) {
    const seg = liveOf(ref);
    if (seg && !seg.dead && !seg.doomQueued) out.push(seg);
  }
  return out;
}

const ouroboros = {
  name: 'OUROBOROS', epithet: 'THE COIL THAT DEVOURS', tier: 'major', hue: 245, debut: ['serpent', 'bruiser'],
  stats: () => ({ speed: OURO.speed, radius: OURO.headRadius, sides: 6, vRot: 0 }),
  onArrive(e, m) {
    e.state = 'wind';
    e.aiTimer = OURO.shedEvery;
    e.enraged = false;
    e.aimAngle = Math.random() * Math.PI * 2;
    e.restT = OURO.arriveRest;
    // It arrives coiled: the plates spiral out from behind the head, which then unwinds them.
    const first = OURO.gap + Math.max(0, OURO.headRadius - OURO.bodyRadius) * 0.6;
    const path = coilPath(e.x, e.y, OURO.segments, {
      first, gap: OURO.gap, spacing: OURO.arriveSpacing, angle: e.aimAngle + Math.PI, dir: Math.random() < 0.5 ? -1 : 1
    });
    e.bodyRefs = spawnBody(m, e, e.x, e.y, OURO.segments, 1, {
      angle: e.aimAngle, gap: OURO.gap, radius: OURO.bodyRadius, tail: OURO.tailRadius, hue: e.hue, boss: e.type, headRadius: OURO.headRadius, path, extra: { instant: true }
    });
  },
  update(e, m, env) {
    const { dt, player } = env;
    if (!e.enraged && e.hp <= e.maxHp * OURO.coilAt) {
      e.enraged = true;
      e.state = 'coil';
      e.aiTimer = OURO.coilTime;
      e.coilA = Math.atan2(e.y - player.y, e.x - player.x);
      e.coilDir = Math.random() < 0.5 ? -1 : 1;
      env.particles?.spawnShockwave?.(e.x, e.y, 300, e.hue, 5, 0.5);
      env.grid?.applyImpulse(e.x, e.y, 70, 300, e.hue);
    }
    e.aiTimer -= dt;
    if (e.restT > 0) {
      // Fresh out of the portal, still coiled: the head turns to face the ship, then sets off.
      e.restT -= dt;
      e.vx = 0;
      e.vy = 0;
      e.aimAngle = turnToward(e.aimAngle, Math.atan2(player.y - e.y, player.x - e.x), OURO.turnRate * dt);
      e.rotation = e.aimAngle;
      return;
    }
    if (e.state === 'wind') {
      e.speed = e.enraged ? OURO.rageSpeed : OURO.speed;
      windToward(e, env, { speed: e.speed, turnRate: OURO.turnRate, weave: OURO.weave, weaveRate: OURO.weaveRate });
      if (e.aiTimer <= 0) {
        if (e.enraged) {
          e.state = 'coil';
          e.aiTimer = OURO.coilTime;
          e.coilA = Math.atan2(e.y - player.y, e.x - player.x);
          e.coilDir = Math.random() < 0.5 ? -1 : 1;
        } else {
          e.aiTimer = OURO.shedEvery;
          shedTail(e, m);
        }
      }
    } else if (e.state === 'coil') {
      // Circle the ship on a shrinking ring; the body trails round it into a noose.
      const k = 1 - Math.max(0, e.aiTimer) / OURO.coilTime;
      const r = OURO.coilR0 + (OURO.coilR1 - OURO.coilR0) * k;
      e.coilA += e.coilDir * (OURO.coilSpeed * 60 / r) * dt;
      const tx = player.x + Math.cos(e.coilA) * r;
      const ty = player.y + Math.sin(e.coilA) * r;
      e.speed = OURO.coilSpeed * 1.6;
      e.vx = (tx - e.x) * 0.12;
      e.vy = (ty - e.y) * 0.12;
      e.aimAngle = Math.atan2(e.vy, e.vx);
      e.rotation = e.aimAngle;
      if (e.aiTimer <= 0) {
        e.state = 'rear';
        e.aiTimer = OURO.rearTime;
      }
    } else if (e.state === 'rear') {
      // Rears back and locks a strike lane on the ship.
      e.vx *= 0.8;
      e.vy *= 0.8;
      e.aimAngle = turnToward(e.aimAngle, Math.atan2(player.y - e.y, player.x - e.x), 6 * dt);
      e.rotation = e.aimAngle;
      if (e.aiTimer <= 0) {
        e.state = 'strike';
        e.aiTimer = OURO.strikeTime;
        e.burstSpeed = OURO.strikeSpeed * (e.speedScale || 1);
        env.grid?.applyImpulse(e.x, e.y, 40, 160, e.hue);
      }
    } else if (e.state === 'strike') {
      e.vx = Math.cos(e.aimAngle) * e.burstSpeed;
      e.vy = Math.sin(e.aimAngle) * e.burstSpeed;
      if (e.aiTimer <= 0) {
        e.burstSpeed = 0;
        e.state = 'wind';
        e.aiTimer = OURO.windTime;
      }
    }
  },
  trace(ctx, e, r) {
    traceSerpentHead(ctx, r);
    // Inner jaw plate.
    ctx.moveTo(r * 0.9, 0);
    ctx.lineTo(r * 0.1, r * 0.5);
    ctx.lineTo(-r * 0.3, 0);
    ctx.lineTo(r * 0.1, -r * 0.5);
    ctx.closePath();
  },
  overlay(ctx, e) {
    if (e.state !== 'rear') return;
    // Strike lane: a red dashed corridor the length of the lunge, flashing faster as it locks.
    const t = 1 - Math.max(0, e.aiTimer) / OURO.rearTime;
    const len = OURO.strikeSpeed * OURO.strikeTime * 60 + e.radius;
    const flash = 0.5 + 0.5 * Math.cos(e.aiTimer * Math.PI * 14);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.aimAngle);
    ctx.strokeStyle = `hsla(0, 100%, 62%, ${0.3 + t * 0.4 + flash * 0.2})`;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(e.radius * 0.8, -e.radius, len, e.radius * 2);
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      if (k / 5 > t) break;
      const x = e.radius + (len - e.radius) * ((k + 0.5) / 5);
      ctx.moveTo(x - e.radius * 0.5, -e.radius * 0.6);
      ctx.lineTo(x, 0);
      ctx.lineTo(x - e.radius * 0.5, e.radius * 0.6);
    }
    ctx.stroke();
    ctx.restore();
  }
};

// Phase-one shedding: the last few tail plates pop and a small serpent wriggles free from the stump.
function shedTail(e, m) {
  const body = bodyOf(e);
  if (body.length <= OURO.shedMin) return;
  const cut = body.slice(-OURO.shedSegments);
  const stump = cut[0];
  const angle = Math.atan2(stump.y - e.y, stump.x - e.x);
  for (const seg of cut) {
    seg.doomQueued = true;
    seg.noReward = true; // shed, not killed: it crumbles without score or drops
    m.doomed.push(seg);
  }
  e.bodyRefs = e.bodyRefs.filter(ref => !cut.includes(liveOf(ref)));
  spawnSerpent(m, 'serpent', stump.x, stump.y, m.waveScaleFor('serpent', e.bossWave), OURO.spawnSegments, { angle, extra: { instant: true } });
}

// --- WING COMMANDER (wave 15, minor) --------------------------------------------------------
// A big afterburning arrowhead that never chases: it leads a V of Kestrels on strafing runs through
// where you are, laying a line of slow drifting mines on either side as it passes, and calls in
// replacements for lost wingmen at the start of each run. Its signature is the AIRSTRIKE: a siren,
// then a long bombing lane marked through your position, carpet-bombed end to end by a blast front.
// At half HP the escort scrambles to hunt on its own, and the Commander flies faster runs that open
// with an aimed five-orb fan, and calls CROSSFIRE strikes: two lanes crossing on you in an X.
export const WING = {
  escort: 6, speed: 3.8, rageSpeed: 4.8, turnRate: 1.5, rageTurnRate: 2.1, reinforce: 2, radius: 44,
  mineEvery: 0.28, mineSpeed: 1.1, mineLife: 5.5, fan: 5, fanSpread: 0.22, fanSpeed: 4.2, rageAt: 0.5, deathOrbs: 10,
  // Airstrike: every strikeEvery s (rageStrikeEvery from half HP; the first after strikeFirst) a lane
  // strikeLen x strikeWidth px through the ship, warned for strikeWarn s, then swept in strikeSweep s
  // for strikeDamage of its contact hit. Crossfire's second lane lands crossDelay s after the first.
  strikeFirst: 4.5, strikeEvery: 8, rageStrikeEvery: 6.5, strikeLen: 1100, strikeWidth: 104,
  strikeWarn: 1.5, strikeSweep: 0.6, strikeDamage: 0.5, crossDelay: 0.4
};

function fireOrb(m, e, angle, speed, life = 4) {
  const b = m.enemyBullets?.spawn(e.x + Math.cos(angle) * e.radius, e.y + Math.sin(angle) * e.radius,
    Math.cos(angle) * speed, Math.sin(angle) * speed, TUNING.enemyBulletDamage ?? 12, 8);
  if (b) {
    b.life = life;
    b.from = e.type;
  }
  return b;
}

// First free V slots (1..n) on a leader. Wingmen still materializing hold their slot too.
function freeSlots(e, m, n) {
  const taken = new Set(wingmenOf(e, m).map(o => o.wingSlot));
  for (const sp of m.spawnIndicators) if (sp.config.attach?.wingLeader === e) taken.add(sp.config.attach.wingSlot);
  const out = [];
  for (let k = 1; out.length < n && k <= WING.escort; k++) if (!taken.has(k)) out.push(k);
  return out;
}

// Mark one bombing lane through (x, y) at `angle`, swept from the Commander's side.
function strikeLane(e, m, x, y, angle, delay = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const half = WING.strikeLen / 2;
  // Run the front from the end nearer the Commander, so the bombs fall the way its run will go.
  const near = (x - c * half - e.x) ** 2 + (y - s * half - e.y) ** 2 < (x + c * half - e.x) ** 2 + (y + s * half - e.y) ** 2;
  const k = near ? 1 : -1;
  return m.bossTelegraphs?.lane(x - c * half * k, y - s * half * k, x + c * half * k, y + s * half * k, WING.strikeWidth, {
    warn: WING.strikeWarn + delay, sweep: WING.strikeSweep, hue: 18, damage: hazardDamage(WING.strikeDamage), from: e.type,
    onFire: () => cue(m, 'wing_strike')
  });
}

// Call in an airstrike on the ship: one lane along the Commander's line to it, or (enraged) an X.
function callAirstrike(e, m, env) {
  const { player } = env;
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  const x = player.x + (player.vx || 0) * 10;
  const y = player.y + (player.vy || 0) * 10;
  if (e.enraged) {
    strikeLane(e, m, x, y, a + Math.PI / 4);
    strikeLane(e, m, x, y, a - Math.PI / 4, WING.crossDelay);
  } else {
    strikeLane(e, m, x, y, a);
  }
  e.strikeCallT = 0.6; // the radio flash on its hull
  cue(m, 'wing_siren');
}

const wingCommander = {
  name: 'WING COMMANDER', epithet: 'ACE OF THE KESTREL FLIGHT', tier: 'minor', hue: 30, debut: ['kestrel', 'blinker', 'borer'],
  stats: () => ({ speed: WING.speed, radius: WING.radius, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.state = 'turn';
    e.enraged = false;
    e.aimAngle = Math.random() * Math.PI * 2;
    e.mineT = 0;
    e.strikeT = WING.strikeFirst;
    spawnWing(m, e.x, e.y, m.waveScaleFor('kestrel', e.bossWave), WING.escort, { angle: e.aimAngle, leader: e, extra: { instant: true } });
    arriveFx(e, m, 'wing_flyby');
  },
  update(e, m, env) {
    const { dt, player } = env;
    if (!e.enraged && e.hp <= e.maxHp * WING.rageAt) {
      // Scramble: the escort breaks formation and each Kestrel hunts alone.
      e.enraged = true;
      e.speed = WING.rageSpeed;
      e.strikeT = Math.min(e.strikeT, 1.5);
      for (const o of wingmenOf(e, m)) {
        o.wingLeader = null;
        o.burstSpeed = 0;
        o.state = 'turn';
      }
      phaseShift(e, m, env, 260);
    }
    e.strikeT -= dt;
    if (e.strikeCallT > 0) e.strikeCallT -= dt;
    if (e.strikeT <= 0 && env.dist < 900) {
      e.strikeT = e.enraged ? WING.rageStrikeEvery : WING.strikeEvery;
      callAirstrike(e, m, env);
    }
    const before = e.state;
    flyRuns(e, env, e.enraged ? WING.rageSpeed : WING.speed, e.enraged ? WING.rageTurnRate : WING.turnRate);
    if (before === 'turn' && e.state === 'run') {
      if (e.enraged) {
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        for (let k = 0; k < WING.fan; k++) fireOrb(m, e, a + (k - (WING.fan - 1) / 2) * WING.fanSpread, WING.fanSpeed);
        m.shotsFired = (m.shotsFired || 0) + 1;
      } else {
        // New run: call in replacements for lost wingmen.
        const scale = m.waveScaleFor('kestrel', e.bossWave);
        for (const k of freeSlots(e, m, WING.reinforce)) {
          const o = slotOffset(k);
          const c = Math.cos(e.aimAngle), sn = Math.sin(e.aimAngle);
          m.queueSpawn('kestrel', e.x - c * o.back * 2 - sn * o.side, e.y - sn * o.back * 2 + c * o.side, scale,
            { instant: true, attach: { wingLeader: e, wingSlot: k, aimAngle: e.aimAngle } });
        }
      }
    }
    if (e.state === 'run') {
      // Mines: a slow drifting orb out of each side, so every pass leaves two lines to cross.
      e.mineT -= dt;
      if (e.mineT <= 0) {
        e.mineT = WING.mineEvery;
        fireOrb(m, e, e.aimAngle + Math.PI / 2, WING.mineSpeed, WING.mineLife);
        fireOrb(m, e, e.aimAngle - Math.PI / 2, WING.mineSpeed, WING.mineLife);
      }
    }
  },
  trace(ctx, e, r) {
    // A broad delta wing with twin tail fins, a cockpit stripe and wing-root intakes.
    ctx.moveTo(r * 1.5, 0);
    ctx.lineTo(-r * 0.9, r * 1.2);
    ctx.lineTo(-r * 0.5, r * 0.4);
    ctx.lineTo(-r * 1.1, r * 0.4);
    ctx.lineTo(-r * 0.8, 0);
    ctx.lineTo(-r * 1.1, -r * 0.4);
    ctx.lineTo(-r * 0.5, -r * 0.4);
    ctx.lineTo(-r * 0.9, -r * 1.2);
    ctx.closePath();
    ctx.moveTo(r * 0.9, 0);
    ctx.lineTo(-r * 0.2, 0);
    ctx.moveTo(r * 0.2, r * 0.35);
    ctx.lineTo(-r * 0.3, r * 0.75);
    ctx.moveTo(r * 0.2, -r * 0.35);
    ctx.lineTo(-r * 0.3, -r * 0.75);
    // Canopy chevron.
    ctx.moveTo(r * 1.15, 0);
    ctx.lineTo(r * 0.75, r * 0.14);
    ctx.lineTo(r * 0.55, 0);
    ctx.lineTo(r * 0.75, -r * 0.14);
    ctx.closePath();
    // Twin afterburners: flickering flame tongues out of both tail notches (longer when enraged).
    const fl = 0.6 + 0.4 * Math.sin(e.pulsePhase * 7) * Math.sin(e.pulsePhase * 2.3);
    const len = (e.enraged ? 1.1 : 0.75) * (0.7 + fl * 0.5);
    for (const s of [1, -1]) {
      ctx.moveTo(-r * 1.1, s * r * 0.28);
      ctx.lineTo(-r * (1.1 + len), s * r * 0.2);
      ctx.lineTo(-r * 1.1, s * r * 0.12);
    }
  },
  overlay(ctx, e, r) {
    drawBossFlair(ctx, e, r);
    // Wing-tip nav lights: red to port, green to starboard, a white strobe when it calls a strike.
    const c = Math.cos(e.rotation);
    const s = Math.sin(e.rotation);
    const blink = Math.sin(e.pulsePhase * 2) > 0.2;
    const tips = [[-0.9, 1.2, '#ff3355'], [-0.9, -1.2, '#33ff99']];
    for (const [lx, ly, col] of tips) {
      if (!blink) continue;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(e.x + (c * lx - s * ly) * r, e.y + (s * lx + c * ly) * r, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.strikeCallT > 0) {
      ctx.strokeStyle = `hsla(18, 100%, 70%, ${e.strikeCallT / 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const rr = r * (1.4 + k * 0.5 + (0.6 - e.strikeCallT) * 1.5);
        for (const a0 of [-0.6, Math.PI - 0.6]) {
          ctx.moveTo(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr);
          ctx.arc(e.x, e.y, rr, a0, a0 + 1.2);
        }
      }
      ctx.stroke();
    }
  },
  onDeath(e, m) {
    for (let k = 0; k < WING.deathOrbs; k++) fireOrb(m, e, (k / WING.deathOrbs) * Math.PI * 2, 2.2);
    deathBloom(e, m, [30, 18, 55], 'wing_strike');
  }
};

// --- HIVE CARRIER (wave 12, major) ----------------------------------------------------------
// A huge, slow mothership with four launch bays on its hull. While any bay stands the core is shielded
// (shots spark off it) and every bay launches homing drones. Destroy the bays and the core is exposed:
// it spins up, sprays a spiral of orbs and launches gunner pods.
export const HIVE = {
  bays: 4, bayRadius: 58, bayHpShare: 0.25, coreHpScale: 0.6, bayLaunchEvery: 2.6, bayDrones: 3,
  holdRange: 260, speed: 1.4, exposedSpeed: 1.9, spin: 0.25, exposedSpin: 0.8,
  spiralEvery: 0.14, spiralStep: 0.45, spiralSpeed: 3.2, podEvery: 7, pods: 2, podCap: 4
};

function bayCount(e, m) {
  let n = 0;
  for (const o of m.enemies) if (o.mount === e && !o.dead) n++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.mount === e) n++;
  return n;
}

const hiveCarrier = {
  ram: { range: 380, speed: 8, cooldown: 6.5, windup: 1 },
  name: 'HIVE CARRIER', epithet: 'MOTHER OF A THOUSAND DRONES', tier: 'major', hue: 120, debut: ['carrier', 'drone', 'gunner'],
  hpScale: HIVE.coreHpScale,
  stats: () => ({ speed: HIVE.speed, radius: 44, sides: 6, vRot: 0 }),
  onArrive(e, m) {
    e.phase = 1;
    e.deflect = true;
    e.aiTimer = HIVE.podEvery;
    e.spiralT = 0;
    e.spiralA = 0;
    const bayHp = e.maxHp * HIVE.bayHpShare;
    for (let k = 0; k < HIVE.bays; k++) {
      const a = Math.PI / 4 + (k * Math.PI * 2) / HIVE.bays;
      m.queueSpawn('hive_bay', e.x + Math.cos(a) * HIVE.bayRadius, e.y + Math.sin(a) * HIVE.bayRadius, 1, {
        instant: true, attach: { mount: e, mountA: a, mountR: HIVE.bayRadius, hp: bayHp, maxHp: bayHp, bossBody: e.type, aiTimer: 0.8 + k * 0.5 }
      });
    }
  },
  update(e, m, env) {
    const { dt, dist } = env;
    if (e.phase === 1 && bayCount(e, m) === 0) {
      // Every bay down: the core is exposed and spins up.
      e.phase = 2;
      e.deflect = false;
      e.speed = HIVE.exposedSpeed;
      e.aiTimer = 1;
      env.particles?.spawnShockwave?.(e.x, e.y, 320, e.hue, 6, 0.55);
      env.grid?.applyImpulse(e.x, e.y, 80, 320, e.hue);
    }
    const push = dist > HIVE.holdRange ? 0.14 : dist < HIVE.holdRange - 60 ? -0.06 : 0;
    e.vx = (e.vx + env.moveX * push) * 0.94;
    e.vy = (e.vy + env.moveY * push) * 0.94;
    e.rotation += (e.phase === 2 ? HIVE.exposedSpin : HIVE.spin) * dt;
    if (e.phase !== 2) return;
    e.spiralT -= dt;
    if (e.spiralT <= 0) {
      e.spiralT = HIVE.spiralEvery;
      e.spiralA += HIVE.spiralStep;
      fireOrb(m, e, e.spiralA, HIVE.spiralSpeed);
      fireOrb(m, e, e.spiralA + Math.PI, HIVE.spiralSpeed);
    }
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      e.aiTimer = HIVE.podEvery;
      let pods = 0;
      for (const o of m.enemies) if (o.parent === e && !o.dead) pods++;
      for (let k = 0; k < HIVE.pods && pods < HIVE.podCap; k++, pods++) {
        const a = e.rotation + k * Math.PI;
        m.queueSpawn('gunner', e.x + Math.cos(a) * e.radius * 1.3, e.y + Math.sin(a) * e.radius * 1.3, m.waveScaleFor('gunner', e.bossWave), {
          instant: true, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, attach: { parent: e }
        });
      }
    }
  },
  trace(ctx, e, r) {
    // Hexagonal mothership: outer hull, inner reactor ring, and spokes to the bay mounts.
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    const core = r * (e.phase === 2 ? 0.5 + Math.sin(e.pulsePhase * 2) * 0.06 : 0.42);
    ctx.moveTo(core, 0);
    ctx.arc(0, 0, core, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      ctx.moveTo(Math.cos(a) * core, Math.sin(a) * core);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
  },
  overlay(ctx, e, r) {
    if (!e.deflect) return;
    // The bay-powered shield: a dashed hex bubble that flashes when shots spark off it.
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 75%, ${0.3 + (e.hitFlash || 0) * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const a0 = e.rotation + (k * Math.PI) / 6;
      ctx.moveTo(e.x + Math.cos(a0) * r * 1.12, e.y + Math.sin(a0) * r * 1.12);
      ctx.arc(e.x, e.y, r * 1.12, a0, a0 + 0.3);
    }
    ctx.stroke();
  }
};

// --- EVENT HORIZON (wave 25, minor) ---------------------------------------------------------
// A living black hole. It drifts after you with a huge pull: it tugs your ship (never past the escape
// cap), bends your shots, and drags other hostiles in. Anything it swallows heals it. It breathes:
// it INHALES (stronger pull) while green spokes mark the safe gaps, then EXHALES a GRAVITY WAVE, an
// expanding ring that hits anything it crosses outside the gaps, with an orb ring riding it. At half
// HP it spits out two vortexes, breathes faster and every wave comes as a double ripple whose second
// ring turns its gaps. Arrives with two Hulks in tow.
export const HORIZON = {
  pullRadius: 400, bend: 2.2, enemyPull: 0.9, eatHeal: 0.025, eatRadius: 1.05,
  breathEvery: 6, rageBreathEvery: 4.2, inhaleTime: 1.6, ring: 16, rageRing: 24, ringSpeed: 2.6,
  speed: 1.9, radius: 54, rageAt: 0.5, vortexes: 2, escortHulks: 2,
  // Gravity wave: grows waveSpeed px/tick from the rim out to waveReach px, waveWidth thick, with
  // `gaps` safe gaps waveGap rad wide (rageGaps when enraged); a hit costs waveDamage of its contact
  // hit. The enraged ripple's second ring follows rippleDelay s behind, its gaps turned half a step.
  waveSpeed: 3.4, waveReach: 760, waveWidth: 20, gaps: 3, rageGaps: 3, waveGap: 0.62, waveDamage: 0.5, rippleDelay: 0.55
};

// Mark a gravity wave from the core: it shows its safe gaps for `warn` s, then rolls outward.
function gravityWave(e, m, warn, gaps, onFire) {
  return m.bossTelegraphs?.wave(e.x, e.y, {
    r0: e.radius * 1.15, speed: HORIZON.waveSpeed, rMax: HORIZON.waveReach, w: HORIZON.waveWidth,
    gaps, gapWidth: HORIZON.waveGap, warn, hue: e.hue, damage: hazardDamage(HORIZON.waveDamage), from: e.type, onFire, follow: e
  });
}

// The orb ring that rides a wave: `n` orbs spread over the solid arcs only, so the gaps stay clear.
function exhaleOrbs(e, m, n, gaps) {
  const solid = Math.PI * 2 - gaps.length * HORIZON.waveGap;
  const per = gaps.length ? Math.max(1, Math.round(n / gaps.length)) : n;
  const sorted = [...gaps].sort((a, b) => a - b);
  if (!sorted.length) {
    for (let k = 0; k < n; k++) fireOrb(m, e, (k / n) * Math.PI * 2, HORIZON.ringSpeed, 6);
    return;
  }
  let fired = 0;
  for (let g = 0; g < sorted.length && fired < n; g++) {
    const from = sorted[g] + HORIZON.waveGap / 2;
    const span = solid / sorted.length;
    const count = g === sorted.length - 1 ? n - fired : per;
    for (let k = 0; k < count; k++) fireOrb(m, e, from + span * ((k + 0.5) / count), HORIZON.ringSpeed, 6);
    fired += count;
  }
}

const eventHorizon = {
  ram: { range: 420, speed: 7.5, cooldown: 6, windup: 1, when: (e) => !(e.inhaleT > 0) }, // the well drags you into the lane
  name: 'EVENT HORIZON', epithet: 'THE HUNGER BETWEEN STARS', tier: 'minor', hue: 280, debut: ['blackhole', 'hulk'],
  stats: () => ({ speed: HORIZON.speed, radius: HORIZON.radius, sides: 12, vRot: 0.02, gravityWell: true, pullRadius: HORIZON.pullRadius, bendMult: HORIZON.bend }),
  onArrive(e, m) {
    e.aiTimer = HORIZON.breathEvery * 0.6;
    e.inhaleT = 0;
    e.enraged = false;
    e.gravityWell = true;
    e.pullRadius = HORIZON.pullRadius;
    e.bendMult = HORIZON.bend;
    for (let k = 0; k < HORIZON.escortHulks; k++) {
      const a = (k / HORIZON.escortHulks) * Math.PI * 2 + 0.6;
      m.queueSpawn('hulk', e.x + Math.cos(a) * 240, e.y + Math.sin(a) * 240, m.waveScaleFor('hulk', e.bossWave), { instant: true });
    }
    arriveFx(e, m, 'horizon_groan');
    // Space caves in where it surfaces: an inward ring and a deep grid funnel.
    m.aiEnv?.particles?.spawnShockwave?.(e.x, e.y, HORIZON.pullRadius, e.hue, 4, 0.7, true);
    m.aiEnv?.grid?.applyImplosion?.(e.x, e.y, 3, HORIZON.pullRadius, e.hue, 0.5);
  },
  update(e, m, env) {
    const { dt } = env;
    const drift = e.inhaleT > 0 ? 0.05 : 0.11;
    e.vx = (e.vx + env.dirX * drift) * 0.95;
    e.vy = (e.vy + env.dirY * drift) * 0.95;
    if (!e.enraged && e.hp <= e.maxHp * HORIZON.rageAt) {
      e.enraged = true;
      for (let k = 0; k < HORIZON.vortexes; k++) {
        const a = Math.random() * Math.PI * 2;
        m.queueSpawn('blackhole', e.x + Math.cos(a) * e.radius * 1.5, e.y + Math.sin(a) * e.radius * 1.5, m.waveScaleFor('blackhole', e.bossWave), {
          instant: true, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3
        });
      }
      phaseShift(e, m, env, 340);
      env.grid?.applyImplosion?.(e.x, e.y, 3, 340, e.hue, 0.6);
    }
    // Breathing: inhale (pull radius swells, the wave shows its gaps), then exhale the wave and orbs.
    e.aiTimer -= dt;
    if (e.inhaleT > 0) {
      e.inhaleT -= dt;
      e.pullRadius = HORIZON.pullRadius * 1.25;
      if (env.particles && Math.random() < 0.6) env.particles.spawnInfall?.(e, e.pullRadius * 0.8, e.hue, 2);
      if (e.inhaleT <= 0) {
        e.pullRadius = HORIZON.pullRadius;
        const n = e.enraged ? HORIZON.rageRing : HORIZON.ring;
        exhaleOrbs(e, m, n, e.waveGaps || []);
        m.shotsFired = (m.shotsFired || 0) + 1;
        env.grid?.applyImpulse(e.x, e.y, 60, 260, e.hue);
        env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 4, e.hue, 5, 0.35);
      }
    } else if (e.aiTimer <= 0 && !e.ramState) {
      e.aiTimer = e.enraged ? HORIZON.rageBreathEvery : HORIZON.breathEvery;
      e.inhaleT = HORIZON.inhaleTime;
      const n = e.enraged ? HORIZON.rageGaps : HORIZON.gaps;
      const off = Math.random() * Math.PI * 2;
      e.waveGaps = Array.from({ length: n }, (_, k) => off + (k / n) * Math.PI * 2);
      gravityWave(e, m, HORIZON.inhaleTime, e.waveGaps, () => cue(m, 'horizon_wave'));
      if (e.enraged) {
        // The ripple: a second ring, gaps turned half a step, so you weave through both.
        const turned = e.waveGaps.map(a => a + Math.PI / n);
        gravityWave(e, m, HORIZON.inhaleTime + HORIZON.rippleDelay, turned, () => cue(m, 'horizon_wave'));
      }
      cue(m, 'horizon_inhale');
    }
    // Drag other hostiles in; swallow the ones that reach the core.
    const reach = e.pullRadius;
    const pull = HORIZON.enemyPull * (e.inhaleT > 0 ? 1.6 : 1);
    for (const o of m.enemyIndex.query(e.x, e.y, reach)) {
      if (o === e || o.dead || o.isBoss || o.leader || o.mount || o.doomQueued || o.type === 'blackhole') continue;
      const gx = e.x - o.x;
      const gy = e.y - o.y;
      const d = Math.hypot(gx, gy) || 1;
      if (d > reach) continue;
      if (d < e.radius * HORIZON.eatRadius) {
        o.doomQueued = true;
        o.noReward = true;
        m.doomed.push(o);
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * HORIZON.eatHeal);
        e.fedFlash = 1;
        continue;
      }
      const k = pull * (1 - d / reach) / d;
      o.gvx = (o.gvx || 0) + (gx - gy * 0.35) * k * 0.08;
      o.gvy = (o.gvy || 0) + (gy + gx * 0.35) * k * 0.08;
    }
    if (e.fedFlash > 0) e.fedFlash = Math.max(0, e.fedFlash - dt * 2);
  },
  trace(ctx, e, r) {
    // The horizon itself, a churning inner ring that tightens on an inhale, and a photon ring of
    // twelve flickering ticks just outside it.
    ctx.moveTo(r, 0);
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const k = e.inhaleT > 0 ? 0.42 : 0.62;
    ctx.moveTo(r * k, 0);
    ctx.arc(0, 0, r * k, 0, Math.PI * 1.6);
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2 - e.pulsePhase * 0.5;
      const r1 = r * (1.12 + 0.08 * Math.sin(e.pulsePhase * 2 + s * 1.7));
      ctx.moveTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
      ctx.lineTo(Math.cos(a + 0.12) * r1, Math.sin(a + 0.12) * r1);
    }
  },
  overlay(ctx, e, r) {
    // Accretion disc, twin relativistic jets, a pull rim at the edge of its reach, a green flash when
    // it feeds.
    const spin = e.pulsePhase * 0.4;
    ctx.save();
    ctx.translate(e.x, e.y);
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = k === 0 ? 'hsla(30, 100%, 62%, 0.6)' : `hsla(${e.hue}, 100%, 66%, ${0.45 - k * 0.1})`;
      ctx.lineWidth = 2.6 - k * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (2 + k * 0.6), r * (0.55 + k * 0.2), (k % 2 ? -spin : spin) + k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Jets: two bright dashed beams out of the poles, streaming outward, longer on an inhale.
    const jetA = spin * 0.35 + Math.PI / 2;
    const jetLen = r * (e.inhaleT > 0 ? 5.2 : 3.6);
    ctx.strokeStyle = `hsla(${e.hue + 40}, 100%, 80%, 0.55)`;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -e.pulsePhase * 12;
    ctx.beginPath();
    for (const s of [1, -1]) {
      ctx.moveTo(Math.cos(jetA) * r * 1.1 * s, Math.sin(jetA) * r * 1.1 * s);
      ctx.lineTo(Math.cos(jetA) * jetLen * s, Math.sin(jetA) * jetLen * s);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${e.inhaleT > 0 ? 0.5 : 0.22})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const R = e.pullRadius || HORIZON.pullRadius;
    for (let k = 0; k < 32; k++) {
      const a0 = (k / 32) * Math.PI * 2 + spin * 0.2;
      ctx.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
      ctx.arc(0, 0, R, a0, a0 + 0.08);
    }
    ctx.stroke();
    if (e.fedFlash > 0) {
      ctx.strokeStyle = `hsla(140, 100%, 65%, ${e.fedFlash})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    drawBossFlair(ctx, e, r);
  },
  onDeath(e, m) {
    // Collapse: space snaps inward, then the core blows in violet, white and orange.
    m.aiEnv?.particles?.spawnShockwave?.(e.x, e.y, HORIZON.pullRadius, e.hue, 4, 0.3, true);
    deathBloom(e, m, [280, 30, 300], 'horizon_collapse');
  }
};

// --- THE ARCHITECT (wave 18, major) ---------------------------------------------------------
// Hangs back and builds laser gates round you, beaming each one into place. Fly through a gate and it
// blows: lure the Architect's guards (or the Architect) next to one first. At half HP it starts dropping
// CAGES: a ring of gates round where you are that closes in, walls facing you. Break out through a beam
// before it tightens; the blast takes the rest of the ring with it.
export const ARCH = {
  range: 380, band: 60, speed: 2.0, buildEvery: 2.4, rageBuildEvery: 1.5, buildTime: 0.7, maxGates: 8,
  ringMin: 170, ringMax: 260, cageEvery: 8, cageGates: 6, cageR: 300, cageTime: 5, guards: 2, rageAt: 0.5
};

function gatesOf(e, m) {
  let n = 0;
  for (const o of m.enemies) if (o.builder === e && !o.dead) n++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.builder === e) n++;
  return n;
}

const architect = {
  ram: { range: 460, speed: 10, cooldown: 6, overshoot: 180 },
  name: 'THE ARCHITECT', epithet: 'IT DRAWS THE LINES YOU DIE BEHIND', tier: 'major', hue: 55, debut: ['gate', 'shielder'],
  stats: () => ({ speed: ARCH.speed, radius: 32, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.aiTimer = 1.2;
    e.cageT = ARCH.cageEvery * 0.5;
    e.enraged = false;
    for (let k = 0; k < ARCH.guards; k++) {
      const a = (k / ARCH.guards) * Math.PI * 2;
      m.queueSpawn('shielder', e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70, m.waveScaleFor('shielder', e.bossWave), { instant: true });
    }
  },
  update(e, m, env) {
    const { dt, dirX, dirY, dist, player } = env;
    const radial = dist > ARCH.range + ARCH.band ? 1 : dist < ARCH.range - ARCH.band ? -1 : 0;
    const rx = radial > 0 ? env.moveX : dirX;
    const ry = radial > 0 ? env.moveY : dirY;
    e.vx = (e.vx + rx * radial * 0.2 - dirY * e.strafeSign * 0.07) * 0.92;
    e.vy = (e.vy + ry * radial * 0.2 + dirX * e.strafeSign * 0.07) * 0.92;
    e.rotation += 0.6 * dt;
    if (!e.enraged && e.hp <= e.maxHp * ARCH.rageAt) {
      e.enraged = true;
      e.cageT = 0.5;
      env.particles?.spawnShockwave?.(e.x, e.y, 260, e.hue, 5, 0.5);
    }
    if (e.buildT > 0) e.buildT -= dt;
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      e.aiTimer = e.enraged ? ARCH.rageBuildEvery : ARCH.buildEvery;
      if (gatesOf(e, m) < ARCH.maxGates) {
        // A gate on a ring round the ship, side-on so its beam crosses your path.
        const a = Math.random() * Math.PI * 2;
        const r = ARCH.ringMin + Math.random() * (ARCH.ringMax - ARCH.ringMin);
        const x = player.x + Math.cos(a) * r;
        const y = player.y + Math.sin(a) * r;
        if (m.queueSpawn('gate', x, y, m.waveScaleFor('gate', e.bossWave), { warmup: ARCH.buildTime, attach: { builder: e, rotation: a + Math.PI / 2 } })) {
          e.buildX = x;
          e.buildY = y;
          e.buildT = ARCH.buildTime;
        }
      }
    }
    if (!e.enraged) return;
    e.cageT -= dt;
    if (e.cageT <= 0) {
      e.cageT = ARCH.cageEvery;
      const off = Math.random() * Math.PI * 2;
      for (let k = 0; k < ARCH.cageGates; k++) {
        const a = off + (k / ARCH.cageGates) * Math.PI * 2;
        m.queueSpawn('gate', player.x + Math.cos(a) * ARCH.cageR, player.y + Math.sin(a) * ARCH.cageR, m.waveScaleFor('gate', e.bossWave), {
          warmup: 0.5, attach: { builder: e, cage: { cx: player.x, cy: player.y, a, r: ARCH.cageR, t: ARCH.cageTime } }
        });
      }
      env.grid?.applyImpulse(player.x, player.y, 50, ARCH.cageR, e.hue);
    }
  },
  trace(ctx, e, r) {
    // A drafting triangle round a compass ring, three struts to its corners.
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      if (k === 0) ctx.moveTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
      else ctx.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
    }
    ctx.closePath();
    ctx.moveTo(r * 0.55, 0);
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 3 + (k * Math.PI * 2) / 3;
      ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
  },
  overlay(ctx, e) {
    if (!(e.buildT > 0)) return;
    // Construction beam to the gate it is building.
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 75%, ${0.25 + 0.5 * (e.buildT / ARCH.buildTime)})`;
    ctx.lineWidth = 1.6;
    ctx.setLineDash?.([6, 6]);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.buildX, e.buildY);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
};

// --- PROGENITOR (wave 35, minor) -------------------------------------------------------------
// A giant cell that splits like an Asteroids rock: kill it and it divides into 2 smaller cells, those
// into 2 more each, and the last generation bursts into Mitosis Cells. Pieces left alone knit back:
// unhit for a while they heal, then drift together and merge into the generation above. The boss is
// beaten (and pays out) when its last piece dies. The first cell buds Mitosis Cells as it goes.
// Its signature is the PSEUDOPOD LASH: a cell stops, creaks and marks spokes radiating from its
// membrane (one always on you), then whips them out. The first division (about half its HP) is its
// phase change: from then on every piece lashes on its own clock, quicker and hungrier.
export const PROG = {
  gens: [ // per generation: share of the boss HP each piece gets, radius, speed, and its lash
    { hp: 0.45, radius: 62, speed: 2.2, spokes: 6, reach: 460, width: 34, every: 5.5, warn: 1.1 },
    { hp: 0.25, radius: 42, speed: 2.8, spokes: 4, reach: 370, width: 28, every: 6, warn: 0.95 },
    { hp: 0.12, radius: 28, speed: 3.5, spokes: 3, reach: 290, width: 22, every: 6.8, warn: 0.9 }
  ],
  children: 2, cells: 2, budEvery: 5, mergeAfter: 4, regen: 0.03, mergeSpeed: 0.12,
  lashFirst: 3, lashDamage: 0.45
};

// Live pieces of one Progenitor (every generation), and queued ones.
function piecesOf(root, m) {
  let n = 0;
  for (const o of m.enemies) if (o.root === root && !o.dead) n++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.root === root) n++;
  return n;
}

function spawnPiece(m, root, gen, x, y, vx, vy, hp) {
  const g = PROG.gens[gen];
  return m.queueSpawn('progenitor', x, y, 1, {
    instant: true, wave: root.bossWave, vx, vy,
    attach: {
      root, gen, splitChild: true, hp, maxHp: g.hp * root.fullHp, radius: g.radius, speed: g.speed, regen: PROG.regen, sinceHit: 0,
      lashT: 1.2 + Math.random() * 2.5 // the pieces fall out of step, so their lashes stagger
    }
  });
}

// Mark the spokes of a lash round the cell: one aimed at the ship, the rest spaced evenly.
function markLash(e, m, player) {
  const g = PROG.gens[e.gen || 0];
  const aim = Math.atan2(player.y - e.y, player.x - e.x);
  e.lashA = [];
  for (let k = 0; k < g.spokes; k++) e.lashA.push(aim + (k / g.spokes) * Math.PI * 2);
  e.lashHold = g.warn;
  for (const a of e.lashA) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    m.bossTelegraphs?.lane(e.x + c * e.radius * 0.9, e.y + s * e.radius * 0.9, e.x + c * (e.radius + g.reach), e.y + s * (e.radius + g.reach), g.width, {
      warn: g.warn, hue: 95, damage: hazardDamage(PROG.lashDamage), from: e.type, onFire: () => cue(m, 'prog_crack')
    });
  }
  cue(m, 'prog_lash');
}

const progenitor = {
  ram: { range: 300, cooldown: 7, windup: 0.9, speed: 8, when: (e) => !(e.lashHold > 0) }, // every piece, each on its own clock
  name: 'PROGENITOR', epithet: 'IT IS ALL OF THEM', tier: 'minor', hue: 95, debut: ['mitosis'],
  stats: () => ({ speed: PROG.gens[0].speed, radius: PROG.gens[0].radius, sides: 9, vRot: 0.01 }),
  onArrive(e, m) {
    e.root = e;
    e.gen = 0;
    e.fullHp = e.maxHp;
    e.maxHp = e.hp = e.fullHp * PROG.gens[0].hp;
    e.regen = PROG.regen;
    e.aiTimer = PROG.budEvery;
    e.lashT = PROG.lashFirst;
    arriveFx(e, m, 'prog_squelch');
  },
  // Only the last piece standing counts as the boss going down (rewards, card).
  isFinalPiece(e, m) {
    if ((e.gen ?? 0) < PROG.gens.length - 1) return false; // it splits into the next generation
    return !e.root || piecesOf(e.root, m) === 0;
  },
  update(e, m, env) {
    const { dt, player } = env;
    if (e.discarded) return; // absorbed by a sibling this tick
    const g = PROG.gens[e.gen || 0];
    if (e.lashHold > 0) {
      // Rooted while its pseudopods are out: it quivers in place until they whip.
      e.lashHold -= dt;
      e.vx *= 0.6;
      e.vy *= 0.6;
      return;
    }
    e.lashT = (e.lashT ?? PROG.lashFirst) - dt;
    if (e.lashT <= 0 && env.dist < g.reach + e.radius + 200 && e.ramState !== 'brace' && e.ramState !== 'charge') {
      e.lashT = g.every * (0.85 + Math.random() * 0.3);
      markLash(e, m, player);
      return;
    }
    const unhit = e.sinceHit > PROG.mergeAfter;
    let mate = null;
    if (e.gen > 0 && unhit) {
      // Left alone: find a sibling of the same generation (also unhit) and drift together to merge.
      let best = Infinity;
      for (const o of m.enemies) {
        if (o === e || o.dead || o.discarded || o.root !== e.root || o.gen !== e.gen || !(o.sinceHit > PROG.mergeAfter)) continue;
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (d < best) { best = d; mate = o; }
      }
      if (mate && best < (e.radius + mate.radius) * 0.8) {
        // Merge: the pair becomes one piece of the generation above with their summed HP.
        const up = PROG.gens[e.gen - 1];
        m.discard(mate); // absorbed: gone at the end of this tick, no kill, no reward
        e.gen -= 1;
        e.maxHp = up.hp * e.root.fullHp;
        e.hp = Math.min(e.maxHp, e.hp + mate.hp);
        e.radius = up.radius;
        e.speed = up.speed;
        env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 3, e.hue, 3, 0.35);
        cue(m, 'prog_squelch');
        return;
      }
    }
    const tx = mate ? (mate.x - e.x) : env.moveX;
    const ty = mate ? (mate.y - e.y) : env.moveY;
    const len = Math.hypot(tx, ty) || 1;
    const gain = mate ? PROG.mergeSpeed * 2 : 0.18;
    e.vx = (e.vx + (tx / len) * gain) * 0.94;
    e.vy = (e.vy + (ty / len) * gain) * 0.94;
    if (e.gen === 0) {
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.aiTimer = PROG.budEvery;
        const a = Math.random() * Math.PI * 2;
        m.queueSpawn('mitosis', e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, m.waveScaleFor('mitosis', e.bossWave), {
          instant: true, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3
        });
      }
    }
  },
  trace(ctx, e, r) {
    traceCell(ctx, { pulsePhase: e.pulsePhase, growT: 0 }, r);
    // A ring of smaller nuclei (the cells it holds) circling a pulsing nucleolus.
    const n = 3 + (2 - (e.gen || 0)) * 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + e.pulsePhase * 0.1;
      const x = Math.cos(a) * r * 0.55;
      const y = Math.sin(a) * r * 0.55;
      ctx.moveTo(x + r * 0.12, y);
      ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
    }
    const nr = r * (0.2 + Math.sin(e.pulsePhase * 0.9) * 0.03);
    ctx.moveTo(nr, 0);
    ctx.arc(0, 0, nr, 0, Math.PI * 2);
    // Cilia: a fringe of short hairs beating round the membrane (bristling out while it lashes).
    const cilia = 16 + (2 - (e.gen || 0)) * 4;
    const bristle = e.lashHold > 0 ? 0.32 : 0.16;
    for (let k = 0; k < cilia; k++) {
      const a = (k / cilia) * Math.PI * 2 - e.rotation;
      const wave = Math.sin(e.pulsePhase * 1.6 + k * 0.9);
      const r0 = r * 1.04;
      const r1 = r * (1.04 + bristle + wave * 0.05);
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a + wave * 0.08) * r1, Math.sin(a + wave * 0.08) * r1);
    }
  },
  overlay(ctx, e, r) {
    drawBossFlair(ctx, e, r);
    if (e.lashHold > 0 && e.lashA) {
      // Pseudopod stubs swelling out of the membrane toward each marked spoke.
      const g = PROG.gens[e.gen || 0];
      const k = 1 - e.lashHold / g.warn;
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${0.5 + 0.4 * k})`;
      ctx.lineWidth = 3 + k * 3;
      ctx.beginPath();
      for (const a of e.lashA) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(e.x + c * r, e.y + s * r);
        ctx.lineTo(e.x + c * r * (1.2 + k * 0.6), e.y + s * r * (1.2 + k * 0.6));
      }
      ctx.stroke();
    }
  },
  onDeath(e, m) {
    const gen = e.gen || 0;
    const n = gen + 1 < PROG.gens.length ? PROG.children : PROG.cells;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const vx = Math.cos(a) * 4;
      const vy = Math.sin(a) * 4;
      if (gen + 1 < PROG.gens.length) {
        spawnPiece(m, e.root || e, gen + 1, e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12, vx, vy, PROG.gens[gen + 1].hp * (e.root || e).fullHp);
      } else {
        m.queueSpawn('mitosis', e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, m.waveScaleFor('mitosis', e.bossWave), { instant: true, vx, vy });
      }
    }
    const env = m.aiEnv || {};
    if (gen === 0) {
      // The first division: the phase change, a membrane tearing open.
      phaseShift(e, m, env, 360);
      cue(m, 'prog_squelch');
    } else if (gen === PROG.gens.length - 1 && e.root && piecesOf(e.root, m) === 0) {
      deathBloom(e, m, [95, 140, 60], 'prog_squelch');
    } else {
      env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 4, e.hue, 4, 0.4);
      cue(m, 'prog_squelch');
    }
  }
};

// --- THE CONDUCTOR (wave 24, major) ---------------------------------------------------------
// Hangs back and beam-links up to 8 hostiles round it: linked hulls take less damage and move faster
// (the Conduit buff), and while 4 or more links hold the Conductor itself is untouchable. Kill what it
// is linked to and the shield drops. It keeps calling in a choir to relink, led by a Repulsor. At half
// HP it plays the CRESCENDO: every few seconds each linked hull fires an orb at you.
export const COND = {
  links: 8, linkRange: 600, shieldLinks: 4, hold: 360, choirEvery: 6, choirCap: 10, rageAt: 0.5,
  crescendoEvery: 3, orbSpeed: 3.6
};

const conductor = {
  ram: { range: 440, speed: 9.5, cooldown: 5.5, overshoot: 180 },
  name: 'THE CONDUCTOR', epithet: 'EVERY HULL IS AN INSTRUMENT', tier: 'major', hue: 165, debut: ['conduit', 'repulsor'],
  stats: () => ({ speed: 2.0, radius: 30, sides: 5, vRot: 0 }),
  onArrive(e, m) {
    e.links = [];
    e.aiTimer = 1;
    e.crescendoT = COND.crescendoEvery;
    e.enraged = false;
    callChoir(e, m, true);
  },
  update(e, m, env) {
    const { dt, dirX, dirY, dist, player } = env;
    const radial = dist > COND.hold + 60 ? 0.2 : dist < COND.hold - 60 ? -0.2 : 0;
    e.vx = (e.vx + (radial > 0 ? env.moveX : dirX) * radial - dirY * e.strafeSign * 0.06) * 0.92;
    e.vy = (e.vy + (radial > 0 ? env.moveY : dirY) * radial + dirX * e.strafeSign * 0.06) * 0.92;
    e.rotation += 0.5 * dt;
    // Relink every tick: the nearest hostiles in range (no bosses, parts or body plates).
    e.links.length = 0;
    const near = [];
    for (const o of m.enemyIndex.query(e.x, e.y, COND.linkRange)) {
      if (o === e || o.dead || o.isBoss || o.leader || o.mount || o.type === 'blackhole' || o.type === 'gate') continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d <= COND.linkRange) near.push([d, o]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < near.length && k < COND.links; k++) {
      const o = near[k][1];
      o.linked = 0.25; // the Conduit buff: less damage taken, more speed
      e.links.push(o);
    }
    e.deflect = e.links.length >= COND.shieldLinks;
    if (!e.enraged && e.hp <= e.maxHp * COND.rageAt) {
      e.enraged = true;
      env.particles?.spawnShockwave?.(e.x, e.y, 300, e.hue, 5, 0.5);
    }
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      e.aiTimer = COND.choirEvery;
      callChoir(e, m, false);
    }
    if (!e.enraged) return;
    e.crescendoT -= dt;
    if (e.crescendoT <= 0) {
      e.crescendoT = COND.crescendoEvery;
      for (const o of e.links) {
        const a = Math.atan2(player.y - o.y, player.x - o.x);
        fireOrb(m, o, a, COND.orbSpeed);
      }
      m.shotsFired = (m.shotsFired || 0) + 1;
    }
  },
  trace(ctx, e, r) {
    // A pentagonal podium with a baton through it and five strings to its corners.
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.moveTo(-r * 1.3, r * 0.3);
    ctx.lineTo(r * 1.3, -r * 0.3);
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
    }
  },
  overlay(ctx, e, r) {
    // Link beams to every instrument, and the shield bubble while enough of them hold.
    const flicker = 0.55 + Math.sin(e.pulsePhase * 2.2) * 0.25;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? `hsla(${e.hue}, 100%, 55%, ${0.2 * flicker})` : `hsla(${e.hue}, 100%, 82%, ${0.7 * flicker})`;
      ctx.lineWidth = pass === 0 ? 5 : 1.3;
      ctx.beginPath();
      for (const o of e.links || []) {
        if (o.dead) continue;
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(o.x, o.y);
      }
      ctx.stroke();
    }
    if (e.deflect) {
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 80%, ${0.35 + (e.hitFlash || 0) * 0.5})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
};

// The choir: pinwheels and weavers round a Repulsor (a Conduit too on arrival), kept under a cap.
function callChoir(e, m, arrival) {
  let n = 0;
  for (const o of m.enemies) if (o.parent === e && !o.dead) n++;
  const room = COND.choirCap - n;
  if (room <= 0) return;
  const types = arrival ? ['repulsor', 'conduit', 'pinwheel', 'pinwheel', 'weaver', 'weaver'] : ['repulsor', 'pinwheel', 'weaver', 'pinwheel'];
  types.slice(0, room).forEach((type, k) => {
    const a = (k / types.length) * Math.PI * 2 + Math.random();
    m.queueSpawn(type, e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, m.waveScaleFor(type, e.bossWave), {
      instant: true, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, attach: { parent: e }
    });
  });
}

// --- ECLIPSE TWINS (wave 45, minor) ---------------------------------------------------------
// SOL and LUNA circle a point that trails after you, roughly opposite each other, joined by a burning
// tether. The angle between them breathes, so the tether sweeps back and forth across the ring: stay off
// its line. Their signature is the ECLIPSE: they rush together onto the point, a marked disc spreads
// under them as the moon covers the sun, and it bursts in a NOVA (the disc and a ring of orbs). Get
// out of the circle. At half their combined HP the ring tightens and spins faster and the eclipse comes
// quicker, its nova a double ring. Kill one and the survivor enrages (faster, firing lancer beams), and
// if it is not finished within REVIVE seconds its twin returns at half HP. Beaten (and paid out) when
// both are down together.
export const TWINS = {
  orbitR: 260, spin: 0.55, rageSpin: 0.95, sweep: 0.9, sweepRate: 0.8, centerSpeed: 2.2, speed: 4.4, radius: 38,
  hpScale: 0.6, reviveTime: 10, reviveHp: 0.5, tetherWidth: 6, rageLanceCooldown: 2.2,
  // Half combined HP: the tighter, faster ring.
  phaseAt: 0.5, phaseOrbitR: 195, phaseSpin: 0.85,
  // Eclipse: every eclipseEvery s (phaseEclipseEvery after the phase change; the first after
  // eclipseFirst), the pair converges and a novaR px disc warns for novaWarn s, then hits for
  // novaDamage of their contact hit and fires novaOrbs orbs (two rings after the phase change).
  eclipseFirst: 5, eclipseEvery: 9.5, phaseEclipseEvery: 7, novaR: 200, novaWarn: 1.7, novaDamage: 0.5, novaOrbs: 14, novaHold: 0.5
};

function twinsOf(e, m) {
  const out = [];
  for (const o of m.enemies) if (o.type === 'eclipse_twins' && o.root === e.root && !o.dead) out.push(o);
  return out;
}

function spawnTwin(m, root, role, x, y, hp) {
  return m.queueSpawn('eclipse_twins', x, y, 1, {
    instant: true, wave: root.bossWave,
    attach: { root, splitChild: true, twinRole: role, hp, maxHp: root.maxHp, hue: role === 'luna' ? 275 : 48, name: role === 'luna' ? 'LUNA' : 'SOL' }
  });
}

// Start an eclipse: the point jumps onto the ship (where it is heading), the nova disc is marked
// there, and both twins dive in.
function startEclipse(root, e, m, player) {
  root.centerX = player.x + (player.vx || 0) * 8;
  root.centerY = player.y + (player.vy || 0) * 8;
  root.eclipseT = TWINS.novaWarn + TWINS.novaHold; // the rush and the warning, then a beat in the nova
  m.bossTelegraphs?.zone(root.centerX, root.centerY, TWINS.novaR, {
    warn: TWINS.novaWarn, hue: 40, damage: hazardDamage(TWINS.novaDamage), from: e.type,
    onFire: (h) => {
      cue(m, 'twins_nova');
      const rings = root.phase2 ? 2 : 1;
      const src = { x: h.x, y: h.y, radius: 20, type: e.type };
      for (let ring = 0; ring < rings; ring++) {
        const off = Math.random() * Math.PI * 2;
        for (let k = 0; k < TWINS.novaOrbs; k++) fireOrb(m, src, off + (k / TWINS.novaOrbs) * Math.PI * 2, 2.4 + ring * 1.1, 6);
      }
      m.shotsFired = (m.shotsFired || 0) + 1;
      const p = m.aiEnv?.particles;
      p?.spawnShockwave?.(h.x, h.y, TWINS.novaR * 1.6, 48, 6, 0.5);
      p?.spawnShockwave?.(h.x, h.y, TWINS.novaR * 1.1, 275, 4, 0.4);
    }
  });
  cue(m, 'twins_eclipse');
}

const eclipseTwins = {
  name: 'ECLIPSE TWINS', epithet: 'SOL AND LUNA', tier: 'minor', hue: 48, debut: ['lancer'],
  hpScale: TWINS.hpScale,
  stats: () => ({ speed: TWINS.speed, radius: TWINS.radius, sides: 8, vRot: 0 }),
  onArrive(e, m) {
    e.root = e;
    e.twinRole = 'sol';
    e.name = 'SOL';
    e.orbitTheta = Math.random() * Math.PI * 2;
    e.clock = 0;
    e.centerX = e.x;
    e.centerY = e.y;
    e.eclipseCd = TWINS.eclipseFirst;
    spawnTwin(m, e, 'luna', e.x + 60, e.y, e.maxHp);
    arriveFx(e, m, 'twins_chime');
  },
  isFinalPiece(e, m) {
    return twinsOf(e, m).length === 0; // its twin is already down
  },
  update(e, m, env) {
    const { dt, player } = env;
    const root = e.root || e;
    const pair = twinsOf(e, m);
    const partner = pair.find(o => o !== e) || null;
    const lead = !partner || e.twinRole === 'sol';
    if (e.introT === undefined && e !== root) e.introT = BOSS_INTRO; // LUNA's own entrance halo
    if (lead) {
      // The leader keeps the shared clock: the ring's spin, the point it circles, and the eclipse.
      if (partner && !root.phase2 && e.hp + partner.hp <= root.maxHp * 2 * TWINS.phaseAt) {
        root.phase2 = true;
        phaseShift(e, m, env, 300);
        phaseShift(partner, m, env, 300);
      }
      root.clock = (root.clock || 0) + dt;
      const spin = partner ? (root.phase2 ? TWINS.phaseSpin : TWINS.spin) : TWINS.rageSpin;
      if (root.eclipseT > 0) {
        root.eclipseT = Math.max(0, root.eclipseT - dt);
      } else {
        root.orbitTheta = (root.orbitTheta || 0) + spin * dt;
        const cx = root.centerX ?? e.x;
        const cy = root.centerY ?? e.y;
        const dx = player.x - cx;
        const dy = player.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        const step = Math.min(d, TWINS.centerSpeed);
        root.centerX = cx + (dx / d) * step;
        root.centerY = cy + (dy / d) * step;
        root.eclipseCd = (root.eclipseCd ?? TWINS.eclipseFirst) - dt;
        if (partner && root.eclipseCd <= 0) {
          root.eclipseCd = root.phase2 ? TWINS.phaseEclipseEvery : TWINS.eclipseEvery;
          startEclipse(root, e, m, player);
        }
      }
    }
    const eclipsing = !!partner && root.eclipseT > 0;
    const orbitR = eclipsing ? 0 : root.phase2 ? TWINS.phaseOrbitR : TWINS.orbitR;
    const delta = Math.sin((root.clock || 0) * TWINS.sweepRate) * TWINS.sweep;
    const a = (root.orbitTheta || 0) + (e.twinRole === 'luna' ? Math.PI + delta : 0);
    // Eclipsing, LUNA sits a few px off SOL's centre: the crescent covers the sun.
    const off = eclipsing && e.twinRole === 'luna' ? 10 : 0;
    const tx = (root.centerX ?? player.x) + Math.cos(a) * orbitR + off;
    const ty = (root.centerY ?? player.y) + Math.sin(a) * orbitR;
    const holding = !partner && lanceCycle(e, env, { cooldown: TWINS.rageLanceCooldown });
    const pullK = holding ? 0.02 : eclipsing ? 0.12 : 0.08;
    e.vx = (tx - e.x) * pullK;
    e.vy = (ty - e.y) * pullK;
    e.burstSpeed = eclipsing ? TWINS.speed * 1.6 : 0; // headroom to make the rendezvous in time
    e.rotation += (partner ? 1 : 2.5) * dt;
    if (partner) {
      e.lanceState = 'idle';
      // SOL carries the tether to LUNA (it goes dark while they overlap).
      e.beam = e.twinRole === 'sol' && !eclipsing ? { x1: e.x, y1: e.y, x2: partner.x, y2: partner.y, width: TWINS.tetherWidth } : null;
      e.reviveT = 0;
      return;
    }
    if (!holding && e.lanceState !== 'fire') e.beam = null;
    if (e.reviveT > 0) {
      e.reviveT -= dt;
      if (e.reviveT <= 0) {
        // Too slow: the fallen twin returns at half HP.
        const role = e.twinRole === 'sol' ? 'luna' : 'sol';
        spawnTwin(m, root, role, e.x + 50, e.y, root.maxHp * TWINS.reviveHp);
        env.particles?.spawnShockwave?.(e.x, e.y, 220, role === 'luna' ? 275 : 48, 5, 0.45);
        cue(m, 'twins_chime');
      }
    }
  },
  trace(ctx, e, r) {
    if (e.twinRole === 'luna') {
      // A crescent moon with three craters on its lit limb.
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.moveTo(r * 0.55 + r * 0.8, 0);
      ctx.arc(r * 0.55, 0, r * 0.8, 0, Math.PI * 2);
      for (const [x, y, cr] of [[-r * 0.62, -r * 0.3, 0.13], [-r * 0.7, r * 0.25, 0.1], [-r * 0.35, r * 0.62, 0.08]]) {
        ctx.moveTo(x + r * cr, y);
        ctx.arc(x, y, r * cr, 0, Math.PI * 2);
      }
      return;
    }
    // A sun: a disc, an inner churning ring and a corona of twelve flaring spikes.
    ctx.moveTo(r * 0.7, 0);
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.moveTo(r * 0.42, 0);
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 1.5);
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      const flare = 1.22 + 0.16 * Math.sin(e.pulsePhase * 1.3 + k * 2.1);
      ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      ctx.lineTo(Math.cos(a + 0.2) * r * flare, Math.sin(a + 0.2) * r * flare);
    }
  },
  overlay(ctx, e, r) {
    drawBossFlair(ctx, e, r);
    if (e.beam) drawBeam(ctx, e.beam, e.lanceState === 'fire' ? e.hue : 320);
    drawLanceAim(ctx, e);
    const root = e.root || e;
    if (e.twinRole === 'sol' && root.eclipseT > 0) {
      // The eclipse: a dark-ringed corona swelling round the pair as the nova charges.
      const k = Math.max(0, Math.min(1, 1 - (root.eclipseT - TWINS.novaHold) / TWINS.novaWarn));
      ctx.strokeStyle = `hsla(40, 100%, 75%, ${0.3 + 0.5 * k})`;
      ctx.lineWidth = 2 + k * 3;
      ctx.beginPath();
      for (let s = 0; s < 24; s++) {
        const a = (s / 24) * Math.PI * 2 + k * 1.5;
        const r0 = r * 1.4;
        const r1 = r * (1.6 + k * (1.4 + 0.6 * Math.sin(s * 2.7 + e.pulsePhase)));
        ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
        ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
      }
      ctx.stroke();
      ctx.strokeStyle = `hsla(275, 100%, 70%, ${0.4 + 0.4 * k})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 1.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.reviveT > 0) {
      // Revive countdown: a ring that closes as the fallen twin's return nears.
      ctx.strokeStyle = `hsla(${e.twinRole === 'sol' ? 275 : 48}, 100%, 70%, 0.8)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 1.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (e.reviveT / TWINS.reviveTime));
      ctx.stroke();
    }
  },
  onDeath(e, m) {
    const rest = twinsOf(e, m).filter(o => o !== e);
    for (const o of rest) {
      o.reviveT = TWINS.reviveTime; // finish it before its twin comes back
      o.beam = null;
    }
    const root = e.root || e;
    root.eclipseT = 0;
    if (rest.length === 0) deathBloom(e, m, [48, 275, 20], 'twins_nova');
    else phaseShift(rest[0], m, m.aiEnv || {}, 260);
  }
};

// --- THE PRISM (wave 30, major: the finale) --------------------------------------------------
// A spinning triangular prism that cycles through every color and fights with the whole campaign's
// moves, one phase per third of its HP:
//   SWARM       (full → 2/3): a ring of shard swarmers that peel off to dive or circle, like the Queen's.
//   LATTICE     (2/3 → 1/3): gate cages dropped round you, like the Architect's.
//   SINGULARITY (1/3 → 0):   it becomes a gravity well that exhales orb rings, with a lighthouse beam
//                            sweeping round it.
// Past wave 30 the run goes on, and bosses start arriving in pairs.
export const PRISM = {
  hpScale: 1.3, phaseAt: [2 / 3, 1 / 3], ring: 12, peelEvery: 2.6, hatchEvery: 1.1, cageEvery: 6.5,
  pullRadius: 380, breathEvery: 4, orbRing: 20, beamSpin: 0.6, beamLength: 520, beamWarmup: 1.5, speed: 1.8
};

const PRISM_PHASES = ['SWARM', 'LATTICE', 'SINGULARITY'];

const prism = {
  ram: { range: 380, cooldown: 5, when: (e) => e.phase < 2 }, // phase 2 has the lighthouse beam
  name: 'THE PRISM', epithet: 'ALL LIGHT, ALL AT ONCE', tier: 'major', hue: 0, debut: [],
  hpScale: PRISM.hpScale,
  stats: () => ({ speed: PRISM.speed, radius: 40, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.phase = 0;
    e.aiTimer = PRISM.peelEvery;
    e.hatchT = 0;
    e.cageT = 1.5;
    e.breathT = PRISM.breathEvery;
    e.beamAngle = 0;
    e.beamWarm = 0;
    for (let k = 0; k < PRISM.ring; k++) {
      const a = (k / PRISM.ring) * Math.PI * 2;
      hatch(e, m, e.x + Math.cos(a) * QUEEN.orbitR, e.y + Math.sin(a) * QUEEN.orbitR, true);
    }
  },
  update(e, m, env) {
    const { dt, player } = env;
    e.hue = (e.hue + 70 * dt) % 360; // the spectrum, round and round
    e.rotation += (0.6 + e.phase * 0.4) * dt;
    e.vx = (e.vx + env.moveX * 0.18) * 0.94;
    e.vy = (e.vy + env.moveY * 0.18) * 0.94;
    const frac = e.hp / e.maxHp;
    const phase = frac <= PRISM.phaseAt[1] ? 2 : frac <= PRISM.phaseAt[0] ? 1 : 0;
    if (phase > e.phase) {
      e.phase = phase;
      if (phase === 1) for (const o of queenOrbiters(e, m)) release(o, player, Math.random() < 0.5); // the swarm breaks
      if (phase === 2) {
        e.gravityWell = true;
        e.pullRadius = PRISM.pullRadius;
        e.bendMult = 1.6;
        e.beamWarm = PRISM.beamWarmup;
        e.beamAngle = Math.atan2(player.y - e.y, player.x - e.x) + Math.PI / 2;
      }
      env.particles?.spawnShockwave?.(e.x, e.y, 340, e.hue, 6, 0.55);
      env.grid?.applyImpulse(e.x, e.y, 90, 340, e.hue);
    }
    if (e.phase === 0) {
      // SWARM: the Queen's ring.
      e.aiTimer -= dt;
      const ring = queenOrbiters(e, m);
      if (e.aiTimer <= 0 && ring.length) {
        e.aiTimer = PRISM.peelEvery;
        ring.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
        ring.slice(0, 4).forEach((o, i) => release(o, player, i % 2 === 0));
      }
      e.hatchT -= dt;
      if (e.hatchT <= 0) {
        e.hatchT = PRISM.hatchEvery;
        if (ringSize(e, m) < PRISM.ring) hatch(e, m, e.x, e.y, true);
      }
    } else if (e.phase === 1) {
      // LATTICE: the Architect's cages.
      e.cageT -= dt;
      if (e.cageT <= 0) {
        e.cageT = PRISM.cageEvery;
        const off = Math.random() * Math.PI * 2;
        for (let k = 0; k < ARCH.cageGates; k++) {
          const a = off + (k / ARCH.cageGates) * Math.PI * 2;
          m.queueSpawn('gate', player.x + Math.cos(a) * ARCH.cageR, player.y + Math.sin(a) * ARCH.cageR, m.waveScaleFor('gate', e.bossWave), {
            warmup: 0.5, attach: { builder: e, cage: { cx: player.x, cy: player.y, a, r: ARCH.cageR, t: ARCH.cageTime } }
          });
        }
      }
    } else {
      // SINGULARITY: a gravity well breathing orb rings, a lighthouse beam sweeping round it.
      e.breathT -= dt;
      if (e.breathT <= 0) {
        e.breathT = PRISM.breathEvery;
        const off = Math.random() * Math.PI * 2;
        for (let k = 0; k < PRISM.orbRing; k++) fireOrb(m, e, off + (k / PRISM.orbRing) * Math.PI * 2, HORIZON.ringSpeed, 6);
        m.shotsFired = (m.shotsFired || 0) + 1;
      }
      if (e.beamWarm > 0) {
        e.beamWarm -= dt; // the telegraph: a thin line where the beam will light
        e.beam = null;
      } else {
        e.beamAngle += PRISM.beamSpin * dt;
        e.beam = beamFrom(e, e.beamAngle, PRISM.beamLength, 8);
      }
    }
  },
  trace(ctx, e, r) {
    // A triangle around a counter-spinning inner triangle, with a spectrum line through it.
    for (const [k, rr] of [[0, 1.25], [Math.PI / 3 - e.rotation * 2, 0.6]]) {
      for (let s = 0; s < 3; s++) {
        const a = k + (s * Math.PI * 2) / 3;
        if (s === 0) ctx.moveTo(Math.cos(a) * r * rr, Math.sin(a) * r * rr);
        else ctx.lineTo(Math.cos(a) * r * rr, Math.sin(a) * r * rr);
      }
      ctx.closePath();
    }
    ctx.moveTo(-r * 1.1, 0);
    ctx.lineTo(r * 1.1, 0);
  },
  overlay(ctx, e, r) {
    if (e.phase === 2 && e.beamWarm > 0) {
      const b = beamFrom(e, e.beamAngle, PRISM.beamLength, 8);
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${0.3 + 0.4 * (1 - e.beamWarm / PRISM.beamWarmup)})`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash?.([10, 8]);
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.setLineDash?.([]);
    }
    if (e.beam) drawBeam(ctx, e.beam, e.hue);
    // Phase pips: which third of the fight this is.
    ctx.fillStyle = `hsla(${e.hue}, 100%, 70%, 0.9)`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(e.x - 14 + k * 14, e.y + r * 1.7, k <= e.phase ? 4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  onDeath(e, m) {
    // The light scatters: a double ring of orbs in every direction.
    for (let k = 0; k < 24; k++) fireOrb(m, e, (k / 24) * Math.PI * 2, k % 2 ? 2 : 3.2, 5);
  }
};
export const PRISM_PHASE_NAMES = PRISM_PHASES;

// --- Boss parts: hulls mounted on a boss (Hive Carrier bays). They ride a fixed spot on its hull,
// have their own HP and AI, and pop when the boss dies.
export const PART_STATS = {
  hive_bay: () => ({
    hp: 100, maxHp: 100, speed: 0, radius: 17, sides: 4, hue: 120, score: 300, xp: 10, vRot: 0, sturdy: true, knockMult: 0
  })
};
export const isBossPart = (type) => Object.hasOwn(PART_STATS, type);

// Per-tick for a mounted part: ride the mount, launch drones; doomed when the mount dies.
export function updateMount(e, m, env) {
  const M = e.mount;
  if (!M || M.dead) {
    e.doomT = (e.doomT ?? 0.12) - env.dt;
    if (e.doomT <= 0 && !e.doomQueued) {
      e.doomQueued = true;
      m.doomed.push(e);
    }
    return;
  }
  const a = M.rotation + e.mountA;
  e.x = M.x + Math.cos(a) * e.mountR;
  e.y = M.y + Math.sin(a) * e.mountR;
  e.vx = M.vx;
  e.vy = M.vy;
  e.rotation = a;
  if (e.type === 'hive_bay') {
    e.aiTimer -= env.dt;
    if (e.aiTimer <= 0) {
      e.aiTimer = HIVE.bayLaunchEvery;
      launchDrones(e, m, 1, HIVE.bayDrones, m.waveScaleFor('drone', M.bossWave));
    }
  }
}

export function tracePart(ctx, e, r) {
  // A hangar block with launch-door slats facing outward.
  ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(r * 0.2, k * r * 0.45);
    ctx.lineTo(r * 0.8, k * r * 0.45);
  }
}

export function drawPartOverlay(ctx, e, r) {
  if (!(e.sinceHit < 2) || e.hp >= e.maxHp) return;
  ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${0.8 * (1 - e.sinceHit / 2)})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 1.4 + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, e.hp / e.maxHp));
  ctx.stroke();
}

export const BOSS_DEFS = {
  brood_queen: broodQueen,
  ouroboros,
  wing_commander: wingCommander,
  hive_carrier: hiveCarrier,
  event_horizon: eventHorizon,
  architect,
  progenitor,
  conductor,
  eclipse_twins: eclipseTwins,
  prism
};

export const isBossKind = (type) => Object.hasOwn(BOSS_DEFS, type);
export const bossDef = (type) => BOSS_DEFS[type] || null;
export const bossBuilt = (id) => isBossKind(id);

// --- Shared escort steering (called from the swarmer AI in js/enemies.js) ---------------------

// A swarmer tied to a Brood Queen rides her ring. Returns false once she is gone.
export function steerOrbiter(e, env) {
  const a = e.anchor;
  if (!a || a.dead) {
    e.anchor = null;
    return false;
  }
  e.orbitA += QUEEN.orbitSpin * env.dt;
  let tx = a.x + Math.cos(e.orbitA) * e.orbitR;
  let ty = a.y + Math.sin(e.orbitA) * e.orbitR;
  if (e.spearSlot !== undefined && a.state === 'spear') {
    // Drawn into the Queen's spear: a slot in a line out of her nose along the locked lane.
    const d = a.radius + 24 + e.spearSlot * QUEEN.spearGap;
    tx = a.x + Math.cos(a.spearAngle) * d;
    ty = a.y + Math.sin(a.spearAngle) * d;
    e.burstSpeed = 9; // headroom to reach its slot in time
  } else if (e.burstSpeed) e.burstSpeed = 0;
  e.vx = (tx - e.x) * 0.2 + (a.vx || 0);
  e.vy = (ty - e.y) * 0.2 + (a.vy || 0);
  return true;
}

// A swarmer hurled in the Queen's spear flies straight down the lane, then rejoins the flock.
export function steerSpear(e, env) {
  if (!(e.spearFlyT > 0)) return false;
  e.spearFlyT -= env.dt;
  if (e.spearFlyT <= 0) {
    e.burstSpeed = 0;
    return false;
  }
  return true;
}

// A swarmer loosed to circle the ship swings round it, then drops back into the flock (and dives).
export function steerCircler(e, env) {
  if (!(e.circleT > 0)) return false;
  const { player, dt } = env;
  e.circleT -= dt;
  e.circleA += QUEEN.circleSpin * dt * (e.strafeSign || 1);
  const tx = player.x + Math.cos(e.circleA) * QUEEN.circleR;
  const ty = player.y + Math.sin(e.circleA) * QUEEN.circleR;
  e.vx += ((tx - e.x) * 0.08 - e.vx) * 0.3;
  e.vy += ((ty - e.y) * 0.08 - e.vy) * 0.3;
  if (e.circleT <= 0) {
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    e.vx = Math.cos(a) * QUEEN.diveKick;
    e.vy = Math.sin(a) * QUEEN.diveKick;
  }
  return true;
}
