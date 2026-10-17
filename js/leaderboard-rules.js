// Rules shared by the browser and the /api/scores Netlify Function (which bundles this file), so a
// callsign the game sends is always one the server accepts. No DOM, no dependencies.

export const NAME_MAX = 18;
// Upper-case letters, digits, spaces and a little arcade punctuation ("VOID // HUNTER", "X-23", "ACE!").
export const NAME_PATTERN = /^[A-Z0-9 _\-./!?#*+:']{1,18}$/;
const NAME_STRIP = /[^A-Z0-9 _\-./!?#*+:']/g;

// Turns any typed callsign into the leaderboard's alphabet: accents folded ("JOSÉ" -> "JOSE"), other
// characters dropped, runs of spaces collapsed, trimmed to NAME_MAX. Returns '' when nothing is left.
export function sanitizeCallsign(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(NAME_STRIP, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

// Seconds survived as the game shows it (MM:SS).
export function formatRunTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
