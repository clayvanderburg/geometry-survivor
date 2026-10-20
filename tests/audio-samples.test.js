import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser adapters only (no AudioContext): the audio module must load and no-op here.
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.BroadcastChannel = undefined; // config.js tuning sync would keep the test process alive
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
const { SoundEngine, SFX_SAMPLES, SFX_LIBRARY, SFX_IN_GAME, SFX_FILE, SFX_BASE, SFX_V2_BASE, SFX_ROUND2, SOUNDTRACK, SONGS, BOSS_SECTION } = await import('../js/audio.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playMethods = Object.getOwnPropertyNames(SoundEngine.prototype).filter(name => name.startsWith('play') && name !== 'playSample' && name !== 'playPreview');

test('every SFX sample maps to existing play methods and ships as a file', () => {
  const names = Object.keys(SFX_LIBRARY);
  assert.ok(names.length >= 30);
  for (const name of names) {
    const def = SFX_LIBRARY[name];
    assert.ok(def.methods.length > 0, `${name} has no play method`);
    for (const method of def.methods) assert.equal(typeof SoundEngine.prototype[method], 'function', `${name} -> ${method}`);
    assert.ok(def.volume > 0 && def.volume <= 1, `${name} volume`);
    assert.ok(def.maxVoices >= 1 && def.gapMs >= 0, `${name} voice limits`);
    assert.ok(fs.existsSync(path.join(root, SFX_BASE, `${name}.mp3`)), `missing ${SFX_BASE}${name}.mp3`);
  }
  // And every sample the engine asks for is declared.
  const source = fs.readFileSync(path.join(root, 'js/audio.js'), 'utf8');
  for (const [, name] of source.matchAll(/(?:playSample|hasSample|samples\.get)\('([a-z_]+)'/g)) assert.ok(SFX_LIBRARY[name], `undeclared sample ${name}`);
  const total = fs.readdirSync(path.join(root, SFX_BASE)).filter(f => f.endsWith('.mp3'))
    .reduce((sum, f) => sum + fs.statSync(path.join(root, SFX_BASE, f)).size, 0);
  assert.ok(total < 2.5 * 1024 * 1024, `sfx folder is ${total} bytes`);
  // The Netlify build copies an explicit list of folders into the published site.
  assert.match(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'), /cp -r [^\n]*\bassets\b[^\n]* dist\//, 'netlify build must publish assets/');
});

test('round-2 candidates: both variations ship for every listed sound and only the sound check page uses them', () => {
  assert.equal(SFX_ROUND2.length, 16);
  for (const name of SFX_ROUND2) {
    assert.ok(SFX_LIBRARY[name], `${name} is a library sound`);
    // A round-2 sound is in game only through its picked take (SFX_FILE), never the round-1 file.
    if (SFX_IN_GAME.includes(name)) assert.match(SFX_FILE[name] || '', new RegExp(`^v2/${name}_[ab]$`), `${name} plays its picked take`);
    for (const v of ['a', 'b']) {
      const file = path.join(root, SFX_V2_BASE, `${name}_${v}.mp3`);
      assert.ok(fs.existsSync(file), `missing ${SFX_V2_BASE}${name}_${v}.mp3`);
      assert.ok(fs.statSync(file).size > 1000, `${name}_${v}.mp3 is empty`);
    }
  }
  assert.ok(SFX_V2_BASE.startsWith(SFX_BASE), 'v2 files live inside the published sfx folder');
  const page = fs.readFileSync(path.join(root, 'sounds.html'), 'utf8');
  assert.match(page, /SFX_ROUND2/);
  assert.match(page, /playPreview\(/);
  // The game never references the round-2 files.
  for (const file of fs.readdirSync(path.join(root, 'js'))) {
    if (file === 'audio.js' || !file.endsWith('.js')) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'js', file), 'utf8'), /sfx\/v2|playPreview|loadPreview/, file);
  }
  const total = fs.readdirSync(path.join(root, SFX_V2_BASE)).reduce((sum, f) => sum + fs.statSync(path.join(root, SFX_V2_BASE, f)).size, 0)
    + fs.readdirSync(path.join(root, SFX_BASE)).filter(f => f.endsWith('.mp3')).reduce((sum, f) => sum + fs.statSync(path.join(root, SFX_BASE, f)).size, 0);
  assert.ok(total < 2.5 * 1024 * 1024, `sfx folder (with v2) is ${total} bytes`);
});

test('preview playback uses the library settings and is a no-op without audio', async () => {
  const silent = new SoundEngine();
  assert.equal(await silent.playPreview(`${SFX_V2_BASE}dash_a.mp3`, SFX_LIBRARY.dash), false);
  const engine = engineWithSamples([]);
  engine.previewBuffers = new Map([[`${SFX_V2_BASE}dash_a.mp3`, Promise.resolve({ duration: 0.4 })]]);
  assert.equal(await engine.playPreview(`${SFX_V2_BASE}dash_a.mp3`, SFX_LIBRARY.dash), true);
  assert.equal(engine.ctx.counts.sources, 1);
  assert.equal(engine.ctx.counts.oscillators, 0);
  // Previews never make the in-game path play a sample.
  engine.weaponVoices = {};
  engine.playDash();
  assert.equal(engine.ctx.counts.sources, 1);
});

test('audio engine no-ops without an AudioContext', async () => {
  const engine = new SoundEngine();
  engine.init();
  assert.equal(engine.ctx, null);
  engine.loadSamples();
  assert.equal(engine.sampleLoadStarted, false);
  assert.equal(engine.playSample('turret_shot'), false);
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
  const engine = engineWithSamples(['turret_shot', 'enemy_hit']);
  engine.previewAll = true; // turret_shot is a library sample (the before/after page), not in game
  for (let i = 0; i < 40; i++) engine.playTurretShot();
  assert.equal(engine.ctx.counts.sources, 1, 'a burst inside the min interval plays once');
  assert.equal(engine.ctx.counts.oscillators, 0, 'a throttled sample never falls back to procedural');

  // Past the gap but with every voice still ringing: capped at maxVoices.
  const voices = engine.weaponVoices['sample:turret_shot'];
  for (let i = 0; i < 20; i++) { voices.last = -Infinity; engine.playTurretShot(); }
  assert.equal(engine.ctx.counts.sources, SFX_LIBRARY.turret_shot.maxVoices);

  // Once the audio clock passes their end, voices free up again.
  engine.ctx.currentTime += 5;
  voices.last = -Infinity;
  engine.playTurretShot();
  assert.equal(engine.ctx.counts.sources, SFX_LIBRARY.turret_shot.maxVoices + 1);
});

test('only the approved samples play in game; everything else keeps its original procedural sound', () => {
  // The player's picks from the sound check page (sounds.html).
  for (const name of ['cache_open', 'explosion_small', 'implosion', 'ui_select', 'autocannon_shot', 'supernova']) assert.ok(SFX_IN_GAME.includes(name), name);
  for (const name of ['level_up', 'drone_shot', 'blade_hit', 'xp_pickup', 'enemy_death', 'breakthrough']) assert.ok(!SFX_IN_GAME.includes(name), name);
  assert.deepEqual(Object.keys(SFX_SAMPLES).sort(), [...SFX_IN_GAME].sort());
});

test('missing samples fall back to the procedural sounds', () => {
  const engine = engineWithSamples([]);
  engine.playLevelUp();
  engine.playDash();
  engine.playBreakthrough();
  engine.playUiConfirm();
  assert.equal(engine.ctx.counts.sources, 0);
  assert.ok(engine.ctx.counts.oscillators >= 8);

  // cache_open is approved for the game; ui_confirm is loaded but not approved, so it stays procedural.
  const sampled = engineWithSamples(['cache_open', 'ui_confirm']);
  sampled.playCacheFanfare();
  assert.equal(sampled.ctx.counts.sources, 1);
  assert.equal(sampled.ctx.counts.oscillators, 0);
  sampled.playUiConfirm();
  assert.equal(sampled.ctx.counts.sources, 1);
  assert.ok(sampled.ctx.counts.oscillators > 0);
  // The before/after page: previewAll plays any loaded sample, forceProcedural plays the original.
  sampled.previewAll = true;
  sampled.weaponVoices = {};
  sampled.playUiConfirm();
  assert.equal(sampled.ctx.counts.sources, 2);
  sampled.forceProcedural = true;
  sampled.playCacheFanfare();
  assert.equal(sampled.ctx.counts.sources, 2, 'forced to the original sound');
});

test('muted engine plays no samples', () => {
  const engine = engineWithSamples(['turret_shot']);
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
  // The streamed soundtrack's files all exist (the procedural score is only the fallback).
  for (const src of [SOUNDTRACK.menu, SOUNDTRACK.boss, ...SOUNDTRACK.run]) assert.ok(fs.existsSync(new URL(`../${src}`, import.meta.url)), src);
  assert.equal(SOUNDTRACK.run.length, 4);
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
  assert.deepEqual(muffled, high, 'menus keep the same arrangement (only the bus low-pass glides down)');
});

test('streamed soundtrack: menu theme on the title, the playlist in intensity order in runs, the boss theme in boss fights', () => {
  const engine = new SoundEngine();
  assert.deepEqual(engine.wantedTrack(), { src: SOUNDTRACK.menu, loop: true }, 'title screen');
  engine.setMusicScene('run');
  assert.deepEqual(engine.wantedTrack(), { src: 'assets/music/run-geom-harvest.mp3', loop: false }, 'every run opens on the early-wave track');
  const order = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { engine.playIndex = i; return engine.wantedTrack().src.split('/').pop(); });
  assert.deepEqual(order, ['run-geom-harvest.mp3', 'run-asteroid-fields.mp3', 'run-neon-wake.mp3', 'run-singularity.mp3',
    'run-asteroid-fields.mp3', 'run-neon-wake.mp3', 'run-singularity.mp3', 'run-asteroid-fields.mp3'], 'builds, then cycles without the opener');
  engine.bossStage = 2;
  assert.deepEqual(engine.wantedTrack(), { src: SOUNDTRACK.boss, loop: true }, 'boss fight');
  engine.bossStage = 0;
  engine.setMusicScene('run');
  assert.equal(engine.playIndex, 0, 'a new run starts the playlist over');
  engine.setMusicScene('menu');
  assert.equal(engine.wantedTrack().src, SOUNDTRACK.menu);
});

