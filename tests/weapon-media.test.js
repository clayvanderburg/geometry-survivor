// Weapon Range clips (js/weapon-media.js, recorded by tools/weapon-media.cjs): every weapon and every
// Breakthrough has one on disk, the Field Guide's weapon cards show theirs, and the Breakthrough pick
// shows the TRANSFORM's clip (the generic boost card has none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { WEAPONS } = await import('../js/loadout.js');
const { BREAKTHROUGH_LEVELS, TRANSFORMS, EXTRA_TRANSFORMS, transformPool } = await import('../js/weapon-levels.js');
const { weaponClip, breakthroughClip, transformClip, clipHTML } = await import('../js/weapon-media.js');
const { tabHTML } = await import('../js/field-guide-ui.js');
const { describeBreakthrough, renderUpgradeCard } = await import('../js/upgrade-cards.js');
const h = await import('../tools/balance/harness.mjs');

const root = new URL('../', import.meta.url);
const onDisk = (src) => existsSync(new URL(src, root));

test('every weapon and every Breakthrough has a clip on disk (npm run weapon-media)', () => {
  const missing = [];
  for (const w of WEAPONS) {
    if (!onDisk(weaponClip(w.id))) missing.push(weaponClip(w.id));
    for (const lv of BREAKTHROUGH_LEVELS) {
      assert.ok(TRANSFORMS[w.id]?.[lv], `${w.id} has a Breakthrough at LV ${lv}`);
      if (!onDisk(breakthroughClip(w.id, lv))) missing.push(breakthroughClip(w.id, lv));
    }
  }
  for (const [id, list] of Object.entries(EXTRA_TRANSFORMS)) {
    for (const t of transformPool(id).filter((x) => list.some((e) => e.id === x.id))) if (!onDisk(transformClip(id, t))) missing.push(transformClip(id, t));
  }
  assert.deepEqual(missing, [], 'record the missing clips with npm run weapon-media');
});

test('the Field Guide WEAPONS tab shows every weapon\'s clip; UPGRADES shows none', () => {
  const html = tabHTML('weapons');
  for (const w of WEAPONS) assert.ok(html.includes(`src="${weaponClip(w.id)}"`), `${w.id} clip on its card`);
  assert.ok(!tabHTML('upgrades').includes('weapon-clip'));
});

test('the Breakthrough TRANSFORM card plays its clip; the boost card has none', () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  const p = g.player;
  const transform = renderUpgradeCard(describeBreakthrough(p, 'rockets', 12, 'transform'), '1').html;
  const boost = renderUpgradeCard(describeBreakthrough(p, 'rockets', 12, 'boost'), '2').html;
  assert.ok(transform.includes(`src="${breakthroughClip('rockets', 12)}"`));
  assert.ok(!boost.includes('weapon-clip'));
});

test('clip markup is lazy, sized and escaped', () => {
  const html = clipHTML('assets/weapons/x.webp', 'A "quoted" <name>');
  assert.match(html, /loading="lazy"/);
  assert.match(html, /width="360" height="202"/);
  assert.ok(html.includes('alt="A &quot;quoted&quot; &lt;name>"'));
});
