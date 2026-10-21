// DIALOGUE: the og Mega Man-style talking-head box at the bottom of a cutscene (#dialogue-box): a framed
// pixel portrait, a name tag and typewriter text with a per-character blip in the speaker's voice. The
// portrait talks (mouth frames) while its line types out, then idles.
//
// Speakers and portraits are registered by id (registerSpeaker / registerPortrait), so later levels and
// campaign beats add their own cast without touching this file; a script line is just { who, text }.
// The typing maths are pure functions (tested in node); DialogueBox wires them into the DOM.

export const TYPE_CPS = 44; // characters per second
// Extra beat after punctuation, so lines read with a rhythm instead of a ticker-tape stream.
export const PUNCT_PAUSE = Object.freeze({ '.': 0.2, '!': 0.2, '?': 0.2, ',': 0.09, ';': 0.12, ':': 0.12, '…': 0.32, '—': 0.14 });
export const PORTRAIT_SIZE = 72; // logical pixels; CSS scales the canvas up, pixel-crisp
export const BLIP_EVERY = 2;     // one voice blip per this many typed letters

const speakers = new Map();
const portraits = new Map();

// A speaker: { name, color (CSS), portrait (portrait id), voice (blip params for SoundEngine.playDialogueBlip) }.
export function registerSpeaker(id, def) {
  speakers.set(id, { id, name: id.toUpperCase(), color: '#00f3ff', portrait: id, voice: null, ...def });
  return speakers.get(id);
}
export const getSpeaker = (id) => speakers.get(id) || null;

// A portrait: draw(ctx, { t, talking, mouth, size }) paints one frame on a PORTRAIT_SIZE² canvas.
// `mouth` is 0 (closed) / 1 / 2 (open) while talking; `t` is seconds since the line started.
export function registerPortrait(id, portrait) {
  portraits.set(id, typeof portrait === 'function' ? { draw: portrait } : portrait);
}
export const getPortrait = (id) => portraits.get(id) || null;

const pauseAfter = (ch) => PUNCT_PAUSE[ch] || 0;

// Seconds to type all of `text` (letters plus punctuation beats; a final mark's beat is not waited for).
export function typeDuration(text, cps = TYPE_CPS) {
  const s = String(text);
  let t = s.length / cps;
  for (let i = 0; i < s.length - 1; i++) t += pauseAfter(s[i]);
  return t;
}

// How many characters of `text` show after `t` seconds of typing.
export function typedLength(text, t, cps = TYPE_CPS) {
  const s = String(text);
  let clock = 0;
  for (let i = 0; i < s.length; i++) {
    clock += 1 / cps;
    if (clock > t + 1e-9) return i;
    clock += pauseAfter(s[i]);
  }
  return s.length;
}

// Seconds a finished line stays up before an auto-advancing script moves on: time to read it.
export function readHold(text) {
  return Math.min(2.6, 0.9 + String(text).length * 0.022);
}

// Does typing character `i` of `text` make a blip? Letters, digits and glyphs (alien speech), never
// spaces or punctuation; every BLIP_EVERY-th one.
const VOICED = /[^\s.,!?;:…'"“”‘’()—-]/u;
export function blipAt(text, i) {
  const ch = String(text)[i];
  if (!ch || !VOICED.test(ch)) return false;
  let letters = 0;
  for (let k = 0; k <= i; k++) if (VOICED.test(text[k])) letters++;
  return (letters - 1) % BLIP_EVERY === 0;
}

// Talk animation: mouth frame for time `t` while the line is still typing (0 once it's done).
export function mouthFrame(t, typing) {
  if (!typing) return 0;
  const k = Math.floor(t * 11) % 4; // ~11 flaps a second: closed, half, open, half
  return k === 0 ? 0 : k === 2 ? 2 : 1;
}

// DOM controller for #dialogue-box (or another box: `ids` names its root, name, text and portrait
// elements, as the radio box does). One line at a time: show(line) types it out; advance() completes the
// typing, or (once complete) reports the line as read. `sound` is the SoundEngine (blips).
export const DIALOGUE_IDS = Object.freeze({ root: 'dialogue-box', name: 'dialogue-name', text: 'dialogue-text', portrait: 'dialogue-portrait' });

export class DialogueBox {
  constructor({ sound = null, cps = TYPE_CPS, ids = DIALOGUE_IDS } = {}) {
    this.sound = sound;
    this.ids = ids;
    this.cps = cps;
    this.root = null;
    this.line = null;
    this.t = 0;
    this.shown = 0;
    this.doneAt = 0;
    this.read = false;
  }

  bind() {
    if (this.root) return true;
    const doc = globalThis.document;
    this.root = doc?.getElementById(this.ids.root) || null;
    if (!this.root) return false;
    this.nameEl = doc.getElementById(this.ids.name);
    this.textEl = doc.getElementById(this.ids.text);
    this.canvas = doc.getElementById(this.ids.portrait);
    this.ctx = this.canvas?.getContext?.('2d') || null;
    if (this.canvas) this.canvas.width = this.canvas.height = PORTRAIT_SIZE;
    return true;
  }

  get typing() { return !!this.line && this.shown < this.line.text.length; }

  show(line) {
    this.line = { ...line, text: String(line.text ?? '') };
    this.t = 0;
    this.shown = 0;
    this.doneAt = 0;
    this.read = false;
    const sp = getSpeaker(line.who);
    if (!this.bind()) return;
    this.root.classList.remove('hidden');
    this.root.style.setProperty('--speaker', sp?.color || '#00f3ff');
    this.root.dataset.speaker = line.who || '';
    if (this.nameEl) this.nameEl.textContent = line.name || sp?.name || '';
    if (this.textEl) this.textEl.textContent = '';
    this.root.classList.remove('dialogue-ready', 'dialogue-pop');
    void this.root.offsetWidth; // restart the pop-in for every new line
    this.root.classList.add('dialogue-pop');
    this.drawPortrait();
  }

  hide() {
    this.line = null;
    this.root?.classList.add('hidden');
  }

  // Typing in progress: finish the line now. Already finished: mark it read (the script moves on).
  advance() {
    if (!this.line) return false;
    if (this.typing) {
      this.shown = this.line.text.length;
      this.doneAt = this.t;
      this.render();
    } else {
      this.read = true;
    }
    return true;
  }

  update(dt) {
    if (!this.line) return;
    this.t += dt;
    if (this.typing) {
      const next = typedLength(this.line.text, this.t, this.cps);
      const voice = getSpeaker(this.line.who)?.voice;
      for (let i = this.shown; i < next; i++) {
        if (voice && blipAt(this.line.text, i)) this.sound?.playDialogueBlip?.(voice);
      }
      this.shown = next;
      if (!this.typing) this.doneAt = this.t;
      this.render();
    }
    this.drawPortrait();
  }

  // Seconds since the line finished typing (0 while typing).
  get idleTime() { return this.typing || !this.line ? 0 : this.t - this.doneAt; }

  render() {
    if (this.textEl) this.textEl.textContent = this.line.text.slice(0, this.shown);
    this.root?.classList.toggle('dialogue-ready', !this.typing);
  }

  drawPortrait() {
    if (!this.ctx || !this.line) return;
    const sp = getSpeaker(this.line.who);
    const portrait = getPortrait(sp?.portrait || this.line.who);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    portrait?.draw(ctx, { t: this.t, talking: this.typing, mouth: mouthFrame(this.t, this.typing), size: PORTRAIT_SIZE, mood: this.line.mood || null });
  }
}
