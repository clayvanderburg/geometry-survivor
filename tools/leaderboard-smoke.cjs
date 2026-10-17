// Global leaderboard browser check. Three runs of the game against /api/scores:
//   1. offline  - the request is aborted (like the other smokes): GLOBAL falls back to local runs + OFFLINE note
//   2. slow     - the API never answers in time: the client times out and falls back, nothing blocks
//   3. online   - /api/scores is fulfilled with a fake board: title board, tabs (mouse + controller),
//                 auto-submit on game over and the "GLOBAL RANK #12" line
// Screenshots: leaderboard-offline-smoke.png, leaderboard-title-smoke.png, leaderboard-local-smoke.png,
// leaderboard-gameover-smoke.png (written to the current directory).
// Usage: node tools/leaderboard-smoke.cjs <playwright-module-path>   (set BROWSER_EXECUTABLE to choose Chromium)
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
const A = 0, RIGHT = 15;

const NAMES = ['VEXOLITH // PRIME', 'NULLSTAR', 'KESTREL-9', 'VOID // HUNTER', 'ORBITAL ACE', 'MADKING', 'HEXWING', 'NEON // DRIFTER',
  'QUASAR', 'R2-STRIKE', 'PRISM', 'CINDER', 'LUMEN', 'GRAV-WELL', 'ZERO G', 'SHARD'];
const fakeBoard = () => Array.from({ length: 50 }, (_, i) => {
  const time = Math.round(900 - i * 15.3);
  return {
    id: 'seed-' + i, name: i < NAMES.length ? NAMES[i] : `PILOT ${i + 1}`, score: Math.round(2.1e9 / (1 + i * 0.9) ** 2),
    wave: 1 + Math.floor(time / 22), level: 10 + Math.floor(time / 14), kills: time * 18, multiplier: 50 + time, time,
    date: new Date(Date.UTC(2026, 9, 17, 12) - i * 3.6e6).toISOString()
  };
});

async function openGame(browser, api) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const root = path.resolve(__dirname, '..');
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/api/scores') return api(route);
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (path.relative(root, file).startsWith('..')) return route.abort();
    try {
      let body = await fs.readFile(file);
      if (url.pathname === '/js/main.js') body = Buffer.from(body.toString().replace('() => new Game()', '() => (globalThis.__game = new Game())'));
      await route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__pad = { buttons: Array(17).fill(false), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [{ connected: true, axes: window.__pad.axes, buttons: window.__pad.buttons.map(pressed => ({ pressed })) }];
  });
  await page.goto('http://127.0.0.1:8096');
  return { page, errors, context };
}

