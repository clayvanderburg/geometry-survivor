// Headless balance harness: the real Game simulation (main.js, enemies.js, asteroids.js, upgrades.js)
// driven by a scripted bot pilot at the fixed 60 Hz tick, with browser services stubbed the same way
// as tests/long-run.test.js. Nothing here changes game rules: the bot only presses inputs, picks cards
// and closes cache modals. Math.random is replaced by a seeded generator for the duration of each run.

// --- Browser stubs (must exist before main.js is imported) -------------------------------------
const fakeElement = () => {
  const el = {
    textContent: '', innerHTML: '', value: '', className: '', style: {}, offsetWidth: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    querySelector: () => fakeElement(), querySelectorAll: () => []
  };
  return el;
};
globalThis.window ??= { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.BroadcastChannel = undefined;
globalThis.document ??= {
  getElementById: fakeElement, createElement: fakeElement, querySelectorAll: () => [],
  addEventListener() {}, activeElement: null
};

const { Game } = await import('../../js/main.js');
const { EnemyManager } = await import('../../js/enemies.js');
const { AsteroidManager } = await import('../../js/asteroids.js');
const { ProgressionManager, META_UPGRADES } = await import('../../js/progression.js');
const { UPGRADE_POOL, applyUpgradeLevels, totalXpForLevel } = await import('../../js/upgrades.js');
const { TUNING, DEFAULT_TUNING, clearTuningOverlay } = await import('../../js/config.js');
const { MODES, normalizeMode } = await import('../../js/modes.js');
const { WEAPON_SCALING: W } = await import('../../js/weapon-scaling.js');
const { weaponSlots } = await import('../../js/loadout.js');
const { canOfferNewWeapon } = await import('../../js/upgrades.js');
const { rerollCost } = await import('../../js/gold.js');

export { UPGRADE_POOL, TUNING, DEFAULT_TUNING, MODES, W as WEAPON_SCALING };

const DT = 1 / 60;
const silent = new Proxy({}, { get: () => () => {} });

// --- Seeded RNG -------------------------------------------------------------------------------
// sfc32 seeded through a string hash, so "seed:strategy:run" names a reproducible run.
export function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function seededRandom(text) {
  const next = hashSeed(String(text));
  let a = next(), b = next(), c = next(), d = next();
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// Weapon-scaling overrides for A/B tests: a number, or an arrow-function source such as "lv => 80 + lv * 8".
export function parseWeaponOverrides(spec = {}) {
  const out = {};
  for (const [key, src] of Object.entries(spec)) {
    if (!(key in W)) throw new Error(`unknown weapon-scaling key ${key}`);
    const n = Number(src);
    out[key] = Number.isFinite(n) ? n : new Function(`return (${src});`)();
    if (typeof out[key] !== typeof W[key]) throw new Error(`${key} must stay a ${typeof W[key]}`);
  }
  return out;
}

// Seeds Math.random and applies tuning (on top of DEFAULT_TUNING) and weapon-scaling overrides for
// one job, then restores all three, so runs never leak state into each other or into the host process.
function withSeed(seed, { tuning = {}, weapons = {} }, fn) {
  const original = Math.random;
  const savedTuning = { ...TUNING };
  const savedWeapons = { ...W };
  Object.assign(TUNING, DEFAULT_TUNING, tuning);
  Object.assign(W, parseWeaponOverrides(weapons));
  Math.random = seededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
    clearTuningOverlay(); // a run cut off at the time cap still wears its game mode's overlay
    Object.assign(TUNING, savedTuning);
    Object.assign(W, savedWeapons);
  }
}

// --- Damage attribution -----------------------------------------------------------------------
// Primary attribution is the `source` every weapon passes to Game.hitEnemy, so a new weapon shows
// up under its own source with no change here. Several systems share the generic 'other' (and Pulsar
// Helix / Storm Protocol reuse 'blaster' / 'lightning'); these call-site contexts split them apart.
// A new weapon that also reports 'other' appears as "other" until it is given an entry here.
const CONTEXT_METHODS = {
  triggerDash: 'dash_nova',
  onRockShattered: 'tectonic_bore'
};
// Projectiles spawned inside these calls are re-tagged so their later hits are attributed.
const BULLET_TAGS = {
  killEnemy: 'shrapnel'
};

function installInstrumentation(game, metrics) {
  const ctxStack = [];
  const proto = Game.prototype;
  let hitDepth = 0;
  let pendingContact = null;

  const attribute = (source) => {
    const ctx = ctxStack.length ? ctxStack[ctxStack.length - 1] : null;
    if (ctx === 'blackhole_burst') return 'vortex_burst';
    if (ctx === 'storm' && source === 'lightning') return 'storm_chain';
    if (source === 'other' && ctx && ctx !== 'storm') return ctx;
    return source;
  };

  game.hitEnemy = function (e, dmg, source = 'blaster', kx = 0, ky = 0, flash = 1, stat = source) {
    const before = Math.max(0, e.hp);
    const src = attribute(source);
    if (e.firstHitAt === undefined) e.firstHitAt = game.elapsedTime;
    e.hitsTaken = (e.hitsTaken || 0) + 1;
    hitDepth++;
    e.lastHitSource = src;
    try {
      proto.hitEnemy.call(this, e, dmg, source, kx, ky, flash, stat);
    } finally {
      hitDepth--;
    }
    // Effective damage is the HP the hit actually took (crits, armor and CORRODE included, overkill excluded).
    const landed = Math.min(before, Math.max(0, before - Math.max(0, e.hp)));
    metrics.damage(src, landed, dmg, e);
  };

  // Supernova boss damage writes HP directly and reports through damageNumbers.
  game.damageNumbers = {
    add(e, amount, source) {
      if (hitDepth > 0) return;
      metrics.damage(source, Math.min(Math.max(0, e.hp + amount), amount), amount, e);
      e.lastHitSource = source;
    },
    update() {}, clear() {}, draw() {}
  };

  game.killEnemy = function (e, fromBomb = false) {
    if (e.dead || !game.enemyManager.enemies.includes(e)) return proto.killEnemy.call(this, e, fromBomb);
    let src = e.lastHitSource;
    if (hitDepth === 0) {
      // Not a weapon hit: a supernova sweep or ramming the enemy with the shield.
      src = fromBomb ? 'supernova' : pendingContact === e ? 'contact' : 'other';
      if (e.hp > 0) metrics.damage(src, e.hp, e.hp, e);
    }
    metrics.kill(e, src || 'other', game);
    const bulletsBefore = game.bullets.length;
    const isWell = e.type === 'blackhole';
    if (isWell) ctxStack.push('blackhole_burst');
    try {
      return proto.killEnemy.call(this, e, fromBomb);
    } finally {
      if (isWell) ctxStack.pop();
      for (let i = bulletsBefore; i < game.bullets.length; i++) {
        const b = game.bullets[i];
        if (b.source === undefined || b.source === 'other') b.source = BULLET_TAGS.killEnemy;
      }
    }
  };

  for (const [method, tag] of Object.entries(CONTEXT_METHODS)) {
    game[method] = function (...args) {
      ctxStack.push(tag);
      try { return proto[method].apply(this, args); } finally { ctxStack.pop(); }
    };
  }

  // Storm Protocol detonations call fireChainLightning with an explicit origin.
  game.fireChainLightning = function (level, ox, oy, stat) {
    const storm = ox !== undefined;
    if (storm) ctxStack.push('storm');
    try { return proto.fireChainLightning.call(this, level, ox, oy, stat); } finally { if (storm) ctxStack.pop(); }
  };

  // Pulsar Helix arms share the blaster's source; tag them at launch.
  game.firePrimaryWeapon = function () {
    const before = game.bullets.length;
    proto.firePrimaryWeapon.call(this);
    if (!game.player.weapons.pulsarHelix) return;
    for (let i = before; i < game.bullets.length; i++) {
      if (game.bullets[i].hue === 48) game.bullets[i].source = 'helix';
    }
  };

  // contactDamage is evaluated once per real shield hit (and once for the boss arrival card).
  let displayOnly = false;
  game.onBossArrived = function (e) {
    displayOnly = true;
    try { return proto.onBossArrived.call(this, e); } finally { displayOnly = false; }
  };
  game.contactDamage = function (e) {
    const dmg = proto.contactDamage.call(this, e);
    if (!displayOnly) {
      pendingContact = e;
      metrics.hurt(e, Math.min(dmg, Math.max(0, game.player.hp)), dmg, game);
    }
    return dmg;
  };

  // Upgrade exhaustion: hands with fewer than 3 cards, and empty hands (the ALL SYSTEMS MAXED full
  // shield repair fallback), with the time and level each first happened.
  game.triggerLevelUp = function () {
    const freeSlot = canOfferNewWeapon(game.player);
    const r = proto.triggerLevelUp.call(this);
    if (freeSlot) {
      metrics.handsWithFreeSlot++;
      if (game.state === 'UPGRADE' && game.currentChoices.some((c) => c.isNewWeapon)) metrics.newWeaponHands++;
    }
    const n = game.currentChoices.length;
    const stamp = { time: game.elapsedTime, level: game.player.level };
    if (game.state !== 'UPGRADE') {
      metrics.maxedCount++;
      metrics.maxedAt ??= stamp;
    } else if (n < 3) metrics.thinHandAt ??= stamp;
    return r;
  };

  // Gunner plasma orbs are scored as their own "orb" type (they used to show as an unknown killer).
  game.enemyBulletDamage = function (b) {
    const dmg = proto.enemyBulletDamage.call(this, b);
    metrics.hurt({ type: 'orb' }, Math.min(dmg, Math.max(0, game.player.hp)), dmg, game);
    return dmg;
  };

  // Beams (lancers, twin tethers, the Prism's lighthouse) are scored to the hull that carries them.
  game.beamDamage = function (e) {
    const dmg = proto.beamDamage.call(this, e);
    metrics.hurt(e, Math.min(dmg, Math.max(0, game.player.hp)), dmg, game);
    return dmg;
  };

  const addCores = game.progression.addCores.bind(game.progression);
  game.progression.addCores = (n) => { metrics.cores += n; addCores(n); };
}

// --- Headless game fixture --------------------------------------------------------------------
// `mode` (js/modes.js) is the title-screen choice: resetRun(game.selectedMode) flies it, as startGame does.
export function createHeadlessGame({ metaRank = 0, mode = 'normal' } = {}) {
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    canvas: null, ctx: null, width: 1280, height: 720,
    worldWidth: 4200, worldHeight: 4200, camX: 0, camY: 0,
    sound: silent, grid: silent, particles: silent,
    progression: new ProgressionManager(),
    enemyManager: new EnemyManager(),
    damageNumbers: null,
    state: 'TITLE', autoFire: true, autoAim: true, selectedMode: normalizeMode(mode), mode: 'normal',
    keys: {}, mouse: { x: 640, y: 360, down: false },
    shake: 0, chromaFlash: 0, hitStopTicks: 0, shieldRotation: 0,
    gpButtons: [], gpActive: false, menuNav: null, menuState: null, menuGrace: 0,
    currentChoices: [],
    updateHUD() {}, updateBossHUD() {}, showBanner() {}, renderHubUI() {}
  });
  game.asteroidManager = new AsteroidManager(game.worldWidth, game.worldHeight);
  for (const upg of META_UPGRADES) game.progression.data.ranks[upg.id] = Math.min(upg.maxRank, metaRank);
  return game;
}

