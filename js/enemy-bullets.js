// Hostile projectiles (Gunner plasma orbs): pooled, slow and readable, blocked by asteroids.
// All motion is per fixed 60 Hz tick like the rest of the simulation. Player hits use the same
// hull-hugging shield outline as contact damage (shieldTouches), so what you see is what hits you.
import { TUNING } from './config.js';
import { shieldTouches } from './ship-renderer.js';

// Hostile shots share one warm red-orange so they never read as the player's cyan fire.
export const ENEMY_BULLET_HUE = 14;
const LIFE = 4.0;      // seconds before an orb fizzles out
const TRAIL_TICKS = 5; // tail length in ticks of travel (drawn as one line, no history kept)
const TAIL_COLOR = `hsla(${ENEMY_BULLET_HUE}, 100%, 58%, 0.4)`;
const GLOW_COLOR = `hsla(${ENEMY_BULLET_HUE}, 100%, 55%, 0.35)`;
const RING_COLOR = `hsl(${ENEMY_BULLET_HUE}, 100%, 64%)`;

export class EnemyBulletPool {
  constructor(capacity = 160) {
    this.capacity = capacity;
    this.active = [];
    this.free = [];
  }

  clear() {
    while (this.active.length) this.free.push(this.active.pop());
  }

  get count() {
    return this.active.length;
  }

  // Returns the orb, or null when the live cap is reached (the shot is simply skipped).
  spawn(x, y, vx, vy, damage, radius = 7.5) {
    if (this.active.length >= this.capacity) return null;
    const b = this.free.pop() || { x: 0, y: 0, vx: 0, vy: 0, damage: 0, radius: 0, life: 0, age: 0 };
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.damage = damage;
    b.radius = radius;
    b.life = LIFE;
    b.age = 0;
    b.from = null; // shooter kind for the run stats (set by the shooter)
    this.active.push(b);
    return b;
  }

  release(i) {
    const list = this.active;
    const b = list[i];
    list[i] = list[list.length - 1];
    list.pop();
    this.free.push(b);
  }

  // `terrain` is the AsteroidManager (may be null in tests). `onHit(b)` returns true when the orb
  // was absorbed by the ship; false lets it fly on (e.g. through a dash's invulnerability).
  update(dt, player, terrain, particles, worldW, worldH, onHit) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life -= dt;
      b.age += dt;
      if (b.life <= 0 || b.x < 10 || b.y < 10 || b.x > worldW - 10 || b.y > worldH - 10) {
        this.release(i);
        continue;
      }

      if (terrain && this.hitsRock(terrain, b)) {
        particles?.spawnDirectionalSparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 0.9, 4, ENEMY_BULLET_HUE, 5);
        this.release(i);
        continue;
      }

      if (player && shieldTouches(player, TUNING, b.x, b.y, b.radius) && onHit?.(b)) {
        this.release(i);
      }
    }
  }

  hitsRock(terrain, b) {
    const rocks = terrain.getNearbyAsteroids(b.x, b.y, terrain.cellsFor ? terrain.cellsFor(b.radius) : 1);
    for (let j = 0; j < rocks.length; j++) {
      const rock = rocks[j];
      if (rock.hp <= 0) continue;
      const dx = b.x - rock.x;
      const dy = b.y - rock.y;
      const r = rock.radius + b.radius;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  // Hollow hot ring + white core + short tail: big, slow and unmistakably hostile.
  draw(ctx, camX = 0, camY = 0, viewW = Infinity, viewH = Infinity) {
    const list = this.active;
    if (list.length === 0) return;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const r = b.radius;
      if (b.x + r * 4 < camX || b.y + r * 4 < camY || b.x - r * 4 > camX + viewW || b.y - r * 4 > camY + viewH) continue;
      const pulse = 1 + Math.sin(b.age * 18) * 0.12;
      const tailX = b.x - b.vx * TRAIL_TICKS;
      const tailY = b.y - b.vy * TRAIL_TICKS;

      ctx.strokeStyle = TAIL_COLOR;
      ctx.lineWidth = r * 1.4;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = GLOW_COLOR;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = RING_COLOR;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fff4e8';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
