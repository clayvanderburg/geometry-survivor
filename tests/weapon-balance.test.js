import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon balance rule (weapon-scaling.js): every weapon has the same potential DPS at LV 1, and each
// POWER card adds the same damage output on every weapon, so weapons built for damage stay equal.
// UTILITY cards (size, radius, reach, pull...) add none. Difficulty of use is tuned separately.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, makeBuild, levelBuild, BT_TRANSFORM_DPS, BT_BOOST_DPS, BREAKTHROUGH_LEVELS, WEAPON_MAX_LEVEL } = await import('../js/weapon-levels.js');

// Weapons whose damage depends on something other than attacking: shards need kills, the dash nova
// needs dashes. They stay outside the DPS curve.
const CONDITIONAL = new Set(['shrapnel', 'thrusters']);
const IDS = Object.keys(STAT_CARDS);
const near = (a, b, tol = 1e-6) => Math.abs(a / b - 1) < tol;
const lv1 = (id) => POTENTIAL_DPS[id](levelBuild(id, 1));

test('every weapon is on the shared DPS curve', () => {
  const weapons = h.classifyUpgrades().filter((c) => c.isWeapon && !c.isSynergy && !CONDITIONAL.has(c.id));
  assert.ok(weapons.length >= 7);
  for (const w of weapons) assert.ok(POTENTIAL_DPS[w.id], `${w.id} needs a POTENTIAL_DPS entry`);
  for (const id of IDS) assert.ok(POTENTIAL_DPS[id], `${id} needs a POTENTIAL_DPS entry`);
});

test('all weapons deliver the same potential DPS at LV 1', () => {
  for (const id of IDS) assert.ok(near(lv1(id), DPS_TARGET(1)), `${id}: ${lv1(id).toFixed(3)} vs ${DPS_TARGET(1)}`);
});

test('weapons built for damage stay equal: every Damage rank is the same x DAMAGE_GROWTH on every weapon', () => {
  for (let r = 0; r < WEAPON_MAX_LEVEL; r++) {
    for (const id of IDS) {
      const dps = POTENTIAL_DPS[id](makeBuild(id, 1 + r, { damage: r }));
      assert.ok(near(dps, DPS_TARGET(1) * DAMAGE_GROWTH ** r), `${id} with ${r} Damage ranks: ${dps.toFixed(2)}`);
    }
  }
});

test('fire rate / reload / recharge / cooldown ranks add the same +RATE_STEP attack rate on every weapon', () => {
  const RATE = { blaster: 'rate', rockets: 'reload', missiles: 'reload', lightning: 'recharge', singularity: 'cooldown', mines: 'rate', turret: 'rate', drones: 'rate' };
  for (const [id, stat] of Object.entries(RATE)) {
    for (let r = 1; r <= 6; r++) {
      const dps = POTENTIAL_DPS[id](makeBuild(id, 1 + r, { [stat]: r }));
      assert.ok(near(dps, lv1(id) * (1 + RATE_STEP * r)), `${id} ${stat} x${r}`);
    }
  }
});

test('every stat card changes only its own stat: utility cards add no potential DPS, power cards always add some', () => {
  for (const id of IDS) {
    for (const c of STAT_CARDS[id]) {
      const dps = POTENTIAL_DPS[id](makeBuild(id, 4, { [c.stat]: 3 }));
      if (POWER_STATS.has(c.stat)) assert.ok(dps > lv1(id) * 1.01, `${c.id} is POWER but adds no DPS`);
      else assert.ok(near(dps, lv1(id)), `${c.id} is UTILITY but changes DPS (${dps.toFixed(3)} vs ${lv1(id).toFixed(3)})`);
    }
  }
});

test('every stat formula reads only its own rank', () => {
  // Raising one stat leaves every other single-stat formula of that weapon unchanged.
  const FORMULAS = {
    rockets: { count: W.wingRocketCount, reload: W.wingRocketCooldown, radius: W.wingRocketBlastRadius },
    missiles: { salvo: W.missileSalvo, reload: W.missileCooldown, radius: W.missileBlastRadius },
    lightning: { chain: W.lightningJumps, recharge: W.lightningCooldown, reach: W.lightningRange },
    singularity: { pull: W.singularityPullRadius, duration: W.singularityLife, cooldown: W.singularityCooldown, core: W.singularityCoreRadius, damage: W.singularityCollapseDamageMult },
    orbitals: { count: W.orbitalBlades, radius: W.orbitalRadius, spin: W.orbitalSpin, size: W.orbitalBladeRadius },
    mines: { capacity: W.mineMaxActive, rate: W.mineCooldown, radius: W.mineBlastRadius, fuse: W.mineLifetime, damage: W.mineDamageMult },
    turret: { rate: W.turretFireRate, lifetime: W.turretDuration, redeploy: W.turretCooldown, damage: W.turretDamageMult },
    drones: { rate: W.droneFireRate, wingmen: W.droneCount, range: W.droneRange, damage: W.droneDamageMult }
  };
  for (const [id, fs] of Object.entries(FORMULAS)) {
    const base = levelBuild(id, 1);
    for (const card of STAT_CARDS[id]) {
      const b = makeBuild(id, 4, { [card.stat]: 3 });
      for (const [stat, f] of Object.entries(fs)) {
        if (stat === card.stat) assert.notEqual(f(b), f(base), `${card.id} should change ${stat}`);
        else assert.equal(f(b), f(base), `${card.id} must not change ${stat}`);
      }
    }
  }
});

