// Boss sound cues: procedural WebAudio entrance stings and attack tells for the named bosses
// (js/bosses.js), played through SoundEngine.playBossCue(name). Each cue is built from a few
// oscillators and filtered noise on the SFX bus, like the rest of the procedural SFX, and is
// throttled per name so a boss can't stack a cue on itself. `e` is the SoundEngine.

const GAP_MS = { default: 140, hazard_blast: 90, egg_pop: 60 };

// One enveloped oscillator: type, frequency glide f0 → f1 over dur, peak gain, attack.
function tone(e, t, { type = 'sine', f0, f1 = f0, dur, gain = 0.1, attack = 0.01, delay = 0, detune = 0, filter = null }) {
  const c = e.ctx;
  const start = t + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(f0, start);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  let out = osc;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type || 'lowpass';
    f.frequency.setValueAtTime(filter.f0, start);
    if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, start + dur);
    f.Q.value = filter.q ?? 1;
    osc.connect(f);
    out = f;
  }
  out.connect(g);
  g.connect(e.sfxGain);
  osc.start(start);
  osc.stop(start + dur + 0.03);
  return osc;
}

// Filtered noise: band/low/high-pass swept f0 → f1 over dur.
function noise(e, t, { type = 'bandpass', f0, f1 = f0, q = 1, dur, gain = 0.1, attack = 0.01, delay = 0 }) {
  const c = e.ctx;
  const start = t + delay;
  const src = e.noiseSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  f.type = type;
  f.frequency.setValueAtTime(f0, start);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);
  f.Q.value = q;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f);
  f.connect(g);
  g.connect(e.sfxGain);
  src.start(start, Math.random() * 0.5, dur + 0.05);
}

