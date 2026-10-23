import { SpatialIndex } from './spatial-index.js';
import { FixedStepClock } from './clock.js';
import { drawPlayerShield, drawCrabShip, shieldTouches, updateShipAnimation, kickShipRecoil, drawShipWake } from './ship-renderer.js';
import { WarpGrid } from './grid.js';
import { DeathSequence, DEATH_TIMING } from './death-sequence.js';
import { ReplayRecorder, ReplayPlayer, REPLAY_SETTINGS } from './replay.js';
import { ParticleSystem } from './particles.js';
import { EnemyManager, BOSS_NAME, contactDamageAt, damageRampAt, waveScaleAt, xpScaleAt, spawnIntervalAt, LIGHT_ENEMY_TYPES } from './enemies.js';
import { pickWavePack, packRoster, hpBudgetScale } from './waves.js';
import { bossTier, isBossWave, bossesForWave, waveTheme, BOSS_SCHEDULE, BOSS_EVERY } from './wave-plan.js';
import { updateBossWarps, drawBossWarps } from './boss-warp.js';
import { playBossCues } from './boss-sfx-major.js';
import { isCampaignWin, resetVictory, tickVictory, showVictory, continueEndless, endVictoriousRun, victoryKey, resultsHeadline } from './victory.js';
import { holdsWave, blocksSpawning, tickFinalStand, finalBossDown, resetFinalStand, finalStandMusic } from './final-stand.js';
import { tickBossEscapes, escapeLeft, BOSS_ESCAPE } from './boss-escape.js';
import { resetScoreBonus, awardWaveBonus, scoreBreakdown } from './score-bonus.js';
import { BOSS_DEFS, BOSS_TIER, bossDef, bossBuilt } from './bosses.js';
import { HOSTILE_INFO, HOSTILE_DEATH_TIER, REPULSOR } from './hostiles.js';
import { SERPENT, spawnSerpent, turnToward as turnAngleToward } from './serpents.js';
import { spawnWing } from './squadrons.js';
import { GATE, gatePylons, beamDistance } from './gates.js';
import { LANCE, beamGap } from './lancers.js';
import { DamageNumbers } from './damage-numbers.js';
import { Deployables } from './deployables.js';
import { Grenades } from './grenades.js';
import { GasTrail } from './gas-trail.js';
import { NaniteSwarm } from './nanites.js';
import { Flamethrower } from './flamethrower.js';
import { ShockField } from './shock-field.js';
import { RailLance } from './rail-lance.js';
import { GlaiveDiscs } from './glaive.js';
import { DrillDriver } from './drill-driver.js';
import * as BTX from './bt-extras.js'; // pool Breakthroughs (Tracer Slugs, Hot Barrel, Shrapnel Shells, ...)
import { QuakeMortar } from './quake-mortar.js';
import { RiftManager } from './rifts.js';
import { AsteroidManager } from './asteroids.js';
import { SoundEngine } from './audio.js';
import { readGamepad, MenuNavigator, PAD } from './gamepad.js';
import {
  UPGRADE_BY_ID, RARITY, rarityFor, rollUpgrades, rollLevelUpHand, cardInclusionOdds, rollWeaponPicks, applyUpgradeLevels, acquireWeapon,
  discardWeapon, snapshotBase, runStartPlayer, HIT_INVULN_BASE, xpToNextLevel, weaponUpgradeLines, applyBreakthrough, pendingBreakthroughs, markBreakthroughOffered,
  MINING_SPEED_STEP, TECTONIC_MINING_SPEED, TECTONIC_MINING_RANGE, TECTONIC_DRILL_SCALE, MOVE_SPEED_STEP } from './upgrades.js';
import {
  WEAPON_SCALING as W, TAG_INFO, weaponDamage, prismStreams, missileBlastRadius, singularityPullRadius, novaRadius, tectonicBlastRadius,
  wingRocketBlastRadius, critChance, critMultiplier, blasterStreams, blasterFireRate, blasterPierce, DPS_TARGET, POTENTIAL_DPS, sourceElement,
  dashCooldownFor, projectileSpeedMult
} from './weapon-scaling.js';
import { weaponBuild, levelBuild, milestonesCrossed, STAT_CARD_BY_ID, WEAPON_MAX_LEVEL, rdLine, RD_LINES, drawBreakthroughOptions, btOption } from './weapon-levels.js';
import { WeaponEffects } from './weapon-fx.js';
import { WEAPONS, STARTING_WEAPONS, START_WEAPON_CHOICES, readStartWeapon, writeStartWeapon, WEAPON_BY_ID, PASSIVE_BY_ID, ownedWeapons, ownedPassives, passiveLevel, ownsWeapon, weaponSlots, weaponLevel, weaponTags, unownedWeapons } from './loadout.js';
import {
  DOT_SOURCES, damageTakenMult as statusTakenMult, isAfflicted, applyOnHitStatuses, updateStatusEffects, drawStatusEffects,
  shockCritBonus, clearStatusArcs
} from './status-effects.js';
import {
  describeUpgrade, describeNewWeapon, describeWeaponPick, describeBreakthrough, renderUpgradeCard, COMPACT_MAX_ROWS, bonusLevels, bonusText,
  slotRewardHtml, slotTipHtml
} from './upgrade-cards.js';
import { handSizeFor, slotReward, slotTip, readSlotTipSeen, writeSlotTipSeen } from './slot-rewards.js';
import { weaponFloor, weaponFloorDue } from './weapon-floor.js';
import { META_UPGRADES, ARMORY_CATEGORIES, ProgressionManager, formatArmoryValue } from './progression.js';
import { GOLD_ICON, goldPerVein, goldCoins, rerollCost, weaponRerollCost, lockCost, banishCost, skipReward, trySpend, refreshLockedCard, rollHandAround } from './gold.js';
import { readyEvolutions, evolutionName } from './evolution-recipes.js';
import { GlobalLeaderboard, buildBoardView, renderBoardView, renderVersionOptions, renderModeOptions, syncTabButtons, describeSubmit, normalizeTab } from './leaderboard.js';
import { GAME_VERSION, versionLabel } from './version.js';
import { PatchNotesUI } from './patch-notes.js';
import { TutorialUI } from './tutorial.js';
import { SplashScreen } from './splash.js';
import { CutsceneStage } from './cutscene-stage.js';
import { RadioBox } from './radio.js';
import { PixieDirector, PIXIE_LOW_SHIELD_FRACTION } from './pixie.js';
import { SCENES, registerStoryCast, readIntroSeen, writeIntroSeen, defaultIntroStorage } from './story.js';
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
import { playPreset, semis } from './sfx-layers.js';
import { GlowSprites } from './glow-sprite.js';
import { loadReduceEffects, saveReduceEffects, setReduceEffects, isReduceEffects, shakeScale, flashScale, particleDensity, burst, hueOf } from './juice.js';
import { kickMount, mountWorld, WINGTIP } from './hardpoints.js';

// Runs flown with dev-tuner changes aren't comparable, so they stay off the global board.
// Sector radar minimap: shown by default; the player's show/hide choice persists (storage may be blocked).
const RADAR_STORAGE_KEY = 'vexolith_radar';
const RADAR_BASE_SIZE = 152;
const RADAR_ROCK_STRIDE = { rock: 7, gold_vein: 1, shield_vein: 1, core_vein: 0, bedrock: 0 }; // bitmask: draw when (index & mask) === 0 (plain rock: every 8th node)
const RADAR_ROCK_COLORS = [['rgba(0, 195, 255, 0.38)', ['rock', 'shield_vein']], ['#ffcc00', ['gold_vein']], ['#d68fff', ['core_vein']], ['rgba(222, 210, 255, 0.85)', ['bedrock']]];
const RADAR_SCALE = 2.5; // on-screen size vs the original 152 px radar
function loadRadarVisible() {
  try { return globalThis.localStorage?.getItem(RADAR_STORAGE_KEY) !== '0'; } catch { return true; }
}
// Radar side in px: 2.5x the original, but never more than 55% of the screen's short side (laptops, phones).
// Touch play passes a smaller share: the thumbs need that corner.
export function radarSize(width, height, shortShare = 0.55) {
  return Math.round(Math.min(RADAR_BASE_SIZE * RADAR_SCALE, shortShare * Math.min(width, height)));
}

const ARMORY_REFUND_CONFIRM_MS = 4000; // REFUND ALL disarms if the confirming click doesn't come in time
const MAX_LOOSE_GEOMS = 400; // loose XP geoms on the field before the oldest start merging (see mergeLooseGeoms)
const GEOM_MERGE_RADIUS = 15; // px: a geom only folds into a loose neighbour this close, so none seem to vanish across the field

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
const ROCKET_CONVERGE = 480; // 320 before v0.39.8: the wingtip streams stay apart from the Autocannon longer
// A Rocket Pod warhead arms this long after launch: with the swarm on the hull, rockets used to burst on
// their first tick at the pod, unseen, under the launch sound. Now every rocket flies clear first.
const ROCKET_ARM_TIME = 0.06;
const ROCKET_DRAW_SCALE = 1.4; // drawn size only (the hitbox stays 4.5 px)
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
// Weapons offered by a NEW WEAPON pick. Level-up hands hold 2-4 cards by weapons equipped (slot-rewards.js).
const WEAPON_PICK_SIZE = 3;
const SINGULARITY_GRID_DEPTH = 340;
// Swarm Missile colour: orange-gold, turning pink once Storm Protocol charges them with lightning.
const missileHue = (p) => (p.weapons.stormProtocol ? 325 : 42);

// Boss encounters: warning telegraph -> arrival title card -> HUD health bars -> defeat payoff.
const BOSS_RANKS = ['WARDEN', 'SENTINEL', 'TYRANT', 'SOVEREIGN', 'ANNIHILATOR'];
const BOSS_CARD_TIME = 2.8;
const LOW_SHIELD_PCT = 0.3; // below this share of the shield the screen edges pulse red
// Supernova bomb pickups (v0.46: the spare bomb left the Geom Attractor card): a rare drop, scaled by Luck.
// Lieutenants drop one most often; void wells and hulks now and then. Bosses still add one straight away.
export const BOMB_DROP = Object.freeze({ lieutenant: 0.35, blackhole: 0.04, hulk: 0.02, max: 9 });
const NOVA_CALLOUT_TIME = 5; // first boss of a run: the "don't forget your bombs" reminder
const BOSS_BAR_ROWS = 3;
const CHOICE_CLICK_GUARD_MS = 300; // level-up / weapon-pick cards ignore clicks this soon after appearing

// "WAVE 3 WARDEN", "WAVE 6 SENTINEL", ...: the rank climbs with each scheduled three-wave encounter.
export function bossEpithet(wave) {
  const rank = BOSS_RANKS[Math.max(0, Math.min(BOSS_RANKS.length - 1, Math.floor(wave / BOSS_EVERY) - 1))];
  return `WAVE ${wave} ${rank}`;
}

// Choice cards deal in one after another (css: card-deal); rare and better ones get a shimmer sweep.
// Pulsing cards get their glow on a layer of its own (css: .card-glow), first so the card's ribbons and
// shimmer stay above it.
const GLOW_CARDS = /\b(rarity-floored|breakthrough-card|new-weapon-card)\b/;
function addCardGlow(card, className, doc = globalThis.document) {
  if (!GLOW_CARDS.test(className) || !doc?.createElement || !card.insertBefore) return;
  const glow = doc.createElement('span');
  glow.className = 'card-glow';
  glow.setAttribute?.('aria-hidden', 'true');
  card.insertBefore(glow, card.firstChild ?? null);
}

function dealInCard(card, idx, className, doc = globalThis.document) {
  card.style?.setProperty?.('--deal-i', idx);
  addCardGlow(card, className, doc);
  if (/rarity-(common|uncommon)\b/.test(className) || !doc?.createElement) return;
  const shimmer = doc.createElement('span');
  shimmer.className = 'card-shimmer';
  shimmer.setAttribute?.('aria-hidden', 'true');
  card.appendChild(shimmer);
}

