// Weapon unlocks (Deep Rock Galactic: Survivor-style): a fresh save flies with OPEN_WEAPONS; each of the
// other weapons unlocks from one small achievement themed to it, so the goal teaches the weapon
// ("Freeze 300 enemies" -> Cryo Sprayer). Locked weapons never turn up in NEW WEAPON picks, the weapon
// floor's CHOOSE A WEAPON, rerolls or evolution hints: the run's player carries `weaponPool` (the ids it
// may draw) and loadout.js unownedWeapons reads it.
//
// Progress lives in the save (progression.js `unlocks`): lifetime `stats` per counter, the `weapons`
// unlocked and the `fresh` ones still owed a reveal card. During a run UnlockTracker counts into a run
// tally (cheap: a number bump per event, no storage write); the tally is merged into the save when a goal
// completes, at each wave and when the run ends, so blocked storage only costs persistence.
//
// Every goal must be reachable with the open weapons: elements come from element cards on the
// Autocannon, Rocket Pods and Missiles; bosses, veins, dashes and kills need no particular weapon.
//
// Testing: TUNING.unlockAllWeapons (Live Tuning) or ?unlockall=1 in the URL lifts every lock (benches,
// smokes and the media tools reach all 20 weapons). Either taints the run for the leaderboard.
import { TUNING } from './config.js';
import { WEAPONS, WEAPON_BY_ID } from './loadout.js';
import { OPEN_WEAPONS, UNLOCK_STATS, UNLOCK_GOALS, LOCKABLE_WEAPONS, intIn } from './unlock-goals.js';

export { OPEN_WEAPONS, UNLOCK_STATS, UNLOCK_GOALS, GOAL_BY_WEAPON, LOCKABLE_WEAPONS, normalizeUnlocks } from './unlock-goals.js';

// --- The override ------------------------------------------------------------------------------------

const urlFlag = (() => {
  try { return /[?&]unlockall=1\b/.test(globalThis.location?.search || ''); } catch { return false; }
})();
export const unlockOverride = (tuning = TUNING) => urlFlag || (tuning?.unlockAllWeapons ?? 0) >= 1;

export const isWeaponUnlocked = (unlocks, id, tuning = TUNING) =>
  !!WEAPON_BY_ID[id] && (!LOCKABLE_WEAPONS.includes(id) || unlockOverride(tuning) || !!unlocks?.weapons?.includes(id));

// Weapon ids a run may draw (registry order), or null when nothing is locked (the override).
export function availableWeapons(unlocks, tuning = TUNING) {
  if (unlockOverride(tuning)) return null;
  return WEAPONS.map((w) => w.id).filter((id) => isWeaponUnlocked(unlocks, id, tuning));
}

// Progress toward a goal from a stats map: { have, need, done, frac }.
export function goalProgress(goal, stats = {}) {
  const have = Math.min(goal.need, intIn(stats[goal.stat]));
  return { have, need: goal.need, done: have >= goal.need, frac: goal.need > 0 ? have / goal.need : 1 };
}

const num = (n) => n.toLocaleString('en-US');
// "Freeze enemies 87/150" (or "Reach wave 30" with the best so far for a one-run goal).
export function goalLabel(goal) { return UNLOCK_STATS[goal.stat]?.label || goal.stat; }
export function goalText(goal, have = null) {
  const max = UNLOCK_STATS[goal.stat]?.max;
  const base = max ? `${goalLabel(goal)} ${goal.need}` : `${goalLabel(goal)}`;
  if (have == null) return max ? base : `${base} ${num(goal.need)}`;
  return max ? `${base} (best ${num(have)})` : `${base} ${num(have)}/${num(goal.need)}`;
}

// The goals to chase next, nearest to done first: the first FRONTIER still open (table order) plus any
// that is a good way along, so a new pilot isn't shown the 300,000-kill haul. The game-over teaser.
const FRONTIER = 4;
const WELL_ALONG = 0.25;
export function nearestGoals(unlocks, stats = unlocks?.stats || {}, n = 2) {
  return UNLOCK_GOALS.filter((g) => !unlocks?.weapons?.includes(g.weapon))
    .map((g, i) => ({ goal: g, i, ...goalProgress(g, stats) }))
    .filter((x) => x.i < FRONTIER || x.frac >= WELL_ALONG)
    .sort((a, b) => b.frac - a.frac || UNLOCK_GOALS.indexOf(a.goal) - UNLOCK_GOALS.indexOf(b.goal))
    .slice(0, n);
}

