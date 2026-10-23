import test from 'node:test';
import assert from 'node:assert/strict';

// Breakthrough pools (docs/BREAKTHROUGH_POOLS.md): each milestone draws 3 options from the weapon's pool,
// every option is worth its pinned potential DPS wherever it is taken, and saves keep working.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, applyBreakthrough } = await import('../js/upgrades.js');
const {
  STAT_CARDS, TRANSFORMS, BREAKTHROUGH_LEVELS, BT_FLATS, BT_TRANSFORM_DPS, BT_BOOST_DPS, BT_OVERTUNED_DPS, BT_HAND_SIZE, overtunedAt, overtunedRanks, OVERTUNED, POWER_STATS, weaponBuild,
  drawBreakthroughOptions, transformPool, makeBuild, btOption, EXTRA_TRANSFORMS
} = await import('../js/weapon-levels.js');
const { describeBreakthrough } = await import('../js/upgrade-cards.js');
const { POTENTIAL_DPS } = await import('../js/weapon-scaling.js');
const { PixieDirector } = await import('../js/pixie.js');

// Deterministic rng (mulberry32).
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const isFlat = (o) => !!BT_FLATS[o];
const WEAPONS = Object.keys(TRANSFORMS);

test('every weapon has a pool: transform ids unique per weapon, never clashing with a flat', () => {
  for (const id of WEAPONS) {
    const ids = transformPool(id).map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${id}: duplicate transform id`);
    assert.ok(ids.length >= BREAKTHROUGH_LEVELS.length, `${id}: a pool needs a transform per milestone`);
    for (const t of ids) assert.ok(!isFlat(t) && t !== 'transform', `${id}:${t} clashes with a reserved id`);
  }
});

test('a draw is 3 distinct options, at least 1 transform and 1 flat, and never a transform already taken', () => {
  const rng = seeded(7);
  for (const id of WEAPONS) {
    for (let i = 0; i < 200; i++) {
      // A random history: a random option at each earlier milestone.
      const bt = {};
      for (const m of BREAKTHROUGH_LEVELS) {
        const hand = drawBreakthroughOptions(id, m, bt, rng);
        assert.equal(hand.length, BT_HAND_SIZE, `${id} LV ${m}`);
        assert.equal(new Set(hand).size, hand.length, `${id} LV ${m}: duplicate ${hand}`);
        assert.ok(hand.some(isFlat) && hand.some((o) => !isFlat(o)), `${id} LV ${m}: ${hand}`);
        const taken = Object.values(bt).filter((o) => !isFlat(o));
        assert.ok(!hand.some((o) => taken.includes(o)), `${id} LV ${m}: ${hand} repeats ${taken}`);
        bt[m] = hand[Math.floor(rng() * hand.length)];
      }
    }
  }
});

test('LV 6 varies: every transform shows up at every milestone, its home milestone most often', () => {
  const rng = seeded(11);
  for (const id of WEAPONS) {
    for (const m of BREAKTHROUGH_LEVELS) {
      const seen = {};
      for (let i = 0; i < 600; i++) for (const o of drawBreakthroughOptions(id, m, {}, rng)) seen[o] = (seen[o] || 0) + 1;
      for (const t of transformPool(id)) assert.ok(seen[t.id] > 0, `${id} LV ${m}: ${t.id} never drawn`);
      for (const f of Object.keys(BT_FLATS)) assert.ok(seen[f] > 0, `${id} LV ${m}: ${f} never drawn`);
      const home = TRANSFORMS[id][m].id;
      for (const t of transformPool(id)) if (t.home !== m) assert.ok(seen[home] > seen[t.id], `${id} LV ${m}: ${home} should beat ${t.id}`);
    }
  }
});

test('the legacy "transform" value is the milestone\'s home transform; t4/t8/t12 follow the transform, not the milestone', () => {
  for (const id of WEAPONS) {
    const [a, b, c] = BREAKTHROUGH_LEVELS.map((m) => TRANSFORMS[id][m].id);
    assert.deepEqual(makeBuild(id, 18, {}, { 6: 'transform', 12: 'transform' }), makeBuild(id, 18, {}, { 6: a, 12: b }));
    // The LV 18 transform taken at LV 6, the LV 6 one at LV 18.
    const swapped = makeBuild(id, 18, {}, { 6: c, 18: a });
    assert.equal(swapped.t4, true);
    assert.equal(swapped.t8, false);
    assert.equal(swapped.t12, true);
    assert.equal(swapped.transforms, 2);
    const flats = makeBuild(id, 18, {}, { 6: 'boost', 12: 'overtuned', 18: 'overtuned' });
    assert.equal(flats.atb, 1);
    assert.equal(flats.ot, 2);
    assert.equal(flats.transforms, 0);
  }
  assert.equal(btOption('blaster', 12, 'transform').name, 'Ricochet Rounds');
  assert.equal(btOption('blaster', 6, 'overtuned').name, 'Overtuned Core');
});

function playerWith(id, lv) {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  if (id !== 'blaster') acquireWeapon(p, id);
  // Spread the levels over its cards so the build is a typical mix.
  const cards = STAT_CARDS[id];
  for (let i = 1; i < lv; i++) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[cards[i % cards.length].id], levelJump: 1 });
  p.breakthroughs = {};
  return p;
}

test('every option is worth its pinned potential DPS at every milestone: transforms x1.22, Overtuned Core its weapon\'s own damage and POWER ranks, Across the Board x1.08', () => {
  for (const id of WEAPONS) {
    for (const m of BREAKTHROUGH_LEVELS) {
      const p = playerWith(id, m);
      // Overtuned Core: its damage per hit times what its free POWER ranks add on this build.
      const b = weaponBuild(p, id);
      const otr = overtunedRanks(id);
      const rankGain = otr ? POTENTIAL_DPS[id]({ ...b, r: { ...b.r, [otr.stat]: b.r[otr.stat] + otr.ranks } }) / POTENTIAL_DPS[id](b) : 1;
      const want = (o) => (o === 'boost' ? BT_BOOST_DPS : o === 'overtuned' ? overtunedAt(id, m) * rankGain : BT_TRANSFORM_DPS) - 1;
      for (const o of [...transformPool(id).map((t) => t.id), ...Object.keys(BT_FLATS)]) {
        const d = describeBreakthrough(p, id, m, o);
        assert.ok(Math.abs(d.dpsGain - want(o)) < 0.01, `${id} LV ${m} ${o}: +${(d.dpsGain * 100).toFixed(1)}%`);
        assert.equal(d.id, `bt:${id}:${m}:${o}`);
        assert.equal(d.option, o);
      }
    }
  }
  assert.ok(BT_OVERTUNED_DPS - BT_BOOST_DPS >= 0.2, 'the two flats are a real trade-off: Across the Board is mostly utility, Overtuned Core is raw damage');
  assert.ok(BT_BOOST_DPS < BT_TRANSFORM_DPS && BT_TRANSFORM_DPS < BT_OVERTUNED_DPS);
});

test('applyBreakthrough takes any pool option once; a transform can\'t be installed twice', () => {
  const p = playerWith('rockets', 18);
  assert.equal(applyBreakthrough(p, 'rockets', 6, 'nope'), false);
  assert.equal(applyBreakthrough(p, 'rockets', 6, 'mirv'), true, 'the LV 18 transform at LV 6');
  assert.equal(applyBreakthrough(p, 'rockets', 12, 'mirv'), false, 'already installed');
  assert.equal(applyBreakthrough(p, 'rockets', 18, 'transform'), false, 'its home transform is installed already');
  assert.equal(applyBreakthrough(p, 'rockets', 12, 'overtuned'), true);
  assert.equal(applyBreakthrough(p, 'rockets', 18, 'overtuned'), true, 'flats stack');
  assert.deepEqual(p.breakthroughs.rockets, { 6: 'mirv', 12: 'overtuned', 18: 'overtuned' });
});

test('the live pick shows 3 pool cards; choosing one installs it, and Pixie reacts by option', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.blaster_damage, levelJump: 5 });
  p.breakthroughs = {};
  p.breakthroughsOffered = {};
  g.state = 'UPGRADE';
  g.closeUpgradeModal();
  assert.equal(g.handPhase, 'breakthrough');
  assert.equal(g.currentChoices.length, 3);
  const pick = g.currentChoices[2];
  g.selectUpgrade(2);
  assert.equal(p.breakthroughs.blaster[6], pick.option);

  const pixie = new PixieDirector({ rng: seeded(3) });
  assert.match(pixie.pickLine({ weaponId: 'rockets', level: 6, option: 'mirv' }).text, /MIRV/, 'a transform\'s own line plays at any milestone');
  assert.match(pixie.pickLine({ weaponId: 'rockets', level: 6, option: 'overtuned' }).text, /\S/);
  assert.match(pixie.pickLine({ weaponId: 'rockets', level: 18, kind: 'transform' }).text, /MIRV/, 'older callers still work');
});

test('a transform that builds on another never comes before it; notBefore keeps one at its home tier or later', () => {
  EXTRA_TRANSFORMS.rockets = [
    { id: 'test_follow', name: 'Test Follow-up', summary: 'Rocket Pod test.', home: 12, requires: ['tandem'] },
    { id: 'test_late', name: 'Test Late', summary: 'Rocket Pod test.', home: 18, notBefore: 18 }
  ];
  try {
    const rng = seeded(5);
    const seen = (m, bt) => {
      const out = new Set();
      for (let i = 0; i < 500; i++) for (const o of drawBreakthroughOptions('rockets', m, bt, rng)) out.add(o);
      return out;
    };
    assert.ok(!seen(6, {}).has('test_follow') && !seen(12, { 6: 'napalm' }).has('test_follow'), 'not before Tandem Warheads');
    assert.ok(seen(12, { 6: 'tandem' }).has('test_follow'), 'drawn once Tandem Warheads is in');
    assert.ok(!seen(6, {}).has('test_late') && !seen(12, {}).has('test_late') && seen(18, {}).has('test_late'));
    const p = playerWith('rockets', 18);
    assert.equal(applyBreakthrough(p, 'rockets', 6, 'test_follow'), false);
    assert.equal(applyBreakthrough(p, 'rockets', 6, 'tandem'), true);
    assert.equal(applyBreakthrough(p, 'rockets', 12, 'test_follow'), true);
    assert.equal(makeBuild('rockets', 18, {}, p.breakthroughs.rockets).tf.has('test_follow'), true);
  } finally {
    delete EXTRA_TRANSFORMS.rockets;
  }
});

test('Overtuned Core: each weapon\'s own version is damage and POWER ranks only, and the card says exactly what it gives', () => {
  for (const [id, o] of Object.entries(OVERTUNED)) {
    assert.ok(STAT_CARDS[id], `${id} is a weapon`);
    assert.equal(o.dmg.length, 3, id);
    for (const x of o.dmg) assert.ok(x >= 1 && x <= 2, `${id}: ${o.dmg}`);
    if (o.stat) {
      assert.ok(POWER_STATS.has(o.stat) && o.stat !== 'damage', `${id}: ${o.stat} is a POWER stat, never utility`);
      assert.ok(Number.isInteger(o.ranks) && o.ranks >= 1 && o.label, id);
      assert.ok(overtunedRanks(id), `${id} has a ${o.stat} card`);
    } else assert.ok(o.dmg.every((x) => x > 1), `${id}: damage only, so more damage`);
  }
  for (const id of WEAPONS) {
    const p = playerWith(id, 12);
    const before = { ...weaponBuild(p, id).r };
    const d = describeBreakthrough(p, id, 12, 'overtuned');
    const pct = Math.round((overtunedAt(id, 12) - 1) * 100);
    const otr = overtunedRanks(id);
    if (pct || !otr) {
      assert.match(d.headline, new RegExp(`\\+${pct}% DAMAGE`), id);
      assert.match(d.summary, new RegExp(`\\+${pct}% damage`), id);
    }
    if (otr) {
      assert.ok(d.headline.includes(`+${otr.ranks} ${OVERTUNED[id].label.toUpperCase()}`), `${id}: ${d.headline}`);
      assert.ok(d.summary.includes(`+${otr.ranks} ${otr.card.name}`), `${id}: ${d.summary}`);
    }
    applyBreakthrough(p, id, 12, 'overtuned');
    const after = weaponBuild(p, id).r;
    for (const [st, v] of Object.entries(after)) assert.equal(v - before[st], st === otr?.stat ? otr.ranks : 0, `${id}: ${st}`);
  }
});
