// Weapon Range panel: the collapsible side panel over a range run (LOADOUT, MODS and DUMMIES tabs) with
// the live DPS readout on top. Every edit goes through WeaponRange.setConfig (js/weapon-range.js) and
// applies at once. Controls are plain buttons, so mouse, keyboard (Tab / Enter) and the controller
// (Back opens it as a menu, B returns to flying) all work; steppers never disable themselves, so a
// controller's focus doesn't jump away at a limit.
import {
  RANGE_FORMATIONS, RANGE_TARGETS, RANGE_MOD_GROUPS, DUMMY_COUNTS, MAX_WAVE, DPS_WINDOW,
  autoRanks, clampRanks, entryRanks, entryLevel, entryBuild, entryElement
} from './weapon-range.js';
import { WEAPON_MAX_LEVEL, BREAKTHROUGH_LEVELS, STAT_CARDS, TRANSFORMS, BOOST_NAME, ELEMENTS, ELEMENT_CARDS, ELEMENT_INFO, ELEMENT_MAX_RANKS } from './weapon-levels.js';
import { WEAPONS, WEAPON_BY_ID, weaponSlots } from './loadout.js';
import { UPGRADE_BY_ID } from './upgrades.js';
import { formatCompact } from './run-report.js';

// Short names for the stat card ranks (weapon-levels.js STAT_CARDS `stat`).
const STAT_NAMES = {
  damage: 'Damage', prism: 'Prism Split', rate: 'Fire rate', pierce: 'Pierce', count: 'Count', reload: 'Reload', radius: 'Blast size',
  salvo: 'Salvo', chain: 'Chain', recharge: 'Recharge', reach: 'Reach', pull: 'Pull', duration: 'Lifetime', cooldown: 'Cooldown',
  core: 'Core size', spin: 'Spin', size: 'Blade size', capacity: 'Capacity', fuse: 'Fuse', lifetime: 'Lifetime', redeploy: 'Redeploy',
  wingmen: 'Wingmen', range: 'Range', linger: 'Linger'
};
const TABS = [['loadout', 'LOADOUT'], ['mods', 'MODS'], ['dummies', 'DUMMIES']];
const NARROW = 760; // px: the panel starts collapsed on screens this narrow

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dps = (v) => formatCompact(v);
const modName = (u) => u.name.replace(/^SYNERGY:\s*/, '');

// A panel button. `key` identifies it across re-renders, so focus survives an edit.
function btn(act, label, { w = '', v = '', d = '', cls = '', off = false, title = '', pressed = null } = {}) {
  const key = `${act}|${w}|${v}|${d}`;
  const attrs = [
    `class="rg-btn${cls ? ` ${cls}` : ''}${off ? ' is-off' : ''}"`, `data-act="${act}"`, `data-key="${esc(key)}"`,
    w && `data-w="${w}"`, v !== '' && `data-v="${esc(v)}"`, d !== '' && `data-d="${d}"`,
    title && `title="${esc(title)}"`, off && 'aria-disabled="true"', pressed !== null && `aria-pressed="${pressed}"`
  ].filter(Boolean);
  return `<button type="button" ${attrs.join(' ')}>${label}</button>`;
}

const stepper = (act, value, opts = {}) =>
  `<span class="rg-stepper">${btn(act, '−', { ...opts, d: -1, title: 'Less' })}<span class="rg-val">${value}</span>${btn(act, '+', { ...opts, d: 1, title: 'More' })}</span>`;

const segmented = (act, options, current) =>
  `<span class="rg-seg">${options.map(([id, label]) => btn(act, label, { v: id, cls: id === current ? 'is-on' : '', pressed: id === current })).join('')}</span>`;

