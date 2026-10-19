// Slot rewards: filling weapon slots pays off, so stacking one weapon is no longer the strong play.
//
//   1 weapon   2-card level-up hands
//   slot 2     3-card hands
//   slot 3     +5% damage to every weapon (TUNING.slotDamageBonus)
//   slot 4     4-card hands
//   slot 5     another +5% (+10% total)
//   slot 6     that weapon starts with its LV 6 Breakthrough (once per run)
//
// Hand size and the damage bonus follow the weapons equipped right now (a discard loses them); the slot 6
// Breakthrough replaces that weapon's LV 6 one and is given once per run (upgrades.js acquireWeapon).
// Imports only config.js, so weapon-scaling.js can read the damage bonus without an import cycle.
import { TUNING } from './config.js';

export const HAND_SIZES = [2, 3, 3, 4]; // by weapons equipped (1, 2, 3, 4+)
export const DAMAGE_SLOTS = [3, 5];
export const BREAKTHROUGH_SLOT = 6;

export const handSizeFor = (owned) => HAND_SIZES[Math.max(1, Math.min(HAND_SIZES.length, Math.floor(owned) || 1)) - 1];
export const slotDamageBonus = (tuning = TUNING) => Math.max(0, tuning.slotDamageBonus ?? 0.05);

// Damage multiplier for `owned` weapons equipped: +slotDamageBonus at each DAMAGE_SLOTS count reached.
export const loadoutDamageMultFor = (owned) => 1 + slotDamageBonus() * DAMAGE_SLOTS.filter((n) => owned >= n).length;

// The same for a player. Only a real loadout counts (old test fixtures without one get no bonus).
export const loadoutDamageMult = (p) => loadoutDamageMultFor(Array.isArray(p?.loadout) ? p.loadout.length : 0);

const pct = (x) => `+${Math.round(x * 100)}%`;

// What equipping weapon number `slot` unlocks, or null for slots with no reward. `short` fits the
// NEW WEAPON card's banner; `text` is the longer line under it and on the weapon pick screen.
export function slotReward(slot) {
  const hand = handSizeFor(slot);
  if (slot > 1 && hand > handSizeFor(slot - 1)) {
    return { kind: 'hand', short: `${hand} CARD CHOICES`, text: `Level-ups offer ${hand} cards instead of ${handSizeFor(slot - 1)}.` };
  }
  const k = DAMAGE_SLOTS.indexOf(slot);
  if (k >= 0) {
    const each = slotDamageBonus();
    return { kind: 'damage', short: `${pct(each)} DAMAGE`, text: `Every weapon deals ${pct(each)} damage${k > 0 ? ` (${pct(each * (k + 1))} total)` : ''}.` };
  }
  if (slot === BREAKTHROUGH_SLOT) {
    return { kind: 'breakthrough', short: 'FREE BREAKTHROUGH', text: 'This weapon starts with its LV 6 Breakthrough.' };
  }
  return null;
}
