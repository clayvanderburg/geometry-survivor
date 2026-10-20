import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../js/sfx-layers.js');

// A fake engine: records every call, and claimVoice uses the real gap/voice-cap rules from audio.js.
function fakeAudio() {
  const log = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param() });
  let clock = 0;
  const audio = {
    enabled: true, sfxGain: node(), log,
    ctx: { get currentTime() { return clock; }, createGain: node, createBiquadFilter: () => ({ ...node(), type: '' }) },
    tick(s) { clock += s; },
    noiseSource: () => ({ ...node(), start: (...a) => log.push(['noise.start', ...a]), stop() {} }),
    playSample: (name, opts) => log.push(['sample', name, opts]),
    tone: (...a) => log.push(['tone', ...a]),
    voices: {},
    claimVoice(key, gapMs, maxVoices, dur) {
      const v = this.voices[key] ||= { last: -Infinity, ends: [] };
      if (clock * 1000 - v.last < gapMs) return false;
      v.ends = v.ends.filter(e => e > clock);
      if (v.ends.length >= maxVoices) return false;
      v.last = clock * 1000;
      v.ends.push(clock + dur);
      return true;
    }
  };
  return audio;
}

test('the ladder climbs while hits keep coming, caps at the top and resets after a gap', () => {
  let t = 0;
  const l = new S.PitchLadder({ scale: [0, 4, 7], resetMs: 100, now: () => t });
  assert.deepEqual([l.next(), (t += 50, l.next()), (t += 50, l.next()), (t += 50, l.next())], [0, 4, 7, 7]);
  assert.equal(l.progress, 1);
  t += 500;
  assert.equal(l.next(), 0);
  assert.equal(S.semis(12), 2);
  assert.ok(Math.abs(S.semis(7) - 1.4983) < 1e-3);
});

test('jitter stays inside its spread', () => {
  assert.equal(S.jitter(0.1, () => 0), 0.9);
  assert.equal(S.jitter(0.1, () => 1), 1.1);
  assert.equal(S.jitter(0.1, () => 0.5), 1);
});

test('a layered sound plays every layer once, pitched, under one shared voice cap', () => {
  const a = fakeAudio();
  const layers = [{ sample: 'boom', volume: 0.5 }, { tone: 200, dur: 0.1, vol: 0.2, glideTo: 100 }, { noise: 0.1, freq: 1000 }];
  assert.equal(S.playLayered(a, layers, { key: 'k', maxVoices: 1, dur: 0.2, pitch: 2, spread: 0 }), true);
  assert.deepEqual(a.log.map(e => e[0]), ['sample', 'tone', 'noise.start']);
  assert.equal(a.log[0][2].rate, 2);
  assert.equal(a.log[1][1], 400, 'tone pitched');
  assert.equal(a.log[1][6], 200, 'glide pitched too');
  // The cap holds the whole stack: no partial second copy.
  assert.equal(S.playLayered(a, layers, { key: 'k', maxVoices: 1, dur: 0.2 }), false);
  assert.equal(a.log.length, 3);
  a.tick(0.3);
  assert.equal(S.playLayered(a, layers, { key: 'k', maxVoices: 1, dur: 0.2 }), true);
});

test('nothing plays with audio off, no context or no layers', () => {
  const a = fakeAudio();
  a.enabled = false;
  assert.equal(S.playLayered(a, [{ tone: 100 }]), false);
  assert.equal(S.playLayered(null, [{ tone: 100 }]), false);
  assert.equal(S.playLayered(fakeAudio(), []), false);
  assert.equal(S.playPreset(fakeAudio(), 'nope'), false);
});

test('every preset plays on a working engine', () => {
  for (const name of Object.keys(S.SFX_PRESETS)) {
    const a = fakeAudio();
    assert.equal(S.playPreset(a, name), true, name);
    assert.equal(a.log.length, S.SFX_PRESETS[name].layers.length, name);
  }
});
