# VEXOLITH // SURVIVOR — Balance Report (first pass)

**Date:** October 17, 2026 · **Tool:** `npm run balance` (`tools/balance-sim.mjs`) · **Backlog:** phase 2 "intentional balance tests", open question "target run lengths".

All numbers are from the deterministic simulator (seed `vexolith`, fresh pilot with no Armory ranks unless stated, average-skill bot pilot, 15 min cap, no invulnerability). They describe a **bot**, not people: treat absolute run lengths as relative to that bot and compare builds with each other. Nothing here was playtested by a human.

## TL;DR

- **Runs are short and front-loaded easy.** A fresh pilot's median run is **5:19** (wave 15). Waves 1–7 cost under 20 shield per wave and 58% of wave 1–3 swarmers die to their first hit; then 84% of runs die between waves 9 and 20 (2:56–7:20). Proposed target: **8–10 min median** for a fresh pilot (see [Run length](#run-length-vs-a-proposed-target)).
- **One applied fix:** Prism Split (multishot) was a trap card — the worst focus card (median 3:34) and a *loss* of DPS at LV 1–3 in the static bench, because its widening fan left the aimed target in the gap between the inner bolts (and LV 7 wrapped 16 bolts over 782°). `WEAPON_SCALING.multishotSpread` **0.11 → 0.04** lifts the projectile build from **3:47 → 5:53** median and focus-multishot from **3:34 → 5:08**.
- **Splitters + their mini-splitters deal 55–78% of all shield damage** in every build. They are the single biggest difficulty driver and the main reason runs end; fixing them needs code in `enemies.js` / `killEnemy` (recommended below, not applied).
- **Aegis Orbiting Blades are dead weight**: ≤1% of damage in every strategy, including when picked first. A bigger orbit (tested) does not fix it; it needs a mechanic change.
- **No single dominant build.** After the fix, strategy medians span 3:48–6:26. Best: Phase Piercer focus (6:04) and explosive Storm Protocol (6:26); worst: Phase Nova Thrusters focus (3:48) and Tectonic mining (4:11–4:43).

## Method

`tools/balance/harness.mjs` builds a real `Game` (main.js, enemies.js, asteroids.js, upgrades.js, progression.js) with browser services stubbed, as in `tests/long-run.test.js`, and steps `update(1/60)`. Particles, grid, audio and damage numbers are silent. The bot pilot:

- moves away from enemies within 270 px (460 px for bosses, 340 px for vortexes, weighted heavier), circles the pack instead of backing into a wall, steers off the arena edge and around rocks, and picks up caches and nearby Geoms when the threat is low;
- aims with the game's own auto-aim and fires constantly; dashes when an enemy is within 22 px or 5+ are within 70 px; uses a Supernova when below 35% shield in a crowd of 10+, or below 50% next to a boss;
- reacts with **12 ticks (200 ms) of latency** (`--skill average`; `expert` = 1 tick, `novice` = 20 ticks);
- picks cards by a strategy priority list (anything unlisted is a seeded random pick) and claims every cache.

Strategies: `projectile` (multishot → fire rate → pierce → Pulsar Helix), `explosive` (missiles → arc → Storm Protocol), `orbital` (blades → thrusters → pierce → shrapnel), `singularity`, `mining` (claws → Tectonic Bore → luck → magnet; the bot also drills rocks when calm), `random`, plus `--focus`: one `focus:<id>` per upgrade (that card first, rest random). Damage is attributed by the `source` every weapon passes to `Game.hitEnemy` (new weapons appear automatically), with shared `other` split into shrapnel / dash nova / tectonic bore / vortex burst and Pulsar Helix / Storm Protocol split from blaster / lightning.

The **card bench** installs one card at each level and keeps 50 wave-6 targets (swarmer ×2, pinwheel, weaver, splitter) topped up around an invulnerable ship: `pack` = static ship, stationary targets 70–420 px away; `chase` = the ship circles at 70% move speed and targets chase it (leaks/min = targets reaching the shield).

