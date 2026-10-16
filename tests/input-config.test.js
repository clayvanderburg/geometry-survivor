import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
const windowEvents = new Map();
const documentEvents = new Map();
const elements = new Map();
function element() {
  const classes = new Set(['hidden']);
  return { value: '', textContent: '', addEventListener() {}, classList: {
    add: value => classes.add(value), remove: value => classes.delete(value),
    contains: value => classes.has(value), toggle() {}
  }};
}
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const channels = [];
globalThis.BroadcastChannel = class { constructor() { channels.push(this); } addEventListener(type, callback) { this.callback = callback; } postMessage() {} };
globalThis.window = { addEventListener: (type, callback) => windowEvents.set(type, callback) };
globalThis.document = { activeElement: null, hidden: false,
  getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  querySelectorAll: () => [], addEventListener: (type, callback) => documentEvents.set(type, callback)
};
const config = await import('../js/config.js');
const { ProgressionManager, normalizeSave } = await import('../js/progression.js');
const { Game } = await import('../js/main.js');

function inputGame() {
  const game = Object.create(Game.prototype);
  Object.assign(game, { state: 'PLAYING', keys: {}, mouse: { down: true },
    sound: { init() {}, setMusicState() {}, intensity: 0.5, masterVolumePct: 100 },
    progression: { data: { pilotName: 'CLAY' } }, frameClock: { reset() {} }
  });
  return game;
}

test('pause clears object-backed input and displays/resumes modal', () => {
  const game = inputGame(); game.keys.KeyW = true;
  game.togglePause();
  assert.equal(game.state, 'PAUSED'); assert.deepEqual(game.keys, {}); assert.equal(game.mouse.down, false);
  assert.equal(document.getElementById('pause-modal').classList.contains('hidden'), false);
  game.togglePause(); assert.equal(game.state, 'PLAYING');
  assert.equal(document.getElementById('pause-modal').classList.contains('hidden'), true);
});

test('keyboard discrete actions ignore repeat; sliders retain gameplay shortcuts', () => {
  const game = inputGame(); let bombs = 0; game.triggerSupernova = () => bombs++;
  game.bindEvents(); document.activeElement = { tagName: 'INPUT', type: 'range' };
  const press = windowEvents.get('keydown');
  press({ code: 'KeyE', repeat: false }); press({ code: 'KeyE', repeat: true }); assert.equal(bombs, 1);
  press({ code: 'KeyW', repeat: false }); assert.equal(game.keys.KeyW, true);
  document.activeElement = { tagName: 'INPUT', type: 'text' };
  press({ code: 'KeyE', repeat: false }); assert.equal(bombs, 1);
  document.activeElement = null;
});

test('focus loss releases controls and pauses active run', () => {
  const game = inputGame(); game.bindEvents(); game.keys.KeyW = true;
  windowEvents.get('blur')(); assert.equal(game.state, 'PAUSED'); assert.deepEqual(game.keys, {});
});

test('gamepad selects connected pad in a later slot', () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [null,
    { connected: true, axes: [0.3, 0, 0, 0], buttons: [] }] } });
  assert.equal(inputGame().pollGamepad().moveX, 0.3);
});

test('tuning rejects poison values and clamps persisted schema bounds', () => {
  assert.equal(config.normalizeTuningValue('musicBpm', Infinity), config.DEFAULT_TUNING.musicBpm);
  assert.equal(config.normalizeTuningValue('moveSpeed', -100), 2);
  assert.equal(config.normalizeTuningValue('carapaceColor', '<bad>'), config.DEFAULT_TUNING.carapaceColor);
  storage.set('vectra_survivor_tuning_v3', JSON.stringify({ moveSpeed: 999, baseDamage: 'oops', evil: true }));
  config.loadTuning(); assert.equal(config.TUNING.moveSpeed, 14); assert.equal(config.TUNING.baseDamage, 11);
  assert.equal(config.TUNING.evil, undefined);
  storage.delete('vectra_survivor_tuning_v3'); config.loadTuning(); assert.equal(config.TUNING.moveSpeed, 5);
});

test('save normalization tolerates malformed entries and bounds permanent ranks', () => {
  const save = normalizeSave({ pilotName: 4, cores: 'bad', ranks: { damage: 500, haste: -5 },
    highscores: [null, {}, { score: 42, name: ' Clay ', wave: -2, multiplier: Infinity }] });
  assert.equal(save.pilotName, 'MADKING'); assert.equal(save.cores, 15);
  assert.equal(save.ranks.damage, 8); assert.equal(save.ranks.haste, 0);
  assert.equal(save.highscores.length, 1); assert.equal(save.highscores[0].wave, 1);
  assert.equal(save.highscores[0].name, 'CLAY');
  storage.set('vectra_survivor_save_v2', 'null'); assert.doesNotThrow(() => new ProgressionManager());
});

test('broadcast tuning uses the same validation as storage', () => {
  channels[0].callback({ data: { type: 'TUNING_UPDATED', tuning: { moveSpeed: -99, musicBpm: Infinity, unknown: 123 } } });
  assert.equal(config.TUNING.moveSpeed, 2);
  assert.equal(config.TUNING.musicBpm, config.DEFAULT_TUNING.musicBpm);
  assert.equal(config.TUNING.unknown, undefined);
});
