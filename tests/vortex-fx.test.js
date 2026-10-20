import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../js/particles.js';

test('infall streams sink into a live well and fly out as sparks when it collapses', () => {
  const ps = new ParticleSystem();
  const well = { x: 500, y: 500, dead: false };
  ps.spawnInfall(well, 180, 348, 20);
  for (let i = 0; i < 5; i++) ps.update(1 / 60, 4200, 4200);
  const alive = ps.infall.length;
  assert.ok(alive > 0);
  for (const f of ps.infall) assert.ok(Math.hypot(f.x - 500, f.y - 500) < 180, 'streams stay inside the pull');
  const sparksBefore = ps.sparks.length;
  well.dead = true;
  ps.update(1 / 60, 4200, 4200);
  assert.equal(ps.infall.length, 0, 'the streams go with their well');
  assert.ok(ps.sparks.length >= sparksBefore + alive - 1, 'and are flung out as sparks');
  const outward = ps.sparks.slice(sparksBefore).filter((s) => (s.x - 500) * s.vx + (s.y - 500) * s.vy > 0);
  assert.ok(outward.length >= (ps.sparks.length - sparksBefore) * 0.9, 'away from the collapsed core');
});
