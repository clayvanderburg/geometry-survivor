// DR. PIXIE: Astra R&D's resident genius pops up on the radio (js/radio.js) for every Breakthrough. On
// the R&D pick screen she cheers the discovery ("EUREKA!", sparkle eyes and a flourish); once you pick,
// she reacts to the choice. Her lines never block input or slow the pick: the radio box is see-through
// to clicks and the pick works the instant the screen opens.
//
// Lines are short (≤ 60 characters), PG, nerdy mad science with an 80s streak. Each pool is a per-run
// shuffle bag, so no line repeats until the pool runs dry, and never twice in a row. A line is
// [text, mood]; {weapon} and {name} fill in the weapon and the Breakthrough's name.
import { BT_FLATS, btOption } from './weapon-levels.js';
import { isReduceEffects } from './juice.js';

export const PIXIE_MAX_CHARS = 60;

// On the Breakthrough pick: the discovery.
export const PIXIE_OFFER_LINES = Object.freeze([
  ['EUREKA! Hypothesis: CONFIRMED!', 'eureka'],
  ['The numbers checked out… mostly!', 'eureka'],
  ['I ran the math twice. Okay, once. It\'s GREAT!', 'eureka'],
  ['It works! Nobody tell the safety committee.', 'eureka'],
  ['Science! Pick one before it melts the lab!', 'eureka'],
  ['My calculations say: AWESOME. Error bars: also awesome.', 'eureka'],
  ['We did it! I mean, I did it. You helped!', 'smug'],
  ['Peer review? You ARE the peer review. Choose!', 'eureka'],
  ['Forty hours, no sleep, and it WORKS!', 'eureka'],
  ['Two prototypes! Zero lab fires! New record!', 'eureka'],
  ['Eureka! …Wait, did I already say eureka today?', 'oops'],
  ['Ooh, it hums! Things that hum are usually fine!', 'eureka'],
  ['The formula\'s perfect. I checked it on a sticky note.', 'smug'],
  ['This is either genius or a fire hazard. Both?', 'oops'],
  ['The goggles are for show. The SCIENCE is real!', 'eureka'],
  ['Fresh off the fabricator, still warm! Pick one!', 'eureka'],
  ['Field data says your {weapon} is HAPPY!', 'eureka'],
  ['Breakthrough! Somebody get me a juice box!', 'eureka'],
  ['It\'s not a bug, it\'s a FEATURE. Probably.', 'oops'],
  ['According to my calculations… WOW!', 'eureka'],
  ['I reversed the polarity! I don\'t know what that means!', 'oops'],
  ['Lab notebook, entry 9,001: IT WORKS!', 'eureka'],
  ['Look, Jack! Upgrades! Shiny, dangerous upgrades!', 'eureka'],
  ['Coffee: six cups. Explosions: zero. Breakthroughs: one!', 'eureka'],
  ['Safety goggles: ON. Fun: ON. Let\'s do science!', 'eureka'],
  ['The simulation crashed. From pure AWESOMENESS.', 'smug'],
  ['I can\'t believe that worked! I mean… of course it did.', 'smug'],
  ['The data came back beautiful. Sniff. I\'m fine.', 'eureka'],
  ['New tech, hot off the whiteboard! Choose wisely!', 'eureka'],
  ['Q.E.D., baby! Pick your prototype!', 'smug'],
  ['Hold still, I\'m about to be brilliant at you.', 'smug'],
  ['Theory said impossible. Theory was WRONG!', 'eureka'],
  ['Totally radical results! That\'s the technical term.', 'eureka'],
  ['I fixed your {weapon} with a paperclip!', 'smug']
]);