// The live readout: rolling DPS in total, per weapon against its potential, and per damage source.
export function readoutHtml(r, { compact = false } = {}) {
  const head = `<div class="rg-total"><span class="rg-total-val">${dps(r.total)}</span><span class="rg-total-unit">DPS</span>`
    + `<span class="rg-total-meta">${dps(r.dealt)} dealt · ${Math.floor(r.elapsed)} s · avg ${dps(r.average)}</span></div>`;
  if (compact) return head;
  const weapons = r.weapons.map((w) => {
    const pct = w.potential > 0 ? Math.min(100, (w.live / w.potential) * 100) : 0;
    return `<div class="rg-cmp" style="--wc:${w.color}"><span class="rg-dot"></span><span class="rg-cmp-name">${esc(w.name)} <i>LV ${w.level}</i></span>`
      + `<span class="rg-cmp-num"><b>${dps(w.live)}</b> / ${dps(w.potential)}</span><span class="rg-bar"><span style="width:${pct.toFixed(1)}%"></span></span></div>`;
  }).join('');
  const top = Math.max(1, ...r.rows.map((x) => x.dps));
  const rows = r.rows.length
    ? r.rows.map((x) => `<div class="rg-src" style="--wc:${x.color}"><span class="rg-dot"></span><span class="rg-src-name">${esc(x.label)}</span>`
      + `<span class="rg-src-num"><b>${dps(x.dps)}</b><i>${dps(x.dealt)}</i></span><span class="rg-bar"><span style="width:${((x.dps / top) * 100).toFixed(1)}%"></span></span></div>`).join('')
    : '<div class="rg-empty">No hits yet: spawn dummies and open fire.</div>';
  return `${head}${weapons ? `<div class="rg-sub">LIVE / POTENTIAL (one target)</div>${weapons}` : ''}`
    + `<div class="rg-sub">BY SOURCE <span>DPS · DEALT</span></div>${rows}`;
}

export class RangePanel {
  constructor(range, root = globalThis.document?.getElementById('range-panel')) {
    this.range = range;
    this.root = root || null;
    this.tab = 'loadout';
    this.collapsed = false;
    this.root?.addEventListener('click', (e) => this.onClick(e));
  }

  get game() {
    return this.range.game;
  }

  show() {
    globalThis.document?.body.classList.add('range-mode');
    this.collapsed = (globalThis.innerWidth || 1280) <= NARROW;
    this.root?.classList.remove('hidden');
    this.render();
  }

  hide() {
    globalThis.document?.body.classList.remove('range-mode');
    this.root?.classList.add('hidden');
    this.root?.classList.remove('pad-edit');
  }

  // Controller: Back hands the pad to the panel (the sim holds); B, Back or Start give it back.
  beginPadEdit() {
    const g = this.game;
    if (g.state !== 'PLAYING') return;
    g.resetInput();
    g.state = 'RANGE_EDIT';
    this.collapsed = false;
    this.root?.classList.add('pad-edit');
    this.render();
  }

  endPadEdit() {
    const g = this.game;
    if (g.state === 'RANGE_EDIT') g.state = 'PLAYING';
    this.root?.classList.remove('pad-edit');
    g.menuNav?.clear();
    globalThis.document?.activeElement?.blur?.();
  }

  // Keys while the pad edits the panel: Escape returns to flying; nothing else reaches the ship.
  handleKey(e) {
    if (this.game.state !== 'RANGE_EDIT') return false;
    if (e.code === 'Escape' || e.code === 'Backspace') {
      e.preventDefault();
      this.endPadEdit();
    }
    return true;
  }

  onClick(e) {
    const el = e.target.closest?.('[data-act]');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    this.game.sound?.playUiSelect?.();
    this.act(el.dataset.act, el.dataset);
  }

