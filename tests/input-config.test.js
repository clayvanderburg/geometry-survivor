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
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
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
  storage.set('vexolith_tuning_overrides_v4', JSON.stringify({ moveSpeed: 999, baseDamage: 'oops', evil: true }));
  config.loadTuning(); assert.equal(config.TUNING.moveSpeed, 14); assert.equal(config.TUNING.baseDamage, 11);
  assert.equal(config.TUNING.evil, undefined);
  storage.delete('vexolith_tuning_overrides_v4'); config.loadTuning(); assert.equal(config.TUNING.moveSpeed, 5);
});

test('saved tuning holds only changed values, so new balance defaults reach every player', () => {
  storage.delete('vexolith_tuning_overrides_v4');
  config.resetTuningToDefaults();
  assert.equal(storage.get('vexolith_tuning_overrides_v4'), '{}', 'nothing changed, nothing saved');
  config.updateTuningKey('musicVolume', 0.9); // the pause-menu volume slider
  assert.deepEqual(JSON.parse(storage.get('vexolith_tuning_overrides_v4')), { musicVolume: 0.9 }, 'a volume change saves only the volume');
  config.resetTuningToDefaults();
});

test('an old full-snapshot save keeps only the volume, so stale balance values stop blocking global scores', () => {
  storage.delete('vexolith_tuning_overrides_v4');
  // Pre-0.12.2 saves were full snapshots: every value as it was back then (here two stale balance values).
  const stale = { ...config.DEFAULT_TUNING, moveSpeed: 7, singularityPullFalloff: 1, musicVolume: 0.25, sfxVolume: 0.6 };
  storage.set('vectra_survivor_tuning_v3', JSON.stringify(stale));
  config.loadTuning();
  assert.equal(config.TUNING.musicVolume, 0.25);
  assert.equal(config.TUNING.sfxVolume, 0.6);
  assert.equal(config.TUNING.moveSpeed, config.DEFAULT_TUNING.moveSpeed, 'stale balance values are dropped');
  assert.equal(config.TUNING.singularityPullFalloff, config.DEFAULT_TUNING.singularityPullFalloff);
  const modified = Object.keys(config.DEFAULT_TUNING).filter(k => !config.PLAYER_SETTING_KEYS.includes(k) && config.TUNING[k] !== config.DEFAULT_TUNING[k]);
  assert.deepEqual(modified, [], 'no balance key differs, so runs are not flagged as dev-tuned');
  assert.equal(storage.has('vectra_survivor_tuning_v3'), false, 'the old snapshot is removed');
  assert.deepEqual(JSON.parse(storage.get('vexolith_tuning_overrides_v4')), { musicVolume: 0.25, sfxVolume: 0.6 });
  config.resetTuningToDefaults();
});

test('save normalization tolerates malformed entries and bounds permanent ranks', () => {
  const save = normalizeSave({ armory: 2, pilotName: 4, cores: 'bad', ranks: { damage: 500, fireRate: -5, haste: 3 },
    highscores: [null, {}, { score: 42, name: ' Clay ', wave: -2, multiplier: Infinity }] });
  assert.equal(save.pilotName, 'MADKING'); assert.equal(save.cores, 15);
  assert.equal(save.ranks.damage, 40); assert.equal(save.ranks.fireRate, 0);
  assert.equal(save.ranks.haste, undefined, 'retired upgrade ids are dropped');
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
