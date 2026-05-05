/**
 * Special-ability framework for Gate88.
 *
 * The player ship has one "special ability" slot, fired with the right mouse
 * button. Each ability is registered here and handles its own targeting, cost,
 * cooldown, and projectile spawning. New abilities (cloak, dash, time bomb,
 * shield pulse, command burst, ...) plug in by adding another entry to the
 * registry — game.ts only needs to know the currently equipped ability id.
 */

import { Vec2 } from './math.js';
import { Team } from './entities.js';
import { GameState } from './gamestate.js';
import { PlayerShip } from './ship.js';
import { Missile } from './projectile.js';
import { Audio } from './audio.js';
import { DT, WEAPON_STATS } from './constants.js';

/** Battery cost to fire a special. */
const SPECIAL_BATTERY_COST = 10;

export interface SpecialAbility {
  /** Stable string identifier used by code that equips/loads abilities. */
  readonly id: string;
  /** Human-readable name (HUD label). */
  readonly displayName: string;
  /** Cooldown in seconds applied after firing (uses player.specialFireTimer). */
  readonly cooldownSeconds: number;
  /** Battery required to fire. */
  readonly batteryCost: number;
  /**
   * Fire the ability. Caller has already verified canFire(). Implementations
   * should spawn projectiles / effects via `state` and play sounds themselves.
   */
  fire(state: GameState, ship: PlayerShip, aimWorld: Vec2): void;
}

// ---------------------------------------------------------------------------
// Built-in: homing missile (the existing default secondary weapon)
// ---------------------------------------------------------------------------

const MISSILE_ABILITY: SpecialAbility = {
  id: 'missile',
  displayName: 'Homing Missile',
  cooldownSeconds: WEAPON_STATS.missile.fireRate * DT,
  batteryCost: SPECIAL_BATTERY_COST,
  fire(state, ship, _aimWorld) {
    // Find nearest enemy within missile range for homing target.
    const enemies = state.getEnemiesOf(Team.Player);
    let target = null;
    let bestDist: number = WEAPON_STATS.missile.range;
    for (const e of enemies) {
      const d = ship.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        target = e;
      }
    }
    const proj = new Missile(
      Team.Player,
      ship.position.clone(),
      ship.angle,
      ship,
      target,
    );
    state.addEntity(proj);
    Audio.playSound('missile');
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, SpecialAbility>();

/** Register a new ability so it can be equipped by id. */
export function registerSpecialAbility(ability: SpecialAbility): void {
  REGISTRY.set(ability.id, ability);
}

/** Look up an ability by id, or null if not registered. */
export function getSpecialAbility(id: string): SpecialAbility | null {
  return REGISTRY.get(id) ?? null;
}

/** Default ability id equipped on a fresh ship. */
export const DEFAULT_SPECIAL_ID = 'missile';

// Auto-register built-ins.
registerSpecialAbility(MISSILE_ABILITY);

/**
 * Try to fire the equipped special ability for the player.
 * Returns true if it fired (caller may use this for UI feedback).
 */
export function tryFireSpecial(state: GameState, ship: PlayerShip, aimWorld: Vec2): boolean {
  let ability = getSpecialAbility(ship.specialAbilityId);
  if (!ability) {
    ability = getSpecialAbility(DEFAULT_SPECIAL_ID);
    if (!ability) {
      // Critical configuration error: the default special ability is not
      // registered. Log once-per-session-ish so it's noticed in the console
      // without spamming on every RMB press.
      console.error(
        `[special] No special ability registered for id "${ship.specialAbilityId}" `
          + `and default id "${DEFAULT_SPECIAL_ID}" is also missing from the registry.`,
      );
      return false;
    }
  }
  if (ship.specialFireTimer > 0) return false;
  if (ship.battery < ability.batteryCost) return false;
  ability.fire(state, ship, aimWorld);
  ship.specialFireTimer = ability.cooldownSeconds;
  ship.battery -= ability.batteryCost;
  return true;
}

