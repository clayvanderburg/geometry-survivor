import test from 'node:test';
import assert from 'node:assert/strict';
import { levelBuild } from '../js/weapon-levels.js';

// Crits, weapon tags and element statuses (BURN / COLD / CORRODE / SHOCK conduction; the SHOCK stun has its own file). Browser services are stubbed;
// the game fixtures run the production hitEnemy / status / firing code.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
globalThis.document = { getElementById: element, createElement: element };

const { Game } = await import('../js/main.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { DamageNumbers, CRIT_COLOR } = await import('../js/damage-numbers.js');
const { EnemyManager } = await import('../js/enemies.js');
const { UPGRADE_POOL, applyUpgradeLevels, loadoutAllows } = await import('../js/upgrades.js');
const { STAT_ROWS, describeUpgrade, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const { WEAPON_SCALING: W, WEAPON_TAGS, TAG_INFO, weaponDamage, critMultiplier } = await import('../js/weapon-scaling.js');
const { updateStatusEffects, damageTakenMult, isAfflicted, shockCritBonus } = await import('../js/status-effects.js');

const silent = new Proxy({}, { get: () => () => {} });
const byId = (id) => UPGRADE_POOL.find((u) => u.id === id);
const row = (id) => STAT_ROWS.find((r) => r.id === id);
const DT = 1 / 60;

function makePlayer() {
  return {
    x: 2000, y: 2000, vx: 0, vy: 0, angle: 0, radius: 15, hp: 100, maxHp: 100, bombs: 2, upgradeLevels: {},
    stats: {
      moveSpeed: 5, fireRate: 6.5, bulletSpeed: 14, bulletCount: 2, spreadAngle: 0.14, pierce: 1, damage: 10,
      magnetRadius: 145, xpMultiplier: 1, luck: 1, coreDropMult: 1, miningSpeed: 75, miningRange: 43, drillScale: 1.15,
      critChance: 0.05, critDamage: 1.5, tagDamage: { kinetic: 1, explosive: 1, electric: 1 }, areaMult: 1
    },
    weapons: { missiles: 0, orbitals: 0, lightning: 0, singularity: 0, shrapnel: 0, dashNova: 0, pulsarHelix: 0, stormProtocol: 0, tectonicBore: 0, supercritical: 0 }
  };
}

const enemy = (extra = {}) => ({
  type: 'pinwheel', x: 2100, y: 2000, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, speed: 2, radius: 15, hue: 272,
  score: 1, xp: 1, sides: 4, rotation: 0, vRot: 0, pulsePhase: 0, hitFlash: 0, knockX: 0, knockY: 0, trail: [], ...extra
});

function game(enemies = [], player = makePlayer()) {
  const crits = [];
  return Object.assign(Object.create(Game.prototype), {
    enemyManager: { enemies, queueSpawn() {} },
    sound: silent, grid: silent, damageNumbers: new DamageNumbers(),
    particles: new Proxy({ spawnCritFlare: (x, y, size) => crits.push({ x, y, size }) }, { get: (t, k) => t[k] ?? (() => {}) }),
    crits, player, state: 'PLAYING', worldWidth: 4200, worldHeight: 4200, wave: 1, shake: 0, chromaFlash: 0,
    hitStopTicks: 0, kills: 0, chests: [], bullets: [], missiles: [], singularities: [], geoms: [],
    score: 0, multiplier: 1, coresDroppedThisWave: 0, updateHUD() {}, progression: { addCores() {} }
  });
}

function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

const reset = () => Object.assign(TUNING, DEFAULT_TUNING);

test('crits multiply damage, print a gold "!" number with a burst, and flare on the hull', () => {
  reset();
  const e = enemy();
  const g = game([e]);
  withRandom(0, () => g.hitEnemy(e, 20, 'blaster'));
  assert.equal(e.hp, 1e6 - 30, 'base 1.5x crit');
  assert.equal(g.crits.length, 1);
  const n = g.damageNumbers.pool[0];
  assert.equal(n.crit, true);
  assert.equal(n.text, '30', 'crits read by size and colour, with no "!"');
  assert.ok(n.size > 20, 'crits print bigger than a plain 30');
  assert.equal(CRIT_COLOR, '#ffd84a');

  // A roll above the crit chance is a plain hit, aggregated separately from the crit.
  withRandom(0.99, () => g.hitEnemy(e, 20, 'blaster'));
  assert.equal(e.hp, 1e6 - 50);
  assert.equal(g.damageNumbers.count, 2);
  assert.equal(g.damageNumbers.pool[1].text, '20');

  // Every weapon source can crit through hitEnemy.
  for (const source of ['missile', 'lightning', 'orbital', 'singularity', 'other']) {
    const t = enemy();
    withRandom(0, () => game([t]).hitEnemy(t, 10, source));
    assert.equal(t.hp, 1e6 - 15, source);
  }
});

test('players without crit stats never crit, and burn ticks never crit', () => {
  reset();
  const e = enemy();
  const p = makePlayer();
  delete p.stats.critChance;
  withRandom(0, () => game([e], p).hitEnemy(e, 10, 'blaster'));
  assert.equal(e.hp, 1e6 - 10);

  const b = enemy();
  const g = game([b]);
  withRandom(0, () => g.hitEnemy(b, 10, 'burn'));
  assert.equal(b.hp, 1e6 - 10);
  assert.equal(g.crits.length, 0);
});

test('crit cards and the Supercritical synergy preview the exact multipliers hitEnemy uses', () => {
  reset();
  const p = makePlayer();
  assert.equal(describeUpgrade(p, byId('crit_chance')).headline, '+5% CRIT CHANCE');
  assert.equal(describeUpgrade(p, byId('crit_damage')).headline, '+25% CRIT DAMAGE');
  applyUpgradeLevels(p, { ...byId('crit_chance'), levelJump: 2 });
  applyUpgradeLevels(p, byId('crit_damage'));
  assert.equal(p.stats.critChance.toFixed(2), '0.15');
  assert.equal(p.stats.critDamage, 1.75);

  // Supercritical needs crit chance LV 2 and a weapon with an element.
  const syn = byId('evo_supercrit');
  assert.equal(syn.req(p), false);
  applyUpgradeLevels(p, byId('blaster_fire'));
  assert.equal(syn.req(p), true);
  const card = describeUpgrade(p, syn);
  assert.equal(card.rarity, 'evolution');
  assert.equal(card.headline, `AFFLICTED CRITS // ${(1 + 0.75 * W.supercritBonusMult).toFixed(2)}x`);
  applyUpgradeLevels(p, syn);

  // Against an afflicted target the crit bonus is multiplied; elsewhere it is the plain crit.
  const burning = enemy();
  const clean = enemy({ x: 2400 });
  const g = game([burning, clean], p);
  withRandom(0.99, () => g.hitEnemy(burning, 10, 'blaster')); // ignites (no crit)
  assert.ok(isAfflicted(burning));
  const hpBefore = burning.hp;
  withRandom(0, () => g.hitEnemy(burning, 10, 'orbital'));
  assert.equal(hpBefore - burning.hp, 10 * critMultiplier(p, true));
  withRandom(0, () => g.hitEnemy(clean, 10, 'orbital'));
  assert.equal(1e6 - clean.hp, 10 * 1.75);
});

test('BURN: stacks follow the hit, tick every half second, lose a fifth each tick, and deal the previewed share of the hit', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('blaster_fire'));
  const e = enemy();
  const g = game([e], p);
  withRandom(0.99, () => g.hitEnemy(e, 1000, 'blaster'));
  assert.ok(Math.abs(e.st.burn - 1000 / p.stats.damage * W.stacksPerDamage) < 1e-9, 'stacks per base damage dealt');
  const share = row('blaster:burn').get(p);
  assert.ok(Math.abs(share - W.stacksPerDamage * W.burnPerStack / W.statusDecay) < 1e-12, `burn share ${share}`);

  const hp = e.hp;
  let ticks = 0;
  const original = g.hitEnemy;
  g.hitEnemy = function (...args) { if (args[2] === 'burn') ticks++; return original.apply(this, args); };
  for (let t = 0; t < 29; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(ticks, 0, 'first tick waits a full interval');
  withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(ticks, 1);
  assert.ok(Math.abs(e.st.burn - 1000 / p.stats.damage * W.stacksPerDamage * (1 - W.statusDecay)) < 1e-6, 'a fifth wore off');
  for (let t = 0; t < 60 * 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(e.st.burn, 0, 'burnt out');
  assert.ok(Math.abs((hp - e.hp) / (1000 * share) - 1) < 0.01, `total burn ${(hp - e.hp).toFixed(1)} ~ ${(1000 * share).toFixed(1)}`);
  // Burn ticks print in the burn colour.
  assert.ok(g.damageNumbers.pool.slice(0, g.damageNumbers.count).some((n) => n.source === 'burn' && !n.crit));
});

test('burn ticks merge into one rising total instead of a new number every half second', () => {
  reset();
  const dn = new DamageNumbers();
  const e = enemy();
  const first = dn.add(e, 5, 'burn');
  for (let t = 0; t < 30; t++) dn.update(DT);
  const second = dn.add(e, 5, 'burn');
  assert.equal(first, second);
  assert.equal(second.text, '10');
  // Ordinary hits keep the short merge window.
  dn.add(e, 5, 'blaster');
  for (let t = 0; t < 30; t++) dn.update(DT);
  assert.notEqual(dn.add(e, 5, 'blaster').text, '10');
});

test('BURN can kill, and a burning enemy dying mid-sweep is never ticked twice', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('blaster_fire'));
  const enemies = [enemy({ hp: 46, x: 1000 }), enemy({ hp: 46, x: 1400 }), enemy({ x: 1800 })];
  const g = game(enemies, p);
  for (const e of [...enemies]) withRandom(0.99, () => g.hitEnemy(e, 45, 'blaster'));
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(g.enemyManager.enemies.length, 1);
  assert.equal(g.kills, 2);
});

