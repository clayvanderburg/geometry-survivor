import test from 'node:test';
import assert from 'node:assert/strict';

// Major bosses (js/bosses-major.js) and their hazards (js/boss-hazards.js): each signature attack is
// telegraphed before it can hurt, hits once, lets a dash through, and is no one-shot on its wave.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const fakeElement = () => ({
  textContent: '', innerHTML: '', style: {}, value: '', offsetWidth: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {}, addEventListener() {}
});
globalThis.document = { getElementById: fakeElement, createElement: fakeElement, querySelectorAll: () => [], activeElement: null };

const { Game } = await import('../js/main.js');
const { EnemyManager, waveScaleAt, damageRampAt, contactDamageAt } = await import('../js/enemies.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { BOSS_DEFS, OURO, HIVE, ARCH, COND, PRISM } = await import('../js/bosses.js');
const { HAZARD, addBlast, addLine, addRing, applyBossHazards, tickBossHazards, inGap } = await import('../js/boss-hazards.js');
const { BOSS_CUES } = await import('../js/boss-sfx-major.js');
const { BASE_SHIELD } = await import('../js/upgrades.js');
const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);
const MAJORS = ['ouroboros', 'hive_carrier', 'architect', 'conductor', 'prism'];

const step = (m, player, ticks = 1) => {
  for (let i = 0; i < ticks; i++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
};
const hazards = (m, kind, from) => (m.bossHazards || []).filter(h => h.kind === kind && (!from || h.from === from));
const ship = (x = 2000, y = 2000) => ({ x, y, vx: 0, vy: 0, radius: 15 });

function hazardGame(wave = 30) {
  const m = new EnemyManager();
  const hits = [];
  const g = {
    enemyManager: m, wave, player: { ...ship(), hp: 500, maxHp: 500, invuln: 0 },
    enemyBulletDamage: (b) => b.damage * damageRampAt(wave),
    damagePlayer(dmg, shake, by) { hits.push({ dmg, by }); this.player.hp -= dmg; this.player.invuln = 0.4; return false; },
    endRunIfDead() { return this.player.hp <= 0; }
  };
  return { m, g, hits };
}

test('a blast circle hurts only when it detonates, and only a ship inside it', () => {
  resetTuning();
  const { m, g, hits } = hazardGame(30);
  addBlast(m, { x: 2000, y: 2000, r: 70, fuse: 1, from: 'hive_carrier' });
  addBlast(m, { x: 2300, y: 2000, r: 70, fuse: 1, from: 'hive_carrier' });
  for (let i = 0; i < 50; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); }
  assert.equal(hits.length, 0, 'the fuse is a warning, not a hit');
  for (let i = 0; i < 20; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); }
  assert.equal(hits.length, 1, 'one blast, one hit');
  assert.equal(hits[0].by, 'hive_carrier', 'run stats credit the boss');
  assert.ok(Math.abs(hits[0].dmg - TUNING.enemyBulletDamage * HAZARD.blastMult * damageRampAt(30)) < 1e-6);
});

test('a dash (invulnerability) passes through a hazard', () => {
  resetTuning();
  const { m, g, hits } = hazardGame(30);
  g.player.invuln = 0.3;
  addBlast(m, { x: 2000, y: 2000, r: 70, fuse: 0.05 });
  for (let i = 0; i < 10; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); }
  assert.equal(hits.length, 0);
});

test('blueprint lines are harmless while dashed, then burn once; a held beam may hit again after its rehit time', () => {
  resetTuning();
  const { m, g, hits } = hazardGame(30);
  addLine(m, { x1: 1600, y1: 2000, x2: 2400, y2: 2000, width: 18, fuse: 1, burn: 0.4, from: 'architect' });
  for (let i = 0; i < 55; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); }
  assert.equal(hits.length, 0);
  for (let i = 0; i < 30; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); g.player.invuln = 0; }
  assert.equal(hits.length, 1, 'burns the ship once');
  assert.equal(hazards(m, 'line').length, 0, 'gone after its burn');
  addLine(m, { x1: 1600, y1: 2000, x2: 2400, y2: 2000, fuse: 0, burn: 1e9, rehit: 1 });
  for (let i = 0; i < 130; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); g.player.invuln = 0; }
  assert.equal(hits.length, 1 + 3, 'a held beam hits once a second');
});

