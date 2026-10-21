// Score bonuses that reward progress. Kill score (enemy score × the multiplier, which hits cut by 25%) rewards
// clean play; on its own it let a careful wave-33 run outscore a wave-59 campaign win. Two flat bonuses,
// not multiplied, so no-hit play still decides who scores more at equal progress:
//   WAVE BONUS     every wave survived pays WAVE_BONUS_PER_W2 × wave² (wave 10: 100k, wave 30: 900k,
//                  wave 50: 2.5M; waves 1-50 total 42.9M), Endless waves included;
//   VICTORY BONUS  winning the campaign (the FINAL STAND cleared, js/final-stand.js) pays VICTORY_BONUS once.
// Sized against the live board (README "Scoring"): a win now beats any non-winning run at a similar multiplier.
// State on the game: waveBonus / victoryBonus (totals for the results screen), bonusWave (last wave paid).

export const WAVE_BONUS_PER_W2 = 1000;
export const VICTORY_BONUS = 100_000_000;

export const waveBonus = (wave) => (wave >= 1 ? WAVE_BONUS_PER_W2 * Math.floor(wave) ** 2 : 0);

// Sum of the wave bonuses for waves 1..n.
export function waveBonusTotal(n) {
  const k = Math.max(0, Math.floor(n));
  return (WAVE_BONUS_PER_W2 * k * (k + 1) * (2 * k + 1)) / 6;
}

export function resetScoreBonus(game) {
  game.waveBonus = 0;
  game.victoryBonus = 0;
  game.bonusWave = 0;
}

// Pays the survival bonus for `wave` (once per wave). Returns the points paid.
export function awardWaveBonus(game, wave) {
  if (game.range?.active || !(wave > (game.bonusWave || 0))) return 0;
  game.bonusWave = wave;
  const pts = waveBonus(wave);
  game.score += pts;
  game.waveBonus = (game.waveBonus || 0) + pts;
  const p = game.player;
  if (p) game.particles?.spawnFloatText?.(p.x, p.y - 46, `+${pts.toLocaleString()} WAVE ${wave} BONUS`, '#7dffb0', 15);
  return pts;
}

// Pays the campaign win once. Returns the points paid.
export function awardVictoryBonus(game) {
  if (game.victoryBonus > 0 || game.range?.active) return 0;
  game.score += VICTORY_BONUS;
  game.victoryBonus = VICTORY_BONUS;
  return VICTORY_BONUS;
}

// One line under FINAL SCORE: where the points came from. '' when no bonus was paid.
export function scoreBreakdown({ score = 0, waveBonus: wb = 0, victoryBonus: vb = 0 }) {
  if (!(wb > 0) && !(vb > 0)) return '';
  const parts = [`${Math.max(0, score - wb - vb).toLocaleString()} combat`, `${wb.toLocaleString()} waves`];
  if (vb > 0) parts.push(`${vb.toLocaleString()} victory`);
  return parts.join(' + ');
}
