// Save transfer: the pilot's progress as one portable bundle, for EXPORT / IMPORT SAVE (a copyable code
// or a .json file) and the cloud save (js/cloud-save.js, netlify/lib/cloud-save.mjs). Pure and shared by
// the browser and the server, so both validate a bundle the same way.
//
// A bundle is { schema, game, exported, version, save, settings }:
//   save      the progression save (progression.js), always run through normalizeSave, so a bundle can
//             never carry anything a local save couldn't hold (ranks within their caps, known unlocks...);
//   settings  a whitelist of plain preferences (SETTINGS_KEYS). Dev tuning, the Weapon Range and the
//             leaderboard upload outbox never travel.
// Nothing here is trusted by the leaderboard: runs are validated by the server on their own, and a save
// only holds what the device itself could write to localStorage.
//
// A save code is `VXSAVE1.<base64url JSON>.<checksum>`; the checksum catches a code that was cut short or
// mistyped (it is not a signature: a save on your own device is yours to edit anyway).
import { normalizeSave, armorySpent, META_UPGRADES, topRunsPerMode } from './progression.js';
import { OPEN_WEAPONS, LOCKABLE_WEAPONS, UNLOCK_STATS } from './unlock-goals.js';

export const BUNDLE_SCHEMA = 1;
export const BUNDLE_GAME = 'vexolith-survivor';
export const CODE_PREFIX = 'VXSAVE1';
export const MAX_BUNDLE_BYTES = 64 * 1024;
export const TOTAL_WEAPONS = OPEN_WEAPONS.length + LOCKABLE_WEAPONS.length;

// Preferences that travel with a save (localStorage keys). Values are short strings.
export const SETTINGS_KEYS = Object.freeze([
  'vexolith_master_vol', 'vexolith_volume_scale_v2', 'vexolith_reduce_effects', 'vexolith_damage_numbers', 'vexolith_radar',
  'vexolith_post_global', 'vexolith_share_stats', 'vexolith_game_mode', 'vexolith_start_weapon',
  'vexolith_tutorial_seen', 'vexolith_intro_seen', 'vexolith_slot_tip_seen', 'vexolith_patch_notes_seen',
  'vexolith_pixie_rift_seen', 'vexolith_pixie_rift_jump_seen', 'vexolith_pixie_low_shield_seen'
]);
const MAX_SETTING_CHARS = 200;

// Only whitelisted keys with short string values.
export function sanitizeSettings(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const key of SETTINGS_KEYS) {
    const v = src[key];
    if (typeof v === 'string' && v.length <= MAX_SETTING_CHARS) out[key] = v;
  }
  return out;
}

// The settings on this device (a Storage-like object).
export function readSettings(storage) {
  const out = {};
  for (const key of SETTINGS_KEYS) {
    try {
      const v = storage?.getItem(key);
      if (typeof v === 'string') out[key] = v;
    } catch { /* storage blocked */ }
  }
  return sanitizeSettings(out);
}

export function buildBundle({ save, settings = {}, version = '', now = Date.now() } = {}) {
  return {
    schema: BUNDLE_SCHEMA,
    game: BUNDLE_GAME,
    exported: new Date(now).toISOString(),
    version: typeof version === 'string' ? version.slice(0, 20) : '',
    save: normalizeSave(save),
    settings: sanitizeSettings(settings)
  };
}

// Checks and cleans a bundle (from a code, a file or the cloud). Returns { bundle } or { error }.
export function validateBundle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'not a save' };
  if (value.game !== BUNDLE_GAME) return { error: 'not a VEXOLITH // SURVIVOR save' };
  if (value.schema !== BUNDLE_SCHEMA) {
    return { error: typeof value.schema === 'number' && value.schema > BUNDLE_SCHEMA ? 'made by a newer version of the game: update first' : 'unknown save format' };
  }
  if (!value.save || typeof value.save !== 'object' || Array.isArray(value.save)) return { error: 'the save is missing' };
  let size = 0;
  try { size = JSON.stringify(value).length; } catch { return { error: 'not a save' }; }
  if (size > MAX_BUNDLE_BYTES) return { error: 'too large' };
  return {
    bundle: {
      schema: BUNDLE_SCHEMA,
      game: BUNDLE_GAME,
      exported: typeof value.exported === 'string' && !Number.isNaN(Date.parse(value.exported)) ? value.exported : null,
      version: typeof value.version === 'string' ? value.version.slice(0, 20) : '',
      save: normalizeSave(value.save),
      settings: sanitizeSettings(value.settings)
    }
  };
}

// --- Save codes -------------------------------------------------------------------------------------

// FNV-1a over the code's payload, as 8 hex digits.
function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeSaveCode(bundle) {
  const payload = toBase64Url(JSON.stringify(bundle));
  return `${CODE_PREFIX}.${payload}.${checksum(payload)}`;
}

