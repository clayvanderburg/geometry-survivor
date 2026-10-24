import test from 'node:test';
import assert from 'node:assert/strict';

// Ship hardpoints (docs/SHIP_HARDPOINTS.md): every weapon has a mount, five weapons always fit, the layout
// holds when a weapon is discarded, mounts turn with the hull, launches leave from the mount, and REDUCE
// EFFECTS drops the blooms.
const h = await import('../tools/balance/harness.mjs');
const { WEAPONS } = await import('../js/loadout.js');
const { acquireWeapon } = await import('../js/upgrades.js');
const { setReduceEffects } = await import('../js/juice.js');
const { MOUNTS, HARDPOINTS, hardpointLayout, mountLocal, mountWorld, kickMount, updateMounts, drawHardpoints, drawPart, ownedWeapons } = await import('../js/hardpoints.js');
const { drawCrabShip } = await import('../js/ship-renderer.js');

const ship = (loadout) => ({ x: 100, y: 50, radius: 15, hullAngle: 0, angle: 0, loadout: [...loadout], stats: {} });
const hardpointWeapons = WEAPONS.filter((w) => MOUNTS[w.id]?.type).map((w) => w.id);

// A canvas context that records drawImage / lighter blends and ignores everything else.
function fakeCtx() {
  const log = { glows: 0, ops: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'getTransform') return () => ({ a: 1, b: 0 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => { log.ops++; };
    },
    set(t, k, v) {
      if (k === 'globalCompositeOperation' && v === 'lighter') log.glows++;
      t[k] = v;
      return true;
    }
  });
  return { ctx, log };
}

test('every weapon has a mount, in its weapon colour', () => {
  for (const w of WEAPONS) {
    assert.ok(MOUNTS[w.id], `${w.id} has a mount`);
    assert.equal(MOUNTS[w.id].color, w.color, `${w.id} mount colour matches WEAPONS`);
    assert.ok(MOUNTS[w.id].builtin || HARDPOINTS[Object.keys(HARDPOINTS)[0]], `${w.id} is built in or takes a hardpoint`);
  }
  assert.equal(Object.keys(HARDPOINTS).length, 5);
});

test('any five hardpoint weapons fit, each on its own hardpoint, preferred type first', () => {
  // Every 5-weapon combination of the hardpoint weapons, in a few slot orders.
  const ids = hardpointWeapons;
  let combos = 0;
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) for (let c = b + 1; c < ids.length; c++)
    for (let d = c + 1; d < ids.length; d++) for (let e = d + 1; e < ids.length; e++) {
      const p = ship([ids[a], ids[b], ids[c], ids[d], ids[e]]);
      const map = hardpointLayout(p);
      assert.equal(new Set(Object.values(map)).size, 5);
      combos++;
    }
  assert.ok(combos > 500);
  const p = ship(['grenades', 'glaive', 'turret']);
  const map = hardpointLayout(p);
  assert.equal(map.grenades, 'rootPort');
  assert.equal(map.glaive, 'rootStbd');
  assert.match(map.turret, /^wing/, 'roots full: the turret cradle falls back to a wing');
  // Sides stay balanced: a wing weapon on port sends the next root weapon to starboard.
  const q = hardpointLayout(ship(['missiles', 'lightning', 'glaive']));
  assert.equal(q.missiles, 'wingPort');
  assert.equal(q.lightning, 'spine');
  assert.equal(q.glaive, 'rootStbd');
});

test('discarding a weapon frees its hardpoint and leaves the others where they were', () => {
  const p = ship(['blaster', 'grenades', 'missiles', 'lightning', 'glaive']);
  const before = { ...hardpointLayout(p) };
  p.loadout = ['blaster', 'missiles', 'lightning', 'glaive'];
  const after = hardpointLayout(p);
  assert.equal(after.grenades, undefined);
  for (const id of ['missiles', 'lightning', 'glaive']) assert.equal(after[id], before[id], `${id} stays put`);
  p.loadout.push('shockfield');
  assert.equal(hardpointLayout(p).shockfield, before.grenades, 'a new weapon takes the freed root');
});

