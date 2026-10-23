import test from 'node:test';
import assert from 'node:assert/strict';

// Card text that quotes a number must quote the number the code uses: Breakthrough summaries, the
// Across the Board line and the Field Guide's Breakthrough rule. Tag cards name the chip they boost instead
// of listing weapons, so new weapons can't make them stale. (Upgrade-pool summaries stay number-free:
// tests/upgrade-cards.test.js.)
await import('../tools/balance/harness.mjs'); // browser globals for the game modules
const { TRANSFORMS, BT_TRANSFORM_DPS, BT_BOOST_DPS, BT_BOOST_RANKS, boostSummary } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W, WEAPON_TAGS, TAG_INFO } = await import('../js/weapon-scaling.js');
const { UPGRADE_POOL } = await import('../js/upgrades.js');
const { MECHANIC_ENTRIES } = await import('../js/field-guide.js');
const { WEAPON_BY_ID } = await import('../js/loadout.js');

const WORDS = { two: 2, three: 3, four: 4, twice: 2, second: 2, third: 3, fourth: 4 };
const num = (s) => WORDS[s.toLowerCase()] ?? Number(s);

// [weapon, milestone, pattern whose first group is the number, the constant it must equal]
const QUOTED = [
  ['blaster', 18, /into (\d+) nearby enemies/, W.arcRoundJumps],
  ['rockets', 18, /splits into (\w+) mini-rockets/, W.mirvSplit],
  ['missiles', 6, /throws (\w+) bomblets/, W.clusterBomblets],
  ['missiles', 18, /Every (\w+) Swarm Missile salvo/, W.nukeEvery],
  ['lightning', 6, /(\w+) chains leap out/, W.lightningChains({ t4: true })],
  ['singularity', 18, /spit out (\w+) mini-singularities/, W.cascadeMinis],
  ['mines', 6, /scatter (\w+) bomblets/, W.mineClusterBomblets],
  ['mines', 18, /triangles of (\w+)/, W.triadCount],
  ['mines', 18, /(\w+) times as many mines/, W.triadCount],
  ['turret', 18, /fire (\w+) as fast/, W.overloadRate],
  ['shockfield', 6, /the (\d+) nearest enemies/, W.lashArcs],
  ['raillance', 18, /Every (\w+) Rail Lance shot/, W.overloadEvery],
  ['raillance', 18, /a beam (\w+) times as wide/, W.overloadWidth],
  ['raillance', 18, /hits (\w+) as hard/, W.overloadMult],
  ['nanites', 6, /Every few kills/, null],
  ['harpoon', 18, /up to (\d+) more enemies/, W.chainLeaps],
  ['quake', 6, /to the next pack (\w+)/, W.skipBounces],
  ['quake', 12, /tears (\w+) seams/, W.faultCount],
  ['quake', 18, /Every (\w+) Graviton Mortar volley/, W.epicenterEvery]
];

test('numbers quoted in Breakthrough summaries match the constants the weapons use', () => {
  for (const [weapon, m, re, value] of QUOTED) {
    const text = TRANSFORMS[weapon][m].summary;
    const hit = text.match(re);
    assert.ok(hit, `${weapon} LV ${m}: "${text}" should match ${re}`);
    if (value !== null) assert.equal(num(hit[1]), value, `${weapon} LV ${m}: "${hit[0]}"`);
  }
});

test('"about N% as strong / lighter" in Breakthrough summaries matches the transform rescale', () => {
  // A transform that splits its hits rescales each one by BT_TRANSFORM_DPS / (the number of hits).
  const near = (pct, share, label) => assert.ok(Math.abs(pct / 100 - share) <= 0.05, `${label}: says ${pct}%, code gives ${Math.round(share * 100)}%`);
  const pctIn = (text, re) => Number(text.match(re)?.[1]);
  near(pctIn(TRANSFORMS.lightning[6].summary, /about (\d+)% as strong/), BT_TRANSFORM_DPS / W.lightningChains({ t4: true }), 'Forked Chains');
  near(pctIn(TRANSFORMS.mines[18].summary, /about (\d+)% as strong/), BT_TRANSFORM_DPS / W.triadCount, 'Minefield Triad');
  near(100 - pctIn(TRANSFORMS.turret[18].summary, /about (\d+)% lighter/), BT_TRANSFORM_DPS / W.overloadRate, 'LMG Overload');
});

