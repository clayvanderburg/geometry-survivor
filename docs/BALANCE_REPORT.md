# VEXOLITH // SURVIVOR — Balance Report (v0.42.5)

**Date:** October 20, 2026 · **Build:** master `5b4da93` (v0.42.5) · **Tool:** `npm run balance` (`tools/balance-sim.mjs`) · replaces the Oct 17 first pass (v0.33), whose findings are re-checked below.

All numbers come from the deterministic simulator: seed `vexolith`, average-skill bot (200 ms reactions), fresh pilot (no Armory) unless stated, 20 min cap, no invulnerability. They describe a **bot**, not people. Compare builds and tuning variants with each other; treat absolute times as "this bot". Nothing here was playtested.

> **Calibrated Oct 20 (v0.43.1), see [Calibration](#calibration-oct-20-v0431) below.** The v0.42.5 numbers further down came from a bot that reacted 200 ms late *without anticipating*, which made runs ~2× too short and the rocket/missile starts look like a death sentence. Items marked **⚠ recalibrated** changed; the rest are still the v0.42.5 run and should be read as relative.

## TL;DR

1. **⚠ recalibrated (5:19 / wave 15 on v0.43.1).** **Runs got shorter, not longer.** A fresh pilot's median run is now **3:21** (wave 10), down from 5:19. 72% of deaths land between 1:00 and 5:00 (waves 3–14). The 8–10 min target is further away than in October.
2. **Contact damage is the lever, not enemy HP.** `damageRampBase` 0.45 → 0.35 lifts the pooled median from **3:50 → 5:52**. Lower early HP, smaller packs or fewer splitters barely move it (the HP budget refills the field). → *Enemies lane*.
3. **Autocannon is the whole game.** It deals **54% of all damage** and 73–81% in builds that level it. Its realized DPS is **2.45× the median weapon**. Focusing it (6:16 / 8:07 projectile) is the only build that beats random (3:38). No other weapon's focus build beats random. → *Weapons lane*.
4. **⚠ recalibrated: the sim still under-rates these starts (real missile starts last 6–10 min); see Calibration.** **Starting with Rocket Pods or Swarm Missiles is a trap.** Median **0:39 / 0:48** (vs 3:50 for an Autocannon start), most runs dead in wave 2. The expert bot loses a third of these runs by wave 3. Missiles start at **half** the DPS curve (`LV1_TRIM.missiles 0.5`). → *Weapons lane*.
5. **⚠ superseded by real play: Clay beat the 50-wave campaign (W59, 21:17) with 0 Armory on v0.43.0.** **Hard wall around wave 30–35, so a 50-wave campaign can't be finished.** Even a **full Armory** bot has a median of wave 30 (10:36). 3 of 36 runs reach wave 40, none reach 50. At the current curve, enemy HP at wave 50 is **335×** wave 1. → *Enemies lane* (`waveHpGrowth` 1.10 → ~1.07 for the 50-wave plan).

Also: splitters are still the #1 killer, but their share of shield damage fell from 55–78% to **34%**. Aegis Blades are still dead weight (**0.7%** of damage). Bosses are spectacle, not threat (**4%** of shield damage). Breakthroughs have no dominant choice (transform ≈ boost).

## Calibration (Oct 20, v0.43.1)

**Build:** master `6970a27` (v0.43.1) · **Real data:** the live `/api/stats/summary` aggregate (50 runs, all versions), per-version summaries for v0.36.1–v0.42.5 (26 runs), the PR #137 preview (v0.43.0, 5 runs) and the global leaderboard, all read Oct 20. The real sample is small and comes mostly from two skilled players (Clay and NOX). Uploaded runs do not record Armory ranks yet ([PR #141](https://github.com/clayvanderburg/geometry-survivor/pull/141) adds them), so real numbers mix Armory tiers. Clay's runs quoted below had 0 Armory.

### Root cause: the bot reacted late and never anticipated

The bot pilot acts on controls it decided 12 ticks (200 ms) earlier, but it decided them from the world *as it was then*, with no lead. A crowd closing at 5–8 px/tick moves 60–100 px inside that window, so the bot dashed and dodged only after contact. With a weak opening weapon the field fills up (55–70 enemies in wave 1 with Rocket Pods vs ~35 with the Autocannon) and the stale steering drives into it. That is a non-linear collapse, so it punished the rocket and missile starts far more than the Autocannon.

**Ruled out:**

- **Harness damage is correct.** For rockets and missiles, harness damage matches the game's own run stats within the DoT sub-sources.
- **Rocket aim is fine.** 74% of rockets hit; 25% are stopped by rocks, as in the real game; 1% expire.
- **Missiles work as built.** Every missile detonates. The sim's missile LV 1 rate (~4.2 base-damage units/s) matches real play (3.4–4.7).
- **Card picks don't explain it.** Taking the weapon's own level-ups first did not help on v0.42.5.

**Fix (harness only, `tools/balance/harness.mjs`):**

- **Anticipation (new default):** the pilot judges every threat where it and the ship will be when the input lands, extrapolating enemy and ship velocity by the reaction latency. That is how players lead a chasing pack. `--no-anticipate` restores the old bot.
- **`--kite K`:** scales the pilot's threat radius (default 1).
- **Enemies-per-hit table:** a new section in `npm run balance` output (below).
- **A game crash found on the way:** Orbit Blades crashed when a kill shrank the enemy list mid-loop (fixed in #139).

### Start weapons and run length: before vs after (v0.43.1)

| | old bot (12 runs) | calibrated bot (8 runs) | real players |
|---|---|---|---|
| Autocannon start | 1:39 · W5 | **5:44 · W16** | v0.42.5: 3 runs, median 4:39 |
| Rocket Pods start | 0:47 · W3 | **1:05 · W3.5** | no rocket-start runs uploaded yet |
| Swarm Missiles start | 0:37 · W2 | **1:16 · W4** | v0.42.x: 6:28, 7:15, 8:02 (3 runs); v0.43.0 preview: 5 runs, median **10:00 · W28**, most of them missile starts |
| fresh pooled (21 strategies, excl. rocket/missile) | — | **5:19 · W15** (168 runs) | v0.36.1–0.42.5: 26 runs, median ~7–8 min (15 of 26 end at 5–10 min) |
| weapon focus: rockets / missiles | — | 2:03 / 3:02 | — |
| best runs | — | 13:24 · W37 (projectile) | Clay: **W59, 21:17, 0 Armory** (v0.43.0 campaign win); leaderboard top W48 (~17:30) on three versions |

Latency × anticipation on v0.42.5 (12 runs each, 10–12 min cap; median time):

| pilot | Autocannon start | random | Rocket Pods start | Swarm Missiles start |
|---|---:|---:|---:|---:|
| 200 ms, old (no lead) | 3:50 | 3:38 | 0:39 | 0:48 |
| 200 ms, anticipating (**default**) | 5:44 | 6:00 | 2:38 | 0:50 |
| 133 ms, anticipating | 6:14 | 7:13 | 2:42 | 2:00 |
| 67 ms, anticipating | 6:20 | 6:00 | 5:20 | 3:03 |
| 17 ms (`--skill expert`) | 7:26 | 6:52 | 5:10 | 5:03 |
| 200 ms, anticipating, `kite` 1.4 | 7:04 | 7:00 | 1:51 | 1:19 |

**What lines up now:** pooled run length (bot 5:19–6:00 vs real ~7–8 min, from skilled players) and the Autocannon start. Per-weapon realized DPS was already right, because it comes from the game's own run stats.

**Remaining gap: missile and rocket openings.** At the default pilot, missile starts die in 1–2 min where real players last 6–10 min. Real missile-start players survive 65 s at LV 1 and reach level 10 by 1:46; the bot dies around 40 s at level 4, cornered by splitters while weaving 50–130 px from a 60–70 enemy pack. The gap closes only with near-zero reaction time (expert: ~5 min). Wider kiting helps every build but not this one.

- **Use for rocket/missile starts:** `--skill expert` until the bot's opening improves. Read the default pilot's rocket/missile-start numbers as a floor, not as "a trap".
- **Splitters are the bot's problem more than players':** splitters are 37% of the bot's shield damage. Real players take most of theirs from blinkers (19.5%), gunners (15.6%), swarmers (13.3%) and lieutenants (11.7%); swarmers did the most in Clay's W59 win.

**Supernova share.** Real players: **16%** of all damage (all versions), **31%** pooled on v0.36.1–0.42.5, **20%** on the v0.43.0 preview, **27%** in Clay's 12:00 run. The bot: **9%** pooled (median 10% per run), because it fires a Supernova only below 35% shield inside a crowd of 10+ or near a boss.

- **Bomb policy:** the bot under-uses bombs. That is part of why it trails real players; a more eager bomb rule is a candidate next bot fix.
- **Design question:** at 20–30% of a skilled player's damage, Supernova is the #2 damage source after the main weapon. That is a design call for the Weapons/Hangar lanes, not a sim artifact.

**Skilled reference pilot for difficulty work:** `--skill expert --kite 1.4`. The plain expert pilot's 0-Armory median was about wave 22 on v0.42.5. Clay reaches W59, so treat bot waves as a lower bound and size difficulty changes as same-seed A/B deltas.

### Enemies per hit (area weapons and Autocannon pierce)

For the class rule (area weapons ~60–70% of the Autocannon's damage *per target*). Sim only: uploaded run stats record damage and kills per weapon, not hits per attack, so real values can't be measured yet (a per-weapon `[attacks, enemies hit]` pair in run stats would add them). From the 200-run v0.43.1 set (all strategies pooled, default pilot):

| attack | enemies per attack that hit something | attacks that hit nothing | what one "attack" is |
|---|---:|---:|---|
| Swarm Missiles blast | **3.63** | 48% | one missile detonation |
| Rocket Pods blast | **3.28** | 8% | the blast after a direct hit (the direct hit is in it) |
| Plasma Grenades blast | **4.70** | 48% | one grenade burst |
| Proximity Mines blast | 6.63 | 24% | one mine |
| Gas Trail | **10.27** per tick | — | one damage tick of the whole trail (every puff) |
| Flamethrower | **4.44** per tick | — | one sweep tick (enemies inside any cone, any coverage) |
| Cryo Sprayer | **4.17** per tick | — | same |
| Acid Sprayer | **3.93** per tick | — | same |
| Tesla Arc | 6.54 per cast | — | one chain (all jumps) |
| Vortex Singularity | 4.25 per tick, 9.44 per collapse | — | pull tick / collapse pulse |
| Autocannon bolt, pierce 1 | 1.00 | 50% | one bolt |
| Autocannon bolt, pierce 2 / 3 / 4 | 1.55 / 1.82 / 2.33 | 60 / 68 / 48% | Phase Piercer ranks |
| Autocannon bolt, pierce 5 / 6 / 7 | 2.31 / 2.34 / 1.92 | 66 / 63 / 76% | rarely reached, small samples |
| Autocannon, all bolts | 1.34 | 56% | |

- **Missile and grenade blasts:** half of them hit nothing. A missile whose target died flies on and bursts on the empty spot, and salvos set each other off. That is a real loss in the game, not in the harness.
- **Area-class rule of thumb:** a blast hits ~3.3–4.7 enemies against the Autocannon's ~1.3 per landed bolt, so ~65% per target works out to ~1.7–2.3× the Autocannon per landed attack.
- **Sprayer counts:** an enemy counts as hit at any cone coverage. Per-target damage is lower than tick count × per-hit damage.
- **Pierce counts:** pierce numbers are the bolt's pierce when it left play (Phase Piercer, Hyper-Capacitor and similar).

Reproduce: `npm run balance -- --runs 8 --weapon-focus --no-bench --max-minutes 20` (the *Enemies per hit* section). Old bot: add `--no-anticipate`. Skilled pilot: `--skill expert --kite 1.4`.

## Method

- **Harness changes in this PR:** `--weapon-focus` adds a `weapon:<id>` strategy for each of the 15 slot weapons. It starts with that weapon when it is a run-start pick; otherwise it takes NEW WEAPON until the weapon is offered. Then it takes that weapon's own level-ups first (power stats first), and everything else is random. It also adds a `start:<id>` random build per run-start pick (Autocannon / Rocket Pods / Swarm Missiles). Strategies can set `startWeapon` and `breakthrough`. Breakthrough picks (a coin flip by default) are tracked per run. Bosses are attributed by kind (`boss:ouroboros`, …). Shared `other` hits now use their stat, so Breakthrough and splash effects land on their weapon. Before this fix, ~15% of Autocannon damage showed up as "other". The difficulty table marks boss waves.
- **Data sets:** *main* = 25 strategies × 12 runs (300 runs, 20 min cap); *bench* = card throughput bench, 2 seeds; *Armory* = 6 strategies × 6 runs at Armory rank 3 and full Armory; *expert* = 1-tick reactions, 6 × 6 runs; *god* = pacing only; *A/B* = 5 strategies × 12 runs per tuning variant (same seeds).
- **Noise:** with 12 runs, a strategy median's 80% bootstrap interval is about ±0:45. Differences under ~1 min between single strategies are not findings. Pooled numbers (60–300 runs) are tighter.
- "Fresh pilot" pooled numbers exclude the four rocket/missile-start strategies (252 runs), because those are a separate finding (#4) and would drag the median down.

## Findings

### 1. Run length (old finding: median 5:19 vs 8–10 min target)

| setup | runs | median | p10 – p90 | median wave | cores/run |
|---|---:|---:|---:|---:|---:|
| fresh pilot, average bot (excl. rocket/missile starts) | 252 | **3:21** | 1:39 – 6:16 | 10 | 54 |
| fresh pilot, all 25 strategies | 300 | 3:06 | 0:39 – 6:04 | — | — |
| Armory rank 3 everywhere (incl. 3 starting Supernovas) | 24 | 4:55 | 2:41 – 8:55 | 14 | 89 |
| full Armory | 24 | 10:36 | 7:29 – 14:52 | 29.5 | 233 |
| fresh pilot, expert bot | 24 | 7:52 | 6:14 – 10:49 | 22 | 127 |

Deaths by minute (fresh, 252 runs): 0:00 13 · 1:00 26 · **2:00 55 · 3:00 70 · 4:00 42** · 5:00 14 · 6:00+ 32.

- The same bot lived ~2 min longer at v0.33. Since then, bruisers, gunner orbs, blinkers and serpents debut by wave 6–12. Together they now deal 22% of shield damage and land 87 of 300 killing blows.
- The opening is **no longer trivial** (in October, waves 1–7 barely touched the shield). Wave 2 (SKIRMISH LINE, splitter bias) costs 43 shield on average, more than any wave until 7, and 35 runs die there (27 of them rocket/missile starts).

### 2. Splitters (old finding: 55–78% of shield damage)

Fixed for the most part. Splitter + mini-splitter is now **34%** of shield damage pooled (strategy range: splitter 16–37%, mini 3–8%). It was 55–78%. Mini-splitters (`contactMult` 0.6, speed 3.8) fell from 23–48% to **5.7%**. Big splitters are still the **#1 killer** (87 of 300 deaths) and land 25 of the 37 deaths in waves 1–5. They take 2.1–2.8 s and 22–30 hits to kill from wave 1, a deliberate tank. Halving the splitter packs (`splitterPackMax` 10 → 5, `splitterPackPerWave` 0.4 → 0.2) only moved the pooled median from 3:50 to 4:25. Splitters are no longer the main lever.

Shield damage by source (fresh, pooled): splitter 28.5%, swarmer 14.7%, pinwheel 10.9%, weaver 9.9%, bruiser 8.7%, gunner orb 7.8%, mini-splitter 5.7%, blinker 2.9%, Ouroboros 2.6%, serpent 2.2%. **For runs that pass wave 10, gunner orbs become #2** (17–20% for the Autocannon builds, expert and full-Armory bots). They are the top killer in waves 11–15.

### 3. Weapons: ranking, traps and the dominant one

**Survival by weapon focus** (12 runs each; median [80% CI]):

| strategy | median | | strategy | median |
|---|---|---|---|---|
| projectile (Autocannon lines) | **8:07** [5:03–9:46] | | weapon:cryospray | 3:16 |
| weapon:blaster | **6:16** [4:58–7:40] | | weapon:shockfield | 3:14 |
| start:blaster (random) | 3:50 | | weapon:singularity | 3:08 |
| weapon:lightning | 3:47 | | weapon:gas | 2:50 |
| random | 3:38 | | weapon:orbitals | 2:43 |
| weapon:mines / acidspray / flamethrower | 3:31–3:37 | | weapon:grenades / turret | **2:38** |
| weapon:drones | 3:21 | | start:missiles / start:rockets | **0:48 / 0:39** |

**Realized DPS vs `DPS_TARGET`** (the game's own run stats; index = realized share of potential vs the same-level median; 1.00 = typical):

| weapon | dmg share | index | | weapon | dmg share | index |
|---|---:|---:|---|---|---:|---:|
| Autocannon | 54.3% | **2.45 ⬇** | | Missiles | 2.1% | 1.00 |
| Tesla Arc | 4.1% | **1.60 ⬇** | | Cryo Sprayer | 2.9% | 1.00 |
| Proximity Mines | 1.9% | **1.43 ⬇** | | Rocket Pods | 1.4% | **0.80 ⬆** |
| Gas Trail | 3.0% | 1.15 | | Escort Drones | 2.1% | **0.73 ⬆** |
| Singularity | 1.5% | 1.15 | | Shock Field | 1.2% | **0.70 ⬆** |
| Flamethrower | 1.7% | 1.14 | | Sentry Turret | 0.9% | **0.52 ⬆** |
| Acid Sprayer | 3.3% | 1.08 | | Aegis Blades | 0.7% | **0.47 ⬆** |
| Grenades | 1.3% | 1.02 | | | | |

- **Autocannon is dominant.** It is the only weapon with a focus build above random, and its stat lines (Damage, Hyper-Capacitor, Phase Piercer) are what make long runs. Every other weapon joins via NEW WEAPON at ~1:20–2:00 with no levels behind it, so the slot weapons end up as supplements: each does 1–4% of a run's damage. Part of the gap is structural: Autocannon is equipped from second 0 and levels from the first hand. A pure number nerf would only shorten runs further. The fix is to raise the others (see recommendations).
- **Traps:** Sentry Turret (index 0.52, focus 2:38, chase bench LV 1 own DPS 18 vs Autocannon 118), Aegis Blades (0.47, 2:43), Escort Drones (0.73, LV 1 bench 29), Shock Field (0.70). Rocket Pods are weak as a slot weapon (0.80) and catastrophic as a starting weapon.
- **Bench vs runs disagree for area weapons.** In the chase bench (crowd chases the ship), Gas Trail is the strongest weapon line (2,096 DPS at Damage rank 11 vs Autocannon's 719). Singularity (312 at LV 1), Acid Sprayer (250) and Grenades (229) also lead at LV 1. In real runs, Gas focus is 2:50. The bot does not deliberately lead packs through its trail. This is the usual "difficulty of use" layer: likely fine for humans, so confirm with player stats before buffing.
- **Tesla Arc stops scaling at Damage rank 6** in the chase bench (224 DPS from rank 6 to 11, flat). Its jump count or reach caps out. Check whether later Damage ranks do anything.
- **Old finding, Aegis Blades are dead weight: still true.** They deal 0.7% of all damage, 8% even in their own focus build (5% in `orbital`), and have the lowest realized index. The mechanic change recommended in October has not landed.
- **Volatile Shatter** (passive) jumps from 273 to 1,395 chase-bench DPS between LV 4 and LV 5, where its proc reaches ~100%. In runs it is 12–20% of damage in random-pick builds. It is fine, but the LV 5 cliff is steep.
- **Phase Nova Thrusters** (dash nova) bench at 299–1,692 DPS and cut leaks from 88 to 38/min at LV 1. No longer a trap in the bench. The old "bot overshoots" caveat still applies to runs.

### 4. Starting-weapon pick

| start | average bot | expert bot (4 runs, 6 min cap) | LV 1 chase bench, own DPS |
|---|---|---|---|
| Autocannon | 3:50 | 4/4 alive at 6:00 | 118 |
| Swarm Missiles | **0:48** (wave 2.5) | 0:44 – 5:59, median 3:22 | 118 (on curve ×0.5) |
| Rocket Pods | **0:39** (wave 2) | 0:43 – 5:58, median 4:45 | 80 |

Swarmers deal 40–55% of shield damage to these pilots (vs ~15% normally). Neither weapon clears the wave 1–2 trickle fast enough. Missiles fire 2 per 1.44 s at half the curve (`LV1_TRIM.missiles = 0.5`, set when missiles were a mid-run pickup). Rockets are dumbfire along the aim with a small blast. Full Armory hides it (7:17 / 7:36 vs Autocannon 11:12). A new player who picks either starting weapon will probably die in under a minute.

### 5. Breakthroughs

- Offered 1.0–4.3 times per run (Autocannon builds the most: they reach LV 12 and 18). The first comes at **1:16–1:42** (LV 6). 495 picks were recorded.
- **No dominant choice.** Time survived after the pick: transform 1:49 vs boost 1:59 (median, pooled). Per weapon at LV 6 the samples are 8–38 per side and the differences are mostly noise. Boost looks better for Acid, Cryo, Singularity and Missiles (~1 min). Transform looks better for Turret (+1.2 min) and Autocannon LV 12 (5:36 vs 4:21). These are leads for a closer look, not findings.
- LV 12 and 18 Breakthroughs are mostly Autocannon (27 of 50). Slot weapons rarely reach LV 12 before the run ends.

### 6. Difficulty curve by wave, enemies and bosses

| waves | runs dying (fresh, 300) | shield lost / wave | enemies on field | top killers |
|---|---:|---:|---:|---|
| 1–5 | 81 (incl. 44 rocket/missile starts) | 16–44 | 26–66 | splitter |
| 6–10 | 116 | 21–44 | 64–84 | splitter, bruiser, pinwheel, Ouroboros, orb |
| 11–15 | 67 | 27–38 | 74–93 | orb, splitter, blinker |
| 16–25 | 28 | 18–46 | 73–98 | splitter, bruiser |
| 26+ | 8 | 14–77 | 80–139 | orb, blinker, hulk |

- **Boss waves are the easy waves.** Most boss waves (3, 6, 12, 18, 21, 24) cost 17–27 shield, vs 34–44 on the waves around them. `bossPackRate` 0.7 thins the packs, and the bot kites bosses at 460 px.
- **Bosses:** 4.3% of shield damage (2.0–2.6% for expert and full-Armory bots), 23 killing blows in 300 runs. Of those, 12 are **Ouroboros** (wave 6 major, the only boss that kills regularly). Bosses are long fights: median time-to-kill is 7–13 s from wave 3–6, and many hit the 30 s measuring cap (Ouroboros, Hive Carrier, Architect, Event Horizon, Conductor). The old "spectacle, not threat" finding stands, and they now also drag.
- **Time to kill:** weavers and pinwheels take 0.2–0.27 s at waves 1–3 (5.6–6.5 hits). That is no longer one-shot like in October, but still swarm fodder. Mayflies die to their first hit 72% of the time.
- **Contact damage drives difficulty.** HP lost per minute tracks contact pressure, not enemy HP (see A/B below).

### 7. Endless wall (old finding: hard wall at wave ~34–38)

Still there, slightly earlier. With a full Armory: 13 of 36 runs reach wave 30, 3 reach wave 40, the best reaches 47, the median is 29.5. The cause is the same: HP scale = `(2.5 + 0.15·(w−1)) · 1.10^ease(w−8)`. It reaches 35× at wave 30, 109× at wave 40 and **335× at wave 50**. Contact damage also doubles from wave 30 to 50 (1.43 → 2.83×). Player DPS levels off in god-mode runs: level-ups slow to 40–120 s after minute 10.

### 8. Armory meta pace

- 18 upgrades, **~112k cores** to max (≈107k without Supernova Reserve). That is 64% more than the 68k of v0.15.
- A fresh pilot earns **54 cores/run** (old: 84). Ranks 1–3 of the 17 stat upgrades cost 864 cores, about **16 fresh runs**. Supernova Reserve rank 1 alone costs 400 (~7 runs).
- Rank 3 everywhere lifts the median from 3:21 to 4:55. A full Armory gets to 10:36 and 233 cores/run. At a ramp from ~54 to ~230 cores/run, maxing takes on the order of **600+ runs** (100+ hours at ~10 min/run). That is a long tail, and runs that end in ~3 min make the early climb feel slow.

### 9. Stretching to the 50-wave campaign (boss every 5th)

At 22 s waves, wave 50 lands at **18:20**. The same HP curve with the same boss count per wave gives:

| wave | time | HP scale now | HP scale at `waveHpGrowth` 1.07 | contact dmg now | at `damageRampPerWave` 0.05 |
|---:|---:|---:|---:|---:|---:|
| 10 | 3:40 | 3.9 | 3.9 | 0.45 | 0.45 |
| 20 | 7:20 | 10.4 | 8.6 | 0.74 | 0.66 |
| 30 | 11:00 | 34.6 | 21.6 | 1.43 | 1.15 |
| 40 | 14:40 | 109 | 52 | 2.13 | 1.65 |
| 50 | 18:20 | **335** | **120** | 2.83 | 2.15 |

- **Today nobody finishes 50.** The full-Armory median is wave 30. The expert fresh bot's median is 22, its best 32.
- Every 5th wave means 10 boss waves instead of 16 by wave 50. Boss waves are the lull waves (above), so the run gets **slightly harder per minute** unless `bossPackRate` or the HP budget compensate.
- Bosses at ≤5% of damage won't carry the campaign's difficulty beats. A boss wave every 5th will play like a breather, not a wall, unless bosses get threat.

## A/B tests (tuning variants, same seeds)

5 strategies × 12 runs (random, start:blaster, weapon:blaster, weapon:acidspray, explosive); baseline pooled median **3:50**.

| variant (`--tune`) | pooled median | weapon:blaster | random | note |
|---|---:|---:|---:|---|
| baseline | 3:50 | 6:16 | 3:38 | |
| `damageRampBase=0.35` | **5:52** | 8:48 | 5:41 | +2:00, every strategy up |
| `damageRampBase=0.3` | 6:14 | 8:18 | 5:17 | only +0:22 over 0.35 |
| `splitterPackMax=5 splitterPackPerWave=0.2` | 4:25 | 5:46 | 4:33 | +0:35 |
| `waveHpStart=2.0 waveHpStartLight=0.8` | 3:53 | 8:19 | 4:18 | no change pooled |
| `packSizeMult=1.0` | 3:24 | 7:11 | 2:51 | no gain (HP budget refills) |
| `damageRampBase=0.35` + softer HP + `waveHpGrowth=1.075` | 5:20 | 8:13 | 6:06 | ≈ contact-damage change alone |

## Recommendations

None of these were applied (balance hold: tuning goes to the owning lane). Each cites the number to change and what we expect. Re-run with the command listed to confirm.

### Enemies & Bosses lane

1. **Run length: `damageRampBase` 0.45 → 0.35** (contact and orb damage −22% at every wave until the ramp starts). Expected: fresh median 3:21 → ~5:30–6:00; Autocannon builds 6:16 → ~8:45. This is the single biggest lever found. Going to 0.30 adds only ~20 s more (pooled 6:14). Pair it with item 2 rather than going lower, so late waves still bite.
2. **⚠ Superseded (do not apply): the campaign is beatable at the current curve (Clay: W59 at 0 Armory), and the plan is now to make it *harder* for a 0-Armory pilot (Roadmap).** ~~50-wave curve (after PR #119 lands): `waveHpGrowth` 1.10 → 1.07 and `damageRampPerWave` 0.07 → 0.05.** Wave 50 HP 335× → 120× (≈ today's wave 41), wave 50 contact 2.83× → 2.15× (≈ today's wave 40). Expected: a full-Armory bot reaches wave 40+ and an expert one 30+. Size it with `npm run balance -- --meta 99 --runs 6 --max-minutes 25 --tune waveHpGrowth=1.07 --tune damageRampPerWave=0.05` on the #119 branch. Target: full Armory finishes wave 50 in roughly a third of runs.~~
3. **Gunner orbs:** 17–20% of shield damage once runs pass wave 10, and the top killer in waves 11–15. Cut orb damage ~25% (orbs share `damageRampAt`, so item 1 already does part of this) or slow them ~15% so they can be read and dodged.
4. **Bosses need threat, not HP.** They deal ≤5% of shield damage and often survive 30 s of fire. Lower `campaignBossHpMult` 2 → 1.5 (shorter fights) and give each boss one contact-range or telegraphed attack (backlog §6). Leave Ouroboros as is (it is the one that kills). With bosses every 5th wave, set `bossPackRate` 0.7 → 0.85 so boss waves stop being the easiest waves.
5. **Splitters:** no longer urgent. If wave 2 still feels spiky after item 1, drop SKIRMISH LINE's splitter bias (1.4 → 1.0).

### Weapons lane

1. **⚠ recalibrated: less urgent than it read. Real missile starts last 6–10 min; the sim's opening is the weak part (see Calibration). The `LV1_TRIM` change itself still stands as a buff to consider.** **Starting weapons:** for the run-start pick, drop `LV1_TRIM.missiles` (0.5 → 1.0), or apply the trim only to Missiles picked up via NEW WEAPON. Give Rocket Pods a starting-kit boost (e.g. +50% fire rate at LV 1 while it is the only weapon, or a homing nudge). Expected: rocket/missile starts go from 0:39–0:48 to within ~1 min of Autocannon (3:50). Alternative: keep Autocannon in slot 1 and make the pick a *second* weapon. Re-test: `npm run balance -- --strategies start:blaster,start:rockets,start:missiles --runs 12 --no-bench`.
2. **Bring the slot weapons up to Autocannon, don't nerf it** (a nerf shortens runs that are already too short). The run-stats index says: **Sentry Turret** ×1.9 (index 0.52; LV 1 chase-bench DPS 18), **Aegis Blades** ×2 plus a mechanic change (0.47; see below), **Escort Drones** ×1.35 (0.73), **Shock Field** ×1.4 (0.70), **Rocket Pods** ×1.25 (0.80). Apply these as per-weapon `CARD_STEP_TRIM`/`LV1_TRIM`-style multipliers off the shared curve, as was done for Autocannon in v0.36.1. Expected: each focus build reaches ~3:40+ (random's level) instead of 2:38–3:21.
3. **Autocannon:** keep the 0.8 card trim. Revisit only after the slot weapons catch up. If needed then, trim Phase Piercer (still the best stat card) rather than base damage.
4. **Tesla Arc, Proximity Mines** read 1.60 / 1.43 (over-performing) but are only 2–4% of damage. Leave them. Check why Tesla Arc's chase DPS stops growing past Damage rank 6.
5. **Aegis Blades (October rec still open):** a mechanic change, not a number. For example, blades orbit at the kite distance (~120–160 px) or sweep toward the nearest enemy. Re-test bar: ≥8% of damage in `weapon:orbitals` and index ≥0.8.
6. **Breakthroughs:** no change needed. Transform and boost are close to even. Look at Turret (transform +1.2 min) and Acid/Cryo (boost +1 min) once there's player data.
7. **Volatile Shatter:** smooth the LV 4 → 5 proc jump (chase DPS 273 → 1,395) by moving some proc chance from LV 5 to LV 3–4.

## Reproduce

```bash
npm run balance -- --runs 12 --weapon-focus --no-bench --max-minutes 20 --json out.json   # main 300-run set (~18 min, 4 cores)
npm run balance -- --bench-only                                                           # card bench (~6 min)
npm run balance -- --runs 6 --strategies projectile,explosive,random,weapon:blaster,weapon:missiles,start:rockets --meta 99 --no-bench --max-minutes 40
npm run balance -- --runs 6 --strategies projectile,explosive,random,weapon:blaster,weapon:missiles,start:rockets --skill expert --no-bench --max-minutes 30
npm run balance -- --runs 12 --no-bench --max-minutes 20 --strategies random,start:blaster,weapon:blaster,weapon:acidspray,explosive --tune damageRampBase=0.35
```

Known limits: one bot pilot. It kites and auto-aims at the nearest enemy, so it undervalues aimed weapons (Rocket Pods) and trail/positioning weapons (Gas Trail), and overvalues "always on" ones. It never leads packs through hazards on purpose. Breakthrough picks are coin flips. `--meta 3` also gives 3 starting Supernovas (Supernova Reserve rank 3), which flatters rank-3 numbers. Bench targets are all wave 6, and slot weapons are benched at LV 1 only, because their levels come from stat cards.

---

Earlier design notes (DPS normalization, loadout/leveling, the Shatter passive and turret/missile retunes, the v0.15 Armory table) were in the October report. They are in git history (`git show 5b4da93:docs/BALANCE_REPORT.md`). The rules they describe now live in `js/weapon-scaling.js`, `js/loadout.js` and `js/progression.js`.
