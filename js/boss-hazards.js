// Boss hazards: the telegraphed area attacks the major bosses (js/bosses-major.js) lay on the field,
// plus their show-only effects and sound cues. They live on the EnemyManager (`m.bossHazards`), so the
// game and the Field Guide previews tick and draw them the same way:
//   blast  a red target circle that fills in over `fuse` s, then detonates (Hive Carrier shells, Prism nova)
//   line   a dashed blueprint line that prints into a laser wall for `burn` s (Architect, Prism)
//   ring   a shock ring that rolls outward with gaps to fly through (Conductor's downbeat)
//   label  a short world-space callout ("SHIELD DOWN") that floats over a boss
//   fx     a delayed shockwave / spark burst (staged death explosions), no damage
// Each damaging hazard hits the ship at most once. Hits and sound cues queue on the manager and the
// game drains them (applyBossHazards): damage is an orb hit × `mult` on the wave ramp, and a dash's
// invulnerability passes through. Timers are seconds; speeds are px per 60 Hz tick.
import { TUNING } from './config.js';

export const HAZARD = { blastMult: 1.6, lineMult: 1.4, ringMult: 1.4, maxHazards: 160 };

export const hazardsOf = (m) => (m.bossHazards ||= []);

function push(m, h) {
  const list = hazardsOf(m);
  if (list.length >= HAZARD.maxHazards) return null;
  list.push(h);
  return h;
}

// Optional on every damaging hazard: `cue` (a sound cue played as it goes off), `owner` (a hull: the hazard
// vanishes if it dies).
export function addBlast(m, { x, y, r = 70, fuse = 1.2, hue = 0, from = 'boss', mult = HAZARD.blastMult, delay = 0, cue = null, owner = null }) {
  return push(m, { kind: 'blast', x, y, r, fuse, maxFuse: fuse, delay, hue, from, mult, cue, owner, t: 0, done: false });
}

// `rehit`: a held beam (its owner moves the ends each tick) may hit again this many s after a hit.
export function addLine(m, { x1, y1, x2, y2, width = 16, fuse = 1.1, burn = 0.35, hue = 55, from = 'boss', mult = HAZARD.lineMult, delay = 0, cue = null, owner = null, rehit = 0 }) {
  return push(m, { kind: 'line', x1, y1, x2, y2, width, fuse, maxFuse: fuse, burn, maxBurn: burn, delay, hue, from, mult, cue, owner, rehit, hitCd: 0, t: 0 });
}

// `gaps`: angles (rad) of the openings, each `gapW` rad wide.
export function addRing(m, { x, y, speed = 6, width = 20, maxR = 700, gaps = [], gapW = 0.5, hue = 165, from = 'boss', mult = HAZARD.ringMult, delay = 0, r = 10, owner = null }) {
  return push(m, { kind: 'ring', x, y, r, speed, width, maxR, gaps, gapW, delay, hue, from, mult, owner, t: 0 });
}

// Takes a hazard off the field without it going off (a boss changing phase, or dying).
export function cancelHazard(h) {
  if (h) h.cancel = true;
}

export function addLabel(m, x, y, text, hue = 48, life = 1.6, follow = null) {
  return push(m, { kind: 'label', x, y, text, hue, life, maxLife: life, follow, delay: 0, t: 0 });
}

// A shockwave (and sparks) `delay` s from now: staged death explosions.
export function addFx(m, { x, y, delay = 0, radius = 300, hue = 48, width = 5, dur = 0.5, sparks = 0 }) {
  return push(m, { kind: 'fx', x, y, delay, radius, hue, width, dur, sparks, t: 0 });
}

// A sound cue for the game to play (js/boss-sfx-major.js); previews just drop them.
export function cue(m, name, at = null, extra = null) {
  const q = (m.bossCues ||= []);
  if (q.length < 32) q.push({ cue: name, x: at?.x, y: at?.y, ...extra });
}

