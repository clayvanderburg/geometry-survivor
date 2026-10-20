// Destructible Geometric Asteroid Clusters & Dedicated Crab-Claw Rotary Drilling
import { TUNING } from './config.js';
import { miningDpsFor } from './pursuit.js';

// Elite mining: a lieutenant/boss grinds the rock(s) it is pressed against on its way to the ship.
export const ELITE_GRIND_CONTACT = 6; // px of surface gap that still counts as pressed against the rock
export const ELITE_GRIND_MAX_ROCKS = 2; // rocks one elite grinds at once (the two most squarely in its way)

// Sector layout. Rocks are small and many (TUNING.rockSizeMult 0.8, ~2x the old 1.15x count at a
// similar share of the map); a cluster keeps the old footprint and packs more rocks into it.
export const CLUSTER_SPREAD = 224; // px from a cluster's centre along its main axis (before elongation)
export const CLUSTER_ROCKS_MIN = 28; // placement attempts per cluster (overlapping rocks are skipped)
export const CLUSTER_ROCKS_RANGE = 26;
export const ROCK_HP_BASE = 22; // plain rock HP = (base + radius x 1.05) x rockHpMult
export const CORE_VEIN_RADIUS = 85; // deep cores only within this distance of the cluster centre
export const CORE_VEIN_CHANCE = 0.08;
export const SHIELD_VEIN_CHANCE = 0.07;
export const REPLENISH_SHARE = 0.76; // a cluster respawns each wave while fewer rocks than this share remain

// Bedrock: unbreakable rock for level design (permanent walls and boundaries). Nothing breaks it: not the
// drill-claws, elite grinding, boss portals or blasts. It blocks ships, enemies and shots like any rock,
// elites steer round it instead of plowing through, and new clusters are never placed on it.
// A formation is one SLAB: a single big faceted shape (an outer rim, a raised bevelled top face) with a few
// rubble chunks hugging its edge. Under it, invisible overlapping collision circles (`slab` pieces) do
// the physics, so every rock system (shots, pushout, pathing, spawns) treats it as rock with no changes.
// Lay it with addBedrockWall (along a polyline) or addBedrockMonolith (one big block), then
// rebuildSpatialHash(). The generated sector is walled in by a bedrock border (TUNING.bedrockBorder) and
// gets a few small random formations: TUNING.bedrockFormations slots, each filled with
// TUNING.bedrockFormationChance.
export const BEDROCK_SIZES = Object.freeze({ thin: 26, standard: 40, massive: 58 }); // wall half-thickness, px
export const BEDROCK_RADIUS = BEDROCK_SIZES.standard;
export const BEDROCK_SPACING = 0.7; // collision circles along a wall, in half-thicknesses (the edge dips < 6% between them)
export const BEDROCK_HP = 1e9; // never drained; finite so every `hp > 0` check treats it as solid
export const BEDROCK_HUE = 268;
export const isBedrock = (rock) => !!rock?.unbreakable;

// Numeric spatial-hash key (no string building per query: ~1000 rocks are probed many times a tick).
// Unique for cell coordinates in [-1024, 3071], far beyond the arena.
const cellKey = (gx, gy) => (gx + 1024) * 4096 + (gy + 1024);

// --- Bedrock slab geometry --------------------------------------------------------------------------
const SLAB_TOP = 0.6; // the raised top face sits at about this share of the rim's distance from the spine
const SLAB_TOP_SPREAD = 0.22; // ...give or take half this, per vertex, so the bevel is uneven
const SLAB_ROUND_TURN = 0.45; // rad: outer corners sharper than this get a rounded (two-facet) rim

const newSlab = (kind) => ({ kind, outline: [], chunks: [], pieces: [], minX: 0, maxX: 0, minY: 0, maxY: 0, look: null });

// Rim vertex `r` px from (cx, cy) along unit (dx, dy), with its top-face partner and outward direction.
function facetVertex(cx, cy, dx, dy, r) {
  const top = SLAB_TOP + (Math.random() - 0.5) * SLAB_TOP_SPREAD;
  return { x: cx + dx * r, y: cy + dy * r, ix: cx + dx * r * top, iy: cy + dy * r * top, ox: dx, oy: dy };
}

// Distance of a rim vertex from the spine, as a share of the face distance: mostly a little inside the
// collision edge, now and then a notch bitten out of it or a spur jutting past it.
function rimReach() {
  const roll = Math.random();
  if (roll < 0.12) return 0.78 + Math.random() * 0.08; // notch
  if (roll < 0.24) return 1.08 + Math.random() * 0.08; // spur
  return 0.88 + Math.random() * 0.16;
}

// Breaks up every rim edge with 0-2 extra kinks (mostly bitten inward) so the edge reads hewn and
// irregular instead of evenly faceted. `scale` sets how far a kink can move (a wall's face distance).
function roughenRim(outline, scale) {
  const out = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    out.push(a);
    const roll = Math.random();
    const kinks = roll < 0.3 ? 0 : roll < 0.8 ? 1 : 2;
    const ts = Array.from({ length: kinks }, () => 0.2 + Math.random() * 0.6).sort((x, y) => x - y);
    for (const t of ts) {
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      const mix = a.ix + (b.ix - a.ix) * t;
      const miy = a.iy + (b.iy - a.iy) * t;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let px = -(b.y - a.y) / len;
      let py = (b.x - a.x) / len;
      if (px * (mx - mix) + py * (my - miy) < 0) { px = -px; py = -py; } // point it outward
      const d = scale * (Math.random() * 0.27 - 0.19);
      const k = 1 + (Math.random() - 0.5) * 0.3; // the top face kinks with it, by its own amount
      out.push({ x: mx + px * d, y: my + py * d, ix: mix + px * d * k * 0.6, iy: miy + py * d * k * 0.6, ox: px, oy: py });
    }
  }
  return out;
}

