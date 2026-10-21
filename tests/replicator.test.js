import test from 'node:test';
import assert from 'node:assert/strict';

// REPLICATOR ARRAY (global card, v0.45): +1 rank to the count stat of every equipped weapon that has one,
// outside the weapon level, at least RARE, never a multi-rank jump, rare in hands, capped per weapon.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const { TUNING } = await import('../js/config.js');
const U = await import('../js/upgrades.js');
const {
  STAT_CARDS, POWER_STATS, COUNT_STATS, REPLICATOR_ID, REPLICATOR_MAX_RANKS, weaponBuild, countRoom
} = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
const { WEAPON_BY_ID, weaponLevel } = await import('../js/loadout.js');
const { describeUpgrade, renderUpgradeCard, cardScope, weaponPotentialDps } = await import('../js/upgrade-cards.js');

const CARD = U.UPGRADE_BY_ID[REPLICATOR_ID];
const install = (p, upg, levelJump = 1) => U.applyUpgradeLevels(p, { ...upg, levelJump });
function player(weapons) {
  const p = U.runStartPlayer();
  Object.assign(p, { upgradeLevels: {}, weapons: {}, loadout: [], breakthroughs: {}, level: 1 });
  for (const id of weapons) install(p, U.UPGRADE_BY_ID[WEAPON_BY_ID[id].levelId]);
  return p;
}
const replicate = (p, ranks = 1) => install(p, CARD, ranks);

// The auditable table: weapon -> [stat, its count card, cap, what one rank adds on the card headline].
const TABLE = {
  blaster: ['prism', 'multishot', 5, '+2 STREAMS'],
  rockets: ['count', 'rockets_count', 6, '+1 ROCKET'],
  missiles: ['salvo', 'missiles_salvo', 8, '+1 MISSILE'],
  lightning: ['chain', 'lightning_chain', 6, '+2 ARC JUMPS'],
  orbitals: ['count', 'orbitals_count', 6, '+1 BLADE'],
  mines: ['capacity', 'mines_capacity', 8, '+1 MINE'],
  turret: ['charges', null, 2, '+1 TURRET'],
  drones: ['wingmen', 'drones_wingmen', 2, '+1 DRONE'],
  grenades: ['count', 'grenades_count', 5, '+1 GRENADE'],
  flamethrower: ['nozzles', 'flamethrower_nozzles', 3, '+1 NOZZLE'],
  cryospray: ['nozzles', 'cryospray_nozzles', 3, '+1 NOZZLE'],
  acidspray: ['nozzles', 'acidspray_nozzles', 3, '+1 NOZZLE'],
  raillance: ['count', 'raillance_count', 3, '+1 LANCE'],
  glaive: ['count', 'glaive_count', 4, '+1 DISC'],
  quake: ['count', 'quake_count', 4, '+1 CHARGE']
};
const NOT_ELIGIBLE = ['singularity', 'gas', 'shockfield', 'nanites', 'harpoon'];
// What the weapon's count formula reads, so the build bonus really reaches the weapon.
const COUNT_OF = {
  blaster: (b) => W.blasterExtraStreams(b), rockets: W.wingRocketCount, missiles: W.missileSalvo, lightning: W.lightningJumps,
  orbitals: W.orbitalBlades, mines: W.mineMaxActive, turret: W.turretCharges, drones: W.droneCount, grenades: W.grenadeCount,
  flamethrower: W.flameNozzles, cryospray: W.flameNozzles, acidspray: W.flameNozzles, raillance: W.railLances, glaive: W.glaiveCount, quake: W.quakeShells
};

test('Replicator Array: the eligibility table maps every weapon with a count stat, and only those', () => {
  assert.deepEqual(Object.keys(COUNT_STATS).sort(), Object.keys(TABLE).sort());
  assert.deepEqual([...Object.keys(TABLE), ...NOT_ELIGIBLE].sort(), Object.keys(STAT_CARDS).sort(), 'every weapon is either eligible or listed as not');
  for (const [id, [stat, card, cap]] of Object.entries(TABLE)) {
    const cs = COUNT_STATS[id];
    assert.equal(cs.stat, stat, id);
    assert.equal(cs.card, card, id);
    assert.equal(cs.cap, cap, id);
    if (card) {
      const sc = STAT_CARDS[id].find((c) => c.id === card);
      assert.equal(sc.stat, stat, `${id}: the card raises the mapped stat`);
      assert.equal(sc.maxLevel, cap, `${id}: the cap is the card's own`);
      assert.ok(POWER_STATS.has(stat) || stat === 'capacity', `${id}: ${stat} is a count stat`);
    }
  }
  for (const id of NOT_ELIGIBLE) assert.ok(!COUNT_STATS[id], id);
});

