// DR. PIXIE on the radio (js/pixie.js, js/radio.js, her portrait in js/portraits.js): the line pools
// (size, length, moods, every Breakthrough covered), the per-run no-repeat shuffle, the reactions to a
// pick, the non-pausing radio queue, and the Game wiring (Breakthrough hooks, off in headless runs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  PIXIE_OFFER_LINES, PIXIE_WEAPON_LINES, PIXIE_PICK_LINES, PIXIE_TRANSFORM_LINES, PIXIE_BOOST_LINES, PIXIE_MAX_CHARS,
  LineBag, PixieDirector, fillLine
} = await import('../js/pixie.js');
const pixieMod = await import('../js/pixie.js');
const { RadioBox } = await import('../js/radio.js');
const { drawPixie, PIXIE_MOODS } = await import('../js/portraits.js');
const { TRANSFORMS } = await import('../js/weapon-levels.js');
const { WEAPONS } = await import('../js/loadout.js');
const { CAST } = await import('../js/story.js');
const { Game } = await import('../js/main.js');

const root = new URL('../', import.meta.url);
const root_ = root;
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const weaponNames = WEAPONS.map((w) => w.name);
const transformNames = Object.values(TRANSFORMS).flatMap((t) => Object.values(t).map((x) => x.name));

test('30+ Eureka lines, all short and PG-sized once filled in, each with a real mood', () => {
  assert.ok(PIXIE_OFFER_LINES.length >= 30, `${PIXIE_OFFER_LINES.length} offer lines`);
  const all = [
    ...PIXIE_OFFER_LINES.flatMap(([t, m]) => weaponNames.map((w) => [fillLine(t, { weapon: w }), m])),
    ...Object.values(PIXIE_WEAPON_LINES).flat(),
    ...Object.values(PIXIE_PICK_LINES),
    ...PIXIE_TRANSFORM_LINES.flatMap(([t, m]) => transformNames.map((n) => [fillLine(t, { name: n }), m])),
    ...PIXIE_BOOST_LINES
  ];
  for (const [text, mood] of all) {
    assert.ok(text.length <= PIXIE_MAX_CHARS, `too long (${text.length}): ${text}`);
    assert.ok(PIXIE_MOODS.includes(mood), `${text}: mood ${mood}`);
    assert.doesNotMatch(text, /\{\w+\}/, `unfilled: ${text}`);
  }
  assert.equal(new Set(PIXIE_OFFER_LINES.map(([t]) => t)).size, PIXIE_OFFER_LINES.length, 'no duplicate lines');
  for (const key of Object.keys(PIXIE_PICK_LINES)) {
    const [w, id] = key.split(':');
    assert.ok(Object.values(TRANSFORMS[w] || {}).some((t) => t.id === id), `${key} is a real Breakthrough`);
  }
  for (const w of Object.keys(PIXIE_WEAPON_LINES)) assert.ok(TRANSFORMS[w], `${w} is a weapon with Breakthroughs`);
  assert.ok(CAST.pixie && CAST.pixie.portrait === 'pixie');
});

test('the shuffle bag: every line once before any repeat, never the same line twice in a row', () => {
  const lines = ['a', 'b', 'c', 'd', 'e'];
  for (let seed = 1; seed < 40; seed++) {
    const bag = new LineBag(lines, seeded(seed));
    const draws = Array.from({ length: 50 }, () => bag.next());
    for (let k = 0; k < 50; k += 5) assert.equal(new Set(draws.slice(k, k + 5)).size, 5, 'each pass covers the pool');
    for (let k = 1; k < 50; k++) assert.notEqual(draws[k], draws[k - 1], `seed ${seed}: repeat at ${k}`);
  }
});