test('a big XP cluster chimes in a capped, mid-range climb instead of stacking shrill tones', () => {
  const engine = engineWithSamples([]);
  const freqs = [];
  engine.ctx.createOscillator = () => {
    engine.ctx.counts.oscillators++;
    const p = { setValueAtTime(v) { freqs.push(v); }, exponentialRampToValueAtTime() {} };
    return { frequency: p, type: '', connect() {}, start() {}, stop() {} };
  };
  for (let i = 0; i < 60; i++) engine.playGeomPickup(false);
  assert.ok(engine.ctx.counts.oscillators <= 4, `60 pickups in one burst played ${engine.ctx.counts.oscillators} chimes`);
  // Spread the burst out (past the voice gap) and the pitch still stops climbing at ~1.1 kHz.
  engine.weaponVoices = {};
  for (let i = 0; i < 30; i++) {
    engine.weaponVoices['proc:xp_pickup'] = { last: -Infinity, ends: [] };
    engine.playGeomPickup(false);
  }
  assert.ok(Math.max(...freqs) < 1200, `top chime ${Math.round(Math.max(...freqs))} Hz`);
});

// A streaming engine with two fake decks (no real media): enough to drive onTrackError.
function streamingEngine() {
  const engine = new SoundEngine();
  const deck = () => ({ token: 0, gain: { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } },
    el: { attrs: { src: 'assets/music/x.mp3' }, src: 'assets/music/x.mp3', loop: false, currentTime: 0, plays: 0,
      getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; this.src = ''; }, load() {}, pause() {},
      play() { this.plays++; return Promise.resolve(); } } });
  engine.ctx = { currentTime: 1 };
  engine.decks = [deck(), deck()];
  engine.fileMode = true;
  engine.deckIndex = 0;
  engine.deckSrc = ['assets/music/x.mp3', null];
  engine.musicScene = 'run';
  return engine;
}

