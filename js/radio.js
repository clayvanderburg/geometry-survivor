// RADIO: non-pausing talking-head lines during play (#radio-box, bottom centre, near the ship): the same portrait,
// name tag, typewriter and voice blips as the cutscene dialogue box (js/dialogue.js), but it never
// takes input or stops the game. A line types out, holds for a read, then slides away. At most one line
// waits behind the one on air (a newer one replaces it), so the radio never builds a backlog.
//
// Game.say(speaker, text, opts) is the entry point (campaign beats, Dr. Pixie's Breakthrough lines in
// js/pixie.js). Only the browser boot switches it on (Game.enableStoryRadio), so headless tests and the
// balance harness never hear it.
import { DialogueBox, readHold } from './dialogue.js';

export const RADIO_IDS = Object.freeze({ root: 'radio-box', name: 'radio-name', text: 'radio-text', portrait: 'radio-portrait' });
const OUT_TIME = 0.25; // s for the slide-out before the next line comes on
export const RADIO_CPS = 15; // typing speed: slower than cutscenes, the player is busy flying (30 before v0.45.0)
// How long a radio line stays up once typed: paced for slow readers, since the player reads it mid-fight.
export function radioHold(text) {
  return Math.max(readHold(text) + 1.6, 3 + String(text).length * 0.11); // twice the v0.44.0 hold
}

export class RadioBox {
  constructor({ sound = null, box = null } = {}) {
    this.box = box || new DialogueBox({ sound, ids: RADIO_IDS, cps: RADIO_CPS });
    this.current = null;
    this.queued = null;
    this.outT = 0;
  }

  get onAir() { return !!this.current; }

  // { who, text, mood?, hold?, onStart?, cut?, then? }. `then` is a list of lines that follow this one
  // (a short explanation in a few beats; a newer say() still replaces the rest). Replaces whatever was waiting behind the current line;
  // `cut` also hurries the line on air (typed out at once, a short hold) so this one follows quickly.
  say(line) {
    if (!line?.text) return false;
    if (!this.current) {
      this.start(line);
      return true;
    }
    this.queued = line;
    if (line.cut && this.outT <= 0) {
      if (this.box.typing) this.box.advance();
      this.current.hold = Math.min(this.current.hold, 0.7);
    }
    return true;
  }

  // Plays `line` after everything already lined up (the line on air, its `then` lines, the queued one).
  append(line) {
    if (!line?.text) return false;
    if (!this.current) return this.say(line);
    const tail = this.queued || this.current;
    tail.then = [...(tail.then || []), line];
    return true;
  }

  start(line) {
    this.current = { ...line, hold: line.hold ?? radioHold(line.text) };
    this.outT = 0;
    this.box.show(this.current);
    this.box.root?.classList.remove('radio-out');
    line.onStart?.();
  }

  update(dt) {
    if (!this.current) return;
    if (this.outT > 0) {
      this.outT -= dt;
      if (this.outT <= 0) this.next();
      return;
    }
    this.box.update(dt);
    if (!this.box.typing && this.box.idleTime >= this.current.hold) {
      this.outT = OUT_TIME;
      this.box.root?.classList.add('radio-out');
    }
  }

  next() {
    const [follow, ...rest] = this.current?.then || [];
    const line = this.queued || (follow ? { ...follow, then: rest } : null);
    this.queued = null;
    this.current = null;
    if (line) this.start(line);
    else this.box.hide();
  }

  // Docks the box into a cell appended to `container` (the Breakthrough card grid's free column), so a
  // big Dr. Pixie sits beside the cards instead of over them; undock() puts it back in its corner.
  dock(container) {
    const root = this.box.bind?.() ? this.box.root : null;
    const doc = globalThis.document;
    if (!root || !container || !doc) return false;
    this.undock();
    this.home ??= { parent: root.parentNode, next: root.nextSibling };
    this.dockEl = doc.createElement('div');
    this.dockEl.className = 'radio-dock';
    container.appendChild(this.dockEl);
    this.dockEl.appendChild(root);
    root.classList.add('radio-docked');
    return true;
  }

  undock() {
    if (!this.dockEl) return;
    const root = this.box.root;
    root.classList.remove('radio-docked');
    this.home?.parent?.insertBefore(root, this.home.next?.parentNode === this.home.parent ? this.home.next : null);
    this.dockEl.remove?.();
    this.dockEl = null;
  }

  get docked() { return !!this.dockEl; }

  // Off air at once (the run ended, back to the title).
  clear() {
    this.current = this.queued = null;
    this.outT = 0;
    this.box.hide();
  }
}
