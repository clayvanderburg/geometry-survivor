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

test('boss waves: minor every 5th, major every 10th, and the schedule names one boss per campaign boss wave', () => {
  assert.equal(plan.BOSS_EVERY, 5);
  assert.equal(plan.MAJOR_BOSS_EVERY, 10);
  assert.equal(plan.CAMPAIGN_WAVES, 50);
  assert.equal(plan.FINAL_BOSS, 'prism');
  for (const w of [1, 2, 3, 4, 6, 7, 8, 9, 12, 48]) assert.equal(plan.bossTier(w), null, `wave ${w}`);
  assert.equal(plan.bossTier(5), 'minor');
  assert.equal(plan.bossTier(10), 'major');
  assert.equal(plan.bossTier(15), 'minor');
  assert.equal(plan.bossTier(50), 'major');
  for (let w = 5; w <= 50; w += 5) assert.ok(plan.BOSS_SCHEDULE[w], `wave ${w} has a boss`);
  assert.equal(Object.keys(plan.BOSS_SCHEDULE).length, 10);
  assert.deepEqual(plan.bossesForWave(5, bossBuilt), ['brood_queen']);
  assert.deepEqual(plan.bossesForWave(6, bossBuilt), []);
  // Unbuilt slots fall back to the Dreadnought stand-in.
  assert.deepEqual(plan.bossesForWave(10, () => false), ['boss']);
  assert.deepEqual(plan.bossesForWave(10, () => true), [plan.BOSS_SCHEDULE[10]]);
});

test('past wave 50 (endless) bosses come in combos: two minors, or a major with a minor', () => {
  const all = () => true;
  const minor = new Set([5, 15, 25, 35, 45].map(w => plan.BOSS_SCHEDULE[w]));
  const major = new Set([10, 20, 30, 40, 50].map(w => plan.BOSS_SCHEDULE[w]));
  for (const w of [51, 52, 53, 54, 56]) assert.deepEqual(plan.bossesForWave(w, all), [], `wave ${w}`);
  for (let w = 55; w <= 150; w += 5) {
    const ids = plan.bossesForWave(w, all);
    assert.equal(ids.length, 2, `wave ${w}`);
    if (plan.bossTier(w) === 'minor') assert.ok(ids.every(id => minor.has(id)), `wave ${w}: ${ids}`);
    else assert.ok(major.has(ids[0]) && minor.has(ids[1]), `wave ${w}: ${ids}`);
    assert.notEqual(ids[0], ids[1]);
  }
});

test('every wave has a theme; past 50 two earlier themes are remixed', () => {
  assert.equal(plan.WAVE_THEMES.length, 51, 'one theme per campaign wave');
  assert.equal(new Set(plan.WAVE_THEMES.slice(1).map(t => t.name)).size, 50, 'every campaign theme has its own name');
  for (let w = 1; w <= 100; w++) {
    const t = plan.waveTheme(w);
    assert.ok(t && t.name.length > 3, `wave ${w}`);
    for (const [id, m] of Object.entries(t.bias || {})) assert.ok(m > 0, `${w} ${id}`);
  }
  assert.match(plan.waveTheme(51).name, / × /);
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
  assert.ok(!counts(4).mayfly, 'no mayflies before the Brood Queen');
  assert.ok(counts(5).mayfly > 0);
  // MAYFLY BLOOM (wave 6) triples the mayfly weight.
  const bloom = counts(6).mayfly / 6000;
  const plain = 14 / (40 + 20 + 18 + 14);
  assert.ok(bloom > plain * 1.8, `bloom share ${bloom.toFixed(2)} vs plain ${plain.toFixed(2)}`);
  TUNING.spawnWeightMayfly = 0;
  assert.ok(!counts(6).mayfly, 'a zero weight still disables a pack');
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
  const g = campaignGame({ wave: 5 });
  const base = spawnIntervalAt(5) * hpBudgetScale(5);
  assert.ok(Math.abs(g.packInterval() - base) < 1e-9, 'no boss yet: the normal pace');
  g.pendingBossSpawns.push({ id: 'brood_queen', wave: 5, waveScale: 1 });
  assert.ok(Math.abs(g.packInterval() - base / TUNING.bossPackRate) < 1e-9, 'a pending boss already slows packs');
  g.pendingBossSpawns.length = 0;
  g.enemyManager.queueSpawn('brood_queen', 3000, 3000, 1, { instant: true, wave: 5 });
  step(g.enemyManager, g.player, 2);
  assert.ok(g.enemyManager.enemies.some(e => e.isBoss));
  assert.ok(Math.abs(g.packInterval() - base / TUNING.bossPackRate) < 1e-9, 'a live boss slows packs');
  g.wave = 6;
  assert.ok(Math.abs(g.packInterval() - spawnIntervalAt(6) * hpBudgetScale(6)) < 1e-9, 'next wave: full rate, boss or not');
});

