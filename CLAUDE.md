# Notes for agents

**Start with [docs/ROADMAP.md](docs/ROADMAP.md)**: current priorities, decisions, which conversation owns which files, and the merge rules that keep parallel conversations from colliding (one gameplay PR at a time, bump the version at merge time).

Read the rules in [README.md](README.md) (*Versions & patch notes*) before merging. In short:

- **Gameplay changes** bump `GAME_VERSION` in `js/version.js` and add a matching `CHANGELOG` entry in `js/changelog.js` (`tests/changelog.test.js` checks it).
- **Keep the first-run TUTORIAL accurate** (`js/tutorial.js`, clips in `assets/tutorial/`). If your change alters anything it says or shows (controls, shield, mining/veins, gold reroll/lock, level-ups, weapon slots, lieutenants, bosses, Void Cores/armory), update the slide text and re-capture stale clips with `npm run tutorial-media` in the same PR. On every minor version bump, re-check all slides and set `TUTORIAL_REVIEWED_FOR` to the new major.minor (`tests/tutorial.test.js` fails until you do). Keep it brief: players have short attention spans.
- New enemy types need a Field Guide entry and preview (`tests/field-guide.test.js`).
- New weapons or Breakthroughs (or ones that now look different) need their clips re-recorded with `npm run weapon-media -- --only <id>` (`tests/weapon-media.test.js`).
- Run `npm test` before pushing.
- **Small, low-risk fixes** (UI/CSS tweaks, typos, one-line bugs): open the PR and merge it right away once `npm test` passes. No need to ask first. Anything larger or gameplay-affecting still waits for review.
- **Void Armory changes always refund Void Cores.** Changing an Armory upgrade's effect or cost bumps its revision in `ARMORY_REVISIONS` (`js/progression.js`); removing one adds it to `RETIRED_UPGRADES`. Add a test.
