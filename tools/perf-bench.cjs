// Performance bench: frame time of the real game in headless Chromium on heavy late-game scenes.
// Each scene is a normal run (LAUNCH) rebuilt with a 6-weapon LV 18 loadout (every Breakthrough a
// transform), held at a late wave with the ship circling, invulnerable. The game is stepped one sim tick
// (1/60 s) per frame, so the workload is the same on every machine and before / after a change.
//
//   node tools/perf-bench.cjs <playwright module path> [options]
//
//   --scenes a,b      which scenes (default all; see SCENES)
//   --frames N        measured frames per scene (default 600)
//   --warmup N        ticks before measuring, so the swarm, clouds and deployables are out (default 900)
//   --size WxH        viewport (default 1920x1080)
//   --reduce          REDUCE EFFECTS on
//   --profile DIR     also take a JS CPU profile of each scene's measured frames: DIR/<scene>.cpuprofile
//                     (open in Chrome DevTools) and the top functions by self time in the output
//   --phases          attribute draw + raster time to each subsystem's draw call (flushes around each, so
//                     the totals run higher than a plain frame; use it to rank, not to compare frames)
//   --natural N       then run the game's own rAF loop for N frames (default 120; 0 skips): rAF interval,
//                     time inside the loop, and Chromium's style recalc / layout ms per frame
//   --snap DIR        instead of timing, save the canvas after the warmup and every 30 ticks (5 frames) as
//                     raw RGBA (DIR/<scene>-<n>.rgba), with performance.now() stepped 1/60 s per tick so
//                     two runs draw the same frames; `--diff DIR_A DIR_B` compares two such folders
//   --css "..."       levelup scene: extra CSS once the hand is dealt (e.g. try a modal style)
//   --no-game-draw    levelup scene: stop drawing the canvas under the modal
//   --mutations       print the DOM mutations per element during the --natural frames
//   --json FILE       write the results
//
// cpu ms = update + draw (the JS side of a frame: simulation and canvas calls). raster ms = a 1 px
// readback after the frame, which makes the canvas rasterize it; headless Chromium rasterizes in software
// (SwiftShader), far slower than a real GPU, so read it as a ranking of fill cost, not a frame time.
// Both are times in headless Chromium, not display latency: compare runs on the same machine. Scenes with DOM motion (the level-up modal) also report rAF intervals of the
// game's own loop.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(3);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; };
const FRAMES = Number(opt('frames', 600));
const WARMUP = Number(opt('warmup', 900));
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const PROFILE = opt('profile', null);
const REDUCE = args.includes('--reduce');
const FLUSH = !args.includes('--no-flush');
const GPU = !args.includes('--no-gpu');
const PHASES = args.includes('--phases');
const NATURAL = Number(opt('natural', 120));
const SNAP = opt('snap', null);

const LOADOUT_A = ['drones', 'flamethrower', 'gas', 'lightning', 'singularity', 'grenades'];
const LOADOUT_B = ['harpoon', 'cryospray', 'acidspray', 'missiles', 'nanites', 'rockets'];
const SCENES = {
  swarm35: { wave: 35, weapons: LOADOUT_A },
  swarm45: { wave: 45, weapons: LOADOUT_B },
  boss40: { wave: 40, weapons: LOADOUT_A, boss: 'conductor' },
  levelup: { wave: 35, weapons: LOADOUT_A, levelUp: true }
};
const pick = opt('scenes', null);
const sceneIds = pick ? pick.split(',') : Object.keys(SCENES);

