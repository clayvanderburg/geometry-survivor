// Upgrade card previews: headline benefit + exact BEFORE -> AFTER stats.
// Numbers are never hand-written: describeUpgrade() installs the upgrade (with its rolled level jump)
// on a deep copy of the player and diffs STAT_ROWS, which read the same values and WEAPON_SCALING
// formulas the game simulates with.
import { TUNING } from './config.js';
import { RARITY, applyUpgradeLevels, levelJumpChances } from './upgrades.js';
import {
  WEAPON_SCALING as W, TAG_INFO, weaponDamage, areaMult, missileBlastRadius, singularityPullRadius, novaRadius,
  tectonicBlastRadius, critChance, critDamage, critMultiplier, burnStackDps, chillSlow, corrodePerStack
} from './weapon-scaling.js';

const MAX_ROWS = 6;
// Jackpot caches with more than 3 rewards wrap to two rows of cards; fewer rows keep them on one screen.
export const COMPACT_MAX_ROWS = 3;
const int = (v) => String(Math.round(v));
const dec1 = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));
const secs = (v) => `${v.toFixed(2)}s`;
const pct = (v) => `${Math.round(v * 100)}%`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const mult = (v) => `${v.toFixed(2)}x`;
const bonus = (v) => `+${Math.round(v * 100)}%`;
const tagBonus = (v) => bonus(v - 1);
const tagBoost = (p, tag) => p.stats.tagDamage?.[tag] ?? 1;
const lv = (p, key) => p.weapons[key] || 0;
const owned = (p, key, fn) => (lv(p, key) > 0 ? fn(lv(p, key)) : null);

