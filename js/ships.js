// The Hangar's ships (docs/HANGAR_DESIGN.md §2): 12 drill-crab variants, unlocked by feats (js/feats.js).
// Pure data, DOM-free (the leaderboard server can bundle it to validate ship ids). Names are provisional.
//
// Ships are sidegrades, not a power ladder: each one's `bonuses` use the same keys as the Void Armory
// (progression.js armoryBonuses) and combine with it in shipRunBonuses: *Mult keys multiply, the rest add.
// Ship-only keys:
//   shieldRegenMult   passive shield regen (main.js)            weaponSlots   slots instead of TUNING's 6
//   handSize          fixed level-up hand size (LANCER)         handSizeMin   hands never smaller (GAMBLER)
//   hardcoreShield    HARDCORE's shield rules in every mode: no regen, shield cards or repairs (REVENANT)
// `look`: the silhouette (ship-renderer.js drawCrabShip): carapace width/length, wing span/sweep, claw sizes
// [port, starboard] and decorations. VEXOLITH has none: the crab exactly as before. Visual only: every
// ship keeps the crab's collision radius and shield hull.
// `kit`: the weapons the ship starts with (no start pick), or 'pick' (the start pick), 'last' (the last
// start pick, no pop-up) or 'any' (pick from every unlocked weapon). `quirk` text describes the ship's
// special rule; quirks land with their ships (later PRs), so until then it is description only.
// Every number is a starting point for the Balance lane (each ship should land within ±10% of VEXOLITH's
// median wave on the sim: npm run balance -- --ship <id>).
export const DEFAULT_SHIP = 'vexolith';

