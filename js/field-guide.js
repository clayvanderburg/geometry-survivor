// Field Guide data: every hostile, the core mechanics and a weapon index, plus encounter detection.
// Pure data and helpers (no DOM): js/field-guide-ui.js renders it and js/field-guide-scenes.js
// animates the hostile previews with the real enemy drawing code.
//
// Hostile entry ids are enemy `type` strings, plus 'lieutenant' (any elite) and 'boss'. Adding a new
// enemy type? Give it an entry here: tests/field-guide.test.js fails until every type has one.
import { TUNING, DEFAULT_TUNING } from './config.js';
import { EnemyManager, contactDamageAt, waveScaleAt, BOSS_NAME } from './enemies.js';
import { ARCHETYPE_INFO, BRUISER, GUNNER, SHIELDER, BLINKER, CONDUIT, bruiserChargeLength } from './archetypes.js';
import { LT_MODIFIERS } from './lieutenants.js';
import { UPGRADE_POOL, RARITY, levelJumpChances, BASE_SHIELD } from './upgrades.js';
import { WEAPON_TAGS, TAG_INFO } from './weapon-scaling.js';
import { playerPullCapShare } from './gravity.js';
import { eliteMiningDps } from './pursuit.js';
import { goldPerVein, rerollCost, weaponRerollCost, lockCost, banishCost } from './gold.js';
import { handSizeFor, slotDamageBonus } from './slot-rewards.js';
import { WEAPONS, PASSIVES, WEAPON_BY_ID, WEAPON_BY_LEVEL_ID, STARTING_WEAPONS, weaponTags, weaponSlots } from './loadout.js';
import { MODES } from './modes.js';

export const GUIDE_GROUPS = [
  { id: 'swarm', label: 'CORE SWARM' },
  { id: 'hazard', label: 'HAZARDS' },
  { id: 'archetype', label: 'COMBAT ARCHETYPES' },
  { id: 'elite', label: 'ELITES' }
];

const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => `${+v.toFixed(2)} s`;

// Elite mining wording (lieutenant and boss entries, mining mechanic); empty when the tuner turns it off.
function eliteGrindSpeed() {
  const mult = TUNING.eliteMiningMult ?? 1;
  const base = Math.abs(mult - 1) < 1e-9 ? 'your base drill speed' : `${+mult.toFixed(2)}× your base drill speed`;
  return `${base} (${Math.round(eliteMiningDps())}/s)`;
}
function eliteGrindText() {
  if (!(eliteMiningDps() > 0)) return '';
  return ` It grinds through asteroids at ${eliteGrindSpeed()}, unaffected by your drill upgrades, instead of going round, and the broken rock drops its ore for you.`;
}

