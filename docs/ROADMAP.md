# VEXOLITH // SURVIVOR — Roadmap & coordination

**Owner:** the Director session (works with Clay). **Read this before starting any work.** It says what we're
building next, which conversation owns which files, and how changes get merged without stepping on each other.
Ideas live in [GAME_DESIGN_BACKLOG.md](GAME_DESIGN_BACKLOG.md); this file holds decisions and priorities. Design drafts for discussion: [HANGAR_DESIGN.md](HANGAR_DESIGN.md) (ships, feats, mastery) and [SECTORS_DESIGN.md](SECTORS_DESIGN.md) (sectors, portals, story campaign).

## Decisions (source of truth)

| Date | Decision |
|---|---|
| 2026-10-20 | **Core design principle: everything in sound and animation is SATISFYING.** Punchy feedback, juicy impacts, rewarding pickups and level-ups, smooth easing, weighty audio with pitch variety. If it feels flat, it isn't done; readability and frame rate come first. |
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
| 2026-10-20 | **Difficulty targets (v0.43.x):** a skilled pilot with **0 Armory dies around wave 25–35** (10–14 min); with a **mid Armory (~rank 3 everywhere) can win** with good play; with a **full Armory wins reliably**, and Endless is the challenge. Waves 1–~15 stay friendly for new players. Levers, in order: contact damage up ~25–30%, a steeper curve from ~wave 30, faster bosses with one real (telegraphed or contact-range) threat each and no extra HP, denser swarmers/blinkers late. Weapons are not nerfed for this (Weapons lane). |
| 2026-10-20 | **No body-blocking or knockback from regular enemies** (Clay): packs never physically stop the ship. Only a special enemy built for it may push the ship, such as the Repulsor's shield. |
| 2026-10-20 | **Contact damage is not being lowered** (the report's recommendation is on hold): Clay can still charge through packs and may want it higher. The difficulty curve is decided after Clay playtests PR #119. |
| 2026-10-20 | **Tesla Arc is always SHOCK** ("it's friggin lightning"): stun arcs are its baseline, like the Flamethrower's FIRE. It has no element cards; its SHOCK rank follows its level (+1 at LV 6/12/18). |
| 2026-10-20 | **Class-based weapon balance** (replaces "all offensive weapons equal" for realized damage): per target at equal level vs the Autocannon (100%): automatic single-target (Drones, Turret) ~85%; area weapons 60–70% per target, about even in total against packs; close-range defensive (Shock Field, Orbit Blades) lower by design. Encoded as `WEAPON_CLASS` / `CLASS_TARGET`; area targets enforced once enemies-hit-per-blast is measured. |
| 2026-10-20 | **A full Void Armory is about 3× total power** vs 0 Armory (offense × defense, `armoryPower` in `js/progression.js`, pinned ±15% by `tests/armory.test.js`). v0.43.3: Plasma Overcharge +1.5%/rank (+60%), Aegis Shield Matrix +2/rank (+80), both refunded. Rank 3 everywhere ≈ 1.1×, **mid Armory = half ranks everywhere** ≈ 1.85× (under 10% of the full cost), full ≈ 3.07×. The difficulty curve is sized against these tiers. |
| 2026-10-20 | **Armory: buff existing upgrades, no new ones for now** (no revive, free reroll, extra slot, …). Power comes from bigger values per rank, a steeper top end or more ranks on existing upgrades. |

## Priorities (in order)

Shipped 2026-10-20: **v0.43.0** (#137), **v0.43.1** (#138), Void Core refunds (#133), sim calibration (#142), Armory in run stats (#141), **v0.43.2** difficulty (#143), **v0.43.3** 3× Armory (#144).

### Build swarm (Oct 20–22): many sessions in parallel, one lane each
| Work | Notes |
|---|---|
| Weapon floor | ≥2 weapons by player LV 6 … 6 by LV 30; a forced CHOOSE A WEAPON hand |
| Sentry Turret rework | works like DRG: Survivor's LMG Gun Platform (PR #145) |
| Volatile Shatter nerf | same shards, ~0.4× shard damage (PR #146) |
| Late-HP curve | softer past ~W35 so a 3× full Armory clears W50 |
| New weapons ×5 | Rail Lance, Glaive Discs, Quake Mortar, Nanite Swarm, Claw Harpoon (in the normal pool; Hangar gating later) |
| Hangar epic | ships, feats, weapon locks, mastery, SOLO, Prism Beam; **behind `HANGAR_ENABLED` (off)** until Clay signs off; try it with `?hangar=1` |
| Endgame | wave-50 Final Stand, then scoring that rewards progress (per-wave and VICTORY bonuses), then leaderboard hygiene (preview test boards, envelope refit) |
| Bosses | overhaul A (minors W5/15/25/35/45) and B (majors W10/20/30/40/50): signature attacks, phases, size and speed, visuals, sound |
| New enemy | mini-spawner (hive that births drones) |
| Sectors & portals | design doc only, for a later discussion |
| UI polish | run-report truncation and an overflow sweep |

**Swarm merge rules:** swarm PRs **don't bump the version or add changelog entries**; the Director assigns versions and patch notes at merge time and merges after Clay's review. Keep shared lists append-only, put features in their own modules, keep `js/main.js` edits small, and merge master in often.

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
