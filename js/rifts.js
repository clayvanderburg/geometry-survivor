// Space-Time Rifts: now and then a rift tears open in space near the ship. Fly into it and it swallows
// the ship and flings it out at a random spot on the far side of the map, then seals behind you.
//
//   Life of a rift:  TEAR  a jagged crack splits space, then gapes open into a lens of void (RIFT.tearTime)
//                    OPEN  a swirling aperture that drags the grid and sparks into it (TUNING.riftOpenTime)
//                    SEAL  the lens pinches shut and the crack zips closed (RIFT.sealTime)
//   The jump:        IN    the ship is sucked to the centre, spinning and shrinking (RIFT.transitIn)
//                          ...the camera cuts to the far side, where an exit rift bursts open...
//                    OUT   the ship is spat out of the exit rift, growing back (RIFT.transitOut)
//
// One rift at a time (the exit rift is just the far end of a jump and can't be entered). The next rift
// is due TUNING.riftIntervalMin..Max s after the last one sealed; the first waits TUNING.riftFirstDelay.
// The ship is invulnerable and out of the pilot's hands for the jump, plus TUNING.riftExitInvuln after.
// Simulated only from Game.update, so pause, hit-stop and slow-mo freeze rifts with the rest of the world.
// No rifts in the Weapon Range.
import { TUNING } from './config.js';

export const RIFT = {
  tearTime: 0.9,
  sealTime: 0.7,
  transitIn: 0.34,
  transitOut: 0.42,
  exitHold: 0.55, // s the exit rift stays open after spitting the ship out
  enterShare: 0.75, // the ship goes through when its centre is inside this share of the open lens
  lensLength: 1.6, // lens half-length, in rift radii (the lens lies along the tear)
  lensWidth: 0.6, // lens half-width when fully open, in rift radii
  crackLength: 2.2, // the crack runs past the lens tips: half-length in rift radii
  minJump: 1500, // px: the exit is at least this far from the entry
  exitMargin: 320, // px: exits keep this far from the arena wall
  exitSpread: 700, // px: random spread round the mirror point on the far side
  hue: 292, // void magenta
  rimHue: 186, // chromatic cyan edge
  retry: 2 // s before trying again when no clear spot was found
};

const JAGS = 11; // crack vertices

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;

// 0..1 openings of a rift: `crack` is how far the tear runs, `aperture` how wide the lens gapes.
export function riftOpening(r) {
  if (r.phase === 'tear') {
    const k = r.t / RIFT.tearTime;
    return { crack: easeOut(clamp01(k / 0.5)), aperture: easeOut(clamp01((k - 0.4) / 0.6)) };
  }
  if (r.phase === 'seal') {
    const k = r.t / RIFT.sealTime;
    return { crack: 1 - easeIn(clamp01((k - 0.45) / 0.55)), aperture: 1 - easeOut(clamp01(k / 0.6)) };
  }
  return { crack: 1, aperture: 1 };
}

// True when (x, y) is inside the enterable part of an open rift's lens.
export function insideRift(r, x, y) {
  if (r.exit || r.dead) return false;
  const { aperture } = riftOpening(r);
  if (r.phase === 'seal' || aperture < 0.6) return false;
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const dx = x - r.x;
  const dy = y - r.y;
  const u = (dx * c + dy * s) / (r.radius * RIFT.lensLength);
  const v = (-dx * s + dy * c) / (r.radius * RIFT.lensWidth * aperture + 8); // a little slack across the narrow axis
  return u * u + v * v < RIFT.enterShare * RIFT.enterShare;
}

function rockClear(am, x, y, r) {
  if (!am?.getNearbyAsteroids) return true;
  const rocks = am.getNearbyAsteroids(x, y, am.cellsFor ? am.cellsFor(r) : 2);
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock.hp <= 0) continue;
    if ((rock.x - x) ** 2 + (rock.y - y) ** 2 < (rock.radius + r) ** 2) return false;
  }
  return true;
}

function enemiesClear(enemies, x, y, r) {
  if (!enemies) return true;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 < (e.radius + r) ** 2) return false;
  }
  return true;
}

