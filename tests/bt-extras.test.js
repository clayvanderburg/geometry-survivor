import test from 'node:test';
import assert from 'node:assert/strict';

// Pool Breakthroughs (js/bt-extras.js, EXTRA_TRANSFORMS): each one runs in a live fight and does what its
// card says. Their potential DPS is pinned in tests/breakthrough-pools.test.js.
const h = await import('../tools/balance/harness.mjs');
const { acquireWeapon } = await import('../js/upgrades.js');
const { EXTRA_TRANSFORMS, weaponBuild } = await import('../js/weapon-levels.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');
const { PIXIE_PICK_LINES } = await import('../js/pixie.js');
const BTX = await import('../js/bt-extras.js');

// A game with only `id` firing, `tf` installed at `m`, and still enemies at (dx, dy) from the ship.
function fight(id, bt, at = null) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  p.hp = p.maxHp = 1e9;
  if (id !== 'blaster') { acquireWeapon(p, id); p.loadout = [id]; }
  p.breakthroughs = { [id]: bt };
  g.asteroidManager.asteroids = [];
  g.asteroidManager.getNearbyAsteroids = () => [];
  g.enemyManager.enemies = [];
  const spots = at || Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2, d = 60 + (k % 4) * 40;
    return [Math.cos(a) * d, Math.sin(a) * d];
  });
  for (const [dx, dy] of spots) {
    const e = g.enemyManager.getArchetype('swarmer', 1);
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + dx, y: p.y + dy, vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
  }
  g.autoFire = true;
  g.autoAim = true;
  g.mouse = { x: 0, y: 0, down: false };
  return { g, p };
}

test('every pool transform runs in a live fight, dealing damage without errors, and has its own Pixie line', () => {
  for (const [id, list] of Object.entries(EXTRA_TRANSFORMS)) {
    for (const t of list) {
      const { g } = fight(id, { [t.home]: t.id });
      for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
      assert.ok(g.enemyManager.enemies.some((e) => e.hp < e.maxHp), `${id}:${t.id} dealt no damage`);
      assert.ok(PIXIE_PICK_LINES[`${id}:${t.id}`], `${id}:${t.id} needs a Pixie line`);
    }
  }
});

test('Tracer Slugs: every fourth volley is slugs, slugMult harder with more pierce', () => {
  const { g, p } = fight('blaster', { 6: 'slug' });
  g.bullets = [];
  const vols = [];
  for (let k = 0; k < 8; k++) {
    const before = g.bullets.length;
    g.firePrimaryWeapon();
    vols.push(g.bullets.slice(before));
  }
  const plain = vols[0][0];
  for (const [k, v] of vols.entries()) {
    const slug = (k + 1) % W.slugEvery === 0;
    for (const bolt of v) {
      assert.equal(!!bolt.bx?.slug, slug, `volley ${k + 1}`);
      if (slug) {
        assert.ok(Math.abs(bolt.damage / plain.damage - W.slugMult) < 1e-9);
        assert.equal(bolt.pierce, plain.pierce + W.slugPierce);
      }
    }
  }
  assert.ok(p);
});

