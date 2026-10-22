// Pool Breakthroughs (EXTRA_TRANSFORMS in weapon-levels.js, docs/BREAKTHROUGH_POOLS.md): the transforms
// added after the original three per weapon. Each hook is a few lines in main.js; the numbers live in
// weapon-scaling.js (W), so the card previews and the potential model read the same values.
//
// Autocannon: Tracer Slugs, Hot Barrel. Rocket Pods: Shrapnel Shells, Rolling Thunder.
// Swarm Missiles: Hunter-Killer, Echo Salvo. Builds carry them in b.tf (makeBuild).
import { WEAPON_SCALING as W } from './weapon-scaling.js';
import { applyShock } from './status-effects.js';

const has = (b, id) => !!b?.tf?.has(id);

// --- Autocannon -----------------------------------------------------------------------------------

// Hot Barrel: heat (0..1) climbs while the Autocannon fires and bleeds off when it stops. Returns the
// fire-rate multiplier for this tick (1 without the transform).
export function hotBarrelRate(game, dt, firing, b) {
  if (!has(b, 'hotbarrel')) {
    game.barrelHeat = 0;
    return 1;
  }
  const heat = game.barrelHeat || 0;
  game.barrelHeat = firing ? Math.min(1, heat + dt / W.hotHeatUp) : Math.max(0, heat - dt / W.hotCool);
  return 1 + W.hotRateMax * game.barrelHeat;
}

// Called once per Autocannon volley, before its bolts go out: whether this volley is a Tracer Slug one.
export function blasterVolley(game, b) {
  if (!has(b, 'slug')) return false;
  game.slugCount = ((game.slugCount || 0) + 1) % W.slugEvery;
  return game.slugCount === 0;
}

// Shape one Autocannon bolt for the pool transforms (slug: this volley is a slug volley).
export function shapeBlasterBolt(game, b, bolt, slug) {
  const heat = has(b, 'hotbarrel') ? game.barrelHeat || 0 : 0;
  if (heat > 0 && !slug) {
    // Cyan -> white-hot orange as the barrel heats, bolts a touch fatter.
    bolt.hue = bolt.hue + (22 - bolt.hue) * heat;
    bolt.radius *= 1 + 0.18 * heat;
  }
  if (slug) {
    bolt.damage *= W.slugMult;
    bolt.pierce += W.slugPierce;
    bolt.radius *= W.slugRadiusMult;
    bolt.width = (bolt.width || 1) * 1.7;
    bolt.hue = 34;
    bolt.bx = { slug: true };
  }
  return bolt;
}

// After the volley fired: the slug's heavier kick, and the hot barrel's shimmer.
export function blasterVolleyFx(game, p, slug) {
  const nx = p.x + Math.cos(p.angle) * 22, ny = p.y + Math.sin(p.angle) * 22;
  if (slug) {
    game.particles.spawnFlash?.(nx, ny, 16, 36, 0.12);
    game.particles.spawnDirectionalSparks(nx, ny, p.angle, 0.5, 6, 36, 9);
    game.grid.applyImpulse(nx, ny, 12, 150, 36, 0);
    game.sound.playLaser(0.62); // a deeper thump under the regular shot
    game.shake = Math.max(game.shake || 0, 1.6);
  }
  const heat = game.barrelHeat || 0;
  if (heat > 0.6 && Math.random() < heat * 0.6) game.particles.spawnDirectionalSparks(nx, ny, p.angle + Math.PI, 1.6, 1, 24 + 20 * Math.random(), 3);
}

// Laser pitch: a hot barrel sings higher.
export const blasterPitch = (game, b) => (has(b, 'hotbarrel') ? 1 + 0.22 * (game.barrelHeat || 0) : 1);

// --- Rocket Pods ------------------------------------------------------------------------------------

// Flags on one rocket for Shrapnel Shells / Rolling Thunder.
export function shapeRocket(b, rocket) {
  const shrapnel = has(b, 'shrapnel'), thunder = has(b, 'thunder');
  if (shrapnel || thunder) rocket.bx = { shrapnel, thunder, thunderT: W.thunderEvery, drops: 0 };
  return rocket;
}

