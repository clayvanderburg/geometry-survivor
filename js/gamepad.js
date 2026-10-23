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
// navigation prefers items in the same row/column. Items inside a 75-degree cone around the direction
// win first, so a neighbour that is only a few pixels lower (a lifted focused card) never counts as
// "down"; anything merely on that side is the fallback. A left / right move stays in its row first
// (items overlapping it vertically), so two stacked rows of small pills (the leaderboard's MODE and
// VERSION switches) never trade focus sideways. An up / down move goes to the nearest row in the cone
// first, so a button lined up two rows away never skips an offset row in between (the pause menu's
// TUTORIAL / FIELD GUIDE row between RESUME and PATCH NOTES). Returns an index or -1.
export function pickInDirection(from, rects, dx, dy) {
  const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
  const overlapsRow = (r, of) => r.top < of.top + of.height && r.top + r.height > of.top;
  const sameRow = (r) => overlapsRow(r, from);
  const pick = (cone, row = false, band = null) => {
    let best = -1, bestScore = Infinity;
    rects.forEach((r, i) => {
      if (row && !sameRow(r)) return;
      if (band && !overlapsRow(r, band)) return;
      const vx = r.left + r.width / 2 - fx, vy = r.top + r.height / 2 - fy;
      const along = vx * dx + vy * dy;
      if (along <= 1) return;
      const across = Math.abs(vx * dy - vy * dx);
      if (cone && across > along * 3.7) return; // outside ~75 degrees either side
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
  };
  const inRow = dy === 0 ? pick(true, true) : -1;
  if (inRow >= 0) return inRow;
  const inCone = pick(true);
  if (inCone >= 0 && dx === 0) {
    // The nearest row in the cone (by the gap along the move), then the best item in that row.
    let near = null, nearAlong = Infinity;
    rects.forEach((r) => {
      const vx = r.left + r.width / 2 - fx, vy = r.top + r.height / 2 - fy;
      const along = vy * dy;
      if (along > 1 && Math.abs(vx) <= along * 3.7 && along < nearAlong) { nearAlong = along; near = r; }
    });
    const inBand = near ? pick(true, false, near) : -1;
    if (inBand >= 0) return inBand;
  }
  return inCone >= 0 ? inCone : pick(false);
}

// An element's rect for navigation, clamped to every scrolling ancestor's visible box: a button scrolled
// out of sight inside a panel (the title armory grid) sits on that panel's edge instead of wherever its
// hidden rect lands, so it never steals a move from a visible neighbour (Left from LAUNCH), while d-pad
// moves inside the panel still reach it and scroll it into view.
export function navRect(el) {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.left + r.width, bottom = r.top + r.height;
  const style = globalThis.getComputedStyle;
  for (let a = el.parentElement; a && style; a = a.parentElement) {
    const { overflowX, overflowY } = style(a);
    const clipX = /auto|scroll|hidden/.test(overflowX), clipY = /auto|scroll|hidden/.test(overflowY);
    if (!clipX && !clipY) continue;
    const c = a.getBoundingClientRect();
    const cRight = c.left + c.width, cBottom = c.top + c.height;
    if (clipX) {
      left = Math.min(Math.max(left, c.left), cRight);
      right = Math.max(Math.min(right, cRight), c.left);
    }
    if (clipY) {
      top = Math.min(Math.max(top, c.top), cBottom);
      bottom = Math.max(Math.min(bottom, cBottom), c.top);
    }
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// [data-gp-nav] marks other focus stops (e.g. Field Guide entries, so the d-pad can browse and scroll them).
const FOCUSABLE = 'button:not([disabled]), a[href], input[type="range"], input[type="checkbox"], .upgrade-option, [data-gp-nav]';

export class MenuNavigator {
  constructor() {
    this.focused = null;
    this.onMove = null; // optional hook (menu focus-move sound)
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

    // A scrolling panel ([data-gp-scroll], the leaderboard) takes up / down itself while it can still
    // scroll that way, so the d-pad reads down the board before focus moves on past its end.
    if (pad.navY !== 0 && el.dataset?.gpScroll !== undefined) {
      const max = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if ((pad.navY > 0 && el.scrollTop < max - 1) || (pad.navY < 0 && el.scrollTop > 1)) {
        el.scrollBy?.({ top: pad.navY * Math.max(60, (el.clientHeight || 0) * 0.4), behavior: 'smooth' });
        return;
      }
    }

    // Prefer pure vertical/horizontal moves; diagonals resolve on the dominant axis.
    const dx = pad.navY !== 0 ? 0 : pad.navX;
    const dy = pad.navY;
    const others = items.filter(item => item !== el);
    const idx = pickInDirection(navRect(el), others.map(navRect), dx, dy);
    if (idx !== -1) {
      this.setFocus(others[idx]);
      this.onMove?.();
    }
  }

  activate() {
    if (this.focused && this.focused.type !== 'range') this.focused.click();
  }
}
