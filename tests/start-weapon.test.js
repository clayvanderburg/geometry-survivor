import test from 'node:test';
import assert from 'node:assert/strict';

// Starting weapon pick: after LAUNCH (or RESTART) a pop-up offers the direct damage dealers; the run
// starts with the chosen one, and the pick is remembered. The headless harness stubs the DOM.
const h = await import('../tools/balance/harness.mjs');
const { START_WEAPON_CHOICES, STARTING_WEAPONS, START_WEAPON_STORAGE_KEY, readStartWeapon, writeStartWeapon, ownedWeapons, weaponLevel } = await import('../js/loadout.js');

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const key = (code) => ({ code, repeat: false, preventDefault() {} });
// startGame paints the first frame: give the headless game a do-nothing canvas context.
const launchable = (g) => Object.assign(g, { ctx: new Proxy({}, { get: () => () => {} }) });

test('the pick offers the direct damage dealers; the last pick is stored and read back safely', () => {
  assert.deepEqual(START_WEAPON_CHOICES, ['blaster', 'rockets', 'missiles', 'raillance', 'harpoon', 'glaive', 'drones', 'turret']);
  assert.deepEqual(STARTING_WEAPONS, ['blaster'], 'headless runs and tools keep the Autocannon');
  const s = memoryStorage();
  assert.equal(readStartWeapon(s), 'blaster', 'nothing stored: Autocannon');
  writeStartWeapon(s, 'missiles');
  assert.equal(s.getItem(START_WEAPON_STORAGE_KEY), 'missiles');
  assert.equal(readStartWeapon(s), 'missiles');
  s.setItem(START_WEAPON_STORAGE_KEY, 'gas');
  assert.equal(readStartWeapon(s), 'blaster', 'not on the list: Autocannon');
  assert.equal(readStartWeapon({ getItem() { throw new Error('blocked'); } }), 'blaster', 'blocked storage');
});

test('a run starts with exactly the picked weapon at LV 1', () => {
  for (const id of START_WEAPON_CHOICES) {
    const g = h.createHeadlessGame();
    g.resetRun('normal', id);
    assert.deepEqual(ownedWeapons(g.player), [id]);
    assert.equal(weaponLevel(g.player, id), 1);
  }
  const g = h.createHeadlessGame();
  g.resetRun('normal', 'singularity');
  assert.deepEqual(ownedWeapons(g.player), ['blaster'], 'anything else: the default kit');
});

test('LAUNCH opens the pick first; a pick starts the run with it, BACK returns with nothing changed', () => {
  const g = launchable(h.createHeadlessGame());
  g.state = 'TITLE';
  g.startGame();
  assert.equal(g.state, 'PLAYING', 'without the pop-up enabled (tools, tests) the run starts at once');

  const t = launchable(h.createHeadlessGame()).enableStartPick();
  t.state = 'TITLE';
  t.startGame();
  assert.equal(t.startPickOpen, true);
  assert.equal(t.state, 'TITLE', 'the run has not started');
  assert.equal(t.startPickCards.length, START_WEAPON_CHOICES.length);
  t.cancelStartPick();
  assert.equal(t.startPickOpen, false);
  assert.equal(t.state, 'TITLE');

  t.startGame();
  t.handleStartPickKey(key('Digit3'), false); // [3]: Swarm Missiles
  assert.equal(t.state, 'PLAYING');
  assert.equal(t.startPickOpen, false);
  assert.deepEqual(ownedWeapons(t.player), ['missiles']);
  assert.equal(t.startWeapon, 'missiles');

  // Restart: the pick opens again with the last weapon lit; arrows move it, Enter launches.
  t.state = 'GAMEOVER';
  t.startGame();
  assert.equal(t.startPickIndex, START_WEAPON_CHOICES.indexOf('missiles'));
  t.handleStartPickKey(key('ArrowRight'), false);
  t.handleStartPickKey(key('Enter'), false);
  assert.deepEqual(ownedWeapons(t.player), ['raillance'], 'the arrow moves to the next card');
  // From the last card, the arrow wraps round to the first.
  t.state = 'GAMEOVER';
  t.startWeapon = START_WEAPON_CHOICES.at(-1);
  t.startGame();
  t.handleStartPickKey(key('ArrowRight'), false);
  t.handleStartPickKey(key('Enter'), false);
  assert.deepEqual(ownedWeapons(t.player), ['blaster'], 'wraps round to the first card');
  // Esc backs out.
  t.state = 'GAMEOVER';
  t.startGame();
  t.handleStartPickKey(key('Escape'), false);
  assert.equal(t.startPickOpen, false);
  assert.equal(t.state, 'GAMEOVER');
});

test('the Weapon Range never shows the pick', () => {
  const g = launchable(h.createHeadlessGame()).enableStartPick();
  g.state = 'TITLE';
  g.range = { active: true, onRunStart() {}, exit() {} };
  g.startGame();
  assert.equal(g.startPickOpen, undefined);
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(ownedWeapons(g.player), ['blaster']);
});
