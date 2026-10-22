// /api/stats (netlify/lib/stats.mjs) against an in-memory Netlify Blobs stand-in, and the aggregation
// behind /api/stats/summary, `balance-sim --stats-out` and stats.html (js/stats-aggregate.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStatsHandler, STATS_SERVER_LIMITS, RUNS_PREFIX, STATS_RATE_PREFIX, summaryKey, runKey, summaryVersion, newestFirst, listKeys
} from '../netlify/lib/stats.mjs';
import { hashIp } from '../netlify/lib/leaderboard.mjs';
import { aggregateRuns, percentile, median, flagFor, OUTLIER_BAND, SUMMARY_SCHEMA } from '../js/stats-aggregate.js';
import { STATS_LIMITS, armoryTier } from '../js/stats-rules.js';
import { META_UPGRADES, armorySpent } from '../js/progression.js';
import { KNOWN_VERSIONS } from '../js/changelog.js';
import { GAME_VERSION } from '../js/version.js';

// Same contract as the @netlify/blobs Store for what the handler uses, with paginated list().
class FakeStore {
  constructor({ pageSize = 3 } = {}) {
    this.blobs = new Map();
    this.version = 0;
    this.reads = 0;
    this.pageSize = pageSize;
  }
  async getWithMetadata(key, { type } = {}) {
    assert.equal(type, 'json');
    this.reads++;
    await null;
    const e = this.blobs.get(key);
    return e ? { data: JSON.parse(e.body), etag: e.etag, metadata: {} } : null;
  }
  async setJSON(key, value, opts = {}) {
    await null;
    const cur = this.blobs.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    this.blobs.set(key, { body: JSON.stringify(value), etag: `"v${++this.version}"` });
    return { modified: true };
  }
  list({ prefix = '', paginate = false, directories = false } = {}) {
    const keys = [...this.blobs.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (directories) {
      const dirs = new Set(), blobs = [];
      for (const k of keys) {
        const rest = k.slice(prefix.length);
        if (rest.includes('/')) dirs.add(prefix + rest.split('/')[0]);
        else blobs.push({ key: k });
      }
      return Promise.resolve({ blobs, directories: [...dirs] });
    }
    const pages = [];
    for (let i = 0; i < keys.length; i += this.pageSize) pages.push({ blobs: keys.slice(i, i + this.pageSize).map((key) => ({ key, etag: '' })), directories: [] });
    if (!paginate) return Promise.resolve({ blobs: keys.map((key) => ({ key })), directories: [] });
    return (async function* () { for (const p of pages) yield p; })();
  }
  json(key) { return JSON.parse(this.blobs.get(key).body); }
  keys(prefix = '') { return [...this.blobs.keys()].filter((k) => k.startsWith(prefix)); }
}

function setup(overrides = {}) {
  const store = new FakeStore();
  let clock = Date.parse('2026-10-18T12:00:00Z');
  let ids = 0;
  const handler = createStatsHandler({ store: () => store, now: () => clock, newId: () => `id-${++ids}`, log: null, ...overrides });
  return { store, handler, advance: (ms) => { clock += ms; } };
}

// A minimal real-looking run summary (see js/stats-rules.js).
const runBody = (extra = {}) => ({
  schema: 1, version: GAME_VERSION, time: 300, wave: 14, level: 22, score: 1e6, kills: 1500, died: true, cause: 'gunner',
  levelTimes: [5, 12, 20], gold: { earned: 40, spent: 20, rerolls: 1, locks: 0 }, loadout: [{ id: 'missiles', lv: 2 }],
  weapons: { missiles: { dmg: 900, kills: 30, owned: 100, from: 10, curve: 1, tl: [[10, 1], [60, 2]], lv: { 1: [50, 300, 30, 1000, 10, 100, 3], 2: [50, 600, 60, 1000, 20, 100, 8.49] } } },
  sources: { missile: 900 }, enemies: { gunner: [10, 9, 40, 9, 80, 4] }, cards: { missiles: [3, 2] }, weaponPicks: { missiles: [1, 1] },
  ...extra
});

let ipN = 0;
const freshIp = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`;
function post(handler, body, { ip = freshIp(), contentType = 'application/json', raw } = {}) {
  const req = new Request('https://game.example/api/stats', { method: 'POST', headers: { 'content-type': contentType }, body: raw ?? JSON.stringify(body) });
  return handler(req, { ip });
}
const get = (handler, query = '') => handler(new Request(`https://game.example/api/stats/summary${query}`), {});

test('POST stores one blob per run at runs/<version>/<date>/<id>.json, with no callsign and no IP', async () => {
  const { store, handler } = setup();
  const res = await post(handler, runBody({ name: 'MADKING' }), { ip: '203.0.113.9' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { accepted: true, version: GAME_VERSION });
  const keys = store.keys(RUNS_PREFIX);
  assert.deepEqual(keys, [`runs/${GAME_VERSION}/2026-10-18/id-1.json`]);
  assert.equal(keys[0], runKey(GAME_VERSION, new Date('2026-10-18T12:00:00Z'), 'id-1'));
  const stored = store.json(keys[0]);
  assert.equal(stored.name, undefined);
  assert.equal(stored.weapons.missiles.dmg, 900);
  const everything = JSON.stringify([...store.blobs]);
  assert.ok(!everything.includes('203.0.113.9'), 'the raw IP is stored nowhere');
  assert.ok(store.keys(STATS_RATE_PREFIX + hashIp('203.0.113.9', 'vexolith-survivor')).length === 1, 'the rate limit keys on the salted hash');
});

test('rate limit: one upload per client per cooldown, then accepted again', async () => {
  const { handler, advance, store } = setup();
  assert.equal((await post(handler, runBody(), { ip: '198.51.100.1' })).status, 201);
  const second = await post(handler, runBody(), { ip: '198.51.100.1' });
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('retry-after')) > 0);
  assert.equal((await post(handler, runBody(), { ip: '198.51.100.2' })).status, 201, 'another client is unaffected');
  advance(STATS_SERVER_LIMITS.COOLDOWN_MS);
  assert.equal((await post(handler, runBody(), { ip: '198.51.100.1' })).status, 201);
  assert.equal(store.keys(RUNS_PREFIX).length, 3);
});

