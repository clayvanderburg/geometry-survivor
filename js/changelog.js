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
    version: '0.17.0',
    date: '2026-10-18',
    title: 'Breakthroughs',
    notes: [
      { type: 'new', text: 'Every weapon now levels from LV 1 to LV 12, Pew Pews included. Each weapon card raises ONE stat and nothing else, and the card shows exactly that stat.' },
      { type: 'new', text: 'New weapon cards: damage cards for every weapon, Vortex Core Size and Lifetime, Orbit Blade Size, Proximity Mine Fuse, and more.' },
      { type: 'new', text: 'BREAKTHROUGHS at weapon LV 4, 8 and 12: pick a transform that changes how the weapon works (flak rounds, twin singularities, seeker mines...) or +1 to all its stats.' },
      { type: 'balance', text: 'Damage, fire rate and count cards add damage. Size, reach and pull cards add none: they make the weapon easier to land instead. Weapons built for damage are equally strong.' },
      { type: 'new', text: 'The pause-menu loadout lists each weapon\'s Breakthroughs, and the Field Guide explains weapon levels.' }
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
