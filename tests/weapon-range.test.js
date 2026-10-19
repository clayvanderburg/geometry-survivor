import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon Range: builds from the panel config, dummy formations, the rolling DPS window, and a headless
// range run (dummies spawn, weapons fire, DPS is recorded, no waves, nothing is recorded or dropped).
const h = await import('../tools/balance/harness.mjs');
const {
  WeaponRange, DpsMeter, autoRanks, clampRanks, entryLevel, entryBuild, entryBreakthroughs, sanitizeRangeConfig, defaultRangeConfig,
  applyRangeLoadout, formationPoints, loadRangeConfig, saveRangeConfig, INFINITE_HP, RANGE_MOD_IDS, RANGE_TARGETS
} = await import('../js/weapon-range.js');
const { readoutHtml } = await import('../js/weapon-range-ui.js');
const { STAT_CARDS, WEAPON_MAX_LEVEL, weaponBuild } = await import('../js/weapon-levels.js');
const { WEAPONS, weaponLevel, weaponSlots } = await import('../js/loadout.js');
const { UPGRADE_BY_ID } = await import('../js/upgrades.js');
const { DAMAGE_SOURCE_COLORS } = await import('../js/damage-numbers.js');

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// A fresh run's player (run-start snapshot + the starting Autocannon), as the range gets it.
function freshPlayer() {
  const g = h.createHeadlessGame();
  g.resetRun();
  return g.player;
}

test('AUTO ranks spread level - 1 ranks round-robin over the stat cards, within each card cap', () => {
  for (const { id } of WEAPONS) {
    for (let lv = 1; lv <= WEAPON_MAX_LEVEL; lv++) {
      const r = autoRanks(id, lv);
      assert.equal(sum(r), lv - 1, `${id} LV ${lv}`);
      for (const c of STAT_CARDS[id]) assert.ok(r[c.id] <= c.maxLevel, `${id} ${c.id} over its cap`);
      assert.ok(Math.max(...Object.values(r)) - Math.min(...Object.values(r)) <= 1 || lv > 12, `${id} LV ${lv} is balanced`);
    }
  }
  assert.deepEqual(autoRanks('blaster', 18), { blaster_damage: 5, multishot: 4, firerate: 4, pierce: 4 });
  assert.deepEqual(autoRanks('blaster', 99), autoRanks('blaster', 18), 'clamped to LV 18');
});

test('CUSTOM ranks clamp to each card cap and to the LV 18 weapon cap', () => {
  assert.deepEqual(clampRanks('blaster', { multishot: 99, blaster_damage: -3 }), { blaster_damage: 0, multishot: 5, firerate: 0, pierce: 0 });
  const r = clampRanks('blaster', { blaster_damage: 11, multishot: 5, firerate: 8, pierce: 6 });
  assert.equal(sum(r), WEAPON_MAX_LEVEL - 1);
  assert.equal(entryLevel({ id: 'blaster', custom: true, ranks: r }), 18);
  assert.equal(entryLevel({ id: 'blaster', custom: false, level: 7, ranks: r }), 7, 'AUTO ignores stored ranks');
});

test('Breakthroughs: each milestone reached is TRANSFORM unless set to ACROSS THE BOARD', () => {
  assert.deepEqual(entryBreakthroughs({ id: 'grenades', level: 5 }), {});
  assert.deepEqual(entryBreakthroughs({ id: 'grenades', level: 12, bt: { 12: 'boost' } }), { 6: 'transform', 12: 'boost' });
  const b = entryBuild({ id: 'grenades', level: 18, bt: { 6: 'boost' } });
  assert.equal(b.lv, 18);
  assert.equal(b.atb, 1);
  assert.equal(b.transforms, 2);
  assert.ok(!b.t4 && b.t8 && b.t12);
});

