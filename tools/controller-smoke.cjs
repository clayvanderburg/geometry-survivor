// Controller-only browser check: a simulated standard gamepad drives title, level-up (incl. a NEW WEAPON pick),
// pause (sliders, damage-number toggle, loadout discard with confirm), chest and game over.
// Usage: node tools/controller-smoke.cjs <playwright-module-path>   (set BROWSER_EXECUTABLE to choose Chromium)
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
const A = 0, B = 1, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const root = path.resolve(__dirname, '..');
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (path.relative(root, file).startsWith('..')) return route.abort();
      try {
        let body = await fs.readFile(file);
        if (url.pathname === '/js/main.js') body = Buffer.from(body.toString().replace('() => new Game()', '() => (globalThis.__game = new Game())'));
        await route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__pad = { buttons: Array(17).fill(false), axes: [0, 0, 0, 0] };
      navigator.getGamepads = () => [{ connected: true, axes: window.__pad.axes, buttons: window.__pad.buttons.map(pressed => ({ pressed })) }];
    });
    await page.goto('http://127.0.0.1:8096');
    await page.waitForTimeout(800);

    const press = async (i) => {
      await page.evaluate(i => { window.__pad.buttons[i] = true; }, i);
      await page.waitForTimeout(90);
      await page.evaluate(i => { window.__pad.buttons[i] = false; }, i);
      await page.waitForTimeout(90);
    };
    const state = () => page.evaluate(() => __game.state);
    const expect = async (want, step) => { const got = await state(); if (got !== want) throw Error(`${step}: expected ${want}, got ${got}`); };

    await press(A);
    await expect('PLAYING', 'A on title launches the run');
    await page.evaluate(() => { __game.player.invuln = 1e9; });
    await page.waitForTimeout(400);

    // A plain hand (no NEW WEAPON card this time) so A applies an upgrade straight away.
    await page.evaluate(async () => {
      const { TUNING } = await import('/js/config.js');
      const chance = TUNING.newWeaponChance;
      TUNING.newWeaponChance = 0;
      __game.player.newWeaponDrought = 0;
      __game.triggerLevelUp();
      TUNING.newWeaponChance = chance;
    });
    await page.waitForTimeout(450);
    await press(RIGHT);
    const focusedCard = await page.evaluate(() => [...document.querySelectorAll('#upgrade-choices .upgrade-option')].findIndex(el => el.classList.contains('gp-focus')));
    if (focusedCard !== 1) throw Error(`d-pad right should focus card 2, focused ${focusedCard + 1}`);
    await page.screenshot({ path: 'controller-levelup.png' });
    const picked = await page.evaluate(() => __game.currentChoices[1].id);
    await press(A);
    await expect('PLAYING', 'A on a card selects it');
    if (!(await page.evaluate(id => (__game.player.upgradeLevels[id] || 0) > 0, picked))) throw Error('Selected card was not applied');

    // NEW WEAPON: walk to the card, A opens the weapon pick, A on the focused weapon equips it.
    await page.evaluate(() => { __game.player.newWeaponDrought = 99; __game.triggerLevelUp(); });
    await page.waitForTimeout(450);
    const nwIndex = await page.evaluate(() => __game.currentChoices.findIndex(c => c.isNewWeapon));
    if (nwIndex < 0) throw Error('pity should put a NEW WEAPON card in the hand');
    for (let i = 0; i < nwIndex; i++) await press(RIGHT);
    await press(A);
    await expect('UPGRADE', 'NEW WEAPON opens the weapon pick');
    if (!(await page.evaluate(() => __game.currentChoices.length === 3 && __game.currentChoices.every(c => c.isWeaponPick)))) throw Error('weapon pick should offer 3 weapons');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'controller-weapon-pick.png' });
    const slotsBefore = await page.evaluate(() => __game.player.loadout.length);
    await press(RIGHT);
    await press(A);
    await expect('PLAYING', 'A equips the focused weapon');
    if ((await page.evaluate(() => __game.player.loadout.length)) !== slotsBefore + 1) throw Error("weapon was not equipped");

    await press(START);
    await expect('PAUSED', 'Start pauses');
    await page.waitForTimeout(400);
    await press(UP);
    const slider = await page.evaluate(() => document.querySelector('#pause-modal .gp-focus')?.id);
    if (!slider?.includes('slider')) throw Error(`Up from Resume should reach a slider, got ${slider}`);
    const before = await page.evaluate(id => Number(document.getElementById(id).value), slider);
    await press(RIGHT);
    const after = await page.evaluate(id => Number(document.getElementById(id).value), slider);
    if (!(after > before)) throw Error('Right on a focused slider should raise it');
    await press(B);
    await expect('PLAYING', 'B resumes');

    // Damage-number toggle sits under Resume: d-pad down + A flips it and persists the choice.
    await press(START);
    await expect('PAUSED', 'Start pauses again');
    await page.waitForTimeout(400);
    await press(DOWN);
    const toggleId = await page.evaluate(() => document.querySelector('#pause-modal .gp-focus')?.id);
    if (toggleId !== 'btn-pause-dmgnums') throw Error(`Down from Resume should reach the damage-number toggle, got ${toggleId}`);
    await press(A);
    const toggled = await page.evaluate(() => ({ on: __game.damageNumbers.enabled, saved: localStorage.getItem('vexolith_damage_numbers'), label: document.getElementById('btn-pause-dmgnums').textContent }));
    if (toggled.on || toggled.saved !== '0' || !toggled.label.includes('OFF')) throw Error(`A should turn damage numbers off and persist it: ${JSON.stringify(toggled)}`);
    await press(A);
    if (!(await page.evaluate(() => __game.damageNumbers.enabled))) throw Error('A again should turn damage numbers back on');
    await press(B);
    await expect('PLAYING', 'B resumes after toggling');

    // Loadout: left from Resume reaches a DISCARD button; A asks to confirm (focus on KEEP), confirm discards.
    await press(START);
    await expect('PAUSED', 'Start pauses for the loadout');
    await page.waitForTimeout(400);
    await press(LEFT);
    const discardBtn = await page.evaluate(() => document.querySelector('#pause-modal .gp-focus')?.getAttribute('data-discard'));
    if (!discardBtn) throw Error('Left from Resume should reach a loadout DISCARD button');
    await press(A);
    const keep = await page.evaluate(() => document.querySelector('#pause-modal .gp-focus')?.getAttribute('data-discard-cancel'));
    if (keep !== discardBtn) throw Error(`DISCARD should move focus to KEEP for ${discardBtn}, got ${keep}`);
    await page.screenshot({ path: 'controller-discard-confirm.png' });
    await press(LEFT);
    await press(A);
    const loadoutAfter = await page.evaluate(() => __game.player.loadout);
    if (loadoutAfter.includes(discardBtn)) throw Error(`CONFIRM should discard ${discardBtn}: ${loadoutAfter}`);
    await press(B);
    await expect('PLAYING', 'B resumes after discarding');

    await page.evaluate(() => { const g = __game; g.openRelicChest({ x: g.player.x, y: g.player.y, isSuper: false }); });
    await expect('CHEST', 'chest opens');
    await page.waitForTimeout(400);
    await press(A);
    await expect('PLAYING', 'A claims the chest');

    await page.evaluate(() => __game.triggerGameOver());
    await expect('GAMEOVER', 'run ends');
    await page.waitForTimeout(400);
    await press(START);
    await expect('PLAYING', 'Start relaunches from game over');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'controller-gameplay.png' });

    if (errors.length) throw Error(errors.join('\n'));
    console.log('Controller smoke PASS: title launch, level-up navigation + select, NEW WEAPON pick, pause + slider + damage-number toggle + resume, loadout discard + confirm, chest claim, game-over relaunch; no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
