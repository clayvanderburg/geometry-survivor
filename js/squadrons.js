// Squadrons: Kestrels flying in V formation behind a leader (a lead Kestrel, or the Wing Commander).
// A leader never chases: it lines up on the ship, then makes a straight strafing run through where you
// were, overshoots, banks round in a wide U-turn and lines up again. Wingmen hold their slot in the V
// off the leader's heading. When the leader dies, each wingman breaks off and flies its own runs.
// Timers are seconds; speeds and steering are px per fixed 60 Hz tick.
import { turnToward } from './serpents.js';

export const KESTREL = {
  speed: 4.6, turnRate: 2.0, overshoot: 420, slotBack: 30, slotSide: 26, lineUp: 0.14, scatterKick: 1.4
};

// Slot k (1, 2, 3...) of a V: alternating sides, one rank further back per pair.
export function slotOffset(k) {
  const rank = Math.ceil(k / 2);
  const side = k % 2 === 1 ? 1 : -1;
  return { back: KESTREL.slotBack * rank, side: KESTREL.slotSide * rank * side };
}

// Queue a V: a lead Kestrel (unless `leader` is given: a boss or another live hull) plus wingmen in
// slots 1..n. Returns the attach objects. Formation members resolve their leader via `.live` like
// serpent plates (js/serpents.js).
export function spawnWing(m, x, y, waveScale, wingmen, { angle = 0, extra = {}, leader = null, firstSlot = 1 } = {}) {
  const refs = [];
  let lead = leader;
  if (!lead) {
    lead = { aimAngle: angle, state: 'run', aiTimer: 3 };
    if (!m.queueSpawn('kestrel', x, y, waveScale, { ...extra, attach: lead })) return refs;
    refs.push(lead);
  }
  const memberExtra = { warmup: extra.warmup, instant: extra.instant, onScreen: extra.onScreen };
  for (let k = firstSlot; k < firstSlot + wingmen; k++) {
    const o = slotOffset(k);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const wx = x - c * o.back - s * o.side;
    const wy = y - s * o.back + c * o.side;
    const ref = { wingLeader: lead, wingSlot: k, aimAngle: angle };
    if (!m.queueSpawn('kestrel', wx, wy, waveScale, { ...memberExtra, attach: ref })) break;
    refs.push(ref);
  }
  return refs;
}

const live = (ref) => (ref && ref.hp !== undefined ? ref : ref?.live || null);

// Strafing-run flight for a leader: 'turn' banks toward the ship until lined up, then 'run' holds the
// heading long enough to pass through and overshoot by KESTREL.overshoot px.
export function flyRuns(e, env, speed, turnRate) {
  const { player, dt } = env;
  if (e.state !== 'run' && e.state !== 'turn') {
    e.state = 'turn';
  }
  const want = Math.atan2(player.y - e.y, player.x - e.x);
  if (e.state === 'turn') {
    e.aimAngle = turnToward(e.aimAngle, want, turnRate * dt);
    let diff = Math.abs(want - e.aimAngle) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < KESTREL.lineUp) {
      e.state = 'run';
      e.aiTimer = (env.dist + KESTREL.overshoot) / (speed * 60);
      e.runStarted = true;
    }
  } else {
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) e.state = 'turn';
  }
  e.vx = Math.cos(e.aimAngle) * speed;
  e.vy = Math.sin(e.aimAngle) * speed;
  e.rotation = e.aimAngle;
}

// Per-tick Kestrel AI: hold the V slot while the leader lives, else fly its own runs.
export function updateKestrel(e, m, env) {
  let L = e.wingLeader;
  if (L && L.hp === undefined) {
    if (!L.live) { e.vx *= 0.9; e.vy *= 0.9; return; } // leader still materializing
    L = e.wingLeader = L.live;
  }
  if (L && !L.dead) {
    const o = slotOffset(e.wingSlot || 1);
    const c = Math.cos(L.aimAngle);
    const s = Math.sin(L.aimAngle);
    const tx = L.x - c * o.back - s * o.side;
    const ty = L.y - s * o.back + c * o.side;
    e.burstSpeed = KESTREL.speed * 1.6; // headroom to catch up with its slot (lifts the speed cap)
    e.vx = (tx - e.x) * 0.22 + (L.vx || 0);
    e.vy = (ty - e.y) * 0.22 + (L.vy || 0);
    e.aimAngle = L.aimAngle;
    e.rotation = L.aimAngle;
    return;
  }
  if (L) {
    // Leader down: scatter, each on its own run with a startled kick sideways.
    e.wingLeader = null;
    e.burstSpeed = 0;
    e.state = 'turn';
    const side = (e.wingSlot || 1) % 2 === 1 ? 1 : -1;
    e.aimAngle += side * 0.6;
  }
  flyRuns(e, env, e.speed, KESTREL.turnRate);
}

// Live wingmen flying on a leader.
export function wingmenOf(e, m) {
  const out = [];
  for (const o of m.enemies) if (!o.dead && live(o.wingLeader) === e) out.push(o);
  return out;
}

// Kestrel silhouette: a forward-swept dart with a cockpit notch.
export function traceKestrel(ctx, r) {
  ctx.moveTo(r * 1.4, 0);
  ctx.lineTo(-r * 0.7, r * 1.1);
  ctx.lineTo(-r * 0.3, r * 0.3);
  ctx.lineTo(-r * 0.9, 0);
  ctx.lineTo(-r * 0.3, -r * 0.3);
  ctx.lineTo(-r * 0.7, -r * 1.1);
  ctx.closePath();
  ctx.moveTo(r * 0.5, 0);
  ctx.lineTo(r * 0.1, 0);
}
