// Weapon media: records a short looping clip of every weapon, and of every Breakthrough on its own, from
// the real game's Weapon Range, and writes them to assets/weapons/ as animated WebP. The Field Guide's
// weapon cards show <id>.webp; the Breakthrough pick shows <id>-<level>.webp on the TRANSFORM card.
//
//   node tools/weapon-media.cjs [playwright module path] [--only blaster,rockets-12] [--jobs 3]
//
// Re-run it (npm run weapon-media) for a new weapon or Breakthrough, or when one looks different. A
// weapon clip is the weapon at WEAPON_CLIP_LEVEL (before its first Breakthrough); a Breakthrough clip is
// the weapon at that milestone with only that Breakthrough (earlier milestones take the generic boost),
// so each clip shows exactly what the card adds. Randomness is seeded, so a run captures the same frames.
// Needs ffmpeg (libwebp) on PATH. Set BROWSER_EXECUTABLE to use a specific Chromium build.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'assets', 'weapons');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = flag('--only') ? new Set(flag('--only').split(',')) : null;
const jobs = Math.max(1, Number(flag('--jobs')) || 3);
const playwrightPath = args.find((a, i) => !a.startsWith('--') && !['--only', '--jobs'].includes(args[i - 1]));

const VIEW = { width: 960, height: 540 };
const OUT_WIDTH = 360; // shown ~320 css px wide in the Field Guide and on the Breakthrough card
const WEAPON_CLIP_LEVEL = 5;
const BREAKTHROUGH_LEVELS = [6, 12, 18];
const FRAMES = 40; // per clip, unless a tweak says otherwise
const EVERY = 4; // sim ticks per frame: 15 fps
const WARMUP = 120; // ticks before the first frame, so deployables, orbits and clouds are already out
const ZOOM = 1.85; // close enough that the ship, the targets and the weapon's effect read at card size

// The ship sits still in a close ring of still targets (wave HP, so they break and come back) and lets the
// weapon work. Per-weapon tweaks: `drift` flies the ship in a slow loop (trails and dash effects need it),
// `dash` dashes every N ticks (dash-triggered effects), `dummies` overrides the targets (CHASERS follow),
// `orbit` circles the start point at that radius, `fixedCam` holds the camera on the start point, `release`
// turns still targets into chasers at that frame, `frames` lengthens the loop, `warmup` the lead-in before
// it, `zoom` frames closer, `camShift` holds the camera that far off the start point (world px) so a
// weapon that reaches far one way (a LINE of targets) keeps the ship and its whole reach in shot.
const CHASERS = { formation: 'ring', count: 16, move: 'ai' }; // targets that follow a moving ship
const TWEAKS = {
  gas: { drift: true, dash: 70, dummies: CHASERS },
  shockfield: { drift: true, dash: 60, dummies: CHASERS },
  harpoon: { dummies: { ...CHASERS, count: 20 }, frames: 48 }, // chasers to skewer, yank and crush
  // Mines drop behind the ship: it circles outside a ring of still targets under a fixed camera, laying a
  // ring of armed mines in shot; a second in, the targets are released and charge through them.
  mines: { orbit: 170, fixedCam: true, zoom: 1.4, warmup: 360, frames: 60, release: 15, dummies: { count: 10 } },
  lightning: { frames: 60 }, // strikes are spaced out: a longer loop catches more of them
  quake: { frames: 60 }, // a volley every ~2.6 s: a longer loop catches two of them
  // The blade ring orbits outside the default close ring: 32 targets spread the close ring onto the blades' path.
  orbitals: { dummies: { count: 32 } },
  // The vortex flies out and drags the ring after it: a wider frame keeps it in shot.
  singularity: { zoom: 1.5 },
  // Swarms fly out to a pack ahead of the ship: the frame holds both, so the launch, the flight and the
  // feeding all read.
  nanites: { zoom: 1.4, fixedCam: true, camShift: { x: 170, y: 0 }, dummies: { formation: 'pack', count: 16 } },
  // A piercing line reads best against a LINE of targets: the ship sits left of frame and every charge
  // skewers the whole row to the edge.
  raillance: { zoom: 1.5, fixedCam: true, camShift: { x: 170, y: 0 }, dummies: { formation: 'line', count: 8 } }
};