test('BURN spreads: a burning enemy can set the one beside it alight with half its stacks, never one far away', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('blaster_fire'));
  const lit = enemy({ x: 2000 });
  const beside = enemy({ x: 2000 + 15 + 15 + 20 });
  const far = enemy({ x: 2400 });
  const g = game([lit, beside, far], p);
  withRandom(0.99, () => g.hitEnemy(lit, 200, 'blaster'));
  const stacks = lit.st.burn;
  for (let t = 0; t < 30; t++) withRandom(0, () => updateStatusEffects(g, DT)); // spread roll always passes
  assert.ok(Math.abs(beside.st.burn - stacks * W.burnSpreadShare) < 1e-6, 'half the stacks, before the tick wore any off');
  assert.equal(beside.st.burnStat, 'burn_blaster', 'credited to the weapon that lit the first one');
  assert.equal(far.st, undefined);
  const cold = enemy({ x: 2050 });
  const h = game([enemy({ x: 2000 }), cold], p);
  withRandom(0.99, () => h.hitEnemy(h.enemyManager.enemies[0], 200, 'blaster'));
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(h, DT)); // roll fails
  assert.equal(cold.st, undefined, 'no spread on a failed roll');
});

test('COLD slows as it builds, then FREEZES solid: held still, +25% damage taken, then thaws and is immune for a while', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('missiles'));
  applyUpgradeLevels(p, byId('missiles_frost'));
  const card = describeUpgrade(p, byId('missiles_frost'));
  assert.equal(card.headline, '+5% CHILL SLOW');

  const manager = new EnemyManager();
  const e = enemy({ vx: 2, speed: 2, hp: 1000, maxHp: 1000 });
  const boss = enemy({ isBoss: true, type: 'boss', x: 2200, speed: 2, vx: 2, hp: 1000, maxHp: 1000 });
  manager.enemies = [e, boss];
  const g = game(manager.enemies, p);
  g.enemyManager = manager;
  // Cold worth 10% of the hull: a third of the way to its freeze threshold.
  const threshold = W.freezeHpShare * (1000 / p.stats.damage) * W.stacksPerDamage;
  withRandom(0.99, () => g.hitEnemy(e, 100, 'missile'));
  withRandom(0.99, () => g.hitEnemy(boss, 100, 'missile'));
  assert.ok(Math.abs(e.st.coldMax - threshold) < 1e-9);
  assert.ok(Math.abs(boss.st.coldMax - threshold * W.freezeResistBoss) < 1e-9, 'bosses need more cold');
  const slow = W.chillSlow(1) * (1 / 3);
  assert.ok(Math.abs(e.speedScale - (1 - slow)) < 1e-9, `slowed ${e.speedScale}`);
  assert.ok(boss.speedScale > e.speedScale, 'bosses resist the slow');
  assert.equal(row('missiles:chill').get(p), W.chillSlow(1));

  manager.update(DT, { x: 9999, y: 2000 }, [], silent, silent, 4200, 4200);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 2 * (1 - slow)) < 1e-9, 'speed capped by the chill');

  // Past the threshold the next tick freezes it.
  withRandom(0.99, () => g.hitEnemy(e, 300, 'missile'));
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.ok(e.st.frozenT > 0 && isAfflicted(e), 'frozen');
  assert.equal(e.speedScale, 0);
  const hp = e.hp;
  withRandom(0.99, () => g.hitEnemy(e, 10, 'orbital'));
  assert.ok(Math.abs(hp - e.hp - 10 * (1 + W.frozenDamageTaken)) < 1e-9, 'frozen hulls take more damage');
  const x = e.x;
  for (let t = 0; t < 30; t++) manager.update(DT, { x: 9999, y: 2000 }, [], silent, silent, 4200, 4200);
  assert.ok(Math.abs(e.x - x) < 0.5, 'a frozen enemy holds still');
  for (let t = 0; t < Math.ceil(W.freezeDuration(1) * 60) + 1; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(e.st.frozenT, 0, 'thawed');
  assert.equal(e.st.cold, 0, 'the cold is spent');
  assert.equal(e.speedScale, 1);
  assert.ok(e.st.freezeImmT > 0, 'immune for a while');
  withRandom(0.99, () => g.hitEnemy(e, 400, 'missile'));
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.equal(e.st.frozenT, 0, 'no refreeze while immune');
});