export const BOSS_SFX = {
  // A generic phase-change stinger: a dissonant stab over a falling sub.
  boss_phase(e, t) {
    tone(e, t, { type: 'sine', f0: 110, f1: 32, dur: 0.9, gain: 0.32 });
    for (const [f, d] of [[146.83, 0], [155.56, 6], [220, -6]]) tone(e, t, { type: 'sawtooth', f0: f, dur: 0.8, gain: 0.06, detune: d, filter: { f0: 2400, f1: 300 } });
    noise(e, t, { type: 'highpass', f0: 3000, dur: 0.35, gain: 0.08 });
  },
  // A telegraphed blast going off (zones, lanes): a short low thump.
  hazard_blast(e, t) {
    tone(e, t, { type: 'sine', f0: 140, f1: 40, dur: 0.28, gain: 0.2 });
    noise(e, t, { type: 'lowpass', f0: 1800, f1: 200, dur: 0.25, gain: 0.12 });
  },

  // BROOD QUEEN: an insect screech (entrance and the spear tell), the spear launch, egg pops.
  queen_screech(e, t) {
    for (const d of [0, 14, -11]) tone(e, t, { type: 'sawtooth', f0: 420, f1: 1250, dur: 0.75, gain: 0.05, detune: d, attack: 0.05, filter: { type: 'bandpass', f0: 1200, f1: 3200, q: 4 } });
    noise(e, t, { f0: 2600, f1: 5200, q: 6, dur: 0.7, gain: 0.07, attack: 0.08 });
    tone(e, t, { type: 'square', f0: 60, f1: 48, dur: 0.6, gain: 0.05 });
  },
  queen_spear(e, t) {
    noise(e, t, { f0: 4200, f1: 500, q: 2, dur: 0.45, gain: 0.14 });
    tone(e, t, { type: 'triangle', f0: 900, f1: 220, dur: 0.35, gain: 0.07 });
  },
  egg_toss(e, t) {
    for (let k = 0; k < 3; k++) tone(e, t, { type: 'sine', f0: 380 + k * 90, f1: 760 + k * 90, dur: 0.14, gain: 0.06, delay: k * 0.07 });
  },
  egg_pop(e, t) {
    tone(e, t, { type: 'sine', f0: 900, f1: 180, dur: 0.12, gain: 0.08 });
    noise(e, t, { f0: 1600, dur: 0.08, gain: 0.06, q: 3 });
  },
  queen_death(e, t) {
    for (const d of [0, 20, -17]) tone(e, t, { type: 'sawtooth', f0: 1300, f1: 140, dur: 1.4, gain: 0.05, detune: d, filter: { type: 'bandpass', f0: 2600, f1: 400, q: 3 } });
    noise(e, t, { f0: 4000, f1: 300, q: 3, dur: 1.2, gain: 0.08 });
  },

  // WING COMMANDER: a jet flyby (entrance), the air-raid siren (airstrike tell), the strike roar.
  wing_flyby(e, t) {
    noise(e, t, { type: 'bandpass', f0: 600, f1: 2600, q: 1.4, dur: 0.7, gain: 0.16, attack: 0.5 });
    noise(e, t, { type: 'bandpass', f0: 2600, f1: 300, q: 1.4, dur: 0.9, gain: 0.16, delay: 0.6 });
    tone(e, t, { type: 'sawtooth', f0: 90, f1: 55, dur: 1.4, gain: 0.07, filter: { f0: 600, f1: 200 } });
  },
  wing_siren(e, t) {
    for (let k = 0; k < 2; k++) {
      tone(e, t, { type: 'square', f0: 520, f1: 880, dur: 0.38, gain: 0.045, delay: k * 0.42, filter: { f0: 2400 } });
      tone(e, t, { type: 'square', f0: 880, f1: 520, dur: 0.04, gain: 0.03, delay: k * 0.42 + 0.38 });
    }
  },
  wing_strike(e, t) {
    for (let k = 0; k < 5; k++) tone(e, t, { type: 'sine', f0: 120, f1: 36, dur: 0.3, gain: 0.16, delay: k * 0.09 });
    noise(e, t, { type: 'lowpass', f0: 2200, f1: 250, dur: 0.75, gain: 0.16 });
  },

  // EVENT HORIZON: a sub-bass groan (entrance), the inhale swell (gravity-wave tell), the wave thump.
  horizon_groan(e, t) {
    tone(e, t, { type: 'sine', f0: 62, f1: 22, dur: 2.2, gain: 0.38, attack: 0.3 });
    tone(e, t, { type: 'sawtooth', f0: 41, f1: 30, dur: 2, gain: 0.08, attack: 0.4, filter: { f0: 220, f1: 90 } });
    noise(e, t, { type: 'lowpass', f0: 160, f1: 900, dur: 1.6, gain: 0.12, attack: 1.2 });
  },
  horizon_inhale(e, t) {
    noise(e, t, { type: 'bandpass', f0: 300, f1: 2400, q: 2, dur: 1.1, gain: 0.12, attack: 1 });
    tone(e, t, { type: 'sine', f0: 40, f1: 75, dur: 1.1, gain: 0.18, attack: 0.9 });
  },
  horizon_wave(e, t) {
    tone(e, t, { type: 'sine', f0: 90, f1: 26, dur: 0.9, gain: 0.36 });
    tone(e, t, { type: 'triangle', f0: 330, f1: 110, dur: 0.6, gain: 0.06 });
    noise(e, t, { type: 'lowpass', f0: 900, f1: 120, dur: 0.6, gain: 0.12 });
  },
  horizon_collapse(e, t) {
    noise(e, t, { type: 'bandpass', f0: 3000, f1: 120, q: 1.5, dur: 0.7, gain: 0.18, attack: 0.6 });
    tone(e, t, { type: 'sine', f0: 30, f1: 120, dur: 0.6, gain: 0.25, attack: 0.5 });
    tone(e, t, { type: 'sine', f0: 140, f1: 24, dur: 1.6, gain: 0.42, delay: 0.62 });
  },

  // PROGENITOR: a wet bubbling squelch (entrance and each division), the pseudopod creak (lash tell).
  prog_squelch(e, t) {
    for (let k = 0; k < 4; k++) tone(e, t, { type: 'sine', f0: 160 + k * 70, f1: 420 + k * 120, dur: 0.16, gain: 0.08, delay: k * 0.06 });
    tone(e, t, { type: 'triangle', f0: 70, f1: 140, dur: 0.5, gain: 0.12, filter: { f0: 500 } });
    noise(e, t, { type: 'lowpass', f0: 700, f1: 200, dur: 0.4, gain: 0.08 });
  },
  prog_lash(e, t) {
    tone(e, t, { type: 'sawtooth', f0: 70, f1: 210, dur: 0.6, gain: 0.07, attack: 0.4, filter: { type: 'bandpass', f0: 300, f1: 900, q: 6 } });
    noise(e, t, { type: 'bandpass', f0: 500, f1: 1400, q: 5, dur: 0.6, gain: 0.05, attack: 0.4 });
  },
  prog_crack(e, t) {
    noise(e, t, { type: 'highpass', f0: 1200, f1: 600, dur: 0.12, gain: 0.14 });
    tone(e, t, { type: 'sine', f0: 240, f1: 70, dur: 0.18, gain: 0.12 });
  },

  // ECLIPSE TWINS: a bright and a dark bell (entrance), the eclipse swell (nova tell), the nova.
  twins_chime(e, t) {
    for (const [f, d] of [[880, 0], [1318.5, 0.18], [659.25, 0.42], [783.99, 0.6]]) {
      tone(e, t, { type: 'sine', f0: f, dur: 1.4, gain: 0.07, delay: d });
      tone(e, t, { type: 'sine', f0: f * 2.76, dur: 0.5, gain: 0.02, delay: d });
    }
  },
  twins_eclipse(e, t) {
    for (const f of [220, 261.63, 329.63, 440]) tone(e, t, { type: 'triangle', f0: f * 0.5, f1: f, dur: 1.2, gain: 0.05, attack: 1, detune: (Math.random() - 0.5) * 18 });
    noise(e, t, { type: 'highpass', f0: 2000, f1: 7000, dur: 1.2, gain: 0.05, attack: 1.1 });
  },
  twins_nova(e, t) {
    tone(e, t, { type: 'sine', f0: 160, f1: 28, dur: 1.1, gain: 0.4 });
    for (const f of [440, 554.37, 659.25]) tone(e, t, { type: 'sawtooth', f0: f, f1: f * 0.5, dur: 0.9, gain: 0.05, filter: { f0: 4000, f1: 400 } });
    noise(e, t, { type: 'lowpass', f0: 5000, f1: 200, dur: 0.9, gain: 0.16 });
  }
};

export const BOSS_CUES = Object.keys(BOSS_SFX);

// Plays cue `name` on engine `e` (a SoundEngine with a live AudioContext). Throttled per cue.
export function playBossCue(e, name) {
  const cue = BOSS_SFX[name];
  if (!cue || !e?.ctx || !e.sfxGain) return false;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  e.bossCueAt ||= {};
  if (now - (e.bossCueAt[name] ?? -1e9) < (GAP_MS[name] ?? GAP_MS.default)) return false;
  e.bossCueAt[name] = now;
  cue(e, e.ctx.currentTime);
  return true;
}
