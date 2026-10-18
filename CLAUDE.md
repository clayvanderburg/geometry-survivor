# Notes for agents

Read the rules in [README.md](README.md) (*Versions & patch notes*) before merging. In short:

- **Gameplay changes** bump `GAME_VERSION` in `js/version.js` and add a matching `CHANGELOG` entry in `js/changelog.js` (`tests/changelog.test.js` checks it).
- **Keep the first-run TUTORIAL accurate** (`js/tutorial.js`, clips in `assets/tutorial/`). If your change alters anything it says or shows (controls, shield, mining/veins, gold reroll/lock, level-ups, weapon slots, lieutenants, bosses, Void Cores/armory), update the slide text and re-capture stale clips with `npm run tutorial-media` in the same PR. On every minor version bump, re-check all slides and set `TUTORIAL_REVIEWED_FOR` to the new major.minor (`tests/tutorial.test.js` fails until you do). Keep it brief: players have short attention spans.
- New enemy types need a Field Guide entry and preview (`tests/field-guide.test.js`).
- Run `npm test` before pushing.
