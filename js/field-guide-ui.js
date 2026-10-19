// Field Guide screen: HOSTILES (unlock on first encounter, live previews), MECHANICS, WEAPONS and UPGRADES.
// HTML is built by pure functions (tested in node); FieldGuideUI wires it into #guide-modal, animates
// only the previews that are on screen and clears NEW badges for the entries the player has seen.
import {
  GUIDE_GROUPS, HOSTILE_ENTRIES, MECHANIC_ENTRIES, hostileStatRows, hostileStats, lieutenantModifierRows, resolveText, weaponGuide
} from './field-guide.js';
import { GuidePreview, drawSilhouette, PREVIEW_DT } from './field-guide-scenes.js';

export const GUIDE_TABS = [
  { id: 'hostiles', label: 'HOSTILES' },
  { id: 'mechanics', label: 'MECHANICS' },
  { id: 'weapons', label: 'WEAPONS' },
  { id: 'upgrades', label: 'UPGRADES' }
];

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ENTRY_HUE = { lieutenant: 228, boss: 48, brood_queen: 325, ouroboros: 245, wing_commander: 30, hive_carrier: 120, event_horizon: 280, architect: 55 };

export function hostileCardHTML(entry, { unlocked = false, fresh = false } = {}) {
  const stats = hostileStats(entry.id);
  const hue = ENTRY_HUE[entry.id] ?? stats?.hue ?? 190;
  const cls = `guide-entry guide-hostile${unlocked ? '' : ' locked'}${fresh ? ' fresh' : ''}`;
  const preview = `<div class="guide-preview"><canvas class="guide-canvas" data-preview="${esc(entry.id)}" width="320" height="180"
    aria-label="${unlocked ? `Animated preview: ${esc(entry.name)}` : 'Unknown hostile silhouette'}"></canvas>${unlocked ? '' : '<span class="guide-unknown">???</span>'}${fresh ? '<span class="guide-new">NEW</span>' : ''}</div>`;
  if (!unlocked) {
    const wave = stats?.unlockWave ?? 1;
    return `<article class="${cls}" data-entry="${esc(entry.id)}" data-gp-nav tabindex="0" style="--entry-hue:${hue}">${preview}
      <div class="guide-info"><div class="guide-entry-head"><h3>UNKNOWN SIGNATURE</h3></div>
      <p class="guide-what">Not logged yet. Meet it in a run to unlock its file, stats and counter-play.</p>
      <p class="guide-hint">${entry.id === 'boss' ? 'Signal expected on a boss wave.' : entry.boss ? `Signal expected on wave ${wave}.` : `Signal detected from wave ${wave}.`}</p></div></article>`;
  }
  const chips = hostileStatRows(entry.id).map(([k, v]) => `<span class="guide-stat"><b>${esc(k)}</b> ${esc(v)}</span>`).join('');
  const mods = entry.modifiers
    ? `<ul class="guide-mods">${lieutenantModifierRows().map(m => `<li style="--mod-hue:${m.hue}"><b>${esc(m.label)}</b> ${esc(m.detail)}</li>`).join('')}</ul>`
    : '';
  return `<article class="${cls}" data-entry="${esc(entry.id)}" data-gp-nav tabindex="0" style="--entry-hue:${hue}">${preview}
    <div class="guide-info"><div class="guide-entry-head"><h3>${esc(entry.name)}</h3></div>
    <p class="guide-what">${esc(resolveText(entry.what))}</p>
    <div class="guide-stats">${chips}</div>${mods}
    <p class="guide-tip"><b>HOW TO BEAT IT</b> ${esc(resolveText(entry.tip))}</p></div></article>`;
}

export function hostilesHTML(isUnlocked, isFresh) {
  return GUIDE_GROUPS.map(g => {
    const cards = HOSTILE_ENTRIES.filter(e => e.group === g.id)
      .map(e => hostileCardHTML(e, { unlocked: isUnlocked(e.id), fresh: isFresh(e.id) })).join('');
    return cards ? `<section class="guide-section"><h4 class="guide-section-title">${esc(g.label)}</h4><div class="guide-grid guide-grid-wide">${cards}</div></section>` : '';
  }).join('');
}

// Same chips as the upgrade cards (.upg-tag), so a tag reads identically everywhere.
const chipHTML = (t) => `<span class="upg-tag" style="--tag:${t.color}">${esc(t.label)}</span>`;

export function mechanicsHTML() {
  const rarity = weaponGuide().rarity;
  const cards = MECHANIC_ENTRIES.map(m => {
    const extra = m.rarity ? `<div class="guide-chips">${rarity.map(chipHTML).join('')}</div>` : '';
    return `<article class="guide-entry guide-mechanic" data-entry="${esc(m.id)}" data-gp-nav tabindex="0">
      <div class="guide-entry-head"><span class="guide-icon" aria-hidden="true">${esc(m.icon)}</span><h3>${esc(m.title)}</h3></div>
      ${m.body().map(p => `<p>${esc(p)}</p>`).join('')}${extra}</article>`;
  }).join('');
  return `<section class="guide-section"><div class="guide-grid">${cards}</div></section>`;
}