// Pickup glows: stamped from cached sprites (js/glow-sprite.js) rather than a shadowBlur inside the
// additive layer, which costs a full-canvas blur per coin.
const coinPath = (ctx, r) => {
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3;
    if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
};
const bombPath = (ctx, r) => {
  for (let s = 0; s < 16; s++) {
    const a = (s * Math.PI) / 8;
    const rr = s % 2 ? r * 0.42 : r;
    if (s === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
};
// Game states where the world is paused behind a modal (Game.holdFrozenFrame).
const FROZEN_STATES = new Set(['PAUSED', 'UPGRADE', 'CHEST']);
const GEOM_ALPHA = 0.92;
const COIN_GLOW = Object.freeze({ blur: 12, color: '#ffcc00', fill: `hsla(46, 100%, 52%, ${GEOM_ALPHA})`, path: coinPath });
const BOMB_GLOW = Object.freeze({ blur: 16, color: '#ffcc00', fill: `hsla(48, 100%, 60%, ${GEOM_ALPHA})`, path: bombPath });
const pickupGlows = new GlowSprites();

// Adds or removes a class only when that changes it: the HUD calls these every tick, and even a no-op
// classList.add() rewrites the class attribute.
const setClass = (el, cls, on) => {
  const list = el?.classList;
  if (!list || list.contains?.(cls) === !!on) return;
  list[on ? 'add' : 'remove']?.(cls);
};
const setHidden = (el, hidden) => setClass(el, 'hidden', hidden);

// The HUD is refreshed every tick. Rewriting a text or a width that hasn't changed still invalidates
// style and layout for the frame, so these write only when the value differs from the last one written.
const setText = (el, text) => {
  if (el && el.textContent !== text) el.textContent = text;
};
const setStyle = (el, prop, value) => {
  if (!el) return;
  const last = (el.hudStyle ??= {});
  if (last[prop] === value) return;
  last[prop] = value;
  if (prop.startsWith('--')) el.style.setProperty?.(prop, value);
  else el.style[prop] = value;
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
  SPAWN_MAYFLY: 'mayfly', SPAWN_HULK: 'hulk', SPAWN_SERPENT: 'serpent', SPAWN_KESTREL: 'kestrel', SPAWN_CARRIER: 'carrier', SPAWN_GATE: 'gate', SPAWN_MITOSIS: 'mitosis', SPAWN_REPULSOR: 'repulsor', SPAWN_LANCER: 'lancer', SPAWN_BORER: 'borer', SPAWN_HATCHERY: 'hatchery'
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
    setReduceEffects(loadReduceEffects()); // REDUCE EFFECTS (accessibility, js/juice.js)
    this.radarVisible = loadRadarVisible(); // sector radar minimap, toggled with [R] / controller Back
    this.enemyManager = new EnemyManager();
    this.enemyManager.sound = this.sound; // boss entrance cues and attack tells (js/boss-sfx.js)
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
    this.startWeapon = readStartWeapon(defaultStatsStorage()); // the run-start pick, remembered (js/loadout.js)
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
    // Opening cutscene (js/story.js, played by js/cutscene-stage.js): on the first LAUNCH on a device
    // (enableFirstLaunchIntro, browser boot only) before the tutorial, and from 🎬 INTRO on the title.
    this.cutscene = new CutsceneStage(this);
    this.introOnLaunch = false;
    this.introSeen = readIntroSeen(defaultIntroStorage());
    // Radio (js/radio.js): non-pausing talking-head lines (Game.say); Dr. Pixie (js/pixie.js) cheers every
    // Breakthrough on it. Off until the browser boot switches it on (enableStoryRadio).
    this.radio = new RadioBox({ sound: this.sound });
    this.radioOn = false;
    this.pixie = new PixieDirector({ sound: this.sound });
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
  // `startWeapon`: the weapon picked after LAUNCH (START_WEAPON_CHOICES); none = the default kit.
  resetRun(mode = DEFAULT_MODE, startWeapon = null) {
    this.resetInput();
    this.radio?.clear();
    this.pixie?.resetRun();
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
    this.pickRerolls = 0; // rerolls of the current NEW WEAPON pick (its own price, from 40 gold)
    this.handLock = null; // { card, slot }: the locked card in the hand on screen
    this.handLockPaid = 0; // gold the lock on screen cost in this hand (0 for a lock carried in): refunded if it is let go
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
    this.novaCalloutTimer = 0;
    this.novaCalloutDone = false;
    this.novaCalloutByPixie = false;
    resetVictory(this); // campaignWon: beat the wave-50 boss (stays true in ENDLESS)
    resetFinalStand(this); // wave 50's FINAL STAND (js/final-stand.js)
    resetScoreBonus(this); // wave and victory bonuses (js/score-bonus.js)
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
      // Breakthroughs chosen per weapon at LV 6 / 12 / 18, as option ids: { singularity: { 6: 'twin', 12: 'boost' } }.
      breakthroughs: {},
      breakthroughsOffered: {}, // milestones already shown, so none is ever offered twice
      // Equipped weapons in slot order (loadout.js); NEW WEAPON pity counter (upgrades.js rollLevelUpHand).
      loadout: [],
      newWeaponDrought: 0,
      // Weapon floor on for this run (weapon-floor.js): off in the Weapon Range or a mode without it.
      weaponFloor: modeRules(this.mode).weaponFloor !== false && !this.range?.active,
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
        gas: 0,
        flamethrower: 0,
        cryospray: 0,
        acidspray: 0,
        shockfield: 0,
        raillance: 0,
        glaive: 0,
        nanites: 0,
        harpoon: 0,
        quake: 0,
        siegeBattery: 0,
        empGrenades: 0,
        supercritical: 0
      }
    };

    // Run-start snapshot (discards rebuild from it), then the ship's starting weapon(s) at LV 1.
    snapshotBase(this.player);
    for (const id of START_WEAPON_CHOICES.includes(startWeapon) ? [startWeapon] : STARTING_WEAPONS) acquireWeapon(this.player, id);
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
    (this.gasTrail ||= new GasTrail()).clear();
    (this.flamethrower ||= new Flamethrower()).clear();
    (this.cryoSprayer ||= new Flamethrower('cryospray')).clear();
    (this.acidSprayer ||= new Flamethrower('acidspray')).clear();
    (this.shockField ||= new ShockField()).clear();
    (this.railLance ||= new RailLance()).clear();
    (this.glaive ||= new GlaiveDiscs()).clear();
    (this.nanites ||= new NaniteSwarm()).clear();
    (this.drillDriver ||= new DrillDriver()).clear();
    (this.quakeMortar ||= new QuakeMortar()).clear();
    (this.weaponFx ||= new WeaponEffects()).clear();
    (this.rifts ||= new RiftManager()).clear();
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
    this.barrelHeat = 0; // Hot Barrel
    this.barrelSinceHit = Infinity;
    this.helixAngle = 0;
    this.orbitalAngle = 0;
    this.bladeFlingTimer = this.bladeNovaTimer = undefined;
    this.bladeNovaHide = 0;
    this.statusStamp = 0;
    clearStatusArcs();

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
    this.frozenKey = null; // resizing clears the canvas
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

  // Shield under LOW_SHIELD_PCT: the screen edges pulse red (only while a run is on screen).
  updateLowShieldVignette() {
    const p = this.player;
    const live = ['PLAYING', 'UPGRADE', 'CHEST', 'PAUSED'].includes(this.state) && !this.range?.active;
    const low = live && p?.maxHp > 0 && p.hp > 0 && p.hp / p.maxHp < LOW_SHIELD_PCT;
    setHidden(document.getElementById('low-shield-vignette'), !low);
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
    document.getElementById('btn-death-continue')?.addEventListener('click', () => {
      if (this.deathSeq?.skip()) this.revealGameOver();
    });

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
    document.getElementById('btn-victory-continue')?.addEventListener('click', () => continueEndless(this));
    document.getElementById('btn-victory-end')?.addEventListener('click', () => endVictoriousRun(this));

    window.addEventListener('keydown', (e) => {
      // Any key on the splash screen just continues to the title.
      if (this.splashOpen) {
        if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return; // browser shortcuts still work
        if (['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (!e.repeat) this.splash.dismiss();
        return;
      }
      // The death sequence swallows keys (a held key must not relaunch behind it); a fresh Enter skips it.
      if (this.deathSeq) {
        if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
        e.preventDefault();
        if (!e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter') && this.deathSeq.skip()) this.revealGameOver();
        return;
      }
      if (this.state === 'CUTSCENE') {
        this.cutscene.handleKey(e);
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
      if (this.startPickOpen) {
        this.handleStartPickKey(e, onControl);
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

      if (victoryKey(this, e)) return;

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

    document.getElementById('btn-start-pick-back')?.addEventListener('click', () => this.cancelStartPick());

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
    // Like the cards, a tap that lands as the hand appears (still firing / steering) doesn't skip it.
    document.getElementById('btn-skip-hand')?.addEventListener('click', () => {
      if (performance.now() - (this.choicesShownAt || 0) >= CHOICE_CLICK_GUARD_MS) this.skipHand();
    });
    for (const id of ['btn-title-guide', 'btn-pause-guide', 'btn-go-guide']) {
      document.getElementById(id)?.addEventListener('click', () => this.openGuide());
    }
    for (const id of ['btn-title-notes', 'btn-pause-notes']) {
      document.getElementById(id)?.addEventListener('click', () => this.openNotes());
    }
    for (const id of ['btn-title-tutorial', 'btn-pause-tutorial']) {
      document.getElementById(id)?.addEventListener('click', () => this.openTutorial());
    }
    document.getElementById('btn-title-intro')?.addEventListener('click', () => this.playIntro());
    this.syncDamageNumbersButton();
    this.syncRadarButton();
    this.syncShareStatsButton();
    document.getElementById('btn-pause-effects')?.addEventListener('click', () => this.toggleReduceEffects());
    this.syncReduceEffectsButton();

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
        moveSpeed: TUNING.moveSpeed * bonuses.moveSpeedMult * Math.pow(MOVE_SPEED_STEP, upgLv.move_speed || 0),
        // Autocannon stat cards (Prism Split, Hyper-Capacitor, Phase Piercer) never touch base stats:
        // their ranks are read from the weapon build when firing, so the base stays tunable.
        fireRate: TUNING.fireRate * (weapons.pulsarHelix ? 1.15 : 1),
        bulletSpeed: TUNING.bulletSpeed,
        damage: TUNING.baseDamage * bonuses.damageMult * Math.pow(1.12, upgLv.overdrive || 0),
        magnetRadius: TUNING.magnetRadius * bonuses.magnetMult * Math.pow(1.65, upgLv.magnet || 0),
        xpMultiplier: TUNING.xpMultiplier * bonuses.xpMult * Math.pow(1.25, upgLv.magnet || 0),
        luck: TUNING.baseLuck + (bonuses.luckBonus || 0) + (upgLv.luck_boost || 0) * 0.25,
        coreDropMult: TUNING.coreDropMult * bonuses.coreMult,
        miningSpeed: TUNING.miningSpeed * (bonuses.miningMult || 1) * Math.pow(MINING_SPEED_STEP, upgLv.mining_speed || 0) * (weapons.tectonicBore ? TECTONIC_MINING_SPEED : 1),
        miningRange: TUNING.miningRange * (bonuses.miningRangeMult || 1) * Math.pow(1.2, upgLv.mining_speed || 0) * (weapons.tectonicBore ? TECTONIC_MINING_RANGE : 1),
        drillScale: TUNING.drillScale * Math.pow(1.15, upgLv.mining_speed || 0) * (weapons.tectonicBore ? TECTONIC_DRILL_SCALE : 1),
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
        const roster = Object.keys(BOSS_DEFS);
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
      } else if (sandboxAction === 'OPEN_RIFT') {
        if (!this.rifts?.openNow(this)) this.particles.spawnFloatText(p.x, p.y - 24, 'NO ROOM FOR A RIFT (OR ONE IS OPEN)', '#e07bff', 14);
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
      + `<span class="armory-progress" title="Armory ranks owned">${((owned / total) * 100).toFixed(1)}% COMPLETE</span>`
      + this.armoryRefundButtonHtml();
    tabs.querySelectorAll('[data-armory-key^="cat:"]').forEach((btn) => btn.addEventListener('click', () => {
      this.armoryCat = btn.dataset.armoryKey.slice(4);
      this.renderHubUI();
    }));
    tabs.querySelector('[data-armory-key="refund"]')?.addEventListener('click', () => this.onArmoryRefund());
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

    if (prog.data.refundNotes.length) {
      const total = prog.data.refundNotes.reduce((n, r) => n + r.cores, 0);
      const names = prog.data.refundNotes.map((r) => r.name).join(', ');
      const notice = document.createElement('div');
      notice.className = 'armory-notice';
      notice.innerHTML = `<b>ARMORY UPDATE // ❖ ${total.toLocaleString()} VOID CORES REFUNDED</b>
        <span>These upgrades changed, so your ranks in them were reset and every core you spent on them is back in your wallet: ${names}.</span>
        <button class="armory-notice-ok" data-armory-key="refund-notice">GOT IT</button>`;
      notice.querySelector('button').addEventListener('click', () => { prog.dismissRefundNotes(); this.renderHubUI(); });
      container.appendChild(notice);
    }
    const early = document.createElement('div');
    early.className = 'armory-early';
    early.textContent = 'Early access: upgrades may change. Void Cores spent on changed upgrades are always refunded.';
    container.appendChild(early);

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

  // REFUND ALL: the first click arms it (the button asks to confirm and shows the refund), a second click
  // within ARMORY_REFUND_CONFIRM_MS resets every rank and pays back every core spent on them.
  armoryRefundButtonHtml() {
    const refund = this.progression.armorySpent();
    const armed = refund > 0 && this.armoryRefundArmed;
    const label = armed ? `CONFIRM: REFUND ❖ ${refund.toLocaleString()}?` : '↺ REFUND ALL';
    const title = refund > 0 ? `Reset every armory rank and get back all ${refund.toLocaleString()} Void Cores spent` : 'Nothing to refund yet';
    return `<button class="armory-refund-btn${armed ? ' armed' : ''}" data-armory-key="refund" title="${title}" ${refund > 0 ? '' : 'disabled'}>${label}</button>`;
  }

  onArmoryRefund() {
    this.sound.init();
    clearTimeout(this.armoryRefundTimer);
    if (!this.armoryRefundArmed) {
      this.armoryRefundArmed = true;
      this.armoryRefundTimer = setTimeout(() => { this.armoryRefundArmed = false; this.renderHubUI(); }, ARMORY_REFUND_CONFIRM_MS);
      this.sound.playUiSelect?.();
    } else {
      this.armoryRefundArmed = false;
      if (this.progression.refundAll() > 0) this.sound.playUiConfirm?.();
    }
    this.renderHubUI();
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
    // A busy board or a dropped connection is retried quietly; the game-over line says so meanwhile.
    const onRetry = (attempt) => {
      if (this.globalSubmitToken !== token) return;
      this.globalSubmit = { pending: true, retrying: attempt };
      this.renderBoards();
    };
    this.globalBoard.submit(run, { onRetry }).then((result) => {
      if (this.globalSubmitToken !== token) return;
      this.globalSubmit = result;
      if (result.ok) this.lastGlobalRunId = result.id;
      // The answer carries every board the run landed on (its version board and ALL-TIME, of its mode),
      // so it shows at once; only another board on screen (a different version) is re-read.
      const shown = (this.globalBoard.version === 'all' || this.globalBoard.version === (result.version || 'all')) && (!result.mode || this.globalBoard.mode === result.mode);
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
      loadout: ownedWeapons(p || {}).map((id) => ({ id, lv: statsWeaponLevel(p, id) })),
      armory: this.progression ? { ranks: this.progression.data.ranks, spent: this.progression.armorySpent() } : null
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

  // REDUCE EFFECTS: no screen shake, softer flashes, fewer particles, no decorative UI motion. Saved.
  toggleReduceEffects() {
    setReduceEffects(!isReduceEffects());
    saveReduceEffects(isReduceEffects());
    this.syncReduceEffectsButton();
  }

  syncReduceEffectsButton() {
    const btn = globalThis.document?.getElementById('btn-pause-effects');
    if (!btn) return;
    const on = isReduceEffects();
    btn.textContent = `✨ REDUCE EFFECTS: ${on ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active', on);
    btn.setAttribute?.('aria-pressed', String(on));
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

  // `picked`: the starting weapon was just chosen (the pop-up opens first otherwise, when enabled).
  startGame({ picked = false } = {}) {
    this.sound.init();
    this.deathSeq = null;
    this.syncDeathContinue();
    // Instant replay: the tape rolls through every run (only the death screen plays it back).
    this.replayRec ??= new ReplayRecorder(isTouchDevice() ? REPLAY_SETTINGS.touch : REPLAY_SETTINGS.desktop);
    this.replayRec.reset();
    // First LAUNCH on this device: the opening cutscene, then the tutorial; the run starts after them.
    if (this.introOnLaunch && !this.introSeen && this.state === 'TITLE' && !this.range?.active
      && this.playIntro({ launchAfter: true })) return;
    // First LAUNCH on this device: the tutorial comes first, and the run starts when it closes.
    if (this.tutorialOnLaunch && this.state === 'TITLE' && !this.range?.active && this.tutorial?.shouldAutoOpen()
      && this.openTutorial({ launchAfter: true })) return;
    if (this.guideOpen) this.closeGuide();
    if (!picked && !this.range?.active && this.openStartPick()) return;
    this.closeStartPick();
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
    this.resetRun(this.range?.active ? DEFAULT_MODE : this.selectedMode, this.range?.active ? null : this.startWeapon);
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
    this.updateLowShieldVignette();
    this.setQuitConfirm(false);
    globalThis.document?.activeElement?.blur?.();
    for (const id of ['pause-modal', 'upgrade-modal', 'chest-modal', 'victory-modal', 'gameover-modal']) document.getElementById(id)?.classList.add('hidden');
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
    this.particles.spawnFloatText(x, y - 18, '★ ALIEN TECH CACHE DROPPED! ★', '#ffcc00', 15);
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
    let tierTitle = 'ALIEN TECH CACHE (1X)';
    let tierSub = '★ ALIEN TECH UNLOCKED ★';
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
      tierSub = '★★ SUPER ALIEN TECH CACHE UNLOCKED ★★';
      bonusCores = 2;
    } else if (roll < doubleChance) {
      rewardCount = 2;
      tierTitle = '★ DOUBLE ALIEN TECH CACHE! (2X) ★';
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
      // Never a weapon's element card: the element is the player's own pick from a level-up hand.
      const pool = rollUpgrades(this.player, 3, { cache: true });
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
      addCardGlow(card, view.className);
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
  // shield vein (an instant heal, not a pickup) or sets off the Tectonic Drill Bore blast.
  onRockShattered(rock) {
    const byElite = rock.brokenBy === 'elite';
    if (!byElite) this.rocksMined++;
    this.sound.playExplosion(0.95);
    this.particles.spawnPolygonShatter(rock.x, rock.y, rock.radius * 0.9, rock.sides, rock.rotation, rock.hue, 0.9);
    // The glowing core breaks up too: smaller inner shards in the crack colour, and a flash.
    const crackHue = rock.oreType !== 'rock' ? rock.hue : 34;
    this.particles.spawnPolygonShatter(rock.x, rock.y, rock.radius * 0.45, 3 + (rock.sides % 2), rock.rotation + 0.5, crackHue, 0.6);
    this.particles.spawnFlash(rock.x, rock.y, rock.radius * 0.9, crackHue, 0.12);
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

    // Tectonic Drill Bore synergy blasts nearby enemies when you drill a rock (does NOT mine other rocks)
    if (this.player.weapons.tectonicBore && !byElite) {
      const blast = tectonicBlastRadius(this.player);
      this.particles.spawnShockwave(rock.x, rock.y, blast, 48, 4.5, 0.35);
      this.damageEnemiesInRadius(rock.x, rock.y, blast, weaponDamage(this.player, 'tectonic'), 48, 'other', undefined, undefined, 'tectonic');
    }
  }

  triggerDash() {
    const p = this.player;
    if (p.dashCooldown > 0 || this.rifts?.holdsShip()) return;

    // Phase Dash Extender cards and the Void Armory's Afterburner Jets stretch the burst (and a blink),
    // with the invulnerability to match.
    const reach = W.dashDistanceMult(Math.min(UPGRADE_BY_ID.dash_range.maxLevel, p.upgradeLevels?.dash_range || 0)) * (p.dashDistanceMult ?? 1);
    p.dashTimer = W.dashDuration * reach;
    p.dashCooldown = dashCooldownFor(p, TUNING.dashCooldownBase ?? 1.5);
    p.dashCooldownDuration = p.dashCooldown;
    p.invuln = Math.max(p.invuln, W.dashInvuln + W.dashDuration * (reach - 1));

    const moveAngle = (Math.abs(p.vx) + Math.abs(p.vy) > 0.2)
      ? Math.atan2(p.vy, p.vx)
      : p.angle;

    this.sound.playDash();
    this.grid.applyImpulse(p.x, p.y, 46, 180, 188);
    this.grid.ripple?.(p.x, p.y, 110, 188);
    this.particles.spawnShockwave(p.x, p.y, 110, 188, 3.5, 0.3);
    burst(this, 'dash', p.x, p.y, { angle: moveAngle });

    // Corrosive Gas Trail: every dash vents one giant cloud where the ship took off (js/gas-trail.js).
    this.gasTrail?.dashCloud(this, p);

    const blinkRank = Math.min(UPGRADE_BY_ID.blink_drive.maxLevel, p.upgradeLevels?.blink_drive || 0);
    if (blinkRank > 0) {
      // Blink Drive: no burst of speed, the ship is simply at the far end (the nova goes off there).
      this.blink(p, moveAngle, W.blinkDistance(blinkRank) * reach);
    } else {
      p.vx = Math.cos(moveAngle) * p.stats.moveSpeed * W.dashSpeedMult;
      p.vy = Math.sin(moveAngle) * p.stats.moveSpeed * W.dashSpeedMult;
    }

    if (p.weapons.dashNova > 0) {
      const radius = novaRadius(p, p.weapons.dashNova);
      this.particles.spawnShockwave(p.x, p.y, radius, 160, 5, 0.4);
      this.damageEnemiesInRadius(p.x, p.y, radius, weaponDamage(p, 'nova', p.weapons.dashNova), 160, 'other', undefined, undefined, 'nova');
    }
  }

  // Blink Drive: teleport `dist` px along `angle`, inside the arena and short of any rock (the landing
  // steps back until the hull is clear), leaving a trail of afterimages; the ship keeps cruising on.
  blink(p, angle, dist) {
    const pad = p.radius + 24;
    const cx = Math.cos(angle), cy = Math.sin(angle);
    const x0 = p.x, y0 = p.y;
    let d = dist;
    let x = x0, y = y0;
    const rocks = this.asteroidManager?.getNearbyAsteroids?.(x0 + cx * dist * 0.5, y0 + cy * dist * 0.5, this.asteroidManager.cellsFor?.(dist * 0.5 + 80) ?? 3) || [];
    for (; d > 0; d -= 16) {
      x = Math.max(pad, Math.min(this.worldWidth - pad, x0 + cx * d));
      y = Math.max(pad, Math.min(this.worldHeight - pad, y0 + cy * d));
      if (!rocks.some((r) => r.hp > 0 && Math.hypot(r.x - x, r.y - y) < r.radius + p.radius)) break;
    }
    if (d <= 0) { x = x0; y = y0; }
    for (let k = 1; k <= 5; k++) this.particles.spawnAfterimage(x0 + (x - x0) * (k / 6), y0 + (y - y0) * (k / 6), p.angle, p.radius, 188);
    this.particles.spawnFlash?.(x0, y0, 30, 188, 0.18);
    this.particles.spawnFlash?.(x, y, 36, 188, 0.2);
    this.particles.spawnShockwave(x, y, 90, 188, 3, 0.25);
    p.x = x;
    p.y = y;
    p.vx = cx * p.stats.moveSpeed;
    p.vy = cy * p.stats.moveSpeed;
    p.dashTimer = 0;
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
    const kills0 = this.kills;
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

    this.runStats?.bomb(this.kills - kills0);
    for (let i = 0; i < this.geoms.length; i++) {
      this.geoms[i].magnetized = true;
    }

    this.updateHUD();
  }

  // Weapons and explosions ONLY damage enemies — never asteroids! (The Graviton Mortar's waves are the one
  // weapon that cracks rocks, on purpose: quake-mortar.js / AsteroidManager.quakeRock.)
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
    const raw = dmg; // status stacks follow the hit before armor, corrosion and crits
    dmg *= armorTakenMult(e) * statusTakenMult(e);
    const dot = DOT_SOURCES[source] === true;
    const chance = dot || !p ? 0 : Math.min(1, critChance(p) + shockCritBonus(e));
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
    if (kx || ky) e.hitAng = Math.atan2(ky, kx); // the hull squashes along the shot (enemies.js draw)
    // A hit that takes a real bite (a quarter of max HP or more) pops a hot ring on the hull.
    if (!dot && dmg >= (e.maxHp || Infinity) * 0.25 && e.hp - dmg > 0) {
      this.particles.spawnShockwave(e.x, e.y, e.radius * 2, crit ? 48 : e.hue, 2, 0.14);
    }
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
    else if (!dot && p) applyOnHitStatuses(p, e, source, raw);
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
    if (e.teslaCharge) BTX.conductorDeath(this, e); // Conductor: a charged enemy arcs into its neighbours
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
    // White-hot core flash: the hull bursts from the inside (small for swarm fodder, so a cleared
    // swarm doesn't wash the screen out).
    this.particles.spawnFlash(e.x, e.y, e.radius * (tier === 0 ? 1.6 : 2.4 + tier * 0.4), e.hue, tier === 0 ? 0.08 : 0.14);
    const sparkCount = fromBomb ? 18 : Math.floor(26 * intensity);
    this.particles.spawnExplosionSparks(e.x, e.y, sparkCount, e.hue, 2.5, 14 * Math.sqrt(intensity), 2.3);
    this.particles.spawnShockwave(e.x, e.y, 48 * intensity, e.hue, 3 * intensity, 0.34);
    this.grid.applyImpulse(e.x, e.y, 26 * intensity, 115 * intensity, e.hue);
    this.grid.ripple?.(e.x, e.y, 40 * intensity, e.hue);

    // Heavier hulls stack extra layers; supernova mass-kills skip them (except elites/bosses).
    if (!fromBomb || tier >= 3) {
      if (tier >= 1) {
        this.particles.spawnShockwave(e.x, e.y, e.radius * 2.4, e.hue, 2 + tier, 0.16);
        // A wide, thin snap ring and slow embers that drift and fade after the blast.
        this.particles.spawnShockwave(e.x, e.y, e.radius * 3.2, e.hue, 1.4, 0.12);
        this.particles.spawnExplosionSparks(e.x, e.y, 4 + 3 * tier, e.hue, 0.4, 2.6, 3);
      }
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
      // Collapse: space snaps back in (an inward ring and a hard grid rebound), then the core blows; its
      // infall streams are flung back out as sparks (particles.js).
      const pullR = pullRadiusOf(e);
      this.particles.spawnShockwave(e.x, e.y, pullR * 0.9, e.hue, 3, 0.22, true);
      this.particles.spawnFlash(e.x, e.y, e.radius * 5, 22, 0.3);
      this.particles.spawnExplosionSparks(e.x, e.y, 26, 22, 3, 14, 2.4);
      this.grid.applyImpulse(e.x, e.y, 70, pullR, e.hue);
      this.grid.ripple?.(e.x, e.y, pullR, e.hue, 1.4);
      this.particles.spawnShockwave(e.x, e.y, 190, 348, 6, 0.5);
      this.damageEnemiesInRadius(e.x, e.y, 175, 65 * this.getWaveScale() * 0.4, 348, 'other', undefined, undefined, 'blackhole');
    }

    // Weapon Range dummies drop nothing (no caches, score, XP or cores); on-kill weapons still fire.
    const ranged = !!this.range?.active;
    if (ranged) this.range.onKill(e);
    // A split boss (Progenitor) pays out only when its last piece dies; read that before the death burst
    // queues the next generation.
    const bossPay = e.isBoss && bossDef(e.type)?.isFinalPiece?.(e, this.enemyManager) !== false;
    if (e.isBoss) bossDef(e.type)?.onDeath?.(e, this.enemyManager);

    // Relic Supply Cache Drops! (Guaranteed on Bosses, very rare Luck-scaled drop on lesser enemies)
    const luck = this.player.stats.luck || 1.0;
    let bossBombGain = 0;
    if (bossPay && !ranged) {
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
          kind: 'shard',
          spin: Math.random() * Math.PI * 2,
          knock: KNOCKBACK.shrapnel
        });
      }
    }
    if (ranged) return;

    const pts = Math.round(e.score * this.multiplier);
    this.score += pts;
    if (bossPay) this.onBossDefeated(e, pts, bossBombGain);
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

    // A Supernova bomb pickup (BOMB_DROP), never while the bomb bay is full.
    const bombChance = (e.isLieutenant ? BOMB_DROP.lieutenant : e.type === 'blackhole' ? BOMB_DROP.blackhole : e.type === 'hulk' ? BOMB_DROP.hulk : 0) * luck;
    if (!bossPay && bombChance > 0 && this.player.bombs < BOMB_DROP.max && Math.random() < bombChance) {
      const ba = Math.random() * Math.PI * 2;
      this.geoms.push({ isBomb: true, x: e.x, y: e.y, vx: Math.cos(ba) * 3, vy: Math.sin(ba) * 3, xp: 0, rotation: 0, hue: 48, magnetized: fromBomb });
    }

    const maxWaveCores = Math.ceil((TUNING.maxWaveCores ?? 3) * this.player.stats.coreDropMult);
    if (bossPay || this.coresDroppedThisWave < maxWaveCores) {
      const coreChance = (
        bossPay ? 1.0 :
        e.type === 'blackhole' ? 0.55 :
        e.type === 'hulk' ? 0.3 :
        e.type === 'splitter' ? 0.08 :
        0
      ) * this.player.stats.coreDropMult;

      if (Math.random() < coreChance) {
        const coreDrops = bossPay ? (BOSS_TIER[e.bossTier]?.cores ?? 3) : 1;
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
    this.runStats?.playerHit(by || 'unknown', Math.min(dmg, Math.max(0, p.hp)), p.hp > 0 && p.hp - dmg <= 0);
    p.shieldFlash = 1;
    p.hp -= dmg;
    p.invuln = HIT_INVULN_BASE;
    this.multiplier = Math.max(1.0, this.multiplier * 0.75);
    this.addShake(shake);
    this.chromaFlash = 0.5;
    if (this.sound.playPlayerHit) this.sound.playPlayerHit();
    else this.sound.playExplosion(1.8);
    this.particles.spawnShockwave(p.x, p.y, 130, 348, 5, 0.38);
    burst(this, 'shieldCrackle', p.x, p.y, { hue: 190, r: p.radius * 1.9, scale: dmg >= 20 ? 1.5 : 1 });
    this.grid.applyImpulse(p.x, p.y, 55, 160, 348);
    this.grid.ripple?.(p.x, p.y, 130, 348);
    if (p.hp > 0 && p.hp <= p.maxHp * PIXIE_LOW_SHIELD_FRACTION) this.pixie?.lowShield(this.mode); // first time per save
    return p.hp <= 0;
  }

  endRunIfDead() {
    const p = this.player;
    if (p.hp > 0) return false;
    p.hp = 0;
    this.updateHUD();
    this.triggerGameOver({ dying: true });
    return true;
  }

  // Plasma orbs: blocked by rock, pass through a dash's invulnerability, absorbed by the shield.
  updateEnemyBullets(dt) {
    this.enemyBulletHit ||= (b) => {
      if (this.player.invuln > 0 || this.player.hp <= 0 || this.range?.active) return false; // range: orbs pass through
      this.particles.spawnExplosionSparks(b.x, b.y, 10, 14, 2, 8, 2);
      this.damagePlayer(this.enemyBulletDamage(b), b.shake ?? 10, b.from);
      return true;
    };
    this.enemyManager.enemyBullets?.update(dt, this.player, this.asteroidManager, this.particles, this.worldWidth, this.worldHeight, this.enemyBulletHit);
    this.enemyManager.bossTelegraphs?.hitPlayer(this.player, this.enemyBulletHit); // telegraphed boss attacks hit like orbs
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
    if (card) setClass(cardEl, 'lt-card-out', this.ltCardTimer < 0.4);
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
    this.logGuideEntries([e.type]);
    // The arrival card is just the name and title (no kicker or stats line).
    this.showBossCard('arrival', '', e, '');
    // The run's first boss: remind the pilot the Supernova bombs exist (a bomb strips 40% of a boss's HP).
    if (!this.novaCalloutDone && this.player?.bombs > 0 && !this.range?.active) {
      this.novaCalloutDone = true;
      this.novaCalloutTimer = NOVA_CALLOUT_TIME;
      // With the story radio on, Dr. Pixie says it instead of the banner (the bomb counter still glows).
      this.novaCalloutByPixie = !!this.pixie?.novaReminder(this.mode, this.touchMode && !this.gpActive ? 'NOVA' : this.novaKeyLabel());
    }
  }

  // The first-boss bomb reminder: one line, "TRY A SUPERNOVA BOMB! (E)", while the SUPERNOVA gauge glows. It
  // waits for the boss title card to clear. Desktop: just above the dock's shield bar (no arrow, the gauge is
  // right beside it). Touch: the top-right corner (CSS), with a dashed arrow curving down to the NOVA button.
  novaKeyLabel() { return this.gpActive ? 'B' : this.touchMode ? 'TAP NOVA' : 'E'; }

  novaCalloutShowing() {
    return this.novaCalloutTimer > 0 && !(this.bossCardTimer > 0);
  }

  updateNovaCallout() {
    const el = document.getElementById('nova-callout');
    const arrow = document.getElementById('nova-callout-arrow');
    const glow = this.novaCalloutShowing();
    const on = glow && !this.novaCalloutByPixie;
    setHidden(el, !on);
    setHidden(arrow, !on);
    for (const id of ['nova-indicator', 'touch-nova']) setClass(document.getElementById(id), 'nova-callout-target', glow);
    if (!on || !el || !arrow) return;
    const fading = this.novaCalloutTimer < 0.45;
    setClass(el, 'nova-callout-out', fading);
    setClass(arrow, 'nova-callout-out', fading);
    const text = `TRY A SUPERNOVA BOMB! (${this.novaKeyLabel()})`;
    const titleEl = document.getElementById('nova-callout-title');
    if (titleEl && titleEl.textContent !== text) titleEl.textContent = text;

    const hud = document.getElementById('hud')?.getBoundingClientRect?.();
    const shield = document.getElementById('shield-group')?.getBoundingClientRect?.();
    const dock = document.getElementById('ability-dock')?.getBoundingClientRect?.();
    let left = '', top = '';
    if (!this.touchMode && hud && shield?.width > 0 && dock?.height > 0) {
      // Centred over the shield bar, its bottom edge just above the dock, kept on screen.
      const half = (el.getBoundingClientRect?.()?.width || 0) / 2;
      const cx = Math.max(half + 12, Math.min(hud.width - half - 12, shield.left + shield.width / 2 - hud.left));
      left = `${Math.round(cx)}px`;
      top = `${Math.round(dock.top - hud.top - 6)}px`;
    }
    if (el.style && el.style.left !== left) el.style.left = left;
    if (el.style && el.style.top !== top) el.style.top = top;
    if (!this.touchMode) return;

    // Arrow: leaves the banner edge nearest the target and curves into the target's facing side.
    const target = document.getElementById('touch-nova');
    const t = target?.getBoundingClientRect?.();
    const c = el.getBoundingClientRect?.();
    const box = arrow.getBoundingClientRect?.();
    let d = '';
    if (t && c && box && t.width > 0) {
      const tx = t.left + t.width / 2;
      const above = t.bottom < c.top;
      const sx = Math.max(c.left + 40, Math.min(c.right - 40, tx));
      const sy = above ? c.top - 6 : c.bottom + 6;
      const ex = tx;
      const ey = above ? t.bottom + 10 : t.top - 10;
      const r = (v) => Math.round(v);
      d = `M${r(sx - box.left)},${r(sy - box.top)} Q${r(ex - box.left)},${r(sy - box.top)} ${r(ex - box.left)},${r(ey - box.top)}`;
    }
    const path = document.getElementById('nova-callout-path');
    if (path && path.getAttribute?.('d') !== d) path.setAttribute?.('d', d);
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
    const rewards = [`+${pts.toLocaleString()} PTS`, 'SUPER ALIEN TECH CACHE', `${BOSS_TIER[e.bossTier]?.cores ?? 3} ❖ VOID CORES`];
    if (bombGain > 0) rewards.push(`+${bombGain} BOMB`);
    this.showBossCard('defeat', '★ BOSS DESTROYED ★', e, rewards.join(' · '));
    if (isCampaignWin(this, e)) finalBossDown(this); // the final boss: clear the sector, then VICTORY (js/final-stand.js)
  }

  showVictory() { showVictory(this); }
  continueEndless() { continueEndless(this); }
  endVictoriousRun() { endVictoriousRun(this); }

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
        pct: Math.max(0, Math.min(1, e.hp / e.maxHp)),
        escape: escapeLeft(this, e) // s until it escapes (null: never)
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
      setText(document.getElementById('boss-warning-text'), w.count > 1
        ? `${w.count} BOSSES INBOUND // NEXT: ${w.name}`
        : `${w.name} INBOUND // ${w.epithet}`);
      setText(document.getElementById('boss-warning-eta'), `T-${w.eta.toFixed(1)}s`);
    }

    setHidden(document.getElementById('boss-bars'), !model.visible);
    for (let i = 0; i < BOSS_BAR_ROWS; i++) {
      const row = model.rows[i];
      setHidden(document.getElementById(`boss-bar-${i}`), !row);
      if (!row) continue;
      setText(document.getElementById(`boss-bar-name-${i}`), row.name);
      // The last BOSS_ESCAPE.warnAt s before it escapes, the title gives way to a red countdown.
      const escaping = row.escape !== null && row.escape !== undefined && row.escape <= BOSS_ESCAPE.warnAt;
      const epithetEl = document.getElementById(`boss-bar-epithet-${i}`);
      setText(epithetEl, escaping ? `ESCAPING IN ${Math.ceil(row.escape)}s` : row.epithet);
      setClass(epithetEl, 'boss-bar-escaping', escaping);
      setStyle(document.getElementById(`boss-bar-fill-${i}`), 'width', `${(row.pct * 100).toFixed(1)}%`);
    }
    const moreEl = document.getElementById('boss-bar-more');
    setHidden(moreEl, model.overflow <= 0);
    if (model.overflow > 0) setText(moreEl, `+${model.overflow} MORE BOSS${model.overflow > 1 ? 'ES' : ''} ON RADAR`);

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
    setClass(cardEl, 'boss-card-out', card && this.bossCardTimer < 0.45);
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
    } else if (pack === 'mitosis') {
      // A colony round one point (the roster doubles the head count for the HP budget).
      const n = Math.ceil(count('mitosis') / 2);
      for (let i = 0; i < n; i++) {
        const c = packMemberPoint(this, pt, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90);
        em.queueSpawn('mitosis', c.x, c.y, this.getWaveScale('mitosis'), this.placedSpawn(c));
      }
    } else if (pack === 'carrier' || pack === 'hatchery') {
      // The roster's drones / hatchlings are launched or bred over time, not spawned with their mothership.
      spread(pack, count(pack));
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
    } else if (pack === 'repulsor') {
      // The repulsor walks its skirmish line in behind its field.
      em.queueSpawn('repulsor', pt.x, pt.y, this.getWaveScale('repulsor'), this.placedSpawn(pt));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        const esc = packMemberPoint(this, pt, Math.cos(a) * 55, Math.sin(a) * 55);
        em.queueSpawn(k % 2 ? 'weaver' : 'pinwheel', esc.x, esc.y, this.getWaveScale('pinwheel'), this.placedSpawn(esc));
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

  // One beam hit (lancer sweep, twin tether, Prism lighthouse): orb damage × LANCE.damageMult, on the ramp.
  beamDamage(e) {
    return (TUNING.enemyBulletDamage ?? 12) * LANCE.damageMult * damageRampAt(this.wave);
  }

  // A laser gate against the ship: a pylon hits like a hull; crossing the beam (hub included) detonates
  // the gate. Returns true when the hit ended the run.
  gateContact(e, p) {
    // The beam first: a ship crossing it near a pylon still blows the gate rather than taking the hit.
    const { d, t } = beamDistance(e, p.x, p.y);
    if (d < p.radius && t > 0.06 && t < 0.94) {
      this.detonateGate(e);
      return false;
    }
    for (const q of gatePylons(e)) {
      if (!shieldTouches(p, TUNING, q.x, q.y, GATE.pylonRadius)) continue;
      if (p.invuln > 0) return false;
      this.damagePlayer(this.contactDamage(e), undefined, enemyKind(e));
      return this.endRunIfDead();
    }
    return false;
  }

  // Flying through a gate: it blows, wrecking every hostile within GATE.blastRadius (bosses too).
  detonateGate(e) {
    if (e.dead) return;
    const r = GATE.blastRadius;
    this.particles.spawnShockwave(e.x, e.y, r, e.hue, 6, 0.45);
    this.particles.spawnShockwave(e.x, e.y, r * 0.6, 0, 4, 0.3);
    this.particles.spawnExplosionSparks(e.x, e.y, 40, e.hue, 3, 16, 2.4);
    this.particles.spawnFloatText?.(e.x, e.y - 20, 'GATE BLAST!', '#ffe14a', 15);
    this.grid.applyImpulse(e.x, e.y, 90, r * 1.4, e.hue);
    this.addShake(8);
    e.hp = 0;
    e.lastStat = 'other';
    this.killEnemy(e);
    this.damageEnemiesInRadius(e.x, e.y, r, GATE.blastDamage * this.getWaveScale(), e.hue, 'other', KNOCKBACK.area * 2, 0.3);
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
      if (b.bx?.thunder) BTX.rocketFlight(this, b, dt);
      if (b.mirvT > 0) {
        b.mirvT -= dt;
        if (b.mirvT <= 0 && b.mirvParts > 1) this.splitMirv(b);
      }
      b.x += b.vx;
      b.y += b.vy;
      b.life -= dt;
      const armed = !(b.armT > 0); // Rocket Pods: not yet armed, it flies through enemies (cover still stops it)
      if (!armed) b.armT -= dt;
      b.hitEnemies ||= new Set();
      const hits = [];
      const segmentRadius = Math.hypot(b.x - x0, b.y - y0) / 2;
      const midX = (x0 + b.x) / 2, midY = (y0 + b.y) / 2;
      for (const e of this.projectileEnemyIndex.query(midX, midY, segmentRadius + maxEnemyRadius + b.radius)) {
        if (e.dead || b.hitEnemies.has(e) || !armed) continue;
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
          if (b.kind === 'rocket') this.rocketRockBurst(b, hx, hy);
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
        if (b.bx?.hot) BTX.hotBoltHit(this, b); // Hot Barrel: a landed bolt stokes the barrel
        b.hitEnemies.add(e);
        b.pierce--;
        const hx = x0 + (b.x - x0) * hit.t;
        const hy = y0 + (b.y - y0) * hit.t;
        const travel = Math.atan2(b.vy, b.vx);
        this.particles.spawnDirectionalSparks(hx, hy, travel, 1.1, 5, e.hue, 7);
        this.particles.spawnImpact(hx, hy, travel, 5 + b.radius);
        if (b.kind === 'shard') {
          // A Volatile Shatter shard striking home: a white-gold glint and a burst of glass splinters.
          this.particles.spawnCritFlare?.(hx, hy, 7, 0.12);
          this.particles.spawnDirectionalSparks(hx, hy, travel, 0.7, 2, 52, 8);
        }
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
        if (b.bx?.shrapnel) BTX.rocketBurst(this, b, e, hx, hy);
        if (b.pierce <= 0) break;
      }
      if (!blocked && b.pierce > 0 && b.life > 0 && b.x >= 10 && b.x <= this.worldWidth - 10 && b.y >= 10 && b.y <= this.worldHeight - 10) {
        this.bullets.push(b);
      } else if (b.bx?.hot) BTX.hotBoltMiss(this, b); // gone without a hit: the barrel vents
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
      const part = k === 0 ? b : { ...b, hitEnemies: new Set(b.hitEnemies), bx: b.bx && { ...b.bx } };
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
    const slug = BTX.blasterVolley(this, b);
    // Prism Split streams keep fixed slots (forward pair first), so new streams never bend old ones.
    const sideX = -Math.sin(p.angle);
    const sideY = Math.cos(p.angle);
    const vel = projectileSpeedMult(p); // Velocity Coils: faster bolts, same reach
    const speed = p.stats.bulletSpeed * vel;
    const streams = prismStreams(blasterStreams(p, b));
    for (const stream of streams) {
      const a = p.angle + stream.angle;
      const noseX = p.x + Math.cos(a) * 16 + sideX * stream.lateral;
      const noseY = p.y + Math.sin(a) * 16 + sideY * stream.lateral;

      this.bullets.push(BTX.shapeBlasterBolt(this, b, {
        x: noseX,
        y: noseY,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        damage,
        pierce,
        hue: b.t12 ? 176 : (TUNING.bulletColorHue ?? 186),
        radius: (TUNING.bulletRadius ?? 4.2) * (flak ? 1.15 : 1),
        life: 1.25 / vel,
        width: AUTOCANNON_DRAW_WIDTH,
        ...flak,
        ricochet: b.t8 ? 1 : 0,
        arcRounds: b.t12
      }, slug, streams.length));
    }

    if (p.weapons.pulsarHelix) {
      this.helixAngle += 0.48;
      for (let arm = 0; arm < W.helixArms; arm++) {
        const ha = this.helixAngle + arm * Math.PI;
        this.bullets.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(ha) * (speed * 0.85),
          vy: Math.sin(ha) * (speed * 0.85),
          damage: weaponDamage(p, 'helix', b),
          pierce,
          hue: 305, // evolution magenta: reads apart from cyan Autocannon shots and gold XP geoms
          stat: 'helix',
          radius: 6.5,
          life: 1.3 / vel
        });
      }
    }

    this.sound.playLaser(BTX.blasterPitch(this, b));
    BTX.blasterVolleyFx(this, p, slug);
    kickShipRecoil(p);
    kickMount(p, 'blaster');
    // Muzzle recoil nudges the grid but adds no glow: the ship's own light (draw) lights its lines.
    this.grid.applyImpulse(p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, 5.5, 110, 188, 0);
  }

  // Rocket Pods: dumbfire rockets from the two flank pods, flying where the turret aims (mouse, right
  // stick or auto-aim, like the Autocannon). Direct hit plus a small blast. Rockets alternate pods;
  // each extra pair launches a little further back and fans slightly outward.
  fireWingRockets(b = weaponBuild(this.player, 'rockets')) {
    const p = this.player;
    if (typeof b === 'number') b = weaponBuild(p, 'rockets', b);
    const vel = projectileSpeedMult(p); // Velocity Coils: faster, same reach
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
    const converge = tTurn < 0.35 ? Math.min(600, Math.max(180, Math.hypot(t.x - p.x, t.y - p.y))) : ROCKET_CONVERGE;
    const cx = p.x + Math.cos(aim) * converge, cy = p.y + Math.sin(aim) * converge;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const hx = Math.cos(heading), hy = Math.sin(heading);
      // Pod mount in hull space: out at the wingtips (ship-renderer.js: tips at -0.95r, 1.76r), well clear of
      // the Autocannon's centre line (it launched from the carapace flanks, 1.12r out, before v0.39.8).
      const fwd = p.radius * WINGTIP.x - tier * 7; // the wingtip pods drawn by hardpoints.js
      const out = p.radius * WINGTIP.y + tier * 4;
      let wx = p.x + hx * fwd - hy * side * out;
      let wy = p.y + hy * fwd + hx * side * out;
      // A pod buried in the rock face being mined would launch its rocket inside the rock, where it died
      // on its first tick, unseen, under the launch sound. That pod fires from the hull centre instead.
      if (this.rockOnSegment(p.x, p.y, wx, wy, 4.5)) { wx = p.x; wy = p.y; }
      const a = Math.atan2(cy - wy, cx - wx) + side * tier * 0.07;
      const fx = Math.cos(a), fy = Math.sin(a);
      this.bullets.push(BTX.shapeRocket(b, {
        x: wx,
        y: wy,
        vx: fx * W.wingRocketSpeed * vel,
        vy: fy * W.wingRocketSpeed * vel,
        damage,
        pierce: 1,
        hue: 354,
        radius: 4.5,
        life: W.wingRocketLife / vel,
        armT: ROCKET_ARM_TIME,
        source: 'rocket',
        kind: 'rocket',
        knock: KNOCKBACK.missile,
        blastRadius,
        blastDamage: damage * W.wingRocketBlastShare,
        tandem: b.t4,
        napalm: b.t8,
        mirvT: b.t12 ? W.mirvTime : 0,
        mirvParts: mirv
      }));
      // Launch kick: a hot flash at the pod and a puff of exhaust thrown back, so every rocket reads as it leaves.
      this.particles?.spawnFlash?.(wx, wy, 18, 24, 0.14);
      this.particles?.spawnDirectionalSparks?.(wx, wy, a + Math.PI, 0.7, 4, 30, 6);
    }
    kickMount(p, 'rockets');
    if (this.sound.playRocketLaunch) this.sound.playRocketLaunch();
    else this.sound.playLaser(0.55);
  }

  // Whether a live asteroid crosses the segment (x0, y0) -> (x1, y1), widened by `pad`.
  rockOnSegment(x0, y0, x1, y1, pad = 0) {
    const manager = this.asteroidManager;
    if (!manager?.asteroids?.length) return false;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const cells = Math.ceil((len / 2 + (manager.maxRockRadius ?? 120) + pad) / manager.cellSize);
    for (const rock of manager.getNearbyAsteroids((x0 + x1) / 2, (y0 + y1) / 2, cells)) {
      if (rock.hp > 0 && this.segmentHitTime(x0, y0, x1, y1, rock.x, rock.y, rock.radius + pad) !== null) return true;
    }
    return false;
  }

  // A Rocket Pod rocket striking cover: rocks still stop it cold (no damage gets through), but it bursts
  // on the rock face with a flash, a small ring and a pop instead of vanishing in two sparks.
  rocketRockBurst(b, x, y) {
    const r = (b.blastRadius || 50) * 0.55;
    this.particles.spawnFlash?.(x, y, r * 0.5, 24, 0.12);
    this.particles.spawnShockwave(x, y, r, 18, 2, 0.24);
    this.particles.spawnExplosionSparks(x, y, 5, 30, 2, 8, 1.2);
    this.grid.applyImpulse(x, y, 8, r * 2, 18, 0);
    this.sound.playMissileImpact?.(0.45);
  }

  // `echo`: an Echo Salvo repeat (half strength, no nuke, never echoes again).
  fireSwarmMissiles(b = weaponBuild(this.player, 'missiles'), { echo = false } = {}) {
    const p = this.player;
    if (typeof b === 'number') b = weaponBuild(p, 'missiles', b);
    const vel = projectileSpeedMult(p); // Velocity Coils: faster, same reach
    const salvo = W.missileSalvo(b);
    const damage = weaponDamage(p, 'missile', b) * (echo ? W.echoShare : 1);
    const blastRadius = missileBlastRadius(p, b);
    const hue = echo ? W.echoHue : missileHue(p);
    BTX.afterSalvo(this, b, echo);
    const cluster = b.t4 ? { count: W.clusterBomblets, share: W.clusterShare, radiusFrac: W.clusterRadiusFrac, spread: W.clusterSpread, delay: W.clusterDelay } : null;
    // Tactical Nuke: every nukeEvery-th salvo is one huge missile carrying nukeUnits salvos of damage.
    if (!echo) this.missileSalvos = (this.missileSalvos || 0) + 1;
    const nuke = !echo && b.t12 && this.missileSalvos % W.nukeEvery === 0;
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
        const hunt = b.tf?.has('hunter');
        this.weaponFx.schedule({ x, y, delay: W.rainDelay + i * 0.05 + (echo ? 0.1 : 0), radius, damage: each, hue, source: 'missile', style: nuke ? 'nuke' : 'strike', knock: KNOCKBACK.missile, cluster,
          after: p.weapons.stormProtocol || hunt ? (g, ev) => {
            if (p.weapons.stormProtocol) g.fireChainLightning(W.stormChainLevel, ev.x, ev.y);
            if (hunt) BTX.missileBlast(g, { x: ev.x, y: ev.y, damage: ev.damage, source: 'missile', hunterArmed: true }, ev.radius);
          } : null });
      }
      this.particles.spawnDirectionalSparks(p.x, p.y, -Math.PI / 2, 0.5, Math.min(20, 3 * count), hue, 12);
      this.particles.spawnShockwave(p.x, p.y, 40, hue, 3, 0.3);
      this.sound.playMissileLaunch?.(count);
      return;
    }
    // Each missile locks its own target: the nearest enemies in range, one each, doubling up only when
    // there are fewer enemies than missiles.
    const targets = this.missileTargets(p, count);
    const rack = mountWorld(p, 'missiles', {}, this); // the wing rack (hardpoints.js)
    for (let i = 0; i < count; i++) {
      const launchAngle = p.angle + Math.PI + (Math.random() - 0.5) * 1.8;
      const target = targets.length ? targets[i % targets.length] : null;
      this.missiles.push(BTX.shapeMissile(b, {
        target,
        aimX: target ? target.x : p.x + Math.cos(p.angle) * W.missileRange,
        aimY: target ? target.y : p.y + Math.sin(p.angle) * W.missileRange,
        x: rack.x,
        y: rack.y,
        vx: Math.cos(launchAngle) * 7,
        vy: Math.sin(launchAngle) * 7,
        speed: W.missileSpeed * vel * (nuke ? 0.8 : 1),
        damage: each,
        blastRadius: radius,
        hue: nuke ? 30 : hue,
        trail: [],
        life: (nuke ? W.missileLife * 1.25 : W.missileLife) / vel,
        source: 'missile',
        nuke,
        cluster,
        echo
      }));
    }
    kickMount(p, 'missiles', targets.length ? Math.atan2(targets[0].y - p.y, targets[0].x - p.x) : p.angle);
    this.missileSalvoFx(p, count, rack);
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
  missileSalvoFx(p, count, rack = null) {
    const fx = this.particles;
    const back = p.angle + Math.PI;
    const rx = rack ? rack.x : p.x + Math.cos(back) * (p.radius * 0.8);
    const ry = rack ? rack.y : p.y + Math.sin(back) * (p.radius * 0.8);
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
    // Storm Protocol (a plain level) keeps the arc damage of the slower pre-v0.46 discharge.
    const damage = weaponDamage(p, 'lightning', bb) * (typeof level === 'object' ? 1 : W.stormArcScale);
    this.arcStat = stat; // fireArcChain credits its hits to this run-stats key
    this.arcSegs = bb.tf?.has('lattice') || bb.tf?.has('conductor') ? [] : null; // pool Breakthroughs read the jumps
    this.arcBuild = bb;
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
    if (hits > 0 && originX === p.x && originY === p.y) kickMount(p, 'lightning');
    BTX.arcLattice(this, bb, this.arcSegs, damage);
    this.arcSegs = null;
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

      // The first arc leaps from the Tesla coil (hardpoints.js); range and targeting stay from the ship.
      const p = this.player;
      const coil = jump === 0 && currX === p.x && currY === p.y ? mountWorld(p, 'lightning', this._coil ||= {}) : null;
      const sx = coil ? coil.x : currX, sy = coil ? coil.y : currY;
      if (jump === 0) this.arcEmitterFx(sx, sy, target.x, target.y);
      this.arcHopFx(sx, sy, target, jump, fork ? ARC_HUE + 40 : ARC_HUE);
      if (this.arcSegs) { this.arcSegs.push(currX, currY, target.x, target.y); BTX.conductorCharge(this, this.arcBuild, target, damage); }
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
    // from the first); with nobody back there the pair fans out W.twinFan rad either side of the aim, so
    // the two cores always fly apart and read as two (never stacked on one spot).
    const count = W.singularityCount(b);
    const angles = [angle];
    if (count > 1) {
      const far = this.findNearestEnemyAway(p.x, p.y, angle, 1.75, 700);
      if (far) angles.push(Math.atan2(far.y - p.y, far.x - p.x));
      else angles.splice(0, 1, angle - W.twinFan, angle + W.twinFan);
    }
    const pullRadius = singularityPullRadius(p, b) * (count > 1 ? W.twinPullScale : 1);
    const life = W.singularityLife(b);
    const lens = mountWorld(p, 'singularity', {}, this); // the Vortex projector (hardpoints.js)
    for (let k = 0; k < count; k++) {
      const a = angles[k] ?? angle;
      this.singularities.push({
        x: lens.x,
        y: lens.y,
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
        // Accretion Disk (per debris bolt) and White Hole (the bounce-back blast), as shares of a cast.
        accretion: b.tf?.has('accretion') ? weaponDamage(p, 'collapse', b) * W.accretionShare * W.singularityCastDamage(b) / W.singularityCollapseDamageMult(b) * W.accretionEvery / life : 0,
        whiteHole: b.tf?.has('whitehole') ? weaponDamage(p, 'collapse', b) * W.whiteShare * W.singularityCastDamage(b) / W.singularityCollapseDamageMult(b) : 0,
        life,
        maxLife: life,
        spin: 0,
        hue: 290
      });
    }
    kickMount(p, 'singularity', angle);
    this.particles.spawnFlash?.(lens.x, lens.y, 34, 290, 0.22);
    this.particles.spawnShockwave(lens.x, lens.y, 60, 290, 3, 0.3, true);
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

  // Repulsor fields shove the ship's bullets outward (speed kept), so they curve away from anything
  // inside. Missiles, arcs, blasts, orbit blades and singularities are not bullets and get through.
  repelProjectiles() {
    const enemies = this.enemyManager.enemies;
    let fields = null;
    for (let i = 0; i < enemies.length; i++) {
      const f = enemies[i];
      if (f.type === 'repulsor' && !f.dead && !(f.overloadT > 0)) (fields ||= []).push(f);
    }
    if (!fields) return;
    const R = REPULSOR.field;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      for (let j = 0; j < fields.length; j++) {
        const f = fields[j];
        const dx = b.x - f.x;
        const dy = b.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R || d2 < 1) continue;
        if (b.vx * dx + b.vy * dy >= 0) continue; // already heading out
        if (f.overloadT > 0) continue;
        if (b.repelledBy !== f) {
          // A new bolt costs the field a point of charge; at zero it overloads and drops.
          b.repelledBy = f;
          f.fieldCharge = (f.fieldCharge ?? REPULSOR.charge) - 1;
          if (f.fieldCharge <= 0) {
            f.overloadT = REPULSOR.overload;
            this.particles.spawnShockwave(f.x, f.y, REPULSOR.field, f.hue, 3, 0.3);
            continue;
          }
        }
        // Swing the heading toward straight out, harder the deeper it gets (head-on shots swerve too).
        const speed = Math.hypot(b.vx, b.vy);
        const a = turnAngleToward(Math.atan2(b.vy, b.vx), Math.atan2(dy, dx), REPULSOR.push * (1 - Math.sqrt(d2) / R) + 0.05);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        f.repelFlash = 1;
      }
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
      if (onScreen(w.x, w.y)) this.particles.spawnInfall(w, r * 0.9, w.hue, Math.random() < 0.3 ? 2 : 1);
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
      if (!sg.mini) this.separateSingularity(sg, i);
      BTX.singularityAccretion(this, sg, dt);

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

  // Full singularity cores never pull each other (the pull above only drags enemies) and never merge: a
  // core that drifts within W.twinMinSeparation px of another is eased back out (a share of the gap per
  // tick, so a fresh pair glides apart from the ship instead of popping) and a pair stays two.
  separateSingularity(sg, i) {
    const min = W.twinMinSeparation;
    for (let j = 0; j < i; j++) {
      const o = this.singularities[j];
      if (o.mini) continue;
      let dx = sg.x - o.x, dy = sg.y - o.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-6) { dx = Math.cos(i); dy = Math.sin(i); d = 1; }
      const push = (min - d) * 0.06;
      sg.x += dx / d * push; sg.y += dy / d * push;
      o.x -= dx / d * push; o.y -= dy / d * push;
    }
  }

  // Orbit Blades: the ring(s) grind whatever they touch. Counter-Rotating Ring adds a wider ring spinning
  // the other way; Blade Fling throws saw discs outward; Nova Ring bursts every blade on a timer.
  updateOrbitals(dt, b) {
    const p = this.player;
    this.orbitalAngle += dt * W.orbitalSpin(b);
    this.orbitalClock = (this.orbitalClock || 0) + dt;
    const count = W.orbitalBlades(b);
    const damage = weaponDamage(p, 'orbital', b) * BTX.frenzyMult(this, dt, b);
    const bladeR = W.orbitalBladeRadius(b) * BTX.frenzySize(this, b);
    const sparkHue = BTX.frenzyHue(this, b);
    const enemies = this.enemyManager.enemies;
    const rings = this.orbitalRings(b);
    BTX.orbitalVortex(this, dt, b, p.x, p.y, rings[0].radius);
    for (const ring of rings) {
      for (let o = 0; o < count; o++) {
        const oa = ring.dir * this.orbitalAngle + ring.offset + (o * Math.PI * 2) / count;
        const ox = p.x + Math.cos(oa) * ring.radius;
        const oy = p.y + Math.sin(oa) * ring.radius;
        // Orbiting blades ONLY shred enemies, never asteroids!
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (!e || e.dead) continue; // a kill this tick (on-kill bursts) can shift the list past i
          const dx = e.x - ox;
          const dy = e.y - oy;
          const reach = e.radius + bladeR;
          if (dx * dx + dy * dy < reach * reach) {
            // No knockback: blades grind whatever they touch, so pushing targets off would cut their DPS.
            if (!(this.orbitalClock - (e.bladeAt ?? -Infinity) < W.orbitalConnectGap)) {
              // First bite: a heavier burst at the contact point, so the blade visibly connects.
              this.particles.spawnExplosionSparks((ox + e.x) / 2, (oy + e.y) / 2, 9, sparkHue, 4, 12, 2.2);
              this.particles.spawnFlash?.((ox + e.x) / 2, (oy + e.y) / 2, 26, sparkHue, 0.12);
            } else {
              this.particles.spawnExplosionSparks(ox, oy, 3, sparkHue, 2, 7, 1.6);
              if (Math.random() < 0.3) this.particles.spawnFlash?.(ox, oy, 14, sparkHue, 0.1);
            }
            e.bladeAt = this.orbitalClock;
            this.sound.playBladeHit?.();
            this.hitEnemy(e, damage, 'orbital', 0, 0, 0.6);
            BTX.frenzyHit(this, b);
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
    BTX.whiteHole(this, sg, r);
  }

  triggerLevelUp() {
    this.state = 'UPGRADE';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
    this.sound.playLevelUp();
    this.particles.spawnShockwave(this.player.x, this.player.y, 220, 145, 5, 0.5);
    burst(this, 'levelUp', this.player.x, this.player.y);
    this.grid.applyImpulse(this.player.x, this.player.y, 45, 220, 145);
    this.grid.ripple?.(this.player.x, this.player.y, 220, 145);

    // Level-up hand: equipped weapons' level-ups and upgrades, general cards, and (while a slot is
    // free) sometimes a NEW WEAPON card that opens a pick of 1 of 3 weapons. A card locked with gold in
    // an earlier hand comes back in its slot (if still valid) in place of one random card.
    // Under the weapon floor (weapon-floor.js) the level-up is a forced CHOOSE A WEAPON pick instead;
    // a gold lock waits for the next hand.
    if (weaponFloorDue(this.player)) {
      this.banishMode = false;
      this.openWeaponPick({ forced: true });
      document.getElementById('upgrade-modal').classList.remove('hidden');
      return;
    }
    this.beginHand();
    this.currentChoices = rollHandAround(this.player, this.handSize(), this.handLock, rollLevelUpHand);
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

    this.setUpgradeHeader('GEOM RESONANCE ACHIEVED', 'SYSTEM EVOLUTION', `Press <span>[1]</span>-<span>[${this.currentChoices.length}]</span>, Click, or D-Pad + <span>A</span> to Evolve`);
    this.renderHand();
    document.getElementById('upgrade-modal').classList.remove('hidden');
  }

  // Cards in a level-up hand: 2 with one weapon, 3 with two or three, 4 from four (slot-rewards.js).
  handSize() {
    return handSizeFor(ownedWeapons(this.player).length);
  }

  // --- Gold: rerolls and card locks on the level-up hand (rules and costs in js/gold.js) -----------

  // New level-up hand: reroll cost back to the base, and a lock carried from the last hand re-checked.
  beginHand() {
    this.handPhase = 'hand';
    this.handRerolls = 0;
    this.handLock = null;
    this.handLockPaid = 0; // a carried lock was paid for in its own hand: letting it go refunds nothing
    this.lockNote = '';
    this.banishMode = false;
    this.banishArmed = -1;
    this.skipArmed = false;
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
    if (this.currentChoices.some((c) => c.isNewWeapon)) this.maybeOpenSlotTip();
  }

  // The first NEW WEAPON card on a device opens a short tip on slot bonuses over the hand (once: the flag
  // is stored, js/slot-rewards.js). While it is open, keys and pad buttons only close it.
  maybeOpenSlotTip() {
    this.slotTipSeen ??= readSlotTipSeen();
    if (this.slotTipSeen || this.slotTipOpen) return;
    const doc = globalThis.document;
    const modal = doc?.getElementById?.('upgrade-modal');
    if (!modal || !doc.createElement) return;
    this.slotTipSeen = true;
    writeSlotTipSeen();
    this.slotTipOpen = true;
    const wrap = doc.createElement('div');
    wrap.id = 'slot-tip';
    wrap.className = 'slot-tip';
    wrap.innerHTML = slotTipHtml(slotTip(weaponSlots()));
    wrap.querySelector?.('[data-slot-tip-ok]')?.addEventListener('click', () => this.closeSlotTip());
    modal.appendChild(wrap);
    this.menuGrace = Math.max(this.menuGrace || 0, CHOICE_CLICK_GUARD_MS / 1000);
  }

  closeSlotTip() {
    if (!this.slotTipOpen) return;
    this.slotTipOpen = false;
    globalThis.document?.getElementById?.('slot-tip')?.remove?.();
    // A held key or button that closed the tip must not also pick the card under the cursor.
    this.menuGrace = Math.max(this.menuGrace || 0, CHOICE_CLICK_GUARD_MS / 1000);
    this.sound?.playUiSelect?.();
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

  // Give back what the lock on screen cost in this hand (toggleCardLock): the counters tick back up with a
  // gain flash, a little coin chime and a float. `how` words the float; nothing happens for a carried lock.
  refundHandLock(how = 'unlocked') {
    const paid = this.handLockPaid || 0;
    this.handLockPaid = 0;
    if (!(paid > 0)) return 0;
    this.gold += paid;
    this.goldSpent = Math.max(0, (this.goldSpent || 0) - paid);
    if (how !== 'moved') { // a moved lock nets out: the new lock's spend flash says it all
      this.flashGold('refund');
      const p = this.player;
      if (p) this.particles?.spawnFloatText?.(p.x, p.y - 22, `+${paid} ${GOLD_ICON} LOCK REFUNDED`, '#ffcc00', 12);
      this.sound?.playGoldPickup?.();
    }
    this.updateHUD?.();
    return paid;
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
      el.classList.remove('gold-flash-gain', 'gold-flash-spend', 'gold-flash-short', 'gold-flash-refund');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add(`gold-flash-${kind}`);
    }
  }

  // Level-up modal keys: [1]-[4] pick, Shift+[1]-[4] lock/unlock that card, [R] rerolls (R is the
  // radar toggle only during play), [B] then [1]-[4] banishes that card ([B] again or [Esc] cancels),
  // [K] skips the hand for gold.
  handleUpgradeKey(code, shift = false) {
    if (this.state !== 'UPGRADE') return false;
    if (this.slotTipOpen) {
      if (/^(?:Enter|Space|Escape|(?:Digit|Numpad)\d)$/.test(code)) this.closeSlotTip();
      return true;
    }
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
    if (code === 'KeyK') return this.skipHand();
    return false;
  }

  // Level-up modal controller extras (A still picks the focused card): X rerolls, Y locks or unlocks
  // the focused card, RB twice banishes it, LB twice skips the hand (LB is also dash, so one press only
  // arms it; any other button disarms).
  handleUpgradePad(gp) {
    if (this.state !== 'UPGRADE' || !gp) return false;
    if (this.slotTipOpen) {
      if ([PAD.A, PAD.B, PAD.X, PAD.Y, PAD.START].some((b) => gp.pressed(b))) this.closeSlotTip();
      return true; // nothing under the tip can be picked while it is open
    }
    if (gp.pressed(PAD.LB)) return this.skipHand(false);
    if (this.skipArmed && [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.RB].some((b) => gp.pressed(b))) {
      this.skipArmed = false;
      this.renderHandControls();
    }
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
    if (this.handLock?.card === card) {
      this.handLock = null;
      this.refundHandLock(); // its lock was for nothing: paid in this hand, it comes back
    }
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

  // SKIP: take no card and bank skipReward() gold (js/gold.js). A locked card carries into the next hand,
  // as if another card had been picked. `confirmed` false (controller LB) only arms it the first time.
  skipHand(confirmed = true) {
    if (!this.canEditHand() || this.slotTipOpen) return false;
    if (!confirmed && !this.skipArmed) {
      this.skipArmed = true;
      this.renderHandControls();
      this.sound?.playUiSelect?.();
      return true;
    }
    this.skipArmed = false;
    if (this.handLock) this.carriedLock = { card: this.handLock.card, slot: this.handLock.slot };
    this.handLock = null;
    this.runStats?.skip?.();
    const p = this.player;
    const reward = skipReward();
    this.gold += reward;
    this.goldEarned += reward;
    this.flashGold('gain');
    // The hand is flicked away and the gold rings in: a warm ring, a spray of coin glints, a coin chord.
    this.particles.spawnFloatText(p.x, p.y - 24, reward ? `SKIPPED // +${reward} ${GOLD_ICON} GOLD` : 'SKIPPED', '#ffcc00', 15);
    burst(this, 'pick', p.x, p.y, { hue: 48, scale: 0.9 });
    for (let i = 0; i < Math.min(6, Math.max(2, Math.round(reward / 2))); i++) {
      const a = (i / 6) * Math.PI * 2;
      burst(this, 'gold', p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26, { scale: 0.8 });
    }
    playPreset(this.sound, 'skipCash');
    this.sound?.playGoldPickup?.();
    this.closeUpgradeModal();
    return true;
  }

  // EVOLUTION READY: an evolution whose recipe the last pick completed can now turn up in level-ups.
  announceEvolutions(readyBefore) {
    const p = this.player;
    const fresh = readyEvolutions(p).filter((id) => !readyBefore.includes(id));
    fresh.forEach((id, i) => {
      this.particles.spawnFloatText(p.x, p.y - 46 - i * 18, `⚗ EVOLUTION READY: ${evolutionName(id).toUpperCase()}`, RARITY.evolution.color, 15);
    });
    if (!fresh.length) return;
    burst(this, 'pick', p.x, p.y, { hue: hueOf(RARITY.evolution.color, 315), scale: 1.2 });
    playPreset(this.sound, 'shimmer', { pitch: semis(3) });
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
    if (this.state === 'UPGRADE' && this.handPhase === 'weapon') return this.rerollWeaponPick();
    if (!this.canEditHand()) return false;
    if (!this.spendGold(this.rerollPrice())) return false;
    this.handRerolls++;
    this.banishArmed = -1;
    this.player.newWeaponDrought = this.handDrought;
    this.currentChoices = rollHandAround(this.player, this.handSize(), this.handLock, rollLevelUpHand);
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

  // Gold price of the next reroll of the NEW WEAPON pick (40, 80, 160... gold; Probability Engine discounts it).
  weaponRerollPrice() {
    return Math.round(weaponRerollCost(this.pickRerolls) * (this.player?.rerollCostMult ?? 1));
  }

  // A NEW WEAPON pick can be rerolled while some unequipped weapon is not already on offer.
  canRerollWeaponPick() {
    return this.state === 'UPGRADE' && this.handPhase === 'weapon' && unownedWeapons(this.player).length > this.currentChoices.length;
  }

  // REROLL on the NEW WEAPON pick: 3 fresh weapons, ones not just shown first.
  rerollWeaponPick() {
    if (!this.canRerollWeaponPick()) return false;
    if (!this.spendGold(this.weaponRerollPrice())) return false;
    this.pickRerolls++;
    const shown = this.currentChoices.map((c) => c.weaponId);
    this.currentChoices = rollWeaponPicks(this.player, WEAPON_PICK_SIZE, shown);
    this.runStats?.reroll();
    this.runStats?.offered(this.currentChoices);
    const focusedIndex = this.focusedChoiceIndex();
    this.renderWeaponPick();
    if (focusedIndex >= 0) this.focusChoice(Math.min(focusedIndex, this.currentChoices.length - 1));
    this.sound.playLevelUp();
    return true;
  }

  // LOCK toggle on card `index`: locking costs gold, and only one card can be locked. Letting go of a lock
  // placed in this hand refunds it in full (unlocking it, moving it to another card, banishing the locked
  // card), so changing your mind is free; a lock carried in from an earlier hand was paid for there and
  // refunds nothing. Moving the lock refunds first, so the gold for one lock is always enough.
  toggleCardLock(index) {
    if (!this.canEditHand()) return false;
    const card = this.currentChoices[index];
    if (!card) return false;
    if (this.handLock?.card === card) {
      this.handLock = null;
      this.refundHandLock();
    } else {
      const refund = this.handLockPaid;
      if (this.gold + refund < lockCost()) return this.spendGold(lockCost()); // flashes SHORT, changes nothing
      this.refundHandLock(this.handLock ? 'moved' : 'unlocked');
      if (!this.spendGold(lockCost())) return false;
      this.handLock = { card, slot: index };
      this.handLockPaid = lockCost();
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
    const inPick = this.handPhase === 'weapon';
    doc?.getElementById('hand-goldbar')?.classList?.[inHand || inPick ? 'remove' : 'add']('hidden');
    doc?.getElementById('upgrade-modal')?.classList?.[inPick ? 'add' : 'remove']('phase-weapon');
    const count = doc?.getElementById('hand-gold-count');
    if (count) count.textContent = `${GOLD_ICON} ${this.gold} GOLD`;
    const cost = inPick ? this.weaponRerollPrice() : this.rerollPrice();
    const lc = lockCost();
    const reroll = doc?.getElementById('btn-reroll-hand');
    if (reroll) {
      const affordable = this.gold >= cost;
      const open = inHand || (inPick && this.canRerollWeaponPick());
      reroll.disabled = !open || !affordable;
      reroll.innerHTML = `↻ REROLL${inPick ? ' WEAPONS' : ''} · ${cost} ${GOLD_ICON} <span class="hand-key">[R] / X</span>`;
      reroll.title = inPick && !open ? 'No other weapons left to offer'
        : affordable ? `Reroll the ${inPick ? 'weapons on offer' : 'unlocked cards'} for ${cost} gold` : `Need ${cost} gold to reroll (you have ${this.gold})`;
    }
    // SKIP (level-up hands only): no card, a little gold. Controller LB arms it, a second LB skips.
    const skip = doc?.getElementById('btn-skip-hand');
    if (skip) {
      const sr = skipReward();
      skip.classList?.[inHand ? 'remove' : 'add']('hidden');
      skip.classList?.[this.skipArmed ? 'add' : 'remove']('armed');
      skip.innerHTML = this.skipArmed
        ? `⏭ CONFIRM SKIP · +${sr} ${GOLD_ICON} <span class="hand-key">LB</span>`
        : `⏭ SKIP · +${sr} ${GOLD_ICON} <span class="hand-key">[K] / LB×2</span>`;
      skip.title = `Take no card this level-up and bank ${sr} gold${this.handLock ? ' (your locked card comes back next level-up)' : ''}`;
    }
    const note = doc?.getElementById('hand-lock-note');
    if (note && inPick) {
      note.textContent = this.canRerollWeaponPick() ? `↻ ${cost} ${GOLD_ICON} swaps these for different weapons` : 'Every weapon left is on offer';
      note.classList?.remove('dropped');
    } else if (note) {
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
      // LOCK / BANISH live in the card's own action strip under it (renderChoiceCards), not on the card.
      const banish = this.choiceBanishEls?.[idx];
      if (banish) {
        const bc = banishCost();
        const armed = this.banishArmed === idx;
        const nw = !!this.currentChoices[idx]?.isNewWeapon;
        banish.classList?.[nw ? 'add' : 'remove']('hidden');
        banish.classList?.[this.gold >= bc ? 'remove' : 'add']('unaffordable');
        banish.classList?.[armed || this.banishMode ? 'add' : 'remove']('armed');
        banish.innerHTML = armed ? `✕ CONFIRM <span class="act-cost">${bc} ${GOLD_ICON}</span>` : `✕ <span class="act-word">BANISH</span> <span class="act-cost">${bc} ${GOLD_ICON}</span>`;
        banish.title = this.gold >= bc ? `Banish for ${bc} gold: this card never comes up again this run, at any level (click twice)` : `Need ${bc} gold to banish`;
      }
      const toggle = this.choiceLockEls?.[idx];
      if (!toggle) return;
      const affordable = locked || this.gold >= lc;
      toggle.innerHTML = locked ? '🔓 UNLOCK' : `🔒 <span class="act-word">LOCK</span> <span class="act-cost">${lc} ${GOLD_ICON}</span>`;
      toggle.classList?.[affordable ? 'remove' : 'add']('unaffordable');
      toggle.classList?.[locked ? 'add' : 'remove']('on');
      toggle.setAttribute?.('aria-pressed', String(locked));
      toggle.title = locked ? 'Unlock (no refund)'
        : affordable ? `Lock for ${lc} gold: it stays through rerolls and comes back next level-up if you pick another card`
        : `Need ${lc} gold to lock`;
    });
  }

  setUpgradeHeader(subtitle, title, hint) {
    this.setSlotReward(null);
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
    this.radio?.undock(); // Dr. Pixie leaves the old grid before it's cleared
    const container = document.getElementById('upgrade-choices');
    container.innerHTML = '';
    this.closeCardDetail();
    container.classList?.[descs.length >= 4 ? 'add' : 'remove']('cards-4');
    const shownAt = performance.now();
    this.choicesShownAt = shownAt;
    this.choiceCardEls = [];
    this.choiceLockEls = [];
    this.choiceBanishEls = [];
    descs.forEach((d, idx) => {
      const view = renderUpgradeCard(d, `[${idx + 1}]`);
      const card = document.createElement('div');
      card.className = view.className;
      card.innerHTML = view.html;
      dealInCard(card, idx, view.className);
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
      // Each card sits in a slot; in level-up hands the slot adds a strip of big LOCK / BANISH buttons
      // UNDER the card, outside it and past a gap, so a near-miss can never pick the card (the card only
      // listens for clicks on itself). renderHandControls labels them. Not <button>s, so the controller's
      // focus stays on whole cards: Y locks and RB×2 banishes the focused card.
      const slot = document.createElement('div');
      slot.className = 'card-slot';
      slot.appendChild(card);
      if (this.handPhase === 'hand') {
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        actions.style?.setProperty?.('--deal-i', idx);
        const action = (cls, fn) => {
          const el = document.createElement('div');
          el.className = `card-action ${cls}`;
          el.setAttribute?.('role', 'button');
          el.addEventListener('click', (e) => {
            e.stopPropagation?.();
            if (performance.now() - shownAt < CHOICE_CLICK_GUARD_MS) return;
            fn();
          });
          actions.appendChild(el);
          return el;
        };
        this.choiceLockEls[idx] = action('card-lock-toggle', () => this.toggleCardLock(idx));
        this.choiceBanishEls[idx] = action('card-banish-toggle', () => this.banishCard(idx));
        slot.appendChild(actions);
      }
      container.appendChild(slot);
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
    addCardGlow(card, view.className, doc);
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
  // Gold can reroll the 3 weapons (rerollWeaponPick); the slot's reward shows under the title.
  // `forced`: a weapon floor pick (triggerLevelUp), with the floor in the header.
  openWeaponPick({ forced = false } = {}) {
    this.handPhase = 'weapon';
    this.pickRerolls = 0;
    this.currentChoices = rollWeaponPicks(this.player, WEAPON_PICK_SIZE);
    this.runStats?.offered(this.currentChoices);
    this.runStats?.weaponPickOdds(unownedWeapons(this.player), this.currentChoices);
    if (this.currentChoices.length === 0) {
      this.closeUpgradeModal();
      return;
    }
    const p = this.player;
    const slot = ownedWeapons(p).length + 1;
    this.setUpgradeHeader(forced ? `LV ${p.level} // ${weaponFloor(p.level)} WEAPONS REQUIRED // SLOT ${slot} OF ${weaponSlots()}` : `SLOT ${slot} OF ${weaponSlots()} // NEW WEAPON`, 'CHOOSE A WEAPON',
      `Press ${this.currentChoices.map((_, i) => `<span>[${i + 1}]</span>`).join(' ')}, Click, or D-Pad + <span>A</span> to Equip`);
    const reward = slotReward(slot);
    this.setSlotReward(reward && { ...reward, slot });
    this.renderWeaponPick();
    // On narrow screens the hand scrolls; start the pick at its header, not where NEW WEAPON was.
    const modal = document.getElementById('upgrade-modal');
    for (const el of [modal, modal.querySelector?.('.modal-card')]) if (el) el.scrollTop = 0;
    // Same modal state, so the controller grace (set on state changes) is restarted by hand.
    this.menuGrace = Math.max(this.menuGrace, CHOICE_CLICK_GUARD_MS / 1000);
    this.sound.playLevelUp();
  }

  renderWeaponPick() {
    const p = this.player;
    this.renderChoiceCards(this.currentChoices.map((c) => describeWeaponPick(p, c.weaponId)));
    this.renderHandControls();
  }

  // The slot reward banner under the upgrade modal's title (the NEW WEAPON pick); null hides it.
  setSlotReward(reward) {
    const el = globalThis.document?.getElementById?.('upgrade-slot-reward');
    if (!el) return;
    el.innerHTML = slotRewardHtml(reward);
    el.classList?.[reward ? 'remove' : 'add']('hidden');
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
      // 3 options from the weapon's pool (docs/BREAKTHROUGH_POOLS.md).
      this.currentChoices = drawBreakthroughOptions(id, level, p.breakthroughs?.[id]).map((opt) => describeBreakthrough(p, id, level, opt));
      this.runStats?.offered(this.currentChoices);
      this.renderHandControls();
      const name = WEAPON_BY_ID[id].name;
      // The weapon filling BREAKTHROUGH_SLOT (the last, slot 5) gets its LV 6 Breakthrough before it reaches LV 6 (slot-rewards.js).
      const early = weaponLevel(p, id) < level;
      this.setUpgradeHeader(early ? `⚛ ${name.toUpperCase()} // SLOT ${ownedWeapons(p).indexOf(id) + 1} BONUS BREAKTHROUGH` : `⚛ ${name.toUpperCase()} REACHED LV ${level} // R&D BREAKTHROUGH`, 'BREAKTHROUGH',
        `${rdLine(this.rdLineIndex = (this.rdLineIndex || 0) + 1, name)}<br>Press ${this.currentChoices.map((_, i) => `<span>[${i + 1}]</span>`).join(' ')}, Click, or D-Pad + <span>A</span> to Choose`);
      this.renderChoiceCards(this.currentChoices);
      // Big, in a 4th column beside the 3 pool cards.
      if (this.radioOn && this.radio.dock(document.getElementById('upgrade-choices'))) document.getElementById('upgrade-choices').classList?.add('cards-4');
      this.pixie?.offer(id, name); // Dr. Pixie's EUREKA on the radio (never blocks the pick)
      const modal = document.getElementById('upgrade-modal');
      modal.classList.remove('hidden');
      for (const el of [modal, modal.querySelector?.('.modal-card')]) if (el) el.scrollTop = 0;
      this.menuGrace = Math.max(this.menuGrace || 0, CHOICE_CLICK_GUARD_MS / 1000);
      this.particles.spawnShockwave(p.x, p.y, 260, 280, 5, 0.5);
      burst(this, 'unlock', p.x, p.y, { hue: 172 });
      if (this.sound.playBreakthrough) this.sound.playBreakthrough();
      else this.sound.playLevelUp();
      return true;
    }
    return false;
  }

  closeUpgradeModal() {
    this.breakthrough = null;
    this.radio?.undock(); // her reaction plays on in the corner
    if (this.openNextBreakthrough()) return;
    this.currentChoices = [];
    this.handPhase = null;
    this.handLock = null;
    this.closeCardDetail();
    this.closeSlotTip();
    document.getElementById('upgrade-modal').classList.add('hidden');
    document.getElementById('upgrade-modal').classList.remove?.('phase-weapon');
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
    this.processPendingLevelUps();
    this.updateHUD();
  }

  selectUpgrade(index) {
    if (this.state !== 'UPGRADE' || this.slotTipOpen) return;
    const upg = this.currentChoices[index];
    if (!upg) return;
    const p = this.player;
    this.sound?.playUiConfirm?.();
    this.runStats?.picked(upg);
    const readyBefore = readyEvolutions(p);

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
      applyBreakthrough(p, upg.weaponId, upg.level, upg.option);
      this.pixie?.picked(upg);
      this.particles.spawnFloatText(p.x, p.y - 24, `⚛ ${upg.name.toUpperCase()}!`, upg.color, 16);
      this.particles.spawnShockwave(p.x, p.y, 220, 280, 4, 0.45);
      burst(this, 'pick', p.x, p.y, { hue: hueOf(upg.color, 172), scale: 1.3 });
      this.closeUpgradeModal();
      return;
    }
    if (upg.isWeaponPick) {
      acquireWeapon(p, upg.weaponId);
      this.announceEvolutions(readyBefore);
      const weapon = WEAPON_BY_ID[upg.weaponId];
      this.particles.spawnFloatText(p.x, p.y - 24, `${weapon.name.toUpperCase()} EQUIPPED!`, RARITY.weapon.color, 16);
      this.particles.spawnShockwave(p.x, p.y, 180, 186, 4, 0.4);
      burst(this, 'unlock', p.x, p.y, { hue: hueOf(RARITY.weapon.color), scale: 0.8 });
      playPreset(this.sound, 'shimmer');
      this.closeUpgradeModal();
      return;
    }

    const jump = this.applyUpgrade(upg);
    this.announceEvolutions(readyBefore);
    const jumpText = jump > 1 ? ` (+${jump} LEVELS!)` : ' UPGRADED!';
    const color = RARITY[rarityFor(upg, jump)].color;
    this.particles.spawnFloatText(p.x, p.y - 24, `${upg.name}${jumpText}`, color, 15);
    burst(this, 'pick', p.x, p.y, { hue: hueOf(color, 205), scale: 0.8 + 0.12 * Math.min(5, jump) });
    playPreset(this.sound, 'pickSnap', { pitch: semis(2 * (Math.min(5, jump) - 1)) }); // rarer = higher
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
      // Its Breakthroughs (transform or flat names), then its stat cards and evolutions.
      const bt = Object.entries(p.breakthroughs?.[id] || {})
        .map(([m, v]) => `<span class="loadout-line bt">⚛ ${btOption(id, +m, v)?.name ?? ''}</span>`).join('');
      const lines = bt + lineList
        // Element cards drop their "Autocannon: " prefix here: the slot already names the weapon.
        .map((l) => `<span class="loadout-line${l.isSynergy ? ' evo' : ''}">${l.name.replace('SYNERGY: ', '').replace(/^[^:]+: /, '')} ${l.isSynergy ? '★' : `×${l.level}`}</span>`).join('');
      const pending = this.discardPending === id;
      const blocked = this.discardBlocked === id;
      // Lines another equipped weapon still uses (weapon-specific lines shared by two weapons) stay.
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

  // dying: the shield just collapsed, so the death sequence plays before the results open.
  triggerGameOver({ dying = false, victory = false } = {}) {
    // The range ship can't die, but nothing from a range run is ever recorded: leave to the title instead.
    if (this.range?.active) {
      this.range.exit();
      return;
    }
    this.state = 'GAMEOVER';
    this.updateLowShieldVignette();
    // The run is over: the mode's TUNING overlay comes off (this.mode still names the run for the results).
    clearTuningOverlay();
    const rules = modeRules(this);
    this.updateGuideToast(); // a pending FIELD GUIDE UPDATED toast doesn't linger behind the results
    this.sound.setMusicState({ intensity: 0.3, muffled: true, boss: 0 });
    if (victory) this.sound.playBossDefeat?.();
    else if (this.sound.playGameOver) this.sound.playGameOver();
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

    const head = resultsHeadline({ victory, campaignWon: this.campaignWon, wave: this.wave, label: rules.badge ? rules.label : '' });
    const subtitle = document.getElementById('gameover-subtitle');
    if (subtitle) {
      subtitle.textContent = head.subtitle;
      subtitle.classList[head.won ? 'add' : 'remove']('victory-text');
      subtitle.classList[head.won ? 'remove' : 'add']('danger-text');
    }
    const title = document.getElementById('gameover-title');
    if (title) {
      title.textContent = head.title;
      title.classList[victory ? 'add' : 'remove']('victory-glow');
      title.classList[victory ? 'remove' : 'add']('danger-glow');
    }
    const modeTag = document.getElementById('go-mode-tag');
    if (modeTag) {
      modeTag.textContent = rules.badge || rules.label;
      modeTag.className = `mode-badge mode-${rules.id}`;
      modeTag.title = rules.blurb;
    }

    const statsEl = document.getElementById('gameover-stats');
    const breakdown = scoreBreakdown(this);
    statsEl.innerHTML = `
      <div class="go-stat-box">
        <div class="go-stat-label">FINAL SCORE</div>
        <div class="go-stat-val" style="color:var(--cyan)">${this.score.toLocaleString()}${breakdown ? `<div class="go-stat-sub">${breakdown}</div>` : ''}</div>
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
    const cause = this.lastRunSummary?.cause;
    if (dying) this.replayRec?.markDeath();
    this.deathSeq = dying && this.player ? new DeathSequence(this.player, {
      killer: cause && cause !== 'unknown' ? hostileEntry(cause)?.name || String(cause).toUpperCase() : null
    }) : null;
    if (!this.deathSeq) this.revealGameOver();
  }

  revealGameOver() {
    if (this.deathSeq) this.deathSeq.revealed = true;
    this.deathSeq = null;
    this.syncDeathContinue();
    if (this.state === 'GAMEOVER') document.getElementById('gameover-modal').classList.remove('hidden');
  }

  // The death sequence's CONTINUE button: shown once the headline lands, labelled for the input in use.
  syncDeathContinue() {
    const btn = document.getElementById('btn-death-continue');
    if (!btn) return;
    const show = !!this.deathSeq && this.deathSeq.t >= DEATH_TIMING.headline;
    const label = this.gpActive ? 'Ⓐ CONTINUE' : this.touchMode ? 'CONTINUE ▶' : 'CONTINUE ⏎';
    if (btn.textContent !== label) btn.textContent = label;
    if (show) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
    // The HUD and touch controls step aside while the death screen is up.
    const body = globalThis.document?.body;
    if (body && !!this.deathSeq !== body.classList.contains('death-screen')) {
      if (this.deathSeq) body.classList.add('death-screen');
      else body.classList.remove('death-screen');
    }
  }

  // Shared effects the death sequence drives.
  deathFx() {
    return this._deathFx ||= {
      particles: this.particles,
      grid: this.grid,
      sound: this.sound,
      addShake: (amount) => this.addShake(amount),
      flash: () => { this.chromaFlash = Math.max(this.chromaFlash || 0, 0.3); }
    };
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
    if (this.startPickOpen) {
      this.updateStartPickController(gp, dt);
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
      VICTORY: ['victory-modal', 'btn-victory-continue'],
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
    // The right stick scrolls the highscore board on the title and game-over screens.
    if (gp.aimY && (this.state === 'TITLE' || this.state === 'GAMEOVER')) root.querySelector?.('.highscore-list')?.scrollBy?.({ top: gp.aimY * 16, behavior: 'instant' });
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
  // oldest fold into a loose neighbour within GEOM_MERGE_RADIUS (no XP lost); merged geoms draw a little
  // bigger. A geom with no neighbour that close stays put, even past the cap: merging across the field read
  // as geoms disappearing. Loose geoms are bucketed into GEOM_MERGE_RADIUS cells, so each lookup only scans
  // the 3x3 cells around it.
  mergeLooseGeoms() {
    const loose = [];
    for (const g of this.geoms) if (!g.isCore && !g.isGold && !g.isBomb && !g.magnetized) loose.push(g);
    let excess = loose.length - MAX_LOOSE_GEOMS;
    if (excess <= 0) return;
    const r = GEOM_MERGE_RADIUS, cells = new Map();
    const cellOf = (g) => `${Math.floor(g.x / r)},${Math.floor(g.y / r)}`;
    for (const g of loose) {
      const k = cellOf(g);
      const cell = cells.get(k);
      if (cell) cell.push(g); else cells.set(k, [g]);
    }
    const gone = new Set();
    for (const g of loose) {
      if (excess <= 0) break;
      const cx = Math.floor(g.x / r), cy = Math.floor(g.y / r);
      let into = null, best = r * r;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const o of cells.get(`${cx + dx},${cy + dy}`) || []) {
          if (o === g || gone.has(o)) continue;
          const d = (o.x - g.x) ** 2 + (o.y - g.y) ** 2;
          if (d <= best) { best = d; into = o; }
        }
      }
      if (!into) continue;
      into.xp += g.xp;
      into.merged = (into.merged || 0) + (g.merged || 0) + 1;
      gone.add(g);
      excess--;
    }
    if (!gone.size) return;
    let w = 0;
    for (const g of this.geoms) if (!gone.has(g)) this.geoms[w++] = g;
    this.geoms.length = w;
  }

  update(dt) {
    // A boss-kill hit-stop/slow-mo tick freezes the world, grid and particles together.
    const held = this.state === 'PLAYING' && this.consumeTimeDilation();
    if (!held) {
      this.grid.update(this.camX, this.camY, this.width, this.height);
      this.particles.density = particleDensity(this.enemyManager?.enemies?.length ?? 0);
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
    if (this.deathSeq) {
      if (this.radio?.onAir) this.radio.clear();
      const skip = (gp?.pressed(PAD.A) || gp?.pressed(PAD.START)) && this.deathSeq.skip();
      this.deathSeq.update(dt, this.deathFx());
      // The tape stops when the headline lands: the last seconds of play plus the blast.
      if (this.deathSeq.landed && !this.deathSeq.tapeTaken) {
        this.deathSeq.tapeTaken = true;
        const clip = this.replayRec?.takeClip();
        if (clip) this.deathSeq.replay = new ReplayPlayer(clip);
      }
      if (skip) this.revealGameOver();
      else this.syncDeathContinue();
      this.gpDashLatch = !!gp?.dash;
      this.gpBombLatch = !!gp?.bomb;
      return;
    }
    if (this.state === 'CUTSCENE') {
      this.cutscene.update(dt, gp);
      this.gpDashLatch = !!gp?.dash;
      this.gpBombLatch = !!gp?.bomb;
      return;
    }
    // The radio plays on over play, level-ups and caches; it's off air everywhere else.
    if (['PLAYING', 'UPGRADE', 'CHEST', 'VICTORY'].includes(this.state)) this.radio?.update(dt);
    else if (this.radio?.onAir && this.state !== 'PAUSED') this.radio.clear();
    const stateBefore = this.state;
    this.updateMenuController(gp, dt);
    if (this.state !== 'PLAYING' || stateBefore !== 'PLAYING') {
      for (const sp of [this.flamethrower, this.cryoSprayer, this.acidSprayer]) if (sp?.firing) sp.silence(this); // no roar under menus or game over
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
    if (this.novaCalloutShowing()) this.novaCalloutTimer = Math.max(0, this.novaCalloutTimer - dt);
    if (this.ltCardTimer > 0) this.ltCardTimer = Math.max(0, this.ltCardTimer - dt);
    if (held) {
      this.updateHUD();
      return;
    }

    this.elapsedTime += dt;
    this.waveTimer += dt;
    if (tickVictory(this, dt)) return;
    if ((++this.statsTick & 15) === 0) this.syncRunStats();

    const enemyCount = this.enemyManager.enemies.length;
    const dynamicIntensity = Math.min(
      1.0,
      0.32 + (enemyCount / 50) * 0.42 + ((this.multiplier - 1) / 15) * 0.18 + (this.wave - 1) * 0.05
    );
    // Boss warning drops the mix out; a live boss pins it at full intensity with the boss riff.
    const bossStage = this.getBossStage();
    this.sound.setMusicState(finalStandMusic(this) ?? { intensity: bossStage === 2 ? 1.0 : dynamicIntensity, muffled: false, boss: bossStage });

    // Weapon Range: dummies and respawns instead of waves, bosses, lieutenants and packs.
    const range = this.range?.active ? this.range : null;
    if (range) range.tick();

    // Escalate waves every `waveLength` seconds (Difficulty Ramp tuning)
    // Wave 50 has no timer: the FINAL STAND holds it until the sector is clear (js/final-stand.js).
    if (!range && this.waveTimer >= (TUNING.waveLength ?? 22) && !holdsWave(this)) {
      this.waveTimer = 0;
      awardWaveBonus(this, this.wave); // survived it (js/score-bonus.js)
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
      tickFinalStand(this, dt);
      this.updateLieutenantSchedule();
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0 && !blocksSpawning(this)) {
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

    // Mid rift-jump the rift moves the ship (js/rifts.js): no steering, dashing or gravity tug.
    const jumping = !!this.rifts?.holdsShip();
    if (jumping) {
      p.gravityTug = 0;
    } else if (p.dashTimer > 0) {
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
    // Space-time rifts: open/seal on their timer, and swallow the ship when it flies in (the jump
    // moves the ship and cuts the camera to the far side).
    this.rifts?.update(dt, this);
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
    // to rock. Each claw swings on its own (clawTargets): both onto a rock dead ahead, else port to the
    // nearest rock on the left and starboard to the nearest on the right; otherwise along the hull.
    const speedMag = Math.hypot(p.vx, p.vy);
    if (speedMag > 0.35) p.hullAngle = turnToward(p.hullAngle ?? p.angle, Math.atan2(p.vy, p.vx), 0.22);
    p.hullAngle ??= p.angle;
    const clawAims = this.asteroidManager.clawAims?.(p) ?? [p.hullAngle, p.hullAngle];
    p.clawAngles ??= [p.hullAngle, p.hullAngle];
    for (let k = 0; k < 2; k++) p.clawAngles[k] = turnToward(p.clawAngles[k], clawAims[k], 0.22);
    // Shared heading (older callers and previews): halfway between the two arms.
    p.drillAngle = Math.atan2(Math.sin(p.clawAngles[0]) + Math.sin(p.clawAngles[1]), Math.cos(p.clawAngles[0]) + Math.cos(p.clawAngles[1]));

    // Spin the Twin Rotary Claw Drills
    const rpm = this.asteroidManager.isDrilling ? 34 : 11;
    p.drillSpin = (p.drillSpin || 0) + dt * rpm;
    updateShipAnimation(p, dt);

    // 3. Primary Weapon Firing
    const shouldFire = !jumping && (this.autoFire || this.mouse.down || touchAiming || (gp && (Math.abs(gp.aimX) > 0 || Math.abs(gp.aimY) > 0)));
    const hotRate = this.barrelHeat || shouldFire ? BTX.hotBarrelRate(this, dt, weaponBuild(p, 'blaster')) : 1; // Hot Barrel cools between hits
    if (shouldFire && ownsWeapon(p, 'blaster')) {
      this.fireAccumulator += dt * blasterFireRate(p) * hotRate;
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
    // Flamethrower, Cryo Sprayer, Acid Sprayer: spinning cones of fire / frost / acid (js/flamethrower.js).
    this.flamethrower?.update(dt, this, shouldFire);
    this.cryoSprayer?.update(dt, this, shouldFire);
    this.acidSprayer?.update(dt, this, shouldFire);
    this.railLance?.update(dt, this, shouldFire); // Rail Lance: charge, then a piercing line (js/rail-lance.js)
    this.drillDriver?.update(dt, this, shouldFire); // js/drill-driver.js

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
    this.gasTrail?.update(dt, this);
    this.nanites?.update(dt, this);
    this.shockField?.update(dt, this);
    this.glaive?.update(dt, this);
    this.quakeMortar?.update(dt, this);
    this.weaponFx?.update(dt, this);

    // 5. Sweep projectiles against enemies and cover in travel order (black holes bend them first).
    this.bendProjectilesInWells();
    this.repelProjectiles();
    this.updateBullets(dt);
    const enemies = this.enemyManager.enemies;

    // 6. Update Homing Swarm Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      if (m.chainSafe > 0) m.chainSafe -= dt; // a fresh Hunter-Killer clears its parent's blast first
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
        if (source === 'missile') {
          const el = sourceElement(p, 'missile');
          if (el === 'frost') this.particles.spawnShockwave(m.x, m.y, blast * 0.8, 192, 2.5, 0.4);
          else if (el === 'shock') this.particles.spawnShockwave(m.x, m.y, blast * 0.7, 62, 2, 0.25);
        }
        this.damageEnemiesInRadius(m.x, m.y, blast, m.damage, m.hue, source, KNOCKBACK.missile);
        BTX.missileBlast(this, m, blast);
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
          if (o !== m && !o.chain && !(o.chainSafe > 0) && (o.x - m.x) ** 2 + (o.y - m.y) ** 2 <= blast * blast) o.chain = true;
        }
        this.missiles.splice(i, 1);
      }
    }

    // 7. Update Player Vortex Singularities, then grid funnels & infall streams for every well
    this.updateSingularities(dt);
    this.updateWellEffects();

    // 7b. Element statuses: burn ticks, chill, corrode and stun timers (status-effects.js)
    updateStatusEffects(this, dt);

    // 8. Update Enemies & Asteroid Clusters + Auto-Mining Lasers
    // Warned boss spawns tear at the grid harder as their countdown runs out.
    for (const sp of this.enemyManager.spawnIndicators) {
      if (sp.config.isBoss) this.grid.applyImplosion(sp.x, sp.y, 1.2 + 3 * (1 - sp.timer / sp.maxTimer), 210, 348, 0.6);
    }
    this.enemyManager.view = spawnView(this);
    this.enemyManager.relocateSpawn ||= (sp) => this.spawnPoint(sp.config.radius);
    this.enemyManager.update(dt, p, this.bullets, this.grid, this.particles, this.worldWidth, this.worldHeight);
    updateBossWarps(this, dt);
    tickBossEscapes(this, dt); // every boss escapes after 3 minutes, bar the final one (js/boss-escape.js)
    playBossCues(this); // the major bosses' queued sound cues (with their shake and hit-stop)
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
      if (e.beam && p.invuln <= 0 && beamGap(e.beam, p.x, p.y) < p.radius + e.beam.width * 0.5) {
        // A live beam (lancer sweep, twin tether) burns the ship like an orb hit.
        this.damagePlayer(this.beamDamage(e), undefined, enemyKind(e));
        if (this.endRunIfDead()) return;
      }
      if (e.type === 'gate') {
        if (this.gateContact(e, p)) return;
        continue;
      }
      // Contact uses the same hull-hugging outline the shield draws.
      // A Blinker that just landed (arriveT) can't hit: only its lunge can (js/archetypes.js BLINKER).
      if (!(e.arriveT > 0) && shieldTouches(p, TUNING, e.x, e.y, e.radius)) {
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
      g.rotation += g.isCore ? 0.12 : g.isGold || g.isBomb ? 0.05 : 0.08;

      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      const attractR = g.isCore || g.isGold || g.isBomb ? p.stats.magnetRadius * 1.35 : p.stats.magnetRadius;

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
          burst(this, 'gold', g.x, g.y);
          this.addGold(g.gold || 1);
          this.score += Math.round(10 * this.multiplier);
          this.geoms.splice(i, 1);
          continue;
        }
        if (g.isBomb) {
          // A spare Supernova: a bright gold bloom, a chime on top of the core pickup, and the HUD count ticks up.
          this.sound.playGeomPickup(true);
          this.sound.playGoldPickup?.();
          burst(this, 'core', g.x, g.y, { hue: 45, scale: 1.3 });
          p.bombs = Math.min(BOMB_DROP.max, p.bombs + 1);
          this.particles.spawnFloatText(p.x, p.y - 22, '+1 ✸ SUPERNOVA', '#ffcc00', 15);
          this.geoms.splice(i, 1);
          continue;
        }
        this.sound.playGeomPickup(g.isCore);
        burst(this, g.isCore ? 'core' : 'pickup', g.x, g.y, g.isCore ? undefined : { hue: g.hue ?? 150 });

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
    setText(document.getElementById('score-display'), this.score.toLocaleString());
    setText(document.getElementById('multiplier-display'), `x${this.multiplier.toFixed(1)}`);
    setText(document.getElementById('luck-hud-display'), `🍀 ${Math.round((p.stats.luck || 1) * 100)}% LUCK`);
    setText(document.getElementById('cores-hud-display'), `❖ ${this.sessionCores} CORES (${this.progression.data.cores} BANKED)`);
    const goldHud = document.getElementById('gold-hud-display');
    setText(goldHud, `${GOLD_ICON} ${this.gold ?? 0} GOLD`);
    setText(document.getElementById('wave-display'), `WAVE ${this.wave}`);

    const mins = Math.floor(this.elapsedTime / 60);
    const secs = Math.floor(this.elapsedTime % 60);
    setText(document.getElementById('timer-display'), `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);

    const xpPct = Math.min(100, (p.xp / p.xpToNext) * 100);
    setStyle(document.getElementById('xp-bar-fill'), 'width', `${xpPct}%`);
    const levelEl = document.getElementById('level-display');
    setText(levelEl, `LVL ${p.level}`);
    // A new level pops the HUD readout (skipped with REDUCE EFFECTS).
    if (this.hudLevelShown !== p.level) {
      if (this.hudLevelShown !== undefined && !isReduceEffects()) {
        levelEl.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.45)', color: '#8dffb9', textShadow: '0 0 14px #2dff8a' }, { transform: 'scale(1)' }],
          { duration: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
      this.hudLevelShown = p.level;
    }

    const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
    setStyle(document.getElementById('hp-bar-fill'), 'width', `${hpPct}%`);
    // The ghost trails the fill (CSS transition delay), so a hit leaves a fading chunk behind.
    const ghost = document.getElementById('hp-bar-ghost');
    setStyle(ghost, 'width', `${hpPct}%`);
    const shieldLevel = hpPct < 35 ? 'low' : hpPct < 70 ? 'mid' : 'high'; // colours the bar (CSS)
    const shieldGroup = document.getElementById('shield-group');
    if (shieldGroup?.getAttribute?.('data-level') !== shieldLevel) shieldGroup?.setAttribute?.('data-level', shieldLevel);
    setText(document.getElementById('hp-text'), `${Math.ceil(p.hp)}/${p.maxHp}`);
    this.updateLowShieldVignette();

    const dashReadyPct = p.dashCooldown > 0 ? Math.max(0, (1 - p.dashCooldown / (p.dashCooldownDuration || TUNING.dashCooldownBase)) * 100) : 100;
    const dashEl = document.getElementById('dash-indicator');
    if (dashEl?.style) setStyle(dashEl, '--ready', (dashReadyPct / 100).toFixed(3));
    setClass(dashEl, 'ready', dashReadyPct >= 100);
    setText(document.getElementById('bombs-count'), String(p.bombs));
    setClass(document.getElementById('nova-indicator'), 'empty', !(p.bombs > 0));
    // The bottom dock centres itself in the space left of the radar (bottom-right) on narrow windows.
    const radarReserve = this.radarVisible && !this.touchMode
      ? Math.round((radarSize(this.width, this.height) + 18) * (this.viewScale || 1)) : 0;
    if (radarReserve !== this.radarReserve) {
      this.radarReserve = radarReserve;
      document.getElementById('hud')?.style?.setProperty?.('--radar-reserve', `${radarReserve}px`);
    }
    if (this.touchMode) this.touch?.setStatus(dashReadyPct / 100, p.bombs);

    // Loadout strip: one chip per weapon slot (equipped weapons in their colour, free slots dashed), with
    // the cards' level wording ("LV 3"). Rarity belongs to a roll, not a weapon, so chips stay
    // rarity-neutral. Every other upgrade is listed in the pause menu (js/run-overview.js), not here.
    const barHtml = weaponChipsHtml(p, { shockfield: this.shockField?.hudCharge(), turret: this.deployables?.turretHudCharge(p), raillance: this.railLance?.hudCharge() });
    if (barHtml !== this.weaponBarHtml) {
      this.weaponBarHtml = barHtml;
      document.getElementById('active-weapons-bar').innerHTML = barHtml;
    }

    this.updateBossHUD(this.getBossHudModel());
    this.updateNovaCallout();
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
    if (toast) setClass(el, 'guide-toast-out', this.guideToastTimer < 0.4);
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
      getPlayer: () => (this.state === 'PAUSED' ? this.player : null),
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

  // The browser boot shows the splash on every load; the title waits behind it. The page paints it
  // visible before this runs (no title flash), so hide it again if it doesn't open.
  showSplash() {
    if (this.state === 'TITLE' && this.splash?.show()) {
      this.splashOpen = true;
      this.resetInput();
    } else {
      globalThis.document?.getElementById('splash-screen')?.classList.add('hidden');
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

  // --- Starting weapon pick (pops up after LAUNCH / RESTART) ---------------------------------------

  // The browser boot switches this on; headless tests and tools start with the default kit.
  enableStartPick() {
    this.startPickEnabled = true;
    return this;
  }

  // Show the pick: the NEW WEAPON pick cards of START_WEAPON_CHOICES with their LV 1 numbers, the last
  // pick lit. Returns false when it can't open (headless, already open), so the run starts at once.
  openStartPick() {
    const doc = globalThis.document;
    const modal = doc?.getElementById?.('start-pick-modal');
    const grid = doc?.getElementById?.('start-pick-options');
    if (!this.startPickEnabled || this.startPickOpen || !modal || !grid) return false;
    const preview = this.startPreviewPlayer();
    const shownAt = performance.now();
    grid.innerHTML = '';
    this.startPickCards = START_WEAPON_CHOICES.map((id, idx) => {
      const d = { ...describeWeaponPick(preview, id), rarityLabel: 'STARTING WEAPON', levelHtml: 'START // LV 1' };
      const view = renderUpgradeCard(d, `[${idx + 1}]`);
      const card = doc.createElement('div');
      card.className = view.className;
      card.innerHTML = view.html;
      dealInCard(card, idx, view.className);
      card.addEventListener('click', () => {
        if (performance.now() - shownAt < CHOICE_CLICK_GUARD_MS) return;
        this.chooseStartWeapon(id);
      });
      grid.appendChild(card);
      return card;
    });
    this.startPickIndex = Math.max(0, START_WEAPON_CHOICES.indexOf(this.startWeapon));
    this.highlightStartPick();
    this.startPickReturnFocus = doc.activeElement;
    this.closeMobileWindows?.();
    modal.classList.remove('hidden');
    this.startPickOpen = true;
    this.resetInput();
    this.menuNav?.clear();
    doc.activeElement?.blur?.();
    return true;
  }

  closeStartPick() {
    if (!this.startPickOpen) return;
    this.startPickOpen = false;
    globalThis.document?.getElementById?.('start-pick-modal')?.classList.add('hidden');
    this.menuNav?.clear();
    this.menuState = null;
  }

  // BACK / Esc / B: return to the screen that launched (title, game over or pause), nothing changed.
  cancelStartPick() {
    if (!this.startPickOpen) return;
    this.closeStartPick();
    this.startPickReturnFocus?.focus?.();
  }

  chooseStartWeapon(id) {
    if (!this.startPickOpen || !START_WEAPON_CHOICES.includes(id)) return;
    this.startWeapon = id;
    writeStartWeapon(defaultStatsStorage(), id);
    this.sound.playUiSelect?.();
    this.startGame({ picked: true });
  }

  highlightStartPick() {
    (this.startPickCards || []).forEach((c, i) => c.classList.toggle('picked', i === this.startPickIndex));
  }

  // A fresh run's ship (this run's base stats, nothing equipped), so the cards show LV 1 numbers.
  startPreviewPlayer() {
    if (!this.player) this.resetRun(this.selectedMode); // no ship yet (the browser boot always builds one)
    const p = this.player;
    const base = p?.base;
    return {
      ...p,
      stats: structuredClone(base?.stats ?? p.stats),
      weapons: structuredClone(base?.weapons ?? p.weapons),
      upgradeLevels: {},
      breakthroughs: {},
      banished: {},
      loadout: []
    };
  }

  // Keyboard: [1-8] launch with that weapon, ←/→ (A/D) move the highlight, Enter/Space launch it, Esc back.
  handleStartPickKey(e, onControl) {
    const code = e.code;
    if (e.repeat) return;
    const n = START_WEAPON_CHOICES.length;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (digit && Number(digit[1]) <= n) {
      e.preventDefault();
      this.chooseStartWeapon(START_WEAPON_CHOICES[Number(digit[1]) - 1]);
    } else if (code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowLeft' || code === 'KeyA') {
      e.preventDefault();
      this.startPickIndex = (this.startPickIndex + (code === 'ArrowRight' || code === 'KeyD' ? 1 : -1) + n) % n;
      this.highlightStartPick();
      this.sound.playUiSelect?.();
    } else if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && !onControl) {
      e.preventDefault();
      this.chooseStartWeapon(START_WEAPON_CHOICES[this.startPickIndex]);
    } else if (code === 'Escape' || code === 'Backspace') {
      e.preventDefault();
      this.cancelStartPick();
    }
  }

  // Controller: D-pad between the cards (focus starts on the last pick), A launches, B goes back.
  updateStartPickController(gp, dt) {
    const root = globalThis.document?.getElementById?.('start-pick-modal');
    if (this.menuState !== 'START_PICK') {
      this.menuState = 'START_PICK';
      this.menuGrace = 0.3;
      this.menuNav?.clear();
    }
    this.menuGrace = Math.max(0, this.menuGrace - dt);
    if (!gp || !this.gpActive || !this.menuNav || !root) return;
    this.menuNav.update(root, gp, dt, this.startPickCards?.[this.startPickIndex] || null);
    if (this.menuGrace > 0) return;
    if (gp.pressed(PAD.B)) this.cancelStartPick();
    else if (gp.pressed(PAD.A) || gp.pressed(PAD.START)) this.menuNav.activate();
  }

  // The browser boot switches this on: the first LAUNCH on a device (the tutorial was never skipped or
  // finished here) shows the tutorial before the run. Headless tests and tools leave it off.
  enableFirstLaunchTutorial() {
    this.tutorialOnLaunch = true;
    return this;
  }

  // --- Opening cutscene (js/story.js, js/cutscene-stage.js) -----------------------------------------

  // The browser boot switches this on: the first LAUNCH on a device plays the opening before the
  // tutorial. Headless tests, tools and the balance harness leave it off.
  // The browser boot switches the radio on (Dr. Pixie's Breakthrough lines, Game.say); headless tests,
  // tools and the balance harness stay silent.
  enableStoryRadio() {
    registerStoryCast();
    this.radioOn = true;
    this.pixie.radio = this.radio;
    return this;
  }

  // Story hooks from js/rifts.js: Dr. Pixie explains the first rift of a save and cheers the first jump.
  onRiftOpened() { this.pixie?.riftOpened(this.mode); }
  onRiftJump() { this.pixie?.riftJumped(this.mode); }

  // A non-pausing radio line: say('pixie', 'EUREKA!', { mood: 'eureka' }). False when the radio is off.
  say(who, text, opts = {}) {
    return this.radioOn ? this.radio.say({ who, text, ...opts }) : false;
  }

  enableFirstLaunchIntro() {
    this.introOnLaunch = true;
    return this;
  }

  // The opening, from LAUNCH (`launchAfter`: hard-cut into the run, tutorial and weapon pick first when
  // they're due) or the INTRO button (back to the title).
  playIntro({ launchAfter = false } = {}) {
    return this.playCutscene('opening', { onEnd: (reason) => this.onIntroEnded(reason, launchAfter) });
  }

  // Any scene in SCENES (js/story.js) by id, from the title: plays over a fresh, untouched sector
  // (nothing is recorded). `onEnd(reason)` defaults to going back to the title.
  playCutscene(id, { onEnd = () => this.returnToTitle() } = {}) {
    const script = SCENES[id];
    if (!script || this.state !== 'TITLE' || this.cutscene.active || this.guideOpen || this.notesOpen || this.tutorialOpen || this.startPickOpen) return false;
    this.sound.init();
    this.closeMobileWindows();
    this.resetRun();
    const title = globalThis.document?.getElementById('title-modal');
    title?.classList.add('hidden');
    this.state = 'CUTSCENE';
    this.resetInput();
    globalThis.document?.activeElement?.blur?.();
    if (this.cutscene.play(script, { onEnd })) return true;
    this.state = 'TITLE';
    title?.classList.remove('hidden');
    return false;
  }

  onIntroEnded(_reason, launchAfter) {
    this.introSeen = true;
    writeIntroSeen(defaultIntroStorage());
    if (!launchAfter) return this.returnToTitle();
    this.state = 'TITLE';
    globalThis.document?.getElementById('title-modal')?.classList.remove('hidden');
    this.startGame();
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

  // Volatile Shatter shard: a small spinning pale-gold sliver of glass with a faint wake, so the chain
  // reaction reads apart from ordinary bolts without drowning the screen at high levels.
  drawShard(ctx, b) {
    const spin = (b.spin += 0.35);
    const len = 5.5, wid = 2 + 1.2 * Math.abs(Math.sin(spin));
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'hsla(48, 100%, 62%, 0.3)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 1.8, b.y - b.vy * 1.8);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    ctx.fillStyle = 'hsla(48, 100%, 86%, 0.8)';
    ctx.strokeStyle = 'hsla(46, 100%, 62%, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(0, -wid);
    ctx.lineTo(-len * 0.6, 0);
    ctx.lineTo(0, wid);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Rocket Pod rocket: an orange dart with a flickering exhaust plume, distinct from blaster streaks.
  // Rocket Pod rocket: a crimson finned body (not the amber of Swarm Missiles or the cyan Autocannon),
  // a white-hot engine core inside a red flame, and a fading grey smoke streak behind it.
  // Rocket Pod rocket, in its own frame (nose along +x), 1.4x the old size so it reads over a busy field:
  // a smoke streak, a hot exhaust bloom and flame, then a long red body with swept fins and a white nose.
  drawWingRocket(ctx, b) {
    const k = ROCKET_DRAW_SCALE;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(200, 200, 215, 0.22)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-34, 0);
    ctx.stroke();
    ctx.fillStyle = 'hsla(24, 100%, 60%, 0.32)';
    ctx.beginPath();
    ctx.arc(-9, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    const flame = 10 + Math.random() * 8;
    ctx.strokeStyle = 'hsla(356, 100%, 60%, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-7 - flame, 0);
    ctx.stroke();
    ctx.strokeStyle = '#fff6e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-7 - flame * 0.55, 0);
    ctx.stroke();
    // Body: a long nose, swept fins at the tail.
    ctx.fillStyle = '#ff3a52';
    ctx.strokeStyle = '#ffe0e4';
    ctx.lineWidth = 1.4 / k;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, 2.6);
    ctx.lineTo(-8, 5);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-8, -5);
    ctx.lineTo(-4, -2.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6.5, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    const size = 15 * W.orbitalBladeRadius(b) / W.orbitalBladeRadius(levelBuild('orbitals', 1)) * BTX.frenzySize(this, b);
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
    // blips are thinned to about the old density: every 8th plain rock node (masses pack about twice as many), every 2nd gold or shield vein
    // (as before), and every deep core vein (rare and worth a Void Core).
    // One pass per color, so the fill style is set three times a frame instead of once per blip.
    const rocks = this.asteroidManager.asteroids;
    for (const [color, ores] of RADAR_ROCK_COLORS) {
      ctx.fillStyle = color;
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i];
        if (!ores.includes(r.oreType) || (i & RADAR_ROCK_STRIDE[r.oreType]) !== 0 || r.border) continue; // the radar frame is the wall
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

    this.rifts?.drawRadar(ctx, mx, my, scaleX, scaleY, k);

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
      else if (enemies[i].type === 'hatchery' && enemies[i].born > 0) this.drawEdgeArrow(ctx, enemies[i].x, enemies[i].y, '#ff6a5a', 'HIVE');
    }
    const rift = this.rifts?.active;
    if (rift && rift.phase !== 'seal') this.drawEdgeArrow(ctx, rift.x, rift.y, '#e07bff', 'RIFT');
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
    const shake = this.shake * shakeScale(); // REDUCE EFFECTS turns it off
    if (shake > 0.2) {
      offsetX += (Math.random() - 0.5) * shake;
      offsetY += (Math.random() - 0.5) * shake;
    }
    ctx.translate(offsetX, offsetY);

    // 1. Reactive Spring-Mass Neon Grid, lit around the ship (brighter at speed)
    const ship = this.player;
    if (ship && this.state !== 'GAMEOVER') {
      const pace = Math.min(1.6, Math.hypot(ship.vx, ship.vy) / Math.max(1, ship.stats?.moveSpeed ?? 6));
      this.grid.setLight?.(ship.x, ship.y, 260, 0.8 + 0.3 * pace, 188);
    }
    this.grid.draw(ctx, this.camX, this.camY, this.width, this.height);

    // 2. Outer Sector Boundary: a bedrock wall (drawn with the asteroids); a glowing line where there is
    // none (the Weapon Range's empty field, or the bedrock wall switched off).
    if (!this.asteroidManager.bordered) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 0, 127, ${0.55 + beatPulse * 0.35})`;
      ctx.lineWidth = 5;
      ctx.strokeRect(12, 12, this.worldWidth - 24, this.worldHeight - 24);
      ctx.restore();
    }

    // 3. Draw Destructible Asteroid Clusters & Active Mining Laser Beams
    this.asteroidManager.draw(ctx, this.camX, this.camY, this.width, this.height);

    // Event horizons: opaque discs under the additive layer so wells read as holes punched in the grid.
    this.drawWellHorizons(ctx);
    this.rifts?.drawVoid(ctx, this); // the same for the void inside a space-time rift

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
      const alpha = GEOM_ALPHA;
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
      } else if (g.isBomb) {
        // Supernova bomb: an eight-point gold star with a pulsing halo (reads apart from coins and cores).
        const r = 11 + Math.sin(performance.now() * 0.009 + i) * 1.4;
        ctx.strokeStyle = `hsla(45, 100%, 62%, ${alpha * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = BOMB_GLOW.fill;
        if (!pickupGlows.draw(ctx, 'bomb', r, rs, BOMB_GLOW)) {
          ctx.shadowColor = BOMB_GLOW.color;
          ctx.shadowBlur = BOMB_GLOW.blur;
        }
        ctx.beginPath();
        bombPath(ctx, r);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (g.isGold) {
        // Gold coin: a solid, glowing hexagon with a dark diamond stamped in (XP geoms are hollow outlines).
        const r = 8 + Math.sin(performance.now() * 0.008 + i) * 0.8;
        ctx.fillStyle = COIN_GLOW.fill;
        ctx.strokeStyle = `rgba(255, 246, 200, ${alpha})`;
        ctx.lineWidth = 1.6;
        if (!pickupGlows.draw(ctx, 'coin', r, rs, COIN_GLOW)) {
          ctx.shadowColor = COIN_GLOW.color;
          ctx.shadowBlur = COIN_GLOW.blur;
        }
        ctx.beginPath();
        coinPath(ctx, r);
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
      if (b.kind === 'rocket') continue; // drawn in the air layer below
      if (b.kind === 'shard') {
        this.drawShard(ctx, b);
        continue;
      }
      if (b.kind === 'shrapnel') {
        BTX.drawShrapnel(ctx, b);
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

    this.weaponFx?.draw(ctx, this);

    this.gasTrail?.drawGround(ctx, this);
    this.nanites?.drawGround(ctx, this);
    this.deployables?.drawGround(ctx, this);
    this.grenades?.drawGround(ctx, this);
    this.quakeMortar?.drawGround(ctx, this);
    if (this.state !== 'GAMEOVER') this.shockField?.draw(ctx, this);
    this.rifts?.draw(ctx, this);
    this.enemyManager.draw(ctx, this.camX, this.camY, this.width, this.height);
    drawBossWarps(ctx, this);
    this.cutscene?.drawWorld(ctx);
    drawStatusEffects(ctx, this.enemyManager.enemies, this.camX, this.camY, this.width, this.height);
    this.flamethrower?.draw(ctx, this);
    this.cryoSprayer?.draw(ctx, this);
    this.acidSprayer?.draw(ctx, this);
    this.railLance?.draw(ctx, this);
    this.glaive?.draw(ctx, this);
    if (this.state !== 'GAMEOVER') this.drillDriver?.draw(ctx, this);
    this.weaponFx?.drawAir(ctx, this);
    this.grenades?.drawAir(ctx, this);
    this.quakeMortar?.drawAir(ctx, this);
    // Rockets and missiles fly over gas, nanites, shock fields, enemy packs and spray cones: drawn under
    // them, a 1.3 s rocket flight was lost in the clutter and a volley read as a sound with no shot.
    for (let i = 0; i < this.bullets.length; i++) if (this.bullets[i].kind === 'rocket') this.drawWingRocket(ctx, this.bullets[i]);
    for (let i = 0; i < this.missiles.length; i++) this.drawMissile(ctx, this.missiles[i]);

    const p = this.player;
    if (this.state !== 'GAMEOVER') {
      this.drawGravityTethers(ctx, p);
      drawShipWake(ctx, p, TUNING);
      // Mid rift-jump the ship spins and shrinks into the rift, then pops back out of the exit.
      const pose = this.rifts?.shipPose() ?? { scale: 1, spin: 0 };
      const posed = pose.scale !== 1 || pose.spin !== 0;
      if (posed) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pose.spin);
        ctx.scale(Math.max(0.001, pose.scale), Math.max(0.001, pose.scale));
        ctx.translate(-p.x, -p.y);
      }
      if (pose.scale > 0.02) {
        this.drawPlayerShield(ctx, p, beatPulse);

        if (p.weapons.orbitals > 0) this.drawOrbitBlades(ctx, p);

        this.deployables?.drawEscorts(ctx, this);
        this.drawCrabShip(ctx, p);
      }
      if (posed) ctx.restore();
    } else {
      this.deathSeq?.drawWorld(ctx, TUNING);
    }

    ctx.restore();

    // 5. Draw Sparks, Shatter Shards, Shockwaves & Lightning in World Space
    this.particles.draw(ctx, this.camX, this.camY, this.width, this.height);
    this.enemyManager.drawTopTelegraphs(ctx, this.camX, this.camY, this.width, this.height); // Blinker marks read over the sparks
    this.damageNumbers.draw(ctx, this.camX, this.camY, this.width, this.height);

    // Close Camera Transform
    ctx.restore();

    // 6. Screen-Space Tactical Sector Radar Minimap & Boss Direction Cues (hidden with the HUD, [H])
    if (!this.hudHidden && (this.state === 'PLAYING' || this.state === 'PAUSED' || this.state === 'UPGRADE' || this.state === 'CHEST' || this.state === 'VICTORY')) {
      if (this.radarVisible && !this.touchMode) this.drawMinimap(ctx);
      this.drawBossIndicators(ctx);
    }

    if (this.bossFlash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 214, 110, ${this.bossFlash * 0.16 * flashScale()})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    if (this.chromaFlash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(0, 243, 255, ${this.chromaFlash * 0.22 * flashScale()})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    // Instant-replay tape: the finished frame (minus the death overlay) while playing and through the blast.
    if (this.replayRec && !this.range?.active && (this.state === 'PLAYING' || (this.deathSeq && !this.deathSeq.landed))) {
      this.replayRec.record(this.canvas, this.frameSeconds ?? 1 / 60);
    }
    this.deathSeq?.drawOverlay(ctx, this.width, this.height, this.canvas, this.renderScale ?? 1);
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

  // Paused behind a modal (pause menu, level-up / Breakthrough hand, cache) the world stands still: once
  // the last sparks, ripples and numbers have played out, it is drawn once, settled (no motion trails),
  // and that frame is kept until the modal closes (the ship's shield ring stops turning). CSS then
  // blurs the still canvas once (body.world-frozen) instead of the modal's backdrop blur, which Chromium
  // redoes over the whole screen every frame the cards animate. The frame is redrawn when something it
  // shows changes (size, HUD / radar / damage numbers, REDUCE EFFECTS, the loadout).
  holdFrozenFrame() {
    const frozen = FROZEN_STATES.has(this.state) && !this.cutscene?.active;
    setClass(globalThis.document?.body, 'world-frozen', frozen);
    if (!frozen) {
      this.frozenKey = null;
      return false;
    }
    // Particles, grid ripples, damage numbers and screen flashes play out behind the modal first.
    const settling = !this.particles.idle() || !this.grid.settled() || (this.damageNumbers?.count ?? 0) > 0 ||
      this.shake > 0.2 || this.chromaFlash > 0.01 || this.bossFlash > 0.01;
    if (settling) {
      this.frozenKey = null;
      return false;
    }
    const p = this.player;
    const key = `${this.state}|${this.canvas.width}x${this.canvas.height}|${this.hudHidden}|${this.radarVisible}|${this.damageNumbers?.enabled}|${isReduceEffects()}|${p?.loadout?.length}|${p?.level}`;
    if (key === this.frozenKey) return true;
    this.frozenKey = key;
    const frameSeconds = this.frameSeconds;
    this.frameSeconds = 1; // draw() then clears fully: the settled frame
    this.draw();
    this.frameSeconds = frameSeconds;
    return true;
  }

  loop(now) {
    this.frameSeconds = this.lastFrameAt === undefined ? 1 / 60 : Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    this.frameClock.advance(now, (dt) => this.update(dt));
    if (!this.holdFrozenFrame()) this.draw();
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
  window.addEventListener('DOMContentLoaded', () => new Game().enableFirstLaunchTutorial().enableFirstLaunchIntro().enableStartPick().showSplash().enableStoryRadio());
}