test('mounts turn with the hull; built-in mounts sit where those weapons already fire', () => {
  const p = ship(['missiles']);
  const local = mountLocal(p, 'missiles');
  const a = mountWorld(p, 'missiles');
  assert.ok(Math.abs(a.x - (p.x + local.x)) < 1e-9 && Math.abs(a.y - (p.y + local.y)) < 1e-9);
  p.hullAngle = Math.PI / 2;
  const b = mountWorld(p, 'missiles');
  assert.ok(Math.abs(b.x - (p.x - local.y)) < 1e-9 && Math.abs(b.y - (p.y + local.x)) < 1e-9);
  assert.deepEqual(mountLocal(p, 'blaster'), { x: 0, y: 0 });
  assert.equal(mountLocal(p, 'harpoon'), null);
  assert.equal(mountLocal(p, 'flamethrower'), null);
  // A mount inside a rock face launches from the ship centre instead.
  const c = mountWorld(p, 'missiles', {}, { rockOnSegment: () => true });
  assert.deepEqual(c, { x: p.x, y: p.y });
  // Every hardpoint stays within the shield's hull (wings reach 1.76r).
  for (const hp of Object.values(HARDPOINTS)) assert.ok(Math.abs(hp.y) <= 1.5 && hp.x <= 0.9 && hp.x >= -0.95);
});

test('kicks flash, recoil and heat the mount, swivel parts aim then drift home, and it all decays', () => {
  const p = ship(['grenades']);
  kickMount(p, 'grenades', Math.PI / 2);
  const fx = p.mountFx.grenades;
  assert.equal(fx.flash, 1);
  assert.equal(fx.recoil, 1);
  assert.ok(fx.heat > 0.3);
  assert.ok(Math.abs(fx.aim - Math.PI / 2) < 1e-9);
  for (let i = 0; i < 120; i++) updateMounts(p, 1 / 60);
  assert.equal(fx.flash, 0);
  assert.equal(fx.recoil, 0);
  assert.ok(fx.heat < 0.01);
  assert.ok(Math.abs(fx.aim) < 0.2, 'the launcher drifts back to facing forward');
  kickMount(p, 'mines', 1); // non-swivel parts never turn
  assert.equal(p.mountFx.mines.aim, 0);
});

test('parts draw for 1 and 5 weapons; REDUCE EFFECTS drops the muzzle blooms', () => {
  const p = ship(['blaster', 'rockets', 'missiles', 'grenades', 'lightning']);
  for (const id of p.loadout) kickMount(p, id, 0);
  const realDocument = globalThis.document; // the harness may stub one without canvases
  globalThis.document = { createElement: () => ({ getContext: () => fakeCtx().ctx }) };
  const full = fakeCtx();
  drawHardpoints(full.ctx, p, 0.4, 0);
  setReduceEffects(true);
  const calm = fakeCtx();
  drawHardpoints(calm.ctx, p, 0.4, 0);
  setReduceEffects(false);
  globalThis.document = realDocument;
  assert.ok(full.log.glows > calm.log.glows, 'fewer additive glows with REDUCE EFFECTS');
  // The whole ship still draws, with a single weapon and with five.
  for (const loadout of [['blaster'], p.loadout, ['raillance', 'orbitals', 'flamethrower', 'cryospray', 'acidspray']]) {
    const q = { ...ship(loadout), stats: { drillScale: 1 } };
    drawCrabShip(fakeCtx().ctx, q, {}, false, 0);
  }
  drawPart(fakeCtx().ctx, 'cradle', '#fff', 0, 0, 0, 1, null, 4);
  assert.deepEqual(ownedWeapons({ weapons: { glaive: 2 } }), ['blaster', 'glaive']);
});

test('a lobbed grenade leaves the launcher and still lands where it was thrown', async () => {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  acquireWeapon(p, 'grenades');
  p.loadout = ['grenades'];
  g.asteroidManager.asteroids.length = 0;
  g.asteroidManager.rebuildSpatialHash();
  g.enemyManager.enemies.length = 0;
  const tube = mountWorld(p, 'grenades');
  assert.ok(Math.hypot(tube.x - p.x, tube.y - p.y) > 10, 'the root hardpoint sits off centre');
  const { weaponBuild } = await import('../js/weapon-levels.js');
  g.grenades.throwGrenades(g, weaponBuild(p, 'grenades'));
  assert.ok(g.grenades.count > 0);
  for (let k = 0; k < g.grenades.count; k++) {
    const it = g.grenades.items[k];
    assert.ok(Math.abs(it.sx - tube.x) < 1e-9 && Math.abs(it.sy - tube.y) < 1e-9, 'thrown from the launcher');
    assert.ok(Math.hypot(it.lx - p.x, it.ly - p.y) > 30, 'lands out at the throw range, not at the launcher');
  }
  assert.ok(p.mountFx.grenades.flash > 0, 'the launcher kicked');
});
