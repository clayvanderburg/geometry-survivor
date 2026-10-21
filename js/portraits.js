// PORTRAITS for the dialogue box (js/dialogue.js): 72×72 pixel art, drawn a frame at a time on the box's
// canvas (CSS scales it up pixel-crisp). Each one has a talk animation driven by `mouth` (0 / 1 / 2).
//   miner    — our pilot, cropped from the splash key art (assets/cutscene/miner.png, cigarette painted
//              out to keep it PG): mouth flaps, his toothpick bobs and flicks, a glint sweeps the visor
//              shades now and then (his "blink").
//   dispatch — ASTRA MINING mission control, audio only: the Astra logo on a CRT and a voice waveform.
//   pixie    — Dr. Pixie, Astra R&D's cute nerd genius, with four moods (neutral, eureka, smug, oops).
//   vex      — the alien overseer: an inverted triangle hull-face in the alien ships' magenta and violet
//              with a glowing core that flares as it speaks.
// registerStoryPortraits() registers all three by id; more can be added the same way.
import { registerPortrait, PORTRAIT_SIZE } from './dialogue.js';

export const MINER_PORTRAIT_SRC = 'assets/cutscene/miner.png';
const S = PORTRAIT_SIZE;

const px = (ctx, x, y, w = 1, h = 1) => ctx.fillRect(x | 0, y | 0, w, h);

// --- The miner ------------------------------------------------------------------------------------
// Pixel landmarks in miner.png (72×72): the mouth sits just left of the cigarette, at the face's profile.
export const MINER_FACE = Object.freeze({
  mouth: { x: 49, y: 44, w: 4 },
  pick: { x: 53, y: 43, len: 9 },
  visor: { x0: 31, x1: 57, y0: 26, y1: 31 }
});

let minerImg = null;
function minerImage() {
  if (!minerImg && globalThis.Image) {
    minerImg = new globalThis.Image();
    minerImg.src = MINER_PORTRAIT_SRC;
  }
  return minerImg?.complete && minerImg.naturalWidth ? minerImg : null;
}

export function drawMiner(ctx, { t = 0, mouth = 0 } = {}) {
  const img = minerImage();
  const F = MINER_FACE;
  if (!img) {
    // Still loading: a sunset silhouette, so the box is never empty.
    ctx.fillStyle = '#2a0a3a';
    px(ctx, 0, 0, S, S);
    ctx.fillStyle = '#ff6a3d';
    px(ctx, 20, 18, 34, 40);
    return;
  }
  ctx.drawImage(img, 0, 0, S, S);
  // Talking: the jaw drops a pixel or two.
  if (mouth > 0) {
    ctx.fillStyle = '#1a0710';
    px(ctx, F.mouth.x, F.mouth.y, F.mouth.w, mouth);
    ctx.fillStyle = '#7a2a2a';
    px(ctx, F.mouth.x + 1, F.mouth.y + mouth, F.mouth.w - 2, 1);
  }
  // The toothpick: rides the jaw while he talks, cocks up with a flick every few seconds while idle.
  const flick = mouth > 0 ? 0 : (t % 2.7 < 0.35 ? -2 : 0);
  const tipRise = 2 - flick + (mouth > 0 ? -mouth : 0);
  const base = mouth > 0 ? 1 : 0;
  for (let i = 0; i < F.pick.len; i++) {
    const y = F.pick.y + base - Math.round((i / (F.pick.len - 1)) * tipRise);
    ctx.fillStyle = '#5a3a1c';
    px(ctx, F.pick.x + i, y + 1);
    ctx.fillStyle = i === F.pick.len - 1 ? '#fff4d0' : '#e8c48a';
    px(ctx, F.pick.x + i, y);
  }
  // Visor glint: a bright slanted streak sweeps the shades every few seconds.
  const cycle = (t + 0.8) % 3.4;
  if (cycle < 0.45) {
    const k = cycle / 0.45;
    const gx = F.visor.x0 + k * (F.visor.x1 - F.visor.x0);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let y = F.visor.y0; y <= F.visor.y1; y++) px(ctx, gx + (F.visor.y1 - y) * 0.6, y, 2, 1);
  }
}

