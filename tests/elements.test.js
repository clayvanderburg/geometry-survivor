import test from 'node:test';
import assert from 'node:assert/strict';

// Element infusion (v0.34): per-weapon element cards (FIRE / FROST / CORROSIVE / SHOCK) that lock a
// weapon's element, raise its level and never come from supply caches; the SHOCK stun; and the global
// STATUS cards. The headless harness stubs the browser, so the real Game, upgrades and statuses run.
const h = await import('../tools/balance/harness.mjs');
const {
  UPGRADE_BY_ID, UPGRADE_POOL, applyUpgradeLevels, eligibleUpgrades, rollUpgrades, rollLevelUpHand, levelRoom, acquireWeapon, discardWeapon,
  pendingBreakthroughs, cardWeight, upgradeKind
} = await import('../js/upgrades.js');
const {
  ELEMENTS, ELEMENT_WEAPONS, ELEMENT_CARDS, ELEMENT_CARD_LIST, ELEMENT_MAX_RANKS, WEAPON_MAX_LEVEL, weaponElement, levelCardWeapon
} = await import('../js/weapon-levels.js');
const { weaponLevel } = await import('../js/loadout.js');
const { WEAPON_SCALING: W, weaponDamage, burnStackDps, shockStun, shockLongChance } = await import('../js/weapon-scaling.js');
const { applyShock, applyOnHitStatuses, updateStatusEffects, isStunned, isAfflicted } = await import('../js/status-effects.js');
const { EnemyManager } = await import('../js/enemies.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { describeUpgrade, weaponPotentialDps } = await import('../js/upgrade-cards.js');
const { refreshLockedCard } = await import('../js/gold.js');

const DT = 1 / 60;
const STATUS_IDS = ['status_potency', 'status_application', 'status_duration', 'shock_conductor', 'fire_damage', 'frost_damage', 'corrode_damage', 'shock_damage'];

function freshPlayer(mode = 'normal') {
  const g = h.createHeadlessGame({ mode });
  g.resetRun(g.selectedMode);
  return { g, p: g.player };
}

function withRandom(fn, value) {
  const original = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  try { return fn(); } finally { Math.random = original; }
}

const install = (p, id, levelJump = 1) => applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump });
const elementCardsOffered = (p, opts) => eligibleUpgrades(p, opts).filter((u) => u.elementCard).map((u) => u.id);
const enemy = (extra = {}) => ({
  type: 'swarmer', x: 2100, y: 2000, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, speed: 2, radius: 12, hue: 200,
  score: 1, xp: 1, sides: 3, rotation: 0, vRot: 0.05, pulsePhase: 0, hitFlash: 0, knockX: 0, knockY: 0, trail: [], ...extra
});

test('five weapons x four elements: named per weapon, level-up cards of their weapon', () => {
  assert.deepEqual(ELEMENT_WEAPONS, ['blaster', 'rockets', 'missiles', 'lightning', 'grenades']);
  assert.deepEqual(ELEMENTS, ['fire', 'frost', 'corrode', 'shock']);
  assert.equal(ELEMENT_CARD_LIST.length, 20);
  for (const c of ELEMENT_CARD_LIST) {
    const u = UPGRADE_BY_ID[c.id];
    assert.ok(u && u.elementCard, c.id);
    assert.equal(upgradeKind(u), 'element');
    assert.deepEqual(u.owners, [c.weapon]);
    assert.equal(levelCardWeapon(c.id), c.weapon);
    assert.equal(u.maxLevel, ELEMENT_MAX_RANKS);
    assert.match(u.name, /^(Autocannon|Rocket Pods|Swarm Missiles|Tesla Arc|Plasma Grenades): /);
  }
  assert.equal(UPGRADE_BY_ID.blaster_fire.name, 'Autocannon: Thermite Rounds');
  for (const id of ['thermite', 'cryo', 'nanite']) assert.equal(UPGRADE_BY_ID[id], undefined, `${id} replaced by per-weapon cards`);
});