// Sometimes the discovery is about the weapon itself.
export const PIXIE_WEAPON_LINES = Object.freeze({
  blaster: [['Your Autocannon\'s been working out. Look at it!', 'eureka']],
  rockets: [['More rockets? In THIS economy? Yes!', 'eureka']],
  missiles: [['The missiles formed a union. Their demand: MORE.', 'smug']],
  lightning: [['Tesla would be SO jealous right now.', 'smug']],
  singularity: [['I bottled a black hole. Do NOT shake it.', 'oops']],
  orbitals: [['Spinny blades, now spinnier! Science!', 'eureka']],
  mines: [['Mines! Just… don\'t step on the prototype.', 'oops']],
  turret: [['Your turret asked for a raise. I said yes!', 'eureka']],
  drones: [['The drones keep calling me "Mom." It\'s fine.', 'oops']],
  grenades: [['Grenades! Pull pin, throw, do a little dance!', 'eureka']],
  gas: [['Smells terrible! Works great! Classic chemistry.', 'eureka']],
  flamethrower: [['Hot take: MORE FIRE.', 'smug']],
  cryospray: [['Chill out. No really, it\'s a freeze ray now.', 'smug']],
  acidspray: [['Acid! Wear gloves. Maybe two pairs.', 'oops']],
  shockfield: [['Your shield zaps things now. It LIKES it.', 'eureka']],
  raillance: [['The Rail Lance goes through ROCK now. Oops?', 'oops']],
  glaive: [['Frisbees of DOOM. Patent pending!', 'smug']],
  nanites: [['The nanites ate my lunch. Promising!', 'eureka']],
  harpoon: [['Your claw has a leash now. Good claw!', 'eureka']],
  quake: [['Graviton Mortar! Space-time just hiccuped.', 'smug']]
});

