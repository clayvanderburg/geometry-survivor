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

## Priorities (in order)

1. **50-wave campaign** — Enemies & Bosses conversation, [PR #119](https://github.com/clayvanderburg/geometry-survivor/pull/119) (rework from every-4th to every-5th wave).
2. **Fresh balance report** on the current version (the Oct 17 report predates v0.34–v0.42). Feeds targets to the Weapons and Enemies conversations.
3. **Hangar + weapon unlocks/mastery** — design doc first (`docs/HANGAR_DESIGN.md`), Clay approves, then build in small PRs.
4. **Victory screen** — starts after the 50-wave campaign merges.
5. **Card scope indicator** (utility / global outline) — small UI.
6. Later: wormholes/black-hole portals, burrower & mini-spawner enemies, sector travel.

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
4. **Balance hold:** until the new balance report lands, weapon/enemy *number tuning* waits (bug fixes are fine). After that, tuning PRs cite the report.
5. Small, low-risk UI/docs fixes still merge right away once `npm test` passes (see `CLAUDE.md`). Anything gameplay-affecting waits for Clay.
6. When a design decision is made, add it to the Decisions table above in the same PR.