// `what` and `tip` may be functions so their numbers always come from the live constants/TUNING.
export const HOSTILE_ENTRIES = [
  {
    id: 'swarmer', name: 'BOID SWARMER', group: 'swarm', unlockWave: 1,
    what: 'Magenta diamonds that flock: they keep apart, match heading, pull together and swirl in on your ship. Packs grow every wave.',
    tip: 'Fodder that pops on contact. Keep moving and sweep the pack with the blaster; chain lightning and orbit blades shred them.'
  },
  {
    id: 'pinwheel', name: 'PINWHEEL', group: 'swarm', unlockWave: 1,
    what: 'Violet spinning squares that grind straight at you. Slower than swarmers but much tougher.',
    tip: 'Kite them in a wide circle so they bunch up, then let piercing bolts run down the line.'
  },
  {
    id: 'weaver', name: 'EMERALD WEAVER', group: 'swarm', unlockWave: 1,
    what: 'Fast green darts that read incoming fire and sidestep perpendicular to any bolt flying at them.',
    tip: 'Hard to hit head-on. Homing missiles, lightning, orbit blades and blast splash ignore the dodge, or fire a wide Prism spread.'
  },
  {
    id: 'splitter', name: 'SPLITTER', group: 'swarm', unlockWave: 1,
    what: 'Golden hexagons with a spinning inner core. When destroyed they fracture into three fast mini-splitters.',
    tip: 'Kill them away from your ship so the burst has room. Supernova kills do not split.'
  },
  {
    id: 'mini_splitter', name: 'MINI-SPLITTER', group: 'swarm', unlockWave: 1,
    what: 'Triangle fragments thrown out of a dead splitter at speed. Fragile, quick, and they hit lighter than a full hull.',
    tip: 'Expect three of them where a splitter dies: back off a step, then sweep.'
  },
  {
    id: 'blackhole', name: 'VORTEX', group: 'hazard', unlockWave: 1,
    what: () => `A crimson singularity. Inside its ${TUNING.blackholePullRadius ?? 200} px dashed rim it drags enemies, sparks, Geoms and your shots into orbit and tugs your ship. It collapses in a 175 px burst that damages nearby hostiles when it dies.`,
    tip: () => `The tug is ${pct(TUNING.blackholePlayerPullEdge ?? 0.5)} of your thrust at the rim, rising to ${pct(TUNING.blackholePlayerPullInner ?? 0.75)} from ${pct(TUNING.blackholePlayerPullInnerAt ?? 0.5)} of the way in. It never matches your thrust, so holding away always escapes. Kill it near a crowd to use the collapse.`
  },
  {
    id: 'bruiser', name: 'BRUISER', group: 'archetype', unlockWave: ARCHETYPE_INFO.bruiser.unlockWave,
    what: () => `A heavy orange pentagon with a ram. It winds up for ${secs(BRUISER.windup)} on a marked lane (the lane locks for the last 40%), charges about ${Math.round(bruiserChargeLength({ speedScale: 1 }))} px, then vents for ${secs(BRUISER.recover)}. Takes ${pct(BRUISER.knockMult)} knockback and survives ramming you.`,
    tip: 'Sidestep once the lane turns red, then punish it while it vents. Do not stand in front of it.'
  },
  {
    id: 'gunner', name: 'GUNNER', group: 'archetype', unlockWave: ARCHETYPE_INFO.gunner.unlockWave,
    what: () => `A chartreuse cannon that holds about ${GUNNER.range} px away and strafes. After a ${secs(GUNNER.aimTime)} dashed aim line it fires a slow plasma orb (${TUNING.enemyBulletDamage ?? 12} damage at wave 1).`,
    tip: 'Orbs are slower than your ship and stop on asteroids. Step off the aim line, hide behind rock, dash through, or Supernova to wipe them.'
  },
  {
    id: 'shielder', name: 'AEGIS SHIELDER', group: 'archetype', unlockWave: ARCHETYPE_INFO.shielder.unlockWave,
    what: () => `An azure hexagon behind ${SHIELDER.plates} front plates (±${Math.round(SHIELDER.arcHalf * 180 / Math.PI)}°). The plates turn toward you slowly and stop projectiles cold.`,
    tip: 'Circle to its flank or rear faster than the plates can turn, or use area damage: missiles, lightning, orbit blades, singularities, dash nova.'
  },
  {
    id: 'blinker', name: 'BLINKER', group: 'archetype', unlockWave: ARCHETYPE_INFO.blinker.unlockWave,
    what: () => `An orchid star that collapses for ${secs(BLINKER.telegraph)} while a ring marks its landing point, then teleports to your flank (${BLINKER.minDist}–${BLINKER.maxDist} px away, never into rock) and lunges.`,
    tip: 'Watch for the ring and keep moving: the lunge is aimed where you were when it landed.'
  },
  {
    id: 'conduit', name: 'CONDUIT', group: 'archetype', unlockWave: ARCHETYPE_INFO.conduit.unlockWave,
    what: () => `An aqua relay pylon that hangs back about ${CONDUIT.keepAway} px and beam-links up to ${CONDUIT.maxLinks} allies within ${CONDUIT.linkRadius} px: linked hulls take ${pct(CONDUIT.armor)} less damage and move ${pct(CONDUIT.haste)} faster.`,
    tip: 'Kill it first. Follow the beams back to the pylon; its pack goes soft the moment it dies.'
  },
  {
    id: 'lieutenant', name: 'LIEUTENANT', group: 'elite', unlockWave: () => TUNING.lieutenantFirstWave ?? 2,
    what: () => `One elite per non-boss wave, from wave ${TUNING.lieutenantFirstWave ?? 2}: a bigger copy of an unlocked archetype with a generated name, silver rank brackets and ${Math.max(1, Math.round(TUNING.lieutenantMaxMods ?? 2))} modifier${(TUNING.lieutenantMaxMods ?? 2) > 1 ? 's' : ''} at most. HP is ${pct(TUNING.lieutenantHpShare ?? 0.4)} of that wave's boss (×0.85–1.5 by archetype), and it moves ${pct((TUNING.lieutenantSpeedMult ?? 1.35) - 1)} faster than its archetype (never as fast as your ship).${eliteGrindText()}`,
    tip: () => `Worth it: +${Math.round(TUNING.lieutenantCoreReward ?? 1)} Void Core, gold Geoms and 8× score. It survives a Supernova (−40% max HP) and ramming.`,
    modifiers: true
  },
  {
    id: 'boss', name: BOSS_NAME, group: 'elite', unlockWave: 3,
    what: () => `Arrives every 3 waves after a ${secs(TUNING.bossWarningTime ?? 3)} warning: hazard strip, klaxon and a radar ring at the spawn point. A cyan octagon with a gold spike crown and magenta halo; health bars at the top of the screen.${eliteGrindText()}`,
    tip: 'Clear the fodder during the warning, then kite in wide circles. A kill drops a guaranteed Super Relic Cache and a spare Supernova.'
  }
];

