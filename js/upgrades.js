// Roguelite Upgrades, Luck Multi-Level Rolls (+2 / +3 Levels), Mining Drill, and Golden Synergies
import { TUNING } from './config.js';
import { WEAPON_SCALING as W } from './weapon-scaling.js';

// Rarity is the size of the rolled level jump: +1 common, +2 uncommon, +3 rare, +4 epic,
// +5 legendary. Evolutions (synergies) are one-shot unlocks with their own tier.
export const RARITY = {
  common: { label: 'COMMON', color: '#c9d4e4' },
  uncommon: { label: 'UNCOMMON', color: '#00ff88' },
  rare: { label: 'RARE', color: '#3d9bff' },
  epic: { label: 'EPIC', color: '#b565ff' },
  legendary: { label: 'LEGENDARY', color: '#ffcc00' },
  evolution: { label: 'EVOLUTION', color: '#ff4fd8' }
};

const RARITY_BY_JUMP = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

export function rarityFor(upg, jump = 1) {
  if (upg.isSynergy) return 'evolution';
  return RARITY_BY_JUMP[Math.max(1, Math.min(5, jump))];
}

// Each entry: headline (the STAT_ROWS id shown enlarged on its card, see upgrade-cards.js),
// a number-free summary and optional tags (TAG_INFO keys in weapon-scaling.js, shown as chips:
// the weapon families it belongs to or boosts). Exact numbers always come from the card preview.
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
    category: 'WEAPON',
    tags: ['projectile', 'kinetic'],
    maxLevel: 7,
    headline: 'bulletCount',
    summary: 'Adds plasma vectors to every volley in a wider harmonic arc.',
    apply(player) {
      player.stats.bulletCount += W.multishotBolts;
      player.stats.spreadAngle += W.multishotSpread;
    }
  },
  {
    id: 'firerate',
    name: 'Hyper-Capacitor',
    category: 'WEAPON',
    tags: ['projectile', 'kinetic'],
    maxLevel: 7,
    headline: 'fireRate',
    summary: 'Faster primary volleys with quicker bolts.',
    apply(player) {
      player.stats.fireRate *= 1.26;
      player.stats.bulletSpeed *= 1.15;
    }
  },
  {
    id: 'pierce',
    name: 'Phase Piercer',
    category: 'WEAPON',
    tags: ['projectile', 'kinetic'],
    maxLevel: 6,
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
    id: 'missiles',
    name: 'Swarm Micro-Missiles',
    category: 'AUTONOMOUS',
    tags: ['projectile', 'explosive', 'area'],
    maxLevel: 6,
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
    maxLevel: 6,
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
    maxLevel: 6,
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
    maxLevel: 5,
    headline: 'singularityPull',
    summary: 'Launches gravitational singularities that warp the grid, suck swarms inward, and implode.',
    apply(player) {
      player.weapons.singularity = (player.weapons.singularity || 0) + 1;
    }
  },
  {
    id: 'shrapnel',
    name: 'Volatile Shatter',
    category: 'PASSIVE',
    tags: ['projectile', 'kinetic'],
    maxLevel: 5,
    headline: 'shrapnelShards',
    summary: 'Kills burst into ricochet shards that trigger chain-reaction kills.',
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
    maxLevel: 6,
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
    maxLevel: 6,
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
    maxLevel: 6,
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
  // Tag specialists: boost every weapon in one family (offered once you own a weapon that carries it)
  {
    id: 'tag_kinetic',
    name: 'Tungsten Penetrators',
    category: 'SPECIALIST',
    tags: ['kinetic'],
    maxLevel: 5,
    headline: 'kineticDamage',
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
      return player.weapons.missiles >= 1 || player.weapons.tectonicBore >= 1 || player.weapons.mines >= 1;
    },
    summary: 'EXPLOSIVE weapons hit harder: missile blasts and tectonic drill detonations.',
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
      return player.weapons.lightning >= 1;
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
      return w.missiles >= 1 || w.singularity >= 1 || w.dashNova >= 1 || w.tectonicBore >= 1 || w.mines >= 1;
    },
    summary: 'AREA weapons reach further: missile blasts, singularity pull and collapse, dash nova and drill blasts.',
    apply(player) {
      player.stats.areaMult = (player.stats.areaMult ?? 1) + W.areaStep;
    }
  },
  // Damage types: each card adds a status effect to one weapon
  {
    id: 'thermite',
    name: 'Thermite Rounds',
    category: 'DAMAGE TYPE',
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
    req(player) {
      return player.weapons.missiles >= 1;
    },
    summary: 'Missile blasts chill everything they catch, slowing it. Bosses resist most of the slow.',
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
    req(player) {
      return player.weapons.lightning >= 1;
    },
    summary: 'Arcs seed corroding nanites: each stack makes the target take more damage from everything.',
    apply(player) {
      player.weapons.nanite = (player.weapons.nanite || 0) + 1;
    }
  },
  // Golden Synergies / Evolutions
  {
    id: 'evo_tectonic',
    name: 'SYNERGY: Tectonic Claw Bore',
    category: 'EVOLUTION',
    tags: ['explosive', 'area'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.mining_speed >= 2);
    },
    headline: 'tectonicBlast',
    summary: 'EVOLUTION: supercharged drill-claws, and every drilled asteroid detonates into nearby enemies.',
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
    category: 'EVOLUTION',
    tags: ['projectile', 'kinetic'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.multishot >= 2 || player.upgradeLevels.firerate >= 2);
    },
    headline: 'helixBolts',
    summary: 'EVOLUTION: every volley also fires a rotating twin-arm spiral of plasma bolts.',
    apply(player) {
      player.weapons.pulsarHelix = 1;
      player.stats.fireRate *= 1.15;
    }
  },
  {
    id: 'evo_tempest',
    name: 'SYNERGY: Storm Protocol',
    category: 'EVOLUTION',
    tags: ['explosive', 'electric'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.missiles >= 1 && player.weapons.lightning >= 1);
    },
    headline: 'stormChain',
    summary: 'EVOLUTION: homing missiles carry Tesla charge and chain lightning on every detonation.',
    apply(player) {
      player.weapons.stormProtocol = 1;
      player.weapons.missiles += 1;
    }
  },
  {
    id: 'evo_siege',
    name: 'SYNERGY: Siege Battery',
    category: 'EVOLUTION',
    tags: ['deployable', 'explosive'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.mines >= 1 && player.weapons.turret >= 1);
    },
    headline: 'siegeShell',
    summary: 'EVOLUTION: sentry turrets load mine charges, so every bolt that hits bursts into nearby enemies.',
    apply(player) {
      player.weapons.siegeBattery = 1;
    }
  },
  {
    id: 'evo_supercrit',
    name: 'SYNERGY: Supercritical',
    category: 'EVOLUTION',
    tags: ['crit'],
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      const lv = player.upgradeLevels;
      return lv.crit_chance >= 2 && (lv.thermite >= 1 || lv.cryo >= 1 || lv.nanite >= 1);
    },
    headline: 'critAfflicted',
    summary: 'EVOLUTION: more crits, and crits against burning, chilled or corroded targets get a far bigger bonus.',
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

// Cumulative roll thresholds: roll < tripleChance gives +3, roll < doubleChance gives +2.
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
export function applyUpgradeLevels(player, upg) {
  const current = player.upgradeLevels[upg.id] || 0;
  const jump = Math.max(0, Math.min(upg.levelJump || 1, upg.maxLevel - current));
  for (let k = 0; k < jump; k++) {
    player.upgradeLevels[upg.id] = current + k + 1;
    upg.apply(player);
  }
  return jump;
}

export function rollUpgrades(player, count = 3) {
  const available = UPGRADE_POOL.filter((u) => {
    const currentLv = player.upgradeLevels[u.id] || 0;
    if (currentLv >= u.maxLevel) return false;
    if (u.req && !u.req(player)) return false;
    return true;
  });

  const luck = player.stats.luck || 1.0;

  // Sample once per candidate; sorting must use a consistent comparator.
  const shuffled = available
    .map((upgrade) => ({ upgrade, score: Math.random() + (upgrade.isSynergy ? 0.35 * luck : 0) }))
    .sort((a, b) => b.score - a.score)
    .map(({ upgrade }) => upgrade);

  // Roll Multi-Level Jump (+1, +2, or +3 levels at once!) — genuinely rare & exciting!
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
