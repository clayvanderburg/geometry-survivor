// The Hangar screen (docs/HANGAR_DESIGN.md §5.3): a HANGAR button on the title screen, a SHIPS tab (live ship
// previews, stat chips vs VEXOLITH, kit and quirk, SELECT; locked ships as dark silhouettes with their feat
// and a progress bar), a FEATS tab, NEW badges and the unlock toasts. Everything is built by this module
// (button, overlay, toast), so with the Hangar flag off (js/hangar-flag.js) the page is exactly master's:
// mountHangar returns null and adds nothing. HTML builders are pure so tests can check them in node.
import { hangarEnabled } from './hangar-flag.js';
import { SHIPS, SHIP_BY_ID, shipStatChips, shipLook, shipFixedKit, DEFAULT_SHIP } from './ships.js';
import { FEATS, featProgress, nextFeat } from './feats.js';
import { WEAPONS, WEAPON_BY_ID } from './loadout.js';
import { isWeaponUnlocked, isLockable, WEAPON_UNLOCK_FEATS, GRANDFATHERED } from './weapon-unlocks.js';
import { ShipPreview } from './ship-preview.js';
import { PAD } from './gamepad.js';
import { TUNING } from './config.js';

export const HANGAR_TABS = [
  { id: 'ships', label: 'SHIPS' },
  { id: 'arsenal', label: 'ARSENAL' },
  { id: 'feats', label: 'FEATS' }
];
export const TOAST_TIME = 3.2; // s on screen per unlock toast

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => Math.round(n).toLocaleString('en-US');
const TIER_LABEL = { start: 'STARTER', early: 'EARLY', mid: 'MID', late: 'LATE' };

// The feat that unlocks a ship (VEXOLITH: none).
export const shipFeat = (id) => FEATS.find((f) => f.reward.ship === id) || null;

export function kitText(id) {
  const ship = SHIP_BY_ID[id];
  const kit = shipFixedKit(id);
  if (kit) return kit.map((w) => WEAPON_BY_ID[w]?.name || w).join(' + ');
  return { pick: 'Your pick', last: 'Your last starting pick', any: 'Any unlocked weapon' }[ship.kit] || 'Your pick';
}

export function progressBarHTML(feat, h) {
  if (!feat) return '';
  const { value, goal, done } = featProgress(feat, h);
  const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;
  const label = feat.kind === 'mastery' ? (done ? 'DONE' : 'NOT YET')
    : feat.kind === 'run' && feat.unit === 'WAVE' ? `BEST WAVE ${num(value)} / ${num(goal)}`
      : feat.hidden && !done ? '???' : `${num(value)} / ${num(goal)}${feat.unit ? ` ${feat.unit}` : ''}`;
  return `<div class="hangar-progress${done ? ' done' : ''}"><div class="hangar-progress-fill" style="width:${pct}%"></div><span>${esc(label)}</span></div>`;
}

export function shipCardHTML(id, h) {
  const ship = SHIP_BY_ID[id];
  const unlocked = h.ships.includes(id);
  const selected = h.ship === id;
  const fresh = h.fresh.includes(`ship:${id}`);
  const feat = shipFeat(id);
  const cls = `hangar-ship${unlocked ? '' : ' locked'}${selected ? ' selected' : ''}${fresh ? ' fresh' : ''}`;
  const canvas = `<div class="hangar-ship-stage"><canvas class="hangar-ship-canvas" data-ship-canvas="${esc(id)}" aria-hidden="true"></canvas>${fresh ? '<span class="guide-new">NEW</span>' : ''}${unlocked ? '' : '<span class="hangar-lock" aria-hidden="true">🔒</span>'}</div>`;
  const head = `<div class="hangar-ship-head"><h3>${esc(ship.name)}</h3><span class="hangar-tier tier-${esc(ship.tier)}">${TIER_LABEL[ship.tier] || ''}</span></div>`;
  if (!unlocked) {
    return `<article class="${cls}" data-ship="${esc(id)}" style="--ship-col:${ship.color}" data-gp-nav tabindex="0">${canvas}${head}
      <p class="hangar-feat"><b>${esc(feat?.name || 'LOCKED')}</b> ${esc(feat?.text || '')}</p>${progressBarHTML(feat, h)}</article>`;
  }
  const chips = shipStatChips(id).map((c) => `<span class="hangar-chip ${c.good ? 'good' : 'bad'}"><b>${esc(c.label)}</b> ${esc(c.text)}</span>`).join('') || '<span class="hangar-chip"><b>BASELINE</b> no trade-offs</span>';
  return `<article class="${cls}" data-ship="${esc(id)}" style="--ship-col:${ship.color}">${canvas}${head}
    <p class="hangar-blurb">${esc(ship.blurb)}</p>
    <div class="hangar-chips">${chips}</div>
    <p class="hangar-kit"><b>KIT</b> ${esc(kitText(id))}</p>
    <p class="hangar-quirk"><b>QUIRK</b> ${esc(ship.quirk)}</p>
    <button type="button" class="neon-btn hangar-select" data-select-ship="${esc(id)}" ${selected ? 'disabled' : ''}>${selected ? '✓ SELECTED' : 'SELECT'}</button></article>`;
}

