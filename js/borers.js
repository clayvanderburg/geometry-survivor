// BORER: a mid-size rock-eater with a spinning drill nose. It tunnels straight through asteroids toward
// the ship (it mines rock like an elite, at borerMiningMult), and two attacks come out of that:
//   BORE   — it locks a lane for `aim` s (tracks, then locks red), then charges down it at boreSpeed,
//            grinding at boreMiningMult so rock in the lane shatters; it vents for `recover` s after.
//   GRAVEL — while its drill is in rock it spits the rubble back at the ship: a fan of `gravelShots`
//            slow shards every `gravelEvery` s (AsteroidManager flags e.grindT while it grinds).
// Timers are seconds; speeds are px per fixed 60 Hz tick, like the rest of the sim.
import { TUNING } from './config.js';
import { turnToward } from './serpents.js';

export const BORER = {
  turnRate: 2, triggerRange: 520, aim: 0.9, lockAt: 0.35, bore: 0.75, boreSpeed: 7.5, recover: 0.7, cooldown: 4,
  gravelEvery: 0.9, gravelShots: 3, gravelSpread: 0.24, gravelSpeed: 3.6, gravelLife: 2.4, gravelRange: 750,
  knockMult: 0.45
};

export const boreLength = (e) => BORER.boreSpeed * (e.speedScale || 1) * BORER.bore * 60;

export function updateBorer(e, m, env) {
  const { dirX, dirY, dist, dt } = env;
  const toPlayer = Math.atan2(dirY, dirX);
  e.drillSpin = (e.drillSpin || 0) + dt * (e.state === 'bore' ? 26 : e.grindT > 0 ? 16 : 7);
  if (e.grindT > 0) {
    e.grindT -= dt;
    // Gravel: the rubble it digs comes back out at the ship.
    e.gravelT = (e.gravelT ?? BORER.gravelEvery * 0.5) - dt;
    if (e.gravelT <= 0 && dist < BORER.gravelRange) {
      e.gravelT = BORER.gravelEvery;
      for (let k = 0; k < BORER.gravelShots; k++) {
        const a = toPlayer + (k - (BORER.gravelShots - 1) / 2) * BORER.gravelSpread;
        const b = m.enemyBullets?.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius,
          Math.cos(a) * BORER.gravelSpeed, Math.sin(a) * BORER.gravelSpeed, TUNING.enemyBulletDamage ?? 12, 6);
        if (b) {
          b.life = BORER.gravelLife;
          b.from = e.type;
        }
      }
    }
  }
  e.aiTimer -= dt;
  if (e.state === 'aim') {
    // Tracks the ship, then the lane locks for the last `lockAt` s: sidestep it.
    if (e.aiTimer > BORER.lockAt) e.aimAngle = turnToward(e.aimAngle, toPlayer, BORER.turnRate * 1.6 * dt);
    e.vx *= 0.8;
    e.vy *= 0.8;
    if (e.aiTimer <= 0) {
      e.state = 'bore';
      e.boring = true; // AsteroidManager lets it ram through the rock it grinds
      e.aiTimer = BORER.bore;
      e.burstSpeed = BORER.boreSpeed * (e.speedScale || 1);
      e.knockMult = 0;
      env.grid?.applyImpulse(e.x, e.y, 30, 120, e.hue);
    }
  } else if (e.state === 'bore') {
    e.vx = Math.cos(e.aimAngle) * e.burstSpeed;
    e.vy = Math.sin(e.aimAngle) * e.burstSpeed;
    if (e.aiTimer <= 0) {
      e.state = 'recover';
      e.boring = false;
      e.aiTimer = BORER.recover;
      e.burstSpeed = 0;
      e.knockMult = BORER.knockMult;
    }
  } else if (e.state === 'recover') {
    e.vx *= 0.88;
    e.vy *= 0.88;
    if (e.aiTimer <= 0) {
      e.state = 'hunt';
      e.aiTimer = BORER.cooldown * (0.8 + Math.random() * 0.4);
    }
  } else {
    // Hunt: nose toward the ship and push straight on, through rock if need be.
    if (e.state !== 'hunt') {
      e.state = 'hunt';
      e.aiTimer = BORER.cooldown * (0.5 + Math.random() * 0.5);
    }
    e.aimAngle = turnToward(e.aimAngle ?? toPlayer, toPlayer, BORER.turnRate * dt);
    e.vx = (e.vx + Math.cos(e.aimAngle) * e.speed * 0.2 + env.sepX) * 0.9;
    e.vy = (e.vy + Math.sin(e.aimAngle) * e.speed * 0.2 + env.sepY) * 0.9;
    if (e.aiTimer <= 0 && dist < BORER.triggerRange && dist > e.radius + 40) {
      e.state = 'aim';
      e.aiTimer = BORER.aim;
    }
  }
  e.rotation = e.aimAngle;
}

// Local coordinates (nose along +x): a squat hull with exhaust fins behind a cone drill whose thread
// lines run back along it as it spins.
export function traceBorer(ctx, e, r) {
  ctx.moveTo(r * 0.25, -r * 0.62);
  ctx.lineTo(-r * 0.75, -r * 0.62);
  ctx.lineTo(-r * 1.05, -r * 0.95);
  ctx.lineTo(-r * 1.05, r * 0.95);
  ctx.lineTo(-r * 0.75, r * 0.62);
  ctx.lineTo(r * 0.25, r * 0.62);
  ctx.closePath();
  // The cone.
  ctx.moveTo(r * 0.25, -r * 0.62);
  ctx.lineTo(r * 1.55, 0);
  ctx.lineTo(r * 0.25, r * 0.62);
  // Threads: diagonal bands that crawl toward the tip with the spin.
  const phase = ((e.drillSpin || 0) % 1 + 1) % 1;
  for (let k = 0; k < 3; k++) {
    const f = ((k + phase) / 3) * 0.85;
    const x = r * (0.25 + 1.3 * f);
    const h = r * 0.62 * (1 - f);
    ctx.moveTo(x, -h);
    ctx.lineTo(x + r * 0.22, h);
  }
}

// The bore lane while it aims: a long box with chevrons filling outward, red once it locks.
export function drawBoreLane(ctx, e) {
  if (e.state !== 'aim') return;
  const t = 1 - Math.max(0, e.aiTimer) / BORER.aim;
  const locked = e.aiTimer <= BORER.lockAt;
  const len = boreLength(e) + e.radius;
  const w = e.radius * 0.9;
  const flash = 0.5 + 0.5 * Math.cos(e.aiTimer * Math.PI * (locked ? 16 : 8));
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.aimAngle);
  ctx.strokeStyle = `hsla(${locked ? 0 : e.hue}, 100%, 62%, ${0.25 + t * 0.4 + flash * 0.2})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(e.radius * 1.4, -w, len, w * 2);
  ctx.setLineDash([]);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  const count = 5;
  for (let k = 0; k < count; k++) {
    if (k / count > t) break;
    const x = e.radius * 1.4 + len * ((k + 0.5) / count);
    ctx.moveTo(x - w * 0.45, -w * 0.6);
    ctx.lineTo(x, 0);
    ctx.lineTo(x - w * 0.45, w * 0.6);
  }
  ctx.stroke();
  ctx.restore();
}
