import test from 'node:test';
import assert from 'node:assert/strict';

// Pause-menu run overview: the BASE / PERMANENT / THIS RUN / TOTAL stat split and its formatting, the
// loadout strip, the preview ship pose, and MAIN MENU abandoning a run without recording anything.
const h = await import('../tools/balance/harness.mjs');
const {
  statBreakdown, formatStatValue, formatStatDelta, STAT_GROUPS, runInfo, damageRows, weaponReadout, upgradeGroups, statsHtml
} = await import('../js/run-overview.js');
const { previewShip, shipExtent } = await import('../js/ship-preview.js');
const { runStartPlayer, applyUpgradeLevels, UPGRADE_BY_ID, acquireWeapon, BASE_SHIELD } = await import('../js/upgrades.js');
const { armoryBonuses } = await import('../js/progression.js');
const { TUNING } = await import('../js/config.js');

const install = (p, id, levelJump = 1) => applyUpgradeLevels(p, { ...UPGRADE_BY_ID[id], levelJump });
const rowsById = (p) => Object.fromEntries(statBreakdown(p).flatMap((g) => g.rows).map((r) => [r.id, r]));

function freshGame(ranks = {}) {
  const g = h.createHeadlessGame();
  Object.assign(g.progression.data.ranks, ranks);
  g.resetRun();
  return g;
}

test('resetRun builds the ship from runStartPlayer (TUNING + Void Armory)', () => {
  const ranks = { damage: 4, maxHp: 3, moveSpeed: 2, bombs: 1, dashDistance: 6 };
  const g = freshGame(ranks);
  const start = runStartPlayer(armoryBonuses(ranks));
  assert.deepEqual(g.player.base.stats, start.stats);
  for (const key of ['maxHp', 'dashCooldownMult', 'dashDistanceMult', 'goldMult', 'rerollCostMult']) assert.equal(g.player[key], start[key], key);
  assert.equal(g.player.bombs, 3);
  assert.equal(runStartPlayer({}).stats.damage, TUNING.baseDamage, 'no bonuses: the bare base');
});

test('a fresh ship with no armory ranks: BASE = TOTAL and nothing in PERMANENT or THIS RUN', () => {
  const g = freshGame();
  for (const group of statBreakdown(g.player)) {
    for (const r of group.rows) {
      assert.equal(r.permanent, '—', `${r.id} permanent`);
      assert.equal(r.run, '—', `${r.id} run`);
      assert.equal(r.total, r.base, r.id);
    }
  }
  assert.ok(STAT_GROUPS.flatMap((g) => g.rows).length >= 20, 'damage, rate, crits, area, shield, regen, speed, dash, drills, magnet, xp, luck...');
});

test('Void Armory ranks land in PERMANENT; cards picked this run land in THIS RUN', () => {
  const g = freshGame({ damage: 10, maxHp: 5, critChance: 5, moveSpeed: 5, dashDistance: 10, dash: 10 });
  const p = g.player;
  let r = rowsById(p);
  assert.equal(r.damage.base, String(TUNING.baseDamage));
  assert.equal(r.damage.permanent, '+10%');
  assert.equal(r.maxHp.permanent, '+8');
  assert.equal(r.critChance.base, '5%');
  assert.equal(r.critChance.permanent, '+2%');
  assert.equal(r.moveSpeed.permanent, '+4%');
  assert.equal(r.dashDistance.permanent, '+20%');
  assert.equal(r.dashDistance.up.permanent, true, 'a longer dash is good');
  assert.equal(r.dash.permanent, '−0.15 s');
  for (const id of ['damage', 'maxHp', 'critChance', 'moveSpeed']) assert.equal(r[id].run, '—', `${id}: no cards yet`);

  install(p, 'overdrive', 2);   // x1.12 damage per level
  install(p, 'thrusters');      // +16% speed, a Phase Nova level (dash -0.14 s)
  install(p, 'shield_capacitor'); // +20 shield
  install(p, 'crit_chance', 2); // +5% each
  install(p, 'tag_explosive');
  install(p, 'firerate', 3);    // Autocannon Hyper-Capacitor: lives on the weapon build, not the base stat
  r = rowsById(p);
  assert.equal(r.damage.run, '+25%');
  assert.equal(r.damage.permanent, '+10%', 'the armory share is unchanged by cards');
  assert.equal(r.moveSpeed.run, '+16%');
  assert.equal(r.maxHp.run, '+20');
  assert.equal(r.maxHp.total, String(Math.round(BASE_SHIELD + 7.5 + 20)));
  assert.equal(r.critChance.run, '+10%');
  assert.equal(r.critChance.total, '17%');
  assert.equal(r.tag_explosive.run, '+30%');
  assert.equal(r.dash.run, '−0.13 s', "a Phase Nova level (-0.14 s) after the armory's -10% dash cooldown");
  assert.equal(r.dash.up.run, true);
  assert.match(r.fireRate.run, /^\+\d+%$/, 'fire-rate cards count in THIS RUN');
  assert.equal(r.fireRate.up.run, true);
  assert.equal(r.regen.run, '—', 'nothing changes shield regen');
  // TOTAL = BASE with both changes applied.
  assert.ok(Math.abs(r.damage.values.total - TUNING.baseDamage * 1.1 * 1.12 * 1.12) < 1e-9);
  assert.match(statsHtml(p), /PERMANENT[\s\S]*THIS RUN[\s\S]*TOTAL/);
});

