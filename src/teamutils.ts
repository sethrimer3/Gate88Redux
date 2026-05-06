/**
 * Team utility helpers for Gate88Redux.
 *
 * Centralises all team-logic so game systems don't hard-code comparisons
 * like `team === Team.Player` or `team !== target.team`.
 */

import { Team } from './entities.js';
import type { Color } from './colors.js';
import { Colors } from './colors.js';

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** True for any numbered player team (Player1–Player8). */
export function isPlayableTeam(team: Team): boolean {
  return team >= Team.Player1 && team <= Team.Player8;
}

/**
 * Two teams are hostile when both are playable and they are different.
 * Neutral is never hostile.  In multiplayer every non-neutral team is an
 * enemy of every other non-neutral team (no alliance support yet).
 */
export function isHostile(a: Team, b: Team): boolean {
  if (a === Team.Neutral || b === Team.Neutral) return false;
  return a !== b;
}

/** True when a projectile / effect from `source` should damage `target`. */
export function shouldDamage(source: Team, target: Team): boolean {
  return isHostile(source, target);
}

// ---------------------------------------------------------------------------
// Slot ↔ Team mapping
// ---------------------------------------------------------------------------

const SLOT_TO_TEAM: readonly Team[] = [
  Team.Player1, // slot 0
  Team.Player2, // slot 1
  Team.Player3,
  Team.Player4,
  Team.Player5,
  Team.Player6,
  Team.Player7,
  Team.Player8, // slot 7
];

/**
 * Returns the Team for a lobby slot index (0–7).
 * Throws if the index is out of range.
 */
export function teamForSlot(slotIndex: number): Team {
  if (slotIndex < 0 || slotIndex > 7) {
    throw new RangeError(`slotIndex ${slotIndex} out of range [0, 7]`);
  }
  return SLOT_TO_TEAM[slotIndex];
}

/**
 * Returns the lobby slot index (0–7) for a playable team.
 * Returns -1 for Neutral or out-of-range teams.
 */
export function slotForTeam(team: Team): number {
  const idx = SLOT_TO_TEAM.indexOf(team);
  return idx; // -1 when not found
}

// ---------------------------------------------------------------------------
// Team colours
// ---------------------------------------------------------------------------

/**
 * Returns a representative display colour for a team.
 * Used by the HUD, lobby screen, and radar indicators.
 */
export function teamColor(team: Team): Color {
  switch (team) {
    case Team.Player1: return Colors.radar_friendly_status;  // green
    case Team.Player2: return Colors.radar_enemy_status;     // red
    case Team.Player3: return Colors.radar_allied_status;    // blue
    case Team.Player4: return Colors.alert2;                 // yellow
    case Team.Player5: return Colors.particles_enemy_exhaust;// dark red
    case Team.Player6: return Colors.particles_allied_exhaust; // steel blue
    case Team.Player7: return Colors.particles_switch;       // off-white
    case Team.Player8: return Colors.powergenerator_detail;  // olive
    default:           return Colors.radar_gridlines;        // neutral grey-green
  }
}

/**
 * Short human-readable team label, e.g. "P1", "P2", "Neutral".
 */
export function teamLabel(team: Team): string {
  if (team === Team.Neutral) return 'Neutral';
  const slot = slotForTeam(team);
  return slot >= 0 ? `P${slot + 1}` : `Team${team}`;
}
