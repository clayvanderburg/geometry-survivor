import test from 'node:test';
import assert from 'node:assert/strict';

// Browser services are stubbed; tests drive the real Game.update / EnemyManager / WarpGrid code.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { Game } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');
const { WarpGrid } = await import('../js/grid.js');
const { ParticleSystem } = await import('../js/particles.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
const { wellFalloff, wellPullScale, playerPullCap, playerPullShare, playerPullCapShare, MAX_PLAYER_PULL_SHARE, SHIP_THRUST_PER_TICK } = await import('../js/gravity.js');
const silent = new Proxy({}, { get: () => () => {} });
const stubGrid = { applyImpulse() {}, applyImplosion() {} };
const stubSparks = { applyGravityWell() {} };

function arena() {
  const manager = new EnemyManager();
  const game = Object.assign(Object.create(Game.prototype), {
    enemyManager: manager,
    asteroidManager: { asteroids: Array.from({ length: 400 }, () => ({ radius: 1 })), isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, xp: 0, xpToNext: 1e9, level: 1,
      stats: { moveSpeed: TUNING.moveSpeed, luck: 1, xpMultiplier: 1, magnetRadius: 145, damage: 11, coreDropMult: 1, fireRate: 0 }, weapons: {} },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave: 1, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 1e9,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, kills: 0, score: 0, coresDroppedThisWave: 0, shake: 0,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], singularityTimer: 1e9,
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }
  });
  return { game, manager };
}

function addEnemy(manager, type, x, y, waveScale = 1) {
  manager.queueSpawn(type, x, y, waveScale, { instant: true });
  manager.update(0.05, { x: x + 5000, y }, [], stubGrid, stubSparks, 4200, 4200);
  return manager.enemies[manager.enemies.length - 1];
}

const pin = (e, x, y) => { e.x = x; e.y = y; e.vx = e.vy = 0; e.hp = e.maxHp = 1e9; };

test('well falloff is pinned: full at the core, 62.5% at half radius, zero at and beyond the rim', () => {
  assert.equal(wellFalloff(0, 200), 1);
  assert.equal(wellFalloff(100, 200), 0.625);
  assert.equal(wellFalloff(150, 200), 0.34375);
  assert.equal(wellFalloff(200, 200), 0);
  assert.equal(wellFalloff(320, 200), 0);
  for (let d = 0; d < 200; d += 5) assert.ok(wellFalloff(d, 200) > wellFalloff(d + 5, 200), `falloff must shrink past ${d}px`);
  // Acceleration magnitude follows the curve; inside the core it eases linearly to zero.
  for (const d of [30, 80, 140, 190]) {
    const k = wellPullScale(d, 0, 200, 0.4, 22);
    assert.ok(Math.abs(d * k - 0.4 * wellFalloff(d, 200)) < 1e-12);
  }
  assert.ok(Math.abs(11 * wellPullScale(11, 0, 200, 0.4, 22) - 0.5 * 0.4 * wellFalloff(22, 200)) < 1e-12);
  assert.ok(Number.isFinite(wellPullScale(0, 0, 200, 0.4, 22)), 'no singularity at the exact centre');
  assert.equal(wellPullScale(201, 0, 200, 0.4), 0);
});

test('gravity strengths are live-tunable schema sliders whose bounds contain the defaults', () => {
  const items = new Map(TUNING_SCHEMA.flatMap(group => group.items).map(item => [item.key, item]));
  for (const key of ['blackholePullRadius', 'blackholePlayerPullEdge', 'blackholePlayerPullInner', 'blackholePlayerPullInnerAt', 'blackholeEnemyPull', 'blackholeBulletBend', 'blackholePickupPull', 'singularityPull', 'singularityCollapseMult']) {
    const item = items.get(key);
    assert.ok(item, `${key} missing from TUNING_SCHEMA`);
    assert.equal(item.type, 'range');
    assert.ok(item.min <= DEFAULT_TUNING[key] && DEFAULT_TUNING[key] <= item.max, key);
  }
  // No slider can push a share of thrust to (or past) 100%.
  for (const key of ['blackholePlayerPullEdge', 'blackholePlayerPullInner']) assert.ok(items.get(key).max <= MAX_PLAYER_PULL_SHARE && MAX_PLAYER_PULL_SHARE < 1);
});

