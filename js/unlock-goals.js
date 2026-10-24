// Weapon unlock goals as plain data (no imports), so the save code (progression.js, which the server-side
// stats code also loads) can sanitise unlock progress without pulling in the browser-only modules. The
// rules and the in-run tracker are in js/weapon-unlocks.js.

// The open set: the run-start choices (simple, varied: bolts, explosives, homing, a pierce line, a drill,
// ricochet discs and two deployables).
export const OPEN_WEAPONS = Object.freeze(['blaster', 'rockets', 'missiles', 'raillance', 'harpoon', 'glaive', 'drones', 'turret']); // = loadout.js START_WEAPON_CHOICES (tested)

// Counters a goal can name. `max`: the best value of one run (not a lifetime sum).
export const UNLOCK_STATS = Object.freeze({
  kills: { label: 'Destroy enemies' },
  veins: { label: 'Mine ore veins' },
  dashes: { label: 'Dash' },
  burned: { label: 'Set enemies on FIRE' },
  frozen: { label: 'Freeze enemies' },
  corroded: { label: 'CORRODE enemies' },
  shocked: { label: 'SHOCK enemies' },
  rams: { label: 'Ram enemies to pieces' },
  deployKills: { label: 'Kills by Sentry Turret or Escort Drones' },
  bosses: { label: 'Defeat bosses' },
  wave: { label: 'Reach wave', max: true }
});

// One goal per locked weapon, roughly in the order a new pilot finishes them: the first two or three in
// the first hour, the last after about ten. `hint` says how to get there with the open weapons.
export const UNLOCK_GOALS = Object.freeze([
  // First hour (a run or two each).
  { weapon: 'grenades', stat: 'kills', need: 5000, hint: 'Every kill counts.' },
  { weapon: 'gas', stat: 'dashes', need: 500, hint: 'Dash often: the Gas Trail vents a cloud every dash.' },
  { weapon: 'quake', stat: 'veins', need: 100, hint: 'Drill the glowing gold, shield and core veins in the rocks.' },
  // Hours 1-5: take the element or weapon the goal names and it comes in a few runs.
  { weapon: 'flamethrower', stat: 'burned', need: 2500, hint: 'Take a FIRE card for the Autocannon, Rocket Pods or Missiles.' },
  { weapon: 'mines', stat: 'deployKills', need: 5000, hint: 'Fly the Sentry Turret or Escort Drones.' },
  { weapon: 'cryospray', stat: 'frozen', need: 300, hint: 'Take a FROST card for the Autocannon, Rocket Pods or Missiles.' },
  { weapon: 'acidspray', stat: 'corroded', need: 5000, hint: 'Take a CORROSIVE card for the Autocannon, Rocket Pods or Missiles.' },
  { weapon: 'lightning', stat: 'shocked', need: 7500, hint: 'Take a SHOCK card for the Autocannon, Rocket Pods or Missiles.' },
  { weapon: 'orbitals', stat: 'rams', need: 750, hint: 'Small hulls pop when you fly into them. Mind your shield.' },
  // The long haul (about 10 hours).
  { weapon: 'singularity', stat: 'bosses', need: 25, hint: 'A boss arrives every 5th wave.' },
  { weapon: 'shockfield', stat: 'wave', need: 30, hint: 'Survive to wave 30 in one run.' },
  { weapon: 'nanites', stat: 'kills', need: 300000, hint: 'Every kill counts. The long haul.' }
]);

export const GOAL_BY_WEAPON = Object.freeze(Object.fromEntries(UNLOCK_GOALS.map((g) => [g.weapon, g])));
export const LOCKABLE_WEAPONS = Object.freeze(UNLOCK_GOALS.map((g) => g.weapon));

// --- Save data ---------------------------------------------------------------------------------------

const MAX_STAT = 1e9;
export const intIn = (v, max = MAX_STAT) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);

// { stats: { kills: n, ... }, weapons: [unlocked ids], fresh: [unlocked, reveal not shown yet] }.
// Unknown counters and ids drop out; weapons that are open anyway are never stored.
export function normalizeUnlocks(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const statsSrc = src.stats && typeof src.stats === 'object' && !Array.isArray(src.stats) ? src.stats : {};
  const stats = {};
  for (const id of Object.keys(UNLOCK_STATS)) {
    const v = intIn(statsSrc[id]);
    if (v > 0) stats[id] = v;
  }
  const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => LOCKABLE_WEAPONS.includes(id)))] : []);
  const weapons = ids(src.weapons);
  const fresh = ids(src.fresh).filter((id) => weapons.includes(id));
  return { stats, weapons, fresh };
}

