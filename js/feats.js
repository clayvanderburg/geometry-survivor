// Feats (docs/HANGAR_DESIGN.md §5): the goals that unlock ships, weapons and badges in the Hangar. Pure and
// DOM-free: the game feeds a FeatLedger from a few existing events (kill, rock mined, dash, shield hit, gold
// spent, wave reached, run end) and commits it at each wave and at run end; the commit adds the run's
// career counts to the save, completes feats and hands back what they unlocked (for the toasts).
// Only used while the Hangar flag is on (js/hangar-flag.js); tainted runs and the Weapon Range never count.
//
// kind 'career':  a lifetime counter (hangar-save.js CAREER_COUNTERS) reaches `goal`.
// kind 'run':     `test(run)` over this run's facts (FeatLedger.run). `progress(career)` is the best so far
//                 toward `goal`, for the Hangar's progress bar.
// kind 'mastery': any weapon (or `weapon`) reaches mastery `tier` (js/mastery.js, a later PR).
// `hidden: true` shows "???" and the `hint` until it's done. Every reward appears in exactly one feat.
// Reward ids for ships and weapons that don't exist yet are inert: they unlock once the thing ships.
import { CAREER_COUNTERS, grantReward, today } from './hangar-save.js';

// Modes whose runs count for career counters, mastery and the run feats that don't name `modes`.
export const COUNTING_MODES = Object.freeze(['normal', 'hardcore']);

const bestOf = (c, modes = COUNTING_MODES) => Math.max(0, ...modes.map((m) => c.bestWave?.[m] || 0));

