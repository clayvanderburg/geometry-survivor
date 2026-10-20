import test from 'node:test';
import assert from 'node:assert/strict';

// Hangar PR 7: runs record their ship and solo weapon (Hangar builds only). The payload, local highscores
// and run stats are unchanged for runs without them; the server accepts only known ship ids.
const h = await import('../tools/balance/harness.mjs');
const { buildRunPayload, hangarMark } = await import('../js/leaderboard.js');
const { checkHangar, publicEntry } = await import('../netlify/lib/leaderboard.mjs');
const { normalizeSave } = await import('../js/progression.js');
const { sanitizeRunStats } = await import('../js/stats-rules.js');
const { GAME_VERSION } = await import('../js/version.js');
const { hangarRunTag } = await import('../js/hangar-run.js');
const { setHangarEnabled } = await import('../js/hangar-flag.js');

const base = { name: 'ACE', score: 1000, wave: 5, level: 7, kills: 90, multiplier: 2.1, time: 120, mode: 'normal' };

test('payload: no Hangar fields without a ship or solo run; ship (not VEXOLITH) and solo when set', () => {
  assert.deepEqual(Object.keys(buildRunPayload(base)).sort(), ['kills', 'level', 'mode', 'multiplier', 'name', 'score', 'time', 'version', 'wave']);
  assert.equal('ship' in buildRunPayload({ ...base, ship: 'vexolith' }), false);
  const p = buildRunPayload({ ...base, ship: 'mantis', solo: 'blaster' });
  assert.equal(p.ship, 'mantis');
  assert.equal(p.solo, 'blaster');
  assert.equal('ship' in buildRunPayload({ ...base, ship: 'x-wing' }), false, 'unknown ships are dropped');
});

test('server: known ships and solo weapon ids only; VEXOLITH is the default and not stored', () => {
  assert.deepEqual(checkHangar({}), { tag: {} });
  assert.deepEqual(checkHangar({ ship: 'vexolith' }), { tag: {} });
  assert.deepEqual(checkHangar({ ship: 'hermit', solo: 'shockfield' }), { tag: { ship: 'hermit', solo: 'shockfield' } });
  assert.ok(checkHangar({ ship: 'deathstar' }).error);
  assert.ok(checkHangar({ ship: 7 }).error);
  assert.ok(checkHangar({ solo: '<script>' }).error);
  const e = { id: 'a', name: 'ACE', score: 1, wave: 1, level: 1, kills: 0, multiplier: 1, time: 1, date: 'x', version: '0.43.3' };
  assert.equal('ship' in publicEntry(e), false, 'old entries: unchanged');
  assert.equal(publicEntry({ ...e, ship: 'wasp', solo: 'rockets' }).ship, 'wasp');
});

test('rows: a glyph for the ship and ★ for a solo run; nothing for plain runs', () => {
  assert.deepEqual(hangarMark({ name: 'A' }), {});
  assert.deepEqual(hangarMark({ ship: 'vexolith' }), {});
  assert.deepEqual(hangarMark({ ship: 'revenant', solo: 'blaster' }), { mark: '💀★', title: 'REVENANT · SOLO BLASTER' });
  assert.deepEqual(hangarMark({ solo: 'rockets' }), { mark: '★', title: 'SOLO ROCKETS' });
});

test('local highscores keep a valid ship / solo tag and add nothing to plain runs', () => {
  const s = normalizeSave({ highscores: [{ id: 'a', score: 5, wave: 2, mode: 'normal' }, { id: 'b', score: 9, wave: 3, mode: 'normal', ship: 'wasp', solo: 'rockets' }, { id: 'c', score: 7, wave: 3, ship: 'nope' }] });
  const by = Object.fromEntries(s.highscores.map((e) => [e.id, e]));
  assert.equal('ship' in by.a, false);
  assert.equal(by.b.ship, 'wasp');
  assert.equal(by.b.solo, 'rockets');
  assert.equal('ship' in by.c, false);
  const g = h.createHeadlessGame();
  g.progression.recordRun({ name: 'ACE', score: 50, multiplier: 1, wave: 2, kills: 3, timeStr: '00:30', mode: 'normal', ship: 'pyre' });
  assert.equal(g.progression.data.highscores.find((e) => e.score === 50).ship, 'pyre');
});

test('flag off: the run tag is empty; flag on: ship, solo and (stats) mastery', () => {
  setHangarEnabled(false, { persist: false });
  const off = h.createHeadlessGame();
  off.resetRun('normal', 'rockets');
  assert.deepEqual(hangarRunTag(off), {});
  assert.deepEqual(hangarRunTag(off, { stats: true }), {});
  setHangarEnabled(true, { persist: false });
  try {
    const on = h.createHeadlessGame();
    const hg = on.progression.hangar();
    hg.ships.push('wasp');
    hg.ship = 'wasp';
    hg.mastery = { rockets: 2 };
    on.resetRun('normal');
    assert.deepEqual(hangarRunTag(on), { ship: 'wasp' }, 'one weapon at W1 is not a solo run worth a star');
    on.feats.kill({ isBoss: true, bossWave: 10 });
    assert.deepEqual(hangarRunTag(on), { ship: 'wasp', solo: 'rockets' }, 'solo to W10: ★');
    assert.deepEqual(hangarRunTag(on, { stats: true }), { ship: 'wasp', solo: 'rockets', mastery: { rockets: 2 } });
  } finally {
    setHangarEnabled(false, { persist: false });
  }
});

test('run stats keep the Hangar fields when sent and validate them', () => {
  const body = { schema: 1, version: GAME_VERSION, mode: 'normal', time: 300, wave: 8, level: 10, score: 100, kills: 50 };
  const plain = sanitizeRunStats(body).run;
  assert.equal('ship' in plain, false);
  const tagged = sanitizeRunStats({ ...body, ship: 'hermit', solo: 'shockfield', mastery: { shockfield: 2, bad: 9, 'x y': 1 } }).run;
  assert.equal(tagged.ship, 'hermit');
  assert.equal(tagged.solo, 'shockfield');
  assert.deepEqual(tagged.mastery, { shockfield: 2, bad: 4 });
  assert.equal('ship' in sanitizeRunStats({ ...body, ship: 'ufo' }).run, false);
});
