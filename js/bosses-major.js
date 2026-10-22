// The MAJOR bosses (waves 10, 20, 30, 40, 50), each with one signature attack that is telegraphed and
// dodgeable in a crowd, a phase change at half HP (the Prism has three phases), an entrance beat, phase
// and death effects, and its own sound cues (js/boss-sfx-major.js). Area attacks are boss telegraphs
// (js/boss-telegraphs.js, m.bossTelegraphs): target circles, blueprint lines, shock rings, plus callouts
// and staged death fx. Registered in js/bosses.js
// (BOSS_DEFS), which documents the def shape. Timers are seconds; speeds are px per 60 Hz tick.
import { TUNING } from './config.js';
import { spawnSerpent, spawnBody, coilPath, windToward, liveOf, turnToward } from './serpents.js';
import { MAJOR_HIT } from './boss-telegraphs.js';
import { queueBossCue as cue } from './boss-sfx-major.js';

// --- Shared kit ------------------------------------------------------------------------------------

// Hazard damage: an orb hit × these on the wave ramp (the game applies the ramp).
export const HAZARD_MULT = { blast: 1.6, line: 1.4, ring: 1.4 };
const hazardDamage = (mult) => (TUNING.enemyBulletDamage ?? 12) * mult;

// A target circle that detonates after `fuse` s: the hit lands only as it goes off, with its cue (and a
// shake that grows with its size).
function addBlast(m, { x, y, r, fuse, hue, from, sound }) {
  return m.bossTelegraphs?.zone(x, y, r, {
    ...MAJOR_HIT, look: 'reticle', warn: fuse, live: 0, window: 0, hue, from, damage: hazardDamage(HAZARD_MULT.blast),
    onFire: (h) => cue(m, sound, h, { shake: r > 150 ? 10 : 3 })
  });
}

// A blueprint line that prints for `fuse` s, then burns as a laser wall for `burn` s. `rehit`: a held
// beam (its owner moves the ends each tick) may hit again this many s after a hit.
function addLine(m, { x1, y1, x2, y2, width, fuse, burn, hue, from, sound = null, owner = null, rehit = 0 }) {
  return m.bossTelegraphs?.lane(x1, y1, x2, y2, width, {
    ...MAJOR_HIT, look: 'blueprint', warn: fuse, live: burn, hue, from, owner, rehit, damage: hazardDamage(HAZARD_MULT.line),
    onFire: sound ? (h) => cue(m, sound, { x: (h.x + h.x2) / 2, y: (h.y + h.y2) / 2 }) : null
  });
}

// The boss's own lines (blueprints not yet printed, beams), taken off the field.
function cancelLines(e, m) {
  const pool = m.bossTelegraphs;
  for (const h of pool?.active || []) if (h.from === e.type && h.kind === 'lane') pool.cancel(h);
}

function fireOrb(m, src, angle, speed, life = 4, from = src.type) {
  const b = m.enemyBullets?.spawn(src.x + Math.cos(angle) * src.radius, src.y + Math.sin(angle) * src.radius,
    Math.cos(angle) * speed, Math.sin(angle) * speed, TUNING.enemyBulletDamage ?? 12, 8);
  if (b) {
    b.life = life;
    b.from = from;
  }
  return b;
}

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Phase change: a white flash on the hull, layered shockwaves, a grid shove, a callout and a roar.
function phaseShift(e, m, env, label, hue = e.hue, sound = 'phase_roar') {
  e.phaseFlash = 1;
  env.particles?.spawnShockwave?.(e.x, e.y, 460, hue, 7, 0.6);
  env.particles?.spawnShockwave?.(e.x, e.y, 280, 0, 4, 0.45);
  env.particles?.spawnExplosionSparks?.(e.x, e.y, 36, hue, 3, 16, 2.4);
  env.grid?.applyImpulse?.(e.x, e.y, 95, 460, hue);
  m.bossTelegraphs?.label(e.x, e.y - e.radius * 2.4, label, { hue, life: 2.2, follow: e });
  cue(m, sound, e, { shake: 14, hitStop: 3 });
}

// Major death: a chain of blasts across the hull, then one huge ring (on top of Game.onBossDefeated).
function majorDeath(e, m, hues, { blasts = 6, dur = 0.9, final = 900 } = {}) {
  cue(m, 'major_death', e, { shake: 18 });
  for (let k = 0; k < blasts; k++) {
    const a = k * 2.4;
    const d = k ? e.radius * (0.5 + (k % 3) * 0.45) : 0;
    m.bossTelegraphs?.fx(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, { delay: (k / blasts) * dur, radius: 150 + k * 45, hue: hues[k % hues.length], width: 5, dur: 0.5, sparks: 16 });
  }
  m.bossTelegraphs?.fx(e.x, e.y, { delay: dur, radius: final, hue: hues[0], width: 10, dur: 1.0, sparks: 60 });
  m.bossTelegraphs?.fx(e.x, e.y, { delay: dur + 0.12, radius: final * 0.6, hue: 48, width: 6, dur: 0.8 });
}

// Entrance hold: the boss stays put for `time` s (restT: the shared RAM waits too) while its intro plays.
function startIntro(e, time) {
  e.restT = time;
  e.introT = time;
  e.introMax = time;
}

function tickFx(e, dt) {
  if (e.phaseFlash > 0) e.phaseFlash = Math.max(0, e.phaseFlash - dt * 1.6);
  if (e.introT > 0) e.introT = Math.max(0, e.introT - dt);
}

