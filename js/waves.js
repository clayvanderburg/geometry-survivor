// Wave packs: which pack spawns next (weighted, unlocked by js/wave-plan.js, biased by the wave's
// theme), how big it is, and the HP budget that keeps every wave's incoming hit points in line with the
// pre-campaign spawn table.
import { TUNING } from './config.js';
import { EnemyManager, waveScaleAt, packSize, LIGHT_ENEMY_TYPES } from './enemies.js';
import { unlockWaveOf, waveTheme, veteranTier } from './wave-plan.js';

// Pack ids, the enemy type whose unlock wave gates them, and their TUNING weight key (0 disables a pack).
export const WAVE_PACKS = [
  { id: 'swarm', lead: 'swarmer', weightKey: 'spawnWeightSwarm' },
  { id: 'skirmish', lead: 'pinwheel', weightKey: 'spawnWeightSkirmish' },
  { id: 'splitter', lead: 'splitter', weightKey: 'spawnWeightSplitter' },
  { id: 'mayfly', lead: 'mayfly', weightKey: 'spawnWeightMayfly' },
  { id: 'bruiser', lead: 'bruiser', weightKey: 'spawnWeightBruiser' },
  { id: 'serpent', lead: 'serpent', weightKey: 'spawnWeightSerpent' },
  { id: 'blinker', lead: 'blinker', weightKey: 'spawnWeightBlinker' },
  { id: 'kestrel', lead: 'kestrel', weightKey: 'spawnWeightKestrel' },
  { id: 'gunner', lead: 'gunner', weightKey: 'spawnWeightGunner' },
  { id: 'blackhole', lead: 'blackhole', weightKey: 'spawnWeightBlackhole' },
  { id: 'hulk', lead: 'hulk', weightKey: 'spawnWeightHulk' },
  { id: 'shielder', lead: 'shielder', weightKey: 'spawnWeightShielder' },
  { id: 'conduit', lead: 'conduit', weightKey: 'spawnWeightConduit' }
].map(p => ({ ...p, get unlockWave() { return unlockWaveOf(p.lead); } }));

// The spawn table before the campaign (v0.33): every pack but these from wave 1. The HP budget
// measures the new table against it.
const LEGACY_UNLOCK = { bruiser: 2, gunner: 3, shielder: 4, blinker: 5, conduit: 6 };
const LEGACY_PACKS = ['swarm', 'skirmish', 'splitter', 'blackhole', 'bruiser', 'gunner', 'shielder', 'blinker', 'conduit'];

// Weight of a pack on a wave: its TUNING weight × the wave theme's bias (0 before it unlocks).
export function packWeight(pack, wave) {
  if (wave < pack.unlockWave) return 0;
  const base = Math.max(0, TUNING[pack.weightKey] ?? 0);
  const theme = waveTheme(wave);
  if (theme.even) return base > 0 ? 1 : 0;
  return base * (theme.bias?.[pack.id] ?? 1);
}

export function pickWavePack(wave, rand = Math.random) {
  let total = 0;
  for (const pack of WAVE_PACKS) total += packWeight(pack, wave);
  if (total <= 0) return 'swarm';
  let r = rand() * total;
  for (const pack of WAVE_PACKS) {
    const w = packWeight(pack, wave);
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return pack.id;
  }
  return 'swarm';
}

// Waves since a pack's lead type unlocked (pack sizes of late-joining types grow from their debut).
const since = (type, wave, legacy) => Math.max(0, wave - (legacy ? (LEGACY_UNLOCK[type] ?? 1) : unlockWaveOf(type)));

