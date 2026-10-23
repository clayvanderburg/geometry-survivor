import test from 'node:test';
import assert from 'node:assert/strict';

// Scope chips and pills on global, tag, crit and STATUS cards (upgrade-cards.js cardReach): the pills are
// exactly the carried weapons the card changes, and "ALL WEAPONS" only shows when that is every weapon
// carried. Clay (v0.46): Tempo Core said ALL WEAPONS with one pill on a five-weapon run.
const h = await import('../tools/balance/harness.mjs');
const U = await import('../js/upgrades.js');
const { describeUpgrade } = await import('../js/upgrade-cards.js');
const { rowWeapon } = await import('../js/weapon-pills.js');
const { weaponBuild, weaponElement } = await import('../js/weapon-levels.js');
const { POTENTIAL_DPS } = await import('../js/weapon-scaling.js');

const LOADOUTS = [
  ['missiles', 'rockets', 'singularity', 'shockfield', 'mines'], // Clay's run
  ['blaster', 'orbitals', 'turret', 'nanites', 'flamethrower'],
  ['raillance', 'glaive', 'gas', 'quake', 'harpoon'],
  ['lightning', 'drones', 'grenades', 'cryospray', 'acidspray'],
  ['blaster', 'orbitals']
];

function player(weapons) {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  if (!weapons.includes('blaster')) U.discardWeapon(p, 'blaster');
  for (const w of weapons) U.acquireWeapon(p, w);
  if (weapons.includes('rockets')) U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID.rockets_fire, levelJump: 1 });
  return p;
}
const sorted = (a) => [...a].sort();
// Every weapon's potential DPS with one more rank of `id` installed, against without.
function dpsChanged(p, id) {
  const q = structuredClone(p);
  U.applyUpgradeLevels(q, { ...U.UPGRADE_BY_ID[id], levelJump: 1 });
  return p.loadout.filter((w) => Math.abs(POTENTIAL_DPS[w](weaponBuild(q, w)) / POTENTIAL_DPS[w](weaponBuild(p, w)) - 1) > 1e-9);
}

test('scope chips: ALL WEAPONS only when the card reaches every weapon carried; pills in loadout order', () => {
  let chips = 0;
  for (const weapons of LOADOUTS) {
    const p = player(weapons);
    for (const u of U.UPGRADE_POOL) {
      const d = describeUpgrade(p, { ...u, levelJump: 1 }, 99);
      if (!d.reach) continue;
      chips++;
      const where = `${u.id} on ${p.loadout.join('+')}`;
      assert.deepEqual(d.reach.ids, p.loadout.filter((w) => d.reach.ids.includes(w)), `${where}: pills are carried weapons, in loadout order`);
      if (d.reach.label === 'ALL WEAPONS') assert.deepEqual(d.reach.ids, p.loadout, `${where}: ALL WEAPONS but not every weapon`);
    }
  }
  assert.ok(chips > 60, `${chips} chips checked`);
});

test('Tempo and Cooldown pills are exactly the weapons whose damage output changes', () => {
  for (const weapons of LOADOUTS) {
    const p = player(weapons);
    for (const id of ['tempo_core', 'cooldown_matrix']) {
      const d = describeUpgrade(p, { ...U.UPGRADE_BY_ID[id], levelJump: 1 }, 99);
      assert.deepEqual(sorted(d.reach.ids), sorted(dpsChanged(p, id)), `${id} on ${p.loadout.join('+')}`);
    }
  }
});

test('Clay\'s run: Tempo Core pills every weapon and says ALL WEAPONS; Cooldown Matrix pills none of them', () => {
  const p = player(LOADOUTS[0]);
  const tempo = describeUpgrade(p, { ...U.UPGRADE_BY_ID.tempo_core, levelJump: 1 }, 99);
  assert.equal(tempo.reach.label, 'ALL WEAPONS');
  assert.deepEqual(tempo.reach.ids, p.loadout);
  const cd = describeUpgrade(p, { ...U.UPGRADE_BY_ID.cooldown_matrix, levelJump: 1 }, 99);
  assert.deepEqual(cd.reach.ids, []);
  assert.deepEqual(cd.rows.map((r) => r.id), ['dashCooldown', 'global_cooldown'], 'the dash only');
  // Orbit Blades have no attack timer: with them carried Tempo no longer claims ALL WEAPONS.
  const orb = describeUpgrade(player(['blaster', 'orbitals']), { ...U.UPGRADE_BY_ID.tempo_core, levelJump: 1 }, 99);
  assert.equal(orb.reach.label, 'EVERY TIMED WEAPON');
  assert.deepEqual(orb.reach.ids, ['blaster']);
});

