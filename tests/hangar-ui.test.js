import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 3: the Hangar screen's HTML (pure builders) and its mount, which adds nothing while the flag
// is off.
await import('../tools/balance/harness.mjs'); // browser stubs (config.js reads window)
const { shipCardHTML, shipsHTML, featsHTML, featRowHTML, progressBarHTML, toastText, kitText, shipFeat, mountHangar, HANGAR_TABS } = await import('../js/hangar-ui.js');
const { newHangar } = await import('../js/hangar-save.js');
const { FEAT_BY_ID, FEATS } = await import('../js/feats.js');
const { SHIPS } = await import('../js/ships.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');

const fresh = () => newHangar({});

test('flag off: mountHangar adds nothing (no button, overlay or toast)', () => {
  setHangarEnabled(false, { persist: false });
  let created = 0;
  const doc = { createElement() { created++; return {}; }, getElementById: () => ({}) };
  assert.equal(mountHangar({}, doc), null);
  assert.equal(created, 0);
});

test('ship cards: unlocked ships show chips, kit, quirk and SELECT; locked ones their feat and progress', () => {
  const h = fresh();
  h.career.kills = 1240;
  const vex = shipCardHTML('vexolith', h);
  assert.match(vex, /SELECTED/);
  assert.match(vex, /BASELINE/);
  const mantis = shipCardHTML('mantis', h);
  assert.match(mantis, /class="hangar-ship locked"/);
  assert.match(mantis, /EXTERMINATOR/);
  assert.match(mantis, /1,240 \/ 1,500 ENEMIES/);
  assert.doesNotMatch(mantis, /data-select-ship/);
  h.ships.push('mantis');
  h.fresh.push('ship:mantis');
  const open = shipCardHTML('mantis', h);
  assert.match(open, /data-select-ship="mantis"/);
  assert.match(open, /NEW/);
  assert.match(open, /SHIELD<\/b> −25/);
  assert.match(open, /KIT<\/b> Autocannon/);
  assert.equal((shipsHTML(h).match(/<article class="hangar-ship/g) || []).length, SHIPS.length);
  assert.equal(shipFeat('vexolith'), null);
  assert.equal(kitText('brood'), 'Escort Drones + Sentry Turret');
  assert.equal(kitText('sovereign'), 'Any unlocked weapon');
});

test('feats: hidden ones read ??? with their hint until done; done ones show the date', () => {
  const h = fresh();
  const secret = featRowHTML(FEAT_BY_ID.untouchable, h);
  assert.match(secret, /\?\?\?/);
  assert.match(secret, /never touched/);
  assert.doesNotMatch(secret, /UNTOUCHABLE/);
  h.feats.untouchable = '2026-10-21';
  const done = featRowHTML(FEAT_BY_ID.untouchable, h);
  assert.match(done, /UNTOUCHABLE/);
  assert.match(done, /2026-10-21/);
  assert.equal((featsHTML(h).match(/hangar-feat-row/g) || []).length, FEATS.length);
  assert.match(progressBarHTML(FEAT_BY_ID.wave_10, h), /BEST WAVE 0 \/ 10/);
  assert.deepEqual(HANGAR_TABS.map((t) => t.id), ['ships', 'arsenal', 'feats']);
});

test('toasts name the feat and what it unlocked', () => {
  assert.equal(toastText({ feat: FEAT_BY_ID.kills_1500, added: ['ship:mantis'] }), 'FEAT // EXTERMINATOR — MANTIS JOINS THE HANGAR');
  assert.equal(toastText({ feat: FEAT_BY_ID.wave_10, added: ['weapon:flamethrower'] }), 'FEAT // FIRST LIGHT — FLAMETHROWER UNLOCKED');
  assert.equal(toastText({ feat: FEAT_BY_ID.hoarder, added: ['badge:hoarder'] }), 'FEAT // DRAGON HOARD — BADGE EARNED');
});