// --- Metrics ----------------------------------------------------------------------------------
export function createMetrics() {
  const m = {
    dealt: {},        // source -> effective damage (overkill excluded)
    dealtRaw: {},     // source -> raw damage including overkill
    kills: {},        // source -> killing blows
    taken: {},        // enemy type -> { dmg, hits }
    ttk: {},          // `${type}|${wave}` -> { n, exposure, life, hits }
    killsByType: {},
    perWave: [],      // index wave -> { taken, kills, hpEnd, enemies, levelEnd }
    levels: [],       // elapsed time of each level-up
    cores: 0,
    goldVeins: 0,     // gold veins broken (by the ship or by elites)
    rerolls: 0,       // level-up rerolls bought by the bot's gold policy
    killer: null,
    handsWithFreeSlot: 0, // level-up hands rolled while a weapon slot was free
    newWeaponHands: 0,    // ...and how many of them carried the NEW WEAPON card
    maxedCount: 0,    // level-ups that found nothing to offer (full shield repair instead)
    maxedAt: null,    // { time, level } of the first such level-up
    thinHandAt: null, // { time, level } of the first hand with fewer than 3 cards
    slotsFullAt: null, // { time, level } when every weapon slot was filled
    damage(src, eff, raw) {
      m.dealt[src] = (m.dealt[src] || 0) + eff;
      m.dealtRaw[src] = (m.dealtRaw[src] || 0) + raw;
    },
    kill(e, src, game) {
      m.kills[src] = (m.kills[src] || 0) + 1;
      const type = e.isBoss ? 'boss' : e.type;
      m.killsByType[type] = (m.killsByType[type] || 0) + 1;
      // Time-to-kill measures weapons: enemies swept by a Supernova or rammed before any weapon hit
      // them would otherwise count as zero-second "one-hit" kills and drag the medians down.
      if (e.bornAt === undefined || !e.hitsTaken) return;
      // Exposure = first hit -> death; a sparse histogram in 1/30 s bins keeps pooled medians exact enough.
      const key = `${type}|${game.wave}`;
      const t = m.ttk[key] || (m.ttk[key] = { n: 0, hist: {}, life: 0, hits: 0, oneHit: 0 });
      const exposure = e.firstHitAt === undefined ? 0 : game.elapsedTime - e.firstHitAt;
      const bin = Math.min(900, Math.round(exposure * 30));
      t.n++;
      t.hist[bin] = (t.hist[bin] || 0) + 1;
      t.life += game.elapsedTime - e.bornAt;
      t.hits += e.hitsTaken || 0;
      if (e.hitsTaken === 1) t.oneHit++;
      waveRow(game.wave).kills++;
    },
    hurt(e, eff, raw, game) {
      const type = e.isBoss ? 'boss' : e.type;
      const t = m.taken[type] || (m.taken[type] = { dmg: 0, hits: 0 });
      t.dmg += eff;
      t.hits++;
      waveRow(game.wave).taken += eff;
      if (eff >= game.player.hp) m.killer = type;
    }
  };
  const waveRow = (w) => (m.perWave[w] ||= { taken: 0, kills: 0, hpEnd: null, enemies: 0, samples: 0, levelEnd: 0 });
  m.waveRow = waveRow;
  return m;
}

