// Shared game and tuning-preview rendering. Animation state is supplied by the caller.

// Andrew's monotone chain; returns the convex hull counter-clockwise (math orientation).
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const pt of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Ship-local silhouette the shield hugs (in the hull's frame): drill claws, carapace, wing tips and tail.
// Claw growth from upgrades is capped so bigger drills poke through instead of inflating the hitbox.
const hullCache = new Map();
function shipHull(r, drillScale) {
  const ds = Math.min(drillScale || 1, 1.15);
  const key = `${r}|${ds}`;
  let hull = hullCache.get(key);
  if (!hull) {
    const pts = [[-r * 1.0, 0]];
    for (const s of [-1, 1]) {
      pts.push(
        [r * 1.42 + 18 * ds, s * r * 0.5],        // drill-claw tips
        [r * 1.42 + 2, s * (r * 0.78 + 8.5 * ds)], // pincer jaws
        [r * 1.15, s * r * 1.12],                  // claw elbows
        [-r * 0.95, s * r * 1.76],                 // wings (the tips poke just past, like big drills)
        [-r * 0.92, s * r * 0.88]                  // rear carapace corners
      );
    }
    hull = convexHull(pts);
    if (hullCache.size > 32) hullCache.clear();
    hullCache.set(key, hull);
  }
  return hull;
}

// Hull heading (body, wings, shield): hullAngle, else the older single drillAngle heading, else the aim.
const hullHeading = (p) => p.hullAngle ?? p.drillAngle ?? p.angle ?? 0;

// The hull grown outward by `pad` with rounded corners, sampled as a closed polyline.
function shieldOutline(hull, pad) {
  const out = [];
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const prev = hull[(i - 1 + n) % n], cur = hull[i], next = hull[(i + 1) % n];
    const a1 = Math.atan2(-(cur[0] - prev[0]), cur[1] - prev[1]); // outward normal of incoming edge
    let a2 = Math.atan2(-(next[0] - cur[0]), next[1] - cur[1]);   // outward normal of outgoing edge
    while (a2 < a1) a2 += Math.PI * 2;
    const steps = Math.max(1, Math.ceil((a2 - a1) / 0.35));
    for (let k = 0; k <= steps; k++) {
      const a = a1 + ((a2 - a1) * k) / steps;
      out.push([cur[0] + Math.cos(a) * pad, cur[1] + Math.sin(a) * pad]);
    }
  }
  return out;
}

function shieldPad(p, tuning) {
  return p.radius * (tuning.shieldPadding ?? 0.38);
}

// Contact test against the drawn shield shape: true when a circle at (x, y) touches it.
export function shieldTouches(p, tuning, x, y, radius) {
  const hull = shipHull(p.radius, p.stats?.drillScale);
  const a = -hullHeading(p);
  const dx = x - p.x, dy = y - p.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);

  let inside = true;
  let minDist = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const ex = bx - ax, ey = by - ay;
    if (ex * (ly - ay) - ey * (lx - ax) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey)));
    minDist = Math.min(minDist, Math.hypot(lx - (ax + ex * t), ly - (ay + ey * t)));
  }
  return inside || minDist < shieldPad(p, tuning) + radius - 2;
}

function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// Healthy shields use the tunable hue; damage warms them toward amber, then critical red.
function shieldHueFor(hpRatio, baseHue) {
  const amber = 400; // 40° written past 360 so blending runs warm (violet → red → amber), not through the ship's cyan
  const critical = 352;
  if (hpRatio >= 0.6) return baseHue;
  if (hpRatio >= 0.5) return baseHue + (amber - baseHue) * ((0.6 - hpRatio) / 0.1);
  if (hpRatio >= 0.3) return amber;
  if (hpRatio >= 0.24) return amber + (critical - amber) * ((0.3 - hpRatio) / 0.06);
  return critical;
}