// Phase flash: a white ring bursting off the hull. Drawn by every major's overlay.
function drawPhaseFlash(ctx, e, r) {
  if (!(e.phaseFlash > 0)) return;
  const k = e.phaseFlash;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * k})`;
  ctx.lineWidth = 3 + 6 * k;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * (1.2 + (1 - k) * 1.8), 0, Math.PI * 2);
  ctx.stroke();
}

function polygon(ctx, n, rad, rot = 0) {
  for (let k = 0; k < n; k++) {
    const a = rot + (k * Math.PI * 2) / n;
    if (k === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
}

// --- OUROBOROS (wave 10) ---------------------------------------------------------------------------
// A giant horned serpent. Only its crowned head can be hurt; the long spined body blocks shots and stings
// on contact. Phase 1: it hunts you down, and when it gets close it REARS (rattle, red lane, jaws open)
// and STRIKES down the lane; every few seconds it sheds its tail as a small serpent. From half HP it
// MOLTS and hunts with THE NOOSE: it coils round you on a shrinking ring (a red noose marks it, green
// chevrons mark the gap between head and tail: fly out there), then CONSTRICTS, every other plate spitting
// venom inward, and strikes.
export const OURO = {
  segments: 26, gap: 36, headRadius: 42, bodyRadius: 28, tailRadius: 15,
  speed: 3.3, rageSpeed: 4.0, turnRate: 2.0, weave: 0.55, weaveRate: 1.3,
  shedEvery: 7, shedSegments: 3, shedMin: 12, spawnSegments: 6,
  strikeEvery: 4.5, strikeRange: 460,
  coilAt: 0.5, coilTime: 4.2, coilR0: 360, coilR1: 150, coilSpeed: 4.4,
  rearTime: 0.75, strikeTime: 0.55, strikeSpeed: 11.5, windTime: 3, venomSpeed: 3.4,
  // Arrival: the body lies coiled round the head (turns arriveSpacing apart) and the head holds still
  // for arriveRest s before it starts to unwind.
  arriveSpacing: 64, arriveRest: 1.2
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

function ouroRear(e, m) {
  e.state = 'rear';
  e.aiTimer = OURO.rearTime;
  cue(m, 'ouro_rattle', e);
}

const ouroboros = {
  name: 'OUROBOROS', epithet: 'THE COIL THAT DEVOURS', tier: 'major', hue: 245, debut: ['serpent', 'bruiser'],
  stats: () => ({ speed: OURO.speed, radius: OURO.headRadius, sides: 6, vRot: 0 }),
  onArrive(e, m) {
    e.state = 'wind';
    e.aiTimer = OURO.windTime;
    e.shedT = OURO.shedEvery;
    e.strikeT = OURO.strikeEvery * 0.6;
    e.enraged = false;
    e.jaw = 0;
    e.aimAngle = Math.random() * Math.PI * 2;
    startIntro(e, OURO.arriveRest);
    // It arrives coiled: the plates spiral out from behind the head, which then unwinds them.
    const first = OURO.gap + Math.max(0, OURO.headRadius - OURO.bodyRadius) * 0.6;
    const path = coilPath(e.x, e.y, OURO.segments, {
      first, gap: OURO.gap, spacing: OURO.arriveSpacing, angle: e.aimAngle + Math.PI, dir: Math.random() < 0.5 ? -1 : 1
    });
    e.bodyRefs = spawnBody(m, e, e.x, e.y, OURO.segments, 1, {
      angle: e.aimAngle, gap: OURO.gap, radius: OURO.bodyRadius, tail: OURO.tailRadius, hue: e.hue, boss: e.type, headRadius: OURO.headRadius, path, extra: { instant: true }
    });
    cue(m, 'ouro_hiss', e);
  },
  update(e, m, env) {
    const { dt, player } = env;
    tickFx(e, dt);
    const dist = Math.hypot(player.x - e.x, player.y - e.y);
    e.jaw += ((e.state === 'rear' || e.state === 'strike' ? 1 : 0) - e.jaw) * Math.min(1, dt * 10);
    if (!e.enraged && e.hp <= e.maxHp * OURO.coilAt) {
      // The molt: the body flashes, it speeds up and goes for the noose.
      e.enraged = true;
      for (const seg of bodyOf(e)) seg.hitFlash = 1;
      phaseShift(e, m, env, 'THE NOOSE', 285);
      e.restT = 0;
      e.burstSpeed = 0;
      e.state = 'coil';
      e.aiTimer = OURO.coilTime;
      e.coilA = Math.atan2(e.y - player.y, e.x - player.x);
      e.coilDir = Math.random() < 0.5 ? -1 : 1;
    }
    e.aiTimer -= dt;
    if (!e.enraged) {
      // Shedding runs on its own clock in phase 1, whatever the head is doing.
      e.shedT -= dt;
      if (e.shedT <= 0) {
        e.shedT = OURO.shedEvery;
        shedTail(e, m);
      }
    }
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
      e.strikeT -= dt;
      if (e.enraged) {
        if (e.aiTimer <= 0) {
          e.state = 'coil';
          e.aiTimer = OURO.coilTime;
          e.coilA = Math.atan2(e.y - player.y, e.x - player.x);
          e.coilDir = Math.random() < 0.5 ? -1 : 1;
        }
      } else if (e.strikeT <= 0 && dist < OURO.strikeRange) {
        e.strikeT = OURO.strikeEvery;
        ouroRear(e, m);
      }
    } else if (e.state === 'coil') {
      // Circle the ship on a shrinking ring; the body trails round it into a noose.
      const k = 1 - Math.max(0, e.aiTimer) / OURO.coilTime;
      const r = OURO.coilR0 + (OURO.coilR1 - OURO.coilR0) * k;
      e.coilA += e.coilDir * (OURO.coilSpeed * 60 / r) * dt;
      e.coilX = player.x;
      e.coilY = player.y;
      e.coilR = r;
      const tx = player.x + Math.cos(e.coilA) * r;
      const ty = player.y + Math.sin(e.coilA) * r;
      e.speed = OURO.coilSpeed * 1.6;
      e.vx = (tx - e.x) * 0.12;
      e.vy = (ty - e.y) * 0.12;
      e.aimAngle = Math.atan2(e.vy, e.vx);
      e.rotation = e.aimAngle;
      if (e.aiTimer <= 0) {
        constrict(e, m, env);
        ouroRear(e, m);
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
        cue(m, 'ouro_strike', e);
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
    // A horned serpent skull, jaws parting as it rears; slit eyes and a crest ridge.
    const j = e.jaw || 0;
    ctx.moveTo(r * 0.35, 0);
    ctx.lineTo(r * 1.5, -r * 0.08 - j * r * 0.38);
    ctx.lineTo(r * 0.75, -r * 0.72);
    ctx.lineTo(r * 0.1, -r * 0.92);
    ctx.lineTo(-r * 0.3, -r * 0.82);
    ctx.lineTo(-r * 1.3, -r * 1.3);
    ctx.lineTo(-r * 0.72, -r * 0.5);
    ctx.lineTo(-r * 0.9, 0);
    ctx.lineTo(-r * 0.72, r * 0.5);
    ctx.lineTo(-r * 1.3, r * 1.3);
    ctx.lineTo(-r * 0.3, r * 0.82);
    ctx.lineTo(r * 0.1, r * 0.92);
    ctx.lineTo(r * 0.75, r * 0.72);
    ctx.lineTo(r * 1.4, r * 0.08 + j * r * 0.42);
    ctx.closePath();
    ctx.moveTo(r * 0.4, -r * 0.42);
    ctx.lineTo(r * 0.85, -r * 0.3);
    ctx.moveTo(r * 0.4, r * 0.42);
    ctx.lineTo(r * 0.85, r * 0.3);
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(r * 0.15, 0);
    for (const s of [-1, 1]) {
      ctx.moveTo(-r * 0.15, s * r * 0.55);
      ctx.lineTo(-r * 0.55, s * r * 0.95);
    }
  },
  overlay(ctx, e, r) {
    // Eyes: indigo embers that go blood red after the molt (filled, so they read at a glance).
    const c = Math.cos(e.rotation), s = Math.sin(e.rotation);
    const eye = e.enraged ? 'hsla(0, 100%, 62%, 0.95)' : 'hsla(190, 100%, 75%, 0.9)';
    ctx.fillStyle = eye;
    for (const side of [-1, 1]) {
      const lx = r * 0.66, ly = side * r * 0.36;
      ctx.beginPath();
      ctx.arc(e.x + c * lx - s * ly, e.y + s * lx + c * ly, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.jaw > 0.3) {
      // Forked tongue flicking out of the open jaws.
      const flick = r * (0.5 + 0.35 * Math.sin(e.pulsePhase * 5)) * e.jaw;
      const tx = e.x + c * (r * 1.3 + flick), ty = e.y + s * (r * 1.3 + flick);
      ctx.strokeStyle = 'hsla(340, 100%, 65%, 0.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(e.x + c * r * 0.6, e.y + s * r * 0.6);
      ctx.lineTo(tx, ty);
      for (const side of [-1, 1]) {
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + c * r * 0.25 - s * side * r * 0.18, ty + s * r * 0.25 + c * side * r * 0.18);
      }
      ctx.stroke();
    }
    if (e.state === 'coil' && e.coilR) drawNoose(ctx, e);
    if (e.state === 'rear') drawStrikeLane(ctx, e);
    drawPhaseFlash(ctx, e, r);
  },
  onDeath(e, m) {
    majorDeath(e, m, [245, 285, 190]);
  }
};

// The noose: a red dashed ring where the coil is closing, and green chevrons on the gap between the
// head and the tail pointing out of it (the way to escape).
function drawNoose(ctx, e) {
  const k = 1 - Math.max(0, e.aiTimer) / OURO.coilTime;
  const flash = 0.5 + 0.5 * Math.cos(e.aiTimer * Math.PI * (3 + k * 8));
  ctx.strokeStyle = `hsla(0, 100%, 60%, ${0.25 + 0.35 * k + 0.15 * flash})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2 + k;
    ctx.moveTo(e.coilX + Math.cos(a0) * e.coilR, e.coilY + Math.sin(a0) * e.coilR);
    ctx.arc(e.coilX, e.coilY, e.coilR, a0, a0 + 0.14);
  }
  ctx.stroke();
  const body = bodyOf(e);
  const tail = body[body.length - 1];
  if (!tail) return;
  // The gap: halfway from the tail to the head, going round the way the head is travelling.
  const aHead = Math.atan2(e.y - e.coilY, e.x - e.coilX);
  const aTail = Math.atan2(tail.y - e.coilY, tail.x - e.coilX);
  const span = wrapAngle((aHead - aTail) * e.coilDir);
  const gapA = aTail + e.coilDir * (span < 0 ? span + Math.PI * 2 : span) / 2;
  const gx = e.coilX + Math.cos(gapA) * e.coilR;
  const gy = e.coilY + Math.sin(gapA) * e.coilR;
  const ux = Math.cos(gapA), uy = Math.sin(gapA);
  ctx.strokeStyle = `hsla(130, 100%, 62%, ${0.6 + 0.35 * flash})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const d = -30 + i * 22;
    const cx = gx + ux * d, cy = gy + uy * d;
    ctx.moveTo(cx - ux * 10 - uy * 14, cy - uy * 10 + ux * 14);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - ux * 10 + uy * 14, cy - uy * 10 - ux * 14);
  }
  ctx.stroke();
}

// Strike lane: a red corridor the length of the lunge, chevrons filling in as it locks.
function drawStrikeLane(ctx, e) {
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

// The constrict: every other plate near the noose spits a venom orb at the ship.
function constrict(e, m, env) {
  const { player } = env;
  let n = 0;
  bodyOf(e).forEach((seg, i) => {
    if (i % 2) return;
    if (Math.hypot(seg.x - player.x, seg.y - player.y) > OURO.coilR0) return;
    fireOrb(m, seg, Math.atan2(player.y - seg.y, player.x - seg.x), OURO.venomSpeed, 3, 'ouroboros');
    n++;
  });
  if (n) m.shotsFired = (m.shotsFired || 0) + 1;
  env.particles?.spawnShockwave?.(player.x, player.y, OURO.coilR1 * 1.4, 285, 4, 0.5, true);
  cue(m, 'ouro_constrict', e);
}

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

// --- HIVE CARRIER (wave 20) -------------------------------------------------------------------------
// A huge armored mothership with four launch bays. While any bay stands the core is shielded and every
// bay launches homing drones. Its signature is the BOMBING RUN: the bays flash, then lob shells at red
// target circles on and around where you are heading (one shell per standing bay, plus one on you);
// they burst when the circles fill. Destroy the bays and the CORE IS EXPOSED: it spins up, sprays a
// double spiral of orbs, launches gunner pods and walks a CARPET of shells along your path.
export const HIVE = {
  bays: 4, bayRadius: 92, bayHpShare: 0.25, coreHpScale: 0.6, bayLaunchEvery: 2.6, bayDrones: 3,
  holdRange: 300, speed: 2.3, exposedSpeed: 3.0, spin: 0.25, exposedSpin: 0.8, radius: 66,
  spiralEvery: 0.14, spiralStep: 0.45, spiralSpeed: 3.2, podEvery: 7, pods: 2, podCap: 4,
  shellEvery: 6, firstShell: 3.5, salvoWarn: 0.5, shellFuse: 1.3, shellR: 72, shellLead: 0.6, shellSpread: [110, 170],
  carpetEvery: 5, carpetShells: 7, carpetStep: 95, carpetFuse: 1.0, carpetStagger: 0.12, introTime: 1
};

// Live bays (and the angles they ride at), plus queued ones for the shield count.
function baysOf(e, m) {
  const out = [];
  for (const o of m.enemies) if (o.mount === e && !o.dead) out.push(o);
  return out;
}

function bayCount(e, m) {
  let n = baysOf(e, m).length;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.mount === e) n++;
  return n;
}

// Shells on and around where the ship is heading (lead: its velocity × shellLead s).
function bombingRun(e, m, env, bays) {
  const { player } = env;
  const lead = HIVE.shellLead * 60;
  const tx = player.x + (player.vx || 0) * lead;
  const ty = player.y + (player.vy || 0) * lead;
  const shots = [{ x: tx, y: ty }];
  const off = Math.random() * Math.PI * 2;
  for (let k = 0; k < bays.length; k++) {
    const a = off + (k / Math.max(1, bays.length)) * Math.PI * 2;
    const d = HIVE.shellSpread[0] + Math.random() * (HIVE.shellSpread[1] - HIVE.shellSpread[0]);
    shots.push({ x: tx + Math.cos(a) * d, y: ty + Math.sin(a) * d });
  }
  shots.forEach((s, k) => addBlast(m, { x: s.x, y: s.y, r: HIVE.shellR, fuse: HIVE.shellFuse + k * 0.08, hue: 120, from: e.type, sound: 'shell_boom' }));
  e.salvo = shots.map((s, k) => ({ x: s.x, y: s.y, from: bays[k - 1] || e }));
  e.salvoShowT = 0.6;
  cue(m, 'hive_launch', e);
}

// Exposed core: a line of shells walking along the ship's heading, from just behind it to well ahead.
function carpetBomb(e, m, env) {
  const { player } = env;
  let ux = player.vx || 0, uy = player.vy || 0;
  let len = Math.hypot(ux, uy);
  if (len < 0.5) { ux = -(player.y - e.y); uy = player.x - e.x; len = Math.hypot(ux, uy) || 1; } // still: across its line of fire
  ux /= len;
  uy /= len;
  for (let k = 0; k < HIVE.carpetShells; k++) {
    const d = (k - 1.5) * HIVE.carpetStep;
    addBlast(m, { x: player.x + ux * d, y: player.y + uy * d, r: HIVE.shellR * 0.9, fuse: HIVE.carpetFuse + k * HIVE.carpetStagger, hue: 95, from: e.type, sound: 'shell_boom' });
  }
  cue(m, 'hive_launch', e);
}

const hiveCarrier = {
  ram: { range: 380, speed: 8, cooldown: 6.5, windup: 1 },
  name: 'HIVE CARRIER', epithet: 'MOTHER OF A THOUSAND DRONES', tier: 'major', hue: 120, debut: ['carrier', 'drone', 'gunner'],
  hpScale: HIVE.coreHpScale,
  stats: () => ({ speed: HIVE.speed, radius: HIVE.radius, sides: 6, vRot: 0 }),
  onArrive(e, m) {
    e.phase = 1;
    e.deflect = true;
    e.aiTimer = HIVE.podEvery;
    e.shellT = HIVE.firstShell;
    e.spiralT = 0;
    e.spiralA = 0;
    startIntro(e, HIVE.introTime);
    const bayHp = e.maxHp * HIVE.bayHpShare;
    for (let k = 0; k < HIVE.bays; k++) {
      const a = Math.PI / 4 + (k * Math.PI * 2) / HIVE.bays;
      m.queueSpawn('hive_bay', e.x + Math.cos(a) * HIVE.bayRadius, e.y + Math.sin(a) * HIVE.bayRadius, 1, {
        instant: true, attach: { mount: e, mountA: a, mountR: HIVE.bayRadius * 0.5, hp: bayHp, maxHp: bayHp, bossBody: e.type, aiTimer: 0.8 + k * 0.5 }
      });
    }
    cue(m, 'hive_klaxon', e);
  },
  update(e, m, env) {
    const { dt, dist } = env;
    tickFx(e, dt);
    const bays = baysOf(e, m);
    if (e.introT > 0 || bays.some(b => b.mountR < HIVE.bayRadius)) {
      // The bays swing out on their pylons as it arrives.
      for (const b of bays) b.mountR = Math.min(HIVE.bayRadius, b.mountR + HIVE.bayRadius * dt * 0.8);
    }
    if (e.phase === 1 && bayCount(e, m) === 0) {
      // Every bay down: the core is exposed and spins up.
      e.phase = 2;
      e.deflect = false;
      e.speed = HIVE.exposedSpeed;
      e.aiTimer = 1;
      e.shellT = 2;
      phaseShift(e, m, env, 'CORE EXPOSED', e.hue, 'hive_breach');
    }
    if (e.restT > 0) {
      e.restT -= dt;
      e.vx *= 0.85;
      e.vy *= 0.85;
      e.rotation += HIVE.spin * dt;
      return;
    }
    const push = dist > HIVE.holdRange ? 0.2 : dist < HIVE.holdRange - 80 ? -0.06 : 0.02;
    e.vx = (e.vx + env.moveX * push) * 0.94;
    e.vy = (e.vy + env.moveY * push) * 0.94;
    e.rotation += (e.phase === 2 ? HIVE.exposedSpin : HIVE.spin) * dt;
    if (e.salvoShowT > 0) e.salvoShowT -= dt;
    e.shellT -= dt;
    if (e.phase === 1) {
      e.salvoWarn = e.shellT > 0 && e.shellT < HIVE.salvoWarn;
      if (e.shellT <= 0) {
        e.shellT = HIVE.shellEvery;
        bombingRun(e, m, env, bays);
      }
      return;
    }
    if (e.shellT <= 0) {
      e.shellT = HIVE.carpetEvery;
      carpetBomb(e, m, env);
    }
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
    // Armored hex mothership: outer hull, an inner plating ring, hangar ribs, spokes to the bay pylons,
    // and a reactor with three fan blades (cracked open and pulsing once exposed).
    polygon(ctx, 6, r);
    polygon(ctx, 6, r * 0.78, Math.PI / 6);
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      ctx.lineTo(Math.cos(a) * r * 0.87, Math.sin(a) * r * 0.87);
    }
    const exposed = e.phase === 2;
    const core = r * (exposed ? 0.42 + Math.sin(e.pulsePhase * 3) * 0.05 : 0.34);
    ctx.moveTo(core, 0);
    ctx.arc(0, 0, core, 0, Math.PI * 2);
    const fan = -e.rotation * 3;
    for (let k = 0; k < 3; k++) {
      const a = fan + (k * Math.PI * 2) / 3;
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a) * core * 0.6, Math.sin(a) * core * 0.6, Math.cos(a + 0.7) * core * 0.9, Math.sin(a + 0.7) * core * 0.9);
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      ctx.moveTo(Math.cos(a) * core, Math.sin(a) * core);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
    if (exposed) {
      // Hull cracks.
      for (const a of [0.5, 2.3, 4.1]) {
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a + 0.12) * r * 0.82, Math.sin(a + 0.12) * r * 0.82);
        ctx.lineTo(Math.cos(a - 0.05) * r * 0.62, Math.sin(a - 0.05) * r * 0.62);
      }
    }
  },
  overlay(ctx, e, r) {
    // Running lights chasing round the hull.
    const chase = Math.floor(e.pulsePhase * 2) % 12;
    ctx.fillStyle = e.salvoWarn ? 'hsla(0, 100%, 62%, 0.95)' : `hsla(${e.hue}, 100%, 80%, 0.85)`;
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      if (!e.salvoWarn && (k - chase + 12) % 12 > 2) continue;
      const a = e.rotation + (k * Math.PI) / 6;
      const x = e.x + Math.cos(a) * r * 1.04, y = e.y + Math.sin(a) * r * 1.04;
      ctx.moveTo(x + 3.5, y);
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    }
    ctx.fill();
    if (e.phase === 2) {
      // The exposed reactor glows.
      ctx.fillStyle = `hsla(${e.hue}, 100%, 70%, ${0.18 + 0.12 * Math.sin(e.pulsePhase * 3)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.salvoShowT > 0 && e.salvo) {
      // Shell tracks: dashed arcs from each bay to its target circle.
      const k = e.salvoShowT / 0.6;
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, ${0.5 * k})`;
      ctx.lineWidth = 1.6;
      ctx.setLineDash?.([6, 8]);
      ctx.beginPath();
      for (const s of e.salvo) {
        const fx = s.from.dead ? e.x : s.from.x, fy = s.from.dead ? e.y : s.from.y;
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo((fx + s.x) / 2, Math.min(fy, s.y) - 140, s.x, s.y);
      }
      ctx.stroke();
      ctx.setLineDash?.([]);
    }
    if (e.deflect) {
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
    drawPhaseFlash(ctx, e, r);
  },
  onDeath(e, m) {
    majorDeath(e, m, [120, 60, 95], { blasts: 7 });
  }
};

// --- THE ARCHITECT (wave 30) ------------------------------------------------------------------------
// Keeps a working distance and builds laser gates round you, beaming each into place (fly through a gate
// and it blows: lure its guards next to one first). Its signature is the BLUEPRINT: dashed yellow lines
// drawn through where you are going, crossing in an X, that print into laser walls a second later. Get
// off the lines. At half HP it OPENS THE LATTICE: blueprints come as three-line stars, faster, and it
// drops CAGES (a ring of gates round you that closes in; break out through a beam before it tightens).
// When it dies, every gate it built goes up with it.
export const ARCH = {
  range: 320, band: 60, speed: 3.0, radius: 50, buildEvery: 2.4, rageBuildEvery: 1.6, buildTime: 0.7, maxGates: 8,
  ringMin: 170, ringMax: 260, cageEvery: 8, cageGates: 6, cageR: 300, cageTime: 5, guards: 2, rageAt: 0.5,
  printEvery: 5, ragePrintEvery: 4, firstPrint: 3, printFuse: 1.1, printBurn: 0.35, printLen: 760, printWidth: 18,
  printLines: 2, ragePrintLines: 3, printLead: 0.35, printStagger: 0.12, introTime: 1.2
};

function gatesOf(e, m) {
  let n = 0;
  for (const o of m.enemies) if (o.builder === e && !o.dead) n++;
  for (const sp of m.spawnIndicators) if (sp.config.attach?.builder === e) n++;
  return n;
}

function blueprint(e, m, env) {
  const { player } = env;
  const lead = ARCH.printLead * 60;
  const cx = player.x + (player.vx || 0) * lead;
  const cy = player.y + (player.vy || 0) * lead;
  const n = e.enraged ? ARCH.ragePrintLines : ARCH.printLines;
  const off = Math.random() * Math.PI;
  e.draft = [];
  for (let k = 0; k < n; k++) {
    const a = off + (k * Math.PI) / n;
    const dx = Math.cos(a) * ARCH.printLen / 2, dy = Math.sin(a) * ARCH.printLen / 2;
    addLine(m, { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, width: ARCH.printWidth, fuse: ARCH.printFuse + k * ARCH.printStagger, burn: ARCH.printBurn, hue: e.hue, from: e.type, sound: 'arch_print' });
    e.draft.push({ x: cx + dx, y: cy + dy }, { x: cx - dx, y: cy - dy });
  }
  e.draftT = ARCH.printFuse;
  cue(m, 'arch_draft', e);
}

const architect = {
  ram: { range: 460, speed: 10, cooldown: 6, overshoot: 180 },
  name: 'THE ARCHITECT', epithet: 'IT DRAWS THE LINES YOU DIE BEHIND', tier: 'major', hue: 55, debut: ['gate', 'shielder'],
  stats: () => ({ speed: ARCH.speed, radius: ARCH.radius, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.aiTimer = 1.2;
    e.cageT = ARCH.cageEvery * 0.5;
    e.printT = ARCH.firstPrint;
    e.enraged = false;
    startIntro(e, ARCH.introTime);
    for (let k = 0; k < ARCH.guards; k++) {
      const a = (k / ARCH.guards) * Math.PI * 2;
      m.queueSpawn('shielder', e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, m.waveScaleFor('shielder', e.bossWave), { instant: true });
    }
    cue(m, 'arch_chime', e);
  },
  update(e, m, env) {
    const { dt, dirX, dirY, dist, player } = env;
    tickFx(e, dt);
    e.rotation += 0.6 * dt;
    if (!e.enraged && e.hp <= e.maxHp * ARCH.rageAt) {
      e.enraged = true;
      e.cageT = 0.5;
      e.printT = Math.min(e.printT, 2);
      phaseShift(e, m, env, 'THE LATTICE OPENS');
    }
    if (e.buildT > 0) e.buildT -= dt;
    if (e.draftT > 0) e.draftT -= dt;
    if (e.restT > 0) {
      e.restT -= dt;
      e.vx *= 0.85;
      e.vy *= 0.85;
      return;
    }
    const radial = dist > ARCH.range + ARCH.band ? 1 : dist < ARCH.range - ARCH.band ? -1 : 0;
    const rx = radial > 0 ? env.moveX : dirX;
    const ry = radial > 0 ? env.moveY : dirY;
    e.vx = (e.vx + rx * radial * 0.24 - dirY * e.strafeSign * 0.1) * 0.92;
    e.vy = (e.vy + ry * radial * 0.24 + dirX * e.strafeSign * 0.1) * 0.92;
    e.printT -= dt;
    if (e.printT <= 0 && e.ramState !== 'brace' && e.ramState !== 'charge') {
      e.printT = e.enraged ? ARCH.ragePrintEvery : ARCH.printEvery;
      blueprint(e, m, env);
    }
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
    // A drafting triangle (a hexagram once the lattice opens) round a compass ring with a blueprint grid,
    // struts to its corners and a counter-turning T-square.
    polygon(ctx, 3, r * 1.2);
    if (e.enraged) polygon(ctx, 3, r * 1.2, Math.PI);
    ctx.moveTo(r * 0.55, 0);
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 3 + (k * Math.PI * 2) / 3;
      ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
    for (const g of [-0.2, 0.2]) {
      ctx.moveTo(g * r, -r * 0.5);
      ctx.lineTo(g * r, r * 0.5);
      ctx.moveTo(-r * 0.5, g * r);
      ctx.lineTo(r * 0.5, g * r);
    }
    const t = -e.rotation * 2.4;
    const c = Math.cos(t), s = Math.sin(t);
    ctx.moveTo(-c * r * 1.5, -s * r * 1.5);
    ctx.lineTo(c * r * 1.5, s * r * 1.5);
    ctx.moveTo(c * r * 1.5 - s * r * 0.35, s * r * 1.5 + c * r * 0.35);
    ctx.lineTo(c * r * 1.5 + s * r * 0.35, s * r * 1.5 - c * r * 0.35);
  },
  overlay(ctx, e, r) {
    // Glowing corner nodes.
    ctx.fillStyle = `hsla(${e.hue}, 100%, 78%, 0.9)`;
    ctx.beginPath();
    for (let k = 0; k < (e.enraged ? 6 : 3); k++) {
      const a = e.rotation + (k * Math.PI * 2) / (e.enraged ? 6 : 3) + (e.enraged && k % 2 ? Math.PI / 3 - (Math.PI * 2) / 6 : 0);
      const x = e.x + Math.cos(a) * r * 1.2, y = e.y + Math.sin(a) * r * 1.2;
      ctx.moveTo(x + 5, y);
      ctx.arc(x, y, 5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.setLineDash?.([6, 6]);
    if (e.buildT > 0) {
      // Construction beam to the gate it is building.
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 75%, ${0.25 + 0.5 * (e.buildT / ARCH.buildTime)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.buildX, e.buildY);
      ctx.stroke();
    }
    if (e.draftT > 0 && e.draft) {
      // Drafting beams from the hull to the ends of each blueprint line.
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 80%, ${0.5 * (e.draftT / ARCH.printFuse)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const p of e.draft) {
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash?.([]);
    if (e.introT > 0) {
      // Arrival: a blueprint grid unfolds round it and fades.
      const k = e.introT / e.introMax;
      const g = r * (1.5 + (1 - k) * 2.5);
      ctx.strokeStyle = `hsla(205, 100%, 70%, ${0.5 * k})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(e.x + (i * g) / 2, e.y - g);
        ctx.lineTo(e.x + (i * g) / 2, e.y + g);
        ctx.moveTo(e.x - g, e.y + (i * g) / 2);
        ctx.lineTo(e.x + g, e.y + (i * g) / 2);
      }
      ctx.stroke();
    }
    drawPhaseFlash(ctx, e, r);
  },
  onDeath(e, m) {
    // Everything it built comes down with it, gate by gate.
    let k = 0;
    for (const o of m.enemies) {
      if (o.builder !== e || o.dead || o.doomQueued) continue;
      o.doomQueued = true;
      o.noReward = true;
      m.doomed.push(o);
      m.bossTelegraphs?.fx(o.x, o.y, { delay: 0.1 + k++ * 0.08, radius: 200, hue: e.hue, width: 5, dur: 0.4, sparks: 10 });
    }
    cancelLines(e, m); // unprinted blueprints
    majorDeath(e, m, [55, 205, 30]);
  }
};

