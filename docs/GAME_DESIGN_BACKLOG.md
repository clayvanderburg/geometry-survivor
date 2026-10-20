# VEXOLITH // SURVIVOR — Game Design & Playtesting Backlog

**Captured:** October 16, 2026  
**Status:** Brainstorming / proposed design, not an implementation specification.  
**Source:** Live playtesting and design conversation.  
**Direction:** Geometry Wars' bright neon clarity + Vampire Survivors' builds + Deep Rock Galactic: Survivor's mining, all with responsive adaptive music.

> Preserve the fun already present. Separate observations from verified defects, and don't assume suggestions are implemented.

## Core design principles
- Fast, readable, satisfying neon-geometric combat on a dark background, **closer to Geometry Wars** than industrial realism.
- Multiple viable builds rather than one dominant "perfect" build.
- Meaningful upgrade choices with exact numeric previews.
- Mining, terrain, music, and combat should influence each other.
- Long-tail progression without making the game feel like a second job.

## 1. Visual identity, UX and combat feel
- Keep vivid cyan/magenta/green/purple/gold outlines; lower contrast in background so threats read clearly.
- Distinctive silhouettes for enemies, lieutenants and bosses.
- Sharper projectile impacts, selective screen shake/hit-stop, ship banking/recoil and thruster trails.
  - **Implemented (`js/ship-renderer.js`):** thruster plume that stretches with throttle and flares on dashes, a fading engine wake, wings that bank into turns, and turret recoil on every blaster shot (visual only, `updateShipAnimation`).
- Animate drilling sparks, fractures and debris; protect readability amid visual spectacle.
  - **Implemented (`js/asteroids.js`):** glowing, branching cracks spread from where the drill bites as the rock loses HP, a white-hot contact spot, a rock shudder while ground, chunks chipping off at 2/3 and 1/3 HP, grinding embers, and a core-shard burst on the final break (visual only).
- HUD and upgrade cards: headline benefit enlarged (e.g. **+2 PROJECTILES**), clear summary and optional detailed explanation, **before → after** numerical stats.
- **Rarity = rolled level jump (decided):** +1 common (white/gray), +2 uncommon (green), +3 rare (blue), +4 epic (purple), +5 legendary (gold). Evolutions/synergies are their own magenta tier. Odds are tunable (`doubleLevelChance` … `pentaLevelChance`) and scale with Luck.
- **Weapon balance target (decided):** every weapon should have about the same potential DPS at the same level; difficulty of use is tuned separately later.
- Optional floating damage numbers and easily recognizable critical-hit feedback.

## 2. Mining, terrain and resources
- Replace isolated "blob" feeling with denser, connected, thick asteroid formations, corridors, strategic cover, and hidden pockets.
- Some formations indestructible, used for map boundaries, bottlenecks, and shelters. Make outer hard boundary apparent.
- **Material hue = ore/resource category; fill shade = toughness.** Lighter/less-filled interiors mean easier to drill; darker/denser interiors mean harder. **Outlines remain bright** even on dark asteroids.
- Show damage via glowing cracks, progressive breakup, distinct sound and particles.
- Mining slower by default already has been adjusted; preserve meaningful drill upgrades.
- Buried discoveries can include valuable ore, chests, or anomalies; distinguish resource rewards clearly.
- Examine existing gold, blue/green and other asteroid hues for current actual meanings rather than assuming they're decorative. README currently describes Gold Geom, Shield Crystal and Deep Core veins.

## 3. Weapon leveling, cards and build direction
- Every weapon level must say exactly what changes. A baseline level can improve multiple related stats in modest amounts (e.g. damage, projectile speed, radius), but **not every stat must rise every level**.
- Specialized cards target one weapon, a tag/family, or all weapons.
- Tags may include laser/beam, projectile, missile/explosive, plasma/energy, ballistic, area, deployable.
- Stats worth building around: damage, attack speed, projectile speed, projectile count, projectile size, area, duration, crit chance and crit damage.
- Projectile count is unusually powerful and may need rarer offerings or stronger balance controls.
  - **Implemented (tags):** every weapon card carries tag chips (`PROJECTILE`, `KINETIC`, `EXPLOSIVE`, `ELECTRIC`, `AREA`, `ORBITAL`, `GRAVITY`; `WEAPON_TAGS` in `js/weapon-scaling.js`). Four specialist cards boost a whole tag and only appear once you own a weapon carrying it: KINETIC/EXPLOSIVE/ELECTRIC damage (rare) and AREA size (epic). Crit chance and crit damage are their own cards. No new card adds projectile count; Prism Split stays the only source.
