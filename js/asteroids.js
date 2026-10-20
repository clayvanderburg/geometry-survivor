// Destructible Geometric Asteroid Clusters & Dedicated Crab-Claw Rotary Drilling
import { TUNING } from './config.js';
import { miningDpsFor } from './pursuit.js';

// Elite mining: a lieutenant/boss grinds the rock(s) it is pressed against on its way to the ship.
export const ELITE_GRIND_CONTACT = 6; // px of surface gap that still counts as pressed against the rock
export const ELITE_GRIND_MAX_ROCKS = 2; // rocks one elite grinds at once (the two most squarely in its way)

// Sector layout. Rocks are small and many (TUNING.rockSizeMult 0.8, ~2x the old 1.15x count at a
// similar share of the map); a cluster keeps the old footprint and packs more rocks into it.
export const ROCK_HP_BASE = 22; // plain node HP = (base + ROCK_REF radius x 1.05) x rockHpMult: every node the same
export const CORE_VEIN_RADIUS = 85; // deep cores only within this distance of the cluster centre
export const CORE_VEIN_CHANCE = 0.08;
export const SHIELD_VEIN_CHANCE = 0.07;
export const REPLENISH_SHARE = 0.76; // a cluster respawns each wave while fewer rocks than this share remain

// Rock is made of round NODES: each is a collision circle with a rough polygon outline, and overlapping
// nodes are drawn as one solid shape (draw(): every node's rim, then every body over it, then a raised
// top face), so a tight pack of nodes reads as one big rock that the claws chew apart a few nodes at a
// time (Deep Rock Galactic style).
//   * Every asteroid cluster is a MASS: small nodes packed tight into one big, irregular shape (a blob,
//     an elongated ridge or a lobed lump) in a range of sizes, with ore in short seams of nodes. Small
//     groups and single nodes (TUNING.rockDebris) are scattered between them.
//   * Mining phases: a mass is drawn solid until the claws (or an elite) bite into it. The node being
//     ground, and the neighbours of every node that breaks, come FREE: each is drawn as its own rock
//     (the classic look: its own rim and bevel) until it breaks in turn, so the mined edge crumbles
//     into loose chunks.
//   * Every node takes the same time to break (classic rock HP, whatever its size; veins their classic
//     HP). Ore odds scale with node AREA against the classic rock (ROCK_REF), so the field pays about
//     what the classic field did.
//
// Bedrock: unbreakable rock (level design, the arena wall, and the hard cores of some asteroids).
// Nothing breaks it: not the drill-claws, elite grinding, boss portals or blasts. It blocks ships,
// enemies and shots like any rock, elites steer round it instead of plowing through, and the claws
// never reach for it. It is made of nodes too:
//   addBedrock(x, y, r)            one node
//   addBedrockClump(cx, cy, size)  a random clump (a blob, a ridge or branching arms) up to `size` px out
//   addBedrockWall(points, width)  a rough wall of nodes along a polyline
//   addBedrockBorder()             the arena wall (nodes flagged `border`)
// then rebuildSpatialHash(). Each generated sector gets the border (TUNING.bedrockBorder) and
// TUNING.bedrockFormations slots of clumps, each filled with TUNING.bedrockFormationChance; a clump is
// usually wrapped in a mineable mass grown onto it (TUNING.bedrockWrapChance): the hard core of an
// asteroid, drawn over the rock round it so it shows from the start.
export const BEDROCK_RADIUS = 36; // default node radius
export const BEDROCK_HP = 1e9; // never drained; finite so every `hp > 0` check treats it as solid
export const BEDROCK_HUE = 268;
export const isBedrock = (rock) => !!rock?.unbreakable;

export const MASS_NODE_MIN = 22; // mass node radius: MIN + random RANGE, x TUNING.rockSizeMult
export const MASS_NODE_RANGE = 14;
export const MASS_REACH_MIN = 60; // px from its centre a mass grows to: MIN + random^0.8 x RANGE
export const MASS_REACH_RANGE = 125;
export const ROCK_REF = 37; // radius of the average classic rock (x rockSizeMult): HP and ore odds scale by area against it
export const SEAM_EXTRA = 1.2; // average nodes added to a vein node to make a seam (its odds are divided to match)
export const MASS_PACKING = 0.72; // packed nodes overlap: their summed area overstates the rock by about this much
export const MASS_CORE_CHANCE = 0.18; // a mass's one deep-core roll (a classic cluster averaged ~0.18 cores)
export const BORDER_GAP = 36; // px mineable rock keeps clear of the arena wall (a ship fits through)
// The raised top face, as a share of each node's outline. Solid rock and bedrock nodes overlap their
// neighbours' top faces into one continuous surface; a freed node (a loose chunk) keeps a bevel all round.
export const TOP_FACE = { freed: 0.66, mass: 0.86, bedrock: 0.8 };

// Numeric spatial-hash key (no string building per query: ~1000 rocks are probed many times a tick).
// Unique for cell coordinates in [-1024, 3071], far beyond the arena.
const cellKey = (gx, gy) => (gx + 1024) * 4096 + (gy + 1024);

// A rough node outline: `sides` vertices wandering between lo and hi x radius.
function nodeVerts(radius, sides, lo, hi) {
  const verts = [];
  for (let s = 0; s < sides; s++) {
    const a = ((s + (Math.random() - 0.5) * 0.4) * Math.PI * 2) / sides;
    const r = radius * (lo + Math.random() * (hi - lo));
    verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return verts;
}

// Accretion: grows up to `count` nodes, each budding off a random node already in the clump (the
// `pool` seeds, then the new ones), so the clump stays one connected piece. Returns the new nodes
// ({ x, y, radius }). opts:
//   radius(parent)   the new node's radius
//   cx, cy, reach    centres stay within `reach` of (cx, cy)
//   axes, axisBias   preferred growth directions (rad), taken with chance axisBias (none: any way)
//   ok(x, y, r)      extra placement check
function accrete(pool, count, opts) {
  const out = [];
  const all = pool.slice();
  if (!all.length) return out;
  for (let tries = 0; out.length < count && tries < count * 8; tries++) {
    const parent = all[Math.floor(Math.random() * all.length)];
    const axes = opts.axes;
    const a = axes?.length && Math.random() < (opts.axisBias ?? 0.7)
      ? axes[Math.floor(Math.random() * axes.length)] + (Math.random() - 0.5) * 0.9
      : Math.random() * Math.PI * 2;
    const r = opts.radius(parent);
    const d = (parent.radius + r) * (0.5 + Math.random() * 0.25);
    const x = parent.x + Math.cos(a) * d;
    const y = parent.y + Math.sin(a) * d;
    if ((x - opts.cx) ** 2 + (y - opts.cy) ** 2 > opts.reach * opts.reach) continue;
    let crowded = false;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < ((o.radius + r) * 0.42) ** 2) { crowded = true; break; }
    }
    if (crowded || (opts.ok && !opts.ok(x, y, r))) continue;
    const node = { x, y, radius: r };
    out.push(node);
    all.push(node);
  }
  return out;
}