// A pasted save code or the contents of an exported .json file. Returns { bundle } or { error }.
export function parseSaveText(text) {
  if (typeof text !== 'string') return { error: 'nothing to import' };
  const clean = text.trim();
  if (!clean) return { error: 'nothing to import' };
  if (clean.length > MAX_BUNDLE_BYTES * 2) return { error: 'too large' };
  let value;
  if (clean.startsWith('{')) {
    try { value = JSON.parse(clean); } catch { return { error: 'that file is not a save' }; }
  } else {
    const parts = clean.replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== CODE_PREFIX) return { error: 'that is not a save code' };
    if (checksum(parts[1]) !== parts[2]) return { error: 'the code is damaged (copy it again, in full)' };
    try { value = JSON.parse(fromBase64Url(parts[1])); } catch { return { error: 'the code is damaged (copy it again, in full)' }; }
  }
  return validateBundle(value);
}

// --- Recovery codes (the cloud save, netlify/lib/cloud-save.mjs) -----------------------------------
// VX-XXXX-XXXX-XXXX: 12 symbols from 32 letters and digits without 0 O 1 I (60 bits), made by the server.
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_GROUPS = 3;
export const CODE_GROUP_LEN = 4;

// A typed code in canonical form (case, spaces and dashes don't matter), or null.
export function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const s = value.toUpperCase().replace(/[\s-]+/g, '').replace(/^VX/, '');
  const len = CODE_GROUPS * CODE_GROUP_LEN;
  if (s.length !== len || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g++) groups.push(s.slice(g * CODE_GROUP_LEN, (g + 1) * CODE_GROUP_LEN));
  return `VX-${groups.join('-')}`;
}

// --- Summary and merge ------------------------------------------------------------------------------

// Cores in the wallet plus cores spent in the Armory: a save's total wealth.
export function saveWealth(save) {
  return (save.cores || 0) + Object.values(save.paid || {}).reduce((a, c) => a + (c || 0), 0);
}

// What a save holds, for the confirm dialogs.
export function summarizeSave(save) {
  const s = normalizeSave(save);
  return {
    pilot: s.pilotName,
    cores: s.cores,
    wealth: saveWealth(s),
    armoryRanks: Object.values(s.ranks).reduce((a, r) => a + r, 0),
    unlocked: OPEN_WEAPONS.length + s.unlocks.weapons.length,
    totalWeapons: TOTAL_WEAPONS,
    runs: s.totalRuns,
    guide: s.guide.seen.length
  };
}

// "Has more progress": any of wealth, unlocks or runs ahead.
export function hasMoreProgress(a, b) {
  const x = summarizeSave(a), y = summarizeSave(b);
  return x.wealth > y.wealth || x.unlocked > y.unlocked || x.runs > y.runs || x.guide > y.guide;
}

// Merges two saves, keeping the best of each (`local` keeps its callsign and notices):
//   unlock counters and Armory ranks: the higher of the two; unlocked weapons and Field Guide entries:
//   both; runs played: the higher; MY RUNS: both, best per mode.
//   Void Cores: total wealth (cores + cores spent in the Armory) is the larger of the two saves', never the
//   sum, and the wallet is that minus what the merged ranks cost. So merging the same backup twice, or a
//   save with itself, adds nothing.
export function mergeSaves(localSave, otherSave) {
  const a = normalizeSave(localSave), b = normalizeSave(otherSave);
  const ranks = {}, paid = {};
  for (const u of META_UPGRADES) {
    const fromA = (a.ranks[u.id] || 0) >= (b.ranks[u.id] || 0);
    ranks[u.id] = fromA ? a.ranks[u.id] : b.ranks[u.id];
    paid[u.id] = fromA ? a.paid[u.id] : b.paid[u.id];
  }
  const spent = Object.values(paid).reduce((x, c) => x + c, 0);
  const cores = Math.max(0, Math.max(saveWealth(a), saveWealth(b)) - spent);
  const stats = {};
  for (const id of Object.keys(UNLOCK_STATS)) {
    const v = Math.max(a.unlocks.stats[id] || 0, b.unlocks.stats[id] || 0);
    if (v > 0) stats[id] = v;
  }
  const weapons = [...new Set([...a.unlocks.weapons, ...b.unlocks.weapons])];
  const seen = [...new Set([...a.guide.seen, ...b.guide.seen])];
  const byId = new Map([...a.highscores, ...b.highscores].map((e) => [e.id, e]));
  return normalizeSave({
    ...a,
    cores,
    ranks,
    paid,
    totalRuns: Math.max(a.totalRuns, b.totalRuns),
    unlocks: { stats, weapons, fresh: a.unlocks.fresh.filter((id) => weapons.includes(id)) },
    guide: { seen, fresh: a.guide.fresh },
    highscores: topRunsPerMode([...byId.values()])
  });
}

// Spent cores of a save's ranks on the current price curve (for tests and checks).
export const ranksCost = (save) => armorySpent(normalizeSave(save).ranks);
