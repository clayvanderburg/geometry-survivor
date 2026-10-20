import test from 'node:test';
import assert from 'node:assert/strict';

// Upgrade card readability + shared cache/level-up state. Browser services are stubbed; the DOM stub
// keeps one element per id so tests can read the cards and HUD tags the game actually rendered.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const makeElement = () => ({
  textContent: '', innerHTML: '', className: '', style: {}, children: [],
  classList: { add() {}, remove() {} },
  addEventListener() {},
  appendChild(child) { this.children.push(child); }
});
const elements = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  },
  createElement: makeElement
};
const { Game } = await import('../js/main.js');
const { TUNING } = await import('../js/config.js');
const { UPGRADE_POOL, RARITY, applyUpgradeLevels, rollUpgrades, levelJumpChances } = await import('../js/upgrades.js');
const { STAT_ROWS, describeUpgrade, renderUpgradeCard, levelText, cardScope, CARD_SCOPES } = await import('../js/upgrade-cards.js');
const { WEAPON_SCALING: W, blasterStreams } = await import('../js/weapon-scaling.js');
const { STAT_CARD_BY_ID, ELEMENT_CARD_BY_ID, levelCardWeapon, levelBuild, weaponBuild } = await import('../js/weapon-levels.js');
const { weaponLevel } = await import('../js/loadout.js');
const silent = new Proxy({}, { get: () => () => {} });

// Mirrors the run-start player built in Game.resetRun (no armory bonuses).
function makePlayer() {
  return {
    x: 2000, y: 2000, vx: 0, vy: 0, angle: 0, radius: TUNING.shipRadius,
    hp: 80, maxHp: 100, invuln: 0, dashTimer: 0, dashCooldown: 0, bombs: 2,
    level: 1, xp: 0, xpToNext: 12, upgradeLevels: {},
    stats: {
      moveSpeed: TUNING.moveSpeed, fireRate: TUNING.fireRate, bulletSpeed: TUNING.bulletSpeed,
      bulletCount: 2, spreadAngle: 0.14, pierce: 1, damage: TUNING.baseDamage,
      magnetRadius: TUNING.magnetRadius, xpMultiplier: TUNING.xpMultiplier, luck: TUNING.baseLuck,
      coreDropMult: 1, miningSpeed: TUNING.miningSpeed, miningRange: TUNING.miningRange, drillScale: TUNING.drillScale,
      critChance: TUNING.baseCritChance, critDamage: TUNING.baseCritDamage, tagDamage: { kinetic: 1, explosive: 1, electric: 1 }, areaMult: 1
    },
    weapons: {
      missiles: 0, orbitals: 0, lightning: 0, singularity: 0, shrapnel: 0, dashNova: 0, pulsarHelix: 0, stormProtocol: 0, tectonicBore: 0,
      supercritical: 0
    }
  };
}

function game() {
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies: [] }, sound: silent, particles: silent, grid: silent,
    player: makePlayer(), state: 'PLAYING', score: 0, multiplier: 1, sessionCores: 0,
    wave: 1, elapsedTime: 0, chests: [], missiles: [],
    progression: { addCores() {}, data: { cores: 0 } }
  });
}

const byId = (id) => UPGRADE_POOL.find((u) => u.id === id);
const sc0 = (u) => (levelCardWeapon(u.id) ? { weapon: levelCardWeapon(u.id) } : null); // stat and element cards
function withRandom(draws, fn) {
  const original = Math.random;
  Math.random = () => (draws.length ? draws.shift() : 0.99);
  try { return fn(); } finally { Math.random = original; }
}

