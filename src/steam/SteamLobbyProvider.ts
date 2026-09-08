/**
 * Sign99RTS — SteamLobbyProvider: LobbyProvider backed by Steam Matchmaking.
 *
 * Wraps SteamClient (which wraps the Electron IPC bridge, which wraps
 * steamworks.js `matchmaking`). Converts Steam wire shapes to the
 * backend-neutral types in src/multiplayer/lobby/*.
 */

import type {
  LobbyProvider,
  HostLobbyOptions,
} from '../multiplayer/lobby/LobbyProvider.js';
import type {
  Lobby,
  LobbyMember,
  LobbySummary,
  LobbyEvent,
  LobbyVisibility,
} from '../multiplayer/lobby/types.js';
import { GAME_META_VALUE, LobbyMetaKeys } from '../multiplayer/lobby/types.js';
import { makePlayerIdentity, type PlayerIdentity } from '../multiplayer/identity.js';
import { SteamClient } from './SteamClient.js';
import type {
  SteamLobbyInfoWire,
  SteamLobbySummaryWire,
  SteamLobbyEventWire,
} from './ipc.js';

const LOG = '[Steam][Lobby]';

function memberFromWire(w: { steamId: string; name: string; isOwner: boolean }): LobbyMember {
  return { identity: makePlayerIdentity(w.steamId, w.name, 'steam'), isOwner: w.isOwner };
}

function lobbyFromWire(w: SteamLobbyInfoWire, visibility: LobbyVisibility): Lobby {
  const owner =
    w.members.find((m) => m.isOwner) ??
    { steamId: w.owner, name: '', isOwner: true };
  return {
    id: w.lobbyId,
    visibility,
    owner: makePlayerIdentity(owner.steamId, owner.name, 'steam'),
    members: w.members.map(memberFromWire),
    maxMembers: w.maxMembers,
    metadata: { ...w.metadata },
  };
}

function summaryFromWire(w: SteamLobbySummaryWire): LobbySummary {
  return {
    id: w.lobbyId,
    hostName: w.hostName,
    memberCount: w.memberCount,
    maxMembers: w.maxMembers,
    visibility: w.visibility,
    metadata: { ...w.metadata },
  };
}

export class SteamLobbyProvider implements LobbyProvider {
  readonly kind = 'steam' as const;

  private readonly steam: SteamClient;
  private _localPlayer: PlayerIdentity | null = null;
  private _current: Lobby | null = null;
  /** Visibility the local player chose when hosting/joining (Steam won't report it). */
  private _visibility: LobbyVisibility = 'friends';

  private readonly eventListeners = new Set<(e: LobbyEvent) => void>();
  private readonly joinListeners = new Set<(id: string) => void>();
  private pendingJoinLobbyId: string | null = null;
  private readonly unsubs: Array<() => void> = [];
  private disposed = false;

  /** Throws if not an Electron+Steam build. */
  constructor() {
    const steam = SteamClient.get();
    if (!steam) {
      throw new Error('Steam lobbies require the Steam desktop build.');
    }
    this.steam = steam;

    this.unsubs.push(
      this.steam.onLobbyEvent.add((e) => this.handleLobbyEvent(e)),
      this.steam.onJoinRequested.add((lobbyId) => this.handleJoinRequested(lobbyId)),
      this.steam.onStatus.add((s) => {
        if ((s.state === 'lost' || s.state === 'failed') && this._current) {
          this.emit({ type: 'lobby_closed', reason: 'error' in s ? s.error : 'Steam offline' });
          this._current = null;
        }
      }),
    );

    // Deliver any launch-arg join to listeners once they subscribe.
    void this.steam.takePendingJoin().then((id) => {
      if (id) {
        console.log(`${LOG} pending launch-arg join lobby=${id}`);
        this.pendingJoinLobbyId = id;
        this.flushPendingJoin();
      }
    });
  }

  // -- readiness ----------------------------------------------------------

  get localPlayer(): PlayerIdentity | null { return this._localPlayer; }
  get currentLobby(): Lobby | null { return this._current; }

  isReady(): boolean { return this.steam.isReady && this._localPlayer !== null; }