export function shipsHTML(h) {
  return `<div class="hangar-grid">${SHIPS.map((s) => shipCardHTML(s.id, h)).join('')}</div>`;
}

// ARSENAL: every weapon with its lock state, the feat(s) that unlock it and its mastery stars.
const STARS = ['', '★', '★★', '★★★', '✦'];
export function arsenalRowHTML(w, h) {
  const unlocked = isWeaponUnlocked(h, w.id);
  const fresh = h.fresh.includes(`weapon:${w.id}`);
  const tier = h.mastery[w.id] || 0;
  const feats = (WEAPON_UNLOCK_FEATS[w.id] || []).map((id) => FEATS.find((f) => f.id === id)).filter(Boolean);
  let how = 'Unlocked from the start';
  if (isLockable(w.id)) {
    if (h.weapons.includes(w.id)) how = `Unlocked by ${feats.map((f) => f.name).join(' / ')}`;
    else if (unlocked) how = 'Unlocked (you flew before the Hangar)';
    else how = feats.map((f) => `${f.name}: ${f.text}`).join(' · or ');
  }
  const bar = !unlocked && feats[0] ? progressBarHTML(feats[0], h) : '';
  return `<article class="hangar-arsenal-row${unlocked ? '' : ' locked'}${fresh ? ' fresh' : ''}" style="--wpn:${w.color}" data-weapon="${esc(w.id)}" data-gp-nav tabindex="0">
    <div class="hangar-feat-main"><h3>${unlocked ? '' : '🔒 '}${esc(w.name)}${fresh ? ' <span class="guide-new">NEW</span>' : ''} <span class="hangar-stars" title="Mastery">${STARS[tier] || ''}</span></h3>
    <p>${esc(how)}</p></div><div class="hangar-feat-side"><span class="hangar-reward">${esc(w.category)}</span>${bar}</div></article>`;
}

export function arsenalHTML(h) {
  const open = WEAPONS.filter((w) => isWeaponUnlocked(h, w.id)).length;
  const vet = h.veteran ? ' · VETERAN: the weapons you already had stay unlocked' : '';
  return `<p class="hangar-summary">${open} / ${WEAPONS.length} WEAPONS UNLOCKED${esc(vet)}</p>
    <div class="hangar-feat-list">${WEAPONS.map((w) => arsenalRowHTML(w, h)).join('')}</div>`;
}

export function featRowHTML(feat, h) {
  const done = !!h.feats[feat.id];
  const fresh = h.fresh.includes(`feat:${feat.id}`);
  const secret = feat.hidden && !done;
  const r = feat.reward;
  const reward = secret ? '???' : [r.ship && `SHIP: ${SHIP_BY_ID[r.ship]?.name || r.ship.toUpperCase()}`, r.weapon && `WEAPON: ${WEAPON_BY_ID[r.weapon]?.name || r.weapon.toUpperCase()}`, r.badge && 'BADGE'].filter(Boolean).join(' · ');
  return `<article class="hangar-feat-row${done ? ' done' : ''}${fresh ? ' fresh' : ''}" data-feat="${esc(feat.id)}" data-gp-nav tabindex="0">
    <div class="hangar-feat-main"><h3>${done ? '★ ' : ''}${esc(secret ? '???' : feat.name)}${fresh ? ' <span class="guide-new">NEW</span>' : ''}</h3>
    <p>${esc(secret ? feat.hint : feat.text)}</p></div>
    <div class="hangar-feat-side"><span class="hangar-reward">${esc(reward)}</span>${done ? `<span class="hangar-date">${esc(h.feats[feat.id])}</span>` : secret ? '' : progressBarHTML(feat, h)}</div></article>`;
}

export function featsHTML(h) {
  const done = FEATS.filter((f) => h.feats[f.id]).length;
  return `<p class="hangar-summary">${done} / ${FEATS.length} FEATS · ${h.ships.length} / ${SHIPS.length} SHIPS · NORMAL and HARDCORE runs count (BLITZ only for its own feats)</p>
    <div class="hangar-feat-list">${FEATS.map((f) => featRowHTML(f, h)).join('')}</div>`;
}