test('a supply-cache level is the starting level of the next level-up card and the HUD tag', () => {
  const g = game();
  // Leave Prism Split as the only eligible upgrade so the cache must install it (the other Autocannon
  // cards are banished: maxing them would fill the weapon's LV 12 cap).
  for (const u of UPGRADE_POOL) if (u.id !== 'multishot' && !STAT_CARD_BY_ID[u.id] && !ELEMENT_CARD_BY_ID[u.id]) g.player.upgradeLevels[u.id] = u.maxLevel;
  g.player.banished = Object.fromEntries([...Object.keys(STAT_CARD_BY_ID), ...Object.keys(ELEMENT_CARD_BY_ID)].filter((id) => id !== 'multishot').map((id) => [id, true]));

  // Draws: 1x cache tier, Prism Split's shuffle score, then a lucky +2 level roll.
  withRandom([0.99, 0.5, 0.05], () => g.openRelicChest({ guaranteedSuper: false }));
  assert.equal(g.state, 'CHEST');
  assert.equal(g.player.upgradeLevels.multishot, 2);
  assert.equal(blasterStreams(g.player), 6);
  assert.equal(g.player.stats.bulletCount, 2, 'cards never touch the base stats');

  const chestCard = elements.get('chest-rewards-grid').children[0];
  assert.match(chestCard.className, /\brarity-uncommon\b/, 'a +2 roll is uncommon');
  assert.match(chestCard.className, /\bjump-2\b/);
  assert.match(chestCard.innerHTML, /INSTALLED \/\/ LV 1 → LV 3/);
  assert.match(chestCard.innerHTML, /\+2 LEVELS/);
  assert.match(chestCard.innerHTML, /\+4 AUTOCANNON PROJECTILES/);

  g.closeChestModal();
  assert.equal(g.state, 'PLAYING');
  assert.match(elements.get('active-weapons-bar').innerHTML, /Autocannon LV 3</);

  withRandom([], () => g.triggerLevelUp());
  assert.equal(g.state, 'UPGRADE');
  assert.equal(g.currentChoices[0].id, 'multishot');
  const levelCard = elements.get('upgrade-choices').children[0];
  assert.match(levelCard.innerHTML, /LV 3 → LV 4/);
  assert.deepEqual(describeUpgrade(g.player, g.currentChoices[0]).rows.find((r) => r.id === 'bulletCount'),
    { id: 'bulletCount', label: 'Projectiles', before: '6', after: '8' });

  g.selectUpgrade(0);
  assert.equal(g.player.upgradeLevels.multishot, 3);
  // LV 4 is not a milestone (Breakthroughs come at LV 6 / 12 / 18): play resumes.
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(g.player.breakthroughs?.blaster ?? {}, {});
  assert.match(elements.get('active-weapons-bar').innerHTML, /Autocannon LV 4</);
});

test('card previews match the real install for every upgrade and level jump, without touching the player', () => {
  // Equip lines are never offered (NEW WEAPON installs them) and only set LV 1, so they are skipped.
  for (const upg of UPGRADE_POOL.filter((u) => !u.isCore)) {
    for (const levelJump of [1, 2, 3]) {
      const player = makePlayer();
      // A mid-run loadout so cross-weapon rows (missile/arc/blade damage) are live.
      for (const id of ['missiles', 'lightning', 'orbitals', 'shrapnel', 'thrusters', 'multishot']) applyUpgradeLevels(player, byId(id));
      if (sc0(upg)) applyUpgradeLevels(player, byId(sc0(upg).weapon)); // its weapon is equipped
      for (const w of upg.ownersAll || []) applyUpgradeLevels(player, byId(w)); // an evolution's weapons are equipped
      const snapshot = JSON.stringify(player);
      const card = { ...upg, levelJump };
      const d = describeUpgrade(player, card);
      assert.equal(JSON.stringify(player), snapshot, `${upg.id} preview mutated the player`);

      const beforeText = STAT_ROWS.map((row) => { const v = row.get(player); return v === null ? '—' : row.fmt(v); });
      const jump = applyUpgradeLevels(player, card);
      assert.equal(d.jump, jump);
      const sc = sc0(upg);
      assert.equal(d.toLevel, sc ? weaponLevel(player, sc.weapon) : player.upgradeLevels[upg.id]);
      const shown = new Map(d.rows.map((r) => [r.id, r]));
      let changed = 0;
      STAT_ROWS.forEach((row, i) => {
        const v = row.get(player);
        const afterText = v === null ? '—' : row.fmt(v);
        if (afterText === beforeText[i]) {
          assert.ok(!shown.has(row.id), `${upg.id} shows unchanged ${row.id}`);
          return;
        }
        changed++;
        if (shown.has(row.id)) {
          assert.equal(shown.get(row.id).before, beforeText[i], `${upg.id} ${row.id} before`);
          assert.equal(shown.get(row.id).after, afterText, `${upg.id} ${row.id} after`);
        }
      });
      assert.equal(d.rows.length + d.hiddenRows, changed, `${upg.id} row count`);
      assert.ok(changed > 0, `${upg.id} changes nothing visible`);
    }
  }
});

