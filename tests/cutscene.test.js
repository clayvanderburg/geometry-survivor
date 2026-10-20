// CUTSCENES (js/cutscene.js, js/dialogue.js, js/story.js, Game wiring in js/main.js): typewriter maths,
// the timeline player (blocking / background steps, advance, skip), the opening scene's script and
// length, the seen flag (also with storage blocked), and that headless runs never see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const { typedLength, typeDuration, blipAt, mouthFrame, readHold, registerSpeaker, DialogueBox } = await import('../js/dialogue.js');
const { Cutscene, estimateDuration, validateScript } = await import('../js/cutscene.js');
const { OPENING_SCENE, SCENES, CAST, INTRO_SEEN_KEY, MINER_NAME, readIntroSeen, writeIntroSeen, registerStoryCast } = await import('../js/story.js');
const { CutsceneStage } = await import('../js/cutscene-stage.js');
const { MINER_PORTRAIT_SRC } = await import('../js/portraits.js');
const { Game } = await import('../js/main.js');

const root = new URL('../', import.meta.url);
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const blockedStorage = {
  getItem() { throw new DOMException('Storage unavailable', 'SecurityError'); },
  setItem() { throw new DOMException('Storage unavailable', 'SecurityError'); }
};

test('typewriter: characters appear over typeDuration, punctuation adds a beat, blips skip spaces', () => {
  const text = 'Hi, pal. Go!';
  assert.equal(typedLength(text, 0), 0);
  assert.equal(typedLength(text, typeDuration(text)), text.length);
  assert.ok(typeDuration('a, b') > typeDuration('a  b'), 'a comma holds the line a moment');
  for (let t = 0, last = 0; t < 1; t += 0.01) {
    const n = typedLength(text, t);
    assert.ok(n >= last);
    last = n;
  }
  assert.equal(blipAt('a b', 1), false, 'no blip on a space');
  assert.equal(blipAt('ab', 0), true);
  assert.equal(blipAt('▼◆', 0), true, 'alien glyphs blip too');
  assert.equal(mouthFrame(1.23, false), 0, 'the mouth closes once the line is typed');
  assert.ok([0, 1, 2].includes(mouthFrame(0.2, true)));
  assert.ok(readHold('x'.repeat(500)) <= 2.6, 'a read hold stays short');
});

test('timeline: steps block in order, background steps run alongside, lines auto-advance or advance on input', () => {
  registerSpeaker('tester', { name: 'T' });
  const log = [];
  const box = new DialogueBox();
  let ends = [];
  const scene = new Cutscene({
    steps: [
      { do: 'mark', id: 'a', wait: false, time: 5 },
      { do: 'wait', time: 0.5 },
      { do: 'mark', id: 'b' },
      { do: 'say', who: 'tester', text: 'Hello there.' },
      { do: 'say', who: 'tester', text: 'Second.', auto: false },
      { do: 'mark', id: 'c', time: 0.2 }
    ]
  }, { actions: { mark: (s) => { log.push(s.id); } }, dialogue: box, onEnd: (r) => ends.push(r) }).start();
  assert.deepEqual(log, ['a'], 'a background step starts and the wait blocks');
  for (let i = 0; i < 40; i++) scene.update(1 / 60);
  assert.deepEqual(log, ['a', 'b']);
  assert.equal(box.line.text, 'Hello there.');
  for (let i = 0; i < 60 * 5; i++) scene.update(1 / 60);
  assert.equal(box.line.text, 'Second.', 'the first line auto-advanced after its read hold');
  for (let i = 0; i < 60 * 5; i++) scene.update(1 / 60);
  assert.equal(box.line.text, 'Second.', 'auto: false waits for the player');
  assert.equal(scene.advance(), true);
  scene.update(1 / 60);
  for (let i = 0; i < 20; i++) scene.update(1 / 60);
  assert.deepEqual(log, ['a', 'b', 'c']);
  assert.deepEqual(ends, ['done']);
  assert.equal(scene.active, false);

  // Advance mid-typing completes the line first; skip ends at once.
  ends = [];
  const s2 = new Cutscene([{ do: 'say', who: 'tester', text: 'A long line of words.' }, { do: 'wait', time: 9 }], { dialogue: box, onEnd: (r) => ends.push(r) }).start();
  s2.update(0.05);
  assert.equal(box.typing, true);
  s2.advance();
  assert.equal(box.typing, false, 'the first press finishes the typing');
  s2.skip();
  assert.deepEqual(ends, ['skip']);
});