// --- THE CONDUCTOR (wave 40) ------------------------------------------------------------------------
// Keeps its distance and beam-links up to 8 hostiles round it: linked hulls (marked with a ring and a
// beam) take less damage and move faster. Its shield is the readable part: 4 pips round it light up
// one per link, and while all 4 are lit (4+ links) it is untouchable. Kill what it is linked to and the
// shield breaks ("SHIELD DOWN"); it calls in a choir led by a Repulsor to relink. Its signature is the
// DOWNBEAT: three ticks of its baton (with pulses you can see and hear), then a shock ring rolls out
// from it with gaps in it: fly through a gap (or dash through the ring). At half HP it plays the
// CRESCENDO: double rings, a faster tempo, and every few seconds each linked hull fires an orb at you.
export const COND = {
  links: 8, linkRange: 600, shieldLinks: 4, hold: 320, choirEvery: 6, choirCap: 10, rageAt: 0.5,
  crescendoEvery: 3, orbSpeed: 3.6, speed: 3.0, radius: 48,
  beatEvery: 6, rageBeatEvery: 4.5, firstBeat: 3.5, beat: 0.42, ringSpeed: 6.5, ringWidth: 22, ringMaxR: 760,
  ringGaps: 3, gapW: 0.62, rageRings: 2, ringDelay: 0.5, labelGap: 2.5, introTime: 1
};

