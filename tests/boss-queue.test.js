import test from 'node:test';
import assert from 'node:assert/strict';

// Boss queue (js/boss-queue.js): a boss waits while one from an earlier boss wave is still up, then arrives
// when it falls; after BOSS_QUEUE.maxWait s the old boss retreats instead. Same-wave combos still pair up.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const h = await import('../tools/balance/harness.mjs');
const { BOSS_QUEUE, tickBossQueue } = await import('../js/boss-queue.js');
const { TUNING } = await import('../js/config.js');
const { isCampaignWin } = await import('../js/victory.js');

const DT = 1 / 60;

// A run at the end of wave `wave - 1` with an older boss (from `oldWave`) on the field.
function arena(oldId, oldWave, wave) {
  const g = h.createHeadlessGame();
  g.resetRun(g.selectedMode, null);
  g.state = 'PLAYING';
  const banners = [];
  g.showBanner = (text) => banners.push(text);
  g.spawnCooldown = 1e9;
  const p = g.player;
  g.wave = oldWave;
  g.enemyManager.queueSpawn(oldId, p.x + 700, p.y, g.getWaveScale(), { instant: true, wave: oldWave });
  tick(g, 3);
  g.wave = wave - 1;
  g.waveTimer = TUNING.waveLength ?? 22; // the next update rolls the wave over
  return { g, p, banners };
}

function tick(g, n) {
  for (let i = 0; i < n; i++) {
    g.player.hp = g.player.maxHp;
    g.player.invuln = 1e9; // these tests are about who arrives when, not about surviving it
    g.spawnCooldown = 1e9;
    if (g.state === 'UPGRADE') g.selectUpgrade(0); // a level-up mid-fight: take the first card and fly on
    if (g.state !== 'PLAYING') g.state = 'PLAYING';
    g.update(DT);
  }
}

const bossesOf = (g, type) => g.enemyManager.enemies.filter((e) => e.type === type && !e.dead);
const arrivingOf = (g, type) => g.enemyManager.spawnIndicators.filter((sp) => sp.type === type);

test('the W20 boss still up at W25: Event Horizon waits, then comes in once the Hive Carrier falls', () => {
  const { g, banners } = arena('hive_carrier', 20, 25);
  const carrier = bossesOf(g, 'hive_carrier')[0];
  assert.ok(carrier, 'the W20 boss is on the field');
  tick(g, 1);
  assert.equal(g.wave, 25, 'the wave still advances on its timer');
  tick(g, 60 * 5);
  assert.equal(arrivingOf(g, 'event_horizon').length + bossesOf(g, 'event_horizon').length, 0, 'Event Horizon waits');
  assert.equal(g.pendingBossSpawns[0]?.id, 'event_horizon');
  assert.ok(banners.some((b) => /EVENT HORIZON WAITS \/\/ BEAT HIVE CARRIER FIRST/.test(b)), banners.join(' | '));
  // Bring the Carrier down: the queue opens and Event Horizon's warning plays.
  for (const e of [...g.enemyManager.enemies]) if (e.mount) g.killEnemy(e);
  g.killEnemy(carrier);
  tick(g, 30); // past the kill's hit-stop and slow-mo
  assert.equal(g.state, 'PLAYING');
  assert.equal(arrivingOf(g, 'event_horizon').length, 1, 'Event Horizon warps in');
  assert.ok(banners.some((b) => /NEXT BOSS INBOUND \/\/ EVENT HORIZON/.test(b)));
  tick(g, 60 * 4);
  assert.equal(bossesOf(g, 'event_horizon').length, 1);
  assert.equal(bossesOf(g, 'hive_carrier').length, 0);
});

test('an old boss left alone retreats after the wait (no rewards), and the new boss arrives', () => {
  const { g, banners } = arena('wing_commander', 15, 20);
  const chests = g.chests.length;
  tick(g, 1);
  tick(g, Math.round(60 * (BOSS_QUEUE.maxWait - 1)));
  assert.equal(bossesOf(g, 'wing_commander').length, 1, 'it may fight on for the whole wait');
  assert.equal(arrivingOf(g, 'hive_carrier').length + bossesOf(g, 'hive_carrier').length, 0);
  tick(g, 60 * 2);
  assert.equal(bossesOf(g, 'wing_commander').length, 0, 'the Commander retreats');
  assert.equal(g.enemyManager.enemies.filter((e) => e.wingLeader && !e.dead).length, 0, 'its wing goes with it');
  assert.ok(banners.some((b) => /WING COMMANDER RETREATS/.test(b)));
  assert.equal(g.chests.length, chests, 'a retreat pays nothing');
  assert.notEqual(g.bossCard?.kind, 'defeat', 'and is no boss defeat');
  tick(g, 60 * 4);
  assert.equal(bossesOf(g, 'hive_carrier').length, 1, 'the next boss comes in');
});

test('the final boss still waits its turn and must be beaten: a W45 boss up at W50 retreats, then THE PRISM arrives', () => {
  const { g } = arena('eclipse_twins', 45, 50);
  tick(g, 1);
  assert.equal(g.wave, 50);
  tick(g, Math.round(60 * (BOSS_QUEUE.maxWait + 5)));
  assert.equal(bossesOf(g, 'eclipse_twins').length, 0);
  const prism = bossesOf(g, 'prism')[0];
  assert.ok(prism, 'the final boss arrives');
  assert.equal(prism.bossWave, 50);
  assert.ok(isCampaignWin(g, prism), 'beating it still wins the campaign');
});

test('bosses scheduled for the same wave (endless combos) still arrive together', () => {
  const g = h.createHeadlessGame();
  g.resetRun(g.selectedMode, null);
  g.state = 'PLAYING';
  g.wave = 55;
  g.enemyManager.queueSpawn('brood_queen', g.player.x + 600, g.player.y, 1, { instant: true, wave: 55 });
  tick(g, 2);
  g.pendingBossSpawns.push({ id: 'wing_commander', wave: 55, waveScale: 1 });
  assert.equal(tickBossQueue(g, DT), true, 'a same-wave partner is not held');
  // ...but one from a later boss wave is.
  g.pendingBossSpawns.length = 0;
  g.pendingBossSpawns.push({ id: 'ouroboros', wave: 60, waveScale: 1 });
  assert.equal(tickBossQueue(g, DT), false);
});
