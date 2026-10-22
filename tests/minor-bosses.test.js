import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The minor bosses' signature attacks (js/bosses.js) and the telegraphed hazards they use
// (js/boss-telegraphs.js): Swarm Spear and Egg Clutch, Airstrike and Crossfire, Gravity Wave, Pseudopod
// Lash, Eclipse nova. Plus their presence (size) and the boss sound cues (js/boss-sfx.js).
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { EnemyManager, waveScaleAt } = await import('../js/enemies.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');
const { BossTelegraphs } = await import('../js/boss-telegraphs.js');
const { BOSS_DEFS, QUEEN, WING, HORIZON, PROG, TWINS } = await import('../js/bosses.js');
const { BOSS_SFX, playBossCue } = await import('../js/boss-sfx.js');
const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);
const MINORS = ['brood_queen', 'wing_commander', 'event_horizon', 'progenitor', 'eclipse_twins'];

function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const step = (m, player, ticks = 1) => {
  for (let i = 0; i < ticks; i++) m.update(1 / 60, player, [], silent, silent, 4200, 4200);
};
const until = (m, player, done, max = 60 * 30) => {
  for (let i = 0; i < max; i++) {
    if (done()) return true;
    step(m, player);
  }
  return done();
};
const spawnBoss = (id, wave, at = { x: 2000, y: 2000 }) => {
  const m = new EnemyManager();
  m.queueSpawn(id, at.x, at.y, waveScaleAt(wave), { instant: true, wave });
  return m;
};
const bossOf = (m, id) => m.enemies.find(e => e.type === id);

test('hazards: a zone warns, then hits a ship inside it once; a ship outside is never hit', () => {
  const pool = new BossTelegraphs();
  const hits = [];
  const onHit = (b) => { hits.push(b); return true; };
  pool.zone(100, 100, 60, { warn: 0.5, damage: 30, from: 'brood_queen' });
  const inside = { x: 120, y: 100, radius: 15 };
  pool.update(0.4);
  assert.equal(pool.hitPlayer(inside, onHit), false, 'no hit during the warning');
  pool.update(0.2);
  assert.equal(pool.hitPlayer(inside, onHit), true);
  assert.equal(hits[0].damage, 30);
  assert.equal(hits[0].from, 'brood_queen');
  assert.equal(pool.hitPlayer(inside, onHit), false, 'one hit per hazard');
  pool.zone(100, 100, 60, { warn: 0.1 });
  pool.update(0.15);
  assert.equal(pool.hitPlayer({ x: 200, y: 100, radius: 15 }, onHit), false, 'outside the disc');
  // A dash (onHit refuses) leaves the hazard armed for the rest of its window.
  pool.clear();
  pool.zone(0, 0, 50, { warn: 0.1 });
  pool.update(0.12);
  assert.equal(pool.hitPlayer({ x: 0, y: 0, radius: 15 }, () => false), false);
  assert.equal(pool.hitPlayer({ x: 0, y: 0, radius: 15 }, onHit), true);
  for (let i = 0; i < 60; i++) pool.update(1 / 60);
  assert.equal(pool.count, 0, 'spent hazards return to the pool');
});

test('hazards: a swept lane only hurts at its blast front; a wave ring spares its gaps', () => {
  const pool = new BossTelegraphs();
  const onHit = () => true;
  pool.lane(0, 0, 1000, 0, 80, { warn: 0.2, sweep: 0.6 });
  pool.update(0.21);
  const far = { x: 900, y: 0, radius: 15 };
  assert.equal(pool.hitPlayer(far, onHit), false, 'the far end is not burning yet');
  for (let i = 0; i < 33; i++) pool.update(1 / 60);
  assert.equal(pool.hitPlayer(far, onHit), true, 'the front reaches it');

  pool.clear();
  pool.wave(0, 0, { r0: 40, speed: 4, rMax: 600, w: 20, gaps: [0], gapWidth: 0.6, warn: 0.1 });
  pool.update(0.11);
  for (let i = 0; i < 40; i++) pool.update(1 / 60); // r ≈ 200
  const r = pool.active[0].r;
  assert.equal(pool.hitPlayer({ x: r, y: 0, radius: 15 }, onHit), false, 'inside the gap');
  assert.equal(pool.hitPlayer({ x: 0, y: r, radius: 15 }, onHit), true, 'on the ring');
});