  // One panel action (button data attributes); config edits go to the range and re-render.
  act(act, { w = '', v = '', d = '0' } = {}) {
    const range = this.range;
    const step = Number(d) || 0;
    switch (act) {
      case 'collapse': this.collapsed = !this.collapsed; return this.render();
      case 'exit': return range.exit();
      case 'tab': this.tab = v; return this.render();
      case 'reset': range.resetMeter(); return this.tick();
      case 'spawn': range.spawnDummies(); return this.render();
      case 'clear': range.clearDummies(); return this.render();
    }
    const cfg = structuredClone(range.config);
    const entry = cfg.weapons.find((x) => x.id === w);
    const dm = cfg.dummies;
    const cycle = (list, cur) => list[(list.indexOf(cur) + step + list.length) % list.length];
    switch (act) {
      case 'add': if (cfg.weapons.length < weaponSlots()) cfg.weapons.push({ id: v, level: 1, custom: false, ranks: {}, bt: {}, element: null, elementRank: 1 }); break;
      case 'remove': cfg.weapons = cfg.weapons.filter((x) => x.id !== w); break;
      case 'lv': if (entry && !entry.custom) entry.level = Math.max(1, Math.min(WEAPON_MAX_LEVEL, entry.level + step)); break;
      case 'ranks-mode':
        if (!entry) break;
        if (entry.custom) entry.level = entryLevel(entry);
        else entry.ranks = autoRanks(entry.id, entry.level);
        entry.custom = !entry.custom;
        break;
      case 'rank': if (entry) entry.ranks = clampRanks(entry.id, { ...entry.ranks, [v]: (entry.ranks[v] || 0) + step }); break;
      case 'bt': if (entry) entry.bt = { ...entry.bt, [v]: entry.bt?.[v] === 'boost' ? 'transform' : 'boost' }; break;
      case 'el':
        if (!entry) break;
        // AUTO keeps the stat ranks it had: the element's ranks come on top of the level.
        if (!entry.custom) entry.level = Math.min(WEAPON_MAX_LEVEL, entryLevel(entry) - (entryElement(entry)?.rank || 0) + (v === 'none' ? 0 : entry.elementRank || 1));
        entry.element = v === 'none' ? null : v;
        break;
      case 'elrank':
        if (!entry?.element) break;
        entry.elementRank = Math.max(1, Math.min(ELEMENT_MAX_RANKS, (entry.elementRank || 1) + step));
        if (!entry.custom) entry.level = Math.max(1, Math.min(WEAPON_MAX_LEVEL, entry.level + step));
        break;
      case 'mod': cfg.mods[v] = Math.max(0, Math.min(UPGRADE_BY_ID[v].maxLevel, (cfg.mods[v] || 0) + step)); break;
      case 'type': dm.type = cycle(RANGE_TARGETS.map((t) => t.id), dm.type); break;
      case 'count': dm.count = cycle(DUMMY_COUNTS, DUMMY_COUNTS.includes(dm.count) ? dm.count : 12); break;
      case 'formation': dm.formation = v; break;
      case 'hp': dm.hp = v; break;
      case 'wave': dm.wave = Math.max(1, Math.min(MAX_WAVE, dm.wave + step)); break;
      case 'move': dm.move = v; break;
      case 'respawn': dm.respawn = !dm.respawn; break;
      default: return;
    }
    range.setConfig(cfg);
    this.render();
  }

  render() {
    const root = this.root;
    if (!root || root.classList.contains('hidden')) return;
    const doc = globalThis.document;
    const keyOf = (el) => (el && root.contains(el) ? el.dataset?.key : null);
    const focusKey = keyOf(doc?.activeElement);
    const padKey = keyOf(this.game.menuNav?.focused);
    const scroll = root.querySelector('.rg-scroll')?.scrollTop || 0;
    root.innerHTML = this.html();
    const find = (key) => (key ? root.querySelector(`[data-key="${CSS.escape(key)}"]`) : null);
    find(focusKey)?.focus({ preventScroll: true });
    const padEl = find(padKey);
    if (padEl) this.game.menuNav.setFocus(padEl);
    const sc = root.querySelector('.rg-scroll');
    if (sc) sc.scrollTop = scroll;
    this.tick();
  }

  // Readout refresh (a few times a second while the range runs).
  tick() {
    const el = this.root?.querySelector('.rg-readout');
    if (el) el.innerHTML = readoutHtml(this.range.readout(), { compact: this.collapsed });
  }

  html() {
    const head = `<div class="rg-head"><div class="rg-head-title"><span class="rg-kicker">SANDBOX · NOTHING IS RECORDED</span>`
      + `<span class="rg-title">🎯 WEAPON RANGE</span></div>`
      + btn('collapse', this.collapsed ? '▸ OPEN' : '▾ HIDE', { cls: 'rg-mini', title: 'Show or hide the panel' })
      + btn('exit', '◀ EXIT', { cls: 'rg-mini rg-exit', title: 'Back to the title screen' }) + '</div>';
    const readout = `<div class="rg-readout-head"><span>LIVE DPS · ${DPS_WINDOW} S WINDOW</span>${btn('reset', '↺ RESET', { cls: 'rg-mini', title: 'Reset the DPS meter' })}</div>`
      + '<div class="rg-readout" aria-live="off"></div>';
    if (this.collapsed) return `${head}${readout}`;
    const tabs = `<div class="rg-tabs" role="tablist">${TABS.map(([id, label]) => btn('tab', label, { v: id, cls: id === this.tab ? 'is-on' : '', pressed: id === this.tab })).join('')}</div>`;
    const pane = this.tab === 'mods' ? this.modsHtml() : this.tab === 'dummies' ? this.dummiesHtml() : this.loadoutHtml();
    const foot = '<div class="rg-foot">🎮 <b>BACK</b> edit panel · <b>B</b> fly · <b>START</b> / <b>ESC</b> pause</div>';
    return `${head}<div class="rg-scroll">${readout}${tabs}<div class="rg-pane">${pane}</div></div>${foot}`;
  }

