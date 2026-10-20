// RADIO: non-pausing talking-head lines during play (#radio-box, bottom-left): the same portrait,
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

export class RadioBox {
  constructor({ sound = null, box = null } = {}) {
    this.box = box || new DialogueBox({ sound, ids: RADIO_IDS, cps: 52 });
    this.current = null;
    this.queued = null;
    this.outT = 0;
  }

  get onAir() { return !!this.current; }

  // { who, text, mood?, hold?, onStart?, cut? }. Replaces whatever was waiting behind the current line;
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

  start(line) {
    this.current = { ...line, hold: line.hold ?? readHold(line.text) + 0.8 };
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
    const line = this.queued;
    this.queued = null;
    this.current = null;
    if (line) this.start(line);
    else this.box.hide();
  }

  // Off air at once (the run ended, back to the title).
  clear() {
    this.current = this.queued = null;
    this.outT = 0;
    this.box.hide();
  }
}