test('Hot Barrel heats from bolts that hit (up to +hotRateMax fire rate); misses and lulls cool it', () => {
  const { g, p } = fight('blaster', { 12: 'hotbarrel' });
  const b = weaponBuild(p, 'blaster');
  const bolt = () => BTX.shapeBlasterBolt(g, b, { hue: 186, radius: 4, damage: 1, pierce: 1 }, false, 2);
  // Firing alone never heats it: only landed bolts do.
  let mult = 1;
  for (let t = 0; t < 600; t++) mult = BTX.hotBarrelRate(g, 1 / 60, b);
  assert.equal(mult, 1, 'firing without hitting stays cold');
  for (let k = 0; k < Math.ceil(2 / W.hotPerHit); k++) BTX.hotBoltHit(g, bolt()); // two streams: half a volley each
  assert.ok(Math.abs(BTX.hotBarrelRate(g, 1 / 60, b) - (1 + W.hotRateMax)) < 1e-9, 'full heat');
  assert.ok(bolt().hue < 60, 'white-hot orange bolts');
  const once = bolt();
  BTX.hotBoltHit(g, once);
  g.barrelHeat = 0.5;
  BTX.hotBoltHit(g, once);
  assert.equal(g.barrelHeat, 0.5, 'a piercing bolt heats once');
  BTX.hotBoltMiss(g, bolt());
  assert.ok(Math.abs(g.barrelHeat - (0.5 - W.hotMissVent / 2)) < 1e-9, 'a miss vents its share');
  for (let t = 0; t < (W.hotGrace + W.hotCool) * 60 + 2; t++) mult = BTX.hotBarrelRate(g, 1 / 60, b);
  assert.equal(mult, 1, 'a lull with no hits cools it');
  // Without the transform nothing changes.
  const { g: g2, p: p2 } = fight('blaster', { 12: 'transform' });
  assert.equal(BTX.hotBarrelRate(g2, 1, weaponBuild(p2, 'blaster')), 1);
  // Live: a close target heats the barrel and it fires faster; a target out of reach leaves it cold.
  const run = (bt, at) => {
    const { g: gg } = fight('blaster', bt, at);
    gg.enemyManager.update = () => {};
    let n = 0;
    const fire = gg.firePrimaryWeapon.bind(gg);
    gg.firePrimaryWeapon = () => { n++; fire(); };
    for (let i = 0; i < 60 * 5; i++) gg.update(1 / 60);
    return { n, heat: gg.barrelHeat || 0 };
  };
  assert.ok(run({ 12: 'hotbarrel' }, [[150, 0]]).n > run({ 12: 'boost' }, [[150, 0]]).n * 1.25, 'hits heat it up');
  assert.ok(run({ 12: 'hotbarrel' }, [[2000, 0]]).heat < 0.05, 'nothing in reach: no heat');
});

test('Shrapnel Shells: a rocket hit sprays shellShards shards that skip the enemy it hit', () => {
  const { g, p } = fight('rockets', { 6: 'shrapnel' }, [[150, 0]]);
  const e = g.enemyManager.enemies[0];
  const r = BTX.shapeRocket(weaponBuild(p, 'rockets'), { damage: 10, source: 'rocket' });
  g.bullets = [];
  BTX.rocketBurst(g, r, e, e.x, e.y);
  assert.equal(g.bullets.length, W.shellShards);
  for (const s of g.bullets) {
    assert.ok(s.hitEnemies.has(e));
    assert.ok(Math.abs(s.damage - 10 * W.shellShare) < 1e-9);
    assert.equal(s.kind, 'shrapnel');
  }
});

test('Rolling Thunder: a rocket drops up to thunderMax charges along its path, each blowing after thunderDelay', () => {
  const { g, p } = fight('rockets', { 18: 'thunder' }, [[2000, 2000]]);
  g.weaponFx.events = [];
  const r = BTX.shapeRocket(weaponBuild(p, 'rockets'), { x: p.x, y: p.y, damage: 10, blastRadius: 50, source: 'rocket' });
  for (let i = 0; i < 120; i++) { r.x += 5; BTX.rocketFlight(g, r, 1 / 60); }
  const charges = g.weaponFx.events.filter((ev) => ev.style === 'charge');
  assert.equal(charges.length, W.thunderMax);
  assert.ok(charges.every((c) => Math.abs(c.damage - 10 * W.thunderShare) < 1e-9 && c.delay === W.thunderDelay));
  assert.ok(charges[1].x > charges[0].x, 'dropped along the path, in order');
});

test('Hunter-Killer: a missile blast launches one hunter at the nearest enemy beyond it; hunters launch none', () => {
  const { g, p } = fight('missiles', { 6: 'hunter' }, [[100, 0], [300, 0], [380, 0]]);
  const [near, mid] = g.enemyManager.enemies;
  g.missiles = [];
  const m = BTX.shapeMissile(weaponBuild(p, 'missiles'), { x: near.x, y: near.y, damage: 20, source: 'missile' });
  BTX.missileBlast(g, m, 75);
  assert.equal(g.missiles.length, 1);
  const hunter = g.missiles[0];
  assert.equal(hunter.target, mid, 'the nearest enemy outside the blast');
  assert.ok(Math.abs(hunter.damage - 20 * W.hunterShare) < 1e-9);
  BTX.missileBlast(g, { ...hunter, hunterArmed: true }, 45);
  assert.equal(g.missiles.length, 1, 'no hunter from a hunter');
});

