// Run overview: the pause menu's big ship, run summary and LOADOUT / STATS / UPGRADES / SETTINGS tabs,
// plus the loadout strip on the level-up screen. The model functions are pure (no DOM), so tests can
// check the stat split and its formatting; RunOverview wires them into the pause modal.
//
// Stat split: every stat is read off three snapshots of the ship. BASE is a fresh run-start ship with no
// Void Armory ranks (upgrades.js runStartPlayer({})), RUN START is the ship as this run launched (the
// player.base snapshot plus the armory multipliers that live on the player), and TOTAL is the ship now.
// PERMANENT = RUN START vs BASE (Void Armory) and THIS RUN = TOTAL vs RUN START (cards picked this run).
import { TUNING } from './config.js';
import { runStartPlayer, runUpgradeLines, HIT_INVULN_BASE } from './upgrades.js';
import { WEAPON_SCALING as W, blasterFireRate, baseDamage } from './weapon-scaling.js';
import { weaponBuild, weaponElement, ELEMENT_INFO } from './weapon-levels.js';
import { WEAPON_BY_ID, PASSIVE_BY_ID, ownedWeapons, ownedPassives, weaponLevel, weaponSlots } from './loadout.js';
import { weaponPotentialDps, bonusLevels, bonusText, maxText } from './upgrade-cards.js';
import { formatCompact, OTHER_GROUP_INFO } from './run-report.js';
import { GAME_VERSION, versionLabel } from './version.js';
import { modeRules } from './modes.js';
import { ShipPreview } from './ship-preview.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MINUS = '−';
const trim = (text) => text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
const fixed = (v, dec) => trim(Number(v).toFixed(dec));
const pctNum = (n) => fixed(n, Math.abs(n) < 10 && Math.abs(n % 1) > 1e-9 ? 1 : 0);

// --- Stat split -----------------------------------------------------------------------------------

