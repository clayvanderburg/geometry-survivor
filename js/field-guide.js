// Field Guide data: every hostile, the core mechanics and a weapon index, plus encounter detection.
// Pure data and helpers (no DOM): js/field-guide-ui.js renders it and js/field-guide-scenes.js
// animates the hostile previews with the real enemy drawing code.
//
// Hostile entry ids are enemy `type` strings (bosses included), plus 'lieutenant' (any elite). Adding a new
// enemy type? Give it an entry here: tests/field-guide.test.js fails until every type has one.
import { TUNING, DEFAULT_TUNING } from './config.js';
import { EnemyManager, contactDamageAt, waveScaleAt } from './enemies.js';
import { ARCHETYPE_INFO, BRUISER, GUNNER, SHIELDER, BLINKER, CONDUIT, bruiserChargeLength } from './archetypes.js';
import { HOSTILE_INFO, MAYFLY, CARRIER, DRONE, MITOSIS, REPULSOR } from './hostiles.js';
import { BOSS_DEFS, BOSS_TIER, QUEEN, OURO, WING, HIVE, HORIZON, ARCH, PROG, COND, TWINS, PRISM } from './bosses.js';
import { LANCE } from './lancers.js';
import { GATE } from './gates.js';
import { SERPENT } from './serpents.js';
import { KESTREL } from './squadrons.js';
import { BOSS_SCHEDULE, unlockWaveOf, VETERAN_SPEED } from './wave-plan.js';
import { LT_MODIFIERS } from './lieutenants.js';
import { UPGRADE_POOL, RARITY, levelJumpChances, BASE_SHIELD } from './upgrades.js';
import { WEAPON_TAGS, TAG_INFO, WEAPON_SCALING as W } from './weapon-scaling.js';
import { ELEMENT_WEAPONS, ELEMENT_MAX_RANKS } from './weapon-levels.js';
import { playerPullCapShare } from './gravity.js';
import { eliteMiningDps } from './pursuit.js';
import { goldPerVein, rerollCost, lockCost, banishCost } from './gold.js';
import { WEAPONS, PASSIVES, WEAPON_BY_ID, WEAPON_BY_LEVEL_ID, STARTING_WEAPONS, weaponTags, weaponSlots } from './loadout.js';
import { MODES } from './modes.js';

export const GUIDE_GROUPS = [
  { id: 'swarm', label: 'CORE SWARM' },
  { id: 'hazard', label: 'HAZARDS' },
  { id: 'archetype', label: 'COMBAT ARCHETYPES' },
  { id: 'elite', label: 'ELITES' },
  { id: 'boss', label: 'BOSSES' }
];

// Wave a named boss leads (from the campaign schedule).
const bossWave = (id) => +(Object.keys(BOSS_SCHEDULE).find(w => BOSS_SCHEDULE[w] === id) ?? 3);
const veteranNote = ' From wave 11 they field a veteran form with an extra edge, and from wave 21 another, each a little faster.';

const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => `${+v.toFixed(2)} s`;

// Elite mining wording (lieutenant and boss entries, mining mechanic); empty when the tuner turns it off.
// `extra` multiplies the elite rate (bosses: bossMiningMult, serpent heads: serpentMiningMult).
function eliteGrindSpeed(extra = 1) {
  const mult = (TUNING.eliteMiningMult ?? 1) * extra;
  const base = Math.abs(mult - 1) < 1e-9 ? 'your base drill speed' : `${+mult.toFixed(2)}× your base drill speed`;
  return `${base} (${Math.round(eliteMiningDps() * extra)}/s)`;
}
function eliteGrindText() {
  if (!(eliteMiningDps() > 0)) return '';
  return ` It grinds through asteroids at ${eliteGrindSpeed()}, unaffected by your drill upgrades, instead of going round, and the broken rock drops its ore for you.`;
}
function bossGrindText() {
  const blast = TUNING.bossPortalBlast ?? 280;
  const portal = blast > 0 ? ` Its portal blows apart every rock within ${blast} px as it arrives.` : '';
  if (!(eliteMiningDps() > 0)) return portal;
  return ` It busts through asteroids at ${eliteGrindSpeed(TUNING.bossMiningMult ?? 4)}, and the broken rock drops its ore for you.${portal}`;
}

