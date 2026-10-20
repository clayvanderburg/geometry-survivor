import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon balance rule (weapon-scaling.js): every weapon has the same potential DPS at LV 1, and each
// POWER card adds the same damage output on every weapon, so weapons built for damage stay equal.
// UTILITY cards (size, radius, reach, pull...) add none. Difficulty of use is tuned separately.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, CARD_STEP_TRIM, LV1_TRIM, FIRE_RATE_TRIM, damageGrowth, rateStep } = await import('../js/weapon-scaling.js');
const { STAT_CARDS, POWER_STATS, makeBuild, levelBuild, BT_TRANSFORM_DPS, BT_BOOST_DPS, BREAKTHROUGH_LEVELS, WEAPON_MAX_LEVEL } = await import('../js/weapon-levels.js');

// Weapons whose damage depends on something other than attacking: shards need kills, the dash nova
// needs dashes. They stay outside the DPS curve.
const CONDITIONAL = new Set(['shrapnel', 'thrusters']);
const IDS = Object.keys(STAT_CARDS);
const near = (a, b, tol = 1e-6) => Math.abs(a / b - 1) < tol;
const lv1 = (id) => POTENTIAL_DPS[id](levelBuild(id, 1));
// LV 1 potential after a weapon's deliberate LV1_TRIM and FIRE_RATE_TRIM (1 for weapons on the shared curve).
const lv1Target = (id) => DPS_TARGET(1) * (LV1_TRIM[id] ?? 1) * (FIRE_RATE_TRIM[id] ?? 1);

test('every weapon is on the shared DPS curve', () => {
  const weapons = h.classifyUpgrades().filter((c) => c.isWeapon && !c.isSynergy && !CONDITIONAL.has(c.id));
  assert.ok(weapons.length >= 7);
  for (const w of weapons) assert.ok(POTENTIAL_DPS[w.id], `${w.id} needs a POTENTIAL_DPS entry`);
  for (const id of IDS) assert.ok(POTENTIAL_DPS[id], `${id} needs a POTENTIAL_DPS entry`);
});

test('all weapons deliver the same potential DPS at LV 1 (times their LV1_TRIM and FIRE_RATE_TRIM)', () => {
  for (const id of IDS) assert.ok(near(lv1(id), lv1Target(id)), `${id}: ${lv1(id).toFixed(3)} vs ${lv1Target(id)}`);
});

test('balance trims are deliberate and few: Autocannon card steps x0.8, Swarm Missiles x0.7 damage and x1.3 fire rate, Rocket Pods x1.5', () => {
  assert.deepEqual({ ...CARD_STEP_TRIM }, { blaster: 0.8 });
  assert.deepEqual({ ...LV1_TRIM }, { missiles: 0.7, rockets: 1.5 });
  assert.deepEqual({ ...FIRE_RATE_TRIM }, { missiles: 1.3 });
  assert.ok(near(damageGrowth('blaster'), 1 + (DAMAGE_GROWTH - 1) * 0.8));
  assert.ok(near(rateStep('blaster'), RATE_STEP * 0.8));
  assert.equal(damageGrowth('rockets'), DAMAGE_GROWTH);
  assert.equal(rateStep('rockets'), RATE_STEP);
});

test('weapons built for damage stay equal: every Damage rank is the same x DAMAGE_GROWTH on every weapon (times its CARD_STEP_TRIM)', () => {
  for (let r = 0; r < WEAPON_MAX_LEVEL; r++) {
    for (const id of IDS) {
      const dps = POTENTIAL_DPS[id](makeBuild(id, 1 + r, { damage: r }));
      assert.ok(near(dps, lv1Target(id) * damageGrowth(id) ** r), `${id} with ${r} Damage ranks: ${dps.toFixed(2)}`);
    }
  }
});