test('malformed, oversized, unknown-version and short runs are refused before the cooldown and never stored', async () => {
  const { handler, store } = setup();
  const ip = '192.0.2.7';
  assert.equal((await post(handler, runBody(), { ip, contentType: 'text/plain' })).status, 415);
  assert.equal((await post(handler, null, { ip, raw: '{nope' })).status, 400);
  assert.equal((await post(handler, null, { ip, raw: JSON.stringify(runBody({ pad: 'x'.repeat(STATS_LIMITS.MAX_BODY_BYTES) })) })).status, 413);
  assert.equal((await post(handler, runBody({ version: '99.0.0' }), { ip })).status, 422);
  assert.equal((await post(handler, runBody({ time: 8 }), { ip })).status, 422);
  assert.equal((await post(handler, runBody({ schema: 7 }), { ip })).status, 400);
  assert.equal(store.keys(RUNS_PREFIX).length, 0);
  assert.equal((await post(handler, runBody(), { ip })).status, 201, 'refusals did not burn the cooldown');
  const wrong = await handler(new Request('https://game.example/api/stats'), {});
  assert.equal(wrong.status, 405);
  assert.equal((await handler(new Request('https://game.example/api/stats/summary', { method: 'POST', body: '{}' }), {})).status, 405);
});

test('an older known version is stored under its own folder; versions with runs are listed', async () => {
  const { handler, store } = setup();
  const older = KNOWN_VERSIONS[1];
  assert.equal((await post(handler, runBody({ version: older }))).status, 201);
  assert.equal((await post(handler, runBody())).status, 201);
  assert.equal(store.keys(`runs/${older}/`).length, 1);
  const body = await (await get(handler)).json();
  assert.deepEqual(body.versions, [GAME_VERSION, older]);
  assert.deepEqual(body.knownVersions, KNOWN_VERSIONS);
});

test('summary: aggregates stored runs, caches the result for 10 minutes, then recomputes', async () => {
  const { handler, store, advance } = setup();
  for (let i = 0; i < 4; i++) await post(handler, runBody({ time: 100 * (i + 1) }));
  const first = await (await get(handler, `?version=${GAME_VERSION}`)).json();
  assert.equal(first.schema, SUMMARY_SCHEMA);
  assert.equal(first.runs, 4);
  assert.equal(first.cached, false);
  assert.equal(first.scanned, 4);
  assert.ok(store.blobs.has(summaryKey(GAME_VERSION)), 'the aggregate is cached in a blob');

  await post(handler, runBody({ time: 999 }));
  const cached = await (await get(handler, `?version=${GAME_VERSION}`)).json();
  assert.equal(cached.cached, true);
  assert.equal(cached.runs, 4, 'a fresh cache is served as is');

  advance(STATS_SERVER_LIMITS.CACHE_MS + 1);
  const fresh = await (await get(handler, `?version=${GAME_VERSION}`)).json();
  assert.equal(fresh.cached, false);
  assert.equal(fresh.runs, 5);
  assert.equal((await get(handler, '?version=all')).status, 200);
  assert.equal((await get(handler, '?version=9.9.9')).status, 400);
  assert.equal((await get(handler, '?version=../../x')).status, 400);
});

