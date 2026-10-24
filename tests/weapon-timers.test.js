import test from 'node:test';
import assert from 'node:assert/strict';

// Reload / cooldown ticks (v0.46, Clay: "show reload/cds ticking down"): weapon-timers.js gives every
// equipped weapon its progress to the next attack, which glows up on its hardpoint and sweeps along its HUD
// chip; continuous weapons read ALWAYS ON.
const h = await import('../tools/balance/harness.mjs');
const { weaponTimer, syncWeaponTimers, ATTACK_INTERVAL, CONTINUOUS, OWN_CHARGE, RAPID_INTERVAL } = await import('../js/weapon-timers.js');
const { kickMount, updateMounts, mountFx, MOUNTS } = await import('../js/hardpoints.js');
const { weaponChipsHtml } = await import('../js/run-overview.js');
const { WEAPONS } = await import('../js/loadout.js');
const { weaponBuild } = await import('../js/weapon-levels.js');
const U = await import('../js/upgrades.js');

function game(weapons) {
  const g = h.createHeadlessGame();
  g.resetRun();
  for (const w of weapons) U.acquireWeapon(g.player, w);
  return g;
}

test('every weapon is timed, has its own charge or is continuous', () => {
  for (const w of WEAPONS) {
    const kinds = [w.id in ATTACK_INTERVAL, OWN_CHARGE.includes(w.id), CONTINUOUS.includes(w.id)].filter(Boolean).length;
    assert.equal(kinds, 1, `${w.id}: exactly one timer kind`);
    assert.ok(MOUNTS[w.id], `${w.id} has a mount`);
  }
  // The timed ones attack slowly enough for a sweep to read at LV 1.
  const p = game([]).player;
  for (const [id, f] of Object.entries(ATTACK_INTERVAL)) assert.ok(f(weaponBuild(p, id, 1)) >= RAPID_INTERVAL, id);
});

test('a timed weapon sweeps from its last shot to READY over its attack interval, and holds READY', () => {
  const p = game(['missiles']).player;
  assert.equal(weaponTimer(p, 'missiles'), 1, 'never fired: ready');
  kickMount(p, 'missiles');
  assert.equal(weaponTimer(p, 'missiles'), 0, 'just fired');
  const s = ATTACK_INTERVAL.missiles(weaponBuild(p, 'missiles'));
  updateMounts(p, s / 2);
  assert.ok(Math.abs(weaponTimer(p, 'missiles') - 0.5) < 1e-9);
  updateMounts(p, s);
  assert.equal(weaponTimer(p, 'missiles'), 1, 'waiting for a target: ready');
  assert.equal(weaponTimer(p, 'flamethrower'), 'on');
  assert.equal(weaponTimer(p, 'orbitals'), 'on');
  assert.equal(weaponTimer(p, 'blaster'), 'on', 'rapid fire reads always on');
});

test('syncWeaponTimers writes the timed progress on the mount (the hardpoint glow) and leaves own charges alone', () => {
  const g = game(['missiles', 'shockfield']);
  const p = g.player;
  kickMount(p, 'missiles');
  updateMounts(p, 0.3);
  const t = syncWeaponTimers(p, p.loadout);
  assert.equal(t.blaster, 'on');
  assert.ok(t.missiles > 0 && t.missiles < 1);
  assert.equal(mountFx(p, 'missiles').charge, t.missiles);
  assert.equal(typeof t.shockfield, 'number', 'the field reports its own charge');
});

test('in a real run every equipped weapon reports a timer, and the turret cradle counts held + reloading', () => {
  const g = game(['missiles', 'turret', 'mines', 'gas']);
  g.state = 'PLAYING';
  g.player.invuln = 1e9;
  for (let i = 0; i < 60 * 8; i++) g.update(1 / 60);
  const t = g.weaponTimers;
  assert.deepEqual(Object.keys(t).sort(), [...g.player.loadout].sort());
  for (const [id, v] of Object.entries(t)) assert.ok(v === 'on' || (v >= 0 && v <= 1), `${id}: ${v}`);
  assert.equal(t.gas, 'on');
  const bank = g.deployables.turretBank(g.player);
  assert.ok(bank && bank.max >= 2 && bank.held >= 0 && bank.held <= bank.max);
  const c = mountFx(g.player, 'turret').charge;
  assert.ok(c >= bank.held / bank.max - 1e-9 && c <= 1, `cradle ${c} vs ${bank.held}/${bank.max}`);
});

test('HUD chips: every chip names its weapon; timed chips carry a sweep, continuous ones ALWAYS ON, the turret pips', () => {
  const p = game(['missiles', 'turret', 'gas']).player;
  const html = weaponChipsHtml(p, { blaster: 'on', missiles: 0, turret: 0, gas: 'on' });
  for (const id of p.loadout) assert.match(html, new RegExp(`data-wid="${id}"`));
  assert.match(html, /class="weapon-slot-chip charge on"[^>]*data-wid="gas"/);
  assert.match(html, /class="weapon-slot-chip charge"[^>]*--charge:0[^>]*data-wid="missiles"/);
  assert.match(html, /data-wid="turret">[^<]*<span class="chip-pips"><\/span>/);
  assert.doesNotMatch(weaponChipsHtml(p), /charge|chip-pips/, 'the level-up strip shows no gauges');
});
