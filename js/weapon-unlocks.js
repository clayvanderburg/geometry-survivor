// Weapon locks (docs/HANGAR_DESIGN.md §3): with the Hangar flag on, some weapons start locked and are
// unlocked by feats (js/feats.js rewards) or mastery. A locked weapon never shows in NEW WEAPON picks,
// caches or the start pick. With the flag off nothing is locked: runs carry no lockedWeapons list.
// Pure, DOM-free.
import { WEAPONS } from './loadout.js';
import { FEATS } from './feats.js';

// Weapons every player had before the Hangar that the Hangar locks. A save that had runs when it first
// saw the Hangar (hangar.veteran) keeps them unlocked (Director's default; Clay may change it).
export const GRANDFATHERED = Object.freeze(['flamethrower', 'cryospray', 'acidspray', 'gas', 'singularity', 'shockfield']);

// Weapon id -> the feats that unlock it (any one is enough: Vortex has two paths once mastery lands).
export const WEAPON_UNLOCK_FEATS = Object.freeze(FEATS.reduce((out, f) => {
  if (f.reward.weapon) (out[f.reward.weapon] ||= []).push(f.id);
  return out;
}, {}));

// Is this weapon locked by a feat at all (and does it exist in this build)?
export const isLockable = (id) => !!WEAPON_UNLOCK_FEATS[id] && WEAPONS.some((w) => w.id === id);

export function isWeaponUnlocked(h, id) {
  if (!isLockable(id)) return true;
  if (h?.weapons?.includes(id)) return true;
  return !!h?.veteran && GRANDFATHERED.includes(id);
}

// The locked weapon ids for a hangar save, in WEAPONS order.
export function lockedWeapons(h) {
  return WEAPONS.map((w) => w.id).filter((id) => !isWeaponUnlocked(h, id));
}