// --- Astra dispatch -------------------------------------------------------------------------------
export function drawDispatch(ctx, { t = 0, talking = false, mouth = 0 } = {}) {
  ctx.fillStyle = '#0b2a33';
  px(ctx, 0, 0, S, S);
  ctx.fillStyle = '#031016';
  px(ctx, 4, 4, S - 8, S - 8);
  // The Astra "A": a cream triangle with a notch and a crossbar, like the logo on the rig.
  ctx.fillStyle = '#f3d9b0';
  const cx = 36, top = 11, h = 22;
  for (let y = 0; y < h; y++) {
    const half = Math.round((y / h) * 15);
    const inner = Math.max(0, half - 4);
    px(ctx, cx - half, top + y, half - inner + 1, 1);
    px(ctx, cx + inner, top + y, half - inner + 1, 1);
    if (y === 15) px(ctx, cx - inner, top + y, inner * 2, 2);
  }
  // Voice waveform: lively while talking, a flat line with a heartbeat blip while listening.
  ctx.fillStyle = '#00f3ff';
  let prev = 50;
  for (let x = 8; x < S - 8; x++) {
    let a = 0;
    if (talking) a = Math.sin(x * 0.55 + t * 21) * (2 + mouth * 2.2) * Math.sin((x - 8) / (S - 16) * Math.PI) + Math.sin(x * 1.7 - t * 13) * mouth;
    else if (Math.abs(x - 8 - ((t * 30) % (S - 16))) < 2) a = -3;
    const y = 50 + Math.round(a);
    px(ctx, x, Math.min(y, prev), 1, Math.abs(y - prev) + 1); // joined up, like a scope trace
    prev = y;
  }
  // LIVE light and CRT scanlines.
  ctx.fillStyle = Math.sin(t * 6) > 0 || talking ? '#ff2a55' : '#4a0d18';
  px(ctx, 8, 8, 3, 3);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let y = 4; y < S - 4; y += 2) px(ctx, 4, y, S - 8, 1);
  ctx.fillStyle = 'rgba(0, 243, 255, 0.06)';
  px(ctx, 4, (t * 40) % (S - 8) + 4, S - 8, 3);
}

// --- The Vex overseer -----------------------------------------------------------------------------
const inTri = (x, y, ax, ay, bx, by, cx, cy) => {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

export function drawVex(ctx, { t = 0, talking = false, mouth = 0 } = {}) {
  // Void backdrop with slow warp rings.
  for (let y = 0; y < S; y++) {
    ctx.fillStyle = y % 2 ? '#0d0218' : '#14042a';
    px(ctx, 0, y, S, 1);
  }
  ctx.fillStyle = 'rgba(181, 101, 255, 0.35)';
  for (let k = 0; k < 2; k++) {
    const r = ((t * 14 + k * 26) % 52) + 8;
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      px(ctx, 36 + Math.cos(ang) * r, 38 + Math.sin(ang) * r * 0.8);
    }
  }
  // The hull-face: an inverted triangle, magenta rim, violet inner plate.
  const A = [6, 8], B = [66, 8], C = [36, 68];
  const A1 = [9, 10], B1 = [63, 10], C1 = [36, 63];
  const a2 = [14, 13], b2 = [58, 13], c2 = [36, 57];
  for (let y = 6; y < 70; y++) {
    for (let x = 4; x < 68; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      if (!inTri(cx, cy, ...A, ...B, ...C)) continue;
      if (inTri(cx, cy, ...a2, ...b2, ...c2)) ctx.fillStyle = (x - y) % 6 === 0 ? '#3a0c5c' : '#26063c';
      else if (inTri(cx, cy, ...A1, ...B1, ...C1)) ctx.fillStyle = y % 4 === 0 ? '#d01fb0' : '#9a1488';
      else ctx.fillStyle = '#ff5ce0';
      px(ctx, x, y);
    }
  }
  // Brow plates and slit eyes, angled down to the centre: a scowl.
  const eye = talking ? '#ffffff' : '#ffb3f2';
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = '#ff2bd6';
    px(ctx, 19 + i, 19 + (i >> 1), 1, 1);
    px(ctx, 52 - i, 19 + (i >> 1), 1, 1);
    ctx.fillStyle = eye;
    px(ctx, 20 + i, 22 + (i >> 1), 1, 2);
    px(ctx, 51 - i, 22 + (i >> 1), 1, 2);
  }
  // The core: a diamond that swells and burns white while it speaks.
  const flare = talking ? mouth : 0;
  const r = 5 + flare;
  const pulse = 0.5 + 0.5 * Math.sin(t * (talking ? 18 : 3));
  for (let dy = -r; dy <= r; dy++) {
    const w = r - Math.abs(dy);
    for (let dx = -w; dx <= w; dx++) {
      const edge = Math.abs(dx) + Math.abs(dy);
      ctx.fillStyle = edge <= 1 ? '#ffffff' : edge <= r - 2 ? (pulse > 0.5 ? '#ffd1f7' : '#ff7ae6') : '#ff2bd6';
      px(ctx, 36 + dx, 36 + dy);
    }
  }
  // Mandible grille under the core lights up bar by bar with the voice.
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = flare > k - 1 && talking ? '#ff7ae6' : '#5a1680';
    px(ctx, 30 + k, 46 + k * 3, 12 - k * 2, 1);
  }
  // Signal glitch: a torn line now and then.
  if ((t * 7) % 5 < 0.4) {
    const gy = 10 + ((t * 97) % 50) | 0;
    ctx.drawImage(ctx.canvas, 0, gy, S, 2, 3, gy, S, 2);
  }
}

