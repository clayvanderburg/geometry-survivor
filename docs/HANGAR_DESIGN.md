# VEXOLITH // SURVIVOR — Hangar, Weapon Unlocks & Mastery (design)

**Status: DRAFT for Clay's approval. Nothing here is built yet.** Owner: the Hangar & Progression lane (see
[ROADMAP.md](ROADMAP.md)). Once Clay signs off, the decisions go into the ROADMAP Decisions table and the PRs in
§7 start in order. Numbers below are starting points for the Balance lane, not tuned values.

Related: [GAME_DESIGN_BACKLOG.md §8](GAME_DESIGN_BACKLOG.md) (progression tracks), the 50-wave campaign
(PR #119) and the victory screen (ROADMAP priority 4).

---

## 0. What exists today (the parts this design builds on)

| System | Where | What it does now |
|---|---|---|
| The ship | `js/ship-renderer.js` (`drawCrabShip`, `shipHull`) | One ship: the crab with drill claws. Shield (`BASE_SHIELD` 75) hugs a convex hull built from the silhouette. `js/ship-preview.js` draws it big in the pause menu. |
| Run-start stats | `js/upgrades.js` `runStartPlayer(bonuses)` | Builds the player from `TUNING` + a flat `bonuses` object (Void Armory). Every ship stat already flows through this one function. |
| Starting weapon | `js/loadout.js` `START_WEAPON_CHOICES`, `main.js` `openStartPick` | After LAUNCH, pick 1 of Autocannon / Rocket Pods / Swarm Missiles (remembered per device). |
| Loadout | `js/loadout.js` `WEAPONS` (15 slot weapons), `PASSIVES` (Volatile Shatter) | 6 slots (`TUNING.weaponSlots`). NEW WEAPON cards offer 3 of the unowned weapons. Discard frees a slot. |
| Slot rewards | `js/slot-rewards.js` | Filling slots pays: 1 weapon = **2-card hands**, 2–3 = 3 cards, 4+ = 4 cards, +5% dmg at slots 3 and 5, a free LV 6 Breakthrough at slot 6. **This punishes single-weapon play hard, which matters for mastery (§4).** |
| Meta currency | `js/progression.js` | **Void Cores** buy 20 Void Armory stat ranks (`META_UPGRADES`, ~68k cores to max). Save: `localStorage` `vectra_survivor_save_v2`, normalized by `normalizeSave()` (callsign, cores, ranks, `totalRuns`, Field Guide `seen`/`fresh`, local highscores per mode). |
| Modes | `js/modes.js` | NORMAL / HARDCORE (no shield regen, cards or repairs) / BLITZ (compressed). DOM-free so the leaderboard server bundles it. |
| Leaderboard | `js/leaderboard.js`, `netlify/functions/scores.mjs` | Run payload `{ name, score, wave, level, kills, multiplier, time, version, mode }`; boards per mode × version. |
| Run stats | `js/run-stats.js` | Already sees every kill, damage source, pick and the final loadout; the summary goes to the anonymous balance data. |
| "Unlock" pattern | Field Guide (`guide.seen` / `guide.fresh` + "FIELD GUIDE UPDATED" toast) | The model to copy for feats: sanitized id lists in the save, a NEW badge, a non-blocking toast. |
| Tainted runs | `main.js` `runTainted`, Weapon Range | Sandbox/tuner runs and the Weapon Range are never recorded. Same rule applies to feats. |

---

## 1. Goals & pillars

1. **Variety of playstyles, not a power ladder.** Each ship asks you to play differently (tank, glass cannon,
   miner, deployable commander, gambler). Ships are *sidegrades*: on the balance sim each lands within about
   ±10% of the default crab's median wave. The Void Armory stays the only "always stronger" track.
2. **Frequent early unlocks.** A new player unlocks something in each of their first ~5 runs (a ship, a
   weapon, or a mastery star). The first ship should land in run 1–3.
3. **Transformative late unlocks.** Late rewards change *how* you play (an extra slot, a one-slot specialist,
   a ship built for HARDCORE), not +2% of something.
4. **No grind for grind's sake.** Every feat is either something you'd do anyway on the way to a goal, or a
   challenge that teaches a mechanic. No "kill 1,000,000". Lifetime counters top out around 10–15 hours of play.
5. **No second permanent currency.** Unlocks come from feats; Void Cores keep their one job (the Armory).
6. **Readable at a glance.** Locked ships show as dark silhouettes with the feat and a progress bar, so the
   Hangar itself tells you what to try next.

---

## 2. Ship roster (12)

All ships are members of the same drill-crab family (arthropod silhouettes, neon outlines), so they read as
"VEXOLITH ships" and reuse the renderer. **Hitbox rule:** every ship's hull fits the default crab's collision
radius ±10%; silhouettes differ, fairness doesn't. Stats are expressed as the same `bonuses` keys
`runStartPlayer` already reads (plus a few new ones in brackets), so most ships are pure data.

| # | Ship | Silhouette idea | Stat profile | Starting kit / quirk | Unlock feat | Tier |
|---|---|---|---|---|---|---|
| 1 | **VEXOLITH** (default crab) | Today's crab, twin drill claws | Baseline | Pick Autocannon / Rocket Pods / Swarm Missiles (plus any weapon you've **mastered**, §4) | Owned | — |
| 2 | **MANTIS** | Narrow body, two long scythe claws held forward | −25 shield, +8% speed, +6 pts crit chance, +25% crit damage | Autocannon. **Quirk:** a crit kill refunds 0.15 s of dash cooldown | Destroy **1,500** enemies (lifetime) | Early |
| 3 | **PROSPECTOR** | Squat body, oversized drill claws, ore hopper on the back | −10% damage, +50% mining speed, +30% drill reach, +25% gold | Proximity Mines. **Quirk:** rocks you break have +50% gold-vein chance | Mine **400** rocks (lifetime) | Early |
| 4 | **WASP** | Thin, swept wings, stinger tail | −20 shield, +15% speed, −30% dash cooldown, +20% dash distance | Rocket Pods. **Quirk:** dashing leaves a short afterburn streak that burns (FIRE) | Clear **wave 10** in BLITZ | Early |
| 5 | **HERMIT** | Round shell dome, claws tucked under | +50 shield, −12% speed, [+50% shield regen] | Electric Shield Field. **Quirk:** the first time the shield would break each run, it holds at 1 for 1.5 s (also in HARDCORE) | Take **5,000** shield damage (lifetime) | Early |
| 6 | **PYRE** | Claws end in nozzles, ember vents along the carapace | [+40% status duration], −10% shield | Flamethrower. **Quirk:** enemies that die burning spread FIRE to one neighbour | Set **1,000** enemies on FIRE, FROST or CORRODE (lifetime) | Mid |
| 7 | **GAMBLER** ("MAGPIE") | Hex-plated back like dice faces, glinting | −15 shield, +30% luck, +60 starting gold, −40% reroll cost | Your last starting weapon. **Quirk:** level-up hands always show at least 3 cards | Spend **3,000** gold on rerolls/locks (lifetime) | Mid |
| 8 | **BROOD** | Wide carapace with launch-bay hatches | −15% damage from PRIMARY weapons, [+1 count on deployables] | **Escort Drones + Sentry Turret** (2 slots used, 5 slots total). Can't master (two weapons) | Defeat **10 bosses** (lifetime) | Mid |
| 9 | **LANCER** | Lopsided: one giant claw, one stub | **3 weapon slots**; every weapon card gives +1 extra rank | Your mastered weapon of choice. Hands use the 4-card size from slot 1 (overrides slot rewards) | Earn your **first Mastery I** (§4) | Mid |
| 10 | **REVENANT** | Skeletal outline, cracked glowing seams | No shield regen, cards or repairs in **every** mode; +40% damage | Autocannon. **Quirk:** each boss killed gives +8% damage for the rest of the run | Clear **wave 25** in HARDCORE | Late |
| 11 | **LEVIATHAN** | Long segmented tail trailing the hull (like Ouroboros) | +20% pickup radius, +10% XP | Corrosive Gas Trail. **Quirk:** the tail is a hitbox-free blade that damages what it sweeps | Reach **wave 75** in Endless | Late |
| 12 | **SOVEREIGN** | Crowned crab, prism-faceted shell | Baseline stats, **7 weapon slots** | Pick any unlocked weapon. **Quirk:** Breakthroughs offer the transform *and* Across the Board as one combined pick at LV 18 | **Clear the campaign** (beat the wave-50 boss) in any mode | Late |

