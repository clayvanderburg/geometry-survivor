// Serpents (Geometry Wars snakes): a head that winds toward the ship and a chain of body segments that
// follow it like a rope. Only the head can be hurt; the body blocks shots (`deflect`) and stings on
// contact. When the head dies the body pops segment by segment down the chain.
// Shared by the SERPENT hostile (js/hostiles.js) and the OUROBOROS boss (js/bosses.js).
// Timers are seconds; speeds and steering are px per fixed 60 Hz tick.

export const SERPENT = {
  segments: 8, gap: 17, headRadius: 13, bodyRadius: 10, tailRadius: 6,
  speed: 2.5, turnRate: 2.6, weave: 0.85, weaveRate: 2.1, popDelay: 0.06
};

// Winding pursuit: steer toward the (rock-aware) approach, swung side to side by a slow sine.
export function windToward(e, env, { speed, turnRate = SERPENT.turnRate, weave = SERPENT.weave, weaveRate = SERPENT.weaveRate }) {
  e.weaveT = (e.weaveT || 0) + env.dt * weaveRate;
  const want = Math.atan2(env.moveY, env.moveX) + Math.sin(e.weaveT) * weave;
  e.aimAngle = turnToward(e.aimAngle, want, turnRate * env.dt);
  e.vx = Math.cos(e.aimAngle) * speed;
  e.vy = Math.sin(e.aimAngle) * speed;
  e.rotation = e.aimAngle;
}

// Queue a whole serpent: a head plus `count` body segments trailing behind it along `angle` (the way
// the head faces). Spawns resolve in any order, so each segment's `leader` starts as its leader's
// attach object and is swapped for the live enemy once that materializes (EnemyManager sets `.live`).
// Returns the attach objects [head, ...body] (or null if the head was refused by the enemy cap).
export function spawnSerpent(m, type, x, y, waveScale, count, { angle = 0, extra = {}, gap = SERPENT.gap, radius = SERPENT.bodyRadius, tail = SERPENT.tailRadius, hue = null, boss = false, headRadius = SERPENT.headRadius } = {}) {
  const head = { aimAngle: angle };
  if (!m.queueSpawn(type, x, y, waveScale, { ...extra, attach: head })) return null;
  return [head, ...spawnBody(m, head, x, y, count, waveScale, { angle, extra, gap, radius, tail, hue, boss, headRadius })];
}

// Body segments trailing from (x, y) opposite `angle`, chained onto `leader` (a live enemy or an
// attach object still waiting to materialize). `boss`: the boss type a body belongs to (bigger
// payout, and run stats count its plates as that boss), or false. `path`: optional points to lay the
// plates on instead of a straight line (e.g. a coil from coilPath).
export function spawnBody(m, leader, x, y, count, waveScale, { angle = 0, extra = {}, gap = SERPENT.gap, radius = SERPENT.bodyRadius, tail = SERPENT.tailRadius, hue = null, boss = false, headRadius = SERPENT.headRadius, path = null } = {}) {
  const back = angle + Math.PI;
  const first = gap + Math.max(0, headRadius - radius) * 0.6; // room for a bigger head
  // Segments share the head's warm-up but never its spawn guard: they must not be relocated apart.
  const segExtra = { warmup: extra.warmup, instant: extra.instant, onScreen: extra.onScreen };
  const segs = [];
  for (let k = 0; k < count; k++) {
    const t = count > 1 ? k / (count - 1) : 0;
    const r = radius + (tail - radius) * t * t;
    const d = first + gap * k;
    const seg = { leader, gap: k === 0 ? first : gap, segIndex: k + 1, bodyRadius: r, bossBody: boss, aimAngle: angle };
    if (hue !== null) seg.bodyHue = hue;
    const at = path?.[k] ?? { x: x + Math.cos(back) * d, y: y + Math.sin(back) * d };
    if (!m.queueSpawn('serpent', at.x, at.y, waveScale, { ...segExtra, attach: seg })) break;
    segs.push(seg);
    leader = seg;
  }
  return segs;
}

