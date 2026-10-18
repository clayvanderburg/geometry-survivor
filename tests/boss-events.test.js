import test from 'node:test';
import assert from 'node:assert/strict';

// Boss encounter presentation: warning -> arrival -> HUD bars -> defeat payoff. Browser services
// are stubbed; the DOM stub tracks classes so HUD visibility can be asserted.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const elements = new Map();
function element() {
  const classes = new Set(['hidden']);
  return {
    textContent: '', innerHTML: '', style: {}, offsetWidth: 0, value: '',
    get className() { return [...classes].join(' '); },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    appendChild() {}, addEventListener() {}
  };
}
globalThis.document = {
  activeElement: null,
  getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  createElement: element
};
const hidden = id => document.getElementById(id).classList.contains('hidden');

const { Game, bossEpithet } = await import('../js/main.js');
const { EnemyManager, contactDamageAt } = await import('../js/enemies.js');
const { SoundEngine } = await import('../js/audio.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const silent = new Proxy({}, { get: () => () => {} });

function bossGame() {
  const calls = { warnings: 0, arrivals: 0, defeats: 0, music: [] };
  const manager = new EnemyManager();
  const g = Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: {
      x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, bombs: 2,
      stats: { moveSpeed: 5, luck: 1, xpMultiplier: 1, magnetRadius: 145, coreDropMult: 1, damage: 11 }, weapons: {}, upgradeLevels: {}, xp: 0, xpToNext: 1e9, level: 1
    },
    grid: silent, particles: silent, progression: { addCores() {} },
    sound: {
      ...silent,
      playBossWarning() { calls.warnings++; }, playBossArrival() { calls.arrivals++; }, playBossDefeat() { calls.defeats++; },
      setMusicState(state) { calls.music.push(state); }, playExplosion() {}, playGeomPickup() {}
    },
    state: 'PLAYING', pendingBossSpawns: [], wave: 2, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 99,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [],
    score: 0, kills: 0, shake: 0, chromaFlash: 0, coresDroppedThisWave: 0,
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
  return { g, calls };
}

const tick = (g, n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
const liveBosses = g => g.enemyManager.enemies.filter(e => e.isBoss);
const bossWarnings = g => g.enemyManager.spawnIndicators.filter(sp => sp.config.isBoss);

test('a scheduled boss telegraphs for the full warning time before it materializes', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const { g, calls } = bossGame();
  g.waveTimer = TUNING.waveLength;
  tick(g);
  assert.equal(g.wave, 3);
  assert.deepEqual(g.pendingBossSpawns, [], 'admission happens on the scheduling tick when a slot is free');
  assert.equal(bossWarnings(g).length, 1);
  assert.equal(liveBosses(g).length, 0);
  assert.equal(calls.warnings, 1);
  assert.equal(g.getBossStage(), 1);
  const warning = g.getBossHudModel().warning;
  assert.equal(warning.epithet, 'WAVE 3 WARDEN');
  assert.ok(Math.abs(warning.eta - (TUNING.bossWarningTime - 1 / 60)) < 1e-9);

  let ticks = 1;
  while (liveBosses(g).length === 0 && ticks < 400) { tick(g); ticks++; }
  assert.ok(Math.abs(ticks - TUNING.bossWarningTime * 60) <= 1, `boss arrived after ${ticks} ticks`);
  assert.equal(calls.warnings, 1, 'the warning sting plays once per boss');
  assert.equal(calls.music.at(-2).boss, 1, 'music drops into the warning stage while the boss is inbound');

  const [boss] = liveBosses(g);
  assert.equal(boss.name, 'PRISMATIC DREADNOUGHT');
  assert.equal(boss.epithet, 'WAVE 3 WARDEN');
  assert.equal(boss.maxHp, 650 * g.getWaveScale() * TUNING.bossHpMult, 'presentation does not change boss stats');
  assert.equal(calls.arrivals, 1);
  assert.deepEqual(g.enemyManager.bossArrivals, [], 'arrivals are drained once staged');
  assert.equal(g.bossCard.kind, 'arrival');
  assert.equal(g.bossCard.detail, `${Math.round(boss.maxHp).toLocaleString()} HP · ${Math.round(contactDamageAt(boss, 3))} CONTACT DMG`);
  assert.ok(g.shake <= 24, 'arrival shake stays within the existing cap');
  assert.equal(g.getBossStage(), 2);
  assert.equal(g.getBossHudModel().warning, null);

  tick(g);
  assert.equal(calls.music.at(-1).boss, 2);
  assert.equal(calls.music.at(-1).intensity, 1);
  assert.equal(calls.arrivals, 1, 'entrance is staged exactly once');
});

test('a warned boss holds its reserved slot so the enemy cap cannot refuse it on arrival', () => {
  const { g } = bossGame();
  const manager = g.enemyManager;
  manager.enemies = Array.from({ length: manager.maxEnemies - 1 }, (_, i) => ({ x: 100 + i, y: 100, vx: 0, vy: 0, radius: 10, hp: 100, maxHp: 100, type: 'swarmer', trail: [], rotation: 0, vRot: 0, pulsePhase: 0, speed: 0 }));
  assert.equal(g.queueBossEncounter({ x: 3000, y: 3000 }, 1, 'WAVE 3 WARDEN'), true);
  assert.equal(manager.queueSpawn('swarmer', 10, 10), false, 'the warning occupies the last slot');
  manager.update(TUNING.bossWarningTime + 0.01, g.player, [], silent, silent, 4200, 4200);
  assert.equal(manager.enemies.filter(e => e.isBoss).length, 1);
  assert.equal(manager.enemies.length, manager.maxEnemies);
});

test('sandbox +Boss runs the same warning event, and reports when the cap blocks it', () => {
  const { g, calls } = bossGame();
  const banners = [];
  Object.assign(g, {
    showBanner: message => banners.push(message),
    progression: { getBonuses: () => ({ moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 }) },
    sound: { ...g.sound, applyTuning() {} }
  });
  g.wave = 4;
  g.applyLiveTuning('SPAWN_BOSS');
  const [warning] = bossWarnings(g);
  assert.ok(warning, 'sandbox boss starts in the warning phase');
  assert.equal(warning.config.epithet, 'WAVE 4 SANDBOX SIMULACRUM');
  assert.equal(warning.timer, TUNING.bossWarningTime);
  assert.equal(calls.warnings, 1);
  assert.equal(banners.length, 0);

  g.enemyManager.enemies = Array.from({ length: g.enemyManager.maxEnemies }, () => ({ type: 'swarmer' }));
  g.applyLiveTuning('SPAWN_BOSS');
  assert.equal(calls.warnings, 1);
  assert.ok(banners[0].includes('ENEMY CAP REACHED'));
});

test('boss health bars appear with a boss, stack compactly, and hide when none remain', () => {
  const { g } = bossGame();
  const render = () => g.updateBossHUD(g.getBossHudModel());

  render();
  assert.equal(hidden('boss-hud'), true);
  assert.equal(hidden('boss-bars'), true);
  assert.equal(hidden('boss-warning'), true);

  g.queueBossEncounter({ x: 3000, y: 3000 }, 1, 'WAVE 3 WARDEN');
  g.enemyManager.spawnIndicators[0].timer = 2.46;
  render();
  assert.equal(hidden('boss-hud'), false);
  assert.equal(hidden('boss-warning'), false);
  assert.equal(hidden('boss-bars'), true, 'no bar until the boss is actually alive');
  assert.equal(document.getElementById('boss-warning-eta').textContent, 'T-2.5s');
  assert.equal(document.getElementById('boss-warning-text').textContent, 'PRISMATIC DREADNOUGHT INBOUND // WAVE 3 WARDEN');

  g.enemyManager.update(3, g.player, [], silent, silent, 4200, 4200);
  const boss = liveBosses(g)[0];
  boss.hp = boss.maxHp * 0.4;
  render();
  assert.equal(hidden('boss-warning'), true);
  assert.equal(hidden('boss-bars'), false);
  assert.equal(hidden('boss-bar-0'), false);
  assert.equal(hidden('boss-bar-1'), true);
  assert.equal(document.getElementById('boss-bar-name-0').textContent, 'PRISMATIC DREADNOUGHT');
  assert.equal(document.getElementById('boss-bar-epithet-0').textContent, 'WAVE 3 WARDEN');
  assert.equal(document.getElementById('boss-bar-hp-0').textContent, `${Math.ceil(boss.hp).toLocaleString()} / ${Math.round(boss.maxHp).toLocaleString()}`);
  assert.equal(document.getElementById('boss-bar-fill-0').style.width, '40.0%');
  assert.equal(hidden('boss-bar-more'), true);

  // Four live bosses: three rows (the nearest, kept in arrival order) plus an overflow line.
  for (const [x, epithet] of [[2100, 'B'], [3900, 'FAR'], [2200, 'C']]) {
    g.enemyManager.queueSpawn('boss', x, 2000, 1, { warmup: 0, epithet });
    g.enemyManager.update(1 / 60, g.player, [], silent, silent, 4200, 4200);
  }
  boss.x = 2050; boss.y = 2000;
  g.enemyManager.enemies.find(e => e.epithet === 'FAR').x = 4100;
  render();
  assert.deepEqual([0, 1, 2].map(i => hidden(`boss-bar-${i}`)), [false, false, false]);
  assert.deepEqual([0, 1, 2].map(i => document.getElementById(`boss-bar-epithet-${i}`).textContent), ['WAVE 3 WARDEN', 'B', 'C']);
  assert.equal(hidden('boss-bar-more'), false);
  assert.equal(document.getElementById('boss-bar-more').textContent, '+1 MORE BOSS ON RADAR');

  for (const e of liveBosses(g)) g.killEnemy(e);
  g.bossCardTimer = 0;
  render();
  assert.equal(hidden('boss-bars'), true);
  assert.equal(hidden('boss-hud'), true);

  // The real HUD refresh drives the same boss panel.
  g.queueBossEncounter({ x: 3000, y: 3000 }, 1, 'WAVE 6 SENTINEL');
  delete g.updateHUD;
  g.progression = { data: { cores: 0 } };
  g.updateHUD();
  assert.equal(hidden('boss-warning'), false);
});

test('boss defeat triggers a fixed-tick hit-stop then half-speed slow-mo and a reward banner', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const { g, calls } = bossGame();
  g.queueBossEncounter({ x: 3000, y: 3000 }, 1, 'WAVE 3 WARDEN');
  g.enemyManager.update(3, g.player, [], silent, silent, 4200, 4200);
  g.enemyManager.bossArrivals.length = 0;
  const boss = liveBosses(g)[0];
  g.killEnemy(boss);

  assert.equal(calls.defeats, 1);
  assert.equal(g.bossCard.kind, 'defeat');
  assert.equal(g.bossCard.detail, '+1,500 PTS · SUPER RELIC CACHE · +1 BOMB');
  assert.equal(g.player.bombs, 3, 'existing boss rewards are unchanged');
  assert.equal(g.chests.length, 1);
  assert.equal(g.hitStopTicks, 6);
  assert.equal(g.slowMoTicks, 30);

  const start = g.elapsedTime;
  tick(g, 6);
  assert.equal(g.elapsedTime, start, 'hit-stop holds the simulation clock');
  tick(g, 30);
  assert.ok(Math.abs(g.elapsedTime - start - 15 / 60) < 1e-9, 'slow-mo runs every other fixed tick');
  tick(g, 4);
  assert.ok(Math.abs(g.elapsedTime - start - 19 / 60) < 1e-9, 'full speed resumes afterwards');
  assert.equal(g.getBossStage(), 0);
});