Data sets below: **before** = `--runs 10 --focus --no-bench` on the original code (180 runs); **after** = the same seeds after the multishot change (180 runs). With 10 runs per strategy, medians move by about ±1 min between seeds, so only differences larger than that are treated as findings.

## Run length vs a proposed target

| setup (after the fix) | runs | median | p10 – p90 | median wave | cores/run |
|---|---:|---:|---:|---:|---:|
| fresh pilot, average skill, all 18 strategies | 180 | **5:19** | 3:42 – 8:17 | 15 | 84 |
| Armory rank 3 in every upgrade (364 cores) | 36 | 8:04 | 5:12 – 11:50 | 23 | 173 |
| full Armory (2,216 cores) | 36 | 13:03 | 10:35 – 13:37 | 36 | 314 |
| fresh pilot, expert bot (1-tick reactions), 20 min cap | 24 | 12:00 | 9:24 – 16:05 | 33 | 185 |

**Proposed targets** (for discussion; nothing was tuned toward them):

- **Fresh pilot, focused build: 8–10 min median** (waves 22–27, 7–9 boss encounters), with almost no deaths before wave 8 (3 min). Currently 5:19, about half the target.
- **Built-up pilot (Armory ~rank 3): 12–15 min**, where a sector boss + portal (backlog §9) could end the sector. Currently 8:04.
- **Endless:** no cap. Today even a full Armory hits a hard wall at **wave ~34–38 (~13 min)** for every build (strategy medians only 11:57–13:23): the `1.09^(wave−6)` HP term overtakes all player scaling, so endless runs end on the clock, not by player choices.
- **Meta pace:** rank 3 everywhere costs ~4 fresh runs of cores; the full Armory ~12–20 runs. That's a short long-tail; blueprints (backlog §8) have room to extend it.

## Findings

### 1. Builds (survival per strategy, after the fix)

| strategy | median (min – max) | median wave | DPS | top damage sources |
|---|---|---:|---:|---|
| explosive | 6:26 (4:53 – 7:54) | 18 | 2,237 | missile 30%, Storm chain 28%, blaster 14% |
| random | 6:13 (3:34 – 7:54) | 17.5 | 2,200 | blaster 31%, shrapnel 19%, Storm chain 13% |
| focus:pierce | 6:04 (4:14 – 10:13) | 17 | 3,371 | blaster 34%, shrapnel 17%, missile 14% |
| projectile | 5:53 (3:31 – 9:30) | 16.5 | 2,619 | blaster 58%, supernova 8%, helix 8% |
| focus:shrapnel / magnet / missiles | 5:41 – 5:47 | 16–16.5 | 1,970–4,077 | mixed |
| singularity | 5:37 (3:28 – 9:04) | 16 | 2,687 | blaster 46%, singularity 11%, helix 10% |
| focus:lightning | 5:34 | 15.5 | 1,553 | blaster 28%, arc 15% |
| focus:multishot / luck / orbitals | 5:08 – 5:11 | 14.5 | ~2,300 | — |
| focus:firerate | 4:52 | 14 | 1,562 | blaster 40% |
| mining | 4:43 (2:07 – 6:23) | 13.5 | 1,042 | blaster 35%, missile 16%, supernova 14% |
| orbital | 4:40 (4:07 – 10:13) | 13.5 | 2,386 | blaster 27%, **shrapnel 23%**, orbital **1%** |
| focus:singularity | 4:39 | 13.5 | 1,310 | blaster 27%, shrapnel 19%, singularity 12% |
| focus:mining_speed | 4:11 | 12 | 2,083 | — |
| focus:thrusters | **3:48** (2:56 – 5:26) | 11 | 638 | blaster 30%, supernova 17% |

