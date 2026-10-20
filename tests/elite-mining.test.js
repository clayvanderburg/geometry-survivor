import test from 'node:test';
import assert from 'node:assert/strict';

// Elite mining: lieutenants and bosses (the Field Guide ELITES group) plow straight at the ship and
// grind through the rock in their way at the ship's BASE drill DPS; normal enemies are unchanged.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, addEventListener() {} });
globalThis.document = { getElementById: element, createElement: element };

const { Game } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');
const { AsteroidManager, ELITE_GRIND_MAX_ROCKS } = await import('../js/asteroids.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { eliteMiningDps, isElite, plowsThroughRock, steerAroundRocks } = await import('../js/pursuit.js');
const { HOSTILE_ENTRIES, MECHANIC_ENTRIES } = await import('../js/field-guide.js');

const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);
const DT = 1 / 60;

// A ship far from everything, with heavily upgraded mining that must NOT leak into elite grinding.
const farShip = (x = 3800, y = 3800) => ({ x, y, vx: 0, vy: 0, radius: 15, angle: 0, stats: { miningSpeed: 9999, miningRange: 43 } });

function rockAt(x, y, radius, hp = 1e6, oreType = 'rock') {
  return { x, y, radius, hp, maxHp: hp, hitFlash: 0, sides: 6, verts: [], rotation: 0, oreType, hue: 205 };
}

function field(rocks) {
  const am = new AsteroidManager(4200, 4200);
  am.asteroids = rocks;
  am.rebuildSpatialHash();
  return am;
}

// A hull pressed into a rock on the ship's side: re-pressed every tick so contact is constant.
function pressTicks(am, e, rock, ship, ticks, onShatter = () => {}) {
  const ux = (ship.x - rock.x), uy = (ship.y - rock.y);
  const len = Math.hypot(ux, uy);
  for (let t = 0; t < ticks; t++) {
    // Sit on the far side of the rock from the ship, overlapping by 2 px (rock is between e and ship).
    e.x = rock.x - (ux / len) * (rock.radius + e.radius - 2);
    e.y = rock.y - (uy / len) * (rock.radius + e.radius - 2);
    e.vx = (ux / len) * 2;
    e.vy = (uy / len) * 2;
    am.update(DT, ship, [e], [], onShatter, silent);
  }
}

test('tuner: eliteMining toggle + eliteMiningMult slider sit with the lieutenant settings', () => {
  resetTuning();
  const group = TUNING_SCHEMA.find(g => /Lieutenants/.test(g.group));
  const keys = group.items.map(i => i.key);
  assert.ok(keys.includes('eliteMining') && keys.includes('eliteMiningMult'));
  assert.ok(keys.indexOf('eliteMining') > keys.indexOf('lieutenantCoreReward'), 'next to the lieutenant knobs');
  const toggle = group.items.find(i => i.key === 'eliteMining');
  assert.deepEqual([toggle.min, toggle.max, toggle.step, toggle.unit], [0, 1, 1, 'onoff']);
  const mult = group.items.find(i => i.key === 'eliteMiningMult');
  assert.equal(DEFAULT_TUNING.eliteMining, 1);
  assert.equal(DEFAULT_TUNING.eliteMiningMult, 1.0);
  assert.ok(mult.min > 0 && mult.min <= 1 && mult.max >= 2);

  // Read live: base TUNING.miningSpeed (75/s) × the mult; 0 when toggled off.
  assert.equal(DEFAULT_TUNING.miningSpeed, 75);
  assert.equal(eliteMiningDps(), 75);
  TUNING.miningSpeed = 120;
  assert.equal(eliteMiningDps(), 120);
  TUNING.eliteMiningMult = 1.5;
  assert.equal(eliteMiningDps(), 180);
  TUNING.eliteMining = 0;
  assert.equal(eliteMiningDps(), 0);
  assert.equal(plowsThroughRock({ isLieutenant: true }), false, 'off: elites steer round rock again');
  resetTuning();
  assert.ok(isElite({ isBoss: true }) && isElite({ isLieutenant: true }) && !isElite({ type: 'bruiser' }));
});

