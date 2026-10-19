// Frame capture: steps the real game a fixed number of sim ticks per frame (deterministic, so the
// result doesn't depend on how fast the machine renders) and writes the frames, a contact sheet and a
// GIF, for reviewing animations frame by frame.
//
//   node tools/frame-capture.cjs <playwright module path> [options]
//
//   --scene fly|blast|supernova|vortex|range   what to set up (default fly; see SCENES below)
//   --frames N        frames to capture (default 30)
//   --every K         sim ticks (1/60 s) between frames (default 2)
//   --warmup K        ticks to run after the setup before the first frame (default 0)
//   --radius R        blast radius for --scene blast (default 160)
//   --setup "JS"      extra page code run after the scene, with `g` (the Game) and `p` (the player)
//   --range '{json}'  Weapon Range config for --scene range (see js/weapon-range.js sanitizeRangeConfig)
//   --size WxH        viewport (default 1280x720)
//   --crop N          capture an N x N square around the ship instead of the whole view
//   --hud             keep the HUD visible (hidden by default, with its [H] hint, so effects read clearly)
//   --out DIR         output folder (default captures/<scene>); it gets frame-000.png..., sheet.png, anim.gif
//
// Needs ffmpeg on PATH for sheet.png and anim.gif (the frames are written either way). Set
// BROWSER_EXECUTABLE to use a specific Chromium build.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(3);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const scene = opt('scene', 'fly');
const frames = Math.max(1, Number(opt('frames', 30)));
const every = Math.max(1, Number(opt('every', 2)));
const warmup = Math.max(0, Number(opt('warmup', 0)));
const radius = Number(opt('radius', 160));
const [width, height] = opt('size', '1280x720').split('x').map(Number);
const crop = Number(opt('crop', 0));
const out = path.resolve(opt('out', path.join(root, 'captures', scene)));

// Page-side scene setups: `g` is the Game, `p` its player, `a` the CLI options. Each runs once, mid-run.
const SCENES = {
  // Fly right and slightly up: the ship's wake and glow on the grid.
  fly: (g, p) => { g.keys.KeyD = true; g.keys.KeyW = true; },
  // One blast of --radius just right of the ship, through the real weapon-effects path.
  blast: (g, p, a) => {
    g.weaponFx.schedule({ x: p.x + 220, y: p.y, delay: 0, radius: a.radius, damage: 0, hue: 28, source: 'missile', style: 'pop' });
  },
  supernova: (g, p) => { p.bombs = Math.max(1, p.bombs || 0); g.triggerSupernova(); },
  // A Vortex (gravity well enemy) parked beside the ship.
  vortex: (g, p) => { g.enemyManager.queueSpawn('blackhole', p.x + 260, p.y, 1, { instant: true }); },
  // The Weapon Range with a given config (dummies, weapons): enter() starts the run.
  range: () => {}
};

(async () => {
  if (!SCENES[scene]) throw new Error(`unknown --scene ${scene} (${Object.keys(SCENES).join(', ')})`);
  const { chromium } = require(process.argv[2] || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width, height } });
    // Serve the repo straight from disk (no server needed), like tools/browser-smoke.cjs.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (path.relative(root, file).startsWith('..')) return route.abort();
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' };
      try { await route.fulfill({ body: await fsp.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    const range = opt('range', null);
    await context.addInitScript(({ range }) => {
      // Seeded randomness, so the same command captures the same frames.
      let s = 1234567;
      Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      if (range) try { localStorage.setItem('vexolith_weapon_range', range); } catch {}
      try { localStorage.setItem('vexolith_tutorial_seen', '1'); localStorage.setItem('vexolith_slot_tip_seen', '1'); } catch {}
    }, { range });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:8096/index.html');
    await page.locator('#splash-screen').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape'); // past the splash screen
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.locator(scene === 'range' ? '#btn-weapon-range' : '#btn-start-game').click();
    await page.waitForTimeout(400);

    // Grab the running Game, then stop its requestAnimationFrame loop so only stepFrame() advances it.
    await page.evaluate(async ({ setups, scene, radius, setup, hud }) => {
      const m = await import('/js/main.js');
      const g = await new Promise((resolve) => {
        const update = m.Game.prototype.update;
        m.Game.prototype.update = function (...a) { m.Game.prototype.update = update; resolve(this); return update.apply(this, a); };
      });
      g.loop = () => {};
      window.__cap = g;
      const p = g.player;
      p.invuln = 1e9; // a capture never ends in a game over
      if (!hud) {
        g.toggleHud();
        document.getElementById('hud-hidden-hint')?.remove();
        document.querySelectorAll('[class*="hint"]').forEach((el) => { if (/SHOW HUD/.test(el.textContent)) el.remove(); });
      }
      new Function('g', 'p', 'a', `(${setups[scene]})(g, p, a)`)(g, p, { radius });
      if (setup) new Function('g', 'p', setup)(g, p);
    }, { setups: Object.fromEntries(Object.entries(SCENES).map(([k, f]) => [k, f.toString()])), scene, radius, setup: opt('setup', ''), hud: args.includes('--hud') });

    const step = (ticks) => page.evaluate((ticks) => {
      const g = window.__cap;
      for (let i = 0; i < ticks; i++) g.update(1 / 60);
      g.draw();
      const p = g.player;
      return { x: p.x - (g.camX || 0), y: p.y - (g.camY || 0) };
    }, ticks);

    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) if (/^frame-\d+\.png$|^sheet\.png$|^anim\.gif$/.test(f)) fs.unlinkSync(path.join(out, f));
    if (warmup) await step(warmup);
    for (let i = 0; i < frames; i++) {
      const ship = await step(i === 0 ? 0 : every);
      const clip = crop ? {
        x: Math.max(0, Math.min(width - crop, ship.x - crop / 2)),
        y: Math.max(0, Math.min(height - crop, ship.y - crop / 2)),
        width: Math.min(crop, width), height: Math.min(crop, height)
      } : undefined;
      await page.screenshot({ path: path.join(out, `frame-${String(i).padStart(3, '0')}.png`), clip });
    }
    if (errors.length) console.warn('page errors:', errors);

    try {
      const cols = Math.min(5, frames);
      const rows = Math.ceil(frames / cols);
      const input = ['-y', '-loglevel', 'error', '-framerate', '20', '-i', path.join(out, 'frame-%03d.png')];
      execFileSync('ffmpeg', [...input, '-vf', `scale=400:-1,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', path.join(out, 'sheet.png')]);
      execFileSync('ffmpeg', [...input, '-vf', `fps=${Math.round(60 / every)},scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-loop', '0', path.join(out, 'anim.gif')]);
    } catch (err) {
      console.warn('ffmpeg step skipped:', err.message);
    }
    console.log(`captured ${frames} frames of '${scene}' (${every} ticks apart) -> ${out}`);
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