Notes:
- **Starting weapon per ship.** Ships with a fixed kit skip the start-weapon pick. VEXOLITH, GAMBLER (last
  pick), LANCER and SOVEREIGN show the pick, filtered to unlocked weapons.
- **Stats in brackets are new `bonuses` keys** (shield regen, status duration, deployable count, slots,
  hand-size override). Everything else already exists in `armoryBonuses`. Ship bonuses *add to* Armory
  bonuses (multipliers multiply), so the Armory stays worth buying on every ship.
- **HARDCORE:** the Aegis Shield Matrix rule still applies (ship shield deltas do too). HERMIT's regen bonus
  is moot there, which is fine; REVENANT is built for it.
- Unlock pacing: ships 2–5 typically land in the first 2–4 hours, 6–9 by ~10 hours, 10–12 are goals.

---

## 3. Weapon unlocks

### 3.1 Existing weapons
**Unlocked from the start (9):** Autocannon, Rocket Pods, Swarm Micro-Missiles, Tesla Arc, Orbit Blades,
Proximity Mines, Sentry Turret, Escort Drones, Plasma Grenades. Volatile Shatter (passive) stays unlocked.

**Locked (6):** the later, more specialized weapons, so the first runs have a smaller, clearer pool.

| Weapon | Unlock | Why this feat |
|---|---|---|
| Flamethrower | Clear **wave 10** (any mode) | The first campaign milestone; arrives early. |
| Cryo Sprayer | **FREEZE** 200 enemies (lifetime; FROST grenades work) | Teaches element infusions. |
| Acid Sprayer | **Mastery I** of Flamethrower | The sprayer family, earned by mastering its sibling. |
| Corrosive Gas Trail | **Dash** 750 times (lifetime) | Gas is a dash weapon; you'll get this naturally. |
| Vortex Singularity | Defeat **5 bosses** (lifetime) *or* Mastery I of Swarm Missiles | Two paths; whichever comes first. |
| Electric Shield Field | **Mastery I** of Tesla Arc | Same element, earned by mastery. |

