// High-Velocity Sparks, Geometric Shatter Shards, Shockwaves, and Lightning FX
const FLASH_POOL = 64;
const TRAIL_CAP = 48;
const LIGHTNING_CAP = 72;
const LIGHTNING_REJAG = 0.035; // seconds between re-jags of a lingering bolt (the crackle flicker)
export class ParticleSystem {
  constructor() {
    this.sparks = [];
    this.shards = [];
    this.shockwaves = [];
    this.lightnings = [];
    this.floatTexts = [];
    this.afterimages = [];
    this.infall = [];
    // Pooled hit-impact flares: fixed slots recycled oldest-first, drawn as one batched path.
    this.impacts = Array.from({ length: 96 }, () => ({ x: 0, y: 0, cos: 1, sin: 0, size: 0, life: 0, maxLife: 1 }));
    this.impactCount = 0;
    this.impactNext = 0;
    // Pooled crit flares: gold 8-point stars, same recycling scheme as the impacts.
    this.critFlares = Array.from({ length: 48 }, () => ({ x: 0, y: 0, size: 0, spin: 0, life: 0, maxLife: 1 }));
    this.critCount = 0;
    this.critNext = 0;
    // Pooled glow flashes (muzzle, launch and impact blooms): soft disc plus white-hot core.
    this.flashes = Array.from({ length: FLASH_POOL }, () => ({ x: 0, y: 0, size: 0, hue: 0, life: 0, maxLife: 1 }));
    this.flashCount = 0;
    this.flashNext = 0;
    // Fading exhaust trails left behind by detonated missiles (polyline handed over, not copied).
    this.trails = [];
    // Live tuning source ({ vfxIntensity, vfxLinger }); main.js points this at TUNING. Missing
    // values fall back to 1 so standalone systems (Field Guide previews, tests) look the same.
    this.tuning = null;
  }

  // Brightness/width multiplier and lifetime multiplier for weapon effects (user knobs).
  get intensity() { return this.tuning?.vfxIntensity ?? 1; }
  get linger() { return this.tuning?.vfxLinger ?? 1; }

  clear() {
    for (const key of ['sparks', 'shards', 'shockwaves', 'lightnings', 'floatTexts', 'afterimages', 'infall', 'trails']) this[key].length = 0;
    this.impactCount = 0;
    this.impactNext = 0;
    this.critCount = 0;
    this.critNext = 0;
    this.flashCount = 0;
    this.flashNext = 0;
  }

  // Glow flash: a soft hue disc that swells while a white core collapses (pooled, no allocation).
  // Lifetime scales with vfxLinger.
  spawnFlash(x, y, size, hue = 190, life = 0.16) {
    let slot;
    if (this.flashCount < this.flashes.length) {
      slot = this.flashes[this.flashCount++];
    } else {
      slot = this.flashes[this.flashNext];
      this.flashNext = (this.flashNext + 1) % this.flashes.length;
    }
    slot.x = x;
    slot.y = y;
    slot.size = size;
    slot.hue = hue;
    slot.life = slot.maxLife = life * this.linger;
  }

  // Exhaust trail that keeps glowing after its owner is gone. `points` ({x, y}[]) is taken over.
  spawnTrail(points, hue, width = 1, life = 0.4) {
    if (!points || points.length < 2) return;
    if (this.trails.length >= TRAIL_CAP) this.trails.shift();
    const l = life * this.linger;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    this.trails.push({ points, hue, width, life: l, maxLife: l, minX, minY, maxX, maxY });
  }

  // Critical-hit flare: a sharp gold 8-point star that snaps open and collapses (pooled, no allocation).
  spawnCritFlare(x, y, size = 16, life = 0.18) {
    let slot;
    if (this.critCount < this.critFlares.length) {
      slot = this.critFlares[this.critCount++];
    } else {
      slot = this.critFlares[this.critNext];
      this.critNext = (this.critNext + 1) % this.critFlares.length;
    }
    slot.x = x;
    slot.y = y;
    slot.size = size;
    slot.spin = (x * 0.37 + y * 0.11) % (Math.PI / 4);
    slot.life = life;
    slot.maxLife = life;
  }