// One toast line per completed feat: "FEAT // EXTERMINATOR — MANTIS JOINS THE HANGAR".
export function toastText({ feat, added }) {
  const parts = added.map((a) => {
    const [kind, id] = a.split(':');
    if (kind === 'ship') return `${SHIP_BY_ID[id]?.name || id.toUpperCase()} JOINS THE HANGAR`;
    if (kind === 'weapon') return `${(WEAPON_BY_ID[id]?.name || id).toUpperCase()} UNLOCKED`;
    return 'BADGE EARNED';
  });
  return `FEAT // ${feat.name}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}

// The results screen's strip: what this run unlocked, and the closest feat still to do.
export function resultsStripHTML(unlocked, h) {
  const items = unlocked.map((d) => `<li>${esc(toastText(d).replace(/^FEAT \/\/ /, ''))}</li>`).join('');
  const next = nextFeat(h);
  let nudge = '';
  if (next) {
    const { feat, value, goal } = next;
    const r = feat.reward;
    const prize = r.ship ? SHIP_BY_ID[r.ship]?.name || r.ship.toUpperCase() : (WEAPON_BY_ID[r.weapon]?.name || r.weapon || '').toUpperCase();
    const need = feat.unit === 'WAVE' ? `${feat.text.toUpperCase()}` : `${num(goal - value)} ${feat.unit || ''} TO GO`;
    nudge = `<p class="hangar-next"><b>NEXT</b> ${esc(feat.name)}: ${esc(need)} → ${esc(prize)}</p>`;
  }
  if (!items && !nudge) return '';
  return `${items ? `<div class="hangar-results-head">★ NEW IN THE HANGAR</div><ul class="hangar-results-list">${items}</ul>` : ''}${nudge}`;
}

// Which NEW ids each tab shows (and clears once viewed).
const TAB_FRESH = {
  ships: (f) => f.startsWith('ship:'),
  arsenal: (f) => f.startsWith('weapon:'),
  feats: (f) => f.startsWith('feat:') || f.startsWith('badge:')
};

export class HangarUI {
  constructor(game, doc = globalThis.document) {
    this.game = game;
    this.doc = doc;
    this.isOpen = false;
    this.tab = 'ships';
    this.previews = [];
    this.toasts = [];
    this.toastT = 0;
    this.raf = null;
    this.build();
  }

  get h() { return this.game.progression.hangar(); }

  build() {
    const doc = this.doc;
    // Title button next to the Field Guide (and its touch-menu twin).
    const guideBtn = doc.getElementById('btn-title-guide');
    this.button = doc.createElement('button');
    this.button.id = 'btn-title-hangar';
    this.button.className = 'neon-btn guide-open-btn guide-hub-btn hangar-open-btn';
    this.button.title = 'Ships, feats and unlocks';
    this.button.innerHTML = '🚀 HANGAR<span class="guide-btn-badge" data-hangar-badge></span>';
    this.button.addEventListener('click', () => this.open());
    guideBtn?.parentNode?.insertBefore(this.button, guideBtn);
    const mGuide = doc.querySelector?.('[data-m-proxy="btn-title-guide"]');
    if (mGuide?.parentNode) {
      const m = doc.createElement('button');
      m.className = 'neon-btn m-btn';
      m.innerHTML = '🚀 HANGAR<span class="guide-btn-badge" data-hangar-badge></span>';
      m.addEventListener('click', () => this.open());
      mGuide.parentNode.insertBefore(m, mGuide);
    }

    this.root = doc.createElement('div');
    this.root.id = 'hangar-modal';
    this.root.className = 'modal-overlay guide-overlay hangar-overlay hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.innerHTML = `<div class="modal-card guide-card hangar-card">
      <div class="guide-header"><div><div class="glitch-subtitle">FLEET COMMAND // HANGAR</div>
        <h2 class="guide-title">🚀 HANGAR</h2><div class="guide-progress" data-hangar-sub></div></div>
        <button type="button" class="neon-btn guide-close-btn" data-hangar-close>◀ BACK [ESC]</button></div>
      <div class="guide-tabs" role="tablist">${HANGAR_TABS.map((t) => `<button type="button" class="guide-tab" data-hangar-tab="${t.id}" role="tab">${t.label} <span class="guide-tab-new" data-hangar-tab-new="${t.id}"></span></button>`).join('')}</div>
      <div class="guide-body hangar-body" data-hangar-body tabindex="-1"></div>
      <div class="guide-foot"><span><b>Q E</b> / <b>LB RB</b> tabs</span><span><b>TAB</b> / <b>D-pad</b> browse</span><span><b>ESC</b> / <b>B</b> back</span></div></div>`;
    (doc.getElementById('guide-modal')?.parentNode || doc.body)?.appendChild(this.root);
    this.body = this.root.querySelector('[data-hangar-body]');
    this.root.querySelector('[data-hangar-close]')?.addEventListener('click', () => this.close());
    this.root.querySelectorAll('[data-hangar-tab]').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.hangarTab)));
    this.root.addEventListener('click', (e) => {
      const sel = e.target?.closest?.('[data-select-ship]');
      if (sel) this.select(sel.dataset.selectShip);
    });

    // Unlock toast: top centre, one at a time.
    this.toastEl = doc.createElement('div');
    this.toastEl.className = 'hangar-toast hidden';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.innerHTML = '<span class="hangar-toast-icon" aria-hidden="true">★</span><span class="hangar-toast-text"></span>';
    (doc.getElementById('guide-toast')?.parentNode || doc.body)?.appendChild(this.toastEl);
    this.syncBadges();
    this.syncTitleShip();
  }

  // The title screen's idle ship wears the selected ship's silhouette.
  syncTitleShip() {
    const prev = this.game.titleShip;
    if (!prev) return;
    const look = shipLook(this.h.ship);
    prev.getPlayer = () => (look ? { look } : null);
  }

  syncBadges() {
    const fresh = this.h.fresh.length;
    this.doc.querySelectorAll?.('[data-hangar-badge]').forEach((el) => { el.textContent = fresh ? ` · ${fresh} NEW` : ''; });
  }

  open() {
    const g = this.game;
    if (this.isOpen || g.guideOpen || g.notesOpen || g.tutorialOpen || g.state !== 'TITLE') return false;
    this.isOpen = true;
    this.returnFocus = this.doc.activeElement;
    g.resetInput?.();
    g.menuNav?.clear();
    this.root.classList.remove('hidden');
    this.setTab(HANGAR_TABS.find((t) => this.h.fresh.some(TAB_FRESH[t.id]))?.id || 'ships');
    this.body?.focus?.({ preventScroll: true });
    this.tick();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.previews = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.game.menuNav?.clear();
    this.game.menuState = null;
    this.syncBadges();
    this.returnFocus?.focus?.();
  }

  setTab(id) {
    if (!HANGAR_TABS.some((t) => t.id === id)) return;
    this.tab = id;
    this.root.querySelectorAll('[data-hangar-tab]').forEach((b) => {
      const on = b.dataset.hangarTab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    this.render();
  }

  cycleTab(dir) {
    const i = HANGAR_TABS.findIndex((t) => t.id === this.tab);
    this.setTab(HANGAR_TABS[(i + dir + HANGAR_TABS.length) % HANGAR_TABS.length].id);
  }

  render() {
    const h = this.h;
    const sub = this.root.querySelector('[data-hangar-sub]');
    if (sub) sub.textContent = `FLYING ${SHIP_BY_ID[h.ship]?.name || 'VEXOLITH'} · ${h.ships.length} / ${SHIPS.length} SHIPS · ${Object.keys(h.feats).length} / ${FEATS.length} FEATS`;
    for (const t of HANGAR_TABS) {
      const n = t.id === this.tab ? 0 : h.fresh.filter(TAB_FRESH[t.id]).length; // the open tab's NEW ids are seen now
      const el = this.root.querySelector(`[data-hangar-tab-new="${t.id}"]`);
      if (el) el.textContent = n ? `${n} NEW` : '';
    }
    this.body.innerHTML = this.tab === 'ships' ? shipsHTML(h) : this.tab === 'arsenal' ? arsenalHTML(h) : featsHTML(h);
    this.previews = [...this.body.querySelectorAll('[data-ship-canvas]')].map((c) => {
      const id = c.dataset.shipCanvas;
      const look = shipLook(id);
      return { id, locked: !h.ships.includes(id), preview: new ShipPreview(c, { getPlayer: () => (look ? { look } : null), tuning: TUNING }) };
    });
    // What's on screen now has been seen: the NEW badges go next time.
    const seen = TAB_FRESH[this.tab];
    if (h.fresh.some(seen)) {
      h.fresh = h.fresh.filter((f) => !seen(f));
      this.game.progression.save();
    }
  }

  select(id) {
    const h = this.h;
    if (!h.ships.includes(id) || h.ship === id) return;
    h.ship = id;
    this.game.progression.save();
    this.game.sound?.playUiSelect?.();
    // The title ship and the next run fly it; the title's idle player is rebuilt for the preview cards.
    if (this.game.state === 'TITLE') this.game.resetRun?.();
    this.syncTitleShip();
    const scroll = this.body.scrollTop;
    this.render();
    this.body.scrollTop = scroll;
    this.body.querySelector(`[data-select-ship="${id}"]`)?.closest('.hangar-ship')?.focus?.();
  }

  tick() {
    if (!this.isOpen) return;
    const now = performance.now();
    for (const v of this.previews) {
      v.preview.frame(now);
      if (!v.locked) continue;
      // Locked: a dark silhouette with a faint outline.
      const ctx = v.preview.ctx;
      if (!ctx) continue;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(2, 4, 12, 0.86)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }

  handleKey(e, onControl) {
    const code = e.code;
    if (code === 'Escape' || code === 'Backspace') { e.preventDefault?.(); this.close(); return; }
    if (code === 'KeyQ' || code === 'KeyE' || ((code === 'ArrowLeft' || code === 'ArrowRight') && !onControl)) {
      e.preventDefault?.();
      this.cycleTab(code === 'KeyQ' || code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (code === 'ArrowDown' || code === 'ArrowUp') { e.preventDefault?.(); this.body.scrollBy?.(0, code === 'ArrowDown' ? 120 : -120); }
  }

  updateController(gp, dt) {
    const g = this.game;
    if (g.menuState !== 'HANGAR') {
      g.menuState = 'HANGAR';
      g.menuGrace = 0.25;
      g.menuNav?.clear();
    }
    g.menuGrace = Math.max(0, g.menuGrace - dt);
    if (!gp || !g.gpActive || !g.menuNav) return;
    g.menuNav.update(this.root, gp, dt, this.root.querySelector('[data-hangar-tab].active'));
    if (gp.aimY) this.body.scrollBy?.(0, gp.aimY * 16);
    if (g.menuGrace > 0) return;
    if (gp.pressed(PAD.B) || gp.pressed(PAD.START)) this.close();
    else if (gp.pressed(PAD.LB) || gp.pressed(PAD.RB)) this.cycleTab(gp.pressed(PAD.LB) ? -1 : 1);
    else if (gp.pressed(PAD.A)) g.menuNav.activate();
  }

  // Fill (or hide) the strip on the results screen once a run has ended.
  showResults(ledger) {
    if (!this.resultsEl) {
      this.resultsEl = this.doc.createElement('div');
      this.resultsEl.className = 'hangar-results';
      const anchor = this.doc.getElementById('go-global-rank');
      anchor?.parentNode?.insertBefore(this.resultsEl, anchor.nextSibling);
    }
    const html = resultsStripHTML(ledger?.unlocked || [], this.h);
    this.resultsEl.innerHTML = html;
    this.resultsEl.classList.toggle('hidden', !html);
    this.syncBadges();
  }

  // --- Unlock toasts (FeatLedger commits arrive here through game.onFeatsDone) ---
  queueToasts(done) {
    for (const d of done) this.toasts.push(toastText(d));
    this.syncBadges();
    if (this.toastT <= 0) this.nextToast();
  }

  nextToast() {
    const text = this.toasts.shift();
    if (!text) { this.toastEl.classList.add('hidden'); this.toastT = 0; return; }
    this.toastEl.querySelector('.hangar-toast-text').textContent = text;
    this.toastEl.classList.remove('hidden', 'hangar-toast-out');
    this.toastT = TOAST_TIME;
  }

  // Called each frame from the game loop. Toasts wait, hidden, while a level-up hand, a cache, the pause
  // menu, the victory screen or a boss card is up; they run during play and on the title / results.
  update(dt) {
    if (this.toastT <= 0) return;
    const g = this.game;
    const clear = !['UPGRADE', 'CHEST', 'PAUSED', 'VICTORY'].includes(g.state) && !(g.state === 'PLAYING' && g.bossCardTimer > 0);
    this.toastEl.classList.toggle('hidden', !clear);
    if (!clear) return;
    this.toastT -= dt;
    this.toastEl.classList.toggle('hangar-toast-out', this.toastT < 0.4);
    if (this.toastT <= 0) this.nextToast();
  }
}

// Builds the Hangar into the page when the flag is on; null (and nothing added) when it's off.
export function mountHangar(game, doc = globalThis.document) {
  if (!hangarEnabled() || !doc?.createElement || !doc.getElementById?.('title-modal')) return null;
  const ui = new HangarUI(game, doc);
  game.onFeatsDone = (done) => ui.queueToasts(done);
  return ui;
}

export { DEFAULT_SHIP };
