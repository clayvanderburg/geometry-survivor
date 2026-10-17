// Lieutenants: one elite per non-boss wave. An archetype the wave already fields, rebuilt with a
// generated name/epithet, 1–2 modifiers, a silver rank aura (never the boss's gold crown), a mini
// HP bar and a modest guaranteed reward. Strength and timing live in TUNING (Enemy Variety group).
import { TUNING } from './config.js';
import { SHIELDER } from './archetypes.js';

export const LIEUTENANT_WARMUP = 1.2; // seconds of materialization telegraph before it arrives
export const LIEUTENANT_CARD_TIME = 2.6;
export const LIEUTENANT_RADIUS_MULT = 1.4;
const SCORE_MULT = 8;
const XP_MULT = 5;

export const LT_MODIFIERS = {
  armored: { label: 'ARMORED', adj: 'IRONCLAD', detail: '-40% DMG TAKEN', hue: 210 },
  hasted: { label: 'HASTED', adj: 'QUICKSILVER', detail: '+35% SPEED', hue: 55 },
  regenerating: { label: 'REGENERATING', adj: 'UNDYING', detail: 'REGEN 3% HP/s', hue: 140 },
  splitting: { label: 'SPLITTING', adj: 'MANIFOLD', detail: 'SPLITS IN 3', hue: 42 },
  shielded: { label: 'SHIELDED', adj: 'BULWARK', detail: 'FRONT SHIELD', hue: 195 }
};
const MOD_KEYS = Object.keys(LT_MODIFIERS);

const NAME_HEAD = ['KHAR', 'VEX', 'ZOR', 'NYX', 'QUA', 'THRA', 'OBE', 'MOR', 'SKA', 'IRI', 'DRA', 'VOL', 'XEN', 'CAL'];
const NAME_TAIL = ['AX', 'ION', 'UUL', 'ETH', 'IS', 'ARC', 'ON', 'YX', 'EK', 'OTH', 'RA', 'IUS'];
const TYPE_NOUN = {
  pinwheel: 'PINWHEEL', weaver: 'WEAVER', splitter: 'SPLITTER', bruiser: 'BRUISER',
  gunner: 'GUNNER', shielder: 'SHIELDER', blinker: 'BLINKER', conduit: 'CONDUIT'
};

const pick = (list, rand) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

export function lieutenantModCount(wave) {
  const cap = Math.max(1, Math.round(TUNING.lieutenantMaxMods ?? 2));
  return Math.min(cap, wave >= 7 ? 2 : 1);
}

// { type, name, epithet, mods } — pure data, so tests and the sandbox can roll one deterministically.
export function rollLieutenant(wave, types, rand = Math.random, forcedType = null) {
  const type = forcedType || pick(types, rand);
  const pool = MOD_KEYS.filter(k => !(k === 'shielded' && type === 'shielder'));
  const mods = [];
  const count = lieutenantModCount(wave);
  while (mods.length < count && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    mods.push(pool.splice(i, 1)[0]);
  }
  const name = pick(NAME_HEAD, rand) + pick(NAME_TAIL, rand);
  const epithet = `THE ${LT_MODIFIERS[mods[0]].adj} ${TYPE_NOUN[type] || type.toUpperCase()}`;
  return { type, name, epithet, mods };
}

// HP is a share of the same wave's boss (`lieutenantHpShare`, default 40%), nudged by how tough the
// base archetype is (x0.85 for skirmishers up to x1.5 for a Bruiser), so every lieutenant is a clear
// mini-boss yet always well short of a real boss.
export function lieutenantHp(archetypeHp, bossHp) {
  const heft = Math.max(0.85, Math.min(1.5, Math.sqrt(archetypeHp / (bossHp / 650 * 40))));
  return bossHp * (TUNING.lieutenantHpShare ?? 0.4) * heft;
}