test('sanitizeRangeConfig: junk becomes the defaults; unknown, duplicate and extra weapons are dropped', () => {
  assert.deepEqual(sanitizeRangeConfig(null), defaultRangeConfig());
  assert.deepEqual(sanitizeRangeConfig('nope'), defaultRangeConfig());
  const ids = WEAPONS.map((w) => w.id);
  const cfg = sanitizeRangeConfig({
    weapons: [{ id: 'laser' }, ...ids.map((id) => ({ id, level: 40, bt: { 6: 'boost', 12: 'bogus' }, element: id === 'rockets' ? 'shock' : 'plasma', elementRank: 9 })), { id: 'blaster' }],
    mods: { evo_emp: 5, status_potency: 3, nope: 2, shock_conductor: -1, thermite: 2 },
    dummies: { count: 999, formation: 'spiral', type: 'boss', hp: 'wave', wave: 0, move: 'ai', respawn: false }
  });
  assert.equal(cfg.weapons.length, weaponSlots());
  assert.deepEqual(cfg.weapons.map((w) => w.id), ids.slice(0, weaponSlots()));
  assert.equal(cfg.weapons[0].level, WEAPON_MAX_LEVEL);
  assert.deepEqual(cfg.weapons[0].bt, { 6: 'boost' });
  assert.equal(cfg.weapons[0].element, null, 'unknown elements are dropped');
  assert.deepEqual([cfg.weapons[1].element, cfg.weapons[1].elementRank], ['shock', 5], 'element rank clamped to 5');
  assert.deepEqual(cfg.mods, { evo_emp: 1, status_potency: 3 }, 'the old damage-type cards are gone');
  assert.deepEqual(cfg.dummies, { count: 60, formation: 'ring', type: 'swarmer', hp: 'wave', wave: 1, move: 'ai', respawn: false });
  assert.ok(RANGE_MOD_IDS.every((id) => UPGRADE_BY_ID[id]), 'every mod is a real card');
  assert.ok(!RANGE_TARGETS.some((t) => t.id === 'boss'), 'bosses are not range dummies');
});

test('range config round-trips through storage, and blocked storage falls back to the defaults', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const cfg = sanitizeRangeConfig({ weapons: [{ id: 'grenades', level: 9, element: 'frost', elementRank: 2 }], mods: { status_duration: 2 } });
  saveRangeConfig(cfg, storage);
  assert.deepEqual(loadRangeConfig(storage), cfg);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  saveRangeConfig(cfg, blocked);
  assert.deepEqual(loadRangeConfig(blocked), defaultRangeConfig());
});

test('applyRangeLoadout installs exactly the panel build: levels, ranks, Breakthroughs, allowed mods', () => {
  const p = freshPlayer();
  const cfg = sanitizeRangeConfig({
    weapons: [
      { id: 'grenades', level: 13, bt: { 12: 'boost' } },
      { id: 'blaster', custom: true, ranks: { multishot: 3, firerate: 2 }, bt: { 6: 'boost' }, element: 'fire', elementRank: 2 }
    ],
    mods: { status_potency: 2, evo_emp: 1, evo_tempest: 1, overdrive: 3 }
  });
  applyRangeLoadout(p, cfg);
  assert.deepEqual(p.loadout, ['grenades', 'blaster']);
  for (const w of cfg.weapons) {
    assert.equal(weaponLevel(p, w.id), entryLevel(w), w.id);
    assert.deepEqual(weaponBuild(p, w.id), entryBuild(w), `${w.id}: the formulas see the panel build`);
  }
  assert.equal(weaponLevel(p, 'blaster'), 8, 'CUSTOM: 1 + 5 stat ranks + 2 FIRE ranks');
  assert.deepEqual(p.breakthroughs, { grenades: { 6: 'transform', 12: 'boost' }, blaster: { 6: 'boost' } });
  assert.equal(p.weapons.blaster_fire, 2);
  assert.equal(p.upgradeLevels.status_potency, 2);
  assert.ok(!p.weapons.empGrenades, 'EMP Grenades needs Tesla Arc too');
  assert.ok(!p.weapons.stormProtocol && !p.weapons.missiles, 'Storm Protocol never installs missiles on its own');
  assert.equal(p.upgradeLevels.overdrive, 3);

  // Adding Tesla Arc unlocks EMP Grenades; rebuilding again gives the same ship (no stacking).
  cfg.weapons.push({ id: 'lightning', level: 1, custom: false, ranks: {}, bt: {} });
  applyRangeLoadout(p, cfg);
  assert.equal(p.weapons.empGrenades, 1);
  const stats = structuredClone(p.stats);
  applyRangeLoadout(p, cfg);
  assert.deepEqual(p.stats, stats);
  assert.equal(p.hp, p.maxHp);

  // An empty loadout is allowed (test one passive alone, or nothing at all).
  applyRangeLoadout(p, sanitizeRangeConfig({ weapons: [] }));
  assert.deepEqual(p.loadout, []);
});

