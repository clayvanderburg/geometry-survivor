// Status effects of the four elements, on the Deep Rock Galactic: Survivor stack model. Every hit of an
// element weapon adds STACKS of its status (more for bigger hits, more at higher element ranks and with
// Status Potency). Every W.statusTick (0.5 s) each afflicted enemy ticks: its stacks act, then a fifth of
// them wear off (W.statusDecay); below W.statusMinStacks they are gone.
//
//   BURN (FIRE)        the big DoT: stacks x burn per stack each tick. Burning enemies may set the
//                      nearest enemy beside them alight with half their stacks.
//   COLD (FROST)       no damage: the target slows as cold builds toward its freeze threshold (cold
//                      worth a share of its max HP), and each tick may FREEZE it solid (certain at the
//                      threshold). Frozen enemies stop, can't attack and take extra damage.
//   CORRODE (CORROSIVE) a light DoT, and every stack makes the target take more damage from every
//                      source (DoTs included), up to the weapon rank's cap.
//   SHOCK              every hit is a quick zap stun (sometimes a long stun). Shock stacks only hurt
//                      while the target touches another enemy: then it takes its shock DoT and CONDUCTS
//                      part of its stacks into the enemies it touches, zapping them too (vortex balls
//                      light up end to end). Shocked enemies are easier to crit.
//
// Each element-capable weapon carries at most one element (weapon-levels.js ELEMENT_CARDS); its hits
// apply that element at the element's rank. Statuses live on the enemy (`e.st`, allocated once on first
// application). Game.hitEnemy applies them on hit and scales incoming damage by damageTakenMult;
// updateStatusEffects runs timers every fixed 60 Hz step and the stack ticks every half second;
// EnemyManager.update holds stunned and frozen enemies still. Every number comes from weapon-scaling.js,
// so upgrade card previews stay exact.
import {
  WEAPON_SCALING as W, TAG_INFO, SOURCE_WEAPON, stacksForHit, statusDecay, dotPerStack, burnSpreadChance, chillSlow,
  freezeThreshold, freezeDuration, corrodeVulnPerStack, corrodeCap, shockConductShare, shockStun, shockLongStun,
  shockLongChance, stunResist, stunImmunity
} from './weapon-scaling.js';
import { ELEMENT_KEYS, FIXED_ELEMENTS, weaponElement } from './weapon-levels.js';

export const STATUS_COLORS = { burn: TAG_INFO.burn.color, chill: TAG_INFO.chill.color, corrode: TAG_INFO.corrode.color, shock: TAG_INFO.shock.color };

// Damage-over-time sources: they never crit and never re-apply statuses.
export const DOT_SOURCES = { burn: true, corrode: true, shock: true, frost: true };

// DoT ticks are credited to the weapon that applied the stacks (run-stats.js SUB_SOURCES):
// burn_<weapon>, corrode_<weapon>, shock_<weapon>, frost_<weapon>.
const STATUS_WEAPONS = [...Object.keys(ELEMENT_KEYS), ...Object.keys(FIXED_ELEMENTS)];
export const BURN_STATS = Object.fromEntries(STATUS_WEAPONS.map((id) => [id, `burn_${id}`]));
export const CORRODE_STATS = Object.fromEntries(STATUS_WEAPONS.map((id) => [id, `corrode_${id}`]));
export const SHOCK_STATS = Object.fromEntries(STATUS_WEAPONS.map((id) => [id, `shock_${id}`]));
export const FROST_STATS = Object.fromEntries(STATUS_WEAPONS.map((id) => [id, `frost_${id}`]));

// Embers, sparks and conduction arcs are capped per frame so an afflicted 200-enemy swarm stays cheap.
const MAX_EMBERS_PER_TICK = 4;
const MAX_SPARKS_PER_TICK = 3;
const MAX_ARCS = 48;
const ARC_LIFE = 0.18;
const TICK_EPSILON = 1e-6;

export function statusState(e) {
  return stateOf(e);
}

function stateOf(e) {
  return e.st || (e.st = {
    tickT: 0, stamp: -1,
    burn: 0, burnStat: 'burn',
    cold: 0, coldMax: 1, coldRank: 0, slow: 0, frozenT: 0, frozenMax: 0, freezeImmT: 0,
    corrode: 0, corrodeCap: 0, corrodeStat: 'corrode',
    shock: 0, shockRank: 0, shockStat: 'shock',
    stunT: 0, stunMax: 0, stunLong: false, stunImmT: 0
  });
}

