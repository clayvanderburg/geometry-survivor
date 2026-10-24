// Weapon floor: by player level you must carry a minimum number of weapons, so rushing one or two
// weapons and then stacking global cards is no longer the dominant play.
//
//   player LV   6   12   18   24
//   weapons     2    3    4    5 (all slots; v0.46: 5 slots, was 6 by LV 30)
//
// The floor is 1 + floor(LV / step) (step = TUNING.weaponFloorStep, 6; 5 would tighten it), capped at the
// weapon slots. A level-up below the floor skips the hand and opens CHOOSE A WEAPON (1 of 3, gold can
// reroll it, not skippable; main.js triggerLevelUp). At or above it nothing changes: NEW WEAPON cards still
// come earlier as before. A discard can drop you under it, which forces a pick at the next level-up.
// Supply caches never force one (they don't level you up). Per run the flag player.weaponFloor turns it
// off (the Weapon Range; a future single-weapon mastery mode via the mode's weaponFloor: false).
import { TUNING } from './config.js';
import { ownedWeapons, freeSlots, unownedWeapons, weaponSlots } from './loadout.js';

export const WEAPON_FLOOR_STEP = 6;

export const weaponFloorStep = (tuning = TUNING) => Math.max(1, Math.round(tuning.weaponFloorStep ?? WEAPON_FLOOR_STEP));

// Weapons required at player `level`.
export function weaponFloor(level, { step = weaponFloorStep(), slots = weaponSlots() } = {}) {
  return Math.max(1, Math.min(slots, 1 + Math.floor(Math.max(0, level) / step)));
}

// Off only when the run says so (an old player object without the flag keeps it on).
export const weaponFloorOn = (p) => p?.weaponFloor !== false;

// True when the level-up at `level` must be a CHOOSE A WEAPON pick: the floor is on, the ship carries fewer
// weapons than the floor, and a free slot and an unequipped weapon exist (otherwise the normal hand rolls).
export function weaponFloorDue(p, level = p?.level ?? 1) {
  if (!weaponFloorOn(p)) return false;
  if (ownedWeapons(p).length >= weaponFloor(level)) return false;
  return freeSlots(p) > 0 && unownedWeapons(p).length > 0;
}