// Rolling Thunder: in flight, a rocket drops a charge every thunderEvery s (up to thunderMax) that
// blows thunderDelay s later where it fell, so the string goes off behind the rocket in order.
export function rocketFlight(game, r, dt) {
  const x = r.bx;
  if (!x?.thunder || x.drops >= W.thunderMax) return;
  x.thunderT -= dt;
  if (x.thunderT > 0) return;
  x.thunderT += W.thunderEvery;
  x.drops++;
  game.particles.spawnFlash?.(r.x, r.y, 7, 40, 0.1);
  game.weaponFx.schedule({ x: r.x, y: r.y, delay: W.thunderDelay, radius: (r.blastRadius || 50) * W.thunderRadiusFrac,
    damage: r.damage * W.thunderShare, hue: 26 + 6 * x.drops, source: r.source, style: 'charge', step: x.drops, knock: 0.7 });
}

// Shrapnel Shells: where a rocket bursts, a ring of jagged shards flies out (they skip the enemy it hit).
export function rocketBurst(game, r, e, hx, hy) {
  if (!r.bx?.shrapnel) return;
  const n = W.shellShards;
  const spin = Math.random() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = spin + (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const speed = W.shellSpeed * (0.85 + Math.random() * 0.3);
    game.bullets.push({
      x: hx, y: hy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      damage: r.damage * W.shellShare, pierce: 2, hue: 44, radius: 3.4, width: 1,
      life: W.shellLife, maxLife: W.shellLife, spin: Math.random() * 6, source: r.source, stat: r.source, kind: 'shrapnel', knock: 0.6,
      hitEnemies: new Set(e ? [e] : [])
    });
  }
  game.particles.spawnFlash?.(hx, hy, 22, 40, 0.12);
  game.particles.spawnShockwave(hx, hy, 70, 40, 2, 0.22);
  game.particles.spawnExplosionSparks(hx, hy, 10, 38, 3, 12, 1.4);
}

