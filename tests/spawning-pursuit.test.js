import test from 'node:test';
import assert from 'node:assert/strict';

// Spawn placement (off-screen ring, on-screen telegraph, min distance, arena-edge fallback), pursuit
// anywhere on the map (rock detours, off-screen catch-up), lieutenant speed. Browser services stubbed.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, addEventListener() {} });
globalThis.document = { getElementById: element, createElement: element };

const { Game } = await import('../js/main.js');
const { EnemyManager, SPAWN_HOLD_MAX, LIEUTENANT_MAX_SHIP_SHARE } = await import('../js/enemies.js');
const { AsteroidManager } = await import('../js/asteroids.js');
const { WAVE_PACKS } = await import('../js/archetypes.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { pickSpawnPoint, pickOnscreenSpawn, spawnView, inView, ringPoint } = await import('../js/spawn-placement.js');
const { catchupPace } = await import('../js/pursuit.js');

const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);

function seeded(seed = 11) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

// Chebyshev distance from a point to the outside of a rect (0 when inside): "px past the screen edge".
const pastEdge = (v, x, y) => Math.max(v.x - x, x - (v.x + v.w), v.y - y, y - (v.y + v.h), 0);

function terrain(rocks = []) {
  const am = new AsteroidManager(4200, 4200);
  am.asteroids = rocks.map(([x, y, radius]) => ({ x, y, radius, hp: 1e9, maxHp: 1e9, hitFlash: 0, sides: 6, verts: [], rotation: 0 }));
  am.rebuildSpatialHash();
  return am;
}

// A game-like object with the camera centred on the ship (clamped to the arena like Game.update).
function world({ px = 2100, py = 2100, vx = 0, vy = 0, width = 1280, height = 720, rocks = [], worldW = 4200, worldH = 4200 } = {}) {
  const g = Object.assign(Object.create(Game.prototype), {
    worldWidth: worldW, worldHeight: worldH, width, height,
    player: { x: px, y: py, vx, vy, radius: 15 },
    asteroidManager: terrain(rocks)
  });
  g.camX = Math.max(0, Math.min(worldW - width, px - width / 2));
  g.camY = Math.max(0, Math.min(worldH - height, py - height / 2));
  return g;
}

function assertValidSpawn(g, pt, pad = 0, label = '') {
  const p = g.player;
  const view = spawnView(g);
  const d = Math.hypot(pt.x - p.x, pt.y - p.y);
  assert.ok(d >= TUNING.spawnMinDist + pad - 1e-9, `${label} spawn ${d.toFixed(0)}px from the ship`);
  assert.ok(pt.x >= 90 && pt.y >= 90 && pt.x <= g.worldWidth - 90 && pt.y <= g.worldHeight - 90, `${label} spawn outside the arena`);
  for (const rock of g.asteroidManager.asteroids) {
    assert.ok(Math.hypot(pt.x - rock.x, pt.y - rock.y) >= rock.radius + 28 - 1e-9, `${label} spawn inside rock`);
  }
  if (!pt.onScreen) assert.ok(!inView(view, pt.x, pt.y, pad), `${label} off-screen spawn is visible`);
}

test('spawn TUNING knobs exist in their own schema group with sane defaults', () => {
  const group = TUNING_SCHEMA.find(grp => /Spawn Placement/.test(grp.group));
  assert.ok(group, 'Spawn Placement & Pursuit group');
  const keys = group.items.map(i => i.key);
  for (const key of ['spawnRingMarginMin', 'spawnRingMarginMax', 'spawnAheadBias', 'spawnOnscreenTelegraph', 'spawnMinDist', 'pursuitCatchupStart', 'pursuitCatchupMax', 'lieutenantSpeedMult']) {
    assert.ok(keys.includes(key), key);
    const item = group.items.find(i => i.key === key);
    assert.ok(item.min <= DEFAULT_TUNING[key] && DEFAULT_TUNING[key] <= item.max, key);
  }
  assert.equal(DEFAULT_TUNING.spawnRingMarginMin, 40);
  assert.equal(DEFAULT_TUNING.spawnRingMarginMax, 160);
  assert.equal(DEFAULT_TUNING.spawnMinDist, 260);
  assert.ok(DEFAULT_TUNING.spawnOnscreenTelegraph >= 1.2 && DEFAULT_TUNING.spawnOnscreenTelegraph <= 1.6);
});

