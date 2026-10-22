// Scripted build strategies for the balance simulator. `priorities` are UPGRADE_POOL ids (or
// "synergy" for any evolution, "new_weapon" for the NEW WEAPON card) in pick order; cards outside the
// list are picked at random. `weapons` are loadout.js weapon ids the strategy equips, in order, when a
// NEW WEAPON pick is offered (anything else is a random pick). Every run starts with Autocannon only
// (STARTING_WEAPONS); weapon level-ups only appear once a weapon is equipped. Ids missing from UPGRADE_POOL are
// ignored, and every upgrade also gets an automatic "focus:<id>" strategy, so weapons added later are
// covered without editing this file.
// `startWeapon` is the run-start pick (loadout.js START_WEAPON_CHOICES); none = Autocannon.
// `breakthrough: 'transform' | 'boost'` fixes the Breakthrough choice (default: a coin flip).
import { POWER_STATS } from '../../js/weapon-levels.js';
import { WEAPONS, START_WEAPON_CHOICES } from '../../js/loadout.js';

export const NAMED_STRATEGIES = [
  { name: 'projectile', desc: 'Autocannon lines (Prism Split, Hyper-Capacitor, Phase Piercer) into Pulsar Helix; kinetic drones and turret', priorities: ['blaster_damage', 'multishot', 'firerate', 'evo_pulsar', 'new_weapon', 'overdrive', 'drones', 'turret', 'tag_kinetic', 'thrusters', 'move_speed', 'magnet'], weapons: ['drones', 'turret'] },
  { name: 'explosive', desc: 'Swarm Missiles + Tesla Arc into Storm Protocol, rockets and explosive damage', priorities: ['new_weapon', 'missiles', 'lightning', 'evo_tempest', 'rockets', 'tag_explosive', 'overdrive', 'shrapnel', 'thrusters', 'move_speed'], weapons: ['missiles', 'lightning', 'rockets', 'mines'] },
  { name: 'orbital', desc: 'Aegis Blades + Phase Nova Thrusters (defensive melee), shatter', priorities: ['new_weapon', 'orbitals', 'thrusters', 'move_speed', 'overdrive', 'shrapnel', 'magnet'], weapons: ['orbitals', 'drones'] },
  { name: 'singularity', desc: 'Vortex Singularity first, then damage and fire rate', priorities: ['new_weapon', 'singularity', 'overdrive', 'cooldown_matrix', 'persistence_field', 'firerate', 'mines', 'thrusters', 'move_speed'], weapons: ['singularity', 'mines'] },
  { name: 'mining', desc: 'Rotary Claw + Tectonic Bore, luck and magnet; pilot drills rocks when calm', priorities: ['mining_speed', 'evo_tectonic', 'luck_boost', 'magnet', 'xp_growth', 'thrusters', 'move_speed'], pilot: { mineBias: 1.0 } },
  { name: 'prospector', desc: 'Random card picks; the pilot drills toward nearby gold veins when calm: a regular gold miner without a mining build', priorities: [], pilot: { mineBias: 0.6, goldPull: 200 } },
  { name: 'random', desc: 'Uniformly random card picks (NEW WEAPON included)', priorities: [] }
];

// One "weapon:<id>" strategy per slot weapon: start with it when it is a run-start choice, otherwise
// take NEW WEAPON until it is offered; then its own level-ups first (power stats first), rest random.
export function weaponFocusStrategy(pool, id) {
  const cards = pool.filter(c => c.statCard && c.weapon === id);
  const ordered = [...cards.filter(c => POWER_STATS.has(c.stat)), ...cards.filter(c => !POWER_STATS.has(c.stat))].map(c => c.id);
  const start = START_WEAPON_CHOICES.includes(id) ? id : undefined;
  const name = WEAPONS.find(w => w.id === id)?.name || id;
  return { name: `weapon:${id}`, desc: `${name}${start ? ' as the starting weapon' : ' via NEW WEAPON'}, its level-ups first, rest random`, priorities: [...ordered, 'new_weapon'], weapons: [id], startWeapon: start };
}

// Random builds from each run-start pick ("start:<id>"), to compare the starting weapons themselves.
export const startStrategy = (id) => ({ name: `start:${id}`, desc: `Starts with ${WEAPONS.find(w => w.id === id)?.name || id}, then random picks`, priorities: [], startWeapon: id });

export function buildStrategies(pool, { focus = false, weaponFocus = false, only = null } = {}) {
  const ids = new Set(pool.map(u => u.id));
  // A weapon's equip line is never offered in a hand (NEW WEAPON installs it), so a weapon id in a
  // priority list stands for that weapon's POWER stat cards (damage first), in card order.
  const expand = (id) => (u => (u?.isCore ? pool.filter(c => c.statCard && c.weapon === id && POWER_STATS.has(c.stat)).map(c => c.id) : [id]))(pool.find(x => x.id === id));
  const clean = s => ({ ...s, priorities: s.priorities.flatMap(expand).filter(id => id === 'synergy' || id === 'new_weapon' || ids.has(id)) });
  let list = NAMED_STRATEGIES.map(clean);
  if (focus) {
    for (const u of pool) {
      if (u.isSynergy) continue;
      list.push(clean(focusStrategy(u)));
    }
  }
  const extra = () => [...WEAPONS.map(w => weaponFocusStrategy(pool, w.id)), ...START_WEAPON_CHOICES.map(startStrategy)];
  if (weaponFocus) list.push(...extra());
  if (only) {
    const want = new Set(only);
    const known = new Set(list.map(s => s.name));
    // "focus:<id>" can be requested directly even without --focus.
    for (const name of want) {
      if (known.has(name)) continue;
      if (name.startsWith('focus:') && ids.has(name.slice(6))) list.push(clean(focusStrategy(pool.find(x => x.id === name.slice(6)))));
      const x = extra().find(s => s.name === name);
      if (x) list.push(x);
    }
    list = list.filter(s => want.has(s.name));
  }
  return list;
}

// One card first, rest random. A weapon's level line can only be offered once the weapon is equipped,
// so its focus strategy also takes NEW WEAPON next and equips that weapon when it is offered.
function focusStrategy(u) {
  const weapon = u.weapon || u.id; // a stat card focuses its own weapon
  return { name: `focus:${u.id}`, desc: `${u.name} first, rest random`, priorities: [u.id, 'new_weapon'], weapons: [weapon] };
}