export const SHIPS = Object.freeze([
  {
    id: 'vexolith', name: 'VEXOLITH', tier: 'start', color: '#00f3ff', kit: 'pick',
    blurb: 'The drill crab. Balanced, and the ship every weapon is mastered on.',
    bonuses: {}, quirk: 'Pick your starting weapon (mastered weapons join the pick).'
  },
  {
    id: 'mantis', name: 'MANTIS', tier: 'early', color: '#6dff9e', kit: ['blaster'],
    blurb: 'Narrow body, two long scythe claws held forward.',
    bonuses: { bonusHp: -25, moveSpeedMult: 1.08, critChanceBonus: 0.06, critDamageBonus: 0.25 },
    look: { carapace: { w: 0.78, l: 1.12 }, wings: { span: 0.85, sweep: 1.1 }, claws: [1.25, 1.25], extras: ['scythes'] },
    quirk: 'A crit kill refunds 0.15 s of dash cooldown.'
  },
  {
    id: 'prospector', name: 'PROSPECTOR', tier: 'early', color: '#ffcc00', kit: ['mines'],
    blurb: 'Squat body, oversized drill claws, an ore hopper on its back.',
    bonuses: { damageMult: 0.9, miningMult: 1.5, miningRangeMult: 1.3, goldMult: 1.25 },
    look: { carapace: { w: 1.12, l: 0.88 }, wings: { span: 0.7, sweep: 0.9 }, claws: [1.35, 1.35], extras: ['hopper'] },
    quirk: 'Rocks you break are 50% more likely to hold a gold vein.'
  },
  {
    id: 'wasp', name: 'WASP', tier: 'early', color: '#ffe14d', kit: ['rockets'],
    blurb: 'Thin, swept wings and a stinger tail.',
    bonuses: { bonusHp: -20, moveSpeedMult: 1.15, dashCooldownMult: 0.7, dashDistanceMult: 1.2 },
    look: { carapace: { w: 0.8, l: 1.0 }, wings: { span: 1.15, sweep: 1.3 }, claws: [0.85, 0.85], extras: ['stinger'] },
    quirk: 'Dashing leaves a short afterburn streak that sets enemies on FIRE.'
  },
  {
    id: 'hermit', name: 'HERMIT', tier: 'early', color: '#5aa8ff', kit: ['shockfield'],
    blurb: 'A round shell dome, claws tucked under.',
    bonuses: { bonusHp: 50, moveSpeedMult: 0.88, shieldRegenMult: 1.5 },
    look: { carapace: { w: 1.1, l: 0.95 }, wings: { span: 0.6, sweep: 0.8 }, claws: [0.8, 0.8], extras: ['dome'] },
    quirk: 'The first time your shield would break each run, it holds at 1 for 1.5 s.'
  },
  {
    id: 'pyre', name: 'PYRE', tier: 'mid', color: '#ff9b3d', kit: ['flamethrower'],
    blurb: 'Claws that end in nozzles, ember vents along the carapace.',
    bonuses: { bonusHp: -8, statusDurationMult: 1.4 },
    look: { carapace: { w: 1.0, l: 1.0 }, wings: { span: 0.9, sweep: 1.0 }, claws: [1.0, 1.0], extras: ['nozzles', 'vents'] },
    quirk: 'Enemies that die burning spread FIRE to one neighbour.'
  },
  {
    id: 'gambler', name: 'MAGPIE', tier: 'mid', color: '#d68fff', kit: 'last',
    blurb: 'Hex plates on its back like dice faces, glinting.',
    bonuses: { bonusHp: -15, luckBonus: 0.3, startGold: 60, rerollCostMult: 0.6, handSizeMin: 3 },
    look: { carapace: { w: 1.0, l: 1.0 }, wings: { span: 0.95, sweep: 1.0 }, claws: [1.0, 1.0], extras: ['dice'] },
    quirk: 'Level-up hands always show at least 3 cards.'
  },
  {
    id: 'brood', name: 'BROOD', tier: 'mid', color: '#b6ff4a', kit: ['drones', 'turret'], weaponSlots: 5,
    blurb: 'A wide carapace with launch-bay hatches.',
    bonuses: { primaryDamageMult: 0.85, deployableBonus: 1 },
    look: { carapace: { w: 1.18, l: 0.95 }, wings: { span: 0.8, sweep: 0.9 }, claws: [0.9, 0.9], extras: ['hatches'] },
    quirk: 'Starts with Escort Drones and a Sentry Turret; deployables come one extra at a time. 5 slots. Can\'t earn mastery.'
  },
  {
    id: 'lancer', name: 'LANCER', tier: 'mid', color: '#ff6ad5', kit: 'pick', weaponSlots: 3,
    blurb: 'Lopsided: one giant claw and one stub.',
    bonuses: { handSize: 4 },
    look: { carapace: { w: 0.95, l: 1.05 }, wings: { span: 0.9, sweep: 1.05 }, claws: [0.6, 1.5], extras: [] },
    quirk: 'Only 3 weapon slots, but level-ups show 4 cards from the start and every weapon card gives +1 rank.'
  },
  {
    id: 'revenant', name: 'REVENANT', tier: 'late', color: '#ff5a5a', kit: ['blaster'],
    blurb: 'A skeletal outline with cracked, glowing seams.',
    bonuses: { damageMult: 1.4, hardcoreShield: true },
    look: { carapace: { w: 0.92, l: 1.0 }, wings: { span: 1.0, sweep: 1.15 }, claws: [1.05, 1.05], extras: ['seams'] },
    quirk: 'No shield regen, repairs or shield cards in any mode. Each boss you kill gives +8% damage for the run.'
  },
  {
    id: 'leviathan', name: 'LEVIATHAN', tier: 'late', color: '#38ffc8', kit: ['gas'],
    blurb: 'A long segmented tail trailing the hull.',
    bonuses: { magnetMult: 1.2, xpMult: 1.1 },
    look: { carapace: { w: 0.9, l: 1.05 }, wings: { span: 0.75, sweep: 1.0 }, claws: [1.0, 1.0], extras: ['tail'] },
    quirk: 'The tail is a blade that damages what it sweeps (it has no hitbox).'
  },
  {
    id: 'sovereign', name: 'SOVEREIGN', tier: 'late', color: '#ffffff', kit: 'any', weaponSlots: 7,
    blurb: 'A crowned crab with a prism-faceted shell.',
    bonuses: {}, look: { carapace: { w: 1.05, l: 1.05 }, wings: { span: 1.05, sweep: 1.0 }, claws: [1.1, 1.1], extras: ['crown', 'facets'] },
    quirk: '7 weapon slots. Start with any weapon you have unlocked.'
  }
]);

