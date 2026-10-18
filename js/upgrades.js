// Roguelite Upgrades, Luck Multi-Level Rolls (+2 / +3 Levels), Mining Drill, and Golden Synergies
import { TUNING } from './config.js';
import { WEAPON_SCALING as W } from './weapon-scaling.js';
import {
  WEAPON_BY_ID, WEAPON_BY_LEVEL_ID, ownsWeapon, ownedWeapons, ownedTags, freeSlots, unownedWeapons, weaponSlots
} from './loadout.js';

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
  weapon: { label: 'NEW WEAPON', color: '#00f3ff' }
};

const RARITY_BY_JUMP = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

export function rarityFor(upg, jump = 1) {
  if (upg.isSynergy) return 'evolution';
  return RARITY_BY_JUMP[Math.max(1, Math.min(5, jump))];
}

// Each entry: headline (the STAT_ROWS id shown enlarged on its card, see upgrade-cards.js),
// a number-free summary and optional tags (TAG_INFO keys in weapon-scaling.js, shown as chips:
// the weapon families it belongs to or boosts). Exact numbers always come from the card preview.
//
// Loadout gating (rollUpgrades): a weapon's level line (WEAPONS[].levelId in loadout.js) is offered only
// while that weapon is equipped. `owners` lists the weapons a weapon-specific line belongs to (offered
// while any of them is equipped, removed when the last one is discarded); evolutions also name
// `ownersAll`. Lines without owners are general upgrades (passives such as Volatile Shatter included).
// Tag cards need an equipped weapon or an owned passive with the tag.
export const UPGRADE_POOL = [
  {
    id: 'mining_speed',
    name: 'Rotary Claw Overclock',
    category: 'DRILL CLAWS',
    maxLevel: 6,
    headline: 'miningSpeed',
    summary: 'Spins the twin drill-claws faster, with longer reach and bigger claws.',
    apply(player) {
      player.stats.miningSpeed *= 1.5;
      player.stats.miningRange *= 1.2;
      player.stats.drillScale = (player.stats.drillScale || 1.0) * 1.15;
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
  {
    id: 'multishot',
    name: 'Prism Split',
    category: 'PEW PEWS',
    owners: ['blaster'],
    tags: ['projectile', 'kinetic'],
    maxLevel: 8,
    headline: 'bulletCount',
    summary: 'Adds a pair of blaster streams: rear, then sides, then diagonals. Your forward pair never moves.',
    apply(player) {
      player.stats.bulletCount += W.multishotBolts;
    }
  },
  {
    id: 'firerate',
    name: 'Hyper-Capacitor',
    category: 'PEW PEWS',
    owners: ['blaster'],
    tags: ['projectile', 'kinetic'],
    maxLevel: 7,
    headline: 'fireRate',
    summary: 'Your Pew Pews fire faster, with quicker bolts.',
    apply(player) {
      player.stats.fireRate *= 1.26;
      player.stats.bulletSpeed *= 1.15;
    }
  },
  {
    id: 'pierce',
    name: 'Phase Piercer',
    category: 'PEW PEWS',
    owners: ['blaster'],
    tags: ['projectile', 'kinetic'],
    maxLevel: 8,
    headline: 'pierce',
    summary: 'Bolts slice through more targets: the first takes full damage, each one behind a little less.',
    apply(player) {
      player.stats.pierce += 2;
    }
  },
  {
    id: 'overdrive',
    name: 'Reactor Overdrive',
    category: 'POWER',
    maxLevel: 5,
    headline: 'damage',
    summary: 'Overclocks the reactor: every weapon hits harder.',
    apply(player) {
      player.stats.damage *= 1.12;
    }
  },
  {
    id: 'rockets',
    name: 'Wing Rockets',
    category: 'PRIMARY',
    tags: ['projectile', 'explosive', 'area'],
    maxLevel: 8,
    headline: 'rocketCount',
    summary: 'Wing-tip rockets fire faster and hit harder, then launch more per volley with bigger blasts.',
    apply(player) {
      player.weapons.rockets = (player.weapons.rockets || 0) + 1;
    }
  },
  {
    id: 'missiles',
    name: 'Swarm Micro-Missiles',
    category: 'AUTONOMOUS',
    tags: ['projectile', 'explosive', 'area'],
    maxLevel: 8,
    headline: 'missileSalvo',
    summary: 'Curving, ribbon-trailing homing missiles that detonate on impact.',
    apply(player) {
      player.weapons.missiles = (player.weapons.missiles || 0) + 1;
    }
  },
  {
    id: 'orbitals',
    name: 'Aegis Orbiting Blades',
    category: 'AUTONOMOUS',
    tags: ['orbital', 'kinetic'],
    maxLevel: 8,
    headline: 'orbitalBlades',
    summary: 'Spinning saw-triangles orbit your ship and shred anything they touch.',
    apply(player) {
      player.weapons.orbitals = (player.weapons.orbitals || 0) + 1;
    }
  },
  {
    id: 'lightning',
    name: 'Tesla Arc Emitter',
    category: 'AUTONOMOUS',
    tags: ['electric'],
    maxLevel: 8,
    headline: 'lightningJumps',
    summary: 'High-voltage chain lightning arcs across packs of nearby swarmers.',
    apply(player) {
      player.weapons.lightning = (player.weapons.lightning || 0) + 1;
    }
  },
  {
    id: 'singularity',
    name: 'Vortex Singularity',
    category: 'AUTONOMOUS',
    tags: ['gravity', 'area'],
    maxLevel: 8,
    headline: 'singularityPull',
    summary: 'Launches gravitational singularities that warp the grid, suck swarms inward, and implode.',
    apply(player) {
      player.weapons.singularity = (player.weapons.singularity || 0) + 1;
    }
  },
  // Passive (loadout.js PASSIVES): no slot and no NEW WEAPON pick. A general upgrade offered in normal
  // hands with the usual level jumps; owning it unlocks the KINETIC tag card.
  {
    id: 'shrapnel',
    name: 'Volatile Shatter',
    category: 'PASSIVE',
    tags: ['projectile', 'kinetic'],
    maxLevel: 8,
    headline: 'shrapnelShards',
    summary: 'Passive, no slot: kills burst into ricochet shards that trigger chain-reaction kills.',
    apply(player) {
      player.weapons.shrapnel = (player.weapons.shrapnel || 0) + 1;
    }
  },
  {
    id: 'magnet',
    name: 'Geom Attractor Field',
    category: 'UTILITY',
    maxLevel: 5,
    headline: 'magnetRadius',
    summary: 'Wider Geom vacuum, more XP per Geom, and a spare Supernova Bomb.',
    apply(player) {
      player.stats.magnetRadius *= 1.65;
      player.stats.xpMultiplier *= 1.25;
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
    summary: 'Faster hull, tougher shield, and Phase Dash unleashes a damaging shockwave.',
    apply(player) {
      player.stats.moveSpeed *= 1.16;
      player.maxHp += 25;
      player.hp = Math.min(player.maxHp, player.hp + 45);
      player.weapons.dashNova = (player.weapons.dashNova || 0) + 1;
    }
  },
  // Deployables: placed or escorting units that fight on their own. Their numbers live in
  // weapon-scaling.js and they share the DEPLOYABLE category and 'deployable' tag.
  {
    id: 'mines',
    name: 'Proximity Mines',
    category: 'DEPLOYABLE',
    tags: ['deployable', 'explosive'],
    maxLevel: 8,
    headline: 'mineMaxActive',
    summary: 'Drops mines in your wake that arm, then burst when an enemy drifts close.',
    apply(player) {
      player.weapons.mines = (player.weapons.mines || 0) + 1;
    }
  },
  {
    id: 'turret',
    name: 'Sentry Turret',
    category: 'DEPLOYABLE',
    tags: ['deployable', 'projectile'],
    maxLevel: 8,
    headline: 'turretMaxActive',
    summary: 'Plants a temporary auto-turret that shoots the nearest enemy it can see past asteroid cover.',
    apply(player) {
      player.weapons.turret = (player.weapons.turret || 0) + 1;
    }
  },
  {
    id: 'drones',
    name: 'Escort Drones',
    category: 'DEPLOYABLE',
    tags: ['deployable', 'projectile'],
    maxLevel: 8,
    headline: 'droneCount',
    summary: 'Gunship drones fly in formation behind your hull and fire at nearby targets.',
    apply(player) {
      player.weapons.drones = (player.weapons.drones || 0) + 1;
    }
  },
  // Critical hits (every weapon can crit; burn ticks cannot)
  {
    id: 'crit_chance',
    name: 'Deadeye Targeting Lattice',
    category: 'CRITICAL',
    tags: ['crit'],
    maxLevel: 6,
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
    summary: 'EXPLOSIVE weapons hit harder: rockets, missile and mine blasts, and tectonic drill detonations.',
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
    summary: 'ELECTRIC weapons hit harder: Tesla arcs and Storm Protocol chains.',
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
    summary: 'AREA weapons reach further: rocket, missile and mine blasts, singularity pull and collapse, dash nova and drill blasts.',
    apply(player) {
      player.stats.areaMult = (player.stats.areaMult ?? 1) + W.areaStep;
    }
  },
  // Damage types: each card adds a status effect to one weapon
  {
    id: 'thermite',
    name: 'Thermite Rounds',
    category: 'DAMAGE TYPE',
    owners: ['blaster'],
    tags: ['burn', 'projectile'],
    maxLevel: 5,
    headline: 'burnMax',
    summary: 'Primary and helix bolts ignite targets. Each hit adds a burn stack and refreshes the fire.',
    apply(player) {
      player.weapons.thermite = (player.weapons.thermite || 0) + 1;
    }
  },
  {
    id: 'cryo',
    name: 'Cryo Payload',
    category: 'DAMAGE TYPE',
    tags: ['chill', 'explosive'],
    maxLevel: 5,
    headline: 'chillSlow',
    owners: ['rockets', 'missiles'],
    summary: 'Rocket and missile blasts chill everything they catch, slowing it. Bosses resist most of the slow.',
    apply(player) {
      player.weapons.cryo = (player.weapons.cryo || 0) + 1;
    }
  },
  {
    id: 'nanite',
    name: 'Nanite Swarm',
    category: 'DAMAGE TYPE',
    tags: ['corrode', 'electric'],
    maxLevel: 5,
    headline: 'corrodeMax',
    owners: ['lightning'],
    summary: 'Arcs seed corroding nanites: each stack makes the target take more damage from everything.',
    apply(player) {
      player.weapons.nanite = (player.weapons.nanite || 0) + 1;
    }
  },
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
      player.stats.miningSpeed *= 1.9;
      player.stats.miningRange *= 1.3;
      player.stats.drillScale = (player.stats.drillScale || 1.0) * 1.25;
    }
  },
  {
    id: 'evo_pulsar',
    name: 'SYNERGY: Pulsar Helix',
    category: 'PEW PEWS',
    ownersAll: ['blaster'],
    tags: ['projectile', 'kinetic'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.multishot >= 2 || player.upgradeLevels.firerate >= 2);
    },
    headline: 'helixBolts',
    summary: 'EVOLUTION: Upgrades your Pew Pews (not a new weapon): every Pew Pews shot also flings big magenta bolts out of your ship in a spinning spiral, hitting enemies on every side.',
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
    id: 'evo_supercrit',
    name: 'SYNERGY: Supercritical',
    category: 'CRITS',
    tags: ['crit'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      const lv = player.upgradeLevels;
      return lv.crit_chance >= 2 && (lv.thermite >= 1 || lv.cryo >= 1 || lv.nanite >= 1);
    },
    headline: 'critAfflicted',
    summary: 'EVOLUTION: Upgrades your critical hits: more crits, and crits against burning, chilled or corroded targets get a far bigger bonus.',
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

// What kind of card an upgrade is in a level-up hand: 'weapon' (an equipped weapon's own level),
// 'line' (a weapon-specific upgrade), 'tag', 'evolution' or 'general'. Kinds set the hand weights.
export function upgradeKind(u) {
  if (WEAPON_BY_LEVEL_ID[u.id]) return 'weapon';
  if (u.isSynergy) return 'evolution';
  if (u.category === 'SPECIALIST') return 'tag';
  if (u.owners) return 'line';
  return 'general';
}

// Weapons an upgrade belongs to (its level line's weapon, or its owners), for loadout slots and discards.
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

// Relative chance of a card appearing in a hand. Equipped weapons' level-ups are weighted up so the
// weapons you carry keep climbing (and roll their +3/+4/+5 jumps); every weight is a TUNING value.
export function cardWeight(u, luck = 1) {
  switch (upgradeKind(u)) {
    case 'weapon': return TUNING.weaponLevelWeight ?? 3;
    case 'line': return TUNING.weaponLineWeight ?? 1.5;
    case 'tag': return TUNING.tagCardWeight ?? 0.7;
    case 'evolution': return (TUNING.evolutionWeight ?? 4) * luck;
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

// The single place upgrade levels are installed. Level-up picks, supply caches and card previews
// (on a copy of the player) all go through it, so they share one player.upgradeLevels state.
// Installing a weapon's level line equips that weapon (it is only offered once equipped, so this
// matters only for direct installs such as the balance bench).
export function applyUpgradeLevels(player, upg) {
  const current = player.upgradeLevels[upg.id] || 0;
  const jump = Math.max(0, Math.min(upg.levelJump || 1, upg.maxLevel - current));
  const weapon = WEAPON_BY_LEVEL_ID[upg.id];
  if (jump > 0 && weapon && Array.isArray(player.loadout) && !player.loadout.includes(weapon.id)) player.loadout.push(weapon.id);
  for (let k = 0; k < jump; k++) {
    player.upgradeLevels[upg.id] = current + k + 1;
    upg.apply(player);
  }
  return jump;
}

// Cards the player can be offered right now: under their level cap, allowed by the loadout and by
// their own requirements.
export function eligibleUpgrades(player) {
  return UPGRADE_POOL.filter((u) => {
    if ((player.upgradeLevels[u.id] || 0) >= u.maxLevel) return false;
    if (!loadoutAllows(player, u)) return false;
    if (u.req && !u.req(player)) return false;
    return cardWeight(u) > 0;
  });
}

// Exact chance that each eligible card is drawn into `slots` random hand slots by rollUpgrades (weighted
// sampling without replacement, the same weights and luck). Returns Map(card id -> probability).
// excludeId: a card already in the hand (a lock) and kept out of the draw. Up to 3 slots, O(n^slots).
export function cardInclusionOdds(player, slots = 3, excludeId = null) {
  const luck = player.stats.luck || 1.0;
  const pool = eligibleUpgrades(player).filter((u) => u.id !== excludeId).map((u) => ({ id: u.id, w: cardWeight(u, luck) }));
  const odds = new Map(pool.map((c) => [c.id, 0]));
  const k = Math.min(Math.max(0, Math.floor(slots)), 3, pool.length);
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

export function rollUpgrades(player, count = 3) {
  const luck = player.stats.luck || 1.0;

  // Weighted sample without replacement: one draw per candidate, key = r^(1/weight), highest keys win.
  const shuffled = eligibleUpgrades(player)
    .map((upgrade) => ({ upgrade, score: Math.pow(Math.random(), 1 / cardWeight(upgrade, luck)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ upgrade }) => upgrade);

  // Roll Multi-Level Jump (+1 ... +5 levels at once): the jump is the card's rarity.
  return shuffled.slice(0, count).map((u) => {
    const curLv = player.upgradeLevels[u.id] || 0;
    const remaining = u.maxLevel - curLv;
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

// Up to `count` different unequipped weapons to choose from after picking NEW WEAPON.
export function rollWeaponPicks(player, count = 3) {
  return unownedWeapons(player)
    .map((id) => ({ id, score: Math.random() }))
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

// Equip a weapon in a free slot. Leveled weapons start at LV 1 through applyUpgradeLevels.
export function acquireWeapon(player, id) {
  const weapon = WEAPON_BY_ID[id];
  if (!weapon || ownsWeapon(player, id) || freeSlots(player) <= 0) return false;
  player.loadout = [...ownedWeapons(player), id];
  if (weapon.levelId && !(player.upgradeLevels[weapon.levelId] > 0)) {
    applyUpgradeLevels(player, { ...UPGRADE_BY_ID[weapon.levelId], levelJump: 1 });
  }
  return true;
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
    const lv = Math.min(levels[u.id] || 0, u.maxLevel);
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
  return removed;
}

// Upgrade lines shown under an equipped weapon's loadout slot: its specific lines and evolutions.
export function weaponUpgradeLines(player, id) {
  return UPGRADE_POOL
    .filter((u) => !WEAPON_BY_LEVEL_ID[u.id] && upgradeWeapons(u).includes(id) && (player.upgradeLevels[u.id] || 0) > 0)
    .map((u) => ({ id: u.id, name: u.name, level: player.upgradeLevels[u.id], maxLevel: u.maxLevel, isSynergy: !!u.isSynergy }));
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
  const early = TUNING.xpCurveStep ?? 16;
  const mid = TUNING.xpCurveStepMid ?? 100;
  const late = TUNING.xpCurveStepLate ?? 60;
  return Math.round(base + early * (Math.min(l, 20) - 1) + mid * Math.max(0, Math.min(l, 40) - 20) + late * Math.max(0, l - 40));
}

// Total XP needed to reach `level` from level 1.
export function totalXpForLevel(level) {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}
