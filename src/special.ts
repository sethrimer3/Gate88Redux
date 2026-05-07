/**
 * Special-ability framework for Gate88.
 *
 * The player ship has one "special ability" slot, fired with the right mouse
 * button. Each ability is registered here and handles its own targeting, cost,
 * cooldown, and projectile spawning. New abilities (cloak, dash, time bomb,
 * shield pulse, command burst, ...) plug in by adding another entry to the
 * registry — game.ts only needs to know the currently equipped ability id.
 */

import { Vec2, randomRange } from './math.js';
import { GameState } from './gamestate.js';
import { PlayerShip } from './ship.js';
import { CrossLaserMine } from './mine.js';
import { Audio } from './audio.js';
import {
  MINE_COUNT,
  MINE_COOLDOWN_SECS,
  MINE_BATTERY_COST,
  MINE_INITIAL_SPEED_MIN,
  MINE_INITIAL_SPEED_MAX,
} from './constants.js';

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
// Built-in: Cross-Laser Mines — the default RMB ability
// ---------------------------------------------------------------------------

/**
 * Deploy a cluster of 5 Cross-Laser Mines in a fan pattern toward the cursor.
 *
 * Each mine drifts outward, decelerates to a stop, then projects 4 detection
 * laser beams in a cross shape.  Any enemy ship that crosses a beam causes
 * the mine to instantly fire a high-speed straight-line trap missile along
 * that beam's direction.  Mines that are not triggered explode after 20 s.
 *
 * See src/mine.ts for full implementation details.
 */
const CROSS_LASER_MINE_ABILITY: SpecialAbility = {
  id: 'missile', // stable id — keeps backward compat with saved/serialised state
  displayName: 'Cross-Laser Mines',
  cooldownSeconds: MINE_COOLDOWN_SECS,
  batteryCost: MINE_BATTERY_COST,
  fire(state: GameState, ship: PlayerShip, aimWorld: Vec2): void {
    // Aim direction from ship toward the cursor
    const baseAngle = ship.position.angleTo(aimWorld);

    // 5-mine fan spread: ±30° and ±15° around the base direction plus centre.
    // Offset keeps the mines from stacking on the ship's collision radius.
    const halfSpread = Math.PI / 6; // 30°
    const spreadAngles = [
      -halfSpread,
      -halfSpread * 0.5,
      0,
      halfSpread * 0.5,
      halfSpread,
    ];

    for (let i = 0; i < MINE_COUNT; i++) {
      const angle = baseAngle + spreadAngles[i];
      const speed = randomRange(MINE_INITIAL_SPEED_MIN, MINE_INITIAL_SPEED_MAX);
      // Place each mine just ahead of the player in its travel direction so
      // mines don't clip the player's hull on spawn.
      const deployOffset = 22 + Math.random() * 8;
      const pos = new Vec2(
        ship.position.x + Math.cos(angle) * deployOffset,
        ship.position.y + Math.sin(angle) * deployOffset,
      );
      const mine = new CrossLaserMine(ship.team, pos, angle, speed, ship, state);
      state.addEntity(mine);
    }

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
registerSpecialAbility(CROSS_LASER_MINE_ABILITY);

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

