#!/usr/bin/env node
// VEXOLITH // SURVIVOR deterministic balance simulator.
// Runs the real game simulation headlessly (see tools/balance/harness.mjs) with a scripted bot pilot,
// N seeded runs per build strategy, plus a fixed-pack weapon throughput bench, and prints Markdown.
//
//   npm run balance                         # default: 6 strategies x 3 runs, 15 min cap, + bench
//   npm run balance -- --runs 8 --focus     # more runs, plus a "focus:<id>" strategy per upgrade
//   npm run balance -- --tune enemyHpMult=1.2 --tune fireRate=6   # A/B a tuning change
//   npm run balance -- --json balance.json  # raw per-run results for further analysis
//
// Flags: --runs N  --seed S  --strategies a,b  --focus  --max-minutes M  --workers N  --meta RANK
//        --skill expert|average|novice  --god  --tune key=value  --weapon key=expr  --bench-seeds N  --no-bench  --bench-only  --json PATH  --help
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const opts = { runs: 3, seed: 'vexolith', strategies: null, focus: false, maxMinutes: 15, workers: Math.max(1, Math.min(8, availableParallelism())), meta: 0, skill: 'average', god: false, tune: {}, weapons: {}, bench: true, benchSeeds: 2, benchOnly: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value (see --help)`);
      return v;
    };
    // Reject typos instead of silently running with NaN (zero runs, NaN enemy HP, ...).
    const number = (min, parse = Number) => {
      const v = parse(next());
      if (!Number.isFinite(v)) throw new Error(`${a} needs a number (see --help)`);
      return Math.max(min, v);
    };
    const int = (min) => number(min, v => parseInt(v, 10));
    if (a === '--runs') opts.runs = int(1);
    else if (a === '--seed') opts.seed = next();
    else if (a === '--strategies') opts.strategies = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--focus') opts.focus = true;
    else if (a === '--max-minutes') opts.maxMinutes = number(0.5);
    else if (a === '--workers') opts.workers = int(1);
    else if (a === '--meta') opts.meta = int(0);
    else if (a === '--skill') opts.skill = next();
    else if (a === '--god') opts.god = true;
    else if (a === '--tune') {
      const spec = next();
      const eq = spec.indexOf('=');
      const v = Number(spec.slice(eq + 1));
      if (eq < 1 || spec.slice(eq + 1).trim() === '' || !Number.isFinite(v)) throw new Error(`--tune needs key=number, got "${spec}"`);
      opts.tune[spec.slice(0, eq)] = v;
    } else if (a === '--weapon') {
      const spec = next();
      const eq = spec.indexOf('=');
      if (eq < 1) throw new Error(`--weapon needs key=expr, got "${spec}"`);
      opts.weapons[spec.slice(0, eq)] = spec.slice(eq + 1);
    } else if (a === '--bench-seeds') opts.benchSeeds = int(1);
    else if (a === '--no-bench') opts.bench = false;
    else if (a === '--bench-only') opts.benchOnly = true;
    else if (a === '--json') opts.json = next();
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown flag ${a} (see --help)`);
  }
  return opts;
}