test('an elite pressed against a rock grinds it at exactly the base mining DPS, unaffected by ship upgrades', () => {
  resetTuning();
  for (const flags of [{ isLieutenant: true }, { isBoss: true }]) {
    const rock = rockAt(2000, 2000, 40);
    const am = field([rock]);
    const ship = farShip(2600, 2000);
    const e = { x: 0, y: 0, vx: 0, vy: 0, radius: 22, type: 'pinwheel', ...flags };
    // Bosses bust through at bossMiningMult × the elite rate; a short press so the rock survives it.
    const ticks = flags.isBoss ? 15 : 60;
    const want = DEFAULT_TUNING.miningSpeed * (flags.isBoss ? DEFAULT_TUNING.bossMiningMult : 1) * ticks / 60;
    pressTicks(am, e, rock, ship, ticks);
    assert.ok(Math.abs((rock.maxHp - rock.hp) - want) < 1e-6, `${JSON.stringify(flags)}: ${rock.maxHp - rock.hp} hp in ${ticks} ticks`);
    assert.ok(rock.hitFlash > 0, 'the rock flashes like it does under the drill');
    assert.equal(am.isDrilling, false, 'the ship is not drilling');
    // Still a solid obstacle: the hull ends the tick outside the rock.
    assert.ok(Math.hypot(e.x - rock.x, e.y - rock.y) >= rock.radius + e.radius - 1e-6);
  }
  // Live tuner: mining speed and the elite multiplier change the rate on the next tick.
  TUNING.miningSpeed = 100;
  TUNING.eliteMiningMult = 2;
  const rock = rockAt(2000, 2000, 40);
  pressTicks(field([rock]), { radius: 22, isLieutenant: true }, rock, farShip(2600, 2000), 30);
  assert.ok(Math.abs((rock.maxHp - rock.hp) - 100) < 1e-6, `${rock.maxHp - rock.hp} hp in 0.5 s at 200/s`);
  resetTuning();
});

test('elites grind at most the two rocks they are pressed into, and only rock in the way', () => {
  resetTuning();
  // Three rocks fanned in front of the elite, all touching it; a fourth touching from behind.
  const e = { x: 2000, y: 2000, vx: 0, vy: 0, radius: 30, isLieutenant: true };
  const ship = farShip(2800, 2000);
  const ahead = [0, 0.9, -0.9].map(a => rockAt(2000 + Math.cos(a) * 68, 2000 + Math.sin(a) * 68, 40));
  const behind = rockAt(2000 - 69, 2000, 40);
  const am = field([...ahead, behind]);
  for (let t = 0; t < 30; t++) {
    e.x = 2000; e.y = 2000;
    am.update(DT, ship, [e], [], () => {}, silent);
  }
  const ground = ahead.filter(r => r.hp < r.maxHp);
  assert.equal(ELITE_GRIND_MAX_ROCKS, 2);
  assert.equal(ground.length, 2, 'two rocks at a time');
  assert.ok(ground.includes(ahead[0]), 'the one squarely in the way is among them');
  for (const r of ground) assert.ok(Math.abs((r.maxHp - r.hp) - 75 * 0.5) < 1e-6);
  assert.equal(behind.hp, behind.maxHp, 'rock behind the elite is not in the way');
});

test('normal enemies never damage rock (and elites stop when the toggle is off)', () => {
  resetTuning();
  const ship = farShip(2600, 2000);
  for (const type of ['pinwheel', 'bruiser', 'splitter', 'swarmer', 'shielder']) {
    const rock = rockAt(2000, 2000, 40);
    pressTicks(field([rock]), { radius: 22, type }, rock, ship, 120);
    assert.equal(rock.hp, rock.maxHp, `${type} mined rock`);
    assert.equal(rock.hitFlash, 0);
  }
  TUNING.eliteMining = 0;
  const rock = rockAt(2000, 2000, 40);
  pressTicks(field([rock]), { radius: 22, isLieutenant: true }, rock, ship, 120);
  assert.equal(rock.hp, rock.maxHp, 'elite mining off');
  resetTuning();
});