test('fire rate / reload / recharge / cooldown ranks add the same +RATE_STEP attack rate on every weapon (times its CARD_STEP_TRIM)', () => {
  const RATE = { blaster: 'rate', rockets: 'reload', missiles: 'reload', lightning: 'recharge', singularity: 'cooldown', mines: 'rate', turret: 'rate', drones: 'rate', grenades: 'rate', gas: 'rate', flamethrower: 'rate', shockfield: 'recharge' };
  for (const [id, stat] of Object.entries(RATE)) {
    for (let r = 1; r <= 6; r++) {
      const dps = POTENTIAL_DPS[id](makeBuild(id, 1 + r, { [stat]: r }));
      assert.ok(near(dps, lv1(id) * (1 + rateStep(id) * r)), `${id} ${stat} x${r}`);
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
    drones: { rate: W.droneFireRate, wingmen: W.droneCount, range: W.droneRange, damage: W.droneDamageMult },
    grenades: { count: W.grenadeCount, rate: W.grenadeCooldown, radius: W.grenadeBlastRadius, range: W.grenadeRange, damage: W.grenadeDamageMult },
    gas: { rate: W.gasTick, radius: W.gasRadius, linger: W.gasLife, damage: W.gasDamageMult },
    flamethrower: { rate: W.flameTickRate, range: W.flameRange, cone: W.flameConeHalf, burn: W.flameBurnRank, damage: W.flameDamageMult },
    shockfield: { recharge: W.fieldCooldown, radius: W.fieldRadius, stun: W.fieldStunRank, damage: W.fieldDamageMult }
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

test('Breakthroughs: each transform adds exactly BT_TRANSFORM_DPS, ACROSS THE BOARD exactly BT_BOOST_DPS (+1 utility rank)', () => {
  for (const id of IDS) {
    for (const m of BREAKTHROUGH_LEVELS) {
      const ranks = { damage: 2 };
      const plain = POTENTIAL_DPS[id](makeBuild(id, m, ranks));
      const t = POTENTIAL_DPS[id](makeBuild(id, m, ranks, { [m]: 'transform' }));
      assert.ok(near(t, plain * BT_TRANSFORM_DPS), `${id} LV ${m} transform: x${(t / plain).toFixed(3)}`);
      const boost = makeBuild(id, m, ranks, { [m]: 'boost' });
      assert.equal(boost.r.damage, 2, 'no free POWER ranks');
      for (const c of STAT_CARDS[id]) if (!POWER_STATS.has(c.stat)) assert.equal(boost.r[c.stat], 1, `${id} ${c.stat} +1`);
      assert.ok(near(POTENTIAL_DPS[id](boost), plain * BT_BOOST_DPS), `${id} LV ${m} boost: x${(POTENTIAL_DPS[id](boost) / plain).toFixed(3)}`);
    }
    const all = POTENTIAL_DPS[id](makeBuild(id, 12, {}, { 6: 'transform', 12: 'transform', 18: 'transform' }));
    assert.ok(near(all, lv1(id) * BT_TRANSFORM_DPS ** 3), `${id} three transforms`);
  }
});

test('damage per hit never drops as Damage ranks go up', () => {
  const perHit = {
    rockets: W.wingRocketDamageMult, missiles: W.missileDamageMult, lightning: W.lightningDamageMult, singularity: W.singularityDamageMult,
    orbitals: W.orbitalDamageMult, mines: W.mineDamageMult, turret: W.turretDamageMult, drones: W.droneDamageMult,
    grenades: W.grenadeDamageMult, gas: W.gasDamageMult, flamethrower: W.flameDamageMult, shockfield: W.fieldDamageMult
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

// Clay's weapons pass: offensive openers sit level with the Autocannon (raised, never by nerfing it), and
// the close-range Orbit Blades get a wider, faster ring. Missiles and rockets look weak in the potential
// model's own terms (splash, overkill), so their LV1_TRIM is set from the card benches, not from POTENTIAL_DPS.
test('weapons pass: Swarm Missiles +30% fire rate, Rocket Pods faster and harder, Orbit Blades +50% ring / +30% spin', () => {
  const b = (id) => levelBuild(id, 1);
  assert.ok(near(1.44 / W.missileCooldown(b('missiles')), 1.3), 'missiles fire 30% faster than the 1.44 s of v0.42');
  // Clay: +30% fire rate as a real gain (hits not rescaled down) and half -> 70% damage: ~1.82x v0.42 DPS.
  assert.ok(near(W.missileDamageMult(b('missiles')), 0.7 * DPS_TARGET(1) * 1.44 / 2), 'missiles hit 1.4x as hard as v0.42 (0.5 -> 0.7)');
  assert.ok(near(lv1('missiles') / (0.5 * DPS_TARGET(1)), 1.3 * 1.4), 'missile DPS is 1.82x v0.42 at LV 1');
  assert.ok(near(POTENTIAL_DPS.missiles(makeBuild('missiles', 8, { damage: 4, reload: 3 })) / lv1('missiles'), DAMAGE_GROWTH ** 4 * (1 + RATE_STEP * 3)), '...and at every level');
  assert.ok(lv1('rockets') >= lv1('blaster') * 1.25, 'Rocket Pods out-potential the Autocannon at LV 1 (their hits splash, overkill or miss)');
  assert.equal(W.orbitalRadius(b('orbitals')), 155); // 103 * 1.5
  assert.ok(near(W.orbitalSpin(b('orbitals')), 4.85 * 1.3, 0.01));
  // A maxed ring (11 Reach + 11 Spin ranks, plus 3 from ACROSS THE BOARD) stays on a 720 px screen and its
  // blades never move further per tick than a swarmer's contact width (14 px hull + 18 px blade, both sides),
  // so they cannot skip past one.
  const max = makeBuild('orbitals', 18, { radius: 14, spin: 14 });
  assert.ok(W.orbitalRadius(max) <= 300, `ring radius ${W.orbitalRadius(max)} px`);
  const step = W.orbitalSpin(max) * W.orbitalRadius(max) / 60;
  assert.ok(step <= 2 * (14 + 18), `blade step ${step.toFixed(1)} px/tick`);
});

test('LV 1 numbers keep the earlier retunes: fast light missiles, turrets and drones; wide mines', () => {
  const b = (id) => levelBuild(id, 1);
  assert.ok(near(W.missileCooldown(b('missiles')), 1.44 / 1.3));
  assert.ok(Math.abs(W.turretFireRate(b('turret')) - 6.1) < 1e-9);
  assert.ok(Math.abs(W.droneFireRate(b('drones')) - 7.6) < 1e-9);
  assert.equal(W.mineBlastRadius(b('mines')), 120);
  assert.equal(W.lightningRange(b('lightning')), 420);
  assert.equal(W.turretRange(b('turret')), 476);
  assert.equal(W.droneRange(b('drones')), 784);
});

test('Volatile Shatter stays off the DPS curve: flat shard damage, gated by kills', () => {
  assert.ok(!('shrapnel' in POTENTIAL_DPS), 'passive, conditional on kills');
  assert.equal(W.shrapnelDamageMult, 0.75);
});
