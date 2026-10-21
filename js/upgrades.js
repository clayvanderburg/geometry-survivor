// Roguelite Upgrades, Luck Multi-Level Rolls (+2 / +3 Levels), Mining Drill, and Golden Synergies
import { TUNING } from './config.js';
import { modeRules } from './modes.js';
import { WEAPON_SCALING as W } from './weapon-scaling.js';
import {
  WEAPONS, WEAPON_BY_ID, WEAPON_BY_LEVEL_ID, ownsWeapon, ownedWeapons, ownedTags, freeSlots, unownedWeapons, weaponSlots, weaponLevel, weaponTags
} from './loadout.js';
import {
  STAT_CARDS, STAT_CARD_BY_ID, WEAPON_MAX_LEVEL, WEAPON_BADGE, BREAKTHROUGH_LEVELS, ELEMENTS, ELEMENT_INFO, ELEMENT_CARDS, ELEMENT_CARD_BY_ID,
  levelCardWeapon, weaponElement, elementsOf
} from './weapon-levels.js';
import { BREAKTHROUGH_SLOT } from './slot-rewards.js';

// Rarity is the size of the rolled level jump: +1 common, +2 uncommon, +3 rare, +4 epic,
// +5 legendary. Evolutions (synergies) are one-shot unlocks with their own tier.
export const RARITY = {
  common: { label: 'COMMON', color: '#c9d4e4' },
  uncommon: { label: 'UNCOMMON', color: '#00ff88' },
  rare: { label: 'RARE', color: '#3d9bff' },
  epic: { label: 'EPIC', color: '#b565ff' },
  legendary: { label: 'LEGENDARY', color: '#ffcc00' },
  evolution: { label: 'EVOLUTION', color: '#ff4fd8' },
  // Loadout cards (NEW WEAPON and the weapon it opens) are not level rolls, so they get their own tier.
  weapon: { label: 'NEW WEAPON', color: '#ff8a3d' },
  // Breakthrough choices at weapon LV 6 / 12 / 18 (not level rolls either).
  transform: { label: '⚛ TRANSFORM', color: '#38f2d0' },
  boost: { label: '⚛ ACROSS THE BOARD', color: '#ffb347' }
};

const RARITY_BY_JUMP = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

export function rarityFor(upg, jump = 1) {
  if (upg.isSynergy) return 'evolution';
  return RARITY_BY_JUMP[Math.max(1, Math.min(5, jump))];
}

// Each slot weapon contributes its equip line (LV 1, installed by acquireWeapon; never offered in a
// hand) and its single-stat cards (weapon-levels.js STAT_CARDS). A stat card raises its stat and the
// weapon's level by 1 per rank; weapon-scaling.js reads the ranks from upgradeLevels and solves the
// damage from the level, so apply() only has to keep player.weapons[levelKey] equal to the level.
const CORE_INFO = {
  blaster: { headline: 'damage', summary: 'Twin plasma streams straight at your aim.' },
  rockets: { headline: 'rocketCount', summary: 'Flank-pod dumbfire rockets fly where you aim: a direct hit plus a small blast.' },
  missiles: { headline: 'missileSalvo', summary: 'Curving, ribbon-trailing homing missiles that detonate on impact.' },
  orbitals: { headline: 'orbitalBlades', summary: 'Spinning saw-triangles orbit your ship and shred anything they touch.' },
  lightning: { headline: 'lightningJumps', summary: 'High-voltage chain lightning arcs across packs of nearby swarmers.' },
  singularity: { headline: 'singularityPull', summary: 'Launches gravitational singularities that warp the grid, suck swarms inward, and implode.' },
  mines: { headline: 'mineMaxActive', summary: 'Drops mines in your wake that arm, then burst when an enemy drifts close.' },
  turret: { headline: 'turretCharges', summary: 'Stand still to plant your turret charges: each turret shoots the nearest enemy it can see past asteroid cover until it breaks down. Charges reload over time.' },
  drones: { headline: 'droneCount', summary: 'Gunship drones fly in formation behind your hull and fire at nearby targets.' },
  grenades: { headline: 'grenadeCount', summary: 'Lobs plasma grenades at the nearest enemies: they land, blink armed for a moment, then burst in an area blast.' },
  gas: { headline: 'gasRadius', summary: 'Vents a lingering trail of corrosive gas behind your ship (and a giant cloud every time you dash): enemies inside take damage over time and CORRODE. Always CORROSIVE, so STATUS cards boost it.' },
  flamethrower: { headline: 'flameRange', summary: 'A nozzle spins slowly round your ship spraying a cone of fire: it scorches everything inside and sets it on FIRE. Asteroids block the flames.' },
  cryospray: { headline: 'cryoRange', summary: 'A nozzle spins slowly round your ship spraying a cone of frost: everything inside slows as COLD builds, then FREEZES solid. Asteroids block the spray.' },
  acidspray: { headline: 'acidRange', summary: 'A nozzle spins slowly round your ship spraying a cone of acid: everything inside CORRODES, taking acid ticks and more damage from every weapon. Asteroids block the spray.' },
  shockfield: { headline: 'fieldRadius', summary: 'Defensive: a charged field round your hull discharges when enemies get close, zapping and SHOCKing (stunning) everything inside, then recharges. It never repairs your shield.' },
  raillance: { headline: 'railDamage', summary: 'Charges for a moment, then fires a hair-thin line down your aim that pierces every enemy and every rock to the edge of the screen. Each enemy behind the first takes a little less. Slow fire, huge hits: line packs up.' },
  glaive: { headline: 'glaiveCount', summary: 'Flings spinning discs at the nearest enemies: each one ricochets from enemy to enemy (and off rocks), losing a little speed every bounce.' },
  nanites: { headline: 'naniteRadius', summary: 'Every few seconds a canister of nanites flies to the densest pack nearby and bursts into a swarm that follows the pack and eats it: it grows with every kill, then disperses. Always CORROSIVE, so STATUS cards boost it.' },
  harpoon: { headline: 'harpoonRange', summary: 'Fires one of your drill-claws on a tether where you aim: it pierces every enemy on its line, drills through rock (mining it as it goes) and yanks small enemies back into your other claw, which crushes them.' },
  quake: { headline: 'quakeShells', summary: 'Lobs heavy shells at the densest packs: each lands as an expanding shockwave ring that hits everything it rolls over, shoves it back and cracks rocks (broken rocks count as mined).' }
};