test('vortex tug on the ship: 50% of thrust at the rim, linear to 75% at half radius, holding 75% to the core', () => {
  const R = DEFAULT_TUNING.blackholePullRadius;
  const share = (d) => playerPullShare(d, R, 22, DEFAULT_TUNING);
  assert.equal(DEFAULT_TUNING.blackholePlayerPullEdge, 0.5);
  assert.equal(DEFAULT_TUNING.blackholePlayerPullInner, 0.75);
  assert.equal(DEFAULT_TUNING.blackholePlayerPullInnerAt, 0.5);
  assert.equal(share(R), 0, 'nothing at or beyond the rim');
  assert.equal(share(R + 50), 0);
  assert.ok(Math.abs(share(R - 1e-9) - 0.5) < 1e-9, 'edge: 50%');
  assert.ok(Math.abs(share(R * 0.75) - 0.625) < 1e-12, 'linear: 62.5% three-quarters out');
  assert.ok(Math.abs(share(R * 0.5) - 0.75) < 1e-12, 'half radius: 75%');
  assert.equal(share(R * 0.25), 0.75, 'holds 75% inside half radius');
  assert.equal(share(22), 0.75, 'still 75% at the core (event horizon)');
  assert.ok(share(11) < 0.75 && share(0) === 0, 'eases to zero inside the hull so a ship on the centre is still');
  for (let d = 0; d < R; d += 2) assert.ok(share(d) < 1, `share below thrust at ${d}px`);
  for (let d = R * 0.5; d < R - 2; d += 2) assert.ok(share(d) > share(d + 2), 'rises monotonically toward the core');
  // The tunables steer the curve: inner reached at 30% of the radius instead.
  const tuned = { ...DEFAULT_TUNING, blackholePlayerPullEdge: 0.3, blackholePlayerPullInner: 0.6, blackholePlayerPullInnerAt: 0.3 };
  assert.ok(Math.abs(playerPullShare(R * 0.3, R, 0, tuned) - 0.6) < 1e-12);
  assert.ok(Math.abs(playerPullShare(R * 0.65, R, 0, tuned) - 0.45) < 1e-12);
  // Even maxed-out sliders stay under thrust.
  const maxed = { ...DEFAULT_TUNING, blackholePlayerPullEdge: 5, blackholePlayerPullInner: 5 };
  assert.equal(playerPullCapShare(maxed), MAX_PLAYER_PULL_SHARE);
  assert.ok(playerPullShare(R * 0.4, R, 0, maxed) <= MAX_PLAYER_PULL_SHARE);
});

test('in game the ship feels exactly that share of its thrust, and an idle ship is dragged in', () => {
  const thrust = TUNING.moveSpeed * SHIP_THRUST_PER_TICK;
  const R = TUNING.blackholePullRadius;
  for (const [d, expect] of [[R - 0.5, 0.5 + 0.25 * 0.5 / (R * 0.5)], [R * 0.75, 0.625], [R * 0.5, 0.75], [R * 0.2, 0.75]]) {
    const { game, manager } = arena();
    const bh = addEnemy(manager, 'blackhole', 2000, 2000);
    pin(bh, 2000, 2000);
    game.gravityWells = [bh];
    game.player.x = 2000 + d;
    game.applyWellPullToPlayer(game.player);
    assert.ok(Math.abs(-game.player.vx / thrust - expect) < 1e-9, `at ${d}px the tug is ${(-game.player.vx / thrust).toFixed(3)} of thrust`);
    assert.ok(game.player.gravityTug < thrust);
  }
  const travel = (start) => {
    const { game, manager } = arena();
    const bh = addEnemy(manager, 'blackhole', 2000, 2000);
    game.player.x = 2000 + start;
    for (let t = 0; t < 20; t++) { pin(bh, 2000, 2000); game.update(1 / 60); }
    return start - (game.player.x - 2000);
  };
  assert.ok(travel(R - 10) > 30, 'an idle ship just inside the rim is pulled in hard');
  assert.equal(travel(R + 40), 0, 'no pull outside the radius');
});

