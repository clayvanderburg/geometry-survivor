import test from 'node:test';
import assert from 'node:assert/strict';

// GLOBAL CARDS (v0.46, Vampire Survivors-style passives): Tempo Core, Cooldown Matrix, Persistence Field and
// Velocity Coils reach every equipped weapon with the stat, at about half a weapon card's step, priced on the
// potential-DPS model against one weapon card with 2 / 4 / 6 weapons. Also the v0.46 splits: Geom Attractor
// (radius) / Growth Lattice (XP) / a rare Supernova bomb drop, and Phase Nova Thrusters (nova only; the dash
// cooldown is Cooldown Matrix's).
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };
const { TUNING } = await import('../js/config.js');
const U = await import('../js/upgrades.js');
const {
  STAT_CARDS, GLOBAL_CARDS, GLOBAL_MAX_RANKS, PERSIST_WEAPONS, VELOCITY_WEAPONS, AREA_WEAPONS, weaponBuild, levelBuild, makeBuild
} = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W, POTENTIAL_DPS, RATE_STEP, dashCooldownFor, projectileSpeedMult } = await import('../js/weapon-scaling.js');
const { WEAPON_BY_ID } = await import('../js/loadout.js');
const { describeUpgrade, cardScope } = await import('../js/upgrade-cards.js');
const { Game, BOMB_DROP } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');

const byId = (id) => U.UPGRADE_BY_ID[id];
const install = (p, id, levelJump = 1) => U.applyUpgradeLevels(p, { ...byId(id), levelJump });
function player(weapons = []) {
  const p = U.runStartPlayer();
  Object.assign(p, { upgradeLevels: {}, weapons: {}, loadout: [], breakthroughs: {}, level: 1 });
  for (const id of weapons) install(p, WEAPON_BY_ID[id].levelId);
  return p;
}
const RATE = ['rate', 'reload', 'recharge', 'cooldown'];
const COUNT = ['count', 'salvo', 'prism', 'wingmen', 'chain', 'duration', 'nozzles'];
const find = (w, stats) => STAT_CARDS[w].find((c) => stats.includes(c.stat));
// A mid-run build: every weapon at Damage x3, its rate card x2 and its count card x1 (LV 7).
function midRun(weapons) {
  const p = player();
  for (const w of weapons) {
    install(p, WEAPON_BY_ID[w].levelId);
    install(p, find(w, ['damage']).id, 3);
    if (find(w, RATE)) install(p, find(w, RATE).id, 2);
    if (find(w, COUNT)) install(p, find(w, COUNT).id, 1);
  }
  return p;
}
const dps = (p) => p.loadout.reduce((a, w) => a + POTENTIAL_DPS[w](weaponBuild(p, w)), 0);
const LOADOUTS = {
  2: ['blaster', 'rockets'],
  4: ['blaster', 'rockets', 'grenades', 'singularity'],
  6: ['blaster', 'rockets', 'grenades', 'singularity', 'drones', 'turret'],
  '6 (sprayers & clouds)': ['flamethrower', 'missiles', 'lightning', 'nanites', 'gas', 'glaive']
};
const POWER_GLOBALS = ['tempo', 'cooldown', 'persistence'];

test('global cards: five ranks, GLOBAL scope, POWER or UTILITY, a step about half a weapon card\'s', () => {
  for (const [kind, def] of Object.entries(GLOBAL_CARDS)) {
    const c = byId(def.id);
    assert.ok(c, kind);
    assert.equal(c.maxLevel, GLOBAL_MAX_RANKS);
    assert.equal(c.globalCard, kind);
    assert.equal(cardScope(c), 'global', `${kind} shows the GLOBAL outline`);
    assert.equal(c.category, POWER_GLOBALS.includes(kind) ? 'POWER' : 'UTILITY', kind);
    assert.ok(c.summary.length <= 110, `${kind} summary stays short`);
    if (kind !== 'persistence' && kind !== 'velocity') assert.ok(def.step <= RATE_STEP / 2 + 1e-9, `${kind}: at most half a Rate card's +${RATE_STEP * 100}%`);
    assert.equal(U.upgradeKind(c), 'general');
    // As often as Reactor Overdrive: the weapon-share guard (upgrades.js handWeights) protects weapon progression.
    assert.equal(U.cardWeight(c), U.cardWeight(byId('overdrive')) * (TUNING.globalCardWeight ?? 1), `${kind}: weighted like Overdrive`);
  }
  const area = byId('tag_area');
  assert.equal(area.globalCard, 'area');
  assert.equal(cardScope(area), 'global', 'Field Amplifier is the global AREA card');
  assert.equal(area.category, 'UTILITY');
  assert.equal(U.cardWeight(area), TUNING.globalCardWeight ?? 1, 'weighted like the other global cards');
});