// The card preview row (upgrade-cards.js elementRows) an element card leads with.
const ELEMENT_HEADLINE = { fire: 'burn', frost: 'chill', corrode: 'corrodeMax', shock: 'stun' };

function weaponGroup(id) {
  const w = WEAPON_BY_ID[id];
  const key = w.levelKey;
  const tags = weaponTags(id);
  const bump = (player) => { player.weapons[key] = (player.weapons[key] || 0) + 1; };
  const core = { id: w.levelId, name: w.name, category: w.category, tags, maxLevel: 1, isCore: true, weapon: id, ...CORE_INFO[id], apply: bump };
  const stats = STAT_CARDS[id].map((c) => ({
    id: c.id, name: c.name, category: WEAPON_BADGE[id], owners: [id], tags, maxLevel: c.maxLevel, headline: c.headline,
    summary: c.summary, statCard: true, weapon: id, stat: c.stat, apply: bump
  }));
  // Element cards (weapon-levels.js ELEMENT_CARDS): level cards like the stat cards, plus the element's
  // rank in player.weapons. `req` is the element lock: once the weapon has an element, only that one's
  // card is offered (as a rank-up). They never come from supply caches (rollUpgrades { cache: true }).
  const elements = (ELEMENT_CARDS[id] || []).map((c) => ({
    id: c.id, name: c.name, category: WEAPON_BADGE[id], owners: [id], tags: [ELEMENT_INFO[c.element].status], maxLevel: c.maxLevel,
    headline: `${id}:${ELEMENT_HEADLINE[c.element]}`, summary: c.summary, elementCard: true, weapon: id, element: c.element,
    req: (player) => {
      const cur = weaponElement(player, id);
      return !cur || cur.element === c.element;
    },
    apply(player) {
      bump(player);
      player.weapons[c.id] = (player.weapons[c.id] || 0) + 1;
    }
  }));
  return [core, ...stats, ...elements];
}

// Elements carried by the player's equipped weapons (STATUS cards are only offered for these).
export const ownedElements = (player) => elementsOf(player, ownedWeapons(player));
const hasElement = (player, ...els) => {
  const owned = ownedElements(player);
  return els.length ? els.some((el) => owned.has(el)) : owned.size > 0;
};

// Global STATUS cards: they strengthen every element-infused weapon and never raise a weapon's level.
const statusCard = (id, name, maxLevel, headline, tags, summary, req, apply) =>
  ({ id, name, category: 'STATUS', tags, maxLevel, headline, summary, statusCard: true, req, apply });
const elementDamageCard = (element, name) => statusCard(`${element}_damage`, name, 5, `${element}Damage`, [ELEMENT_INFO[element].status],
  `${ELEMENT_INFO[element].label} weapons hit harder${element === 'frost' ? '' : `, and their ${element === 'fire' ? 'burn' : element === 'corrode' ? 'acid' : 'shock arcs'} tick harder too`}.`,
  (player) => hasElement(player, element),
  (player) => {
    const m = player.stats.elementDamage || (player.stats.elementDamage = {});
    m[element] = (m[element] ?? 1) + W.elementDamageStep;
  });
const addRank = (key) => (player) => { player.stats[key] = (player.stats[key] || 0) + 1; };
// Ids are kept from before the stack rework (v0.40), so saves, locks and strategies keep working:
// status_application is now Status Reactions.
const STATUS_CARDS = [
  statusCard('status_potency', 'Status Potency', 5, 'statusPotency', ['burn', 'chill', 'corrode', 'shock'],
    'Every element hit applies more stacks: more burn, faster freezes, more corrosion and stronger shock arcs.',
    (player) => hasElement(player), addRank('statusPotency')),
  statusCard('status_application', 'Status Reactions', 5, 'statusApplication', ['burn', 'chill', 'corrode', 'shock'],
    'Fire spreads more often, FROST freezes sooner, CORRODE caps higher and SHOCK rolls more long stuns.',
    (player) => hasElement(player), addRank('statusApplication')),
  statusCard('status_duration', 'Status Duration', 5, 'statusDuration', ['burn', 'chill', 'corrode', 'shock'],
    'Stacks wear off slower (so they build higher and tick longer), freezes last longer and stuns a little longer.',
    (player) => hasElement(player), addRank('statusDuration')),
  statusCard('shock_conductor', 'Shock Conductor', 5, 'stunLongChance', ['shock'],
    'SHOCK weapons land long stuns more often, every stun lasts longer and more shock conducts between touching enemies.',
    (player) => hasElement(player, 'shock'), addRank('shockConductor')),
  elementDamageCard('fire', 'Fire Amplifier'),
  elementDamageCard('frost', 'Frost Amplifier'),
  elementDamageCard('corrode', 'Corrosive Amplifier'),
  elementDamageCard('shock', 'Shock Amplifier')
];

// Each entry: headline (the STAT_ROWS id shown enlarged on its card, see upgrade-cards.js),
// a number-free summary and optional tags (TAG_INFO keys in weapon-scaling.js, shown as chips:
// the weapon families it belongs to or boosts). Exact numbers always come from the card preview.
//
// Loadout gating (rollUpgrades): a weapon's stat cards are offered only while that weapon is equipped
// and below LV 18 (its equip line is never offered; NEW WEAPON installs it). `owners` lists the weapons a weapon-specific line belongs to (offered
// while any of them is equipped, removed when the last one is discarded); evolutions also name
// `ownersAll`. Lines without owners are general upgrades (passives such as Volatile Shatter included).
// Tag cards need an equipped weapon or an owned passive with the tag.
export const MAGNET_RADIUS_STEP = Math.pow(Math.pow(1.65, 5) / 2, 1 / 5); // ~1.437 per level
export const MAGNET_XP_STEP = Math.pow(2, 1 / 5); // ~1.149 per level

// Drill-claw numbers (v0.44.0 trim: the old x1.12 / x1.9 stacked to ~6x mining speed with the Armory).
export const MINING_SPEED_STEP = 1.06; // per Rotary Claw Overclock level
export const TECTONIC_MINING_SPEED = 1.18;
export const TECTONIC_MINING_RANGE = 1.15;
export const TECTONIC_DRILL_SCALE = 1.15;

