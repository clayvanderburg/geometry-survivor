import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon balance rule (docs/GAME_DESIGN_BACKLOG.md): every weapon has the same potential DPS at the
// same level. Difficulty of use is tuned separately, so this pins the potential, not real fights.
const h = await import('../tools/balance/harness.mjs');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET } = await import('../js/weapon-scaling.js');
const { UPGRADE_POOL } = await import('../js/upgrades.js');

// Weapons whose damage depends on something other than attacking: shards need kills, the dash nova
// needs dashes. They stay outside the per-level DPS curve.
const CONDITIONAL = new Set(['shrapnel', 'thrusters']);
const maxLevel = (id) => UPGRADE_POOL.find((u) => u.id === id).maxLevel;

test('every weapon card is on the shared DPS curve', () => {
  const weapons = h.classifyUpgrades().filter((c) => c.isWeapon && !c.isSynergy && !CONDITIONAL.has(c.id));
  assert.ok(weapons.length >= 7);
  for (const w of weapons) assert.ok(POTENTIAL_DPS[w.id], `${w.id} needs a POTENTIAL_DPS entry`);
});

test('all weapons deliver the same potential DPS at the same level', () => {
  for (const [id, dps] of Object.entries(POTENTIAL_DPS)) {
    for (let lv = 1; lv <= maxLevel(id); lv++) {
      const err = Math.abs(dps(lv) - DPS_TARGET(lv)) / DPS_TARGET(lv);
      assert.ok(err < 0.01, `${id} LV ${lv}: ${dps(lv).toFixed(2)} vs target ${DPS_TARGET(lv).toFixed(2)}`);
    }
  }
});

test('damage per hit never drops when a weapon levels up', () => {
  const perHit = {
    rockets: W.wingRocketDamageMult, missiles: W.missileDamageMult, lightning: W.lightningDamageMult, singularity: W.singularityDamageMult,
    collapse: W.singularityCollapseDamageMult, orbitals: W.orbitalDamageMult, mines: W.mineDamageMult,
    turret: W.turretDamageMult, drones: W.droneDamageMult
  };
  for (const [id, f] of Object.entries(perHit)) {
    const top = maxLevel(id === 'collapse' ? 'singularity' : id);
    for (let lv = 2; lv <= top; lv++) assert.ok(f(lv) >= f(lv - 1) - 1e-9, `${id} LV ${lv - 1} -> ${lv}`);
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

test('Swarm Micro-Missiles fire 25% faster at 80% damage per missile, same potential DPS', () => {
  const oldCooldown = (lv) => Math.max(1.2, 1.9 - lv * 0.1);
  for (let lv = 1; lv <= maxLevel('missiles'); lv++) {
    assert.ok(Math.abs(W.missileCooldown(lv) - 0.8 * oldCooldown(lv)) < 1e-9, `LV ${lv} cooldown`);
    const oldPerMissile = DPS_TARGET(lv) * oldCooldown(lv) / W.missileSalvo(lv);
    assert.ok(Math.abs(W.missileDamageMult(lv) - 0.8 * oldPerMissile) < 1e-9, `LV ${lv} per-missile damage`);
    assert.ok(Math.abs(POTENTIAL_DPS.missiles(lv) / DPS_TARGET(lv) - 1) < 1e-9, `LV ${lv} DPS parity`);
  }
});

test('Sentry Turret fires twice as fast for half damage per bolt, same potential DPS', () => {
  for (let lv = 1; lv <= maxLevel('turret'); lv++) {
    const oldRate = 2.6 + lv * 0.45;
    assert.ok(Math.abs(W.turretFireRate(lv) - 2 * oldRate) < 1e-9, `LV ${lv} fire rate`);
    const oldPerBolt = DPS_TARGET(lv) / (W.turretAverageActive(lv) * oldRate);
    assert.ok(Math.abs(W.turretDamageMult(lv) - oldPerBolt / 2) < 1e-9, `LV ${lv} per-bolt damage`);
    assert.ok(Math.abs(POTENTIAL_DPS.turret(lv) / DPS_TARGET(lv) - 1) < 1e-9, `LV ${lv} DPS parity`);
  }
});

test('Volatile Shatter stays off the DPS curve: flat shard damage, gated by kills', () => {
  assert.ok(!('shrapnel' in POTENTIAL_DPS), 'passive, conditional on kills');
  assert.equal(W.shrapnelDamageMult, 0.75);
});

test('Escort Drones fire four times as fast for a quarter of the damage per bolt, same potential DPS', () => {
  for (let lv = 1; lv <= maxLevel('drones'); lv++) {
    const oldRate = 1.6 + lv * 0.3;
    assert.ok(Math.abs(W.droneFireRate(lv) - 4 * oldRate) < 1e-9, `LV ${lv} fire rate`);
    const oldPerBolt = DPS_TARGET(lv) / (W.droneCount(lv) * oldRate);
    assert.ok(Math.abs(W.droneDamageMult(lv) - oldPerBolt / 4) < 1e-9, `LV ${lv} per-bolt damage`);
    assert.ok(Math.abs(POTENTIAL_DPS.drones(lv) / DPS_TARGET(lv) - 1) < 1e-9, `LV ${lv} DPS parity`);
  }
});
