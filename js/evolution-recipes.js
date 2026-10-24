// Evolution recipes, as data: what each evolution (UPGRADE_POOL isSynergy card) needs before it can turn
// up in a level-up hand. upgrades.js `req` + loadoutAllows stay the rules; these lists mirror them so
// cards and the Field Guide can show the recipe with ✓ / ✗ (tests/evolution-recipes.test.js keeps the
// two in step and fails when an evolution has no recipe).
//
// An ingredient is one of:
//   { weapon: id }                  the weapon is equipped
//   { weapon: id, level: n }        the weapon is equipped at LV n or more (weaponLevel)
//   { card: id, level: n }          the upgrade card is at rank n or more
//   { element: true }               some equipped weapon carries an element (FIRE / FROST / CORROSIVE / SHOCK)
//   { anyOf: [ingredient, ...] }    any one of these
// `label` overrides the name shown on chips (kept short for phone-width cards).
import { UPGRADE_POOL, UPGRADE_BY_ID, ownedElements } from './upgrades.js';
import { WEAPON_BY_ID, ownsWeapon, weaponLevel, weaponAvailable } from './loadout.js';
import { weaponPill } from './weapon-pills.js';

export const EVOLUTION_RECIPES = {
  evo_tectonic: [{ card: 'mining_speed', level: 2, label: 'Rotary Drill' }],
  evo_pulsar: [
    { weapon: 'blaster' },
    { anyOf: [{ card: 'multishot', level: 2 }, { card: 'firerate', level: 2 }] }
  ],
  evo_tempest: [{ weapon: 'missiles', label: 'Missiles' }, { weapon: 'lightning', label: 'Tesla Arc' }],
  evo_siege: [{ weapon: 'mines', label: 'Mines' }, { weapon: 'turret', label: 'Turret' }],
  evo_emp: [{ weapon: 'grenades', label: 'Grenades' }, { weapon: 'lightning', label: 'Tesla Arc' }],
  evo_supercrit: [{ card: 'crit_chance', level: 2, label: 'Deadeye' }, { element: true, label: 'Any element' }]
};

export const EVOLUTION_IDS = UPGRADE_POOL.filter((u) => u.isSynergy).map((u) => u.id);
export const evolutionName = (id) => (UPGRADE_BY_ID[id]?.name || id).replace(/^SYNERGY:\s*/, '');

// How far the player is toward one ingredient, 0..need (an anyOf counts its best option).
function progress(player, ing) {
  if (ing.anyOf) return Math.max(...ing.anyOf.map((o) => progress(player, o) / need(o)));
  if (ing.weapon) return Math.min(need(ing), ing.level ? weaponLevel(player, ing.weapon) : (ownsWeapon(player, ing.weapon) ? 1 : 0));
  if (ing.card) return Math.min(need(ing), player.upgradeLevels?.[ing.card] || 0);
  if (ing.element) return ownedElements(player).size > 0 ? 1 : 0;
  return 0;
}
const need = (ing) => (ing.anyOf ? 1 : ing.level || 1);
const met = (player, ing) => progress(player, ing) >= need(ing);

// Plain name of an ingredient ("Prism Split LV 2", "Tesla Arc", "Prism Split LV 2 / Hyper-Capacitor LV 2").
// `have` (ranks so far) turns "LV 2" into "LV 1/2".
export function ingredientLabel(ing, { short = true, have = null } = {}) {
  if (ing.anyOf) return ing.anyOf.map((o) => ingredientLabel(o, { short })).join(' / ');
  const name = (short && ing.label) || (ing.weapon ? WEAPON_BY_ID[ing.weapon]?.name : ing.card ? UPGRADE_BY_ID[ing.card]?.name : 'any weapon with an element');
  if (!ing.level || !(ing.card || ing.weapon)) return name;
  return have == null ? `${name} LV ${ing.level}` : `${name} LV ${have}/${ing.level}`;
}

export const evolutionOwned = (player, id) => (player.upgradeLevels?.[id] || 0) > 0;
export const recipeMet = (player, id) => (EVOLUTION_RECIPES[id] || []).every((ing) => met(player, ing));

