import test from 'node:test';
import assert from 'node:assert/strict';

// Evolution recipes on cards (js/evolution-recipes.js): the data mirrors each evolution's real gate
// (upgrades.js req + loadoutAllows), cards that move a recipe forward show it, and the Field Guide lists it.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, UPGRADE_POOL, applyUpgradeLevels, acquireWeapon, loadoutAllows } = await import('../js/upgrades.js');
const { WEAPONS } = await import('../js/loadout.js');
const { ELEMENT_CARD_LIST } = await import('../js/weapon-levels.js');
const { EVOLUTION_RECIPES, EVOLUTION_IDS, recipeMet, readyEvolutions, recipesAdvanced, recipeView, recipeStripHtml, ingredientLabel } = await import('../js/evolution-recipes.js');
const { describeUpgrade, describeWeaponPick, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { upgradesHTML } = await import('../js/field-guide-ui.js');

function freshPlayer() {
  const g = h.createHeadlessGame({ mode: 'normal' });
  g.resetRun(g.selectedMode);
  return g.player;
}
const install = (p, id, levelJump = 1) => applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump });
const gate = (p, id) => loadoutAllows(p, UPGRADE_BY_ID[id]) && !!UPGRADE_BY_ID[id].req(p);

test('every evolution has a recipe, and every recipe names real cards and weapons', () => {
  assert.ok(EVOLUTION_IDS.length >= 6);
  for (const id of EVOLUTION_IDS) assert.ok(EVOLUTION_RECIPES[id]?.length, `${id} needs a recipe in js/evolution-recipes.js`);
  for (const id of Object.keys(EVOLUTION_RECIPES)) assert.ok(UPGRADE_BY_ID[id]?.isSynergy, `${id} is not an evolution`);
  const walk = (ing) => {
    if (ing.anyOf) return ing.anyOf.forEach(walk);
    if (ing.card) assert.ok(UPGRADE_BY_ID[ing.card], ing.card);
    if (ing.weapon) assert.ok(WEAPONS.some((w) => w.id === ing.weapon), ing.weapon);
    assert.ok(ingredientLabel(ing).length > 0);
  };
  Object.values(EVOLUTION_RECIPES).flat().forEach(walk);
});

// Random builds: the recipe is complete exactly when the real gate lets the evolution into a hand.
test('recipes match each evolution\'s real requirement on random builds', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const weapons = WEAPONS.map((w) => w.id).filter((id) => id !== 'blaster');
  const cards = ['mining_speed', 'multishot', 'firerate', 'crit_chance', 'crit_chance', 'crit_chance', ...ELEMENT_CARD_LIST.map((c) => c.id)];
  const seen = Object.fromEntries(EVOLUTION_IDS.map((id) => [id, { yes: 0, no: 0 }]));
  for (let run = 0; run < 300; run++) {
    const p = freshPlayer();
    for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) acquireWeapon(p, weapons[Math.floor(rand() * weapons.length)]);
    for (let i = 0; i < Math.floor(rand() * 14); i++) {
      const u = UPGRADE_BY_ID[cards[Math.floor(rand() * cards.length)]];
      if (loadoutAllows(p, u) && (!u.req || u.req(p))) install(p, u.id);
    }
    for (const id of EVOLUTION_IDS) {
      assert.equal(recipeMet(p, id), gate(p, id), `${id} on ${JSON.stringify(p.loadout)} ${JSON.stringify(p.upgradeLevels)}`);
      seen[id][gate(p, id) ? 'yes' : 'no']++;
    }
  }
  for (const id of EVOLUTION_IDS) assert.ok(seen[id].yes > 0 && seen[id].no > 0, `${id} was exercised both ways (${JSON.stringify(seen[id])})`);
});

