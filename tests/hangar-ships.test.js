import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 2: ship data and stat profiles (js/ships.js), merged into the run's start bonuses. Flag off:
// the crab's player is exactly what it was.
const h = await import('../tools/balance/harness.mjs');
const { SHIPS, SHIP_IDS, DEFAULT_SHIP, shipRunBonuses, shipStatChips, shipFixedKit, normalizeShip, isShip } = await import('../js/ships.js');
const { FEATS } = await import('../js/feats.js');
const { armoryBonuses } = await import('../js/progression.js');
const { runStartPlayer, acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_BY_ID, weaponSlots, freeSlots } = await import('../js/loadout.js');
const { playerHandSize, handSizeFor } = await import('../js/slot-rewards.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');

test('12 ships, VEXOLITH first; every other ship is unlocked by exactly one feat', () => {
  assert.equal(SHIPS.length, 12);
  assert.equal(SHIPS[0].id, DEFAULT_SHIP);
  for (const s of SHIPS.slice(1)) {
    const feats = FEATS.filter((f) => f.reward.ship === s.id);
    assert.equal(feats.length, 1, `${s.id} needs one unlock feat`);
  }
  assert.equal(new Set(SHIP_IDS).size, 12);
  for (const s of SHIPS) {
    assert.ok(s.name && s.blurb && s.quirk && /^#[0-9a-f]{6}$/i.test(s.color), s.id);
    const kit = shipFixedKit(s.id);
    if (kit) for (const w of kit) assert.ok(WEAPON_BY_ID[w], `${s.id} kit: ${w}`);
    else assert.ok(['pick', 'last', 'any'].includes(s.kit), s.id);
  }
  assert.equal(normalizeShip('nope'), DEFAULT_SHIP);
  assert.equal(isShip('toString'), false);
});

test('VEXOLITH adds nothing; other ships multiply multipliers and add the rest on top of the Armory', () => {
  const armory = armoryBonuses({ damage: 10, maxHp: 5, moveSpeed: 4 });
  assert.deepEqual(shipRunBonuses(armory, 'vexolith'), armory);
  const m = shipRunBonuses(armory, 'mantis');
  assert.equal(m.bonusHp, armory.bonusHp - 25);
  assert.ok(Math.abs(m.moveSpeedMult - armory.moveSpeedMult * 1.08) < 1e-9);
  assert.ok(Math.abs(m.critChanceBonus - (armory.critChanceBonus + 0.06)) < 1e-9);
  assert.equal(m.damageMult, armory.damageMult, 'untouched keys stay the Armory\'s');
  assert.equal(shipRunBonuses({}, 'lancer').weaponSlots, 3);
  assert.equal(shipRunBonuses({}, 'sovereign').weaponSlots, 7);
  assert.equal(shipRunBonuses({ dashCooldownMult: 0.6 }, 'wasp').dashCooldownMult, 0.5, 'floored like the Armory');
});

test('ship keys reach the player only when a ship sets them; slots, hand size and regen follow them', () => {
  const crab = runStartPlayer({});
  for (const k of ['weaponSlots', 'handSize', 'handSizeMin', 'shieldRegenMult', 'noShieldRegen']) assert.equal(k in crab, false, k);
  assert.equal(weaponSlots(crab), 6);

  const lancer = { ...runStartPlayer(shipRunBonuses({}, 'lancer')), upgradeLevels: {}, weapons: {}, loadout: [] };
  assert.equal(weaponSlots(lancer), 3);
  for (const id of ['blaster', 'rockets', 'missiles']) assert.ok(acquireWeapon(lancer, id));
  assert.equal(freeSlots(lancer), 0);
  assert.equal(acquireWeapon(lancer, 'mines'), false, 'LANCER holds 3');
  assert.equal(playerHandSize(lancer, 1), 4, 'LANCER: 4 cards from slot 1');

  const magpie = runStartPlayer(shipRunBonuses({}, 'gambler'));
  assert.equal(playerHandSize(magpie, 1), 3, 'MAGPIE: at least 3');
  assert.equal(playerHandSize(magpie, 4), 4);
  assert.equal(playerHandSize(crab, 1), handSizeFor(1), 'the crab: unchanged');

  const hermit = runStartPlayer(shipRunBonuses({}, 'hermit'));
  assert.equal(hermit.maxHp, crab.maxHp + 50);
  assert.equal(hermit.shieldRegenMult, 1.5);
  assert.equal(runStartPlayer(shipRunBonuses({}, 'revenant')).noShieldRegen, true);
});

test('stat chips read as +/- against VEXOLITH, lower dash cooldown counts as good', () => {
  assert.deepEqual(shipStatChips('vexolith'), []);
  const wasp = shipStatChips('wasp');
  assert.deepEqual(wasp.find((c) => c.label === 'SHIELD'), { label: 'SHIELD', text: '−20', good: false });
  assert.deepEqual(wasp.find((c) => c.label === 'DASH COOLDOWN'), { label: 'DASH COOLDOWN', text: '−30%', good: true });
  assert.deepEqual(wasp.find((c) => c.label === 'SPEED'), { label: 'SPEED', text: '+15%', good: true });
  assert.deepEqual(shipStatChips('sovereign'), [{ label: 'SLOTS', text: '7', good: true }]);
});

test('flag off: runs fly the crab with no ship fields; flag on: the Hangar pick; the sim override works either way', () => {
  setHangarEnabled(false, { persist: false });
  const off = h.createHeadlessGame();
  off.resetRun('normal');
  assert.equal(off.shipId, null);
  assert.equal('shipId' in off.player, false);
  const ref = runStartPlayer(off.progression.getBonuses());
  assert.equal(off.player.maxHp, ref.maxHp);

  const sim = h.createHeadlessGame();
  sim.shipOverride = 'hermit';
  sim.resetRun('normal');
  assert.equal(sim.player.shipId, 'hermit');
  assert.equal(sim.player.maxHp, ref.maxHp + 50);

  setHangarEnabled(true, { persist: false });
  try {
    const on = h.createHeadlessGame();
    const hg = on.progression.hangar();
    hg.ships.push('wasp');
    hg.ship = 'wasp';
    on.resetRun('hardcore');
    assert.equal(on.player.shipId, 'wasp');
    assert.equal(on.player.maxHp, 75 - 20, 'HARDCORE drops the Armory shield, the ship delta still applies');
    assert.equal(on.feats.run.ship, 'wasp');
    on.range = { active: true };
    on.resetRun('normal');
    assert.equal(on.shipId, null, 'the Weapon Range flies the crab');
  } finally {
    setHangarEnabled(false, { persist: false });
  }
});
