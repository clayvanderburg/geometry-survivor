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
    missiles: W.missileDamageMult, lightning: W.lightningDamageMult, singularity: W.singularityDamageMult,
    collapse: W.singularityCollapseDamageMult, orbitals: W.orbitalDamageMult, mines: W.mineDamageMult,
    turret: W.turretDamageMult, drones: W.droneDamageMult
  };
  for (const [id, f] of Object.entries(perHit)) {
    const top = maxLevel(id === 'collapse' ? 'singularity' : id);
    for (let lv = 2; lv <= top; lv++) assert.ok(f(lv) >= f(lv - 1) - 1e-9, `${id} LV ${lv - 1} -> ${lv}`);
  }
});