test('Pixie cheers the offer (with the Eureka flourish) and reacts to the pick, cutting her own line short', () => {
  const said = [];
  let eurekas = 0;
  const pixie = new PixieDirector({ radio: { say: (l) => said.push(l) }, sound: { playEureka: () => eurekas++ }, rng: seeded(3) });
  const offer = pixie.offer('turret', 'Sentry Turret');
  assert.equal(offer.who, 'pixie');
  said[0].onStart();
  assert.equal(eurekas, 1);
  const level = Number(Object.keys(TRANSFORMS.turret).find((l) => TRANSFORMS.turret[l].id === 'capacity'));
  assert.equal(pixie.picked({ weaponId: 'turret', level, kind: 'transform' }).text, PIXIE_PICK_LINES['turret:capacity'][0]);
  assert.equal(said[1].cut, true, 'the reaction hurries the Eureka line along');
  const boost = pixie.picked({ weaponId: 'turret', level, kind: 'boost' }).text;
  assert.ok(PIXIE_BOOST_LINES.some(([t]) => t === boost));
  const generic = pixie.picked({ weaponId: 'gas', level: 6, kind: 'transform' }).text;
  assert.match(generic, new RegExp(TRANSFORMS.gas[6].name));
  // A whole run of offers never repeats a line back to back.
  for (let i = 0, last = null; i < 80; i++) {
    const t = pixie.offer('blaster', 'Autocannon').text;
    assert.notEqual(t, last);
    last = t;
  }
});

test('the radio never blocks: one line on air, at most one waiting (newest wins), lines leave by themselves', () => {
  const shown = [];
  const box = {
    typing: false, idleTime: 0, root: null,
    show(l) { shown.push(l.text); this.typing = true; this.t = 0; },
    update(dt) { this.t += dt; if (this.t > 0.3) this.typing = false; this.idleTime = this.typing ? 0 : this.t - 0.3; },
    advance() { this.typing = false; this.t = 0.3; },
    hide() { shown.push('(hidden)'); }
  };
  const radio = new RadioBox({ box });
  radio.say({ who: 'pixie', text: 'one' });
  radio.say({ who: 'pixie', text: 'two' });
  radio.say({ who: 'pixie', text: 'three', cut: true });
  assert.equal(box.typing, false, 'cut types the line on air out at once');
  for (let i = 0; i < 60 * 8; i++) radio.update(1 / 60);
  assert.deepEqual(shown, ['one', 'three', '(hidden)']);
  assert.equal(radio.onAir, false);
  radio.say({ who: 'pixie', text: 'four' });
  radio.clear();
  assert.equal(radio.onAir, false);
});

test('her portrait draws every mood and talk frame', () => {
  let fills = 0;
  const ctx = { fillStyle: '', fillRect() { fills++; } };
  for (const mood of PIXIE_MOODS) for (const mouth of [0, 1, 2]) drawPixie(ctx, { t: 0.5, mood, mouth, talking: mouth > 0 });
  assert.ok(fills > 1000);
});

test('Game: the Breakthrough pick and choice call Pixie; the radio is off unless the browser boot turns it on', () => {
  const g = Object.assign(Object.create(Game.prototype), { radioOn: false, radio: { say: () => true } });
  assert.equal(g.say('pixie', 'hi'), false, 'headless runs stay silent');
  g.radioOn = true;
  assert.equal(g.say('pixie', 'hi'), true);
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  assert.match(main, /openNextBreakthrough\(\) \{[\s\S]*?this\.pixie\?\.offer\(id, name\)/);
  assert.match(main, /applyBreakthrough\(p, upg\.weaponId, upg\.level, upg\.option\);\s*this\.pixie\?\.picked\(upg\)/);
  assert.match(main, /\.showSplash\(\)\.enableStoryRadio\(\)/);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const id of ['radio-box', 'radio-portrait', 'radio-name', 'radio-text']) assert.match(html, new RegExp(`id="${id}"`));
});

