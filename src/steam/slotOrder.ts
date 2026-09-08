/**
 * Sign99RTS — Deterministic lobby-member → slot assignment.
 *
 * Both the host and every client must independently compute the SAME slot
 * ordering from the same membership list, so this must be pure and total.
 * Rule: the lobby owner is always slot 0; everyone else follows in ascending
 * SteamID64 order (string compare of decimal ids — stable and locale-free).
 */

import type { PlayerIdentity } from '../multiplayer/identity.js';

export interface SlotAssignment {
  slot: number;
  steamId: string;
  name: string;
}

/** Owner first, then others ascending by id. Returns a new array. */
export function orderMembers(ids: PlayerIdentity[], ownerId: string): PlayerIdentity[] {
  const seen = new Set<string>();
  const uniq = ids.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const owner = uniq.filter((i) => i.id === ownerId);
  const rest = uniq
    .filter((i) => i.id !== ownerId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...owner, ...rest];
}

export function assignSlots(ids: PlayerIdentity[], ownerId: string): SlotAssignment[] {
  return orderMembers(ids, ownerId).map((id, slot) => ({
    slot,
    steamId: id.id,
    name: id.name || `Player ${slot + 1}`,
  }));
}

/** Peers map (slot → steamId) for a given local slot, excluding the local player. */
export function peersForSlot(assignments: SlotAssignment[], mySlot: number): Map<number, string> {
  const m = new Map<number, string>();
  for (const a of assignments) if (a.slot !== mySlot) m.set(a.slot, a.steamId);
  return m;
}
