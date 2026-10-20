// Instant replay (visual only): a rolling buffer of small snapshots of the game canvas, kept for the last
// few seconds of play, then played back on the death screen as a VHS tape: normal speed, slow-mo into
// the fatal hit, a hold, then a fast ◀◀ rewind and round again. Snapshots are recycled canvases, so
// recording allocates nothing once the buffer is full.

export const REPLAY_SETTINGS = Object.freeze({
  desktop: { seconds: 4, fps: 15, width: 384 },
  touch: { seconds: 3.5, fps: 12, width: 256 }
});

const SLOWMO_LEAD = 0.9; // seconds before death where the tape drops to slow-mo...
const SLOWMO_TAIL = 0.6; // ...and after it, where it picks back up (the blast plays in slow-mo)
const SLOWMO_RATE = 0.4;
const HOLD = 0.7;        // seconds on the last frame before rewinding
const REWIND_RATE = 8;

const defaultCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null);

export class ReplayRecorder {
  // tail: extra seconds kept after the fatal hit (the blast); createCanvas() makes a snapshot canvas.
  constructor({ seconds = 4, fps = 15, width = 384, tail = 1, createCanvas = defaultCanvas } = {}) {
    this.seconds = seconds;
    this.interval = 1 / fps;
    this.width = width;
    this.capacity = Math.ceil((seconds + tail) * fps) + 1;
    this.createCanvas = createCanvas;
    this.slots = [];
    this.disabled = false;
    this.reset();
  }

  reset() {
    this.clock = 0;
    this.lastShot = -Infinity;
    this.next = 0;
    this.count = 0;
    this.deathT = null;
  }

  // The fatal hit happened now (the replay slows down into it).
  markDeath() {
    this.deathT = this.clock;
  }

  // Called once per rendered frame while recording: dt is real seconds since the last frame.
  record(source, dt) {
    if (this.disabled || !source?.width || !source?.height) return;
    this.clock += dt;
    if (this.clock - this.lastShot < this.interval * 0.999) return;
    this.lastShot = this.clock;
    const w = this.width;
    const h = Math.max(1, Math.round((w * source.height) / source.width));
    let slot = this.slots[this.next];
    if (!slot) {
      const canvas = this.createCanvas();
      const ctx = canvas?.getContext?.('2d');
      if (!ctx) { this.disabled = true; return; }
      slot = this.slots[this.next] = { canvas, ctx, t: 0 };
    }
    if (slot.canvas.width !== w || slot.canvas.height !== h) {
      slot.canvas.width = w;
      slot.canvas.height = h;
    }
    slot.ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, w, h);
    slot.t = this.clock;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  // The recorded tape, oldest first, trimmed to `seconds` before the death (plus the tail after it).
  // Takes the snapshots: recording starts over on fresh canvases, so a new run can't paint over them.
  takeClip() {
    const frames = [];
    for (let i = 0; i < this.count; i++) {
      const slot = this.slots[(this.next - this.count + i + this.capacity) % this.capacity];
      frames.push({ canvas: slot.canvas, t: slot.t });
    }
    const end = this.deathT ?? this.clock;
    const kept = frames.filter((f) => f.t >= end - this.seconds);
    const clip = kept.length >= 2 ? { frames: kept, start: kept[0].t, end: kept[kept.length - 1].t, deathT: this.deathT } : null;
    this.slots = [];
    this.reset();
    return clip;
  }
}

// Plays a clip: phase 'play' (with the slow-mo ramp), 'hold', then 'rewind', looping.
export class ReplayPlayer {
  constructor(clip) {
    this.clip = clip;
    this.head = clip.start;
    this.phase = 'play';
    this.phaseT = 0;
    this.time = 0;
  }

  get slowmo() {
    const d = this.clip.deathT;
    return this.phase === 'play' && d != null && this.head >= d - SLOWMO_LEAD && this.head < d + SLOWMO_TAIL;
  }

  update(dt) {
    this.time += dt;
    const { start, end } = this.clip;
    if (this.phase === 'play') {
      this.head = Math.min(end, this.head + dt * (this.slowmo ? SLOWMO_RATE : 1));
      if (this.head >= end) { this.phase = 'hold'; this.phaseT = 0; }
    } else if (this.phase === 'hold') {
      this.phaseT += dt;
      if (this.phaseT >= HOLD) this.phase = 'rewind';
    } else {
      this.head = Math.max(start, this.head - dt * REWIND_RATE);
      if (this.head <= start) this.phase = 'play';
    }
  }

