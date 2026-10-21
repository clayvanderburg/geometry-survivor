import test from 'node:test';
import assert from 'node:assert/strict';

// The HATCHERY mini-spawner (js/hatcheries.js): incubation telegraph, brood caps (alive, lifetime and the
// enemy budget), the hatchling's circle → flare → dive, the brood withering with its hive, and its
// place in the campaign. Browser services are stubbed; the tests drive the real EnemyManager.
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
const element = () => ({
  textContent: '', innerHTML: '', style: {}, offsetWidth: 0, value: '', className: '',
  classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, appendChild() {}, addEventListener() {}
});
globalThis.document = { activeElement: null, getElementById: element, createElement: element };

const { Game } = await import('../js/main.js');
const { EnemyManager } = await import('../js/enemies.js');
const { HATCHERY, HATCHLING, broodOf } = await import('../js/hatcheries.js');
const { UNLOCK_WAVE, isBossWave, waveTheme } = await import('../js/wave-plan.js');
const { BOSS_DEFS } = await import('../js/bosses.js');
const { packRoster } = await import('../js/waves.js');
const { HOSTILE_DEATH_TIER } = await import('../js/hostiles.js');
const { GuidePreview } = await import('../js/field-guide-scenes.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);
const DT = 1 / 60;

// A manager with one hatchery `dist` px left of the ship; `step` drains doomed hulls like Game does.
function nest({ dist = 400, maxEnemies = 200 } = {}) {
  const m = new EnemyManager({ maxEnemies });
  m.wave = 35;
  const player = { x: 2000, y: 2000, vx: 0, vy: 0, radius: 15 };
  m.queueSpawn('hatchery', player.x - dist, player.y, m.waveScaleFor('hatchery', 35), { instant: true });
  const step = (seconds) => {
    for (let t = 0; t < Math.round(seconds * 60); t++) {
      m.update(DT, player, [], silent, silent, 4200, 4200);
      for (const e of m.doomed.splice(0)) {
        const i = m.enemies.indexOf(e);
        if (i !== -1) m.enemies.splice(i, 1);
        e.dead = true;
      }
      // Hold the hive in place so the distance stays what the test set up.
      const h = m.enemies.find(e => e.type === 'hatchery');
      if (h) { h.x = player.x - dist; h.y = player.y; }
    }
  };
  step(0.1); // the spawn resolves
  return { m, player, step, hive: () => m.enemies.find(e => e.type === 'hatchery') };
}

const hatchlings = (m) => m.enemies.filter(e => e.type === 'hatchling' && !e.dead);

test('a hatchery telegraphs, then hatches its brood out of its pods', () => {
  resetTuning();
  const { m, step, hive } = nest();
  const h = hive();
  assert.ok(h.sturdy && h.knockMult < 0.5, 'slow, durable and hard to shove');
  let sawIncubation = false;
  for (let t = 0; t < 60 * 4 && hatchlings(m).length === 0; t++) {
    step(DT);
    if (h.incubT > 0) {
      sawIncubation = true;
      assert.equal(hatchlings(m).length, 0, 'nothing hatches while the ring closes in');
    }
  }
  assert.ok(sawIncubation, 'it incubates (the telegraph) before hatching');
  assert.equal(hatchlings(m).length, HATCHERY.hatch);
  assert.ok(hatchlings(m).every(c => c.parent === h), 'its brood knows its hive');
  assert.equal(h.born, HATCHERY.hatch);
});

test('brood caps: alive, lifetime, wake range and the enemy budget', () => {
  resetTuning();
  // Alive cap: never more than maxBrood of its own hatchlings at once.
  const a = nest();
  a.step(HATCHERY.hatchEvery * 6);
  assert.ok(hatchlings(a.m).length <= HATCHERY.maxBrood, `${hatchlings(a.m).length} alive`);
  assert.equal(broodOf(a.hive(), a.m), HATCHERY.maxBrood, 'the nest fills up to its cap');

  // Lifetime cap: kill the brood as it hatches; it stops at broodTotal and the pods run out.
  const b = nest();
  for (let s = 0; s < 200; s++) {
    b.step(0.5);
    for (const c of hatchlings(b.m)) { c.dead = true; b.m.enemies.splice(b.m.enemies.indexOf(c), 1); }
  }
  assert.equal(b.hive().born, HATCHERY.broodTotal, 'it stops breeding when spent');

  // Asleep beyond its wake range.
  const c = nest({ dist: HATCHERY.wakeRange + 200 });
  c.step(HATCHERY.hatchEvery * 3);
  assert.equal(hatchlings(c.m).length, 0, 'a far-off hive does not fill the map');

  // The enemy budget: hatchlings count toward it and never take the last `headroom` slots.
  const d = nest({ maxEnemies: HATCHERY.headroom + 3 });
  d.step(HATCHERY.hatchEvery * 6);
  assert.ok(d.m.enemies.length <= d.m.maxEnemies - HATCHERY.headroom, `${d.m.enemies.length} hulls`);
  assert.ok(hatchlings(d.m).length >= 1, 'it still breeds into the room it has');
});

test('hatchlings circle, flare, then dive straight through the ship', () => {
  resetTuning();
  const { m, step } = nest();
  step(HATCHERY.hatchEvery);
  const c = hatchlings(m)[0];
  assert.ok(c, 'hatched');
  const seen = new Set();
  let diveHeading = null;
  for (let t = 0; t < 60 * 8 && !(seen.has('dive') && seen.has('orbit') && seen.size === 3); t++) {
    step(DT);
    seen.add(c.state);
    if (c.state === 'dive' && diveHeading === null) diveHeading = Math.atan2(c.vy, c.vx);
    if (c.state === 'dive') {
      assert.ok(Math.abs(Math.atan2(c.vy, c.vx) - diveHeading) < 1e-9, 'no steering mid-dive');
      assert.ok(Math.hypot(c.vx, c.vy) > c.speed, 'the dive is faster than its cruise');
    }
  }
  assert.deepEqual([...seen].sort(), ['cue', 'dive', 'orbit']);
  assert.ok(c.contactMult < 0.5 && !c.sturdy, 'a light sting that pops on impact');
});

test('killing the hatchery bursts its pods and withers its brood in a ripple outward', () => {
  resetTuning();
  const { m, step, hive } = nest();
  step(HATCHERY.hatchEvery * 4);
  const h = hive();
  const brood = hatchlings(m);
  assert.ok(brood.length >= 4, `${brood.length} hatchlings`);
  h.dead = true;
  m.enemies.splice(m.enemies.indexOf(h), 1);
  step(HATCHLING.witherMin * 0.5);
  assert.ok(hatchlings(m).length > 0, 'not all on the same tick: a cascade');
  assert.ok(h.podsBurst, 'the dead hive pops its pods');
  // A ripple: the hatchling nearest the hive withers no later than the farthest one.
  const reach = (c) => Math.hypot(c.x - h.x, c.y - h.y);
  const byReach = [...brood].sort((p, q) => reach(p) - reach(q));
  assert.ok(byReach[0].witherT <= byReach.at(-1).witherT, 'nearest first');
  step(HATCHLING.witherMax + 0.1);
  assert.equal(hatchlings(m).length, 0, 'the brood is gone');
  assert.equal(HOSTILE_DEATH_TIER.hatchery, 3, 'the hive dies big');
});

test('campaign: debuts with the Progenitor (wave 35), features in BROOD WAR, and its pack spawns only hives', () => {
  resetTuning();
  assert.equal(UNLOCK_WAVE.hatchery, 35);
  assert.ok(isBossWave(UNLOCK_WAVE.hatchery));
  assert.ok(BOSS_DEFS.progenitor.debut.includes('hatchery'));
  assert.equal(waveTheme(38).name, 'BROOD WAR');
  assert.ok(waveTheme(38).bias.hatchery >= 3);
  assert.deepEqual(packRoster('hatchery', 35), [['hatchery', 1], ['hatchling', 8]]);
  assert.equal(packRoster('hatchery', 47)[0][1], 2, 'a pair from twelve waves in');

  const em = new EnemyManager();
  const g = Object.assign(Object.create(Game.prototype), {
    enemyManager: em, wave: 40, worldWidth: 4200, worldHeight: 4200,
    spawnPoint: () => ({ x: 2000, y: 2000, onScreen: false }), announceArchetype() {}
  });
  for (const k of Object.keys(TUNING)) if (k.startsWith('spawnWeight')) TUNING[k] = k === 'spawnWeightHatchery' ? 1 : 0;
  g.spawnWavePack();
  assert.deepEqual([...new Set(em.spawnIndicators.map(sp => sp.type))], ['hatchery'], 'hatchlings are bred, not spawned with the pack');
  resetTuning();
});

test('the Field Guide preview shows a hatch and the brood withering with its hive', () => {
  const p = new GuidePreview('hatchery');
  let hatched = false;
  let withered = false;
  for (let i = 0; i < 60 * 13.5; i++) {
    p.step();
    const brood = p.manager.enemies.filter(e => e.type === 'hatchling').length;
    if (brood > 0) hatched = true;
    if (hatched && !p.manager.enemies.some(e => e.type === 'hatchery') && p.t > 10.5 && brood === 0) withered = true;
  }
  assert.ok(hatched, 'the preview hive hatches');
  assert.ok(withered, 'its brood dies with it');
});
