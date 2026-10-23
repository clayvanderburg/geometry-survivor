import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Paused behind a modal, the world is drawn once it has settled and that frame is kept
// (Game.holdFrozenFrame), so CSS can blur a still canvas instead of a per-frame backdrop blur.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const classes = new Set();
const body = { classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element, body };
const { Game } = await import('../js/main.js');

function game(state = 'UPGRADE') {
  const g = Object.assign(Object.create(Game.prototype), {
    state, canvas: { width: 1280, height: 720 }, frameSeconds: 1 / 60, shake: 0, chromaFlash: 0, bossFlash: 0,
    hudHidden: false, radarVisible: true, damageNumbers: { count: 0, enabled: true },
    particles: { live: false, idle() { return !this.live; } }, grid: { moving: false, settled() { return !this.moving; } },
    player: { loadout: ['blaster'], level: 3 }, draws: [], frozenKey: null
  });
  g.draw = function () { this.draws.push(this.frameSeconds); };
  return g;
}

test('playing: the loop draws every frame and the world is not frozen', () => {
  const g = game('PLAYING');
  assert.equal(g.holdFrozenFrame(), false);
  assert.equal(classes.has('world-frozen'), false);
  assert.equal(g.draws.length, 0);
});

test('behind a modal: sparks and ripples play out, then one settled frame is kept', () => {
  for (const state of ['UPGRADE', 'PAUSED', 'CHEST']) {
    const g = game(state);
    g.particles.live = true;
    assert.equal(g.holdFrozenFrame(), false, `${state}: still settling, the loop draws`);
    assert.equal(classes.has('world-frozen'), true, 'the CSS blur switches over at once');
    g.particles.live = false;
    g.grid.moving = true;
    assert.equal(g.holdFrozenFrame(), false);
    g.grid.moving = false;
    g.damageNumbers.count = 2;
    assert.equal(g.holdFrozenFrame(), false);
    g.damageNumbers.count = 0;
    g.shake = 3;
    assert.equal(g.holdFrozenFrame(), false);
    g.shake = 0;
    assert.equal(g.holdFrozenFrame(), true);
    assert.deepEqual(g.draws, [1], 'drawn once, with a full clear (no motion trails)');
    assert.equal(g.frameSeconds, 1 / 60, 'frame time restored');
    for (let i = 0; i < 5; i++) assert.equal(g.holdFrozenFrame(), true);
    assert.equal(g.draws.length, 1, 'then kept');
  }
});

test('the kept frame is redrawn when something it shows changes', () => {
  const g = game();
  g.holdFrozenFrame();
  g.hudHidden = true; // [H] in the pause menu
  g.holdFrozenFrame();
  g.damageNumbers.enabled = false;
  g.holdFrozenFrame();
  g.player.loadout = []; // loadout discard
  g.holdFrozenFrame();
  g.canvas.width = 1600;
  g.holdFrozenFrame();
  g.frozenKey = null; // what resize() does: the canvas was cleared
  g.holdFrozenFrame();
  g.holdFrozenFrame();
  assert.equal(g.draws.length, 6);
});

test('a cutscene or any other state keeps drawing live', () => {
  const g = game('UPGRADE');
  g.cutscene = { active: true };
  assert.equal(g.holdFrozenFrame(), false);
  for (const state of ['TITLE', 'GAMEOVER', 'VICTORY', 'CUTSCENE', 'RANGE_EDIT']) {
    const h = game(state);
    assert.equal(h.holdFrozenFrame(), false, state);
    assert.equal(classes.has('world-frozen'), false);
  }
});

test('card glow pulses run on opacity, not box-shadow (compositor only)', () => {
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  for (const name of ['floor-glow', 'breakthrough-pulse', 'new-weapon-pulse']) assert.ok(!css.includes(name), `${name} keyframes are gone`);
  for (const name of ['glow-dim', 'glow-bright', 'glow-fade-out', 'glow-fade-in']) {
    const body = css.match(new RegExp(`@keyframes ${name} \\{([^@]*?)\\}\\s*\\n`))?.[1] || '';
    assert.ok(body.includes('opacity') && !body.includes('box-shadow'), name);
  }
  assert.match(css, /body\.world-frozen[^{]*:is\(#pause-modal, #upgrade-modal, #chest-modal\) \{\s*backdrop-filter: none;/);
});