export const HOSTILE_IDS = HOSTILE_ENTRIES.map(e => e.id);
const HOSTILE_BY_ID = new Map(HOSTILE_ENTRIES.map(e => [e.id, e]));
export const hostileEntry = (id) => HOSTILE_BY_ID.get(id) || null;

export const resolveText = (v) => (typeof v === 'function' ? v() : v);

// Wave scale used by the game (Game.getWaveScale), so guide stats match the real spawns.
export { waveScaleAt };

let statsManager = null;
// Exact numbers from the real spawn config: HP (with the tuner's HP multiplier), speed in px/s and
// relative to the ship, contact damage, XP and the wave it first appears.
export function hostileStats(id) {
  const entry = hostileEntry(id);
  if (!entry) return null;
  statsManager ||= new EnemyManager({ maxEnemies: 1 });
  const unlockWave = resolveText(entry.unlockWave);
  const wave = id === 'boss' ? 3 : id === 'lieutenant' ? unlockWave : 1;
  const type = id === 'lieutenant' ? 'pinwheel' : id;
  const cfg = statsManager.getArchetype(type, waveScaleAt(wave), id === 'boss' ? { name: BOSS_NAME } : {});
  const hp = cfg.maxHp * (TUNING.enemyHpMult ?? 1);
  const speed = cfg.speed * (type === 'blackhole' ? 1 : (TUNING.enemySpeedMult ?? 1)) * 60;
  const ship = (TUNING.moveSpeed ?? 5) * 60;
  const contactMult = id === 'lieutenant' ? Math.max(cfg.contactMult || 1, 1.4) : cfg.contactMult;
  return {
    wave,
    unlockWave,
    hue: cfg.hue,
    hp: id === 'lieutenant' ? null : Math.round(hp),
    speed: id === 'lieutenant' ? null : Math.round(speed),
    speedVsShip: id === 'lieutenant' ? null : speed / ship,
    contact: Math.round(contactDamageAt({ isBoss: !!cfg.isBoss, contactMult }, wave)),
    xp: id === 'lieutenant' ? null : cfg.xp
  };
}

// Stat chips for an entry card: [label, value] pairs.
export function hostileStatRows(id) {
  const s = hostileStats(id);
  if (!s) return [];
  const rows = [];
  if (s.hp !== null) rows.push([s.wave > 1 ? `HP @ W${s.wave}` : 'HP', s.hp.toLocaleString('en-US')]);
  else rows.push(['HP', `${pct(TUNING.lieutenantHpShare ?? 0.4)} BOSS`]);
  if (s.speed !== null) rows.push(['SPEED', `${s.speed} px/s · ${s.speedVsShip.toFixed(2)}× SHIP`]);
  rows.push(['CONTACT', String(s.contact)]);
  if (s.xp !== null) rows.push(['XP', String(s.xp)]);
  rows.push([id === 'boss' ? 'EVERY' : 'FROM', id === 'boss' ? '3 WAVES' : `WAVE ${s.unlockWave}`]);
  return rows;
}

