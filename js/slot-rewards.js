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
// A player's hand size: by weapons equipped, unless the ship fixes it (Hangar: LANCER's `handSize`) or
// sets a floor (MAGPIE's `handSizeMin`). Players without those fields get handSizeFor(owned).
export function playerHandSize(p, owned) {
  if (p?.handSize > 0) return Math.round(p.handSize);
  const size = handSizeFor(owned);
  return p?.handSizeMin > 0 ? Math.max(size, Math.round(p.handSizeMin)) : size;
}
export const slotDamageBonus = (tuning = TUNING) => Math.max(0, tuning.slotDamageBonus ?? 0.05);

// Damage multiplier for `owned` weapons equipped: +slotDamageBonus at each DAMAGE_SLOTS count reached.
export const loadoutDamageMultFor = (owned) => 1 + slotDamageBonus() * DAMAGE_SLOTS.filter((n) => owned >= n).length;

// The same for a player. Only a real loadout counts (old test fixtures without one get no bonus).
export const loadoutDamageMult = (p) => loadoutDamageMultFor(Array.isArray(p?.loadout) ? p.loadout.length : 0);

const pct = (x) => `+${Math.round(x * 100)}%`;

// What equipping weapon number `slot` unlocks, or null for slots with no reward. `short` is the big line
// on the NEW WEAPON card; `text` the one short line under it (and on the weapon pick screen).
export function slotReward(slot) {
  const hand = handSizeFor(slot);
  if (slot > 1 && hand > handSizeFor(slot - 1)) {
    const more = hand - handSizeFor(slot - 1);
    return { kind: 'hand', short: `+${more} CARD CHOICE${more > 1 ? 'S' : ''}`, text: `Level-ups offer ${hand} cards instead of ${handSizeFor(slot - 1)}.` };
  }
  const k = DAMAGE_SLOTS.indexOf(slot);
  if (k >= 0) {
    const each = slotDamageBonus();
    return { kind: 'damage', short: `${pct(each)} DAMAGE`, text: `To every weapon${k > 0 ? ` (${pct(each * (k + 1))} total)` : ''}.` };
  }
  if (slot === BREAKTHROUGH_SLOT) {
    return { kind: 'breakthrough', short: 'FREE BREAKTHROUGH', text: 'The new weapon starts with its LV 6 Breakthrough.' };
  }
  return null;
}

// The one-time tip shown the first time a NEW WEAPON card turns up (main.js openSlotTip): one line and
// the bonus of every slot that has one.
export const SLOT_TIP_SEEN_KEY = 'vexolith_slot_tip_seen';
export function slotTip(slots = 6) {
  const rewards = [];
  for (let s = 2; s <= slots; s++) {
    const r = slotReward(s);
    if (r) rewards.push({ slot: s, ...r });
  }
  return { title: 'MORE WEAPONS, MORE POWER', line: 'Every NEW WEAPON you take unlocks a bonus. The card shows the next one.', rewards };
}

// Storage may be blocked (reading localStorage itself can throw): the tip then shows once per page load.
export function readSlotTipSeen(storage) {
  try { return !!(storage ?? globalThis.localStorage)?.getItem(SLOT_TIP_SEEN_KEY); } catch { return false; }
}

export function writeSlotTipSeen(storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(SLOT_TIP_SEEN_KEY, '1'); } catch { /* blocked */ }
}
