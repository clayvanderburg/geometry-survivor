// SPLASH screen: the VEXOLITH key art (assets/splash.webp) full screen when the game first opens in a
// browser session, with a pulsing "PRESS ANY KEY" prompt. Any key, tap, click or controller button fades
// it into the title screen (and, being a user gesture, lets the audio start). Shown once per session:
// a reload in the same tab goes straight to the title. Only the browser boot shows it (Game.showSplash),
// so headless tests and tools never see it. Storage may be blocked: it then shows on every load.

export const SPLASH_SEEN_KEY = 'vexolith_splash_seen';
export const SPLASH_FADE_MS = 450;

export function defaultSplashStorage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

export function readSplashSeen(storage) {
  try { return !!storage?.getItem(SPLASH_SEEN_KEY); } catch { return false; }
}

export function writeSplashSeen(storage) {
  try { storage?.setItem(SPLASH_SEEN_KEY, '1'); return true; } catch { return false; }
}

// DOM controller for #splash-screen. `onDismiss` runs once, as the fade starts.
export class SplashScreen {
  constructor({ storage = defaultSplashStorage(), onDismiss = null } = {}) {
    this.storage = storage;
    this.onDismiss = onDismiss;
    this.seen = readSplashSeen(storage);
    this.isOpen = false;
    this.root = null;
  }

  shouldShow() {
    return !this.seen;
  }

  bind() {
    if (this.root) return true;
    this.root = globalThis.document?.getElementById('splash-screen') || null;
    if (!this.root) return false;
    this.root.addEventListener('click', () => this.dismiss());
    return true;
  }

  show() {
    if (this.isOpen || !this.bind()) return false;
    this.isOpen = true;
    this.root.classList.remove('hidden', 'splash-out');
    return true;
  }

  dismiss() {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.seen = true;
    writeSplashSeen(this.storage);
    this.root.classList.add('splash-out');
    setTimeout(() => this.root.classList.add('hidden'), SPLASH_FADE_MS);
    this.onDismiss?.();
    return true;
  }
}
