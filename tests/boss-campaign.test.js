import test from 'node:test';
import assert from 'node:assert/strict';

// Boss campaign (js/wave-plan.js, js/waves.js, js/bosses.js, js/hostiles.js): the 30-wave plan, the HP
// budget, the pack lull during a boss fight, veteran forms, and the named bosses and newcomers.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const fakeElement = () => ({
  textContent: '', innerHTML: '', style: {}, value: '', offsetWidth: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {}, addEventListener() {}
});
globalThis.document = { getElementById: fakeElement, createElement: fakeElement, querySelectorAll: () => [], activeElement: null };

const { Game } = await import('../js/main.js');
const { EnemyManager, waveScaleAt, spawnIntervalAt } = await import('../js/enemies.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const plan = await import('../js/wave-plan.js');
const { WAVE_PACKS, pickWavePack, packRoster, packHp, meanPackHp, hpBudgetScale } = await import('../js/waves.js');
const { BOSS_DEFS, BOSS_TIER, QUEEN, bossBuilt } = await import('../js/bosses.js');
const { HOSTILE_INFO } = await import('../js/hostiles.js');
const { HOSTILE_IDS } = await import('../js/field-guide.js');
const { PREVIEW_IDS } = await import('../js/field-guide-scenes.js');
const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);

function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function campaignGame({ wave = 1 } = {}) {
  const manager = new EnemyManager();
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: {
      x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, bombs: 2,
      stats: { moveSpeed: 5, luck: 1, xpMultiplier: 1, magnetRadius: 145, coreDropMult: 1, damage: 11 }, weapons: {}, upgradeLevels: {}, xp: 0, xpToNext: 1e9, level: 1
    },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 99,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], seenArchetypes: new Set(),
    score: 0, kills: 0, shake: 0, chromaFlash: 0, coresDroppedThisWave: 0, lieutenantWave: 0,
    showBanner() {}, updateHUD() {}, announceArchetype() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
}

const step = (manager, player, ticks = 1) => {
  for (let i = 0; i < ticks; i++) manager.update(1 / 60, player, [], silent, silent, 4200, 4200);
};

test('boss waves: minor every 3rd, major every 6th, and the schedule names one boss per campaign boss wave', () => {
  assert.equal(plan.bossTier(1), null);
  assert.equal(plan.bossTier(3), 'minor');
  assert.equal(plan.bossTier(6), 'major');
  assert.equal(plan.bossTier(9), 'minor');
  assert.equal(plan.bossTier(30), 'major');
  for (let w = 3; w <= 30; w += 3) assert.ok(plan.BOSS_SCHEDULE[w], `wave ${w} has a boss`);
  assert.deepEqual(plan.bossesForWave(3, bossBuilt), ['brood_queen']);
  assert.deepEqual(plan.bossesForWave(4, bossBuilt), []);
  // Unbuilt slots fall back to the Dreadnought stand-in.
  assert.deepEqual(plan.bossesForWave(6, () => false), ['boss']);
  assert.deepEqual(plan.bossesForWave(6, () => true), [plan.BOSS_SCHEDULE[6]]);
});

test('past wave 30 bosses come in combos: two minors, or a major with a minor', () => {
  const all = () => true;
  const minor = new Set([3, 9, 15, 21, 27].map(w => plan.BOSS_SCHEDULE[w]));
  const major = new Set([6, 12, 18, 24, 30].map(w => plan.BOSS_SCHEDULE[w]));
  for (let w = 33; w <= 90; w += 3) {
    const ids = plan.bossesForWave(w, all);
    assert.equal(ids.length, 2, `wave ${w}`);
    if (plan.bossTier(w) === 'minor') assert.ok(ids.every(id => minor.has(id)), `wave ${w}: ${ids}`);
    else assert.ok(major.has(ids[0]) && minor.has(ids[1]), `wave ${w}: ${ids}`);
    assert.notEqual(ids[0], ids[1]);
  }
});