test('Replicator Array: one rank adds one count rank to every equipped eligible weapon (each formula reads it)', () => {
  for (const [id, [stat, , , text]] of Object.entries(TABLE)) {
    const p = player(id === 'blaster' ? ['blaster'] : ['blaster', id]);
    const before = COUNT_OF[id](weaponBuild(p, id));
    replicate(p);
    assert.equal(weaponBuild(p, id).r[stat], 1, id);
    assert.equal(COUNT_OF[id](weaponBuild(p, id)), before + COUNT_STATS[id].per, `${id} count`);
    assert.match(describeUpgrade(player(id === 'blaster' ? ['blaster'] : ['blaster', id]), CARD).headline, new RegExp(text.replace('+', '\\+')), id);
  }
  for (const id of NOT_ELIGIBLE) {
    const p = player([id]);
    U.discardWeapon(p, 'blaster');
    assert.ok(!U.eligibleUpgrades(p).some((u) => u.id === REPLICATOR_ID), `${id} alone cannot take it`);
  }
});

test('Replicator Array: respects each count cap, and the count card shares its room', () => {
  const p = player(['blaster', 'drones', 'raillance']);
  install(p, U.UPGRADE_BY_ID.drones_wingmen, 2); // drones at their cap
  install(p, U.UPGRADE_BY_ID.raillance_count, 2); // one lance rank left
  replicate(p, 2);
  assert.equal(weaponBuild(p, 'drones').r.wingmen, 2, 'a capped weapon gets nothing');
  assert.equal(weaponBuild(p, 'raillance').r.count, 3, 'only what fits under the cap');
  assert.equal(weaponBuild(p, 'blaster').r.prism, 2);
  // Prism Split now has 5 - 2 ranks of room left; a +5 roll installs 3.
  assert.equal(U.levelRoom(p, U.UPGRADE_BY_ID.multishot), 3);
  install(p, U.UPGRADE_BY_ID.multishot, 5);
  assert.equal(p.upgradeLevels.multishot, 3);
  assert.equal(weaponBuild(p, 'blaster').r.prism, 5);
  assert.equal(countRoom(p, 'blaster'), 0);
  // Eligibility: offered only while some equipped weapon can take a count rank.
  const q = player(['blaster', 'drones']);
  install(q, U.UPGRADE_BY_ID.drones_wingmen, 2);
  install(q, U.UPGRADE_BY_ID.multishot, 5);
  assert.ok(!U.eligibleUpgrades(q).some((u) => u.id === REPLICATOR_ID), 'every equipped weapon is at its cap');
  assert.ok(U.eligibleUpgrades(player(['blaster'])).some((u) => u.id === REPLICATOR_ID));
});

test('Replicator Array: never raises a weapon level, so Breakthrough timing stays put', () => {
  const p = player(['blaster', 'rockets', 'turret']);
  install(p, U.UPGRADE_BY_ID.rockets_damage, 4); // rockets LV 5, one card short of the LV 6 Breakthrough
  const levels = () => ['blaster', 'rockets', 'turret'].map((id) => weaponLevel(p, id));
  const before = levels();
  replicate(p, 2);
  assert.deepEqual(levels(), before);
  assert.deepEqual(U.pendingBreakthroughs(p, 'rockets'), []);
  const d = describeUpgrade(player(['blaster']), CARD);
  assert.equal(d.weapon, null);
  assert.equal(d.maxLevel, REPLICATOR_MAX_RANKS);
});

test('Replicator Array: card preview lists each weapon\'s gain, rows read the new counts, GLOBAL scope', () => {
  const p = player(['blaster', 'drones', 'turret', 'flamethrower', 'glaive', 'gas']);
  const d = describeUpgrade(p, CARD);
  assert.equal(d.headline, '+2 STREAMS · +1 DRONE · +1 TURRET · +1 NOZZLE · +1 DISC');
  assert.deepEqual(d.rows.map((r) => r.id), ['bulletCount', 'prismLayout', 'turretCharges', 'droneCount', 'flameNozzles', 'glaiveCount']);
  assert.deepEqual(d.rows.find((r) => r.id === 'turretCharges'), { id: 'turretCharges', label: 'Turret charges', before: '2', after: '3' });
  assert.equal(cardScope(CARD), 'global');
  const card = renderUpgradeCard(d, '[1]');
  assert.match(card.className, /\bscope-global\b/);
  assert.match(card.className, /\brarity-rare\b/);
  assert.ok(!card.html.includes('upg-jump-ribbon'), 'no +N LEVELS ribbon: it is one rank');
  // Preview never touches the player.
  assert.equal(p.upgradeLevels[REPLICATOR_ID], undefined);
  // The run overview's per-weapon potential DPS reads the bonus through weaponBuild.
  const q = player(['blaster', 'drones']);
  const dps = weaponPotentialDps(q, 'drones');
  replicate(q);
  assert.ok(Math.abs(weaponPotentialDps(q, 'drones') / dps - 2) < 1e-9, 'one drone -> two drones doubles their potential');
});