// Where mineable rock may go near bedrock: a ship-wide gap from the arena wall; over the edge of any
// other bedrock (plastered onto it) but never buried in its middle.
function clearOfBedrock(bedrock, x, y, r) {
  for (let i = 0; i < bedrock.length; i++) {
    const b = bedrock[i];
    const d = Math.hypot(x - b.x, y - b.y);
    if (b.border ? d < r + b.radius + BORDER_GAP : d < b.radius * 0.75) return false;
  }
  return true;
}

// Per-node render cache: the outline as a Path2D (browser only) and its colors. All fills are opaque so
// overlapping nodes merge into one solid shape with no seams showing through.
function rockLook(a) {
  if (a.look) return a.look;
  const bedrock = isBedrock(a);
  const isRich = a.oreType !== 'rock' && !bedrock;
  let path = null;
  if (typeof Path2D !== 'undefined') {
    path = new Path2D();
    for (let v = 0; v < a.verts.length; v++) {
      const pt = a.verts[v];
      if (v === 0) path.moveTo(pt.x, pt.y);
      else path.lineTo(pt.x, pt.y);
    }
    path.closePath();
  }
  const topScale = bedrock ? TOP_FACE.bedrock : TOP_FACE.mass;
  const base = { path, cos: Math.cos(a.rotation), sin: Math.sin(a.rotation), isRich, bedrock, topScale };
  if (bedrock) {
    // A dark crack across the top face (local frame), so bedrock reads as weathered stone.
    const t = Math.random() * Math.PI * 2;
    const r = a.radius * topScale * 0.8;
    const crack = [{ x: Math.cos(t) * r, y: Math.sin(t) * r }];
    for (let k = 1; k <= 2; k++) crack.push({ x: crack[k - 1].x * 0.25 + (Math.random() - 0.5) * r * 0.9, y: crack[k - 1].y * 0.25 + (Math.random() - 0.5) * r * 0.9 });
    a.look = { ...base, rim: `hsl(${a.hue}, 45%, 74%)`, rimW: 6, body: 'rgb(13, 9, 24)', top: 'rgb(31, 23, 52)', flash: 'rgb(31, 23, 52)', seam: `hsla(${a.hue}, 55%, 66%, 0.14)`, crack };
    return a.look;
  }
  a.look = {
    ...base,
    rim: isRich ? `hsl(${a.hue}, 100%, 60%)` : 'hsl(205, 95%, 46%)',
    rimW: isRich ? 5 : 4.2,
    body: isRich ? `hsl(${a.hue}, 55%, 11%)` : 'rgb(8, 14, 30)',
    top: isRich ? `hsl(${a.hue}, 65%, 20%)` : 'rgb(15, 28, 54)',
    flash: `hsl(${a.hue}, 80%, 34%)`,
    seam: isRich ? `hsla(${a.hue}, 100%, 70%, 0.18)` : 'rgba(110, 170, 255, 0.07)',
    core: `hsla(${a.hue}, 100%, 78%, 0.85)`
  };
  return a.look;
}

// Points a node into its own frame (rotation, and a scale for the top face) on top of the camera
// transform `base` (or with save/translate when the context has no getTransform; call nodeEnd after).
function nodeBegin(ctx, base, a, look, s) {
  const px = a.x + (a.jx || 0), py = a.y + (a.jy || 0);
  if (base) {
    const c = look.cos * s, n = look.sin * s;
    ctx.setTransform(base.a * c + base.c * n, base.b * c + base.d * n, base.c * c - base.a * n, base.d * c - base.b * n,
      base.a * px + base.c * py + base.e, base.b * px + base.d * py + base.f);
  } else {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a.rotation);
    if (s !== 1) ctx.scale(s, s);
  }
}
const nodeEnd = (ctx, base) => { if (!base) ctx.restore(); };

// Draw groups: every cluster, mass, clump and stretch of wall is one group, drawn from a few shared
// Path2Ds in world coordinates (one outline and one top-face path per ore type) instead of node by
// node. Rocks never move, so the paths are only rebuilt when a node in the group breaks.
const newGroup = (kind) => ({ kind, nodes: [], count: -1, dirty: true, mats: null, minX: 0, maxX: 0, minY: 0, maxY: 0 });

// A node's outline in world coordinates (cached: nodes never move once placed).
function worldVerts(a) {
  if (a.wv && a.wvx === a.x && a.wvy === a.y) return a.wv;
  const c = Math.cos(a.rotation), n = Math.sin(a.rotation);
  a.wv = a.verts.map((v) => ({ x: a.x + v.x * c - v.y * n, y: a.y + v.x * n + v.y * c }));
  a.wvx = a.x;
  a.wvy = a.y;
  return a.wv;
}

