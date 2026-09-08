/**
 * Sign99RTS — SteamTransport: MultiplayerTransport over Steam P2P networking.
 *
 * Topology mirrors the WebRTC transport: star, host-authoritative.
 *   - client → host : NetInputSnapshot   (reliable)   + control (reliable)
 *   - host → clients: NetGameSnapshot    (unreliable)
 *   - either → either: NetControlMessage (reliable)    — match_start, ready, chat
 *
 * Wire framing (per P2P packet): [1 byte type][utf-8 JSON body].
 *   0x01 input, 0x02 snapshot, 0x03 control.
 * The reliable/unreliable split is the bridge's two P2P channels (see
 * electron/steam/steamChannels.cjs NET_CHANNEL); the type byte disambiguates.
 *
 * Peer addressing: the transport is handed a slot→SteamID64 map at match start
 * (built by the menu from the lobby membership). Gameplay code keeps using slot
 * indices exclusively — it never sees a SteamID.
 *
 * NOTE on the networking API: steamworks.js@0.4.0 exposes only legacy
 * ISteamNetworking P2P. See docs/STEAM_MULTIPLAYER.md. Swapping to
 * ISteamNetworkingMessages later is isolated to electron/steam/steamworksBridge.cjs
 * plus the byte plumbing here — this class's public surface is stable.
 *
 * Log prefix: [Steam][Net].
 */

import type { MultiplayerTransport, NetControlMessage } from '../net/transport.js';
import type { NetInputSnapshot, NetGameSnapshot } from '../net/protocol.js';
import { NET_PROTOCOL_VERSION, validateInputSnapshot, validateGameSnapshot } from '../net/protocol.js';
import type { PlayerIdentity } from '../multiplayer/identity.js';
import { SteamClient } from './SteamClient.js';

const LOG = '[Steam][Net]';

const MSG_INPUT = 0x01;
const MSG_SNAPSHOT = 0x02;
const MSG_CONTROL = 0x03;

const HELLO_INTERVAL_MS = 500;
const HELLO_TIMEOUT_MS = 15_000;

export interface SteamTransportConfig {
  isHost: boolean;
  mySlot: number;
  hostSlot: number;
  localPlayer: PlayerIdentity;
  /** slot index → SteamID64 (decimal string). Excludes the local player. */
  peers: ReadonlyMap<number, string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function frame(type: number, obj: unknown): number[] {
  const body = encoder.encode(JSON.stringify(obj));
  const out = new Array<number>(body.length + 1);
  out[0] = type;
  for (let i = 0; i < body.length; i++) out[i + 1] = body[i];
  return out;
}

export const STEAM_MSG = { input: MSG_INPUT, snapshot: MSG_SNAPSHOT, control: MSG_CONTROL } as const;

export function unframe(bytes: number[]): { type: number; obj: unknown } | null {
  if (bytes.length < 1) return null;
  const type = bytes[0];
  try {
    const body = Uint8Array.from(bytes.slice(1));
    return { type, obj: JSON.parse(decoder.decode(body)) };
  } catch {
    return null;
  }
}

export class SteamTransport implements MultiplayerTransport {
  readonly mode = 'steam' as const;
  readonly isHost: boolean;
  readonly mySlot: number;
  readonly localPlayer: PlayerIdentity;

  onInputSnapshot?: (fromSlot: number, input: NetInputSnapshot) => void;
  onAuthoritativeSnapshot?: (snapshot: NetGameSnapshot) => void;
  onControl?: (fromSlot: number, msg: NetControlMessage) => void;
  onDisconnect?: (reason: string) => void;
  onError?: (message: string) => void;

  private readonly steam: SteamClient;
  private readonly hostSlot: number;
  private readonly slotToId: Map<number, string>;
  private readonly idToSlot: Map<string, number>;
  private readonly readyPeers = new Set<number>();
  private readonly unsubs: Array<() => void> = [];
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private helloDeadline = 0;
  private closed = false;
  private _connected = false;

  constructor(cfg: SteamTransportConfig) {
    const steam = SteamClient.get();
    if (!steam) throw new Error('SteamTransport requires the Steam desktop build.');
    this.steam = steam;
    this.isHost = cfg.isHost;
    this.mySlot = cfg.mySlot;
    this.hostSlot = cfg.hostSlot;
    this.localPlayer = cfg.localPlayer;
    this.slotToId = new Map(cfg.peers);
    this.idToSlot = new Map();
    for (const [slot, id] of this.slotToId) this.idToSlot.set(id, slot);

    this.unsubs.push(
      this.steam.onNetPacket.add((p) => this.handlePacket(p.fromSteamId, p.bytes)),
      this.steam.onNetSessionRequest.add((id) => this.handleSessionRequest(id)),
      this.steam.onNetSessionFailed.add((e) => this.handleSessionFailed(e.steamId, e.error)),
      this.steam.onStatus.add((s) => {
        if (s.state === 'lost' || s.state === 'failed') {
          this.fail('error' in s ? s.error : 'Steam offline');
        }
      }),
    );

    // Proactively accept sessions with every known peer and begin the handshake.
    for (const id of this.slotToId.values()) {
      void this.steam.raw.netAccept(id).catch(() => {});
    }
    this.helloDeadline = Date.now() + HELLO_TIMEOUT_MS;
    this.helloTimer = setInterval(() => this.pumpHandshake(), HELLO_INTERVAL_MS);
    this.pumpHandshake();
    console.log(`${LOG} started (${this.isHost ? 'host' : 'client'} slot ${this.mySlot}, ${this.slotToId.size} peer(s))`);
  }