// kind 'mult': the armory and cards scale the stat, so PERMANENT and THIS RUN read as % changes.
// kind 'add': they add to it, so those columns show what was added, in the stat's own unit.
// fmt: how values read (see formatStatValue). lower: smaller is better (colours the change).
export const STAT_GROUPS = [
  {
    id: 'offense', label: 'OFFENSE', rows: [
      { id: 'damage', label: 'Damage (every weapon)', kind: 'mult', fmt: 'num1', get: (s) => baseDamage(s) },
      { id: 'fireRate', label: 'Autocannon fire rate', kind: 'mult', fmt: 'rate', get: (s) => blasterFireRate(s, weaponBuild(s, 'blaster')) },
      { id: 'critChance', label: 'Crit chance', kind: 'add', fmt: 'pct', get: (s) => Math.min(1, s.stats.critChance ?? 0) },
      { id: 'critDamage', label: 'Crit damage', kind: 'add', fmt: 'pct', get: (s) => s.stats.critDamage ?? 1.5 },
      { id: 'area', label: 'Area size', kind: 'add', fmt: 'pct', get: (s) => s.stats.areaMult ?? 1 },
      ...['kinetic', 'explosive', 'electric'].map((tag) => ({
        id: `tag_${tag}`, label: `${tag[0].toUpperCase()}${tag.slice(1)} weapon damage`, kind: 'add', fmt: 'pct', get: (s) => s.stats.tagDamage?.[tag] ?? 1
      }))
    ]
  },
  {
    id: 'defense', label: 'DEFENSE', rows: [
      { id: 'maxHp', label: 'Max shield', kind: 'add', fmt: 'flat', get: (s) => s.maxHp },
      // HARDCORE has none (js/modes.js): every snapshot carries the run's mode, so it reads 0 throughout.
      { id: 'regen', label: 'Shield regen', kind: 'add', fmt: 'hps', get: (s, t) => (modeRules(s).shieldRegen ? t.shieldRegenRate ?? 1.2 : 0) },
      { id: 'damageTaken', label: 'Damage taken', kind: 'mult', fmt: 'pct', lower: true, get: (s) => s.damageTakenMult ?? 1 },
      { id: 'invuln', label: 'Invulnerable after a hit', kind: 'add', fmt: 'sec', get: (s) => HIT_INVULN_BASE + (s.hitInvulnBonus || 0) }
    ]
  },
  {
    id: 'mobility', label: 'MOBILITY', rows: [
      { id: 'moveSpeed', label: 'Move speed', kind: 'mult', fmt: 'num1', get: (s) => s.stats.moveSpeed },
      {
        id: 'dash', label: 'Dash cooldown', kind: 'add', fmt: 'sec', lower: true,
        get: (s, t) => W.dashCooldown(s.weapons?.dashNova || 0, t.dashCooldownBase ?? 1.5) * (s.dashCooldownMult ?? 1)
      }
    ]
  },
  {
    id: 'drill', label: 'DRILL CLAWS', rows: [
      { id: 'miningSpeed', label: 'Drill speed', kind: 'mult', fmt: 'rate0', get: (s) => s.stats.miningSpeed },
      { id: 'miningRange', label: 'Drill reach', kind: 'mult', fmt: 'num0', get: (s) => s.stats.miningRange },
      { id: 'drillScale', label: 'Drill size', kind: 'mult', fmt: 'x', get: (s) => s.stats.drillScale }
    ]
  },
  {
    id: 'economy', label: 'PICKUPS & ECONOMY', rows: [
      { id: 'magnet', label: 'Pickup radius', kind: 'mult', fmt: 'num0', get: (s) => s.stats.magnetRadius },
      { id: 'xp', label: 'XP gain', kind: 'mult', fmt: 'pct', get: (s) => s.stats.xpMultiplier },
      { id: 'luck', label: 'Luck', kind: 'add', fmt: 'pct', get: (s) => s.stats.luck },
      { id: 'cores', label: 'Void Core gain', kind: 'mult', fmt: 'pct', get: (s) => s.stats.coreDropMult },
      { id: 'gold', label: 'Gold per vein', kind: 'mult', fmt: 'pct', get: (s) => s.goldMult ?? 1 },
      { id: 'reroll', label: 'Reroll cost', kind: 'mult', fmt: 'pct', lower: true, get: (s) => s.rerollCostMult ?? 1 }
    ]
  }
];

export function formatStatValue(fmt, v) {
  const n = Number(v) || 0;
  switch (fmt) {
    case 'pct': return `${pctNum(n * 100)}%`;
    case 'sec': return `${n.toFixed(2)} s`;
    case 'rate': return `${n.toFixed(1)}/s`;
    case 'rate0': return `${Math.round(n)}/s`;
    case 'hps': return `${fixed(n, 1)}/s`;
    case 'x': return `×${n.toFixed(2)}`;
    case 'num1': return fixed(n, 1);
    default: return String(Math.round(n));
  }
}

// The change from `from` to `to` as a column entry: '—' for none, else a signed % (kind 'mult') or a
// signed amount in the stat's unit (kind 'add').
export function formatStatDelta(kind, fmt, from, to) {
  const sign = (v) => (v < 0 ? MINUS : '+');
  if (kind === 'mult') {
    if (!(from > 0)) return '—';
    const pct = (to / from - 1) * 100;
    return Math.abs(pct) < 0.05 ? '—' : `${sign(pct)}${pctNum(Math.abs(pct))}%`;
  }
  const d = to - from;
  if (Math.abs(d) < 1e-9) return '—';
  const a = Math.abs(d);
  switch (fmt) {
    case 'pct': return `${sign(d)}${pctNum(a * 100)}%`;
    case 'sec': return `${sign(d)}${a.toFixed(2)} s`;
    case 'hps': case 'rate': return `${sign(d)}${fixed(a, 1)}/s`;
    case 'x': return `${sign(d)}×${a.toFixed(2)}`;
    case 'num1': return `${sign(d)}${fixed(a, 1)}`;
    default: return `${sign(d)}${Math.round(a)}`;
  }
}

