import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 1: the HANGAR_ENABLED flag, the hangar save block and the feat ledger. With the flag off
// (everyone today) nothing changes: no ledger, no new save fields.
const h = await import('../tools/balance/harness.mjs');
const { HANGAR_ENABLED, HANGAR_FLAG_KEY, resolveHangarFlag, hangarEnabled, setHangarEnabled } = await import('../js/hangar-flag.js');
const { normalizeSave } = await import('../js/progression.js');
const { normalizeHangar, newHangar, grantReward, CAREER_COUNTERS, DEFAULT_SHIP } = await import('../js/hangar-save.js');
const { FEATS, FEAT_BY_ID, FeatLedger, featProgress, featComplete } = await import('../js/feats.js');

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const enemy = (extra = {}) => ({ type: 'drone', ...extra });

test('the flag is off by default; ?hangar=1 turns it on and is remembered, ?hangar=0 forgets it', () => {
  assert.equal(HANGAR_ENABLED, false, 'off for every player until Clay signs the Hangar off');
  const s = memoryStorage();
  assert.equal(resolveHangarFlag('', s), false);
  assert.equal(resolveHangarFlag('?mode=x&hangar=1', s), true);
  assert.equal(s.getItem(HANGAR_FLAG_KEY), '1');
  assert.equal(resolveHangarFlag('', s), true, 'remembered on the device');
  assert.equal(resolveHangarFlag('?hangar=0', s), false);
  assert.equal(resolveHangarFlag('', s), false, 'forgotten');
  assert.equal(resolveHangarFlag('?hangar=1', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), true, 'blocked storage: this page only');
  assert.equal(hangarEnabled(), false, 'the test page has no flag');
});

test('a save that never saw the Hangar gets no hangar block (flag off = same saves)', () => {
  const plain = normalizeSave({ pilotName: 'ACE', cores: 50, totalRuns: 3 });
  assert.equal('hangar' in plain, false);
  assert.equal('hangar' in normalizeSave(JSON.parse(JSON.stringify(plain))), false, 'round trip');
  const withHangar = normalizeSave({ ...plain, hangar: { ship: 'mantis', ships: ['mantis'], career: { kills: 12.4, bogus: 5 } } });
  assert.deepEqual(withHangar.hangar.ships, ['vexolith', 'mantis']);
  assert.equal(withHangar.hangar.ship, 'mantis');
  assert.equal(withHangar.hangar.career.kills, 12);
  assert.equal('bogus' in withHangar.hangar.career, false);
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(withHangar))).hangar, withHangar.hangar, 'kept through a round trip');
});

test('normalizeHangar sanitizes ids, dates, tiers and the picked ship', () => {
  const n = normalizeHangar({
    ship: 'ghost', ships: ['mantis', 'BAD ID', 7, 'mantis'], weapons: ['flamethrower', '<x>'],
    feats: { kills_1500: '2026-10-20', rocks_400: 'yesterday', 'no way': '2026-01-01' },
    fresh: ['ship:mantis', 'nope:mantis', 'feat:kills_1500'], mastery: { blaster: 9, rockets: -1, missiles: 2 },
    career: { kills: -5, bestWave: { normal: 25, nonsense: 3 } }, veteran: 'yes'
  });
  assert.equal(n.ship, DEFAULT_SHIP, 'a ship that is not unlocked falls back to VEXOLITH');
  assert.deepEqual(n.ships, ['vexolith', 'mantis']);
  assert.deepEqual(n.weapons, ['flamethrower']);
  assert.deepEqual(n.feats, { kills_1500: '2026-10-20', rocks_400: '1970-01-01' });
  assert.deepEqual(n.fresh, ['ship:mantis', 'feat:kills_1500']);
  assert.deepEqual(n.mastery, { blaster: 4, missiles: 2 });
  assert.equal(n.career.kills, 0);
  assert.equal(n.career.bestWave.normal, 25);
  assert.equal(n.veteran, false);
  for (const k of CAREER_COUNTERS) assert.equal(typeof n.career[k], 'number', k);
});

