import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { stickVector, isTouchDevice, STICK_RADIUS } = await import('../js/touch-controls.js');
const { viewScale, radarSize } = await import('../js/main.js');

test('a stick reads 0 in its deadzone, full past its ring, and keeps its direction', () => {
  assert.deepEqual(stickVector(100, 100, 100, 100), { x: 0, y: 0, knobX: 0, knobY: 0 });
  const tiny = stickVector(100, 100, 104, 100);
  assert.equal(tiny.x, 0, 'a resting thumb does not drift the ship');
  const full = stickVector(100, 100, 100 + STICK_RADIUS * 3, 100);
  assert.equal(full.x, 1);
  assert.equal(full.knobX, STICK_RADIUS, 'the knob stays on the ring');
  const half = stickVector(0, 0, 0, -STICK_RADIUS * 0.6);
  assert.ok(half.y < 0 && half.y > -1 && half.x === 0);
  const diag = stickVector(0, 0, 300, 300);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9, 'diagonals are not faster');
});

test('touch devices are the ones whose main pointer is coarse', () => {
  assert.equal(isTouchDevice({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isTouchDevice({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isTouchDevice({}), false);
});

test('small screens zoom out to a 600 px short side; bigger ones are untouched', () => {
  assert.equal(viewScale(1920, 1080), 1);
  assert.equal(viewScale(1366, 600), 1);
  assert.equal(viewScale(844, 390), 0.65);
  assert.equal(viewScale(390, 844), 0.65, 'portrait too');
  assert.equal(viewScale(0, 0), 1);
});

test('touch play shrinks the radar to leave the thumbs room', () => {
  assert.equal(radarSize(1298, 600), 330);
  assert.equal(radarSize(1298, 600, 0.36), 216);
});
