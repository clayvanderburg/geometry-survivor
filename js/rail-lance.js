// Rail Lance: a PRIMARY aimed slot weapon. While firing (like the Autocannon: auto-fire, the mouse, the
// right stick or touch aim) it CHARGES for W.railCharge s, a thin targeting line and a gathering muzzle
// glow showing where it will fire, then DISCHARGES: a hair-thin line along the aim that pierces every
// enemy (and every rock: weapons never hurt rocks, and nothing stops the lance) out to the edge of the
// screen. The first enemy on the line takes the full hit, each one behind it W.railKeep of the one before.
// Then it vents for the rest of its cycle (W.railCycle), so Capacitor Bank cards shorten both. Split Rails
// cards add lances fanned W.railSpread apart round the aim.
//
// Breakthroughs: Magnetic Rail (LV 6: while charging, enemies near the firing line are dragged onto it),
// Ion Wake (LV 12: every lance leaves an ionized line that ticks whatever stands on it; sub-source
// 'ionwake') and Overload Shot (LV 18: every W.overloadEvery-th shot is a beam W.overloadWidth x as wide
// that hits W.overloadMult x as hard; sub-source 'overload').
//
// Simulated only from Game.update (pause, hit-stop and slow-mo freeze it); every number comes from
// weapon-scaling.js so card previews stay exact. Damage goes through Game.hitEnemy (source 'rail').
// Beams and wakes live in fixed pools and draw as a few batched strokes.
import { WEAPON_SCALING as W, weaponDamage } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';

export const RAIL_HUE = 250;      // electric indigo, white-hot core
export const MAX_LANCES = 4;      // 1 + Split Rails (cap 3)
const MAX_BEAMS = MAX_LANCES * 3; // fading discharge lines
const MAX_WAKES = MAX_LANCES * 8; // >= lances per shot x shots inside W.wakeLife at the fastest cycle
const BEAM_LIFE = 0.24;           // s a discharge line takes to fade
const MIN_REACH = 520;            // px, if the ship is somehow at the screen edge
const EDGE_MARGIN = 40;           // px the lance runs past the screen edge
const MUZZLE = 1.5;               // x hull radius: where the lance leaves the turret
const TIE_GAP = 46;               // px between the coil rings drawn along a discharge
const HUD_STEPS = 10;
const IMPACT_FX = 6;              // enemies per lance that get the full impact burst (all are still hit)
// Discharge width over its life: a fat flash that snaps thin (ease-out), so the shot lands as a punch.
const beamSwell = (k) => 1 + 1.4 * (1 - k) ** 3;             // HUD charge gauge resolution (keeps the chip HTML from changing every tick)

// Enemies the lance can hit and pull: anything alive and not invulnerable.
const railTarget = (e) => !e.dead && !e.invulnerable;

// Share of the Magnetic Rail drag a hull takes: bosses hold their ground, lieutenants and heavy hulls move less.
export function magnetScale(e) {
  if (e.isBoss) return 0;
  const mass = Math.min(1, (14 / Math.max(6, e.radius || 10)) ** 2);
  return e.isLieutenant ? mass * 0.5 : mass;
}

// Distance from (x, y) along the unit direction (dx, dy) to the edge of the box [l, r] x [t, b]
// (0 when the point is outside it).
export function reachToEdge(x, y, dx, dy, l, t, r, b) {
  if (x < l || x > r || y < t || y > b) return 0;
  const tx = dx > 1e-9 ? (r - x) / dx : dx < -1e-9 ? (l - x) / dx : Infinity;
  const ty = dy > 1e-9 ? (b - y) / dy : dy < -1e-9 ? (t - y) / dy : Infinity;
  return Math.min(tx, ty);
}

