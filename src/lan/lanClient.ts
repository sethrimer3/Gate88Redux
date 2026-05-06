/**
 * Browser-side WebSocket client for Gate88Redux LAN multiplayer.
 *
 * Usage:
 *   const client = new LanClient('ws://192.168.1.10:8787');
 *   client.onLobbyUpdate = (lobby) => { ... };
 *   client.connect();
 *   client.sendJoinRequest('Alice');
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
} from './protocol.js';

export type LanClientState =
  | 'disconnected'
  | 'connecting'
  | 'lobby'
  | 'in_match'
  | 'error';

export class LanClient {
  private ws: WebSocket | null = null;
  private url: string;

  // -------------------------------------------------------------------------
  // Public state
  // -------------------------------------------------------------------------
  state: LanClientState = 'disconnected';
  clientId: string = '';
  isHost: boolean = false;
  mySlot: number = -1;
  lobby: LobbyState | null = null;
  lastError: string = '';

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
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.state = 'error';
      this.lastError = String(e);
      return;
    }

    this.ws.onopen = () => {
      this.state = 'connecting'; // wait for 'welcome'
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
      this.onDisconnected?.(reason);
    };

    this.ws.onerror = () => {
      this.lastError = 'WebSocket error';
      this.state = 'error';
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.state = 'disconnected';
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // -------------------------------------------------------------------------
  // Incoming message dispatch
  // -------------------------------------------------------------------------

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
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

  sendSlotConfig(slotIndex: number, slotType: SlotType, aiDifficulty?: AIDifficulty): void {
    this.send({ type: 'slot_config', slotIndex, slotType, aiDifficulty });
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