(async () => {
  const { chromium } = require(playwrightPath || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const { weaponIds, extras } = await listWeapons(browser);
  const clips = [];
  for (const id of weaponIds) {
    clips.push({ name: id, weapon: id, level: WEAPON_CLIP_LEVEL, bt: {} });
    for (const lv of BREAKTHROUGH_LEVELS) {
      const bt = {};
      for (const m of BREAKTHROUGH_LEVELS) if (m <= lv) bt[m] = m === lv ? 'transform' : 'boost';
      clips.push({ name: `${id}-${lv}`, weapon: id, level: lv, bt });
    }
    // Pool transforms added later (EXTRA_TRANSFORMS): at their home milestone, earlier ones the boost.
    for (const t of extras[id] || []) {
      const bt = {};
      for (const m of BREAKTHROUGH_LEVELS) if (m <= t.home) bt[m] = m === t.home ? t.id : 'boost';
      clips.push({ name: `${id}-${t.id}`, weapon: id, level: t.home, bt });
    }
  }
  const todo = clips.filter((c) => !only || only.has(c.name) || only.has(c.weapon));
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-media-'));
  let failed = 0;
  try {
    const queue = [...todo];
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        try { await capture(browser, clip, tmp); } catch (err) { failed++; console.error(`${clip.name}: ${err.message}`); }
      }
    }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await browser.close();
  }
  if (failed) process.exit(1);
})().catch((err) => { console.error(err); process.exit(1); });