test('element lock: the first pick fixes the weapon\'s element; only its own rank-ups stay on offer until maxed', () => {
  const { p } = freshPlayer();
  acquireWeapon(p, 'rockets');
  assert.deepEqual(elementCardsOffered(p), ['blaster_fire', 'blaster_frost', 'blaster_corrode', 'blaster_shock',
    'rockets_fire', 'rockets_frost', 'rockets_corrode', 'rockets_shock']);
  install(p, 'blaster_frost');
  assert.deepEqual(weaponElement(p, 'blaster'), { element: 'frost', rank: 1 });
  assert.deepEqual(elementCardsOffered(p), ['blaster_frost', 'rockets_fire', 'rockets_frost', 'rockets_corrode', 'rockets_shock'],
    'other Autocannon elements are gone; Rocket Pods still choose freely');
  // Other weapons may take a different element.
  install(p, 'rockets_shock');
  assert.deepEqual(weaponElement(p, 'rockets'), { element: 'shock', rank: 1 });
  // Rank-ups stay offered until the card is maxed.
  install(p, 'blaster_frost', ELEMENT_MAX_RANKS);
  assert.equal(p.upgradeLevels.blaster_frost, ELEMENT_MAX_RANKS);
  assert.ok(!elementCardsOffered(p).includes('blaster_frost'), 'maxed');
  assert.equal(weaponElement(p, 'blaster').element, 'frost', 'still FROST');
  // A locked card for another element is not carried into the next hand.
  assert.equal(refreshLockedCard(p, { ...UPGRADE_BY_ID.blaster_fire, levelJump: 1 }), null);
  // Weights: four choices split the weapon's element weight; a lone rank-up card gets it all.
  const q = freshPlayer().p;
  const each = cardWeight(UPGRADE_BY_ID.blaster_fire, 1, q);
  install(q, 'blaster_fire');
  assert.ok(Math.abs(cardWeight(UPGRADE_BY_ID.blaster_fire, 1, q) - each * ELEMENTS.length) < 1e-9);
});

test('nothing swaps an element: hands, caches and Breakthroughs keep the pick', () => {
  const { g, p } = freshPlayer();
  install(p, 'blaster_fire');
  install(p, 'blaster_damage', 4); // LV 6: a Breakthrough is due
  assert.deepEqual(pendingBreakthroughs(p, 'blaster'), [6]);
  withRandom(() => {
    for (let i = 0; i < 300; i++) {
      for (const c of rollLevelUpHand(p, 4)) if (c.elementCard) assert.equal(c.id, 'blaster_fire');
      for (const c of rollUpgrades(p, 4, { cache: true })) assert.ok(!c.elementCard, `${c.id} from a cache`);
    }
  }, h.seededRandom('lock'));
  g.openNextBreakthrough();
  g.selectUpgrade(0);
  assert.equal(weaponElement(p, 'blaster').element, 'fire');
  for (const el of ['frost', 'corrode', 'shock']) assert.ok(!p.weapons[`blaster_${el}`]);
});

