// SFX layering helpers (audio only), built on the AudioEngine in js/audio.js without changing it:
// pitch-varied layered one-shots under one voice cap, and a streak "ladder" that climbs a scale
// while hits keep coming. Weapon, boss and UI code can call these instead of hand-rolling stacks.
//
//   playLayered(game.sound, [
//     { sample: 'explosion', volume: 0.8 },               // a decoded SFX sample, if it is loaded
//     { tone: 220, dur: 0.18, vol: 0.12, type: 'sawtooth', glideTo: 90 },  // a synth body
//     { noise: 0.12, vol: 0.08, freq: 2400, q: 1.2 }      // a band-passed noise crack
//   ], { key: 'boss:slam', gapMs: 60, maxVoices: 2, dur: 0.3, pitch: ladder.rate() });

// Playback-rate multiplier for a shift of `n` semitones.
export const semis = n => 2 ** (n / 12);

// A random multiplier in [1 - spread, 1 + spread], so repeats never sound identical.
export const jitter = (spread = 0.03, rand = Math.random) => 1 + (rand() * 2 - 1) * spread;

// Major-pentatonic climb (it always resolves pleasantly, however far a streak goes).
export const LADDER_PENTATONIC = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);

// Streak ladder: each next() within `resetMs` of the last steps one rung up the scale (capped at the
// top), a longer gap starts again from the bottom. `now` is injectable for tests.
export class PitchLadder {
  constructor({ scale = LADDER_PENTATONIC, resetMs = 650, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
    this.scale = scale;
    this.resetMs = resetMs;
    this.now = now;
    this.step = -1;
    this.last = -Infinity;
  }

  // Advance and return the semitone offset of the new rung.
  next() {
    const t = this.now();
    this.step = t - this.last > this.resetMs ? 0 : Math.min(this.scale.length - 1, this.step + 1);
    this.last = t;
    return this.scale[this.step];
  }

  // Advance and return it as a playback-rate multiplier.
  nextRate() { return semis(this.next()); }

  // How far up the streak is, 0..1 (handy for fading a long streak's volume).
  get progress() { return this.step <= 0 ? 0 : this.step / (this.scale.length - 1); }

  reset() { this.step = -1; this.last = -Infinity; }
}

// Play a stack of layers as one sound. One claimVoice covers the whole stack, so a capped sound
// drops entirely instead of losing a layer. `pitch` scales every layer; each layer also gets its own
// small `spread` jitter. Returns true when it played.
export function playLayered(audio, layers, { key = 'layered', gapMs = 0, maxVoices = 3, dur = 0.25, pitch = 1, volume = 1, spread = 0.03, rand = Math.random } = {}) {
  if (!audio?.enabled || !audio.ctx || !audio.sfxGain || !Array.isArray(layers) || !layers.length) return false;
  if (audio.claimVoice && !audio.claimVoice(`layer:${key}`, gapMs, maxVoices, dur)) return false;
  for (const l of layers) {
    const rate = pitch * jitter(l.spread ?? spread, rand);
    const delay = l.delay ?? 0;
    if (l.sample) {
      audio.playSample?.(l.sample, { volume: (l.volume ?? 1) * volume, rate: (l.rate ?? 1) * rate, delay });
    } else if (l.tone) {
      audio.tone?.(l.tone * rate, delay, l.dur ?? 0.12, (l.vol ?? 0.1) * volume, l.type ?? 'triangle', l.glideTo ? l.glideTo * rate : 0);
    } else if (l.noise) {
      playNoise(audio, { dur: l.noise, vol: (l.vol ?? 0.08) * volume, freq: (l.freq ?? 1800) * rate, q: l.q ?? 1, delay });
    }
  }
  return true;
}

// A band-passed noise burst with a fast attack and exponential decay (cracks, whooshes, sizzles).
export function playNoise(audio, { dur = 0.1, vol = 0.08, freq = 1800, q = 1, delay = 0 } = {}) {
  const ctx = audio?.ctx;
  if (!ctx || !audio.sfxGain || !audio.noiseSource) return false;
  const t = ctx.currentTime + Math.max(0, delay);
  const src = audio.noiseSource();
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(freq, t);
  band.Q.setValueAtTime(q, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(band);
  band.connect(gain);
  gain.connect(audio.sfxGain);
  src.onended = () => { src.disconnect(); band.disconnect(); gain.disconnect(); };
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
  return true;
}

// Ready-made stacks. playPreset(audio, name, opts) passes opts through to playLayered.
export const SFX_PRESETS = Object.freeze({
  // A level-up card taken: a soft low thump, a bright tick and a small crack (pitch it by rarity).
  pickSnap: { key: 'pick_snap', gapMs: 80, maxVoices: 1, dur: 0.2, layers: [
    { tone: 170, dur: 0.13, vol: 0.13, type: 'sine', glideTo: 70 },
    { noise: 0.05, vol: 0.05, freq: 3600, q: 0.9 },
    { tone: 1568, dur: 0.09, vol: 0.035, type: 'triangle', delay: 0.025 }
  ] },
  // A heavy impact body to stack under an existing explosion (boss slams, big blasts).
  heavyThump: { key: 'heavy_thump', gapMs: 90, maxVoices: 2, dur: 0.35, layers: [
    { tone: 95, dur: 0.3, vol: 0.18, type: 'sine', glideTo: 38 },
    { noise: 0.16, vol: 0.07, freq: 700, q: 0.7 }
  ] },
  // A bright reward sparkle (unlocks, rare drops).
  shimmer: { key: 'shimmer', gapMs: 120, maxVoices: 2, dur: 0.4, layers: [
    { tone: 2093, dur: 0.16, vol: 0.04, type: 'sine' },
    { tone: 2637, dur: 0.16, vol: 0.035, type: 'sine', delay: 0.05 },
    { tone: 3136, dur: 0.2, vol: 0.03, type: 'sine', delay: 0.1 }
  ] }
});

export function playPreset(audio, name, opts = {}) {
  const p = SFX_PRESETS[name];
  if (!p) return false;
  const { layers, ...base } = p;
  return playLayered(audio, layers, { ...base, ...opts });
}
