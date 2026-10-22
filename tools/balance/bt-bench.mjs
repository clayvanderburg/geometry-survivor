// Breakthrough card bench: realized DPS of every Breakthrough option (each transform in a weapon's pool,
// Across the Board, Overtuned Core) at weapon LV 6 / 12 / 18, relative to Across the Board at the same level.
// The weapon is benched alone (the Autocannon is dropped unless it is the one benched) with a damage-first
// build (Damage ranks, then the weapon's fire-rate stat past 10 ranks), and every milestone below the one
// under test is Across the Board. Each case is the mean of the bench's scenarios over `seeds` seeds.
//
// Targets: the bench's wave-6 mix, with hit points scaled to the wave a pilot is on when a weapon reaches
// that level (BT_BENCH_WAVE), so late hits don't simply overkill wave-6 targets (which flattens every
// damage gain and rewards only extra hits). BT_BENCHES: `real` (the reference) or `dense` (the old card bench).
//
//   node tools/balance/bt-bench.mjs [--weapons a,b] [--levels 6,12] [--seeds 6] [--workers 4] [--json out.json]
//                                   [--seed S] [--bench real|dense]
//                                   [--values candidate.json]  (TF_REALIZED overrides, { weapon: { transform: [v6, v12, v18] } })
//                                   [--class]  (class standing: each weapon's realized DPS / the Autocannon's)
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

// Wave a pilot is on when a weapon reaches LV 1 / 3 / 6 / 12 / 18 (main weapon, focused build; balance-sim runs).
export const BT_BENCH_WAVE = { 1: 2, 3: 4, 6: 6, 12: 20, 18: 30 };
// Bench populations. `real` is the balance reference: a chasing swarm as dense round the ship as in real
// runs (a sprayer pilot has 11-16 enemies within 280 px, clumped to one side; this chase holds ~14, R 0.70).
// `dense` is the original card bench (50 targets, still pack + chase): it puts 15-24 enemies within 280 px,
// which overrates every area weapon (a cone's damage grows with the crowd, an aimed bolt's barely does).
export const BT_BENCHES = Object.freeze({
  real: Object.freeze({ targets: 25, scenarios: Object.freeze(['chase']) }),
  dense: Object.freeze({ targets: 50, scenarios: Object.freeze(['pack', 'chase']) }),
  // `kite`: the reference swarm, chasing a ship that loops wide (1200 px) like a human kiting in long runs.
  kite: Object.freeze({ targets: 25, scenarios: Object.freeze(['chase']), orbitRadius: 1200 })
});
// Weapon-level rate stat (fire-rate POWER stat taken after Damage), when a weapon has one.
const RATE_STATS = ['rate', 'reload', 'recharge', 'cooldown'];
const SEED = 'btbench';

let h, wl, up, cal;
async function load() {
  h ??= await import('./harness.mjs');
  wl ??= await import('../../js/weapon-levels.js');
  up ??= await import('../../js/upgrades.js');
  cal ??= await import('../../js/bt-calibration.js');
}

// Replace TF_REALIZED entries ({ weapon: { transform: [v6, v12, v18] } }) to bench a candidate calibration.
export async function setRealized(values) {
  await load();
  for (const [id, tfs] of Object.entries(values || {})) cal.TF_REALIZED[id] = { ...cal.TF_REALIZED[id], ...tfs };
}

// Damage-first build setup for weapon `id` at `lv` with Breakthroughs `bt` ({ 6: opt, 12: opt, 18: opt }).
function setupFor(id, lv, bt) {
  const cards = wl.STAT_CARDS[id];
  const dmg = cards.find((c) => c.stat === 'damage');
  const rate = cards.find((c) => RATE_STATS.includes(c.stat)) || cards.find((c) => c.stat !== 'damage' && wl.POWER_STATS.has(c.stat));
  return (p) => {
    if (id !== 'blaster') {
      up.applyUpgradeLevels(p, up.UPGRADE_BY_ID[id]);
      up.discardWeapon(p, 'blaster');
    }
    const dRanks = Math.min(lv - 1, 10);
    if (dRanks > 0) up.applyUpgradeLevels(p, { ...up.UPGRADE_BY_ID[dmg.id], levelJump: dRanks });
    let rest = lv - 1 - dRanks;
    if (rest > 0) {
      const r = Math.min(rest, rate.maxLevel);
      up.applyUpgradeLevels(p, { ...up.UPGRADE_BY_ID[rate.id], levelJump: r });
      rest -= r;
    }
    // Anything left over (a capped rate card): more of the other POWER stats, then utility.
    for (const c of cards) {
      if (rest <= 0) break;
      if (c === dmg || c === rate) continue;
      const r = Math.min(rest, c.maxLevel);
      up.applyUpgradeLevels(p, { ...up.UPGRADE_BY_ID[c.id], levelJump: r });
      rest -= r;
    }
    p.breakthroughs = { [id]: { ...bt } };
  };
}

