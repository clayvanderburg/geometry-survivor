// Upgrade card previews: headline benefit + exact BEFORE -> AFTER stats.
// Numbers are never hand-written: describeUpgrade() installs the upgrade (with its rolled level jump)
// on a deep copy of the player and diffs STAT_ROWS, which read the same values and WEAPON_SCALING
// formulas the game simulates with.
import { TUNING } from './config.js';
import { RARITY, rarityFor, applyUpgradeLevels, levelJumpChances } from './upgrades.js';
import { WEAPON_SCALING as W } from './weapon-scaling.js';

const MAX_ROWS = 6;
// Jackpot caches with more than 3 rewards wrap to two rows of cards; fewer rows keep them on one screen.
export const COMPACT_MAX_ROWS = 3;
const int = (v) => String(Math.round(v));
const dec1 = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));
const secs = (v) => `${v.toFixed(2)}s`;
const pct = (v) => `${Math.round(v * 100)}%`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const pct2 = (v) => `${(v * 100).toFixed(2)}%`;
const mult = (v) => `${v.toFixed(2)}x`;
const lv = (p, key) => p.weapons[key] || 0;
const owned = (p, key, fn) => (lv(p, key) > 0 ? fn(lv(p, key)) : null);
const sec1 = (v) => `${v.toFixed(1)}s`;
// Deployable hits scale with bolt damage and the tuner's deployable multiplier (same as deployables.js).
const deployDamage = (p, m) => p.stats.damage * m * (TUNING.deployableDamageMult ?? 1);

