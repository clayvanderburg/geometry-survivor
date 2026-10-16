# VECTRA // SURVIVOR

A browser-based geometric twin-stick roguelite & asteroid-excavation survival game inspired by *Geometry Wars*, *Deep Rock Galactic: Survivor*, and *Vampire Survivors*.

## Quick Start (Local Dev Server)

```powershell
npm start
```
- **Play Game**: `http://127.0.0.1:8096`
- **Standalone Live Tuning & Dev Sandbox Studio**: `http://127.0.0.1:8096/tuner.html` (or press **`[T]`** in-game to toggle the slide-over Tuner Drawer).

---

## Core Mechanics & Features

1. **Geometric Crab Ship with Twin Rotary Drill-Claws (`drawCrabShip` in `js/main.js`)**
   - Wide hexagonal armored crab carapace with 6 scuttling side legs.
   - **Twin Front Rotary Drill-Claws**: Orient automatically toward your movement direction (or snap onto the asteroid rock face you are boring into), clamping inward, spinning helical drill threads, vibrating, and spraying grinding sparks.
   - **360° Independent Plasma Turret**: Rotates toward your aim cursor (`p.angle`) independently of your crab hull.
   - **Strict Mining Separation**: Weapons, missiles, orbitals, singularities, and Supernova bombs **never** mine asteroids—bullets spark off rocks as solid cover. **Only your Crab Ship's front Drill-Claws** can carve tunnels through asteroid clusters.

2. **10x Scrolling Sector (`4200 x 4200`) & Destructible Asteroid Clusters (`js/asteroids.js`, `js/grid.js`)**
   - 38 dense asteroid formations physically block and funnel enemy swarms until you carve escape tunnels through them.
   - Shattering rocks unearths hidden veins: **Gold Geom Veins** (5x Golden XP/Multiplier Geoms + rare buried Relic Chest roll), **Shield Crystal Veins** (`+25 Shield HP`), and **Deep Core Veins** (`+1 ❖ Void Core`).
   - Bottom-right **Tactical Sector Radar Minimap** displays asteroid clusters, rich ore veins, enemies, bosses, and Relic Supply Caches.
   - Camera-culled **Hooke's-Law Spring-Mass Warping Neon Grid** (`js/grid.js`) ripples from explosions and funnels into gravity wells at 60+ FPS.

3. **Emergent Swarm Archetypes (`js/enemies.js`)**
   - **Boid Swarmers** (Magenta Diamonds): Flock using separation, alignment, cohesion, and swirl.
   - **Weavers** (Emerald Darts): Sense incoming player fire and dodge perpendicular to bullet trajectories.
   - **Pinwheels** (Violet Rotating Squares) & **Splitters** (Golden Hexagons that fracture into 3 fast mini-triangles).
   - **Black Holes** (Crimson Singularities): Pull the grid, particles, and nearby enemies inward.
   - **Prismatic Dreadnought Bosses**: Spawn every 3 waves and drop a guaranteed Super Relic Supply Cache.

4. **Luck Stat, Rare `+2`/`+3` Multi-Level Rolls & Relic Supply Cache Jackpots (`js/upgrades.js`, `js/main.js`)**
   - **Multi-Level Upgrades**: Level-up cards have a rare, Luck-scaled chance (`10% * luck` for `+2 Levels`, `3.5% * luck` for `+3 Levels`, before caps) to jump multiple levels at once.
   - **Relic Supply Caches**: Guaranteed drop from Bosses and very rare Luck-scaled drop from lesser enemies / Gold Veins. Opening a cache triggers the **Relic Supply Cache Jackpot Modal** (`1x` standard, or rare `2x`, `3x Triple Jackpot`, or `5x Penta-Core Mega Jackpot` free upgrades).

5. **Interactive 132-BPM Synthwave Music & Procedural WebAudio (`js/audio.js`)**
   - Procedural WebAudio sequencer (dynamics compressor, punchy kick, dual-oscillator sawtooth + sub-square bassline, snare, hi-hats, detuned arpeggiator, and chord pads) that scales filter cutoff and layering with combat intensity.
   - **Hull-Hugging Shield Barrier** (`drawPlayerShield` in `js/ship-renderer.js`) wraps the crab's silhouette and is also the contact hitbox (`shieldTouches`). Its charged arc shows current shield %, thickness grows with max shield, color shifts blue → amber → critical red, and hits flash with a ripple. Hue, padding and thickness are tunable.

