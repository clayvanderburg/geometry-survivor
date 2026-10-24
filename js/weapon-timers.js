// Weapon timers (v0.46, Clay: "show reload/cds ticking down"): each equipped weapon's progress toward its
// next attack, for the hardpoint glow (hardpoints.js drawHardpoints) and the HUD chip sweep
// (run-overview.js weaponChipsHtml, refreshed live by main.js at about 15 Hz).
//
// Weapons that track their own charge write it on the mount (setMountCharge: Shock Field, Rail Lance,
// Glaive, the Sentry Turret bank). The rest are timed from their last shot (kickMount resets the mount's
// clock) over the attack interval their formula gives now, so a weapon holding fire for want of a target
// reads READY (1). Weapons that attack faster than RAPID_INTERVAL, and the ones that never stop (sprayers,
// Gas Trail, Orbit Blades), show a steady "always on" state instead of a sweep that would only flicker.
import { WEAPON_SCALING as W } from './weapon-scaling.js';
import { weaponBuild } from './weapon-levels.js';
import { mountFx, setMountCharge } from './hardpoints.js';

export const RAPID_INTERVAL = 0.45; // s: anything quicker reads as always on
export const CONTINUOUS = Object.freeze(['flamethrower', 'cryospray', 'acidspray', 'gas', 'orbitals', 'blaster', 'drones', 'harpoon']);
// Weapons that write their own charge on the mount (0..1).
export const OWN_CHARGE = Object.freeze(['shockfield', 'raillance', 'glaive', 'turret']);
// Attack interval in s of every other timed weapon, from its build.
export const ATTACK_INTERVAL = Object.freeze({
  rockets: (b) => W.wingRocketCooldown(b),
  missiles: (b) => W.missileCooldown(b),
  lightning: (b) => W.lightningCooldown(b),
  singularity: (b) => W.singularityCooldown(b),
  mines: (b) => W.mineCooldown(b),
  grenades: (b) => W.grenadeCooldown(b),
  nanites: (b) => W.naniteCooldown(b),
  quake: (b) => W.quakeCooldown(b)
});

// 'on' (continuous or rapid), a number 0..1 (time to the next attack or charge, 1 = ready) or null (not timed).
export function weaponTimer(p, id) {
  if (CONTINUOUS.includes(id)) return 'on';
  const fx = mountFx(p, id);
  if (OWN_CHARGE.includes(id)) return fx && fx.charge >= 0 ? Math.max(0, Math.min(1, fx.charge)) : 1;
  const interval = ATTACK_INTERVAL[id];
  if (!interval) return null;
  const s = interval(weaponBuild(p, id));
  if (!(s >= RAPID_INTERVAL)) return 'on';
  return fx && fx.since != null ? Math.max(0, Math.min(1, fx.since / s)) : 1;
}

// Every equipped weapon's timer ({ id: 'on' | 0..1 }), and the timed ones written on their mounts so the
// hardpoint glow builds with the sweep. Called once a tick after the weapons update.
export function syncWeaponTimers(p, owned) {
  const out = {};
  for (const id of owned) {
    const t = weaponTimer(p, id);
    if (t == null) continue;
    out[id] = t;
    if (typeof t === 'number' && !OWN_CHARGE.includes(id)) setMountCharge(p, id, t);
  }
  return out;
}
