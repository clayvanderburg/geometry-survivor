// Weapon pills: a weapon's short name as a small chip in its own colour (WEAPONS[].color), like the HUD's
// loadout slots. Every card renderer uses weaponPill() wherever a card names a weapon: the weapon a card
// changes, Replicator's per-weapon headline, the weapons a tag / global card reaches, Breakthroughs,
// evolution recipes and stat rows that belong to one weapon.
import { WEAPON_BY_ID } from './loadout.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// `cls` adds classes (recipe chips add their state), `text` replaces the label, `suffix` follows it
// (e.g. " ✓"). An unknown id falls back to a plain chip with the id, so a stale reference never breaks a card.
export function weaponPill(id, { cls = '', text = null, suffix = '' } = {}) {
  const w = WEAPON_BY_ID[id];
  const label = text ?? (w ? w.hudName || w.name : id);
  const style = w?.color ? ` style="--wc:${w.color}"` : '';
  return `<span class="wpn-pill${cls ? ` ${cls}` : ''}"${style}>${esc(label)}${suffix}</span>`;
}

export const weaponPills = (ids) => [...new Set(ids)].filter(Boolean).map((id) => weaponPill(id)).join('');

// Which weapon a card stat row (upgrade-cards.js STAT_ROWS id) belongs to, or null for ship-wide rows.
// Element rows are "<weapon>:<stat>"; the rest go by their prefix. tests/weapon-pills.test.js checks this
// against the rows each weapon actually lights up.
const ROW_PREFIX = [
  [/^(blaster|bulletCount|prismLayout|fireRate|bulletSpeed|pierce|damage|helix)/, 'blaster'],
  [/^rocket/, 'rockets'], [/^(missile|storm)/, 'missiles'], [/^lightning/, 'lightning'],
  [/^singularity/, 'singularity'], [/^orbital/, 'orbitals'], [/^mine/, 'mines'], [/^(turret|siege)/, 'turret'],
  [/^drone/, 'drones'], [/^(grenade|emp)/, 'grenades'], [/^gas/, 'gas'], [/^flame/, 'flamethrower'],
  [/^cryo/, 'cryospray'], [/^acid/, 'acidspray'], [/^field/, 'shockfield'], [/^rail/, 'raillance'],
  [/^glaive/, 'glaive'], [/^nanite/, 'nanites'], [/^harpoon/, 'harpoon'], [/^quake/, 'quake']
];
export function rowWeapon(rowId) {
  const head = String(rowId).split(':');
  if (head.length > 1) return WEAPON_BY_ID[head[0]] ? head[0] : null;
  for (const [re, id] of ROW_PREFIX) if (re.test(rowId)) return id;
  return null;
}