// Folds the lieutenant into an archetype config (before spawn); the Enemy Variety TUNING group scales it.
export function applyLieutenant(config, lt, bossHp) {
  config.hp = config.maxHp = lieutenantHp(config.maxHp, bossHp);
  config.radius *= LIEUTENANT_RADIUS_MULT;
  config.score *= SCORE_MULT;
  config.xp = Math.max(15, config.xp * XP_MULT);
  config.isLieutenant = true;
  config.sturdy = true;
  config.contactMult = Math.max(config.contactMult || 1, 1.4);
  config.knockMult = (config.knockMult ?? 1) * 0.5;
  config.name = lt.name;
  config.epithet = lt.epithet;
  config.mods = lt.mods;
  config.volley = 3; // a gunner lieutenant fires a three-orb fan
  if (lt.mods.includes('armored')) config.armor = 0.4;
  if (lt.mods.includes('hasted')) {
    config.speed *= 1.35;
    config.speedScale = (config.speedScale || 1) * 1.35;
    config.cadence = 1 / 0.7;
  }
  if (lt.mods.includes('regenerating')) config.regen = 0.03;
  if (lt.mods.includes('splitting')) config.splits = 3;
  if (lt.mods.includes('shielded')) config.shieldArc = SHIELDER.arcHalf;
  return config;
}

export function lieutenantModLabels(e) {
  return (e.mods || []).map(k => LT_MODIFIERS[k]?.label || k.toUpperCase());
}

// Materializing lieutenant: four silver brackets close in on the point (distinct from boss hazard rings).
export function drawLieutenantTelegraph(ctx, sp) {
  const t = Math.max(0, Math.min(1, 1 - sp.timer / sp.maxTimer));
  const r = sp.config.radius * (3.2 - t * 1.9);
  const spin = t * 2.2;
  ctx.strokeStyle = `rgba(235, 240, 255, ${0.3 + t * 0.6})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) bracket(ctx, sp.x, sp.y, r, spin + (k * Math.PI) / 2);
  ctx.stroke();
  ctx.strokeStyle = `hsla(${sp.config.hue}, 100%, 65%, ${t * 0.85})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, sp.config.radius * (1.6 - t * 0.6), 0, Math.PI * 2);
  ctx.stroke();
}

// L-shaped corner bracket centred on angle `a` at radius `r`.
function bracket(ctx, x, y, r, a) {
  const arm = 0.32;
  ctx.moveTo(x + Math.cos(a - arm) * r, y + Math.sin(a - arm) * r);
  ctx.lineTo(x + Math.cos(a) * r * 1.12, y + Math.sin(a) * r * 1.12);
  ctx.lineTo(x + Math.cos(a + arm) * r, y + Math.sin(a + arm) * r);
}

// Rank aura: counter-rotating silver target brackets, three rank chevrons above, and modifier marks.
export function drawLieutenantAura(ctx, e, r) {
  const spin = e.pulsePhase * 0.18;
  ctx.strokeStyle = 'rgba(235, 240, 255, 0.85)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) bracket(ctx, e.x, e.y, r * 1.62, spin + Math.PI / 4 + (k * Math.PI) / 2);
  ctx.stroke();

  // Modifier marks: one short arc per modifier in its own color, orbiting opposite the brackets.
  const mods = e.mods || [];
  ctx.lineWidth = 3;
  for (let i = 0; i < mods.length; i++) {
    const a = -spin * 1.6 + (i * Math.PI * 2) / mods.length;
    ctx.strokeStyle = `hsla(${LT_MODIFIERS[mods[i]]?.hue ?? 0}, 100%, 66%, 0.85)`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 1.38, a, a + 0.7);
    ctx.stroke();
  }
  if (e.regen > 0 && e.sinceHit > 1.5 && e.hp < e.maxHp) {
    const k = (e.pulsePhase * 0.25) % 1;
    ctx.strokeStyle = `hsla(140, 100%, 62%, ${0.6 * (1 - k)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * (0.6 + k * 0.9), 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Mini HP bar + name, floating above the hull (bosses keep their HUD bars; lieutenants stay local).
export function drawLieutenantBar(ctx, e, r) {
  const bw = Math.max(46, r * 2.4);
  const bh = 4;
  const x = e.x - bw * 0.5;
  const y = e.y - r * 1.62 - 16;
  const pct = Math.max(0, Math.min(1, e.hp / e.maxHp));
  ctx.strokeStyle = 'rgba(235, 240, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1, y - 1, bw + 2, bh + 2);
  ctx.fillStyle = `hsl(${e.hue}, 100%, 62%)`;
  ctx.fillRect(x, y, bw * pct, bh);
  // Chevron rank pips over the bar.
  ctx.strokeStyle = 'rgba(235, 240, 255, 0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    const cx = e.x + k * 8;
    ctx.moveTo(cx - 3.5, y - 4);
    ctx.lineTo(cx, y - 7);
    ctx.lineTo(cx + 3.5, y - 4);
  }
  ctx.stroke();
  ctx.font = '800 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#e8eef8';
  ctx.fillText(e.name || '', e.x, y - 9);
}