test('stat formatting: percentages, seconds, rates and signed changes', () => {
  assert.equal(formatStatValue('pct', 0.05), '5%');
  assert.equal(formatStatValue('pct', 0.054), '5.4%');
  assert.equal(formatStatValue('pct', 1.375), '138%');
  assert.equal(formatStatValue('sec', 1.5), '1.50 s');
  assert.equal(formatStatValue('rate', 6.5), '6.5/s');
  assert.equal(formatStatValue('rate0', 75), '75/s');
  assert.equal(formatStatValue('x', 1.15), '×1.15');
  assert.equal(formatStatValue('num1', 11), '11');
  assert.equal(formatStatValue('num1', 12.65), '12.7');
  assert.equal(formatStatValue('flat', 124.6), '125');
  assert.equal(formatStatDelta('mult', 'num1', 10, 10), '—');
  assert.equal(formatStatDelta('mult', 'num1', 10, 11.2), '+12%');
  assert.equal(formatStatDelta('mult', 'pct', 1, 1.015), '+1.5%');
  assert.equal(formatStatDelta('mult', 'pct', 1, 0.95), '−5%');
  assert.equal(formatStatDelta('mult', 'num1', 0, 3), '—', 'no ratio from zero');
  assert.equal(formatStatDelta('add', 'pct', 0.05, 0.054), '+0.4%');
  assert.equal(formatStatDelta('add', 'flat', 100, 140), '+40');
  assert.equal(formatStatDelta('add', 'sec', 1.5, 1.36), '−0.14 s');
  assert.equal(formatStatDelta('add', 'hps', 1.2, 1.2), '—');
});

test('weapons, upgrades, damage and run info read the live run', () => {
  const g = freshGame();
  const p = g.player;
  acquireWeapon(p, 'grenades');
  install(p, 'grenades_fire', 2);
  install(p, 'status_potency');
  install(p, 'luck_boost');
  g.runStats.damage('blaster', 300);
  g.runStats.damage('grenade', 100);
  g.runStats.damage('supernova', 100);
  const blaster = weaponReadout(p, 'blaster', g.runStats);
  assert.ok(blaster.potential > 0);
  assert.equal(blaster.dealt, 300);
  assert.equal(blaster.share, 0.6);
  assert.deepEqual(damageRows(g.runStats).map((r) => [r.id, r.dmg]), [['blaster', 300], ['grenades', 100], ['supernova', 100]]);
  assert.deepEqual(upgradeGroups(p).map((x) => [x.label, x.items.map((u) => u.id)]), [['STATUS EFFECTS', ['status_potency']], ['SHIP SYSTEMS & PASSIVES', ['luck_boost']]], 'element cards are weapon levels: they show on the weapon, not here');
  g.wave = 4; g.elapsedTime = 125; g.kills = 37; g.gold = 12;
  const info = Object.fromEntries(runInfo(g).map(([k, v, d]) => [k, [v, d]]));
  assert.deepEqual(info.WAVE, ['4', '02:05']);
  assert.equal(info.KILLS[0], '37');
  assert.equal(info.DAMAGE[0], '500');
  assert.match(info.GOLD[0], /12/);
});

