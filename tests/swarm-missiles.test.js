import test from 'node:test';
import assert from 'node:assert/strict';

// Swarm Missiles: a real targeting range, one target per missile, rock stops them, sympathetic
// detonation, and the orange -> pink Storm Protocol colour.
const h = await import('../tools/balance/harness.mjs');
const { acquireWeapon } = await import('../js/upgrades.js');
const { WEAPON_SCALING: W } = await import('../js/weapon-scaling.js');

function fight(enemyAt = []) {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  const p = g.player;
  p.invuln = 1e9;
  acquireWeapon(p, 'missiles');
  p.loadout = ['missiles'];
  g.asteroidManager.asteroids = [];
  g.asteroidManager.getNearbyAsteroids = () => [];
  g.enemyManager.enemies = [];
  for (const [dx, dy] of enemyAt) {
    const e = g.enemyManager.getArchetype('swarmer', 1);
    g.enemyManager.enemies.push(Object.assign(e, { x: p.x + dx, y: p.y + dy, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, trail: [] }));
  }
  return g;
}

test('each missile in a salvo locks a different enemy in range', () => {
  const g = fight([[200, 0], [0, 220], [-240, 0], [0, -260], [300, 300]]);
  g.fireSwarmMissiles();
  const targets = new Set(g.missiles.map((m) => m.target));
  assert.equal(targets.size, g.missiles.length, 'no doubling up while there are enough enemies');
});

test('missiles only fire at enemies within missileRange, and never chase past it', () => {
  const far = fight([[W.missileRange + 200, 0]]);
  assert.equal(far.missileTargets(far.player, 3).length, 0);
  far.missileTimer = 0;
  far.update(1 / 60);
  assert.equal(far.missiles.length, 0, 'nothing in range: no salvo');
  const near = fight([[W.missileRange - 50, 0]]);
  assert.equal(near.missileTargets(near.player, 3).length, 1);
  assert.ok(W.missileLife * W.missileSpeed * 60 < 1100, 'flight time caps how far a missile can travel');
});

test('a missile whose target died bursts where it was instead of hunting a new one', () => {
  const g = fight([[300, 0], [-300, 0]]);
  g.fireSwarmMissiles();
  const m = g.missiles.find((x) => x.target === g.enemyManager.enemies[0]);
  g.enemyManager.enemies[0].dead = true;
  const aim = { x: m.aimX, y: m.aimY };
  for (let i = 0; i < 120 && g.missiles.includes(m); i++) g.update(1 / 60);
  assert.ok(!g.missiles.includes(m), 'detonated');
  assert.deepEqual({ x: m.aimX, y: m.aimY }, aim, 'kept the dead target spot');
});

test('asteroids stop missiles, and a blast sets off missiles inside it', () => {
  const g = fight([[400, 0]]);
  const p = g.player;
  const rock = { x: p.x + 60, y: p.y, radius: 30, hp: 100 };
  g.asteroidManager.getNearbyAsteroids = () => [rock];
  g.missiles.push({ x: rock.x - 31, y: rock.y, vx: 1, vy: 0, speed: 1, damage: 1, blastRadius: 75, hue: 42, trail: [], life: 1, source: 'missile', target: null, aimX: rock.x, aimY: rock.y });
  g.missiles.push({ x: rock.x - 31 - 40, y: rock.y + 300, vx: 0, vy: 0, speed: 0.01, damage: 1, blastRadius: 75, hue: 42, trail: [], life: 1, source: 'missile', target: null, aimX: 0, aimY: 0 });
  g.missiles.push({ x: rock.x - 60, y: rock.y + 10, vx: 0, vy: 0, speed: 0.01, damage: 1, blastRadius: 75, hue: 42, trail: [], life: 1, source: 'missile', target: null, aimX: p.x - 500, aimY: p.y });
  for (let i = 0; i < 2; i++) g.update(1 / 60);
  assert.equal(g.missiles.length, 1, 'the rock hit and the one caught in its blast are gone; the far one flies on');
});

test('Swarm Missiles are orange-gold, and turn pink with Storm Protocol', () => {
  const g = fight([[200, 0]]);
  g.fireSwarmMissiles();
  assert.ok(g.missiles.every((m) => m.hue === 42));
  g.player.weapons.stormProtocol = 1;
  g.missiles = [];
  g.fireSwarmMissiles();
  assert.ok(g.missiles.every((m) => m.hue === 325));
});

test('Cluster Bomblets hop onto enemies past the blast, one each, and scatter the rest', () => {
  const g = fight([[0, 0], [130, 0], [-130, 0], [0, 400]]);
  const [hub, east, west] = g.enemyManager.enemies;
  const blast = 75;
  g.weaponFx.hop(g, hub.x, hub.y, W.clusterBomblets, blast * 0.75, blast * W.clusterSpread, 32, 10, W.clusterDelay, 40, 'missile');
  const pops = g.weaponFx.events;
  const on = (e) => pops.filter((ev) => ev.x === e.x && ev.y === e.y).length;
  assert.equal(pops.length, W.clusterBomblets);
  assert.equal(on(east), 1, 'one bomblet on the enemy east of the blast');
  assert.equal(on(west), 1, 'one on the enemy west of it');
  assert.equal(on(hub), 0, 'none on the enemy the blast already hit');
  assert.ok(pops.every((ev) => Math.hypot(ev.x - hub.x, ev.y - hub.y) <= blast * W.clusterSpread + 1e-9), 'the far enemy is out of reach; the rest scatter nearby');
});