// Shared card markup for the WEAPONS and UPGRADES tabs.
function upgradeCardHTML(u, category) {
  return `<article class="guide-entry guide-weapon${u.evolution ? ' evolution' : ''}${u.owned ? ' owned' : ''}" data-entry="${esc(u.id)}" data-gp-nav tabindex="0">
      <div class="guide-entry-head"><h3>${esc(u.name.replace(/^SYNERGY:\s*/, ''))}</h3></div>
      <div class="guide-weapon-meta">${esc(category)} · ${u.owned ? `<b>OWNED LV ${u.owned}</b>` : u.evolution ? 'ONE-SHOT' : `MAX LV ${u.maxLevel}`}</div>
      ${u.tags.length ? `<div class="guide-chips">${u.tags.map(chipHTML).join('')}</div>` : ''}
      <p>${esc(u.summary.replace(/^EVOLUTION:\s*/, ''))}</p>${u.recipe ? `<p class="guide-recipe"><b>UNLOCKS WITH</b> ${esc(u.recipe)}</p>` : ''}</article>`;
}

function cardSection(title, list, intro = '') {
  return list.length
    ? `<section class="guide-section"><h4 class="guide-section-title">${esc(title)}</h4>${intro ? `<p class="guide-legend-text">${esc(intro)}</p>` : ''}<div class="guide-grid guide-grid-cards">${list.map(x => upgradeCardHTML(x.u, x.category)).join('')}</div></section>`
    : '';
}

const allCards = (g) => g.categories.flatMap(c => c.items.map(u => ({ u, category: c.id })));

// WEAPONS: the starting kit, then every weapon that can fill a slot (its own level card).
export function weaponsHTML(levels = null) {
  const g = weaponGuide(levels);
  const kit = g.kit.map(k => `<article class="guide-entry guide-weapon kit" data-entry="kit-${esc(k.key)}" data-gp-nav tabindex="0">
    <div class="guide-entry-head"><h3>${esc(k.name)}</h3></div><div class="guide-weapon-meta">STARTING WEAPON</div>
    <div class="guide-chips">${k.tags.map(chipHTML).join('')}</div><p>${esc(k.text)}</p></article>`).join('');
  const arsenal = cardSection('ARSENAL', allCards(g).filter(x => x.u.weapon), 'Pick these from NEW WEAPON cards on level-up. Each takes one of your 6 weapon slots.');
  return `<section class="guide-section"><h4 class="guide-section-title">STARTING KIT</h4><div class="guide-grid guide-grid-cards">${kit}</div></section>${arsenal}`;
}

// UPGRADES: every other level-up card (weapon upgrades, passives, general and tag cards), then evolutions.
export function upgradesHTML(levels = null) {
  const g = weaponGuide(levels);
  const all = allCards(g).filter(x => !x.u.weapon);
  const legend = `<section class="guide-section"><h4 class="guide-section-title">TAGS</h4><p class="guide-legend-text">Tag cards (Tungsten Penetrators, Shaped Charges, Overvolt Coils, Field Amplifier) boost every weapon that carries their tag.</p>
    <div class="guide-chips guide-legend">${g.tags.map(chipHTML).join('')}</div></section>`;
  return cardSection('UPGRADE CARDS', all.filter(x => !x.u.evolution)) + cardSection('EVOLUTIONS', all.filter(x => x.u.evolution)) + legend;
}

export function tabHTML(tab, { isUnlocked = () => false, isFresh = () => false, levels = null } = {}) {
  if (tab === 'mechanics') return mechanicsHTML();
  if (tab === 'weapons') return weaponsHTML(levels);
  if (tab === 'upgrades') return upgradesHTML(levels);
  return hostilesHTML(isUnlocked, isFresh);
}

