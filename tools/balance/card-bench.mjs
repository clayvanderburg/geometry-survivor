// Global card bench: the realized value of one rank of each global card (Tempo Core, Cooldown Matrix,
// Persistence Field, Velocity Coils, Field Amplifier, Replicator Array) on a whole mid-run build of 2 / 4 / 5
// weapons, against one Reactor Overdrive rank and one weapon card rank (each weapon's best single card,
// averaged over the build). Benches as tools/balance/bt-bench.mjs: `real` (bot-like: a 260 px loop, dashing)
// and `kite` (human-like: a 1200 px loop, no auto-dash), 25 chasing targets each; `blend` is their mean.
//
// Rule: one rank of a global card stays under one weapon card and under Overdrive. Replicator Array is the one
// deliberate exception (a rare jackpot: +15-27% per rank, 2-4x a weapon card; tests/global-cards.test.js).
//
//   node tools/balance/card-bench.mjs --loadout 2|4|5|sprayers [--seeds 4] [--wave 10] [--json out.json]
const h = await import('./harness.mjs');
if (process.env.AREA_STEP) h.WEAPON_SCALING.areaStep = Number(process.env.AREA_STEP);
const U = await import('../../js/upgrades.js');
const { STAT_CARDS } = await import('../../js/weapon-levels.js');
const { WEAPON_BY_ID } = await import('../../js/loadout.js');

export const LOADOUTS = {
  2: ['blaster', 'rockets'],
  4: ['blaster', 'rockets', 'grenades', 'singularity'],
  5: ['blaster', 'rockets', 'grenades', 'singularity', 'drones'], // a full loadout (5 slots since v0.46)
  sprayers: ['flamethrower', 'missiles', 'lightning', 'nanites', 'gas']
};
export const GLOBALS = { tempo: 'tempo_core', cooldown: 'cooldown_matrix', persistence: 'persistence_field', velocity: 'velocity_coils', area: 'tag_area', replicator: 'replicator_array' };
const BENCHES = { real: { orbitRadius: 260, dash: true }, kite: { orbitRadius: 1200, dash: false } };
const RATE = ['rate', 'reload', 'recharge', 'cooldown'];
const COUNT = ['count', 'salvo', 'prism', 'wingmen', 'chain', 'duration', 'nozzles'];
const find = (w, stats) => STAT_CARDS[w].find((c) => stats.includes(c.stat));
const install = (p, id, levelJump = 1) => U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID[id], levelJump });

// A mid-run build (as tests/global-cards.test.js prices them): every weapon at Damage x3, its rate card x2
// and its count card x1 (LV 7), plus `extra` card ids.
function midRun(weapons, extra = []) {
  return (p) => {
    U.discardWeapon(p, 'blaster');
    for (const w of weapons) {
      install(p, WEAPON_BY_ID[w].levelId);
      install(p, find(w, ['damage']).id, 3);
      if (find(w, RATE)) install(p, find(w, RATE).id, 2);
      if (find(w, COUNT)) install(p, find(w, COUNT).id, 1);
    }
    for (const id of extra) install(p, id);
  };
}

function dps(weapons, extra, { seeds, wave, kind }) {
  const { orbitRadius, dash } = BENCHES[kind];
  let sum = 0;
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    const r = h.benchUpgrade({ seed: process.env.CARD_SEED || 'cardbench', scenario: 'chase', seedIndex, setup: midRun(weapons, extra), bench: { ...h.BENCH, targets: 25, orbitRadius, targetWave: wave }, dash });
    for (const [src, v] of Object.entries(r.dps)) if (src !== 'nova' && src !== 'thrusters') sum += v;
  }
  return sum / seeds;
}

if (process.argv[1] && process.argv[1].endsWith('card-bench.mjs')) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const loadout = get('--loadout', '4');
  const opts = { seeds: Number(get('--seeds', 4)), wave: Number(get('--wave', 10)) };
  const weapons = LOADOUTS[loadout];
  const out = { loadout, weapons, rows: {} };
  for (const kind of Object.keys(BENCHES)) {
    const o = { ...opts, kind };
    const base = dps(weapons, [], o);
    const gain = (extra) => dps(weapons, extra, o) / base - 1;
    const row = { base };
    for (const [k, id] of Object.entries(GLOBALS)) row[k] = gain([id]);
    row.overdrive = gain(['overdrive']);
    // One weapon card: each weapon's best single card (Damage, Rate or Count), averaged over the build.
    const best = [];
    for (const w of weapons) {
      const cards = [find(w, ['damage']), find(w, RATE), find(w, COUNT)].filter(Boolean);
      best.push(Math.max(...cards.map((c) => gain([c.id]))));
    }
    row.weaponCard = best.reduce((a, b) => a + b, 0) / best.length;
    out.rows[kind] = row;
  }
  const blend = {};
  for (const k of Object.keys(out.rows.real)) if (k !== 'base') blend[k] = Math.sqrt((1 + out.rows.real[k]) * (1 + out.rows.kite[k])) - 1;
  out.rows.blend = blend;
  const json = get('--json', null);
  if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(out, null, 1));
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  for (const [kind, row] of Object.entries(out.rows)) console.log(`${loadout} weapons ${kind}: ` + Object.entries(row).filter(([k]) => k !== 'base').map(([k, v]) => `${k} ${pct(v)}`).join(' · '));
}