test('Echo Salvo: a half-strength repeat follows each salvo, never echoes itself and never counts toward the nuke', () => {
  const { g, p } = fight('missiles', { 12: 'echo', 18: 'transform' }, [[200, 0], [220, 40]]);
  g.missiles = [];
  g.weaponFx.events = [];
  g.missileSalvos = 0;
  const b = weaponBuild(p, 'missiles');
  g.fireSwarmMissiles(b);
  const first = g.missiles.slice();
  const timers = g.weaponFx.events.filter((e) => e.style === 'silent');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, W.echoDelay);
  g.missiles = [];
  timers[0].after(g, timers[0]);
  assert.equal(g.missiles.length, first.length);
  assert.ok(g.missiles.every((m) => m.echo && Math.abs(m.damage - first[0].damage * W.echoShare) < 1e-9));
  assert.equal(g.weaponFx.events.filter((e) => e.style === 'silent').length, 1, 'the echo schedules no echo');
  assert.equal(g.missileSalvos, 1, 'echoes don\'t count toward the Tactical Nuke');
});

test('Static Charge: each enemy a lance pierces arcs staticShare of its hit into the nearest enemy off the line', () => {
  // Two on the aim line (straight right), one just off it beside the first.
  const { g, p } = fight('raillance', { 6: 'static' }, [[200, 0], [300, 0], [200, 90]]);
  const [a, b, off] = g.enemyManager.enemies;
  p.angle = 0;
  const hits = new Map();
  const hit = g.hitEnemy.bind(g);
  g.hitEnemy = (e, d, ...r) => { hits.set(e, [...(hits.get(e) || []), d]); return hit(e, d, ...r); };
  g.railLance.fire(g, p, weaponBuild(p, 'raillance'));
  assert.equal(hits.get(a).length, 1);
  assert.ok(hits.get(off), 'the enemy beside the line takes an arc');
  const first = hits.get(a)[0];
  assert.ok(hits.get(off).some((d) => Math.abs(d - first * W.staticShare) < 1e-6), 'an arc carries staticShare of the hit');
  assert.ok(b);
});

test('Reflector Rail: the lance bounces off the screen edge and sweeps back at reflectShare', () => {
  const { g, p } = fight('raillance', { 18: 'reflect' }, [[200, 0]]);
  g.camX = p.x - g.width / 2;
  g.camY = p.y - g.height / 2;
  p.angle = -Math.PI / 4; // up and to the right: it meets the top edge first
  const before = g.railLance.beamCount;
  g.railLance.fire(g, p, weaponBuild(p, 'raillance'));
  const beams = g.railLance.beams.slice(0, Math.max(0, g.railLance.beamCount - before) || 2);
  const back = beams.find((ln) => ln.dy > 0);
  assert.ok(back, 'a reflected beam heads back down');
  assert.ok(Math.abs(back.y1 - g.camY) < 4, 'it starts on the top edge');
  assert.ok(back.dx > 0, 'and keeps travelling right');
});

test('Overdrive Sync: the formation fires overdriveMult x as fast for overdriveTime of every overdriveEvery s', () => {
  const { g, p } = fight('drones', { 6: 'overdrive' });
  const dep = g.deployables;
  const lv = weaponBuild(p, 'drones');
  let on = 0;
  const steps = Math.round(W.overdriveEvery * 60) * 2;
  for (let i = 0; i < steps; i++) if (BTX.droneOverdrive(dep, 1 / 60, lv, g, dep.drones, 0) === W.overdriveMult) on++;
  assert.ok(Math.abs(on / steps - W.overdriveTime / W.overdriveEvery) < 0.02);
  const { g: g2, p: p2 } = fight('drones', { 6: 'boost' });
  assert.equal(BTX.droneOverdrive(g2.deployables, 1, weaponBuild(p2, 'drones'), g2, [], 0), 1);
});

