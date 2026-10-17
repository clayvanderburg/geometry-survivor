// Centralized Live Tuning Configuration & Cross-Tab Sync for VEXOLITH // SURVIVOR
const TUNING_STORAGE_KEY = 'vectra_survivor_tuning_v3';

export const DEFAULT_TUNING = {
  // 1. Crab Ship & Drill-Claws
  shipRadius: 15,
  moveSpeed: 5.0,
  drillScale: 1.15,
  miningSpeed: 75,
  miningRange: 43,
  dualClawBonus: 1.25,
  carapaceColor: '#00f3ff',
  innerArmorColor: '#00ffaa',
  drillIdleColor: '#00f3ff',
  drillActiveColor: '#00ffaa',
  drillJawColor: '#ffcc00',

  // 2. Weapons & Shield
  baseDamage: 11,
  fireRate: 6.5,
  bulletSpeed: 14.0,
  bulletRadius: 3.8,
  bulletColorHue: 186,
  shieldHue: 222,
  shieldPadding: 0.38,
  shieldThickness: 1.0,
  shieldRegenRate: 1.2,
  dashCooldownBase: 1.5,

  // 3. Luck, Multi-Level Rolls & Chest Jackpots
  baseLuck: 1.0,
  doubleLevelChance: 0.1,
  tripleLevelChance: 0.035,
  quadLevelChance: 0.01,
  pentaLevelChance: 0.0025,
  chestDropMult: 1.0,
  goldVeinChestChance: 0.004,
  chestDoubleChance: 0.075,
  chestTripleChance: 0.018,
  chestPentaChance: 0.003,

  // 4. World, Asteroids & Economy
  clusterCount: 38,
  rockHpMult: 1.6,
  rockSizeMult: 1.15,
  magnetRadius: 145,
  xpMultiplier: 1.0,
  coreDropMult: 1.0,
  maxWaveCores: 3,

  // 5. Audio, Enemies & Visual FX
  musicVolume: 0.4,
  sfxVolume: 0.38,
  musicBpm: 132,
  screenShakeMult: 1.0,
  gridWarpMult: 1.0,
  enemySpeedMult: 1.0,
  enemyHpMult: 1.0,

  // 6. Gravity Wells & Singularities (pulls are px/tick² at the core, eased to 0 at the rim)
  blackholePullRadius: 200,
  blackholePlayerPull: 0.4,
  blackholeEnemyPull: 0.45,
  blackholeBulletBend: 0.22,
  blackholePickupPull: 0.3,
  singularityPull: 0.75,
  singularityCollapseMult: 1.0,

  // 7. Boss Encounters (presentation only; boss stats and rewards are unchanged)
  bossWarningTime: 3.0,
  bossHitStop: 0.1,
  bossSlowMo: 0.5,

  // 8. Hit Feedback & Damage Numbers
  knockbackMult: 1.0,
  hitStopMult: 1.0,
  damageNumberCap: 48,
  damageNumberScale: 1.0,

  // 9. Enemy Variety & Lieutenants (pack weights are relative; a pack joins at its archetype's unlock wave)
  spawnWeightSwarm: 40,
  spawnWeightSkirmish: 20,
  spawnWeightSplitter: 18,
  spawnWeightBlackhole: 12,
  spawnWeightBruiser: 12,
  spawnWeightGunner: 12,
  spawnWeightShielder: 9,
  spawnWeightBlinker: 10,
  spawnWeightConduit: 7,
  enemyBulletSpeed: 4.2,
  enemyBulletDamage: 12,
  lieutenantHpShare: 0.4,
  lieutenantMaxMods: 2,
  lieutenantFirstWave: 2,
  lieutenantDelay: 6,
  lieutenantCoreReward: 1,

  // 10. Deployables (mines, sentry turrets, escort drones; per-level numbers live in weapon-scaling.js)
  pierceFalloff: 0.7,
  splashEdgeFalloff: 0.4,
  deployableDamageMult: 1.0,
  mineArmTime: 0.6,
  droneFormationRadius: 54,

  // 11. Crits & Damage Types (run-start crit stats; status strengths scale the card values)
  baseCritChance: 0.05,
  baseCritDamage: 1.5,
  burnDamageMult: 1.0,
  chillSlowMult: 1.0,
  chillBossMult: 0.4,
  corrodeMult: 1.0,

  // 12. Leveling & Weapon Loadout (XP to next level = base + step per level, steeper from LV 20 / LV 40;
  // hand weights are relative: general upgrades weigh 1)
  xpCurveBase: 25,
  xpCurveStep: 16,
  xpCurveStepMid: 100,
  xpCurveStepLate: 60,
  weaponSlots: 6,
  newWeaponChance: 0.2,
  newWeaponPity: 6,
  weaponLevelWeight: 3,
  weaponLineWeight: 1.5,
  tagCardWeight: 0.7,
  evolutionWeight: 4,

  // 13. Difficulty Ramp (per-wave growth of enemy HP, spawn pressure, contact/orb damage and kill XP;
  // HP scale = (1 + waveHpPerWave·(w−1)) · waveHpGrowth^(w − waveHpGrowthFrom), bosses and lieutenants included)
  waveLength: 22,
  waveHpStart: 1,
  waveHpPerWave: 0.25,
  waveHpGrowth: 1.09,
  waveHpGrowthFrom: 6,
  spawnIntervalStart: 2.6,
  spawnIntervalPerWave: 0.14,
  spawnIntervalMin: 0.75,
  packSizeMult: 1.0,
  swarmPackPerWave: 2,
  swarmPackMax: 34,
  skirmishPackPerWave: 0.6,
  skirmishPackMax: 99,
  splitterPackPerWave: 0.4,
  splitterPackMax: 99,
  bossHpMult: 1,
  damageRampBase: 1,
  damageRampFrom: 5,
  damageRampPerWave: 0.08,
  xpPerWave: 0
};