// Where a rift opens: RIFT spawn ring round the ship, inside the arena and clear of rock. null if none.
export function pickRiftSpot(game, radius = TUNING.riftRadius ?? 46) {
  const p = game.player;
  const minD = TUNING.riftSpawnMin ?? 360;
  const maxD = Math.max(minD, TUNING.riftSpawnMax ?? 640);
  const pad = radius * RIFT.crackLength + 60;
  const clear = radius * RIFT.lensLength + 24;
  for (let tries = 0; tries < 30; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = minD + Math.random() * (maxD - minD);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (x < pad || y < pad || x > game.worldWidth - pad || y > game.worldHeight - pad) continue;
    if (!rockClear(game.asteroidManager, x, y, clear)) continue;
    return { x, y };
  }
  return null;
}

// Where a jump comes out: a random spot round the entry's mirror point on the far side of the map, at
// least RIFT.minJump away, clear of rock and hulls. `blast` is true when no clear spot turned up and the
// exit has to blow the breakable rock round it away (like a boss portal); bedrock is never chosen.
export function pickRiftExit(game, fromX, fromY) {
  const W = game.worldWidth;
  const H = game.worldHeight;
  const m = RIFT.exitMargin;
  const shipR = game.player?.radius ?? 15;
  const clear = shipR + 60;
  const enemies = game.enemyManager?.enemies;
  const minJump = Math.min(RIFT.minJump, Math.hypot(W, H) * 0.35);
  const inArena = (x, y) => x >= m && y >= m && x <= W - m && y <= H - m;
  const mirrorX = W - fromX;
  const mirrorY = H - fromY;
  for (let tries = 0; tries < 60; tries++) {
    let x, y;
    if (tries < 40) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * RIFT.exitSpread;
      x = mirrorX + Math.cos(a) * d;
      y = mirrorY + Math.sin(a) * d;
    } else {
      x = m + Math.random() * (W - m * 2);
      y = m + Math.random() * (H - m * 2);
    }
    if (!inArena(x, y)) continue;
    if (Math.hypot(x - fromX, y - fromY) < minJump) continue;
    if (!rockClear(game.asteroidManager, x, y, clear) || !enemiesClear(enemies, x, y, clear + 80)) continue;
    return { x, y, blast: false };
  }
  // Nothing clear: the mirror point itself, kept off bedrock, blasting the breakable rock round it.
  const x = Math.max(m, Math.min(W - m, mirrorX));
  const y = Math.max(m, Math.min(H - m, mirrorY));
  return { x, y, blast: true };
}

export class RiftManager {
  constructor() {
    this.rifts = [];
    this.clear();
  }

  // Run reset: no rifts, no jump in progress, the first rift RIFT first-delay away.
  clear() {
    this.rifts.length = 0;
    this.transit = null;
    this.timer = TUNING.riftFirstDelay ?? 45;
    this.time = 0;
    this.jumps = 0;
  }

  // The live entry rift, if any.
  get active() {
    for (let i = 0; i < this.rifts.length; i++) if (!this.rifts[i].exit) return this.rifts[i];
    return null;
  }

  // True while a jump has the ship (no steering, no gun fire, no gravity tug).
  holdsShip() {
    return !!this.transit;
  }

  // Draw transform for the ship mid-jump: { scale, spin } (scale 1, spin 0 when not jumping).
  shipPose() {
    const tr = this.transit;
    if (!tr) return { scale: 1, spin: 0 };
    if (tr.phase === 'in') {
      const k = clamp01(tr.t / RIFT.transitIn);
      return { scale: 1 - easeIn(k), spin: easeIn(k) * Math.PI * 3 };
    }
    const k = clamp01(tr.t / RIFT.transitOut);
    // Overshoot a little as it pops back to full size.
    const s = k < 0.75 ? easeOut(k / 0.75) * 1.12 : 1.12 - 0.12 * ((k - 0.75) / 0.25);
    return { scale: s, spin: (1 - easeOut(k)) * -Math.PI * 2 };
  }

  makeRift(x, y, exit = false) {
    const radius = TUNING.riftRadius ?? 46;
    const jag = [];
    for (let i = 0; i < JAGS; i++) jag.push(i === 0 || i === JAGS - 1 ? 0 : (Math.random() - 0.5) * 2);
    const rift = {
      x, y, radius, exit,
      angle: Math.random() * Math.PI,
      phase: exit ? 'open' : 'tear',
      t: 0,
      life: exit ? RIFT.exitHold : Math.max(0.5, TUNING.riftOpenTime ?? 9),
      jag,
      seed: Math.random() * 1000,
      dead: false
    };
    this.rifts.push(rift);
    return rift;
  }

