// STORY: the cast and the scripts of the game's cutscenes (played by js/cutscene.js on the stage in
// js/cutscene-stage.js). Scripts are plain data, so campaign beats can be added here without new code.
//
// The OPENING: our miner is drilling a rock on a quiet shift and chatting with Astra dispatch, the grid
// warps, the Vex tear in through warp gates, he cracks wise and we hard-cut into wave 1. It plays by itself
// on the first LAUNCH on a device (before the tutorial and the starting-weapon pick), never again once
// seen or skipped, and replays from 🎬 INTRO on the title screen. It never touches the run: score,
// stats and the leaderboard start when the run does. Headless tests and tools never switch it on.
import { registerSpeaker } from './dialogue.js';
import { registerStoryPortraits } from './portraits.js';

export const INTRO_SEEN_KEY = 'vexolith_intro_seen';

// The hero: JACK HAMMER, the campaign's working name (docs/SECTORS_DESIGN.md). Alternatives for Clay:
// REX ROCKWELL, DUKE MAVERICK. Dispatch is DEE REYES; DR. PIXIE runs R&D (js/pixie.js); the VEX never
// speak our language.
export const MINER_NAME = 'JACK HAMMER';
export const MINER_TAG = 'JACK';
export const MINER_FIRST = 'Jack';

// Voices are blip params for SoundEngine.playDialogueBlip: oscillator, base pitch, random pitch spread.
export const CAST = Object.freeze({
  miner: { name: MINER_TAG, color: '#ffb347', portrait: 'miner', voice: { wave: 'square', freq: 165, jitter: 0.14, vol: 0.05, dur: 0.05 } },
  dispatch: { name: 'DEE // ASTRA DISPATCH', color: '#00f3ff', portrait: 'dispatch', voice: { wave: 'triangle', freq: 640, jitter: 0.06, vol: 0.07, dur: 0.035 } },
  pixie: { name: 'DR. PIXIE // ASTRA R&D', color: '#62ffb5', portrait: 'pixie', voice: { wave: 'triangle', freq: 900, jitter: 0.28, vol: 0.05, dur: 0.035 } },
  vex: { name: 'VEX SIGNAL', color: '#ff2bd6', portrait: 'vex', voice: { wave: 'sawtooth', freq: 92, jitter: 0.04, vol: 0.06, dur: 0.075, glide: 0.6 } }
});

let registered = false;
export function registerStoryCast() {
  if (registered) return;
  registered = true;
  registerStoryPortraits();
  for (const [id, def] of Object.entries(CAST)) registerSpeaker(id, def);
}

// ~35 s if nobody presses anything; every line can be hurried along and the whole scene skipped.
export const OPENING_SCENE = Object.freeze({
  id: 'opening',
  steps: [
    { do: 'music', duck: 0.35, scene: 'menu', muffled: true, wait: false },
    { do: 'letterbox', on: true, wait: false },
    { do: 'drill', wait: false },
    { do: 'fade', to: 0, time: 1.2 },
    { do: 'card', title: 'ASTRA MINING // CLAIM 7', sub: `PILOT: ${MINER_NAME} · 0600 HRS`, time: 2.2 },
    { do: 'say', who: 'dispatch', text: 'Rig Seven, it\'s Dee at Astra Dispatch. Quota check. How\'s my favorite miner?' },
    { do: 'say', who: 'miner', text: 'Drillin\', chillin\' and billin\' by the hour, Dispatch. This rock cuts like butter.' },
    { do: 'say', who: 'dispatch', text: 'Copy that. Corporate says your sector is one hundred percent safe. Zero hostiles.' },
    { do: 'say', who: 'miner', text: 'Music to my ears. Just me, the rock and a whole lot of cool.' },
    { do: 'hide' },
    { do: 'tremor', strength: 1, time: 1.1 },
    { do: 'say', who: 'dispatch', text: `Uh… ${MINER_FIRST}? Why is your sector bending on my screen?` },
    { do: 'hide' },
    { do: 'stopDrill', wait: false },
    { do: 'camera', focus: 'gates', wait: false },
    { do: 'gates', time: 1.4 },
    { do: 'music', duck: 0.55, scene: 'run', muffled: false, wait: false },
    { do: 'say', who: 'vex', text: '▼◆▲ ◇◇△ ▲▼◆◆ ▽◆▲!!' },
    { do: 'swarm', wait: false },
    { do: 'say', who: 'dispatch', text: 'Translator says… "Leave the rock, or BECOME the rock." Jeez.' },
    { do: 'camera', focus: 'ship', wait: false },
    { do: 'say', who: 'miner', text: 'One hundred percent safe. Sure. Aaand there goes my lunch break.' },
    { do: 'say', who: 'miner', text: 'Alright, pointy. You want the rock? Come and get it!', hold: 1.3 },
    { do: 'hide' },
    { do: 'music', duck: 1, wait: false },
    { do: 'cut', time: 0.25 }
  ]
});

// Every scene by id, for Game.playCutscene(id). Campaign beats add theirs here.
export const SCENES = Object.freeze({ opening: OPENING_SCENE });

export function readIntroSeen(storage) {
  try { return !!storage?.getItem(INTRO_SEEN_KEY); } catch { return false; }
}

export function writeIntroSeen(storage) {
  try { storage?.setItem(INTRO_SEEN_KEY, '1'); return true; } catch { return false; }
}

export function defaultIntroStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
