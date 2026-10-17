import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Field Guide: unlock persistence + save normalization, encounter detection, coverage of every enemy
// type, and that every entry (cards, previews, silhouettes, tabs) renders without throwing.
// Browser services are stubbed; the tests drive the real modules.
globalThis.window = { addEventListener() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }
};
globalThis.BroadcastChannel = undefined;
const elements = new Map();
function element() {
  const classes = new Set(['hidden']);
  return {
    textContent: '', innerHTML: '', style: {}, offsetWidth: 0, value: '',
    get className() { return [...classes].join(' '); },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    appendChild() {}, addEventListener() {}
  };
}
globalThis.document = {
  activeElement: null,
  getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  createElement: element
};

const { Game } = await import('../js/main.js');
const { EnemyManager, contactDamageAt } = await import('../js/enemies.js');
const { ProgressionManager, normalizeSave, normalizeGuide } = await import('../js/progression.js');
const {
  HOSTILE_ENTRIES, HOSTILE_IDS, MECHANIC_ENTRIES, hostileStats, hostileStatRows, detectEncounters, guideIdsFor, weaponGuide, resolveText, waveScaleAt
} = await import('../js/field-guide.js');
const { GuidePreview, PREVIEW_IDS, drawSilhouette } = await import('../js/field-guide-scenes.js');
const { hostileCardHTML, tabHTML, GUIDE_TABS } = await import('../js/field-guide-ui.js');
const { ARCHETYPE_INFO, WAVE_PACKS } = await import('../js/archetypes.js');
const { UPGRADE_POOL } = await import('../js/upgrades.js');
const { TUNING, DEFAULT_TUNING } = await import('../js/config.js');

const SAVE_KEY = 'vectra_survivor_save_v2';
const silent = new Proxy({}, { get: () => () => {} });
const resetTuning = () => Object.assign(TUNING, DEFAULT_TUNING);

// Records nothing, returns itself for gradients/patterns, so any drawing code can run headless.
const fakeCtx = () => {
  const calls = { stroke: 0, fill: 0 };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'stroke' || key === 'fill') return () => { calls[key]++; };
      return () => ctx;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  ctx.calls = calls;
  return ctx;
};

test('old saves load with an empty field guide, and guide data is normalized', () => {
  const legacy = normalizeSave({ cores: 40, ranks: { damage: 2 } });
  assert.deepEqual(legacy.guide, { seen: [], fresh: [] });
  assert.equal(legacy.cores, 40);
  assert.deepEqual(normalizeGuide(null), { seen: [], fresh: [] });
  assert.deepEqual(normalizeGuide({ seen: 'bruiser', fresh: 7 }), { seen: [], fresh: [] });
  const messy = normalizeGuide({
    seen: ['bruiser', 5, 'BAD ID', 'bruiser', 'x'.repeat(41), 'future_enemy', null],
    fresh: ['bruiser', 'gunner', 'future_enemy']
  });
  assert.deepEqual(messy.seen, ['bruiser', 'future_enemy'], 'well-formed ids survive, junk and duplicates are dropped');
  assert.deepEqual(messy.fresh, ['bruiser', 'future_enemy'], 'NEW badges only for unlocked entries');
});

test('guide unlocks persist in the existing save key and NEW badges clear once viewed', () => {
  store.clear();
  store.set(SAVE_KEY, JSON.stringify({ cores: 12, pilotName: 'ACE' })); // a save from before the guide existed
  const prog = new ProgressionManager();
  assert.equal(prog.data.cores, 12);
  assert.deepEqual(prog.unlockGuideEntries(['bruiser', 'gunner', 'bruiser']), ['bruiser', 'gunner']);
  assert.deepEqual(prog.unlockGuideEntries(['bruiser']), [], 'an unlocked entry never unlocks twice');
  assert.equal(prog.isGuideUnlocked('gunner'), true);

  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.deepEqual(saved.guide, { seen: ['bruiser', 'gunner'], fresh: ['bruiser', 'gunner'] });
  assert.equal(saved.cores, 12, 'the rest of the save is untouched');

  const reloaded = new ProgressionManager();
  assert.deepEqual(reloaded.data.guide.seen, ['bruiser', 'gunner']);
  reloaded.markGuideViewed(['bruiser']);
  assert.deepEqual(new ProgressionManager().data.guide, { seen: ['bruiser', 'gunner'], fresh: ['gunner'] });
});