test('soundtrack hiccups never swap in the old procedural score once a track has played', () => {
  const engine = streamingEngine();
  const deck = engine.decks[0];
  engine.onTrackError(deck, { name: 'AbortError' });
  engine.onTrackError(deck, { name: 'NotAllowedError' });
  assert.equal(engine.fileMode, true, 'harmless play() rejections are ignored');
  assert.equal(engine.playBlocked, true, 'autoplay blocked: waits for a gesture');
  engine.resumeBlockedMusic();
  assert.equal(deck.el.plays, 1, 'the next gesture starts the deck again');
  engine.everStreamed = true;
  for (let i = 0; i < 12; i++) engine.onTrackError(deck, { code: 2 });
  clearTimeout(engine.trackRetry);
  assert.equal(engine.fileMode, true, 'network errors are retried, never a permanent fallback');
  assert.ok(engine.soundtrack.run.length > 0);
  engine.onTrackError(engine.decks[1], { code: 2 });
  assert.equal(engine.trackFailures, 12, 'errors from the deck fading out are ignored');
});

test('with no soundtrack file ever playing (missing files), the procedural score takes over after a few failures', () => {
  const engine = streamingEngine();
  engine.stopMusic = function () { this.fileMode = false; };
  let started = 0;
  engine.startMusic = () => { started++; };
  for (let i = 0; i < 5; i++) engine.onTrackError(engine.decks[0], { code: 4 });
  clearTimeout(engine.trackRetry);
  assert.equal(engine.fileMode, true, 'a few failures are retried first');
  engine.onTrackError(engine.decks[0], { code: 4 });
  assert.equal(engine.fileMode, false);
  assert.equal(engine.soundtrack.run.length, 0, 'procedural score');
  assert.equal(started, 1);
});

test('a sound effect file that fails to download is fetched again instead of staying procedural', async () => {
  const engine = new SoundEngine();
  engine.ctx = { decodeAudioData: (data, ok) => ok({ duration: 0.2 }) };
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; if (calls === 1) throw new Error('offline'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  try {
    engine.loadSamples(['enemy_hit']);
    for (let i = 0; i < 10 && !engine.samples.has('enemy_hit'); i++) await new Promise((r) => realTimeout(r, 5));
    assert.ok(engine.samples.has('enemy_hit'), 'loaded on the retry');
    assert.equal(engine.sampleFailures.has('enemy_hit'), false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
});
