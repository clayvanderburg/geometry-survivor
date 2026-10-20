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
// The major bosses (waves 10/20/30/40/50) live in js/bosses-major.js.
import { MAJOR_BOSSES, OURO, HIVE, ARCH, COND, PRISM, PRISM_PHASE_NAMES } from './bosses-major.js';
export { OURO, HIVE, ARCH, COND, PRISM, PRISM_PHASE_NAMES };
const { ouroboros, hive_carrier: hiveCarrier, architect, conductor, prism } = MAJOR_BOSSES;

// Shared base: the Dreadnought's numbers. Major bosses carry more HP and pay out more.
export const BOSS_BASE_HP = 650;
export const BOSS_TIER = {
  minor: { hp: 1, score: 1500, xp: 30, cores: 3 },
  major: { hp: 1.8, score: 2600, xp: 50, cores: 5 }
};

export function bossHp(waveScale, tier = 'minor') {
  return BOSS_BASE_HP * waveScale * (TUNING.bossHpMult ?? 1) * (TUNING.campaignBossHpMult ?? 1) * (BOSS_TIER[tier]?.hp ?? 1);
}

// --- BROOD QUEEN (wave 3, minor) ------------------------------------------------------------
// A giant swarmer wrapped in a halo of circling swarmers. Every few seconds a handful peel off: some
// dive straight at the ship, some circle it first. She keeps hatching new ones while the ring is short.
// At half HP the whole brood scatters, she speeds up and births divers instead. She dies in a mayfly
// burst.
export const QUEEN = {
  ring: 16, orbitR: 92, orbitSpin: 1.5, peelEvery: 3.2, peelCount: 5, hatchEvery: 1.3,
  rageAt: 0.5, rageSpeed: 2.6, rageSpawnEvery: 1.7, rageSpawn: 2, deathMayflies: 14,
  circleR: 170, circleSpin: 2.2, circleTime: [1.4, 2.4], diveKick: 5
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
  ram: { range: 320 }, // js/boss-ram.js: the shared telegraphed charge
  name: 'BROOD QUEEN', epithet: 'MOTHER OF THE SWARM', tier: 'minor', hue: 325, debut: ['mayfly'],
  stats: () => ({ speed: 2.0, radius: 34, sides: 4, vRot: 0 }),
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
    e.vx = (e.vx + env.moveX * 0.25) * 0.92;
    e.vy = (e.vy + env.moveY * 0.25) * 0.92;
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
      if (ringSize(e, m) < QUEEN.ring) hatch(e, m, e.x, e.y, true);
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
  name: 'WING COMMANDER', epithet: 'ACE OF THE KESTREL FLIGHT', tier: 'minor', hue: 30, debut: ['kestrel', 'blinker', 'borer'],
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

// --- EVENT HORIZON (wave 15, minor) ---------------------------------------------------------
// A living black hole. It drifts after you with a huge pull: it tugs your ship (never past the escape
// cap), bends your shots, and drags other hostiles in. Anything it swallows heals it. It breathes:
// it INHALES (stronger pull) and then EXHALES a ring of orbs. At half HP it spits out two vortexes and
// breathes faster. Arrives with two Hulks in tow.
export const HORIZON = {
  pullRadius: 400, bend: 2.2, enemyPull: 0.9, eatHeal: 0.025, eatRadius: 1.05,
  breathEvery: 6, rageBreathEvery: 4, inhaleTime: 1.6, ring: 16, rageRing: 24, ringSpeed: 2.6,
  speed: 1.2, rageAt: 0.5, vortexes: 2, escortHulks: 2
};

const eventHorizon = {
  ram: { range: 420, speed: 7.5, cooldown: 6, windup: 1 }, // the well drags you into the lane
  name: 'EVENT HORIZON', epithet: 'THE HUNGER BETWEEN STARS', tier: 'minor', hue: 280, debut: ['blackhole', 'hulk'],
  stats: () => ({ speed: HORIZON.speed, radius: 40, sides: 12, vRot: 0.02, gravityWell: true, pullRadius: HORIZON.pullRadius, bendMult: HORIZON.bend }),
  onArrive(e, m) {
    e.aiTimer = HORIZON.breathEvery;
    e.inhaleT = 0;
    e.enraged = false;
    e.gravityWell = true;
    e.pullRadius = HORIZON.pullRadius;
    e.bendMult = HORIZON.bend;
    for (let k = 0; k < HORIZON.escortHulks; k++) {
      const a = (k / HORIZON.escortHulks) * Math.PI * 2 + 0.6;
      m.queueSpawn('hulk', e.x + Math.cos(a) * 240, e.y + Math.sin(a) * 240, m.waveScaleFor('hulk', e.bossWave), { instant: true });
    }
  },
  update(e, m, env) {
    const { dt } = env;
    e.vx = (e.vx + env.dirX * 0.08) * 0.95;
    e.vy = (e.vy + env.dirY * 0.08) * 0.95;
    if (!e.enraged && e.hp <= e.maxHp * HORIZON.rageAt) {
      e.enraged = true;
      for (let k = 0; k < HORIZON.vortexes; k++) {
        const a = Math.random() * Math.PI * 2;
        m.queueSpawn('blackhole', e.x + Math.cos(a) * e.radius * 1.5, e.y + Math.sin(a) * e.radius * 1.5, m.waveScaleFor('blackhole', e.bossWave), {
          instant: true, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3
        });
      }
      env.particles?.spawnShockwave?.(e.x, e.y, 300, e.hue, 6, 0.5);
    }
    // Breathing: inhale (pull radius swells), then exhale a ring of orbs.
    e.aiTimer -= dt;
    if (e.inhaleT > 0) {
      e.inhaleT -= dt;
      e.pullRadius = HORIZON.pullRadius * 1.25;
      if (e.inhaleT <= 0) {
        e.pullRadius = HORIZON.pullRadius;
        const n = e.enraged ? HORIZON.rageRing : HORIZON.ring;
        const off = Math.random() * Math.PI * 2;
        for (let k = 0; k < n; k++) fireOrb(m, e, off + (k / n) * Math.PI * 2, HORIZON.ringSpeed, 6);
        m.shotsFired = (m.shotsFired || 0) + 1;
        env.grid?.applyImpulse(e.x, e.y, 60, 260, e.hue);
      }
    } else if (e.aiTimer <= 0) {
      e.aiTimer = e.enraged ? HORIZON.rageBreathEvery : HORIZON.breathEvery;
      e.inhaleT = HORIZON.inhaleTime;
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
    // The horizon itself, and a churning inner ring that tightens on an inhale.
    ctx.moveTo(r, 0);
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const k = e.inhaleT > 0 ? 0.45 : 0.62;
    ctx.moveTo(r * k, 0);
    ctx.arc(0, 0, r * k, 0, Math.PI * 1.6);
  },
  overlay(ctx, e, r) {
    // Accretion disc, a pull rim at the edge of its reach, and a green flash when it feeds.
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
  }
};

// --- PROGENITOR (wave 21, minor) -------------------------------------------------------------
// A giant cell that splits like an Asteroids rock: kill it and it divides into 2 smaller cells, those
// into 2 more each, and the last generation bursts into Mitosis Cells. Pieces left alone knit back:
// unhit for a while they heal, then drift together and merge into the generation above. The boss is
// beaten (and pays out) when its last piece dies. The first cell buds Mitosis Cells as it goes.
export const PROG = {
  gens: [ // per generation: share of the boss HP each piece gets, radius, speed
    { hp: 0.45, radius: 46, speed: 1.6 },
    { hp: 0.25, radius: 32, speed: 2.1 },
    { hp: 0.12, radius: 22, speed: 2.7 }
  ],
  children: 2, cells: 2, budEvery: 5, mergeAfter: 4, regen: 0.03, mergeSpeed: 0.12
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
    attach: { root, gen, splitChild: true, hp, maxHp: g.hp * root.fullHp, radius: g.radius, speed: g.speed, regen: PROG.regen, sinceHit: 0 }
  });
}