test('preview ship: the player\'s look at the origin, idling (turning, drills spinning, biting now and then)', () => {
  const player = { radius: 15, hp: 40, maxHp: 120, stats: { drillScale: 1.6 } };
  const a = previewShip(player, 0, TUNING);
  const b = previewShip(player, 2, TUNING);
  assert.equal(a.ship.x, 0);
  assert.equal(a.ship.stats.drillScale, 1.6, 'bigger Tectonic drills show');
  assert.equal(a.ship.hp, 40);
  assert.equal(a.ship.invuln, 0, 'never blinks');
  assert.notEqual(a.ship.drillAngle, b.ship.drillAngle);
  assert.ok(b.ship.drillSpin > a.ship.drillSpin);
  assert.equal(a.drilling, false);
  assert.equal(previewShip(player, 4, TUNING).drilling, true);
  assert.ok(previewShip(player, 5, TUNING).ship.drillSpin > previewShip(player, 4.4, TUNING).ship.drillSpin, 'spin never jumps back');
  assert.equal(previewShip(null, 1, TUNING).ship.hp, 100, 'title screen: a fresh ship');
  assert.ok(shipExtent(15, 1.6) > shipExtent(15, 1));
});

// A headless run with the boards, stats upload and local high scores wrapped to count submissions.
function recordedRun() {
  const g = freshGame();
  const posted = [];
  g.globalBoard = { submit: (run) => { posted.push(run); return Promise.resolve({ ok: true }); } };
  g.renderBoards = () => {};
  let uploads = 0;
  g.submitRunStats = function (s) { uploads++; return Object.getPrototypeOf(this).submitRunStats.call(this, s); };
  let records = 0;
  const record = g.progression.recordRun.bind(g.progression);
  g.progression.recordRun = (run) => { records++; return record(run); };
  g.state = 'PLAYING';
  g.spawnWavePack();
  for (let i = 0; i < 180; i++) g.update(1 / 60);
  return { g, posted, counts: () => ({ uploads, records }) };
}

test('MAIN MENU from pause asks first, then abandons the run without recording or submitting it', () => {
  const { g, posted, counts } = recordedRun();
  const coresBefore = g.progression.data.cores;
  const runsBefore = g.progression.data.totalRuns;
  g.togglePause();
  assert.equal(g.state, 'PAUSED');
  g.askAbandonRun();
  assert.equal(g.quitConfirm, true, 'a confirm, not an instant quit');
  assert.equal(g.state, 'PAUSED');
  g.cancelAbandonRun();
  assert.equal(g.quitConfirm, false);
  assert.equal(g.state, 'PAUSED', 'CANCEL stays paused');
  g.askAbandonRun();
  g.abandonRun();
  assert.equal(g.state, 'TITLE');
  assert.equal(g.quitConfirm, false);
  assert.equal(posted.length, 0, 'nothing posted to the global board');
  assert.deepEqual(counts(), { uploads: 0, records: 0 }, 'no run stats upload and no local high score');
  assert.equal(g.progression.data.totalRuns, runsBefore);
  assert.equal(g.progression.data.cores, coresBefore, 'no run bounty');
  assert.equal(g.player.level, 1, 'a fresh ship waits on the title screen');
  // Abandoning only works from the pause menu.
  g.state = 'PLAYING';
  g.abandonRun();
  assert.equal(g.state, 'PLAYING');
});

test('MAIN MENU after a game over goes to the title without recording the run twice', () => {
  const { g, posted, counts } = recordedRun();
  g.triggerGameOver();
  assert.equal(g.state, 'GAMEOVER');
  assert.equal(posted.length, 1);
  assert.deepEqual(counts(), { uploads: 1, records: 1 });
  g.returnToTitle();
  assert.equal(g.state, 'TITLE');
  assert.equal(posted.length, 1);
  assert.deepEqual(counts(), { uploads: 1, records: 1 });
});
