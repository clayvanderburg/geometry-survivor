# VEXOLITH // SURVIVOR — Sectors & portal travel (design)

**Status: DRAFT for a discussion with Clay. Nothing here is built.** Written by a game-designer session for the
Director. Once Clay decides, the answers go into the ROADMAP Decisions table and the PRs in §6 start in order.
Numbers are starting points for the Balance lane, not tuned values.

Related: [GAME_DESIGN_BACKLOG.md](GAME_DESIGN_BACKLOG.md) §7 (wormholes) and §9 (sectors, endless, scoring),
[HANGAR_DESIGN.md](HANGAR_DESIGN.md) (feats), [ROADMAP.md](ROADMAP.md) (50-wave campaign, difficulty targets,
*To check*: scoring and the wave-50 ending).

---

## 0. What exists today

| System | Where | Today |
|---|---|---|
| Campaign | `js/wave-plan.js` | 50 waves (22 s each in NORMAL). A boss every 5th wave: minors on 5/15/25/35/45, majors on 10/20/30/40/50. New enemies debut only with a boss. |
| Victory / Endless | `js/victory.js` | Killing the wave-50 Prism opens VICTORY: *Continue for high score* (Endless, bosses in pairs) or *End run*. |
| The map | `js/asteroids.js` `generateSector`, `main.js` | One ~4200×4200 "sector", built once per run: rock clusters, ore, gold veins, bedrock wall + ~5 bedrock clumps. Mined-out rock replenishes each wave. The tuner can already regenerate it mid-run. |
| Rifts | `js/rifts.js` | A magenta tear opens near the ship now and then; fly in and you're flung to the far side of the *same* map, invulnerable for the jump. |
| Boss arrival | `js/boss-warp.js` | Bosses step out of a portal that blasts the rock around it. |
| Music | `js/audio.js` `SOUNDTRACK` | Menu track, 4 run tracks played in intensity order (Geom Harvest → Asteroid Fields → Neon Wake → Singularity), one boss theme. |
| Modes | `js/modes.js` | NORMAL / HARDCORE / BLITZ (14 s waves). |
| Score & boards | `main.js`, `js/leaderboard*.js` | Score = kill value × a multiplier that drops 25% per hit. Boards per mode × version. Known issue: a W59 win can score less than a W33 death. |

So the hard parts already exist in some form: regenerating terrain, a ship-swallowing portal effect, safe
exits, a boss every 10 waves to end a chapter, and a playlist ordered by intensity.

---

## 1. Pillars

1. **One run, one build.** Sectors are chapters of the 50-wave run, not separate levels. The build you made
   is the point of a survivor game; we don't take it away at a door.
2. **A new place in three seconds.** Each sector is recognisable at a glance: palette, terrain shape, music,
   featured enemies, one signature hazard.
3. **The portal is a choice.** Go now (safe, keep the pace) or stay a while (more score, rising danger).
4. **Reuse before we build.** Terrain knobs, rift visuals, existing enemies, bosses and tracks first. New art,
   hazards and music are additive later PRs.
5. **Fair, comparable runs.** Everyone on a board flew the same route; the leaderboard shows how far you got.
6. **Transitions are short and safe.** Under ~3 s, invulnerable, safe exit, no level-up screen lost.

---

## 2. Structures (pick one)

### A. Five chapters (linear, 5 sectors × 10 waves) — **recommended**
Waves 1–10 are Sector 1, 11–20 Sector 2, … 41–50 Sector 5. Each sector ends with the major boss that already
sits on waves 10/20/30/40/50. Killing it opens a **portal**; flying in takes you to the next sector (new map,
palette, music, enemy mix). Wave 50's portal is the existing VICTORY choice.

- ✅ Fits the boss schedule exactly; no change to wave count, difficulty curve or Armory tiers.
- ✅ The build is untouched, so balance work is small (only the transition and Overtime).
- ✅ Every run feels like a journey; "reached Sector 4" is an easy story to tell and a natural feat.
- ❌ Fixed order: Sector 5 always looks the same. Replay value comes from builds, not routes.
- ❌ "Unlockable sectors" mean less here (you see them by getting there); see §2 note.

### B. Branching route (FTL / Slay the Spire map)
After each major boss, **two portals** to two sector flavours of the same tier (e.g. *Crimson Deep* vs *Ion
Lattice*). Feats unlock extra flavours.

- ✅ Real route choice and replayability; unlocks have a clear payoff (a new branch).
- ❌ Roughly 2× the sector content; each pair must be balanced against the other.
- ❌ Leaderboard fairness gets harder (easy vs hard route); needs a difficulty tag per branch.

### C. Separate stages (Deep Rock Galactic: Survivor style)
Pick a sector from a map; each is its own 10-wave run with a fresh build (or a starting kit).

