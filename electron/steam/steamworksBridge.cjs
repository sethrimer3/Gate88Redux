/**
 * Sign99RTS — Steamworks bridge (Electron MAIN process).
 *
 * This is the ONLY file in the project that `require`s `steamworks.js`. The
 * native addon cannot run in the sandboxed renderer, so every Steam operation
 * the game needs is exposed here over IPC (channel names in ./steamChannels.cjs).
 *
 * Responsibilities:
 *   - Robust Steam init (running? initialized? valid app id?).
 *   - Steam identity (SteamID64 as string, persona name).
 *   - Lobby lifecycle + membership/owner/metadata callbacks.
 *   - Friend invites + "Join Game" (GameLobbyJoinRequested) + launch-arg join.
 *   - Gameplay networking over Steam P2P (ISteamNetworking).
 *
 * NETWORKING NOTE (important, see docs/STEAM_MULTIPLAYER.md):
 *   steamworks.js@0.4.0 only binds the legacy ISteamNetworking P2P API
 *   (sendP2PPacket / readP2PPacket). It does NOT expose the modern
 *   ISteamNetworkingMessages/Sockets. Steam still routes P2P through its relay
 *   backend, and SendType.Reliable covers must-arrive data, so this is a sound
 *   base; swapping in NetworkingMessages later only touches THIS file plus the
 *   `netSend`/`netPacket` plumbing — SteamTransport and all gameplay code are
 *   unaffected.
 *
 * Diagnostics: every log line is prefixed `[Steam]`. No per-frame logging.
 */

'use strict';

const { ipcMain } = require('electron');
const { REQ, EVT, NET_CHANNEL } = require('./steamChannels.cjs');

const LOG = '[Steam]';
const DEV_APP_ID = 480; // Spacewar — Valve's public dev/test app id.
const P2P_POLL_MS = 16; // ~60 Hz packet drain.
const P2P_MAX_PACKET = 512 * 1024;

/** @typedef {import('steamworks.js')} Steamworks */

let steamworks = null;      // the module (require result)
let client = null;          // steamworks.init(...) return
let initTried = false;
let initOk = false;
let initError = '';
let appId = 0;

/** @type {import('electron').WebContents | null} */
let targetWebContents = null;
let currentLobby = null;    // steamworks Lobby instance
let currentLobbyId = '';    // decimal string
const callbackHandles = [];
let p2pTimer = null;
let pendingJoinLobbyId = ''; // from launch args, consumed once by renderer

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function send(channel, payload) {
  if (targetWebContents && !targetWebContents.isDestroyed()) {
    targetWebContents.send(channel, payload);
  }
}

function idStr(steamId) {
  // Accepts bigint, PlayerSteamId, or string.
  if (steamId == null) return '';
  if (typeof steamId === 'bigint') return steamId.toString();
  if (typeof steamId === 'string') return steamId;
  if (typeof steamId === 'object' && steamId.steamId64 != null) {
    return steamId.steamId64.toString();
  }
  return String(steamId);
}

function toBigIntId(s) {
  return BigInt(String(s).trim());
}

