import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
globalThis.Event ??= class { constructor(type) { this.type = type; } };
const { readGamepad, pickInDirection, MenuNavigator, PAD } = await import('../js/gamepad.js');

const rect = (left, top, width = 100, height = 40) => ({ left, top, width, height });
function setPad(pressed = [], axes = [0, 0, 0, 0]) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) }));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [{ connected: true, axes, buttons }] } });
}
function fakeEl(r, extra = {}) {
  const classes = new Set();
  return {
    clicks: 0, ...extra,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) },
    getClientRects: () => [r], getBoundingClientRect: () => r,
    click() { this.clicks++; }, dispatchEvent() {}
  };
}
const root = (els) => ({ querySelectorAll: () => els });

test('press edges fire once per physical press', () => {
  setPad([PAD.A]);
  const first = readGamepad([]);
  assert.equal(first.pressed(PAD.A), true);
  assert.equal(readGamepad(first.buttons).pressed(PAD.A), false);
});

test('d-pad and left stick both produce menu directions', () => {
  setPad([PAD.DOWN]);
  assert.equal(readGamepad().navY, 1);
  setPad([], [-0.9, 0, 0, 0]);
  assert.equal(readGamepad().navX, -1);
  setPad([], [0.3, 0, 0, 0]);
  assert.equal(readGamepad().navX, 0, 'small stick drift must not navigate');
});

test('directional pick prefers the item in line over a diagonal one', () => {
  const from = rect(0, 0);
  const rects = [rect(300, 0), rect(150, 120), rect(-300, 0)];
  assert.equal(pickInDirection(from, rects, 1, 0), 0);
  assert.equal(pickInDirection(from, rects, 0, 1), 1);
  assert.equal(pickInDirection(from, rects, -1, 0), 2);
  assert.equal(pickInDirection(from, rects, 0, -1), -1);
});

test('navigator focuses the primary control, moves with auto-repeat, and activates', () => {
  const left = fakeEl(rect(0, 0)), mid = fakeEl(rect(200, 0)), right = fakeEl(rect(400, 0));
  const nav = new MenuNavigator();
  const idle = { navX: 0, navY: 0 }, east = { navX: 1, navY: 0 };
  nav.update(root([left, mid, right]), idle, 1 / 60, mid);
  assert.equal(nav.focused, mid);
  assert.ok(mid.classList.has('gp-focus'));
  nav.update(root([left, mid, right]), east, 1 / 60, mid);
  assert.equal(nav.focused, right);
  nav.update(root([left, mid, right]), idle, 1 / 60, mid);
  nav.update(root([left, mid, right]), { navX: -1, navY: 0 }, 1 / 60, mid);
  nav.update(root([left, mid, right]), { navX: -1, navY: 0 }, 1 / 60, mid);
  assert.equal(nav.focused, mid, 'held direction waits for the repeat delay');
  nav.activate();
  assert.equal(mid.clicks, 1);
});

test('left/right on a focused slider changes its value instead of moving focus', () => {
  const slider = fakeEl(rect(0, 0), { type: 'range', min: '0', max: '2', step: '0.1', value: '1' });
  const other = fakeEl(rect(200, 0));
  const nav = new MenuNavigator();
  nav.update(root([slider, other]), { navX: 1, navY: 0 }, 1 / 60, slider);
  assert.equal(nav.focused, slider);
  assert.equal(Number(slider.value), 1.2);
  nav.activate();
  assert.equal(slider.clicks, 0);
});

test('pressing A to launch a run does not also dash on the next tick', async () => {
  const g = {};
  const launch = fakeEl(rect(0, 0));
  launch.click = () => { g.game.state = 'PLAYING'; };
  const element = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} });
  globalThis.document = { getElementById: (id) => (id === 'title-modal' ? root([launch]) : id === 'btn-start-game' ? launch : element()), createElement: element };
  const { Game } = await import('../js/main.js');
  setPad([PAD.A]);
  g.game = Object.assign(Object.create(Game.prototype), {
    state: 'TITLE', gpButtons: [], gpActive: true, menuNav: new MenuNavigator(), menuState: 'TITLE', menuGrace: 0,
    grid: { update() {} }, particles: { update() {} }, sound: { init() {} }, shake: 0, chromaFlash: 0, shieldRotation: 0,
    camX: 0, camY: 0, width: 1280, height: 720
  });
  g.game.update(1 / 60);
  assert.equal(g.game.state, 'PLAYING');
  assert.equal(g.game.gpDashLatch, true, 'held A is latched, so gameplay will not read it as a fresh dash');
});

