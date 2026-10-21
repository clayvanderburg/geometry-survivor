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
const { EnemyManager } = await import('../js/enemies.js');
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
    state: 'PLAYING', pendingBossSpawns: [], wave: 4, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 99,
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
  assert.equal(g.wave, 5);
  assert.deepEqual(g.pendingBossSpawns, [], 'admission happens on the scheduling tick when a slot is free');
  assert.equal(bossWarnings(g).length, 1);
  assert.equal(liveBosses(g).length, 0);
  assert.equal(calls.warnings, 1);
  assert.equal(g.getBossStage(), 1);
  const warning = g.getBossHudModel().warning;
  assert.equal(warning.name, 'BROOD QUEEN', 'wave 5 is the Brood Queen (js/wave-plan.js)');
  assert.equal(warning.epithet, 'MOTHER OF THE SWARM');
  assert.ok(Math.abs(warning.eta - (TUNING.bossWarningTime - 1 / 60)) < 1e-9);

  let ticks = 1;
  while (liveBosses(g).length === 0 && ticks < 400) { tick(g); ticks++; }
  assert.ok(Math.abs(ticks - TUNING.bossWarningTime * 60) <= 1, `boss arrived after ${ticks} ticks`);
  assert.equal(calls.warnings, 1, 'the warning sting plays once per boss');
  assert.equal(calls.music.at(-2).boss, 1, 'music drops into the warning stage while the boss is inbound');

  const [boss] = liveBosses(g);
  assert.equal(boss.type, 'brood_queen');
  assert.equal(boss.name, 'BROOD QUEEN');
  assert.equal(boss.bossTier, 'minor');
  assert.equal(boss.maxHp, 650 * g.getWaveScale() * TUNING.bossHpMult * TUNING.campaignBossHpMult * TUNING.enemyHpMult, 'a minor boss: the Dreadnought HP formula × the campaign boss multiplier');
  assert.equal(calls.arrivals, 1);
  assert.deepEqual(g.enemyManager.bossArrivals, [], 'arrivals are drained once staged');
  assert.equal(g.bossCard.kind, 'arrival');
  assert.equal(g.bossCard.name, 'BROOD QUEEN');
  assert.equal(g.bossCard.epithet, 'MOTHER OF THE SWARM');
  assert.deepEqual([g.bossCard.kicker, g.bossCard.detail], ['', ''], 'the arrival card is just the name and title');
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
  assert.equal(warning.config.name, 'BROOD QUEEN', 'the first press brings the first named boss');
  assert.equal(warning.timer, TUNING.bossWarningTime);
  assert.equal(calls.warnings, 1);
  assert.equal(banners.length, 0);
  // Each press cycles to the next boss and wraps round to the first.
  const names = [];
  for (let i = 0; i < 12 && names.at(-1) !== 'BROOD QUEEN'; i++) {
    g.enemyManager.spawnIndicators.length = 0;
    g.applyLiveTuning('SPAWN_BOSS');
    names.push(bossWarnings(g)[0].config.name);
  }
  assert.equal(names.at(-1), 'BROOD QUEEN');
  assert.equal(names.length, 10, 'all ten bosses, then round again');
  const warned = calls.warnings;

  g.enemyManager.enemies = Array.from({ length: g.enemyManager.maxEnemies }, () => ({ type: 'swarmer' }));
  g.applyLiveTuning('SPAWN_BOSS');
  assert.equal(calls.warnings, warned);
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
  assert.equal(g.bossCard.detail, '+1,500 PTS · SUPER RELIC CACHE · 3 ❖ VOID CORES · +1 BOMB');
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
  assert.equal(g.bossCard.detail, '+3,000 PTS · SUPER RELIC CACHE · 3 ❖ VOID CORES');
});

