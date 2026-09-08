import { describe, expect, it } from 'vitest';
import type { LobbySlot } from './lan/protocol.js';
import { createMultiplayerSpawns, ENEMY_BASE_DISTANCE, TEAMMATE_BASE_DISTANCE } from './multiplayerSpawns.js';

function slot(slotIndex: number, teamId: number): LobbySlot {
  return { slotIndex, teamId, type: 'human', ready: true, race: 'terran' };
}

describe('createMultiplayerSpawns', () => {
  it('gives every occupied player a distinct base', () => {
    const spawns = createMultiplayerSpawns([slot(0, 0), slot(1, 0), slot(2, 1), slot(3, 1)]);
    expect(new Set(spawns.map((spawn) => `${spawn.position.x},${spawn.position.y}`)).size).toBe(4);
  });

  it('places adjacent teammates one quarter of the enemy-team distance apart', () => {
    const spawns = createMultiplayerSpawns([slot(0, 0), slot(1, 0), slot(2, 1), slot(3, 1)]);
    const distance = (a: number, b: number) => spawns[a].position.distanceTo(spawns[b].position);
    expect(distance(0, 1)).toBeCloseTo(TEAMMATE_BASE_DISTANCE, 6);
    expect(distance(0, 1)).toBeCloseTo(ENEMY_BASE_DISTANCE / 4, 6);
  });

  it('does not allocate bases to open or closed lobby slots', () => {
    const spawns = createMultiplayerSpawns([
      slot(0, 0),
      { slotIndex: 1, type: 'open', ready: false },
      { slotIndex: 2, type: 'closed', ready: false },
    ]);
    expect(spawns.map((spawn) => spawn.slotIndex)).toEqual([0]);
  });
});