// The three snapshots. `bonuses` (Void Armory) is only used when the player has no run-start snapshot.
// All three fly the player's game mode, so mode rules (HARDCORE's regen) never read as a change.
export function statSnapshots(player, { bonuses = {}, tuning = TUNING } = {}) {
  const bare = (src) => ({ ...src, mode: player.mode, weapons: {}, upgradeLevels: {}, breakthroughs: {} });
  const base = bare(runStartPlayer({}, tuning));
  let start;
  if (player.base) {
    // Armory multipliers outside `stats` are set at run start and never touched by cards.
    const { damageTakenMult, hitInvulnBonus, dashCooldownMult, goldMult, rerollCostMult } = player;
    start = bare({ damageTakenMult, hitInvulnBonus, dashCooldownMult, goldMult, rerollCostMult, stats: player.base.stats, maxHp: player.base.maxHp });
    start.weapons = player.base.weapons || {};
  } else {
    start = bare(runStartPlayer(bonuses, tuning));
  }
  return { base, start, total: player };
}

// Rows grouped as STAT_GROUPS, each { id, label, base, permanent, run, total, up: { permanent, run } }
// where `up` says whether that change is good (true), bad (false) or none (null); raw numbers in `values`.
export function statBreakdown(player, opts = {}) {
  const tuning = opts.tuning || TUNING;
  const snaps = statSnapshots(player, { ...opts, tuning });
  const good = (row, from, to) => (Math.abs(to - from) < 1e-9 ? null : (to > from) !== !!row.lower);
  return STAT_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    rows: g.rows.map((row) => {
      const v = { base: row.get(snaps.base, tuning), start: row.get(snaps.start, tuning), total: row.get(snaps.total, tuning) };
      return {
        id: row.id,
        label: row.label,
        base: formatStatValue(row.fmt, v.base),
        permanent: formatStatDelta(row.kind, row.fmt, v.base, v.start),
        run: formatStatDelta(row.kind, row.fmt, v.start, v.total),
        total: formatStatValue(row.fmt, v.total),
        up: { permanent: good(row, v.base, v.start), run: good(row, v.start, v.total) },
        values: v
      };
    })
  }));
}

// --- Weapons, upgrades and the run --------------------------------------------------------------

// A weapon (or passive) in this run: its potential DPS (one target, js/upgrade-cards.js) and the damage
// and kills it has dealt so far (js/run-stats.js groups).
export function weaponReadout(player, id, runStats = null) {
  const rec = runStats?.groups?.get?.(id);
  const total = runStats?.totalDmg || 0;
  return {
    potential: WEAPON_BY_ID[id] ? weaponPotentialDps(player, id) : null,
    dealt: rec?.dmg || 0,
    kills: rec?.kills || 0,
    share: total > 0 ? (rec?.dmg || 0) / total : 0
  };
}

export function weaponReadoutHtml(r) {
  const parts = [];
  if (r.potential) parts.push(`<span title="Potential damage per second against one target">≈ <b>${formatCompact(r.potential)}</b> DPS</span>`);
  parts.push(`<span title="Damage dealt this run">${r.dealt > 0 ? `<b>${formatCompact(r.dealt)}</b> dealt · ${Math.round(r.share * 100)}%` : 'no damage yet'}</span>`);
  return `<div class="loadout-readout">${parts.join('')}</div>`;
}

const UPGRADE_GROUPS = [
  { kind: 'evolution', label: 'EVOLUTIONS' },
  { kind: 'status', label: 'STATUS EFFECTS' },
  { kind: 'tag', label: 'SPECIALISTS' },
  { kind: 'general', label: 'SHIP SYSTEMS & PASSIVES' }
];

