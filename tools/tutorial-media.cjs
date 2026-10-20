// Tutorial media: captures the short looping clips and stills shown in the first-run TUTORIAL slides
// (js/tutorial.js) from the real game, and writes them to assets/tutorial/ as animated WebP.
//
//   node tools/tutorial-media.cjs [playwright module path] [--only fly,mine]
//
// Re-run it whenever a change makes a clip look out of date (ship art, HUD, level-up cards, asteroid
// veins, bosses, the armory). Each CLIPS entry steps the game a fixed number of sim ticks per frame
// with seeded randomness, so a run always captures the same frames. Needs ffmpeg (libwebp) on PATH.
// Set BROWSER_EXECUTABLE to use a specific Chromium build.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'assets', 'tutorial');
const args = process.argv.slice(2);
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;
const playwrightPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');

const VIEW = { width: 960, height: 540 };
const OUT_WIDTH = 480; // clips are shown at most ~520 css px wide; small files matter on phones

// Page-side setups. `g` is the Game, `p` the player. `setup` runs once mid-run; `tick(g, p, i)` runs
// before frame i. `start: false` stays on the title screen. `still: true` writes one frame; with `shot`
// it is the top 16:9 of that element. `view` overrides the viewport. `hud: true` keeps the HUD; with
// `hudKeep` (a selector list) only those parts of it stay visible, and `hudCss` adds capture-only styles
// (e.g. enlarging the shield bar so it reads at clip size).
const CLIPS = {
  // Flying loops with auto-fire through a light swarm.
  fly: {
    frames: 40, every: 4,
    setup: (g, p) => {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        g.enemyManager.queueSpawn(i % 3 ? 'swarmer' : 'pinwheel', p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 300, 1, { instant: true });
      }
    },
    tick: (g, p, i) => {
      const phase = Math.floor(i / 10) % 4;
      g.keys = { KeyD: phase === 0 || phase === 1, KeyS: phase === 1 || phase === 2, KeyA: phase === 2 || phase === 3, KeyW: phase === 3 || phase === 0 };
      if (i === 22) g.triggerDash();
    }
  },
  // Sitting still with the guns off: the swarm piles on and the shield drains from full to almost
  // nothing (blue -> amber -> red). The shield never quite breaks, so the clip never ends in a game over.
  swarm: {
    frames: 50, every: 6, zoom: 1.5, warmup: 10, hud: true,
    hudKeep: '#shield-group',
    hudCss: '#shield-group { transform: scale(2.2); transform-origin: bottom center; }',
    setup: (g, p) => {
      g.wave = 6;
      g.autoFire = false;
      p.invuln = 0;
      p.hp = p.maxHp;
      const floor = p.maxHp * 0.04;
      const hurt = g.damagePlayer;
      g.damagePlayer = function (...a) { hurt.apply(this, a); if (p.hp < floor) p.hp = floor; return false; };
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const r = 260 + (i % 4) * 45;
        const type = ['swarmer', 'swarmer', 'pinwheel', 'weaver'][i % 4];
        g.enemyManager.queueSpawn(type, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.75, 1, { instant: true });
      }
      g.enemyManager.queueSpawn('bruiser', p.x - 260, p.y + 60, 1, { instant: true });
      g.enemyManager.queueSpawn('gunner', p.x + 280, p.y - 90, 1, { instant: true });
    },
    tick: (g, p) => { g.keys = {}; p.vx = p.vy = 0; if (p.hp > p.maxHp * 0.04) p.invuln = Math.min(p.invuln, 0.35); }
  },
  // Drilling into a solid asteroid: the edge breaks into loose chunks, a gold seam and a green shield vein.
  mine: {
    frames: 44, every: 4, zoom: 1.35,
    setup: (g, p) => {
      const rocks = g.asteroidManager.asteroids;
      // A gold vein on the asteroid's left edge (open space where the ship starts), shield nearby.
      const open = (r) => !rocks.some(o => o !== r && Math.hypot(o.x - (r.x - r.radius - 40), o.y - r.y) < o.radius + 30);
      const pick = rocks.find(r => r.oreType === 'gold_vein' && open(r) && rocks.some(o => o.oreType === 'shield_vein' && Math.hypot(o.x - r.x, o.y - r.y) < 150))
        || rocks.find(r => r.oreType === 'gold_vein' && open(r))
        || rocks.find(r => r.oreType === 'gold_vein');
      p.x = pick.x - 170;
      p.y = pick.y;
      p.vx = p.vy = 0;
      p.hp = p.maxHp * 0.55; // a shield vein visibly tops it up
      g.camX = p.x - g.width / 2;
      g.camY = p.y - g.height / 2;
      window.__mineTarget = pick;
      g.autoFire = false;
    },
    tick: (g, p) => {
      const t = window.__mineTarget;
      const target = t && t.hp > 0 && g.asteroidManager.asteroids.includes(t)
        ? t
        : g.asteroidManager.asteroids.filter(r => r.oreType !== 'rock').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (target) window.__mineTarget = target;
      const dx = target ? target.x - p.x : 1, dy = target ? target.y - p.y : 0;
      g.keys = { KeyD: dx > 8, KeyA: dx < -8, KeyS: dy > 8, KeyW: dy < -8 };
    }
  },
  // The level-up hand of a fresh run (2 cards: NEW WEAPON with its slot reward, and an upgrade), with gold
  // to spend on REROLL / LOCK.
  levelup: {
    still: true, hud: true, view: { width: 1600, height: 900 }, shot: '#upgrade-modal .modal-card',
    setup: (g, p) => {
      g.gold = 60;
      p.newWeaponDrought = 99;
      g.applyLiveTuning('FORCE_LEVELUP');
    }
  },
  // The wave-3 Brood Queen warping in next to the ship in open space (the end of its warning, the
  // arrival with her swarmer ring), then closing in while the ship holds its ground and shoots.
  boss: {
    frames: 50, every: 5, zoom: 1.35, warmup: 120, hud: true,
    hudKeep: '#boss-hud',
    hudCss: '#boss-hud { position: fixed !important; top: 10px !important; left: 50% !important; width: 560px !important; margin: 0 !important; transform: translateX(-50%) scale(1.2) !important; transform-origin: top center; } #boss-card { display: none !important; }',
    setup: (g, p) => {
      const rocks = g.asteroidManager.asteroids;
      const clear = (x, y) => rocks.every(r => Math.hypot(r.x - x, r.y - y) > r.radius + 420);
      let spot = null;
      for (let y = 600; y < g.worldHeight - 600 && !spot; y += 120) {
        for (let x = 600; x < g.worldWidth - 600 && !spot; x += 120) if (clear(x, y)) spot = { x, y };
      }
      if (spot) { p.x = spot.x - 140; p.y = spot.y; }
      p.vx = p.vy = 0;
      g.camX = p.x - g.width / 2;
      g.camY = p.y - g.height / 2;
      g.wave = 3;
      g.enemyManager.wave = 3;
      g.spawnCooldown = 999;
      g.queueBossEncounter({ x: p.x + 300, y: p.y - 20, onScreen: true }, g.getWaveScale(), { id: 'brood_queen', wave: 3 });
    },
    tick: (g, p) => {
      g.keys = {};
      p.vx = p.vy = 0;
      g.spawnCooldown = 999;
      const boss = g.enemyManager.enemies.find(e => e.isBoss && !e.dead);
      if (boss) { g.mouse.x = boss.x - g.camX; g.mouse.y = boss.y - g.camY; }
    }
  },
  // The Void Armory on the title screen.
  armory: {
    still: true, start: false, view: { width: 1280, height: 900 },
    shot: '#title-modal [data-m-section="armory"]'
  }
};

