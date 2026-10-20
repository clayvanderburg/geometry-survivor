// Death sequence (visual only): when the shield collapses the run is already over and recorded; this
// plays the ship's meltdown and detonation over the frozen sector, slams an 80s-arcade headline
// ("YOU GOT FRAGGED") with a quip, and holds there until the player continues to the game-over screen
// (Enter, controller A / Start or the on-screen CONTINUE button) once the blast has gone off.
import { drawCrabShip } from './ship-renderer.js';

export const DEATH_TIMING = Object.freeze({
  detonate: 0.35, // meltdown before the ship blows
  headline: 0.85, // headline slams in
  quip: 1.25,     // quip starts typing
  replay: 1.6,    // the instant-replay monitor powers on (when there is a tape)
  skippable: 0.5  // earliest continue (so a held fire/dash input can't eat the whole thing)
});

// [kicker, headline, weight]: FRAGGED is the signature, the rest keep it fresh.
export const DEATH_HEADLINES = Object.freeze([
  ['YOU GOT', 'FRAGGED', 6],
  ['YOU GOT', 'DEREZZED', 2],
  ['YOU GOT', 'VAPORIZED', 2],
  ['TOTALLY', 'WRECKED', 2],
  ["YOU'RE", 'SPACE DUST', 2],
  ['GAME OVER,', 'MAN', 1],
  ['SHIP', 'FLATLINED', 1]
]);

export const DEATH_QUIPS = Object.freeze([
  'INSERT COIN TO CONTINUE',
  'BE KIND, REWIND',
  'THE GRID WILL REMEMBER YOU',
  "SHOULD'VE DRILLED LEFT",
  'YOUR INSURANCE DOES NOT COVER THE VOID',
  'THE CRAB IS IN A BETTER PLACE NOW',
  'PLEASE RETURN YOUR SHIP TO THE NEAREST HANGAR',
  'ERROR 404: SHIELD NOT FOUND',
  'THAT ONE IS GOING ON THE HIGHLIGHT REEL',
  'TOTALLY TUBULAR. TOTALLY DEAD.',
  'NEON NEVER DIES. YOU DO.',
  'MOM SAYS IT IS MY TURN NOW',
  'THE ASTEROIDS SEND THEIR CONDOLENCES',
  'RADICAL. BUT ALSO FATAL.'
]);

export function pickHeadline(rand = Math.random) {
  const total = DEATH_HEADLINES.reduce((s, h) => s + h[2], 0);
  let roll = rand() * total;
  for (const h of DEATH_HEADLINES) if ((roll -= h[2]) < 0) return [h[0], h[1]];
  return [DEATH_HEADLINES[0][0], DEATH_HEADLINES[0][1]];
}

export function pickQuip(rand = Math.random) {
  return DEATH_QUIPS[Math.floor(rand() * DEATH_QUIPS.length) % DEATH_QUIPS.length];
}

const PINK = '#ff2a8a';
const CYAN = '#05d9e8';
const HEADLINE_FONT = (px) => `italic 900 ${px}px Impact, "Arial Black", "Segoe UI", sans-serif`;
const MONO_FONT = (px) => `700 ${px}px Consolas, "Courier New", monospace`;

export class DeathSequence {
  // ship: the player at the moment of death (drawn once more for the meltdown). killer: display name
  // of what landed the last hit, or null.
  constructor(ship, { killer = null, rand = Math.random } = {}) {
    this.t = 0;
    this.ship = ship;
    this.x = ship.x;
    this.y = ship.y;
    this.killer = killer;
    [this.kicker, this.headline] = pickHeadline(rand);
    this.quip = pickQuip(rand);
    this.detonated = false;
    this.landed = false;
    this.revealed = false;
    this.fragments = [];
    this.replay = null; // ReplayPlayer (js/replay.js), handed over once the tape stops
  }

  get canSkip() { return this.t >= DEATH_TIMING.skippable && !this.revealed; }

