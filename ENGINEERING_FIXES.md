# Engineering audit fixes — 2026-10-16

Based on master 2b1a50831f84aba7fe735bf49ca11518d0e8a87b. Gameplay design and baseline tuning are preserved, with the explicit correctness changes below.

## Correctness
- Pause resets object-backed input without throwing. Keyboard one-shot actions ignore repeat; sliders retain game shortcuts; text entry remains protected.
- Focus loss releases input and pauses an active run. Clock reset prevents hidden time being simulated on return. Connected controllers beyond slot zero work, and analog magnitude is preserved.
- Enemy death is resolved once using stable object references and snapshot iteration, including recursive black-hole chains.
- Primary projectiles sweep their travel segment, hit each enemy once, and resolve enemies and cover in travel order. Spatial broadphase bounds include maximum target radii.
- Pending XP levels are offered after the previous selection or cache closes. Caches honor rolled upgrade jumps and upgrade caps.
- Upgrade random priorities are sampled once per candidate, avoiding a nontransitive comparator.
- Fixed 60 Hz simulation separates motion, forces, damage and lifetimes from display refresh. Stalls are bounded to 250 ms of simulation work per frame.

## Audio and data
- Audio volume storage reads and numeric values are guarded.
- Delayed music scheduling skips overdue steps while preserving sequencer phase. Visual beats use reached audio-clock timestamps rather than future scheduled kicks. Explicit stop/dispose methods release timers and buses.
- Tuning from storage, sliders and cross-tab messages is normalized against type/range/color rules. Save loading bounds currency/ranks and validates leaderboard records. Callsigns use text rendering.

## Performance and structure
- Spatial queries replace full-array flocking, separation, gravity-neighbor and projectile-avoidance scans. Primary projectile broadphase also uses a spatial index.
- Enemy and effect drawing culls outside camera bounds; offscreen simulation continues.
- Active plus pending enemies have a default hard limit of 200; ordinary spawns can be skipped at capacity. Scheduled bosses wait in FIFO order and claim free slots before ordinary spawns. This bounds runaway late-wave/sandbox work and is a deliberate behavior change.
- New runs clear transient particles/grid impulses and input.
- Ship/shield rendering is shared by game and Studio. Clock and spatial index are separate modules. The core Game remains a single coordinator; no game redesign was attempted.
- Dependency-free Node test runner, local static server, and GitHub Actions checks are included.

## Validation
- 29 Node regression tests pass, including 150 seeded large-rock/long-segment collision oracle cases.
- Actual headless Chrome smoke passes: boot, gameplay, pause/resume, slider shortcuts, restart, tuner drawer, standalone Studio and both canvas renderers. No page errors. Screenshots inspected.
- Browser assets were served through local request interception because this sandbox denies browser loopback networking. External fonts were blocked in that smoke test.
- Audio tests use Web Audio boundary mocks; audible quality was not auditioned. Physical controllers, mobile devices and sustained late-wave GPU performance remain unverified.

## Follow-up validation after merge
- Fixed scheduled bosses being discarded at the population cap; five scheduling/budget regression checks cover retries, FIFO, original strength, admission priority and restart reset.
- Actual offline synthesis exposed full-scale overshoots during explosion bursts and extreme legal gains. Final output protection now preserves the linear region below 0.8 and saturates overloads around 0.98 after the compressor. No subjective listening claim is made.
- 35 regression tests now pass. See VALIDATION.md for the extended browser/audio results.

# Second audit — 2026-10-16

Gameplay design and tuning values are preserved; card text was changed to match existing effects rather than rebalancing.

## Correctness
- Spawns near a wall or corner are re-checked after clamping, so enemies, bosses and wave rock clusters keep their minimum distance from the player.
- New sectors and wave clusters keep every rock (not just cluster centres) clear of the player; rocks leave a passable gap at the arena wall.
- Rock pushout re-clamps the ship and enemies to the arena.
- Storm Protocol chain lightning starts at the missile blast instead of the ship.
- Score multiplier keeps full precision; per-pickup rounding had erased small XP-multiplier gains and over-rounded others. Display and leaderboard still show one decimal.
- Larger enemies (pinwheels, splitters, bosses) now separate from every neighbour; odd-indexed pairs could fully overlap.
- Rock lookups size their cell range from reach and the largest rock, so high mining-range or rock-size tuning can't miss rocks.
- Supernova uses a fixed world radius (the previous 1920x1080 value) instead of scaling with window size or browser zoom.
- Bullets hitting rock now show impact sparks.

## UI and input
- Arrow keys keep moving the ship during play when a volume slider has focus.
- Space on a focused button activates that button on the title, game-over and pause screens.
- Pause-menu Music/SFX sliders follow changes from the drawer, Studio and reset.
- Save data reloads when another tab writes it, so a second tab can't overwrite armory purchases or scores.
- Sandbox +Boss reports when the enemy cap blocked the spawn; Copy Tuning reports clipboard failure.
- Chest 3x/5x jackpot sliders can return to their defaults (step 0.001).
- Corrected card text: Rotary Claw Overclock, Phase Nova Thrusters, Pulsar Helix, Fortune & Vacuum Array, Deep-Core Mining Rig.

## Rendering and cleanup
- Grid forces only apply inside the simulated camera region; offscreen points previously accumulated unbounded velocity and tore the grid when revealed. Implosions respect the Grid Warp slider.
- Shatter shards are clamped inside the arena.
- Removed unused code: `damageRocksInRadius`, black-hole `absorbed`, `killEnemy` index path, unreachable spawn fallback, unused import.

## Validation
- 40 Node tests pass, including 5 new regression tests that fail on the previous code.
- Headless Chrome smoke passes; seeded 600-second accelerated soak reached wave 28 with no errors.

## Known, not changed
- Controller input is only read during play; level-up, chest, pause and game-over screens need keyboard/mouse.
- Contact hitbox (1.9x radius) is smaller than the drawn shield ring (2.55x default); may be intentional leniency.
- Screen-fade trails are shorter on high-refresh displays. A time-scaled fade would also brighten glow, so this needs a visual decision.
- At the 200-enemy cap, splitter children can be dropped (documented cap behaviour).