test('a boss wave schedules its named boss with its tier; lieutenants skip boss waves', () => {
  resetTuning();
  const g = campaignGame({ wave: 4 });
  g.waveTimer = TUNING.waveLength;
  g.update(1 / 60);
  assert.equal(g.wave, 5);
  const warn = g.enemyManager.spawnIndicators.find(sp => sp.config.isBoss);
  assert.equal(warn.type, 'brood_queen');
  assert.equal(warn.config.bossTier, 'minor');
  assert.equal(warn.config.bossWave, 5);
  g.waveTimer = 10;
  g.updateLieutenantSchedule();
  assert.equal(g.enemyManager.spawnIndicators.filter(sp => sp.config.isLieutenant).length, 0);
  // Wave 10 brings the first major boss, at major-boss rewards.
  g.wave = 9;
  g.waveTimer = TUNING.waveLength;
  g.enemyManager.spawnIndicators.length = 0;
  g.update(1 / 60);
  const ten = g.enemyManager.spawnIndicators.find(sp => sp.config.isBoss);
  assert.equal(ten.type, bossBuilt(plan.BOSS_SCHEDULE[10]) ? plan.BOSS_SCHEDULE[10] : 'boss');
  assert.equal(ten.config.bossTier, 'major');
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

test('mayflies twitch toward the ship; hulks are slow, sturdy sponges', (t) => {
  resetTuning();
  t.mock.method(Math, 'random', seeded(11)); // deterministic twitching
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

test('serpent: the head winds in, the body follows like a rope and blocks shots, and a dead head unzips the body', async () => {
  resetTuning();
  const { SERPENT, spawnSerpent } = await import('../js/serpents.js');
  const g = campaignGame({ wave: 7 });
  const m = g.enemyManager;
  spawnSerpent(m, 'serpent', 2600, 2000, 1, SERPENT.segments, { angle: Math.PI, extra: { instant: true } });
  step(m, g.player, 3);
  const head = m.enemies.find(e => e.type === 'serpent' && !e.leader);
  const body = m.enemies.filter(e => e.leader);
  assert.ok(head && body.length === SERPENT.segments);
  assert.ok(body.every(s => s.deflect && s.sturdy && s.hp === 1));
  step(m, g.player, 90);
  for (const s of body) assert.ok(Math.hypot(s.x - s.leader.x, s.y - s.leader.y) <= s.gap + 8, 'segments keep their spacing (within a tick of travel)');
  // Shots at the body do nothing; auto-aim goes for the head.
  g.hitEnemy(body[3], 500);
  assert.equal(body[3].hp, 1);
  assert.ok(!body[3].dead);
  assert.equal(g.findAutoAimTarget(body[0].x + 1, body[0].y), head, 'auto-aim prefers the head over a closer body plate');
  // Kill the head: the body pops plate by plate through the game's kill path.
  const kills = g.kills;
  g.hitEnemy(head, head.hp + 1);
  for (let i = 0; i < 60 && m.enemies.some(e => e.type === 'serpent'); i++) g.update(1 / 60);
  assert.equal(m.enemies.filter(e => e.type === 'serpent').length, 0);
  assert.equal(g.kills - kills, SERPENT.segments + 1);
});

test('Ouroboros: arrives with its body, sheds tail serpents, then coils, rears, strikes and winds from half HP', async () => {
  resetTuning();
  const { OURO } = await import('../js/bosses.js');
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('ouroboros', 2000, 2000, waveScaleAt(6), { instant: true, wave: 6 });
  step(m, player, 4);
  const q = m.enemies.find(e => e.type === 'ouroboros');
  assert.ok(q.isBoss && q.bossTier === 'major');
  const body = () => m.enemies.filter(e => e.leader && e.bossBody && !e.doomQueued);
  assert.equal(body().length, OURO.segments);
  step(m, player, Math.ceil(OURO.shedEvery * 60) + 3);
  assert.equal(body().length, OURO.segments - OURO.shedSegments, 'the tail was shed');
  assert.ok(m.doomed.every(s => s.noReward), 'a shed tail crumbles without rewards');
  assert.ok(m.enemies.some(e => e.type === 'serpent' && !e.leader && !e.isBoss), 'a small serpent wriggled free');
  m.doomed.length = 0;
  q.hp = q.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(q.state, 'coil');
  const seen = new Set();
  for (let i = 0; i < 60 * 12; i++) { step(m, player, 1); seen.add(q.state); }
  assert.deepEqual([...seen].sort(), ['coil', 'rear', 'strike', 'wind']);
  assert.ok([q.x, q.y].every(Number.isFinite));
});

test('kestrels: a V holds formation on strafing runs, and scatters onto solo runs when its leader dies', async () => {
  resetTuning();
  const { spawnWing, slotOffset, KESTREL } = await import('../js/squadrons.js');
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  spawnWing(m, 2000, 2000, 1, 4, { angle: 0, extra: { instant: true } });
  step(m, player, 3);
  const lead = m.enemies.find(e => e.type === 'kestrel' && !e.wingLeader);
  const wing = m.enemies.filter(e => e.wingLeader === lead);
  assert.equal(wing.length, 4);
  const states = new Set();
  for (let i = 0; i < 60 * 8; i++) { step(m, player, 1); states.add(lead.state); }
  assert.ok(states.has('run') && states.has('turn'), 'leader alternates runs and turns');
  for (const w of wing) {
    const o = slotOffset(w.wingSlot);
    const c = Math.cos(lead.aimAngle), s = Math.sin(lead.aimAngle);
    const tx = lead.x - c * o.back - s * o.side, ty = lead.y - s * o.back + c * o.side;
    assert.ok(Math.hypot(w.x - tx, w.y - ty) < 40, `slot ${w.wingSlot} held`);
  }
  lead.dead = true;
  m.enemies.splice(m.enemies.indexOf(lead), 1);
  step(m, player, 2);
  assert.ok(wing.every(w => w.wingLeader === null && (w.state === 'turn' || w.state === 'run')), 'wingmen scatter');
  assert.ok(KESTREL.speed < 5, 'slower than the ship at base thrust');
});

test('Wing Commander: leads a V, lays mine lines on runs, reinforces, scrambles and fans at half HP', async () => {
  resetTuning();
  const { WING } = await import('../js/bosses.js');
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('wing_commander', 1800, 2000, waveScaleAt(9), { instant: true, wave: 9 });
  step(m, player, 4);
  const c = m.enemies.find(e => e.type === 'wing_commander');
  const escort = () => m.enemies.filter(e => e.wingLeader === c);
  assert.equal(escort().length, WING.escort);
  let mines = 0;
  for (let i = 0; i < 60 * 5 && !mines; i++) { step(m, player, 1); mines = m.enemyBullets.count; }
  assert.ok(mines > 0, 'a run lays mines');
  // Lose two wingmen: the next run calls them back.
  for (const o of escort().slice(0, 2)) { o.dead = true; m.enemies.splice(m.enemies.indexOf(o), 1); }
  for (let i = 0; i < 60 * 10 && escort().length < WING.escort; i++) step(m, player, 1);
  assert.equal(escort().length, WING.escort, 'reinforced');
  c.hp = c.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(c.enraged, true);
  assert.equal(escort().length, 0, 'the escort scrambles');
});

test('Wing Commander arriving already lined up never double-books its escort slots', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('wing_commander', 1800, 2000, 1, { instant: true, wave: 9 });
  step(m, player, 2);
  const c = m.enemies.find(e => e.type === 'wing_commander');
  c.aimAngle = 0; // facing the ship: its first tick starts a run before the escort is live
  c.state = 'turn';
  step(m, player, 4);
  const slots = m.enemies.filter(e => e.wingLeader === c).map(e => e.wingSlot).sort();
  assert.deepEqual(slots, [1, 2, 3, 4, 5, 6]);
});

test('carriers hang back and launch capped drones that home in and burn out', async () => {
  resetTuning();
  const { CARRIER, DRONE } = await import('../js/hostiles.js');
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('carrier', 2000, 2000, 1, { instant: true });
  step(m, player, 2);
  const c = m.enemies.find(e => e.type === 'carrier');
  step(m, player, 60 * 12);
  const drones = m.enemies.filter(e => e.type === 'drone' && e.parent === c);
  assert.ok(drones.length > 0 && drones.length <= CARRIER.maxDrones, `${drones.length} drones`);
  assert.ok(Math.abs(Math.hypot(c.x - player.x, c.y - player.y) - CARRIER.range) < CARRIER.band + 120, 'holds its range');
  // Burn-out: a drone past its life is doomed without a reward.
  step(m, player, Math.ceil(DRONE.life * 60) + 2);
  assert.ok(m.doomed.some(e => e.type === 'drone' && e.noReward));
});

test('Hive Carrier: bays shield the core and launch drones; with every bay down the core is exposed', async () => {
  resetTuning();
  const { HIVE } = await import('../js/bosses.js');
  const g = campaignGame({ wave: 12 });
  const m = g.enemyManager;
  m.queueSpawn('hive_carrier', 2400, 2000, waveScaleAt(12), { instant: true, wave: 12 });
  step(m, g.player, 4);
  const h = m.enemies.find(e => e.type === 'hive_carrier');
  const bays = m.enemies.filter(e => e.mount === h);
  assert.equal(bays.length, HIVE.bays);
  assert.ok(h.deflect, 'shielded while bays stand');
  const hp = h.hp;
  g.hitEnemy(h, 999);
  assert.equal(h.hp, hp, 'shots spark off the shielded core');
  step(m, g.player, 60 * 4);
  assert.ok(m.enemies.some(e => e.type === 'drone' && bays.includes(e.parent)), 'bays launch drones');
  for (const b of bays) assert.ok(Math.abs(Math.hypot(b.x - h.x, b.y - h.y) - HIVE.bayRadius) < 1, 'bays ride the hull');
  for (const b of bays) g.killEnemy(b);
  step(m, g.player, 1);
  assert.equal(h.phase, 2);
  assert.equal(h.deflect, false, 'core exposed');
  step(m, g.player, 60);
  assert.ok(m.enemyBullets.count > 4, 'the exposed core sprays a spiral');
  step(m, g.player, 60 * HIVE.podEvery);
  assert.ok(m.enemies.some(e => e.type === 'gunner' && e.parent === h), 'gunner pods');
  // Killing the core pops anything still mounted.
  m.queueSpawn('hive_bay', h.x, h.y, 1, { instant: true, attach: { mount: h, mountA: 0, mountR: 50 } });
  step(m, g.player, 2);
  g.killEnemy(h);
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  assert.ok(!m.enemies.some(e => e.mount === h));
});

test('Event Horizon: a gravity well that tugs the ship, swallows hostiles to heal, breathes orb rings and spits vortexes', async () => {
  resetTuning();
  const { HORIZON } = await import('../js/bosses.js');
  const g = campaignGame({ wave: 15 });
  const m = g.enemyManager;
  m.queueSpawn('event_horizon', 2300, 2000, waveScaleAt(15), { instant: true, wave: 15 });
  step(m, g.player, 5); // it materializes, then its escort
  const h = m.enemies.find(e => e.type === 'event_horizon');
  assert.equal(m.enemies.filter(e => e.type === 'hulk').length, HORIZON.escortHulks, 'arrives with hulks');
  assert.ok(g.collectGravityWells().includes(h), 'counts as a gravity well');
  g.player.vx = g.player.vy = 0;
  g.applyWellPullToPlayer(g.player);
  assert.ok(g.player.vx > 0, 'tugs the ship toward it');
  // Feed it: a swarmer at the core is swallowed and heals it.
  h.hp = h.maxHp * 0.7;
  m.queueSpawn('swarmer', h.x + 5, h.y, 1, { instant: true });
  step(m, g.player, 3);
  assert.ok(h.hp > h.maxHp * 0.7, 'healed by feeding');
  assert.ok(m.doomed.some(e => e.type === 'swarmer' && e.noReward));
  m.doomed.length = 0;
  // Breath: inhale, then a ring of orbs.
  step(m, g.player, Math.ceil((HORIZON.breathEvery + HORIZON.inhaleTime) * 60) + 2);
  assert.ok(m.enemyBullets.count >= HORIZON.ring, 'exhales a ring of orbs');
  h.hp = h.maxHp * 0.49;
  step(m, g.player, 3);
  assert.equal(h.enraged, true);
  assert.equal(m.enemies.filter(e => e.type === 'blackhole').length, HORIZON.vortexes, 'spits out vortexes');
});

test('laser gates: flying through the beam detonates them and wrecks nearby hostiles; the pylons hurt', async () => {
  resetTuning();
  const { GATE, gatePylons } = await import('../js/gates.js');
  const g = campaignGame({ wave: 18 });
  const m = g.enemyManager;
  g.player.invuln = 0;
  m.queueSpawn('gate', g.player.x, g.player.y, 1, { instant: true, attach: { rotation: Math.PI / 2 } });
  m.queueSpawn('pinwheel', g.player.x + 120, g.player.y, 1, { instant: true });
  step(m, g.player, 2);
  const gate = m.enemies.find(e => e.type === 'gate');
  const pin = m.enemies.find(e => e.type === 'pinwheel');
  const shield = g.player.hp;
  assert.equal(g.gateContact(gate, g.player), false);
  assert.ok(gate.dead, 'crossing the beam detonates it');
  assert.ok(pin.dead, 'the blast wrecks hostiles nearby');
  assert.equal(g.player.hp, shield, 'free for the pilot');
  // A pylon is solid.
  m.queueSpawn('gate', 3000, 3000, 1, { instant: true, attach: { rotation: 0 } });
  step(m, g.player, 2);
  const g2 = m.enemies.find(e => e.type === 'gate');
  const [a] = gatePylons(g2);
  g.player.x = a.x; g.player.y = a.y + GATE.pylonRadius;
  g.gateContact(g2, g.player);
  assert.ok(g.player.hp < shield, 'a pylon hits like a hull');
  assert.ok(!g2.dead);
});

test('the Architect builds gates round the ship and, from half HP, drops closing cages', async () => {
  resetTuning();
  const { ARCH } = await import('../js/bosses.js');
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  m.queueSpawn('architect', 2000, 2000, waveScaleAt(18), { instant: true, wave: 18 });
  step(m, player, 4);
  const a = m.enemies.find(e => e.type === 'architect');
  assert.equal(m.enemies.filter(e => e.type === 'shielder').length, ARCH.guards);
  step(m, player, 60 * 6);
  const gates = m.enemies.filter(e => e.type === 'gate' && e.builder === a);
  assert.ok(gates.length >= 2, `${gates.length} gates built`);
  a.hp = a.maxHp * 0.49;
  step(m, player, 75); // the cage drops 0.5 s in and beams in over 0.5 s
  const cage = m.enemies.filter(e => e.cage);
  assert.equal(cage.length, ARCH.cageGates, 'a cage of gates');
  const r0 = Math.hypot(cage[0].x - player.x, cage[0].y - player.y);
  step(m, player, 60 * 2);
  assert.ok(Math.hypot(cage[0].x - player.x, cage[0].y - player.y) < r0 - 30, 'the cage closes in');
});

test('mitosis cells grow, then split in two, up to the field cap', async () => {
  resetTuning();
  const { MITOSIS } = await import('../js/hostiles.js');
  const m = new EnemyManager();
  const player = { x: 3400, y: 2000 };
  m.queueSpawn('mitosis', 2000, 2000, 1, { instant: true });
  step(m, player, 2);
  const c = m.enemies.find(e => e.type === 'mitosis');
  const r0 = c.radius;
  const hp0 = c.maxHp;
  step(m, player, Math.ceil(MITOSIS.growTime * 60 * 0.5));
  assert.ok(c.radius > r0 * 1.2 && c.maxHp > hp0 * 1.2, 'it grows');
  step(m, player, Math.ceil(MITOSIS.growTime * 60 * 0.5) + 4);
  assert.equal(m.enemies.filter(e => e.type === 'mitosis').length, 2, 'then splits in two');
  assert.ok(c.radius < r0 * 1.1, 'and shrinks back');
  step(m, player, Math.ceil(MITOSIS.growTime * 60 * 6));
  assert.ok(m.enemies.filter(e => e.type === 'mitosis').length <= MITOSIS.cap, 'capped');
});

test('Progenitor: splits 1 → 2 → 4 → mitosis cells; pieces merge when left alone; only the last piece pays out', async (t) => {
  t.mock.method(Math, 'random', seeded(21)); // deterministic splits and drift (it failed on an unlucky draw now and then)
  resetTuning();
  const { PROG } = await import('../js/bosses.js');
  const g = campaignGame({ wave: 21 });
  const m = g.enemyManager;
  m.queueSpawn('progenitor', 2400, 2000, waveScaleAt(21), { instant: true, wave: 21 });
  step(m, g.player, 3);
  m.bossArrivals.length = 0;
  const root = m.enemies.find(e => e.type === 'progenitor');
  assert.equal(root.gen, 0);
  const pieces = () => m.enemies.filter(e => e.type === 'progenitor' && !e.dead);
  g.killEnemy(root);
  step(m, g.player, 2);
  assert.equal(pieces().length, PROG.children, 'gen 1');
  assert.equal(g.chests.length, 0, 'no boss payout yet');
  assert.equal(m.bossArrivals.length, 0, 'split pieces are not new arrivals');
  // Left alone, the two gen-1 pieces drift together and merge back into one gen-0 cell.
  for (const p of pieces()) { p.sinceHit = 99; p.x = 2400; p.y = 2000 + (p === pieces()[0] ? -20 : 20); }
  step(m, g.player, 3);
  assert.equal(pieces().length, 1, 'merged');
  assert.equal(pieces()[0].gen, 0);
  // Split it all the way down.
  for (let guard = 0; guard < 20 && pieces().length; guard++) {
    for (const p of pieces()) g.killEnemy(p);
    step(m, g.player, 2);
  }
  assert.equal(pieces().length, 0);
  assert.equal(g.chests.length, 1, 'exactly one boss payout');
  assert.ok(m.enemies.some(e => e.type === 'mitosis'), 'the last generation bursts into mitosis cells');
});

test('repulsor fields swing bolts away until twelve of them overload the field', async () => {
  resetTuning();
  const { REPULSOR } = await import('../js/hostiles.js');
  const g = campaignGame({ wave: 24 });
  const m = g.enemyManager;
  m.queueSpawn('repulsor', 2400, 2000, 1, { instant: true });
  step(m, g.player, 2);
  const f = m.enemies.find(e => e.type === 'repulsor');
  const bolt = () => ({ x: f.x - REPULSOR.field + 5, y: f.y, vx: 9, vy: 0 });
  const b = bolt();
  g.bullets = [b];
  for (let i = 0; i < 12; i++) { b.x += b.vx; b.y += b.vy; g.repelProjectiles(); }
  assert.ok(Math.hypot(b.x - f.x, b.y - f.y) > f.radius * 2, 'a head-on bolt is swung away');
  assert.ok(f.fieldCharge < REPULSOR.charge);
  g.bullets = Array.from({ length: REPULSOR.charge }, bolt);
  g.repelProjectiles();
  assert.ok(f.overloadT > 0, 'enough bolts overload the field');
  const c = bolt();
  g.bullets = [c];
  g.repelProjectiles();
  assert.equal(c.vy, 0, 'an overloaded field turns nothing');
});

test('the Conductor links hostiles, is shielded while four links hold, and plays the crescendo at half HP', async () => {
  resetTuning();
  const { COND } = await import('../js/bosses.js');
  const g = campaignGame({ wave: 24 });
  const m = g.enemyManager;
  m.queueSpawn('conductor', 2300, 2000, waveScaleAt(24), { instant: true, wave: 24 });
  step(m, g.player, 5);
  const c = m.enemies.find(e => e.type === 'conductor');
  assert.ok(m.enemies.some(e => e.type === 'repulsor' && e.parent === c), 'its choir has a Repulsor');
  step(m, g.player, 2);
  assert.ok(c.links.length >= COND.shieldLinks && c.deflect, 'linked and shielded');
  assert.ok(c.links.every(o => o.linked > 0), 'links carry the Conduit buff');
  const hp = c.hp;
  g.hitEnemy(c, 999);
  assert.equal(c.hp, hp, 'untouchable while conducting');
  // Silence the choir: the shield drops.
  for (const o of [...c.links]) g.killEnemy(o);
  for (const o of m.enemies.filter(o => o !== c && !o.isBoss)) g.killEnemy(o);
  m.spawnIndicators.length = 0;
  step(m, g.player, 1);
  assert.equal(c.deflect, false);
  g.hitEnemy(c, 10);
  assert.ok(c.hp < hp);
  // Crescendo: linked hulls fire at the ship.
  c.hp = c.maxHp * 0.49;
  c.aiTimer = 0; // call the choir back
  step(m, g.player, 4);
  m.enemyBullets.clear();
  step(m, g.player, Math.ceil(COND.crescendoEvery * 60) + 2);
  assert.ok(c.enraged && m.enemyBullets.count > 0, 'linked hulls fire orbs');
});

test('lancers plant, telegraph a locking line, then sweep a beam that burns the ship', async () => {
  resetTuning();
  const { LANCE } = await import('../js/lancers.js');
  const g = campaignGame({ wave: 27 });
  const m = g.enemyManager;
  g.player.invuln = 0;
  m.queueSpawn('lancer', g.player.x - 300, g.player.y, 1, { instant: true });
  step(m, g.player, 2);
  const l = m.enemies.find(e => e.type === 'lancer');
  l.lanceT = 0;
  const seen = new Set();
  let burned = false;
  const shield = g.player.hp;
  for (let i = 0; i < 60 * 4; i++) {
    g.update(1 / 60);
    seen.add(l.lanceState);
    if (g.player.hp < shield) { burned = true; break; }
  }
  assert.ok(seen.has('aim'), 'aims first');
  assert.ok(burned, 'the beam burns a ship that stands still');
  assert.ok(LANCE.lockAt < LANCE.aimTime);
});

test('Eclipse Twins: a tethered pair; kill one and the other enrages, and its twin revives unless it dies in time', async () => {
  resetTuning();
  const { TWINS } = await import('../js/bosses.js');
  const g = campaignGame({ wave: 27 });
  const m = g.enemyManager;
  m.queueSpawn('eclipse_twins', 2300, 2000, waveScaleAt(27), { instant: true, wave: 27 });
  step(m, g.player, 5);
  m.bossArrivals.length = 0;
  const twins = () => m.enemies.filter(e => e.type === 'eclipse_twins');
  assert.equal(twins().length, 2);
  const sol = twins().find(e => e.twinRole === 'sol');
  const luna = twins().find(e => e.twinRole === 'luna');
  step(m, g.player, 2);
  assert.ok(sol.beam && Math.hypot(sol.beam.x2 - luna.x, sol.beam.y2 - luna.y) < 10, 'SOL carries a tether to LUNA');
  g.killEnemy(luna);
  assert.equal(g.chests.length, 0, 'no payout for the first twin');
  assert.ok(sol.reviveT > 0, 'the revive clock starts');
  step(m, g.player, Math.ceil(TWINS.reviveTime * 60) + 3);
  const back = twins().find(e => e.twinRole === 'luna');
  assert.ok(back, 'LUNA returns');
  assert.ok(Math.abs(back.hp - back.maxHp * TWINS.reviveHp) < back.maxHp * 0.05, 'at half HP');
  g.killEnemy(back);
  g.killEnemy(sol);
  assert.equal(g.chests.length, 1, 'both down: one payout');
});

test('The Prism: swarm ring, then gate cages, then a gravity well with orb rings and a sweeping beam', async () => {
  resetTuning();
  const { PRISM } = await import('../js/bosses.js');
  const { bossBuilt: built } = await import('../js/bosses.js');
  for (let w = 5; w <= 50; w += 5) assert.ok(built(plan.BOSS_SCHEDULE[w]), `wave ${w} has its named boss`);
  const g = campaignGame({ wave: 50 });
  const m = g.enemyManager;
  m.queueSpawn('prism', 2300, 2000, waveScaleAt(50), { instant: true, wave: 50 });
  step(m, g.player, 5);
  const p = m.enemies.find(e => e.type === 'prism');
  assert.equal(p.bossTier, 'major');
  assert.equal(m.enemies.filter(e => e.anchor === p).length, PRISM.ring, 'phase 1: a shard ring');
  const hue0 = p.hue;
  step(m, g.player, 30);
  assert.notEqual(p.hue, hue0, 'it cycles through the spectrum');
  p.hp = p.maxHp * 0.6;
  step(m, g.player, 1);
  assert.equal(p.phase, 1);
  assert.equal(m.enemies.filter(e => e.anchor === p).length, 0, 'the ring breaks');
  step(m, g.player, 150);
  assert.ok(m.enemies.some(e => e.cage && e.builder === p), 'phase 2: gate cages');
  p.hp = p.maxHp * 0.3;
  step(m, g.player, 1);
  assert.equal(p.phase, 2);
  assert.ok(g.collectGravityWells().includes(p), 'phase 3: a gravity well');
  step(m, g.player, Math.ceil(PRISM.beamWarmup * 60) + 2);
  assert.ok(p.beam, 'with a sweeping beam');
  const a0 = Math.atan2(p.beam.y2 - p.y, p.beam.x2 - p.x);
  step(m, g.player, 30);
  assert.ok(Math.abs(Math.atan2(p.beam.y2 - p.y, p.beam.x2 - p.x) - a0) > 0.1, 'the beam turns');
  step(m, g.player, Math.ceil(PRISM.breathEvery * 60));
  assert.ok(m.enemyBullets.count >= PRISM.orbRing, 'orb rings');
});
