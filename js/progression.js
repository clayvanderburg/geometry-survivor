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
    desc: '+18% LUCK (multi-level rolls & rare chests), +22% Pickup Radius and +10% XP per rank.'
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
    desc: '+22% Asteroid Mining Speed & +20% Void Core drops from enemies and run bounty per rank.'
  }
];

const DEFAULT_HIGHSCORES = [
  { id: 'seed-1', name: 'VEXOLITH // PRIME', score: 125000, multiplier: 14.5, wave: 10, kills: 420, timeStr: '03:40' },
  { id: 'seed-2', name: 'VOID // HUNTER', score: 48500, multiplier: 8.4, wave: 6, kills: 210, timeStr: '02:12' },
  { id: 'seed-3', name: 'NEON // DRIFTER', score: 18200, multiplier: 4.2, wave: 3, kills: 95, timeStr: '01:05' }
];

export function normalizePilotName(value) {
  return typeof value === 'string' ? value.trim().toUpperCase().slice(0, 18) || 'MADKING' : 'MADKING';
}

function boundedInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

// Field Guide unlocks: `seen` ids (hostiles met in any run) and `fresh` ids (unlocked, not yet read in
// the guide: they carry a NEW badge). Ids are guide entry ids (see js/field-guide.js); unknown but
// well-formed ids are kept so a save from a newer build survives a round trip.
const GUIDE_ID = /^[a-z0-9_]{1,40}$/;
const GUIDE_MAX_IDS = 200;

export function normalizeGuide(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const ids = (list) => Array.isArray(list)
    ? [...new Set(list.filter(id => typeof id === 'string' && GUIDE_ID.test(id)))].slice(0, GUIDE_MAX_IDS)
    : [];
  const seen = ids(source.seen);
  const fresh = ids(source.fresh).filter(id => seen.includes(id));
  return { seen, fresh };
}

export function normalizeSave(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceRanks = source.ranks && typeof source.ranks === 'object' ? source.ranks : {};
  const ranks = Object.fromEntries(META_UPGRADES.map(upgrade => [upgrade.id,
    boundedInteger(sourceRanks[upgrade.id], 0, 0, upgrade.maxRank)]));
  const savedScores = Array.isArray(source.highscores) ? source.highscores.filter(entry =>
    entry && typeof entry === 'object' && typeof entry.score === 'number' && Number.isFinite(entry.score)
  ).map((entry, index) => ({
    id: typeof entry.id === 'string' ? entry.id : 'legacy-' + index,
    name: normalizePilotName(entry.name),
    score: boundedInteger(entry.score, 0),
    multiplier: typeof entry.multiplier === 'number' && Number.isFinite(entry.multiplier) ? Math.max(1, entry.multiplier) : 1,
    wave: boundedInteger(entry.wave, 1, 1),
    kills: boundedInteger(entry.kills, 0),
    timeStr: typeof entry.timeStr === 'string' && /^\d{2,}:\d{2}$/.test(entry.timeStr) ? entry.timeStr : '00:00'
  })).sort((a, b) => b.score - a.score).slice(0, 8) : [];
  return {
    pilotName: normalizePilotName(source.pilotName),
    cores: boundedInteger(source.cores, 15),
    totalRuns: boundedInteger(source.totalRuns, 0),
    ranks,
    guide: normalizeGuide(source.guide),
    highscores: savedScores.length ? savedScores : DEFAULT_HIGHSCORES.map(entry => ({ ...entry }))
  };
}

export class ProgressionManager {
  constructor() {
    this.data = this.load();
    this.onExternalChange = null;
    // Another tab saved: adopt its data so our next save() doesn't overwrite its purchases/scores.
    globalThis.addEventListener?.('storage', (e) => {
      if (e.key !== SAVE_KEY) return;
      this.data = this.load();
      this.onExternalChange?.();
    });
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return normalizeSave(raw ? JSON.parse(raw) : {});
    } catch (e) {
      console.warn('Failed to load save data:', e);
      return normalizeSave({});
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Failed to save data:', e);
    }
  }

  setPilotName(name) {
    const clean = normalizePilotName(name);
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
    this.data.cores = Math.min(Number.MAX_SAFE_INTEGER, this.data.cores + boundedInteger(amount, 0, 0));
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

  isGuideUnlocked(id) {
    return this.data.guide.seen.includes(id);
  }

  // Unlocks guide entries (one save for the batch). Returns the ids that were actually new.
  unlockGuideEntries(ids) {
    const guide = this.data.guide;
    const added = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !GUIDE_ID.test(id) || guide.seen.includes(id) || guide.seen.length >= GUIDE_MAX_IDS) continue;
      guide.seen.push(id);
      guide.fresh.push(id);
      added.push(id);
    }
    if (added.length) this.save();
    return added;
  }

  // Entries the player has now looked at lose their NEW badge.
  markGuideViewed(ids) {
    const guide = this.data.guide;
    const before = guide.fresh.length;
    guide.fresh = guide.fresh.filter(id => !ids.includes(id));
    if (guide.fresh.length !== before) this.save();
  }

  recordRun({ name, score, multiplier, wave, kills, timeStr }) {
    this.data.totalRuns++;
    const cleanName = this.setPilotName(name || this.data.pilotName);
    const entryId = globalThis.crypto?.randomUUID?.() || 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2);
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
