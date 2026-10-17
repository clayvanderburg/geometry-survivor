import test from 'node:test';
import assert from 'node:assert/strict';

// Browser services are stubbed, as in gameplay.test.js; the radar toggle runs the real Game method.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game, radarSize } = await import('../js/main.js');

test('the sector radar is 2.5x its old 152 px, capped to 55% of the short screen side', () => {
  assert.equal(radarSize(1920, 1080), 380);
  assert.equal(radarSize(1280, 720), 380);
  assert.equal(radarSize(1366, 600), 330);
  assert.equal(radarSize(390, 844), 215, 'phones keep the radar inside the screen');
});

test('[R] / controller Back toggles the radar and the choice persists', () => {
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const g = Object.assign(Object.create(Game.prototype), { radarVisible: true });
    g.toggleRadar();
    assert.equal(g.radarVisible, false);
    assert.equal(store.get('vexolith_radar'), '0');
    g.toggleRadar();
    assert.equal(g.radarVisible, true);
    assert.equal(store.get('vexolith_radar'), '1');
    // Blocked storage never breaks the toggle.
    globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    assert.doesNotThrow(() => g.toggleRadar());
    assert.equal(g.radarVisible, false);
  } finally {
    globalThis.localStorage = saved;
  }
});
