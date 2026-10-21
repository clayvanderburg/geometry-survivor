// CUTSCENE timeline player: runs a script of plain-data steps one after another, in sim time.
//
//   { do: 'wait', time: 1.2 }                        pause
//   { do: 'say', who: 'miner', text: '…' }           a dialogue line (js/dialogue.js); waits for the player
//                                                    to advance it, or auto-advances after a read hold
//   { do: 'hide' }                                   put the dialogue box away
//   { do: 'end' }                                    finish here
//   { do: '<action>', …, time?: s }                  anything else is a stage action supplied by the host
//                                                    (camera, ship, warp gates, spawns, fades, music…);
//                                                    it blocks for `time` seconds if given
//
// Any step with `wait: false` starts and the script moves straight on (it runs in the background), so a
// camera move can play under a line. Scripts are data, so later levels and campaign beats can reuse the
// player with their own actions and cast. The host action signature is (step, cutscene) => void | number
// (seconds to block) | { update(dt) => finished? }.
import { readHold, typeDuration, getSpeaker } from './dialogue.js';

export const BUILTIN_STEPS = Object.freeze(['wait', 'say', 'hide', 'end']);

const stepsOf = (script) => (Array.isArray(script) ? script : script?.steps || []);

export class Cutscene {
  constructor(script, { actions = {}, dialogue = null, onEnd = null, autoAdvance = true } = {}) {
    this.script = script;
    this.steps = stepsOf(script);
    this.actions = actions;
    this.dialogue = dialogue;
    this.onEnd = onEnd;
    this.autoAdvance = autoAdvance;
    this.index = -1;
    this.current = null;
    this.background = [];
    this.time = 0;
    this.active = false;
    this.endReason = null;
  }

  start() {
    this.active = true;
    this.index = -1;
    this.time = 0;
    this.nextStep();
    return this;
  }

  // Run steps until one blocks (or the script ends).
  nextStep() {
    while (this.active) {
      this.index++;
      if (this.index >= this.steps.length) return this.finish('done');
      const step = this.steps[this.index];
      if (step.do === 'end') return this.finish('done');
      const runner = this.run(step);
      if (!runner) continue;
      if (step.wait === false) {
        this.background.push(runner);
        continue;
      }
      this.current = runner;
      return;
    }
  }

  // A runner for one step: { update(dt) → true when finished, say?: true }, or null when instant.
  run(step) {
    switch (step.do) {
      case 'wait': return timer(step.time ?? 0.5);
      case 'hide':
        this.dialogue?.hide();
        return null;
      case 'say': return this.sayRunner(step);
      default: {
        const fn = this.actions[step.do];
        const out = fn ? fn(step, this) : undefined;
        if (out && typeof out.update === 'function') return out;
        const t = typeof out === 'number' ? out : step.time;
        return t > 0 ? timer(t) : null;
      }
    }
  }

  sayRunner(step) {
    const box = this.dialogue;
    if (!box) return timer(typeDuration(step.text) + readHold(step.text));
    box.show(step);
    const hold = step.hold ?? readHold(step.text);
    return {
      say: true,
      update: () => box.read || (this.autoAdvance && step.auto !== false && !box.typing && box.idleTime >= hold)
    };
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.dialogue?.update(dt);
    this.background = this.background.filter((r) => !r.update(dt));
    if (this.current?.update(dt)) {
      this.current = null;
      this.nextStep();
    }
  }

  // Player input (click / tap / Space / A): finishes the typing, then moves past the line.
  advance() {
    if (!this.active) return false;
    return this.current?.say ? !!this.dialogue?.advance() : false;
  }

  skip() {
    if (this.active) this.finish('skip');
  }

  finish(reason) {
    if (!this.active) return;
    this.active = false;
    this.current = null;
    this.background = [];
    this.endReason = reason;
    this.dialogue?.hide();
    this.onEnd?.(reason, this);
  }
}

const timer = (t) => {
  let left = t;
  return { update: (dt) => (left -= dt) <= 0 };
};

// Rough running time of a script if nobody presses anything (lines auto-advance after their read hold).
export function estimateDuration(script) {
  let t = 0;
  for (const s of stepsOf(script)) {
    if (s.wait === false) continue;
    if (s.do === 'end') break;
    if (s.do === 'say') t += typeDuration(s.text) + (s.hold ?? readHold(s.text));
    else t += s.time ?? 0;
  }
  return t;
}

// Problems with a script, for tests: unknown step kinds, lines with no text or an unregistered speaker.
export function validateScript(script, { actions = {} } = {}) {
  const problems = [];
  stepsOf(script).forEach((s, i) => {
    if (!s || typeof s.do !== 'string') problems.push(`step ${i}: no "do"`);
    else if (!BUILTIN_STEPS.includes(s.do) && !actions[s.do]) problems.push(`step ${i}: unknown step "${s.do}"`);
    if (s?.do === 'say') {
      if (!String(s.text || '').trim()) problems.push(`step ${i}: empty line`);
      if (!getSpeaker(s.who)) problems.push(`step ${i}: unknown speaker "${s.who}"`);
    }
  });
  return problems;
}
