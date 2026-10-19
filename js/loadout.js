// Weapon loadout: the weapons a ship can carry, how many slots it has, and which weapons a player owns.
// A run starts with the ship's starting weapons. Level-up hands offer level-ups and weapon-specific
// upgrades only for owned weapons; a NEW WEAPON card (see upgrades.js) fills a free slot with a pick
// of 1 of 3 unowned weapons. Discarding a weapon frees its slot (upgrades.js discardWeapon).
//
// Passives (PASSIVES below, e.g. Volatile Shatter) are not weapons: they take no slot and level
// through ordinary level-up hands.
//
// Each weapon: `levelId` is the UPGRADE_POOL line that equips it (LV 1), `levelKey` the player.weapons
// key holding its level (every one of its stat cards raises it by 1, weapon-levels.js), `tagSources`
// the WEAPON_TAGS entries the weapon fires (its tag chips and the tag cards it unlocks). Every slot
// weapon, Autocannon included, levels from 1 to WEAPON_MAX_LEVEL (12).
// Weapon-specific upgrade lines name their owners with an `owners` list on the UPGRADE_POOL entry.
import { TUNING } from './config.js';
import { WEAPON_TAGS } from './weapon-scaling.js';
import { STAT_CARDS, ELEMENT_CARDS } from './weapon-levels.js';

export const WEAPONS = [
  {
    id: 'blaster', name: 'Autocannon', hudName: 'Autocannon', levelId: 'blaster', levelKey: 'blaster', category: 'PRIMARY', tagSources: ['blaster'],
    color: '#00f3ff',
    summary: 'Twin plasma streams straight at your aim. Levels up through Prism Split, Hyper-Capacitor and Phase Piercer.'
  },
  {
    id: 'rockets', name: 'Rocket Pods', hudName: 'Rocket Pods', levelId: 'rockets', levelKey: 'rockets', category: 'PRIMARY', tagSources: ['rocket'],
    color: '#ff9b3d',
    summary: 'Dumbfire rockets from pods on both flanks, fired where you aim. Direct hit plus a small blast.'
  },
  {
    id: 'missiles', name: 'Swarm Micro-Missiles', hudName: 'Missiles', levelId: 'missiles', levelKey: 'missiles', category: 'AUTONOMOUS', tagSources: ['missile'],
    color: '#ffe14d',
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
  },
  {
    id: 'grenades', name: 'Plasma Grenades', hudName: 'Grenades', levelId: 'grenades', levelKey: 'grenades', category: 'AUTONOMOUS', tagSources: ['grenade'],
    color: '#38ffc8',
    summary: 'Lobs plasma grenades at the nearest enemies: they land, blink armed for a moment, then burst. Infuse them with an element (FIRE, FROST, CORROSIVE or SHOCK) from a level-up card.'
  },
  {
    id: 'gas', name: 'Corrosive Gas Trail', hudName: 'Gas Trail', levelId: 'gas', levelKey: 'gas', category: 'AUTONOMOUS', tagSources: ['gas'],
    color: '#5dff6e',
    summary: 'Vents a trail of corrosive gas behind your ship. Enemies inside take damage over time and CORRODE (they take more damage from everything). Lead packs through it. Always CORROSIVE.'
  }
];

// Passives fight on their own but are not weapons: no slot, no NEW WEAPON pick, never discarded.
// Their UPGRADE_POOL line (`upgradeId`) is a general upgrade offered in normal level-up hands with
// the usual level jumps; owning it at LV 1+ unlocks the tag cards for its `tagSources` tags.
export const PASSIVES = [
  {
    id: 'shrapnel', name: 'Volatile Shatter', upgradeId: 'shrapnel', levelKey: 'shrapnel', tagSources: ['shrapnel'],
    color: '#d6dde8',
    summary: 'Kills burst into ricochet shards that set off chain reactions.'
  }
];

export const PASSIVE_BY_ID = Object.fromEntries(PASSIVES.map((x) => [x.id, x]));

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
// Weapon whose level is each UPGRADE_POOL line ('missiles' -> Swarm Micro-Missiles, ...).
export const WEAPON_BY_LEVEL_ID = Object.fromEntries(WEAPONS.filter((w) => w.levelId).map((w) => [w.levelId, w]));

// The crab's starting kit: Autocannon only; Rocket Pods join through NEW WEAPON like every other weapon.
export const STARTING_WEAPONS = ['blaster'];

// Union of the weapon's (or passive's) tags (chips on its cards and loadout slot).
export function weaponTags(id) {
  const w = WEAPON_BY_ID[id] || PASSIVE_BY_ID[id];
  const tags = [];
  for (const src of w?.tagSources || []) for (const t of WEAPON_TAGS[src] || []) if (!tags.includes(t)) tags.push(t);
  return tags;
}

export const weaponSlots = () => Math.max(1, Math.round(TUNING.weaponSlots ?? 6));

// Owned weapons in slot order. Players built before loadouts existed (old test fixtures) own the blaster
// plus every weapon with a level, so their behaviour is unchanged.
export function ownedWeapons(p) {
  if (Array.isArray(p.loadout)) return p.loadout;
  return WEAPONS.filter((w) => w.id === 'blaster' || (p.weapons?.[w.levelKey] || 0) > 0).map((w) => w.id);
}

export const ownsWeapon = (p, id) => ownedWeapons(p).includes(id);
export const freeSlots = (p) => Math.max(0, weaponSlots() - ownedWeapons(p).length);
export const unownedWeapons = (p) => WEAPONS.filter((w) => !ownsWeapon(p, w.id)).map((w) => w.id);

// Weapon level shown on slots, HUD and cards: LV 1 for equipping it plus every rank of its stat cards
// and its element card (0 when not equipped). Evolution bonus levels (Storm Protocol) are shown separately.
export function weaponLevel(p, id) {
  const w = WEAPON_BY_ID[id];
  if (!w) return 0;
  let lv = p.upgradeLevels?.[w.levelId] || 0;
  if (!lv && id === 'blaster' && ownsWeapon(p, id)) lv = 1; // fixtures built without the equip line
  if (!lv) return 0;
  for (const c of STAT_CARDS[id] || []) lv += p.upgradeLevels?.[c.id] || 0;
  for (const c of ELEMENT_CARDS[id] || []) lv += p.upgradeLevels?.[c.id] || 0;
  return lv;
}

// Passives the player has installed (LV 1+), in registry order.
export function ownedPassives(p) {
  return PASSIVES.filter((x) => (p.upgradeLevels?.[x.upgradeId] || p.weapons?.[x.levelKey] || 0) > 0).map((x) => x.id);
}

// Passive level shown on the loadout panel.
export const passiveLevel = (p, id) => p.upgradeLevels?.[PASSIVE_BY_ID[id]?.upgradeId] || 0;

// Every tag carried by an owned weapon or passive (tag cards are only offered for these).
export function ownedTags(p) {
  const tags = new Set();
  for (const id of ownedWeapons(p)) for (const t of weaponTags(id)) tags.add(t);
  for (const id of ownedPassives(p)) for (const t of weaponTags(id)) tags.add(t);
  return tags;
}
