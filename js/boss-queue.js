// Boss queue: bosses from different boss waves never fight you at once. Waves keep advancing on their timer,
// but a scheduled boss (Game.pendingBossSpawns) WAITS while a boss from an earlier boss wave is still alive
// or warping in: a banner names the one to beat first. When it falls, "NEXT BOSS INBOUND" and the waiting
// boss's usual warning plays. If the old one is still alive after BOSS_QUEUE.maxWait s, it RETREATS through a
// rift (no rewards, its escorts and plates go with it) and the new boss comes in, so nobody can stall a run.
// Bosses scheduled for the same wave (the endless combos past wave 50) still arrive together.
//
// Game calls tickBossQueue(game, dt) before admitting pending bosses: false means hold the queue.
import { warpGroup } from './boss-warp.js';
import { BOSS_DEFS } from './bosses.js';

export const BOSS_QUEUE = Object.freeze({
  maxWait: 60 // s a boss waits on an older one before the older one retreats
});

const nameOf = (id) => BOSS_DEFS[id]?.name || 'THE NEXT BOSS';

// Bosses from a boss wave before `wave` that are still on the field: live hulls (each piece of a split
// boss counts), and ones still materializing. Mounted parts and serpent plates go with their boss.
export function olderBosses(game, wave) {
  const em = game.enemyManager;
  const live = em.enemies.filter((e) => e.isBoss && !e.dead && !e.discarded && !e.mount && !e.leader && (e.bossWave ?? wave) < wave);
  const arriving = em.spawnIndicators.filter((sp) => sp.config?.isBoss && (sp.config.bossWave ?? wave) < wave);
  return { live, arriving };
}

// Returns true when the head of the pending queue may be admitted now.
export function tickBossQueue(game, dt) {
  const next = game.pendingBossSpawns?.[0];
  if (!next) {
    game.bossHold = null;
    return true;
  }
  const { live, arriving } = olderBosses(game, next.wave);
  if (!live.length && !arriving.length) {
    if (game.bossHold) game.showBanner?.(`⚠ NEXT BOSS INBOUND // ${nameOf(next.id)}`);
    game.bossHold = null;
    return true;
  }
  let hold = game.bossHold;
  if (!hold || hold.wave !== next.wave) {
    hold = game.bossHold = { wave: next.wave, t: 0 };
    const old = live[0]?.name || arriving[0]?.config?.name || 'THE LAST BOSS';
    game.showBanner?.(`⚠ ${nameOf(next.id)} WAITS // BEAT ${old} FIRST`);
  }
  hold.t += dt;
  if (hold.t >= BOSS_QUEUE.maxWait) retreat(game, live, arriving);
  return false;
}

// The old boss gives up the field: it folds into a rift and is gone (no kill, no score, no cache).
export function retreat(game, live, arriving) {
  const em = game.enemyManager;
  for (const sp of arriving) {
    const i = em.spawnIndicators.indexOf(sp);
    if (i !== -1) em.spawnIndicators.splice(i, 1);
  }
  const names = new Set();
  for (const boss of live) {
    names.add(boss.name);
    for (const o of warpGroup(boss, em.enemies)) {
      game.particles?.spawnShockwave?.(o.x, o.y, o.radius * 4, o.hue ?? 48, 4, 0.45, true); // folding inward
      em.discard(o);
    }
    game.particles?.spawnFlash?.(boss.x, boss.y, boss.radius * 5, boss.hue ?? 48, 0.35);
    game.particles?.spawnExplosionSparks?.(boss.x, boss.y, 30, boss.hue ?? 48, 2, 12, 2.4);
    game.grid?.applyImplosion?.(boss.x, boss.y, 2.5, boss.radius * 8, boss.hue ?? 48, 0.5);
  }
  game.sound?.playRiftClose?.();
  if (names.size) game.showBanner?.(`◎ ${[...names].join(' & ')} RETREATS`);
}