test('Tempo reaches every Rate card and Cooldown every reload / recharge / cooldown: together they reach every weapon but the passive-free ones', () => {
  const tempo = Object.keys(STAT_CARDS).filter((w) => STAT_CARDS[w].some((c) => c.stat === 'rate'));
  const cooldown = Object.keys(STAT_CARDS).filter((w) => STAT_CARDS[w].some((c) => ['reload', 'recharge', 'cooldown'].includes(c.stat)));
  const p = player(Object.keys(STAT_CARDS).slice(0, 6));
  assert.deepEqual(U.globalReach(p, 'tempo'), p.loadout.filter((w) => tempo.includes(w)));
  // Every weapon with a rate-like card is reached by one of the two.
  for (const w of Object.keys(STAT_CARDS)) {
    if (STAT_CARDS[w].some((c) => RATE.includes(c.stat))) assert.ok(tempo.includes(w) || cooldown.includes(w), w);
  }
  // One rank speeds each reached weapon by exactly its step (the weapon's own ranks untouched).
  for (const w of Object.keys(STAT_CARDS)) {
    const q = midRun([w]);
    const before = POTENTIAL_DPS[w](weaponBuild(q, w));
    const r0 = JSON.stringify(weaponBuild(q, w).r);
    install(q, 'tempo_core');
    install(q, 'cooldown_matrix');
    assert.equal(JSON.stringify(weaponBuild(q, w).r), r0, `${w}: no ranks change`);
    const after = POTENTIAL_DPS[w](weaponBuild(q, w));
    const want = (tempo.includes(w) ? 1 + GLOBAL_CARDS.tempo.step : 1) * (cooldown.includes(w) ? 1 + GLOBAL_CARDS.cooldown.step : 1);
    if (w === 'turret') assert.ok(after / before > want - 0.01, `${w} (turrets out are capped)`);
    else if (want === 1) assert.ok(Math.abs(after / before - 1) < 1e-9, `${w} untouched`);
    else assert.ok(Math.abs(after / before - want) < 0.02, `${w}: x${(after / before).toFixed(3)} (want x${want.toFixed(3)})`);
  }
});

test('bare builds carry no globals: LV 1 solves, class targets and the weapon-balance tables never move', () => {
  const p = midRun(['blaster', 'rockets']);
  const bare = { blaster: POTENTIAL_DPS.blaster(levelBuild('blaster', 1)), rockets: POTENTIAL_DPS.rockets(levelBuild('rockets', 1)) };
  for (const id of ['tempo_core', 'cooldown_matrix', 'persistence_field']) install(p, id, 5);
  assert.equal(POTENTIAL_DPS.blaster(levelBuild('blaster', 1)), bare.blaster);
  assert.equal(POTENTIAL_DPS.rockets(levelBuild('rockets', 1)), bare.rockets);
  assert.deepEqual(makeBuild('rockets', 3).g, { tempo: 1, cooldown: 1, persistence: 1 });
});

test('pricing: one rank of a POWER global is worth a pick but less than one weapon card, with 2, 4 or 6 weapons', () => {
  for (const [n, weapons] of Object.entries(LOADOUTS)) {
    const base = dps(midRun(weapons));
    // One weapon card: the best of its Damage / rate / count card, averaged over the weapons (whole-build gain).
    let card = 0;
    for (const w of weapons) {
      card += Math.max(...[['damage'], RATE, COUNT].map((s) => {
        const c = find(w, s);
        if (!c) return 0;
        const q = midRun(weapons);
        install(q, c.id);
        return dps(q) / base - 1;
      }));
    }
    card /= weapons.length;
    const overdrive = 0.12;
    for (const kind of POWER_GLOBALS) {
      const q = midRun(weapons);
      install(q, GLOBAL_CARDS[kind].id);
      const gain = dps(q) / base - 1;
      assert.ok(gain < card, `${n} weapons: ${kind} +${(gain * 100).toFixed(1)}% vs a weapon card +${(card * 100).toFixed(1)}%`);
      assert.ok(gain < overdrive, `${n} weapons: ${kind} under Reactor Overdrive's +12%`);
      if (U.globalReach(q, kind).length >= 2) assert.ok(gain > 0.01, `${n} weapons: ${kind} +${(gain * 100).toFixed(1)}% is worth a pick`);
    }
  }
});

