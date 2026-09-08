/**
 * Sign99RTS — SteamMultiplayerController.
 *
 * UI-agnostic orchestrator for the Steam multiplayer menu flow. It owns a
 * SteamLobbyProvider, converts lobby membership into the game's existing slot
 * model, drives match start via lobby metadata (reliable + ordered), and hands
 * the menu a `{ transport, matchStart }` pair in exactly the same shape the
 * WebRTC path already produces (`MainMenu.takePendingOnlineMatchStart`).
 *
 * Match setup uses Steam **lobby metadata** (not the P2P channel): the host
 * writes `match_started/seed/slots`; every client reacts to the metadata_changed
 * event. The P2P SteamTransport then carries only in-match traffic.
 *
 * The menu code stays thin: create one controller, call host/browse/join/start,
 * poll `takePendingMatchStart()` each frame, and render `status`.
 *
 * Log prefix: [Steam][MP].
 */

import type { MsgMatchStart, LobbyState, LobbySlot } from '../lan/protocol.js';
import type { MultiplayerTransport } from '../net/transport.js';
import type { LobbySummary, LobbyVisibility } from '../multiplayer/lobby/types.js';
import { LobbyMetaKeys } from '../multiplayer/lobby/types.js';
import { SteamLobbyProvider } from './SteamLobbyProvider.js';
import { SteamTransport } from './SteamTransport.js';
import { SteamClient } from './SteamClient.js';
import { isSteamBuild } from './ipc.js';
import { orderMembers, assignSlots, peersForSlot, type SlotAssignment } from './slotOrder.js';
import type { PlayerIdentity } from '../multiplayer/identity.js';

const LOG = '[Steam][MP]';

const META_SEED = 'match_seed';
const META_SLOTS = 'match_slots';

export type { SlotAssignment };

export type SteamMpPhase =
  | 'idle'
  | 'initializing'
  | 'lobby_host'
  | 'lobby_client'
  | 'browsing'
  | 'starting'
  | 'error';

export interface SteamMpState {
  phase: SteamMpPhase;
  status: string;
  /** Populated in lobby_host / lobby_client. */
  members: Array<{ slot: number; name: string; isOwner: boolean; isLocal: boolean }>;
  isOwner: boolean;
  lobbyId: string | null;
  browseResults: LobbySummary[];
}

export class SteamMultiplayerController {
  static isAvailable(): boolean { return isSteamBuild(); }

  private provider: SteamLobbyProvider | null = null;
  private local: PlayerIdentity | null = null;
  private assignments: SlotAssignment[] = [];
  private mySlot = 0;
  private matchStarted = false;
  private pending: { transport: MultiplayerTransport; matchStart: MsgMatchStart } | null = null;
  private disposed = false;

  private _state: SteamMpState = {
    phase: 'idle', status: '', members: [], isOwner: false, lobbyId: null, browseResults: [],
  };
  onChange: (() => void) | null = null;

  get state(): Readonly<SteamMpState> { return this._state; }

  // -- lifecycle -----------------------------------------------------------

  private async ensureProvider(): Promise<SteamLobbyProvider> {
    if (this.provider) return this.provider;
    this.setPhase('initializing', 'Connecting to Steam…');
    const p = new SteamLobbyProvider();
    await p.waitUntilReady();
    this.local = SteamClient.get()!.status?.ok
      ? await SteamClient.get()!.getIdentity()
      : null;
    p.on((e) => this.onLobbyEvent(e.type));
    p.onJoinRequested((id) => { void this.join(id); });
    this.provider = p;
    return p;
  }

  /** Wire the "friend clicked Join Game / launched via Steam" path early. */
  async attachJoinListener(navigateToLobby: () => void): Promise<void> {
    if (!SteamMultiplayerController.isAvailable()) return;
    const p = await this.ensureProvider();
    p.onJoinRequested((id) => {
      console.log(`${LOG} external join request → ${id}`);
      navigateToLobby();
      void this.join(id);
    });
  }

  // -- actions -----------------------------------------------------------------

  async host(opts: { maxMembers: number; visibility: LobbyVisibility }): Promise<void> {
    try {
      const p = await this.ensureProvider();
      this.setPhase('initializing', 'Creating Steam lobby…');
      await p.hostLobby({
        maxMembers: opts.maxMembers,
        visibility: opts.visibility,
        metadata: { [LobbyMetaKeys.mode]: 'Skirmish' },
      });
      this.matchStarted = false;
      this.recomputeMembers();
      this.setPhase('lobby_host', 'Lobby ready. Invite friends or wait for players, then Start.');
    } catch (e) {
      this.setError(e);
    }
  }

  async browse(): Promise<void> {
    try {
      const p = await this.ensureProvider();
      this.setPhase('browsing', 'Searching for Steam lobbies…');
      const results = await p.listLobbies();
      this._state.browseResults = results;
      this.setPhase('browsing', results.length ? `${results.length} lobby(ies) found.` : 'No open lobbies found.');
    } catch (e) {
      this.setError(e);
    }
  }

  async join(lobbyId: string): Promise<void> {
    try {
      const p = await this.ensureProvider();
      this.setPhase('initializing', 'Joining lobby…');
      const lobby = await p.joinLobby(lobbyId);
      this.matchStarted = false;
      this.recomputeMembers();
      this.setPhase('lobby_client', 'In lobby. Waiting for the host to start.');
      // The host may have already written match metadata before we joined.
      this.maybeStartFromMetadata(lobby.metadata);
    } catch (e) {
      this.setError(e);
    }
  }

