// Large animated ship for the title screen and the pause menu: the real crab ship art (ship-renderer.js)
// drawn big into its own canvas, idling in place with its legs scuttling and drill-claws spinning. It
// reads the live player each frame, so the drill size (Tectonic Claw Bore) and shield charge match the
// ship in the run. Drawn from Game.loop only while its canvas is on screen.
import { drawCrabShip, drawPlayerShield } from './ship-renderer.js';

const TURN_SPEED = 0.32;   // rad/s: the slow idle turn
const BITE_EVERY = 4.5;    // seconds between drill bites (the drilling colours and faster spin)
const BITE_TIME = 1.4;
const SHIELD_ALPHA = 0.35;

// Furthest point of the ship from its centre (drill tips plus the shield's padding and glow) in ship
// units, so the preview can scale it to fit while it turns.
export function shipExtent(radius, drillScale = 1) {
  return radius * 1.42 + 18 * Math.max(1, drillScale) + radius * 0.38 + 6;
}

// Pose of the preview ship `t` seconds in: a copy of the player's look (radius, drill size, shield)
// at the origin with the idle animation applied. Pure, so tests can check it.
export function previewShip(player, t, tuning = {}) {
  const radius = player?.radius || tuning.shipRadius || 15;
  const drillScale = player?.stats?.drillScale || tuning.drillScale || 1.15;
  const maxHp = Math.max(1, player?.maxHp || 100);
  const hp = Math.max(0, Math.min(maxHp, player?.hp ?? maxHp));
  const phase = t % BITE_EVERY;
  const drilling = phase > BITE_EVERY - BITE_TIME;
  const bitten = Math.floor(t / BITE_EVERY) * BITE_TIME + Math.max(0, phase - (BITE_EVERY - BITE_TIME)); // seconds spent drilling
  const heading = -Math.PI / 2 + t * TURN_SPEED;
  return {
    drilling,
    ship: {
      x: 0, y: 0, radius, hp, maxHp, invuln: 0, shieldFlash: 0,
      drillAngle: heading,
      hullAngle: heading,
      angle: heading + Math.sin(t * 0.9) * 0.7, // the turret sweeps independently of the hull
      // Drill threads spin at the game's idle / drilling rpm (11 / 34).
      drillSpin: t * 11 + bitten * 23,
      stats: { drillScale },
      ...(player?.look ? { look: player.look } : {}) // a Hangar ship's silhouette (js/ships.js)
    }
  };
}

export class ShipPreview {
  // getPlayer() -> the player to mirror (or null for a fresh ship); tuning: the live TUNING object.
  constructor(canvas, { getPlayer = () => null, tuning = {} } = {}) {
    this.canvas = canvas || null;
    this.ctx = canvas?.getContext?.('2d') || null;
    this.getPlayer = getPlayer;
    this.tuning = tuning;
    this.start = null;
  }

  visible() {
    const c = this.canvas;
    return !!(c && c.clientWidth > 0 && c.clientHeight > 0 && c.getClientRects?.().length);
  }

  frame(now = performance.now()) {
    const ctx = this.ctx;
    if (!ctx || !this.visible()) {
      this.start = null;
      return;
    }
    if (this.start === null) this.start = now;
    const c = this.canvas;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const t = (now - this.start) / 1000;
    const { ship, drilling } = previewShip(this.getPlayer(), t, this.tuning);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const scale = (Math.min(w, h) / 2) / shipExtent(ship.radius, ship.stats.drillScale);
    this.drawStage(ctx, cx, cy, Math.min(w, h) / 2, t);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = 'lighter';
    // The shield is drawn faint here: blown up this big its glow would hide the hull and the drill-claws.
    ctx.globalAlpha = SHIELD_ALPHA;
    drawPlayerShield(ctx, ship, 0.5 + Math.sin(t * 2.4) * 0.5, this.tuning, t * 1.4, now);
    ctx.globalAlpha = 1;
    drawCrabShip(ctx, ship, this.tuning, drilling, now);
    ctx.restore();
  }

  // Hangar pad under the ship: a soft glow and two slowly turning rings of ticks.
  drawStage(ctx, cx, cy, r, t) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    glow.addColorStop(0, 'rgba(0, 243, 255, 0.10)');
    glow.addColorStop(0.7, 'rgba(0, 243, 255, 0.03)');
    glow.addColorStop(1, 'rgba(0, 243, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.lineWidth = Math.max(1, r * 0.006);
    for (const [k, dir, alpha] of [[0.92, 1, 0.28], [0.74, -1, 0.18]]) {
      const ringR = r * k;
      ctx.strokeStyle = `rgba(0, 243, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2 + t * 0.12 * dir;
        const len = i % 4 === 0 ? r * 0.05 : r * 0.022;
        ctx.moveTo(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR);
        ctx.lineTo(cx + Math.cos(a) * (ringR - len), cy + Math.sin(a) * (ringR - len));
      }
      ctx.stroke();
    }
  }
}