test('Kamikaze Wing: a drone dives on the densest pack, blows, and relaunches from the hull', () => {
  // A tight pack of 5 to one side, a lone enemy the other.
  const pack = [[220, 0], [235, 12], [230, -14], [245, 4], [215, 10]];
  const { g, p } = fight('drones', { 12: 'kamikaze' }, [...pack, [-200, 0]]);
  const lone = g.enemyManager.enemies[5];
  for (let i = 0; i < 60; i++) g.update(1 / 60); // the drones launch and dock
  const dep = g.deployables;
  dep.kamiT = W.kamikazeEvery;
  BTX.droneKamikazeTick(dep, 0, weaponBuild(p, 'drones'), g, dep.drones, dep.droneCount);
  const diver = dep.drones.slice(0, dep.droneCount).find((d) => d.dive);
  assert.ok(diver, 'one drone dives');
  assert.notEqual(diver.dive.target, lone, 'on the pack, not the lone enemy');
  const hp = g.enemyManager.enemies.slice(0, 5).map((e) => e.hp);
  for (let i = 0; i < 60 && diver.dive; i++) BTX.droneDive(g, diver, 1 / 60, 1000);
  assert.equal(diver.dive, null);
  assert.ok(diver.launch > 0, 'back in the hangar, relaunching');
  assert.ok(g.enemyManager.enemies.slice(0, 5).filter((e, k) => e.hp < hp[k]).length >= 3, 'the blast hits the pack');
});

test('Parting Gift: an expiring turret blows for giftBolts of its bolts', () => {
  const { g, p } = fight('turret', { 6: 'gift' }, [[40, 0], [0, 50]]);
  const lv = weaponBuild(p, 'turret');
  const dmg = [];
  g.damageEnemiesInRadius = (x, y, r, d) => dmg.push(d);
  BTX.turretGift(g, { x: p.x, y: p.y }, lv, 10);
  assert.deepEqual(dmg, [10 * W.giftBolts]);
  BTX.turretGift(g, { x: p.x, y: p.y }, weaponBuild(Object.assign({}, p, { breakthroughs: {} }), 'turret'), 10);
  assert.equal(dmg.length, 1, 'no blast without the transform');
});

test('Overwatch Link: two turrets in range zap an enemy standing between them, once per linkTick', () => {
  const { g, p } = fight('turret', { 12: 'link' }, [[100, 0], [100, 200]]);
  const [mid, away] = g.enemyManager.enemies;
  const lv = weaponBuild(p, 'turret');
  const turrets = [{ x: p.x, y: p.y }, { x: p.x + 200, y: p.y }];
  const hits = [];
  g.hitEnemy = (e, d) => hits.push([e, d]);
  const state = {};
  BTX.turretLinks(state, 1 / 60, g, turrets, 2, lv, 10);
  assert.deepEqual(hits, [[mid, 10 * W.linkShare]]);
  BTX.turretLinks(state, 1 / 60, g, turrets, 2, lv, 10);
  assert.equal(hits.length, 1, 'next zap only after linkTick');
  turrets[1].x = p.x + W.linkRange + 50;
  state.linkT = 0;
  BTX.turretLinks(state, 1 / 60, g, turrets, 2, lv, 10);
  assert.equal(hits.length, 1, 'out of range: no link');
  assert.ok(away);
});

test('Arc Discs: a ricochet arcs arcDiscShare of the hit back into the enemy the disc left', () => {
  const { g, p } = fight('glaive', { 12: 'arcdisc' }, [[100, 0], [180, 0]]);
  const [prev, e] = g.enemyManager.enemies;
  const hits = [];
  g.hitEnemy = (x, d) => hits.push([x, d]);
  BTX.glaiveArc(g, weaponBuild(p, 'glaive'), prev, e, 10);
  assert.deepEqual(hits, [[prev, 10 * W.arcDiscShare]]);
  BTX.glaiveArc(g, weaponBuild(p, 'glaive'), e, e, 10);
  assert.equal(hits.length, 1, 'no arc onto itself');
});

