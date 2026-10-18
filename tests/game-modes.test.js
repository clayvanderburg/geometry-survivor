import test from 'node:test';
import assert from 'node:assert/strict';

// Game modes (js/modes.js): HARDCORE's shield rules, BLITZ's TUNING overlay (on for the run, off after),
// NORMAL left untouched, local boards per mode, and the mode carried by the run-stats payload. Runs are
// the real Game on the headless balance harness. Leaderboard routing by mode: tests/leaderboard-modes.test.js.
const saved = new Map();
globalThis.localStorage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => saved.set(k, String(v)), removeItem: (k) => saved.delete(k) };

const h = await import('../tools/balance/harness.mjs');
const { MODES, MODE_IDS, modeRules, normalizeMode, readStoredMode, writeStoredMode, MODE_STORAGE_KEY, cycleMode, modeBonuses } = await import('../js/modes.js');
const { TUNING, DEFAULT_TUNING, baseTuning, updateTuningKey, applyTuningOverlay, clearTuningOverlay } = await import('../js/config.js');
const { UPGRADE_POOL, eligibleUpgrades, rollUpgrades, rollLevelUpHand, applyUpgradeLevels } = await import('../js/upgrades.js');
const { normalizeSave, LOCAL_TOP } = await import('../js/progression.js');
const { buildBoardView } = await import('../js/leaderboard.js');
const { sanitizeRunStats } = await import('../js/stats-rules.js');
const { GAME_VERSION } = await import('../js/version.js');
const { WEAPONS, weaponSlots } = await import('../js/loadout.js');

const DT = 1 / 60;
const ARMORY_RANK = 10;

// A run in `mode` with every Void Armory upgrade at ARMORY_RANK, flying (nothing spawns) for `ticks`.
function run(mode, ticks = 0) {
  const g = h.createHeadlessGame({ metaRank: ARMORY_RANK, mode });
  g.resetRun(g.selectedMode);
  g.state = 'PLAYING';
  g.spawnWavePack = () => {};
  for (let i = 0; i < ticks; i++) g.update(DT);
  return g;
}

const sameAsDefaults = () => Object.keys(DEFAULT_TUNING).filter((k) => TUNING[k] !== DEFAULT_TUNING[k]);

// Shield-raising cards, found by installing every card on a scratch ship (so a new one can't slip by).
function cardsThatRaiseShield() {
  const g = run('normal');
  const fresh = JSON.stringify(g.player);
  return UPGRADE_POOL.filter((u) => {
    const p = JSON.parse(fresh);
    p.hp = 50;
    applyUpgradeLevels(p, { ...u, levelJump: 1 });
    return p.maxHp > 100 + ARMORY_RANK * 4 || p.hp > 50;
  }).map((u) => u.id);
}

test('the mode table: three modes, NORMAL by default, unknown ids fall back to NORMAL', () => {
  assert.deepEqual(MODE_IDS, ['normal', 'hardcore', 'blitz']);
  assert.equal(normalizeMode('bogus'), 'normal');
  assert.equal(normalizeMode(undefined), 'normal');
  assert.equal(modeRules({ mode: 'hardcore' }), MODES.hardcore);
  assert.equal(modeRules('blitz'), MODES.blitz);
  assert.deepEqual(MODES.normal.tuning, {});
  assert.deepEqual(MODES.hardcore.tuning, {});
  for (const key of Object.keys(MODES.blitz.tuning)) assert.ok(key in DEFAULT_TUNING, `blitz overlay key ${key} is a TUNING key`);
  assert.equal(cycleMode('normal', 1), 'hardcore');
  assert.equal(cycleMode('normal', -1), 'blitz');
  assert.equal(modeBonuses({ bonusHp: 40, damageMult: 1.2 }, 'hardcore').bonusHp, 0);
  assert.equal(modeBonuses({ bonusHp: 40, damageMult: 1.2 }, 'hardcore').damageMult, 1.2);
});

test('the title choice is remembered, and blocked storage reads as NORMAL', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readStoredMode(storage), 'normal');
  assert.equal(writeStoredMode(storage, 'blitz'), true);
  assert.equal(store.get(MODE_STORAGE_KEY), 'blitz');
  assert.equal(readStoredMode(storage), 'blitz');
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(readStoredMode(blocked), 'normal');
  assert.equal(writeStoredMode(blocked, 'hardcore'), false);
  assert.equal(readStoredMode(null), 'normal');
});

test('HARDCORE: base shield (no Aegis Shield Matrix), other armory upgrades still apply, and no regen ever', () => {
  const normal = run('normal');
  const hc = run('hardcore');
  assert.equal(normal.player.maxHp, 100 + ARMORY_RANK * 4, 'NORMAL keeps the armory shield');
  assert.equal(hc.player.maxHp, 100);
  assert.equal(hc.player.hp, 100);
  assert.equal(hc.player.base.maxHp, 100);
  assert.equal(hc.player.stats.damage, normal.player.stats.damage, 'damage armory applies');
  assert.equal(hc.player.damageTakenMult, normal.player.damageTakenMult, 'armor armory applies');
  assert.equal(hc.player.bombs, normal.player.bombs);
  assert.equal(hc.player.mode, 'hardcore');

  hc.player.hp = 40;
  for (let i = 0; i < 60 * 30; i++) hc.update(DT);
  assert.equal(hc.player.hp, 40, '30 s later the shield has not regenerated at all');
  assert.equal(hc.state, 'PLAYING');
});

