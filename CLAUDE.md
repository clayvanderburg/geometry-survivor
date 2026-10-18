# VEXOLITH // SURVIVOR: guidance for Claude

## This is a consumer product

- VEXOLITH is a public game (vexolith.app) played by anyone, on any device and browser. Never build for
  one person's setup: the owner's feedback ("on my phone...", "on my iPad...") is a report of what every
  player on that kind of device will hit. Fix it for all of them.
- Everything must work out of the box in a normal browser tab. Never rely on players doing setup or
  workarounds (Add to Home Screen, browser settings, installs, extensions). If a platform can't support a
  feature properly, hide the feature there instead of explaining a workaround.
- Desktop (mouse + keyboard), controller and touch are all first-class. A change for one must leave the
  others working as before; check each one you could have affected.

## Platform limits already found

- **Fullscreen on iPhone / iPad: not offered.** iPhone Safari has no page fullscreen, and iPad Safari leaves
  fullscreen on any downward swipe (joystick drags included), by design, with no way for a page to block it.
  `fullscreenUsable()` in `js/main.js` hides every fullscreen button (and the [V] shortcut) there.

## Touch play

- Touch mode (`body.touch-mode`, `js/touch-controls.js`) turns on by itself on touch devices. Phone layout
  rules live at the end of `css/style.css`, all scoped to `body.touch-mode`, so desktop never sees them.
- Phone screens must not need scrolling: check title, pause, level-up and game over at 844×390, 667×375 and
  390×844 (portrait) with touch emulation, and keep keyboard hints out of touch mode.

## Repo rules

- See `README.md`: gameplay changes bump `GAME_VERSION` with a matching player-facing `CHANGELOG` entry,
  plus the engineering checks (`npm test`, `tools/browser-smoke.cjs`, `tools/controller-smoke.cjs`).