test('on the Breakthrough pick Pixie docks big into the free card column, and leaves it before the grid is cleared', () => {
  const el = (cls = '') => {
    const node = {
      className: cls, children: [], parentNode: null, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      appendChild(c) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = node; node.children.push(c); return c; },
      insertBefore(c) { return node.appendChild(c); },
      remove() { node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = null; }
    };
    return node;
  };
  const home = el('game'), root = el('radio'), grid = el('grid');
  home.appendChild(root);
  globalThis.document = { createElement: () => el() };
  const radio = new RadioBox({ box: { bind: () => true, root, show() {}, hide() {} } });
  assert.equal(radio.dock(grid), true);
  assert.equal(radio.docked, true);
  assert.equal(grid.children[0].children[0], root, 'in its own grid cell, beside the cards');
  assert.ok(root.classList.contains('radio-docked'));
  radio.undock();
  assert.equal(root.parentNode, home, 'back in its corner for the reaction');
  assert.equal(grid.children.length, 0);
  assert.equal(root.classList.contains('radio-docked'), false);
  delete globalThis.document;

  const main = readFileSync(new URL('js/main.js', root_), 'utf8');
  assert.match(main, /this\.radio\?\.undock\(\);[^\n]*\n\s*const container = document\.getElementById\('upgrade-choices'\)/);
  assert.match(main, /this\.radio\.dock\(document\.getElementById\('upgrade-choices'\)\)[\s\S]{0,200}this\.pixie\?\.offer\(id, name\)/);
  const css = readFileSync(new URL('css/style.css', root_), 'utf8');
  for (const px of [216, 144]) assert.match(css, new RegExp(`radio-docked \\.dialogue-portrait \\{ width: ${px}px`), `${px} px: whole multiples of the 72 px art`);
});

test('the first rift of a save: Pixie explains it in 2–3 short lines, once, never in BLITZ; the first jump gets a line after it', () => {
  const { PIXIE_RIFT_LINES, PIXIE_RIFT_JUMP_LINE, PIXIE_RIFT_SEEN_KEY, PIXIE_RIFT_JUMP_KEY } = pixieMod;
  assert.ok(PIXIE_RIFT_LINES.length >= 2 && PIXIE_RIFT_LINES.length <= 3);
  for (const [t, m] of [...PIXIE_RIFT_LINES, PIXIE_RIFT_JUMP_LINE]) {
    assert.ok(t.length <= PIXIE_MAX_CHARS, t);
    assert.ok(PIXIE_MOODS.includes(m));
  }
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const shown = [];
  const box = {
    typing: false, idleTime: 0, root: null,
    show(l) { shown.push(l.text); this.typing = true; this.t = 0; },
    update(dt) { this.t += dt; if (this.t > 0.3) this.typing = false; this.idleTime = this.typing ? 0 : this.t - 0.3; },
    advance() { this.typing = false; this.t = 0.3; }, hide() {}
  };
  const radio = new RadioBox({ box });

  // Headless (no radio) and BLITZ: nothing, and nothing marked seen.
  assert.equal(new PixieDirector({ storage }).riftOpened('normal'), false);
  const pixie = new PixieDirector({ radio, storage, rng: seeded(2) });
  assert.equal(pixie.riftOpened('blitz'), false);
  assert.equal(pixie.riftJumped('normal'), false, 'no jump line before the explanation');
  assert.equal(map.size, 0);

  assert.equal(pixie.riftOpened('normal'), true);
  assert.equal(pixie.riftJumped('hardcore'), true, 'a jump mid-explanation waits its turn');
  for (let i = 0; i < 60 * 30; i++) radio.update(1 / 60);
  assert.deepEqual(shown, [...PIXIE_RIFT_LINES.map(([t]) => t), PIXIE_RIFT_JUMP_LINE[0]]);
  assert.equal(map.get(PIXIE_RIFT_SEEN_KEY), '1');
  assert.equal(map.get(PIXIE_RIFT_JUMP_KEY), '1');

  // Once per save: a fresh director (a new session) with the same storage stays quiet.
  const later = new PixieDirector({ radio, storage });
  assert.equal(later.riftOpened('normal'), false);
  assert.equal(later.riftJumped('normal'), false);
  // Storage blocked: once per page load.
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const b = new PixieDirector({ radio, storage: blocked });
  assert.equal(b.riftOpened('normal'), true);
  assert.equal(b.riftOpened('normal'), false);

  const rifts = readFileSync(new URL('js/rifts.js', root_), 'utf8');
  assert.match(rifts, /game\.onRiftOpened\?\.\(r\)/);
  assert.match(rifts, /game\.onRiftJump\?\.\(rift\)/);
});