// --- Dr. Pixie ----------------------------------------------------------------------------------
// Astra's R&D genius: a cute anime-style science nerd. Messy pink hair with lab goggles pushed up, big
// round glasses, an oversized lab coat over a mint sweater, sticky notes on the blueprint wall behind.
// Moods: neutral, eureka (sparkle eyes, big grin, twinkles), smug (half-lidded, raised brow, smirk) and
// oops (squeezed >< eyes, sweat drop, wobbly mouth). Talking opens the mouth in two frames.
export const PIXIE_MOODS = Object.freeze(['neutral', 'eureka', 'smug', 'oops']);
const P = {
  wall: '#0b2730', grid: '#123f4a', noteY: '#ffe066', noteP: '#ff8fc8', ink: '#6b4a1a',
  hair: '#ff6fb5', hairD: '#c2408a', hairL: '#ffb3da', skin: '#ffe0c8', skinD: '#f4b896', blush: '#ff8fb0',
  frame: '#3b2a5a', lens: '#f4f2ff', iris: '#3a1f6b', irisL: '#7a5cff', white: '#ffffff', mouth: '#5a1830', tongue: '#ff7a9a',
  coat: '#f2f4ff', coatD: '#b9c2e0', sweater: '#36d6c3', band: '#2b2b3f', gogF: '#4a4f68', gogL: '#ffb347', star: '#fff27a', sweat: '#8fe8ff'
};
const disc = (ctx, cx, cy, rx, ry, color, keep = () => true) => {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && keep(x, y)) px(ctx, x, y);
    }
  }
};
const ring = (ctx, cx, cy, r, color) => {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r + 0.5 && d >= r - 0.9) px(ctx, x, y);
    }
  }
};
const twinkle = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  px(ctx, x, y - size, 1, size * 2 + 1);
  px(ctx, x - size, y, size * 2 + 1, 1);
};

