// VEXOLITH audio engine.
// - SFX: short samples in assets/sfx (generated with ElevenLabs Sound Effects, see assets/sfx/CREDITS.md),
//   decoded once after the first user gesture and played with light pitch variation and per-sound voice
//   caps. Any sample that is missing, still loading or fails to decode falls back to the procedural
//   WebAudio sound that shipped before it, so the game is never silent.
// - Music: a procedural 90s synthwave / outrun score (lookahead scheduler on the AudioContext clock,
//   three songs in different keys, sections that change every 8-16 bars, intensity layering, kick
//   sidechain pumping, convolution reverb and a dotted-eighth delay). If MUSIC_TRACKS lists audio files,
//   they stream through the same music bus instead, cross-fading from one track to the next.
// Everything no-ops safely without an AudioContext (node tests, very old browsers).
import { TUNING } from './config.js';

// Sixteenth steps of the boss-fight riff inside each bar.
const BOSS_RIFF_STEPS = [0, 3, 6, 8, 11, 14];

export const SFX_BASE = 'assets/sfx/';

// Every generated sample: the play methods that use it, its level into the SFX bus, random playbackRate
// spread (+/- fraction), and its voice limits (concurrent copies, minimum ms between starts). Only the
// ones in SFX_IN_GAME play in the game; the rest sound on the before/after page (sounds.html) until
// the player picks them.
export const SFX_LIBRARY = Object.freeze({
  autocannon_shot: { methods: ['playLaser'], volume: 0.2, pitchVar: 0.05, maxVoices: 4, gapMs: 45 },
  drone_shot: { methods: ['playDroneShot'], volume: 0.11, pitchVar: 0.06, maxVoices: 2, gapMs: 70 },
  rocket_launch: { methods: ['playRocketLaunch'], volume: 0.3, pitchVar: 0.05, maxVoices: 2, gapMs: 70 },
  missile_launch: { methods: ['playMissileLaunch'], volume: 0.3, pitchVar: 0.05, maxVoices: 2, gapMs: 90 },
  explosion_small: { methods: ['playExplosion', 'playEnemyDeath'], volume: 0.45, pitchVar: 0.06, maxVoices: 4, gapMs: 35 },
  explosion_large: { methods: ['playExplosion', 'playEnemyDeath'], volume: 0.5, pitchVar: 0.04, maxVoices: 3, gapMs: 60 },
  missile_impact: { methods: ['playMissileImpact'], volume: 0.28, pitchVar: 0.06, maxVoices: 4, gapMs: 40 },
  arc_zap: { methods: ['playArcZap'], volume: 0.32, pitchVar: 0.06, maxVoices: 3, gapMs: 70 },
  blade_hit: { methods: ['playBladeHit'], volume: 0.14, pitchVar: 0.06, maxVoices: 2, gapMs: 85 },
  turret_shot: { methods: ['playTurretShot'], volume: 0.22, pitchVar: 0.05, maxVoices: 3, gapMs: 60 },
  mine_drop: { methods: ['playMineDrop'], volume: 0.22, pitchVar: 0.04, maxVoices: 2, gapMs: 120 },
  grenade_throw: { methods: ['playGrenadeThrow'], volume: 0.22, pitchVar: 0.05, maxVoices: 2, gapMs: 80 },
  grenade_blast: { methods: ['playGrenadeBlast'], volume: 0.34, pitchVar: 0.05, maxVoices: 3, gapMs: 50 },
  singularity_launch: { methods: ['playSingularityLaunch'], volume: 0.3, pitchVar: 0.04, maxVoices: 2, gapMs: 150 },
  implosion: { methods: ['playImplosion'], volume: 0.45, pitchVar: 0.04, maxVoices: 2, gapMs: 120 },
  enemy_hit: { methods: ['playCrit'], volume: 0.3, pitchVar: 0.06, maxVoices: 3, gapMs: 70 },
  enemy_death: { methods: ['playEnemyDeath'], volume: 0.42, pitchVar: 0.06, maxVoices: 4, gapMs: 40 },
  player_hit: { methods: ['playPlayerHit'], volume: 0.55, pitchVar: 0.04, maxVoices: 2, gapMs: 120 },
  xp_pickup: { methods: ['playGeomPickup'], volume: 0.15, pitchVar: 0.01, maxVoices: 3, gapMs: 35 },
  gold_pickup: { methods: ['playGoldPickup'], volume: 0.28, pitchVar: 0.03, maxVoices: 3, gapMs: 60 },
  level_up: { methods: ['playLevelUp'], volume: 0.5, pitchVar: 0, maxVoices: 2, gapMs: 120 },
  cache_open: { methods: ['playCacheFanfare'], volume: 0.7, pitchVar: 0, maxVoices: 1, gapMs: 300 },
  breakthrough: { methods: ['playBreakthrough'], volume: 0.62, pitchVar: 0, maxVoices: 1, gapMs: 300 },
  boss_warning: { methods: ['playBossWarning'], volume: 0.42, pitchVar: 0, maxVoices: 3, gapMs: 0 },
  boss_arrival: { methods: ['playBossArrival'], volume: 0.72, pitchVar: 0, maxVoices: 1, gapMs: 300 },
  lieutenant_arrival: { methods: ['playLieutenantArrival'], volume: 0.55, pitchVar: 0.03, maxVoices: 2, gapMs: 200 },
  elite_charge: { methods: ['playEliteCharge'], volume: 0.4, pitchVar: 0.02, maxVoices: 3, gapMs: 100 },
  dash: { methods: ['playDash'], volume: 0.38, pitchVar: 0.05, maxVoices: 2, gapMs: 80 },
  supernova: { methods: ['playSupernova', 'playGameOver'], volume: 0.6, pitchVar: 0.03, maxVoices: 2, gapMs: 150 },
  ui_select: { methods: ['playUiSelect'], volume: 0.2, pitchVar: 0.02, maxVoices: 2, gapMs: 45 },
  ui_confirm: { methods: ['playUiConfirm'], volume: 0.34, pitchVar: 0.02, maxVoices: 2, gapMs: 80 },
  game_over: { methods: ['playGameOver'], volume: 0.6, pitchVar: 0, maxVoices: 1, gapMs: 500 }
});

// Samples the player approved for the game. Every other sound uses its original procedural version.
export const SFX_IN_GAME = Object.freeze(['level_up', 'cache_open']);
export const SFX_SAMPLES = Object.freeze(Object.fromEntries(SFX_IN_GAME.map((name) => [name, SFX_LIBRARY[name]])));

// Drop-in soundtrack: list audio files here (e.g. 'assets/music/track1.mp3') and they replace the
// procedural score, streaming one after another with a cross-fade. Empty = procedural synthwave.
export const MUSIC_TRACKS = [];
const MUSIC_XFADE = 4; // seconds of overlap between streamed tracks

// ---- Procedural synthwave score ----
const CHORD_TONES = { m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus4: [0, 5, 7] };
// '0:m 8:M' -> [[0, 'm'], [8, 'M']]: semitones above the song key plus chord quality.
const chords = text => text.split(' ').map(token => { const [offset, quality] = token.split(':'); return [Number(offset), quality]; });

// Bass patterns: semitones above the chord root for each 16th (rolling outrun bass, octave pops).
const BASS_ROLL = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 7];
const BASS_GALLOP = [0, 0, 12, 12, 0, 0, 12, 12, 0, 0, 12, 12, 0, 0, 7, 12];
const BASS_DRIVE = [0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 10, 12];

