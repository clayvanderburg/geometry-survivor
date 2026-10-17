// Controller input: one snapshot per tick with press edges, plus spatial focus navigation for DOM menus.

// Standard Gamepad mapping indices.
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15
};

const STICK_DEADZONE = 0.18;
const NAV_THRESHOLD = 0.55;
const deadzone = (v) => (Math.abs(v) > STICK_DEADZONE ? v : 0);

export function readGamepad(prevButtons = []) {
  const pads = globalThis.navigator?.getGamepads ? globalThis.navigator.getGamepads() : [];
  const gp = Array.from(pads || []).find(pad => pad && pad.connected !== false);
  if (!gp) return null;

  const buttons = Array.from({ length: 17 }, (_, i) => !!gp.buttons[i]?.pressed);
  const axes = [0, 1, 2, 3].map(i => deadzone(gp.axes[i] || 0));
  return {
    buttons,
    pressed: (i) => buttons[i] && !prevButtons[i],
    moveX: axes[0], moveY: axes[1], aimX: axes[2], aimY: axes[3],
    // Menu direction from d-pad or left stick: -1/0/1 per axis.
    navX: buttons[PAD.LEFT] ? -1 : buttons[PAD.RIGHT] ? 1 : Math.abs(axes[0]) > NAV_THRESHOLD ? Math.sign(axes[0]) : 0,
    navY: buttons[PAD.UP] ? -1 : buttons[PAD.DOWN] ? 1 : Math.abs(axes[1]) > NAV_THRESHOLD ? Math.sign(axes[1]) : 0,
    active: buttons.some(Boolean) || axes.some(v => v !== 0)
  };
}

// Choose the rect nearest `from` in direction (dx, dy); off-axis distance is penalised so
// navigation prefers items in the same row/column. Returns an index or -1.
export function pickInDirection(from, rects, dx, dy) {
  const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    const vx = r.left + r.width / 2 - fx, vy = r.top + r.height / 2 - fy;
    const along = vx * dx + vy * dy;
    if (along <= 1) return;
    const across = Math.abs(vx * dy - vy * dx);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// [data-gp-nav] marks other focus stops (e.g. Field Guide entries, so the d-pad can browse and scroll them).
const FOCUSABLE = 'button:not([disabled]), a[href], input[type="range"], .upgrade-option, [data-gp-nav]';

export class MenuNavigator {
  constructor() {
    this.focused = null;
    this.heldDir = '';
    this.repeatIn = 0;
  }

  items(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el.getClientRects().length > 0);
  }

  setFocus(el) {
    if (this.focused === el) return;
    this.focused?.classList.remove('gp-focus');
    this.focused = el;
    if (el) {
      el.classList.add('gp-focus');
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  clear() { this.setFocus(null); }

  // Keeps focus inside `root`, moves it with held-direction auto-repeat, and nudges focused sliders.
  update(root, pad, dt, fallback) {
    const items = this.items(root);
    if (!items.length) return;
    if (!this.focused || !items.includes(this.focused)) this.setFocus(fallback && items.includes(fallback) ? fallback : items[0]);

    const dir = `${pad.navX},${pad.navY}`;
    if (dir === '0,0') { this.heldDir = ''; return; }
    if (dir === this.heldDir) {
      this.repeatIn -= dt;
      if (this.repeatIn > 0) return;
      this.repeatIn = 0.12;
    } else {
      this.heldDir = dir;
      this.repeatIn = 0.38;
    }

    const el = this.focused;
    if (el.type === 'range' && pad.navX !== 0 && pad.navY === 0) {
      const step = Number(el.step) || 1;
      const value = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + pad.navX * step * 2));
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Prefer pure vertical/horizontal moves; diagonals resolve on the dominant axis.
    const dx = pad.navY !== 0 ? 0 : pad.navX;
    const dy = pad.navY;
    const others = items.filter(item => item !== el);
    const idx = pickInDirection(el.getBoundingClientRect(), others.map(item => item.getBoundingClientRect()), dx, dy);
    if (idx !== -1) this.setFocus(others[idx]);
  }

  activate() {
    if (this.focused && this.focused.type !== 'range') this.focused.click();
  }
}
