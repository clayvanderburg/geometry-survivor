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
import { SERPENT, spawnSerpent, spawnBody, windToward, liveOf, turnToward, traceSerpentHead } from './serpents.js';
import { spawnWing, flyRuns, wingmenOf, slotOffset } from './squadrons.js';

// Shared base: the Dreadnought's numbers. Major bosses carry more HP and pay out more.
export const BOSS_BASE_HP = 650;
export const BOSS_TIER = {
  minor: { hp: 1, score: 1500, xp: 30, cores: 3, kicker: '⚠ BOSS ENCOUNTER ⚠' },
  major: { hp: 1.8, score: 2600, xp: 50, cores: 5, kicker: '☠ MAJOR BOSS ☠' }
};

export function bossHp(waveScale, tier = 'minor') {
  return BOSS_BASE_HP * waveScale * (TUNING.bossHpMult ?? 1) * (BOSS_TIER[tier]?.hp ?? 1);
}

// --- BROOD QUEEN (wave 3, minor) ------------------------------------------------------------
// A giant swarmer wrapped in a halo of circling swarmers. Every few seconds a handful peel off: some
// dive straight at the ship, some circle it first. She keeps hatching new ones while the ring is short.
// At half HP the whole brood scatters, she speeds up and births divers instead. She dies in a mayfly
// burst.
export const QUEEN = {
  ring: 16, orbitR: 92, orbitSpin: 1.5, peelEvery: 3.2, peelCount: 5, hatchEvery: 1.3,
  rageAt: 0.5, rageSpeed: 1.9, rageSpawnEvery: 1.7, rageSpawn: 2, deathMayflies: 14,
  circleR: 170, circleSpin: 2.2, circleTime: [1.4, 2.4], diveKick: 5
};

function queenOrbiters(e, m) {
  const out = [];
  for (const o of m.enemies) if (o.anchor === e && !o.dead) out.push(o);
  return out;
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
  if (dive) {
    const a = Math.atan2(player.y - o.y, player.x - o.x);
    o.vx = Math.cos(a) * QUEEN.diveKick;
    o.vy = Math.sin(a) * QUEEN.diveKick;
  } else {
    o.circleT = QUEEN.circleTime[0] + Math.random() * (QUEEN.circleTime[1] - QUEEN.circleTime[0]);
    o.circleA = Math.atan2(o.y - player.y, o.x - player.x);
  }
}

const broodQueen = {
  name: 'BROOD QUEEN', epithet: 'MOTHER OF THE SWARM', tier: 'minor', hue: 325, debut: ['mayfly'],
  stats: () => ({ speed: 1.4, radius: 34, sides: 4, vRot: 0 }),
  onArrive(e, m) {
    e.aiTimer = QUEEN.peelEvery;
    e.hatchT = QUEEN.hatchEvery;
    e.enraged = false;
    for (let k = 0; k < QUEEN.ring; k++) {
      const a = (k / QUEEN.ring) * Math.PI * 2;
      hatch(e, m, e.x + Math.cos(a) * QUEEN.orbitR, e.y + Math.sin(a) * QUEEN.orbitR, true);
    }
  },
  update(e, m, env) {
    const { dt, player } = env;
    e.vx = (e.vx + env.moveX * 0.2) * 0.92;
    e.vy = (e.vy + env.moveY * 0.2) * 0.92;
    if (Math.hypot(e.vx, e.vy) > 0.05) e.rotation = Math.atan2(e.vy, e.vx);

    if (!e.enraged && e.hp <= e.maxHp * QUEEN.rageAt) {
      // The brood scatters: every orbiter breaks loose at once.
      e.enraged = true;
      e.speed = QUEEN.rageSpeed; // the speed cap applies chill (speedScale) on top
      e.aiTimer = QUEEN.rageSpawnEvery;
      queenOrbiters(e, m).forEach((o, i) => release(o, player, i % 2 === 0));
      env.particles?.spawnShockwave?.(e.x, e.y, 260, e.hue, 5, 0.5);
      env.grid?.applyImpulse(e.x, e.y, 60, 260, e.hue);
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
      return;
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
      if (ring.length < QUEEN.ring) hatch(e, m, e.x, e.y, true);
    }
  },
  trace(ctx, e, r) {
    // A giant swarmer diamond with a nested inner diamond and a brood sac at each tip.
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
    for (const [x, y] of [[0, r * 0.8], [0, -r * 0.8], [-r * 1.25, 0]]) {
      ctx.moveTo(x + r * 0.16, y);
      ctx.arc(x, y, r * 0.16, 0, Math.PI * 2);
    }
  },
  onDeath(e, m) {
    for (let k = 0; k < QUEEN.deathMayflies; k++) {
      const a = (k / QUEEN.deathMayflies) * Math.PI * 2 + Math.random() * 0.3;
      m.queueSpawn('mayfly', e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, m.waveScaleFor('mayfly', e.bossWave), {
        instant: true, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6
      });
    }
  }
};