test('a new hangar is seeded from the save: runs, best waves cleared, veteran status', () => {
  const save = normalizeSave({ totalRuns: 7, highscores: [
    { id: 'a', score: 900, wave: 27, mode: 'normal' }, { id: 'b', score: 500, wave: 12, mode: 'hardcore' }
  ] });
  const hg = newHangar(save);
  assert.equal(hg.career.runs, 7);
  assert.equal(hg.veteran, true);
  assert.equal(hg.career.bestWave.normal, 25, 'reached W27: the W25 boss was beaten');
  assert.equal(hg.career.bestWave.hardcore, 10);
  assert.equal(newHangar(normalizeSave({})).veteran, false, 'a brand-new pilot');
  assert.equal(newHangar(normalizeSave({})).career.bestWave.normal, 0, 'the seeded demo scores do not count');
});

test('every feat has a unique id, a name and text, and each reward is granted by exactly one feat', () => {
  const ids = new Set();
  const rewards = new Set();
  for (const f of FEATS) {
    assert.ok(!ids.has(f.id), f.id);
    ids.add(f.id);
    assert.ok(f.name && f.text, f.id);
    if (f.hidden) assert.ok(f.hint, `${f.id} hidden feats carry a hint`);
    for (const [kind, id] of Object.entries(f.reward)) {
      const key = `${kind}:${id}`;
      assert.ok(!rewards.has(key), `${key} granted twice`);
      rewards.add(key);
    }
  }
  assert.equal(FEATS.filter((f) => f.reward.ship).length, 11, 'every ship but VEXOLITH has its feat');
  assert.ok(FEATS.filter((f) => f.hidden).length >= 3, 'a few secret feats');
});

test('the ledger counts kills, bosses, statuses, rocks, dashes, shield damage and gold', () => {
  const hg = newHangar({});
  const l = new FeatLedger({ mode: 'normal' });
  l.kill(enemy());
  l.kill(enemy({ st: { burn: 2, cold: 0, corrode: 0, frozenMax: 0 } }));
  l.kill(enemy({ st: { burn: 0, cold: 0, corrode: 0, frozenMax: 1.2 } }));
  l.kill(enemy({ isBoss: true, bossWave: 10 }), { hp: 5, maxHp: 100 });
  l.rockMined(); l.rockMined();
  l.dash();
  l.shieldHit(12.6);
  l.goldSpent(40, 520);
  assert.equal(hg.career.kills, 0, 'nothing lands before a commit');
  const done = l.commit(hg);
  const c = hg.career;
  assert.deepEqual([c.kills, c.bossKills, c.afflicted, c.frozen, c.rocksMined, c.dashes, c.shieldDamage, c.goldSpent], [4, 1, 2, 1, 2, 1, 13, 40]);
  assert.equal(c.bestWave.normal, 10);
  assert.equal(c.runs, 0, 'the run counts once it ends');
  const ids = done.map((d) => d.feat.id).sort();
  assert.deepEqual(ids, ['hoarder', 'last_stand', 'wave_10'], 'W10 cleared, 520 gold held, a boss at 5% shield');
  assert.ok(hg.weapons.includes('flamethrower'));
  assert.ok(hg.fresh.includes('weapon:flamethrower') && hg.fresh.includes('feat:wave_10'));
  assert.ok(hg.feats.wave_10.match(/^\d{4}-\d{2}-\d{2}$/));
  l.commit(hg, { end: true });
  assert.equal(c.runs, 1);
  assert.deepEqual(l.commit(hg, { end: true }), [], 'an ended run commits once');
  assert.equal(c.runs, 1);
});

