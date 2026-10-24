// How often single cards turn up in level-up hands for a fixed loadout: the share of hands that offer each
// card in `--cards`, and the rarity it shows. Players take ~3 random picks per weapon first (a mid-run build).
//
//   node tools/balance/offer-rates.mjs --loadout blaster,flamethrower,drones,rockets --cards pierce,flamethrower_nozzles,tag_kinetic [--players 200] [--hands 40]
const h = await import('./harness.mjs');
const U = await import('../../js/upgrades.js');
const { handSizeFor } = await import('../../js/slot-rewards.js');

export function offerRates(loadout, cards, { players = 200, hands = 40, seed = 'offers' } = {}) {
  const real = Math.random;
  Math.random = h.seededRandom(`${seed}:${loadout.join(',')}`);
  const seen = Object.fromEntries(cards.map((id) => [id, 0]));
  const rarity = Object.fromEntries(cards.map((id) => [id, {}]));
  let total = 0;
  try {
    for (let i = 0; i < players; i++) {
      const g = h.createHeadlessGame();
      g.resetRun();
      const p = g.player;
      for (const w of loadout) U.acquireWeapon(p, w);
      for (let k = 0; k < 3 * loadout.length; k++) {
        const hand = U.rollUpgrades(p, 3).filter((c) => !cards.includes(c.id));
        if (hand.length) U.applyUpgradeLevels(p, hand[Math.floor(Math.random() * hand.length)]);
      }
      for (let k = 0; k < hands; k++) {
        total++;
        for (const c of U.rollUpgrades(p, handSizeFor(loadout.length))) {
          if (!(c.id in seen)) continue;
          seen[c.id]++;
          const r = U.rarityFor(c, c.levelJump);
          rarity[c.id][r] = (rarity[c.id][r] || 0) + 1;
        }
      }
    }
  } finally {
    Math.random = real;
  }
  return Object.fromEntries(cards.map((id) => [id, { share: seen[id] / total, rarity: rarity[id] }]));
}

if (process.argv[1] && process.argv[1].endsWith('offer-rates.mjs')) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const r = offerRates(get('--loadout', 'blaster').split(','), get('--cards', '').split(','), { players: Number(get('--players', 200)), hands: Number(get('--hands', 40)) });
  for (const [id, v] of Object.entries(r)) console.log(`${id.padEnd(22)} ${(v.share * 100).toFixed(1).padStart(5)}% of hands  ${JSON.stringify(v.rarity)}`);
}