test('CORRODE: acid ticks, and every stack amplifies every source (DoTs included) up to the rank cap', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('rockets'));
  applyUpgradeLevels(p, byId('rockets_corrode'));
  const e = enemy();
  const g = game([e], p);
  withRandom(0.99, () => g.hitEnemy(e, 20, 'rocket'));
  const stacks = e.st.corrode;
  assert.ok(Math.abs(damageTakenMult(e) - (1 + stacks * W.corrodeVulnPerStack)) < 1e-12);
  for (let i = 0; i < 50; i++) withRandom(0.99, () => g.hitEnemy(e, 100, 'rocket'));
  const amp = 1 + W.corrodeCap(1);
  assert.ok(Math.abs(damageTakenMult(e) - amp) < 1e-12, 'capped');
  assert.ok(Math.abs(row('rockets:corrodeMax').get(p) - (amp - 1)) < 1e-12);

  const hp = e.hp;
  withRandom(0.99, () => g.hitEnemy(e, 10, 'orbital'));
  assert.ok(Math.abs(hp - e.hp - 10 * amp) < 1e-9);
  const hp2 = e.hp;
  g.hitEnemy(e, 10, 'burn');
  assert.ok(Math.abs(hp2 - e.hp - 10 * amp) < 1e-9);

  let acid = 0;
  const original = g.hitEnemy;
  g.hitEnemy = function (...args) { if (args[2] === 'corrode') acid++; return original.apply(this, args); };
  for (let t = 0; t < 60 * 30; t++) updateStatusEffects(g, DT);
  assert.ok(acid > 5, 'acid ticks');
  assert.equal(damageTakenMult(e), 1, 'and wears off');
});

