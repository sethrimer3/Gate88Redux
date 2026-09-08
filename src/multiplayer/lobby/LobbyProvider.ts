/**
 * Sign99RTS — LobbyProvider abstraction.
 *
 * A LobbyProvider owns lobby *lifecycle & discovery* for one backend. It does
 * NOT move gameplay bytes — that is `MultiplayerTransport` (src/net/transport.ts).
 * A typical flow:
 *
 *   host:   provider.hostLobby()  → Lobby        (becomes owner)
 *   client: provider.listLobbies() → LobbySummary[]
 *           provider.joinLobby(id) → Lobby
 *   both:   provider.on(evt => …)  // membership / owner / metadata / closed
 *           … later …
 *           provider.leaveLobby()
 *
 * Implementations:
 *   - SteamLobbyProvider    (src/steam/SteamLobbyProvider.ts)
 *   - SupabaseLobbyProvider (wraps the existing OnlineLobbyManager — optional)
 *
 * Every method rejects rather than throwing synchronously, and every rejection
 * carries a human-readable message safe to show in the menu.
 */

import type { PlayerIdentity } from '../identity.js';
import type { Lobby, LobbySummary, LobbyVisibility, LobbyEvent } from './types.js';

export interface HostLobbyOptions {
  visibility: LobbyVisibility;
  maxMembers: number;
  /** Extra metadata to set on creation (merged over the defaults). */
  metadata?: Record<string, string>;
}

export interface LobbyProvider {
  /** Backend tag, for diagnostics and UI ("Steam" / "Online" / "LAN"). */
  readonly kind: 'steam' | 'supabase' | 'lan';

  /** The local player's identity for this backend. Null until ready. */
  readonly localPlayer: PlayerIdentity | null;

  /** True once the backend is initialised and usable. */
  isReady(): boolean;

  /** Resolve when ready, or reject with why it cannot be used. */
  waitUntilReady(timeoutMs?: number): Promise<void>;

  // -- lifecycle -----------------------------------------------------------

  hostLobby(opts: HostLobbyOptions): Promise<Lobby>;
  listLobbies(): Promise<LobbySummary[]>;
  joinLobby(lobbyId: string): Promise<Lobby>;
  leaveLobby(): Promise<void>;

  /** The lobby we are currently in, or null. */
  readonly currentLobby: Lobby | null;

  // -- metadata (owner only) --------------------------------------------------

  setLobbyMetadata(patch: Record<string, string>): Promise<void>;

  // -- invitations ---------------------------------------------------------

  /**
   * Open the backend's friend-invite UI for the current lobby.
   * Steam: opens the overlay invite dialog. No-op backends resolve immediately.
   */
  openInviteDialog(): Promise<void>;

  // -- events ------------------------------------------------------------------

  /** Subscribe to in-lobby events. Returns an unsubscribe fn. */
  on(listener: (event: LobbyEvent) => void): () => void;

  /**
   * Fired when the OS/backend asks the game to join a specific lobby
   * (Steam friend "Join Game", or a launch arg like `+connect_lobby <id>`).
   * The menu should navigate to the lobby screen and call `joinLobby(id)`.
   * Returns an unsubscribe fn. Listeners registered late still receive the
   * most recent pending request exactly once (launch-arg case).
   */
  onJoinRequested(listener: (lobbyId: string) => void): () => void;

  /** Release all resources. Safe to call multiple times. */
  dispose(): void;
}