test('a boss cache under the player waits for the defeat card before opening', () => {
  const { g } = bossGame();
  g.openRelicChest = function() { this.state = 'CHEST'; };
  const boss = { type: 'boss', isBoss: true, x: g.player.x, y: g.player.y, hp: 1, maxHp: 650, radius: 36, hue: 185, sides: 8, rotation: 0, score: 1500, xp: 30, name: 'PRISMATIC DREADNOUGHT', epithet: 'WAVE 3 WARDEN' };
  g.enemyManager.enemies.push(boss);
  g.killEnemy(boss);
  let ticks = 0;
  while (g.state === 'PLAYING' && ticks < 400) { tick(g); ticks++; }
  assert.equal(g.state, 'CHEST');
  assert.ok(ticks > 36, `cache opened after ${ticks} ticks`);
  assert.ok(g.bossCardTimer <= 0.45);
});

test('a full bomb stock is not advertised as a bomb reward', () => {
  const { g } = bossGame();
  g.player.bombs = 9;
  const boss = { type: 'boss', isBoss: true, x: 2500, y: 2500, hp: 1, maxHp: 650, radius: 36, hue: 185, sides: 8, rotation: 0, score: 1500, xp: 30 };
  g.enemyManager.enemies.push(boss);
  g.multiplier = 2;
  g.killEnemy(boss);
  assert.equal(g.bossCard.detail, '+3,000 PTS · SUPER RELIC CACHE');
});