export const UPGRADE_POOL = [
  {
    id: 'mining_speed',
    name: 'Rotary Claw Overclock',
    category: 'DRILL CLAWS',
    maxLevel: 10,
    headline: 'miningSpeed',
    summary: 'Spins the twin drill-claws faster. Only mining speed.',
    apply(player) {
      player.stats.miningSpeed *= MINING_SPEED_STEP;
    }
  },
  {
    id: 'luck_boost',
    name: 'Quantum Fortune Matrix',
    category: 'LUCK',
    maxLevel: 5,
    headline: 'luck',
    summary: 'Raises the odds of lucky multi-level rolls, supply caches and cache jackpots.',
    apply(player) {
      player.stats.luck += 0.25;
    }
  },
  ...weaponGroup('blaster'),
  {
    id: 'overdrive',
    name: 'Reactor Overdrive',
    category: 'POWER',
    maxLevel: 5,
    headline: 'allDamage',
    summary: 'Overclocks the reactor: every weapon hits harder.',
    apply(player) {
      player.stats.damage *= 1.12;
    }
  },
  ...weaponGroup('rockets'),
  ...weaponGroup('missiles'),
  ...weaponGroup('orbitals'),
  ...weaponGroup('lightning'),
  ...weaponGroup('singularity'),
  ...weaponGroup('grenades'),
  ...weaponGroup('gas'),
  ...weaponGroup('flamethrower'),
  ...weaponGroup('cryospray'),
  ...weaponGroup('acidspray'),
  ...weaponGroup('shockfield'),
  ...weaponGroup('raillance'),
  ...weaponGroup('glaive'),
  ...weaponGroup('nanites'),
  ...weaponGroup('harpoon'),
  ...weaponGroup('quake'),
  // Passive (loadout.js PASSIVES): no slot and no NEW WEAPON pick. A general upgrade offered in normal
  // hands with the usual level jumps; owning it unlocks the KINETIC tag card.
  {
    id: 'shrapnel',
    name: 'Volatile Shatter',
    category: 'PASSIVE',
    tags: ['projectile', 'kinetic'],
    maxLevel: 8,
    overcharge: false, // a passive's level is its own, like a weapon's
    headline: 'shrapnelShards',
    summary: 'Passive, no slot: kills burst into ricochet shards that trigger chain-reaction kills.',
    apply(player) {
      player.weapons.shrapnel = (player.weapons.shrapnel || 0) + 1;
    }
  },
  // Geom Attractor Field, per level (compounding): LV 5 is half the old pickup radius (6.1x base, was 12.2x)
  // and exactly 2x XP (was 3.05x). Armory Vacuum Array / Geom Resonator stack on top.
  {
    id: 'magnet',
    name: 'Geom Attractor Field',
    category: 'UTILITY',
    maxLevel: 5,
    headline: 'magnetRadius',
    summary: 'Wider Geom vacuum, more XP per Geom, and a spare Supernova Bomb.',
    apply(player) {
      player.stats.magnetRadius *= MAGNET_RADIUS_STEP;
      player.stats.xpMultiplier *= MAGNET_XP_STEP;
      player.bombs = Math.min(9, player.bombs + 1);
    }
  },
  {
    id: 'thrusters',
    name: 'Phase Nova Thrusters',
    category: 'UTILITY',
    tags: ['area'],
    maxLevel: 5,
    headline: 'moveSpeed',
    summary: 'Faster hull, and Phase Dash unleashes a damaging shockwave.',
    apply(player) {
      player.stats.moveSpeed *= 1.16;
      player.weapons.dashNova = (player.weapons.dashNova || 0) + 1;
    }
  },
  {
    // Dash Extender: a longer Phase Dash (or Blink Drive teleport). Game.triggerDash reads the card level.
    id: 'dash_range',
    name: 'Phase Dash Extender',
    category: 'UTILITY',
    maxLevel: 5,
    overcharge: false, // stops at its max: past that a dash would cross half the screen
    headline: 'dashDistance',
    summary: 'Phase Dash carries you further (and Blink Drive teleports further), and you stay untouchable for the whole dash.',
    apply() {} // the dash reads the card's level (upgradeLevels.dash_range): nothing else to change
  },
  {
    // Blink Drive: Phase Dash turns into a teleport (Game.triggerDash -> Game.blink). More ranks blink further.
    id: 'blink_drive',
    name: 'Blink Drive',
    category: 'UTILITY',
    maxLevel: 3,
    overcharge: false, // a blink stops getting longer at its max
    headline: 'blinkDistance',
    summary: 'Phase Dash becomes a BLINK: you teleport straight to the end of the dash, through enemies, gaps and bullets. More ranks blink further.',
    apply() {} // the dash reads the card's level (upgradeLevels.blink_drive): nothing else to change
  },
  {
    // The shield on its own card (it rode on Phase Nova Thrusters before v0.33).
    id: 'shield_capacitor',
    name: 'Shield Capacitor',
    category: 'UTILITY',
    maxLevel: 5,
    headline: 'maxHp',
    summary: 'A bigger shield, and it repairs some of the damage you have taken.',
    shieldCard: true, // raises and repairs the shield: never offered in HARDCORE (js/modes.js)
    apply(player) {
      player.maxHp += 20;
      player.hp = Math.min(player.maxHp, player.hp + 35);
    }
  },
  // Deployables: placed or escorting units that fight on their own. Their numbers live in
  // weapon-scaling.js and they share the DEPLOYABLE category and 'deployable' tag.
  ...weaponGroup('mines'),
  ...weaponGroup('turret'),
  ...weaponGroup('drones'),
  // Critical hits (every weapon can crit; burn ticks cannot)
  {
    id: 'crit_chance',
    name: 'Deadeye Targeting Lattice',
    category: 'CRITICAL',
    tags: ['crit'],
    maxLevel: 6,
    overchargeReq: (player) => (player.stats.critChance ?? 0) < 1, // nothing past 100%
    headline: 'critChance',
    summary: 'Every weapon finds weak points more often. Crits hit harder and flash gold.',
    apply(player) {
      player.stats.critChance = (player.stats.critChance ?? 0) + W.critChanceStep;
    }
  },
  {
    id: 'crit_damage',
    name: 'Overkill Resonator',
    category: 'CRITICAL',
    tags: ['crit'],
    maxLevel: 6,
    headline: 'critDamage',
    summary: 'Critical hits from every weapon land with a heavier multiplier.',
    apply(player) {
      player.stats.critDamage = (player.stats.critDamage ?? (TUNING.baseCritDamage ?? 1.5)) + W.critDamageStep;
    }
  },
  // Tag specialists: boost every weapon in one family (offered once you own a weapon or passive that carries it)
  {
    id: 'tag_kinetic',
    name: 'Tungsten Penetrators',
    category: 'SPECIALIST',
    tags: ['kinetic'],
    maxLevel: 5,
    headline: 'kineticDamage',
    req(player) {
      return hasTag(player, 'kinetic');
    },
    summary: 'KINETIC weapons hit harder: blaster bolts, helix bolts, shrapnel and orbit blades.',
    apply(player) {
      addTagDamage(player, 'kinetic');
    }
  },
  {
    id: 'tag_explosive',
    name: 'Shaped Charges',
    category: 'SPECIALIST',
    tags: ['explosive'],
    maxLevel: 5,
    headline: 'explosiveDamage',
    req(player) {
      return hasTag(player, 'explosive') || player.weapons.tectonicBore >= 1;
    },
    summary: 'EXPLOSIVE weapons hit harder: rockets, missile, grenade and mine blasts, and tectonic drill detonations.',
    apply(player) {
      addTagDamage(player, 'explosive');
    }
  },
  {
    id: 'tag_electric',
    name: 'Overvolt Coils',
    category: 'SPECIALIST',
    tags: ['electric'],
    maxLevel: 5,
    headline: 'electricDamage',
    req(player) {
      return hasTag(player, 'electric');
    },
    summary: 'ELECTRIC weapons hit harder: Tesla arcs, Storm Protocol chains and Shock Field discharges.',
    apply(player) {
      addTagDamage(player, 'electric');
    }
  },
  {
    id: 'tag_area',
    name: 'Field Amplifier',
    category: 'SPECIALIST',
    tags: ['area'],
    maxLevel: 5,
    headline: 'areaSize',
    req(player) {
      const w = player.weapons;
      return hasTag(player, 'area') || w.dashNova >= 1 || w.tectonicBore >= 1;
    },
    summary: 'AREA weapons reach further: rocket, missile, grenade and mine blasts, singularity pull and collapse, dash nova and drill blasts.',
    apply(player) {
      player.stats.areaMult = (player.stats.areaMult ?? 1) + W.areaStep;
    }
  },
  // Status cards (elements are per weapon: their cards come with each weapon group above)
  ...STATUS_CARDS,
  // Golden Synergies / Evolutions
  {
    id: 'evo_tectonic',
    name: 'SYNERGY: Tectonic Claw Bore',
    category: 'DRILL CLAWS',
    tags: ['explosive', 'area'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.mining_speed >= 2);
    },
    headline: 'tectonicBlast',
    summary: 'EVOLUTION: Upgrades your drill-claws (not a new weapon): supercharged drill-claws, and every drilled asteroid detonates into nearby enemies.',
    apply(player) {
      player.weapons.tectonicBore = 1;
      player.stats.miningSpeed *= TECTONIC_MINING_SPEED;
      player.stats.miningRange *= TECTONIC_MINING_RANGE;
      player.stats.drillScale = (player.stats.drillScale || 1.0) * TECTONIC_DRILL_SCALE;
    }
  },
  {
    id: 'evo_pulsar',
    name: 'SYNERGY: Pulsar Helix',
    category: 'AUTOCANNON',
    ownersAll: ['blaster'],
    tags: ['projectile', 'kinetic'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.multishot >= 2 || player.upgradeLevels.firerate >= 2);
    },
    headline: 'helixBolts',
    summary: 'EVOLUTION: Upgrades your Autocannon (not a new weapon): every Autocannon shot also flings big magenta bolts out of your ship in a spinning spiral, hitting enemies on every side.',
    apply(player) {
      player.weapons.pulsarHelix = 1;
      player.stats.fireRate *= 1.15;
    }
  },
  {
    id: 'evo_tempest',
    name: 'SYNERGY: Storm Protocol',
    category: 'MISSILES + TESLA ARC',
    ownersAll: ['missiles', 'lightning'],
    tags: ['explosive', 'electric'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.missiles >= 1 && player.weapons.lightning >= 1);
    },
    headline: 'stormChain',
    summary: 'EVOLUTION: Upgrades your Swarm Missiles and Tesla Arc: homing missiles carry Tesla charge and chain lightning on every detonation.',
    apply(player) {
      player.weapons.stormProtocol = 1;
      player.weapons.missiles += 1;
    }
  },
  {
    id: 'evo_siege',
    name: 'SYNERGY: Siege Battery',
    category: 'MINES + TURRET',
    ownersAll: ['mines', 'turret'],
    tags: ['deployable', 'explosive'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.mines >= 1 && player.weapons.turret >= 1);
    },
    headline: 'siegeShell',
    summary: 'EVOLUTION: Upgrades your Proximity Mines and Sentry Turret: sentry turrets load mine charges, so every bolt that hits bursts into nearby enemies.',
    apply(player) {
      player.weapons.siegeBattery = 1;
    }
  },
  {
    id: 'evo_emp',
    name: 'SYNERGY: EMP Grenades',
    category: 'GRENADES + TESLA ARC',
    ownersAll: ['grenades', 'lightning'],
    tags: ['explosive', 'electric'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.grenades >= 1 && player.weapons.lightning >= 1);
    },
    headline: 'empArcs',
    summary: 'EVOLUTION: Upgrades your Plasma Grenades and Tesla Arc: every Plasma Grenade blast sets off an EMP that arcs lightning into nearby enemies.',
    apply(player) {
      player.weapons.empGrenades = 1;
    }
  },
  {
    id: 'evo_supercrit',
    name: 'SYNERGY: Supercritical',
    category: 'CRITS',
    tags: ['crit'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      const lv = player.upgradeLevels;
      return lv.crit_chance >= 2 && ownedElements(player).size > 0;
    },
    headline: 'critAfflicted',
    summary: 'EVOLUTION: Upgrades your critical hits: more crits, and crits against burning, chilled, corroded or stunned targets get a far bigger bonus.',
    apply(player) {
      player.weapons.supercritical = 1;
      player.stats.critChance = (player.stats.critChance ?? 0) + W.supercritChance;
    }
  }
];

