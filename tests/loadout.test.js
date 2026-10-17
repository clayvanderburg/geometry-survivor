import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon loadout: starting weapons, 6 slots, loadout-gated card pool, NEW WEAPON cards (chance + pity),
// weapon picks, discards, Wing Rockets as a leveled weapon, and the stepped XP curve. The balance
// harness stubs the browser and builds a real Game, so resetRun and the level-up flow are the game's own.
const h = await import('../tools/balance/harness.mjs');
const {
  UPGRADE_POOL, UPGRADE_BY_ID, rollUpgrades, rollLevelUpHand, rollWeaponPicks, acquireWeapon, discardWeapon, eligibleUpgrades,
  canOfferNewWeapon, xpToNextLevel, totalXpForLevel, upgradeKind, applyUpgradeLevels, NEW_WEAPON_ID
} = await import('../js/upgrades.js');
const { WEAPONS, WEAPON_BY_ID, ownedWeapons, freeSlots, weaponSlots } = await import('../js/loadout.js');
const { STAT_ROWS, describeWeaponPick, describeNewWeapon, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { WEAPON_SCALING: W, POTENTIAL_DPS, DPS_TARGET } = await import('../js/weapon-scaling.js');
const { TUNING, DEFAULT_TUNING, TUNING_SCHEMA } = await import('../js/config.js');

function freshGame() {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  return g;
}

function withRandom(fn, random = Math.random) {
  const original = Math.random;
  Math.random = random;
  try { return fn(); } finally { Math.random = original; }
}

function withTuning(values, fn) {
  const saved = { ...TUNING };
  Object.assign(TUNING, values);
  try { return fn(); } finally { Object.assign(TUNING, saved); }
}

// Deterministic LCG so sampled hands are reproducible.
function lcg(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

const fill = (p, ids) => ids.forEach((id) => assert.ok(acquireWeapon(p, id), `equip ${id}`));

test('a run starts with Pew Pews and Wing Rockets LV 1 in 2 of 6 slots', () => {
  const p = freshGame().player;
  assert.deepEqual(p.loadout, ['blaster', 'rockets']);
  assert.equal(p.upgradeLevels.rockets, 1);
  assert.equal(p.weapons.rockets, 1);
  assert.equal(weaponSlots(), DEFAULT_TUNING.weaponSlots);
  assert.equal(DEFAULT_TUNING.weaponSlots, 6);
  assert.equal(freeSlots(p), 4);
  assert.equal(p.xpToNext, xpToNextLevel(1));
  assert.ok(p.base, 'run-start snapshot for discards');
});

test('hands only offer level-ups and weapon-specific upgrades for equipped weapons', () => {
  const p = freshGame().player;
  const seen = new Set();
  withRandom(() => { for (let i = 0; i < 400; i++) for (const c of rollUpgrades(p, 3)) seen.add(c.id); }, lcg(11));
  for (const id of ['rockets', 'multishot', 'firerate', 'pierce', 'thermite', 'cryo', 'overdrive', 'crit_chance', 'tag_kinetic', 'tag_explosive', 'tag_area']) {
    assert.ok(seen.has(id), `${id} is offered at run start`);
  }
  for (const id of ['missiles', 'lightning', 'orbitals', 'singularity', 'shrapnel', 'mines', 'turret', 'drones', 'nanite', 'tag_electric', 'evo_tempest', 'evo_siege']) {
    assert.ok(!seen.has(id), `${id} needs its weapon first`);
  }
  // Equipping Tesla Arc unlocks its level, Nanite Swarm and the ELECTRIC tag card.
  acquireWeapon(p, 'lightning');
  const ids = eligibleUpgrades(p).map((u) => u.id);
  for (const id of ['lightning', 'nanite', 'tag_electric']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('evo_tempest'), 'Storm Protocol still needs missiles');
  acquireWeapon(p, 'missiles');
  assert.ok(eligibleUpgrades(p).some((u) => u.id === 'evo_tempest'));
});

test('equipped weapon level-ups are weighted so a typical hand is mostly about your weapons', () => {
  const p = freshGame().player;
  fill(p, ['missiles', 'lightning']);
  let weaponCards = 0, total = 0;
  withRandom(() => {
    for (let i = 0; i < 600; i++) for (const c of rollUpgrades(p, 3)) { total++; if (['weapon', 'line'].includes(upgradeKind(c))) weaponCards++; }
  }, lcg(5));
  assert.ok(weaponCards / total > 0.5, `weapon cards ${(weaponCards / total * 100).toFixed(0)}% of offers`);
  assert.equal(upgradeKind(UPGRADE_BY_ID.rockets), 'weapon');
  assert.equal(upgradeKind(UPGRADE_BY_ID.multishot), 'line');
  assert.equal(upgradeKind(UPGRADE_BY_ID.overdrive), 'general');
  assert.equal(upgradeKind(UPGRADE_BY_ID.tag_area), 'tag');
  assert.equal(upgradeKind(UPGRADE_BY_ID.evo_pulsar), 'evolution');
});

test('NEW WEAPON shows up by chance and is guaranteed after the pity count', () => {
  const p = freshGame().player;
  withTuning({ newWeaponChance: 0, newWeaponPity: 3 }, () => {
    const hands = [];
    for (let i = 0; i < 9; i++) hands.push(rollLevelUpHand(p, 3).some((c) => c.id === NEW_WEAPON_ID));
    assert.deepEqual(hands, [false, false, true, false, false, true, false, false, true]);
  });
  withTuning({ newWeaponChance: 1, newWeaponPity: 99 }, () => {
    const hand = rollLevelUpHand(p, 3);
    assert.equal(hand.length, 3);
    assert.equal(hand.filter((c) => c.isNewWeapon).length, 1, 'one NEW WEAPON card in a 3-card hand');
    assert.equal(new Set(hand.map((c) => c.id)).size, 3);
  });
  // With the default tuning NEW WEAPON is common while slots are free.
  let offered = 0;
  const q = freshGame().player;
  withRandom(() => { for (let i = 0; i < 300; i++) if (rollLevelUpHand(q, 3).some((c) => c.isNewWeapon)) offered++; }, lcg(3));
  assert.ok(offered / 300 > 0.4, `NEW WEAPON in ${offered} of 300 hands`);
});

test('six weapons fill the loadout: no more NEW WEAPON cards and no seventh weapon', () => {
  const p = freshGame().player;
  fill(p, ['missiles', 'lightning', 'orbitals', 'mines']);
  assert.equal(ownedWeapons(p).length, 6);
  assert.equal(freeSlots(p), 0);
  assert.equal(canOfferNewWeapon(p), false);
  assert.equal(acquireWeapon(p, 'drones'), false);
  assert.equal(p.weapons.drones, 0);
  withTuning({ newWeaponChance: 1, newWeaponPity: 1 }, () => {
    for (let i = 0; i < 50; i++) assert.ok(!rollLevelUpHand(p, 3).some((c) => c.isNewWeapon));
  });
});

test('picking NEW WEAPON opens a choice of 3 unequipped weapons; picking one equips it at LV 1', () => {
  const g = freshGame();
  const p = g.player;
  withTuning({ newWeaponChance: 1 }, () => g.triggerLevelUp());
  assert.equal(g.state, 'UPGRADE');
  const idx = g.currentChoices.findIndex((c) => c.isNewWeapon);
  assert.ok(idx >= 0);
  g.selectUpgrade(idx);
  assert.equal(g.state, 'UPGRADE', 'the weapon pick replaces the hand');
  assert.equal(g.currentChoices.length, 3);
  assert.ok(g.currentChoices.every((c) => c.isWeaponPick && !ownedWeapons(p).includes(c.weaponId)));
  assert.equal(new Set(g.currentChoices.map((c) => c.weaponId)).size, 3);
  const pick = g.currentChoices[1].weaponId;
  g.selectUpgrade(1);
  assert.equal(g.state, 'PLAYING');
  assert.ok(p.loadout.includes(pick));
  const levelId = WEAPON_BY_ID[pick].levelId;
  if (levelId) assert.equal(p.upgradeLevels[levelId], 1);
  assert.equal(p.level, 1, 'picking a weapon is the level-up, not an extra one');
});

test('weapon pick cards preview exact LV 1 stats, tags and summary without touching the player', () => {
  for (const w of WEAPONS) {
    const p = freshGame().player;
    if (p.loadout.includes(w.id)) discardWeapon(p, w.id);
    const snapshot = JSON.stringify(p);
    const d = describeWeaponPick(p, w.id, 99);
    assert.equal(JSON.stringify(p), snapshot, `${w.id} preview mutated the player`);
    acquireWeapon(p, w.id);
    const shown = new Map(d.rows.map((r) => [r.id, r]));
    assert.ok(d.rows.length > 0, `${w.id} shows stats`);
    for (const row of STAT_ROWS) {
      if (!shown.has(row.id)) continue;
      const v = row.get(p);
      assert.equal(shown.get(row.id).after, row.fmt(v), `${w.id} ${row.id}`);
    }
    assert.ok(d.tags.length > 0 && d.summary && d.headline, w.id);
    const html = renderUpgradeCard(d, '[1]');
    assert.match(html.className, /rarity-weapon/);
    assert.match(html.html, /EQUIP/);
  }
  const nw = describeNewWeapon(freshGame().player);
  assert.equal(nw.rows[0].before, '2 / 6');
  assert.equal(nw.rows[0].after, '3 / 6');
  assert.match(renderUpgradeCard(nw, '[2]').className, /new-weapon-card/);
  assert.equal(rollWeaponPicks(freshGame().player, 3).length, 3);
});

test('discarding a weapon removes its level, its own upgrades and evolutions, and frees the slot', () => {
  const g = freshGame();
  const p = g.player;
  // General upgrades that must survive the discard.
  for (const id of ['overdrive', 'thrusters', 'crit_damage']) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: 2 });
  const clean = JSON.parse(JSON.stringify({ stats: p.stats, maxHp: p.maxHp }));
  fill(p, ['missiles', 'lightning']);
  for (const id of ['missiles', 'lightning', 'cryo', 'nanite']) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: 2 });
  applyUpgradeLevels(p, UPGRADE_BY_ID.evo_tempest);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.tag_electric, levelJump: 2 });
  assert.equal(p.weapons.missiles, 4, 'LV 3 + Storm Protocol launcher');

  const removed = discardWeapon(p, 'missiles').map((r) => r.id).sort();
  assert.deepEqual(removed, ['evo_tempest', 'missiles']);
  assert.deepEqual(p.loadout, ['blaster', 'rockets', 'lightning']);
  assert.equal(p.weapons.missiles, 0);
  assert.equal(p.weapons.stormProtocol, 0);
  assert.equal(p.upgradeLevels.cryo, 2, 'Cryo Payload stays while Wing Rockets carry it');
  assert.equal(p.upgradeLevels.nanite, 2);
  assert.equal(p.upgradeLevels.tag_electric, 2, 'tag cards are general and stay');
  assert.equal(p.upgradeLevels.overdrive, 2);
  assert.equal(freeSlots(p), 3);
  assert.equal(canOfferNewWeapon(p), true);

  discardWeapon(p, 'lightning');
  assert.equal(p.upgradeLevels.nanite, undefined);
  assert.equal(p.weapons.lightning, 0);
  discardWeapon(p, 'rockets');
  assert.equal(p.upgradeLevels.cryo, undefined, 'last explosive carrier gone');
  assert.equal(p.weapons.rockets, 0);
  // Stats are rebuilt exactly: same as before any weapon upgrade, minus the rocket level.
  const kept = JSON.parse(JSON.stringify({ stats: p.stats, maxHp: p.maxHp }));
  kept.stats.tagDamage.electric = clean.stats.tagDamage.electric; // Overvolt Coils stays installed
  assert.deepEqual(kept, clean);
  // The last weapon cannot be discarded through the UI, but the slot logic still works.
  assert.deepEqual(p.loadout, ['blaster']);
});