  async invite(): Promise<void> {
    try {
      await this.provider?.openInviteDialog();
    } catch (e) {
      this.setError(e);
    }
  }

  async leave(): Promise<void> {
    this.pending?.transport.disconnect();
    this.pending = null;
    await this.provider?.leaveLobby().catch(() => {});
    this._state.browseResults = [];
    this.setPhase('idle', '');
  }

  /** Host-only: assign slots, publish match metadata, build the local transport. */
  async startMatch(seed: number): Promise<void> {
    const p = this.provider;
    if (!p?.currentLobby || !this.local) { this.setError(new Error('Not in a lobby.')); return; }
    if (!this._state.isOwner) { this.setError(new Error('Only the lobby owner can start.')); return; }
    if (this._state.members.length < 2) {
      this.setPhase('lobby_host', 'Need at least one other player to start.');
      return;
    }
    try {
      this.setPhase('starting', 'Starting match…');
      this.assignments = assignSlots(p.currentLobby.members.map((m) => m.identity), p.currentLobby.owner.id);
      this.mySlot = this.assignments.find((a) => a.steamId === this.local?.id)?.slot ?? 0;
      await p.setLobbyMetadata({
        [LobbyMetaKeys.matchStarted]: '1',
        [META_SEED]: String(seed),
        [META_SLOTS]: JSON.stringify(this.assignments),
      });
      this.buildPending(seed);
      console.log(`${LOG} host started match, seed=${seed}, ${this.assignments.length} slots`);
    } catch (e) {
      this.setError(e);
    }
  }

  /**
   * Called by the menu every frame. Returns the pending match-start bundle
   * exactly once, in the same shape as the WebRTC path.
   */
  takePendingMatchStart(): { transport: MultiplayerTransport; matchStart: MsgMatchStart } | null {
    const m = this.pending;
    this.pending = null;
    return m;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.transport.disconnect();
    this.pending = null;
    this.provider?.dispose();
    this.provider = null;
  }

  // -- internals -------------------------------------------------------------

  private onLobbyEvent(kind: string): void {
    if (kind === 'lobby_closed') {
      this.setPhase('error', 'The lobby was closed.');
      return;
    }
    this.recomputeMembers();
    if (kind === 'metadata_changed' && this.provider?.currentLobby) {
      this.maybeStartFromMetadata(this.provider.currentLobby.metadata);
    }
  }

  private recomputeMembers(): void {
    const lobby = this.provider?.currentLobby;
    if (!lobby || !this.local) { this._state.members = []; return; }
    const ordered = orderMembers(lobby.members.map((m) => m.identity), lobby.owner.id);
    this._state.members = ordered.map((id, slot) => ({
      slot,
      name: id.name || `Player ${slot + 1}`,
      isOwner: id.id === lobby.owner.id,
      isLocal: id.id === this.local!.id,
    }));
    this._state.isOwner = lobby.owner.id === this.local.id;
    this._state.lobbyId = lobby.id;
    this.emitChange();
  }

  private maybeStartFromMetadata(meta: Readonly<Record<string, string>>): void {
    if (this.matchStarted || this._state.isOwner) return;
    if (meta[LobbyMetaKeys.matchStarted] !== '1') return;
    const rawSlots = meta[META_SLOTS];
    const seed = Number(meta[META_SEED]);
    if (!rawSlots || !Number.isFinite(seed)) return;
    try {
      this.assignments = JSON.parse(rawSlots) as SlotAssignment[];
    } catch {
      this.setError(new Error('Malformed match metadata from host.'));
      return;
    }
    this.mySlot = this.assignments.find((a) => a.steamId === this.local?.id)?.slot ?? -1;
    if (this.mySlot < 0) { this.setError(new Error('You are not in the match roster.')); return; }
    this.buildPending(seed);
    console.log(`${LOG} client joining match from metadata, slot ${this.mySlot}, seed ${seed}`);
  }

  private buildPending(seed: number): void {
    if (this.matchStarted) return;
    this.matchStarted = true;
    const isHost = this._state.isOwner;
    const hostSlot = 0;

    const peers = peersForSlot(this.assignments, this.mySlot);

    const transport = new SteamTransport({
      isHost,
      mySlot: this.mySlot,
      hostSlot,
      localPlayer: this.local!,
      peers,
    });

    const slots: LobbySlot[] = this.assignments.map((a) => ({
      slotIndex: a.slot,
      type: 'human' as const,
      playerName: a.name,
      race: 'terran' as const,
      ready: true,
    }));
    const lobby: LobbyState = { slots, hostClientId: this.assignments[0]?.steamId ?? '', matchStarted: true };
    const matchStart: MsgMatchStart = {
      type: 'match_start',
      mySlot: this.mySlot,
      hostSlot,
      seed,
      lobby,
    };

    this.pending = { transport, matchStart };
    this.setPhase('starting', 'Establishing Steam connection…');
  }

  private setPhase(phase: SteamMpPhase, status: string): void {
    this._state.phase = phase;
    this._state.status = status;
    this.emitChange();
  }

  private setError(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${LOG} ${msg}`);
    this.setPhase('error', msg);
  }

  private emitChange(): void { try { this.onChange?.(); } catch { /* ignore */ } }
}