test('the minor bosses are big next to late-wave hulls, and their hazards are never a one-shot', () => {
  resetTuning();
  for (const id of MINORS) {
    const m = spawnBoss(id, 25);
    step(m, { x: 2600, y: 2000 }, 2);
    assert.ok(bossOf(m, id).radius >= 38, `${id} radius ${bossOf(m, id).radius}`);
  }
  const contact = TUNING.bossContactDamage ?? 48;
  for (const share of [QUEEN.eggDamage, WING.strikeDamage, HORIZON.waveDamage, PROG.lashDamage, TWINS.novaDamage]) {
    assert.ok(share > 0 && share <= 0.6, `a hazard hit is ${share} of a contact hit`);
  }
  assert.ok(contact * 0.6 < 100, 'well under a fresh ship before the wave ramp');
});

test('Brood Queen: the swarm spear lines her brood up on a locked lane, then hurls it; eggs from half HP', (t) => {
  t.mock.method(Math, 'random', seeded(11)); // deterministic AI timers and spawns
  resetTuning();
  const m = spawnBoss('brood_queen', 5);
  const player = { x: 2350, y: 2000, radius: 15 };
  step(m, player, 4);
  const q = bossOf(m, 'brood_queen');
  q.ramT = 99; // keep the shared ram out of the way
  assert.ok(until(m, player, () => q.state === 'spear'), 'a spear starts');
  const slotted = m.enemies.filter(o => o.anchor === q && o.spearSlot !== undefined);
  assert.ok(slotted.length >= 3 && slotted.length <= QUEEN.spearCount, `${slotted.length} in the spear`);
  assert.ok(until(m, player, () => q.state !== 'spear'));
  const flying = m.enemies.filter(o => o.spearFlyT > 0);
  assert.equal(flying.length, slotted.length, 'the whole line flies');
  for (const o of flying) {
    const a = Math.atan2(o.vy, o.vx);
    assert.ok(Math.abs(Math.sin(a - q.spearAngle)) < 0.01 && Math.cos(a - q.spearAngle) > 0, 'down the locked lane');
  }
  step(m, player, 90);
  assert.equal(m.enemies.filter(o => o.spearFlyT > 0).length, 0, 'then they rejoin the flock');
  assert.ok(m.enemies.every(o => o.type !== 'swarmer' || !(o.burstSpeed > 0) || o.anchor), 'no swarmer keeps the spear speed');
  // Half HP: egg clutches round the ship, each hatching a swarmer.
  q.hp = q.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(q.enraged, true);
  assert.ok(until(m, player, () => m.bossTelegraphs.count >= QUEEN.eggs, 60 * 3));
  const eggs = m.bossTelegraphs.active.filter(h => h.kind === 'zone');
  assert.ok(eggs.some(h => Math.hypot(h.x - player.x, h.y - player.y) < 30), 'one lands on the ship');
  const swarmers = () => m.enemies.filter(o => o.type === 'swarmer').length + m.spawnIndicators.filter(s => s.type === 'swarmer').length;
  const before = swarmers();
  step(m, player, Math.ceil((QUEEN.eggWarn + 0.3) * 60));
  assert.ok(swarmers() >= before + 1, 'eggs hatch');
});

test('Wing Commander: an airstrike lane through the ship; crossfire is two crossing lanes', (t) => {
  t.mock.method(Math, 'random', seeded(11)); // deterministic AI timers and spawns
  resetTuning();
  const m = spawnBoss('wing_commander', 15, { x: 1800, y: 2000 });
  const player = { x: 2400, y: 2000, radius: 15 };
  step(m, player, 4);
  const c = bossOf(m, 'wing_commander');
  assert.ok(until(m, player, () => m.bossTelegraphs.count > 0, 60 * 8), 'an airstrike is called');
  const [lane] = m.bossTelegraphs.active;
  assert.equal(lane.kind, 'lane');
  assert.ok(lane.sweep > 0);
  const mx = (lane.x + lane.x2) / 2;
  const my = (lane.y + lane.y2) / 2;
  assert.ok(Math.hypot(mx - player.x, my - player.y) < 40, 'centred on the ship');
  m.bossTelegraphs.clear();
  c.hp = c.maxHp * 0.49;
  step(m, player, 1);
  assert.equal(c.enraged, true);
  assert.ok(until(m, player, () => m.bossTelegraphs.count >= 2, 60 * 4), 'crossfire');
  const [a, b] = m.bossTelegraphs.active;
  const angle = (h) => Math.atan2(h.y2 - h.y, h.x2 - h.x);
  const d = Math.abs(Math.sin(angle(a) - angle(b)));
  assert.ok(d > 0.9, 'the two lanes cross near right angles');
});

