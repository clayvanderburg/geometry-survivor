// stats.html: the developer balance dashboard. Two dataset slots (A, B), each either the live
// aggregate from GET /api/stats/summary?version=<v>|all[&armory=<tier>] or a local JSON file:
//   - a summary (`tools/balance-sim.mjs --stats-out`, or a saved /api/stats/summary answer),
//   - an array of run summaries, or `balance-sim --json` output (aggregated here with the same code).
// Vanilla JS + inline SVG, no dependencies. Nothing here is reachable from the game's menus.
import { aggregateRuns, SUMMARY_SCHEMA } from './stats-aggregate.js';
import { requestJson } from './leaderboard.js';
import { OTHER_GROUP_INFO } from './run-report.js';

const SUMMARY_URL = '/api/stats/summary';
const SLOTS = ['a', 'b'];
const SERIES = { a: 'var(--series-a)', b: 'var(--series-b)' };
const state = { a: null, b: null, label: { a: '', b: '' }, versions: null };
const names = { weapon: {}, card: {}, enemy: {} };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v, d = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const fix = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const num = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v >= 100 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2);
};
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—');
const weaponName = (id) => names.weapon[id] || OTHER_GROUP_INFO[id]?.name || id;
const cardName = (id) => names.card[id] || id;
const enemyName = (id) => names.enemy[id] || id.toUpperCase();
const flagBadge = (flag, enough = true) => {
  if (flag === 'buff') return '<span class="flag buff">⬆ NEEDS BUFF</span>';
  if (flag === 'nerf') return '<span class="flag nerf">⬇ NEEDS NERF</span>';
  if (!enough) return '<span class="flag low">LOW SAMPLE</span>';
  return '';
};
const active = () => SLOTS.filter((s) => state[s]);

// Best-effort display names from the game modules (the dashboard still works without them).
async function loadNames() {
  try {
    const { WEAPONS, PASSIVES } = await import('./loadout.js');
    for (const w of [...WEAPONS, ...PASSIVES]) names.weapon[w.id] = w.name;
  } catch { /* ids only */ }
  try {
    const { UPGRADE_POOL } = await import('./upgrades.js');
    for (const u of UPGRADE_POOL) names.card[u.id] = u.name.replace('SYNERGY: ', '★ ');
    names.card.new_weapon = 'NEW WEAPON';
    const { RETIRED_STAT_CARDS } = await import('./weapon-levels.js');
    Object.assign(names.card, RETIRED_STAT_CARDS);
  } catch { /* ids only */ }
  try {
    const { HOSTILE_ENTRIES } = await import('./field-guide.js');
    for (const h of HOSTILE_ENTRIES) names.enemy[h.id] = h.name;
  } catch { /* ids only */ }
}

// Any supported JSON -> a summary, or throws with a readable message.
export function toSummary(json, fileName = 'file') {
  if (json && json.schema === SUMMARY_SCHEMA) return json;
  let runs = null;
  if (Array.isArray(json)) runs = json;
  else if (Array.isArray(json?.runs)) runs = json.runs.map((r) => (r && r.stats ? r.stats : r));
  runs = (runs || []).filter((r) => r && r.schema === 1 && Number.isFinite(r.time));
  if (!runs.length) throw new Error(`${fileName}: not a stats summary, run list or balance-sim --json file`);
  return aggregateRuns(runs, { version: runs[0].version || 'all', source: json?.opts ? 'sim' : 'file' });
}