test('boss epithets climb with each three-wave encounter', () => {
  assert.equal(bossEpithet(3), 'WAVE 3 WARDEN');
  assert.equal(bossEpithet(6), 'WAVE 6 SENTINEL');
  assert.equal(bossEpithet(9), 'WAVE 9 TYRANT');
  assert.equal(bossEpithet(15), 'WAVE 15 ANNIHILATOR');
  assert.equal(bossEpithet(42), 'WAVE 42 ANNIHILATOR');
});

test('music drops out during a boss warning and adds the boss riff while one is alive', () => {
  const engine = new SoundEngine();
  const played = [];
  for (const method of ['playKick', 'playBassNote', 'playSnare', 'playHiHat', 'playArpNote', 'playChordPad', 'playBossStab']) {
    engine[method] = () => played.push(method);
  }
  const bar = () => { played.length = 0; for (let step = 0; step < 16; step++) engine.triggerStep(step, step * 0.1, 0.1); return played; };
  const count = (list, name) => list.filter(m => m === name).length;

  engine.setMusicState({ intensity: 1, boss: 0 });
  const normal = [...bar()];
  assert.equal(count(normal, 'playBossStab'), 0);
  assert.ok(count(normal, 'playArpNote') > 0 && count(normal, 'playHiHat') > 0);

  engine.setMusicState({ intensity: 1, boss: 1 });
  const warning = [...bar()];
  assert.equal(count(warning, 'playArpNote') + count(warning, 'playHiHat') + count(warning, 'playChordPad'), 0);
  assert.equal(count(warning, 'playKick'), 4);
  assert.equal(count(warning, 'playBassNote'), 16);

  engine.setMusicState({ intensity: 1, boss: 2 });
  const fight = [...bar()];
  assert.equal(count(fight, 'playBossStab'), 6);

  // Pausing (no explicit stage) keeps the stage and the boss riff; only the bus low-pass softens.
  engine.setMusicState({ intensity: 1, muffled: true });
  assert.equal(engine.bossStage, 2);
  assert.equal(count(bar(), 'playBossStab'), 6);
});

test('an off-screen boss arrow above the player sits just under the measured HUD, not on the ship', () => {
  const { g } = bossGame();
  document.querySelector = sel => (sel === '.hud-top' ? { getBoundingClientRect: () => ({ bottom: 170 }) } : null);
  const translates = [];
  const ctx = new Proxy({ translate: (x, y) => translates.push([x, y]) }, { get: (t, k) => t[k] ?? (() => {}), set: () => true });
  g.enemyManager.enemies.push({ isBoss: true, x: g.camX + g.width / 2, y: g.camY - 600 });
  g.drawBossIndicators(ctx);
  assert.deepEqual(translates, [[g.width / 2, 170 + 34]]);

  // A short window still keeps the arrow at least 40px above centre.
  delete g.hudTopEl;
  document.querySelector = () => ({ getBoundingClientRect: () => ({ bottom: 400 }) });
  translates.length = 0;
  g.drawBossIndicators(ctx);
  assert.deepEqual(translates, [[g.width / 2, g.height / 2 - 40]]);
  delete document.querySelector;
});