test('Breakthrough milestones are recorded as taken and offered, so no BREAKTHROUGH screen opens', async () => {
  const { pendingBreakthroughs } = await import('../js/upgrades.js');
  const p = freshPlayer();
  applyRangeLoadout(p, sanitizeRangeConfig({ weapons: [{ id: 'missiles', level: 18 }] }));
  assert.deepEqual(p.breakthroughs.missiles, { 6: 'transform', 12: 'transform', 18: 'transform' });
  assert.deepEqual(pendingBreakthroughs(p, 'missiles'), []);
});

test('formations: the right count, a ring round the ship, a line along the aim, all inside the world', () => {
  const at = { x: 1000, y: 1000, angle: 0 };
  for (const f of ['ring', 'close', 'pack', 'line', 'scatter']) assert.equal(formationPoints(f, 12, at).length, 12, f);
  const radii = (f, n) => formationPoints(f, n, at).map((q) => Math.hypot(q.x - 1000, q.y - 1000));
  const ring = radii('ring', 8);
  assert.ok(ring.every((r) => Math.abs(r - ring[0]) < 1e-6), 'one radius');
  const close = radii('close', 12);
  assert.ok(close.every((r) => r < 130) && close[0] < ring[0], 'CLOSE sits inside Orbit Blade reach');
  const line = formationPoints('line', 5, { x: 0, y: 0, angle: Math.PI / 2 });
  assert.ok(line.every((q) => Math.abs(q.x) < 1e-9 && q.y > 0), 'straight ahead along the aim');
  assert.ok(line.every((q, i) => i === 0 || q.y > line[i - 1].y), 'stretching away from the ship');
  const pack = formationPoints('pack', 24, at);
  assert.ok(pack.every((q) => Math.hypot(q.x - 1340, q.y - 1000) < 120), 'a tight pack ahead');
  const bounds = { width: 500, height: 500, pad: 40 };
  for (const f of ['ring', 'close', 'pack', 'line', 'scatter']) {
    for (const q of formationPoints(f, 60, { x: 30, y: 30, angle: Math.PI, bounds })) {
      assert.ok(q.x >= 40 && q.x <= 460 && q.y >= 40 && q.y <= 460, `${f} clamped`);
    }
  }
  assert.equal(formationPoints('ring', 999, at).length, 60);
});

test('DPS meter: a steady stream reads its true rate; old damage leaves the window; reset clears it', () => {
  const m = new DpsMeter({ window: 5 });
  // 10 damage per tick at 60 Hz for 12 s: 600 DPS on 'blaster', plus 60 DPS of burn from second 8.
  for (let t = 0; t < 12 * 60; t++) {
    const now = t / 60;
    m.record('blaster', 10, now);
    if (now >= 8) m.record('burn', 1, now);
  }
  const now = 12;
  const r = m.rates(now);
  assert.ok(Math.abs(r.byKey.blaster - 600) / 600 < 0.03, `blaster ${r.byKey.blaster}`);
  assert.ok(Math.abs(r.byKey.burn - 60 * 4 / 5) / 48 < 0.08, `burn ramps in over the window: ${r.byKey.burn}`);
  assert.ok(Math.abs(r.total - r.byKey.blaster - r.byKey.burn) < 1e-6);
  assert.equal(m.totals.blaster, 7200);
  assert.equal(Math.round(m.total), 7200 + 240);
  assert.ok(m.buckets.length <= 21, 'old buckets are dropped');
  // Silence: the window empties.
  assert.equal(m.rates(now + 6).total, 0);
  // Right after a reset the span is the time since the reset, not the full window.
  m.reset(20);
  for (let t = 0; t < 60; t++) m.record('blaster', 10, 20 + t / 60);
  assert.ok(Math.abs(m.rates(21).byKey.blaster - 600) / 600 < 0.05, `${m.rates(21).byKey.blaster}`);
  assert.equal(m.total, 600);
  assert.equal(m.elapsed(21), 1);
  m.record('blaster', 0, 21);
  m.record('blaster', NaN, 21);
  assert.equal(m.total, 600, 'zero and junk hits are ignored');
});

