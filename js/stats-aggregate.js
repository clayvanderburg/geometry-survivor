// Aggregates run summaries (js/run-stats.js, sanitized by js/stats-rules.js) into the balance summary
// served by GET /api/stats/summary, written by `tools/balance-sim.mjs --stats-out` and drawn by
// stats.html. Pure and dependency-free so the server, the sim and the dashboard share it.
//
// The weapon rule (js/weapon-scaling.js): every weapon on the DPS curve has the same POTENTIAL DPS at
// the same level, DPS_TARGET(lv) x base damage. Each run reports, per weapon level, the damage dealt in
// units of base damage and DPS_TARGET(lv), so:
//   vsTarget = (damage / base damage) / seconds at that level / DPS_TARGET(lv)   (realized share of potential)
// Real fights never land every attack, so every weapon realizes only part of its potential. What the
// rule predicts is that they realize the SAME part at the same level, so a weapon is judged against its
// peers at that level:
//   levelIndex = vsTarget / median(vsTarget of the curve weapons with enough data at that level)
// But how much of its potential a weapon realizes also depends on WHEN it is held: a late pick-up sits at
// LV 1-3 in a dense, tanky wave 15 and realizes far more than the LV 1-3 weapons of the first minute (v0.46: the
// Autocannon re-bought at minute 4 read 14.7x its target). So the index that flags a weapon compares it with the
// other weapons over the same stretch of the run:
//   index = its realized potential / what a typical curve weapon (the median weapon effect of a seconds-weighted
//           log fit: weapon + run time + level) realizes at the same run times (TIME_INDEX_BUCKETS, by the mean run
//           time each level was held) and the same levels (LEVEL_INDEX_BUCKETS)
// and falls back to levelIndex where a weapon level has too little data. vsAutocannon = index / the Autocannon's.
// index > 1 + OUTLIER_BAND -> "needs nerf", index < 1 - OUTLIER_BAND -> "needs buff".
//
// Shares: a weapon's dmgShare / killShare (overall and per level) are of WEAPON damage and kills only, without
// the non-weapon groups (run-stats.js NON_WEAPON_GROUPS: Supernova, ram, ...), which are listed with their share
// of all damage. A Supernova wipes a screen at once (~15% of all damage), so leaving it in diluted every
// weapon's share, and weak builds bomb more. allDmgShare / allKillShare keep the share of everything.

import { armoryTier, ARMORY_TIERS } from './stats-rules.js';
import { NON_WEAPON_GROUPS } from './run-stats.js';

