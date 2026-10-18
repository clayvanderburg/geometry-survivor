import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { stickVector, isTouchDevice, stripKeyHints, STICK_RADIUS } = await import('../js/touch-controls.js');
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
  assert.equal(viewScale(844, 390, 857), 390 / 857, 'touch play zooms out a further 30%');
});

test('touch play drops keyboard hints and keeps the words', () => {
  assert.equal(stripKeyHints('LAUNCH INTO THE SECTOR [SPACE / CLICK]'), 'LAUNCH INTO THE SECTOR');
  assert.equal(stripKeyHints('▶ RESUME [P / ESC]'), '▶ RESUME');
  assert.equal(stripKeyHints('📖 FIELD GUIDE [G]'), '📖 FIELD GUIDE');
  assert.equal(stripKeyHints('🛰 SECTOR RADAR: ON [R]'), '🛰 SECTOR RADAR: ON');
  assert.equal(stripKeyHints('CANCEL [ESC]'), 'CANCEL');
  assert.equal(stripKeyHints('lock [Shift+1-4] / Y'), 'lock / Y');
  assert.equal(stripKeyHints('[1]'), '');
  assert.equal(stripKeyHints('Autocannon LV 3 [beta]'), 'Autocannon LV 3 [beta]', 'only key-shaped brackets go');
});

test('touch play shrinks the radar to leave the thumbs room', () => {
  assert.equal(radarSize(1298, 600), 330);
  assert.equal(radarSize(1298, 600, 0.36), 216);
});

test('fullscreen is offered where it works, never on iPhone or iPad', async () => {
  const { fullscreenUsable } = await import('../js/main.js');
  const doc = { fullscreenEnabled: true };
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', maxTouchPoints: 5 }), true);
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 }), true);
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 0 }), true, 'a Mac keeps it');
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 1 }), false, 'iPad Safari (desktop UA, any touch)');
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', maxTouchPoints: 5 }), false);
  assert.equal(fullscreenUsable(doc, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 }), false);
  assert.equal(fullscreenUsable({}, { userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 }), false, 'no API, no button');
});