test('every wave has a theme; past 30 two earlier themes are remixed', () => {
  for (let w = 1; w <= 60; w++) {
    const t = plan.waveTheme(w);
    assert.ok(t && t.name.length > 3, `wave ${w}`);
    for (const [id, m] of Object.entries(t.bias || {})) assert.ok(m > 0, `${w} ${id}`);
  }
  assert.match(plan.waveTheme(31).name, / × /);
});

test('new hostiles debut only on boss waves, never before, and a theme tilts the pack mix', () => {
  resetTuning();
  for (const [type, wave] of Object.entries(plan.UNLOCK_WAVE)) {
    if (wave > 1) assert.ok(plan.isBossWave(wave), `${type} debuts on a boss wave`);
  }
  const counts = (wave) => {
    const rand = seeded(wave);
    const c = {};
    for (let i = 0; i < 6000; i++) { const p = pickWavePack(wave, rand); c[p] = (c[p] || 0) + 1; }
    return c;
  };
  assert.ok(!counts(2).mayfly, 'no mayflies before the Brood Queen');
  assert.ok(counts(3).mayfly > 0);
  // MAYFLY BLOOM (wave 4) triples the mayfly weight.
  const bloom = counts(4).mayfly / 6000;
  const plain = 14 / (40 + 20 + 18 + 14);
  assert.ok(bloom > plain * 1.8, `bloom share ${bloom.toFixed(2)} vs plain ${plain.toFixed(2)}`);
  TUNING.spawnWeightMayfly = 0;
  assert.ok(!counts(4).mayfly, 'a zero weight still disables a pack');
  resetTuning();
});

test('HP budget: each wave brings the same HP per second as the pre-campaign table', () => {
  resetTuning();
  for (let w = 1; w <= 36; w++) {
    const legacy = meanPackHp(w, true) / spawnIntervalAt(w);
    const now = meanPackHp(w) / (spawnIntervalAt(w) * hpBudgetScale(w));
    assert.ok(Math.abs(now / legacy - 1) < 1e-9, `wave ${w}: ${now.toFixed(1)} vs ${legacy.toFixed(1)} HP/s`);
  }
  assert.ok(packHp('splitter', 5) > packRoster('splitter', 5)[0][1] * 58 * waveScaleAt(5), 'splitter fragments count toward pack HP');
  TUNING.hpBudget = 0;
  assert.equal(hpBudgetScale(12), 1, 'switchable');
  resetTuning();
  TUNING.hpBudgetMax = 1;
  TUNING.hpBudgetMin = 1;
  assert.equal(hpBudgetScale(12), 1, 'clamped');
  resetTuning();
});

test('packs slow by bossPackRate while a boss wave\'s boss is up, and only until the wave ends', () => {
  resetTuning();
  const g = campaignGame({ wave: 3 });
  const base = spawnIntervalAt(3) * hpBudgetScale(3);
  assert.ok(Math.abs(g.packInterval() - base) < 1e-9, 'no boss yet: the normal pace');
  g.pendingBossSpawns.push({ id: 'brood_queen', wave: 3, waveScale: 1 });
  assert.ok(Math.abs(g.packInterval() - base / TUNING.bossPackRate) < 1e-9, 'a pending boss already slows packs');
  g.pendingBossSpawns.length = 0;
  g.enemyManager.queueSpawn('brood_queen', 3000, 3000, 1, { instant: true, wave: 3 });
  step(g.enemyManager, g.player, 2);
  assert.ok(g.enemyManager.enemies.some(e => e.isBoss));
  assert.ok(Math.abs(g.packInterval() - base / TUNING.bossPackRate) < 1e-9, 'a live boss slows packs');
  g.wave = 4;
  assert.ok(Math.abs(g.packInterval() - spawnIntervalAt(4) * hpBudgetScale(4)) < 1e-9, 'next wave: full rate, boss or not');
});

