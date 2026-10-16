// World-Space Reactive Spring-Mass Warping Neon Grid (Camera-Culled for 10x Sector Map)
import { TUNING } from './config.js';

export class WarpGrid {
  constructor(worldWidth, worldHeight, spacing = 68) {
    this.spacing = spacing;
    this.stiffness = 0.035;
    this.neighborStiffness = 0.065;
    this.damping = 0.89;
    this.resize(worldWidth, worldHeight);
  }

  resize(worldWidth, worldHeight) {
    this.width = worldWidth;
    this.height = worldHeight;
    this.cols = Math.ceil(worldWidth / this.spacing) + 1;
    this.rows = Math.ceil(worldHeight / this.spacing) + 1;
    this.points = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * this.spacing;
        const y = r * this.spacing;
        const isBorder = r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1;
        this.points.push({
          x,
          y,
          ox: x,
          oy: y,
          vx: 0,
          vy: 0,
          energy: 0,
          hue: 195,
          pinned: isBorder
        });
      }
    }
  }

  reset() {
    for (const point of this.points) {
      point.x = point.ox;
      point.y = point.oy;
      point.vx = point.vy = point.energy = 0;
    }
  }

  applyImpulse(px, py, force, radius, hue = 190) {
    force *= (TUNING.gridWarpMult ?? 1.0);
    const rSq = radius * radius;
    const minCol = Math.max(1, Math.floor((px - radius) / this.spacing));
    const maxCol = Math.min(this.cols - 2, Math.ceil((px + radius) / this.spacing));
    const minRow = Math.max(1, Math.floor((py - radius) / this.spacing));
    const maxRow = Math.min(this.rows - 2, Math.ceil((py + radius) / this.spacing));

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = pt.x - px;
        const dy = pt.y - py;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 0.001) {
          const dist = Math.sqrt(dSq);
          const falloff = 1 - dist / radius;
          const strength = (force * falloff * falloff) / dist;
          pt.vx += dx * strength;
          pt.vy += dy * strength;
          pt.energy = Math.min(1.5, pt.energy + falloff * 0.85);
          if (hue !== null) pt.hue = hue;
        }
      }
    }
  }

  applyImplosion(px, py, force, radius, hue = 330, swirl = 0.25) {
    const rSq = radius * radius;
    const minCol = Math.max(1, Math.floor((px - radius) / this.spacing));
    const maxCol = Math.min(this.cols - 2, Math.ceil((px + radius) / this.spacing));
    const minRow = Math.max(1, Math.floor((py - radius) / this.spacing));
    const maxRow = Math.min(this.rows - 2, Math.ceil((py + radius) / this.spacing));

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const pt = this.points[rowOffset + c];
        const dx = px - pt.x;
        const dy = py - pt.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < rSq && dSq > 4) {
          const dist = Math.sqrt(dSq);
          const falloff = 1 - dist / radius;
          const pull = (force * falloff) / dist;
          pt.vx += (dx + -dy * swirl) * pull;
          pt.vy += (dy + dx * swirl) * pull;
          pt.energy = Math.min(1.5, pt.energy + falloff * 0.45);
          pt.hue = hue;
        }
      }
    }
  }

  update(camX = 0, camY = 0, viewW = 1920, viewH = 1080) {
    const cols = this.cols;
    const rows = this.rows;
    const pts = this.points;
    const sp = this.spacing;
    const nStiff = this.neighborStiffness;

    // Only simulate active camera region (+4 cell margin) for instant performance on huge maps
    const minC = Math.max(1, Math.floor(camX / sp) - 4);
    const maxC = Math.min(cols - 2, Math.ceil((camX + viewW) / sp) + 4);
    const minR = Math.max(1, Math.floor(camY / sp) - 4);
    const maxR = Math.min(rows - 2, Math.ceil((camY + viewH) / sp) + 4);

    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c <= maxC; c++) {
        const idx = rowOffset + c;
        const pt = pts[idx];
        const left = pts[idx - 1];
        const right = pts[idx + 1];
        const up = pts[idx - cols];
        const down = pts[idx + cols];

        const avgX = (left.x + right.x + up.x + down.x) * 0.25;
        const avgY = (left.y + right.y + up.y + down.y) * 0.25;

        pt.vx += (avgX - pt.x) * nStiff;
        pt.vy += (avgY - pt.y) * nStiff;
      }
    }

    const maxDisp = sp * 2.1;
    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c <= maxC; c++) {
        const pt = pts[rowOffset + c];
        if (pt.pinned) continue;

        const dx = pt.ox - pt.x;
        const dy = pt.oy - pt.y;

        pt.vx = (pt.vx + dx * this.stiffness) * this.damping;
        pt.vy = (pt.vy + dy * this.stiffness) * this.damping;

        pt.x += pt.vx;
        pt.y += pt.vy;

        const offX = pt.x - pt.ox;
        const offY = pt.y - pt.oy;
        if (offX * offX + offY * offY > maxDisp * maxDisp) {
          const d = Math.hypot(offX, offY);
          pt.x = pt.ox + (offX / d) * maxDisp;
          pt.y = pt.oy + (offY / d) * maxDisp;
        }

        pt.energy *= 0.94;
      }
    }
  }

  draw(ctx, camX = 0, camY = 0, viewW = 1920, viewH = 1080) {
    const cols = this.cols;
    const rows = this.rows;
    const pts = this.points;
    const sp = this.spacing;

    const minC = Math.max(0, Math.floor(camX / sp) - 2);
    const maxC = Math.min(cols - 1, Math.ceil((camX + viewW) / sp) + 2);
    const minR = Math.max(0, Math.floor(camY / sp) - 2);
    const maxR = Math.min(rows - 1, Math.ceil((camY + viewH) / sp) + 2);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 175, 255, 0.14)';
    ctx.beginPath();

    for (let r = minR; r <= maxR; r++) {
      const rowOffset = r * cols;
      ctx.moveTo(pts[rowOffset + minC].x, pts[rowOffset + minC].y);
      for (let c = minC + 1; c <= maxC; c++) {
        const pt = pts[rowOffset + c];
        ctx.lineTo(pt.x, pt.y);
      }
    }

    for (let c = minC; c <= maxC; c++) {
      ctx.moveTo(pts[minR * cols + c].x, pts[minR * cols + c].y);
      for (let r = minR + 1; r <= maxR; r++) {
        const pt = pts[r * cols + c];
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.7;

    for (let r = minR; r < maxR; r++) {
      const rowOffset = r * cols;
      for (let c = minC; c < maxC; c++) {
        const idx = rowOffset + c;
        const pt = pts[idx];
        if (pt.energy > 0.08) {
          const right = pts[idx + 1];
          const down = pts[idx + cols];
          const alpha = Math.min(0.85, pt.energy * 0.65);
          ctx.strokeStyle = `hsla(${pt.hue}, 100%, 62%, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(right.x, right.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.lineTo(down.x, down.y);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }
}