// A shrapnel shard in flight: a spinning, jagged fragment on a glowing streak (hot orange; a shard with a
// cool hue, 100+, shifts its ramp onto that hue), cooling as it slows.
export function drawShrapnel(ctx, b) {
  const k = Math.max(0, b.life / (b.maxLife || 1));
  const h = b.hue < 100 ? 0 : b.hue - 36; // the orange shards keep their warm ramp; others shift onto their hue
  const spin = (b.spin = (b.spin || 0) + 0.5);
  const len = 8, wid = 2.4 + 2 * Math.abs(Math.sin(spin));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `hsla(${36 + h}, 100%, 58%, ${0.45 * k + 0.1})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(b.x - b.vx * 2.2, b.y - b.vy * 2.2);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.translate(b.x, b.y);
  ctx.rotate(spin);
  ctx.fillStyle = `hsla(${30 + h + 20 * k}, 100%, ${62 + 22 * k}%, 0.95)`;
  ctx.strokeStyle = `hsla(${22 + h}, 100%, 55%, 0.9)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(-len * 0.2, -wid);
  ctx.lineTo(-len * 0.55, wid * 0.3);
  ctx.lineTo(len * 0.1, wid);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- Swarm Missiles --------------------------------------------------------------------------------

export function shapeMissile(b, m) {
  if (has(b, 'hunter')) m.hunterArmed = true;
  return m;
}

// Hunter-Killer: a missile blast launches one hunter micro-missile at the nearest enemy beyond it.
export function missileBlast(game, m, blast) {
  if (!m.hunterArmed || m.hunter) return;
  let best = null, bestSq = W.hunterRange * W.hunterRange;
  for (const e of game.enemyManager.enemies) {
    if (e.dead) continue;
    const dSq = (e.x - m.x) ** 2 + (e.y - m.y) ** 2;
    if (dSq > (blast + e.radius) ** 2 && dSq < bestSq) { bestSq = dSq; best = e; }
  }
  if (!best) return;
  const a = Math.atan2(best.y - m.y, best.x - m.x) + (Math.random() - 0.5) * 1.2;
  game.missiles.push({
    target: best, aimX: best.x, aimY: best.y, x: m.x, y: m.y, vx: Math.cos(a) * 9, vy: Math.sin(a) * 9,
    speed: W.missileSpeed * 1.2, damage: m.damage * W.hunterShare, blastRadius: blast * W.hunterBlastFrac,
    hue: 8, trail: [], life: W.missileLife * 0.8, source: m.source, hunter: true, chainSafe: 0.25
  });
  game.particles.spawnDirectionalSparks(m.x, m.y, a, 0.4, 5, 8, 7);
}

// Echo Salvo: echoDelay s after a salvo, the same salvo fires again at echoShare (echoes never echo).
export function afterSalvo(game, b, echo) {
  if (echo || !has(b, 'echo')) return;
  const p = game.player;
  game.weaponFx.schedule({ x: p.x, y: p.y, delay: W.echoDelay, radius: 0, damage: 0, style: 'silent',
    after: (g) => g.fireSwarmMissiles(b, { echo: true }) });
}

// --- Escort Drones (js/deployables.js updateDrones) ---------------------------------------------------

// Overdrive Sync: the formation's fire-rate multiplier this tick (overdriveMult for the last overdriveTime s of
// every overdriveEvery s cycle). `state` holds the clock; the burst opens with a chirp and a flare on each drone.
export function droneOverdrive(state, dt, level, game, drones, n) {
  if (!has(level, 'overdrive')) {
    state.odClock = 0;
    state.overdrive = false;
    return 1;
  }
  state.odClock = ((state.odClock || 0) + dt) % W.overdriveEvery;
  const on = state.odClock >= W.overdriveEvery - W.overdriveTime;
  if (on && !state.overdrive) {
    for (let i = 0; i < n; i++) {
      const d = drones[i];
      if (d.launch > 0) continue;
      game.particles.spawnShockwave(d.x, d.y, 26, W.overdriveHue, 2.5, 0.25);
      game.particles.spawnFlash?.(d.x, d.y, 18, W.overdriveHue, 0.14);
    }
    game.sound.playDroneDock?.(Math.max(0, n - 1)); // the top of the docking chirp: the formation spins up
  }
  state.overdrive = on;
  return on ? W.overdriveMult : 1;
}

// Kamikaze Wing: every kamikazeEvery s the rearmost docked drone dives on the densest pack near the ship.
// Returns true while drone `d` is diving (it neither keeps station nor fires); on arrival it detonates for
// `blast` damage and goes back into the hangar to relaunch.
export function droneKamikazeTick(state, dt, level, game, drones, n) {
  if (!has(level, 'kamikaze') || n === 0) return;
  state.kamiT = (state.kamiT || 0) + dt;
  if (state.kamiT < W.kamikazeEvery) return;
  let diver = null;
  for (let i = n - 1; i >= 0; i--) if (drones[i].docked && !drones[i].dive && !(drones[i].launch > 0)) { diver = drones[i]; break; }
  const target = diver && densestEnemy(game, game.player.x, game.player.y, W.kamikazeRange, W.kamikazeRadius);
  if (!target) { state.kamiT = W.kamikazeEvery - 0.5; return; } // try again shortly
  state.kamiT = 0;
  diver.dive = { target, x: target.x, y: target.y, t: 0 };
  game.particles.spawnDirectionalSparks(diver.x, diver.y, Math.atan2(target.y - diver.y, target.x - diver.x) + Math.PI, 0.6, 6, 18, 8);
}

export function droneDive(game, d, dt, blast) {
  const v = d.dive;
  if (!v) return false;
  if (!v.target.dead) { v.x = v.target.x; v.y = v.target.y; }
  v.t += dt;
  const dx = v.x - d.x, dy = v.y - d.y;
  const dist = Math.hypot(dx, dy);
  const step = W.kamikazeSpeed * (1 + v.t * 2);
  d.angle = Math.atan2(dy, dx);
  if (dist > step && v.t < 0.9) {
    d.x += (dx / dist) * step;
    d.y += (dy / dist) * step;
    d.vx = (dx / dist) * step;
    d.vy = (dy / dist) * step;
    if (Math.random() < 0.8) game.particles.spawnDirectionalSparks(d.x, d.y, d.angle + Math.PI, 0.4, 2, 24, 6);
    return true;
  }
  // Impact: a hot drone-blue core blowing out into an orange fireball, a hard shove on the grid.
  const r = W.kamikazeRadius * (game.player.stats?.areaMult ?? 1);
  game.particles.spawnFlash?.(v.x, v.y, r * 0.7, 30, 0.26);
  game.particles.spawnShockwave(v.x, v.y, r, 24, 5, 0.42);
  game.particles.spawnShockwave(v.x, v.y, r * 0.55, 190, 3, 0.3);
  game.particles.spawnExplosionSparks(v.x, v.y, 26, 28, 3, 14, 2.4);
  game.grid.applyImpulse(v.x, v.y, 60, r * 1.4, 30);
  game.shake = Math.max(game.shake || 0, 5 * (game.tuningShake ?? 1));
  game.sound.playExplosion?.(0.7);
  game.damageEnemiesInRadius(v.x, v.y, r, blast, 28, 'drone', 1.6, undefined, 'drone');
  d.dive = null;
  d.launch = 1; // back to the hangar; it relaunches (and redocks) in a second
  d.docked = false;
  d.flight = 0;
  d.trailCount = 0;
  return true;
}

// The enemy within `range` of (x, y) with the most others within `radius` of it (a sample of up to 48).
function densestEnemy(game, x, y, range, radius) {
  const near = [];
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.invulnerable) continue;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 <= range * range) near.push(e);
    if (near.length >= 48) break;
  }
  let best = null, bestN = -1;
  for (const e of near) {
    let c = 0;
    for (const o of near) if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= radius * radius) c++;
    if (c > bestN) { bestN = c; best = e; }
  }
  return best;
}