export function drawPlayerShield(ctx, p, beatPulse, tuning, shieldRotation = 0, now = performance.now()) {
    const hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const hue = shieldHueFor(hpRatio, tuning.shieldHue ?? 222) % 360;
    const critical = hpRatio < 0.3;
    const dangerPulse = critical ? 0.6 + Math.sin(now * 0.02) * 0.3 : 1.0;
    const flicker = critical && Math.random() < 0.08 ? 0.35 : 1.0;
    const flash = Math.max(0, Math.min(1, p.shieldFlash || 0));

    // Max shield above the 100 HP baseline thickens the barrier; current charge scales it within that.
    const capacity = Math.sqrt(Math.max(1, Math.min(5, p.maxHp / 100)));
    const thick = (tuning.shieldThickness ?? 1.0) * capacity;
    const coreWidth = (1.4 + hpRatio * 2.2) * thick;
    const glowWidth = (4.5 + hpRatio * 6 + beatPulse * 3) * thick;

    const pad = shieldPad(p, tuning) + beatPulse * 2.4 + flash * 3;
    const outline = shieldOutline(shipHull(p.radius, p.stats?.drillScale), pad);
    let perimeter = 0;
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      perimeter += Math.hypot(bx - ax, by - ay);
    }
    const flow = shieldRotation * 38; // charge and sparks circulate around the outline

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(hullHeading(p));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. Soft interior field
    const extent = p.radius * 2.6 + pad;
    const grad = ctx.createRadialGradient(p.radius * 0.3, 0, p.radius * 0.5, p.radius * 0.3, 0, extent);
    grad.addColorStop(0, `hsla(${hue}, 100%, 65%, 0)`);
    grad.addColorStop(0.7, `hsla(${hue}, 100%, 62%, ${(0.05 + hpRatio * 0.07) * dangerPulse})`);
    grad.addColorStop(1, `hsla(${hue}, 100%, 72%, ${(0.12 + hpRatio * 0.08 + flash * 0.2) * dangerPulse})`);
    ctx.fillStyle = grad;
    tracePath(ctx, outline);
    ctx.fill();

    // 2. Outer glow (full outline, so the shield's shape always reads)
    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${(0.16 + hpRatio * 0.22 + beatPulse * 0.08) * dangerPulse * flicker})`;
    ctx.lineWidth = glowWidth;
    ctx.stroke();

    // 3. Depleted section: faint, thin track
    ctx.strokeStyle = `hsla(${hue}, 60%, 55%, ${0.22 * dangerPulse})`;
    ctx.lineWidth = Math.max(1, coreWidth * 0.45);
    ctx.stroke();

    // 4. Charged section: bright arc whose length is the current shield percentage, flowing around the hull
    ctx.setLineDash([perimeter * Math.max(0.06, hpRatio), perimeter]);
    ctx.lineDashOffset = -flow;
    ctx.strokeStyle = `hsla(${hue}, 100%, ${74 + beatPulse * 8}%, ${0.95 * dangerPulse * flicker})`;
    ctx.lineWidth = coreWidth;
    ctx.stroke();

    // 5. Racing energy sparks (two short bright dashes travelling twice as fast)
    const sparkLen = 5 + hpRatio * 5;
    ctx.setLineDash([sparkLen, perimeter / 2 - sparkLen]);
    ctx.lineDashOffset = -flow * 2.1;
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.55 + hpRatio * 0.35) * flicker})`;
    ctx.lineWidth = coreWidth * 0.9 + 0.6;
    ctx.stroke();
    ctx.setLineDash([]);

    // 6. Impact flash: white rim plus a ripple that expands off the hull
    if (flash > 0.01) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${flash * 0.85})`;
      ctx.lineWidth = coreWidth + 1.5;
      ctx.stroke();
      const ripple = 1 + (1 - flash) * 0.55;
      ctx.save();
      ctx.scale(ripple, ripple);
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${flash * 0.6})`;
      ctx.lineWidth = 2 / ripple;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