test('summary stays bounded: list() pages are followed, only the newest MAX_RUNS_SCANNED runs are read', async () => {
  const limits = { ...STATS_SERVER_LIMITS, MAX_RUNS_SCANNED: 3, COOLDOWN_MS: 0 };
  const { handler, store, advance } = setup({ limits });
  for (let d = 0; d < 6; d++) {
    await post(handler, runBody({ time: 100 + d }));
    advance(24 * 3600 * 1000);
  }
  const body = await (await get(handler)).json();
  assert.equal(body.stored, 6, 'every page of the listing was read');
  assert.equal(body.scanned, 3);
  assert.equal(body.truncated, true);
  assert.equal(body.runs, 3);
  assert.equal(body.run.time.median, 104, 'the newest days were picked');
  const listed = await listKeys(store, RUNS_PREFIX, 4);
  assert.equal(listed.keys.length, 4);
  assert.equal(listed.truncated, true);
});

test('helpers: version query, newest-first key order', () => {
  assert.deepEqual(summaryVersion(null), { version: 'all' });
  assert.deepEqual(summaryVersion(GAME_VERSION), { version: GAME_VERSION });
  assert.ok(summaryVersion('1.2.3.4').error);
  assert.deepEqual(newestFirst(['runs/0.12.1/2026-10-17/a.json', 'runs/0.13.0/2026-10-18/b.json', 'runs/0.12.1/2026-10-18/c.json']),
    ['runs/0.13.0/2026-10-18/b.json', 'runs/0.12.1/2026-10-18/c.json', 'runs/0.12.1/2026-10-17/a.json']);
});

test('a broken store returns 500 JSON, not an exception', async () => {
  const handler = createStatsHandler({ store: () => { throw new Error('blobs down'); }, log: null });
  const res = await get(handler);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /unavailable/);
});

// --- Aggregation math ---------------------------------------------------------------------------------
const round4 = (v) => Math.round(v * 1e4) / 1e4;

// Weapon w at level L for `secs` seconds dealing `norm` base-damage units (target T).
const weaponRun = (rows, extra = {}) => ({
  schema: 1, version: GAME_VERSION, time: 600, wave: 20, level: 30, score: 1, kills: 0, died: true, cause: 'swarmer',
  levelTimes: [], gold: { earned: 0, spent: 0, rerolls: 0, locks: 0 }, loadout: [], sources: {}, enemies: {}, cards: {}, weaponPicks: {},
  weapons: Object.fromEntries(rows.map(([id, L, secs, norm, target, curve = 1]) => [id, { dmg: norm * 10, kills: 1, owned: secs, from: 0, curve, lv: { [L]: [secs, norm * 10, norm, norm * 40, 1, 4, target] } }])),
  ...extra
});