(async () => {
  const { chromium } = require(playwrightPath || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-media-'));
  try {
    for (const [name, clip] of Object.entries(CLIPS)) {
      if (only && !only.has(name)) continue;
      const context = await browser.newContext({ viewport: clip.view || VIEW });
      // Serve the repo straight from disk (no server needed), like tools/frame-capture.cjs.
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (path.relative(root, file).startsWith('..')) return route.abort();
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
        try { await route.fulfill({ body: await fsp.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
        catch { await route.fulfill({ status: 404, body: 'Not found' }); }
      });
      await context.addInitScript(() => {
        let s = 1234567;
        Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        try { localStorage.setItem('vexolith_tutorial_seen', '1'); localStorage.setItem('vexolith_slot_tip_seen', '1'); } catch {}
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:8096/index.html');
      await page.locator('#splash-screen').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape'); // past the splash screen
      await page.locator('#splash-screen').waitFor({ state: 'hidden' });
      await page.waitForTimeout(300);
      const frameDir = path.join(tmp, name);
      fs.mkdirSync(frameDir, { recursive: true });

      const shoot = async (file) => {
        const box = clip.shot ? await page.locator(clip.shot).boundingBox() : null;
        const clipRect = box ? { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, box.width * 9 / 16) } : undefined;
        await page.screenshot({ path: file, clip: clipRect });
      };
      if (clip.start === false) {
        await shoot(path.join(frameDir, 'frame-000.png'));
      } else {
        await page.locator('#btn-start-game').click();
        // LAUNCH opens the starting-weapon pick first: take the first card once its double-click guard is past.
        const startPick = page.locator('#start-pick-modal:not(.hidden) #start-pick-options > *');
        if (await startPick.count()) {
          await page.waitForTimeout(350);
          await startPick.first().click();
        }
        await page.waitForTimeout(400);
        // Grab the running Game and stop its loop so only our steps advance it (as in frame-capture).
        await page.evaluate(async ({ setup, hud, zoom, hudKeep, hudCss }) => {
          const m = await import('/js/main.js');
          const g = await new Promise((resolve) => {
            const update = m.Game.prototype.update;
            m.Game.prototype.update = function (...a) { m.Game.prototype.update = update; resolve(this); return update.apply(this, a); };
          });
          g.loop = () => {};
          window.__cap = g;
          const p = g.player;
          p.invuln = 1e9;
          if (zoom) { g.viewScale *= zoom; g.renderScale *= zoom; g.width /= zoom; g.height /= zoom; }
          if (hudKeep) {
            g.radarVisible = false;
            const style = document.createElement('style');
            style.textContent = `#game-container *:not(canvas):not(:is(${hudKeep}, ${hudKeep.split(',').map(k => k.trim() + ' *').join(', ')})) { visibility: hidden !important; transition: none !important; }
              :is(${hudKeep}) { visibility: visible !important; } ${hudCss || ''}`;
            document.head.appendChild(style);
          }
          if (!hud) {
            g.toggleHud();
            document.querySelectorAll('[class*="hint"]').forEach((el) => { if (/SHOW HUD/.test(el.textContent)) el.remove(); });
          }
          new Function('g', 'p', `(${setup})(g, p)`)(g, p);
        }, { setup: clip.setup.toString(), hud: !!clip.hud, zoom: clip.zoom || 0, hudKeep: clip.hudKeep || '', hudCss: clip.hudCss || '' });

        const tick = clip.tick ? clip.tick.toString() : null;
        const step = (ticks, i) => page.evaluate(({ ticks, i, tick }) => {
          const g = window.__cap;
          if (tick) new Function('g', 'p', 'i', `(${tick})(g, p, i)`)(g, g.player, i);
          for (let k = 0; k < ticks; k++) g.update(1 / 60);
          g.player.invuln = Math.min(g.player.invuln, 1e9);
          g.draw();
        }, { ticks, i, tick });

        if (clip.still) {
          await step(2, 0);
          await page.waitForTimeout(300);
          await shoot(path.join(frameDir, 'frame-000.png'));
        } else {
          await step(clip.warmup ?? 20, 0);
          for (let i = 0; i < clip.frames; i++) {
            await step(i === 0 ? 0 : clip.every, i);
            await page.screenshot({ path: path.join(frameDir, `frame-${String(i).padStart(3, '0')}.png`) });
          }
        }
      }
      if (errors.length) console.warn(`${name}: page errors:`, errors);
      await context.close();

      const out = path.join(outDir, `${name}.webp`);
      const input = ['-y', '-loglevel', 'error', '-framerate', String(clip.still ? 1 : Math.round(60 / clip.every)), '-i', path.join(frameDir, 'frame-%03d.png')];
      const scale = `scale=${OUT_WIDTH}:-2:flags=lanczos`;
      if (clip.still) execFileSync('ffmpeg', [...input, '-vf', scale, '-c:v', 'libwebp', '-quality', '80', '-frames:v', '1', out]);
      else execFileSync('ffmpeg', [...input, '-vf', scale, '-c:v', 'libwebp_anim', '-quality', '40', '-compression_level', '6', '-loop', '0', out]);
      console.log(`${name}: ${clip.still ? 'still' : clip.frames + ' frames'} -> ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
