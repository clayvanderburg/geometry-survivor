// Ship hardpoints (docs/SHIP_HARDPOINTS.md): every equipped weapon shows a small part on the hull in its
// weapon colour, and its shots, lobs and deploys leave from that part.
//
// Built-in mounts keep the place a weapon already fires from (turret, drills, wingtips, the hull rim, the
// hub under the turret) and take no hardpoint. Everything else fills one of five hardpoints in slot order:
// its preferred type first (port before starboard), then the fallback order. Assignments live on the
// player (visual state, never read by the simulation) and stay put when another weapon is discarded.
//
// Mount feel (flash, recoil, heat, swivel, charge) is kicked by the weapon modules and decays in
// updateMounts (called from updateShipAnimation). Parts are drawn from cached sprites, one per
// (part, colour, variant, render scale), so a frame costs a drawImage per part.
//
// Kept free of config.js / loadout.js so ship-renderer.js stays importable headless; colours mirror
// WEAPONS[].color (tests/hardpoints.test.js checks them).
import { isReduceEffects } from './juice.js';

// Hardpoints in hull space, as multiples of the hull radius (x forward, y starboard).
export const HARDPOINTS = {
  spine: { x: -0.6, y: 0, side: 0 },
  rootPort: { x: 0.3, y: -0.98, side: -1 },
  rootStbd: { x: 0.3, y: 0.98, side: 1 },
  wingPort: { x: -0.3, y: -1.2, side: -1 },
  wingStbd: { x: -0.3, y: 1.2, side: 1 }
};
const TYPE_POINTS = { spine: ['spine'], root: ['rootPort', 'rootStbd'], wing: ['wingPort', 'wingStbd'] };
const FALLBACK = { spine: ['spine', 'root', 'wing'], root: ['root', 'wing', 'spine'], wing: ['wing', 'root', 'spine'] };

// Rocket Pods' own mount: the wingtips their rockets already launch from (main.js fireWingRockets).
export const WINGTIP = { x: -0.5, y: 1.7 };
export const RIM = 0.95; // sprayer nozzles ride the hull rim here (flamethrower.js aim)

// Each weapon's mount: `builtin` names its fixed place, else `type` is the preferred hardpoint type.
// `part` picks the drawing; `swivel` parts turn toward what they launch at.
export const MOUNTS = {
  blaster: { builtin: 'turret', part: 'barrels', color: '#00f3ff' },
  raillance: { builtin: 'turret', part: 'rail', color: '#9d8cff' },
  harpoon: { builtin: 'drills', part: null, color: '#ffcc00' },
  rockets: { builtin: 'wingtips', part: 'pod', color: '#ff9b3d' },
  flamethrower: { builtin: 'rim', part: 'nozzle', color: '#ffa526' },
  cryospray: { builtin: 'rim', part: 'nozzle', color: '#8fe8ff' },
  acidspray: { builtin: 'rim', part: 'nozzle', color: '#9dff4a' },
  orbitals: { builtin: 'hub', part: 'hub', color: '#6dff9e' },
  lightning: { type: 'spine', part: 'coil', color: '#c79bff' },
  singularity: { type: 'spine', part: 'lens', swivel: true, color: '#ff6ad5' },
  quake: { type: 'spine', part: 'mortar', swivel: true, color: '#ff8a5c' },
  mines: { type: 'spine', part: 'chute', color: '#ff5a5a' },
  gas: { type: 'spine', part: 'vents', color: '#5dff6e' },
  grenades: { type: 'root', part: 'launcher', swivel: true, color: '#38ffc8' },
  glaive: { type: 'root', part: 'disc', swivel: true, color: '#ff8a3d' },
  turret: { type: 'root', part: 'cradle', color: '#5aa8ff' },
  shockfield: { type: 'root', part: 'dish', color: '#9ff4ff' },
  missiles: { type: 'wing', part: 'rack', swivel: true, color: '#ffe14d' },
  drones: { type: 'wing', part: 'bay', color: '#b6ff4a' },
  nanites: { type: 'wing', part: 'hive', swivel: true, color: '#c4ff7a' }
};

