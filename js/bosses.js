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
      e.speed = QUEEN.rageSpeed * (e.speedScale || 1);
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

export const BOSS_DEFS = {
  brood_queen: broodQueen
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