// --- Bot pilot --------------------------------------------------------------------------------
// Kites away from nearby threats with a circling bias, keeps off the walls and out of rocks,
// collects Geoms and caches when it is safe, dashes when something is about to touch it or it is
// boxed in, and fires a Supernova when its shield is low inside a crowd. Aim is the game's autoAim.
export function botControls(game, pilot, state) {
  const p = game.player;
  const enemies = game.enemyManager.enemies;
  let fx = 0, fy = 0;
  let nearest = Infinity;
  let crowd = 0;
  let close = 0;
  let bossNear = false;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const R = e.isBoss ? 460 : e.type === 'blackhole' ? 340 : 270;
    const gap = d - e.radius - p.radius;
    if (gap < nearest) nearest = gap;
    if (d < 300) crowd++;
    if (gap < 70) close++;
    if (e.isBoss && d < 300) bossNear = true;
    if (d < R) {
      const k = (R - d) / R;
      const w = k * k * (e.isBoss ? 3 : e.type === 'blackhole' ? 2 : 1);
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
  }
  for (const sp of game.enemyManager.spawnIndicators) {
    const dx = p.x - sp.x, dy = p.y - sp.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 140) { fx += (dx / d) * 0.6; fy += (dy / d) * 0.6; }
  }
  // Gunner plasma orbs: sidestep any orb whose straight path passes close to the ship within ~0.8 s,
  // and dash through one that is about to land (a dash's invulnerability lets orbs pass).
  let dodgeNow = false;
  const orbs = game.enemyManager.enemyBullets?.active || [];
  for (let i = 0; i < orbs.length; i++) {
    const b = orbs[i];
    const rx = p.x - b.x, ry = p.y - b.y;
    const v2 = b.vx * b.vx + b.vy * b.vy || 1;
    const t = (rx * b.vx + ry * b.vy) / v2; // ticks until closest approach
    if (t < 0 || t > 48) continue;
    const mx = rx - b.vx * t, my = ry - b.vy * t; // ship offset from the orb's path at closest approach
    const miss = Math.hypot(mx, my);
    const reach = p.radius + b.radius + 14;
    if (miss > reach + 26) continue;
    const m = miss || 1;
    const sx = miss > 0.5 ? mx / m : -b.vy / Math.sqrt(v2), sy = miss > 0.5 ? my / m : b.vx / Math.sqrt(v2);
    const w = (1 - t / 60) * 2.2;
    fx += sx * w;
    fy += sy * w;
    if (t < 9 && miss < reach) dodgeNow = true;
  }
  // Bruisers: step out of a marked charge lane (wind-up or charge), and dash if one is about to hit.
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.type !== 'bruiser' || (e.state !== 'windup' && e.state !== 'charge')) continue;
    const ax = Math.cos(e.aimAngle), ay = Math.sin(e.aimAngle);
    const rx = p.x - e.x, ry = p.y - e.y;
    const along = rx * ax + ry * ay;
    if (along < -10 || along > 460) continue;
    const perp = rx * -ay + ry * ax; // signed distance from the lane
    const width = e.radius + p.radius + 34;
    if (Math.abs(perp) > width) continue;
    const side = perp >= 0 ? 1 : -1;
    const w = 2.6 * (1 - Math.abs(perp) / width) + 0.6;
    fx += -ay * side * w;
    fy += ax * side * w;
    if (e.state === 'charge' && along < 90) dodgeNow = true;
  }
  const threat = Math.hypot(fx, fy);
  // Circle the pack instead of backing straight into a wall.
  const tx = -fy * 0.45 * state.orbitSign, ty = fx * 0.45 * state.orbitSign;
  fx += tx;
  fy += ty;

  // Walls: push back toward the arena centre when within 450px of an edge.
  const W = game.worldWidth, H = game.worldHeight, wall = 450;
  if (p.x < wall) fx += ((wall - p.x) / wall) * 2.5;
  if (p.x > W - wall) fx -= ((p.x - (W - wall)) / wall) * 2.5;
  if (p.y < wall) fy += ((wall - p.y) / wall) * 2.5;
  if (p.y > H - wall) fy -= ((p.y - (H - wall)) / wall) * 2.5;

  // Rocks: steer around unless this build mines (then drill through when it is calm).
  const rocks = game.asteroidManager.getNearbyAsteroids(p.x, p.y, 2);
  let mineTarget = null, mineDist = Infinity;
  for (let i = 0; i < rocks.length; i++) {
    const r = rocks[i];
    if (r.hp <= 0) continue;
    const dx = p.x - r.x, dy = p.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    const gap = d - r.radius - p.radius;
    // goldPull: a pilot that goes after gold veins treats them as this many px closer than plain rock.
    const pull = r.oreType === 'gold_vein' ? (pilot.goldPull || 0) : 0;
    if (pilot.mineBias > 0 && gap - pull < mineDist) { mineDist = gap - pull; mineTarget = r; }
    if (gap < 55) {
      const w = (55 - gap) / 55 * (pilot.mineBias > 0 && threat < 0.6 ? 0.2 : 1.4);
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
  }

  const calm = threat < 0.35;
  // Pickups: caches always matter; Geoms when the coast is fairly clear.
  let goal = null;
  let goalW = 0;
  if (game.chests.length) {
    let best = Infinity;
    for (const c of game.chests) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < best) { best = d; goal = c; }
    }
    goalW = threat < 1.2 ? 1.4 : 0.4;
  }
  if (!goal && threat < 0.9) {
    let best = 650;
    for (let i = 0; i < game.geoms.length; i++) {
      const g = game.geoms[i];
      if (g.magnetized) continue;
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < best) { best = d; goal = g; }
    }
    goalW = 0.7;
  }
  if (!goal && calm && mineTarget && pilot.mineBias > 0 && mineDist < 600) {
    goal = mineTarget;
    goalW = pilot.mineBias;
  }
  if (goal) {
    const dx = goal.x - p.x, dy = goal.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    fx += (dx / d) * goalW;
    fy += (dy / d) * goalW;
  }

  // Idle drift toward the centre keeps the bot in open space between packs.
  if (Math.hypot(fx, fy) < 0.15) {
    fx += (W / 2 - p.x) / W;
    fy += (H / 2 - p.y) / H;
  }

  // Unstick: if the ship has barely moved for a second while trying to, flip the circling direction.
  state.stuckTimer = Math.hypot(p.vx, p.vy) < 0.6 && Math.hypot(fx, fy) > 0.3 ? state.stuckTimer + DT : 0;
  if (state.stuckTimer > 1) { state.orbitSign *= -1; state.stuckTimer = 0; }

  const mag = Math.hypot(fx, fy);
  const moveX = mag > 0.02 ? fx / mag : 0;
  const moveY = mag > 0.02 ? fy / mag : 0;
  const dash = p.dashCooldown <= 0 && p.invuln <= 0 && (nearest < 22 || close >= 5 || dodgeNow);
  const bomb = p.bombs > 0 && p.invuln <= 0 && (
    (p.hp < p.maxHp * 0.35 && crowd >= 10) || (bossNear && p.hp < p.maxHp * 0.5)
  );
  return { moveX, moveY, dash, bomb };
}