  get connected(): boolean { return this._connected; }

  // -- outgoing --------------------------------------------------------------

  sendInputSnapshot(input: Omit<NetInputSnapshot, 'protocolVersion'>): void {
    if (this.isHost || this.closed) return;
    const hostId = this.slotToId.get(this.hostSlot);
    if (!hostId) return;
    this.rawSend(hostId, true, frame(MSG_INPUT, { protocolVersion: NET_PROTOCOL_VERSION, ...input }));
  }

  sendAuthoritativeSnapshot(snapshot: Omit<NetGameSnapshot, 'protocolVersion'>): void {
    if (!this.isHost || this.closed) return;
    const bytes = frame(MSG_SNAPSHOT, { protocolVersion: NET_PROTOCOL_VERSION, ...snapshot });
    for (const id of this.slotToId.values()) this.rawSend(id, false, bytes);
  }

  sendControl(toSlot: number | 'all', msg: NetControlMessage): void {
    if (this.closed) return;
    const bytes = frame(MSG_CONTROL, msg);
    if (!this.isHost) {
      const hostId = this.slotToId.get(this.hostSlot);
      if (hostId) this.rawSend(hostId, true, bytes);
      return;
    }
    if (toSlot === 'all') {
      for (const id of this.slotToId.values()) this.rawSend(id, true, bytes);
    } else {
      const id = this.slotToId.get(toSlot);
      if (id) this.rawSend(id, true, bytes);
    }
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    this._connected = false;
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    console.log(`${LOG} closed`);
  }

  // -- internals -----------------------------------------------------------

  private rawSend(steamId: string, reliable: boolean, bytes: number[]): void {
    this.steam.raw.netSend(steamId, reliable, bytes).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${LOG} send to ${steamId} failed: ${msg}`);
      this.onError?.(`Steam send failed: ${msg}`);
    });
  }

  private pumpHandshake(): void {
    if (this.closed) return;
    if (this._connected || this.expectedReady()) { this.markConnected(); return; }
    if (Date.now() > this.helloDeadline) {
      this.fail('Timed out establishing Steam connection.');
      return;
    }
    const hello = frame(MSG_CONTROL, { kind: '__steam_hello', payload: { slot: this.mySlot } });
    for (const [slot, id] of this.slotToId) {
      if (!this.readyPeers.has(slot)) this.rawSend(id, true, hello);
    }
  }

  private expectedReady(): boolean {
    if (this.isHost) return this.readyPeers.size >= this.slotToId.size && this.slotToId.size > 0;
    return this.readyPeers.has(this.hostSlot);
  }

  private markConnected(): void {
    if (this._connected || this.closed) return;
    this._connected = true;
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
    console.log(`${LOG} connected (${this.readyPeers.size} peer session(s))`);
  }

  private fail(reason: string): void {
    if (this.closed) return;
    console.warn(`${LOG} ${reason}`);
    this.disconnect();
    this.onDisconnect?.(reason);
  }

  private handleSessionRequest(steamId: string): void {
    if (this.idToSlot.has(steamId)) {
      void this.steam.raw.netAccept(steamId).catch(() => {});
    } else {
      console.warn(`${LOG} ignoring session request from unknown ${steamId}`);
    }
  }

  private handleSessionFailed(steamId: string, error: number): void {
    const slot = this.idToSlot.get(steamId);
    this.onError?.(`Steam P2P session failed with slot ${slot ?? '?'} (error ${error}).`);
    if (!this.isHost && slot === this.hostSlot) {
      this.fail('Lost connection to host.');
    } else if (slot !== undefined) {
      this.readyPeers.delete(slot);
    }
  }

  private handlePacket(fromSteamId: string, bytes: number[]): void {
    const slot = this.idToSlot.get(fromSteamId);
    if (slot === undefined) return; // not a match peer
    const msg = unframe(bytes);
    if (!msg) { this.onError?.('Received an undecodable Steam packet.'); return; }

    switch (msg.type) {
      case MSG_INPUT: {
        if (!this.isHost) return;
        const input = validateInputSnapshot(msg.obj);
        if (input) this.onInputSnapshot?.(slot, input);
        break;
      }
      case MSG_SNAPSHOT: {
        if (this.isHost) return;
        const snap = validateGameSnapshot(msg.obj);
        if (snap) this.onAuthoritativeSnapshot?.(snap);
        break;
      }
      case MSG_CONTROL: {
        const cm = msg.obj as NetControlMessage;
        if (cm && cm.kind === '__steam_hello') {
          if (!this.readyPeers.has(slot)) {
            this.readyPeers.add(slot);
            console.log(`${LOG} handshake with slot ${slot}`);
            // Reply so the other side also marks us ready.
            this.rawSend(fromSteamId, true, frame(MSG_CONTROL, {
              kind: '__steam_hello', payload: { slot: this.mySlot },
            }));
          }
          if (this.expectedReady()) this.markConnected();
          return;
        }
        if (cm && typeof cm.kind === 'string') this.onControl?.(slot, cm);
        break;
      }
    }
  }
}
