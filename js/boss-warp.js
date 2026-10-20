// Boss leash: a boss the pilot has left far behind (beyond bossLeashDist for bossLeashTime) warps back
// in near the ship, the way it first arrived: a boss telegraph and rift open on an on-screen point for
// bossWarpTime, then the boss (with everything chained to it: serpent plates, orbiting escorts, mounted
// bays, wingmen) steps through, and the portal blasts the rock round it. Flying back within reach
// before the rift opens calls it off. Game wires it in with two calls (update after the enemy manager,
// draw after the enemies).
import { TUNING } from './config.js';
import { drawEliteRift } from './lieutenants.js';

const WARP_COOLDOWN = 4; // s after a warp before the same boss can be leashed again
const RECALL = 0.8;      // the pilot coming back within this share of the leash calls a pending warp off
const live = (ref) => (ref && ref.hp !== undefined ? ref : ref?.live || null);

// Every hull that travels with `boss`: the transitive set of hulls chained to it by a serpent plate
// link, an orbit anchor, a mount or a wing slot (bosses own all four kinds).
export function warpGroup(boss, enemies) {
  const group = new Set([boss]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of enemies) {
      if (o.dead || group.has(o)) continue;
      const tie = live(o.leader) || o.anchor || o.mount || live(o.wingLeader);
      if (tie && group.has(tie)) {
        group.add(o);
        grew = true;
      }
    }
  }
  return [...group];
}

// A boss that can be leashed: alive, not a mounted part or a plate.
const leashable = (e) => e.isBoss && !e.dead && !e.mount && !e.leader;

export function updateBossWarps(game, dt) {
  const p = game.player;
  const em = game.enemyManager;
  if (!p || !em || game.range?.active) return;
  const leash = TUNING.bossLeashDist ?? 1500;
  if (!(leash > 0)) return;
  for (const e of em.enemies) {
    if (!leashable(e)) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (e.warpCooldown > 0) e.warpCooldown -= dt;
    if (e.warp) {
      if (d < leash * RECALL) {
        e.warp = null; // the pilot came back: no need
        continue;
      }
      e.warp.timer -= dt;
      if (e.warp.timer <= 0) arrive(game, e);
      continue;
    }
    e.farT = d > leash ? (e.farT || 0) + dt : 0;
    if (e.farT >= (TUNING.bossLeashTime ?? 2.5) && !(e.warpCooldown > 0)) {
      const at = game.eliteSpawnPoint(40, TUNING.bossWarpTime ?? 1.2, { rock: !((TUNING.bossPortalBlast ?? 280) > 0) });
      const time = TUNING.bossWarpTime ?? 1.2;
      e.warp = { x: at.x, y: at.y, timer: time, maxTimer: time, onScreen: true, config: { radius: e.radius, hue: e.hue } };
      e.farT = 0;
      game.sound?.playBossWarning?.();
    }
  }
}

// The rift opens: the boss and its train step through, keeping their shape.
function arrive(game, e) {
  const w = e.warp;
  e.warp = null;
  e.warpCooldown = WARP_COOLDOWN;
  const dx = w.x - e.x;
  const dy = w.y - e.y;
  for (const o of warpGroup(e, game.enemyManager.enemies)) {
    o.x += dx;
    o.y += dy;
  }
  e.vx = 0;
  e.vy = 0;
  const blast = TUNING.bossPortalBlast ?? 280;
  if (blast > 0) game.asteroidManager?.blastRocks?.(e.x, e.y, blast, (rock) => game.onRockShattered?.(rock));
  game.particles?.spawnShockwave?.(e.x, e.y, 420, e.hue, 6, 0.6);
  game.particles?.spawnShockwave?.(e.x, e.y, 240, 48, 4, 0.45);
  game.grid?.applyImpulse?.(e.x, e.y, 90, 420, e.hue);
  game.shake = Math.min(24, Math.max(game.shake || 0, 10 * (TUNING.screenShakeMult ?? 1.0)));
  game.sound?.playBossArrival?.();
}

// Pending warps: the boss's own arrival telegraph (hazard ring + rift) on the point it will step out of.
export function drawBossWarps(ctx, game) {
  const em = game.enemyManager;
  if (!em) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of em.enemies) {
    const w = e.warp;
    if (!w || e.dead) continue;
    const t = Math.max(0, Math.min(1, 1 - w.timer / w.maxTimer));
    if (em.drawBossTelegraph) em.drawBossTelegraph(ctx, w);
    else drawEliteRift(ctx, w, t, e.hue);
  }
  ctx.restore();
}
