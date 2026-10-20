import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { rockCracks } = await import('../js/asteroids.js');

const rock = (r = 20) => ({
  x: 0, y: 0, radius: r, rotation: 0,
  verts: Array.from({ length: 7 }, (_, i) => ({ x: Math.cos(i) * r, y: Math.sin(i) * r }))
});

test('cracks start at the drill point, stay inside the rock and open in damage order', () => {
  for (let n = 0; n < 50; n++) {
    const a = rock(12 + n);
    const c = rockCracks(a, a.radius * 2, 0); // contact outside the rim is pulled onto it
    assert.ok(Math.hypot(c.ox, c.oy) <= a.radius * 0.9 + 1e-9);
    assert.ok(c.segs.length >= 9);
    for (const s of c.segs) {
      assert.ok(Math.hypot(s.x2, s.y2) <= a.radius * 0.92 + 1e-9, 'inside the outline');
      assert.ok(s.at0 >= 0 && s.at > s.at0 && s.at <= 1, 'opens within the damage range');
    }
    assert.ok(c.segs.some((s) => s.x1 === c.ox && s.y1 === c.oy), 'a branch starts at the contact');
    assert.equal(rockCracks(a, 0, 0), c, 'generated once, then cached');
  }
});

test('a rock with no known contact cracks from its outline', () => {
  const a = rock();
  const c = rockCracks(a, 0, 0);
  assert.equal(c.ox, a.verts[0].x);
  assert.equal(c.oy, a.verts[0].y);
});