test('readout: rows per damage stat in their source colours; burn ticks belong to no weapon in the compare', () => {
  const game = { elapsedTime: 2, player: { loadout: ['blaster', 'grenades'], upgradeLevels: {}, weapons: {} } };
  const range = new WeaponRange(game, { storage: null });
  range.recordHit('blaster', 'blaster', 100);
  range.recordHit('helix', 'blaster', 20);
  range.recordHit('burn', 'burn', 50);
  range.recordHit('emp', 'lightning', 30);
  const r = range.readout();
  assert.equal(r.total, 100);
  assert.deepEqual(r.rows.map((x) => x.stat), ['blaster', 'burn', 'emp', 'helix'], 'highest DPS first');
  const row = (stat) => r.rows.find((x) => x.stat === stat);
  assert.equal(row('helix').label, 'Pulsar Helix');
  assert.equal(row('helix').color, DAMAGE_SOURCE_COLORS.blaster, 'a sub-source takes its source colour');
  assert.equal(row('emp').label, 'EMP Grenades');
  assert.equal(row('emp').color, DAMAGE_SOURCE_COLORS.lightning);
  assert.equal(row('burn').color, DAMAGE_SOURCE_COLORS.burn);
  assert.deepEqual(r.weapons.map((w) => [w.id, w.live]), [['blaster', 60], ['grenades', 15]]);
  assert.equal(r.dealt, 200);
});

// A headless range run: the real Game simulation with the range active.
function rangeRun({ config = {}, seconds = 4, setup = null } = {}) {
  const g = h.createHeadlessGame();
  g.range = new WeaponRange(g, { storage: null });
  g.range.config = sanitizeRangeConfig(config);
  let packs = 0;
  g.spawnWavePack = () => { packs++; };
  const posted = [];
  g.globalBoard = { submit: (run) => { posted.push(run); return Promise.resolve({ ok: true }); } };
  g.resetRun();
  g.range.active = true;
  g.state = 'PLAYING';
  g.range.onRunStart();
  setup?.(g);
  const waveBefore = g.wave;
  for (let i = 0; i < seconds * 60; i++) g.update(1 / 60);
  return { g, range: g.range, packs, posted, waveBefore };
}

test('headless range: dummies spawn in formation, weapons fire, DPS is recorded, and no waves come', () => {
  const { g, range, packs, waveBefore } = rangeRun({
    config: { weapons: [{ id: 'blaster', level: 6 }, { id: 'grenades', level: 6 }], dummies: { count: 12, formation: 'ring', type: 'pinwheel' } },
    seconds: 5,
    setup: (game) => { game.waveTimer = 21.5; } // a wave would roll over half a second in
  });
  const em = g.enemyManager;
  assert.equal(em.enemies.length, 12, 'twelve dummies, none killed');
  assert.ok(em.enemies.every((e) => e.tag?.range && e.type === 'pinwheel' && e.maxHp === INFINITE_HP && e.hp > INFINITE_HP * 0.99), 'infinite-HP range dummies (topped up every tick)');
  assert.ok(em.enemies.every((e) => Math.hypot(e.x - e.tag.homeX, e.y - e.tag.homeY) < 60), 'stationary dummies hold their posts');
  assert.equal(packs, 0, 'no wave packs');
  assert.equal(g.wave, waveBefore, 'the wave never advances');
  assert.equal(g.pendingBossSpawns.length, 0, 'no boss scheduled');
  assert.equal(g.asteroidManager.asteroids.length, 0, 'an empty field');
  assert.equal(g.state, 'PLAYING');
  assert.equal(g.player.level, 1, 'no level-ups');
  assert.equal(g.kills, 0);

  const r = range.readout();
  assert.ok(r.total > 0 && r.dealt > 0, 'live DPS and damage since the reset');
  const blaster = r.rows.find((x) => x.stat === 'blaster');
  const grenade = r.rows.find((x) => x.stat === 'grenade');
  assert.ok(blaster?.dps > 0 && grenade?.dps > 0, `both weapons register: ${r.rows.map((x) => x.stat)}`);
  assert.equal(blaster.color, DAMAGE_SOURCE_COLORS.blaster);
  assert.equal(grenade.color, DAMAGE_SOURCE_COLORS.grenade);
  assert.deepEqual(r.weapons.map((w) => w.id), ['blaster', 'grenades']);
  assert.ok(r.weapons.every((w) => w.potential > 0 && w.level === 6), 'potential DPS per weapon');
  assert.ok(Math.abs(r.potential - r.weapons[0].potential - r.weapons[1].potential) < 1e-9);
  assert.match(readoutHtml(r), /Plasma Grenades/);
  assert.match(readoutHtml(r, { compact: true }), /DPS/);

  // RESET zeroes the totals; live config edits apply without restarting.
  range.resetMeter();
  assert.equal(range.readout().dealt, 0);
  range.setConfig({ ...range.config, weapons: [{ id: 'lightning', level: 3 }] });
  assert.deepEqual(g.player.loadout, ['lightning']);
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  assert.ok(range.readout().rows.some((x) => x.stat === 'lightning'), 'the new weapon fires at once');
});