// ---- Layout ----

// Hardpoint key of each owned hardpoint weapon ({ grenades: 'rootPort', ... }), reconciled with the
// loadout: discarded weapons free their point, new ones take the first free point of their order.
export function hardpointLayout(p) {
  const owned = ownedWeapons(p);
  const sig = owned.join(',');
  if (p.hardpoints && p.hardpointSig === sig) return p.hardpoints;
  const map = { ...(p.hardpoints || {}) };
  for (const id of Object.keys(map)) if (!owned.includes(id)) delete map[id];
  const taken = new Set(Object.values(map));
  // Of a type's free points, the one on the side with fewer parts (port on a tie), so the ship stays balanced.
  const load = (side) => [...taken].filter((k) => HARDPOINTS[k].side === side).length;
  for (const id of owned) {
    const m = MOUNTS[id];
    if (!m?.type || map[id]) continue;
    for (const type of FALLBACK[m.type]) {
      const free = TYPE_POINTS[type].filter((k) => !taken.has(k));
      if (!free.length) continue;
      const key = free.length > 1 && load(HARDPOINTS[free[1]].side) < load(HARDPOINTS[free[0]].side) ? free[1] : free[0];
      map[id] = key;
      taken.add(key);
      break;
    }
  }
  p.hardpoints = map;
  p.hardpointSig = sig;
  return map;
}

// How much banking squashes (or stretches) the wing on `side` (ship-renderer.js draws the wings with it).
export function wingLean(bank, side) {
  const lean = Math.max(-1, Math.min(1, bank || 0)) * side;
  return 1 - (lean > 0 ? 0.26 : -0.06) * Math.abs(lean);
}

// Hull-space position of a weapon's mount (px), or null for weapons with no single mount (drills, rim,
// hub). Rocket Pods return the port pod unless `side` is 1.
export function mountLocal(p, id, out = {}, side = -1) {
  const m = MOUNTS[id];
  const r = p.radius || 15;
  if (!m) return null;
  if (m.builtin === 'turret') { out.x = 0; out.y = 0; return out; }
  if (m.builtin === 'wingtips') { out.x = WINGTIP.x * r; out.y = side * WINGTIP.y * r; return out; }
  if (m.builtin) return null;
  const hp = HARDPOINTS[hardpointLayout(p)[id]];
  if (!hp) return null;
  out.x = hp.x * r;
  out.y = hp.y * r;
  return out;
}

// World position a weapon launches from: its mount, or the ship centre when it has no mount or (with a
// game) the mount sits inside a rock face, where a shot would die unseen (the Rocket Pods' guard).
const scratch = {};
export function mountWorld(p, id, out = {}, game = null) {
  out.x = p.x;
  out.y = p.y;
  const local = mountLocal(p, id, scratch);
  if (!local) return out;
  const a = p.hullAngle ?? p.drillAngle ?? p.angle ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  const wx = p.x + local.x * c - local.y * s;
  const wy = p.y + local.x * s + local.y * c;
  if (game?.rockOnSegment?.(p.x, p.y, wx, wy, 4.5)) return out;
  out.x = wx;
  out.y = wy;
  return out;
}

// ---- Feel ----

const FLASH_DECAY = 12;  // /s: about 0.08 s of muzzle bloom
const RECOIL_DECAY = 8;  // /s: about 0.12 s to spring back
const HEAT_DECAY = 1.6;  // /s: about 0.6 s of glow
const HEAT_PER_SHOT = 0.35;
const SWIVEL_HOLD = 0.6; // s a swivel part holds its last aim before drifting home

function fxOf(p, id) {
  const all = (p.mountFx ||= {});
  return (all[id] ||= { flash: 0, recoil: 0, heat: 0, aim: 0, aimTo: 0, hold: 0, charge: -1, spin: 0, count: 0, swivel: 0 });
}