export const SHIP_IDS = Object.freeze(SHIPS.map((s) => s.id));
export const SHIP_BY_ID = Object.freeze(Object.fromEntries(SHIPS.map((s) => [s.id, s])));
export const isShip = (id) => typeof id === 'string' && Object.hasOwn(SHIP_BY_ID, id);
export const normalizeShip = (id) => (isShip(id) ? id : DEFAULT_SHIP);
export const shipDef = (id) => SHIP_BY_ID[normalizeShip(id)];

// Armory keys that are multipliers (combine by multiplying); the floors match armoryBonuses'.
const FLOORS = { dashCooldownMult: 0.5, rerollCostMult: 0.4 };
const isMult = (k) => k.endsWith('Mult');

// A ship's bonuses on top of the Void Armory's (`armory`: progression.js armoryBonuses, after modeBonuses).
// VEXOLITH returns the armory bonuses unchanged (same object contents), so flag-off runs are identical.
export function shipRunBonuses(armory = {}, id = DEFAULT_SHIP) {
  const ship = shipDef(id);
  const out = { ...armory };
  for (const [k, v] of Object.entries(ship.bonuses)) {
    if (typeof v === 'boolean') out[k] = v;
    else if (isMult(k)) out[k] = Math.max(FLOORS[k] ?? 0, (out[k] ?? 1) * v);
    else out[k] = (out[k] || 0) + v;
  }
  if (ship.weaponSlots) out.weaponSlots = ship.weaponSlots;
  return out;
}

// The ship's fixed starting kit, or null when the ship takes a start pick ('pick', 'last', 'any').
// The silhouette a run's player carries (null for VEXOLITH), with the ship colour for the carapace.
export const shipLook = (id) => { const s = shipDef(id); return s.look ? { ...s.look, color: s.color } : null; };

export const shipFixedKit = (id) => (Array.isArray(shipDef(id).kit) ? [...shipDef(id).kit] : null);

// Stat chips vs VEXOLITH for the Hangar card: [{ label, text, good }].
const CHIP = {
  bonusHp: ['SHIELD', (v) => `${v > 0 ? '+' : ''}${v}`],
  damageMult: ['DAMAGE', null], primaryDamageMult: ['PRIMARY DMG', null], moveSpeedMult: ['SPEED', null],
  critChanceBonus: ['CRIT', (v) => `+${Math.round(v * 100)} pts`], critDamageBonus: ['CRIT DMG', (v) => `+${Math.round(v * 100)}%`],
  miningMult: ['MINING', null], miningRangeMult: ['DRILL REACH', null], goldMult: ['GOLD', null],
  dashCooldownMult: ['DASH COOLDOWN', null], dashDistanceMult: ['DASH DISTANCE', null], shieldRegenMult: ['REGEN', null],
  statusDurationMult: ['STATUS TIME', null], luckBonus: ['LUCK', (v) => `+${Math.round(v * 100)}%`],
  startGold: ['START GOLD', (v) => `+${v}`], rerollCostMult: ['REROLL COST', null], magnetMult: ['PICKUP', null],
  xpMult: ['XP', null], deployableBonus: ['DEPLOYABLES', (v) => `+${v}`], handSize: ['HAND', (v) => `${v} cards`],
  handSizeMin: ['HAND', (v) => `${v}+ cards`], hardcoreShield: ['SHIELD', () => 'NO REPAIRS']
};
const LOWER_IS_BETTER = new Set(['dashCooldownMult', 'rerollCostMult']);

export function shipStatChips(id) {
  const ship = shipDef(id);
  const chips = [];
  for (const [k, v] of Object.entries(ship.bonuses)) {
    const [label, fmt] = CHIP[k] || [k.toUpperCase(), null];
    const text = fmt ? fmt(v) : `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%`;
    const up = typeof v === 'boolean' ? !v : isMult(k) ? v >= 1 : v > 0;
    chips.push({ label, text: text.replace(/^-/, '−'), good: LOWER_IS_BETTER.has(k) ? !up : up });
  }
  if (ship.weaponSlots) chips.push({ label: 'SLOTS', text: String(ship.weaponSlots), good: ship.weaponSlots > 6 });
  return chips;
}