test('headlines are computed from the rolled level jump', () => {
  const p = makePlayer();
  assert.equal(describeUpgrade(p, { ...byId('multishot'), levelJump: 1 }).headline, '+2 AUTOCANNON PROJECTILES');
  assert.equal(describeUpgrade(p, { ...byId('multishot'), levelJump: 2 }).headline, '+4 AUTOCANNON PROJECTILES');
  assert.equal(describeUpgrade(p, byId('mining_speed')).headline, '+12% MINING SPEED');
  assert.equal(describeUpgrade(p, { ...byId('mining_speed'), levelJump: 2 }).headline, '+25% MINING SPEED');
  assert.equal(describeUpgrade(p, byId('luck_boost')).headline, '+25% LUCK');
  assert.equal(describeUpgrade(p, byId('pierce')).headline, '+1 AUTOCANNON PIERCE');
  assert.equal(describeUpgrade(p, byId('blaster_damage')).headline, '+34% AUTOCANNON DAMAGE');
  assert.equal(describeUpgrade(p, { ...byId('blaster_damage'), levelJump: 2 }).headline, '+78% AUTOCANNON DAMAGE');
  // From 3x up a compounding gain reads as a multiplier (+4 ranks: 1.336^4 = 3.19x, not "+219%").
  assert.equal(describeUpgrade(p, { ...byId('blaster_damage'), levelJump: 4 }).headline, '3.2× AUTOCANNON DAMAGE');
  assert.equal(describeUpgrade(p, byId('missiles')).headline, `+${W.missileSalvo(levelBuild('missiles', 1))} MISSILES / SALVO`);
});

test('only stats that change are listed', () => {
  const p = makePlayer();
  assert.deepEqual(describeUpgrade(p, byId('firerate')).rows.map((r) => r.id), ['fireRate']);
  // Every weapon stat card shows exactly one stat: its own.
  for (const id of ['missiles', 'singularity', 'orbitals', 'mines']) applyUpgradeLevels(p, byId(id));
  for (const id of ['singularity_pull', 'singularity_cooldown', 'singularity_core', 'orbitals_size', 'mines_fuse', 'missiles_radius', 'missiles_reload']) {
    assert.equal(describeUpgrade(p, byId(id)).rows.length, 1, id);
  }
  p.bombs = 9; // bomb cap: the magnet card must not promise a bomb
  assert.ok(!describeUpgrade(p, byId('magnet')).rows.some((r) => r.id === 'bombs'));
  p.hp = p.maxHp = 100;
  const thrusters = describeUpgrade(p, byId('thrusters')).rows;
  assert.ok(!thrusters.some((r) => r.id === 'maxHp'), 'the shield has its own card');
  const capacitor = describeUpgrade(p, byId('shield_capacitor')).rows;
  assert.deepEqual(capacitor.find((r) => r.id === 'maxHp'), { id: 'maxHp', label: 'Max shield', before: '100', after: '120' });
  assert.ok(!thrusters.some((r) => r.id === 'missileDamage'), 'unowned weapons stay off the card');
});

test('rarity is the rolled level jump: +1 common up to +5 legendary; evolutions have their own tier', () => {
  for (const u of UPGRADE_POOL) {
    assert.equal(u.rarity, undefined, `${u.id}: rarity comes from the roll, not the upgrade`);
    assert.ok(u.summary && !/\d/.test(u.summary), `${u.id} summary should be number-free`);
    assert.ok(STAT_ROWS.some((row) => row.id === u.headline), `${u.id} headline row`);
  }
  const p = makePlayer();
  const expected = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  for (let jump = 1; jump <= 5; jump++) {
    const card = renderUpgradeCard(describeUpgrade(p, { ...byId('luck_boost'), levelJump: jump }), '[1]');
    assert.match(card.className, new RegExp(`\\brarity-${expected[jump - 1]}\\b`), `+${jump}`);
    assert.equal(card.html.includes('upg-jump-ribbon'), jump > 1);
    if (jump > 1) assert.match(card.html, new RegExp(`\\+${jump} LEVELS`));
  }
  const evo = UPGRADE_POOL.find((u) => u.isSynergy);
  assert.match(renderUpgradeCard(describeUpgrade(p, { ...evo, levelJump: 1 }), '[1]').className, /\brarity-evolution\b/);
});

test('+4 and +5 rolls happen only when they fit under the level cap, scaled by luck', () => {
  const p = makePlayer();
  const withConstant = (r, fn) => { const o = Math.random; Math.random = () => r; try { return fn(); } finally { Math.random = o; } };
  // Every draw tiny: each offered card rolls into the +5 band, capped by its remaining levels.
  for (const card of withConstant(0.0001, () => rollUpgrades(p, 3))) {
    if (!card.isSynergy) assert.equal(card.levelJump, Math.min(5, card.maxLevel), card.id);
  }
  p.upgradeLevels = Object.fromEntries(UPGRADE_POOL.map((u) => [u.id, u.maxLevel - 2]));
  for (const card of withConstant(0.0001, () => rollUpgrades(p, 3))) {
    if (!card.isSynergy) assert.equal(card.levelJump, 2, `${card.id} has only 2 levels left`);
  }
  const c = levelJumpChances(1);
  assert.ok(c.pentaChance < c.quadChance && c.quadChance < c.tripleChance && c.tripleChance < c.doubleChance);
  assert.ok(levelJumpChances(2).pentaChance > c.pentaChance, 'luck raises legendary odds');
});

