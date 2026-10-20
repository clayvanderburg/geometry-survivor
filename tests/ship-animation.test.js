import test from 'node:test';
import assert from 'node:assert/strict';
import { updateShipAnimation, kickShipRecoil, drawShipWake } from '../js/ship-renderer.js';

const ship = () => ({ x: 0, y: 0, vx: 5, vy: 0, radius: 15, hullAngle: 0, stats: { moveSpeed: 5 } });

test('engine wake follows the tail, stays capped and fades out when the ship stops', () => {
  const p = ship();
  for (let i = 0; i < 120; i++) { p.x += p.vx; updateShipAnimation(p, 1 / 60); }
  assert.ok(p.throttle > 0.9);
  assert.ok(p.wake.length > 2 && p.wake.length <= 22);
  assert.ok(p.wake[0].x < p.x, 'newest wake point sits behind the ship');
  p.vx = 0;
  for (let i = 0; i < 60; i++) updateShipAnimation(p, 1 / 60);
  assert.equal(p.wake.length, 0);
});

test('banking follows the turn direction and recoil decays', () => {
  const p = ship();
  updateShipAnimation(p, 1 / 60);
  for (let i = 0; i < 10; i++) { p.hullAngle += 0.1; updateShipAnimation(p, 1 / 60); }
  assert.ok(p.bank > 0.3);
  for (let i = 0; i < 10; i++) { p.hullAngle -= 0.1; updateShipAnimation(p, 1 / 60); }
  assert.ok(p.bank < -0.3);
  kickShipRecoil(p);
  assert.equal(p.recoil, 1);
  for (let i = 0; i < 10; i++) updateShipAnimation(p, 1 / 60);
  assert.equal(p.recoil, 0);
});

test('wake drawing balances save/restore and skips a ship with no wake', () => {
  let depth = 0;
  const ctx = new Proxy({}, { get(_, k) {
    if (k === 'save') return () => depth++;
    if (k === 'restore') return () => { assert.ok(depth > 0); depth--; };
    return () => {};
  }, set() { return true; } });
  const p = ship();
  drawShipWake(ctx, p, {});
  for (let i = 0; i < 20; i++) { p.x += p.vx; updateShipAnimation(p, 1 / 60); }
  drawShipWake(ctx, p, {});
  assert.equal(depth, 0);
});