  // Dev tuner: open a rift right now (unless one is open or the ship is mid-jump).
  openNow(game) {
    if (this.active || this.transit) return null;
    const r = this.open(game);
    if (r) this.timer = Infinity;
    return r;
  }

  // Opens a rift near the ship. Returns it, or null when there was no clear spot.
  open(game) {
    const spot = pickRiftSpot(game);
    if (!spot) return null;
    const r = this.makeRift(spot.x, spot.y);
    game.particles?.spawnFlash?.(r.x, r.y, r.radius * 2.4, RIFT.hue, 0.3);
    game.particles?.spawnShockwave?.(r.x, r.y, r.radius * 3.4, RIFT.hue, 3, 0.5);
    game.grid?.applyImpulse?.(r.x, r.y, 30, r.radius * 4, RIFT.hue);
    game.particles?.spawnFloatText?.(r.x, r.y - r.radius - 26, '⟁ SPACE-TIME RIFT', '#e9a6ff', 15);
    game.sound?.playRiftOpen?.();
    return r;
  }

  update(dt, game) {
    this.time += dt;
    const enabled = (TUNING.riftsEnabled ?? 1) >= 0.5 && !game.range?.active;

    if (this.transit) this.updateTransit(dt, game);

    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i];
      r.t += dt;
      if (r.phase === 'tear' && r.t >= RIFT.tearTime) {
        r.phase = 'open';
        r.t = 0;
      } else if (r.phase === 'open') {
        r.life -= dt;
        if (r.life <= 0 || !enabled) this.seal(r, game);
      } else if (r.phase === 'seal' && r.t >= RIFT.sealTime) {
        r.dead = true;
        this.rifts.splice(i, 1);
        if (!r.exit) this.timer = this.nextInterval();
        continue;
      }
      this.riftFx(r, game);
    }

    // The ship flies (or dashes, or drifts) into an open rift: the jump begins.
    const p = game.player;
    const entry = this.active;
    if (!this.transit && entry && p && p.hp > 0 && insideRift(entry, p.x, p.y)) this.beginJump(entry, game);

    if (!enabled || this.transit || entry) return;
    this.timer -= dt;
    if (this.timer <= 0) this.timer = this.open(game) ? Infinity : RIFT.retry; // reset when it seals
  }

  nextInterval() {
    const lo = Math.max(1, TUNING.riftIntervalMin ?? 50);
    const hi = Math.max(lo, TUNING.riftIntervalMax ?? 80);
    return lo + Math.random() * (hi - lo);
  }

  seal(r, game) {
    if (r.phase === 'seal') return;
    // A rift caught mid-tear seals from however open it got.
    r.phase = 'seal';
    r.t = 0;
    if (!r.exit) game.sound?.playRiftClose?.();
  }

  // Ambient pull of an open rift: the grid sinks toward it and sparks spiral in.
  riftFx(r, game) {
    const { aperture } = riftOpening(r);
    if (aperture <= 0.05) return;
    game.grid?.applyImplosion?.(r.x, r.y, (r.exit ? 2.2 : 1.1) * aperture, r.radius * 4.2, RIFT.hue, 0.55);
    const vfx = typeof game.particles?.intensity === 'number' ? game.particles.intensity : 1;
    if (!r.exit && r.phase === 'open' && Math.random() < 0.55 * vfx) game.particles?.spawnInfall?.(r, r.radius * 3.4, Math.random() < 0.3 ? RIFT.rimHue : RIFT.hue, 1);
    if (Math.random() < 0.05 * vfx) {
      // A filament of lightning crackles off one tip of the tear.
      const tip = (Math.random() < 0.5 ? 1 : -1) * r.radius * RIFT.crackLength;
      const tx = r.x + Math.cos(r.angle) * tip;
      const ty = r.y + Math.sin(r.angle) * tip;
      const a = r.angle + (Math.random() - 0.5) * 2.4 + (tip < 0 ? Math.PI : 0);
      const len = r.radius * (0.8 + Math.random());
      game.particles?.spawnLightning?.(tx, ty, tx + Math.cos(a) * len, ty + Math.sin(a) * len, RIFT.hue, 0.6, 0.18, 0);
    }
  }

  beginJump(rift, game) {
    const p = game.player;
    const exit = pickRiftExit(game, rift.x, rift.y);
    this.transit = { phase: 'in', t: 0, rift, fromX: p.x, fromY: p.y, toX: exit.x, toY: exit.y, blast: exit.blast };
    p.dashTimer = 0;
    p.vx = 0;
    p.vy = 0;
    p.invuln = Math.max(p.invuln || 0, RIFT.transitIn + RIFT.transitOut + (TUNING.riftExitInvuln ?? 1));
    rift.life = Math.max(rift.life, RIFT.transitIn + 0.05); // stays open until the ship is through
    game.sound?.playRiftWarp?.();
    game.particles?.spawnShockwave?.(rift.x, rift.y, rift.radius * 2.6, RIFT.rimHue, 3, 0.35, true);
    game.addShake?.(10);
  }

  updateTransit(dt, game) {
    const tr = this.transit;
    const p = game.player;
    tr.t += dt;
    p.vx = 0;
    p.vy = 0;
    if (tr.phase === 'in') {
      // Sucked to the centre of the rift.
      const k = easeIn(clamp01(tr.t / RIFT.transitIn));
      p.x = tr.fromX + (tr.rift.x - tr.fromX) * k;
      p.y = tr.fromY + (tr.rift.y - tr.fromY) * k;
      game.grid?.applyImplosion?.(tr.rift.x, tr.rift.y, 4 * k, tr.rift.radius * 4.5, RIFT.hue, 0.9);
      if (tr.t >= RIFT.transitIn) this.arrive(game);
      return;
    }
    // Spat out of the exit rift: drift a touch along it as the hull grows back.
    if (tr.t >= RIFT.transitOut) {
      const a = tr.exitRift?.angle ?? 0;
      p.vx = Math.cos(a + Math.PI / 2) * 2;
      p.vy = Math.sin(a + Math.PI / 2) * 2;
      this.transit = null;
    }
  }

  // The cut: the entry seals, the ship and camera appear on the far side, the exit rift bursts open.
  arrive(game) {
    const tr = this.transit;
    const p = game.player;
    this.seal(tr.rift, game);
    if (tr.blast) game.asteroidManager?.blastRocks?.(tr.toX, tr.toY, p.radius + 70, (rock) => game.onRockShattered?.(rock));
    p.x = tr.toX;
    p.y = tr.toY;
    if (game.width && game.height) {
      game.camX = Math.max(0, Math.min(game.worldWidth - game.width, p.x - game.width * 0.5));
      game.camY = Math.max(0, Math.min(game.worldHeight - game.height, p.y - game.height * 0.5));
    }
    tr.exitRift = this.makeRift(p.x, p.y, true);
    tr.phase = 'out';
    tr.t = 0;
    this.jumps++;
    game.chromaFlash = Math.max(game.chromaFlash || 0, 0.4);
    game.addShake?.(16);
    game.grid?.applyImpulse?.(p.x, p.y, 70, 300, RIFT.hue);
    game.particles?.spawnFlash?.(p.x, p.y, 120, RIFT.hue, 0.32);
    game.particles?.spawnShockwave?.(p.x, p.y, 260, RIFT.hue, 5, 0.55);
    game.particles?.spawnShockwave?.(p.x, p.y, 170, RIFT.rimHue, 3, 0.4);
    game.particles?.spawnExplosionSparks?.(p.x, p.y, 34, RIFT.hue, 4, 15, 2.6);
    game.sound?.playRiftExit?.();
  }

  // --- Drawing (world space; the camera transform is already on the context) -------------------------

  // Lens outline along the local x axis: tips at ±L, widest (±W) at the middle (control points at ±2W).
  lensPath(ctx, L, W) {
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.quadraticCurveTo(0, -W * 2, L, 0);
    ctx.quadraticCurveTo(0, W * 2, -L, 0);
    ctx.closePath();
  }

  onScreen(r, game) {
    const reach = r.radius * RIFT.crackLength + 40;
    return r.x + reach >= game.camX && r.x - reach <= game.camX + game.width && r.y + reach >= game.camY && r.y - reach <= game.camY + game.height;
  }

  // Opaque pass (under the additive layer): the void inside the lens, with the far side's stars
  // streaming out of it.
  drawVoid(ctx, game) {
    for (let i = 0; i < this.rifts.length; i++) {
      const r = this.rifts[i];
      const { aperture } = riftOpening(r);
      if (aperture <= 0.02 || !this.onScreen(r, game)) continue;
      const L = r.radius * RIFT.lensLength;
      const W = r.radius * RIFT.lensWidth * aperture;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      this.lensPath(ctx, L, W);
      ctx.fillStyle = 'rgba(2, 0, 9, 0.96)';
      ctx.fill();
      ctx.clip();
      for (let s = 0; s < 18; s++) {
        const k = (s * 0.618 + this.time * 0.45 + r.seed) % 1;
        const a = s * 2.4 + this.time * 0.9;
        const d = k * L;
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d * 0.5;
        const sz = 0.8 + k * 2.2;
        ctx.fillStyle = s % 3 === 0 ? `hsla(${RIFT.rimHue}, 100%, 80%, ${0.25 + k * 0.7})` : `rgba(255, 236, 255, ${0.2 + k * 0.7})`;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
      ctx.restore();
    }
  }

  // Additive pass: halo, swirl, chromatic rim and the jagged white-hot crack.
  draw(ctx, game) {
    for (let i = 0; i < this.rifts.length; i++) {
      const r = this.rifts[i];
      if (!this.onScreen(r, game)) continue;
      const { crack, aperture } = riftOpening(r);
      if (crack <= 0.01) continue;
      const L = r.radius * RIFT.lensLength;
      const W = r.radius * RIFT.lensWidth * aperture;
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 31 + r.seed);
      const boost = r.exit ? 1.35 : 1;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);

      // Halo
      if (aperture > 0.02 && typeof ctx.createRadialGradient === 'function') {
        const haloR = r.radius * 2.8;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
        g.addColorStop(0, `hsla(${RIFT.hue}, 100%, 60%, ${0.28 * aperture * boost})`);
        g.addColorStop(1, `hsla(${RIFT.hue}, 100%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(-haloR, -haloR, haloR * 2, haloR * 2);
      }

      // Swirl: spiral arcs turning inside the lens
      if (aperture > 0.1) {
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 3; k++) {
          const s = 0.35 + k * 0.2;
          const a0 = this.time * (2.4 - k * 0.5) + k * 2.1;
          ctx.strokeStyle = `hsla(${k === 1 ? RIFT.rimHue : RIFT.hue}, 100%, 70%, ${0.45 * aperture})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, L * s, Math.max(0.5, W * s * 1.1), 0, a0, a0 + 2.2);
          ctx.stroke();
        }
      }

      // Rim: magenta glow with a cyan edge split off it (chromatic aberration), white core line
      if (aperture > 0.02) {
        this.lensPath(ctx, L, W);
        ctx.strokeStyle = `hsla(${RIFT.hue}, 100%, 62%, ${0.55 * flicker * boost})`;
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.save();
        ctx.translate(1.8, -1.2);
        this.lensPath(ctx, L, W);
        ctx.strokeStyle = `hsla(${RIFT.rimHue}, 100%, 66%, ${0.6 * flicker})`;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
        this.lensPath(ctx, L, W);
        ctx.strokeStyle = `rgba(255, 240, 255, ${0.85 * flicker})`;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      // Crack: a jagged tear running past both tips of the lens, brightest while it is splitting open
      const C = r.radius * RIFT.crackLength * crack;
      const amp = r.radius * 0.2;
      const heat = 1 - aperture * 0.45;
      ctx.beginPath();
      for (let j = 0; j < JAGS; j++) {
        const u = -C + (2 * C * j) / (JAGS - 1);
        const v = r.jag[j] * amp * (0.7 + 0.3 * Math.sin(this.time * 17 + j * 1.7));
        if (j === 0) ctx.moveTo(u, v);
        else ctx.lineTo(u, v);
      }
      ctx.strokeStyle = `hsla(${RIFT.hue}, 100%, 66%, ${0.5 * heat * boost})`;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 250, 255, ${0.9 * heat * flicker})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Radar blip: a pulsing violet ring on the open rift.
  drawRadar(ctx, mx, my, scaleX, scaleY, k) {
    const r = this.active;
    if (!r) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    ctx.strokeStyle = '#e07bff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(mx + r.x * scaleX, my + r.y * scaleY, (3 + pulse * 2.5) * k, 0, Math.PI * 2);
    ctx.stroke();
  }
}