test('SHOCK conducts between touching enemies: charge and zaps spread down a packed line, a lone hull takes no shock damage', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, byId('lightning')); // Tesla Arc is always SHOCK (no element card)
  const touch = 15 + 15 + 3;
  const a = enemy({ x: 2000 }), b = enemy({ x: 2000 + touch }), c = enemy({ x: 2000 + 2 * touch });
  const lone = enemy({ x: 3000 });
  const g = game([a, b, c, lone], p);
  withRandom(0.99, () => { g.hitEnemy(a, 200, 'lightning'); g.hitEnemy(lone, 200, 'lightning'); });
  assert.ok(a.st.shock > 0 && a.st.stunT > 0, 'a hit zaps and charges');
  assert.ok(Math.abs(shockCritBonus(a) - Math.min(W.shockCritCap, a.st.shock * W.shockCritPerStack)) < 1e-12, 'shocked targets are easier to crit');
  let shockHits = [];
  const original = g.hitEnemy;
  g.hitEnemy = function (...args) { if (args[2] === 'shock') shockHits.push(args[0]); return original.apply(this, args); };
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.ok(b.st && b.st.shock > 0, 'conducts into the touching hull');
  assert.ok(b.st.stunT > 0 || b.st.stunImmT > 0, 'and zaps it');
  assert.ok(shockHits.includes(a), 'the touching hull takes shock damage');
  assert.ok(!shockHits.includes(lone), 'a lone hull does not');
  for (let t = 0; t < 30; t++) withRandom(0.99, () => updateStatusEffects(g, DT));
  assert.ok(c.st && c.st.shock > 0, 'and on down the line');
});