function setStatus(slot, text, err = false) {
  const el = document.querySelector(`[data-slot="${slot}"] [data-status]`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', err);
}

const ARMORY_LABELS = { none: 'no Armory', partial: 'partial Armory', maxed: 'maxed Armory', unknown: 'Armory not recorded' };
const armoryOf = (slot) => document.querySelector(`[data-slot="${slot}"] [data-armory]`)?.value || '';

async function loadLive(slot, version) {
  const armory = armoryOf(slot);
  setStatus(slot, `Loading players · ${version}…`);
  const res = await requestJson(globalThis.fetch?.bind(globalThis), `${SUMMARY_URL}?version=${encodeURIComponent(version)}${armory ? `&armory=${encodeURIComponent(armory)}` : ''}`, { timeoutMs: 20000 });
  if (!res.ok) {
    state[slot] = null;
    const why = res.reason === 'http' ? res.data?.error || `HTTP ${res.status}` : res.reason === 'unavailable' ? 'the /api/stats function is not deployed here' : res.reason;
    setStatus(slot, `Live stats unavailable (${why}). Load a JSON file instead.`, true);
    render();
    return;
  }
  state[slot] = res.data;
  state.label[slot] = `Players · ${version === 'all' ? 'all versions' : `v${version}`}${armory ? ` · ${ARMORY_LABELS[armory]}` : ''}`;
  if (!state.versions) fillVersions(res.data);
  setStatus(slot, `${state.label[slot]} · ${res.data.runs} runs${res.data.truncated ? ` (newest ${res.data.scanned} of ${res.data.stored})` : ''} · computed ${new Date(res.data.computedAt || res.data.generatedAt).toLocaleString()}${res.data.cached ? ' (cached)' : ''}`);
  render();
}

function fillVersions(data) {
  const withRuns = new Set(data.versions || []);
  const list = data.knownVersions || data.versions || [];
  state.versions = list;
  for (const slot of SLOTS) {
    const sel = document.querySelector(`[data-slot="${slot}"] [data-version]`);
    const keep = sel.value;
    for (const v of list) {
      if ([...sel.options].some((o) => o.value === v)) continue;
      const o = document.createElement('option');
      o.value = v;
      o.textContent = `Players · v${v}${withRuns.has(v) ? '' : ' (no runs)'}${v === data.current ? ' · current' : ''}`;
      sel.appendChild(o);
    }
    sel.value = keep;
  }
}

async function loadFile(slot, file) {
  try {
    const summary = toSummary(JSON.parse(await file.text()), file.name);
    state[slot] = summary;
    state.label[slot] = `${summary.source === 'sim' ? 'Sim' : 'File'} · ${file.name}`;
    const sim = summary.sim ? ` · ${summary.sim.strategies?.length || '?'} strategies x ${summary.sim.runsPerStrategy} runs, ${summary.sim.maxMinutes} min cap, ${summary.sim.skill} pilot` : '';
    setStatus(slot, `${state.label[slot]} · ${summary.runs} runs · v${summary.version}${sim}`);
  } catch (err) {
    setStatus(slot, String(err.message || err), true);
  }
  render();
}

// --- SVG charts -------------------------------------------------------------------------------------

// Grouped horizontal bars: rows [{ label, values: { a, b }, notes: { a, b } }]. refs: dashed reference lines.
function hbarChart(rows, { min = 0, max = null, refs = [], fmt = (v) => fix(v), mid = null } = {}) {
  const slots = active();
  if (!rows.length || !slots.length) return '<p class="empty">No data.</p>';
  const all = rows.flatMap((r) => slots.map((s) => r.values[s])).filter(Number.isFinite);
  const hi = max ?? Math.max(...all, ...refs, 0.0001) * 1.08;
  const W = 640, labelW = 150, valueW = 150, plotW = W - labelW - valueW;
  const barH = 11, gap = 2, groupH = slots.length * (barH + gap) + 10;
  const H = rows.length * groupH + 18;
  const x = (v) => labelW + (Math.max(min, Math.min(hi, v)) - min) / (hi - min) * plotW;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  // Reference lines always draw; their labels only where they don't collide (the mid line always gets one).
  const labelGap = 30;
  for (const ref of refs) {
    const crowded = ref !== mid && refs.some(other => other !== ref && Math.abs(x(other) - x(ref)) < labelGap);
    out += `<line class="${ref === mid ? 'ref-mid' : 'ref'}" x1="${x(ref)}" x2="${x(ref)}" y1="0" y2="${H - 14}"/>`;
    if (!crowded) out += `<text x="${x(ref)}" y="${H - 2}" text-anchor="middle">${fmt(ref)}</text>`;
  }
  rows.forEach((r, i) => {
    const y0 = i * groupH + 4;
    out += `<text x="0" y="${y0 + (slots.length * (barH + gap)) / 2 + 4}">${esc(r.label)}</text>`;
    slots.forEach((s, k) => {
      const v = r.values[s];
      const y = y0 + k * (barH + gap);
      if (!Number.isFinite(v)) { out += `<text x="${labelW + 4}" y="${y + barH - 1}" class="muted">no data</text>`; return; }
      const w = Math.max(2, x(v) - labelW);
      out += `<rect class="hit" x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="2" fill="${SERIES[s]}"><title>${esc(`${state.label[s]} · ${r.label}: ${fmt(v)}${r.notes?.[s] ? ` · ${r.notes[s]}` : ''}`)}</title></rect>`;
      out += `<text x="${labelW + plotW + 6}" y="${y + barH - 1}">${esc(fmt(v))}${r.notes?.[s] ? ` ${esc(r.notes[s])}` : ''}</text>`;
    });
  });
  return out + '</svg>';
}

// Grouped vertical bars for histograms: buckets [{ label, values: { a, b } }] (shares 0..1).
function columnChart(buckets) {
  const slots = active();
  if (!buckets.length || !slots.length) return '<p class="empty">No data.</p>';
  const W = 420, H = 170, padL = 34, padB = 22, plotH = H - padB - 8;
  const hi = Math.max(0.05, ...buckets.flatMap((b) => slots.map((s) => b.values[s] || 0))) * 1.1;
  const groupW = (W - padL) / buckets.length, barW = Math.min(18, (groupW - 8) / slots.length);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="axis" x1="${padL}" x2="${W}" y1="${8 + plotH}" y2="${8 + plotH}"/>`;
  for (const t of [0, hi / 2, hi]) out += `<text x="${padL - 4}" y="${8 + plotH - (t / hi) * plotH + 4}" text-anchor="end">${pct(t)}</text>`;
  buckets.forEach((b, i) => {
    const gx = padL + i * groupW + (groupW - slots.length * barW) / 2;
    slots.forEach((s, k) => {
      const v = b.values[s] || 0;
      const h = Math.max(v > 0 ? 2 : 0, (v / hi) * plotH);
      out += `<rect class="hit" x="${gx + k * barW}" y="${8 + plotH - h}" width="${barW - 2}" height="${h}" rx="2" fill="${SERIES[s]}"><title>${esc(`${state.label[s]} · ${b.label}: ${pct(v, 1)} of runs`)}</title></rect>`;
    });
    out += `<text x="${padL + i * groupW + groupW / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return out + '</svg>';
}

// Lines over shared x categories: series { a: [y|null], b: [...] }.
function lineChart(xs, series, { fmt = (v) => v, xLabel = (x) => x } = {}) {
  const slots = active().filter((s) => series[s]?.some(Number.isFinite));
  if (!slots.length) return '<p class="empty">No run reached these levels yet.</p>';
  const W = 420, H = 170, padL = 40, padB = 22, plotW = W - padL - 12, plotH = H - padB - 8;
  const hi = Math.max(...slots.flatMap((s) => series[s].filter(Number.isFinite))) * 1.1 || 1;
  const x = (i) => padL + (xs.length === 1 ? plotW / 2 : (i / (xs.length - 1)) * plotW);
  const y = (v) => 8 + plotH - (v / hi) * plotH;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="axis" x1="${padL}" x2="${W - 12}" y1="${8 + plotH}" y2="${8 + plotH}"/>`;
  for (const t of [0, hi / 2, hi]) out += `<line class="axis" x1="${padL}" x2="${W - 12}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 4}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
  xs.forEach((xv, i) => { out += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(xv))}</text>`; });
  for (const s of slots) {
    const pts = series[s].map((v, i) => (Number.isFinite(v) ? [x(i), y(v), v, i] : null)).filter(Boolean);
    out += `<polyline fill="none" stroke="${SERIES[s]}" stroke-width="2" points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}"/>`;
    for (const [px, py, v, i] of pts) out += `<circle class="hit" cx="${px}" cy="${py}" r="4.5" fill="${SERIES[s]}" stroke="var(--surface)" stroke-width="2"><title>${esc(`${state.label[s]} · ${xLabel(xs[i])}: ${fmt(v)}`)}</title></circle>`;
  }
  return out + '</svg>';
}