test('a shock ring hits a ship it rolls over, except through a gap', () => {
  resetTuning();
  const { m, g, hits } = hazardGame(40);
  addRing(m, { x: 1700, y: 2000, speed: 6, width: 22, maxR: 600, gaps: [], from: 'conductor' });
  for (let i = 0; i < 120; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); g.player.invuln = 0; }
  assert.equal(hits.length, 1, 'one hit as it passes');
  // Same ring with a gap facing the ship: it flies through.
  addRing(m, { x: 1700, y: 2000, speed: 6, width: 22, maxR: 600, gaps: [0], gapW: 0.6, from: 'conductor' });
  const ring = hazards(m, 'ring')[0];
  assert.ok(inGap(ring, 0.2) && !inGap(ring, 0.5));
  for (let i = 0; i < 120; i++) { tickBossHazards(m, 1 / 60, g.player); applyBossHazards(g); g.player.invuln = 0; }
  assert.equal(hits.length, 1);
});

test('no hazard is a one-shot: a hit is under half the boss\'s own contact hit, and under half a bare shield through wave 30', () => {
  resetTuning();
  for (const [id, wave] of [['ouroboros', 10], ['hive_carrier', 20], ['architect', 30], ['conductor', 40], ['prism', 50]]) {
    for (const mult of [HAZARD.blastMult, HAZARD.lineMult, HAZARD.ringMult]) {
      const dmg = TUNING.enemyBulletDamage * mult * damageRampAt(wave);
      assert.ok(dmg < contactDamageAt({ isBoss: true }, wave) * 0.45, `${id} @ W${wave}: ${dmg.toFixed(0)} vs contact`);
      if (wave <= 30) assert.ok(dmg < BASE_SHIELD * 0.5, `${id} @ W${wave}: ${dmg.toFixed(0)} vs a bare shield`);
    }
  }
});

test('major bosses are big (bigger than a Hulk) and quicker than before v0.44', () => {
  const m = new EnemyManager();
  const hulk = m.getArchetype('hulk', 1);
  for (const id of MAJORS) {
    const cfg = m.getArchetype(id, 1, { wave: 10 });
    assert.ok(cfg.radius >= 42 && cfg.radius > hulk.radius, `${id} radius ${cfg.radius}`);
    assert.ok(cfg.speed >= 2.3, `${id} speed ${cfg.speed}`);
    assert.equal(BOSS_DEFS[id].tier, 'major');
  }
});

test('every major boss arrives with an entrance cue and holds briefly, and dies in a staged blast', () => {
  resetTuning();
  for (const id of MAJORS) {
    const m = new EnemyManager();
    const player = ship(2600, 2000);
    m.queueSpawn(id, 2000, 2000, waveScaleAt(20), { instant: true, wave: 20 });
    step(m, player, 2);
    const e = m.enemies.find(o => o.type === id);
    assert.ok((m.bossCues || []).length > 0, `${id} entrance cue`);
    assert.ok(e.restT > 0 || e.introT > 0, `${id} entrance hold`);
    for (const c of m.bossCues) assert.ok(BOSS_CUES.includes(c.cue), `${id}: cue ${c.cue} exists`);
    m.bossCues.length = 0;
    BOSS_DEFS[id].onDeath(e, m);
    assert.ok(hazards(m, 'fx').length >= 5, `${id} staged death`);
    assert.ok(m.bossCues.some(c => c.cue === 'major_death'));
  }
});

test('Ouroboros: rattles, rears and strikes in phase 1; at half HP the noose constricts with venom', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = ship(2300, 2000);
  m.queueSpawn('ouroboros', 2000, 2000, waveScaleAt(10), { instant: true, wave: 10 });
  step(m, player, 2);
  const q = m.enemies.find(e => e.type === 'ouroboros');
  m.bossCues.length = 0;
  const seen = new Set();
  for (let i = 0; i < 60 * 8; i++) { step(m, player, 1); seen.add(q.state); }
  assert.ok(seen.has('rear') && seen.has('strike'), 'phase 1 strikes');
  assert.ok(m.bossCues.some(c => c.cue === 'ouro_rattle'), 'a rattle before the strike');
  q.hp = q.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(q.state, 'coil');
  assert.ok(q.phaseFlash > 0, 'the molt flashes');
  m.enemyBullets.clear();
  for (let i = 0; i < 60 * 5 && q.state === 'coil'; i++) step(m, player, 1);
  assert.equal(q.state, 'rear');
  assert.ok(m.enemyBullets.count >= 3, `the constrict spits venom (${m.enemyBullets.count})`);
});