// After the pick: Breakthrough-specific reactions ("weapon:transform id").
export const PIXIE_PICK_LINES = Object.freeze({
  'turret:capacity': ['Extra Capacity! More turrets, more waivers!', 'eureka'],
  'missiles:nuke': ['A tactical nuke! For SCIENCE. Mostly science.', 'oops'],
  'singularity:twin': ['TWO black holes? I\'ll update the insurance.', 'oops'],
  'blaster:ricochet': ['Ricochet Rounds! Geometry is on OUR side now!', 'smug'],
  'rockets:mirv': ['MIRV Rockets! Rockets that make rockets!', 'eureka'],
  'drones:wingman': ['A whole squadron! I\'ll knit them tiny scarves.', 'eureka'],
  'lightning:strike': ['Thunderstrike! I cleared the forecast myself.', 'smug'],
  'orbitals:fling': ['Blade Fling! Keep your fingers inside the ship.', 'oops'],
  'flamethrower:ring': ['Inferno Ring! Fire, but in a circle. Elegant.', 'smug'],
  'cryospray:blizzard': ['Blizzard Ring! Bring a sweater, Jack.', 'eureka'],
  'grenades:gravity': ['Gravity Grenades! Newton is spinning. Literally.', 'smug'],
  'mines:seeker': ['Seeker Mines! They\'re SO excited to meet them.', 'eureka'],
  // Pool transforms (EXTRA_TRANSFORMS): every one has its own line (tests/breakthrough-pools.test.js).
  'blaster:slug': ['Tracer Slugs! Every fourth shot is a BIG one. I counted.', 'smug'],
  'blaster:hotbarrel': ['Hot Barrel! Don\'t touch it. Seriously, don\'t.', 'oops'],
  'rockets:shrapnel': ['Shrapnel Shells! Pointy bits, everywhere, on purpose!', 'eureka'],
  'rockets:thunder': ['Rolling Thunder! Ba-boom-boom-BOOM. That\'s the science.', 'smug'],
  'missiles:hunter': ['Hunter-Killer! The missiles have missiles now!', 'eureka'],
  'missiles:echo': ['Echo Salvo! I fired it once and the universe said it back.', 'eureka'],
  'raillance:static': ['Static Charge! Don\'t pet the enemies. Or do!', 'smug'],
  'raillance:reflect': ['Reflector Rail! The screen edge is a mirror now. Oops.', 'oops'],
  'drones:overdrive': ['Overdrive Sync! They practiced in formation. All night.', 'eureka'],
  'drones:kamikaze': ['Kamikaze Wing! Don\'t worry, I build them in bulk.', 'oops'],
  'turret:gift': ['Parting Gift! Turrets that go out with a BANG.', 'smug'],
  'turret:link': ['Overwatch Link! Turrets holding hands. Zappy hands!', 'eureka'],
  'glaive:shatter': ['Shatter Edge! The frisbees explode now. You\'re welcome.', 'smug'],
  'glaive:arcdisc': ['Arc Discs! Spinning AND sparking. Peak engineering.', 'eureka'],
  'harpoon:whip': ['Whip Tether! I learned it from a space cowboy.', 'smug'],
  'harpoon:tesla': ['Tesla Hook! The claw bites AND zaps!', 'eureka'],
  'quake:crush': ['Crush Field! Gravity, but rude about it.', 'smug'],
  'quake:lens': ['Gravity Lens! Everything wants to be near the boom.', 'eureka'],
  'grenades:sticky': ['Sticky Plasma! Do NOT shake hands with it.', 'oops'],
  'grenades:geyser': ['Plasma Geyser! Boom, boom, and one more boom.', 'smug'],
  'mines:shock': ['Shock Mines! Stunned AND exploded. Efficient!', 'smug'],
  'mines:napalm': ['Napalm Mines! The floor is lava. On purpose.', 'eureka'],
  'orbitals:frenzy': ['Blade Frenzy! They get sharper the more they cut!', 'eureka'],
  'orbitals:vortex': ['Vortex Ring! Come closer. Closer. Into the blades.', 'smug'],
  'singularity:accretion': ['Accretion Disk! The black hole throws things now!', 'eureka'],
  'singularity:whitehole': ['White Hole! What goes in must come out. LOUDLY.', 'oops'],
  'nanites:needles': ['Nano Needles! Tiny robots, tinier harpoons.', 'smug'],
  'nanites:ravenous': ['Ravenous Swarm! Don\'t feed them after midnight.', 'oops'],
  'shockfield:pulse': ['Pulse Wave! The field reaches out and touches someone.', 'smug'],
  'shockfield:capacitor': ['Capacitor Bank! Zap, and then ZAP again.', 'eureka'],
  'gas:tendrils': ['Toxic Tendrils! The gas has arms now. Gross. Great!', 'eureka'],
  'gas:spores': ['Spore Burst! Pop goes the cloud.', 'smug']
});

// After the pick: any other transform, and Across the Board.
export const PIXIE_TRANSFORM_LINES = Object.freeze([
  ['{name}! Great pick. I designed it, so…', 'smug'],
  ['Fabricating {name}… done! It\'s hot!', 'eureka'],
  ['{name}! I\'m writing a paper about this.', 'eureka'],
  ['Installing {name}. Results may vary. Wildly.', 'oops'],
  ['{name}, installed! That spark? Normal.', 'oops'],
  ['{name}! Hypothesis: you\'re gonna love it.', 'smug']
]);
export const PIXIE_BOOST_LINES = Object.freeze([
  ['Across the Board! The scientific method: MORE.', 'smug'],
  ['Classic. Bigger numbers never go out of style.', 'smug'],
  ['Boring? Maybe. Effective? EXTREMELY.', 'neutral'],
  ['A bit of everything! Like a lab buffet.', 'eureka'],
  ['Turned every dial up one notch. You\'re welcome!', 'smug']
]);

// Flats with their own reactions (Across the Board uses PIXIE_BOOST_LINES).
export const PIXIE_FLAT_LINES = Object.freeze({
  overtuned: Object.freeze([
    ['Overtuned Core! I removed the safety limiter. And the label.', 'oops'],
    ['Hotter core, bigger hits. Simple science!', 'smug'],
    ['It\'s glowing a color I haven\'t named yet. Overtuned!', 'eureka']
  ])
});