// Ends a believable run (200 s, wave 10) straight away.
const endRun = (page) => page.evaluate(() => {
  const g = __game;
  g.startGame();
  Object.assign(g, { score: 123456, elapsedTime: 200.4, wave: 10, kills: 900, multiplier: 12.3 });
  g.player.level = 14;
  g.triggerGameOver();
});
const text = (page, sel) => page.locator(sel).innerText();

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    // 1. Offline: aborted request.
    {
      const { page, errors, context } = await openGame(browser, route => route.abort());
      await page.waitForFunction(() => /OFFLINE/.test(document.getElementById('highscore-note').textContent));
      const rows = await page.locator('#highscore-list .hs-row').count();
      if (rows < 1) throw Error('Offline title board should show the local runs');
      await page.screenshot({ path: 'leaderboard-offline-smoke.png' });
      await endRun(page);
      await page.waitForFunction(() => /OFFLINE \/\/ RUN SAVED LOCALLY/.test(document.getElementById('go-global-rank').textContent));
      if (!/OFFLINE/.test(await text(page, '#go-board-note'))) throw Error('Offline game-over board needs the OFFLINE note');
      if (await page.locator('#go-highscore-list .hs-current').count() !== 1) throw Error('Offline fallback should highlight the new local run');
      if (errors.length) throw Error(errors.join('\n'));
      await context.close();
    }

    // 2. Slow: the API answers after the client's timeout.
    {
      const started = Date.now();
      const { page, errors, context } = await openGame(browser, route => setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', body: '{"entries":[]}' }).catch(() => {}), 9000));
      await page.locator('#btn-start-game').waitFor();
      if (!/SYNCING/.test(await text(page, '#highscore-note'))) throw Error('Board should say SYNCING while waiting');
      await page.keyboard.press('Space');
      if (await page.evaluate(() => __game.state) !== 'PLAYING') throw Error('A slow API must not block launching a run');
      await page.evaluate(() => __game.togglePause());
      await page.waitForFunction(() => /NOT RESPONDING/.test(document.getElementById('highscore-note').textContent), null, { timeout: 8000 });
      if (Date.now() - started > 9000) throw Error('Timeout fallback took too long');
      if (errors.length) throw Error(errors.join('\n'));
      await context.close();
    }

    // 3. Online with a fake board.
    {
      let board = fakeBoard();
      let posted = null;
      const api = async route => {
        const req = route.request();
        if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: board, total: 50, boardSize: 100 }) });
        posted = JSON.parse(req.postData());
        if (req.headers()['content-type'] !== 'application/json') throw Error('POST must be JSON');
        const entry = { id: 'run-new', ...posted, date: new Date().toISOString() };
        board = [...board.slice(0, 11), entry, ...board.slice(11)].slice(0, 50);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ accepted: true, onBoard: true, rank: 12, id: 'run-new', name: posted.name, censored: false, entries: board, total: 100, boardSize: 100 }) });
      };
      const { page, errors } = await openGame(browser, api);
      await page.waitForFunction(() => document.querySelectorAll('#highscore-list .hs-row').length === 50);
      if (!/ALL PILOTS/.test(await text(page, '#highscore-note'))) throw Error('Global note missing');
      if (await page.locator('#title-modal .board-tab.active').innerText() !== '◎ GLOBAL') throw Error('GLOBAL should be the default tab');
      if (await page.locator('#highscore-list .hs-mine').count() !== 1) throw Error('The player\'s own callsign should be highlighted');
      await page.screenshot({ path: 'leaderboard-title-smoke.png' });

      await page.locator('#title-modal [data-board-tab="local"]').click();
      if (!/THIS DEVICE/.test(await text(page, '#highscore-note'))) throw Error('MY RUNS should show the local board');
      if (await page.locator('#highscore-list .hs-row').count() > 8) throw Error('MY RUNS shows the local top 8');
      if (await page.locator('#title-modal .board-tab.active').innerText() !== 'MY RUNS') throw Error('MY RUNS tab should be marked active');
      await page.waitForTimeout(250); // let the tab colour transition finish
      await page.screenshot({ path: 'leaderboard-local-smoke.png' });

      // Controller: the tabs are MenuNavigator stops; RIGHT moves between them and A switches.
      const focusId = () => page.evaluate(() => __game.menuNav.focused?.dataset?.boardTab || __game.menuNav.focused?.id || null);
      const press = async (i) => {
        await page.evaluate(i => { window.__pad.buttons[i] = true; }, i);
        await page.waitForTimeout(90);
        await page.evaluate(i => { window.__pad.buttons[i] = false; }, i);
        await page.waitForTimeout(90);
      };
      await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0.3]; });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const root = document.getElementById('title-modal');
        const tabs = [...root.querySelectorAll('[data-board-tab]')];
        if (!tabs.every(t => __game.menuNav.items(root).includes(t))) throw Error('Tabs must be controller focus stops');
        __game.menuNav.setFocus(tabs[0]);
      });
      await press(RIGHT);
      if (await focusId() !== 'local') throw Error(`RIGHT from GLOBAL should focus MY RUNS, got ${await focusId()}`);
      await page.evaluate(() => __game.menuNav.setFocus(document.querySelector('#title-modal [data-board-tab="global"]')));
      await press(A);
      if (await page.evaluate(() => __game.boardTab) !== 'global') throw Error('A on the GLOBAL tab should switch to it');

      await endRun(page);
      await page.waitForFunction(() => /GLOBAL RANK #12/.test(document.getElementById('go-global-rank').textContent));
      const expected = { name: 'MADKING', score: 123456, wave: 10, level: 14, kills: 900, multiplier: 12.3, time: 200.4 };
      if (JSON.stringify(posted) !== JSON.stringify(expected)) throw Error('Unexpected submission: ' + JSON.stringify(posted));
      const current = page.locator('#go-highscore-list .hs-current');
      if (await current.count() !== 1 || !/#12/.test(await current.innerText())) throw Error('The new run should be highlighted at #12');
      const inView = await page.evaluate(() => {
        const list = document.getElementById('go-highscore-list'), row = list.querySelector('.hs-current');
        const a = list.getBoundingClientRect(), b = row.getBoundingClientRect();
        return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
      });
      if (!inView) throw Error('The new run should be scrolled into view in the game-over board');
      await page.screenshot({ path: 'leaderboard-gameover-smoke.png' });
      if (errors.length) throw Error(errors.join('\n'));
    }
    console.log('Leaderboard smoke PASS: offline fallback, slow-API timeout fallback, fake global board + highlight, tabs (mouse + controller), auto-submit + GLOBAL RANK #12; no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