test('Replicator Array: always at least RARE, one rank at a time, rare in hands, no OVERCHARGE', () => {
  assert.equal(U.rarityFor(CARD, 1), 'rare');
  assert.equal(U.rarityFor(CARD, 4), 'epic', 'the floor never lowers a tier');
  assert.equal(U.cardWeight(CARD), TUNING.replicatorWeight);
  assert.ok(TUNING.replicatorWeight > 0 && TUNING.replicatorWeight < TUNING.statusCardWeight, 'rarer than a STATUS card');
  assert.ok(REPLICATOR_MAX_RANKS >= 2 && REPLICATOR_MAX_RANKS <= 3);
  // Even with absurd luck every roll is +1.
  const p = player(['blaster', 'rockets']);
  p.stats.luck = 1000;
  const real = Math.random;
  try {
    Math.random = () => 0.0001; // every jump roll is a legendary +5
    for (let i = 0; i < 20; i++) {
      const hand = U.rollUpgrades(p, 200);
      const c = hand.find((u) => u.id === REPLICATOR_ID);
      if (c) assert.equal(c.levelJump, 1);
      assert.ok(hand.some((u) => u.id !== REPLICATOR_ID && u.levelJump === 5), 'other cards do roll +5');
    }
  } finally {
    Math.random = real;
  }
  // Once every weapon is LV 18 it does not come back past its max like other general cards.
  const q = player(['rockets']);
  U.discardWeapon(q, 'blaster');
  install(q, U.UPGRADE_BY_ID.rockets_damage, 11);
  install(q, U.UPGRADE_BY_ID.rockets_reload, 6);
  assert.ok(U.overchargeReady(q));
  replicate(q, 2);
  assert.equal(U.levelRoom(q, CARD), 0);
});

// Potential DPS of a loadout at weapon LV 6 (Damage and fire-rate cards, no count cards: the worst case,
// where one more of everything is the biggest relative jump) and with 2 count ranks at LV 12 (a typical
// mixed build). The realized card-bench numbers are in the v0.45 PR; these pin the model.
function loadoutDps(ids, lv, countRanks, ranks) {
  const p = player(ids.includes('blaster') ? ids : ['blaster', ...ids]);
  if (!ids.includes('blaster')) U.discardWeapon(p, 'blaster');
  for (const id of ids) {
    const cards = STAT_CARDS[id];
    const cs = COUNT_STATS[id];
    const cr = cs?.card ? Math.min(countRanks, cs.cap - 1) : 0;
    if (cr) install(p, U.UPGRADE_BY_ID[cs.card], cr);
    const n = lv - 1 - cr;
    install(p, U.UPGRADE_BY_ID[cards.find((c) => c.stat === 'damage').id], Math.ceil(n / 2));
    install(p, U.UPGRADE_BY_ID[cards.find((c) => ['rate', 'reload', 'recharge', 'cooldown'].includes(c.stat)).id], Math.floor(n / 2));
  }
  if (ranks) replicate(p, ranks);
  return ids.reduce((a, id) => a + (weaponPotentialDps(p, id) || 0), 0);
}
const LOADOUTS = {
  2: ['blaster', 'rockets'],
  4: ['blaster', 'rockets', 'drones', 'glaive'],
  6: ['blaster', 'rockets', 'drones', 'glaive', 'grenades', 'flamethrower']
};

test('Replicator Array: total potential DPS gain with 2, 4 and 6 weapons stays within its rare-card budget', () => {
  for (const [n, ids] of Object.entries(LOADOUTS)) {
    const worst = loadoutDps(ids, 6, 0, 0);
    const typical = loadoutDps(ids, 12, 2, 0);
    const w1 = loadoutDps(ids, 6, 0, 1) / worst, w2 = loadoutDps(ids, 6, 0, 2) / worst;
    const t1 = loadoutDps(ids, 12, 2, 1) / typical, t2 = loadoutDps(ids, 12, 2, 2) / typical;
    // Worst case (no count cards yet): each rank under +90%, both together at most x2.7.
    assert.ok(w1 > 1.5 && w1 < 1.9, `${n} weapons LV 6, 1 rank: x${w1.toFixed(2)}`);
    assert.ok(w2 < 2.7, `${n} weapons LV 6, 2 ranks: x${w2.toFixed(2)}`);
    // Typical build: +25-40% for the first rank, at most +65% for both.
    assert.ok(t1 > 1.25 && t1 < 1.4, `${n} weapons LV 12, 1 rank: x${t1.toFixed(2)}`);
    assert.ok(t2 < 1.65, `${n} weapons LV 12, 2 ranks: x${t2.toFixed(2)}`);
  }
});
