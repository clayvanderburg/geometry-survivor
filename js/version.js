// The game's version: the single source of truth for the version tag on screen, the PATCH NOTES
// badge and the per-version global leaderboard. Shared by the browser and the /api/scores Netlify
// Function (which bundles this file). No DOM, no dependencies.
//
// Rule: every merge that changes gameplay (balance, weapons, enemies, scoring, pacing) bumps
// GAME_VERSION and adds a matching entry at the top of CHANGELOG in js/changelog.js.
// tests/changelog.test.js fails if the two disagree.
// A minor bump also re-checks the first-run tutorial slides (js/tutorial.js, TUTORIAL_REVIEWED_FOR).

export const GAME_VERSION = '0.35.0';

// First release whose runs carry a version. Runs from before it live only on the all-time board,
// where they are labelled LEGACY_VERSION_LABEL ("pre-0.9").
export const VERSIONED_SINCE = '0.9.0';

const VERSION_PATTERN = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

export function isVersionString(value) {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

// "0.9.0" -> [0, 9, 0]; anything else -> null.
export function parseVersion(value) {
  const m = isVersionString(value) ? VERSION_PATTERN.exec(value) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Semver order for plain x.y.z strings: negative when a < b, 0 when equal, positive when a > b.
// Unparseable versions sort below every real one.
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

const [sinceMajor, sinceMinor] = parseVersion(VERSIONED_SINCE);
export const LEGACY_VERSION_LABEL = `pre-${sinceMajor}.${sinceMinor}`;

// "v0.9.0" for a run's version, "pre-0.9" for a run from before versioning.
export function versionLabel(version) {
  return isVersionString(version) ? `v${version}` : LEGACY_VERSION_LABEL;
}