test('discarding Pew Pews removes Prism Split, Hyper-Capacitor, Phase Piercer, Thermite and Pulsar Helix', () => {
  const g = freshGame();
  const p = g.player;
  const base = { ...p.stats };
  for (const id of ['multishot', 'firerate', 'pierce', 'thermite']) applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump: 2 });
  applyUpgradeLevels(p, UPGRADE_BY_ID.evo_pulsar);
  assert.ok(p.weapons.pulsarHelix);
  const removed = discardWeapon(p, 'blaster').map((r) => r.id).sort();
  assert.deepEqual(removed, ['evo_pulsar', 'firerate', 'multishot', 'pierce', 'thermite']);
  assert.equal(p.stats.bulletCount, base.bulletCount);
  assert.equal(p.stats.fireRate, base.fireRate);
  assert.equal(p.weapons.pulsarHelix, 0);
  assert.ok(!eligibleUpgrades(p).some((u) => ['multishot', 'firerate', 'pierce', 'thermite', 'tag_kinetic'].includes(u.id)));
  // No Pew Pews: the blaster stops firing, wing rockets keep going.
  g.player.invuln = 1e9;
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  assert.ok(!g.bullets.some((b) => !b.source), 'no blaster bolts');
  assert.ok(g.bullets.some((b) => b.source === 'rocket'), 'rockets still fire');
});