export const SUMMARY_SCHEMA = 'vexolith-stats-summary/1';
export const OUTLIER_BAND = 0.2;
// A weapon level needs this much data before it is compared (fewer runs/seconds -> "low sample").
export const MIN_SAMPLE = Object.freeze({ runs: 3, seconds: 60 });
// Card fairness: flag a card drawn more than ±25% off its expected count when that gap is also beyond
// random noise (|z| >= 3, z = (drawn - expected) / sqrt(expected)), once ~20 draws were expected.
export const FAIRNESS_BAND = 0.25;
export const FAIRNESS_MIN_EXPECTED = 20;
export const FAIRNESS_Z = 3;
export const TARGET_LEVEL = 50;       // the user's targets: reach LV 50 ...
export const TARGET_SECONDS = 30 * 60; // ... and survive 30 minutes
// Run-time buckets (s) for the time-normalized index.
export const TIME_INDEX_BUCKETS = Object.freeze([60, 120, 240, 420, 660, 960, 1320]);
const timeBucket = (t) => { let i = 0; while (i < TIME_INDEX_BUCKETS.length && t >= TIME_INDEX_BUCKETS[i]) i++; return i; };
// Weapon-level buckets for the same fit (a level's realized share falls as the level climbs past the wave).
export const LEVEL_INDEX_BUCKETS = Object.freeze([2, 3, 4, 6, 9, 13]);
const levelBucket = (L) => { let i = 0; while (i < LEVEL_INDEX_BUCKETS.length && L >= LEVEL_INDEX_BUCKETS[i]) i++; return i; };
// Seconds-weighted fit of log(realized share) = weapon + time bucket + level bucket (alternating means). Returns the
// share a typical weapon (median effect among weapons with minSecs of data) realizes at a sample's time and level.
function fitShares(samples, minSecs) {
  const ys = samples.map((s) => Math.log(Math.max(1e-4, s.units / s.secs)));
  for (const s of samples) s.lb = levelBucket(s.level);
  const W = new Map(), T = new Map(), Lv = new Map();
  const w = (s) => W.get(s.id) || 0, t = (s) => T.get(s.tb) || 0, l = (s) => Lv.get(s.lb) || 0;
  const refit = (eff, keyOf, others) => {
    const acc = new Map();
    samples.forEach((s, i) => {
      const a = acc.get(keyOf(s)) || [0, 0];
      acc.set(keyOf(s), a);
      a[0] += s.secs * (ys[i] - others(s)); a[1] += s.secs;
    });
    for (const [k, [num, den]] of acc) eff.set(k, den > 0 ? num / den : 0);
  };
  // Time and level first: where a weapon was only ever held at one time and level, the gap is put down to when it
  // was held, not to the weapon (never flag what the data can't separate).
  for (let it = 0; it < 40; it++) {
    refit(T, (s) => s.tb, (s) => w(s) + l(s));
    refit(Lv, (s) => s.lb, (s) => w(s) + t(s));
    refit(W, (s) => s.id, (s) => t(s) + l(s));
  }
  const secsBy = new Map();
  for (const s of samples) secsBy.set(s.id, (secsBy.get(s.id) || 0) + s.secs);
  const base = median([...W].filter(([id]) => secsBy.get(id) >= minSecs).map(([, v]) => v)) ?? 0;
  return { expected: (s) => Math.exp(base + t(s) + l(s)) };
}
// Mean run time a weapon held level L, from its level timeline [[t, lv], ...] (older runs lack row[9]).
function timelineMean(tl, L, end) {
  let secs = 0, tsum = 0;
  for (let i = 0; i < (tl?.length || 0); i++) {
    if (tl[i][1] !== L) continue;
    const a = tl[i][0], b = i + 1 < tl.length ? tl[i + 1][0] : end;
    if (b > a) { secs += b - a; tsum += (b - a) * (a + b) / 2; }
  }
  return secs > 0 ? tsum / secs : null;
}
const TIME_BUCKETS = [[0, 120], [120, 300], [300, 600], [600, 900], [900, 1200], [1200, 1800], [1800, Infinity]];
const LEVEL_BUCKETS = [[1, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, Infinity]];
const PACE_LEVELS = [10, 20, 30, 40, 50];

const sum = (a) => a.reduce((x, y) => x + y, 0);
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const ratio = (a, b) => (b > 0 ? a / b : null);

// Nearest-rank percentile (p in 0..1) of a numeric list; null when empty.
export function percentile(values, p) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const rank = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[rank];
}
export function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function flagFor(index, band = OUTLIER_BAND) {
  if (!Number.isFinite(index)) return null;
  if (index > 1 + band) return 'nerf';
  if (index < 1 - band) return 'buff';
  return 'ok';
}

const bucketLabel = ([a, b], unit) => (b === Infinity ? `${a / (unit === 'min' ? 60 : 1)}+` : unit === 'min' ? `${a / 60}-${b / 60}` : `${a}-${b}`);
function histogram(values, buckets, unit) {
  return buckets.map(([a, b]) => ({ label: bucketLabel([a, b], unit), count: values.filter((v) => v >= a && (b === Infinity || (unit === 'min' ? v < b : v <= b))).length }));
}