export function lieutenantModifierRows() {
  return Object.entries(LT_MODIFIERS).map(([id, m]) => ({ id, label: m.label, detail: m.detail, hue: m.hue }));
}

// Guide id(s) for a live enemy: its type, plus 'lieutenant' for elites; bosses are 'boss'.
export function guideIdsFor(e) {
  if (!e) return [];
  if (e.isBoss) return ['boss'];
  return e.isLieutenant ? ['lieutenant', e.type] : [e.type];
}

// Hostiles seen by the player: any part of the hull within the camera view (plus a small margin).
// `isKnown(id)` filters entries already unlocked. Returns new guide ids, deduplicated, in spawn order.
export function detectEncounters(enemies, view, isKnown, margin = 60) {
  const found = [];
  const x0 = view.x - margin;
  const y0 = view.y - margin;
  const x1 = view.x + view.w + margin;
  const y1 = view.y + view.h + margin;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const r = e.radius || 0;
    if (e.x + r < x0 || e.y + r < y0 || e.x - r > x1 || e.y - r > y1) continue;
    const ids = guideIdsFor(e);
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!HOSTILE_BY_ID.has(id) || isKnown(id) || found.includes(id)) continue;
      found.push(id);
    }
  }
  return found;
}

// --- Mechanics (always readable: a guide should teach before you get hit) -----------------------

const jumpOdds = () => {
  const c = levelJumpChances(TUNING.baseLuck ?? 1);
  const p = (v) => `${+(v * 100).toFixed(2)}%`;
  return `+2 ${p(c.doubleChance - c.tripleChance)}, +3 ${p(c.tripleChance - c.quadChance)}, +4 ${p(c.quadChance - c.pentaChance)}, +5 ${p(c.pentaChance)}`;
};

// Tag cards a passive unlocks, e.g. "Tungsten Penetrators (KINETIC)".
const passiveTagCards = (id) => {
  const tags = weaponTags(id);
  const cards = UPGRADE_POOL.filter((u) => u.category === 'SPECIALIST' && (u.tags || []).some((t) => tags.includes(t)))
    .map((u) => `${u.name} (${u.tags.map((t) => TAG_INFO[t]?.label || t).join(', ')})`);
  return cards.length ? `the ${cards.join(' and ')} tag card${cards.length > 1 ? 's' : ''}` : 'no tag cards';
};