test('a boss wave schedules its named boss with its tier; lieutenants skip boss waves', () => {
  resetTuning();
  const g = campaignGame({ wave: 2 });
  g.waveTimer = TUNING.waveLength;
  g.update(1 / 60);
  assert.equal(g.wave, 3);
  const warn = g.enemyManager.spawnIndicators.find(sp => sp.config.isBoss);
  assert.equal(warn.type, 'brood_queen');
  assert.equal(warn.config.bossTier, 'minor');
  assert.equal(warn.config.bossWave, 3);
  g.waveTimer = 10;
  g.updateLieutenantSchedule();
  assert.equal(g.enemyManager.spawnIndicators.filter(sp => sp.config.isLieutenant).length, 0);
  // Wave 6's slot flies the Dreadnought until its boss is built, at major-boss rewards.
  g.wave = 5;
  g.waveTimer = TUNING.waveLength;
  g.enemyManager.spawnIndicators.length = 0;
  g.update(1 / 60);
  const six = g.enemyManager.spawnIndicators.find(sp => sp.config.isBoss);
  assert.equal(six.type, bossBuilt(plan.BOSS_SCHEDULE[6]) ? plan.BOSS_SCHEDULE[6] : 'boss');
  assert.equal(six.config.bossTier, 'major');
  assert.equal(BOSS_TIER.major.cores, 5);
});

test('Brood Queen: arrives in a swarmer ring, peels divers and circlers, scatters at half HP, dies in mayflies', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('brood_queen', 2000, 2000, waveScaleAt(3), { instant: true, wave: 3 });
  step(m, player, 4); // she materializes, then her ring
  const q = m.enemies.find(e => e.type === 'brood_queen');
  assert.ok(q && q.isBoss);
  const ring = () => m.enemies.filter(e => e.anchor === q);
  assert.equal(ring().length, QUEEN.ring, 'the ring materializes with her');
  assert.ok(ring().every(o => o.type === 'swarmer'));
  const r0 = ring()[0];
  step(m, player, 30);
  assert.ok(Math.abs(Math.hypot(r0.x - q.x, r0.y - q.y) - r0.orbitR) < 40, 'orbiters ride her ring');
  // First peel.
  step(m, player, Math.ceil(QUEEN.peelEvery * 60));
  const loose = m.enemies.filter(e => e.type === 'swarmer' && !e.anchor);
  assert.ok(loose.length >= QUEEN.peelCount - 1, `peeled ${loose.length}`);
  assert.ok(loose.some(e => e.circleT > 0), 'some circle the ship first');
  // Half HP: the whole ring breaks loose and she speeds up.
  q.hp = q.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(q.enraged, true);
  assert.equal(ring().length, 0);
  assert.ok(q.speed > 1.4);
  const before = m.enemies.length + m.spawnIndicators.length;
  step(m, player, Math.ceil(QUEEN.rageSpawnEvery * 60) + 1);
  assert.ok(m.enemies.length + m.spawnIndicators.length > before, 'enraged, she births divers');
  // Death burst.
  q.dead = true;
  m.enemies.splice(m.enemies.indexOf(q), 1);
  BOSS_DEFS.brood_queen.onDeath(q, m);
  step(m, player, 2);
  assert.equal(m.enemies.filter(e => e.type === 'mayfly').length, QUEEN.deathMayflies);
  for (const e of m.enemies) assert.ok([e.x, e.y, e.vx, e.vy].every(Number.isFinite));
});

