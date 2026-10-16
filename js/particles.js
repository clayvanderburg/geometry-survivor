// High-Velocity Sparks, Geometric Shatter Shards, Shockwaves, and Lightning FX
export class ParticleSystem {
  constructor() {
    this.sparks = [];
    this.shards = [];
    this.shockwaves = [];
    this.lightnings = [];
    this.floatTexts = [];
    this.afterimages = [];
    this.infall = [];
  }

  clear() {
    for (const key of ['sparks', 'shards', 'shockwaves', 'lightnings', 'floatTexts', 'afterimages', 'infall']) this[key].length = 0;
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
  spawnShockwave(x, y, maxRadius, hue, lineWidth = 4, duration = 0.42, inward = false) {
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

  spawnLightning(x1, y1, x2, y2, hue = 190) {
    const segments = [];
    const steps = 6;
    let cx = x1;
    let cy = y1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const tx = x1 + (x2 - x1) * t;
      const ty = y1 + (y2 - y1) * t;
      const jitter = i < steps ? (Math.random() - 0.5) * 26 : 0;
      const perpX = -(y2 - y1);
      const perpY = x2 - x1;
      const len = Math.hypot(perpX, perpY) || 1;
      const nx = tx + (perpX / len) * jitter;
      const ny = ty + (perpY / len) * jitter;
      segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
      cx = nx;
      cy = ny;
    }
    this.lightnings.push({
      segments,
      hue,
      life: 0.18,
      maxLife: 0.18
    });
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

    // Update Lightnings
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      this.lightnings[i].life -= dt;
      if (this.lightnings[i].life <= 0) {
        this.lightnings.splice(i, 1);
      }
    }

    // Update Afterimages
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) {
        this.afterimages.splice(i, 1);
      }
    }

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

    // 2. Draw Expanding Shockwave Rings
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!visible(sw.x, sw.y, sw.radius + sw.lineWidth * 3)) continue;
      const fade = Math.max(0, sw.life / sw.maxLife);
      const alpha = sw.inward ? Math.min(1, 1.25 - fade) : fade;
      // Outer neon halo
      ctx.strokeStyle = `hsla(${sw.hue}, 100%, 60%, ${alpha * 0.55})`;
      ctx.lineWidth = sw.lineWidth * 2.5 * alpha;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner white-hot core ring
      ctx.strokeStyle = `hsla(${sw.hue}, 100%, 88%, ${alpha * 0.9})`;
      ctx.lineWidth = Math.max(1, sw.lineWidth * alpha);
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
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

    // 5. Draw Chain Lightning Arcs
    for (let i = 0; i < this.lightnings.length; i++) {
      const l = this.lightnings[i];
      if (!l.segments.some(seg => Math.max(seg.x1, seg.x2) >= camX && Math.min(seg.x1, seg.x2) <= camX + viewW && Math.max(seg.y1, seg.y2) >= camY && Math.min(seg.y1, seg.y2) <= camY + viewH)) continue;
      const alpha = l.life / l.maxLife;
      ctx.strokeStyle = `hsla(${l.hue}, 100%, 75%, ${alpha})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (const seg of l.segments) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      }
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 6. Floating Text Popups
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
