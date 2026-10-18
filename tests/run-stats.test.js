// In-run stats tracker (js/run-stats.js), upload rules (js/stats-rules.js), the uploader and opt-out
// (js/stats-client.js), the RUN REPORT view (js/run-report.js) and the game's hooks (js/main.js).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { RunStats, buildSourceGroups, enemyKind, SUB_SOURCES } = await import('../js/run-stats.js');
const { sanitizeRunStats, fitPayload, jsonBytes, statsSkipReason, STATS_LIMITS } = await import('../js/stats-rules.js');
const { uploadRunStats, readShareStats, writeShareStats, describeStatsUpload, SHARE_STATS_KEY } = await import('../js/stats-client.js');
const { buildRunReport, runReportHtml } = await import('../js/run-report.js');
const { WEAPONS } = await import('../js/loadout.js');
const { DPS_TARGET, POTENTIAL_DPS } = await import('../js/weapon-scaling.js');
const { GAME_VERSION } = await import('../js/version.js');
const { Game } = await import('../js/main.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

const GROUPS = buildSourceGroups(WEAPONS);
const tracker = () => new RunStats({ version: GAME_VERSION, groups: GROUPS, dpsTarget: DPS_TARGET, onCurve: (id) => id in POTENTIAL_DPS });
const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

test('sources map to their weapons, sub-sources (DoT, collapse, evolutions) included', () => {
  for (const w of WEAPONS) for (const s of w.tagSources) assert.equal(GROUPS[s], w.id, `${s} -> ${w.id}`);
  assert.equal(GROUPS.burn, 'blaster', 'Thermite burn ticks are Pew Pews damage');
  assert.equal(GROUPS.helix, 'blaster', 'Pulsar Helix is a Pew Pews evolution');
  assert.equal(GROUPS.collapse, 'singularity');
  assert.equal(GROUPS.storm, 'missiles', 'Storm Protocol chains fire from missile detonations');
  assert.equal(GROUPS.siege, 'turret');
  for (const [sub, weapon] of Object.entries(SUB_SOURCES)) assert.ok(WEAPONS.some((w) => w.id === weapon), `${sub} belongs to a real weapon`);

  const rs = tracker();
  rs.sync({ blaster: 1, singularity: 2 }, 0, 10);
  rs.damage('blaster', 100);
  rs.damage('burn', 20);
  rs.damage('helix', 30);
  rs.damage('singularity', 40);
  rs.damage('collapse', 60);
  rs.damage('laser', 7); // a weapon added later: its own group, no code change
  rs.damage('blaster', 0);
  rs.damage('blaster', NaN);
  const s = rs.finish({ time: 30 });
  assert.equal(s.weapons.blaster.dmg, 150);
  assert.equal(s.weapons.singularity.dmg, 100);
  assert.equal(s.weapons.laser.dmg, 7);
  assert.deepEqual(s.sources, { blaster: 100, burn: 20, helix: 30, singularity: 40, collapse: 60, laser: 7 });
});

test('DPS per weapon level: seconds, damage, base-damage units and the share while at that level', () => {
  const rs = tracker();
  rs.sync({ missiles: 1 }, 0, 10);
  rs.damage('missile', 300);  // LV 1: 300 damage in 10 s
  rs.damage('blaster', 100);  // someone else's damage in the same window
  rs.kill('missile', { type: 'swarmer' }, 5);
  rs.sync({ missiles: 2 }, 10, 20); // level-up (and a damage upgrade: base 10 -> 20)
  rs.damage('storm', 400);    // LV 2: 400 damage in 20 s
  rs.sync({ missiles: 2 }, 20, 20); // no change: no new segment
  const s = rs.finish({ time: 30 });
  const w = s.weapons.missiles;
  assert.equal(w.curve, 1);
  assert.equal(w.owned, 30);
  assert.equal(w.from, 0);
  assert.deepEqual(w.tl, [[0, 1], [10, 2]]);
  // [secs, dmg, dmg / base, all damage, kills, all kills, DPS_TARGET]
  assert.deepEqual(w.lv[1], [10, 300, 30, 400, 1, 1, Math.round(DPS_TARGET(1) * 100) / 100]);
  assert.deepEqual(w.lv[2], [20, 400, 20, 400, 0, 0, Math.round(DPS_TARGET(2) * 100) / 100]);
  assert.equal(s.weapons.blaster.lv, undefined, 'damage without a level is a plain group');
});

test('a discarded weapon stops its clock; re-equipping starts a new segment', () => {
  const rs = tracker();
  rs.sync({ blaster: 1, drones: 1 }, 0);
  rs.sync({ blaster: 1 }, 15);   // drones discarded
  rs.damage('drone', 50);         // a bolt still in flight lands after the discard
  rs.sync({ blaster: 1, drones: 1 }, 40);
  const s = rs.finish({ time: 50 });
  assert.equal(s.weapons.drones.owned, 25);
  assert.equal(s.weapons.drones.lv[1][0], 25);
  assert.equal(s.weapons.drones.lv[1][1], 0, 'damage while unequipped is not booked to a level');
  assert.equal(s.weapons.drones.dmg, 50);
  assert.deepEqual(s.weapons.drones.tl, [[0, 1], [15, 0], [40, 1]]);
  assert.equal(s.weapons.blaster.curve, 1, 'Pew Pews levels like every other weapon');
});

test('enemies: spawns, kills, spawn-to-death time, damage to the ship and the cause of death', () => {
  const rs = tracker();
  const a = { type: 'swarmer' }, b = { type: 'gunner', isLieutenant: true }, boss = { type: 'boss', isBoss: true };
  rs.enemySpawned(a, 2);
  rs.enemySpawned(b, 4);
  rs.enemySpawned(boss, 5);
  assert.equal(a.spawnedAt, 2);
  rs.kill('blaster', a, 5);
  rs.kill('ram', { type: 'pinwheel' }, 6); // never seen spawning: counted, not timed
  rs.playerHit('gunner', 12);
  rs.playerHit(enemyKind(b), 30);
  rs.playerHit(enemyKind(boss), 58, true);
  const s = rs.finish({ time: 60, died: true });
  assert.deepEqual(s.enemies.swarmer, [1, 1, 3, 1, 0, 0]);
  assert.deepEqual(s.enemies.pinwheel, [0, 1, 0, 0, 0, 0]);
  assert.deepEqual(s.enemies.lieutenant, [1, 0, 0, 0, 30, 1]);
  assert.deepEqual(s.enemies.gunner, [0, 0, 0, 0, 12, 1]);
  assert.equal(s.cause, 'boss');
  assert.equal(s.weapons.ram.kills, 1);
  assert.equal(rs.finish({ time: 99 }), s, 'finish is idempotent');
});

test('cards: offers vs picks, the locked card is not re-counted on a reroll, NEW WEAPON picks per weapon', () => {
  const rs = tracker();
  const fire = { id: 'firerate' }, nw = { id: 'new_weapon', isNewWeapon: true }, pierce = { id: 'pierce' };
  rs.offered([fire, nw, pierce]);
  rs.lock();
  rs.reroll();
  rs.offered([fire, { id: 'magnet' }, { id: 'overdrive' }], fire); // fire stays locked through the reroll
  rs.picked(nw);
  rs.offered([{ id: 'weapon:drones', weaponId: 'drones', isWeaponPick: true }, { id: 'weapon:mines', weaponId: 'mines', isWeaponPick: true }]);
  rs.picked({ id: 'weapon:mines', weaponId: 'mines', isWeaponPick: true });
  const s = rs.finish({ time: 30, gold: { earned: 40, spent: 25 } });
  // [offered, picked, eligible hands, expected draws, draws]: no odds recorded in this test.
  assert.deepEqual(s.cards.firerate, [1, 0, 0, 0, 0]);
  assert.deepEqual(s.cards.new_weapon, [1, 1, 0, 0, 0]);
  assert.deepEqual(s.cards.magnet, [1, 0, 0, 0, 0]);
  assert.deepEqual(s.weaponPicks, { drones: [1, 0, 0, 0, 0], mines: [1, 1, 0, 0, 0] });
  assert.deepEqual(s.gold, { earned: 40, spent: 25, rerolls: 1, locks: 1, banishes: 0 });
});

test('level timeline: each level-up is stamped once, skipped levels share the time', () => {
  const rs = tracker();
  rs.levelReached(1, 0);
  rs.levelReached(2, 5.04);
  rs.levelReached(4, 9);
  rs.levelReached(4, 12);
  assert.deepEqual(rs.finish({ time: 20 }).levelTimes, [5, 9, 9]);
});

// --- Upload rules -----------------------------------------------------------------------------------

const sampleRun = (extra = {}) => {
  const rs = tracker();
  rs.sync({ blaster: 1, missiles: 3 }, 0, 10);
  rs.damage('blaster', 500);
  rs.damage('missile', 900);
  rs.kill('missile', { type: 'swarmer' }, 10);
  rs.playerHit('swarmer', 100, true);
  rs.offered([{ id: 'firerate' }, { id: 'new_weapon' }]);
  rs.picked({ id: 'firerate' });
  rs.levelReached(5, 40);
  return { ...rs.finish({ time: 95.5, wave: 5, level: 5, score: 12345, kills: 300, died: true, loadout: [{ id: 'blaster', lv: 1 }, { id: 'missiles', lv: 3 }] }), ...extra };
};

test('skip rules: opted out, dev-tuner tainted and runs under 20 s are not sent', () => {
  assert.equal(statsSkipReason({ share: true, tainted: false, time: 95 }), null);
  assert.equal(statsSkipReason({ share: false, tainted: false, time: 95 }), 'optout');
  assert.equal(statsSkipReason({ share: true, tainted: true, time: 95 }), 'tainted');
  assert.equal(statsSkipReason({ share: true, tainted: false, time: 19.9 }), 'short');
  assert.equal(statsSkipReason({ share: true, tainted: false, time: STATS_LIMITS.MIN_RUN_SECONDS }), null);
});

test('sanitize: a real summary passes unchanged; versions, schema, short runs and junk are handled', () => {
  const run = sampleRun();
  const { run: clean } = sanitizeRunStats(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(clean, JSON.parse(JSON.stringify(run)), 'what the game sends survives validation as-is');
  assert.equal(sanitizeRunStats({ ...run, version: '9.9.9' }).status, 422);
  assert.equal(sanitizeRunStats({ ...run, version: undefined }).status, 422);
  assert.equal(sanitizeRunStats({ ...run, schema: 2 }).status, 400);
  assert.equal(sanitizeRunStats({ ...run, time: 12 }).status, 422);
  assert.equal(sanitizeRunStats({ ...run, time: 'long' }).status, 400);
  assert.equal(sanitizeRunStats([run]).status, 400);

  const junk = sanitizeRunStats({
    ...run, name: 'MADKING', ip: '1.2.3.4', score: 1e20, kills: -5, level: 0, cause: '<script>',
    weapons: { 'BAD ID!': { dmg: 1 }, missiles: { dmg: 'x', kills: 1e12, lv: { 1: [99999, 5, 5, 5, 5, 5, 3], foo: [1], 3: [0, 1] }, curve: 7, tl: [[1, 2], 'x', [1]] } },
    enemies: { swarmer: [1, 2, 3, 99, 5, 6] },
    cards: { firerate: [2, 9] },
    levelTimes: Array.from({ length: 500 }, (_, i) => i)
  }).run;
  assert.equal(junk.name, undefined, 'unknown fields (a callsign, an IP) are dropped');
  assert.equal(junk.ip, undefined);
  assert.equal(junk.score, 1e13);
  assert.equal(junk.kills, 0);
  assert.equal(junk.level, 1);
  assert.equal(junk.cause, null);
  assert.equal(junk.weapons['BAD ID!'], undefined);
  assert.equal(junk.weapons.missiles.dmg, 0);
  assert.equal(junk.weapons.missiles.kills, STATS_LIMITS.MAX_COUNT);
  assert.equal(junk.weapons.missiles.curve, 0);
  assert.deepEqual(Object.keys(junk.weapons.missiles.lv), ['1'], 'bad and empty level rows are skipped');
  assert.equal(junk.weapons.missiles.lv[1][0], run.time, 'seconds at a level never exceed the run');
  assert.deepEqual(junk.weapons.missiles.tl, [[1, 2]]);
  assert.equal(junk.enemies.swarmer[3], 2, 'timed deaths never exceed kills');
  assert.deepEqual(junk.cards.firerate, [2, 2, 0, 0, 0], 'picks never exceed offers; old 2-number rows read as no fairness data');
  assert.equal(junk.levelTimes.length, STATS_LIMITS.MAX_LEVEL_TIMES);
});

test('payload size: typical runs fit untouched, oversized ones are trimmed under 16 KB', () => {
  const run = sampleRun();
  assert.ok(jsonBytes(run) < 4096);
  assert.equal(fitPayload(run), run);
  const huge = sampleRun({
    levelTimes: Array.from({ length: 200 }, (_, i) => i * 9.5),
    cards: Object.fromEntries(Array.from({ length: 160 }, (_, i) => [`card_number_${i}`, [i + 1, 0]])),
    sources: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`source_${i}`, i * 1000])),
    enemies: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`enemy_kind_${i}`, [i, i, i, i, i, i]]))
  });
  for (let i = 0; i < 24; i++) huge.weapons[`weapon_${i}`] = { dmg: 1, kills: 1, owned: 1, from: 0, curve: 1, tl: Array.from({ length: 40 }, (_, k) => [k, k]), lv: Object.fromEntries(Array.from({ length: 30 }, (_, k) => [k + 1, [1, 1, 1, 1, 1, 1, 1]])) };
  assert.ok(jsonBytes(huge) > STATS_LIMITS.MAX_BODY_BYTES);
  const fit = fitPayload(huge);
  assert.ok(jsonBytes(fit) <= STATS_LIMITS.MAX_BODY_BYTES, `trimmed to ${jsonBytes(fit)} bytes`);
  assert.ok(fit.weapons.missiles && fit.weapons.blaster, 'the real weapons are kept');
  assert.ok(jsonBytes(huge) > STATS_LIMITS.MAX_BODY_BYTES, 'the original is not modified');
  assert.ok(!sanitizeRunStats(fit).error);
});