// headline: 'count' (+N UNIT), 'pct' (+N% UNIT), 'points' (+N% UNIT for ratio stats like luck),
// or a function(before, after). newText: headline when the row comes online (before is null).
export const STAT_ROWS = [
  // Build-wide modifiers first, so crit and tag cards lead with their own row
  { id: 'critChance', label: 'Crit chance', get: (p) => critChance(p), fmt: pct, headline: 'points', unit: 'CRIT CHANCE' },
  { id: 'critDamage', label: 'Crit damage', get: (p) => critDamage(p), fmt: mult, headline: 'points', unit: 'CRIT DAMAGE' },
  { id: 'critAverage', label: 'Avg bonus from crits', get: (p) => critChance(p) * (critDamage(p) - 1), fmt: (v) => `+${(v * 100).toFixed(1)}%` },
  { id: 'critAfflicted', label: 'Crit vs afflicted', get: (p) => (p.weapons.supercritical ? critMultiplier(p, true) : null), fmt: mult, newText: (a, row) => `AFFLICTED CRITS // ${row.fmt(a)}` },
  { id: 'kineticDamage', label: 'KINETIC damage bonus', get: (p) => tagBoost(p, 'kinetic'), fmt: tagBonus, headline: 'points', unit: 'KINETIC DAMAGE' },
  { id: 'explosiveDamage', label: 'EXPLOSIVE damage bonus', get: (p) => tagBoost(p, 'explosive'), fmt: tagBonus, headline: 'points', unit: 'EXPLOSIVE DAMAGE' },
  { id: 'electricDamage', label: 'ELECTRIC damage bonus', get: (p) => tagBoost(p, 'electric'), fmt: tagBonus, headline: 'points', unit: 'ELECTRIC DAMAGE' },
  { id: 'areaSize', label: 'AREA size', get: (p) => areaMult(p), fmt: pct, headline: 'points', unit: 'AREA SIZE' },

  // Primary blaster
  { id: 'bulletCount', label: 'Projectiles', get: (p) => p.stats.bulletCount, fmt: int, headline: 'count', unit: 'PROJECTILES' },
  { id: 'volleyArc', label: 'Volley arc', get: (p) => (p.stats.spreadAngle * Math.max(0, p.stats.bulletCount - 1) * 180) / Math.PI, fmt: (v) => `${Math.round(v)}°` },
  { id: 'fireRate', label: 'Fire rate', get: (p) => p.stats.fireRate, fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'FIRE RATE' },
  { id: 'bulletSpeed', label: 'Bolt speed', get: (p) => p.stats.bulletSpeed, fmt: dec1, headline: 'pct', unit: 'BOLT SPEED' },
  { id: 'pierce', label: 'Pierce', get: (p) => p.stats.pierce, fmt: int, headline: 'count', unit: 'PIERCE' },
  { id: 'damage', label: 'Bolt damage', get: (p) => weaponDamage(p, 'blaster'), fmt: dec1, headline: 'pct', unit: 'DAMAGE' },
  { id: 'helixBolts', label: 'Helix bolts / volley', get: (p) => (p.weapons.pulsarHelix ? W.helixArms : null), fmt: int, headline: 'count', unit: 'HELIX BOLTS / VOLLEY', newText: (a) => `+${a} HELIX BOLTS` },
  { id: 'helixDamage', label: 'Helix bolt damage', get: (p) => (p.weapons.pulsarHelix ? weaponDamage(p, 'helix') : null), fmt: dec1 },

  // Swarm Micro-Missiles + Storm Protocol
  { id: 'missileSalvo', label: 'Missiles / salvo', get: (p) => owned(p, 'missiles', W.missileSalvo), fmt: int, headline: 'count', unit: 'MISSILES / SALVO' },
  { id: 'missileCooldown', label: 'Salvo cooldown', get: (p) => owned(p, 'missiles', W.missileCooldown), fmt: secs },
  { id: 'missileDamage', label: 'Missile damage', get: (p) => owned(p, 'missiles', (l) => weaponDamage(p, 'missile', l)), fmt: dec1 },
  { id: 'missileBlast', label: 'Missile blast radius', get: (p) => owned(p, 'missiles', () => missileBlastRadius(p)), fmt: int },
  { id: 'stormChain', label: 'Detonation lightning', get: (p) => (p.weapons.stormProtocol ? W.lightningJumps(W.stormChainLevel) : null), fmt: (v) => `${v} jumps`, newText: () => 'MISSILES CHAIN LIGHTNING' },
  { id: 'stormDamage', label: 'Detonation arc damage', get: (p) => (p.weapons.stormProtocol ? weaponDamage(p, 'lightning', W.stormChainLevel) : null), fmt: dec1 },

  // Tesla Arc Emitter
  { id: 'lightningJumps', label: 'Arc jumps', get: (p) => owned(p, 'lightning', W.lightningJumps), fmt: int, headline: 'count', unit: 'ARC JUMPS' },
  { id: 'lightningCooldown', label: 'Arc cooldown', get: (p) => owned(p, 'lightning', W.lightningCooldown), fmt: secs },
  { id: 'lightningDamage', label: 'Arc damage / jump', get: (p) => owned(p, 'lightning', (l) => weaponDamage(p, 'lightning', l)), fmt: dec1 },

  // Vortex Singularity
  { id: 'singularityPull', label: 'Pull radius', get: (p) => owned(p, 'singularity', (l) => singularityPullRadius(p, l)), fmt: int, headline: 'count', unit: 'PULL RADIUS', newText: (a) => `BLACK HOLES // ${a} PULL RADIUS` },
  { id: 'singularityCooldown', label: 'Black hole cooldown', get: (p) => owned(p, 'singularity', W.singularityCooldown), fmt: secs },
  { id: 'singularityCore', label: 'Core radius', get: (p) => owned(p, 'singularity', W.singularityCoreRadius), fmt: int },
  { id: 'singularityCollapse', label: 'Collapse damage', get: (p) => owned(p, 'singularity', (l) => weaponDamage(p, 'collapse', l)), fmt: dec1 },

  // Aegis Orbiting Blades
  { id: 'orbitalBlades', label: 'Orbit blades', get: (p) => owned(p, 'orbitals', W.orbitalBlades), fmt: int, headline: 'count', unit: 'ORBIT BLADES' },
  { id: 'orbitalRadius', label: 'Orbit radius', get: (p) => owned(p, 'orbitals', W.orbitalRadius), fmt: int },
  { id: 'orbitalDamage', label: 'Blade damage / tick', get: (p) => owned(p, 'orbitals', () => weaponDamage(p, 'orbital')), fmt: dec1 },

  // Volatile Shatter
  { id: 'shrapnelShards', label: 'Shards / burst', get: (p) => owned(p, 'shrapnel', W.shrapnelShards), fmt: int, headline: 'count', unit: 'SHARDS / BURST' },
  { id: 'shrapnelChance', label: 'Burst chance / kill', get: (p) => owned(p, 'shrapnel', W.shrapnelChance), fmt: pct },
  { id: 'shrapnelDamage', label: 'Shard damage', get: (p) => owned(p, 'shrapnel', () => weaponDamage(p, 'shrapnel')), fmt: dec1 },

  // Drill-claws + Tectonic Claw Bore
  { id: 'miningSpeed', label: 'Mining speed', get: (p) => p.stats.miningSpeed, fmt: int, headline: 'pct', unit: 'MINING SPEED' },
  { id: 'miningRange', label: 'Claw reach', get: (p) => p.stats.miningRange, fmt: int },
  { id: 'drillScale', label: 'Claw size', get: (p) => p.stats.drillScale, fmt: mult },
  { id: 'tectonicBlast', label: 'Drill blast damage', get: (p) => (p.weapons.tectonicBore ? weaponDamage(p, 'tectonic') : null), fmt: dec1, newText: (a, row) => `ASTEROIDS DETONATE // ${row.fmt(a)} DMG` },
  { id: 'tectonicRadius', label: 'Drill blast radius', get: (p) => (p.weapons.tectonicBore ? tectonicBlastRadius(p) : null), fmt: int },

  // Luck
  { id: 'luck', label: 'Luck', get: (p) => p.stats.luck, fmt: pct, headline: 'points', unit: 'LUCK' },
  { id: 'doubleRoll', label: '+2 level roll chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.doubleChance - c.tripleChance; }, fmt: pct1 },
  { id: 'tripleRoll', label: '+3 level roll chance', get: (p) => levelJumpChances(p.stats.luck || 1).tripleChance, fmt: pct1 },

  // Geom Attractor Field
  { id: 'magnetRadius', label: 'Pickup radius', get: (p) => p.stats.magnetRadius, fmt: int, headline: 'pct', unit: 'PICKUP RADIUS' },
  { id: 'xpMultiplier', label: 'XP gain', get: (p) => p.stats.xpMultiplier, fmt: mult, headline: 'pct', unit: 'XP GAIN' },
  { id: 'bombs', label: 'Supernova bombs', get: (p) => p.bombs, fmt: int, headline: 'count', unit: 'BOMBS' },

  // Phase Nova Thrusters
  { id: 'moveSpeed', label: 'Move speed', get: (p) => p.stats.moveSpeed, fmt: (v) => v.toFixed(2), headline: 'pct', unit: 'MOVE SPEED' },
  { id: 'maxHp', label: 'Max shield', get: (p) => p.maxHp, fmt: int, headline: 'count', unit: 'MAX SHIELD' },
  { id: 'hp', label: 'Shield now', get: (p) => p.hp, fmt: int },
  { id: 'dashCooldown', label: 'Dash cooldown', get: (p) => W.dashCooldown(lv(p, 'dashNova'), TUNING.dashCooldownBase ?? 1.5), fmt: secs },
  { id: 'novaRadius', label: 'Dash nova radius', get: (p) => owned(p, 'dashNova', (l) => novaRadius(p, l)), fmt: int },
  { id: 'novaDamage', label: 'Dash nova damage', get: (p) => owned(p, 'dashNova', (l) => weaponDamage(p, 'nova', l)), fmt: int },

  // Damage types (status effects, see status-effects.js)
  { id: 'burnMax', label: 'Max burn DPS / target', get: (p) => owned(p, 'thermite', (l) => burnStackDps(p, l) * W.burnMaxStacks(l)), fmt: dec1, headline: 'pct', unit: 'MAX BURN DPS', newText: (a, row) => `BOLTS IGNITE // ${row.fmt(a)} BURN DPS` },
  { id: 'burnStack', label: 'Burn DPS / stack', get: (p) => owned(p, 'thermite', (l) => burnStackDps(p, l)), fmt: dec1 },
  { id: 'burnStacks', label: 'Burn max stacks', get: (p) => owned(p, 'thermite', W.burnMaxStacks), fmt: int },
  { id: 'burnDuration', label: 'Burn duration', get: (p) => owned(p, 'thermite', () => W.burnDuration), fmt: secs },
  { id: 'chillSlow', label: 'Chill slow', get: (p) => owned(p, 'cryo', (l) => chillSlow(l)), fmt: pct, headline: 'points', unit: 'CHILL SLOW', newText: (a, row) => `MISSILES CHILL // -${row.fmt(a)} SPEED` },
  { id: 'chillBoss', label: 'Chill slow on bosses', get: (p) => owned(p, 'cryo', (l) => chillSlow(l, true)), fmt: pct },
  { id: 'chillDuration', label: 'Chill duration', get: (p) => owned(p, 'cryo', W.chillDuration), fmt: secs },
  { id: 'corrodeMax', label: 'Max damage taken', get: (p) => owned(p, 'nanite', (l) => corrodePerStack() * W.corrodeMaxStacks(l)), fmt: bonus, headline: (b, a) => `+${Math.round((a - b) * 100)}% MAX CORRODE`, newText: (a, row) => `ARCS CORRODE // ${row.fmt(a)} DMG TAKEN` },
  { id: 'corrodeStack', label: 'Damage taken / stack', get: (p) => owned(p, 'nanite', () => corrodePerStack()), fmt: bonus },
  { id: 'corrodeStacks', label: 'Corrode max stacks', get: (p) => owned(p, 'nanite', W.corrodeMaxStacks), fmt: int },
  { id: 'corrodeDuration', label: 'Corrode duration', get: (p) => owned(p, 'nanite', () => W.corrodeDuration), fmt: secs }
];

const ROW_BY_ID = Object.fromEntries(STAT_ROWS.map((row) => [row.id, row]));

// Plain-data deep copy (the player holds only numbers, flags and nested plain objects).
function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key in value) out[key] = deepCopy(value[key]);
    return out;
  }
  return value;
}