// A browser context that serves the repo straight from disk (no server needed), like tutorial-media.
async function openContext(browser) {
  const context = await browser.newContext({ viewport: VIEW });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (path.relative(root, file).startsWith('..')) return route.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
    try { await route.fulfill({ body: await fsp.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  return context;
}

// Weapon ids, read from the game itself (its modules need a browser).
async function listWeapons(browser) {
  const context = await openContext(browser);
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8096/index.html');
    return await page.evaluate(async () => ({
      weaponIds: (await import('/js/loadout.js')).WEAPONS.map((w) => w.id),
      extras: JSON.parse(JSON.stringify((await import('/js/weapon-levels.js')).EXTRA_TRANSFORMS))
    }));
  } finally {
    await context.close();
  }
}

async function capture(browser, clip, tmp) {
  const tweak = TWEAKS[clip.weapon] || {};
  const range = {
    weapons: [{ id: clip.weapon, level: clip.level, custom: false, bt: clip.bt }],
    mods: {},
    dummies: { count: 12, formation: 'close', type: 'swarmer', hp: 'wave', wave: 12, move: 'still', respawn: true, ...tweak.dummies }
  };
  const context = await openContext(browser);
  await context.addInitScript((range) => {
    let s = 1234567;
    Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    try {
      localStorage.setItem('vexolith_weapon_range', range);
      localStorage.setItem('vexolith_tutorial_seen', '1');
      localStorage.setItem('vexolith_intro_seen', '1');
      localStorage.setItem('vexolith_slot_tip_seen', '1');
    } catch {}
  }, JSON.stringify(range));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:8096/index.html');
    await page.locator('#splash-screen').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape'); // past the splash screen
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.locator('#btn-weapon-range').click();
    await page.waitForTimeout(300);

    // Grab the running Game and stop its loop so only our steps advance it (as in tutorial-media).
    await page.evaluate(async ({ zoom }) => {
      const m = await import('/js/main.js');
      const g = await new Promise((resolve) => {
        const update = m.Game.prototype.update;
        m.Game.prototype.update = function (...a) { m.Game.prototype.update = update; resolve(this); return update.apply(this, a); };
      });
      g.loop = () => {};
      window.__cap = g;
      g.player.invuln = 1e9;
      g.autoFire = true;
      g.autoAim = true;
      g.radarVisible = false;
      g.damageNumbers.enabled = false; // not setEnabled: that would save the choice
      g.range.view?.hide?.();
      const style = document.createElement('style');
      style.textContent = '#range-panel { display: none !important; }';
      document.head.appendChild(style);
      g.toggleHud();
      document.querySelectorAll('[class*="hint"]').forEach((el) => { if (/SHOW HUD/.test(el.textContent)) el.remove(); });
      g.viewScale *= zoom; g.renderScale *= zoom; g.width /= zoom; g.height /= zoom;
    }, { zoom: tweak.zoom || ZOOM });

    // `drift`: a slow square loop, as in the tutorial's fly clip.
    // `orbit`: steer round the start point (tangent plus a pull back onto the circle), held as WASD keys.
    const step = (ticks, t0) => page.evaluate(({ ticks, t0, tweak }) => {
      const g = window.__cap;
      const p = g.player;
      g.capHome ||= { x: p.x, y: p.y };
      for (let k = 0; k < ticks; k++) {
        const t = t0 + k;
        const phase = Math.floor(t / 45) % 4;
        if (tweak.orbit) {
          const at = Math.hypot(p.x - g.capHome.x, p.y - g.capHome.y) > 1;
          const dx = at ? p.x - g.capHome.x : 1, dy = at ? p.y - g.capHome.y : 0; // from the centre: head out east
          const d = Math.hypot(dx, dy) || 1;
          const pull = (tweak.orbit - d) / tweak.orbit * 2;
          const vx = -dy / d + (dx / d) * pull, vy = dx / d + (dy / d) * pull;
          g.keys = { KeyD: vx > 0.38, KeyA: vx < -0.38, KeyS: vy > 0.38, KeyW: vy < -0.38 };
        } else {
          g.keys = tweak.drift ? { KeyD: phase === 0 || phase === 1, KeyS: phase === 1 || phase === 2, KeyA: phase === 2 || phase === 3, KeyW: phase === 3 || phase === 0 } : {};
        }
        if (tweak.dash && t % tweak.dash === tweak.dash - 1) g.triggerDash?.();
        g.update(1 / 60);
        if (tweak.fixedCam) {
          g.camX = g.capHome.x + (tweak.camShift?.x || 0) - g.width / 2;
          g.camY = g.capHome.y + (tweak.camShift?.y || 0) - g.height / 2;
        }
      }
      g.player.invuln = 1e9;
      g.draw();
    }, { ticks, t0, tweak });

    const frameDir = path.join(tmp, clip.name);
    fs.mkdirSync(frameDir, { recursive: true });
    const warmup = tweak.warmup || WARMUP;
    await step(warmup, 0);
    const frames = tweak.frames || FRAMES;
    for (let i = 0; i < frames; i++) {
      if (i === tweak.release) {
        await page.evaluate(() => {
          const g = window.__cap;
          g.range.config.dummies.move = 'ai'; // respawns chase too
          for (const e of g.enemyManager.enemies) if (e.tag?.range) e.speed = e.tag.speed;
        });
      }
      if (i > 0) await step(EVERY, warmup + i * EVERY);
      await page.screenshot({ path: path.join(frameDir, `frame-${String(i).padStart(3, '0')}.png`) });
    }
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

    const out = path.join(outDir, `${clip.name}.webp`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(Math.round(60 / EVERY)), '-i', path.join(frameDir, 'frame-%03d.png'),
      '-vf', `scale=${OUT_WIDTH}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', '40', '-compression_level', '6', '-loop', '0', out]);
    console.log(`${clip.name}: ${frames} frames -> ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  } finally {
    await context.close();
  }
}
