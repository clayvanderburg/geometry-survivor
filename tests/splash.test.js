// SPLASH screen (js/splash.js + Game wiring in js/main.js): shows on every load, any input continues to
// the title (never launches), and only the browser boot shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { SplashScreen } = await import('../js/splash.js');
const { Game } = await import('../js/main.js');
const { PAD } = await import('../js/gamepad.js');

const root = new URL('../', import.meta.url);
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

test('Game: the splash covers the title; a key, a click or a controller button continues to the title only', () => {
  for (const how of ['key', 'click', 'pad']) {
    const el = installDom();
    let audio = 0;
    const game = Object.assign(Object.create(Game.prototype), {
      state: 'TITLE', menuNav: { clear() {} }, resetInput() {}, sound: { init() { audio++; } }
    });
    game.splash = new SplashScreen({ onDismiss: () => game.onSplashDismissed() });
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
  }
});

test('the splash shows on every load: nothing is remembered between page loads', () => {
  for (let load = 0; load < 3; load++) {
    const el = installDom();
    const game = Object.assign(Object.create(Game.prototype), { state: 'TITLE', menuNav: { clear() {} }, resetInput() {}, sound: { init() {} } });
    game.splash = new SplashScreen({ onDismiss: () => game.onSplashDismissed() });
    game.showSplash();
    assert.equal(game.splashOpen, true, `load ${load + 1}`);
    el.listeners.click();
    assert.equal(game.splashOpen, false);
  }
});

test('the splash only shows over the title screen', () => {
  installDom();
  const game = Object.assign(Object.create(Game.prototype), { state: 'PLAYING', resetInput() {} });
  game.splash = new SplashScreen();
  game.showSplash();
  assert.equal(!!game.splashOpen, false);
});

test('the page has the splash art and the browser boot shows it', () => {
  assert.ok(existsSync(new URL('assets/splash.webp', root)));
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /id="splash-screen"[\s\S]*?src="assets\/splash\.webp"/);
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  assert.match(main, /new Game\(\)\.enableFirstLaunchTutorial\(\)\.enableStartPick\(\)\.showSplash\(\)/);
});