// --- OUROBOROS (wave 6, major) ---------------------------------------------------------------
// A giant serpent. Only its crowned head can be hurt; the long body blocks shots and stings on
// contact. While healthy it winds after you and every few seconds sheds its tail as a small serpent.
// From half HP it hunts: it COILS round the ship in a tightening ring (dash out through the gap where
// head meets tail), REARS with a marked strike lane, STRIKES down it, then winds free and coils again.
export const OURO = {
  segments: 26, gap: 30, headRadius: 30, bodyRadius: 22, tailRadius: 12,
  speed: 2.1, rageSpeed: 2.7, turnRate: 1.7, weave: 0.6, weaveRate: 1.3,
  shedEvery: 7, shedSegments: 3, shedMin: 12, spawnSegments: 6,
  coilAt: 0.5, coilTime: 4.2, coilR0: 330, coilR1: 135, coilSpeed: 3.6,
  rearTime: 0.7, strikeTime: 0.55, strikeSpeed: 10.5, windTime: 3
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
    e.bodyRefs = spawnBody(m, e, e.x, e.y, OURO.segments, 1, {
      angle: e.aimAngle, gap: OURO.gap, radius: OURO.bodyRadius, tail: OURO.tailRadius, hue: e.hue, boss: e.type, headRadius: OURO.headRadius, extra: { instant: true }
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

// --- WING COMMANDER (wave 9, minor) ---------------------------------------------------------
// A big arrowhead that never chases: it leads a V of Kestrels on strafing runs through where you are,
// laying a line of slow drifting mines on either side as it passes, and calls in replacements for lost
// wingmen at the start of each run. At half HP the escort scrambles to hunt on its own, and the
// Commander flies faster runs and opens each one with an aimed five-orb fan.
export const WING = {
  escort: 6, speed: 3.4, rageSpeed: 4.3, turnRate: 1.5, rageTurnRate: 2.1, reinforce: 2,
  mineEvery: 0.28, mineSpeed: 1.1, mineLife: 5.5, fan: 5, fanSpread: 0.22, fanSpeed: 4.2, rageAt: 0.5, deathOrbs: 10
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

const wingCommander = {
  name: 'WING COMMANDER', epithet: 'ACE OF THE KESTREL FLIGHT', tier: 'minor', hue: 30, debut: ['kestrel', 'blinker'],
  stats: () => ({ speed: WING.speed, radius: 30, sides: 3, vRot: 0 }),
  onArrive(e, m) {
    e.state = 'turn';
    e.enraged = false;
    e.aimAngle = Math.random() * Math.PI * 2;
    e.mineT = 0;
    spawnWing(m, e.x, e.y, m.waveScaleFor('kestrel', e.bossWave), WING.escort, { angle: e.aimAngle, leader: e, extra: { instant: true } });
  },
  update(e, m, env) {
    const { dt, player } = env;
    if (!e.enraged && e.hp <= e.maxHp * WING.rageAt) {
      // Scramble: the escort breaks formation and each Kestrel hunts alone.
      e.enraged = true;
      e.speed = WING.rageSpeed;
      for (const o of wingmenOf(e, m)) {
        o.wingLeader = null;
        o.burstSpeed = 0;
        o.state = 'turn';
      }
      env.particles?.spawnShockwave?.(e.x, e.y, 240, e.hue, 4, 0.45);
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
    // A broad delta wing with twin tail fins and a cockpit stripe.
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
  },
  onDeath(e, m) {
    for (let k = 0; k < WING.deathOrbs; k++) fireOrb(m, e, (k / WING.deathOrbs) * Math.PI * 2, 2.2);
  }
};

export const BOSS_DEFS = {
  brood_queen: broodQueen,
  ouroboros,
  wing_commander: wingCommander
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
  const tx = a.x + Math.cos(e.orbitA) * e.orbitR;
  const ty = a.y + Math.sin(e.orbitA) * e.orbitR;
  e.vx = (tx - e.x) * 0.2 + (a.vx || 0);
  e.vy = (ty - e.y) * 0.2 + (a.vy || 0);
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