test('Event Horizon: each breath marks a gravity wave with safe gaps; enraged, a double ripple', (t) => {
  t.mock.method(Math, 'random', seeded(11)); // deterministic AI timers and spawns
  resetTuning();
  const m = spawnBoss('event_horizon', 25);
  const player = { x: 2500, y: 2000, radius: 15 };
  step(m, player, 4);
  const h = bossOf(m, 'event_horizon');
  h.ramT = 99;
  assert.ok(until(m, player, () => h.inhaleT > 0, 60 * 8));
  const waves = () => m.bossTelegraphs.active.filter(z => z.kind === 'wave');
  assert.equal(waves().length, 1);
  assert.equal(waves()[0].gaps.length, HORIZON.gaps);
  step(m, player, Math.ceil(HORIZON.inhaleTime * 60) + 2);
  assert.equal(waves()[0].state, 'live', 'the wave rolls out as it exhales');
  assert.ok(m.enemyBullets.count >= HORIZON.ring - 1, 'orbs ride the wave');
  // The orbs fly out through the gaps (never along an arc), at least twice the old spacing apart (16 per ring).
  const angles = m.enemyBullets.active.map((b) => Math.atan2(b.vy, b.vx));
  const gapOf = (a) => waves()[0].gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < HORIZON.waveGap / 2);
  assert.ok(angles.every(gapOf), 'every orb flies through a gap');
  const sorted = [...angles].sort((p, q) => p - q);
  const minGap = Math.min(...sorted.map((a, i) => (i ? a - sorted[i - 1] : a + Math.PI * 2 - sorted[sorted.length - 1])));
  assert.ok(minGap >= 2 * (Math.PI * 2 / 3 - 0.62) / 5 - 1e-9, `orbs at least twice as far apart (${minGap.toFixed(2)} rad; was 5 per arc)`);
  // The arcs are 30% of their old length (old: 3 arcs of 2π/3 − 0.62 rad) and 6 px thick (was 20).
  assert.ok(Math.abs((Math.PI * 2 / 3 - HORIZON.waveGap) / (Math.PI * 2 / 3 - 0.62) - 0.3) < 0.02);
  assert.equal(HORIZON.waveWidth, 6);
  m.bossTelegraphs.clear();
  h.hp = h.maxHp * 0.49;
  step(m, player, 2);
  assert.equal(h.enraged, true);
  h.aiTimer = 0;
  h.ramState = null;
  step(m, player, 2);
  assert.equal(waves().length, 2, 'a double ripple');
});

test('Progenitor: a cell stops and marks pseudopod spokes, one on the ship; every piece lashes', (t) => {
  t.mock.method(Math, 'random', seeded(11)); // deterministic AI timers and spawns
  resetTuning();
  const m = spawnBoss('progenitor', 35);
  const player = { x: 2400, y: 2000, radius: 15 };
  step(m, player, 3);
  const p = bossOf(m, 'progenitor');
  p.ramT = 99;
  assert.ok(until(m, player, () => p.lashHold > 0, 60 * 6));
  const lanes = m.bossTelegraphs.active.filter(h => h.kind === 'lane');
  assert.equal(lanes.length, PROG.gens[0].spokes);
  const aim = Math.atan2(player.y - p.y, player.x - p.x);
  assert.ok(lanes.some(l => Math.abs(Math.sin(Math.atan2(l.y2 - l.y, l.x2 - l.x) - aim)) < 0.1), 'one spoke on the ship');
  step(m, player, 8); // it skids to a stop
  const x = p.x;
  const y = p.y;
  step(m, player, 20);
  assert.ok(Math.hypot(p.x - x, p.y - y) < 2, 'rooted while it lashes');
});

