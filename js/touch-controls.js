// Touch controls for phones and tablets: floating twin sticks (touch the left half of the screen to move,
// the right half to aim) and DASH / NOVA buttons. Shown only on touch devices while a run is live.

export const STICK_RADIUS = 56; // px the knob can travel from where the thumb landed
const STICK_DEADZONE = 0.14;

// Stick deflection from the touch origin, as a vector of length 0..1 (0 inside the deadzone).
// knobX / knobY are the knob's offset in px, clamped to the stick ring.
export function stickVector(ox, oy, x, y, radius = STICK_RADIUS) {
  const dx = x - ox, dy = y - oy;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0, knobX: 0, knobY: 0 };
  const k = Math.min(1, radius / d);
  const mag = Math.min(1, d / radius);
  const out = mag < STICK_DEADZONE ? 0 : (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return { x: (dx / d) * out, y: (dy / d) * out, knobX: dx * k, knobY: dy * k };
}

// A phone or tablet: its main pointer is a finger.
export function isTouchDevice(win = globalThis) {
  try {
    if (win.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch { /* old browsers */ }
  return false;
}

export class TouchControls {
  constructor(root, { onDash, onNova, onTouch } = {}) {
    this.root = root;
    this.onDash = onDash;
    this.onNova = onNova;
    this.onTouch = onTouch;
    this.move = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.aim = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.visible = false;
    if (!root?.querySelector) return;
    this.sticks = {
      move: root.querySelector('[data-stick="move"]'),
      aim: root.querySelector('[data-stick="aim"]')
    };
    this.bind();
  }

  bind() {
    const root = this.root;
    const press = (id, fn) => {
      root.querySelector(id)?.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn?.();
      });
    };
    press('#touch-dash', () => this.onDash?.());
    press('#touch-nova', () => this.onNova?.());

    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('.touch-btn')) return;
      e.preventDefault(); // no emulated mouse clicks or page gestures behind the sticks
      const stick = e.clientX < (globalThis.innerWidth || 0) / 2 ? this.move : this.aim;
      if (stick.id !== null) return;
      Object.assign(stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      root.setPointerCapture?.(e.pointerId);
      this.paint(stick, 0, 0);
    });
    root.addEventListener('pointermove', (e) => {
      const stick = this.stickFor(e.pointerId);
      if (!stick) return;
      e.preventDefault();
      const v = stickVector(stick.ox, stick.oy, e.clientX, e.clientY);
      stick.x = v.x;
      stick.y = v.y;
      this.paint(stick, v.knobX, v.knobY);
    });
    const release = (e) => {
      const stick = this.stickFor(e.pointerId);
      // Audio can only start from a user gesture, and a finger's gesture lands on release.
      this.onTouch?.();
      if (!stick) return;
      this.releaseStick(stick);
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
  }

  stickFor(id) {
    if (this.move.id === id) return this.move;
    if (this.aim.id === id) return this.aim;
    return null;
  }

  releaseStick(stick) {
    Object.assign(stick, { id: null, x: 0, y: 0 });
    const el = stick === this.move ? this.sticks?.move : this.sticks?.aim;
    el?.classList.remove('active');
  }

  paint(stick, kx, ky) {
    const el = stick === this.move ? this.sticks?.move : this.sticks?.aim;
    if (!el) return;
    el.style.left = `${stick.ox}px`;
    el.style.top = `${stick.oy}px`;
    el.classList.add('active');
    const knob = el.firstElementChild;
    if (knob) knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  reset() {
    this.releaseStick(this.move);
    this.releaseStick(this.aim);
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root?.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  // DASH ring fills as the cooldown runs out; NOVA shows the bombs left.
  setStatus(dashReady, bombs) {
    if (!this.root?.querySelector) return;
    const dash = this.root.querySelector('#touch-dash');
    dash?.style.setProperty('--ready', String(dashReady));
    dash?.classList.toggle('ready', dashReady >= 1);
    const nova = this.root.querySelector('#touch-nova');
    nova?.classList.toggle('ready', bombs > 0);
    const count = this.root.querySelector('#touch-nova-count');
    if (count && count.textContent !== String(bombs)) count.textContent = String(bombs);
  }
}

// Keyboard hints ("[P]", "[SPACE / CLICK]", "[Shift+1-4]") mean nothing on a phone. Touch play scrubs
// them from the page's text as it renders, and puts them back when a mouse takes over.
const KEY = String.raw`(?:Shift\+)?(?:[A-Z0-9]|[1-9]-[1-9]|SPACE|Space|ESC|Esc|CLICK|Click|ENTER|Enter|TAB|Tab|PgUp|PgDn)`;
const KEY_HINT = new RegExp(String.raw`\s*\[${KEY}(?:\s*[/+,]\s*${KEY})*\]`, 'g');

export function stripKeyHints(text) {
  return text.replace(KEY_HINT, '');
}

export class KeyHintScrubber {
  constructor(root) {
    this.root = root;
    this.originals = new Map(); // text node -> its text before scrubbing
    this.observer = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'characterData') this.scrubNode(r.target);
          else r.addedNodes.forEach((n) => this.scrubTree(n));
        }
      })
      : null;
  }

  scrubNode(node) {
    const text = node.nodeValue;
    if (!text || !text.includes('[')) return;
    const clean = stripKeyHints(text);
    if (clean === text) return;
    if (this.originals.size > 400) {
      for (const n of this.originals.keys()) if (!n.isConnected) this.originals.delete(n);
    }
    this.originals.set(node, text);
    node.nodeValue = clean;
  }

  scrubTree(node) {
    if (node.nodeType === 3) return this.scrubNode(node);
    if (node.nodeType !== 1) return;
    const walker = node.ownerDocument.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) this.scrubNode(n);
  }

  setActive(on) {
    if (!this.root || !this.observer) return;
    if (on) {
      this.scrubTree(this.root);
      this.observer.observe(this.root, { subtree: true, childList: true, characterData: true });
    } else {
      this.observer.disconnect();
      for (const [node, text] of this.originals) if (node.isConnected) node.nodeValue = text;
      this.originals.clear();
    }
  }
}