test('supply caches never roll element cards, even when they are all that is left', () => {
  const { g, p } = freshPlayer();
  // Everything but the Autocannon's element cards is banished.
  p.banished = Object.fromEntries(UPGRADE_POOL.filter((u) => !u.elementCard).map((u) => [u.id, true]));
  assert.equal(elementCardsOffered(p).length, 4, 'a level-up hand could offer them');
  assert.deepEqual(elementCardsOffered(p, { cache: true }), []);
  assert.deepEqual(rollUpgrades(p, 3, { cache: true }), []);
  const before = JSON.stringify(p.upgradeLevels);
  withRandom(() => g.openRelicChest({ guaranteedSuper: true }), 0.0001); // a 5x jackpot roll
  assert.equal(g.state, 'CHEST');
  assert.equal(JSON.stringify(p.upgradeLevels), before, 'the cache installed nothing');
  assert.equal(weaponElement(p, 'blaster'), null);
  // A real run: many caches, never an element.
  const r = freshPlayer();
  acquireWeapon(r.p, 'grenades');
  for (let i = 0; i < 40; i++) {
    withRandom(() => r.g.openRelicChest({ guaranteedSuper: i % 2 === 0 }), h.seededRandom(`cache:${i}`));
    r.g.state = 'PLAYING';
  }
  assert.ok(Object.keys(r.p.upgradeLevels).length > 3, 'caches installed other cards');
  assert.ok(!Object.keys(r.p.upgradeLevels).some((id) => UPGRADE_BY_ID[id]?.elementCard), 'no element from 40 caches');
});

test('element cards raise their weapon\'s level, trigger Breakthroughs and stop at LV 18', () => {
  const { p } = freshPlayer();
  acquireWeapon(p, 'missiles');
  install(p, 'missiles_shock', 3);
  assert.equal(weaponLevel(p, 'missiles'), 4);
  assert.equal(p.weapons.missiles, 4, 'player.weapons level key follows');
  install(p, 'missiles_shock', 2);
  assert.equal(weaponLevel(p, 'missiles'), 6);
  assert.deepEqual(pendingBreakthroughs(p, 'missiles'), [6], 'an element card can reach a Breakthrough');
  const card = describeUpgrade(p, { ...UPGRADE_BY_ID.blaster_corrode, levelJump: 2 });
  assert.deepEqual([card.fromLevel, card.toLevel, card.maxLevel], [1, 3, WEAPON_MAX_LEVEL], 'the card shows the weapon level');
  // At LV 16 a +5 element roll installs +2; at LV 18 no element card is offered.
  install(p, 'blaster_damage', 11);
  install(p, 'multishot', 4);
  assert.equal(weaponLevel(p, 'blaster'), 16);
  assert.equal(levelRoom(p, UPGRADE_BY_ID.blaster_corrode), 2);
  assert.equal(install(p, 'blaster_corrode', 5), 2);
  assert.equal(weaponLevel(p, 'blaster'), WEAPON_MAX_LEVEL);
  assert.equal(p.upgradeLevels.blaster_corrode, 2);
  assert.ok(!elementCardsOffered(p).some((id) => id.startsWith('blaster_')), 'no Autocannon element cards at LV 18');
  assert.equal(weaponLevel(p, 'missiles'), 6, 'the cap is per weapon');
});

test('global STATUS cards never raise a weapon\'s level', () => {
  const { p } = freshPlayer();
  for (const id of ['rockets', 'missiles', 'lightning', 'grenades']) acquireWeapon(p, id);
  install(p, 'blaster_fire');
  install(p, 'lightning_shock');
  const levels = Object.fromEntries(ELEMENT_WEAPONS.map((id) => [id, weaponLevel(p, id)]));
  for (const id of STATUS_IDS) {
    const u = UPGRADE_BY_ID[id];
    assert.equal(upgradeKind(u), 'status', id);
    assert.equal(levelCardWeapon(id), null, id);
    install(p, id, u.maxLevel);
  }
  assert.deepEqual(Object.fromEntries(ELEMENT_WEAPONS.map((id) => [id, weaponLevel(p, id)])), levels);
});

