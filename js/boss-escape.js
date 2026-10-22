// Boss escape: every boss fight has a time limit. BOSS_ESCAPE.time s after a boss arrives it ESCAPES: it folds
// into a rift with everything chained to it (escorts, plates, bays, wingmen) and leaves the fight with no kill,
// no score and no Alien Tech Cache. BOSS_ESCAPE.warnAt s before that, Dr. Pixie and a banner call it out, and
// its boss bar counts down. Bosses still overlap (a slow kill meets the next boss); the clock just stops one
// boss from following you forever. The campaign's final boss (wave 50) never escapes: it must be beaten.
// Endless bosses (past wave 50) escape like the rest.
//
// The clock is per encounter, kept on the boss's root hull (a split Progenitor's pieces and both Eclipse
// Twins share one), and only runs while the game does. Game wires it in with one call per play tick
// (tickBossEscapes) and reads escapeLeft() for the boss bars.
import { warpGroup } from './boss-warp.js';
import { FINAL_BOSS, CAMPAIGN_WAVES } from './wave-plan.js';

export const BOSS_ESCAPE = Object.freeze({
  time: 180,  // s from arrival to escape
  warnAt: 30  // s left when the warning fires and the bar starts counting
});

const rootOf = (e) => e.root || e;

// Does this boss's clock run? Not the campaign's final boss, not in the Weapon Range.
export function canEscape(game, e) {
  if (game.range?.active) return false;
  return !(e.type === FINAL_BOSS && e.bossWave === CAMPAIGN_WAVES);
}

// Seconds until boss hull `e` escapes, or null when it never will.
export function escapeLeft(game, e) {
  if (!e?.isBoss || !canEscape(game, e)) return null;
  const r = rootOf(e);
  return Number.isFinite(r.escapeT) ? Math.max(0, r.escapeT) : BOSS_ESCAPE.time;
}

// The boss hulls on the field, one entry per encounter (root), with every hull that belongs to it.
function encounters(game) {
  const byRoot = new Map();
  for (const e of game.enemyManager.enemies) {
    if (!e.isBoss || e.dead || e.discarded || e.mount || e.leader) continue;
    const r = rootOf(e);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(e);
  }
  return byRoot;
}

export function tickBossEscapes(game, dt) {
  for (const [root, hulls] of encounters(game)) {
    if (!canEscape(game, hulls[0])) continue;
    if (!Number.isFinite(root.escapeT)) root.escapeT = BOSS_ESCAPE.time;
    root.escapeT -= dt;
    if (!root.escapeWarned && root.escapeT <= BOSS_ESCAPE.warnAt) {
      root.escapeWarned = true;
      warn(game, hulls[0]);
    }
    if (root.escapeT <= 0) escape(game, root, hulls);
  }
}

// Boss name for the callouts: the encounter's name (the Eclipse Twins, not just SOL).
function encounterName(e) {
  return e.type === 'eclipse_twins' ? 'THE ECLIPSE TWINS' : e.name || 'THE BOSS';
}

function warn(game, e) {
  const name = encounterName(e);
  game.showBanner?.(`⚠ ${name} IS GETTING AWAY! // KILL IT FOR THE ALIEN TECH CACHE // ${BOSS_ESCAPE.warnAt}s`);
  game.sound?.playBossCue?.('wing_siren');
  const who = name.charAt(0) + name.slice(1).toLowerCase();
  game.say?.('pixie', `${who} is getting away!`, {
    mood: 'oops', cut: true,
    then: [{ who: 'pixie', text: 'Kill it for that Alien Tech Cache!', mood: 'eureka' }]
  });
}

// Off the field at once (no kill path, so no score, drops or cache), so nothing can still hit it this tick.
function remove(em, o) {
  o.dead = true;
  o.discarded = true;
  const i = em.enemies.indexOf(o);
  if (i !== -1) em.enemies.splice(i, 1);
}

// The getaway: every hull of the encounter (and everything chained to it) folds into a rift and is gone.
function escape(game, root, hulls) {
  const em = game.enemyManager;
  for (const boss of hulls) {
    for (const o of warpGroup(boss, em.enemies)) {
      game.particles?.spawnShockwave?.(o.x, o.y, o.radius * 4, o.hue ?? 48, 4, 0.5, true); // folding inward
      remove(em, o);
    }
    game.particles?.spawnFlash?.(boss.x, boss.y, boss.radius * 6, boss.hue ?? 48, 0.4);
    game.particles?.spawnExplosionSparks?.(boss.x, boss.y, 40, boss.hue ?? 48, 2, 14, 2.6);
    game.particles?.spawnShockwave?.(boss.x, boss.y, boss.radius * 9, boss.hue ?? 48, 6, 0.6);
    game.grid?.applyImplosion?.(boss.x, boss.y, 3, boss.radius * 9, boss.hue ?? 48, 0.6);
  }
  game.sound?.playRiftClose?.();
  game.addShake?.(10);
  game.showBanner?.(`◎ ${encounterName(hulls[0])} ESCAPED // NO ALIEN TECH CACHE`);
  game.runStats?.bossEscaped?.(hulls[0].type);
  root.escapeT = 0;
}