test('HARDCORE: shield cards are never offered in hands or caches', () => {
  const shieldCards = cardsThatRaiseShield();
  assert.ok(shieldCards.length >= 1, 'Phase Nova Thrusters raises the shield');
  for (const id of shieldCards) assert.ok(UPGRADE_POOL.find((u) => u.id === id).shieldCard, `${id} is flagged shieldCard`);

  const hc = run('hardcore');
  const normal = run('normal');
  assert.ok(eligibleUpgrades(normal.player).some((u) => shieldCards.includes(u.id)), 'NORMAL offers them');
  assert.ok(!eligibleUpgrades(hc.player).some((u) => shieldCards.includes(u.id)));
  for (let i = 0; i < 300; i++) {
    for (const card of [...rollLevelUpHand(hc.player, 4), ...rollUpgrades(hc.player, 5)]) {
      assert.ok(!shieldCards.includes(card.id), `${card.id} offered in HARDCORE`);
    }
  }
});

test('HARDCORE: caches, shield crystals and a maxed level-up repair nothing', () => {
  const g = run('hardcore');
  const p = g.player;
  p.hp = 30;
  // Relic caches (the "+45 Shield Repaired" reward): several, so their installed cards are covered too.
  for (let i = 0; i < 12; i++) {
    g.state = 'PLAYING';
    g.openRelicChest({ x: p.x, y: p.y, isSuper: i % 2 === 0 });
    g.closeChestModal();
    while (g.state === 'UPGRADE') g.selectUpgrade(0);
  }
  assert.equal(p.hp, 30, 'no cache repair');
  assert.equal(p.maxHp, 100, 'no cache card raised the shield');
  // A shield crystal (shield vein) broken by the ship.
  g.state = 'PLAYING';
  g.onRockShattered({ x: p.x + 50, y: p.y, radius: 20, sides: 6, rotation: 0, hue: 150, oreType: 'shield_vein' });
  assert.equal(p.hp, 30, 'no crystal repair');
  // ALL SYSTEMS MAXED: an empty hand (every card banished, every slot full) pays a score bonus instead
  // of the full repair.
  g.state = 'PLAYING';
  p.banished = Object.fromEntries(UPGRADE_POOL.map((u) => [u.id, true]));
  p.loadout = WEAPONS.slice(0, weaponSlots()).map((w) => w.id);
  const score = g.score;
  g.triggerLevelUp();
  assert.equal(g.currentChoices.length, 0);
  assert.equal(g.state, 'PLAYING');
  assert.equal(p.hp, 30, 'no maxed level-up repair');
  assert.ok(g.score > score, 'the score bonus still pays');
});

test('NORMAL is unchanged: regen, shield cards, cache and crystal repairs, armory shield, default tuning', () => {
  const g = run('normal');
  assert.deepEqual(sameAsDefaults(), []);
  assert.equal(g.mode, 'normal');
  const p = g.player;
  p.hp = 40;
  for (let i = 0; i < 60; i++) g.update(DT);
  assert.ok(Math.abs(p.hp - (40 + DEFAULT_TUNING.shieldRegenRate)) < 0.01, 'one second of regen');
  p.hp = 40;
  g.openRelicChest({ x: p.x, y: p.y, isSuper: false });
  assert.ok(p.hp >= 85, 'the cache repairs 45');
  g.closeChestModal();
  p.hp = 40;
  g.state = 'PLAYING';
  g.onRockShattered({ x: p.x + 50, y: p.y, radius: 20, sides: 6, rotation: 0, hue: 150, oreType: 'shield_vein' });
  assert.equal(p.hp, 65, 'the crystal repairs 25');
  assert.ok(eligibleUpgrades(p).some((u) => u.id === 'thrusters'));
});