test('STATUS cards are offered only with a matching element on an equipped weapon (caches too)', () => {
  const { p } = freshPlayer();
  const offered = (opts) => eligibleUpgrades(p, opts).map((u) => u.id).filter((id) => STATUS_IDS.includes(id));
  assert.deepEqual(offered(), [], 'no element, no status cards');
  install(p, 'blaster_frost');
  assert.deepEqual(offered(), ['status_potency', 'status_duration', 'frost_damage']);
  assert.deepEqual(offered({ cache: true }), ['status_potency', 'status_duration', 'frost_damage'], 'caches may offer the global ones');
  acquireWeapon(p, 'lightning');
  install(p, 'lightning_shock');
  assert.deepEqual(offered(), ['status_potency', 'status_application', 'status_duration', 'shock_conductor', 'frost_damage', 'shock_damage']);
  // Discarding the SHOCK weapon takes SHOCK's cards off the table (cards already installed stay).
  install(p, 'shock_conductor', 2);
  discardWeapon(p, 'lightning');
  assert.equal(p.upgradeLevels.shock_conductor, 2);
  assert.deepEqual(offered(), ['status_potency', 'status_duration', 'frost_damage']);
  // Supercritical needs crit chance LV 2 and an element.
  const q = freshPlayer().p;
  install(q, 'crit_chance', 2);
  assert.equal(UPGRADE_BY_ID.evo_supercrit.req(q), false);
  install(q, 'blaster_shock');
  assert.equal(UPGRADE_BY_ID.evo_supercrit.req(q), true);
});

test('HARDCORE rules are unaffected: no shield cards, elements and status cards as in NORMAL', () => {
  const hard = freshPlayer('hardcore').p;
  const normal = freshPlayer().p;
  assert.equal(hard.mode, 'hardcore');
  for (const p of [hard, normal]) {
    install(p, 'blaster_fire');
  }
  const ids = (p) => eligibleUpgrades(p).map((u) => u.id);
  assert.ok(!ids(hard).includes('shield_capacitor'));
  assert.ok(ids(normal).includes('shield_capacitor'));
  assert.deepEqual(ids(hard), ids(normal).filter((id) => id !== 'shield_capacitor'));
  assert.ok(!eligibleUpgrades(hard, { cache: true }).some((u) => u.shieldCard || u.elementCard));
});

test('SHOCK: 0.3 s stun, 30% chance of 1.5 s, no refresh while stunned, 1 s immunity after', () => {
  const p = { stats: {}, weapons: { blaster_shock: 1 } };
  assert.equal(W.shockStun(1), 0.3);
  assert.equal(W.shockLongChance(1), 0.3);
  assert.equal(W.shockLongStun, 1.5);
  assert.equal(W.stunImmunity, 1);
  const e = enemy();
  const g = { enemyManager: { enemies: [e] }, particles: new Proxy({}, { get: () => () => {} }), hitEnemy() {} };
  withRandom(() => applyOnHitStatuses(p, e, 'blaster'), 0.5); // roll above 30%: a short stun
  assert.ok(Math.abs(e.st.stunT - 0.3) < 1e-9);
  assert.equal(e.st.stunLong, false);
  assert.ok(isStunned(e) && isAfflicted(e));
  withRandom(() => applyOnHitStatuses(p, e, 'blaster'), 0); // stunned: a hit neither refreshes nor upgrades it
  assert.ok(Math.abs(e.st.stunT - 0.3) < 1e-9);
  for (let t = 0; t < 18; t++) updateStatusEffects(g, DT);
  assert.equal(isStunned(e), false, 'over after 0.3 s');
  assert.equal(e.st.stunImmT, W.stunImmunity);
  withRandom(() => applyOnHitStatuses(p, e, 'blaster'), 0);
  assert.equal(isStunned(e), false, 'immune right after');
  for (let t = 0; t < 61; t++) updateStatusEffects(g, DT);
  withRandom(() => applyOnHitStatuses(p, e, 'blaster'), 0.1); // roll under 30%: the long stun
  assert.equal(e.st.stunT, 1.5);
  assert.equal(e.st.stunLong, true);
  // Only the SHOCK weapon's own hits stun.
  const other = enemy();
  withRandom(() => applyOnHitStatuses(p, other, 'missile'), 0);
  assert.ok(!isStunned(other));
});

