// Procedural WebAudio Arcade Synth, Sub-Bass FX & High-Gain Interactive Music Sequencer
import { TUNING } from './config.js';

// Sixteenth steps of the boss-fight riff inside each bar.
const BOSS_RIFF_STEPS = [0, 3, 6, 8, 11, 14];

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

    this.geomPitchStep = 0;
    this.lastGeomTime = 0;
    this.lastShotSound = 0;
    this.lastExplosionSound = 0;
    this.lastCritSound = 0;

    // Interactive Music Sequencer State
    this.isPlayingMusic = false;
    this.bpm = TUNING.musicBpm || 132;
    this.stepIndex = 0;
    this.nextNoteTime = 0;
    this.intensity = 0.35; // 0.0 (calm) -> 1.0 (full swarm overdrive)
    this.isMuffled = false;
    this.bossStage = 0; // 0 none, 1 boss warning (music drops out), 2 boss fight (full + boss riff)
    this.lastBeatTime = -Infinity;
    this.pendingBeats = [];
    this.schedulerId = null;
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
    this.bpm = TUNING.musicBpm || 132;
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
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (!this.isPlayingMusic) this.startMusic();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
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

    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2800;
    this.musicFilter.Q.value = 2.4;

    // High-output Music Bus
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = TUNING.musicVolume ?? 0.4;
    this.musicFilter.connect(this.musicGain);
    this.musicGain.connect(this.masterGain);

    this.startMusic();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.getMasterGainValue(), this.ctx.currentTime, 0.04);
    }
    return this.enabled;
  }

  setMusicState({ intensity = 0.35, muffled = false, boss = this.bossStage }) {
    this.intensity = Math.max(0.15, Math.min(1.0, intensity));
    this.isMuffled = muffled;
    this.bossStage = boss;
    if (this.musicFilter && this.ctx) {
      // A boss warning sweeps the mix down into a tense drop; the arrival snaps it wide open.
      const targetFreq = muffled
        ? 900
        : boss === 1
        ? 1000
        : 1800 + this.intensity * 4800 + (boss === 2 ? 1200 : 0);
      this.musicFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, boss === 1 && !muffled ? 0.35 : 0.1);
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

  startMusic() {
    if (!this.ctx || this.isPlayingMusic) return;
    this.isPlayingMusic = true;
    this.stepIndex = 0;
    this.lastBeatTime = -Infinity;
    this.pendingBeats = [];
    this.nextNoteTime = this.ctx.currentTime + 0.05;
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
  }

  async dispose() {
    this.stopMusic();
    const ctx = this.ctx;
    this.ctx = null;
    for (const key of ['masterGain', 'musicGain', 'musicCompressor', 'outputLimiter', 'sfxGain', 'musicFilter']) {
      this[key]?.disconnect();
      this[key] = null;
    }
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  triggerStep(step, time, stepDur) {
    if (!this.enabled) return;

    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;

    // D-Minor Synthwave Progression (D2 -> Bb1 -> F1 -> C2)
    const bassRoots = [38, 34, 41, 36];
    const rootMidi = bassRoots[bar];

    // 1. Heavy 4-on-the-floor Kick Drum
    if (stepInBar % 4 === 0) {
      this.pendingBeats.push(time);
      this.playKick(time);
    }

    // 2. Dual-Oscillator Rolling 16th-Note Synthwave Bassline
    const octaveJump = stepInBar % 2 === 1 ? 12 : 0;
    const fifthMod = stepInBar === 14 ? 7 : 0;
    const bassFreq = this.midiToFreq(rootMidi + octaveJump + fifthMod);
    this.playBassNote(time, bassFreq, stepDur * 0.88);

    // 3. Punchy Backbeat Snare (steps 4 & 12)
    if (stepInBar === 4 || stepInBar === 12) {
      this.playSnare(time, this.isMuffled ? 0.22 : 0.42 + this.intensity * 0.18);
    }

    // Boss warning drop: only kick and bass keep driving under the klaxon.
    const warningDrop = this.bossStage === 1 && !this.isMuffled;

    // 4. Crisp 16th Hi-Hats
    if (!this.isMuffled && !warningDrop) {
      if (stepInBar % 2 === 1 || (this.intensity > 0.45 && stepInBar % 2 === 0)) {
        const isOpen = stepInBar % 4 === 2;
        this.playHiHat(time, isOpen ? 0.1 : 0.04, isOpen ? 0.24 : 0.13);
      }
    }

    // 5. Bright Cybernetic Lead Arpeggiator (active right from the start, intensifies with swarms!)
    const arpOffsets = [24, 27, 31, 36, 39, 36, 31, 27];
    const arpNote = rootMidi + arpOffsets[stepInBar % arpOffsets.length];
    if (!warningDrop && (this.intensity > 0.4 || stepInBar % 2 === 0)) {
      this.playArpNote(time, this.midiToFreq(arpNote), stepDur * 0.8);
    }

    // 6. Warm Synth Pad Chord Stab on Bar Downbeat (stepInBar === 0)
    if (stepInBar === 0 && !warningDrop) {
      this.playChordPad(time, rootMidi + 24, stepDur * 14);
    }

    // 7. Boss fight riff: syncopated square stabs (3-3-2 feel) an octave over the bass root.
    if (this.bossStage === 2 && !this.isMuffled && BOSS_RIFF_STEPS.includes(stepInBar)) {
      this.playBossStab(time, this.midiToFreq(rootMidi + 24 + (stepInBar === 14 ? 7 : 0)), stepDur * 1.6);
    }
  }

  playBossStab(t, freq, dur) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.musicFilter);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  playKick(t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.14);

    gain.gain.setValueAtTime(0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.musicGain); // Direct to musicGain for maximum low-end punch
    osc.start(t);
    osc.stop(t + 0.17);
  }

  playBassNote(t, freq, dur) {
    // Sawtooth + Sub-Square detuned pair for fat synthwave bass
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, t);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 0.5, t);

    gain.gain.setValueAtTime(0.36, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.musicFilter);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur + 0.01);
    osc2.stop(t + dur + 0.01);
  }

  playSnare(t, vol) {
    // Tone body + noise snap
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.08);
    oscGain.gain.setValueAtTime(vol * 0.7, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(oscGain);
    oscGain.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.095);

    const dur = 0.13;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.32));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(550, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicFilter);
    noise.start(t);
  }

  playHiHat(t, dur, vol) {
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5000, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(t);
  }

  playArpNote(t, freq, dur) {
    const osc = this.ctx.createOscillator();
    const oscDetune = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);

    oscDetune.type = 'sawtooth';
    oscDetune.frequency.setValueAtTime(freq * 1.006, t);

    const vol = 0.14 + this.intensity * 0.18;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    oscDetune.connect(gain);
    gain.connect(this.musicFilter);

    osc.start(t);
    oscDetune.start(t);
    osc.stop(t + dur + 0.01);
    oscDetune.stop(t + dur + 0.01);
  }

  playChordPad(t, rootMidi, dur) {
    const intervals = [0, 3, 7, 12];
    intervals.forEach((semi) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(this.midiToFreq(rootMidi + semi), t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.musicFilter);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }

  // --- SFX ---
  playLaser(pitchMod = 1) {
    if (!this.enabled || !this.ctx) return;
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

  // Critical hit: a short bright two-partial "tink" over the impact. Throttled so a crit-heavy
  // build (orbit blades roll crits every tick) ticks rhythmically instead of buzzing.
  playCrit() {
    if (!this.enabled || !this.ctx) return;
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

    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

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
    noise.start(t);
  }

  playGeomPickup(isCore = false) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastGeomTime > 650) {
      this.geomPitchStep = 0;
    } else {
      this.geomPitchStep = Math.min(16, this.geomPitchStep + 1);
    }
    this.lastGeomTime = now;

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

  playDash() {
    if (!this.enabled || !this.ctx) return;
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
    this.playExplosion(2.4);
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
    this.playExplosion(1.7);
  }

  // Boss warning klaxon: three falling two-tone siren sweeps over a swelling sub drone.
  playBossWarning() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
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
    this.playExplosion(2.6);
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

  // Missile / rocket blast: a tight sine pop with a noise click (lighter than an enemy explosion).
  playMissileImpact(vol = 1) {
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

  // Orbit blade contact: a short metallic grind tick (blades touch every tick, so heavily throttled).
  playBladeHit() {
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

  playLevelUp() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.055);
      gain.gain.setValueAtTime(0.18, t + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.38);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.4);
    });
  }
}