export function drawPixie(ctx, { t = 0, talking = false, mouth = 0, mood = 'neutral' } = {}) {
  const m = PIXIE_MOODS.includes(mood) ? mood : 'neutral';
  // Blueprint wall and sticky notes.
  ctx.fillStyle = P.wall;
  px(ctx, 0, 0, S, S);
  ctx.fillStyle = P.grid;
  for (let k = 3; k < S; k += 8) { px(ctx, k, 0, 1, S); px(ctx, 0, k, S, 1); }
  ctx.fillStyle = P.noteY; px(ctx, 3, 5, 9, 9);
  ctx.fillStyle = P.ink; px(ctx, 5, 8, 5, 1); px(ctx, 5, 10, 3, 1);
  ctx.fillStyle = P.noteP; px(ctx, 60, 9, 9, 9);
  ctx.fillStyle = P.ink; px(ctx, 62, 12, 4, 1); px(ctx, 62, 14, 5, 1);

  const bob = talking && mouth === 2 ? 1 : 0; // the head bobs a pixel on the open-mouth frame
  // Oversized lab coat, sleeves past the frame, mint sweater in the V.
  for (let y = 56; y < S; y++) {
    const half = 20 + (y - 56) * 0.9;
    ctx.fillStyle = P.coat;
    px(ctx, 36 - half, y, half * 2, 1);
    ctx.fillStyle = P.coatD;
    px(ctx, 36 - half, y, 2, 1);
    px(ctx, 36 + half - 2, y, 2, 1);
    const v = Math.max(0, 9 - (y - 56) * 0.9);
    ctx.fillStyle = P.sweater;
    px(ctx, 36 - v, y, v * 2, 1);
    ctx.fillStyle = P.coatD;
    px(ctx, 36 - v - 1, y, 1, 1);
    px(ctx, 36 + v, y, 1, 1);
  }
  ctx.fillStyle = '#4a6cff'; px(ctx, 47, 62, 3, 6); // a pen in the breast pocket
  ctx.fillStyle = P.skin; px(ctx, 32, 51 + bob, 8, 6);

  // Hair, back layer: a big messy cloud with side locks.
  disc(ctx, 36, 33 + bob, 23, 22, P.hairD);
  disc(ctx, 36, 32 + bob, 21, 20, P.hair);
  for (const [x, y, h] of [[13, 40, 16], [57, 40, 16], [15, 38, 12], [55, 38, 12]]) { ctx.fillStyle = P.hair; px(ctx, x, y + bob, 3, h); }
  // Strands sticking up: she's been in the lab all night.
  ctx.fillStyle = P.hair;
  for (const [x, y] of [[24, 9], [31, 7], [40, 8], [47, 10], [28, 8]]) px(ctx, x, y + bob, 2, 5);

  // Face.
  disc(ctx, 36, 41 + bob, 14, 14, P.skin);
  ctx.fillStyle = P.skinD;
  for (let y = 44; y <= 54; y++) {
    const w = Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 41) / 14) ** 2)) * 14;
    px(ctx, Math.floor(36 - w), y + bob, 1, 1);
    px(ctx, Math.ceil(36 + w) - 1, y + bob, 1, 1);
  }
  // Bangs: a jagged fringe over the forehead.
  // Bangs: pointed clumps of hair over the forehead (4 px wide, longest in the middle).
  const clumps = [5, 8, 6, 9, 4, 7, 9, 6];
  for (let c = 0; c < clumps.length; c++) {
    for (let k = 0; k < 4; k++) {
      const len = clumps[c] - (k === 0 || k === 3 ? 3 : 0);
      ctx.fillStyle = P.hair;
      px(ctx, 21 + c * 4 + k, 24 + bob, 1, 3 + len);
      ctx.fillStyle = P.hairD;
      if (k === 0) px(ctx, 21 + c * 4, 24 + bob, 1, 3 + len);
    }
  }
  ctx.fillStyle = P.hairL; // shine
  px(ctx, 27, 22 + bob, 6, 1); px(ctx, 40, 21 + bob, 5, 1); px(ctx, 26, 23 + bob, 2, 1);
  // Lab goggles pushed up on the hair.
  ctx.fillStyle = P.band; px(ctx, 14, 17 + bob, 44, 2);
  for (const gx of [28, 44]) {
    disc(ctx, gx, 17 + bob, 4, 4, P.gogL);
    ring(ctx, gx, 17 + bob, 4.5, P.gogF);
    ctx.fillStyle = P.white; px(ctx, gx - 2, 15 + bob, 2, 1);
  }

  // Big round glasses.
  const eyes = [[29, 40 + bob], [43, 40 + bob]];
  for (const [ex, ey] of eyes) disc(ctx, ex, ey, 6, 6, P.lens);
  ctx.fillStyle = P.frame; px(ctx, 35, 39 + bob, 3, 1);
  for (const [ex, ey] of eyes) ring(ctx, ex, ey, 6.5, P.frame);
  // Eyes by mood.
  for (const [ex, ey] of eyes) {
    if (m === 'eureka') {
      const tw = (Math.floor(t * 8) % 2) ? 1 : 0;
      ctx.fillStyle = P.star;
      px(ctx, ex - 1, ey - 3 - tw, 2, 7 + tw * 2);
      px(ctx, ex - 3 - tw, ey - 1, 7 + tw * 2, 2);
      ctx.fillStyle = P.white; px(ctx, ex - 1, ey - 1, 2, 2);
    } else if (m === 'oops') {
      ctx.fillStyle = P.iris;
      const dir = ex < 36 ? 1 : -1; // > <
      for (let k = 0; k < 3; k++) { px(ctx, ex - dir * 2 + dir * k, ey - 2 + k); px(ctx, ex - dir * 2 + dir * k, ey + 2 - k); }
    } else {
      const blink = m !== 'smug' && (t % 3.1) > 2.95;
      if (blink) {
        ctx.fillStyle = P.iris; px(ctx, ex - 2, ey, 5, 1);
      } else {
        const top = m === 'smug' ? ey : ey - 3;
        ctx.fillStyle = P.iris; px(ctx, ex - 2, top, 4, ey + 3 - top);
        ctx.fillStyle = P.irisL; px(ctx, ex - 2, ey + 2, 4, 1);
        if (m === 'smug') { ctx.fillStyle = P.frame; px(ctx, ex - 3, top - 1, 6, 1); }
        else { ctx.fillStyle = P.white; px(ctx, ex - 2, ey - 3, 2, 2); }
      }
    }
  }
  if (m === 'smug') { ctx.fillStyle = P.hairD; px(ctx, 40, 31 + bob, 6, 1); px(ctx, 45, 30 + bob, 2, 1); } // one brow up
  if (m === 'eureka' || m === 'oops') {
    ctx.fillStyle = P.blush;
    px(ctx, 23, 47 + bob, 3, 1);
    px(ctx, 46, 47 + bob, 3, 1);
  }

  // Mouth: talk frames open it; moods shape it.
  const my = 50 + bob;
  if (talking && mouth > 0) {
    const w = m === 'eureka' ? 6 : 3 + mouth;
    ctx.fillStyle = P.mouth; px(ctx, 36 - (w >> 1), my - 1, w, 1 + mouth);
    ctx.fillStyle = P.tongue; px(ctx, 36 - (w >> 1) + 1, my - 1 + mouth, Math.max(1, w - 2), 1);
  } else if (m === 'eureka') {
    ctx.fillStyle = P.mouth; px(ctx, 33, my - 1, 6, 2); px(ctx, 34, my + 1, 4, 1);
    ctx.fillStyle = P.tongue; px(ctx, 35, my + 1, 2, 1);
  } else if (m === 'smug') {
    ctx.fillStyle = P.mouth; px(ctx, 35, my, 3, 1); px(ctx, 38, my - 1, 1, 1);
  } else if (m === 'oops') {
    ctx.fillStyle = P.mouth;
    for (let k = 0; k < 6; k++) px(ctx, 33 + k, my + (k % 2));
  } else {
    ctx.fillStyle = P.mouth; px(ctx, 34, my - 1, 1, 1); px(ctx, 35, my, 3, 1); px(ctx, 38, my - 1, 1, 1);
  }

  // Extras: sparkles round her head for a Eureka, a sweat drop for an oops.
  if (m === 'eureka') {
    const phase = Math.floor(t * 6);
    for (const [k, [x, y]] of [[10, 22], [62, 26], [8, 48], [64, 50]].entries()) {
      const on = (phase + k) % 3;
      if (on) twinkle(ctx, x, y, on, k % 2 ? P.star : P.white);
    }
  } else if (m === 'oops') {
    const dy = Math.floor((t * 6) % 3);
    ctx.fillStyle = P.sweat; px(ctx, 53, 28 + dy, 2, 3); px(ctx, 52, 30 + dy, 4, 2);
  }
}

export function registerStoryPortraits() {
  minerImage(); // start loading now, so the first line never shows the placeholder
  registerPortrait('miner', drawMiner);
  registerPortrait('dispatch', drawDispatch);
  registerPortrait('vex', drawVex);
  registerPortrait('pixie', drawPixie);
}