// `what` and `tip` may be functions so their numbers always come from the live constants/TUNING.
export const HOSTILE_ENTRIES = [
  {
    id: 'swarmer', name: 'BOID SWARMER', group: 'swarm', unlockWave: 1,
    what: 'Magenta diamonds that flock: they keep apart, match heading, pull together and swirl in on your ship. Packs grow every wave.' + veteranNote,
    tip: 'Fodder that pops on contact. Keep moving and sweep the pack with the blaster; chain lightning and orbit blades shred them.'
  },
  {
    id: 'pinwheel', name: 'PINWHEEL', group: 'swarm', unlockWave: 1,
    what: 'Violet spinning squares that grind straight at you. Slower than swarmers but much tougher. Veterans spin a pentagon of blades from wave 11 and a hexagon from wave 21.',
    tip: 'Kite them in a wide circle so they bunch up, then let piercing bolts run down the line.'
  },
  {
    id: 'weaver', name: 'EMERALD WEAVER', group: 'swarm', unlockWave: 1,
    what: 'Fast green darts that read incoming fire and sidestep perpendicular to any bolt flying at them.',
    tip: 'Hard to hit head-on. Homing missiles, lightning, orbit blades and blast splash ignore the dodge, or fire a wide Prism spread.'
  },
  {
    id: 'splitter', name: 'SPLITTER', group: 'swarm', unlockWave: 1,
    what: 'Golden hexagons with a spinning inner core. When destroyed they fracture into three fast mini-splitters. Veterans gain a side every 10 waves; from wave 21 they burst into four.',
    tip: 'Kill them away from your ship so the burst has room. Supernova kills do not split.'
  },
  {
    id: 'mini_splitter', name: 'MINI-SPLITTER', group: 'swarm', unlockWave: 1,
    what: 'Triangle fragments thrown out of a dead splitter at speed. Fragile, quick, and they hit lighter than a full hull.',
    tip: 'Expect three of them where a splitter dies: back off a step, then sweep.'
  },
  {
    id: 'mayfly', name: 'MAYFLY', group: 'swarm', unlockWave: unlockWaveOf('mayfly'),
    what: () => `Lime specks that come in clouds of a dozen or more. Every ${secs(MAYFLY.jitterMin)}–${secs(MAYFLY.jitterMax)} each one snaps to a new heading within about ${Math.round(MAYFLY.spread * 180 / Math.PI)}° of your ship, so the cloud twitches in without a line to lead. One hit kills; contact stings for half a normal hit. Debuts with the Brood Queen.`,
    tip: 'Never park in a cloud. Strafe across its edge and sweep it: spread shots, lightning and orbit blades clear them fast.'
  },
  {
    id: 'mitosis', name: 'MITOSIS CELL', group: 'swarm', unlockWave: unlockWaveOf('mitosis'),
    what: () => `A lime cell that wobbles toward you while it grows: over ${secs(MITOSIS.growTime)} it swells to ${MITOSIS.maxScale}× its size and HP, pinches in the middle, and splits into two small cells. Colonies keep doubling until there are ${MITOSIS.cap} on the field. Debuts with the Progenitor.`,
    tip: 'Kill them small and early. A colony left alone is twice the problem every few seconds.'
  },
  {
    id: 'drone', name: 'DRONE', group: 'swarm', unlockWave: unlockWaveOf('drone'),
    what: () => `A tiny green kamikaze launched by carriers. It homes on you with a limited turn, so a sharp sidestep makes it overshoot, and it burns out on its own after ${secs(DRONE.life)}. Contact stings for a little over half a normal hit.`,
    tip: 'Keep moving in curves and let them overshoot, or sweep them as they bunch up behind you.'
  },
  {
    id: 'blackhole', name: 'VORTEX', group: 'hazard', unlockWave: unlockWaveOf('blackhole'),
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
    id: 'hulk', name: 'HULK', group: 'archetype', unlockWave: unlockWaveOf('hulk'),
    what: () => `The old Prismatic Dreadnought hull, pressed into line service: a huge slow cyan octagon that soaks fire, takes ${pct(0.1)} knockback, shrugs off ramming and hits for ${(1.8).toFixed(1)}× contact damage. Debuts with Event Horizon.`,
    tip: 'Do not try to out-trade it head-on. Kite it in a loop, let it body-block its own pack, and burn it down with sustained damage.'
  },
  {
    id: 'serpent', name: 'SERPENT', group: 'archetype', unlockWave: unlockWaveOf('serpent'),
    what: () => `An indigo arrowhead trailing ${SERPENT.segments} armored body plates that follow it like a rope. It winds toward you in long S-curves. Only the head takes damage: the body stops your shots cold and stings on contact. Kill the head and the body pops plate by plate. The head drills through asteroids${eliteMiningDps() > 0 ? ` at ${eliteGrindSpeed(TUNING.serpentMiningMult ?? 2)}` : ''} and the body glides over them. Debuts with the Ouroboros.`,
    tip: 'Get ahead of it, not behind: shoot the head as it turns toward you. Auto-aim and homing weapons prefer the head; area blasts on the body are wasted.'
  },
  {
    id: 'kestrel', name: 'KESTREL WING', group: 'archetype', unlockWave: unlockWaveOf('kestrel'),
    what: () => `Amber darts that fly in a V of 3 (later 5). They never chase: the leader lines up on you, makes a straight strafing run through where you were at nearly your speed, overshoots, banks round and lines up again, wingmen holding their slots. Down the leader and the rest scatter onto runs of their own. Debuts with the Wing Commander.`,
    tip: 'Step off the line as they line up, then shoot down the length of the V as it passes. Take the leader first.'
  },
  {
    id: 'carrier', name: 'CARRIER', group: 'archetype', unlockWave: unlockWaveOf('carrier'),
    what: () => `A green hangar ship that hangs back about ${CARRIER.range} px and launches ${CARRIER.launch} drones out of its flanks every ${secs(CARRIER.launchEvery)}, up to ${CARRIER.maxDrones} at a time. Durable, slow and never closes in on its own. Debuts with the Hive Carrier.`,
    tip: 'Go and get it: every second you leave it alone is more drones. Cut through the drones on the way in.'
  },
  {
    id: 'gate', name: 'LASER GATE', group: 'hazard', unlockWave: unlockWaveOf('gate'),
    what: () => `Two yellow pylons joined by a crackling beam, drifting and spinning toward you. Shoot the hub to break it. FLY THROUGH THE BEAM and it detonates in a ${GATE.blastRadius} px blast that wrecks every hostile nearby, bosses included, and costs you nothing. The pylons are solid and hit like a hull. Debuts with the Architect.`,
    tip: 'Do not shoot every gate: lure a crowd (or a boss) next to one, then fly through the beam. Mind the pylons at the ends.'
  },
  {
    id: 'repulsor', name: 'REPULSOR', group: 'archetype', unlockWave: unlockWaveOf('repulsor'),
    what: () => `An azure hexagon inside a ${REPULSOR.field} px field that swings your bolts away, guarding itself and anything standing in it. Each bolt it turns drains the field; after ${REPULSOR.charge} it overloads and drops for ${secs(REPULSOR.overload)}. Missiles, arcs, blasts, orbit blades, singularities and ramming ignore it. Debuts with the Conductor.`,
    tip: 'Pour fire into it to overload the field, then finish it fast, or hit it with area damage and arcs. Kill it before its escort.'
  },
  {
    id: 'lancer', name: 'LANCER', group: 'archetype', unlockWave: unlockWaveOf('lancer'),
    what: () => `A red spear hull that closes to about ${LANCE.range} px, plants itself and aims a dashed line at you for ${secs(LANCE.aimTime)}. The line locks (turns red) for the last ${secs(LANCE.lockAt)}, then it fires a ${LANCE.length} px beam that sweeps ${Math.round(LANCE.sweep * 180 / Math.PI)}° to one side over ${secs(LANCE.fireTime)}. Debuts with the Eclipse Twins.`,
    tip: 'When the line turns red, step sideways off it, against the sweep if you can guess it. Punish it while it is planted.'
  },
  {
    id: 'lieutenant', name: 'LIEUTENANT', group: 'elite', unlockWave: () => TUNING.lieutenantFirstWave ?? 2,
    what: () => `One elite per non-boss wave, from wave ${TUNING.lieutenantFirstWave ?? 2}: a bigger copy of an unlocked archetype with a generated name, silver rank brackets and ${Math.max(1, Math.round(TUNING.lieutenantMaxMods ?? 2))} modifier${(TUNING.lieutenantMaxMods ?? 2) > 1 ? 's' : ''} at most. HP is ${pct(TUNING.lieutenantHpShare ?? 0.4)} of that wave's boss (×0.85–1.5 by archetype), and it moves ${pct((TUNING.lieutenantSpeedMult ?? 1.35) - 1)} faster than its archetype (never as fast as your ship).${eliteGrindText()}`,
    tip: () => `Worth it: +${Math.round(TUNING.lieutenantCoreReward ?? 1)} Void Core, gold Geoms and 8× score. It survives a Supernova (−40% max HP) and ramming.`,
    modifiers: true
  },
  {
    id: 'brood_queen', name: BOSS_DEFS.brood_queen.name, group: 'boss', boss: true, unlockWave: bossWave('brood_queen'),
    what: () => `${BOSS_DEFS.brood_queen.epithet}. A giant swarmer that arrives inside a ring of ${QUEEN.ring} circling swarmers. Every ${secs(QUEEN.peelEvery)} the ones nearest you peel off: half dive straight in, half circle you first. She hatches replacements while the ring is short. At ${pct(QUEEN.rageAt)} HP the whole brood scatters, she speeds up and births divers instead. She dies in a burst of ${QUEEN.deathMayflies} mayflies.${bossGrindText()}`,
    tip: 'The ring is her shield: sweep it with area damage, then hit her while it rebuilds. Back off when she hits half HP, and keep moving through the final mayfly burst.'
  },
  {
    id: 'ouroboros', name: BOSS_DEFS.ouroboros.name, group: 'boss', boss: true, unlockWave: bossWave('ouroboros'),
    what: () => `${BOSS_DEFS.ouroboros.epithet}. A giant serpent: a crowned head and ${OURO.segments} armored plates that block every shot. Healthy, it winds after you and every ${secs(OURO.shedEvery)} sheds its tail as a small serpent. From ${pct(OURO.coilAt)} HP it hunts: it coils round you in a tightening ring, rears up behind a red strike lane, strikes down it, then winds free and coils again.${bossGrindText()}`,
    tip: 'Only the head counts. When it starts to coil, dash out through the gap where head meets tail before the ring closes, and step off the red lane before it strikes.'
  },
  {
    id: 'wing_commander', name: BOSS_DEFS.wing_commander.name, group: 'boss', boss: true, unlockWave: bossWave('wing_commander'),
    what: () => `${BOSS_DEFS.wing_commander.epithet}. A broad amber delta leading a V of ${WING.escort} Kestrels on strafing runs. Every pass lays a line of slow drifting mines out of both sides, and each new run calls in replacement wingmen. At ${pct(WING.rageAt)} HP the escort scrambles to hunt alone, and the Commander flies faster runs that open with an aimed ${WING.fan}-orb fan. It bursts in a ring of orbs when it dies.${bossGrindText()}`,
    tip: 'Do not stand in its lane: sidestep the run, then cross its mine lines through the gaps. Thin the escort between passes so it has fewer wingmen to call back.'
  },
  {
    id: 'hive_carrier', name: BOSS_DEFS.hive_carrier.name, group: 'boss', boss: true, unlockWave: bossWave('hive_carrier'),
    what: () => `${BOSS_DEFS.hive_carrier.epithet}. A huge, slow mothership with ${HIVE.bays} launch bays on its hull. While any bay stands, the core is shielded and shots spark off it, and every bay launches homing drones. Destroy the bays and the core is exposed: it spins up, sprays a double spiral of orbs and launches gunner pods every ${secs(HIVE.podEvery)}.${bossGrindText()}`,
    tip: 'Take the bays out one at a time while dodging the drones; area damage hits several. Once the core is exposed, circle wide through the gaps in the spiral.'
  },
  {
    id: 'event_horizon', name: BOSS_DEFS.event_horizon.name, group: 'boss', boss: true, unlockWave: bossWave('event_horizon'),
    what: () => `${BOSS_DEFS.event_horizon.epithet}. A living black hole that drifts after you with a ${HORIZON.pullRadius} px pull: it tugs your ship (never past the escape cap), bends your shots hard and drags other hostiles in. Anything it swallows heals it ${pct(HORIZON.eatHeal)} of its max HP. Every ${secs(HORIZON.breathEvery)} it inhales (its pull swells) and exhales a ring of ${HORIZON.ring} orbs. At ${pct(HORIZON.rageAt)} HP it spits out ${HORIZON.vortexes} vortexes and breathes faster. Arrives with ${HORIZON.escortHulks} Hulks.${bossGrindText()}`,
    tip: 'Fight it from the edge of its pull and kill things away from it so it cannot feed. Shoot from close range so the bend has less time to steer your shots off.'
  },
  {
    id: 'architect', name: BOSS_DEFS.architect.name, group: 'boss', boss: true, unlockWave: bossWave('architect'),
    what: () => `${BOSS_DEFS.architect.epithet}. A yellow drafting triangle that hangs back about ${ARCH.range} px and beams a laser gate into place round you every ${secs(ARCH.buildEvery)} (up to ${ARCH.maxGates}), guarded by ${ARCH.guards} Aegis Shielders. At ${pct(ARCH.rageAt)} HP it builds faster and drops a CAGE every ${secs(ARCH.cageEvery)}: ${ARCH.cageGates} gates in a ring round you that close in.${bossGrindText()}`,
    tip: 'Its gates are your best weapon: drag its guards next to one and fly through. Caught in a cage? Break out through a beam early, and the blast takes the rest of the ring.'
  },
  {
    id: 'progenitor', name: BOSS_DEFS.progenitor.name, group: 'boss', boss: true, unlockWave: bossWave('progenitor'),
    what: () => `${BOSS_DEFS.progenitor.epithet}. A giant cell that splits like an asteroid: kill it and it divides into ${PROG.children}, each of those into ${PROG.children} more, and the last generation bursts into Mitosis Cells. Pieces left unhit for ${secs(PROG.mergeAfter)} heal, drift together and merge back into the generation above. It is beaten when its last piece dies. The first cell buds a Mitosis Cell every ${secs(PROG.budEvery)}.${bossGrindText()}`,
    tip: 'Keep up the pressure on every piece: one left alone heals and finds a partner. Finish the smallest ones before they merge.'
  },
  {
    id: 'conductor', name: BOSS_DEFS.conductor.name, group: 'boss', boss: true, unlockWave: bossWave('conductor'),
    what: () => `${BOSS_DEFS.conductor.epithet}. An aqua podium that hangs back and beam-links up to ${COND.links} hostiles within ${COND.linkRange} px: linked hulls take less damage and move faster, and while ${COND.shieldLinks} or more links hold, the Conductor is untouchable. Every ${secs(COND.choirEvery)} it calls in a choir led by a Repulsor. At ${pct(COND.rageAt)} HP it plays the crescendo: every ${secs(COND.crescendoEvery)} each linked hull fires an orb at you.${bossGrindText()}`,
    tip: 'Follow the beams: thin its choir below four links and its shield drops. Take out the Repulsors first, then burst it while the choir regroups.'
  },
  {
    id: 'eclipse_twins', name: BOSS_DEFS.eclipse_twins.name, group: 'boss', boss: true, unlockWave: bossWave('eclipse_twins'),
    what: () => `SOL and LUNA, a sun and a crescent, circle a point that trails after you, ${TWINS.orbitR} px out and roughly opposite each other, joined by a burning tether that sweeps back and forth across the ring. Kill one and the survivor enrages, spinning faster and firing lancer beams, and unless it dies within ${secs(TWINS.reviveTime)} its twin returns at ${pct(TWINS.reviveHp)} HP. Beaten when both are down.${bossGrindText()}`,
    tip: 'Keep moving so the ring\'s centre never sits on you, and cross the tether where it is far from both twins. Bring both down to low HP, then finish them back to back.'
  },
  {
    id: 'prism', name: BOSS_DEFS.prism.name, group: 'boss', boss: true, unlockWave: bossWave('prism'),
    what: () => `${BOSS_DEFS.prism.epithet}. The finale: a spinning prism that cycles through every color and fights with the campaign's moves, one phase per third of its HP. SWARM: a ring of shard swarmers that peel off to dive or circle you. LATTICE: closing cages of laser gates. SINGULARITY: a gravity well that exhales rings of ${PRISM.orbRing} orbs while a lighthouse beam sweeps round it. Past wave 30 the run goes on, and bosses come in pairs.${bossGrindText()}`,
    tip: 'Phase one: sweep the ring with area damage. Phase two: break each cage early through a beam. Phase three: stay outside the beam\'s reach and circle with it, slipping through the orb rings.'
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
  const wave = entry.boss || id === 'lieutenant' ? unlockWave : 1;
  const type = id === 'lieutenant' ? 'pinwheel' : id;
  const cfg = statsManager.getArchetype(type, waveScaleAt(wave), { wave });
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
  const entry = hostileEntry(id);
  if (entry.boss) rows.push([`${(BOSS_DEFS[id]?.tier || 'minor').toUpperCase()} BOSS`, `WAVE ${s.unlockWave}`]);
  else rows.push(['FROM', `WAVE ${s.unlockWave}`]);
  return rows;
}

export function lieutenantModifierRows() {
  return Object.entries(LT_MODIFIERS).map(([id, m]) => ({ id, label: m.label, detail: m.detail, hue: m.hue }));
}

// Guide id(s) for a live enemy: its type, plus 'lieutenant' for elites. Bosses are their own type.
export function guideIdsFor(e) {
  if (!e) return [];
  if (e.isBoss) return [e.type];
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
      `A new wave every ${TUNING.waveLength ?? 22} s (+1 Void Core). Every wave has a theme that tilts which packs show up. New hostiles only debut on boss waves, each announced once per run by a NEW HOSTILE SIGNATURE card, and join the regular mix after that.`,
      `A minor boss every 3rd wave and a major boss every 6th (tougher, two phases, ${BOSS_TIER.major.cores} Void Cores instead of ${BOSS_TIER.minor.cores}). While a boss wave's boss is up, packs come ${pct(1 - (TUNING.bossPackRate ?? 0.7))} less often, but only until the wave ends. Past wave 30 bosses come in pairs. A lieutenant on every non-boss wave from wave ${TUNING.lieutenantFirstWave ?? 2}.`,
      `Packs are paced so every wave brings the same hit points per second as before the boss campaign: a heavy mix comes a little less often, a light one more often. The core swarm (swarmers, pinwheels, weavers, splitters, mayflies) fields veteran forms from waves 11 and 21: each adds an edge to the hull, for +${pct(VETERAN_SPEED[2] - 1)} and then +${pct(VETERAN_SPEED[3] - 1)} speed.`,
      `Enemy HP starts at ${TUNING.waveHpStart ?? 1}× base (light swarm fodder: ${TUNING.waveHpStartLight ?? 1}×) and grows +${pct(TUNING.waveHpPerWave ?? 0.25)} of base per wave, compounding a further ${(((TUNING.waveHpGrowth ?? 1.09) - 1) * 100).toFixed(1).replace(/\.0$/, '')}% per wave after wave ${TUNING.waveHpGrowthFrom ?? 6}.`
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
    id: 'status', icon: '☢', title: 'ELEMENTS: BURN · CHILL · CORRODE · STUN',
    body: () => [
      `ELEMENTS: ${ELEMENT_WEAPONS.map((id) => WEAPON_BY_ID[id].name).join(', ')} can each be infused with FIRE, FROST, CORROSIVE or SHOCK by a level-up card (never by a supply cache). The first pick locks that weapon's element for the run; more cards of the same element rank it up (up to ${ELEMENT_MAX_RANKS}), and every rank raises the weapon's level like its other cards.`,
      `BURN (FIRE): each hit adds a stack (max 3 + rank) and refreshes the fire for ${W.burnDuration} s; stacks tick every ${W.burnTickInterval} s. CHILL (FROST): slows movement and frosts the hull; bosses feel ${pct(TUNING.chillBossMult ?? 0.4)} of the slow. CORRODE (CORROSIVE): each stack makes the target take +${pct(W.corrodePerStack)} damage from every source, burn included.`,
      `STUN (SHOCK): a hit stuns for ${W.shockStun(1)} s, or ${pct(W.shockLongChance(1))} of the time a long ${W.shockLongStun} s stun: the hull crackles yellow, stops moving and can't attack (touching it still hurts). Then it is stun-immune for ${W.stunImmunity} s, so nothing is stunned forever. Bosses keep ${pct(TUNING.shockBossMult ?? 0.2)} of a stun (immune ${W.stunImmunityBoss} s), lieutenants ${pct(TUNING.shockLieutenantMult ?? 0.5)} (immune ${W.stunImmunityLieutenant} s).`,
      'STATUS cards (Status Potency, Status Application, Status Duration, Shock Conductor and the FIRE / FROST / CORROSIVE / SHOCK Amplifiers) strengthen every weapon of their element and never raise a weapon\'s level. They only show up once a weapon carries a matching element. Vortexes take statuses like any enemy; invulnerable hulls are immune.'
    ]
  },
  {
    id: 'loadout', icon: '⬡', title: 'WEAPON SLOTS & LOADOUT',
    body: () => [
      `You carry up to ${weaponSlots()} weapons. The crab starts with ${STARTING_WEAPONS.map((id) => WEAPON_BY_ID[id].name).join(' and ')}. Level-ups offer upgrades for weapons you carry plus general upgrades; weapon add-ons and tag cards only appear when a carried weapon can use them.`,
      `While a slot is free, a NEW WEAPON card turns up in ${[1, 2, 3, 4, 5].map((n) => pct(TUNING[`newWeaponChanceBy${n}`] ?? 0)).join(' / ')} of level-up hands when you carry 1 / 2 / 3 / 4 / 5 weapons, and shows at least every ${TUNING.newWeaponPityOne ?? 2} hands while you carry a single weapon (every ${TUNING.newWeaponPity ?? 4} with more). Pick it to choose 1 of 3 new weapons. With every slot full, no new weapons are offered until you DISCARD one from the LOADOUT panel in the pause menu.`,
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
      ...(eliteMiningDps() > 0 ? [`Elites are the exception: lieutenants grind through rock in their way at ${eliteGrindSpeed()}, bosses bust through at ${eliteGrindSpeed(TUNING.bossMiningMult ?? 4)} and serpent heads drill at ${eliteGrindSpeed(TUNING.serpentMiningMult ?? 2)}, leaving the ore behind; a shield crystal they crush heals no one.`] : []),
      ...((TUNING.bossPortalBlast ?? 280) > 0 ? [`A boss's portal blows apart every rock within ${TUNING.bossPortalBlast ?? 280} px as it arrives, ore and all.`] : []),
      `Veins: GOLD (${goldPerVein()} ◆ gold for rerolls and locks, ${pct(TUNING.goldVeinChestChance ?? 0.004)} × luck chance of a buried Relic Cache), SHIELD CRYSTAL (+25 shield), DEEP CORE (+1 Void Core, near cluster cores). The radar shows veins.`
    ]
  },
  {
    id: 'gold', icon: '◆', title: 'GOLD, REROLL, LOCK & BANISH',
    body: () => [
      `Gold veins drop ${goldPerVein()} ◆ gold as glowing gold coins (no XP). Your claws break them, and so do elites grinding through rock; either way the coins are yours to grab. Gold lasts for this run only and starts at 0: it is not Void Cores.`,
      `REROLL on a level-up swaps every unlocked card for a fresh roll with the usual odds: ${rerollCost(0)} ◆, then ${rerollCost(1)} ◆, ${rerollCost(2)} ◆… within the same level-up, back to ${rerollCost(0)} ◆ on the next one. Keys: R, or X on a controller.`,
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
      `Void Cores persist between runs. Earn them from each new wave, vortexes, hulks and splitters (up to ${TUNING.maxWaveCores ?? 3} per wave), bosses (${BOSS_TIER.minor.cores}, major bosses ${BOSS_TIER.major.cores}), lieutenants, deep core veins and an end-of-run bounty.`,
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
  evo_supercrit: 'Deadeye Targeting Lattice LV 2 + any weapon with an element'
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