// Anything flagged invulnerable shrugs statuses off (vortexes are ordinary, killable enemies).
export const statusImmune = (e) => !!e.invulnerable;

const hasStacks = (s) => s.burn > 0 || s.cold > 0 || s.corrode > 0 || s.shock > 0;

export function isAfflicted(e) {
  const s = e.st;
  return !!s && (hasStacks(s) || s.frozenT > 0 || s.stunT > 0);
}

export const isStunned = (e) => !!e.st && e.st.stunT > 0;
export const isFrozen = (e) => !!e.st && e.st.frozenT > 0;
// Stunned or frozen: the hull holds still and can't attack (EnemyManager.update).
export const isHeld = (e) => !!e.st && (e.st.stunT > 0 || e.st.frozenT > 0);

// Corroded hulls take more damage from every source (DoTs included); chilled ones a little more as cold
// builds (W.chilledDamageTaken at the freeze threshold), and frozen ones more still.
export function damageTakenMult(e) {
  const s = e.st;
  if (!s) return 1;
  let m = 1;
  if (s.corrode > 0) m += Math.min(s.corrodeCap, s.corrode * corrodeVulnPerStack());
  if (s.frozenT > 0) m *= 1 + W.frozenDamageTaken;
  else if (s.cold > 0) m *= 1 + W.chilledDamageTaken * Math.min(1, s.cold / (s.coldMax || 1));
  return m;
}

// Extra crit chance against a shocked target.
export const shockCritBonus = (e) => (e?.st && e.st.shock > 0 ? Math.min(W.shockCritCap, e.st.shock * W.shockCritPerStack) : 0);

// A target that had no stacks starts its tick clock fresh: the first tick lands one full interval later.
function wake(s) {
  if (!hasStacks(s)) s.tickT = 0;
}

export function applyBurn(p, e, lv, dmg, weapon = 'blaster') {
  const s = stateOf(e);
  wake(s);
  s.burn += stacksForHit(p, lv, dmg);
  s.burnStat = BURN_STATS[weapon] || 'burn';
}

export function applyChill(p, e, lv, dmg, weapon = 'cryospray') {
  const s = stateOf(e);
  if (s.frozenT > 0) return; // frozen solid: nothing more to build
  wake(s);
  s.cold += stacksForHit(p, lv, dmg);
  s.coldMax = freezeThreshold(p, e);
  s.coldRank = Math.max(s.coldRank, lv);
  s.coldStat = FROST_STATS[weapon] || 'frost';
  updateSlow(e, s, p);
}

export function applyCorrode(p, e, lv, dmg, weapon = 'gas') {
  const s = stateOf(e);
  wake(s);
  s.corrode += stacksForHit(p, lv, dmg);
  s.corrodeCap = Math.max(s.corrodeCap, corrodeCap(p, lv));
  s.corrodeStat = CORRODE_STATS[weapon] || 'corrode';
}

// SHOCK: stacks plus a zap. Returns whether the zap stunned.
export function applyShockStacks(p, e, lv, dmg, weapon = 'lightning') {
  const s = stateOf(e);
  wake(s);
  s.shock += stacksForHit(p, lv, dmg);
  s.shockRank = Math.max(s.shockRank, lv);
  s.shockStat = SHOCK_STATS[weapon] || 'shock';
  return applyShock(e, lv, p);
}

// The zap: stuns an enemy that is neither stunned nor stun-immune (no refresh while stunned, so a
// stream of hits can never chain stuns): a quick zap, or with shockLongChance a long stun. Bosses and
// lieutenants keep only part of the stun.
export function applyShock(e, lv, p = null) {
  const s = stateOf(e);
  if (s.stunT > 0 || s.stunImmT > 0) return false;
  const long = Math.random() < shockLongChance(p, lv);
  const t = (long ? shockLongStun(p) : shockStun(p, lv)) * stunResist(e);
  if (!(t > 0)) return false;
  s.stunT = t;
  s.stunMax = t;
  s.stunLong = long;
  return true;
}