// Every installed upgrade that is not a weapon level, grouped for the UPGRADES tab.
export function upgradeGroups(player) {
  const lines = runUpgradeLines(player);
  return UPGRADE_GROUPS.map((g) => ({ ...g, items: lines.filter((l) => l.kind === g.kind) })).filter((g) => g.items.length);
}

const upgradeName = (name) => name.replace(/^SYNERGY:\s*/, '');
const levelLabel = (u) => (u.isSynergy ? '★ EVOLVED' : `LV ${u.level}${maxText(u.level, u.maxLevel)}`);

export function upgradesHtml(player) {
  const groups = upgradeGroups(player);
  if (!groups.length) return '<div class="ro-empty">No upgrades yet beyond your weapon levels. Level up to pick some: status cards, specialists, ship systems and evolutions all show up here.</div>';
  return groups.map((g) => `<section class="ro-section"><h4 class="ro-section-title">${g.label}</h4><div class="ro-upgrades">${g.items.map((u) => `
    <div class="ro-upgrade${u.isSynergy ? ' evo' : ''}">
      <div class="ro-upgrade-head"><span class="ro-upgrade-name">${esc(upgradeName(u.name))}</span><span class="ro-upgrade-lv">${levelLabel(u)}</span></div>
      <div class="ro-upgrade-text">${esc(u.summary || '')}</div>
    </div>`).join('')}</div></section>`).join('');
}

export function statsHtml(player, opts = {}) {
  const groups = statBreakdown(player, opts);
  const cell = (text, up) => `<td class="${up === null ? 'ro-none' : up ? 'ro-up' : 'ro-down'}">${text}</td>`;
  const body = groups.map((g) => `<tr class="ro-group"><th colspan="5">${g.label}</th></tr>${g.rows.map((r) => `<tr>
    <th scope="row">${esc(r.label)}</th><td>${r.base}</td>${cell(r.permanent, r.up.permanent)}${cell(r.run, r.up.run)}<td class="ro-total">${r.total}</td></tr>`).join('')}`).join('');
  return `<table class="ro-stats"><thead><tr><th scope="col">STAT</th><th scope="col">BASE</th><th scope="col" title="Void Armory ranks bought with Void Cores">PERMANENT</th><th scope="col" title="Cards picked this run">THIS RUN</th><th scope="col">TOTAL</th></tr></thead><tbody>${body}</tbody></table>
    <p class="ro-note"><b>PERMANENT</b> is the Void Armory (bought with Void Cores), <b>THIS RUN</b> the cards picked this run. Weapon cards (damage, fire rate, size...) are on each weapon in LOADOUT.</p>`;
}

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// The run at a glance (beside the ship): [label, value, detail?].
export function runInfo(game) {
  const p = game.player || {};
  const dealt = game.runStats?.totalDmg || 0;
  const t = game.elapsedTime || 0;
  return [
    ['WAVE', String(game.wave ?? 1), clock(t)],
    ['SCORE', (game.score || 0).toLocaleString(), `x${(game.multiplier ?? 1).toFixed(1)} multiplier`],
    ['LEVEL', `LV ${p.level ?? 1}`, `${Math.floor(p.xp || 0)} / ${p.xpToNext || 0} XP`],
    ['KILLS', String(game.kills || 0), `${game.rocksMined || 0} rocks mined`],
    ['DAMAGE', dealt > 0 ? formatCompact(dealt) : '0', t > 1 && dealt > 0 ? `${formatCompact(dealt / t)} DPS average` : 'this run'],
    ['SHIELD', `${Math.ceil(p.hp || 0)} / ${p.maxHp || 0}`, `${p.bombs ?? 0} Supernova bomb${p.bombs === 1 ? '' : 's'}`],
    ['GOLD', `◆ ${game.gold ?? 0}`, `${game.goldEarned || 0} mined · ${game.goldSpent || 0} spent`],
    ['VOID CORES', `❖ +${game.sessionCores || 0}`, `${game.progression?.data?.cores ?? 0} banked`],
    ['MODE', modeRules(game).label, `${versionLabel(GAME_VERSION)} · ${game.runTainted ? 'dev-tuned run' : `${ownedWeapons(p).length} / ${weaponSlots()} slots`}`]
  ];
}

