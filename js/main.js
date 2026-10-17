import { SpatialIndex } from './spatial-index.js';
import { FixedStepClock } from './clock.js';
import { drawPlayerShield, drawCrabShip, shieldTouches } from './ship-renderer.js';
import { WarpGrid } from './grid.js';
import { ParticleSystem } from './particles.js';
import { EnemyManager, BOSS_NAME } from './enemies.js';
import { DamageNumbers } from './damage-numbers.js';
import { Deployables } from './deployables.js';
import { AsteroidManager } from './asteroids.js';
import { SoundEngine } from './audio.js';
import { readGamepad, MenuNavigator, PAD } from './gamepad.js';
import { UPGRADE_POOL, RARITY, rarityFor, rollUpgrades, applyUpgradeLevels } from './upgrades.js';
import {
  WEAPON_SCALING as W, weaponDamage, prismStreams, areaMult, missileBlastRadius, singularityPullRadius, novaRadius, tectonicBlastRadius,
  critChance, critMultiplier
} from './weapon-scaling.js';
import {
  DOT_SOURCES, damageTakenMult as statusTakenMult, isAfflicted, applyOnHitStatuses, updateStatusEffects, drawStatusEffects
} from './status-effects.js';
import { describeUpgrade, renderUpgradeCard, COMPACT_MAX_ROWS, bonusLevels, bonusText } from './upgrade-cards.js';
import { META_UPGRADES, ProgressionManager } from './progression.js';
import { wellFalloff, wellPullScale, playerPullCap } from './gravity.js';
import {
  ARCHETYPE_INFO, ARCHETYPE_DEATH_TIER, damageTakenMult as armorTakenMult, shieldBlocks, bounceFromShip, pickWavePack, lieutenantTypes
} from './archetypes.js';
import { rollLieutenant, lieutenantModLabels, LIEUTENANT_WARMUP, LIEUTENANT_CARD_TIME } from './lieutenants.js';
import {
  TUNING,
  TUNING_SCHEMA,
  updateTuningKey,
  resetTuningToDefaults,
  onTuningChange,
  getAgentTuningPayload,
  sendSandboxCommand
} from './config.js';

// Final wind-up of a Vortex Singularity: pull tightens and a contracting ring telegraphs the implosion.
const SINGULARITY_IMPLODE_TIME = 0.35;
// Grid funnel depth (px at the core) for enemy black holes and player singularities.
const BLACKHOLE_GRID_DEPTH = 220;
const SINGULARITY_GRID_DEPTH = 260;

// Boss encounters: warning telegraph -> arrival title card -> HUD health bars -> defeat payoff.
const BOSS_RANKS = ['WARDEN', 'SENTINEL', 'TYRANT', 'SOVEREIGN', 'ANNIHILATOR'];
const BOSS_CARD_TIME = 2.8;
const BOSS_BAR_ROWS = 3;

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
const KNOCKBACK_MAX = 4;
const HIT_STOP_MAX_TICKS = 3;
// Sandbox buttons that drop one of each new archetype next to the ship.
const SANDBOX_ARCHETYPES = {
  SPAWN_BRUISER: 'bruiser', SPAWN_GUNNER: 'gunner', SPAWN_SHIELDER: 'shielder', SPAWN_BLINKER: 'blinker', SPAWN_CONDUIT: 'conduit'
};