test('BLITZ: its overlay is on for the run, never saved or counted as dev tuning, and NORMAL tuning comes back after', () => {
  assert.deepEqual(sameAsDefaults(), []);
  const g = run('blitz');
  for (const [key, value] of Object.entries(MODES.blitz.tuning)) assert.equal(TUNING[key], value, `${key} overlaid`);
  assert.equal(baseTuning().waveLength, DEFAULT_TUNING.waveLength, 'the player tuning underneath is untouched');
  assert.equal(g.player.xpToNext, 15, 'the cheaper XP curve is live from LV 1');

  // A player setting saved mid-run (a volume slider) must not persist the BLITZ values.
  updateTuningKey('musicVolume', DEFAULT_TUNING.musicVolume);
  const stored = JSON.parse(saved.get('vexolith_tuning_overrides_v4') || '{}');
  assert.equal(stored.waveLength, undefined, 'BLITZ overlay never reaches storage');

  // Waves tick on the BLITZ clock.
  for (let i = 0; i < 60 * 15; i++) g.update(DT);
  assert.equal(g.wave, 2);

  // The run is not dev-tuned: it goes to the global board.
  let submitted = null;
  g.globalBoard = { submit: async (r) => { submitted = r; return { ok: true }; } };
  g.renderBoards = () => {};
  g.player.hp = 0;
  g.triggerGameOver();
  assert.equal(g.state, 'GAMEOVER');
  assert.deepEqual(g.globalSubmit, { pending: true }, 'not tainted by the overlay');
  assert.equal(submitted.mode, 'blitz');
  assert.deepEqual(sameAsDefaults(), [], 'game over restores NORMAL tuning');

  // Restart keeps the mode; the title screen (or a range run) takes the overlay off again.
  g.resetRun(g.selectedMode);
  assert.equal(TUNING.waveLength, MODES.blitz.tuning.waveLength);
  g.resetRun();
  assert.deepEqual(sameAsDefaults(), []);
});

test('BLITZ: the balance harness restores NORMAL tuning after a run cut off at its time cap', () => {
  const r = h.simulateRun({ strategy: { name: 'random', priorities: [] }, seed: 'modes', maxSeconds: 20, skill: 'expert', mode: 'blitz' });
  assert.equal(r.mode, 'blitz');
  assert.equal(r.died, false);
  assert.deepEqual(sameAsDefaults(), []);
});

test('the overlay helpers: a dev change to an overlaid key outlives the run', () => {
  applyTuningOverlay({ waveLength: 9, notAKey: 1 });
  assert.equal(TUNING.waveLength, 9);
  assert.equal(TUNING.notAKey, undefined);
  clearTuningOverlay();
  assert.equal(TUNING.waveLength, DEFAULT_TUNING.waveLength);
  applyTuningOverlay({ waveLength: 9 });
  updateTuningKey('waveLength', 30);
  assert.equal(TUNING.waveLength, 30);
  clearTuningOverlay();
  assert.equal(TUNING.waveLength, 30);
  updateTuningKey('waveLength', DEFAULT_TUNING.waveLength);
  assert.deepEqual(sameAsDefaults(), []);
});

test('the run-stats payload carries the mode; the stats server reads a missing mode as NORMAL', () => {
  const g = run('hardcore', 60 * 25);
  const summary = g.finishRunStats();
  assert.equal(summary.mode, 'hardcore');
  const body = { ...summary, version: GAME_VERSION };
  assert.equal(sanitizeRunStats(body).run.mode, 'hardcore');
  const { mode: _drop, ...old } = body;
  assert.equal(sanitizeRunStats(old).run.mode, 'normal');
  assert.equal(sanitizeRunStats({ ...body, mode: 'god' }).run.mode, 'normal');
  // The Weapon Range ignores modes.
  const range = h.createHeadlessGame({ mode: 'blitz' });
  range.range = { active: true, onRunStart() {} };
  range.ctx = { setTransform() {}, fillRect() {} };
  range.startGame();
  assert.equal(range.mode, 'normal');
  assert.deepEqual(sameAsDefaults(), []);
});

test('local highscores ("MY RUNS") keep a top 8 per mode and the board shows the selected mode', () => {
  const g = h.createHeadlessGame();
  g.progression.data.highscores = [];
  for (let i = 0; i < 10; i++) g.progression.recordRun({ name: 'ACE', score: 1000 + i, multiplier: 2, wave: 3, kills: 10, timeStr: '01:00', mode: 'normal' });
  const hc = g.progression.recordRun({ name: 'ACE', score: 50, multiplier: 1, wave: 1, kills: 1, timeStr: '00:30', mode: 'hardcore' });
  assert.equal(hc.rank, 1, 'ranked among HARDCORE runs only');
  const scores = g.progression.data.highscores;
  assert.equal(scores.filter((e) => e.mode === 'normal').length, LOCAL_TOP);
  assert.equal(scores.filter((e) => e.mode === 'hardcore').length, 1, 'a low HARDCORE run is not crowded out by NORMAL runs');
  const view = buildBoardView({ tab: 'local', board: { mode: 'hardcore' }, local: scores });
  assert.deepEqual(view.rows.map((r) => r.score), [50]);
  assert.match(view.note, /HARDCORE/);
  assert.deepEqual(view.modes.map((m) => [m.id, m.active]), [['normal', false], ['hardcore', true], ['blitz', false]]);
  assert.equal(buildBoardView({ tab: 'local', board: { mode: 'normal' }, local: scores }).rows.length, LOCAL_TOP);
  // Saves from before modes: every entry is a NORMAL run.
  const legacy = normalizeSave({ highscores: [{ id: 'a', name: 'X', score: 5 }] });
  assert.equal(legacy.highscores[0].mode, 'normal');
});