const legend = () => `<div class="legend">${active().map((s) => `<span style="--sc:${SERIES[s]}">${s.toUpperCase()} · ${esc(state.label[s])}</span>`).join('')}</div>`;

// --- Sections ---------------------------------------------------------------------------------------

function overview() {
  const tile = (label, f) => `<div class="tile"><div class="label">${label}</div><div class="ab">${active().map((s) => `<span class="val" style="--sc:${SERIES[s]}">${f(state[s])}</span>`).join('')}</div></div>`;
  return `<section><div class="section-head"><h2>Runs at a glance</h2>${legend()}</div>
    <div class="tiles">
      ${tile('Runs', (d) => d.runs)}
      ${tile('Run length median <small>/ p90</small>', (d) => `${mmss(d.run.time.median)} <small>/ ${mmss(d.run.time.p90)}</small>`)}
      ${tile('Level median <small>/ p90</small>', (d) => `${d.run.level.median ?? '—'} <small>/ ${d.run.level.p90 ?? '—'}</small>`)}
      ${tile('Reach LV 50 <small>(target)</small>', (d) => pct(d.run.reachLevel50, 1))}
      ${tile('Survive 30 min <small>(target)</small>', (d) => pct(d.run.reach30min, 1))}
      ${tile('Wave median', (d) => d.run.wave.median ?? '—')}
      ${tile('Gold earned / spent', (d) => `${num(d.gold.earned)} <small>/ ${num(d.gold.spent)}</small>`)}
      ${tile('Rerolls · locks · banishes · skips / run', (d) => `${fix(d.gold.rerolls, 1)} <small>· ${fix(d.gold.locks, 1)} · ${fix(d.gold.banishes ?? 0, 1)} · ${fix(d.gold.skips ?? 0, 1)}</small>`)}
      ${tile('Supernova bombs / run · kills per bomb', (d) => (d.bombs?.runs ? `${fix(d.bombs.perRun.mean, 1)} <small>· ${fix(d.bombs.killsPerBomb, 0)}</small>` : '—'))}
      ${tile('Armory: none · partial · maxed · not recorded <small>(runs)</small>', (d) => (d.armoryTiers ? d.armoryTiers.map((t) => t.runs).join(' · ') : '—'))}
    </div></section>`;
}