test('ring spawns land 40-160 px past the screen edge, off screen, out of rock, never near the ship', () => {
  resetTuning();
  const rand = seeded(3);
  const rocks = Array.from({ length: 60 }, (_, k) => [1100 + (k * 397) % 2000, 1300 + (k * 263) % 1600, 30 + (k % 4) * 8]);
  for (const [width, height] of [[1280, 720], [1920, 1080], [800, 1000]]) {
    const g = world({ width, height, rocks });
    const view = spawnView(g);
    for (let n = 0; n < 1500; n++) {
      const pad = [0, 30, 90][n % 3];
      const pt = pickSpawnPoint(g, { pad, rand });
      assert.equal(pt.onScreen, false, 'open field never needs the on-screen fallback');
      assertValidSpawn(g, pt, pad, `${width}x${height}`);
      const past = pastEdge(view, pt.x, pt.y);
      assert.ok(past >= 40 + pad - 1e-6 && past <= 160 + pad + 1e-6, `${past.toFixed(1)}px past the edge (pad ${pad})`);
    }
  }
});

test('zoom shrinks the visible world rect and the ring follows it', () => {
  resetTuning();
  const g = world();
  g.zoom = 2;
  const v = spawnView(g);
  assert.equal(v.w, 640);
  assert.equal(v.h, 360);
  const pt = ringPoint(v, 0, 50);
  assert.equal(pt.x, v.x + 640 + 50);
});

test('spawns lean toward the heading but still use every side, and stay off screen through the warm-up', () => {
  resetTuning();
  const rand = seeded(5);
  const g = world({ vx: 5, vy: 0 });
  const sides = { ahead: 0, behind: 0, top: 0, bottom: 0 };
  const view = spawnView(g);
  for (let n = 0; n < 3000; n++) {
    const pt = pickSpawnPoint(g, { rand });
    assertValidSpawn(g, pt);
    if (pt.x > view.x + view.w) sides.ahead++;
    else if (pt.x < view.x) sides.behind++;
    else if (pt.y < view.y) sides.top++;
    else sides.bottom++;
    // Where the camera will be when the 0.55 s ring finishes, the point is still off screen.
    const later = { ...view, x: view.x + 5 * 0.55 * 60 };
    assert.ok(!inView(later, pt.x, pt.y), 'popped in on screen ahead of a running ship');
  }
  assert.ok(sides.ahead > sides.behind * 2, `ahead ${sides.ahead} vs behind ${sides.behind}`);
  for (const side of Object.keys(sides)) assert.ok(sides[side] > 60, `${side} side still gets spawns (${sides[side]})`);
});

test('a ship hugging a wall or corner gets its spawns from the open sides, inside the arena', () => {
  resetTuning();
  const rand = seeded(9);
  for (const [px, py] of [[40, 2100], [4160, 2100], [2100, 40], [40, 40], [4160, 4160]]) {
    const g = world({ px, py });
    for (let n = 0; n < 800; n++) {
      const pt = pickSpawnPoint(g, { pad: n % 2 ? 90 : 0, rand });
      assert.equal(pt.onScreen, false, `(${px}, ${py}) fell back on screen`);
      assertValidSpawn(g, pt, n % 2 ? 90 : 0, `(${px}, ${py})`);
    }
  }
});

test('with no room off screen the spawn falls back on screen, >= spawnMinDist away, with the long telegraph', () => {
  resetTuning();
  const rand = seeded(13);
  // The view covers the whole (small) arena, so every ring point is outside the walls.
  const g = world({ px: 700, py: 450, width: 1400, height: 900, worldW: 1400, worldH: 900 });
  g.enemyManager = new EnemyManager();
  for (let n = 0; n < 300; n++) {
    const pt = pickSpawnPoint(g, { rand });
    assert.equal(pt.onScreen, true);
    assertValidSpawn(g, pt, 0, 'fallback');
  }
  const pt = pickSpawnPoint(g, { rand });
  g.enemyManager.queueSpawn('pinwheel', pt.x, pt.y, 1, g.placedSpawn(pt));
  const sp = g.enemyManager.spawnIndicators[0];
  assert.equal(sp.onScreen, true);
  assert.ok(sp.maxTimer >= 1.2 && sp.maxTimer <= 1.6, `on-screen telegraph ${sp.maxTimer}s`);
  assert.equal(sp.maxTimer, TUNING.spawnOnscreenTelegraph);
  // The sandbox's visible spawns follow the same rules.
  const visible = pickOnscreenSpawn(world({ rocks: [[2300, 2100, 40]] }), { rand });
  assert.equal(visible.onScreen, true);
  assert.ok(Math.hypot(visible.x - 2100, visible.y - 2100) >= TUNING.spawnMinDist);
});

