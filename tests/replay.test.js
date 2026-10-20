import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayRecorder, ReplayPlayer } from '../js/replay.js';

// Snapshot canvases without a DOM: they remember size and how often they were painted.
const fakeCanvas = () => {
  const c = { width: 0, height: 0, paints: 0 };
  c.getContext = () => ({ drawImage() { c.paints++; } });
  return c;
};
const source = { width: 1280, height: 720 };

test('the recorder keeps a capped ring of downscaled snapshots at its frame rate', () => {
  let made = 0;
  const rec = new ReplayRecorder({ seconds: 2, fps: 10, width: 320, tail: 0.5, createCanvas: () => { made++; return fakeCanvas(); } });
  for (let i = 0; i < 600; i++) rec.record(source, 1 / 60); // 10 s at 60 fps
  assert.equal(rec.count, rec.capacity);
  assert.equal(made, rec.capacity, 'canvases are recycled once the ring is full');
  assert.equal(rec.slots[0].canvas.width, 320);
  assert.equal(rec.slots[0].canvas.height, 180);
  rec.markDeath();
  for (let i = 0; i < 30; i++) rec.record(source, 1 / 60); // the blast after the hit
  const clip = rec.takeClip();
  assert.ok(clip.frames.length >= 20 && clip.frames.length <= 26);
  assert.ok(clip.start >= clip.deathT - 2 - 1e-9);
  assert.ok(clip.end > clip.deathT);
  for (let i = 1; i < clip.frames.length; i++) assert.ok(clip.frames[i].t > clip.frames[i - 1].t, 'oldest first');
  assert.equal(rec.count, 0, 'taking the clip starts a fresh tape');
  rec.record(source, 1 / 60);
  assert.ok(!clip.frames.some((f) => f.canvas === rec.slots[0].canvas), 'a new run never paints over the clip');
});

test('no DOM, no tape: the recorder disables itself quietly', () => {
  const rec = new ReplayRecorder({ createCanvas: () => null });
  rec.record(source, 1);
  assert.equal(rec.disabled, true);
  assert.equal(rec.takeClip(), null);
});

test('playback slows into the fatal hit, holds, rewinds and loops', () => {
  const rec = new ReplayRecorder({ seconds: 3, fps: 15, width: 64, createCanvas: fakeCanvas });
  for (let i = 0; i < 240; i++) rec.record(source, 1 / 60);
  rec.markDeath();
  for (let i = 0; i < 50; i++) rec.record(source, 1 / 60);
  const player = new ReplayPlayer(rec.takeClip());
  const seen = new Set();
  let slowmo = false;
  let last = player.timecode();
  assert.match(last, /^T-00:0\d\.\d$/);
  for (let i = 0; i < 60 * 20; i++) {
    player.update(1 / 60);
    seen.add(player.phase);
    if (player.slowmo) slowmo = true;
    assert.ok(player.frame(), 'always a frame to show');
  }
  assert.ok(slowmo);
  assert.deepEqual([...seen].sort(), ['hold', 'play', 'rewind']);
});