// Tag-damage multipliers start at 1 and grow additively per card level.
function addTagDamage(player, tag) {
  const boosts = player.stats.tagDamage || (player.stats.tagDamage = {});
  boosts[tag] = (boosts[tag] ?? 1) + W.tagDamageStep[tag];
}

// Tag cards are offered only when an equipped weapon or an owned passive carries the tag.
function hasTag(player, tag) {
  return ownedTags(player).has(tag);
}

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADE_POOL.map((u) => [u.id, u]));

// What kind of card an upgrade is in a level-up hand: 'weapon' (a stat card: raises an equipped
// weapon's level), 'element' (a weapon's element card: raises its level too, level-up hands only),
// 'core' (a weapon's equip line, installed by NEW WEAPON, never in a hand), 'line' (a weapon-specific
// upgrade that is not a level), 'status' (a global STATUS card), 'tag', 'evolution' or 'general'.
// Kinds set the hand weights.
export function upgradeKind(u) {
  if (WEAPON_BY_LEVEL_ID[u.id]) return 'core';
  if (STAT_CARD_BY_ID[u.id]) return 'weapon';
  if (ELEMENT_CARD_BY_ID[u.id]) return 'element';
  if (u.statusCard) return 'status';
  if (u.isSynergy) return 'evolution';
  if (u.category === 'SPECIALIST') return 'tag';
  if (u.owners) return 'line';
  return 'general';
}