// Slow from cold: up to the rank's chillSlow at the freeze threshold (bosses feel less of it).
function updateSlow(e, s, p) {
  if (s.frozenT > 0) return;
  const pressure = s.coldMax > 0 ? Math.min(1, s.cold / s.coldMax) : 0;
  s.slow = s.cold > 0 ? chillSlow(s.coldRank || 1, e.isBoss, p) * pressure : 0;
  e.speedScale = 1 - s.slow;
}

// Apply the element of the weapon behind `source` (Autocannon bolts and Pulsar Helix bolts share the
// Autocannon's; Storm Protocol and EMP arcs are Tesla arcs; fixed-element weapons always carry theirs).
// `dmg` is the hit's damage before crits and damage-taken modifiers: stacks follow it.
// Weapons without an element apply nothing.
export function applyOnHitStatuses(p, e, source, dmg = 0) {
  if (e.dead || statusImmune(e)) return;
  const weapon = SOURCE_WEAPON[source];
  const el = weapon && weaponElement(p, weapon);
  if (!el) return;
  const lv = el.rank;
  switch (el.element) { // one element per weapon
    case 'fire': applyBurn(p, e, lv, dmg, weapon); break;
    case 'frost': applyChill(p, e, lv, dmg, weapon); break;
    case 'corrode': applyCorrode(p, e, lv, dmg, weapon); break;
    case 'shock': applyShockStacks(p, e, lv, dmg, weapon); break;
  }
}

// ---- Ticking ---------------------------------------------------------------------------------------

// Short-lived conduction / spread arcs for drawing (world space).
const arcs = [];
function addArc(x1, y1, x2, y2, kind) {
  if (arcs.length >= MAX_ARCS) arcs.shift();
  arcs.push({ x1, y1, x2, y2, kind, t: ARC_LIFE });
}
export const statusArcs = () => arcs;
export function clearStatusArcs() {
  arcs.length = 0;
}

// Enemies near `e` (broad phase from the enemy index when the manager has one).
function neighbours(game, e, reach) {
  const m = game.enemyManager;
  return m.enemyIndex?.query ? m.enemyIndex.query(e.x, e.y, reach) : m.enemies;
}

// BURN spread: the nearest live enemy beside this one (hull gap within burnSpreadReach) that burns
// less than half as hard catches burnSpreadShare of the stacks.
function spreadFire(game, e, s) {
  let best = null;
  let bestGap = Infinity;
  for (const o of neighbours(game, e, e.radius + W.burnSpreadReach + 60)) {
    if (o === e || o.dead || statusImmune(o)) continue;
    const gap = Math.hypot(o.x - e.x, o.y - e.y) - e.radius - o.radius;
    if (gap > W.burnSpreadReach || gap >= bestGap) continue;
    if (o.st && o.st.burn >= s.burn * W.burnSpreadShare) continue;
    best = o;
    bestGap = gap;
  }
  if (!best) return;
  const t = stateOf(best);
  wake(t);
  t.burn += s.burn * W.burnSpreadShare;
  t.burnStat = s.burnStat;
  addArc(e.x, e.y, best.x, best.y, 'burn');
}

// SHOCK: enemies touching this one (hull to hull within shockTouchGap). Returns how many touch, and
// conducts into the ones carrying fewer stacks when `conduct`.
function conductShock(game, e, s, p, conduct) {
  let touching = 0;
  let passed = 0;
  const share = shockConductShare(p);
  for (const o of neighbours(game, e, e.radius + W.shockTouchGap + 60)) {
    if (o === e || o.dead) continue;
    const gap = Math.hypot(o.x - e.x, o.y - e.y) - e.radius - o.radius;
    if (gap > W.shockTouchGap) continue;
    touching++;
    if (!conduct || passed >= W.shockConductMax || statusImmune(o)) continue;
    if (o.st && o.st.shock >= s.shock * share) continue;
    const t = stateOf(o);
    wake(t);
    t.shock += s.shock * share;
    t.shockRank = Math.max(t.shockRank, s.shockRank);
    t.shockStat = s.shockStat;
    applyShock(o, s.shockRank || 1, p);
    addArc(e.x, e.y, o.x, o.y, 'shock');
    passed++;
  }
  return touching;
}

