import test from 'node:test';
import assert from 'node:assert/strict';

// Boss escape (js/boss-escape.js): every boss leaves after BOSS_ESCAPE.time s unless beaten, with a warning
// BOSS_ESCAPE.warnAt s before; it drops nothing. The wave-50 final boss never escapes. Bosses still overlap.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const h = await import('../tools/balance/harness.mjs');
const { BOSS_ESCAPE, tickBossEscapes, escapeLeft } = await import('../js/boss-escape.js');
const { sanitizeRunStats } = await import('../js/stats-rules.js');

const DT = 1 / 60;

function arena(wave = 5) {
  const g = h.createHeadlessGame();
  g.resetRun(g.selectedMode, null);
  g.state = 'PLAYING';
  g.wave = wave;
  g.waveTimer = -1e9; // hold the wave: these tests place their own bosses
  const banners = [];
  const radio = [];
  g.showBanner = (text) => banners.push(text);
  g.say = (who, text, opts) => radio.push({ who, text, then: opts?.then });
  return { g, banners, radio };
}

function tick(g, n) {
  for (let i = 0; i < n; i++) {
    g.player.hp = g.player.maxHp;
    g.player.invuln = 1e9;
    g.spawnCooldown = 1e9;
    if (g.state === 'UPGRADE') g.selectUpgrade(0);
    if (g.state !== 'PLAYING') g.state = 'PLAYING';
    g.update(DT);
  }
}

const spawnBoss = (g, id, wave) => g.enemyManager.queueSpawn(id, g.player.x + 600, g.player.y, g.getWaveScale(), { instant: true, wave });
const live = (g, type) => g.enemyManager.enemies.filter((e) => e.type === type && !e.dead);

test('the clock: a warning at 2:30 (Dr. Pixie + a banner), the escape at 3:00 sharp', () => {
  const { g, banners, radio } = arena(5);
  spawnBoss(g, 'brood_queen', 5);
  tick(g, 3);
  const q = live(g, 'brood_queen')[0];
  q.escapeT = BOSS_ESCAPE.time; // start the clock exactly at 3:00 (it began a few ticks ago, on arrival)
  // Drive the clock alone in whole seconds (the AI and the fight are not under test here).
  for (let s = 1; s < BOSS_ESCAPE.time - BOSS_ESCAPE.warnAt; s++) tickBossEscapes(g, 1);
  assert.equal(radio.length, 0, 'no warning before 2:30');
  tickBossEscapes(g, 1);
  assert.equal(radio.length, 1, 'the warning at 2:30');
  assert.match(radio[0].text, /Brood queen is getting away!/);
  assert.match(radio[0].then[0].text, /Alien Tech Cache/);
  assert.ok(banners.some((b) => /BROOD QUEEN IS GETTING AWAY! \/\/ KILL IT FOR THE ALIEN TECH CACHE/.test(b)));
  assert.ok(Math.abs(escapeLeft(g, q) - BOSS_ESCAPE.warnAt) < 1e-6);
  for (let s = 0; s < BOSS_ESCAPE.warnAt - 1; s++) tickBossEscapes(g, 1);
  assert.equal(live(g, 'brood_queen').length, 1, 'still here at 2:59');
  tickBossEscapes(g, 1);
  assert.equal(live(g, 'brood_queen').length, 0, 'gone at 3:00');
  assert.equal(radio.length, 1, 'one warning only');
});

test('an escape drops nothing: no cache, no defeat card, no score; its escorts go with it, and run stats count it', () => {
  const { g, banners } = arena(15);
  spawnBoss(g, 'wing_commander', 15);
  tick(g, 4);
  const c = live(g, 'wing_commander')[0];
  assert.ok(g.enemyManager.enemies.some((e) => e.wingLeader === c), 'it has its V');
  const chests = g.chests.length;
  const cores = g.sessionCores;
  c.escapeT = 0.5; // half a second left
  tick(g, 45);
  assert.equal(live(g, 'wing_commander').length, 0, 'it escaped');
  assert.equal(g.enemyManager.enemies.filter((e) => e.wingLeader && !e.dead).length, 0, 'its wing went with it');
  assert.equal(g.chests.length, chests, 'no Alien Tech Cache');
  assert.notEqual(g.bossCard?.kind, 'defeat');
  assert.equal(g.sessionCores, cores, 'no Void Cores for it');
  assert.ok(banners.some((b) => /WING COMMANDER ESCAPED \/\/ NO ALIEN TECH CACHE/.test(b)));
  const run = g.runStats.finish({ time: 60, wave: 15 });
  assert.deepEqual(run.bossEscapes, { wing_commander: 1 });
  const kept = sanitizeRunStats({ ...run, schema: 1, time: 600 });
  assert.ok(kept.run, kept.error);
  assert.deepEqual(kept.run.bossEscapes, { wing_commander: 1 }, 'the stats server keeps it');
});

test('split bosses share one clock: both Eclipse Twins leave together', () => {
  const { g } = arena(45);
  spawnBoss(g, 'eclipse_twins', 45);
  tick(g, 6);
  assert.equal(live(g, 'eclipse_twins').length, 2);
  const [a, b] = live(g, 'eclipse_twins');
  assert.equal(escapeLeft(g, a), escapeLeft(g, b));
  (a.root || a).escapeT = 0.2;
  tick(g, 30);
  assert.equal(live(g, 'eclipse_twins').length, 0);
});

test('the wave-50 final boss never escapes; an endless boss does', () => {
  const { g } = arena(50);
  spawnBoss(g, 'prism', 50);
  tick(g, 3);
  const prism = live(g, 'prism')[0];
  assert.equal(escapeLeft(g, prism), null);
  for (let s = 0; s < BOSS_ESCAPE.time + 30; s++) tickBossEscapes(g, 1);
  assert.equal(live(g, 'prism').length, 1, 'still there after 3.5 minutes');
  // Past wave 50 (endless), the same boss is on the clock.
  const e = arena(60);
  spawnBoss(e.g, 'prism', 60);
  tick(e.g, 3);
  assert.ok(Math.abs(escapeLeft(e.g, live(e.g, 'prism')[0]) - BOSS_ESCAPE.time) < 0.1, 'on the clock from its arrival');
});

test('bosses still overlap: a W20 boss alive at W25 shares the field with the W25 boss', () => {
  const { g } = arena(20);
  spawnBoss(g, 'hive_carrier', 20);
  tick(g, 3);
  g.wave = 24;
  g.waveTimer = 999; // roll into wave 25: its boss is scheduled and arrives
  g.update(DT);
  g.waveTimer = -1e9;
  tick(g, 60 * 5);
  assert.equal(g.wave, 25);
  assert.equal(live(g, 'hive_carrier').length, 1);
  assert.equal(live(g, 'event_horizon').length, 1, 'the next boss arrives beside it');
  // Each keeps its own clock (the carrier is 5 s further along).
  assert.ok(escapeLeft(g, live(g, 'hive_carrier')[0]) < escapeLeft(g, live(g, 'event_horizon')[0]));
});
