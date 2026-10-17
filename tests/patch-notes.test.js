// PATCH NOTES screen (js/patch-notes.js + Game wiring in js/main.js): HTML, NEW badge, open/close,
// keyboard/controller close, and booting with storage blocked.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;

const {
  NOTES_SEEN_KEY, PatchNotesUI, freshVersions, groupNotes, hasUnseenNotes, notesEntryHTML, patchNotesHTML, readSeenVersion, writeSeenVersion
} = await import('../js/patch-notes.js');
const { CHANGELOG } = await import('../js/changelog.js');
const { GAME_VERSION } = await import('../js/version.js');
const { PAD } = await import('../js/gamepad.js');
const { Game } = await import('../js/main.js');

const memoryStorage = (init = {}) => {
  const map = new Map(Object.entries(init));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const blockedStorage = {
  getItem() { throw new DOMException('Storage unavailable', 'SecurityError'); },
  setItem() { throw new DOMException('Storage unavailable', 'SecurityError'); }
};

// Small DOM stand-in: elements by id plus [data-notes-badge] / [data-game-version] lookups.
function fakeElement(id) {
  const classes = new Set(id === 'notes-modal' ? ['hidden'] : []);
  return {
    id, innerHTML: '', textContent: '', scrollTop: 0, clientHeight: 400, listeners: {}, focused: 0, children: [],
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c))
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    focus() { this.focused++; globalThis.document.activeElement = this; },
    contains(el) { return el === this || this.children.includes(el); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getClientRects() { return [1]; }
  };
}
function installDom() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); };
  const badges = [get('badge-title'), get('badge-pause')];
  const tags = [get('tag-title'), get('tag-pause')];
  get('notes-modal').children.push(get('notes-body'), get('btn-notes-close'));
  globalThis.document = {
    activeElement: null,
    getElementById: get,
    querySelectorAll: (sel) => (sel === '[data-notes-badge]' ? badges : sel === '[data-game-version]' ? tags : [])
  };
  return { get, badges, tags };
}

test('notes HTML: newest version expanded at the top, older ones collapsed, NEW marks, notes grouped by type', () => {
  const html = patchNotesHTML(CHANGELOG, { expanded: new Set([GAME_VERSION]), fresh: new Set([GAME_VERSION]) });
  const articles = html.match(/<article [^>]+>/g);
  assert.equal(articles.length, CHANGELOG.length);
  assert.match(articles[0], new RegExp(`class="notes-entry open fresh latest" data-version="${GAME_VERSION}"`));
  for (const a of articles.slice(1)) assert.doesNotMatch(a, /\bopen\b|\bfresh\b/);
  assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
  assert.equal((html.match(/class="notes-sections"[^>]*hidden/g) || []).length, CHANGELOG.length - 1, 'older versions start collapsed');
  assert.equal((html.match(/data-notes-toggle=/g) || []).length, CHANGELOG.length, 'every version header is a button (controller focus stop)');
  assert.ok(html.indexOf(`v${GAME_VERSION}`) < html.indexOf(`v${CHANGELOG[1].version}`), 'newest first');
  assert.match(html, /CURRENT/);

  const entry = { version: '1.2.3', date: '2026-01-01', title: 'A <b>bold</b> "test"', notes: [
    { type: 'fix', text: 'Fixed <it>' }, { type: 'new', text: 'Added a thing' }, { type: 'balance', text: 'Rockets 4× faster' }
  ] };
  const one = notesEntryHTML(entry, { open: true });
  assert.ok(one.indexOf('>NEW<') < one.indexOf('>BALANCE<') && one.indexOf('>BALANCE<') < one.indexOf('>FIXES<'), 'NEW, BALANCE, FIXES order');
  assert.match(one, /A &lt;b&gt;bold&lt;\/b&gt; &quot;test&quot;/, 'escaped');
  assert.match(one, /Fixed &lt;it&gt;/);
  assert.match(one, /3 CHANGES/);
  assert.deepEqual(groupNotes(entry.notes).map(g => g.label), ['NEW', 'BALANCE', 'FIXES']);
  assert.deepEqual(groupNotes([{ type: 'fix', text: 'x' }]).map(g => g.type), ['fix'], 'empty groups dropped');
});

test('NEW badge rule: any stored version other than the current one (or none) is unseen', () => {
  assert.equal(hasUnseenNotes(null), true, 'first launch');
  assert.equal(hasUnseenNotes('0.0.1'), true, 'an older version');
  assert.equal(hasUnseenNotes(GAME_VERSION), false);
  assert.deepEqual(freshVersions(null), [GAME_VERSION], 'first launch marks only the newest version');
  const older = CHANGELOG[2].version;
  assert.deepEqual(freshVersions(older), CHANGELOG.slice(0, 2).map(e => e.version), 'everything since the last version read');
  assert.deepEqual(freshVersions(GAME_VERSION), []);
});