// Evolutions the player doesn't own yet whose recipe is complete (they can now turn up in hands).
export const readyEvolutions = (player) => EVOLUTION_IDS.filter((id) => !evolutionOwned(player, id) && recipeMet(player, id));

// One evolution's recipe for display: a chip per ingredient. `after` is the player once this card is
// taken (null: no card, e.g. the Field Guide); a chip this card completes is marked `adds`.
export function recipeView(id, player, after = null) {
  const parts = (EVOLUTION_RECIPES[id] || []).map((ing) => {
    const before = player ? met(player, ing) : null;
    const now = after ? met(after, ing) : before;
    const n = need(ing);
    // Still short of a rank target: show how far ("Deadeye LV 1/2").
    const have = player && !ing.anyOf && n > 1 && !now ? Math.floor(progress(after || player, ing)) : null;
    return { label: ingredientLabel(ing, { have }), weapon: ing.weapon || null, met: before, adds: !before && !!now };
  });
  return { id, name: evolutionName(id), parts, ready: player ? parts.every((x) => x.met || x.adds) : false };
}

// Whether a recipe can still be finished this run: every weapon it names (all options of an anyOf
// being locked counts as locked) is unlocked on this save (loadout.js weaponAvailable).
function reachable(player, ing) {
  if (ing.anyOf) return ing.anyOf.some((o) => reachable(player, o));
  return !ing.weapon || weaponAvailable(player, ing.weapon);
}
export const recipeReachable = (player, id) => (EVOLUTION_RECIPES[id] || []).every((ing) => reachable(player, ing));

// The recipes a level-up card moves forward: evolutions not owned yet where some ingredient gets closer
// (a card rank, a weapon equipped, an element). `before` / `after` are the player without and with
// the card (upgrade-cards.js installs it on a copy). Most complete first, at most `max`. A recipe that
// needs a locked weapon is never hinted.
export function recipesAdvanced(before, after, max = 2) {
  const out = [];
  for (const id of EVOLUTION_IDS) {
    if (evolutionOwned(before, id) || !recipeReachable(before, id)) continue;
    const recipe = EVOLUTION_RECIPES[id] || [];
    if (!recipe.some((ing) => progress(after, ing) > progress(before, ing))) continue;
    out.push(recipeView(id, before, after));
  }
  const done = (v) => v.parts.filter((x) => x.met || x.adds).length / (v.parts.length || 1);
  return out.sort((a, b) => done(b) - done(a)).slice(0, max);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Chips for one recipe view: ✓ have it, ★ this card adds it, ✗ missing. A weapon is its weapon pill
// (in the weapon's colour) with the same mark.
export function recipeChipsHtml(view) {
  return view.parts.map((x) => {
    const state = x.met ? 'ok' : x.adds ? 'adds' : x.met === null ? 'plain' : 'miss';
    const mark = state === 'plain' ? '' : `<b class="recipe-mark">${{ ok: '✓', adds: '★', miss: '✗' }[state]}</b>`;
    if (x.weapon) return weaponPill(x.weapon, { cls: `recipe-chip ${state}`, text: x.label, suffix: mark ? ` ${mark}` : '' });
    return `<span class="recipe-chip ${state}">${esc(x.label)}${mark ? ` ${mark}` : ''}</span>`;
  }).join('<span class="recipe-plus">+</span>');
}

// The strip on a level-up card: "⚗ TOWARD SUPERCRITICAL  Deadeye LV 1/2 ✗ + Any element ★", or
// "⚗ COMPLETES ..." when this card finishes the recipe. An evolution card shows its own recipe.
export function recipeStripHtml(views, { own = false } = {}) {
  if (!views?.length) return '';
  return `<div class="upg-recipes">${views.map((v) => {
    const head = own ? '⚗ RECIPE' : v.ready ? `⚗ COMPLETES ${esc(v.name.toUpperCase())}` : `⚗ TOWARD ${esc(v.name.toUpperCase())}`;
    return `<div class="upg-recipe${v.ready && !own ? ' ready' : ''}"><span class="upg-recipe-head">${head}</span>${recipeChipsHtml(v)}</div>`;
  }).join('')}</div>`;
}
