// Level-up hand dominance bench: is any card strictly worse than another card that can share its hand?
// Realized damage on the card bench's two chase benches (card-bench.mjs: `real` = bot-like 260 px loop with
// dashes, `kite` = human-like 1200 px loop without; 25 chasing wave-10 targets; Armory-free), blended as
// their geometric mean. Three parts:
//
//   weapons   every stat card (and the first element card) of each weapon, alone, at LV 1 (`early`) and on
//             a mid-run build (Damage x3, its rate card x2, its count card x1): does a Rate, Count or UTILITY
//             card out-damage the Damage card?
//   globals   one rank of each global / tag / crit card on a 2 / 4 / 6 weapon mid-run build against one
//             weapon card (each weapon's best single card, averaged) and Reactor Overdrive.
//   early     the Armory-free opening: each starting weapon alone at LV 1, its cards against Overdrive, crit
//             and the global cards that can share its first hands.
//
//   node tools/balance/hand-bench.mjs --part weapons|globals|early [--only id,id] [--seeds 4] [--json out.json]
const h = await import('./harness.mjs');
const U = await import('../../js/upgrades.js');
const { STAT_CARDS, ELEMENT_CARDS, POWER_STATS } = await import('../../js/weapon-levels.js');
const { WEAPON_BY_ID, START_WEAPON_CHOICES } = await import('../../js/loadout.js');

const BENCHES = { real: { orbitRadius: 260, dash: true }, kite: { orbitRadius: 1200, dash: false } };
const RATE = ['rate', 'reload', 'recharge', 'cooldown'];
const COUNT = ['count', 'salvo', 'prism', 'wingmen', 'chain', 'nozzles'];
const find = (w, stats) => STAT_CARDS[w].find((c) => stats.includes(c.stat));
const install = (p, id, levelJump = 1) => U.applyUpgradeLevels(p, { ...U.UPGRADE_BY_ID[id], levelJump });
export const LOADOUTS = {
  2: ['blaster', 'rockets'],
  4: ['blaster', 'rockets', 'grenades', 'singularity'],
  6: ['blaster', 'rockets', 'grenades', 'singularity', 'drones', 'turret'],
  sprayers: ['flamethrower', 'missiles', 'lightning', 'nanites', 'gas', 'glaive']
};
// Non-weapon cards that add damage and can share a hand with weapon cards (ship utility is left out: it adds none).
export const GLOBAL_IDS = ['overdrive', 'crit_chance', 'crit_damage', 'tag_kinetic', 'tag_explosive', 'tag_electric', 'tag_area',
  'tempo_core', 'cooldown_matrix', 'persistence_field', 'velocity_coils', 'replicator_array', 'shrapnel'];

// The build: `weapons` equipped at LV 1, or (mid) Damage x3, rate x2, count x1 each; then `extra` cards.
function build(weapons, extra, mid) {
  return (p) => {
    if (!weapons.includes('blaster')) U.discardWeapon(p, 'blaster');
    for (const w of weapons) {
      if (!p.loadout.includes(w)) install(p, WEAPON_BY_ID[w].levelId);
      if (!mid) continue;
      install(p, find(w, ['damage']).id, 3);
      if (find(w, RATE)) install(p, find(w, RATE).id, 2);
      if (find(w, COUNT)) install(p, find(w, COUNT).id, 1);
    }
    for (const id of extra) install(p, id);
  };
}

function dps(weapons, extra, mid, kind, seeds) {
  const { orbitRadius, dash } = BENCHES[kind];
  let sum = 0;
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    const r = h.benchUpgrade({ seed: 'handbench', scenario: 'chase', seedIndex, setup: build(weapons, extra, mid),
      bench: { ...h.BENCH, targets: 25, orbitRadius, targetWave: 10 }, dash });
    for (const [src, v] of Object.entries(r.dps)) if (src !== 'nova' && src !== 'thrusters') sum += v;
  }
  return sum / seeds;
}

// Blended gain of each card set in `cards` ({ label: [ids] }) over the build without them.
function gains(weapons, cards, mid, seeds) {
  const out = {};
  const base = {};
  for (const kind of Object.keys(BENCHES)) base[kind] = dps(weapons, [], mid, kind, seeds);
  for (const [label, ids] of Object.entries(cards)) {
    const g = {};
    for (const kind of Object.keys(BENCHES)) g[kind] = dps(weapons, ids, mid, kind, seeds) / Math.max(1e-9, base[kind]) - 1;
    out[label] = { ...g, blend: Math.sqrt((1 + g.real) * (1 + g.kite)) - 1 };
  }
  return out;
}

const eligible = (weapons, id, mid) => {
  const g = h.createHeadlessGame();
  g.resetRun();
  build(weapons, [], mid)(g.player);
  return U.eligibleUpgrades(g.player).some((u) => u.id === id);
};

export function weaponCards(w, mid, seeds) {
  const cards = {};
  for (const c of STAT_CARDS[w]) cards[`${c.id}${POWER_STATS.has(c.stat) ? '' : ' (utility)'}`] = [c.id];
  if (ELEMENT_CARDS[w]) for (const c of ELEMENT_CARDS[w]) cards[`${c.id} (element)`] = [c.id];
  return gains([w], cards, mid, seeds);
}

export function globalCards(weapons, mid, seeds) {
  const cards = {};
  for (const id of GLOBAL_IDS) if (eligible(weapons, id, mid)) cards[id] = [id];
  const r = gains(weapons, cards, mid, seeds);
  // One weapon card: each weapon's best single card (Damage, Rate or Count), averaged over the build.
  const best = weapons.map((w) => {
    const per = gains(weapons, Object.fromEntries([find(w, ['damage']), find(w, RATE), find(w, COUNT)].filter(Boolean).map((c) => [c.id, [c.id]])), mid, seeds);
    return Math.max(...Object.values(per).map((v) => v.blend));
  });
  r['(best weapon card, avg)'] = { blend: best.reduce((a, b) => a + b, 0) / best.length };
  return r;
}

if (process.argv[1] && process.argv[1].endsWith('hand-bench.mjs')) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const part = get('--part', 'weapons');
  const seeds = Number(get('--seeds', 4));
  const only = get('--only', null)?.split(',');
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const out = {};
  if (part === 'weapons') {
    for (const w of only || Object.keys(STAT_CARDS)) {
      out[w] = { early: weaponCards(w, false, seeds), mid: weaponCards(w, true, seeds) };
      for (const stage of ['early', 'mid']) console.log(`${w} ${stage}: ` + Object.entries(out[w][stage]).map(([k, v]) => `${k} ${pct(v.blend)}`).join(' · '));
    }
  } else if (part === 'globals') {
    for (const n of only || Object.keys(LOADOUTS)) {
      out[n] = globalCards(LOADOUTS[n], true, seeds);
      console.log(`${n} weapons: ` + Object.entries(out[n]).map(([k, v]) => `${k} ${pct(v.blend)}`).join(' · '));
    }
  } else if (part === 'early') {
    for (const w of only || START_WEAPON_CHOICES) {
      const r = globalCards([w], false, seeds);
      Object.assign(r, weaponCards(w, false, seeds));
      out[w] = r;
      console.log(`${w} LV 1: ` + Object.entries(r).map(([k, v]) => `${k} ${pct(v.blend)}`).join(' · '));
    }
  }
  const json = get('--json', null);
  if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(out, null, 1));
}
