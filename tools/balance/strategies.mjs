// Scripted build strategies for the balance simulator. `priorities` are UPGRADE_POOL ids (or
// "synergy" for any evolution, "new_weapon" for the NEW WEAPON card) in pick order; cards outside the
// list are picked at random. `weapons` are loadout.js weapon ids the strategy equips, in order, when a
// NEW WEAPON pick is offered (anything else is a random pick). Every run starts with Pew Pews + Wing
// Rockets; weapon level-ups only appear once a weapon is equipped. Ids missing from UPGRADE_POOL are
// ignored, and every upgrade also gets an automatic "focus:<id>" strategy, so weapons added later are
// covered without editing this file.
export const NAMED_STRATEGIES = [
  { name: 'projectile', desc: 'Pew Pews lines (Prism Split, Hyper-Capacitor, Phase Piercer) into Pulsar Helix; kinetic drones and turret', priorities: ['multishot', 'firerate', 'pierce', 'evo_pulsar', 'new_weapon', 'overdrive', 'drones', 'turret', 'tag_kinetic', 'thrusters', 'magnet'], weapons: ['drones', 'turret', 'shrapnel'] },
  { name: 'explosive', desc: 'Swarm Missiles + Tesla Arc into Storm Protocol, rockets and explosive damage', priorities: ['new_weapon', 'missiles', 'lightning', 'evo_tempest', 'rockets', 'tag_explosive', 'overdrive', 'shrapnel', 'thrusters'], weapons: ['missiles', 'lightning', 'mines', 'shrapnel'] },
  { name: 'orbital', desc: 'Aegis Blades + Phase Nova Thrusters (defensive melee), shatter', priorities: ['new_weapon', 'orbitals', 'thrusters', 'overdrive', 'shrapnel', 'magnet'], weapons: ['orbitals', 'shrapnel', 'drones'] },
  { name: 'singularity', desc: 'Vortex Singularity first, then damage and fire rate', priorities: ['new_weapon', 'singularity', 'overdrive', 'firerate', 'mines', 'thrusters'], weapons: ['singularity', 'mines'] },
  { name: 'mining', desc: 'Rotary Claw + Tectonic Bore, luck and magnet; pilot drills rocks when calm', priorities: ['mining_speed', 'evo_tectonic', 'luck_boost', 'magnet', 'thrusters'], pilot: { mineBias: 1.0 } },
  { name: 'random', desc: 'Uniformly random card picks (NEW WEAPON included)', priorities: [] }
];

export function buildStrategies(pool, { focus = false, only = null } = {}) {
  const ids = new Set(pool.map(u => u.id));
  const clean = s => ({ ...s, priorities: s.priorities.filter(id => id === 'synergy' || id === 'new_weapon' || ids.has(id)) });
  let list = NAMED_STRATEGIES.map(clean);
  if (focus) {
    for (const u of pool) {
      if (u.isSynergy) continue;
      list.push(focusStrategy(u));
    }
  }
  if (only) {
    const want = new Set(only);
    const known = new Set(list.map(s => s.name));
    // "focus:<id>" can be requested directly even without --focus.
    for (const name of want) {
      if (!known.has(name) && name.startsWith('focus:') && ids.has(name.slice(6))) {
        const u = pool.find(x => x.id === name.slice(6));
        list.push(focusStrategy(u));
      }
    }
    list = list.filter(s => want.has(s.name));
  }
  return list;
}

// One card first, rest random. A weapon's level line can only be offered once the weapon is equipped,
// so its focus strategy also takes NEW WEAPON next and equips that weapon when it is offered.
function focusStrategy(u) {
  return { name: `focus:${u.id}`, desc: `${u.name} first, rest random`, priorities: [u.id, 'new_weapon'], weapons: [u.id] };
}