test('Eclipse Twins: the eclipse jumps onto the ship, marks the nova disc and fires its orbs; half HP tightens the ring', (t) => {
  t.mock.method(Math, 'random', seeded(11)); // deterministic AI timers and spawns
  resetTuning();
  const m = spawnBoss('eclipse_twins', 45);
  const player = { x: 2300, y: 2000, radius: 15 };
  step(m, player, 5);
  const sol = m.enemies.find(e => e.twinRole === 'sol');
  const luna = m.enemies.find(e => e.twinRole === 'luna');
  assert.ok(until(m, player, () => m.bossTelegraphs.count > 0, 60 * 8), 'an eclipse starts');
  const [disc] = m.bossTelegraphs.active;
  assert.ok(Math.hypot(disc.x - player.x, disc.y - player.y) < 30, 'on the ship');
  assert.equal(disc.r, TWINS.novaR);
  step(m, player, Math.ceil(TWINS.novaWarn * 60) - 6);
  assert.ok(Math.hypot(sol.x - luna.x, sol.y - luna.y) < 60, 'the moon covers the sun');
  assert.equal(sol.beam, null, 'the tether goes dark');
  step(m, player, 10);
  assert.ok(m.enemyBullets.count >= TWINS.novaOrbs - 1, 'the nova fires its orbs');
  sol.hp = sol.maxHp * 0.4;
  luna.hp = luna.maxHp * 0.4;
  step(m, player, 1);
  assert.equal(sol.root.phase2, true);
});

test('boss sound cues: every cue a boss plays exists, and they no-op without an AudioContext', () => {
  const src = readFileSync(new URL('../js/bosses.js', import.meta.url), 'utf8');
  const used = new Set([...src.matchAll(/cue\(m, '([a-z_]+)'\)|arriveFx\(e, m, '([a-z_]+)'\)|deathBloom\([^)]*'([a-z_]+)'\)/g)].map(x => x[1] || x[2] || x[3]));
  assert.ok(used.size >= 10);
  for (const name of used) assert.ok(BOSS_SFX[name], `missing cue ${name}`);
  assert.equal(playBossCue({ ctx: null }, 'boss_phase'), false);
  for (const id of MINORS) assert.ok(BOSS_DEFS[id].overlay, `${id} draws its flair`);
});

test('REDUCE EFFECTS dims the boss glow flashes (telegraph blasts and boss flair)', async () => {
  const { setReduceEffects } = await import('../js/juice.js');
  const sizes = [];
  const fx = { particles: { spawnFlash: (x, y, size) => sizes.push(size) } };
  const blast = () => {
    const pool = new BossTelegraphs();
    pool.zone(0, 0, 100, { warn: 0.05 });
    pool.update(0.1, fx);
  };
  try {
    setReduceEffects(false);
    blast();
    setReduceEffects(true);
    blast();
  } finally {
    setReduceEffects(false);
  }
  assert.equal(sizes.length, 2);
  assert.ok(sizes[1] < sizes[0] * 0.5, `reduced ${sizes[1]} vs ${sizes[0]}`);
});

