import test from 'node:test';
import assert from 'node:assert/strict';
import { DeathSequence, DEATH_TIMING, DEATH_HEADLINES, DEATH_QUIPS, pickHeadline, pickQuip } from '../js/death-sequence.js';

const ship = () => ({ x: 100, y: 100, vx: 0, vy: 0, radius: 15, angle: 0, hullAngle: 0, invuln: 0, stats: { drillScale: 1 } });
const fx = () => {
  const log = { shake: 0, flash: 0, sparks: 0 };
  return {
    log,
    particles: { spawnFlash() {}, spawnShockwave() {}, spawnExplosionSparks() { log.sparks++; } },
    grid: { applyImpulse() {}, ripple() {} },
    sound: { playExplosion() {} },
    addShake(a) { log.shake = Math.max(log.shake, a); },
    flash() { log.flash++; }
  };
};
const ctxProxy = (onSave) => new Proxy({}, { get(_, k) {
  if (k === 'save') return () => onSave(1);
  if (k === 'restore') return () => onSave(-1);
  if (k === 'measureText') return () => ({ width: 300 });
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
  return () => {};
}, set() { return true; } });

test('headline and quip pools are well formed and every pick comes from them', () => {
  for (const [kicker, word, weight] of DEATH_HEADLINES) assert.ok(kicker && word && weight > 0);
  assert.deepEqual(pickHeadline(() => 0), ['YOU GOT', 'FRAGGED']);
  for (let i = 0; i < 50; i++) {
    const r = () => (i + 0.5) / 50;
    assert.ok(DEATH_HEADLINES.some(([k, w]) => pickHeadline(r)[0] === k && pickHeadline(r)[1] === w));
    assert.ok(DEATH_QUIPS.includes(pickQuip(r)));
  }
  assert.ok(DEATH_QUIPS.includes(pickQuip(() => 0.999999)));
});

test('the sequence detonates once, then finishes exactly once at reveal time', () => {
  const seq = new DeathSequence(ship(), { killer: 'BRUISER' });
  const game = fx();
  let finished = 0;
  for (let t = 0; t < DEATH_TIMING.reveal + 1; t += 1 / 60) if (seq.update(1 / 60, game)) finished++;
  assert.equal(finished, 1);
  assert.ok(seq.detonated && seq.landed && seq.done);
  assert.equal(game.log.flash, 1);
  assert.ok(game.log.shake >= 14);
  assert.equal(seq.fragments.length, 16);
});

test('skipping waits for the blast window, then jumps to the reveal', () => {
  const seq = new DeathSequence(ship());
  const game = fx();
  seq.update(0.1, game);
  assert.equal(seq.skip(), false, 'too early: a held input must not eat the sequence');
  for (let i = 0; i < 40; i++) seq.update(1 / 60, game);
  assert.equal(seq.skip(), true);
  assert.ok(seq.done);
});

test('world and overlay drawing balance save/restore through the whole timeline', () => {
  const seq = new DeathSequence(ship(), { killer: 'GUNNER' });
  const game = fx();
  let depth = 0;
  const ctx = ctxProxy((d) => { depth += d; assert.ok(depth >= 0); });
  for (let t = 0; t < DEATH_TIMING.reveal; t += 0.1) {
    seq.update(0.1, game);
    seq.drawWorld(ctx, {});
    seq.drawOverlay(ctx, 390, 760, null, 1, true);
  }
  assert.equal(depth, 0);
});