  async waitUntilReady(timeoutMs = 8000): Promise<void> {
    const st = await this.steam.init();
    if (!st.ok) throw new Error(st.error || 'Steam is not available.');
    const deadline = Date.now() + timeoutMs;
    // getIdentity resolves quickly once init is ok; timeout is a safety net.
    while (Date.now() < deadline) {
      try {
        this._localPlayer = await this.steam.getIdentity();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error('Timed out resolving Steam identity.');
  }

  // -- lifecycle --------------------------------------------------------------

  async hostLobby(opts: HostLobbyOptions): Promise<Lobby> {
    await this.waitUntilReady();
    this._visibility = opts.visibility;
    const metadata: Record<string, string> = {
      [LobbyMetaKeys.game]: GAME_META_VALUE,
      [LobbyMetaKeys.matchStarted]: '0',
      ...opts.metadata,
    };
    const wire = await this.steam.raw.hostLobby({
      visibility: opts.visibility,
      maxMembers: opts.maxMembers,
      metadata,
    });
    this._current = lobbyFromWire(wire, opts.visibility);
    console.log(`${LOG} hosted ${this._current.id} (${opts.visibility}, max ${opts.maxMembers})`);
    return this._current;
  }

  async listLobbies(): Promise<LobbySummary[]> {
    await this.waitUntilReady();
    const wires = await this.steam.raw.listLobbies();
    return wires.map(summaryFromWire);
  }

  async joinLobby(lobbyId: string): Promise<Lobby> {
    await this.waitUntilReady();
    const wire = await this.steam.raw.joinLobby(lobbyId);
    if (wire.metadata[LobbyMetaKeys.matchStarted] === '1') {
      // Join, read state, then bail out cleanly — caller shows "match started".
      await this.steam.raw.leaveLobby().catch(() => {});
      throw new Error('That match has already started.');
    }
    this._current = lobbyFromWire(wire, this._visibility);
    console.log(`${LOG} joined ${this._current.id}`);
    return this._current;
  }

  async leaveLobby(): Promise<void> {
    if (!this._current) return;
    const id = this._current.id;
    this._current = null;
    await this.steam.raw.leaveLobby().catch((e) => console.warn(`${LOG} leave error:`, e));
    console.log(`${LOG} left ${id}`);
  }

  async setLobbyMetadata(patch: Record<string, string>): Promise<void> {
    if (!this._current) throw new Error('Not in a lobby.');
    await this.steam.raw.setLobbyData(patch);
  }

  async openInviteDialog(): Promise<void> {
    if (!this._current) throw new Error('Not in a lobby.');
    await this.steam.raw.openInviteDialog();
  }

  // -- events ------------------------------------------------------------------

  on(listener: (event: LobbyEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onJoinRequested(listener: (lobbyId: string) => void): () => void {
    this.joinListeners.add(listener);
    if (this.pendingJoinLobbyId) this.flushPendingJoin();
    return () => this.joinListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.eventListeners.clear();
    this.joinListeners.clear();
    if (this._current) void this.steam.raw.leaveLobby().catch(() => {});
    this._current = null;
  }

  // -- internals -------------------------------------------------------------

  private emit(e: LobbyEvent): void {
    for (const l of [...this.eventListeners]) {
      try { l(e); } catch (err) { console.error(`${LOG} listener error:`, err); }
    }
  }

  private flushPendingJoin(): void {
    const id = this.pendingJoinLobbyId;
    if (!id || this.joinListeners.size === 0) return;
    this.pendingJoinLobbyId = null;
    for (const l of [...this.joinListeners]) {
      try { l(id); } catch (err) { console.error(`${LOG} join listener error:`, err); }
    }
  }

  private handleJoinRequested(lobbyId: string): void {
    if (this._current && this._current.id === lobbyId) return; // duplicate / stale
    this.pendingJoinLobbyId = lobbyId;
    this.flushPendingJoin();
  }

  private handleLobbyEvent(e: SteamLobbyEventWire): void {
    if (!this._current || e.lobbyId !== this._current.id) return;
    const prevOwnerId = this._current.owner.id;
    this._current = lobbyFromWire(e, this._current.visibility);

    switch (e.kind) {
      case 'member_joined': {
        const m = this._current.members.find((x) => x.identity.id === e.steamId);
        if (m) this.emit({ type: 'member_joined', member: m });
        break;
      }
      case 'member_left':
        this.emit({
          type: 'member_left',
          identity: makePlayerIdentity(e.steamId ?? '', '', 'steam'),
        });
        break;
      case 'metadata_changed':
        this.emit({ type: 'metadata_changed', metadata: this._current.metadata });
        break;
      case 'lobby_closed':
        this.emit({ type: 'lobby_closed', reason: e.reason ?? 'closed' });
        this._current = null;
        return;
    }
    if (this._current && this._current.owner.id !== prevOwnerId) {
      this.emit({ type: 'owner_changed', owner: this._current.owner });
    }
  }
}