test('the ship always escapes stacked black holes at base move speed, even from the event horizon', () => {
  const items = TUNING_SCHEMA.flatMap(group => group.items);
  const maxShare = items.find(item => item.key === 'blackholePlayerPullInner').max;
  try {
    for (const [edge, inner] of [[DEFAULT_TUNING.blackholePlayerPullEdge, DEFAULT_TUNING.blackholePlayerPullInner], [maxShare, maxShare]]) {
      TUNING.blackholePlayerPullEdge = edge;
      TUNING.blackholePlayerPullInner = inner;
      const maxed = inner === maxShare;
      const { game, manager } = arena();
      game.player.stats.moveSpeed = DEFAULT_TUNING.moveSpeed;
      // Worst case: three wells stacked on one spot, ship starting against the horizon. At default
      // tuning the wells keep drifting after the ship; with maxed sliders they are held still (a chasing
      // well then only loses ground slowly, which the terminal-speed check below covers).
      const wells = [0, 1, 2].map(() => addEnemy(manager, 'blackhole', 2000, 2000));
      for (const w of wells) w.hp = w.maxHp = 1e9;
      game.player.x = 2000 + wells[0].radius + game.player.radius;
      game.keys.KeyD = true;
      const cap = playerPullCap(game.player.stats.moveSpeed);
      assert.ok(cap < game.player.stats.moveSpeed * SHIP_THRUST_PER_TICK, 'summed pull cap is below thrust');
      let last = game.player.x - wells[0].x;
      for (let t = 0; t < 600 && last <= TUNING.blackholePullRadius; t++) {
        if (maxed) for (const w of wells) pin(w, 2000, 2000);
        game.update(1 / 60);
        const dist = game.player.x - wells[0].x;
        if (t > 2) assert.ok(dist > last, `share ${inner}: ship lost ground at tick ${t}`);
        assert.ok(game.player.gravityTug <= cap + 1e-12);
        last = dist;
      }
      assert.ok(last > TUNING.blackholePullRadius, `share ${inner}: ship still trapped ${last.toFixed(0)}px from the wells after 10s`);
      // Worst-case terminal speed against a capped pull is (1 - share) of move speed, faster than a chasing well.
      assert.ok((1 - playerPullCapShare()) * DEFAULT_TUNING.moveSpeed > wells[0].speed);
    }
  } finally {
    // keep later tests on defaults even if this fails
    TUNING.blackholePlayerPullEdge = DEFAULT_TUNING.blackholePlayerPullEdge;
    TUNING.blackholePlayerPullInner = DEFAULT_TUNING.blackholePlayerPullInner;
  }
});

test('dashing ignores black-hole tug', () => {
  const { game, manager } = arena();
  const bh = addEnemy(manager, 'blackhole', 2000, 2000);
  game.player.x = 2080; game.player.vx = 12; game.player.dashTimer = 0.2;
  pin(bh, 2000, 2000);
  game.update(1 / 60);
  assert.equal(game.player.vx, 12);
});

test('black holes bend passing shots by a few degrees without changing their speed', () => {
  const { game, manager } = arena();
  const bh = addEnemy(manager, 'blackhole', 2000, 2000);
  game.player.x = 1000; game.player.y = 1000;
  const shot = { x: 1750, y: 2070, vx: 14, vy: 0, radius: 3.8, life: 2, pierce: 1, damage: 1, hue: 1 };
  const far = { x: 1750, y: 2400, vx: 14, vy: 0, radius: 3.8, life: 2, pierce: 1, damage: 1, hue: 1 };
  game.bullets = [shot, far];
  for (let t = 0; t < 40; t++) { pin(bh, 2000, 2000); game.update(1 / 60); }
  const bend = Math.abs(Math.atan2(shot.vy, shot.vx)) * 180 / Math.PI;
  assert.ok(bend > 3 && bend < 20, `bend ${bend.toFixed(1)} deg`);
  assert.ok(shot.vy < 0, 'shot bends toward the well');
  assert.ok(Math.abs(Math.hypot(shot.vx, shot.vy) - 14) < 1e-9);
  assert.equal(far.vy, 0, 'shots outside the pull radius fly straight');
});

test('loose geoms sink into a black hole while magnetized geoms still fly to the ship', () => {
  const { game, manager } = arena();
  const bh = addEnemy(manager, 'blackhole', 2000, 2000);
  game.player.x = 1000; game.player.y = 1000;
  const loose = { isCore: false, x: 2120, y: 2000, vx: 0, vy: 0, xp: 1, rotation: 0, hue: 145, life: 16 };
  const magnet = { isCore: false, x: 2060, y: 2000, vx: 0, vy: 0, xp: 1, rotation: 0, hue: 145, life: 16, magnetized: true };
  game.geoms = [loose, magnet];
  const startMagnetDist = Math.hypot(magnet.x - 1000, magnet.y - 1000);
  for (let t = 0; t < 60; t++) { pin(bh, 2000, 2000); game.update(1 / 60); }
  assert.ok(Math.hypot(loose.x - 2000, loose.y - 2000) < 30, 'loose geom should settle in the core');
  assert.ok(Math.hypot(magnet.x - 1000, magnet.y - 1000) < startMagnetDist - 300, 'magnet pull wins over the well');
});