test('a lifted focused card never makes its neighbour count as "down": the button below wins', () => {
  // Four cards in a row; the focused second card is lifted 5 px (hover/focus transform); REROLL sits
  // below, between cards 2 and 3.
  const card = (left, top) => ({ left, top, width: 287, height: 396 });
  const cards = [card(49, 173), card(348, 168), card(646, 173), card(945, 173)];
  const reroll = { left: 570, top: 586, width: 276, height: 39 };
  assert.equal(pickInDirection(cards[1], [...cards, reroll], 0, 1), 4);
  // Nothing in the cone: still falls back to whatever lies on that side.
  assert.equal(pickInDirection(card(0, 0), [card(900, 10)], 0, 1), 0);
});

test('left / right stays in its row: stacked rows of small pills never trade focus sideways', () => {
  // MODE pills above VERSION pills (leaderboard panel): from v0.X.Y, LEFT is ALL-TIME, not HARDCORE above-left.
  const pill = (left, top, width = 76) => ({ left, top, width, height: 20 });
  const normal = pill(825, 110, 70), hardcore = pill(900, 110, 82), blitz = pill(988, 110, 54);
  const allTime = pill(845, 133), current = pill(928, 133);
  assert.equal(pickInDirection(current, [normal, hardcore, blitz, allTime], -1, 0), 3);
  assert.equal(pickInDirection(hardcore, [normal, blitz, allTime, current], -1, 0), 0);
  // Nothing further along the row: the old rule still finds the item on that side.
  assert.equal(pickInDirection(allTime, [normal, hardcore], -1, 0), 0);
});

test('navRect: a button scrolled out of its panel sits on the panel edge, so it never steals a move', async () => {
  const { navRect } = await import('../js/gamepad.js');
  const box = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
  const panel = { ...box(0, 0, 500, 400), parentElement: null, style: { overflowX: 'hidden', overflowY: 'auto' } };
  const hidden = { ...box(20, 600, 200, 30), parentElement: panel };
  const seen = { ...box(20, 100, 200, 30), parentElement: panel };
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el) => el.style || { overflowX: 'visible', overflowY: 'visible' };
  try {
    assert.deepEqual(navRect(hidden), { left: 20, top: 400, width: 200, height: 0 });
    assert.deepEqual(navRect(seen), { left: 20, top: 100, width: 200, height: 30 });
    // LAUNCH-style row below the panel: the hidden panel button is no longer "in its row".
    const launch = { left: 300, top: 590, width: 200, height: 50 }, blitz = { left: 80, top: 595, width: 100, height: 40 };
    assert.equal(pickInDirection(launch, [navRect(hidden), blitz], -1, 0), 1);
  } finally {
    globalThis.getComputedStyle = saved;
  }
});

test('up / down goes to the nearest row: an offset row between two lined-up buttons is never skipped', () => {
  // Pause menu at 1280x720: RESUME, then TUTORIAL + FIELD GUIDE side by side, then a full-width PATCH NOTES.
  const resume = { left: 43, top: 541, width: 365, height: 45 };
  const tutorial = { left: 43, top: 594, width: 158, height: 35 };
  const guide = { left: 209, top: 594, width: 199, height: 35 };
  const notes = { left: 43, top: 637, width: 365, height: 38 };
  assert.equal(pickInDirection(resume, [tutorial, guide, notes], 0, 1), 1, 'Down from RESUME: FIELD GUIDE, not PATCH NOTES');
  assert.equal(pickInDirection(notes, [resume, tutorial, guide], 0, -1), 2, 'Up from PATCH NOTES: FIELD GUIDE, not RESUME');
  assert.equal(pickInDirection(guide, [resume, tutorial, notes], 0, 1), 2);
});