test('nothing materializes near the ship: a guarded spawn waits for it to back off, then relocates', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = { x: 2000, y: 2000, radius: 15 };
  m.queueSpawn('pinwheel', 2010, 2000, 1, { guard: true });
  for (let t = 0; t < 60; t++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(m.enemies.length, 0, 'held while the ship is within spawnMinDist');
  assert.equal(m.spawnIndicators.length, 1, 'the slot stays reserved');
  player.x = 2010 + TUNING.spawnMinDist + 1;
  m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(m.enemies.length, 1, 'arrives once the ship backs off');
  // Camping on a telegraph moves it: after SPAWN_HOLD_MAX it re-places through Game's placement.
  m.relocateSpawn = () => ({ x: 3000, y: 3000, onScreen: false });
  m.queueSpawn('pinwheel', player.x + 50, 2000, 1, { guard: true });
  for (let t = 0; t < Math.ceil((0.55 + SPAWN_HOLD_MAX) * 60) + 2; t++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(m.spawnIndicators[0].x, 3000);
  for (let t = 0; t < 40; t++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(m.enemies.length, 2);
  assert.ok(Math.hypot(m.enemies[1].x - player.x, m.enemies[1].y - player.y) > TUNING.spawnMinDist);
  // Splitter fragments (instant) are exempt: they burst from where the parent died.
  m.queueSpawn('mini_splitter', player.x, player.y, 1, { instant: true, guard: true });
  m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  m.update(1 / 60, player, [], silent, silent, 4200, 4200);
  assert.equal(m.enemies.length, 3);
});

function spawnGame({ px = 2100, py = 2100, vx = 0, vy = 0, wave = 12 } = {}) {
  const g = world({ px, py, vx, vy, rocks: [[2600, 1700, 50], [1500, 2500, 45]] });
  Object.assign(g, {
    enemyManager: new EnemyManager({ maxEnemies: 2000 }), wave, sound: silent, pendingBossSpawns: [],
    seenArchetypes: new Set(), announceArchetype() {}
  });
  return g;
}

function assertQueuedSpawnsValid(g, label) {
  const view = spawnView(g);
  const p = g.player;
  for (const sp of g.enemyManager.spawnIndicators) {
    const d = Math.hypot(sp.x - p.x, sp.y - p.y);
    assert.ok(d >= TUNING.spawnMinDist, `${label}: ${sp.type} queued ${d.toFixed(0)}px from the ship`);
    assert.ok(sp.guard, `${label}: ${sp.type} unguarded`);
    if (sp.onScreen) {
      assert.ok(sp.maxTimer >= 1.2, `${label}: on-screen ${sp.type} telegraph ${sp.maxTimer}s`);
    } else {
      assert.ok(!inView(view, sp.x, sp.y, sp.config.radius), `${label}: ${sp.type} hull visible at spawn`);
    }
  }
}

test('every spawn path (all wave packs, boss, lieutenant) places off screen or meets the on-screen rules', () => {
  resetTuning();
  for (const pack of WAVE_PACKS) {
    for (const p of WAVE_PACKS) TUNING[p.weightKey] = p.id === pack.id ? 1 : 0;
    for (const [px, py, vx] of [[2100, 2100, 0], [2100, 2100, 5], [60, 2100, -5], [4140, 4140, 3]]) {
      const g = spawnGame({ px, py, vx });
      for (let n = 0; n < 6; n++) g.spawnWavePack();
      assert.ok(g.enemyManager.spawnIndicators.length > 0, `pack ${pack.id} spawned nothing`);
      assertQueuedSpawnsValid(g, `${pack.id} @ (${px}, ${py})`);
    }
  }
  resetTuning();
  const g = spawnGame({ wave: 4 });
  g.pendingBossSpawns.push({ wave: 3, waveScale: 1.5 });
  g.processPendingBossSpawns();
  assert.ok(g.spawnLieutenant());
  const types = g.enemyManager.spawnIndicators.map(sp => sp.config.isBoss ? 'boss' : sp.config.isLieutenant ? 'lieutenant' : sp.type);
  assert.ok(types.includes('boss') && types.includes('lieutenant'));
  assertQueuedSpawnsValid(g, 'boss + lieutenant');
  // Sandbox lieutenant: deliberately on screen, with the long telegraph.
  const s = spawnGame({ wave: 4 });
  assert.ok(s.spawnLieutenant(null, true));
  assert.equal(s.enemyManager.spawnIndicators[0].onScreen, true);
  assertQueuedSpawnsValid(s, 'sandbox lieutenant');
});

// --- Pursuit ---------------------------------------------------------------------------------

function chaseManager(view = null) {
  const m = new EnemyManager();
  m.view = view;
  return m;
}

function spawnAt(m, type, x, y, extra = {}) {
  m.queueSpawn(type, x, y, 1, { instant: true, ...extra });
  m.update(1 / 60, { x: x + 1, y }, [], silent, silent, 4200, 4200);
  m.update(1 / 60, { x: x + 1, y }, [], silent, silent, 4200, 4200);
  const e = m.enemies[m.enemies.length - 1];
  e.hp = e.maxHp = 1e9;
  e.vx = e.vy = 0;
  return e;
}

test('far, off-screen chasers of every kind head for the ship and catch up faster; vortexes do not', () => {
  resetTuning();
  const player = { x: 3800, y: 3800, radius: 15 };
  const view = { x: player.x - 640, y: player.y - 360, w: 1280, h: 720 };
  const types = ['swarmer', 'pinwheel', 'weaver', 'splitter', 'bruiser', 'gunner', 'shielder', 'blinker', 'conduit', 'boss'];
  for (const type of types) {
    const travel = (startX, startY, v) => {
      const m = chaseManager(v);
      const e = spawnAt(m, type, startX, startY, type === 'boss' ? { name: 'T' } : {});
      const d0 = Math.hypot(player.x - e.x, player.y - e.y);
      for (let t = 0; t < 180; t++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
      return d0 - Math.hypot(player.x - e.x, player.y - e.y);
    };
    const far = travel(400, 400, view); // ~4800 px away in the far corner
    assert.ok(far > 0, `${type} lost the ship from across the map`);
    const near = travel(400, 400, null) / catchupPace({ type, radius: 10, x: 400, y: 400 }, 4800, null);
    assert.ok(far > near * 1.4, `${type} catch-up: ${far.toFixed(0)} vs ${near.toFixed(0)}px`);
  }
  // Catch-up never applies on screen or near the ship.
  const e = { type: 'pinwheel', radius: 15, x: player.x + 500, y: player.y };
  assert.equal(catchupPace(e, 500, view), 1);
  assert.equal(catchupPace({ ...e, x: player.x + 1200 }, 1200, view), 1 + (TUNING.pursuitCatchupMax - 1) * (300 / 900));
  assert.equal(catchupPace({ ...e, x: player.x + 600, y: player.y - 2000 }, 2100, { ...view, h: 4200, y: 0 }), 1, 'on screen: no boost');
  assert.equal(catchupPace({ type: 'blackhole', radius: 22, x: 0, y: 0 }, 5000, view), 1, 'vortexes never chase');
  const m = chaseManager(view);
  const bh = spawnAt(m, 'blackhole', 400, 400);
  let maxStep = 0;
  for (let t = 0; t < 240; t++) {
    const x0 = bh.x, y0 = bh.y;
    m.update(1 / 60, player, [], silent, silent, 4200, 4200);
    maxStep = Math.max(maxStep, Math.hypot(bh.x - x0, bh.y - y0));
  }
  assert.ok(maxStep <= bh.speed + 1e-9, `vortex drifted ${maxStep.toFixed(2)} px/tick`);
});

test('a chaser blocked by rock steers round it instead of sticking to the face', () => {
  resetTuning();
  // A wall of five overlapping rocks squarely between the chaser and the ship.
  const wall = [1820, 1910, 2000, 2090, 2180].map(y => [2000, y + 7, 52]);
  const run = (avoid, type) => {
    const am = terrain(wall);
    const m = chaseManager();
    m.terrain = avoid ? am : null;
    const player = { x: 2400, y: 2000, radius: 15, angle: 0, stats: { miningSpeed: 0, miningRange: 0 } };
    const e = spawnAt(m, type, 1700, 2000);
    e.strafeSign = 1;
    for (let t = 0; t < 900; t++) {
      if (type === 'bruiser') { e.state = 'advance'; e.aiTimer = 9; } // isolate the approach
      m.update(1 / 60, player, [], silent, silent, 4200, 4200);
      am.update(1 / 60, player, m.enemies, [], () => {}, silent); // the real rock pushout
    }
    return e;
  };
  for (const type of ['pinwheel', 'splitter', 'bruiser', 'shielder', 'weaver', 'swarmer', 'blinker']) {
    if (type !== 'blinker') {
      const stuck = run(false, type);
      assert.ok(stuck.x < 2000, `${type}: control run should be pinned behind the wall (x ${stuck.x.toFixed(0)})`);
    }
    const e = run(true, type);
    assert.ok(e.x > 2060, `${type}: still stuck behind the wall (x ${e.x.toFixed(0)}, y ${e.y.toFixed(0)})`);
    assert.ok(Math.hypot(e.x - 2400, e.y - 2000) < 300, `${type}: rounded the wall and closed on the ship`);
  }
});

test('a rock that is not in the way does not bend the approach', () => {
  resetTuning();
  const m = chaseManager();
  m.terrain = terrain([[2000, 2200, 60]]);
  const e = spawnAt(m, 'pinwheel', 1700, 2000);
  const y0 = e.y;
  for (let t = 0; t < 30; t++) m.update(1 / 60, { x: 2400, y: y0 }, [], silent, silent, 4200, 4200);
  assert.ok(Math.abs(e.y - y0) < 1e-6, 'straight line kept');
  assert.equal(e.detourRock, null);
});

// --- Lieutenants ---------------------------------------------------------------------------------

function cruiseSpeed(type, mods, mult) {
  TUNING.lieutenantSpeedMult = mult;
  const m = chaseManager();
  const e = spawnAt(m, type, 1000, 2000, { lieutenant: { type, name: 'T', epithet: 'T', mods } });
  const player = { x: 1600, y: 2000 };
  let sum = 0, n = 0, max = 0;
  for (let t = 0; t < 600; t++) {
    const x0 = e.x, y0 = e.y;
    player.x = e.x + 600; player.y = e.y; // ship stays 600 px ahead (inside the catch-up start)
    m.update(1 / 60, player, [], silent, silent, 4200, 4200);
    if (e.x > 3200) { e.x = 1000; continue; }
    if (t < 120 || e.state !== 'advance' && e.state !== 'idle' && e.state !== 'drift') continue;
    const step = Math.hypot(e.x - x0, e.y - y0);
    sum += step; n++; max = Math.max(max, step);
  }
  return { avg: sum / n, max };
}

test('lieutenants move ~35% faster than before, yet stay slower than the ship at base thrust', () => {
  resetTuning();
  assert.equal(DEFAULT_TUNING.lieutenantSpeedMult, 1.35);
  for (const type of ['pinwheel', 'splitter', 'bruiser', 'shielder', 'conduit']) {
    const before = cruiseSpeed(type, [], 1).avg;
    const after = cruiseSpeed(type, [], DEFAULT_TUNING.lieutenantSpeedMult).avg;
    assert.ok(after / before > 1.3 && after / before < 1.4, `${type}: ${before.toFixed(2)} -> ${after.toFixed(2)} px/tick`);
  }
  const limit = LIEUTENANT_MAX_SHIP_SHARE * DEFAULT_TUNING.moveSpeed;
  for (const type of ['pinwheel', 'weaver', 'splitter', 'bruiser', 'gunner', 'shielder', 'conduit']) {
    for (const mods of [[], ['hasted']]) {
      const { max } = cruiseSpeed(type, mods, DEFAULT_TUNING.lieutenantSpeedMult);
      assert.ok(max <= limit + 1e-9 && max < DEFAULT_TUNING.moveSpeed, `${type} ${mods}: ${max.toFixed(2)} px/tick vs ship ${DEFAULT_TUNING.moveSpeed}`);
    }
  }
  resetTuning();
});
