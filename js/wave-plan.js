// The 40-wave campaign plan: which hostiles debut when, each wave's theme, and which boss leads each
// boss wave. Pure data with no game imports, so every module (archetypes, enemies, field guide) can
// read it without import cycles.
//
//   * Every 4th wave has a boss: a MINOR boss on waves 4, 12, 20, 28, 36 and a MAJOR one on 8, 16, 24,
//     32, 40. Past wave 40 bosses come in combos (two minors, or a major with a minor escort).
//   * New hostiles only debut on boss waves: the boss brings them in, the next waves feature them,
//     then they join the regular pack mix.
//   * Every wave has a small theme (a banner name plus pack-weight biases); boss waves lean harder.

export const BOSS_EVERY = 4;        // a boss every 4th wave (3 before v0.43)
export const MAJOR_BOSS_EVERY = 8;  // a major one every 8th (6 before v0.43)

// First wave each enemy type can spawn. Types not listed are always available.
export const UNLOCK_WAVE = {
  swarmer: 1, pinwheel: 1, weaver: 1, splitter: 1, mini_splitter: 1,
  mayfly: 4,
  bruiser: 8, serpent: 8,
  blinker: 12, kestrel: 12,
  gunner: 16, carrier: 16, drone: 16,
  blackhole: 20, hulk: 20,
  shielder: 24, gate: 24,
  mitosis: 28,
  conduit: 32, repulsor: 32,
  lancer: 36
};

export const unlockWaveOf = (type) => UNLOCK_WAVE[type] ?? 1;

// Boss leading each boss wave. A slot whose boss is not in js/bosses.js yet falls back to the
// Prismatic Dreadnought ('boss'), so every boss wave always has someone to fight.
export const BOSS_SCHEDULE = {
  4: 'brood_queen',
  8: 'ouroboros',
  12: 'wing_commander',
  16: 'hive_carrier',
  20: 'event_horizon',
  24: 'architect',
  28: 'progenitor',
  32: 'conductor',
  36: 'eclipse_twins',
  40: 'prism'
};

export const CAMPAIGN_WAVES = 40;

// null on a regular wave, 'minor' every BOSS_EVERY waves, 'major' every MAJOR_BOSS_EVERY.
export function bossTier(wave) {
  if (!(wave >= BOSS_EVERY) || wave % BOSS_EVERY !== 0) return null;
  return wave % MAJOR_BOSS_EVERY === 0 ? 'major' : 'minor';
}

export const isBossWave = (wave) => bossTier(wave) !== null;

const MINOR_WAVES = [4, 12, 20, 28, 36];
const MAJOR_WAVES = [8, 16, 24, 32, 40];

// Boss ids for a boss wave (empty on a regular wave). `built(id)` says whether a boss exists yet;
// unbuilt slots become the Dreadnought placeholder. Past wave 40 the roster repeats in combos:
// a minor wave fields two minors, a major wave a major plus a minor.
export function bossesForWave(wave, built = () => true) {
  const tier = bossTier(wave);
  if (!tier) return [];
  const pick = (id) => (built(id) ? id : 'boss');
  if (wave <= CAMPAIGN_WAVES) return [pick(BOSS_SCHEDULE[wave])];
  const round = Math.floor((wave - CAMPAIGN_WAVES - 1) / MAJOR_BOSS_EVERY); // 0 for waves 44/48, 1 for 52/56, ...
  const minorAt = (k) => BOSS_SCHEDULE[MINOR_WAVES[((k % MINOR_WAVES.length) + MINOR_WAVES.length) % MINOR_WAVES.length]];
  if (tier === 'minor') return [pick(minorAt(round * 2)), pick(minorAt(round * 2 + 1))];
  return [pick(BOSS_SCHEDULE[MAJOR_WAVES[round % MAJOR_WAVES.length]]), pick(minorAt(round * 2 + 2))];
}