const PIXIE_RIFT_LINES_FOR_PACING = pixieMod.PIXIE_RIFT_LINES[0][0];
test('radio lines are paced for slow readers: slow typing and a long hold', async () => {
  const { RADIO_CPS, radioHold } = await import('../js/radio.js');
  assert.ok(RADIO_CPS <= 32, 'types slower than the cutscene box');
  const line = PIXIE_RIFT_LINES_FOR_PACING;
  assert.ok(radioHold(line) >= 4, `a ${line.length}-char line stays up at least 4 s after typing`);
  assert.ok(radioHold('Hi!') >= 1.6);
});

test('the first time the shield drops to 30%: Pixie warns once per save, never in BLITZ or HARDCORE', () => {
  const { PIXIE_LOW_SHIELD_LINES, PIXIE_LOW_SHIELD_KEY } = pixieMod;
  for (const [t, m] of PIXIE_LOW_SHIELD_LINES) {
    assert.ok(t.length <= PIXIE_MAX_CHARS, t);
    assert.ok(PIXIE_MOODS.includes(m));
  }
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const said = [];
  const pixie = new PixieDirector({ radio: { say: (l) => said.push(l), append() {} }, storage });
  assert.equal(pixie.lowShield('blitz'), false);
  assert.equal(pixie.lowShield('hardcore'), false);
  assert.equal(map.size, 0);
  assert.equal(pixie.lowShield('normal'), true);
  assert.equal(said.length, 1);
  assert.equal(said[0].text, PIXIE_LOW_SHIELD_LINES[0][0]);
  assert.deepEqual(said[0].then.map(l => l.text), PIXIE_LOW_SHIELD_LINES.slice(1).map(([t]) => t));
  assert.equal(map.get(PIXIE_LOW_SHIELD_KEY), '1');
  assert.equal(pixie.lowShield('normal'), false, 'once per save');

  // Game wiring: only a hit that leaves the shield at or under 30% (and alive) calls her.
  let calls = 0;
  const g = Object.assign(Object.create(Game.prototype), {
    player: { x: 0, y: 0, hp: 100, maxHp: 100, radius: 15 }, multiplier: 1, mode: 'normal',
    pixie: { lowShield: () => { calls++; } },
    sound: new Proxy({}, { get: () => () => {} }), particles: new Proxy({}, { get: () => () => {} }), grid: new Proxy({}, { get: () => () => {} }),
    addShake() {}
  });
  g.damagePlayer(60);
  assert.equal(calls, 0, '40% left: no warning');
  g.damagePlayer(15);
  assert.equal(calls, 1, '25% left: warning');
  g.damagePlayer(30);
  assert.equal(calls, 1, 'a killing hit does not warn');
});

test('the first boss: Pixie plugs her Supernova bombs instead of the banner (radio on, not BLITZ)', () => {
  const { PIXIE_NOVA_LINES } = pixieMod;
  for (const [t, m] of PIXIE_NOVA_LINES) {
    assert.ok(t.includes('{key}') && t.replace('{key}', 'NOVA').length <= PIXIE_MAX_CHARS, t);
    assert.ok(PIXIE_MOODS.includes(m));
  }
  assert.equal(new PixieDirector({ storage: null }).novaReminder('normal', 'E'), false, 'radio off: the banner shows');
  const said = [];
  const pixie = new PixieDirector({ radio: { say: (l) => said.push(l) }, storage: null, rng: seeded(4) });
  assert.equal(pixie.novaReminder('blitz', 'E'), false);
  assert.equal(pixie.novaReminder('normal', 'B'), true);
  assert.match(said[0].text, /SUPERNOVA/);
  assert.match(said[0].text, /\bB!/);
});