// `armory`: one of ARMORY_TIERS (js/stats-rules.js) to aggregate only runs flown with that Void Armory
// tier; the summary's `armoryTiers` always counts every tier of the unfiltered runs.
export function aggregateRuns(runs, { version = 'all', source = 'players', generatedAt = new Date().toISOString(), band = OUTLIER_BAND, minSample = MIN_SAMPLE, armory = null } = {}) {
  const valid = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === 'object' && Number.isFinite(r.time));
  const armoryTiers = ARMORY_TIERS.map((tier) => {
    const rs = valid.filter((r) => armoryTier(r) === tier);
    return { tier, runs: rs.length, medianTime: round(median(rs.map((r) => r.time)), 1), medianWave: median(rs.map((r) => r.wave)) };
  });
  const list = armory ? valid.filter((r) => armoryTier(r) === armory) : valid;
  const n = list.length;
  const times = list.map((r) => r.time);
  const levels = list.map((r) => r.level);

  // --- Weapons and other damage groups -----------------------------------------------------------
  const groups = new Map();
  const samples = []; // { id, level, secs, units (realized potential, DPS_TARGET-seconds), tb } per run and weapon level
  let allDamage = 0, allKills = 0, weaponDamage = 0, weaponKills = 0;
  for (const r of list) {
    for (const [id, w] of Object.entries(r.weapons || {})) {
      const g = groups.get(id) || { id, runs: 0, dmg: 0, kills: 0, owned: 0, isWeapon: false, curve: false, levels: new Map(), acquiredAt: [] };
      groups.set(id, g);
      g.runs++;
      g.dmg += w.dmg || 0;
      g.kills += w.kills || 0;
      allDamage += w.dmg || 0;
      allKills += w.kills || 0;
      if (!NON_WEAPON_GROUPS.has(id)) {
        weaponDamage += w.dmg || 0;
        weaponKills += w.kills || 0;
      }
      if (w.lv && typeof w.lv === 'object') {
        g.isWeapon = true;
        g.curve ||= w.curve === 1;
        g.owned += w.owned || 0;
        if (Number.isFinite(w.from)) g.acquiredAt.push(w.from);
        for (const [lv, row] of Object.entries(w.lv)) {
          const L = Number(lv);
          const b = g.levels.get(L) || { level: L, runs: 0, secs: 0, dmg: 0, norm: 0, allDmg: 0, kills: 0, allKills: 0, wAllDmg: 0, wAllKills: 0, target: 0 };
          g.levels.set(L, b);
          b.runs++;
          b.secs += row[0] || 0;
          b.dmg += row[1] || 0;
          b.norm += row[2] || 0;
          b.allDmg += row[3] || 0;
          b.kills += row[4] || 0;
          b.allKills += row[5] || 0;
          // Weapon-only totals (row[7], row[8]); runs from before they were recorded fall back to all damage.
          b.wAllDmg += row.length >= 9 ? row[7] || 0 : row[3] || 0;
          b.wAllKills += row.length >= 9 ? row[8] || 0 : row[5] || 0;
          if (row[6] > 0) b.target = row[6];
          // When it was held: the recorded mean (row[9]), else the level timeline, else the middle of its ownership.
          // (A timeline's last level runs to the end of its ownership, from + owned, which a discard would cut.)
          const tm = Number.isFinite(row[9]) ? row[9] : timelineMean(w.tl, L, Math.min(r.time, (w.from || 0) + (w.owned || r.time))) ?? (w.from || 0) + (w.owned || 0) / 2;
          b.tsum = (b.tsum || 0) + tm * (row[0] || 0);
          if (w.curve === 1 && row[6] > 0 && row[0] > 0) samples.push({ id, level: L, secs: row[0], units: (row[2] || 0) / row[6], tb: timeBucket(tm) });
        }
      }
    }
  }

  const enough = (b) => b.runs >= minSample.runs && b.secs >= minSample.seconds;
  const levelRows = new Map(); // level -> [{ g, row }] of curve weapons with enough data
  const weapons = [...groups.values()].map((g) => {
    const lvRows = [...g.levels.values()].sort((a, b) => a.level - b.level).map((b) => {
      const normDps = ratio(b.norm, b.secs);
      const vsTarget = b.target > 0 && normDps !== null ? normDps / b.target : null;
      const row = {
        level: b.level, runs: b.runs, seconds: round(b.secs, 1), dps: round(ratio(b.dmg, b.secs)), normDps: round(normDps, 3),
        target: b.target || null, vsTarget: round(vsTarget, 3), dmgShare: round(ratio(b.dmg, b.wAllDmg), 4), killShare: round(ratio(b.kills, b.wAllKills), 4),
        allDmgShare: round(ratio(b.dmg, b.allDmg), 4), allKillShare: round(ratio(b.kills, b.allKills), 4),
        meanTime: round(ratio(b.tsum || 0, b.secs), 1), enough: enough(b), index: null, levelIndex: null, flag: null
      };
      if (g.curve && row.enough && vsTarget !== null) {
        if (!levelRows.has(b.level)) levelRows.set(b.level, []);
        levelRows.get(b.level).push(row);
      }
      return row;
    });
    const weaponGroup = !NON_WEAPON_GROUPS.has(g.id);
    return {
      id: g.id, isWeapon: g.isWeapon, curve: g.curve, runs: g.runs, runShare: round(ratio(g.runs, n), 4),
      damage: Math.round(g.dmg), kills: g.kills,
      // Weapons: share of weapon damage / kills; the non-weapon groups (Supernova, ram, ...): share of everything.
      dmgShare: round(ratio(g.dmg, weaponGroup ? weaponDamage : allDamage), 4), killShare: round(ratio(g.kills, weaponGroup ? weaponKills : allKills), 4),
      allDmgShare: round(ratio(g.dmg, allDamage), 4), allKillShare: round(ratio(g.kills, allKills), 4),
      ownedSeconds: g.isWeapon ? round(g.owned, 1) : null, dps: g.isWeapon ? round(ratio(g.dmg, g.owned)) : null,
      medianAcquiredAt: g.isWeapon ? round(median(g.acquiredAt), 1) : null,
      levels: lvRows, vsTarget: null, index: null, levelIndex: null, vsAutocannon: null, flag: null
    };
  });

  // Same-level peer index (levelIndex), then the same-time index (index, which flags), then seconds-weighted roll-ups.
  for (const rows of levelRows.values()) {
    if (rows.length < 2) continue;
    const mid = median(rows.map((r) => r.vsTarget));
    if (!(mid > 0)) continue;
    for (const row of rows) row.levelIndex = round(row.vsTarget / mid, 3);
  }
  // How much potential a weapon realizes depends on its level AND on when in the run it is held (a fresh LV 1
  // pick-up at minute 5 out-realizes both the LV 1 weapons of minute 1 and the LV 12 one it fights beside). So fit,
  // seconds-weighted in log space over every run's weapon levels:
  //   log(realized share) = weapon effect + run-time effect (TIME_INDEX_BUCKETS) + level effect (LEVEL_INDEX_BUCKETS)
  // and judge each weapon level against a typical weapon (median weapon effect) at the same times and levels.
  const fit = fitShares(samples, minSample.seconds);
  const timeTotals = new Map(); // `${id}|${level}` -> { actual, expected }
  for (const s of samples) {
    const ref = fit.expected(s);
    if (!(ref > 0)) continue;
    const key = `${s.id}|${s.level}`;
    const t = timeTotals.get(key) || { actual: 0, expected: 0 };
    timeTotals.set(key, t);
    t.actual += s.units; t.expected += s.secs * ref;
  }
  for (const w of weapons) {
    let actual = 0, expected = 0;
    for (const row of w.levels) {
      const t = timeTotals.get(`${w.id}|${row.level}`);
      if (w.curve && row.enough && t?.expected > 0) { actual += t.actual; expected += t.expected; }
    }
    const rated = w.levels.filter((r) => r.vsTarget !== null && r.enough);
    const secs = sum(rated.map((r) => r.seconds));
    if (secs > 0) w.vsTarget = round(sum(rated.map((r) => r.vsTarget * r.seconds)) / secs, 3);
    const lvRated = rated.filter((r) => r.levelIndex !== null);
    const lsecs = sum(lvRated.map((r) => r.seconds));
    if (lsecs > 0) w.levelIndex = round(sum(lvRated.map((r) => r.levelIndex * r.seconds)) / lsecs, 3);
    w.fitIndex = expected > 0 ? actual / expected : null;
  }
  // Centre the fit on the weapons it rates: the median rated weapon is 1 (as levelIndex is per level).
  const centre = median(weapons.map((w) => w.fitIndex).filter((v) => v > 0)) || 1;
  for (const w of weapons) {
    for (const row of w.levels) {
      const t = timeTotals.get(`${w.id}|${row.level}`);
      row.index = w.curve && row.enough && t?.expected > 0 ? round(t.actual / t.expected / centre, 3) : row.levelIndex;
      row.flag = row.enough ? flagFor(row.index, band) : null;
    }
    w.index = w.fitIndex !== null ? round(w.fitIndex / centre, 3) : w.levelIndex;
    delete w.fitIndex;
    w.flag = flagFor(w.index, band);
  }
  const auto = weapons.find((w) => w.id === 'blaster')?.index;
  if (auto > 0) for (const w of weapons) if (w.index !== null) w.vsAutocannon = round(w.index / auto, 3);
  weapons.sort((a, b) => (b.isWeapon - a.isWeapon) || b.damage - a.damage);

  // --- Damage sub-sources --------------------------------------------------------------------------
  const sourceTotals = {};
  for (const r of list) for (const [k, v] of Object.entries(r.sources || {})) sourceTotals[k] = (sourceTotals[k] || 0) + v;
  const sourceAll = sum(Object.values(sourceTotals));
  const sources = Object.entries(sourceTotals).sort((a, b) => b[1] - a[1])
    .map(([id, dmg]) => ({ id, damage: Math.round(dmg), share: round(ratio(dmg, sourceAll), 4) }));

  // --- Enemies -------------------------------------------------------------------------------------
  const kinds = new Map();
  const deaths = {};
  let deathsTotal = 0;
  for (const r of list) {
    if (r.died) {
      const cause = r.cause || 'unknown';
      deaths[cause] = (deaths[cause] || 0) + 1;
      deathsTotal++;
    }
    for (const [kind, v] of Object.entries(r.enemies || {})) {
      const k = kinds.get(kind) || { kind, spawned: 0, killed: 0, ttkSum: 0, ttkN: 0, playerDamage: 0, hits: 0 };
      kinds.set(kind, k);
      k.spawned += v[0] || 0; k.killed += v[1] || 0; k.ttkSum += v[2] || 0; k.ttkN += v[3] || 0; k.playerDamage += v[4] || 0; k.hits += v[5] || 0;
    }
  }
  for (const cause of Object.keys(deaths)) if (!kinds.has(cause)) kinds.set(cause, { kind: cause, spawned: 0, killed: 0, ttkSum: 0, ttkN: 0, playerDamage: 0, hits: 0 });
  const playerDamageAll = sum([...kinds.values()].map((k) => k.playerDamage));
  const enemies = [...kinds.values()].map((k) => ({
    kind: k.kind, spawned: k.spawned, killed: k.killed, killRate: round(ratio(k.killed, k.spawned), 4),
    timeToKill: round(ratio(k.ttkSum, k.ttkN), 2), playerDamage: Math.round(k.playerDamage), hits: k.hits,
    playerDamageShare: round(ratio(k.playerDamage, playerDamageAll), 4), damagePerSpawn: round(ratio(k.playerDamage, k.spawned), 3),
    deaths: deaths[k.kind] || 0, deathShare: round(ratio(deaths[k.kind] || 0, deathsTotal), 4), deadly: false
  })).sort((a, b) => b.deaths - a.deaths || b.playerDamage - a.playerDamage);
  // The deadliest: the top three by deaths caused (then shield damage), when they caused any harm.
  enemies.slice(0, 3).forEach((e) => { e.deadly = e.deaths > 0 || e.playerDamage > 0; });

  // --- Cards ---------------------------------------------------------------------------------------
  const tally = (key) => {
    const t = new Map();
    for (const r of list) for (const [id, v] of Object.entries(r[key] || {})) {
      const row = t.get(id) || { id, offered: 0, picked: 0, eligible: 0, expected: 0, drawn: 0 };
      t.set(id, row);
      row.offered += v[0] || 0;
      row.picked += v[1] || 0;
      row.eligible += v[2] || 0;
      row.expected += v[3] || 0;
      row.drawn += v[4] || 0;
    }
    return [...t.values()].map((c) => {
      // Fairness: random draws / the draws its weight predicts, over the hands where it was eligible
      // (weapon cards only count hands where that weapon was owned). 1.00 = exactly as often as expected.
      const fairness = c.expected > 0 ? c.drawn / c.expected : null;
      const enough = c.expected >= FAIRNESS_MIN_EXPECTED;
      const z = c.expected > 0 ? (c.drawn - c.expected) / Math.sqrt(c.expected) : 0;
      const significant = Math.abs(z) >= FAIRNESS_Z;
      const flag = !enough || fairness === null || !significant ? null : fairness > 1 + FAIRNESS_BAND ? 'over' : fairness < 1 - FAIRNESS_BAND ? 'under' : null;
      return { ...c, expected: round(c.expected, 2), pickRate: round(ratio(c.picked, c.offered), 4), offerRate: round(ratio(c.drawn, c.eligible), 4), fairness: round(fairness, 3), z: round(z, 2), lowSample: !enough, flag };
    }).sort((a, b) => b.offered - a.offered);
  };
  const cards = tally('cards');
  const weaponPicks = tally('weaponPicks');
  const nw = cards.find((c) => c.id === 'new_weapon');

  // --- Run shape -----------------------------------------------------------------------------------
  const pace = PACE_LEVELS.map((L) => {
    const at = list.map((r) => r.levelTimes?.[L - 2]).filter(Number.isFinite);
    return { level: L, runs: at.length, share: round(ratio(at.length, n), 4), medianSeconds: round(median(at), 1) };
  });
  const mean = (f) => (n ? round(sum(list.map(f)) / n, 2) : null);

  // --- Supernova bombs (runs from before bombs were recorded are left out) ----------------------
  const bombRuns = list.filter((r) => Array.isArray(r.bombs));
  const bombsUsed = bombRuns.map((r) => r.bombs[0] || 0);
  const bombKills = sum(bombRuns.map((r) => r.bombs[1] || 0));
  // --- Boss escapes: how often each boss got away, against hulls of that kind spawned (split pieces count) ---
  const bossEscapes = {};
  for (const r of list) {
    for (const [kind, n] of Object.entries(r.bossEscapes || {})) {
      const row = bossEscapes[kind] || (bossEscapes[kind] = { escaped: 0, spawned: 0 });
      row.escaped += n;
    }
  }
  for (const kind of Object.keys(bossEscapes)) bossEscapes[kind].spawned = sum(list.map((r) => (Array.isArray(r.enemies?.[kind]) ? r.enemies[kind][0] : 0)));

  const bombs = {
    runs: bombRuns.length,
    perRun: { median: median(bombsUsed), mean: bombRuns.length ? round(sum(bombsUsed) / bombRuns.length, 2) : null },
    killsPerBomb: round(ratio(bombKills, sum(bombsUsed)), 1),
    weaponDamageShare: round(ratio(weaponDamage, allDamage), 4)
  };

  return {
    schema: SUMMARY_SCHEMA,
    version,
    source,
    generatedAt,
    runs: n,
    armory: armory || 'all',
    armoryTiers,
    outlierBand: band,
    minSample,
    run: {
      time: { median: round(median(times), 1), p90: round(percentile(times, 0.9), 1), mean: mean((r) => r.time), histogram: histogram(times, TIME_BUCKETS, 'min') },
      level: { median: median(levels), p90: percentile(levels, 0.9), mean: mean((r) => r.level), histogram: histogram(levels, LEVEL_BUCKETS, 'lv') },
      reachLevel50: round(ratio(list.filter((r) => r.level >= TARGET_LEVEL).length, n), 4),
      reach30min: round(ratio(list.filter((r) => r.time >= TARGET_SECONDS).length, n), 4),
      died: round(ratio(list.filter((r) => r.died).length, n), 4),
      wave: { median: median(list.map((r) => r.wave)) },
      kills: { median: median(list.map((r) => r.kills)) },
      score: { median: median(list.map((r) => r.score)) },
      pace
    },
    gold: { earned: mean((r) => r.gold?.earned || 0), spent: mean((r) => r.gold?.spent || 0), rerolls: mean((r) => r.gold?.rerolls || 0), locks: mean((r) => r.gold?.locks || 0), banishes: mean((r) => r.gold?.banishes || 0), skips: mean((r) => r.gold?.skips || 0) },
    weapons,
    bombs,
    bossEscapes,
    sources,
    enemies,
    deaths,
    cards,
    weaponPicks,
    newWeapon: nw ? { offered: nw.offered, picked: nw.picked, pickRate: nw.pickRate } : { offered: 0, picked: 0, pickRate: null },
    timeIndexBuckets: TIME_INDEX_BUCKETS,
    levelIndexBuckets: LEVEL_INDEX_BUCKETS,
    outliers: weapons.filter((w) => w.flag === 'buff' || w.flag === 'nerf').map((w) => ({ id: w.id, flag: w.flag, index: w.index, levelIndex: w.levelIndex, vsTarget: w.vsTarget }))
  };
}
