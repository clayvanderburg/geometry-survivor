const { chromium } = require(process.argv[2] || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'chrome'})});
 try {
 const context = await browser.newContext({viewport:{width:1280,height:720}});
 // Fulfill local assets directly so this smoke test also works with loopback networking disabled.
 const fs = require('node:fs/promises'), path = require('node:path');
 const root = path.resolve(__dirname,'..');
 await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if(url.hostname !== '127.0.0.1') return route.abort();
   const file = path.resolve(root,'.'+(url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
   if(path.relative(root,file).startsWith('..')) return route.abort();
   try { await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)] || 'application/octet-stream'}); }
   catch { await route.fulfill({status:404,body:'Not found'}); }
 });
 const page = await context.newPage();
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8096');
 // Splash: the key art covers the title; a key continues to the title (and does not launch a run).
 await page.locator('#splash-screen').waitFor({state:'visible'});
 await page.keyboard.press('Space');
 await page.locator('#splash-screen').waitFor({state:'hidden'});
 if(!await page.locator('#title-modal').isVisible()) throw Error('The splash should give way to the title, not a run');
 // Every refresh shows it again.
 await page.reload();
 await page.locator('#splash-screen').waitFor({state:'visible'});
 await page.keyboard.press('Enter');
 await page.locator('#splash-screen').waitFor({state:'hidden'});
 await page.waitForTimeout(500);
 if(await page.locator('#tutorial-modal').isVisible()) throw Error('The tutorial waits for the first LAUNCH');
 // Game mode selector next to LAUNCH: three choices, NORMAL by default, [3] picks BLITZ and the run wears its badge.
 if(await page.locator('#mode-select [data-game-mode]').count() !== 3) throw Error('Title needs the NORMAL / HARDCORE / BLITZ selector');
 if(await page.locator('#mode-select [aria-checked="true"]').getAttribute('data-game-mode') !== 'normal') throw Error('NORMAL is the default mode');
 await page.keyboard.press('3');
 if(await page.locator('#mode-select [aria-checked="true"]').getAttribute('data-game-mode') !== 'blitz') throw Error('[3] should pick BLITZ');
 await page.locator('#btn-start-game').click();
 // First LAUNCH: the tutorial comes first; NEXT / BACK move, SKIP closes it for good and starts the run.
 await page.locator('#tutorial-modal').waitFor({state:'visible'});
 if(!await page.locator('#title-modal').isVisible()) throw Error('The run should wait for the tutorial');
 await page.locator('#btn-tutorial-next').click();
 if(!/2 \/ 6/.test(await page.locator('#tutorial-body .tutorial-count').innerText())) throw Error('NEXT should show slide 2');
 await page.keyboard.press('ArrowLeft');
 if(!/1 \/ 6/.test(await page.locator('#tutorial-body .tutorial-count').innerText())) throw Error('Left arrow should go back to slide 1');
 await page.locator('#btn-tutorial-skip').click();
 if(await page.locator('#tutorial-modal').isVisible()) throw Error('SKIP TUTORIAL did not close it');
 if(await page.evaluate(()=>localStorage.getItem('vexolith_tutorial_seen'))!=='1') throw Error('Skipping should remember the tutorial was seen');
 await page.waitForTimeout(1200);
 if(await page.locator('#title-modal').isVisible()) throw Error('Skipping the first-launch tutorial should start the run');
 if(await page.locator('#mode-hud-badge').innerText() !== '⚡ BLITZ') throw Error('A BLITZ run needs its HUD badge');
 await page.keyboard.press('p');
 if(!await page.locator('#pause-modal').isVisible()) throw Error('Pause did not open');
 await page.locator('#btn-resume-game').click();
 if(await page.locator('#pause-modal').isVisible()) throw Error('Resume did not close pause');
 await page.locator('#hud-volume-slider').focus();
 await page.keyboard.press('p');
 if(!await page.locator('#pause-modal').isVisible()) throw Error('Slider swallowed pause');
 await page.locator('#btn-pause-restart').click();
 await page.keyboard.press('t');
 if(await page.locator('#tuner-drawer').isVisible()) throw Error('Plain T must not open the hidden tuner');
 if(await page.locator('text=/TUNER|TUNING/ >> visible=true').count()) throw Error('A tuner link is visible to players');
 await page.keyboard.press('Shift+Alt+KeyT');
 if(!await page.locator('#tuner-drawer').isVisible()) throw Error('Shift+Alt+T did not open the tuner');
 await page.keyboard.press('Shift+Alt+KeyT');
 await page.waitForTimeout(3000);
 await page.screenshot({path:'gameplay-smoke.png'});
 const tuner = await context.newPage();
 tuner.on('pageerror', e=>errors.push(e.message));
 await tuner.goto('http://127.0.0.1:8096/tuner.html');
 await tuner.waitForTimeout(500);
 await tuner.screenshot({path:'tuner-smoke.png'});
 const blocked = await context.newPage();
 blocked.on('pageerror', e=>errors.push(e.message));
 await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage unavailable','SecurityError');}}));
 await blocked.goto('http://127.0.0.1:8096');
 // Storage blocked: the splash still shows, and a click continues.
 await blocked.locator('#splash-screen').click();
 await blocked.locator('#splash-screen').waitFor({state:'hidden'});
 // Patch notes with storage blocked: NEW badge shows, the notes open and close, and the badge clears for the session.
 if(await blocked.locator('#notes-modal').isVisible()) throw Error('Patch notes must not open by themselves');
 if(!await blocked.locator('#btn-title-notes [data-notes-badge]').isVisible()) throw Error('PATCH NOTES needs its NEW badge');
 if(!/^v\d+\.\d+\.\d+$/.test(await blocked.locator('#title-modal .version-tag').innerText())) throw Error('Title needs the version tag');
 await blocked.locator('#btn-title-notes').click();
 if(!await blocked.locator('#notes-modal').isVisible()) throw Error('PATCH NOTES did not open');
 await blocked.keyboard.press('Escape');
 if(await blocked.locator('#notes-modal').isVisible()) throw Error('Esc did not close the patch notes');
 if(await blocked.locator('#btn-title-notes [data-notes-badge]').isVisible()) throw Error('Reading the notes should clear the badge');
 await blocked.locator('#mode-select [data-game-mode="hardcore"]').click();
 await blocked.locator('#btn-start-game').click();
 // Storage blocked: the first LAUNCH still shows the tutorial (it can't know it was seen); Esc skips into the run.
 await blocked.locator('#tutorial-modal').waitFor({state:'visible'});
 await blocked.keyboard.press('Escape');
 if(await blocked.locator('#tutorial-modal').isVisible()) throw Error('Esc did not skip the tutorial');
 await blocked.waitForTimeout(300);
 await blocked.keyboard.press('p');
 if(!await blocked.locator('#pause-modal').isVisible()) throw Error('Blocked-storage boot failed');
 if(errors.length) throw Error(errors.join('\n'));
 console.log('Browser smoke PASS: boot, play, pause/resume, slider shortcuts, restart, tuner, both canvas renders, game mode selector + HUD badge, splash (every load and refresh, key continues to the title), first-launch tutorial (next/back/skip into the run/remembered), blocked-storage boot + tutorial + patch notes + mode pick; no page errors.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
