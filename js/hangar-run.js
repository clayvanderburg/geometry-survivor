// The Hangar's hooks into a run (docs/HANGAR_DESIGN.md §5.2), so main.js only carries one-liners. Every
// entry point is a no-op unless the Hangar flag is on (js/hangar-flag.js): game.feats is null then.
import { hangarEnabled, setHangarEnabled } from './hangar-flag.js';
import { FeatLedger, FEATS } from './feats.js';
import { SHIPS, DEFAULT_SHIP, normalizeShip, isShip, shipRunBonuses, shipLook, shipDef, shipFixedKit } from './ships.js';
import { WEAPONS, START_WEAPON_CHOICES } from './loadout.js';
import { quirkOnKill, quirkOnHit } from './ship-quirks.js';

// The ship this run flies: null while the flag is off (the crab, exactly as before) or in the Weapon Range;
// else the Hangar's pick. `game.shipOverride` (balance sim --ship, tests) wins even with the flag off.
export function runShip(game) {
  if (isShip(game.shipOverride)) return game.shipOverride;
  if (!hangarEnabled() || game.range?.active || !game.progression?.hangar) return null;
  return normalizeShip(game.progression.hangar().ship);
}

// The run's start bonuses: the mode's Void Armory bonuses, plus the ship's (js/ships.js) when there is one.
export function runBonuses(armory, shipId) {
  return shipId ? shipRunBonuses(armory, shipId) : armory;
}

// The player fields a ship adds: its id and silhouette (ship-renderer.js). Nothing for no ship.
export function shipFields(shipId) {
  if (!shipId) return {};
  const look = shipLook(shipId);
  return look ? { shipId, look } : { shipId };
}

// The weapons a ship run starts with: its fixed kit, else the start pick when the ship allows it, else the
// default kit. null without a ship (the flag is off): resetRun keeps its own rule.
export function runKit(game, startWeapon) {
  const id = game.shipId;
  if (!id) return null;
  const kit = shipFixedKit(id);
  if (kit) return kit;
  const pick = shipDef(id).kit === 'last' ? game.startWeapon : startWeapon;
  return startChoices(game, { forKit: true }).includes(pick) ? [pick] : ['blaster'];
}

// The run-start pick's cards for the ship about to launch. Flag off: START_WEAPON_CHOICES as always.
// A fixed kit or MAGPIE's 'last' shows no pick ([]); SOVEREIGN's 'any' offers every weapon.
// (Weapon locks and mastered weapons join in later PRs.) `forKit`: the weapons a 'last' ship may start with.
export function startChoices(game, { forKit = false } = {}) {
  const id = runShip(game); // the ship about to launch (the Hangar's pick may have changed since the title run)
  if (!id) return START_WEAPON_CHOICES;
  const kit = shipDef(id).kit;
  if (kit === 'any') return WEAPONS.map((w) => w.id);
  if (kit === 'pick' || (kit === 'last' && forKit)) return START_WEAPON_CHOICES;
  return [];
}

// Every kill outside the Weapon Range: feats, then the ship's quirk.
export function hangarKill(game, e) {
  game.feats?.kill(e, game.player);
  if (game.player?.shipId) quirkOnKill(game, e);
}

// A shield hit that has just landed (`dmg` taken): feats, then the ship's quirk (HERMIT's hold).
export function hangarHit(game, dmg) {
  game.feats?.shieldHit(dmg);
  if (game.player?.shipId) quirkOnHit(game);
}

// A fresh ledger for the run resetRun just built (null: flag off, or the Weapon Range).
export function newRunLedger(game) {
  if (!hangarEnabled() || game.range?.active || !game.progression?.hangar) return null;
  return new FeatLedger({ mode: game.mode, ship: game.player?.shipId || DEFAULT_SHIP });
}

// Land the run's counts in the save (each wave, each boss, and once at the end). Tuner/sandbox runs drop
// them. Completed feats go to game.onFeatsDone (the toasts) when it exists.
export function commitFeats(game, end = false) {
  const ledger = game.feats;
  if (!ledger || ledger.ended) return [];
  ledger.gold(game.gold);
  ledger.waveReached(game.wave, !!game.campaignWon);
  const done = ledger.commit(game.progression.hangar(), { tainted: game.runIsTainted ? game.runIsTainted() : !!game.runTainted, end });
  game.progression.save();
  if (done.length) game.onFeatsDone?.(done);
  if (end) game.hangarUI?.showResults(ledger);
  return done;
}

// Tuner shortcut for trying ships on a preview: every ship unlocked on this device (marked NEW).
export function unlockAllShips(progression) {
  const h = progression?.hangar?.();
  if (!h) return;
  for (const s of SHIPS) if (!h.ships.includes(s.id)) { h.ships.push(s.id); h.fresh.push(`ship:${s.id}`); }
  progression.save();
}

// Hidden tuner: a HANGAR switch (applies from the next run; reload for the title screen) and a read-out
// of the career counters, so the flag can be tried on a deploy preview without ?hangar=1.
export function hangarTunerRow(doc, body, progression) {
  if (!doc?.createElement || !body?.appendChild) return;
  const row = doc.createElement('div');
  row.className = 'drawer-row';
  const render = () => {
    const on = hangarEnabled();
    const h = on ? progression?.data?.hangar : null;
    const c = h?.career;
    const info = c ? `${Object.keys(h.feats).length}/${FEATS.length} feats · ${c.kills} kills · ${c.rocksMined} rocks · ${c.bossKills} bosses` : 'off for players';
    const unlock = on ? ' <button type="button" class="hud-btn" data-hangar-unlock title="Preview only: unlocks every ship on this device">UNLOCK ALL</button>' : '';
    row.innerHTML = `<span>HANGAR (preview)</span><button type="button" class="hud-btn" data-hangar-toggle>${on ? 'ON' : 'OFF'}</button>${unlock}<span class="drawer-val">${info}</span>`;
    row.querySelector?.('[data-hangar-toggle]')?.addEventListener?.('click', () => { setHangarEnabled(!hangarEnabled()); render(); });
    row.querySelector?.('[data-hangar-unlock]')?.addEventListener?.('click', () => { unlockAllShips(progression); render(); });
  };
  render();
  body.appendChild(row);
}