test('Event Horizon: its pull is a fight to escape, never a trap; touching the ship, it spits it out', async () => {
  resetTuning();
  const h = await import('../tools/balance/harness.mjs');
  const fight = (start) => {
    const g = h.createHeadlessGame();
    g.resetRun(g.selectedMode, null);
    g.state = 'PLAYING';
    g.spawnCooldown = 1e9;
    g.waveTimer = -1e9;
    g.wave = 25;
    const p = g.player;
    g.enemyManager.queueSpawn('event_horizon', p.x - start, p.y, g.getWaveScale(), { instant: true, wave: 25 });
    g.update(1 / 60);
    g.update(1 / 60);
    const b = g.enemyManager.enemies.find((e) => e.type === 'event_horizon');
    b.ramT = 1e9; // no ram, no breathing: just the pull and the drift
    b.aiTimer = 1e9;
    return { g, p, b };
  };
  // Full thrust straight out from deep inside: the drifting core never keeps up (it held at 1.9 px/tick before).
  for (const start of [120, 250]) {
    const { g, p, b } = fight(start);
    g.pollGamepad = () => ({ moveX: 1, moveY: 0, aimX: 0, aimY: 0, dash: false, bomb: false, pressed: () => false, buttons: [], active: false });
    let t = 0;
    for (; t < 60 * 10 && Math.hypot(p.x - b.x, p.y - b.y) < HORIZON.pullRadius; t++) { p.hp = p.maxHp; p.invuln = 1; g.update(1 / 60); }
    assert.ok(t < 60 * 8, `from ${start} px the ship clears the pull (${(t / 60).toFixed(1)} s)`);
    assert.ok(b.speed <= HORIZON.holdSpeed + 1e-9 || Math.hypot(p.x - b.x, p.y - b.y) >= HORIZON.pullRadius);
  }
  // A ship sitting on the core takes a hit, is let go (no tug) and the two are shoved apart.
  const { g, p, b } = fight(40);
  g.pollGamepad = () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, dash: false, bomb: false, pressed: () => false, buttons: [], active: false });
  let hits = 0;
  const dp = g.damagePlayer.bind(g);
  g.damagePlayer = (dmg, shake, by) => { if (by === 'event_horizon') hits++; return dp(Math.min(dmg, p.hp - 1), shake, by); };
  g.update(1 / 60);
  assert.ok(b.spitT > 0 && b.gravityWell === false, 'it lets go');
  g.update(1 / 60);
  assert.equal(p.gravityTug, 0, 'no tug while it lets go');
  for (let t = 0; t < 60 * 3; t++) { p.hp = p.maxHp; g.update(1 / 60); }
  // About one hit per spit window (plus the first), not one every 0.4 s of hit invulnerability (7+ in 3 s).
  assert.ok(hits <= Math.ceil(3 / HORIZON.spitTime) + 2, `a ship left on the core is hit ${hits} times in 3 s`);
});

test('Event Horizon never pulls or swallows other bosses or lieutenants, only regular hostiles', () => {
  resetTuning();
  const m = spawnBoss('event_horizon', 25);
  const player = { x: 2900, y: 2000, radius: 15 };
  step(m, player, 4);
  const h = bossOf(m, 'event_horizon');
  h.ramT = 99;
  m.queueSpawn('swarmer', h.x + 150, h.y, 1, { instant: true });
  m.queueSpawn('wing_commander', h.x - 150, h.y, 1, { instant: true, wave: 15 });
  m.queueSpawn('bruiser', h.x, h.y + 150, 1, { instant: true, lieutenant: { name: 'TEST', epithet: 'T', mods: [] } });
  step(m, player, 2);
  const lt = m.enemies.find((e) => e.isLieutenant);
  assert.ok(lt, 'a lieutenant is on the field');
  const boss = m.enemies.find((e) => e.type === 'wing_commander');
  const fodder = m.enemies.find((e) => e.type === 'swarmer');
  if (lt) lt.gvx = lt.gvy = 0;
  boss.gvx = boss.gvy = 0;
  fodder.gvx = fodder.gvy = 0;
  const env = { ...m.aiEnv, dt: 1 / 60, player, dirX: 1, dirY: 0, moveX: 1, moveY: 0, dist: 500 };
  BOSS_DEFS.event_horizon.update(h, m, env);
  assert.ok(Math.abs(fodder.gvx) + Math.abs(fodder.gvy) > 0, 'regular hostiles are dragged in');
  assert.equal((boss.gvx || 0) + (boss.gvy || 0), 0, 'another boss is never pulled');
  if (lt) assert.equal((lt.gvx || 0) + (lt.gvy || 0), 0, 'a lieutenant is never pulled');
  // Parked on the core, neither is swallowed.
  boss.x = h.x + 2; boss.y = h.y;
  if (lt) { lt.x = h.x - 2; lt.y = h.y; }
  BOSS_DEFS.event_horizon.update(h, m, env);
  assert.ok(!boss.doomQueued && !(lt && lt.doomQueued));
});
