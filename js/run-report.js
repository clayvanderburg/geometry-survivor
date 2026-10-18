// RUN REPORT on the game-over screen: damage by weapon (bars with % share and DPS), the enemies that
// hurt the ship most and a few headline numbers, from the run summary (js/run-stats.js). The view is
// built by a pure function (tested in node); renderRunReport draws it. Rows carry data-gp-nav so the
// controller's MenuNavigator can walk (and scroll) the report.

const MAX_BARS = 7; // more groups fold into OTHER
const MAX_KILLERS = 4;

// Names and colors for damage groups that are not loadout weapons.
export const OTHER_GROUP_INFO = Object.freeze({
  shrapnel: { name: 'Volatile Shatter', color: '#d6dde8' },
  nova: { name: 'Phase Nova', color: '#7fffd4' },
  tectonic: { name: 'Tectonic Bore', color: '#ffb347' },
  supernova: { name: 'Supernova', color: '#ffe45c' },
  hazard: { name: 'Vortex Bursts', color: '#ff6ad5' },
  ram: { name: 'Shield Ram', color: '#9fb4d8' },
  other: { name: 'Other', color: '#8ba3c7' }
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function formatCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(n >= 10 ? 0 : 1);
}

export const formatPct = (share) => `${Math.round((Number(share) || 0) * 100)}%`;

// summary: RunStats.finish() output. info(id) -> { name, color } for a damage group; enemyName(kind).
export function buildRunReport(summary, { info = (id) => OTHER_GROUP_INFO[id] || { name: id, color: '#8ba3c7' }, enemyName = (k) => k.toUpperCase(), upload = '' } = {}) {
  const time = Math.max(1, Number(summary?.time) || 0);
  const levels = Object.fromEntries((summary?.loadout || []).map((w) => [w.id, w.lv]));
  const groups = Object.entries(summary?.weapons || {})
    .map(([id, w]) => ({ id, dmg: w.dmg || 0, kills: w.kills || 0, owned: w.lv ? w.owned || 0 : time, isWeapon: !!w.lv }))
    .filter((g) => g.dmg > 0)
    .sort((a, b) => b.dmg - a.dmg);
  const total = groups.reduce((a, g) => a + g.dmg, 0);
  const shown = groups.length > MAX_BARS ? groups.slice(0, MAX_BARS - 1) : groups;
  const folded = groups.slice(shown.length);
  const bars = shown.map((g) => {
    const meta = info(g.id) || {};
    return {
      id: g.id, name: meta.name || g.id, color: meta.color || '#8ba3c7', damage: g.dmg, kills: g.kills,
      share: total ? g.dmg / total : 0, dps: g.dmg / Math.max(1, g.owned), level: g.isWeapon ? levels[g.id] ?? null : null
    };
  });
  if (folded.length) {
    const dmg = folded.reduce((a, g) => a + g.dmg, 0);
    bars.push({ id: 'folded', name: `Other (${folded.length})`, color: OTHER_GROUP_INFO.other.color, damage: dmg, kills: folded.reduce((a, g) => a + g.kills, 0), share: total ? dmg / total : 0, dps: dmg / time, level: null });
  }
  const top = bars.reduce((m, b) => (b.share > (m?.share ?? -1) ? b : m), null);

  const hurt = Object.entries(summary?.enemies || {}).map(([kind, v]) => ({ kind, damage: v[4] || 0, hits: v[5] || 0 }))
    .filter((k) => k.damage > 0).sort((a, b) => b.damage - a.damage);
  const taken = hurt.reduce((a, k) => a + k.damage, 0);
  const killers = hurt.slice(0, MAX_KILLERS).map((k) => ({
    kind: k.kind, name: enemyName(k.kind), damage: k.damage, hits: k.hits, share: taken ? k.damage / taken : 0,
    fatal: !!summary?.died && summary?.cause === k.kind
  }));
  if (summary?.died && summary.cause && !killers.some((k) => k.fatal)) {
    killers.push({ kind: summary.cause, name: enemyName(summary.cause), damage: 0, hits: 0, share: 0, fatal: true });
  }

  const headline = [
    { label: 'DAMAGE DEALT', value: formatCompact(total) },
    { label: 'AVG DPS', value: formatCompact(total / time) },
    { label: 'TOP WEAPON', value: top ? `${top.name} ${formatPct(top.share)}` : '—' },
    { label: 'SHIELD LOST', value: formatCompact(taken) }
  ];
  return { bars, killers, headline, total, taken, upload, empty: !bars.length };
}

export function runReportHtml(view) {
  const head = view.headline.map((h) => `<div class="rr-head"><div class="rr-head-label">${esc(h.label)}</div><div class="rr-head-val">${esc(h.value)}</div></div>`).join('');
  const maxShare = Math.max(0.0001, ...view.bars.map((b) => b.share));
  const bars = view.empty
    ? '<div class="rr-empty">NO DAMAGE DEALT THIS RUN</div>'
    : view.bars.map((b) => `<div class="rr-bar-row" data-gp-nav tabindex="-1" data-report-weapon="${esc(b.id)}" title="${esc(`${b.name}: ${Math.round(b.damage).toLocaleString()} damage, ${b.kills} kills, ${formatCompact(b.dps)} DPS`)}">
        <div class="rr-bar-label"><span class="rr-name">${esc(b.name)}${b.level ? `<span class="rr-lv">LV ${b.level}</span>` : ''}</span><span class="rr-nums"><b>${formatPct(b.share)}</b> · ${formatCompact(b.dps)} DPS</span></div>
        <div class="rr-track"><div class="rr-fill" style="width:${Math.max(1.5, (b.share / maxShare) * 100).toFixed(1)}%; --rc:${esc(b.color)}"></div></div>
      </div>`).join('');
  const killers = view.killers.length
    ? view.killers.map((k) => `<div class="rr-killer${k.fatal ? ' fatal' : ''}" data-gp-nav tabindex="-1" title="${esc(`${k.name}: ${Math.round(k.damage)} shield damage in ${k.hits} hits${k.fatal ? ' (final blow)' : ''}`)}">
        <span class="rr-killer-name">${k.fatal ? '☠ ' : ''}${esc(k.name)}</span><span class="rr-killer-val">${k.damage ? `${formatPct(k.share)} · ${formatCompact(k.damage)}` : 'FINAL BLOW'}</span></div>`).join('')
    : '<div class="rr-empty">UNTOUCHED</div>';
  return `<div class="rr-headline">${head}</div>
    <div class="rr-section-title">DAMAGE BY WEAPON <span>% SHARE · DPS WHILE EQUIPPED</span></div>
    <div class="rr-bars">${bars}</div>
    <div class="rr-section-title">TOP THREATS <span>SHIELD DAMAGE TAKEN</span></div>
    <div class="rr-killers">${killers}</div>
    ${view.upload ? `<div class="rr-upload">${esc(view.upload)}</div>` : ''}`;
}

export function renderRunReport(el, view) {
  if (!el) return;
  el.innerHTML = runReportHtml(view);
}