test('Shatter Edge: a fading disc bursts into shatterShards shards at shatterShare', () => {
  const { g, p } = fight('glaive', { 6: 'shatter' }, [[400, 400]]);
  g.bullets = [];
  BTX.glaiveShatter(g, weaponBuild(p, 'glaive'), { x: p.x, y: p.y }, 10);
  assert.equal(g.bullets.length, W.shatterShards);
  assert.ok(g.bullets.every((s) => s.kind === 'shrapnel' && s.source === 'glaive' && Math.abs(s.damage - 10 * W.shatterShare) < 1e-9));
});

test('Crush Field and Gravity Lens: a main shell leaves a crushing pool; in flight it drags enemies toward its landing', () => {
  const { g, p } = fight('quake', { 6: 'crush', 12: 'lens' }, [[300, 0]]);
  const e = g.enemyManager.enemies[0];
  const b = weaponBuild(p, 'quake');
  g.weaponFx.pools = [];
  BTX.quakeCrush(g, b, e.x, e.y, 120, 10);
  assert.equal(g.weaponFx.pools.length, 1);
  const pool = g.weaponFx.pools[0];
  assert.ok(Math.abs(pool.damage * (W.crushLife / W.crushTick) - 10 * W.crushShare) < 1e-9, 'crushShare of the ring over its life');
  const s = { lx: e.x + 100, ly: e.y, radius: 120 };
  const x0 = e.x;
  for (let i = 0; i < 30; i++) BTX.quakeLens(g, b, s, 1 / 60);
  assert.ok(e.x > x0 + 30, 'dragged toward the landing point');
});

test('Sticky Plasma: a grenade landing by an enemy rides it and hits it stickyShare more; Plasma Geyser erupts geyserBursts times', () => {
  const { g } = fight('grenades', { 6: 'sticky', 18: 'geyser' }, [[100, 0]]);
  const e = g.enemyManager.enemies[0];
  const gr = { x: e.x + 20, y: e.y, sticky: true, geyser: true, damage: 10, radius: 90, hue: 300 };
  BTX.grenadeStick(g, gr);
  assert.equal(gr.stuck, e);
  e.x += 50;
  BTX.grenadeRide(gr);
  assert.ok(Math.abs(gr.x - (e.x + gr.stickDx)) < 1e-9, 'rides along');
  const hits = [];
  g.hitEnemy = (x, d) => hits.push([x, d]);
  g.weaponFx.events = [];
  BTX.grenadeBlast(g, gr);
  assert.deepEqual(hits, [[e, 10 * W.stickyShare]]);
  const vents = g.weaponFx.events.filter((ev) => ev.style === 'charge');
  assert.equal(vents.length, W.geyserBursts);
  assert.ok(vents.every((v, k) => v.delay === W.geyserGap * (k + 1) && Math.abs(v.damage - 10 * W.geyserShare) < 1e-9));
});

test('Shock Mines stun what the blast hits; Napalm Mines leave a pool worth napalmMineShare', async () => {
  const { isStunned } = await import('../js/status-effects.js');
  const { g } = fight('mines', { 6: 'shock', 12: 'napalm' }, [[60, 0], [600, 0]]);
  const [near, far] = g.enemyManager.enemies;
  g.weaponFx.pools = [];
  BTX.mineBlast(g, { x: near.x - 30, y: near.y, blast: 120, damage: 10, shock: true, napalm: true });
  assert.ok(isStunned(near), 'stunned');
  assert.ok(!isStunned(far), 'out of the blast: not stunned');
  const pool = g.weaponFx.pools[0];
  assert.ok(Math.abs(pool.damage * (W.napalmMineLife / W.napalmMineTick) - 10 * W.napalmMineShare) < 1e-9);
});

test('Blade Frenzy builds with hits up to +frenzyMax and cools; Vortex Ring drags enemies onto the ring', () => {
  const { g, p } = fight('orbitals', { 6: 'frenzy', 12: 'vortex' }, [[220, 0], [600, 0]]);
  const b = weaponBuild(p, 'orbitals');
  const s = {};
  for (let i = 0; i < 100; i++) BTX.frenzyHit(s, b);
  assert.ok(Math.abs(BTX.frenzyMult(s, 0, b) - (1 + W.frenzyMax)) < 1e-9, 'capped at full heat');
  BTX.frenzyMult(s, 10, b);
  assert.equal(BTX.frenzyMult(s, 0, b), 1, 'cooled off');
  const [inBand, outside] = g.enemyManager.enemies;
  const d0 = Math.hypot(inBand.x - p.x, inBand.y - p.y);
  for (let i = 0; i < 30; i++) BTX.orbitalVortex(g, 1 / 60, b, p.x, p.y, 160);
  const d1 = Math.hypot(inBand.x - p.x, inBand.y - p.y);
  assert.ok(d1 < d0 && d1 >= 158, 'dragged onto the ring, not past it');
  assert.equal(Math.hypot(outside.x - p.x, outside.y - p.y), 600, 'outside the band: untouched');
});