test('DPS vs target, the same-level peer index and the ±20% outlier flags', () => {
  // At LV 4 (target 24): alpha realizes 50%, beta 30%, gamma 40%, delta 40% -> median 40%.
  const runs = Array.from({ length: 3 }, () => weaponRun([
    ['alpha', 4, 100, 0.5 * 24 * 100, 24],
    ['beta', 4, 100, 0.3 * 24 * 100, 24],
    ['gamma', 4, 100, 0.4 * 24 * 100, 24],
    ['delta', 4, 100, 0.4 * 24 * 100, 24],
    ['blaster', 4, 100, 99 * 100, 0, 0] // not on the curve: never flagged
  ]));
  const s = aggregateRuns(runs, { version: GAME_VERSION });
  const by = Object.fromEntries(s.weapons.map((w) => [w.id, w]));
  const lv = (id) => by[id].levels.find((r) => r.level === 4);
  assert.equal(lv('alpha').vsTarget, 0.5);
  assert.equal(lv('alpha').normDps, 12);
  assert.equal(lv('alpha').dps, 120);
  assert.equal(lv('alpha').runs, 3);
  assert.equal(lv('alpha').seconds, 300);
  assert.equal(lv('alpha').index, 1.25);
  assert.equal(lv('alpha').flag, 'nerf');
  assert.equal(lv('beta').index, 0.75);
  assert.equal(lv('beta').flag, 'buff');
  assert.equal(lv('gamma').flag, 'ok');
  assert.equal(lv('alpha').dmgShare, 0.25, 'share of all damage while at that level');
  assert.equal(lv('alpha').killShare, 0.25);
  assert.equal(by.alpha.flag, 'nerf');
  assert.equal(by.beta.flag, 'buff');
  assert.equal(by.blaster.flag, null);
  assert.equal(by.blaster.vsTarget, null);
  assert.deepEqual(s.outliers.map((o) => [o.id, o.flag]).sort(), [['alpha', 'nerf'], ['beta', 'buff']]);
  assert.equal(OUTLIER_BAND, 0.2);
  assert.equal(flagFor(1.2), 'ok');
  assert.equal(flagFor(1.21), 'nerf');
  assert.equal(flagFor(0.79), 'buff');
  assert.equal(flagFor(null), null);
});

test('weapon shares leave out Supernova and ram (listed with their share of everything); bombs per run and kills per bomb', () => {
  const run = (extra = {}) => weaponRun([['alpha', 4, 100, 2400, 24], ['beta', 4, 100, 2400, 24]], extra);
  const withBomb = run();
  withBomb.weapons.supernova = { dmg: 48000, kills: 60 };
  for (const id of ['alpha', 'beta']) withBomb.weapons[id].lv[4].push(48000, 2); // weapon-only totals while at LV 4
  withBomb.bombs = [3, 60];
  const older = run(); // an older client: no weapon-only totals, no bombs
  const s = aggregateRuns([withBomb, structuredClone(withBomb), withBomb, older], { version: GAME_VERSION });
  const by = Object.fromEntries(s.weapons.map((w) => [w.id, w]));
  assert.equal(by.alpha.dmgShare, 0.5, 'half of the weapon damage');
  assert.equal(by.alpha.allDmgShare, round4(24000 * 4 / (24000 * 8 + 48000 * 3)), 'its share of everything is kept too');
  assert.equal(by.supernova.isWeapon, false);
  assert.equal(by.supernova.dmgShare, round4(48000 * 3 / (24000 * 8 + 48000 * 3)), 'Supernova: share of all damage');
  const lv4 = by.alpha.levels.find((r) => r.level === 4);
  assert.equal(lv4.dmgShare, round4(24000 * 4 / (48000 * 3 + 96000)), 'per level: weapon-only totals, older runs on all damage');
  assert.deepEqual(s.bombs, { runs: 3, perRun: { median: 3, mean: 3 }, killsPerBomb: 20, weaponDamageShare: round4(24000 * 8 / (24000 * 8 + 48000 * 3)) });
});

test('low-sample weapon levels are reported but never flagged or used as the peer median', () => {
  const runs = [
    ...Array.from({ length: 3 }, () => weaponRun([['alpha', 1, 100, 300, 3], ['beta', 1, 100, 150, 3]])),
    weaponRun([['gamma', 1, 30, 9000, 3]]) // one short run with absurd numbers
  ];
  const s = aggregateRuns(runs);
  const gamma = s.weapons.find((w) => w.id === 'gamma');
  assert.equal(gamma.levels[0].enough, false);
  assert.equal(gamma.levels[0].index, null);
  assert.equal(gamma.flag, null);
  const alpha = s.weapons.find((w) => w.id === 'alpha').levels[0];
  assert.ok(Math.abs(alpha.index - 1 / 0.75) < 0.01, 'median of alpha (1.0) and beta (0.5) is 0.75');
});

