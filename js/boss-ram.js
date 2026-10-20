// Boss RAM: the shared telegraphed close-range attack (v0.43.2). A boss with a `ram` config in its
// def (js/bosses.js) that gets the ship within `range` braces for `windup` s behind a red dashed
// lane locked on the ship, then charges down it at `speed` px/tick, overshooting by `overshoot` px.
// The hit is the boss's own contact damage (bossContactDamage on the wave ramp), so the answer is to
// sidestep the lane or dash through. Runs after the boss's own update(): its timers keep ticking and
// the ram only takes over its velocity while bracing and charging. Speeds are px per 60 Hz tick.

export const RAM = { range: 340, cooldown: 5.5, windup: 0.85, speed: 9, overshoot: 140, maxTime: 0.75, firstDelay: 2.5 };

// Advances e's ram. `cfg` is the def's ram object (fields override RAM); `cfg.when(e)` may veto a
// new ram (a phase that has its own attack). Returns true while the ram drives the hull.
export function bossRam(e, cfg, env) {
  if (!cfg || e.dead) return false;
  const o = { ...RAM, ...cfg };
  const { dt, player } = env;
  if (e.ramT === undefined) e.ramT = o.firstDelay + Math.random() * 1.5;
  if (e.ramState === 'brace') {
    e.ramT -= dt;
    e.vx *= 0.8;
    e.vy *= 0.8;
    // The lane tracks the ship until the last third of the windup, then locks.
    if (e.ramT > o.windup / 3) {
      e.ramAngle = Math.atan2(player.y - e.y, player.x - e.x);
      e.ramLen = Math.min(o.speed * o.maxTime * 60, Math.hypot(player.x - e.x, player.y - e.y) + o.overshoot);
    }
    if (e.ramT <= 0) {
      e.ramState = 'charge';
      e.ramT = e.ramLen / (o.speed * 60);
      e.burstSpeed = o.speed * (e.speedScale ?? 1);
      env.grid?.applyImpulse(e.x, e.y, 40, 160, e.hue);
    }
    return true;
  }
  if (e.ramState === 'charge') {
    e.ramT -= dt;
    e.vx = Math.cos(e.ramAngle) * e.burstSpeed;
    e.vy = Math.sin(e.ramAngle) * e.burstSpeed;
    if (e.ramT <= 0) {
      e.burstSpeed = 0;
      e.ramState = null;
      e.ramT = o.cooldown * (0.85 + Math.random() * 0.3);
    }
    return true;
  }
  e.ramT -= dt;
  if (e.ramT > 0 || e.emergeT > 0 || e.restT > 0 || e.burstSpeed > 0) return false;
  if (cfg.when && !cfg.when(e)) return false;
  if (Math.hypot(player.x - e.x, player.y - e.y) > o.range) return false;
  e.ramState = 'brace';
  e.ramT = o.windup;
  e.ramAngle = Math.atan2(player.y - e.y, player.x - e.x);
  e.ramLen = o.speed * o.maxTime * 60;
  return true;
}

// The ram lane: a red dashed corridor the width of the hull, chevrons filling in as it locks.
export function drawBossRam(ctx, e, cfg) {
  if (e.ramState !== 'brace' || !cfg) return;
  const windup = cfg.windup ?? RAM.windup;
  const t = 1 - Math.max(0, e.ramT) / windup;
  const len = e.ramLen || 0;
  const flash = 0.5 + 0.5 * Math.cos(e.ramT * Math.PI * 14);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.ramAngle);
  ctx.strokeStyle = `hsla(0, 100%, 62%, ${0.3 + t * 0.4 + flash * 0.2})`;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(e.radius * 0.8, -e.radius, len, e.radius * 2);
  ctx.setLineDash([]);
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
