// SPLASH screen (js/splash.js + Game wiring in js/main.js): once per session, any input continues to the
// title (never launches), storage blocked still works, and only the browser boot shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { SPLASH_SEEN_KEY, SplashScreen, readSplashSeen, writeSplashSeen } = await import('../js/splash.js');
const { Game } = await import('../js/main.js');
const { PAD } = await import('../js/gamepad.js');

const root = new URL('../', import.meta.url);
const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const blockedStorage = {
  getItem() { throw new DOMException('Storage unavailable', 'SecurityError'); },
  setItem() { throw new DOMException('Storage unavailable', 'SecurityError'); }
};
function installDom() {
  const classes = new Set(['hidden']);
  const el = {
    listeners: {},
    classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c) },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  };
  globalThis.document = { getElementById: (id) => (id === 'splash-screen' ? el : null), querySelectorAll: () => [], activeElement: null };
  return el;
}

test('the splash shows once per session; dismissing remembers it; blocked storage shows it every load', () => {
  const storage = memoryStorage();
  assert.equal(readSplashSeen(storage), false);
  assert.equal(new SplashScreen({ storage }).shouldShow(), true);
  assert.equal(writeSplashSeen(storage), true);
  assert.equal(storage.map.get(SPLASH_SEEN_KEY), '1');
  assert.equal(new SplashScreen({ storage }).shouldShow(), false);
  assert.equal(readSplashSeen(blockedStorage), false);
  assert.equal(writeSplashSeen(blockedStorage), false);
  assert.equal(new SplashScreen({ storage: blockedStorage }).shouldShow(), true);
});

test('Game: the splash covers the title; a key, a click or a controller button continues to the title only', () => {
  for (const how of ['key', 'click', 'pad']) {
    const el = installDom();
    const storage = memoryStorage();
    let audio = 0;
    const game = Object.assign(Object.create(Game.prototype), {
      state: 'TITLE', menuNav: { clear() {} }, resetInput() {}, sound: { init() { audio++; } }
    });
    game.splash = new SplashScreen({ storage, onDismiss: () => game.onSplashDismissed() });
    assert.equal(game.showSplash(), game);
    assert.equal(game.splashOpen, true);
    assert.equal(el.classList.contains('hidden'), false);

    if (how === 'click') el.listeners.click();
    if (how === 'pad') game.updateMenuController({ pressed: (b) => b === PAD.START }, 0.016);
    if (how === 'key') {
      // Simulate the top of the window keydown handler: the splash swallows the key.
      game.splashOpen && game.splash.dismiss();
    }
    assert.equal(game.splashOpen, false, how);
    assert.equal(game.state, 'TITLE', `${how}: continues to the title, never launches`);
    assert.equal(el.classList.contains('splash-out'), true);
    assert.equal(audio, 1, `${how}: the dismissing gesture starts the audio`);
    assert.equal(game.menuState, null, 'menus get a fresh grace period');
    assert.equal(storage.map.get(SPLASH_SEEN_KEY), '1');
  }
});

test('the splash only shows on the title screen and only once', () => {
  installDom();
  const game = Object.assign(Object.create(Game.prototype), { state: 'PLAYING', resetInput() {} });
  game.splash = new SplashScreen({ storage: memoryStorage() });
  game.showSplash();
  assert.equal(!!game.splashOpen, false);
});

test('the page has the splash art and the browser boot shows it', () => {
  assert.ok(existsSync(new URL('assets/splash.webp', root)));
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /id="splash-screen"[\s\S]*?src="assets\/splash\.webp"/);
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  assert.match(main, /new Game\(\)\.enableFirstLaunchTutorial\(\)\.showSplash\(\)/);
});