- **No dominant build.** The spread between strategy medians is about 2.5 min. Explosive Storm Protocol and Phase Piercer are the strongest; Phase Piercer's +25% damage scales *every* weapon, and 63 of the 65 runs that lasted 6+ min took it.
- **Orbiting blades** do ≤1% of damage even at LV 5–6, in every strategy. The orbital build survives only on shrapnel and the blaster. The blades only touch enemies 46–90 px from the ship, and a kiting pilot rarely lets anything that close (the blaster kills it first). Testing `orbitalRadius` 90+8·lv raised their share to 3%; 80+8·lv with `orbitalDamageMult` 0.5 gave 2–3%. Neither changed survival beyond noise, so **neither was applied**.
- **Phase Nova Thrusters** is the weakest focus card (3:48) and loses the most shield of any focus strategy (121 HP/min vs 66–102 for the others). At LV 5 the hull is 2.1× faster and a dash covers ~400 px. With a 200 ms reaction delay the bot overshoots into packs, so this is **probably partly a bot artifact**; check it in a playtest. Dash Nova damage is flat (35 × level), so it falls off as enemy HP scales.
- **Mining** builds level fastest (3.6 levels/min vs ~2.8) but are among the shortest runs: drilling trades combat time for XP, and Tectonic Bore deals 1% of damage.

### 2. Difficulty curve (all 180 runs pooled, after the fix)

| waves | runs dying here | shield lost per wave | enemies on field | shield at wave end |
|---|---:|---:|---:|---:|
| 1–7 | 2 (1%) | 4–17 | 7–22 | 92–99% |
| 8–12 | 46 (26%) | 27–51 | 25–42 | 80–87% |
| 13–18 | 94 (52%) | 52–64 | 40–45 | 65–76% |
| 19–24 | 27 (15%) | 45–85 | 34–42 | 58–71% |
| 25+ | 11 (6%) | 68–216 | 33–69 | 28–85% |

- **Flat, trivial opening:** the first 2.5 minutes barely touch the shield, while the player reaches level ~11.
- **Spike from wave 9 to wave 18** (3:00–6:30): deaths go from 1 per wave to 15–24 per wave. Field population levels off at ~45 (far below the 130-alive pack limit and the 200 cap, so it is set by spawn cadence vs kill rate), so the spike comes from HP and contact damage (`+8%`/wave after wave 5) rather than numbers.
- **Late wall:** the `1.09^(wave−6)` HP term makes waves 30+ lethal even for a full Armory (see run length).

### 3. Enemies

**Damage taken by enemy type (share of shield lost, after the fix):** mini-splitters 23–48% and splitters 25–42% in every strategy. Together they deal **55–78%** and land most killing blows (124 of 180 runs, 69%). Swarmers deal 6–18%, pinwheels 4–18%, weavers 6–12%, vortexes ≤4% and bosses ≤5%.

- Mini-splitters spawn **instantly** (0.02 s ring instead of 0.55 s) with a 6.5 px/tick burst and then chase at 4.3 px/tick, which is close to the base hull speed (5.0). A splitter killed near the ship sprays three unavoidable bodies, each dealing the full 18+ contact damage.
- **Bosses are not a threat:** ≤5% of shield damage, and 3 killing blows in 180 runs. Time-to-kill is 8.7–12.4 s from the first hit, which suits a "major event", but they rarely touch the ship.
- **Vortexes:** ≤4% of shield damage. Their burst-on-death (`vortex_burst`, ~1% of damage dealt) will disappear when vortexes become invulnerable portals; the simulator measures it but does not depend on it.

**Time to kill (first hit → death, median / mean hits; all runs; enemies swept by a Supernova or rammed before any weapon hit them are excluded):**

| type | W1–3 | W7–9 | W13–15 | W21–25 |
|---|---|---|---|---|
| swarmer | 0.00 s / 1.5 (58% one-hit) | 0.10 s / 2.7 | 0.23 s / 4.2 | 0.40 s / 7.0 |
| mini-splitter | 0.10 s / 2.2 | 0.17 s / 4.1 | 0.23 s / 6.5 | 0.30 s / 10.5 |
| weaver | 0.13 s / 2.6 | 0.57 s / 4.9 | 0.87 s / 8.1 | 0.90 s / 14.1 |
| pinwheel | 0.17 s / 3.0 | 0.73 s / 5.5 | 1.07 s / 8.9 | 1.17 s / 14.9 |
| splitter | 0.53 s / 6.4 | 1.53 s / 11.8 | 1.90 s / 18.4 | 1.87 s / 31.9 |
| vortex | 1.67 s / 13.8 | 3.53 s / 25.7 | 3.93 s / 37.8 | 3.47 s / 56.9 |
| boss | 8.67 s / 78.5 | 12.17 s / 108 | 11.10 s / 145 | 8.67 s / 205 |