export const SONGS = Object.freeze([
  {
    name: 'NEON VECTOR', key: 33, bpmOffset: 0, lead: 'saw', bass: BASS_ROLL,
    arp: [0, 1, 2, 3, 4, 3, 2, 1], // up-down over two octaves of chord tones
    sections: {
      A: { chords: chords('0:m 8:M 3:M 10:M'), barsPerChord: 2 },
      B: { chords: chords('5:m 8:M 3:M 10:M 5:m 8:M 7:M 7:M'), barsPerChord: 1 },
      C: { chords: chords('8:M 10:M 7:m 0:m 8:M 10:M 0:m 0:m'), barsPerChord: 2 }
    },
    form: ['A', 'B', 'C', 'A', 'C']
  },
  {
    name: 'CHROME HORIZON', key: 38, bpmOffset: -6, lead: 'square', bass: BASS_GALLOP,
    arp: [0, 2, 4, 5, 4, 2, 1, 3],
    sections: {
      A: { chords: chords('0:m 8:M 3:M 10:M'), barsPerChord: 2 },
      B: { chords: chords('5:m7 8:M7 0:m 10:M 5:m7 8:M7 7:M 7:M'), barsPerChord: 1 },
      C: { chords: chords('8:M 10:M 0:m 0:m 8:M 10:M 7:sus4 7:M'), barsPerChord: 2 }
    },
    form: ['A', 'B', 'C', 'B', 'C']
  },
  {
    name: 'MIDNIGHT GRID', key: 42, bpmOffset: 6, lead: 'tri', bass: BASS_DRIVE,
    arp: [0, 1, 2, 0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 2],
    sections: {
      A: { chords: chords('0:m 8:M7 3:M 10:M'), barsPerChord: 2 },
      B: { chords: chords('5:m 8:M 0:m 10:M 5:m 8:M 7:M 7:M'), barsPerChord: 1 },
      C: { chords: chords('8:M 10:M 7:m 0:m 8:M 10:M 0:m7 0:m'), barsPerChord: 2 }
    },
    form: ['A', 'C', 'B', 'C']
  }
]);

// Intensity layer gates (with hysteresis on the way down): below DRUMS_AT the score is pads + bass,
// drums join at DRUMS_AT (a run reaches it as the first enemies arrive), lead + extra percussion at HIGH_AT.
const DRUMS_AT = 0.36;
const HIGH_AT = 0.6;