test('run shape, enemies, cards and gold aggregate across runs', () => {
  const mk = (time, level, cause, extra = {}) => weaponRun([], { time, level, cause, ...extra });
  const runs = [
    mk(100, 10, 'gunner', { enemies: { gunner: [10, 8, 16, 8, 120, 6], swarmer: [100, 100, 50, 100, 20, 2] }, cards: { firerate: [4, 1], new_weapon: [2, 2] }, gold: { earned: 10, spent: 0, rerolls: 0, locks: 1 } }),
    mk(600, 30, 'gunner', { enemies: { gunner: [20, 20, 60, 20, 80, 4] }, cards: { firerate: [2, 1] }, levelTimes: Array.from({ length: 29 }, (_, i) => i * 20) }),
    mk(1900, 55, 'boss', { enemies: { boss: [3, 2, 120, 2, 300, 3] }, gold: { earned: 50, spent: 40, rerolls: 2, locks: 0 } }),
    mk(2000, 60, null, { died: false })
  ];
  const s = aggregateRuns(runs);
  assert.equal(s.runs, 4);
  assert.equal(s.run.time.median, 1250);
  assert.equal(s.run.time.p90, 2000);
  assert.equal(s.run.level.median, 42.5);
  assert.equal(s.run.reachLevel50, 0.5);
  assert.equal(s.run.reach30min, 0.5);
  assert.equal(s.run.died, 0.75);
  assert.equal(s.run.time.histogram.reduce((a, b) => a + b.count, 0), 4);
  assert.equal(s.run.pace.find((p) => p.level === 20).medianSeconds, 360);
  const gunner = s.enemies.find((e) => e.kind === 'gunner');
  assert.equal(gunner.deaths, 2);
  assert.equal(gunner.deathShare, round3(2 / 3));
  assert.equal(gunner.spawned, 30);
  assert.equal(gunner.timeToKill, round2(76 / 28));
  assert.equal(gunner.playerDamage, 200);
  assert.equal(s.enemies[0].kind, 'gunner', 'deadliest first');
  assert.ok(s.enemies[0].deadly);
  assert.equal(s.deaths.boss, 1);
  const fire = s.cards.find((c) => c.id === 'firerate');
  assert.deepEqual([fire.offered, fire.picked, fire.pickRate], [6, 2, round3(2 / 6)]);
  assert.deepEqual(s.newWeapon, { offered: 2, picked: 2, pickRate: 1 });
  assert.equal(s.gold.earned, 15);
  assert.equal(s.gold.rerolls, 0.5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(aggregateRuns([]).runs, 0, 'an empty store aggregates to an empty summary');
});

function round3(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }

test('the run\'s game mode is stored with it; a payload without one (older clients) is a NORMAL run', async () => {
  const { store, handler } = setup();
  assert.equal((await post(handler, runBody({ mode: 'blitz' }))).status, 201);
  assert.equal((await post(handler, runBody())).status, 201);
  const modes = store.keys(RUNS_PREFIX).map((k) => store.json(k).mode).sort();
  assert.deepEqual(modes, ['blitz', 'normal']);
});

test('Void Armory ranks and cores spent are stored; older payloads without them stay valid ("unknown" tier)', async () => {
  const { store, handler } = setup();
  const maxed = Object.fromEntries(META_UPGRADES.map((u) => [u.id, u.maxRank]));
  assert.equal((await post(handler, runBody({ armory: { magnet: 2, critChance: 1, maxHp: 0, 'bad id': 3 }, armorySpent: 120 }))).status, 201);
  assert.equal((await post(handler, runBody({ armory: {}, armorySpent: 0 }))).status, 201);
  assert.equal((await post(handler, runBody({ armory: maxed, armorySpent: armorySpent(maxed) }))).status, 201);
  assert.equal((await post(handler, runBody())).status, 201);
  const stored = store.keys(RUNS_PREFIX).map((k) => store.json(k));
  const partial = stored.find((r) => r.armorySpent === 120);
  assert.deepEqual(partial.armory, { magnet: 2, critChance: 1 }, 'zero ranks and malformed ids are dropped');
  assert.deepEqual(stored.map(armoryTier).sort(), ['maxed', 'none', 'partial', 'unknown']);
  assert.ok(stored.every((r) => r.name === undefined && r.callsign === undefined), 'no player identifier');

  const all = await (await get(handler, '?version=all')).json();
  assert.equal(all.runs, 4);
  assert.equal(all.armory, 'all');
  assert.deepEqual(all.armoryTiers.map((t) => [t.tier, t.runs]), [['none', 1], ['partial', 1], ['maxed', 1], ['unknown', 1]]);
  const none = await (await get(handler, '?version=all&armory=none')).json();
  assert.equal(none.runs, 1);
  assert.equal(none.armory, 'none');
  assert.equal(none.armoryTiers.find((t) => t.tier === 'partial').runs, 1, 'the tier counts cover every run');
  assert.ok(store.keys(summaryKey('all', 'none')).length === 1, 'each tier has its own cached summary');
  assert.equal((await get(handler, '?version=all&armory=rich')).status, 400);
});