  // Brief white-hot cross flare at a hit point; `angle` is the incoming direction.
  spawnImpact(x, y, angle, size = 7, life = 0.1) {
    let slot;
    if (this.impactCount < this.impacts.length) {
      slot = this.impacts[this.impactCount++];
    } else {
      // Full: overwrite in round-robin order (the oldest flare is the nearest to fading anyway).
      slot = this.impacts[this.impactNext];
      this.impactNext = (this.impactNext + 1) % this.impacts.length;
    }
    slot.x = x;
    slot.y = y;
    slot.cos = Math.cos(angle);
    slot.sin = Math.sin(angle);
    slot.size = size;
    slot.life = life;
    slot.maxLife = life;
  }

  // Burst of velocity-stretched neon line sparks (Geometry Wars signature explosion)
  spawnExplosionSparks(x, y, count, hue, speedMin = 3, speedMax = 16, size = 2.2) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.pow(Math.random(), 0.7) * (speedMax - speedMin);
      const life = 0.45 + Math.random() * 0.55;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: hue + (Math.random() - 0.5) * 28,
        life,
        maxLife: life,
        size: size * (0.7 + Math.random() * 0.6),
        drag: 0.94 + Math.random() * 0.035
      });
    }
  }

  // Directional spray (bullet impacts, thruster exhaust)
  spawnDirectionalSparks(x, y, baseAngle, spread, count, hue, speedMax = 10) {
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * spread;
      const speed = 2 + Math.random() * speedMax;
      const life = 0.22 + Math.random() * 0.3;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: hue + (Math.random() - 0.5) * 20,
        life,
        maxLife: life,
        size: 1.8,
        drag: 0.92
      });
    }
  }

  // Breaks an enemy's polygon into tumbling vector line shards!
  spawnPolygonShatter(x, y, radius, sides, rotation, hue, speedMult = 1) {
    const verts = [];
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i * Math.PI * 2) / sides;
      verts.push({
        x: Math.cos(a) * radius,
        y: Math.sin(a) * radius
      });
    }

    for (let i = 0; i < sides; i++) {
      const p1 = verts[i];
      const p2 = verts[(i + 1) % sides];
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;
      const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const segAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const outAngle = Math.atan2(midY, midX) + (Math.random() - 0.5) * 0.5;
      const spd = (3.5 + Math.random() * 6.5) * speedMult;
      const life = 0.55 + Math.random() * 0.45;

      this.shards.push({
        x: x + midX,
        y: y + midY,
        vx: Math.cos(outAngle) * spd,
        vy: Math.sin(outAngle) * spd,
        len: segLen * (0.85 + Math.random() * 0.3),
        angle: segAngle,
        vRot: (Math.random() - 0.5) * 0.32,
        hue: hue + (Math.random() - 0.5) * 18,
        life,
        maxLife: life
      });
    }
  }

  // inward = true contracts from maxRadius to the centre and brightens (implosion wind-up).
  // Outward rings last vfxLinger x `duration`; inward rings keep their timing (they are synced
  // to gameplay, e.g. the singularity wind-up).
  spawnShockwave(x, y, maxRadius, hue, lineWidth = 4, duration = 0.42, inward = false) {
    if (!inward) duration *= this.linger;
    this.shockwaves.push({
      x,
      y,
      radius: inward ? maxRadius : 4,
      maxRadius,
      hue,
      lineWidth,
      life: duration,
      maxLife: duration,
      inward
    });
  }

  // Spiralling infall stream: sparks that orbit a (possibly moving) well and sink into its core,
  // spinning up as they fall. `well` is any live object with x/y (and `dead` once it is gone).
  spawnInfall(well, radius, hue, count = 1) {
    if (this.infall.length >= 480) return;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = radius * (0.7 + Math.random() * 0.3);
      const life = 0.8 + Math.random() * 0.5;
      const x = well.x + Math.cos(ang) * r;
      const y = well.y + Math.sin(ang) * r;
      this.infall.push({
        well,
        ang,
        r,
        r0: r,
        spin: 0.035 + Math.random() * 0.025,
        sink: 0.955 - Math.random() * 0.02,
        hue,
        x,
        y,
        lx: x,
        ly: y,
        life,
        maxLife: life
      });
    }
  }

  // Tesla bolt from (x1, y1) to (x2, y2): a jagged main channel with optional side forks. It lingers
  // (life x vfxLinger) and re-jags every LIGHTNING_REJAG seconds while it fades, so it crackles
  // instead of vanishing. `width` scales every stroke; `branches` is the number of side forks.
  spawnLightning(x1, y1, x2, y2, hue = 190, width = 1, life = 0.28, branches = -1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const steps = Math.max(4, Math.min(14, Math.round(len / 22)));
    const amp = Math.min(30, 5 + len * 0.085);
    if (branches < 0) branches = len > 90 ? 1 + (Math.random() < 0.45 ? 1 : 0) : len > 45 ? 1 : 0;
    const forks = [];
    for (let k = 0; k < branches; k++) {
      const m = 2 + Math.floor(Math.random() * 3);
      forks.push({
        at: 1 + Math.floor(Math.random() * (steps - 1)), // main-channel vertex the fork leaves from
        ang: (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.6),
        len: len * (0.22 + Math.random() * 0.2),
        off: new Float32Array(m + 1)
      });
    }
    const l = life * this.linger;
    const pad = amp + len * 0.45;
    const bolt = {
      x1, y1, x2, y2,
      ux: dx / len, uy: dy / len, len, amp,
      off: new Float32Array(steps + 1),
      forks,
      hue,
      width,
      flick: 1,
      rejag: LIGHTNING_REJAG,
      life: l,
      maxLife: l,
      minX: Math.min(x1, x2) - pad, maxX: Math.max(x1, x2) + pad,
      minY: Math.min(y1, y2) - pad, maxY: Math.max(y1, y2) + pad
    };
    this.jag(bolt);
    if (this.lightnings.length >= LIGHTNING_CAP) this.lightnings.shift();
    this.lightnings.push(bolt);
    return bolt;
  }

  // Re-roll a bolt's perpendicular offsets (ends pinned, the middle swings widest) and its forks.
  jag(bolt) {
    const off = bolt.off;
    const n = off.length - 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      off[i] = (Math.random() - 0.5) * 2 * bolt.amp * (0.35 + 0.65 * Math.sin(Math.PI * t));
    }
    off[0] = off[n] = 0;
    for (let k = 0; k < bolt.forks.length; k++) {
      const f = bolt.forks[k];
      const m = f.off.length - 1;
      for (let j = 1; j <= m; j++) f.off[j] = (Math.random() - 0.5) * f.len * 0.45;
      f.off[0] = 0;
    }
  }

  spawnFloatText(x, y, text, color = '#00f3ff', size = 14) {
    this.floatTexts.push({
      x,
      y,
      vy: -1.4,
      text,
      color,
      size,
      life: 0.75,
      maxLife: 0.75
    });
  }

  spawnAfterimage(x, y, angle, radius, hue = 188) {
    this.afterimages.push({
      x,
      y,
      angle,
      radius,
      hue,
      life: 0.25,
      maxLife: 0.25
    });
  }

  // Pull sparks toward gravity wells / black holes!
  applyGravityWell(gx, gy, strength, radius) {
    const rSq = radius * radius;
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const dx = gx - s.x;
      const dy = gy - s.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < rSq && dSq > 9) {
        const d = Math.sqrt(dSq);
        const f = (strength * (1 - d / radius)) / d;
        s.vx += (dx - dy * 0.4) * f;
        s.vy += (dy + dx * 0.4) * f;
      }
    }
  }

  update(dt, width, height) {
    // Update Infall Streams (die with their well or on reaching the event horizon)
    for (let i = this.infall.length - 1; i >= 0; i--) {
      const f = this.infall[i];
      f.life -= dt;
      f.r *= f.sink;
      f.ang += f.spin * Math.min(5, Math.sqrt(f.r0 / Math.max(1, f.r)));
      f.lx = f.x;
      f.ly = f.y;
      f.x = f.well.x + Math.cos(f.ang) * f.r;
      f.y = f.well.y + Math.sin(f.ang) * f.r;
      if (f.life <= 0 || f.well.dead || f.r < 7) {
        this.infall[i] = this.infall[this.infall.length - 1];
        this.infall.pop();
      }
    }

    // Update Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= s.drag;
      s.vy *= s.drag;
      s.life -= dt;

      // Ricochet sparks off arena borders
      if (s.x < 4 || s.x > width - 4) {
        s.vx *= -0.85;
        s.x = Math.max(4, Math.min(width - 4, s.x));
      }
      if (s.y < 4 || s.y > height - 4) {
        s.vy *= -0.85;
        s.y = Math.max(4, Math.min(height - 4, s.y));
      }

      if (s.life <= 0) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
      }
    }

    // Cap max sparks to keep 60+ fps rock solid during massive screen-wipes
    if (this.sparks.length > 1800) {
      this.sparks.length = 1800;
    }

    // Update Shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const sh = this.shards[i];
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.vx *= 0.95;
      sh.vy *= 0.95;
      sh.angle += sh.vRot;
      sh.life -= dt;

      if (sh.x < 6 || sh.x > width - 6) {
        sh.vx *= -0.8;
        sh.x = Math.max(6, Math.min(width - 6, sh.x));
      }
      if (sh.y < 6 || sh.y > height - 6) {
        sh.vy *= -0.8;
        sh.y = Math.max(6, Math.min(height - 6, sh.y));
      }

      if (sh.life <= 0) {
        this.shards[i] = this.shards[this.shards.length - 1];
        this.shards.pop();
      }
    }

    // Update Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const progress = 1 - Math.max(0, sw.life / sw.maxLife);
      // Ease-out expansion (or accelerating collapse for implosion rings)
      sw.radius = sw.inward
        ? sw.maxRadius * (1 - progress * progress)
        : sw.maxRadius * (1 - Math.pow(1 - progress, 2.6));
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Update Lightnings: lingering bolts re-jag and flicker as they fade.
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const l = this.lightnings[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.lightnings.splice(i, 1);
        continue;
      }
      l.rejag -= dt;
      if (l.rejag <= 0) {
        l.rejag += LIGHTNING_REJAG;
        this.jag(l);
        l.flick = l.life / l.maxLife > 0.8 ? 1 : 0.55 + Math.random() * 0.45;
      }
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].life -= dt;
      if (this.trails[i].life <= 0) this.trails.splice(i, 1);
    }

    for (let i = this.flashCount - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        const last = this.flashes[--this.flashCount];
        this.flashes[this.flashCount] = fl;
        this.flashes[i] = last;
      }
    }
    if (this.flashNext >= this.flashCount) this.flashNext = 0;

    // Update Afterimages
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) {
        this.afterimages.splice(i, 1);
      }
    }

    // Update Impact Flares (swap-remove inside the fixed pool)
    for (let i = this.impactCount - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.life -= dt;
      if (im.life <= 0) {
        const last = this.impacts[--this.impactCount];
        this.impacts[this.impactCount] = im;
        this.impacts[i] = last;
      }
    }
    if (this.impactNext >= this.impactCount) this.impactNext = 0;

    for (let i = this.critCount - 1; i >= 0; i--) {
      const cf = this.critFlares[i];
      cf.life -= dt;
      if (cf.life <= 0) {
        const last = this.critFlares[--this.critCount];
        this.critFlares[this.critCount] = cf;
        this.critFlares[i] = last;
      }
    }
    if (this.critNext >= this.critCount) this.critNext = 0;

    // Update Float Texts
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const ft = this.floatTexts[i];
      ft.y += ft.vy;
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatTexts.splice(i, 1);
      }
    }
  }

  drawInfall(ctx, visible) {
    const hues = this.infallHues || (this.infallHues = []);
    hues.length = 0;
    for (let i = 0; i < this.infall.length; i++) {
      if (!hues.includes(this.infall[i].hue)) hues.push(this.infall[i].hue);
    }
    for (let band = 0; band < 2; band++) {
      ctx.lineWidth = band === 0 ? 1.3 : 2.1;
      for (let h = 0; h < hues.length; h++) {
        ctx.strokeStyle = band === 0 ? `hsla(${hues[h]}, 100%, 66%, 0.45)` : `hsla(${hues[h]}, 100%, 86%, 0.9)`;
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < this.infall.length; i++) {
          const f = this.infall[i];
          if (f.hue !== hues[h] || (f.r < f.r0 * 0.45 ? 1 : 0) !== band || !visible(f.x, f.y, 24)) continue;
          ctx.moveTo(f.x - (f.x - f.lx) * 2.6, f.y - (f.y - f.ly) * 2.6);
          ctx.lineTo(f.x, f.y);
          any = true;
        }
        if (any) ctx.stroke();
      }
    }
  }

  // Build the main-channel path of a bolt from its current offsets.
  traceBolt(ctx, l) {
    const off = l.off;
    const n = off.length - 1;
    const px = -l.uy, py = l.ux;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    for (let i = 1; i <= n; i++) {
      const d = (l.len * i) / n;
      ctx.lineTo(l.x1 + l.ux * d + px * off[i], l.y1 + l.uy * d + py * off[i]);
    }
  }

  // Build every fork path of a bolt: each leaves a main-channel vertex at an angle and jitters out.
  traceForks(ctx, l) {
    const n = l.off.length - 1;
    const px = -l.uy, py = l.ux;
    ctx.beginPath();
    for (let k = 0; k < l.forks.length; k++) {
      const f = l.forks[k];
      const d0 = (l.len * f.at) / n;
      const sx = l.x1 + l.ux * d0 + px * l.off[f.at];
      const sy = l.y1 + l.uy * d0 + py * l.off[f.at];
      const c = Math.cos(f.ang), s = Math.sin(f.ang);
      const fx = l.ux * c - l.uy * s, fy = l.ux * s + l.uy * c;
      const m = f.off.length - 1;
      ctx.moveTo(sx, sy);
      for (let j = 1; j <= m; j++) {
        const d = (f.len * j) / m;
        ctx.lineTo(sx + fx * d - fy * f.off[j], sy + fy * d + fx * f.off[j]);
      }
    }
  }

  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    const visible = (x, y, r) => x + r >= camX && y + r >= camY && x - r <= camX + viewW && y - r <= camY + viewH;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // 1. Draw Dash Afterimages
    for (let i = 0; i < this.afterimages.length; i++) {
      const ai = this.afterimages[i];
      if (!visible(ai.x, ai.y, ai.radius * 1.4)) continue;
      const alpha = (ai.life / ai.maxLife) * 0.7;
      ctx.save();
      ctx.translate(ai.x, ai.y);
      ctx.rotate(ai.angle);
      ctx.strokeStyle = `hsla(${ai.hue}, 100%, 65%, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const r = ai.radius;
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(-r * 0.85, -r * 0.85);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.85, r * 0.85);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw Expanding Shockwave Rings. Outward rings hold their brightness a little before fading
    // (alpha eases out) and keep a minimum width so they stay readable to the end.
    const vfx = this.intensity;
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!visible(sw.x, sw.y, sw.radius + sw.lineWidth * 3)) continue;
      const fade = Math.max(0, sw.life / sw.maxLife);
      const alpha = sw.inward ? Math.min(1, 1.25 - fade) : Math.pow(fade, 0.7);
      // Outer neon halo
      ctx.strokeStyle = `hsla(${sw.hue}, 100%, 60%, ${Math.min(1, alpha * 0.55 * vfx)})`;
      ctx.lineWidth = sw.lineWidth * 2.5 * (0.35 + 0.65 * alpha) * vfx;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner white-hot core ring
      ctx.strokeStyle = `hsla(${sw.hue}, 100%, 88%, ${Math.min(1, alpha * 0.9 * vfx)})`;
      ctx.lineWidth = Math.max(1, sw.lineWidth * (0.4 + 0.6 * alpha) * vfx);
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2b. Lingering exhaust trails: a wide soft glow under a thin bright core, fading out.
    for (let i = 0; i < this.trails.length; i++) {
      const tr = this.trails[i];
      if (tr.maxX + 12 < camX || tr.minX - 12 > camX + viewW || tr.maxY + 12 < camY || tr.minY - 12 > camY + viewH) continue;
      const a = Math.max(0, tr.life / tr.maxLife);
      const pts = tr.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.strokeStyle = `hsla(${tr.hue}, 100%, 62%, ${Math.min(1, a * 0.28 * vfx)})`;
      ctx.lineWidth = 7 * tr.width * vfx * (0.5 + 0.5 * a);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${tr.hue}, 100%, 80%, ${Math.min(1, a * 0.6 * vfx)})`;
      ctx.lineWidth = 1.8 * tr.width;
      ctx.stroke();
    }

    // 3. Draw Geometric Shatter Shards
    for (let i = 0; i < this.shards.length; i++) {
      const sh = this.shards[i];
      if (!visible(sh.x, sh.y, sh.len)) continue;
      const alpha = Math.max(0, sh.life / sh.maxLife);
      const dx = Math.cos(sh.angle) * sh.len * 0.5;
      const dy = Math.sin(sh.angle) * sh.len * 0.5;

      ctx.strokeStyle = `hsla(${sh.hue}, 100%, 68%, ${alpha})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sh.x - dx, sh.y - dy);
      ctx.lineTo(sh.x + dx, sh.y + dy);
      ctx.stroke();
    }

    // 4. Draw Velocity-Stretched Sparks
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      if (!visible(s.x, s.y, Math.hypot(s.vx, s.vy) * 2.3 + s.size)) continue;
      const alpha = Math.max(0, s.life / s.maxLife);
      const tailX = s.x - s.vx * 2.3;
      const tailY = s.y - s.vy * 2.3;

      ctx.strokeStyle = `hsla(${s.hue}, 100%, 68%, ${alpha})`;
      ctx.lineWidth = s.size * alpha;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }

    // 4b. Draw Infall Streams: comet streaks batched into one path per (hue, band) so hundreds of
    // streaks cost a handful of strokes. The outer band is dim; the inner band runs white-hot.
    if (this.infall.length) this.drawInfall(ctx, visible);

    // 5. Draw Chain Lightning Arcs: outer halo, hue glow and white-hot core over the main channel,
    // then glow + core over the side forks. Bright for the first moments, then a flickering fade.
    if (this.lightnings.length) {
      ctx.lineJoin = 'bevel';
      for (let i = 0; i < this.lightnings.length; i++) {
        const l = this.lightnings[i];
        if (l.maxX < camX || l.minX > camX + viewW || l.maxY < camY || l.minY > camY + viewH) continue;
        const t = 1 - l.life / l.maxLife;
        const alpha = (t < 0.15 ? 1 : Math.pow((1 - t) / 0.85, 1.2)) * l.flick;
        const w = l.width * vfx;
        this.traceBolt(ctx, l);
        if (l.width >= 0.7) {
          // Crackle stubs (thin bolts) skip the wide halo: it is the costliest pass.
          ctx.strokeStyle = `hsla(${l.hue}, 100%, 62%, ${Math.min(1, alpha * 0.3 * vfx)})`;
          ctx.lineWidth = 13 * w;
          ctx.stroke();
        }
        ctx.strokeStyle = `hsla(${l.hue}, 100%, 72%, ${Math.min(1, alpha * 0.85 * vfx)})`;
        ctx.lineWidth = 5 * w * (0.6 + 0.4 * alpha);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, alpha)})`;
        ctx.lineWidth = 1.9 * w * (0.6 + 0.4 * alpha);
        ctx.stroke();
        if (l.forks.length) {
          this.traceForks(ctx, l);
          ctx.strokeStyle = `hsla(${l.hue}, 100%, 72%, ${Math.min(1, alpha * 0.6 * vfx)})`;
          ctx.lineWidth = 3 * w * (0.6 + 0.4 * alpha);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 0.8)})`;
          ctx.lineWidth = 1.1 * w;
          ctx.stroke();
        }
      }
      ctx.lineJoin = 'miter';
    }

    // 5b. Glow flashes: soft swelling hue disc plus a collapsing white core.
    for (let i = 0; i < this.flashCount; i++) {
      const fl = this.flashes[i];
      if (!visible(fl.x, fl.y, fl.size * 1.3)) continue;
      const a = Math.max(0, fl.life / fl.maxLife);
      const k = 1 - a;
      ctx.fillStyle = `hsla(${fl.hue}, 100%, 62%, ${Math.min(1, a * 0.3 * vfx)})`;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, fl.size * (0.75 + 0.5 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${fl.hue}, 100%, 92%, ${Math.min(1, a * 0.85 * vfx)})`;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, fl.size * 0.34 * (1 - 0.6 * k), 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Hit Impact Flares: one batched stroke — a long flare across the shot, a short one along it.
    if (this.impactCount > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < this.impactCount; i++) {
        const im = this.impacts[i];
        if (!visible(im.x, im.y, im.size * 1.5)) continue;
        const s = im.size * (0.3 + 0.7 * Math.max(0, im.life / im.maxLife));
        const ax = im.cos * s * 0.55, ay = im.sin * s * 0.55;
        const px = -im.sin * s, py = im.cos * s;
        ctx.moveTo(im.x - px, im.y - py);
        ctx.lineTo(im.x + px, im.y + py);
        ctx.moveTo(im.x - ax, im.y - ay);
        ctx.lineTo(im.x + ax, im.y + ay);
      }
      ctx.stroke();
    }

    // 6b. Crit Flares: 8-point stars (4 long rays, 4 short) that snap open then collapse.
    // One path, stroked twice: a wide gold glow and a white-hot core.
    if (this.critCount > 0) {
      ctx.beginPath();
      for (let i = 0; i < this.critCount; i++) {
        const cf = this.critFlares[i];
        if (!visible(cf.x, cf.y, cf.size * 1.6)) continue;
        const t = 1 - Math.max(0, cf.life / cf.maxLife);
        const s = cf.size * (t < 0.25 ? 0.4 + 2.4 * t : 1 - (t - 0.25) * 0.8);
        for (let k = 0; k < 4; k++) {
          const a = cf.spin + (k * Math.PI) / 4;
          const len = k % 2 ? s * 0.55 : s * 1.5;
          const c = Math.cos(a) * len, d = Math.sin(a) * len;
          ctx.moveTo(cf.x - c, cf.y - d);
          ctx.lineTo(cf.x + c, cf.y + d);
        }
      }
      ctx.strokeStyle = 'rgba(255, 200, 40, 0.75)';
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 252, 230, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // 7. Floating Text Popups
    ctx.textAlign = 'center';
    for (let i = 0; i < this.floatTexts.length; i++) {
      const ft = this.floatTexts[i];
      if (!visible(ft.x, ft.y, ft.text.length * ft.size)) continue;
      ctx.font = `900 ${ft.size}px system-ui, sans-serif`;
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(ft.text, ft.x, ft.y);
    }

    ctx.restore();
  }
}
