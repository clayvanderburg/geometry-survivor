// Controller-only browser check: a simulated standard gamepad drives title, level-up (incl. gold reroll / lock and a NEW WEAPON pick),
// pause (tabs, sliders, toggles, loadout discard with confirm, MAIN MENU with its abandon confirm), Field Guide, Patch Notes, chest and game over.
// Usage: node tools/controller-smoke.cjs <playwright-module-path>   (set BROWSER_EXECUTABLE to choose Chromium)
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

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

    // Holds the button until the game has polled it down, then until it has seen the release, so a slow or
    // busy machine (long frames) can't drop a press. Each step still takes at least the old 90 ms.
    const press = async (i) => {
      await page.evaluate(i => { window.__pad.buttons[i] = true; }, i);
      await Promise.all([page.waitForTimeout(90), page.waitForFunction(i => __game.gpButtons[i] === true, i, { timeout: 5000 })]);
      await page.evaluate(i => { window.__pad.buttons[i] = false; }, i);
      await Promise.all([page.waitForTimeout(90), page.waitForFunction(i => !__game.gpButtons[i], i, { timeout: 5000 })]);
    };
    const state = () => page.evaluate(() => __game.state);
    // A lucky +3 roll can take a weapon to LV 4, which opens its Breakthrough before play resumes:
    // pick it with A (controller coverage for the Breakthrough screen) and carry on.
    let breakthroughsTaken = 0;
    const expect = async (want, step) => {
      for (let k = 0; want === 'PLAYING' && k < 3 && await page.evaluate(() => __game.handPhase === 'breakthrough'); k++) {
        await page.waitForTimeout(450);
        await press(A);
        breakthroughsTaken++;
      }
      const got = await state();
      if (got !== want) throw Error(`${step}: expected ${want}, got ${got}`);
    };

    // First LAUNCH: A on the title opens the tutorial; RB moves a slide, B skips it into the run.
    await press(A);
    if (!await page.locator('#tutorial-modal').isVisible()) throw Error('The first launch should show the tutorial');
    await page.waitForTimeout(300);
    await press(RB);
    if (await page.evaluate(() => __game.tutorial.index) !== 1) throw Error('RB should show tutorial slide 2');
    await press(B);
    if (await page.locator('#tutorial-modal').isVisible()) throw Error('B should skip the tutorial');
    await expect('PLAYING', 'B skips the first-launch tutorial into the run');
    await page.evaluate(() => { __game.player.invuln = 1e9; });
    await page.waitForTimeout(400);

    // A plain hand (no NEW WEAPON card this time) so A applies an upgrade straight away.
    await page.evaluate(async () => {
      const { TUNING } = await import('/js/config.js');
      const keys = Object.keys(TUNING).filter(k => k.startsWith('newWeaponChance'));
      const saved = keys.map(k => TUNING[k]);
      keys.forEach(k => { TUNING[k] = 0; });
      __game.player.newWeaponDrought = 0;
      __game.triggerLevelUp();
      keys.forEach((k, i) => { TUNING[k] = saved[i]; });
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

    // Gold: Y locks the focused card (5), X rerolls the rest (20), the focusable REROLL button rerolls
    // again (40); picking another card carries the locked one into the next hand, where A takes it.
    // NEW WEAPON cards stay off for this whole section (rerolls roll real hands, and A on a NEW WEAPON
    // card opens the weapon pick); the odds are restored before the NEW WEAPON section below.
    const oddsOff = () => page.evaluate(async () => {
      const { TUNING } = await import('/js/config.js');
      window.__savedOdds = Object.fromEntries(Object.keys(TUNING).filter(k => k.startsWith('newWeaponChance')).map(k => [k, TUNING[k]]));
      for (const k of Object.keys(window.__savedOdds)) TUNING[k] = 0;
    });
    const oddsBack = () => page.evaluate(async () => {
      const { TUNING } = await import('/js/config.js');
      Object.assign(TUNING, window.__savedOdds || {});
    });
    await oddsOff();
    const plainHand = () => page.evaluate(async () => {
      const { TUNING } = await import('/js/config.js');
      const keys = Object.keys(TUNING).filter(k => k.startsWith('newWeaponChance'));
      const saved = keys.map(k => TUNING[k]);
      keys.forEach(k => { TUNING[k] = 0; });
      __game.player.newWeaponDrought = 0;
      __game.triggerLevelUp();
      keys.forEach((k, i) => { TUNING[k] = saved[i]; });
    });
    await page.evaluate(() => { __game.gold = 100; __game.updateHUD(); });
    await plainHand();
    await page.waitForTimeout(450);
    await press(RIGHT);
    await press(Y);
    const lockState = await page.evaluate(() => ({ slot: __game.handLock?.slot, gold: __game.gold, badge: !!document.querySelectorAll('#upgrade-choices .upgrade-option')[1]?.querySelector('.card-lock-badge') }));
    if (lockState.slot !== 1 || lockState.gold !== 95 || !lockState.badge) throw Error(`Y should lock the focused card 2 for 5 gold: ${JSON.stringify(lockState)}`);
    const lockedId = await page.evaluate(() => __game.handLock.card.id);
    await press(X);
    const afterX = await page.evaluate(() => ({ gold: __game.gold, id: __game.currentChoices[1].id, rerolls: __game.handRerolls, label: document.getElementById('btn-reroll-hand').textContent }));
    if (afterX.gold !== 75 || afterX.id !== lockedId || afterX.rerolls !== 1 || !afterX.label.includes('40')) throw Error(`X should reroll for 20 and keep the lock: ${JSON.stringify(afterX)}`);
    await press(DOWN);
    const rerollFocus = await page.evaluate(() => document.querySelector('#upgrade-modal .gp-focus')?.id);
    if (rerollFocus !== 'btn-reroll-hand') throw Error(`Down from the cards should reach the REROLL button, got ${rerollFocus}`);
    await press(A);
    if ((await page.evaluate(() => __game.gold)) !== 35) throw Error('A on REROLL should reroll for 40');
    await page.screenshot({ path: 'controller-reroll-lock.png' });
    await press(UP);
    const carriedPick = await page.evaluate(() => [...document.querySelectorAll('#upgrade-choices .upgrade-option')].findIndex(el => el.classList.contains('gp-focus')));
    if (carriedPick < 0) throw Error('Up from REROLL should return to a card');
    if (carriedPick === 1) await press(LEFT);
    await press(A);
    await expect('PLAYING', 'A picks a card other than the locked one');
    await plainHand();
    await page.waitForTimeout(450);
    const carried = await page.evaluate(() => ({ id: __game.currentChoices[1]?.id, locked: __game.handLock?.slot, badge: !!document.querySelectorAll('#upgrade-choices .upgrade-option')[1]?.querySelector('.card-lock-badge'), label: document.getElementById('btn-reroll-hand').textContent }));
    if (carried.id !== lockedId || carried.locked !== 1 || !carried.badge || !carried.label.includes('20')) throw Error(`The locked card should return in the next hand, locked, with rerolls back at 20: ${JSON.stringify(carried)}`);
    await press(RIGHT);
    await press(A);
    await expect('PLAYING', 'A takes the carried locked card');
    if (await page.evaluate(() => __game.carriedLock)) throw Error('Taking the locked card should use up the lock');
    await oddsBack();

    // NEW WEAPON: walk to the card, A opens the weapon pick, A on the focused weapon equips it.
    await page.evaluate(() => { __game.player.newWeaponDrought = 99; __game.triggerLevelUp(); });
    await page.waitForTimeout(450);
    const nwIndex = await page.evaluate(() => __game.currentChoices.findIndex(c => c.isNewWeapon));
    if (nwIndex < 0) throw Error('pity should put a NEW WEAPON card in the hand');
    for (let i = 0; i < nwIndex; i++) await press(RIGHT);
    await press(A);
    await expect('UPGRADE', 'NEW WEAPON opens the weapon pick');
    if (!(await page.evaluate(() => __game.currentChoices.length === 3 && __game.currentChoices.every(c => c.isWeaponPick)))) throw Error('weapon pick should offer 3 weapons');
    // A pressed again right away is ignored (the pick restarts the menu grace, as a double-click guard).
    await press(A);
    await expect('UPGRADE', 'an immediate second A must not equip a weapon blind');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'controller-weapon-pick.png' });
    const slotsBefore = await page.evaluate(() => __game.player.loadout.length);
    await press(RIGHT);
    await press(A);
    await expect('PLAYING', 'A equips the focused weapon');
    if ((await page.evaluate(() => __game.player.loadout.length)) !== slotsBefore + 1) throw Error("weapon was not equipped");

    // Pause menu (the run overview): LB / RB switch tabs and focus follows; sliders and toggles live on
    // SETTINGS, discards on LOADOUT; Resume, the Field Guide, Patch Notes, Restart and MAIN MENU sit under the ship.
    const pauseFocus = () => page.evaluate(() => {
      const el = document.querySelector('#pause-modal .gp-focus');
      return el ? el.id || (el.dataset.pauseTab ? `tab:${el.dataset.pauseTab}` : '') : null;
    });
    const walkTo = async (want, dir, max = 8) => {
      for (let k = 0; k < max && (await pauseFocus()) !== want; k++) await press(dir);
      const got = await pauseFocus();
      if (got !== want) throw Error(`the d-pad should reach ${want}, got ${got}`);
    };
    await press(START);
    await expect('PAUSED', 'Start pauses');
    await page.waitForTimeout(400);
    if (await pauseFocus() !== 'btn-resume-game') throw Error(`focus should start on Resume, got ${await pauseFocus()}`);
    if (!(await page.evaluate(() => __game.overview.tab === 'loadout' && document.getElementById('pause-ship-canvas').width > 0))) throw Error('pause should open on LOADOUT with the ship drawn');
    await press(LB);
    if (await pauseFocus() !== 'tab:settings') throw Error(`LB should wrap to SETTINGS and focus it, got ${await pauseFocus()}`);
    await press(DOWN);
    const slider = await pauseFocus();
    if (!slider?.includes('slider')) throw Error(`Down from the SETTINGS tab should reach a slider, got ${slider}`);
    const before = await page.evaluate(id => Number(document.getElementById(id).value), slider);
    await press(RIGHT);
    const after = await page.evaluate(id => Number(document.getElementById(id).value), slider);
    if (!(after > before)) throw Error('Right on a focused slider should raise it');
    await press(B);
    await expect('PLAYING', 'B resumes');

    // Damage-number toggle on SETTINGS (the tab is remembered): d-pad + A flips it and persists the choice.
    await press(START);
    await expect('PAUSED', 'Start pauses again');
    await page.waitForTimeout(400);
    if (!(await page.evaluate(() => __game.overview.tab === 'settings'))) throw Error('the pause menu should remember its tab');
    await press(LB);
    await press(RB);
    if (await pauseFocus() !== 'tab:settings') throw Error(`LB then RB should come back to SETTINGS, got ${await pauseFocus()}`);
    await walkTo('btn-pause-dmgnums', DOWN);
    await press(A);
    const toggled = await page.evaluate(() => ({ on: __game.damageNumbers.enabled, saved: localStorage.getItem('vexolith_damage_numbers'), label: document.getElementById('btn-pause-dmgnums').textContent }));
    if (toggled.on || toggled.saved !== '0' || !toggled.label.includes('OFF')) throw Error(`A should turn damage numbers off and persist it: ${JSON.stringify(toggled)}`);
    await press(A);
    if (!(await page.evaluate(() => __game.damageNumbers.enabled))) throw Error('A again should turn damage numbers back on');
    await walkTo('btn-pause-hud', DOWN);
    await press(A);
    if (!(await page.evaluate(() => __game.hudHidden && document.body.classList.contains('hud-hidden')))) throw Error('A on the HUD toggle should hide the HUD');
    await press(A);
    if (await page.evaluate(() => __game.hudHidden)) throw Error('A again should show the HUD');
    await press(B);
    await expect('PLAYING', 'B resumes after toggling');

    // Loadout: RB wraps to LOADOUT, Down reaches a DISCARD button; A asks to confirm (focus on KEEP), confirm discards.
    await press(START);
    await expect('PAUSED', 'Start pauses for the loadout');
    await page.waitForTimeout(400);
    await press(RB);
    if (await pauseFocus() !== 'tab:loadout') throw Error(`RB should wrap to LOADOUT, got ${await pauseFocus()}`);
    let discardBtn = null;
    for (let k = 0; k < 4 && !discardBtn; k++) {
      await press(DOWN);
      discardBtn = await page.evaluate(() => document.querySelector('#pause-modal .gp-focus')?.getAttribute('data-discard'));
    }
    if (!discardBtn) throw Error('Down from the LOADOUT tab should reach a loadout DISCARD button');
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

    // Field Guide from pause: Down (and Left) from Resume reaches its button, A opens it, RB switches tabs, the d-pad
    // walks focus into the entries (scrolling the list), B backs out to the pause menu.
    await press(START);
    await expect('PAUSED', 'Start pauses for the guide');
    await page.waitForTimeout(400);
    await press(DOWN);
    await walkTo('btn-pause-guide', LEFT, 2); // Down from Resume lands on the Field Guide / Patch Notes row
    await press(A);
    if (!(await page.evaluate(() => __game.guideOpen && !document.getElementById('guide-modal').classList.contains('hidden')))) throw Error('A should open the Field Guide');
    await page.waitForTimeout(400);
    await press(RB);
    const tab = await page.evaluate(() => [__game.fieldGuide.tab, document.querySelector('#guide-modal .gp-focus')?.dataset.guideTab]);
    if (tab[0] !== 'mechanics' || tab[1] !== 'mechanics') throw Error(`RB should switch to and focus MECHANICS, got ${tab}`);
    for (let k = 0; k < 4; k++) await press(DOWN);
    const entry = await page.evaluate(() => ({ id: document.querySelector('#guide-modal .gp-focus')?.dataset.entry, top: document.getElementById('guide-body').scrollTop }));
    if (!entry.id || !(entry.top > 0)) throw Error(`D-pad down should walk focus through the entries and scroll: ${JSON.stringify(entry)}`);
    await page.screenshot({ path: 'controller-guide.png' });
    await press(B);
    if (await page.evaluate(() => __game.guideOpen)) throw Error('B should close the Field Guide');
    await expect('PAUSED', 'closing the guide returns to the pause menu');
    await page.waitForTimeout(400);
    await press(B);
    await expect('PLAYING', 'B resumes after the guide');

    // Patch notes from pause: Down (and Right) from Resume reaches PATCH NOTES (wearing its NEW badge), A opens them with the
    // newest version expanded, the d-pad walks into the list, A on an older version expands it, B backs out.
    await press(START);
    await expect('PAUSED', 'Start pauses for the patch notes');
    await page.waitForTimeout(400);
    if (await page.evaluate(() => document.querySelector('#btn-pause-notes [data-notes-badge]').classList.contains('hidden'))) throw Error('PATCH NOTES should wear a NEW badge before they are read');
    await press(DOWN);
    await walkTo('btn-pause-notes', RIGHT, 2);
    await press(A);
    const opened = await page.evaluate(() => ({
      open: __game.notesOpen && !document.getElementById('notes-modal').classList.contains('hidden'),
      first: document.querySelector('#notes-body .notes-entry')?.className,
      openCount: document.querySelectorAll('#notes-body .notes-entry.open').length,
      badges: [...document.querySelectorAll('[data-notes-badge]')].every(b => b.classList.contains('hidden')),
      seen: localStorage.getItem('vexolith_patch_notes_seen'),
      version: document.querySelector('#notes-body .notes-entry')?.dataset.version
    }));
    if (!opened.open) throw Error('A should open the patch notes');
    if (!/\bopen\b/.test(opened.first) || !/\blatest\b/.test(opened.first) || opened.openCount !== 1) throw Error(`Newest version should be expanded on top, the rest collapsed: ${JSON.stringify(opened)}`);
    if (!opened.badges || opened.seen !== opened.version) throw Error(`Opening the notes should clear the NEW badge and remember ${opened.version}: ${JSON.stringify(opened)}`);
    await page.waitForTimeout(400);
    const focusedHead = () => page.evaluate(() => document.querySelector('#notes-modal .gp-focus')?.dataset?.notesToggle || null);
    if (await focusedHead() !== opened.version) throw Error(`Focus should start on the newest version header, got ${await focusedHead()}`);
    let older = null;
    for (let k = 0; k < 4 && !older; k++) {
      await press(DOWN);
      const head = await focusedHead();
      if (head && head !== opened.version) older = head;
    }
    if (!older) throw Error('D-pad down should walk from the newest notes to an older version header');
    await press(A);
    const expanded = await page.evaluate(v => {
      const entry = document.querySelector(`#notes-body .notes-entry[data-version="${v}"]`);
      return entry.classList.contains('open') && entry.querySelector('.notes-head').getAttribute('aria-expanded') === 'true' && !entry.querySelector('.notes-sections').hidden;
    }, older);
    if (!expanded) throw Error(`A on v${older} should expand it`);
    await page.screenshot({ path: 'controller-notes.png' });
    await press(B);
    if (await page.evaluate(() => __game.notesOpen)) throw Error('B should close the patch notes');
    await expect('PAUSED', 'closing the patch notes returns to the pause menu');
    await page.waitForTimeout(400);
    await press(B);
    await expect('PLAYING', 'B resumes after the patch notes');

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

    // MAIN MENU from pause: Down twice (and Right) reach it, A asks ABANDON RUN? (focus on CANCEL), B backs
    // out (still paused), A again then Left + A confirms: the title, with nothing recorded.
    const runsBefore = await page.evaluate(() => __game.progression.data.totalRuns);
    await press(START);
    await expect('PAUSED', 'Start pauses for MAIN MENU');
    await page.waitForTimeout(400);
    await press(DOWN);
    await press(DOWN);
    await walkTo('btn-pause-menu', RIGHT, 2);
    await press(A);
    if (await pauseFocus() !== 'btn-quit-cancel' || !(await page.evaluate(() => __game.quitConfirm))) throw Error('A on MAIN MENU should ask to confirm, focus on CANCEL');
    await press(B);
    await expect('PAUSED', 'B backs out of the confirm without resuming');
    if (await pauseFocus() !== 'btn-pause-menu' || await page.evaluate(() => __game.quitConfirm)) throw Error('B should close the confirm and refocus MAIN MENU');
    await press(A);
    await press(LEFT);
    if (await pauseFocus() !== 'btn-quit-confirm') throw Error(`Left from CANCEL should reach CONFIRM, got ${await pauseFocus()}`);
    await press(A);
    await expect('TITLE', 'CONFIRM abandons the run to the title');
    if ((await page.evaluate(() => __game.progression.data.totalRuns)) !== runsBefore) throw Error('an abandoned run must not be recorded');

    // MAIN MENU after a game over: Right from RELAUNCH reaches it, A goes to the title.
    await page.waitForTimeout(400);
    await press(A);
    await expect('PLAYING', 'A on title launches another run');
    await page.evaluate(() => __game.triggerGameOver());
    await expect('GAMEOVER', 'second run ends');
    await page.waitForTimeout(400);
    await press(RIGHT);
    if ((await page.evaluate(() => document.querySelector('#gameover-modal .gp-focus')?.id)) !== 'btn-go-menu') throw Error('Right from RELAUNCH should reach MAIN MENU');
    await press(A);
    await expect('TITLE', 'MAIN MENU after a game over goes to the title');

    // Game mode on the title: RB steps NORMAL -> HARDCORE, Left from LAUNCH reaches the selector and A
    // picks BLITZ, and the next launch flies it.
    await page.waitForTimeout(400);
    const checked = () => page.evaluate(() => document.querySelector('#mode-select [aria-checked="true"]')?.dataset.gameMode);
    if (await checked() !== 'normal') throw Error('NORMAL is the default mode');
    await press(RB);
    if (await checked() !== 'hardcore' || await page.evaluate(() => __game.selectedMode) !== 'hardcore') throw Error('RB on the title should pick HARDCORE');
    await page.evaluate(() => __game.menuNav.setFocus(document.getElementById('btn-start-game')));
    await press(LEFT);
    const leftOfLaunch = await page.evaluate(() => { const f = __game.menuNav.focused; return f?.dataset?.gameMode || f?.id || f?.className || null; });
    if (leftOfLaunch !== 'blitz') throw Error(`Left from LAUNCH should reach the BLITZ choice, got ${leftOfLaunch}`);
    await press(A);
    if (await checked() !== 'blitz') throw Error('A on BLITZ should pick it');
    await page.evaluate(() => __game.menuNav.setFocus(document.getElementById('btn-start-game')));
    await press(A);
    await expect('PLAYING', 'A on LAUNCH starts the BLITZ run');
    if (await page.evaluate(() => __game.mode) !== 'blitz') throw Error('The run should fly BLITZ');

    if (errors.length) throw Error(errors.join('\n'));
    console.log('Controller smoke PASS: first-launch tutorial (A launch, RB next, B skip into the run), title launch, level-up navigation + select, gold lock (Y) + reroll (X and REROLL button) + carried lock, NEW WEAPON pick, pause tabs (LB/RB) + slider + damage-number and HUD toggles + resume, loadout discard + confirm, MAIN MENU abandon (confirm/cancel) and from game over, Field Guide open + tab switch + browse + back, Patch Notes open + browse + expand + back, chest claim, game-over relaunch, title game mode (RB + d-pad + A); no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