test('weapons fire with the shared scaling the cards preview', () => {
  const g = game();
  g.player.stats.damage = 10;
  g.player.upgradeLevels.missiles_salvo = 2;
  const b = weaponBuild(g.player, 'missiles', 3);
  g.fireSwarmMissiles(b);
  assert.equal(g.missiles.length, W.missileSalvo(b));
  assert.equal(g.missiles.length, 4);
  assert.equal(g.missiles[0].damage, 10 * W.missileDamageMult(b));
  assert.equal(g.missiles[0].speed, W.missileSpeed);
});

test('5x jackpot caches use compact cards so both rows of rewards fit one screen', () => {
  const g = game();
  // Autocannon lines are maxed, so with tied draws the heaviest-weighted eligible card wins, in pool order:
  // Rotary Claw twice, then Tectonic Claw Bore (an evolution, 5 changed stats incl. its AREA-scaled blast).
  for (const id of ['multishot', 'firerate', 'pierce']) g.player.upgradeLevels[id] = byId(id).maxLevel;
  withRandom([0.0001], () => g.openRelicChest({ guaranteedSuper: false }));
  const grid = elements.get('chest-rewards-grid');
  const cards = grid.children.slice(-5);
  assert.equal(cards.length, 5);
  for (const card of cards) {
    assert.ok((card.innerHTML.match(/class="upg-stat"/g) || []).length <= 3, 'compact cards list at most 3 rows');
  }
  // Rows a compact card trims are still counted.
  assert.equal(describeUpgrade(makePlayer(), byId('evo_tectonic'), 3).hiddenRows, 2);
  // Normal-size caches and level-up cards keep the full row list.
  assert.equal(describeUpgrade(makePlayer(), byId('evo_tectonic')).rows.length, 5);
});

test('Storm Protocol shows its extra missile launcher as +1 STORM on missile cards', () => {
  const p = makePlayer();
  p.upgradeLevels.missiles = 1; p.weapons.missiles = 1;
  const missiles = UPGRADE_POOL.find((u) => u.id === 'missiles_salvo');
  assert.equal(describeUpgrade(p, { ...missiles, levelJump: 1 }).bonus, null);
  UPGRADE_POOL.find((u) => u.id === 'evo_tempest').apply(p);
  const d = describeUpgrade(p, { ...missiles, levelJump: 1 });
  assert.deepEqual(d.bonus, { amount: 1, label: 'STORM' });
  assert.match(levelText(d), /LV 1 → LV 2 <span class="lv-bonus">\+1 STORM<\/span>/);
});

test('reload and fire-rate cards change only their own stat', () => {
  const p = makePlayer();
  p.upgradeLevels.missiles = 1; p.weapons.missiles = 1;
  const m = describeUpgrade(p, byId('missiles_reload'));
  assert.deepEqual(m.rows, [{ id: 'missileCooldown', label: 'Salvo cooldown', before: '1.11s', after: '0.79s' }]);
  p.upgradeLevels.turret = 1; p.weapons.turret = 1;
  const t = describeUpgrade(p, byId('turret_rate'));
  assert.deepEqual(t.rows, [{ id: 'turretFireRate', label: 'Turret fire rate', before: '6.10/s', after: '8.54/s' }]);
});