// Lifetime stats plus a run tally (sums; `max` counters take the larger).
export function mergeStats(saved = {}, run = {}) {
  const out = { ...saved };
  for (const [id, v] of Object.entries(run)) {
    if (!UNLOCK_STATS[id] || !(v > 0)) continue;
    out[id] = UNLOCK_STATS[id].max ? Math.max(out[id] || 0, intIn(v)) : intIn((out[id] || 0) + v);
  }
  return out;
}

// --- The in-run tracker ------------------------------------------------------------------------------

// `progression`: the ProgressionManager (its data.unlocks is the save). `onUnlock(goal)` fires when a
// goal completes mid-run (the toast). Counting is off until startRun (and off in the Weapon Range).
export class UnlockTracker {
  constructor(progression, { onUnlock = null } = {}) {
    this.progression = progression;
    this.onUnlock = onUnlock;
    this.run = {};
    this.active = false;
    this.pending = {}; // stat -> goals not unlocked yet
    this.player = null;
    this.unlockedThisRun = [];
  }

  get save() {
    const d = this.progression?.data;
    if (!d) return normalizeUnlocks({});
    if (!d.unlocks) d.unlocks = normalizeUnlocks({});
    return d.unlocks;
  }

  // A fresh run: the player's draw pool and the goals still to watch.
  startRun(player, { counting = true } = {}) {
    this.commit(); // a run left without a game over (abandoned, restarted) still banks its tally
    this.run = {};
    this.unlockedThisRun = [];
    this.active = counting;
    this.player = player || null;
    this.rebuildPending();
    if (player) player.weaponPool = availableWeapons(this.save);
  }

  rebuildPending() {
    const owned = this.save.weapons;
    this.pending = {};
    for (const g of UNLOCK_GOALS) if (!owned.includes(g.weapon)) (this.pending[g.stat] ||= []).push(g);
  }

  // Lifetime stats including this run so far.
  stats() { return mergeStats(this.save.stats, this.run); }
  progress(goal) { return goalProgress(goal, this.stats()); }

  // A counter went up by n (hot path: one add and a lookup when nothing is close).
  bump(stat, n = 1) {
    if (!this.active || !(n > 0)) return;
    this.run[stat] = (this.run[stat] || 0) + n;
    if (this.pending[stat]) this.check(stat);
  }

  // An enemy died. `group`: the weapon or source behind the killing blow (run-stats.js groups: 'ram' when
  // it popped on the shield, 'turret' / 'drones' for those deployables).
  kill(e, group) {
    if (!this.active) return;
    this.bump('kills');
    if (e?.isBoss) this.bump('bosses');
    if (group === 'ram') this.bump('rams');
    else if (group === 'turret' || group === 'drones') this.bump('deployKills');
  }

  // A one-run best (the wave reached).
  reach(stat, value) {
    if (!this.active || !(value > (this.run[stat] || 0))) return;
    this.run[stat] = value;
    if (this.pending[stat]) this.check(stat);
  }

  check(stat) {
    const goals = this.pending[stat];
    const saved = this.save.stats[stat] || 0;
    const have = UNLOCK_STATS[stat]?.max ? Math.max(saved, this.run[stat] || 0) : saved + (this.run[stat] || 0);
    const done = goals.filter((g) => have >= g.need);
    if (!done.length) return;
    for (const g of done) this.unlock(g);
  }

  unlock(goal) {
    const save = this.save;
    if (save.weapons.includes(goal.weapon)) return false;
    this.commit(false);
    save.weapons.push(goal.weapon);
    save.fresh.push(goal.weapon);
    this.unlockedThisRun.push(goal.weapon);
    this.progression?.save?.();
    this.rebuildPending();
    // Mid-run unlocks join this run's pool at once (NEW WEAPON picks can offer them from now on).
    const p = this.player;
    if (p && Array.isArray(p.weaponPool) && !p.weaponPool.includes(goal.weapon)) {
      p.weaponPool = WEAPONS.map((w) => w.id).filter((id) => id === goal.weapon || p.weaponPool.includes(id));
    }
    this.onUnlock?.(goal);
    return true;
  }

  // Merge the run tally into the save (and write it unless `write` is false).
  commit(write = true) {
    if (!Object.keys(this.run).length) return;
    const save = this.save;
    save.stats = mergeStats(save.stats, this.run);
    this.run = {};
    if (write) this.progression?.save?.();
  }

  // Run over: bank the tally; counting stops until the next startRun.
  endRun() {
    this.commit();
    this.active = false;
  }

  // Weapons unlocked and not revealed yet (the game-over reveal card); `markRevealed` clears them.
  freshUnlocks() { return [...this.save.fresh]; }
  markRevealed() {
    if (!this.save.fresh.length) return;
    this.save.fresh = [];
    this.progression?.save?.();
  }
}