// DOM controller. `progression` is the ProgressionManager; `getLevels()` returns the current run's
// upgrade levels (or null on the title screen) for the WEAPONS tab's OWNED marks.
export class FieldGuideUI {
  constructor({ progression, getLevels = () => null, onClose = null }) {
    this.progression = progression;
    this.getLevels = getLevels;
    this.onClose = onClose;
    this.root = document.getElementById('guide-modal');
    this.body = document.getElementById('guide-body');
    this.tabButtons = Array.from(this.root.querySelectorAll('[data-guide-tab]'));
    this.tab = 'hostiles';
    this.isOpen = false;
    this.previews = new Map(); // canvas -> GuidePreview
    this.visible = new Set();
    this.viewed = new Set();
    this.raf = 0;
    this.lastFrame = 0;
    this.acc = 0;
    this.tabButtons.forEach(btn => btn.addEventListener('click', () => this.setTab(btn.dataset.guideTab)));
    document.getElementById('btn-guide-close')?.addEventListener('click', () => this.close());
    this.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => this.onIntersect(entries), { root: this.body, threshold: 0.15 })
      : null;
  }

  open({ tab = null, focusId = null } = {}) {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.setTab(tab || this.tab, true);
    if (focusId) this.reveal(focusId);
    this.startLoop();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.stopLoop();
    if (this.viewed.size) this.progression.markGuideViewed([...this.viewed]);
    this.viewed.clear();
    this.onClose?.();
  }

  freshCount() {
    return this.progression.data.guide.fresh.length;
  }

  setTab(id, force = false) {
    if (!GUIDE_TABS.some(t => t.id === id)) return;
    if (id === this.tab && !force) return;
    this.tab = id;
    this.tabButtons.forEach(btn => {
      const on = btn.dataset.guideTab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.render();
  }

  cycleTab(dir) {
    const i = GUIDE_TABS.findIndex(t => t.id === this.tab);
    this.setTab(GUIDE_TABS[(i + dir + GUIDE_TABS.length) % GUIDE_TABS.length].id);
  }

  activeTabButton() {
    return this.tabButtons.find(btn => btn.dataset.guideTab === this.tab) || null;
  }

  render() {
    const guide = this.progression.data.guide;
    this.observer?.disconnect();
    this.previews.clear();
    this.visible.clear();
    this.body.innerHTML = tabHTML(this.tab, {
      isUnlocked: id => guide.seen.includes(id),
      isFresh: id => guide.fresh.includes(id),
      levels: this.getLevels()
    });
    this.body.scrollTop = 0;
    this.updateCounts();
    for (const canvas of this.body.querySelectorAll('canvas[data-preview]')) {
      const unlocked = !canvas.closest('.locked');
      if (!unlocked) this.sizeCanvas(canvas) && drawSilhouette(canvas.getContext('2d'), canvas.dataset.preview, canvas.width, canvas.height);
      if (this.observer) this.observer.observe(canvas.closest('.guide-entry'));
      else if (unlocked) this.visible.add(canvas);
    }
    if (!this.observer) this.body.querySelectorAll('.guide-entry.fresh').forEach(el => this.viewed.add(el.dataset.entry));
  }

  updateCounts() {
    const guide = this.progression.data.guide;
    const total = HOSTILE_ENTRIES.length;
    const logged = HOSTILE_ENTRIES.filter(e => guide.seen.includes(e.id)).length;
    const progress = document.getElementById('guide-progress');
    if (progress) progress.textContent = `${logged} / ${total} HOSTILES LOGGED`;
    const badge = document.getElementById('guide-tab-new');
    if (badge) {
      const fresh = HOSTILE_ENTRIES.filter(e => guide.fresh.includes(e.id)).length;
      badge.textContent = fresh ? `${fresh} NEW` : '';
    }
  }

  // Backing store follows the canvas's on-screen size (crisp on hi-dpi, capped at 2x).
  sizeCanvas(canvas) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(160, Math.round((canvas.clientWidth || 320) * dpr));
    const h = Math.round(w * 9 / 16);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return true;
  }

  onIntersect(entries) {
    for (const entry of entries) {
      const el = entry.target;
      const canvas = el.querySelector('canvas[data-preview]');
      if (entry.isIntersecting) {
        if (el.classList.contains('fresh')) this.viewed.add(el.dataset.entry);
        if (canvas && !el.classList.contains('locked')) this.visible.add(canvas);
      } else if (canvas) {
        this.visible.delete(canvas);
      }
    }
  }

  reveal(id) {
    const el = this.body.querySelector(`[data-entry="${CSS.escape ? CSS.escape(id) : id}"]`);
    el?.scrollIntoView?.({ block: 'center' });
    return el || null;
  }

  scrollBy(dy) {
    this.body.scrollTop += dy;
  }

  startLoop() {
    if (this.raf) return;
    this.lastFrame = performance.now();
    this.acc = 0;
    const frame = (now) => {
      if (!this.isOpen) { this.raf = 0; return; }
      this.acc = Math.min(this.acc + Math.min(0.1, (now - this.lastFrame) / 1000), PREVIEW_DT * 4);
      this.lastFrame = now;
      let steps = 0;
      while (this.acc >= PREVIEW_DT) { this.acc -= PREVIEW_DT; steps++; }
      if (steps > 0) this.drawVisible(steps);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // Only on-screen previews step and draw; each is created the first time it scrolls into view.
  drawVisible(steps) {
    for (const canvas of this.visible) {
      let preview = this.previews.get(canvas);
      if (!preview) {
        preview = new GuidePreview(canvas.dataset.preview);
        this.previews.set(canvas, preview);
        this.sizeCanvas(canvas);
        for (let k = 0; k < 20; k++) preview.step();
      }
      for (let k = 0; k < steps; k++) preview.step();
      preview.draw(canvas.getContext('2d'), canvas.width / preview.W);
    }
  }
}