- ✅ Short sessions, clean per-sector boards, obvious unlocks.
- ❌ Breaks the 50-wave decision and the "one big build" fantasy; Armory tiers would need re-sizing.
- ❌ Most code churn (run start, scoring, victory, save).

**Recommendation: A now, built so B can come later.** Sector data is a table keyed by *tier* (1–5); B is
then "a tier holds more than one sector and the portal offers two". Unlocks in A: reaching a sector adds it to
a **Sector Atlas** (Field Guide-style, a NEW badge) and feats unlock **variant palettes / hazards** and,
later, B's alternate branches.

---

## 3. Rules for structure A

### 3.1 The portal: advance or stay
- The major boss dies → its payoff plays → a **gold-white portal** opens near where it fell (distinct from the
  magenta in-sector rifts). The radar and an edge arrow point at it. Remaining enemies stay.
- **Advance:** fly in. Transit reuses the rift's swallow / spit-out animation, a bass hit and a music cut.
  Invulnerable the whole way plus ~1.5 s after.
- **Stay (Overtime):** the portal stays open. The next wave does not start; instead **Overtime** runs: spawns
  ramp up every 15 s, kills score **×1.5 → ×3**, but **no XP and no Void Cores** drop (stops build farming).
  After ~90 s the portal starts to **collapse** (30 s warning, it shrinks); if it closes you are forced through
  at the next wave boundary. So staying is pure score greed, capped in time.
- Wave 50: the existing VICTORY screen *is* the final portal (End run / Continue into Endless). Its
  *Final Stand* proposal (ROADMAP *To check*) fits here: clear the field → SECTOR CLEAR → VICTORY.

### 3.2 What carries over
| Kept | Reset | Partial |
|---|---|---|
| Weapons, levels, Breakthroughs, passives, stats, ship level, gold, score, multiplier, Void Cores earned | Terrain, rocks, veins, enemies on the field, Vortexes, enemy bullets, deployables (mines, turrets) | **Shield:** refill 50% in NORMAL/BLITZ, nothing in HARDCORE (it has no repairs). Drones and orbiters follow the ship. |

Keeping everything is the recommendation: the difficulty curve and Armory tiers (0 / mid / full) are sized
against an unbroken run, and a reset would be a feel-bad tax right after a boss win. If playtests show the
portal is too generous, drop the shield refill before touching the build.

### 3.3 Sector identity (one table entry each)
`{ id, tier, name, waves, palette (grid, bedrock, background hues), terrain (TUNING overlay: rock density,
cluster size, bedrock formations, ore mix, rift interval), featured enemies (pack-weight bias on top of
wave-plan themes), hazard, track }`. The terrain overlay uses the same mechanism as modes
(`applyTuningOverlay`), so a sector is mostly data.

### 3.4 Endless
After VICTORY → *Continue*, Endless **loops the five sectors** with a remixed palette ("Sector 1′ — Loop 2"),
a portal after every 10 waves, Overtime as above. Content is reused and every loop still feels like travel.

### 3.5 Modes
NORMAL and HARDCORE: as above. BLITZ: same five sectors (each ~2.5 min) but no Overtime; see open questions.

---

## 4. First sector roster

Enemies follow today's debut schedule (they accumulate); each sector *biases* toward its newcomers so it has a
face. Tracks reuse the four run tracks; Sector 5 needs a fifth.

| Tier | Waves | Sector | Palette | Terrain & hazard | Featured enemies | Bosses | Track |
|---|---|---|---|---|---|---|---|
| 1 | 1–10 | **GEOM SHALLOWS** | Cyan / teal | Open field, rich ore, few bedrock clumps. No hazard (the learning sector). | Swarmers, pinwheels, weavers, splitters, mayflies | Brood Queen, Ouroboros | Geom Harvest |
| 2 | 11–20 | **KESTREL BELT** | Amber / orange | Dense asteroid fields, long bedrock ridges (corridors). Hazard: **meteor drift** (slow rocks crossing the map, mineable). | Kestrels, blinkers, borers, serpents, bruisers | Wing Commander, Hive Carrier | Asteroid Fields |
| 3 | 21–30 | **HORIZON DEEP** | Violet / crimson | Sparse rock, more frequent rifts. Hazard: **gravity currents** (slow drifts toward Vortexes). | Vortexes, hulks, carriers, drones, gunners | Event Horizon, The Architect | Singularity |
| 4 | 31–40 | **LATTICE** | Green / gold | Bedrock laid in grid-like walls (rooms and doorways). Hazard: **energy gates** that pulse across doorways. | Gates, shielders, mitosis, conduits | Progenitor, The Conductor | Neon Wake |
| 5 | 41–50 | **PRISM CORE** | White with spectrum edges | Shattered crystal rock, little cover. Hazard: **prism beams** sweeping the arena (telegraphed). | Everything; lancers, repulsors | Eclipse Twins, The Prism | *New track needed* |