function countIn(e) {
  // Beats left before the downbeat (3, 2, 1), or 0 outside the count-in.
  const left = e.beatT / COND.beat;
  return left > 0 && left <= 3 ? Math.ceil(left) : 0;
}

function downbeat(e, m, env) {
  const rings = e.enraged ? COND.rageRings : 1;
  for (let k = 0; k < rings; k++) {
    const off = Math.random() * Math.PI * 2;
    const gaps = Array.from({ length: COND.ringGaps }, (_, i) => off + (i * Math.PI * 2) / COND.ringGaps + (k ? Math.PI / COND.ringGaps : 0));
    // Live at once (no warning: the count-in is its tell); it rolls until its outer edge reaches ringMaxR.
    m.bossTelegraphs?.wave(e.x, e.y, {
      ...MAJOR_HIT, look: 'shock', warn: 0, delay: k * COND.ringDelay, r0: e.radius, w: COND.ringWidth, speed: COND.ringSpeed,
      rMax: COND.ringMaxR - COND.ringWidth, gaps, gapWidth: COND.gapW, hue: e.hue, from: e.type, damage: hazardDamage(HAZARD_MULT.ring)
    });
  }
  e.batonSlam = 1;
  env.grid?.applyImpulse?.(e.x, e.y, 70, 320, e.hue);
  cue(m, 'cond_downbeat', e);
}