// Hairline cracks running in from the bevel across the top face: 2-3 jagged segments each.
function slabCracks(outline, count) {
  const cracks = [];
  for (let c = 0; c < count && outline.length; c++) {
    const v = outline[Math.floor(Math.random() * outline.length)];
    const bevel = Math.hypot(v.x - v.ix, v.y - v.iy);
    let a = Math.atan2(v.iy - v.y, v.ix - v.x);
    let x = v.ix;
    let y = v.iy;
    const pts = [{ x, y }];
    const segs = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < segs; k++) {
      a += (Math.random() - 0.5) * 1.2;
      const l = bevel * (0.35 + Math.random() * 0.4);
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      pts.push({ x, y });
    }
    cracks.push(pts);
  }
  return cracks;
}


function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

// Points evenly spaced along a polyline, never more than `step` apart, both ends and every corner included.
function resamplePath(points, step) {
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

// Rim of a wall: the left face along the spine, a rounded cap at the end, the right face back, a rounded
// cap at the start. Faces sit `w` px off the spine (jittered); inner corners are mitered, outer corners
// rounded, so the rim follows the collision circles' outline.
function wallOutline(points, w) {
  const spine = resamplePath(points, w * 1.7);
  if (spine.length < 2) {
    const out = [];
    for (let k = 0; k < 8; k++) out.push(facetVertex(spine[0].x, spine[0].y, Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4), w));
    return out;
  }
  const jit = () => w * rimReach();
  const dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  const left = [];
  const right = [];
  for (let i = 0; i < spine.length; i++) {
    const p = spine[i];
    const tIn = dir(spine[Math.max(0, i - 1)], spine[Math.max(1, i)]);
    const tOut = dir(spine[Math.min(spine.length - 2, i)], spine[Math.min(spine.length - 1, i + 1)]);
    const nIn = { x: -tIn.y, y: tIn.x };
    const nOut = { x: -tOut.y, y: tOut.x };
    const cross = tIn.x * tOut.y - tIn.y * tOut.x;
    const turn = Math.acos(Math.max(-1, Math.min(1, tIn.x * tOut.x + tIn.y * tOut.y)));
    let mx = nIn.x + nOut.x;
    let my = nIn.y + nOut.y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const miter = 1 / Math.max(0.5, mx * nIn.x + my * nIn.y);
    // Inner side: one mitered vertex. Outer side: one vertex per face when the corner is sharp.
    const leftInner = cross > 0;
    const sharp = turn > SLAB_ROUND_TURN;
    const side = (arr, sign, inner) => {
      if (!sharp || inner) {
        // Mitered inner corners stay close to the true corner (a notch there would leave a dead pocket).
        const r = inner && miter > 1.02 ? w * (0.94 + Math.random() * 0.1) * miter : jit();
        arr.push(facetVertex(p.x, p.y, mx * sign, my * sign, r));
      } else {
        arr.push(facetVertex(p.x, p.y, nIn.x * sign, nIn.y * sign, jit()));
        arr.push(facetVertex(p.x, p.y, mx * sign, my * sign, jit()));
        arr.push(facetVertex(p.x, p.y, nOut.x * sign, nOut.y * sign, jit()));
      }
    };
    side(left, 1, leftInner);
    side(right, -1, !leftInner);
  }
  // Caps: two facets round each end.
  const cap = (p, n, from, sweep) => {
    const out = [];
    const base = Math.atan2(n.y, n.x);
    for (let k = 1; k <= 2; k++) {
      const a = base + from + (sweep * k) / 3;
      out.push(facetVertex(p.x, p.y, Math.cos(a), Math.sin(a), jit()));
    }
    return out;
  };
  const end = spine[spine.length - 1];
  const tEnd = dir(spine[spine.length - 2], end);
  const start = spine[0];
  const tStart = dir(start, spine[1]);
  return [
    ...left,
    ...cap(end, { x: -tEnd.y, y: tEnd.x }, 0, -Math.PI),
    ...right.reverse(),
    ...cap(start, { x: -tStart.y, y: tStart.x }, Math.PI, -Math.PI)
  ];
}

function finishSlab(slab) {
  slab.cracks = slabCracks(slab.outline, Math.max(2, Math.round(slab.outline.length / 7)));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (v) => { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); };
  slab.outline.forEach(grow);
  for (const ch of slab.chunks) ch.verts.forEach(grow);
  Object.assign(slab, { minX, maxX, minY, maxY });
}

function polyPath(verts, kx, ky) {
  const path = new Path2D();
  for (let i = 0; i < verts.length; i++) {
    if (i === 0) path.moveTo(verts[i][kx], verts[i][ky]);
    else path.lineTo(verts[i][kx], verts[i][ky]);
  }
  path.closePath();
  return path;
}

// Cached Path2Ds for a slab (browser only; without Path2D the slab is traced each frame).
function slabLook(sl) {
  if (sl.look) return sl.look;
  const has = typeof Path2D !== 'undefined';
  let ridges = null;
  let cracks = null;
  if (has) {
    ridges = new Path2D();
    for (const v of sl.outline) { ridges.moveTo(v.x, v.y); ridges.lineTo(v.ix, v.iy); }
    cracks = new Path2D();
    for (const c of sl.cracks || []) c.forEach((pt, i) => (i ? cracks.lineTo(pt.x, pt.y) : cracks.moveTo(pt.x, pt.y)));
  }
  sl.look = {
    rim: has ? polyPath(sl.outline, 'x', 'y') : null,
    top: has ? polyPath(sl.outline, 'ix', 'iy') : null,
    ridges,
    cracks,
    chunks: sl.chunks.map((ch) => ({ verts: ch.verts, path: has ? polyPath(ch.verts, 'x', 'y') : null }))
  };
  return sl.look;
}

function fillOrStroke(ctx, path, verts, kx, ky, op) {
  if (!path) {
    ctx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      if (i === 0) ctx.moveTo(verts[i][kx], verts[i][ky]);
      else ctx.lineTo(verts[i][kx], verts[i][ky]);
    }
    ctx.closePath();
  }
  if (op === 'fill') path ? ctx.fill(path) : ctx.fill();
  else path ? ctx.stroke(path) : ctx.stroke();
}

