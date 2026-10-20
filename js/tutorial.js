// TUTORIAL: a short slide show for new pilots (#tutorial-modal). It opens by itself on the first LAUNCH
// on a device (the run starts when it closes), never again once seen, can be skipped from every slide,
// and is replayed from the 🎓 TUTORIAL buttons (title screen and pause menu). Each slide is a clip of the real game (assets/tutorial/*.webp, captured by
// tools/tutorial-media.cjs) and one or two short lines. The last slide points to the Field Guide.
//
// KEEP IT ACCURATE. When a change alters something a slide says or shows (controls, the shield, mining
// and veins, gold / reroll / lock, level-ups, weapon slots, lieutenants, bosses, Void Cores / armory),
// update the slide text here and re-capture the clips (`npm run tutorial-media`). Every minor version
// bump (new content) must also re-check the slides and set TUTORIAL_REVIEWED_FOR to the new major.minor:
// tests/tutorial.test.js fails until it does. Keep it brief: short lines, few slides.
//
// HTML is built by pure functions (tested in node); TutorialUI wires it into the DOM. Storage may be
// blocked: every access is guarded and the tutorial then simply shows once per page load.
import { TUNING } from './config.js';

export const TUTORIAL_SEEN_KEY = 'vexolith_tutorial_seen';
// The GAME_VERSION major.minor the slides were last checked against (see the rule above).
export const TUTORIAL_REVIEWED_FOR = '0.43';
export const TUTORIAL_MEDIA_DIR = 'assets/tutorial/';

// Lines are plain text with **bold** and [[gold|green|purple:colored]] spans. A line may be an object
// with a variant per input: keyboard (mouse + keys), touch (phone / tablet) and pad (controller).
export function tutorialSlides(tuning = TUNING) {
  const slots = tuning.weaponSlots ?? 6;
  const ltWave = tuning.lieutenantFirstWave ?? 2;
  return [
    {
      id: 'fly', title: 'FLY & FIGHT', media: 'fly.webp',
      alt: 'The crab ship flying loops and shooting a swarm',
      lines: [
        {
          keyboard: '**WASD** flies · **mouse** aims · your guns fire on their own.',
          touch: '**Left thumb** flies · **right thumb** aims · your guns fire on their own.',
          pad: '**Left stick** flies · **right stick** aims · your guns fire on their own.'
        },
        {
          keyboard: '**SPACE** dashes through danger. **E** fires a **NOVA** that blasts everything nearby (limited supply).',
          touch: '**DASH** slips through danger. **NOVA** blasts everything nearby (limited supply).',
          pad: '**A** dashes through danger. **B** fires a **NOVA** that blasts everything nearby (limited supply).'
        }
      ]
    },
    {
      id: 'survive', title: 'SURVIVE THE SWARM', media: 'swarm.webp',
      alt: 'The ship kiting a crowd of enemies',
      lines: [
        'Your **SHIELD** is your life. Hits drain it and it slowly recharges.',
        'Enemies come in **waves** that keep getting tougher. Keep moving and don\'t get boxed in.'
      ]
    },
    {
      id: 'mine', title: 'MINE ASTEROIDS', media: 'mine.webp',
      alt: 'The ship drilling through asteroids with gold and green veins',
      lines: [
        'Fly into rock to drill it: only your **drill-claws** break it. Rock is cover, a tunnel is an escape. Violet **bedrock** never breaks.',
        '[[gold:◆ Gold veins]] pay gold to change your upgrade choices. [[green:Green veins]] restore your shield. [[purple:Purple cores]] give ❖ Void Cores.'
      ]
    },
    {
      id: 'levelup', title: 'LEVEL UP', media: 'levelup.webp',
      alt: 'The level-up screen with a NEW WEAPON card and an upgrade card',
      lines: [
        `Kills drop **XP**. Level up and pick a card: a **NEW WEAPON** (up to ${slots}) or an upgrade.`,
        'Every new weapon unlocks a bonus: **more cards to pick from**, more damage. Spend [[gold:◆ gold]] to **REROLL** or **LOCK** cards.'
      ]
    },
    {
      id: 'bosses', title: 'ELITES & BOSSES', media: 'boss.webp',
      alt: 'A boss warping in next to the ship',
      lines: [
        `From wave ${ltWave}, a named **LIEUTENANT** elite hunts you.`,
        'Every **5th wave** a **BOSS** arrives (a bigger one every **10th**) with new enemies and a supply cache. Beat the wave **50** boss to win.',
        'A **red lane** means a boss is about to **charge** down it.'
      ]
    },
    {
      id: 'ready', title: 'YOU\'RE READY, PILOT', media: 'armory.webp', final: true,
      alt: 'The Void Armory of permanent upgrades',
      lines: [
        'When your shield breaks the run ends, but your ❖ **Void Cores** stay. Spend them in the **VOID ARMORY** on permanent upgrades.',
        'For in-depth info, check our handy **📖 FIELD GUIDE**.'
      ]
    }
  ];
}

export function readTutorialSeen(storage) {
  try { return !!storage?.getItem(TUTORIAL_SEEN_KEY); } catch { return false; }
}

