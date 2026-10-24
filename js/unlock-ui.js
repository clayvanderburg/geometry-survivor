// Weapon unlock moments (goals and progress in js/weapon-unlocks.js):
//   - mid-run: a NEW WEAPON UNLOCKED toast that slams in over the HUD (never blocks play), a sting and a
//     ring burst off the ship;
//   - game over: a reveal card per weapon unlocked, before the results and the leaderboard;
//   - the results: the nearest one or two goals with progress bars;
//   - goal rows (silhouette, goal, bar) shared with the Field Guide's WEAPONS tab.
// HTML comes from pure functions (tested in node); UnlockUI wires them into the page.
import { WEAPONS, WEAPON_BY_ID } from './loadout.js';
import { goalText, goalProgress, nearestGoals, UNLOCK_GOALS, OPEN_WEAPONS } from './weapon-unlocks.js';
import { clipHTML, weaponClip } from './weapon-media.js';
import { hueOf } from './juice.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const UNLOCK_TOAST_TIME = 4.2; // seconds on screen (the CSS animation matches)
const REVEAL_GRACE_MS = 700;

export function unlockToastHTML(goal) {
  const w = WEAPON_BY_ID[goal.weapon];
  return `<div class="unlock-toast-flare" aria-hidden="true"></div>
    <div class="unlock-toast-kicker">🔓 NEW WEAPON UNLOCKED</div>
    <div class="unlock-toast-name" style="--wc:${w.color}">${esc(w.name)}</div>
    <div class="unlock-toast-goal">✓ ${esc(goalText(goal, goal.need))}</div>`;
}

// A progress bar: `frac` 0..1.
const barHTML = (frac, color) => `<div class="unlock-bar" style="--wc:${color}"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></div>`;

// One goal with its bar: "Freeze enemies 87/150" plus the hint. `have` from the live stats.
export function goalRowHTML(goal, stats) {
  const w = WEAPON_BY_ID[goal.weapon];
  const pr = goalProgress(goal, stats);
  return `<div class="unlock-goal" style="--wc:${w.color}">
    <div class="unlock-goal-head"><span class="unlock-lock" aria-hidden="true">🔒</span><b>${esc(w.name)}</b></div>
    <div class="unlock-goal-text">${esc(goalText(goal, pr.have))}</div>${barHTML(pr.frac, w.color)}
    <div class="unlock-goal-hint">${esc(goal.hint)}</div></div>`;
}

// The reveal card for one weapon: its clip (shown as a silhouette that lights up), name, what it does,
// and the goal that unlocked it.
export function revealCardHTML(goal, index = 0) {
  const w = WEAPON_BY_ID[goal.weapon];
  return `<article class="unlock-reveal-card" style="--wc:${w.color}; --delay:${(0.25 + index * 0.35).toFixed(2)}s">
    <div class="unlock-reveal-media">${clipHTML(weaponClip(w.id), `${w.name} in action`)}<div class="unlock-reveal-rays" aria-hidden="true"></div></div>
    <div class="unlock-reveal-kicker">NEW WEAPON UNLOCKED</div>
    <h3 class="unlock-reveal-name">${esc(w.name)}</h3>
    <p class="unlock-reveal-what">${esc(w.summary)}</p>
    <div class="unlock-reveal-goal">✓ ${esc(goalText(goal, goal.need))}</div>
    <div class="unlock-reveal-note">Now in your NEW WEAPON picks.</div></article>`;
}

// "NEXT UNLOCKS" on the results: the closest goals with their bars.
export function teaserHTML(goals, stats) {
  if (!goals.length) return '';
  return `<div class="unlock-teaser"><div class="unlock-teaser-title">🔓 NEXT UNLOCKS</div>
    <div class="unlock-teaser-list">${goals.map(({ goal }) => goalRowHTML(goal, stats)).join('')}</div></div>`;
}

// Unlocked count line: "9 / 20 WEAPONS".
export function unlockedCount(unlocks) {
  const extra = UNLOCK_GOALS.filter((g) => unlocks?.weapons?.includes(g.weapon)).length;
  return { have: OPEN_WEAPONS.length + extra, total: WEAPONS.length };
}

export class UnlockUI {
  constructor(game) {
    this.game = game;
    this.toastQueue = [];
    this.toastTimer = null;
    this.onRevealDone = null;
    this.revealOpen = false;
    globalThis.document?.getElementById?.('btn-unlock-continue')?.addEventListener?.('click', () => this.closeReveal());
  }