test('a discard keeps live tuner changes to base stats (the run-start snapshot follows the tuner)', () => {
  const g = freshGame();
  const p = g.player;
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.firerate, levelJump: 2 });
  fill(p, ['missiles']);
  withTuning({ fireRate: DEFAULT_TUNING.fireRate * 2, moveSpeed: DEFAULT_TUNING.moveSpeed * 1.5 }, () => {
    g.applyLiveTuning();
    const tuned = { fireRate: p.stats.fireRate, moveSpeed: p.stats.moveSpeed };
    discardWeapon(p, 'missiles');
    assert.ok(Math.abs(p.stats.fireRate - tuned.fireRate) < 1e-9, `fire rate ${p.stats.fireRate} vs tuned ${tuned.fireRate}`);
    assert.ok(Math.abs(p.stats.moveSpeed - tuned.moveSpeed) < 1e-9);
  });
});

test('sandbox Trigger Level-Up moves the XP bar onto the new level', () => {
  const g = freshGame();
  g.applyLiveTuning('FORCE_LEVELUP');
  assert.equal(g.player.level, 2);
  assert.equal(g.player.xpToNext, xpToNextLevel(2));
});

test('pause-menu discard goes through a confirm step', () => {
  const g = freshGame();
  fill(g.player, ['missiles']);
  g.discardPending = 'missiles';
  g.confirmDiscard('missiles');
  assert.equal(g.discardPending, null);
  assert.ok(!g.player.loadout.includes('missiles'));
});

