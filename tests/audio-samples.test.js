import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser adapters only (no AudioContext): the audio module must load and no-op here.
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.BroadcastChannel = undefined; // config.js tuning sync would keep the test process alive
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
const { SoundEngine, SFX_SAMPLES, SFX_BASE, MUSIC_TRACKS, SONGS, BOSS_SECTION } = await import('../js/audio.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playMethods = Object.getOwnPropertyNames(SoundEngine.prototype).filter(name => name.startsWith('play') && name !== 'playSample');

test('every SFX sample maps to existing play methods and ships as a file', () => {
  const names = Object.keys(SFX_SAMPLES);
  assert.ok(names.length >= 30);
  for (const name of names) {
    const def = SFX_SAMPLES[name];
    assert.ok(def.methods.length > 0, `${name} has no play method`);
    for (const method of def.methods) assert.equal(typeof SoundEngine.prototype[method], 'function', `${name} -> ${method}`);
    assert.ok(def.volume > 0 && def.volume <= 1, `${name} volume`);
    assert.ok(def.maxVoices >= 1 && def.gapMs >= 0, `${name} voice limits`);
    assert.ok(fs.existsSync(path.join(root, SFX_BASE, `${name}.mp3`)), `missing ${SFX_BASE}${name}.mp3`);
  }
  // And every sample the engine asks for is declared.
  const source = fs.readFileSync(path.join(root, 'js/audio.js'), 'utf8');
  for (const [, name] of source.matchAll(/(?:playSample|hasSample|samples\.get)\('([a-z_]+)'/g)) assert.ok(SFX_SAMPLES[name], `undeclared sample ${name}`);
  const total = fs.readdirSync(path.join(root, SFX_BASE)).filter(f => f.endsWith('.mp3'))
    .reduce((sum, f) => sum + fs.statSync(path.join(root, SFX_BASE, f)).size, 0);
  assert.ok(total < 2.5 * 1024 * 1024, `sfx folder is ${total} bytes`);
  // The Netlify build copies an explicit list of folders into the published site.
  assert.match(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'), /cp -r [^\n]*\bassets\b[^\n]* dist\//, 'netlify build must publish assets/');
});

test('audio engine no-ops without an AudioContext', async () => {
  const engine = new SoundEngine();
  engine.init();
  assert.equal(engine.ctx, null);
  engine.loadSamples();
  assert.equal(engine.sampleLoadStarted, false);
  assert.equal(engine.playSample('autocannon_shot'), false);
  for (const method of playMethods) assert.doesNotThrow(() => engine[method](), method);
  engine.setMusicState({ intensity: 0.9, muffled: true, boss: 2 });
  engine.startMusic();
  assert.equal(engine.isPlayingMusic, false);
  assert.equal(engine.getBeatPulse(), 0);
  engine.applyTuning();
  engine.toggle();
  await engine.dispose();
});

// Minimal recording AudioContext: counts buffer sources (samples) and oscillators (procedural).
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = extra => ({ gain: param(), frequency: param(), detune: param(), Q: param(), playbackRate: param(), connect() {}, disconnect() {}, start() {}, stop() {}, ...extra });
  const ctx = {
    currentTime: 1, sampleRate: 48000, state: 'running', counts: { sources: 0, oscillators: 0 },
    createGain: () => node(), createBiquadFilter: () => node(),
    createOscillator: () => { ctx.counts.oscillators++; return node(); },
    createBufferSource: () => { ctx.counts.sources++; return node(); },
    createBuffer: (ch, len, sr) => ({ sampleRate: sr, getChannelData: () => new Float32Array(len) })
  };
  return ctx;
}

function engineWithSamples(names) {
  const engine = new SoundEngine();
  engine.ctx = fakeContext();
  engine.sfxGain = { connect() {} };
  for (const name of names) engine.samples.set(name, { duration: 0.3 });
  return engine;
}

test('rapid samples are voice-capped and throttled instead of stacking', () => {
  const engine = engineWithSamples(['autocannon_shot', 'drone_shot', 'enemy_hit']);
  for (let i = 0; i < 40; i++) engine.playLaser();
  assert.equal(engine.ctx.counts.sources, 1, 'a burst inside the min interval plays once');
  assert.equal(engine.ctx.counts.oscillators, 0, 'a throttled sample never falls back to procedural');

  // Past the gap but with every voice still ringing: capped at maxVoices.
  const voices = engine.weaponVoices['sample:autocannon_shot'];
  for (let i = 0; i < 20; i++) { voices.last = -Infinity; engine.playLaser(); }
  assert.equal(engine.ctx.counts.sources, SFX_SAMPLES.autocannon_shot.maxVoices);

  // Once the audio clock passes their end, voices free up again.
  engine.ctx.currentTime += 5;
  voices.last = -Infinity;
  engine.playLaser();
  assert.equal(engine.ctx.counts.sources, SFX_SAMPLES.autocannon_shot.maxVoices + 1);
});

test('missing samples fall back to the procedural sounds', () => {
  const engine = engineWithSamples([]);
  engine.playLevelUp();
  engine.playDash();
  engine.playBreakthrough();
  engine.playUiConfirm();
  assert.equal(engine.ctx.counts.sources, 0);
  assert.ok(engine.ctx.counts.oscillators >= 8);

  const sampled = engineWithSamples(['level_up', 'dash']);
  sampled.playLevelUp();
  sampled.playDash();
  assert.equal(sampled.ctx.counts.sources, 2);
  assert.equal(sampled.ctx.counts.oscillators, 0);
});

test('muted engine plays no samples', () => {
  const engine = engineWithSamples(['autocannon_shot']);
  engine.toggle();
  engine.playLaser();
  assert.equal(engine.ctx.counts.sources, 0);
});

test('synthwave arrangement: three songs in distinct keys with 8-16 bar sections', () => {
  assert.ok(SONGS.length >= 3);
  assert.equal(new Set(SONGS.map(s => s.key % 12)).size, SONGS.length, 'each song in its own key');
  for (const song of SONGS) {
    assert.equal(song.bass.length, 16);
    for (const id of song.form) {
      const section = song.sections[id];
      const bars = section.chords.length * section.barsPerChord;
      assert.ok(bars === 8 || bars === 16, `${song.name} ${id}: ${bars} bars`);
    }
  }
  assert.equal(BOSS_SECTION.chords.length * BOSS_SECTION.barsPerChord, 8);
  assert.deepEqual(MUSIC_TRACKS, [], 'procedural score by default');
});

test('arrangement advances sections and rotates songs; boss swaps in the dark section', () => {
  const engine = new SoundEngine();
  engine.songIndex = 0;
  const song = SONGS[0];
  const formBars = song.form.reduce((n, id) => n + song.sections[id].chords.length * song.sections[id].barsPerChord, 0);
  const seenChords = new Set();
  for (let bar = 0; bar < formBars; bar++) {
    engine.advanceBar();
    seenChords.add(engine.chord.join());
    assert.equal(engine.songIndex, 0);
  }
  assert.ok(seenChords.size >= 5, 'sections bring new chords');
  engine.advanceBar();
  assert.equal(engine.songIndex, 1, 'next song after the form ends');
  assert.equal(engine.bpm, engine.baseBpm + SONGS[1].bpmOffset);

  engine.bossStage = 2;
  engine.advanceBar();
  assert.deepEqual(engine.chord, BOSS_SECTION.chords[0]);
  engine.bossStage = 0;
  engine.advanceBar();
  assert.equal(engine.songIndex, 1, 'the song resumes after the boss');
});

test('intensity layers: calm = pads + bass, mid adds drums, high adds lead and extra percussion', () => {
  const run = (intensity, extra = {}) => {
    const engine = new SoundEngine();
    const calls = {};
    for (const method of playMethods) engine[method] = () => { calls[method] = (calls[method] || 0) + 1; };
    engine.setMusicState({ intensity, ...extra });
    engine.songIndex = 0;
    for (let step = 0; step < 64; step++) engine.triggerStep(step, step * 0.1, 0.1);
    return calls;
  };
  const calm = run(0.3);
  assert.ok(calm.playChordPad && calm.playBassNote);
  assert.ok(!calm.playKick && !calm.playSnare && !calm.playArpNote);
  const mid = run(0.5);
  assert.ok(mid.playKick === 16 && mid.playSnare === 8 && mid.playHiHat);
  assert.ok(!mid.playArpNote);
  const high = run(0.9);
  assert.equal(high.playArpNote, 64);
  assert.ok(high.playHiHat > mid.playHiHat);
  const boss = run(1, { boss: 2 });
  assert.ok(boss.playBossStab > 0);
  const muffled = run(0.9, { muffled: true });
  assert.ok(!muffled.playHiHat && !muffled.playArpNote, 'menus drop hats and lead');
});