test('a card that moves a recipe forward shows it on the card; one that completes it says COMPLETES', () => {
  const p = freshPlayer();
  acquireWeapon(p, 'missiles');
  // Tesla Arc completes Storm Protocol (missiles ✓) and starts EMP Grenades.
  const pick = describeWeaponPick(p, 'lightning');
  const storm = pick.recipes.find((v) => v.id === 'evo_tempest');
  assert.ok(storm?.ready, 'Tesla Arc completes Storm Protocol');
  assert.deepEqual(storm.parts.map((x) => [x.label, !!x.met, x.adds]), [['Missiles', true, false], ['Tesla Arc', false, true]]);
  assert.ok(pick.recipes.some((v) => v.id === 'evo_emp' && !v.ready));
  assert.equal(pick.recipes[0].id, 'evo_tempest', 'the most complete recipe leads');
  const html = renderUpgradeCard(pick, '[1]').html;
  assert.match(html, /⚗ COMPLETES STORM PROTOCOL/);
  assert.match(html, /recipe-chip ok">Missiles ✓/);
  assert.match(html, /recipe-chip adds">Tesla Arc ★/);

  // Prism Split at rank 0, +1: progress toward Pulsar Helix (needs rank 2).
  const prism = describeUpgrade(p, { ...UPGRADE_BY_ID.multishot, levelJump: 1 });
  const pulsar = prism.recipes.find((v) => v.id === 'evo_pulsar');
  assert.ok(pulsar && !pulsar.ready);
  assert.match(recipeStripHtml([pulsar]), /⚗ TOWARD PULSAR HELIX/);
  // +2 at once completes it.
  assert.ok(describeUpgrade(p, { ...UPGRADE_BY_ID.multishot, levelJump: 2 }).recipes.find((v) => v.id === 'evo_pulsar').ready);
});

test('cards with nothing to do with an evolution show no recipe; an owned evolution drops off', () => {
  const p = freshPlayer();
  assert.deepEqual(describeUpgrade(p, { ...UPGRADE_BY_ID.magnet, levelJump: 1 }).recipes, []);
  install(p, 'multishot', 2);
  assert.ok(readyEvolutions(p).includes('evo_pulsar'));
  install(p, 'evo_pulsar');
  assert.ok(!readyEvolutions(p).includes('evo_pulsar'));
  assert.ok(!describeUpgrade(p, { ...UPGRADE_BY_ID.firerate, levelJump: 2 }).recipes.some((v) => v.id === 'evo_pulsar'));
});

test('an evolution card shows its own recipe, all checked', () => {
  const p = freshPlayer();
  install(p, 'firerate', 2);
  const d = describeUpgrade(p, UPGRADE_BY_ID.evo_pulsar);
  assert.equal(d.recipes.length, 1);
  assert.ok(d.recipes[0].parts.every((x) => x.met));
  assert.match(renderUpgradeCard(d, '[1]').html, /⚗ RECIPE/);
});

test('Field Guide evolutions list their recipe, with ✓ / ✗ during a run', () => {
  const plain = upgradesHTML();
  for (const id of EVOLUTION_IDS) assert.ok(plain.includes(`data-entry="${id}"`));
  assert.match(plain, /UNLOCKS WITH[\s\S]*recipe-chip plain">Missiles</);
  const p = freshPlayer();
  acquireWeapon(p, 'missiles');
  const live = upgradesHTML(p.upgradeLevels, p);
  assert.match(live, /recipe-chip ok">Missiles ✓/);
  assert.match(live, /recipe-chip miss">Tesla Arc ✗/);
  assert.equal(recipeView('evo_tempest', null).parts[0].met, null);
  assert.ok(UPGRADE_POOL.length > 0);
});

test('a rank ingredient still short of its target shows how far along it is', () => {
  const p = freshPlayer();
  acquireWeapon(p, 'rockets');
  // Deadeye at 0, +1 → 1 of 2: shown as LV 1/2 ✗ on the card.
  const d = describeUpgrade(p, { ...UPGRADE_BY_ID.crit_chance, levelJump: 1 });
  const sc = d.recipes.find((v) => v.id === 'evo_supercrit');
  assert.equal(sc.parts[0].label, 'Deadeye LV 1/2');
  assert.match(recipeStripHtml([sc]), /recipe-chip miss">Deadeye LV 1\/2 ✗/);
  assert.equal(recipeView('evo_supercrit', null).parts[0].label, 'Deadeye LV 2');
});