function runPool(jobs, workers) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    let next = 0, done = 0;
    const pool = [];
    const size = Math.min(workers, jobs.length);
    if (size === 0) return resolve(results);
    const feed = (w) => {
      if (next >= jobs.length) { w.terminate(); return; }
      const id = next++;
      w.postMessage({ ...jobs[id], id });
    };
    for (let i = 0; i < size; i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      w.on('message', (msg) => {
        if (msg.error) { pool.forEach(x => x.terminate()); reject(new Error(msg.error)); return; }
        results[msg.id] = msg.result;
        done++;
        if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${jobs.length} jobs`);
        if (done === jobs.length) { if (process.stderr.isTTY) process.stderr.write('\n'); resolve(results); }
        feed(w);
      });
      w.on('error', reject);
      pool.push(w);
      feed(w);
    }
  });
}

// --- Formatting --------------------------------------------------------------------------------
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const num = v => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v >= 100 ? Math.round(v).toString() : v.toFixed(1);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map((_, i) => i ? '---:' : '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const sumBy = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const WAVE_BUCKETS = [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 20], [21, 25], [26, 30], [31, 40], [41, 999]];
const bucketOf = w => WAVE_BUCKETS.find(([a, b]) => w >= a && w <= b);
const bucketLabel = ([a, b]) => b >= 999 ? `${a}+` : `${a}-${b}`;

function histMedian(hist) {
  const bins = Object.entries(hist).map(([b, c]) => [Number(b), c]).sort((a, b) => a[0] - b[0]);
  const total = bins.reduce((a, [, c]) => a + c, 0);
  let acc = 0;
  for (const [b, c] of bins) { acc += c; if (acc * 2 >= total) return b / 30; }
  return NaN;
}

export function formatReport({ opts, strategies, runs, bench, classes, wallSeconds, benchSeconds = 15 }) {
  const out = [];
  const capS = opts.maxMinutes * 60;
  out.push(`# Balance simulation`);
  out.push(`seed \`${opts.seed}\` · ${opts.runs} run(s) per strategy · cap ${opts.maxMinutes} min game time · ${opts.skill} pilot${opts.god ? ' (god mode: pacing only)' : ''} · armory rank ${opts.meta} · ${Object.keys(opts.tune).length ? 'tuning ' + JSON.stringify(opts.tune) : 'default tuning'}${Object.keys(opts.weapons).length ? ' · weapons ' + JSON.stringify(opts.weapons) : ''} · ${wallSeconds.toFixed(0)} s wall`);

  if (runs.length) {
    const byStrat = new Map(strategies.map(s => [s.name, runs.filter(r => r.strategy === s.name)]));
    out.push('\n## Survival per strategy');
    out.push(table(['strategy', 'runs', 'hit cap', 'time min / med / max', 'wave min / med / max', 'level med', 'kills/min', 'cores mean', 'killed by'], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const t = rs.map(r => r.time), w = rs.map(r => r.wave);
      const killers = {};
      rs.filter(r => r.died).forEach(r => { killers[r.killer || '?'] = (killers[r.killer || '?'] || 0) + 1; });
      return [s.name, rs.length, rs.filter(r => !r.died).length,
        `${mmss(Math.min(...t))} / ${mmss(median(t))} / ${mmss(Math.max(...t))}`,
        `${Math.min(...w)} / ${median(w)} / ${Math.max(...w)}`,
        median(rs.map(r => r.level)), (sumBy(rs, r => r.kills) / (sumBy(rs, r => r.time) / 60)).toFixed(0),
        mean(rs.map(r => r.cores)).toFixed(0),
        Object.entries(killers).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ') || '—'];
    })));

    // Damage dealt by source (shares of effective damage) with total DPS.
    const sources = {};
    runs.forEach(r => Object.entries(r.dealt).forEach(([k, v]) => { sources[k] = (sources[k] || 0) + v; }));
    const srcList = Object.keys(sources).sort((a, b) => sources[b] - sources[a]);
    out.push('\n## Damage dealt by source (share of effective damage; overkill excluded)');
    out.push(table(['strategy', 'DPS', ...srcList], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const tot = {};
      rs.forEach(r => Object.entries(r.dealt).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; }));
      const all = sum(tot);
      const secs = sumBy(rs, r => r.time);
      return [s.name, num(all / secs), ...srcList.map(k => tot[k] ? pct(tot[k] / all) : '—')];
    })));

    // Damage taken by enemy type.
    const types = {};
    runs.forEach(r => Object.entries(r.taken).forEach(([k, v]) => { types[k] = (types[k] || 0) + v.dmg; }));
    const typeList = Object.keys(types).sort((a, b) => types[b] - types[a]);
    out.push('\n## Damage taken by enemy type (share of shield damage; HP/min in brackets)');
    out.push(table(['strategy', 'HP lost/min', ...typeList], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const tot = {};
      rs.forEach(r => Object.entries(r.taken).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v.dmg; }));
      const mins = sumBy(rs, r => r.time) / 60;
      const all = sum(tot);
      return [s.name, (all / mins).toFixed(1), ...typeList.map(k => tot[k] ? `${pct(tot[k] / all)} (${(tot[k] / mins).toFixed(1)})` : '—')];
    })));

    // Level pacing.
    const marks = [5, 10, 15, 20, 25, 30, 40, 50, 60];
    out.push('\n## Level-up pacing (median time to reach level; levels/min over the run)');
    out.push(table(['strategy', 'levels/min', ...marks.map(l => `L${l}`)], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const lpm = mean(rs.map(r => (r.level - 1) / (r.time / 60)));
      return [s.name, lpm.toFixed(2), ...marks.map(l => {
        const hits = rs.map(r => r.levels[l - 2]).filter(v => v !== undefined);
        return hits.length * 2 > rs.length ? mmss(median(hits)) : hits.length ? `(${hits.length}/${rs.length})` : '—';
      })];
    })));

    // Level reached by game minute (runs still alive at that minute), and level-up interval there.
    const minutes = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30].filter(m => m * 60 <= capS);
    out.push('\n## Level by minute (median level of runs alive at that minute; median seconds per level-up in the minute before)');
    out.push(table(['strategy', ...minutes.map(m => `${m}:00`)], strategies.map(s => {
      const rs = byStrat.get(s.name);
      return [s.name, ...minutes.map(m => {
        const alive = rs.filter(r => r.levelAt && r.levelAt.length > m);
        if (!alive.length) return '—';
        const lv = median(alive.map(r => r.levelAt[m]));
        const gain = median(alive.map(r => r.levelAt[m] - r.levelAt[m - 1]));
        return `L${lv} (${gain > 0 ? (60 / gain).toFixed(0) + 's' : '—'})`;
      })];
    })));

    out.push('\n## XP collected per minute (median over runs alive through that minute)');
    out.push(table(['strategy', ...minutes.map(m => `${m}:00`)], strategies.map(s => {
      const rs = byStrat.get(s.name);
      return [s.name, ...minutes.map(m => {
        const alive = rs.filter(r => r.xpAt && r.xpAt.length > m);
        return alive.length ? num(median(alive.map(r => r.xpAt[m] - r.xpAt[m - 1]))) : '—';
      })];
    })));

    // Loadout: weapons equipped at the end of the run (NEW WEAPON picks).
    out.push('\n## Loadout at end of run (weapons equipped, most common first; mean weapon levels gained)');
    out.push(table(['strategy', 'weapons (mean)', 'equipped (count across runs)', 'weapon levels (mean)'], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const counts = {};
      rs.forEach(r => (r.loadout || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
      const weaponLevels = mean(rs.map(r => (r.loadout || []).reduce((a, id) => a + (r.build[id] || 0), 0)));
      return [s.name, mean(rs.map(r => (r.loadout || []).length)).toFixed(1),
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ') || '—', weaponLevels.toFixed(1)];
    })));

    // Upgrade exhaustion: when the slots fill, when hands first run short, and when level-ups find
    // nothing left (the ALL SYSTEMS MAXED full-shield-repair fallback).
    const stamp = (rs, key) => {
      const hits = rs.filter(r => r[key]);
      if (!hits.length) return '—';
      const label = `${mmss(median(hits.map(r => r[key].time)))} · L${median(hits.map(r => r[key].level))}`;
      return hits.length === rs.length ? label : `${label} (${hits.length}/${rs.length})`;
    };
    out.push('\n## Upgrade exhaustion (median time · level, among runs that got there)');
    out.push(table(['strategy', 'NEW WEAPON in hands (slot free)', 'all slots filled', 'first hand < 3 cards', 'first empty hand (MAXED)', 'MAXED level-ups / run'], strategies.map(s => {
      const rs = byStrat.get(s.name);
      const hands = sumBy(rs, r => r.handsWithFreeSlot || 0);
      return [s.name, hands ? `${pct(sumBy(rs, r => r.newWeaponHands || 0) / hands)} of ${hands}` : '—', stamp(rs, 'slotsFullAt'), stamp(rs, 'thinHandAt'), stamp(rs, 'maxedAt'), mean(rs.map(r => r.maxedCount || 0)).toFixed(1)];
    })));

    // Difficulty curve per wave, pooled across strategies.
    const maxWave = Math.max(...runs.map(r => r.wave));
    const rows = [];
    for (let w = 1; w <= maxWave; w++) {
      const alive = runs.filter(r => r.wave >= w);
      const diedHere = runs.filter(r => r.died && r.wave === w).length;
      const rowsW = alive.map(r => r.perWave.find(p => p.wave === w)).filter(Boolean);
      const finished = rowsW.filter(p => p.hpEnd !== null);
      rows.push([w, `${alive.length}/${runs.length}`, diedHere, mean(rowsW.map(p => p.taken)).toFixed(0), mean(rowsW.map(p => p.kills)).toFixed(0), mean(rowsW.map(p => p.enemiesAvg)).toFixed(0), finished.length ? pct(mean(finished.map(p => p.hpEnd))) : '—', finished.length ? mean(finished.map(p => p.levelEnd)).toFixed(1) : '—']);
    }
    out.push(`\n## Difficulty curve per wave (all strategies pooled; waves are ${opts.tune.waveLength ?? opts.waveLength ?? 22} s, bosses every 3rd)`);
    out.push(table(['wave', 'runs alive', 'deaths', 'HP lost', 'kills', 'enemies on field', 'shield at end', 'level at end'], rows));

    // Time-to-kill per enemy type per wave bucket.
    const ttk = {};
    runs.forEach(r => Object.entries(r.ttk).forEach(([key, t]) => {
      const [type, wave] = key.split('|');
      const b = bucketLabel(bucketOf(Number(wave)));
      const k = `${type}|${b}`;
      const acc = ttk[k] || (ttk[k] = { n: 0, hist: {}, hits: 0, oneHit: 0, life: 0 });
      acc.n += t.n; acc.hits += t.hits; acc.oneHit += t.oneHit; acc.life += t.life;
      Object.entries(t.hist).forEach(([bin, c]) => { acc.hist[bin] = (acc.hist[bin] || 0) + c; });
    }));
    const ttypes = [...new Set(Object.keys(ttk).map(k => k.split('|')[0]))];
    out.push('\n## Time to kill per enemy type (first hit -> death, median s / mean hits / one-hit-kill share; n)');
    const usedBuckets = WAVE_BUCKETS.map(bucketLabel).filter(b => ttypes.some(t => ttk[`${t}|${b}`]));
    out.push(table(['type', ...usedBuckets.map(b => `W${b}`)], ttypes.map(t => [t, ...usedBuckets.map(b => {
      const a = ttk[`${t}|${b}`];
      return a ? `${histMedian(a.hist).toFixed(2)}s / ${(a.hits / a.n).toFixed(1)} / ${pct(a.oneHit / a.n)} (${a.n})` : '—';
    })])));
    out.push('\nTimed-out runs (hit the cap) are survivors, so "time" is a lower bound for them.');
    if (runs.some(r => !r.died) && capS) out.push(`Cap = ${mmss(capS)}.`);
  }

  if (bench?.length) {
    const avg = averageBench(bench);
    const maxL = Math.max(...classes.map(c => c.maxLevel));
    const scenarios = {
      pack: 'static ship, 50 stationary wave-6 targets scattered 70-420 px, kept topped up',
      chase: 'ship circles at 70% move speed, 50 wave-6 targets chase it; cell = marginal DPS · leaks/min reaching the shield'
    };
    for (const [scenario, label] of Object.entries(scenarios)) {
      const base = avg.get(`null|0|${scenario}`);
      if (!base) continue;
      out.push(`\n## Card throughput bench: ${scenario} (${label}; ${benchSeconds} s x ${opts.benchSeeds} seed(s))`);
      out.push(`Baseline (no cards): ${num(base.total)} DPS${scenario === 'chase' ? `, ${base.leaksPerMin.toFixed(0)} leaks/min` : ''}. Cells show **marginal DPS over the baseline**; weapon cards (⚔) also show their own source DPS in brackets.`);
      const rows = classes.filter(c => !c.isSynergy).map(c => {
        const cells = [];
        for (let l = 1; l <= maxL; l++) {
          const b = avg.get(`${c.id}|${l}|${scenario}`);
          if (!b) { cells.push(''); continue; }
          const own = c.isWeapon ? Object.entries(b.dps).filter(([k]) => !(k in base.dps)).reduce((a, [, v]) => a + v, 0) : null;
          let cell = `${num(b.total - base.total)}${own !== null ? ` (${num(own)})` : ''}`;
          if (scenario === 'chase') cell += ` · ${b.leaksPerMin.toFixed(0)}`;
          cells.push(cell);
        }
        return [`${c.id}${c.isWeapon ? ' ⚔' : ''}`, ...cells];
      });
      out.push(table(['card', ...Array.from({ length: maxL }, (_, i) => `L${i + 1}`)], rows));
    }
    out.push('\nStat cards scale the blaster, so their marginal DPS is blaster DPS. Dash Nova fires on every cooldown in the bench (its potential).');
  }
  return out.join('\n');
}