test('Game.killEnemy runs a boss\'s death burst and pays a major boss five cores', () => {
  resetTuning();
  const g = campaignGame({ wave: 3 });
  g.enemyManager.queueSpawn('brood_queen', 3000, 3000, 1, { instant: true, wave: 3 });
  step(g.enemyManager, g.player, 2);
  const q = g.enemyManager.enemies.find(e => e.isBoss);
  g.killEnemy(q);
  assert.equal(g.enemyManager.spawnIndicators.filter(sp => sp.type === 'mayfly').length, QUEEN.deathMayflies);
  assert.equal(g.geoms.filter(x => x.isCore).length, BOSS_TIER.minor.cores);
  const major = { type: 'boss', isBoss: true, bossTier: 'major', x: 2500, y: 2500, hp: 1, maxHp: 650, radius: 36, hue: 185, sides: 8, rotation: 0, score: 1500, xp: 30 };
  g.enemyManager.enemies.push(major);
  g.geoms.length = 0;
  g.killEnemy(major);
  assert.equal(g.geoms.filter(x => x.isCore).length, BOSS_TIER.major.cores);
});

test('mayflies twitch toward the ship; hulks are slow, sturdy sponges', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('mayfly', 2000, 2000, 1, { instant: true });
  m.queueSpawn('hulk', 2000, 2400, 1, { instant: true });
  step(m, player, 2);
  const fly = m.enemies.find(e => e.type === 'mayfly');
  const hulk = m.enemies.find(e => e.type === 'hulk');
  const headings = new Set();
  const x0 = fly.x;
  for (let i = 0; i < 120; i++) {
    step(m, player, 1);
    headings.add(Math.round(Math.atan2(fly.vy, fly.vx) * 4));
  }
  assert.ok(headings.size >= 4, 'its heading keeps snapping');
  assert.ok(fly.x > x0 + 50, 'but it drifts in on the ship');
  assert.ok(fly.maxHp < 10 && hulk.maxHp >= 300);
  assert.ok(hulk.sturdy && hulk.knockMult <= 0.1 && hulk.speed <= 1.2);
  assert.ok(!hulk.isBoss, 'the old boss hull is a regular hostile now');
  for (const id of Object.keys(HOSTILE_INFO)) assert.ok(HOSTILE_IDS.includes(id) && PREVIEW_IDS.includes(id), `${id} is in the Field Guide`);
  for (const id of Object.keys(BOSS_DEFS)) assert.ok(HOSTILE_IDS.includes(id) && PREVIEW_IDS.includes(id), `${id} is in the Field Guide`);
});

test('veteran forms: the core swarm gains an edge and speed at waves 11 and 21; tier-3 splitters burst into four', () => {
  resetTuning();
  const sides = (type, wave) => {
    const m = new EnemyManager();
    m.wave = wave;
    m.queueSpawn(type, 100, 100, 1, { instant: true });
    return m.spawnIndicators[0].config;
  };
  assert.deepEqual([1, 11, 21].map(w => sides('splitter', w).sides), [6, 7, 8]);
  assert.deepEqual([1, 11, 21].map(w => sides('pinwheel', w).tier || 1), [1, 2, 3]);
  assert.ok(sides('swarmer', 21).speed > sides('swarmer', 1).speed * 1.1);
  assert.equal(sides('bruiser', 21).tier, undefined, 'archetypes keep their form');
  const g = campaignGame({ wave: 21 });
  const sp = { type: 'splitter', tier: 3, x: 2500, y: 2500, hp: 0, maxHp: 50, radius: 20, hue: 42, sides: 8, rotation: 0, score: 95, xp: 4 };
  g.enemyManager.enemies.push(sp);
  g.killEnemy(sp);
  assert.equal(g.enemyManager.spawnIndicators.filter(s => s.type === 'mini_splitter').length, 4);
});

test('every pack type the plan can pick has a roster, and spawning each stays finite', () => {
  resetTuning();
  for (const pack of WAVE_PACKS) {
    const g = campaignGame({ wave: 30 });
    for (const p of WAVE_PACKS) TUNING[p.weightKey] = p.id === pack.id ? 1 : 0;
    g.spawnWavePack();
    assert.ok(g.enemyManager.spawnIndicators.length > 0, `${pack.id} spawns`);
    assert.ok(packRoster(pack.id, 30).length > 0);
    resetTuning();
  }
});
