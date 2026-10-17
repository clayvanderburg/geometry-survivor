// Scripted build strategies for the balance simulator. `priorities` are UPGRADE_POOL ids (or
// "synergy" for any evolution) in pick order; cards outside the list are picked at random.
// Ids missing from UPGRADE_POOL are ignored, and every upgrade also gets an automatic
// "focus:<id>" strategy, so weapons added later are covered without editing this file.
export const NAMED_STRATEGIES = [
  { name: 'projectile', desc: 'Prism Split, Hyper-Capacitor, Phase Piercer, Pulsar Helix', priorities: ['multishot', 'firerate', 'pierce', 'evo_pulsar', 'thrusters', 'magnet'] },
  { name: 'explosive', desc: 'Swarm Missiles + Tesla Arc into Storm Protocol, then damage', priorities: ['missiles', 'lightning', 'evo_tempest', 'pierce', 'shrapnel', 'thrusters'] },
  { name: 'orbital', desc: 'Aegis Blades + Phase Nova Thrusters (defensive melee)', priorities: ['orbitals', 'thrusters', 'pierce', 'shrapnel', 'magnet'] },
  { name: 'singularity', desc: 'Vortex Singularity first, then damage and fire rate', priorities: ['singularity', 'pierce', 'firerate', 'thrusters'] },
  { name: 'mining', desc: 'Rotary Claw + Tectonic Bore, luck and magnet; pilot drills rocks when calm', priorities: ['mining_speed', 'evo_tectonic', 'luck_boost', 'magnet', 'thrusters'], pilot: { mineBias: 1.0 } },
  { name: 'random', desc: 'Uniformly random card picks', priorities: [] }
];

export function buildStrategies(pool, { focus = false, only = null } = {}) {
  const ids = new Set(pool.map(u => u.id));
  const clean = s => ({ ...s, priorities: s.priorities.filter(id => id === 'synergy' || ids.has(id)) });
  let list = NAMED_STRATEGIES.map(clean);
  if (focus) {
    for (const u of pool) {
      if (u.isSynergy) continue;
      list.push({ name: `focus:${u.id}`, desc: `${u.name} first, rest random`, priorities: [u.id] });
    }
  }
  if (only) {
    const want = new Set(only);
    const known = new Set(list.map(s => s.name));
    // "focus:<id>" can be requested directly even without --focus.
    for (const name of want) {
      if (!known.has(name) && name.startsWith('focus:') && ids.has(name.slice(6))) {
        const u = pool.find(x => x.id === name.slice(6));
        list.push({ name, desc: `${u.name} first, rest random`, priorities: [u.id] });
      }
    }
    list = list.filter(s => want.has(s.name));
  }
  return list;
}