const conductor = {
  ram: { range: 440, speed: 9.5, cooldown: 5.5, overshoot: 180, when: (e) => !(e.beatT < COND.beat * 3.2) },
  name: 'THE CONDUCTOR', epithet: 'EVERY HULL IS AN INSTRUMENT', tier: 'major', hue: 165, debut: ['conduit', 'repulsor'],
  stats: () => ({ speed: COND.speed, radius: COND.radius, sides: 5, vRot: 0 }),
  onArrive(e, m) {
    e.links = [];
    e.aiTimer = 1;
    e.crescendoT = COND.crescendoEvery;
    e.beatT = COND.firstBeat;
    e.enraged = false;
    e.labelT = 0;
    startIntro(e, COND.introTime);
    callChoir(e, m, true);
    cue(m, 'cond_hit', e);
  },
  update(e, m, env) {
    const { dt, dirX, dirY, dist, player } = env;
    tickFx(e, dt);
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
    const was = !!e.deflect;
    e.deflect = e.links.length >= COND.shieldLinks;
    e.labelT -= dt;
    if (was !== e.deflect) {
      if (!e.deflect) {
        e.shieldBreak = 1;
        env.particles?.spawnShockwave?.(e.x, e.y, e.radius * 3, e.hue, 4, 0.35);
        env.particles?.spawnExplosionSparks?.(e.x, e.y, 18, e.hue, 3, 12, 2);
      }
      if (e.labelT <= 0 && !(e.introT > 0)) {
        e.labelT = COND.labelGap;
        m.bossTelegraphs?.label(e.x, e.y - e.radius * 2.4, e.deflect ? 'SHIELDED: KILL ITS LINKS' : 'SHIELD DOWN!', { hue: e.deflect ? e.hue : 0, life: 1.6, follow: e });
        cue(m, e.deflect ? 'cond_shield_up' : 'cond_shield_down', e);
      }
    }
    if (e.shieldBreak > 0) e.shieldBreak = Math.max(0, e.shieldBreak - dt * 2);
    if (e.batonSlam > 0) e.batonSlam = Math.max(0, e.batonSlam - dt * 3);
    if (!e.enraged && e.hp <= e.maxHp * COND.rageAt) {
      e.enraged = true;
      e.beatT = Math.min(e.beatT, COND.beat * 3 + 0.6);
      phaseShift(e, m, env, 'CRESCENDO!', e.hue, 'cond_hit');
    }
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      e.aiTimer = COND.choirEvery;
      callChoir(e, m, false);
    }
    if (e.restT > 0) {
      e.restT -= dt;
      e.vx *= 0.85;
      e.vy *= 0.85;
      return;
    }
    // Conducting: it plants for the count-in; otherwise it keeps its distance and circles.
    const planted = e.beatT < COND.beat * 3.2;
    const radial = planted ? 0 : dist > COND.hold + 60 ? 0.24 : dist < COND.hold - 60 ? -0.24 : 0;
    const strafe = planted ? 0 : 0.08;
    e.vx = (e.vx + (radial > 0 ? env.moveX : dirX) * radial - dirY * e.strafeSign * strafe) * (planted ? 0.85 : 0.92);
    e.vy = (e.vy + (radial > 0 ? env.moveY : dirY) * radial + dirX * e.strafeSign * strafe) * (planted ? 0.85 : 0.92);
    const before = countIn(e);
    e.beatT -= dt;
    const now = countIn(e);
    if (now && now !== before) {
      e.beatPulse = 1;
      cue(m, 'cond_tick', e);
    }
    if (e.beatPulse > 0) e.beatPulse = Math.max(0, e.beatPulse - dt * 2.6);
    if (e.beatT <= 0) {
      e.beatT = e.enraged ? COND.rageBeatEvery : COND.beatEvery;
      downbeat(e, m, env);
    }
    if (!e.enraged) return;
    e.crescendoT -= dt;
    if (e.crescendoT <= 0) {
      e.crescendoT = COND.crescendoEvery;
      for (const o of e.links) {
        const a = Math.atan2(player.y - o.y, player.x - o.x);
        fireOrb(m, o, a, COND.orbSpeed, 4, e.type);
      }
      m.shotsFired = (m.shotsFired || 0) + 1;
    }
  },
  trace(ctx, e, r) {
    // A pentagonal podium round a turning pentagram, five strings to its corners.
    polygon(ctx, 5, r, -Math.PI / 2);
    for (let k = 0; k < 5; k++) {
      const a = -e.rotation * 1.6 + (k * 2 * Math.PI * 2) / 5;
      if (k === 0) ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      else ctx.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
    }
    ctx.closePath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  },
  overlay(ctx, e, r) {
    const links = e.links || [];
    // Link beams to every instrument, and a ring round each linked hull.
    const flicker = 0.6 + Math.sin(e.pulsePhase * 2.2) * 0.25;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? `hsla(${e.hue}, 100%, 55%, ${0.25 * flicker})` : `hsla(${e.hue}, 100%, 82%, ${0.8 * flicker})`;
      ctx.lineWidth = pass === 0 ? 6 : 1.6;
      ctx.beginPath();
      for (const o of links) {
        if (o.dead) continue;
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(o.x, o.y);
        if (pass === 1) {
          ctx.moveTo(o.x + o.radius + 7, o.y);
          ctx.arc(o.x, o.y, o.radius + 7, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
    }
    // Staff: three arcs orbiting it.
    ctx.strokeStyle = `hsla(${e.hue}, 100%, 72%, 0.45)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a0 = e.rotation * (k % 2 ? -0.7 : 0.9) + k * 2.1;
      const rr = r * (1.25 + k * 0.12);
      ctx.moveTo(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr);
      ctx.arc(e.x, e.y, rr, a0, a0 + 1.4);
    }
    ctx.stroke();
    // The baton: raised through the count-in, slammed down on the beat.
    const n = countIn(e);
    const lift = n ? (4 - n) / 3 : 0;
    const ba = -Math.PI / 2 - 0.4 + lift * 1.2 - (e.batonSlam || 0) * 0.3;
    const bl = r * (1.5 + lift * 0.3);
    ctx.strokeStyle = n ? 'rgba(255, 255, 255, 0.95)' : `hsla(${e.hue}, 100%, 85%, 0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x - Math.cos(ba) * r * 0.3, e.y - Math.sin(ba) * r * 0.3);
    ctx.lineTo(e.x + Math.cos(ba) * bl, e.y + Math.sin(ba) * bl);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(ba) * bl, e.y + Math.sin(ba) * bl, 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (e.beatPulse > 0) {
      // Count-in pulse: a thin ring off the hull on each tick.
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * e.beatPulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * (1.3 + (1 - e.beatPulse) * 1.6), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Shield pips: one per link up to the 4 it needs; all lit = shielded.
    const R = r * 1.62;
    const lit = Math.min(links.length, COND.shieldLinks);
    for (let k = 0; k < COND.shieldLinks; k++) {
      const a = -Math.PI / 2 + (k - (COND.shieldLinks - 1) / 2) * 0.32;
      const on = k < lit;
      ctx.fillStyle = on ? `hsla(${e.hue}, 100%, 75%, 0.95)` : 'hsla(0, 100%, 60%, 0.55)';
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * R, e.y + Math.sin(a) * R, on ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.deflect) {
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 80%, ${0.45 + (e.hitFlash || 0) * 0.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 70%, 0.18)`;
      ctx.lineWidth = 10;
      ctx.stroke();
    } else if (e.shieldBreak > 0) {
      // Shards of the broken bubble flying off.
      const k = e.shieldBreak;
      ctx.strokeStyle = `hsla(${e.hue}, 100%, 85%, ${k})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a0 = (i * Math.PI) / 4;
        const rr = r * (1.45 + (1 - k) * 1.2);
        ctx.moveTo(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr);
        ctx.arc(e.x, e.y, rr, a0, a0 + 0.35);
      }
      ctx.stroke();
    }
    drawPhaseFlash(ctx, e, r);
  },
  onDeath(e, m) {
    for (const o of e.links || []) o.linked = 0;
    for (let k = 0; k < 3; k++) m.bossTelegraphs?.fx(e.x, e.y, { delay: 0.2 + k * 0.25, radius: 300 + k * 160, hue: e.hue, width: 6, dur: 0.6 });
    majorDeath(e, m, [165, 300, 48]);
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
    m.queueSpawn(type, e.x + Math.cos(a) * 110, e.y + Math.sin(a) * 110, m.waveScaleFor(type, e.bossWave), {
      instant: true, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, attach: { parent: e }
    });
  });
}

