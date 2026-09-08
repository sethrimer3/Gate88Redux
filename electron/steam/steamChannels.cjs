/**
 * Sign99RTS — Steam IPC channel names & wire shapes (single source of truth).
 *
 * Required by BOTH the Electron main process (electron/steam/steamworksBridge.cjs)
 * and the preload script (electron/preload.cjs). The renderer gets a typed
 * mirror in src/steam/ipc.ts; a vitest test asserts the two stay in sync.
 *
 * IPC rules:
 *   - renderer → main : ipcRenderer.invoke(REQ.*)  (request/response, may reject)
 *   - main → renderer : webContents.send(EVT.*)     (push events)
 *   - All SteamIDs cross IPC as decimal strings, never bigint.
 *   - All binary payloads (gameplay packets) cross IPC as number[] (Uint8Array
 *     spread) to stay structured-clone friendly and avoid Buffer in renderer.
 */

'use strict';

/** renderer → main, invoke/handle. */
const REQ = {
  /** () → { ok, running, initialized, appId, error } */
  init: 'sign99:steam:init',
  /** () → { steamId, name, appId } | throws */
  identity: 'sign99:steam:identity',
  /** ({ visibility, maxMembers, metadata }) → LobbyInfoWire */
  lobbyHost: 'sign99:steam:lobby:host',
  /** () → LobbySummaryWire[] */
  lobbyList: 'sign99:steam:lobby:list',
  /** ({ lobbyId }) → LobbyInfoWire */
  lobbyJoin: 'sign99:steam:lobby:join',
  /** () → void */
  lobbyLeave: 'sign99:steam:lobby:leave',
  /** ({ patch }) → void  (owner only) */
  lobbySetData: 'sign99:steam:lobby:setData',
  /** () → void  (opens Steam overlay invite dialog for current lobby) */
  lobbyInvite: 'sign99:steam:lobby:invite',
  /** ({ connect }) → void  (rich-presence "connect" string; '' clears) */
  setConnect: 'sign99:steam:setConnect',
  /** () → { lobbyId } | { lobbyId: null }  (pending launch-arg join, consumed once) */
  takePendingJoin: 'sign99:steam:takePendingJoin',
  /** ({ toSteamId, reliable, channel, bytes }) → void */
  netSend: 'sign99:steam:net:send',
  /** ({ steamId }) → void  (accept an incoming P2P session) */
  netAccept: 'sign99:steam:net:accept',
};

/** main → renderer, webContents.send. */
const EVT = {
  /** { state: 'ready'|'lost'|'failed', error? } */
  status: 'sign99:steam:evt:status',
  /** { lobbyId, kind: 'member_joined'|'member_left'|'owner_changed'|'metadata_changed'|'lobby_closed', ... } */
  lobby: 'sign99:steam:evt:lobby',
  /** { lobbyId }  (GameLobbyJoinRequested, or launch-arg while running) */
  joinRequested: 'sign99:steam:evt:joinRequested',
  /** { fromSteamId, channel, bytes: number[] }  (one decoded P2P packet) */
  netPacket: 'sign99:steam:evt:netPacket',
  /** { steamId }  (P2PSessionRequest — renderer decides whether to accept) */
  netSessionRequest: 'sign99:steam:evt:netSessionRequest',
  /** { steamId, error }  (P2PSessionConnectFail) */
  netSessionFailed: 'sign99:steam:evt:netSessionFailed',
};

/** Steam P2P channel numbers used by SteamTransport (kept small & explicit). */
const NET_CHANNEL = {
  /** Reliable: control messages + client inputs. */
  reliable: 0,
  /** Unreliable: host authoritative snapshots. */
  unreliable: 1,
};

module.exports = { REQ, EVT, NET_CHANNEL };