test('Across the Board text quotes its real damage boost and free ranks (card and Field Guide)', () => {
  const pct = `+${Math.round((BT_BOOST_DPS - 1) * 100)}% damage`;
  assert.ok(boostSummary('Autocannon').includes(pct));
  assert.ok(boostSummary('Autocannon').includes(`+${BT_BOOST_RANKS} rank in every UTILITY stat`));
  const guide = MECHANIC_ENTRIES.find((e) => e.id === 'weaponlevels').body().join(' ');
  assert.ok(guide.includes(pct), guide);
  assert.ok(guide.includes(`+${BT_BOOST_RANKS} rank in every UTILITY stat`), guide);
});

test('every tag card names the chip it boosts, so it covers every weapon showing that chip', () => {
  const tagCards = UPGRADE_POOL.filter((u) => u.category === 'SPECIALIST');
  assert.equal(tagCards.length, 3); // KINETIC, EXPLOSIVE, ELECTRIC; Field Amplifier (AREA) is a global card since #211
  for (const u of tagCards) {
    const [tag] = u.tags;
    assert.ok(u.summary.includes(`${TAG_INFO[tag].label} chip`), `${u.id}: "${u.summary}"`);
    // The chip a weapon shows is the union of its sources' tags, so naming the chip covers every weapon.
    assert.ok(Object.values(WEAPON_TAGS).some((tags) => tags.includes(tag)), `${u.id}: some weapon carries ${tag}`);
  }
});

test('weapon summaries describe how the weapon actually fires', () => {
  // The sprayers never aim: their nozzle spins round the ship.
  for (const id of ['flamethrower', 'cryospray', 'acidspray']) {
    assert.match(WEAPON_BY_ID[id].summary, /spins round the ship/, id);
    assert.doesNotMatch(WEAPON_BY_ID[id].summary, /where you aim/, id);
  }
});

test('RARE weapon cards (Phase Piercer, Extra Nozzle, Split Rails) stay strong but rarer, and say so on the card', async () => {
  // Clay (v0.46): swingy cards are balanced with rarity, not cut. They always show RARE (a +1 roll is not a jump,
  // so the ribbon reads "◆ RARE CARD · +1 LEVEL") and are drawn at RARE_CARD.weightMult of a stat card's share.
  const { RARE_CARD } = await import('../js/weapon-levels.js');
  const U = await import('../js/upgrades.js');
  const { describeUpgrade, renderUpgradeCard } = await import('../js/upgrade-cards.js');
  const h = await import('../tools/balance/harness.mjs');
  const g = h.createHeadlessGame();
  g.resetRun();
  for (const w of ['flamethrower', 'cryospray', 'acidspray']) U.acquireWeapon(g.player, w);
  U.acquireWeapon(g.player, 'raillance');
  for (const id of ['pierce', 'flamethrower_nozzles', 'cryospray_nozzles', 'acidspray_nozzles', 'raillance_count']) {
    const card = U.UPGRADE_BY_ID[id];
    assert.equal(U.rarityFor(card, 1), 'rare', `${id}: a +1 roll shows RARE`);
    const sibling = U.UPGRADE_POOL.find((u) => u.weapon === card.weapon && u.statCard && u.id !== id && !u.rarityFloor);
    assert.ok(Math.abs(U.cardWeight(card) / U.cardWeight(sibling) - RARE_CARD.weightMult) < 1e-9, `${id}: drawn at ${RARE_CARD.weightMult}x`);
    const html = renderUpgradeCard(describeUpgrade(g.player, { ...card, levelJump: 1 }), '[1]').html;
    assert.match(html, /◆ RARE CARD · \+1 LEVEL/, id);
  }
  for (const id of ['blaster_damage', 'firerate', 'flamethrower_damage', 'flamethrower_rate']) {
    assert.equal(U.UPGRADE_BY_ID[id].rarityFloor, undefined, `${id}: core Damage / Rate cards stay common`);
  }
});

test('Reactor Overdrive turns up a little less as the loadout grows (it out-realizes a weapon card with 6 weapons)', async () => {
  const U = await import('../js/upgrades.js');
  const h = await import('../tools/balance/harness.mjs');
  const g = h.createHeadlessGame();
  g.resetRun();
  const od = U.UPGRADE_BY_ID.overdrive;
  const w = () => U.cardWeight(od, 1, g.player);
  assert.equal(w(), 1, '1 weapon: a full share');
  for (const id of ['rockets', 'missiles']) U.acquireWeapon(g.player, id);
  assert.equal(w(), 1, '3 weapons: still a full share');
  for (const id of ['lightning', 'glaive', 'quake']) U.acquireWeapon(g.player, id);
  assert.ok(Math.abs(w() - 0.7) < 1e-9, '6 weapons: 0.7');
});