// --- THE PRISM (wave 50, the finale) ----------------------------------------------------------------
// A huge crystal prism that cycles through every color. Three phases, one per third of its HP, each
// opened by a REFRACTION (it turns untouchable for a moment, a callout names the phase):
//   I   REFRACTION  (full → 2/3): it plants and fans three colored beams at you (dashed lines first,
//                    then they fire); step out of the fan.
//   II  DISPERSION  (2/3 → 1/3): three beams spin round it like spokes (dashed until they light), and
//                    it throws rainbow orb fans between them; circle with the spokes.
//   III SUPERNOVA   (1/3 → 0):   white-hot and faster, it pulls you in like a gravity well, two spokes
//                    spin faster, and it charges NOVAS: a ring grows round it, then blasts and throws a
//                    ring of orbs. Get out of the ring before it fills.
// Beating it wins the campaign.
export const PRISM = {
  hpScale: 1.3, phaseAt: [2 / 3, 1 / 3], radius: 64, speed: 2.8, rageSpeed: 3.4, shiftTime: 1.4,
  fanEvery: 3.6, firstFan: 2.5, fanFuse: 1.0, fanBurn: 0.5, fanSpread: 0.38, fanLen: 900, fanWidth: 22,
  spokes: 3, spokeSpin: 0.5, spokeLen: 620, spokeWidth: 16, spokeWarmup: 1.6, spokeRehit: 1,
  orbFanEvery: 3, orbFan: 7, orbSpread: 0.16, orbSpeed: 4,
  pullRadius: 420, novaEvery: 5.5, firstNova: 2.5, novaFuse: 1.5, novaR: 280, novaRing: 24, novaRingSpeed: 3,
  novaSpokes: 2, novaSpokeSpin: 0.75, introTime: 1.6
};

