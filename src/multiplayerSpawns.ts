import { WORLD_HEIGHT, WORLD_WIDTH } from './constants.js';
import type { LobbySlot } from './lan/protocol.js';
import { Vec2 } from './math.js';

/** Intended centre-to-centre separation between opposing team clusters. */
export const ENEMY_BASE_DISTANCE = 2000;
/** Teammates start four times closer together than opposing teams. */
export const TEAMMATE_BASE_DISTANCE = ENEMY_BASE_DISTANCE / 4;

export interface MultiplayerSpawn {
  slotIndex: number;
  teamId: number;
  position: Vec2;
}

/**
 * Produce a deterministic base position for every occupied lobby slot.
 * Teams are spread around the map on a large ring. Members of one team form
 * a compact row centred on their team anchor, with adjacent bases exactly one
 * quarter of the target enemy-team separation apart.
 */
export function createMultiplayerSpawns(slots: readonly LobbySlot[]): MultiplayerSpawn[] {
  const occupied = slots
    .filter((slot) => slot.type === 'human' || slot.type === 'ai')
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);

  const byTeam = new Map<number, LobbySlot[]>();
  for (const slot of occupied) {
    const teamId = Math.max(0, Math.min(7, slot.teamId ?? slot.slotIndex));
    const members = byTeam.get(teamId) ?? [];
    members.push(slot);
    byTeam.set(teamId, members);
  }

  const teams = [...byTeam.entries()].sort(([a], [b]) => a - b);
  const teamCount = teams.length;
  const centre = new Vec2(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  const ringRadius = teamCount > 1
    ? ENEMY_BASE_DISTANCE / (2 * Math.sin(Math.PI / teamCount))
    : 0;
  const result: MultiplayerSpawn[] = [];

  teams.forEach(([teamId, members], teamIndex) => {
    const angle = -Math.PI / 2 + teamIndex * Math.PI * 2 / Math.max(1, teamCount);
    const anchor = new Vec2(
      centre.x + Math.cos(angle) * ringRadius,
      centre.y + Math.sin(angle) * ringRadius,
    );
    // Lay allies along the tangent so their cluster does not move closer to
    // or farther from the map centre as it grows.
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);
    members.forEach((slot, memberIndex) => {
      const offset = (memberIndex - (members.length - 1) / 2) * TEAMMATE_BASE_DISTANCE;
      result.push({
        slotIndex: slot.slotIndex,
        teamId,
        position: new Vec2(anchor.x + tangentX * offset, anchor.y + tangentY * offset),
      });
    });
  });

  return result.sort((a, b) => a.slotIndex - b.slotIndex);
}
