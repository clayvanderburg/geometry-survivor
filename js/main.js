import { SpatialIndex } from './spatial-index.js';
import { FixedStepClock } from './clock.js';
import { drawPlayerShield, drawCrabShip, shieldTouches } from './ship-renderer.js';
import { WarpGrid } from './grid.js';
import { ParticleSystem } from './particles.js';
import { EnemyManager, BOSS_NAME, contactDamageAt, damageRampAt, waveScaleAt, xpScaleAt, spawnIntervalAt, LIGHT_ENEMY_TYPES } from './enemies.js';
import { pickWavePack, packRoster, hpBudgetScale } from './waves.js';
import { bossTier, isBossWave, bossesForWave, waveTheme, BOSS_SCHEDULE } from './wave-plan.js';
import { BOSS_DEFS, BOSS_TIER, bossDef, bossBuilt } from './bosses.js';
import { HOSTILE_INFO, HOSTILE_DEATH_TIER } from './hostiles.js';
import { SERPENT, spawnSerpent } from './serpents.js';
import { spawnWing } from './squadrons.js';
import { DamageNumbers } from './damage-numbers.js';
import { Deployables } from './deployables.js';
import { Grenades } from './grenades.js';
import { AsteroidManager } from './asteroids.js';
import { SoundEngine } from './audio.js';
import { readGamepad, MenuNavigator, PAD } from './gamepad.js';
import {
  UPGRADE_BY_ID, RARITY, rarityFor, rollUpgrades, rollLevelUpHand, cardInclusionOdds, rollWeaponPicks, applyUpgradeLevels, acquireWeapon,
  discardWeapon, snapshotBase, runStartPlayer, HIT_INVULN_BASE, xpToNextLevel, weaponUpgradeLines, applyBreakthrough, pendingBreakthroughs, markBreakthroughOffered
} from './upgrades.js';
import {
  WEAPON_SCALING as W, TAG_INFO, weaponDamage, prismStreams, missileBlastRadius, singularityPullRadius, novaRadius, tectonicBlastRadius,
  wingRocketBlastRadius, critChance, critMultiplier, blasterStreams, blasterFireRate, blasterPierce, DPS_TARGET, POTENTIAL_DPS
} from './weapon-scaling.js';
import { weaponBuild, levelBuild, milestonesCrossed, STAT_CARD_BY_ID, TRANSFORMS, BOOST_NAME, WEAPON_MAX_LEVEL, rdLine, RD_LINES } from './weapon-levels.js';
import { WeaponEffects } from './weapon-fx.js';
import { WEAPONS, STARTING_WEAPONS, WEAPON_BY_ID, PASSIVE_BY_ID, ownedWeapons, ownedPassives, passiveLevel, ownsWeapon, weaponSlots, weaponLevel, weaponTags, unownedWeapons } from './loadout.js';
import {
  DOT_SOURCES, damageTakenMult as statusTakenMult, isAfflicted, applyOnHitStatuses, updateStatusEffects, drawStatusEffects
} from './status-effects.js';
import {
  describeUpgrade, describeNewWeapon, describeWeaponPick, describeBreakthrough, renderUpgradeCard, COMPACT_MAX_ROWS, bonusLevels, bonusText
} from './upgrade-cards.js';
import { META_UPGRADES, ARMORY_CATEGORIES, ProgressionManager, formatArmoryValue } from './progression.js';
import { GOLD_ICON, goldPerVein, goldCoins, rerollCost, lockCost, banishCost, trySpend, refreshLockedCard, rollHandAround } from './gold.js';
import { GlobalLeaderboard, buildBoardView, renderBoardView, renderVersionOptions, renderModeOptions, syncTabButtons, describeSubmit, normalizeTab } from './leaderboard.js';
import { GAME_VERSION, versionLabel } from './version.js';
import { PatchNotesUI } from './patch-notes.js';
import { TutorialUI } from './tutorial.js';
import { SplashScreen } from './splash.js';
import { RunStats, buildSourceGroups, enemyKind } from './run-stats.js';
import { uploadRunStats, describeStatsUpload, readShareStats, writeShareStats, readPostGlobal, writePostGlobal, defaultStatsStorage } from './stats-client.js';
import { buildRunReport, renderRunReport, OTHER_GROUP_INFO } from './run-report.js';
import { statsSkipReason } from './stats-rules.js';
import { wellPullScale, singularityPullScale, playerPullCap, playerPullShare, SHIP_THRUST_PER_TICK } from './gravity.js';
import {
  ARCHETYPE_INFO, ARCHETYPE_DEATH_TIER, damageTakenMult as armorTakenMult, shieldBlocks, bounceFromShip, lieutenantTypes
} from './archetypes.js';
import { rollLieutenant, lieutenantModLabels, LIEUTENANT_WARMUP, LIEUTENANT_CARD_TIME } from './lieutenants.js';
import { pickSpawnPoint, pickOnscreenSpawn, packMemberPoint, spawnView, SPAWN_WARMUP } from './spawn-placement.js';
import { detectEncounters, hostileEntry } from './field-guide.js';
import { FieldGuideUI } from './field-guide-ui.js';
import { WeaponRange } from './weapon-range.js';
import { RangePanel } from './weapon-range-ui.js';
import { RunOverview, weaponChipsHtml, weaponReadout, weaponReadoutHtml, loadoutStripHtml } from './run-overview.js';
import { ShipPreview } from './ship-preview.js';
import {
  TUNING,
  DEFAULT_TUNING,
  TUNING_SCHEMA,
  PLAYER_SETTING_KEYS,
  updateTuningKey,
  resetTuningToDefaults,
  onTuningChange,
  getAgentTuningPayload,
  sendSandboxCommand,
  applyTuningOverlay,
  clearTuningOverlay,
  baseTuning
} from './config.js';
import { MODES, MODE_IDS, DEFAULT_MODE, modeRules, modeBonuses, normalizeMode, readStoredMode, writeStoredMode, cycleMode } from './modes.js';
import { TouchControls, KeyHintScrubber, isTouchDevice } from './touch-controls.js';

// Runs flown with dev-tuner changes aren't comparable, so they stay off the global board.
// Sector radar minimap: shown by default; the player's show/hide choice persists (storage may be blocked).
const RADAR_STORAGE_KEY = 'vexolith_radar';
const RADAR_BASE_SIZE = 152;
const RADAR_ROCK_STRIDE = { rock: 3, gold_vein: 1, shield_vein: 1, core_vein: 0 }; // bitmask: draw when (index & mask) === 0
const RADAR_ROCK_COLORS = [['rgba(0, 195, 255, 0.38)', ['rock', 'shield_vein']], ['#ffcc00', ['gold_vein']], ['#d68fff', ['core_vein']]];
const RADAR_SCALE = 2.5; // on-screen size vs the original 152 px radar
function loadRadarVisible() {
  try { return globalThis.localStorage?.getItem(RADAR_STORAGE_KEY) !== '0'; } catch { return true; }
}
// Radar side in px: 2.5x the original, but never more than 55% of the screen's short side (laptops, phones).
// Touch play passes a smaller share: the thumbs need that corner.
export function radarSize(width, height, shortShare = 0.55) {
  return Math.round(Math.min(RADAR_BASE_SIZE * RADAR_SCALE, shortShare * Math.min(width, height)));
}

const MAX_LOOSE_GEOMS = 400; // loose XP geoms on the field before the oldest start merging (see mergeLooseGeoms)

// Screens shorter than VIEW_MIN_SIDE px (on their short side) zoom out so a phone sees as much of the sector
// as a small laptop window: enemies spawn just off screen, so a tiny view would put them on top of the ship.
// Touch play zooms out a further 30% (TOUCH_VIEW_MIN_SIDE): thumbs cover part of the screen.
const VIEW_MIN_SIDE = 600;
const TOUCH_VIEW_MIN_SIDE = Math.round(VIEW_MIN_SIDE / 0.7);
export function viewScale(width, height, minSide = VIEW_MIN_SIDE) {
  const side = Math.min(width, height);
  return side > 0 ? Math.min(1, side / minSide) : 1;
}

// Player settings (pause-menu volume sliders) are tuning keys too, but changing them is fair play. A game
// mode's TUNING overlay (js/modes.js) isn't a change either: the check reads the tuning under it.
const PLAYER_SETTINGS = new Set(PLAYER_SETTING_KEYS);
const isTuningModified = () => {
  const base = baseTuning();
  return Object.keys(DEFAULT_TUNING).some(key => !PLAYER_SETTINGS.has(key) && base[key] !== DEFAULT_TUNING[key]);
};

// Run stats: damage stat ids -> weapon (by each weapon's tagSources) or another damage group.
const STAT_GROUPS = buildSourceGroups(WEAPONS);
// A weapon's level for the stats: its own level, or (Autocannon, which has none) 1 + its upgrade levels.
function statsWeaponLevel(p, id) {
  return weaponLevel(p, id) || 1 + weaponUpgradeLines(p, id).reduce((a, l) => a + (l.isSynergy ? 0 : l.level), 0);
}

// Final wind-up of a Vortex Singularity: pull tightens and a contracting ring telegraphs the implosion.
const SINGULARITY_IMPLODE_TIME = 0.35;
// Grid funnel depth (px at the core) for enemy black holes and player singularities.
const BLACKHOLE_GRID_DEPTH = 290;
// Rocket Pods converge on the aim line this far out when no enemy sits near the aim.
const ROCKET_CONVERGE = 320;
// `from` eased by `rate` of the shortest turn toward `to` (radians), for smoothly turning headings.
function turnToward(from, to, rate) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * rate;
}

// Autocannon tracers are drawn at this share of the shared bolt thickness (the hitbox is unchanged).
const AUTOCANNON_DRAW_WIDTH = 0.6;
// Music / SFX level sliders read as a percentage (TUNING level 1 = 100%), like MASTER VOLUME.
const levelPct = (v) => `${Math.round(Number(v) * 100)}%`;
// Cards in a level-up hand (the NEW WEAPON pick still offers 3 weapons, a Breakthrough 2 choices).
const HAND_SIZE = 4;
const SINGULARITY_GRID_DEPTH = 340;
// Swarm Missile colour: orange-gold, turning pink once Storm Protocol charges them with lightning.
const missileHue = (p) => (p.weapons.stormProtocol ? 325 : 42);

// Boss encounters: warning telegraph -> arrival title card -> HUD health bars -> defeat payoff.
const BOSS_RANKS = ['WARDEN', 'SENTINEL', 'TYRANT', 'SOVEREIGN', 'ANNIHILATOR'];
const BOSS_CARD_TIME = 2.8;
const BOSS_BAR_ROWS = 3;
const CHOICE_CLICK_GUARD_MS = 300; // level-up / weapon-pick cards ignore clicks this soon after appearing

// "WAVE 3 WARDEN", "WAVE 6 SENTINEL", ...: the rank climbs with each scheduled three-wave encounter.
export function bossEpithet(wave) {
  const rank = BOSS_RANKS[Math.max(0, Math.min(BOSS_RANKS.length - 1, Math.floor(wave / 3) - 1))];
  return `WAVE ${wave} ${rank}`;
}

const setHidden = (el, hidden) => {
  if (el) el.classList[hidden ? 'add' : 'remove']('hidden');
};

// Durability tiers: tougher hulls die harder so a pinwheel kill never reads like a swarmer pop.
// New archetypes take their tier from ARCHETYPE_DEATH_TIER; unknown types fall back to tier 1.
// Lieutenants always die as tier 3 (elite); anything flagged isBoss is tier 4.
const DEATH_TIER = { swarmer: 0, mini_splitter: 0, weaver: 1, pinwheel: 1, splitter: 2, blackhole: 3, boss: 4 };
const DEATH_FX = [
  { intensity: 0.8, shake: 0, hitStop: 0 },   // 0: swarm fodder — quick pop, no shake
  { intensity: 1.15, shake: 0, hitStop: 0 },  // 1: pinwheel/weaver — adds a white-hot core flash
  { intensity: 1.5, shake: 4, hitStop: 0 },   // 2: splitter — inner debris shatter + embers
  { intensity: 2.2, shake: 7, hitStop: 1 },   // 3: lieutenant (elite) — wide second ring
  { intensity: 3.0, shake: 18, hitStop: 3 }   // 4: boss — everything, plus a chroma flash
];
// Knockback impulses (px/tick for a 10px-radius hull; mass scales with radius²). Bosses are immune.
const KNOCKBACK = { blaster: 1.3, shrapnel: 0.8, lightning: 0.6, missile: 1.8, area: 1.6 };
// Weapon FX (visual/audio only): Tesla Arc hue, missile exhaust samples kept per missile.
const ARC_HUE = 275;
const MISSILE_TRAIL_LEN = 16;
const KNOCKBACK_MAX = 4;
const HIT_STOP_MAX_TICKS = 3;
// Sandbox buttons that drop one of each new archetype next to the ship.
const SANDBOX_ARCHETYPES = {
  SPAWN_BRUISER: 'bruiser', SPAWN_GUNNER: 'gunner', SPAWN_SHIELDER: 'shielder', SPAWN_BLINKER: 'blinker', SPAWN_CONDUIT: 'conduit',
  SPAWN_MAYFLY: 'mayfly', SPAWN_HULK: 'hulk', SPAWN_SERPENT: 'serpent', SPAWN_KESTREL: 'kestrel', SPAWN_CARRIER: 'carrier'
};
// Intel cards (NEW HOSTILE SIGNATURE) for every progressively introduced type.
const INTEL_INFO = { ...ARCHETYPE_INFO, ...HOSTILE_INFO };
// Pull radius of a gravity well: its own (the Event Horizon's) or the vortex tuning.
const pullRadiusOf = (w) => w.pullRadius ?? (TUNING.blackholePullRadius ?? 200);

// Field Guide: how long the in-run "FIELD GUIDE UPDATED" toast stays up, and how often (fixed ticks)
// the camera view is scanned for hostiles the player has never logged.
const GUIDE_TOAST_TIME = 2.8;
const GUIDE_SCAN_TICKS = 6;
const GUIDE_STATES = ['TITLE', 'PAUSED', 'GAMEOVER'];
// Screens with a PATCH NOTES button (the notes overlay closes itself if the state moves on).
const NOTES_STATES = ['TITLE', 'PAUSED'];
// Screens with a TUTORIAL button; the tutorial also opens by itself on the first LAUNCH on a device.
const TUTORIAL_STATES = ['TITLE', 'PAUSED'];