export const fillLine = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// A per-run shuffle bag: every line once before any repeats, and never the same line twice in a row.
export class LineBag {
  constructor(lines, rng = Math.random) {
    this.lines = lines;
    this.rng = rng;
    this.bag = [];
    this.last = null;
  }

  next() {
    if (!this.lines.length) return null;
    if (!this.bag.length) {
      this.bag = this.lines.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      // The refill's first line must not be the line just played.
      if (this.bag.length > 1 && this.bag[this.bag.length - 1] === this.last) this.bag.unshift(this.bag.pop());
    }
    return (this.last = this.bag.pop());
  }
}

// The first space-time rift of a save: she explains it's a GOOD thing (a shortcut), then celebrates the
// first jump through one. Each plays once per save (localStorage), never in BLITZ (no story there).
export const PIXIE_RIFT_LINES = Object.freeze([
  ['WHOA, a space-time rift! Don\'t panic, it\'s GOOD!', 'eureka'],
  ['It\'s a shortcut! Fly in and it flings you far away!', 'eureka'],
  ['You\'re safe mid-jump, I promise. And I get DATA!', 'smug']
]);
export const PIXIE_RIFT_JUMP_LINE = Object.freeze(['Data acquired! You\'re fine! Probably!', 'oops']);
// The first time a save's shield drops to 30%: back off, then go find a green vein to patch it.
export const PIXIE_LOW_SHIELD_LINES = Object.freeze([
  ['Eek! Your shield is down to 30%!', 'oops'],
  ['Back off and dodge for a bit, okay?', 'neutral'],
  ['Green veins in the rocks patch it up fast!', 'eureka']
]);
// The first boss of every run: she plugs the Supernova bombs she installed (replaces the banner).
// "{key}" = the bomb button (E, B or TAP NOVA).
export const PIXIE_NOVA_LINES = Object.freeze([
  ['Big one! Try my new SUPERNOVA bombs! Press {key}!', 'eureka'],
  ['I installed SUPERNOVA bombs! Hit {key} on that boss!', 'smug'],
  ['Boss! Bombs away! Press {key} for a SUPERNOVA!', 'eureka']
]);
export const PIXIE_LOW_SHIELD_FRACTION = 0.3;
export const PIXIE_LOW_SHIELD_KEY = 'vexolith_pixie_low_shield_seen';
export const PIXIE_RIFT_SEEN_KEY = 'vexolith_pixie_rift_seen';
export const PIXIE_RIFT_JUMP_KEY = 'vexolith_pixie_rift_jump_seen';
const seen = (storage, key) => { try { return !!storage?.getItem(key); } catch { return false; } };
const markSeen = (storage, key) => { try { storage?.setItem(key, '1'); } catch { /* blocked: once per page load */ } };
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Picks Dr. Pixie's lines and puts them on the radio. `radio` takes { who, text, mood, onStart, cut };
// `sound` plays the Eureka flourish.
export class PixieDirector {
  constructor({ radio = null, sound = null, rng = Math.random, storage = defaultStorage() } = {}) {
    this.radio = radio;
    this.storage = storage;
    this.told = new Set(); // in memory too, for blocked storage
    this.sound = sound;
    this.rng = rng;
    this.resetRun();
  }

  resetRun() {
    this.offerBag = new LineBag(PIXIE_OFFER_LINES, this.rng);
    this.transformBag = new LineBag(PIXIE_TRANSFORM_LINES, this.rng);
    this.boostBag = new LineBag(PIXIE_BOOST_LINES, this.rng);
    this.weaponUsed = new Set();
  }