// --- Sentry Turret (js/deployables.js updateTurrets) ----------------------------------------------------

// Parting Gift: an expiring turret blows for giftBolts of its bolts.
export function turretGift(game, t, level, boltDamage) {
  if (!has(level, 'gift')) return;
  const r = W.giftRadius * (game.player.stats?.areaMult ?? 1);
  game.particles.spawnFlash?.(t.x, t.y, r * 0.6, 40, 0.24);
  game.particles.spawnShockwave(t.x, t.y, r, 34, 5, 0.4);
  game.particles.spawnShockwave(t.x, t.y, r * 0.5, 56, 3, 0.28);
  game.particles.spawnExplosionSparks(t.x, t.y, 30, 38, 3, 14, 2.4);
  game.grid.applyImpulse(t.x, t.y, 70, r * 1.4, 36);
  game.shake = Math.max(game.shake || 0, 6);
  game.sound.playExplosion?.(0.8);
  game.damageEnemiesInRadius(t.x, t.y, r, boltDamage * W.giftBolts, 36, 'turret', 1.8, undefined, 'turret');
}

// Overwatch Link: every linkTick s, live turrets within linkRange of each other are joined by a crackling
// beam (drawn as lightning that lasts the tick) that hits every enemy touching it for linkShare of a bolt.
export function turretLinks(state, dt, game, turrets, count, level, boltDamage) {
  if (!has(level, 'link') || count < 2) return;
  state.linkT = (state.linkT || 0) - dt;
  if (state.linkT > 0) return;
  state.linkT += W.linkTick;
  const enemies = game.enemyManager.enemies;
  let pairs = 0;
  for (let i = 0; i < count && pairs < 8; i++) {
    const a = turrets[i];
    if (a.packing) continue;
    for (let j = i + 1; j < count && pairs < 8; j++) {
      const c = turrets[j];
      if (c.packing) continue;
      const lx = c.x - a.x, ly = c.y - a.y;
      const len = Math.hypot(lx, ly);
      if (len > W.linkRange || len < 1) continue;
      pairs++;
      game.particles.spawnLightning?.(a.x, a.y, c.x, c.y, 52, 1.3, W.linkTick * 1.1);
      const ux = lx / len, uy = ly / len;
      for (const e of enemies) {
        if (e.dead) continue;
        const along = (e.x - a.x) * ux + (e.y - a.y) * uy;
        if (along < 0 || along > len) continue;
        if (Math.abs((e.x - a.x) * uy - (e.y - a.y) * ux) > W.linkWidth + (e.radius || 10)) continue;
        game.hitEnemy(e, boltDamage * W.linkShare, 'turret', 0, 0, 0.3, 'turret');
        game.particles.spawnFlash?.(e.x, e.y, 8 + (e.radius || 10) * 0.6, 52, 0.08);
      }
    }
  }
  if (pairs) game.sound.playArcZap?.(Math.min(4, pairs));
}

