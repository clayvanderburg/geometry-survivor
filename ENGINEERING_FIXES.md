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
- Active plus pending enemies have a default hard limit of 200; this can skip spawns at capacity, including boss spawns. This bounds runaway late-wave/sandbox work and is a deliberate behavior change.
- New runs clear transient particles/grid impulses and input.
- Ship/shield rendering is shared by game and Studio. Clock and spatial index are separate modules. The core Game remains a single coordinator; no game redesign was attempted.
- Dependency-free Node test runner, local static server, and GitHub Actions checks are included.

## Validation
- 29 Node regression tests pass, including 150 seeded large-rock/long-segment collision oracle cases.
- Actual headless Chrome smoke passes: boot, gameplay, pause/resume, slider shortcuts, restart, tuner drawer, standalone Studio and both canvas renderers. No page errors. Screenshots inspected.
- Browser assets were served through local request interception because this sandbox denies browser loopback networking. External fonts were blocked in that smoke test.
- Audio tests use Web Audio boundary mocks; audible quality was not auditioned. Physical controllers, mobile devices and sustained late-wave GPU performance remain unverified.