export function runInfoHtml(game) {
  return runInfo(game).map(([label, value, detail]) => `<div class="ro-info"><span class="ro-info-label">${label}</span>
    <span class="ro-info-value">${esc(value)}</span>${detail ? `<span class="ro-info-detail">${esc(detail)}</span>` : ''}</div>`).join('');
}

// Damage this run by group (weapons, passives, dash nova, bombs...), biggest first.
export function damageRows(runStats) {
  const total = runStats?.totalDmg || 0;
  if (!total || !runStats.groups) return [];
  const rows = [];
  for (const rec of runStats.groups.values()) {
    if (!(rec.dmg > 0)) continue;
    const w = WEAPON_BY_ID[rec.id] || PASSIVE_BY_ID[rec.id];
    const info = w ? { name: w.hudName || w.name, color: w.color } : OTHER_GROUP_INFO[rec.id] || { name: rec.id, color: '#8ba3c7' };
    rows.push({ id: rec.id, name: info.name, color: info.color, dmg: rec.dmg, kills: rec.kills, share: rec.dmg / total });
  }
  return rows.sort((a, b) => b.dmg - a.dmg);
}

export function damageHtml(runStats) {
  const rows = damageRows(runStats);
  const body = rows.length
    ? rows.map((r) => `<div class="ro-dmg-row" style="--wc:${r.color}"><span class="ro-dmg-name">${esc(r.name)}</span>
      <span class="ro-dmg-bar"><span style="width:${(r.share * 100).toFixed(1)}%"></span></span>
      <span class="ro-dmg-num">${formatCompact(r.dmg)} · ${Math.round(r.share * 100)}%</span></div>`).join('')
    : '<div class="ro-empty">No damage dealt yet.</div>';
  return `<div class="pause-loadout-head"><span class="pause-loadout-title">DAMAGE THIS RUN</span><span class="pause-loadout-count">${formatCompact(runStats?.totalDmg || 0)} TOTAL</span></div>${body}`;
}

// Weapon slot chips (equipped weapons in their colour, free slots dashed): the HUD row and the
// level-up screen's loadout strip.
// `charges` ({ weaponId: 0..1 }, optional) adds a charge gauge under a chip (Electric Shield Field's recharge).
export function weaponChipsHtml(p, charges = null) {
  const owned = ownedWeapons(p);
  const chips = [];
  for (let i = 0; i < Math.max(weaponSlots(), owned.length); i++) {
    const w = WEAPON_BY_ID[owned[i]];
    if (!w) {
      chips.push('<span class="weapon-slot-chip empty" title="Free weapon slot">+</span>');
      continue;
    }
    const lv = w.levelId ? ` LV ${weaponLevel(p, w.id)}${bonusText(bonusLevels(p, w.levelId))}` : '';
    // An element-infused weapon carries its element after the level (FIRE, FROST, CORROSIVE, SHOCK).
    const el = weaponElement(p, w.id);
    const elTag = el ? ` <span class="weapon-el" style="--ec:${ELEMENT_INFO[el.element].color}">${ELEMENT_INFO[el.element].label}</span>` : '';
    const title = el ? `${w.name} (${ELEMENT_INFO[el.element].label} ${el.rank})` : w.name;
    const charge = charges?.[w.id];
    const gauge = typeof charge === 'number';
    const cls = gauge ? ` charge${charge >= 1 ? ' ready' : ''}` : '';
    const style = gauge ? `--wc:${w.color};--charge:${charge}` : `--wc:${w.color}`;
    chips.push(`<span class="weapon-slot-chip${cls}" style="${style}" title="${esc(title)}">${w.hudName}${lv}${elTag}</span>`);
  }
  return chips.join('');
}

