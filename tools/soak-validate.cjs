const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
(async()=>{
 const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const report={simulationSeconds:600,seed:49374,notes:['Accelerated fixed-step simulation; invulnerability and automatic upgrade selection are test-only.','Draw timing is headless-browser CPU submission timing, not measured display FPS or physical-GPU frame latency.','Audio disabled for simulation timing; separately validated by audio check.'],scenarios:[]};
 try {
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 const root=path.resolve(__dirname,'..');
 await context.addInitScript(()=>{ try{localStorage.setItem('vexolith_tutorial_seen','1');localStorage.setItem('vexolith_intro_seen','1');localStorage.setItem('vexolith_slot_tip_seen','1');}catch{} window.requestAnimationFrame=()=>1; let seed=49374; Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}; });
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()); if(url.hostname!=='127.0.0.1')return route.abort();
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(path.relative(root,file).startsWith('..'))return route.abort();
  try {let body=await fs.readFile(file); if(url.pathname==='/js/main.js') body=Buffer.from(body.toString().replace('() => new Game()', '() => (globalThis.__game = new Game())'));
   await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});
  }catch{await route.fulfill({status:404,body:'Not found'});}
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8096/?unlockall=1');
 await page.evaluate(()=>{const g=__game;g.splash.dismiss();g.startGame({picked:true});g.sound.enabled=false;g.sound.stopMusic();g.autoAim=true;g.__stats={ticks:0,maxEnemies:0,maxBullets:0,maxSparks:0,updates:[],maxPending:0};});
 for(let chunk=0;chunk<60;chunk++) await page.evaluate(chunk=>{
  const g=__game,s=g.__stats;g.keys={};g.keys[['KeyD','KeyS','KeyA','KeyW'][Math.floor(chunk/4)%4]]=true;
  const begin=performance.now();
  for(let i=0;i<600;i++){
   if(g.state==='UPGRADE')g.selectUpgrade(0);
   if(g.state==='CHEST')g.closeChestModal();
   g.player.invuln=1;g.update(1/60);s.ticks++;
   s.maxEnemies=Math.max(s.maxEnemies,g.enemyManager.enemies.length);
   s.maxPending=Math.max(s.maxPending,g.enemyManager.spawnIndicators.length);
   s.maxBullets=Math.max(s.maxBullets,g.bullets.length);
   s.maxSparks=Math.max(s.maxSparks,g.particles.sparks.length);
   const values=[g.player.x,g.player.y,g.player.hp,g.player.xp,g.elapsedTime,g.score,...g.enemyManager.enemies.flatMap(e=>[e.x,e.y,e.hp])];
   if(!values.every(Number.isFinite))throw Error('Non-finite simulation state');
   if(g.state==='GAMEOVER')throw Error('Unexpected game over during invulnerable soak');
   if(g.enemyManager.enemies.length+g.enemyManager.spawnIndicators.length>g.enemyManager.maxEnemies)throw Error('Population budget exceeded');
  }
  s.updates.push((performance.now()-begin)/600);
 },chunk);
 report.simulation=await page.evaluate(()=>{const g=__game;return {...g.__stats,elapsed:g.elapsedTime,wave:g.wave,kills:g.kills,level:g.player.level,rocks:g.rocksMined,cores:g.sessionCores};});
 // Measure a reproducible crowded late-wave workload, with full effects intact.
 await page.evaluate(()=>{const g=__game;g.resetRun();g.state='PLAYING';g.wave=20;g.sound.enabled=false;for(let i=0;i<200;i++){let a=i*Math.PI*2/200;g.enemyManager.queueSpawn(i%5===0?'weaver':'swarmer',g.player.x+Math.cos(a)*(100+i%12*18),g.player.y+Math.sin(a)*(100+i%12*18),g.getWaveScale(),{instant:true});}g.enemyManager.update(1/60,g.player,[],g.grid,g.particles,g.worldWidth,g.worldHeight);g.autoAim=true;});
 for(const size of [[1280,720],[3840,2160]]) {
  await page.setViewportSize({width:size[0],height:size[1]});
  await page.waitForTimeout(100);
  const result=await page.evaluate(size=>{
   const g=__game;g.width=size[0];g.height=size[1];g.canvas.width=size[0];g.canvas.height=size[1];g.camX=g.player.x-size[0]/2;g.camY=g.player.y-size[1]/2;
   const draws=[],updates=[];
   for(let i=0;i<60;i++){g.player.invuln=1;let t=performance.now();g.update(1/60);updates.push(performance.now()-t);t=performance.now();g.draw();draws.push(performance.now()-t);}
   const summarize=a=>{a.sort((x,y)=>x-y);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a[a.length-1]};};
   return {viewport:size,enemies:g.enemyManager.enemies.length,updateMs:summarize(updates),drawSubmissionMs:summarize(draws)};
  },size);report.scenarios.push(result);
  await page.screenshot({path:path.resolve(root,'soak-'+size.join('x')+'.png')});
 }
 report.errors=errors;if(errors.length)throw Error(errors.join('\n'));
 await fs.writeFile(path.resolve(root,'VALIDATION_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