// --- Glaive Discs (js/glaive.js) ---------------------------------------------------------------------

// Arc Discs: a ricochet off `e` arcs arcDiscShare of the hit back into the enemy the disc left (`prev`).
export function glaiveArc(game, b, prev, e, dmg) {
  if (!has(b, 'arcdisc') || !prev || prev === e || prev.dead) return;
  if ((prev.x - e.x) ** 2 + (prev.y - e.y) ** 2 > W.arcDiscRange * W.arcDiscRange) return;
  game.particles.spawnLightning?.(e.x, e.y, prev.x, prev.y, 196, 1.5, 0.16);
  game.particles.spawnFlash?.(prev.x, prev.y, 8 + (prev.radius || 10), 196, 0.1);
  game.hitEnemy(prev, dmg * W.arcDiscShare, 'glaive', 0, 0, 0.5, 'glaive');
}

// Shatter Edge: a disc fading out bursts into shatterShards razor shards (Shrapnel Shells' shards, molten orange like the disc).
export function glaiveShatter(game, b, d, dmg) {
  if (!has(b, 'shatter')) return;
  const n = W.shatterShards;
  const spin = Math.random() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = spin + (k / n) * Math.PI * 2;
    const speed = W.shellSpeed * (0.9 + Math.random() * 0.3);
    game.bullets.push({
      x: d.x, y: d.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      damage: dmg * W.shatterShare, pierce: 2, hue: 30, radius: 3.4, width: 1,
      life: W.shellLife, maxLife: W.shellLife, spin: Math.random() * 6, source: 'glaive', stat: 'glaive', kind: 'shrapnel', knock: 0.5,
      hitEnemies: new Set()
    });
  }
  game.particles.spawnFlash?.(d.x, d.y, 20, 40, 0.12);
  game.particles.spawnShockwave(d.x, d.y, 48, 30, 2.5, 0.2);
  game.sound.playGlaiveSplit?.();
}

// --- Claw Harpoon (js/claw-harpoon.js) ----------------------------------------------------------------

// Whip Tether: while reeling, the tether (socket -> tip) hits every enemy it lies across, once per throw.
export function harpoonWhip(game, b, throwId, sx, sy, tx, ty, dmg) {
  if (!has(b, 'whip')) return;
  const lx = tx - sx, ly = ty - sy;
  const len = Math.hypot(lx, ly);
  if (len < 20) return;
  const ux = lx / len, uy = ly / len;
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.harpoonWhip === throwId) continue;
    const along = (e.x - sx) * ux + (e.y - sy) * uy;
    if (along < 0 || along > len) continue;
    if (Math.abs((e.x - sx) * uy - (e.y - sy) * ux) > W.whipWidth + (e.radius || 10)) continue;
    e.harpoonWhip = throwId;
    game.hitEnemy(e, dmg * W.whipShare, 'harpoon', uy * 2, -ux * 2, 0.7, 'harpoon');
    game.particles.spawnDirectionalSparks(e.x, e.y, Math.atan2(-ux, uy), 0.6, 4, 40, 7);
    game.particles.spawnShockwave(e.x, e.y, (e.radius || 10) * 1.8, 40, 1.5, 0.12);
    game.sound.playHarpoonHit?.('enemy');
  }
}