// Level-up screen strip: the weapon slots, then every other upgrade picked so far (what the HUD used
// to list under the slots), so the hand can be read against the build.
export function loadoutStripHtml(p) {
  const passives = ownedPassives(p).map((id) => PASSIVE_BY_ID[id]);
  const lines = runUpgradeLines(p).filter((u) => !passives.some((x) => x.upgradeId === u.id));
  const ups = [
    ...passives.map((x) => `<span class="strip-upgrade" style="--wc:${x.color}">${esc(x.name)} LV ${p.upgradeLevels?.[x.upgradeId] || 0}</span>`),
    ...lines.map((u) => `<span class="strip-upgrade${u.isSynergy ? ' evo' : ''}">${esc(upgradeName(u.name))} ${u.isSynergy ? '★' : `LV ${u.level}`}</span>`)
  ];
  return `<div class="strip-row strip-weapons"><span class="strip-label">WEAPONS</span>${weaponChipsHtml(p)}</div>`
    + `<div class="strip-row"><span class="strip-label">UPGRADES</span>${ups.length ? ups.join('') : '<span class="strip-none">none yet</span>'}</div>`;
}

// --- Pause menu wiring ----------------------------------------------------------------------------

export const PAUSE_TABS = ['loadout', 'stats', 'upgrades', 'settings'];

export class RunOverview {
  constructor(game, doc = globalThis.document) {
    this.game = game;
    this.doc = doc;
    this.tab = 'loadout';
    const canvas = doc?.getElementById?.('pause-ship-canvas');
    this.ship = new ShipPreview(canvas, { getPlayer: () => game.player, tuning: TUNING });
    doc?.querySelectorAll?.('[data-pause-tab]').forEach((btn) => btn.addEventListener('click', () => {
      game.sound?.playUiSelect?.();
      this.setTab(btn.dataset.pauseTab);
    }));
  }

  // The Weapon Range has no loadout tab (its panel owns the loadout).
  tabs() {
    return this.game.range?.active ? PAUSE_TABS.filter((t) => t !== 'loadout') : PAUSE_TABS;
  }

  open() {
    if (!this.tabs().includes(this.tab)) this.tab = this.tabs()[0];
    this.render();
  }

  setTab(tab) {
    if (!this.tabs().includes(tab)) return;
    this.tab = tab;
    this.render();
  }

  cycleTab(dir) {
    const tabs = this.tabs();
    const i = tabs.indexOf(this.tab);
    this.setTab(tabs[(i + dir + tabs.length) % tabs.length]);
  }

  render() {
    const doc = this.doc;
    const g = this.game;
    const p = g.player;
    if (!doc?.getElementById || !p) return;
    for (const btn of doc.querySelectorAll?.('[data-pause-tab]') || []) {
      const on = btn.dataset.pauseTab === this.tab;
      btn.classList.toggle('active', on);
      btn.setAttribute?.('aria-selected', on ? 'true' : 'false');
    }
    for (const pane of doc.querySelectorAll?.('[data-pause-pane]') || []) pane.classList.toggle('hidden', pane.dataset.pausePane !== this.tab);
    const set = (id, html) => {
      const el = doc.getElementById(id);
      if (el) el.innerHTML = html;
    };
    set('pause-run-info', runInfoHtml(g));
    const caption = doc.getElementById('pause-ship-caption');
    if (caption) caption.textContent = `${ownedWeapons(p).length} WEAPON${ownedWeapons(p).length === 1 ? '' : 'S'} · DRILL SIZE ×${(p.stats?.drillScale || 1).toFixed(2)}`;
    if (this.tab === 'loadout') set('pause-damage', damageHtml(g.runStats));
    if (this.tab === 'stats') set('pause-stats', statsHtml(p));
    if (this.tab === 'upgrades') set('pause-upgrades', upgradesHtml(p));
  }

  // Called every frame from Game.loop: the ship animates while the pause menu is open.
  frame(now) {
    if (this.game.state === 'PAUSED') this.ship.frame(now);
  }
}
