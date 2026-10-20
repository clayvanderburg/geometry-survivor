// PORTRAITS for the dialogue box (js/dialogue.js): 72×72 pixel art, drawn a frame at a time on the box's
// canvas (CSS scales it up pixel-crisp). Each one has a talk animation driven by `mouth` (0 / 1 / 2).
//   miner    — our pilot, cropped from the splash key art (assets/cutscene/miner.png, cigarette painted
//              out to keep it PG): mouth flaps, his toothpick bobs and flicks, a glint sweeps the visor
//              shades now and then (his "blink").
//   dispatch — ASTRA MINING mission control, audio only: the Astra logo on a CRT and a voice waveform.
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

export function registerStoryPortraits() {
  minerImage(); // start loading now, so the first line never shows the placeholder
  registerPortrait('miner', drawMiner);
  registerPortrait('dispatch', drawDispatch);
  registerPortrait('vex', drawVex);
}
