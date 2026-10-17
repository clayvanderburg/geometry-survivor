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
const { UPGRADE_POOL, RARITY, applyUpgradeLevels } = await import('../js/upgrades.js');
const { STAT_ROWS, describeUpgrade, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
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
      thermite: 0, cryo: 0, nanite: 0, supercritical: 0
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
function withRandom(draws, fn) {
  const original = Math.random;
  Math.random = () => (draws.length ? draws.shift() : 0.99);
  try { return fn(); } finally { Math.random = original; }
}

test('a supply-cache level is the starting level of the next level-up card and the HUD tag', () => {
  const g = game();
  // Leave Prism Split as the only eligible upgrade so the cache must install it.
  for (const u of UPGRADE_POOL) if (u.id !== 'multishot') g.player.upgradeLevels[u.id] = u.maxLevel;

  // Draws: 1x cache tier, Prism Split's shuffle score, then a lucky +2 level roll.
  withRandom([0.99, 0.5, 0.05], () => g.openRelicChest({ guaranteedSuper: false }));
  assert.equal(g.state, 'CHEST');
  assert.equal(g.player.upgradeLevels.multishot, 2);
  assert.equal(g.player.stats.bulletCount, 6);

  const chestCard = elements.get('chest-rewards-grid').children[0];
  assert.match(chestCard.className, /\brarity-epic\b/);
  assert.match(chestCard.className, /\bjump-2\b/);
  assert.match(chestCard.innerHTML, /INSTALLED \/\/ NEW → LV 2/);
  assert.match(chestCard.innerHTML, /LUCKY ROLL \/\/ \+2 LEVELS/);
  assert.match(chestCard.innerHTML, /\+4 PROJECTILES/);

  g.closeChestModal();
  assert.equal(g.state, 'PLAYING');
  assert.match(elements.get('active-weapons-bar').innerHTML, /Prism Split LV 2</);

  withRandom([], () => g.triggerLevelUp());
  assert.equal(g.state, 'UPGRADE');
  assert.equal(g.currentChoices[0].id, 'multishot');
  const levelCard = elements.get('upgrade-choices').children[0];
  assert.match(levelCard.innerHTML, /LV 2 → LV 3/);
  assert.deepEqual(describeUpgrade(g.player, g.currentChoices[0]).rows.find((r) => r.id === 'bulletCount'),
    { id: 'bulletCount', label: 'Projectiles', before: '6', after: '8' });

  g.selectUpgrade(0);
  assert.equal(g.player.upgradeLevels.multishot, 3);
  assert.match(elements.get('active-weapons-bar').innerHTML, /Prism Split LV 3</);
});

test('card previews match the real install for every upgrade and level jump, without touching the player', () => {
  for (const upg of UPGRADE_POOL) {
    for (const levelJump of [1, 2, 3]) {
      const player = makePlayer();
      // A mid-run loadout so cross-weapon rows (missile/arc/blade damage) are live.
      for (const id of ['missiles', 'lightning', 'orbitals', 'shrapnel', 'thrusters', 'multishot']) applyUpgradeLevels(player, byId(id));
      const snapshot = JSON.stringify(player);
      const card = { ...upg, levelJump };
      const d = describeUpgrade(player, card);
      assert.equal(JSON.stringify(player), snapshot, `${upg.id} preview mutated the player`);

      const beforeText = STAT_ROWS.map((row) => { const v = row.get(player); return v === null ? '—' : row.fmt(v); });
      const jump = applyUpgradeLevels(player, card);
      assert.equal(d.jump, jump);
      assert.equal(d.toLevel, player.upgradeLevels[upg.id]);
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
  assert.equal(describeUpgrade(p, { ...byId('multishot'), levelJump: 1 }).headline, '+2 PROJECTILES');
  assert.equal(describeUpgrade(p, { ...byId('multishot'), levelJump: 2 }).headline, '+4 PROJECTILES');
  assert.equal(describeUpgrade(p, byId('mining_speed')).headline, '+50% MINING SPEED');
  assert.equal(describeUpgrade(p, { ...byId('mining_speed'), levelJump: 2 }).headline, '+125% MINING SPEED');
  assert.equal(describeUpgrade(p, byId('luck_boost')).headline, '+25% LUCK');
  assert.equal(describeUpgrade(p, byId('pierce')).headline, '+2 PIERCE');
  assert.equal(describeUpgrade(p, byId('missiles')).headline, `+${W.missileSalvo(1)} MISSILES / SALVO`);
});

test('only stats that change are listed', () => {
  const p = makePlayer();
  assert.deepEqual(describeUpgrade(p, byId('firerate')).rows.map((r) => r.id), ['fireRate', 'bulletSpeed']);
  p.bombs = 9; // bomb cap: the magnet card must not promise a bomb
  assert.ok(!describeUpgrade(p, byId('magnet')).rows.some((r) => r.id === 'bombs'));
  p.hp = p.maxHp = 100;
  const thrusters = describeUpgrade(p, byId('thrusters')).rows;
  assert.deepEqual(thrusters.find((r) => r.id === 'maxHp'), { id: 'maxHp', label: 'Max shield', before: '100', after: '125' });
  assert.ok(!thrusters.some((r) => r.id === 'missileDamage'), 'unowned weapons stay off the card');
});

test('rarity is fixed per upgrade, legendary for synergies, and separate from the level-jump ribbon', () => {
  const tiers = new Set();
  for (const u of UPGRADE_POOL) {
    assert.ok(RARITY[u.rarity], `${u.id} has no valid rarity`);
    assert.equal(u.rarity === 'legendary', !!u.isSynergy, `${u.id}: legendary is reserved for synergies`);
    assert.ok(u.summary && !/\d/.test(u.summary), `${u.id} summary should be number-free`);
    assert.ok(STAT_ROWS.some((row) => row.id === u.headline), `${u.id} headline row`);
    tiers.add(u.rarity);
  }
  assert.deepEqual([...tiers].sort(), Object.keys(RARITY).sort());

  const p = makePlayer();
  const plain = renderUpgradeCard(describeUpgrade(p, { ...byId('firerate'), levelJump: 1 }), '[1]');
  const lucky = renderUpgradeCard(describeUpgrade(p, { ...byId('firerate'), levelJump: 3 }), '[1]');
  assert.equal(plain.className, 'upgrade-option rarity-common');
  assert.ok(!plain.html.includes('upg-jump-ribbon'));
  assert.equal(lucky.className, 'upgrade-option rarity-common jump-3');
  assert.match(lucky.html, /LUCKY ROLL \/\/ \+3 LEVELS/);
  assert.match(lucky.html, /NEW → LV 3/);
});

test('weapons fire with the shared scaling the cards preview', () => {
  const g = game();
  g.player.stats.damage = 10;
  g.fireSwarmMissiles(3);
  assert.equal(g.missiles.length, W.missileSalvo(3));
  assert.equal(g.missiles[0].damage, 10 * W.missileDamageMult(3));
  assert.equal(g.missiles[0].speed, W.missileSpeed(3));
});

test('5x jackpot caches use compact cards so both rows of rewards fit one screen', () => {
  const g = game();
  // First draw lands the penta tier; later draws tie, so rewards install in pool order:
  // Rotary Claw twice, then Tectonic Claw Bore (5 changed stats, incl. its AREA-scaled blast radius).
  withRandom([0.0001], () => g.openRelicChest({ guaranteedSuper: false }));
  const grid = elements.get('chest-rewards-grid');
  const cards = grid.children.slice(-5);
  assert.equal(cards.length, 5);
  for (const card of cards) {
    assert.ok((card.innerHTML.match(/class="upg-stat"/g) || []).length <= 3, 'compact cards list at most 3 rows');
  }
  assert.ok(cards.some((card) => /\+2 more stats improved/.test(card.innerHTML)), 'trimmed rows are still counted');
  // Normal-size caches and level-up cards keep the full row list.
  assert.equal(describeUpgrade(makePlayer(), byId('evo_tectonic')).rows.length, 5);
});
