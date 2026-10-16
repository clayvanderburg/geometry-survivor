// Procedural WebAudio Arcade Synth, Sub-Bass FX & High-Gain Interactive Music Sequencer
import { TUNING } from './config.js';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    const savedVol = Number(localStorage.getItem('vectra_master_vol'));
    this.masterVolumePct = !Number.isNaN(savedVol) && localStorage.getItem('vectra_master_vol') !== null ? savedVol : 100;
    this.masterGain = null;
    this.musicGain = null;
    this.musicCompressor = null;
    this.sfxGain = null;
    this.musicFilter = null;

    this.geomPitchStep = 0;
    this.lastGeomTime = 0;
    this.lastShotSound = 0;
    this.lastExplosionSound = 0;

    // Interactive Music Sequencer State
    this.isPlayingMusic = false;
    this.bpm = TUNING.musicBpm || 132;
    this.stepIndex = 0;
    this.nextNoteTime = 0;
    this.intensity = 0.35; // 0.0 (calm) -> 1.0 (full swarm overdrive)
    this.isMuffled = false;
    this.lastBeatTime = 0;
    this.schedulerId = null;
  }

  getMasterGainValue() {
    return this.enabled ? 0.85 * (this.masterVolumePct / 100) : 0;
  }

  setMasterVolume(pct) {
    this.masterVolumePct = Math.max(0, Math.min(200, Number(pct)));
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
        this.musicGain.gain.setTargetAtTime(TUNING.musicVolume ?? 1.35, this.ctx.currentTime, 0.03);
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
      if (this.ctx.state === 'suspended') this.ctx.resume();
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
    this.musicCompressor.connect(this.ctx.destination);

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
    this.musicGain.gain.value = TUNING.musicVolume ?? 1.35;
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

  setMusicState({ intensity = 0.35, muffled = false }) {
    this.intensity = Math.max(0.15, Math.min(1.0, intensity));
    this.isMuffled = muffled;
    if (this.musicFilter && this.ctx) {
      const targetFreq = muffled
        ? 900
        : 1800 + this.intensity * 4800;
      this.musicFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
    }
  }

  getBeatPulse() {
    if (!this.ctx || !this.enabled || !this.isPlayingMusic) return 0;
    const beatDur = 60 / this.bpm;
    const elapsed = this.ctx.currentTime - this.lastBeatTime;
    if (elapsed < 0 || elapsed > beatDur) return 0;
    return Math.pow(1 - elapsed / beatDur, 2.2);
  }

  startMusic() {
    if (!this.ctx || this.isPlayingMusic) return;
    this.isPlayingMusic = true;
    this.stepIndex = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.schedulerId = setInterval(() => this.scheduleMusic(), 25);
  }

  scheduleMusic() {
    if (!this.ctx || !this.isPlayingMusic) return;
    const secondsPer16th = 60 / this.bpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.triggerStep(this.stepIndex, this.nextNoteTime, secondsPer16th);
      this.nextNoteTime += secondsPer16th;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
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
      this.lastBeatTime = time;
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

    // 4. Crisp 16th Hi-Hats
    if (!this.isMuffled) {
      if (stepInBar % 2 === 1 || (this.intensity > 0.45 && stepInBar % 2 === 0)) {
        const isOpen = stepInBar % 4 === 2;
        this.playHiHat(time, isOpen ? 0.1 : 0.04, isOpen ? 0.24 : 0.13);
      }
    }

    // 5. Bright Cybernetic Lead Arpeggiator (active right from the start, intensifies with swarms!)
    const arpOffsets = [24, 27, 31, 36, 39, 36, 31, 27];
    const arpNote = rootMidi + arpOffsets[stepInBar % arpOffsets.length];
    if (this.intensity > 0.4 || stepInBar % 2 === 0) {
      this.playArpNote(time, this.midiToFreq(arpNote), stepDur * 0.8);
    }

    // 6. Warm Synth Pad Chord Stab on Bar Downbeat (stepInBar === 0)
    if (stepInBar === 0) {
      this.playChordPad(time, rootMidi + 24, stepDur * 14);
    }
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
