// Game modes: NORMAL, HARDCORE and BLITZ. Every rule a mode changes lives in this one table, so the game,
// the balance sim, the leaderboard server (which bundles this file) and the tests all read the same rules.
// No DOM and no imports: the server can't load js/config.js.
//
// A mode changes a run in two ways, on top of the same simulation:
//   flags   checked by the game through modeRules(): shield regen, shield cards in hands and caches,
//           shield repairs (cache, shield crystal, maxed level-up) and the Void Armory's shield bonus;
//   tuning  a TUNING overlay (js/config.js applyTuningOverlay) put on at run start and taken off when the
//           run ends, so a mode never edits the NORMAL defaults. BLITZ compresses the run with it.
// The Weapon Range always flies NORMAL.

export const DEFAULT_MODE = 'normal';
export const MODE_IDS = Object.freeze(['normal', 'hardcore', 'blitz']);

export const MODES = Object.freeze({
  normal: Object.freeze({
    id: 'normal',
    label: 'NORMAL',
    badge: '',
    tagline: 'THE FULL RUN',
    blurb: 'The standard run: the shield recharges, shield cards and repairs are in play.',
    shieldRegen: true,
    shieldCards: true,
    shieldRepairs: true,
    armoryShield: true,
    tuning: Object.freeze({})
  }),
  // The shield is your only life: it starts at base strength and never comes back.
  hardcore: Object.freeze({
    id: 'hardcore',
    label: 'HARDCORE',
    badge: '☠ HARDCORE',
    tagline: 'NO SHIELD REPAIRS',
    blurb: 'No shield regen, no shield cards, no repairs and no Aegis Shield Matrix: when the shield is gone, so are you.',
    shieldRegen: false,
    shieldCards: false,
    shieldRepairs: false,
    armoryShield: false,
    tuning: Object.freeze({})
  }),
  // A quick run that plays out in under 10 minutes: shorter waves, a cheaper XP curve, and the HP,
  // spawn and damage ramps squeezed into the shorter clock. Tuned with the balance sim
  // (tools/balance-sim.mjs --mode blitz --runs 4 --max-minutes 20): expert pilots last a median ~7.5 min
  // (the best builds ~12), average pilots ~6 min; NORMAL experts outlast the 20-minute cap.
  blitz: Object.freeze({
    id: 'blitz',
    label: 'BLITZ',
    badge: '⚡ BLITZ',
    tagline: 'UNDER 10 MINUTES',
    blurb: 'A compressed run for a quick session: short waves, fast levels and a steep ramp. Good runs end around 7 to 9 minutes.',
    shieldRegen: true,
    shieldCards: true,
    shieldRepairs: true,
    armoryShield: true,
    tuning: Object.freeze({
      waveLength: 14, // 22 in NORMAL: a boss every 56 s
      // XP to the next level: 15 + 9 per level (+2 x (LV - 15)^2): about 40% cheaper, so the build comes together fast.
      xpCurveBase: 15,
      xpCurveStep: 9,
      xpCurveAccel: 2,
      // Enemy HP: steeper linear growth and a harder compounding (13% per wave from wave 16, eased in over
      // 8 waves) that walls even the best builds around the 11-12 minute mark.
      waveHpPerWave: 0.2,
      waveHpGrowth: 1.13,
      waveHpGrowthFrom: 16,
      waveHpGrowthRamp: 8,
      // Packs come a little sooner and reach their floor in fewer waves.
      spawnIntervalStart: 2.2,
      spawnIntervalTau: 5,
      // Contact and orb damage: the same gentle start (the first 2+ minutes are unchanged), then a steeper
      // per-wave ramp, so evasive builds that out-dodge the HP wall still wear down.
      damageRampFrom: 10,
      damageRampPerWave: 0.13, // 0.11 before v0.29, 0.12 before v0.31
      damageRampSmooth: 8
    })
  })
});

export function isMode(value) {
  return typeof value === 'string' && MODE_IDS.includes(value);
}

// Any value -> a mode id (NORMAL when it isn't one).
export function normalizeMode(value) {
  return isMode(value) ? value : DEFAULT_MODE;
}

// The rules of a mode, from its id or anything that carries one (the Game, its player, a run summary).
export function modeRules(source) {
  const id = source && typeof source === 'object' ? source.mode : source;
  return MODES[normalizeMode(id)];
}

// Seconds per wave in a mode (the leaderboard's plausibility check pairs waves with time survived).
export function modeWaveLength(mode, fallback = 22) {
  return modeRules(mode).tuning.waveLength ?? fallback;
}

// The Void Armory bonuses a run of this mode starts with: HARDCORE drops the shield bonus (Aegis Shield
// Matrix); every other permanent upgrade still applies.
export function modeBonuses(bonuses, mode) {
  return modeRules(mode).armoryShield ? bonuses : { ...bonuses, bonusHp: 0 };
}

// --- Title-screen choice -------------------------------------------------------------------------
// The mode picked next to LAUNCH, remembered per device. Storage may be missing or blocked (private
// windows): reads fall back to NORMAL, writes report failure.
export const MODE_STORAGE_KEY = 'vexolith_game_mode';

export function readStoredMode(storage) {
  try { return normalizeMode(storage?.getItem(MODE_STORAGE_KEY)); } catch { return DEFAULT_MODE; }
}

export function writeStoredMode(storage, mode) {
  try {
    if (!storage) return false;
    storage.setItem(MODE_STORAGE_KEY, normalizeMode(mode));
    return true;
  } catch {
    return false;
  }
}

// The mode the next run launches in: the remembered title-screen choice.
export function currentMode(storage = defaultStorage()) {
  return readStoredMode(storage);
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// The next mode in the selector, wrapping (keyboard and controller shortcuts).
export function cycleMode(mode, dir = 1) {
  const i = MODE_IDS.indexOf(normalizeMode(mode));
  return MODE_IDS[(i + dir + MODE_IDS.length) % MODE_IDS.length];
}
