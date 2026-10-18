// First-run TUTORIAL (js/tutorial.js + Game wiring in js/main.js): slides and their clips, input
// variants, markup, the seen flag (also with storage blocked), and the "re-check every minor version"
// rule that keeps the slides accurate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  TUTORIAL_REVIEWED_FOR, TUTORIAL_MEDIA_DIR, TUTORIAL_SEEN_KEY, TutorialUI, readTutorialSeen,
  tutorialDotsHTML, tutorialLineHTML, tutorialSlideHTML, tutorialSlides, writeTutorialSeen
} = await import('../js/tutorial.js');
const { GAME_VERSION } = await import('../js/version.js');
const { DEFAULT_TUNING } = await import('../js/config.js');
const { Game } = await import('../js/main.js');

const root = new URL('../', import.meta.url);
const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const blockedStorage = {
  getItem() { throw new DOMException('Storage unavailable', 'SecurityError'); },
  setItem() { throw new DOMException('Storage unavailable', 'SecurityError'); }
};

test('the slides were re-checked for this minor version (see the rule at the top of js/tutorial.js)', () => {
  const minor = GAME_VERSION.split('.').slice(0, 2).join('.');
  assert.equal(TUTORIAL_REVIEWED_FOR, minor,
    `GAME_VERSION is ${GAME_VERSION}: check every tutorial slide (text in js/tutorial.js, clips via npm run tutorial-media) `
    + `still matches the game, then set TUTORIAL_REVIEWED_FOR to '${minor}'.`);
});

test('every slide has a title, a short text, alt text and a clip on disk; the last one points to the Field Guide', () => {
  const slides = tutorialSlides(DEFAULT_TUNING);
  assert.ok(slides.length >= 4 && slides.length <= 8, 'keep the tutorial brief');
  assert.equal(new Set(slides.map(s => s.id)).size, slides.length);
  for (const slide of slides) {
    assert.ok(slide.title && slide.alt, slide.id);
    assert.ok(slide.lines.length >= 1 && slide.lines.length <= 3, `${slide.id}: one to three lines`);
    assert.ok(existsSync(new URL(TUTORIAL_MEDIA_DIR + slide.media, root)), `${slide.id}: missing ${TUTORIAL_MEDIA_DIR}${slide.media} (npm run tutorial-media)`);
    for (const line of slide.lines) {
      for (const input of ['keyboard', 'touch', 'pad']) {
        const text = tutorialLineHTML(line, input).replace(/<[^>]+>/g, '');
        assert.ok(text.length <= 150, `${slide.id}: keep lines short (${text.length} chars)`);
      }
    }
  }
  const last = slides.at(-1);
  assert.ok(last.final);
  assert.ok(last.lines.some(l => /FIELD GUIDE/.test(l)));
  assert.match(tutorialSlideHTML(last, slides.length - 1, slides.length), /data-tutorial-guide/);
});

test('numbers on the slides follow the tuning', () => {
  const text = (tuning) => JSON.stringify(tutorialSlides(tuning));
  assert.match(text({ ...DEFAULT_TUNING, weaponSlots: 6 }), /up to 6\)/);
  assert.match(text({ ...DEFAULT_TUNING, weaponSlots: 8 }), /up to 8\)/);
  assert.match(text({ ...DEFAULT_TUNING, lieutenantFirstWave: 4 }), /From wave 4/);
});

test('the controls line speaks the active input; markup is escaped and colored', () => {
  const controls = tutorialSlides(DEFAULT_TUNING)[0].lines[0];
  assert.match(tutorialLineHTML(controls, 'keyboard'), /<b>WASD<\/b>/);
  assert.match(tutorialLineHTML(controls, 'touch'), /<b>Left thumb<\/b>/);
  assert.match(tutorialLineHTML(controls, 'pad'), /<b>Left stick<\/b>/);
  assert.equal(tutorialLineHTML('a <b> & **c**'), 'a &lt;b&gt; &amp; <b>c</b>');
  assert.equal(tutorialLineHTML('[[gold:◆ x]] [[green:y]]'), '<b class="tut-gold">◆ x</b> <b class="tut-green">y</b>');
  assert.equal((tutorialDotsHTML(2, 5).match(/tutorial-dot/g) || []).length, 5);
  assert.match(tutorialDotsHTML(2, 5), /tutorial-dot active/);
});

