# VEXOLITH // SURVIVOR — Roadmap & coordination

**Owner:** the Director session (works with Clay). **Read this before starting any work.** It says what we're
building next, which conversation owns which files, and how changes get merged without stepping on each other.
Ideas live in [GAME_DESIGN_BACKLOG.md](GAME_DESIGN_BACKLOG.md); this file holds decisions and priorities.

## Decisions (source of truth)

| Date | Decision |
|---|---|
| 2026-10-20 | **The campaign is 50 waves** with a boss every 5th wave (10 bosses). Beating wave 50 shows a **victory screen** offering *Continue for high score* (keep playing in Endless; the score keeps counting) or *End run* (finish the run here, as a win). |
| 2026-10-20 | **Hangar of specialist ships** (Vampire Survivors-style heroes): each ship has its own stat boosts and/or starting kit, unlocked by feats. |
| 2026-10-20 | **Weapon unlocks + weapon mastery** (Deep Rock Galactic: Survivor-style): more weapons, some locked behind unlocks; clearing a run/level with one weapon masters it, granting a bonus and unlocking another weapon. |
| 2026-10-20 | **Level-up cards show their scope**: utility cards and global cards get a subtle outline/indicator in the level-up window. |
| 2026-10-20 | Breakthroughs are our overclocks; no separate overclock system. |
| 2026-10-20 | Adaptive/layered music is **parked**: the soundtrack is Suno tracks, not stems. |
| 2026-10-20 | **Progression safety:** we may take things away before launch, but **Void Cores are the main progression and are always refunded** when an Armory upgrade is removed or reworked. Show an early-access warning so players don't over-invest. |
| 2026-10-20 | **Hangar / weapon locks / mastery are one big later update**, designed in full (its own discussion with Clay) before anything ships, so we don't take things away again after launch. `docs/HANGAR_DESIGN.md` is a draft. When weapons get locked, the first unlocks are easy. |
| 2026-10-20 | **Weapon balance target:** offensive weapons (Autocannon, Rocket Pods, Swarm Missiles, …) sit at about the same DPS. Close-range defensive weapons (Shock Field, Orbit Blades) may sit a bit lower: they are the last line of defense. Buff the others up to the Autocannon rather than nerfing it. |
| 2026-10-20 | **The balance sim under-rates Rocket Pods and Swarm Missiles** (Clay has long runs with them). Treat sim numbers as relative until the bot is calibrated against real play. |
| 2026-10-20 | **Geom Attractor Field maxes at 2x XP** (armory XP stacks on top) and half its old pickup radius (6x base, was 12x: most of the map). |
| 2026-10-20 | **Contact damage is not being lowered** (the report's recommendation is on hold): Clay can still charge through packs and may want it higher. The difficulty curve is decided after Clay playtests PR #119. |
| 2026-10-20 | **Tesla Arc is always SHOCK** ("it's friggin lightning"): stun arcs are its baseline, like the Flamethrower's FIRE. It has no element cards; its SHOCK rank follows its level (+1 at LV 6/12/18). |
| 2026-10-20 | **Class-based weapon balance** (replaces "all offensive weapons equal" for realized damage): per target at equal level vs the Autocannon (100%): automatic single-target (Drones, Turret) ~85%; area weapons 60–70% per target, about even in total against packs; close-range defensive (Shock Field, Orbit Blades) lower by design. Encoded as `WEAPON_CLASS` / `CLASS_TARGET`; area targets enforced once enemies-hit-per-blast is measured. |
| 2026-10-20 | **A full Void Armory is about 3× total power** vs 0 Armory (offense × defense, `armoryPower` in `js/progression.js`, pinned ±15% by `tests/armory.test.js`). v0.43.3: Plasma Overcharge +1.25%/rank (+50%, refunded), new **Last Stand Protocol** (one rank, 2,000 cores: once per run a broken shield returns at 25% with a free Supernova; not in HARDCORE). Rank 3 everywhere ≈ 1.3×, half ranks ≈ 1.65× (under 10% of the full cost), full ≈ 3.15×. The difficulty curve is sized against these tiers. |

## Priorities (in order)

Shipped 2026-10-20: **v0.43.0** (50-wave campaign + victory, rifts & bedrock, weapons pass, Attractor retune; #137), **v0.43.1** (Tesla Arc always SHOCK, class-based weapon balance, Drones/Turret buff; #138), **Void Core refunds + early-access note** (#133).

1. **Difficulty curve** (Enemies & Bosses lane, in progress): a skilled 0-Armory pilot should die around W25–35, a mid-Armory pilot can win, a full Armory wins reliably. Contact damage up, a steeper curve from ~W30, faster bosses with a real attack, denser Swarmers/Blinkers late.
2. **Balance sim calibration** (in progress), then **Armory ranks in run stats**, so real data can be split by Armory tier.
3. **Area-weapon class targets:** set them from measured enemies-hit-per-blast once calibration delivers.
4. Items in **To check** below, as Clay schedules them.
5. **Hangar** (big update, own discussion), then burrower & mini-spawner enemies, sector travel.

## Lanes (who owns what)

Stay in your lane. If you must touch another lane's files, keep it minimal and say so in the PR description.

| Lane | Owns |
|---|---|
| **Director** | `docs/ROADMAP.md`, merge order, version-number arbitration |
| **Enemies & Bosses** | `js/enemies.js`, `js/bosses.js`, `js/wave-plan.js`, `js/waves.js`, `js/archetypes.js`, `js/lieutenants.js`, `js/hostiles.js` and the other enemy modules, enemy Field Guide entries |
| **Weapons** | `js/weapon-*.js`, weapon modules (`flamethrower.js`, `grenades.js`, `gas-trail.js`, `deployables.js`, `shock-field.js`, …), Breakthroughs, weapon clips |
| **Balance** | `tools/balance*`, `docs/BALANCE_REPORT.md` (reports and recommendations; tuning goes to the owning lane) |
| **Hangar & Progression** | `docs/HANGAR_DESIGN.md`, then `js/progression.js`, `js/loadout.js` and new hangar/unlock modules |
| **UI** | `js/upgrade-cards.js`, `css/`, menus and overlays |

## Merge rules (avoiding collisions)

1. **One gameplay PR merges at a time.** Before merging, merge the latest `master` into your branch and re-run `npm test`.
2. **Bump the version at merge time, not when you start.** If `js/version.js` / `js/changelog.js` conflict, keep master's entries and put yours on top with the next number.
3. **Keep `js/main.js` changes small.** It is 6,800 lines and every lane touches it; put new features in their own module and wire them in with a few lines.
4. **Balance:** tuning PRs cite `docs/BALANCE_REPORT.md` or Clay's playtest notes, and follow the Decisions above where they differ from the report.
5. Small, low-risk UI/docs fixes still merge right away once `npm test` passes (see `CLAUDE.md`). Anything gameplay-affecting waits for Clay.
6. When a design decision is made, add it to the Decisions table above in the same PR.

## To check (open items, not yet scheduled)

Things found in playtesting or data that need a look. Move an item to Priorities when it's scheduled, or to Decisions when Clay decides it.

- **Leaderboard: preview builds post to the live board.** Deploy previews share the production Blobs stores, so unreleased versions (e.g. a v0.43.0 preview run) show on the public all-time board. Option: previews write to a separate test board.
- **Leaderboard plausibility envelope** was fitted to the old 30-wave sim (≈ wave 41 max, widened 3–10×). Re-check it after the difficulty retune so long 50-wave / Endless runs aren't rejected.
- **Scoring rewards no-hit play over progress:** a W59 campaign win scored 108M, less than a W33 run (121M), because score = kills × a multiplier that drops 25% per hit (and the Attractor retune slows its growth). Proposed: a victory bonus plus a per-wave survival bonus.
- **Wave 50 ending:** today the win triggers when the wave-50 boss dies, mid-wave, with spawns continuing. Proposed "Final Stand": wave 50 has no timer, the boss arrives with a last surge, spawns stop, clear the field → SECTOR CLEAR → VICTORY (stragglers drawn in after ~30–45 s).
- **Tesla Arc LV 18 spike:** ~1.7k DPS at LV 15 → ~14k at LV 18 in real play; 49% of all damage on v0.43.0. Watch after the fixed-SHOCK change (PR #138); if it stays dominant, trim its LV 18 Breakthrough, not the base weapon.
- **Supernova share:** 20–31% of all damage in real runs. Decide whether bombs should be that strong.
- **Run stats don't record the Armory** (being added by the Balance lane), so real-data balance can't yet split by Armory tier.
- **Run report UI:** the TOP WEAPON tile truncates long names ("Supernova …").