// Distance from (px, py) to the segment (x1, y1)-(x2, y2).
export function segmentGap(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const inGap = (h, angle) => h.gaps.some(g => Math.abs(wrap(angle - g)) < h.gapW / 2);

function hit(m, h) {
  h.hit = true;
  (m.bossHazardHits ||= []).push({ mult: h.mult, from: h.from, x: h.x ?? h.x1, y: h.y ?? h.y1 });
}

// Called by EnemyManager.update once per tick, after the hulls moved.
export function tickBossHazards(m, dt, player, particles, grid) {
  if (m.bossHazardHits) m.bossHazardHits.length = 0;
  const list = m.bossHazards;
  if (!list || list.length === 0) return;
  const pr = player?.radius ?? 15;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h.cancel || h.owner?.dead) {
      list[i] = list[list.length - 1];
      list.pop();
      continue;
    }
    if (h.delay > 0) {
      h.delay -= dt;
      continue;
    }
    h.t += dt;
    let gone = false;
    if (h.kind === 'blast') {
      if (!h.done) {
        h.fuse -= dt;
        if (h.fuse <= 0) {
          h.done = true;
          h.flash = 0.3;
          if (h.cue) cue(m, h.cue, h, h.r > 150 ? { shake: 10 } : { shake: 3 });
          if (player && Math.hypot(player.x - h.x, player.y - h.y) < h.r + pr) hit(m, h);
          particles?.spawnShockwave?.(h.x, h.y, h.r * 1.35, h.hue, 4, 0.32);
          particles?.spawnExplosionSparks?.(h.x, h.y, 10, h.hue, 3, 10, 2.2);
          grid?.applyImpulse?.(h.x, h.y, 30, h.r * 1.6, h.hue);
        }
      } else {
        h.flash -= dt;
        gone = h.flash <= 0;
      }
    } else if (h.kind === 'line') {
      if (h.fuse > 0) {
        h.fuse -= dt;
        if (h.fuse <= 0) {
          if (h.cue) cue(m, h.cue, { x: (h.x1 + h.x2) / 2, y: (h.y1 + h.y2) / 2 });
          particles?.spawnLightning?.(h.x1, h.y1, h.x2, h.y2, h.hue, 1.6, 0.25, 0);
          grid?.applyImpulse?.((h.x1 + h.x2) / 2, (h.y1 + h.y2) / 2, 25, Math.hypot(h.x2 - h.x1, h.y2 - h.y1) * 0.5, h.hue);
        }
      } else {
        h.burn -= dt;
        if (h.hitCd > 0) h.hitCd -= dt;
        if (h.hit && h.rehit > 0 && h.hitCd <= 0) h.hit = false;
        if (!h.hit && player && segmentGap(h.x1, h.y1, h.x2, h.y2, player.x, player.y) < h.width / 2 + pr) {
          hit(m, h);
          h.hitCd = h.rehit;
        }
        gone = h.burn <= 0;
      }
    } else if (h.kind === 'ring') {
      h.r += h.speed * dt * 60;
      if (!h.hit && player) {
        const d = Math.hypot(player.x - h.x, player.y - h.y);
        if (Math.abs(d - h.r) < h.width / 2 + pr && !inGap(h, Math.atan2(player.y - h.y, player.x - h.x))) hit(m, h);
      }
      gone = h.r >= h.maxR;
    } else if (h.kind === 'label') {
      h.life -= dt;
      if (h.follow && !h.follow.dead) {
        h.x = h.follow.x;
        h.y = h.follow.y - h.follow.radius * 2.4;
      }
      gone = h.life <= 0;
    } else if (h.kind === 'fx') {
      particles?.spawnShockwave?.(h.x, h.y, h.radius, h.hue, h.width, h.dur);
      if (h.sparks) particles?.spawnExplosionSparks?.(h.x, h.y, h.sparks, h.hue, 3, 18, 2.6);
      grid?.applyImpulse?.(h.x, h.y, 50, h.radius, h.hue);
      gone = true;
    }
    if (gone) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}

