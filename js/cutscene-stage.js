// CUTSCENE STAGE: plays a story script (js/story.js) in the real engine. The Game hands over its world
// (grid, rocks, enemies, particles, camera, ship) while state is 'CUTSCENE'; the stage drives the ship,
// camera, warp gates and spawns through the script's actions, owns the DOM layer (#cutscene-layer:
// letterbox, title card, fade, SKIP, the dialogue box) and the cutscene input. Nothing here touches the
// run's score, stats or rewards: rocks are never broken and nothing dies, and Game.startGame builds a fresh
// run afterwards. Game wires it in with a few calls (play / update / drawWorld / handleKey).
import { Cutscene } from './cutscene.js';
import { DialogueBox } from './dialogue.js';
import { registerStoryCast } from './story.js';
import { updateShipAnimation } from './ship-renderer.js';
import { drawEliteRift } from './lieutenants.js';
import { PAD } from './gamepad.js';

const GATE_HUES = [300, 272, 325];
const ENEMY_CREEP = 0.12; // share of their normal speed the arrivals move at (a menacing drift)

const turnToward = (from, to, step) => {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-step, Math.min(step, d));
};
const ease = (k) => k * k * (3 - 2 * k);

export class CutsceneStage {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.scene = null;
    this.dialogue = new DialogueBox({ sound: game.sound });
    this.gates = [];
    this.layer = null;
  }

  bind() {
    if (this.layer) return true;
    const doc = globalThis.document;
    this.layer = doc?.getElementById('cutscene-layer') || null;
    if (!this.layer) return false;
    this.fadeEl = doc.getElementById('cutscene-fade');
    this.cardEl = doc.getElementById('cutscene-card');
    doc.getElementById('btn-cutscene-skip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    // Click / tap anywhere else moves the dialogue on.
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('#btn-cutscene-skip')) return;
      this.advance();
    });
    return true;
  }

  // Start `script`; onEnd(reason) runs once it finishes ('done') or is skipped ('skip').
  play(script, { onEnd = null } = {}) {
    if (this.active) return false;
    registerStoryCast();
    this.bind();
    this.onEnd = onEnd;
    this.active = true;
    this.gates = [];
    this.setup();
    const doc = globalThis.document;
    doc?.body?.classList.add('cutscene-on');
    this.layer?.classList.remove('hidden');
    this.layer?.classList.remove('letterboxed');
    this.setFade(1, 0);
    this.cardEl?.classList.add('hidden');
    this.scene = new Cutscene(script, { actions: this.actions(), dialogue: this.dialogue, onEnd: (reason) => this.finish(reason) });
    this.scene.start();
    return true;
  }

  skip() {
    this.scene?.skip();
  }

  advance() {
    if (this.scene?.advance()) this.game.sound?.playUiSelect?.();
  }

  finish(reason) {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    g.sound?.setMusicDuck?.(1);
    this.dialogue.hide();
    this.layer?.classList.add('hidden');
    this.layer?.classList.remove('letterboxed');
    globalThis.document?.body?.classList.remove('cutscene-on');
    g.enemyManager?.clear?.();
    this.gates = [];
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.(reason);
  }

  // The ship parks on the right face of the biggest asteroid near the sector's centre, claws in, facing left; the warp gates will open on the right, above the dialogue box.
  setup() {
    const g = this.game;
    const p = g.player;
    p.vx = p.vy = 0;
    // Asteroids are groups of nodes: take the biggest group nearby and drill its rightmost node.
    const rocks = (g.asteroidManager?.asteroids || []).filter((r) => !r.unbreakable && r.hp > 0 && Math.hypot(r.x - p.x, r.y - p.y) < 800);
    const groups = new Map();
    for (const r of rocks) groups.set(r.group || r, [...(groups.get(r.group || r) || []), r]);
    const mass = (list) => list.reduce((t, r) => t + r.radius * r.radius, 0);
    const best = [...groups.values()].sort((a, b) => mass(b) - mass(a))[0] || [];
    const rock = best.sort((a, b) => (b.x + b.radius) - (a.x + a.radius))[0] || null;
    this.rock = rock;
    if (rock) {
      p.x = rock.x + rock.radius + p.radius * 1.55;
      p.y = rock.y;
    }
    p.hullAngle = p.angle = Math.PI;
    p.clawAngles = [p.hullAngle, p.hullAngle];
    this.drilling = false;
    this.facing = null;
    this.backT = 0;
    this.cameraFocus = 'ship';
    this.tremorLeft = 0;
    // Gates: to the right of the ship, sized to the screen so all three show above the dialogue box.
    const w = g.width, h = g.height;
    this.gateSpots = [[0.36, -0.2], [0.5, 0], [0.38, 0.16]].map(([fx, fy]) => ({ x: p.x + w * fx, y: p.y + h * fy }));
    this.focus = this.focusPoint();
    this.snapCamera();
  }

  // Where the camera centres: the ship sits left of centre and a little high (the dialogue box is below);
  // when the gates open it eases over to take them in.
  focusPoint() {
    const g = this.game;
    const p = g.player;
    const toGates = this.cameraFocus === 'gates';
    return { x: p.x + g.width * (toGates ? 0.24 : 0.2), y: p.y + g.height * (toGates ? 0.08 : 0.1) };
  }

  snapCamera() {
    const g = this.game;
    g.camX = Math.max(0, Math.min(g.worldWidth - g.width, this.focus.x - g.width * 0.5));
    g.camY = Math.max(0, Math.min(g.worldHeight - g.height, this.focus.y - g.height * 0.5));
  }

  // The script's stage actions (see OPENING_SCENE in js/story.js).
  actions() {
    const g = this.game;
    return {
      music: (s) => {
        if (s.scene) g.sound?.setMusicScene?.(s.scene);
        if (s.muffled !== undefined) g.sound?.setMusicState?.({ intensity: 0.3, muffled: s.muffled, boss: 0 });
        if (s.duck !== undefined) g.sound?.setMusicDuck?.(s.duck);
      },
      letterbox: (s) => { this.layer?.classList.toggle('letterboxed', s.on !== false); },
      fade: (s) => { this.setFade(s.to ?? 0, s.time ?? 0.6); },
      card: (s) => this.showCard(s),
      drill: () => { this.drilling = true; },
      stopDrill: () => {
        this.drilling = false;
        this.facing = 'gates';
      },
      camera: (s) => {
        this.cameraFocus = s.focus;
      },
      tremor: (s) => this.tremor(s),
      gates: () => this.openGates(),
      swarm: (s) => this.spawnSwarm(s),
      sound: (s) => g.sound?.[s.name]?.(),
      cut: () => this.hardCut()
    };
  }

  setFade(to, time) {
    if (!this.fadeEl) return;
    this.fadeEl.style.transition = time > 0 ? `opacity ${time}s ease` : 'none';
    this.fadeEl.style.background = '#000';
    this.fadeEl.style.opacity = String(to);
  }

  showCard(s) {
    const el = this.cardEl;
    if (!el) return;
    el.querySelector('.cs-card-title').textContent = s.title || '';
    el.querySelector('.cs-card-sub').textContent = s.sub || '';
    el.classList.remove('hidden', 'cs-card-out');
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => el.classList.add('cs-card-out'), Math.max(0.4, (s.time ?? 2) - 0.4) * 1000);
  }

  // The grid buckles and the screen shakes: something is coming through.
  tremor(s) {
    const g = this.game;
    const p = g.player;
    this.tremorLeft = s.time ?? 1;
    this.tremorPower = s.strength ?? 1;
    g.sound?.playRiftOpen?.();
    for (const spot of this.gateSpots) g.grid?.ripple?.(spot.x, spot.y, 260, 290, 0.8);
    g.grid?.applyImpulse?.(p.x, p.y, 30, 420, 285);
  }

  openGates() {
    const g = this.game;
    this.gates = this.gateSpots.map((spot, i) => ({ ...spot, age: -i * 0.18, hue: GATE_HUES[i % GATE_HUES.length], radius: i === 1 ? 26 : 20 }));
    g.sound?.playWarpSting?.();
    g.shake = Math.max(g.shake || 0, 16);
    g.chromaFlash = Math.max(g.chromaFlash || 0, 0.5);
    for (const gate of this.gates) {
      g.grid?.applyImpulse?.(gate.x, gate.y, 70, 300, gate.hue);
      g.grid?.ripple?.(gate.x, gate.y, 340, gate.hue, 1.2);
      g.particles?.spawnShockwave?.(gate.x, gate.y, 220, gate.hue, 4, 0.6);
    }
  }

  // The first wave pours out of the gates: the real spawn telegraphs and the real enemies.
  spawnSwarm(s) {
    const em = this.game.enemyManager;
    if (!em) return;
    const per = s.count ?? 5;
    this.gates.forEach((gate, gi) => {
      for (let k = 0; k < per; k++) {
        const a = (k / per) * Math.PI * 2 + gi;
        const r = 14 + (k % 2) * 22;
        const type = gi === 1 && k % 2 === 0 ? 'pinwheel' : 'swarmer';
        em.queueSpawn(type, gate.x + Math.cos(a) * r, gate.y + Math.sin(a) * r, 1, { warmup: 0.6 + k * 0.14 + gi * 0.1, onScreen: true, vx: 0, vy: 0 });
      }
    });
    this.game.sound?.playRiftWarp?.();
  }

  hardCut() {
    const el = this.fadeEl;
    if (el) {
      el.style.transition = 'none';
      el.style.background = '#fff';
      el.style.opacity = '1';
    }
    this.game.sound?.playBossArrival?.();
  }

  // One sim tick of the scene: the script, then the world it stages.
  update(dt, gp = null) {
    if (!this.active) return;
    if (gp?.pressed?.(PAD.START) || gp?.pressed?.(PAD.BACK)) {
      this.skip();
      return;
    }
    if (gp?.pressed?.(PAD.A)) this.advance();
    this.scene?.update(dt);
    if (!this.active) return;
    this.updateWorld(dt);
  }

  updateWorld(dt) {
    const g = this.game;
    const p = g.player;
    const am = g.asteroidManager;
    // Ship: claws in the rock while drilling (the rock never breaks), else ease back and face the gates.
    p.vx = p.vy = 0;
    if (this.drilling && this.rock) {
      const to = Math.atan2(this.rock.y - p.y, this.rock.x - p.x);
      p.hullAngle = turnToward(p.hullAngle ?? to, to, dt * 4);
      p.angle = turnToward(p.angle ?? to, to + Math.sin(this.scene.time * 0.8) * 0.5, dt * 2); // the turret idly scans
    } else if (this.facing === 'gates' && this.gateSpots) {
      const mid = this.gateSpots[1];
      const to = Math.atan2(mid.y - p.y, mid.x - p.x);
      const back = this.rock ? Math.atan2(p.y - this.rock.y, p.x - this.rock.x) : to;
      const k = Math.min(1, (this.backT = (this.backT || 0) + dt) / 0.8);
      const step = (1 - k) * 2.2;
      p.x += Math.cos(back) * step;
      p.y += Math.sin(back) * step;
      p.vx = Math.cos(back) * step;
      p.vy = Math.sin(back) * step;
      p.hullAngle = turnToward(p.hullAngle, to, dt * 5);
      p.angle = turnToward(p.angle, to, dt * 6);
    }
    const aims = am?.clawAims?.(p) ?? [p.hullAngle, p.hullAngle];
    for (let k = 0; k < 2; k++) p.clawAngles[k] = turnToward(p.clawAngles[k], this.drilling ? aims[k] : p.hullAngle, dt * 8);
    p.drillAngle = Math.atan2(Math.sin(p.clawAngles[0]) + Math.sin(p.clawAngles[1]), Math.cos(p.clawAngles[0]) + Math.cos(p.clawAngles[1]));
    if (am && this.drilling) {
      am.update(dt, p, [], [], () => {}, g.particles);
      if (this.rock) this.rock.hp = Math.max(this.rock.hp, this.rock.maxHp * 0.55);
    } else if (am) {
      am.isDrilling = false;
    }
    p.drillSpin = (p.drillSpin || 0) + dt * (am?.isDrilling ? 34 : 11);
    updateShipAnimation(p, dt);

    // Warp gates open, then the arrivals drift out of them at a fraction of their speed.
    for (const gate of this.gates) gate.age += dt;
    const em = g.enemyManager;
    if (em) {
      const before = em.enemies.map((e) => [e.x, e.y]);
      em.update(dt, p, [], g.grid, g.particles, g.worldWidth, g.worldHeight);
      for (let i = 0; i < Math.min(before.length, em.enemies.length); i++) {
        const e = em.enemies[i];
        e.x = before[i][0] + (e.x - before[i][0]) * ENEMY_CREEP;
        e.y = before[i][1] + (e.y - before[i][1]) * ENEMY_CREEP;
      }
    }

    if (this.tremorLeft > 0) {
      this.tremorLeft -= dt;
      g.shake = Math.max(g.shake || 0, 7 * this.tremorPower);
      if (Math.random() < 0.25) {
        const s = this.gateSpots[(Math.random() * 3) | 0];
        g.grid?.applyImpulse?.(s.x, s.y, 22 * this.tremorPower, 220, 290);
      }
    }

    // Camera: eases toward the scene's focus.
    const focus = this.focusPoint();
    const k = Math.min(1, dt * 2.2);
    this.focus.x += (focus.x - this.focus.x) * k;
    this.focus.y += (focus.y - this.focus.y) * k;
    const tx = Math.max(0, Math.min(g.worldWidth - g.width, this.focus.x - g.width * 0.5));
    const ty = Math.max(0, Math.min(g.worldHeight - g.height, this.focus.y - g.height * 0.5));
    g.camX += (tx - g.camX) * 0.25;
    g.camY += (ty - g.camY) * 0.25;
  }

  // World-space: the warp gates, concentric rings round the real elite-rift tear (drawn additive with
  // the enemies).
  drawWorld(ctx) {
    if (!this.active || !this.gates.length) return;
    for (const gate of this.gates) {
      if (gate.age <= 0) continue;
      const open = ease(Math.min(1, gate.age / 0.9));
      const R = gate.radius * 4.2 * open;
      ctx.save();
      ctx.translate(gate.x, gate.y);
      for (let k = 0; k < 4; k++) {
        const phase = ((gate.age * 0.9 + k * 0.25) % 1);
        const r = R * (0.35 + 0.65 * phase);
        ctx.strokeStyle = `hsla(${gate.hue + k * 8}, 100%, ${62 + k * 6}%, ${(1 - phase) * 0.75 * open})`;
        ctx.lineWidth = 3 - k * 0.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.62, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = `hsla(${gate.hue}, 100%, 80%, ${0.9 * open})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.62, R, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawEliteRift(ctx, { x: gate.x, y: gate.y, timer: gate.age, config: { radius: gate.radius } }, open, gate.hue);
    }
  }

  // Keyboard while the cutscene plays: Space / Enter / Z move the dialogue on, Esc skips. Everything
  // else is swallowed so nothing behind the scene reacts.
  handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') this.skip();
    else if (['Space', 'Enter', 'NumpadEnter', 'KeyZ', 'KeyX'].includes(e.code)) this.advance();
  }
}
