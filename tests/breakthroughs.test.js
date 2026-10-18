import test from 'node:test';
import assert from 'node:assert/strict';

// Weapon Breakthroughs at LV 4 / 8 / 12: when they trigger, what they record, and that every transform
// actually runs in the live game (damage dealt, nothing thrown).
const h = await import('../tools/balance/harness.mjs');
const { UPGRADE_BY_ID, applyUpgradeLevels, acquireWeapon, pendingBreakthroughs, applyBreakthrough, discardWeapon } = await import('../js/upgrades.js');
const { STAT_CARDS, TRANSFORMS, milestonesCrossed, rdLine, RD_LINES, BREAKTHROUGH_LEVELS } = await import('../js/weapon-levels.js');
const { describeBreakthrough } = await import('../js/upgrade-cards.js');

function freshGame() {
  const g = h.createHeadlessGame();
  g.resetRun();
  g.state = 'PLAYING';
  return g;
}

test('milestones are crossed once each, even when a rolled jump leaps over one', () => {
  assert.deepEqual(milestonesCrossed(3, 4), [4]);
  assert.deepEqual(milestonesCrossed(3, 6), [4]);
  assert.deepEqual(milestonesCrossed(7, 12), [8, 12]);
  assert.deepEqual(milestonesCrossed(4, 7), []);
  assert.deepEqual(BREAKTHROUGH_LEVELS, [4, 8, 12]);
});

test('a +5 card that leaps past LV 4 and LV 8 queues both Breakthroughs, lowest first', () => {
  const g = freshGame();
  const p = g.player;
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.blaster_damage, levelJump: 2 }); // LV 3
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.firerate, levelJump: 5 });      // LV 8
  assert.deepEqual(pendingBreakthroughs(p, 'blaster'), [4, 8]);
  g.state = 'UPGRADE';
  g.closeUpgradeModal();
  assert.equal(g.handPhase, 'breakthrough');
  assert.deepEqual(g.breakthrough, { weaponId: 'blaster', level: 4 });
  g.selectUpgrade(1); // ACROSS THE BOARD
  assert.equal(g.handPhase, 'breakthrough', 'the LV 8 Breakthrough follows at once');
  assert.deepEqual(g.breakthrough, { weaponId: 'blaster', level: 8 });
  g.selectUpgrade(0);
  assert.deepEqual(p.breakthroughs.blaster, { 4: 'boost', 8: 'transform' });
  assert.equal(g.state, 'PLAYING');
  assert.deepEqual(pendingBreakthroughs(p, 'blaster'), []);
});

test('Breakthrough cards name their weapon, show the DPS gain, and are one-shot', () => {
  const p = freshGame().player;
  acquireWeapon(p, 'singularity');
  applyUpgradeLevels(p, { ...UPGRADE_BY_ID.singularity_pull, levelJump: 3 });
  const t = describeBreakthrough(p, 'singularity', 4, 'transform');
  const b = describeBreakthrough(p, 'singularity', 4, 'boost');
  assert.equal(t.name, 'Twin Singularities');
  assert.equal(t.category, 'VORTEX SINGULARITY');
  assert.match(t.summary, /Vortex Singularity/);
  assert.match(t.headline, /\+22% DPS/);
  assert.match(b.summary, /Vortex Singularity/);
  assert.ok(Math.abs(b.dpsGain - 0.18) < 1e-6, 'Across the Board: +18% damage, plus utility ranks');
  assert.equal(applyBreakthrough(p, 'singularity', 4, 'transform'), true);
  assert.equal(applyBreakthrough(p, 'singularity', 4, 'boost'), false, 'one choice per milestone');
  discardWeapon(p, 'singularity');
  assert.equal(p.breakthroughs.singularity, undefined, 'a discard drops its Breakthroughs');
});

test('every transform names its weapon in the summary', () => {
  const NAMES = { blaster: 'Autocannon', rockets: 'Wing Rocket', missiles: 'Swarm Missile', lightning: 'Tesla Arc', singularity: 'Vortex Singularit',
    orbitals: 'Orbit Blade', mines: 'Proximity Mines', turret: 'Sentry Turret', drones: 'Escort Drone' };
  for (const [id, byLevel] of Object.entries(TRANSFORMS)) {
    for (const m of BREAKTHROUGH_LEVELS) assert.match(byLevel[m].summary, new RegExp(NAMES[id]), `${id} LV ${m}`);
  }
  assert.equal(rdLine(0, 'Tesla Arc Emitter').includes('Tesla Arc Emitter'), true);
  assert.equal(rdLine(-1, 'X'), RD_LINES.at(-1).replace('{weapon}', 'X'));
});

test('every weapon runs with all three transforms in a live fight, dealing damage without errors', () => {
  for (const id of Object.keys(STAT_CARDS)) {
    const g = freshGame();
    const p = g.player;
    p.invuln = 1e9;
    p.hp = p.maxHp = 1e9;
    if (id !== 'blaster') { acquireWeapon(p, id); p.loadout = [id]; } // only this weapon fires
    p.breakthroughs = { [id]: { 4: 'transform', 8: 'transform', 12: 'transform' } };
    // A dense pack right next to the ship so every weapon finds targets.
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const e = g.enemyManager.getArchetype('swarmer', 1);
      g.enemyManager.enemies.push(Object.assign(e, { x: p.x + Math.cos(a) * (60 + (k % 4) * 40), y: p.y + Math.sin(a) * (60 + (k % 4) * 40),
        vx: 0, vy: 0, hp: 1e7, maxHp: 1e7, trail: e.trail || [] }));
    }
    g.autoFire = true;
    g.autoAim = true;
    g.mouse = { x: 0, y: 0, down: false };
    for (let i = 0; i < 60 * 8; i++) g.update(1 / 60);
    const hurt = g.enemyManager.enemies.filter((e) => e.hp < e.maxHp).length;
    assert.ok(hurt > 0, `${id} with all transforms dealt no damage`);
  }
});
