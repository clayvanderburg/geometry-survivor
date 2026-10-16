// Persistent Highscore Leaderboard & Rebalanced Meta-Progression (Void Cores Armory)
const SAVE_KEY = 'vectra_survivor_save_v2';

export const META_UPGRADES = [
  {
    id: 'maxHp',
    name: 'Aegis Shield Matrix',
    icon: '◈',
    color: '#00f3ff',
    maxRank: 8,
    baseCost: 8,
    costScale: 1.55,
    desc: '+25 Max Shield HP & thicker energy barrier per rank.'
  },
  {
    id: 'damage',
    name: 'Plasma Overcharge',
    icon: '✦',
    color: '#ff007f',
    maxRank: 8,
    baseCost: 10,
    costScale: 1.6,
    desc: '+12% Base Weapon Damage across all systems per rank.'
  },
  {
    id: 'haste',
    name: 'Chronos Capacitor',
    icon: '⚡',
    color: '#00ff88',
    maxRank: 6,
    baseCost: 12,
    costScale: 1.65,
    desc: '+9% Base Fire Rate & +7% Ship Thruster Speed per rank.'
  },
  {
    id: 'magnet',
    name: 'Fortune & Vacuum Array',
    icon: '🍀',
    color: '#9d4edd',
    maxRank: 6,
    baseCost: 8,
    costScale: 1.55,
    desc: '+18% LUCK (multi-level rolls & rare chests) and +22% Pickup Radius per rank.'
  },
  {
    id: 'bombs',
    name: 'Supernova Reserve',
    icon: '✸',
    color: '#ffcc00',
    maxRank: 4,
    baseCost: 18,
    costScale: 1.9,
    desc: '+1 Starting Supernova Smart Bomb every run per rank.'
  },
  {
    id: 'harvester',
    name: 'Deep-Core Mining Rig',
    icon: '❖',
    color: '#00f3ff',
    maxRank: 6,
    baseCost: 10,
    costScale: 1.6,
    desc: '+22% Asteroid Mining Speed & +20% Void Core harvest yield per rank.'
  }
];

const DEFAULT_HIGHSCORES = [
  { id: 'seed-1', name: 'VECTRA // PRIME', score: 125000, multiplier: 14.5, wave: 10, kills: 420, timeStr: '03:40' },
  { id: 'seed-2', name: 'VOID // HUNTER', score: 48500, multiplier: 8.4, wave: 6, kills: 210, timeStr: '02:12' },
  { id: 'seed-3', name: 'NEON // DRIFTER', score: 18200, multiplier: 4.2, wave: 3, kills: 95, timeStr: '01:05' }
];

export class ProgressionManager {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          pilotName: parsed.pilotName || 'MADKING',
          cores: Math.max(0, Math.round(parsed.cores ?? 15)),
          totalRuns: parsed.totalRuns ?? 0,
          ranks: parsed.ranks || {},
          highscores: Array.isArray(parsed.highscores) && parsed.highscores.length > 0
            ? parsed.highscores
            : [...DEFAULT_HIGHSCORES]
        };
      }
    } catch (e) {
      console.warn('Failed to load save data:', e);
    }
    return {
      pilotName: 'MADKING',
      cores: 15,
      totalRuns: 0,
      ranks: {},
      highscores: [...DEFAULT_HIGHSCORES]
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save data:', e);
    }
  }

  setPilotName(name) {
    const clean = (name || '').trim().toUpperCase().slice(0, 18) || 'MADKING';
    this.data.pilotName = clean;
    this.save();
    return clean;
  }

  getRank(id) {
    return this.data.ranks[id] || 0;
  }

  getUpgradeCost(upg) {
    const rank = this.getRank(upg.id);
    return Math.round(upg.baseCost * Math.pow(upg.costScale, rank));
  }

  canBuy(upg) {
    const rank = this.getRank(upg.id);
    if (rank >= upg.maxRank) return false;
    return this.data.cores >= this.getUpgradeCost(upg);
  }

  buyUpgrade(id) {
    const upg = META_UPGRADES.find((u) => u.id === id);
    if (!upg || !this.canBuy(upg)) return false;
    const cost = this.getUpgradeCost(upg);
    this.data.cores -= cost;
    this.data.ranks[id] = this.getRank(id) + 1;
    this.save();
    return true;
  }

  addCores(amount) {
    this.data.cores += Math.max(0, Math.round(amount));
    this.save();
  }

  getBonuses() {
    return {
      bonusHp: this.getRank('maxHp') * 25,
      damageMult: 1 + this.getRank('damage') * 0.12,
      fireRateMult: 1 + this.getRank('haste') * 0.09,
      moveSpeedMult: 1 + this.getRank('haste') * 0.07,
      magnetMult: 1 + this.getRank('magnet') * 0.22,
      xpMult: 1 + this.getRank('magnet') * 0.10,
      luckBonus: this.getRank('magnet') * 0.18,
      extraBombs: this.getRank('bombs'),
      coreMult: 1 + this.getRank('harvester') * 0.20,
      miningMult: 1 + this.getRank('harvester') * 0.22
    };
  }

  recordRun({ name, score, multiplier, wave, kills, timeStr }) {
    this.data.totalRuns++;
    const cleanName = this.setPilotName(name || this.data.pilotName);
    const entryId = 'run-' + Date.now();
    const entry = {
      id: entryId,
      name: cleanName,
      score,
      multiplier,
      wave,
      kills,
      timeStr
    };

    this.data.highscores.push(entry);
    this.data.highscores.sort((a, b) => b.score - a.score);
    this.data.highscores = this.data.highscores.slice(0, 8);
    this.save();

    const rankIndex = this.data.highscores.findIndex((h) => h.id === entryId);
    return {
      entryId,
      rank: rankIndex !== -1 ? rankIndex + 1 : null
    };
  }

  updateHighscoreName(entryId, newName) {
    const cleanName = this.setPilotName(newName);
    const entry = this.data.highscores.find((h) => h.id === entryId);
    if (entry) {
      entry.name = cleanName;
      this.save();
      return true;
    }
    return false;
  }
}