// Installed upgrades other than weapon levels, for the pause menu's UPGRADES list. A weapon's equip line
// ('core', always rank 1) and its stat cards ('weapon') are left out: the loadout already shows them as the
// weapon's level, so listing the equip line again would show the weapon twice with a stale LV 1.
export function runUpgradeLines(player) {
  const out = [];
  for (const u of UPGRADE_POOL) {
    const level = player.upgradeLevels?.[u.id] || 0;
    const kind = upgradeKind(u);
    if (level > 0 && kind !== 'core' && kind !== 'weapon' && kind !== 'element') {
      out.push({ id: u.id, name: u.name, level, maxLevel: u.maxLevel, kind, category: u.category, summary: u.summary, isSynergy: !!u.isSynergy });
    }
  }
  return out;
}

// Weapons an upgrade belongs to (its weapon for equip lines and stat cards, or its owners), for
// loadout slots and discards.
export function upgradeWeapons(u) {
  const w = WEAPON_BY_LEVEL_ID[u.id];
  if (w) return [w.id];
  return u.owners || u.ownersAll || [];
}

// True when the player's equipped weapons allow this card (before level caps and other requirements).
export function loadoutAllows(player, u) {
  const w = WEAPON_BY_LEVEL_ID[u.id];
  if (w && !ownsWeapon(player, w.id)) return false;
  if (u.owners && !u.owners.some((id) => ownsWeapon(player, id))) return false;
  if (u.ownersAll && !u.ownersAll.every((id) => ownsWeapon(player, id))) return false;
  return true;
}

// Relative chance of a card appearing in a hand. Every weapon's stat cards share TUNING.weaponLevelWeight
// x 2 between them (a 4-card weapon offers each at 1.5), so the weapons you carry keep climbing (and roll
// their +3/+4/+5 jumps). A weapon's element cards share TUNING.elementCardWeight between the ones on
// offer (all four while it has no element, then its one rank-up card). Evolutions are semi-rare:
// TUNING.evolutionWeight (1) x luck. Every weight is a TUNING value.
export function cardWeight(u, luck = 1, player = null) {
  switch (upgradeKind(u)) {
    case 'weapon': return (TUNING.weaponLevelWeight ?? 3) * 2 / (STAT_CARDS[STAT_CARD_BY_ID[u.id].weapon].length || 1);
    case 'element': return (TUNING.elementCardWeight ?? 1.5) / (player && weaponElement(player, u.weapon) ? 1 : ELEMENTS.length);
    case 'status': return TUNING.statusCardWeight ?? 0.7;
    case 'core': return 0;
    case 'line': return TUNING.weaponLineWeight ?? 1.5;
    case 'tag': return TUNING.tagCardWeight ?? 0.7;
    case 'evolution': return (TUNING.evolutionWeight ?? 1) * luck;
    default: return 1;
  }
}

// Cumulative roll thresholds (roll < pentaChance → +5, < quadChance → +4, ...), all scaled by Luck.
export function levelJumpChances(luck) {
  const pentaChance = Math.min(0.1, (TUNING.pentaLevelChance ?? 0.0025) * luck);
  const quadChance = Math.min(0.25, pentaChance + (TUNING.quadLevelChance ?? 0.01) * luck);
  const tripleChance = Math.min(0.45, quadChance + (TUNING.tripleLevelChance ?? 0.035) * luck);
  const doubleChance = Math.min(0.75, tripleChance + (TUNING.doubleLevelChance ?? 0.1) * luck);
  return { pentaChance, quadChance, tripleChance, doubleChance };
}

// OVERCHARGE: once every equipped weapon is LV 18, cards that don't raise a weapon's level (general, tag
// and STATUS cards) keep coming past their own max and keep stacking. Evolutions (one-time unlocks)
// and passives (their level is their own) don't; overchargeReq can stop a card early (crit chance at 100%).
export function overchargeReady(player) {
  const owned = ownedWeapons(player);
  return owned.length > 0 && owned.every((id) => weaponLevel(player, id) >= WEAPON_MAX_LEVEL);
}

export function canOvercharge(u) {
  const kind = upgradeKind(u);
  return u.overcharge !== false && (kind === 'general' || kind === 'tag' || kind === 'status' || kind === 'line');
}

// Levels a card can still add: its own cap, and for a level card (stat or element) also the room left
// under the weapon's LV 18 cap (so a +5 roll on a LV 16 weapon installs +2). An OVERCHARGE card has no cap.
export function levelRoom(player, u) {
  const own = u.maxLevel - (player.upgradeLevels[u.id] || 0);
  const weapon = levelCardWeapon(u.id);
  if (!weapon && own <= 0 && canOvercharge(u) && overchargeReady(player) && (!u.overchargeReq || u.overchargeReq(player))) return Infinity;
  if (!weapon) return Math.max(0, own);
  const lv = Math.max(1, weaponLevel(player, weapon));
  return Math.max(0, Math.min(own, WEAPON_MAX_LEVEL - lv));
}