test('seen version storage is guarded: blocked or missing storage never throws', () => {
  assert.equal(readSeenVersion(blockedStorage), null);
  assert.equal(writeSeenVersion(blockedStorage, GAME_VERSION), false);
  assert.equal(readSeenVersion(null), null);
  assert.equal(writeSeenVersion(null, GAME_VERSION), false);
  const storage = memoryStorage();
  assert.equal(writeSeenVersion(storage, GAME_VERSION), true);
  assert.equal(readSeenVersion(storage), GAME_VERSION);
  assert.equal(storage.map.get(NOTES_SEEN_KEY), GAME_VERSION);
});

test('opening the notes clears the NEW badge on every button and remembers the version', () => {
  const { get, badges } = installDom();
  const storage = memoryStorage({ [NOTES_SEEN_KEY]: '0.0.1' });
  const notes = new PatchNotesUI({ storage });
  assert.equal(notes.hasNew(), true);
  const game = Object.assign(Object.create(Game.prototype), {
    state: 'TITLE', guideOpen: false, notesOpen: false, patchNotes: notes, menuNav: { clear() {} }, resetInput() {}
  });
  notes.onClose = () => game.onNotesClosed();
  game.syncNotesBadges();
  assert.ok(badges.every(b => !b.classList.contains('hidden')), 'badge shows on title and pause buttons');

  const opener = { focus() { opener.refocused = true; } };
  globalThis.document.activeElement = opener;
  assert.equal(game.openNotes(), true);
  assert.equal(game.notesOpen, true);
  assert.equal(get('notes-modal').classList.contains('hidden'), false);
  assert.match(get('notes-body').innerHTML, new RegExp(`data-version="${GAME_VERSION}"`));
  assert.equal(get('notes-body').focused, 1, 'focus moves into the notes');
  assert.ok(badges.every(b => b.classList.contains('hidden')), 'badge cleared as soon as the notes open');
  assert.equal(storage.map.get(NOTES_SEEN_KEY), GAME_VERSION);
  assert.equal(game.openNotes(), false, 'already open');

  // Esc closes and hands focus back to the button that opened them.
  let prevented = false;
  game.handleNotesKey({ code: 'Escape', preventDefault() { prevented = true; } }, false);
  assert.equal(prevented, true);
  assert.equal(game.notesOpen, false);
  assert.equal(get('notes-modal').classList.contains('hidden'), true);
  assert.equal(opener.refocused, true);
  assert.equal(new PatchNotesUI({ storage }).hasNew(), false, 'stays read after a reload');
});

test('controller: B closes the notes; they only open from the title or pause screen and never over the guide', () => {
  installDom();
  const notes = new PatchNotesUI({ storage: memoryStorage() });
  const game = Object.assign(Object.create(Game.prototype), {
    state: 'PLAYING', guideOpen: false, notesOpen: false, patchNotes: notes, resetInput() {}, gpActive: true, menuGrace: 0,
    sound: { init() {} }, menuNav: { clear() {}, update() {}, activate() {} }
  });
  notes.onClose = () => game.onNotesClosed();
  assert.equal(game.openNotes(), false, 'not mid-run');
  game.state = 'TITLE';
  game.guideOpen = true;
  assert.equal(game.openNotes(), false, 'not on top of the Field Guide');
  game.guideOpen = false;
  game.state = 'PAUSED';
  assert.equal(game.openNotes(), true);
  const pad = (button) => ({ aimY: 0, pressed: (i) => i === button });
  game.updateNotesController(pad(-1), 1); // enters the NOTES menu state with a short grace
  game.updateNotesController(pad(PAD.B), 1);
  assert.equal(game.notesOpen, false, 'B backs out');
  assert.equal(game.state, 'PAUSED', 'back on the pause menu');
});

test('blocked storage: the badge still shows and still clears for the session; nothing opens by itself', () => {
  const { badges } = installDom();
  const notes = new PatchNotesUI({ storage: blockedStorage });
  assert.equal(notes.seen, null);
  assert.equal(notes.isOpen, false, 'the notes never auto-open');
  assert.equal(notes.hasNew(), true);
  const game = Object.assign(Object.create(Game.prototype), {
    state: 'TITLE', guideOpen: false, notesOpen: false, patchNotes: notes, menuNav: { clear() {} }, resetInput() {}
  });
  notes.onClose = () => game.onNotesClosed();
  assert.doesNotThrow(() => game.openNotes());
  assert.equal(notes.hasNew(), false);
  game.closeNotes();
  game.syncNotesBadges();
  assert.ok(badges.every(b => b.classList.contains('hidden')));
});

test('version tags on screen show GAME_VERSION', () => {
  const { tags } = installDom();
  Game.prototype.renderVersionTags.call({});
  assert.ok(tags.every(t => t.textContent === `v${GAME_VERSION}`));
});
