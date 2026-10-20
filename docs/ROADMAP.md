# VEXOLITH // SURVIVOR — Roadmap & coordination

**Owner:** the Director session (works with Clay). **Read this before starting any work.** It says what we're
building next, which conversation owns which files, and how changes get merged without stepping on each other.
Ideas live in [GAME_DESIGN_BACKLOG.md](GAME_DESIGN_BACKLOG.md); this file holds decisions and priorities.

## Decisions (source of truth)

| Date | Decision |
|---|---|
| 2026-10-20 | **The campaign is 50 waves** with a boss every 5th wave (10 bosses). Beating wave 50 shows a **victory screen** offering *Continue into Endless* or *Go for high score!* (end the run and bank the score). |
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

## Priorities (in order)

1. **Merge the 50-wave campaign** ([PR #119](https://github.com/clayvanderburg/geometry-survivor/pull/119), includes the victory screen), then **rifts & bedrock** ([PR #130](https://github.com/clayvanderburg/geometry-survivor/pull/130), re-bumped to the next version). Clay reviews both.
2. **Difficulty curve** after Clay playtests #119: contact damage, the wave-HP curve, faster bosses (most are the slowest things on the field). Enemies & Bosses lane.
3. **Weapons pass:** Swarm Missiles +30% base fire rate, Rocket Pods up to Autocannon level, Orbit Blades +50% orbit radius / +30% spin, then the other weapons per the balance report. Weapons lane.
4. **Balance sim calibration:** find why the bot under-rates missiles/rockets; check it against real player data.
5. **Progression safety:** early-access warning and Void Core refunds for reworked Armory upgrades.
6. **Hangar** (big update, own discussion), then burrower & mini-spawner enemies, sector travel.

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