function resolveAppId() {
  const raw =
    process.env.SIGN99_STEAM_APP_ID ||
    process.env.STEAM_APP_ID ||
    process.env.SteamAppId ||
    '';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return DEV_APP_ID;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/**
 * Attempt Steam init exactly once. Returns a plain status object; never throws.
 * @returns {{ ok:boolean, running:boolean, initialized:boolean, appId:number, error:string }}
 */
function ensureInit() {
  if (initTried) {
    return { ok: initOk, running: initOk, initialized: initOk, appId, error: initError };
  }
  initTried = true;
  appId = resolveAppId();

  try {
    steamworks = require('steamworks.js');
  } catch (e) {
    initError = `steamworks.js native addon failed to load: ${e && e.message ? e.message : e}`;
    console.error(LOG, initError);
    return { ok: false, running: false, initialized: false, appId, error: initError };
  }

  try {
    // init() throws if Steam is not running or the app id is unknown.
    client = steamworks.init(appId);
    initOk = true;
    initError = '';
    const id = idStr(client.localplayer.getSteamId());
    console.log(`${LOG} initialized. appId=${appId} steamId=${id} name="${client.localplayer.getName()}"`);
    registerCallbacks();
    startP2PPump();
    send(EVT.status, { state: 'ready' });
    return { ok: true, running: true, initialized: true, appId, error: '' };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    if (/not running|SteamAPI_Init|steam is not/i.test(msg)) {
      initError = 'Steam client is not running. Start Steam and relaunch the game.';
    } else if (/app ?id|steam_appid/i.test(msg)) {
      initError = `Steam rejected app id ${appId}. Check SIGN99_STEAM_APP_ID / steam_appid.txt.`;
    } else {
      initError = `Steamworks init failed: ${msg}`;
    }
    console.error(LOG, initError);
    send(EVT.status, { state: 'failed', error: initError });
    return { ok: false, running: false, initialized: false, appId, error: initError };
  }
}

function registerCallbacks() {
  const CB = steamworks.SteamCallback;
  const reg = (name, handler) => {
    try {
      callbackHandles.push(client.callback.register(CB[name], handler));
    } catch (e) {
      console.warn(`${LOG} could not register callback ${name}:`, e && e.message);
    }
  };

  reg('SteamServersDisconnected', () => {
    console.warn(`${LOG} Steam servers disconnected.`);
    send(EVT.status, { state: 'lost', error: 'Steam went offline.' });
  });
  reg('SteamServersConnected', () => {
    console.log(`${LOG} Steam servers reconnected.`);
    send(EVT.status, { state: 'ready' });
  });

  reg('LobbyChatUpdate', (v) => {
    // v: { lobby, user_changed, making_change, member_state_change }
    if (idStr(v.lobby) !== currentLobbyId) return;
    const who = idStr(v.user_changed);
    // ChatMemberStateChange: 0 Entered, 1 Left, 2 Disconnected, 3 Kicked, 4 Banned
    const left = v.member_state_change !== 0;
    console.log(`${LOG} lobby ${currentLobbyId} member ${left ? 'left' : 'joined'}: ${who}`);
    emitLobbySnapshot(left ? { kind: 'member_left', steamId: who } : { kind: 'member_joined', steamId: who });
  });

  reg('LobbyDataUpdate', (v) => {
    if (idStr(v.lobby) !== currentLobbyId) return;
    emitLobbySnapshot({ kind: 'metadata_changed' });
  });

  reg('GameLobbyJoinRequested', (v) => {
    const lobbyId = idStr(v.lobby_steam_id);
    console.log(`${LOG} GameLobbyJoinRequested lobby=${lobbyId} from=${idStr(v.friend_steam_id)}`);
    send(EVT.joinRequested, { lobbyId });
  });

  reg('P2PSessionRequest', (v) => {
    const from = idStr(v.remote);
    console.log(`${LOG} P2P session request from ${from}`);
    send(EVT.netSessionRequest, { steamId: from });
  });
  reg('P2PSessionConnectFail', (v) => {
    const from = idStr(v.remote);
    console.warn(`${LOG} P2P session connect fail from ${from} error=${v.error}`);
    send(EVT.netSessionFailed, { steamId: from, error: Number(v.error) || 0 });
  });
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

const VISIBILITY_TO_TYPE = { public: 2, friends: 1, private: 0 }; // matchmaking.LobbyType
const TYPE_TO_VISIBILITY = { 2: 'public', 1: 'friends', 0: 'private', 3: 'private' };

function lobbyInfoWire(lobby) {
  const data = safe(() => lobby.getFullData()) || {};
  const owner = idStr(safe(() => lobby.getOwner()));
  const members = (safe(() => lobby.getMembers()) || []).map((m) => {
    const sid = idStr(m);
    return { steamId: sid, name: '', isOwner: sid === owner };
  });
  const limit = safe(() => lobby.getMemberLimit());
  return {
    lobbyId: idStr(lobby.id),
    owner,
    members,
    maxMembers: limit != null ? Number(limit) : members.length,
    metadata: data,
    visibility: 'friends', // Steam does not report a joined lobby's type; caller set it.
  };
}

function emitLobbySnapshot(extra) {
  if (!currentLobby) return;
  const base = lobbyInfoWire(currentLobby);
  send(EVT.lobby, Object.assign(base, extra || {}));
}

function safe(fn) {
  try { return fn(); } catch { return undefined; }
}

async function handleLobbyHost({ visibility, maxMembers, metadata }) {
  const st = ensureInit();
  if (!st.ok) throw new Error(st.error);
  const type = VISIBILITY_TO_TYPE[visibility] ?? 1;
  const lobby = await client.matchmaking.createLobby(type, Math.max(2, Math.min(8, maxMembers | 0)));
  currentLobby = lobby;
  currentLobbyId = idStr(lobby.id);
  const meta = Object.assign(
    {
      game: 'Sign99RTS',
      host_name: client.localplayer.getName(),
    },
    metadata || {},
  );
  safe(() => lobby.mergeFullData(meta));
  safe(() => lobby.setJoinable(true));
  // Rich presence enables the Steam "Join Game" button for friends.
  safe(() => client.localplayer.setRichPresence('connect', `+connect_lobby ${currentLobbyId}`));
  safe(() => client.localplayer.setRichPresence('steam_display', '#Status_InLobby'));
  console.log(`${LOG} hosted lobby ${currentLobbyId} type=${visibility} max=${maxMembers}`);
  const wire = lobbyInfoWire(lobby);
  wire.visibility = visibility;
  return wire;
}

async function handleLobbyList() {
  const st = ensureInit();
  if (!st.ok) throw new Error(st.error);
  const lobbies = await client.matchmaking.getLobbies();
  const out = [];
  for (const lb of lobbies) {
    const data = safe(() => lb.getFullData()) || {};
    if (data.game !== 'Sign99RTS') continue;
    if (data.match_started === '1') continue;
    const count = Number(safe(() => lb.getMemberCount()) || 0n);
    const limit = safe(() => lb.getMemberLimit());
    out.push({
      lobbyId: idStr(lb.id),
      hostName: data.host_name || 'Host',
      memberCount: count,
      maxMembers: limit != null ? Number(limit) : 8,
      visibility: 'public',
      metadata: data,
    });
  }
  console.log(`${LOG} browse: ${out.length} Sign99RTS lobbies`);
  return out;
}

async function handleLobbyJoin({ lobbyId }) {
  const st = ensureInit();
  if (!st.ok) throw new Error(st.error);
  if (currentLobbyId && currentLobbyId === String(lobbyId)) {
    return lobbyInfoWire(currentLobby); // idempotent — duplicate join request
  }
  if (currentLobby) safe(() => currentLobby.leave());
  const lobby = await client.matchmaking.joinLobby(toBigIntId(lobbyId));
  currentLobby = lobby;
  currentLobbyId = idStr(lobby.id);
  safe(() => client.localplayer.setRichPresence('connect', `+connect_lobby ${currentLobbyId}`));
  console.log(`${LOG} joined lobby ${currentLobbyId}`);
  return lobbyInfoWire(lobby);
}

function handleLobbyLeave() {
  if (currentLobby) {
    safe(() => currentLobby.leave());
    console.log(`${LOG} left lobby ${currentLobbyId}`);
  }
  currentLobby = null;
  currentLobbyId = '';
  safe(() => client && client.localplayer.setRichPresence('connect', undefined));
}

function handleLobbySetData({ patch }) {
  if (!currentLobby) throw new Error('Not in a lobby.');
  const ok = safe(() => currentLobby.mergeFullData(patch || {}));
  if (!ok) throw new Error('Failed to set lobby metadata (owner only).');
}

function handleLobbyInvite() {
  if (!currentLobby) throw new Error('Not in a lobby.');
  safe(() => client.overlay.activateInviteDialog(currentLobby.id));
}

// ---------------------------------------------------------------------------
// P2P networking
// ---------------------------------------------------------------------------

function startP2PPump() {
  if (p2pTimer) return;
  p2pTimer = setInterval(() => {
    if (!client) return;
    try {
      // steamworks.js 0.4.0: isP2PPacketAvailable() → size of next packet (0 if none).
      let guard = 0;
      let size = client.networking.isP2PPacketAvailable();
      while (size > 0 && guard++ < 256) {
        const pkt = client.networking.readP2PPacket(Math.min(size, P2P_MAX_PACKET));
        if (pkt && pkt.data) {
          send(EVT.netPacket, {
            fromSteamId: idStr(pkt.steamId),
            channel: 0, // 0.4.0 P2P has a single channel surface here
            bytes: Array.from(pkt.data),
          });
        }
        size = client.networking.isP2PPacketAvailable();
      }
    } catch (e) {
      // Non-fatal; keep pumping.
      if (!startP2PPump._warned) {
        console.warn(`${LOG} P2P pump error:`, e && e.message);
        startP2PPump._warned = true;
      }
    }
  }, P2P_POLL_MS);
}

function handleNetSend({ toSteamId, reliable, bytes }) {
  if (!client) throw new Error('Steam not initialized.');
  const SendType = 2; // Reliable
  const Unreliable = 0;
  const buf = Buffer.from(bytes);
  const ok = client.networking.sendP2PPacket(
    toBigIntId(toSteamId),
    reliable ? SendType : Unreliable,
    buf,
  );
  if (!ok) throw new Error(`sendP2PPacket to ${toSteamId} returned false`);
}

function handleNetAccept({ steamId }) {
  if (!client) return;
  safe(() => client.networking.acceptP2PSession(toBigIntId(steamId)));
  console.log(`${LOG} accepted P2P session with ${steamId}`);
}

// ---------------------------------------------------------------------------
// launch args
// ---------------------------------------------------------------------------

/**
 * Parse `+connect_lobby <id>` / `+connect <id>` / a bare lobby id from argv.
 * Call once at startup and again from second-instance argv (single-instance lock).
 */
function ingestLaunchArgs(argv) {
  const args = argv || process.argv;
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if ((a === '+connect_lobby' || a === '+connect' || a === '-connect_lobby') && args[i + 1]) {
      const id = String(args[i + 1]).replace(/[^0-9]/g, '');
      if (id) {
        pendingJoinLobbyId = id;
        console.log(`${LOG} launch arg join lobby=${id}`);
      }
    } else {
      const m = a.match(/connect_lobby[ =]+(\d{6,})/);
      if (m) {
        pendingJoinLobbyId = m[1];
        console.log(`${LOG} launch arg join lobby=${m[1]}`);
      }
    }
  }
  // If the renderer is already up, deliver immediately.
  if (pendingJoinLobbyId && targetWebContents) {
    send(EVT.joinRequested, { lobbyId: pendingJoinLobbyId });
  }
}

function takePendingJoin() {
  const id = pendingJoinLobbyId;
  pendingJoinLobbyId = '';
  return { lobbyId: id || null };
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

let ipcInstalled = false;

function installIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;

  ipcMain.handle(REQ.init, () => ensureInit());
  ipcMain.handle(REQ.identity, () => {
    const st = ensureInit();
    if (!st.ok) throw new Error(st.error);
    return {
      steamId: idStr(client.localplayer.getSteamId()),
      name: client.localplayer.getName(),
      appId,
    };
  });
  ipcMain.handle(REQ.lobbyHost, (_e, a) => handleLobbyHost(a));
  ipcMain.handle(REQ.lobbyList, () => handleLobbyList());
  ipcMain.handle(REQ.lobbyJoin, (_e, a) => handleLobbyJoin(a));
  ipcMain.handle(REQ.lobbyLeave, () => handleLobbyLeave());
  ipcMain.handle(REQ.lobbySetData, (_e, a) => handleLobbySetData(a));
  ipcMain.handle(REQ.lobbyInvite, () => handleLobbyInvite());
  ipcMain.handle(REQ.setConnect, (_e, a) => {
    if (client) safe(() => client.localplayer.setRichPresence('connect', a && a.connect ? a.connect : undefined));
  });
  ipcMain.handle(REQ.takePendingJoin, () => takePendingJoin());
  ipcMain.handle(REQ.netSend, (_e, a) => handleNetSend(a));
  ipcMain.handle(REQ.netAccept, (_e, a) => handleNetAccept(a));
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {object} [opts]
 * @param {boolean} [opts.eager]  call ensureInit() now instead of lazily
 */
function attach(win, opts) {
  installIpc();
  targetWebContents = win.webContents;
  ingestLaunchArgs(process.argv);
  if (opts && opts.eager) {
    // Defer one tick so the window can subscribe to EVT.status first.
    setTimeout(() => ensureInit(), 0);
  }
}

function dispose() {
  if (p2pTimer) { clearInterval(p2pTimer); p2pTimer = null; }
  for (const h of callbackHandles) { safe(() => h.disconnect()); }
  callbackHandles.length = 0;
  if (currentLobby) safe(() => currentLobby.leave());
  currentLobby = null;
  currentLobbyId = '';
  // steamworks.js has no explicit shutdown in 0.4.0; process exit handles it.
}

module.exports = { attach, dispose, ingestLaunchArgs, ensureInit, NET_CHANNEL };