export const MECHANIC_ENTRIES = [
  {
    id: 'controls', icon: '⌨', title: 'CONTROLS',
    body: () => [
      'Keyboard: WASD move (and drill rock with the claws) · mouse aims · F auto-fire · C auto-aim · Space / right-click dash · E / Q Supernova · P / Esc pause (1-4 tabs) · N damage numbers · G field guide · H hide HUD · V fullscreen · T tuner.',
      'Controller: left stick move · right stick aim and fire · A dash · B Supernova · X / Y auto-fire / auto-aim · Start pause. Menus: d-pad + A, B back; in the pause menu and this guide LB / RB switch tabs.',
      'Level-up cards: 1 / 2 / 3 or A picks · R or X rerolls (gold) · Shift+1 / 2 / 3 or Y locks a card (gold).'
    ]
  },
  {
    id: 'mode_hardcore', icon: '☠', title: 'HARDCORE MODE',
    body: () => [
      `Pick it next to LAUNCH ([2], or LB / RB on a controller). The shield is your only life: it never regenerates, no card raises or restores it (Shield Capacitor is never offered), relic caches and shield crystals repair nothing, and the Void Armory's Aegis Shield Matrix is switched off, so every run starts at the base ${BASE_SHIELD}. Every other armory upgrade still applies.`,
      'When the shield hits 0 the run is over, as always. HARDCORE runs race on their own global board (ALL-TIME and per version) and in MY RUNS.'
    ]
  },
  {
    id: 'mode_blitz', icon: '⚡', title: 'BLITZ MODE',
    body: () => {
      const b = MODES.blitz.tuning;
      return [
        `A quick run for a short session ([3] next to LAUNCH): waves every ${b.waveLength} s instead of ${DEFAULT_TUNING.waveLength}, cheaper levels (LV 2 at ${b.xpCurveBase} XP) so the build comes together fast, and the enemy HP, spawn and damage ramps squeezed into the shorter clock.`,
        'A good BLITZ run ends around 7 to 9 minutes; a great one can push past 10. Shield rules are NORMAL. BLITZ runs race on their own global board and in MY RUNS.'
      ];
    }
  },
  {
    id: 'shield', icon: '◈', title: 'SHIELD, HULL & DASH',
    body: () => [
      'Your shield hugs the crab\'s silhouette and is the hitbox: if a hull or orb touches the glowing outline, you take the hit. Its arc shows charge; it shifts blue → amber → red as it drains.',
      `Contact damage is ${Math.round(18 * (TUNING.damageRampBase ?? 1))} per hit (bosses ${Math.round(38 * (TUNING.damageRampBase ?? 1))}) and each wave after wave ${TUNING.damageRampFrom ?? 5} adds ${pct(TUNING.damageRampPerWave ?? 0.08)} of the base (plasma orbs too). A hit gives 0.65 s of invulnerability and cuts your score multiplier by 25%. Dash grants 0.32 s of invulnerability (cooldown ${TUNING.dashCooldownBase ?? 1.5} s); Supernova grants 1.2 s and wipes every hostile orb.`
    ]
  },
  {
    id: 'waves', icon: '⧗', title: 'WAVES & PACING',
    body: () => [
      `A new wave every ${TUNING.waveLength ?? 22} s (+1 Void Core). Packs are picked by weight and new archetypes join at their unlock wave, each announced once per run by a NEW HOSTILE SIGNATURE card.`,
      `Bosses every 3 waves; a lieutenant on every non-boss wave from wave ${TUNING.lieutenantFirstWave ?? 2}. Enemy HP starts at ${TUNING.waveHpStart ?? 1}× base (light swarm fodder: ${TUNING.waveHpStartLight ?? 1}×) and grows +${pct(TUNING.waveHpPerWave ?? 0.25)} of base per wave, compounding a further ${(((TUNING.waveHpGrowth ?? 1.09) - 1) * 100).toFixed(1).replace(/\.0$/, '')}% per wave after wave ${TUNING.waveHpGrowthFrom ?? 6}.`
    ]
  },
  {
    id: 'crits', icon: '✦', title: 'CRITICAL HITS',
    body: () => [
      `Every weapon hit rolls a crit: base ${pct(TUNING.baseCritChance ?? 0.05)} chance for ${TUNING.baseCritDamage ?? 1.5}× damage. Crits flash a gold star, shove harder and show a big white-gold number.`,
      'Deadeye Targeting Lattice raises the chance, Overkill Resonator the multiplier. Burn ticks never crit.'
    ]
  },
  {
    id: 'status', icon: '☢', title: 'BURN · CHILL · CORRODE',
    body: () => [
      'BURN (Thermite Rounds, blaster and helix bolts, Plasma Grenades): each hit adds a stack and refreshes the fire for 3 s; stacks tick every 0.5 s.',
      `CHILL (Cryo Payload, rocket, missile and Plasma Grenade blasts): slows movement; hulls frost over. Bosses feel ${pct(TUNING.chillBossMult ?? 0.4)} of the slow.`,
      'CORRODE (Nanite Swarm, Tesla arcs, Plasma Grenades): each stack makes the target take +5% damage from every source, burn included. Vortexes are immune to all three.',
      'Plasma Grenades take the element of your strongest damage-type card (FIRE, FROST or CORROSIVE; plain PLASMA with none) and apply every damage type you own: blasts, bomblets and Lingering Clouds alike.'
    ]
  },
  {
    id: 'loadout', icon: '⬡', title: 'WEAPON SLOTS & LOADOUT',
    body: () => [
      `You carry up to ${weaponSlots()} weapons. The crab starts with ${STARTING_WEAPONS.map((id) => WEAPON_BY_ID[id].name).join(' and ')}. Level-ups offer upgrades for weapons you carry plus general upgrades; weapon add-ons and tag cards only appear when a carried weapon can use them.`,
      `While a slot is free, a NEW WEAPON card turns up in ${[1, 2, 3, 4, 5].map((n) => pct(TUNING[`newWeaponChanceBy${n}`] ?? 0)).join(' / ')} of level-up hands when you carry 1 / 2 / 3 / 4 / 5 weapons, and shows at least every ${TUNING.newWeaponPityOne ?? 2} hands while you carry a single weapon (every ${TUNING.newWeaponPity ?? 4} with more). Pick it to choose 1 of 3 new weapons (◆ ${weaponRerollCost()} gold rerolls the 3, doubling within one pick). With every slot full, no new weapons are offered until you DISCARD one from the LOADOUT panel in the pause menu.`,
      `More weapons, more choice: level-ups offer ${[1, 2, 3, 4].map(handSizeFor).join(' / ')} cards with 1 / 2 / 3 / 4+ weapons. Your 3rd and 5th weapons each add ${pct(slotDamageBonus())} damage to every weapon, and your 6th arrives with its LV 6 Breakthrough ready to pick (once per run). A discard takes back the hand size and damage. The NEW WEAPON card shows what the next slot unlocks.`,
      'Arsenal: ' + WEAPONS.map((w) => w.name).join(', ') + '.',
      ...PASSIVES.map((x) => `${x.name} is a PASSIVE, not a weapon: it takes no slot and is never a NEW WEAPON pick. It turns up in ordinary level-up hands like any general upgrade (with the usual +2…+5 rarity jumps), and owning it unlocks ${passiveTagCards(x.id)}. ${x.summary}`)
    ]
  },
  {
    id: 'weaponlevels', icon: '⚛', title: 'WEAPON LEVELS & BREAKTHROUGHS',
    body: () => [
      'Every weapon, Autocannon included, goes from LV 1 to LV 18. Each of its cards raises ONE stat and nothing else: Damage cards raise damage per hit, fire rate / reload / cooldown cards make it attack more often, count cards add projectiles, and size, radius, reach, pull and lifetime cards change only that. Each card also adds a level.',
      'Damage, fire rate and count cards add damage output. Size, radius, reach and pull cards add none: they make the weapon easier to land, so a weapon built purely for damage hits as hard as any other weapon built the same way.',
      'At LV 6, 12 and 18 the weapon reaches a BREAKTHROUGH: your R&D team offers a TRANSFORM that changes how the weapon works (flak rounds, twin singularities, seeker mines, micro-missile pods...) or ACROSS THE BOARD (+18% damage, and +1 to every size, reach and range stat of that weapon). A card that jumps past a milestone still triggers it.',
      'EVOLUTIONS are semi-rare one-shot synergy cards that need two weapons (or a weapon and a passive). Every evolution names the weapons it upgrades.'
    ]
  },
  {
    id: 'rarity', icon: '★', title: 'UPGRADE RARITY = LEVEL JUMP',
    body: () => [
      'Each level-up card rolls how many levels it grants at once, and that jump is its rarity: +1 COMMON, +2 UNCOMMON, +3 RARE, +4 EPIC, +5 LEGENDARY. EVOLUTION cards are one-shot synergies with their own magenta tier.',
      `Odds at base luck: ${jumpOdds()}. Luck multiplies every chance; a jump never passes the level cap. Every card shows exact before → after numbers.`
    ],
    rarity: true
  },
  {
    id: 'lieutenants', icon: '▲', title: 'LIEUTENANTS',
    body: () => [
      'Elites with a name, silver rank brackets, a floating HP bar and colored modifier arcs. A small card announces their arrival; a radar dot and LT edge arrow track them.',
      'Modifiers: ' + lieutenantModifierRows().map(m => `${m.label} (${m.detail.toLowerCase()})`).join(', ') + '.'
    ]
  },
  {
    id: 'boss_warning', icon: '⚠', title: 'BOSS WARNINGS',
    body: () => [
      `${secs(TUNING.bossWarningTime ?? 3)} before a boss lands: a WARNING strip with a countdown, a klaxon, the music drops out, the screen edge goes red and a hazard ring closes on the spawn point (off-screen arrow + radar ring).`,
      'The kill freezes time for a beat, then slow-motion, a gold flash and a reward banner.'
    ]
  },
  {
    id: 'gravity', icon: '◉', title: 'GRAVITY, VORTEX TUG & ESCAPE',
    body: () => [
      `Vortexes pull inside ${TUNING.blackholePullRadius ?? 200} px. They bend passing shots and drag pickups and enemies into orbit, strongest at the core; a dashed tether shows when your ship is being tugged.`,
      `Ship tug: ${pct(TUNING.blackholePlayerPullEdge ?? 0.5)} of your thrust as you cross the rim, rising steadily to ${pct(TUNING.blackholePlayerPullInner ?? 0.75)} at ${pct(TUNING.blackholePlayerPullInnerAt ?? 0.5)} of the radius from the core, and holding there.`,
      `Escape cap: even several vortexes together never pull with more than ${pct(playerPullCapShare())} of your thrust, so holding away always keeps at least ${pct(1 - playerPullCapShare())} of your speed.`
    ]
  },
  {
    id: 'blast', icon: '✸', title: 'BLAST FALLOFF',
    body: () => [
      `Area blasts (missiles, rockets, grenades, mines, drill blasts, singularity collapse) deal full damage at the center and fall off toward the edge: ${pct(1 - (TUNING.splashEdgeFalloff ?? 0.4))} at the rim. A direct hit keeps the weapon's full damage.`,
      'Field Amplifier makes every AREA weapon reach further.'
    ]
  },
  {
    id: 'pierce', icon: '➤', title: 'PIERCE FALLOFF',
    body: () => [
      `Piercing bolts deal full damage to the first enemy; each one behind takes ${pct(TUNING.pierceFalloff ?? 0.7)} of the hit before it. Line enemies up and the front of the column melts first.`
    ]
  },
  {
    id: 'enemy_shields', icon: '⛉', title: 'ENEMY SHIELD PLATES',
    body: () => [
      'Aegis Shielders (and SHIELDED lieutenants) carry front plates. A projectile travelling into the plates is stopped with a white flash; shots from the flank or rear reach the hull.',
      'Auto-aim prefers targets it can actually hurt, so it swings away from plates that face you. Homing missiles, area blasts, arcs, orbit blades and singularities ignore plates.'
    ]
  },
  {
    id: 'damage_numbers', icon: '#', title: 'DAMAGE NUMBERS',
    body: () => [
      'Floating numbers are colored by source: blaster cyan, missiles orange, lightning violet, orbitals green, singularity pink, Supernova gold, mines red, turret blue, drones lime, grenades mint, burn red-orange, everything else white.',
      'Rapid hits on one enemy merge into one rising total. Crits are bigger and white-gold. Toggle with N or in the pause menu.'
    ]
  },
  {
    id: 'mining', icon: '⛏', title: 'MINING & ORE VEINS',
    body: () => [
      'Only your front drill-claws mine. Weapons and bombs never break rock, so asteroids are cover for you and for gunner orbs. Drive into rock to carve tunnels.',
      ...(eliteMiningDps() > 0 ? [`Elites (lieutenants and bosses) are the exception: they grind through rock in their way at ${eliteGrindSpeed()} and leave the ore behind; a shield crystal they crush heals no one.`] : []),
      `Veins: GOLD (${goldPerVein()} ◆ gold for rerolls and locks, ${pct(TUNING.goldVeinChestChance ?? 0.004)} × luck chance of a buried Relic Cache), SHIELD CRYSTAL (+25 shield), DEEP CORE (+1 Void Core, near cluster cores). The radar shows veins.`
    ]
  },
  {
    id: 'gold', icon: '◆', title: 'GOLD, REROLL, LOCK & BANISH',
    body: () => [
      `Gold veins drop ${goldPerVein()} ◆ gold as glowing gold coins (no XP). Your claws break them, and so do elites grinding through rock; either way the coins are yours to grab. Gold lasts for this run only and starts at 0: it is not Void Cores.`,
      `REROLL on a level-up swaps every unlocked card for a fresh roll with the usual odds: ${rerollCost(0)} ◆, then ${rerollCost(1)} ◆, ${rerollCost(2)} ◆… within the same level-up, back to ${rerollCost(0)} ◆ on the next one. On a NEW WEAPON pick, REROLL swaps the 3 weapons for others: ${weaponRerollCost(0)} ◆, then ${weaponRerollCost(1)} ◆, ${weaponRerollCost(2)} ◆… Keys: R, or X on a controller.`,
      `LOCK a card for ${lockCost()} ◆ (one at a time): it stays put through rerolls, and if you pick a different card it comes back in your next level-up hand (in place of one random card) until you take it. Unlocking is free but refunds nothing. A lock is dropped if the card can no longer be offered by then (maxed, weapon discarded, no free slot for NEW WEAPON). Keys: Shift+1 / 2 / 3, or Y on the focused card.`,
      `BANISH a card for ${banishCost()} ◆: it never comes up again this run, and a fresh card takes its slot. It takes two presses so you can't do it by accident: click ✕ twice, press B then 1 / 2 / 3, or RB twice on the focused card. NEW WEAPON can't be banished.`
    ]
  },
  {
    id: 'caches', icon: '▣', title: 'RELIC CACHES & JACKPOTS',
    body: () => [
      'Bosses always drop a Super Relic Cache. Lieutenants, vortexes, splitters and weavers have small luck-scaled chances; gold veins can hide one.',
      `Opening one installs free upgrades: 1× normally, or a rare 2× (${pct(TUNING.chestDoubleChance ?? 0.075)}), 3× (${+((TUNING.chestTripleChance ?? 0.018) * 100).toFixed(1)}%) or 5× Penta-Core (${+((TUNING.chestPentaChance ?? 0.003) * 100).toFixed(1)}%) jackpot, all × luck (super caches roll better).`
    ]
  },
  {
    id: 'cores', icon: '❖', title: 'VOID CORES & ARMORY',
    body: () => [
      `Void Cores persist between runs. Earn them from each new wave, vortexes and splitters (up to ${TUNING.maxWaveCores ?? 3} per wave), bosses (3), lieutenants, deep core veins and an end-of-run bounty.`,
      'Spend them in the Void Armory on the title and game-over screens: shield, damage, fire rate, luck and magnet, extra Supernovas and mining.'
    ]
  }
];