// A Game with just enough wiring for onRockShattered, recording effects and sounds.
function shatterGame() {
  const calls = [];
  const rec = (tag) => new Proxy({}, { get: (_, k) => (...args) => { calls.push(`${tag}.${String(k)}`); } });
  const g = Object.assign(Object.create(Game.prototype), {
    particles: rec('fx'), sound: rec('sound'), grid: rec('grid'), geoms: [], chests: [], rocksMined: 0,
    player: { x: 2600, y: 2000, radius: 15, angle: 0, hp: 50, maxHp: 100, stats: { luck: 1, miningSpeed: 9999, miningRange: 43 }, weapons: { tectonicBore: true } }
  });
  g.damageEnemiesInRadius = () => calls.push('tectonicBlast');
  g.spawnRelicChest = () => calls.push('chest');
  return { g, calls };
}

test('a rock an elite breaks goes through the normal break path and drops its normal loot', () => {
  resetTuning();
  for (const [ore, check] of [
    ['core_vein', (g) => assert.equal(g.geoms.filter(x => x.isCore).length, 1, 'core dropped')],
    ['gold_vein', (g) => {
      const gold = g.geoms.filter(x => x.isGold);
      assert.equal(gold.reduce((a, x) => a + x.gold, 0), TUNING.goldPerVein, 'a vein of gold pickups for the ship');
      assert.ok(gold.every(x => x.xp === 0), 'gold is currency, not XP');
    }],
    ['shield_vein', (g) => assert.equal(g.player.hp, 50, 'a crushed shield crystal heals no one')]
  ]) {
    const { g, calls } = shatterGame();
    const rock = rockAt(2000, 2000, 40, 10, ore);
    const am = field([rock, rockAt(1500, 1500, 30)]);
    let broken = null;
    pressTicks(am, { radius: 22, isLieutenant: true }, rock, g.player, 10, (r) => { broken = r; g.onRockShattered(r); });
    assert.equal(broken, rock, `${ore}: shattered through the asteroid manager`);
    assert.equal(rock.brokenBy, 'elite');
    assert.ok(!am.asteroids.includes(rock), 'removed from the field (minimap reads this list)');
    assert.ok(!am.getNearbyAsteroids(2000, 2000, 2).includes(rock), 'spatial index rebuilt');
    for (const effect of ['sound.playExplosion', 'fx.spawnPolygonShatter', 'fx.spawnExplosionSparks', 'fx.spawnShockwave', 'grid.applyImpulse']) {
      assert.ok(calls.includes(effect), `${ore}: ${effect}`);
    }
    check(g);
    assert.equal(g.rocksMined, 0, 'not counted as rocks YOU mined');
    assert.ok(!calls.includes('tectonicBlast'), 'Tectonic Claw Bore only fires on your own drilling');
  }
  // Control: the ship's own drill on the same rock still counts and heals.
  const { g, calls } = shatterGame();
  g.onRockShattered(rockAt(2000, 2000, 40, 0, 'shield_vein'));
  assert.equal(g.rocksMined, 1);
  assert.equal(g.player.hp, 75);
  assert.ok(calls.includes('tectonicBlast'));
});

// --- Boxed in: the elite used to stay stuck; now it carves out and reaches the ship ---------------

function spawnAt(m, type, x, y, extra = {}) {
  m.queueSpawn(type, x, y, 1, { instant: true, ...extra });
  m.update(DT, { x: x + 1, y }, [], silent, silent, 4200, 4200);
  m.update(DT, { x: x + 1, y }, [], silent, silent, 4200, 4200);
  const e = m.enemies[m.enemies.length - 1];
  e.hp = e.maxHp = 1e9;
  e.vx = e.vy = 0;
  return e;
}

// A sealed ring of overlapping rocks (real hp formula at default rockHpMult) around (cx, cy).
function box(cx, cy, ringR, rockR = 34) {
  const n = Math.ceil((2 * Math.PI * ringR) / (rockR * 1.4));
  const hp = (40 + rockR * 1.05) * (DEFAULT_TUNING.rockHpMult ?? 1.6);
  return Array.from({ length: n }, (_, k) => rockAt(cx + Math.cos((k * 2 * Math.PI) / n) * ringR, cy + Math.sin((k * 2 * Math.PI) / n) * ringR, rockR, hp));
}