function addPoly(path, pts, cx, cy, k) {
  for (let i = 0; i < pts.length; i++) {
    const x = cx + (pts[i].x - cx) * k, y = cy + (pts[i].y - cy) * k;
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  path.closePath();
}

// True when a node's edge is covered all round by others in its group: an interior node, drawn as
// flat top face with no rim or bevel (only the shape's exposed edge gets those, which also keeps the
// painted area near the rock's own area). Mining a neighbour away exposes it.
function isInterior(a, nodes) {
  const K = 10;
  for (let k = 0; k < K; k++) {
    const ang = (k * Math.PI * 2) / K;
    const px = a.x + Math.cos(ang) * a.radius * 0.98;
    const py = a.y + Math.sin(ang) * a.radius * 0.98;
    let covered = false;
    for (let j = 0; j < nodes.length; j++) {
      const o = nodes[j];
      if (o === a) continue;
      const lim = o.radius * 0.84;
      if ((o.x - px) ** 2 + (o.y - py) ** 2 < lim * lim) { covered = true; break; }
    }
    if (!covered) return false;
  }
  return true;
}

function buildGroup(g) {
  const mats = new Map();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of g.nodes) {
    if (a.freed) continue; // drawn on its own (drawFreed)
    const look = rockLook(a);
    let m = mats.get(a.oreType);
    if (!m) mats.set(a.oreType, (m = { look, ore: look.isRich, rim: null, body: null, top: new Path2D(), extra: null }));
    const wv = worldVerts(a);
    if (isInterior(a, g.nodes)) {
      addPoly(m.top, wv, a.x, a.y, 1);
    } else {
      // The rim is the outline grown by half the rim width and filled (a fill rasterizes far cheaper
      // than a wide stroke); the body fills the true outline over it.
      addPoly((m.rim ||= new Path2D()), wv, a.x, a.y, 1 + look.rimW / (2 * a.radius));
      addPoly((m.body ||= new Path2D()), wv, a.x, a.y, 1);
      addPoly(m.top, wv, a.x, a.y, look.topScale);
    }
    const c = look.cos, n = look.sin;
    const toWorld = (x, y) => ({ x: a.x + x * c - y * n, y: a.y + x * n + y * c });
    if (look.isRich) {
      const r = a.radius * 0.42;
      addPoly((m.extra ||= new Path2D()), [toWorld(r, 0), toWorld(0, r), toWorld(-r, 0), toWorld(0, -r)], a.x, a.y, 1);
    } else if (look.crack) {
      const pts = look.crack.map((p) => toWorld(p.x, p.y));
      const path = (m.extra ||= new Path2D());
      pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    }
    const reach = a.radius * 1.15 + look.rimW;
    minX = Math.min(minX, a.x - reach); maxX = Math.max(maxX, a.x + reach);
    minY = Math.min(minY, a.y - reach); maxY = Math.max(maxY, a.y + reach);
  }
  Object.assign(g, { mats: [...mats.values()], minX, maxX, minY, maxY, dirty: false });
}

function nodePath(ctx, a, look) {
  if (look.path) return look.path;
  ctx.beginPath();
  for (let v = 0; v < a.verts.length; v++) {
    const pt = a.verts[v];
    if (v === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.closePath();
  return undefined;
}

// Crack network (visual only), in the rock's local frame: 3-4 jagged branches that start where the
// drill bit in and wander across the rock, some forking. Each segment opens at a damage fraction
// (`at`, 0..1) along its branch, so the cracks visibly spread as the rock is ground down.
export function rockCracks(a, originX, originY) {
  if (a.cracks) return a.cracks;
  const r = a.radius;
  let ox = originX, oy = originY;
  const od = Math.hypot(ox, oy);
  if (!(od > 0)) { const v = a.verts[0]; ox = v.x; oy = v.y; }
  else if (od > r * 0.9) { ox *= (r * 0.9) / od; oy *= (r * 0.9) / od; }
  const segs = [];
  const inward = Math.atan2(-oy, -ox);
  const branches = 3 + (Math.random() < 0.5 ? 1 : 0);
  const walk = (x, y, heading, len, start, span, depth) => {
    const steps = 3 + Math.floor(Math.random() * 2);
    const step = len / steps;
    for (let i = 0; i < steps; i++) {
      heading += (Math.random() - 0.5) * 0.9;
      let nx = x + Math.cos(heading) * step;
      let ny = y + Math.sin(heading) * step;
      const d = Math.hypot(nx, ny);
      if (d > r * 0.92) { nx *= (r * 0.92) / d; ny *= (r * 0.92) / d; }
      const at = start + (span * (i + 1)) / steps;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, at0: start + (span * i) / steps, at, depth });
      if (depth === 0 && i === 1 && Math.random() < 0.7) {
        walk(nx, ny, heading + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.5), len * 0.5, at, Math.min(span * 0.6, 0.98 - at), 1);
      }
      x = nx; y = ny;
    }
  };
  for (let b = 0; b < branches; b++) {
    const heading = inward + ((b - (branches - 1) / 2) * 1.1) + (Math.random() - 0.5) * 0.4;
    walk(ox, oy, heading, r * (1.1 + Math.random() * 0.5), 0.04 + b * 0.05, 0.75, 0);
  }
  a.cracks = { ox, oy, segs };
  return a.cracks;
}

// World point -> the rock's local frame (where its outline and cracks live).
function toLocal(a, wx, wy) {
  const look = rockLook(a);
  const dx = wx - a.x, dy = wy - a.y;
  return { x: dx * look.cos + dy * look.sin, y: -dx * look.sin + dy * look.cos };
}

// Independent drill claws: a rock within CLAW_FRONT_ARC of the hull heading (and in reach) pulls both
// claws onto it; otherwise the port claw takes the nearest rock on the left and the starboard claw the
// nearest on the right, each swinging up to CLAW_SWING_MAX off the heading. Returns the target angle
// of each claw: [port, starboard] (the hull heading when it has nothing to bite).
export const CLAW_FRONT_ARC = 0.42; // rad either side of dead ahead (~24 deg)
export const CLAW_SWING_MAX = 2.6;  // rad each claw swings out to its own side (~150 deg)
export function clawTargets(p, rocks, reach) {
  const hull = p.hullAngle ?? p.angle ?? 0;
  let front = null, frontD = Infinity;
  const side = [null, null], sideD = [Infinity, Infinity], sideA = [hull, hull];
  for (let i = 0; i < rocks.length; i++) {
    const rock = rocks[i];
    if (rock.hp <= 0 || rock.unbreakable) continue; // the claws never reach for bedrock
    const dx = rock.x - p.x, dy = rock.y - p.y;
    const d = Math.hypot(dx, dy) - rock.radius;
    if (d > reach) continue;
    const a = Math.atan2(dy, dx);
    const rel = Math.atan2(Math.sin(a - hull), Math.cos(a - hull));
    if (Math.abs(rel) <= CLAW_FRONT_ARC) {
      if (d < frontD) { frontD = d; front = a; }
    } else if (Math.abs(rel) <= CLAW_SWING_MAX) {
      const k = rel < 0 ? 0 : 1;
      if (d < sideD[k]) { sideD[k] = d; side[k] = rock; sideA[k] = a; }
    }
  }
  return front !== null ? [front, front] : sideA;
}

// Damage stages that knock a chunk off a rock while it is ground down (fractions of max HP left).
const CHIP_STAGES = [0.66, 0.33];

