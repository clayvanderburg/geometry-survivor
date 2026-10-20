// Campaign VICTORY: clearing wave CAMPAIGN_WAVES's FINAL STAND (js/final-stand.js) pauses the run on a gold
// VICTORY screen (#victory-modal) with two ways on: CONTINUE FOR HIGH SCORE (ENDLESS: the run goes on and
// the score keeps counting; past wave 50 bosses come in pairs) or END RUN (finish here; the results read
// VICTORY). A pilot who won and later falls in ENDLESS keeps the win: their results read CAMPAIGN WON.
// Game wires these in with a few lines (state 'VICTORY', game.victoryTimer, game.campaignWon).
import { CAMPAIGN_WAVES, FINAL_BOSS } from './wave-plan.js';
import { bossDef } from './bosses.js';
import { TUNING } from './config.js';

export const ENDLESS_LEAD_IN = 3; // s of calm after CONTINUE before wave 51 (and its packs) arrive

export const VICTORY_DELAY = 2.5;      // s of play between SECTOR CLEAR and the screen
export const VICTORY_KEY_GRACE = 800;  // ms before ENTER counts on the screen (a held key must not skip it)

const el = (id) => globalThis.document?.getElementById(id);

// Does this boss kill win the campaign? Only the final boss of the final wave, once per run, never in the range.
export function isCampaignWin(game, boss) {
  return boss.type === FINAL_BOSS && boss.bossWave === CAMPAIGN_WAVES && !game.campaignWon && !game.range?.active;
}

export function resetVictory(game) {
  game.victoryTimer = 0;
  game.campaignWon = false;
  el('victory-modal')?.classList.add('hidden');
}

// Counts the delay down in play time (the death payoff's hit-stop and level-up screens hold it).
// Returns true on the tick the screen opens.
export function tickVictory(game, dt) {
  if (!(game.victoryTimer > 0)) return false;
  game.victoryTimer -= dt;
  if (game.victoryTimer > 0) return false;
  showVictory(game);
  return game.state === 'VICTORY';
}

export function showVictory(game) {
  game.victoryTimer = 0;
  if (game.state !== 'PLAYING') return;
  game.state = 'VICTORY';
  game.campaignWon = true;
  game.victoryShownAt = Date.now();
  for (const sp of [game.flamethrower, game.cryoSprayer, game.acidSprayer]) if (sp?.firing) sp.silence(game);
  game.sound?.setMusicState?.({ intensity: 0.4, muffled: true, boss: 0 });
  const mins = Math.floor(game.elapsedTime / 60);
  const secs = String(Math.floor(game.elapsedTime % 60)).padStart(2, '0');
  const sub = el('victory-subtitle');
  if (sub) sub.textContent = `★ ${bossDef(FINAL_BOSS)?.name ?? 'THE FINAL BOSS'} IS DOWN // WAVE ${CAMPAIGN_WAVES} CLEARED ★`;
  const stats = el('victory-stats');
  if (stats) {
    stats.innerHTML = [
      ['SCORE', game.score.toLocaleString(), 'var(--cyan)'],
      ['TIME', `${mins}:${secs}`, 'var(--emerald)'],
      ['KILLS', game.kills.toLocaleString(), 'var(--magenta)'],
      ['LEVEL', String(game.player?.level ?? 1), 'var(--gold)']
    ].map(([label, val, color]) => `<div class="go-stat-box"><div class="go-stat-label">${label}</div><div class="go-stat-val" style="color:${color}">${val}</div></div>`).join('');
  }
  el('victory-modal')?.classList.remove('hidden');
}

function closeVictory(game) {
  el('victory-modal')?.classList.add('hidden');
  globalThis.document?.activeElement?.blur?.();
  game.state = 'PLAYING';
}

// CONTINUE FOR HIGH SCORE (ENDLESS): the run goes on from where it stood.
export function continueEndless(game) {
  if (game.state !== 'VICTORY') return;
  closeVictory(game);
  // The FINAL STAND stopped spawning: wave 51 (and regular packs) follow after a short lead-in.
  game.waveTimer = Math.max(game.waveTimer || 0, (TUNING.waveLength ?? 22) - ENDLESS_LEAD_IN);
  game.spawnCooldown = Math.max(game.spawnCooldown || 0, ENDLESS_LEAD_IN);
  game.showBanner?.('∞ ENDLESS // BOSSES NOW COME IN PAIRS // HOW FAR CAN YOU GO?');
}

// END RUN: the run ends here and posts like any other, under a VICTORY results screen.
export function endVictoriousRun(game) {
  if (game.state !== 'VICTORY') return;
  closeVictory(game);
  game.triggerGameOver({ victory: true });
}

// Keyboard on the VICTORY screen: ENTER continues after the grace; SPACE (the dash key) never presses a
// button here. Returns true when the key was the screen's.
export function victoryKey(game, e) {
  if (game.state !== 'VICTORY') return false;
  if (e.code === 'Enter' || e.code === 'Space') e.preventDefault();
  if (e.code === 'Enter' && Date.now() - (game.victoryShownAt || 0) > VICTORY_KEY_GRACE) continueEndless(game);
  return true;
}

// The results screen's title and subtitle: VICTORY for a run ended on the VICTORY screen, CAMPAIGN WON for
// one that won and fell later in ENDLESS, SIGNAL LOST otherwise. `label` is a non-NORMAL mode's name.
export function resultsHeadline({ victory, campaignWon, wave, label }) {
  const scope = label ? `${label} ` : '';
  if (victory) return { title: 'VICTORY', subtitle: `★ WAVE ${CAMPAIGN_WAVES} CLEARED // ${scope}CAMPAIGN COMPLETE ★`, won: true };
  if (campaignWon) return { title: 'SIGNAL LOST', subtitle: `★ CAMPAIGN WON ★ // ${scope}ENDLESS ENDED AT WAVE ${wave}`, won: true };
  return { title: 'SIGNAL LOST', subtitle: label ? `SHIELD COLLAPSED // ${label} RUN COMPLETE` : 'SHIELD COLLAPSED // SESSION COMPLETE', won: false };
}
