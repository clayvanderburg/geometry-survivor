// Cached glow sprites. A canvas shadow (shadowBlur) drawn while globalCompositeOperation is 'lighter'
// makes Chromium blur a layer the size of the whole canvas, for every shape: about 15 ms per gold coin at
// 1080p in software and a full-screen pass on a GPU. The pickups glow inside the additive layer, so their
// shadow is rendered once per (shape, size, render scale) into a small canvas and stamped with
// drawImage; the shape itself is still filled as a vector on top. Same order and blend as the shadowed
// fill (shadow first, then the shape, both added), to within 2/255 per channel.

const MAX_SPRITES = 96;
const SIZE_STEPS = 8; // radius quantized to 1/8 px

const defaultCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null);

export class GlowSprites {
  constructor(createCanvas = defaultCanvas) {
    this.createCanvas = createCanvas;
    this.cache = new Map();
  }

  // The shadow alone (no shape) of `path(ctx, r)` filled with `fill`, blurred `blur` device px in
  // `color`, at render scale `rs`. Returns { canvas, size } (size in world px) or null without a canvas.
  get(kind, r, rs, { blur, color, fill, path, extent = r }) {
    const q = Math.round(r * SIZE_STEPS);
    const key = `${kind}|${q}|${rs}`;
    let sprite = this.cache.get(key);
    if (sprite !== undefined) return sprite;
    if (this.cache.size >= MAX_SPRITES) this.cache.clear();
    sprite = null;
    const canvas = this.createCanvas();
    const ctx = canvas?.getContext?.('2d');
    if (ctx) {
      const rq = q / SIZE_STEPS;
      const ext = (extent * rq) / r;
      // A Gaussian shadow fades out by ~1.5 x shadowBlur device px past the shape's edge.
      const half = Math.ceil(ext * rs + blur * 1.5 + 2);
      canvas.width = canvas.height = half * 2;
      // The shape sits far off the canvas and only its offset shadow lands on it.
      const off = half * 2 + blur * 4 + 16;
      ctx.translate(half - off, half);
      ctx.scale(rs, rs);
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = off;
      ctx.fillStyle = fill;
      ctx.beginPath();
      path(ctx, rq);
      ctx.fill();
      sprite = { canvas, size: (half * 2) / rs };
    }
    this.cache.set(key, sprite);
    return sprite;
  }

  // Stamps the glow centred on the current origin (the caller has translated / rotated to the shape).
  draw(ctx, kind, r, rs, opts) {
    const s = this.get(kind, r, rs, opts);
    if (!s) return false;
    ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
    return true;
  }
}
