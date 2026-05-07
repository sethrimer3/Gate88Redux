/**
 * Gate88Redux — LAN Transport Adapter (Phase 1)
 *
 * Wraps LanClient to implement the MultiplayerTransport interface.
 * Game code that uses MultiplayerTransport does not need to know whether the
 * underlying connection is LAN WebSocket, future WebRTC, or anything else.
 *
 * Usage:
 *   const transport = new LanTransport(lanClient, mySlot, isHost);
 *   transport.onInputSnapshot  = (slot, input) => { ... };       // host
 *   transport.onAuthoritativeSnapshot = (snap) => { ... };       // client
 *   transport.onDisconnect = (reason) => { ... };
 *
 * The transport is intentionally thin — it only converts between the existing
 * LAN protocol (src/lan/protocol.ts) and the canonical net types
 * (src/net/protocol.ts).  No game logic lives here.
 */

import type { MultiplayerTransport } from '../net/transport.js';
import type { NetInputSnapshot, NetGameSnapshot } from '../net/protocol.js';
import { NET_PROTOCOL_VERSION } from '../net/protocol.js';
import type { LanClient } from './lanClient.js';
import type { MsgRelayedInput, FactionType } from './protocol.js';

export class LanTransport implements MultiplayerTransport {
  readonly mode = 'lan' as const;
  readonly isHost: boolean;
  readonly mySlot: number;

  onInputSnapshot?: (fromSlot: number, input: NetInputSnapshot) => void;
  onAuthoritativeSnapshot?: (snapshot: NetGameSnapshot) => void;
  onDisconnect?: (reason: string) => void;

  private readonly _client: LanClient;

  constructor(client: LanClient, mySlot: number, isHost: boolean) {
    this._client = client;
    this.mySlot = mySlot;
    this.isHost = isHost;

    if (isHost) {
      // Host receives input from remote clients.
      this._client.onRelayedInput = (msg: MsgRelayedInput) => {
        const inp = msg.input;
        const netInput: NetInputSnapshot = {
          protocolVersion: NET_PROTOCOL_VERSION,
          seq: inp.seq,
          clientTimeMs: performance.now(),
          dx: Math.max(-1, Math.min(1, inp.dx)) as -1 | 0 | 1,
          dy: Math.max(-1, Math.min(1, inp.dy)) as -1 | 0 | 1,
          aimX: inp.aimX,
          aimY: inp.aimY,
          firePrimary: inp.firePrimary,
          fireSpecial: inp.fireSpecial,
          boost: inp.boost,
        };
        this.onInputSnapshot?.(msg.fromSlot, netInput);
      };
    } else {
      // Client receives authoritative snapshots from the host.
      this._client.onGameSnapshot = (msg) => {
        const snap: NetGameSnapshot = {
          protocolVersion: NET_PROTOCOL_VERSION,
          seq: msg.seq,
          serverTimeMs: performance.now(),
          gameTime: msg.gameTime,
          hostSlot: msg.hostSlot,
          ships: msg.ships,
          projectiles: msg.projectiles,
          fighters: msg.fighters,
          buildings: msg.buildings,
          resourcesPerSlot: msg.resourcesPerSlot,
          factionsByTeam: msg.factionsByTeam,
          territoryCircles: msg.territoryCircles,
        };
        this.onAuthoritativeSnapshot?.(snap);
      };
    }

    this._client.onDisconnected = (reason: string) => {
      this.onDisconnect?.(reason);
    };
  }

  get connected(): boolean {
    return this._client.connected;
  }

  sendInputSnapshot(input: Omit<NetInputSnapshot, 'protocolVersion'>): void {
    if (this.isHost) return; // host never sends its own input over the network
    this._client.sendInputSnapshot({
      seq: input.seq,
      dx: input.dx,
      dy: input.dy,
      aimX: input.aimX,
      aimY: input.aimY,
      firePrimary: input.firePrimary,
      fireSpecial: input.fireSpecial,
      boost: input.boost,
    });
  }

  sendAuthoritativeSnapshot(snapshot: Omit<NetGameSnapshot, 'protocolVersion'>): void {
    if (!this.isHost) return; // only the host sends snapshots
    this._client.sendGameSnapshot({
      seq: snapshot.seq,
      gameTime: snapshot.gameTime,
      hostSlot: snapshot.hostSlot,
      ships: snapshot.ships,
      projectiles: snapshot.projectiles,
      fighters: snapshot.fighters,
      buildings: snapshot.buildings,
      resourcesPerSlot: snapshot.resourcesPerSlot,
      factionsByTeam: snapshot.factionsByTeam as Array<{ team: number; faction: FactionType }> | undefined,
      territoryCircles: snapshot.territoryCircles,
    });
  }

  disconnect(): void {
    this._client.disconnect();
  }
}