test('Breakthroughs: each transform adds exactly BT_TRANSFORM_DPS, ACROSS THE BOARD a rank of everything and BT_BOOST_DPS', () => {
  for (const id of IDS) {
    for (const m of BREAKTHROUGH_LEVELS) {
      const ranks = { damage: 2 };
      const plain = POTENTIAL_DPS[id](makeBuild(id, m, ranks));
      const t = POTENTIAL_DPS[id](makeBuild(id, m, ranks, { [m]: 'transform' }));
      assert.ok(near(t, plain * BT_TRANSFORM_DPS), `${id} LV ${m} transform: x${(t / plain).toFixed(3)}`);
      const boost = makeBuild(id, m, ranks, { [m]: 'boost' });
      assert.equal(boost.r.damage, 3);
      assert.ok(POTENTIAL_DPS[id](boost) > plain * BT_BOOST_DPS, `${id} LV ${m} boost`);
    }
    const all = POTENTIAL_DPS[id](makeBuild(id, 12, {}, { 4: 'transform', 8: 'transform', 12: 'transform' }));
    assert.ok(near(all, lv1(id) * BT_TRANSFORM_DPS ** 3), `${id} three transforms`);
  }
});

test('damage per hit never drops as Damage ranks go up', () => {
  const perHit = {
    rockets: W.wingRocketDamageMult, missiles: W.missileDamageMult, lightning: W.lightningDamageMult, singularity: W.singularityDamageMult,
    orbitals: W.orbitalDamageMult, mines: W.mineDamageMult, turret: W.turretDamageMult, drones: W.droneDamageMult
  };
  for (const [id, f] of Object.entries(perHit)) {
    for (let r = 1; r < WEAPON_MAX_LEVEL; r++) assert.ok(f(makeBuild(id, 1 + r, { damage: r })) > f(makeBuild(id, r, { damage: r - 1 })), `${id} rank ${r}`);
  }
});

test('blasts deal full damage at the center and fade to 60% at the rim', async () => {
  globalThis.window ??= { addEventListener() {} };
  const { Game } = await import('../js/main.js');
  const { TUNING } = await import('../js/config.js');
  const mk = (x) => ({ type: 'swarmer', x, y: 0, hp: 1000, maxHp: 1000, radius: 10, hue: 1, score: 1, xp: 1 });
  const center = mk(0), rim = mk(110);
  const g = Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies: [center, rim] }, grid: { applyImpulse() {} }, particles: new Proxy({}, { get: () => () => {} }),
    sound: new Proxy({}, { get: () => () => {} }), player: null, killEnemy() {}
  });
  g.damageEnemiesInRadius(0, 0, 100, 100, 1, 'missile', 0);
  assert.equal(1000 - center.hp, 100);
  assert.ok(Math.abs((1000 - rim.hp) - 100 * (1 - TUNING.splashEdgeFalloff)) < 1e-9, `rim took ${1000 - rim.hp}`);
});

test('piercing bolts hit the first enemy for full damage and each one behind for 70% of the last', async () => {
  const { Game } = await import('../js/main.js');
  const { TUNING } = await import('../js/config.js');
  const mk = (x) => ({ type: 'swarmer', x, y: 0, hp: 1000, maxHp: 1000, radius: 10, hue: 1, score: 1, xp: 1 });
  const row = [mk(100), mk(140), mk(180)];
  const silent = new Proxy({}, { get: () => () => {} });
  const g = Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies: row }, asteroidManager: { asteroids: [], cellSize: 140, getNearbyAsteroids() { return []; } },
    grid: silent, particles: silent, sound: silent, player: null, worldWidth: 4200, worldHeight: 4200, killEnemy() {},
    bullets: [{ x: 60, y: 0, vx: 150, vy: 0, damage: 100, pierce: 5, hue: 1, radius: 4, life: 1 }]
  });
  g.updateBullets(1 / 60);
  const f = TUNING.pierceFalloff;
  assert.deepEqual(row.map((e) => +(1000 - e.hp).toFixed(6)), [100, +(100 * f).toFixed(6), +(100 * f * f).toFixed(6)]);
});

test('LV 1 numbers keep the earlier retunes: fast light missiles, turrets and drones; wide mines', () => {
  const b = (id) => levelBuild(id, 1);
  assert.equal(W.missileCooldown(b('missiles')), 1.44);
  assert.ok(Math.abs(W.turretFireRate(b('turret')) - 6.1) < 1e-9);
  assert.ok(Math.abs(W.droneFireRate(b('drones')) - 7.6) < 1e-9);
  assert.equal(W.mineBlastRadius(b('mines')), 180);
});

test('Volatile Shatter stays off the DPS curve: flat shard damage, gated by kills', () => {
  assert.ok(!('shrapnel' in POTENTIAL_DPS), 'passive, conditional on kills');
  assert.equal(W.shrapnelDamageMult, 0.75);
});