const progenitor = {
  ram: { range: 300, cooldown: 7, windup: 0.9, speed: 8 }, // every piece, each on its own clock
  name: 'PROGENITOR', epithet: 'IT IS ALL OF THEM', tier: 'minor', hue: 95, debut: ['mitosis'],
  stats: () => ({ speed: PROG.gens[0].speed, radius: PROG.gens[0].radius, sides: 9, vRot: 0.01 }),
  onArrive(e) {
    e.root = e;
    e.gen = 0;
    e.fullHp = e.maxHp;
    e.maxHp = e.hp = e.fullHp * PROG.gens[0].hp;
    e.regen = PROG.regen;
    e.aiTimer = PROG.budEvery;
  },
  // Only the last piece standing counts as the boss going down (rewards, card).
  isFinalPiece(e, m) {
    if ((e.gen ?? 0) < PROG.gens.length - 1) return false; // it splits into the next generation
    return !e.root || piecesOf(e.root, m) === 0;
  },
  update(e, m, env) {
    const { dt } = env;
    if (e.discarded) return; // absorbed by a sibling this tick
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
        return;
      }
    }
    const tx = mate ? (mate.x - e.x) : env.moveX;
    const ty = mate ? (mate.y - e.y) : env.moveY;
    const len = Math.hypot(tx, ty) || 1;
    const gain = mate ? PROG.mergeSpeed * 2 : 0.16;
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
    // A ring of smaller nuclei: the cells it holds.
    const n = 3 + (2 - (e.gen || 0)) * 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + e.pulsePhase * 0.1;
      const x = Math.cos(a) * r * 0.55;
      const y = Math.sin(a) * r * 0.55;
      ctx.moveTo(x + r * 0.12, y);
      ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
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
  }
};

