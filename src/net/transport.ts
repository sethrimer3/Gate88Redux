/**
 * Sign99RTS — Multiplayer Transport Abstraction (Phase 1)
 *
 * This interface decouples game replication code from the underlying transport
 * (LAN WebSocket relay, WebRTC DataChannels, Steam Networking, or any other
 * mechanism).
 *
 * Design contract:
 *   - The HOST browser owns the authoritative simulation.
 *   - Remote clients send compact NetInputSnapshot messages to the host.
 *   - The host sends periodic NetGameSnapshot messages to all clients.
 *   - The transport layer is responsible only for delivery; game logic lives
 *     in game.ts and the snapshot serialisers.
 *
 * Adding a new transport (e.g. Steam) means implementing this interface and
 * passing the instance to the game's startMultiplayerGame() method.  The
 * rest of the game code never needs to know which transport is in use.
 *
 * See docs/ONLINE_MULTIPLAYER.md and docs/STEAM_MULTIPLAYER.md.
 */

import type { NetInputSnapshot, NetGameSnapshot } from './protocol.js';
import type { PlayerIdentity } from '../multiplayer/identity.js';

// ---------------------------------------------------------------------------
// Control channel
// ---------------------------------------------------------------------------

/**
 * Reliable, ordered messages that are NOT gameplay snapshots: match-start
 * payloads, ready-state, chat, "match already started" rejections. These MUST
 * NOT be dropped.
 *
 * LAN/WebRTC historically carried these out-of-band (WebSocket relay / Supabase
 * signaling / a dedicated datachannel); the Steam transport carries them on a
 * reliable Steam networking channel. `kind` is a free-form string owned by the
 * caller (e.g. 'match_start', 'ready', 'chat'); `payload` must be
 * JSON-serialisable and small.
 */
export interface NetControlMessage {
  kind: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// MultiplayerTransport interface
// ---------------------------------------------------------------------------

export interface MultiplayerTransport {
  /** Which underlying mechanism this transport uses. */
  readonly mode: 'lan' | 'online' | 'offline' | 'steam';

  /** True when this client/browser owns the authoritative simulation. */
  readonly isHost: boolean;

  /** Slot index assigned to this client (0 = host, 1–7 = remote players). */
  readonly mySlot: number;

  /** True when the underlying connection is open and ready for messages. */
  readonly connected: boolean;

  /** The local player's backend identity, if the transport knows it. */
  readonly localPlayer?: PlayerIdentity;

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

  /**
   * Send a reliable, ordered control message (optional — LAN/WebRTC may leave
   * this undefined, so callers must feature-detect).
   *   - host  → `toSlot` = a client slot index, or 'all'
   *   - client → `toSlot` is ignored (always routed to the host)
   */
  sendControl?(toSlot: number | 'all', msg: NetControlMessage): void;

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

  /** Called when a reliable control message arrives. */
  onControl?: (fromSlot: number, msg: NetControlMessage) => void;

  /** Called when the connection is lost or deliberately closed. */
  onDisconnect?: (reason: string) => void;

  /**
   * Non-fatal transport error (send failure, decode error, session refused).
   * Distinct from `onDisconnect`, which means the session is over.
   */
  onError?: (message: string) => void;

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