This confirms the playtest note "many enemies die too quickly and feel alike". In waves 1–3, **pinwheels and weavers die in 0.13–0.17 s**, one or two blaster volleys, which is barely slower than a swarmer pop. Durable archetypes only become durable from wave ~7. After wave ~13, TTK flattens for every type because player damage keeps pace with the HP curve. The difficulty spike comes from contact pressure, not from tankier enemies.

### 4. Weapons: card throughput bench (after the fix, 3 seeds)

Own-source DPS of each weapon card in the `chase` bench (backlog target: every weapon about the same potential DPS at the same level):

| weapon | LV 1 | LV 3 | LV 5 | LV 6 |
|---|---:|---:|---:|---:|
| Swarm Missiles | 184 | 405 | 726 | 964 |
| Tesla Arc | 63 | 206 | 567 | 743 |
| Aegis Blades | 70 | 171 | 261 | 333 |
| Vortex Singularity | **610** | 718 | 1,052 | (max 5) |
| Volatile Shatter | 33 | 130 | 637 | (max 5) |
| Dash Nova (thrusters, dash on cooldown) | 249 | 672 | 1,121 | (max 5) |

- At LV 1 there is an **18× spread** (shrapnel 33 → singularity 610). **Singularity's** potential is 2.4–18× every other LV 1 weapon when the swarm converges, but in real runs it is 11–12% of damage and its focus build is below average (4:39). Its collapse lands where enemies *were*, not where the pilot leads them. Bench and runs disagree, so it was not changed.
- **Tesla Arc LV 1** and **Volatile Shatter LV 1–3** are the weakest. Shrapnel jumps from 213 to 637 DPS between LV 4 and LV 5, where its proc chance reaches 100%.
- **Blades** are the lowest at LV 5–6 even when enemies come to the ship.
- Stat cards (chase, marginal DPS): Phase Piercer is the strongest card at every level (+280 at LV 1, +908 at LV 6). Hyper-Capacitor grows steadily (+35 → +485) and is the best at keeping enemies off (21 leaks/min at LV 7 vs 61 baseline).

## Applied change (before → after)

**`WEAPON_SCALING.multishotSpread` 0.11 → 0.04** (`js/weapon-scaling.js`). Prism Split's per-level numbers moved from `upgrades.js` into weapon-scaling (`multishotBolts: 2`, `multishotSpread`). No mechanic changed: same bolt count, same per-gap spread formula, and cards still preview through the real install.

