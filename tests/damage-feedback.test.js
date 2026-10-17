import test from 'node:test';
import assert from 'node:assert/strict';

// Browser services are stubbed; storage is a real Map so toggle persistence is observable.
const storage = new Map();
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };

const { DamageNumbers, DAMAGE_NUMBERS_STORAGE_KEY, DAMAGE_SOURCE_COLORS, formatDamage, damageFontSize } = await import('../js/damage-numbers.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { EnemyManager, KNOCKBACK_DECAY } = await import('../js/enemies.js');
const { Game } = await import('../js/main.js');

const silent = new Proxy({}, { get: () => () => {} });
const enemy = (type = 'swarmer', extra = {}) => ({ type, x: 200, y: 200, vx: 0, vy: 0, hp: 100, maxHp: 100, radius: 10, hue: 1, score: 1, xp: 1, sides: 4, rotation: 0, ...extra });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);

function game(enemies = []) {
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies, queueSpawn() {} },
    asteroidManager: { asteroids: [], cellSize: 140, getNearbyAsteroids() { return this.asteroids; } },
    sound: silent, particles: silent, grid: silent, damageNumbers: new DamageNumbers(),
    player: { stats: { luck: 1, coreDropMult: 1, damage: 20 }, weapons: {}, upgradeLevels: {}, bombs: 1, hp: 100, maxHp: 100, x: 2000, y: 2000, xp: 0, xpToNext: 12, level: 1 },
    state: 'PLAYING', worldWidth: 4200, worldHeight: 4200, wave: 1, shake: 0, chromaFlash: 0, hitStopTicks: 0, kills: 0,
    chests: [], bullets: [], geoms: [], score: 0, multiplier: 1, coresDroppedThisWave: 0,
    updateHUD() {}, progression: { addCores() {} }
  });
}

test('rapid hits on one enemy from one source merge into a single rising total', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  const e = enemy();
  dn.add(e, 11, 'blaster');
  dn.update(1 / 60);
  dn.add(e, 11, 'blaster');
  dn.update(0.2);
  const n = dn.add(e, 11.4, 'blaster');
  assert.equal(dn.count, 1);
  assert.equal(n.text, '33');
  assert.ok(n.pop > 0, 'a merge pops the number so the change is visible');

  // A different weapon on the same enemy keeps its own colour-coded number.
  dn.add(e, 7, 'orbital');
  assert.equal(dn.count, 2);

  // A different enemy never merges.
  dn.add(enemy('swarmer', { x: 400 }), 5, 'blaster');
  assert.equal(dn.count, 3);
});

test('a pause in hits, or a long burst, starts a fresh number', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  const e = enemy();
  const first = dn.add(e, 10, 'blaster');
  dn.update(0.45);
  const second = dn.add(e, 10, 'blaster');
  assert.notEqual(first, second);
  assert.equal(second.text, '10');
  assert.equal(first.text, '10', 'the finished total keeps floating unchanged');

  // A continuous grind (orbital every tick) rolls over after about a second so totals read as DPS.
  const grind = new DamageNumbers();
  const target = enemy();
  const seen = new Set();
  for (let t = 0; t < 120; t++) { seen.add(grind.add(target, 2, 'orbital')); grind.update(1 / 60); }
  assert.equal(seen.size, 2);
});

test('live numbers are hard-capped and the pool never grows', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  const poolSize = dn.pool.length;
  for (let i = 0; i < 300; i++) {
    dn.add(enemy('swarmer', { x: (i % 20) * 40, y: Math.floor(i / 20) * 60 }), 10 + i, 'blaster');
    assert.ok(dn.count <= TUNING.damageNumberCap);
  }
  assert.equal(dn.count, TUNING.damageNumberCap);
  assert.equal(dn.pool.length, poolSize);
  // Lowering the cap live shrinks the set on the next spawn.
  TUNING.damageNumberCap = 10;
  dn.add(enemy(), 1, 'missile');
  assert.equal(dn.count, 10);
  // Everything expires and slots are reused.
  for (let t = 0; t < 120; t++) dn.update(1 / 60);
  assert.equal(dn.count, 0);
  resetTuning();
});

test('a packed cluster stacks numbers into at most three lanes instead of overprinting', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  const made = [];
  for (let i = 0; i < 10; i++) made.push(dn.add(enemy('swarmer', { x: 200, y: 200 }), 10, 'singularity'));
  const live = made.filter(Boolean);
  assert.equal(live.length, 3);
  assert.deepEqual(live.map(n => n.oy), [0, -14, -28]);
  // Once those float away, the spot accepts new numbers again.
  for (let t = 0; t < 60; t++) dn.update(1 / 60);
  assert.ok(dn.add(enemy('swarmer', { x: 200, y: 200 }), 10, 'singularity'));
});