// headline: 'count' (+N UNIT), 'pct' (+N% UNIT), 'points' (+N% UNIT for ratio stats like luck),
// or a function(before, after). newText: headline when the row comes online (before is null).
export const STAT_ROWS = [
  // Primary blaster
  { id: 'bulletCount', label: 'Projectiles', get: (p) => p.stats.bulletCount, fmt: int, headline: 'count', unit: 'PROJECTILES' },
  { id: 'volleyArc', label: 'Volley arc', get: (p) => (p.stats.spreadAngle * Math.max(0, p.stats.bulletCount - 1) * 180) / Math.PI, fmt: (v) => `${Math.round(v)}°` },
  { id: 'fireRate', label: 'Fire rate', get: (p) => p.stats.fireRate, fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'FIRE RATE' },
  { id: 'bulletSpeed', label: 'Bolt speed', get: (p) => p.stats.bulletSpeed, fmt: dec1, headline: 'pct', unit: 'BOLT SPEED' },
  { id: 'pierce', label: 'Pierce', get: (p) => p.stats.pierce, fmt: int, headline: 'count', unit: 'PIERCE' },
  { id: 'damage', label: 'Bolt damage', get: (p) => p.stats.damage, fmt: dec1, headline: 'pct', unit: 'DAMAGE' },
  { id: 'helixBolts', label: 'Helix bolts / volley', get: (p) => (p.weapons.pulsarHelix ? W.helixArms : null), fmt: int, headline: 'count', unit: 'HELIX BOLTS / VOLLEY', newText: (a) => `+${a} HELIX BOLTS` },
  { id: 'helixDamage', label: 'Helix bolt damage', get: (p) => (p.weapons.pulsarHelix ? p.stats.damage * W.helixDamageMult : null), fmt: dec1 },

  // Swarm Micro-Missiles + Storm Protocol
  { id: 'missileSalvo', label: 'Missiles / salvo', get: (p) => owned(p, 'missiles', W.missileSalvo), fmt: int, headline: 'count', unit: 'MISSILES / SALVO' },
  { id: 'missileCooldown', label: 'Salvo cooldown', get: (p) => owned(p, 'missiles', W.missileCooldown), fmt: secs },
  { id: 'missileDamage', label: 'Missile damage', get: (p) => owned(p, 'missiles', (l) => p.stats.damage * W.missileDamageMult(l)), fmt: dec1 },
  { id: 'stormChain', label: 'Detonation lightning', get: (p) => (p.weapons.stormProtocol ? W.lightningJumps(W.stormChainLevel) : null), fmt: (v) => `${v} jumps`, newText: () => 'MISSILES CHAIN LIGHTNING' },

  // Tesla Arc Emitter
  { id: 'lightningJumps', label: 'Arc jumps', get: (p) => owned(p, 'lightning', W.lightningJumps), fmt: int, headline: 'count', unit: 'ARC JUMPS' },
  { id: 'lightningCooldown', label: 'Arc cooldown', get: (p) => owned(p, 'lightning', W.lightningCooldown), fmt: secs },
  { id: 'lightningDamage', label: 'Arc damage / jump', get: (p) => owned(p, 'lightning', (l) => p.stats.damage * W.lightningDamageMult(l)), fmt: dec1 },

  // Vortex Singularity
  { id: 'singularityPull', label: 'Pull radius', get: (p) => owned(p, 'singularity', W.singularityPullRadius), fmt: int, headline: 'count', unit: 'PULL RADIUS', newText: (a) => `SINGULARITIES // ${a} PULL RADIUS` },
  { id: 'singularityCooldown', label: 'Singularity cooldown', get: (p) => owned(p, 'singularity', W.singularityCooldown), fmt: secs },
  { id: 'singularityCore', label: 'Core radius', get: (p) => owned(p, 'singularity', W.singularityCoreRadius), fmt: int },
  { id: 'singularityCollapse', label: 'Collapse damage', get: (p) => owned(p, 'singularity', (l) => p.stats.damage * W.singularityCollapseDamageMult(l) * (TUNING.singularityCollapseMult ?? 1)), fmt: dec1 },

  // Aegis Orbiting Blades
  { id: 'orbitalBlades', label: 'Orbit blades', get: (p) => owned(p, 'orbitals', W.orbitalBlades), fmt: int, headline: 'count', unit: 'ORBIT BLADES' },
  { id: 'orbitalRadius', label: 'Orbit radius', get: (p) => owned(p, 'orbitals', W.orbitalRadius), fmt: int },
  { id: 'orbitalDamage', label: 'Blade damage / tick', get: (p) => owned(p, 'orbitals', () => p.stats.damage * W.orbitalDamageMult), fmt: dec1 },

  // Volatile Shatter
  { id: 'shrapnelShards', label: 'Shards / burst', get: (p) => owned(p, 'shrapnel', W.shrapnelShards), fmt: int, headline: 'count', unit: 'SHARDS / BURST' },
  { id: 'shrapnelChance', label: 'Burst chance / kill', get: (p) => owned(p, 'shrapnel', W.shrapnelChance), fmt: pct },
  { id: 'shrapnelDamage', label: 'Shard damage', get: (p) => owned(p, 'shrapnel', () => p.stats.damage * W.shrapnelDamageMult), fmt: dec1 },

  // Deployables: Proximity Mines, Sentry Turret (+ Siege Battery), Escort Drones
  { id: 'mineMaxActive', label: 'Max active mines', get: (p) => owned(p, 'mines', W.mineMaxActive), fmt: int, headline: 'count', unit: 'MAX ACTIVE MINES', newText: (a) => `PROXIMITY MINES // ${a} ACTIVE` },
  { id: 'mineDamage', label: 'Mine blast damage', get: (p) => owned(p, 'mines', (l) => deployDamage(p, W.mineDamageMult(l))), fmt: dec1 },
  { id: 'mineCooldown', label: 'Mine drop interval', get: (p) => owned(p, 'mines', W.mineCooldown), fmt: secs },
  { id: 'mineBlastRadius', label: 'Mine blast radius', get: (p) => owned(p, 'mines', W.mineBlastRadius), fmt: int },
  { id: 'mineTrigger', label: 'Mine trigger radius', get: (p) => owned(p, 'mines', W.mineTriggerRadius), fmt: int },
  { id: 'mineLifetime', label: 'Mine fuse', get: (p) => owned(p, 'mines', W.mineLifetime), fmt: sec1 },
  { id: 'turretMaxActive', label: 'Max active turrets', get: (p) => owned(p, 'turret', W.turretMaxActive), fmt: int, headline: (b, a) => `+${a - b} SENTRY TURRET${a - b > 1 ? 'S' : ''}`, newText: (a) => `SENTRY TURRET // ${a} ACTIVE` },
  { id: 'turretFireRate', label: 'Turret fire rate', get: (p) => owned(p, 'turret', W.turretFireRate), fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'TURRET FIRE RATE' },
  { id: 'turretDuration', label: 'Turret lifetime', get: (p) => owned(p, 'turret', W.turretDuration), fmt: sec1 },
  { id: 'turretCooldown', label: 'Turret deploy cooldown', get: (p) => owned(p, 'turret', W.turretCooldown), fmt: secs },
  { id: 'turretRange', label: 'Turret range', get: (p) => owned(p, 'turret', W.turretRange), fmt: int },
  { id: 'turretDamage', label: 'Turret bolt damage', get: (p) => owned(p, 'turret', (l) => deployDamage(p, W.turretDamageMult(l))), fmt: dec1 },
  { id: 'siegeShell', label: 'Turret shell burst', get: (p) => (p.weapons.siegeBattery ? deployDamage(p, W.turretDamageMult(Math.max(1, lv(p, 'turret'))) * W.siegeShellDamageMult) : null), fmt: dec1, newText: (a, row) => `TURRET SHELLS BURST // ${row.fmt(a)} DMG` },
  { id: 'droneCount', label: 'Escort drones', get: (p) => owned(p, 'drones', W.droneCount), fmt: int, headline: (b, a) => `+${a - b} ESCORT DRONE${a - b > 1 ? 'S' : ''}`, newText: (a) => `+${a} ESCORT DRONE${a > 1 ? 'S' : ''}` },
  { id: 'droneFireRate', label: 'Drone fire rate (each)', get: (p) => owned(p, 'drones', W.droneFireRate), fmt: (v) => `${v.toFixed(2)}/s`, headline: 'pct', unit: 'DRONE FIRE RATE' },
  { id: 'droneRange', label: 'Drone range', get: (p) => owned(p, 'drones', W.droneRange), fmt: int },
  { id: 'droneDamage', label: 'Drone bolt damage', get: (p) => owned(p, 'drones', (l) => deployDamage(p, W.droneDamageMult(l))), fmt: dec1 },

  // Drill-claws + Tectonic Claw Bore
  { id: 'miningSpeed', label: 'Mining speed', get: (p) => p.stats.miningSpeed, fmt: int, headline: 'pct', unit: 'MINING SPEED' },
  { id: 'miningRange', label: 'Claw reach', get: (p) => p.stats.miningRange, fmt: int },
  { id: 'drillScale', label: 'Claw size', get: (p) => p.stats.drillScale, fmt: mult },
  { id: 'tectonicBlast', label: 'Drill blast damage', get: (p) => (p.weapons.tectonicBore ? p.stats.damage * W.tectonicDamageMult : null), fmt: dec1, newText: (a, row) => `ASTEROIDS DETONATE // ${row.fmt(a)} DMG` },

  // Luck
  { id: 'luck', label: 'Luck', get: (p) => p.stats.luck, fmt: pct, headline: 'points', unit: 'LUCK' },
  { id: 'doubleRoll', label: '+2 level (uncommon) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.doubleChance - c.tripleChance; }, fmt: pct1 },
  { id: 'tripleRoll', label: '+3 level (rare) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.tripleChance - c.quadChance; }, fmt: pct1 },
  { id: 'quadRoll', label: '+4 level (epic) chance', get: (p) => { const c = levelJumpChances(p.stats.luck || 1); return c.quadChance - c.pentaChance; }, fmt: pct2 },
  { id: 'pentaRoll', label: '+5 level (legendary) chance', get: (p) => levelJumpChances(p.stats.luck || 1).pentaChance, fmt: pct2 },

  // Geom Attractor Field
  { id: 'magnetRadius', label: 'Pickup radius', get: (p) => p.stats.magnetRadius, fmt: int, headline: 'pct', unit: 'PICKUP RADIUS' },
  { id: 'xpMultiplier', label: 'XP gain', get: (p) => p.stats.xpMultiplier, fmt: mult, headline: 'pct', unit: 'XP GAIN' },
  { id: 'bombs', label: 'Supernova bombs', get: (p) => p.bombs, fmt: int, headline: 'count', unit: 'BOMBS' },

  // Phase Nova Thrusters
  { id: 'moveSpeed', label: 'Move speed', get: (p) => p.stats.moveSpeed, fmt: (v) => v.toFixed(2), headline: 'pct', unit: 'MOVE SPEED' },
  { id: 'maxHp', label: 'Max shield', get: (p) => p.maxHp, fmt: int, headline: 'count', unit: 'MAX SHIELD' },
  { id: 'hp', label: 'Shield now', get: (p) => p.hp, fmt: int },
  { id: 'dashCooldown', label: 'Dash cooldown', get: (p) => W.dashCooldown(lv(p, 'dashNova'), TUNING.dashCooldownBase ?? 1.5), fmt: secs },
  { id: 'novaRadius', label: 'Dash nova radius', get: (p) => owned(p, 'dashNova', W.novaRadius), fmt: int },
  { id: 'novaDamage', label: 'Dash nova damage', get: (p) => owned(p, 'dashNova', W.novaDamage), fmt: int }
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
  const rarity = rarityFor(upg, jump);

  return {
    id: upg.id,
    name: upg.name,
    category: upg.category,
    summary: upg.summary || '',
    isSynergy: !!upg.isSynergy,
    rarity,
    rarityLabel: RARITY[rarity].label,
    color: RARITY[rarity].color,
    jump,
    fromLevel,
    toLevel: fromLevel + jump,
    maxLevel: upg.maxLevel,
    bonus: bonusLevels(copy, upg.id),
    headline,
    rows: changed.slice(0, maxRows).map(({ id, label, before: b, after: a }) => ({ id, label, before: b, after: a })),
    hiddenRows: Math.max(0, changed.length - maxRows)
  };
}

// Levels an evolution adds on top of a weapon's own level (Storm Protocol adds a missile launcher).
export function bonusLevels(player, id) {
  if (id === 'missiles' && player.weapons?.stormProtocol) return { amount: 1, label: 'STORM' };
  return null;
}

export function bonusText(bonus) {
  return bonus ? ` <span class="lv-bonus">+${bonus.amount} ${bonus.label}</span>` : '';
}

// Same wording everywhere: level cards "LV 2 → LV 3", caches "INSTALLED // LV 2 → LV 3", HUD "LV 3".
export function levelText(d, installed = false) {
  if (d.isSynergy) return installed ? '★ EVOLUTION INSTALLED ★' : '★ EVOLUTION // UNLOCK ★';
  const from = d.fromLevel === 0 ? 'NEW' : `LV ${d.fromLevel}`;
  return `${installed ? 'INSTALLED // ' : ''}${from} → LV ${d.toLevel}${bonusText(d.bonus)}<span class="upg-max"> / ${d.maxLevel}</span>`;
}

// Returns { className, html } for an .upgrade-option card (level-up choice or cache reward).
export function renderUpgradeCard(d, keyLabel, installed = false) {
  const ribbon = d.jump > 1
    ? `<div class="upg-jump-ribbon">${'★'.repeat(d.jump - 1)} +${d.jump} LEVELS</div>`
    : '';
  const rows = d.rows.map((r) => `
          <div class="upg-stat"><span class="upg-stat-label">${r.label}</span><span class="upg-stat-val"><span class="upg-before">${r.before}</span> → <b>${r.after}</b></span></div>`).join('');
  const more = d.hiddenRows ? `<div class="upg-stat upg-stat-more">+${d.hiddenRows} more stat${d.hiddenRows > 1 ? 's' : ''} improved</div>` : '';
  return {
    className: `upgrade-option rarity-${d.rarity}${d.jump > 1 ? ` jump-${d.jump}` : ''}`,
    html: `
      ${ribbon}
      <div>
        <div class="upg-top">
          <span class="upg-key">${keyLabel}</span>
          <span class="upg-badge">${d.rarityLabel === d.category ? d.category : `${d.rarityLabel} · ${d.category}`}</span>
        </div>
        <div class="upg-name">${d.name}</div>
        <div class="upg-headline">${d.headline}</div>
        <div class="upg-summary">${d.summary}</div>
        <div class="upg-stats">${rows}${more}
        </div>
      </div>
      <div class="upg-level">${levelText(d, installed)}</div>
    `
  };
}