// One shot, lob or deploy from a weapon's mount: bloom, recoil and heat. `worldAngle` (optional) turns a
// swivel part toward what it launched at.
export function kickMount(p, id, worldAngle = null, amount = 1) {
  if (!p) return;
  const fx = fxOf(p, id);
  fx.flash = Math.max(fx.flash, amount);
  fx.recoil = Math.max(fx.recoil, amount);
  fx.heat = Math.min(1, fx.heat + HEAT_PER_SHOT * amount);
  if (worldAngle != null && MOUNTS[id]?.swivel) {
    const heading = p.hullAngle ?? p.drillAngle ?? p.angle ?? 0;
    fx.aimTo = Math.atan2(Math.sin(worldAngle - heading), Math.cos(worldAngle - heading));
    fx.aim = fx.aimTo; // snap to the target as it fires, so the kick reads along the shot
    fx.hold = SWIVEL_HOLD;
  }
}

// Steady state written by a weapon each tick: charge 0..1 (rail, shock dish, turret bank, glaive), or
// for sprayers the nozzle swivel (world radians), nozzle count and heat while spraying.
export function setMountCharge(p, id, charge) {
  if (p) fxOf(p, id).charge = charge;
}
export function setMountSpray(p, id, swivel, count, spraying) {
  if (!p) return;
  const fx = fxOf(p, id);
  fx.swivel = swivel;
  fx.count = count;
  if (spraying) fx.heat = Math.max(fx.heat, 0.75);
}

export function updateMounts(p, dt) {
  const all = p.mountFx;
  if (!all || dt <= 0) return;
  for (const id in all) {
    const fx = all[id];
    fx.flash = Math.max(0, fx.flash - dt * FLASH_DECAY);
    fx.recoil = Math.max(0, fx.recoil - dt * RECOIL_DECAY);
    fx.heat = Math.max(0, fx.heat - dt * HEAT_DECAY);
    fx.spin += dt * (2 + fx.heat * 10 + (fx.charge > 0.9 ? 6 : 0));
    if (fx.hold > 0) fx.hold -= dt;
    else fx.aimTo = 0;
    const d = Math.atan2(Math.sin(fx.aimTo - fx.aim), Math.cos(fx.aimTo - fx.aim));
    fx.aim += d * Math.min(1, dt * (fx.hold > 0 ? 30 : 4));
  }
}

// ---- Parts (drawn pointing +x, in px at a 15 px hull, around the mount) ----