6. **Persistent Highscore Board & Void Armory Meta-Progression (`js/progression.js`)**
   - Custom **Pilot Callsign / Name Entry** on Title and Game Over screens.
   - Spend **Void Cores (❖)** harvested during runs on 6 permanent Armory upgrades persisted in `localStorage` (`vectra_survivor_save_v2`).

7. **Live Tuning & Dev Sandbox Studio (`tuner.html` + `js/config.js` + `[T]` Drawer)**
   - Exposes 38 live parameters across 5 categories (*Crab Ship & Drill-Claws*, *Weapons & Shield*, *Luck & Chests*, *Asteroids & Economy*, *Audio & Visual FX*) with real-time cross-tab sync via `BroadcastChannel` + `localStorage`.
   - Includes instant Sandbox triggers (`Spawn Chest`, `Trigger Level-Up`, `+50 Cores`, `Spawn Boss`, `Regenerate Asteroids`, `Full Heal`) and a 1-click **📋 COPY TUNING FOR AGENT** button.

---

## File Map (For Multi-Agent Handoffs)

- `index.html` — Main game viewport, HUD, Title/Armory/Highscore modals, Upgrade & Chest Jackpot modals, and slide-over `#tuner-drawer`.
- `tuner.html` — Standalone Live Tuning & Dev Sandbox Studio with live 60 FPS Crab-Ship & Shield preview canvas.
- `css/style.css` — Neon glassmorphic HUD, modal, and Tuner Drawer styling.
- `js/config.js` — Centralized `TUNING` state, `DEFAULT_TUNING`, `TUNING_SCHEMA`, `localStorage` persistence, and `BroadcastChannel` sync.
- `js/main.js` — Core `Game` loop, Minimap (`drawMinimap`), weapons, and live tuning integration.
- `js/ship-renderer.js` — Crab Ship renderer (`drawCrabShip`), shield renderer and shield hitbox, shared by game and Studio.
- `js/gamepad.js` — Controller snapshots and d-pad/stick menu navigation. Full controller play: L-stick move, R-stick aim/fire, A dash, B supernova, X/Y auto-fire/auto-aim, Start pause; menus use d-pad + A, Start confirms, B resumes.
- `js/asteroids.js` — Procedural asteroid cluster generation, spatial hash grid, and dedicated Twin Crab-Claw rotary drilling physics.
- `js/enemies.js` — Enemy archetypes, Boids flocking, Weaver bullet-dodging, and boss behaviors.
- `js/upgrades.js` — In-run upgrade pool, Golden Synergies (*Tectonic Claw Bore*, *Pulsar Helix*, *Storm Protocol*), and Luck-scaled `+2`/`+3` level jump rolls.
- `js/progression.js` — Persistent Highscore Leaderboard (with editable Pilot Callsign) and Void Armory meta-upgrades.
- `js/grid.js` — Camera-culled Hooke's-law spring-mass warping neon grid.
- `js/particles.js` — Polygon shatter shards, velocity-stretched sparks, dual-ring shockwaves, chain lightning, and floating text.
- `js/audio.js` — Procedural WebAudio synthwave sequencer and SFX engine.

## Engineering checks

Requires Node.js 20 or newer; runtime and tests have no package dependencies. Run `npm test` for regression checks. GitHub Actions runs the same checks on pushes and pull requests.

The simulation runs at a fixed 60 Hz; rendering follows display refresh. Enemy neighbors, projectile avoidance, and primary projectile collisions use spatial queries. Enemy capacity includes active and pending spawns (default 200). Game and Studio share `js/ship-renderer.js`. Saved tuning and progression are normalized on load.

Optional browser check: install Playwright separately, then run `node tools/browser-smoke.cjs` (or supply an existing Playwright module path as its first argument). It uses an isolated headless Chrome profile; set `BROWSER_EXECUTABLE` to choose another Chromium executable. Local assets are supplied through request interception, so the test needs no running server or network. Screenshots are written to the current folder. `node tools/controller-smoke.cjs <playwright-module-path>` plays title → level-up → pause → chest → game over with a simulated gamepad only.

See [ENGINEERING_FIXES.md](ENGINEERING_FIXES.md) for scope and validation limits.

Extended checks (optional Playwright dependency): `node tools/soak-validate.cjs <playwright-module-path>` runs a seeded ten-minute accelerated simulation plus crowded 720p/4K draw checks. `node tools/audio-validate.cjs <playwright-module-path> audio-validation.json` renders actual Web Audio buffers and checks finite/non-silent output, mute, output headroom and clock recovery. Set `BROWSER_EXECUTABLE` to an installed Chromium browser if needed. Raw machine measurements and screenshots are ignored by Git. See [VALIDATION.md](VALIDATION.md).