Locked weapons never appear in NEW WEAPON picks, caches or the start pick. If a pick would show fewer than 3
weapons because of locks, it shows fewer (the existing "too few left" rule).

### 3.2 New weapon concepts (6; built by the Weapons lane, one PR each)

| Weapon | Category / tags | Concept | Unlock |
|---|---|---|---|
| **Rail Lance** | PRIMARY · KINETIC | Charges for ~0.8 s, then fires a hair-thin line that pierces everything to the screen edge (rocks too). Slow, huge hits. | Mastery I of Autocannon |
| **Claw Harpoon** | PRIMARY · KINETIC | Fires one drill claw on a tether: pierces, mines any rock it passes, yanks small enemies back into your other claw. | Mine **150 rocks in one run** |
| **Glaive Discs** | AUTONOMOUS · KINETIC | Spinning discs that ricochet between enemies and off rocks, losing a little speed per bounce. | Mastery I of Orbit Blades |
| **Quake Mortar** | AUTONOMOUS · EXPLOSIVE AREA | Lobs heavy shells that land as expanding shockwave rings; rings knock back and crack rocks. | Mastery I of Rocket Pods |
| **Nanite Swarm** | DEPLOYABLE | A cloud of nanites that drifts to the densest pack and eats it; the cloud grows a little with each kill, then disperses. | Mastery I of Escort Drones |
| **Prism Beam** | AUTONOMOUS · ELECTRIC | A sweeping laser that splits into 3 when it passes through a shield crystal or a frozen enemy. The campaign's trophy weapon. | **Clear the campaign** |