const DARK = '#051024';
const PART_SCALE = 1.25; // parts sized to read through the frame's bloom at gameplay zoom
const PARTS = {
  // Rocket Pods: a two-tube pod.
  pod(ctx) {
    ctx.beginPath();
    ctx.rect(-3, -3, 7, 6);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-1, -1.3); ctx.lineTo(5.5, -1.3);
    ctx.moveTo(-1, 1.3); ctx.lineTo(5.5, 1.3);
    ctx.stroke();
  },
  coil(ctx) {
    ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 0.7, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  },
  lens(ctx) {
    ctx.beginPath(); ctx.ellipse(0.5, 0, 2.6, 3.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2.6, -2); ctx.lineTo(-2.6, 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0.8, 0, 1, 0, Math.PI * 2); ctx.stroke();
  },
  mortar(ctx) {
    ctx.beginPath(); ctx.arc(-1, 0, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(0, -2.2, 5, 4.4); ctx.fill(); ctx.stroke();
  },
  chute(ctx, v) {
    ctx.beginPath();
    ctx.moveTo(-3.6, -3); ctx.lineTo(2.6, -3); ctx.lineTo(3.4, 0); ctx.lineTo(2.6, 3); ctx.lineTo(-3.6, 3);
    ctx.fill(); ctx.stroke();
    if (v) { ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
  },
  vents(ctx) {
    ctx.beginPath(); ctx.rect(-3, -3.4, 5.4, 6.8); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (const y of [-1.8, 0, 1.8]) { ctx.moveTo(1.2, y); ctx.lineTo(-2, y); }
    ctx.stroke();
  },
  launcher(ctx) {
    ctx.beginPath(); ctx.rect(0, -1.6, 5.6, 3.2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 2.7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },
  disc(ctx) {
    ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      ctx.moveTo(Math.cos(a) * 1, Math.sin(a) * 1);
      ctx.lineTo(Math.cos(a + 0.5) * 3.2, Math.sin(a + 0.5) * 3.2);
    }
    ctx.stroke();
  },
  // Sentry cradle: a diamond with a pip per quarter of the charge bank (variant 0..4).
  cradle(ctx, v) {
    ctx.beginPath(); ctx.moveTo(3.6, 0); ctx.lineTo(0, -3.6); ctx.lineTo(-3.6, 0); ctx.lineTo(0, 3.6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    const pips = [[1.3, 0], [0, -1.3], [-1.3, 0], [0, 1.3]];
    for (let k = 0; k < v; k++) { ctx.beginPath(); ctx.arc(pips[k][0], pips[k][1], 0.7, 0, Math.PI * 2); ctx.fill(); }
  },
  dish(ctx) {
    ctx.beginPath(); ctx.arc(-1.2, 0, 3.6, -1.2, 1.2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1.2, 0); ctx.lineTo(3, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(3, 0, 0.9, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  },
  rack(ctx) {
    ctx.beginPath(); ctx.rect(-3.2, -3.2, 6.4, 6.4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    for (const [x, y] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
      ctx.beginPath(); ctx.arc(x, y, 0.75, 0, Math.PI * 2); ctx.fill();
    }
  },
  bay(ctx) {
    ctx.beginPath(); ctx.rect(-3.4, -2.8, 6.8, 5.6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3.4, 0); ctx.lineTo(3.4, 0); ctx.moveTo(2, -2.8); ctx.lineTo(2, 2.8); ctx.stroke();
  },
  hive(ctx) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 3.5, Math.sin(a) * 3.5);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); ctx.stroke();
  },
  // Sprayer nozzle head on the rim: a flared cone pointing outward.
  nozzle(ctx) {
    ctx.beginPath(); ctx.moveTo(-2.4, -1.5); ctx.lineTo(3, -2.6); ctx.lineTo(3, 2.6); ctx.lineTo(-2.4, 1.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
};
export const PART_KEYS = Object.keys(PARTS);

const SPRITE_PX = 18; // sprite box (px at a 15 px hull), centred on the mount
const MAX_SPRITES = 160;
const sprites = new Map();
let glowCache = new Map();
const makeCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null);

function renderScale(ctx) {
  const t = ctx.getTransform?.();
  const s = t ? Math.hypot(t.a, t.b) : 1;
  return Math.max(0.5, Math.min(6, Math.ceil(s * 2) / 2));
}

// Solid weapon-colour body with dark detail lines: at 6-9 px a filled shape reads through the hull's
// glow where an outline is lost.
function strokePart(ctx, part, color, v) {
  ctx.fillStyle = color;
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  PARTS[part](ctx, v);
}

// Cached sprite of a part, or null where there is no canvas (headless tests).
function partSprite(part, color, v, rs) {
  const key = `${part}|${color}|${v}|${rs}`;
  let s = sprites.get(key);
  if (s !== undefined) return s;
  if (sprites.size >= MAX_SPRITES) sprites.clear();
  s = null;
  const canvas = makeCanvas();
  const c = canvas?.getContext?.('2d');
  if (c) {
    canvas.width = canvas.height = Math.ceil(SPRITE_PX * rs);
    c.setTransform(rs, 0, 0, rs, (SPRITE_PX * rs) / 2, (SPRITE_PX * rs) / 2);
    strokePart(c, part, color, v);
    s = canvas;
  }
  sprites.set(key, s);
  return s;
}

// Soft round glow in a colour (radius 1 world px per unit, drawn scaled), cached once per colour.
function glowSprite(color) {
  let s = glowCache.get(color);
  if (s !== undefined) return s;
  if (glowCache.size > 48) glowCache = new Map();
  s = null;
  const canvas = makeCanvas();
  const c = canvas?.getContext?.('2d');
  if (c) {
    canvas.width = canvas.height = 64;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    s = canvas;
  }
  glowCache.set(color, s);
  return s;
}

function drawGlow(ctx, color, x, y, radius, alpha) {
  if (alpha <= 0.01) return;
  const g = glowSprite(color);
  if (!g) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.drawImage(g, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

// One part at hull-space (x, y), turned `angle`, scaled for the hull size, with its recoil, heat and
// bloom. `tip` is how far ahead of the mount the muzzle sits (px at a 15 px hull).
export function drawPart(ctx, part, color, x, y, angle, scale, fx, v = 0, tip = 4) {
  const calm = isReduceEffects();
  const rec = fx ? fx.recoil * fx.recoil * (calm ? 1 : 2) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.translate(-rec, 0);
  const heat = fx ? Math.min(calm ? 0.35 : 1, fx.heat) : 0;
  if (heat > 0.02) drawGlow(ctx, color, 0, 0, 6 + heat * 3, heat * 0.55);
  const rs = renderScale(ctx);
  const sprite = partSprite(part, color, v, rs);
  if (sprite) ctx.drawImage(sprite, -SPRITE_PX / 2, -SPRITE_PX / 2, SPRITE_PX, SPRITE_PX);
  else strokePart(ctx, part, color, v);
  if (fx && fx.flash > 0.02 && !calm) drawGlow(ctx, '#ffffff', tip, 0, 4 + fx.flash * 5, fx.flash * 0.9);
  ctx.restore();
}

const colorOf = (id) => MOUNTS[id]?.color || '#ffffff';

// Owned weapons in slot order (loadout.js ownedWeapons, without its config import): fixtures built
// without a loadout own the Autocannon plus every weapon with a level.
export function ownedWeapons(p) {
  if (Array.isArray(p.loadout)) return p.loadout;
  return Object.keys(MOUNTS).filter((id) => id === 'blaster' || (p.weapons?.[id] || 0) > 0);
}

// Variant of a part from its charge (chute loaded, cradle pips); 0 for parts without one.
function variantOf(part, fx) {
  if (part === 'chute') return !fx || fx.recoil < 0.15 ? 1 : 0;
  if (part === 'cradle') return fx && fx.charge >= 0 ? Math.round(Math.min(1, fx.charge) * 4) : 4;
  return 0;
}

// Hardpoint parts, rocket pods and sprayer nozzles, drawn in the hull frame (ship-renderer.js calls
// this after the carapace, before the drills and turret). `bank` squashes the wing parts with the wings.
export function drawHardpoints(ctx, p, bank, now = 0) {
  const owned = ownedWeapons(p);
  const r = p.radius || 15;
  const scale = (r / 15) * PART_SCALE;
  const all = p.mountFx || {};
  const layout = hardpointLayout(p);
  const heading = p.hullAngle ?? p.drillAngle ?? p.angle ?? 0;
  // The game draws the ship in its additive layer; parts are solid hardware, so they draw opaque (their
  // heat and bloom sprites still add light on top).
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const id of owned) {
    const m = MOUNTS[id];
    if (!m) continue;
    const fx = all[id];
    const color = colorOf(id);
    if (m.builtin === 'wingtips') {
      for (const side of [-1, 1]) drawPart(ctx, 'pod', color, WINGTIP.x * r, side * WINGTIP.y * r * wingLean(bank, side), 0, scale, fx, 0, 5.5);
    } else if (m.builtin === 'rim') {
      const n = Math.max(1, fx?.count || 1);
      const base = (fx ? fx.swivel : 0) - heading;
      for (let k = 0; k < n; k++) {
        const a = base + (k * Math.PI * 2) / n;
        drawPart(ctx, 'nozzle', color, Math.cos(a) * r * RIM, Math.sin(a) * r * RIM, a, scale, fx, 0, 3);
      }
    } else if (m.type) {
      const hp = HARDPOINTS[layout[id]];
      if (!hp) continue;
      const y = hp.y * r * (hp.side ? wingLean(bank, hp.side) : 1);
      let angle = m.swivel && fx ? fx.aim : 0;
      if (m.part === 'disc') angle = fx ? fx.spin : now * 0.002;
      if (m.part === 'vents') angle = Math.PI; // gas vents face aft
      drawPart(ctx, m.part, color, hp.x * r, y, angle, scale, fx, variantOf(m.part, fx));
      // Shock Field dish and Tesla coil glow with their charge.
      if (fx && fx.charge > 0 && (m.part === 'dish' || m.part === 'coil')) {
        drawGlow(ctx, color, hp.x * r, y, 5 * scale, fx.charge * fx.charge * (isReduceEffects() ? 0.2 : 0.4));
      }
    }
  }
  ctx.restore();
}

// Orbit Blades hub: a toothed ring under the turret that turns with the blades (drawn in the aim frame).
export function drawOrbitHub(ctx, p, now = 0) {
  if (!ownedWeapons(p).includes('orbitals')) return;
  const r = p.radius || 15;
  const spin = now * 0.004;
  ctx.save();
  ctx.strokeStyle = colorOf('orbitals');
  ctx.lineWidth = 1.2;
  ctx.globalAlpha *= 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  for (let k = 0; k < 3; k++) {
    const a = spin + (k * Math.PI * 2) / 3;
    ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    ctx.lineTo(Math.cos(a + 0.35) * r * 0.72, Math.sin(a + 0.35) * r * 0.72);
  }
  ctx.stroke();
  ctx.restore();
}

// Rail Lance rail on the turret (aim frame): a long rail between the barrels that brightens with charge.
export function drawRail(ctx, p) {
  if (!ownedWeapons(p).includes('raillance')) return;
  const r = p.radius || 15;
  const fx = p.mountFx?.raillance;
  const charge = Math.max(0, fx?.charge ?? 0);
  const rec = fx ? fx.recoil * fx.recoil * (isReduceEffects() ? 1.5 : 3) : 0;
  const color = colorOf('raillance');
  const len = r * 1.15 - rec;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; // solid rail over the additive ship layer
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(-r * 0.2, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.strokeStyle = charge > 0.5 || (fx && fx.flash > 0.3) ? '#ffffff' : DARK;
  ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len - 1, 0); ctx.stroke();
  if (charge > 0.05) drawGlow(ctx, color, len, 0, 3 + charge * 5, charge * (isReduceEffects() ? 0.3 : 0.75));
  if (fx && fx.flash > 0.02 && !isReduceEffects()) drawGlow(ctx, '#ffffff', len, 0, 5 + fx.flash * 6, fx.flash);
  ctx.restore();
}

// Autocannon heat and bloom at the barrel tips (aim frame).
export function drawBarrelFx(ctx, p) {
  const fx = p.mountFx?.blaster;
  if (!fx) return;
  const r = p.radius || 15;
  const color = colorOf('blaster');
  const calm = isReduceEffects();
  for (const y of [-3.5, 3.5]) {
    if (fx.heat > 0.02) drawGlow(ctx, color, r * 0.8, y, 3 + fx.heat * 2, Math.min(calm ? 0.3 : 1, fx.heat) * 0.5);
    if (fx.flash > 0.02 && !calm) drawGlow(ctx, '#ffffff', r * 0.95, y, 3 + fx.flash * 4, fx.flash * 0.8);
  }
}