if (args.includes('--diff') || process.argv[2] === '--diff') {
  const all = process.argv.slice(2);
  const i = all.indexOf('--diff');
  const [a, b] = [all[i + 1], all[i + 2]];
  let worst = 0;
  const diverged = new Set();
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.trace'))) {
    if (!fs.existsSync(path.join(b, f))) continue;
    const ta = fs.readFileSync(path.join(a, f), 'utf8').split('\n'), tb = fs.readFileSync(path.join(b, f), 'utf8').split('\n');
    const at = ta.findIndex((v, k) => v !== tb[k]);
    if (at >= 0) { diverged.add(f.replace('.trace', '')); console.log(`${f.replace('.trace', '')}: the simulation diverged at tick ${at} (nondeterministic run): snap it again`); }
  }
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.rgba')).sort()) {
    if (!fs.existsSync(path.join(b, f)) || diverged.has(f.replace(/-\d+\.rgba$/, ''))) continue;
    const A = fs.readFileSync(path.join(a, f)), B = fs.readFileSync(path.join(b, f));
    if (A.length !== B.length) { console.log(`${f}: size differs`); worst = 255; continue; }
    let max = 0, over2 = 0, sum = 0;
    for (let k = 0; k < A.length; k++) {
      if ((k & 3) === 3) continue;
      const d = Math.abs(A[k] - B[k]);
      if (d > max) max = d;
      if (d > 2) over2++;
      sum += d;
    }
    worst = Math.max(worst, max);
    console.log(`${f}: max ${max}/255 · mean ${(sum / (A.length * 0.75)).toFixed(4)} · channels > 2/255: ${over2}`);
  }
  process.exit(0);
}