test('the seen flag: first visit opens it, closing remembers it, blocked storage still works for the session', () => {
  const storage = memoryStorage();
  assert.equal(readTutorialSeen(storage), false);
  assert.equal(writeTutorialSeen(storage), true);
  assert.equal(storage.map.get(TUTORIAL_SEEN_KEY), '1');
  assert.equal(readTutorialSeen(blockedStorage), false);
  assert.equal(writeTutorialSeen(blockedStorage), false);
  assert.equal(readTutorialSeen(null), false);

  const ui = new TutorialUI({ storage: blockedStorage, slides: tutorialSlides(DEFAULT_TUNING) });
  assert.equal(ui.shouldAutoOpen(), true);
  assert.equal(new TutorialUI({ storage: { getItem: () => '1', setItem() {} } }).shouldAutoOpen(), false);
});

function installDom() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const classes = new Set(id === 'tutorial-modal' ? ['hidden'] : []);
      els.set(id, {
        id, innerHTML: '', textContent: '', disabled: false, listeners: {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        addEventListener(type, fn) { this.listeners[type] = fn; }
      });
    }
    return els.get(id);
  };
  globalThis.document = { getElementById: el, querySelectorAll: () => [], activeElement: null };
  return el;
}

test('TutorialUI: NEXT / BACK / skip, LET\'S FLY on the last slide, the Field Guide hand-off', () => {
  const el = installDom();
  const storage = memoryStorage();
  const reasons = [];
  let closed = 0, guide = 0;
  const ui = new TutorialUI({ storage, slides: tutorialSlides(DEFAULT_TUNING), getInput: () => 'touch', onClose: (r) => { closed++; reasons.push(r); }, onGuide: () => guide++ });
  const count = ui.slides.length;

  assert.equal(ui.open(), true);
  assert.equal(el('tutorial-modal').classList.contains('hidden'), false);
  assert.match(el('tutorial-body').innerHTML, /Left thumb/);
  assert.equal(el('btn-tutorial-prev').disabled, true);
  el('btn-tutorial-next').listeners.click();
  assert.equal(ui.index, 1);
  assert.equal(el('btn-tutorial-prev').disabled, false);
  el('btn-tutorial-prev').listeners.click();
  assert.equal(ui.index, 0);
  assert.equal(ui.go(-1), false);
  ui.go(count - 1);
  assert.equal(el('btn-tutorial-next').textContent, '🚀 LET\'S FLY');
  ui.next();
  assert.equal(closed, 1);
  assert.equal(el('tutorial-modal').classList.contains('hidden'), true);
  assert.equal(storage.map.get(TUTORIAL_SEEN_KEY), '1');
  assert.equal(ui.shouldAutoOpen(), false);

  // Reopened from a TUTORIAL button: SKIP closes it, the last slide's button opens the Field Guide.
  ui.open();
  assert.equal(ui.index, 0);
  el('btn-tutorial-skip').listeners.click();
  assert.equal(closed, 2);
  ui.open(count - 1);
  el('tutorial-body').listeners.click({ target: { closest: (sel) => (sel === '[data-tutorial-guide]' ? {} : null) } });
  assert.equal(closed, 3);
  assert.equal(guide, 1);
  assert.deepEqual(reasons, ['done', 'skip', 'guide']);
});

// A Game with just what the tutorial wiring touches.
function tutorialGame(storage) {
  const game = Object.assign(Object.create(Game.prototype), {
    state: 'TITLE', guideOpen: false, notesOpen: false, tutorialOpen: false, tutorialOnLaunch: false,
    sound: { init() {} }, menuNav: { clear() {} }, resetInput() {}, range: { active: false }
  });
  game.tutorial = new TutorialUI({ storage, slides: tutorialSlides(DEFAULT_TUNING), onClose: (r) => game.onTutorialClosed(r), onGuide: () => { game.guideOpened = true; } });
  return game;
}