// --- Card picking -----------------------------------------------------------------------------
// Highest priority wins; a priority list entry may be an upgrade id, "synergy" (any evolution) or
// "new_weapon" (the NEW WEAPON card). Cards outside the list are scored randomly below every listed
// card. After NEW WEAPON, the weapon pick follows `strategy.weapons` (loadout.js ids), else random.
export function pickCard(choices, strategy) {
  let best = 0, bestScore = -Infinity;
  const prio = strategy.priorities || [];
  const wants = strategy.weapons || [];
  choices.forEach((c, i) => {
    let score;
    if (c.isWeaponPick) {
      const idx = wants.indexOf(c.weaponId);
      score = idx === -1 ? Math.random() : 100 - idx;
    } else {
      let idx = prio.indexOf(c.id);
      if (idx === -1 && c.isSynergy) idx = prio.indexOf('synergy');
      score = idx === -1 ? Math.random() : 100 - idx + (c.levelJump || 1) * 0.01;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// Pilot skill is reaction latency: the controls applied each tick were decided this many ticks ago.
export const PILOT_SKILLS = { expert: 1, average: 12, novice: 20 };

// --- One simulated run ------------------------------------------------------------------------
// `god` keeps the ship alive (pacing measurements only: how fast XP and levels come in a long run).
// Gold policy: the bot buys one reroll in any level-up hand that opens while it can afford the base
// cost (no locks), so `rerolls` estimates how often a player who mines can reroll.
export function simulateRun({ strategy, seed, maxSeconds = 900, metaRank = 0, tuning = {}, weapons = {}, skill = 'average', god = false, mode = 'normal' }) {
  return withSeed(seed, { tuning, weapons }, () => {
    const game = createHeadlessGame({ metaRank, mode });
    const metrics = createMetrics();
    installInstrumentation(game, metrics);
    const shatter = game.onRockShattered;
    game.onRockShattered = function (rock) {
      if (rock.oreType === 'gold_vein') metrics.goldVeins++;
      return shatter.call(this, rock);
    };
    const pilot = { mineBias: 0, ...(strategy.pilot || {}) };
    const botState = { orbitSign: Math.random() < 0.5 ? -1 : 1, stuckTimer: 0 };
    const latency = PILOT_SKILLS[skill] ?? (Math.max(1, Math.round(Number(skill))) || 1);
    const pipeline = [];
    let controls = { moveX: 0, moveY: 0, dash: false, bomb: false };
    game.pollGamepad = () => ({
      moveX: controls.moveX, moveY: controls.moveY, aimX: 0, aimY: 0,
      dash: controls.dash, bomb: controls.bomb, pressed: () => false, buttons: [], active: false
    });

    game.resetRun(game.selectedMode);
    game.state = 'PLAYING';
    game.spawnWavePack();
    // God mode: hits still land (knockback, multiplier loss) but never take the last point of shield.
    if (god) game.damagePlayer = function (dmg, shake, by) { return Game.prototype.damagePlayer.call(this, Math.min(dmg, this.player.hp - 1), shake, by); };

    const maxTicks = Math.round(maxSeconds * 60);
    let lastWave = 1;
    let lastLevel = 1;
    let ticks = 0;
    const levelAt = []; // level at each whole minute
    const xpAt = [];    // cumulative XP collected at each whole minute
    const enemiesAt = []; // enemies alive at each whole minute
    const goldAt = [];  // cumulative gold collected at each whole minute
    for (; ticks < maxTicks && game.state !== 'GAMEOVER'; ticks++) {
      if (god) game.player.hp = game.player.maxHp;
      if (ticks % 3600 === 0) {
        levelAt.push(game.player.level);
        xpAt.push(Math.round(totalXpForLevel(game.player.level) + game.player.xp));
        enemiesAt.push(game.enemyManager.enemies.length);
        goldAt.push(game.goldEarned);
      }
      pipeline.push(botControls(game, pilot, botState));
      if (pipeline.length >= latency) controls = pipeline.shift();
      game.update(DT);
      // Stamp spawn time on newly materialized enemies (for lifetime / time-to-kill).
      const enemies = game.enemyManager.enemies;
      for (let i = enemies.length - 1; i >= 0 && enemies[i].bornAt === undefined; i--) enemies[i].bornAt = game.elapsedTime;
      // Safety: stamp any stragglers (splice order can leave unstamped entries earlier in the array).
      if ((ticks & 63) === 0) for (const e of enemies) e.bornAt ??= game.elapsedTime;

      // Menus: pick a card, claim a cache. Each may chain into another level-up.
      for (let guard = 0; guard < 20 && (game.state === 'UPGRADE' || game.state === 'CHEST'); guard++) {
        if (game.state === 'UPGRADE') {
          if (game.handPhase === 'hand' && game.handRerolls === 0 && game.gold >= rerollCost(0) && game.rerollHand()) metrics.rerolls++;
          game.selectUpgrade(pickCard(game.currentChoices, strategy));
        }
        else game.closeChestModal();
      }
      if (!metrics.slotsFullAt && (game.player.loadout || []).length >= weaponSlots(game.player)) metrics.slotsFullAt = { time: game.elapsedTime, level: game.player.level };
      if (game.player.level !== lastLevel) {
        for (let l = lastLevel; l < game.player.level; l++) metrics.levels.push(game.elapsedTime);
        lastLevel = game.player.level;
      }
      const row = metrics.waveRow(game.wave);
      row.enemies += enemies.length;
      row.samples++;
      if (game.wave !== lastWave) {
        const prev = metrics.waveRow(lastWave);
        prev.hpEnd = game.player.hp / game.player.maxHp;
        prev.levelEnd = game.player.level;
        lastWave = game.wave;
      }
    }

    const died = game.state === 'GAMEOVER';
    // The game's own run summary (js/run-stats.js): the format players upload to /api/stats, so
    // --stats-out aggregates simulated runs exactly like the server aggregates real ones.
    const stats = game.lastRunSummary || game.finishRunStats();
    return {
      strategy: strategy.name,
      seed,
      skill,
      mode: game.mode,
      died,
      killer: died ? metrics.killer : null,
      time: game.elapsedTime,
      wave: game.wave,
      level: game.player.level,
      kills: game.kills,
      score: game.score,
      cores: metrics.cores,
      rocksMined: game.rocksMined,
      goldVeins: metrics.goldVeins,
      goldEarned: game.goldEarned,
      goldSpent: game.goldSpent,
      rerolls: metrics.rerolls,
      goldAt,
      build: { ...game.player.upgradeLevels },
      loadout: [...(game.player.loadout || [])],
      levelAt,
      xpAt,
      maxedCount: metrics.maxedCount,
      handsWithFreeSlot: metrics.handsWithFreeSlot,
      newWeaponHands: metrics.newWeaponHands,
      maxedAt: metrics.maxedAt,
      thinHandAt: metrics.thinHandAt,
      slotsFullAt: metrics.slotsFullAt,
      enemiesAt,
      dealt: metrics.dealt,
      dealtRaw: metrics.dealtRaw,
      kills_by_source: metrics.kills,
      kills_by_type: metrics.killsByType,
      taken: metrics.taken,
      ttk: metrics.ttk,
      levels: metrics.levels,
      perWave: metrics.perWave.map((r, w) => r && { wave: w, taken: r.taken, kills: r.kills, hpEnd: r.hpEnd, levelEnd: r.levelEnd, enemiesAvg: r.samples ? r.enemies / r.samples : 0 }).filter(Boolean),
      stats,
      ticks
    };
  });
}

// --- Weapon throughput bench ------------------------------------------------------------------
// A fixed population of wave-6 targets is kept topped up around an invulnerable ship (bench only) in
// an empty arena, and only the card under test is installed. Two scenarios:
//   pack:  the ship sits still; targets are stationary, scattered 70-420 px away (ranged potential).
//   chase: the ship circles the arena centre; targets chase it normally, and any that reach the
//          shield are removed and counted as a "leak" (how well the card keeps a swarm off you).
// Damage is effective (overkill excluded) so on-kill effects such as shrapnel count. Every case
// uses the same seed (common random numbers), so the gain over the no-card baseline is the card's.
export const BENCH = { targets: 50, innerRadius: 70, outerRadius: 420, seconds: 15, targetWave: 6, orbitRadius: 260, mix: ['swarmer', 'swarmer', 'pinwheel', 'weaver', 'splitter'] };

export function benchUpgrade({ upgradeId = null, level = 0, seed = 'bench', scenario = 'pack', seedIndex = 0, tuning = {}, weapons = {}, bench = BENCH }) {
  const chase = scenario === 'chase';
  return withSeed(`${seed}:bench:${scenario}:${seedIndex}`, { tuning, weapons }, () => {
    const game = createHeadlessGame();
    const metrics = createMetrics();
    installInstrumentation(game, metrics);
    game.pollGamepad = () => null;
    game.resetRun();
    game.asteroidManager.asteroids = [];
    game.asteroidManager.rebuildSpatialHash();
    game.state = 'PLAYING';
    game.spawnWavePack = () => {};
    game.waveTimer = -1e9; // hold the wave (no boss schedule, no spawn ramp)
    game.wave = bench.targetWave;
    const p = game.player;
    if (upgradeId) {
      // Install exactly `level` levels (starting weapons such as Rocket Pods are already LV 1).
      const upg = UPGRADE_POOL.find(u => u.id === upgradeId);
      const jump = level - (p.upgradeLevels[upgradeId] || 0);
      if (jump > 0) applyUpgradeLevels(p, { ...upg, levelJump: jump });
    }
    const scale = game.getWaveScale();
    const em = game.enemyManager;
    const cx = game.worldWidth / 2, cy = game.worldHeight / 2;
    let n = 0;
    const topUp = () => {
      while (em.enemies.length + em.spawnIndicators.length < bench.targets) {
        const a = Math.random() * Math.PI * 2;
        const inner = chase ? 380 : bench.innerRadius, outer = chase ? 520 : bench.outerRadius;
        const r = Math.sqrt(inner ** 2 + Math.random() * (outer ** 2 - inner ** 2));
        em.queueSpawn(bench.mix[n++ % bench.mix.length], p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, scale, { instant: true });
      }
    };
    // Pack targets (and splitter children) stand still.
    if (!chase) {
      const queue = em.queueSpawn.bind(em);
      em.queueSpawn = (type, x, y, ws, extra = {}) => {
        const ok = queue(type, x, y, ws, extra);
        if (ok) em.spawnIndicators[em.spawnIndicators.length - 1].config.speed = 0;
        return ok;
      };
    }
    let leaks = 0;
    let orbit = 0;
    const ticks = Math.round(bench.seconds * 60);
    for (let t = 0; t < ticks; t++) {
      topUp();
      p.invuln = 1;
      if (chase) {
        // Circle at 70% of move speed, so the swarm trails and flanks the ship like a kiting player.
        const speed = p.stats.moveSpeed * 0.7;
        orbit += speed / bench.orbitRadius;
        const nx = cx + Math.cos(orbit) * bench.orbitRadius, ny = cy + Math.sin(orbit) * bench.orbitRadius;
        p.vx = nx - p.x; p.vy = ny - p.y; p.x = nx; p.y = ny;
        for (let i = em.enemies.length - 1; i >= 0; i--) {
          const e = em.enemies[i];
          if (Math.hypot(e.x - p.x, e.y - p.y) < p.radius + e.radius + 4) {
            e.dead = true;
            em.enemies.splice(i, 1);
            leaks++;
          }
        }
      } else {
        p.x = cx; p.y = cy; p.vx = 0; p.vy = 0;
      }
      game.geoms.length = 0;
      game.chests.length = 0;
      if (p.dashCooldown <= 0) game.triggerDash(); // potential: dash nova on every cooldown
      if (!chase) { p.vx = 0; p.vy = 0; }
      game.update(DT);
      if (game.state !== 'PLAYING') game.state = 'PLAYING';
    }
    const dps = {};
    for (const [src, v] of Object.entries(metrics.dealt)) dps[src] = v / bench.seconds;
    return { upgradeId, level, scenario, seedIndex, dps, total: Object.values(dps).reduce((a, b) => a + b, 0), leaksPerMin: leaks / (bench.seconds / 60) };
  });
}

// Upgrades whose install changes player.weapons are weapons; everything else is a stat card.
// Each card is installed through the game's own applyUpgradeLevels on a copy of a real fresh-run
// player, so a new card that touches player fields a hand-made stub lacks is still classified.
export function classifyUpgrades() {
  const fresh = withSeed('classify', {}, () => {
    const game = createHeadlessGame();
    game.resetRun();
    return JSON.stringify(game.player);
  });
  return UPGRADE_POOL.map((u) => {
    const player = JSON.parse(fresh);
    const before = JSON.stringify(player.weapons);
    applyUpgradeLevels(player, { ...u, levelJump: 1 });
    // Element cards (Autocannon: Thermite Rounds, ...) raise a weapon's level and set its element: a modifier, not a weapon.
    const isModifier = !!u.elementCard;
    // Weapon stat cards raise a weapon's level too, but they are that weapon's cards, not weapons.
    return { id: u.id, name: u.name, maxLevel: u.maxLevel, isSynergy: !!u.isSynergy, isModifier, isStatCard: !!u.statCard,
      isWeapon: !isModifier && !u.statCard && JSON.stringify(player.weapons) !== before };
  });
}
