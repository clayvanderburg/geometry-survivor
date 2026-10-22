// Pool Breakthroughs (EXTRA_TRANSFORMS in weapon-levels.js, docs/BREAKTHROUGH_POOLS.md): the transforms
// added after the original three per weapon. Each hook is a few lines in main.js; the numbers live in
// weapon-scaling.js (W), so the card previews and the potential model read the same values.
//
// Autocannon: Tracer Slugs, Hot Barrel. Rocket Pods: Shrapnel Shells, Rolling Thunder.
// Swarm Missiles: Hunter-Killer, Echo Salvo. Builds carry them in b.tf (makeBuild).
import { WEAPON_SCALING as W } from './weapon-scaling.js';

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

// A shrapnel shard in flight: a spinning, jagged hot-orange fragment on a glowing streak, cooling as it slows.
export function drawShrapnel(ctx, b) {
  const k = Math.max(0, b.life / (b.maxLife || 1));
  const spin = (b.spin = (b.spin || 0) + 0.5);
  const len = 8, wid = 2.4 + 2 * Math.abs(Math.sin(spin));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `hsla(36, 100%, 58%, ${0.45 * k + 0.1})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(b.x - b.vx * 2.2, b.y - b.vy * 2.2);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.translate(b.x, b.y);
  ctx.rotate(spin);
  ctx.fillStyle = `hsla(${30 + 20 * k}, 100%, ${62 + 22 * k}%, 0.95)`;
  ctx.strokeStyle = 'hsla(22, 100%, 55%, 0.9)';
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
