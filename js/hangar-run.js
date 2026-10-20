// The Hangar's hooks into a run (docs/HANGAR_DESIGN.md §5.2), so main.js only carries one-liners. Every
// entry point is a no-op unless the Hangar flag is on (js/hangar-flag.js): game.feats is null then.
import { hangarEnabled, setHangarEnabled } from './hangar-flag.js';
import { FeatLedger, FEATS } from './feats.js';
import { DEFAULT_SHIP, normalizeShip, isShip, shipRunBonuses } from './ships.js';

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
  return done;
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
    row.innerHTML = `<span>HANGAR (preview)</span><button type="button" class="hud-btn" data-hangar-toggle>${on ? 'ON' : 'OFF'}</button><span class="drawer-val">${info}</span>`;
    row.querySelector?.('[data-hangar-toggle]')?.addEventListener?.('click', () => { setHangarEnabled(!hangarEnabled()); render(); });
  };
  render();
  body.appendChild(row);
}
