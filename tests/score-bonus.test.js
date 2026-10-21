import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVE_BONUS_PER_W2, VICTORY_BONUS, waveBonus, waveBonusTotal, resetScoreBonus, awardWaveBonus, awardVictoryBonus, scoreBreakdown } from '../js/score-bonus.js';

const game = () => { const g = { score: 0 }; resetScoreBonus(g); return g; };

test('the wave bonus grows with the wave and is paid once per wave', () => {
  assert.equal(waveBonus(10), 100_000);
  assert.equal(waveBonus(50), 2_500_000);
  assert.ok(waveBonus(60) > waveBonus(50), 'Endless waves keep paying more');
  let sum = 0;
  for (let w = 1; w <= 50; w++) sum += waveBonus(w);
  assert.equal(waveBonusTotal(50), sum);
  const g = game();
  assert.equal(awardWaveBonus(g, 1), WAVE_BONUS_PER_W2);
  assert.equal(awardWaveBonus(g, 1), 0, 'once per wave');
  awardWaveBonus(g, 2);
  assert.equal(g.score, waveBonusTotal(2));
  assert.equal(g.waveBonus, waveBonusTotal(2));
  assert.equal(awardWaveBonus({ ...game(), range: { active: true } }, 5), 0, 'the Weapon Range pays nothing');
});

test('the victory bonus is paid once and shows in the breakdown', () => {
  const g = game();
  g.score = 5_000_000;
  awardWaveBonus(g, 1);
  assert.equal(awardVictoryBonus(g), VICTORY_BONUS);
  assert.equal(awardVictoryBonus(g), 0);
  assert.equal(g.score, 5_000_000 + 1000 + VICTORY_BONUS);
  assert.equal(scoreBreakdown(g), `5,000,000 combat + 1,000 waves + ${VICTORY_BONUS.toLocaleString()} victory`);
  assert.equal(scoreBreakdown({ score: 10 }), '', 'no bonus, no breakdown');
});

test('sized on the live board: a campaign win beats non-winning runs of similar skill', () => {
  // Real runs (vexolith.netlify.app/api/scores?version=all, 2026-10-20): score, wave, multiplier.
  const win = { score: 107_966_306, wave: 59, mult: 49.8 };   // the W59 campaign win (0.43.0)
  const losses = [
    { score: 121_357_882, wave: 33, mult: 96.9 },  // outscored the win before this change
    { score: 124_072_315, wave: 48, mult: 58.8 },
    { score: 53_908_427, wave: 28, mult: 69.8 }
  ];
  const withBonus = (r, won) => r.score + waveBonusTotal(r.wave - 1) + (won ? VICTORY_BONUS : 0);
  for (const r of losses) {
    assert.ok(withBonus(win, true) > 1.5 * withBonus(r, false), `the win clearly beats W${r.wave} at x${r.mult}`);
  }
  // No-hit play still matters: the bonuses are flat, so at equal progress the kill score decides, and a
  // much cleaner run (x838 multiplier) still outscores a scrappy win.
  assert.ok(withBonus({ score: 892_160_264, wave: 42 }, false) > withBonus(win, true));
  assert.ok(waveBonusTotal(26) < 0.5 * 18_619_676, 'a median run (W27, 18.6M) gains well under half its score');
});