// The single place upgrade levels are installed. Level-up picks, supply caches and card previews
// (on a copy of the player) all go through it, so they share one player.upgradeLevels state.
// Installing a stat card (or equip line) of an unequipped weapon equips it at LV 1 first (stat cards
// are only offered once equipped, so this matters only for direct installs such as the balance bench).
export function applyUpgradeLevels(player, upg) {
  const owner = WEAPON_BY_LEVEL_ID[upg.id] || WEAPON_BY_ID[levelCardWeapon(upg.id)];
  if (owner && Array.isArray(player.loadout) && !player.loadout.includes(owner.id)) {
    player.loadout.push(owner.id);
    const core = UPGRADE_BY_ID[owner.levelId];
    if (!(player.upgradeLevels[core.id] > 0)) {
      player.upgradeLevels[core.id] = 1;
      core.apply(player);
      if (core.id === upg.id) return 1;
    }
  }
  const current = player.upgradeLevels[upg.id] || 0;
  const jump = Math.max(0, Math.min(upg.levelJump || 1, levelRoom(player, upg)));
  for (let k = 0; k < jump; k++) {
    player.upgradeLevels[upg.id] = current + k + 1;
    upg.apply(player);
  }
  return jump;
}

// Cards the player can be offered right now (level-up hands and caches): with room under their level caps
// (a weapon's LV 18 included), allowed by the loadout, the run's mode and their own requirements.
// `cache: true` (supply caches) leaves out the per-weapon element cards: the element is the player's pick.
export function eligibleUpgrades(player, { cache = false } = {}) {
  const shieldCards = modeRules(player).shieldCards;
  return UPGRADE_POOL.filter((u) => {
    if (player.banished?.[u.id]) return false; // banished with gold: gone for the rest of the run
    if (u.shieldCard && !shieldCards) return false; // HARDCORE: nothing raises or restores the shield
    if (cache && u.elementCard) return false; // element choices come from level-up hands only
    if (!loadoutAllows(player, u)) return false;
    if (levelRoom(player, u) <= 0) return false;
    if (u.req && !u.req(player)) return false;
    return cardWeight(u, 1, player) > 0;
  });
}

// Exact chance that each eligible card is drawn into `slots` random hand slots by rollUpgrades (weighted
// sampling without replacement, the same weights and luck). Returns Map(card id -> probability).
// excludeId: a card already in the hand (a lock) and kept out of the draw. Up to 4 slots, O(n^slots).
export function cardInclusionOdds(player, slots = 3, excludeId = null) {
  const luck = player.stats.luck || 1.0;
  const pool = eligibleUpgrades(player).filter((u) => u.id !== excludeId).map((u) => ({ id: u.id, w: cardWeight(u, luck, player) }));
  const odds = new Map(pool.map((c) => [c.id, 0]));
  const k = Math.min(Math.max(0, Math.floor(slots)), 4, pool.length);
  const total = pool.reduce((a, c) => a + c.w, 0);
  if (!k || total <= 0) return odds;
  // Walk every ordered prefix of draws; each card drawn at depth d adds the prefix probability times
  // its chance of being next.
  const walk = (depth, prob, remaining, taken) => {
    for (const c of pool) {
      if (taken.has(c.id)) continue;
      const p = prob * (c.w / remaining);
      odds.set(c.id, odds.get(c.id) + p);
      if (depth + 1 < k) {
        taken.add(c.id);
        walk(depth + 1, p, remaining - c.w, taken);
        taken.delete(c.id);
      }
    }
  };
  walk(0, 1, total, new Set());
  return odds;
}