export const PRISM_PHASE_NAMES = ['REFRACTION', 'DISPERSION', 'SUPERNOVA'];
const SPECTRUM = [0, 30, 55, 120, 190, 240, 285];

function clearSpokes(e, m) {
  for (const s of e.spokes || []) m.bossTelegraphs?.cancel(s);
  e.spokes = [];
}

function startSpokes(e, m, n) {
  clearSpokes(e, m);
  for (let k = 0; k < n; k++) {
    const h = addLine(m, { x1: e.x, y1: e.y, x2: e.x, y2: e.y, width: PRISM.spokeWidth, fuse: PRISM.spokeWarmup, burn: 1e9, hue: SPECTRUM[(k * 2) % SPECTRUM.length], from: e.type, rehit: PRISM.spokeRehit, owner: e });
    if (h) e.spokes.push(h);
  }
}

function aimSpokes(e) {
  const n = e.spokes.length;
  e.spokes.forEach((h, k) => {
    const a = e.spokeA + (k * Math.PI * 2) / n;
    h.x = e.x + Math.cos(a) * e.radius * 0.8;
    h.y = e.y + Math.sin(a) * e.radius * 0.8;
    h.x2 = e.x + Math.cos(a) * PRISM.spokeLen;
    h.y2 = e.y + Math.sin(a) * PRISM.spokeLen;
  });
}