// Per-rock render cache: the outline as a Path2D (browser only) and the rock's resting colors.
function rockLook(a) {
  if (a.look) return a.look;
  const bedrock = isBedrock(a);
  const isRich = a.oreType !== 'rock' && !bedrock;
  let path = null;
  let inner = null;
  if (typeof Path2D !== 'undefined') {
    path = new Path2D();
    for (let v = 0; v < a.verts.length; v++) {
      const pt = a.verts[v];
      if (v === 0) path.moveTo(pt.x, pt.y);
      else path.lineTo(pt.x, pt.y);
    }
    path.closePath();
    if (bedrock) {
      // Bedrock wears an inset facet so it reads as solid slab, not drillable rock.
      inner = new Path2D();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) inner.moveTo(pt.x * 0.58, pt.y * 0.58);
        else inner.lineTo(pt.x * 0.58, pt.y * 0.58);
      }
      inner.closePath();
    }
  }
  if (bedrock) {
    a.look = {
      isRich: false,
      bedrock: true,
      path,
      inner,
      cos: Math.cos(a.rotation),
      sin: Math.sin(a.rotation),
      fill: 'rgba(15, 11, 28, 0.97)',
      stroke: `hsla(${a.hue}, 45%, 74%, 0.95)`,
      core: `hsla(${a.hue}, 70%, 58%, 0.55)`
    };
    return a.look;
  }
  a.look = {
    isRich,
    path,
    cos: Math.cos(a.rotation),
    sin: Math.sin(a.rotation),
    fill: isRich ? `hsla(${a.hue}, 75%, 14%, 0.92)` : 'rgba(7, 13, 28, 0.92)',
    flashFill: `hsla(${a.hue}, 80%, 32%, 0.9)`,
    stroke: `hsla(${a.hue}, 100%, ${isRich ? 64 : 52}%, ${isRich ? 0.92 : 0.68})`,
    core: `hsla(${a.hue}, 100%, 78%, 0.85)`
  };
  return a.look;
}