test('SHOCK: bosses keep 20% of a stun, lieutenants half, and both shake stuns off for longer', () => {
  const boss = enemy({ isBoss: true });
  const lt = enemy({ isLieutenant: true });
  withRandom(() => { applyShock(boss, 1); applyShock(lt, 1); }, 0.9);
  assert.ok(Math.abs(boss.st.stunT - 0.3 * TUNING.shockBossMult) < 1e-9);
  assert.ok(Math.abs(lt.st.stunT - 0.3 * TUNING.shockLieutenantMult) < 1e-9);
  assert.equal(DEFAULT_TUNING.shockBossMult, 0.2);
  assert.equal(DEFAULT_TUNING.shockLieutenantMult, 0.5);
  const g = { enemyManager: { enemies: [boss, lt] }, particles: new Proxy({}, { get: () => () => {} }), hitEnemy() {} };
  const immunity = (e) => {
    g.enemyManager.enemies = [e];
    while (isStunned(e)) updateStatusEffects(g, DT);
    return e.st.stunImmT;
  };
  assert.equal(immunity(boss), W.stunImmunityBoss);
  assert.equal(immunity(lt), W.stunImmunityLieutenant);
});

test('SHOCK is never a perma-stun: uptime under constant fire stays near 40% at rank 1 and below 75% fully stacked', () => {
  const uptime = (p, rank) => {
    const e = enemy();
    const g = { enemyManager: { enemies: [e] }, particles: new Proxy({}, { get: () => () => {} }), hitEnemy() {} };
    let stunned = 0;
    const ticks = 60 * 600;
    withRandom(() => {
      for (let t = 0; t < ticks; t++) {
        applyShock(e, rank, p); // a hit every tick
        if (isStunned(e)) stunned++;
        updateStatusEffects(g, DT);
      }
    }, h.seededRandom(`uptime:${rank}`));
    return stunned / ticks;
  };
  const base = uptime({ stats: {} }, 1);
  assert.ok(base > 0.33 && base < 0.45, `rank 1 uptime ${base.toFixed(3)}`);
  const maxed = { stats: { statusPotency: 5, statusApplication: 5, statusDuration: 5, shockConductor: 5 } };
  const top = uptime(maxed, ELEMENT_MAX_RANKS);
  assert.ok(top > base && top < 0.75, `fully stacked uptime ${top.toFixed(3)}`);
  assert.ok(shockLongChance(maxed, ELEMENT_MAX_RANKS) <= W.shockLongChanceMax);
  assert.ok(shockStun(maxed, ELEMENT_MAX_RANKS) < 1.5);
});

test('stunned enemies stop moving, turning and attacking, then carry on', () => {
  const m = new EnemyManager();
  const player = { x: 2600, y: 2000 };
  const chaser = enemy({ vx: 2 });
  const gunner = enemy({ type: 'gunner', x: 2300, state: 'aim', aiTimer: 0.01, aimAngle: 0, strafeSign: 1, cadence: 1, volley: 1 });
  m.enemies = [chaser, gunner];
  const silent = new Proxy({}, { get: () => () => {} });
  const shots = () => m.enemyBullets.activeCount ?? m.enemyBullets.count ?? 0;
  withRandom(() => { applyShock(chaser, 1); applyShock(gunner, 1); }, 0.1); // long stuns
  const fired = shots();
  for (let t = 0; t < 30; t++) m.update(DT, player, [], silent, silent, 4200, 4200);
  const x = chaser.x;
  const rot = chaser.rotation;
  for (let t = 0; t < 30; t++) m.update(DT, player, [], silent, silent, 4200, 4200);
  assert.ok(Math.abs(chaser.x - x) < 0.05, 'a stunned chaser holds still');
  assert.equal(chaser.rotation, rot, 'and stops spinning');
  assert.equal(gunner.state, 'aim', 'a stunned gunner holds its shot');
  assert.equal(shots(), fired, 'no orbs while stunned');
  // Stun over: they move and shoot again.
  const g = { enemyManager: m, particles: silent, hitEnemy() {} };
  for (let t = 0; t < 100; t++) updateStatusEffects(g, DT);
  for (let t = 0; t < 30; t++) m.update(DT, player, [], silent, silent, 4200, 4200);
  assert.ok(chaser.x > x + 1, 'the chaser moves again');
  assert.equal(gunner.state, 'idle', 'the gunner fires its held shot');
});