// Cheap hash so the ion wake's crackle jumps around without Math.random in draw.
const hash = (k, frame) => {
  const v = Math.sin(k * 12.9898 + frame * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export class RailLance {
  constructor() {
    const line = () => ({ x1: 0, y1: 0, x2: 0, y2: 0, dx: 1, dy: 0, len: 0, width: 1, age: 0, overload: false, tickT: 0, dmg: 0 });
    this.beams = Array.from({ length: MAX_BEAMS }, line);
    this.wakes = Array.from({ length: MAX_WAKES }, line);
    this.hits = [];   // [enemy, distance along the line] pairs, flattened, reused every shot
    this.order = [];
    this.pierced = []; // [enemy, damage] pairs a lance just hit (Static Charge)
    this.clear();
  }

  // Run reset: uncharged, nothing in the air.
  clear() {
    this.active = false;
    this.t = 0;          // time into the current cycle: charging until W.railCharge, then venting
    this.fired = false;  // this cycle's shot is out (venting)
    this.charging = false;
    this.chargeShare = 0;
    this.shots = 0;
    this.lances = 0;
    this.time = 0;
    this.beamCount = 0;
    this.wakeCount = 0;
    this.flash = 0;
    this.hits.length = 0;
  }

  // 0 (just fired) .. 1 (charged), for the HUD chip in HUD_STEPS steps; null while not equipped.
  hudCharge() {
    return this.active ? Math.floor(this.chargeShare * HUD_STEPS) / HUD_STEPS : null;
  }

  // The next shot is an Overload Shot (LV 18 Breakthrough).
  overloadNext(b) {
    return !!b.t12 && (this.shots + 1) % W.overloadEvery === 0;
  }

  // `wantFire`: the player is firing this tick (Game.update's shouldFire).
  update(dt, game, wantFire) {
    const p = game.player;
    this.time += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    this.ageBeams(dt);
    this.updateWakes(dt, game);
    if (!((p?.weapons?.raillance || 0) > 0)) {
      if (this.active) this.clear();
      return;
    }
    this.active = true;
    const b = weaponBuild(p, 'raillance');
    const charge = W.railCharge(b);
    const cycle = W.railCycle(b);
    // Venting runs on its own; charging only while the trigger is held (a held charge waits, full).
    if (this.fired || wantFire) this.t += dt;
    if (!this.fired) {
      if (wantFire && !this.charging) {
        this.charging = true;
        game.sound.playRailCharge?.(Math.max(0.05, charge - this.t), this.overloadNext(b));
      }
      if (this.t >= charge) {
        this.t = Math.min(this.t, charge);
        if (wantFire) {
          this.fire(game, p, b);
          this.fired = true;
          this.charging = false;
        }
      } else if (wantFire && b.t4) {
        this.magnet(game, p, b, dt);
      }
    }
    if (this.fired && this.t >= cycle) {
      this.t -= cycle;
      this.fired = false;
    }
    this.chargeShare = this.fired ? 0 : Math.min(1, this.t / charge);
  }

  // Aim of lance `i` of `n` (fanned round the turret's aim).
  lanceAngle(p, i, n) {
    return p.angle + (i - (n - 1) / 2) * W.railSpread;
  }

  // Muzzle and reach of a lance at `angle`: from the turret out past the screen edge.
  lanceLine(game, p, angle, out) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const m = (p.radius || 15) * MUZZLE;
    out.dx = dx;
    out.dy = dy;
    out.x1 = p.x + dx * m;
    out.y1 = p.y + dy * m;
    const l = game.camX || 0;
    const t = game.camY || 0;
    const edge = reachToEdge(out.x1, out.y1, dx, dy, l, t, l + (game.width || 1280), t + (game.height || 720));
    out.len = Math.max(MIN_REACH, edge + EDGE_MARGIN);
    out.x2 = out.x1 + dx * out.len;
    out.y2 = out.y1 + dy * out.len;
    return out;
  }

  // Every enemy whose hull touches the line (half-width `w`), nearest first, into this.order.
  collect(game, ln, w) {
    const hits = this.hits;
    hits.length = 0;
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!railTarget(e)) continue;
      const rx = e.x - ln.x1;
      const ry = e.y - ln.y1;
      const along = rx * ln.dx + ry * ln.dy;
      const r = e.radius || 10;
      if (along < -r || along > ln.len + r) continue;
      const across = Math.abs(rx * ln.dy - ry * ln.dx);
      if (across <= w + r) hits.push(e, along);
    }
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < hits.length; i += 2) order.push(i);
    order.sort((a, c) => hits[a + 1] - hits[c + 1]);
    return order;
  }

  fire(game, p, b) {
    const overload = this.overloadNext(b);
    this.shots++;
    const n = Math.min(MAX_LANCES, W.railLances(b));
    const dmg = weaponDamage(p, 'rail', b) * (overload ? W.overloadMult : 1);
    const width = W.railWidth(b) * (overload ? W.overloadWidth : 1);
    const keep = W.railKeep(b);
    const stat = overload ? 'overload' : 'rail';
    const fx = game.particles;
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const ln = this.lanceLine(game, p, this.lanceAngle(p, i, n), this.nextBeam());
      ln.width = width;
      ln.overload = overload;
      ln.age = 0;
      const order = this.collect(game, ln, width);
      const hits = this.hits;
      const pierced = this.pierced;
      pierced.length = 0;
      let d = dmg;
      for (let k = 0; k < order.length; k++) {
        const e = hits[order[k]];
        if (e.dead) continue; // killed by an earlier lance this shot (the snapshot outlives the splice)
        game.hitEnemy(e, d, 'rail', ln.dx * W.railKnock, ln.dy * W.railKnock, 1, stat);
        if (pierced.length < W.staticMax * 2) pierced.push(e, d);
        if (k < IMPACT_FX) {
          // Impact: sparks blown out the far side along the lance, a hot ring and a white pop on the hull.
          fx.spawnDirectionalSparks?.(e.x, e.y, Math.atan2(ln.dy, ln.dx), 0.5, overload ? 9 : 5, RAIL_HUE + 20, overload ? 16 : 12);
          fx.spawnShockwave?.(e.x, e.y, (e.radius || 10) * (overload ? 3.2 : 2.2), RAIL_HUE, overload ? 3 : 2, 0.16);
          fx.spawnImpact?.(e.x, e.y, Math.atan2(ln.dy, ln.dx), overload ? 12 : 8, 0.09);
        }
        d *= keep;
        landed++;
      }
      hits.length = 0;
      if (b.t8) this.addWake(ln, dmg * W.wakeShare / (W.wakeLife / W.wakeTick)); // an Overload's wake is as big as its beam
      if (b.tf?.has('static')) this.staticArcs(game, ln, width);
      if (b.tf?.has('reflect')) landed += this.reflect(game, ln, dmg * W.reflectShare, width, keep, stat);
      // Muzzle flash, a recoil ring and sparks kicked back off the turret, and a pulse down the grid along the line.
      fx.spawnFlash?.(ln.x1, ln.y1, overload ? 42 : 24, RAIL_HUE, overload ? 0.16 : 0.11);
      fx.spawnShockwave?.(ln.x1, ln.y1, overload ? 46 : 26, RAIL_HUE + 20, overload ? 4 : 2.5, 0.2);
      fx.spawnDirectionalSparks?.(ln.x1, ln.y1, Math.atan2(-ln.dy, -ln.dx), 0.9, overload ? 8 : 4, RAIL_HUE, 7);
      for (let s = 1; s <= 3; s++) game.grid?.applyImpulse?.(ln.x1 + ln.dx * ln.len * s * 0.25, ln.y1 + ln.dy * ln.len * s * 0.25, overload ? 26 : 12, 70, RAIL_HUE);
    }
    this.lances += n;
    this.flash = overload ? 0.2 : 0.12;
    game.addShake?.(overload ? 7 : 2.5);
    // An Overload Shot that connects gets a beat of hit-stop (plain shots don't: one a second would judder the game).
    if (overload && landed > 0) game.requestHitStop?.(2);
    if (overload) game.chromaFlash = Math.max(game.chromaFlash || 0, 0.35);
    game.sound.playRailFire?.(overload, landed);
  }

  // Static Charge: each enemy this lance pierced (this.pierced: enemy, damage) arcs W.staticShare of its hit
  // into the nearest enemy within W.staticRange that is off the line, so the static spreads into the pack.
  staticArcs(game, ln, width) {
    const list = this.pierced;
    const enemies = game.enemyManager.enemies;
    for (let i = 0; i < list.length; i += 2) {
      const src = list[i];
      let best = null;
      let bestSq = W.staticRange * W.staticRange;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (e === src || !railTarget(e)) continue;
        const dSq = (e.x - src.x) ** 2 + (e.y - src.y) ** 2;
        if (dSq >= bestSq) continue;
        const across = Math.abs((e.x - ln.x1) * ln.dy - (e.y - ln.y1) * ln.dx);
        if (across <= width + (e.radius || 10)) continue; // on the line: the lance already hit it
        bestSq = dSq;
        best = e;
      }
      if (!best) continue;
      game.particles.spawnLightning?.(src.x, src.y, best.x, best.y, RAIL_HUE + 30, 1.8, 0.22);
      game.particles.spawnFlash?.(best.x, best.y, 10 + (best.radius || 10), RAIL_HUE + 30, 0.1);
      game.hitEnemy(best, list[i + 1] * W.staticShare, 'rail', 0, 0, 0.5, 'rail');
    }
    if (list.length) game.sound.playArcZap?.(Math.min(6, list.length / 2));
    list.length = 0;
  }

  // Reflector Rail: the lance bounces off the screen edge it ran into and sweeps back across the screen at
  // `dmg`, losing `keep` per enemy as usual. Returns the enemies it hit.
  reflect(game, ln, dmg, width, keep, stat) {
    const l = game.camX || 0, t = game.camY || 0, r = l + (game.width || 1280), btm = t + (game.height || 720);
    const edge = reachToEdge(ln.x1, ln.y1, ln.dx, ln.dy, l, t, r, btm);
    if (!(edge > 0)) return 0;
    const ex = ln.x1 + ln.dx * edge, ey = ln.y1 + ln.dy * edge;
    // The wall it met: whichever bound the ray reached first.
    const tx = ln.dx > 1e-9 ? (r - ln.x1) / ln.dx : ln.dx < -1e-9 ? (l - ln.x1) / ln.dx : Infinity;
    const ty = ln.dy > 1e-9 ? (btm - ln.y1) / ln.dy : ln.dy < -1e-9 ? (t - ln.y1) / ln.dy : Infinity;
    const rb = this.nextBeam();
    rb.dx = tx <= ty ? -ln.dx : ln.dx;
    rb.dy = tx <= ty ? ln.dy : -ln.dy;
    rb.x1 = ex - ln.dx * 2;
    rb.y1 = ey - ln.dy * 2;
    rb.len = Math.max(MIN_REACH, reachToEdge(rb.x1, rb.y1, rb.dx, rb.dy, l, t, r, btm) + EDGE_MARGIN);
    rb.x2 = rb.x1 + rb.dx * rb.len;
    rb.y2 = rb.y1 + rb.dy * rb.len;
    rb.width = width * 0.8;
    rb.overload = ln.overload;
    rb.age = 0;
    const order = this.collect(game, rb, rb.width);
    const hits = this.hits;
    let d = dmg;
    let landed = 0;
    for (let k = 0; k < order.length; k++) {
      const e = hits[order[k]];
      if (e.dead) continue;
      game.hitEnemy(e, d, 'rail', rb.dx * W.railKnock, rb.dy * W.railKnock, 1, stat);
      if (k < IMPACT_FX) game.particles.spawnShockwave?.(e.x, e.y, (e.radius || 10) * 2, RAIL_HUE + 40, 2, 0.16);
      d *= keep;
      landed++;
    }
    hits.length = 0;
    // The bounce: a hot splash on the screen edge and a ring of sparks off the wall.
    const fx = game.particles;
    fx.spawnFlash?.(rb.x1, rb.y1, 30, RAIL_HUE + 40, 0.14);
    fx.spawnShockwave?.(rb.x1, rb.y1, 44, RAIL_HUE + 40, 3, 0.22);
    fx.spawnDirectionalSparks?.(rb.x1, rb.y1, Math.atan2(rb.dy, rb.dx), 1.2, 8, RAIL_HUE + 40, 10);
    game.grid?.applyImpulse?.(rb.x1, rb.y1, 18, 90, RAIL_HUE);
    return landed;
  }

  // A pooled discharge line (the oldest is reused when the pool is full).
  nextBeam() {
    if (this.beamCount < MAX_BEAMS) return this.beams[this.beamCount++];
    let oldest = 0;
    for (let i = 1; i < MAX_BEAMS; i++) if (this.beams[i].age > this.beams[oldest].age) oldest = i;
    return this.beams[oldest];
  }

  ageBeams(dt) {
    for (let i = this.beamCount - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.age += dt;
      if (bm.age >= BEAM_LIFE) {
        this.beams[i] = this.beams[this.beamCount - 1];
        this.beams[--this.beamCount] = bm;
      }
    }
  }

  // Ion Wake: the lance's line stays charged for W.wakeLife s; `dmg` per tick to everything on it.
  addWake(ln, dmg) {
    let w;
    if (this.wakeCount < MAX_WAKES) w = this.wakes[this.wakeCount++];
    else {
      let oldest = 0;
      for (let i = 1; i < MAX_WAKES; i++) if (this.wakes[i].age > this.wakes[oldest].age) oldest = i;
      w = this.wakes[oldest];
    }
    w.x1 = ln.x1; w.y1 = ln.y1; w.x2 = ln.x2; w.y2 = ln.y2;
    w.dx = ln.dx; w.dy = ln.dy; w.len = ln.len;
    w.width = ln.width;
    w.overload = ln.overload;
    w.age = 0;
    w.tickT = W.wakeTick;
    w.dmg = dmg;
  }

  updateWakes(dt, game) {
    for (let i = this.wakeCount - 1; i >= 0; i--) {
      const w = this.wakes[i];
      w.age += dt;
      w.tickT -= dt;
      if (w.tickT <= 1e-9 && w.age <= W.wakeLife + 1e-9) {
        w.tickT += W.wakeTick;
        const order = this.collect(game, w, w.width);
        const hits = this.hits;
        for (let k = 0; k < order.length; k++) {
          const e = hits[order[k]];
          if (!e.dead) game.hitEnemy(e, w.dmg, 'rail', 0, 0, 0.5, 'ionwake');
        }
        hits.length = 0;
      }
      if (w.age >= W.wakeLife) {
        this.wakes[i] = this.wakes[this.wakeCount - 1];
        this.wakes[--this.wakeCount] = w;
      }
    }
  }

  // Magnetic Rail: while charging, drag enemies near the firing line(s) sideways onto it.
  magnet(game, p, b, dt) {
    const n = Math.min(MAX_LANCES, W.railLances(b));
    const enemies = game.enemyManager.enemies;
    const ln = this.scratch || (this.scratch = { x1: 0, y1: 0, x2: 0, y2: 0, dx: 1, dy: 0, len: 0 });
    for (let i = 0; i < n; i++) {
      this.lanceLine(game, p, this.lanceAngle(p, i, n), ln);
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (!railTarget(e)) continue;
        const rx = e.x - ln.x1;
        const ry = e.y - ln.y1;
        const along = rx * ln.dx + ry * ln.dy;
        if (along < 0 || along > ln.len) continue;
        const across = rx * ln.dy - ry * ln.dx; // signed: + is to the right of the line
        const a = Math.abs(across);
        if (a > W.magnetRange || a < 1) continue;
        const step = Math.min(a, W.magnetPull * dt * magnetScale(e));
        const s = across > 0 ? -step : step;
        e.x += ln.dy * s;
        e.y -= ln.dx * s;
      }
    }
  }

  // ---- Rendering (air layer, over enemies). Animation runs on this.time, so it freezes with the sim. ----
  draw(ctx, game) {
    const p = game.player;
    if (!p) return;
    if (this.wakeCount) this.drawWakes(ctx);
    if (this.active && !this.fired && this.chargeShare > 0) this.drawCharge(ctx, game, p);
    if (this.beamCount) this.drawBeams(ctx);
  }

  // Charging: a thin targeting line per lance (brighter as it fills), a white-hot orb gathering at the
  // muzzle and three neon shards spiralling in to it.
  drawCharge(ctx, game, p) {
    const c = this.chargeShare;
    const b = weaponBuild(p, 'raillance');
    const n = Math.min(MAX_LANCES, W.railLances(b));
    const over = this.overloadNext(b);
    const ln = this.scratch || (this.scratch = { x1: 0, y1: 0, x2: 0, y2: 0, dx: 1, dy: 0, len: 0 });
    const ready = c >= 1;
    const pulse = ready ? 0.5 + 0.5 * Math.sin(this.time * 18) : 0;
    ctx.setLineDash([10, 9]);
    ctx.lineDashOffset = -this.time * 60;
    ctx.lineWidth = over ? 2.4 : 1.4;
    ctx.strokeStyle = `hsla(${RAIL_HUE}, 100%, 80%, ${0.15 + 0.5 * c * c + 0.2 * pulse})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      this.lanceLine(game, p, this.lanceAngle(p, i, n), ln);
      ctx.moveTo(ln.x1, ln.y1);
      ctx.lineTo(ln.x2, ln.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // Muzzle orb and shards, on the centre lance.
    this.lanceLine(game, p, p.angle, ln);
    const r = (over ? 5 : 3.5) + (over ? 9 : 6) * c + pulse * 2;
    ctx.fillStyle = `hsla(${RAIL_HUE}, 100%, 70%, ${0.18 + 0.3 * c})`;
    ctx.beginPath();
    ctx.arc(ln.x1, ln.y1, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(245, 242, 255, ${0.45 + 0.5 * c})`;
    ctx.beginPath();
    ctx.arc(ln.x1, ln.y1, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    const spin = this.time * 7;
    const far = 14 + 30 * (1 - c);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `hsla(${RAIL_HUE + 20}, 100%, 80%, ${0.25 + 0.6 * c})`;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI * 2) / 3;
      const sx = ln.x1 + Math.cos(a) * far;
      const sy = ln.y1 + Math.sin(a) * far;
      const s = 3.5;
      ctx.moveTo(sx + Math.cos(a) * s, sy + Math.sin(a) * s);
      ctx.lineTo(sx + Math.cos(a + 2.4) * s, sy + Math.sin(a + 2.4) * s);
      ctx.lineTo(sx + Math.cos(a - 2.4) * s, sy + Math.sin(a - 2.4) * s);
      ctx.closePath();
    }
    ctx.stroke();
  }

  // Discharge: a soft indigo glow, a bright line and a white-hot hair-thin core, with coil rings
  // (short ticks across the beam) racing outward; all fade over BEAM_LIFE.
  drawBeams(ctx) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.beamCount; i++) {
        const bm = this.beams[i];
        const k = Math.min(1, bm.age / BEAM_LIFE);
        const fade = 1 - k;
        const swell = beamSwell(k);
        const wide = bm.overload ? bm.width : 0;
        if (pass === 0) {
          ctx.lineWidth = (6 + wide * 2.2) * (1 + 0.6 * k) * swell;
          ctx.strokeStyle = `hsla(${RAIL_HUE}, 100%, 62%, ${0.28 * fade})`;
        } else if (pass === 1) {
          ctx.lineWidth = (2.4 + wide * 0.9) * fade * swell + 0.4;
          ctx.strokeStyle = `hsla(${RAIL_HUE + 15}, 100%, 76%, ${0.85 * fade})`;
        } else {
          ctx.lineWidth = (bm.overload ? 2.4 : 1.1) * fade * swell + 0.3;
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * fade})`;
        }
        ctx.beginPath();
        ctx.moveTo(bm.x1, bm.y1);
        ctx.lineTo(bm.x2, bm.y2);
        ctx.stroke();
      }
    }
    // Coil rings: ticks across the beam, sliding outward and opening up as it fades.
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let alpha = 0;
    for (let i = 0; i < this.beamCount; i++) {
      const bm = this.beams[i];
      const k = Math.min(1, bm.age / BEAM_LIFE);
      alpha = Math.max(alpha, 1 - k);
      const half = (bm.overload ? bm.width + 6 : 5) + 10 * k;
      const shift = (k * TIE_GAP * 2) % TIE_GAP;
      for (let d = shift + 12; d < bm.len; d += TIE_GAP) {
        const cx = bm.x1 + bm.dx * d;
        const cy = bm.y1 + bm.dy * d;
        ctx.moveTo(cx - bm.dy * half - bm.dx * 3, cy + bm.dx * half - bm.dy * 3);
        ctx.lineTo(cx + bm.dy * half + bm.dx * 3, cy - bm.dx * half + bm.dy * 3);
      }
    }
    ctx.strokeStyle = `hsla(${RAIL_HUE + 25}, 100%, 82%, ${0.7 * alpha})`;
    ctx.stroke();
  }

  // Ion Wake: a jagged crackling line that flickers and thins out over its life.
  drawWakes(ctx) {
    const frame = Math.floor(this.time * 20);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let alpha = 0;
    for (let i = 0; i < this.wakeCount; i++) {
      const w = this.wakes[i];
      const fade = Math.max(0, 1 - w.age / W.wakeLife);
      alpha = Math.max(alpha, fade);
      const jag = (w.overload ? w.width : 4) + 3;
      const seg = 34;
      ctx.moveTo(w.x1, w.y1);
      for (let d = seg, s = 0; d < w.len; d += seg, s++) {
        const off = (hash(s + i * 31, frame) - 0.5) * 2 * jag;
        ctx.lineTo(w.x1 + w.dx * d - w.dy * off, w.y1 + w.dy * d + w.dx * off);
      }
      ctx.lineTo(w.x2, w.y2);
    }
    ctx.strokeStyle = `hsla(${RAIL_HUE - 30}, 100%, 75%, ${0.55 * alpha})`;
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < this.wakeCount; i++) {
      const w = this.wakes[i];
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
    }
    ctx.strokeStyle = `hsla(${RAIL_HUE}, 100%, 60%, ${0.12 * alpha})`;
    ctx.stroke();
  }
}
