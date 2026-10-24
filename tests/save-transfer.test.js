// Save transfer (js/save-transfer.js): EXPORT / IMPORT SAVE codes and files, bundle validation, and the
// merge rules used when restoring a cloud save or importing onto a device that has progress of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBundle, encodeSaveCode, parseSaveText, validateBundle, summarizeSave, mergeSaves, saveWealth, hasMoreProgress,
  sanitizeSettings, readSettings, SETTINGS_KEYS, MAX_BUNDLE_BYTES, BUNDLE_SCHEMA, TOTAL_WEAPONS
} from '../js/save-transfer.js';
import { normalizeSave, META_UPGRADES, armoryCost, STARTING_CORES } from '../js/progression.js';
import { OPEN_WEAPONS } from '../js/unlock-goals.js';

// A save with progress: cores, a few Armory ranks (paid on the price curve), unlocks, guide and runs.
function pilot({ cores = 500, ranks = {}, kills = 0, weapons = [], seen = [], runs = 3, name = 'NOVA', scores = [] } = {}) {
  const paid = {};
  for (const [id, r] of Object.entries(ranks)) {
    let c = 0;
    for (let n = 0; n < r; n++) c += armoryCost(META_UPGRADES.find((u) => u.id === id), n);
    paid[id] = c;
  }
  return normalizeSave({
    ...normalizeSave({}), // a current save (its Armory version stamp), so nothing is reset
    pilotName: name, cores, ranks, paid, totalRuns: runs,
    unlocks: { stats: { kills }, weapons, fresh: [] }, guide: { seen, fresh: [] },
    highscores: scores
  });
}
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('export -> import round trip: a save code and a .json file both bring back the same save and settings', () => {
  const save = pilot({ cores: 1234, ranks: { damage: 5, maxHp: 3 }, kills: 4200, weapons: ['grenades'], seen: ['swarmer'] });
  const settings = { vexolith_master_vol: '0.8', vexolith_reduce_effects: '1', vexolith_tuning_overrides_v4: '{"x":1}', vexolith_weapon_range: 'x' };
  const bundle = buildBundle({ save, settings, version: '0.46.0' });
  assert.equal(bundle.schema, BUNDLE_SCHEMA);
  assert.deepEqual(Object.keys(bundle.settings).sort(), ['vexolith_master_vol', 'vexolith_reduce_effects'], 'dev tuning and the Weapon Range never travel');
  const code = encodeSaveCode(bundle);
  assert.match(code, /^VXSAVE1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const back = parseSaveText(`  ${code}\n`);
  assert.equal(back.error, undefined);
  assert.deepEqual(back.bundle.save, save);
  assert.deepEqual(back.bundle.settings, bundle.settings);
  const file = parseSaveText(JSON.stringify(bundle, null, 2));
  assert.deepEqual(file.bundle.save, save);
  const sum = summarizeSave(back.bundle.save);
  assert.equal(sum.cores, 1234);
  assert.equal(sum.unlocked, OPEN_WEAPONS.length + 1);
  assert.equal(sum.totalWeapons, TOTAL_WEAPONS);
  assert.equal(TOTAL_WEAPONS, 20);
  assert.equal(sum.armoryRanks, 8);
  // Settings read from a device: only the whitelist.
  const dev = memory({ vexolith_radar: '0', vexolith_global_outbox_v1: '[]', other: 'x' });
  assert.deepEqual(readSettings(dev), { vexolith_radar: '0' });
  assert.ok(SETTINGS_KEYS.every((k) => k.startsWith('vexolith_')));
});

test('a bad, damaged or tampered save code is rejected; a hand-edited save is cleaned, never trusted', () => {
  const code = encodeSaveCode(buildBundle({ save: pilot() }));
  const [p, payload, sum] = code.split('.');
  assert.match(parseSaveText(`${p}.${payload.slice(0, -4)}.${sum}`).error, /damaged/, 'cut short');
  const flipped = payload.slice(0, 20) + (payload[20] === 'A' ? 'B' : 'A') + payload.slice(21);
  assert.match(parseSaveText(`${p}.${flipped}.${sum}`).error, /damaged/, 'one character changed');
  assert.match(parseSaveText('hello').error, /not a save code/);
  assert.match(parseSaveText('').error, /nothing/);
  assert.match(parseSaveText('{"nope": 1}').error, /not a VEXOLITH/);
  assert.match(parseSaveText('{bad json').error, /not a save/);
  assert.match(validateBundle({ game: 'vexolith-survivor', schema: 99, save: {} }).error, /newer version/);
  assert.match(validateBundle({ game: 'vexolith-survivor', schema: 1 }).error, /missing/);
  assert.match(validateBundle({ game: 'vexolith-survivor', schema: 1, save: { junk: 'x'.repeat(MAX_BUNDLE_BYTES) } }).error, /too large/);
  // A re-checksummed edit still goes through normalizeSave: ranks are capped, unknown weapons dropped.
  const evil = { schema: 1, game: 'vexolith-survivor', save: { ...pilot(), ranks: { damage: 9999 }, unlocks: { weapons: ['grenades', 'deathray'], stats: { kills: -5 } } }, settings: { vexolith_tuning_overrides_v4: 'x', vexolith_radar: { o: 1 } } };
  const { bundle } = parseSaveText(JSON.stringify(evil));
  assert.equal(bundle.save.ranks.damage, META_UPGRADES.find((u) => u.id === 'damage').maxRank);
  assert.deepEqual(bundle.save.unlocks.weapons, ['grenades']);
  assert.equal(bundle.save.unlocks.stats.kills, undefined);
  assert.deepEqual(bundle.settings, {});
  assert.deepEqual(sanitizeSettings({ vexolith_radar: 'x'.repeat(201) }), {});
});

test('merge keeps the best of both: max counters and ranks, every unlock and guide entry, both run boards', () => {
  const a = pilot({ cores: 100, ranks: { damage: 6, magnet: 1 }, kills: 9000, weapons: ['grenades'], seen: ['swarmer'], runs: 10,
    scores: [{ id: 'a1', name: 'NOVA', score: 900, wave: 4, kills: 10, multiplier: 2, timeStr: '01:00', mode: 'normal' }] });
  const b = pilot({ cores: 800, ranks: { damage: 2, maxHp: 4 }, kills: 3000, weapons: ['gas', 'quake'], seen: ['gunner'], runs: 25,
    scores: [{ id: 'b1', name: 'NOVA', score: 5000, wave: 9, kills: 50, multiplier: 4, timeStr: '04:00', mode: 'normal' }] });
  const m = mergeSaves(a, b);
  assert.equal(m.pilotName, 'NOVA');
  assert.deepEqual([m.ranks.damage, m.ranks.maxHp, m.ranks.magnet], [6, 4, 1]);
  assert.equal(m.paid.damage, a.paid.damage, 'a rank keeps what it cost on the side it came from');
  assert.equal(m.unlocks.stats.kills, 9000);
  assert.deepEqual([...m.unlocks.weapons].sort(), ['gas', 'grenades', 'quake']);
  assert.deepEqual([...m.guide.seen].sort(), ['gunner', 'swarmer']);
  assert.equal(m.totalRuns, 25);
  assert.deepEqual(m.highscores.filter((h) => /^[ab]1$/.test(h.id)).map((h) => h.id), ['b1', 'a1']);
  assert.ok(hasMoreProgress(b, a), 'b has more runs and unlocks');
  assert.ok(!hasMoreProgress(m, m));
});

test('merge never duplicates Void Cores: wealth is the larger of the two, not the sum, and merging again adds nothing', () => {
  const a = pilot({ cores: 300, ranks: { damage: 6 } });
  const b = pilot({ cores: 900, ranks: { maxHp: 2 } });
  const m = mergeSaves(a, b);
  assert.equal(saveWealth(m), Math.max(saveWealth(a), saveWealth(b)), 'cores + Armory spend = the richer save, never a + b');
  assert.ok(saveWealth(m) < saveWealth(a) + saveWealth(b));
  assert.deepEqual(mergeSaves(m, b), m, 'restoring the same backup twice changes nothing');
  assert.deepEqual(mergeSaves(m, a), m);
  assert.deepEqual(mergeSaves(a, a), a, 'a save merged with itself is itself');
  // The merged ranks cost more than either side ever had: the wallet floors at 0, never goes negative.
  const rich = pilot({ cores: 0, ranks: { damage: 20 } });
  const rich2 = pilot({ cores: 0, ranks: { maxHp: 20 } });
  assert.equal(mergeSaves(rich, rich2).cores, 0);
  assert.equal(normalizeSave({}).cores, STARTING_CORES);
});