- **Weapon loadout (decided, implemented):** 6 weapon slots; the crab starts with Pew Pews + Wing Rockets. Level-ups offer upgrades only for equipped weapons plus general cards; tag cards need an equipped weapon with that tag; a frequent NEW WEAPON card (chance + pity) opens a pick of 1 of 3 weapons while a slot is free; the pause-menu loadout panel can discard a weapon (with confirm) to free its slot. Every weapon line goes to LV 8. Leveling uses a stepped linear XP curve instead of the exponential one. See README §3b and BALANCE_REPORT "Weapon loadout and leveling".
- Enable **reroll** and **reserve/lock for a later selection** on level-up, with limits.
- Proposed funding: in-run mining mineral spent on rerolls/reserves, independent of persistent Power Cores; escalating costs and/or limited reserve slots. Naming and costs TBD.
- Investigate whether supply cache level grants and normal level-up cards share correct weapon-level state; distinguish UI display bug from actual progression bug.
  - **Investigated:** caches and level-up cards share one `player.upgradeLevels` (regression test in `tests/upgrade-cards.test.js`). The confusion was display-only: every cache card used the magenta "+2 lucky roll" styling regardless of the real jump, said "INSTALLED → LEVEL n" with no starting level, and the HUD used "v n". Cards, caches and HUD now all say `LV a → LV b` / `LV n`, with exact before → after stats and a separate lucky-roll ribbon.

## 4. Evolutions, overclocks and synergies
- Audit existing evolution/synergy work before extending.
- Weapon milestones offer transformative overclocks, borrowing *inspiration* from Deep Rock Galactic: Survivor.
- Examples: split missiles, gigantic slow missiles, plasma trails, chaining beams, gravity-induced projectile clustering.
- Combination synergies should reward experimentation without producing one compulsory meta.
- Keep readable descriptions of prerequisites and actual numerical effects.

## 5. Critical hits, damage types and deployables
- Add crit chance, crit damage, critical visuals and corresponding build paths.
  - **Implemented:** every hit through `hitEnemy` can crit (base 5% / 1.5x, tunable). Crits print a larger white-gold `!` number with a gold halo and star burst, flash a gold star flare and play a throttled tick. In-run path (no Armory needed): *Deadeye Targeting Lattice* (chance), *Overkill Resonator* (damage), and the legendary *Supercritical* synergy (bigger crit bonus against status-afflicted targets).
- Distinct potential types: kinetic, plasma/heat-over-time, electrical chaining, corrosive nanites/armor erosion, explosive AoE, gravity/displacement, cryogenic slowing.
  - **Implemented (`js/status-effects.js`):** BURN (*Thermite Rounds*: blaster bolts stack a plasma DoT, red-orange tick numbers), CHILL (*Cryo Payload*: missile blasts slow, frosted hulls, bosses take 40% of the slow), CORRODE (*Nanite Swarm*: arcs stack +damage taken from every source, with a cap). Card previews show exact DPS / slow / damage-taken numbers. Black holes (now portals) are immune.
  - **v0.34 element infusion:** those three cards became per-weapon element cards (FIRE / FROST / CORROSIVE / SHOCK for Autocannon, Rocket Pods, Swarm Missiles, Tesla Arc and Plasma Grenades) that lock the weapon's element and raise its level; SHOCK adds a short stun with immunity windows; global STATUS cards (Potency, Application, Duration, Shock Conductor, Amplifiers) scale them. See README *Elements*.
- Mines/charges, temporary automated turrets, laser/missile emplacements, perhaps defensive drones.
- Deployables can scale via active count, duration, range, rate, and overclock modifications.
  - **First pass in game:** Proximity Mines, Sentry Turret and Escort Drones (category `DEPLOYABLE`, tag `deployable`) scale by active count, duration/fuse, range and rate; *Siege Battery* (mines + turret) makes turret bolts burst. Laser/missile emplacements and overclocks remain open. Needs playtesting for balance.