test('a number riding its target never slides onto another live number, and wide totals keep clear', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  const pulled = enemy('swarmer', { x: 100, y: 200 });
  const anchor = enemy('swarmer', { x: 300, y: 200 });
  const a = dn.add(pulled, 10, 'singularity');
  const b = dn.add(anchor, 10, 'singularity');
  const before = { x: a.x, y: a.y };
  // A singularity drags the first target right under the second number while it keeps grinding.
  pulled.x = anchor.x;
  dn.update(1 / 60);
  dn.add(pulled, 10, 'singularity');
  assert.equal(a.text, '20', 'the total still merges');
  assert.deepEqual({ x: a.x, y: a.y }, before, 'but it holds its spot instead of overprinting');
  assert.equal(b.text, '10');

  // Free to follow when the destination is clear.
  pulled.x = 160;
  dn.update(1 / 60);
  dn.add(pulled, 10, 'singularity');
  assert.equal(a.x, 160 + a.ox);

  // A 4-digit total blocks a neighbour 30px away that a 2-digit one would not.
  const wide = new DamageNumbers();
  wide.add(enemy('boss', { x: 500, radius: 10 }), 2203, 'singularity');
  const next = wide.add(enemy('swarmer', { x: 530 }), 10, 'singularity');
  assert.ok(next.oy < 0, 'stepped up a lane instead of fusing into one long number');
});

test('damage numbers toggle persists across sessions and survives blocked storage', () => {
  storage.clear(); resetTuning();
  const dn = new DamageNumbers();
  assert.equal(dn.enabled, true, 'on by default');
  dn.add(enemy(), 10, 'blaster');
  assert.equal(dn.toggle(), false);
  assert.equal(storage.get(DAMAGE_NUMBERS_STORAGE_KEY), '0');
  assert.equal(dn.count, 0, 'turning off clears live numbers');
  assert.equal(dn.add(enemy(), 10, 'blaster'), null, 'nothing is recorded while off');
  assert.equal(new DamageNumbers().enabled, false, 'a new session reads the saved preference');
  dn.toggle();
  assert.equal(storage.get(DAMAGE_NUMBERS_STORAGE_KEY), '1');
  assert.equal(new DamageNumbers().enabled, true);

  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  try {
    const blocked = new DamageNumbers();
    assert.equal(blocked.enabled, true);
    assert.doesNotThrow(() => blocked.toggle());
    assert.equal(blocked.enabled, false);
  } finally {
    globalThis.localStorage = saved;
  }
});

test('the game toggle flips the shared damage-number state', () => {
  storage.clear(); resetTuning();
  const g = game();
  g.toggleDamageNumbers();
  assert.equal(g.damageNumbers.enabled, false);
  assert.equal(storage.get(DAMAGE_NUMBERS_STORAGE_KEY), '0');
  g.toggleDamageNumbers();
  assert.equal(g.damageNumbers.enabled, true);
});

