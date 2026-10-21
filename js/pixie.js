// DR. PIXIE: Astra R&D's resident genius pops up on the radio (js/radio.js) for every Breakthrough. On
// the R&D pick screen she cheers the discovery ("EUREKA!", sparkle eyes and a flourish); once you pick,
// she reacts to the choice. Her lines never block input or slow the pick: the radio box is see-through
// to clicks and the pick works the instant the screen opens.
//
// Lines are short (≤ 60 characters), PG, nerdy mad science with an 80s streak. Each pool is a per-run
// shuffle bag, so no line repeats until the pool runs dry, and never twice in a row. A line is
// [text, mood]; {weapon} and {name} fill in the weapon and the Breakthrough's name.
import { TRANSFORMS, BOOST_NAME } from './weapon-levels.js';
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
  quake: [['Quake Mortar! I felt that in my coffee.', 'smug']]
});

// After the pick: Breakthrough-specific reactions ("weapon:transform id").
export const PIXIE_PICK_LINES = Object.freeze({
  'turret:capacity': ['Extra Capacity! More turrets, more waivers!', 'eureka'],
  'missiles:nuke': ['A tactical nuke! For SCIENCE. Mostly science.', 'oops'],
  'singularity:twin': ['TWO black holes? I\'ll update the insurance.', 'oops'],
  'blaster:ricochet': ['Ricochet Rounds! Geometry is on OUR side now!', 'smug'],
  'rockets:mirv': ['MIRV Rockets! Rockets that make rockets!', 'eureka'],
  'drones:wingman': ['Another wingman! I\'ll knit it a tiny scarf.', 'eureka'],
  'lightning:strike': ['Thunderstrike! I cleared the forecast myself.', 'smug'],
  'orbitals:fling': ['Blade Fling! Keep your fingers inside the ship.', 'oops'],
  'flamethrower:ring': ['Inferno Ring! Fire, but in a circle. Elegant.', 'smug'],
  'cryospray:blizzard': ['Blizzard Ring! Bring a sweater, Jack.', 'eureka'],
  'grenades:gravity': ['Gravity Grenades! Newton is spinning. Literally.', 'smug'],
  'mines:seeker': ['Seeker Mines! They\'re SO excited to meet them.', 'eureka']
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

// Picks Dr. Pixie's lines and puts them on the radio. `radio` takes { who, text, mood, onStart, cut };
// `sound` plays the Eureka flourish.
export class PixieDirector {
  constructor({ radio = null, sound = null, rng = Math.random } = {}) {
    this.radio = radio;
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

  // The player chose `pick` ({ weaponId, level, kind: 'transform' | 'boost' }).
  pickLine(pick) {
    if (pick.kind === 'boost') {
      const line = this.boostBag.next();
      return { who: 'pixie', text: fillLine(line[0], { name: BOOST_NAME }), mood: line[1] };
    }
    const tf = TRANSFORMS[pick.weaponId]?.[pick.level];
    const line = (tf && PIXIE_PICK_LINES[`${pick.weaponId}:${tf.id}`]) || this.transformBag.next();
    return { who: 'pixie', text: fillLine(line[0], { name: tf?.name || 'It' }), mood: line[1] };
  }

  offer(weaponId, weaponName) {
    const line = this.offerLine(weaponId, weaponName);
    // She stays up beside the cards until the pick (picked() cuts her short); no rush to read.
    this.radio?.say({ ...line, hold: 600, onStart: () => { if (!isReduceEffects()) this.sound?.playEureka?.(); } }); // REDUCE EFFECTS skips the chime
    return line;
  }

  // Cuts her discovery line short (the player already chose) and queues the reaction.
  picked(pick) {
    const line = this.pickLine(pick);
    this.radio?.say({ ...line, cut: true });
    return line;
  }
}