test('a Vortex Singularity drags a scattered pack into a tight clump before it collapses', () => {
  const clumped = (withSingularity) => {
    const { game, manager } = arena();
    game.player.x = 1500; game.player.weapons.singularity = 1;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = 50 + (k % 4) * 30; // all start inside the L1 pull radius (175px)
      addEnemy(manager, 'swarmer', 2000 + Math.cos(a) * r, 2000 + Math.sin(a) * r);
    }
    for (const e of manager.enemies) e.hp = e.maxHp = 1e9;
    let life = 2.6;
    if (withSingularity) {
      game.fireSingularity(1);
      Object.assign(game.singularities[0], { x: 2000, y: 2000, vx: 0, vy: 0 });
      life = game.singularities[0].life;
    }
    for (let t = 0; t < Math.round(life * 60) - 2; t++) game.update(1 / 60);
    return manager.enemies.filter(e => Math.hypot(e.x - 2000, e.y - 2000) < 60).length;
  };
  assert.ok(clumped(true) >= 20, 'at least 20 of 24 swarmers should be within 60px of the core');
  assert.equal(clumped(false), 0);
});

test('singularity collapse is an implosion damage pulse over 85% of its pull radius', () => {
  // Exact full-damage checks; blast edge falloff has its own test.
  const savedFalloff = TUNING.splashEdgeFalloff;
  TUNING.splashEdgeFalloff = 0;
  try {
    const { game, manager } = arena();
    game.player.weapons.singularity = 2;
    const inside = addEnemy(manager, 'pinwheel', 2000, 2000);
    const outside = addEnemy(manager, 'pinwheel', 2000, 2000);
    game.fireSingularity(2);
    const sg = game.singularities[0];
    Object.assign(sg, { x: 2000, y: 2000, vx: 0, vy: 0, life: 1 / 60 });
    assert.equal(sg.collapseDamage, 11 * W.singularityCollapseDamageMult(2) * TUNING.singularityCollapseMult);
    assert.equal(sg.collapseRadius, sg.pullRadius * 0.85);
    Object.assign(inside, { x: 2000 + sg.collapseRadius * 0.9, y: 2000, hp: 1e6, maxHp: 1e6 });
    Object.assign(outside, { x: 2000 + sg.pullRadius + 60, y: 2000, hp: 1e6, maxHp: 1e6 });
    game.updateSingularities(1 / 60);
    assert.equal(game.singularities.length, 0);
    assert.ok(sg.dead, 'collapsed singularity is flagged so its infall streams die with it');
    assert.equal(inside.hp, 1e6 - sg.collapseDamage);
    assert.equal(outside.hp, 1e6);
  } finally {
    TUNING.splashEdgeFalloff = savedFalloff;
  }
});

test('grid wells form a smooth funnel that never folds points through the core', () => {
  const grid = new WarpGrid(1400, 1400, 68);
  const cx = 700, cy = 700, radius = 200;
  for (let t = 0; t < 120; t++) {
    grid.update(300, 300, 800, 800);
    grid.applyWell(cx, cy, 220, radius, 348, 0.22);
  }
  const ring = (lo, hi) => grid.points.filter(pt => { const d = Math.hypot(pt.ox - cx, pt.oy - cy); return d >= lo && d < hi; });
  const inward = (pt) => ((cx - pt.ox) * (pt.x - pt.ox) + (cy - pt.oy) * (pt.y - pt.oy)) / Math.hypot(cx - pt.ox, cy - pt.oy);
  for (const pt of ring(1, radius)) {
    const rest = Math.hypot(pt.ox - cx, pt.oy - cy);
    assert.ok(inward(pt) > 0, 'points inside the well sink toward it');
    assert.ok(Math.hypot(pt.x - cx, pt.y - cy) > rest * 0.1, 'no point is folded onto/through the core');
  }
  const mean = (pts) => pts.reduce((sum, pt) => sum + Math.hypot(pt.x - pt.ox, pt.y - pt.oy), 0) / pts.length;
  assert.ok(mean(ring(60, 110)) > 25, `inner ring only sank ${mean(ring(60, 110)).toFixed(1)}px`);
  assert.ok(mean(ring(60, 110)) > mean(ring(150, 200)), 'warp is strongest near the core');
  assert.ok(mean(ring(radius + 80, radius + 200)) < 6, 'warp fades out beyond the rim');
});

test('infall streams spiral toward their well and vanish when it dies', () => {
  const particles = new ParticleSystem();
  const well = { x: 500, y: 500 };
  particles.spawnInfall(well, 180, 348, 20);
  const start = particles.infall.map(f => f.r);
  particles.update(1 / 60, 4200, 4200);
  particles.infall.forEach((f, i) => assert.ok(f.r < start[i]));
  well.x += 40; // streams ride along with a moving well
  particles.update(1 / 60, 4200, 4200);
  assert.ok(particles.infall.every(f => Math.abs(Math.hypot(f.x - well.x, f.y - well.y) - f.r) < 1e-9));
  well.dead = true;
  particles.update(1 / 60, 4200, 4200);
  assert.equal(particles.infall.length, 0);
});
