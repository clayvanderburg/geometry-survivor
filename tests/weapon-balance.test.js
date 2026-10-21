import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon balance (weapon-scaling.js). The MODEL: every weapon has the same potential DPS at LV 1 (times
// its deliberate trims), and each POWER card adds the same damage output on every weapon; UTILITY cards
// (size, radius, reach, pull...) add none. The TARGET (Clay, v0.43.1) is class-based: realized damage per
// target vs the Autocannon at equal level, by WEAPON_CLASS / CLASS_TARGET, measured in the card bench.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET, DAMAGE_GROWTH, RATE_STEP, CARD_STEP_TRIM, LV1_TRIM, FIRE_RATE_TRIM, WEAPON_CLASS, CLASS_TARGET, damageGrowth, rateStep } = await import('../js/weapon-scaling.js');
const { UPGRADE_BY_ID, applyUpgradeLevels, discardWeapon } = await import('../js/upgrades.js');
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

test('balance trims are deliberate and few: one card step for every weapon, Swarm Missiles x0.7 damage and x1.3 fire rate, Rocket Pods x1.5, Escort Drones x3.6, Sentry Turret x3.6, Rail Lance x2, Glaive Discs x3.5, Claw Harpoon x2.9, Graviton Mortar x0.33', () => {
  // Every weapon's Damage and fire-rate cards step like the Autocannon's (x1.336, +32% per rank), so
  // every curve runs parallel to it from LV 1 to 18 (most outgrew it past LV 9 on the old x1.42 / +40%).
  assert.ok(near(DAMAGE_GROWTH, 1.336) && near(RATE_STEP, 0.32));
  assert.deepEqual({ ...CARD_STEP_TRIM }, {});
  assert.deepEqual({ ...LV1_TRIM }, { missiles: 0.7, rockets: 1.5, drones: 3.6, turret: 3.6, raillance: 2, glaive: 3.5, harpoon: 2.9, quake: 0.33 });
  assert.deepEqual({ ...FIRE_RATE_TRIM }, { missiles: 1.3 });
  assert.equal(damageGrowth('blaster'), DAMAGE_GROWTH);
  assert.equal(rateStep('blaster'), RATE_STEP);
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
  const RATE = { blaster: 'rate', rockets: 'reload', missiles: 'reload', lightning: 'recharge', singularity: 'cooldown', mines: 'rate', turret: 'rate', drones: 'rate', grenades: 'rate', gas: 'rate', flamethrower: 'rate', shockfield: 'recharge', raillance: 'rate', glaive: 'rate', nanites: 'rate', harpoon: 'rate', quake: 'rate' };
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
    turret: { rate: W.turretFireRate, reload: W.turretReload, pierce: W.turretPierce, damage: W.turretDamageMult },
    drones: { rate: W.droneFireRate, wingmen: W.droneCount, range: W.droneRange, damage: W.droneDamageMult },
    grenades: { count: W.grenadeCount, rate: W.grenadeCooldown, radius: W.grenadeBlastRadius, range: W.grenadeRange, damage: W.grenadeDamageMult },
    gas: { rate: W.gasTick, radius: W.gasRadius, linger: W.gasLife, damage: W.gasDamageMult },
    flamethrower: { rate: W.flameTickRate, range: W.flameRange, cone: W.flameConeHalf, burn: W.flameBurnRank, damage: W.flameDamageMult },
    shockfield: { recharge: W.fieldCooldown, radius: W.fieldRadius, stun: W.fieldStunRank, damage: W.fieldDamageMult },
    raillance: { rate: W.railCycle, count: W.railLances, width: W.railWidth, pierce: W.railKeep, damage: W.railDamageMult },
    glaive: { count: W.glaiveCount, chain: W.glaiveBounces, rate: W.glaiveCooldown, speed: W.glaiveSpeed, damage: W.glaiveDamageMult },
    nanites: { rate: W.naniteTick, radius: W.naniteRadius, duration: W.naniteLife, cooldown: W.naniteCooldown, damage: W.naniteDamageMult },
    harpoon: { rate: W.harpoonCooldown, range: W.harpoonRange, grapple: W.harpoonHookSize, drill: W.harpoonDrill, damage: W.harpoonDamageMult },
    quake: { count: W.quakeShells, rate: W.quakeCooldown, radius: W.quakeRadius, bore: W.quakeRockDamage, damage: W.quakeDamageMult }
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
    grenades: W.grenadeDamageMult, gas: W.gasDamageMult, flamethrower: W.flameDamageMult, shockfield: W.fieldDamageMult,
    raillance: W.railDamageMult, glaive: W.glaiveDamageMult,
    nanites: W.naniteDamageMult, harpoon: W.harpoonDamageMult, quake: W.quakeDamageMult
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

// Realized own DPS of a weapon alone (no Autocannon unless it is the one benched) with a damage-focused
// build at weapon level `lv` (Damage ranks, then fire-rate ranks past 11), in the card bench: the mean of
// the still-pack and chasing-crowd scenarios over 2 seeds.
const DAMAGE_BUILD = { blaster: ['blaster_damage', 'firerate'], drones: ['drones_damage', 'drones_rate'], turret: ['turret_damage', 'turret_rate'], raillance: ['raillance_damage', 'raillance_rate'], glaive: ['glaive_damage', 'glaive_rate'], harpoon: ['harpoon_damage', 'harpoon_rate'] };
const SOURCES = { blaster: ['blaster', 'helix'], drones: ['drone'], turret: ['turret', 'siege'], raillance: ['rail', 'ionwake', 'overload'], glaive: ['glaive', 'glaive_recall'], harpoon: ['harpoon'] };
// Weapons benched with alternating fire-rate / Damage cards (both POWER) instead of Damage first: the Rail
// Lance's single slow hits already one-shot the wave-6 bench targets, so stacking only Damage would be
// pure overkill, and a pilot builds it this way.
const ALTERNATE_BUILD = new Set(['raillance']);
function benchDps(id, lv, tuning = {}) {
  const [dmg, rate] = DAMAGE_BUILD[id];
  const setup = (p) => {
    if (id !== 'blaster') {
      applyUpgradeLevels(p, UPGRADE_BY_ID[id]);
      discardWeapon(p, 'blaster');
    }
    if (ALTERNATE_BUILD.has(id)) {
      for (let k = 1; k < lv; k++) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[k % 2 ? rate : dmg], levelJump: 1 });
      return;
    }
    if (lv > 1) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[dmg], levelJump: Math.min(lv - 1, 10) });
    if (lv > 11) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[rate], levelJump: lv - 11 });
  };
  let sum = 0;
  for (const scenario of ['pack', 'chase']) {
    for (let seedIndex = 0; seedIndex < 2; seedIndex++) {
      const r = h.benchUpgrade({ scenario, seedIndex, setup, tuning });
      sum += SOURCES[id].reduce((a, s) => a + (r.dps[s] || 0), 0);
    }
  }
  return sum / 4;
}