test('element Amplifiers boost only their element\'s weapons (FIRE burn too); previews match', () => {
  const { p } = freshPlayer();
  acquireWeapon(p, 'rockets');
  install(p, 'blaster_fire');
  const blaster = weaponDamage(p, 'blaster');
  const rocket = weaponDamage(p, 'rocket');
  const burn = burnStackDps(p, 1);
  const potential = weaponPotentialDps(p, 'blaster');
  const card = describeUpgrade(p, UPGRADE_BY_ID.fire_damage);
  assert.equal(card.headline, `+${Math.round(W.elementDamageStep * 100)}% FIRE DAMAGE`);
  install(p, 'fire_damage');
  const k = 1 + W.elementDamageStep;
  assert.ok(Math.abs(weaponDamage(p, 'blaster') / blaster - k) < 1e-9);
  assert.ok(Math.abs(weaponDamage(p, 'helix') / weaponDamage({ ...p, weapons: { ...p.weapons, blaster_fire: 0 } }, 'helix') - k) < 1e-9, 'Pulsar Helix bolts are Autocannon bolts');
  assert.equal(weaponDamage(p, 'rocket'), rocket, 'Rocket Pods carry no FIRE');
  assert.ok(Math.abs(burnStackDps(p, 1) / burn - k) < 1e-9);
  assert.ok(Math.abs(weaponPotentialDps(p, 'blaster') / potential - k) < 1e-9);
});

test('Status Potency, Application and Duration change burn, chill, corrode and stun as their cards say', () => {
  const p = { stats: { damage: 10 }, weapons: { blaster_fire: 1, missiles_frost: 1, lightning_corrode: 1, grenades_shock: 1 } };
  const e = enemy();
  withRandom(() => {
    for (const src of ['blaster', 'missile', 'lightning', 'grenade']) applyOnHitStatuses(p, e, src);
  }, 0.99);
  const base = { ...e.st };
  const q = { ...p, stats: { damage: 10, statusPotency: 2, statusApplication: 2, statusDuration: 2 } };
  const f = enemy();
  withRandom(() => {
    for (const src of ['blaster', 'missile', 'lightning', 'grenade']) applyOnHitStatuses(q, f, src);
  }, 0.99);
  assert.ok(Math.abs(f.st.burnDps / base.burnDps - (1 + 2 * W.potencyStep)) < 1e-9, 'potency: burn DPS');
  assert.equal(f.st.burnMax, base.burnMax + 2 * W.applicationStacks, 'application: burn cap');
  assert.equal(f.st.corrodeMax, base.corrodeMax + 2 * W.applicationStacks, 'application: corrode cap');
  assert.ok(f.st.slow > base.slow, 'potency: deeper chill');
  assert.ok(Math.abs(f.st.burnT / base.burnT - (1 + 2 * W.durationStep)) < 1e-9, 'duration: burn');
  assert.ok(Math.abs(f.st.chillT / base.chillT - (1 + 2 * W.durationStep)) < 1e-9, 'duration: chill');
  assert.ok(f.st.stunT > base.stunT, 'potency and duration: longer stuns');
  // Application's double stacks: a low roll adds two burn stacks in one hit.
  const d = enemy();
  withRandom(() => applyOnHitStatuses(q, d, 'blaster'), 0.01);
  assert.equal(d.st.burn, 2);
  // Burn ticks are credited to the weapon that lit them.
  assert.equal(d.st.burnStat, 'burn_blaster');
});
