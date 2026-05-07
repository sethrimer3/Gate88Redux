/**
 * Gate88Redux — Multiplayer Transport Abstraction (Phase 1)
 *
 * This interface decouples game replication code from the underlying transport
 * (LAN WebSocket relay, future WebRTC DataChannels, or any other mechanism).
 *
 * Design contract:
 *   - The HOST browser owns the authoritative simulation.
 *   - Remote clients send compact NetInputSnapshot messages to the host.
 *   - The host sends periodic NetGameSnapshot messages to all clients.
 *   - The transport layer is responsible only for delivery; game logic lives
 *     in game.ts and the snapshot serialisers.
 *
 * Adding a new transport (e.g. WebRTC) means implementing this interface and
 * passing the instance to the game's startMultiplayerGame() method.  The
 * rest of the game code never needs to know which transport is in use.
 *
 * See docs/ONLINE_MULTIPLAYER.md for architecture overview.
 */

import type { NetInputSnapshot, NetGameSnapshot } from './protocol.js';

// ---------------------------------------------------------------------------
// MultiplayerTransport interface
// ---------------------------------------------------------------------------

export interface MultiplayerTransport {
  /** Which underlying mechanism this transport uses. */
  readonly mode: 'lan' | 'online' | 'offline';

  /** True when this client/browser owns the authoritative simulation. */
  readonly isHost: boolean;

  /** Slot index assigned to this client (0 = host, 1–7 = remote players). */
  readonly mySlot: number;

  /** True when the underlying connection is open and ready for messages. */
  readonly connected: boolean;

  // -------------------------------------------------------------------------
  // Outgoing messages
  // -------------------------------------------------------------------------

  /**
   * Non-host clients call this every tick to send their local input to the host.
   * The transport must NOT call this from the host (noop if called).
   */
  sendInputSnapshot(input: Omit<NetInputSnapshot, 'protocolVersion'>): void;

  /**
   * Host calls this at NET_SNAPSHOT_HZ to send the authoritative game state
   * to all remote clients.  The transport must NOT call this from non-hosts
   * (noop if called).
   */
  sendAuthoritativeSnapshot(snapshot: Omit<NetGameSnapshot, 'protocolVersion'>): void;

  // -------------------------------------------------------------------------
  // Incoming callbacks (set by game.ts before use)
  // -------------------------------------------------------------------------

  /**
   * Host-only: called when a remote client's input snapshot arrives.
   * `fromSlot` is the validated slot index assigned by the lobby.
   */
  onInputSnapshot?: (fromSlot: number, input: NetInputSnapshot) => void;

  /**
   * Client-only: called when the host sends an authoritative game snapshot.
   */
  onAuthoritativeSnapshot?: (snapshot: NetGameSnapshot) => void;

  /** Called when the connection is lost or deliberately closed. */
  onDisconnect?: (reason: string) => void;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Close the transport gracefully. */
  disconnect(): void;
}

// ---------------------------------------------------------------------------
// Snapshot rate constant (shared across all transports)
// ---------------------------------------------------------------------------

/**
 * Host broadcasts authoritative snapshots at this rate.
 * 20 Hz balances bandwidth against smoothness for action-shooter gameplay.
 * Interpolation on the client side makes entity movement appear smooth even
 * between snapshots.
 */
export const NET_SNAPSHOT_HZ = 20;

/** Interval in seconds between host snapshots (= 1 / NET_SNAPSHOT_HZ). */
export const NET_SNAPSHOT_INTERVAL = 1 / NET_SNAPSHOT_HZ;
