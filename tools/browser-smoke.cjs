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
 await page.locator('#btn-start-game').click();
 await page.waitForTimeout(1200);
 await page.keyboard.press('p');
 if(!await page.locator('#pause-modal').isVisible()) throw Error('Pause did not open');
 await page.locator('#btn-resume-game').click();
 if(await page.locator('#pause-modal').isVisible()) throw Error('Resume did not close pause');
 await page.locator('#hud-volume-slider').focus();
 await page.keyboard.press('p');
 if(!await page.locator('#pause-modal').isVisible()) throw Error('Slider swallowed pause');
 await page.locator('#btn-pause-restart').click();
 await page.keyboard.press('t');
 if(!await page.locator('#tuner-drawer').isVisible()) throw Error('Tuner did not open');
 await page.keyboard.press('t');
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
 await blocked.locator('#btn-start-game').click();
 await blocked.keyboard.press('p');
 if(!await blocked.locator('#pause-modal').isVisible()) throw Error('Blocked-storage boot failed');
 if(errors.length) throw Error(errors.join('\n'));
 console.log('Browser smoke PASS: boot, play, pause/resume, slider shortcuts, restart, tuner, both canvas renders, blocked-storage boot; no page errors.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
