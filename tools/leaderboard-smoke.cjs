// Global leaderboard browser check. Three runs of the game against /api/scores:
//   1. offline  - the request is aborted (like the other smokes): GLOBAL falls back to local runs + OFFLINE note
//   2. slow     - the API never answers in time: the client times out and falls back, nothing blocks
//   3. online   - /api/scores is fulfilled with fake boards (ALL-TIME default + a version filter): title board, tabs and the VERSION
//                 selector (mouse + controller), ALL-TIME rows tagged with their version (pre-0.9 for legacy
//                 runs), versioned auto-submit on game over and the "GLOBAL RANK #12 · v0.X.Y" line; the
//                 NORMAL / HARDCORE / BLITZ board switch (mouse + controller, ?mode=), a HARDCORE run picked
//                 on the title that submits with its mode, shows its own board and keeps its mode on restart
// Screenshots: leaderboard-offline-smoke.png, leaderboard-title-smoke.png, leaderboard-local-smoke.png,
// leaderboard-alltime-smoke.png, leaderboard-gameover-smoke.png, leaderboard-modes-smoke.png,
// leaderboard-hardcore-smoke.png (written to the current directory).
// Usage: node tools/leaderboard-smoke.cjs <playwright-module-path>   (set BROWSER_EXECUTABLE to choose Chromium)
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
const A = 0, LEFT = 14, RIGHT = 15;
const GAME_VERSION = /GAME_VERSION = '([^']+)'/.exec(require('node:fs').readFileSync(path.resolve(__dirname, '../js/version.js'), 'utf8'))[1];

const NAMES = ['VEXOLITH // PRIME', 'NULLSTAR', 'KESTREL-9', 'VOID // HUNTER', 'ORBITAL ACE', 'HALCYON', 'HEXWING', 'NEON // DRIFTER',
  'QUASAR', 'R2-STRIKE', 'PRISM', 'CINDER', 'LUMEN', 'GRAV-WELL', 'ZERO G', 'SHARD'];
// version: the run's game version; 'mixed' = an all-time board where every third run predates versioning.
// A full board: 100 runs, with the smoke's pilot (MADKING) far down at #71, below the fold.
const MY_INDEX = 70;
const fakeBoard = (version = GAME_VERSION) => Array.from({ length: 100 }, (_, i) => {
  const time = Math.round(900 - i * 7.6);
  return {
    id: 'seed-' + i, name: i === MY_INDEX ? 'MADKING' : i < NAMES.length ? NAMES[i] : `PILOT ${i + 1}`, score: Math.round(2.1e9 / (1 + i * 0.9) ** 2),
    wave: 1 + Math.floor(time / 22), level: 10 + Math.floor(time / 14), kills: time * 18, multiplier: 50 + time, time,
    date: new Date(Date.UTC(2026, 9, 17, 12) - i * 3.6e6).toISOString(),
    version: version === 'mixed' ? (i % 3 === 1 ? null : GAME_VERSION) : version
  };
});

async function openGame(browser, api, contextOptions = { viewport: { width: 1280, height: 800 } }) {
  const context = await browser.newContext(contextOptions);
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
    try { localStorage.setItem('vexolith_tutorial_seen', '1'); localStorage.setItem('vexolith_intro_seen', '1'); localStorage.setItem('vexolith_slot_tip_seen', '1'); } catch {}
    window.__pad = { buttons: Array(17).fill(false), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [{ connected: true, axes: window.__pad.axes, buttons: window.__pad.buttons.map(pressed => ({ pressed })) }];
  });
  await page.goto('http://127.0.0.1:8096');
  await page.locator('#splash-screen').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape'); // past the splash screen
  await page.locator('#splash-screen').waitFor({ state: 'hidden' });
  return { page, errors, context };
}