function weaponBalance() {
  const slots = active();
  const ids = [...new Set(slots.flatMap((s) => state[s].weapons.filter((w) => w.curve).map((w) => w.id)))];
  const find = (s, id) => state[s].weapons.find((w) => w.id === id);
  const band = state[slots[0]].outlierBand ?? 0.2;
  const rows = ids.map((id) => ({
    label: weaponName(id),
    values: Object.fromEntries(slots.map((s) => [s, find(s, id)?.index ?? NaN])),
    notes: Object.fromEntries(slots.map((s) => {
      const w = find(s, id);
      return [s, w?.flag === 'buff' ? '⬆ needs buff' : w?.flag === 'nerf' ? '⬇ needs nerf' : w && w.index === null ? '(low sample)' : ''];
    }))
  })).sort((a, b) => (b.values[slots[0]] || 0) - (a.values[slots[0]] || 0));

  const matrix = (s) => {
    const d = state[s];
    const ws = d.weapons.filter((w) => w.curve);
    const levels = [...new Set(ws.flatMap((w) => w.levels.map((l) => l.level)))].sort((a, b) => a - b);
    if (!ws.length) return '<p class="empty">No weapon on the DPS curve in this dataset.</p>';
    const head = `<tr><th>${esc(s.toUpperCase())} · weapon</th>${levels.map((l) => `<th>LV ${l}</th>`).join('')}<th>Overall</th></tr>`;
    const body = ws.map((w) => `<tr><td>${esc(weaponName(w.id))}</td>${levels.map((L) => {
      const r = w.levels.find((x) => x.level === L);
      if (!r) return '<td class="cell muted">·</td>';
      const cls = !r.enough ? 'low' : r.flag || '';
      const tip = `${weaponName(w.id)} LV ${L}: ${num(r.dps)} DPS, ${fix(r.normDps, 2)}x base/s vs target ${r.target ?? '—'}x (${pct(r.vsTarget)}), index ${fix(r.index)}, ${pct(r.dmgShare)} of weapon damage, ${pct(r.killShare)} of weapon kills, ${r.runs} runs / ${Math.round(r.seconds)} s`;
      return `<td class="cell ${cls}" title="${esc(tip)}">${r.index !== null ? fix(r.index) : '—'}<small>${pct(r.vsTarget)}${r.enough ? '' : ' · n' + r.runs}</small></td>`;
    }).join('')}<td class="cell ${w.flag || ''}">${w.index !== null ? fix(w.index) : '—'}<small>${flagBadge(w.flag, w.index !== null)}</small></td></tr>`).join('');
    return `<div class="table-wrap"><table>${head}${body}</table></div>`;
  };

  const detail = (s) => {
    const rows2 = state[s].weapons.filter((w) => w.isWeapon).flatMap((w) => w.levels.map((r) => `<tr><td>${esc(weaponName(w.id))}</td><td>${r.level}</td><td>${r.runs}</td><td>${Math.round(r.seconds)}</td><td>${num(r.dps)}</td><td>${fix(r.normDps, 2)}</td><td>${r.target ?? '—'}</td><td>${pct(r.vsTarget)}</td><td>${fix(r.index)}</td><td>${pct(r.dmgShare, 1)}</td><td>${pct(r.killShare, 1)}</td><td>${flagBadge(r.flag, r.enough)}</td></tr>`)).join('');
    return `<details><summary>${esc(s.toUpperCase())} · every weapon level (mean DPS, damage share, kill share, sample size)</summary><div class="table-wrap"><table>
      <tr><th>Weapon</th><th>LV</th><th>Runs</th><th>Seconds</th><th>DPS</th><th>x base / s</th><th>Target</th><th>vs target</th><th>Index</th><th>Weapon dmg share</th><th>Weapon kill share</th><th></th></tr>${rows2}</table></div></details>`;
  };

  const overviewTable = (s) => {
    const rows3 = state[s].weapons.map((w) => `<tr><td>${esc(weaponName(w.id))}${w.isWeapon ? '' : ' <span class="muted">(not a weapon)</span>'}</td><td>${pct(w.runShare)}</td><td>${pct(w.dmgShare, 1)}</td><td>${pct(w.killShare, 1)}</td><td>${w.dps !== null ? num(w.dps) : '—'}</td><td>${w.medianAcquiredAt !== null ? mmss(w.medianAcquiredAt) : '—'}</td><td>${pct(w.vsTarget)}</td><td>${w.index !== null ? fix(w.index) : '—'} ${flagBadge(w.flag, true)}</td></tr>`).join('');
    return `<div class="table-wrap"><table><tr><th>${esc(s.toUpperCase())} · source</th><th title="Weapons: share of weapon damage / kills. Supernova, ram and other non-weapon sources: share of everything.">In runs</th><th>Dmg share</th><th>Kill share</th><th>DPS owned</th><th>Picked at</th><th>vs target</th><th>Index</th></tr>${rows3}</table></div>`;
  };

  return `<section><div class="section-head"><h2>Weapon balance · DPS vs DPS_TARGET at equal level</h2>${legend()}</div>
    <p class="note">Design rule: every weapon has the same potential DPS at the same level, <code>DPS_TARGET(lv) = 3 · lv^1.5</code> x base damage. <b>vs target</b> is the realized share of that potential (damage in base-damage units per second at that level). Real fights never land every attack, so the rule predicts every weapon realizes the <i>same</i> share: <b>index</b> = vs target ÷ the median of all curve weapons at that level. Index above ${fix(1 + band)} → needs nerf, below ${fix(1 - band)} → needs buff. Levels with fewer than ${state[slots[0]].minSample?.runs ?? 3} runs or ${state[slots[0]].minSample?.seconds ?? 60} s are low sample and never flagged.</p>
    ${hbarChart(rows, { refs: [1 - band, 1, 1 + band], mid: 1, fmt: (v) => fix(v), min: 0, max: Math.max(2, ...rows.flatMap((r) => Object.values(r.values)).filter(Number.isFinite)) * 1.05 })}
    <h2 style="margin-top:14px">Index by weapon level <span class="muted">(cell: index · vs target)</span></h2>
    ${slots.map(matrix).join('')}
    ${slots.map(detail).join('')}
    <h2 style="margin-top:14px">All damage sources</h2>
    <div class="grid2">${slots.map(overviewTable).join('')}</div>
  </section>`;
}