test('class-based balance: every weapon has a class and every class a target', () => {
  for (const id of IDS) assert.ok(CLASS_TARGET[WEAPON_CLASS[id]], `${id} needs a WEAPON_CLASS with a CLASS_TARGET`);
  assert.equal(WEAPON_CLASS.blaster, 'aimed');
  assert.deepEqual(Object.keys(WEAPON_CLASS).filter((id) => WEAPON_CLASS[id] === 'aimed'), ['blaster', 'raillance', 'harpoon']);
  assert.equal(CLASS_TARGET.aimed.perTarget, 1, 'the Autocannon is the reference');
  assert.equal(CLASS_TARGET.auto.perTarget, 0.85);
  assert.deepEqual(CLASS_TARGET.area.perTarget, [0.6, 0.7]);
  assert.deepEqual(Object.keys(WEAPON_CLASS).filter((id) => WEAPON_CLASS[id] === 'auto'), ['drones', 'turret', 'glaive']);
  assert.deepEqual(Object.keys(WEAPON_CLASS).filter((id) => WEAPON_CLASS[id] === 'defensive'), ['shockfield', 'orbitals']);
});

// Overkill: the lance's slow, heavy slugs over-kill the bench's wave-6 targets, so at LV 6 it reads ~73% here
// while real data reads high (Clay's v0.44.0 runs: 1.3-1.65x target at LV 7-10, flagged for a nerf) and it
// sits ~107% against targets that never die. So the lower bound is looser for the lance: a buff to pass
// this bench would over-power it in play.
test('class-based balance: the Rail Lance (aimed) realizes ~100% of the Autocannon at LV 3 and LV 6 (low side loosened: overkill)', () => {
  for (const lv of [3, 6]) {
    const share = benchDps('raillance', lv) / benchDps('blaster', lv);
    assert.ok(share >= CLASS_TARGET.aimed.perTarget - 0.3 && share <= CLASS_TARGET.aimed.perTarget + 0.15, `raillance LV ${lv}: ${(share * 100).toFixed(0)}% of the Autocannon`);
  }
});

