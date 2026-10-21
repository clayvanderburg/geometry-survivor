// FINAL STAND: how the campaign ends. Wave CAMPAIGN_WAVES (50) has no timer. The final boss arrives with one
// last surge of packs, then regular spawning stops. Kill the boss, clear every hostile, and the sector goes
// quiet (SECTOR CLEAR: the music drops out under a bass hit) before the VICTORY screen (js/victory.js) opens.
// Stragglers that keep their distance are drawn in toward the ship after STRAGGLER_PULL_AFTER s, and the few
// that still survive are wrecked after STRAGGLER_WRECK_AFTER s, so the ending can never stall.
// CONTINUE FOR HIGH SCORE resumes at wave 51 with spawning back on.
//
// State lives on game.finalStand: null outside the stand, else
//   { phase: 'fight' | 'sweep' | 'clear', surgeLeft, surgeCd, bossSeen, sweepTime, pulling }.
// Game wires it in with a few lines (update(): holdsWave / tickFinalStand / blocksSpawning / music).
import { CAMPAIGN_WAVES } from './wave-plan.js';
import { VICTORY_DELAY } from './victory.js';
import { awardWaveBonus } from './score-bonus.js';

export const FINAL_STAND = Object.freeze({
  surgePacks: 8,            // extra packs the boss arrives with (on top of the wave's usual opening)
  surgeSpacing: 0.45,       // s between surge packs (the pack cap still applies to each)
  pullAfter: 35,            // s after the boss falls before stragglers are drawn in
  pullSpeed: 260,           // px/s the pull adds toward the ship
  pullRange: 360,           // stragglers closer than this are left to fight normally
  wreckAfter: 90,           // s after the boss falls: anything still alive is wrecked
  clearBeat: VICTORY_DELAY  // s of SECTOR CLEAR silence before the VICTORY screen
});

const active = (game) => !game.range?.active && !game.campaignWon;

// Is the run standing on the final wave (no wave timer, no regular spawns)?
export function holdsWave(game) {
  return active(game) && game.wave === CAMPAIGN_WAVES;
}

// Regular pack spawning (and lieutenants) are off for the whole stand; the surge comes from tickFinalStand.
export function blocksSpawning(game) {
  return !!game.finalStand && holdsWave(game);
}

export function resetFinalStand(game) {
  game.finalStand = null;
}

// The final boss died (Game.onBossDefeated): start the sweep at once.
export function finalBossDown(game) {
  const fs = game.finalStand;
  if (!fs || fs.phase !== 'fight') return;
  fs.bossSeen = true;
  startSweep(game, fs);
}

function startSweep(game, fs) {
  fs.phase = 'sweep';
  fs.sweepTime = 0;
  fs.surgeLeft = 0;
  const left = hostilesLeft(game);
  if (left > 0) game.showBanner?.(`◎ FINAL STAND // CLEAR THE SECTOR // ${left} HOSTILE${left === 1 ? '' : 'S'} LEFT`);
}

export function hostilesLeft(game) {
  const em = game.enemyManager;
  let n = em.spawnIndicators.length + (game.pendingBossSpawns?.length || 0);
  for (const e of em.enemies) if (!e.dead) n++;
  return n;
}

// Called every play tick. Returns true when the stand is in its SECTOR CLEAR beat.
export function tickFinalStand(game, dt) {
  if (!holdsWave(game)) {
    game.finalStand = null;
    return false;
  }
  let fs = game.finalStand;
  if (!fs) {
    fs = game.finalStand = { phase: 'fight', surgeLeft: FINAL_STAND.surgePacks, surgeCd: 0, bossSeen: false, sweepTime: 0, pulling: false };
    game.showBanner?.('☠ WAVE 50 // FINAL STAND // NO TIMER // CLEAR THE SECTOR');
  }
  if (fs.phase === 'fight') {
    if (fs.surgeLeft > 0 && (fs.surgeCd -= dt) <= 0) {
      game.spawnWavePack();
      fs.surgeLeft--;
      fs.surgeCd = FINAL_STAND.surgeSpacing;
    }
    // The boss counts as down once it has been on the field (or warning in) and no longer is: covers a
    // placeholder boss that isCampaignWin does not recognise.
    const fighting = game.bossWaveFightActive();
    if (fighting) fs.bossSeen = true;
    else if (fs.bossSeen) startSweep(game, fs);
  } else if (fs.phase === 'sweep') {
    fs.sweepTime += dt;
    if (hostilesLeft(game) === 0) {
      if (game.bossCardTimer > 0) return false; // let the BOSS DESTROYED card finish first
      fs.phase = 'clear';
      sectorClear(game);
    } else if (fs.sweepTime >= FINAL_STAND.wreckAfter) {
      wreckStragglers(game);
    } else if (fs.sweepTime >= FINAL_STAND.pullAfter) {
      if (!fs.pulling) {
        fs.pulling = true;
        game.showBanner?.('◎ STRAGGLERS DRAWN IN // FINISH THEM');
      }
      pullStragglers(game, dt);
    }
  }
  return fs.phase === 'clear';
}

// Move far-off hostiles toward the ship (on top of their own steering).
export function pullStragglers(game, dt) {
  const p = game.player;
  if (!p) return;
  for (const e of game.enemyManager.enemies) {
    if (e.dead) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d <= FINAL_STAND.pullRange) continue;
    const step = Math.min(d - FINAL_STAND.pullRange, FINAL_STAND.pullSpeed * dt);
    e.x += (dx / d) * step;
    e.y += (dy / d) * step;
  }
}

// The hard stop: anything left (and anything still warping in) is destroyed.
function wreckStragglers(game) {
  const em = game.enemyManager;
  em.spawnIndicators.length = 0;
  if (game.pendingBossSpawns) game.pendingBossSpawns.length = 0;
  for (const e of [...em.enemies]) {
    if (e.dead) continue;
    game.particles?.spawnExplosionSparks?.(e.x, e.y, 16, e.hue ?? 0, 3, 12, 2);
    e.hp = 0;
    e.lastStat = 'other';
    game.killEnemy(e);
  }
}

// The beat between the last kill and the VICTORY screen: silence, a bass hit, the banner.
function sectorClear(game) {
  game.showBanner?.('★ SECTOR CLEAR ★');
  awardWaveBonus(game, CAMPAIGN_WAVES);
  game.sound?.playSectorClear?.();
  game.addShake?.(10);
  const p = game.player;
  if (p) {
    game.particles?.spawnShockwave?.(p.x, p.y, 900, 48, 8, 1.2);
    game.grid?.ripple?.(p.x, p.y, 900, 48, 1.5);
  }
  game.victoryTimer = FINAL_STAND.clearBeat;
}

// The music during the stand's clear beat: dropped out and muffled. null = the normal mix.
export function finalStandMusic(game) {
  return game.finalStand?.phase === 'clear' ? { intensity: 0, muffled: true, boss: 0 } : null;
}