export const FEATS = Object.freeze([
  // --- Ships ---
  { id: 'kills_1500', kind: 'career', counter: 'kills', goal: 1500, unit: 'ENEMIES', name: 'EXTERMINATOR', text: 'Destroy 1,500 enemies', reward: { ship: 'mantis' } },
  { id: 'rocks_400', kind: 'career', counter: 'rocksMined', goal: 400, unit: 'ROCKS', name: 'DEEP CORE', text: 'Mine 400 rocks', reward: { ship: 'prospector' } },
  { id: 'blitz_w10', kind: 'run', modes: ['blitz'], goal: 10, unit: 'WAVE', progress: (c) => bestOf(c, ['blitz']), test: (r) => r.waveCleared >= 10, name: 'BLITZKRIEG', text: 'Clear wave 10 in BLITZ', reward: { ship: 'wasp' } },
  { id: 'shield_5000', kind: 'career', counter: 'shieldDamage', goal: 5000, unit: 'SHIELD', name: 'UNBREAKABLE', text: 'Take 5,000 shield damage', reward: { ship: 'hermit' } },
  { id: 'status_1000', kind: 'career', counter: 'afflicted', goal: 1000, unit: 'ENEMIES', name: 'ELEMENTALIST', text: 'Destroy 1,000 enemies while they burn, freeze or corrode', reward: { ship: 'pyre' } },
  { id: 'gold_3000', kind: 'career', counter: 'goldSpent', goal: 3000, unit: 'GOLD', name: 'HIGH ROLLER', text: 'Spend 3,000 gold on rerolls, locks and banishes', reward: { ship: 'gambler' } },
  { id: 'bosses_10', kind: 'career', counter: 'bossKills', goal: 10, unit: 'BOSSES', name: 'GIANT SLAYER', text: 'Defeat 10 bosses', reward: { ship: 'brood' } },
  { id: 'mastery_any', kind: 'mastery', tier: 1, name: 'PROVEN', text: 'Master any weapon (★)', reward: { ship: 'lancer' } },
  { id: 'hardcore_w25', kind: 'run', modes: ['hardcore'], goal: 25, unit: 'WAVE', progress: (c) => bestOf(c, ['hardcore']), test: (r) => r.waveCleared >= 25, name: 'IRON WILL', text: 'Clear wave 25 in HARDCORE', reward: { ship: 'revenant' } },
  { id: 'endless_75', kind: 'run', goal: 75, unit: 'WAVE', progress: (c) => c.bestEndlessWave || 0, test: (r) => r.campaignCleared && r.wave >= 75, name: 'BEYOND THE VOID', text: 'Reach wave 75 in Endless', reward: { ship: 'leviathan' } },
  { id: 'campaign', kind: 'run', goal: 50, unit: 'WAVE', progress: (c) => bestOf(c), test: (r) => r.campaignCleared, name: 'VEXOLITH ASCENDANT', text: 'Clear the campaign (beat the wave-50 boss)', reward: { ship: 'sovereign', weapon: 'prism' } },
  // --- Weapons (the first unlocks are easy) ---
  { id: 'wave_10', kind: 'run', goal: 10, unit: 'WAVE', progress: (c) => bestOf(c), test: (r) => r.waveCleared >= 10, name: 'FIRST LIGHT', text: 'Clear wave 10', reward: { weapon: 'flamethrower' } },
  { id: 'frozen_200', kind: 'career', counter: 'frozen', goal: 200, unit: 'ENEMIES', name: 'DEEP FREEZE', text: 'Destroy 200 enemies that were FROZEN', reward: { weapon: 'cryospray' } },
  { id: 'dashes_750', kind: 'career', counter: 'dashes', goal: 750, unit: 'DASHES', name: 'AFTERBURNER', text: 'Dash 750 times', reward: { weapon: 'gas' } },
  { id: 'bosses_5', kind: 'career', counter: 'bossKills', goal: 5, unit: 'BOSSES', name: 'EVENT HORIZON', text: 'Defeat 5 bosses', reward: { weapon: 'singularity' } },
  { id: 'mastery_flamethrower', kind: 'mastery', weapon: 'flamethrower', tier: 1, name: 'SPRAYER KIN', text: 'Master the Flamethrower (★)', reward: { weapon: 'acidspray' } },
  { id: 'mastery_lightning', kind: 'mastery', weapon: 'lightning', tier: 1, name: 'STORM KIN', text: 'Master the Tesla Arc (★)', reward: { weapon: 'shockfield' } },
  { id: 'rocks_run_150', kind: 'run', goal: 150, unit: 'ROCKS', progress: (c) => c.bestRocksRun || 0, test: (r) => r.rocks >= 150, name: 'STRIP MINER', text: 'Mine 150 rocks in one run', reward: { weapon: 'harpoon' } },
  // --- Hidden badges ---
  { id: 'untouchable', kind: 'run', hidden: true, hint: 'Some pilots are never touched.', test: (r) => r.waveCleared >= 10 && r.hits === 0, name: 'UNTOUCHABLE', text: 'Clear wave 10 without a single shield hit', reward: { badge: 'untouchable' } },
  { id: 'hoarder', kind: 'run', hidden: true, hint: 'A full vault is its own reward.', test: (r) => r.peakGold >= 500, name: 'DRAGON HOARD', text: 'Hold 500 gold at once', reward: { badge: 'hoarder' } },
  { id: 'last_stand', kind: 'run', hidden: true, hint: 'Win when it hangs by a thread.', test: (r) => r.clutchBoss, name: 'BY A THREAD', text: 'Defeat a boss with under 10% shield left', reward: { badge: 'last_stand' } }
]);

export const FEAT_BY_ID = Object.fromEntries(FEATS.map((f) => [f.id, f]));
for (const f of FEATS) if (f.kind === 'career' && !CAREER_COUNTERS.includes(f.counter)) throw new Error(`feat ${f.id}: unknown counter ${f.counter}`);

// Does a run in `mode` count for this feat?
export const featCountsIn = (feat, mode) => (feat.modes || COUNTING_MODES).includes(mode);

export function featComplete(feat, career, mastery = {}, run = null) {
  if (feat.kind === 'career') return (career[feat.counter] || 0) >= feat.goal;
  if (feat.kind === 'mastery') {
    const tiers = feat.weapon ? [mastery[feat.weapon] || 0] : Object.values(mastery);
    return tiers.some((t) => t >= feat.tier);
  }
  return !!run && featCountsIn(feat, run.mode) && !!feat.test(run);
}

// Progress toward a feat for the Hangar: { value, goal, done } (value capped at goal; hidden run feats
// without a goal read 0 / 1).
export function featProgress(feat, h) {
  const done = !!h.feats[feat.id];
  const goal = feat.kind === 'career' ? feat.goal : feat.goal || 1;
  let value = 0;
  if (feat.kind === 'career') value = h.career[feat.counter] || 0;
  else if (feat.kind === 'run' && feat.progress) value = feat.progress(h.career);
  else if (feat.kind === 'mastery') value = featComplete(feat, h.career, h.mastery) ? 1 : 0;
  return { value: done ? goal : Math.min(goal, value), goal: feat.kind === 'mastery' ? 1 : goal, done };
}

