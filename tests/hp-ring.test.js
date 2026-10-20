// The post-hit HP ring on tougher hulls stays up while they are damaged (bright just after a hit, then
// dimmer), so a pack worn down by spread fire never looks like it healed when the ring comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { drawArchetypeOverlay, hpRingAlpha } = await import('../js/archetypes.js');

function ringCtx() {
  const calls = { arcs: 0, styles: [] };
  const ctx = new Proxy({ calls }, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'arc') return () => { calls.arcs++; };
      return t[k] ?? (() => {});
    },
    set(t, k, v) { if (k === 'strokeStyle') calls.styles.push(v); t[k] = v; return true; }
  });
  return ctx;
}

test('a damaged splitter keeps its HP ring long after the last hit; a full-health one shows none', () => {
  const e = { type: 'splitter', x: 0, y: 0, hue: 42, hp: 50, maxHp: 100, sinceHit: 30 };
  const ctx = ringCtx();
  drawArchetypeOverlay(ctx, e, 20);
  assert.equal(ctx.calls.arcs, 1, 'ring drawn 30 s after the last hit');
  assert.match(ctx.calls.styles.at(-1), /0\.35\)$/, 'dimmed when not freshly hit');
  assert.ok(Math.abs(hpRingAlpha({ sinceHit: 0 }) - 0.75) < 1e-9, 'bright right after a hit');
  const full = ringCtx();
  drawArchetypeOverlay(full, { ...e, hp: 100 }, 20);
  assert.equal(full.calls.arcs, 0);
});