function damageShare() {
  const slots = active();
  const ids = [...new Set(slots.flatMap((s) => state[s].weapons.map((w) => w.id)))];
  const rows = ids.map((id) => ({ label: weaponName(id), values: Object.fromEntries(slots.map((s) => [s, state[s].weapons.find((w) => w.id === id)?.dmgShare ?? NaN])) }))
    .sort((a, b) => (b.values[slots[0]] || 0) - (a.values[slots[0]] || 0));
  const subs = (s) => `<div class="table-wrap"><table><tr><th>${esc(s.toUpperCase())} · stat id</th><th>Damage</th><th>Share</th></tr>${state[s].sources.map((x) => `<tr><td>${esc(x.id)}</td><td>${num(x.damage)}</td><td>${pct(x.share, 1)}</td></tr>`).join('')}</table></div>`;
  return `<section><div class="section-head"><h2>Damage share by weapon</h2>${legend()}</div>
    ${hbarChart(rows, { fmt: (v) => pct(v, 1) })}
    <details><summary>Sub-sources (burn, helix, collapse, storm, siege…)</summary><div class="grid2">${slots.map(subs).join('')}</div></details></section>`;
}

function enemies() {
  const slots = active();
  const table = (s) => `<div class="table-wrap"><table><tr><th>${esc(s.toUpperCase())} · enemy</th><th>Spawned</th><th>Killed</th><th>Avg kill time</th><th>Shield dmg</th><th>Dmg share</th><th>Dmg / spawn</th><th>Deaths</th><th>Death share</th></tr>
    ${state[s].enemies.map((e) => `<tr class="${e.deadly ? 'deadly' : ''}"><td>${esc(enemyName(e.kind))}</td><td>${num(e.spawned)}</td><td>${num(e.killed)}</td><td>${e.timeToKill !== null ? `${fix(e.timeToKill, 1)} s` : '—'}</td><td>${num(e.playerDamage)}</td><td>${pct(e.playerDamageShare, 1)}</td><td>${fix(e.damagePerSpawn, 2)}</td><td>${e.deaths}</td><td>${pct(e.deathShare)}</td></tr>`).join('')}</table></div>`;
  const kinds = [...new Set(slots.flatMap((s) => state[s].enemies.filter((e) => e.deaths > 0 || e.playerDamage > 0).map((e) => e.kind)))];
  const rows = kinds.map((k) => ({ label: enemyName(k), values: Object.fromEntries(slots.map((s) => [s, state[s].enemies.find((e) => e.kind === k)?.playerDamageShare ?? NaN])) }))
    .sort((a, b) => (b.values[slots[0]] || 0) - (a.values[slots[0]] || 0)).slice(0, 10);
  return `<section><div class="section-head"><h2>Enemies · who hurts the ship</h2>${legend()}</div>
    <p class="note">Kill time is spawn → death. ☠ DEADLY marks the top three by deaths caused, then shield damage.</p>
    ${hbarChart(rows, { fmt: (v) => pct(v, 1) })}
    ${slots.map(table).join('')}</section>`;
}