(async () => {
  const { chromium } = require(args.length && !process.argv[2].startsWith('--') ? process.argv[2] : 'playwright');
  const browser = await chromium.launch({ headless: true, args: GPU ? [] : ['--disable-gpu', '--disable-accelerated-2d-canvas'], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const out = { size: [W, H], frames: FRAMES, warmup: WARMUP, reduce: REDUCE, scenes: {} };
  try {
    for (const id of sceneIds) out.scenes[id] = await runScene(browser, id, SCENES[id]);
  } finally {
    await browser.close();
  }
  const json = opt('json', null);
  if (json) fs.writeFileSync(json, JSON.stringify(out, null, 1));
  for (const [id, s] of Object.entries(out.scenes)) {
    if (s.snap) { console.log(`${id}: snapshots in ${s.snap}${s.errors.length ? ' errors: ' + s.errors.join('; ') : ''}`); continue; }
    const f = (o) => `p50 ${o.p50.toFixed(2)} · p95 ${o.p95.toFixed(2)} · max ${o.max.toFixed(1)}`;
    console.log(`${id.padEnd(9)} cpu ${f(s.frame)} | update ${f(s.update)} | draw ${f(s.draw)} | raster ${f(s.raster)} | geoms ${s.counts.geomsInView}/${s.counts.geoms} (gold ${s.counts.gold}) enemies ${s.counts.enemies} sparks ${s.counts.sparks} bullets ${s.counts.bullets}`);
    if (s.raf) console.log(`${''.padEnd(9)} rAF interval ${f(s.raf)} | loop ${f(s.loop)} | style ${s.dom.styleMs.toFixed(2)} ms (${s.dom.styles.toFixed(1)}x) · layout ${s.dom.layoutMs.toFixed(2)} ms (${s.dom.layouts.toFixed(1)}x) per frame`);
    if (s.phases) for (const [k, v] of Object.entries(s.phases)) if (v >= 0.2) console.log(`${''.padEnd(11)}${v.toFixed(2).padStart(7)} ms/frame  ${k}`);
    if (s.top) for (const t of s.top) console.log(`${''.padEnd(11)}${t.selfMs.toFixed(0).padStart(6)} ms ${(t.share * 100).toFixed(1).padStart(5)}%  ${t.fn}  ${t.at}`);
  }
})().catch((err) => { console.error(err); process.exit(1); });

async function openContext(browser) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.addInitScript(({ reduce, snap }) => {
    if (snap) {
      // Real time until the scene is set up, then a clock that steps 1/60 s per tick.
      const real = performance.now.bind(performance);
      let now = null;
      performance.now = () => now ?? real();
      window.__freeze = () => { now = 1e6; };
      window.__tick = () => { if (now !== null) now += 1000 / 60; };
    }
    let s = 1234567;
    Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    try {
      localStorage.setItem('vexolith_tutorial_seen', '1');
      localStorage.setItem('vexolith_intro_seen', '1');
      localStorage.setItem('vexolith_slot_tip_seen', '1');
      localStorage.setItem('vexolith_reduce_effects', reduce ? '1' : '0');
    } catch {}
  }, { reduce: REDUCE, snap: !!SNAP });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (path.relative(root, file).startsWith('..')) return route.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
    try {
      let body = await fsp.readFile(file);
      if (PHASES && url.pathname === '/js/main.js') body = Buffer.from(markDrawPhases(body.toString()));
      await route.fulfill({ body, contentType: types[path.extname(file)] || 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  return context;
}

// --phases: Game.draw() is cut into its top-level statements; each is timed (flushed before and after)
// under its line range in js/main.js, e.g. "main.js:6870-6890 grid.draw".
function markDrawPhases(src) {
  const start = src.indexOf('\n  draw() {\n') + 1;
  const end = src.indexOf('\n  }\n', start);
  const line0 = src.slice(0, start).split('\n').length; // 1-based line of "  draw() {"
  const lines = src.slice(start, end).split('\n');
  let from = 1;
  const out = [lines[0], 'globalThis.__phA?.();'];
  for (let i = 1; i < lines.length; i++) {
    out.push(lines[i]);
    const l = lines[i];
    const next = (lines[i + 1] || '').trim();
    if (!/^ {4}\S/.test(l) || !/[;}]\s*(\/\/.*)?$/.test(l) || /^(else|catch|finally|\)|\.)/.test(next)) continue;
    const chunk = lines.slice(from, i + 1).join('\n');
    const call = (chunk.match(/([A-Za-z_$][\w$.?]*)\s*\(ctx/) || [])[1] || '';
    out.push(`globalThis.__phB?.(${JSON.stringify(`main.js:${line0 + from}-${line0 + i} ${call.replace(/^this\./, '')}`)}); globalThis.__phA?.();`);
    from = i + 1;
  }
  return src.slice(0, start) + out.join('\n') + src.slice(end);
}

async function runScene(browser, id, scene) {
  const context = await openContext(browser);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:8096/index.html');
    await page.locator('#splash-screen').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.locator('#btn-start-game').click();
    await page.waitForTimeout(400);
    if (await page.locator('#start-pick-modal:not(.hidden)').count()) {
      await page.locator('#start-pick-options > *').first().click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(async (scene) => {
      const m = await import('/js/main.js');
      const g = await new Promise((resolve) => {
        const update = m.Game.prototype.update;
        m.Game.prototype.update = function (...a) { m.Game.prototype.update = update; resolve(this); return update.apply(this, a); };
      });
      window.__loop = g.loop;
      g.loop = () => {};
      window.__g = g;
      const { applyRangeLoadout } = await import('/js/weapon-range.js');
      // Sets the scene up (seeded). --snap calls it inside the same synchronous evaluate as the frames it
      // saves, so no timer can draw on Math.random in between.
      g.__start = () => {
        let seed = 7654321;
        Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        if (window.__freeze) {
          // Start the run over, so nothing from the real-time frames before this point carries on.
          window.__freeze();
          g.resetRun();
          g.state = 'PLAYING';
          const c = g.ctx || g.canvas.getContext('2d');
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.clearRect(0, 0, g.canvas.width, g.canvas.height); // frames fade out over several draws
          g.sound.getBeatPulse = () => 0; // the music clock is real time
          if (g.replayRec) g.replayRec.disabled = true;
        }
        g.shieldRotation = 0;
        const p = g.player;
        p.invuln = 1e9;
        g.sound.enabled = false;
        g.sound.stopMusic?.();
        g.autoFire = true;
        g.autoAim = true;
        applyRangeLoadout(p, { weapons: scene.weapons.map((id) => ({ id, level: 18, custom: false, bt: { 6: 'transform', 12: 'transform', 18: 'transform' } })), mods: {} });
        g.wave = scene.wave;
        g.enemyManager.wave = scene.wave;
        g.__kite = { x: p.x, y: p.y, t: 0, r: 380 };
        g.__hold = () => {
          window.__tick?.();
          g.frameSeconds = 1 / 60;
          g.waveTimer = Math.min(g.waveTimer, 5); // stay on this wave
          g.pendingBossSpawns.length = 0;
          const k = g.__kite;
          k.t += 1 / 60;
          p.x = k.x + Math.cos(k.t * 150 / k.r) * k.r;
          p.y = k.y + Math.sin(k.t * 150 / k.r) * k.r;
          p.invuln = 1e9;
          if (g.state === 'UPGRADE' && !g.__keepModal) g.selectUpgrade?.(0);
          if (g.state === 'CHEST') g.closeChestModal?.();
        };
        if (scene.boss) g.enemyManager.queueSpawn(scene.boss, p.x + 420, p.y, g.getWaveScale(), { instant: true, wave: scene.wave });
      };
      if (!window.__freeze) g.__start();
    }, scene);
    // Warm up in chunks (one long evaluate would trip the protocol timeout on a slow machine).
    for (let done = 0; !SNAP && done < WARMUP; done += 300) {
      await page.evaluate((n) => { const g = window.__g; for (let i = 0; i < n; i++) { g.__hold(); g.update(1 / 60); } g.draw(); }, Math.min(300, WARMUP - done));
    }
    if (scene.boss && !SNAP) {
      await page.evaluate((scene) => {
        const g = window.__g;
        // The boss may have died in the warmup: bring a fresh one in at full HP.
        if (!g.enemyManager.enemies.some((e) => e.isBoss)) g.enemyManager.queueSpawn(scene.boss, g.player.x + 420, g.player.y, g.getWaveScale(), { instant: true, wave: scene.wave });
        for (const e of g.enemyManager.enemies) if (e.isBoss) { e.maxHp *= 50; e.hp = e.maxHp; }
      }, scene);
    }
    if (scene.levelUp && !SNAP) {
      await page.evaluate(() => { const g = window.__g; g.__keepModal = true; g.player.stats.luck = 6; g.triggerLevelUp(); });
      await page.waitForTimeout(600); // the hand deals in
      if (opt('css', null)) await page.addStyleTag({ content: opt('css', null) });
      if (args.includes('--no-game-draw')) await page.evaluate(() => { window.__g.draw = () => {}; });
    }

    if (SNAP) {
      fs.mkdirSync(SNAP, { recursive: true });
      await page.evaluate((warmup) => {
        const g = window.__g;
        g.__start();
        // Math.random calls per tick: two runs that drew the same frames made the same calls. (Rarely a run
        // still diverges, e.g. a chain arc picks another hop; --diff reports that instead of a pixel diff.)
        const rnd = Math.random;
        let calls = 0;
        Math.random = () => { calls++; return rnd(); };
        const trace = window.__trace = [];
        const frames = window.__snaps = [];
        for (let n = 0; n < 5; n++) {
          for (let i = 0, ticks = n === 0 ? warmup : 30; i < ticks; i++) { g.__hold(); g.update(1 / 60); trace.push(calls); }
          // A row of each pickup kind in view for this frame, so every pickup's drawing is compared.
          const extra = [];
          for (let k = 0; k < 12; k++) {
            const kind = ['isGold', 'isBomb', 'isCore', null][k % 4];
            const o = { x: g.camX + 200 + k * 130, y: g.camY + 160 + (k % 3) * 40, vx: 0, vy: 0, xp: 1, hue: 150 + k * 9, rotation: k * 0.7 };
            if (kind) o[kind] = true;
            extra.push(o);
          }
          g.geoms.push(...extra);
          g.draw();
          g.geoms.length -= extra.length;
          frames.push((g.ctx || g.canvas.getContext('2d')).getImageData(0, 0, g.canvas.width, g.canvas.height).data);
        }
      }, WARMUP);
      fs.writeFileSync(path.join(SNAP, `${id}.trace`), (await page.evaluate(() => window.__trace)).join('\n'));
      for (let n = 0; n < 5; n++) {
        const b64 = await page.evaluate((n) => {
          const d = window.__snaps[n];
          let bin = '';
          for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
          return btoa(bin);
        }, n);
        fs.writeFileSync(path.join(SNAP, `${id}-${n}.rgba`), Buffer.from(b64, 'base64'));
      }
      return { snap: SNAP, errors };
    }
    if (PHASES) {
      await page.evaluate(() => {
        const g = window.__g;
        const ctx = g.ctx || g.canvas.getContext('2d');
        const acc = window.__phases = {};
        const flush = () => ctx.getImageData(0, 0, 1, 1);
        let mark = 0;
        globalThis.__phA = () => { flush(); mark = performance.now(); };
        globalThis.__phB = (label) => { flush(); acc[label] = (acc[label] || 0) + performance.now() - mark; };
        const wrap = (obj, name, label) => {
          const fn = obj?.[name];
          if (typeof fn !== 'function' || fn.__wrapped) return;
          const w = function (...a) {
            flush();
            const t0 = performance.now();
            const r = fn.apply(this, a);
            flush();
            acc[label] = (acc[label] || 0) + performance.now() - t0;
            return r;
          };
          w.__wrapped = true;
          obj[name] = w;
        };
        for (const [k, v] of Object.entries(g)) {
          if (!v || typeof v !== 'object' || k === 'ctx' || k === 'canvas') continue;
          for (const m of ['draw', 'drawGround', 'drawAir', 'drawVoid', 'drawWorld', 'drawOverlay']) wrap(v, m, `${k}.${m}`);
        }
        for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(g))) if (/^draw./.test(m)) wrap(g, m, `game.${m}`);
        const draw = g.draw;
        g.draw = function () { flush(); const t0 = performance.now(); draw.call(this); flush(); acc.TOTAL = (acc.TOTAL || 0) + performance.now() - t0; };
        g.replayRec && (g.replayRec.disabled = true);
      });
    }
    let cdp = null;
    if (PROFILE) {
      cdp = await context.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    const samples = { update: [], draw: [], raster: [], frame: [] };
    for (let done = 0; done < FRAMES; done += 120) {
      const r = await page.evaluate(({ n, flush }) => {
        const g = window.__g;
        const ctx = g.ctx || g.canvas.getContext('2d');
        // The instant-replay tape copies the canvas 15 times a second, which makes the canvas rasterize
        // inside draw(): off while measuring, so draw is the JS side alone and raster is measured apart.
        if (g.replayRec) g.replayRec.disabled = true;
        const u = [], d = [], ra = [], f = [];
        for (let i = 0; i < n; i++) {
          g.__hold();
          const t0 = performance.now();
          g.update(1 / 60);
          const t1 = performance.now();
          g.draw();
          const t2 = performance.now();
          if (flush) ctx.getImageData(0, 0, 1, 1);
          const t3 = performance.now();
          u.push(t1 - t0); d.push(t2 - t1); ra.push(t3 - t2); f.push(t2 - t0);
        }
        return { u, d, ra, f };
      }, { n: Math.min(120, FRAMES - done), flush: FLUSH });
      samples.update.push(...r.u); samples.draw.push(...r.d); samples.raster.push(...r.ra); samples.frame.push(...r.f);
    }
    const result = { frame: stats(samples.frame), update: stats(samples.update), draw: stats(samples.draw), raster: stats(samples.raster) };
    if (PHASES) result.phases = await page.evaluate((n) => Object.fromEntries(Object.entries(window.__phases).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / n).toFixed(2)])), FRAMES);
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.mkdirSync(PROFILE, { recursive: true });
      fs.writeFileSync(path.join(PROFILE, `${id}${REDUCE ? '-reduce' : ''}.cpuprofile`), JSON.stringify(profile));
      result.top = topSelf(profile, 25);
    }
    if (NATURAL > 0) {
      // The game's own requestAnimationFrame loop for a while (DOM, CSS animations and compositing included):
      // rAF intervals, time inside the loop, and Chromium's style / layout time per frame.
      const perf = await context.newCDPSession(page);
      await perf.send('Performance.enable');
      const metrics = async () => Object.fromEntries((await perf.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      if (args.includes('--mutations')) await page.evaluate(() => {
        const counts = window.__mut = {};
        const name = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return e ? (e.id || e.className || e.tagName) + (e.id ? '' : '<' + (e.closest('[id]')?.id || '?')) : '?'; };
        new MutationObserver((ms) => { for (const m of ms) { const k = `${m.type}:${m.attributeName || ''}:${name(m.target)}`; counts[k] = (counts[k] || 0) + 1; } })
          .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const m0 = await metrics();
      const r = await page.evaluate(async (n) => {
        const g = window.__g;
        const loop = window.__loop;
        const raf = [], inLoop = [];
        let last = null;
        await new Promise((resolve) => {
          g.loop = function (now) {
            if (last !== null) raf.push(now - last);
            last = now;
            const t0 = performance.now();
            g.__hold();
            loop.call(g, now);
            inLoop.push(performance.now() - t0);
            if (raf.length >= n) { g.loop = () => {}; resolve(); }
          };
          requestAnimationFrame((t) => g.loop(t));
        });
        return { raf, inLoop };
      }, NATURAL);
      const m1 = await metrics();
      if (args.includes('--mutations')) console.log(id, JSON.stringify(await page.evaluate(() => Object.entries(window.__mut).sort((a, b) => b[1] - a[1]).slice(0, 25))));
      const per = (k) => (m1[k] - m0[k]) / NATURAL;
      result.raf = stats(r.raf);
      result.loop = stats(r.inLoop);
      result.dom = { styleMs: per('RecalcStyleDuration') * 1000, layoutMs: per('LayoutDuration') * 1000, styles: per('RecalcStyleCount'), layouts: per('LayoutCount') };
    }
    result.counts = await page.evaluate(() => {
      const g = window.__g;
      const inView = g.geoms.filter((o) => o.x > g.camX - 40 && o.x < g.camX + g.width + 40 && o.y > g.camY - 40 && o.y < g.camY + g.height + 40);
      return { geoms: g.geoms.length, geomsInView: inView.length, gold: inView.filter((o) => o.isGold).length, bombs: inView.filter((o) => o.isBomb).length, cores: inView.filter((o) => o.isCore).length, enemies: g.enemyManager.enemies.length, sparks: g.particles.sparks?.length ?? 0, bullets: g.bullets?.length ?? 0, state: g.state, wave: g.wave };
    });
    if (errors.length) result.errors = errors;
    return result;
  } finally {
    await context.close();
  }
}

function stats(a) {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((x, y) => x + y, 0) / s.length };
}

// Self time per function (name + file:line), from a V8 CPU profile.
function topSelf(profile, n) {
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const nd = byId.get(profile.samples[i]);
    const cf = nd.callFrame;
    const file = (cf.url || '').replace(/^.*\/(js|tools)\//, '$1/');
    const key = `${cf.functionName || '(anonymous)'}\t${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, ms]) => { const [fn, at] = k.split('\t'); return { fn, at, selfMs: ms, share: ms / total }; });
}