// Tesla Hook: the claw discharges at the end of a throw, arcing into up to teslaArcs enemies near the tip.
export function harpoonTesla(game, b, x, y, dmg) {
  if (!has(b, 'tesla')) return;
  const near = [];
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.invulnerable) continue;
    const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (dSq <= W.teslaRange * W.teslaRange) near.push([dSq, e]);
  }
  near.sort((u, v) => u[0] - v[0]);
  const n = Math.min(W.teslaArcs, near.length);
  game.particles.spawnFlash?.(x, y, 18, 196, 0.12);
  game.particles.spawnShockwave(x, y, 34, 196, 2, 0.16);
  for (let k = 0; k < n; k++) {
    const e = near[k][1];
    game.particles.spawnLightning?.(x, y, e.x, e.y, 196, 1.6, 0.18);
    game.hitEnemy(e, dmg * W.teslaShare, 'harpoon', 0, 0, 0.5, 'harpoon');
  }
  if (n) game.sound.playArcZap?.(n);
}

// --- Graviton Mortar (js/quake-mortar.js) ---------------------------------------------------------------

// Crush Field: a main landing leaves a gravity pool that grinds crushShare of the ring over crushLife s.
export function quakeCrush(game, b, x, y, radius, dmg) {
  if (!has(b, 'crush')) return;
  const ticks = W.crushLife / W.crushTick;
  game.weaponFx.addPool({ x, y, radius: radius * W.crushRadiusFrac, life: W.crushLife, tick: W.crushTick, damage: dmg * W.crushShare / ticks, hue: 44, source: 'quake' });
  game.particles.spawnShockwave(x, y, radius * W.crushRadiusFrac, 44, 2.5, 0.3, true);
}

// Gravity Lens: a charge still in flight drags the enemies around its landing point toward it.
export function quakeLens(game, b, s, dt) {
  if (!has(b, 'lens')) return;
  const r = s.radius * W.lensRadiusMult;
  const pull = W.lensPull * dt;
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.isBoss) continue;
    const dx = s.lx - e.x, dy = s.ly - e.y;
    const d = Math.hypot(dx, dy);
    if (d > r || d < 6) continue;
    const k = e.isLieutenant ? 0.4 : 1;
    e.x += (dx / d) * pull * k;
    e.y += (dy / d) * pull * k;
  }
  // The lens shimmers on the ground under the falling charge: an inward ring every so often.
  s.lensT = (s.lensT || 0) - dt;
  if (s.lensT <= 0) {
    s.lensT = 0.32;
    game.particles.spawnShockwave(s.lx, s.ly, r * 0.8, 300, 0.8, 0.3, true);
  }
}

// --- Plasma Grenades (js/grenades.js) -----------------------------------------------------------------

// Sticky Plasma: a landing grenade grabs the nearest enemy within stickyReach and rides it.
export function grenadeStick(game, g) {
  if (!g.sticky) return;
  let best = null, bestSq = W.stickyReach * W.stickyReach;
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.invulnerable) continue;
    const dSq = (e.x - g.x) ** 2 + (e.y - g.y) ** 2;
    if (dSq < bestSq) { bestSq = dSq; best = e; }
  }
  g.stuck = best;
  if (!best) return;
  g.stickDx = (g.x - best.x) * 0.5;
  g.stickDy = (g.y - best.y) * 0.5;
  game.particles.spawnFlash?.(g.x, g.y, 14, g.hue, 0.1);
  game.particles.spawnShockwave(g.x, g.y, 18, g.hue, 2, 0.14);
}

// Keeps a stuck grenade on its host while the fuse burns.
export function grenadeRide(g) {
  const e = g.stuck;
  if (!e) return;
  if (e.dead) { g.stuck = null; return; }
  g.x = e.x + g.stickDx;
  g.y = e.y + g.stickDy;
}

// On the blast: the stuck host takes stickyShare more; Plasma Geyser's vent erupts geyserBursts times.
export function grenadeBlast(game, g) {
  const e = g.stuck;
  if (e && !e.dead) {
    game.hitEnemy(e, g.damage * W.stickyShare, 'grenade', 0, 0, 1, 'grenade');
    game.particles.spawnFlash?.(e.x, e.y, (e.radius || 10) * 1.8, g.hue + 20, 0.14);
  }
  g.stuck = null;
  if (!g.geyser) return;
  for (let k = 1; k <= W.geyserBursts; k++) {
    game.weaponFx.schedule({ x: g.x, y: g.y, delay: W.geyserGap * k, radius: g.radius * W.geyserRadiusFrac, damage: g.damage * W.geyserShare,
      hue: g.hue, source: 'grenade', style: 'charge', step: k + 1, knock: 0.8 });
  }
}