// Ends a believable run (200 s, wave 10) straight away.
const endRun = (page) => page.evaluate(() => {
  const g = __game;
  g.startGame({ picked: true }); // past the starting-weapon pick
  Object.assign(g, { score: 123456, elapsedTime: 200.4, wave: 10, kills: 900, multiplier: 12.3 });
  g.player.level = 14;
  g.triggerGameOver();
});
const text = (page, sel) => page.locator(sel).innerText();

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    // 1. Offline: aborted request. The run is queued in the outbox ("1 RUN WAITING TO UPLOAD"); once the
    //    board is back, the next launch sends it with the same nonce and the hint goes away.
    {
      let online = false;
      const outboxPosts = [];
      const api = (route) => {
        if (!online) return route.abort();
        const req = route.request();
        if (req.method() === 'POST') {
          const p = JSON.parse(req.postData());
          outboxPosts.push(p.nonce);
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ accepted: true, onBoard: true, rank: 7, allTimeRank: 7, version: p.version, mode: p.mode, id: 'outbox-run', name: p.name, entries: [{ id: 'outbox-run', ...p, date: new Date().toISOString() }], total: 1, boardSize: 100 }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'all', mode: 'normal', current: GAME_VERSION, versions: [], entries: [], total: 0, boardSize: 100 }) });
      };
      const { page, errors, context } = await openGame(browser, api);
      await page.waitForFunction(() => /OFFLINE/.test(document.getElementById('highscore-note').textContent));
      const rows = await page.locator('#highscore-list .hs-row').count();
      if (rows < 1) throw Error('Offline title board should show the local runs');
      await page.screenshot({ path: 'leaderboard-offline-smoke.png' });
      await endRun(page);
      await page.waitForFunction(() => /RUN QUEUED FOR UPLOAD/.test(document.getElementById('go-global-rank').textContent), null, { timeout: 15000 });
      if (!/OFFLINE/.test(await text(page, '#go-board-note'))) throw Error('Offline game-over board needs the OFFLINE note');
      if (await page.locator('#go-highscore-list .hs-current').count() !== 1) throw Error('Offline fallback should highlight the new local run');
      if (await text(page, '#go-board-outbox') !== '◌ 1 RUN WAITING TO UPLOAD') throw Error('The game-over board should say a run is waiting to upload: ' + await text(page, '#go-board-outbox'));
      const queuedNonce = await page.evaluate(() => JSON.parse(localStorage.getItem('vexolith_global_outbox_v1'))[0].payload.nonce);
      online = true;
      await page.reload();
      await page.locator('#splash-screen').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('vexolith_global_outbox_v1') || '[]').length === 0, null, { timeout: 10000 });
      if (outboxPosts.length !== 1 || outboxPosts[0] !== queuedNonce) throw Error('The next launch should send the queued run once, with its nonce: ' + outboxPosts);
      await page.waitForFunction(() => document.getElementById('title-board-outbox').classList.contains('hidden'));
      await page.waitForTimeout(1500);
      if (outboxPosts.length !== 1) throw Error('A sent run must never go up twice');
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
      await page.locator('#start-pick-modal').waitFor({ state: 'visible' });
      await page.keyboard.press('Space'); // the starting-weapon pick: launch the lit weapon
      if (await page.evaluate(() => __game.state) !== 'PLAYING') throw Error('A slow API must not block launching a run');
      await page.evaluate(() => __game.togglePause());
      await page.waitForFunction(() => /NOT RESPONDING/.test(document.getElementById('highscore-note').textContent), null, { timeout: 8000 });
      if (Date.now() - started > 9000) throw Error('Timeout fallback took too long');
      if (errors.length) throw Error(errors.join('\n'));
      await context.close();
    }

    // 3. Online with fake per-version boards (the current version and ALL-TIME, which mixes in legacy runs).
    {
      // Boards per game mode and version ('normal|all', 'blitz|0.X.Y', ...); NORMAL GETs carry no ?mode=.
      const boards = { [`normal|${GAME_VERSION}`]: fakeBoard(), 'normal|all': fakeBoard('mixed'), 'blitz|all': fakeBoard().slice(0, 6) };
      const gets = [];
      const modes = [];
      let posted = null;
      const nonces = [];
      let busyPosts = 1; // the first submit meets a busy board (503): the game retries it quietly
      // GETs come through the CDN's short cache: after a submit they keep serving the board from before it.
      const cdnStale = {};
      const api = async route => {
        const req = route.request();
        if (req.method() === 'GET') {
          const params = new URL(req.url()).searchParams;
          const version = params.get('version');
          const mode = params.get('mode') || 'normal';
          gets.push(version);
          modes.push(mode);
          const key = `${mode}|${version}`;
          const served = cdnStale[key] || { entries: boards[key] || [], updated: '2026-10-17T12:00:00.000Z' };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version, mode, current: GAME_VERSION, versions: [GAME_VERSION], entries: served.entries, total: served.entries.length, boardSize: 100, updated: served.updated }) });
        }
        posted = JSON.parse(req.postData());
        if (req.headers()['content-type'] !== 'application/json') throw Error('POST must be JSON');
        nonces.push(posted.nonce);
        if (busyPosts > 0) {
          busyPosts--;
          return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'retry-after': '2' }, body: JSON.stringify({ error: 'leaderboard busy, try again', partial: false }) });
        }
        const updated = new Date().toISOString();
        const entry = { id: 'run-new', ...posted, date: updated };
        const keys = [posted.version, 'all'].map(v => `${posted.mode}|${v}`);
        for (const key of keys) {
          const list = boards[key] || [];
          cdnStale[key] = { entries: list, updated: '2026-10-17T12:00:00.000Z' }; // the CDN still has the old copy
          boards[key] = [...list.slice(0, 11), entry, ...list.slice(11)].slice(0, 100);
        }
        const own = boards[keys[0]];
        const rank = own.findIndex(e => e.id === 'run-new') + 1;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ accepted: true, onBoard: true, rank, allTimeRank: rank, version: posted.version, mode: posted.mode, id: 'run-new', name: posted.name, censored: false, entries: own, total: 100, boardSize: 100, versions: [GAME_VERSION], updated,
          allTime: { entries: boards[keys[1]], total: boards[keys[1]].length, updated } }) });
      };
      const { page, errors } = await openGame(browser, api);
      // GLOBAL opens on the one shared board that never resets: ALL-TIME, every row tagged with its version.
      await page.waitForFunction(() => document.querySelectorAll('#highscore-list .hs-ver').length === 100);
      if (gets[0] !== 'all') throw Error(`GLOBAL should open on the shared ALL-TIME board, asked for ${gets[0]}`);
      if (await text(page, '#highscore-note') !== 'TOP 100 // ALL-TIME') throw Error('Global note should read ALL-TIME');
      if (await page.locator('#title-modal .board-tab.active').innerText() !== '◎ GLOBAL') throw Error('GLOBAL should be the default tab');
      const chips = () => page.locator('#title-board-versions [data-board-version]').evaluateAll(els => els.map(b => [b.dataset.boardVersion, b.classList.contains('active')]));
      if (JSON.stringify(await chips()) !== JSON.stringify([['all', true], [GAME_VERSION, false]])) throw Error('Version selector should offer ALL-TIME (active) then the current version: ' + JSON.stringify(await chips()));
      const tags = await page.locator('#highscore-list .hs-ver').allInnerTexts();
      if (tags[0] !== `v${GAME_VERSION}` || tags[1] !== 'pre-0.9') throw Error('Rows should be tagged with their version: ' + tags.slice(0, 3));
      if (!/v\d+\.\d+\.\d+/.test(await text(page, '#title-modal .version-tag'))) throw Error('Title needs the version tag');
      if (await page.locator('#highscore-list .hs-mine').count() < 1) throw Error('The player\'s own callsign should be highlighted');
      await page.waitForTimeout(250);
      await page.screenshot({ path: 'leaderboard-title-smoke.png' });

      // Mouse: a version button filters the board to that version (no per-row tags needed there).
      await page.locator(`#title-board-versions [data-board-version="${GAME_VERSION}"]`).click();
      await page.waitForFunction(v => __game.globalBoard.version === v && document.querySelectorAll('#highscore-list .hs-row').length === 100, GAME_VERSION);
      if (gets.at(-1) !== GAME_VERSION) throw Error('A version filter should fetch ?version=<v>');
      if (await text(page, '#highscore-note') !== `TOP 100 // v${GAME_VERSION}`) throw Error('Filtered note should name the version');
      if (await page.locator('#highscore-list .hs-ver').count()) throw Error('A single-version board needs no per-row version tags');
      if (await page.locator(`#go-board-versions [data-board-version="${GAME_VERSION}"].active`).count() !== 1) throw Error('Both board panels share the selection');
      await page.screenshot({ path: 'leaderboard-version-filter-smoke.png' });

      await page.locator('#title-modal [data-board-tab="local"]').click();
      if (!/THIS DEVICE/.test(await text(page, '#highscore-note'))) throw Error('MY RUNS should show the local board');
      if (!(await page.locator('#title-board-versions').evaluate(el => el.classList.contains('hidden')))) throw Error('MY RUNS has no version selector');
      if (await page.locator('#highscore-list .hs-row').count() > 8) throw Error('MY RUNS shows the local top 8');
      if (await page.locator('#title-modal .board-tab.active').innerText() !== 'MY RUNS') throw Error('MY RUNS tab should be marked active');
      await page.waitForTimeout(250); // let the tab colour transition finish
      await page.screenshot({ path: 'leaderboard-local-smoke.png' });

      // Controller: the tabs are MenuNavigator stops; RIGHT moves between them and A switches.
      const focusId = () => page.evaluate(() => __game.menuNav.focused?.dataset?.boardTab || __game.menuNav.focused?.id || null);
      // Held until the game has polled the press and then the release, so long frames can't drop it.
      const press = async (i) => {
        await page.evaluate(i => { window.__pad.buttons[i] = true; }, i);
        await Promise.all([page.waitForTimeout(90), page.waitForFunction(i => __game.gpButtons[i] === true, i, { timeout: 5000 })]);
        await page.evaluate(i => { window.__pad.buttons[i] = false; }, i);
        await Promise.all([page.waitForTimeout(90), page.waitForFunction(i => !__game.gpButtons[i], i, { timeout: 5000 })]);
      };
      await page.evaluate(() => { window.__pad.axes = [0, 0, 0.3, 0]; }); // wakes the controller (right stick X: the vertical axis scrolls the board)
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

      // Controller: the version buttons are focus stops too; LEFT from the version filter reaches ALL-TIME, A picks it.
      await page.waitForFunction(() => !document.getElementById('title-board-versions').classList.contains('hidden'));
      await page.evaluate(v => {
        const root = document.getElementById('title-modal');
        const vers = [...root.querySelectorAll('[data-board-version]')];
        if (vers.length < 2 || !vers.every(b => __game.menuNav.items(root).includes(b))) throw Error('Version buttons must be controller focus stops');
        __game.menuNav.setFocus(root.querySelector(`[data-board-version="${v}"]`));
      }, GAME_VERSION);
      await press(LEFT);
      const verFocus = await page.evaluate(() => __game.menuNav.focused?.dataset?.boardVersion || null);
      if (verFocus !== 'all') throw Error(`LEFT from v${GAME_VERSION} should focus ALL-TIME, got ${verFocus}`);
      await press(A);
      await page.waitForFunction(() => __game.globalBoard.version === 'all' && document.querySelectorAll('#highscore-list .hs-ver').length === 100);
      if (await page.evaluate(() => __game.menuNav.focused?.dataset?.boardVersion) !== 'all') throw Error('Focus should stay on the version button after switching');

      // Mode switch beside the version selector: BLITZ by mouse (?mode=blitz), HARDCORE by controller, back to NORMAL.
      const modeChips = () => page.locator('#title-board-modes [data-board-mode]').evaluateAll(els => els.map(b => [b.dataset.boardMode, b.classList.contains('active')]));
      if (JSON.stringify(await modeChips()) !== JSON.stringify([['normal', true], ['hardcore', false], ['blitz', false]])) throw Error('Mode switch should offer NORMAL (active), HARDCORE, BLITZ: ' + JSON.stringify(await modeChips()));
      await page.locator('#title-board-modes [data-board-mode="blitz"]').click();
      await page.waitForFunction(() => document.getElementById('highscore-note').textContent === 'TOP 100 // BLITZ // ALL-TIME' && document.querySelectorAll('#highscore-list .hs-row').length === 6);
      if (modes.at(-1) !== 'blitz' || gets.at(-1) !== 'all') throw Error('BLITZ should fetch ?version=all&mode=blitz');
      if (await page.locator('#go-board-modes [data-board-mode="blitz"].active').count() !== 1) throw Error('Both board panels share the mode');
      await page.waitForTimeout(250);
      await page.screenshot({ path: 'leaderboard-modes-smoke.png' });
      await page.evaluate(() => {
        const root = document.getElementById('title-modal');
        const btns = [...root.querySelectorAll('[data-board-mode]')];
        if (btns.length !== 3 || !btns.every(b => __game.menuNav.items(root).includes(b))) throw Error('Mode buttons must be controller focus stops');
        __game.menuNav.setFocus(root.querySelector('[data-board-mode="blitz"]'));
      });
      await press(LEFT);
      if (await page.evaluate(() => __game.menuNav.focused?.dataset?.boardMode) !== 'hardcore') throw Error('LEFT from BLITZ should focus HARDCORE');
      await press(A);
      await page.waitForFunction(() => __game.globalBoard.mode === 'hardcore' && /NO HARDCORE \/\/ ALL-TIME RUNS YET/.test(document.getElementById('highscore-note').textContent));
      await page.locator('#title-board-modes [data-board-mode="normal"]').click();
      await page.waitForFunction(() => __game.globalBoard.mode === 'normal' && document.querySelectorAll('#highscore-list .hs-ver').length === 100);

      // A full board (100 runs) scrolls inside its panel: the column head stays pinned, and the mouse wheel, a
      // touch drag, the d-pad and the right stick all scroll it; YOU #71 jumps to the pilot's own run below the fold.
      const list = page.locator('#highscore-list');
      const toTop = () => page.evaluate(() => document.getElementById('highscore-list').scrollTo({ top: 0, behavior: 'instant' }));
      const scrollTop = () => page.evaluate(() => document.getElementById('highscore-list').scrollTop);
      const scrolledPast = (px) => page.waitForFunction((px) => document.getElementById('highscore-list').scrollTop > px, px, { timeout: 5000 });
      if (await page.locator('#highscore-list .hs-row').count() !== 100) throw Error('The GLOBAL board should list all 100 runs');
      if (await page.locator('#highscore-list .hs-head').count() !== 1) throw Error('The board needs its column head');
      if (await list.evaluate(el => el.scrollHeight - el.clientHeight) < 1000) throw Error('100 rows should scroll inside the panel');
      await toTop();
      const jump = page.locator('#highscore-list .hs-jump');
      await page.waitForTimeout(100);
      if (!await jump.isVisible() || await jump.innerText() !== '▼ YOU #71') throw Error('YOU #71 should show while the pilot\'s run is below the fold: ' + (await jump.isVisible() && await jump.innerText()));
      await list.hover();
      await page.mouse.wheel(0, 700);
      await scrolledPast(300);
      const pinned = await list.evaluate(el => Math.abs(el.querySelector('.hs-head').getBoundingClientRect().top - el.getBoundingClientRect().top) <= 2);
      if (!pinned) throw Error('The column head should stay pinned while the board scrolls');
      await toTop();
      await jump.click();
      await page.waitForFunction(() => {
        const l = document.getElementById('highscore-list'), row = [...l.querySelectorAll('.hs-mine')].find(r => /#71/.test(r.textContent));
        const a = l.getBoundingClientRect(), b = row.getBoundingClientRect();
        return b.top >= a.top && b.bottom <= a.bottom && l.querySelector('.hs-jump').classList.contains('hidden');
      }, null, { timeout: 5000 });
      await toTop();
      await page.evaluate(() => __game.menuNav.setFocus(document.getElementById('highscore-list')));
      await press(13); // d-pad DOWN scrolls the focused board instead of leaving it
      await scrolledPast(30);
      if (await page.evaluate(() => __game.menuNav.focused?.id) !== 'highscore-list') throw Error('DOWN inside the board should keep focus on it');
      await toTop();
      await page.evaluate(() => { window.__pad.axes = [0, 0, 0.3, 0.9]; });
      await scrolledPast(60);
      await page.evaluate(() => { window.__pad.axes = [0, 0, 0.3, 0]; });
      await toTop();
      await page.evaluate(() => __game.menuNav.setFocus(document.getElementById('btn-start-game')));

      await endRun(page);
      // The board was busy: the game says it's retrying, then lands the run with the same nonce.
      await page.waitForFunction(() => /RETRYING UPLINK/.test(document.getElementById('go-global-rank').textContent), null, { timeout: 5000 });
      await page.waitForFunction(() => /GLOBAL RANK #12/.test(document.getElementById('go-global-rank').textContent), null, { timeout: 15000 });
      if (nonces.length !== 2 || !/^[A-Za-z0-9_-]{16,64}$/.test(nonces[0]) || nonces[0] !== nonces[1]) throw Error('The retry should resend the run with the same nonce: ' + nonces);
      if (await text(page, '#go-global-rank') !== `◎ GLOBAL RANK #12 · v${GAME_VERSION}`) throw Error('Rank line should name the version: ' + await text(page, '#go-global-rank'));
      const expected = { name: 'MADKING', score: 123456, wave: 10, level: 14, kills: 900, multiplier: 12.3, time: 200.4, version: GAME_VERSION, mode: 'normal' };
      const { nonce: _nonce, ...fields } = posted;
      if (JSON.stringify(fields) !== JSON.stringify(expected)) throw Error('Unexpected submission: ' + JSON.stringify(posted));
      // The ALL-TIME board on screen came back with the submit answer: the new run shows at once, and the
      // CDN's stale copy (GET) can't wipe it out.
      await page.waitForFunction(() => document.querySelectorAll('#go-highscore-list .hs-current').length === 1);
      const getsAfterSubmit = gets.length;
      await page.evaluate(() => __game.refreshGlobalBoard());
      await page.waitForTimeout(500);
      if (gets.length <= getsAfterSubmit) throw Error('refreshGlobalBoard should GET the board');
      if (await page.locator('#go-highscore-list .hs-current').count() !== 1) throw Error('A stale CDN copy of ALL-TIME must not drop the just-posted run');
      const current = page.locator('#go-highscore-list .hs-current');
      if (await current.count() !== 1 || !/#12/.test(await current.innerText())) throw Error('The new run should be highlighted at #12');
      // The board glides to the new run (smooth scrolling), so give it a moment to arrive.
      const inView = await page.waitForFunction(() => {
        const list = document.getElementById('go-highscore-list'), row = list.querySelector('.hs-current');
        const a = list.getBoundingClientRect(), b = row.getBoundingClientRect();
        return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
      }, null, { timeout: 3000 }).then(() => true, () => false);
      if (!inView) throw Error('The new run should be scrolled into view in the game-over board');
      await page.screenshot({ path: 'leaderboard-gameover-smoke.png' });

      // The game-over board is the shared ALL-TIME one: the new run sits there with its version tag.
      await page.waitForFunction(() => document.querySelector('#go-highscore-list .hs-current .hs-ver'));

      // A HARDCORE run: picked on the title (the board follows), submitted with its mode, shown on the
      // HARDCORE board at game over, and RELAUNCH keeps the mode.
      await page.locator('#btn-go-menu').click();
      await page.locator('#mode-select [data-game-mode="hardcore"]').click();
      await page.waitForFunction(() => __game.selectedMode === 'hardcore' && __game.globalBoard.mode === 'hardcore');
      if (await page.locator('#mode-select [data-game-mode="hardcore"]').getAttribute('aria-checked') !== 'true') throw Error('The title selector should mark HARDCORE');
      await endRun(page);
      await page.waitForFunction(() => /HARDCORE/.test(document.getElementById('go-global-rank').textContent));
      if (posted.mode !== 'hardcore') throw Error('The HARDCORE run should be submitted with its mode: ' + JSON.stringify(posted));
      if (await page.locator('#go-board-modes [data-board-mode="hardcore"].active').count() !== 1) throw Error('Game over should show the HARDCORE board');
      if (await text(page, '#go-mode-tag') !== '☠ HARDCORE') throw Error('Game over should name the mode');
      if (!/HARDCORE/.test(await text(page, '#gameover-subtitle'))) throw Error('Game-over subtitle should name the mode');
      await page.waitForFunction(() => document.querySelectorAll('#go-highscore-list .hs-current').length === 1);
      await page.waitForTimeout(250);
      await page.screenshot({ path: 'leaderboard-hardcore-smoke.png' });
      await page.locator('#btn-restart-game').click();
      await page.locator('#start-pick-modal').waitFor({ state: 'visible' });
      await page.keyboard.press('Enter'); // the starting-weapon pick: launch the lit weapon
      if (await page.evaluate(() => __game.state) !== 'PLAYING') throw Error('RELAUNCH should start a run after the starting-weapon pick');
      if (await page.evaluate(() => __game.mode) !== 'hardcore') throw Error('RELAUNCH should keep the mode');
      if (!await page.locator('#mode-hud-badge').isVisible()) throw Error('A HARDCORE run wears its HUD badge');
      await page.evaluate(() => __game.returnToTitle());
      await page.locator('#mode-select [data-game-mode="normal"]').click();
      if (errors.length) throw Error(errors.join('\n'));
    }
    // 4. Phone width, touch: the full board scrolls under a touch drag inside its panel (not the page).
    {
      const entries = fakeBoard('mixed');
      const api = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'all', mode: 'normal', current: GAME_VERSION, versions: [GAME_VERSION], entries, total: 100, boardSize: 100 }) });
      const { page, errors, context } = await openGame(browser, api, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.waitForFunction(() => document.querySelectorAll('#highscore-list .hs-row').length === 100);
      await page.locator('#title-modal [data-m-open="board"]').tap(); // phones open the board panel from the title
      const list = page.locator('#highscore-list');
      await list.waitFor({ state: 'visible' });
      await list.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => ({ list: document.getElementById('highscore-list').scrollTop }));
      if (!await page.locator('#highscore-list .hs-jump').isVisible()) throw Error('YOU #71 should show on the phone board once its window opens');
      const box = await list.boundingBox();
      if (box.height < 300) throw Error(`The phone board should fill most of its window, got ${box.height}px`);
      // A finger drag up the board (raw touch events: Chromium scrolls the list natively).
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2;
      let y = box.y + box.height * 0.8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 0; i < 12; i++) { y -= 14; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await page.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction((t) => document.getElementById('highscore-list').scrollTop > t + 40, before.list, { timeout: 5000 });
      await page.waitForTimeout(400);
      await list.screenshot({ path: 'leaderboard-phone-smoke.png' });
      await page.screenshot({ path: 'leaderboard-phone-page-smoke.png' });
      if (errors.length) throw Error(errors.join('\n'));
      await context.close();
    }
    console.log('Leaderboard smoke PASS: offline fallback (after quiet retries) with the run queued and sent once on the next launch, a busy board retried with the same nonce, a stale CDN board ignored after a submit, a full 100-run board scrolling under a pinned head (wheel, d-pad, right stick, YOU #n jump; touch drag at phone width), slow-API timeout fallback, shared ALL-TIME board by default with version tags incl. pre-0.9, VERSION filter (mouse + controller), tabs, versioned auto-submit + GLOBAL RANK #12 · version, NORMAL / HARDCORE / BLITZ boards (mouse + controller), a HARDCORE run on its own board; no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