function cards() {
  const slots = active();
  const table = (s, key, title) => {
    const list = state[s][key];
    if (!list.length) return '<p class="empty">No offers recorded.</p>';
    const fair = (c) => {
      if (c.fairness == null) return '<span class="muted">—</span>';
      const tag = c.flag === 'over' ? ' <b class="flag nerf">⬆ TOO OFTEN</b>' : c.flag === 'under' ? ' <b class="flag buff">⬇ TOO RARE</b>' : '';
      return `${c.fairness.toFixed(2)}${c.z != null ? ` <span class="muted">z ${c.z > 0 ? '+' : ''}${c.z.toFixed(1)}</span>` : ''}${c.lowSample ? ' <span class="muted">(low n)</span>' : ''}${tag}`;
    };
    return `<div class="table-wrap"><table><tr><th>${esc(s.toUpperCase())} · ${title}</th><th>Eligible hands</th><th>Drawn / expected</th><th>Fairness</th><th>Offered</th><th>Picked</th><th>Pick rate</th></tr>
      ${list.map((c) => `<tr><td>${esc(key === 'weaponPicks' ? weaponName(c.id) : cardName(c.id))}</td><td>${c.eligible ?? '—'}</td><td>${c.drawn ?? '—'} / ${c.expected ?? '—'}</td><td>${fair(c)}</td><td>${c.offered}</td><td>${c.picked}</td><td>${pct(c.pickRate)}<span class="inline-bar" style="width:${Math.round((c.pickRate || 0) * 60)}px; background:${SERIES[s]}"></span></td></tr>`).join('')}</table></div>`;
  };
  return `<section><div class="section-head"><h2>Cards · fairness &amp; pick rates</h2>${legend()}</div>
    <p class="note"><b>Fairness</b> = how often a card was drawn into a hand's random slots ÷ how often its weight predicts, counting only hands where it could appear (weapon cards only while that weapon is owned; maxed cards drop out). 1.00 is exactly fair; ⬆/⬇ flags mean more than ±25% off <i>and</i> beyond random noise (over 3 standard deviations), once ~20 draws were expected. Evolutions are rarer by design, but their fairness is still measured against their own lower weight.</p>
    <p class="note">NEW WEAPON pick rate: ${slots.map((s) => `${s.toUpperCase()} ${pct(state[s].newWeapon.pickRate)} (${state[s].newWeapon.picked}/${state[s].newWeapon.offered})`).join(' · ')}. Offers count every card shown, including rerolled hands; a locked card is counted once per hand.</p>
    <div>${slots.map((s) => table(s, 'cards', 'card')).join('')}</div>
    <h2 style="margin-top:12px">NEW WEAPON · which weapon was chosen</h2>
    <div class="grid2">${slots.map((s) => table(s, 'weaponPicks', 'weapon')).join('')}</div></section>`;
}