Why: the blaster fan has an even bolt count, so nothing flies down the aim line. With +0.11 rad per gap per level, LV 1's inner bolts sit ±0.125 rad off the aim line, which misses a swarmer beyond ~110 px. Each level widened that gap, and LV 7's 16 bolts spanned 782° (the card's own "Volley arc" row showed it). Picking Prism Split made the ship worse at hitting what it aimed at.

| measure (same seeds) | before (0.11) | after (0.04) |
|---|---:|---:|
| `projectile` median survival (10 runs) | 3:47 (wave 11) | **5:53** (wave 16.5) |
| `focus:multishot` median survival | 3:34 (wave 10), worst of 18 | **5:08** (wave 14.5) |
| `focus:multishot` DPS / shield lost per min | 939 / 89 | 2,410 / 81 |
| bench `pack` (2 seeds), marginal DPS LV 1 / 2 / 3 | −11 / −28 / −18 | +21 / +17 / −12 |
| bench `chase` (2 seeds), marginal DPS LV 1 / 3 / 5 / 7 | 103 / 206 / 214 / 438 | 114 / 304 / 351 / 385 |
| bench `chase`, leaks/min LV 5 / LV 7 | 58 / 62 | 54 / 44 |
| card "Volley arc" LV 1 / LV 7 | 43° / 782° | 31° / 361° |
| all 180 runs: median survival, strategy-median spread | 4:44, 3:34 – 6:20 | 5:19, 3:48 – 6:26 |

A tighter variant (0.025) was also tested and did slightly worse (projectile 5:27, focus 4:55): a very tight fan loses the multi-target coverage that makes extra bolts worth taking. LV 7 still closes a full circle at 0.04; a centre bolt would fix the even-count gap for good (recommended below).

## Recommended tuning (not applied: these need code outside `config.js` / weapon-scaling, or more evidence)

1. **Mini-splitters (biggest lever):** give them the normal 0.35–0.55 s spawn ring instead of `instant`, and/or cut the 6.5 px/tick burst to ~3.5. Optionally lower mini contact damage (e.g. 60% of 18). Not simulated yet: this should lengthen runs toward the target without touching weapon power, so re-run the 180-run set to size it.
2. **Difficulty curve:** move the wave-scale formula (`1 + 0.25·(w−1)`, `1.09^(w−6)`), spawn cadence (`2.6 − 0.14·w`, min 0.75 s) and contact-damage ramp into a new `DEFAULT_TUNING` group so they can be tuned live. Then steepen waves 1–7 (more packs early, durable types +30–50% HP for the first ~5 waves so pinwheels and weavers don't die like swarmers), and soften the late exponent (e.g. 1.06) so full-Armory runs end on player choices rather than a fixed wave-36 wall.
3. **Aegis Blades:** a mechanic change, not a number. For example: blades sweep out toward the nearest enemy, intercept enemy contact (a defensive "parry" that destroys a touching enemy once per blade per N seconds), or orbit at the edge of the kite distance (~120–160 px). The re-test bar is ≥8% of damage in the orbital build.
4. **Prism Split:** add a centre bolt (odd counts) or cap the total arc. That removes the remaining gap and keeps LV 7 under a full circle.
5. **Phase Piercer:** split the +25% global damage from +2 pierce (backlog §3 tag/family cards), so the best-in-slot card isn't also the universal damage card.
6. **LV 1 weapon parity:** raise Tesla Arc LV 1 (`lightningDamageMult` 1.4 + 0.35·lv → ~2.0 + 0.3·lv) and Volatile Shatter LV 1–3 (proc chance 0.45 + 0.12·lv → 0.6 + 0.1·lv). Lower Vortex Singularity's LV 1 collapse (10 + 5·lv → 6 + 6·lv) only if playtests show it dominating; the simulator's runs don't.
7. **Phase Nova Thrusters:** playtest first. If humans also crash into packs at LV 4–5, reduce the per-level speed (1.16 → 1.10) and let Dash Nova scale with player damage instead of a flat 35·lv.
8. **Bosses:** at ≤5% of shield damage they are spectacle, not threat. Give them a contact-range attack (backlog §6) before raising HP.

## Reproduce

```bash
npm run balance                                              # ~1 min: 6 strategies x 3 runs + bench
npm run balance -- --runs 10 --focus --no-bench --json out.json   # the 180-run data sets above (~6 min, 4 cores)
npm run balance -- --runs 6 --meta 3 --no-bench               # Armory sensitivity
npm run balance -- --skill expert --runs 4 --max-minutes 20 --no-bench
npm run balance -- --strategies projectile,focus:multishot --runs 10 --weapon "multishotSpread=0.11"   # the "before" side
npm run balance -- --strategies orbital,focus:orbitals --runs 10 --weapon "orbitalRadius=lv => 90 + lv * 8"
```

Known limits: one bot pilot, so skill-dependent and aim-dependent weapons are judged by how this bot plays. Auto-aim targets the nearest enemy, which undervalues manual aiming. The bot never plans routes through tunnels. Bench targets are all wave 6. Supernova use is scripted. 10 runs per strategy leave about ±1 min noise on medians, so use `--runs 20+` before acting on smaller differences.

## Weapon DPS normalization (design decision, after phase 2)

**Rule:** every autonomous weapon has the same *potential* DPS at the same level: `DPS_TARGET(L) = 3 · L^1.5 ×` base damage per second (3.0, 8.5, 15.6, 24.0, 33.5, 44.1 for L1–L6). Potential = every attack lands on a target (each missile, arc jump, mine, turret/drone bolt, singularity core tick + collapse, each blade pass over an enemy on the ring); splash on extra targets is not counted. How easy each weapon is to use is tuned separately.

**How:** `js/weapon-scaling.js` keeps each weapon's counts, cooldowns and ranges and *solves* damage per hit from the curve (`POTENTIAL_DPS` mirrors the formulas). `tests/weapon-balance.test.js` holds every weapon within 1% of the curve, requires new weapon cards to join it, and checks damage per hit never drops on level-up. To keep per-hit damage rising, a few count curves were eased: missile cooldown `1.9 − 0.1·L`, Tesla Arc cooldown `1.65 − 0.1·L`, drones `min(3, L)`, turret cooldown `8.5 − 0.5·L`, turret fire rate `2.6 + 0.45·L`. Shrapnel (needs kills) and the dash nova (needs dashes) stay outside the curve.

**Real fights (chase bench, 50 wave-6 chasers, own-source DPS at L3 / L6):** missiles 530 / 824, mines 449 / 588, singularity 727 / 852 (L5), orbitals 228 / 493, drones 140 / 296, lightning 163 / 401, turret 102 / 205. Area weapons still lead in crowds because splash isn't part of the potential; that is the "difficulty of use" layer left for tuning.

## Weapon loadout and leveling (design change)

**Designer intent:** start with the ship's own weapons, carry at most 6, see level-ups only for what you carry (plus general upgrades), add weapons through frequent NEW WEAPON cards, and level much faster so a long run reaches LV 50+ with a few epic/legendary weapons instead of many weak ones.

**What changed**

- **Loadout (`js/loadout.js`).** 6 slots (`weaponSlots`). The crab starts with Pew Pews only (Wing Rockets moved to the NEW WEAPON pool). Level-up hands offer level-ups and weapon-specific upgrades only for equipped weapons, general upgrades always, and tag cards only for tags an equipped weapon carries. A NEW WEAPON card joins a hand with 35% chance while a slot is free (`newWeaponChance`) and is guaranteed after 2 hands without one (`newWeaponPity` 3); it opens a pick of 1 of 3 unequipped weapons with exact LV 1 stats. Caches never offer it. Discarding (pause menu) removes a weapon, its level, its own upgrades and any evolution that no longer qualifies.
- **Weighted hands.** Equipped weapon level-ups weigh 3, weapon-specific lines 1.5, general cards 1, tag cards 0.7, evolutions 4 × luck (all TUNING). Every weapon line goes to **LV 8** (Prism Split and Phase Piercer too), so six weapons hold ~50 weapon levels, and lucky +3/+4/+5 jumps land on weapons you already use.
- **Wing Rockets** are a leveled weapon on the shared DPS curve: 2 rockets per volley every 1.0 s at LV 1, 0.7 s from LV 6, up to 6 rockets at LV 8, blast 50 → 78 px. Damage per hit is solved from `DPS_TARGET` like the other weapons (`POTENTIAL_DPS.rockets`). Cryo Payload now also chills rocket blasts.
- **LV 7–8 curves.** To keep damage per hit rising: missile cooldown floors at 1.2 s, Tesla Arc cooldown at 0.95 s, turret deploy cooldown at 5.5 s. LV 1–6 numbers are unchanged. `tests/weapon-balance.test.js` checks every weapon to LV 8.
- **XP curve.** XP to next level was `12`, then `×1.32 + 6` per level, which priced LV 40 out of reach. It is now a stepped line: 25 + 16 per level to LV 20, +100 per level to LV 40, then +60 per level (`xpCurveBase`, `xpCurveStep`, `xpCurveStepMid`, `xpCurveStepLate`).

**How the curve was chosen.** XP income depends on how well the pilot keeps killing, and it climbs fast as packs grow and spawns speed up (about 300 XP/min in minute 1, 600–900 in minute 3, 2–5K/min from minute 5). The simulator now reports **level by minute**, **XP per minute** and the **end-of-run loadout**, and `--god` keeps the ship alive to measure pacing past the bot's usual death. A first try (+8/+12/+16 per level) let a bot reach LV 60 by minute 10. A steep middle band (+350 per level) starved the bot, which then couldn't kill late waves; income collapsed and intervals passed 60 s by minute 8. The shipped values sit between the two.

| measure (seed `vexolith`) | old curve | new curve |
|---|---:|---:|
| average bot, 6 strategies × 6 runs: level at death (median by strategy) | 11–18 | 14–22 |
| seconds per level-up in minutes 1–3 | 5 → 25+ | 9–15 |
| level at 3:00 / 5:00 (runs alive) | ~L12 / ~L16 | L14–17 / L21–31 |
| god mode, 4 strategies × 1 run: level at 12:00 / 20:00 | — | L32–44 / L40–50 |
| god mode: seconds per level-up after minute 8 | — | 30–60 |
| weapons equipped at death (mean, 6 strategies) | — | 4.2–6.0 |

Survival for the average bot is about where it was (median 2:42–5:03 by strategy): runs still end at the wave 9–18 difficulty spike described above, so the "average 12-minute run" and "strong 30-minute run" targets depend on the run-length tuning, not on this curve. Even in god mode, XP income drops after minute ~12 for weaker builds because the bot can no longer kill late waves (the `1.09^(wave−6)` HP term). If runs get longer, re-check pacing with `npm run balance -- --god --max-minutes 30` and adjust the four `xpCurve*` values. Strong builds (missiles + Tesla + Storm Protocol, or orbitals + shatter + drones) reach 6 weapons by ~3–4 minutes.

**Open:** Wing Rockets fire along the hull heading, so in the static bench (fixed heading) they add only +24 → +282 DPS from LV 2 to LV 8, below the area autonomous weapons; their potential DPS matches the curve, and the gap is the "difficulty of use" layer. Proximity Mines still bench near zero in the static pack (the ship doesn't move, so no mines are laid among targets), as before.

## Shatter passive, missile and turret retune (feedback pass)

- **Volatile Shatter is a passive, not a weapon.** It left `WEAPONS` for a new `PASSIVES` registry in `js/loadout.js`: no slot, never in the NEW WEAPON pick, never discarded. Its `shrapnel` line (LV 1–8) is a general upgrade, so it is offered in every level-up hand from the start at general weight 1 and rolls the usual +2…+5 rarity jumps. Owning it (LV 1+) counts its `PROJECTILE KINETIC` tags for tag gating, so it unlocks Tungsten Penetrators on its own. The pause-menu loadout panel shows it in a full-width PASSIVE // NO SLOT row; the HUD lists it with the other upgrades. **Balance:** shards were never on the DPS curve and still aren't (they need kills, like the dash nova). Each burst throws `3 + L` shards at a flat 0.75× base damage with a `min(1, 0.45 + 0.12·L)` chance per kill, boosted by KINETIC cards. Since it no longer costs a slot, every build can now carry it alongside 6 weapons. Watch whether it should get a lower card weight or a weaker early proc.
- **Swarm Micro-Missiles: faster, lighter salvos.** Cooldown `max(1.2, 1.9 − 0.1·L)` → `max(0.96, 1.52 − 0.08·L)`, exactly 0.8× at every level (1.80 → 1.44 s at LV 1, 1.20 → 0.96 s at LV 7–8). Damage per missile is still solved from `DPS_TARGET`, so it drops 20% (LV 1 2.70 → 2.16×, LV 8 9.05 → 7.24× base damage) and potential DPS is unchanged at every level. Cards read both from the same formulas.
- **Sentry Turret: double rate, half damage, double size.** Fire rate `2.6 + 0.45·L` → `5.2 + 0.9·L` bolts/s per turret (LV 1 3.05 → 6.10, LV 8 6.20 → 12.40); damage per bolt halves (LV 1 1.31 → 0.66×, LV 8 4.63 → 2.32×), so potential DPS is unchanged. Siege Battery shells scale off the bolt, so they fire twice as often at half the burst damage (same DPS). The turret is drawn at 2× (`TURRET_SCALE`; lifetime ring 19 → 38 px, hex 11 → 22 px), and every distance that depends on its size doubles too: muzzle 17 → 34 px, rock clearance 14 → 28 px, turret spacing 34 → 68 px, sidesteps 38/76 → 76/152 px, view pad and deploy/expire rings.
- **Escort Drones: 4× fire rate, ¼ damage per bolt.** Fire rate `1.6 + 0.3·L` → `6.4 + 1.2·L` bolts/s per drone (LV 1 1.9 → 7.6, LV 8 4.0 → 16.0); per-bolt damage comes from `DPS_TARGET` so it drops to a quarter and potential DPS is unchanged. Purely a feel change: a steadier, busier stream to watch. The drone shot sound is voice-limited (70 ms gap), so it doesn't get noisier.
- `tests/weapon-balance.test.js` pins both retunes to the old curve (0.8× missile cooldown and damage; 2× turret rate, 0.5× damage) and to `DPS_TARGET`. `tests/deployables.test.js` checks turret size, placement and the live bolt rate. `tests/loadout.test.js` covers the passive's offer, gating, panel and Field Guide text.

## Void Armory rebuild (v0.15.0)

20 single-stat upgrades; rank n costs `round(baseCost × growth^n)`. Income baseline from the balance sim (no armory, average pilot): ~140 Void Cores per 12-minute run, ~12/min, ~700/hour.

| upgrade | per rank | ranks | first cost | last cost | total |
|---|---|---:|---:|---:|---:|
| Plasma Overcharge | +1.5% damage | 40 | 9 | 747 | ~6.9k |
| Chronos Capacitor | +1% Pew Pews fire rate | 30 | 12 | 415 | ~3.5k |
| Deadeye Lattice | +0.4 pts crit chance | 25 | 15 | 430 | ~3.2k |
| Fracture Rounds | +2% crit damage | 25 | 15 | 430 | ~3.2k |
| Field Expander | +1% area | 25 | 18 | 516 | ~3.8k |
| Aegis Shield Matrix | +4 max shield | 40 | 8 | 470 | ~4.7k |
| Ablative Plating | -0.5% damage taken | 30 | 18 | 804 | ~6.4k |
| Phase Buffer | +0.02 s post-hit invulnerability | 15 | 22 | 223 | ~1.3k |
| Vector Thrusters | +0.8% move speed | 25 | 12 | 279 | ~2.2k |
| Blink Coils | -1% dash cooldown | 25 | 15 | 348 | ~2.7k |
| Deep-Core Extractor | +2% Void Core gain | 40 | 15 | 1247 | ~11.5k |
| Geom Resonator | +1% XP | 30 | 12 | 415 | ~3.5k |
| Gold Assayer | +4% gold per vein | 20 | 15 | 213 | ~1.5k |
| Prospector Stake | +2 starting gold | 15 | 18 | 162 | ~1.0k |
| Rotary Claw Drive | +3% mining speed | 25 | 9 | 169 | ~1.4k |
| Quantum Fortune | +0.02 luck | 25 | 15 | 430 | ~3.2k |
| Vacuum Array | +2% pickup radius | 25 | 9 | 169 | ~1.4k |
| Probability Engine | -2% reroll cost | 15 | 22 | 198 | ~1.3k |
| Extended Claws | +2% drill reach | 15 | 12 | 85 | ~0.6k |
| Supernova Reserve | +1 starting bomb | 3 | 400 | 3600 | 5.2k |

Total ~68k cores. Rough time to complete at ~700 cores/hour (rising to ~1,200/hour with Deep-Core Extractor maxed): 25% in ~8 h, 50% in ~25 h, 100% in ~70–95 h. Early ranks cost 8–22 cores, so a first run buys something.