Every new weapon follows the existing rules: LV 1 at the standard potential DPS, 4–5 stat cards, 3
Breakthrough milestones, Field Guide entry, clips via `npm run weapon-media`.

### 3.3 Mastery links for the rest
Every weapon's Mastery I unlocks *something* (§4). Weapons without a "next of kin" above instead add a
**start-pick option** for VEXOLITH (they become selectable as a starting weapon). Every Mastery I does that
anyway, so mastering always widens your opening choices.

---

## 4. Weapon mastery

### 4.1 What counts as a "single weapon" (solo) run
- Your loadout holds **exactly one slot weapon for the whole run**. Taking a second slot weapon at any point
  ends solo for that run, even if you discard it later.
- **Allowed:** passives (Volatile Shatter), Supernova bombs, evolutions, status/element cards, ship quirks
  (WASP's afterburn, LEVIATHAN's tail), Breakthroughs.
- Ships with a two-weapon kit (BROOD) can't earn mastery. LANCER and SOVEREIGN can (if you stay at one weapon).
- Feats and mastery never count in tainted runs, the Weapon Range, or abandoned runs.

### 4.2 The SOLO toggle (recommended)
Solo play currently fights two systems: NEW WEAPON cards keep clogging hands, and slot rewards drop you to
**2-card hands**. So the start pick gets a **SOLO // MASTERY ATTEMPT** toggle:
- NEW WEAPON cards are removed from hands and caches (replaced by normal draws).
- Hands use **3 cards** (as if 2 slots were filled). No slot damage bonus, no slot-6 Breakthrough.
- A HUD chip shows `SOLO ✦ AUTOCANNON` and the next mastery target ("CLEAR WAVE 10").
Without the toggle, solo is still detected automatically (you just get the normal 2-card hands).

### 4.3 Tiers and rewards
Progress is per weapon, any mode. "Clear wave N" = that wave's boss is defeated (every 5th wave has one).

| Tier | Requirement (solo) | Reward |
|---|---|---|
| ★ **I — PROVEN** | Clear **wave 10** (2 bosses) | Unlocks the weapon's kin weapon/ship (§3); the weapon joins the VEXOLITH start pick; bronze star on its cards. First Mastery I unlocks LANCER. |
| ★★ **II — VETERAN** | Clear **wave 25** | **+8% damage** with that weapon in every future run (any loadout); silver star. |
| ★★★ **III — MASTER** | Clear **wave 50** (the campaign) | Another **+8%** (16% total); a gold mastery tint on its shots (cosmetic); gold star on the leaderboard row when it's your solo weapon. |
| ✦ **GRANDMASTER** (optional, cosmetic) | Reach **wave 75 in Endless** solo | Title on the Hangar and a prismatic tint. No power. |

Mastering 5 / 10 / all weapons is tracked as Hangar badges only (no extra power). The +8% steps go through
one multiplier hook in `weapon-scaling.js`, so the weapon balance test can assert them; Balance lane signs
off on the size.

---

## 5. Feat system