test('vortexes take statuses like any enemy; only invulnerable hulls are immune', () => {
  reset();
  const p = makePlayer();
  p.weapons.blaster_fire = 1; p.weapons.missiles_frost = 1; p.weapons.lightning = 1; // Tesla Arc: always SHOCK
  const vortex = enemy({ type: 'blackhole', hp: 1e6, maxHp: 1e6 });
  const shielded = enemy({ invulnerable: true, hp: 1e6, maxHp: 1e6 });
  const g = game([vortex, shielded], p);
  for (const source of ['blaster', 'missile', 'lightning']) {
    withRandom(0.99, () => g.hitEnemy(vortex, 1, source));
    withRandom(0.99, () => g.hitEnemy(shielded, 1, source));
  }
  assert.ok(vortex.st && vortex.st.burn > 0, 'a FIRE Autocannon ignites a vortex');
  assert.ok(vortex.st.cold > 0 && vortex.st.shock > 0, 'FROST missiles chill it, Tesla arcs shock it');
  assert.equal(shielded.st, undefined);
});

test('tag cards boost every weapon carrying the tag, and firing uses the previewed numbers', () => {
  reset();
  const p = makePlayer();
  for (const id of ['missiles', 'lightning', 'orbitals', 'thrusters']) applyUpgradeLevels(p, byId(id));
  const g = game([], p);

  const kinetic = describeUpgrade(p, byId('tag_kinetic'));
  assert.equal(kinetic.headline, '+20% KINETIC DAMAGE');
  assert.deepEqual(kinetic.tags, ['kinetic']);
  for (const id of ['damage', 'orbitalDamage']) assert.ok(kinetic.rows.some((r) => r.id === id), id);
  assert.ok(!kinetic.rows.some((r) => r.id === 'missileDamage'), 'missiles are not kinetic');
  applyUpgradeLevels(p, byId('tag_kinetic'));
  g.firePrimaryWeapon();
  assert.equal(g.bullets[0].damage, 10 * 1.2);
  assert.equal(g.bullets[0].damage.toFixed(1), row('damage').fmt(row('damage').get(p)));

  applyUpgradeLevels(p, byId('tag_explosive'));
  g.fireSwarmMissiles(1);
  assert.equal(g.missiles[0].damage, 10 * W.missileDamageMult(levelBuild('missiles', 1)) * 1.3);

  const area = describeUpgrade(p, byId('tag_area'));
  assert.equal(area.headline, '+15% AREA SIZE');
  assert.ok(area.rows.some((r) => r.id === 'missileBlast' && r.before === '75' && r.after === '86'));
  assert.ok(area.rows.some((r) => r.id === 'novaRadius'));
  applyUpgradeLevels(p, byId('tag_area'));
  g.fireSwarmMissiles(1);
  assert.equal(g.missiles.at(-1).blastRadius, W.missileBlastRadius(levelBuild('missiles', 1)) * 1.15);

  applyUpgradeLevels(p, byId('tag_electric'));
  assert.equal(weaponDamage(p, 'lightning', 1), 10 * W.lightningDamageMult(levelBuild('lightning', 1)) * 1.3);
});

test('tag cards are only offered once an equipped weapon carries the tag', () => {
  const p = makePlayer(); // equips only Autocannon (PROJECTILE KINETIC)
  for (const id of ['tag_explosive', 'tag_electric', 'tag_area']) assert.equal(byId(id).req(p), false, id);
  for (const id of ['rockets_frost', 'grenades_corrode']) assert.equal(loadoutAllows(p, byId(id)), false, id);
  assert.equal(byId('tag_kinetic').req(p), true, 'the Autocannon is kinetic');
  assert.equal(loadoutAllows(p, byId('blaster_fire')), true, 'Autocannon bolts can burn');
  p.loadout = ['blaster', 'rockets'];
  assert.equal(byId('tag_explosive').req(p), true, 'rocket pods are explosive');
  assert.equal(byId('tag_area').req(p), true, 'rocket pods are area');
  assert.equal(loadoutAllows(p, byId('rockets_frost')), true, 'rocket pods can take FROST');
  p.loadout = ['rockets'];
  assert.equal(byId('tag_kinetic').req(p), false, 'no kinetic weapon equipped');
  assert.equal(loadoutAllows(p, byId('blaster_fire')), false, 'no Autocannon, no Autocannon element');
});