// Ship animation state (visual only, never read by the simulation): throttle, banking, turret recoil
// and the engine wake. The game steps it once per sim tick; previews that never call it get a
// speed-derived throttle and no bank, recoil or wake.
const WAKE_POINTS = 22;
const WAKE_LIFE = 0.38; // seconds a wake point glows
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function updateShipAnimation(p, dt) {
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  const cruise = Math.max(1, p.stats?.moveSpeed || 5);
  const dashing = (p.dashTimer || 0) > 0;
  const k = Math.min(1, dt * 10);
  p.throttle = (p.throttle || 0) + ((dashing ? 1.6 : Math.min(1, speed / cruise)) - (p.throttle || 0)) * k;

  // Bank into turns: the hull's turn rate, smoothed. Positive turns clockwise on screen.
  const heading = hullHeading(p);
  const turn = p.prevHullAngle == null || dt <= 0 ? 0 : wrapAngle(heading - p.prevHullAngle) / dt;
  p.prevHullAngle = heading;
  p.bank = (p.bank || 0) + (Math.max(-1, Math.min(1, turn / 7)) - (p.bank || 0)) * Math.min(1, dt * 8);

  if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 14);

  // Engine wake: the thruster nozzle's world position each tick, newest first; points are recycled.
  const wake = (p.wake ||= []);
  for (let i = 0; i < wake.length; i++) wake[i].age += dt;
  while (wake.length && wake[wake.length - 1].age > WAKE_LIFE) wake.pop();
  if (p.throttle > 0.08) {
    const pt = wake.length >= WAKE_POINTS ? wake.pop() : {};
    pt.x = p.x - Math.cos(heading) * p.radius * 0.92;
    pt.y = p.y - Math.sin(heading) * p.radius * 0.92;
    pt.age = 0;
    pt.power = Math.min(1.6, p.throttle);
    wake.unshift(pt);
  }
}

// Turret kick for one shot (decays in updateShipAnimation).
export function kickShipRecoil(p, amount = 1) {
  p.recoil = Math.max(p.recoil || 0, amount);
}

// Glowing ribbon left by the engine, drawn under the shield and hull: tapers and fades with age.
export function drawShipWake(ctx, p, tuning) {
  const wake = p.wake;
  if (!wake || wake.length < 2) return;
  const carapaceCol = tuning.carapaceColor || '#00f3ff';
  const intensity = tuning.vfxIntensity ?? 1;
  const r = p.radius;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? carapaceCol : '#ffffff';
    for (let i = 0; i < wake.length - 1; i++) {
      const a = wake[i], b = wake[i + 1];
      const fade = 1 - b.age / WAKE_LIFE;
      if (fade <= 0) break;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 160) continue; // a teleport, not a streak
      const power = a.power;
      ctx.globalAlpha = Math.min(1, fade * fade * (pass === 0 ? 0.26 : 0.3) * Math.min(1, power) * intensity);
      ctx.lineWidth = (pass === 0 ? r * 0.95 : r * 0.16) * (0.3 + 0.7 * fade) * (power > 1 ? 1.35 : 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Hangar ship decorations, in the hull's frame (x forward). Thin neon strokes like the rest of the crab.
function drawLookExtras(ctx, r, look, col, inner, alpha, now) {
  const line = (pts, color = col, width = 1.8, close = false) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  ctx.save();
  ctx.globalAlpha = 0.9 * alpha;
  for (const extra of look.extras) {
    if (extra === 'scythes') for (const s of [-1, 1]) line([[0.5, s * 0.9], [1.25, s * 1.35], [2.05, s * 1.05], [1.45, s * 1.12]], col, 2.2);
    else if (extra === 'hopper') line([[-0.15, -0.45], [-0.6, -0.4], [-0.6, 0.4], [-0.15, 0.45]], inner, 2, true);
    else if (extra === 'stinger') { line([[-0.9, 0], [-1.7, 0], [-1.95, 0.18]], col, 2.4); line([[-1.7, 0], [-1.95, -0.18]], inner, 1.4); }
    else if (extra === 'dome') {
      ctx.strokeStyle = inner;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-0.1 * r, 0, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-0.1 * r, 0, r * 0.36, 0, Math.PI * 2);
      ctx.stroke();
    } else if (extra === 'nozzles') for (const s of [-1, 1]) line([[0.78, s * 0.62], [1.12, s * 0.74], [1.12, s * 0.5]], '#ffcc00', 1.6, true);
    else if (extra === 'vents') {
      const glow = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.globalAlpha = (0.45 + 0.45 * glow) * alpha;
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) line([[-0.15 - k * 0.2, s * 0.62], [-0.25 - k * 0.2, s * 0.78]], '#ff9b3d', 1.6);
      ctx.globalAlpha = 0.9 * alpha;
    } else if (extra === 'dice') for (const [x, y] of [[0.15, -0.38], [0.15, 0.38], [-0.35, 0]]) {
      line([[x + 0.14, y], [x + 0.07, y - 0.13], [x - 0.07, y - 0.13], [x - 0.14, y], [x - 0.07, y + 0.13], [x + 0.07, y + 0.13]], inner, 1.3, true);
    } else if (extra === 'hatches') for (const s of [-1, 1]) for (const x of [0.2, -0.3]) line([[x + 0.14, s * 0.62], [x - 0.14, s * 0.62], [x - 0.14, s * 0.86], [x + 0.14, s * 0.86]], inner, 1.4, true);
    else if (extra === 'seams') {
      const glow = 0.55 + 0.45 * Math.sin(now * 0.004);
      ctx.globalAlpha = glow * alpha;
      line([[0.7, -0.1], [0.3, 0.15], [-0.1, -0.12], [-0.55, 0.2]], '#ff5a5a', 1.5);
      line([[0.2, -0.75], [-0.05, -0.45], [-0.35, -0.6]], '#ff5a5a', 1.3);
      line([[0.2, 0.75], [-0.1, 0.5], [-0.4, 0.66]], '#ff5a5a', 1.3);
      ctx.globalAlpha = 0.9 * alpha;
    } else if (extra === 'tail') {
      const wag = Math.sin(now * 0.004) * 0.25;
      let x = -0.9, y = 0;
      for (let k = 0; k < 5; k++) {
        const nx = x - 0.42, ny = Math.sin(k * 0.9 + wag * 4) * 0.14 * (k + 1) * 0.5;
        line([[x, y], [nx, ny]], k % 2 ? inner : col, 2.6 - k * 0.3);
        x = nx; y = ny;
      }
      line([[x, y], [x - 0.3, y - 0.22], [x - 0.18, y], [x - 0.3, y + 0.22], [x, y]], col, 1.6, true);
    } else if (extra === 'crown') line([[0.35, -0.42], [0.15, -0.2], [0.05, -0.5], [-0.1, -0.2], [-0.25, -0.5], [-0.35, -0.2], [-0.55, -0.42], [-0.45, 0.42], [0.25, 0.42]], '#ffcc00', 1.5, true);
    else if (extra === 'facets') {
      const hue = (now * 0.05) % 360;
      line([[0.9, 0], [0.25, -1.12], [-0.68, 0], [0.25, 1.12], [0.9, 0]], `hsl(${hue}, 100%, 70%)`, 1.1);
    }
  }
  ctx.restore();
}

