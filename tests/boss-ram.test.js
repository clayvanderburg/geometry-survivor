import test from 'node:test';
import assert from 'node:assert/strict';

// v0.43.2 difficulty curve: the shared boss RAM (js/boss-ram.js).
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { RAM, bossRam } = await import('../js/boss-ram.js');
const { BOSS_DEFS } = await import('../js/bosses.js');

const env = (player, dt = 1 / 60) => ({ dt, player });

test('bosses without an attack of their own carry a ram; the ones with one do not', () => {
  for (const id of ['brood_queen', 'hive_carrier', 'event_horizon', 'architect', 'progenitor', 'conductor', 'prism']) {
    assert.ok(BOSS_DEFS[id].ram, `${id} rams`);
  }
  for (const id of ['ouroboros', 'wing_commander', 'eclipse_twins']) assert.equal(BOSS_DEFS[id].ram, undefined, `${id} keeps its own attack`);
});

test('a ram braces with a locked lane, then charges down it and goes on cooldown', () => {
  const cfg = { range: 300 };
  const e = { x: 0, y: 0, vx: 1, vy: 0, radius: 30, ramT: 0, speedScale: 1 };
  const far = { x: 600, y: 0 };
  assert.equal(bossRam(e, cfg, env(far)), false, 'out of range: nothing');
  const ship = { x: 200, y: 0 };
  assert.equal(bossRam(e, cfg, env(ship)), true);
  assert.equal(e.ramState, 'brace');
  let ticks = 0;
  while (e.ramState === 'brace' && ticks++ < 200) bossRam(e, cfg, env(ship));
  assert.ok(Math.abs(ticks - RAM.windup * 60) <= 2, 'braces for the windup');
  assert.equal(e.ramState, 'charge');
  assert.equal(e.burstSpeed, RAM.speed);
  // Charges at the ship and overshoots it.
  let x = 0;
  while (e.ramState === 'charge' && ticks++ < 400) {
    bossRam(e, cfg, env(ship));
    x += e.vx;
  }
  assert.ok(x > 200 + RAM.overshoot * 0.8, `charged ${x} px`);
  assert.equal(e.burstSpeed, 0);
  assert.ok(e.ramT > RAM.cooldown * 0.8, 'then cools down');
  assert.equal(bossRam(e, cfg, env(ship)), false);
});

test('a ram waits out emergence and a vetoing phase', () => {
  const ship = { x: 100, y: 0 };
  const emerging = { x: 0, y: 0, vx: 0, vy: 0, ramT: 0, emergeT: 1 };
  assert.equal(bossRam(emerging, {}, env(ship)), false);
  const prism = { x: 0, y: 0, vx: 0, vy: 0, ramT: 0, phase: 2 };
  assert.equal(bossRam(prism, BOSS_DEFS.prism.ram, env(ship)), false, 'no ram during the lighthouse phase');
  prism.phase = 0;
  assert.equal(bossRam(prism, BOSS_DEFS.prism.ram, env(ship)), true);
});
