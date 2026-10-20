// Last Stand Protocol (Void Armory, js/progression.js): once per run, the hit that breaks the shield
// doesn't end the run. The shield comes back at `player.lastStand` of max and a free Supernova clears the
// field. HARDCORE has no repairs, so it never fires there.
import { modeRules } from './modes.js';

// Called from Game.endRunIfDead when the shield is at 0. True if the ship was saved.
export function tryLastStand(game) {
  const p = game.player;
  if (!(p.lastStand > 0) || p.lastStandUsed || !modeRules(game).shieldRepairs || game.range?.active) return false;
  p.lastStandUsed = true;
  p.hp = Math.max(1, Math.round(p.maxHp * p.lastStand));
  p.bombs++; // the free Supernova (triggerSupernova spends one bomb)
  game.triggerSupernova();
  p.invuln = Math.max(p.invuln, 2);
  game.particles?.spawnFloatText(p.x, p.y - 24, 'LAST STAND // SHIELD RESTORED', '#ff4d6d', 16);
  return true;
}