test('every weapon card carries tags rendered as chips, and every tag has a chip style', () => {
  for (const tags of Object.values(WEAPON_TAGS)) for (const t of tags) assert.ok(TAG_INFO[t], t);
  for (const id of ['multishot', 'firerate', 'pierce', 'missiles', 'orbitals', 'lightning', 'singularity', 'shrapnel', 'thrusters', 'evo_tectonic', 'evo_pulsar', 'evo_tempest']) {
    const u = byId(id);
    assert.ok(u.tags && u.tags.length, `${id} has tags`);
    for (const t of u.tags) assert.ok(TAG_INFO[t], `${id}: ${t}`);
  }
  const html = renderUpgradeCard(describeUpgrade(makePlayer(), byId('missiles')), '[1]').html;
  assert.match(html, /class="upg-tags"/);
  for (const label of ['PROJECTILE', 'EXPLOSIVE', 'AREA']) assert.match(html, new RegExp(`>${label}<`));
  // No card adds projectile count beyond Prism Split.
  const p = makePlayer();
  for (const u of UPGRADE_POOL) {
    if (u.id === 'multishot') continue;
    const copy = JSON.parse(JSON.stringify(p));
    u.apply(copy);
    assert.equal(copy.stats.bulletCount, p.stats.bulletCount, u.id);
  }
});

test('resetRun seeds crit stats from tuning and clears status bookkeeping', () => {
  reset();
  TUNING.baseCritChance = 0.12;
  const g = Object.assign(Object.create(Game.prototype), {
    enemyManager: new EnemyManager(), asteroidManager: { generateSector() {} }, particles: silent, grid: silent,
    damageNumbers: new DamageNumbers(), progression: { getBonuses: () => ({ bonusHp: 0, extraBombs: 0, moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 }) },
    keys: {}, mouse: {}, width: 1280, height: 720, worldWidth: 4200, worldHeight: 4200, updateHUD() {}, statusStamp: 99
  });
  g.resetRun();
  assert.equal(g.player.stats.critChance, 0.12);
  assert.equal(g.player.stats.critDamage, TUNING.baseCritDamage);
  assert.deepEqual(g.player.stats.tagDamage, { kinetic: 1, explosive: 1, electric: 1 });
  assert.equal(g.player.stats.areaMult, 1);
  assert.ok(!Object.keys(g.player.weapons).some((k) => /_(fire|frost|corrode|shock)$/.test(k)), 'no weapon starts with an element');
  assert.equal(g.statusStamp, 0);
  reset();
});

test('live tuning re-derives crit stats from the tuned base plus owned crit card levels', () => {
  reset();
  const p = makePlayer();
  applyUpgradeLevels(p, { ...byId('crit_chance'), levelJump: 2 });
  applyUpgradeLevels(p, byId('crit_damage'));
  applyUpgradeLevels(p, byId('blaster_fire'));
  applyUpgradeLevels(p, byId('evo_supercrit'));
  const g = Object.assign(game([], p), {
    progression: { getBonuses: () => ({ moveSpeedMult: 1, fireRateMult: 1, damageMult: 1, magnetMult: 1, xpMult: 1, coreMult: 1 }) }
  });
  TUNING.baseCritChance = 0.2;
  TUNING.baseCritDamage = 2;
  g.applyLiveTuning();
  assert.ok(Math.abs(p.stats.critChance - (0.2 + 2 * W.critChanceStep + W.supercritChance)) < 1e-9);
  assert.equal(p.stats.critDamage, 2 + W.critDamageStep);
  reset();
  g.applyLiveTuning();
  assert.ok(Math.abs(p.stats.critChance - (DEFAULT_TUNING.baseCritChance + 2 * W.critChanceStep + W.supercritChance)) < 1e-9);
  assert.equal(p.stats.critDamage, DEFAULT_TUNING.baseCritDamage + W.critDamageStep);
  reset();
});