export function writeTutorialSeen(storage) {
  try { storage?.setItem(TUTORIAL_SEEN_KEY, '1'); return true; } catch { return false; }
}

export function defaultTutorialStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The line for this input (object lines), escaped, with **bold** and [[color:text]] markup applied.
export function tutorialLineHTML(line, input = 'keyboard') {
  const text = typeof line === 'string' ? line : (line[input] ?? line.keyboard);
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[\[(gold|green|purple):(.+?)\]\]/g, '<b class="tut-$1">$2</b>');
}

export function tutorialSlideHTML(slide, index, count, input = 'keyboard') {
  const lines = slide.lines.map(l => `<p>${tutorialLineHTML(l, input)}</p>`).join('');
  const guide = slide.final ? '<button type="button" class="neon-btn guide-open-btn tutorial-guide-btn" data-tutorial-guide>📖 OPEN FIELD GUIDE</button>' : '';
  return `<div class="tutorial-media"><img src="${TUTORIAL_MEDIA_DIR}${esc(slide.media)}" alt="${esc(slide.alt)}" width="480" height="270" decoding="async"></div>
    <div class="tutorial-text">
      <div class="tutorial-count">${index + 1} / ${count}</div>
      <h2 id="tutorial-title" class="tutorial-title">${esc(slide.title)}</h2>
      ${lines}${guide}
    </div>`;
}

export function tutorialDotsHTML(index, count) {
  return Array.from({ length: count }, (_, i) =>
    `<span class="tutorial-dot${i === index ? ' active' : ''}${i < index ? ' done' : ''}"></span>`).join('');
}

// DOM controller for #tutorial-modal. `getInput` names the active input (keyboard / touch / pad) so the
// controls slide speaks the player's language; `onGuide` opens the Field Guide from the last slide.
// `onClose(reason)` says how it closed: 'skip' (SKIP / Esc / B), 'done' (LET'S FLY), 'guide' (the Field
// Guide button) or 'closed' (anything else, e.g. the screen behind it went away).
export class TutorialUI {
  constructor({ storage = defaultTutorialStorage(), slides = tutorialSlides(), getInput = () => 'keyboard', onClose = null, onGuide = null } = {}) {
    this.storage = storage;
    this.slides = slides;
    this.getInput = getInput;
    this.onClose = onClose;
    this.onGuide = onGuide;
    this.seen = readTutorialSeen(storage);
    this.index = 0;
    this.isOpen = false;
    this.root = null;
  }

  // Not seen yet: the slides have never been closed (skipped or finished) on this device.
  shouldAutoOpen() {
    return !this.seen;
  }

  bind() {
    if (this.root) return true;
    const doc = globalThis.document;
    this.root = doc?.getElementById('tutorial-modal');
    this.body = doc?.getElementById('tutorial-body');
    this.dots = doc?.getElementById('tutorial-dots');
    this.prevBtn = doc?.getElementById('btn-tutorial-prev');
    this.nextBtn = doc?.getElementById('btn-tutorial-next');
    if (!this.root || !this.body) return false;
    doc.getElementById('btn-tutorial-skip')?.addEventListener('click', () => this.close('skip'));
    this.prevBtn?.addEventListener('click', () => this.go(this.index - 1));
    this.nextBtn?.addEventListener('click', () => this.next());
    this.body.addEventListener('click', (e) => {
      if (e.target.closest?.('[data-tutorial-guide]')) this.openGuide();
    });
    // Swipe left / right between slides on touch screens.
    let swipe = null;
    this.body.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') swipe = { x: e.clientX, y: e.clientY }; });
    this.body.addEventListener('pointerup', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(this.index + (dx < 0 ? 1 : -1));
    });
    this.body.addEventListener('pointercancel', () => { swipe = null; });
    return true;
  }

  open(index = 0) {
    if (this.isOpen || !this.bind()) return false;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.render(index);
    return true;
  }

  // Closing (SKIP or the last slide) marks the tutorial seen, in memory even when storage is blocked.
  close(reason = 'closed') {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.seen = true;
    writeTutorialSeen(this.storage);
    this.onClose?.(reason);
  }

  openGuide() {
    this.close('guide');
    this.onGuide?.();
  }

  next() {
    if (this.index >= this.slides.length - 1) this.close('done');
    else this.go(this.index + 1);
  }

  go(index) {
    if (!this.isOpen || index < 0 || index >= this.slides.length || index === this.index) return false;
    this.render(index);
    return true;
  }

  render(index) {
    this.index = Math.max(0, Math.min(this.slides.length - 1, index));
    const count = this.slides.length;
    this.body.innerHTML = tutorialSlideHTML(this.slides[this.index], this.index, count, this.getInput());
    if (this.dots) this.dots.innerHTML = tutorialDotsHTML(this.index, count);
    if (this.prevBtn) this.prevBtn.disabled = this.index === 0;
    if (this.nextBtn) this.nextBtn.textContent = this.index === count - 1 ? '🚀 LET\'S FLY' : 'NEXT ▶';
    // Warm the next clip so it plays as soon as its slide opens.
    const upcoming = this.slides[this.index + 1];
    if (upcoming && globalThis.Image) new globalThis.Image().src = TUTORIAL_MEDIA_DIR + upcoming.media;
  }
}