export class AsteroidManager {
  constructor(worldWidth, worldHeight) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.asteroids = [];
    this.isDrilling = false;
    this.drillingRocks = [];
    // Elite grinding this tick: count of rock contacts and the one nearest the ship (for the sound).
    this.eliteGrinds = 0;
    this.eliteGrindX = 0;
    this.eliteGrindY = 0;
    this.cellSize = 140;
    this.spatialGrid = new Map();
  }

  generateSector(centerX, centerY) {
    this.asteroids = [];
    this.isDrilling = false;
    this.drillingRocks = [];

    // Bedrock first, so the clusters fill in round it.
    if ((TUNING.bedrockBorder ?? 1) >= 0.5) this.addBedrockBorder();
    const slots = Math.max(0, Math.round(TUNING.bedrockFormations ?? 0));
    const chance = TUNING.bedrockFormationChance ?? 1;
    for (let f = 0; f < slots; f++) {
      if (Math.random() < chance) this.spawnBedrockFormation({ x: centerX, y: centerY, radius: 600 });
    }

    const clusterCount = Math.round(TUNING.clusterCount ?? 38);
    for (let c = 0; c < clusterCount; c++) {
      let cx = 260 + Math.random() * (this.worldWidth - 520);
      let cy = 260 + Math.random() * (this.worldHeight - 520);

      if (Math.hypot(cx - centerX, cy - centerY) < 400) {
        cx += (cx < centerX ? -440 : 440);
        cy += (cy < centerY ? -440 : 440);
      }

      this.spawnCluster(cx, cy, { x: centerX, y: centerY, radius: 250 });
    }

    this.sectorRockCount = this.breakableCount();
    this.rebuildSpatialHash();
  }

  // Rocks that can be mined (everything but bedrock).
  breakableCount() {
    let n = 0;
    for (let i = 0; i < this.asteroids.length; i++) if (!this.asteroids[i].unbreakable) n++;
    return n;
  }

  // Mined-out sectors get a fresh cluster each wave while the breakable rock count is below
  // REPLENISH_SHARE of the sector's starting count (bedrock never counts: it can't be mined out).
  needsReplenish() {
    return this.breakableCount() < (this.sectorRockCount || 0) * REPLENISH_SHARE;
  }

  // One unbreakable piece. Breakable rock touching it is cleared away (no ore drops). Returns the piece.
  addBedrock(x, y, radius = BEDROCK_RADIUS) {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const r = this.asteroids[i];
      if (!r.unbreakable && Math.hypot(r.x - x, r.y - y) < r.radius + radius) this.asteroids.splice(i, 1);
    }
    const sides = 6 + Math.floor(Math.random() * 2);
    const verts = [];
    for (let s = 0; s < sides; s++) {
      const a = (s * Math.PI * 2) / sides;
      const rJitter = radius * (0.9 + Math.random() * 0.14);
      verts.push({ x: Math.cos(a) * rJitter, y: Math.sin(a) * rJitter });
    }
    const rock = {
      x,
      y,
      radius,
      sides,
      verts,
      rotation: Math.random() * Math.PI * 2,
      oreType: 'bedrock',
      unbreakable: true,
      hp: BEDROCK_HP,
      maxHp: BEDROCK_HP,
      hue: BEDROCK_HUE,
      hitFlash: 0
    };
    this.asteroids.push(rock);
    return rock;
  }

  // Collision piece of a slab: an invisible bedrock circle (the slab draws it).
  addSlabPiece(slab, x, y, radius, chunk = false) {
    const piece = this.addBedrock(x, y, radius);
    piece.slab = slab;
    if (chunk) piece.chunk = true;
    else slab.pieces.push(piece);
    return piece;
  }

  // A bedrock wall along a polyline ([{ x, y }, ...]), `width` px from its spine to each face
  // (BEDROCK_SIZES): one slab with a gapless chain of collision circles under it. Returns the slab
  // ({ outline, chunks, pieces, ... }; `pieces` is the spine chain, the chunks have their own pieces).
  addBedrockWall(points, width = BEDROCK_RADIUS) {
    const slab = newSlab('wall');
    if (!points?.length) return slab;
    // Collision spine: circles every BEDROCK_SPACING x width along the line, both ends included.
    for (const pt of resamplePath(points, width * BEDROCK_SPACING)) this.addSlabPiece(slab, pt.x, pt.y, width);
    // Visible outline: faceted faces either side of the spine, rounded at outer corners and both ends.
    slab.outline = roughenRim(wallOutline(points, width), width);
    this.backSpurs(slab, width);
    this.addSlabChunks(slab, Math.max(3, Math.round(pathLength(points) / (width * 2.2))), width);
    finishSlab(slab);
    return slab;
  }

  // One big block of bedrock, about `radius` px across from its centre. Returns the slab.
  addBedrockMonolith(x, y, radius = 90) {
    const slab = newSlab('monolith');
    // A core circle and a ring of six cover the faceted shape (each well under the field's largest rock
    // query radius, so spatial lookups stay cheap).
    this.addSlabPiece(slab, x, y, radius * 0.62);
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      this.addSlabPiece(slab, x + Math.cos(a) * radius * 0.48, y + Math.sin(a) * radius * 0.48, radius * 0.5);
    }
    const sides = 8 + Math.floor(Math.random() * 3);
    const turn = Math.random() * Math.PI * 2;
    for (let k = 0; k < sides; k++) {
      const a = turn + ((k + (Math.random() - 0.5) * 0.35) * Math.PI * 2) / sides;
      const r = radius * (0.84 + Math.random() * 0.2);
      slab.outline.push(facetVertex(x, y, Math.cos(a), Math.sin(a), r));
    }
    slab.outline = roughenRim(slab.outline, radius * 0.4);
    this.backSpurs(slab, radius * 0.4);
    this.addSlabChunks(slab, 4 + Math.floor(Math.random() * 4), radius * 0.55);
    finishSlab(slab);
    return slab;
  }

  // Spurs that jut past the collision circles get a small solid piece of their own, so the rim you see
  // is the rim you hit.
  backSpurs(slab, scale) {
    const spine = slab.pieces.slice();
    const r = scale * 0.14;
    for (const v of slab.outline) {
      let edge = Infinity;
      for (const p of spine) edge = Math.min(edge, Math.hypot(v.x - p.x, v.y - p.y) - p.radius);
      if (edge > scale * 0.05) this.addSlabPiece(slab, v.x - v.ox * r * 0.7, v.y - v.oy * r * 0.7, r, true);
    }
  }

  // Rubble chunks hugging a slab's rim: small solid shards at random outline vertices, poking out.
  addSlabChunks(slab, count, scale) {
    const rim = slab.outline;
    for (let c = 0; c < count && rim.length; c++) {
      const v = rim[Math.floor(Math.random() * rim.length)];
      // Mostly small flecks, now and then a bigger slab of rubble; shards are stretched along a random axis.
      const r = scale * (Math.random() < 0.3 ? 0.3 + Math.random() * 0.16 : 0.12 + Math.random() * 0.16);
      const x = v.x + v.ox * r * (0.3 + Math.random() * 0.5);
      const y = v.y + v.oy * r * (0.3 + Math.random() * 0.5);
      if (x < r || y < r || x > this.worldWidth - r || y > this.worldHeight - r) continue;
      const sides = 3 + Math.floor(Math.random() * 4);
      const turn = Math.random() * Math.PI * 2;
      const stretch = 1 + Math.random() * 0.7;
      const verts = [];
      for (let k = 0; k < sides; k++) {
        const a = (k * Math.PI * 2) / sides + (Math.random() - 0.5) * 0.7;
        const rr = r * (0.6 + Math.random() * 0.5);
        const lx = Math.cos(a) * rr * stretch;
        const ly = (Math.sin(a) * rr) / stretch;
        verts.push({ x: x + lx * Math.cos(turn) - ly * Math.sin(turn), y: y + lx * Math.sin(turn) + ly * Math.cos(turn) });
      }
      slab.chunks.push({ x, y, r, verts });
      this.addSlabPiece(slab, x, y, r * 0.85, true);
    }
  }

  // The arena wall: rough bedrock segments laid along all four edges, their spines on the edge so only
  // the inner half shows. Segments vary in thickness and overlap at the joins, so the wall reads as a
  // run of hewn blocks. Returns the slabs (flagged `border`).
  addBedrockBorder() {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const slabs = [];
    const edge = (x0, y0, x1, y1, nx, ny) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      let d = -40; // start past the corner, so the corners close up
      while (d < len + 40) {
        const segLen = 320 + Math.random() * 380;
        const a = d;
        const b = Math.min(len + 40, d + segLen);
        const mid = (a + b) / 2;
        const bulge = Math.random() * 14; // a slight bow inward breaks up the straight line
        const width = 36 + Math.random() * 18;
        const slab = this.addBedrockWall([
          { x: x0 + ux * a, y: y0 + uy * a },
          { x: x0 + ux * mid + nx * bulge, y: y0 + uy * mid + ny * bulge },
          { x: x0 + ux * b, y: y0 + uy * b }
        ], width);
        slab.border = true;
        slabs.push(slab);
        if (b >= len + 40) break;
        d = b - (30 + Math.random() * 30); // overlap the next block
      }
    };
    edge(0, 0, W, 0, 0, 1);
    edge(W, 0, W, H, -1, 0);
    edge(W, H, 0, H, 0, -1);
    edge(0, H, 0, 0, 1, 0);
    return slabs;
  }

  // A random bedrock formation somewhere in the arena, kept out of `avoid` ({ x, y, radius }): a short
  // wall, a bend or an arc (mostly thin or standard, now and then massive) or a small monolith. Kept
  // modest: they shape the field without walling it off. Returns the slab.
  spawnBedrockFormation(avoid = null) {
    const margin = 420;
    let cx = 0;
    let cy = 0;
    for (let tries = 0; tries < 20; tries++) {
      cx = margin + Math.random() * (this.worldWidth - margin * 2);
      cy = margin + Math.random() * (this.worldHeight - margin * 2);
      if (!avoid || Math.hypot(cx - avoid.x, cy - avoid.y) > avoid.radius + 300) break;
    }
    const kind = Math.floor(Math.random() * 4);
    if (kind === 3) return this.addBedrockMonolith(cx, cy, 50 + Math.random() * 35);
    const roll = Math.random();
    const width = roll < 0.4 ? BEDROCK_SIZES.thin : roll < 0.9 ? BEDROCK_SIZES.standard : BEDROCK_SIZES.massive;
    const angle = Math.random() * Math.PI * 2;
    const points = [];
    if (kind === 0) {
      // Straight wall
      const half = 90 + Math.random() * 120;
      points.push({ x: cx - Math.cos(angle) * half, y: cy - Math.sin(angle) * half });
      points.push({ x: cx + Math.cos(angle) * half, y: cy + Math.sin(angle) * half });
    } else if (kind === 1) {
      // Bend: two legs meeting at a corner
      const legA = 110 + Math.random() * 130;
      const legB = 110 + Math.random() * 130;
      const turn = angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI * (0.4 + Math.random() * 0.2));
      points.push({ x: cx + Math.cos(angle) * legA, y: cy + Math.sin(angle) * legA });
      points.push({ x: cx, y: cy });
      points.push({ x: cx + Math.cos(turn) * legB, y: cy + Math.sin(turn) * legB });
    } else {
      // Arc: part of a ring, open on one side
      const r = 130 + Math.random() * 100;
      const sweep = Math.PI * (0.45 + Math.random() * 0.45);
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const a = angle - sweep / 2 + (sweep * k) / steps;
        points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    const pad = width + 50;
    for (const pt of points) {
      pt.x = Math.max(pad, Math.min(this.worldWidth - pad, pt.x));
      pt.y = Math.max(pad, Math.min(this.worldHeight - pad, pt.y));
    }
    return this.addBedrockWall(points, width);
  }

  // `avoid` ({ x, y, radius }) keeps every rock clear of a point, e.g. the player.
  // A cluster's footprint is fixed (CLUSTER_SPREAD); rock size only sets how many rocks fit in it, so
  // smaller rocks (TUNING.rockSizeMult) give a denser field of more, smaller rocks rather than a smaller one.
  spawnCluster(cx, cy, avoid = null) {
    const numRocks = CLUSTER_ROCKS_MIN + Math.floor(Math.random() * CLUSTER_ROCKS_RANGE);
    const mainAngle = Math.random() * Math.PI * 2;
    const elongation = 1.2 + Math.random() * 1.4;
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const hpMult = TUNING.rockHpMult ?? 1.6;
    // Vein HP was set for the old 1.15x rocks: it shrinks with rock size so drilling time per area holds.
    const veinHp = hpMult * Math.min(1, sizeMult / 1.15);
    const goldChance = Math.max(0, TUNING.goldVeinChance ?? 0.15);
    const bedrock = this.asteroids.filter(isBedrock);
    // Behind a bedrock arena wall, rocks keep the same ship-wide gap from the wall's face.
    const wallPad = bedrock.some((r) => r.slab?.border) ? 70 : 0;

    const placed = [];
    for (let i = 0; i < numRocks; i++) {
      const spreadA = mainAngle + (Math.random() - 0.5) * 2.2;
      const dist = Math.pow(Math.random(), 0.65) * CLUSTER_SPREAD;
      const rx = cx + Math.cos(spreadA) * dist * elongation + (Math.random() - 0.5) * 45;
      const ry = cy + Math.sin(spreadA) * dist + (Math.random() - 0.5) * 45;

      const radius = (26 + Math.random() * 22) * sizeMult;
      // Leave a wall gap wide enough for the ship to pass.
      const edge = Math.max(80, radius + 60) + wallPad;
      const x = Math.max(edge, Math.min(this.worldWidth - edge, rx));
      const y = Math.max(edge, Math.min(this.worldHeight - edge, ry));
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < radius + avoid.radius) continue;

      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        const other = placed[j];
        const minDist = (radius + other.radius) * 0.68;
        if (Math.hypot(x - other.x, y - other.y) < minDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      for (let j = 0; j < bedrock.length; j++) {
        const w = bedrock[j];
        if (Math.hypot(x - w.x, y - w.y) < radius + w.radius + 4) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const distFromCore = Math.hypot(x - cx, y - cy);
      const roll = Math.random();
      let oreType = 'rock';
      let maxHp = (ROCK_HP_BASE + radius * 1.05) * hpMult;
      let hue = 205;

      // Deep cores sit near the cluster's heart; the rest roll gold, then shield, then plain rock.
      const coreBand = distFromCore < CORE_VEIN_RADIUS ? CORE_VEIN_CHANCE : 0;
      if (roll < coreBand) {
        oreType = 'core_vein';
        maxHp = 80 * veinHp;
        hue = 285;
      } else if (roll < coreBand + goldChance) {
        oreType = 'gold_vein';
        maxHp = 58 * veinHp;
        hue = 46;
      } else if (roll < coreBand + goldChance + SHIELD_VEIN_CHANCE) {
        oreType = 'shield_vein';
        maxHp = 48 * veinHp;
        hue = 155;
      }

      const sides = 6 + Math.floor(Math.random() * 3);
      const verts = [];
      for (let s = 0; s < sides; s++) {
        const a = (s * Math.PI * 2) / sides;
        const rJitter = radius * (0.82 + Math.random() * 0.32);
        verts.push({
          x: Math.cos(a) * rJitter,
          y: Math.sin(a) * rJitter
        });
      }

      const rock = {
        x,
        y,
        radius,
        sides,
        verts,
        rotation: Math.random() * Math.PI * 2,
        oreType,
        hp: maxHp,
        maxHp,
        hue,
        hitFlash: 0
      };

      placed.push(rock);
      this.asteroids.push(rock);
    }
  }

  // Blow up every rock touching a circle (a boss's portal opening): each goes through the normal shatter
  // path as if an elite broke it (ore drops, not counted as your mining). Returns how many broke.
  blastRocks(x, y, radius, onRockShattered) {
    let broken = 0;
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const rock = this.asteroids[i];
      if (rock.hp <= 0 || rock.unbreakable) continue;
      const reach = radius + rock.radius;
      if ((rock.x - x) ** 2 + (rock.y - y) ** 2 > reach * reach) continue;
      rock.hp = 0;
      rock.brokenBy = 'elite';
      this.asteroids.splice(i, 1);
      onRockShattered?.(rock);
      broken++;
    }
    if (broken) this.rebuildSpatialHash();
    return broken;
  }

  rebuildSpatialHash() {
    this.spatialGrid.clear();
    this.maxRockRadius = this.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    // Slabs to draw: the ones whose pieces are still in the field (callers may swap `asteroids` out).
    const slabs = new Set();
    for (let i = 0; i < this.asteroids.length; i++) if (this.asteroids[i].slab) slabs.add(this.asteroids[i].slab);
    this.slabs = [...slabs];
    this.bordered = this.slabs.some((sl) => sl.border); // walled in by bedrock (else the game draws a line)
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      const gx = Math.floor(a.x / this.cellSize);
      const gy = Math.floor(a.y / this.cellSize);
      const key = cellKey(gx, gy);
      let cell = this.spatialGrid.get(key);
      if (!cell) this.spatialGrid.set(key, (cell = []));
      cell.push(a);
    }
  }

  // Cell range that covers every rock whose surface is within `reach` of a point.
  cellsFor(reach) {
    return Math.ceil((reach + (this.maxRockRadius || 0)) / this.cellSize);
  }

  getNearbyAsteroids(x, y, rangeCells = 2) {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const result = [];
    for (let dx = -rangeCells; dx <= rangeCells; dx++) {
      for (let dy = -rangeCells; dy <= rangeCells; dy++) {
        const cell = this.spatialGrid.get(cellKey(gx + dx, gy + dy));
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            result.push(cell[i]);
          }
        }
      }
    }
    return result;
  }

  // Dedicated Crab-Claw Rotary Drilling & Obstacle Physics (Weapons do NOT mine rocks; only your Claws do!)
  update(dt, player, enemies, bullets, onRockShattered, particles) {
    this.isDrilling = false;
    this.drillingRocks = [];

    for (let i = 0; i < this.asteroids.length; i++) {
      if (this.asteroids[i].hitFlash > 0) {
        this.asteroids[i].hitFlash = Math.max(0, this.asteroids[i].hitFlash - dt * 6);
      }
    }

    const miningDps = player.stats.miningSpeed || 75;
    const drillReach = player.stats.miningRange || 43; // Close-quarters physical claw-drill reach!
    // Claw tips sit ~1.73 hull radii from the centre; upgraded reach can exceed the old fixed ±2 cells.
    const nearbyPlayerRocks = this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(drillReach + player.radius * 1.75)));

    // Calculate the world positions of the Crab Ship's Left & Right Front Drill Claws
    const clawHeading = player.drillAngle !== undefined ? player.drillAngle : player.angle;
    const fwdX = Math.cos(clawHeading);
    const fwdY = Math.sin(clawHeading);
    const sideX = -fwdY;
    const sideY = fwdX;

    const clawForwardOffset = player.radius * 1.45;
    const clawSpreadOffset = player.radius * 0.95;

    const leftClawX = player.x + fwdX * clawForwardOffset + sideX * clawSpreadOffset;
    const leftClawY = player.y + fwdY * clawForwardOffset + sideY * clawSpreadOffset;
    const rightClawX = player.x + fwdX * clawForwardOffset - sideX * clawSpreadOffset;
    const rightClawY = player.y + fwdY * clawForwardOffset - sideY * clawSpreadOffset;

    let destroyedAny = false;

    // 1. Check Crab Drill-Claws & Hull Engagement with Asteroids
    for (let i = 0; i < nearbyPlayerRocks.length; i++) {
      const rock = nearbyPlayerRocks[i];
      if (rock.hp <= 0) continue;

      const distLeft = Math.hypot(rock.x - leftClawX, rock.y - leftClawY) - rock.radius;
      const distRight = Math.hypot(rock.x - rightClawX, rock.y - rightClawY) - rock.radius;
      const distCenter = Math.hypot(rock.x - player.x, rock.y - player.y) - rock.radius;

      // If within the Crab Ship's front Drill-Claws (or touching hull), grind the rock! Bedrock only blocks.
      if (!rock.unbreakable && (distLeft <= drillReach || distRight <= drillReach || distCenter <= player.radius + 14)) {
        this.isDrilling = true;
        this.drillingRocks.push(rock);

        // Both claws engaging same rock deals bonus twin-drill torque!
        const dualBonus = (distLeft <= drillReach && distRight <= drillReach) ? (TUNING.dualClawBonus ?? 1.25) : 1.0;
        rock.hp -= miningDps * dualBonus * dt;
        rock.hitFlash = 0.85;

        // Spray high-velocity rock-grinding sparks off the drill claws!
        if (Math.random() < 0.75) {
          const sparkX = distLeft < distRight ? leftClawX : rightClawX;
          const sparkY = distLeft < distRight ? leftClawY : rightClawY;
          particles.spawnDirectionalSparks(
            sparkX,
            sparkY,
            clawHeading + Math.PI + (Math.random() - 0.5) * 0.8,
            1.3,
            2,
            rock.oreType !== 'rock' ? rock.hue : 42,
            8.5
          );
        }

        if (rock.hp <= 0) {
          destroyedAny = true;
        }
      }

      // Solid physical collision so you feel yourself boring through the rock face
      const dx = player.x - rock.x;
      const dy = player.y - rock.y;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = player.radius + rock.radius;
      if (dist < minDist) {
        const overlap = minDist - dist;
        player.x += (dx / dist) * overlap;
        player.y += (dy / dist) * overlap;
      }
    }
    // Pushout must not move the ship past the arena wall (same pad as Game.update).
    const playerPad = player.radius + 24;
    player.x = Math.max(playerPad, Math.min(this.worldWidth - playerPad, player.x));
    player.y = Math.max(playerPad, Math.min(this.worldHeight - playerPad, player.y));

    // 2. Bullets vs Asteroids: Weapons DO NOT mine asteroids! Asteroids act as solid cover.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const nearBullet = this.getNearbyAsteroids(b.x, b.y, this.cellsFor(b.radius));
      for (let j = 0; j < nearBullet.length; j++) {
        const rock = nearBullet[j];
        if (rock.hp <= 0) continue;
        const dx = b.x - rock.x;
        const dy = b.y - rock.y;
        const hitR = rock.radius + b.radius;
        if (dx * dx + dy * dy <= hitR * hitR) {
          particles.spawnDirectionalSparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 0.9, 2, b.hue, 4);
          bullets.splice(i, 1);
          break;
        }
      }
    }

    // 3. Enemies vs Asteroids (Enemies are blocked and funneled through your carved tunnels!)
    // Elites (lieutenants, bosses) are blocked too, but grind the rock they press into at the ship's
    // BASE drill DPS (eliteMiningDps: TUNING.miningSpeed × eliteMiningMult, no player upgrades).
    // Bosses grind at bossMiningMult × that and serpent heads at serpentMiningMult × (miningDpsFor).
    this.eliteGrinds = 0;
    let grindBest = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.leader) continue; // serpent body plates glide over rock behind their head
      const eliteDps = miningDpsFor(e);
      const grinds = eliteDps > 0;
      const contact = grinds ? ELITE_GRIND_CONTACT : 0;
      // Up to two touched rocks, ranked by how squarely they sit in the way: on the line to the ship
      // or along the hull's own heading, whichever is squarer (a coiling boss mines where it goes).
      let g0 = null, g1 = null, s0 = 0, s1 = 0;
      const toShip = grinds ? Math.hypot(player.x - e.x, player.y - e.y) || 1 : 1;
      const spd = grinds ? Math.hypot(e.vx, e.vy) : 0;
      const nearEnemy = this.getNearbyAsteroids(e.x, e.y, this.cellsFor(e.radius + contact));
      for (let j = 0; j < nearEnemy.length; j++) {
        const rock = nearEnemy[j];
        if (rock.hp <= 0) continue;
        const dx = e.x - rock.x;
        const dy = e.y - rock.y;
        const dSq = dx * dx + dy * dy;
        const minDist = e.radius + rock.radius;
        if (grinds && !rock.unbreakable) {
          const touch = minDist + contact;
          // Pressed against it, and the rock is on the ship's side of the elite (it is in the way).
          if (dSq < touch * touch && dSq > 0.01) {
            const d = Math.sqrt(dSq);
            const shipAhead = ((player.x - e.x) * -dx + (player.y - e.y) * -dy) / (toShip * d);
            const ahead = spd > 0.5 ? Math.max(shipAhead, (e.vx * -dx + e.vy * -dy) / (spd * d)) : shipAhead;
            if (ahead > s0) { g1 = g0; s1 = s0; g0 = rock; s0 = ahead; }
            else if (ahead > s1) { g1 = rock; s1 = ahead; }
          }
        }
        if (dSq < minDist * minDist && dSq > 0.01) {
          const dist = Math.sqrt(dSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          e.x += nx * overlap;
          e.y += ny * overlap;

          const dot = e.vx * nx + e.vy * ny;
          if (dot < 0) {
            e.vx -= nx * dot * 1.1;
            e.vy -= ny * dot * 1.1;
          }
        }
      }
      if (g0) {
        const grind = g1 && ELITE_GRIND_MAX_ROCKS > 1 ? 2 : 1;
        for (let k = 0; k < grind; k++) {
          const rock = k === 0 ? g0 : g1;
          if (this.grindRock(rock, e, eliteDps, dt, particles)) destroyedAny = true;
          const d = (rock.x - player.x) ** 2 + (rock.y - player.y) ** 2;
          this.eliteGrinds++;
          if (d < grindBest) {
            grindBest = d;
            this.eliteGrindX = rock.lastGrindX;
            this.eliteGrindY = rock.lastGrindY;
          }
        }
      }
      // Keep pushout inside the arena (same pad as EnemyManager's wall clamp).
      const pad = e.radius + 8;
      e.x = Math.max(pad, Math.min(this.worldWidth - pad, e.x));
      e.y = Math.max(pad, Math.min(this.worldHeight - pad, e.y));
    }

    // 4. Process Shattered Rocks
    if (destroyedAny) {
      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const rock = this.asteroids[i];
        if (rock.hp <= 0) {
          this.asteroids.splice(i, 1);
          onRockShattered(rock);
        }
      }
      this.rebuildSpatialHash();
    }
  }

  // One elite's grind on one rock for this tick: the same hp drain + hit flash (and so the same crack
  // and flash rendering) as the ship's drill, sparks/debris at the contact point scaled by the live
  // vfxIntensity (the flash also follows vfxLinger). Returns true when this grind broke the rock;
  // it is tagged `brokenBy = 'elite'` so the shatter handler can tell it from the player's drill.
  grindRock(rock, e, dps, dt, particles) {
    let nx = e.x - rock.x;
    let ny = e.y - rock.y;
    const d = Math.hypot(nx, ny) || 1;
    nx /= d;
    ny /= d;
    const cx = rock.x + nx * rock.radius;
    const cy = rock.y + ny * rock.radius;
    rock.lastGrindX = cx;
    rock.lastGrindY = cy;
    rock.hp -= dps * dt;
    rock.hitFlash = 0.85;
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 32;
    const vfx = typeof particles?.intensity === 'number' ? particles.intensity : 1;
    if (particles && Math.random() < 0.55) {
      // Sparks spray back off the face along the rock's normal, either side of the elite's hull.
      const count = Math.max(1, Math.round((1 + Math.random() * 2) * vfx));
      const out = Math.atan2(ny, nx);
      particles.spawnDirectionalSparks(cx, cy, out + (Math.random() < 0.5 ? 1 : -1) * 0.9, 1.1, count, hue, 7);
      if (Math.random() < 0.18) particles.spawnExplosionSparks(cx, cy, 1, hue, 0.6, 2.2, 3.2); // slow rock chips
      if (Math.random() < 0.12) particles.spawnFlash?.(cx, cy, 9 + e.radius * 0.15, hue, 0.12);
    }
    if (rock.hp <= 0) {
      rock.brokenBy = 'elite';
      return true;
    }
    return false;
  }

  // Rocks in view only (via the spatial grid), each drawn with one setTransform from the camera
  // transform instead of save/translate/rotate/restore, and a cached outline path and colors.
  draw(ctx, camX, camY, viewW, viewH) {
    const pad = 70;
    const minX = camX - pad;
    const maxX = camX + viewW + pad;
    const minY = camY - pad;
    const maxY = camY + viewH + pad;
    const base = ctx.getTransform ? ctx.getTransform() : null;
    const cs = this.cellSize;
    const gx0 = Math.floor(minX / cs) - 1, gx1 = Math.floor(maxX / cs) + 1;
    const gy0 = Math.floor(minY / cs) - 1, gy1 = Math.floor(maxY / cs) + 1;

    const slabs = this.slabs || [];
    for (let i = 0; i < slabs.length; i++) {
      const sl = slabs[i];
      if (sl.maxX < minX || sl.minX > maxX || sl.maxY < minY || sl.minY > maxY) continue;
      this.drawSlab(ctx, sl);
    }

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cell = this.spatialGrid.get(cellKey(gx, gy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i];
          if (a.hp <= 0 || a.slab || a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;
          this.drawRock(ctx, a, base);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (base) ctx.setTransform(base);
  }

  drawRock(ctx, a, base) {
    const look = rockLook(a);
    const { cos, sin } = look;
    if (base) {
      ctx.setTransform(
        base.a * cos + base.c * sin, base.b * cos + base.d * sin,
        base.c * cos - base.a * sin, base.d * cos - base.b * sin,
        base.a * a.x + base.c * a.y + base.e, base.b * a.x + base.d * a.y + base.f
      );
    } else {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rotation);
    }
    if (look.bedrock) {
      this.drawBedrockPiece(ctx, a, look);
      if (!base) ctx.restore();
      return;
    }
    const hpRatio = Math.max(0, a.hp / a.maxHp);
    const isRich = look.isRich;
    const flashing = a.hitFlash > 0;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = flashing ? look.flashFill : look.fill;
    let path = look.path;
    if (!path) {
      ctx.beginPath();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    }
    if (path) ctx.fill(path); else ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = flashing ? '#ffffff' : look.stroke;
    ctx.lineWidth = isRich ? 2.6 : 1.9;
    if (path) ctx.stroke(path); else ctx.stroke();

    if (isRich) {
      const rCore = a.radius * 0.42;
      ctx.strokeStyle = look.core;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(rCore, 0);
      ctx.lineTo(0, rCore);
      ctx.lineTo(-rCore, 0);
      ctx.lineTo(0, -rCore);
      ctx.closePath();
      ctx.stroke();
    }

    if (hpRatio < 0.9) {
      const crackAlpha = Math.min(1, (1 - hpRatio) * 1.25);
      ctx.strokeStyle = `hsla(${isRich ? a.hue : 42}, 100%, 82%, ${crackAlpha})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const crackCount = hpRatio < 0.45 ? 4 : 2;
      for (let c = 0; c < crackCount; c++) {
        const pt = a.verts[(c * 2) % a.verts.length];
        ctx.moveTo(0, 0);
        ctx.lineTo(pt.x * (1 - hpRatio * 0.45), pt.y * (1 - hpRatio * 0.45));
      }
      ctx.stroke();
    }
    if (!base) ctx.restore();
  }

  // A bedrock slab (world coordinates, under the camera transform): a near-black body, a raised top face
  // a shade lighter with hairline cracks, faint bevel ridges joining the two, a dim inner edge and a bright
  // pale-violet rim. Rubble chunks get the body and rim. No cracks or flashes: it never takes damage.
  drawSlab(ctx, sl) {
    const look = slabLook(sl);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(13, 9, 24, 0.98)';
    fillOrStroke(ctx, look.rim, sl.outline, 'x', 'y', 'fill');
    ctx.fillStyle = 'rgba(30, 22, 50, 0.98)';
    fillOrStroke(ctx, look.top, sl.outline, 'ix', 'iy', 'fill');
    for (const ch of look.chunks) fillOrStroke(ctx, ch.path, ch.verts, 'x', 'y', 'fill');
    // Cracks: dark hairlines cut into the top face.
    ctx.strokeStyle = 'rgba(6, 3, 12, 0.95)';
    ctx.lineWidth = 1.8;
    if (look.cracks) ctx.stroke(look.cracks);
    else {
      ctx.beginPath();
      for (const c of sl.cracks || []) c.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `hsla(${BEDROCK_HUE}, 40%, 62%, 0.22)`;
    ctx.lineWidth = 1.2;
    if (look.ridges) ctx.stroke(look.ridges);
    else {
      ctx.beginPath();
      for (const v of sl.outline) { ctx.moveTo(v.x, v.y); ctx.lineTo(v.ix, v.iy); }
      ctx.stroke();
    }
    ctx.strokeStyle = `hsla(${BEDROCK_HUE}, 55%, 64%, 0.42)`;
    ctx.lineWidth = 1.4;
    fillOrStroke(ctx, look.top, sl.outline, 'ix', 'iy', 'stroke');
    ctx.strokeStyle = `hsla(${BEDROCK_HUE}, 45%, 76%, 0.95)`;
    ctx.lineWidth = 3;
    fillOrStroke(ctx, look.rim, sl.outline, 'x', 'y', 'stroke');
    ctx.lineWidth = 2;
    for (const ch of look.chunks) fillOrStroke(ctx, ch.path, ch.verts, 'x', 'y', 'stroke');
  }

  // A lone bedrock piece (addBedrock without a slab): a near-black slab with a bright pale-violet rim
  // and an inset facet. No cracks or flashes.
  drawBedrockPiece(ctx, a, look) {
    const path = look.path;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = look.fill;
    if (!path) {
      ctx.beginPath();
      for (let v = 0; v < a.verts.length; v++) {
        const pt = a.verts[v];
        if (v === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    }
    if (path) ctx.fill(path); else ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = look.stroke;
    ctx.lineWidth = 3.2;
    if (path) ctx.stroke(path); else ctx.stroke();
    if (look.inner) {
      ctx.strokeStyle = look.core;
      ctx.lineWidth = 1.6;
      ctx.stroke(look.inner);
    }
  }
}
