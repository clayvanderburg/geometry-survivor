// Roguelite Upgrades, Luck Multi-Level Rolls (+2 / +3 Levels), Mining Drill, and Golden Synergies
import { TUNING } from './config.js';

export const UPGRADE_POOL = [
  {
    id: 'mining_speed',
    name: 'Rotary Claw Overclock',
    category: 'DRILL CLAWS',
    badgeColor: '#00ffaa',
    maxLevel: 6,
    desc: '+50% Twin Drill-Claw Mining Speed and +20% Rotary Claw Size & Reach.',
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
    badgeColor: '#ffcc00',
    maxLevel: 5,
    desc: '+25% LUCK! Boosts rare chances for +2/+3 Multi-Level Upgrades, Supply Cache drops, and Chest Jackpots.',
    apply(player) {
      player.stats.luck += 0.25;
    }
  },
  {
    id: 'multishot',
    name: 'Prism Split',
    category: 'WEAPON',
    badgeColor: '#00f3ff',
    maxLevel: 7,
    desc: 'Fires +2 additional plasma vectors per volley in a wider harmonic arc.',
    apply(player) {
      player.stats.bulletCount += 2;
      player.stats.spreadAngle += 0.11;
    }
  },
  {
    id: 'firerate',
    name: 'Hyper-Capacitor',
    category: 'WEAPON',
    badgeColor: '#00f3ff',
    maxLevel: 7,
    desc: 'Increases primary fire rate by +26% and projectile velocity by +15%.',
    apply(player) {
      player.stats.fireRate *= 1.26;
      player.stats.bulletSpeed *= 1.15;
    }
  },
  {
    id: 'pierce',
    name: 'Phase Piercer',
    category: 'WEAPON',
    badgeColor: '#00ff88',
    maxLevel: 6,
    desc: 'Bolts slice through +2 additional targets and deal +25% base damage.',
    apply(player) {
      player.stats.pierce += 2;
      player.stats.damage *= 1.25;
    }
  },
  {
    id: 'missiles',
    name: 'Swarm Micro-Missiles',
    category: 'AUTONOMOUS',
    badgeColor: '#ff007f',
    maxLevel: 6,
    desc: 'Periodically launches curving, ribbon-trailing homing missiles that detonate on impact.',
    apply(player) {
      player.weapons.missiles = (player.weapons.missiles || 0) + 1;
    }
  },
  {
    id: 'orbitals',
    name: 'Aegis Orbiting Blades',
    category: 'AUTONOMOUS',
    badgeColor: '#00ff88',
    maxLevel: 6,
    desc: 'Summons spinning geometric saw-triangles that orbit your ship and shred enemies.',
    apply(player) {
      player.weapons.orbitals = (player.weapons.orbitals || 0) + 1;
    }
  },
  {
    id: 'lightning',
    name: 'Tesla Arc Emitter',
    category: 'AUTONOMOUS',
    badgeColor: '#9d4edd',
    maxLevel: 6,
    desc: 'Discharges high-voltage chain lightning that arcs across packs of nearby swarmers.',
    apply(player) {
      player.weapons.lightning = (player.weapons.lightning || 0) + 1;
    }
  },
  {
    id: 'singularity',
    name: 'Vortex Singularity',
    category: 'AUTONOMOUS',
    badgeColor: '#ff2a55',
    maxLevel: 5,
    desc: 'Fires gravitational black holes that warp the grid, suck swarms inward, and implode.',
    apply(player) {
      player.weapons.singularity = (player.weapons.singularity || 0) + 1;
    }
  },
  {
    id: 'shrapnel',
    name: 'Volatile Shatter',
    category: 'PASSIVE',
    badgeColor: '#ffcc00',
    maxLevel: 5,
    desc: 'Exploding enemies burst into lethal ricochet shards that trigger chain-reaction kills.',
    apply(player) {
      player.weapons.shrapnel = (player.weapons.shrapnel || 0) + 1;
    }
  },
  {
    id: 'magnet',
    name: 'Geom Attractor Field',
    category: 'UTILITY',
    badgeColor: '#00ff88',
    maxLevel: 5,
    desc: '+65% Geom vacuum radius, +25% XP resonance, and +1 Supernova Bomb.',
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
    badgeColor: '#00f3ff',
    maxLevel: 5,
    desc: '+16% Move Speed, +35 Shield Repair, and Phase Dash unleashes a shattering shockwave.',
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
    badgeColor: '#ffcc00',
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.mining_speed >= 2);
    },
    desc: 'EVOLUTION: Supercharges your Twin Drill-Claws (+90% Mining Speed) and causes every drilled asteroid to detonate, blasting nearby enemies!',
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
    badgeColor: '#ffcc00',
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.upgradeLevels.multishot >= 2 || player.upgradeLevels.firerate >= 2);
    },
    desc: 'EVOLUTION: Your ship continuously emits a 360° counter-rotating spiral of plasma bolts!',
    apply(player) {
      player.weapons.pulsarHelix = 1;
      player.stats.fireRate *= 1.15;
    }
  },
  {
    id: 'evo_tempest',
    name: 'SYNERGY: Storm Protocol',
    category: 'EVOLUTION',
    badgeColor: '#ffcc00',
    isSynergy: true,
    maxLevel: 1,
    req(player) {
      return (player.weapons.missiles >= 1 && player.weapons.lightning >= 1);
    },
    desc: 'EVOLUTION: Homing Missiles supercharge with Tesla energy, triggering Chain Lightning on every detonation!',
    apply(player) {
      player.weapons.stormProtocol = 1;
      player.weapons.missiles += 1;
    }
  }
];

export function rollUpgrades(player, count = 3) {
  const available = UPGRADE_POOL.filter((u) => {
    const currentLv = player.upgradeLevels[u.id] || 0;
    if (currentLv >= u.maxLevel) return false;
    if (u.req && !u.req(player)) return false;
    return true;
  });

  const luck = player.stats.luck || 1.0;

  const shuffled = [...available].sort((a, b) => {
    const scoreA = (a.isSynergy ? 0.35 * luck : 0) + Math.random();
    const scoreB = (b.isSynergy ? 0.35 * luck : 0) + Math.random();
    return scoreB - scoreA;
  });

  // Roll Multi-Level Jump (+1, +2, or +3 levels at once!) — genuinely rare & exciting!
  return shuffled.slice(0, count).map((u) => {
    const curLv = player.upgradeLevels[u.id] || 0;
    const remaining = u.maxLevel - curLv;
    let levelJump = 1;

    if (!u.isSynergy && remaining > 1) {
      const roll = Math.random();
      const baseTriple = TUNING.tripleLevelChance ?? 0.0025;
      const baseDouble = TUNING.doubleLevelChance ?? 0.015;
      const tripleChance = Math.min(0.45, baseTriple * luck);
      const doubleChance = Math.min(0.75, tripleChance + baseDouble * luck);

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