  // The Breakthrough pick opened for `weaponId` ("{weapon}" = its name).
  offerLine(weaponId, weaponName) {
    const own = PIXIE_WEAPON_LINES[weaponId];
    let line;
    if (own && !this.weaponUsed.has(weaponId) && this.rng() < 0.4) {
      this.weaponUsed.add(weaponId);
      line = own[0];
    } else {
      line = this.offerBag.next();
    }
    return { who: 'pixie', text: fillLine(line[0], { weapon: weaponName }), mood: line[1] };
  }

  // The player chose `pick` ({ weaponId, level, option }: a transform id or a flat id; `kind` alone, as
  // older callers pass it, means the milestone's home transform or Across the Board). Lines key on the
  // option, so a transform's line plays at whichever milestone it was taken.
  pickLine(pick) {
    const opt = btOption(pick.weaponId, pick.level, pick.option ?? pick.kind);
    if (opt && opt.kind !== 'transform') {
      const own = PIXIE_FLAT_LINES[opt.id];
      const line = own ? own[Math.floor(this.rng() * own.length)] : this.boostBag.next();
      return { who: 'pixie', text: fillLine(line[0], { name: BT_FLATS[opt.id].name }), mood: line[1] };
    }
    const line = (opt && PIXIE_PICK_LINES[`${pick.weaponId}:${opt.id}`]) || this.transformBag.next();
    return { who: 'pixie', text: fillLine(line[0], { name: opt?.name || 'It' }), mood: line[1] };
  }

  offer(weaponId, weaponName) {
    const line = this.offerLine(weaponId, weaponName);
    // She stays up beside the cards until the pick (picked() cuts her short); no rush to read.
    this.radio?.say({ ...line, hold: 600, onStart: () => { if (!isReduceEffects()) this.sound?.playEureka?.(); } }); // REDUCE EFFECTS skips the chime
    return line;
  }

  // A one-time story beat: plays `lines` (first one hurries whatever is on air) unless `key` was seen
  // in this save, the radio is off (headless) or the mode has no story (BLITZ).
  once(key, lines, mode, { after = false } = {}) {
    if (!this.radio || mode === 'blitz' || this.told.has(key) || seen(this.storage, key)) return false;
    this.told.add(key);
    markSeen(this.storage, key);
    const [first, ...rest] = lines.map(([text, mood]) => ({ who: 'pixie', text, mood }));
    if (after) this.radio.append({ ...first, then: rest });
    else this.radio.say({ ...first, cut: true, then: rest });
    return true;
  }

  riftOpened(mode) { return this.once(PIXIE_RIFT_SEEN_KEY, PIXIE_RIFT_LINES, mode); }

  // The first boss of a run: one bomb reminder on the radio. False (the banner shows instead) when the
  // radio is off or the mode has no story (BLITZ).
  novaReminder(mode, key) {
    if (!this.radio || mode === 'blitz') return false;
    const [text, mood] = PIXIE_NOVA_LINES[Math.floor(this.rng() * PIXIE_NOVA_LINES.length)];
    this.radio.say({ who: 'pixie', text: fillLine(text, { key }), mood, cut: true });
    return true;
  }

  // Not in HARDCORE: green veins don't repair there, so the tip waits for a mode where it's true.
  lowShield(mode) { return mode !== 'hardcore' && this.once(PIXIE_LOW_SHIELD_KEY, PIXIE_LOW_SHIELD_LINES, mode); }

  // The first jump: only after she has explained rifts (else it's a non sequitur).
  riftJumped(mode) {
    if (!this.told.has(PIXIE_RIFT_SEEN_KEY) && !seen(this.storage, PIXIE_RIFT_SEEN_KEY)) return false;
    return this.once(PIXIE_RIFT_JUMP_KEY, [PIXIE_RIFT_JUMP_LINE], mode, { after: true }); // after her explanation
  }

  // Cuts her discovery line short (the player already chose) and queues the reaction.
  picked(pick) {
    const line = this.pickLine(pick);
    this.radio?.say({ ...line, cut: true });
    return line;
  }
}