// Members of a pack as [type, count] pairs; Game.spawnWavePack lays them out. `legacy` sizes packs
// by the pre-campaign unlock waves (for the HP budget).
export function packRoster(id, wave, legacy = false) {
  const s = (type) => since(type, wave, legacy);
  switch (id) {
    case 'swarm': return [['swarmer', packSize(Math.min(TUNING.swarmPackMax ?? 34, 12 + wave * (TUNING.swarmPackPerWave ?? 2)))]];
    case 'skirmish': {
      const n = packSize(Math.min(TUNING.skirmishPackMax ?? 99, 3 + Math.floor(wave * (TUNING.skirmishPackPerWave ?? 0.6))));
      return [['pinwheel', Math.ceil(n / 2)], ['weaver', Math.floor(n / 2)]];
    }
    case 'splitter': return [['splitter', packSize(Math.min(TUNING.splitterPackMax ?? 99, 2 + Math.floor(wave * (TUNING.splitterPackPerWave ?? 0.4))))]];
    case 'mayfly': return [['mayfly', packSize(Math.min(TUNING.mayflyPackMax ?? 30, 12 + Math.floor(s('mayfly') * (TUNING.mayflyPackPerWave ?? 0.8))))]];
    case 'blackhole': return [['blackhole', 1]];
    case 'bruiser': return [['bruiser', packSize(Math.min(3, 1 + Math.floor(s('bruiser') / 4)))]];
    case 'gunner': return [['gunner', packSize(Math.min(5, 2 + Math.floor(s('gunner') / 4)))]];
    case 'hulk': return [['hulk', Math.min(3, 1 + Math.floor(s('hulk') / 8))]];
    // Serpents count their head only: the body cannot be hurt, and dies with it.
    case 'serpent': return [['serpent', Math.min(3, 1 + Math.floor(s('serpent') / 6))]];
    case 'shielder': {
      // Shielders lead a pinwheel escort, so the pack advances behind the plates.
      const n = packSize(Math.min(3, 1 + Math.floor(s('shielder') / 5)));
      return [['shielder', n], ['pinwheel', n * 2]];
    }
    // One V: a leader and its wingmen (3 at first, 5 from nine waves after their debut).
    case 'kestrel': return [['kestrel', Math.min(5, 3 + 2 * Math.floor(s('kestrel') / 9))]];
    case 'blinker': return [['blinker', packSize(Math.min(7, 3 + Math.floor(s('blinker') / 3)))]];
    case 'conduit': return [['conduit', 1], ['pinwheel', 3], ['bruiser', wave >= 8 ? 1 : 0]];
    default: return [];
  }
}

let hpManager = null;
// Total hit points a pack brings on a wave (a splitter counts its fragments too).
export function packHp(id, wave, legacy = false) {
  hpManager ||= new EnemyManager({ maxEnemies: 1 });
  let hp = 0;
  for (const [type, n] of packRoster(id, wave, legacy)) {
    if (!(n > 0)) continue;
    const scale = waveScaleAt(wave, { light: LIGHT_ENEMY_TYPES.has(type) });
    hp += n * hpManager.getArchetype(type, scale).maxHp;
    if (type === 'splitter') {
      const frags = !legacy && veteranTier(wave) >= 3 ? 4 : 3;
      hp += n * frags * hpManager.getArchetype('mini_splitter', waveScaleAt(wave, { light: true })).maxHp;
    }
  }
  return hp;
}

// Mean HP of the next pack on a wave, under the campaign table or the legacy one.
export function meanPackHp(wave, legacy = false) {
  let total = 0;
  let hp = 0;
  for (const pack of WAVE_PACKS) {
    let w;
    if (legacy) {
      if (!LEGACY_PACKS.includes(pack.id) || wave < (LEGACY_UNLOCK[pack.lead] ?? 1)) continue;
      w = Math.max(0, TUNING[pack.weightKey] ?? 0);
    } else {
      w = packWeight(pack, wave);
    }
    if (w <= 0) continue;
    total += w;
    hp += w * packHp(pack.id, wave, legacy);
  }
  return total > 0 ? hp / total : 0;
}

// HP budget: the multiplier on the seconds between packs that keeps a wave's incoming HP per second
// level with the legacy table (beefier pack mixes come a little less often, lighter ones more often).
// Clamped to [hpBudgetMin, hpBudgetMax]; hpBudget 0 switches it off.
export function hpBudgetScale(wave) {
  if (!(TUNING.hpBudget ?? 1)) return 1;
  const legacy = meanPackHp(wave, true);
  const now = meanPackHp(wave, false);
  if (!(legacy > 0) || !(now > 0)) return 1;
  return Math.max(TUNING.hpBudgetMin ?? 0.5, Math.min(TUNING.hpBudgetMax ?? 2.5, now / legacy));
}
