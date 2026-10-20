// Procedural sound cues for the major bosses (js/bosses-major.js): entrances, attack tells, phase changes
// and death blasts. Bosses queue cues on the EnemyManager (boss-hazards.js `cue`); the game plays them
// through playBossCue on the SoundEngine's SFX bus. Each cue is a few oscillators and filtered noise
// (no samples), rate-limited per cue, and quieter the further the boss is from the ship.

const MIN_GAP = 0.06; // s between two plays of the same cue
const last = new Map();

// Envelope helper: an oscillator from f0 to f1 over dur with a quick attack and exponential tail.
function tone(s, { type = 'sine', f0, f1 = f0, at = 0, dur = 0.3, vol = 0.1, attack = 0.01, out }) {
  const c = s.ctx;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// Filtered noise burst: `type` biquad sweeping f0 → f1.
function noise(s, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, at = 0, dur = 0.3, vol = 0.1, attack = 0.005, out }) {
  if (!s.noiseSource) return;
  const c = s.ctx;
  const t = c.currentTime + at;
  const src = s.noiseSource();
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const CUES = {
  // OUROBOROS: a long hiss over a low growl as it arrives; a rattle before each strike; a growl on the
  // constrict; a molt roar at half HP.
  ouro_hiss: (s, o) => {
    noise(s, { type: 'highpass', f0: 2500, f1: 5200, q: 0.7, dur: 1.3, vol: 0.12, attack: 0.25, out: o });
    tone(s, { type: 'sawtooth', f0: 70, f1: 52, dur: 1.2, vol: 0.09, attack: 0.2, out: o });
  },
  ouro_rattle: (s, o) => {
    for (let k = 0; k < 7; k++) noise(s, { type: 'bandpass', f0: 3800, q: 3, at: k * 0.075, dur: 0.05, vol: 0.13, out: o });
  },
  ouro_strike: (s, o) => {
    noise(s, { type: 'bandpass', f0: 1800, f1: 300, q: 1.2, dur: 0.35, vol: 0.14, out: o });
    tone(s, { type: 'square', f0: 220, f1: 70, dur: 0.3, vol: 0.06, out: o });
  },
  ouro_constrict: (s, o) => {
    tone(s, { type: 'sawtooth', f0: 110, f1: 46, dur: 0.9, vol: 0.12, attack: 0.05, out: o });
    noise(s, { type: 'lowpass', f0: 700, f1: 160, dur: 0.8, vol: 0.12, out: o });
  },
  // HIVE CARRIER: a two-tone launch klaxon; a mortar thunk per shell volley; a reactor breach whine.
  hive_klaxon: (s, o) => {
    for (let k = 0; k < 2; k++) {
      tone(s, { type: 'square', f0: 330, at: k * 0.42, dur: 0.18, vol: 0.06, out: o });
      tone(s, { type: 'square', f0: 247, at: k * 0.42 + 0.2, dur: 0.18, vol: 0.06, out: o });
    }
    tone(s, { type: 'sine', f0: 55, dur: 0.9, vol: 0.18, attack: 0.1, out: o });
  },
  hive_launch: (s, o) => {
    tone(s, { type: 'sine', f0: 140, f1: 45, dur: 0.22, vol: 0.2, out: o });
    noise(s, { type: 'lowpass', f0: 900, f1: 200, dur: 0.2, vol: 0.1, out: o });
    tone(s, { type: 'triangle', f0: 1400, f1: 500, at: 0.15, dur: 0.9, vol: 0.035, attack: 0.2, out: o });
  },
  hive_breach: (s, o) => {
    tone(s, { type: 'sawtooth', f0: 90, f1: 380, dur: 1.1, vol: 0.08, attack: 0.3, out: o });
    noise(s, { type: 'bandpass', f0: 400, f1: 2400, q: 2, dur: 1.1, vol: 0.08, attack: 0.3, out: o });
  },
  // ARCHITECT: a drafting scribble while a blueprint draws; a laser print as it fires; chimes on arrival.
  arch_draft: (s, o) => {
    for (let k = 0; k < 6; k++) tone(s, { type: 'square', f0: 900 + (k % 3) * 260, f1: 1300 + (k % 2) * 400, at: k * 0.07, dur: 0.06, vol: 0.025, out: o });
  },
  arch_print: (s, o) => {
    tone(s, { type: 'sawtooth', f0: 1600, f1: 220, dur: 0.3, vol: 0.07, out: o });
    noise(s, { type: 'highpass', f0: 3000, dur: 0.25, vol: 0.07, out: o });
  },
  arch_chime: (s, o) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(s, { type: 'triangle', f0: f, at: k * 0.09, dur: 0.7, vol: 0.06, out: o }));
  },
  // CONDUCTOR: a woodblock tick on each count-in beat, a timpani + gong on the downbeat, glass when its
  // shield breaks, a swelling chord when it rebuilds, an orchestra hit on arrival.
  cond_tick: (s, o) => {
    tone(s, { type: 'sine', f0: 1250, f1: 900, dur: 0.06, vol: 0.12, out: o });
    noise(s, { type: 'bandpass', f0: 2600, q: 4, dur: 0.04, vol: 0.06, out: o });
  },
  cond_downbeat: (s, o) => {
    tone(s, { type: 'sine', f0: 98, f1: 62, dur: 0.9, vol: 0.28, out: o });
    [196, 311, 467].forEach((f) => tone(s, { type: 'triangle', f0: f, dur: 1.4, vol: 0.04, out: o }));
    noise(s, { type: 'lowpass', f0: 500, f1: 120, dur: 0.4, vol: 0.12, out: o });
  },
  cond_shield_down: (s, o) => {
    for (let k = 0; k < 4; k++) noise(s, { type: 'highpass', f0: 4000 + k * 900, at: k * 0.035, dur: 0.18, vol: 0.08, out: o });
    [2093, 2637, 3136].forEach((f, k) => tone(s, { type: 'sine', f0: f, f1: f * 0.92, at: k * 0.03, dur: 0.5, vol: 0.035, out: o }));
  },
  cond_shield_up: (s, o) => {
    [261.63, 329.63, 392, 523.25].forEach((f) => tone(s, { type: 'triangle', f0: f, dur: 0.9, vol: 0.04, attack: 0.35, out: o }));
  },
  cond_hit: (s, o) => {
    [146.83, 220, 293.66, 349.23].forEach((f) => tone(s, { type: 'sawtooth', f0: f, dur: 0.8, vol: 0.05, out: o }));
    noise(s, { type: 'lowpass', f0: 1800, f1: 300, dur: 0.5, vol: 0.12, out: o });
    tone(s, { type: 'sine', f0: 73, f1: 40, dur: 0.8, vol: 0.2, out: o });
  },
  // PRISM: a rising shimmer before a nova, a bright chord when the spectrum fires, a choir swell on
  // arrival, a huge chord + boom on each phase.
  prism_charge: (s, o) => {
    [440, 554.37, 659.25].forEach((f) => tone(s, { type: 'sine', f0: f, f1: f * 2, dur: 1.4, vol: 0.04, attack: 1.1, out: o }));
    noise(s, { type: 'bandpass', f0: 1200, f1: 6000, q: 3, dur: 1.4, vol: 0.05, attack: 1.1, out: o });
  },
  prism_beam: (s, o) => {
    [880, 1108.73, 1318.51].forEach((f) => tone(s, { type: 'sawtooth', f0: f, f1: f * 0.5, dur: 0.45, vol: 0.03, out: o }));
    noise(s, { type: 'highpass', f0: 2500, dur: 0.3, vol: 0.06, out: o });
  },
  prism_choir: (s, o) => {
    [220, 277.18, 329.63, 440, 554.37].forEach((f, k) => tone(s, { type: 'sine', f0: f, f1: f * 1.003, at: k * 0.05, dur: 2.2, vol: 0.05, attack: 0.7, out: o }));
  },
  prism_phase: (s, o) => {
    tone(s, { type: 'sine', f0: 110, f1: 30, dur: 1.2, vol: 0.32, out: o });
    [293.66, 369.99, 440, 587.33].forEach((f) => tone(s, { type: 'sawtooth', f0: f, dur: 1.3, vol: 0.04, out: o }));
    noise(s, { type: 'bandpass', f0: 3000, f1: 400, q: 0.8, dur: 1, vol: 0.1, out: o });
  },
  // Shared: a phase-change roar and the major-boss death blast (a long rumble with a falling shimmer).
  phase_roar: (s, o) => {
    tone(s, { type: 'sawtooth', f0: 82, f1: 41, dur: 0.9, vol: 0.12, attack: 0.05, out: o });
    noise(s, { type: 'bandpass', f0: 600, f1: 200, q: 1.5, dur: 0.8, vol: 0.14, out: o });
  },
  major_death: (s, o) => {
    tone(s, { type: 'sine', f0: 80, f1: 24, dur: 2.2, vol: 0.32, out: o });
    noise(s, { type: 'lowpass', f0: 1600, f1: 90, dur: 2.2, vol: 0.18, out: o });
    [1760, 1318.51, 1046.5, 880].forEach((f, k) => tone(s, { type: 'triangle', f0: f, at: 0.15 + k * 0.12, dur: 0.6, vol: 0.03, out: o }));
  }
};

export const BOSS_CUES = Object.keys(CUES);

// Plays one queued cue ({ cue, x, y }) on the game's SoundEngine.
export function playBossCue(game, c) {
  const s = game.sound;
  const play = CUES[c.cue];
  if (!play || !s?.enabled || typeof s.ctx?.createGain !== 'function' || !s.sfxGain) return;
  const now = s.ctx.currentTime;
  if (now - (last.get(c.cue) ?? -1) < MIN_GAP) return;
  last.set(c.cue, now);
  const p = game.player;
  const d = p && Number.isFinite(c.x) ? Math.hypot(c.x - p.x, c.y - p.y) : 0;
  const out = s.ctx.createGain();
  out.gain.value = Math.max(0.3, Math.min(1, 1.25 - d / 1400));
  out.connect(s.sfxGain);
  play(s, out);
  setTimeout(() => { try { out.disconnect(); } catch {} }, 3000);
}