// Persistence too: an armed mine that lasts longer adds no potential DPS, but its row changes.
test('Persistence, Velocity, Field Amplifier and tag card pills are exactly the weapons with a changed stat row', () => {
  for (const weapons of LOADOUTS) {
    const p = player(weapons);
    for (const u of U.UPGRADE_POOL.filter((x) => ['persistence', 'velocity', 'area'].includes(x.globalCard) || (x.category === 'SPECIALIST' && x.tags?.length))) {
      if (!U.eligibleUpgrades(p).some((x) => x.id === u.id)) continue;
      const d = describeUpgrade(p, { ...u, levelJump: 1 }, 99);
      const rows = new Set(d.rows.map((r) => rowWeapon(r.id)).filter(Boolean));
      assert.deepEqual(sorted(d.reach.ids), sorted(rows), `${u.id} on ${p.loadout.join('+')}`);
    }
  }
});

test('STATUS card pills are the carried weapons with a matching element', () => {
  for (const weapons of LOADOUTS) {
    const p = player(weapons);
    for (const u of U.UPGRADE_POOL.filter((x) => x.statusCard)) {
      const d = describeUpgrade(p, { ...u, levelJump: 1 }, 99);
      for (const w of d.reach.ids) assert.ok(weaponElement(p, w), `${u.id}: ${w} carries an element`);
      assert.ok(d.reach.ids.length < p.loadout.length || p.loadout.every((w) => weaponElement(p, w)), `${u.id} on ${p.loadout.join('+')}`);
    }
  }
});

// Clay (v0.46): Tungsten Penetrators said EVERY KINETIC WEAPON with no pill at all on a run whose only KINETIC
// source was the Volatile Shatter passive. Non-weapon sources (loadout.js SHIP_SOURCES) get their own pills.
const { TUNING } = await import('../js/config.js');
const { SHIP_SOURCES } = await import('../js/loadout.js');
const { renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { WEAPON_TAGS } = await import('../js/weapon-scaling.js');
function withSources(weapons) {
  const p = player(weapons);
  U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID.shrapnel, levelJump: 1 });
  p.weapons.tectonicBore = 1;
  p.weapons.dashNova = 1;
  return p;
}

test('a tag or Field Amplifier card in the hand always has a pill: a carried weapon or a passive / evolution source', () => {
  const offered = new Set();
  for (const weapons of [...LOADOUTS, ['singularity']]) {
    for (const p of [player(weapons), withSources(weapons)]) {
      for (const u of U.eligibleUpgrades(p).filter((x) => x.category === 'SPECIALIST' || x.globalCard === 'area')) {
        offered.add(u.id);
        const d = describeUpgrade(p, { ...u, levelJump: 1 }, 99);
        const where = `${u.id} on ${p.loadout.join('+')}`;
        assert.ok(d.reach.ids.length + d.reach.sources.length > 0, `${where}: offered with an empty pill row`);
        const tag = u.globalCard === 'area' ? 'area' : u.tags[0];
        for (const s of d.reach.sources) assert.ok(s.owned(p) && WEAPON_TAGS[s.source].includes(tag), `${where}: ${s.name}`);
        if (d.reach.sources.length) assert.match(renderUpgradeCard(d, '[1]').html, /wpn-pill source-pill/);
      }
    }
  }
  assert.deepEqual([...offered].sort(), ['tag_area', 'tag_electric', 'tag_explosive', 'tag_kinetic']);
  assert.ok(SHIP_SOURCES.every((s) => WEAPON_TAGS[s.source]), 'sources are real tag keys');
});

test('Clay\'s run + Volatile Shatter: Tungsten Penetrators pills the passive, says what it boosts, and turns up less', () => {
  const p = player(LOADOUTS[0]);
  U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID.shrapnel, levelJump: 1 });
  const card = { ...U.UPGRADE_BY_ID.tag_kinetic, levelJump: 1 };
  const d = describeUpgrade(p, card, 99);
  assert.deepEqual(d.reach.ids, []);
  assert.deepEqual(d.reach.sources.map((s) => s.name), ['Volatile Shatter']);
  assert.match(d.headline, /KINETIC DAMAGE/);
  assert.equal(d.summary, 'Boosts your Volatile Shatter shards (and any KINETIC weapon you pick up later).');
  assert.match(renderUpgradeCard(d, '[1]').html, /EVERY KINETIC WEAPON<\/span><span class="wpn-pill source-pill" style="--wc:#d6dde8">Volatile Shatter<\/span>/);
  // Weight: TUNING.tagSourceOnlyWeight of a tag card's usual weight until a carried weapon has the tag.
  const usual = TUNING.tagCardWeight;
  assert.ok(Math.abs(U.cardWeight(card, 1, p) - usual * TUNING.tagSourceOnlyWeight) < 1e-9);
  assert.ok(TUNING.tagSourceOnlyWeight < 1);
  const kinetic = player(['blaster']);
  U.applyUpgradeLevels(kinetic, { ...U.UPGRADE_BY_ID.shrapnel, levelJump: 1 });
  assert.equal(U.cardWeight(card, 1, kinetic), usual, 'a KINETIC weapon: the usual weight');
  const both = describeUpgrade(kinetic, card, 99);
  assert.deepEqual([both.reach.ids, both.reach.sources.map((s) => s.id)], [['blaster'], ['shrapnel']]);
  assert.equal(both.summary, U.UPGRADE_BY_ID.tag_kinetic.summary, 'the usual summary once a weapon has the tag');
});