test('headless range: wave-HP dummies die, drop nothing and respawn; AI dummies never hurt the ship', () => {
  const { g, range, posted } = rangeRun({
    config: { weapons: [{ id: 'blaster', level: 12 }, { id: 'orbitals', level: 8 }], mods: { shrapnel: 3 }, dummies: { count: 6, formation: 'pack', type: 'swarmer', hp: 'wave', wave: 1, move: 'ai' } },
    seconds: 6
  });
  assert.ok(g.kills > 0, 'kills happen');
  assert.equal(g.geoms.length, 0, 'no XP or cores dropped');
  assert.equal(g.chests.length, 0, 'no caches');
  assert.equal(g.score, 0, 'no score');
  assert.equal(g.player.xp, 0);
  assert.equal(g.player.hp, g.player.maxHp, 'the ship is never hurt');
  const em = g.enemyManager;
  assert.ok(g.kills > 6, `killed dummies respawn and die again: ${g.kills} kills`);
  assert.equal(em.enemies.length + em.spawnIndicators.length + range.respawns.length, 6, 'the field keeps its six dummies');
  assert.ok(em.enemies.every((e) => e.maxHp < 1000), 'wave 1 HP');

  // Nothing from a range run reaches the boards or the stats upload, even on a forced game over.
  let uploaded = 0;
  g.submitRunStats = function (s) { uploaded++; return Object.getPrototypeOf(this).submitRunStats.call(this, s); };
  g.returnToTitle = () => { g.state = 'TITLE'; };
  g.triggerGameOver();
  assert.equal(g.state, 'TITLE');
  assert.equal(range.active, false);
  assert.equal(posted.length, 0);
  assert.equal(uploaded, 0);
});

test('headless range: switching dummies to infinite HP and back applies live', () => {
  const { g, range } = rangeRun({ config: { weapons: [], dummies: { count: 3, type: 'bruiser', hp: 'wave', wave: 10 } }, seconds: 1 });
  const em = g.enemyManager;
  const waveHp = em.enemies[0].maxHp;
  assert.ok(waveHp > 100 && waveHp < INFINITE_HP);
  range.setConfig({ ...range.config, dummies: { ...range.config.dummies, hp: 'infinite' } });
  assert.ok(em.enemies.every((e) => e.hp === INFINITE_HP));
  range.setConfig({ ...range.config, dummies: { ...range.config.dummies, hp: 'wave', wave: 20 } });
  assert.ok(em.enemies.every((e) => e.maxHp > waveHp && e.hp === e.maxHp), 'wave 20 HP');
  range.setConfig({ ...range.config, dummies: { ...range.config.dummies, move: 'ai' } });
  assert.ok(em.enemies.every((e) => e.speed > 0), 'normal AI moves again');
  range.clearDummies();
  assert.equal(em.enemies.length, 0);
});