test('Wing Rockets are a leveled weapon on the shared DPS curve, firing about once a second at LV 1', () => {
  assert.equal(W.wingRocketCooldown(1), 1);
  assert.equal(W.wingRocketCount(1), 2);
  assert.ok(W.wingRocketCount(8) > W.wingRocketCount(1), 'more rockets later');
  assert.ok(W.wingRocketBlastRadius(8) > W.wingRocketBlastRadius(1), 'bigger blasts later');
  for (let lv = 1; lv <= 8; lv++) assert.ok(Math.abs(POTENTIAL_DPS.rockets(lv) / DPS_TARGET(lv) - 1) < 0.01, `LV ${lv}`);
  const g = freshGame();
  g.player.invuln = 1e9;
  g.rocketTimer = 0;
  let volleys = 0;
  const fire = g.fireWingRockets.bind(g);
  g.fireWingRockets = (lv) => { volleys++; return fire(lv); };
  for (let i = 0; i < 600; i++) g.update(1 / 60); // 10 s of auto-fire
  assert.ok(volleys >= 9 && volleys <= 11, `${volleys} volleys in 10 s`);
  applyUpgradeLevels(g.player, { ...UPGRADE_BY_ID.rockets, levelJump: 4 });
  g.bullets = [];
  g.fireWingRockets(g.player.weapons.rockets);
  assert.equal(g.bullets.length, W.wingRocketCount(5));
});

test('Cryo Payload chills enemies caught by wing rocket blasts', async () => {
  const { applyOnHitStatuses } = await import('../js/status-effects.js');
  const e = { type: 'swarmer', hp: 100, maxHp: 100 };
  applyOnHitStatuses({ weapons: { cryo: 2 } }, e, 'rocket');
  assert.ok(e.st.chillT > 0 && e.speedScale < 1, 'rocket hit chills');
  const dry = { type: 'swarmer', hp: 100, maxHp: 100 };
  applyOnHitStatuses({ weapons: { cryo: 0 } }, dry, 'rocket');
  assert.ok(!(dry.st?.chillT > 0), 'no chill without Cryo Payload');
});

test('every weapon line goes to LV 8 so a six-weapon build can absorb ~50 weapon levels', () => {
  for (const w of WEAPONS) if (w.levelId) assert.equal(UPGRADE_BY_ID[w.levelId].maxLevel, 8, w.id);
  assert.equal(UPGRADE_BY_ID.multishot.maxLevel, 8);
  assert.equal(UPGRADE_BY_ID.pierce.maxLevel, 8);
});