test('Accretion Disk flings homing debris at enemies in the pull; White Hole schedules an outward blast after the collapse', () => {
  const { g, p } = fight('singularity', { 6: 'accretion', 18: 'whitehole' }, [[60, 0], [900, 0]]);
  const [inPull, far] = g.enemyManager.enemies;
  const sg = { x: p.x, y: p.y, radius: 22, pullRadius: 250, accretion: 7, whiteHole: 40, accretionT: 0 };
  g.bullets = [];
  BTX.singularityAccretion(g, sg, 1 / 60);
  assert.equal(g.bullets.length, 1);
  assert.equal(g.bullets[0].target, inPull, 'in the pull when nobody stands just outside it');
  assert.equal(g.bullets[0].damage, 7);
  g.weaponFx.events = [];
  BTX.whiteHole(g, sg, 200);
  const ev = g.weaponFx.events[0];
  assert.equal(ev.style, 'whitehole');
  assert.equal(ev.damage, 40);
  assert.ok(Math.abs(ev.radius - 200 * W.whiteRadiusMult) < 1e-9);
  assert.ok(far);
});

test('Nano Needles fire at the nearest enemy outside each swarm; Ravenous Swarm bites up to 1 + ravenousMax by the end of its life', () => {
  const { g } = fight('nanites', { 6: 'needles', 12: 'ravenous' }, [[150, 0]]);
  const e = g.enemyManager.enemies[0];
  const swarm = { x: e.x - 120, y: e.y, r: 60, age: 0, life: 4 };
  g.bullets = [];
  BTX.naniteNeedles(g, [swarm], 1, 1 / 60, { needles: true }, 10);
  assert.equal(g.bullets.length, 1);
  assert.ok(Math.abs(g.bullets[0].damage - 10 * W.needleMult) < 1e-9);
  assert.ok(g.bullets[0].vx > 0, 'toward the enemy');
  const st = { ravenous: true };
  assert.equal(BTX.ravenousBite(st, swarm), 1);
  swarm.age = 4;
  assert.equal(BTX.ravenousBite(st, swarm), 1 + W.ravenousMax);
  assert.equal(BTX.ravenousBite({}, swarm), 1);
});

test('Pulse Wave hits enemies past the field (not inside); Capacitor Bank fires a second, half-strength discharge', () => {
  const { g, p } = fight('shockfield', { 6: 'pulse', 12: 'capacitor' }, [[60, 0], [200, 0], [600, 0]]);
  const [inside, ring, far] = g.enemyManager.enemies;
  const b = weaponBuild(p, 'shockfield');
  const hits = [];
  const hit = g.hitEnemy.bind(g);
  g.hitEnemy = (e, d, ...r) => { hits.push([e, d]); return hit(e, d, ...r); };
  g.weaponFx.events = [];
  BTX.fieldAfter(g, g.shockField, b, 125, 10);
  const timers = g.weaponFx.events.filter((e) => e.style === 'silent');
  assert.equal(timers.length, 2);
  timers.find((t) => t.delay === W.pulseDelay).after(g);
  assert.deepEqual(hits.map(([e, d]) => [e, d]), [[ring, 10 * W.pulseShare]], 'the wave hits only between the field and its reach');
  hits.length = 0;
  g.shockField.radius = 125;
  timers.find((t) => t.delay === W.capDelay).after(g);
  assert.deepEqual(hits, [[inside, 10 * W.capShare]], 'the second discharge hits what is inside');
  assert.ok(far);
});

