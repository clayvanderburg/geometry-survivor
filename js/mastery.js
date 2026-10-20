// Weapon mastery and SOLO runs (docs/HANGAR_DESIGN.md §4), Hangar flag only. A run that carries exactly one
// slot weapon from start to finish is a solo run; clearing waves solo masters that weapon (any ship but
// BROOD; NORMAL and HARDCORE only). Tiers are kept in the save's hangar.mastery. Pure and DOM-free apart
// from the remembered SOLO switch.
//
//   ★    PROVEN       clear wave 10     unlocks its kin (feats.js mastery feats), joins VEXOLITH's start pick
//   ★★   VETERAN      clear wave 25     +8% damage with that weapon in every run
//   ★★★  MASTER       clear the campaign  another +8% (16% in all)
//   ✦    GRANDMASTER  wave 75 in Endless  a title, no power
export const MASTERY_TIERS = Object.freeze([
  { tier: 1, name: 'PROVEN', target: 'CLEAR WAVE 10', test: (r) => r.waveCleared >= 10 },
  { tier: 2, name: 'VETERAN', target: 'CLEAR WAVE 25', test: (r) => r.waveCleared >= 25 },
  { tier: 3, name: 'MASTER', target: 'CLEAR THE CAMPAIGN', test: (r) => r.campaignCleared },
  { tier: 4, name: 'GRANDMASTER', target: 'REACH WAVE 75 IN ENDLESS', test: (r) => r.campaignCleared && r.wave >= 75 }
]);
export const MASTERY_DAMAGE_STEP = 0.08; // per tier from VETERAN, at most two steps (Director's default 4)
export const SOLO_HAND_SIZE = 3;

// The highest tier a finished (or live) run has earned for its solo weapon.
export function masteryTierFor(run) {
  if (!run?.soloWeapon) return 0;
  let tier = 0;
  for (const t of MASTERY_TIERS) if (t.test(run)) tier = t.tier;
  return tier;
}

// Damage multiplier a mastery tier gives its weapon in every run.
export const masteryDamageFor = (tier) => 1 + MASTERY_DAMAGE_STEP * Math.max(0, Math.min(2, (tier || 0) - 1));

// { weaponId: multiplier } for every weapon with a damage bonus (weapon-scaling.js weaponDamage reads it).
export function masteryDamageTable(mastery = {}) {
  const out = {};
  for (const [id, tier] of Object.entries(mastery)) if (masteryDamageFor(tier) > 1) out[id] = masteryDamageFor(tier);
  return out;
}

// What the next star asks for ('CLEAR WAVE 10'), or null at the top.
export const nextMasteryTarget = (tier) => MASTERY_TIERS.find((t) => t.tier === (tier || 0) + 1)?.target || null;
export const masteryName = (tier) => MASTERY_TIERS.find((t) => t.tier === tier)?.name || '';
export const masteryStars = (tier) => (tier >= 4 ? '✦' : '★'.repeat(Math.max(0, tier || 0)));

// The SOLO // MASTERY ATTEMPT switch, remembered per device (blocked storage: off).
export const SOLO_STORAGE_KEY = 'vexolith_solo';
export function readSolo(storage) {
  try { return storage?.getItem(SOLO_STORAGE_KEY) === '1'; } catch { return false; }
}
export function writeSolo(storage, on) {
  try { storage?.setItem(SOLO_STORAGE_KEY, on ? '1' : '0'); } catch { /* this session only */ }
}