test('the XP curve is a stepped line, driven by TUNING', () => {
  assert.equal(xpToNextLevel(1), DEFAULT_TUNING.xpCurveBase);
  for (let l = 2; l < 120; l++) assert.ok(xpToNextLevel(l) > xpToNextLevel(l - 1), `LV ${l}`);
  // Linear inside each band; the step changes at LV 20 and LV 40.
  const step = (l) => xpToNextLevel(l + 1) - xpToNextLevel(l);
  assert.equal(step(5), step(10));
  assert.ok(step(25) > step(10) && step(45) > step(10) && step(45) !== step(25), 'steps change at LV 20 and LV 40');
  // The old exponential curve (12, then x1.32 + 6 per level) priced LV 40 out of reach.
  let old = 0;
  for (let l = 1, need = 12; l < 40; l++, need = Math.round(need * 1.32 + 6)) old += need;
  assert.ok(totalXpForLevel(40) * 10 < old, `${totalXpForLevel(40)} vs old ${old} XP to LV 40`);
  assert.ok(xpToNextLevel(1) <= 40 && xpToNextLevel(10) < 250, 'early levels come quickly');
  withTuning({ xpCurveBase: 20 }, () => assert.equal(xpToNextLevel(1), 20));
  const keys = TUNING_SCHEMA.flatMap((grp) => grp.items).map((i) => i.key);
  for (const k of ['xpCurveBase', 'xpCurveStep', 'xpCurveStepMid', 'xpCurveStepLate', 'weaponSlots', 'newWeaponChance', 'newWeaponPity', 'weaponLevelWeight']) {
    assert.ok(keys.includes(k) && k in DEFAULT_TUNING, k);
  }
});

test('when everything is maxed and the loadout is full, level-ups fall back to a full shield repair', () => {
  const g = freshGame();
  const p = g.player;
  fill(p, ['missiles', 'lightning', 'orbitals', 'mines']);
  for (const u of UPGRADE_POOL) p.upgradeLevels[u.id] = u.maxLevel;
  p.hp = 10;
  g.triggerLevelUp();
  assert.equal(g.state, 'PLAYING');
  assert.equal(p.hp, p.maxHp);
  // A free slot still offers NEW WEAPON even when every other card is maxed.
  discardWeapon(p, 'mines');
  for (const u of UPGRADE_POOL) if (!p.upgradeLevels[u.id] && !['mines', 'evo_siege'].includes(u.id)) p.upgradeLevels[u.id] = u.maxLevel;
  const hand = withTuning({ newWeaponChance: 0, newWeaponPity: 99 }, () => rollLevelUpHand(p, 3));
  assert.deepEqual(hand.map((c) => c.id), [NEW_WEAPON_ID], 'nothing else left: NEW WEAPON regardless of chance');
});

test('discarding your last weapon explains why instead of confirming', async () => {
  const { Game } = await import('../js/main.js');
  const buttons = [];
  const panel = {
    innerHTML: '',
    querySelectorAll(sel) {
      const attr = sel.slice(1, -1);
      const re = new RegExp(`${attr}="([^"]+)"`, 'g');
      return [...this.innerHTML.matchAll(re)].map((m) => {
        const b = { listeners: [], getAttribute: () => m[1], addEventListener(_, f) { this.listeners.push(f); } };
        buttons.push([attr, b]);
        return b;
      });
    }
  };
  const silent = new Proxy({}, { get: () => () => {} });
  const g = Object.assign(Object.create(Game.prototype), {
    player: { loadout: ['rockets'], weapons: { rockets: 1 }, upgradeLevels: { rockets: 1 }, stats: {} },
    particles: silent, updateHUD() {}, focusLoadoutButton() {}
  });
  const realGet = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => (id === 'pause-loadout' ? panel : realGet(id));
  try {
    g.renderLoadoutPanel();
    assert.ok(!/data-discard="rockets"[^>]*disabled/.test(panel.innerHTML), 'the button stays clickable');
    buttons.find(([a]) => a === 'data-discard')[1].listeners[0]();
    assert.match(panel.innerHTML, /You need at least one weapon/);
    assert.ok(!panel.innerHTML.includes('CONFIRM DISCARD'));
    assert.deepEqual(g.player.loadout, ['rockets']);
    buttons.filter(([a]) => a === 'data-discard-ok').pop()[1].listeners[0]();
    assert.ok(!panel.innerHTML.includes('You need at least one weapon'), 'OK closes the notice');
  } finally {
    globalThis.document.getElementById = realGet;
  }
});
