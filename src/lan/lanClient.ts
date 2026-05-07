/**
 * Browser-side WebSocket client for Gate88Redux LAN multiplayer.
 *
 * Usage:
 *   const client = new LanClient('ws://192.168.1.10:8787');
 *   client.onLobbyUpdate = (lobby) => { ... };
 *   client.connect();
 *   // For non-hosts: wait for onConnected, then sendJoinRequest
 *   // For hosts: the server auto-assigns slot 0 and sends welcome directly
 */

import type {
  ServerMessage,
  ClientMessage,
  LobbyState,
  MsgWelcome,
  MsgMatchStart,
  MsgRelayedSnapshot,
  MsgRelayedInput,
  MsgMatchEnd,
  MsgJoinRejected,
  MsgInputSnapshot,
  MsgGameSnapshot,
  MsgSlotConfig,
  SlotType,
  AIDifficulty,
  RaceSelection,
} from './protocol.js';

export type LanClientState =
  | 'disconnected'
  | 'connecting'
  | 'lobby'
  | 'in_match'
  | 'error';

/** Heartbeat ping interval in ms. Matches the server-side CLIENT_TIMEOUT_MS / 4. */
const HEARTBEAT_INTERVAL_MS = 15_000;

export class LanClient {
  private ws: WebSocket | null = null;
  private url: string;
  /** Heartbeat ping interval handle */
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  /** Time the last ping was sent (ms) */
  private lastPingSentAt: number = 0;

  // -------------------------------------------------------------------------
  // Public state
  // -------------------------------------------------------------------------
  state: LanClientState = 'disconnected';
  clientId: string = '';
  isHost: boolean = false;
  mySlot: number = -1;
  lobby: LobbyState | null = null;
  lastError: string = '';
  /** Round-trip ping estimate in ms (0 = unknown). */
  pingMs: number = 0;
  /** Timestamp (ms) of the last received snapshot. */
  lastSnapshotAt: number = 0;

  // -------------------------------------------------------------------------
  // Callbacks (set by consumers)
  // -------------------------------------------------------------------------
  onConnected: (() => void) | null = null;
  onDisconnected: ((reason: string) => void) | null = null;
  onLobbyUpdate: ((lobby: LobbyState) => void) | null = null;
  onJoinRejected: ((reason: string) => void) | null = null;
  onKicked: (() => void) | null = null;
  onMatchStart: ((msg: MsgMatchStart) => void) | null = null;
  onGameSnapshot: ((msg: MsgRelayedSnapshot) => void) | null = null;
  onRelayedInput: ((msg: MsgRelayedInput) => void) | null = null;
  onMatchEnd: ((reason: string) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(): void {
    if (this.ws) this.ws.close();
    this.state = 'connecting';
    this.lastError = '';
    this.pingMs = 0;
    this.lastSnapshotAt = 0;
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.state = 'error';
      this.lastError = String(e);
      return;
    }

    this.ws.onopen = () => {
      this.state = 'connecting'; // wait for 'welcome' or 'server_connected'
      this.startHeartbeat();
      this.onConnected?.();
    };

    this.ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    this.ws.onclose = (ev) => {
      const reason = ev.reason || 'Connection closed';
      this.state = 'disconnected';
      this.ws = null;
      this.stopHeartbeat();
      this.onDisconnected?.(reason);
    };

    this.ws.onerror = () => {
      this.lastError = 'WebSocket error';
      this.state = 'error';
    };
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.state = 'disconnected';
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Send a ping every HEARTBEAT_INTERVAL_MS to keep the connection alive and measure RTT.
    this.pingInterval = setInterval(() => {
      if (!this.connected) return;
      this.lastPingSentAt = performance.now();
      this.send({ type: 'ping', t: this.lastPingSentAt });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Incoming message dispatch
  // -------------------------------------------------------------------------

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'server_connected': {
        // Non-host initial greeting: we now know our clientId.
        // The consumer (menu.ts) should call sendJoinRequest after this.
        this.clientId = msg.clientId;
        this.state = 'connecting'; // still waiting to join
        // Trigger the same onConnected callback so existing code works.
        // (menu.ts already sets onConnected before calling connect())
        break;
      }
      case 'welcome': {
        const m = msg as MsgWelcome;
        this.clientId = m.clientId;
        this.isHost = m.isHost;
        this.mySlot = m.slotIndex;
        this.lobby = m.lobby;
        this.state = 'lobby';
        this.onLobbyUpdate?.(m.lobby);
        break;
      }
      case 'lobby_update': {
        this.lobby = msg.lobby;
        this.onLobbyUpdate?.(msg.lobby);
        break;
      }
      case 'join_rejected': {
        this.lastError = msg.reason;
        this.state = 'error';
        this.onJoinRejected?.(msg.reason);
        break;
      }
      case 'kicked': {
        this.state = 'disconnected';
        this.onKicked?.();
        this.ws?.close();
        break;
      }
      case 'match_start': {
        const m = msg as MsgMatchStart;
        this.mySlot = m.mySlot;
        this.lobby = m.lobby;
        this.state = 'in_match';
        this.onMatchStart?.(m);
        break;
      }
      case 'game_snapshot': {
        this.lastSnapshotAt = performance.now();
        this.onGameSnapshot?.(msg as MsgRelayedSnapshot);
        break;
      }
      case 'relayed_input': {
        this.onRelayedInput?.(msg as MsgRelayedInput);
        break;
      }
      case 'match_end': {
        this.state = 'lobby';
        this.onMatchEnd?.(msg.reason);
        break;
      }
      case 'pong': {
        // Calculate round-trip time.
        if (this.lastPingSentAt > 0) {
          this.pingMs = Math.round(performance.now() - this.lastPingSentAt);
        }
        break;
      }
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Outgoing helpers
  // -------------------------------------------------------------------------

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendJoinRequest(playerName: string): void {
    this.send({ type: 'join_request', playerName });
  }

  sendReadyToggle(): void {
    this.send({ type: 'ready_toggle' });
  }

  sendLeave(): void {
    this.send({ type: 'leave' });
  }

  sendSlotConfig(slotIndex: number, slotType: SlotType, aiDifficulty?: AIDifficulty, race?: RaceSelection): void {
    this.send({ type: 'slot_config', slotIndex, slotType, aiDifficulty, race });
  }

  sendKickPlayer(slotIndex: number): void {
    this.send({ type: 'kick_player', slotIndex });
  }

  sendStartMatch(): void {
    this.send({ type: 'start_match' });
  }

  sendInputSnapshot(snap: Omit<MsgInputSnapshot, 'type'>): void {
    this.send({ type: 'input_snapshot', ...snap });
  }

  sendGameSnapshot(snap: Omit<MsgGameSnapshot, 'type'>): void {
    this.send({ type: 'game_snapshot', ...snap });
  }
}
