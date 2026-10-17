// Weapon loadout: the weapons a ship can carry, how many slots it has, and which weapons a player owns.
// A run starts with the ship's starting weapons. Level-up hands offer level-ups and weapon-specific
// upgrades only for owned weapons; a NEW WEAPON card (see upgrades.js) fills a free slot with a pick
// of 1 of 3 unowned weapons. Discarding a weapon frees its slot (upgrades.js discardWeapon).
//
// Each weapon: `levelId` is the UPGRADE_POOL line that is the weapon's own level (null for Pew Pews,
// whose power comes from its upgrade lines), `levelKey` the player.weapons key that line raises,
// `tagSources` the WEAPON_TAGS entries the weapon fires (its tag chips and the tag cards it unlocks).
// Weapon-specific upgrade lines name their owners with an `owners` list on the UPGRADE_POOL entry.
import { TUNING } from './config.js';
import { WEAPON_TAGS } from './weapon-scaling.js';

export const WEAPONS = [
  {
    id: 'blaster', name: 'Pew Pews', hudName: 'Pew Pews', levelId: null, levelKey: null, category: 'PRIMARY', tagSources: ['blaster'],
    color: '#00f3ff',
    summary: 'Twin plasma streams straight at your aim. Grows through Prism Split, Hyper-Capacitor, Phase Piercer and Thermite Rounds.'
  },
  {
    id: 'rockets', name: 'Wing Rockets', hudName: 'Wing Rockets', levelId: 'rockets', levelKey: 'rockets', category: 'PRIMARY', tagSources: ['rocket'],
    color: '#ff9b3d',
    summary: 'Dumbfire rockets from both wing tips along your heading. Direct hit plus a small blast.'
  },
  {
    id: 'missiles', name: 'Swarm Micro-Missiles', hudName: 'Missiles', levelId: 'missiles', levelKey: 'missiles', category: 'AUTONOMOUS', tagSources: ['missile'],
    color: '#ff4fd8',
    summary: 'Curving homing missiles that detonate on impact.'
  },
  {
    id: 'lightning', name: 'Tesla Arc Emitter', hudName: 'Tesla Arc', levelId: 'lightning', levelKey: 'lightning', category: 'AUTONOMOUS', tagSources: ['lightning'],
    color: '#c79bff',
    summary: 'Chain lightning that jumps across packs of nearby enemies.'
  },
  {
    id: 'singularity', name: 'Vortex Singularity', hudName: 'Singularity', levelId: 'singularity', levelKey: 'singularity', category: 'AUTONOMOUS', tagSources: ['singularity'],
    color: '#ff6ad5',
    summary: 'Gravitational cores that suck swarms inward, grind them, then implode.'
  },
  {
    id: 'orbitals', name: 'Aegis Orbiting Blades', hudName: 'Orbit Blades', levelId: 'orbitals', levelKey: 'orbitals', category: 'AUTONOMOUS', tagSources: ['orbital'],
    color: '#6dff9e',
    summary: 'Saw-triangles orbit the hull and shred anything they touch.'
  },
  {
    id: 'shrapnel', name: 'Volatile Shatter', hudName: 'Shatter', levelId: 'shrapnel', levelKey: 'shrapnel', category: 'PASSIVE', tagSources: ['shrapnel'],
    color: '#d6dde8',
    summary: 'Kills burst into ricochet shards that set off chain reactions.'
  },
  {
    id: 'mines', name: 'Proximity Mines', hudName: 'Proximity Mines', levelId: 'mines', levelKey: 'mines', category: 'DEPLOYABLE', tagSources: ['mine'],
    color: '#ff5a5a',
    summary: 'Mines dropped in your wake that arm, then burst when an enemy drifts close.'
  },
  {
    id: 'turret', name: 'Sentry Turret', hudName: 'Sentry Turret', levelId: 'turret', levelKey: 'turret', category: 'DEPLOYABLE', tagSources: ['turret'],
    color: '#5aa8ff',
    summary: 'Temporary auto-turrets that shoot the nearest enemy they can see.'
  },
  {
    id: 'drones', name: 'Escort Drones', hudName: 'Escort Drones', levelId: 'drones', levelKey: 'drones', category: 'DEPLOYABLE', tagSources: ['drone'],
    color: '#b6ff4a',
    summary: 'Gunship drones fly in formation behind the hull and fire at nearby targets.'
  }
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
// Weapon whose level is each UPGRADE_POOL line ('missiles' -> Swarm Micro-Missiles, ...).
export const WEAPON_BY_LEVEL_ID = Object.fromEntries(WEAPONS.filter((w) => w.levelId).map((w) => [w.levelId, w]));

// The crab's starting kit: Pew Pews plus Wing Rockets at LV 1.
export const STARTING_WEAPONS = ['blaster', 'rockets'];

// Union of the weapon's tags (chips on its cards and loadout slot).
export function weaponTags(id) {
  const w = WEAPON_BY_ID[id];
  const tags = [];
  for (const src of w?.tagSources || []) for (const t of WEAPON_TAGS[src] || []) if (!tags.includes(t)) tags.push(t);
  return tags;
}

export const weaponSlots = () => Math.max(1, Math.round(TUNING.weaponSlots ?? 6));

// Owned weapons in slot order. Players built before loadouts existed (old test fixtures) own the blaster
// plus every weapon with a level, so their behaviour is unchanged.
export function ownedWeapons(p) {
  if (Array.isArray(p.loadout)) return p.loadout;
  return WEAPONS.filter((w) => (w.levelKey ? (p.weapons?.[w.levelKey] || 0) > 0 : true)).map((w) => w.id);
}

export const ownsWeapon = (p, id) => ownedWeapons(p).includes(id);
export const freeSlots = (p) => Math.max(0, weaponSlots() - ownedWeapons(p).length);
export const unownedWeapons = (p) => WEAPONS.filter((w) => !ownsWeapon(p, w.id)).map((w) => w.id);

// Weapon level shown on slots and HUD (0 for Pew Pews, which grows through its upgrade lines instead).
export function weaponLevel(p, id) {
  const w = WEAPON_BY_ID[id];
  return w?.levelId ? (p.upgradeLevels?.[w.levelId] || 0) : 0;
}

// Every tag carried by an owned weapon (tag cards are only offered for these).
export function ownedTags(p) {
  const tags = new Set();
  for (const id of ownedWeapons(p)) for (const t of weaponTags(id)) tags.add(t);
  return tags;
}
