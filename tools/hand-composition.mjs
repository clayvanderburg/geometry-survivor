// Level-up hand composition by weapons carried: what share of offered cards are weapon cards (stat and
// element), global cards (power, crit, tag, STATUS, passive, Replicator), utility cards (ship systems)
// and evolutions, and how often a hand holds at least one non-weapon card.
//
//   node tools/hand-composition.mjs [players per row=300] [hands per player=40]
//   node tools/hand-composition.mjs --bots [seconds=600] [seeds=6]   (bot builds, see botBuilds)
//
// Each player equips the Autocannon plus random weapons up to the row's count, then takes ~3 random
// picks per weapon from real hands (a mid-run build), then rolls hands of the size the game uses for
// that loadout (slot-rewards.js handSizeFor). NEW WEAPON cards are left out: they replace a card on
// their own schedule (rollLevelUpHand) and are the same before and after any weighting change.
import { createHeadlessGame, seededRandom } from './balance/harness.mjs';
import { rollUpgrades, acquireWeapon, applyUpgradeLevels, upgradeKind } from '../js/upgrades.js';
import { unownedWeapons } from '../js/loadout.js';
import { handSizeFor } from '../js/slot-rewards.js';
import { cardScope } from '../js/upgrade-cards.js';

const players = Number(process.argv[2]) || 300;
const handsPer = Number(process.argv[3]) || 40;

export function category(card) {
  const kind = upgradeKind(card);
  if (kind === 'weapon' || kind === 'element') return 'weapon';
  if (kind === 'evolution') return 'evolution';
  return cardScope(card) === 'utility' ? 'utility' : 'global';
}

export function handComposition(weapons, { players: n = players, hands = handsPer, seed = 'hands' } = {}) {
  const real = Math.random;
  Math.random = seededRandom(`${seed}:${weapons}`);
  const tally = { weapon: 0, global: 0, utility: 0, evolution: 0 };
  let offered = 0, handsWithOther = 0, handsWithGlobal = 0, handCount = 0;
  try {
    for (let i = 0; i < n; i++) {
      const g = createHeadlessGame();
      g.resetRun();
      const p = g.player;
      while (p.loadout.length < weapons) {
        const pool = unownedWeapons(p);
        acquireWeapon(p, pool[Math.floor(Math.random() * pool.length)]);
      }
      for (let k = 0; k < 3 * weapons; k++) {
        const hand = rollUpgrades(p, 3);
        if (hand.length) applyUpgradeLevels(p, hand[Math.floor(Math.random() * hand.length)]);
      }
      for (let h = 0; h < hands; h++) {
        const hand = rollUpgrades(p, handSizeFor(weapons));
        handCount++;
        let other = false, global = false;
        for (const c of hand) {
          const cat = category(c);
          tally[cat]++;
          offered++;
          if (cat !== 'weapon') other = true;
          if (cat === 'global') global = true;
        }
        if (other) handsWithOther++;
        if (global) handsWithGlobal++;
      }
    }
  } finally {
    Math.random = real;
  }
  const share = (v) => v / Math.max(1, offered);
  return {
    weapons, handSize: handSizeFor(weapons),
    weapon: share(tally.weapon), global: share(tally.global), utility: share(tally.utility), evolution: share(tally.evolution),
    handsWithOther: handsWithOther / handCount, handsWithGlobal: handsWithGlobal / handCount
  };
}

if (import.meta.url === `file://${process.argv[1]}` && !process.argv.includes('--bots')) {
  const pct = (v) => `${Math.round(v * 100)}%`.padStart(5);
  console.log('weapons | hand | weapon | global | utility | evo | hands with a non-weapon card | hands with a global card');
  for (let w = 1; w <= 6; w++) {
    const r = handComposition(w);
    console.log(`${String(w).padStart(7)} | ${String(r.handSize).padStart(4)} | ${pct(r.weapon)}  | ${pct(r.global)}  | ${pct(r.utility)}   | ${pct(r.evolution)} | ${pct(r.handsWithOther).padStart(28)} | ${pct(r.handsWithGlobal).padStart(24)}`);
  }
}

// --bots [seconds=600] [seeds=6]: whole god-mode bot runs with and without the rescale (handWeaponShare 0
// switches it off), and what the builds look like at the end.
export async function botBuilds(seconds = 600, seeds = 6) {
  const { simulateRun } = await import('./balance/harness.mjs');
  const { NAMED_STRATEGIES } = await import('./balance/strategies.mjs');
  const { UPGRADE_BY_ID } = await import('../js/upgrades.js');
  const { weaponLevel } = await import('../js/loadout.js');
  const rows = [];
  for (const name of ['random', 'projectile', 'explosive']) {
    const strategy = NAMED_STRATEGIES.find((s) => s.name === name);
    for (const [label, tuning] of [['before', { handWeaponShare: 0 }], ['after', {}]]) {
      const sum = { level: 0, weapons: 0, weaponLv: 0, global: 0, utility: 0, evolution: 0, breakthroughs: 0 };
      for (let s = 0; s < seeds; s++) {
        const r = simulateRun({ strategy, seed: `hands-${s}`, maxSeconds: seconds, god: true, tuning });
        sum.level += r.level;
        sum.weapons += r.loadout.length;
        const fake = { upgradeLevels: r.build, loadout: r.loadout, weapons: {} };
        sum.weaponLv += r.loadout.reduce((a, id) => a + weaponLevel(fake, id), 0) / Math.max(1, r.loadout.length);
        for (const [id, lv] of Object.entries(r.build)) {
          const u = UPGRADE_BY_ID[id];
          if (!u || isWeaponCardId(u)) continue;
          const cat = category(u);
          if (cat in sum) sum[cat] += lv;
        }
        sum.breakthroughs += Object.values(r.breakthroughs || {}).length || 0;
      }
      const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / seeds]));
      rows.push({ strategy: name, label, ...avg });
    }
  }
  return rows;
}
const isWeaponCardId = (u) => ['weapon', 'element', 'core'].includes(upgradeKind(u));

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--bots')) {
  const f = (v) => v.toFixed(1).padStart(6);
  console.log('\nstrategy   |        | player LV | weapons | avg weapon LV | global ranks | utility ranks | evolutions');
  for (const r of await botBuilds(Number(process.argv[3]) || 600, Number(process.argv[4]) || 6)) {
    console.log(`${r.strategy.padEnd(10)} | ${r.label.padEnd(6)} | ${f(r.level)}    | ${f(r.weapons)}  | ${f(r.weaponLv)}        | ${f(r.global)}       | ${f(r.utility)}        | ${f(r.evolution)}`);
  }
}
