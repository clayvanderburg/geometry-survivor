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

test('Hot Barrel heats while firing (up to +hotRateMax fire rate), cools when you stop', () => {
  const { g, p } = fight('blaster', { 12: 'hotbarrel' });
  const b = weaponBuild(p, 'blaster');
  let mult = 1;
  for (let t = 0; t < W.hotHeatUp * 60 + 2; t++) mult = BTX.hotBarrelRate(g, 1 / 60, true, b);
  assert.ok(Math.abs(mult - (1 + W.hotRateMax)) < 1e-9, 'full heat');
  const hot = BTX.shapeBlasterBolt(g, b, { hue: 186, radius: 4, damage: 1, pierce: 1 }, false);
  assert.ok(hot.hue < 60, 'white-hot orange bolts');
  for (let t = 0; t < W.hotCool * 60 + 2; t++) mult = BTX.hotBarrelRate(g, 1 / 60, false, b);
  assert.equal(mult, 1, 'cold again');
  // Without the transform nothing changes.
  const { g: g2, p: p2 } = fight('blaster', { 12: 'transform' });
  assert.equal(BTX.hotBarrelRate(g2, 1, true, weaponBuild(p2, 'blaster')), 1);
  // Live: firing for a few seconds fires faster than the cold rate.
  const shots = (bt) => {
    const { g: gg } = fight('blaster', bt, [[900, 0]]);
    let n = 0;
    const fire = gg.firePrimaryWeapon.bind(gg);
    gg.firePrimaryWeapon = () => { n++; fire(); };
    for (let i = 0; i < 60 * 5; i++) gg.update(1 / 60);
    return n;
  };
  assert.ok(shots({ 12: 'hotbarrel' }) > shots({ 12: 'boost' }) * 1.25);
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
