// Lancer beams: a hull plants itself, telegraphs a line at the ship, then fires a beam that sweeps
// across it. Shared by the LANCER hostile and the enraged Eclipse Twin (js/bosses.js).
// A hull with a live beam (or a twin tether) carries e.beam = { x1, y1, x2, y2, width }; Game checks
// the ship against every e.beam each tick (Game.beamContact) and the beam is drawn by drawBeam.
// Timers are seconds; speeds are px per fixed 60 Hz tick.

export const LANCE = {
  range: 330, band: 70, aimTime: 0.9, lockAt: 0.3, fireTime: 0.85, sweep: 0.7, length: 560, width: 7,
  cooldown: 2.6, damageMult: 1.4
};

// One lance cycle on a hull that is already in place. States: 'idle' → 'aim' → 'fire' → 'idle'.
// Returns true while the hull should hold still (aiming or firing).
export function lanceCycle(e, env, { cooldown = LANCE.cooldown, length = LANCE.length } = {}) {
  const { dt, player } = env;
  e.lanceT = (e.lanceT ?? cooldown * (0.5 + Math.random() * 0.5)) - dt;
  if (e.lanceState === 'aim') {
    // Tracks the ship, then locks for the last lockAt seconds (that is your cue to move).
    if (e.lanceT > LANCE.lockAt) e.lanceAngle = Math.atan2(player.y - e.y, player.x - e.x);
    if (e.lanceT <= 0) {
      e.lanceState = 'fire';
      e.lanceT = LANCE.fireTime;
      e.lanceDir = Math.random() < 0.5 ? -1 : 1;
    }
    e.beam = null;
    return true;
  }
  if (e.lanceState === 'fire') {
    const k = 1 - Math.max(0, e.lanceT) / LANCE.fireTime;
    const a = e.lanceAngle + e.lanceDir * LANCE.sweep * (k - 0.5) * 2;
    e.beam = beamFrom(e, a, length);
    if (e.lanceT <= 0) {
      e.lanceState = 'idle';
      e.lanceT = cooldown * (0.85 + Math.random() * 0.3);
      e.beam = null;
    }
    return true;
  }
  e.beam = null;
  if (e.lanceT <= 0 && env.dist < length * 0.9) {
    e.lanceState = 'aim';
    e.lanceT = LANCE.aimTime;
    e.lanceAngle = Math.atan2(player.y - e.y, player.x - e.x);
  }
  return false;
}

export function beamFrom(e, angle, length = LANCE.length, width = LANCE.width) {
  const x1 = e.x + Math.cos(angle) * e.radius;
  const y1 = e.y + Math.sin(angle) * e.radius;
  return { x1, y1, x2: x1 + Math.cos(angle) * length, y2: y1 + Math.sin(angle) * length, width };
}

// Distance from (px, py) to a beam segment.
export function beamGap(b, px, py) {
  const vx = b.x2 - b.x1;
  const vy = b.y2 - b.y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - b.x1) * vx + (py - b.y1) * vy) / len2));
  return Math.hypot(px - (b.x1 + vx * t), py - (b.y1 + vy * t));
}

// The aim telegraph: a thin dashed line, red once locked, flashing faster as the shot nears.
export function drawLanceAim(ctx, e) {
  if (e.lanceState !== 'aim') return;
  const locked = e.lanceT <= LANCE.lockAt;
  const flash = 0.5 + 0.5 * Math.cos(e.lanceT * Math.PI * (locked ? 18 : 8));
  const b = beamFrom(e, e.lanceAngle);
  ctx.strokeStyle = `hsla(${locked ? 0 : e.hue}, 100%, 65%, ${0.25 + flash * 0.4})`;
  ctx.lineWidth = locked ? 2 : 1.2;
  ctx.setLineDash?.([10, 8]);
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();
  ctx.setLineDash?.([]);
}

// A live beam: a wide glow and a white-hot core.
export function drawBeam(ctx, b, hue) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${hue}, 100%, 60%, 0.45)` : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = pass === 0 ? b.width * 2.6 : b.width * 0.7;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }
}

// Lancer silhouette: a long spear-like hull with a lens at the tip.
export function traceLancer(ctx, r) {
  ctx.moveTo(r * 1.6, 0);
  ctx.lineTo(r * 0.2, r * 0.55);
  ctx.lineTo(-r * 1.1, r * 0.35);
  ctx.lineTo(-r * 1.1, -r * 0.35);
  ctx.lineTo(r * 0.2, -r * 0.55);
  ctx.closePath();
  ctx.moveTo(r * 1.1, 0);
  ctx.arc(r * 0.9, 0, r * 0.2, 0, Math.PI * 2);
}