// Points for `count` plates coiled round (x, y): an outward spiral, one `gap` of body between plates and
// `spacing` between turns, starting `first` from the head and winding `dir` (±1) from `angle`.
export function coilPath(x, y, count, { first, gap, spacing, angle = 0, dir = 1 }) {
  const b = spacing / (Math.PI * 2); // r = r0 + b·θ
  const pts = [];
  let theta = 0;
  let r = first;
  for (let k = 0; k < count; k++) {
    if (k > 0) {
      theta += gap / Math.hypot(r, b);
      r = first + b * theta;
    }
    const a = angle + dir * theta;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  return pts;
}

// The live enemy an attach object (or enemy) stands for, or null while it is still materializing.
export const liveOf = (ref) => (ref && ref.hp !== undefined ? ref : ref?.live || null);

// Called as a chained segment materializes (attach copied onto the enemy): take on the body form.
export function bindSegment(e) {
  if (!e.leader) return;
  e.radius = e.bodyRadius || e.radius;
  if (e.bodyHue !== undefined) e.hue = e.bodyHue;
  e.deflect = true;
  e.sturdy = true;
  e.hp = e.maxHp = 1;
  e.score = e.bossBody ? 40 : 10;
  e.xp = 1;
  e.contactMult = e.bossBody ? 0.6 : 0.8;
  e.vRot = 0;
}

// Per-tick rope follow for a body segment. When its leader is gone the segment is doomed: after a
// short delay it is queued on m.doomed for Game to pop, so a dead head unzips the body down the chain.
export function followLeader(e, m, dt) {
  let L = e.leader;
  if (L && L.hp === undefined) {
    if (!L.live) return; // the leader is still materializing: hold position
    L = e.leader = L.live;
  }
  if (!L || L.dead) {
    e.doomT = (e.doomT ?? SERPENT.popDelay) - dt;
    if (e.doomT <= 0 && !e.doomQueued) {
      e.doomQueued = true;
      m.doomed.push(e);
    }
    return;
  }
  const dx = e.x - L.x;
  const dy = e.y - L.y;
  const d = Math.hypot(dx, dy) || 1;
  const gap = e.gap || SERPENT.gap;
  if (d > gap) {
    e.x = L.x + (dx / d) * gap;
    e.y = L.y + (dy / d) * gap;
  }
  e.vx = L.vx;
  e.vy = L.vy;
  e.rotation = Math.atan2(L.y - e.y, L.x - e.x);
}

// Segment silhouette: a rounded hex plate with a spine notch, local coordinates (rotated to the leader).
export function traceSegment(ctx, e, r) {
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3;
    const x = Math.cos(a) * r * (s % 3 === 0 ? 1.05 : 0.95);
    const y = Math.sin(a) * r * 0.85;
    if (s === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.moveTo(-r * 0.35, 0);
  ctx.lineTo(r * 0.35, 0);
}

// Serpent head: an arrowhead with two eye slits.
export function traceSerpentHead(ctx, r) {
  ctx.moveTo(r * 1.45, 0);
  ctx.lineTo(r * 0.2, r * 0.95);
  ctx.lineTo(-r * 0.9, r * 0.7);
  ctx.lineTo(-r * 0.6, 0);
  ctx.lineTo(-r * 0.9, -r * 0.7);
  ctx.lineTo(r * 0.2, -r * 0.95);
  ctx.closePath();
  ctx.moveTo(r * 0.45, r * 0.35);
  ctx.lineTo(r * 0.85, r * 0.2);
  ctx.moveTo(r * 0.45, -r * 0.35);
  ctx.lineTo(r * 0.85, -r * 0.2);
}

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function turnToward(current, target, maxStep) {
  const d = wrapAngle(target - current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}