test('the first LAUNCH on a device shows the tutorial first; closing it starts the run; never again once seen', () => {
  const el = installDom();
  const storage = memoryStorage();
  const game = tutorialGame(storage).enableFirstLaunchTutorial();
  assert.equal(el('tutorial-modal').classList.contains('hidden'), true, 'nothing opens before LAUNCH');

  Game.prototype.startGame.call(game);
  assert.equal(game.tutorialOpen, true, 'LAUNCH opens the tutorial');
  assert.equal(game.state, 'TITLE', 'the run waits for the tutorial');
  let launches = 0;
  game.startGame = () => { launches++; };
  game.tutorial.next();
  assert.equal(launches, 0);
  el('btn-tutorial-skip').listeners.click();
  assert.equal(game.tutorialOpen, false);
  assert.equal(launches, 1, 'SKIP carries on into the run');
  assert.equal(storage.map.get(TUTORIAL_SEEN_KEY), '1');

  // Seen: the next LAUNCH (also after a reload) goes straight into the run.
  const again = tutorialGame(storage).enableFirstLaunchTutorial();
  assert.equal(again.tutorial.shouldAutoOpen(), false);
  assert.equal(again.openTutorial({ launchAfter: true }) && again.tutorialLaunchAfter, true, 'TUTORIAL buttons still open it');
  again.closeTutorial();
});

test('first-launch tutorial: LET\'S FLY launches, Esc / B skip into the run, the Field Guide button stays on the title', () => {
  const el = installDom();
  for (const [how, close] of [
    ['done', (g) => { g.tutorial.go(g.tutorial.slides.length - 1); g.tutorial.next(); }],
    ['esc', (g) => g.handleTutorialKey({ code: 'Escape', preventDefault() {} }, false)],
    ['pad', (g) => { Object.assign(g, { gpActive: true, menuGrace: 0, menuState: 'TUTORIAL', menuNav: { clear() {}, update() {}, activate() {} } }); g.updateTutorialController({ pressed: (b) => b === 1, aimY: 0 }, 0.016); }],
    ['guide', (g) => el('tutorial-body').listeners.click({ target: { closest: (sel) => (sel === '[data-tutorial-guide]' ? {} : null) } })]
  ]) {
    const game = tutorialGame(memoryStorage()).enableFirstLaunchTutorial();
    Game.prototype.startGame.call(game);
    let launches = 0;
    game.startGame = () => { launches++; };
    close(game);
    assert.equal(game.tutorialOpen, false, how);
    assert.equal(launches, how === 'guide' ? 0 : 1, how);
    if (how === 'guide') assert.equal(game.guideOpened, true);
  }

  // Off unless the browser boot switches it on (headless tests and tools launch straight in), and a
  // tutorial replayed from a TUTORIAL button never launches a run.
  const plain = tutorialGame(memoryStorage());
  plain.state = 'PAUSED';
  let launches = 0;
  plain.startGame = () => { launches++; };
  assert.equal(plain.openTutorial(), true);
  plain.closeTutorial();
  assert.equal(launches, 0);
});

test('the page has the tutorial, a SKIP button, the replay hint and TUTORIAL buttons on the title (desktop + touch) and pause menu', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const id of ['tutorial-modal', 'tutorial-body', 'btn-tutorial-skip', 'btn-tutorial-prev', 'btn-tutorial-next', 'btn-title-tutorial', 'btn-pause-tutorial']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /data-m-proxy="btn-title-tutorial"/);
  assert.match(html, /class="tutorial-replay"[^>]*>[^<]*<b>🎓 TUTORIAL<\/b> on the title screen or in the pause menu/);
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  assert.match(main, /new Game\(\)\.enableFirstLaunchTutorial\(\)/);
});
