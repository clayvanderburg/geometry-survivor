// Ship quirks (docs/HANGAR_DESIGN.md §2): each Hangar ship's special rule, run from the Hangar's kill and
// shield-hit hooks (js/hangar-run.js). A player without a shipId (the crab, and every run while the Hangar
// flag is off) never reaches any of them.
//
// Live now: MANTIS (crit kills refund dash), HERMIT (the shield holds once), PYRE (burning deaths spread
// FIRE), REVENANT (+8% damage per boss). Still description only, each waiting on another lane's code:
// PROSPECTOR (gold-vein odds are rolled when rocks are placed), WASP (afterburn streak), BROOD (deployable
// count, primary damage), LANCER (+1 rank per weapon card), LEVIATHAN (tail blade).
import { applyBurn, statusState } from './status-effects.js';

export const MANTIS_DASH_REFUND = 0.15; // s of dash cooldown per crit kill
export const HERMIT_HOLD = 1.5;         // s the shield holds at 1
export const PYRE_SPREAD_RANGE = 150;   // px to the neighbour that catches fire
export const PYRE_SPREAD_SHARE = 0.6;   // share of the dead hull's FIRE stacks passed on
export const REVENANT_BOSS_DAMAGE = 0.08;

// After a kill (not in the Weapon Range).
export function quirkOnKill(game, e) {
  const p = game.player;
  switch (p?.shipId) {
    case 'mantis':
      if (e.lastCrit && p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - MANTIS_DASH_REFUND);
      break;
    case 'pyre': {
      const burn = e.st?.burn || 0;
      if (burn <= 0) break;
      let best = null, bestD = PYRE_SPREAD_RANGE * PYRE_SPREAD_RANGE;
      for (const n of game.enemyManager?.enemies || []) {
        if (n === e || n.dead || n.invulnerable) continue;
        const d = (n.x - e.x) ** 2 + (n.y - e.y) ** 2;
        if (d < bestD) { best = n; bestD = d; }
      }
      if (!best) break;
      applyBurn(p, best, 1, 0, 'flamethrower');
      const s = statusState(best);
      s.burn += burn * PYRE_SPREAD_SHARE;
      s.burnStat = e.st.burnStat || s.burnStat;
      break;
    }
    case 'revenant':
      if (!e.isBoss) break;
      for (const stats of [p.stats, p.base?.stats]) if (stats) stats.damage *= 1 + REVENANT_BOSS_DAMAGE;
      break;
  }
}

// After a shield hit has landed (damagePlayer). HERMIT: the first hit that would break the shield each
// run leaves it at 1 and holds for HERMIT_HOLD seconds.
export function quirkOnHit(game) {
  const p = game.player;
  if (p?.shipId !== 'hermit' || p.hp > 0 || p.hermitHeld) return;
  p.hermitHeld = true;
  p.hp = 1;
  p.invuln = Math.max(p.invuln || 0, HERMIT_HOLD);
  game.particles?.spawnShockwave?.(p.x, p.y, 160, 210, 6, 0.5);
  game.showBanner?.('HERMIT SHELL HOLDS');
}
