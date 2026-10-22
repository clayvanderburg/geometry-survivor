import test from 'node:test';
import assert from 'node:assert/strict';

// No card rank does nothing. A UTILITY stat whose formula tops out (pierce keep, element rank)
// has its card capped where it tops out, and ACROSS THE BOARD's free ranks count toward that cap
// (weapon-levels.js sharedCap, upgrades.js levelRoom).
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, levelRoom, acquireWeapon, applyBreakthrough } = await import('../js/upgrades.js');
const { STAT_CARD_LIST, STAT_CARDS, makeBuild, flameBurnRank, ELEMENT_MAX_RANKS, BREAKTHROUGH_LEVELS } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
const { HOSTILE_INFO, hostileKindStats, MITOSIS } = await import('../js/hostiles.js');
const { ARCHETYPE_INFO } = await import('../js/archetypes.js');

const capped = STAT_CARD_LIST.filter((c) => c.boostCapped);
const card = (id) => STAT_CARD_LIST.find((c) => c.id === id);

test('the capped utility cards are exactly the ones whose formula tops out', () => {
  assert.deepEqual(capped.map((c) => c.id).sort(), [
    'acidspray_etch', 'cryospray_chill', 'flamethrower_burn', 'harpoon_pierce', 'raillance_pierce', 'shockfield_stun'
  ]);
});

test('Hardened Threads tops out at 100% pierce keep exactly at its cap', () => {
  const max = card('harpoon_pierce').maxLevel;
  const keep = (r) => W.harpoonPierceKeep(makeBuild('harpoon', 18, { pierce: r }));
  assert.equal(keep(max), 1);
  assert.ok(keep(max - 1) < 1);
});

test('Penetrator Core tops out at 100% pierce keep exactly at its cap', () => {
  const max = card('raillance_pierce').maxLevel;
  const keep = (r) => W.railKeep(makeBuild('raillance', 18, { pierce: r }));
  assert.equal(keep(max), 1);
  assert.ok(keep(max - 1) < 1);
});

test('the sprayer and Shock Field element cards top out at the element rank cap', () => {
  for (const id of ['flamethrower_burn', 'cryospray_chill', 'acidspray_etch', 'shockfield_stun']) {
    const c = card(id);
    assert.equal(1 + c.maxLevel, ELEMENT_MAX_RANKS, `${id}: 1 + its cap = the element rank cap`);
    const rank = (r) => flameBurnRank({ r: { [c.stat === 'stun' ? 'burn' : c.stat]: r } });
    assert.equal(rank(c.maxLevel), ELEMENT_MAX_RANKS);
    assert.ok(rank(c.maxLevel - 1) < ELEMENT_MAX_RANKS);
  }
});

test('Across the Board ranks shrink a capped card\'s room; uncapped cards keep theirs', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  acquireWeapon(p, 'harpoon');
  const grapple = UPGRADE_BY_ID.harpoon_pierce;
  const drill = UPGRADE_BY_ID.harpoon_drill;
  const before = { grapple: levelRoom(p, grapple), drill: levelRoom(p, drill) };
  assert.equal(before.grapple, card('harpoon_pierce').maxLevel);
  applyBreakthrough(p, 'harpoon', BREAKTHROUGH_LEVELS[0], 'boost');
  assert.equal(levelRoom(p, grapple), before.grapple - 1, 'one Across the Board takes one rank of room');
  assert.equal(levelRoom(p, drill), before.drill, 'an uncapped utility card keeps its room');
  applyBreakthrough(p, 'harpoon', BREAKTHROUGH_LEVELS[1], 'boost');
  applyBreakthrough(p, 'harpoon', BREAKTHROUGH_LEVELS[2], 'boost');
  assert.equal(levelRoom(p, grapple), before.grapple - 3, 'three Across the Boards take three ranks of Hardened Threads');
});

test('every capped card is still reachable: a weapon can hit LV 18 without it', () => {
  for (const c of capped) {
    const others = STAT_CARDS[c.weapon].filter((x) => x.id !== c.id).reduce((a, x) => a + x.maxLevel, 0);
    assert.ok(others >= 17, `${c.weapon}: LV 18 without ${c.id}`);
  }
});