test('the opening scene: a valid script, about 30–45 s, the full cast, a warp-in, the miner gets the last word', () => {
  registerStoryCast();
  const actions = new CutsceneStage({ sound: null }).actions();
  assert.deepEqual(validateScript(OPENING_SCENE, { actions }), []);
  const t = estimateDuration(OPENING_SCENE);
  assert.ok(t >= 30 && t <= 45, `opening runs ${t.toFixed(1)} s`);
  const lines = OPENING_SCENE.steps.filter((s) => s.do === 'say');
  assert.deepEqual([...new Set(lines.map((s) => s.who))].sort(), ['dispatch', 'miner', 'vex']);
  for (const s of lines) assert.ok(CAST[s.who], s.who);
  assert.equal(lines.at(-1).who, 'miner');
  for (const s of lines) assert.ok(s.text.length <= 90, `keep lines punchy: "${s.text}"`);
  const kinds = OPENING_SCENE.steps.map((s) => s.do);
  assert.ok(kinds.indexOf('gates') > kinds.indexOf('tremor') && kinds.indexOf('swarm') > kinds.indexOf('gates'));
  assert.equal(kinds.at(-1), 'cut', 'it ends on a hard cut');
  assert.ok(MINER_NAME.length > 0);
  assert.equal(SCENES.opening, OPENING_SCENE, 'Game.playCutscene(id) finds scenes by id');
  assert.ok(lines.filter((s) => s.who === 'vex').every((s) => !/[a-z]/i.test(s.text)), 'the Vex never speak our language');
  assert.ok(existsSync(new URL(MINER_PORTRAIT_SRC, root)), 'the miner portrait is on disk');
});

test('the intro seen flag: stored, read back, and harmless with storage blocked', () => {
  const s = memoryStorage();
  assert.equal(readIntroSeen(s), false);
  assert.equal(writeIntroSeen(s), true);
  assert.equal(s.map.get(INTRO_SEEN_KEY), '1');
  assert.equal(readIntroSeen(s), true);
  assert.equal(readIntroSeen(blockedStorage), false);
  assert.equal(writeIntroSeen(blockedStorage), false);
});

// A Game with just what the intro wiring touches.
function introGame() {
  return Object.assign(Object.create(Game.prototype), {
    state: 'TITLE', guideOpen: false, notesOpen: false, tutorialOpen: false, startPickOpen: false, introSeen: false,
    sound: { init() {} }, menuNav: { clear() {} }, resetInput() {}, resetRun() { this.resets = (this.resets || 0) + 1; }, closeMobileWindows() {},
    range: { active: false }
  });
}

test('first LAUNCH plays the intro (then carries on into the run); off unless the browser boot switches it on', () => {
  const g = introGame().enableFirstLaunchIntro();
  let played = null;
  g.cutscene = { active: false, play: (script, { onEnd }) => { played = { script, onEnd }; return true; } };
  let launches = 0;
  const realStart = Game.prototype.startGame;
  g.startGame = function (...a) { launches++; return realStart.apply(this, a); };
  Object.assign(g, { deathSeq: null, syncDeathContinue() {}, replayRec: { reset() {} }, tutorialOnLaunch: false });
  g.startGame();
  assert.equal(g.state, 'CUTSCENE');
  assert.equal(played.script, OPENING_SCENE);
  // The scene ends: seen, and LAUNCH carries on (stubbed past here).
  g.startGame = () => { launches++; };
  played.onEnd('skip');
  assert.equal(g.introSeen, true);
  assert.equal(g.state, 'TITLE');
  assert.equal(launches, 2, 'the run launches after the intro');

  // Seen: no replay on LAUNCH. Replayed from INTRO: back to the title, no run.
  const again = introGame().enableFirstLaunchIntro();
  again.introSeen = true;
  let replay = null;
  again.cutscene = { active: false, play: (s, { onEnd }) => { replay = onEnd; return true; } };
  let toTitle = 0;
  again.returnToTitle = () => { toTitle++; };
  assert.equal(again.playIntro(), true);
  replay('done');
  assert.equal(toTitle, 1);

  // Headless: a Game that was never switched on never plays it.
  assert.equal(introGame().introOnLaunch, undefined);
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  assert.match(main, /\.enableFirstLaunchIntro\(\)\.enableStartPick\(\)\.showSplash\(\)/, 'only the browser boot turns it on');
});

test('the page has the cutscene layer, dialogue box, SKIP and INTRO buttons (desktop + touch); tools pre-mark it seen', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const id of ['cutscene-layer', 'dialogue-box', 'dialogue-portrait', 'dialogue-name', 'dialogue-text', 'btn-cutscene-skip', 'cutscene-fade', 'cutscene-card', 'btn-title-intro']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /data-m-proxy="btn-title-intro"/);
  for (const tool of ['tutorial-media', 'weapon-media', 'leaderboard-smoke', 'soak-validate', 'frame-capture']) {
    assert.match(readFileSync(new URL(`tools/${tool}.cjs`, root), 'utf8'), /vexolith_intro_seen/, tool);
  }
});