// Crits shove a little harder and flash a gold star flare sized to the target.
const CRIT_KNOCKBACK_MULT = 1.5;

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    // Touch play (js/touch-controls.js): on from the start on phones and tablets, switched on by any touch
    // and off again by a mouse click.
    this.touchMode = isTouchDevice();
    this.resize();

    // 10x Area Sector World (~4200 x 4200 units)
    this.worldWidth = 4200;
    this.worldHeight = 4200;
    this.camX = (this.worldWidth - this.width) * 0.5;
    this.camY = (this.worldHeight - this.height) * 0.5;

    this.sound = new SoundEngine();
    this.progression = new ProgressionManager();
    this.progression.onExternalChange = () => this.renderHubUI();
    this.grid = new WarpGrid(this.worldWidth, this.worldHeight, 68);
    this.particles = new ParticleSystem();
    this.particles.tuning = TUNING; // live vfxIntensity / vfxLinger knobs
    this.radarVisible = loadRadarVisible(); // sector radar minimap, toggled with [R] / controller Back
    this.enemyManager = new EnemyManager();
    this.damageNumbers = new DamageNumbers();
    this.asteroidManager = new AsteroidManager(this.worldWidth, this.worldHeight);
    this.enemyManager.terrain = this.asteroidManager;

    this.state = 'TITLE'; // TITLE, PLAYING, UPGRADE, CHEST, GAMEOVER
    this.autoFire = true;
    this.autoAim = false;

    this.keys = {};
    this.mouse = { x: this.width * 0.5, y: this.height * 0.5, down: false };
    this.shake = 0;
    this.chromaFlash = 0;
    this.hitStopTicks = 0;
    this.shieldRotation = 0;
    this.lastRunHighlightId = null;

    // Global leaderboard (/api/scores): GLOBAL tab by default, MY RUNS = the local board. Falls back
    // to the local board with an OFFLINE note when the function isn't reachable.
    this.globalBoard = new GlobalLeaderboard();
    this.boardTab = 'global';
    this.globalSubmit = null; // game-over uplink state, see describeSubmit()
    this.globalSubmitToken = null;
    this.lastGlobalRunId = null;
    this.runTainted = false; // dev tuner / sandbox touched this run
    // Anonymous run stats (js/run-stats.js): the RUN REPORT on game over and the opt-out upload.
    this.shareStats = readShareStats(defaultStatsStorage());
    this.postGlobal = readPostGlobal(defaultStatsStorage()); // title-screen checkbox: post runs to the GLOBAL board
    // Game mode (js/modes.js): the title-screen choice (remembered) and the mode of the run being flown.
    this.selectedMode = readStoredMode(defaultStatsStorage());
    this.mode = DEFAULT_MODE;
    this.globalBoard.setMode(this.selectedMode);
    this.statsUpload = null;
    this.statsUploadToken = null;
    this.goTab = 'report';

    // Controller state: previous-tick buttons for press edges, and DOM menu focus.
    this.gpButtons = [];
    this.gpActive = false;
    this.menuNav = new MenuNavigator();
    this.menuNav.onMove = () => this.sound?.playUiSelect?.();
    this.menuState = null;
    this.menuGrace = 0;

    // Touch sticks and buttons (shown only while a run is live), and the scrubber that drops keyboard hints.
    this.touch = new TouchControls(document.getElementById('touch-controls'), {
      onDash: () => this.state === 'PLAYING' && this.triggerDash(),
      onNova: () => this.state === 'PLAYING' && this.triggerSupernova(),
      onTouch: () => this.sound.init()
    });
    this.keyHints = new KeyHintScrubber(document.body);
    this.keyHints.setActive(this.touchMode);
    document.body?.classList?.toggle('touch-mode', this.touchMode);

    this.currentChoices = [];
    // Field Guide overlay (built on first open) sits on top of the title, pause or game-over screen.
    this.guideOpen = false;
    this.fieldGuide = null;
    // Patch notes overlay (title and pause). Never opens by itself: a NEW badge on its buttons says
    // when there are notes for a version the player hasn't read.
    this.notesOpen = false;
    this.patchNotes = new PatchNotesUI({ onClose: () => this.onNotesClosed() });
    // First-run tutorial (js/tutorial.js): opens on the first LAUNCH on a device (the run starts when it
    // closes; switched on by the browser boot, enableFirstLaunchTutorial), skippable on every slide,
    // replayed from the TUTORIAL buttons.
    // Splash screen (js/splash.js): the key art over everything when the game opens (showSplash).
    this.splashOpen = false;
    this.splash = new SplashScreen({ onDismiss: () => this.onSplashDismissed() });
    this.tutorialOpen = false;
    this.tutorialOnLaunch = false;
    this.tutorialLaunchAfter = false;
    this.tutorial = new TutorialUI({
      getInput: () => (this.gpActive ? 'pad' : this.touchMode ? 'touch' : 'keyboard'),
      onClose: (reason) => this.onTutorialClosed(reason),
      onGuide: () => this.openGuide()
    });
    this.renderVersionTags();
    // Weapon Range (title screen): a sandbox run with a config panel, target dummies and a DPS readout.
    this.range = new WeaponRange(this);
    this.range.view = new RangePanel(this.range);
    // Pause menu run overview (big ship, stats, upgrades) and the same ship idling on the title screen.
    this.overview = new RunOverview(this);
    this.titleShip = new ShipPreview(document.getElementById('title-ship-canvas'), { tuning: TUNING });
    this.hudHidden = false; // [H]: hide every HUD overlay for this session (not saved)
    this.quitConfirm = false; // pause menu MAIN MENU asks before abandoning the run
    this.bindEvents();
    this.resetRun();
    this.syncModeUI();
    this.renderHubUI();
    this.refreshGlobalBoard();
    this.initTunerDrawer();

    onTuningChange((_t, sandboxAction) => {
      this.applyLiveTuning(sandboxAction);
    });

    this.frameClock = new FixedStepClock(performance.now());
    requestAnimationFrame((t) => this.loop(t));
  }

  // A fresh run in `mode` (NORMAL unless startGame passes the title choice): its TUNING overlay goes on
  // before anything reads TUNING, and the mode's Void Armory bonuses (HARDCORE drops the shield bonus).
  resetRun(mode = DEFAULT_MODE) {
    this.resetInput();
    this.mode = normalizeMode(mode);
    applyTuningOverlay(modeRules(this.mode).tuning);
    const bonuses = modeBonuses(this.progression.getBonuses(), this.mode);

    this.score = 0;
    this.runTainted = false;
    this.multiplier = 1.0;
    this.kills = 0;
    this.rocksMined = 0;
    this.sessionCores = 0;
    // Gold (per run, gold veins): spent on level-up rerolls and card locks (js/gold.js).
    this.gold = Math.round(bonuses.startGold || 0); // Void Armory: Prospector Stake
    this.goldEarned = 0;
    this.goldSpent = 0;
    this.handRerolls = 0; // rerolls of the current level-up hand (sets the next reroll's cost)
    this.handLock = null; // { card, slot }: the locked card in the hand on screen
    this.carriedLock = null; // locked card passed over: guaranteed in the next level-up hand
    this.handPhase = null; // 'hand' (rerolls and locks allowed), 'weapon' (the NEW WEAPON pick) or 'breakthrough'
    // Weapon milestones (LV 6 / 12 / 18) reached by a card, waiting for their BREAKTHROUGH choice, in order.
    this.breakthroughQueue = [];
    this.weaponFx = new WeaponEffects();
    this.breakthrough = null; // { weaponId, level } on screen
    this.rdLineIndex = Math.floor(Math.random() * RD_LINES.length);
    this.lockNote = '';
    this.coresDroppedThisWave = 0;
    this.elapsedTime = 0;
    this.wave = 1;
    this.waveTimer = 0;
    this.spawnCooldown = 0.6;
    this.pendingBossSpawns = [];
    this.bossCard = null;
    this.bossCardTimer = 0;
    this.hitStopTicks = 0;
    this.slowMoTicks = 0;
    this.bossFlash = 0;
    this.lieutenantWave = 0;
    this.ltCard = null;
    this.ltCardTimer = 0;
    this.seenArchetypes = new Set();
    this.guideToast = null;
    this.guideToastTimer = 0;
    this.guideScanTick = 0;

    const centerX = this.worldWidth * 0.5;
    const centerY = this.worldHeight * 0.5;

    this.player = {
      x: centerX,
      y: centerY,
      vx: 0,
      vy: 0,
      angle: 0,
      drillAngle: 0, // drill arms (point at the rock being drilled)
      hullAngle: 0, // hull, wings and rocket pods (face the direction of flight)
      drillSpin: 0,
      radius: TUNING.shipRadius,
      invuln: 0,
      dashTimer: 0,
      dashCooldown: 0,
      // Shield, bombs, Void Armory multipliers and stats: TUNING plus the armory (upgrades.js runStartPlayer).
      ...runStartPlayer(bonuses),
      mode: this.mode, // card pools read the mode's rules off the player (upgrades.js eligibleUpgrades)
      level: 1,
      xp: 0,
      xpToNext: xpToNextLevel(1),
      upgradeLevels: {},
      // Breakthroughs chosen per weapon at LV 6 / 12 / 18: { singularity: { 6: 'transform', 12: 'boost' } }.
      breakthroughs: {},
      breakthroughsOffered: {}, // milestones already shown, so none is ever offered twice
      // Equipped weapons in slot order (loadout.js); NEW WEAPON pity counter (upgrades.js rollLevelUpHand).
      loadout: [],
      newWeaponDrought: 0,
      banished: {}, // card ids banished with gold this run (never offered again)
      weapons: {
        rockets: 0,
        missiles: 0,
        orbitals: 0,
        lightning: 0,
        singularity: 0,
        shrapnel: 0,
        dashNova: 0,
        pulsarHelix: 0,
        stormProtocol: 0,
        tectonicBore: 0,
        mines: 0,
        turret: 0,
        drones: 0,
        grenades: 0,
        siegeBattery: 0,
        empGrenades: 0,
        thermite: 0,
        cryo: 0,
        nanite: 0,
        supercritical: 0
      }
    };

    // Run-start snapshot (discards rebuild from it), then the ship's starting weapons at LV 1.
    snapshotBase(this.player);
    for (const id of STARTING_WEAPONS) acquireWeapon(this.player, id);
    this.runStats = new RunStats({ version: GAME_VERSION, mode: this.mode, groups: STAT_GROUPS, dpsTarget: DPS_TARGET, onCurve: (id) => id in POTENTIAL_DPS });
    this.statsTick = 0;
    if (this.enemyManager) this.enemyManager.onSpawn = (e) => this.runStats?.enemySpawned(e, this.elapsedTime);
    this.syncRunStats();
    this.discardPending = null;
    this.discardBlocked = null;
    this.weaponBarHtml = null;

    this.camX = centerX - this.width * 0.5;
    this.camY = centerY - this.height * 0.5;

    this.particles.clear();
    this.damageNumbers?.clear();
    (this.deployables ||= new Deployables()).clear();
    (this.grenades ||= new Grenades()).clear();
    (this.weaponFx ||= new WeaponEffects()).clear();
    this.missileSalvos = 0;
    this.turretShots = 0;
    this.orbitalFlingTimer = 0;
    this.orbitalNovaTimer = 0;
    this.grid.reset();
    this.shake = 0;
    this.chromaFlash = 0;
    this.hitStopTicks = 0;
    this.fireAccumulator = 0;
    this.rocketTimer = 0.8;
    this.missileTimer = 0;
    this.lightningTimer = 0;
    this.singularityTimer = 0;
    this.helixAngle = 0;
    this.orbitalAngle = 0;
    this.bladeFlingTimer = this.bladeNovaTimer = undefined;
    this.bladeNovaHide = 0;
    this.statusStamp = 0;

    this.bullets = [];
    this.missiles = [];
    this.singularities = [];
    this.gravityWells = [];
    this.geoms = [];
    this.chests = []; // Vampire Survivors style Relic Supply Caches!

    this.enemyManager.clear();
    this.asteroidManager.generateSector(centerX, centerY);
    this.updateHUD();
  }

  // this.width / this.height are the view in world px (bigger than the window on small screens, see
  // viewScale); draw() scales them onto the canvas by renderScale.
  resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    // Touch screens draw sharper (up to 1.5 device px per CSS px): phones are dense, but pay for every pixel.
    const dpr = isTouchDevice() ? Math.min(1.5, window.devicePixelRatio || 1) : 1;
    this.viewScale = viewScale(vw, vh, this.touchMode ? TOUCH_VIEW_MIN_SIDE : VIEW_MIN_SIDE);
    this.width = vw / this.viewScale;
    this.height = vh / this.viewScale;
    this.renderScale = this.viewScale * dpr;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
  }

  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    document.body?.classList?.toggle('touch-mode', on);
    this.keyHints?.setActive(on);
    if (!on) {
      this.touch?.reset();
      this.closeMobileWindows();
    }
    this.resize();
    this.renderHandControls();
  }

  // Touch menus (title, pause, game over): a home view of big buttons, each opening one section of the
  // screen (leaderboard, armory, loadout...) as its own full-screen window with a BACK button.
  bindMobileMenus() {
    const doc = globalThis.document;
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll('[data-m-open]').forEach((btn) => btn.addEventListener('click', () => {
      const card = btn.closest('.modal-card');
      const section = card?.querySelector(`[data-m-section="${btn.dataset.mOpen}"]`);
      if (!section) return;
      if (btn.dataset.mTab) card.querySelector(btn.dataset.mTab)?.click();
      this.closeMobileWindows();
      if (!section.querySelector(':scope > .m-back')) {
        const back = doc.createElement('button');
        back.className = 'neon-btn m-back';
        back.textContent = '◀ BACK';
        back.addEventListener('click', () => this.closeMobileWindows());
        section.prepend(back);
      }
      section.classList.add('m-window');
      section.scrollTop = 0;
      this.sound?.playUiSelect?.();
    }));
    doc.querySelectorAll('[data-m-proxy]').forEach((btn) => btn.addEventListener('click', () => {
      doc.getElementById(btn.dataset.mProxy)?.click();
    }));
    doc.querySelectorAll('[data-fullscreen-btn]').forEach((btn) => btn.addEventListener('click', () => {
      const supported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
      if (supported) {
        this.toggleFullscreen();
        globalThis.screen?.orientation?.lock?.('landscape')?.catch?.(() => {});
      } else {
        btn.closest('.m-menu')?.querySelector('.m-fs-tip')?.classList.toggle('hidden');
      }
    }));
  }

  closeMobileWindows() {
    globalThis.document?.querySelectorAll?.('.m-window').forEach((el) => el.classList.remove('m-window'));
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setTouchMode(true);
      else if (e.pointerType === 'mouse') this.setTouchMode(false);
    }, true);

    const titleNameInput = document.getElementById('title-pilot-name');
    const goNameInput = document.getElementById('go-pilot-name');
    const saveNameBtn = document.getElementById('btn-save-name');

    if (titleNameInput) {
      titleNameInput.value = this.progression.data.pilotName;
      titleNameInput.addEventListener('input', () => {
        this.progression.setPilotName(titleNameInput.value);
      });
    }

    const commitGameOverName = () => {
      if (!goNameInput) return;
      const newName = this.progression.setPilotName(goNameInput.value);
      goNameInput.value = newName;
      if (titleNameInput) titleNameInput.value = newName;
      if (this.lastRunHighlightId) {
        this.progression.updateHighscoreName(this.lastRunHighlightId, newName);
      }
      this.renderHubUI();
      if (saveNameBtn) {
        saveNameBtn.textContent = 'SAVED ✓';
        setTimeout(() => { saveNameBtn.textContent = 'SAVE'; }, 1200);
      }
    };

    if (saveNameBtn) {
      saveNameBtn.addEventListener('click', () => commitGameOverName());
    }

    document.querySelectorAll('[data-board-tab]').forEach((btn) => {
      btn.addEventListener('click', () => this.setBoardTab(btn.dataset.boardTab));
    });
    // Version selector buttons are re-rendered when the server reports new versions: delegate.
    document.querySelectorAll('[data-board-versions]').forEach((container) => {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-board-version]');
        if (btn) this.setBoardVersion(btn.dataset.boardVersion);
      });
    });
    // NORMAL / HARDCORE / BLITZ switch beside it (built on first render): delegate too.
    document.querySelectorAll('[data-board-modes]').forEach((container) => {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-board-mode]');
        if (btn) this.setBoardMode(btn.dataset.boardMode);
      });
    });
    // Title-screen mode selector next to LAUNCH (js/modes.js).
    this.renderModeSelect();
    document.getElementById('mode-select')?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-game-mode]');
      if (!btn) return;
      this.sound.playUiSelect?.();
      this.setSelectedMode(btn.dataset.gameMode);
    });
    if (goNameInput) {
      goNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitGameOverName();
          goNameInput.blur();
        }
      });
    }

    document.getElementById('btn-claim-chest').addEventListener('click', () => {
      this.closeChestModal();
    });

    window.addEventListener('keydown', (e) => {
      // Any key on the splash screen just continues to the title.
      if (this.splashOpen) {
        if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return; // browser shortcuts still work
        if (['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (!e.repeat) this.splash.dismiss();
        return;
      }
      const focused = document.activeElement;
      const editingText = focused && (focused.isContentEditable || focused.tagName === 'TEXTAREA' ||
        (focused.tagName === 'INPUT' && !['range', 'color', 'button', 'checkbox', 'radio'].includes(focused.type)));
      if (editingText) return;
      if (focused?.type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        if (this.state !== 'PLAYING') return;
        e.preventDefault();
      }
      // Space on a focused button/link activates that control instead of a menu shortcut.
      const onControl = focused && (focused.tagName === 'BUTTON' || focused.tagName === 'A' || (focused.tagName === 'INPUT' && focused.type === 'checkbox'));

      if (this.tutorialOpen) {
        this.handleTutorialKey(e, onControl);
        return;
      }
      if (this.guideOpen) {
        this.handleGuideKey(e, onControl);
        return;
      }
      if (this.notesOpen) {
        this.handleNotesKey(e, onControl);
        return;
      }
      if (this.range?.view?.handleKey(e)) return;

      this.sound.init();
      const code = e.code;
      this.keys[code] = true;
      // Held movement is stateful; abilities and toggles fire only on the initial press.
      if (e.repeat) return;

      // [V] toggles fullscreen on every screen; [H] hides the HUD during a run (also from pause and level-ups).
      if (code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.toggleFullscreen();
        return;
      }
      if (code === 'KeyH' && ['PLAYING', 'PAUSED', 'UPGRADE', 'CHEST'].includes(this.state)) {
        this.toggleHud();
        return;
      }

      // [G] opens the Field Guide from the title, pause and game-over screens (and pauses a live run).
      if (code === 'KeyG' && (this.state === 'PLAYING' || GUIDE_STATES.includes(this.state))) {
        e.preventDefault();
        if (this.state === 'PLAYING') this.togglePause();
        this.openGuide();
        return;
      }

      if (this.state === 'TITLE' && code === 'Space' && !onControl) {
        e.preventDefault();
        this.startGame();
        return;
      }
      // [1] [2] [3] pick NORMAL / HARDCORE / BLITZ on the title screen.
      const modeKey = this.state === 'TITLE' && /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (modeKey && MODE_IDS[Number(modeKey[1]) - 1]) {
        this.setSelectedMode(MODE_IDS[Number(modeKey[1]) - 1]);
        return;
      }

      if (this.state === 'CHEST' && (code === 'Space' || code === 'Enter')) {
        e.preventDefault();
        this.closeChestModal();
        return;
      }

      if (this.state === 'GAMEOVER' && code === 'Space' && !onControl) {
        e.preventDefault();
        commitGameOverName();
        this.startGame();
        return;
      }

      if (this.state === 'UPGRADE') {
        this.handleUpgradeKey(code, e.shiftKey);
        return;
      }

      if (this.state === 'PAUSED') {
        // The ABANDON RUN? confirm: Esc / P / Space back out of it (they don't resume yet).
        if (this.quitConfirm && (code === 'KeyP' || code === 'Escape' || (code === 'Space' && !onControl))) {
          e.preventDefault();
          this.cancelAbandonRun();
          return;
        }
        if (code === 'KeyP' || code === 'Escape' || (code === 'Space' && !onControl)) {
          e.preventDefault();
          this.togglePause();
          return;
        }
        const tab = /^(?:Digit|Numpad)([1-4])$/.exec(code);
        if (tab && this.overview) {
          this.overview.setTab(this.overview.tabs()[Number(tab[1]) - 1] || this.overview.tab);
          return;
        }
        if (code === 'KeyN') {
          this.toggleDamageNumbers();
          return;
        }
        if (code === 'KeyR') {
          this.toggleRadar();
          return;
        }
      }

      if (this.state === 'PLAYING') {
        if (code === 'KeyP' || code === 'Escape') {
          e.preventDefault();
          this.togglePause();
          return;
        }
        if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') {
          e.preventDefault();
          this.triggerDash();
        }
        if (code === 'KeyE' || code === 'KeyQ') {
          this.triggerSupernova();
        }
        if (code === 'KeyF') {
          this.toggleAutoFire();
        }
        if (code === 'KeyC') {
          this.toggleAutoAim();
        }
        if (code === 'KeyM') {
          this.toggleAudio();
        }
        if (code === 'KeyN') {
          this.toggleDamageNumbers();
        }
        if (code === 'KeyR') {
          this.toggleRadar();
        }
      }

      // Dev tuner: hidden from players, opened only with Shift+Alt+T (Shift+Option+T on Mac).
      if (code === 'KeyT' && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.toggleTunerDrawer();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    const releaseInput = () => {
      this.frameClock?.reset(performance.now());
      this.resetInput();
      if (this.state === 'PLAYING') this.togglePause();
    };
    window.addEventListener('blur', releaseInput);
    window.addEventListener('focus', () => this.frameClock?.reset(performance.now()));
    document.addEventListener('visibilitychange', () => {
      this.frameClock?.reset(performance.now());
      if (document.hidden) releaseInput();
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX / (this.viewScale || 1);
      this.mouse.y = e.clientY / (this.viewScale || 1);
      // Deliberate mouse use hands aiming and menu focus back from the controller.
      if (this.gpActive && Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0) > 3) {
        this.gpActive = false;
        this.menuNav?.clear();
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'BUTTON' ||
          e.target.closest('#tuner-drawer') ||
          e.target.closest('#range-panel') ||
          e.target.closest('.hud-vol-pill'))
      ) {
        return;
      }
      this.sound.init();
      if (e.button === 0) this.mouse.down = true;
      if (this.state === 'PLAYING') {
        if (e.button === 2) this.triggerDash();
        if (e.button === 1) {
          e.preventDefault();
          this.triggerSupernova();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.getElementById('btn-start-game').addEventListener('click', () => {
      if (titleNameInput) this.progression.setPilotName(titleNameInput.value);
      this.sound.init();
      this.startGame();
    });

    document.getElementById('btn-weapon-range')?.addEventListener('click', () => {
      this.sound.init();
      this.range.enter();
    });
    document.getElementById('btn-pause-exit-range')?.addEventListener('click', () => this.range.exit());

    document.getElementById('btn-restart-game').addEventListener('click', () => {
      commitGameOverName();
      this.sound.init();
      this.startGame();
    });

    document.getElementById('btn-autofire').addEventListener('click', () => this.toggleAutoFire());
    document.getElementById('btn-autoaim').addEventListener('click', () => this.toggleAutoAim());
    document.getElementById('btn-sound').addEventListener('click', () => this.toggleAudio());

    const pauseBtn = document.getElementById('btn-pause');
    const resumeBtn = document.getElementById('btn-resume-game');
    const pauseRestartBtn = document.getElementById('btn-pause-restart');
    const pauseDmgNumsBtn = document.getElementById('btn-pause-dmgnums');

    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());
    if (pauseRestartBtn) pauseRestartBtn.addEventListener('click', () => this.startGame());
    // MAIN MENU: from pause it abandons the run (after a confirm); after a game over the run is already recorded.
    document.getElementById('btn-pause-menu')?.addEventListener('click', () => this.askAbandonRun());
    document.getElementById('btn-quit-confirm')?.addEventListener('click', () => this.abandonRun());
    document.getElementById('btn-quit-cancel')?.addEventListener('click', () => this.cancelAbandonRun());
    document.getElementById('btn-go-menu')?.addEventListener('click', () => {
      commitGameOverName();
      this.returnToTitle();
    });
    for (const id of ['btn-hud', 'btn-pause-hud', 'hud-hidden-hint']) document.getElementById(id)?.addEventListener('click', () => this.toggleHud());
    for (const id of ['btn-fullscreen', 'btn-pause-fullscreen']) document.getElementById(id)?.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.syncFullscreenButtons());
    document.addEventListener('webkitfullscreenchange', () => this.syncFullscreenButtons());
    this.syncHudButtons();
    this.bindMobileMenus();
    this.syncFullscreenButtons();
    if (pauseDmgNumsBtn) pauseDmgNumsBtn.addEventListener('click', () => this.toggleDamageNumbers());
    document.getElementById('btn-pause-radar')?.addEventListener('click', () => this.toggleRadar());
    document.getElementById('btn-pause-stats')?.addEventListener('click', () => this.toggleShareStats());
    // Title-screen consent checkboxes (both start checked; unchecking is remembered).
    document.getElementById('chk-post-global')?.addEventListener('change', (e) => this.setPostGlobal(e.target.checked));
    document.getElementById('chk-share-stats')?.addEventListener('change', (e) => {
      if (e.target.checked !== this.shareStats) this.toggleShareStats();
    });
    document.querySelectorAll?.('[data-go-tab]').forEach((btn) => btn.addEventListener('click', () => this.setGameOverTab(btn.dataset.goTab)));
    document.getElementById('btn-reroll-hand')?.addEventListener('click', () => this.rerollHand());
    for (const id of ['btn-title-guide', 'btn-pause-guide', 'btn-go-guide']) {
      document.getElementById(id)?.addEventListener('click', () => this.openGuide());
    }
    for (const id of ['btn-title-notes', 'btn-pause-notes']) {
      document.getElementById(id)?.addEventListener('click', () => this.openNotes());
    }
    for (const id of ['btn-title-tutorial', 'btn-pause-tutorial']) {
      document.getElementById(id)?.addEventListener('click', () => this.openTutorial());
    }
    this.syncDamageNumbersButton();
    this.syncRadarButton();
    this.syncShareStatsButton();

    // Volume Sliders (HUD & Pause Menu)
    const hudVolSlider = document.getElementById('hud-volume-slider');
    const hudVolLabel = document.getElementById('hud-volume-label');
    const pauseVolSlider = document.getElementById('pause-volume-slider');
    const pauseVolLabel = document.getElementById('pause-volume-label');
    const pauseMusicSlider = document.getElementById('pause-music-slider');
    const pauseMusicLabel = document.getElementById('pause-music-label');
    const pauseSfxSlider = document.getElementById('pause-sfx-slider');
    const pauseSfxLabel = document.getElementById('pause-sfx-label');

    const syncMasterVolUI = (pct) => {
      this.sound.init();
      this.sound.setMasterVolume(pct);
      if (hudVolSlider && document.activeElement !== hudVolSlider) hudVolSlider.value = pct;
      if (pauseVolSlider && document.activeElement !== pauseVolSlider) pauseVolSlider.value = pct;
      if (hudVolLabel) hudVolLabel.textContent = `${pct}%`;
      if (pauseVolLabel) pauseVolLabel.textContent = `${pct}%`;
    };

    if (hudVolSlider) {
      hudVolSlider.value = this.sound.masterVolumePct;
      if (hudVolLabel) hudVolLabel.textContent = `${this.sound.masterVolumePct}%`;
      hudVolSlider.addEventListener('input', (e) => syncMasterVolUI(Number(e.target.value)));
    }
    if (pauseVolSlider) {
      pauseVolSlider.value = this.sound.masterVolumePct;
      if (pauseVolLabel) pauseVolLabel.textContent = `${this.sound.masterVolumePct}%`;
      pauseVolSlider.addEventListener('input', (e) => syncMasterVolUI(Number(e.target.value)));
    }
    if (pauseMusicSlider) {
      pauseMusicSlider.value = TUNING.musicVolume;
      if (pauseMusicLabel) pauseMusicLabel.textContent = levelPct(TUNING.musicVolume);
      pauseMusicSlider.addEventListener('input', (e) => {
        updateTuningKey('musicVolume', e.target.value);
        if (pauseMusicLabel) pauseMusicLabel.textContent = levelPct(e.target.value);
      });
    }
    if (pauseSfxSlider) {
      pauseSfxSlider.value = TUNING.sfxVolume;
      if (pauseSfxLabel) pauseSfxLabel.textContent = levelPct(TUNING.sfxVolume);
      pauseSfxSlider.addEventListener('input', (e) => {
        updateTuningKey('sfxVolume', e.target.value);
        if (pauseSfxLabel) pauseSfxLabel.textContent = levelPct(e.target.value);
      });
    }

    const closeTunerBtn = document.getElementById('btn-close-tuner');
    if (closeTunerBtn) closeTunerBtn.addEventListener('click', () => this.toggleTunerDrawer());
  }

  toggleTunerDrawer() {
    const drawer = document.getElementById('tuner-drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden');
  }

  initTunerDrawer() {
    const body = document.getElementById('drawer-tuner-body');
    if (!body) return;

    const fmt = (val, item) => {
      if (item.type === 'color') return String(val).toUpperCase();
      if (item.unit === 'prob') return `${(Number(val) * 100).toFixed(2)}%`;
      if (item.unit === 'onoff') return Number(val) >= 0.5 ? 'ON' : 'OFF';
      const dec = item.step < 0.01 ? 3 : item.step < 0.1 ? 2 : item.step < 1 ? 1 : 0;
      return `${Number(val).toFixed(dec)}${item.unit || ''}`;
    };

    body.innerHTML = '';
    TUNING_SCHEMA.forEach((group) => {
      const title = document.createElement('div');
      title.className = 'drawer-group-title';
      title.textContent = group.group;
      body.appendChild(title);

      group.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'drawer-row';
        const inputHtml = item.type === 'color'
          ? `<input type="color" id="drw-inp-${item.key}" value="${TUNING[item.key]}" />`
          : `<input type="range" id="drw-inp-${item.key}" min="${item.min}" max="${item.max}" step="${item.step}" value="${TUNING[item.key]}" />`;

        row.innerHTML = `
          <span>${item.label}</span>
          ${inputHtml}
          <span class="drawer-val" id="drw-val-${item.key}">${fmt(TUNING[item.key], item)}</span>
        `;
        body.appendChild(row);

        const inp = row.querySelector(`#drw-inp-${item.key}`);
        inp.addEventListener('input', (e) => {
          updateTuningKey(item.key, e.target.value);
        });
      });
    });

    const copyBtn = document.getElementById('btn-drawer-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const payload = getAgentTuningPayload();
        const text = `Here is my VEXOLITH // SURVIVOR tuning preset:\n\`\`\`json\n${JSON.stringify(
          payload.modifiedCount > 0 ? payload.changes : payload.fullTuning,
          null,
          2
        )}\n\`\`\``;
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = '✓ COPIED TO CLIPBOARD!';
        } catch {
          copyBtn.textContent = '✗ COPY FAILED';
        }
        setTimeout(() => { copyBtn.textContent = '📋 COPY TUNING FOR AGENT'; }, 1500);
      });
    }

    const resetBtn = document.getElementById('btn-drawer-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetTuningToDefaults();
      });
    }

    document.querySelectorAll('[data-sbx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sendSandboxCommand(btn.getAttribute('data-sbx'));
      });
    });
  }

  applyLiveTuning(sandboxAction = null) {
    if (this.state !== 'TITLE' && this.state !== 'GAMEOVER' && (sandboxAction || isTuningModified())) this.runTainted = true;
    this.sound.applyTuning();

    const p = this.player;
    if (p) {
      const bonuses = this.progression.getBonuses();
      const liveStats = (upgLv, weapons) => ({
        moveSpeed: TUNING.moveSpeed * bonuses.moveSpeedMult * Math.pow(1.16, upgLv.thrusters || 0),
        // Autocannon stat cards (Prism Split, Hyper-Capacitor, Phase Piercer) never touch base stats:
        // their ranks are read from the weapon build when firing, so the base stays tunable.
        fireRate: TUNING.fireRate * (weapons.pulsarHelix ? 1.15 : 1),
        bulletSpeed: TUNING.bulletSpeed,
        damage: TUNING.baseDamage * bonuses.damageMult * Math.pow(1.12, upgLv.overdrive || 0),
        magnetRadius: TUNING.magnetRadius * bonuses.magnetMult * Math.pow(1.65, upgLv.magnet || 0),
        xpMultiplier: TUNING.xpMultiplier * bonuses.xpMult * Math.pow(1.25, upgLv.magnet || 0),
        luck: TUNING.baseLuck + (bonuses.luckBonus || 0) + (upgLv.luck_boost || 0) * 0.25,
        coreDropMult: TUNING.coreDropMult * bonuses.coreMult,
        miningSpeed: TUNING.miningSpeed * (bonuses.miningMult || 1) * Math.pow(1.5, upgLv.mining_speed || 0) * (weapons.tectonicBore ? 1.9 : 1),
        miningRange: TUNING.miningRange * (bonuses.miningRangeMult || 1) * Math.pow(1.2, upgLv.mining_speed || 0) * (weapons.tectonicBore ? 1.3 : 1),
        drillScale: TUNING.drillScale * Math.pow(1.15, upgLv.mining_speed || 0) * (weapons.tectonicBore ? 1.25 : 1),
        // Crit base values are live too: tuned base + the same per-level steps the crit cards add.
        critChance: (TUNING.baseCritChance ?? 0.05) + (bonuses.critChanceBonus || 0) + (upgLv.crit_chance || 0) * W.critChanceStep + (weapons.supercritical ? W.supercritChance : 0),
        critDamage: (TUNING.baseCritDamage ?? 1.5) + (bonuses.critDamageBonus || 0) + (upgLv.crit_damage || 0) * W.critDamageStep
      });

      p.radius = TUNING.shipRadius;
      Object.assign(p.stats, liveStats(p.upgradeLevels || {}, p.weapons));
      // Weapon discards rebuild stats from the run-start snapshot, so it takes the tuned base values too.
      if (p.base) Object.assign(p.base.stats, liveStats({}, {}));
    }

    for (const key of ['musicVolume', 'sfxVolume']) {
      const id = key === 'musicVolume' ? 'music' : 'sfx';
      const slider = document.getElementById(`pause-${id}-slider`);
      const label = document.getElementById(`pause-${id}-label`);
      if (slider && document.activeElement !== slider) slider.value = TUNING[key];
      if (label) label.textContent = levelPct(TUNING[key]);
    }

    // Sync drawer UI readouts if open
    TUNING_SCHEMA.forEach((group) => {
      group.items.forEach((item) => {
        const inp = document.getElementById(`drw-inp-${item.key}`);
        const valEl = document.getElementById(`drw-val-${item.key}`);
        if (inp && document.activeElement !== inp) inp.value = TUNING[item.key];
        if (valEl) {
          if (item.type === 'color') valEl.textContent = String(TUNING[item.key]).toUpperCase();
          else if (item.unit === 'prob') valEl.textContent = `${(Number(TUNING[item.key]) * 100).toFixed(2)}%`;
          else if (item.unit === 'onoff') valEl.textContent = Number(TUNING[item.key]) >= 0.5 ? 'ON' : 'OFF';
          else {
            const dec = item.step < 0.01 ? 3 : item.step < 0.1 ? 2 : item.step < 1 ? 1 : 0;
            valEl.textContent = `${Number(TUNING[item.key]).toFixed(dec)}${item.unit || ''}`;
          }
        }
      });
    });

    if (sandboxAction && p) {
      if (sandboxAction === 'SPAWN_CHEST') {
        this.spawnRelicChest(p.x + Math.cos(p.angle) * 95, p.y + Math.sin(p.angle) * 95, false);
      } else if (sandboxAction === 'FORCE_LEVELUP' && this.state === 'PLAYING') {
        p.level++;
        p.xpToNext = xpToNextLevel(p.level);
        this.triggerLevelUp();
      } else if (sandboxAction === 'ADD_CORES') {
        this.sessionCores += 50;
        this.progression.addCores(50);
        this.renderHubUI();
        this.particles.spawnFloatText(p.x, p.y - 24, '+50 ❖ SANDBOX CORES!', '#d68fff', 15);
      } else if (sandboxAction === 'SPAWN_BOSS') {
        // Same warning -> entrance event as a scheduled boss; each press cycles to the next boss.
        const roster = [...Object.keys(BOSS_DEFS), 'boss'];
        const id = roster[(this.sandboxBossIndex = ((this.sandboxBossIndex ?? -1) + 1) % roster.length)];
        const bp = this.spawnPointOnscreen(40);
        if (!this.queueBossEncounter(bp, this.getWaveScale(), { id, wave: this.wave, epithet: id === 'boss' ? `WAVE ${this.wave} SANDBOX SIMULACRUM` : '' })) {
          this.showBanner('⚠ ENEMY CAP REACHED — BOSS NOT SPAWNED ⚠');
        }
      } else if (sandboxAction === 'SPAWN_BLACKHOLE') {
        const bp = this.spawnPointOnscreen(30);
        if (!this.enemyManager.queueSpawn('blackhole', bp.x, bp.y, this.getWaveScale(), this.placedSpawn(bp))) {
          this.showBanner('⚠ ENEMY CAP REACHED — VORTEX NOT SPAWNED ⚠');
        }
      } else if (sandboxAction === 'SPAWN_LIEUTENANT') {
        if (!this.spawnLieutenant(null, true)) this.showBanner('⚠ ENEMY CAP REACHED — LIEUTENANT NOT SPAWNED ⚠');
      } else if (SANDBOX_ARCHETYPES[sandboxAction]) {
        const type = SANDBOX_ARCHETYPES[sandboxAction];
        const bp = this.spawnPointOnscreen(30);
        const angle = Math.atan2(p.y - bp.y, p.x - bp.x);
        const ok = type === 'serpent'
          ? spawnSerpent(this.enemyManager, 'serpent', bp.x, bp.y, this.getWaveScale(type), SERPENT.segments, { angle, extra: this.placedSpawn(bp) })
          : type === 'kestrel'
            ? spawnWing(this.enemyManager, bp.x, bp.y, this.getWaveScale(type), 2, { angle, extra: this.placedSpawn(bp) }).length > 0
            : this.enemyManager.queueSpawn(type, bp.x, bp.y, this.getWaveScale(type), this.placedSpawn(bp));
        if (!ok) {
          this.showBanner(`⚠ ENEMY CAP REACHED — ${INTEL_INFO[type].label} NOT SPAWNED ⚠`);
        }
      } else if (sandboxAction === 'REGEN_ASTEROIDS') {
        this.asteroidManager.generateSector(p.x, p.y);
        this.particles.spawnFloatText(p.x, p.y - 24, '☄ ASTEROID SECTOR REGENERATED!', '#00ffaa', 15);
      } else if (sandboxAction === 'HEAL_FULL') {
        p.hp = p.maxHp;
        p.bombs = Math.min(9, p.bombs + 3);
        this.particles.spawnFloatText(p.x, p.y - 24, 'FULL SHIELD + 3 BOMBS!', '#00ff88', 15);
      }
    }

    this.updateHUD();
  }

  renderHubUI() {
    this.syncGuideBadges();
    this.syncNotesBadges();
    const cores = this.progression.data.cores;
    const hubCoresEl = document.getElementById('hub-cores-count');
    const goCoresEl = document.getElementById('go-cores-count');
    if (hubCoresEl) hubCoresEl.textContent = cores.toLocaleString();
    if (goCoresEl) goCoresEl.textContent = cores.toLocaleString();

    const titleNameInput = document.getElementById('title-pilot-name');
    if (titleNameInput && document.activeElement !== titleNameInput) {
      titleNameInput.value = this.progression.data.pilotName;
    }

    ['armory-grid', 'go-armory-grid'].forEach((gridId) => {
      const container = document.getElementById(gridId);
      if (container) this.renderArmory(container);
    });

    this.renderBoards();
  }

  // Void Armory panel: category tabs, the one-time reset notice and the upgrade cards (filtered by tab).
  // Buttons carry data-armory-key so controller focus survives the re-render after a purchase.
  renderArmory(container) {
    const prog = this.progression;
    const focusedKey = container.contains(this.menuNav?.focused) ? this.menuNav.focused.dataset?.armoryKey : null;
    this.armoryCat ||= 'all';
    container.innerHTML = '';

    let owned = 0, total = 0;
    for (const u of META_UPGRADES) { owned += prog.getRank(u.id); total += u.maxRank; }
    const tabs = document.createElement('div');
    tabs.className = 'armory-tabs';
    const tabDefs = [{ id: 'all', label: 'ALL', icon: '' }, ...ARMORY_CATEGORIES];
    tabs.innerHTML = tabDefs.map((c) => `<button class="armory-tab${this.armoryCat === c.id ? ' active' : ''}" data-armory-key="cat:${c.id}" aria-pressed="${this.armoryCat === c.id}">${c.icon ? c.icon + ' ' : ''}${c.label}</button>`).join('')
      + `<span class="armory-progress" title="Armory ranks owned">${((owned / total) * 100).toFixed(1)}% COMPLETE</span>`;
    tabs.querySelectorAll('[data-armory-key^="cat:"]').forEach((btn) => btn.addEventListener('click', () => {
      this.armoryCat = btn.dataset.armoryKey.slice(4);
      this.renderHubUI();
    }));
    container.appendChild(tabs);

    if (prog.data.armoryResetNotice) {
      const notice = document.createElement('div');
      notice.className = 'armory-notice';
      notice.innerHTML = `<b>VOID ARMORY REBUILT // RANKS AND CORES RESET</b>
        <span>The armory now has ${META_UPGRADES.length} single-stat upgrades with many more, smaller ranks. Everyone's ranks and Void Cores were reset; your callsign, high scores and Field Guide are kept.</span>
        <button class="armory-notice-ok" data-armory-key="notice">GOT IT</button>`;
      notice.querySelector('button').addEventListener('click', () => { prog.dismissArmoryNotice(); this.renderHubUI(); });
      container.appendChild(notice);
    }

    for (const upg of META_UPGRADES) {
      if (this.armoryCat !== 'all' && upg.cat !== this.armoryCat) continue;
      const rank = prog.getRank(upg.id);
      const isMax = rank >= upg.maxRank;
      const cost = prog.getUpgradeCost(upg);
      const canBuy = prog.canBuy(upg);
      const card = document.createElement('div');
      card.className = `armory-card${canBuy ? ' affordable' : ''}${isMax ? ' maxed' : ''}`;
      card.style.setProperty('--upg', upg.color);
      card.innerHTML = `
        <div class="armory-top">
          <span class="armory-name">${upg.icon} ${upg.name}</span>
          <span class="armory-rank">${rank}/${upg.maxRank}</span>
        </div>
        <div class="armory-desc">${formatArmoryValue(upg, 1)} ${upg.stat} per rank</div>
        <div class="armory-value">${isMax ? `<b>${formatArmoryValue(upg, rank)}</b> · MAXED` : `${formatArmoryValue(upg, rank)} → <b>${formatArmoryValue(upg, rank + 1)}</b>`}</div>
        <div class="armory-bar"><i style="width:${(rank / upg.maxRank) * 100}%"></i></div>
        <button class="armory-buy-btn" data-armory-key="buy:${upg.id}" ${!canBuy ? 'disabled' : ''}>${isMax ? 'MAX RANK' : `❖ ${cost.toLocaleString()}`}</button>`;
      if (canBuy) {
        card.addEventListener('click', () => {
          this.sound.init();
          if (prog.buyUpgrade(upg.id)) {
            this.sound.playLevelUp();
            this.renderHubUI();
          }
        });
      }
      container.appendChild(card);
    }

    if (focusedKey) {
      const again = container.querySelector(`[data-armory-key="${focusedKey}"]:not([disabled])`)
        || container.querySelector(`[data-armory-key^="cat:"].active`);
      if (again) this.menuNav.setFocus(again);
    }
  }

  // Both board panels (title + game over) share one tab and one view.
  renderBoards() {
    try {
      syncTabButtons(document.querySelectorAll('[data-board-tab]'), this.boardTab);
      const view = buildBoardView({
        tab: this.boardTab,
        board: this.globalBoard,
        local: this.progression.data.highscores,
        pilotName: this.progression.data.pilotName,
        newGlobalId: this.lastGlobalRunId,
        newLocalId: this.lastRunHighlightId
      });
      renderBoardView(document.getElementById('highscore-list'), document.getElementById('highscore-note'), view);
      renderBoardView(document.getElementById('go-highscore-list'), document.getElementById('go-board-note'), view);
      renderVersionOptions(document.getElementById('title-board-versions'), view.versions);
      renderVersionOptions(document.getElementById('go-board-versions'), view.versions);
      renderModeOptions(document.getElementById('title-board-modes'), view.modes);
      renderModeOptions(document.getElementById('go-board-modes'), view.modes);
      const rankEl = document.getElementById('go-global-rank');
      if (rankEl) {
        const { text, tone } = describeSubmit(this.globalSubmit);
        rankEl.textContent = text;
        rankEl.className = `go-global-rank tone-${tone}`;
      }
    } catch (err) {
      console.warn('Leaderboard render failed:', err);
    }
  }

  setBoardTab(tab) {
    this.boardTab = normalizeTab(tab);
    // Re-opening GLOBAL after a failed fetch tries the network again.
    if (this.boardTab === 'global' && this.globalBoard && this.globalBoard.status !== 'ready') this.refreshGlobalBoard();
    else this.renderBoards();
  }

  // GLOBAL board version selector: the current version (default), earlier versions with runs, or 'all'.
  setBoardVersion(version) {
    if (!this.globalBoard) return;
    const changed = this.globalBoard.setVersion(version);
    // Picking any version, even the one on screen, re-syncs it (and retries after a failed fetch).
    if (changed || this.globalBoard.status !== 'loading') this.refreshGlobalBoard();
  }

  // Leaderboard mode switch (GLOBAL and MY RUNS): NORMAL, HARDCORE or BLITZ boards, keeping the version.
  setBoardMode(mode) {
    if (!this.globalBoard) return;
    const changed = this.globalBoard.setMode(mode);
    if (changed || this.globalBoard.status !== 'loading') this.refreshGlobalBoard();
  }

  // --- Game mode (js/modes.js) ---------------------------------------------------------------------

  // The title-screen choice: remembered on this device, and the board panel follows it so the player
  // sees the races of the mode they are about to fly.
  setSelectedMode(mode) {
    this.selectedMode = normalizeMode(mode);
    writeStoredMode(defaultStatsStorage(), this.selectedMode);
    this.syncModeUI();
    this.setBoardMode(this.selectedMode);
  }

  // Title selector buttons, built from the MODES table.
  renderModeSelect() {
    const container = globalThis.document?.getElementById('mode-select');
    if (!container) return;
    container.innerHTML = MODE_IDS.map((id) => `<button type="button" class="mode-opt mode-${id}" data-game-mode="${id}" role="radio" aria-checked="false"
      title="${MODES[id].blurb}"><span class="mode-opt-name">${MODES[id].label}</span><span class="mode-opt-sub">${MODES[id].tagline}</span></button>`).join('');
  }

  // The selector's checked mark and the HUD badge (HARDCORE / BLITZ runs only; never in the Weapon Range).
  syncModeUI() {
    const doc = globalThis.document;
    if (!doc?.querySelectorAll) return;
    for (const btn of doc.querySelectorAll('[data-game-mode]')) {
      const on = btn.dataset.gameMode === this.selectedMode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    const badge = doc.getElementById('mode-hud-badge');
    if (badge) {
      const rules = modeRules(this);
      badge.textContent = rules.badge;
      badge.className = `mode-badge mode-${rules.id}${rules.badge ? '' : ' hidden'}`;
      badge.title = rules.blurb;
    }
  }

  refreshGlobalBoard() {
    if (!this.globalBoard) return;
    const pending = this.globalBoard.refresh();
    this.renderBoards();
    pending.then(() => this.renderBoards());
  }

  // Fire-and-forget: the game-over screen shows UPLINKING... and then the global rank (or why not).
  submitGlobalRun(run) {
    this.lastGlobalRunId = null;
    if (!this.globalBoard) return;
    if (this.range?.active) return; // Weapon Range runs are never posted
    const token = {};
    this.globalSubmitToken = token; // a late answer for an earlier run is ignored
    if (this.postGlobal === false) {
      this.globalSubmit = { reason: 'optout' };
      return;
    }
    if (this.runTainted || isTuningModified()) {
      this.globalSubmit = { reason: 'tainted' };
      return;
    }
    this.globalSubmit = { pending: true };
    this.globalBoard.submit(run).then((result) => {
      if (this.globalSubmitToken !== token) return;
      this.globalSubmit = result;
      if (result.ok) this.lastGlobalRunId = result.id;
      // The answer carries the run's own version board (of its mode); another board on screen (e.g.
      // ALL-TIME) is re-read so the new run shows up there too.
      const shown = this.globalBoard.version === (result.version || 'all') && (!result.mode || this.globalBoard.mode === result.mode);
      if (result.ok && typeof this.globalBoard.refresh === 'function' && !shown) {
        this.refreshGlobalBoard();
      } else {
        this.renderBoards();
      }
    });
  }

  // --- Run stats (js/run-stats.js): level sampling, RUN REPORT, anonymous upload -----------------

  // Samples player and weapon levels (a few times a second during play, and at run start/end).
  syncRunStats() {
    const p = this.player;
    const rs = this.runStats;
    if (!rs || !p) return;
    rs.levelReached(p.level, this.elapsedTime);
    const levels = {};
    for (const id of ownedWeapons(p)) levels[id] = statsWeaponLevel(p, id);
    rs.sync(levels, this.elapsedTime, p.stats?.damage);
  }

  finishRunStats() {
    if (!this.runStats) return null;
    this.syncRunStats();
    const p = this.player;
    return this.runStats.finish({
      time: this.elapsedTime, wave: this.wave, level: p?.level ?? 1, score: this.score, kills: this.kills,
      died: !(p?.hp > 0), gold: { earned: this.goldEarned, spent: this.goldSpent },
      loadout: ownedWeapons(p || {}).map((id) => ({ id, lv: statsWeaponLevel(p, id) }))
    });
  }

  // Fire-and-forget like the leaderboard: opted-out, dev-tuner and very short runs are not sent.
  submitRunStats(summary) {
    if (this.range?.active) return; // ...nor uploaded
    const token = {};
    this.statsUploadToken = token; // a late answer for an earlier run is ignored
    const opts = { share: this.shareStats === true, tainted: this.runTainted || isTuningModified() };
    const skip = statsSkipReason({ ...opts, time: summary.time });
    this.statsUpload = skip ? { ok: false, reason: skip } : { pending: true };
    this.renderRunReportPanel();
    if (skip) return;
    uploadRunStats(summary, opts).then((result) => {
      if (this.statsUploadToken !== token) return;
      this.statsUpload = result;
      this.renderRunReportPanel();
    });
  }

  renderRunReportPanel() {
    const el = globalThis.document?.getElementById('go-run-report');
    if (!el || !this.lastRunSummary) return;
    const view = buildRunReport(this.lastRunSummary, {
      info: (id) => {
        const w = WEAPON_BY_ID[id] || PASSIVE_BY_ID[id];
        return w ? { name: w.hudName || w.name, color: w.color } : OTHER_GROUP_INFO[id] || { name: id, color: '#8ba3c7' };
      },
      enemyName: (kind) => hostileEntry(kind)?.name || String(kind).toUpperCase(),
      upload: describeStatsUpload(this.statsUpload)
    });
    renderRunReport(el, view);
  }

  // Game-over left panel: RUN REPORT (default) or ARMORY.
  setGameOverTab(tab) {
    this.goTab = tab === 'armory' ? 'armory' : 'report';
    const doc = globalThis.document;
    if (!doc?.querySelectorAll) return;
    for (const btn of doc.querySelectorAll('[data-go-tab]')) {
      const on = btn.dataset.goTab === this.goTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const pane of doc.querySelectorAll('[data-go-pane]')) pane.classList.toggle('hidden', pane.dataset.goPane !== this.goTab);
    const sub = doc.getElementById('go-left-sub');
    if (sub) sub.textContent = this.goTab === 'armory' ? 'Upgrade ship for next launch' : 'This run at a glance';
  }

  toggleShareStats() {
    this.shareStats = !this.shareStats;
    writeShareStats(defaultStatsStorage(), this.shareStats);
    this.syncShareStatsButton();
  }

  setPostGlobal(on) {
    this.postGlobal = !!on;
    writePostGlobal(defaultStatsStorage(), this.postGlobal);
    this.syncShareStatsButton();
  }

  syncShareStatsButton() {
    const post = globalThis.document?.getElementById('chk-post-global');
    if (post) post.checked = this.postGlobal !== false;
    const share = globalThis.document?.getElementById('chk-share-stats');
    if (share) share.checked = this.shareStats === true;
    const btn = globalThis.document?.getElementById('btn-pause-stats');
    if (!btn) return;
    btn.textContent = `📡 SHARE ANONYMOUS STATS: ${this.shareStats ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active', this.shareStats);
    btn.setAttribute?.('aria-pressed', String(this.shareStats));
  }

  toggleAutoFire() {
    this.autoFire = !this.autoFire;
    const btn = document.getElementById('btn-autofire');
    btn.textContent = `AUTO-FIRE: ${this.autoFire ? 'ON' : 'OFF'} [F]`;
    btn.classList.toggle('active', this.autoFire);
  }

  toggleAutoAim() {
    this.autoAim = !this.autoAim;
    const btn = document.getElementById('btn-autoaim');
    btn.textContent = `AUTO-AIM: ${this.autoAim ? 'ON' : 'OFF'} [C]`;
    btn.classList.toggle('active', this.autoAim);
  }

  toggleAudio() {
    this.sound.init();
    const on = this.sound.toggle();
    const btn = document.getElementById('btn-sound');
    btn.textContent = `AUDIO: ${on ? 'ON' : 'OFF'} [M]`;
    btn.classList.toggle('active', on);
  }

  toggleDamageNumbers() {
    this.damageNumbers.toggle();
    this.syncDamageNumbersButton();
  }

  toggleRadar() {
    this.radarVisible = !this.radarVisible;
    try { globalThis.localStorage?.setItem(RADAR_STORAGE_KEY, this.radarVisible ? '1' : '0'); } catch { /* storage blocked */ }
    this.syncRadarButton();
  }

  syncRadarButton() {
    const btn = globalThis.document?.getElementById('btn-pause-radar');
    if (!btn) return;
    btn.textContent = `🛰 SECTOR RADAR: ${this.radarVisible ? 'ON' : 'OFF'} [R]`;
    btn.classList.toggle('active', this.radarVisible);
    btn.setAttribute?.('aria-pressed', String(this.radarVisible));
  }

  syncDamageNumbersButton() {
    const btn = document.getElementById('btn-pause-dmgnums');
    if (!btn || !this.damageNumbers) return;
    const on = this.damageNumbers.enabled;
    btn.textContent = `🔢 DAMAGE NUMBERS: ${on ? 'ON' : 'OFF'} [N]`;
    btn.classList.toggle('active', on);
    btn.setAttribute?.('aria-pressed', String(on));
  }

  // [H]: hide every HUD overlay (bars, weapon slots, radar, buttons) to leave just the game view. A faint
  // "[H] SHOW HUD" hint stays so nobody gets stuck. Session only.
  toggleHud() {
    this.hudHidden = !this.hudHidden;
    this.syncHudButtons();
  }

  syncHudButtons() {
    const doc = globalThis.document;
    doc?.body?.classList.toggle('hud-hidden', !!this.hudHidden);
    const hint = doc?.getElementById('hud-hidden-hint');
    if (hint) {
      hint.classList.toggle('hidden', !this.hudHidden);
      // Restart the fade: fully visible for a moment, then it settles faint.
      hint.classList.remove('settled');
      clearTimeout(this.hudHintTimer);
      if (this.hudHidden) this.hudHintTimer = setTimeout(() => hint.classList.add('settled'), 2500);
    }
    const btn = doc?.getElementById('btn-pause-hud');
    if (btn) {
      btn.textContent = `▣ HUD: ${this.hudHidden ? 'HIDDEN' : 'SHOWN'} [H]`;
      btn.classList.toggle('active', !this.hudHidden);
      btn.setAttribute?.('aria-pressed', String(!this.hudHidden));
    }
  }

  // [V]: Fullscreen API on the whole page (vendor-prefixed fallback for older Safari).
  toggleFullscreen() {
    const doc = globalThis.document;
    if (!doc) return;
    const active = doc.fullscreenElement || doc.webkitFullscreenElement;
    try {
      const done = active
        ? (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc)
        : (doc.documentElement?.requestFullscreen || doc.documentElement?.webkitRequestFullscreen)?.call(doc.documentElement);
      done?.catch?.(() => {}); // refused (no user gesture, iframe policy): nothing to do
    } catch { /* not supported */ }
  }

  syncFullscreenButtons() {
    const doc = globalThis.document;
    if (!doc) return;
    const on = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    const supported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
    // The big touch-menu buttons: on iPhone (no element fullscreen) they explain Add to Home Screen instead,
    // and a game already launched from the home screen has no browser bar to hide.
    const standalone = !!(globalThis.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)')?.matches || globalThis.navigator?.standalone);
    doc.querySelectorAll?.('[data-fullscreen-btn]').forEach((btn) => {
      btn.textContent = on ? '⛶ EXIT FULLSCREEN' : supported ? '⛶ GO FULLSCREEN' : '⛶ FULL SCREEN';
      btn.classList.toggle('active', on);
      btn.classList.toggle('hidden', standalone && !on);
    });
    for (const [id, label] of [['btn-fullscreen', on ? '⛶ EXIT FULLSCREEN [V]' : '⛶ FULLSCREEN [V]'], ['btn-pause-fullscreen', `⛶ FULLSCREEN: ${on ? 'ON' : 'OFF'} [V]`]]) {
      const btn = doc.getElementById(id);
      if (!btn) continue;
      btn.textContent = label;
      btn.classList.toggle('active', on);
      btn.classList.toggle('hidden', !supported); // e.g. iPhone Safari has no element fullscreen
    }
  }

  // Pause menu MAIN MENU: the run in progress is abandoned (never recorded: no score, no leaderboard, no
  // run stats), so it asks first. The confirm swaps in for the action buttons, with focus on CANCEL.
  setQuitConfirm(on) {
    this.quitConfirm = !!on;
    const doc = globalThis.document;
    doc?.getElementById('pause-quit-confirm')?.classList.toggle('hidden', !this.quitConfirm);
    doc?.getElementById('pause-actions')?.classList.toggle('hidden', this.quitConfirm);
  }

  focusPauseButton(id) {
    const el = globalThis.document?.getElementById(id);
    if (!el) return;
    if (this.gpActive && this.menuNav) this.menuNav.setFocus(el);
    else el.focus?.();
  }

  askAbandonRun() {
    if (this.state !== 'PAUSED') return;
    this.setQuitConfirm(true);
    this.focusPauseButton('btn-quit-cancel');
  }

  cancelAbandonRun() {
    this.setQuitConfirm(false);
    this.focusPauseButton('btn-pause-menu');
  }

  abandonRun() {
    if (this.state !== 'PAUSED') return;
    this.setQuitConfirm(false);
    if (this.range?.active) this.range.exit();
    else this.returnToTitle();
  }

  resetInput() {
    this.keys = {};
    this.mouse.down = false;
    this.gpDashLatch = false;
    this.gpBombLatch = false;
    this.touch?.reset();
  }

  togglePause() {
    if (this.state !== 'PLAYING' && this.state !== 'PAUSED') return;
    const pauseModal = document.getElementById('pause-modal');
    const pauseBtn = document.getElementById('btn-pause');

    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.resetInput();
      this.mouse.down = false;
      this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
      this.discardPending = null;
      this.discardBlocked = null;
      this.renderLoadoutPanel();
      this.setQuitConfirm(false);
      if (pauseModal) pauseModal.classList.remove('hidden');
      this.overview?.open();
      if (pauseBtn) {
        pauseBtn.textContent = '▶ RESUME [P]';
        pauseBtn.classList.add('active');
      }
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
      if (pauseModal) pauseModal.classList.add('hidden');
      if (pauseBtn) {
        pauseBtn.textContent = '⏸ PAUSE [P]';
        pauseBtn.classList.remove('active');
      }
    }
  }

  startGame() {
    this.sound.init();
    // First LAUNCH on this device: the tutorial comes first, and the run starts when it closes.
    if (this.tutorialOnLaunch && this.state === 'TITLE' && !this.range?.active && this.tutorial?.shouldAutoOpen()
      && this.openTutorial({ launchAfter: true })) return;
    if (this.guideOpen) this.closeGuide();
    document.getElementById('title-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('upgrade-modal').classList.add('hidden');
    document.getElementById('chest-modal').classList.add('hidden');
    const pauseModal = document.getElementById('pause-modal');
    if (pauseModal) pauseModal.classList.add('hidden');
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.textContent = '⏸ PAUSE [P]';
      pauseBtn.classList.remove('active');
    }

    this.ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    this.ctx.fillStyle = '#030308';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // The Weapon Range ignores modes; a real run (and a restart) flies the title-screen choice.
    this.resetRun(this.range?.active ? DEFAULT_MODE : this.selectedMode);
    this.syncModeUI();
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: 0.35, muffled: false, boss: 0 });
    this.sound.setMusicScene?.('run');

    this.grid.applyImpulse(this.player.x, this.player.y, 48, 260, 188);
    this.grid.ripple?.(this.player.x, this.player.y, 240, 188);
    this.particles.spawnShockwave(this.player.x, this.player.y, 240, 188, 5, 0.5);
    this.sound.playLevelUp();
    if (this.range?.active) this.range.onRunStart();
    else this.spawnWavePack();
  }

  // Back to the title screen: leaving the Weapon Range, abandoning a paused run (nothing is recorded or
  // submitted: only triggerGameOver does that) or MAIN MENU after a game over (already recorded).
  returnToTitle() {
    this.state = 'TITLE';
    this.setQuitConfirm(false);
    globalThis.document?.activeElement?.blur?.();
    for (const id of ['pause-modal', 'upgrade-modal', 'chest-modal', 'gameover-modal']) document.getElementById(id)?.classList.add('hidden');
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.textContent = '⏸ PAUSE [P]';
      pauseBtn.classList.remove('active');
    }
    this.resetRun();
    this.syncModeUI();
    this.sound.setMusicState({ intensity: 0.3, muffled: true, boss: 0 });
    this.sound.setMusicScene?.('menu');
    this.renderHubUI();
    document.getElementById('title-modal')?.classList.remove('hidden');
  }

  showBanner(text) {
    const banner = document.getElementById('center-banner');
    banner.textContent = text;
    banner.classList.remove('hidden');
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.classList.add('hidden');
    }, 2200);
  }

  // HP scale for a spawn at the current wave; light fodder (LIGHT_ENEMY_TYPES) uses the lighter start.
  getWaveScale(type = null) {
    return waveScaleAt(this.wave, { light: !!type && LIGHT_ENEMY_TYPES.has(type) });
  }

  spawnRelicChest(x, y, guaranteedSuper = false) {
    this.chests.push({
      x,
      y,
      rotation: 0,
      guaranteedSuper
    });
    this.particles.spawnShockwave(x, y, 140, 48, 4, 0.45);
    this.particles.spawnFloatText(x, y - 18, '★ RELIC CACHE DROPPED! ★', '#ffcc00', 15);
  }

  openRelicChest(chest) {
    this.state = 'CHEST';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
    this.sound.playCacheFanfare?.(!!chest.guaranteedSuper);

    const luck = this.player.stats.luck || 1.0;
    const roll = Math.random();
    const superMult = chest.guaranteedSuper ? 2.5 : 1.0;

    // Roll Chest Jackpot Tier based on Luck — multi-upgrade jackpots are genuinely rare!
    let rewardCount = 1;
    let tierTitle = 'RELIC SUPPLY CACHE (1X)';
    let tierSub = '★ TACTICAL CACHE UNLOCKED ★';
    let bonusCores = 1;

    const pentaChance = Math.min(0.45, (TUNING.chestPentaChance ?? 0.003) * luck * superMult);
    const tripleChance = pentaChance + Math.min(0.65, (TUNING.chestTripleChance ?? 0.018) * luck * superMult);
    const doubleChance = tripleChance + Math.min(0.85, (TUNING.chestDoubleChance ?? 0.075) * luck * superMult);

    if (roll < pentaChance) {
      rewardCount = 5;
      tierTitle = '★ PENTA-CORE MEGA JACKPOT! (5X) ★';
      tierSub = '★★★ MYTHIC LUCK RESONANCE ★★★';
      bonusCores = 3;
    } else if (roll < tripleChance) {
      rewardCount = 3;
      tierTitle = '★ TRIPLE POWERUP JACKPOT! (3X) ★';
      tierSub = '★★ SUPER RELIC CACHE UNLOCKED ★★';
      bonusCores = 2;
    } else if (roll < doubleChance) {
      rewardCount = 2;
      tierTitle = '★ DOUBLE SUPPLY CACHE! (2X) ★';
      tierSub = '★ LUCKY CACHE UNLOCKED ★';
      bonusCores = 1;
    }

    // Heal shield (not in HARDCORE) & award bonus Void Cores
    const repairs = modeRules(this).shieldRepairs;
    if (repairs) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 45);
    this.sessionCores += bonusCores;
    this.progression.addCores(bonusCores);

    // Pick random available upgrades and install them through the same path as level-up picks.
    // Each card is described just before install, so it shows exactly what this cache changed.
    // 5x jackpots use compact cards (fewer stat rows, no summary) so both rows fit one screen.
    const compact = rewardCount > 3;
    const awarded = [];
    for (let i = 0; i < rewardCount; i++) {
      const pool = rollUpgrades(this.player, 3);
      if (pool.length === 0) break;
      const chosen = pool[0];
      awarded.push(describeUpgrade(this.player, chosen, compact ? COMPACT_MAX_ROWS : undefined));
      this.applyUpgrade(chosen);
    }

    document.getElementById('chest-tier-subtitle').textContent = tierSub;
    document.getElementById('chest-tier-title').textContent = tierTitle;
    document.getElementById('chest-bonus-desc').textContent =
      `+${bonusCores} ❖ Void Cores Banked · ${repairs ? '+45 Shield Repaired' : 'No Shield Repair (Hardcore)'} · ${awarded.length} System Upgrade${awarded.length > 1 ? 's' : ''} Installed!`;

    const gridEl = document.getElementById('chest-rewards-grid');
    gridEl.innerHTML = '';
    gridEl.classList[compact ? 'add' : 'remove']('compact');

    awarded.forEach((d, idx) => {
      const card = document.createElement('div');
      const view = renderUpgradeCard(d, `FREE #${idx + 1}`, true);
      card.className = `${view.className} installed`;
      card.innerHTML = view.html;
      gridEl.appendChild(card);
    });

    this.updateHUD();
    document.getElementById('chest-modal').classList.remove('hidden');
  }

  closeChestModal() {
    if (this.state !== 'CHEST') return;
    document.getElementById('chest-modal').classList.add('hidden');
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
    this.particles.spawnShockwave(this.player.x, this.player.y, 220, 48, 5, 0.45);
    // A cache card that took a weapon to LV 6 / 12 / 18 opens its Breakthrough right away.
    if (this.openNextBreakthrough()) return;
    this.processPendingLevelUps();
    this.updateHUD();
  }

  // Every broken rock comes through here: the ship's drill, or an elite grinding a path (rock.brokenBy
  // === 'elite'). Both get the same shatter effects, sound and ore drops (geoms, cores, gold-vein chest
  // roll) for the ship to collect. Only the ship's own drilling counts as rocks mined, heals from a
  // shield vein (an instant heal, not a pickup) or sets off the Tectonic Claw Bore blast.
  onRockShattered(rock) {
    const byElite = rock.brokenBy === 'elite';
    if (!byElite) this.rocksMined++;
    this.sound.playExplosion(0.95);
    this.particles.spawnPolygonShatter(rock.x, rock.y, rock.radius * 0.9, rock.sides, rock.rotation, rock.hue, 0.9);
    this.particles.spawnExplosionSparks(rock.x, rock.y, 20, rock.hue, 2, 10, 2.0);
    this.particles.spawnShockwave(rock.x, rock.y, rock.radius * 1.8, rock.hue, 2.5, 0.28);
    this.grid.applyImpulse(rock.x, rock.y, 22, 110, rock.hue);
    this.grid.ripple?.(rock.x, rock.y, rock.radius * 1.8, rock.hue);

    if (rock.oreType === 'gold_vein') {
      // Gold coins (currency, no XP): magnetized and collected like geoms, whoever broke the rock.
      const coins = goldCoins(Math.round(goldPerVein() * (this.player?.goldMult ?? 1)));
      const total = coins.reduce((a, b) => a + b, 0);
      this.particles.spawnFloatText(rock.x, rock.y - 12, `★ GOLD VEIN! +${total} ${GOLD_ICON}`, '#ffcc00', 14);
      for (const value of coins) {
        const ga = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 3.5;
        this.geoms.push({
          isCore: false,
          isGold: true,
          gold: value,
          x: rock.x,
          y: rock.y,
          vx: Math.cos(ga) * spd,
          vy: Math.sin(ga) * spd,
          xp: 0,
          rotation: Math.random() * Math.PI * 2,
          hue: 48,
          magnetized: false
        });
      }
      // Rare Luck chance to unearth a buried Relic Chest from a Gold Vein!
      if (Math.random() < (TUNING.goldVeinChestChance ?? 0.004) * this.player.stats.luck) {
        this.spawnRelicChest(rock.x, rock.y, false);
      }
    } else if (rock.oreType === 'shield_vein') {
      if (byElite) {
        this.particles.spawnFloatText(rock.x, rock.y - 12, 'SHIELD CRYSTAL CRUSHED', '#4a8f74', 12);
      } else if (!modeRules(this).shieldRepairs) {
        this.particles.spawnFloatText(rock.x, rock.y - 12, 'SHIELD CRYSTAL INERT // HARDCORE', '#4a8f74', 12);
      } else {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
        this.particles.spawnFloatText(rock.x, rock.y - 12, '+25 SHIELD CRYSTAL!', '#00ff88', 14);
      }
    } else if (rock.oreType === 'core_vein') {
      this.particles.spawnFloatText(rock.x, rock.y - 12, '❖ DEEP CORE VEIN!', '#d68fff', 15);
      this.geoms.push({
        isCore: true,
        coreAmount: 1,
        x: rock.x,
        y: rock.y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        xp: 4,
        rotation: 0,
        hue: 285,
        magnetized: true
      });
    } else if (Math.random() < 0.42) {
      this.geoms.push({
        isCore: false,
        x: rock.x,
        y: rock.y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        xp: 1,
        rotation: 0,
        hue: 185,
        magnetized: false
      });
    }

    // Tectonic Claw Bore synergy blasts nearby enemies when you drill a rock (does NOT mine other rocks)
    if (this.player.weapons.tectonicBore && !byElite) {
      const blast = tectonicBlastRadius(this.player);
      this.particles.spawnShockwave(rock.x, rock.y, blast, 48, 4.5, 0.35);
      this.damageEnemiesInRadius(rock.x, rock.y, blast, weaponDamage(this.player, 'tectonic'), 48, 'other', undefined, undefined, 'tectonic');
    }
  }

  triggerDash() {
    const p = this.player;
    if (p.dashCooldown > 0) return;

    p.dashTimer = 0.22;
    p.dashCooldown = W.dashCooldown(p.weapons.dashNova || 0, TUNING.dashCooldownBase ?? 1.5) * (p.dashCooldownMult ?? 1);
    p.dashCooldownDuration = p.dashCooldown;
    p.invuln = Math.max(p.invuln, 0.32);

    const moveAngle = (Math.abs(p.vx) + Math.abs(p.vy) > 0.2)
      ? Math.atan2(p.vy, p.vx)
      : p.angle;

    p.vx = Math.cos(moveAngle) * p.stats.moveSpeed * 3.1;
    p.vy = Math.sin(moveAngle) * p.stats.moveSpeed * 3.1;

    this.sound.playDash();
    this.grid.applyImpulse(p.x, p.y, 46, 180, 188);
    this.grid.ripple?.(p.x, p.y, 110, 188);
    this.particles.spawnShockwave(p.x, p.y, 110, 188, 3.5, 0.3);

    if (p.weapons.dashNova > 0) {
      const radius = novaRadius(p, p.weapons.dashNova);
      this.particles.spawnShockwave(p.x, p.y, radius, 160, 5, 0.4);
      this.damageEnemiesInRadius(p.x, p.y, radius, weaponDamage(p, 'nova', p.weapons.dashNova), 160, 'other', undefined, undefined, 'nova');
    }
  }

  triggerSupernova() {
    const p = this.player;
    if (p.bombs <= 0) return;
    p.bombs--;
    p.invuln = Math.max(p.invuln, 1.2);

    this.sound.playSupernova();
    this.addShake(22);
    this.chromaFlash = 0.75;
    this.requestHitStop(2);

    // Fixed world-space reach (the old 1920x1080 value) so window size and zoom don't change the blast.
    const maxR = 1430;
    this.particles.spawnShockwave(p.x, p.y, maxR, 190, 9, 0.7);
    this.particles.spawnShockwave(p.x, p.y, maxR * 0.55, 325, 6, 0.5);
    this.grid.applyImpulse(p.x, p.y, 110, maxR * 0.75, 325);
    this.grid.ripple?.(p.x, p.y, maxR, 190, 1.2);

    // The blast also wipes every hostile plasma orb in flight.
    this.enemyManager.enemyBullets?.clear();

    const enemies = this.enemyManager.enemies;
    for (const e of [...enemies].reverse()) {
      if (e.dead || e.deflect) continue; // armored bodies shrug it off (they die with their head)
      if (Math.hypot(e.x - p.x, e.y - p.y) > maxR * 1.15) continue;
      // Bosses, their mounted parts and lieutenants survive a supernova: it strips 40% of their max HP instead.
      if (e.isBoss || e.isLieutenant || e.mount) {
        const dmg = e.maxHp * 0.4;
        this.runStats?.damage('supernova', Math.min(dmg, Math.max(0, e.hp)));
        e.hp -= dmg;
        e.hitFlash = 1;
        e.sinceHit = 0; // counts as a hit, so a REGENERATING lieutenant's regen pauses too
        this.damageNumbers?.add(e, dmg, 'supernova');
        if (e.hp <= 0) this.killEnemy(e, true);
      } else {
        this.killEnemy(e, true);
      }
    }

    for (let i = 0; i < this.geoms.length; i++) {
      this.geoms[i].magnetized = true;
    }

    this.updateHUD();
  }

  // Weapons and explosions ONLY damage enemies — never asteroids!
  // `source` colours the damage numbers; `knock` is the radial knockback impulse at the blast.
  // Blasts deal full damage to anything touching the center and fade linearly toward the rim
  // (TUNING.splashEdgeFalloff: 0.4 = 60% at the edge), so a direct hit keeps the weapon's full
  // potential while crowds take less per head.
  // edgeFalloff: share of the damage lost at the rim (linear from the centre); defaults to splashEdgeFalloff.
  // stat: the run-stats id when it differs from `source` (e.g. 'collapse', 'nova'; js/run-stats.js).
  damageEnemiesInRadius(cx, cy, radius, dmg, hue = 190, source = 'other', knock = KNOCKBACK.area, edgeFalloff = TUNING.splashEdgeFalloff ?? 0.4, stat = source) {
    const enemies = this.enemyManager.enemies;
    for (const e of [...enemies].reverse()) {
      if (e.dead) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= (radius + e.radius) * (radius + e.radius)) {
        const d = Math.sqrt(dSq) || 1;
        const reach = Math.max(0, Math.min(1, (d - e.radius) / radius));
        this.hitEnemy(e, dmg * (1 - edgeFalloff * reach), source, (dx / d) * knock, (dy / d) * knock, 1, stat);
      }
    }
    // Every blast sends a ring wave through the grid, sized by its radius.
    this.grid.applyImpulse(cx, cy, 38, radius * 1.15, hue);
    this.grid.ripple?.(cx, cy, radius, hue);
  }

  // Single entry point for weapon damage: armor/Conduit links and corrosion, crit roll, HP, hit flash,
  // damage number, knockback, on-hit statuses and kill. (kx, ky) is a knockback impulse in px/tick
  // for a 10px-radius hull; heavier hulls move less. DoT ticks (DOT_SOURCES) never crit or re-apply
  // statuses. The damage number shows what actually landed. `stat` attributes the hit in the run
  // stats (js/run-stats.js) when it differs from `source` (sub-sources: helix, storm, collapse, ...).
  hitEnemy(e, dmg, source = 'blaster', kx = 0, ky = 0, flash = 1, stat = source) {
    const p = this.player;
    if (e.deflect) {
      // Armored hull (a serpent's body): the shot is stopped with a pale flash and does no damage.
      e.hitFlash = Math.max(e.hitFlash || 0, 0.35);
      return;
    }
    dmg *= armorTakenMult(e) * statusTakenMult(e);
    const dot = DOT_SOURCES[source] === true;
    const chance = dot || !p ? 0 : critChance(p);
    const crit = chance > 0 && Math.random() < chance;
    if (crit) {
      dmg *= critMultiplier(p, isAfflicted(e));
      kx *= CRIT_KNOCKBACK_MULT;
      ky *= CRIT_KNOCKBACK_MULT;
      this.onCriticalHit(e);
    }
    this.runStats?.damage(stat, Math.min(dmg, Math.max(0, e.hp)));
    if (this.range?.active) this.range.recordHit(stat, source, dmg);
    e.lastStat = stat;
    e.hp -= dmg;
    e.sinceHit = 0;
    e.hitFlash = Math.max(e.hitFlash || 0, crit ? 1 : flash);
    this.damageNumbers?.add(e, dmg, source, crit);
    if ((kx || ky) && !e.isBoss) {
      const k = (TUNING.knockbackMult ?? 1.0) * (e.knockMult ?? 1) * 100 / (e.radius * e.radius);
      let nx = (e.knockX || 0) + kx * k;
      let ny = (e.knockY || 0) + ky * k;
      const mag = Math.hypot(nx, ny);
      if (mag > KNOCKBACK_MAX) {
        nx *= KNOCKBACK_MAX / mag;
        ny *= KNOCKBACK_MAX / mag;
      }
      e.knockX = nx;
      e.knockY = ny;
    }
    if (e.hp <= 0) this.killEnemy(e);
    else if (!dot && p) applyOnHitStatuses(p, e, source);
  }

  // Crit feedback: a gold star flare on the hull plus a bright tick (the sound is throttled in audio.js).
  onCriticalHit(e) {
    this.particles.spawnCritFlare?.(e.x, e.y, 10 + e.radius * 0.9);
    this.sound.playCrit?.();
  }

  // Screen shake is reserved for heavy moments; every source goes through the user's multiplier.
  addShake(amount) {
    this.shake = Math.max(this.shake || 0, Math.min(24, amount) * (TUNING.screenShakeMult ?? 1.0));
  }

  // Freeze the simulation for a few fixed ticks (never more than 3) on big moments only.
  // consumeTimeDilation() spends these ticks alongside the boss-kill hit-stop and slow-mo.
  requestHitStop(ticks) {
    const want = Math.min(HIT_STOP_MAX_TICKS, Math.round(ticks * (TUNING.hitStopMult ?? 1.0)));
    this.hitStopTicks = Math.max(this.hitStopTicks || 0, want);
  }

  killEnemy(e, fromBomb = false) {
    const enemies = this.enemyManager.enemies;
    const enemyIndex = enemies.indexOf(e);
    if (enemyIndex === -1 || e.dead) return;

    e.dead = true;
    enemies.splice(enemyIndex, 1);
    this.kills++;
    if (this.runStats) {
      // Killing blow: the last hit, or a Supernova sweep / popping on the shield (which takes the rest).
      const by = fromBomb ? 'supernova' : e.hp <= 0 ? e.lastStat || 'other' : 'ram';
      if (e.hp > 0) this.runStats.damage(by, e.hp);
      this.runStats.kill(by, e, this.elapsedTime);
    }

    const tier = e.isBoss ? 4 : e.isLieutenant ? 3 : DEATH_TIER[e.type] ?? ARCHETYPE_DEATH_TIER[e.type] ?? HOSTILE_DEATH_TIER[e.type] ?? 1;
    const fx = DEATH_FX[tier];
    const intensity = fx.intensity;
    if (this.sound.playEnemyDeath) this.sound.playEnemyDeath(intensity);
    else this.sound.playExplosion(intensity);
    if (fx.shake > 0) this.addShake(fx.shake);
    if (fx.hitStop > 0) this.requestHitStop(fx.hitStop);

    this.particles.spawnPolygonShatter(e.x, e.y, e.radius, e.sides, e.rotation, e.hue, intensity);
    const sparkCount = fromBomb ? 18 : Math.floor(26 * intensity);
    this.particles.spawnExplosionSparks(e.x, e.y, sparkCount, e.hue, 2.5, 14 * Math.sqrt(intensity), 2.3);
    this.particles.spawnShockwave(e.x, e.y, 48 * intensity, e.hue, 3 * intensity, 0.34);
    this.grid.applyImpulse(e.x, e.y, 26 * intensity, 115 * intensity, e.hue);
    this.grid.ripple?.(e.x, e.y, 40 * intensity, e.hue);

    // Heavier hulls stack extra layers; supernova mass-kills skip them (except elites/bosses).
    if (!fromBomb || tier >= 3) {
      if (tier >= 1) this.particles.spawnShockwave(e.x, e.y, e.radius * 2.4, e.hue, 2 + tier, 0.16);
      if (tier >= 2) {
        this.particles.spawnPolygonShatter(e.x, e.y, e.radius * 0.55, e.sides, -e.rotation, e.hue, intensity * 0.55);
        this.particles.spawnExplosionSparks(e.x, e.y, 6 * tier, 48, 1.5, 6, 3.2);
      }
      if (tier >= 3) {
        this.particles.spawnShockwave(e.x, e.y, 110 * intensity, e.hue, 2.5 + tier, 0.65);
        this.chromaFlash = Math.max(this.chromaFlash || 0, tier === 4 ? 0.45 : 0.16);
      }
    }

    if (e.type === 'splitter' && !fromBomb) {
      const waveScale = this.getWaveScale('mini_splitter');
      const frags = (e.tier || 1) >= 3 ? 4 : 3; // tier-3 veterans burst into four
      for (let k = 0; k < frags; k++) {
        const a = e.rotation + (k * Math.PI * 2) / frags;
        this.enemyManager.queueSpawn('mini_splitter', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, waveScale, {
          instant: true,
          vx: Math.cos(a) * 5,
          vy: Math.sin(a) * 5
        });
      }
    }

    // A SPLITTING lieutenant bursts into regular copies of its archetype.
    if (e.splits > 0) {
      const waveScale = this.getWaveScale();
      for (let k = 0; k < e.splits; k++) {
        const a = e.rotation + (k * Math.PI * 2) / e.splits;
        this.enemyManager.queueSpawn(e.type, e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, waveScale, { instant: true });
      }
    }

    if (e.type === 'blackhole') {
      this.particles.spawnShockwave(e.x, e.y, 190, 348, 6, 0.5);
      this.damageEnemiesInRadius(e.x, e.y, 175, 65 * this.getWaveScale() * 0.4, 348, 'other', undefined, undefined, 'blackhole');
    }

    // Weapon Range dummies drop nothing (no caches, score, XP or cores); on-kill weapons still fire.
    const ranged = !!this.range?.active;
    if (ranged) this.range.onKill(e);
    if (e.isBoss) bossDef(e.type)?.onDeath?.(e, this.enemyManager);

    // Relic Supply Cache Drops! (Guaranteed on Bosses, very rare Luck-scaled drop on lesser enemies)
    const luck = this.player.stats.luck || 1.0;
    let bossBombGain = 0;
    if (e.isBoss && !ranged) {
      const bombsBefore = this.player.bombs;
      this.player.bombs = Math.min(9, this.player.bombs + 1);
      bossBombGain = this.player.bombs - bombsBefore;
      this.spawnRelicChest(e.x, e.y, true);
    } else if (!ranged && !fromBomb && this.chests.length < 3) {
      const chestChance = (
        e.isLieutenant ? 0.02 :
        e.type === 'blackhole' ? 0.008 :
        e.type === 'splitter' ? 0.0012 :
        e.type === 'weaver' ? 0.0004 :
        0.00008
      ) * luck * (TUNING.chestDropMult ?? 1.0);
      if (Math.random() < chestChance) {
        this.spawnRelicChest(e.x, e.y, false);
      }
    }

    const shrapnelLv = this.player.weapons.shrapnel || 0;
    if (shrapnelLv > 0 && !fromBomb && Math.random() < W.shrapnelChance(shrapnelLv)) {
      const shardCount = W.shrapnelShards(shrapnelLv);
      this.particles.spawnFlash?.(e.x, e.y, 18 + e.radius, 48, 0.14);
      this.particles.spawnShockwave(e.x, e.y, 30 + e.radius, 48, 2, 0.2);
      this.sound.playShatter?.();
      for (let s = 0; s < shardCount; s++) {
        const a = (s * Math.PI * 2) / shardCount + Math.random() * 0.3;
        this.bullets.push({
          x: e.x,
          y: e.y,
          vx: Math.cos(a) * 11.5,
          vy: Math.sin(a) * 11.5,
          damage: weaponDamage(this.player, 'shrapnel'),
          pierce: 1,
          hue: 48,
          radius: 4,
          life: 0.45,
          source: 'other',
          stat: 'shrapnel',
          knock: KNOCKBACK.shrapnel
        });
      }
    }
    if (ranged) return;

    const pts = Math.round(e.score * this.multiplier);
    this.score += pts;
    if (e.isBoss) this.onBossDefeated(e, pts, bossBombGain);
    if (e.isLieutenant) this.onLieutenantDefeated(e, pts, fromBomb);

    const geomCount = e.isBoss ? 14 : e.isLieutenant ? 6 : e.type === 'blackhole' ? 4 : e.type === 'splitter' || e.type === 'bruiser' ? 2 : 1;
    const killXp = e.xp * xpScaleAt(this.wave);
    for (let g = 0; g < geomCount; g++) {
      const ga = Math.random() * Math.PI * 2;
      const gSpd = 1.5 + Math.random() * 4.5;
      this.geoms.push({
        isCore: false,
        x: e.x,
        y: e.y,
        vx: Math.cos(ga) * gSpd,
        vy: Math.sin(ga) * gSpd,
        xp: Math.max(1, Math.round(killXp / geomCount)),
        rotation: Math.random() * Math.PI * 2,
        hue: e.isBoss || e.isLieutenant ? 48 : 145,
        magnetized: fromBomb
      });
    }

    const maxWaveCores = Math.ceil((TUNING.maxWaveCores ?? 3) * this.player.stats.coreDropMult);
    if (e.isBoss || this.coresDroppedThisWave < maxWaveCores) {
      const coreChance = (
        e.isBoss ? 1.0 :
        e.type === 'blackhole' ? 0.55 :
        e.type === 'hulk' ? 0.3 :
        e.type === 'splitter' ? 0.08 :
        0
      ) * this.player.stats.coreDropMult;

      if (Math.random() < coreChance) {
        const coreDrops = e.isBoss ? (BOSS_TIER[e.bossTier]?.cores ?? 3) : 1;
        this.coresDroppedThisWave += coreDrops;
        for (let c = 0; c < coreDrops; c++) {
          const ca = Math.random() * Math.PI * 2;
          const cSpd = 2 + Math.random() * 3.5;
          this.geoms.push({
            isCore: true,
            coreAmount: 1,
            x: e.x,
            y: e.y,
            vx: Math.cos(ca) * cSpd,
            vy: Math.sin(ca) * cSpd,
            xp: 2,
            rotation: Math.random() * Math.PI * 2,
            hue: 280,
            magnetized: fromBomb
          });
        }
      }
    }
  }

  // Where a new hostile appears: just past the camera's edge, biased toward the ship's heading (see
  // js/spawn-placement.js). `pad` is the hull/pack radius, so the whole pack starts off screen.
  spawnPoint(pad = 0, warmup = SPAWN_WARMUP) {
    return pickSpawnPoint(this, { pad, warmup });
  }

  // A deliberately visible spawn (sandbox buttons): inside the view, at least spawnMinDist from the ship.
  spawnPointOnscreen(pad = 0, minDist = null) {
    return pickOnscreenSpawn(this, { pad, minDist });
  }

  // Elites (lieutenants and bosses) make an entrance: on screen, well clear of the ship, where the
  // player can watch them materialize. eliteOnscreen 0 sends them through the off-screen ring instead.
  // `rock: false` (bosses) may land on rock: the portal blasts it on arrival (bossPortalBlast).
  eliteSpawnPoint(pad, warmup, { rock = true } = {}) {
    if (!(TUNING.eliteOnscreen ?? 1)) return this.spawnPoint(pad, warmup);
    return pickOnscreenSpawn(this, { pad, minDist: TUNING.eliteSpawnMinDist ?? 380, rock });
  }

  // queueSpawn extras for a placed point: every placed spawn holds off materializing while the ship
  // sits on it, and a visible one gets the long, growing on-screen telegraph.
  placedSpawn(pos, extra = {}) {
    if (!pos?.onScreen) return { ...extra, guard: true };
    return { ...extra, guard: true, onScreen: true, warmup: Math.max(extra.warmup ?? 0, TUNING.spawnOnscreenTelegraph ?? 1.4) };
  }

  // Ring point around a random spot (asteroid cluster respawns); hostiles use spawnPoint().
  spawnAroundPlayer(minDist = 440, maxDist = 760) {
    const p = this.player;
    for (let attempt = 0; attempt < 8; attempt++) {
      // Final attempt aims at the world centre, which always has room beyond minDist.
      const angle = attempt === 7
        ? Math.atan2(this.worldHeight / 2 - p.y, this.worldWidth / 2 - p.x)
        : Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const x = Math.max(90, Math.min(this.worldWidth - 90, p.x + Math.cos(angle) * dist));
      const y = Math.max(90, Math.min(this.worldHeight - 90, p.y + Math.sin(angle) * dist));
      // Edge clamping can pull the point back onto the player.
      if (attempt < 7 && Math.hypot(x - p.x, y - p.y) < minDist) continue;

      const nearby = this.asteroidManager.getNearbyAsteroids(x, y, 1);
      let blocked = false;
      for (let i = 0; i < nearby.length; i++) {
        if (Math.hypot(x - nearby[i].x, y - nearby[i].y) < nearby[i].radius + 28) {
          blocked = true;
          break;
        }
      }
      if (!blocked || attempt === 7) return { x, y };
    }
  }

  processPendingBossSpawns() {
    while (this.pendingBossSpawns.length > 0) {
      const scheduled = this.pendingBossSpawns[0];
      const bp = this.eliteSpawnPoint(40, TUNING.bossWarningTime ?? 3, { rock: !((TUNING.bossPortalBlast ?? 280) > 0) });
      if (!this.queueBossEncounter(bp, scheduled.waveScale, scheduled)) break;
      this.pendingBossSpawns.shift();
    }
  }

  // Admission reserves the boss's enemy slot at once and the warning plays out on that reserved
  // spawn ring, so a boss that has been announced can never be refused by the cap on arrival.
  // `boss` is { id, wave, epithet? }: a named boss from js/bosses.js, or 'boss' (the Dreadnought).
  queueBossEncounter(pos, waveScale, boss = {}) {
    if (typeof boss === 'string') boss = { epithet: boss }; // a bare epithet: the Dreadnought
    const warmup = TUNING.bossWarningTime ?? 3.0;
    const wave = boss.wave ?? this.wave;
    const id = boss.id && (boss.id === 'boss' || bossBuilt(boss.id)) ? boss.id : 'boss';
    const extra = id === 'boss'
      ? { warmup, wave, name: BOSS_NAME, epithet: boss.epithet || bossEpithet(wave), bossTier: bossTier(wave) || 'minor' }
      : { warmup, wave, ...(boss.epithet ? { epithet: boss.epithet } : {}) };
    if (!this.enemyManager.queueSpawn(id, pos.x, pos.y, waveScale, this.placedSpawn(pos, extra))) return false;
    this.sound.playBossWarning();
    return true;
  }

  contactDamage(e) {
    return contactDamageAt(e, this.wave);
  }

  // Gunner orbs scale with the wave exactly like contact damage.
  enemyBulletDamage(b) {
    return b.damage * damageRampAt(this.wave);
  }

  // Shared by contact and plasma-orb hits. Returns true when the hit was fatal (caller ends the run).
  // `by`: the enemy kind that dealt it (run stats: damage taken and cause of death).
  damagePlayer(dmg, shake = 16, by = null) {
    const p = this.player;
    dmg *= p.damageTakenMult ?? 1; // Void Armory: Ablative Plating
    this.runStats?.playerHit(by || 'unknown', Math.min(dmg, Math.max(0, p.hp)), p.hp > 0 && p.hp - dmg <= 0);
    p.shieldFlash = 1;
    p.hp -= dmg;
    p.invuln = HIT_INVULN_BASE + (p.hitInvulnBonus || 0);
    this.multiplier = Math.max(1.0, this.multiplier * 0.75);
    this.addShake(shake);
    this.chromaFlash = 0.5;
    if (this.sound.playPlayerHit) this.sound.playPlayerHit();
    else this.sound.playExplosion(1.8);
    this.particles.spawnShockwave(p.x, p.y, 130, 348, 5, 0.38);
    this.grid.applyImpulse(p.x, p.y, 55, 160, 348);
    this.grid.ripple?.(p.x, p.y, 130, 348);
    return p.hp <= 0;
  }

  endRunIfDead() {
    const p = this.player;
    if (p.hp > 0) return false;
    p.hp = 0;
    this.updateHUD();
    this.triggerGameOver();
    return true;
  }

  // Plasma orbs: blocked by rock, pass through a dash's invulnerability, absorbed by the shield.
  updateEnemyBullets(dt) {
    this.enemyBulletHit ||= (b) => {
      if (this.player.invuln > 0 || this.player.hp <= 0 || this.range?.active) return false; // range: orbs pass through
      this.particles.spawnExplosionSparks(b.x, b.y, 10, 14, 2, 8, 2);
      this.damagePlayer(this.enemyBulletDamage(b), 10, b.from);
      return true;
    };
    this.enemyManager.enemyBullets?.update(dt, this.player, this.asteroidManager, this.particles, this.worldWidth, this.worldHeight, this.enemyBulletHit);
    return this.endRunIfDead();
  }

  // One lieutenant per non-boss wave, `lieutenantDelay` seconds in. A pending boss keeps priority on
  // free enemy slots, and a lieutenant blocked by the cap simply retries on later ticks of the wave.
  updateLieutenantSchedule() {
    if (this.wave < (TUNING.lieutenantFirstWave ?? 2) || isBossWave(this.wave)) return;
    if (this.lieutenantWave === this.wave || this.waveTimer < (TUNING.lieutenantDelay ?? 6)) return;
    if (this.pendingBossSpawns.length > 0) return;
    if (this.spawnLieutenant()) this.lieutenantWave = this.wave;
  }

  spawnLieutenant(type = null, onScreen = false) {
    const lt = rollLieutenant(this.wave, lieutenantTypes(this.wave), Math.random, type);
    const warmup = (TUNING.eliteOnscreen ?? 1) ? (TUNING.eliteEntranceTime ?? 2.6) : LIEUTENANT_WARMUP;
    const pos = onScreen ? this.spawnPointOnscreen(40) : this.eliteSpawnPoint(40, warmup);
    return this.enemyManager.queueSpawn(lt.type, pos.x, pos.y, this.getWaveScale(), this.placedSpawn(pos, { warmup, lieutenant: lt }));
  }

  showLieutenantCard(kind, kicker, name, epithet, detail, link = '') {
    this.ltCardSerial = (this.ltCardSerial || 0) + 1;
    this.ltCard = { id: this.ltCardSerial, kind, kicker, name, epithet, detail, link };
    this.ltCardTimer = LIEUTENANT_CARD_TIME;
  }

  onLieutenantArrived(e) {
    this.particles.spawnShockwave(e.x, e.y, 240, e.hue, 4, 0.5);
    this.particles.spawnShockwave(e.x, e.y, 150, 220, 3, 0.35);
    this.grid.applyImpulse(e.x, e.y, 60, 260, e.hue);
    this.grid.ripple?.(e.x, e.y, 260, e.hue);
    this.addShake(6);
    this.sound.playLieutenantArrival?.();
    const mods = lieutenantModLabels(e).join(' · ');
    this.logGuideEntries(['lieutenant', e.type]);
    this.showLieutenantCard('arrival', '▲ LIEUTENANT ▲', e.name, e.epithet, `${mods} · ${Math.round(e.maxHp).toLocaleString()} HP`);
  }

  // Modest guaranteed reward: Void Cores (outside the per-wave cap), gold XP geoms and the kill score.
  onLieutenantDefeated(e, pts, fromBomb) {
    const cores = Math.max(0, Math.round(TUNING.lieutenantCoreReward ?? 1));
    for (let c = 0; c < cores; c++) {
      const ca = Math.random() * Math.PI * 2;
      this.geoms.push({
        isCore: true, coreAmount: 1, x: e.x, y: e.y,
        vx: Math.cos(ca) * 3, vy: Math.sin(ca) * 3,
        xp: 2, rotation: 0, hue: 280, magnetized: true
      });
    }
    this.coresDroppedThisWave += cores;
    this.particles.spawnShockwave(e.x, e.y, 260, 48, 5, 0.55);
    const rewards = [`+${pts.toLocaleString()} PTS`, `+${Math.round(e.xp * xpScaleAt(this.wave))} XP`];
    if (cores > 0) rewards.push(`+${cores} ❖ VOID CORE${cores > 1 ? 'S' : ''}`);
    this.showLieutenantCard('defeat', fromBomb ? '▲ LIEUTENANT VAPORIZED ▲' : '▲ LIEUTENANT DOWN ▲', e.name, e.epithet, rewards.join(' · '));
  }

  // First appearance of a new archetype this run: a one-line intel card on what it does.
  announceArchetype(type) {
    const info = INTEL_INFO[type];
    if (!info || this.seenArchetypes.has(type)) return;
    if (this.ltCardTimer > 0 && this.ltCard?.kind !== 'intel') return; // try again on its next pack
    this.seenArchetypes.add(type);
    // The intel card doubles as the Field Guide link (no separate toast for it).
    const logged = this.logGuideEntries([type], false).length > 0;
    this.showLieutenantCard('intel', '◆ NEW HOSTILE SIGNATURE ◆', info.label, '', info.intro,
      logged ? '📖 NEW FIELD GUIDE ENTRY · [G] TO READ' : '📖 IN YOUR FIELD GUIDE · [G]');
  }

  updateLieutenantHUD() {
    const card = this.ltCardTimer > 0 ? this.ltCard : null;
    const cardEl = document.getElementById('lt-card');
    if (!cardEl) return;
    if (card && card.id !== this.ltCardShownId) {
      this.ltCardShownId = card.id;
      document.getElementById('lt-card-kicker').textContent = card.kicker;
      document.getElementById('lt-card-name').textContent = card.name;
      document.getElementById('lt-card-epithet').textContent = card.epithet;
      document.getElementById('lt-card-detail').textContent = card.detail;
      const link = document.getElementById('lt-card-link');
      if (link) link.textContent = card.link || '';
      cardEl.className = `lt-card lt-card-${card.kind}`;
      cardEl.style.animation = 'none';
      void cardEl.offsetWidth;
      cardEl.style.animation = '';
    }
    setHidden(cardEl, !card);
    if (card) cardEl.classList[this.ltCardTimer < 0.4 ? 'add' : 'remove']('lt-card-out');
  }

  showBossCard(kind, kicker, e, detail) {
    this.bossCardSerial = (this.bossCardSerial || 0) + 1;
    this.bossCard = { id: this.bossCardSerial, kind, kicker, name: e.name || BOSS_NAME, epithet: e.epithet || '', detail };
    this.bossCardTimer = BOSS_CARD_TIME;
  }

  // Entrance: layered shockwaves, a hard grid shove, capped screen shake and the title card.
  onBossArrived(e) {
    // The portal blows apart any rock round it, so a boss never arrives wedged in an asteroid.
    const blast = TUNING.bossPortalBlast ?? 280;
    if (blast > 0) this.asteroidManager?.blastRocks?.(e.x, e.y, blast, (rock) => this.onRockShattered(rock));
    this.shake = Math.min(24, Math.max(this.shake, 20 * (TUNING.screenShakeMult ?? 1.0)));
    this.chromaFlash = Math.max(this.chromaFlash, 0.6);
    this.particles.spawnShockwave(e.x, e.y, 560, 48, 8, 0.8);
    this.particles.spawnShockwave(e.x, e.y, 320, e.hue, 5, 0.55);
    this.particles.spawnExplosionSparks(e.x, e.y, 48, 48, 3, 18, 2.6);
    this.grid.applyImpulse(e.x, e.y, 130, 560, 48);
    this.grid.ripple?.(e.x, e.y, 560, 48);
    this.sound.playBossArrival();
    const hp = Math.round(e.maxHp).toLocaleString();
    this.logGuideEntries([e.type]);
    const kicker = (BOSS_TIER[e.bossTier] || BOSS_TIER.minor).kicker;
    this.showBossCard('arrival', kicker, e, `${hp} HP · ${Math.round(this.contactDamage(e))} CONTACT DMG`);
  }

  // Defeat payoff: hit-stop then half-speed slow-mo (counted in fixed ticks), a gold flash,
  // layered shockwaves and a banner listing the exact rewards.
  onBossDefeated(e, pts, bombGain) {
    this.hitStopTicks = Math.max(this.hitStopTicks || 0, Math.round((TUNING.bossHitStop ?? 0.1) * 60));
    this.slowMoTicks = Math.round((TUNING.bossSlowMo ?? 0.5) * 60);
    this.bossFlash = 1;
    this.shake = Math.min(24, Math.max(this.shake, 24 * (TUNING.screenShakeMult ?? 1.0)));
    this.particles.spawnShockwave(e.x, e.y, 680, 48, 10, 0.9);
    this.particles.spawnShockwave(e.x, e.y, 420, 185, 6, 0.65);
    this.particles.spawnShockwave(e.x, e.y, 220, 325, 5, 0.45);
    this.particles.spawnExplosionSparks(e.x, e.y, 70, 48, 4, 22, 3);
    this.grid.applyImpulse(e.x, e.y, 140, 600, 48);
    this.grid.ripple?.(e.x, e.y, 680, 48, 1.3);
    this.sound.playBossDefeat();
    const rewards = [`+${pts.toLocaleString()} PTS`, 'SUPER RELIC CACHE', `${BOSS_TIER[e.bossTier]?.cores ?? 3} ❖ VOID CORES`];
    if (bombGain > 0) rewards.push(`+${bombGain} BOMB`);
    this.showBossCard('defeat', '★ BOSS DESTROYED ★', e, rewards.join(' · '));
  }

  // Boss-kill time dilation in whole 60 Hz ticks: hit-stop holds every tick, then slow-mo holds
  // every other tick (half speed). Skipping ticks instead of scaling dt keeps per-tick motion exact.
  consumeTimeDilation() {
    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
      return true;
    }
    if (this.slowMoTicks > 0) {
      this.slowMoTicks--;
      return this.slowMoTicks % 2 === 1;
    }
    return false;
  }

  // 0 = no boss, 1 = boss warning counting down, 2 = boss alive (drives the music layers).
  getBossStage() {
    if (this.enemyManager.enemies.some(e => e.isBoss && !e.dead)) return 2;
    return (this.enemyManager.spawnIndicators || []).some(sp => sp.config?.isBoss) ? 1 : 0;
  }

  // HUD snapshot: live bosses as stacked bars, plus the soonest pending warning's countdown.
  getBossHudModel() {
    const bosses = this.enemyManager.enemies.filter(e => e.isBoss && !e.dead);
    let shown = bosses;
    if (bosses.length > BOSS_BAR_ROWS) {
      // Too many to stack: keep the nearest few, still in arrival order so rows don't reshuffle.
      const p = this.player;
      const distSq = e => (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      const nearest = new Set([...bosses].sort((a, b) => distSq(a) - distSq(b)).slice(0, BOSS_BAR_ROWS));
      shown = bosses.filter(e => nearest.has(e));
    }

    let soonest = null;
    let warningCount = 0;
    for (const sp of this.enemyManager.spawnIndicators || []) {
      if (!sp.config?.isBoss) continue;
      warningCount++;
      if (!soonest || sp.timer < soonest.timer) soonest = sp;
    }

    return {
      visible: bosses.length > 0,
      rows: shown.map(e => ({
        name: e.name || BOSS_NAME,
        epithet: e.epithet || '',
        hp: Math.max(0, Math.ceil(e.hp)),
        maxHp: Math.round(e.maxHp),
        pct: Math.max(0, Math.min(1, e.hp / e.maxHp))
      })),
      overflow: bosses.length - shown.length,
      warning: soonest
        ? { count: warningCount, eta: Math.max(0, soonest.timer), name: soonest.config.name || BOSS_NAME, epithet: soonest.config.epithet || '' }
        : null
    };
  }

  updateBossHUD(model) {
    const card = this.bossCardTimer > 0 ? this.bossCard : null;
    setHidden(document.getElementById('boss-hud'), !model.warning && !model.visible && !card);
    const warnEl = document.getElementById('boss-warning');
    setHidden(warnEl, !model.warning);
    if (model.warning) {
      const w = model.warning;
      document.getElementById('boss-warning-text').textContent = w.count > 1
        ? `${w.count} BOSSES INBOUND // NEXT: ${w.name}`
        : `${w.name} INBOUND // ${w.epithet}`;
      document.getElementById('boss-warning-eta').textContent = `T-${w.eta.toFixed(1)}s`;
    }

    setHidden(document.getElementById('boss-bars'), !model.visible);
    for (let i = 0; i < BOSS_BAR_ROWS; i++) {
      const row = model.rows[i];
      setHidden(document.getElementById(`boss-bar-${i}`), !row);
      if (!row) continue;
      document.getElementById(`boss-bar-name-${i}`).textContent = row.name;
      document.getElementById(`boss-bar-epithet-${i}`).textContent = row.epithet;
      document.getElementById(`boss-bar-hp-${i}`).textContent = `${row.hp.toLocaleString()} / ${row.maxHp.toLocaleString()}`;
      document.getElementById(`boss-bar-fill-${i}`).style.width = `${(row.pct * 100).toFixed(1)}%`;
    }
    const moreEl = document.getElementById('boss-bar-more');
    setHidden(moreEl, model.overflow <= 0);
    if (model.overflow > 0) moreEl.textContent = `+${model.overflow} MORE BOSS${model.overflow > 1 ? 'ES' : ''} ON RADAR`;

    const cardEl = document.getElementById('boss-card');
    if (card && card.id !== this.bossCardShownId) {
      this.bossCardShownId = card.id;
      document.getElementById('boss-card-kicker').textContent = card.kicker;
      document.getElementById('boss-card-name').textContent = card.name;
      document.getElementById('boss-card-epithet').textContent = card.epithet ? `— ${card.epithet} —` : '';
      document.getElementById('boss-card-detail').textContent = card.detail;
      // Re-run the entrance animation even when one card replaces another that is still showing.
      cardEl.className = `boss-card boss-card-${card.kind}`;
      cardEl.style.animation = 'none';
      void cardEl.offsetWidth;
      cardEl.style.animation = '';
    }
    setHidden(cardEl, !card);
    if (cardEl) cardEl.classList[card && this.bossCardTimer < 0.45 ? 'add' : 'remove']('boss-card-out');
  }

  spawnWavePack() {
    if (this.enemyManager.enemies.length > 130) return;

    const waveScale = this.getWaveScale();
    const pt = this.spawnPoint(90); // pack centre: room for the widest formation around it

    // Weighted pack (TUNING spawnWeight* × the wave theme, js/waves.js); new types join on their boss wave.
    const pack = pickWavePack(this.wave);
    const roster = new Map(packRoster(pack, this.wave));
    const count = (type) => roster.get(type) || 0;
    const em = this.enemyManager;
    const queuedBefore = em.spawnIndicators.length;
    // Each member gets its own off-screen ring point.
    const spread = (type, n) => {
      for (let i = 0; i < n; i++) {
        const p2 = this.spawnPoint(30);
        em.queueSpawn(type, p2.x, p2.y, this.getWaveScale(type), this.placedSpawn(p2));
      }
    };
    if (pack === 'swarm') {
      em.spawnBoidSwarm(pt.x, pt.y, count('swarmer'), this.getWaveScale('swarmer'), this.worldWidth, this.worldHeight, this.placedSpawn(pt));
    } else if (pack === 'skirmish') {
      const n = count('pinwheel') + count('weaver');
      for (let i = 0; i < n; i++) {
        const p2 = this.spawnPoint(30);
        em.queueSpawn(i % 2 === 0 ? 'pinwheel' : 'weaver', p2.x, p2.y, this.getWaveScale('pinwheel'), this.placedSpawn(p2));
      }
    } else if (pack === 'mayfly') {
      // One cloud: tight around a single ring point, so it arrives as a swarm of specks.
      const n = count('mayfly');
      for (let i = 0; i < n; i++) {
        const m = packMemberPoint(this, pt, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120);
        em.queueSpawn('mayfly', m.x, m.y, this.getWaveScale('mayfly'), this.placedSpawn(m));
      }
    } else if (pack === 'blackhole') {
      em.queueSpawn('blackhole', pt.x, pt.y, waveScale, this.placedSpawn(pt));
    } else if (pack === 'serpent') {
      for (let i = 0; i < count('serpent'); i++) {
        const p2 = this.spawnPoint(SERPENT.gap * SERPENT.segments * 0.5);
        const angle = this.player ? Math.atan2(this.player.y - p2.y, this.player.x - p2.x) : 0;
        spawnSerpent(em, 'serpent', p2.x, p2.y, this.getWaveScale('serpent'), SERPENT.segments, { angle, extra: this.placedSpawn(p2) });
      }
    } else if (pack === 'carrier') {
      // The roster's drones are launched by the carriers over time, not spawned with them.
      spread('carrier', count('carrier'));
    } else if (pack === 'kestrel') {
      // One V on a strafing run that starts lined up on the ship.
      const p2 = this.spawnPoint(80);
      const angle = this.player ? Math.atan2(this.player.y - p2.y, this.player.x - p2.x) : 0;
      spawnWing(em, p2.x, p2.y, this.getWaveScale('kestrel'), count('kestrel') - 1, { angle, extra: this.placedSpawn(p2) });
    } else if (pack === 'shielder') {
      // Shielders lead a pinwheel escort, so the pack advances behind the plates.
      for (let i = 0; i < count('shielder'); i++) {
        const p2 = this.spawnPoint(70);
        em.queueSpawn('shielder', p2.x, p2.y, waveScale, this.placedSpawn(p2));
        for (let k = 0; k < 2; k++) {
          const esc = packMemberPoint(this, p2, k ? 40 : -40, 34);
          em.queueSpawn('pinwheel', esc.x, esc.y, this.getWaveScale('pinwheel'), this.placedSpawn(esc));
        }
      }
    } else if (pack === 'conduit') {
      // A Conduit always arrives with a pack to buff: pinwheels, plus a bruiser later on.
      em.queueSpawn('conduit', pt.x, pt.y, waveScale, this.placedSpawn(pt));
      for (let k = 0; k < count('pinwheel'); k++) {
        const a = (k * Math.PI * 2) / 3;
        const esc = packMemberPoint(this, pt, Math.cos(a) * 60, Math.sin(a) * 60);
        em.queueSpawn('pinwheel', esc.x, esc.y, this.getWaveScale('pinwheel'), this.placedSpawn(esc));
      }
      if (count('bruiser') > 0) {
        const esc = packMemberPoint(this, pt, 80, 0);
        em.queueSpawn('bruiser', esc.x, esc.y, waveScale, this.placedSpawn(esc));
      }
    } else {
      for (const [type, n] of roster) spread(type, n);
    }
    // Only announce a newcomer that actually made it past the enemy cap.
    if (INTEL_INFO[pack] && em.spawnIndicators.length > queuedBefore) this.announceArchetype(pack);
  }

  // Seconds until the next pack: the wave's base interval, stretched or shrunk by the HP budget, and
  // slowed (bossPackRate) while this boss wave's boss is still warning in or alive. The lull lasts only
  // until the wave timer runs out: an unbeaten boss then faces full-rate packs.
  packInterval() {
    const lull = isBossWave(this.wave) && this.bossWaveFightActive() ? Math.max(0.05, TUNING.bossPackRate ?? 0.7) : 1;
    return spawnIntervalAt(this.wave) * hpBudgetScale(this.wave) / lull;
  }

  bossWaveFightActive() {
    if (this.pendingBossSpawns.some(b => b.wave === this.wave)) return true;
    const em = this.enemyManager;
    return em.enemies.some(e => e.isBoss && !e.dead && e.bossWave === this.wave)
      || em.spawnIndicators.some(sp => sp.config?.isBoss && sp.config.bossWave === this.wave);
  }

  // Auto-aim: nearest target, but a hull whose shield plates face the ship counts as 260 px further
  // away, so the turret prefers something it can actually hurt and swings back once you flank.
  findAutoAimTarget(x, y) {
    const enemies = this.enemyManager.enemies;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // Armored serpent bodies count as much further away still: aim for the head.
      const score = e.deflect ? d + 420
        : e.shieldArc && shieldBlocks(e, e.x - dx / d * e.shieldRadius, e.y - dy / d * e.shieldRadius, dx, dy) ? d + 260 : d;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  findNearestEnemy(x, y) {
    const enemies = this.enemyManager.enemies;
    let best = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    return best;
  }

  // Nearest enemy within `range` whose bearing from (x, y) is more than `minTurn` radians off `angle`.
  findNearestEnemyAway(x, y, angle, minTurn, range) {
    const enemies = this.enemyManager.enemies;
    let best = null;
    let bestDistSq = range * range;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq >= bestDistSq) continue;
      const turn = Math.abs(((Math.atan2(dy, dx) - angle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (turn <= minTurn) continue;
      bestDistSq = dSq;
      best = e;
    }
    return best;
  }

  // Return the first intersection along a projectile's movement segment.
  segmentHitTime(x0, y0, x1, y1, cx, cy, radius) {
    const dx = x1 - x0, dy = y1 - y0;
    const ox = x0 - cx, oy = y0 - cy;
    const c = ox * ox + oy * oy - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (ox * dx + oy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }

  updateBullets(dt) {
    const manager = this.asteroidManager;
    // Cached by rebuildSpatialHash (rocks only change through it); a scan over ~1000 rocks per tick is not free.
    const maxRockRadius = manager.maxRockRadius ?? manager.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    this.projectileEnemyIndex ||= new SpatialIndex();
    this.projectileEnemyIndex.rebuild(this.enemyManager.enemies);
    const maxEnemyRadius = this.enemyManager.enemies.reduce((max, enemy) => Math.max(max, enemy.shieldArc ? enemy.shieldRadius : enemy.radius), 0);
    // Death effects may append shrapnel; those projectiles start moving next tick.
    const pending = this.bullets;
    this.bullets = [];
    for (const b of pending) {
      // sweepX/Y: a bolt spawned at a barrel tip sweeps from its gun on the first tick so point-blank targets still get hit.
      const x0 = b.sweepX ?? b.x, y0 = b.sweepY ?? b.y;
      if (b.sweepX !== undefined) b.sweepX = b.sweepY = undefined;
      if (b.homing) this.steerHomingBolt(b);
      if (b.mirvT > 0) {
        b.mirvT -= dt;
        if (b.mirvT <= 0 && b.mirvParts > 1) this.splitMirv(b);
      }
      b.x += b.vx;
      b.y += b.vy;
      b.life -= dt;
      b.hitEnemies ||= new Set();
      const hits = [];
      const segmentRadius = Math.hypot(b.x - x0, b.y - y0) / 2;
      const midX = (x0 + b.x) / 2, midY = (y0 + b.y) / 2;
      for (const e of this.projectileEnemyIndex.query(midX, midY, segmentRadius + maxEnemyRadius + b.radius)) {
        if (e.dead || b.hitEnemies.has(e)) continue;
        // Shield plates (Shielders, SHIELDED lieutenants) stop shots arriving from the front.
        if (e.shieldArc) {
          const ts = this.segmentHitTime(x0, y0, b.x, b.y, e.x, e.y, e.shieldRadius + b.radius);
          if (ts !== null && shieldBlocks(e, x0 + (b.x - x0) * ts, y0 + (b.y - y0) * ts, b.vx, b.vy)) {
            hits.push({ t: ts, shield: e });
            continue;
          }
        }
        const t = this.segmentHitTime(x0, y0, b.x, b.y, e.x, e.y, e.radius + b.radius);
        if (t !== null) hits.push({ t, enemy: e });
      }
      const cells = Math.ceil((Math.hypot(b.x - x0, b.y - y0) / 2 + maxRockRadius + b.radius) / manager.cellSize);
      for (const rock of manager.getNearbyAsteroids((x0 + b.x) / 2, (y0 + b.y) / 2, cells)) {
        if (rock.hp <= 0) continue;
        const t = this.segmentHitTime(x0, y0, b.x, b.y, rock.x, rock.y, rock.radius + b.radius);
        if (t !== null) hits.push({ t, rock });
      }
      // Cover wins ties so enemies cannot be hit through a rock surface.
      hits.sort((a, b) => a.t - b.t || Number(!!b.rock) - Number(!!a.rock));
      let blocked = false;
      for (const hit of hits) {
        if (hit.rock) {
          blocked = true;
          const hx = x0 + (b.x - x0) * hit.t;
          const hy = y0 + (b.y - y0) * hit.t;
          this.particles.spawnDirectionalSparks(hx, hy, Math.atan2(-b.vy, -b.vx), 0.9, 2, b.hue, 4);
          if (b.ricochet > 0) this.ricochetOffRock(b, hit.rock, hx, hy);
          break;
        }
        if (hit.shield) {
          if (hit.shield.dead) continue; // killed earlier in this segment: its plates are gone
          blocked = true;
          const hx = x0 + (b.x - x0) * hit.t;
          const hy = y0 + (b.y - y0) * hit.t;
          hit.shield.shieldFlash = 1;
          this.particles.spawnDirectionalSparks(hx, hy, Math.atan2(hy - hit.shield.y, hx - hit.shield.x), 1.1, 4, 195, 6);
          break;
        }
        const e = hit.enemy;
        if (e.dead) continue;
        // Pierce falloff: the first enemy takes full damage, each one behind it TUNING.pierceFalloff of the last.
        const pierceMult = Math.pow(TUNING.pierceFalloff ?? 0.7, b.hitEnemies.size);
        b.hitEnemies.add(e);
        b.pierce--;
        const hx = x0 + (b.x - x0) * hit.t;
        const hy = y0 + (b.y - y0) * hit.t;
        const travel = Math.atan2(b.vy, b.vx);
        this.particles.spawnDirectionalSparks(hx, hy, travel, 1.1, 5, e.hue, 7);
        this.particles.spawnImpact(hx, hy, travel, 5 + b.radius);
        const kb = (b.knock ?? KNOCKBACK.blaster) / (Math.hypot(b.vx, b.vy) || 1);
        this.hitEnemy(e, b.damage * pierceMult, b.source || 'blaster', b.vx * kb, b.vy * kb, 1, b.stat || b.source || 'blaster');
        if (b.blastRadius) {
          // Siege Battery shells burst on impact (cover still stops the shell itself).
          // Flak bursts read as a thin hot-orange ring and a few sparks thrown outward, with no filled flash:
          // at a high fire rate the flash discs piled up into bright blobs that hid the enemies under them.
          const bh = b.blastHue ?? b.hue;
          if (b.flak) {
            this.particles.spawnShockwave(hx, hy, b.blastRadius, bh, 1.6, 0.26);
            this.particles.spawnExplosionSparks(hx, hy, 4, bh, 2, 9, 1.4);
          } else {
            this.particles.spawnFlash?.(hx, hy, b.blastRadius * 0.4, bh, 0.16);
            this.particles.spawnShockwave(hx, hy, b.blastRadius, bh, 3, 0.32);
          }
          this.sound.playMissileImpact?.(0.75);
          this.damageEnemiesInRadius(hx, hy, b.blastRadius, b.blastDamage, b.hue, b.source || 'other', KNOCKBACK.area * 0.5, undefined, b.blastStat || b.source || 'other');
        }
        if (b.tandem || b.napalm || b.ricochet > 0 || b.arcRounds) this.boltBreakthroughs(b, e, hx, hy);
        if (b.pierce <= 0) break;
      }
      if (!blocked && b.pierce > 0 && b.life > 0 && b.x >= 10 && b.x <= this.worldWidth - 10 && b.y >= 10 && b.y <= this.worldHeight - 10) {
        this.bullets.push(b);
      }
    }
  }

  // Breakthrough effects of a bolt that just hit `e` at (hx, hy).
  boltBreakthroughs(b, e, hx, hy) {
    if (b.tandem) {
      this.weaponFx.schedule({ x: hx, y: hy, delay: W.tandemDelay, radius: b.blastRadius, damage: b.damage * W.tandemShare, hue: b.hue, source: b.source, style: 'tandem', knock: KNOCKBACK.area * 0.5 });
    }
    if (b.napalm) {
      const ticks = W.napalmLife / W.napalmTick;
      this.weaponFx.addPool({ x: hx, y: hy, radius: (b.blastRadius || 50) * 0.85, life: W.napalmLife, tick: W.napalmTick, damage: b.damage * W.napalmShare / ticks, hue: 18, source: b.source });
    }
    if (b.ricochet > 0) {
      // Ricochet Rounds: one bounce off the struck hull toward a fresh target (see ricochetTarget); with
      // nobody to find it still glances off at an angle.
      const next = this.ricochetTarget(hx, hy, b);
      const travel = Math.atan2(b.vy, b.vx);
      const a = next ? Math.atan2(next.y - hy, next.x - hx) : travel + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5);
      if (next) next.ricochetAt = this.elapsedTime;
      this.spawnRicochet(b, hx, hy, a);
    }
    if (b.arcRounds) {
      // Arc Rounds: the hit arcs into the nearest few enemies around it.
      const hit = new Set([e]);
      let fromX = hx, fromY = hy;
      for (let k = 0; k < W.arcRoundJumps; k++) {
        const t = this.nearestEnemyExcept(hx, hy, W.arcRoundRange, hit);
        if (!t) break;
        hit.add(t);
        this.particles.spawnLightning(fromX, fromY, t.x, t.y, 176, 0.8, 0.12, 0);
        this.hitEnemy(t, b.damage * W.arcRoundShare, b.source || 'blaster', 0, 0, 0.4, b.stat || b.source || 'blaster');
        fromX = t.x;
        fromY = t.y;
      }
    }
  }

  // Nearest live enemy within `range` of (x, y) that is not in `skip`.
  // Ricochet Rounds target: the closest enemy in W.ricochetRange that this bolt hasn't hit, steering clear
  // of enemies inside the bolt's own Flak burst (already hit by it) and of enemies another ricochet picked
  // in the last W.ricochetClaimTime s, so a stream of bolts fans its bounces out over the pack.
  ricochetTarget(x, y, b) {
    let best = null;
    let bestScore = Infinity;
    const rangeSq = W.ricochetRange * W.ricochetRange;
    const burst = b.flak ? b.blastRadius : 0;
    for (const e of this.enemyManager.enemies) {
      if (e.dead || b.hitEnemies?.has(e) || e.type === 'blackhole') continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq > rangeSq) continue;
      const d = Math.sqrt(dSq);
      let score = d;
      if (d < burst + e.radius) score += W.ricochetRange;
      if (this.elapsedTime - (e.ricochetAt ?? -1e9) < W.ricochetClaimTime) score += W.ricochetRange * 0.75;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // The gold ricochet bolt from (x, y) along angle `a` (it keeps Flak and Arc Rounds, never bounces again).
  spawnRicochet(b, x, y, a) {
    const speed = Math.hypot(b.vx, b.vy);
    this.bullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, damage: b.damage * W.ricochetShare, pierce: 1, hue: 48,
      radius: b.radius * 1.1, width: b.width, life: 0.6, source: b.source, stat: b.stat, hitEnemies: new Set(b.hitEnemies), arcRounds: b.arcRounds,
      blastRadius: b.flak ? b.blastRadius : 0, blastDamage: b.flak ? b.blastDamage * W.ricochetShare : 0, blastStat: b.blastStat, blastHue: b.blastHue, flak: b.flak });
    this.particles.spawnDirectionalSparks(x, y, a, 0.6, 7, 48, 9);
    this.particles.spawnLightning?.(x, y, x + Math.cos(a) * 28, y + Math.sin(a) * 28, 48, 0.6, 0.1, 0);
  }

  // Ricochet Rounds off an asteroid: the bolt reflects off the rock face, snapping onto an enemy within
  // ~40 degrees of the reflection when there is one.
  ricochetOffRock(b, rock, hx, hy) {
    const nx = (hx - rock.x) / (Math.hypot(hx - rock.x, hy - rock.y) || 1);
    const ny = (hy - rock.y) / (Math.hypot(hx - rock.x, hy - rock.y) || 1);
    const dot = b.vx * nx + b.vy * ny;
    let a = Math.atan2(b.vy - 2 * dot * ny, b.vx - 2 * dot * nx);
    const x = hx + nx * 2, y = hy + ny * 2;
    const next = this.ricochetTarget(x, y, b);
    if (next) {
      const to = Math.atan2(next.y - y, next.x - x);
      const turn = Math.abs(((to - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (turn < 0.7) {
        a = to;
        next.ricochetAt = this.elapsedTime;
      }
    }
    this.spawnRicochet(b, x, y, a);
  }

  nearestEnemyExcept(x, y, range, skip) {
    let best = null;
    let bestSq = range * range;
    for (const e of this.enemyManager.enemies) {
      if (e.dead || skip?.has(e) || e.type === 'blackhole') continue;
      const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  // MIRV Rockets: split into mirvParts mini-rockets fanned around the heading. Each one homes on its own
  // target among the nearest enemies ahead (left to right, sharing when there are fewer); with nobody
  // ahead they fly straight on.
  splitMirv(b) {
    const parts = b.mirvParts;
    const speed = Math.hypot(b.vx, b.vy);
    const heading = Math.atan2(b.vy, b.vx);
    b.damage /= parts;
    b.blastDamage = (b.blastDamage || 0) / parts;
    b.mirvParts = 1;
    this.particles.spawnFlash?.(b.x, b.y, 12, b.hue, 0.12);
    const targets = this.mirvTargets(b, parts);
    for (let k = 0; k < parts; k++) {
      const a = heading + (k - (parts - 1) / 2) * 0.22;
      const part = k === 0 ? b : { ...b, hitEnemies: new Set(b.hitEnemies) };
      part.vx = Math.cos(a) * speed;
      part.vy = Math.sin(a) * speed;
      part.radius = 3.4;
      if (targets.length) {
        part.target = targets[Math.floor((k * targets.length) / parts)];
        part.homing = W.mirvHoming;
      }
      if (k > 0) this.bullets.push(part);
    }
  }

  // Up to `count` nearest enemies within W.mirvRange ahead of rocket `b`, ordered left to right.
  mirvTargets(b, count) {
    const enemies = this.enemyManager.enemies;
    const out = [];
    for (let k = 0; k < count; k++) {
      let best = null;
      let bestSq = W.mirvRange * W.mirvRange;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead || e.type === 'blackhole' || b.hitEnemies?.has(e) || out.includes(e)) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestSq && dx * b.vx + dy * b.vy > 0) {
          bestSq = dSq;
          best = e;
        }
      }
      if (!best) break;
      out.push(best);
    }
    const side = (e) => (e.x - b.x) * b.vy - (e.y - b.y) * b.vx; // > 0: left of the heading
    return out.sort((p, q) => side(q) - side(p));
  }

  // Homing bolts (Escort Drones' Homing Bolts, micro-missiles) curve onto their target.
  steerHomingBolt(b) {
    if (!b.target || b.target.dead) b.target = this.nearestEnemyExcept(b.x, b.y, 320, b.hitEnemies);
    const t = b.target;
    if (!t) return;
    const speed = Math.hypot(b.vx, b.vy);
    const cur = Math.atan2(b.vy, b.vx);
    let diff = Math.atan2(t.y - b.y, t.x - b.x) - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const a = cur + Math.max(-b.homing, Math.min(b.homing, diff));
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
  }

  applyUpgrade(upg) {
    return applyUpgradeLevels(this.player, upg);
  }

  processPendingLevelUps() {
    if (this.state !== 'PLAYING') return;
    const p = this.player;
    while (p.xp >= p.xpToNext && this.state === 'PLAYING') {
      p.xp -= p.xpToNext;
      p.level++;
      p.xpToNext = xpToNextLevel(p.level);
      this.triggerLevelUp();
    }
  }

  firePrimaryWeapon() {
    const p = this.player;
    const b = weaponBuild(p, 'blaster');
    const damage = weaponDamage(p, 'blaster', b);
    const pierce = blasterPierce(p, b);
    // Breakthroughs: Flak Rounds burst on hit, Ricochet Rounds bounce once, Arc Rounds arc on hit.
    const flak = b.t4 ? { blastRadius: W.flakRadius * (p.stats.areaMult ?? 1), blastDamage: damage * W.flakShare, blastStat: 'blaster', blastHue: 28, flak: true } : null;
    // Prism Split streams keep fixed slots (forward pair first), so new streams never bend old ones.
    const sideX = -Math.sin(p.angle);
    const sideY = Math.cos(p.angle);
    for (const stream of prismStreams(blasterStreams(p, b))) {
      const a = p.angle + stream.angle;
      const noseX = p.x + Math.cos(a) * 16 + sideX * stream.lateral;
      const noseY = p.y + Math.sin(a) * 16 + sideY * stream.lateral;

      this.bullets.push({
        x: noseX,
        y: noseY,
        vx: Math.cos(a) * p.stats.bulletSpeed,
        vy: Math.sin(a) * p.stats.bulletSpeed,
        damage,
        pierce,
        hue: b.t12 ? 176 : (TUNING.bulletColorHue ?? 186),
        radius: (TUNING.bulletRadius ?? 4.2) * (flak ? 1.15 : 1),
        life: 1.25,
        width: AUTOCANNON_DRAW_WIDTH,
        ...flak,
        ricochet: b.t8 ? 1 : 0,
        arcRounds: b.t12
      });
    }

    if (p.weapons.pulsarHelix) {
      this.helixAngle += 0.48;
      for (let arm = 0; arm < W.helixArms; arm++) {
        const ha = this.helixAngle + arm * Math.PI;
        this.bullets.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(ha) * (p.stats.bulletSpeed * 0.85),
          vy: Math.sin(ha) * (p.stats.bulletSpeed * 0.85),
          damage: weaponDamage(p, 'helix', b),
          pierce,
          hue: 305, // evolution magenta: reads apart from cyan Autocannon shots and gold XP geoms
          stat: 'helix',
          radius: 6.5,
          life: 1.3
        });
      }
    }

    this.sound.playLaser();
    // Muzzle recoil nudges the grid but adds no glow: the ship's own light (draw) lights its lines.
    this.grid.applyImpulse(p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, 5.5, 110, 188, 0);
  }

  // Rocket Pods: dumbfire rockets from the two flank pods, flying where the turret aims (mouse, right
  // stick or auto-aim, like the Autocannon). Direct hit plus a small blast. Rockets alternate pods;
  // each extra pair launches a little further back and fans slightly outward.
  fireWingRockets(b = weaponBuild(this.player, 'rockets')) {
    const p = this.player;
    if (typeof b === 'number') b = weaponBuild(p, 'rockets', b);
    const heading = p.hullAngle ?? p.drillAngle ?? p.angle; // hull heading: where the wing pods are
    const aim = p.angle;
    // MIRV rockets carry all three payloads until they split.
    const mirv = b.t12 ? W.mirvSplit : 1;
    const damage = weaponDamage(p, 'rocket', b) * mirv;
    const blastRadius = wingRocketBlastRadius(p, b);
    const count = W.wingRocketCount(b);
    // The flank pods converge on the aim line: at the nearest enemy when it sits near the aim, otherwise
    // ROCKET_CONVERGE px out, so a lone target dead ahead isn't straddled by both rockets.
    const t = this.findNearestEnemy(p.x, p.y);
    const tTurn = t ? Math.abs(((Math.atan2(t.y - p.y, t.x - p.x) - aim) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) : Infinity;
    const converge = tTurn < 0.35 ? Math.min(600, Math.max(90, Math.hypot(t.x - p.x, t.y - p.y))) : ROCKET_CONVERGE;
    const cx = p.x + Math.cos(aim) * converge, cy = p.y + Math.sin(aim) * converge;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const hx = Math.cos(heading), hy = Math.sin(heading);
      // Pod mount in hull space: (0.25r forward, 1.12r out), the tips of drawCrabShip's carapace flanks.
      const fwd = p.radius * 0.25 - tier * 7;
      const out = p.radius * 1.12 + tier * 3;
      const wx = p.x + hx * fwd - hy * side * out;
      const wy = p.y + hy * fwd + hx * side * out;
      const a = Math.atan2(cy - wy, cx - wx) + side * tier * 0.07;
      const fx = Math.cos(a), fy = Math.sin(a);
      this.bullets.push({
        x: wx,
        y: wy,
        vx: fx * W.wingRocketSpeed,
        vy: fy * W.wingRocketSpeed,
        damage,
        pierce: 1,
        hue: 28,
        radius: 4.5,
        life: W.wingRocketLife,
        source: 'rocket',
        kind: 'rocket',
        knock: KNOCKBACK.missile,
        blastRadius,
        blastDamage: damage * W.wingRocketBlastShare,
        tandem: b.t4,
        napalm: b.t8,
        mirvT: b.t12 ? W.mirvTime : 0,
        mirvParts: mirv
      });
      this.particles?.spawnFlash?.(wx, wy, 11, 30, 0.1);
    }
    if (this.sound.playRocketLaunch) this.sound.playRocketLaunch();
    else this.sound.playLaser(0.55);
  }

  fireSwarmMissiles(b = weaponBuild(this.player, 'missiles')) {
    const p = this.player;
    if (typeof b === 'number') b = weaponBuild(p, 'missiles', b);
    const salvo = W.missileSalvo(b);
    const damage = weaponDamage(p, 'missile', b);
    const blastRadius = missileBlastRadius(p, b);
    const hue = missileHue(p);
    const cluster = b.t4 ? { count: W.clusterBomblets, share: W.clusterShare, radiusFrac: W.clusterRadiusFrac, spread: W.clusterSpread, delay: W.clusterDelay } : null;
    // Tactical Nuke: every nukeEvery-th salvo is one huge missile carrying nukeUnits salvos of damage.
    this.missileSalvos = (this.missileSalvos || 0) + 1;
    const nuke = b.t12 && this.missileSalvos % W.nukeEvery === 0;
    const count = nuke ? 1 : salvo;
    const each = nuke ? damage * salvo * W.nukeUnits : damage;
    const radius = (nuke ? blastRadius * W.nukeRadiusMult : blastRadius) * (b.t8 ? W.rainRadiusMult : 1);
    if (b.t8) {
      // Orbital Rain: the salvo leaves the screen; each warhead crashes down on a marked target in a wider blast.
      const targets = this.missileTargets(p, count);
      for (let i = 0; i < count; i++) {
        const t = targets[i % Math.max(1, targets.length)];
        const jitter = targets.length ? 18 : 260;
        const a = Math.random() * Math.PI * 2;
        const x = (t ? t.x : p.x + Math.cos(p.angle) * 200) + Math.cos(a) * Math.random() * jitter;
        const y = (t ? t.y : p.y + Math.sin(p.angle) * 200) + Math.sin(a) * Math.random() * jitter;
        this.weaponFx.schedule({ x, y, delay: W.rainDelay + i * 0.05, radius, damage: each, hue, source: 'missile', style: nuke ? 'nuke' : 'strike', knock: KNOCKBACK.missile, cluster,
          after: p.weapons.stormProtocol ? (g, ev) => g.fireChainLightning(W.stormChainLevel, ev.x, ev.y) : null });
      }
      this.particles.spawnDirectionalSparks(p.x, p.y, -Math.PI / 2, 0.5, Math.min(20, 3 * count), hue, 12);
      this.particles.spawnShockwave(p.x, p.y, 40, hue, 3, 0.3);
      this.sound.playMissileLaunch?.(count);
      return;
    }
    // Each missile locks its own target: the nearest enemies in range, one each, doubling up only when
    // there are fewer enemies than missiles.
    const targets = this.missileTargets(p, count);
    for (let i = 0; i < count; i++) {
      const launchAngle = p.angle + Math.PI + (Math.random() - 0.5) * 1.8;
      const target = targets.length ? targets[i % targets.length] : null;
      this.missiles.push({
        target,
        aimX: target ? target.x : p.x + Math.cos(p.angle) * W.missileRange,
        aimY: target ? target.y : p.y + Math.sin(p.angle) * W.missileRange,
        x: p.x,
        y: p.y,
        vx: Math.cos(launchAngle) * 7,
        vy: Math.sin(launchAngle) * 7,
        speed: W.missileSpeed * (nuke ? 0.8 : 1),
        damage: each,
        blastRadius: radius,
        hue: nuke ? 30 : hue,
        trail: [],
        life: nuke ? W.missileLife * 1.25 : W.missileLife,
        source: 'missile',
        nuke,
        cluster
      });
    }
    this.missileSalvoFx(p, count);
  }

  // Swarm Missile targets: the nearest `count` enemies within W.missileRange of the ship (missiles and
  // Orbital Rain warheads take one each, repeating when there are fewer).
  missileTargets(p, count) {
    const list = [];
    const range = W.missileRange;
    for (const e of this.enemyManager.enemies) {
      if (e.dead || e.type === 'blackhole') continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < range * range) list.push([d, e]);
    }
    list.sort((a, b) => a[0] - b[0]);
    return list.slice(0, count).map((x) => x[1]);
  }

  // Salvo launch (visual/audio only): a bloom and puff ring behind the hull and an exhaust spray
  // along the launch fan, so a salvo reads as one volley leaving the ship.
  missileSalvoFx(p, count) {
    const fx = this.particles;
    const back = p.angle + Math.PI;
    const rx = p.x + Math.cos(back) * (p.radius * 0.8);
    const ry = p.y + Math.sin(back) * (p.radius * 0.8);
    const hue = missileHue(p);
    fx.spawnFlash?.(rx, ry, 24 + Math.min(count, 8) * 2, hue, 0.2);
    fx.spawnShockwave(rx, ry, 34 + Math.min(count, 8) * 3, hue, 3, 0.3);
    fx.spawnDirectionalSparks(rx, ry, back, 1.9, Math.min(20, 3 * count), hue, 7);
    this.sound.playMissileLaunch?.(count);
  }

  // Missile detonation (visual/audio only): bloom, blast ring with a hot inner ring, sparks, and the
  // missile's exhaust trail handed to the particle system so it keeps glowing after the blast.
  missileBlastFx(m, blast) {
    const fx = this.particles;
    fx.spawnFlash?.(m.x, m.y, blast * 0.42, m.hue, 0.2);
    fx.spawnShockwave(m.x, m.y, blast, m.hue, 4, 0.42);
    fx.spawnShockwave(m.x, m.y, blast * 0.45, 40, 2.5, 0.22);
    fx.spawnExplosionSparks(m.x, m.y, 18, m.hue, 2, 11, 2.2);
    fx.spawnTrail?.(m.trail, m.hue, 1, 0.45);
    this.sound.playMissileImpact?.();
  }

  // One Tesla Arc discharge: a chain (two with Forked Chains), plus Ball Lightning and Thunderstrike
  // when taken. `level` is a build, or a plain level for Storm Protocol's fixed chain. `stat`: run-stats
  // attribution ('storm' for Storm Protocol's chains).
  fireChainLightning(level, originX = this.player.x, originY = this.player.y, stat = 'lightning') {
    const p = this.player;
    // Storm Protocol passes a plain level: no stat ranks or Breakthroughs.
    const bb = typeof level === 'object' ? level : levelBuild('lightning', level);
    const damage = weaponDamage(p, 'lightning', bb);
    this.arcStat = stat; // fireArcChain credits its hits to this run-stats key
    const hitSet = new Set();
    let hits = 0;
    for (let c = 0; c < W.lightningChains(bb); c++) {
      const end = this.fireArcChain(bb, damage, originX, originY, hitSet, c);
      hits += end.hits;
      if (bb.t12 && end.last) {
        // Thunderstrike: the chain's last target is struck from above. It carries strikeShare of the jumps
        // that landed (like Ball Lightning), so a lone target cannot take a full chain's strike.
        this.weaponFx.schedule({ x: end.last.x, y: end.last.y, delay: 0.12, radius: W.strikeRadius * (p.stats.areaMult ?? 1), damage: damage * end.hits * W.strikeShare, hue: ARC_HUE, source: 'lightning', style: 'thunder', knock: KNOCKBACK.lightning, falloff: W.strikeFalloff });
      }
    }
    if (bb.t8 && hits > 0) {
      // Ball Lightning: the orb drops on the nearest enemy, drifts slowly on past it and zaps whatever is
      // nearest. It carries orbShare of the jumps that landed, so a lone target cannot soak every zap of a full chain.
      const t = this.findNearestEnemy(originX, originY);
      const a = t ? Math.atan2(t.y - originY, t.x - originX) : Math.random() * Math.PI * 2;
      const zaps = W.orbZaps;
      this.weaponFx.addOrb({ x: t ? t.x : originX, y: t ? t.y : originY, vx: Math.cos(a) * W.orbDrift, vy: Math.sin(a) * W.orbDrift, life: W.orbLife, zaps, range: W.orbRange,
        damage: damage * hits * W.orbShare / zaps, hue: ARC_HUE });
    }
    if (hits > 0) this.sound.playArcZap?.(hits);
  }

  // A single arc chain from (originX, originY); `hitSet` is shared between forks so they spread out.
  fireArcChain(b, damage, originX, originY, hitSet, fork = 0) {
    const enemies = this.enemyManager.enemies;
    if (enemies.length === 0) return { hits: 0, last: null };
    const bounces = W.lightningJumps(b);
    const range = W.lightningRange(b);
    let currX = originX;
    let currY = originY;
    let last = null;

    let hits = 0;
    for (let jump = 0; jump < bounces; jump++) {
      let bestIdx = -1;
      let bestDistSq = range * range;
      for (let i = 0; i < enemies.length; i++) {
        if (hitSet.has(enemies[i])) continue;
        const dx = enemies[i].x - currX;
        const dy = enemies[i].y - currY;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;
      const target = enemies[bestIdx];
      hitSet.add(target);

      if (jump === 0) this.arcEmitterFx(currX, currY, target.x, target.y);
      this.arcHopFx(currX, currY, target, jump, fork ? ARC_HUE + 40 : ARC_HUE);
      hits++;
      last = target;
      const arc = Math.sqrt(bestDistSq) || 1;
      const kx = ((target.x - currX) / arc) * KNOCKBACK.lightning;
      const ky = ((target.y - currY) / arc) * KNOCKBACK.lightning;
      currX = target.x;
      currY = target.y;

      this.hitEnemy(target, damage, 'lightning', kx, ky, 1, this.arcStat || 'lightning');
    }
    return { hits, last };
  }

  // Tesla Arc emitter: a violet bloom and a tight ring where the chain leaves, plus two short
  // crackle stubs licking off the emitter (visual only).
  arcEmitterFx(x, y, tx, ty) {
    const fx = this.particles;
    const a = Math.atan2(ty - y, tx - x);
    fx.spawnFlash?.(x, y, 30, ARC_HUE, 0.2);
    fx.spawnShockwave(x, y, 38, ARC_HUE, 2.5, 0.24);
    for (let k = -1; k <= 1; k += 2) {
      const sa = a + k * (0.9 + Math.random() * 0.7);
      const r = 22 + Math.random() * 14;
      fx.spawnLightning(x, y, x + Math.cos(sa) * r, y + Math.sin(sa) * r, ARC_HUE, 0.55, 0.16, 0);
    }
  }

  // One chain hop: the bolt (slightly thinner down the chain), then an impact bloom, a cross flare,
  // sparks thrown along the bolt and a crackle stub on the struck hull (visual only).
  arcHopFx(x, y, target, hop, hue = ARC_HUE) {
    const fx = this.particles;
    const a = Math.atan2(target.y - y, target.x - x);
    fx.spawnLightning(x, y, target.x, target.y, hue, Math.max(0.75, 1.3 - hop * 0.06));
    fx.spawnFlash?.(target.x, target.y, 16 + target.radius * 0.9, ARC_HUE, 0.2);
    fx.spawnImpact(target.x, target.y, a, 10 + target.radius * 0.5, 0.14);
    fx.spawnDirectionalSparks(target.x, target.y, a, 1.6, 6, ARC_HUE, 8);
    const sa = a + (Math.random() - 0.5) * 2.4;
    const r = target.radius + 12 + Math.random() * 14;
    fx.spawnLightning(target.x, target.y, target.x + Math.cos(sa) * r, target.y + Math.sin(sa) * r, ARC_HUE, 0.5, 0.14, 0);
  }

  fireSingularity(b = weaponBuild(this.player, 'singularity')) {
    const p = this.player;
    if (typeof b === 'number') b = weaponBuild(p, 'singularity', b);
    const target = this.findNearestEnemy(p.x, p.y);
    const angle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.angle;
    // Twin Singularities: the second core heads for the nearest enemy on the far side (over 100 degrees
    // from the first) so the two pulls never half-overlap; with nobody back there it stacks on the first.
    const count = W.singularityCount(b);
    const angles = [angle];
    if (count > 1) {
      const far = this.findNearestEnemyAway(p.x, p.y, angle, 1.75, 700);
      if (far) angles.push(Math.atan2(far.y - p.y, far.x - p.x));
      else angles.push(angle);
    }
    const pullRadius = singularityPullRadius(p, b) * (count > 1 ? W.twinPullScale : 1);
    const life = W.singularityLife(b);
    for (let k = 0; k < count; k++) {
      const a = angles[k] ?? angle;
      this.singularities.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * 4.2,
        vy: Math.sin(a) * 4.2,
        radius: W.singularityCoreRadius(b),
        pullRadius,
        // Event-horizon shred per tick is modest so the swarm survives long enough to clump;
        // the payoff is the collapse pulse over 85% of the pull radius.
        damage: weaponDamage(p, 'singularity', b),
        collapseRadius: pullRadius * W.singularityCollapseRadiusFrac,
        collapseDamage: weaponDamage(p, 'collapse', b),
        // Aftershock Collapse: a tighter second implosion; Hawking Cascade: mini-singularities on collapse.
        aftershock: b.t8 ? weaponDamage(p, 'collapse', b) * W.aftershockDamageMult(b) / W.singularityCollapseDamageMult(b) : 0,
        cascade: b.t12 ? b : null,
        life,
        maxLife: life,
        spin: 0,
        hue: 290
      });
    }
    this.particles.spawnFlash?.(p.x, p.y, 34, 290, 0.22);
    this.particles.spawnShockwave(p.x, p.y, 60, 290, 3, 0.3, true);
    this.sound.playSingularityLaunch?.();
  }

  // Hawking Cascade: three mini-singularities burst out of a collapse, grind briefly and implode. Each one
  // drifts onto its own enemy within the collapsed core's pull radius (nearest first, never two on one
  // spot: the first usually stays on the clump the core left); minis with nobody left to find spread out.
  spawnCascade(sg) {
    const p = this.player;
    const b = sg.cascade;
    const ratio = weaponDamage(p, 'singularity', b) / W.singularityDamageMult(b);
    const pullRadius = sg.pullRadius * W.cascadePullScale;
    const collapseRadius = sg.collapseRadius * W.cascadeRadiusFrac;
    const targets = this.cascadeTargets(sg.x, sg.y, W.cascadeMinis, sg.pullRadius, collapseRadius);
    // Launch speed that drifts a mini 1 px over its life (the 0.985 per-tick drag in updateSingularities).
    const drift = (1 - Math.pow(0.985, W.cascadeLife * 60)) / 0.015;
    for (let k = 0; k < W.cascadeMinis; k++) {
      const t = targets[k];
      const a = t ? Math.atan2(t.y - sg.y, t.x - sg.x) : (k / W.cascadeMinis) * Math.PI * 2 + Math.random() * 0.6;
      const speed = t ? Math.hypot(t.x - sg.x, t.y - sg.y) / drift : 3;
      this.singularities.push({
        x: sg.x, y: sg.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        radius: sg.radius * 0.6,
        pullRadius,
        damage: W.cascadeDamageMult(b) * ratio,
        collapseRadius,
        collapseDamage: W.cascadeCollapseDamageMult(b) * ratio * (TUNING.singularityCollapseMult ?? 1),
        aftershock: 0,
        cascade: null,
        mini: true,
        life: W.cascadeLife,
        maxLife: W.cascadeLife,
        spin: 0,
        hue: 310
      });
    }
  }

  // Up to `count` nearest enemies within `range` of (x, y), nearest first, none within `spacing` of another pick.
  cascadeTargets(x, y, count, range, spacing) {
    const enemies = this.enemyManager.enemies;
    const out = [];
    for (let k = 0; k < count; k++) {
      let best = null;
      let bestSq = range * range;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead || e.type === 'blackhole') continue;
        const dSq = (e.x - x) ** 2 + (e.y - y) ** 2;
        if (dSq >= bestSq || out.some((q) => (e.x - q.x) ** 2 + (e.y - q.y) ** 2 < spacing * spacing)) continue;
        best = e;
        bestSq = dSq;
      }
      if (!best) break;
      out.push(best);
    }
    return out;
  }

  // Live enemy black holes this tick (reused array; a well killed mid-tick is skipped via e.dead).
  collectGravityWells() {
    const wells = this.gravityWells || (this.gravityWells = []);
    wells.length = 0;
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if ((e.type === 'blackhole' || e.gravityWell) && !e.dead) wells.push(e); // vortexes + the Event Horizon
    }
    return wells;
  }

  // Enemy black holes tug the ship with a share of its own thrust (playerPullShare in gravity.js: 50% at
  // the rim rising to 75% at half radius by default). The summed pull of stacked wells is capped below
  // 100% of thrust, so holding away from any stack of wells always escapes.
  applyWellPullToPlayer(p) {
    const wells = this.gravityWells;
    p.gravityTug = 0;
    if (!wells || wells.length === 0) return;
    const thrust = Math.max(0, p.stats.moveSpeed) * SHIP_THRUST_PER_TICK;
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      if (w.dead) continue;
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const a = playerPullShare(d, pullRadiusOf(w), w.radius) * thrust;
      ax += (dx / d) * a;
      ay += (dy / d) * a;
    }
    const mag = Math.hypot(ax, ay);
    if (mag === 0) return;
    const cap = playerPullCap(p.stats.moveSpeed);
    if (mag > cap) {
      ax *= cap / mag;
      ay *= cap / mag;
    }
    p.vx += ax;
    p.vy += ay;
    p.gravityTug = Math.min(mag, cap);
  }

  // Enemy black holes bend passing shots slightly; speed is preserved so range and damage are unchanged.
  bendProjectilesInWells() {
    const wells = this.gravityWells;
    const strength = TUNING.blackholeBulletBend ?? 0.22;
    if (!wells || wells.length === 0 || strength <= 0) return;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      let ax = 0;
      let ay = 0;
      for (let j = 0; j < wells.length; j++) {
        const w = wells[j];
        if (w.dead) continue;
        const dx = w.x - b.x;
        const dy = w.y - b.y;
        const k = wellPullScale(dx, dy, pullRadiusOf(w), strength * (w.bendMult || 1), w.radius);
        ax += dx * k;
        ay += dy * k;
      }
      if (ax === 0 && ay === 0) continue;
      const speed = Math.hypot(b.vx, b.vy);
      b.vx += ax;
      b.vy += ay;
      const bent = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= speed / bent;
      b.vy *= speed / bent;
    }
  }

  // Grid funnels and spiralling infall streams for every well (visual only).
  updateWellEffects() {
    const radius = TUNING.blackholePullRadius ?? 200;
    const margin = Math.max(420, radius); // streams spawn up to 0.9 × pull radius from their well (the Event Horizon: 400)
    const onScreen = (x, y) => x > this.camX - margin && x < this.camX + this.width + margin &&
      y > this.camY - margin && y < this.camY + this.height + margin;
    for (let i = 0; i < this.gravityWells.length; i++) {
      const w = this.gravityWells[i];
      if (w.dead) continue;
      const r = pullRadiusOf(w);
      this.grid.applyWell(w.x, w.y, BLACKHOLE_GRID_DEPTH, r, w.hue, 0.22);
      if (onScreen(w.x, w.y) && Math.random() < 0.6) this.particles.spawnInfall(w, r * 0.9, w.hue, 1);
    }
    for (let i = 0; i < this.singularities.length; i++) {
      const sg = this.singularities[i];
      this.grid.applyWell(sg.x, sg.y, SINGULARITY_GRID_DEPTH, sg.pullRadius, sg.hue, 0.35);
      if (onScreen(sg.x, sg.y)) this.particles.spawnInfall(sg, sg.pullRadius * 0.9, sg.hue, 2);
    }
    this.updateEliteEntrances(onScreen);
  }

  // An elite materializing on screen: space folds in toward the point (a deepening grid funnel and
  // energy streaming in), a rising charge sound when it starts, and the ground shaking as it lands.
  updateEliteEntrances(onScreen) {
    const spawns = this.enemyManager.spawnIndicators;
    for (let i = 0; i < spawns.length; i++) {
      const sp = spawns[i];
      const c = sp.config;
      if (!sp.onScreen || !(c.isBoss || c.isLieutenant)) continue;
      const t = Math.max(0, Math.min(1, 1 - sp.timer / sp.maxTimer));
      const hue = c.isBoss ? 48 : c.hue;
      const reach = c.isBoss ? 420 : 260;
      if (!sp.chargeCued) {
        sp.chargeCued = true;
        this.sound.playEliteCharge?.(sp.maxTimer, c.isBoss);
      }
      this.grid.applyWell(sp.x, sp.y, (c.isBoss ? 220 : 140) * (0.25 + 0.75 * t), reach, hue, 0.3 + t * 0.4);
      if (onScreen(sp.x, sp.y) && Math.random() < 0.5 + t) this.particles.spawnInfall(sp, reach * (0.9 - t * 0.4), hue, 1 + Math.floor(t * 3));
      if (t > 0.75) this.shake = Math.max(this.shake, (c.isBoss ? 6 : 3) * (t - 0.75) * 4 * (TUNING.screenShakeMult ?? 1));
    }
  }

  // Player Vortex Singularities: drag enemies into a swirling clump, then implode in a damage pulse.
  updateSingularities(dt) {
    const enemies = this.enemyManager.enemies;
    const basePull = TUNING.singularityPull ?? 0.75;
    for (let i = this.singularities.length - 1; i >= 0; i--) {
      const sg = this.singularities[i];
      sg.x += sg.vx;
      sg.y += sg.vy;
      sg.vx *= 0.985;
      sg.vy *= 0.985;
      sg.life -= dt;

      const imploding = sg.life <= SINGULARITY_IMPLODE_TIME;
      if (imploding && !sg.implodeCued) {
        sg.implodeCued = true;
        this.particles.spawnShockwave(sg.x, sg.y, sg.pullRadius, sg.hue, 3, SINGULARITY_IMPLODE_TIME, true);
      }
      sg.spin = (sg.spin || 0) + dt * (imploding ? 16 : 5);
      const pull = basePull * (imploding ? 1.8 : 1);
      this.particles.applyGravityWell(sg.x, sg.y, 1.8, sg.pullRadius);

      const pullSq = sg.pullRadius * sg.pullRadius;
      for (const e of [...enemies].reverse()) {
        if (e.dead) continue;
        const dx = sg.x - e.x;
        const dy = sg.y - e.y;
        const dSq = dx * dx + dy * dy;
        if (dSq >= pullSq) continue;
        if (!e.isBoss) {
          // Inward drag with a vortex twist: the drift bypasses the enemy's own speed cap, and the
          // same pull also bends its steering so flocks turn into the vortex instead of fighting it.
          const k = singularityPullScale(dx, dy, sg.pullRadius, pull, sg.radius);
          e.gvx = (e.gvx || 0) + (dx - dy * 0.35) * k;
          e.gvy = (e.gvy || 0) + (dy + dx * 0.35) * k;
          e.vx += dx * k;
          e.vy += dy * k;
        }
        const reach = sg.radius + e.radius + 18;
        if (dSq < reach * reach) {
          this.hitEnemy(e, sg.damage, 'singularity', 0, 0, 0.5);
        }
      }

      if (sg.life <= 0) {
        this.collapseSingularity(sg);
        this.singularities.splice(i, 1);
      }
    }
  }

  // Orbit Blades: the ring(s) grind whatever they touch. Counter-Rotating Ring adds a wider ring spinning
  // the other way; Blade Fling throws saw discs outward; Nova Ring bursts every blade on a timer.
  updateOrbitals(dt, b) {
    const p = this.player;
    this.orbitalAngle += dt * W.orbitalSpin(b);
    const count = W.orbitalBlades(b);
    const bladeR = W.orbitalBladeRadius(b);
    const damage = weaponDamage(p, 'orbital', b);
    const enemies = this.enemyManager.enemies;
    const rings = this.orbitalRings(b);
    for (const ring of rings) {
      for (let o = 0; o < count; o++) {
        const oa = ring.dir * this.orbitalAngle + ring.offset + (o * Math.PI * 2) / count;
        const ox = p.x + Math.cos(oa) * ring.radius;
        const oy = p.y + Math.sin(oa) * ring.radius;
        // Orbiting blades ONLY shred enemies, never asteroids!
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (e.dead) continue;
          const dx = e.x - ox;
          const dy = e.y - oy;
          const reach = e.radius + bladeR;
          if (dx * dx + dy * dy < reach * reach) {
            // No knockback: blades grind whatever they touch, so pushing targets off would cut their DPS.
            this.particles.spawnExplosionSparks(ox, oy, 3, 150, 2, 7, 1.6);
            if (Math.random() < 0.3) this.particles.spawnFlash?.(ox, oy, 14, 150, 0.1);
            this.sound.playBladeHit?.();
            this.hitEnemy(e, damage, 'orbital', 0, 0, 0.6);
          }
        }
      }
    }
    if (b.t8) {
      this.bladeFlingTimer = (this.bladeFlingTimer ?? W.flingEvery) - dt;
      if (this.bladeFlingTimer <= 0) {
        this.bladeFlingTimer += W.flingEvery;
        const discDamage = damage * W.flingDamageMult(b) / W.orbitalDamageMult(b);
        for (let o = 0; o < count; o++) {
          const oa = this.orbitalAngle + (o * Math.PI * 2) / count;
          const ox = p.x + Math.cos(oa) * rings[0].radius;
          const oy = p.y + Math.sin(oa) * rings[0].radius;
          this.bullets.push({ x: ox, y: oy, vx: Math.cos(oa) * W.flingSpeed, vy: Math.sin(oa) * W.flingSpeed, damage: discDamage, pierce: W.flingPierce,
            life: W.flingLife, radius: bladeR * 0.7, hue: 150, source: 'orbital', knock: 0 });
        }
        this.sound.playBladeHit?.();
      }
    }
    if (b.t12) {
      this.bladeNovaTimer = (this.bladeNovaTimer ?? W.novaEvery) - dt;
      if (this.bladeNovaTimer <= 0) {
        this.bladeNovaTimer += W.novaEvery;
        const novaDamage = damage * W.orbitalNovaDamageMult(b) / W.orbitalDamageMult(b);
        for (let o = 0; o < count; o++) {
          const oa = this.orbitalAngle + (o * Math.PI * 2) / count;
          this.weaponFx.schedule({ x: p.x + Math.cos(oa) * rings[0].radius, y: p.y + Math.sin(oa) * rings[0].radius, delay: 0, radius: W.novaRadius * (p.stats.areaMult ?? 1),
            damage: novaDamage, hue: 150, source: 'orbital', style: 'nova', knock: KNOCKBACK.area * 0.5 });
        }
        this.bladeNovaHide = 0.35;
      }
      this.bladeNovaHide = Math.max(0, (this.bladeNovaHide || 0) - dt);
    }
  }

  // Ring layout of the Orbit Blades: one ring, plus a counter-rotating wider ring with the transform.
  orbitalRings(b) {
    const radius = W.orbitalRadius(b);
    const rings = [{ radius, dir: 1, offset: 0 }];
    if (b.t4) rings.push({ radius: radius * W.counterRadiusMult, dir: -1, offset: Math.PI / W.orbitalBlades(b) });
    return rings;
  }

  collapseSingularity(sg) {
    sg.dead = true;
    const r = sg.collapseRadius ?? sg.pullRadius * 0.85;
    const dmg = sg.collapseDamage ?? sg.damage * 14;
    this.sound.playImplosion();
    this.shake = Math.min(24, Math.max(this.shake, 7 * (TUNING.screenShakeMult ?? 1.0)));
    this.particles.spawnShockwave(sg.x, sg.y, r, sg.hue, 6, 0.45);
    this.particles.spawnShockwave(sg.x, sg.y, r * 0.45, 200, 4, 0.26);
    this.particles.spawnExplosionSparks(sg.x, sg.y, 46, sg.hue, 4, 17, 2.6);
    this.grid.applyImpulse(sg.x, sg.y, 95, r * 1.35, sg.hue);
    // The collapse hits full force at the core and fades to 25% at its rim (singularityCollapseEdgeFalloff).
    this.damageEnemiesInRadius(sg.x, sg.y, r, dmg, sg.hue, 'singularity', KNOCKBACK.area, TUNING.singularityCollapseEdgeFalloff ?? 0.75, 'collapse');
    if (sg.aftershock > 0) {
      this.weaponFx.schedule({ x: sg.x, y: sg.y, delay: W.aftershockDelay, radius: r * W.aftershockRadiusFrac, damage: sg.aftershock, hue: sg.hue,
        source: 'singularity', style: 'implode', knock: KNOCKBACK.area, falloff: TUNING.singularityCollapseEdgeFalloff ?? 0.75, kind: 'collapse' });
    }
    if (sg.cascade) this.spawnCascade(sg);
  }

  triggerLevelUp() {
    this.state = 'UPGRADE';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
    this.sound.playLevelUp();
    this.particles.spawnShockwave(this.player.x, this.player.y, 220, 145, 5, 0.5);
    this.grid.applyImpulse(this.player.x, this.player.y, 45, 220, 145);
    this.grid.ripple?.(this.player.x, this.player.y, 220, 145);

    // Level-up hand: equipped weapons' level-ups and upgrades, general cards, and (while a slot is
    // free) sometimes a NEW WEAPON card that opens a pick of 1 of 3 weapons. A card locked with gold in
    // an earlier hand comes back in its slot (if still valid) in place of one random card.
    this.beginHand();
    this.currentChoices = rollHandAround(this.player, HAND_SIZE, this.handLock, rollLevelUpHand);
    this.runStats?.offered(this.currentChoices);
    this.recordHandOdds();
    if (this.currentChoices.length === 0) {
      const repairs = modeRules(this).shieldRepairs;
      if (repairs) this.player.hp = this.player.maxHp;
      this.score += Math.round(1000 * this.multiplier);
      this.state = 'PLAYING';
      this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
      this.particles.spawnFloatText(this.player.x, this.player.y - 24, repairs ? 'ALL SYSTEMS MAXED // FULL SHIELD REPAIR!' : 'ALL SYSTEMS MAXED // SCORE BONUS!', '#ffcc00', 15);
      return;
    }

    this.setUpgradeHeader('GEOM RESONANCE ACHIEVED', 'SYSTEM EVOLUTION', 'Press <span>[1]</span>-<span>[4]</span>, Click, or D-Pad + <span>A</span> to Evolve');
    this.renderHand();
    document.getElementById('upgrade-modal').classList.remove('hidden');
  }

  // --- Gold: rerolls and card locks on the level-up hand (rules and costs in js/gold.js) -----------

  // New level-up hand: reroll cost back to the base, and a lock carried from the last hand re-checked.
  beginHand() {
    this.handPhase = 'hand';
    this.handRerolls = 0;
    this.handLock = null;
    this.lockNote = '';
    this.banishMode = false;
    this.banishArmed = -1;
    // NEW WEAPON pity counts level-ups, not rerolls: every reroll of this hand starts from here.
    this.handDrought = this.player.newWeaponDrought || 0;
    const carried = this.carriedLock;
    this.carriedLock = null;
    if (!carried) return;
    const card = refreshLockedCard(this.player, carried.card);
    if (card) this.handLock = { card, slot: carried.slot ?? 0 };
    else this.lockNote = `🔒 ${carried.card.name.replace('SYNERGY: ', '')} lock dropped: no longer available`;
  }

  renderHand() {
    this.renderChoiceCards(this.currentChoices.map((upg) => (upg.isNewWeapon ? describeNewWeapon(this.player) : describeUpgrade(this.player, upg))));
    this.renderHandControls();
  }

  addGold(amount) {
    if (!(amount > 0)) return;
    this.gold += amount;
    this.goldEarned += amount;
    const p = this.player;
    if (p) this.particles.spawnFloatText(p.x, p.y - 22, `+${amount} ${GOLD_ICON} GOLD`, '#ffcc00', 12);
    this.flashGold('gain');
    this.updateHUD();
  }

  // Spend gold (never below 0); flashes the counters either way.
  spendGold(amount) {
    if (!trySpend(this, amount)) {
      this.flashGold('short');
      return false;
    }
    this.goldSpent += amount;
    this.flashGold('spend');
    this.updateHUD();
    return true;
  }

  // Re-trigger the flash animation on the HUD and level-up gold counters.
  flashGold(kind) {
    for (const id of ['gold-hud-display', 'hand-gold-count']) {
      const el = globalThis.document?.getElementById(id);
      if (!el?.classList) continue;
      el.classList.remove('gold-flash-gain', 'gold-flash-spend', 'gold-flash-short');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add(`gold-flash-${kind}`);
    }
  }

  // Level-up modal keys: [1]-[4] pick, Shift+[1]-[4] lock/unlock that card, [R] rerolls (R is the
  // radar toggle only during play), [B] then [1]-[4] banishes that card ([B] again or [Esc] cancels).
  handleUpgradeKey(code, shift = false) {
    if (this.state !== 'UPGRADE') return false;
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (digit) {
      const idx = Number(digit[1]) - 1;
      if (this.banishMode) {
        this.banishMode = false;
        return this.banishCard(idx, true);
      }
      return shift ? this.toggleCardLock(idx) : (this.selectUpgrade(idx), true);
    }
    if (code === 'KeyB' && this.canEditHand()) {
      this.banishMode = !this.banishMode;
      this.banishArmed = -1;
      this.renderHandControls();
      return true;
    }
    if (code === 'Escape' && this.banishMode) {
      this.banishMode = false;
      this.renderHandControls();
      return true;
    }
    if (code === 'KeyR') return this.rerollHand();
    return false;
  }

  // Level-up modal controller extras (A still picks the focused card): X rerolls, Y locks or unlocks
  // the focused card. Neither button does anything else in this modal.
  handleUpgradePad(gp) {
    if (this.state !== 'UPGRADE' || !gp) return false;
    if (gp.pressed(PAD.X)) return this.rerollHand();
    if (gp.pressed(PAD.Y)) {
      const idx = (this.choiceCardEls || []).indexOf(this.menuNav?.focused);
      return idx >= 0 ? this.toggleCardLock(idx) : false;
    }
    if (gp.pressed(PAD.RB)) {
      const idx = (this.choiceCardEls || []).indexOf(this.menuNav?.focused);
      return idx >= 0 ? this.banishCard(idx) : false; // first RB arms, second RB on the same card banishes
    }
    return false;
  }

  // BANISH card `index` for banishCost() gold: it never comes up again this run and a fresh card takes
  // its slot. Two steps so a stray click or button can't spend 30 gold: the first arms the card, the
  // second (or `confirmed`, from the keyboard's [B] + digit) banishes it. NEW WEAPON can't be banished.
  banishCard(index, confirmed = false) {
    if (!this.canEditHand()) return false;
    const card = this.currentChoices[index];
    if (!card || card.isNewWeapon) return false;
    if (!confirmed && this.banishArmed !== index) {
      this.banishArmed = index;
      this.renderHandControls();
      return true;
    }
    this.banishArmed = -1;
    if (!this.spendGold(banishCost())) { this.renderHandControls(); return false; }
    this.player.banished[card.id] = true;
    this.runStats?.banish();
    if (this.handLock?.card === card) this.handLock = null;
    const inHand = new Set(this.currentChoices.map((c) => c.id));
    const fresh = rollUpgrades(this.player, 3).find((c) => !inHand.has(c.id));
    if (fresh) this.currentChoices[index] = fresh;
    else this.currentChoices.splice(index, 1);
    if (this.handLock) this.handLock.slot = this.currentChoices.indexOf(this.handLock.card);
    this.lockNote = `✕ ${card.name.replace('SYNERGY: ', '')} banished for the rest of this run`;
    const focusedIndex = this.focusedChoiceIndex();
    this.renderHand();
    if (focusedIndex >= 0) this.focusChoice(Math.min(focusedIndex, this.currentChoices.length - 1));
    this.sound.playExplosion?.(0.6);
    return true;
  }

  canEditHand() {
    return this.state === 'UPGRADE' && this.handPhase === 'hand' && this.currentChoices.length > 0;
  }

  // REROLL: the unlocked cards are replaced by a fresh roll (same gating, NEW WEAPON odds and rarity
  // rolls as a new hand); the locked card stays in its slot. 20, 40, 80... gold within one hand.
  // Card fairness stats: every eligible card's exact chance of being drawn into this hand's random slots
  // (not the NEW WEAPON card or a locked card), and which cards were drawn.
  recordHandOdds() {
    if (!this.runStats) return;
    const lock = this.handLock?.card;
    const drawn = this.currentChoices.filter((c) => !c.isNewWeapon && c !== lock);
    if (!drawn.length) return;
    this.runStats.handOdds(cardInclusionOdds(this.player, drawn.length, lock?.id), drawn);
  }

  // Gold price of the next reroll in this hand (Void Armory: Probability Engine discounts it).
  rerollPrice() {
    return Math.round(rerollCost(this.handRerolls) * (this.player?.rerollCostMult ?? 1));
  }

  rerollHand() {
    if (!this.canEditHand()) return false;
    if (!this.spendGold(this.rerollPrice())) return false;
    this.handRerolls++;
    this.banishArmed = -1;
    this.player.newWeaponDrought = this.handDrought;
    this.currentChoices = rollHandAround(this.player, HAND_SIZE, this.handLock, rollLevelUpHand);
    this.runStats?.reroll();
    this.runStats?.offered(this.currentChoices, this.handLock?.card);
    this.recordHandOdds();
    if (this.handLock) this.handLock.slot = this.currentChoices.indexOf(this.handLock.card);
    const focusedIndex = this.focusedChoiceIndex();
    this.renderHand();
    if (focusedIndex >= 0) this.focusChoice(focusedIndex);
    this.sound.playLevelUp();
    return true;
  }

  // LOCK toggle on card `index`: locking costs gold (moving the lock to another card costs it again,
  // since only one card can be locked); unlocking is free and refunds nothing.
  toggleCardLock(index) {
    if (!this.canEditHand()) return false;
    const card = this.currentChoices[index];
    if (!card) return false;
    if (this.handLock?.card === card) {
      this.handLock = null;
    } else {
      if (!this.spendGold(lockCost())) return false;
      this.handLock = { card, slot: index };
      this.runStats?.lock();
    }
    this.lockNote = '';
    this.renderHandControls();
    return true;
  }

  focusedChoiceIndex() {
    const els = this.choiceCardEls || [];
    return this.gpActive && this.menuNav?.focused ? els.indexOf(this.menuNav.focused) : -1;
  }

  focusChoice(index) {
    const el = (this.choiceCardEls || [])[index];
    if (el && this.gpActive && this.menuNav) this.menuNav.setFocus(el);
  }

  // Gold bar (counter, REROLL button, lock note) and each card's LOCK toggle / LOCKED badge, updated
  // in place so a lock toggle keeps controller focus on its card.
  renderHandControls() {
    const doc = globalThis.document;
    const inHand = this.handPhase === 'hand';
    doc?.getElementById('hand-goldbar')?.classList?.[inHand ? 'remove' : 'add']('hidden');
    doc?.getElementById('upgrade-modal')?.classList?.[this.handPhase === 'weapon' ? 'add' : 'remove']('phase-weapon');
    const count = doc?.getElementById('hand-gold-count');
    if (count) count.textContent = `${GOLD_ICON} ${this.gold} GOLD`;
    const cost = this.rerollPrice();
    const lc = lockCost();
    const reroll = doc?.getElementById('btn-reroll-hand');
    if (reroll) {
      const affordable = this.gold >= cost;
      reroll.disabled = !inHand || !affordable;
      reroll.innerHTML = `↻ REROLL · ${cost} ${GOLD_ICON} <span class="hand-key">[R] / X</span>`;
      reroll.title = affordable ? `Reroll the unlocked cards for ${cost} gold` : `Need ${cost} gold to reroll (you have ${this.gold})`;
    }
    const note = doc?.getElementById('hand-lock-note');
    if (note) {
      const lockedName = this.handLock?.card.name.replace('SYNERGY: ', '');
      const bc = banishCost();
      note.textContent = this.banishMode ? `✕ BANISH MODE: press [1]-[4] to banish that card for ${bc} ${GOLD_ICON} · [B] / [Esc] cancels`
        : this.lockNote
        || (lockedName ? `🔒 ${lockedName} is locked: pick another card and it comes back next level-up`
          : this.touchMode ? `🔒 ${lc} ${GOLD_ICON} keeps a card for next level-up · ✕ ${bc} ${GOLD_ICON} banishes it for the run`
          : `🔒 ${lc} ${GOLD_ICON} locks a card for your next level-up · [Shift+1-4] / Y   ✕ ${bc} ${GOLD_ICON} banishes one for the run · [B]+[1-4] / RB×2`);
      note.classList?.[this.lockNote ? 'add' : 'remove']('dropped');
    }
    (this.choiceCardEls || []).forEach((el, idx) => {
      const locked = !!this.handLock && this.currentChoices[idx] === this.handLock.card;
      el.classList?.[locked ? 'add' : 'remove']('card-locked');
      let badge = el.querySelector?.('.card-lock-badge');
      if (locked && !badge && doc?.createElement) {
        badge = doc.createElement('div');
        badge.className = 'card-lock-badge';
        badge.textContent = '🔒 LOCKED';
        el.appendChild(badge);
      } else if (!locked && badge) badge.remove?.();
      const banish = el.querySelector?.('.card-banish-toggle');
      if (banish) {
        const bc = banishCost();
        const armed = this.banishArmed === idx;
        const nw = !!this.currentChoices[idx]?.isNewWeapon;
        banish.classList?.[nw ? 'add' : 'remove']('hidden');
        banish.classList?.[this.gold >= bc ? 'remove' : 'add']('unaffordable');
        banish.classList?.[armed || this.banishMode ? 'add' : 'remove']('armed');
        banish.textContent = armed ? `✕ CONFIRM ${bc} ${GOLD_ICON}` : `✕ ${bc} ${GOLD_ICON}`;
        banish.title = this.gold >= bc ? `Banish for ${bc} gold: it never comes up again this run (click twice)` : `Need ${bc} gold to banish`;
      }
      const toggle = el.querySelector?.('.card-lock-toggle');
      if (!toggle) return;
      const affordable = locked || this.gold >= lc;
      toggle.textContent = locked ? '🔓 UNLOCK' : `🔒 ${lc} ${GOLD_ICON}`;
      toggle.classList?.[affordable ? 'remove' : 'add']('unaffordable');
      toggle.classList?.[locked ? 'add' : 'remove']('on');
      toggle.setAttribute?.('aria-pressed', String(locked));
      toggle.title = locked ? 'Unlock (no refund)'
        : affordable ? `Lock for ${lc} gold: it stays through rerolls and comes back next level-up if you pick another card`
        : `Need ${lc} gold to lock`;
    });
  }

  setUpgradeHeader(subtitle, title, hint) {
    const modal = document.getElementById('upgrade-modal');
    const sub = modal.querySelector?.('.glitch-subtitle');
    const head = modal.querySelector?.('.upgrade-title');
    const tip = modal.querySelector?.('.upgrade-hint');
    if (sub) sub.textContent = subtitle;
    if (head) head.textContent = title;
    if (tip) tip.innerHTML = hint;
  }

  // Clicks (mouse, or controller A via MenuNavigator) on cards that appeared a moment ago are ignored:
  // the second click of a double-click on NEW WEAPON would otherwise equip a weapon the player never saw.
  renderChoiceCards(descs) {
    // Level-up hands, weapon picks and Breakthroughs all show the current build under the cards.
    const strip = document.getElementById('upgrade-loadout-strip');
    if (strip && this.player) strip.innerHTML = loadoutStripHtml(this.player);
    const container = document.getElementById('upgrade-choices');
    container.innerHTML = '';
    this.closeCardDetail();
    container.classList?.[descs.length >= 4 ? 'add' : 'remove']('cards-4');
    const shownAt = performance.now();
    this.choiceCardEls = [];
    descs.forEach((d, idx) => {
      const view = renderUpgradeCard(d, `[${idx + 1}]`);
      const card = document.createElement('div');
      card.className = view.className;
      card.innerHTML = view.html;
      card.addEventListener('click', () => {
        if (performance.now() - shownAt < CHOICE_CLICK_GUARD_MS) return;
        this.selectUpgrade(idx);
      });
      // Touch play shows compact cards; MORE opens the full card front and centre (hidden on desktop).
      const more = document.createElement('div');
      more.className = 'card-more-btn';
      more.textContent = 'MORE';
      more.addEventListener('click', (e) => {
        e.stopPropagation?.();
        this.openCardDetail(idx, view);
      });
      card.appendChild(more);
      // Gold LOCK toggle (level-up hands only; renderHandControls labels it). Not a <button>, so the
      // controller's focus stays on whole cards: it locks the focused card with Y.
      if (this.handPhase === 'hand') {
        const lock = document.createElement('div');
        lock.className = 'card-lock-toggle';
        lock.setAttribute?.('role', 'button');
        lock.addEventListener('click', (e) => {
          e.stopPropagation?.();
          this.toggleCardLock(idx);
        });
        card.appendChild(lock);
        const banish = document.createElement('div');
        banish.className = 'card-banish-toggle';
        banish.setAttribute?.('role', 'button');
        banish.addEventListener('click', (e) => {
          e.stopPropagation?.();
          this.banishCard(idx);
        });
        card.appendChild(banish);
      }
      container.appendChild(card);
      this.choiceCardEls.push(card);
    });
  }

  // The full card on its own, over the hand, with PICK and BACK (touch play's MORE button).
  openCardDetail(idx, view) {
    const doc = globalThis.document;
    const modal = doc?.getElementById('upgrade-modal');
    if (!modal) return;
    this.closeCardDetail();
    const wrap = doc.createElement('div');
    wrap.id = 'card-detail';
    wrap.className = 'card-detail';
    const card = doc.createElement('div');
    card.className = `${view.className} card-detail-card`;
    card.innerHTML = view.html;
    const actions = doc.createElement('div');
    actions.className = 'card-detail-actions';
    const pick = doc.createElement('button');
    pick.className = 'neon-btn primary-btn';
    pick.textContent = '✓ PICK';
    pick.addEventListener('click', () => {
      this.closeCardDetail();
      this.selectUpgrade(idx);
    });
    const back = doc.createElement('button');
    back.className = 'neon-btn';
    back.textContent = '◀ BACK';
    back.addEventListener('click', () => this.closeCardDetail());
    actions.append(pick, back);
    wrap.append(card, actions);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) this.closeCardDetail(); });
    modal.appendChild(wrap);
    this.sound?.playUiSelect?.();
  }

  closeCardDetail() {
    globalThis.document?.getElementById?.('card-detail')?.remove?.();
  }

  // NEW WEAPON picked: the same modal now offers 1 of 3 unequipped weapons with their LV 1 stats.
  openWeaponPick() {
    this.handPhase = 'weapon';
    this.renderHandControls();
    this.currentChoices = rollWeaponPicks(this.player, 3);
    this.runStats?.offered(this.currentChoices);
    this.runStats?.weaponPickOdds(unownedWeapons(this.player), this.currentChoices);
    if (this.currentChoices.length === 0) {
      this.closeUpgradeModal();
      return;
    }
    const p = this.player;
    this.setUpgradeHeader(`SLOT ${ownedWeapons(p).length + 1} OF ${weaponSlots()} // NEW WEAPON`, 'CHOOSE A WEAPON',
      'Press <span>[1]</span> <span>[2]</span> <span>[3]</span>, Click, or D-Pad + <span>A</span> to Equip');
    this.renderChoiceCards(this.currentChoices.map((c) => describeWeaponPick(p, c.weaponId)));
    // On narrow screens the hand scrolls; start the pick at its header, not where NEW WEAPON was.
    const modal = document.getElementById('upgrade-modal');
    for (const el of [modal, modal.querySelector?.('.modal-card')]) if (el) el.scrollTop = 0;
    // Same modal state, so the controller grace (set on state changes) is restarted by hand.
    this.menuGrace = Math.max(this.menuGrace, CHOICE_CLICK_GUARD_MS / 1000);
    this.sound.playLevelUp();
  }

  // A weapon that reached LV 6 / 12 / 18 without its Breakthrough: open the R&D pick (from a level-up
  // hand, a NEW WEAPON pick or a supply cache). Several milestones queue up, lowest weapon slot first.
  openNextBreakthrough() {
    const p = this.player;
    for (const id of ownedWeapons(p)) {
      const level = pendingBreakthroughs(p, id)[0];
      if (!level) continue;
      this.state = 'UPGRADE';
      this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
      this.handPhase = 'breakthrough';
      this.handLock = null;
      this.breakthrough = { weaponId: id, level };
      markBreakthroughOffered(p, id, level);
      this.currentChoices = ['transform', 'boost'].map((kind) => describeBreakthrough(p, id, level, kind));
      this.runStats?.offered(this.currentChoices);
      this.renderHandControls();
      const name = WEAPON_BY_ID[id].name;
      this.setUpgradeHeader(`⚛ ${name.toUpperCase()} REACHED LV ${level} // R&D BREAKTHROUGH`, 'BREAKTHROUGH',
        `${rdLine(this.rdLineIndex = (this.rdLineIndex || 0) + 1, name)}<br>Press <span>[1]</span> <span>[2]</span>, Click, or D-Pad + <span>A</span> to Choose`);
      this.renderChoiceCards(this.currentChoices);
      const modal = document.getElementById('upgrade-modal');
      modal.classList.remove('hidden');
      for (const el of [modal, modal.querySelector?.('.modal-card')]) if (el) el.scrollTop = 0;
      this.menuGrace = Math.max(this.menuGrace || 0, CHOICE_CLICK_GUARD_MS / 1000);
      this.particles.spawnShockwave(p.x, p.y, 260, 280, 5, 0.5);
      if (this.sound.playBreakthrough) this.sound.playBreakthrough();
      else this.sound.playLevelUp();
      return true;
    }
    return false;
  }

  closeUpgradeModal() {
    this.breakthrough = null;
    if (this.openNextBreakthrough()) return;
    this.currentChoices = [];
    this.handPhase = null;
    this.handLock = null;
    this.closeCardDetail();
    document.getElementById('upgrade-modal').classList.add('hidden');
    document.getElementById('upgrade-modal').classList.remove?.('phase-weapon');
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
    this.processPendingLevelUps();
    this.updateHUD();
  }

  selectUpgrade(index) {
    if (this.state !== 'UPGRADE') return;
    const upg = this.currentChoices[index];
    if (!upg) return;
    const p = this.player;
    this.sound?.playUiConfirm?.();
    this.runStats?.picked(upg);

    // A locked card passed over is guaranteed in the next level-up hand; taking it uses up the lock.
    if (this.handPhase === 'hand' && this.handLock) {
      this.carriedLock = upg === this.handLock.card ? null : { card: this.handLock.card, slot: this.handLock.slot };
      this.handLock = null;
    }

    if (upg.isNewWeapon) {
      this.openWeaponPick();
      return;
    }
    if (upg.isBreakthrough) {
      applyBreakthrough(p, upg.weaponId, upg.level, upg.kind);
      this.particles.spawnFloatText(p.x, p.y - 24, `⚛ ${upg.name.toUpperCase()}!`, upg.color, 16);
      this.particles.spawnShockwave(p.x, p.y, 220, 280, 4, 0.45);
      this.closeUpgradeModal();
      return;
    }
    if (upg.isWeaponPick) {
      acquireWeapon(p, upg.weaponId);
      const weapon = WEAPON_BY_ID[upg.weaponId];
      this.particles.spawnFloatText(p.x, p.y - 24, `${weapon.name.toUpperCase()} EQUIPPED!`, RARITY.weapon.color, 16);
      this.particles.spawnShockwave(p.x, p.y, 180, 186, 4, 0.4);
      this.closeUpgradeModal();
      return;
    }

    const jump = this.applyUpgrade(upg);
    const jumpText = jump > 1 ? ` (+${jump} LEVELS!)` : ' UPGRADED!';
    this.particles.spawnFloatText(p.x, p.y - 24, `${upg.name}${jumpText}`, RARITY[rarityFor(upg, jump)].color, 15);
    this.closeUpgradeModal();
  }

  // --- Weapon loadout (pause-menu panel + HUD strip) --------------------------------------------

  // Pause-menu LOADOUT panel: one card per slot with level, tags and weapon-specific upgrades. DISCARD
  // asks for confirmation in place (CONFIRM / KEEP), then frees the slot so NEW WEAPON cards return.
  // Owned passives (Volatile Shatter) follow the slots in a full-width row: no slot, no discard.
  renderLoadoutPanel() {
    const panel = document.getElementById('pause-loadout');
    if (!panel || !this.player) return;
    const p = this.player;
    const owned = ownedWeapons(p);
    const slots = weaponSlots();
    const count = document.getElementById('pause-loadout-count');
    if (count) count.textContent = `${owned.length} / ${slots} SLOTS`;
    const chips = (id) => weaponTags(id).filter((t) => TAG_INFO[t])
      .map((t) => `<span class="upg-tag" style="--tag:${TAG_INFO[t].color}">${TAG_INFO[t].label}</span>`).join('');
    const html = [];
    for (let i = 0; i < Math.max(slots, owned.length); i++) {
      const id = owned[i];
      if (!id) {
        html.push(`<div class="loadout-slot empty"><div class="loadout-slot-top"><span class="loadout-slot-num">SLOT ${i + 1}</span></div><div class="loadout-empty-text">EMPTY // NEW WEAPON cards show up in level-ups while a slot is free</div></div>`);
        continue;
      }
      const w = WEAPON_BY_ID[id];
      const level = weaponLevel(p, id);
      const lineList = weaponUpgradeLines(p, id);
      const lvText = `LV ${level}${bonusText(bonusLevels(p, w.levelId))}<span class="upg-max"> / ${WEAPON_MAX_LEVEL}</span>`;
      // Its Breakthroughs (transform names, or Across the Board), then its stat cards and evolutions.
      const bt = Object.entries(p.breakthroughs?.[id] || {})
        .map(([m, kind]) => `<span class="loadout-line bt">⚛ ${kind === 'transform' ? TRANSFORMS[id][m].name : BOOST_NAME}</span>`).join('');
      const lines = bt + lineList
        .map((l) => `<span class="loadout-line${l.isSynergy ? ' evo' : ''}">${l.name.replace('SYNERGY: ', '')} ${l.isSynergy ? '★' : `×${l.level}`}</span>`).join('');
      const pending = this.discardPending === id;
      const blocked = this.discardBlocked === id;
      // Lines another equipped weapon still uses (e.g. Cryo Payload with rockets and missiles) stay.
      const removes = lineList.filter((l) => !(UPGRADE_BY_ID[l.id].owners || []).some((o) => o !== id && owned.includes(o)));
      const removeText = removes.length ? ` and ${removes.map((l) => l.name.replace('SYNERGY: ', '')).join(', ')}` : '';
      const actions = blocked
        ? `<div class="loadout-confirm">You need at least one weapon. Equip another weapon before discarding ${w.name}.</div>
          <div class="loadout-actions"><button class="neon-btn loadout-btn" data-discard-ok="${id}">OK</button></div>`
        : pending
        ? `<div class="loadout-confirm">Discard ${w.name}${w.levelId ? ` LV ${level}` : ''}${removeText}? The slot opens for a NEW WEAPON.</div>
          <div class="loadout-actions"><button class="neon-btn loadout-btn danger" data-discard-confirm="${id}">✕ CONFIRM DISCARD</button><button class="neon-btn loadout-btn" data-discard-cancel="${id}">KEEP</button></div>`
        : `<div class="loadout-actions"><button class="neon-btn loadout-btn" data-discard="${id}">DISCARD</button></div>`;
      html.push(`<div class="loadout-slot${pending || blocked ? ' confirming' : ''}" style="--wc:${w.color}">
        <div class="loadout-slot-top"><span class="loadout-slot-num">SLOT ${i + 1}</span><span class="loadout-lv">${lvText}</span></div>
        <div class="loadout-name">${w.name}</div>
        <div class="upg-tags">${chips(id)}</div>
        ${lines ? `<div class="loadout-lines">${lines}</div>` : ''}
        ${weaponReadoutHtml(weaponReadout(p, id, this.runStats))}
        ${actions}
      </div>`);
    }
    for (const id of ownedPassives(p)) {
      const x = PASSIVE_BY_ID[id];
      html.push(`<div class="loadout-slot loadout-passive" style="--wc:${x.color}" data-passive="${id}">
        <div class="loadout-slot-top"><span class="loadout-slot-num">PASSIVE // NO SLOT</span><span class="loadout-lv">LV ${passiveLevel(p, id)}<span class="upg-max"> / ${UPGRADE_BY_ID[x.upgradeId].maxLevel}</span></span></div>
        <div class="loadout-name">${x.name}</div>
        <div class="upg-tags">${chips(id)}</div>
        ${weaponReadoutHtml(weaponReadout(p, id, this.runStats))}
      </div>`);
    }
    panel.innerHTML = html.join('');
    panel.querySelectorAll?.('[data-discard]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-discard');
      // The last weapon can't go: explain why instead of offering a confirm.
      if (ownedWeapons(this.player).length <= 1) {
        this.discardBlocked = id;
        this.renderLoadoutPanel();
        this.focusLoadoutButton(`[data-discard-ok="${id}"]`);
        return;
      }
      this.discardPending = id;
      this.renderLoadoutPanel();
      this.focusLoadoutButton(`[data-discard-cancel="${id}"]`);
    }));
    panel.querySelectorAll?.('[data-discard-ok]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-discard-ok');
      this.discardBlocked = null;
      this.renderLoadoutPanel();
      this.focusLoadoutButton(`[data-discard="${id}"]`);
    }));
    panel.querySelectorAll?.('[data-discard-cancel]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-discard-cancel');
      this.discardPending = null;
      this.renderLoadoutPanel();
      this.focusLoadoutButton(`[data-discard="${id}"]`);
    }));
    panel.querySelectorAll?.('[data-discard-confirm]').forEach((b) => b.addEventListener('click', () => {
      this.confirmDiscard(b.getAttribute('data-discard-confirm'));
    }));
  }

  // Keep keyboard and controller focus on the slot whose buttons were just re-rendered.
  focusLoadoutButton(selector) {
    const el = document.querySelector?.(`#pause-loadout ${selector}`);
    if (!el) return;
    if (this.gpActive && this.menuNav) this.menuNav.setFocus(el);
    else el.focus?.();
  }

  confirmDiscard(id) {
    const removed = discardWeapon(this.player, id);
    this.discardPending = null;
    this.discardBlocked = null;
    if (removed) {
      const w = WEAPON_BY_ID[id];
      this.particles.spawnFloatText(this.player.x, this.player.y - 24, `${w.name.toUpperCase()} DISCARDED // SLOT FREE`, '#ff77b7', 15);
    }
    this.renderLoadoutPanel();
    this.focusLoadoutButton('[data-discard]');
    this.updateHUD();
  }

  triggerGameOver() {
    // The range ship can't die, but nothing from a range run is ever recorded: leave to the title instead.
    if (this.range?.active) {
      this.range.exit();
      return;
    }
    this.state = 'GAMEOVER';
    // The run is over: the mode's TUNING overlay comes off (this.mode still names the run for the results).
    clearTuningOverlay();
    const rules = modeRules(this);
    this.updateGuideToast(); // a pending FIELD GUIDE UPDATED toast doesn't linger behind the results
    this.sound.setMusicState({ intensity: 0.3, muffled: true, boss: 0 });
    if (this.sound.playGameOver) this.sound.playGameOver();
    else this.sound.playSupernova();

    const mins = Math.floor(this.elapsedTime / 60);
    const secs = Math.floor(this.elapsedTime % 60);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const scoreLogBonus = this.score > 100 ? Math.floor(Math.log10(this.score) * 1.4) : 1;
    const runBounty = Math.min(35, Math.max(2, Math.round((this.wave * 0.8 + scoreLogBonus) * this.player.stats.coreDropMult)));
    this.progression.addCores(runBounty);
    const totalEarnedThisRun = this.sessionCores + runBounty;

    const goNameInput = document.getElementById('go-pilot-name');
    const currentPilotName = (goNameInput && goNameInput.value.trim()) || this.progression.data.pilotName;
    if (goNameInput) goNameInput.value = currentPilotName;

    const result = this.progression.recordRun({
      name: currentPilotName,
      score: this.score,
      multiplier: +this.multiplier.toFixed(1),
      wave: this.wave,
      kills: this.kills,
      timeStr,
      mode: this.mode
    });
    this.lastRunHighlightId = result.entryId;
    // The board panel shows the races of the mode just flown.
    if (this.globalBoard?.setMode?.(this.mode)) this.refreshGlobalBoard();
    this.submitGlobalRun({
      name: currentPilotName,
      score: this.score,
      wave: this.wave,
      level: this.player?.level ?? 1,
      kills: this.kills,
      multiplier: this.multiplier,
      time: this.elapsedTime,
      mode: this.mode
    });
    this.lastRunSummary = this.finishRunStats();
    if (this.lastRunSummary) this.submitRunStats(this.lastRunSummary);
    this.setGameOverTab(this.goTab);

    const rankBadge = document.getElementById('go-rank-badge');
    if (rankBadge) {
      const scope = rules.badge ? ` ${rules.label}` : '';
      rankBadge.textContent = result.rank
        ? `★ NEW LOCAL${scope} #${result.rank} ★`
        : `Local${scope} top 8`;
      rankBadge.style.color = result.rank ? 'var(--gold)' : 'var(--text-dim)';
    }

    const subtitle = document.getElementById('gameover-subtitle');
    if (subtitle) subtitle.textContent = rules.badge ? `SHIELD COLLAPSED // ${rules.label} RUN COMPLETE` : 'SHIELD COLLAPSED // SESSION COMPLETE';
    const modeTag = document.getElementById('go-mode-tag');
    if (modeTag) {
      modeTag.textContent = rules.badge || rules.label;
      modeTag.className = `mode-badge mode-${rules.id}`;
      modeTag.title = rules.blurb;
    }

    const statsEl = document.getElementById('gameover-stats');
    statsEl.innerHTML = `
      <div class="go-stat-box">
        <div class="go-stat-label">FINAL SCORE</div>
        <div class="go-stat-val" style="color:var(--cyan)">${this.score.toLocaleString()}</div>
      </div>
      <div class="go-stat-box">
        <div class="go-stat-label">VOID CORES EARNED</div>
        <div class="go-stat-val" style="color:var(--violet)">+${totalEarnedThisRun} ❖ <span style="font-size:11px; color:#b4c6e0;">(${this.sessionCores} looted + ${runBounty} bounty)</span></div>
      </div>
      <div class="go-stat-box">
        <div class="go-stat-label">KILLS // ROCKS MINED</div>
        <div class="go-stat-val" style="color:var(--magenta)">${this.kills} // ${this.rocksMined}</div>
      </div>
      <div class="go-stat-box">
        <div class="go-stat-label">SURVIVAL // WAVE</div>
        <div class="go-stat-val" style="color:var(--emerald)">${timeStr} (W${this.wave})</div>
      </div>
    `;

    this.renderHubUI();
    document.getElementById('gameover-modal').classList.remove('hidden');
  }

  pollGamepad() {
    const pad = readGamepad(this.gpButtons);
    this.gpButtons = pad ? pad.buttons : [];
    if (!pad) {
      this.gpDashLatch = false;
      this.gpBombLatch = false;
      return null;
    }
    if (pad.active) this.gpActive = true;
    return {
      ...pad,
      dash: pad.buttons[PAD.A] || pad.buttons[PAD.LB] || pad.buttons[PAD.LT],
      bomb: pad.buttons[PAD.B] || pad.buttons[PAD.RB] || pad.buttons[PAD.RT]
    };
  }

  // Controller menus: d-pad/left stick moves focus, A selects, Start confirms the screen's main action,
  // B (or Start) resumes from pause. A short grace period stops a held dash press picking a card.
  updateMenuController(gp, dt) {
    if (this.splashOpen) {
      if (gp && [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.START].some(b => gp.pressed(b))) this.splash.dismiss();
      return;
    }
    if (this.tutorialOpen) {
      this.updateTutorialController(gp, dt);
      return;
    }
    if (this.guideOpen) {
      this.updateGuideController(gp, dt);
      return;
    }
    if (this.notesOpen) {
      this.updateNotesController(gp, dt);
      return;
    }
    const menus = {
      TITLE: ['title-modal', 'btn-start-game'],
      UPGRADE: ['upgrade-modal', null],
      CHEST: ['chest-modal', 'btn-claim-chest'],
      PAUSED: ['pause-modal', 'btn-resume-game'],
      GAMEOVER: ['gameover-modal', 'btn-restart-game'],
      RANGE_EDIT: ['range-panel', null] // Weapon Range panel, opened with Back
    };
    if (this.menuState !== this.state) {
      this.menuState = this.state;
      this.menuGrace = 0.3;
      this.menuNav?.clear();
    }
    this.menuGrace = Math.max(0, this.menuGrace - dt);

    const menu = menus[this.state];
    if (!gp || !menu || !this.gpActive || !this.menuNav) return;
    const root = document.getElementById(menu[0]);
    if (!root) return;
    const primary = menu[1] ? document.getElementById(menu[1]) : null;
    // Level-up focus starts on the first card, never on the REROLL button (A must not spend gold).
    const fallback = this.state === 'UPGRADE' ? root.querySelector?.('.upgrade-option') || null
      : this.quitConfirm ? document.getElementById('btn-quit-cancel') : primary;
    this.menuNav.update(root, gp, dt, fallback);
    if (this.menuGrace > 0) return;

    if (this.state === 'RANGE_EDIT' && (gp.pressed(PAD.B) || gp.pressed(PAD.BACK) || gp.pressed(PAD.START))) {
      this.range.view?.endPadEdit();
    } else if (this.state === 'PAUSED' && this.quitConfirm && (gp.pressed(PAD.B) || gp.pressed(PAD.START))) {
      this.cancelAbandonRun(); // B / Start back out of ABANDON RUN? before they resume
    } else if (this.state === 'TITLE' && (gp.pressed(PAD.LB) || gp.pressed(PAD.RB))) {
      // LB / RB step through NORMAL / HARDCORE / BLITZ without leaving LAUNCH.
      this.setSelectedMode(cycleMode(this.selectedMode, gp.pressed(PAD.LB) ? -1 : 1));
      this.sound.playUiSelect?.();
    } else if (this.state === 'PAUSED' && (gp.pressed(PAD.LB) || gp.pressed(PAD.RB)) && this.overview) {
      // LB / RB switch the pause menu tabs; focus follows to the new tab.
      this.overview.cycleTab(gp.pressed(PAD.LB) ? -1 : 1);
      this.sound.playUiSelect?.();
      const tab = root.querySelector?.(`[data-pause-tab="${this.overview.tab}"]`);
      if (tab) this.menuNav.setFocus(tab);
    } else if (this.handleUpgradePad(gp)) {
      this.sound.init();
    } else if (gp.pressed(PAD.A)) {
      this.sound.init();
      this.menuNav.activate();
    } else if (gp.pressed(PAD.START)) {
      this.sound.init();
      if (this.state === 'PAUSED') this.togglePause();
      else if (primary) primary.click();
      else this.menuNav.activate();
    } else if (gp.pressed(PAD.B) && this.state === 'PAUSED') {
      this.togglePause();
    }
  }

  // Geoms never expire, so a long run could pile up thousands. Past MAX_LOOSE_GEOMS loose XP geoms, the
  // oldest folds into its nearest loose neighbour (no XP lost); merged geoms draw a little bigger.
  mergeLooseGeoms() {
    const loose = [];
    for (const g of this.geoms) if (!g.isCore && !g.isGold && !g.magnetized) loose.push(g);
    let excess = loose.length - MAX_LOOSE_GEOMS;
    for (let i = 0; excess > 0; i++, excess--) {
      const g = loose[i];
      let into = null, best = Infinity;
      for (let j = i + 1; j < loose.length; j++) {
        const d = (loose[j].x - g.x) ** 2 + (loose[j].y - g.y) ** 2;
        if (d < best) { best = d; into = loose[j]; }
      }
      into.xp += g.xp;
      into.merged = (into.merged || 0) + (g.merged || 0) + 1;
      this.geoms.splice(this.geoms.indexOf(g), 1);
    }
  }

  update(dt) {
    // A boss-kill hit-stop/slow-mo tick freezes the world, grid and particles together.
    const held = this.state === 'PLAYING' && this.consumeTimeDilation();
    if (!held) {
      this.grid.update(this.camX, this.camY, this.width, this.height);
      this.particles.update(dt, this.worldWidth, this.worldHeight);
      this.damageNumbers?.update(dt);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 45);
    if (this.chromaFlash > 0) this.chromaFlash = Math.max(0, this.chromaFlash - dt * 2.2);
    if (this.bossFlash > 0) this.bossFlash = Math.max(0, this.bossFlash - dt * 2.4);
    this.shieldRotation += dt * 1.4;

    // The guide only lives over the title, pause and game-over screens.
    if (this.guideOpen && !GUIDE_STATES.includes(this.state)) this.closeGuide();
    if (this.notesOpen && !NOTES_STATES.includes(this.state)) this.closeNotes();
    if (this.tutorialOpen && !TUTORIAL_STATES.includes(this.state)) this.closeTutorial();
    const gp = this.pollGamepad();
    const stateBefore = this.state;
    this.updateMenuController(gp, dt);
    if (this.state !== 'PLAYING' || stateBefore !== 'PLAYING') {
      // A button held through a menu must not fire a dash or nova (or re-pause) as play starts.
      this.gpDashLatch = !!gp?.dash;
      this.gpBombLatch = !!gp?.bomb;
      return;
    }

    if (gp?.pressed(PAD.START)) {
      this.togglePause();
      return;
    }

    if (gp?.pressed(PAD.X)) this.toggleAutoFire();
    if (gp?.pressed(PAD.Y)) this.toggleAutoAim();
    if (gp?.pressed(PAD.BACK)) {
      // In the Weapon Range, Back hands the controller to the range panel (the sim holds meanwhile).
      if (this.range?.active) {
        this.range.view?.beginPadEdit();
        return;
      }
      this.toggleRadar();
    }

    if (this.bossCardTimer > 0) this.bossCardTimer = Math.max(0, this.bossCardTimer - dt);
    if (this.ltCardTimer > 0) this.ltCardTimer = Math.max(0, this.ltCardTimer - dt);
    if (held) {
      this.updateHUD();
      return;
    }

    this.elapsedTime += dt;
    this.waveTimer += dt;
    if ((++this.statsTick & 15) === 0) this.syncRunStats();

    const enemyCount = this.enemyManager.enemies.length;
    const dynamicIntensity = Math.min(
      1.0,
      0.32 + (enemyCount / 50) * 0.42 + ((this.multiplier - 1) / 15) * 0.18 + (this.wave - 1) * 0.05
    );
    // Boss warning drops the mix out; a live boss pins it at full intensity with the boss riff.
    const bossStage = this.getBossStage();
    this.sound.setMusicState({ intensity: bossStage === 2 ? 1.0 : dynamicIntensity, muffled: false, boss: bossStage });

    // Weapon Range: dummies and respawns instead of waves, bosses, lieutenants and packs.
    const range = this.range?.active ? this.range : null;
    if (range) range.tick();

    // Escalate waves every `waveLength` seconds (Difficulty Ramp tuning)
    if (!range && this.waveTimer >= (TUNING.waveLength ?? 22)) {
      this.waveTimer = 0;
      this.wave++;
      this.coresDroppedThisWave = 0;
      this.sessionCores += 1;
      this.progression.addCores(1);
      const tier = bossTier(this.wave);
      const flag = tier === 'major' ? '☠ ' : tier ? '⚠ ' : '';
      this.showBanner(`${flag}WAVE ${this.wave} // ${waveTheme(this.wave).name} // +1 ❖ VOID CORE`);

      if (this.asteroidManager.needsReplenish?.()) {
        const repPt = this.spawnAroundPlayer(850, 1400);
        this.asteroidManager.spawnCluster(repPt.x, repPt.y, { x: this.player.x, y: this.player.y, radius: 250 });
        this.asteroidManager.rebuildSpatialHash();
      }

      for (const id of bossesForWave(this.wave, bossBuilt)) {
        this.pendingBossSpawns.push({ id, wave: this.wave, waveScale: this.getWaveScale() });
      }
    }

    // Scheduled encounters retain their wave scaling and get the first free slots.
    if (!range) {
      this.enemyManager.wave = this.wave;
      this.processPendingBossSpawns();
      this.updateLieutenantSchedule();
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0) {
        this.spawnWavePack();
        this.spawnCooldown = this.packInterval();
      }
    }

    const p = this.player;
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (p.shieldFlash > 0) p.shieldFlash = Math.max(0, p.shieldFlash - dt * 2.4);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);

    if (p.hp < p.maxHp && modeRules(this).shieldRegen) {
      p.hp = Math.min(p.maxHp, p.hp + dt * (TUNING.shieldRegenRate ?? 1.2));
    }

    // 1. Player Movement (enemy black holes tug the ship, capped so it can always escape)
    this.collectGravityWells();
    let inputX = 0;
    let inputY = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) inputY -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) inputY += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) inputX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) inputX += 1;

    const touchMove = this.touchMode ? this.touch?.move : null;
    if (touchMove && (touchMove.x || touchMove.y)) {
      inputX = touchMove.x;
      inputY = touchMove.y;
    }

    if (gp) {
      if (Math.abs(gp.moveX) > 0 || Math.abs(gp.moveY) > 0) {
        inputX = gp.moveX;
        inputY = gp.moveY;
      }
      if (gp.dash && !this.gpDashLatch) this.triggerDash();
      this.gpDashLatch = gp.dash;
      if (gp.bomb && !this.gpBombLatch) this.triggerSupernova();
      this.gpBombLatch = gp.bomb;
    }

    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      p.gravityTug = 0; // Dashes cut straight through gravity wells
      this.particles.spawnAfterimage(p.x, p.y, p.angle, p.radius, 188);
    } else {
      const mag = Math.hypot(inputX, inputY);
      if (mag > 0) {
        const nx = inputX / Math.max(1, mag);
        const ny = inputY / Math.max(1, mag);
        p.vx = p.vx * 0.78 + nx * p.stats.moveSpeed * 0.22;
        p.vy = p.vy * 0.78 + ny * p.stats.moveSpeed * 0.22;

        if (Math.random() < 0.65) {
          const moveAngle = Math.atan2(p.vy, p.vx);
          this.particles.spawnDirectionalSparks(
            p.x - Math.cos(moveAngle) * 12,
            p.y - Math.sin(moveAngle) * 12,
            moveAngle + Math.PI,
            0.55,
            1,
            38,
            5.5
          );
        }
      } else {
        p.vx *= 0.82;
        p.vy *= 0.82;
      }
      this.applyWellPullToPlayer(p);
    }

    p.x += p.vx;
    p.y += p.vy;

    const pad = p.radius + 24;
    p.x = Math.max(pad, Math.min(this.worldWidth - pad, p.x));
    p.y = Math.max(pad, Math.min(this.worldHeight - pad, p.y));
    this.grid.applyWake?.(p.x, p.y, p.vx, p.vy);

    const targetCamX = Math.max(0, Math.min(this.worldWidth - this.width, p.x - this.width * 0.5));
    const targetCamY = Math.max(0, Math.min(this.worldHeight - this.height, p.y - this.height * 0.5));
    this.camX += (targetCamX - this.camX) * 0.18;
    this.camY += (targetCamY - this.camY) * 0.18;

    // 2. Player Aiming (Turret) & Crab Drill-Claw Heading
    const worldMouseX = this.mouse.x + this.camX;
    const worldMouseY = this.mouse.y + this.camY;

    // Touch play aims with the right stick and otherwise auto-aims (there is no cursor to follow).
    const touchAim = this.touchMode ? this.touch?.aim : null;
    const touchAiming = !!(touchAim && (touchAim.x || touchAim.y));
    if (gp && (Math.abs(gp.aimX) > 0 || Math.abs(gp.aimY) > 0)) {
      p.angle = Math.atan2(gp.aimY, gp.aimX);
    } else if (touchAiming) {
      p.angle = Math.atan2(touchAim.y, touchAim.x);
    } else if (this.autoAim || this.touchMode) {
      const nearest = this.findAutoAimTarget(p.x, p.y);
      if (nearest) {
        p.angle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      } else if (!this.touchMode) {
        p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      }
    } else if (!this.gpActive) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    } // On a controller with the right stick released, the turret holds its last heading.

    // The hull (and its wings and rocket pods) faces where the ship flies; only the drill arms swing round
    // to the rock being drilled, and otherwise point along the hull.
    const speedMag = Math.hypot(p.vx, p.vy);
    if (speedMag > 0.35) p.hullAngle = turnToward(p.hullAngle ?? p.angle, Math.atan2(p.vy, p.vx), 0.22);
    p.hullAngle ??= p.angle;
    let targetDrillAngle = p.hullAngle;
    if (this.asteroidManager.isDrilling && this.asteroidManager.drillingRocks.length > 0) {
      const rk = this.asteroidManager.drillingRocks[0];
      targetDrillAngle = Math.atan2(rk.y - p.y, rk.x - p.x);
    }
    p.drillAngle = turnToward(p.drillAngle ?? p.hullAngle, targetDrillAngle, 0.22);

    // Spin the Twin Rotary Claw Drills
    const rpm = this.asteroidManager.isDrilling ? 34 : 11;
    p.drillSpin = (p.drillSpin || 0) + dt * rpm;

    // 3. Primary Weapon Firing
    const shouldFire = this.autoFire || this.mouse.down || touchAiming || (gp && (Math.abs(gp.aimX) > 0 || Math.abs(gp.aimY) > 0));
    if (shouldFire && ownsWeapon(p, 'blaster')) {
      this.fireAccumulator += dt * blasterFireRate(p);
      while (this.fireAccumulator >= 1) {
        this.fireAccumulator -= 1;
        this.firePrimaryWeapon();
      }
    }
    if (p.weapons.rockets > 0) {
      this.rocketTimer -= dt;
      if (shouldFire && this.rocketTimer <= 0) {
        const b = weaponBuild(p, 'rockets');
        this.fireWingRockets(b);
        this.rocketTimer = W.wingRocketCooldown(b);
      }
    }

    // 4. Autonomous Weapons
    if (p.weapons.missiles > 0) {
      this.missileTimer -= dt;
      if (this.missileTimer <= 0 && this.missileTargets(p, 1).length > 0) {
        const b = weaponBuild(p, 'missiles');
        this.fireSwarmMissiles(b);
        this.missileTimer = W.missileCooldown(b);
      }
    }

    if (p.weapons.lightning > 0) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0 && this.enemyManager.enemies.length > 0) {
        const b = weaponBuild(p, 'lightning');
        this.fireChainLightning(b);
        this.lightningTimer = W.lightningCooldown(b);
      }
    }

    if (p.weapons.singularity > 0) {
      this.singularityTimer -= dt;
      if (this.singularityTimer <= 0 && this.enemyManager.enemies.length > 0) {
        const b = weaponBuild(p, 'singularity');
        this.fireSingularity(b);
        this.singularityTimer = W.singularityCooldown(b);
      }
    }

    if (p.weapons.orbitals > 0) this.updateOrbitals(dt, weaponBuild(p, 'orbitals'));

    // Deployables (mines, sentry turrets, escort drones) place and fire before the bullet sweep,
    // so their bolts move, bend and collide with everything else this tick.
    this.deployables?.update(dt, this);
    this.grenades?.update(dt, this);
    this.weaponFx?.update(dt, this);

    // 5. Sweep projectiles against enemies and cover in travel order (black holes bend them first).
    this.bendProjectilesInWells();
    this.updateBullets(dt);
    const enemies = this.enemyManager.enemies;

    // 6. Update Homing Swarm Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      // Home on the locked target; if it dies first, fly on to where it was and burst there (no
      // retargeting, so a salvo spends itself on the targets it launched at).
      if (m.target && !m.target.dead) {
        m.aimX = m.target.x;
        m.aimY = m.target.y;
      }
      {
        const desiredAngle = Math.atan2(m.aimY - m.y, m.aimX - m.x);
        const curAngle = Math.atan2(m.vy, m.vx);
        let diff = desiredAngle - curAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const newAngle = curAngle + diff * 0.14;
        m.vx = Math.cos(newAngle) * m.speed;
        m.vy = Math.sin(newAngle) * m.speed;
      }

      m.x += m.vx;
      m.y += m.vy;
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > MISSILE_TRAIL_LEN) m.trail.shift();

      let detonated = m.life <= 0 || m.chain || (m.target?.dead && (m.aimX - m.x) ** 2 + (m.aimY - m.y) ** 2 < 20 * 20);
      for (let j = enemies.length - 1; !detonated && j >= 0; j--) {
        const e = enemies[j];
        if (!e.dead && Math.hypot(e.x - m.x, e.y - m.y) <= e.radius + 10) detonated = true;
      }
      // Asteroids stop missiles: they burst on the rock face instead of flying over it.
      if (!detonated) {
        const rocks = this.asteroidManager.getNearbyAsteroids(m.x, m.y, 1);
        for (let j = 0; j < rocks.length; j++) {
          const r = rocks[j];
          if (r.hp > 0 && (r.x - m.x) ** 2 + (r.y - m.y) ** 2 <= (r.radius + 3) ** 2) { detonated = true; break; }
        }
      }

      if (detonated) {
        const blast = m.blastRadius ?? 75;
        const source = m.source || 'missile';
        if (m.nuke) this.weaponFx.detonate(this, { x: m.x, y: m.y, radius: blast, damage: 0, hue: 30, source, style: 'nuke', knock: 0, falloff: 0 });
        this.missileBlastFx(m, blast);
        if (p.weapons.cryo && source === 'missile') this.particles.spawnShockwave(m.x, m.y, blast * 0.8, 192, 2.5, 0.4);
        this.damageEnemiesInRadius(m.x, m.y, blast, m.damage, m.hue, source, KNOCKBACK.missile);
        if (m.cluster) {
          const c = m.cluster;
          this.weaponFx.hop(this, m.x, m.y, c.count, blast * 0.75, blast * c.spread, Math.max(36, blast * c.radiusFrac), m.damage * c.share, c.delay, 40, source);
        }

        if (p.weapons.stormProtocol && source === 'missile') {
          this.fireChainLightning(W.stormChainLevel, m.x, m.y, 'storm');
        }

        // Sympathetic detonation: other missiles caught in this blast go off where they are.
        for (let j = 0; j < this.missiles.length; j++) {
          const o = this.missiles[j];
          if (o !== m && !o.chain && (o.x - m.x) ** 2 + (o.y - m.y) ** 2 <= blast * blast) o.chain = true;
        }
        this.missiles.splice(i, 1);
      }
    }

    // 7. Update Player Vortex Singularities, then grid funnels & infall streams for every well
    this.updateSingularities(dt);
    this.updateWellEffects();

    // 7b. Damage types: burn ticks, chill and corrode timers (status-effects.js)
    updateStatusEffects(this, dt);

    // 8. Update Enemies & Asteroid Clusters + Auto-Mining Lasers
    // Warned boss spawns tear at the grid harder as their countdown runs out.
    for (const sp of this.enemyManager.spawnIndicators) {
      if (sp.config.isBoss) this.grid.applyImplosion(sp.x, sp.y, 1.2 + 3 * (1 - sp.timer / sp.maxTimer), 210, 348, 0.6);
    }
    this.enemyManager.view = spawnView(this);
    this.enemyManager.relocateSpawn ||= (sp) => this.spawnPoint(sp.config.radius);
    this.enemyManager.update(dt, p, this.bullets, this.grid, this.particles, this.worldWidth, this.worldHeight);
    // Doomed hulls (a serpent body unzipping behind its dead head) pop through the normal kill path.
    // A shed tail (`noReward`) just crumbles away: no score, no drops.
    const doomed = this.enemyManager.doomed;
    if (doomed?.length) {
      for (const e of doomed.splice(0)) {
        if (e.noReward) {
          const i = enemies.indexOf(e);
          if (i !== -1 && !e.dead) {
            e.dead = true;
            enemies.splice(i, 1);
            this.particles.spawnPolygonShatter(e.x, e.y, e.radius, e.sides, e.rotation, e.hue, 0.6);
          }
          continue;
        }
        e.hp = 0;
        e.lastStat ||= 'other';
        this.killEnemy(e, false);
      }
    }
    const arrivals = this.enemyManager.bossArrivals;
    if (arrivals?.length) {
      for (const boss of arrivals) this.onBossArrived(boss);
      arrivals.length = 0;
    }
    if (this.enemyManager.shotsFired !== this.enemyShotsHeard) {
      this.enemyShotsHeard = this.enemyManager.shotsFired;
      this.sound.playEnemyShot?.();
    }
    const ltArrivals = this.enemyManager.lieutenantArrivals;
    if (ltArrivals?.length) {
      for (const lt of ltArrivals) this.onLieutenantArrived(lt);
      ltArrivals.length = 0;
    }
    if (!range) this.updateFieldGuide(dt); // range dummies don't unlock Field Guide entries
    this.asteroidManager.update(dt, p, enemies, this.bullets, (r) => this.onRockShattered(r), this.particles);
    if (this.asteroidManager.eliteGrinds > 0) {
      // Elite grinding a path through rock: a quiet scrape that fades out ~900 px from the ship.
      const am = this.asteroidManager;
      this.sound.playEliteGrind?.(1 - Math.hypot(am.eliteGrindX - p.x, am.eliteGrindY - p.y) / 900);
    }
    if (this.updateEnemyBullets(dt)) return;

    for (const e of range ? [] : [...enemies].reverse()) { // range dummies never touch the ship
      if (e.dead) continue;
      // Contact uses the same hull-hugging outline the shield draws.
      if (shieldTouches(p, TUNING, e.x, e.y, e.radius)) {
        if (p.invuln <= 0) {
          this.damagePlayer(this.contactDamage(e), undefined, enemyKind(e));

          // Sturdy hulls (Bruisers, Lieutenants) bounce off; everything else but bosses pops on impact.
          if (e.sturdy) bounceFromShip(e, p.x, p.y);
          else if (!e.isBoss) this.killEnemy(e);
          if (this.endRunIfDead()) return;
        }
      }
    }

    // 9. Update Relic Supply Caches (Vampire Survivors Chests!)
    // Pickup waits out a boss kill's slow-mo and defeat card so the cache modal never cuts off the payoff.
    const chestsArmed = !(this.slowMoTicks > 0) && !(this.bossCard?.kind === 'defeat' && this.bossCardTimer > 0.45);
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const ch = this.chests[i];
      ch.rotation += dt * 1.8;
      if (chestsArmed && Math.hypot(p.x - ch.x, p.y - ch.y) < p.radius * 2.1 + 18) {
        this.chests.splice(i, 1);
        this.openRelicChest(ch);
        return;
      }
    }

    // 10. Update Geoms & Void Cores. Pickups never expire: you can kite a swarm away and circle back for them.
    this.mergeLooseGeoms();
    for (let i = this.geoms.length - 1; i >= 0; i--) {
      const g = this.geoms[i];
      g.rotation += g.isCore ? 0.12 : g.isGold ? 0.05 : 0.08;

      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      const attractR = g.isCore || g.isGold ? p.stats.magnetRadius * 1.35 : p.stats.magnetRadius;

      if (dist < attractR || g.magnetized) {
        g.magnetized = true;
        const pullSpd = 13.5;
        g.vx = g.vx * 0.75 + (dx / dist) * pullSpd * 0.35;
        g.vy = g.vy * 0.75 + (dy / dist) * pullSpd * 0.35;
      } else {
        // Loose geoms drift into enemy black holes: kill the well to cash in the pile.
        const wells = this.gravityWells;
        if (wells && wells.length) {
          const wellPull = TUNING.blackholePickupPull ?? 0.3;
          for (let w = 0; w < wells.length; w++) {
            const well = wells[w];
            if (well.dead) continue;
            const k = wellPullScale(well.x - g.x, well.y - g.y, pullRadiusOf(well), wellPull, well.radius * 0.6);
            g.vx += (well.x - g.x) * k;
            g.vy += (well.y - g.y) * k;
          }
        }
        g.vx *= 0.92;
        g.vy *= 0.92;
      }

      g.x += g.vx;
      g.y += g.vy;

      if (dist < p.radius * 1.85) {
        if (g.isGold) {
          // Currency only: no XP, no multiplier.
          if (this.sound.playGoldPickup) this.sound.playGoldPickup();
          else this.sound.playGeomPickup(true);
          this.addGold(g.gold || 1);
          this.score += Math.round(10 * this.multiplier);
          this.geoms.splice(i, 1);
          continue;
        }
        this.sound.playGeomPickup(g.isCore);

        if (g.isCore) {
          const amt = g.coreAmount || 1;
          this.sessionCores += amt;
          this.progression.addCores(amt);
          this.particles.spawnFloatText(p.x, p.y - 22, `+${amt} ❖ VOID CORE`, '#d68fff', 14);
        }

        this.multiplier += 0.1 * p.stats.xpMultiplier;
        p.xp += g.xp * p.stats.xpMultiplier;
        this.score += Math.round(10 * this.multiplier);
        this.geoms.splice(i, 1);

        if (p.xp >= p.xpToNext) {
          this.processPendingLevelUps();
          break;
        }
        continue;
      }
    }

    this.updateHUD();
  }

  updateHUD() {
    const p = this.player;
    document.getElementById('score-display').textContent = this.score.toLocaleString();
    document.getElementById('multiplier-display').textContent = `x${this.multiplier.toFixed(1)}`;
    document.getElementById('luck-hud-display').textContent = `🍀 ${Math.round((p.stats.luck || 1) * 100)}% LUCK`;
    document.getElementById('cores-hud-display').textContent = `❖ ${this.sessionCores} CORES (${this.progression.data.cores} BANKED)`;
    const goldHud = document.getElementById('gold-hud-display');
    if (goldHud) goldHud.textContent = `${GOLD_ICON} ${this.gold ?? 0} GOLD`;
    document.getElementById('wave-display').textContent = `WAVE ${this.wave}`;

    const mins = Math.floor(this.elapsedTime / 60);
    const secs = Math.floor(this.elapsedTime % 60);
    document.getElementById('timer-display').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const xpPct = Math.min(100, (p.xp / p.xpToNext) * 100);
    document.getElementById('xp-bar-fill').style.width = `${xpPct}%`;
    document.getElementById('level-display').textContent = `LVL ${p.level}`;

    const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
    const hpFill = document.getElementById('hp-bar-fill');
    hpFill.style.width = `${hpPct}%`;
    hpFill.style.background = hpPct < 35
      ? 'linear-gradient(90deg, #ff2a55, #ff7700)'
      : hpPct < 70
      ? 'linear-gradient(90deg, #ffcc00, #00ff88)'
      : 'linear-gradient(90deg, #00f3ff, #00ffaa)';
    document.getElementById('hp-text').textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;

    const dashReadyPct = p.dashCooldown > 0 ? Math.max(0, (1 - p.dashCooldown / (p.dashCooldownDuration || TUNING.dashCooldownBase)) * 100) : 100;
    document.getElementById('dash-cd').style.width = `${dashReadyPct}%`;
    document.getElementById('bombs-count').textContent = p.bombs;
    if (this.touchMode) this.touch?.setStatus(dashReadyPct / 100, p.bombs);

    // Loadout strip: one chip per weapon slot (equipped weapons in their colour, free slots dashed), with
    // the cards' level wording ("LV 3"). Rarity belongs to a roll, not a weapon, so chips stay
    // rarity-neutral. Every other upgrade is listed in the pause menu (js/run-overview.js), not here.
    const barHtml = weaponChipsHtml(p);
    if (barHtml !== this.weaponBarHtml) {
      this.weaponBarHtml = barHtml;
      document.getElementById('active-weapons-bar').innerHTML = barHtml;
    }

    this.updateBossHUD(this.getBossHudModel());
    this.updateLieutenantHUD();
    this.updateGuideToast();
  }

  // --- Field Guide ---------------------------------------------------------------------------

  // Hostiles in view that were never logged unlock their guide entry (scanned every few ticks).
  updateFieldGuide(dt) {
    if (this.guideToastTimer > 0) this.guideToastTimer = Math.max(0, this.guideToastTimer - dt);
    this.guideScanTick = (this.guideScanTick || 0) + 1;
    if (this.guideScanTick < GUIDE_SCAN_TICKS) return;
    this.guideScanTick = 0;
    const seen = this.progression?.data?.guide?.seen;
    if (!seen) return;
    const view = { x: this.camX, y: this.camY, w: this.width, h: this.height };
    const found = detectEncounters(this.enemyManager.enemies, view, id => seen.includes(id));
    if (found.length) this.logGuideEntries(found);
  }

  // Saves newly met hostiles and (optionally) raises the toast. Returns the ids that were new.
  logGuideEntries(ids, toast = true) {
    const added = this.progression?.unlockGuideEntries?.(ids) || [];
    if (!added.length) return added;
    if (toast) {
      const names = added.map(id => hostileEntry(id)?.name || id.toUpperCase());
      const merge = this.guideToastTimer > 0.4 && this.guideToast;
      this.guideToastSerial = (this.guideToastSerial || 0) + 1;
      this.guideToast = { id: this.guideToastSerial, text: (merge ? [this.guideToast.text, ...names] : names).join(' · ') };
      this.guideToastTimer = GUIDE_TOAST_TIME;
    }
    this.syncGuideBadges();
    return added;
  }

  updateGuideToast() {
    const el = document.getElementById('guide-toast');
    if (!el) return;
    const toast = this.guideToastTimer > 0 && this.state === 'PLAYING' ? this.guideToast : null;
    if (toast && toast.id !== this.guideToastShownId) {
      this.guideToastShownId = toast.id;
      const text = document.getElementById('guide-toast-text');
      if (text) text.textContent = `${toast.text} · [G]`;
    }
    setHidden(el, !toast);
    if (toast) el.classList[this.guideToastTimer < 0.4 ? 'add' : 'remove']('guide-toast-out');
  }

  // "· 2 NEW" on every Field Guide button while unread entries wait.
  syncGuideBadges() {
    const fresh = this.progression?.data?.guide?.fresh.length || 0;
    for (const id of ['guide-badge-title', 'guide-badge-pause', 'guide-badge-go']) {
      const el = document.getElementById(id);
      if (el) el.textContent = fresh ? ` · ${fresh} NEW` : '';
    }
  }

  openGuide({ tab = null, focusId = null } = {}) {
    if (this.guideOpen || this.notesOpen || this.tutorialOpen || !GUIDE_STATES.includes(this.state)) return false;
    this.fieldGuide ||= new FieldGuideUI({
      progression: this.progression,
      getLevels: () => (this.state === 'PAUSED' ? this.player.upgradeLevels : null),
      onClose: () => this.onGuideClosed()
    });
    // Opening with unread entries jumps straight to the first one.
    const fresh = this.progression.data.guide.fresh.find(id => hostileEntry(id));
    const target = focusId ?? fresh ?? null;
    this.guideReturnFocus = document.activeElement;
    this.guideOpen = true;
    this.resetInput();
    this.fieldGuide.open({ tab: target ? 'hostiles' : tab, focusId: target });
    this.guideFocusEl = target ? this.fieldGuide.reveal(target) : null;
    this.menuNav?.clear();
    // Focus moves into the guide so Enter/Space can't click the (now covered) button that opened it.
    (this.guideFocusEl || this.fieldGuide.body).focus?.({ preventScroll: true });
    return true;
  }

  closeGuide() {
    this.fieldGuide?.close();
  }

  onGuideClosed() {
    this.guideOpen = false;
    this.guideFocusEl = null;
    this.menuNav?.clear();
    this.menuState = null;
    this.syncGuideBadges();
    this.guideReturnFocus?.focus?.();
  }

  handleGuideKey(e, onControl) {
    const guide = this.fieldGuide;
    const code = e.code;
    // Keys never reach the screen behind the guide: Tab cycles inside it, and Enter/Space on a control
    // outside it (e.g. RESUME on the pause menu) would otherwise click it and resume the run under the guide.
    const focused = document.activeElement;
    const inGuide = !!focused && guide.root.contains(focused);
    if (code === 'Tab') {
      const stops = [...guide.root.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
      const i = inGuide ? stops.indexOf(focused) : -1;
      const next = i === -1 ? (e.shiftKey ? stops.length - 1 : 0)
        : e.shiftKey ? (i === 0 ? stops.length - 1 : null) : (i === stops.length - 1 ? 0 : null);
      if (next !== null && stops[next]) {
        e.preventDefault();
        stops[next].focus();
      }
      return;
    }
    if (!inGuide && (code === 'Enter' || code === 'NumpadEnter')) {
      e.preventDefault();
      return;
    }
    onControl = onControl && inGuide;
    const page = (guide.body.clientHeight || 400) * 0.85;
    const actions = {
      Escape: () => this.closeGuide(),
      Backspace: () => this.closeGuide(),
      KeyG: () => this.closeGuide(),
      ArrowLeft: () => guide.cycleTab(-1),
      KeyQ: () => guide.cycleTab(-1),
      ArrowRight: () => guide.cycleTab(1),
      KeyE: () => guide.cycleTab(1),
      Digit1: () => guide.setTab('hostiles'),
      Digit2: () => guide.setTab('mechanics'),
      Digit3: () => guide.setTab('weapons'),
      ArrowUp: () => guide.scrollBy(-90),
      ArrowDown: () => guide.scrollBy(90),
      PageUp: () => guide.scrollBy(-page),
      PageDown: () => guide.scrollBy(page),
      Home: () => guide.scrollBy(-1e6),
      End: () => guide.scrollBy(1e6)
    };
    if (code === 'Space' && !onControl) actions.Space = () => guide.scrollBy(e.shiftKey ? -page : page);
    const action = actions[code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !code.startsWith('Arrow') && !code.startsWith('Page')) return;
    action();
  }

  // Controller in the guide: d-pad/left stick moves focus (auto-scrolling), right stick scrolls,
  // LB/RB switch tabs, A activates, B or Start goes back.
  updateGuideController(gp, dt) {
    const guide = this.fieldGuide;
    if (this.menuState !== 'GUIDE') {
      this.menuState = 'GUIDE';
      this.menuGrace = 0.25;
      this.menuNav?.clear();
    }
    this.menuGrace = Math.max(0, this.menuGrace - dt);
    if (!gp || !this.gpActive || !this.menuNav || !guide) return;
    const fallback = this.guideFocusEl?.isConnected ? this.guideFocusEl : guide.activeTabButton();
    this.menuNav.update(guide.root, gp, dt, fallback);
    if (gp.aimY) guide.scrollBy(gp.aimY * 16);
    if (this.menuGrace > 0) return;
    if (gp.pressed(PAD.B) || gp.pressed(PAD.START)) {
      this.closeGuide();
    } else if (gp.pressed(PAD.LB) || gp.pressed(PAD.RB)) {
      guide.cycleTab(gp.pressed(PAD.LB) ? -1 : 1);
      this.guideFocusEl = null;
      this.menuNav.setFocus(guide.activeTabButton());
    } else if (gp.pressed(PAD.A)) {
      this.sound.init();
      this.menuNav.activate();
    }
  }

  // --- Version tag & patch notes -------------------------------------------------------------------

  // Every [data-game-version] element shows GAME_VERSION (title logo, pause, game over, notes header).
  renderVersionTags() {
    document.querySelectorAll?.('[data-game-version]').forEach((el) => { el.textContent = versionLabel(GAME_VERSION); });
  }

  // Glowing NEW on every PATCH NOTES button until this version's notes have been opened.
  syncNotesBadges() {
    const show = !!this.patchNotes?.hasNew();
    document.querySelectorAll?.('[data-notes-badge]').forEach((el) => el.classList.toggle('hidden', !show));
  }

  openNotes() {
    if (this.notesOpen || this.guideOpen || this.tutorialOpen || !NOTES_STATES.includes(this.state) || !this.patchNotes) return false;
    this.notesReturnFocus = document.activeElement;
    if (!this.patchNotes.open()) return false;
    this.notesOpen = true;
    this.resetInput();
    this.menuNav?.clear();
    this.syncNotesBadges();
    // Focus moves into the notes so Enter/Space can't click the (now covered) button that opened them.
    this.patchNotes.body.focus?.({ preventScroll: true });
    return true;
  }

  closeNotes() {
    this.patchNotes?.close();
  }

  onNotesClosed() {
    this.notesOpen = false;
    this.menuNav?.clear();
    this.menuState = null;
    this.syncNotesBadges();
    this.notesReturnFocus?.focus?.();
  }

  // Keyboard in the notes: arrows/PgUp/PgDn scroll, Enter/Space on a version header toggles it,
  // Esc/Backspace close. Like the guide, keys never reach the screen behind it.
  handleNotesKey(e, onControl) {
    const notes = this.patchNotes;
    const code = e.code;
    const focused = document.activeElement;
    const inNotes = !!focused && notes.root.contains(focused);
    if (code === 'Tab') {
      const stops = [...notes.root.querySelectorAll('button:not([disabled])')].filter(el => el.getClientRects().length > 0);
      const i = inNotes ? stops.indexOf(focused) : -1;
      const next = i === -1 ? (e.shiftKey ? stops.length - 1 : 0)
        : e.shiftKey ? (i === 0 ? stops.length - 1 : null) : (i === stops.length - 1 ? 0 : null);
      if (next !== null && stops[next]) {
        e.preventDefault();
        stops[next].focus();
      }
      return;
    }
    if (!inNotes && (code === 'Enter' || code === 'NumpadEnter')) {
      e.preventDefault();
      return;
    }
    onControl = onControl && inNotes;
    const page = (notes.body.clientHeight || 400) * 0.85;
    const actions = {
      Escape: () => this.closeNotes(),
      Backspace: () => this.closeNotes(),
      ArrowUp: () => notes.scrollBy(-90),
      ArrowDown: () => notes.scrollBy(90),
      PageUp: () => notes.scrollBy(-page),
      PageDown: () => notes.scrollBy(page),
      Home: () => notes.scrollBy(-1e6),
      End: () => notes.scrollBy(1e6)
    };
    if (code === 'Space' && !onControl) actions.Space = () => notes.scrollBy(e.shiftKey ? -page : page);
    const action = actions[code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !code.startsWith('Arrow') && !code.startsWith('Page')) return;
    action();
  }

  // Controller in the notes: d-pad/left stick walks the version headers and note groups (scrolling with
  // them), right stick scrolls, A opens/closes a version, B or Start goes back.
  updateNotesController(gp, dt) {
    const notes = this.patchNotes;
    if (this.menuState !== 'NOTES') {
      this.menuState = 'NOTES';
      this.menuGrace = 0.25;
      this.menuNav?.clear();
    }
    this.menuGrace = Math.max(0, this.menuGrace - dt);
    if (!gp || !this.gpActive || !this.menuNav || !notes?.root) return;
    this.menuNav.update(notes.root, gp, dt, notes.firstHead());
    if (gp.aimY) notes.scrollBy(gp.aimY * 16);
    if (this.menuGrace > 0) return;
    if (gp.pressed(PAD.B) || gp.pressed(PAD.START)) {
      this.closeNotes();
    } else if (gp.pressed(PAD.A)) {
      this.sound.init();
      this.menuNav.activate();
    }
  }

  // --- Tutorial ------------------------------------------------------------------------------------

  // The browser boot shows the splash on every load; the title waits behind it.
  showSplash() {
    if (this.state === 'TITLE' && this.splash?.show()) {
      this.splashOpen = true;
      this.resetInput();
    }
    return this;
  }

  // The dismissing key / tap / button is a user gesture: audio can start. Menus get a fresh grace
  // period so the same controller press doesn't also hit LAUNCH.
  onSplashDismissed() {
    this.splashOpen = false;
    this.sound?.init?.();
    this.menuState = null;
    this.menuNav?.clear();
  }

  // The browser boot switches this on: the first LAUNCH on a device (the tutorial was never skipped or
  // finished here) shows the tutorial before the run. Headless tests and tools leave it off.
  enableFirstLaunchTutorial() {
    this.tutorialOnLaunch = true;
    return this;
  }

  openTutorial({ launchAfter = false } = {}) {
    if (this.tutorialOpen || this.guideOpen || this.notesOpen || !TUTORIAL_STATES.includes(this.state) || !this.tutorial) return false;
    this.tutorialReturnFocus = document.activeElement;
    this.closeMobileWindows();
    if (!this.tutorial.open()) return false;
    this.tutorialOpen = true;
    this.tutorialLaunchAfter = launchAfter;
    this.resetInput();
    this.menuNav?.clear();
    // Focus moves into the tutorial so Enter/Space can't click the (now covered) button that opened it.
    this.tutorial.nextBtn?.focus?.({ preventScroll: true });
    return true;
  }

  closeTutorial() {
    this.tutorial?.close();
  }

  // Opened by the first LAUNCH: SKIP or LET'S FLY carries on into the run (the Field Guide button
  // stays on the title instead).
  onTutorialClosed(reason) {
    const launch = this.tutorialLaunchAfter && (reason === 'skip' || reason === 'done') && this.state === 'TITLE';
    this.tutorialOpen = false;
    this.tutorialLaunchAfter = false;
    this.menuNav?.clear();
    this.menuState = null;
    this.tutorialReturnFocus?.focus?.();
    if (launch) this.startGame();
  }

  // Keyboard in the tutorial: ←/→ change slides, Enter/Space go on (or press the focused button),
  // Esc skips. Like the guide, keys never reach the screen behind it.
  handleTutorialKey(e, onControl) {
    const tut = this.tutorial;
    const code = e.code;
    const focused = document.activeElement;
    const inTutorial = !!focused && tut.root.contains(focused);
    if (code === 'Tab') {
      const stops = [...tut.root.querySelectorAll('button:not([disabled])')].filter(el => el.getClientRects().length > 0);
      const i = inTutorial ? stops.indexOf(focused) : -1;
      const next = i === -1 ? (e.shiftKey ? stops.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
      e.preventDefault();
      stops[next]?.focus();
      return;
    }
    if (onControl && inTutorial && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) return;
    const actions = {
      Escape: () => tut.close('skip'),
      Backspace: () => tut.close('skip'),
      ArrowRight: () => tut.go(tut.index + 1),
      ArrowLeft: () => tut.go(tut.index - 1),
      KeyD: () => tut.go(tut.index + 1),
      KeyA: () => tut.go(tut.index - 1),
      Enter: () => tut.next(),
      NumpadEnter: () => tut.next(),
      Space: () => tut.next()
    };
    const action = actions[code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.sound.init();
    action();
  }

  // Controller in the tutorial: d-pad walks BACK / NEXT (and the Field Guide button on the last
  // slide), A presses it, LB / RB change slides, B skips.
  updateTutorialController(gp, dt) {
    const tut = this.tutorial;
    if (this.menuState !== 'TUTORIAL') {
      this.menuState = 'TUTORIAL';
      this.menuGrace = 0.25;
      this.menuNav?.clear();
    }
    this.menuGrace = Math.max(0, this.menuGrace - dt);
    if (!gp || !this.gpActive || !this.menuNav || !tut?.root) return;
    this.menuNav.update(tut.root, gp, dt, tut.nextBtn);
    if (this.menuGrace > 0) return;
    if (gp.pressed(PAD.B)) {
      tut.close('skip');
    } else if (gp.pressed(PAD.RB)) {
      tut.go(tut.index + 1);
    } else if (gp.pressed(PAD.LB)) {
      tut.go(tut.index - 1);
    } else if (gp.pressed(PAD.A) || gp.pressed(PAD.START)) {
      this.sound.init();
      this.menuNav.activate();
    }
  }

  // Rocket Pod rocket: an orange dart with a flickering exhaust plume, distinct from blaster streaks.
  drawWingRocket(ctx, b) {
    const a = Math.atan2(b.vy, b.vx);
    const c = Math.cos(a), s = Math.sin(a);
    const flame = 9 + Math.random() * 7;
    ctx.strokeStyle = 'hsla(32, 100%, 58%, 0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(b.x - c * 6, b.y - s * 6);
    ctx.lineTo(b.x - c * (6 + flame), b.y - s * (6 + flame));
    ctx.stroke();
    ctx.fillStyle = '#ffd9a8';
    ctx.strokeStyle = 'hsla(22, 100%, 60%, 1)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(b.x + c * 7, b.y + s * 7);
    ctx.lineTo(b.x - c * 5 - s * 3.5, b.y - s * 5 + c * 3.5);
    ctx.lineTo(b.x - c * 3, b.y - s * 3);
    ctx.lineTo(b.x - c * 5 + s * 3.5, b.y - s * 5 - c * 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Swarm micro-missile: a soft exhaust glow under a tapered core trail (drawn in four chunks), then
  // a dart body along its heading with a hue rim, a white-hot nose and a flickering engine bloom.
  drawMissile(ctx, m) {
    if (m.x < this.camX - 260 || m.x > this.camX + this.width + 260 || m.y < this.camY - 260 || m.y > this.camY + this.height + 260) return;
    const vfx = TUNING.vfxIntensity ?? 1;
    const tr = m.trail;
    const n = tr.length;
    if (n > 1) {
      ctx.strokeStyle = `hsla(${m.hue}, 100%, 60%, ${Math.min(1, 0.3 * vfx)})`;
      ctx.lineWidth = 10 * vfx;
      ctx.beginPath();
      ctx.moveTo(tr[0].x, tr[0].y);
      for (let t = 1; t < n; t++) ctx.lineTo(tr[t].x, tr[t].y);
      ctx.stroke();
      const chunks = 4;
      for (let c = 0; c < chunks; c++) {
        const from = Math.floor(((n - 1) * c) / chunks);
        const to = Math.floor(((n - 1) * (c + 1)) / chunks);
        if (to <= from) continue;
        const k = (c + 1) / chunks;
        ctx.strokeStyle = `hsla(${m.hue}, 100%, ${62 + k * 22}%, ${Math.min(1, (0.25 + k * 0.65) * vfx)})`;
        ctx.lineWidth = (1.2 + k * 2.8) * vfx;
        ctx.beginPath();
        ctx.moveTo(tr[from].x, tr[from].y);
        for (let t = from + 1; t <= to; t++) ctx.lineTo(tr[t].x, tr[t].y);
        ctx.stroke();
      }
    }
    const sp = Math.hypot(m.vx, m.vy) || 1;
    const c = m.vx / sp, s = m.vy / sp;
    const L = 10 * vfx, W = 4.4 * vfx;
    const bloom = (6 + Math.random() * 3) * vfx;
    ctx.fillStyle = `hsla(${m.hue}, 100%, 70%, 0.55)`;
    ctx.beginPath();
    ctx.arc(m.x - c * L * 0.8, m.y - s * L * 0.8, bloom, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(m.x + c * L, m.y + s * L);
    ctx.lineTo(m.x - c * L * 0.7 - s * W, m.y - s * L * 0.7 + c * W);
    ctx.lineTo(m.x - c * L * 0.35, m.y - s * L * 0.35);
    ctx.lineTo(m.x - c * L * 0.7 + s * W, m.y - s * L * 0.7 - c * W);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = `hsla(${m.hue}, 100%, 66%, 1)`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // Aegis Orbit Blades, batched: a fading motion-smear arc behind each blade, then one glow pass and
  // one core pass over all saw-triangles.
  drawOrbitBlades(ctx, p) {
    const b = weaponBuild(p, 'orbitals');
    if (this.bladeNovaHide > 0) return; // Nova Ring: the blades just burst and are reforming
    const orbCount = W.orbitalBlades(b);
    const size = 15 * W.orbitalBladeRadius(b) / W.orbitalBladeRadius(levelBuild('orbitals', 1));
    const vfx = TUNING.vfxIntensity ?? 1;
    for (const ring of this.orbitalRings(b)) {
      const orbRadius = ring.radius;
      const angle = (o) => ring.dir * this.orbitalAngle + ring.offset + (o * Math.PI * 2) / orbCount;
      ctx.strokeStyle = `hsla(150, 100%, 55%, ${Math.min(1, 0.22 * vfx)})`;
      ctx.lineWidth = 9 * vfx;
      ctx.beginPath();
      for (let o = 0; o < orbCount; o++) {
        const oa = angle(o);
        const tail = oa - 0.55 * ring.dir;
        ctx.moveTo(p.x + Math.cos(tail) * orbRadius, p.y + Math.sin(tail) * orbRadius);
        ctx.arc(p.x, p.y, orbRadius, tail, oa, ring.dir < 0);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let o = 0; o < orbCount; o++) {
        const oa = angle(o);
        const ox = p.x + Math.cos(oa) * orbRadius;
        const oy = p.y + Math.sin(oa) * orbRadius;
        for (let k = 0; k < 3; k++) {
          const sa = oa * 3 + (k * Math.PI * 2) / 3;
          const vx = ox + Math.cos(sa) * size;
          const vy = oy + Math.sin(sa) * size;
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      }
      ctx.strokeStyle = `hsla(150, 100%, 58%, ${Math.min(1, 0.35 * vfx)})`;
      ctx.lineWidth = 7 * vfx;
      ctx.stroke();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
  }

  drawPlayerShield(ctx, p, beatPulse) {
    drawPlayerShield(ctx, p, beatPulse, TUNING, this.shieldRotation);
  }

  drawCrabShip(ctx, p) {
    drawCrabShip(ctx, p, TUNING, this.asteroidManager.isDrilling);
  }

  drawMinimap(ctx) {
    const mapSize = radarSize(this.width, this.height, this.touchMode ? 0.36 : 0.55);
    const k = mapSize / RADAR_BASE_SIZE; // blips grow with the radar so they stay readable
    const pad = 18;
    const mx = this.width - mapSize - pad;
    const my = this.height - mapSize - pad;
    const scaleX = mapSize / this.worldWidth;
    const scaleY = mapSize / this.worldHeight;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 9, 22, 0.62)'; // see-through enough that action under the big radar still reads
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(mx, my, mapSize, mapSize);
    ctx.strokeRect(mx, my, mapSize, mapSize);

    // 1. Asteroid Clusters & Rich Veins. The field has ~940 small rocks (about twice the old count), so
    // blips are thinned to about the old density: every 4th plain rock, every 2nd gold or shield vein
    // (as before), and every deep core vein (rare and worth a Void Core).
    // One pass per color, so the fill style is set three times a frame instead of once per blip.
    const rocks = this.asteroidManager.asteroids;
    for (const [color, ores] of RADAR_ROCK_COLORS) {
      ctx.fillStyle = color;
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i];
        if (!ores.includes(r.oreType) || (i & RADAR_ROCK_STRIDE[r.oreType]) !== 0) continue;
        const sz = (r.oreType !== 'rock' ? 2.2 : 1.5) * k;
        ctx.fillRect(mx + r.x * scaleX, my + r.y * scaleY, sz, sz);
      }
    }

    // 2. Relic Supply Caches on Radar (Bright Pulsing Gold Squares)
    for (let i = 0; i < this.chests.length; i++) {
      const ch = this.chests[i];
      ctx.fillStyle = '#ffee00';
      ctx.fillRect(mx + ch.x * scaleX - 3 * k, my + ch.y * scaleY - 3 * k, 6 * k, 6 * k);
    }

    // 3. Enemies on Radar
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      ctx.fillStyle = e.isBoss ? '#ff2a55' : e.isLieutenant ? '#eef2ff' : 'rgba(255, 0, 127, 0.75)';
      const sz = (e.isBoss ? 4 : e.isLieutenant ? 3.2 : 1.8) * k;
      ctx.fillRect(mx + e.x * scaleX - sz * 0.5, my + e.y * scaleY - sz * 0.5, sz, sz);
    }

    // Boss warnings: a pulsing hazard ring on each reserved spawn point
    const indicators = this.enemyManager.spawnIndicators;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < indicators.length; i++) {
      const sp = indicators[i];
      if (!sp.config.isBoss) continue;
      ctx.strokeStyle = Math.cos(sp.timer * Math.PI * 5) > 0 ? '#ff2a55' : '#ffcc00';
      ctx.beginPath();
      ctx.arc(mx + sp.x * scaleX, my + sp.y * scaleY, (4 + (sp.timer % 0.5) * 8) * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Camera Viewport Box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      mx + this.camX * scaleX,
      my + this.camY * scaleY,
      this.width * scaleX,
      this.height * scaleY
    );

    // 5. Player Dot
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(mx + this.player.x * scaleX, my + this.player.y * scaleY, 3.2 * Math.min(k, 2), 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `800 ${Math.round(9 + 2 * (k - 1) / 1.5)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0, 243, 255, 0.75)';
    ctx.fillText('SECTOR RADAR // [R] HIDE', mx + 6, my + 6 + Math.round(9 + 2 * (k - 1) / 1.5));
    ctx.restore();
  }

  // Screen-space boss cues: a pulsing red frame while a warning counts down, and edge arrows toward
  // warned spawn points (with their countdown) and toward live bosses that are off-screen.
  drawBossIndicators(ctx) {
    let soonest = Infinity;
    this.edgeArrowTop = null; // Measured lazily, only on frames that actually draw an edge arrow.
    ctx.save();
    ctx.font = '900 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const indicators = this.enemyManager.spawnIndicators;
    for (let i = 0; i < indicators.length; i++) {
      const sp = indicators[i];
      if (!sp.config.isBoss) continue;
      soonest = Math.min(soonest, sp.timer);
      const flash = Math.cos(sp.timer * Math.PI * 5) > 0;
      this.drawEdgeArrow(ctx, sp.x, sp.y, flash ? '#ff2a55' : '#ffcc00', `⚠ ${sp.timer.toFixed(1)}s`);
    }
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].isBoss) this.drawEdgeArrow(ctx, enemies[i].x, enemies[i].y, '#ffcc00', 'BOSS');
      else if (enemies[i].isLieutenant) this.drawEdgeArrow(ctx, enemies[i].x, enemies[i].y, '#dfe6ff', 'LT');
    }
    if (soonest < Infinity) {
      const pulse = 0.5 + 0.5 * Math.cos(soonest * Math.PI * 5);
      ctx.strokeStyle = `rgba(255, 42, 85, ${0.16 + pulse * 0.38})`;
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, this.width - 14, this.height - 14);
    }
    ctx.restore();
  }

  // Bottom of the top HUD block (+ room for the arrow head) in canvas pixels. The DOM has already been
  // written for this frame, so this read is the same layout the browser would run before painting.
  measureEdgeArrowTop() {
    this.hudTopEl ??= document.querySelector?.('.hud-top') || null;
    const bottom = this.hudTopEl?.getBoundingClientRect?.().bottom;
    return Number.isFinite(bottom) ? bottom + 34 : Math.max(150, this.height * 0.25);
  }

  drawEdgeArrow(ctx, wx, wy, color, label) {
    const sx = wx - this.camX;
    const sy = wy - this.camY;
    if (sx >= 0 && sx <= this.width && sy >= 0 && sy <= this.height) return; // On-screen: the world art reads.
    // Ray from screen centre to the target, clipped to an inset frame whose top edge sits just below
    // the HUD, warning strip and stacked boss bars (measured, so the arrow stays at the edge on any
    // screen height instead of landing on the ship).
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const dx = sx - cx;
    const dy = sy - cy;
    this.edgeArrowTop ??= this.measureEdgeArrowTop();
    const top = Math.min(cy - 40, this.edgeArrowTop);
    const kx = dx > 0 ? (this.width - 46 - cx) / dx : dx < 0 ? (46 - cx) / dx : Infinity;
    const ky = dy > 0 ? (this.height - 46 - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const k = Math.min(kx, ky);
    const ax = cx + dx * k;
    const ay = cy + dy * k;
    const ang = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-12, -16);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-12, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Label sits further inward than the arrow so it never overlaps it, even in corners.
    const lx = ax - Math.cos(ang) * 56;
    const ly = ay - Math.sin(ang) * 34;
    ctx.fillStyle = 'rgba(3, 4, 11, 0.75)';
    ctx.fillRect(lx - 30, ly - 9, 60, 18);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
  }

  draw() {
    const ctx = this.ctx;
    const beatPulse = this.sound.getBeatPulse();

    const rs = this.renderScale ?? 1;
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Afterglow fades per unit time (half per 60 Hz tick). The 0.38 floor keeps high-refresh displays
    // from stacking redrawn glow too bright while still giving them longer trails than before.
    const fade = Math.max(0.38, 1 - Math.pow(0.5, (this.frameSeconds ?? 1 / 60) * 60));
    ctx.fillStyle = `rgba(3, 4, 11, ${fade})`;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    let offsetX = -this.camX;
    let offsetY = -this.camY;
    if (this.shake > 0.2) {
      offsetX += (Math.random() - 0.5) * this.shake;
      offsetY += (Math.random() - 0.5) * this.shake;
    }
    ctx.translate(offsetX, offsetY);

    // 1. Reactive Spring-Mass Neon Grid, lit around the ship (brighter at speed)
    const ship = this.player;
    if (ship && this.state !== 'GAMEOVER') {
      const pace = Math.min(1.6, Math.hypot(ship.vx, ship.vy) / Math.max(1, ship.stats?.moveSpeed ?? 6));
      this.grid.setLight?.(ship.x, ship.y, 260, 0.8 + 0.3 * pace, 188);
    }
    this.grid.draw(ctx, this.camX, this.camY, this.width, this.height);

    // 2. Glowing Outer Sector Boundary Wall
    ctx.save();
    ctx.strokeStyle = `rgba(255, 0, 127, ${0.55 + beatPulse * 0.35})`;
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, this.worldWidth - 24, this.worldHeight - 24);
    ctx.restore();

    // 3. Draw Destructible Asteroid Clusters & Active Mining Laser Beams
    this.asteroidManager.draw(ctx, this.camX, this.camY, this.width, this.height);

    // Event horizons: opaque discs under the additive layer so wells read as holes punched in the grid.
    this.drawWellHorizons(ctx);

    // 4. Draw Geoms, Relic Chests, Singularities, Bullets, Missiles, Enemies & Player in Additive Mode
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Draw Relic Supply Caches (Glowing Golden Rainbow Tesseract Cubes!)
    for (let i = 0; i < this.chests.length; i++) {
      const ch = this.chests[i];
      const rainbowHue = (performance.now() * 0.15 + i * 60) % 360;
      const r = 18 + Math.sin(performance.now() * 0.008) * 2.5;

      ctx.save();
      ctx.translate(ch.x, ch.y);

      // Outer Beacon Ring
      ctx.strokeStyle = `hsla(${rainbowHue}, 100%, 65%, 0.55)`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating Outer Gold Cube
      ctx.rotate(ch.rotation);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 3;
      ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);

      // Counter-Rotating Inner Prismatic Cube
      ctx.rotate(-ch.rotation * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(-r * 0.48, -r * 0.48, r * 0.96, r * 0.96);
      ctx.restore();
    }

    for (let i = 0; i < this.geoms.length; i++) {
      const g = this.geoms[i];
      if (g.x < this.camX - 40 || g.x > this.camX + this.width + 40 || g.y < this.camY - 40 || g.y > this.camY + this.height + 40) continue;
      const alpha = 0.92;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rotation);

      if (g.isCore) {
        const pulseR = 9 + Math.sin(performance.now() * 0.01 + i) * 2;
        ctx.strokeStyle = `hsla(285, 100%, 65%, ${alpha * 0.55})`;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(0, 0, pulseR * 1.15, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `hsla(190, 100%, 80%, ${alpha})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let s = 0; s < 4; s++) {
          const a = (s * Math.PI) / 2;
          const vx = Math.cos(a) * pulseR;
          const vy = Math.sin(a) * pulseR;
          if (s === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = `hsla(290, 100%, 75%, ${alpha})`;
        ctx.strokeRect(-pulseR * 0.55, -pulseR * 0.55, pulseR * 1.1, pulseR * 1.1);
      } else if (g.isGold) {
        // Gold coin: a solid, glowing hexagon with a dark diamond stamped in (XP geoms are hollow outlines).
        const r = 8 + Math.sin(performance.now() * 0.008 + i) * 0.8;
        ctx.fillStyle = `hsla(46, 100%, 52%, ${alpha})`;
        ctx.strokeStyle = `rgba(255, 246, 200, ${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = (s * Math.PI) / 3;
          if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = `rgba(70, 40, 0, ${alpha * 0.85})`;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.5);
        ctx.lineTo(r * 0.36, 0);
        ctx.lineTo(0, r * 0.5);
        ctx.lineTo(-r * 0.36, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.strokeStyle = `hsla(${g.hue}, 100%, 62%, ${alpha})`;
        ctx.lineWidth = 2;
        if (g.merged) { const k = Math.min(2, 1 + Math.log2(1 + g.merged) * 0.2); ctx.scale(k, k); }
        ctx.beginPath();
        ctx.moveTo(0, -6.5);
        ctx.lineTo(5, 0);
        ctx.lineTo(0, 6.5);
        ctx.lineTo(-5, 0);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    for (let i = 0; i < this.singularities.length; i++) {
      this.drawSingularity(ctx, this.singularities[i], beatPulse);
    }

    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b.kind === 'rocket') {
        this.drawWingRocket(ctx, b);
        continue;
      }
      const tailX = b.x - b.vx * 1.4;
      const tailY = b.y - b.vy * 1.4;

      ctx.strokeStyle = `hsla(${b.hue}, 100%, 60%, 0.55)`;
      const w = b.width ?? 1; // drawn thickness only (Autocannon tracers are slimmer than their hitbox)
      ctx.lineWidth = b.radius * 2.2 * w;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.radius * 0.85 * w;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let i = 0; i < this.missiles.length; i++) this.drawMissile(ctx, this.missiles[i]);
    this.weaponFx?.draw(ctx, this);

    this.deployables?.drawGround(ctx, this);
    this.grenades?.drawGround(ctx, this);
    this.enemyManager.draw(ctx, this.camX, this.camY, this.width, this.height);
    drawStatusEffects(ctx, this.enemyManager.enemies, this.camX, this.camY, this.width, this.height);
    this.grenades?.drawAir(ctx, this);

    const p = this.player;
    if (this.state !== 'GAMEOVER') {
      this.drawGravityTethers(ctx, p);
      this.drawPlayerShield(ctx, p, beatPulse);

      if (p.weapons.orbitals > 0) this.drawOrbitBlades(ctx, p);

      this.deployables?.drawEscorts(ctx, this);
      this.drawCrabShip(ctx, p);
    }

    ctx.restore();

    // 5. Draw Sparks, Shatter Shards, Shockwaves & Lightning in World Space
    this.particles.draw(ctx, this.camX, this.camY, this.width, this.height);
    this.damageNumbers.draw(ctx, this.camX, this.camY, this.width, this.height);

    // Close Camera Transform
    ctx.restore();

    // 6. Screen-Space Tactical Sector Radar Minimap & Boss Direction Cues (hidden with the HUD, [H])
    if (!this.hudHidden && (this.state === 'PLAYING' || this.state === 'PAUSED' || this.state === 'UPGRADE' || this.state === 'CHEST')) {
      if (this.radarVisible && !this.touchMode) this.drawMinimap(ctx);
      this.drawBossIndicators(ctx);
    }

    if (this.bossFlash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 214, 110, ${this.bossFlash * 0.16})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    if (this.chromaFlash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(0, 243, 255, ${this.chromaFlash * 0.22})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  singularityCoreRadius(sg) {
    const implode = Math.max(0, 1 - sg.life / SINGULARITY_IMPLODE_TIME);
    return sg.radius * (1 - implode * 0.5);
  }

  drawWellHorizons(ctx) {
    const inView = (x, y, r) => x + r >= this.camX && y + r >= this.camY &&
      x - r <= this.camX + this.width && y - r <= this.camY + this.height;
    ctx.save();
    ctx.fillStyle = 'rgba(1, 1, 5, 0.94)';
    ctx.beginPath();
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if ((e.type !== 'blackhole' && !e.gravityWell) || !inView(e.x, e.y, e.radius)) continue;
      ctx.moveTo(e.x + e.radius * 0.9, e.y);
      ctx.arc(e.x, e.y, e.radius * 0.9, 0, Math.PI * 2);
    }
    for (let i = 0; i < this.singularities.length; i++) {
      const sg = this.singularities[i];
      const r = this.singularityCoreRadius(sg) * 0.95;
      if (!inView(sg.x, sg.y, r)) continue;
      ctx.moveTo(sg.x + r, sg.y);
      ctx.arc(sg.x, sg.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  // Vortex Singularity: pull rim, spinning accretion arcs (thicker on the beat), white photon ring.
  // During the final wind-up the core shrinks and the arcs spin up before the collapse pulse.
  drawSingularity(ctx, sg, beatPulse = 0) {
    const reach = sg.pullRadius + 8;
    if (sg.x + reach < this.camX || sg.y + reach < this.camY || sg.x - reach > this.camX + this.width || sg.y - reach > this.camY + this.height) return;
    const implode = Math.max(0, 1 - sg.life / SINGULARITY_IMPLODE_TIME);
    const coreR = this.singularityCoreRadius(sg);
    ctx.save();
    ctx.translate(sg.x, sg.y);

    ctx.strokeStyle = `hsla(${sg.hue}, 100%, 62%, ${0.16 + beatPulse * 0.14})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, sg.pullRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(sg.spin || 0);
    for (let k = 0; k < 3; k++) {
      const arcR = coreR * (1.75 + k * 0.6);
      const start = k * 2.1;
      ctx.strokeStyle = `hsla(${sg.hue + k * 22}, 100%, ${66 + implode * 20}%, ${0.8 - k * 0.15})`;
      ctx.lineWidth = 2.8 - k * 0.6 + beatPulse * 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, arcR, start, start + 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, arcR, start + Math.PI, start + Math.PI + 1.2);
      ctx.stroke();
    }

    ctx.strokeStyle = `hsla(${sg.hue}, 100%, 70%, 0.5)`;
    ctx.lineWidth = 5 + implode * 4;
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 1.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 + implode * 2;
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Marching dashes from the ship toward each black hole that is tugging it, brighter as the pull grows.
  drawGravityTethers(ctx, p) {
    const wells = this.gravityWells;
    if (!wells || wells.length === 0 || !(p.gravityTug > 0)) return;
    ctx.save();
    ctx.setLineDash([4, 9]);
    ctx.lineDashOffset = -(this.elapsedTime || 0) * 40;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      if (w.dead) continue;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      const f = playerPullShare(d, pullRadiusOf(w), w.radius);
      if (f <= 0 || d < 1) continue;
      const ux = (w.x - p.x) / d;
      const uy = (w.y - p.y) / d;
      ctx.strokeStyle = `hsla(${w.hue}, 100%, 66%, ${0.1 + f * 0.65})`;
      ctx.beginPath();
      ctx.moveTo(p.x + ux * (p.radius + 10), p.y + uy * (p.radius + 10));
      ctx.lineTo(w.x - ux * w.radius * 1.2, w.y - uy * w.radius * 1.2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  loop(now) {
    this.frameSeconds = this.lastFrameAt === undefined ? 1 / 60 : Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    this.frameClock.advance(now, (dt) => this.update(dt));
    this.draw();
    this.touch?.setVisible(this.touchMode && !this.gpActive && this.state === 'PLAYING');
    if (this.state !== this.lastLoopState) {
      // A touch-menu window never outlives its screen.
      this.lastLoopState = this.state;
      this.closeMobileWindows();
    }
    this.overview?.frame(now);
    if (this.state === 'TITLE') this.titleShip?.frame(now);
    requestAnimationFrame((t) => this.loop(t));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => new Game().enableFirstLaunchTutorial().showSplash());
}