## 6. Enemy variety and encounter pacing
- Enemy archetypes: fast swarmers, slow durable bruisers, mini-spawners/splitters, orbiting-shield units, ranged attackers, burrowers, support/buff units, teleporters.
- Different movement, durability, silhouettes, and attack mechanics—not merely more health.
- **Continuous spawns.** Waves advance on a timer even if earlier enemies survive. Wave interval may shorten as difficulty increases.
- Proposed structure: lieutenant each wave, major boss **every five waves** (supersedes current README's every-three-wave boss behavior, if adopted).
  - **Implemented (first pass, for playtest):** Bruiser, Gunner (pooled enemy orbs), Aegis Shielder, Blinker and Conduit (support) archetypes, unlocked one per wave from wave 2; one lieutenant per non-boss wave with generated name/epithet and 1–2 modifiers. Bosses stay every 3 waves until the five-wave proposal is decided. Burrowers and mini-spawners are still open.
- Bosses should be quirky and strange as well as dangerous: mechanical crab, huge jellyfish, cosmic eye, multi-part geometry, terrain-dwelling monstrosity.
- Boss introductions need warning, title/name, audiovisual impact, special attack patterns, recognizable silhouette and distinctive rewards.

## 7. Gravity wells, black holes and wormholes
- **Naming (decided):** the crimson gravity *enemies* are **Vortexes** (killable; internal type `blackhole`). "Black hole" is reserved for the planned **black hole portal** feature below.
- **Suspected issue:** existing gravity pull is not visibly/mechanically noticeable; verify actual forces on player/enemies and whether effect is too subtle.
- Improve inward particle movement, trajectory bending, warped grid, collapse and explosion feedback. Potential beat pulses.
- New wormholes/anomalies: hidden in mined asteroid pockets OR randomly rip open in space; linked or unpredictable destinations, including across the map.
- Preserve momentum where fun; make entrances/exits dramatic, with sound filtering/silence and bass hit.
- Safety: don't drop player into unavoidable deaths—safe destination rules and brief invulnerability.

## 8. Progression across and between runs
Three complementary tracks:
1. Temporary weapon/stat cards acquired **during a run**.
2. Existing persistent **Void/Power Core** baseline stat improvements via Armory.
3. Proposed persistent **ship customization**: discover blueprints during runs; craft/install parts with blueprints + existing cores. Avoid adding a second permanent currency without need.
- Parts: thrusters, reactors, weapon hardpoints, shields, mining upgrades; some visibly alter ship and create distinct playstyles.
- Early unlocks feel frequent; late unlocks take investment and offer transformative choices, not tiny increases for grinding's sake.

## 9. Sectors, levels, endless and scoring
- Unlockable sectors gated by bosses, objectives, discoveries, or achievements.
- On boss completion, **physical portal** opens: advance to next sector or stay and chase score with mounting danger.
- Open decision: on entering next sector, keep all temporary upgrades, reset them, or partially carry over. Beware runaway power; decide after playtests.
- An independent endless/infinite mode supports escalating survival and competition.
- Global leaderboard with player callsigns/saved names, thousands of entries, pagination and fair mode-specific rankings.
- Proposed hosting architecture: browser frontend (possibly Netlify), Railway backend with PostgreSQL, separated from vitamin-tracker app on the same account. Deployment not yet performed; anti-cheat/server-side validation required.

## 10. Music, audio and reactivity
- Current procedural synthwave soundtrack feels repetitive and the reaction is not obvious enough. This is playtest feedback, not a verified audio bug.
- Playlist goal approximately **8–12 distinct tracks** (scope TBD); avoid a single perpetual loop.
- Adaptive layering: ambient exploration → rhythmic light combat → heavy combat → lieutenant escalation → boss peak. No dead stop between enemy waves.
- Synchronize grid pulses, weapon accents, explosions, mining, shield reactions, gravity effects and boss cues to musical timing where it helps.
- Gameplay can also change soundtrack intensity; two-way relationship between action and audio.
- Dramatic boss introduction, spatial tear/wormhole filtering, momentary drops and musical impact on re-entry.
- Strong identity should remain lively/spacey neon electronic, not shift toward industrial-dark realism.

## Playtest issue triage (NOT confirmed defects)
| Priority | Observation | Investigate |
|---|---|---|
| High | Supply cache raises weapon level, but later upgrade cards appear to offer older levels | Shared state, UI level source, effect application |
| High | Gravity wells barely seem to pull or slow anything | Physics and feedback |
| High | Upgrade tiers and actual gains are confusing | Rarity mapping, +2/+3 distinction, stat deltas |
| High | Boss appearances don't feel like major events | HUD warnings, audio, visual entrance |
| Medium | Asteroids' colors/strength unclear | Ore meaning, durability presentation |
| Medium | Many enemies die too quickly and feel alike | Enemy curves/archetypes |
| Medium | Procedural music repeats and gameplay interaction isn't evident | Audio sequencing, adaptive hooks |
| Medium | Damage effectiveness difficult to judge | Optional damage numbers |

## Suggested implementation sequencing (non-binding)
1. **Verify & polish:** progress-state issue, gravity physics, readable cards, boss notifications, basic feedback.
2. **Combat breadth:** enemy/lieutenant variety, crits/damage tags, deployables, intentional balance tests.
3. **Progression depth:** overclocks, synergies, reroll/reserve, blueprint ship parts.
4. **World:** thicker asteroid terrain, materials, wormholes, sector objectives, endless mode.
5. **Audio/visual:** playlist, adaptive stems, event sync, dramatic finishing effects.
6. **Online systems:** callsigns, score validation and leaderboard infrastructure.

## Open questions and next playtests
- Sector travel: which upgrades persist?
- Manual vs auto-aim: how should each style be supported and balanced?
- Exactly how should rare multi-level cards interact with cache rewards?
- What music production workflow creates variety without large scope creep?
- What are the target run lengths and timings for sector / endless modes?
- What should the mining-derived in-run reroll currency be called and how common is it?
- What performance budget works for hundreds of enemies, particles, turrets and reactive visuals?

## Collaboration
- This document is the **voice-brainstorming design backlog**, independent from the separate technical code review.
- For coding-agent handoffs, select a small scoped feature, verify actual repository state, specify tests and acceptance criteria, and keep this document updated when design decisions are finalized.
- No features described here should be called *implemented* solely because they're documented.
