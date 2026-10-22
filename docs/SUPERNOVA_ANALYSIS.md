# Supernova: is 15–31% of all damage healthy? (Balance lane, Oct 22 2026, report only)

## What it does
- **Effect:** kills every non-boss enemy within ~1,650 px (the whole screen) and strips 40% of max HP from bosses, their mounted parts and lieutenants (`triggerSupernova`, `js/main.js`). It also clears enemy orbs, gives 1.2 s of invulnerability and magnetizes every geom.
- **How run stats count it:** each killed enemy's *remaining HP* is credited to `supernova`. So its "damage" is the HP of a whole screen, removed at once and never overkilled. Its share grows with enemy HP (later waves) and with how crowded the screen is when it fires.
- **Supply:**
  - 2 bombs at run start (+1 to +3 from the Void Armory), +1 per boss kill, cap 9.
  - Before #211: +1 per Geom Attractor rank.
  - With #211: a rare drop from lieutenants (35%), void wells (4%) and hulks (2%), each × Luck.

## What the data says
| source | Supernova share of all damage | notes |
|---|---|---|
| Real players, all versions (60 runs) | **15.0%**, 2nd after the Autocannon (41%) | v0.43.0 runs 19.5%, v0.43.2 / 0.43.3 1.6% / 2.0%, preview-203 15%; Clay's runs 15–31% |
| Sim bot (panic use: shield < 35% with 10+ enemies near, or a boss near at < 50%) | 5–18% per run | highest in weak or short runs (mining / prospector 12–18%, strong Autocannon builds 3–10%) |
| Sim on #211 (bomb drops) | random 17%, projectile 9% | long runs get more bombs: 3.7 → 6.8 per projectile run (6 runs each, noisy) |

**What a bomb is worth.** Sim runs with bombs disabled, 6 seeds each, 15-minute cap:

| strategy | median survival with bombs | without | bombs per run | kills per bomb |
|---|---:|---:|---:|---:|
| random cards | **4.9 min** | 2.1 min | 4.8 | ~56 |
| Autocannon (projectile) build | 9.1 min | 8.2 min | 3.7 | ~37 |

## Reading
1. **The share mostly measures how much a run leaned on the panic button, not how strong the bomb is.** Weak builds bomb more, and every bomb wipes a full screen. That's why the share is highest in short, struggling runs, and why it's inversely related to build strength.
2. **It's a run-saver for weak builds** (more than doubling a random build's survival) and a modest buffer for strong ones. That fits a 3-bomb screen-clear.
3. **Two real costs:**
   - **It scales for free.** An instant kill ignores enemy HP, so a bomb's value climbs with every wave while weapons have to level to keep up. Late-game, a bomb deletes more HP than minutes of weapon fire.
   - **It muddies balance data.** 15% of "damage" that isn't any weapon's dilutes every weapon's share in the stats. Weak weapons look worse in share terms because their pilots bomb more.
4. **#211 raises the supply in long runs.** The lieutenant drop roughly doubled bombs per run for the bot's strong builds in a small sample. If v0.46 runs show the share climbing, that's the cause.

## Options (Clay decides)
- **A. Keep it, fix the measurement (recommended first).** Report weapon shares as a share of *weapon* damage (excluding `supernova`, `ram` and `shrapnel`), and track bombs used per run and kills per bomb in run stats. No gameplay change; the balance signals get cleaner.
- **B. Watch the #211 supply.** If v0.46 runs show more than about 5 bombs per run or the share above 20%, trim the lieutenant drop (35% → 20%) or the carry cap (9 → 5).
- **C. Stop the free late-game scaling** (only if Clay wants bombs to matter less late). Elites and hulks take the boss rule (−40% max HP) instead of dying outright, so swarm fodder still vanishes and the screen-clear feel stays.
- **D. Do nothing.** A screen-clear that carries weak runs is a feature in many survivors-likes, and the share falls naturally as builds get stronger.

**Recommendation:** A now, B as a watch item for v0.46, and C only if Clay wants the bomb to be a defensive tool more than a damage source. I'd keep the full-screen wipe of normal enemies either way: it's one of the most satisfying moments in the game.

Data and scripts: real numbers from `/api/stats/summary` (prod plus deploy-preview-203); sims from `tools/balance/harness.mjs` with `triggerSupernova` disabled or counted, on this branch and on #213 for the #211 drop.