function readRows(player) {
  return STAT_ROWS.map((row) => {
    const v = row.get(player);
    return v === null || v === undefined || Number.isNaN(v) ? null : v;
  });
}

function headlineText(row, before, after) {
  if (before === null) {
    if (row.newText) return row.newText(after, row);
    if (row.headline === 'count') return `+${row.fmt(after)} ${row.unit}`;
    return `NEW // ${row.fmt(after)} ${row.unit || row.label.toUpperCase()}`;
  }
  if (typeof row.headline === 'function') return row.headline(before, after);
  const sign = after >= before ? '+' : '';
  if (row.headline === 'pct') return `${sign}${Math.round((after / before - 1) * 100)}% ${row.unit}`;
  if (row.headline === 'points') return `${sign}${Math.round((after - before) * 100)}% ${row.unit}`;
  if (row.headline === 'count') return `${sign}${Math.round(after - before)} ${row.unit}`;
  return `${row.label.toUpperCase()} ${row.fmt(before)} → ${row.fmt(after)}`;
}

// Everything a card shows, computed by installing `upg` on a copy of `player`.
// Rows list only stats whose displayed value changes; `hiddenRows` counts any beyond maxRows.
export function describeUpgrade(player, upg, maxRows = MAX_ROWS) {
  const fromLevel = player.upgradeLevels[upg.id] || 0;
  const before = readRows(player);
  const copy = deepCopy(player);
  const jump = applyUpgradeLevels(copy, upg);
  const after = readRows(copy);

  const changed = [];
  STAT_ROWS.forEach((row, i) => {
    const b = before[i];
    const a = after[i];
    if (a === null && b === null) return;
    const bText = b === null ? '—' : row.fmt(b);
    const aText = a === null ? '—' : row.fmt(a);
    if (bText !== aText) changed.push({ id: row.id, label: row.label, before: bText, after: aText, b, a });
  });

  const lead = changed.find((r) => r.id === upg.headline) || changed[0];
  const headline = lead ? headlineText(ROW_BY_ID[lead.id], lead.b, lead.a) : upg.name.toUpperCase();
  const rarity = RARITY[upg.rarity] ? upg.rarity : 'common';

  return {
    id: upg.id,
    name: upg.name,
    category: upg.category,
    tags: (upg.tags || []).filter((t) => TAG_INFO[t]),
    summary: upg.summary || '',
    isSynergy: !!upg.isSynergy,
    rarity,
    rarityLabel: RARITY[rarity].label,
    color: RARITY[rarity].color,
    jump,
    fromLevel,
    toLevel: fromLevel + jump,
    maxLevel: upg.maxLevel,
    headline,
    rows: changed.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, changed.length - maxRows)
  };
}