// Average bench results across seeds, keyed "upgradeId|level|scenario".
function averageBench(bench) {
  const groups = new Map();
  for (const b of bench) {
    const key = `${b.upgradeId}|${b.level}|${b.scenario}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    const dps = {};
    list.forEach(b => Object.entries(b.dps).forEach(([k, v]) => { dps[k] = (dps[k] || 0) + v / list.length; }));
    out.set(key, { dps, total: mean(list.map(b => b.total)), leaksPerMin: mean(list.map(b => b.leaksPerMin)) });
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readHelp());
    return;
  }
  const t0 = performance.now();
  const h = await import('./balance/harness.mjs');
  const { buildStrategies } = await import('./balance/strategies.mjs');
  for (const k of Object.keys(opts.tune)) if (!(k in h.DEFAULT_TUNING)) throw new Error(`--tune: unknown tuning key ${k}`);
  opts.waveLength = h.DEFAULT_TUNING.waveLength;
  if (!(opts.skill in h.PILOT_SKILLS) && !(Number(opts.skill) >= 1)) throw new Error(`--skill must be ${Object.keys(h.PILOT_SKILLS).join('|')} or a tick count >= 1`);
  h.parseWeaponOverrides(opts.weapons); // validate before spawning workers

  const strategies = opts.benchOnly ? [] : buildStrategies(h.UPGRADE_POOL, { focus: opts.focus, only: opts.strategies });
  if (opts.strategies && strategies.length === 0) throw new Error('No matching strategies');
  const classes = h.classifyUpgrades();
  const jobs = [];
  for (const s of strategies) {
    for (let i = 0; i < opts.runs; i++) {
      jobs.push({ kind: 'run', args: { strategy: s, seed: `${opts.seed}:${s.name}:${i}`, maxSeconds: opts.maxMinutes * 60, metaRank: opts.meta, tuning: opts.tune, weapons: opts.weapons, skill: opts.skill, god: opts.god } });
    }
  }
  // Long runs first so the pool drains evenly.
  if (opts.bench || opts.benchOnly) {
    for (const scenario of ['pack', 'chase']) {
      for (let seedIndex = 0; seedIndex < opts.benchSeeds; seedIndex++) {
        const common = { seed: opts.seed, scenario, seedIndex, tuning: opts.tune, weapons: opts.weapons };
        jobs.push({ kind: 'bench', args: { ...common, upgradeId: null, level: 0 } });
        for (const c of classes) {
          if (c.isSynergy) continue;
          for (let l = 1; l <= c.maxLevel; l++) jobs.push({ kind: 'bench', args: { ...common, upgradeId: c.id, level: l } });
        }
      }
    }
  }
  process.stderr.write(`balance-sim: ${strategies.length} strategies x ${opts.runs} runs + ${jobs.filter(j => j.kind === 'bench').length} bench cases on ${opts.workers} workers\n`);
  const results = await runPool(jobs, opts.workers);
  const runs = results.filter((r, i) => jobs[i].kind === 'run');
  const bench = results.filter((r, i) => jobs[i].kind === 'bench');
  const wallSeconds = (performance.now() - t0) / 1000;
  console.log(formatReport({ opts, strategies, runs, bench, classes, wallSeconds, benchSeconds: h.BENCH.seconds }));
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify({ opts, strategies, runs, bench }, null, 1));
    process.stderr.write(`wrote ${opts.json}\n`);
  }
}

function readHelp() {
  return `Usage: node tools/balance-sim.mjs [flags]
  --runs N          runs per strategy (default 3)
  --seed S          base seed; each run uses "S:strategy:index" (default vexolith)
  --strategies a,b  only these strategies (names, or focus:<upgradeId>)
  --focus           add a focus:<id> strategy for every non-evolution upgrade
  --max-minutes M   game-time cap per run (default 15)
  --workers N       worker threads (default: CPU count, max 8)
  --meta R          give every Void Armory upgrade rank R (capped at its max)
  --skill S         pilot reaction latency: expert (1 tick), average (12, default), novice (20), or ticks
  --god             keep the ship alive (measures XP / level pacing over a full-length run)
  --tune k=v        override a DEFAULT_TUNING value (repeatable) for A/B comparisons
  --weapon k=expr   override a weapon-scaling entry: a number or an arrow fn, e.g. "orbitalRadius=lv => 80 + lv * 8"
  --bench-seeds N   seeds averaged per bench case (default 2)
  --no-bench        skip the weapon throughput bench
  --bench-only      run only the bench
  --json PATH       write raw per-run results`;
}

// Worker threads run jobs; the main thread plans, dispatches and reports.
if (!isMainThread) {
  const h = await import('./balance/harness.mjs');
  parentPort.on('message', (job) => {
    try {
      const result = job.kind === 'bench' ? h.benchUpgrade(job.args) : h.simulateRun(job.args);
      parentPort.postMessage({ id: job.id, result });
    } catch (err) {
      parentPort.postMessage({ id: job.id, error: String(err?.stack || err) });
    }
  });
} else {
  await main();
}