// Wave themes 1-40. `bias` multiplies pack weights (pack ids from js/waves.js); a pack that does
// not exist yet is simply ignored. `even` gives every unlocked pack the same weight. Each boss wave
// is followed by three regular waves that feature what it brought in.
export const WAVE_THEMES = [
  null,
  { name: 'FIRST CONTACT', bias: { swarm: 1.5, skirmish: 1.3 } },
  { name: 'SKIRMISH LINE', bias: { skirmish: 1.8, splitter: 1.4 } },
  { name: 'SHATTERPOINT', bias: { splitter: 2.2, swarm: 1.3 } },
  { name: 'THE BROOD', bias: { swarm: 1.6, mayfly: 1.5 } },
  { name: 'MAYFLY BLOOM', bias: { mayfly: 3 } },
  { name: 'THE SWARM', bias: { swarm: 2, mayfly: 1.5 } },
  { name: 'HORNET NEST', bias: { mayfly: 2, skirmish: 1.6 } },
  { name: 'SERPENT SEASON', bias: { serpent: 2, bruiser: 1.6 } },
  { name: 'NEST OF VIPERS', bias: { serpent: 3, bruiser: 1.3 } },
  { name: 'STAMPEDE', bias: { bruiser: 3 } },
  { name: 'UNDERTOW', bias: { serpent: 2, splitter: 1.6 } },
  { name: 'SQUADRONS', bias: { kestrel: 2, blinker: 1.6 } },
  { name: 'AIR RAID', bias: { kestrel: 3, skirmish: 1.3 } },
  { name: 'FLICKER', bias: { blinker: 3 } },
  { name: 'DOGFIGHT', bias: { kestrel: 2, blinker: 2 } },
  { name: 'THE HIVE', bias: { carrier: 2, gunner: 1.6 } },
  { name: 'CROSSFIRE', bias: { gunner: 3 } },
  { name: 'ASSEMBLY LINE', bias: { carrier: 3, mayfly: 1.3 } },
  { name: 'FIRING SQUAD', bias: { gunner: 2, carrier: 1.6, bruiser: 1.3 } },
  { name: 'HEAVY GRAVITY', bias: { blackhole: 2, hulk: 1.6 } },
  { name: 'HEAVY METAL', bias: { hulk: 2.5, bruiser: 2 } },
  { name: 'GRAVITY STORM', bias: { blackhole: 3 } },
  { name: 'COLLAPSE', bias: { blackhole: 2, hulk: 2 } },
  { name: 'BLUEPRINTS', bias: { gate: 2, shielder: 1.6 } },
  { name: 'LASER GRID', bias: { gate: 3 } },
  { name: 'PHALANX', bias: { shielder: 3 } },
  { name: 'FORTRESS', bias: { gate: 2, shielder: 2, hulk: 1.3 } },
  { name: 'MITOSIS', bias: { mitosis: 2, splitter: 1.4 } },
  { name: 'OUTBREAK', bias: { mitosis: 3, splitter: 1.5 } },
  { name: 'CHAOS THEORY', even: true },
  { name: 'CONTAGION', bias: { mitosis: 2, mayfly: 2 } },
  { name: 'THE NETWORK', bias: { conduit: 2, repulsor: 1.6 } },
  { name: 'SIGNAL BOOST', bias: { conduit: 2.5, repulsor: 2 } },
  { name: 'GAUNTLET', bias: { serpent: 2, kestrel: 2, gate: 2 } },
  { name: 'FEEDBACK LOOP', bias: { repulsor: 2.5, gunner: 1.5 } },
  { name: 'ECLIPSE', bias: { lancer: 2 } },
  { name: 'LANCE LINE', bias: { lancer: 3 } },
  { name: 'LAST STAND', bias: { hulk: 2, gunner: 1.5, shielder: 1.5, serpent: 1.5 } },
  { name: 'DEAD OF NIGHT', bias: { lancer: 2, blinker: 2, gate: 1.5 } },
  { name: 'FULL SPECTRUM', even: true }
];

// Regular waves (not boss waves) whose themes the post-40 combos remix.
const REMIX_WAVES = WAVE_THEMES.map((t, w) => w).filter(w => w >= 4 && !isBossWave(w) && !WAVE_THEMES[w].even);

// The theme of any wave: 1-40 from the table; past 40 two earlier themes mashed together
// ("CROSSFIRE × PHALANX"), their biases multiplied.
export function waveTheme(wave) {
  if (wave >= 1 && wave <= CAMPAIGN_WAVES) return WAVE_THEMES[wave];
  if (!(wave > CAMPAIGN_WAVES)) return WAVE_THEMES[1];
  const k = wave - CAMPAIGN_WAVES - 1;
  const a = WAVE_THEMES[REMIX_WAVES[k % REMIX_WAVES.length]];
  const b = WAVE_THEMES[REMIX_WAVES[(k * 7 + 5) % REMIX_WAVES.length]];
  if (a === b) return a;
  const bias = { ...a.bias };
  for (const [id, m] of Object.entries(b.bias)) bias[id] = (bias[id] ?? 1) * m;
  return { name: `${a.name} × ${b.name}`, bias };
}

// Hostiles that debut on this wave (the boss brings them in).
export function debutsOn(wave) {
  return Object.keys(UNLOCK_WAVE).filter(type => UNLOCK_WAVE[type] === wave && wave > 1);
}

// Veteran forms: the core swarm grows a new edge every 10 waves (tier 1 → 2 at wave 11 → 3 at wave 21),
// moving a little faster each time; tier-3 splitters burst into four fragments instead of three.
export const VETERAN_TYPES = new Set(['swarmer', 'pinwheel', 'weaver', 'splitter', 'mini_splitter', 'mayfly']);
export function veteranTier(wave) {
  if (!(wave > 10)) return 1;
  return wave > 20 ? 3 : 2;
}
export const VETERAN_SPEED = [1, 1, 1.07, 1.14];
