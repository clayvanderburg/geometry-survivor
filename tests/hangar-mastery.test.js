import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 6: weapon mastery from solo runs, the +8% damage hook, and SOLO runs (no NEW WEAPON cards,
// 3-card hands). Flag off: no mastery table, no SOLO, weapon damage unchanged.
const h = await import('../tools/balance/harness.mjs');
const { masteryTierFor, masteryDamageFor, masteryDamageTable, nextMasteryTarget, SOLO_STORAGE_KEY } = await import('../js/mastery.js');
const { FeatLedger } = await import('../js/feats.js');
const { newHangar } = await import('../js/hangar-save.js');
const { weaponDamage } = await import('../js/weapon-scaling.js');
const { canOfferNewWeapon } = await import('../js/upgrades.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');
const { startChoices } = await import('../js/hangar-run.js');
const { toastText } = await import('../js/hangar-ui.js');
const { START_WEAPON_CHOICES } = await import('../js/loadout.js');

const run = (extra) => ({ soloWeapon: 'blaster', waveCleared: 0, campaignCleared: false, wave: 1, ...extra });
const boss = (wave) => ({ type: 'drone', isBoss: true, bossWave: wave });
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
const withFlag = (fn) => { setHangarEnabled(true, { persist: false }); try { return fn(); } finally { setHangarEnabled(false, { persist: false }); storage.clear(); } };

test('tiers: W10 ★, W25 ★★, the campaign ★★★, wave 75 in Endless ✦; damage +8% per tier from ★★, at most +16%', () => {
  assert.equal(masteryTierFor(run({ waveCleared: 5 })), 0);
  assert.equal(masteryTierFor(run({ waveCleared: 10 })), 1);
  assert.equal(masteryTierFor(run({ waveCleared: 25 })), 2);
  assert.equal(masteryTierFor(run({ waveCleared: 50, campaignCleared: true })), 3);
  assert.equal(masteryTierFor(run({ waveCleared: 50, campaignCleared: true, wave: 75 })), 4);
  assert.equal(masteryTierFor(run({ soloWeapon: null, waveCleared: 25 })), 0, 'not solo: nothing');
  assert.deepEqual([0, 1, 2, 3, 4].map(masteryDamageFor), [1, 1, 1.08, 1.16, 1.16]);
  assert.deepEqual(masteryDamageTable({ blaster: 1, rockets: 3 }), { rockets: 1.16 });
  assert.equal(nextMasteryTarget(0), 'CLEAR WAVE 10');
  assert.equal(nextMasteryTarget(4), null);
});

test('the ledger masters a solo weapon; a second weapon (even discarded later) ends solo; BROOD never masters', () => {
  const hg = newHangar({});
  const l = new FeatLedger({ mode: 'normal', loadout: ['rockets'] });
  l.kill(boss(10));
  const done = l.commit(hg);
  assert.equal(hg.mastery.rockets, 1);
  assert.ok(done.some((d) => d.mastery?.weapon === 'rockets' && d.mastery.tier === 1));
  assert.ok(done.some((d) => d.feat.id === 'mastery_any'), 'PROVEN (LANCER) lands in the same commit');
  assert.ok(hg.ships.includes('lancer'));
  assert.ok(hg.weapons.includes('quake'), 'the kin weapon unlocks (inert until it ships)');

  const two = new FeatLedger({ mode: 'normal', loadout: ['blaster'] });
  two.weaponAdded('mines');
  two.kill(boss(25));
  two.commit(hg);
  assert.equal(hg.mastery.blaster, undefined);

  const brood = new FeatLedger({ mode: 'normal', loadout: ['drones'], canMaster: false });
  brood.kill(boss(10));
  brood.commit(hg);
  assert.equal(hg.mastery.drones, undefined);

  const blitz = new FeatLedger({ mode: 'blitz', loadout: ['missiles'] });
  blitz.kill(boss(25));
  blitz.commit(hg);
  assert.equal(hg.mastery.missiles, undefined, 'BLITZ doesn\'t count for mastery');
});

test('Vortex has a second path: mastering Swarm Missiles', () => {
  const hg = newHangar({});
  const l = new FeatLedger({ mode: 'hardcore', loadout: ['missiles'] });
  l.kill(boss(10));
  const done = l.commit(hg);
  assert.ok(done.some((d) => d.feat.id === 'bosses_5'));
  assert.ok(hg.weapons.includes('singularity'));
});

test('the damage hook: mastered weapons hit harder, others and flag-off players are unchanged', () => {
  const g = h.createHeadlessGame();
  g.resetRun('normal');
  const p = g.player;
  const base = weaponDamage(p, 'blaster');
  const rocket = weaponDamage(p, 'rocket');
  p.masteryDamage = { blaster: 1.16 };
  assert.ok(Math.abs(weaponDamage(p, 'blaster') - base * 1.16) < 1e-9);
  assert.ok(Math.abs(weaponDamage(p, 'helix') / weaponDamage({ ...p, masteryDamage: undefined }, 'helix') - 1.16) < 1e-9, 'Autocannon sources share its mastery');
  assert.equal(weaponDamage(p, 'rocket'), rocket);
});

test('flag on: mastery tables reach the run; SOLO removes NEW WEAPON cards and sets 3-card hands', () => withFlag(() => {
  const g = h.createHeadlessGame();
  const hg = g.progression.hangar();
  hg.mastery = { rockets: 2 };
  g.resetRun('normal', 'rockets');
  assert.deepEqual(g.player.masteryDamage, { rockets: 1.08 });
  assert.equal(g.player.solo, undefined);
  assert.ok(canOfferNewWeapon(g.player));
  assert.ok(startChoices(g).includes('rockets'));

  storage.set(SOLO_STORAGE_KEY, '1');
  g.resetRun('normal', 'rockets');
  assert.equal(g.player.solo, true);
  assert.equal(g.player.weaponFloor, false, 'SOLO turns the weapon floor off');
  assert.equal(g.handSize(), 3);
  assert.equal(canOfferNewWeapon(g.player), false);
  assert.equal(g.feats.run.soloWeapon, 'rockets');

  g.shipOverride = 'brood';
  g.resetRun('normal');
  assert.equal(g.player.solo, undefined, 'BROOD can\'t fly solo');
  g.shipOverride = 'lancer';
  g.resetRun('normal', 'rockets');
  assert.equal(g.handSize(), 4, 'LANCER keeps its 4 cards');
}));

test('mastered weapons join VEXOLITH\'s start pick', () => withFlag(() => {
  const g = h.createHeadlessGame();
  g.progression.hangar().mastery = { orbitals: 1 };
  assert.deepEqual(startChoices(g), [...START_WEAPON_CHOICES, 'orbitals']);
}));

test('flag off: no mastery table or SOLO on the player even with the switch stored', () => {
  storage.set(SOLO_STORAGE_KEY, '1');
  const g = h.createHeadlessGame();
  g.resetRun('normal');
  assert.equal('masteryDamage' in g.player, false);
  assert.equal('solo' in g.player, false);
  assert.ok(canOfferNewWeapon(g.player));
  storage.clear();
});

test('mastery toasts', () => {
  assert.equal(toastText({ mastery: { weapon: 'blaster', tier: 1 }, feat: { name: 'MASTERY' }, added: [] }), 'MASTERY ★ // AUTOCANNON PROVEN');
  assert.equal(toastText({ mastery: { weapon: 'rockets', tier: 2 }, feat: { name: 'MASTERY' }, added: [] }), 'MASTERY ★★ // ROCKET PODS VETERAN (+8% DAMAGE)');
});