// A random hand of `count` eligible cards with their rolled level jumps. Supply caches pass
// { cache: true }, which never draws a weapon's element cards.
export function rollUpgrades(player, count = 3, { cache = false } = {}) {
  const luck = player.stats.luck || 1.0;

  // Weighted sample without replacement: one draw per candidate, key = r^(1/weight), highest keys win.
  const shuffled = eligibleUpgrades(player, { cache })
    .map((upgrade) => ({ upgrade, score: Math.pow(Math.random(), 1 / cardWeight(upgrade, luck, player)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ upgrade }) => upgrade);

  // Roll Multi-Level Jump (+1 ... +5 levels at once): the jump is the card's rarity.
  return shuffled.slice(0, count).map((u) => {
    const remaining = levelRoom(player, u);
    let levelJump = 1;

    if (!u.isSynergy && remaining > 1) {
      const roll = Math.random();
      const c = levelJumpChances(luck);
      // Largest jump whose threshold the roll beats and that still fits under the level cap.
      const tiers = [[5, c.pentaChance], [4, c.quadChance], [3, c.tripleChance], [2, c.doubleChance]];
      for (const [jump, threshold] of tiers) {
        if (roll < threshold && remaining >= jump) {
          levelJump = jump;
          break;
        }
      }
    }

    return {
      ...u,
      levelJump
    };
  });
}

// --- Weapon loadout: NEW WEAPON cards, weapon picks, discards ----------------------------------

export const NEW_WEAPON_ID = 'new_weapon';

// A NEW WEAPON card can appear while a slot is free and some weapon is not equipped.
export function canOfferNewWeapon(player) {
  return freeSlots(player) > 0 && unownedWeapons(player).length > 0;
}

export function newWeaponCard(player) {
  return {
    id: NEW_WEAPON_ID,
    name: 'NEW WEAPON',
    category: 'LOADOUT',
    isNewWeapon: true,
    levelJump: 1,
    maxLevel: 1,
    slotsUsed: ownedWeapons(player).length,
    slots: weaponSlots()
  };
}

// NEW WEAPON chance per hand by weapons owned: TUNING newWeaponChanceBy1..By5 (80/70/60/40/30% by
// default; the By5 value also covers 6+ owned if the tuner adds slots). With no free slot it never shows.
const NEW_WEAPON_CHANCE_DEFAULTS = [0.8, 0.8, 0.7, 0.6, 0.4, 0.3];
export function newWeaponChanceFor(owned) {
  const n = Math.max(1, Math.min(5, Math.floor(owned)));
  return TUNING[`newWeaponChanceBy${n}`] ?? NEW_WEAPON_CHANCE_DEFAULTS[n];
}

// Hands in a row without a NEW WEAPON card before one is guaranteed: newWeaponPityOne while the ship
// carries a single weapon (the 2nd hand by default), newWeaponPity (4) once it carries two or more.
export function newWeaponPityFor(owned) {
  return Math.max(1, Math.round(owned <= 1 ? (TUNING.newWeaponPityOne ?? 2) : (TUNING.newWeaponPity ?? 4)));
}

// A level-up hand: rollUpgrades plus, while a slot is free, a NEW WEAPON card with the chance for the
// number of weapons owned, guaranteed once the pity count of hands in a row went without one. Caches
// never offer it (they install their pick automatically). Updates player.newWeaponDrought, the pity counter.
export function rollLevelUpHand(player, count = 3) {
  const canOffer = canOfferNewWeapon(player);
  let offer = false;
  if (canOffer) {
    const owned = ownedWeapons(player).length;
    offer = (player.newWeaponDrought || 0) + 1 >= newWeaponPityFor(owned) || Math.random() < newWeaponChanceFor(owned);
  }
  const hand = rollUpgrades(player, offer ? count - 1 : count);
  if (canOffer && hand.length === 0) offer = true; // nothing else left to offer
  if (offer) hand.splice(Math.floor(Math.random() * (hand.length + 1)), 0, newWeaponCard(player));
  player.newWeaponDrought = canOffer && !offer ? (player.newWeaponDrought || 0) + 1 : 0;
  return hand;
}

// Up to `count` different unequipped weapons to choose from after picking NEW WEAPON. A reroll passes the
// weapons just shown as `avoid`: they only come back when too few others are left to fill the pick.
export function rollWeaponPicks(player, count = 3, avoid = []) {
  return unownedWeapons(player)
    .map((id) => ({ id, score: Math.random() - (avoid.includes(id) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ id }) => ({
      id: `weapon:${id}`,
      weaponId: id,
      name: WEAPON_BY_ID[id].name,
      isWeaponPick: true,
      levelJump: 1,
      maxLevel: 1
    }));
}

// Equip a weapon in a free slot. Leveled weapons start at LV 1 through applyUpgradeLevels. The first
// weapon to fill slot BREAKTHROUGH_SLOT in a run gets its LV 6 Breakthrough right away (slot-rewards.js):
// pendingBreakthroughs offers it at LV 1, and it counts as that weapon's LV 6 Breakthrough.
export function acquireWeapon(player, id) {
  const weapon = WEAPON_BY_ID[id];
  if (!weapon || ownsWeapon(player, id) || freeSlots(player) <= 0) return false;
  player.loadout = [...ownedWeapons(player), id];
  if (weapon.levelId && !(player.upgradeLevels[weapon.levelId] > 0)) {
    applyUpgradeLevels(player, { ...UPGRADE_BY_ID[weapon.levelId], levelJump: 1 });
  }
  if (player.loadout.length === BREAKTHROUGH_SLOT && !player.slotBreakthroughGiven) {
    player.slotBreakthroughGiven = true;
    player.slotBreakthroughWeapon = id;
  }
  return true;
}

// Seconds of invulnerability after a shield hit.
export const HIT_INVULN_BASE = 0.4; // 0.65 before v0.32: ramming through whole packs cost only a hit or two a second

// The ship at run start, before any card: TUNING's base values with the Void Armory bonuses
// (progression.js armoryBonuses; {} gives the bare base). resetRun builds the player from it, and the pause
// menu builds it with no bonuses to split each stat into BASE / PERMANENT / THIS RUN (js/run-overview.js).
// Shield a run starts with, before Void Armory bonuses (100 before v0.29, 90 before v0.31, 85 before v0.32: harder passes).
export const BASE_SHIELD = 75;

export function runStartPlayer(bonuses = {}, t = TUNING) {
  const maxHp = BASE_SHIELD + (bonuses.bonusHp || 0);
  return {
    hp: maxHp,
    maxHp,
    bombs: 2 + (bonuses.extraBombs || 0),
    // Void Armory multipliers that live outside `stats` (dash cooldown and distance, gold per vein,
    // reroll cost).
    dashCooldownMult: bonuses.dashCooldownMult ?? 1,
    dashDistanceMult: bonuses.dashDistanceMult ?? 1,
    goldMult: bonuses.goldMult ?? 1,
    rerollCostMult: bonuses.rerollCostMult ?? 1,
    stats: {
      moveSpeed: t.moveSpeed * (bonuses.moveSpeedMult ?? 1),
      fireRate: t.fireRate,
      bulletSpeed: t.bulletSpeed,
      bulletCount: 2,
      pierce: 1,
      damage: t.baseDamage * (bonuses.damageMult ?? 1),
      magnetRadius: t.magnetRadius * (bonuses.magnetMult ?? 1),
      xpMultiplier: t.xpMultiplier * (bonuses.xpMult ?? 1),
      luck: t.baseLuck + (bonuses.luckBonus || 0),
      coreDropMult: t.coreDropMult * (bonuses.coreMult ?? 1),
      miningSpeed: t.miningSpeed * (bonuses.miningMult || 1),
      miningRange: t.miningRange * (bonuses.miningRangeMult || 1),
      drillScale: t.drillScale,
      critChance: (t.baseCritChance ?? 0.05) + (bonuses.critChanceBonus || 0),
      critDamage: (t.baseCritDamage ?? 1.5) + (bonuses.critDamageBonus || 0),
      tagDamage: { kinetic: 1, explosive: 1, electric: 1 },
      areaMult: bonuses.areaMult || 1
    }
  };
}

// Run-start stats and weapons (before any upgrade). Discards rebuild the player from this plus the
// remaining upgrade levels, so removing a weapon also removes exactly what its upgrades added.
export function snapshotBase(player) {
  player.base = {
    stats: structuredClone(player.stats),
    weapons: structuredClone(player.weapons),
    maxHp: player.maxHp
  };
}

// Stats, weapons and max shield from the base plus `levels`, replayed through each card's apply().
// Every apply is additive or multiplicative, so pool order gives the same result as pick order. Side
// effects on the current shield and bomb count land on a scratch copy and are dropped.
function replayLevels(player, levels) {
  const scratch = {
    ...player,
    stats: structuredClone(player.base.stats),
    weapons: structuredClone(player.base.weapons),
    maxHp: player.base.maxHp,
    hp: player.base.maxHp,
    bombs: 0,
    upgradeLevels: {}
  };
  for (const u of UPGRADE_POOL) {
    const lv = canOvercharge(u) ? levels[u.id] || 0 : Math.min(levels[u.id] || 0, u.maxLevel);
    for (let k = 0; k < lv; k++) {
      scratch.upgradeLevels[u.id] = k + 1;
      u.apply(scratch);
    }
  }
  return scratch;
}

function rebuildFromLevels(player) {
  if (!player.base) return;
  const scratch = replayLevels(player, player.upgradeLevels);
  player.stats = scratch.stats;
  player.weapons = scratch.weapons;
  player.maxHp = scratch.maxHp;
  player.hp = Math.min(player.hp, player.maxHp);
}

// Remove a weapon from the loadout with its level, its weapon-specific upgrades (once no other equipped
// weapon shares them) and any evolution that no longer qualifies. General and tag upgrades stay.
// Returns the removed lines ({ id, name, levels }), or null when the weapon was not equipped.
export function discardWeapon(player, id) {
  const weapon = WEAPON_BY_ID[id];
  if (!weapon || !ownsWeapon(player, id)) return null;
  player.loadout = ownedWeapons(player).filter((w) => w !== id);
  const removed = [];
  const drop = (u) => {
    const lv = player.upgradeLevels[u.id];
    if (!lv) return;
    removed.push({ id: u.id, name: u.name, levels: lv });
    delete player.upgradeLevels[u.id];
  };
  for (const u of UPGRADE_POOL) if (!loadoutAllows(player, u)) drop(u);
  rebuildFromLevels(player);
  // Evolutions re-check their requirement without their own effect (Storm Protocol adds a missile level).
  for (let changed = true; changed;) {
    changed = false;
    for (const u of UPGRADE_POOL) {
      if (!u.isSynergy || !player.upgradeLevels[u.id] || !u.req) continue;
      const without = { ...player.upgradeLevels };
      delete without[u.id];
      if (!u.req(player.base ? replayLevels(player, without) : player)) {
        drop(u);
        rebuildFromLevels(player);
        changed = true;
      }
    }
  }
  if (!player.base && weapon.levelKey) player.weapons[weapon.levelKey] = 0;
  // Its Breakthroughs go with it: re-equipping the weapon starts fresh at LV 1 (no refunds). The slot 6
  // Breakthrough is once per run, so it goes too.
  if (player.breakthroughs) delete player.breakthroughs[id];
  if (player.breakthroughsOffered) delete player.breakthroughsOffered[id];
  if (player.slotBreakthroughWeapon === id) player.slotBreakthroughWeapon = null;
  return removed;
}

// --- Breakthroughs (weapon LV 6 / 12 / 18) --------------------------------------------------------

// Milestones a weapon has reached but not yet chosen a Breakthrough for, lowest first.
// A milestone already offered this run is never offered again (until the weapon is discarded), even if
// its choice somehow failed to record: a weapon gets each Breakthrough exactly once. The weapon that
// filled slot 6 has reached its first milestone from LV 1 (acquireWeapon).
export function pendingBreakthroughs(player, id) {
  const lv = weaponLevel(player, id);
  const taken = player.breakthroughs?.[id] || {};
  const offered = player.breakthroughsOffered?.[id] || {};
  const early = player.slotBreakthroughWeapon === id && ownsWeapon(player, id) ? BREAKTHROUGH_LEVELS[0] : 0;
  return BREAKTHROUGH_LEVELS.filter((m) => (lv >= m || m === early) && !taken[m] && !offered[m]);
}

// Mark a milestone as offered (the Breakthrough screen opened for it).
export function markBreakthroughOffered(player, id, level) {
  const all = player.breakthroughsOffered || (player.breakthroughsOffered = {});
  (all[id] || (all[id] = {}))[level] = true;
}

// Record a Breakthrough choice ('transform' or 'boost') for a weapon at a milestone. Weapon formulas
// read it straight from player.breakthroughs, so nothing else needs rebuilding.
export function applyBreakthrough(player, id, level, kind) {
  if (!ownsWeapon(player, id) || !BREAKTHROUGH_LEVELS.includes(level) || !['transform', 'boost'].includes(kind)) return false;
  const all = player.breakthroughs || (player.breakthroughs = {});
  const mine = all[id] || (all[id] = {});
  if (mine[level]) return false;
  mine[level] = kind;
  return true;
}

// Upgrade lines shown under an equipped weapon's loadout slot: its specific lines and evolutions.
export function weaponUpgradeLines(player, id) {
  return UPGRADE_POOL
    .filter((u) => !WEAPON_BY_LEVEL_ID[u.id] && upgradeWeapons(u).includes(id) && (player.upgradeLevels[u.id] || 0) > 0)
    .map((u) => ({ id: u.id, name: u.name, level: player.upgradeLevels[u.id], maxLevel: u.maxLevel, isSynergy: !!u.isSynergy, statCard: !!u.statCard }));
}

// --- Experience curve -------------------------------------------------------------------------
// XP to go from `level` to the next: a stepped linear curve (Vampire Survivors style) instead of the
// old exponential one (x1.32 + 6 per level), so level-ups keep coming all run. The step changes at
// levels 20 and 40 (TUNING). XP income climbs steeply over the first minutes as packs grow and spawns
// speed up, so the LV 20-39 step is the steep one: level-ups come every ~10-15 s early and ~30-60 s
// late (docs/BALANCE_REPORT.md, "Weapon loadout and leveling").
export function xpToNextLevel(level) {
  const l = Math.max(1, Math.floor(level));
  const base = TUNING.xpCurveBase ?? 25;
  const step = TUNING.xpCurveStep ?? 16;
  const bend = Math.max(0, l - (TUNING.xpCurveAccelFrom ?? 15));
  return Math.round(base + step * (l - 1) + (TUNING.xpCurveAccel ?? 3.6) * bend * bend);
}

// Total XP needed to reach `level` from level 1.
export function totalXpForLevel(level) {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}