export function drawCrabShip(ctx, p, tuning, drilling = false, now = performance.now()) {
    const r = p.radius;
    const flashAlpha = p.invuln > 0 && Math.floor(now / 50) % 2 === 0 ? 0.45 : 1;
    const drillScale = p.stats.drillScale || 1.0;

    // Hangar ships (js/ships.js shipLook) reshape and recolour the crab; no look = the crab as always.
    const look = p.look || null;
    const carapaceCol = look?.color || tuning.carapaceColor || '#00f3ff';
    const innerCol = tuning.innerArmorColor || '#00ffaa';
    const drillIdleCol = tuning.drillIdleColor || '#00f3ff';
    const drillActiveCol = tuning.drillActiveColor || '#00ffaa';
    const drillJawCol = tuning.drillJawColor || '#ffcc00';

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = flashAlpha;

    // 1. Hull (carapace + wings) along the hull heading
    ctx.save();
    ctx.rotate(hullHeading(p));

    // 1a. Thruster plume off the tail: a flickering cone that stretches with throttle (dashes flare it).
    const speed = Math.min(1, Math.hypot(p.vx || 0, p.vy || 0) / 5);
    const throttle = p.throttle ?? speed;
    const flicker = 0.85 + 0.15 * Math.sin(now * 0.047) * Math.sin(now * 0.031 + 1.3);
    const plumeLen = r * (0.4 + 1.25 * throttle) * flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      const len = pass === 0 ? plumeLen : plumeLen * 0.55;
      const halfW = r * (pass === 0 ? 0.3 : 0.14) * (0.8 + 0.2 * Math.min(1, throttle));
      ctx.globalAlpha = (pass === 0 ? 0.42 : 0.9) * flashAlpha;
      ctx.fillStyle = pass === 0 ? carapaceCol : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -halfW);
      ctx.lineTo(-r * 0.8 - len, 0);
      ctx.lineTo(-r * 0.8, halfW);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 1b. Swept-back wings off the flanks, with a wing-tip running light that pulses with speed. Banking
    // into a turn foreshortens the inside wing and stretches the outside one a touch.
    const bank = Math.max(-1, Math.min(1, p.bank || 0));
    for (let side = -1; side <= 1; side += 2) {
      const lean = bank * side;
      ctx.save();
      if (look?.wings) ctx.scale(look.wings.sweep, look.wings.span);
      ctx.scale(1, 1 - (lean > 0 ? 0.26 : -0.06) * Math.abs(lean));
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? carapaceCol : '#ffffff';
        ctx.globalAlpha = (pass === 0 ? 0.55 : 0.95) * flashAlpha;
        ctx.lineWidth = pass === 0 ? 5 : 1.8;
        ctx.beginPath();
        ctx.moveTo(r * 0.12, side * r * 0.95);     // wing root, leading edge
        ctx.lineTo(-r * 1.02, side * r * 2.0);     // swept leading edge out to the tip
        ctx.lineTo(-r * 1.08, side * r * 1.72);    // clipped tip
        ctx.lineTo(-r * 0.74, side * r * 0.86);    // wing root, trailing edge
        ctx.stroke();
      }
      // Inner wing rib
      ctx.globalAlpha = 0.8 * flashAlpha;
      ctx.strokeStyle = innerCol;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, side * r * 1.02);
      ctx.lineTo(-r * 0.9, side * r * 1.72);
      ctx.stroke();
      ctx.globalAlpha = (0.55 + 0.45 * speed) * flashAlpha;
      ctx.fillStyle = innerCol;
      ctx.beginPath();
      ctx.arc(-r * 1.04, side * r * 1.88, 1.6 + speed * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = flashAlpha;

    // 1c. Wide Geometric Crab Carapace (Hexagonal Armored Shell)
    if (look?.carapace) {
      ctx.save();
      ctx.scale(look.carapace.l, look.carapace.w);
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? carapaceCol : '#ffffff';
      ctx.globalAlpha = (pass === 0 ? 0.65 : 1.0) * flashAlpha;
      ctx.lineWidth = pass === 0 ? 6.5 : 2.5;

      ctx.beginPath();
      ctx.moveTo(r * 0.78, -r * 0.55);   // Front-left brow
      ctx.lineTo(r * 0.25, -r * 1.12);   // Wide left carapace wing
      ctx.lineTo(-r * 0.68, -r * 0.88);  // Rear-left corner
      ctx.lineTo(-r * 0.92, 0);          // Rear thruster tail
      ctx.lineTo(-r * 0.68, r * 0.88);   // Rear-right corner
      ctx.lineTo(r * 0.25, r * 1.12);    // Wide right carapace wing
      ctx.lineTo(r * 0.78, r * 0.55);    // Front-right brow
      ctx.lineTo(r * 0.92, 0);           // Front rostrum nose
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = flashAlpha;

    // Inner Carapace Armor Facets
    ctx.strokeStyle = innerCol;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(r * 0.52, -r * 0.35);
    ctx.lineTo(-r * 0.45, -r * 0.52);
    ctx.lineTo(-r * 0.62, 0);
    ctx.lineTo(-r * 0.45, r * 0.52);
    ctx.lineTo(r * 0.52, r * 0.35);
    ctx.closePath();
    ctx.stroke();
    if (look?.carapace) ctx.restore();
    if (look?.extras?.length) drawLookExtras(ctx, r, look, carapaceCol, innerCol, flashAlpha, now);

    ctx.restore(); // End hull orientation

    // 1d. Twin Pincer Arms + Spinning Conical Rotary Drills. Each arm swings round the hull on its own
    // heading toward its own rock (p.clawAngles: [port, starboard]; else the shared p.drillAngle), and
    // lights up only while it bites (p.clawDrilling, else the shared `drilling`).
    ctx.save();
    const drillSpin = p.drillSpin || 0;

    for (let side = -1; side <= 1; side += 2) {
      ctx.save();
      const arm = side > 0 ? 1 : 0;
      ctx.rotate(p.clawAngles?.[arm] ?? p.drillAngle ?? hullHeading(p));
      const armDrilling = p.clawDrilling ? !!p.clawDrilling[arm] : drilling;
      const drillColor = armDrilling ? drillActiveCol : drillIdleCol;
      const drillCoreColor = armDrilling ? '#ffffff' : '#b8fff0';
      // Shoulder joint at front corners of the crab carapace
      const shoulderX = r * 0.62;
      const shoulderY = side * r * 0.76;
      const elbowX = r * 1.15;
      const elbowY = side * r * 1.05;

      // Articulated Crab Claw Arm
      ctx.strokeStyle = carapaceCol;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();

      // Translate to the Claw's Rotary Drill Mount at the front pincer position
      const vibrateX = armDrilling ? (Math.random() - 0.5) * 2.4 : 0;
      const vibrateY = armDrilling ? (Math.random() - 0.5) * 2.4 : 0;
      const clawX = r * 1.42 + vibrateX;
      const clawY = side * r * 0.78 + vibrateY;

      ctx.translate(clawX, clawY);
      // Angle the two crab drill-claws slightly inward like pincers (pinching tighter while it bites)
      const pinchAngle = -side * (armDrilling ? 0.28 : 0.16);
      ctx.rotate(pinchAngle);
      const clawScale = drillScale * (look?.claws?.[arm] ?? 1);
      ctx.scale(clawScale, clawScale);

      // Outer Crab Pincer Jaw Brackets framing the drill
      ctx.strokeStyle = armDrilling ? drillJawCol : innerCol;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-4, -7.5);
      ctx.lineTo(4, -8.5);
      ctx.moveTo(-4, 7.5);
      ctx.lineTo(4, 8.5);
      ctx.stroke();

      // Conical Rotary Drill Bit Outline (Base at x=0, sharp drill point at x=16)
      const drillLen = 16.5;
      const drillHalfW = 6.2;

      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? drillColor : drillCoreColor;
        ctx.lineWidth = pass === 0 ? 4.8 : 2.0;
        ctx.beginPath();
        ctx.moveTo(drillLen, 0);               // Sharp rotary drill tip
        ctx.lineTo(0, -drillHalfW);            // Upper drill base
        ctx.lineTo(-3.5, 0);                   // Rear spindle hub
        ctx.lineTo(0, drillHalfW);             // Lower drill base
        ctx.closePath();
        ctx.stroke();
      }

      // Animated Spinning Helical Drill Threads inside the cone!
      ctx.strokeStyle = armDrilling ? drillJawCol : innerCol;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (let t = 0; t < 3; t++) {
        // Scroll threads from base (0) to tip (1) as the drill spins
        const phase = ((drillSpin * 0.35 + t / 3) % 1 + 1) % 1;
        const tx = phase * (drillLen - 2);
        const halfSpan = drillHalfW * (1 - phase);
        ctx.moveTo(tx, -halfSpan);
        ctx.lineTo(tx + 2.2, halfSpan);
      }
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore(); // End drill-arm orientation

    // 2. Central 360° Rotating Plasma Blaster Turret (aims toward p.angle); each shot kicks the barrels
    // back and the hub a little less.
    ctx.save();
    ctx.rotate(p.angle);
    const recoil = Math.max(0, Math.min(1, p.recoil || 0));
    ctx.translate(-recoil * 1.5, 0);

    ctx.strokeStyle = recoil > 0.5 ? '#ffffff' : carapaceCol;
    ctx.lineWidth = 2.2;
    // Twin Turret Barrels
    ctx.beginPath();
    ctx.moveTo(2, -3.5);
    ctx.lineTo(r * 0.95 - recoil * 3, -3.5);
    ctx.moveTo(2, 3.5);
    ctx.lineTo(r * 0.95 - recoil * 3, 3.5);
    ctx.stroke();

    // Central Diamond Turret Hub
    ctx.fillStyle = '#051024';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(r * 0.45, 0);
    ctx.lineTo(0, -r * 0.38);
    ctx.lineTo(-r * 0.38, 0);
    ctx.lineTo(0, r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