test('the HUD lists each weapon once (slot chip, real level) and nothing else; upgrades go to the pause menu and level-up strip', async () => {
  const { UPGRADE_BY_ID, acquireWeapon, runUpgradeLines } = await import('../js/upgrades.js');
  const { loadoutStripHtml, upgradesHtml } = await import('../js/run-overview.js');
  const g = game();
  const p = g.player;
  p.loadout = []; // a real run: weapons join through acquireWeapon (equip line at rank 1)
  for (const id of ['blaster', 'lightning', 'grenades']) assert.equal(acquireWeapon(p, id), true, id);
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.blaster_damage, levelJump: 5 });
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.lightning_damage, levelJump: 2 });
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.grenades_fire, levelJump: 2 });
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.status_potency, levelJump: 1 });
  assert.equal(weaponLevel(p, 'blaster'), 6);
  assert.equal(weaponLevel(p, 'lightning'), 3);
  assert.equal(weaponLevel(p, 'grenades'), 3, 'element ranks are weapon levels');

  assert.deepEqual(runUpgradeLines(p).map((u) => `${u.name} LV ${u.level}`), ['Status Potency LV 1'],
    'equip lines (rank 1), stat cards and element cards stay out of the upgrade list');

  g.updateHUD();
  const bar = elements.get('active-weapons-bar').innerHTML;
  assert.match(bar, /Autocannon LV 6</);
  assert.match(bar, /Tesla Arc LV 3</);
  assert.match(bar, /Grenades LV 3 <span class="weapon-el"[^>]*>FIRE</, 'an infused weapon shows its element');
  assert.ok(!bar.includes('Status Potency') && !bar.includes('Thermite'), 'no upgrade row on the HUD');

  // The level-up strip shows both rows: weapon slots, then the picked upgrades (each weapon once).
  const [weapons, upgrades] = loadoutStripHtml(p).split('UPGRADES</span>');
  assert.match(weapons, /Autocannon LV 6</);
  assert.match(upgrades, /Status Potency LV 1</);
  for (const name of ['Autocannon', 'Tesla Arc', 'Plasma Grenades']) assert.ok(!upgrades.includes(name), `${name} is not listed twice`);
  assert.match(upgradesHtml(p), /STATUS EFFECTS[\s\S]*Status Potency[\s\S]*LV 1/);
});

test('every offered card maps to a scope, and the level-up card shows it', () => {
  const p = makePlayer();
  const counts = { weapon: 0, utility: 0, global: 0 };
  for (const u of UPGRADE_POOL) {
    const scope = cardScope(u);
    assert.ok(CARD_SCOPES.includes(scope), `${u.id} has no scope`);
    counts[scope]++;
    const d = describeUpgrade(p, u);
    assert.equal(d.scope, scope);
    const view = renderUpgradeCard(d, '[1]');
    assert.equal(view.className.includes(`scope-${scope}`), scope !== 'weapon', `${u.id} class`);
    assert.equal(view.html.includes('upg-scope'), scope !== 'weapon', `${u.id} label`);
  }
  assert.ok(counts.weapon && counts.utility && counts.global, JSON.stringify(counts));
  assert.equal(cardScope({ id: 'blaster_damage' }), 'weapon');
  assert.equal(cardScope({ id: 'pierce' }), 'utility');
  assert.equal(cardScope({ id: 'rockets_radius' }), 'utility');
  assert.equal(cardScope({ id: 'magnet' }), 'utility');
  assert.equal(cardScope({ id: 'crit_chance' }), 'global');
  assert.equal(cardScope({ id: 'tag_area', category: 'SPECIALIST' }), 'global');
  assert.equal(cardScope({ id: 'status_potency', statusCard: true }), 'global');
});

test('cards that do several separate things name all of them in the headline, not just the first stat', () => {
  const p = makePlayer();
  applyUpgradeLevels(p, UPGRADE_POOL.find((u) => u.id === 'blaster_fire')); // an element, so status cards apply
  const headline = (id) => describeUpgrade(p, UPGRADE_POOL.find((u) => u.id === id)).headline;
  assert.equal(headline('status_application'), 'ALL 4 STATUS REACTIONS STRONGER');
  assert.equal(headline('status_duration'), 'STACKS, FREEZES & STUNS LAST LONGER');
  assert.equal(headline('shock_conductor'), 'MORE & LONGER STUNS · MORE ARCING');
  assert.equal(headline('magnet'), '+44% PICKUP · +15% XP · +1 BOMB');
  assert.equal(headline('thrusters'), '+16% SPEED · FASTER DASH + SHOCKWAVE');
  applyUpgradeLevels(p, UPGRADE_POOL.find((u) => u.id === 'thrusters'));
  assert.equal(headline('thrusters'), '+16% SPEED · FASTER DASH, BIGGER SHOCKWAVE');
  assert.match(headline('overdrive'), /DAMAGE · ALL WEAPONS/, 'single-effect cards keep their stat headline');
});

test('Geom Attractor Field maxes at 2x XP and half its old pickup radius (6.1x base)', () => {
  const p = makePlayer();
  const card = UPGRADE_POOL.find((u) => u.id === 'magnet');
  for (let i = 0; i < card.maxLevel; i++) applyUpgradeLevels(p, card);
  assert.ok(Math.abs(p.stats.xpMultiplier / TUNING.xpMultiplier - 2) < 1e-9, 'LV 5 = 2x XP');
  assert.ok(Math.abs(p.stats.magnetRadius / TUNING.magnetRadius - Math.pow(1.65, 5) / 2) < 1e-9, 'LV 5 = half the old 12.2x radius');
});
