import test from 'node:test';
import assert from 'node:assert/strict';

// OVERCHARGE (upgrades.js overchargeReady): once every equipped weapon is LV 18, cards that don't raise a
// weapon's level (general, tag and STATUS cards) keep coming past their own max and keep stacking.
const h = await import('../tools/balance/harness.mjs');
const {
  UPGRADE_POOL, UPGRADE_BY_ID, upgradeKind, upgradeWeapons, eligibleUpgrades, applyUpgradeLevels, levelRoom, acquireWeapon,
  discardWeapon, overchargeReady, canOvercharge, rollUpgrades
} = await import('../js/upgrades.js');
const { ownedWeapons, weaponLevel } = await import('../js/loadout.js');
const { WEAPON_MAX_LEVEL } = await import('../js/weapon-levels.js');
const { describeUpgrade, renderUpgradeCard } = await import('../js/upgrade-cards.js');

function maxWeapons(p, ids) {
  for (const id of ids) {
    acquireWeapon(p, id);
    for (const u of UPGRADE_POOL.filter((x) => upgradeKind(x) === 'weapon' && upgradeWeapons(x).includes(id))) {
      while (levelRoom(p, u) > 0 && weaponLevel(p, id) < WEAPON_MAX_LEVEL) applyUpgradeLevels(p, { ...u, levelJump: 99 });
    }
  }
}

function freshPlayer() {
  const g = h.createHeadlessGame();
  g.resetRun();
  return g.player;
}

const maxOut = (p, id) => applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: UPGRADE_BY_ID[id].maxLevel });

test('overcharge: a maxed general card stays maxed until every weapon is LV 18', () => {
  const p = freshPlayer();
  maxOut(p, 'overdrive');
  assert.equal(overchargeReady(p), false);
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === 'overdrive'));
  maxWeapons(p, ['blaster', 'rockets']);
  assert.ok(ownedWeapons(p).every((id) => weaponLevel(p, id) === WEAPON_MAX_LEVEL));
  assert.equal(overchargeReady(p), true);
  assert.ok(eligibleUpgrades(p).some((u) => u.id === 'overdrive'), 'offered again');
  const before = p.stats.damage;
  assert.equal(applyUpgradeLevels(p, { ...UPGRADE_BY_ID.overdrive, levelJump: 3 }), 3, 'a +3 roll installs all 3');
  assert.equal(p.upgradeLevels.overdrive, UPGRADE_BY_ID.overdrive.maxLevel + 3);
  assert.ok(Math.abs(p.stats.damage / before - 1.12 ** 3) < 1e-9, 'and keeps applying');
  // A new weapon at LV 1 pauses it until that weapon is maxed too.
  acquireWeapon(p, 'missiles');
  assert.equal(overchargeReady(p), false);
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === 'overdrive'));
});

test('overcharge: general, tag and STATUS cards only; evolutions, element cards and passives keep their max', () => {
  for (const u of UPGRADE_POOL) {
    const kind = upgradeKind(u);
    if (kind === 'weapon' || kind === 'core' || kind === 'evolution' || kind === 'element') assert.equal(canOvercharge(u), false, u.id);
  }
  for (const id of ['overdrive', 'thrusters', 'crit_damage', 'tag_kinetic', 'tag_area', 'status_potency', 'fire_damage', 'magnet']) {
    assert.equal(canOvercharge(UPGRADE_BY_ID[id]), true, id);
  }
  assert.equal(canOvercharge(UPGRADE_BY_ID.shrapnel), false, 'Volatile Shatter is a passive with its own level');
  const p = freshPlayer();
  maxWeapons(p, ['blaster']);
  maxOut(p, 'shrapnel');
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === 'shrapnel'));
});

test('overcharge: crit chance stops at 100%', () => {
  const p = freshPlayer();
  maxWeapons(p, ['blaster']);
  maxOut(p, 'crit_chance');
  assert.ok(eligibleUpgrades(p).some((u) => u.id === 'crit_chance'));
  p.stats.critChance = 1;
  assert.ok(!eligibleUpgrades(p).some((u) => u.id === 'crit_chance'));
});

test('overcharge: hands keep dealing cards when everything else is maxed; cards and a discard keep the levels', () => {
  const p = freshPlayer();
  maxWeapons(p, ['blaster', 'rockets']);
  for (const u of UPGRADE_POOL) if (canOvercharge(u) && eligibleUpgrades(p).includes(u)) maxOut(p, u.id);
  assert.ok(rollUpgrades(p, 4).length >= 3, 'no empty ALL SYSTEMS MAXED hand');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.overdrive, levelJump: 1 });
  const html = renderUpgradeCard(describeUpgrade(p, { ...UPGRADE_BY_ID.overdrive, levelJump: 1 }), '[1]').html;
  assert.match(html, /OVERCHARGE/);
  const damage = p.stats.damage;
  discardWeapon(p, 'rockets');
  assert.equal(p.upgradeLevels.overdrive, UPGRADE_BY_ID.overdrive.maxLevel + 1, 'a discard rebuild keeps overcharged levels');
  assert.ok(Math.abs(p.stats.damage - damage) < 1e-9);
});
