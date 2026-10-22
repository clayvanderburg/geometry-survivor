// Nanite Swarm: a deployable slot weapon. Every few seconds a canister flies from the ship to the densest
// pack in range and bursts into a swarm: a cloud of nanites that drifts with that pack and eats it. Every
// nanite tick, each enemy inside ANY swarm takes one bite (overlapping swarms never stack on one enemy)
// and a CORRODE stack (its element is fixed: weapon-levels.js FIXED_ELEMENTS, applied by
// status-effects.js like any infused weapon). Each kill a swarm makes grows it a little; at the end of
// its life it disperses.
//
// Breakthroughs: Fission Bloom (every few kills a swarm buds a daughter that flies to the next pack),
// Gray Goo (kills feed the swarm: longer life and growth far past the usual cap) and Nanite Plague
// (bitten enemies stay infected; one that dies to anything bursts into a small plague swarm).
//
// Swarms and canisters live in fixed pools (nothing is allocated while launching or ticking) and are
// simulated only from Game.update, so pause, hit-stop and slow-mo freeze them with the rest of the world.
// A new launch avoids the packs live swarms already sit on, so swarms spread over the crowd instead of
// piling into one blob. Drawing is a handful of batched paths under the enemies: one union fill for the
// clouds (overlaps never pile up into an opaque blob), one stroke for the hex rims, one fill for every
// nanite mote, so a screen full of swarms stays cheap and the enemies inside stay readable.
// Every bite has source 'nanite' (CORRODE, damage-number colour); run stats split out the daughters and
// the plague swarms as 'nanite_fission' / 'nanite_plague' (run-stats.js SUB_SOURCES).
import { TUNING } from './config.js';
import { WEAPON_SCALING as W, weaponDamage, naniteRadius } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { isDeployableTarget } from './deployables.js';
import * as BTX from './bt-extras.js'; // pool Breakthroughs: Nano Needles, Ravenous Swarm

export const NANITE_HUE = 96;   // acid lime glow; the motes run chrome-mint, the rims pale lime
const MOTE_HUE = 150;
const MAX_SWARMS = 24;          // >= swarms alive at once (mains + daughters + plague), oldest recycled past it
const MAX_CANISTERS = 6;
const MAX_INFECTED = 96;        // Nanite Plague: infected enemies tracked at once (oldest dropped past it)
const MAX_STREAKS = 48;         // feeding streaks in flight (oldest recycled past it)
const STREAKS_PER_KILL = 3;
const STREAK_TIME = 0.3;        // s a streak takes to reach the swarm's heart
const GROW_EASE = 9;            // per s: how fast a swarm swells to its new size after a kill
const POP = 0.1;                // a kill pops the swarm this much past its size for a moment
const COMBO_GAP = 0.7;          // s without a kill before a swarm's feeding combo resets
const SEEK_EVERY = 0.35;        // s between a swarm's looks at its pack
const PACK_RADIUS = 110;        // px: "a pack" when picking where to launch
const MAX_CANDIDATES = 32;      // enemies tried as pack centres per launch
const CHITTER_EVERY = 0.38;     // s between swarm chitters while any swarm is biting
export const SWARM_MAIN = 0;
export const SWARM_FISSION = 1;
export const SWARM_PLAGUE = 2;
const STATS = ['nanite', 'nanite_fission', 'nanite_plague'];

// Current radius of a swarm: it swells in over W.naniteGrow s and disperses over the last W.naniteFade s;
// after a kill it eases up to its new size (`shown` chases `grow`) with a quick pop past it. Damage
// reads the same radius the swarm is drawn at.
export function swarmRadius(s) {
  const grow = Math.min(1, s.age / W.naniteGrow);
  const left = Math.max(0, Math.min(1, (s.life - s.age) / W.naniteFade));
  const pop = 1 + POP * 4 * s.pulse * (1 - s.pulse); // 0 at the kill, peaks mid-pulse, settles back
  return s.radius * (s.shown ?? s.grow) * pop * (0.45 + 0.55 * grow) * left;
}