// --- Uploader and opt-out ---------------------------------------------------------------------------

test('opt-out setting: on by default, persisted, and blocked storage never throws', () => {
  const storage = memoryStorage();
  assert.equal(readShareStats(storage), true);
  assert.equal(writeShareStats(storage, false), true);
  assert.equal(storage.map.get(SHARE_STATS_KEY), '0');
  assert.equal(readShareStats(storage), false);
  writeShareStats(storage, true);
  assert.equal(readShareStats(storage), true);
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(readShareStats(blocked), true);
  assert.equal(writeShareStats(blocked, false), false);
  assert.equal(readShareStats(null), true);
});

test('upload: skipped runs never touch the network; success, cooldown and offline resolve to states', async () => {
  let calls = 0, body = null;
  const fetchImpl = async (url, init) => { calls++; body = JSON.parse(init.body); return jsonResponse(201, { accepted: true }); };
  const run = sampleRun();
  assert.deepEqual(await uploadRunStats(run, { share: false, fetchImpl }), { ok: false, reason: 'optout' });
  assert.deepEqual(await uploadRunStats(run, { tainted: true, fetchImpl }), { ok: false, reason: 'tainted' });
  assert.deepEqual(await uploadRunStats({ ...run, time: 10 }, { fetchImpl }), { ok: false, reason: 'short' });
  assert.equal(calls, 0);
  assert.deepEqual(await uploadRunStats(run, { fetchImpl }), { ok: true });
  assert.equal(calls, 1);
  assert.equal(body.version, GAME_VERSION);
  assert.equal(body.name, undefined, 'no callsign is sent');
  assert.equal((await uploadRunStats(run, { fetchImpl: async () => jsonResponse(429, { error: 'slow down' }) })).reason, 'cooldown');
  assert.equal((await uploadRunStats(run, { fetchImpl: async () => jsonResponse(422, { error: 'unknown game version' }) })).reason, 'rejected');
  assert.equal((await uploadRunStats(run, { fetchImpl: async () => { throw new TypeError('failed'); } })).reason, 'offline');
  assert.equal((await uploadRunStats(run, { fetchImpl: async () => new Response('Not found', { status: 404 }) })).reason, 'unavailable', 'a 404 page (no function deployed) fails gracefully');
  assert.equal((await uploadRunStats(run, { fetchImpl: () => new Promise(() => {}), timeoutMs: 20 })).reason, 'timeout');
  assert.match(describeStatsUpload({ ok: true }), /SENT/);
  assert.match(describeStatsUpload({ reason: 'optout' }), /OFF/);
  assert.match(describeStatsUpload({ reason: 'tainted' }), /DEV TUNER/);
  assert.match(describeStatsUpload({ reason: 'short' }), /SHORT/);
  assert.match(describeStatsUpload({ reason: 'timeout' }), /OFFLINE/);
});