  loadoutHtml() {
    const cfg = this.range.config;
    const cards = cfg.weapons.map((w) => this.weaponHtml(w)).join('') || '<div class="rg-empty">No weapons: add one below.</div>';
    const full = cfg.weapons.length >= weaponSlots();
    const add = WEAPONS.filter((x) => !cfg.weapons.some((w) => w.id === x.id))
      .map((x) => btn('add', `+ ${esc(x.hudName)}`, { v: x.id, cls: 'rg-add', off: full, title: full ? 'Every slot is full' : `Equip ${x.name}` }))
      .join('');
    return `<div class="rg-sec">WEAPONS <span>${cfg.weapons.length} / ${weaponSlots()} SLOTS</span></div>${cards}`
      + `<div class="rg-sec">ADD WEAPON</div><div class="rg-addlist" style="--wc:#00f3ff">${add || '<span class="rg-dim">Every weapon is equipped.</span>'}</div>`;
  }

  weaponHtml(w) {
    const info = WEAPON_BY_ID[w.id];
    const lv = entryLevel(w);
    const ranks = entryRanks(w);
    const potential = this.range.potential[w.id];
    const head = `<div class="rg-w-head"><span class="rg-dot"></span><span class="rg-w-name">${esc(info.hudName)}</span>`
      + (w.custom ? `<span class="rg-val rg-lv">LV ${lv}</span>` : stepper('lv', `LV ${lv}`, { w: w.id }))
      + btn('remove', '✕', { w: w.id, cls: 'rg-mini rg-x', title: `Remove ${info.name}` }) + '</div>';
    const mode = `<div class="rg-row"><span class="rg-label">RANKS</span>${btn('ranks-mode', w.custom ? 'CUSTOM' : 'AUTO', { w: w.id, cls: 'rg-mini', title: 'AUTO spreads the level over every stat; CUSTOM sets each stat' })}`
      + `<span class="rg-dim">${potential ? `${dps(potential)} potential DPS` : ''}</span></div>`;
    // AUTO: the chip the current level's rank went into is lit, so an extra rocket or missile at some
    // levels is visibly the Count/Salvo rank that level added.
    const prev = !w.custom && lv > 1 ? autoRanks(w.id, lv - 1) : null;
    const rankRows = (STAT_CARDS[w.id] || []).map((c) => w.custom
      ? `<div class="rg-row rg-rank"><span class="rg-label">${STAT_NAMES[c.stat] || c.stat}</span>${stepper('rank', `${ranks[c.id]} / ${c.maxLevel}`, { w: w.id, v: c.id })}</div>`
      : `<span class="rg-chip${prev && ranks[c.id] > prev[c.id] ? ' is-new' : ''}">${STAT_NAMES[c.stat] || c.stat} ${ranks[c.id]}</span>`).join('');
    const autoNote = w.custom ? '' : '<span class="rg-dim rg-auto-note">AUTO adds one rank per level, cycling through every stat (lit: this level\'s). CUSTOM picks them.</span>';
    const bt = BREAKTHROUGH_LEVELS.map((m) => {
      const locked = lv < m;
      const boost = w.bt?.[m] === 'boost';
      const label = `<b>LV ${m}</b> ${boost ? `⚛ ${BOOST_NAME.toUpperCase()}` : `⚛ ${esc(TRANSFORMS[w.id][m].name)}`}`;
      return btn('bt', label, {
        w: w.id, v: m, cls: `rg-bt ${boost ? 'is-boost' : 'is-transform'}`, off: locked,
        title: locked ? `Reach LV ${m} to install` : `${boost ? BOOST_NAME : TRANSFORMS[w.id][m].summary} (click to swap)`
      });
    }).join('');
    const build = entryBuild(w);
    const note = build.transforms || build.atb ? '' : '<span class="rg-dim">Breakthroughs unlock at LV 6, 12 and 18.</span>';
    // Element (FIRE / FROST / CORROSIVE / SHOCK) and its rank, for the five element-capable weapons.
    const el = entryElement(w);
    const elRow = ELEMENT_CARDS[w.id]
      ? `<div class="rg-row rg-wrap"><span class="rg-label">ELEMENT</span><span class="rg-seg">${[['none', 'NONE'], ...ELEMENTS.map((x) => [x, ELEMENT_INFO[x].label])]
        .map(([id, label]) => btn('el', label, { w: w.id, v: id, cls: id === (el?.element || 'none') ? 'is-on' : '', pressed: id === (el?.element || 'none') })).join('')}</span>`
        + (el ? stepper('elrank', `RANK ${el.rank} / ${ELEMENT_MAX_RANKS}`, { w: w.id }) : '') + '</div>'
      : '';
    return `<div class="rg-weapon" style="--wc:${info.color}">${head}${mode}`
      + `<div class="${w.custom ? 'rg-ranks' : 'rg-chips'}">${rankRows}${autoNote}</div>${elRow}<div class="rg-bts">${bt}${note}</div></div>`;
  }