### 5.1 Data shape (`js/feats.js`, pure, DOM-free)
```js
// kind 'career': a lifetime counter reaches `goal`.  kind 'run': a predicate over a finished (or live) run.
export const FEATS = [
  { id: 'kills_1500',   kind: 'career', counter: 'kills', goal: 1500,
    name: 'EXTERMINATOR', text: 'Destroy 1,500 enemies', reward: { ship: 'mantis' } },
  { id: 'blitz_w10',    kind: 'run', test: (r) => r.mode === 'blitz' && r.waveCleared >= 10,
    name: 'BLITZKRIEG', text: 'Clear wave 10 in BLITZ', reward: { ship: 'wasp' } },
  { id: 'campaign',     kind: 'run', test: (r) => r.campaignCleared,
    name: 'VEXOLITH ASCENDANT', text: 'Clear the campaign', reward: { ship: 'sovereign', weapon: 'prism' } },
  { id: 'mastery_any',  kind: 'mastery', tier: 1,
    name: 'PROVEN', text: 'Master any weapon (★)', reward: { ship: 'lancer' } },
  // hidden: true → the Hangar shows "???" until it's done
];
```
- **Rewards:** `{ ship }`, `{ weapon }`, or `{ badge }` (badge-only feats are a small set of challenges, e.g.
  "Clear wave 25 without picking up a shield crystal", "Clear wave 10 using only your drill and bombs", "No
  shield regen for 5 straight waves in NORMAL"). Every reward appears in exactly one place in the table.
- **Career counters** (`save.career`): `kills, bossKills, rocksMined, dashes, shieldDamageTaken,
  statusApplied, frozen, goldSpent, runs, bestWave {mode}, bestEndlessWave`. All small integers.
- **Run facts** (built by a `FeatLedger` per run): `mode, ship, waveCleared, campaignCleared, endlessWave,
  soloWeapon | null, rocksThisRun, shieldRegenUsedByWave, crystalsTaken, tainted`. Most come straight from
  data the game already has (`runStats`, `rocksMined`, `wave`); the ledger only adds the few live facts.

### 5.2 Where progress is tracked
- One small module, `FeatLedger` (`js/feats.js`), holds the run facts and the in-memory career deltas. The
  game calls it from a handful of existing spots (kill, boss kill, rock mined, dash, shield hit, status
  applied, wave cleared, run end): **one line each in `main.js`**.
- Feat checks run only when a relevant counter or fact changes (cheap: each feat lists its counter).
- Career deltas are **saved at each wave clear and at run end**, so a closed tab loses at most one wave.
  Abandoned runs keep their career counters (like Void Cores already looted), but run feats need the run to
  end (death, victory or banking the score).

### 5.3 UI
- **Title screen: HANGAR button** (next to VOID ARMORY) with a NEW badge while anything unseen is unlocked.
- **Hangar screen** (`js/hangar-ui.js`): a grid of 12 ship cards. Unlocked: the ship drawn live (reusing
  `ship-preview.js`), stats as +/− chips vs. VEXOLITH, kit and quirk text, SELECT. Locked: a **dark
  silhouette** (same renderer, filled black with a faint outline), the feat text and a **progress bar**
  ("1,240 / 1,500 ENEMIES"); hidden feats show "???" and one cryptic hint. Tabs: **SHIPS · ARSENAL ·
  FEATS**. ARSENAL lists every weapon with lock state, unlock feat and mastery stars. FEATS lists all feats
  with progress. Keyboard, touch and controller navigation like the Armory.
- **Launch flow:** LAUNCH → (ship has a pick? start-weapon pick with the SOLO toggle) → run. The selected
  ship is remembered per device, like the mode and start weapon.
- **Unlock toasts:** reuse the Field Guide toast pattern: a compact top-centre banner, 3 s, queued, never
  over the level-up modal or a boss intro (`FEAT // EXTERMINATOR — MANTIS JOINS THE HANGAR`).
- **Game-over & victory screens:** a "NEW IN THE HANGAR" strip listing this run's unlocks, plus the closest
  unfinished feat ("230 rocks to PROSPECTOR") as a nudge.

---

## 6. Save data, leaderboard, balance & tutorial

### 6.1 Save data (`normalizeSave` in `js/progression.js`)
New fields, each normalized like `guide` (sanitized ids, unknown-but-well-formed ids kept for newer builds,
size caps):
```js
hangar:  { ship: 'vexolith', ships: ['vexolith', ...], fresh: [...] },
arsenal: { weapons: [...unlocked ids], fresh: [...] },
feats:   { done: { [featId]: 'YYYY-MM-DD' }, fresh: [...] },
career:  { kills: 0, bossKills: 0, rocksMined: 0, ... },
mastery: { [weaponId]: 0..4 }
```
- No `SAVE_KEY` change and no `ARMORY_VERSION` bump: cores and Armory ranks are untouched.
- **Existing players** (save with `totalRuns > 0` when this ships): see open question 1. Recommended: grant
  the six currently-unlocked-for-everyone weapons (so nobody loses a weapon they had), but every ship still
  needs its feat. Career counters start at 0 (we have no history), so seed `bestWave` from local highscores
  and `runs` from `totalRuns`.
- The selected ship is in the save (`hangar.ship`), so it syncs across tabs through the existing `storage`
  listener.

### 6.2 Leaderboard
- **Record the ship: yes.** Add an optional `ship` field to the run payload (`buildRunPayload`) and to local
  highscores; the server accepts only known ship ids (a DOM-free `js/ships.js` it bundles like `modes.js`;
  missing = `vexolith`, so old clients still work). Rows show a small ship glyph; a `solo` field shows the
  mastery star for solo runs.
- **Boards stay per mode × version** (no per-ship boards: it would split a small player base 12 ways). A
  ship *filter* on the board can come later if players ask.
- Ships never touch the score formula, so the server's plausibility checks don't change.
- Run stats (anonymous balance data) carry `ship`, `solo` and mastery tiers so the Balance lane can compare
  ships.

### 6.3 Balance
- Ship numbers live in `js/ships.js` as data; `tools/balance-sim.mjs` gets `--ship <id>` (and `--solo`) so
  every ship and mastery bonus is simmed before it merges. Target: each ship's median wave within ±10% of
  VEXOLITH for the same pilot profile.
- Weapon locks shrink the early NEW WEAPON pool from 15 to 9: the Balance lane should check NEW WEAPON
  odds/pity still feel right.
- Mastery bonuses (+8% / +16%) stack with the Armory; small next to a Breakthrough (×1.22).
- **Balance hold** (ROADMAP rule 4): ship *numbers* wait for the new balance report; the plumbing doesn't.

### 6.4 Tutorial & docs
- No new slide. The YOU'RE READY slide gains one short line: *"Unlock new ships and weapons in the HANGAR."*
  (in the PR that adds the Hangar button), and the start-pick clip is re-captured if it changes.
- Field Guide: new weapons need entries/clips per `CLAUDE.md`; ships don't (the Hangar is their guide).
- README: a *Hangar & feats* section in the PR that adds the Hangar screen.

---

## 7. Implementation plan (small, independently mergeable PRs, in order)

Each PR runs `npm test`, adds tests, and keeps `main.js` to a few wiring lines. Gameplay PRs bump the version
at merge time.

| # | PR | Files | Gameplay? |
|---|---|---|---|
| 1 | **Save schema + career counters.** New save fields (empty), `normalizeSave` support, migration for existing saves (seed `runs`/`bestWave`). | `js/progression.js`, `tests/progression*.test.js` | No |
| 2 | **Feat engine.** `FEATS` table (rewards point at ids that don't exist yet → inert), `FeatLedger`, career counting from the game's existing events. No UI except a console-free debug read in the tuner. | new `js/feats.js`, `main.js` (≈8 one-line hooks), tests | No |
| 3 | **Unlock toasts + game-over strip.** | new `js/feat-toast.js`, `css/`, `main.js` (2 lines), `index.html` | No (UI) |
| 4 | **Ships core.** `js/ships.js` (DOM-free data + `shipBonuses()`, `shipStartKit()`), merged into `resetRun` bonuses; VEXOLITH only, so zero behaviour change; balance-sim `--ship`. | new `js/ships.js`, `js/upgrades.js` (new bonus keys), `main.js` (≈3 lines), `tools/balance-sim.mjs`, tests | No (no new ship yet) |
| 5 | **Hangar screen (SHIPS tab) + per-ship start flow.** Title HANGAR button, select/remember ship, locked silhouettes with progress. Tutorial line + README. | new `js/hangar-ui.js`, `css/`, `index.html`, `main.js` (title button + launch flow), `js/tutorial.js` | UI |
| 6 | **Ship silhouettes.** `drawShip(ctx, p, …)` dispatching on `p.shipId`, per-ship hull for the shield; previews. | `js/ship-renderer.js`, `js/ship-preview.js` | Visual |
| 7 | **First 3 ships: MANTIS, PROSPECTOR, HERMIT** (pure stat ships + one quirk each). | `js/ships.js`, new `js/ship-quirks.js`, tests | **Yes** (minor bump) |
| 8 | **Weapon locks + ARSENAL tab.** `WEAPON_UNLOCKS`; `unownedWeapons` and the start pick filter by unlocked; existing-save grant. | new `js/weapon-unlocks.js`, `js/loadout.js`, `js/hangar-ui.js`, tests | **Yes** |
| 9 | **Mastery.** Solo detection in the ledger, tiers, SOLO toggle (no NEW WEAPON cards, 3-card hands), stars, +8% hook. | new `js/mastery.js`, `js/upgrades.js` (hand filter), `js/slot-rewards.js` (override), `js/weapon-scaling.js` (one multiplier, Weapons lane OK), start-pick UI | **Yes** |
| 10 | **Ships 4–8** (WASP, PYRE, GAMBLER, BROOD, LANCER), in 1–2 PRs. | `js/ships.js`, `js/ship-quirks.js`, `js/ship-renderer.js` | **Yes** |
| 11 | **Leaderboard ship + solo fields.** Payload, server validation, row glyph, local highscores, run stats. | `js/leaderboard.js`, `netlify/functions/scores.mjs`, `js/progression.js`, `js/run-stats.js`, tests | Data |
| 12 | **Campaign/endless feats live** (after PR #119 and the victory screen): REVENANT, LEVIATHAN, SOVEREIGN, Mastery III / Grandmaster. | `js/feats.js`, `js/ships.js`, `js/ship-quirks.js` | **Yes** |
| 13+ | **New weapons**, one PR each, by the Weapons lane (Rail Lance, Claw Harpoon, Glaive Discs, Quake Mortar, Nanite Swarm, Prism Beam), each with Field Guide entry and clips. | `js/loadout.js`, weapon modules, `js/weapon-scaling.js`, `js/weapon-levels.js`, assets | **Yes** |

PRs 1–6 can merge while the balance hold is on (no tuning); 7+ wait for the balance report and Clay.

---

## 8. Open questions for Clay

1. **Existing players and locked weapons:** grant the six newly-locked weapons to saves that already have
   runs (recommended), or lock them for everyone so veterans get the unlock moments too?
2. **Ship price:** feat only (recommended, no Void Core competition with the Armory), or feat + a Void Core
   price like Vampire Survivors' gold?
3. **SOLO toggle:** OK to give solo mastery attempts 3-card hands and remove NEW WEAPON cards? Or keep solo
   implicit and accept the 2-card hands as the challenge?
4. **Mastery rewards:** happy with +8% / +16% damage, or prefer non-numeric rewards (start at LV 2, cosmetic
   only) to keep the leaderboard flatter?
5. **Which modes count?** Recommended: all three for mastery and feats, with BLITZ-specific feats where
   BLITZ's shorter waves make a wave count trivial. Does BLITZ have the 50-wave campaign/victory screen too?
6. **Leaderboard:** ship glyph on rows only (recommended), or per-ship filters/boards?
7. **Roster flavour:** keep every ship in the drill-crab family, or allow a couple of non-crabs? Any names
   you'd like to change?
8. **Secret feats:** a few hidden "???" ships/feats for discovery, or everything visible?
9. **Sovereign's 7th slot and Lancer's 3 slots:** happy to bend the 6-slot rule for these two ships?
