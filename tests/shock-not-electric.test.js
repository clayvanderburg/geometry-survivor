import test from 'node:test';
import assert from 'node:assert/strict';

// v0.46 (Clay: "let's just get rid of electric and have shock"): no ELECTRIC tag and no Overvolt Coils. Tesla
// Arc and the Shock Field carry the SHOCK chip (like the sprayers' BURN / CHILL / CORRODE), and Shock Amplifier
// is their one damage card. Old Overvolt Coils ranks load cleanly.
const h = await import('../tools/balance/harness.mjs');
const U = await import('../js/upgrades.js');
const { WEAPON_TAGS, TAG_INFO, WEAPON_SCALING: W, weaponDamage } = await import('../js/weapon-scaling.js');
const { weaponTags } = await import('../js/loadout.js');
const { describeUpgrade, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { sanitizeRangeConfig, RANGE_MOD_IDS } = await import('../js/weapon-range.js');

function player(weapons) {
  const g = h.createHeadlessGame();
  g.resetRun();
  for (const w of weapons) U.acquireWeapon(g.player, w);
  return g;
}

test('no ELECTRIC anywhere: Tesla Arc is SHOCK, the Shock Field SHOCK + AREA, and the chip is the element one', () => {
  assert.ok(!('electric' in TAG_INFO));
  assert.ok(Object.values(WEAPON_TAGS).every((tags) => !tags.includes('electric')));
  assert.deepEqual(weaponTags('lightning'), ['shock']);
  assert.deepEqual(weaponTags('shockfield'), ['shock', 'area']);
  assert.equal(TAG_INFO.shock.label, 'SHOCK');
  assert.ok(!('electric' in W.tagDamageStep));
  assert.ok(!U.UPGRADE_BY_ID.tag_electric, 'Overvolt Coils is retired');
  assert.ok(U.UPGRADE_POOL.every((u) => !(u.tags || []).includes('electric')), 'no card wears the ELECTRIC chip');
  assert.deepEqual(U.UPGRADE_BY_ID.evo_tempest.tags, ['explosive', 'shock']);
  assert.deepEqual(U.UPGRADE_BY_ID.evo_emp.tags, ['explosive', 'shock']);
  assert.ok(!RANGE_MOD_IDS.includes('tag_electric'));
  assert.equal(U.RETIRED_CARDS.tag_electric, 'Overvolt Coils (retired)', 'old run stats still get a name');
});

test('Shock Amplifier is the SHOCK damage card for Tesla arcs, Storm Protocol / EMP arcs and Shock Field discharges', () => {
  const g = player(['lightning', 'shockfield']);
  const p = g.player;
  const ids = U.eligibleUpgrades(p).map((u) => u.id);
  assert.ok(ids.includes('shock_damage'));
  assert.ok(!ids.some((id) => /electric/.test(id)));
  const before = { arc: weaponDamage(p, 'lightning', 1), field: weaponDamage(p, 'shockfield', 1) };
  U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID.shock_damage, levelJump: 2 });
  assert.ok(Math.abs(weaponDamage(p, 'lightning', 1) / before.arc - (1 + 2 * W.elementDamageStep)) < 1e-9);
  assert.ok(Math.abs(weaponDamage(p, 'shockfield', 1) / before.field - (1 + 2 * W.elementDamageStep)) < 1e-9);
  const d = describeUpgrade(p, { ...U.UPGRADE_BY_ID.shock_damage, levelJump: 1 });
  assert.deepEqual(d.reach.ids, ['lightning', 'shockfield']);
  assert.ok(!/ELECTRIC/.test(renderUpgradeCard(d, '[1]').html));
});

test('old Overvolt Coils ranks load cleanly: a leftover rank does nothing, the Weapon Range moves it to Shock Amplifier', () => {
  const g = player(['lightning']);
  const p = g.player;
  const arc = weaponDamage(p, 'lightning', 1);
  p.upgradeLevels.tag_electric = 3; // a pre-v0.46 rank, e.g. from a hand-edited state
  assert.equal(weaponDamage(p, 'lightning', 1), arc, 'no damage from a retired card');
  for (let i = 0; i < 20; i++) assert.ok(U.rollUpgrades(p, 4).every((c) => c.id !== 'tag_electric'));
  assert.doesNotThrow(() => U.discardWeapon(p, 'lightning'));
  // A level-up hand with a retired id locked or banished is simply never offered it.
  p.banished = { tag_electric: true };
  assert.doesNotThrow(() => U.rollUpgrades(p, 4));
  // The Weapon Range's saved mods: Overvolt Coils ranks become Shock Amplifier ranks, unless it has its own.
  assert.deepEqual(sanitizeRangeConfig({ mods: { tag_electric: 4 } }).mods, { shock_damage: 4 });
  assert.deepEqual(sanitizeRangeConfig({ mods: { tag_electric: 4, shock_damage: 1 } }).mods, { shock_damage: 1 });
  assert.deepEqual(sanitizeRangeConfig({ mods: { tag_electric: 99 } }).mods, { shock_damage: U.UPGRADE_BY_ID.shock_damage.maxLevel });
});