test('career feats complete once their counter reaches the goal, and unlock their ship', () => {
  const hg = newHangar({});
  hg.career.kills = 1499;
  const l = new FeatLedger({ mode: 'hardcore' });
  l.kill(enemy());
  const done = l.commit(hg);
  assert.deepEqual(done.map((d) => d.feat.id), ['kills_1500']);
  assert.deepEqual(done[0].added, ['ship:mantis']);
  assert.ok(hg.ships.includes('mantis'));
  assert.deepEqual(featProgress(FEAT_BY_ID.kills_1500, hg), { value: 1500, goal: 1500, done: true });
  assert.deepEqual(featProgress(FEAT_BY_ID.rocks_400, hg), { value: 0, goal: 400, done: false });
});

test('BLITZ adds no career counts and only completes its own feats; tainted runs count nothing', () => {
  const hg = newHangar({});
  const b = new FeatLedger({ mode: 'blitz' });
  for (let i = 0; i < 5; i++) b.kill(enemy());
  b.kill(enemy({ isBoss: true, bossWave: 10 }));
  const done = b.commit(hg, { end: true });
  assert.equal(hg.career.kills, 0);
  assert.equal(hg.career.runs, 0);
  assert.deepEqual(done.map((d) => d.feat.id), ['blitz_w10'], 'BLITZKRIEG, not FIRST LIGHT');
  assert.equal(hg.career.bestWave.blitz, 10);

  const t = new FeatLedger({ mode: 'normal' });
  t.kill(enemy({ isBoss: true, bossWave: 25 }));
  assert.deepEqual(t.commit(hg, { tainted: true, end: true }), []);
  assert.equal(hg.career.bossKills, 0);
  assert.equal(hg.career.bestWave.normal, 0);
});

test('mastery feats read the mastery tiers', () => {
  assert.equal(featComplete(FEAT_BY_ID.mastery_any, {}, {}), false);
  assert.equal(featComplete(FEAT_BY_ID.mastery_any, {}, { rockets: 1 }), true);
  assert.equal(featComplete(FEAT_BY_ID.mastery_flamethrower, {}, { rockets: 3 }), false);
  assert.equal(featComplete(FEAT_BY_ID.mastery_flamethrower, {}, { flamethrower: 1 }), true);
  const hg = newHangar({});
  assert.deepEqual(grantReward(hg, { ship: 'lancer' }), ['ship:lancer']);
  assert.deepEqual(grantReward(hg, { ship: 'lancer' }), [], 'already unlocked');
});

test('flag off: a headless run has no ledger and leaves no hangar block in the save', () => {
  setHangarEnabled(false, { persist: false });
  const g = h.createHeadlessGame();
  g.resetRun('normal');
  assert.equal(g.feats, null);
  g.killEnemy(Object.assign(g.enemyManager.enemies[0] || {}, {}));
  assert.equal('hangar' in g.progression.data, false);
});

test('flag on: a headless run counts its kills and dashes, lands them at game over, Weapon Range never', () => {
  setHangarEnabled(true, { persist: false });
  try {
    const g = h.createHeadlessGame();
    g.resetRun('normal');
    assert.ok(g.feats, 'a ledger for the run');
    for (let i = 0; i < 3; i++) g.feats.kill(enemy());
    g.triggerDash();
    g.runIsTainted = () => false;
    Object.assign(g, { updateLowShieldVignette() {}, renderGameOver() {} });
    try { g.triggerGameOver(); } catch { /* the headless results screen may need DOM bits; the commit runs first */ }
    const hg = g.progression.data.hangar;
    assert.ok(hg, 'the hangar block is created');
    assert.equal(hg.career.kills, 3);
    assert.equal(hg.career.dashes, 1);
    assert.equal(hg.career.runs, 1);

    const r = h.createHeadlessGame();
    r.range = { active: true };
    r.resetRun('normal');
    assert.equal(r.feats, null, 'the Weapon Range never counts');
  } finally {
    setHangarEnabled(false, { persist: false });
  }
});
