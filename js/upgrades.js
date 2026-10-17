// Roguelite Upgrades, Luck Multi-Level Rolls (+2 / +3 Levels), Mining Drill, and Golden Synergies
import { TUNING } from './config.js';

// Rarity is fixed per upgrade and drives card border/name color only. It is separate from the
// lucky +2/+3 level-jump roll, which gets its own ribbon on the card.
export const RARITY = {
  common: { label: 'COMMON', color: '#c9d4e4' },
  uncommon: { label: 'UNCOMMON', color: '#00ff88' },
  rare: { label: 'RARE', color: '#3d9bff' },
  epic: { label: 'EPIC', color: '#b565ff' },
  legendary: { label: 'LEGENDARY', color: '#ffcc00' }
};

// Each entry: rarity (RARITY key), headline (the STAT_ROWS id shown enlarged on its card, see
// upgrade-cards.js) and a number-free summary. Exact numbers always come from the card preview.
export const UPGRADE_POOL = [
  {
    id: 'mining_speed',
    name: 'Rotary Claw Overclock',
    category: 'DRILL CLAWS',
    rarity: 'uncommon',
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
    rarity: 'uncommon',
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
    rarity: 'epic',
    maxLevel: 7,
    headline: 'bulletCount',
    summary: 'Adds plasma vectors to every volley in a wider harmonic arc.',
    apply(player) {
      player.stats.bulletCount += 2;
      player.stats.spreadAngle += 0.11;
    }
  },
  {
    id: 'firerate',
    name: 'Hyper-Capacitor',
    category: 'WEAPON',
    rarity: 'common',
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
    rarity: 'uncommon',
    maxLevel: 6,
    headline: 'pierce',
    summary: 'Bolts slice through more targets and hit harder. Damage scales every weapon.',
    apply(player) {
      player.stats.pierce += 2;
      player.stats.damage *= 1.25;
    }
  },
  {
    id: 'missiles',
    name: 'Swarm Micro-Missiles',
    category: 'AUTONOMOUS',
    rarity: 'rare',
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
    rarity: 'rare',
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
    rarity: 'rare',
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
    rarity: 'epic',
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
    rarity: 'uncommon',
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
    rarity: 'common',
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
    rarity: 'common',
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
  // Golden Synergies / Evolutions
  {
    id: 'evo_tectonic',
    name: 'SYNERGY: Tectonic Claw Bore',
    category: 'EVOLUTION',
    rarity: 'legendary',
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
    rarity: 'legendary',
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
    rarity: 'legendary',
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
  }
];

// Cumulative roll thresholds: roll < tripleChance gives +3, roll < doubleChance gives +2.
export function levelJumpChances(luck) {
  const tripleChance = Math.min(0.45, (TUNING.tripleLevelChance ?? 0.035) * luck);
  const doubleChance = Math.min(0.75, tripleChance + (TUNING.doubleLevelChance ?? 0.1) * luck);
  return { tripleChance, doubleChance };
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
      const { tripleChance, doubleChance } = levelJumpChances(luck);

      if (roll < tripleChance && remaining >= 3) {
        levelJump = 3;
      } else if (roll < doubleChance && remaining >= 2) {
        levelJump = 2;
      }
    }

    return {
      ...u,
      levelJump
    };
  });
}