// One half-second tick of an enemy's stacks: damage, spreading, freeze rolls, then decay.
function tickStacks(game, e, s, p, keep) {
  if (!p) return; // fixtures without a player: timers only
  if (s.burn > 0) {
    game.hitEnemy(e, s.burn * dotPerStack(p, 'fire'), 'burn', 0, 0, 0.25, s.burnStat || 'burn');
    if (e.dead) return;
    if (s.burn >= W.burnSpreadMinStacks && Math.random() < burnSpreadChance(p)) spreadFire(game, e, s);
  }
  if (s.corrode > 0) {
    game.hitEnemy(e, s.corrode * dotPerStack(p, 'corrode'), 'corrode', 0, 0, 0.2, s.corrodeStat || 'corrode');
    if (e.dead) return;
  }
  if (s.cold > 0 && s.frozenT <= 0) {
    // Frostbite: a light tick while cold builds (W.frostDotPerStack), so a slowed pack still bleeds.
    game.hitEnemy(e, s.cold * dotPerStack(p, 'frost'), 'frost', 0, 0, 0.15, s.coldStat || 'frost');
    if (e.dead) return;
  }
  if (s.shock > 0) {
    const touching = conductShock(game, e, s, p, s.shock >= W.shockConductMinStacks);
    if (touching > 0) {
      game.hitEnemy(e, s.shock * dotPerStack(p, 'shock'), 'shock', 0, 0, 0.2, s.shockStat || 'shock');
      if (e.dead) return;
    }
  }
  if (s.cold > 0 && s.frozenT <= 0 && s.freezeImmT <= 0) {
    const pressure = s.coldMax > 0 ? s.cold / s.coldMax : 0;
    if (pressure >= 1 || Math.random() < W.freezeTickChance * pressure * pressure) {
      s.frozenT = s.frozenMax = freezeDuration(p, s.coldRank || 1) * stunResist(e);
      s.slow = 1;
      e.speedScale = 0;
      game.particles?.spawnExplosionSparks?.(e.x, e.y, 8, 192, 0.5, 3, 2);
      game.sound?.playFreeze?.();
      return; // the cold is spent in the freeze (cleared when it thaws)
    }
  }
  s.burn = s.burn * keep >= W.statusMinStacks ? s.burn * keep : 0;
  s.corrode = s.corrode * keep >= W.statusMinStacks ? s.corrode * keep : 0;
  s.shock = s.shock * keep >= W.statusMinStacks ? s.shock * keep : 0;
  if (s.frozenT <= 0) {
    s.cold = s.cold * keep >= W.statusMinStacks ? s.cold * keep : 0;
    updateSlow(e, s, p);
  }
  if (s.corrode <= 0) s.corrodeCap = 0;
  if (s.shock <= 0) s.shockRank = 0;
  if (s.cold <= 0) s.coldRank = 0;
}

// Timers every step; stacks tick every W.statusTick. DoT ticks go through game.hitEnemy (sources 'burn',
// 'corrode', 'shock'), which can kill and splice; a per-step stamp keeps a shifted enemy from being
// ticked twice.
export function updateStatusEffects(game, dt) {
  const enemies = game.enemyManager.enemies;
  const stamp = (game.statusStamp = (game.statusStamp || 0) + 1);
  const particles = game.particles;
  const p = game.player;
  const keep = 1 - statusDecay(p);
  let embers = 0;
  let sparks = 0;
  for (let i = arcs.length - 1; i >= 0; i--) {
    arcs[i].t -= dt;
    if (arcs[i].t <= 0) arcs.splice(i, 1);
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (i >= enemies.length) continue;
    const e = enemies[i];
    const s = e.st;
    if (!s || e.dead || s.stamp === stamp) continue;
    s.stamp = stamp;

    if (s.stunT > 0) {
      s.stunT -= dt;
      if (s.stunT <= TICK_EPSILON) {
        s.stunT = 0;
        s.stunImmT = stunImmunity(e);
      } else if (sparks < MAX_SPARKS_PER_TICK && Math.random() < 0.08) {
        sparks++;
        particles.spawnExplosionSparks?.(e.x + (Math.random() - 0.5) * e.radius * 1.6, e.y + (Math.random() - 0.5) * e.radius * 1.6, 2, 62, 0.6, 3, 1.6);
      }
    } else if (s.stunImmT > 0) {
      s.stunImmT = Math.max(0, s.stunImmT - dt);
    }
    if (s.frozenT > 0) {
      s.frozenT -= dt;
      if (s.frozenT <= TICK_EPSILON) {
        // Thaw: the cold is spent and the hull can't freeze again for a while.
        s.frozenT = 0;
        s.cold = 0;
        s.coldRank = 0;
        s.slow = 0;
        e.speedScale = 1;
        s.freezeImmT = W.freezeImmunity;
      }
    } else if (s.freezeImmT > 0) {
      s.freezeImmT = Math.max(0, s.freezeImmT - dt);
    }

    if (!hasStacks(s)) continue;
    s.tickT += dt;
    if (s.tickT >= W.statusTick - TICK_EPSILON) {
      s.tickT -= W.statusTick;
      tickStacks(game, e, s, p, keep);
      if (e.dead) continue;
    }
    if (s.burn > 0 && embers < MAX_EMBERS_PER_TICK && Math.random() < 0.06 + Math.min(0.2, s.burn * 0.002)) {
      embers++;
      particles.spawnDirectionalSparks(e.x + (Math.random() - 0.5) * e.radius, e.y - e.radius * 0.4, -Math.PI / 2, 0.7, 1, 16, 2.4);
    }
  }
}