test('game over: tainted, short and opted-out runs are not sent; a normal run is', async () => {
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent++; return jsonResponse(201, { accepted: true }); };
  try {
    const fake = { shareStats: true, runTainted: true, renderRunReportPanel() {} };
    const run = sampleRun();
    Game.prototype.submitRunStats.call(fake, run);
    assert.deepEqual(fake.statsUpload, { ok: false, reason: 'tainted' });

    fake.runTainted = false;
    const key = Object.keys(DEFAULT_TUNING).find((k) => typeof DEFAULT_TUNING[k] === 'number' && !/Volume$/.test(k));
    TUNING[key] = DEFAULT_TUNING[key] + 1;
    Game.prototype.submitRunStats.call(fake, run);
    assert.deepEqual(fake.statsUpload, { ok: false, reason: 'tainted' }, 'saved tuner changes count too');
    TUNING[key] = DEFAULT_TUNING[key];

    Game.prototype.submitRunStats.call(fake, { ...run, time: 15 });
    assert.deepEqual(fake.statsUpload, { ok: false, reason: 'short' });

    fake.shareStats = false;
    Game.prototype.submitRunStats.call(fake, run);
    assert.deepEqual(fake.statsUpload, { ok: false, reason: 'optout' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sent, 0);

    fake.shareStats = true;
    Game.prototype.submitRunStats.call(fake, run);
    assert.deepEqual(fake.statsUpload, { pending: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(sent, 1);
    assert.deepEqual(fake.statsUpload, { ok: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('pause toggle flips and persists SHARE ANONYMOUS STATS', () => {
  const storage = memoryStorage();
  const prev = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const fake = { shareStats: true, syncShareStatsButton() {} };
    Game.prototype.toggleShareStats.call(fake);
    assert.equal(fake.shareStats, false);
    assert.equal(storage.map.get(SHARE_STATS_KEY), '0');
    assert.equal(readShareStats(storage), false);
    Game.prototype.toggleShareStats.call(fake);
    assert.equal(storage.map.get(SHARE_STATS_KEY), '1');
  } finally {
    globalThis.localStorage = prev;
  }
});

// --- RUN REPORT ---------------------------------------------------------------------------------------

test('run report: weapon bars with share and DPS, top threats with the final blow, headline numbers', () => {
  const run = sampleRun();
  const view = buildRunReport(run, { info: (id) => ({ name: id.toUpperCase(), color: '#fff' }), enemyName: (k) => `<${k}>`, upload: 'ANONYMOUS STATS SENT' });
  assert.deepEqual(view.bars.map((b) => b.id), ['missiles', 'blaster']);
  assert.ok(Math.abs(view.bars[0].share - 900 / 1400) < 1e-9);
  assert.ok(Math.abs(view.bars[0].dps - 900 / 95.5) < 1e-6, 'DPS over the time the weapon was equipped');
  assert.equal(view.bars[0].level, 3);
  assert.equal(view.killers[0].kind, 'swarmer');
  assert.equal(view.killers[0].fatal, true);
  assert.equal(view.headline[0].value, '1400');
  const html = runReportHtml(view);
  assert.match(html, /64%/);
  assert.match(html, /&lt;swarmer&gt;/, 'names are escaped');
  assert.match(html, /data-gp-nav/, 'rows are reachable by the controller');
  assert.ok(!/TUNER|TUNING/.test(html), 'nothing in the player-facing report points at the dev tools');

  const many = sampleRun();
  for (let i = 0; i < 9; i++) many.weapons[`w${i}`] = { dmg: 10 + i, kills: 0 };
  const folded = buildRunReport(many);
  assert.equal(folded.bars.length, 7);
  assert.match(folded.bars.at(-1).name, /^Other \(\d+\)$/);
  assert.ok(buildRunReport({ time: 30, weapons: {}, enemies: {} }).empty);
});

// --- The real game feeds the tracker ------------------------------------------------------------------

test('a simulated run fills the same stats the browser uploads, matching the balance harness attribution', async () => {
  const h = await import('../tools/balance/harness.mjs');
  const r = h.simulateRun({ strategy: { name: 'explosive', priorities: ['new_weapon', 'missiles', 'lightning', 'evo_tempest'], weapons: ['missiles', 'lightning'] }, seed: 'stats:1', maxSeconds: 150 });
  const s = r.stats;
  assert.equal(s.schema, 1);
  assert.equal(s.version, GAME_VERSION);
  assert.ok(!sanitizeRunStats(s).error, 'the sim summary passes server validation');
  assert.ok(s.weapons.blaster.lv[1][0] > 0, 'Pew Pews time is tracked from the start');
  assert.ok(s.weapons.missiles?.dmg > 0, 'the equipped missiles are credited');
  const total = Object.values(s.weapons).reduce((a, w) => a + w.dmg, 0);
  const harness = Object.values(r.dealt).reduce((a, v) => a + v, 0);
  // The harness books the damage requested (before armor and crits), the tracker what landed: close.
  assert.ok(Math.abs(total - harness) / harness < 0.05, `tracker ${total} vs harness ${harness}`);
  assert.ok(Math.abs(s.sources.blaster - r.dealt.blaster) / r.dealt.blaster < 0.05, `blaster ${s.sources.blaster} vs ${r.dealt.blaster}`);
  const kills = Object.values(s.weapons).reduce((a, w) => a + w.kills, 0);
  assert.equal(kills, s.kills, 'every kill is credited to exactly one damage group');
  const spawned = Object.values(s.enemies).reduce((a, e) => a + e[0], 0);
  assert.ok(spawned >= s.kills * 0.9, 'spawns are counted');
  assert.equal(s.levelTimes.length, s.level - 1);
  assert.ok(Object.values(s.cards).reduce((a, c) => a + c[1], 0) >= s.level - 1 - 2, 'every level-up pick is recorded');
});

test('card fairness: eligible hands, expected and actual random draws, weapon picks uniform', () => {
  const rs = tracker();
  rs.handOdds(new Map([['firerate', 0.5], ['pierce', 0.25], ['magnet', 0.25]]), [{ id: 'firerate' }]);
  rs.handOdds(new Map([['firerate', 0.5], ['pierce', 0.5]]), [{ id: 'pierce' }]);
  rs.weaponPickOdds(['drones', 'mines', 'turret', 'orbitals'], [{ id: 'weapon:drones', weaponId: 'drones', isWeaponPick: true }]);
  const s = rs.finish({ time: 30 });
  assert.deepEqual(s.cards.firerate, [0, 0, 2, 1, 1]);
  assert.deepEqual(s.cards.pierce, [0, 0, 2, 0.75, 1]);
  assert.deepEqual(s.cards.magnet, [0, 0, 1, 0.25, 0]);
  assert.deepEqual(s.weaponPicks.drones, [0, 0, 1, 0.25, 1]);
  assert.deepEqual(s.weaponPicks.mines, [0, 0, 1, 0.25, 0]);
});

test('card fairness flags need a real gap: >25% off and beyond noise (|z| >= 3)', async () => {
  const { aggregateRuns } = await import('../js/stats-aggregate.js');
  const run = (cards) => ({ ...sampleRun(), cards });
  const agg = aggregateRuns([run({ fair: [0, 0, 100, 40, 41], noisy: [0, 0, 100, 22, 32], rigged: [0, 0, 300, 100, 160], starved: [0, 0, 300, 100, 50], rare: [0, 0, 50, 4, 9] })]);
  const by = Object.fromEntries(agg.cards.map((c) => [c.id, c]));
  assert.equal(by.fair.flag, null);
  assert.equal(by.noisy.flag, null, '+45% but only ~2 sigma: noise, not flagged');
  assert.equal(by.rigged.flag, 'over');
  assert.equal(by.starved.flag, 'under');
  assert.equal(by.rare.lowSample, true);
  assert.equal(by.rare.flag, null);
});