  // game: hooks for the shared effects ({ particles, grid, sound, addShake, flash }). Runs until the
  // player continues: the headline keeps swaying meanwhile.
  update(dt, game) {
    if (this.revealed) return;
    this.t += dt;
    if (this.t < DEATH_TIMING.detonate) {
      // Meltdown: the hull leaks sparks and shudders harder as it goes critical.
      const k = this.t / DEATH_TIMING.detonate;
      game.addShake?.(3 + 9 * k);
      if (Math.random() < 0.6) game.particles?.spawnExplosionSparks(this.x, this.y, 2, Math.random() < 0.5 ? 330 : 188, 2, 7, 1.8);
    }
    if (!this.detonated && this.t >= DEATH_TIMING.detonate) this.detonate(game);
    if (!this.landed && this.t >= DEATH_TIMING.headline) {
      this.landed = true;
      game.addShake?.(14);
      game.sound?.playExplosion?.(0.9);
    }
    if (this.replay && this.t >= DEATH_TIMING.replay) this.replay.update(dt);
    for (const f of this.fragments) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.pow(0.35, dt);
      f.vy *= Math.pow(0.35, dt);
      f.rot += f.spin * dt;
      f.life -= dt;
    }
  }

  // The player continues to the results; refused during the first DEATH_TIMING.skippable seconds.
  skip() {
    if (!this.canSkip) return false;
    this.revealed = true;
    return true;
  }

  detonate(game) {
    this.detonated = true;
    const { x, y } = this;
    const r = this.ship.radius || 15;
    const p = game.particles;
    if (p) {
      p.spawnFlash(x, y, r * 9, 330, 0.5);
      p.spawnFlash(x, y, r * 5, 188, 0.35);
      p.spawnShockwave(x, y, 420, 330, 7, 0.9);
      p.spawnShockwave(x, y, 260, 188, 5, 0.65);
      p.spawnShockwave(x, y, 140, 45, 4, 0.45);
      p.spawnExplosionSparks(x, y, 90, 330, 4, 22, 2.6);
      p.spawnExplosionSparks(x, y, 60, 188, 3, 16, 2.2);
      p.spawnExplosionSparks(x, y, 30, 45, 2, 12, 2);
    }
    game.grid?.applyImpulse(x, y, 140, 380, 330);
    game.grid?.ripple?.(x, y, 360, 330);
    game.addShake?.(24);
    game.flash?.();
    game.sound?.playExplosion?.(2.6);

    // Hull fragments: neon line segments off the carapace, wings and claws, spinning outward.
    const heading = this.ship.hullAngle ?? this.ship.angle ?? 0;
    for (let i = 0; i < 16; i++) {
      const a = heading + (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 160 + Math.random() * 320;
      const life = 1.4 + Math.random() * 1.0;
      this.fragments.push({
        x: x + Math.cos(a) * r * 0.6,
        y: y + Math.sin(a) * r * 0.6,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        rot: a + Math.PI / 2,
        spin: (Math.random() - 0.5) * 14,
        len: r * (0.5 + Math.random() * 0.9),
        color: i % 4 === 0 ? '#ffffff' : i % 2 ? CYAN : PINK,
        life,
        maxLife: life
      });
    }
  }

  // World space (inside the camera transform): the melting ship, then its fragments.
  drawWorld(ctx, tuning) {
    if (!this.detonated) {
      const k = this.t / DEATH_TIMING.detonate;
      const flick = Math.floor(this.t * 40) % 2 === 0;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(1 + 0.3 * k, 1 + 0.3 * k);
      ctx.translate(-this.x, -this.y);
      drawCrabShip(ctx, { ...this.ship, invuln: 0 }, flick ? { carapaceColor: '#ffffff', innerArmorColor: PINK } : tuning, false);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.fillStyle = PINK;
      ctx.beginPath();
      ctx.arc(this.x, this.y, (this.ship.radius || 15) * (1.2 + k), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (!this.fragments.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const f of this.fragments) {
      if (f.life <= 0) continue;
      const a = f.life / f.maxLife;
      const dx = Math.cos(f.rot) * f.len * 0.5, dy = Math.sin(f.rot) * f.len * 0.5;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = a * (pass === 0 ? 0.45 : 1);
        ctx.strokeStyle = pass === 0 ? f.color : '#ffffff';
        ctx.lineWidth = pass === 0 ? 5 : 1.6;
        ctx.beginPath();
        ctx.moveTo(f.x - dx, f.y - dy);
        ctx.lineTo(f.x + dx, f.y + dy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Screen space: dim + scanlines, then the headline, quip and killer tag.
  drawOverlay(ctx, w, h, source = null, scale = 1) {
    if (this.revealed) return;
    const t = this.t;
    // A white-hot flash on detonation.
    if (this.detonated && t < DEATH_TIMING.detonate + 0.25) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - (t - DEATH_TIMING.detonate) / 0.25);
      ctx.fillStyle = '#fff4fb';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (t < DEATH_TIMING.headline) return;

    const since = t - DEATH_TIMING.headline;
    ctx.save();
    // Dusk wash: a purple dim that fades in behind the text, plus CRT scanlines.
    ctx.globalAlpha = Math.min(0.5, since * 1.6);
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#12002a');
    wash.addColorStop(0.6, '#2a0038');
    wash.addColorStop(1, '#3a0020');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();

    // Glitch tear on impact: a few horizontal slices of the frame shoved sideways.
    if (source && since < 0.22) {
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const sy = Math.random() * h, sh = 6 + Math.random() * 26, shove = (Math.random() - 0.5) * 60;
        ctx.drawImage(source, 0, sy * scale, w * scale, sh * scale, shove, sy, w, sh);
      }
      ctx.restore();
    }

    // With a replay tape the headline moves up to make room for the monitor below it.
    const replay = this.replay;
    const cx = w / 2;
    // Fit both lines across ~88% of the width (the kicker sits left of centre).
    let size = Math.min(h * (replay ? 0.14 : 0.2), 150);
    ctx.save();
    ctx.font = HEADLINE_FONT(100);
    const headW = ctx.measureText(this.headline).width / 100;
    const kickW = ctx.measureText(this.kicker).width / 100 * 0.34;
    ctx.restore();
    const halfSpan = Math.max(headW / 2, kickW / 2 + 0.6) || 3;
    size = Math.max(28, Math.min(size, (w * 0.44) / halfSpan));
    const cy = replay ? size * 1.3 + Math.max(12, h * 0.04) : h * 0.42;
    // Slam: drops in from 2.6x with a small overshoot, then sways like a neon sign on a loose hook.
    const s = since < 0.16 ? 2.6 - 1.75 * (since / 0.16) : 1 + 0.07 * Math.exp(-(since - 0.16) * 9) * Math.cos((since - 0.16) * 30);
    const sway = Math.sin(t * 2.1) * 0.035;
    const hueShift = (Math.sin(t * 3.2) + 1) / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.06 + sway);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Kicker ("YOU GOT") in a hot-pink brush line above the headline.
    ctx.font = HEADLINE_FONT(Math.round(size * 0.34));
    ctx.fillStyle = hueShift > 0.5 ? PINK : CYAN;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;
    ctx.fillText(this.kicker, -size * 0.6, -size * 0.92);

    // Headline: chromatic ghosts, then synthwave chrome (sky over a hard horizon into sunset).
    ctx.font = HEADLINE_FONT(Math.round(size));
    const split = 3 + 9 * Math.exp(-since * 5);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = CYAN;
    ctx.fillText(this.headline, -split, 0);
    ctx.fillStyle = PINK;
    ctx.fillText(this.headline, split, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const chrome = ctx.createLinearGradient(0, -size * 0.8, 0, size * 0.1);
    chrome.addColorStop(0, '#f4fbff');
    chrome.addColorStop(0.46, '#6fd3ff');
    chrome.addColorStop(0.5, '#1a0533');
    chrome.addColorStop(0.53, '#ff3ea5');
    chrome.addColorStop(0.8, '#ffb36b');
    chrome.addColorStop(1, '#fff1c2');
    ctx.shadowColor = PINK;
    ctx.shadowBlur = 26;
    ctx.fillStyle = chrome;
    ctx.fillText(this.headline, 0, 0);
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, size * 0.025);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(this.headline, 0, 0);
    ctx.restore();

    // Quip, typed out like a terminal, and who did it.
    const typed = Math.max(0, Math.floor((t - DEATH_TIMING.quip) * 32));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const quipSize = Math.max(11, Math.min(22, w / 40, (w * 0.92) / ((this.quip.length + 3) * 0.6)));
    if (typed > 0) {
      ctx.font = MONO_FONT(quipSize);
      ctx.fillStyle = '#ffe3f4';
      ctx.shadowColor = PINK;
      ctx.shadowBlur = 10;
      const shown = this.quip.slice(0, typed);
      const caret = typed < this.quip.length || Math.floor(t * 3) % 2 === 0 ? '_' : ' ';
      ctx.fillText(`> ${shown}${caret}`, cx, cy + size * 0.55);
    }
    if (this.killer && t >= DEATH_TIMING.quip + 0.4) {
      ctx.font = MONO_FONT(Math.round(quipSize * 0.8));
      ctx.fillStyle = CYAN;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 8;
      ctx.fillText(`KILLED BY: ${this.killer}`, cx, cy + size * 0.55 + quipSize * 1.8);
    }
    ctx.restore();

    // The instant-replay monitor, between the text and the CONTINUE button.
    if (replay && t >= DEATH_TIMING.replay) {
      const frame = replay.clip.frames[0].canvas;
      const aspect = frame.width / frame.height || 16 / 9;
      const top = cy + size * 0.55 + quipSize * 3.2;
      const bottom = h - Math.max(h * 0.09, 28) - 80;
      let mh = Math.min(bottom - top, h * 0.42);
      let mw = mh * aspect;
      if (mw > w * 0.88) { mw = w * 0.88; mh = mw / aspect; }
      if (mh >= 70) {
        const open = Math.min(1, (t - DEATH_TIMING.replay) / 0.25);
        replay.draw(ctx, cx - mw / 2, top + Math.max(0, (bottom - top - mh) / 2), mw, mh, open);
      }
    }
  }
}