function runShape() {
  const slots = active();
  const share = (s, key) => {
    const d = state[s];
    return Object.fromEntries(d.run[key].histogram.map((b) => [b.label, d.runs ? b.count / d.runs : 0]));
  };
  const buckets = (key) => state[slots[0]].run[key].histogram.map((b) => ({ label: b.label, values: Object.fromEntries(slots.map((s) => [s, share(s, key)[b.label]])) }));
  const levels = state[slots[0]].run.pace.map((p) => p.level);
  const pace = Object.fromEntries(slots.map((s) => [s, state[s].run.pace.map((p) => (Number.isFinite(p.medianSeconds) ? p.medianSeconds / 60 : null))]));
  return `<section><div class="section-head"><h2>Run length and level</h2>${legend()}</div>
    <div class="grid2">
      <div><h2>Run length (minutes, share of runs)</h2>${columnChart(buckets('time'))}</div>
      <div><h2>Final level (share of runs)</h2>${columnChart(buckets('level'))}</div>
      <div><h2>Median minutes to reach a level</h2>${lineChart(levels, pace, { fmt: (v) => `${v.toFixed(1)}m`, xLabel: (l) => `LV ${l}` })}</div>
      <div><h2>Share of runs reaching a level</h2>${columnChart(levels.map((l, i) => ({ label: `LV ${l}`, values: Object.fromEntries(slots.map((s) => [s, state[s].run.pace[i]?.share || 0])) })))}</div>
    </div></section>`;
}

function render() {
  const main = document.getElementById('dashboard');
  if (!active().length) {
    main.innerHTML = '<p class="empty">No dataset loaded. Pick a live version (needs the deployed /api/stats function) or load a JSON file from <code>node tools/balance-sim.mjs --no-bench --stats-out sim-stats.json</code>.</p>';
    return;
  }
  const empty = active().every((s) => !state[s].runs);
  main.innerHTML = empty ? overview() + '<p class="empty">No runs in this dataset yet.</p>' : [overview(), weaponBalance(), damageShare(), enemies(), cards(), runShape()].join('');
}

function bind() {
  for (const slot of SLOTS) {
    const root = document.querySelector(`[data-slot="${slot}"]`);
    root.querySelector('[data-version]').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!v) { state[slot] = null; setStatus(slot, ''); render(); return; }
      loadLive(slot, v);
    });
    root.querySelector('[data-armory]')?.addEventListener('change', () => {
      const v = root.querySelector('[data-version]').value;
      if (v) loadLive(slot, v);
    });
    root.querySelector('[data-file]').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadFile(slot, file);
      e.target.value = '';
    });
  }
}

if (globalThis.document?.getElementById('dashboard')) {
  bind();
  await loadNames();
  render();
  loadLive('a', 'all');
}