function boxedRun(type, extra, ringR, seconds) {
  const am = field(box(2000, 2000, ringR));
  const m = new EnemyManager();
  m.terrain = am;
  const e = spawnAt(m, type, 2000, 2000, extra);
  const ship = { x: 2360, y: 2040, vx: 0, vy: 0, radius: 15, angle: 0, stats: { miningSpeed: 9999, miningRange: 43 } };
  let reachedAt = null;
  let minDist = Infinity;
  for (let t = 0; t < seconds * 60; t++) {
    if (type === 'bruiser') { e.state = 'advance'; e.aiTimer = 9; }
    m.update(DT, ship, [], silent, silent, 4200, 4200);
    am.update(DT, ship, m.enemies, [], () => {}, silent);
    const d = Math.hypot(e.x - ship.x, e.y - ship.y) - e.radius - ship.radius;
    minDist = Math.min(minDist, d);
    if (reachedAt === null && d < 40) reachedAt = t / 60;
  }
  return { e, reachedAt, minDist, broken: box(2000, 2000, ringR).length - am.asteroids.length };
}

test('an elite boxed in by rock grinds out and reaches the ship within 8 s; it used to stay stuck', () => {
  resetTuning();
  const N = 8;
  const cases = [
    ['pinwheel lieutenant', 'pinwheel', { lieutenant: { type: 'pinwheel', name: 'T', epithet: 'T', mods: [] } }, 92],
    ['bruiser lieutenant', 'bruiser', { lieutenant: { type: 'bruiser', name: 'T', epithet: 'T', mods: ['armored'] } }, 100],
    ['boss', 'boss', { name: 'T' }, 112]
  ];
  for (const [label, type, extra, ringR] of cases) {
    TUNING.eliteMining = 0;
    const before = boxedRun(type, extra, ringR, N);
    assert.equal(before.reachedAt, null, `${label}: control run should stay boxed in`);
    assert.ok(Math.hypot(before.e.x - 2000, before.e.y - 2000) < ringR, `${label}: control escaped the box`);
    assert.equal(before.broken, 0);

    TUNING.eliteMining = 1;
    const after = boxedRun(type, extra, ringR, N);
    assert.ok(after.reachedAt !== null && after.reachedAt <= N, `${label}: reached the ship at ${after.reachedAt}s (closest ${after.minDist.toFixed(0)}px)`);
    assert.ok(after.broken >= 1 && after.broken <= 5, `${label}: carved a narrow path (${after.broken} of ${box(2000, 2000, ringR).length} rocks)`);
    // Rock still blocks: it takes a moment to grind through (one ~84 hp rock at 75/s > 1 s).
    assert.ok(after.reachedAt > 1, `${label}: went through rock too fast (${after.reachedAt}s)`);
  }
  // A normal enemy in the same box stays stuck and leaves the rock alone.
  TUNING.eliteMining = 1;
  const grunt = boxedRun('pinwheel', {}, 92, N);
  assert.equal(grunt.reachedAt, null);
  assert.equal(grunt.broken, 0);
  resetTuning();
});

test('elites plow straight through rock; normal chasers keep the detour steering', () => {
  resetTuning();
  const am = field([rockAt(2100, 2000, 50)]);
  const out = { x: 0, y: 0 };
  const lt = { x: 2000, y: 2000, radius: 20, isLieutenant: true, type: 'pinwheel' };
  steerAroundRocks(lt, 1, 0, 600, am, DT, true, out);
  assert.deepEqual([out.x, out.y], [1, 0]);
  assert.equal(lt.detourRock, null);
  const grunt = { x: 2000, y: 2000, radius: 20, type: 'pinwheel', strafeSign: 1 };
  steerAroundRocks(grunt, 1, 0, 600, am, DT, true, out);
  assert.ok(grunt.detourRock && Math.abs(out.y) > 0.3, 'normal enemy detours');
  TUNING.eliteMining = 0;
  steerAroundRocks(lt, 1, 0, 600, am, DT, true, out);
  assert.ok(lt.detourRock, 'with elite mining off, elites detour like everyone else');
  resetTuning();
});