// Realized DPS of weapon `id` (every source but the Autocannon's when it isn't the one benched).
// `option` null: no Breakthrough at `lv` itself (a level between milestones, or the class report).
export async function benchOption(id, lv, option, { seeds = 3, earlier = 'boost', seed = SEED, bench: kind = 'real' } = {}) {
  await load();
  const bt = {};
  for (const m of wl.BREAKTHROUGH_LEVELS) if (m < lv) bt[m] = earlier;
  if (option) bt[lv] = option;
  const { targets, scenarios, orbitRadius = h.BENCH.orbitRadius } = BT_BENCHES[kind];
  const bench = { ...h.BENCH, targets, orbitRadius, targetWave: BT_BENCH_WAVE[lv] };
  let sum = 0;
  for (const scenario of scenarios) {
    for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
      const r = h.benchUpgrade({ seed, scenario, seedIndex, setup: setupFor(id, lv, bt), bench });
      for (const [src, v] of Object.entries(r.dps)) if (src !== 'thrusters' && (id === 'blaster' || !['blaster', 'helix'].includes(src))) sum += v;
    }
  }
  return sum / (scenarios.length * seeds);
}

// Every option of every weapon at every milestone: [{ id, lv, option, dps }].
export async function caseList({ weapons = null, levels = [6, 12, 18] } = {}) {
  await load();
  const out = [];
  for (const id of Object.keys(wl.STAT_CARDS)) {
    if (weapons && !weapons.includes(id)) continue;
    const opts = [...wl.transformPool(id).map((t) => t.id), 'boost', 'overtuned'];
    for (const lv of levels) for (const option of opts) out.push({ id, lv, option });
  }
  return out;
}

// Class standing: every weapon alone at `levels` (earlier milestones Across the Board, the milestone itself too).
export async function classCases({ weapons = null, levels = [1, 3, 6, 12, 18] } = {}) {
  await load();
  return Object.keys(wl.STAT_CARDS).filter((id) => !weapons || weapons.includes(id))
    .flatMap((id) => levels.map((lv) => ({ id, lv, option: wl.BREAKTHROUGH_LEVELS.includes(lv) ? 'boost' : null })));
}

export async function runAll({ cases, seeds, workers, values = null, seed = SEED, bench = 'real' }) {
  const results = new Array(cases.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds, values, seed, bench } });
    const feed = () => {
      if (next >= cases.length) { w.terminate(); resolve(); return; }
      const i = next++;
      w.postMessage({ i, c: cases[i] });
    };
    w.on('message', ({ i, dps }) => {
      results[i] = { ...cases[i], dps };
      if (++done % 20 === 0) process.stderr.write(`bt-bench: ${done}/${cases.length}\n`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  return results;
}

// Rows of { id, lv, option, dps, vsBoost, vsOvertuned }.
export function relate(results) {
  const key = (r, o) => `${r.id}|${r.lv}|${o}`;
  const by = new Map(results.map((r) => [key(r, r.option), r.dps]));
  return results.map((r) => ({ ...r, vsBoost: r.dps / by.get(key(r, 'boost')), vsOvertuned: r.dps / by.get(key(r, 'overtuned')) }));
}

if (!isMainThread) {
  const ready = setRealized(workerData.values);
  parentPort.on('message', async ({ i, c }) => {
    await ready;
    parentPort.postMessage({ i, dps: await benchOption(c.id, c.lv, c.option, { seeds: workerData.seeds, seed: workerData.seed, bench: workerData.bench }) });
  });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const weapons = get('--weapons', null)?.split(',');
  const levels = get('--levels', '6,12,18').split(',').map(Number);
  const seeds = Number(get('--seeds', 6));
  const workers = Number(get('--workers', Math.max(1, Math.min(8, availableParallelism()))));
  const json = get('--json', null);
  const seed = get('--seed', SEED);
  const bench = get('--bench', 'real');
  if (!BT_BENCHES[bench]) throw new Error(`--bench must be ${Object.keys(BT_BENCHES).join('|')}`);
  const valuesPath = get('--values', null);
  const values = valuesPath ? JSON.parse((await import('node:fs')).readFileSync(valuesPath, 'utf8')) : null;
  const t0 = Date.now();
  if (args.includes('--class')) {
    // Class standing: each weapon's realized DPS / the Autocannon's at the same level.
    const cases = await classCases({ weapons: weapons && [...new Set(['blaster', ...weapons])], levels: get('--levels', '1,3,6,12,18').split(',').map(Number) });
    const rows = await runAll({ cases, seeds, workers, values, seed, bench });
    const ref = new Map(rows.filter((r) => r.id === 'blaster').map((r) => [r.lv, r.dps]));
    for (const r of rows) r.vsAutocannon = r.dps / ref.get(r.lv);
    process.stderr.write(`bt-bench: ${cases.length} class cases in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
    if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(rows, null, 1));
    const lvs = [...new Set(rows.map((r) => r.lv))];
    console.log(`| weapon | ${lvs.map((l) => `LV ${l}`).join(' | ')} |\n|---|${lvs.map(() => '---:').join('|')}|`);
    for (const id of [...new Set(rows.map((r) => r.id))]) console.log(`| ${id} | ${lvs.map((l) => rows.find((r) => r.id === id && r.lv === l).vsAutocannon.toFixed(2)).join(' | ')} |`);
  } else {
    const cases = await caseList({ weapons, levels });
    const rows = relate(await runAll({ cases, seeds, workers, values, seed, bench }));
    process.stderr.write(`bt-bench: ${cases.length} cases in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
    if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(rows, null, 1));
    console.log('| weapon | LV | option | DPS | vs Across the Board | vs Overtuned |\n|---|---:|---|---:|---:|---:|');
    for (const r of rows) console.log(`| ${r.id} | ${r.lv} | ${r.option} | ${r.dps.toFixed(1)} | ${r.vsBoost.toFixed(2)} | ${r.vsOvertuned.toFixed(2)} |`);
  }
}