test('Toxic Tendrils lash the nearest enemy outside a cloud; Spore Burst pops a fading cloud at most every SPORE_GAP', () => {
  const { g } = fight('gas', { 6: 'tendrils', 12: 'spores' }, [[150, 0]]);
  const e = g.enemyManager.enemies[0];
  const gas = { tendrils: true, spores: true, damage: 4, count: 1, puffs: [{ x: e.x - 100, y: e.y, r: 40, radius: 46 }], time: 10 };
  const hits = [];
  g.hitEnemy = (x, d) => hits.push([x, d]);
  BTX.gasTendrils(g, gas);
  assert.deepEqual(hits, [[e, 4 * W.tendrilShare]]);
  g.weaponFx.events = [];
  BTX.gasSpore(g, gas, gas.puffs[0]);
  BTX.gasSpore(g, gas, gas.puffs[0]);
  assert.equal(g.weaponFx.events.length, 1, 'one pop per SPORE_GAP');
  assert.equal(g.weaponFx.events[0].damage, 4 * W.sporeMult);
  gas.time += BTX.SPORE_GAP;
  BTX.gasSpore(g, gas, gas.puffs[0]);
  assert.equal(g.weaponFx.events.length, 2);
});

test('Sprayer Whirl adds one fast full turn every whirlEvery s; Seeker swings the nozzle toward the pack', () => {
  const { g, p } = fight('flamethrower', { 6: 'whirl' }, [[150, 0]]);
  const b = weaponBuild(p, 'flamethrower');
  const sp = { swivel: 0, kind: { hue: 28, ringHue2: 46, sound: 'flame' } };
  let turned = 0;
  const steps = Math.round(W.whirlEvery * 60);
  for (let i = 0; i < steps; i++) turned += BTX.sprayTurn(sp, g, p, b, 1 / 60, 280);
  const base = W.flameTurnRate(b) * W.whirlEvery;
  assert.ok(Math.abs(turned - base - Math.PI * 2) < 0.15, `one extra turn per cycle (${(turned - base).toFixed(2)} rad)`);
  // Seeker: with the pack due south, the nozzle swings there and holds.
  const { g: g2, p: p2 } = fight('flamethrower', { 12: 'seeker' }, [[0, 150], [10, 160], [-10, 160]]);
  const b2 = weaponBuild(p2, 'flamethrower');
  const s2 = { swivel: 0, kind: { hue: 28, ringHue2: 46, sound: 'flame' } };
  for (let i = 0; i < 120; i++) s2.swivel += BTX.sprayTurn(s2, g2, p2, b2, 1 / 60, 280);
  assert.ok(Math.abs(s2.swivel - Math.PI / 2) < 0.15, `nozzle on the pack (${s2.swivel.toFixed(2)})`);
});

test('Arc Lattice zaps what crosses a chain line latticeZaps times; Conductor arcs a charged kill into its neighbours', () => {
  const { g, p } = fight('lightning', { 6: 'lattice', 12: 'conductor' }, [[100, 0], [200, 4], [260, 40]]);
  const [a, onLine, nb] = g.enemyManager.enemies;
  const b = weaponBuild(p, 'lightning');
  const hits = [];
  g.hitEnemy = (e, d) => hits.push([e, d]);
  g.weaponFx.events = [];
  BTX.arcLattice(g, b, [p.x, p.y, p.x + 300, p.y], 10);
  const zaps = g.weaponFx.events.filter((e) => e.style === 'silent');
  assert.equal(zaps.length, W.latticeZaps);
  zaps[0].after(g);
  assert.ok(hits.some(([e, d]) => e === onLine && Math.abs(d - 10 * W.latticeShare) < 1e-9), 'the live wire zaps what lies on it');
  assert.ok(!hits.some(([e]) => e === nb), 'off the line: untouched');
  hits.length = 0;
  g.weaponFx.events = [];
  BTX.conductorCharge(g, b, a, 10);
  BTX.conductorDeath(g, a);
  g.weaponFx.events[0].after(g);
  assert.equal(hits.length, W.conductArcs);
  assert.ok(hits.every(([, d]) => Math.abs(d - 10 * W.conductShare) < 1e-9));
  g.weaponFx.events = [];
  BTX.conductorDeath(g, a);
  assert.equal(g.weaponFx.events.length, 0, 'a charge discharges once');
});