test('Persistence lengthens singularities, swarms, gas clouds, turrets and armed mines (POWER where uptime is DPS)', () => {
  const p = player(PERSIST_WEAPONS);
  const life = {
    singularity: (b) => W.singularityLife(b), nanites: (b) => W.naniteLife(b), gas: (b) => W.gasLife(b),
    turret: (b) => W.turretDuration(b), mines: (b) => W.mineLifetime(b)
  };
  const before = Object.fromEntries(PERSIST_WEAPONS.map((w) => [w, life[w](weaponBuild(p, w))]));
  const dpsBefore = Object.fromEntries(PERSIST_WEAPONS.map((w) => [w, POTENTIAL_DPS[w](weaponBuild(p, w))]));
  install(p, 'persistence_field', 2);
  const step = 1 + 2 * GLOBAL_CARDS.persistence.step;
  for (const w of PERSIST_WEAPONS) assert.ok(Math.abs(life[w](weaponBuild(p, w)) / before[w] - step) < 1e-9, w);
  for (const w of ['singularity', 'nanites', 'turret']) assert.ok(POTENTIAL_DPS[w](weaponBuild(p, w)) > dpsBefore[w] * 1.05, `${w}: a longer life is more damage`);
  assert.equal(byId('persistence_field').overcharge, false);
});

test('Velocity speeds every flying shot, and shots with a lifetime keep the same reach', () => {
  const p = player(VELOCITY_WEAPONS);
  install(p, 'velocity_coils', 2);
  const v = 1 + 2 * GLOBAL_CARDS.velocity.step;
  assert.ok(Math.abs(projectileSpeedMult(p) - v) < 1e-9);
  const g = Object.assign(Object.create(Game.prototype), {
    player: Object.assign(p, { x: 2000, y: 2000, angle: 0, hullAngle: 0, radius: 15 }),
    bullets: [], missiles: [], enemyManager: new EnemyManager(), sound: new Proxy({}, { get: () => () => {} }),
    grid: new Proxy({}, { get: () => () => {} }), particles: new Proxy({}, { get: () => () => {} }), helixAngle: 0
  });
  g.firePrimaryWeapon();
  const bolt = g.bullets[0];
  assert.ok(Math.abs(Math.hypot(bolt.vx, bolt.vy) - p.stats.bulletSpeed * v) < 1e-9, 'faster bolts');
  assert.ok(Math.abs(Math.hypot(bolt.vx, bolt.vy) * bolt.life - p.stats.bulletSpeed * 1.25) < 1e-9, 'same reach');
  const card = describeUpgrade(p, { ...byId('velocity_coils'), levelJump: 1 });
  assert.equal(card.headline, '+15% SHOT SPEED', 'no weapon count: the scope chip says EVERY SHOT WEAPON');
  for (const id of ['blasterShotSpeed', 'rocketsShotSpeed', 'missilesShotSpeed', 'grenadeLob', 'glaiveSpeed']) assert.ok(card.rows.some((r) => r.id === id) || card.hiddenRows > 0, id);
});

test('card headlines name the step and the reach; preview rows show each weapon\'s change', () => {
  const p = player(['blaster', 'rockets', 'singularity']);
  const tempo = describeUpgrade(p, { ...byId('tempo_core'), levelJump: 1 });
  assert.equal(tempo.headline, '+8% ATTACK RATE');
  assert.ok(tempo.rows.some((r) => r.id === 'fireRate'), 'Autocannon fire rate row');
  const cd = describeUpgrade(p, { ...byId('cooldown_matrix'), levelJump: 1 });
  assert.equal(cd.headline, '+10% RECHARGE + DASH');
  for (const id of ['rocketCooldown', 'singularityCooldown', 'dashCooldown']) assert.ok(cd.rows.some((r) => r.id === id), id);
  const persist = describeUpgrade(p, { ...byId('persistence_field'), levelJump: 2 });
  assert.equal(persist.headline, '+30% LIFETIME');
  assert.ok(persist.rows.some((r) => r.id === 'singularityLife'));
  // Offered only while something equipped takes it (Cooldown always: the dash).
  const bare = player(['raillance']);
  const ids = U.eligibleUpgrades(bare).map((u) => u.id);
  assert.ok(ids.includes('tempo_core') && ids.includes('cooldown_matrix'));
  assert.ok(!ids.includes('persistence_field') && !ids.includes('velocity_coils'), 'nothing lingers or flies');
});