// ---- Drawing ---------------------------------------------------------------------------------------

// Cheap per-enemy hash so crackle bolts jump around a few times a second without Math.random in draw.
const crackle = (e, k, frame) => {
  const v = Math.sin((e.x * 0.013 + e.y * 0.007 + k * 12.9898 + frame * 78.233)) * 43758.5453;
  return v - Math.floor(v);
};

// How full a status reads (0..1) from its stack count: quick to show, slow to max out.
const fill = (stacks, ref) => 1 - Math.exp(-stacks / ref);

// Status overlays in batched strokes (one path per type), drawn over the enemy hulls:
// BURN a flickering broken ring whose arcs lengthen with stacks, COLD frost spikes that grow toward the
// freeze threshold (FROZEN an ice shell; the tint lives in EnemyManager.draw), CORRODE a ring gauge
// filling toward its cap, SHOCK small blue-white sparks while charged and jagged yellow arcs crackling
// round a stunned hull (long stuns crackle harder), plus the conduction / spread arcs between hulls.
export function drawStatusEffects(ctx, enemies, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
  let burning = 0, chilled = 0, frozen = 0, corroded = 0, stunned = 0, charged = 0;
  for (let i = 0; i < enemies.length; i++) {
    const s = enemies[i].st;
    if (!s) continue;
    if (s.burn > 0) burning++;
    if (s.cold > 0 && s.frozenT <= 0) chilled++;
    if (s.frozenT > 0) frozen++;
    if (s.corrode > 0) corroded++;
    if (s.stunT > 0) stunned++;
    else if (s.shock > 0) charged++;
  }
  if (!burning && !chilled && !frozen && !corroded && !stunned && !charged && !arcs.length) return;

  const visible = (e, pad) => e.x + pad >= camX && e.y + pad >= camY && e.x - pad <= camX + viewW && e.y - pad <= camY + viewH;
  ctx.save();
  // Plain source-over with butt caps: additive 'lighter' about doubled the raster cost of these
  // overlays on a fully afflicted 200-enemy swarm, and the solid neon reads the same on the dark field.
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'butt';

  if (burning) {
    ctx.strokeStyle = 'rgba(255, 110, 46, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.burn <= 0 || !visible(e, e.radius * 2)) continue;
      const r = e.radius * 1.32 + Math.sin(e.pulsePhase * 3.1) * 1.5;
      const len = 0.35 + 0.95 * fill(s.burn, 60);
      const spin = -e.pulsePhase * 0.9;
      for (let k = 0; k < 3; k++) {
        const a = spin + (k * Math.PI * 2) / 3;
        ctx.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        ctx.arc(e.x, e.y, r, a, a + len);
      }
    }
    ctx.stroke();
  }

  if (chilled) {
    ctx.strokeStyle = 'rgba(160, 238, 255, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.cold <= 0 || s.frozenT > 0 || !visible(e, e.radius * 2)) continue;
      const pressure = s.coldMax > 0 ? Math.min(1, s.cold / s.coldMax) : 0;
      const r0 = e.radius * 1.2;
      const r1 = e.radius * 1.2 + 3 + pressure * 10;
      const spin = e.rotation * 0.25;
      for (let k = 0; k < 6; k++) {
        const a = spin + (k * Math.PI) / 3;
        const c = Math.cos(a), d = Math.sin(a);
        ctx.moveTo(e.x + c * r0, e.y + d * r0);
        ctx.lineTo(e.x + c * r1, e.y + d * r1);
      }
    }
    ctx.stroke();
  }

  if (frozen) {
    // An ice shell: a pale hexagon round the hull with a faint frosted fill.
    ctx.strokeStyle = 'rgba(210, 248, 255, 0.95)';
    ctx.fillStyle = 'rgba(170, 236, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.frozenT <= 0 || !visible(e, e.radius * 2)) continue;
      const r = e.radius * 1.45 + 2;
      for (let k = 0; k <= 6; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 6;
        const x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.fill();
    ctx.stroke();
  }

  if (corroded) {
    ctx.strokeStyle = 'rgba(110, 255, 70, 0.95)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const s = e.st;
      if (!s || s.corrode <= 0 || !visible(e, e.radius * 2.2)) continue;
      // A gauge that fills clockwise from the top toward the damage-taken cap; a closed ring means capped.
      // (One arc per enemy: per-stack pips cost several times more fill on a corroded swarm.)
      const r = e.radius * 1.5 + 3;
      const a0 = -Math.PI / 2;
      const share = s.corrodeCap > 0 ? Math.min(1, (s.corrode * corrodeVulnPerStack()) / s.corrodeCap) : 0;
      const a1 = a0 + (Math.PI * 2 - 0.5) * share + 0.5 * (share >= 1 ? 1 : 0);
      ctx.moveTo(e.x + Math.cos(a0) * r, e.y + Math.sin(a0) * r);
      ctx.arc(e.x, e.y, r, a0, a1);
    }
    ctx.stroke();
  }

  if (charged || stunned) {
    ctx.lineJoin = 'miter';
    for (const held of [false, true]) {
      if (held ? !stunned : !charged) continue;
      ctx.strokeStyle = held ? 'rgba(244, 255, 82, 0.95)' : 'rgba(200, 240, 255, 0.7)';
      ctx.lineWidth = held ? 1.7 : 1.1;
      ctx.beginPath();
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const s = e.st;
        if (!s || (held ? s.stunT <= 0 : s.stunT > 0 || s.shock <= 0) || !visible(e, e.radius * 2.4)) continue;
        // Bolts re-roll ~12 times a second (from the stun clock or the pulse), so the crackle flickers in place.
        const frame = Math.floor((held ? s.stunT : e.pulsePhase) * 12);
        const bolts = held ? (s.stunLong ? 4 : 3) : 2;
        const r0 = e.radius * 0.7;
        const r1 = e.radius * (held ? 1.55 : 1.25) + 4;
        for (let k = 0; k < bolts; k++) {
          const a = (k / bolts) * Math.PI * 2 + crackle(e, k, frame) * 1.6;
          const c = Math.cos(a), d = Math.sin(a);
          // A three-segment zigzag from inside the hull out past its rim.
          const j1 = (crackle(e, k + 7, frame) - 0.5) * e.radius * 0.7;
          const j2 = (crackle(e, k + 13, frame) - 0.5) * e.radius * 0.7;
          const m1 = r0 + (r1 - r0) * 0.38, m2 = r0 + (r1 - r0) * 0.7;
          ctx.moveTo(e.x + c * r0, e.y + d * r0);
          ctx.lineTo(e.x + c * m1 - d * j1, e.y + d * m1 + c * j1);
          ctx.lineTo(e.x + c * m2 - d * j2, e.y + d * m2 + c * j2);
          ctx.lineTo(e.x + c * r1, e.y + d * r1);
        }
      }
      ctx.stroke();
    }
  }

  if (arcs.length) {
    for (const kind of ['shock', 'burn']) {
      ctx.strokeStyle = kind === 'shock' ? 'rgba(244, 255, 120, 0.9)' : 'rgba(255, 130, 50, 0.75)';
      ctx.lineWidth = kind === 'shock' ? 1.6 : 2;
      ctx.beginPath();
      for (const a of arcs) {
        if (a.kind !== kind) continue;
        // One kink halfway, offset sideways so the arc reads as a spark, not a line.
        const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
        const off = (a.t * 97) % 1 - 0.5;
        const nx = -(a.y2 - a.y1) * 0.25 * off, ny = (a.x2 - a.x1) * 0.25 * off;
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(mx + nx, my + ny);
        ctx.lineTo(a.x2, a.y2);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}