// Drill/grind bookkeeping shared by the ship's claws and elites: contact point, heat, and a chunk
// breaking off at each CHIP_STAGES threshold.
function grindFx(rock, cx, cy, hue, particles) {
  rock.lastGrindX = cx;
  rock.lastGrindY = cy;
  rock.heat = Math.min(1, (rock.heat || 0) + 0.12);
  const stage = rock.chipStage || 0;
  if (stage < CHIP_STAGES.length && rock.hp > 0 && rock.hp / rock.maxHp <= CHIP_STAGES[stage]) {
    rock.chipStage = stage + 1;
    if (particles) {
      const out = Math.atan2(cy - rock.y, cx - rock.x);
      particles.spawnPolygonShatter(cx, cy, rock.radius * 0.32, 3, out, hue, 0.55);
      particles.spawnDirectionalSparks(cx, cy, out, 1.2, 5, hue, 6);
      particles.spawnFlash?.(cx, cy, rock.radius * 0.5, hue, 0.1);
    }
  }
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
    const avoid = { x: centerX, y: centerY, radius: 250 };

    // Bedrock first, so the asteroids fill in round it; most clumps get a mass grown onto them (each
    // in place of one of the sector's clusters, so the field holds as much rock and ore as before).
    let wrapped = 0;
    if ((TUNING.bedrockBorder ?? 1) >= 0.5) this.addBedrockBorder();
    const slots = Math.max(0, Math.round(TUNING.bedrockFormations ?? 0));
    const chance = TUNING.bedrockFormationChance ?? 1;
    for (let f = 0; f < slots; f++) {
      if (!(Math.random() < chance)) continue;
      const clump = this.spawnBedrockFormation({ x: centerX, y: centerY, radius: 600 });
      if (clump.length && Math.random() < (TUNING.bedrockWrapChance ?? 0.85)) {
        const cx = clump.reduce((t, n) => t + n.x, 0) / clump.length;
        const cy = clump.reduce((t, n) => t + n.y, 0) / clump.length;
        const extent = Math.max(...clump.map((n) => Math.hypot(n.x - cx, n.y - cy) + n.radius));
        this.spawnMassCluster(cx, cy, avoid, { seeds: clump, reach: extent + 40 + Math.random() * 70 });
        wrapped++;
      }
    }

    const clusterCount = Math.max(0, Math.round(TUNING.clusterCount ?? 38) - wrapped);
    for (let c = 0; c < clusterCount; c++) {
      let cx = 260 + Math.random() * (this.worldWidth - 520);
      let cy = 260 + Math.random() * (this.worldHeight - 520);

      if (Math.hypot(cx - centerX, cy - centerY) < 400) {
        cx += (cx < centerX ? -440 : 440);
        cy += (cy < centerY ? -440 : 440);
      }

      this.spawnCluster(cx, cy, avoid);
    }
    const debris = Math.max(0, Math.round(TUNING.rockDebris ?? 0));
    for (let d = 0; d < debris; d++) this.spawnDebris(avoid);

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

  // One bedrock node. Breakable rock touching it is cleared away (no ore drops). Returns the node.
  addBedrock(x, y, radius = BEDROCK_RADIUS, group = newGroup('bedrock')) {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const r = this.asteroids[i];
      if (!r.unbreakable && Math.hypot(r.x - x, r.y - y) < r.radius + radius) this.asteroids.splice(i, 1);
    }
    const sides = 7 + Math.floor(Math.random() * 3);
    const rock = {
      x,
      y,
      radius,
      sides,
      verts: nodeVerts(radius, sides, 0.82, 1.06),
      rotation: Math.random() * Math.PI * 2,
      oreType: 'bedrock',
      unbreakable: true,
      group,
      hp: BEDROCK_HP,
      maxHp: BEDROCK_HP,
      hue: BEDROCK_HUE,
      hitFlash: 0
    };
    this.asteroids.push(rock);
    return rock;
  }

  // A random clump of bedrock nodes reaching about `size` px from (cx, cy): a blob, a ridge (grown
  // along one line) or branching arms. Big nodes at the heart, smaller ones toward the tips. Returns
  // the nodes.
  addBedrockClump(cx, cy, size = 120) {
    const kind = Math.floor(Math.random() * 3);
    const a0 = Math.random() * Math.PI * 2;
    const axes = kind === 1 ? [a0, a0 + Math.PI]
      : kind === 2 ? [a0, a0 + 2.1 + Math.random() * 0.5, a0 - 2.1 - Math.random() * 0.5]
        : [];
    const rMax = Math.min(46, 18 + size * 0.16);
    const group = newGroup('bedrock');
    const nodes = [this.addBedrock(cx, cy, rMax, group)];
    const count = Math.round(3 + Math.pow(size / 22, 1.6));
    const pad = 120;
    const grown = accrete(nodes, count, {
      cx, cy, reach: size, axes, axisBias: kind === 1 ? 0.85 : 0.75,
      radius: (parent) => Math.max(14, Math.min(rMax, parent.radius * (0.72 + Math.random() * 0.4))),
      ok: (x, y, r) => x > pad + r && y > pad + r && x < this.worldWidth - pad - r && y < this.worldHeight - pad - r
    });
    for (const n of grown) nodes.push(this.addBedrock(n.x, n.y, n.radius, group));
    return nodes;
  }

  // A rough wall of bedrock nodes along a polyline ([{ x, y }, ...]), about `width` px from its spine
  // to each face: nodes of varied size, spaced to overlap, wandering a little off the line. Returns them.
  addBedrockWall(points, width = BEDROCK_RADIUS) {
    const nodes = [];
    if (!points?.length) return nodes;
    const group = newGroup('bedrock');
    nodes.push(this.addBedrock(points[0].x, points[0].y, width, group));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(len > 0)) continue;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (let d = width * 0.7; d < len; d += width * (0.6 + Math.random() * 0.2)) {
        const off = (Math.random() - 0.5) * width * 0.4;
        nodes.push(this.addBedrock(a.x + ux * d - uy * off, a.y + uy * d + ux * off, width * (0.8 + Math.random() * 0.35), group));
      }
      nodes.push(this.addBedrock(b.x, b.y, width * (0.85 + Math.random() * 0.3), group));
    }
    return nodes;
  }

  // The arena wall: bedrock nodes along all four edges, centred on or just past the edge so only their
  // inner part shows, in varied sizes with the odd bigger outcrop, so the wall reads as rough rock.
  // Returns the nodes (flagged `border`).
  addBedrockBorder() {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const nodes = [];
    const edge = (x0, y0, x1, y1, nx, ny) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      let group = newGroup('bedrock');
      let groupStart = -30;
      for (let d = -30; d < len + 30;) {
        if (d - groupStart > 560) { group = newGroup('bedrock'); groupStart = d; } // draw-culled in stretches
        const outcrop = Math.random() < 0.12;
        const r = outcrop ? 52 + Math.random() * 20 : 32 + Math.random() * 28;
        const inset = outcrop ? 8 + Math.random() * 18 : -r * 0.35 + Math.random() * 14;
        const n = this.addBedrock(x0 + ux * d + nx * inset, y0 + uy * d + ny * inset, r, group);
        n.border = true;
        nodes.push(n);
        d += r * (0.6 + Math.random() * 0.25);
      }
    };
    edge(0, 0, W, 0, 0, 1);
    edge(W, 0, W, H, -1, 0);
    edge(W, H, 0, H, 0, -1);
    edge(0, H, 0, 0, 1, 0);
    return nodes;
  }

  // A random bedrock clump somewhere in the arena, kept out of `avoid` ({ x, y, radius }), 70-200 px
  // across from its heart. Returns its nodes.
  spawnBedrockFormation(avoid = null) {
    const margin = 420;
    let cx = 0;
    let cy = 0;
    for (let tries = 0; tries < 20; tries++) {
      cx = margin + Math.random() * (this.worldWidth - margin * 2);
      cy = margin + Math.random() * (this.worldHeight - margin * 2);
      if (!avoid || Math.hypot(cx - avoid.x, cy - avoid.y) > avoid.radius + 300) break;
    }
    return this.addBedrockClump(cx, cy, 70 + Math.random() * 130);
  }

  // A mineable rock node. Every node takes the same time to break: plain rock has the classic rock's
  // HP (at ROCK_REF), veins their classic HP, whatever the node's size.
  makeRock(x, y, radius, oreType, group = newGroup('mass')) {
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const hpMult = TUNING.rockHpMult ?? 1.6;
    // Vein HP was set for the old 1.15x rocks: it shrinks with rock size so drilling time per area holds.
    const veinHp = hpMult * Math.min(1, sizeMult / 1.15);
    let maxHp = (ROCK_HP_BASE + ROCK_REF * sizeMult * 1.05) * hpMult;
    let hue = 205;
    if (oreType === 'core_vein') { maxHp = 80 * veinHp; hue = 285; }
    else if (oreType === 'gold_vein') { maxHp = 58 * veinHp; hue = 46; }
    else if (oreType === 'shield_vein') { maxHp = 48 * veinHp; hue = 155; }
    const sides = 7 + Math.floor(Math.random() * 2);
    const rock = {
      x,
      y,
      radius,
      sides,
      group,
      verts: nodeVerts(radius, sides, 0.86, 1.1),
      rotation: Math.random() * Math.PI * 2,
      oreType,
      hp: maxHp,
      maxHp,
      hue,
      hitFlash: 0
    };
    this.asteroids.push(rock);
    return rock;
  }

  // A fresh asteroid at (cx, cy) (each wave's replenish, and the sector's clusters).
  // `avoid` ({ x, y, radius }) keeps every rock clear of a point, e.g. the player.
  spawnCluster(cx, cy, avoid = null) {
    return this.spawnMassCluster(cx, cy, avoid);
  }

  // Placement check for new rock near (cx, cy) within `reach`: inside the arena with a ship-wide gap
  // from its edge, clear of `avoid`, and clear of bedrock (coating it, never buried in it).
  rockSpot(cx, cy, reach, avoid) {
    const nearBedrock = this.asteroids.filter((b) => b.unbreakable && Math.hypot(b.x - cx, b.y - cy) < reach + b.radius + BORDER_GAP + 60);
    return (x, y, r) => {
      const e = Math.max(80, r + 60);
      if (x < e || y < e || x > this.worldWidth - e || y > this.worldHeight - e) return false;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < r + avoid.radius) return false;
      return clearOfBedrock(nearBedrock, x, y, r);
    };
  }

  // An asteroid mass: small nodes accreted into one big irregular shape (a blob, an elongated ridge or
  // a lumpy, lobed rock) up to `reach` px from (cx, cy), grown from `seeds` when given (a bedrock clump
  // it wraps).
  spawnMassCluster(cx, cy, avoid = null, { seeds = null, reach = MASS_REACH_MIN + Math.pow(Math.random(), 0.8) * MASS_REACH_RANGE } = {}) {
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const kind = Math.floor(Math.random() * 3);
    const a0 = Math.random() * Math.PI * 2;
    const axes = kind === 1 ? [a0, a0 + Math.PI] : kind === 2 ? [a0, a0 + 2 + Math.random(), a0 - 2 - Math.random()] : [];
    const ok = this.rockSpot(cx, cy, reach, avoid);
    const nodeR = () => (MASS_NODE_MIN + Math.random() * MASS_NODE_RANGE) * sizeMult;
    const meanR = (MASS_NODE_MIN + MASS_NODE_RANGE / 2) * sizeMult;
    let pool = seeds;
    if (!pool?.length) {
      const r = nodeR();
      if (!ok(cx, cy, r)) return [];
      pool = [{ x: cx, y: cy, radius: r }];
    }
    const count = Math.round((Math.PI * reach * reach) / (meanR * meanR * 2.6));
    const nodes = seeds?.length ? [] : [pool[0]];
    nodes.push(...accrete(pool, count, { cx, cy, reach, axes, axisBias: kind === 0 ? 0 : 0.55, radius: nodeR, ok }));
    return this.placeNodes(nodes, cx, cy, Math.random() < MASS_CORE_CHANCE);
  }

  // Debris between the asteroids: a single node or a small group of 2-6, somewhere in the arena.
  spawnDebris(avoid = null) {
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const cx = 200 + Math.random() * (this.worldWidth - 400);
    const cy = 200 + Math.random() * (this.worldHeight - 400);
    const ok = this.rockSpot(cx, cy, 120, avoid);
    const nodeR = () => (MASS_NODE_MIN + Math.random() * MASS_NODE_RANGE) * sizeMult;
    const r = nodeR();
    if (!ok(cx, cy, r)) return [];
    const nodes = [{ x: cx, y: cy, radius: r }];
    const extra = Math.random() < 0.45 ? 0 : 1 + Math.floor(Math.random() * 5);
    if (extra) nodes.push(...accrete(nodes, extra, { cx, cy, reach: 110, radius: nodeR, ok }));
    return this.placeNodes(nodes, cx, cy, false);
  }

  // Ore for a set of nodes, then the rock nodes themselves (one draw group). Ore comes in short seams:
  // a node that rolls a vein spreads it to a neighbour or two. Odds per node scale with its area
  // (against the classic rock, less the packing overlap), divided by the seam length, so rock pays
  // about as much ore per area as the classic rocks did. `core`: one deep core at the heart.
  placeNodes(nodes, cx, cy, core) {
    const sizeMult = TUNING.rockSizeMult ?? 0.8;
    const ore = new Array(nodes.length).fill('rock');
    const ref = ROCK_REF * sizeMult;
    const goldChance = Math.max(0, TUNING.goldVeinChance ?? 0.15);
    const seam = (i, type) => {
      ore[i] = type;
      let extra = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : 0; // ~SEAM_EXTRA on average
      let last = nodes[i];
      while (extra-- > 0) {
        let best = -1, bestD = Infinity;
        for (let j = 0; j < nodes.length; j++) {
          if (ore[j] !== 'rock') continue;
          const d = Math.hypot(nodes[j].x - last.x, nodes[j].y - last.y);
          if (d < bestD) { bestD = d; best = j; }
        }
        if (best < 0 || bestD > (last.radius + nodes[best].radius) * 1.1) break;
        ore[best] = type;
        last = nodes[best];
      }
    };
    if (core && nodes.length) {
      let best = 0;
      for (let i = 1; i < nodes.length; i++) if (Math.hypot(nodes[i].x - cx, nodes[i].y - cy) < Math.hypot(nodes[best].x - cx, nodes[best].y - cy)) best = i;
      ore[best] = 'core_vein';
    }
    for (let i = 0; i < nodes.length; i++) {
      if (ore[i] !== 'rock') continue;
      const w = (nodes[i].radius / ref) ** 2 * MASS_PACKING / (1 + SEAM_EXTRA);
      const roll = Math.random();
      if (roll < goldChance * w) seam(i, 'gold_vein');
      else if (roll < (goldChance + SHIELD_VEIN_CHANCE) * w) seam(i, 'shield_vein');
    }
    const group = newGroup('mass');
    return nodes.map((n, i) => this.makeRock(n.x, n.y, n.radius, ore[i], group));
  }

  // A node comes FREE (drawn as its own rock) when it is first ground, or a neighbour breaks.
  free(rock) {
    if (rock.freed || rock.unbreakable) return;
    rock.freed = true;
    if (rock.group) rock.group.dirty = true;
  }

  // A node broke: the rock touching it comes free, so the mined edge crumbles into loose chunks.
  loosenAround(rock) {
    const near = this.getNearbyAsteroids(rock.x, rock.y, this.cellsFor(rock.radius));
    for (let i = 0; i < near.length; i++) {
      const n = near[i];
      if (n !== rock && n.hp > 0 && Math.hypot(n.x - rock.x, n.y - rock.y) < (n.radius + rock.radius) * 1.05) this.free(n);
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
      this.loosenAround(rock);
      onRockShattered?.(rock);
      broken++;
    }
    if (broken) this.rebuildSpatialHash();
    return broken;
  }

  rebuildSpatialHash() {
    this.spatialGrid.clear();
    this.maxRockRadius = this.asteroids.reduce((max, rock) => Math.max(max, rock.radius), 0);
    this.bordered = this.asteroids.some((r) => r.border); // walled in by bedrock (else the game draws a line)
    // Draw groups and their live nodes; a group whose node count changed rebuilds its paths.
    const groups = new Map();
    for (let i = 0; i < this.asteroids.length; i++) {
      const g = this.asteroids[i].group;
      if (!g) continue;
      let list = groups.get(g);
      if (!list) groups.set(g, (list = []));
      list.push(this.asteroids[i]);
    }
    for (const [g, list] of groups) {
      if (g.count !== list.length) g.dirty = true;
      g.nodes = list;
      g.count = list.length;
    }
    this.groups = [...groups.keys()];
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

  // Where each drill claw should point this tick (clawTargets over the rocks in claw reach).
  clawAims(player) {
    const reach = player.radius * 1.75 + (player.stats?.miningRange || 43);
    return clawTargets(player, this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(reach))), reach);
  }

  // Dedicated Crab-Claw Rotary Drilling & Obstacle Physics (Weapons do NOT mine rocks; only your Claws do!)
  update(dt, player, enemies, bullets, onRockShattered, particles) {
    this.isDrilling = false;
    this.drillingRocks = [];

    for (let i = 0; i < this.asteroids.length; i++) {
      if (this.asteroids[i].hitFlash > 0) {
        this.asteroids[i].hitFlash = Math.max(0, this.asteroids[i].hitFlash - dt * 6);
      }
      if (this.asteroids[i].heat > 0) this.asteroids[i].heat = Math.max(0, this.asteroids[i].heat - dt * 1.6);
    }

    const miningDps = player.stats.miningSpeed || 75;
    const drillReach = player.stats.miningRange || 43; // Close-quarters physical claw-drill reach!
    // Claw tips sit ~1.73 hull radii from the centre; upgraded reach can exceed the old fixed ±2 cells.
    const nearbyPlayerRocks = this.getNearbyAsteroids(player.x, player.y, Math.max(2, this.cellsFor(drillReach + player.radius * 1.75)));

    // World positions of the two drill claws. Each arm swings on its own heading (player.clawAngles:
    // [port claw, starboard claw], see clawTargets), else both follow the shared drillAngle.
    // "Left"/"right" here are the claws at local +y / -y of their heading (starboard / port).
    const clawHeading = player.drillAngle !== undefined ? player.drillAngle : player.angle;
    const clawForwardOffset = player.radius * 1.45;
    const clawSpreadOffset = player.radius * 0.95;
    const clawPos = (heading, side) => {
      const fx = Math.cos(heading), fy = Math.sin(heading);
      return [player.x + fx * clawForwardOffset - fy * clawSpreadOffset * side, player.y + fy * clawForwardOffset + fx * clawSpreadOffset * side];
    };
    const [leftClawX, leftClawY] = clawPos(player.clawAngles?.[1] ?? clawHeading, 1);
    const [rightClawX, rightClawY] = clawPos(player.clawAngles?.[0] ?? clawHeading, -1);

    let destroyedAny = false;

    // 1. Check Crab Drill-Claws & Hull Engagement with Asteroids. First who touches what: when the
    // claws grind two different rocks (and share none), each runs at half the twin-claw torque, so
    // two rocks at once mine the same total as both claws on one.
    const touches = [];
    let anyLeft = false, anyRight = false, shared = false;
    for (let i = 0; i < nearbyPlayerRocks.length; i++) {
      const rock = nearbyPlayerRocks[i];
      if (rock.hp <= 0) continue;
      const distLeft = Math.hypot(rock.x - leftClawX, rock.y - leftClawY) - rock.radius;
      const distRight = Math.hypot(rock.x - rightClawX, rock.y - rightClawY) - rock.radius;
      const distCenter = Math.hypot(rock.x - player.x, rock.y - player.y) - rock.radius;
      // Bedrock never engages a claw (it only blocks, in the pushout below).
      const l = !rock.unbreakable && distLeft <= drillReach, r = !rock.unbreakable && distRight <= drillReach;
      anyLeft ||= l;
      anyRight ||= r;
      shared ||= l && r;
      touches.push({ rock, distLeft, distRight, distCenter, l, r });
    }
    const twinTorque = TUNING.dualClawBonus ?? 1.25;
    const split = anyLeft && anyRight && !shared;
    player.clawDrilling = [anyRight, anyLeft];

    for (let i = 0; i < touches.length; i++) {
      const { rock, distLeft, distRight, distCenter, l, r } = touches[i];

      // If within the Crab Ship's front Drill-Claws (or touching hull), grind the rock! Bedrock only blocks.
      if (!rock.unbreakable && (l || r || distCenter <= player.radius + 14)) {
        this.isDrilling = true;
        this.drillingRocks.push(rock);

        // Both claws engaging same rock deals bonus twin-drill torque; split claws share it.
        const torque = l && r ? twinTorque : (l || r) && split ? twinTorque / 2 : 1.0;
        rock.hp -= miningDps * torque * dt;
        rock.hitFlash = 0.85;
        this.free(rock);
        {
          // Contact point: the rock face toward the nearer claw.
          const cx0 = distLeft < distRight ? leftClawX : rightClawX;
          const cy0 = distLeft < distRight ? leftClawY : rightClawY;
          const cd = Math.hypot(cx0 - rock.x, cy0 - rock.y) || 1;
          const gx = rock.x + ((cx0 - rock.x) / cd) * rock.radius, gy = rock.y + ((cy0 - rock.y) / cd) * rock.radius;
          const ghue = rock.oreType !== 'rock' ? rock.hue : 42;
          grindFx(rock, gx, gy, ghue, particles);
          // Grinding embers: slow glowing chips and a flicker of light at the bite.
          if (Math.random() < 0.25) particles.spawnExplosionSparks(gx, gy, 1, ghue, 0.5, 2.4, 3);
          if (Math.random() < 0.05) particles.spawnFlash?.(gx, gy, 8, ghue, 0.07);
        }

        // Spray high-velocity rock-grinding sparks off the drill claws!
        if (Math.random() < 0.75) {
          const sparkX = distLeft < distRight ? leftClawX : rightClawX;
          const sparkY = distLeft < distRight ? leftClawY : rightClawY;
          particles.spawnDirectionalSparks(
            sparkX,
            sparkY,
            ((distLeft < distRight ? player.clawAngles?.[1] : player.clawAngles?.[0]) ?? clawHeading) + Math.PI + (Math.random() - 0.5) * 0.8,
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
          this.loosenAround(rock);
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
    rock.hp -= dps * dt;
    rock.hitFlash = 0.85;
    this.free(rock);
    const hue = rock.oreType && rock.oreType !== 'rock' ? rock.hue : 32;
    grindFx(rock, cx, cy, hue, particles);
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

  // Rocks in view: solid rock, then the freed chunks on it, then bedrock over both (a bedrock core
  // wrapped in an asteroid shows from the start). Overlapping nodes merge into one solid shape by
  // drawing in passes: every rim, then every body over them (hiding each rim inside the shape, so only
  // the outer edge keeps one), then the raised top faces, then detail. Grouped nodes draw from their
  // group's shared paths (buildGroup); freed nodes each draw as their own rock (drawFreed).
  draw(ctx, camX, camY, viewW, viewH) {
    const pad = 70 + (this.maxRockRadius || 0);
    const minX = camX - pad;
    const maxX = camX + viewW + pad;
    const minY = camY - pad;
    const maxY = camY + viewH + pad;
    const base = ctx.getTransform ? ctx.getTransform() : null;
    const grouped = !!base && typeof Path2D !== 'undefined';
    const cs = this.cellSize;
    const gx0 = Math.floor(minX / cs) - 1, gx1 = Math.floor(maxX / cs) + 1;
    const gy0 = Math.floor(minY / cs) - 1, gy1 = Math.floor(maxY / cs) + 1;
    const bed = (this.visibleBedrock ||= []);
    const rock = (this.visibleRock ||= []);
    const freed = (this.visibleFreed ||= []);
    bed.length = 0;
    rock.length = 0;
    freed.length = 0;

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cell = this.spatialGrid.get(cellKey(gx, gy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i];
          if (a.hp <= 0 || a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;
          if (a.freed) freed.push(a);
          else if (!grouped || !a.group) (a.unbreakable ? bed : rock).push(a);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    if (grouped) {
      const gb = (this.visibleGroupsBed ||= []);
      const gr = (this.visibleGroupsRock ||= []);
      gb.length = 0;
      gr.length = 0;
      for (const g of this.groups || []) {
        if (g.dirty) buildGroup(g);
        if (g.maxX < minX || g.minX > maxX || g.maxY < minY || g.minY > maxY) continue;
        (g.kind === 'bedrock' ? gb : gr).push(g);
      }
      ctx.setTransform(base);
      if (gr.length) this.drawGroups(ctx, gr);
      if (rock.length) this.drawNodes(ctx, base, rock);
      if (freed.length) this.drawFreed(ctx, base, freed);
      if (gb.length) this.drawGroups(ctx, gb);
      if (bed.length) this.drawNodes(ctx, base, bed);
    } else {
      if (rock.length) this.drawNodes(ctx, base, rock);
      if (freed.length) this.drawFreed(ctx, base, freed);
      if (bed.length) this.drawNodes(ctx, base, bed);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (base) ctx.setTransform(base);
  }

  // Grouped nodes, a few fills per group: rims and bodies of the exposed nodes, every top face (an
  // interior node's covers its whole outline), then ore cores and bedrock cracks. No wide strokes: on a
  // CPU-rastered canvas they cost several times a fill. A node in play is freed and drawn on its own.
  drawGroups(ctx, groups) {
    // Each pass paints every group's plain rock, then every group's ore, so a seam where two asteroids
    // overlap is never painted over by the neighbour's rock.
    for (let ore = 0; ore < 2; ore++) {
      for (const g of groups) {
        for (const m of g.mats) {
          if (!m.rim || m.ore !== !!ore) continue;
          ctx.fillStyle = m.look.rim;
          ctx.fill(m.rim);
        }
      }
    }
    for (let ore = 0; ore < 2; ore++) {
      for (const g of groups) {
        for (const m of g.mats) {
          if (!m.body || m.ore !== !!ore) continue;
          ctx.fillStyle = m.look.body;
          ctx.fill(m.body);
        }
      }
    }
    for (let ore = 0; ore < 2; ore++) {
      for (const g of groups) {
        for (const m of g.mats) {
          if (m.ore !== !!ore) continue;
          ctx.fillStyle = m.look.top;
          ctx.fill(m.top);
        }
      }
    }
    for (const g of groups) {
      for (const m of g.mats) {
        if (!m.extra) continue;
        ctx.strokeStyle = m.look.bedrock ? 'rgba(6, 3, 12, 0.95)' : m.look.core;
        ctx.lineWidth = m.look.bedrock ? 1.6 : 1.8;
        ctx.stroke(m.extra);
      }
    }
  }

  // Freed nodes, each its own rock (the classic look): a rim, its body, a bevelled top face (hit-flashed
  // while it is ground), then ore core, cracks and the hot spot. A node being ground shudders a pixel.
  drawFreed(ctx, base, list) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const look = rockLook(a);
      const jit = a.hitFlash > 0.4 ? 1.3 : 0;
      a.jx = jit ? (Math.random() - 0.5) * jit * 2 : 0;
      a.jy = jit ? (Math.random() - 0.5) * jit * 2 : 0;
      const flashing = a.hitFlash > 0;
      nodeBegin(ctx, base, a, look, 1 + look.rimW / (2 * a.radius));
      ctx.fillStyle = flashing ? '#ffffff' : look.rim;
      let path = nodePath(ctx, a, look);
      if (path) ctx.fill(path); else ctx.fill();
      nodeEnd(ctx, base);
      nodeBegin(ctx, base, a, look, 1);
      ctx.fillStyle = look.body;
      path = nodePath(ctx, a, look);
      if (path) ctx.fill(path); else ctx.fill();
      nodeEnd(ctx, base);
      nodeBegin(ctx, base, a, look, TOP_FACE.freed);
      ctx.fillStyle = flashing ? look.flash : look.top;
      path = nodePath(ctx, a, look);
      if (path) ctx.fill(path); else ctx.fill();
      nodeEnd(ctx, base);
      nodeBegin(ctx, base, a, look, 1);
      this.drawNodeDetail(ctx, a, look);
      nodeEnd(ctx, base);
    }
    if (base) ctx.setTransform(base);
  }

  // Node by node (no Path2D, or nodes outside any group): the same passes, one node at a time.
  drawNodes(ctx, base, list) {
    // A node being ground shudders a pixel or so (the same offset in every pass this frame).
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const jit = a.hitFlash > 0.4 ? 1.3 : 0;
      a.jx = jit ? (Math.random() - 0.5) * jit * 2 : 0;
      a.jy = jit ? (Math.random() - 0.5) * jit * 2 : 0;
    }
    // 1. Rims: wide strokes, mostly covered by the bodies next.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const look = rockLook(a);
      nodeBegin(ctx, base, a, look, 1);
      ctx.strokeStyle = a.hitFlash > 0 ? '#ffffff' : look.rim;
      ctx.lineWidth = look.rimW;
      const path = nodePath(ctx, a, look);
      if (path) ctx.stroke(path); else ctx.stroke();
      nodeEnd(ctx, base);
    }
    // 2. Bodies.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const look = rockLook(a);
      nodeBegin(ctx, base, a, look, 1);
      ctx.fillStyle = look.body;
      const path = nodePath(ctx, a, look);
      if (path) ctx.fill(path); else ctx.fill();
      nodeEnd(ctx, base);
    }
    // 3. Raised top faces: an inset of each outline, a shade lighter (hit-flashed while being ground).
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const look = rockLook(a);
      nodeBegin(ctx, base, a, look, look.topScale);
      ctx.fillStyle = a.hitFlash > 0 ? look.flash : look.top;
      const path = nodePath(ctx, a, look);
      if (path) ctx.fill(path); else ctx.fill();
      // Faint cobble seam round each top face: the nodes the mass will break into.
      ctx.strokeStyle = look.seam;
      ctx.lineWidth = 1.1 / look.topScale;
      if (path) ctx.stroke(path); else ctx.stroke();
      nodeEnd(ctx, base);
    }
    // 4. Detail: ore cores, bedrock cracks, damage cracks and the hot spot under the drill.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const look = rockLook(a);
      if (!look.isRich && !look.bedrock && !(a.hp < a.maxHp * 0.97)) continue;
      nodeBegin(ctx, base, a, look, 1);
      this.drawNodeDetail(ctx, a, look);
      nodeEnd(ctx, base);
    }
    if (base) ctx.setTransform(base);
  }

  drawNodeDetail(ctx, a, look) {
    if (look.bedrock) {
      const c = look.crack;
      ctx.strokeStyle = 'rgba(6, 3, 12, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k].x, c[k].y);
      ctx.stroke();
      return;
    }
    const isRich = look.isRich;
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

    // Cracks spread from where the drill bit in, glowing hotter as the rock nears breaking; a
    // white-hot spot marks the contact while it is being ground.
    const dmg = 1 - Math.max(0, a.hp / a.maxHp);
    if (dmg > 0.03) {
      let cracks = a.cracks;
      if (!cracks) {
        const o = a.lastGrindX != null ? toLocal(a, a.lastGrindX, a.lastGrindY) : { x: 0, y: 0 };
        cracks = rockCracks(a, o.x, o.y);
      }
      const hue = a.hue; // cracks glow in the rock's own colour (plain rock: blue)
      const open = Math.min(1, dmg * 1.15);
      ctx.beginPath();
      for (let i = 0; i < cracks.segs.length; i++) {
        const sg = cracks.segs[i];
        if (sg.at0 >= open) continue;
        const k = Math.min(1, (open - sg.at0) / (sg.at - sg.at0));
        ctx.moveTo(sg.x1, sg.y1);
        ctx.lineTo(sg.x1 + (sg.x2 - sg.x1) * k, sg.y1 + (sg.y2 - sg.y1) * k);
      }
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `hsla(${hue}, 100%, 55%, ${0.25 + 0.35 * dmg})`;
      ctx.lineWidth = 3.4 + 2 * dmg;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 100%, ${78 + 18 * dmg}%, ${0.55 + 0.45 * dmg})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const heat = a.heat || 0;
      if (heat > 0.05 && a.lastGrindX != null) {
        const hot = toLocal(a, a.lastGrindX, a.lastGrindY);
        ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.25 * heat})`;
        ctx.beginPath();
        ctx.arc(hot.x, hot.y, 4 + 5 * heat, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 250, 235, ${0.6 * heat})`;
        ctx.beginPath();
        ctx.arc(hot.x, hot.y, 1.5 + 2 * heat, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