export class NaniteSwarm {
  constructor() {
    this.swarms = Array.from({ length: MAX_SWARMS }, () => ({
      x: 0, y: 0, tx: 0, ty: 0, age: 0, life: 0, radius: 0, r: 0, grow: 1, shown: 1, kills: 0, combo: 0, comboT: 0, buds: 0, fed: 0, kind: 0, seek: 0, pulse: 0, spin: 0, seed: 0
    }));
    this.canisters = Array.from({ length: MAX_CANISTERS }, () => ({ x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, dur: 0, kind: 0, seed: 0 }));
    this.infected = [];
    this.streaks = Array.from({ length: MAX_STREAKS }, () => ({ x: 0, y: 0, s: null, t: 0, bend: 0 }));
    this.clear();
  }

  // Run reset: every swarm, canister and infection gone.
  clear() {
    this.count = 0;
    this.canCount = 0;
    this.time = 0;
    this.tickT = 0;
    this.tickEvery = 0.25;
    this.launchT = 0.4;
    this.plagueT = 0;
    this.chitterT = 0;
    this.damage = 0;
    this.radius = 0;
    this.life = 0;
    this.fission = false;
    this.goo = false;
    this.plague = false;
    this.launched = 0;
    this.buds = 0;
    this.plagues = 0;
    this.kills = 0;
    this.infected.length = 0;
    this.streakCount = 0;
    for (const k of this.streaks) k.s = null;
  }

  get activeCount() {
    return this.count + this.canCount;
  }