  // The snapshot showing at the play head.
  frame() {
    const frames = this.clip.frames;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].t <= this.head) lo = mid; else hi = mid - 1;
    }
    return frames[lo];
  }

  // VHS on-screen time: counts down to the fatal hit, then up after it.
  timecode() {
    const d = this.clip.deathT ?? this.clip.end;
    const s = this.head - d;
    const a = Math.abs(s);
    return `${s < -0.05 ? 'T-' : 'T+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${a % 60 < 10 ? '0' : ''}${(a % 60).toFixed(1)}`;
  }

  // A CRT monitor at (x, y, w, h): the tape with a rolling tracking band, scanlines and the VHS OSD.
  // `open` (0..1) is the power-on: the picture grows out of a bright line.
  draw(ctx, x, y, w, h, open = 1) {
    const f = this.frame();
    const t = this.time;
    ctx.save();
    // Bezel
    ctx.fillStyle = '#05010c';
    ctx.strokeStyle = '#ff2a8a';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff2a8a';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - 8, y - 8, w + 16, h + 16, 12) : ctx.rect(x - 8, y - 8, w + 16, h + 16);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    const oh = Math.max(2, h * open);
    const oy = y + (h - oh) / 2;
    ctx.beginPath();
    ctx.rect(x, oy, w, oh);
    ctx.clip();
    if (open < 1) {
      ctx.drawImage(f.canvas, x, oy, w, oh);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * (1 - open)})`;
      ctx.fillRect(x, oy, w, oh);
      ctx.restore();
      return;
    }

    const rewinding = this.phase === 'rewind';
    ctx.drawImage(f.canvas, x, y, w, h);
    // Chroma bleed: a faint pink ghost a couple of pixels over.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(f.canvas, x + 2, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Tracking band rolling down the picture (several jagged ones while rewinding).
    const bands = rewinding ? 3 : 1;
    const sh = f.canvas.height / h;
    for (let b = 0; b < bands; b++) {
      const bh = rewinding ? 10 : 14;
      const by = y + ((t * (rewinding ? 260 : 45) + b * h / bands) % (h + bh)) - bh;
      const shove = (rewinding ? 14 : 5) * Math.sin(t * 37 + b);
      const top = Math.max(y, by), bot = Math.min(y + h, by + bh);
      if (bot <= top) continue;
      ctx.drawImage(f.canvas, 0, (top - y) * sh, f.canvas.width, (bot - top) * sh, x + shove, top, w, bot - top);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x, top, w, bot - top);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      for (let i = 0; i < 6; i++) ctx.fillRect(x + ((i * 97 + t * 900) % w), top + ((i * 31) % (bot - top)), 6 + (i % 3) * 5, 1);
    }

    // Scanlines and a soft vignette.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let yy = y; yy < y + h; yy += 2) ctx.fillRect(x, yy, w, 1);
    const vig = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(10, 0, 20, 0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(x, y, w, h);

    // On-screen display, VHS style: white mono with a hard shadow.
    const fs = Math.max(10, Math.min(16, Math.round(h / 13)));
    ctx.font = `700 ${fs}px Consolas, "Courier New", monospace`;
    ctx.textBaseline = 'top';
    const osd = (text, tx, ty, align = 'left', color = '#ffffff') => {
      ctx.textAlign = align;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillText(text, tx + 1.5, ty + 1.5);
      ctx.fillStyle = color;
      ctx.fillText(text, tx, ty);
    };
    const pad = Math.max(6, fs * 0.6);
    const mode = rewinding ? '◀◀ REW' : this.phase === 'hold' ? '❚❚ PAUSE' : this.slowmo ? '▶ SLOW ×0.4' : '▶ PLAY';
    osd(mode, x + pad, y + pad, 'left', this.slowmo ? '#ff6fb5' : '#ffffff');
    // Narrow (portrait) monitors shorten the label so it never runs into the mode.
    const room = w - pad * 3 - ctx.measureText(mode).width;
    const label = ctx.measureText('INSTANT REPLAY').width <= room ? 'INSTANT REPLAY' : 'REPLAY';
    osd(label, x + w - pad, y + pad, 'right', '#05d9e8');
    osd(this.timecode(), x + pad, y + h - pad - fs, 'left');
    if (Math.floor(t * 2) % 2 === 0) osd('SP', x + w - pad, y + h - pad - fs, 'right');
    ctx.restore();
  }
}