Each hazard is its own later PR; a sector ships first with only palette, terrain, mix and music.

---

## 5. Risks

- **Scope.** Five palettes, terrain presets, hazards and a track add up. Mitigation: sectors ship as data
  first; hazards are optional, one PR each; B (branching) waits until A is played.
- **Runaway power / farming.** Overtime could farm levels. Mitigation: no XP and no cores in Overtime, a
  collapse timer, steep spawn ramp. Shield refill is the only free gift.
- **Difficulty drift.** New terrain changes how hard a wave is (corridors in Sector 2 and rooms in Sector 4
  make kiting harder). The balance sim must run per sector; targets in ROADMAP (0-Armory dies W25–35) stay.
- **Flow break.** A transition every ~4 min could cut the momentum. Keep it under 3 s; carry queued level-ups
  through; music crossfades rather than stops.
- **Score & leaderboard.** Overtime adds score faster than plain play; the plausibility envelope (already
  flagged for re-check) must include it. Sector clear bonuses also fix today's "W59 win < W33 death".
- **Tech.** Swapping the map mid-run touches the spatial hash, replay, gold veins, deployables, Vortexes and
  the radar. Keep it in a new `js/sectors.js`; `main.js` gets a few wiring lines (ROADMAP rule 3).
- **Readability.** Palettes must keep enemy colours readable (pillar: threats pop). Each palette is checked
  against the Field Guide previews.
- **Tutorial / Field Guide.** Portals and Overtime need a slide line; new hazards need Field Guide entries.

---

## 6. PR plan (small, independently mergeable, in order)

| # | PR | Lane / files | Gameplay? |
|---|---|---|---|
| 1 | **Sector table.** `js/sectors.js` (DOM-free): `SECTORS`, `sectorForWave()`, tier keys; tests. Nothing reads it yet. | new module, tests | No |
| 2 | **Sector banner + HUD.** "SECTOR 2 // KESTREL BELT" banner on waves 11/21/…, radar label. Same map. | UI | No |
| 3 | **Palettes.** Grid, background and bedrock tint from the current sector, faded at the boundary. | `js/grid.js`, render, UI | Visual |
| 4 | **Music per sector.** Playlist picks the sector's track instead of intensity order. | `js/audio.js` | Audio |
| 5 | **Portal + transit.** Portal after major bosses on 10/20/30/40; transit regenerates the map with the sector's terrain overlay; clears field; shield refill; tutorial line. | `js/sectors.js`, new `js/sector-portal.js`, `js/asteroids.js`, `main.js` (few lines), `js/tutorial.js` | **Yes** (minor bump) |
| 6 | **Overtime.** Stay for score: spawn ramp, score multiplier, no XP/cores, collapse timer. | `js/sector-portal.js`, waves | **Yes** |
| 7 | **Sector scoring + leaderboard field.** Sector clear bonus; `sector` on the payload, row shows "S3 · W27"; plausibility envelope update. | `main.js`, `js/leaderboard*.js`, `netlify/functions/scores.mjs` | **Yes** |
| 8 | **Enemy mixes per sector.** Pack-weight bias. | Enemies & Bosses | **Yes** |
| 9 | **Hazards**, one PR each (meteor drift, gravity currents, energy gates, prism beams) + Field Guide. | new modules | **Yes** |
| 10 | **Endless loops** the sectors with remixed palettes. | `js/sectors.js`, `js/victory.js` | **Yes** |
| 11 | **Sector Atlas + feats** (after the Hangar feat engine): "Reach Sector 3 in HARDCORE", etc. | Hangar & Progression | No / Yes |
| 12 | *(Later, if wanted)* **Branching** (structure B): second sector per tier, two portals. | all of the above | **Yes** |

PRs 1–4 are cosmetic and can land while the difficulty work is in progress; 5+ wait for Clay and the balance
hold.

---

## 7. Open questions for Clay

1. **Structure:** linear 5 × 10 (recommended), or go straight for branching portals?
2. **Carry-over:** keep the whole build (recommended)? Shield refill on transit: 50%, full, or none?
3. **Stay for score:** Overtime at every portal with no XP and a collapse timer, or only at wave 50 (today's
   VICTORY choice)?
4. **Starting later:** once you've reached a sector, can you start a run there (unranked practice, or ranked
   with a catch-up kit)? Recommended: not in v1.
5. **Leaderboard:** one board per mode × version with a "sector reached" column (recommended), or per-sector
   boards?
6. **Music:** a fifth Suno track for Prism Core? A boss theme per sector, or keep one?
7. **BLITZ:** five short sectors, three sectors, or no sectors at all?
8. **Endless:** loop the five sectors (recommended) or one special endless sector ("The Fold")?
9. **Hazards:** happy with one signature hazard per sector, or keep sectors to looks + enemies only?
10. **Names and themes:** any sector names or palettes you'd change?