test('encounters: hostiles in (or just outside) the camera view are detected, once, by guide id', () => {
  const view = { x: 1000, y: 1000, w: 1280, h: 720 };
  const enemies = [
    { type: 'swarmer', x: 1200, y: 1200, radius: 10 },
    { type: 'swarmer', x: 1300, y: 1250, radius: 10 },
    { type: 'gunner', x: 3000, y: 3000, radius: 14 }, // far off-screen
    { type: 'bruiser', x: 990, y: 1100, radius: 35, isLieutenant: true }, // hull pokes into view
    { type: 'boss', x: 2200, y: 1500, radius: 36, isBoss: true },
    { type: 'not_a_real_enemy', x: 1100, y: 1100, radius: 5 }
  ];
  assert.deepEqual(detectEncounters(enemies, view, () => false), ['swarmer', 'lieutenant', 'bruiser', 'boss']);
  assert.deepEqual(detectEncounters(enemies, view, id => id !== 'boss'), ['boss'], 'known entries are skipped');
  assert.deepEqual(guideIdsFor({ type: 'gunner', isLieutenant: true }), ['lieutenant', 'gunner']);
});

function guideGame(enemies = []) {
  store.clear();
  const g = Object.assign(Object.create(Game.prototype), {
    progression: new ProgressionManager(),
    enemyManager: { enemies },
    camX: 0, camY: 0, width: 1280, height: 720,
    state: 'PLAYING', guideScanTick: 0, guideToastTimer: 0, ltCardTimer: 0, seenArchetypes: new Set()
  });
  return g;
}

test('in a run, a first sighting is saved and raises the FIELD GUIDE UPDATED toast', () => {
  const g = guideGame([{ type: 'weaver', x: 300, y: 300, radius: 13 }, { type: 'gunner', x: 5000, y: 5000, radius: 14 }]);
  for (let i = 0; i < 6; i++) g.updateFieldGuide(1 / 60);
  assert.deepEqual(g.progression.data.guide.seen, ['weaver']);
  assert.ok(g.guideToastTimer > 2, 'toast is up');
  g.updateGuideToast();
  assert.equal(document.getElementById('guide-toast').classList.contains('hidden'), false);
  assert.match(document.getElementById('guide-toast-text').textContent, /EMERALD WEAVER/);
  assert.match(document.getElementById('guide-badge-pause').textContent, /1 NEW/);

  // Scanning is throttled to every few ticks, and a known hostile never toasts again.
  g.guideToastTimer = 0;
  for (let i = 0; i < 12; i++) g.updateFieldGuide(1 / 60);
  assert.equal(g.guideToastTimer, 0);
  assert.equal(JSON.parse(store.get(SAVE_KEY)).guide.seen[0], 'weaver');
});

test('the NEW HOSTILE SIGNATURE card logs the archetype and links to the guide', () => {
  const g = guideGame();
  g.announceArchetype('blinker');
  assert.equal(g.progression.isGuideUnlocked('blinker'), true);
  assert.equal(g.ltCard.kind, 'intel');
  assert.match(g.ltCard.link, /NEW FIELD GUIDE ENTRY/);
  assert.equal(g.guideToastTimer, 0, 'the intel card replaces the toast for archetypes');
  // Next run: already logged, the card still points at the guide.
  g.seenArchetypes = new Set();
  g.announceArchetype('blinker');
  assert.match(g.ltCard.link, /IN YOUR FIELD GUIDE/);
});

