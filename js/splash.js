// SPLASH screen: the VEXOLITH key art (assets/splash.webp) full screen every time the game opens or the
// page is refreshed, with a pulsing "PRESS ANY KEY" prompt. Any key, tap, click or controller button
// fades it into the title screen (and, being a user gesture, lets the audio start). Only the browser
// boot shows it (Game.showSplash), so headless tests never see it; the Playwright tools dismiss it.

export const SPLASH_FADE_MS = 450;

// DOM controller for #splash-screen. `onDismiss` runs once, as the fade starts.
export class SplashScreen {
  constructor({ onDismiss = null } = {}) {
    this.onDismiss = onDismiss;
    this.isOpen = false;
    this.root = null;
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
    this.root.classList.add('splash-out');
    setTimeout(() => this.root.classList.add('hidden'), SPLASH_FADE_MS);
    this.onDismiss?.();
    return true;
  }
}