test('Phase Nova Thrusters is the shockwave only; the dash cooldown is Cooldown Matrix\'s', () => {
  const p = player(['blaster']);
  const base = dashCooldownFor(p);
  install(p, 'thrusters', 3);
  assert.equal(dashCooldownFor(p), base, 'Thrusters no longer touches the cooldown');
  install(p, 'cooldown_matrix', 5);
  assert.ok(Math.abs(dashCooldownFor(p) - base / (1 + 5 * GLOBAL_CARDS.cooldown.step)) < 1e-9);
  assert.ok(AREA_WEAPONS.every((w) => STAT_CARDS[w]), 'area list names real weapons');
});

test('Supernova bombs are a rare drop: lieutenants, void wells and hulks drop a gold pickup worth +1 bomb', () => {
  assert.ok(BOMB_DROP.lieutenant > BOMB_DROP.blackhole && BOMB_DROP.blackhole > BOMB_DROP.hulk && BOMB_DROP.hulk > 0);
  const silent = new Proxy({}, { get: () => () => {} });
  const game = Object.assign(Object.create(Game.prototype), {
    enemyManager: new EnemyManager(),
    asteroidManager: { asteroids: [], isDrilling: false, drillingRocks: [], cellSize: 140, getNearbyAsteroids() { return []; }, update() {} },
    player: { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15, angle: 0, hp: 100, maxHp: 100, invuln: 1e9, dashTimer: 0, dashCooldown: 0, xp: 0, xpToNext: 1e9, level: 1, bombs: 2,
      stats: { moveSpeed: TUNING.moveSpeed, luck: 1, xpMultiplier: 1, magnetRadius: 145, damage: 11, coreDropMult: 1, fireRate: 0 }, weapons: {}, upgradeLevels: {} },
    grid: silent, particles: silent, sound: silent, progression: { addCores() {} },
    state: 'PLAYING', pendingBossSpawns: [], wave: 1, waveTimer: 0, elapsedTime: 0, sessionCores: 0, multiplier: 1, spawnCooldown: 1e9,
    camX: 0, camY: 0, worldWidth: 4200, worldHeight: 4200, width: 1280, height: 720, kills: 0, score: 0, coresDroppedThisWave: 0, shake: 0,
    keys: {}, mouse: { x: 640, y: 360, down: false }, autoFire: false, autoAim: false,
    bullets: [], missiles: [], singularities: [], chests: [], geoms: [], singularityTimer: 1e9,
    showBanner() {}, updateHUD() {}, pollGamepad() { return null; }, spawnAroundPlayer() { return { x: 3000, y: 3000 }; }, spawnRelicChest() {}
  });
  const rnd = Math.random;
  try {
    Math.random = () => 0.001;
    const hulk = { x: 2600, y: 2000, type: 'hulk', score: 10, xp: 4, radius: 20, hp: 0, maxHp: 50 };
    game.enemyManager.enemies.push(hulk);
    game.killEnemy(hulk);
  } finally {
    Math.random = rnd;
  }
  const bomb = game.geoms.find((g) => g.isBomb);
  assert.ok(bomb, 'a bomb pickup dropped');
  game.geoms = [bomb];
  bomb.x = 2010; bomb.y = 2000;
  for (let t = 0; t < 30; t++) game.update(1 / 60);
  assert.equal(game.player.bombs, 3, 'collected: +1 bomb');
  assert.equal(game.geoms.length, 0);
});

// Replicator Array is a deliberate jackpot (Clay: "really powerful" and rare), the one intentional exception
// to the global card rule (one rank under one weapon card and under Overdrive). On the card bench
// (tools/balance/card-bench.mjs, blend, 16 seeds) one rank adds +27% / +16-19% / +15-18% / +23-25% to a 2 / 4 / 6 /
// sprayer-and-cloud build, 2-4x one weapon card (+15 / +5-8 / +4-5 / +6%) and Overdrive. It stays rare instead:
// 2 ranks, hand weight 0.25 (about 2% of hands), at least RARE. Don't "fix" its power without asking Clay.
test('Replicator Array: the deliberate jackpot exception, kept rare (2 ranks, weight 0.25)', async () => {
  const { REPLICATOR_ID, REPLICATOR_MAX_RANKS } = await import('../js/weapon-levels.js');
  assert.equal(REPLICATOR_MAX_RANKS, 2);
  assert.equal(TUNING.replicatorWeight, 0.25);
  assert.equal(byId(REPLICATOR_ID).maxLevel, REPLICATOR_MAX_RANKS);
});