test('Field Guide lieutenant and boss entries give their mining speed', () => {
  resetTuning();
  const text = (id) => HOSTILE_ENTRIES.find(x => x.id === id).what();
  assert.match(text('lieutenant'), /grinds through asteroids at your base drill speed \(75\/s\)/);
  for (const id of HOSTILE_ENTRIES.filter(x => x.boss).map(x => x.id)) {
    assert.match(text(id), /busts through asteroids at 4× your base drill speed \(300\/s\)/, id);
    assert.match(text(id), /portal blows apart every rock within 280 px/, id);
  }
  const mining = MECHANIC_ENTRIES.find(x => x.id === 'mining').body().join(' ');
  assert.match(mining, /lieutenants grind through rock/);
  assert.match(mining, /bosses bust through/);
  TUNING.eliteMining = 0;
  assert.doesNotMatch(text('brood_queen'), /busts/);
  resetTuning();
});

test('borers tunnel through rock: a borer drill grinds, its bore charge shatters rock, and it spits gravel while digging', async () => {
  resetTuning();
  const { BORER, boreLength } = await import('../js/borers.js');
  const m = new EnemyManager();
  m.queueSpawn('borer', 1000, 1000, 1, { instant: true });
  m.update(DT, farShip(), [], silent, silent, 4200, 4200);
  m.update(DT, farShip(), [], silent, silent, 4200, 4200);
  const b = m.enemies.find(e => e.type === 'borer');
  assert.ok(b && !isElite(b) && plowsThroughRock(b), 'a non-elite that plows through rock');
  const hunt = (await import('../js/pursuit.js')).miningDpsFor(b);
  assert.ok(Math.abs(hunt - eliteMiningDps() * TUNING.borerMiningMult) < 1e-9);
  b.state = 'bore';
  assert.ok(Math.abs((await import('../js/pursuit.js')).miningDpsFor(b) - eliteMiningDps() * TUNING.boreMiningMult) < 1e-9);
  b.state = 'hunt';

  // Its drill in a rock: the asteroid manager flags it, and gravel flies at the ship.
  const ship = farShip(1600, 1000);
  const rock = rockAt(1300, 1000, 40);
  const am = field([rock]);
  pressTicks(am, b, rock, ship, 2);
  assert.ok(b.grindT > 0, 'grinding is flagged on the hull');
  const before = m.enemyBullets.count ?? m.enemyBullets.active?.length ?? 0;
  for (let t = 0; t < Math.ceil(BORER.gravelEvery * 60) + 2; t++) {
    pressTicks(am, b, rock, ship, 1);
    m.update(DT, ship, [], silent, silent, 4200, 4200);
  }
  const shots = [...(m.enemyBullets.items || m.enemyBullets.bullets || m.enemyBullets.active || [])].filter(s => s.from === 'borer' && s.life > 0);
  assert.ok(shots.length >= BORER.gravelShots, `it spits ${BORER.gravelShots} gravel shards (${shots.length})`);
  assert.ok(before >= 0);

  // A bore charge through a field of rock smashes what is in its lane.
  const lane = [rockAt(1100, 2000, 30, 120), rockAt(1200, 2000, 30, 120)]; // plain rock HP: (22 + r × 1.05) × rockHpMult
  const am2 = field(lane);
  const m2 = new EnemyManager();
  m2.queueSpawn('borer', 1000, 2000, 1, { instant: true });
  const target = farShip(1000 + boreLength({ speedScale: 1 }) + 300, 2000);
  m2.update(DT, target, [], silent, silent, 4200, 4200);
  m2.update(DT, target, [], silent, silent, 4200, 4200);
  const c = m2.enemies.find(e => e.type === 'borer');
  Object.assign(c, { state: 'aim', aiTimer: 0.01, aimAngle: 0 });
  let shattered = 0;
  for (let t = 0; t < Math.ceil((BORER.bore + 0.1) * 60); t++) {
    m2.update(DT, target, [], silent, silent, 4200, 4200);
    am2.update(DT, target, m2.enemies, [], () => shattered++, silent);
  }
  assert.equal(shattered, 2, 'both rocks in the lane shattered');
  assert.ok(c.x > 1250, `it bored on through (x ${c.x.toFixed(0)})`);
  resetTuning();
});