// Drawn by EnemyManager.draw under the hulls (labels on top would need a second pass; they sit high).
export function drawBossHazards(ctx, m, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
  const list = m.bossHazards;
  if (!list || list.length === 0) return;
  const seen = (x, y, r) => x + r >= camX && y + r >= camY && x - r <= camX + viewW && y - r <= camY + viewH;
  for (const h of list) {
    if (h.delay > 0) continue;
    if (h.kind === 'blast') {
      if (!seen(h.x, h.y, h.r + 20)) continue;
      drawBlast(ctx, h);
    } else if (h.kind === 'line') {
      const cx = (h.x1 + h.x2) / 2;
      const cy = (h.y1 + h.y2) / 2;
      if (!seen(cx, cy, Math.hypot(h.x2 - h.x1, h.y2 - h.y1) / 2 + h.width)) continue;
      drawLine(ctx, h);
    } else if (h.kind === 'ring') {
      if (!seen(h.x, h.y, h.r + h.width)) continue;
      drawRing(ctx, h);
    } else if (h.kind === 'label') {
      if (!seen(h.x, h.y, 200)) continue;
      const k = Math.min(1, h.life / 0.4, (h.maxLife - h.life) / 0.12 + 0.2);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = 'bold 20px "Orbitron", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 * k})`;
      ctx.strokeText(h.text, h.x, h.y - (h.maxLife - h.life) * 14);
      ctx.fillStyle = `hsla(${h.hue}, 100%, 70%, ${k})`;
      ctx.fillText(h.text, h.x, h.y - (h.maxLife - h.life) * 14);
      ctx.restore();
    }
  }
}

