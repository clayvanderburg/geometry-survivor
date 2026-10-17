// Gold: a per-run currency mined from gold veins (separate from Void Cores, which are meta) and spent on
// the level-up hand. REROLL replaces the unlocked cards (TUNING.goldRerollCost, x goldRerollGrowth for
// each further reroll of the same hand); LOCK (TUNING.goldLockCost) keeps one card in place through
// rerolls and carries it into the next level-up hand if another card is picked.
//
// Pure helpers over a player and plain objects, so tests and the balance harness can use them without
// a DOM. The hand itself is still rolled by upgrades.js rollLevelUpHand: rollHandAround only wraps it.
import { TUNING } from './config.js';
import { rollLevelUpHand, rollUpgrades, eligibleUpgrades, canOfferNewWeapon, newWeaponCard } from './upgrades.js';

export const GOLD_ICON = '◆';
export const MAX_COINS_PER_VEIN = 6; // a vein's gold is split into at most this many pickups

export const goldPerVein = (tuning = TUNING) => Math.max(0, Math.round(tuning.goldPerVein ?? 2));

// Pickup values for `total` gold: one coin per gold, larger amounts split evenly over MAX_COINS_PER_VEIN.
export function goldCoins(total, maxCoins = MAX_COINS_PER_VEIN) {
  const amount = Math.max(0, Math.round(total));
  const n = Math.min(amount, Math.max(1, maxCoins));
  return Array.from({ length: n }, (_, i) => Math.floor(amount / n) + (i < amount % n ? 1 : 0));
}

// Cost of the next reroll after `rerolls` rerolls of the same hand: 20, 40, 80, 160... by default.
export function rerollCost(rerolls = 0, tuning = TUNING) {
  const base = Math.max(0, tuning.goldRerollCost ?? 20);
  const growth = Math.max(1, tuning.goldRerollGrowth ?? 2);
  return Math.round(base * Math.pow(growth, Math.max(0, rerolls)));
}

export const lockCost = (tuning = TUNING) => Math.max(0, Math.round(tuning.goldLockCost ?? 5));

// Spends from `wallet.gold` only when it covers the whole amount; gold never goes below 0.
export function trySpend(wallet, amount) {
  if (!wallet || !(amount >= 0) || !(wallet.gold >= amount)) return false;
  wallet.gold -= amount;
  return true;
}

// A locked card brought into a new hand, re-checked against the player as they are now: null when it
// can no longer be offered (maxed out, its weapon discarded, requirements lost, NEW WEAPON with no free
// slot). A kept card keeps its rolled level jump, trimmed to the levels it still has left.
export function refreshLockedCard(player, card) {
  if (!card || card.isWeaponPick) return null;
  if (card.isNewWeapon) return canOfferNewWeapon(player) ? newWeaponCard(player) : null;
  const upgrade = eligibleUpgrades(player).find((u) => u.id === card.id);
  if (!upgrade) return null;
  const remaining = upgrade.maxLevel - (player.upgradeLevels[upgrade.id] || 0);
  return { ...upgrade, levelJump: Math.max(1, Math.min(card.levelJump || 1, remaining)) };
}

// The level-up hand hook. With no lock it is exactly roll(player, count). With a lock ({ card, slot })
// the locked card holds its slot and the other count - 1 cards come from a normal roll (same gating,
// NEW WEAPON odds and rarity rolls), re-drawn if they would repeat the locked card. A locked NEW WEAPON
// card already fills the hand's NEW WEAPON spot, so the rest is a plain roll (rollPlain) without one.
export function rollHandAround(player, count, lock, roll = rollLevelUpHand, rollPlain = rollUpgrades) {
  if (!lock?.card) return roll(player, count);
  const want = Math.max(0, count - 1);
  const id = lock.card.id;
  let rest = [];
  if (lock.card.isNewWeapon) {
    rest = rollPlain(player, want);
    player.newWeaponDrought = 0; // a NEW WEAPON card is on show: the pity counter restarts
  } else {
    const drought = player.newWeaponDrought;
    for (let attempt = 0; attempt < 6; attempt++) {
      player.newWeaponDrought = drought;
      rest = roll(player, want);
      if (!rest.some((c) => c.id === id)) break;
    }
    rest = rest.filter((c) => c.id !== id);
  }
  if (rest.length < want) {
    // Still short (a tiny pool kept repeating the locked card): top up from a plain roll.
    const extra = rollPlain(player, count).filter((c) => c.id !== id && !rest.some((r) => r.id === c.id));
    rest.push(...extra.slice(0, want - rest.length));
  }
  const hand = rest.slice(0, want);
  hand.splice(Math.max(0, Math.min(lock.slot ?? 0, hand.length)), 0, lock.card);
  return hand;
}