test('boss epithets climb with each five-wave encounter', () => {
  assert.equal(bossEpithet(5), 'WAVE 5 WARDEN');
  assert.equal(bossEpithet(10), 'WAVE 10 SENTINEL');
  assert.equal(bossEpithet(15), 'WAVE 15 TYRANT');
  assert.equal(bossEpithet(25), 'WAVE 25 ANNIHILATOR');
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

test('the first boss of a run shows the Supernova bomb reminder once, pointing at the bomb counter', () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const { g } = bossGame();
  g.novaCalloutTimer = 0;
  g.novaCalloutDone = false;
  g.waveTimer = TUNING.waveLength;
  let ticks = 0;
  while (liveBosses(g).length === 0 && ticks < 400) { tick(g); ticks++; }
  assert.ok(g.novaCalloutTimer > 0, 'the first boss arrival starts the reminder');
  g.updateNovaCallout();
  assert.ok(hidden('nova-callout'), 'it waits for the boss title card to clear');
  while (g.bossCardTimer > 0 && ticks < 1000) { tick(g); ticks++; }
  assert.ok(g.novaCalloutTimer > 5 - 2 / 60, 'its 5 s only start once the card is gone');
  g.updateNovaCallout();
  assert.ok(!hidden('nova-callout') && !hidden('nova-callout-arrow'), 'banner and arrow are on screen');
  assert.ok(document.getElementById('nova-indicator').classList.contains('nova-callout-target'), 'the bomb counter glows');
  assert.equal(document.getElementById('nova-callout-title').textContent, 'TRY A SUPERNOVA BOMB! (E)');

  tick(g, 5 * 60 + 2);
  g.updateNovaCallout();
  assert.ok(hidden('nova-callout') && hidden('nova-callout-arrow'), 'gone after 5 seconds');
  assert.ok(!document.getElementById('nova-indicator').classList.contains('nova-callout-target'));

  g.onBossArrived(liveBosses(g)[0]);
  assert.equal(g.novaCalloutTimer, 0, 'only the first boss of a run gets it');

  const fresh = bossGame().g;
  fresh.novaCalloutDone = false;
  fresh.player.bombs = 0;
  fresh.waveTimer = TUNING.waveLength;
  ticks = 0;
  while (liveBosses(fresh).length === 0 && ticks < 400) { tick(fresh); ticks++; }
  assert.ok(!(fresh.novaCalloutTimer > 0), 'no reminder with no bombs to use');
});

test('wave 50 FINAL STAND: no timer, a surge then no spawns, SECTOR CLEAR, VICTORY; continue resumes at wave 51', async () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const { CAMPAIGN_WAVES, FINAL_BOSS } = await import('../js/wave-plan.js');
  const { FINAL_STAND } = await import('../js/final-stand.js');
  const { g } = bossGame();
  Object.assign(g, { wave: CAMPAIGN_WAVES, victoryTimer: 0, campaignWon: false, kills: 1234, score: 98765, spawnCooldown: 0 });
  let packs = 0;
  g.spawnWavePack = () => { packs++; };
  const finalBoss = { type: FINAL_BOSS, bossWave: CAMPAIGN_WAVES, bossTier: 'major', x: 2100, y: 2000, hue: 200, name: 'THE PRISM', epithet: '' };
  const straggler = () => { g.enemyManager.queueSpawn('blackhole', 3800, 2000, 1, { instant: true }); tick(g); };

  // The wave never times out, the surge arrives, and regular packs stay off.
  g.waveTimer = TUNING.waveLength * 3;
  tick(g, 60 * 10);
  assert.equal(g.wave, CAMPAIGN_WAVES, 'wave 50 has no timer');
  assert.equal(packs, FINAL_STAND.surgePacks, 'only the surge spawns: regular spawning has stopped');
  assert.equal(g.finalStand.phase, 'fight');

  // A non-final wave's boss (or the final boss type fought earlier) wins nothing.
  g.onBossDefeated({ ...finalBoss, bossWave: 40 }, 2600, 0);
  assert.equal(g.finalStand.phase, 'fight');

  // The final boss falls with a straggler still out there: no VICTORY until the sector is clear.
  straggler();
  g.onBossDefeated(finalBoss, 2600, 0);
  assert.equal(g.finalStand.phase, 'sweep');
  tick(g, 60);
  assert.equal(g.state, 'PLAYING');
  assert.equal(g.victoryTimer, 0, 'hostiles left: no countdown yet');
  g.enemyManager.enemies.length = 0;
  tick(g);
  assert.equal(g.finalStand.phase, 'sweep', 'the BOSS DESTROYED card plays out first');
  g.bossCardTimer = 0;
  tick(g);
  assert.equal(g.finalStand.phase, 'clear', 'the last kill sounds SECTOR CLEAR');
  assert.ok(g.victoryTimer > 0);
  let ticks = 0;
  while (g.state === 'PLAYING' && ticks < 600) { tick(g); ticks++; }
  assert.equal(g.state, 'VICTORY', `VICTORY after ${ticks} ticks`);
  assert.ok(ticks >= 2.4 * 60, 'the SECTOR CLEAR beat plays out first');
  assert.equal(g.campaignWon, true);
  assert.ok(!hidden('victory-modal'));
  const { VICTORY_BONUS, waveBonus } = await import('../js/score-bonus.js');
  assert.equal(g.score, 98765 + waveBonus(CAMPAIGN_WAVES) + VICTORY_BONUS, 'SECTOR CLEAR pays wave 50, VICTORY the bonus');
  assert.match(document.getElementById('victory-stats').innerHTML, /VICTORY BONUS/);
  const t = g.elapsedTime;
  tick(g, 30);
  assert.equal(g.elapsedTime, t, 'the run is paused behind the screen');

  // CONTINUE: the run goes on into ENDLESS at wave 51, packs back on; one victory per run.
  g.continueEndless();
  assert.equal(g.state, 'PLAYING');
  assert.ok(hidden('victory-modal'));
  packs = 0;
  tick(g, 60 * 4);
  assert.equal(g.wave, CAMPAIGN_WAVES + 1);
  assert.equal(g.waveBonus, waveBonus(CAMPAIGN_WAVES), 'wave 50 is not paid twice on the way to 51');
  assert.ok(packs > 0, 'regular spawning restarts');
  assert.equal(g.finalStand, null);
  g.onBossDefeated(finalBoss, 2600, 0);
  assert.equal(g.victoryTimer, 0, 'one victory per run');

  // END RUN: the results screen is a win.
  const ends = [];
  g.triggerGameOver = (opts) => ends.push(opts);
  g.state = 'VICTORY';
  g.endVictoriousRun();
  assert.deepEqual(ends, [{ victory: true }]);
  assert.ok(hidden('victory-modal'));
});