// Target circle: a dashed red rim with crosshair ticks, an inner disc that fills toward the rim as the
// fuse burns, flashing faster near the end; then a white-hot flash on detonation.
function drawBlast(ctx, h) {
  if (h.done) {
    const k = Math.max(0, h.flash / 0.3);
    ctx.fillStyle = `hsla(${h.hue}, 100%, 75%, ${0.35 * k})`;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r * (1 + (1 - k) * 0.25), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const t = 1 - Math.max(0, h.fuse) / h.maxFuse;
  const flash = 0.5 + 0.5 * Math.cos(h.fuse * Math.PI * (6 + t * 14));
  ctx.strokeStyle = `hsla(${flash > 0.5 ? 0 : h.hue}, 100%, 62%, ${0.6 + 0.4 * t})`;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  const spin = h.t * 1.5;
  for (let k = 0; k < 8; k++) {
    const a = spin + (k * Math.PI) / 4;
    ctx.moveTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
    ctx.arc(h.x, h.y, h.r, a, a + 0.5);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.moveTo(h.x + Math.cos(a) * h.r * 1.18, h.y + Math.sin(a) * h.r * 1.18);
    ctx.lineTo(h.x + Math.cos(a) * h.r * 0.82, h.y + Math.sin(a) * h.r * 0.82);
  }
  ctx.stroke();
  ctx.fillStyle = `hsla(0, 100%, 55%, ${0.12 + 0.26 * t})`;
  ctx.beginPath();
  ctx.arc(h.x, h.y, h.r * t, 0, Math.PI * 2);
  ctx.fill();
}

// Blueprint line while it prints (thin dashes crawling, brightening), then a two-pass laser wall.
function drawLine(ctx, h) {
  if (h.fuse > 0) {
    const t = 1 - h.fuse / h.maxFuse;
    const flash = 0.5 + 0.5 * Math.cos(h.fuse * Math.PI * (5 + t * 12));
    ctx.save();
    ctx.setLineDash?.([14, 10]);
    ctx.lineDashOffset = -h.t * 60;
    ctx.strokeStyle = `hsla(${h.hue}, 100%, ${60 + flash * 20}%, ${0.35 + 0.5 * t})`;
    ctx.lineWidth = 1.5 + t * 2;
    ctx.beginPath();
    ctx.moveTo(h.x1, h.y1);
    ctx.lineTo(h.x2, h.y2);
    ctx.stroke();
    ctx.setLineDash?.([]);
    // The wall's width, faintly, so the danger zone reads.
    ctx.strokeStyle = `hsla(${h.hue}, 100%, 60%, ${0.06 + 0.12 * t})`;
    ctx.lineWidth = h.width;
    ctx.beginPath();
    ctx.moveTo(h.x1, h.y1);
    ctx.lineTo(h.x2, h.y2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const k = Math.max(0, h.burn / h.maxBurn);
  ctx.lineCap = 'round';
  ctx.strokeStyle = `hsla(${h.hue}, 100%, 60%, ${0.5 * k})`;
  ctx.lineWidth = h.width * (1.2 + 0.4 * k);
  ctx.beginPath();
  ctx.moveTo(h.x1, h.y1);
  ctx.lineTo(h.x2, h.y2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 240, ${0.9 * k})`;
  ctx.lineWidth = h.width * 0.35;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// Shock ring: a bright band with its gaps left dark, gap edges marked by short white ticks.
function drawRing(ctx, h) {
  const fade = Math.min(1, (h.maxR - h.r) / 120);
  const n = h.gaps.length;
  const arcs = [];
  if (n === 0) arcs.push([0, Math.PI * 2]);
  else {
    const g = [...h.gaps].map(a => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    for (let k = 0; k < n; k++) {
      const a0 = g[k] + h.gapW / 2;
      const a1 = (k + 1 < n ? g[k + 1] : g[0] + Math.PI * 2) - h.gapW / 2;
      if (a1 > a0) arcs.push([a0, a1]);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? `hsla(${h.hue}, 100%, 55%, ${0.35 * fade})` : `hsla(${h.hue}, 100%, 82%, ${0.9 * fade})`;
    ctx.lineWidth = pass === 0 ? h.width : h.width * 0.3;
    ctx.beginPath();
    for (const [a0, a1] of arcs) {
      ctx.moveTo(h.x + Math.cos(a0) * h.r, h.y + Math.sin(a0) * h.r);
      ctx.arc(h.x, h.y, h.r, a0, a1);
    }
    ctx.stroke();
  }
  if (n) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * fade})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a0, a1] of arcs) {
      for (const a of [a0, a1]) {
        ctx.moveTo(h.x + Math.cos(a) * (h.r - h.width), h.y + Math.sin(a) * (h.r - h.width));
        ctx.lineTo(h.x + Math.cos(a) * (h.r + h.width), h.y + Math.sin(a) * (h.r + h.width));
      }
    }
    ctx.stroke();
  }
}

// Game side, once per tick after the enemy update: queued hits damage the ship (an orb hit × mult on the
// wave ramp; invulnerability, a dash included, lets them pass), and queued sound cues play. Returns true
// when a hit ended the run.
export function applyBossHazards(game, playCue = null) {
  const m = game.enemyManager;
  const cues = m?.bossCues;
  if (cues?.length) {
    for (const c of cues) {
      if (playCue) playCue(game, c);
      // Weight: phase changes and deaths shake the screen and hold a beat (hit-stop), scaled down with
      // distance from the ship.
      const p = game.player;
      const near = p && Number.isFinite(c.x) ? Math.max(0, 1 - Math.hypot(c.x - p.x, c.y - p.y) / 1400) : 1;
      if (c.shake && near > 0) game.addShake?.(c.shake * near);
      if (c.hitStop && near > 0.3) game.requestHitStop?.(c.hitStop);
    }
    cues.length = 0;
  }
  const hits = m?.bossHazardHits;
  if (!hits?.length) return false;
  const p = game.player;
  for (const h of hits) {
    if (!p || p.invuln > 0 || p.hp <= 0 || game.range?.active) continue;
    game.damagePlayer(game.enemyBulletDamage({ damage: (TUNING.enemyBulletDamage ?? 12) * h.mult }), 14, h.from);
    if (game.endRunIfDead?.()) {
      hits.length = 0;
      return true;
    }
  }
  hits.length = 0;
  return false;
}