const prism = {
  ram: { range: 380, cooldown: 5, when: (e) => e.phase < 2 && !(e.castT > 0) && !(e.shiftT > 0) }, // phase III has the nova
  name: 'THE PRISM', epithet: 'ALL LIGHT, ALL AT ONCE', tier: 'major', hue: 0, debut: [],
  hpScale: PRISM.hpScale,
  stats: () => ({ speed: PRISM.speed, radius: PRISM.radius, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.phase = 0;
    e.fanT = PRISM.firstFan;
    e.orbT = PRISM.orbFanEvery;
    e.novaT = PRISM.firstNova;
    e.spokeA = 0;
    e.spokes = [];
    startIntro(e, PRISM.introTime);
    cue(m, 'prism_choir', e);
  },
  update(e, m, env) {
    const { dt, player } = env;
    tickFx(e, dt);
    e.hue = (e.hue + (e.phase === 2 ? 140 : 70) * dt) % 360; // the spectrum, round and round
    e.rotation += (0.6 + e.phase * 0.4) * dt;
    const frac = e.hp / e.maxHp;
    const phase = frac <= PRISM.phaseAt[1] ? 2 : frac <= PRISM.phaseAt[0] ? 1 : 0;
    if (phase > e.phase) {
      e.phase = phase;
      e.shiftT = PRISM.shiftTime;
      e.deflect = true;
      e.castT = 0;
      e.burstSpeed = 0;
      e.ramState = null;
      clearSpokes(e, m);
      cancelLines(e, m);
      phaseShift(e, m, env, `${['I', 'II', 'III'][phase]} · ${PRISM_PHASE_NAMES[phase]}`, e.hue, 'prism_phase');
      for (let k = 0; k < 4; k++) env.particles?.spawnShockwave?.(e.x, e.y, 300 + k * 150, SPECTRUM[(k * 2 + phase) % SPECTRUM.length], 5, 0.5 + k * 0.12);
      if (phase === 2) {
        e.gravityWell = true;
        e.pullRadius = PRISM.pullRadius;
        e.bendMult = 1.6;
        e.novaT = PRISM.firstNova + PRISM.shiftTime;
      }
    }
    if (e.restT > 0 || e.shiftT > 0) {
      // Arriving, or refracting between phases: it holds still (and shrugs off shots while refracting).
      if (e.restT > 0) e.restT -= dt;
      if (e.shiftT > 0) {
        e.shiftT -= dt;
        if (e.shiftT <= 0) {
          e.deflect = false;
          e.spokeA = Math.atan2(player.y - e.y, player.x - e.x) + Math.PI / 3;
          if (e.phase === 1) startSpokes(e, m, PRISM.spokes);
          if (e.phase === 2) startSpokes(e, m, PRISM.novaSpokes);
        }
      }
      e.vx *= 0.85;
      e.vy *= 0.85;
      return;
    }
    if (e.castT > 0) {
      // Planted while a fan or a nova charges.
      e.castT -= dt;
      e.vx *= 0.82;
      e.vy *= 0.82;
    } else {
      const gain = e.phase === 2 ? 0.24 : 0.2;
      e.speed = e.phase === 2 ? PRISM.rageSpeed : PRISM.speed;
      e.vx = (e.vx + env.moveX * gain) * 0.94;
      e.vy = (e.vy + env.moveY * gain) * 0.94;
    }
    if (e.spokes?.length) {
      e.spokeA += (e.phase === 2 ? PRISM.novaSpokeSpin : PRISM.spokeSpin) * dt;
      aimSpokes(e);
    }
    if (e.phase === 0) {
      e.fanT -= dt;
      if (e.fanT <= 0 && e.ramState !== 'brace' && e.ramState !== 'charge') {
        e.fanT = PRISM.fanEvery;
        e.castT = PRISM.fanFuse + PRISM.fanBurn;
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        for (let k = -1; k <= 1; k++) {
          const b = a + k * PRISM.fanSpread;
          addLine(m, {
            x1: e.x + Math.cos(b) * e.radius, y1: e.y + Math.sin(b) * e.radius, x2: e.x + Math.cos(b) * PRISM.fanLen, y2: e.y + Math.sin(b) * PRISM.fanLen,
            width: PRISM.fanWidth, fuse: PRISM.fanFuse, burn: PRISM.fanBurn, hue: [0, 120, 240][k + 1], from: e.type, sound: 'prism_beam'
          });
        }
      }
    } else if (e.phase === 1) {
      e.orbT -= dt;
      if (e.orbT <= 0) {
        e.orbT = PRISM.orbFanEvery;
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        for (let k = 0; k < PRISM.orbFan; k++) fireOrb(m, e, a + (k - (PRISM.orbFan - 1) / 2) * PRISM.orbSpread, PRISM.orbSpeed);
        m.shotsFired = (m.shotsFired || 0) + 1;
      }
    } else {
      e.novaT -= dt;
      if (e.novaT <= 0 && !(e.castT > 0)) {
        e.novaT = PRISM.novaEvery;
        e.castT = PRISM.novaFuse;
        e.novaAt = { x: e.x, y: e.y };
        addBlast(m, { x: e.x, y: e.y, r: PRISM.novaR, fuse: PRISM.novaFuse, hue: 48, from: e.type, sound: 'nova_blast' });
        cue(m, 'prism_charge', e);
      }
      if (e.novaAt && e.castT <= 0) {
        // The nova goes off: a ring of orbs follows the blast.
        const off = Math.random() * Math.PI * 2;
        for (let k = 0; k < PRISM.novaRing; k++) fireOrb(m, e, off + (k / PRISM.novaRing) * Math.PI * 2, PRISM.novaRingSpeed, 5);
        m.shotsFired = (m.shotsFired || 0) + 1;
        env.particles?.spawnShockwave?.(e.x, e.y, PRISM.novaR * 1.6, 48, 7, 0.5);
        env.grid?.applyImpulse?.(e.x, e.y, 100, PRISM.novaR * 2, 48);
        e.novaAt = null;
      }
    }
  },
  trace(ctx, e, r) {
    // A faceted crystal: a big triangle, a counter-turning inverted triangle inside it, facet lines to
    // the corners, and a spectrum line through it.
    polygon(ctx, 3, r * 1.25);
    polygon(ctx, 3, r * 0.62, Math.PI / 3 - e.rotation * 2);
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
    }
    ctx.moveTo(-r * 1.1, 0);
    ctx.lineTo(r * 1.1, 0);
  },
  overlay(ctx, e, r) {
    // Dispersion: a white ray in, a fan of colors out, turning with the crystal.
    const a = e.rotation;
    const c = Math.cos(a), s = Math.sin(a);
    const fan = e.phase === 2 ? SPECTRUM.length * 2 : SPECTRUM.length;
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(e.x - c * r * 2.4, e.y - s * r * 2.4);
    ctx.lineTo(e.x - c * r * 0.3, e.y - s * r * 0.3);
    ctx.stroke();
    for (let k = 0; k < fan; k++) {
      const b = e.phase === 2 ? a + (k / fan) * Math.PI * 2 : a + (k - (fan - 1) / 2) * 0.12;
      const len = r * (e.phase === 2 ? 2.2 + 0.4 * Math.sin(e.pulsePhase * 2 + k) : 2.6);
      ctx.strokeStyle = `hsla(${SPECTRUM[k % SPECTRUM.length]}, 100%, 62%, 0.75)`;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(b) * r * 0.5, e.y + Math.sin(b) * r * 0.5);
      ctx.lineTo(e.x + Math.cos(b) * len, e.y + Math.sin(b) * len);
      ctx.stroke();
    }
    if (e.phase === 2) {
      // White-hot core.
      ctx.fillStyle = `rgba(255, 250, 235, ${0.35 + 0.2 * Math.sin(e.pulsePhase * 4)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.shiftT > 0) {
      // Refracting: a spinning hexagram of light round it.
      const k = e.shiftT / PRISM.shiftTime;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + 0.5 * k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.save();
      ctx.translate(e.x, e.y);
      polygon(ctx, 3, r * 1.8, e.pulsePhase);
      polygon(ctx, 3, r * 1.8, -e.pulsePhase + Math.PI);
      ctx.restore();
      ctx.stroke();
    }
    if (e.introT > 0) {
      // Arrival: three shards of light converge into the crystal.
      const k = e.introT / e.introMax;
      for (let i = 0; i < 3; i++) {
        const b = e.pulsePhase * 0.3 + (i * Math.PI * 2) / 3;
        const d = r * (0.2 + 5 * k);
        ctx.strokeStyle = `hsla(${SPECTRUM[i * 2]}, 100%, 66%, ${0.9 * k + 0.1})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.save();
        ctx.translate(e.x + Math.cos(b) * d, e.y + Math.sin(b) * d);
        polygon(ctx, 3, r * 0.5, b * 2);
        ctx.restore();
        ctx.stroke();
      }
    }
    // Phase pips: which third of the fight this is.
    ctx.fillStyle = `hsla(${e.hue}, 100%, 70%, 0.9)`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(e.x - 18 + k * 18, e.y + r * 1.75, k <= e.phase ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    drawPhaseFlash(ctx, e, r);
  },
  onDeath(e, m) {
    clearSpokes(e, m);
    e.gravityWell = false;
    // The light comes apart: rings in every color, then a white flash.
    for (let k = 0; k < SPECTRUM.length; k++) {
      m.bossTelegraphs?.fx(e.x, e.y, { delay: k * 0.14, radius: 260 + k * 110, hue: SPECTRUM[k], width: 6, dur: 0.7, sparks: 18 });
    }
    majorDeath(e, m, [0, 120, 240, 55], { blasts: 9, dur: 1.2, final: 1300 });
  }
};

export const MAJOR_BOSSES = { ouroboros, hive_carrier: hiveCarrier, architect, conductor, prism };