test('number formatting stays exact for normal hits and size grows gently with damage', () => {
  assert.equal(formatDamage(0.2), '1');
  assert.equal(formatDamage(11.4), '11');
  assert.equal(formatDamage(99999), '99999');
  assert.equal(formatDamage(123456), '123.5K');
  assert.ok(damageFontSize(10) < damageFontSize(100) && damageFontSize(100) < damageFontSize(1000));
  assert.ok(damageFontSize(1e9) <= 26);
  for (const src of ['blaster', 'missile', 'lightning', 'orbital', 'singularity', 'supernova']) {
    assert.match(DAMAGE_SOURCE_COLORS[src], /^#[0-9a-f]{6}$/i);
  }
  assert.equal(new Set(Object.values(DAMAGE_SOURCE_COLORS)).size, Object.keys(DAMAGE_SOURCE_COLORS).length, 'every source has its own colour');
});

test('weapon hits are tagged by source and knock light hulls back, never bosses', () => {
  storage.clear(); resetTuning();
  const light = enemy('swarmer');
  const heavy = enemy('splitter', { radius: 20, y: 400 });
  const boss = enemy('boss', { isBoss: true, radius: 36, hp: 5000, maxHp: 5000, y: 600 });
  const g = game([light, heavy, boss]);
  g.bullets = [
    { x: 180, y: 200, vx: 14, vy: 0, radius: 3.8, life: 1.25, pierce: 1, damage: 10, hue: 1 },
    { x: 170, y: 400, vx: 14, vy: 0, radius: 3.8, life: 1.25, pierce: 1, damage: 10, hue: 1 },
    { x: 160, y: 600, vx: 14, vy: 0, radius: 3.8, life: 1.25, pierce: 1, damage: 10, hue: 1 }
  ];
  g.updateBullets(1 / 60);
  assert.equal(light.hp, 90);
  assert.equal(light.dmgNum.source, 'blaster');
  assert.ok(light.knockX > 0 && Math.abs(light.knockY) < 1e-9, 'pushed along the shot');
  assert.ok(heavy.knockX > 0 && heavy.knockX < light.knockX / 3, 'mass scales with hull area');
  assert.equal(boss.knockX ?? 0, 0);
  assert.equal(boss.hp, 4990);

  TUNING.knockbackMult = 0;
  const still = enemy();
  game([still]).hitEnemy(still, 1, 'blaster', 5, 0);
  assert.equal(still.knockX ?? 0, 0);
  resetTuning();

  const capped = enemy();
  const gc = game([capped]);
  for (let i = 0; i < 20; i++) gc.hitEnemy(capped, 1, 'blaster', 3, 0);
  assert.ok(Math.hypot(capped.knockX, capped.knockY) <= 4 + 1e-9, 'stacked hits cannot fling an enemy');
});

test('area, lightning, orbital and supernova damage carry their own sources', () => {
  storage.clear(); resetTuning();
  const a = enemy('pinwheel', { radius: 15, x: 230 });
  const g = game([a]);
  g.damageEnemiesInRadius(200, 200, 75, 5, 325, 'missile', 1.8);
  assert.equal(a.dmgNum.source, 'missile');
  assert.ok(a.knockX > 0, 'blast pushes outward');

  const b = enemy();
  game([b]).fireChainLightning(1, 100, 200);
  assert.equal(b.dmgNum.source, 'lightning');

  const boss = enemy('boss', { isBoss: true, radius: 36, hp: 1000, maxHp: 1000 });
  const gb = game([boss]);
  gb.player = { ...gb.player, x: 200, y: 200 };
  gb.triggerSupernova();
  assert.equal(boss.dmgNum.source, 'supernova');
  assert.equal(boss.dmgNum.text, '400');
  assert.equal(gb.hitStopTicks, 2, 'supernova lands with a short hit-stop');
});

test('kill feedback scales with durability: hit-stop and shake only on big moments', () => {
  storage.clear(); resetTuning();
  const swarm = game([enemy('swarmer', { hp: 0 })]);
  swarm.killEnemy(swarm.enemyManager.enemies[0]);
  assert.equal(swarm.hitStopTicks, 0);
  assert.equal(swarm.shake, 0, 'fodder kills do not shake the screen');

  const splitter = game([enemy('splitter', { radius: 20, sides: 6 })]);
  splitter.killEnemy(splitter.enemyManager.enemies[0]);
  assert.equal(splitter.hitStopTicks, 0);
  assert.ok(splitter.shake > 0);

  const boss = game([enemy('boss', { isBoss: true, radius: 36, sides: 8 })]);
  boss.killEnemy(boss.enemyManager.enemies[0]);
  // Boss kills take the longer of the kill-tier freeze (3 ticks) and the boss payoff hit-stop.
  assert.equal(boss.hitStopTicks, Math.max(3, Math.round(TUNING.bossHitStop * 60)));
  assert.ok(boss.shake > splitter.shake);
  assert.ok(boss.chromaFlash > 0);

  TUNING.screenShakeMult = 0;
  TUNING.hitStopMult = 0;
  TUNING.bossHitStop = 0;
  const calm = game([enemy('boss', { isBoss: true, radius: 36, sides: 8 })]);
  calm.killEnemy(calm.enemyManager.enemies[0]);
  calm.triggerSupernova();
  assert.equal(calm.shake, 0, 'screenShakeMult 0 silences every shake source');
  assert.equal(calm.hitStopTicks, 0);

  TUNING.hitStopMult = 2;
  const capped = game([enemy('boss', { isBoss: true, radius: 36, sides: 8 })]);
  capped.killEnemy(capped.enemyManager.enemies[0]);
  assert.equal(capped.hitStopTicks, 3, 'kill-tier hit-stop never exceeds three fixed ticks (boss payoff disabled above)');
  resetTuning();
});

test('hit-stop freezes the simulation for exactly the requested fixed ticks', () => {
  storage.clear(); resetTuning();
  const g = Object.assign(game(), {
    grid: { update() {} }, particles: { update() {} }, shieldRotation: 0,
    pollGamepad() { return null; }, menuState: 'PLAYING', menuGrace: 0, elapsedTime: 0, hitStopTicks: 2
  });
  let simulated = 0;
  g.enemyManager.update = () => { simulated++; };
  // Stop the rest of the tick after the clock advances; only the freeze gate matters here.
  Object.defineProperty(g, 'waveTimer', { get() { throw new Error('simulated'); }, set() {} });
  g.update(1 / 60);
  g.update(1 / 60);
  assert.equal(g.elapsedTime, 0);
  assert.equal(g.hitStopTicks, 0);
  assert.throws(() => g.update(1 / 60), /simulated/);
  assert.equal(g.elapsedTime, 1 / 60);
});

test('knockback is a decaying displacement that leaves flocking velocity alone', () => {
  storage.clear(); resetTuning();
  const m = new EnemyManager();
  const player = { x: 3000, y: 200 };
  const e = enemy('pinwheel', { x: 200, y: 200, vx: 0, vy: 0, speed: 2, radius: 15, vRot: 0, pulsePhase: 0, hitFlash: 0, trail: [], knockX: -3, knockY: 0 });
  m.enemies = [e];
  m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.ok(e.x < 200, 'the hit shoves the enemy back against its heading');
  assert.ok(e.vx > 0, 'steering velocity still points at the player');
  assert.equal(e.knockX, -3 * KNOCKBACK_DECAY);
  for (let t = 0; t < 40; t++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(e.knockX, 0);
  assert.ok(e.x > 200, 'it resumes advancing once the flinch decays');
});