test('Hive Carrier: bombing runs drop one shell per bay plus one; exposed, it walks a carpet of shells', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = ship(2300, 2000);
  m.queueSpawn('hive_carrier', 2000, 2000, waveScaleAt(20), { instant: true, wave: 20 });
  step(m, player, 3);
  const h = m.enemies.find(e => e.type === 'hive_carrier');
  for (let i = 0; i < 60 * 6 && !hazards(m, 'blast').length; i++) step(m, player, 1);
  assert.equal(hazards(m, 'blast').length, HIVE.bays + 1);
  // Lose two bays: the next run has two shells fewer.
  const bays = m.enemies.filter(e => e.mount === h);
  for (const b of bays.slice(0, 2)) { b.dead = true; m.enemies.splice(m.enemies.indexOf(b), 1); }
  step(m, player, 120);
  for (let i = 0; i < 60 * 8 && !hazards(m, 'blast').length; i++) step(m, player, 1);
  assert.equal(hazards(m, 'blast').length, HIVE.bays - 2 + 1);
  for (const b of m.enemies.filter(e => e.mount === h)) { b.dead = true; m.enemies.splice(m.enemies.indexOf(b), 1); }
  step(m, player, 1);
  assert.equal(h.phase, 2);
  m.bossHazards.length = 0;
  for (let i = 0; i < 60 * 6 && !hazards(m, 'blast').length; i++) step(m, player, 1);
  assert.equal(hazards(m, 'blast').length, HIVE.carpetShells, 'a carpet of shells');
});

test('Architect: blueprints cross where you are going, two lines then three-line stars from half HP', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = ship(2300, 2000);
  m.queueSpawn('architect', 2000, 2000, waveScaleAt(30), { instant: true, wave: 30 });
  step(m, player, 3);
  const a = m.enemies.find(e => e.type === 'architect');
  for (let i = 0; i < 60 * 6 && !hazards(m, 'line').length; i++) step(m, player, 1);
  const lines = hazards(m, 'line', 'architect');
  assert.equal(lines.length, ARCH.printLines);
  for (const l of lines) assert.ok(Math.hypot((l.x1 + l.x2) / 2 - player.x, (l.y1 + l.y2) / 2 - player.y) < 5, 'through the ship');
  m.bossHazards.length = 0;
  a.hp = a.maxHp * 0.49;
  for (let i = 0; i < 60 * 4 && !hazards(m, 'line').length; i++) step(m, player, 1);
  assert.equal(hazards(m, 'line').length, ARCH.ragePrintLines);
  // Its gates come down with it.
  step(m, player, 60 * 3);
  const gates = m.enemies.filter(e => e.builder === a);
  assert.ok(gates.length > 0);
  BOSS_DEFS.architect.onDeath(a, m);
  assert.ok(gates.every(o => m.doomed.includes(o) && o.noReward));
});

test('Conductor: counts in three ticks, then a gapped ring; double rings once enraged; shield callouts', () => {
  resetTuning();
  const m = new EnemyManager();
  const player = ship(2300, 2000);
  m.queueSpawn('conductor', 2000, 2000, waveScaleAt(40), { instant: true, wave: 40 });
  step(m, player, 3);
  const c = m.enemies.find(e => e.type === 'conductor');
  m.bossCues.length = 0;
  const cues = [];
  for (let i = 0; i < 60 * 6 && !hazards(m, 'ring').length; i++) { step(m, player, 1); cues.push(...m.bossCues.splice(0)); }
  assert.equal(cues.filter(q => q.cue === 'cond_tick').length, 3, 'three ticks');
  assert.ok(cues.some(q => q.cue === 'cond_downbeat'));
  const [ring] = hazards(m, 'ring');
  assert.equal(ring.gaps.length, COND.ringGaps);
  // Kill the choir: the shield breaks with a callout.
  assert.ok(c.deflect);
  c.labelT = 0;
  for (const o of m.enemies.filter(o => o !== c)) { o.dead = true; m.enemies.splice(m.enemies.indexOf(o), 1); }
  step(m, player, 1);
  assert.equal(c.deflect, false);
  assert.ok(hazards(m, 'label').some(l => /SHIELD DOWN/.test(l.text)));
  m.bossHazards.length = 0;
  c.hp = c.maxHp * 0.49;
  for (let i = 0; i < 60 * 6 && hazards(m, 'ring').length < 2; i++) step(m, player, 1);
  assert.equal(hazards(m, 'ring').length, COND.rageRings, 'the crescendo doubles the rings');
});

test('the game drains boss hits into damagePlayer and cues into sound, every tick', () => {
  resetTuning();
  const played = [];
  const { m, g, hits } = hazardGame(20);
  (m.bossCues ||= []).push({ cue: 'cond_tick' });
  m.bossHazardHits = [{ mult: 1, from: 'prism' }];
  applyBossHazards(g, (game, c) => played.push(c.cue));
  assert.deepEqual(played, ['cond_tick']);
  assert.equal(hits.length, 1);
  assert.equal(m.bossCues.length, 0);
  assert.ok(Game.prototype.update.toString().includes('applyBossHazards'), 'wired into Game.update');
});

test('sizes and speeds in the constants match the defs', () => {
  assert.equal(BOSS_DEFS.ouroboros.stats().radius, OURO.headRadius);
  assert.equal(BOSS_DEFS.prism.stats().radius, PRISM.radius);
  assert.equal(BOSS_DEFS.architect.stats().radius, ARCH.radius);
});