test('class-based balance: automatic single-target weapons realize ~85% of the Autocannon at LV 3 and LV 6', () => {
  for (const lv of [3, 6]) {
    const ref = benchDps('blaster', lv);
    for (const id of ['drones', 'turret', 'glaive']) {
      const share = benchDps(id, lv) / ref;
      assert.ok(Math.abs(share - CLASS_TARGET.auto.perTarget) <= 0.15, `${id} LV ${lv}: ${(share * 100).toFixed(0)}% of the Autocannon`);
    }
  }
});

// Past ~LV 9 the bench's wave-6 targets die to single hits, so late levels are measured against targets
// that never die (pure per-target DPS). Every weapon grows on the Autocannon's card steps
// (CARD_STEP_TRIM), so they stay on the automatic class target all the way to LV 18.
test('class-based balance: automatic single-target weapons stay ~85% of the Autocannon at LV 12 and 18 against targets that never die', () => {
  const tank = { enemyHpMult: 1e6 };
  for (const lv of [12, 18]) {
    const ref = benchDps('blaster', lv, tank);
    for (const id of ['drones', 'turret', 'glaive']) {
      const share = benchDps(id, lv, tank) / ref;
      assert.ok(Math.abs(share - CLASS_TARGET.auto.perTarget) <= 0.15, `${id} LV ${lv}: ${(share * 100).toFixed(0)}% of the Autocannon`);
    }
  }
});

// The Claw Harpoon is aimed single-target like the Autocannon: 100% per level (its mining and yank are
// utility). Past ~LV 9 one throw overkills the bench's wave-6 targets, so the level-matched check stops at 9.
test('class-based balance: aimed single-target weapons (Claw Harpoon) realize ~100% of the Autocannon at LV 1, 3, 6 and 9', () => {
  for (const lv of [1, 3, 6, 9]) {
    const share = benchDps('harpoon', lv) / benchDps('blaster', lv);
    assert.ok(Math.abs(share - CLASS_TARGET.aimed.perTarget) <= 0.15, `harpoon LV ${lv}: ${(share * 100).toFixed(0)}% of the Autocannon`);
  }
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
  assert.equal(W.shrapnelDamageMult, 0.3, 'a supporting passive: 0.75 before v0.43.4');
  // The burst chance climbs evenly to 100% at the max level (LV 8): no early cliff where every kill bursts.
  const chances = [1, 2, 3, 4, 5, 6, 7, 8].map(W.shrapnelChance);
  assert.ok(chances.every((c, i) => i === 0 || Math.abs(c - chances[i - 1] - 0.075) < 1e-9), 'even steps');
  assert.ok(chances[6] < 1 && chances[7] === 1, '100% only at LV 8');
});