// --- Proximity Mines (js/deployables.js) -----------------------------------------------------------------

// Shock Mines: the blast SHOCKs every enemy in it. Napalm Mines: it leaves a burning pool.
export function mineBlast(game, m) {
  if (m.shock) {
    const p = game.player;
    for (const e of game.enemyManager.enemies) {
      if (e.dead) continue;
      const r = m.blast + (e.radius || 10);
      if ((e.x - m.x) ** 2 + (e.y - m.y) ** 2 > r * r) continue;
      if (applyShock(e, W.shockMineRank, p)) game.particles.spawnLightning?.(m.x, m.y, e.x, e.y, 62, 0.9, 0.14);
    }
    game.particles.spawnShockwave(m.x, m.y, m.blast * 0.9, 62, 2.5, 0.28);
    game.sound.playArcZap?.(4);
  }
  if (m.napalm) {
    const ticks = W.napalmMineLife / W.napalmMineTick;
    game.weaponFx.addPool({ x: m.x, y: m.y, radius: m.blast * W.napalmMineRadiusFrac, life: W.napalmMineLife, tick: W.napalmMineTick,
      damage: m.damage * W.napalmMineShare / ticks, hue: 18, source: 'mine' });
    game.particles.spawnExplosionSparks(m.x, m.y, 14, 20, 1.5, 8, 2.4);
  }
}

// --- Orbit Blades (main.js updateOrbitals) --------------------------------------------------------------

// Blade Frenzy: the heat (0..1) bleeds off every tick; returns the blades' damage multiplier.
export function frenzyMult(state, dt, b) {
  if (!has(b, 'frenzy')) { state.bladeFrenzy = 0; return 1; }
  state.bladeFrenzy = Math.max(0, (state.bladeFrenzy || 0) - W.frenzyDecay * dt);
  return 1 + W.frenzyMax * state.bladeFrenzy;
}
export function frenzyHit(state, b) {
  if (has(b, 'frenzy')) state.bladeFrenzy = Math.min(1, (state.bladeFrenzy || 0) + W.frenzyGain);
}
// Blade size multiplier: the blades swell as the frenzy builds.
export const frenzySize = (state, b) => (has(b, 'frenzy') ? 1 + W.frenzySize * (state.bladeFrenzy || 0) : 1);
// The blades' spark hue: Orbit green heating toward white-hot gold as the frenzy builds.
export const frenzyHue = (state, b) => (has(b, 'frenzy') ? 150 - 100 * (state.bladeFrenzy || 0) : 150);

// Vortex Ring: enemies within vortexBand of the ring are dragged onto it (bosses hold their ground).
export function orbitalVortex(game, dt, b, cx, cy, radius) {
  if (!has(b, 'vortex')) return;
  const pull = W.vortexPull * dt;
  for (const e of game.enemyManager.enemies) {
    if (e.dead || e.isBoss) continue;
    const dx = e.x - cx, dy = e.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const off = d - radius;
    if (Math.abs(off) > W.vortexBand || Math.abs(off) < 2) continue;
    const k = Math.min(Math.abs(off), pull * (e.isLieutenant ? 0.4 : 1)) * Math.sign(off);
    // Onto the ring, with a little swirl along it so the pull reads as a vortex.
    e.x -= (dx / d) * k - (dy / d) * k * 0.4;
    e.y -= (dy / d) * k + (dx / d) * k * 0.4;
  }
  game.vortexFxT = (game.vortexFxT || 0) - dt;
  if (game.vortexFxT <= 0) {
    game.vortexFxT = 0.4;
    game.particles.spawnShockwave(cx, cy, radius + W.vortexBand * 0.6, 150, 1, 0.35, true);
  }
}