export const TUNING_SCHEMA = [
  {
    group: '🦀 Crab Ship & Drill-Claws',
    items: [
      { key: 'shipRadius', label: 'Crab Ship Hull Size', type: 'range', min: 8, max: 34, step: 1, unit: 'px' },
      { key: 'moveSpeed', label: 'Base Move Speed', type: 'range', min: 2.0, max: 14.0, step: 0.2, unit: '' },
      { key: 'drillScale', label: 'Drill-Claw Size Scale', type: 'range', min: 0.5, max: 3.0, step: 0.05, unit: 'x' },
      { key: 'miningSpeed', label: 'Base Drill Mining DPS', type: 'range', min: 25, max: 600, step: 5, unit: '/s' },
      { key: 'miningRange', label: 'Drill-Claw Reach', type: 'range', min: 15, max: 140, step: 2, unit: 'px' },
      { key: 'dualClawBonus', label: 'Twin-Claw Torque Mult', type: 'range', min: 1.0, max: 3.0, step: 0.05, unit: 'x' },
      { key: 'carapaceColor', label: 'Crab Carapace Glow', type: 'color' },
      { key: 'innerArmorColor', label: 'Inner Shell Facet Color', type: 'color' },
      { key: 'drillIdleColor', label: 'Drill Bit Idle Color', type: 'color' },
      { key: 'drillActiveColor', label: 'Drill Bit Active Color', type: 'color' },
      { key: 'drillJawColor', label: 'Drill Jaw / Thread Color', type: 'color' }
    ]
  },
  {
    group: '🔫 Weapons & Shield Barrier',
    items: [
      { key: 'baseDamage', label: 'Base Blaster Damage', type: 'range', min: 2, max: 60, step: 1, unit: '' },
      { key: 'fireRate', label: 'Base Fire Rate', type: 'range', min: 1.5, max: 25, step: 0.5, unit: '/s' },
      { key: 'bulletSpeed', label: 'Projectile Velocity', type: 'range', min: 5, max: 32, step: 0.5, unit: '' },
      { key: 'bulletRadius', label: 'Projectile Thickness', type: 'range', min: 2.0, max: 12.0, step: 0.2, unit: 'px' },
      { key: 'bulletColorHue', label: 'Blaster Neon Hue', type: 'range', min: 0, max: 360, step: 2, unit: '°' },
      { key: 'shieldHue', label: 'Shield Barrier Hue', type: 'range', min: 0, max: 360, step: 2, unit: '°' },
      { key: 'shieldPadding', label: 'Shield Outline Padding (Hitbox)', type: 'range', min: 0.1, max: 1.2, step: 0.02, unit: 'x' },
      { key: 'shieldThickness', label: 'Shield Barrier Thickness', type: 'range', min: 0.2, max: 3.0, step: 0.05, unit: 'x' },
      { key: 'shieldRegenRate', label: 'Shield Passive Regen', type: 'range', min: 0, max: 15, step: 0.2, unit: 'HP/s' },
      { key: 'dashCooldownBase', label: 'Dash Cooldown', type: 'range', min: 0.2, max: 3.5, step: 0.05, unit: 's' }
    ]
  },
  {
    group: '🍀 Luck, Multi-Levels & Chests',
    items: [
      { key: 'baseLuck', label: 'Starting Base Luck', type: 'range', min: 0.2, max: 5.0, step: 0.05, unit: 'x' },
      { key: 'doubleLevelChance', label: '+2 Level (Uncommon) Roll Chance', type: 'range', min: 0, max: 0.35, step: 0.002, unit: 'prob' },
      { key: 'tripleLevelChance', label: '+3 Level (Rare) Roll Chance', type: 'range', min: 0, max: 0.15, step: 0.001, unit: 'prob' },
      { key: 'quadLevelChance', label: '+4 Level (Epic) Roll Chance', type: 'range', min: 0, max: 0.08, step: 0.0005, unit: 'prob' },
      { key: 'pentaLevelChance', label: '+5 Level (Legendary) Roll Chance', type: 'range', min: 0, max: 0.04, step: 0.0005, unit: 'prob' },
      { key: 'chestDropMult', label: 'Enemy Chest Drop Mult', type: 'range', min: 0, max: 10.0, step: 0.1, unit: 'x' },
      { key: 'goldVeinChestChance', label: 'Gold Vein Chest Chance', type: 'range', min: 0, max: 0.2, step: 0.002, unit: 'prob' },
      { key: 'chestDoubleChance', label: 'Chest 2x Jackpot Chance', type: 'range', min: 0, max: 0.6, step: 0.005, unit: 'prob' },
      { key: 'chestTripleChance', label: 'Chest 3x Jackpot Chance', type: 'range', min: 0, max: 0.4, step: 0.001, unit: 'prob' },
      { key: 'chestPentaChance', label: 'Chest 5x Mega Chance', type: 'range', min: 0, max: 0.2, step: 0.001, unit: 'prob' }
    ]
  },
  {
    group: '☄️ Asteroids, World & Economy',
    items: [
      { key: 'clusterCount', label: 'Asteroid Clusters (Respawn)', type: 'range', min: 5, max: 85, step: 1, unit: '' },
      { key: 'rockHpMult', label: 'Asteroid Rock HP Mult', type: 'range', min: 0.2, max: 4.0, step: 0.1, unit: 'x' },
      { key: 'rockSizeMult', label: 'Asteroid Rock Size Mult', type: 'range', min: 0.5, max: 2.2, step: 0.05, unit: 'x' },
      { key: 'magnetRadius', label: 'Base Geom Pickup Radius', type: 'range', min: 40, max: 500, step: 5, unit: 'px' },
      { key: 'xpMultiplier', label: 'XP Gain Multiplier', type: 'range', min: 0.2, max: 5.0, step: 0.1, unit: 'x' },
      { key: 'coreDropMult', label: 'Void Core Drop Mult', type: 'range', min: 0.2, max: 5.0, step: 0.1, unit: 'x' },
      { key: 'maxWaveCores', label: 'Max Wave Core Drops', type: 'range', min: 1, max: 20, step: 1, unit: '' }
    ]
  },
  {
    group: '🎵 Audio, Enemies & Visual FX',
    items: [
      { key: 'musicVolume', label: 'Music Master Volume', type: 'range', min: 0.0, max: 3.0, step: 0.05, unit: 'x' },
      { key: 'sfxVolume', label: 'SFX Volume', type: 'range', min: 0.0, max: 2.0, step: 0.02, unit: 'x' },
      { key: 'musicBpm', label: 'Synthwave Tempo (BPM)', type: 'range', min: 85, max: 180, step: 1, unit: 'BPM' },
      { key: 'screenShakeMult', label: 'Screen Shake Intensity', type: 'range', min: 0.0, max: 2.5, step: 0.1, unit: 'x' },
      { key: 'gridWarpMult', label: 'Neon Grid Warp Force', type: 'range', min: 0.0, max: 3.0, step: 0.1, unit: 'x' },
      { key: 'enemySpeedMult', label: 'Enemy Speed Multiplier', type: 'range', min: 0.4, max: 2.5, step: 0.05, unit: 'x' },
      { key: 'enemyHpMult', label: 'Enemy HP Multiplier', type: 'range', min: 0.3, max: 3.0, step: 0.1, unit: 'x' }
    ]
  },
  {
    group: '🌀 Gravity Wells & Singularities',
    items: [
      { key: 'blackholePullRadius', label: 'Vortex Pull Radius', type: 'range', min: 80, max: 400, step: 5, unit: 'px' },
      { key: 'blackholePlayerPull', label: 'Vortex Tug on Ship (capped)', type: 'range', min: 0, max: 1.0, step: 0.02, unit: 'px/t²' },
      { key: 'blackholeEnemyPull', label: 'Vortex Pull on Enemies', type: 'range', min: 0, max: 1.5, step: 0.02, unit: 'px/t²' },
      { key: 'blackholeBulletBend', label: 'Vortex Bullet Bending', type: 'range', min: 0, max: 1.0, step: 0.02, unit: 'px/t²' },
      { key: 'blackholePickupPull', label: 'Vortex Pull on Geoms', type: 'range', min: 0, max: 1.5, step: 0.02, unit: 'px/t²' },
      { key: 'singularityPull', label: 'Vortex Singularity Pull', type: 'range', min: 0, max: 2.0, step: 0.05, unit: 'px/t²' },
      { key: 'singularityCollapseMult', label: 'Singularity Collapse Damage', type: 'range', min: 0.2, max: 4.0, step: 0.1, unit: 'x' }
    ]
  },
  {
    group: '⚠ Boss Encounters',
    items: [
      { key: 'bossWarningTime', label: 'Boss Warning Telegraph', type: 'range', min: 0.5, max: 8.0, step: 0.25, unit: 's' },
      { key: 'bossHitStop', label: 'Boss Kill Hit-Stop', type: 'range', min: 0, max: 0.5, step: 0.02, unit: 's' },
      { key: 'bossSlowMo', label: 'Boss Kill Half-Speed Slow-Mo', type: 'range', min: 0, max: 2.0, step: 0.05, unit: 's' }
    ]
  },
  {
    group: '💥 Hit Feedback & Damage Numbers',
    items: [
      { key: 'knockbackMult', label: 'Enemy Hit Knockback', type: 'range', min: 0.0, max: 3.0, step: 0.1, unit: 'x' },
      { key: 'hitStopMult', label: 'Big-Moment Hit-Stop (max 3 ticks)', type: 'range', min: 0.0, max: 2.0, step: 0.1, unit: 'x' },
      { key: 'damageNumberCap', label: 'Max Live Damage Numbers', type: 'range', min: 8, max: 120, step: 1, unit: '' },
      { key: 'damageNumberScale', label: 'Damage Number Text Size', type: 'range', min: 0.6, max: 2.0, step: 0.05, unit: 'x' }
    ]
  },
  {
    group: '👾 Enemy Variety & Lieutenants',
    items: [
      { key: 'spawnWeightSwarm', label: 'Pack Weight: Boid Swarm', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightSkirmish', label: 'Pack Weight: Pinwheels + Weavers', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightSplitter', label: 'Pack Weight: Splitters', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightBlackhole', label: 'Pack Weight: Vortex', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightBruiser', label: 'Pack Weight: Bruisers (wave 2+)', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightGunner', label: 'Pack Weight: Gunners (wave 3+)', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightShielder', label: 'Pack Weight: Shielders (wave 4+)', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightBlinker', label: 'Pack Weight: Blinkers (wave 5+)', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'spawnWeightConduit', label: 'Pack Weight: Conduit + Pack (wave 6+)', type: 'range', min: 0, max: 100, step: 1, unit: '' },
      { key: 'enemyBulletSpeed', label: 'Gunner Orb Speed', type: 'range', min: 1.5, max: 9.0, step: 0.1, unit: 'px/t' },
      { key: 'enemyBulletDamage', label: 'Gunner Orb Damage (pre-wave scaling)', type: 'range', min: 1, max: 40, step: 1, unit: '' },
      { key: 'lieutenantHpShare', label: 'Lieutenant HP (share of boss HP)', type: 'range', min: 0.1, max: 1.0, step: 0.05, unit: 'x' },
      { key: 'lieutenantMaxMods', label: 'Lieutenant Max Modifiers', type: 'range', min: 1, max: 2, step: 1, unit: '' },
      { key: 'lieutenantFirstWave', label: 'First Lieutenant Wave', type: 'range', min: 1, max: 10, step: 1, unit: '' },
      { key: 'lieutenantDelay', label: 'Lieutenant Arrival Into Wave', type: 'range', min: 0, max: 20, step: 0.5, unit: 's' },
      { key: 'lieutenantCoreReward', label: 'Lieutenant Void Core Reward', type: 'range', min: 0, max: 5, step: 1, unit: '' }
    ]
  },
  {
    group: '🛰 Deployables',
    items: [
      { key: 'pierceFalloff', label: 'Pierce Damage Kept per Enemy Behind', type: 'range', min: 0.2, max: 1, step: 0.05, unit: 'x' },
      { key: 'splashEdgeFalloff', label: 'Blast Damage Falloff at Edge', type: 'range', min: 0, max: 1, step: 0.05, unit: 'x' },
      { key: 'deployableDamageMult', label: 'Deployable Damage (mines/turrets/drones)', type: 'range', min: 0.2, max: 4.0, step: 0.1, unit: 'x' },
      { key: 'mineArmTime', label: 'Mine Arming Delay', type: 'range', min: 0.1, max: 2.0, step: 0.05, unit: 's' },
      { key: 'droneFormationRadius', label: 'Escort Drone Formation Spacing', type: 'range', min: 30, max: 120, step: 2, unit: 'px' }
    ]
  },
  {
    group: '🎯 Crits & Damage Types',
    items: [
      { key: 'baseCritChance', label: 'Base Crit Chance', type: 'range', min: 0, max: 0.5, step: 0.01, unit: 'prob' },
      { key: 'baseCritDamage', label: 'Base Crit Damage', type: 'range', min: 1.1, max: 4.0, step: 0.05, unit: 'x' },
      { key: 'burnDamageMult', label: 'Burn (Thermite) DoT Strength', type: 'range', min: 0, max: 4.0, step: 0.1, unit: 'x' },
      { key: 'chillSlowMult', label: 'Chill (Cryo) Slow Strength', type: 'range', min: 0, max: 2.0, step: 0.05, unit: 'x' },
      { key: 'chillBossMult', label: 'Chill Slow Applied to Bosses', type: 'range', min: 0, max: 1.0, step: 0.05, unit: 'x' },
      { key: 'corrodeMult', label: 'Corrode Damage-Taken / Stack', type: 'range', min: 0, max: 3.0, step: 0.1, unit: 'x' }
    ]
  },
  {
    group: '🎒 Leveling & Weapon Loadout',
    items: [
      { key: 'xpCurveBase', label: 'XP for Level 2', type: 'range', min: 2, max: 200, step: 1, unit: '' },
      { key: 'xpCurveStep', label: 'XP Step / Level (LV 1-19)', type: 'range', min: 0, max: 200, step: 1, unit: '' },
      { key: 'xpCurveStepMid', label: 'XP Step / Level (LV 20-39)', type: 'range', min: 0, max: 1500, step: 5, unit: '' },
      { key: 'xpCurveStepLate', label: 'XP Step / Level (LV 40+)', type: 'range', min: 0, max: 1500, step: 5, unit: '' },
      { key: 'weaponSlots', label: 'Weapon Slots', type: 'range', min: 2, max: 10, step: 1, unit: '' },
      { key: 'newWeaponChance', label: 'NEW WEAPON Card Chance / Hand', type: 'range', min: 0, max: 1, step: 0.01, unit: 'prob' },
      { key: 'newWeaponPity', label: 'NEW WEAPON Guaranteed Every N Hands', type: 'range', min: 1, max: 12, step: 1, unit: '' },
      { key: 'weaponLevelWeight', label: 'Owned Weapon Level-Up Weight', type: 'range', min: 0, max: 10, step: 0.25, unit: 'x' },
      { key: 'weaponLineWeight', label: 'Weapon-Specific Upgrade Weight', type: 'range', min: 0, max: 10, step: 0.25, unit: 'x' },
      { key: 'tagCardWeight', label: 'Tag Card Weight', type: 'range', min: 0, max: 10, step: 0.25, unit: 'x' },
      { key: 'evolutionWeight', label: 'Evolution Weight (x Luck)', type: 'range', min: 0, max: 20, step: 0.5, unit: 'x' }
    ]
  },
  {
    group: '📈 Difficulty Ramp',
    items: [
      { key: 'waveLength', label: 'Wave Length (bosses every 3 waves)', type: 'range', min: 8, max: 90, step: 1, unit: 's' },
      { key: 'waveHpStart', label: 'Enemy HP: Wave 1 Scale', type: 'range', min: 0.25, max: 6, step: 0.05, unit: 'x' },
      { key: 'waveHpPerWave', label: 'Enemy HP: Linear Growth / Wave', type: 'range', min: 0, max: 1, step: 0.01, unit: 'x' },
      { key: 'waveHpGrowth', label: 'Enemy HP: Compound Growth / Wave', type: 'range', min: 1, max: 1.2, step: 0.002, unit: 'x' },
      { key: 'waveHpGrowthFrom', label: 'Enemy HP: Compound Growth From Wave', type: 'range', min: 1, max: 80, step: 1, unit: '' },
      { key: 'spawnIntervalStart', label: 'Pack Spawn Interval at Wave 0', type: 'range', min: 0.3, max: 6, step: 0.05, unit: 's' },
      { key: 'spawnIntervalPerWave', label: 'Pack Spawn Interval Drop / Wave', type: 'range', min: 0, max: 0.5, step: 0.005, unit: 's' },
      { key: 'spawnIntervalMin', label: 'Pack Spawn Interval Floor', type: 'range', min: 0.2, max: 4, step: 0.05, unit: 's' },
      { key: 'packSizeMult', label: 'Pack Size Multiplier (all packs)', type: 'range', min: 0.25, max: 3, step: 0.05, unit: 'x' },
      { key: 'swarmPackPerWave', label: 'Boid Swarm: Extra Boids / Wave', type: 'range', min: 0, max: 6, step: 0.1, unit: '' },
      { key: 'swarmPackMax', label: 'Boid Swarm: Max Boids', type: 'range', min: 6, max: 80, step: 1, unit: '' },
      { key: 'skirmishPackPerWave', label: 'Skirmish Pack: Extra Hulls / Wave', type: 'range', min: 0, max: 2, step: 0.02, unit: '' },
      { key: 'skirmishPackMax', label: 'Skirmish Pack: Max Hulls', type: 'range', min: 3, max: 99, step: 1, unit: '' },
      { key: 'splitterPackPerWave', label: 'Splitter Pack: Extra Splitters / Wave', type: 'range', min: 0, max: 2, step: 0.02, unit: '' },
      { key: 'splitterPackMax', label: 'Splitter Pack: Max Splitters', type: 'range', min: 2, max: 99, step: 1, unit: '' },
      { key: 'bossHpMult', label: 'Boss HP (lieutenants follow)', type: 'range', min: 0.2, max: 4, step: 0.05, unit: 'x' },
      { key: 'damageRampBase', label: 'Contact/Orb Damage Before the Ramp', type: 'range', min: 0.2, max: 3, step: 0.05, unit: 'x' },
      { key: 'damageRampFrom', label: 'Contact/Orb Damage Ramp Starts After Wave', type: 'range', min: 0, max: 40, step: 1, unit: '' },
      { key: 'damageRampPerWave', label: 'Contact/Orb Damage Ramp / Wave', type: 'range', min: 0, max: 0.4, step: 0.005, unit: 'x' },
      { key: 'xpPerWave', label: 'Kill XP Growth / Wave', type: 'range', min: 0, max: 0.5, step: 0.005, unit: 'x' }
    ]
  }
];

export const TUNING = { ...DEFAULT_TUNING };

const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('vectra_tuning_sync') : null;

const schemaByKey = new Map(TUNING_SCHEMA.flatMap(group => group.items).map(item => [item.key, item]));

export function normalizeTuningValue(key, value) {
  const fallback = DEFAULT_TUNING[key];
  const schema = schemaByKey.get(key);
  if (typeof fallback === 'number') {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && !value.trim()) return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(schema.max, Math.max(schema.min, numeric));
  }
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeTuning(values) {
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  return Object.fromEntries(Object.keys(DEFAULT_TUNING).map(key => [key, normalizeTuningValue(key, source[key])]));
}

export function loadTuning() {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY);
    Object.assign(TUNING, normalizeTuning(raw ? JSON.parse(raw) : {}));
  } catch (e) {
    Object.assign(TUNING, DEFAULT_TUNING);
    console.warn('Failed to load tuning config:', e);
  }
  return TUNING;
}