  modsHtml() {
    const cfg = this.range.config;
    const owned = new Set(cfg.weapons.map((w) => w.id));
    const nameOf = (id) => WEAPON_BY_ID[id]?.hudName || id;
    return RANGE_MOD_GROUPS.map((g) => {
      const rows = g.ids.map((id) => {
        const u = UPGRADE_BY_ID[id];
        const lv = cfg.mods[id] || 0;
        let needs = '';
        if (u.ownersAll && !u.ownersAll.every((x) => owned.has(x))) needs = `needs ${u.ownersAll.map(nameOf).join(' + ')}`;
        else if (u.owners && !u.owners.some((x) => owned.has(x))) needs = `needs ${u.owners.map(nameOf).join(' or ')}`;
        const control = u.maxLevel === 1
          ? btn('mod', lv ? 'ON' : 'OFF', { v: id, d: lv ? -1 : 1, cls: `rg-mini rg-toggle${lv ? ' is-on' : ''}`, off: !!needs, pressed: !!lv })
          : `<span class="rg-stepper">${btn('mod', '−', { v: id, d: -1, off: !!needs })}<span class="rg-val">${lv} / ${u.maxLevel}</span>${btn('mod', '+', { v: id, d: 1, off: !!needs })}</span>`;
        return `<div class="rg-row rg-mod${needs ? ' is-needs' : ''}" title="${esc(u.summary)}"><span class="rg-label">${esc(modName(u))}`
          + `${needs ? `<i>${esc(needs)}</i>` : ''}</span>${control}</div>`;
      }).join('');
      return `<div class="rg-sec">${g.label}</div>${rows}`;
    }).join('');
  }

  dummiesHtml() {
    const d = this.range.config.dummies;
    const target = RANGE_TARGETS.find((t) => t.id === d.type)?.label || d.type;
    const live = this.game.enemyManager?.enemies?.length || 0;
    const waveStep = `<span class="rg-stepper">${btn('wave', '«', { d: -5, title: '-5 waves' })}${btn('wave', '‹', { d: -1, title: '-1 wave' })}`
      + `<span class="rg-val">WAVE ${d.wave}</span>${btn('wave', '›', { d: 1, title: '+1 wave' })}${btn('wave', '»', { d: 5, title: '+5 waves' })}</span>`;
    return '<div class="rg-sec">NEXT SPAWN</div>'
      + `<div class="rg-row"><span class="rg-label">TARGET</span>${stepper('type', target)}</div>`
      + `<div class="rg-row"><span class="rg-label">COUNT</span>${stepper('count', d.count)}</div>`
      + `<div class="rg-row rg-wrap"><span class="rg-label">FORMATION</span>${segmented('formation', RANGE_FORMATIONS.map((f) => [f.id, f.label]), d.formation)}</div>`
      + `<div class="rg-actions">${btn('spawn', '+ SPAWN DUMMIES', { cls: 'rg-go' })}${btn('clear', '✕ CLEAR', { cls: 'rg-clear' })}</div>`
      + `<div class="rg-dim rg-live">${live} on the field</div>`
      + '<div class="rg-sec">EVERY DUMMY (LIVE)</div>'
      + `<div class="rg-row rg-wrap"><span class="rg-label">HP</span>${segmented('hp', [['infinite', '∞ INFINITE'], ['wave', 'WAVE HP']], d.hp)}</div>`
      + `<div class="rg-row rg-wrap"><span class="rg-label" title="HP (in WAVE HP mode) and speed follow this wave">SCALE</span>${waveStep}</div>`
      + `<div class="rg-row rg-wrap"><span class="rg-label">MOVEMENT</span>${segmented('move', [['still', 'STATIONARY'], ['ai', 'NORMAL AI']], d.move)}</div>`
      + `<div class="rg-row"><span class="rg-label">RESPAWN KILLS</span>${btn('respawn', d.respawn ? 'ON' : 'OFF', { cls: `rg-mini rg-toggle${d.respawn ? ' is-on' : ''}`, pressed: d.respawn })}</div>`
      + '<div class="rg-dim rg-note">Dummies never hurt your ship. Kills drop nothing.</div>';
  }
}