// The unfinished, visible feat closest to done (by share of its goal), for the results screen's nudge:
// { feat, value, goal } or null. Mastery feats and feats with nothing to show yet come last.
export function nextFeat(h) {
  let best = null, bestShare = -1;
  for (const feat of FEATS) {
    if (h.feats[feat.id] || feat.hidden || feat.kind === 'mastery') continue;
    const { value, goal } = featProgress(feat, h);
    const share = goal > 0 ? value / goal : 0;
    if (share > bestShare) { best = { feat, value, goal }; bestShare = share; }
  }
  return best;
}

// One run's facts and uncommitted career counts. Events arrive from main.js; commit() lands them.
export class FeatLedger {
  constructor({ mode = 'normal', ship = 'vexolith' } = {}) {
    this.mode = mode;
    this.counting = COUNTING_MODES.includes(mode);
    this.deltas = {};
    this.run = { mode, ship, wave: 1, waveCleared: 0, campaignCleared: false, rocks: 0, hits: 0, peakGold: 0, clutchBoss: false, soloWeapon: null };
    this.ended = false;
    this.unlocked = []; // every { feat, added } this run completed (the results screen's NEW IN THE HANGAR)
  }

  count(counter, n = 1) {
    if (!this.counting || !(n > 0)) return;
    this.deltas[counter] = (this.deltas[counter] || 0) + n;
  }

  // Every kill (not in the Weapon Range). Statuses are read off the hull at death (status-effects.js).
  kill(e, player = null) {
    this.count('kills');
    const s = e.st;
    if (s && (s.burn > 0 || s.cold > 0 || s.corrode > 0 || s.frozenMax > 0)) this.count('afflicted');
    if (s && s.frozenMax > 0) this.count('frozen');
    if (!e.isBoss) return;
    this.count('bossKills');
    if (e.bossWave > 0) this.run.waveCleared = Math.max(this.run.waveCleared, e.bossWave);
    if (player && player.maxHp > 0 && player.hp > 0 && player.hp / player.maxHp < 0.1) this.run.clutchBoss = true;
  }

  rockMined() { this.count('rocksMined'); this.run.rocks++; }
  dash() { this.count('dashes'); }
  shieldHit(dmg) { this.count('shieldDamage', Math.max(0, Math.round(dmg))); this.run.hits++; }
  goldSpent(n, held = 0) { this.gold(held); this.count('goldSpent', n); }
  gold(amount) { this.run.peakGold = Math.max(this.run.peakGold, amount || 0); }
  waveReached(wave, campaignWon = false) {
    this.run.wave = Math.max(this.run.wave, wave);
    if (campaignWon) this.run.campaignCleared = true;
  }

  // Land the counts in hangar `h` and complete what's now done. `end`: the run is over (death, victory or
  // banking the score): counts the run itself. A tainted run drops its counts and completes nothing.
  // Returns [{ feat, added }] for the feats completed now (added: hangar-save fresh ids).
  commit(h, { tainted = false, end = false, now = new Date() } = {}) {
    if (this.ended) return [];
    if (end) this.ended = true;
    const deltas = this.deltas;
    this.deltas = {};
    if (tainted) return [];
    const c = h.career;
    for (const [k, n] of Object.entries(deltas)) c[k] = Math.min(Number.MAX_SAFE_INTEGER, (c[k] || 0) + n);
    const r = this.run;
    if (this.counting || this.mode === 'blitz') c.bestWave[this.mode] = Math.max(c.bestWave[this.mode] || 0, r.waveCleared);
    if (this.counting) {
      if (r.campaignCleared) c.bestEndlessWave = Math.max(c.bestEndlessWave || 0, r.wave);
      c.bestRocksRun = Math.max(c.bestRocksRun || 0, r.rocks);
      if (end) {
        c.runs++;
        if (r.campaignCleared) c.campaigns++;
      }
    }
    const done = [];
    for (const feat of FEATS) {
      if (h.feats[feat.id] || !featComplete(feat, c, h.mastery, r)) continue;
      h.feats[feat.id] = today(now);
      h.fresh.push(`feat:${feat.id}`);
      done.push({ feat, added: grantReward(h, feat.reward) });
    }
    this.unlocked.push(...done);
    return done;
  }
}