export function saveTuning(notifyChannel = true) {
  try {
    localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(TUNING));
  } catch (e) {
    console.warn('Failed to save tuning config:', e);
  }
  listeners.forEach((fn) => fn(TUNING));
  if (notifyChannel && channel) {
    channel.postMessage({ type: 'TUNING_UPDATED', tuning: { ...TUNING } });
  }
}

export function updateTuningKey(key, value) {
  if (!Object.hasOwn(DEFAULT_TUNING, key)) return;
  TUNING[key] = normalizeTuningValue(key, value);
  saveTuning(true);
}

export function resetTuningToDefaults() {
  Object.assign(TUNING, DEFAULT_TUNING);
  saveTuning(true);
}

export function sendSandboxCommand(action) {
  if (channel) {
    channel.postMessage({ type: 'SANDBOX_ACTION', action });
  }
  listeners.forEach((fn) => fn(TUNING, action));
}

export function onTuningChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Compute compact diff of only modified values (plus full snapshot) for easy pasting to Agent
export function getAgentTuningPayload() {
  const changed = {};
  for (const k of Object.keys(DEFAULT_TUNING)) {
    if (TUNING[k] !== DEFAULT_TUNING[k]) {
      changed[k] = {
        from: DEFAULT_TUNING[k],
        to: TUNING[k]
      };
    }
  }
  return {
    project: 'VEXOLITH // SURVIVOR',
    modifiedCount: Object.keys(changed).length,
    changes: changed,
    fullTuning: { ...TUNING }
  };
}

if (channel) {
  channel.addEventListener('message', (ev) => {
    if (ev.data?.type === 'TUNING_UPDATED' && ev.data.tuning) {
      Object.assign(TUNING, normalizeTuning(ev.data.tuning));
      listeners.forEach((fn) => fn(TUNING));
    } else if (ev.data?.type === 'SANDBOX_ACTION') {
      listeners.forEach((fn) => fn(TUNING, ev.data.action));
    }
  });
}

window.addEventListener('storage', (ev) => {
  if (ev.key === TUNING_STORAGE_KEY) {
    loadTuning();
    listeners.forEach((fn) => fn(TUNING));
  }
});

loadTuning();