test('FINAL STAND anti-stall: stragglers are drawn in, then wrecked, so the ending always comes', async () => {
  Object.assign(TUNING, DEFAULT_TUNING);
  const { CAMPAIGN_WAVES, FINAL_BOSS } = await import('../js/wave-plan.js');
  const { FINAL_STAND, pullStragglers } = await import('../js/final-stand.js');
  const { g } = bossGame();
  Object.assign(g, { wave: CAMPAIGN_WAVES, victoryTimer: 0, campaignWon: false });
  g.spawnWavePack = () => {};
  // The wrecked straggler is a kill: its rare cache drop lands by the ship and would open CHEST first.
  g.spawnRelicChest = () => {};
  tick(g);
  g.enemyManager.queueSpawn('blackhole', 4000, 2000, 1, { instant: true });
  tick(g, 2);
  const far = g.enemyManager.enemies.find(e => e.type === 'blackhole');
  far.hp = far.maxHp = 1e12;
  g.onBossDefeated({ type: FINAL_BOSS, bossWave: CAMPAIGN_WAVES, bossTier: 'major', x: 0, y: 0, hue: 0 }, 1, 0);
  tick(g, 60 * (FINAL_STAND.pullAfter - 1));
  assert.equal(g.finalStand.pulling, false, 'no pull before the timer');
  tick(g, 60 * 2);
  assert.equal(g.finalStand.pulling, true, 'stragglers are drawn in after the timer');
  // The pull itself: far hostiles step toward the ship, near ones are left alone.
  const pulled = { x: g.player.x + 2000, y: g.player.y }, near = { x: g.player.x + 200, y: g.player.y };
  pullStragglers({ player: g.player, enemyManager: { enemies: [pulled, near] } }, 1);
  assert.equal(pulled.x, g.player.x + 2000 - FINAL_STAND.pullSpeed);
  assert.equal(near.x, g.player.x + 200);
  tick(g, 60 * (FINAL_STAND.wreckAfter - FINAL_STAND.pullAfter));
  assert.ok(far.dead, 'an unkillable straggler is wrecked at the hard stop');
  let ticks = 0;
  while (g.state === 'PLAYING' && ticks < 600) { tick(g); ticks++; }
  assert.equal(g.state, 'VICTORY');
});