// Live boss fight: a darker Phrygian turn (i - bII - i - bVII, then i - bVI - bII - V) in the song's key.
export const BOSS_SECTION = Object.freeze({ chords: chords('0:m 1:M 0:m 10:M 0:m 8:M 1:M 7:M'), barsPerChord: 1 });

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterVolumePct = 100;
    try {
      const stored = localStorage.getItem('vectra_master_vol');
      const savedVol = Number(stored);
      if (stored !== null && stored.trim() !== '' && Number.isFinite(savedVol)) {
        this.masterVolumePct = Math.max(0, Math.min(200, savedVol));
      }
    } catch (_e) { /* Storage may be unavailable in private or embedded contexts. */ }
    this.masterGain = null;
    this.musicGain = null;
    this.musicCompressor = null;
    this.outputLimiter = null;
    this.sfxGain = null;
    this.musicFilter = null;
    // Music FX graph (built on the first startMusic).
    this.pumpGain = null;
    this.reverbIn = null;
    this.reverb = null;
    this.reverbOut = null;
    this.delayIn = null;
    this.delay = null;
    this.delayFeedback = null;
    this.delayOut = null;
    this.padSend = null;

    // Samples
    this.samples = new Map();
    this.sampleFailures = new Set();
    this.sampleLoadStarted = false;

    this.geomPitchStep = 0;
    this.lastGeomTime = 0;
    this.lastShotSound = 0;
    this.lastExplosionSound = 0;
    this.lastCritSound = 0;

    // Interactive music sequencer state
    this.isPlayingMusic = false;
    this.baseBpm = TUNING.musicBpm || 132;
    this.songIndex = 0;
    this.formIndex = 0;
    this.sectionBar = 0;
    this.bossBar = 0;
    this.chord = SONGS[0].sections[SONGS[0].form[0]].chords[0];
    this.chordChanged = true;
    this.chordBars = 2;
    this.sectionStart = true;
    this.sectionEnd = false;
    this.layerDrums = false;
    this.layerHigh = false;
    this.bpm = this.baseBpm + SONGS[0].bpmOffset;
    this.stepIndex = 0;
    this.nextNoteTime = 0;
    this.intensity = 0.35; // 0.0 (calm) -> 1.0 (full swarm overdrive)
    this.isMuffled = false;
    this.bossStage = 0; // 0 none, 1 boss warning (music drops out), 2 boss fight (dark section + boss riff)
    this.lastFilterTarget = 0;
    this.lastBeatTime = -Infinity;
    this.pendingBeats = [];
    this.schedulerId = null;

    // Streamed music files (MUSIC_TRACKS)
    this.musicTracks = MUSIC_TRACKS;
    this.decks = null;
    this.fileMode = false;
  }

  getMasterGainValue() {
    return this.enabled ? 0.85 * (this.masterVolumePct / 100) : 0;
  }

  setMasterVolume(pct) {
    const value = Number(pct);
    if (!Number.isFinite(value)) return;
    this.masterVolumePct = Math.max(0, Math.min(200, value));
    try {
      localStorage.setItem('vectra_master_vol', String(this.masterVolumePct));
    } catch (_e) {}
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.getMasterGainValue(), this.ctx.currentTime, 0.03);
    }
  }

  applyTuning() {
    this.baseBpm = TUNING.musicBpm || 132;
    this.bpm = this.baseBpm + (SONGS[this.songIndex]?.bpmOffset || 0);
    if (this.ctx) {
      if (this.musicGain) {
        this.musicGain.gain.setTargetAtTime(TUNING.musicVolume ?? 0.4, this.ctx.currentTime, 0.03);
      }
      if (this.sfxGain) {
        this.sfxGain.gain.setTargetAtTime(TUNING.sfxVolume ?? 0.38, this.ctx.currentTime, 0.03);
      }
      if (this.masterGain) {
        this.masterGain.gain.setTargetAtTime(this.getMasterGainValue(), this.ctx.currentTime, 0.03);
      }
    }
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch?.(() => {});
      if (!this.isPlayingMusic) this.startMusic();
      this.loadSamples();
      return;
    }
    const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Dynamics compressor on master so loud music punches hard without digital clipping
    this.musicCompressor = this.ctx.createDynamicsCompressor();
    this.musicCompressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
    this.musicCompressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.musicCompressor.ratio.setValueAtTime(4, this.ctx.currentTime);
    this.musicCompressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
    this.musicCompressor.release.setValueAtTime(0.12, this.ctx.currentTime);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.getMasterGainValue();
    this.masterGain.connect(this.musicCompressor);
    // The compressor controls dynamics but cannot guarantee a sample ceiling.
    // Keep signals below 0.8 linear; smoothly saturate overload toward +/-0.98.
    // WaveShaper clamps inputs outside its curve domain. No oversampling here:
    // post-shaper resampling can overshoot an otherwise bounded sample curve.
    this.outputLimiter = this.ctx.createWaveShaper();
    const curve = new Float32Array(65537);
    for (let i = 0; i < curve.length; i++) {
      const input = (i / (curve.length - 1)) * 2 - 1;
      const magnitude = Math.abs(input);
      const excess = Math.max(0, (magnitude - 0.8) / 0.2);
      curve[i] = Math.sign(input) * (magnitude - 0.02 * Math.pow(excess, 10));
    }
    this.outputLimiter.curve = curve;
    this.outputLimiter.oversample = 'none';
    this.musicCompressor.connect(this.outputLimiter);
    this.outputLimiter.connect(this.ctx.destination);

    // Keep SFX tucked underneath the music so lasers/explosions never drown out the beat
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = TUNING.sfxVolume ?? 0.38;
    this.sfxGain.connect(this.masterGain);

    // Music bus: every music voice -> musicFilter (muffle / warning-drop low-pass) -> musicGain.
    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 12000;
    this.musicFilter.Q.value = 0.8;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = TUNING.musicVolume ?? 0.4;
    this.musicFilter.connect(this.musicGain);
    this.musicGain.connect(this.masterGain);

    this.startMusic();
    this.loadSamples();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.getMasterGainValue(), this.ctx.currentTime, 0.04);
    }
    return this.enabled;
  }

  // Called every frame by the game; only touches the filter when its (quantized) target moves.
  setMusicState({ intensity = 0.35, muffled = false, boss = this.bossStage } = {}) {
    this.intensity = Math.max(0.15, Math.min(1.0, intensity));
    this.isMuffled = muffled;
    this.bossStage = boss;
    if (!this.layersPrimed) {
      // First state of a session: start with the right layers instead of waiting for a bar line.
      this.layersPrimed = true;
      this.layerDrums = this.intensity >= DRUMS_AT;
      this.layerHigh = this.intensity >= HIGH_AT;
    }
    if (this.musicFilter && this.ctx) {
      // A boss warning sweeps the mix down into a tense drop; the arrival snaps it wide open.
      const raw = muffled ? 750 : boss === 1 ? 1000 : boss === 2 ? 16000 : 5500 + this.intensity * 10500;
      const target = Math.round(raw / 250) * 250;
      if (target !== this.lastFilterTarget) {
        this.lastFilterTarget = target;
        this.musicFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, boss === 1 && !muffled ? 0.35 : 0.1);
      }
    }
  }

  getBeatPulse() {
    if (!this.ctx || !this.enabled || !this.isPlayingMusic) return 0;
    while (this.pendingBeats.length && this.pendingBeats[0] <= this.ctx.currentTime) {
      this.lastBeatTime = this.pendingBeats.shift();
    }
    const beatDur = 60 / this.bpm;
    const elapsed = this.ctx.currentTime - this.lastBeatTime;
    if (elapsed < 0 || elapsed > beatDur) return 0;
    return Math.pow(1 - elapsed / beatDur, 2.2);
  }

  // =====================================================================
  // Samples
  // =====================================================================

  // Fetch + decode every sample once (after the first gesture created/resumed the context).
  // `names` defaults to the in-game samples; the before/after page loads the whole library.
  loadSamples(names = Object.keys(SFX_SAMPLES)) {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.decodeAudioData !== 'function' || typeof fetch !== 'function') return;
    this.sampleLoadStarted = true;
    this.sampleRequested ||= new Set();
    for (const name of names) {
      if (this.sampleRequested.has(name)) continue;
      this.sampleRequested.add(name);
      fetch(`${SFX_BASE}${name}.mp3`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then(data => new Promise((resolve, reject) => {
          // Callback form for older Safari; newer browsers also return a promise.
          const pending = ctx.decodeAudioData(data, resolve, reject);
          if (pending && typeof pending.then === 'function') pending.then(resolve, reject);
        }))
        .then(buffer => { if (this.ctx === ctx) this.samples.set(name, buffer); })
        .catch(() => { this.sampleFailures.add(name); });
    }
  }

  hasSample(name) {
    return this.samples.has(name);
  }

  // Play a decoded sample through the SFX bus. Returns false only when the sample is unavailable (the
  // caller then plays its procedural fallback); a voice-limited (throttled) call still returns true.
  playSample(name, { volume = 1, rate = 1, delay = 0 } = {}) {
    // forceProcedural: the before/after page plays each sound's original version.
    if (this.forceProcedural || (!this.previewAll && !SFX_SAMPLES[name])) return false;
    const buffer = this.samples.get(name);
    const def = SFX_LIBRARY[name];
    if (!buffer || !def || !this.ctx || !this.sfxGain) return false;
    const spread = def.pitchVar ?? 0.04;
    const playbackRate = Math.max(0.25, Math.min(4, rate * (1 + (Math.random() * 2 - 1) * spread)));
    if (!this.claimVoice(`sample:${name}`, def.gapMs ?? 0, def.maxVoices ?? 3, delay + buffer.duration / playbackRate)) return true;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(playbackRate, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(def.volume * volume, t);
    src.connect(gain);
    gain.connect(this.sfxGain);
    src.onended = () => { src.disconnect(); gain.disconnect(); };
    src.start(t);
    return true;
  }

  // =====================================================================
  // Music: scheduler
  // =====================================================================

  startMusic() {
    if (!this.ctx || this.isPlayingMusic) return;
    if (this.musicTracks.length && this.startFileMusic()) return;
    this.songIndex = Math.floor(Math.random() * SONGS.length);
    this.formIndex = 0;
    this.sectionBar = 0;
    this.bpm = this.baseBpm + SONGS[this.songIndex].bpmOffset;
    this.buildMusicGraph();
    if (this.delay) this.delay.delayTime.setValueAtTime((60 / this.bpm) * 0.75, this.ctx.currentTime);
    this.isPlayingMusic = true;
    this.stepIndex = 0;
    this.lastBeatTime = -Infinity;
    this.pendingBeats = [];
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    // The timer only wakes the scheduler; every note is placed on the AudioContext clock, so timer
    // jitter never drifts the groove.
    this.schedulerId = setInterval(() => this.scheduleMusic(), 25);
  }

  scheduleMusic() {
    if (!this.ctx || !this.isPlayingMusic) return;
    const secondsPer16th = 60 / this.bpm / 4;
    const now = this.ctx.currentTime;
    // Drop missed steps in constant time after a hidden tab or stalled main thread.
    if (this.nextNoteTime < now) {
      const missed = Math.ceil((now - this.nextNoteTime) / secondsPer16th);
      this.nextNoteTime += missed * secondsPer16th;
      this.stepIndex = (this.stepIndex + missed) % 64;
    }
    // Retain only the most recent audible beat plus the small lookahead queue.
    while (this.pendingBeats.length && this.pendingBeats[0] <= now) {
      this.lastBeatTime = this.pendingBeats.shift();
    }
    while (this.nextNoteTime < now + 0.1) {
      this.triggerStep(this.stepIndex, this.nextNoteTime, secondsPer16th);
      this.nextNoteTime += secondsPer16th;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  stopMusic() {
    clearInterval(this.schedulerId);
    this.schedulerId = null;
    this.isPlayingMusic = false;
    this.pendingBeats = [];
    this.lastBeatTime = -Infinity;
    if (this.decks) for (const deck of this.decks) { try { deck.el.pause(); } catch (_e) {} }
    this.fileMode = false;
  }

  async dispose() {
    this.stopMusic();
    const ctx = this.ctx;
    this.ctx = null;
    if (this.decks) {
      for (const deck of this.decks) { deck.src?.disconnect(); deck.gain?.disconnect(); }
      this.decks = null;
    }
    for (const key of ['masterGain', 'musicGain', 'musicCompressor', 'outputLimiter', 'sfxGain', 'musicFilter',
      'pumpGain', 'reverbIn', 'reverb', 'reverbOut', 'delayIn', 'delay', 'delayFeedback', 'delayOut', 'padSend']) {
      this[key]?.disconnect();
      this[key] = null;
    }
    this.samples.clear();
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Sidechain pump bus (bass + pads), a generated-impulse convolution reverb and a dotted-eighth
  // feedback delay for the lead. Built once; skipped piecewise where the context lacks a node type.
  buildMusicGraph() {
    const ctx = this.ctx;
    if (!ctx || this.pumpGain || !this.musicFilter) return;
    this.pumpGain = ctx.createGain();
    this.pumpGain.gain.value = 1;
    this.pumpGain.connect(this.musicFilter);

    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.padSend = ctx.createGain();
    this.padSend.gain.value = 0.32;
    this.padSend.connect(this.reverbIn);
    if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function') {
      this.reverb = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.2);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      const preDelay = Math.floor(ctx.sampleRate * 0.012);
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        for (let i = preDelay; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
      }
      this.reverb.buffer = ir;
      this.reverbOut = ctx.createBiquadFilter();
      this.reverbOut.type = 'lowpass';
      this.reverbOut.frequency.value = 5200;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(wet);
      wet.connect(this.musicFilter);
    }
    if (typeof ctx.createDelay === 'function') {
      this.delayIn = ctx.createGain();
      this.delayIn.gain.value = 1;
      this.delay = ctx.createDelay(2);
      this.delay.delayTime.value = (60 / this.bpm) * 0.75;
      this.delayFeedback = ctx.createGain();
      this.delayFeedback.gain.value = 0.34;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 3200;
      this.delayOut = ctx.createGain();
      this.delayOut.gain.value = 0.3;
      this.delayIn.connect(this.delay);
      this.delay.connect(damp);
      damp.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delay);
      damp.connect(this.delayOut);
      this.delayOut.connect(this.musicFilter);
      this.delayOut.connect(this.reverbIn);
    }
  }

  // Advance the arrangement by one bar: song form -> section -> chord, rotating songs when a form ends.
  // Pure state (no audio nodes), so it is safe to call from tests.
  advanceBar() {
    // Layer gates re-evaluate on the bar line with hysteresis, so swarms never flicker parts on and off.
    const i = this.intensity;
    this.layerDrums = this.layerDrums ? i > 0.3 : i >= DRUMS_AT;
    this.layerHigh = this.layerHigh ? i > 0.54 : i >= HIGH_AT;

    if (this.bossStage === 2) {
      const total = BOSS_SECTION.chords.length * BOSS_SECTION.barsPerChord;
      const bar = this.bossBar % total;
      this.bossBar++;
      this.chord = BOSS_SECTION.chords[Math.floor(bar / BOSS_SECTION.barsPerChord)];
      this.chordChanged = bar % BOSS_SECTION.barsPerChord === 0;
      this.chordBars = BOSS_SECTION.barsPerChord;
      this.sectionStart = bar === 0;
      this.sectionEnd = bar === total - 1;
      return;
    }
    this.bossBar = 0;
    let song = SONGS[this.songIndex];
    let section = song.sections[song.form[this.formIndex]];
    let length = section.chords.length * section.barsPerChord;
    if (this.sectionBar >= length) {
      this.sectionBar = 0;
      this.formIndex++;
      if (this.formIndex >= song.form.length) {
        this.formIndex = 0;
        this.songIndex = (this.songIndex + 1) % SONGS.length;
        song = SONGS[this.songIndex];
        this.bpm = this.baseBpm + song.bpmOffset;
        if (this.delay && this.ctx) this.delay.delayTime.setValueAtTime((60 / this.bpm) * 0.75, this.ctx.currentTime);
      }
      section = song.sections[song.form[this.formIndex]];
      length = section.chords.length * section.barsPerChord;
    }
    const bar = this.sectionBar;
    this.chord = section.chords[Math.floor(bar / section.barsPerChord) % section.chords.length];
    this.chordChanged = bar % section.barsPerChord === 0;
    this.chordBars = section.barsPerChord;
    this.sectionStart = bar === 0;
    this.sectionEnd = bar === length - 1;
    this.sectionBar++;
  }

  songKey() {
    return SONGS[this.songIndex]?.key ?? 33;
  }

  // Chord root in the bass register (MIDI 31-42).
  bassRoot(chord = this.chord) {
    let n = this.songKey() + chord[0];
    while (n < 31) n += 12;
    while (n >= 43) n -= 12;
    return n;
  }

  // Close pad voicing around G3-F#4, so successive chords voice-lead instead of jumping.
  padVoicing(chord = this.chord) {
    const base = this.songKey() + chord[0];
    return (CHORD_TONES[chord[1]] || CHORD_TONES.m).map(iv => {
      let n = base + iv;
      while (n < 55) n += 12;
      while (n >= 67) n -= 12;
      return n;
    }).sort((a, b) => a - b);
  }

  // Two octaves of chord tones from E4 up, for the lead arpeggio.
  arpTones(chord = this.chord) {
    let base = this.songKey() + chord[0];
    while (base < 64) base += 12;
    while (base >= 76) base -= 12;
    const tones = [];
    for (const octave of [0, 12]) for (const iv of CHORD_TONES[chord[1]] || CHORD_TONES.m) tones.push(base + iv + octave);
    return tones;
  }

  // Sidechain-style pump: bass and pads dip on the kick and swell back before the next beat.
  duckPump(t, depth, length) {
    if (!this.pumpGain) return;
    const g = this.pumpGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(depth, t + 0.012);
    g.linearRampToValueAtTime(1, t + length);
  }

  // One 16th step. calm: pads + bass; mid (drums layer): kick, gated snare, hats, rolling 16th bass;
  // high: lead arpeggio, 16th hats, claps, crash + tom fills; boss warning: kick + bass only;
  // boss fight: the dark boss section with the square-stab riff; muffled: hats drop and the bus low-passes.
  triggerStep(step, time, stepDur) {
    if (!this.enabled) return;
    const s = step % 16;
    if (s === 0) this.advanceBar();
    const song = SONGS[this.songIndex] || SONGS[0];
    const root = this.bassRoot();
    const muffled = this.isMuffled;
    const warning = this.bossStage === 1 && !muffled;
    const boss = this.bossStage === 2;
    const drums = boss || warning || this.layerDrums;
    const high = !muffled && !warning && (boss || this.layerHigh);

    // Beat: kick (when drums play) and the sidechain pump; the visual beat pulse always follows the beat.
    if (s % 4 === 0) {
      this.pendingBeats.push(time);
      if (drums) this.playKick(time);
      this.duckPump(time, drums ? 0.3 : 0.62, stepDur * 3.2);
    }

    // Bass: rolling 16ths with the drums, a softer 8th-note pulse when calm.
    if (drums) {
      const offset = song.bass[s];
      this.playBassNote(time, this.midiToFreq(root + offset), stepDur * 0.82, s % 4 === 2 ? 1 : 0.72);
    } else if (s % 2 === 0) {
      this.playBassNote(time, this.midiToFreq(root + (s === 14 ? 12 : 0)), stepDur * 1.7, 0.5);
    }

    // Warning drop: only kick and bass keep driving under the klaxon.
    if (warning) return;

    // Pads on every chord change, held across the chord with a soft release into the next.
    if (s === 0 && this.chordChanged) {
      this.playChordPad(time, this.padVoicing(), stepDur * 16 * this.chordBars);
    }

    if (drums) {
      if (s === 4 || s === 12) this.playSnare(time, muffled ? 0.22 : 0.46 + this.intensity * 0.12, high);
      if (!muffled) {
        if (high) {
          const open = s % 4 === 2;
          this.playHiHat(time, open ? 0.2 : 0.035, open ? 0.12 : s % 2 === 0 ? 0.07 : 0.045);
        } else if (s % 2 === 0) {
          this.playHiHat(time, s % 4 === 2 ? 0.09 : 0.035, s % 4 === 2 ? 0.1 : 0.05);
        }
      }
    }

    if (high) {
      // Lead arpeggio over two octaves of chord tones (feeds the dotted-eighth delay).
      const tones = this.arpTones();
      const idx = song.arp[s % song.arp.length] % tones.length;
      this.playArpNote(time, this.midiToFreq(tones[idx]), stepDur * 0.9);
      // Crash on section downbeats, tom run into the next section.
      if (s === 0 && this.sectionStart) this.playHiHat(time, 1.3, 0.13, true);
      if (this.sectionEnd && s >= 12) this.playTom(time, 196 - (s - 12) * 34);
    }

    // Boss fight riff: syncopated square stabs (3-3-2 feel) an octave over the bass root.
    if (boss && !muffled && BOSS_RIFF_STEPS.includes(s)) {
      this.playBossStab(time, this.midiToFreq(root + 24 + (s === 14 ? 7 : 0)), stepDur * 1.6);
    }
  }

  // =====================================================================
  // Music: voices
  // =====================================================================

  musicOut() {
    return this.musicFilter;
  }

  playBossStab(t, freq, dur) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.musicOut());
    if (this.reverbIn) gain.connect(this.reverbIn);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  // Punchy 80s kick: pitch-dropped sine body plus a short filtered click.
  playKick(t) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(gain);
    gain.connect(this.musicOut());
    osc.start(t);
    osc.stop(t + 0.36);

    const click = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2400, t);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.1, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.014);
    click.connect(hp);
    hp.connect(cg);
    cg.connect(this.musicOut());
    click.start(t, Math.random() * 0.8, 0.02);
  }

  // Squelchy outrun bass: saw + square through an enveloped resonant low-pass, into the pump bus.
  playBassNote(t, freq, dur, accent = 0.8) {
    if (!this.ctx) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, t);
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 0.5 < 40 ? freq : freq * 0.5, t);
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(260 + accent * (700 + this.intensity * 900), t);
    filter.frequency.exponentialRampToValueAtTime(160, t + Math.max(0.05, dur));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3 * (0.6 + accent * 0.4), t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.pumpGain || this.musicOut());
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur + 0.01);
    osc2.stop(t + dur + 0.01);
  }

  // Gated-reverb snare: a short tone body, a band-passed noise burst held then hard-gated, a reverb
  // send, and (high intensity) a three-slap clap layer.
  playSnare(t, vol, clap = false) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.07);
    oscGain.gain.setValueAtTime(vol * 0.55, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(oscGain);
    oscGain.connect(this.musicOut());
    osc.start(t);
    osc.stop(t + 0.12);

    const noise = this.noiseSource();
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1700, t);
    band.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.linearRampToValueAtTime(vol * 0.5, t + 0.15);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.18); // the gate
    noise.connect(band);
    band.connect(gain);
    gain.connect(this.musicOut());
    if (this.reverbIn) {
      const send = this.ctx.createGain();
      send.gain.value = 0.55;
      gain.connect(send);
      send.connect(this.reverbIn);
    }
    noise.start(t, Math.random() * 0.7, 0.2);

    if (clap) {
      const c = this.noiseSource();
      const cb = this.ctx.createBiquadFilter();
      cb.type = 'bandpass';
      cb.frequency.setValueAtTime(1150, t);
      cb.Q.value = 1.4;
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) {
        cg.gain.setValueAtTime(vol * 0.55, t + k * 0.011);
        cg.gain.exponentialRampToValueAtTime(vol * 0.08, t + k * 0.011 + 0.009);
      }
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      c.connect(cb);
      cb.connect(cg);
      cg.connect(this.musicOut());
      if (this.reverbIn) cg.connect(this.reverbIn);
      c.start(t, Math.random() * 0.7, 0.16);
    }
  }

  // Closed / open hat; `crash` = long bright wash routed into the reverb.
  playHiHat(t, dur, vol, crash = false) {
    if (!this.ctx) return;
    const noise = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(crash ? 4200 : 7000, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicOut());
    if (crash && this.reverbIn) gain.connect(this.reverbIn);
    // The shared noise buffer is one second long; loop it for long crashes.
    if (dur > 0.9) noise.loop = true;
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + dur + 0.02);
  }

  // Fill tom: pitch-dropped sine into the reverb.
  playTom(t, freq) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.2);
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain);
    gain.connect(this.musicOut());
    if (this.reverbIn) gain.connect(this.reverbIn);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // Lead arpeggio pluck. Timbre follows the song: detuned saws, a hollow square, or triangle + saw.
  playArpNote(t, freq, dur) {
    if (!this.ctx) return;
    const lead = SONGS[this.songIndex]?.lead || 'saw';
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = lead === 'tri' ? 'triangle' : lead === 'square' ? 'square' : 'sawtooth';
    osc2.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(lead === 'square' ? freq * 2 : freq, t);
    osc2.detune.setValueAtTime(lead === 'saw' ? 12 : 5, t);
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(5200, t);
    filter.frequency.exponentialRampToValueAtTime(1100, t + dur);
    const vol = (lead === 'square' ? 0.055 : 0.07) + this.intensity * 0.03;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicOut());
    if (this.delayIn) gain.connect(this.delayIn);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + dur + 0.01);
    osc2.stop(t + dur + 0.01);
  }

  // Lush pad: three detuned saws per chord tone (chorus), slow attack, filtered, into the pump bus and
  // the reverb.
  playChordPad(t, notes, dur) {
    if (!this.ctx) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(1300 + this.intensity * 1500, t);
    const gain = this.ctx.createGain();
    const release = 0.45;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.32);
    gain.gain.setValueAtTime(1, t + Math.max(0.33, dur - 0.1));
    gain.gain.linearRampToValueAtTime(0.0001, t + dur + release);
    filter.connect(gain);
    gain.connect(this.pumpGain || this.musicOut());
    if (this.padSend) gain.connect(this.padSend);
    const list = Array.isArray(notes) ? notes : [notes, notes + 3, notes + 7];
    for (const midi of list) {
      const freq = this.midiToFreq(midi);
      for (const detune of [-11, 0, 11]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.setValueAtTime(detune, t);
        const og = this.ctx.createGain();
        og.gain.value = 0.026;
        osc.connect(og);
        og.connect(filter);
        osc.start(t);
        osc.stop(t + dur + release + 0.05);
      }
    }
  }

  // =====================================================================
  // Music: streamed files (MUSIC_TRACKS)
  // =====================================================================

  startFileMusic() {
    const ctx = this.ctx;
    if (!ctx || typeof Audio === 'undefined' || typeof ctx.createMediaElementSource !== 'function' || !this.musicFilter) return false;
    try {
      if (!this.decks) {
        this.decks = [0, 1].map(() => {
          const el = new Audio();
          el.crossOrigin = 'anonymous';
          el.preload = 'auto';
          const src = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          gain.gain.value = 0;
          src.connect(gain);
          gain.connect(this.musicFilter);
          el.addEventListener('error', () => this.onTrackError());
          return { el, src, gain };
        });
      }
    } catch (_e) {
      this.decks = null;
      return false;
    }
    this.fileMode = true;
    this.isPlayingMusic = true;
    this.deckIndex = 0;
    this.trackIndex = 0;
    this.crossfading = false;
    this.startDeck(0, 0, 1.5);
    this.schedulerId = setInterval(() => this.updateFileMusic(), 250);
    return true;
  }

  startDeck(index, track, fade) {
    if (!this.decks || !this.ctx) return;
    const deck = this.decks[index];
    const t = this.ctx.currentTime;
    deck.el.src = this.musicTracks[track % this.musicTracks.length];
    const playing = deck.el.play();
    if (playing && typeof playing.catch === 'function') playing.catch(() => this.onTrackError());
    deck.gain.gain.cancelScheduledValues(t);
    deck.gain.gain.setValueAtTime(deck.gain.gain.value, t);
    deck.gain.gain.linearRampToValueAtTime(1, t + fade);
  }

  // Cross-fade into the next track MUSIC_XFADE seconds before the current one ends.
  updateFileMusic() {
    if (!this.fileMode || !this.decks || this.crossfading) return;
    const current = this.decks[this.deckIndex];
    const { duration, currentTime } = current.el;
    if (!Number.isFinite(duration) || duration <= 0 || duration - currentTime > MUSIC_XFADE) return;
    this.crossfading = true;
    const t = this.ctx.currentTime;
    current.gain.gain.cancelScheduledValues(t);
    current.gain.gain.setValueAtTime(current.gain.gain.value, t);
    current.gain.gain.linearRampToValueAtTime(0, t + MUSIC_XFADE);
    this.deckIndex = 1 - this.deckIndex;
    this.trackIndex = (this.trackIndex + 1) % this.musicTracks.length;
    this.startDeck(this.deckIndex, this.trackIndex, MUSIC_XFADE);
    setTimeout(() => {
      try { current.el.pause(); } catch (_e) {}
      this.crossfading = false;
    }, MUSIC_XFADE * 1000 + 100);
  }

  // A track that cannot load or play: give up on files for this session and run the procedural score.
  onTrackError() {
    if (!this.fileMode) return;
    this.stopMusic();
    this.musicTracks = [];
    this.startMusic();
  }

  // =====================================================================
  // SFX
  // =====================================================================

  playLaser(pitchMod = 1) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('autocannon_shot', { rate: Math.max(0.5, Math.min(1.5, pitchMod)) })) return;
    const now = performance.now();
    if (now - this.lastShotSound < 50) return;
    this.lastShotSound = now;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const startFreq = (540 + Math.random() * 80) * pitchMod;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(115, t + 0.065);

    gain.gain.setValueAtTime(0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.075);
  }

  // Critical hit: a short bright "tink" over the impact. Throttled so a crit-heavy build (orbit blades
  // roll crits every tick) ticks rhythmically instead of buzzing.
  playCrit() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('enemy_hit')) return;
    const now = performance.now();
    if (now - this.lastCritSound < 70) return;
    this.lastCritSound = now;

    const t = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    gain.connect(this.sfxGain);
    for (let k = 0; k < 2; k++) {
      const freq = k === 0 ? 1760 : 2637;
      const osc = this.ctx.createOscillator();
      osc.type = k === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, t + 0.05);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  playExplosion(intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    const big = intensity >= 1.5;
    const sampled = big
      ? this.playSample('explosion_large', { volume: Math.min(1.3, 0.6 + intensity * 0.2), rate: 1.06 - Math.min(0.2, (intensity - 1.5) * 0.12) })
      : this.playSample('explosion_small', { volume: Math.min(1.2, 0.5 + intensity * 0.5), rate: 1.18 - intensity * 0.18 });
    if (sampled) return;
    this.proceduralExplosion(intensity);
  }

  proceduralExplosion(intensity = 1) {
    const now = performance.now();
    if (now - this.lastExplosionSound < 35 && intensity < 1.5) return;
    this.lastExplosionSound = now;

    const t = this.ctx.currentTime;
    const dur = Math.min(0.5, 0.15 + intensity * 0.1);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120 * Math.min(1.4, intensity), t);
    sub.frequency.exponentialRampToValueAtTime(28, t + dur);

    subGain.gain.setValueAtTime(Math.min(0.45, 0.22 * intensity), t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(t);
    sub.stop(t + dur + 0.02);

    const noise = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + dur);
    filter.Q.value = 1.2;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(Math.min(0.3, 0.16 * intensity), t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(t, Math.random() * 0.4, dur + 0.02);
  }

  // Enemy killed: small fry shatter with a glassy pop (tier-1 adds a little blast under it); bigger
  // kills get the explosion samples.
  playEnemyDeath(intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    if (intensity < 1.3 && this.playSample('enemy_death', { volume: 0.75 + intensity * 0.2, rate: 1.1 - intensity * 0.1 })) {
      if (intensity >= 1) this.playSample('explosion_small', { volume: 0.45, rate: 1.1 });
      return;
    }
    this.playExplosion(intensity);
  }

  playPlayerHit() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('player_hit')) return;
    this.playExplosion(1.8);
  }

  // XP shards climb a scale while you hoover them up in a streak (resets after 650 ms).
  playGeomPickup(isCore = false) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastGeomTime > 650) {
      this.geomPitchStep = 0;
    } else {
      this.geomPitchStep = Math.min(16, this.geomPitchStep + 1);
    }
    this.lastGeomTime = now;

    const ladder = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
    const semis = ladder[Math.min(ladder.length - 1, this.geomPitchStep)] + (isCore ? 5 : 0);
    if (this.playSample('xp_pickup', { rate: Math.pow(2, semis / 12) * 0.9, volume: isCore ? 1.5 : 1 })) return;

    const semitones = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36, 38];
    const note = semitones[this.geomPitchStep] || 0;
    const base = isCore ? 587.33 : 440;
    const freq = base * Math.pow(2, note / 12);

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isCore ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * (isCore ? 1.5 : 1.25), t + (isCore ? 0.18 : 0.08));

    gain.gain.setValueAtTime(isCore ? 0.22 : 0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isCore ? 0.19 : 0.085));

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + (isCore ? 0.2 : 0.09));
  }

  playGoldPickup() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('gold_pickup')) return;
    this.playGeomPickup(true);
  }

  playDash() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('dash')) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(680, t + 0.14);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  playSupernova() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('supernova')) return;
    this.proceduralExplosion(2.4);
    const t = this.ctx.currentTime;
    const freqs = [110, 164.81, 220, 329.63, 440];
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 1.5, t + idx * 0.02);
      osc.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.75);

      gain.gain.setValueAtTime(0.11, t + idx * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.78);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + idx * 0.02);
      osc.stop(t + 0.8);
    });
  }

  // Singularity collapse: a quick falling "suck" sweep that lands on a sub-bass explosion.
  playImplosion() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('implosion')) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
    this.proceduralExplosion(1.7);
  }

  // Boss warning klaxon: three siren blasts over a swelling sub drone.
  playBossWarning() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const sampled = this.hasSample('boss_warning');
    if (sampled) {
      for (let k = 0; k < 3; k++) this.playSample('boss_warning', { delay: k * 0.5 });
    } else {
      for (let k = 0; k < 3; k++) {
        const start = t + k * 0.5;
        [0, 1.007].forEach((detune) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(587.33 * (detune || 1), start);
          osc.frequency.exponentialRampToValueAtTime(293.66 * (detune || 1), start + 0.42);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.linearRampToValueAtTime(0.085, start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
          osc.connect(gain);
          gain.connect(this.sfxGain);
          osc.start(start);
          osc.stop(start + 0.46);
        });
      }
    }

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(36.71, t);
    subGain.gain.setValueAtTime(0.001, t);
    subGain.gain.linearRampToValueAtTime(0.26, t + 1.2);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(t);
    sub.stop(t + 1.95);
  }

  // Boss arrival impact: sub boom, filtered noise blast and a D-minor power-chord stab.
  playBossArrival() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('boss_arrival')) return;
    this.proceduralExplosion(2.6);
    const t = this.ctx.currentTime;

    const boom = this.ctx.createOscillator();
    const boomGain = this.ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(96, t);
    boom.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    boomGain.gain.setValueAtTime(0.42, t);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    boom.connect(boomGain);
    boomGain.connect(this.sfxGain);
    boom.start(t);
    boom.stop(t + 1);

    [73.42, 110, 146.83].forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 1.32);
    });
  }

  // Boss defeat payoff: a rising D-major fanfare arpeggio over the kill's own detonation.
  playBossDefeat() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [587.33, 739.99, 880, 1174.66, 1479.98];
    notes.forEach((f, i) => {
      const start = t + 0.12 + i * 0.07;
      const dur = i === notes.length - 1 ? 1.1 : 0.4;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  // Lieutenant arrival: a short rising two-tone brass sweep over a sub thump (smaller than the boss sting).
  playLieutenantArrival() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('lieutenant_arrival')) return;
    const t = this.ctx.currentTime;
    [0, 0.12].forEach((offset, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(i ? 293.66 : 220, t + offset);
      osc.frequency.exponentialRampToValueAtTime(i ? 440 : 329.63, t + offset + 0.18);
      gain.gain.setValueAtTime(0.001, t + offset);
      gain.gain.linearRampToValueAtTime(0.08, t + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.32);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + offset);
      osc.stop(t + offset + 0.34);
    });
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    subGain.gain.setValueAtTime(0.22, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(t);
    sub.stop(t + 0.46);
  }

  // ---- Weapon SFX voice limiting ----
  // A sound may start only when its last start is at least `gapMs` ago and fewer than `maxVoices`
  // copies are still ringing (tracked by scheduled end times on the audio clock, no callbacks).
  // Keeps swarms of missiles, arc chains and blade grinds rhythmic instead of a wall of noise.
  claimVoice(key, gapMs, maxVoices, dur) {
    if (!this.enabled || !this.ctx) return false;
    const now = performance.now();
    const voices = this.weaponVoices || (this.weaponVoices = {});
    const v = voices[key] || (voices[key] = { last: -Infinity, ends: [] });
    if (now - v.last < gapMs) return false;
    const t = this.ctx.currentTime;
    let live = 0;
    for (let i = 0; i < v.ends.length; i++) if (v.ends[i] > t) v.ends[live++] = v.ends[i];
    v.ends.length = live;
    if (live >= maxVoices) return false;
    v.last = now;
    v.ends.push(t + dur);
    return true;
  }

  // One shared second of white noise (allocated once); sources start at a random offset into it.
  noiseSource() {
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    return src;
  }

  // Tesla Arc: a stuttering band-passed crackle over a falling saw "zap" and a short low buzz.
  // Longer chains sound a touch fuller.
  playArcZap(jumps = 3) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('arc_zap', { volume: 0.85 + Math.min(0.4, jumps * 0.03) })) return;
    const dur = 0.24;
    if (!this.claimVoice('arc', 70, 3, dur)) return;
    const t = this.ctx.currentTime;
    const body = 1 + Math.min(0.4, jumps * 0.03);

    const noise = this.noiseSource();
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(3400, t);
    band.frequency.exponentialRampToValueAtTime(1600, t + dur);
    band.Q.value = 2.2;
    const crackle = this.ctx.createGain();
    // Stepped random gain = the electrical crackle; the envelope decays across the steps.
    crackle.gain.setValueAtTime(0.001, t);
    for (let k = 0; k < 14; k++) {
      const env = Math.pow(1 - k / 14, 1.6);
      crackle.gain.setValueAtTime((0.04 + Math.random() * 0.16) * env * body, t + k * 0.016);
    }
    crackle.gain.setValueAtTime(0.0001, t + dur);
    noise.connect(band);
    band.connect(crackle);
    crackle.connect(this.sfxGain);
    noise.start(t, Math.random() * 0.7, dur + 0.02);

    const zap = this.ctx.createOscillator();
    const zapGain = this.ctx.createGain();
    zap.type = 'sawtooth';
    zap.frequency.setValueAtTime(1500 + Math.random() * 300, t);
    zap.frequency.exponentialRampToValueAtTime(190, t + 0.13);
    zapGain.gain.setValueAtTime(0.06 * body, t);
    zapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    zap.connect(zapGain);
    zapGain.connect(this.sfxGain);
    zap.start(t);
    zap.stop(t + 0.15);

    const buzz = this.ctx.createOscillator();
    const buzzGain = this.ctx.createGain();
    buzz.type = 'square';
    buzz.frequency.setValueAtTime(118, t);
    buzzGain.gain.setValueAtTime(0.035 * body, t);
    buzzGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    buzz.connect(buzzGain);
    buzzGain.connect(this.sfxGain);
    buzz.start(t);
    buzz.stop(t + 0.1);
  }

  // Missile salvo: a band-swept noise whoosh with a soft thump, plus a quick "fft" per extra
  // missile (up to 3) so the volley sounds like several launches.
  playMissileLaunch(count = 1) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('missile_launch', { volume: 0.9 + Math.min(3, Math.max(0, count - 1)) * 0.08 })) return;
    const dur = 0.3;
    if (!this.claimVoice('missileLaunch', 90, 2, dur)) return;
    const t = this.ctx.currentTime;
    const whoosh = (start, vol, len) => {
      const noise = this.noiseSource();
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(520, start);
      band.frequency.exponentialRampToValueAtTime(2600, start + len * 0.8);
      band.Q.value = 1.3;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, start);
      g.gain.exponentialRampToValueAtTime(vol, start + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, start + len);
      noise.connect(band);
      band.connect(g);
      g.connect(this.sfxGain);
      noise.start(start, Math.random() * 0.6, len + 0.02);
    };
    whoosh(t, 0.15, 0.26);
    for (let k = 1; k <= Math.min(3, count - 1); k++) whoosh(t + k * 0.032, 0.06, 0.1);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(190, t);
    thump.frequency.exponentialRampToValueAtTime(80, t + 0.09);
    thumpGain.gain.setValueAtTime(0.09, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(t);
    thump.stop(t + 0.11);
  }

  // Wing rockets (Prism Rockets): a bright ignition whoosh.
  playRocketLaunch() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('rocket_launch')) return;
    this.playLaser(0.55);
  }

  // Missile / rocket blast: a tight sine pop with a noise click (lighter than an enemy explosion).
  playMissileImpact(vol = 1) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('missile_impact', { volume: vol })) return;
    if (!this.claimVoice('blastPop', 40, 4, 0.12)) return;
    const t = this.ctx.currentTime;
    const pop = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(260 + Math.random() * 40, t);
    pop.frequency.exponentialRampToValueAtTime(62, t + 0.1);
    popGain.gain.setValueAtTime(0.16 * vol, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    pop.connect(popGain);
    popGain.connect(this.sfxGain);
    pop.start(t);
    pop.stop(t + 0.12);

    const noise = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1300, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(hp);
    hp.connect(g);
    g.connect(this.sfxGain);
    noise.start(t, Math.random() * 0.8, 0.06);
  }

  // Singularity launch: a low falling "vwomm" with a slow wobble.
  playSingularityLaunch() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('singularity_launch')) return;
    if (!this.claimVoice('singularity', 150, 2, 0.4)) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.36);
    lfo.frequency.setValueAtTime(18, t);
    lfoGain.gain.setValueAtTime(14, t);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.4);
    lfo.stop(t + 0.4);
  }

  // Escort drone bolt: a tiny high blip, quieter than the blaster.
  playDroneShot() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('drone_shot')) return;
    if (!this.claimVoice('drone', 70, 2, 0.05)) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1180, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.04);
    gain.gain.setValueAtTime(0.03, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  // Sentry turret bolt.
  playTurretShot() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('turret_shot')) return;
    this.playLaser(0.72);
  }

  // Proximity mine laid: a clank and an arming chirp.
  playMineDrop() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('mine_drop')) return;
    if (!this.claimVoice('mineDrop', 120, 2, 0.2)) return;
    this.tone(320, 0, 0.05, 0.06, 'square');
    this.tone(1320, 0.08, 0.07, 0.04, 'sine', 1760);
  }

  playGrenadeThrow() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('grenade_throw')) return;
    this.playLaser(0.42);
  }

  playGrenadeBlast(vol = 0.8) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('grenade_blast', { volume: vol / 0.8 })) return;
    this.playMissileImpact(vol);
  }

  // Orbit blade contact: a short metallic grind tick (blades touch every tick, so heavily throttled).
  playBladeHit() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('blade_hit')) return;
    if (!this.claimVoice('blade', 85, 2, 0.05)) return;
    const t = this.ctx.currentTime;
    const noise = this.noiseSource();
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(4200 + Math.random() * 900, t);
    band.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    noise.connect(band);
    band.connect(g);
    g.connect(this.sfxGain);
    noise.start(t, Math.random() * 0.8, 0.05);
  }

  // Elite grinding through rock: a low, gritty scrape tick, heavily throttled (one voice, ~9/s) and
  // well under the blade grind. `vol` (0-1) falls off with the grind point's distance from the ship.
  playEliteGrind(vol = 1) {
    if (!(vol > 0.02) || !this.claimVoice('eliteGrind', 110, 1, 0.1)) return;
    const t = this.ctx.currentTime;
    const noise = this.noiseSource();
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(520 + Math.random() * 220, t);
    band.frequency.exponentialRampToValueAtTime(300, t + 0.09);
    band.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.045 * Math.min(1, vol), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    noise.connect(band);
    band.connect(g);
    g.connect(this.sfxGain);
    noise.start(t, Math.random() * 0.8, 0.1);
  }

  // Volatile Shatter burst: a glassy three-partial tinkle.
  playShatter() {
    if (!this.claimVoice('shatter', 90, 2, 0.16)) return;
    const t = this.ctx.currentTime;
    [2637, 3520, 4699].forEach((f, k) => {
      const start = t + k * 0.018;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * (0.97 + Math.random() * 0.06), start);
      gain.gain.setValueAtTime(0.045, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  }

  // Gunner plasma orb: a soft low "thoomp" so incoming fire is audible without masking the blaster.
  playEnemyShot() {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - (this.lastEnemyShotSound || 0) < 90) return;
    this.lastEnemyShotSound = now;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // A single enveloped oscillator note into the SFX bus (procedural fallbacks and sparkles).
  tone(freq, start, dur, vol, type = 'triangle', glideTo = 0) {
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Quick high pings on top of a fanfare.
  sparkle(start, count) {
    [2093, 2637, 3136, 2637, 3136, 4186].slice(0, count).forEach((f, i) => this.tone(f, start + i * 0.06, 0.18, 0.05, 'sine'));
  }

  // Supply cache: an "item get" victory jingle (rising arpeggio into a held major chord); jackpot
  // caches add a sparkle run on top.
  playCacheFanfare(jackpot = false) {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('cache_open')) {
      if (jackpot) this.sparkle(0.45, 6);
      return;
    }
    // C major run up (G4 C5 E5 G5), then a C major chord with an octave on top.
    [392.0, 523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, i * 0.07, 0.22, 0.16));
    const hit = 0.3;
    for (const f of [523.25, 659.25, 783.99, 1046.5]) this.tone(f, hit, 0.9, 0.11, 'sawtooth');
    for (const f of [523.25, 1046.5]) this.tone(f, hit, 1.1, 0.12);
    this.sparkle(hit + 0.08, jackpot ? 6 : 4);
  }

  // An elite materializing on screen: a rising energy charge stretched to land with the arrival
  // (bosses lower and louder). The arrival sound itself plays on landing.
  playEliteCharge(duration = 2.6, boss = false) {
    if (!this.enabled || !this.ctx) return;
    const buffer = this.samples.get('elite_charge');
    if (buffer) {
      const fit = Math.max(0.7, Math.min(1.4, buffer.duration / Math.max(0.5, duration)));
      this.playSample('elite_charge', { rate: fit * (boss ? 0.75 : 1), volume: boss ? 1.3 : 1 });
      return;
    }
    const t = this.ctx.currentTime;
    const end = t + Math.max(0.5, duration);
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(boss ? 36 : 55, t);
    osc.frequency.exponentialRampToValueAtTime(boss ? 150 : 220, end);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(boss ? 1400 : 2200, end);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(boss ? 0.16 : 0.1, end - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(end + 0.1);
  }

  playLevelUp() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('level_up')) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.055, 0.38, 0.18));
  }

  // R&D Breakthrough unlocked: a bigger discovery sting than a level-up.
  playBreakthrough() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('breakthrough')) return;
    [392.0, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.06, 0.32, 0.15));
    for (const f of [523.25, 659.25, 783.99, 1046.5]) this.tone(f, 0.32, 1.2, 0.08, 'sawtooth');
    this.sparkle(0.4, 6);
  }

  // Menu focus move (controller d-pad) and menu confirm.
  playUiSelect() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('ui_select')) return;
    if (!this.claimVoice('uiSelect', 45, 2, 0.05)) return;
    this.tone(1320, 0, 0.045, 0.045, 'square');
  }

  playUiConfirm() {
    if (!this.enabled || !this.ctx) return;
    if (this.playSample('ui_confirm')) return;
    if (!this.claimVoice('uiConfirm', 80, 2, 0.16)) return;
    this.tone(880, 0, 0.07, 0.06, 'square');
    this.tone(1320, 0.07, 0.1, 0.06, 'square');
  }

  // Run over: the ship's last blast, then a falling game-over jingle under the muffled score.
  playGameOver() {
    if (!this.enabled || !this.ctx) return;
    this.playSupernova();
    if (this.playSample('game_over', { delay: 0.55 })) return;
    [659.25, 587.33, 523.25, 440].forEach((f, i) => this.tone(f, 0.6 + i * 0.22, i === 3 ? 1.2 : 0.3, 0.12));
    for (const f of [220, 261.63, 329.63]) this.tone(f, 1.26, 1.3, 0.06, 'sawtooth');
  }
}
