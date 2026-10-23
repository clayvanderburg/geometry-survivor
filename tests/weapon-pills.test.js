import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon pills on cards (js/weapon-pills.js) and the rarity-floor frame: a card pinned to a tier
// (rarityFloor) keeps a normal body and wears the tier on its border, a rolled tier tints as before.
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, acquireWeapon, applyUpgradeLevels } = await import('../js/upgrades.js');
const { WEAPONS } = await import('../js/loadout.js');
const { drawBreakthroughOptions } = await import('../js/weapon-levels.js');
const { STAT_ROWS, describeUpgrade, describeBreakthrough, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { weaponPill, weaponPills, rowWeapon } = await import('../js/weapon-pills.js');

function freshPlayer(weapons = []) {
  const g = h.createHeadlessGame();
  g.resetRun();
  for (const id of weapons) acquireWeapon(g.player, id);
  return g.player;
}
const card = (p, id, levelJump = 1) => renderUpgradeCard(describeUpgrade(p, { ...UPGRADE_BY_ID[id], levelJump }), '[1]');

test('a weapon pill is the short name in the weapon colour; unknown ids fall back to a plain chip', () => {
  assert.equal(weaponPill('missiles'), '<span class="wpn-pill" style="--wc:#ffe14d">Missiles</span>');
  assert.equal(weaponPill('nope'), '<span class="wpn-pill">nope</span>');
  assert.equal(weaponPills(['rockets', 'rockets', null]), weaponPill('rockets'));
  for (const w of WEAPONS) assert.ok(w.color, `${w.id} has a colour for its pill`);
});

// Each weapon lights up its own rows when equipped: rowWeapon must name that weapon for every one.
test('every per-weapon stat row maps to the weapon that lights it up', () => {
  const read = (p) => STAT_ROWS.map((r) => r.get(p));
  const none = freshPlayer();
  none.loadout = [];
  const base = read(none);
  let checked = 0;
  for (const w of WEAPONS) {
    const p = freshPlayer();
    p.loadout = [];
    acquireWeapon(p, w.id);
    read(p).forEach((v, i) => {
      if (v === null || v === undefined || base[i] !== null && base[i] !== undefined) return;
      assert.equal(rowWeapon(STAT_ROWS[i].id), w.id, `${STAT_ROWS[i].id} belongs to ${w.id}`);
      checked++;
    });
  }
  assert.ok(checked > 60, `checked ${checked} rows`);
  for (const id of ['allDamage', 'critChance', 'moveSpeed', 'global_tempo']) assert.equal(rowWeapon(id), null, id);
  assert.equal(rowWeapon('rockets:burn'), 'rockets');
  assert.equal(rowWeapon('flameRing'), 'flamethrower');
});

test('a weapon card shows its weapon pill and drops the weapon from its badge', () => {
  const p = freshPlayer(['rockets']);
  const c = card(p, 'rockets_damage');
  assert.match(c.html, /class="upg-weapons"><span class="wpn-pill" style="--wc:#ff9b3d">Rocket Pods<\/span>/);
  assert.match(c.html, /class="upg-badge">COMMON</);
  assert.ok(!/wpn-pill[^>]*>Rocket Pods<\/span>Rocket hit/.test(c.html), 'its own rows carry no pill');
});

test('tag and global cards list the weapons they boost, and their per-weapon rows lead with pills', () => {
  const p = freshPlayer(['rockets', 'missiles', 'grenades']);
  const tag = card(p, 'tag_explosive');
  assert.match(tag.html, /BOOSTS<\/span><span class="wpn-pill" style="--wc:#ff9b3d">Rocket Pods<\/span><span class="wpn-pill" style="--wc:#ffe14d">Missiles<\/span><span class="wpn-pill" style="--wc:#[0-9a-f]+">Grenades<\/span>/);
  assert.match(tag.html, /upg-stat-label"><span class="wpn-pill" style="--wc:#ff9b3d">Rocket Pods<\/span>Rocket hit/);
  const tempo = card(p, 'tempo_core');
  assert.match(tempo.html, /BOOSTS/);
  assert.match(tempo.html, /upg-stat-label"><span class="wpn-pill"[^>]*>Autocannon<\/span>Fire rate/);
});

test('Breakthrough cards carry their weapon pill', () => {
  const p = freshPlayer(['rockets']);
  const opt = drawBreakthroughOptions('rockets', 6, {})[0];
  const c = renderUpgradeCard(describeBreakthrough(p, 'rockets', 6, opt), '[1]');
  assert.match(c.html, /class="upg-weapons"><span class="wpn-pill" style="--wc:#ff9b3d">Rocket Pods<\/span>/);
});

test('a floored card is framed (rarity-floored + ◆ ribbon); a rolled tier and a floor met by its roll are not', () => {
  const p = freshPlayer();
  const piercer = card(p, 'pierce', 1);
  assert.match(piercer.className, /\brarity-rare\b.*\brarity-floored\b/);
  assert.match(piercer.html, /upg-jump-ribbon upg-floor-ribbon">◆ RARE CARD · \+1 LEVEL</);
  // Floor RARE (3) with a +2 roll: still floored, and the ribbon says both.
  const both = card(p, 'pierce', 2);
  assert.match(both.className, /\brarity-floored\b/);
  assert.match(both.html, /upg-floor-ribbon">◆ RARE CARD · ★ \+2 LEVELS</);
  // A +3 roll reaches RARE by itself: a normal rolled rare.
  const rolledToFloor = card(p, 'pierce', 3);
  assert.ok(!/rarity-floored/.test(rolledToFloor.className));
  const rolled = card(p, 'firerate', 3);
  assert.match(rolled.className, /\brarity-rare\b/);
  assert.ok(!/rarity-floored/.test(rolled.className), 'a rolled RARE keeps the tinted card');
  // Tag cards (floor UNCOMMON) work with the GLOBAL scope outline.
  const q = freshPlayer(['rockets']);
  const tag = card(q, 'tag_explosive', 1);
  assert.match(tag.className, /\brarity-uncommon rarity-floored\b.*\bscope-global\b/);
});

test('a pill row keeps its own label unless it is an element row naming the weapon', () => {
  const p = freshPlayer(['missiles', 'rockets']);
  const c = card(p, 'replicator_array');
  assert.match(c.html, /Missiles<\/span>Missiles \/ salvo/);
  // A STATUS card's element rows: the pill names the weapon, the label drops it.
  const q = freshPlayer(['rockets']);
  applyUpgradeLevels(q, { ...UPGRADE_BY_ID.rockets_fire, levelJump: 1 });
  const status = card(q, 'status_potency');
  assert.match(status.html, /upg-stat-label"><span class="wpn-pill" style="--wc:#ff9b3d">Rocket Pods<\/span>burn \(of hit damage\)/);
});