// --- ECLIPSE TWINS (wave 27, minor) ---------------------------------------------------------
// SOL and LUNA circle a point that trails after you, roughly opposite each other, joined by a burning
// tether. The angle between them breathes, so the tether sweeps back and forth across the ring: stay off
// its line. Kill one and the survivor enrages (faster, firing lancer beams), and if it is not finished
// within REVIVE seconds its twin returns at half HP. Beaten (and paid out) when both are down together.
export const TWINS = {
  orbitR: 260, spin: 0.55, rageSpin: 0.95, sweep: 0.9, sweepRate: 0.8, centerSpeed: 2.2, speed: 4,
  hpScale: 0.6, reviveTime: 10, reviveHp: 0.5, tetherWidth: 6, rageLanceCooldown: 2.2
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

const eclipseTwins = {
  name: 'ECLIPSE TWINS', epithet: 'SOL AND LUNA', tier: 'minor', hue: 48, debut: ['lancer'],
  hpScale: TWINS.hpScale,
  stats: () => ({ speed: TWINS.speed, radius: 26, sides: 8, vRot: 0 }),
  onArrive(e, m) {
    e.root = e;
    e.twinRole = 'sol';
    e.name = 'SOL';
    e.orbitTheta = Math.random() * Math.PI * 2;
    e.clock = 0;
    e.centerX = e.x;
    e.centerY = e.y;
    spawnTwin(m, e, 'luna', e.x + 60, e.y, e.maxHp);
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
    if (lead) {
      // The leader keeps the shared clock: the ring's spin and the point it circles.
      root.clock = (root.clock || 0) + dt;
      root.orbitTheta = (root.orbitTheta || 0) + (partner ? TWINS.spin : TWINS.rageSpin) * dt;
      const cx = root.centerX ?? e.x;
      const cy = root.centerY ?? e.y;
      const dx = player.x - cx;
      const dy = player.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, TWINS.centerSpeed);
      root.centerX = cx + (dx / d) * step;
      root.centerY = cy + (dy / d) * step;
    }
    const delta = Math.sin((root.clock || 0) * TWINS.sweepRate) * TWINS.sweep;
    const a = (root.orbitTheta || 0) + (e.twinRole === 'luna' ? Math.PI + delta : 0);
    const tx = (root.centerX ?? player.x) + Math.cos(a) * TWINS.orbitR;
    const ty = (root.centerY ?? player.y) + Math.sin(a) * TWINS.orbitR;
    const holding = !partner && lanceCycle(e, env, { cooldown: TWINS.rageLanceCooldown });
    e.vx = (tx - e.x) * (holding ? 0.02 : 0.08);
    e.vy = (ty - e.y) * (holding ? 0.02 : 0.08);
    e.rotation += (partner ? 1 : 2.5) * dt;
    if (partner) {
      e.lanceState = 'idle';
      // SOL carries the tether to LUNA.
      e.beam = e.twinRole === 'sol' ? { x1: e.x, y1: e.y, x2: partner.x, y2: partner.y, width: TWINS.tetherWidth } : null;
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
      }
    }
  },
  trace(ctx, e, r) {
    if (e.twinRole === 'luna') {
      // A crescent moon.
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.moveTo(r * 0.55 + r * 0.8, 0);
      ctx.arc(r * 0.55, 0, r * 0.8, 0, Math.PI * 2);
      return;
    }
    // A sun: a disc with eight corona spikes.
    ctx.moveTo(r * 0.7, 0);
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      ctx.lineTo(Math.cos(a + 0.2) * r * 1.3, Math.sin(a + 0.2) * r * 1.3);
    }
  },
  overlay(ctx, e, r) {
    if (e.beam) drawBeam(ctx, e.beam, e.lanceState === 'fire' ? e.hue : 320);
    drawLanceAim(ctx, e);
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
    for (const o of twinsOf(e, m)) {
      if (o === e) continue;
      o.reviveT = TWINS.reviveTime; // finish it before its twin comes back
      o.beam = null;
    }
  }
};

// --- Boss parts: hulls mounted on a boss (Hive Carrier bays). They ride a fixed spot on its hull,
// have their own HP and AI, and pop when the boss dies.
export const PART_STATS = {
  hive_bay: () => ({
    hp: 100, maxHp: 100, speed: 0, radius: 24, sides: 4, hue: 120, score: 300, xp: 10, vRot: 0, sturdy: true, knockMult: 0
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
