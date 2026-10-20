// Looping clips of every weapon and every Breakthrough, recorded in the Weapon Range by
// tools/weapon-media.cjs (npm run weapon-media) into assets/weapons/. The Field Guide's weapon cards show
// weaponClip(id); the Breakthrough pick shows breakthroughClip(id, level) on its TRANSFORM card.
// tests/weapon-media.test.js fails if a weapon or Breakthrough has no clip.
export const WEAPON_MEDIA_DIR = 'assets/weapons/';

export const weaponClip = (weaponId) => `${WEAPON_MEDIA_DIR}${weaponId}.webp`;
export const breakthroughClip = (weaponId, level) => `${WEAPON_MEDIA_DIR}${weaponId}-${level}.webp`;

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// A 16:9 clip frame. Lazy: the Field Guide lists every weapon, but only clips scrolled into view load.
export function clipHTML(src, alt) {
  return `<div class="weapon-clip"><img src="${attr(src)}" alt="${attr(alt)}" width="360" height="202" loading="lazy" decoding="async"></div>`;
}
