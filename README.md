# VEXOLITH // SURVIVOR

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
   - **Prism Split streams** (`PRISM_STREAMS` in `js/weapon-scaling.js`): the blaster starts as two parallel streams straight at your aim. Each Prism Split level adds a pair in a fixed order (rear → sides → forward diagonals → rear diagonals → flanks) without moving existing streams, so the forward pair always stays aimable.
   - **Wing Rockets** (starting weapon, LV 1–8): about once a second while firing, the outer wings launch slow dumbfire rockets along the hull's heading (where you fly, not where the turret aims). Direct hit + small blast; tagged `PROJECTILE EXPLOSIVE AREA`. Levels shorten the volley interval (1.0 s → 0.7 s), add rockets (2 → 6 per volley, alternating wings) and widen the blast; damage per hit is solved from the shared DPS curve.
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
   - **Vortexes** (Crimson Singularities, internal type `blackhole`): Funnel the grid, swirl enemies, pickups and sparks inward, bend passing shots, and tug your ship. The tug is capped below your thrust (`js/gravity.js`), so holding away always escapes. Strengths live in the tuner's *Gravity Wells & Singularities* group.
   - **Combat-breadth archetypes (`js/archetypes.js`)**, introduced one per wave and announced once per run by a cyan *NEW HOSTILE SIGNATURE* card:
     - **Bruisers** (wave 2, orange pentagons with a ram): slow, durable, take ¼ knockback and survive ramming you. They wind up for 0.8 s on a marked lane (it locks for the last 40%), charge ~250 px, then vent for 0.9 s — the punish window.
     - **Gunners** (wave 3, chartreuse cannons): hold ~380 px, strafe, and after a 0.6 s aim line fire slow plasma orbs (`js/enemy-bullets.js`: pooled, slower than your ship, blocked by asteroids, absorbed by the hull-hugging shield via `shieldTouches`, ignored during a dash, wiped by Supernova).
     - **Aegis Shielders** (wave 4, azure hexagons): three front plates turn toward you slowly and stop projectiles; flank them or use missiles, lightning, orbitals, singularities or novas.
     - **Blinkers** (wave 5, orchid stars): collapse for 0.6 s while a ring marks the landing point, then teleport to your flank (130–250 px away, never into rock) and lunge.
     - **Conduits** (wave 6, aqua relay pylons): hang back and beam-link up to 4 allies (−30% damage taken, +20% speed). Kill them first.
     - Durable hulls show a brief HP ring after each hit so "this one takes longer" reads; fodder still pops.
   - **Lieutenants (`js/lieutenants.js`)**: one per non-boss wave (from wave 2, `lieutenantDelay` s in), an elite of an unlocked archetype with a generated name/epithet (e.g. `QUAARC — THE MANIFOLD BRUISER`) and 1–2 modifiers (*armored* −40% damage, *hasted* +35% speed, *regenerating* 3% HP/s after 1.5 s unhit, *splitting* into 3, *shielded* front plates). Silver rank brackets and modifier arcs (never the boss's gold crown), a floating mini HP bar, a radar dot + `LT` edge arrow, and a small arrival/defeat card. HP is 40% of that wave's boss HP (×0.85–1.5 by archetype heft); they survive Supernova (−40% max HP) and contact. Reward: +1 Void Core (outside the per-wave cap), gold XP geoms and 8× score. Lieutenant kills use the elite kill tier.
   - **Pacing**: waves still advance every 22 s with continuous spawns; packs are chosen by tunable weights and new packs join at their unlock wave. Bosses stay every 3 waves and keep priority on free enemy slots.
   - **Prismatic Dreadnought Bosses**: Spawn every 3 waves and drop a guaranteed Super Relic Supply Cache. Each one is a staged event: a `bossWarningTime` (default 3 s) warning with a hazard strip countdown, klaxon, music drop, red screen frame, radar ring and off-screen arrow to the reserved spawn point; then an arrival shockwave and title card (e.g. `PRISMATIC DREADNOUGHT — WAVE 3 WARDEN`), a gold-crowned silhouette, and top-of-HUD health bars (up to 3 stacked, `+N MORE` beyond). A kill triggers a fixed-tick hit-stop + half-speed slow-mo, gold flash and a reward banner. Sandbox `+Boss` runs the same event.

3b. **Weapon Loadout & Leveling (`js/loadout.js`, `js/upgrades.js`)**
   - **6 weapon slots** (`weaponSlots`). The crab starts with **Pew Pews** (the blaster) and **Wing Rockets LV 1**. Weapons: Pew Pews, Wing Rockets, Swarm Micro-Missiles, Tesla Arc Emitter, Vortex Singularity, Aegis Orbiting Blades, Volatile Shatter, Proximity Mines, Sentry Turret, Escort Drones (registry `WEAPONS` in `js/loadout.js`).
   - **Level-up hands only offer what fits your loadout**: level-ups for equipped weapons (every weapon line goes to **LV 8**), weapon-specific upgrades for equipped weapons (Pew Pews: Prism Split, Hyper-Capacitor, Phase Piercer, Thermite Rounds; Cryo Payload needs Wing Rockets or Missiles; Nanite Swarm needs Tesla Arc; evolutions keep their weapon requirements), general upgrades (Reactor Overdrive, crit chance/damage, Quantum Fortune, Geom Attractor, Phase Nova Thrusters, Rotary Claw) and tag cards only for tags an equipped weapon carries (no ELECTRIC card without Tesla Arc). Cards are drawn by weight (`weaponLevelWeight` 3, `weaponLineWeight` 1.5, general 1, `tagCardWeight` 0.7, `evolutionWeight` 4 × luck), so the weapons you carry keep climbing and roll their +3/+4/+5 (rare/epic/legendary) jumps.
   - **NEW WEAPON** card (cyan, dashed): while a slot is free it joins a hand with `newWeaponChance` (35%) and is guaranteed every `newWeaponPity` (3) hands without one. Picking it swaps the hand for **1 of 3 unequipped weapons**, each with its summary, tags and exact LV 1 stats. With all 6 slots full no NEW WEAPON cards appear. Supply caches never offer it.
   - **Loadout panel** in the pause menu: 6 slots with name, level, tags and the weapon's own upgrades. **DISCARD** asks to confirm in place (CONFIRM / KEEP), then removes the weapon, its level, its weapon-specific upgrades (unless another equipped weapon shares them, e.g. Cryo Payload) and any evolution that no longer qualifies; general and tag upgrades stay. The freed slot brings NEW WEAPON cards back. The player is rebuilt from a run-start snapshot plus the remaining upgrade levels, so a discard removes exactly what those upgrades added. Mouse, keyboard and controller all work. The HUD shows one chip per slot (free slots dashed) above the other upgrades.
   - **Leveling**: XP to next level is a stepped line, `xpCurveBase` 25 + `xpCurveStep` 16 per level to LV 20, then `xpCurveStepMid` 100 per level to LV 40, then `xpCurveStepLate` 60 (all in the tuner's *Leveling & Weapon Loadout* group). It replaced ×1.32 + 6 per level. In the simulator level-ups come every ~10–15 s for the first 5 minutes (LV ~15 at 3 min, ~25 at 5 min) and every ~30–60 s after; a pilot who keeps killing is around LV 32–44 at 12 min and LV 40–50 at 20 min. With everything maxed and no free slot, a level-up still falls back to a full shield repair.

4. **Luck Stat, `+2`…`+5` Multi-Level Rolls & Relic Supply Cache Jackpots (`js/upgrades.js`, `js/main.js`)**
   - **Multi-Level Upgrades**: Level-up cards have a Luck-scaled chance to jump multiple levels at once (`10%` for `+2`, `3.5%` for `+3`, `1%` for `+4`, `0.25%` for `+5`, each × luck, never past the level cap). The jump size *is* the card's rarity.
   - **Relic Supply Caches**: Guaranteed drop from Bosses and very rare Luck-scaled drop from lesser enemies / Gold Veins. Opening a cache triggers the **Relic Supply Cache Jackpot Modal** (`1x` standard, or rare `2x`, `3x Triple Jackpot`, or `5x Penta-Core Mega Jackpot` free upgrades). Caches install through the same `applyUpgradeLevels` path as level-up picks, so they share one `player.upgradeLevels` state.
   - **Readable Cards (`js/upgrade-cards.js`)**: Every level-up and cache card shows an enlarged headline (e.g. `+2 PROJECTILES`), a short summary and exact **before → after** stats, computed by installing the upgrade (including its rolled level jump) on a copy of the player. Weapon formulas live in `js/weapon-scaling.js` so cards and gameplay can't drift. Rarity is the rolled level jump and sets the card color: `+1` common gray, `+2` uncommon green, `+3` rare blue, `+4` epic purple, `+5` legendary gold; evolutions are magenta. Cards, caches and HUD tags all use the same `LV n` wording. Weapon and damage-type cards also show their **tag chips** (e.g. `PROJECTILE` `EXPLOSIVE` `AREA`).

4b. **Deployables (`js/deployables.js`)** — three upgrade lines in the `DEPLOYABLE` category (tag `deployable`), numbers in `js/weapon-scaling.js` so cards preview exact before → after:
   - **Proximity Mines**: dropped in the ship's wake on a timer while a slot is free; arm after `mineArmTime`, then burst (area damage) when an enemy enters the trigger ring, or at the end of the fuse. Levels raise max active mines, damage, drop rate, blast/trigger radius and fuse.
   - **Sentry Turret**: planted at the ship for a limited lifetime (ring shows time left); a rotating twin barrel shoots the nearest enemy it can see — targets behind asteroids are skipped and its bolts are stopped by cover like the blaster. Levels raise fire rate, lifetime, range, damage, deploy rate and (at LV 3/6) max active turrets.
   - **Escort Drones**: 1–3 gunships flying a V formation behind the hull with thruster trails, firing bolts at nearby visible targets (they shoot; Orbiting Blades grind).
   - **SYNERGY: Siege Battery** (Proximity Mines + Sentry Turret): turret bolts burst on impact into nearby enemies.
   - Deployables live in fixed pools outside the enemy list (no enemy-cap cost), freeze with pause/hit-stop/slow-mo, are cleared on run reset, and never target Vortex portals. Tuner group *Deployables*: damage multiplier, mine arming delay, drone formation spacing.

5. **Interactive 132-BPM Synthwave Music & Procedural WebAudio (`js/audio.js`)**
   - Procedural WebAudio sequencer (dynamics compressor, punchy kick, dual-oscillator sawtooth + sub-square bassline, snare, hi-hats, detuned arpeggiator, and chord pads) that scales filter cutoff and layering with combat intensity.
   - **Hull-Hugging Shield Barrier** (`drawPlayerShield` in `js/ship-renderer.js`) wraps the crab's silhouette and is also the contact hitbox (`shieldTouches`). Its charged arc shows current shield %, thickness grows with max shield, color shifts blue → amber → critical red, and hits flash with a ripple. Hue, padding and thickness are tunable.

6. **Persistent Highscore Board & Void Armory Meta-Progression (`js/progression.js`)**
   - Custom **Pilot Callsign / Name Entry** on Title and Game Over screens.
   - Spend **Void Cores (❖)** harvested during runs on 6 permanent Armory upgrades persisted in `localStorage` (`vectra_survivor_save_v2`).

7. **Live Tuning & Dev Sandbox Studio (`tuner.html` + `js/config.js` + `[T]` Drawer)**
   - Exposes 97 live parameters across 12 categories (*Crab Ship & Drill-Claws*, *Weapons & Shield Barrier*, *Luck, Multi-Levels & Chests*, *Asteroids, World & Economy*, *Audio, Enemies & Visual FX*, *Gravity Wells & Singularities*, *Boss Encounters*, *Hit Feedback & Damage Numbers*, *Enemy Variety & Lieutenants*, *Deployables*, *Crits & Damage Types*, *Leveling & Weapon Loadout*) with real-time cross-tab sync via `BroadcastChannel` + `localStorage`.
   - Includes instant Sandbox triggers (`Spawn Chest`, `Trigger Level-Up`, `+50 Cores`, `Spawn Boss`, `+Lieutenant`, `+Bruiser`/`+Gunner`/`+Shielder`/`+Blinker`/`+Conduit`, `Regenerate Asteroids`, `Full Heal`) and a 1-click **📋 COPY TUNING FOR AGENT** button.
   - The *Enemy Variety & Lieutenants* group exposes pack spawn weights, Gunner orb speed/damage, lieutenant HP share, modifier count, first wave, arrival delay and Void Core reward.

8. **Damage & Hit Feedback (`js/damage-numbers.js`, `hitEnemy` in `js/main.js`)**
   - **Floating damage numbers** (on by default; toggle in the pause menu or with `[N]`, saved in `localStorage` as `vexolith_damage_numbers`). Rapid hits on one enemy from one weapon merge into a single rising total (new number after a 0.3 s gap or 1 s burst), live numbers are capped (`damageNumberCap`, default 48) and stacked at most three deep per spot, size grows gently with damage, and colour shows the source: blaster cyan, missiles orange, lightning violet, orbitals green, singularity pink, supernova gold, mines red, turret blue, drones lime, burn ticks red-orange (merged across the 0.5 s tick gap), other (shrapnel, dash nova, bore, vortex burst) white. **Critical hits** get their own number: larger, white-gold with a gold halo, a trailing `!` and a star burst.
   - **Impacts**: white-hot hit flash + hull pop, a pooled cross-flare at each projectile hit, and mass-scaled knockback (decaying displacement; bosses immune, orbitals/singularities never push).
   - **Kills by durability tier**: swarmers pop, pinwheels/weavers/gunners/blinkers add a core flash, splitters/bruisers/shielders/conduits shed debris + embers and shake lightly, lieutenants and vortexes (the elite tier) add a wide ring + 1-tick hit-stop, bosses add a chroma flash + 3-tick hit-stop. Supernova uses a 2-tick hit-stop. All shake goes through `screenShakeMult`; hit-stop is capped at 3 fixed ticks (`hitStopMult`).

9. **Critical Hits, Weapon Tags & Damage Types (`js/weapon-scaling.js`, `js/status-effects.js`)**
   - **Crits**: every weapon hit rolls crit in `hitEnemy` (base 5% chance, 1.5x damage; `baseCritChance`/`baseCritDamage`). A crit adds a gold star flare, a white-gold `!` damage number, a little extra knockback and a throttled bright tick. Cards: *Deadeye Targeting Lattice* (+5% chance), *Overkill Resonator* (+0.25x damage); both preview *Avg bonus from crits*. Legendary *SYNERGY: Supercritical* (crit chance LV 2 + any damage-type card): +10% chance and 1.5x the crit bonus against burning, chilled or corroded targets. Burn ticks never crit.
   - **Tags** (`WEAPON_TAGS`; a weapon's chips are the union of its sources, `weaponTags` in `js/loadout.js`): blaster/helix/shrapnel `PROJECTILE KINETIC`, wing rockets `PROJECTILE EXPLOSIVE AREA`, orbit blades `ORBITAL KINETIC`, missiles `PROJECTILE EXPLOSIVE AREA`, arcs `ELECTRIC`, singularity `GRAVITY AREA`, dash nova `AREA`, tectonic blast `EXPLOSIVE AREA`. Specialist cards boost every weapon with a tag and are offered once an equipped weapon carries it: *Tungsten Penetrators* (+20% KINETIC damage/level), *Shaped Charges* (+30% EXPLOSIVE), *Overvolt Coils* (+30% ELECTRIC), *Field Amplifier* (epic, +15% AREA size: missile blast, singularity pull/collapse, dash nova, drill blast). No card adds projectiles beyond Prism Split.
   - **Damage types**: *Thermite Rounds* (blaster/helix bolts) **BURN**: each hit adds a stack (max 3 + level) and refreshes 3 s; stacks tick every 0.5 s for `damage × (0.3 + 0.15·level)` DPS per stack. *Cryo Payload* (rocket and missile blasts, needs Wing Rockets or Missiles) **CHILL**: −(25 + 5·level)% move speed for 1.8 + 0.3·level s, bosses take 40% of the slow (`chillBossMult`); hulls frost over. *Nanite Swarm* (Tesla/Storm arcs, needs the emitter) **CORRODE**: each arc hit adds +5% damage taken from every source, burn included, up to 4 + level stacks, 4 s refresh. Overlays are three batched strokes per frame (burn ring, frost spikes, corrode gauge); black holes/portals are immune.

10. **Field Guide (`js/field-guide.js`, `js/field-guide-scenes.js`, `js/field-guide-ui.js`)**
   - Opened with the **📖 FIELD GUIDE** button on the title hub, pause menu and game-over screen, or **`[G]`** (from a live run it pauses first). Three tabs: **HOSTILES**, **MECHANICS**, **WEAPONS**. Keyboard: ←/→ (or Q/E, 1–3) tabs, ↑/↓/PgUp/PgDn scroll, Esc/G back. Controller: d-pad walks focus through the entries (the list scrolls with it), right stick scrolls, LB/RB tabs, B back.
   - **HOSTILES**: every enemy type (swarmer, pinwheel, weaver, splitter, mini-splitter, vortex, the five archetypes), lieutenants (with all modifiers) and the boss. Each entry is **locked** (dark silhouette + `???` and the wave its signal appears) until first encountered: any part of the hull inside the camera view (scanned every 6 ticks), a NEW HOSTILE SIGNATURE card, a lieutenant arrival or a boss arrival. A first encounter shows a small **FIELD GUIDE UPDATED** toast (archetypes get a link line on their intel card instead) and a **NEW** badge in the guide and on every guide button until the entry has been on screen.
   - Unlocked entries play a **live preview**: a tiny looping scene run by the real `EnemyManager` AI and drawing code (telegraphs, plates, links, orbs, auras), `ParticleSystem` and the crab ship renderer, with a scripted dummy ship kiting and firing (bruiser lane + sidestep, gunner aim line + orb, shielder plates sparking bolts while flank shots land, blinker ring + teleport, conduit beams on swarmers, splitter burst, vortex sparks/tug/bent shots, lieutenant rolled fresh each loop, boss warning + crown). Only previews scrolled into view step and draw (IntersectionObserver), and nothing runs while the guide is closed.
   - Stats are exact and live from the spawn config and TUNING: HP at wave 1 (boss at wave 3), speed in px/s and vs. your ship, contact damage (`contactDamageAt` in `js/enemies.js`, shared with the game), XP and unlock wave, plus a *how to beat it* tip. Mechanics text pulls its numbers from TUNING and the shared constants too (crit base, level-jump odds, falloffs, escape cap, chest odds…).
   - **WEAPONS** is a thin adapter over `UPGRADE_POOL` / `WEAPON_TAGS` / `TAG_INFO` / `RARITY`: every upgrade card in pool order with its category, max level, tag chips and *OWNED LV n* when opened mid-run, evolutions with their recipe, and the starting kit. New cards appear with no guide edits.
   - Unlocks persist in the existing save (`vectra_survivor_save_v2`, `guide: { seen, fresh }`, normalized so old saves load). **New enemy type?** Add a `HOSTILE_ENTRIES` entry and a preview scene: `tests/field-guide.test.js` fails until every spawnable type has both.

---

## File Map (For Multi-Agent Handoffs)

- `index.html` — Main game viewport, HUD, Title/Armory/Highscore modals, Upgrade & Chest Jackpot modals, Field Guide (`#guide-modal`), and slide-over `#tuner-drawer`.
- `tuner.html` — Standalone Live Tuning & Dev Sandbox Studio with live 60 FPS Crab-Ship & Shield preview canvas.
- `css/style.css` — Neon glassmorphic HUD, modal, and Tuner Drawer styling.
- `js/config.js` — Centralized `TUNING` state, `DEFAULT_TUNING`, `TUNING_SCHEMA`, `localStorage` persistence, and `BroadcastChannel` sync.
- `js/main.js` — Core `Game` loop, Minimap (`drawMinimap`), weapons, and live tuning integration.
- `js/ship-renderer.js` — Crab Ship renderer (`drawCrabShip`), shield renderer and shield hitbox, shared by game and Studio.
- `js/gamepad.js` — Controller snapshots and d-pad/stick menu navigation. Full controller play: L-stick move, R-stick aim/fire, A dash, B supernova, X/Y auto-fire/auto-aim, Start pause; menus use d-pad + A, Start confirms, B resumes. Elements marked `data-gp-nav` (Field Guide entries) are extra focus stops.
- `js/asteroids.js` — Procedural asteroid cluster generation, spatial hash grid, and dedicated Twin Crab-Claw rotary drilling physics.
- `js/enemies.js` — Enemy spawning/update loop, Boids flocking, Weaver bullet-dodging, and boss behaviors.
- `js/archetypes.js` — Bruiser, Gunner, Shielder, Blinker and Conduit stats, AI state machines, silhouettes/telegraphs, shield blocking, unlock waves and weighted wave packs.
- `js/enemy-bullets.js` — Pooled hostile plasma orbs (rock-blocked, shield-outline hits).
- `js/lieutenants.js` — Lieutenant rolls (name, epithet, modifiers), stat folding, rank aura, mini HP bar and spawn telegraph.
- `js/loadout.js` — Weapon registry (`WEAPONS`: name, level line, tag sources, colour, summary), starting weapons, slot count and ownership helpers (`ownedWeapons`, `freeSlots`, `ownedTags`).
- `js/upgrades.js` — Loadout-gated, weighted level-up hands (`rollLevelUpHand`, NEW WEAPON card with chance + pity, `rollWeaponPicks`, `acquireWeapon`, `discardWeapon`), the stepped XP curve (`xpToNextLevel`), and the in-run upgrade pool (weapons, deployables, crit, tag specialist and damage-type cards, each with tags), Golden Synergies (*Tectonic Claw Bore*, *Pulsar Helix*, *Storm Protocol*, *Siege Battery*, *Supercritical*), and Luck-scaled `+2`…`+5` level jump rolls (rarity).
- `js/weapon-scaling.js` — Every weapon/crit/tag/status formula (`weaponDamage`, AREA radii, crit multipliers, burn/chill/corrode numbers) plus `WEAPON_TAGS` and `TAG_INFO` chip colors; firing code and card previews both read it.
- `js/upgrade-cards.js` — Card headline + exact before → after rows (`STAT_ROWS`), tag chips and card HTML.
- `js/status-effects.js` — BURN / CHILL / CORRODE application, fixed-tick timers and burn DoT, corrosion damage multiplier, batched status overlays.
- `js/progression.js` — Persistent Highscore Leaderboard (with editable Pilot Callsign), Void Armory meta-upgrades and Field Guide unlocks (`guide.seen` / `guide.fresh`).
- `js/field-guide.js` — Field Guide data: hostile entries (text, tips, exact stats from the real config), mechanics, the weapons adapter over `UPGRADE_POOL`, and encounter detection (`detectEncounters`).
- `js/field-guide-scenes.js` — Animated hostile previews (`GuidePreview`) built on the real enemy AI/draw code, plus locked silhouettes.
- `js/field-guide-ui.js` — Field Guide screen: tab HTML builders, NEW badges, visible-only preview loop.
- `js/grid.js` — Camera-culled Hooke's-law spring-mass warping neon grid.
- `js/particles.js` — Polygon shatter shards, velocity-stretched sparks, dual-ring shockwaves, chain lightning, pooled hit-impact flares, and floating text.
- `js/deployables.js` — Proximity Mines, Sentry Turrets and Escort Drones: pooled update, targeting (nearest visible enemy), bolts through the shared bullet sweep, and neon rendering.
- `js/damage-numbers.js` — Pooled, canvas-drawn floating damage numbers (per-enemy/per-source aggregation, live cap, persisted toggle).
- `js/audio.js` — Procedural WebAudio synthwave sequencer and SFX engine.

## Engineering checks

Requires Node.js 20 or newer; runtime and tests have no package dependencies. Run `npm test` for regression checks. GitHub Actions runs the same checks on pushes and pull requests.

The simulation runs at a fixed 60 Hz; rendering follows display refresh. Enemy neighbors, projectile avoidance, and primary projectile collisions use spatial queries. Enemy capacity includes active and pending spawns (default 200). Game and Studio share `js/ship-renderer.js`. Saved tuning and progression are normalized on load.

Optional browser check: install Playwright separately, then run `node tools/browser-smoke.cjs` (or supply an existing Playwright module path as its first argument). It uses an isolated headless Chrome profile; set `BROWSER_EXECUTABLE` to choose another Chromium executable. Local assets are supplied through request interception, so the test needs no running server or network. Screenshots are written to the current folder. `node tools/controller-smoke.cjs <playwright-module-path>` plays title → level-up → NEW WEAPON pick → pause (sliders, damage numbers, loadout discard + confirm) → Field Guide → chest → game over with a simulated gamepad only.

See [ENGINEERING_FIXES.md](ENGINEERING_FIXES.md) for scope and validation limits.

### Balance simulator

`npm run balance` runs the real simulation headlessly in Node (no browser, no dependencies) with a scripted bot pilot: it kites away from threats with a ~200 ms reaction delay, aims with auto-aim, dashes when about to be touched or boxed in, fires a Supernova when low in a crowd, collects Geoms and caches, and has **no invulnerability**. `Math.random` is replaced by a seeded generator inside the tool only, so every run is reproducible from its seed (`<seed>:<strategy>:<index>`). The default (6 build strategies × 3 runs, 15 min cap, plus the card bench) takes about a minute on 4 cores and prints Markdown:

- **Survival** per strategy (time / wave distribution, what killed the ship), **damage dealt by source** (every `hitEnemy` source is discovered automatically; shared `other` hits are split into shrapnel, dash nova, tectonic bore, vortex burst, and Pulsar Helix / Storm Protocol are split from blaster / lightning), **damage taken by enemy type**, **level-up pacing**, **cores earned**, a per-wave **difficulty curve**, and **time-to-kill** per enemy type per wave band.
- **Card throughput bench**: each card alone at every level against a topped-up pack of wave-6 targets, in a static `pack` scenario and a `chase` scenario (targets chase a circling ship; leaks/min = how many reach the shield). Weapons are discovered from `UPGRADE_POOL` (a card is a weapon if installing it changes `player.weapons`), so new weapons are benched automatically.

Runs also report **level by minute**, **XP collected per minute** and the **loadout at the end of the run**. Strategies take NEW WEAPON cards and equip their preferred weapons (`weapons` in `tools/balance/strategies.mjs`); `focus:<weapon>` takes NEW WEAPON until that weapon is offered. `--god` keeps the ship alive to measure XP and level pacing over a long run (pacing only; survival numbers are meaningless with it).

Useful flags: `--runs N`, `--focus` (adds a `focus:<id>` strategy for every upgrade), `--strategies a,b`, `--skill expert|average|novice`, `--meta R` (Armory ranks), `--max-minutes M`, `--tune key=value` (A/B any `DEFAULT_TUNING` value), `--weapon key=expr` (A/B any `WEAPON_SCALING` entry, e.g. `"orbitalRadius=lv => 80 + lv * 8"`), `--seed S`, `--no-bench`, `--bench-only`, `--json out.json`. Example: `npm run balance -- --runs 10 --focus --no-bench`. Files: `tools/balance-sim.mjs` (CLI, worker pool, report), `tools/balance/harness.mjs` (headless game, bot, metrics, bench), `tools/balance/strategies.mjs` (build strategies). Findings and the first tuning pass are in [docs/BALANCE_REPORT.md](docs/BALANCE_REPORT.md).

Extended checks (optional Playwright dependency): `node tools/soak-validate.cjs <playwright-module-path>` runs a seeded ten-minute accelerated simulation plus crowded 720p/4K draw checks. `node tools/audio-validate.cjs <playwright-module-path> audio-validation.json` renders actual Web Audio buffers and checks finite/non-silent output, mute, output headroom and clock recovery. Set `BROWSER_EXECUTABLE` to an installed Chromium browser if needed. Raw machine measurements and screenshots are ignored by Git. See [VALIDATION.md](VALIDATION.md).
