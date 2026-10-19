// Player-facing patch notes, newest first. Shown by the PATCH NOTES screen (js/patch-notes.js) and used
// by the /api/scores Netlify Function (which bundles this file) as the list of known game versions.
//
// Adding a release: bump GAME_VERSION in js/version.js and put a new entry at the TOP of this list
// with the same version. Write for players: short, plain and concrete ("Escort Drones fire 4x faster
// (same damage output)"), no file names or dev jargon, a handful of notes per version.
// Note types: 'new' (features, content), 'balance' (numbers that change how runs play), 'fix'.
//
// Versions 0.1.0-0.8.1 were assigned after the fact from the merge history (PRs #1-#15).

export const NOTE_TYPES = Object.freeze(['new', 'balance', 'fix']);

export const CHANGELOG = Object.freeze([
  {
    version: '0.34.0',
    date: '2026-10-19',
    title: 'Boss Campaign',
    notes: [
      { type: 'new', text: 'BOSS CAMPAIGN: a minor boss every 3rd wave and a major boss every 6th, each with its own look and attacks. New enemies now debut alongside a boss instead of on a fixed wave.' },
      { type: 'new', text: 'Bosses: BROOD QUEEN (3), OUROBOROS (6), WING COMMANDER (9), HIVE CARRIER (12), EVENT HORIZON (15), ARCHITECT (18), PROGENITOR (21).' },
      { type: 'new', text: 'New enemies: MAYFLIES, SERPENTS, KESTREL V-wings, CARRIERS + DRONES, HULKS, LASER GATES (fly through the beam to blow one up) and MITOSIS CELLS.' },
      { type: 'new', text: 'Every wave has a theme (MAYFLY BLOOM, STAMPEDE, CROSSFIRE...) that tilts which enemies show up. Past wave 30, bosses come in pairs.' },
      { type: 'new', text: 'Veteran forms: swarmers, pinwheels, weavers, splitters and mayflies grow an extra edge and a little speed at waves 11 and 21. Late splitters burst into four.' },
      { type: 'balance', text: 'Enemies debut later (bruisers 6, blinkers 9, gunners 12, vortexes 15, shielders 18, conduits 24); every wave keeps the same total enemy HP per second.' },
      { type: 'balance', text: 'While a boss wave\'s boss is up, packs arrive 30% less often, until the wave ends. Major bosses have 1.8x HP and drop 5 Void Cores.' },
      { type: 'balance', text: 'Bosses bust through asteroids 4x faster than before, and a boss portal blows apart the rock around it. Serpent heads drill rock and their bodies glide over it.' }
    ]
  },
  {
    version: '0.33.0',
    date: '2026-10-19',
    title: 'Shield Capacitor',
    notes: [
      { type: 'new', text: 'SHIELD CAPACITOR: the shield now has its own card (+20 max shield, repairs 35). Phase Nova Thrusters is just speed and the dash shockwave, and HARDCORE can draw it now.' },
      { type: 'balance', text: 'Void Armory prices climb much faster: the first ranks are as cheap as ever, the last rank of every upgrade costs about 1,000 Void Cores.' },
      { type: 'fix', text: 'The developer\'s test pilots (NOX, MADKING) were cleared off every leaderboard, with their Void Cores and armory reset.' }
    ]
  },
  {
    version: '0.32.0',
    date: '2026-10-19',
    title: 'No More Ramming',
    notes: [
      { type: 'balance', text: 'After a hit you are untouchable for 0.4 s (was 0.65 s), so plowing through a pack hurts. Phase Buffer adds +0.01 s per rank (was +0.02 s).' },
      { type: 'balance', text: 'Base shield 75 (was 85) and it recharges half as fast (0.6/s). Phase Nova Thrusters give +15 max shield and repair 30 (was +25 / 45). Aegis Shield Matrix +1.5 per rank (was +2).' },
      { type: 'balance', text: 'Early waves hit a little softer, so a fresh pilot gets a fair start; by wave 20 enemies hit as hard as before.' },
      { type: 'fix', text: 'The Field Guide now shows HARDCORE\'s real starting shield.' }
    ]
  },
  {
    version: '0.31.2',
    date: '2026-10-19',
    title: 'Nothing Left Behind',
    notes: [
      { type: 'balance', text: 'XP geoms, Void Cores and gold coins no longer fade away. Lead the swarm around and circle back for them any time.' }
    ]
  },
  {
    version: '0.31.1',
    date: '2026-10-18',
    title: 'Mid-Game Pressure',
    notes: [
      { type: 'balance', text: 'Enemy health snowballs sooner: it picks up from wave 8 and hits full speed by wave 18, right when weapons reach their late levels. Up to 2x tougher from wave 20 on.' }
    ]
  },
  {
    version: '0.31.0',
    date: '2026-10-18',
    title: 'Tougher Still',
    notes: [
      { type: 'balance', text: 'Enemies again: +20% health, +8% speed, bigger and faster packs and harder hits. Their health now snowballs from wave 12 and climbs much faster.' },
      { type: 'balance', text: 'Your ship again: base shield 85, base damage 9.5, damage cards +42% per rank.' },
      { type: 'balance', text: 'Void Armory trimmed (your ranks are kept): Plasma Overcharge +1% damage per rank, Aegis Shield Matrix +2 shield, Ablative Plating -0.4% damage taken.' },
      { type: 'new', text: 'Fresh leaderboards: every board in every mode was wiped. Version tabs start at this version.' }
    ]
  },
  {
    version: '0.30.0',
    date: '2026-10-18',
    title: 'Mobile Play',
    notes: [
      { type: 'new', text: 'Play on your phone or tablet: touch the left half of the screen to fly, the right half to aim, and tap DASH / NOVA. Without a thumb on the aim side, the turret auto-aims.' },
      { type: 'new', text: 'Touch controls switch on by themselves on touchscreens; a mouse click switches back.' },
      { type: 'new', text: 'Phone layout: a slim HUD, compact level-up cards with a MORE button, and big-button menus that open the leaderboard and armory in their own windows.' },
      { type: 'new', text: 'GO FULLSCREEN button on the title and pause screens. On iPhone, add the game to your home screen to play full screen.' },
      { type: 'balance', text: 'Small screens zoom out so enemies no longer spawn on top of you; on touch screens the view is zoomed out a further 30%.' },
      { type: 'fix', text: 'Hoovering up a big cluster of XP no longer builds into a shrill whine: the pickup chime climbs less, gets quieter on long streaks and stops stacking.' }
    ]
  },
  {
    version: '0.29.0',
    date: '2026-10-18',
    title: 'Tougher',
    notes: [
      { type: 'balance', text: 'Enemies have a bit more health (+10%), speed (+5%) and contact damage, and come in slightly bigger, faster packs.' },
      { type: 'balance', text: 'Your ship is a bit weaker: base shield 90 (was 100), base damage 10 (was 11), damage cards +45% per rank (was +50%).' },
      { type: 'balance', text: 'Applies to every mode.' }
    ]
  },
  {
    version: '0.28.0',
    date: '2026-10-18',
    title: 'Game Modes',
    notes: [
      { type: 'new', text: 'HARDCORE mode: no shield regen, no shield cards, no repairs, no Aegis Shield Matrix. When the shield is gone, so are you.' },
      { type: 'new', text: 'BLITZ mode: short waves, fast levels and a steep ramp, so a run plays out in under 10 minutes.' },
      { type: 'new', text: 'Pick the mode next to LAUNCH (keys 1-3, or LB / RB). Each mode has its own global board and MY RUNS list.' }
    ]
  },
  {
    version: '0.27.4',
    date: '2026-10-18',
    title: 'Mobile Sentries',
    notes: [
      { type: 'balance', text: 'Sentry Turret Count now goes up to 9 turrets (was 6).' },
      { type: 'new', text: 'New LV 12 Sentry Turret Breakthrough, Mobile Sentries: planted turrets slowly follow you, and their bolts hit harder. It replaces Piercing Rail.' }
    ]
  },
  {
    version: '0.27.3',
    date: '2026-10-18',
    title: 'Armory Tidy',
    notes: [
      { type: 'balance', text: 'Chronos Capacitor (Autocannon fire rate) leaves the Void Armory: weapons are built during the run. Every Void Core you spent on it is refunded.' },
      { type: 'fix', text: 'The Void Armory list now fills its panel on the title screen.' }
    ]
  },
  {
    version: '0.27.2',
    date: '2026-10-18',
    title: 'Clear Flak',
    notes: [
      { type: 'fix', text: 'Flak Rounds bursts are thin see-through rings now, so enemies under fire stay visible instead of vanishing into bright blobs.' }
    ]
  },
  {
    version: '0.27.1',
    date: '2026-10-18',
    title: 'Wings',
    notes: [
      { type: 'new', text: 'The ship trades its crab legs for swept wings with running lights.' },
      { type: 'fix', text: 'Mining no longer spins the whole ship: the hull keeps facing where you fly and only the drill arms swing to the rock.' }
    ]
  },
  {
    version: '0.27.0',
    date: '2026-10-18',
    title: 'Balanced Volume',
    notes: [
      { type: 'fix', text: 'Volume sliders are rescaled: 100% on Master, Music and SFX is now a comfortable, balanced mix, and all three read in %.' },
      { type: 'fix', text: 'Your saved volume settings convert automatically, so the game sounds exactly as it did.' }
    ]
  },
  {
    version: '0.26.2',
    date: '2026-10-18',
    title: 'Full Volume Menus',
    notes: [
      { type: 'fix', text: 'Pause and level-up menus no longer soften the music, so you can set the volume by ear.' }
    ]
  },
  {
    version: '0.26.1',
    date: '2026-10-18',
    title: 'Setlist',
    notes: [
      { type: 'fix', text: 'Runs always open on Geom Harvest and build in intensity to Singularity, instead of a random track.' },
      { type: 'fix', text: 'After a boss fight the run music picks up where it left off.' }
    ]
  },
  {
    version: '0.26.0',
    date: '2026-10-18',
    title: 'Smoother Curves',
    notes: [
      { type: 'balance', text: 'Leveling bends up smoothly instead of jumping at LV 20 and LV 40; late levels come about 25% sooner.' },
      { type: 'balance', text: 'Enemy toughness, spawn pace and contact damage ease in gradually instead of switching on at set waves; the late wall is about 20% gentler.' }
    ]
  },
  {
    version: '0.25.0',
    date: '2026-10-18',
    title: 'Soundtrack',
    notes: [
      { type: 'new', text: 'A real soundtrack: Vexolith Drift on the title screen, a shuffled four-track playlist in runs and a boss theme for boss fights.' },
      { type: 'new', text: 'The grid still pulses to the beat of whatever track is playing.' }
    ]
  },
  {
    version: '0.24.1',
    date: '2026-10-18',
    title: 'Smooth Menus',
    notes: [
      { type: 'fix', text: 'Opening a level-up or pause menu no longer snaps the music to a different-sounding mix: the same song keeps playing and softens gently.' }
    ]
  },
  {
    version: '0.24.0',
    date: '2026-10-18',
    title: 'Living Grid',
    notes: [
      { type: 'fix', text: 'Your ship lights the neon grid evenly all around it (it used to light a lopsided staircase) and pushes a bow wave through the lines.' },
      { type: 'new', text: 'Explosions send ripples across the grid, scaled by blast size and tinted by their colour.' },
      { type: 'new', text: 'Gravity wells, singularities, dashes and Supernovas warp the grid harder, with a springier rebound.' }
    ]
  },
  {
    version: '0.23.0',
    date: '2026-10-18',
    title: 'Run Overview',
    notes: [
      { type: 'new', text: 'The pause menu is a full run overview: your ship up close, a run summary, your loadout, every stat (base, permanent, this run) and your upgrades.' },
      { type: 'new', text: 'MAIN MENU in the pause menu and on the game-over screen. Leaving mid-run asks first; an abandoned run is not recorded.' },
      { type: 'new', text: 'Hotkeys: [H] hides the HUD, [V] toggles fullscreen. Your ship now shows on the title screen.' },
      { type: 'fix', text: 'The upgrade list moved off the top of the HUD into the pause menu and the level-up screen.' }
    ]
  },
  {
    version: '0.22.5',
    date: '2026-10-18',
    title: 'Quiet Crits',
    notes: [
      { type: 'fix', text: 'Crit damage numbers no longer end in "!": they still pop bigger and gold.' }
    ]
  },
  {
    version: '0.22.4',
    date: '2026-10-18',
    title: 'Armory',
    notes: [
      { type: 'fix', text: 'The weapon pick has its own orange armory look and leads with the weapon name, so it no longer reads like an upgrade card.' }
    ]
  },
  {
    version: '0.22.3',
    date: '2026-10-18',
    title: 'Clean Numbers',
    notes: [
      { type: 'fix', text: 'Big upgrade cards read as a multiplier: a lucky +4 damage card now says 5.1× instead of +406%.' }
    ]
  },
  {
    version: '0.22.2',
    date: '2026-10-18',
    title: 'Fine Tuning',
    notes: [
      { type: 'balance', text: 'Gravity Grenade: each enemy falls toward one grenade, and the pull builds as the fuse burns down.' },
      { type: 'balance', text: 'Hawking Cascade minis drift onto nearby enemies; Orbital Rain blasts wider; Minefield Triad is tossed toward the nearest enemy.' },
      { type: 'balance', text: 'Piercing Rail punches through 3 enemies (was 8); Thunderstrike on a lone target only counts the chain hits that landed.' }
    ]
  },
  {
    version: '0.22.1',
    date: '2026-10-18',
    title: 'On Target',
    notes: [
      { type: 'fix', text: 'Rocket Pods now angle in on what you aim at, so a lone enemy dead ahead no longer slips between the two rockets.' }
    ]
  },
  {
    version: '0.22.0',
    date: '2026-10-18',
    title: 'Breakthrough Balance',
    notes: [
      { type: 'balance', text: 'Cluster Bomblets hop onto nearby enemies and hit harder; Cluster Mines bomblets hit harder too.' },
      { type: 'balance', text: 'MIRV mini-rockets home on their own targets. Ball Lightning drops its orb on the nearest enemy.' },
      { type: 'balance', text: 'Aftershock Collapse pulls from further out, so the second implosion catches a crowd.' },
      { type: 'balance', text: 'Thunderstrike and Mortar Battery hit a tighter area; Tactical Nuke and Gravity Grenade hit a little softer.' }
    ]
  },
  {
    version: '0.21.3',
    date: '2026-10-18',
    title: 'Rocket Pods',
    notes: [
      { type: 'new', text: 'Wing Rockets are now Rocket Pods.' },
      { type: 'fix', text: 'The HUD no longer lists your weapons a second time as LV 1.' },
      { type: 'fix', text: 'Weapon Range: AUTO ranks now light up the stat each level added, so extra rockets or missiles make sense.' }
    ]
  },
  {
    version: '0.21.2',
    date: '2026-10-18',
    title: 'Trick Shots',
    notes: [
      { type: 'balance', text: 'Ricochet Rounds spread their bounces over the pack, skip enemies the Flak burst already hit, and hit harder.' },
      { type: 'new', text: 'Ricochet Rounds now bounce off asteroids too.' },
      { type: 'fix', text: 'Autocannon tracers are 40% slimmer (same hitbox).' }
    ]
  },
  {
    version: '0.21.1',
    date: '2026-10-18',
    title: 'Worth the Pick',
    notes: [
      { type: 'balance', text: 'Cluster Grenades: bomblets now hop onto nearby enemies past the blast, and each hits twice as hard.' },
      { type: 'balance', text: 'Twin Singularities: full-size pull, harder hits. The second goes after enemies behind you, or stacks on the first when there are none.' }
    ]
  },
  {
    version: '0.21.0',
    date: '2026-10-18',
    title: 'Weapon Range',
    notes: [
      { type: 'new', text: 'WEAPON RANGE on the title screen: build any loadout, set levels, Breakthroughs, damage types and synergies, then test it on target dummies.' },
      { type: 'new', text: 'The range shows live DPS per damage source next to each weapon\'s potential DPS. Nothing there counts toward scores or stats.' }
    ]
  },
  {
    version: '0.20.1',
    date: '2026-10-18',
    title: 'Spread Out',
    notes: [
      { type: 'balance', text: 'Cluster Grenades: bomblets now scatter wide past the main blast instead of landing inside it.' },
      { type: 'balance', text: 'Plasma Grenades spread across different directions instead of piling onto one pack.' },
      { type: 'balance', text: 'Twin Singularities launch in opposite directions so their pulls no longer fight each other.' }
    ]
  },
  {
    version: '0.20.0',
    date: '2026-10-18',
    title: 'Four Cards',
    notes: [
      { type: 'new', text: 'Level-ups now offer 4 cards instead of 3. Pick with 1-4.' },
      { type: 'fix', text: 'Controller: pressing Down from a card reliably reaches the REROLL button.' }
    ]
  },
  {
    version: '0.19.5',
    date: '2026-10-18',
    title: 'Clearer Cards',
    notes: [
      { type: 'fix', text: 'Reactor Overdrive now reads +12% DAMAGE · ALL WEAPONS instead of looking like an Autocannon-only card.' }
    ]
  },
  {
    version: '0.19.4',
    date: '2026-10-18',
    title: 'Synth Picks',
    notes: [
      { type: 'new', text: 'New synth sounds for the Autocannon, grenade blasts, taking damage, dashing and the Supernova.' },
      { type: 'fix', text: 'Level up is back to its original sound, and Orbit Blade hits are quieter and subtler.' }
    ]
  },
  {
    version: '0.19.3',
    date: '2026-10-18',
    title: 'Hand-Picked Sounds',
    notes: [
      { type: 'new', text: 'New sounds for rockets, missiles, explosions, Tesla Arc, grenade throws and the Vortex.' },
      { type: 'new', text: 'New sounds for bosses, lieutenants, elite entrances, menus and game over. Everything else keeps its original sound.' }
    ]
  },
  {
    version: '0.19.2',
    date: '2026-10-18',
    title: 'Sound Rollback',
    notes: [
      { type: 'fix', text: 'Back to the original sound effects, except the new level-up and supply-cache jingles. The new soundtrack stays.' }
    ]
  },
  {
    version: '0.19.1',
    date: '2026-10-18',
    title: 'Classic Pew',
    notes: [
      { type: 'fix', text: 'The Autocannon and Escort Drones are back to their original shot sounds.' }
    ]
  },
  {
    version: '0.19.0',
    date: '2026-10-18',
    title: 'Sound Overhaul',
    notes: [
      { type: 'new', text: 'All-new sound effects for every weapon, explosion, pickup, boss and menu, plus a victory jingle when you open a supply cache.' },
      { type: 'new', text: 'New synthwave soundtrack: three songs that rotate between runs and build up as the fight gets hotter, with a darker turn during boss fights.' },
      { type: 'new', text: 'Breakthroughs, enemy kills, gold pickups, turret shots and grenades each have their own sound now.' }
    ]
  },
  {
    version: '0.18.2',
    date: '2026-10-18',
    title: 'Deeper Weapons',
    notes: [
      { type: 'balance', text: 'Weapons now level to LV 18, with Breakthroughs at LV 6, 12 and 18. One card can take at most 11 ranks, so LV 18 takes a mix.' },
      { type: 'fix', text: 'Each weapon gets each Breakthrough exactly once per run (unless you discard and re-equip it).' },
      { type: 'fix', text: 'Autocannon transforms stack visibly: Flak bursts flash orange, Ricochet bolts glow gold and carry the flak burst with them.' },
      { type: 'balance', text: 'Sentry Turrets recharge twice as fast (2.5 s per turret).' }
    ]
  },
  {
    version: '0.18.1',
    date: '2026-10-18',
    title: 'Weapon Tune-Up',
    notes: [
      { type: 'balance', text: 'Swarm Missiles lock targets within about half a screen and no longer chase across the whole view. Each missile picks its own enemy.' },
      { type: 'fix', text: 'Swarm Missiles burst on asteroids instead of flying over them, and missiles caught in a blast go off with it.' },
      { type: 'fix', text: 'Swarm Missiles are orange-gold again and turn pink with Storm Protocol (it was the other way round).' },
      { type: 'balance', text: 'Tesla Arc, Sentry Turret and Escort Drones reach 40% further. Proximity Mine blasts are smaller (they were doubled by mistake).' },
      { type: 'new', text: 'You carry 3 Sentry Turrets: standing still you plant them all at once, on the move one at a time. New card: Sentry Turret Count.' }
    ]
  },
  {
    version: '0.18.0',
    date: '2026-10-18',
    title: 'Plasma Grenades',
    notes: [
      { type: 'new', text: 'New weapon: Plasma Grenades. Lobbed at nearby enemies, they land, blink for a moment and blow up in a wide blast.' },
      { type: 'new', text: 'Grenades take on the element of your damage cards: Thermite burns, Cryo freezes, Nanite corrodes. Every card you own applies to them.' },
      { type: 'new', text: 'Grenade Breakthroughs: Cluster Grenades (split on landing), Lingering Cloud (an elemental cloud) and Gravity Grenade (drags enemies in, then blasts).' },
      { type: 'new', text: 'New evolution: EMP Grenades (Plasma Grenades + Tesla Arc). Every blast arcs lightning into nearby enemies.' }
    ]
  },
  {
    version: '0.17.1',
    date: '2026-10-18',
    title: 'Autocannon',
    notes: [
      { type: 'new', text: 'Pew Pews is now called the Autocannon. Same gun, same upgrades.' },
      { type: 'new', text: 'Wing Rockets fire where you aim (mouse, right stick or auto-aim), like the Autocannon, instead of where the ship is flying.' }
    ]
  },
  {
    version: '0.17.0',
    date: '2026-10-18',
    title: 'Breakthroughs',
    notes: [
      { type: 'new', text: 'Every weapon now levels from LV 1 to LV 12, Pew Pews included. Each weapon card raises ONE stat and nothing else, and the card shows exactly that stat.' },
      { type: 'new', text: 'New weapon cards: damage cards for every weapon, Vortex Core Size and Lifetime, Orbit Blade Size, Proximity Mine Fuse, and more.' },
      { type: 'new', text: 'BREAKTHROUGHS at weapon LV 4, 8 and 12: pick a transform that changes how the weapon works (flak rounds, twin singularities...) or +18% damage and reach.' },
      { type: 'balance', text: 'Damage, fire rate and count cards add damage. Size, reach and pull cards add none: they make the weapon easier to land instead. Weapons built for damage are equally strong.' },
      { type: 'balance', text: 'Enemy health climbs more slowly per wave to match the new cards. Missiles and Mines are no longer far ahead of other weapons.' },
      { type: 'new', text: 'The pause-menu loadout shows every weapon\'s level (Pew Pews too) and its Breakthroughs, and the Field Guide explains weapon levels.' }
    ]
  },
  {
    version: '0.16.2',
    date: '2026-10-18',
    title: 'Grand Entrances',
    notes: [
      { type: 'new', text: 'Lieutenants and bosses now arrive on screen, away from your ship: space folds in, a rift tears open and they push through with a rising rumble.' },
      { type: 'new', text: 'Elites emerge slowly: they crawl out of the rift and only reach full speed after a moment, so you can size them up.' },
      { type: 'balance', text: 'Ordinary enemies still spawn just off screen.' }
    ]
  },
  {
    version: '0.16.1',
    date: '2026-10-18',
    title: 'Cache Fanfare',
    notes: [
      { type: 'fix', text: 'Opening a supply cache plays a victory fanfare instead of a blast that sounded like taking damage.' },
      { type: 'balance', text: 'Rotary Claw Overclock is much smaller: +12% mining speed per level (was +50%, plus reach and claw size). One lucky roll no longer turns asteroids into paper.' }
    ]
  },
  {
    version: '0.16.0',
    date: '2026-10-18',
    title: 'Banish',
    notes: [
      { type: 'new', text: 'BANISH a level-up card for 30 gold: it never comes up again this run, and a fresh card takes its slot.' },
      { type: 'new', text: 'Banishing takes two presses so it cannot happen by accident: click the ✕ twice, press B then 1-3, or RB twice on a controller.' }
    ]
  },
  {
    version: '0.15.1',
    date: '2026-10-18',
    title: 'The Swarm Is Back',
    notes: [
      { type: 'balance', text: 'Enemy packs arrive as often and as large as they did before 0.13, so the arena is crowded again.' },
      { type: 'balance', text: 'Light swarm enemies (swarmers, pinwheels, weavers and splitter fragments) are back to their old HP. Only the tougher hulls keep the extra early health.' }
    ]
  },
  {
    version: '0.15.0',
    date: '2026-10-18',
    title: 'Void Armory Rebuilt',
    notes: [
      { type: 'new', text: 'The Void Armory now has 20 permanent upgrades across Offense, Defense, Mobility, Economy and Utility. Each one improves a single stat.' },
      { type: 'balance', text: 'Upgrades are smaller per rank but go much further (up to 40 ranks), and every rank costs a bit more than the last. It is a long grind now.' },
      { type: 'balance', text: "Everyone's armory ranks and Void Cores have been reset. Your callsign, high scores and Field Guide progress are kept." },
      { type: 'new', text: 'New armory stats include crit chance and damage, area size, damage reduction, dash cooldown, gold gain, starting gold and cheaper rerolls.' },
      { type: 'fix', text: "Cleared the developer's test scores from the global leaderboard." }
    ]
  },
  {
    version: '0.14.0',
    date: '2026-10-18',
    title: 'Run Report',
    notes: [
      { type: 'new', text: 'RUN REPORT on the game-over screen: how much of your damage each weapon dealt (with its DPS), which enemies hurt you most and what landed the final blow.' },
      { type: 'new', text: 'Runs now send anonymous stats (weapons, enemies, cards; never your callsign) so we can spot weapons that need a buff or a nerf. Runs under 20 seconds are not sent.' },
      { type: 'new', text: 'Two checkboxes under your callsign, both on by default: post your runs to the public GLOBAL leaderboard, and share anonymous session stats.' },
      { type: 'new', text: 'Uncheck either one any time and your choice is remembered. Anonymous stats can also be switched in the pause menu.' }
    ]
  },
  {
    version: '0.13.0',
    date: '2026-10-18',
    title: 'The Long Run',
    notes: [
      { type: 'balance', text: 'Runs are paced for the long haul: a strong run now lasts around 30 minutes and climbs past level 50, instead of hitting a wall around wave 30.' },
      { type: 'balance', text: 'Enemies are about 2.5× tougher from the start but come in fewer, smaller packs, so burn, chill and corrosion have time to work.' },
      { type: 'balance', text: 'Contact and plasma orb hits start at half damage and only ramp up from wave 15, more gently than before.' },
      { type: 'balance', text: 'Late waves still get much tougher, so every run ends eventually. Bosses grow more slowly than before.' },
      { type: 'balance', text: 'NEW WEAPON cards depend on how many weapons you carry: 80% of hands with one (and never two hands in a row without), then 70%, 60%, 40% and 30%.' },
      { type: 'balance', text: 'Levels after 20 need more XP, and much more after 40, so upgrades keep coming through a long run.' }
    ]
  },
  {
    version: '0.12.2',
    date: '2026-10-18',
    title: 'Scores Fixed',
    notes: [
      { type: 'fix', text: 'Fixed runs not reaching the GLOBAL board after you had moved a volume slider. Your volume is kept; everything else resets to the current balance.' },
      { type: 'fix', text: 'Balance updates now reach every player. Before, an old saved copy of the settings could keep you on outdated numbers.' }
    ]
  },
  {
    version: '0.12.1',
    date: '2026-10-18',
    title: 'Bigger Mine Blasts',
    notes: [
      { type: 'balance', text: 'Proximity Mines blast twice as wide. They are hard to place, so each one now catches a much bigger crowd.' }
    ]
  },
  {
    version: '0.12.0',
    date: '2026-10-17',
    title: 'Gold, Rerolls & Locks',
    notes: [
      { type: 'new', text: 'Gold veins now drop gold coins instead of XP: a run currency that starts at 0 each run, shown next to your Void Cores.' },
      { type: 'new', text: 'REROLL a level-up hand with gold ([R] or X): 20 gold, then 40, 80 and so on in the same level-up, back to 20 on the next one.' },
      { type: 'new', text: 'LOCK a card for 5 gold (Shift+1-3 or Y): it stays through rerolls, and if you pick another card it comes back in your next level-up.' },
      { type: 'balance', text: 'Asteroid fields are made of about twice as many smaller rocks, covering about the same space. More gold veins to find, and each rock drills faster.' },
      { type: 'balance', text: 'Each gold vein holds 2 gold. Mine gold veins regularly and you can reroll about every 4 level-ups and lock cards often.' }
    ]
  },
  {
    version: '0.11.2',
    date: '2026-10-17',
    title: 'Vortex Nerf & Clearer Evolutions',
    notes: [
      { type: 'balance', text: 'Vortex Singularity is still brutal at its core, but its pull fades hard toward the rim and its collapse deals only a quarter damage at the edge.' },
      { type: 'fix', text: 'Evolution cards now say exactly which weapon they upgrade (EVOLUTION · PEW PEWS) and that they are not a new weapon.' },
      { type: 'fix', text: 'Pulsar Helix (a Pew Pews evolution) is now easy to see: big magenta bolts spin out of your ship with every Pew Pews shot.' },
      { type: 'fix', text: 'Swarm Missiles got a new yellow color so their cards no longer look like evolutions.' },
      { type: 'new', text: 'The Field Guide splits WEAPONS (your starting kit and every weapon you can equip) from UPGRADES (all other cards, evolutions and tags).' }
    ]
  },
  {
    version: '0.11.1',
    date: '2026-10-17',
    title: 'Pew Pews Only',
    notes: [
      { type: 'balance', text: 'You now launch with just the Pew Pews. Wing Rockets moved into the NEW WEAPON pool with every other weapon.' }
    ]
  },
  {
    version: '0.11.0',
    date: '2026-10-17',
    title: 'Elites Grind Through Asteroids',
    notes: [
      { type: 'new', text: 'Lieutenants and bosses no longer get stuck on asteroids: they plow straight at you and grind through any rock in their way, with sparks and a low scrape.' },
      { type: 'balance', text: 'Elites mine at your base drill speed (75 per second), never boosted by your drill upgrades, so a big rock still holds them for a moment.' },
      { type: 'new', text: 'Rock an elite breaks drops its normal ore for you to grab: geoms, gold and deep cores. A shield crystal it crushes heals no one.' }
    ]
  },
  {
    version: '0.10.1',
    date: '2026-10-17',
    title: 'One Board For Everyone',
    notes: [
      { type: 'fix', text: 'The GLOBAL leaderboard no longer starts over with each update. It is one shared board, and every score shows the version it was set on.' },
      { type: 'new', text: 'The VERSION buttons under the board still let you filter it to a single version.' },
      { type: 'fix', text: 'Game over shows your rank on the shared board, next to the version you flew.' }
    ]
  },
  {
    version: '0.10.0',
    date: '2026-10-17',
    title: 'Off-Screen Spawns & Stronger Vortexes',
    notes: [
      { type: 'balance', text: 'Enemies now arrive from just off the edge of the screen, mostly ahead of where you are flying, instead of popping in on top of you.' },
      { type: 'balance', text: 'Nothing can spawn within 260 px of your ship. Anything that has to appear on screen gets a longer, clearer warning first.' },
      { type: 'balance', text: 'Enemies chase you from anywhere on the map, steer around asteroids instead of getting stuck, and speed up to catch you when far behind.' },
      { type: 'balance', text: 'Lieutenants move about 35% faster (still slower than your ship).' },
      { type: 'balance', text: 'Vortexes pull harder: 50% of your thrust at the edge, rising to 75% at half the distance to the core. Holding away always escapes.' }
    ]
  },
  {
    version: '0.9.0',
    date: '2026-10-17',
    title: 'Patch Notes & Versioned Leaderboard',
    notes: [
      { type: 'new', text: 'The game now has a version number, shown on the title, pause and game-over screens.' },
      { type: 'new', text: 'PATCH NOTES on the title screen and pause menu list every change, newest first.' },
      { type: 'new', text: 'The global leaderboard is split by game version, so every balance patch starts a fresh race. Switch between this version, earlier ones and ALL-TIME.' },
      { type: 'new', text: 'ALL-TIME shows the version of every run. Runs from before versions existed are marked pre-0.9.' },
      { type: 'new', text: 'Game over shows your rank together with the version you flew, e.g. GLOBAL RANK #4 · v0.9.0.' }
    ]
  },
  {
    version: '0.8.1',
    date: '2026-10-17',
    title: 'Drone Tune',
    notes: [
      { type: 'balance', text: 'Escort Drones fire 4× faster (same damage output: each bolt hits for a quarter as much).' }
    ]
  },
  {
    version: '0.8.0',
    date: '2026-10-17',
    title: 'Global Leaderboard',
    notes: [
      { type: 'new', text: 'Shared GLOBAL leaderboard: every finished run is sent automatically under your pilot callsign.' },
      { type: 'new', text: 'Game over shows your GLOBAL RANK, and your own runs are highlighted on the board.' },
      { type: 'new', text: 'MY RUNS shows your best runs on this device. Offline, the board falls back to them and never blocks play.' },
      { type: 'fix', text: 'Impossible scores, offensive callsigns and spam are kept off the board.' }
    ]
  },
  {
    version: '0.7.0',
    date: '2026-10-17',
    title: 'Weapon Feel',
    notes: [
      { type: 'new', text: 'Much more visible weapon effects: thick crackling Tesla Arc bolts, glowing missile trails and blasts, rocket and blade flashes.' },
      { type: 'new', text: 'New weapon sounds: arc zaps, missile launches, explosions, drone blips, blade grinding and more.' },
      { type: 'balance', text: 'Volatile Shatter is now a passive: it no longer takes a weapon slot.' },
      { type: 'balance', text: 'Swarm Missiles fire salvos 25% more often (same damage output).' },
      { type: 'balance', text: 'Sentry Turret is twice as big and fires twice as fast (same damage output).' },
      { type: 'fix', text: 'Turret shots now hit enemies right next to the turret.' },
      { type: 'fix', text: 'The developer tuning panel is hidden from players.' }
    ]
  },
  {
    version: '0.6.0',
    date: '2026-10-17',
    title: 'Loadout & Field Guide',
    notes: [
      { type: 'new', text: 'Weapon loadout with 6 slots. New weapons come from NEW WEAPON cards; discard one from the pause menu to free a slot.' },
      { type: 'new', text: 'You start with Pew Pews and Wing Rockets, and every weapon now levels up to LV 8.' },
      { type: 'new', text: 'FIELD GUIDE [G]: each enemy unlocks a file the first time you meet it, with a live preview, stats and tips. Mechanics and weapons are in there too.' },
      { type: 'balance', text: 'Faster leveling: each level needs less XP than before.' },
      { type: 'balance', text: 'Wing Rockets level up like other weapons: up to 6 rockets and bigger blasts.' },
      { type: 'fix', text: 'Trying to discard your last weapon now explains why you can\'t.' }
    ]
  },
  {
    version: '0.5.0',
    date: '2026-10-17',
    title: 'Prism & Rockets',
    notes: [
      { type: 'new', text: 'New starting weapon, Wing Rockets: your wings launch rockets in the direction you fly, separate from your turret aim.' },
      { type: 'balance', text: 'Prism Split adds parallel streams in fixed positions instead of widening a fan, so your forward shots stay on target.' }
    ]
  },
  {
    version: '0.4.0',
    date: '2026-10-16',
    title: 'Arsenal & New Hostiles',
    notes: [
      { type: 'new', text: 'Five new enemies: Bruiser, Gunner, Aegis Shielder, Blinker and Conduit, plus a named Lieutenant elite every wave.' },
      { type: 'new', text: 'Deployables: Proximity Mines, Sentry Turret and Escort Drones. Mines + Turret unlock Siege Battery.' },
      { type: 'new', text: 'Critical hits, and Burn, Chill and Corrode damage types.' },
      { type: 'balance', text: 'Card rarity is now the level jump you rolled: +1 common up to +5 legendary.' },
      { type: 'balance', text: 'Every weapon deals the same potential damage per second at the same level.' },
      { type: 'balance', text: 'Blasts hit softer at the edge, Phase Piercer loses damage per enemy pierced, Orbit Blades are bigger, Prism Split is tighter.' }
    ]
  },
  {
    version: '0.3.0',
    date: '2026-10-16',
    title: 'Readable Combat',
    notes: [
      { type: 'new', text: 'Floating damage numbers (toggle with [N] or in the pause menu), hit knockback and bigger kill effects for tougher enemies.' },
      { type: 'new', text: 'Boss fights are events: a 3-second warning, an entrance, health bars and a defeat payoff.' },
      { type: 'new', text: 'Upgrade cards show exact before → after stats and the level you will reach.' },
      { type: 'balance', text: 'Gravity wells really pull now: they tug your ship (you can always escape), bend shots and drag in pickups.' },
      { type: 'balance', text: 'Vortex Singularity bunches enemies up, then collapses for a big damage pulse.' },
      { type: 'fix', text: 'Enemy black holes are now called Vortexes, and missile levels show Storm Protocol\'s +1.' }
    ]
  },
  {
    version: '0.2.0',
    date: '2026-10-16',
    title: 'VEXOLITH',
    notes: [
      { type: 'new', text: 'The game is now VEXOLITH // SURVIVOR, playable online in the browser.' },
      { type: 'new', text: 'Full controller support: fly, aim, dash, Supernova and every menu with a gamepad.' },
      { type: 'new', text: 'Your shield hugs the ship\'s outline and is your hitbox; its glowing arc shows how much is left.' },
      { type: 'fix', text: 'Enemies and rocks no longer spawn on top of you or outside the arena.' },
      { type: 'fix', text: 'Score multiplier no longer loses fractions; Storm Protocol lightning starts from your ship.' }
    ]
  },
  {
    version: '0.1.0',
    date: '2026-10-16',
    title: 'First Flight',
    notes: [
      { type: 'new', text: 'Pilot a crab-shaped gunship through endless waves of geometric swarms, with a boss every 3 waves.' },
      { type: 'new', text: 'Drill through asteroids with your claws to dig out XP, shield crystals and Void Cores.' },
      { type: 'new', text: 'Level up to pick upgrades; lucky rolls jump several levels and supply caches hand out free upgrades.' },
      { type: 'new', text: 'Spend Void Cores in the Void Armory on permanent ship upgrades. Local highscore board with your callsign.' }
    ]
  }
]);

export const KNOWN_VERSIONS = Object.freeze(CHANGELOG.map(entry => entry.version));

export function changelogEntry(version) {
  return CHANGELOG.find(entry => entry.version === version) || null;
}