  // A goal completed mid-run: sting, a burst off the ship, then the toast (queued if one is showing).
  onUnlock(goal) {
    const g = this.game;
    const w = WEAPON_BY_ID[goal.weapon];
    g.sound?.playWeaponUnlock?.();
    const p = g.player;
    if (p && g.particles) {
      const hue = hueOf(w.color);
      g.particles.spawnShockwave?.(p.x, p.y, 220, hue, 5, 0.6);
      g.particles.spawnShockwave?.(p.x, p.y, 120, 48, 3, 0.35);
      g.particles.spawnExplosionSparks?.(p.x, p.y, 36, hue, 3, 12, 2.4);
      g.particles.spawnFloatText?.(p.x, p.y - 40, `🔓 ${w.name.toUpperCase()}`, w.color, 18);
    }
    g.grid?.applyImpulse?.(p?.x ?? 0, p?.y ?? 0, 40, 200, hueOf(w.color));
    this.toastQueue.push(goal);
    if (!this.toastTimer) this.nextToast();
  }

  nextToast() {
    const el = globalThis.document?.getElementById?.('unlock-toast');
    const goal = this.toastQueue.shift();
    if (!goal || !el) { this.toastTimer = null; return; }
    el.innerHTML = unlockToastHTML(goal);
    el.classList.remove('hidden', 'show');
    void el.offsetWidth; // restart the slam-in animation
    el.classList.add('show');
    this.toastTimer = setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hidden');
      this.toastTimer = this.toastQueue.length ? setTimeout(() => this.nextToast(), 250) : null;
    }, UNLOCK_TOAST_TIME * 1000);
  }

  // The game-over reveal. Returns false when nothing was unlocked (the caller opens the results itself),
  // else shows the cards and calls `onDone` when the player continues.
  reveal(onDone) {
    const tracker = this.game.unlocks;
    const fresh = tracker?.freshUnlocks?.() || [];
    const modal = globalThis.document?.getElementById?.('unlock-reveal-modal');
    if (!fresh.length || !modal || this.revealOpen) return false;
    const goals = fresh.map((id) => UNLOCK_GOALS.find((goal) => goal.weapon === id)).filter(Boolean);
    const body = globalThis.document.getElementById('unlock-reveal-cards');
    if (body) body.innerHTML = goals.map((goal, i) => revealCardHTML(goal, i)).join('');
    const title = globalThis.document.getElementById('unlock-reveal-title');
    if (title) title.textContent = goals.length > 1 ? `${goals.length} NEW WEAPONS UNLOCKED` : 'NEW WEAPON UNLOCKED';
    tracker.markRevealed();
    this.revealOpen = true;
    this.revealAt = globalThis.performance?.now?.() ?? 0;
    this.onRevealDone = onDone;
    modal.classList.remove('hidden');
    this.game.sound?.playWeaponReveal?.(goals.length);
    // Each card's light-up lands with a hit (the CSS delays match revealCardHTML's --delay).
    goals.forEach((_, i) => setTimeout(() => this.revealOpen && this.game.sound?.playWeaponUnlock?.(), (250 + i * 350)));
    globalThis.document.getElementById('btn-unlock-continue')?.focus?.({ preventScroll: true });
    return true;
  }

  closeReveal() {
    if (!this.revealOpen) return;
    // A press carried over from skipping the death screen can't dismiss the cards unseen.
    if ((globalThis.performance?.now?.() ?? Infinity) - this.revealAt < REVEAL_GRACE_MS) return;
    this.revealOpen = false;
    globalThis.document?.getElementById?.('unlock-reveal-modal')?.classList.add('hidden');
    this.game.sound?.playUiConfirm?.();
    const done = this.onRevealDone;
    this.onRevealDone = null;
    done?.();
  }

  // Keys while the reveal is up: Enter / Space / Escape continue; everything else is swallowed.
  handleKey(e) {
    if (!this.revealOpen) return false;
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return true;
    e.preventDefault?.();
    if (!e.repeat && ['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) this.closeReveal();
    return true;
  }

  // The results' NEXT UNLOCKS strip.
  renderTeaser() {
    const el = globalThis.document?.getElementById?.('go-unlock-goals');
    const tracker = this.game.unlocks;
    if (!el || !tracker) return;
    const stats = tracker.stats();
    el.innerHTML = teaserHTML(nearestGoals(tracker.save, stats, 2), stats);
  }

  // The title's 🔓 WEAPONS button count.
  renderHub() {
    const el = globalThis.document?.getElementById?.('unlock-count-title');
    if (!el) return;
    const { have, total } = unlockedCount(this.game.unlocks?.save);
    el.textContent = ` ${have}/${total}`;
  }
}