// Crits shove a little harder and flash a gold star flare sized to the target.
const CRIT_KNOCKBACK_MULT = 1.5;

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

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

    // Controller state: previous-tick buttons for press edges, and DOM menu focus.
    this.gpButtons = [];
    this.gpActive = false;
    this.menuNav = new MenuNavigator();
    this.menuState = null;
    this.menuGrace = 0;

    this.currentChoices = [];
    this.bindEvents();
    this.resetRun();
    this.renderHubUI();
    this.initTunerDrawer();

    onTuningChange((_t, sandboxAction) => {
      this.applyLiveTuning(sandboxAction);
    });

    this.frameClock = new FixedStepClock(performance.now());
    requestAnimationFrame((t) => this.loop(t));
  }

  resetRun() {
    this.resetInput();
    const bonuses = this.progression.getBonuses();

    this.score = 0;
    this.multiplier = 1.0;
    this.kills = 0;
    this.rocksMined = 0;
    this.sessionCores = 0;
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

    const startMaxHp = 100 + bonuses.bonusHp;
    const centerX = this.worldWidth * 0.5;
    const centerY = this.worldHeight * 0.5;

    this.player = {
      x: centerX,
      y: centerY,
      vx: 0,
      vy: 0,
      angle: 0,
      drillAngle: 0,
      drillSpin: 0,
      walkCycle: 0,
      radius: TUNING.shipRadius,
      hp: startMaxHp,
      maxHp: startMaxHp,
      invuln: 0,
      dashTimer: 0,
      dashCooldown: 0,
      bombs: 2 + bonuses.extraBombs,
      level: 1,
      xp: 0,
      xpToNext: 12,
      upgradeLevels: {},
      stats: {
        moveSpeed: TUNING.moveSpeed * bonuses.moveSpeedMult,
        fireRate: TUNING.fireRate * bonuses.fireRateMult,
        bulletSpeed: TUNING.bulletSpeed,
        bulletCount: 2,
        pierce: 1,
        damage: TUNING.baseDamage * bonuses.damageMult,
        magnetRadius: TUNING.magnetRadius * bonuses.magnetMult,
        xpMultiplier: TUNING.xpMultiplier * bonuses.xpMult,
        luck: TUNING.baseLuck + (bonuses.luckBonus || 0),
        coreDropMult: TUNING.coreDropMult * bonuses.coreMult,
        miningSpeed: TUNING.miningSpeed * (bonuses.miningMult || 1),
        miningRange: TUNING.miningRange,
        drillScale: TUNING.drillScale,
        critChance: TUNING.baseCritChance ?? 0.05,
        critDamage: TUNING.baseCritDamage ?? 1.5,
        tagDamage: { kinetic: 1, explosive: 1, electric: 1 },
        areaMult: 1
      },
      weapons: {
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
        siegeBattery: 0,
        thermite: 0,
        cryo: 0,
        nanite: 0,
        supercritical: 0
      }
    };

    this.camX = centerX - this.width * 0.5;
    this.camY = centerY - this.height * 0.5;

    this.particles.clear();
    this.damageNumbers?.clear();
    (this.deployables ||= new Deployables()).clear();
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

  bindEvents() {
    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
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
      const focused = document.activeElement;
      const editingText = focused && (focused.isContentEditable || focused.tagName === 'TEXTAREA' ||
        (focused.tagName === 'INPUT' && !['range', 'color', 'button', 'checkbox', 'radio'].includes(focused.type)));
      if (editingText) return;
      if (focused?.type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        if (this.state !== 'PLAYING') return;
        e.preventDefault();
      }
      // Space on a focused button/link activates that control instead of a menu shortcut.
      const onControl = focused && (focused.tagName === 'BUTTON' || focused.tagName === 'A');

      this.sound.init();
      const code = e.code;
      this.keys[code] = true;
      // Held movement is stateful; abilities and toggles fire only on the initial press.
      if (e.repeat) return;

      if (this.state === 'TITLE' && code === 'Space' && !onControl) {
        e.preventDefault();
        this.startGame();
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
        if (code === 'Digit1' || code === 'Numpad1') this.selectUpgrade(0);
        if (code === 'Digit2' || code === 'Numpad2') this.selectUpgrade(1);
        if (code === 'Digit3' || code === 'Numpad3') this.selectUpgrade(2);
        return;
      }

      if (this.state === 'PAUSED') {
        if (code === 'KeyP' || code === 'Escape' || (code === 'Space' && !onControl)) {
          e.preventDefault();
          this.togglePause();
          return;
        }
        if (code === 'KeyN') {
          this.toggleDamageNumbers();
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
      }

      if (code === 'KeyT') {
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
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
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
    const pauseTunerBtn = document.getElementById('btn-pause-tuner');
    const pauseRestartBtn = document.getElementById('btn-pause-restart');
    const pauseDmgNumsBtn = document.getElementById('btn-pause-dmgnums');

    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());
    if (pauseTunerBtn) pauseTunerBtn.addEventListener('click', () => this.toggleTunerDrawer());
    if (pauseRestartBtn) pauseRestartBtn.addEventListener('click', () => this.startGame());
    if (pauseDmgNumsBtn) pauseDmgNumsBtn.addEventListener('click', () => this.toggleDamageNumbers());
    this.syncDamageNumbersButton();

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
      if (pauseMusicLabel) pauseMusicLabel.textContent = `${Number(TUNING.musicVolume).toFixed(2)}x`;
      pauseMusicSlider.addEventListener('input', (e) => {
        updateTuningKey('musicVolume', e.target.value);
        if (pauseMusicLabel) pauseMusicLabel.textContent = `${Number(e.target.value).toFixed(2)}x`;
      });
    }
    if (pauseSfxSlider) {
      pauseSfxSlider.value = TUNING.sfxVolume;
      if (pauseSfxLabel) pauseSfxLabel.textContent = `${Number(TUNING.sfxVolume).toFixed(2)}x`;
      pauseSfxSlider.addEventListener('input', (e) => {
        updateTuningKey('sfxVolume', e.target.value);
        if (pauseSfxLabel) pauseSfxLabel.textContent = `${Number(e.target.value).toFixed(2)}x`;
      });
    }

    const tunerBtn = document.getElementById('btn-tuner-toggle');
    const closeTunerBtn = document.getElementById('btn-close-tuner');
    if (tunerBtn) tunerBtn.addEventListener('click', () => this.toggleTunerDrawer());
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
    this.sound.applyTuning();

    const p = this.player;
    if (p) {
      const bonuses = this.progression.getBonuses();
      const upgLv = p.upgradeLevels || {};

      p.radius = TUNING.shipRadius;
      p.stats.moveSpeed = TUNING.moveSpeed * bonuses.moveSpeedMult * Math.pow(1.16, upgLv.thrusters || 0);
      p.stats.fireRate = TUNING.fireRate * bonuses.fireRateMult * Math.pow(1.26, upgLv.firerate || 0) * (p.weapons.pulsarHelix ? 1.15 : 1);
      p.stats.bulletSpeed = TUNING.bulletSpeed * Math.pow(1.15, upgLv.firerate || 0);
      p.stats.damage = TUNING.baseDamage * bonuses.damageMult * Math.pow(1.25, upgLv.pierce || 0);
      p.stats.magnetRadius = TUNING.magnetRadius * bonuses.magnetMult * Math.pow(1.65, upgLv.magnet || 0);
      p.stats.xpMultiplier = TUNING.xpMultiplier * bonuses.xpMult * Math.pow(1.25, upgLv.magnet || 0);
      p.stats.luck = TUNING.baseLuck + (bonuses.luckBonus || 0) + (upgLv.luck_boost || 0) * 0.25;
      p.stats.coreDropMult = TUNING.coreDropMult * bonuses.coreMult;
      p.stats.miningSpeed = TUNING.miningSpeed * (bonuses.miningMult || 1) * Math.pow(1.5, upgLv.mining_speed || 0) * (p.weapons.tectonicBore ? 1.9 : 1);
      p.stats.miningRange = TUNING.miningRange * Math.pow(1.2, upgLv.mining_speed || 0) * (p.weapons.tectonicBore ? 1.3 : 1);
      p.stats.drillScale = TUNING.drillScale * Math.pow(1.15, upgLv.mining_speed || 0) * (p.weapons.tectonicBore ? 1.25 : 1);
      // Crit base values are live too: tuned base + the same per-level steps the crit cards add.
      p.stats.critChance = (TUNING.baseCritChance ?? 0.05) + (upgLv.crit_chance || 0) * W.critChanceStep + (p.weapons.supercritical ? W.supercritChance : 0);
      p.stats.critDamage = (TUNING.baseCritDamage ?? 1.5) + (upgLv.crit_damage || 0) * W.critDamageStep;
    }

    for (const key of ['musicVolume', 'sfxVolume']) {
      const id = key === 'musicVolume' ? 'music' : 'sfx';
      const slider = document.getElementById(`pause-${id}-slider`);
      const label = document.getElementById(`pause-${id}-label`);
      if (slider && document.activeElement !== slider) slider.value = TUNING[key];
      if (label) label.textContent = `${Number(TUNING[key]).toFixed(2)}x`;
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
        this.triggerLevelUp();
      } else if (sandboxAction === 'ADD_CORES') {
        this.sessionCores += 50;
        this.progression.addCores(50);
        this.renderHubUI();
        this.particles.spawnFloatText(p.x, p.y - 24, '+50 ❖ SANDBOX CORES!', '#d68fff', 15);
      } else if (sandboxAction === 'SPAWN_BOSS') {
        // Same warning -> entrance event as a scheduled boss.
        const bp = this.spawnAroundPlayer(420, 620);
        if (!this.queueBossEncounter(bp, this.getWaveScale(), `WAVE ${this.wave} SANDBOX SIMULACRUM`)) {
          this.showBanner('⚠ ENEMY CAP REACHED — BOSS NOT SPAWNED ⚠');
        }
      } else if (sandboxAction === 'SPAWN_BLACKHOLE') {
        const bp = this.spawnAroundPlayer(300, 380);
        if (!this.enemyManager.queueSpawn('blackhole', bp.x, bp.y, this.getWaveScale())) {
          this.showBanner('⚠ ENEMY CAP REACHED — VORTEX NOT SPAWNED ⚠');
        }
      } else if (sandboxAction === 'SPAWN_LIEUTENANT') {
        if (!this.spawnLieutenant(420, 560)) this.showBanner('⚠ ENEMY CAP REACHED — LIEUTENANT NOT SPAWNED ⚠');
      } else if (SANDBOX_ARCHETYPES[sandboxAction]) {
        const type = SANDBOX_ARCHETYPES[sandboxAction];
        const bp = this.spawnAroundPlayer(320, 420);
        if (!this.enemyManager.queueSpawn(type, bp.x, bp.y, this.getWaveScale())) {
          this.showBanner(`⚠ ENEMY CAP REACHED — ${ARCHETYPE_INFO[type].label} NOT SPAWNED ⚠`);
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
      if (!container) return;
      container.innerHTML = '';

      META_UPGRADES.forEach((upg) => {
        const rank = this.progression.getRank(upg.id);
        const isMax = rank >= upg.maxRank;
        const cost = this.progression.getUpgradeCost(upg);
        const canBuy = this.progression.canBuy(upg);

        const card = document.createElement('div');
        card.className = `armory-card ${canBuy ? 'affordable' : ''}`;
        card.innerHTML = `
          <div>
            <div class="armory-top">
              <span class="armory-name" style="color:${upg.color}">${upg.icon} ${upg.name}</span>
              <span class="armory-rank">RANK ${rank}/${upg.maxRank}</span>
            </div>
            <div class="armory-desc">${upg.desc}</div>
          </div>
          <button class="armory-buy-btn" ${!canBuy ? 'disabled' : ''}>
            ${isMax ? 'MAX RANK ACHIEVED' : `UPGRADE // ❖ ${cost} CORES`}
          </button>
        `;

        if (canBuy) {
          card.addEventListener('click', () => {
            this.sound.init();
            if (this.progression.buyUpgrade(upg.id)) {
              this.sound.playLevelUp();
              this.renderHubUI();
            }
          });
        }
        container.appendChild(card);
      });
    });

    ['highscore-list', 'go-highscore-list'].forEach((listId) => {
      const listEl = document.getElementById(listId);
      if (!listEl) return;
      listEl.innerHTML = '';

      this.progression.data.highscores.forEach((entry, idx) => {
        const isCurrent = entry.id === this.lastRunHighlightId;
        const row = document.createElement('div');
        row.className = `hs-row ${isCurrent ? 'hs-current' : ''}`;
        row.innerHTML = `
          <span class="hs-rank">#${idx + 1}</span>
          <span class="hs-name"></span>
          <span class="hs-meta">W${entry.wave} · x${Number(entry.multiplier).toFixed(1)} · ${entry.timeStr}</span>
          <span class="hs-score">${Number(entry.score).toLocaleString()}</span>
        `;
        row.querySelector('.hs-name').textContent = entry.name + (isCurrent ? ' ★ NEW' : '');
        listEl.appendChild(row);
      });
    });
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

  syncDamageNumbersButton() {
    const btn = document.getElementById('btn-pause-dmgnums');
    if (!btn || !this.damageNumbers) return;
    const on = this.damageNumbers.enabled;
    btn.textContent = `🔢 DAMAGE NUMBERS: ${on ? 'ON' : 'OFF'} [N]`;
    btn.classList.toggle('active', on);
    btn.setAttribute?.('aria-pressed', String(on));
  }

  resetInput() {
    this.keys = {};
    this.mouse.down = false;
    this.gpDashLatch = false;
    this.gpBombLatch = false;
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
      if (pauseModal) pauseModal.classList.remove('hidden');
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

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = '#030308';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.resetRun();
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: 0.35, muffled: false, boss: 0 });

    this.grid.applyImpulse(this.player.x, this.player.y, 48, 260, 188);
    this.particles.spawnShockwave(this.player.x, this.player.y, 240, 188, 5, 0.5);
    this.sound.playLevelUp();
    this.spawnWavePack();
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

  getWaveScale() {
    return (1 + (this.wave - 1) * 0.25) * Math.pow(1.09, Math.max(0, this.wave - 6));
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
    this.sound.playSupernova();
    this.sound.playLevelUp();

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

    // Heal shield & award bonus Void Cores
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 45);
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
      `+${bonusCores} ❖ Void Cores Banked · +45 Shield Repaired · ${awarded.length} System Upgrade${awarded.length > 1 ? 's' : ''} Installed!`;

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
    this.processPendingLevelUps();
    this.updateHUD();
  }

  onRockShattered(rock) {
    this.rocksMined++;
    this.sound.playExplosion(0.95);
    this.particles.spawnPolygonShatter(rock.x, rock.y, rock.radius * 0.9, rock.sides, rock.rotation, rock.hue, 0.9);
    this.particles.spawnExplosionSparks(rock.x, rock.y, 20, rock.hue, 2, 10, 2.0);
    this.particles.spawnShockwave(rock.x, rock.y, rock.radius * 1.8, rock.hue, 2.5, 0.28);
    this.grid.applyImpulse(rock.x, rock.y, 22, 110, rock.hue);

    if (rock.oreType === 'gold_vein') {
      this.particles.spawnFloatText(rock.x, rock.y - 12, '★ GOLD GEOM VEIN!', '#ffcc00', 14);
      for (let g = 0; g < 5; g++) {
        const ga = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 4;
        this.geoms.push({
          isCore: false,
          x: rock.x,
          y: rock.y,
          vx: Math.cos(ga) * spd,
          vy: Math.sin(ga) * spd,
          xp: 3,
          rotation: Math.random() * Math.PI * 2,
          hue: 48,
          life: 18,
          magnetized: false
        });
      }
      // Rare Luck chance to unearth a buried Relic Chest from a Gold Vein!
      if (Math.random() < (TUNING.goldVeinChestChance ?? 0.004) * this.player.stats.luck) {
        this.spawnRelicChest(rock.x, rock.y, false);
      }
    } else if (rock.oreType === 'shield_vein') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
      this.particles.spawnFloatText(rock.x, rock.y - 12, '+25 SHIELD CRYSTAL!', '#00ff88', 14);
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
        life: 25,
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
        life: 14,
        magnetized: false
      });
    }

    // Tectonic Claw Bore synergy blasts nearby enemies when you drill a rock (does NOT mine other rocks)
    if (this.player.weapons.tectonicBore) {
      const blast = tectonicBlastRadius(this.player);
      this.particles.spawnShockwave(rock.x, rock.y, blast, 48, 4.5, 0.35);
      this.damageEnemiesInRadius(rock.x, rock.y, blast, weaponDamage(this.player, 'tectonic'), 48);
    }
  }

  triggerDash() {
    const p = this.player;
    if (p.dashCooldown > 0) return;

    p.dashTimer = 0.22;
    p.dashCooldown = W.dashCooldown(p.weapons.dashNova || 0, TUNING.dashCooldownBase ?? 1.5);
    p.dashCooldownDuration = p.dashCooldown;
    p.invuln = Math.max(p.invuln, 0.32);

    const moveAngle = (Math.abs(p.vx) + Math.abs(p.vy) > 0.2)
      ? Math.atan2(p.vy, p.vx)
      : p.angle;

    p.vx = Math.cos(moveAngle) * p.stats.moveSpeed * 3.1;
    p.vy = Math.sin(moveAngle) * p.stats.moveSpeed * 3.1;

    this.sound.playDash();
    this.grid.applyImpulse(p.x, p.y, 32, 140, 188);
    this.particles.spawnShockwave(p.x, p.y, 110, 188, 3.5, 0.3);

    if (p.weapons.dashNova > 0) {
      const radius = novaRadius(p, p.weapons.dashNova);
      this.particles.spawnShockwave(p.x, p.y, radius, 160, 5, 0.4);
      this.damageEnemiesInRadius(p.x, p.y, radius, weaponDamage(p, 'nova', p.weapons.dashNova), 160);
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

    // The blast also wipes every hostile plasma orb in flight.
    this.enemyManager.enemyBullets?.clear();

    const enemies = this.enemyManager.enemies;
    for (const e of [...enemies].reverse()) {
      if (e.dead) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > maxR * 1.15) continue;
      // Bosses and lieutenants survive a supernova: it strips 40% of their max HP instead.
      if (e.isBoss || e.isLieutenant) {
        const dmg = e.maxHp * 0.4;
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
  damageEnemiesInRadius(cx, cy, radius, dmg, hue = 190, source = 'other', knock = KNOCKBACK.area) {
    const enemies = this.enemyManager.enemies;
    const edgeFalloff = TUNING.splashEdgeFalloff ?? 0.4;
    for (const e of [...enemies].reverse()) {
      if (e.dead) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= (radius + e.radius) * (radius + e.radius)) {
        const d = Math.sqrt(dSq) || 1;
        const reach = Math.max(0, Math.min(1, (d - e.radius) / radius));
        this.hitEnemy(e, dmg * (1 - edgeFalloff * reach), source, (dx / d) * knock, (dy / d) * knock);
      }
    }
    this.grid.applyImpulse(cx, cy, 38, radius * 1.15, hue);
  }

  // Single entry point for weapon damage: armor/Conduit links and corrosion, crit roll, HP, hit flash,
  // damage number, knockback, on-hit statuses and kill. (kx, ky) is a knockback impulse in px/tick
  // for a 10px-radius hull; heavier hulls move less. DoT ticks (DOT_SOURCES) never crit or re-apply
  // statuses. The damage number shows what actually landed.
  hitEnemy(e, dmg, source = 'blaster', kx = 0, ky = 0, flash = 1) {
    const p = this.player;
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

    const tier = e.isBoss ? 4 : e.isLieutenant ? 3 : DEATH_TIER[e.type] ?? ARCHETYPE_DEATH_TIER[e.type] ?? 1;
    const fx = DEATH_FX[tier];
    const intensity = fx.intensity;
    this.sound.playExplosion(intensity);
    if (fx.shake > 0) this.addShake(fx.shake);
    if (fx.hitStop > 0) this.requestHitStop(fx.hitStop);

    this.particles.spawnPolygonShatter(e.x, e.y, e.radius, e.sides, e.rotation, e.hue, intensity);
    const sparkCount = fromBomb ? 18 : Math.floor(26 * intensity);
    this.particles.spawnExplosionSparks(e.x, e.y, sparkCount, e.hue, 2.5, 14 * Math.sqrt(intensity), 2.3);
    this.particles.spawnShockwave(e.x, e.y, 48 * intensity, e.hue, 3 * intensity, 0.34);
    this.grid.applyImpulse(e.x, e.y, 26 * intensity, 115 * intensity, e.hue);

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
      const waveScale = this.getWaveScale();
      for (let k = 0; k < 3; k++) {
        const a = e.rotation + (k * Math.PI * 2) / 3;
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
      this.damageEnemiesInRadius(e.x, e.y, 175, 65 * this.getWaveScale() * 0.4, 348);
    }

    // Relic Supply Cache Drops! (Guaranteed on Bosses, very rare Luck-scaled drop on lesser enemies)
    const luck = this.player.stats.luck || 1.0;
    let bossBombGain = 0;
    if (e.isBoss) {
      const bombsBefore = this.player.bombs;
      this.player.bombs = Math.min(9, this.player.bombs + 1);
      bossBombGain = this.player.bombs - bombsBefore;
      this.spawnRelicChest(e.x, e.y, true);
    } else if (!fromBomb && this.chests.length < 3) {
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
          knock: KNOCKBACK.shrapnel
        });
      }
    }

    const pts = Math.round(e.score * this.multiplier);
    this.score += pts;
    if (e.isBoss) this.onBossDefeated(e, pts, bossBombGain);
    if (e.isLieutenant) this.onLieutenantDefeated(e, pts, fromBomb);

    const geomCount = e.isBoss ? 14 : e.isLieutenant ? 6 : e.type === 'blackhole' ? 4 : e.type === 'splitter' || e.type === 'bruiser' ? 2 : 1;
    for (let g = 0; g < geomCount; g++) {
      const ga = Math.random() * Math.PI * 2;
      const gSpd = 1.5 + Math.random() * 4.5;
      this.geoms.push({
        isCore: false,
        x: e.x,
        y: e.y,
        vx: Math.cos(ga) * gSpd,
        vy: Math.sin(ga) * gSpd,
        xp: Math.max(1, Math.round(e.xp / geomCount)),
        rotation: Math.random() * Math.PI * 2,
        hue: e.isBoss || e.isLieutenant ? 48 : 145,
        life: 16,
        magnetized: fromBomb
      });
    }

    const maxWaveCores = Math.ceil((TUNING.maxWaveCores ?? 3) * this.player.stats.coreDropMult);
    if (e.isBoss || this.coresDroppedThisWave < maxWaveCores) {
      const coreChance = (
        e.isBoss ? 1.0 :
        e.type === 'blackhole' ? 0.55 :
        e.type === 'splitter' ? 0.08 :
        0
      ) * this.player.stats.coreDropMult;

      if (Math.random() < coreChance) {
        const coreDrops = e.isBoss ? 3 : 1;
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
            life: 24,
            magnetized: fromBomb
          });
        }
      }
    }
  }

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
      const bp = this.spawnAroundPlayer(520, 780);
      if (!this.queueBossEncounter(bp, scheduled.waveScale, bossEpithet(scheduled.wave))) break;
      this.pendingBossSpawns.shift();
    }
  }

  // Admission reserves the boss's enemy slot at once and the warning plays out on that reserved
  // spawn ring, so a boss that has been announced can never be refused by the cap on arrival.
  queueBossEncounter(pos, waveScale, epithet) {
    const warmup = TUNING.bossWarningTime ?? 3.0;
    if (!this.enemyManager.queueSpawn('boss', pos.x, pos.y, waveScale, { warmup, name: BOSS_NAME, epithet })) return false;
    this.sound.playBossWarning();
    return true;
  }

  contactDamage(e) {
    return (e.isBoss ? 38 : 18 * (e.contactMult || 1)) * (1 + Math.max(0, this.wave - 5) * 0.08);
  }

  // Gunner orbs scale with the wave exactly like contact damage.
  enemyBulletDamage(b) {
    return b.damage * (1 + Math.max(0, this.wave - 5) * 0.08);
  }

  // Shared by contact and plasma-orb hits. Returns true when the hit was fatal (caller ends the run).
  damagePlayer(dmg, shake = 16) {
    const p = this.player;
    p.shieldFlash = 1;
    p.hp -= dmg;
    p.invuln = 0.65;
    this.multiplier = Math.max(1.0, this.multiplier * 0.75);
    this.addShake(shake);
    this.chromaFlash = 0.5;
    this.sound.playExplosion(1.8);
    this.particles.spawnShockwave(p.x, p.y, 130, 348, 5, 0.38);
    this.grid.applyImpulse(p.x, p.y, 55, 160, 348);
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
      if (this.player.invuln > 0 || this.player.hp <= 0) return false;
      this.particles.spawnExplosionSparks(b.x, b.y, 10, 14, 2, 8, 2);
      this.damagePlayer(this.enemyBulletDamage(b), 10);
      return true;
    };
    this.enemyManager.enemyBullets?.update(dt, this.player, this.asteroidManager, this.particles, this.worldWidth, this.worldHeight, this.enemyBulletHit);
    return this.endRunIfDead();
  }

  // One lieutenant per non-boss wave, `lieutenantDelay` seconds in. A pending boss keeps priority on
  // free enemy slots, and a lieutenant blocked by the cap simply retries on later ticks of the wave.
  updateLieutenantSchedule() {
    if (this.wave < (TUNING.lieutenantFirstWave ?? 2) || this.wave % 3 === 0) return;
    if (this.lieutenantWave === this.wave || this.waveTimer < (TUNING.lieutenantDelay ?? 6)) return;
    if (this.pendingBossSpawns.length > 0) return;
    if (this.spawnLieutenant()) this.lieutenantWave = this.wave;
  }

  spawnLieutenant(minDist = 480, maxDist = 700, type = null) {
    const lt = rollLieutenant(this.wave, lieutenantTypes(this.wave), Math.random, type);
    const pos = this.spawnAroundPlayer(minDist, maxDist);
    return this.enemyManager.queueSpawn(lt.type, pos.x, pos.y, this.getWaveScale(), { warmup: LIEUTENANT_WARMUP, lieutenant: lt });
  }

  showLieutenantCard(kind, kicker, name, epithet, detail) {
    this.ltCardSerial = (this.ltCardSerial || 0) + 1;
    this.ltCard = { id: this.ltCardSerial, kind, kicker, name, epithet, detail };
    this.ltCardTimer = LIEUTENANT_CARD_TIME;
  }

  onLieutenantArrived(e) {
    this.particles.spawnShockwave(e.x, e.y, 240, e.hue, 4, 0.5);
    this.particles.spawnShockwave(e.x, e.y, 150, 220, 3, 0.35);
    this.grid.applyImpulse(e.x, e.y, 60, 260, e.hue);
    this.addShake(6);
    this.sound.playLieutenantArrival?.();
    const mods = lieutenantModLabels(e).join(' · ');
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
        xp: 2, rotation: 0, hue: 280, life: 24, magnetized: true
      });
    }
    this.coresDroppedThisWave += cores;
    this.particles.spawnShockwave(e.x, e.y, 260, 48, 5, 0.55);
    const rewards = [`+${pts.toLocaleString()} PTS`, `+${Math.round(e.xp)} XP`];
    if (cores > 0) rewards.push(`+${cores} ❖ VOID CORE${cores > 1 ? 'S' : ''}`);
    this.showLieutenantCard('defeat', fromBomb ? '▲ LIEUTENANT VAPORIZED ▲' : '▲ LIEUTENANT DOWN ▲', e.name, e.epithet, rewards.join(' · '));
  }

  // First appearance of a new archetype this run: a one-line intel card on what it does.
  announceArchetype(type) {
    const info = ARCHETYPE_INFO[type];
    if (!info || this.seenArchetypes.has(type)) return;
    if (this.ltCardTimer > 0 && this.ltCard?.kind !== 'intel') return; // try again on its next pack
    this.seenArchetypes.add(type);
    this.showLieutenantCard('intel', '◆ NEW HOSTILE SIGNATURE ◆', info.label, '', info.intro);
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
    this.shake = Math.min(24, Math.max(this.shake, 20 * (TUNING.screenShakeMult ?? 1.0)));
    this.chromaFlash = Math.max(this.chromaFlash, 0.6);
    this.particles.spawnShockwave(e.x, e.y, 560, 48, 8, 0.8);
    this.particles.spawnShockwave(e.x, e.y, 320, e.hue, 5, 0.55);
    this.particles.spawnExplosionSparks(e.x, e.y, 48, 48, 3, 18, 2.6);
    this.grid.applyImpulse(e.x, e.y, 130, 560, 48);
    this.sound.playBossArrival();
    const hp = Math.round(e.maxHp).toLocaleString();
    this.showBossCard('arrival', '⚠ BOSS ENCOUNTER ⚠', e, `${hp} HP · ${Math.round(this.contactDamage(e))} CONTACT DMG`);
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
    this.grid.applyImpulse(e.x, e.y, 110, 600, 48);
    this.sound.playBossDefeat();
    const rewards = [`+${pts.toLocaleString()} PTS`, 'SUPER RELIC CACHE'];
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
    const pt = this.spawnAroundPlayer(440, 740);

    // Weighted pack (TUNING spawnWeight*); newer archetypes join as their unlock wave arrives.
    const pack = pickWavePack(this.wave);
    const em = this.enemyManager;
    const queuedBefore = em.spawnIndicators.length;
    const spread = (type, count, minD = 420, maxD = 720) => {
      for (let i = 0; i < count; i++) {
        const p2 = this.spawnAroundPlayer(minD, maxD);
        em.queueSpawn(type, p2.x, p2.y, waveScale);
      }
    };
    const since = type => Math.max(0, this.wave - ARCHETYPE_INFO[type].unlockWave);
    if (pack === 'swarm') {
      const count = Math.min(34, 12 + this.wave * 2);
      em.spawnBoidSwarm(pt.x, pt.y, count, waveScale, this.worldWidth, this.worldHeight);
    } else if (pack === 'skirmish') {
      for (let i = 0; i < 3 + Math.floor(this.wave * 0.6); i++) {
        const p2 = this.spawnAroundPlayer(420, 720);
        em.queueSpawn(i % 2 === 0 ? 'pinwheel' : 'weaver', p2.x, p2.y, waveScale);
      }
    } else if (pack === 'splitter') {
      spread('splitter', 2 + Math.floor(this.wave * 0.4), 450, 750);
    } else if (pack === 'blackhole') {
      em.queueSpawn('blackhole', pt.x, pt.y, waveScale);
    } else if (pack === 'bruiser') {
      spread('bruiser', Math.min(3, 1 + Math.floor(since('bruiser') / 4)), 460, 720);
    } else if (pack === 'gunner') {
      spread('gunner', Math.min(5, 2 + Math.floor(since('gunner') / 4)), 520, 760);
    } else if (pack === 'shielder') {
      // Shielders lead a pinwheel escort, so the pack advances behind the plates.
      const count = Math.min(3, 1 + Math.floor(since('shielder') / 5));
      for (let i = 0; i < count; i++) {
        const p2 = this.spawnAroundPlayer(460, 720);
        em.queueSpawn('shielder', p2.x, p2.y, waveScale);
        for (let k = 0; k < 2; k++) em.queueSpawn('pinwheel', p2.x + (k ? 40 : -40), p2.y + 34, waveScale);
      }
    } else if (pack === 'blinker') {
      spread('blinker', Math.min(7, 3 + Math.floor(since('blinker') / 3)), 480, 760);
    } else if (pack === 'conduit') {
      // A Conduit always arrives with a pack to buff: pinwheels, plus a bruiser later on.
      em.queueSpawn('conduit', pt.x, pt.y, waveScale);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        em.queueSpawn('pinwheel', pt.x + Math.cos(a) * 60, pt.y + Math.sin(a) * 60, waveScale);
      }
      if (this.wave >= 8) em.queueSpawn('bruiser', pt.x + 80, pt.y, waveScale);
    }
    // Only announce a newcomer that actually made it past the enemy cap.
    if (ARCHETYPE_INFO[pack] && em.spawnIndicators.length > queuedBefore) this.announceArchetype(pack);
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
      const score = e.shieldArc && shieldBlocks(e, e.x - dx / d * e.shieldRadius, e.y - dy / d * e.shieldRadius, dx, dy) ? d + 260 : d;
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
    const maxRockRadius = manager.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    this.projectileEnemyIndex ||= new SpatialIndex();
    this.projectileEnemyIndex.rebuild(this.enemyManager.enemies);
    const maxEnemyRadius = this.enemyManager.enemies.reduce((max, enemy) => Math.max(max, enemy.shieldArc ? enemy.shieldRadius : enemy.radius), 0);
    // Death effects may append shrapnel; those projectiles start moving next tick.
    const pending = this.bullets;
    this.bullets = [];
    for (const b of pending) {
      const x0 = b.x, y0 = b.y;
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
        this.hitEnemy(e, b.damage * pierceMult, b.source || 'blaster', b.vx * kb, b.vy * kb);
        if (b.blastRadius) {
          // Siege Battery shells burst on impact (cover still stops the shell itself).
          this.particles.spawnShockwave(hx, hy, b.blastRadius, b.hue, 2.5, 0.22);
          this.damageEnemiesInRadius(hx, hy, b.blastRadius, b.blastDamage, b.hue, b.source || 'other', KNOCKBACK.area * 0.5);
        }
        if (b.pierce <= 0) break;
      }
      if (!blocked && b.pierce > 0 && b.life > 0 && b.x >= 10 && b.x <= this.worldWidth - 10 && b.y >= 10 && b.y <= this.worldHeight - 10) {
        this.bullets.push(b);
      }
    }
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
      p.xpToNext = Math.round(p.xpToNext * 1.32 + 6);
      this.triggerLevelUp();
    }
  }

  firePrimaryWeapon() {
    const p = this.player;
    // Prism Split streams keep fixed slots (forward pair first), so new streams never bend old ones.
    const sideX = -Math.sin(p.angle);
    const sideY = Math.cos(p.angle);
    for (const stream of prismStreams(p.stats.bulletCount)) {
      const a = p.angle + stream.angle;
      const noseX = p.x + Math.cos(a) * 16 + sideX * stream.lateral;
      const noseY = p.y + Math.sin(a) * 16 + sideY * stream.lateral;

      this.bullets.push({
        x: noseX,
        y: noseY,
        vx: Math.cos(a) * p.stats.bulletSpeed,
        vy: Math.sin(a) * p.stats.bulletSpeed,
        damage: weaponDamage(p, 'blaster'),
        pierce: p.stats.pierce,
        hue: TUNING.bulletColorHue ?? 186,
        radius: TUNING.bulletRadius ?? 4.2,
        life: 1.25
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
          damage: weaponDamage(p, 'helix'),
          pierce: p.stats.pierce,
          hue: 48,
          radius: 4.5,
          life: 1.15
        });
      }
    }

    this.sound.playLaser();
    this.grid.applyImpulse(p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, 5.5, 48, 188);
  }

  // Starting kit: one dumbfire rocket from each outer wing tip, always along the hull's heading
  // (where the crab is flying), independent of the turret's aim. Direct hit plus a small blast.
  fireWingRockets() {
    const p = this.player;
    const heading = p.drillAngle ?? p.angle;
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const damage = weaponDamage(p, 'rocket');
    for (const side of [-1, 1]) {
      // Wing tip in hull space: (0.25r forward, 1.12r out), matching drawCrabShip's carapace wings.
      const wx = p.x + fx * p.radius * 0.25 - fy * side * p.radius * 1.12;
      const wy = p.y + fy * p.radius * 0.25 + fx * side * p.radius * 1.12;
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
        blastRadius: W.wingRocketBlastRadius * areaMult(p),
        blastDamage: damage * W.wingRocketBlastShare
      });
    }
    this.sound.playLaser(0.55);
  }

  fireSwarmMissiles(level) {
    const p = this.player;
    const count = W.missileSalvo(level);
    for (let i = 0; i < count; i++) {
      const launchAngle = p.angle + Math.PI + (Math.random() - 0.5) * 1.8;
      this.missiles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(launchAngle) * 7,
        vy: Math.sin(launchAngle) * 7,
        speed: W.missileSpeed(level),
        damage: weaponDamage(p, 'missile', level),
        blastRadius: missileBlastRadius(p),
        hue: p.weapons.stormProtocol ? 52 : 325,
        trail: [],
        life: 3.2
      });
    }
  }

  fireChainLightning(level, originX = this.player.x, originY = this.player.y) {
    const p = this.player;
    const enemies = this.enemyManager.enemies;
    if (enemies.length === 0) return;

    const bounces = W.lightningJumps(level);
    const hitSet = new Set();
    let currX = originX;
    let currY = originY;

    for (let b = 0; b < bounces; b++) {
      let bestIdx = -1;
      let bestDistSq = 300 * 300;
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

      this.particles.spawnLightning(currX, currY, target.x, target.y, 275);
      this.particles.spawnExplosionSparks(target.x, target.y, 8, 275, 2, 7, 1.8);
      const arc = Math.sqrt(bestDistSq) || 1;
      const kx = ((target.x - currX) / arc) * KNOCKBACK.lightning;
      const ky = ((target.y - currY) / arc) * KNOCKBACK.lightning;
      currX = target.x;
      currY = target.y;

      this.hitEnemy(target, weaponDamage(p, 'lightning', level), 'lightning', kx, ky);
    }
  }

  fireSingularity(level) {
    const p = this.player;
    const target = this.findNearestEnemy(p.x, p.y);
    const angle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.angle;
    const pullRadius = singularityPullRadius(p, level);
    this.singularities.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * 4.2,
      vy: Math.sin(angle) * 4.2,
      radius: W.singularityCoreRadius(level),
      pullRadius,
      // Event-horizon shred per tick is modest so the swarm survives long enough to clump;
      // the payoff is the collapse pulse over 85% of the pull radius.
      damage: weaponDamage(p, 'singularity', level),
      collapseRadius: pullRadius * W.singularityCollapseRadiusFrac,
      collapseDamage: weaponDamage(p, 'collapse', level),
      life: 2.6,
      maxLife: 2.6,
      spin: 0,
      hue: 290
    });
  }

  // Live enemy black holes this tick (reused array; a well killed mid-tick is skipped via e.dead).
  collectGravityWells() {
    const wells = this.gravityWells || (this.gravityWells = []);
    wells.length = 0;
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].type === 'blackhole' && !enemies[i].dead) wells.push(enemies[i]);
    }
    return wells;
  }

  // Enemy black holes tug the ship. The summed pull is capped to a share of the ship's own thrust
  // (see gravity.js), so holding away from any stack of wells always escapes at base move speed.
  applyWellPullToPlayer(p) {
    const wells = this.gravityWells;
    p.gravityTug = 0;
    if (!wells || wells.length === 0) return;
    const radius = TUNING.blackholePullRadius ?? 200;
    const strength = TUNING.blackholePlayerPull ?? 0.4;
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      if (w.dead) continue;
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const k = wellPullScale(dx, dy, radius, strength, w.radius);
      ax += dx * k;
      ay += dy * k;
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
    const radius = TUNING.blackholePullRadius ?? 200;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      let ax = 0;
      let ay = 0;
      for (let j = 0; j < wells.length; j++) {
        const w = wells[j];
        if (w.dead) continue;
        const dx = w.x - b.x;
        const dy = w.y - b.y;
        const k = wellPullScale(dx, dy, radius, strength, w.radius);
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
    const margin = Math.max(260, radius); // streams spawn up to 0.9 × pull radius from their well
    const onScreen = (x, y) => x > this.camX - margin && x < this.camX + this.width + margin &&
      y > this.camY - margin && y < this.camY + this.height + margin;
    for (let i = 0; i < this.gravityWells.length; i++) {
      const w = this.gravityWells[i];
      if (w.dead) continue;
      this.grid.applyWell(w.x, w.y, BLACKHOLE_GRID_DEPTH, radius, w.hue, 0.22);
      if (onScreen(w.x, w.y) && Math.random() < 0.6) this.particles.spawnInfall(w, radius * 0.9, w.hue, 1);
    }
    for (let i = 0; i < this.singularities.length; i++) {
      const sg = this.singularities[i];
      this.grid.applyWell(sg.x, sg.y, SINGULARITY_GRID_DEPTH, sg.pullRadius, sg.hue, 0.35);
      if (onScreen(sg.x, sg.y)) this.particles.spawnInfall(sg, sg.pullRadius * 0.9, sg.hue, 2);
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
          const k = wellPullScale(dx, dy, sg.pullRadius, pull, sg.radius);
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

  collapseSingularity(sg) {
    sg.dead = true;
    const r = sg.collapseRadius ?? sg.pullRadius * 0.85;
    const dmg = sg.collapseDamage ?? sg.damage * 14;
    this.sound.playImplosion();
    this.shake = Math.min(24, Math.max(this.shake, 7 * (TUNING.screenShakeMult ?? 1.0)));
    this.particles.spawnShockwave(sg.x, sg.y, r, sg.hue, 6, 0.45);
    this.particles.spawnShockwave(sg.x, sg.y, r * 0.45, 200, 4, 0.26);
    this.particles.spawnExplosionSparks(sg.x, sg.y, 46, sg.hue, 4, 17, 2.6);
    this.grid.applyImpulse(sg.x, sg.y, 70, r * 1.35, sg.hue);
    this.damageEnemiesInRadius(sg.x, sg.y, r, dmg, sg.hue, 'singularity');
  }

  triggerLevelUp() {
    this.state = 'UPGRADE';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: true });
    this.sound.playLevelUp();
    this.particles.spawnShockwave(this.player.x, this.player.y, 220, 145, 5, 0.5);
    this.grid.applyImpulse(this.player.x, this.player.y, 45, 220, 145);

    this.currentChoices = rollUpgrades(this.player, 3);
    if (this.currentChoices.length === 0) {
      this.player.hp = this.player.maxHp;
      this.score += Math.round(1000 * this.multiplier);
      this.state = 'PLAYING';
      this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
      this.particles.spawnFloatText(this.player.x, this.player.y - 24, 'ALL SYSTEMS MAXED // FULL SHIELD REPAIR!', '#ffcc00', 15);
      return;
    }

    const container = document.getElementById('upgrade-choices');
    container.innerHTML = '';

    this.currentChoices.forEach((upg, idx) => {
      const view = renderUpgradeCard(describeUpgrade(this.player, upg), `[${idx + 1}]`);
      const card = document.createElement('div');
      card.className = view.className;
      card.innerHTML = view.html;
      card.addEventListener('click', () => this.selectUpgrade(idx));
      container.appendChild(card);
    });

    document.getElementById('upgrade-modal').classList.remove('hidden');
  }

  selectUpgrade(index) {
    if (this.state !== 'UPGRADE') return;
    const upg = this.currentChoices[index];
    if (!upg) return;

    const jump = this.applyUpgrade(upg);
    this.currentChoices = [];

    document.getElementById('upgrade-modal').classList.add('hidden');
    this.state = 'PLAYING';
    this.sound.setMusicState({ intensity: this.sound.intensity, muffled: false });
    const jumpText = jump > 1 ? ` (+${jump} LEVELS!)` : ' UPGRADED!';
    this.particles.spawnFloatText(this.player.x, this.player.y - 24, `${upg.name}${jumpText}`, RARITY[rarityFor(upg, jump)].color, 15);
    this.processPendingLevelUps();
    this.updateHUD();
  }

  triggerGameOver() {
    this.state = 'GAMEOVER';
    this.sound.setMusicState({ intensity: 0.3, muffled: true, boss: 0 });
    this.sound.playSupernova();

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
      timeStr
    });
    this.lastRunHighlightId = result.entryId;

    const rankBadge = document.getElementById('go-rank-badge');
    if (rankBadge) {
      rankBadge.textContent = result.rank
        ? `★ NEW #${result.rank} HIGH SCORE! ★`
        : 'Top 8 Arena Runs';
      rankBadge.style.color = result.rank ? 'var(--gold)' : 'var(--text-dim)';
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
    const menus = {
      TITLE: ['title-modal', 'btn-start-game'],
      UPGRADE: ['upgrade-modal', null],
      CHEST: ['chest-modal', 'btn-claim-chest'],
      PAUSED: ['pause-modal', 'btn-resume-game'],
      GAMEOVER: ['gameover-modal', 'btn-restart-game']
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
    this.menuNav.update(root, gp, dt, primary);
    if (this.menuGrace > 0) return;

    if (gp.pressed(PAD.A)) {
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

    if (this.bossCardTimer > 0) this.bossCardTimer = Math.max(0, this.bossCardTimer - dt);
    if (this.ltCardTimer > 0) this.ltCardTimer = Math.max(0, this.ltCardTimer - dt);
    if (held) {
      this.updateHUD();
      return;
    }

    this.elapsedTime += dt;
    this.waveTimer += dt;

    const enemyCount = this.enemyManager.enemies.length;
    const dynamicIntensity = Math.min(
      1.0,
      0.32 + (enemyCount / 50) * 0.42 + ((this.multiplier - 1) / 15) * 0.18 + (this.wave - 1) * 0.05
    );
    // Boss warning drops the mix out; a live boss pins it at full intensity with the boss riff.
    const bossStage = this.getBossStage();
    this.sound.setMusicState({ intensity: bossStage === 2 ? 1.0 : dynamicIntensity, muffled: false, boss: bossStage });

    // Escalate waves every 22 seconds
    if (this.waveTimer >= 22) {
      this.waveTimer = 0;
      this.wave++;
      this.coresDroppedThisWave = 0;
      this.sessionCores += 1;
      this.progression.addCores(1);
      this.showBanner(`WAVE ${this.wave} // +1 ❖ VOID CORE`);

      if (this.asteroidManager.asteroids.length < 360) {
        const repPt = this.spawnAroundPlayer(850, 1400);
        this.asteroidManager.spawnCluster(repPt.x, repPt.y, { x: this.player.x, y: this.player.y, radius: 250 });
        this.asteroidManager.rebuildSpatialHash();
      }

      if (this.wave % 3 === 0) {
        this.pendingBossSpawns.push({ wave: this.wave, waveScale: this.getWaveScale() });
      }
    }

    // Scheduled encounters retain their wave scaling and get the first free slots.
    this.processPendingBossSpawns();
    this.updateLieutenantSchedule();
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnWavePack();
      this.spawnCooldown = Math.max(0.75, 2.6 - this.wave * 0.14);
    }

    const p = this.player;
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (p.shieldFlash > 0) p.shieldFlash = Math.max(0, p.shieldFlash - dt * 2.4);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);

    if (p.hp < p.maxHp) {
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

    const targetCamX = Math.max(0, Math.min(this.worldWidth - this.width, p.x - this.width * 0.5));
    const targetCamY = Math.max(0, Math.min(this.worldHeight - this.height, p.y - this.height * 0.5));
    this.camX += (targetCamX - this.camX) * 0.18;
    this.camY += (targetCamY - this.camY) * 0.18;

    // 2. Player Aiming (Turret) & Crab Drill-Claw Heading
    const worldMouseX = this.mouse.x + this.camX;
    const worldMouseY = this.mouse.y + this.camY;

    if (gp && (Math.abs(gp.aimX) > 0 || Math.abs(gp.aimY) > 0)) {
      p.angle = Math.atan2(gp.aimY, gp.aimX);
    } else if (this.autoAim) {
      const nearest = this.findAutoAimTarget(p.x, p.y);
      if (nearest) {
        p.angle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      } else {
        p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      }
    } else if (!this.gpActive) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    } // On a controller with the right stick released, the turret holds its last heading.

    // Orient Crab Carapace & Twin Drill-Claws toward movement direction (or nearest rock being drilled)
    const speedMag = Math.hypot(p.vx, p.vy);
    let targetDrillAngle = p.angle;
    if (this.asteroidManager.isDrilling && this.asteroidManager.drillingRocks.length > 0) {
      const rk = this.asteroidManager.drillingRocks[0];
      targetDrillAngle = Math.atan2(rk.y - p.y, rk.x - p.x);
    } else if (speedMag > 0.35) {
      targetDrillAngle = Math.atan2(p.vy, p.vx);
    }

    let angleDiff = targetDrillAngle - (p.drillAngle || 0);
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    p.drillAngle = (p.drillAngle || 0) + angleDiff * 0.22;

    // Spin the Twin Rotary Claw Drills & animate crab legs
    const rpm = this.asteroidManager.isDrilling ? 34 : 11;
    p.drillSpin = (p.drillSpin || 0) + dt * rpm;
    p.walkCycle = (p.walkCycle || 0) + dt * (2.5 + speedMag * 2.2);

    // 3. Primary Weapon Firing
    const shouldFire = this.autoFire || this.mouse.down || (gp && (Math.abs(gp.aimX) > 0 || Math.abs(gp.aimY) > 0));
    if (shouldFire) {
      this.fireAccumulator += dt * p.stats.fireRate;
      while (this.fireAccumulator >= 1) {
        this.fireAccumulator -= 1;
        this.firePrimaryWeapon();
      }
    }
    this.rocketTimer -= dt;
    if (shouldFire && this.rocketTimer <= 0) {
      this.fireWingRockets();
      this.rocketTimer = W.wingRocketCooldown;
    }

    // 4. Autonomous Weapons
    if (p.weapons.missiles > 0) {
      this.missileTimer -= dt;
      if (this.missileTimer <= 0 && this.enemyManager.enemies.length > 0) {
        this.fireSwarmMissiles(p.weapons.missiles);
        this.missileTimer = W.missileCooldown(p.weapons.missiles);
      }
    }

    if (p.weapons.lightning > 0) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0 && this.enemyManager.enemies.length > 0) {
        this.fireChainLightning(p.weapons.lightning);
        this.lightningTimer = W.lightningCooldown(p.weapons.lightning);
      }
    }

    if (p.weapons.singularity > 0) {
      this.singularityTimer -= dt;
      if (this.singularityTimer <= 0 && this.enemyManager.enemies.length > 0) {
        this.fireSingularity(p.weapons.singularity);
        this.singularityTimer = W.singularityCooldown(p.weapons.singularity);
      }
    }

    if (p.weapons.orbitals > 0) {
      this.orbitalAngle += dt * W.orbitalSpin(p.weapons.orbitals);
      const orbCount = W.orbitalBlades(p.weapons.orbitals);
      const orbRadius = W.orbitalRadius(p.weapons.orbitals);
      const enemies = this.enemyManager.enemies;
      const bladeDamage = weaponDamage(p, 'orbital', p.weapons.orbitals);

      for (let o = 0; o < orbCount; o++) {
        const oa = this.orbitalAngle + (o * Math.PI * 2) / orbCount;
        const ox = p.x + Math.cos(oa) * orbRadius;
        const oy = p.y + Math.sin(oa) * orbRadius;

        // Orbiting blades ONLY shred enemies — never asteroids!
        for (const e of [...enemies].reverse()) {
          if (e.dead) continue;
          const dx = e.x - ox;
          const dy = e.y - oy;
          if (dx * dx + dy * dy < (e.radius + W.orbitalBladeRadius) * (e.radius + W.orbitalBladeRadius)) {
            // No knockback: blades grind whatever they touch, so pushing targets off would cut their DPS.
            this.particles.spawnExplosionSparks(ox, oy, 3, 150, 2, 7, 1.6);
            this.hitEnemy(e, bladeDamage, 'orbital', 0, 0, 0.6);
          }
        }
      }
    }

    // Deployables (mines, sentry turrets, escort drones) place and fire before the bullet sweep,
    // so their bolts move, bend and collide with everything else this tick.
    this.deployables?.update(dt, this);

    // 5. Sweep projectiles against enemies and cover in travel order (black holes bend them first).
    this.bendProjectilesInWells();
    this.updateBullets(dt);
    const enemies = this.enemyManager.enemies;

    // 6. Update Homing Swarm Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      const target = this.findNearestEnemy(m.x, m.y);
      if (target) {
        const desiredAngle = Math.atan2(target.y - m.y, target.x - m.x);
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
      if (m.trail.length > 10) m.trail.shift();

      let detonated = m.life <= 0;
      for (const e of [...enemies].reverse()) {
        if (e.dead) continue;
        if (Math.hypot(e.x - m.x, e.y - m.y) <= e.radius + 10) {
          detonated = true;
          break;
        }
      }

      if (detonated) {
        const blast = m.blastRadius ?? W.missileBlastRadius;
        this.particles.spawnShockwave(m.x, m.y, blast, m.hue, 3.5, 0.3);
        this.particles.spawnExplosionSparks(m.x, m.y, 20, m.hue, 2, 11, 2);
        if (p.weapons.cryo) this.particles.spawnShockwave(m.x, m.y, blast * 0.8, 192, 2.5, 0.4);
        this.damageEnemiesInRadius(m.x, m.y, blast, m.damage, m.hue, 'missile', KNOCKBACK.missile);

        if (p.weapons.stormProtocol) {
          this.fireChainLightning(W.stormChainLevel, m.x, m.y);
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
    this.enemyManager.update(dt, p, this.bullets, this.grid, this.particles, this.worldWidth, this.worldHeight);
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
    this.asteroidManager.update(dt, p, enemies, this.bullets, (r) => this.onRockShattered(r), this.particles);
    if (this.updateEnemyBullets(dt)) return;

    for (const e of [...enemies].reverse()) {
      if (e.dead) continue;
      // Contact uses the same hull-hugging outline the shield draws.
      if (shieldTouches(p, TUNING, e.x, e.y, e.radius)) {
        if (p.invuln <= 0) {
          this.damagePlayer(this.contactDamage(e));

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

    // 10. Update Geoms & Void Cores
    for (let i = this.geoms.length - 1; i >= 0; i--) {
      const g = this.geoms[i];
      g.rotation += g.isCore ? 0.12 : 0.08;
      g.life -= dt;

      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      const attractR = g.isCore ? p.stats.magnetRadius * 1.35 : p.stats.magnetRadius;

      if (dist < attractR || g.magnetized) {
        g.magnetized = true;
        const pullSpd = 13.5;
        g.vx = g.vx * 0.75 + (dx / dist) * pullSpd * 0.35;
        g.vy = g.vy * 0.75 + (dy / dist) * pullSpd * 0.35;
      } else {
        // Loose geoms drift into enemy black holes: kill the well to cash in the pile.
        const wells = this.gravityWells;
        if (wells && wells.length) {
          const wellRadius = TUNING.blackholePullRadius ?? 200;
          const wellPull = TUNING.blackholePickupPull ?? 0.3;
          for (let w = 0; w < wells.length; w++) {
            const well = wells[w];
            if (well.dead) continue;
            const k = wellPullScale(well.x - g.x, well.y - g.y, wellRadius, wellPull, well.radius * 0.6);
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

      if (g.life <= 0) {
        this.geoms.splice(i, 1);
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

    const weaponsBar = document.getElementById('active-weapons-bar');
    const tags = [];
    for (const upg of UPGRADE_POOL) {
      const lv = p.upgradeLevels[upg.id];
      if (lv) {
        // Same level wording as the cards ("LV 3"); synergies are one-shot evolutions.
        // Rarity belongs to a roll, not a weapon, so tags stay neutral; evolutions keep their own color.
        tags.push(`<span class="weapon-tag${upg.isSynergy ? ' rarity-evolution' : ''}">${upg.name} ${upg.isSynergy ? '★' : `LV ${lv}${bonusText(bonusLevels(p, upg.id))}`}</span>`);
      }
    }
    weaponsBar.innerHTML = tags.join('');

    this.updateBossHUD(this.getBossHudModel());
    this.updateLieutenantHUD();
  }

  // Wing rocket: an orange dart with a flickering exhaust plume, distinct from blaster streaks.
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

  drawPlayerShield(ctx, p, beatPulse) {
    drawPlayerShield(ctx, p, beatPulse, TUNING, this.shieldRotation);
  }

  drawCrabShip(ctx, p) {
    drawCrabShip(ctx, p, TUNING, this.asteroidManager.isDrilling);
  }

  drawMinimap(ctx) {
    const mapSize = 152;
    const pad = 18;
    const mx = this.width - mapSize - pad;
    const my = this.height - mapSize - pad;
    const scaleX = mapSize / this.worldWidth;
    const scaleY = mapSize / this.worldHeight;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 9, 22, 0.84)';
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(mx, my, mapSize, mapSize);
    ctx.strokeRect(mx, my, mapSize, mapSize);

    // 1. Asteroid Clusters & Rich Veins
    const rocks = this.asteroidManager.asteroids;
    for (let i = 0; i < rocks.length; i += 2) {
      const r = rocks[i];
      ctx.fillStyle = r.oreType === 'core_vein'
        ? '#d68fff'
        : r.oreType === 'gold_vein'
        ? '#ffcc00'
        : 'rgba(0, 195, 255, 0.38)';
      const sz = r.oreType !== 'rock' ? 2.2 : 1.5;
      ctx.fillRect(mx + r.x * scaleX, my + r.y * scaleY, sz, sz);
    }

    // 2. Relic Supply Caches on Radar (Bright Pulsing Gold Squares)
    for (let i = 0; i < this.chests.length; i++) {
      const ch = this.chests[i];
      ctx.fillStyle = '#ffee00';
      ctx.fillRect(mx + ch.x * scaleX - 3, my + ch.y * scaleY - 3, 6, 6);
    }

    // 3. Enemies on Radar
    const enemies = this.enemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      ctx.fillStyle = e.isBoss ? '#ff2a55' : e.isLieutenant ? '#eef2ff' : 'rgba(255, 0, 127, 0.75)';
      const sz = e.isBoss ? 4 : e.isLieutenant ? 3.2 : 1.8;
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
      ctx.arc(mx + sp.x * scaleX, my + sp.y * scaleY, 4 + (sp.timer % 0.5) * 8, 0, Math.PI * 2);
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
    ctx.arc(mx + this.player.x * scaleX, my + this.player.y * scaleY, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '800 9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0, 243, 255, 0.75)';
    ctx.fillText('SECTOR RADAR // DRILL ACTIVE', mx + 6, my + 11);
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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    // 1. Reactive Spring-Mass Neon Grid
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
      const alpha = g.life < 2 ? (g.life * 0.5) : 0.92;
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
      } else {
        ctx.strokeStyle = `hsla(${g.hue}, 100%, 62%, ${alpha})`;
        ctx.lineWidth = 2;
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
      ctx.lineWidth = b.radius * 2.2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.radius * 0.85;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i];
      // Tapered exhaust: brighter and thicker toward the missile.
      for (let t = 1; t < m.trail.length; t++) {
        const k = t / (m.trail.length - 1);
        ctx.strokeStyle = `hsla(${m.hue}, 100%, ${60 + k * 12}%, ${0.2 + k * 0.55})`;
        ctx.lineWidth = 1.2 + k * 2.4;
        ctx.beginPath();
        ctx.moveTo(m.trail[t - 1].x, m.trail[t - 1].y);
        ctx.lineTo(m.trail[t].x, m.trail[t].y);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    this.deployables?.drawGround(ctx, this);
    this.enemyManager.draw(ctx, this.camX, this.camY, this.width, this.height);
    drawStatusEffects(ctx, this.enemyManager.enemies, this.camX, this.camY, this.width, this.height);

    const p = this.player;
    if (this.state !== 'GAMEOVER') {
      this.drawGravityTethers(ctx, p);
      this.drawPlayerShield(ctx, p, beatPulse);

      if (p.weapons.orbitals > 0) {
        const orbCount = W.orbitalBlades(p.weapons.orbitals);
        const orbRadius = W.orbitalRadius(p.weapons.orbitals);
        for (let o = 0; o < orbCount; o++) {
          const oa = this.orbitalAngle + (o * Math.PI * 2) / orbCount;
          const ox = p.x + Math.cos(oa) * orbRadius;
          const oy = p.y + Math.sin(oa) * orbRadius;

          ctx.save();
          ctx.translate(ox, oy);
          ctx.rotate(oa * 3);
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          for (let s = 0; s < 3; s++) {
            const sa = (s * Math.PI * 2) / 3;
            const vx = Math.cos(sa) * 15;
            const vy = Math.sin(sa) * 15;
            if (s === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      }

      this.deployables?.drawEscorts(ctx, this);
      this.drawCrabShip(ctx, p);
    }

    ctx.restore();

    // 5. Draw Sparks, Shatter Shards, Shockwaves & Lightning in World Space
    this.particles.draw(ctx, this.camX, this.camY, this.width, this.height);
    this.damageNumbers.draw(ctx, this.camX, this.camY, this.width, this.height);

    // Close Camera Transform
    ctx.restore();

    // 6. Screen-Space Tactical Sector Radar Minimap & Boss Direction Cues
    if (this.state === 'PLAYING' || this.state === 'PAUSED' || this.state === 'UPGRADE' || this.state === 'CHEST') {
      this.drawMinimap(ctx);
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
      if (e.type !== 'blackhole' || !inView(e.x, e.y, e.radius)) continue;
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
    const radius = TUNING.blackholePullRadius ?? 200;
    ctx.save();
    ctx.setLineDash([4, 9]);
    ctx.lineDashOffset = -(this.elapsedTime || 0) * 40;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      if (w.dead) continue;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      const f = wellFalloff(d, radius);
      if (f <= 0 || d < 1) continue;
      const ux = (w.x - p.x) / d;
      const uy = (w.y - p.y) / d;
      ctx.strokeStyle = `hsla(${w.hue}, 100%, 66%, ${0.15 + f * 0.5})`;
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
    requestAnimationFrame((t) => this.loop(t));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => new Game());
}