test('every enemy type the game can spawn has a guide entry and a preview', () => {
  // Static: every getArchetype case, every archetype and every queued spawn literal in the game code.
  const enemiesSrc = readFileSync(new URL('../js/enemies.js', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const types = new Set([
    ...[...enemiesSrc.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]),
    ...Object.keys(ARCHETYPE_INFO),
    ...[...mainSrc.matchAll(/queueSpawn\('([a-z_]+)'/g)].map(m => m[1]),
    ...[...mainSrc.matchAll(/spread\('([a-z_]+)'/g)].map(m => m[1])
  ]);
  for (const type of types) assert.ok(HOSTILE_IDS.includes(type), `no Field Guide entry for enemy type "${type}"`);

  // Dynamic: force every wave pack at a late wave and check what actually gets queued.
  const queued = new Set();
  for (const pack of WAVE_PACKS) {
    resetTuning();
    for (const p of WAVE_PACKS) TUNING[p.weightKey] = p.id === pack.id ? 1 : 0;
    const em = new EnemyManager();
    const g = Object.assign(Object.create(Game.prototype), {
      enemyManager: em, wave: 12, worldWidth: 4200, worldHeight: 4200,
      spawnAroundPlayer: () => ({ x: 2000, y: 2000 }), announceArchetype() {}
    });
    g.spawnWavePack();
    assert.ok(em.spawnIndicators.length > 0, `pack ${pack.id} spawned nothing`);
    em.spawnIndicators.forEach(sp => queued.add(sp.type));
  }
  resetTuning();
  for (const type of queued) assert.ok(HOSTILE_IDS.includes(type), `pack spawns "${type}" with no guide entry`);
  for (const id of ['lieutenant', 'boss', 'mini_splitter']) assert.ok(HOSTILE_IDS.includes(id));
  assert.deepEqual([...PREVIEW_IDS].sort(), [...HOSTILE_IDS].sort(), 'every entry has an animated preview');
});

test('guide stats come from the real spawn config and game formulas', () => {
  resetTuning();
  const em = new EnemyManager();
  for (const id of HOSTILE_IDS.filter(id => id !== 'lieutenant' && id !== 'boss')) {
    const cfg = em.getArchetype(id, 1);
    const s = hostileStats(id);
    assert.equal(s.hp, Math.round(cfg.maxHp), `${id} HP`);
    assert.equal(s.speed, Math.round(cfg.speed * 60), `${id} speed`);
    assert.equal(s.contact, Math.round(contactDamageAt(cfg, 1)), `${id} contact`);
  }
  assert.equal(hostileStats('bruiser').contact, 27);
  assert.equal(hostileStats('boss').hp, Math.round(650 * waveScaleAt(3)));
  assert.equal(hostileStats('gunner').unlockWave, ARCHETYPE_INFO.gunner.unlockWave);
  const g = Object.assign(Object.create(Game.prototype), { wave: 9 });
  assert.equal(g.contactDamage({ contactMult: 1.5 }), contactDamageAt({ contactMult: 1.5 }, 9), 'one contact formula');
  assert.equal(waveScaleAt(8), Game.prototype.getWaveScale.call({ wave: 8 }));
  TUNING.enemyHpMult = 2;
  assert.equal(hostileStats('swarmer').hp, 20, 'the tuner HP multiplier shows in the guide');
  resetTuning();
});

test('every entry renders: cards (locked and unlocked), tabs, previews and silhouettes', () => {
  for (const entry of HOSTILE_ENTRIES) {
    const open = hostileCardHTML(entry, { unlocked: true, fresh: true });
    assert.ok(open.includes(entry.name) && open.includes('NEW') && open.includes('HOW TO BEAT IT'), entry.id);
    assert.doesNotMatch(open, /undefined|NaN/, entry.id);
    const locked = hostileCardHTML(entry, { unlocked: false });
    assert.ok(locked.includes('???') && !locked.includes(entry.name), `${entry.id} stays hidden while locked`);
    assert.ok(hostileStatRows(entry.id).length >= 3);
    assert.ok(resolveText(entry.what).length > 20 && resolveText(entry.tip).length > 20);
  }
  for (const m of MECHANIC_ENTRIES) {
    for (const p of m.body()) assert.doesNotMatch(p, /undefined|NaN/, m.id);
  }
  for (const tab of GUIDE_TABS) {
    const html = tabHTML(tab.id, { isUnlocked: () => true, isFresh: () => false, levels: { multishot: 2 } });
    assert.ok(html.length > 500, tab.id);
    assert.doesNotMatch(html, /undefined|NaN/, tab.id);
  }
  // Previews run the real AI and draw code headless for a full loop and more.
  for (const id of HOSTILE_IDS) {
    const preview = new GuidePreview(id);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => {
      for (let i = 0; i < 60 * 14; i++) {
        preview.step();
        if (i % 7 === 0) preview.draw(ctx, 0.6);
      }
    }, id);
    assert.ok(ctx.calls.stroke > 50, `${id} preview draws`);
    assert.ok(preview.manager.enemies.length + preview.manager.spawnIndicators.length <= 40, `${id} stays small`);
    const sctx = fakeCtx();
    assert.doesNotThrow(() => drawSilhouette(sctx, id, 320, 180), `${id} silhouette`);
    assert.ok(sctx.calls.stroke > 0, `${id} silhouette draws`);
  }
});

test('preview scenes actually show the behaviour they describe', () => {
  const run = (id, seconds, probe) => {
    const p = new GuidePreview(id);
    let seen = false;
    for (let i = 0; i < seconds * 60 && !seen; i++) {
      p.step();
      seen = probe(p);
    }
    return seen;
  };
  assert.ok(run('bruiser', 6, p => p.manager.enemies.some(e => e.state === 'charge')), 'bruiser charges');
  assert.ok(run('gunner', 6, p => p.manager.enemyBullets.active.length > 0), 'gunner fires an orb');
  assert.ok(run('shielder', 8, p => p.manager.enemies.some(e => e.shieldFlash > 0)), 'shielder plates block a bolt');
  assert.ok(run('blinker', 8, p => p.manager.enemies.some(e => e.state === 'telegraph')), 'blinker telegraphs');
  assert.ok(run('conduit', 6, p => p.manager.enemies.some(e => e.linked > 0)), 'conduit links an ally');
  assert.ok(run('splitter', 8, p => p.manager.enemies.some(e => e.type === 'mini_splitter')), 'splitter bursts into minis');
  assert.ok(run('boss', 4, p => p.manager.enemies.some(e => e.isBoss)), 'boss arrives after its warning');
  assert.ok(run('lieutenant', 4, p => p.manager.enemies.some(e => e.isLieutenant)), 'lieutenant arrives');
  assert.ok(run('blackhole', 4, p => p.tug > 0), 'vortex tugs the ship');
});

test('weapons tab is a thin adapter: every upgrade card is listed, new cards appear automatically', () => {
  const html = tabHTML('weapons');
  for (const u of UPGRADE_POOL) assert.ok(html.includes(`data-entry="${u.id}"`), `${u.id} missing from WEAPONS`);
  assert.ok(html.includes('WING ROCKETS') && html.includes('PEW PEWS'), 'starting kit comes from the loadout registry');
  const fake = [...UPGRADE_POOL, { id: 'plasma_whip', name: 'Plasma Whip', category: 'MELEE', tags: ['kinetic'], maxLevel: 4, summary: 'Lashes nearby hulls.' }];
  const g = weaponGuide({ plasma_whip: 2 }, fake);
  const whip = g.categories.find(c => c.id === 'MELEE').items[0];
  assert.deepEqual([whip.name, whip.owned, whip.tags[0].label], ['Plasma Whip', 2, 'KINETIC']);
  assert.ok(g.rarity.some(r => r.id === 'legendary') && g.tags.some(t => t.id === 'electric'));
});

test('keys pressed in the guide never activate the screen behind it', () => {
  const resume = { id: 'btn-resume-game', tagName: 'BUTTON', focus() { document.activeElement = this; } };
  const inside = { tagName: 'BUTTON', focus() { document.activeElement = this; } };
  let scrolled = 0;
  const g = Object.assign(Object.create(Game.prototype), {
    state: 'PAUSED', guideOpen: true,
    fieldGuide: {
      root: { contains: el => el === inside, querySelectorAll: () => [inside] },
      body: { clientHeight: 400 },
      scrollBy: dy => { scrolled += dy; },
      cycleTab() {}, setTab() {}
    },
    closeGuide() { this.guideOpen = false; }
  });
  const key = (code) => {
    const e = { code, repeat: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    g.handleGuideKey(e, document.activeElement?.tagName === 'BUTTON');
    return e;
  };
  document.activeElement = resume;
  assert.equal(key('Enter').prevented, true, 'Enter on RESUME behind the guide is swallowed');
  const space = key('Space');
  assert.ok(space.prevented && scrolled > 0, 'Space scrolls the guide instead of clicking RESUME');
  assert.equal(key('Tab').prevented, true);
  assert.equal(document.activeElement, inside, 'Tab pulls focus back into the guide');
  assert.equal(key('Enter').prevented, false, 'Enter on a guide control still clicks it');
  assert.equal(g.state, 'PAUSED');
  document.activeElement = null;
});
