import test from 'node:test';
import assert from 'node:assert/strict';

// v0.27 volume rescale: 100% on every slider is the reference mix, and settings saved on the old scale
// (raw gains) convert once to the same loudness.
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = undefined; // config.js would open a live channel and keep node running

test('old saved volumes (master 30%, music 1.30x, SFX 2.00x) become 100% / 100% / 100% at the same loudness', async () => {
  storage.set('vexolith_tuning_overrides_v4', JSON.stringify({ musicVolume: 1.3, sfxVolume: 2 }));
  storage.set('vectra_master_vol', '30');
  const config = await import('../js/config.js?volume-old');
  config.loadTuning();
  const { TUNING, VOLUME_REF } = config;
  assert.ok(Math.abs(TUNING.musicVolume - 1) < 1e-9 && Math.abs(TUNING.sfxVolume - 1) < 1e-9, 'music and SFX read 100%');
  const { SoundEngine } = await import('../js/audio.js?volume-old');
  const engine = new SoundEngine();
  assert.equal(engine.masterVolumePct, 100, 'master reads 100%');
  // Same loudness as before: master gain x bus gain is unchanged.
  assert.ok(Math.abs(engine.getMasterGainValue() - 0.85 * 0.3) < 1e-3);
  assert.ok(Math.abs(VOLUME_REF.music * TUNING.musicVolume - 1.3) < 1e-9);
  assert.ok(Math.abs(VOLUME_REF.sfx * TUNING.sfxVolume - 2) < 1e-9);
  // Converted once: loading again leaves the new values alone.
  config.loadTuning();
  assert.ok(Math.abs(TUNING.musicVolume - 1) < 1e-9);
  assert.equal(new SoundEngine().masterVolumePct, 100);
});