// --- Weapons: a thin adapter over UPGRADE_POOL / WEAPON_TAGS -------------------------------------
// Categories are taken from the pool in order, so new cards and categories show up with no edits.
// Recipes are optional hints for evolutions (unknown ids are simply skipped).
// The crab's starting weapons, straight from the loadout registry.
export const STARTING_KIT = STARTING_WEAPONS.map((id) => ({
  key: id,
  name: WEAPON_BY_ID[id].name.toUpperCase(),
  text: WEAPON_BY_ID[id].summary
}));

const EVOLUTION_RECIPES = {
  evo_tectonic: 'Rotary Claw Overclock LV 2',
  evo_pulsar: 'Prism Split LV 2 or Hyper-Capacitor LV 2',
  evo_tempest: 'Swarm Micro-Missiles + Tesla Arc Emitter',
  evo_siege: 'Proximity Mines + Sentry Turret',
  evo_emp: 'Plasma Grenades + Tesla Arc Emitter',
  evo_supercrit: 'Deadeye Targeting Lattice LV 2 + any damage-type card'
};

const tagChips = (tags = []) => tags.filter(t => TAG_INFO[t]).map(t => ({ id: t, label: TAG_INFO[t].label, color: TAG_INFO[t].color }));

export function weaponGuide(levels = null, pool = UPGRADE_POOL) {
  const categories = [];
  const byCategory = new Map();
  for (const u of pool) {
    let cat = byCategory.get(u.category);
    if (!cat) {
      cat = { id: u.category, items: [] };
      byCategory.set(u.category, cat);
      categories.push(cat);
    }
    cat.items.push({
      id: u.id,
      name: u.name,
      summary: u.summary || '',
      maxLevel: u.maxLevel,
      evolution: !!u.isSynergy,
      weapon: !!WEAPON_BY_LEVEL_ID[u.id], // a slot weapon's own card (WEAPONS tab) vs an upgrade (UPGRADES tab)
      recipe: EVOLUTION_RECIPES[u.id] || null,
      tags: tagChips(u.tags),
      owned: levels ? (levels[u.id] || 0) : 0
    });
  }
  return {
    kit: STARTING_KIT.map(k => ({ ...k, tags: tagChips(weaponTags(k.key)) })),
    categories,
    tags: Object.entries(TAG_INFO).map(([id, t]) => ({ id, label: t.label, color: t.color })),
    rarity: Object.entries(RARITY).map(([id, r]) => ({ id, label: r.label, color: r.color }))
  };
}
