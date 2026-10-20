// HANGAR_ENABLED: the Hangar update (ships, feats, weapon locks, mastery, SOLO; docs/HANGAR_DESIGN.md) is
// built behind this one flag and stays OFF for everyone until Clay signs the whole design off. With it off
// the game is exactly master's: no locked weapons, no ship picker, no new save fields.
//
// Try it on a deploy preview with ?hangar=1 (remembered on the device; ?hangar=0 forgets it) or the
// HANGAR switch in the hidden tuner. DOM-free apart from reading location/localStorage when they exist.
export const HANGAR_ENABLED = false; // the default for every player; flip at launch
export const HANGAR_FLAG_KEY = 'vexolith_hangar';

// The flag from a URL query string and a storage, pure: ?hangar=1 / ?hangar=0 win (and are written to
// `storage`), then the stored choice, then HANGAR_ENABLED.
export function resolveHangarFlag(search = '', storage = null) {
  const m = /[?&]hangar=([^&#]*)/.exec(String(search || ''));
  if (m) {
    const on = m[1] === '1' || m[1] === 'on' || m[1] === 'true';
    try { on ? storage?.setItem(HANGAR_FLAG_KEY, '1') : storage?.removeItem?.(HANGAR_FLAG_KEY); } catch { /* blocked: this page only */ }
    return on;
  }
  try {
    const v = storage?.getItem(HANGAR_FLAG_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* blocked storage */ }
  return HANGAR_ENABLED;
}

let cached = null;
const pageStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Is the Hangar on for this page? Read once (the URL and storage don't change under a running page).
export function hangarEnabled() {
  if (cached === null) cached = resolveHangarFlag(globalThis.location?.search || '', pageStorage());
  return cached;
}

// The tuner switch and tests: set the flag (and remember it unless `persist` is false). The game reads it
// when it builds a run, so a change applies from the next run (or a reload).
export function setHangarEnabled(on, { persist = true } = {}) {
  cached = !!on;
  if (persist) {
    try { pageStorage()?.setItem(HANGAR_FLAG_KEY, on ? '1' : '0'); } catch { /* blocked */ }
  }
  return cached;
}