// Same wording everywhere: level cards "LV 2 → LV 3", caches "INSTALLED // LV 2 → LV 3", HUD "LV 3".
export function levelText(d, installed = false) {
  if (d.isSynergy) return installed ? '★ EVOLUTION INSTALLED ★' : '★ EVOLUTION // UNLOCK ★';
  const from = d.fromLevel === 0 ? 'NEW' : `LV ${d.fromLevel}`;
  return `${installed ? 'INSTALLED // ' : ''}${from} → LV ${d.toLevel}<span class="upg-max"> / ${d.maxLevel}</span>`;
}

// Returns { className, html } for an .upgrade-option card (level-up choice or cache reward).
export function renderUpgradeCard(d, keyLabel, installed = false) {
  const ribbon = d.jump > 1
    ? `<div class="upg-jump-ribbon">${d.jump === 3 ? '★★' : '★'} LUCKY ROLL // +${d.jump} LEVELS</div>`
    : '';
  const rows = d.rows.map((r) => `
          <div class="upg-stat"><span class="upg-stat-label">${r.label}</span><span class="upg-stat-val"><span class="upg-before">${r.before}</span> → <b>${r.after}</b></span></div>`).join('');
  const tags = d.tags && d.tags.length
    ? `<div class="upg-tags">${d.tags.map((t) => `<span class="upg-tag" style="--tag:${TAG_INFO[t].color}">${TAG_INFO[t].label}</span>`).join('')}</div>`
    : '';
  const more = d.hiddenRows ? `<div class="upg-stat upg-stat-more">+${d.hiddenRows} more stat${d.hiddenRows > 1 ? 's' : ''} improved</div>` : '';
  return {
    className: `upgrade-option rarity-${d.rarity}${d.jump > 1 ? ` jump-${d.jump}` : ''}`,
    html: `
      ${ribbon}
      <div>
        <div class="upg-top">
          <span class="upg-key">${keyLabel}</span>
          <span class="upg-badge">${d.rarityLabel} · ${d.category}</span>
        </div>
        <div class="upg-name">${d.name}</div>${tags}
        <div class="upg-headline">${d.headline}</div>
        <div class="upg-summary">${d.summary}</div>
        <div class="upg-stats">${rows}${more}
        </div>
      </div>
      <div class="upg-level">${levelText(d, installed)}</div>
    `
  };
}
