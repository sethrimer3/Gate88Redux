/**
 * Sign99RTS — SteamClient (renderer singleton).
 *
 * Thin, typed facade over `window.sign99Steam`. It:
 *   - performs Steam init once and caches the status,
 *   - resolves the local player as a backend-neutral `PlayerIdentity`,
 *   - fans out the bridge's push events to multiple subscribers (so the
 *     LobbyProvider and the Transport can both listen without double-registering
 *     the underlying IPC listener).
 *
 * Everything Steam-specific in the renderer goes through here or the two
 * classes built on it (SteamLobbyProvider, SteamTransport). Gameplay code never
 * imports this file.
 *
 * Log prefix: [Steam].
 */

import { getSteamBridge, type Sign99SteamBridge, type SteamInitStatus, type SteamStatusEvent, type SteamLobbyEventWire, type SteamNetPacketWire } from './ipc.js';
import { makePlayerIdentity, type PlayerIdentity } from '../multiplayer/identity.js';

const LOG = '[Steam]';

type Listener<T> = (v: T) => void;

function fanout<T>() {
  const set = new Set<Listener<T>>();
  return {
    add(l: Listener<T>): () => void {
      set.add(l);
      return () => set.delete(l);
    },
    emit(v: T): void {
      for (const l of [...set]) {
        try { l(v); } catch (e) { console.error(`${LOG} listener error:`, e); }
      }
    },
    get size() { return set.size; },
  };
}

export class SteamClient {
  private static _instance: SteamClient | null = null;

  static get(): SteamClient | null {
    const bridge = getSteamBridge();
    if (!bridge) return null;
    if (!SteamClient._instance) SteamClient._instance = new SteamClient(bridge);
    return SteamClient._instance;
  }

  private readonly bridge: Sign99SteamBridge;
  private initPromise: Promise<SteamInitStatus> | null = null;
  private _status: SteamInitStatus | null = null;
  private _identity: PlayerIdentity | null = null;

  readonly onStatus = fanout<SteamStatusEvent>();
  readonly onLobbyEvent = fanout<SteamLobbyEventWire>();
  readonly onJoinRequested = fanout<string>();
  readonly onNetPacket = fanout<SteamNetPacketWire>();
  readonly onNetSessionRequest = fanout<string>();
  readonly onNetSessionFailed = fanout<{ steamId: string; error: number }>();

  private constructor(bridge: Sign99SteamBridge) {
    this.bridge = bridge;
    bridge.onStatus((e) => {
      if (e.state === 'lost' || e.state === 'failed') {
        console.warn(`${LOG} status: ${e.state} — ${'error' in e ? e.error : ''}`);
      } else {
        console.log(`${LOG} status: ${e.state}`);
      }
      this.onStatus.emit(e);
    });
    bridge.onLobbyEvent((e) => this.onLobbyEvent.emit(e));
    bridge.onJoinRequested((e) => {
      console.log(`${LOG} join requested for lobby ${e.lobbyId}`);
      this.onJoinRequested.emit(e.lobbyId);
    });
    bridge.onNetPacket((e) => this.onNetPacket.emit(e));
    bridge.onNetSessionRequest((e) => this.onNetSessionRequest.emit(e.steamId));
    bridge.onNetSessionFailed((e) => this.onNetSessionFailed.emit(e));
  }

  /** Idempotent Steam init. Resolves with a status object; never rejects. */
  init(): Promise<SteamInitStatus> {
    if (!this.initPromise) {
      this.initPromise = this.bridge
        .init()
        .then((st) => {
          this._status = st;
          if (st.ok) console.log(`${LOG} init ok (appId=${st.appId})`);
          else console.warn(`${LOG} init failed: ${st.error}`);
          return st;
        })
        .catch((e) => {
          const st: SteamInitStatus = {
            ok: false, running: false, initialized: false, appId: 0,
            error: e instanceof Error ? e.message : String(e),
          };
          this._status = st;
          return st;
        });
    }
    return this.initPromise;
  }

  get status(): SteamInitStatus | null { return this._status; }
  get isReady(): boolean { return this._status?.ok === true; }

  /** Local player identity; resolves after a successful init. */
  async getIdentity(): Promise<PlayerIdentity> {
    if (this._identity) return this._identity;
    const st = await this.init();
    if (!st.ok) throw new Error(st.error || 'Steam is not available.');
    const wire = await this.bridge.getIdentity();
    this._identity = makePlayerIdentity(wire.steamId, wire.name, 'steam');
    console.log(`${LOG} local player ${wire.steamId} "${wire.name}"`);
    return this._identity;
  }

  /** The raw bridge — for SteamLobbyProvider / SteamTransport only. */
  get raw(): Sign99SteamBridge { return this.bridge; }

  /** Consume a one-shot pending launch-arg lobby join, if any. */
  async takePendingJoin(): Promise<string | null> {
    try {
      const r = await this.bridge.takePendingJoin();
      return r.lobbyId;
    } catch {
      return null;
    }
  }
}
