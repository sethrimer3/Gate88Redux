/**
 * Sign99RTS — Backend-neutral lobby types.
 *
 * These mirror the *concepts* every lobby backend shares (Steam Matchmaking,
 * Supabase `lobbies` table, LAN discovery) without exposing any backend type.
 * The canvas menu UI and match-start code operate on these.
 *
 * Slot assignment (`LobbySlot`, `LobbyState`, `MsgMatchStart`) still lives in
 * `src/lan/protocol.ts` and is reused verbatim for every backend — this file
 * only covers *lobby membership & discovery*, the layer above slots.
 */

import type { PlayerIdentity } from '../identity.js';

/** How this lobby is discoverable. Maps to Steam's ELobbyType. */
export type LobbyVisibility = 'public' | 'friends' | 'private';

/** One member of a lobby (not yet a match — no slot/team here). */
export interface LobbyMember {
  identity: PlayerIdentity;
  /** True for the lobby owner / authoritative host. */
  isOwner: boolean;
}

/**
 * A lobby as seen from *inside* it (after create/join).
 * `id` is the backend lobby id (SteamID64 of the lobby for Steam).
 */
export interface Lobby {
  readonly id: string;
  readonly visibility: LobbyVisibility;
  owner: PlayerIdentity;
  members: LobbyMember[];
  maxMembers: number;
  /** Arbitrary string→string metadata (see LobbyMetaKeys). */
  metadata: Readonly<Record<string, string>>;
}

/**
 * A lobby as seen from *outside* it (browse results). A subset of `Lobby`
 * that a backend can cheaply enumerate without joining.
 */
export interface LobbySummary {
  readonly id: string;
  hostName: string;
  memberCount: number;
  maxMembers: number;
  visibility: LobbyVisibility;
  metadata: Readonly<Record<string, string>>;
}

/** Well-known metadata keys. Backends store these as plain strings. */
export const LobbyMetaKeys = {
  /** 'Sign99RTS' — used to filter out foreign lobbies in browse results. */
  game: 'game',
  /** Build/version string, e.g. from src/version.ts. */
  build: 'build',
  /** Host display name (denormalised for browse UIs). */
  hostName: 'host_name',
  /** '1' once the match has started (hide from browse / reject late joins). */
  matchStarted: 'match_started',
  /** JSON-encoded LobbyState snapshot for late-join / reconnect UIs. */
  lobbyState: 'lobby_state',
  /** Human-readable map/mode label for browse UIs. */
  mode: 'mode',
} as const;

export const GAME_META_VALUE = 'Sign99RTS';

// ---------------------------------------------------------------------------
// Events emitted by a LobbyProvider while inside a lobby
// ---------------------------------------------------------------------------

export type LobbyEvent =
  | { type: 'member_joined'; member: LobbyMember }
  | { type: 'member_left'; identity: PlayerIdentity }
  | { type: 'owner_changed'; owner: PlayerIdentity }
  | { type: 'metadata_changed'; metadata: Readonly<Record<string, string>> }
  | { type: 'lobby_closed'; reason: string };