  update(dt, game) {
    const p = game.player;
    const owned = (p.weapons.nanites || 0) > 0;
    if (!owned && this.count === 0 && this.canCount === 0) {
      this.infected.length = 0;
      return;
    }
    this.time += dt;
    this.chitterT -= dt;
    if (owned) {
      const b = weaponBuild(p, 'nanites');
      this.radius = naniteRadius(p, b);
      this.life = W.naniteLife(b);
      this.tickEvery = W.naniteTick(b);
      this.damage = weaponDamage(p, 'nanite', b);
      this.fission = b.t4;
      this.goo = b.t8;
      this.plague = b.t12;
      this.needles = !!b.tf?.has('needles');
      this.ravenous = !!b.tf?.has('ravenous');
      this.launchT -= dt;
      if (this.launchT <= 0) {
        // Ready: launch at the densest pack in range, or look again shortly when nothing is there.
        this.launchT = this.launch(game, p.x, p.y, W.naniteRange, SWARM_MAIN, p) ? W.naniteCooldown(b) : 0.2;
      }
    } else {
      this.fission = this.goo = this.plague = false;
    }
    this.updateCanisters(dt, game);
    this.updateSwarms(dt, game);
    this.updateStreaks(dt);
    if (this.plague || this.infected.length) this.updatePlague(dt, game);
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = Math.max(0, this.tickT + this.tickEvery);
      this.tick(game);
    }
  }

  // Densest pack within `range` of (x, y): the enemy with the most others within PACK_RADIUS (centre of
  // that pack), packs already under a live swarm counting for much less. Null when nothing is in range.
  findPack(game, x, y, range, out) {
    const enemies = game.enemyManager.enemies;
    const n0 = enemies.length;
    if (n0 === 0) return null;
    const rangeSq = range * range;
    const step = Math.max(1, Math.floor(n0 / MAX_CANDIDATES));
    const off = Math.floor(Math.random() * step);
    const packSq = PACK_RADIUS * PACK_RADIUS;
    let best = -1;
    for (let i = off; i < n0; i += step) {
      const c = enemies[i];
      if (!isDeployableTarget(c)) continue;
      if ((c.x - x) ** 2 + (c.y - y) ** 2 > rangeSq) continue;
      let score = 0, sx = 0, sy = 0, n = 0;
      for (let j = 0; j < n0; j++) {
        const e = enemies[j];
        if (e.dead) continue;
        const dx = e.x - c.x, dy = e.y - c.y;
        if (dx * dx + dy * dy <= packSq) { score += e.isBoss || e.isLieutenant ? 3 : 1; sx += e.x; sy += e.y; n++; }
      }
      // Aim at the middle of the pack (c itself is always in it).
      const px = sx / n, py = sy / n;
      if (this.covered(px, py)) score *= 0.3;
      if (score > best) { best = score; out.x = px; out.y = py; out.n = n; }
    }
    return best >= 0 ? out : null;
  }

  // Whether a live swarm (or a canister on its way) already sits on (x, y).
  covered(x, y) {
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      const r = Math.max(s.r, s.radius) * 1.3;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 <= r * r) return true;
    }
    for (let i = 0; i < this.canCount; i++) {
      const c = this.canisters[i];
      const r = this.radius * 1.3;
      if ((c.tx - x) ** 2 + (c.ty - y) ** 2 <= r * r) return true;
    }
    return false;
  }

  // Fire a canister from (x, y) at the densest pack in range; it bursts into a swarm of `kind` on arrival.
  launch(game, x, y, range, kind, p = null) {
    if (this.canCount >= MAX_CANISTERS) return false;
    const pack = this.findPack(game, x, y, range, this._pack || (this._pack = { x: 0, y: 0, n: 0 }));
    if (!pack) return false;
    const c = this.canisters[this.canCount++];
    const ox = p ? x + Math.cos(p.hullAngle ?? p.angle ?? 0) * 6 : x;
    const oy = p ? y + Math.sin(p.hullAngle ?? p.angle ?? 0) * 6 : y;
    c.x = c.sx = ox;
    c.y = c.sy = oy;
    c.tx = pack.x;
    c.ty = pack.y;
    c.t = 0;
    c.dur = Math.max(0.12, Math.hypot(pack.x - ox, pack.y - oy) / W.naniteSpeed);
    c.kind = kind;
    c.seed = Math.random();
    if (kind === SWARM_MAIN) {
      this.launched++;
      game.sound?.playNaniteLaunch?.();
    }
    return true;
  }

  updateCanisters(dt, game) {
    for (let i = this.canCount - 1; i >= 0; i--) {
      const c = this.canisters[i];
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      // A shallow arc (it is lobbed, not shot) that lands exactly on the aim point.
      const lift = Math.sin(k * Math.PI) * Math.min(40, c.dur * 60);
      const nx = -(c.ty - c.sy), ny = c.tx - c.sx;
      const nl = Math.hypot(nx, ny) || 1;
      const side = c.seed > 0.5 ? 1 : -1;
      c.x = c.sx + (c.tx - c.sx) * k + (nx / nl) * lift * side;
      c.y = c.sy + (c.ty - c.sy) * k + (ny / nl) * lift * side;
      if (k < 1) continue;
      this.canisters[i] = this.canisters[this.canCount - 1];
      this.canisters[--this.canCount] = c;
      const kind = c.kind;
      const mult = kind === SWARM_FISSION ? W.fissionRadiusMult : 1;
      this.addSwarm(c.tx, c.ty, this.radius * mult, this.life * (kind === SWARM_FISSION ? W.fissionLifeMult : 1), kind);
      game.particles?.spawnShockwave?.(c.tx, c.ty, this.radius * mult * 0.9, NANITE_HUE, 2, 0.28);
      game.sound?.playNaniteBurst?.();
    }
  }

  // A swarm from the pool (the most worn-out one is recycled when it is full).
  addSwarm(x, y, radius, life, kind) {
    let s;
    if (this.count < MAX_SWARMS) s = this.swarms[this.count++];
    else {
      s = this.swarms[0];
      for (let i = 1; i < this.count; i++) if (this.swarms[i].age / this.swarms[i].life > s.age / s.life) s = this.swarms[i];
    }
    s.x = s.tx = x;
    s.y = s.ty = y;
    s.age = 0;
    s.life = Math.max(0.2, life);
    s.radius = radius;
    s.r = 0;
    s.grow = 1;
    s.shown = 1;
    s.kills = 0;
    s.combo = 0;
    s.comboT = 0;
    s.buds = 0;
    s.fed = 0;
    s.kind = kind;
    s.seek = Math.random() * SEEK_EVERY;
    s.pulse = 0.6;
    s.spin = 0;
    s.seed = Math.random();
    return s;
  }

  updateSwarms(dt, game) {
    const enemies = game.enemyManager.enemies;
    const pulseDecay = Math.max(0, 1 - 4 * dt);
    for (let i = this.count - 1; i >= 0; i--) {
      const s = this.swarms[i];
      s.age += dt;
      if (s.age >= s.life) {
        // Swap-remove keeps live swarms packed; `s` keeps its data until the slot is reused.
        this.swarms[i] = this.swarms[this.count - 1];
        this.swarms[--this.count] = s;
        continue;
      }
      s.pulse *= pulseDecay;
      s.shown += (s.grow - s.shown) * Math.min(1, GROW_EASE * dt);
      s.spin += dt * (1 + 2.5 * s.pulse); // the motes whirl up while the swarm feeds
      if (s.comboT > 0 && (s.comboT -= dt) <= 0) s.combo = 0;
      // Follow the pack: aim at the centre of the enemies around the swarm that no other swarm is eating
      // (re-read every SEEK_EVERY s), or at the nearest such enemy when the pack is gone, so swarms
      // spread over a crowd instead of merging.
      s.seek -= dt;
      if (s.seek <= 0) {
        s.seek = SEEK_EVERY;
        const reach = Math.max(s.radius * s.grow, 40) * 2;
        let sx = 0, sy = 0, n = 0, near = null, nearSq = 320 * 320;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (!isDeployableTarget(e)) continue;
          const dSq = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
          if (dSq > nearSq && dSq > reach * reach) continue;
          if (this.eatenByOther(s, e)) continue;
          if (dSq <= reach * reach) { sx += e.x; sy += e.y; n++; } else if (dSq < nearSq) { nearSq = dSq; near = e; }
        }
        if (n > 0) { s.tx = sx / n; s.ty = sy / n; } else if (near) { s.tx = near.x; s.ty = near.y; } else { s.tx = s.x; s.ty = s.y; }
      }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 2) {
        const step = Math.min(d, W.naniteDrift * (d > s.radius * 2 ? 1.8 : 1) * dt);
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
      }
      s.r = swarmRadius(s) * BTX.ravenousSize(this, s);
    }
    BTX.naniteNeedles(game, this.swarms, this.count, dt, this, this.damage);
  }

  // Whether an enemy sits inside a swarm other than `s` (so `s` leaves it to that one).
  eatenByOther(s, e) {
    for (let k = 0; k < this.count; k++) {
      const o = this.swarms[k];
      if (o === s) continue;
      if ((e.x - o.x) ** 2 + (e.y - o.y) ** 2 <= o.r * o.r) return true;
    }
    return false;
  }

  // One nanite tick: every enemy inside any swarm takes this.damage (and a CORRODE stack, through
  // hitEnemy). A kill feeds the swarm that made it: growth, Fission Bloom buds and Gray Goo life.
  tick(game) {
    const enemies = game.enemyManager.enemies;
    if (enemies.length === 0 || this.count === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      if (s.x - s.r < minX) minX = s.x - s.r;
      if (s.x + s.r > maxX) maxX = s.x + s.r;
      if (s.y - s.r < minY) minY = s.y - s.r;
      if (s.y + s.r > maxY) maxY = s.y + s.r;
    }
    let bit = false;
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (i >= enemies.length) continue; // a kill this tick shifted the list
      const e = enemies[i];
      if (e.dead) continue;
      const er = (e.radius || 10) * 0.6;
      if (e.x + er < minX || e.x - er > maxX || e.y + er < minY || e.y - er > maxY) continue;
      for (let k = 0; k < this.count; k++) {
        const s = this.swarms[k];
        const r = s.r + er;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        if (dx * dx + dy * dy > r * r) continue;
        if (this.plague && !e.naniteInfected) this.infect(e);
        if (this.plague) e.naniteInfected = this.time + W.plagueWindow;
        game.hitEnemy(e, this.damage * BTX.ravenousBite(this, s), 'nanite', 0, 0, 0.2, STATS[s.kind]);
        bit = true;
        if (e.dead) this.fed(game, s, e);
        break;
      }
    }
    if (bit && this.chitterT <= 0) {
      this.chitterT = CHITTER_EVERY;
      game.sound?.playNaniteChitter?.();
    }
  }

  // A swarm made a kill: it grows (up to W.naniteGrowMax, or W.gooGrowMax with Gray Goo), Gray Goo adds
  // life, and with Fission Bloom a main swarm buds a daughter every W.fissionKills kills.
  fed(game, s, e) {
    this.kills++;
    s.kills++;
    const cap = this.goo ? W.gooGrowMax : W.naniteGrowMax;
    const wasFull = s.grow >= cap;
    s.grow = Math.min(cap, s.grow + W.naniteGrowPerKill);
    s.pulse = 1;
    // Feeding juice: the wreck streams into the swarm, and every kill in a run sings one note higher.
    s.combo = s.comboT > 0 ? s.combo + 1 : 0;
    s.comboT = COMBO_GAP;
    for (let k = 0; k < STREAKS_PER_KILL; k++) this.addStreak(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 10, s);
    game.particles?.spawnExplosionSparks?.(e.x, e.y, 5, NANITE_HUE, 1.2, 4, 1.2);
    game.sound?.playNaniteFeed?.(s.combo);
    if (!wasFull && s.grow >= cap) {
      // Gorged: one bright ring and a chime the moment a swarm reaches full size.
      game.particles?.spawnShockwave?.(s.x, s.y, s.radius * cap * 1.15, MOTE_HUE, 3, 0.35);
      game.sound?.playNaniteGorged?.();
    }
    if (this.goo && s.fed < W.gooLifeMax) {
      const add = Math.min(W.gooLifePerKill, W.gooLifeMax - s.fed);
      s.fed += add;
      s.life += add;
    }
    game.particles?.spawnShockwave?.(e.x, e.y, 10 + (e.radius || 10), MOTE_HUE, 1.5, 0.2);
    if (this.fission && s.kind === SWARM_MAIN && s.buds < W.fissionMax && s.kills >= W.fissionKills * (s.buds + 1)) {
      // Bud a daughter at the next pack over (not this one): it flies there like a launch.
      if (this.launch(game, s.x, s.y, W.naniteRange, SWARM_FISSION)) {
        s.buds++;
        this.buds++;
        game.sound?.playNaniteBloom?.();
      }
    }
  }

  // A feeding streak from a wreck into swarm `s` (the oldest one is recycled when the pool is full).
  addStreak(x, y, s) {
    let k;
    if (this.streakCount < MAX_STREAKS) k = this.streaks[this.streakCount++];
    else {
      k = this.streaks[0];
      for (let i = 1; i < this.streakCount; i++) if (this.streaks[i].t > k.t) k = this.streaks[i];
    }
    k.x = x;
    k.y = y;
    k.s = s;
    k.t = 0;
    k.bend = (Math.random() - 0.5) * 1.6;
  }

  updateStreaks(dt) {
    for (let i = this.streakCount - 1; i >= 0; i--) {
      const k = this.streaks[i];
      k.t += dt / STREAK_TIME;
      if (k.t < 1 && k.s && k.s.age < k.s.life) continue;
      k.s = null;
      this.streaks[i] = this.streaks[this.streakCount - 1];
      this.streaks[--this.streakCount] = k;
    }
  }

  // Where a streak's head is: easing in (slow off the wreck, snapping into the heart) on a slight curve.
  streakPoint(k, t, out) {
    const e = t * t * t;
    const dx = k.s.x - k.x, dy = k.s.y - k.y;
    const side = Math.sin(t * Math.PI) * k.bend * 0.25;
    out.x = k.x + dx * e - dy * side;
    out.y = k.y + dy * e + dx * side;
    return out;
  }

  // Nanite Plague: remember a bitten enemy (once) so its death anywhere can be noticed.
  infect(e) {
    if (this.infected.length >= MAX_INFECTED) {
      const old = this.infected.shift();
      if (old) old.naniteInfected = 0;
    }
    this.infected.push(e);
  }

  // Infected enemies that died (to anything) inside their window burst into plague swarms, at most one
  // every W.plagueEvery s and W.plagueMax alive; the rest just stop being tracked.
  updatePlague(dt, game) {
    this.plagueT -= dt;
    let alive = 0;
    if (this.plague) for (let i = 0; i < this.count; i++) if (this.swarms[i].kind === SWARM_PLAGUE) alive++;
    let w = 0;
    for (let i = 0; i < this.infected.length; i++) {
      const e = this.infected[i];
      const live = (e.naniteInfected || 0) > this.time;
      if (e.dead) {
        if (live && this.plague && this.plagueT <= 0 && alive < W.plagueMax && this.radius > 0) {
          this.plagueT = W.plagueEvery;
          alive++;
          this.plagues++;
          this.addSwarm(e.x, e.y, this.radius * W.plagueRadiusMult, W.plagueLife, SWARM_PLAGUE);
          game.particles?.spawnShockwave?.(e.x, e.y, this.radius * W.plagueRadiusMult, NANITE_HUE, 2, 0.22);
          game.sound?.playNaniteBloom?.();
        }
        e.naniteInfected = 0;
        continue;
      }
      if (!live) { e.naniteInfected = 0; continue; }
      this.infected[w++] = e;
    }
    this.infected.length = w;
  }

  // ---- Rendering (world space, under the enemies). Animation runs on this.time, so it freezes with the sim. ----
  inView(game, x, y, pad) {
    return x > game.camX - pad && x < game.camX + game.width + pad && y > game.camY - pad && y < game.camY + game.height + pad;
  }

  // Swarms: one union fill (a faint lime haze, so overlaps never darken into a blob hiding enemies), one
  // stroke for the turning hex rims (brighter for a moment after a kill), one fill for every nanite mote
  // (tiny chrome triangles swirling inside), plus the canisters in flight and plague marks on infected
  // hulls. Four to six batched paths a frame however many swarms are out.
  drawGround(ctx, game) {
    if (this.count === 0 && this.canCount === 0 && this.infected.length === 0) return;
    const vfx = TUNING.vfxIntensity ?? 1;
    const t = this.time;
    const a = (v) => Math.min(1, v * vfx);
    ctx.save();

    // Haze.
    ctx.fillStyle = `hsla(${NANITE_HUE}, 100%, 50%, ${a(0.05)})`;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      if (s.r <= 1 || !this.inView(game, s.x, s.y, s.r)) continue;
      ctx.moveTo(s.x + s.r, s.y);
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Hex rims: one turning hexagon per swarm (plague swarms turn the other way).
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `hsla(${NANITE_HUE}, 100%, 66%, ${a(0.34)})`;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      if (s.r <= 2 || !this.inView(game, s.x, s.y, s.r)) continue;
      hexPath(ctx, s.x, s.y, s.r, s.seed * 6.283 + t * (s.kind === SWARM_PLAGUE ? -0.9 : 0.6));
    }
    ctx.stroke();
    // A kill flashes the rim of the swarm that made it (only the swarms pulsing right now).
    ctx.strokeStyle = `hsla(${MOTE_HUE}, 100%, 82%, ${a(0.6)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      if (s.pulse < 0.15 || s.r <= 2 || !this.inView(game, s.x, s.y, s.r)) continue;
      hexPath(ctx, s.x, s.y, s.r * (1 + 0.12 * (1 - s.pulse)), s.seed * 6.283 + t * 0.6);
    }
    ctx.stroke();

    // Motes: small chrome triangles on looping orbits inside the swarm, fewer in small swarms.
    ctx.fillStyle = `hsla(${MOTE_HUE}, 90%, 80%, ${a(0.85)})`;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const s = this.swarms[i];
      if (s.r <= 2 || !this.inView(game, s.x, s.y, s.r)) continue;
      const n = Math.max(8, Math.min(28, Math.round(s.r / 3.4)));
      const size = 2.1 + Math.min(1.2, s.r / 90);
      for (let m = 0; m < n; m++) {
        const h = hash(s.seed * 97 + m * 13.37);
        const dir = m % 2 === 0 ? 1 : -1;
        const q = h * 6.283 + s.spin * (1.1 + 1.6 * hash(m + s.seed)) * dir;
        const rr = s.r * (0.18 + 0.74 * hash(h * 31 + m)) * (0.92 + 0.08 * Math.sin(t * 3 + m));
        const mx = s.x + Math.cos(q) * rr;
        const my = s.y + Math.sin(q * (1 + 0.15 * (m % 3))) * rr;
        const head = q + dir * 1.5708;
        trianglePath(ctx, mx, my, size, head);
      }
    }
    ctx.fill();

    // Feeding streaks: short bright dashes racing from each wreck into its swarm.
    if (this.streakCount) {
      const pa = this._pa || (this._pa = { x: 0, y: 0 });
      const pb = this._pb || (this._pb = { x: 0, y: 0 });
      ctx.strokeStyle = `hsla(${MOTE_HUE}, 100%, 85%, ${a(0.9)})`;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.streakCount; i++) {
        const k = this.streaks[i];
        if (!k.s || !this.inView(game, k.x, k.y, 200)) continue;
        this.streakPoint(k, Math.max(0, k.t - 0.18), pa);
        this.streakPoint(k, Math.min(1, k.t), pb);
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
    }

    // Canisters in flight: a bright diamond with a short tail.
    if (this.canCount) {
      ctx.strokeStyle = `hsla(${NANITE_HUE}, 100%, 70%, ${a(0.55)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < this.canCount; i++) {
        const c = this.canisters[i];
        const k = Math.max(0, Math.min(1, c.t / c.dur) - 0.12);
        ctx.moveTo(c.sx + (c.tx - c.sx) * k, c.sy + (c.ty - c.sy) * k);
        ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      ctx.fillStyle = `hsla(${MOTE_HUE}, 100%, 88%, ${a(1)})`;
      ctx.beginPath();
      for (let i = 0; i < this.canCount; i++) {
        const c = this.canisters[i];
        const q = t * 9 + c.seed * 6;
        const r = c.kind === SWARM_FISSION ? 4 : 5.5;
        ctx.moveTo(c.x + Math.cos(q) * r, c.y + Math.sin(q) * r);
        ctx.lineTo(c.x + Math.cos(q + 1.5708) * r * 0.6, c.y + Math.sin(q + 1.5708) * r * 0.6);
        ctx.lineTo(c.x + Math.cos(q + 3.1416) * r, c.y + Math.sin(q + 3.1416) * r);
        ctx.lineTo(c.x + Math.cos(q + 4.7124) * r * 0.6, c.y + Math.sin(q + 4.7124) * r * 0.6);
        ctx.closePath();
      }
      ctx.fill();
    }

    // Nanite Plague: infected hulls carry three small lime ticks round their rim.
    if (this.plague && this.infected.length) {
      ctx.strokeStyle = `hsla(${NANITE_HUE}, 100%, 62%, ${a(0.55)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < this.infected.length; i++) {
        const e = this.infected[i];
        if (e.dead || !this.inView(game, e.x, e.y, 30)) continue;
        const r = (e.radius || 10) + 4;
        for (let k = 0; k < 3; k++) {
          const q = t * 1.8 + (k * Math.PI * 2) / 3;
          ctx.moveTo(e.x + Math.cos(q) * r, e.y + Math.sin(q) * r);
          ctx.arc(e.x, e.y, r, q, q + 0.6);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Cheap deterministic 0..1 hash (mote orbits are recomputed every frame from the swarm's seed).
function hash(v) {
  const s = Math.sin(v * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function hexPath(ctx, x, y, r, rot) {
  for (let k = 0; k <= 6; k++) {
    const q = rot + (k * Math.PI) / 3;
    const px = x + Math.cos(q) * r, py = y + Math.sin(q) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

function trianglePath(ctx, x, y, r, q) {
  ctx.moveTo(x + Math.cos(q) * r * 1.3, y + Math.sin(q) * r * 1.3);
  ctx.lineTo(x + Math.cos(q + 2.4) * r, y + Math.sin(q + 2.4) * r);
  ctx.lineTo(x + Math.cos(q - 2.4) * r, y + Math.sin(q - 2.4) * r);
  ctx.closePath();
}
