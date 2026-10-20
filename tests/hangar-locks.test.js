import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 5: weapon locks. Flag on: 6 weapons start locked behind feats (veterans keep them); a locked
// weapon never reaches NEW WEAPON picks or the start pick. Flag off: nothing is locked.
const h = await import('../tools/balance/harness.mjs');
const { WEAPONS, unownedWeapons, START_WEAPON_CHOICES } = await import('../js/loadout.js');
const { rollWeaponPicks, canOfferNewWeapon } = await import('../js/upgrades.js');
const { GRANDFATHERED, WEAPON_UNLOCK_FEATS, isWeaponUnlocked, lockedWeapons } = await import('../js/weapon-unlocks.js');
const { newHangar } = await import('../js/hangar-save.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');
const { startChoices, commitFeats } = await import('../js/hangar-run.js');
const { arsenalHTML } = await import('../js/hangar-ui.js');

const withFlag = (fn) => { setHangarEnabled(true, { persist: false }); try { return fn(); } finally { setHangarEnabled(false, { persist: false }); } };

test('six weapons are locked for a new pilot, each behind a feat; veterans keep them', () => {
  const fresh = newHangar({});
  assert.deepEqual(lockedWeapons(fresh), WEAPONS.map((w) => w.id).filter((id) => GRANDFATHERED.includes(id)));
  for (const id of GRANDFATHERED) assert.ok(WEAPON_UNLOCK_FEATS[id]?.length, `${id} has an unlock feat`);
  assert.equal(WEAPONS.length - lockedWeapons(fresh).length, 9, '9 weapons from the start');
  const vet = newHangar({ totalRuns: 4 });
  assert.deepEqual(lockedWeapons(vet), [], 'a save with runs keeps every weapon it had');
  fresh.weapons.push('flamethrower');
  assert.equal(isWeaponUnlocked(fresh, 'flamethrower'), true);
  assert.equal(isWeaponUnlocked(fresh, 'not_a_weapon'), true, 'unknown ids are never locked');
});

test('flag off: no lock list on the player, every weapon can join', () => {
  setHangarEnabled(false, { persist: false });
  const g = h.createHeadlessGame();
  g.resetRun('normal');
  assert.equal('lockedWeapons' in g.player, false);
  assert.equal(unownedWeapons(g.player).length, WEAPONS.length - 1);
});

test('flag on: locked weapons never show in NEW WEAPON picks; an unlock mid-run frees them', () => withFlag(() => {
  const g = h.createHeadlessGame();
  g.resetRun('normal');
  const locked = g.player.lockedWeapons;
  assert.equal(locked.length, 6);
  for (let i = 0; i < 40; i++) for (const pick of rollWeaponPicks(g.player, 3)) assert.ok(!locked.includes(pick.weaponId));
  assert.ok(canOfferNewWeapon(g.player));
  g.feats.kill({ isBoss: true, bossWave: 10 });
  g.runIsTainted = () => false;
  commitFeats(g);
  assert.ok(!g.player.lockedWeapons.includes('flamethrower'), 'FIRST LIGHT unlocks the Flamethrower now');
  assert.ok(unownedWeapons(g.player).includes('flamethrower'));
}));

test('flag on: the start pick hides locked weapons (SOVEREIGN), pick ships keep the open three', () => withFlag(() => {
  const g = h.createHeadlessGame();
  assert.deepEqual(startChoices(g), START_WEAPON_CHOICES);
  g.shipOverride = 'sovereign';
  assert.equal(startChoices(g).length, 9);
  assert.ok(!startChoices(g).includes('gas'));
}));

test('ARSENAL lists every weapon, locks and how to unlock them', () => {
  const hg = newHangar({});
  const html = arsenalHTML(hg);
  assert.equal((html.match(/<article class="hangar-arsenal-row/g) || []).length, WEAPONS.length);
  assert.match(html, /9 \/ 15 WEAPONS UNLOCKED|9 \/ \d+ WEAPONS UNLOCKED/);
  assert.match(html, /🔒 Flamethrower/);
  assert.match(html, /FIRST LIGHT: Clear wave 10/);
  assert.match(arsenalHTML(newHangar({ totalRuns: 2 })), /VETERAN/);
});
