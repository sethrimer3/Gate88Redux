/**
 * Gate88Redux LAN WebSocket Server
 *
 * Run with:  npm run lan:server
 *            (or tsx server/lanServer.ts)
 *
 * The first client to connect becomes the host. Other clients join as players
 * in open slots. The host browser runs the authoritative simulation and
 * broadcasts periodic game-state snapshots through this relay server.
 *
 * Connection flow:
 *   Host:      connect → server sends welcome(slot=0) → host ready
 *   Non-host:  connect → server sends server_connected(clientId) →
 *              client sends join_request → server sends welcome(slotN) or join_rejected
 *
 * Env vars:
 *   LAN_PORT  – listening port (default 8787)
 */

import { WebSocketServer, WebSocket } from 'ws';
import type {
  LobbySlot,
  LobbyState,
  ClientMessage,
  MsgServerConnected,
  MsgWelcome,
  MsgLobbyUpdate,
  MsgJoinRejected,
  MsgKicked,
  MsgMatchStart,
  MsgRelayedSnapshot,
  MsgRelayedInput,
  MsgMatchEnd,
  MsgChat,
  MsgPong,
  AIDifficulty,
  SlotType,
} from '../src/lan/protocol.js';
import { createLanDiscovery } from './lanDiscovery.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.LAN_PORT ?? '8787', 10);
const MAX_SLOTS = 8;
/** Heartbeat: if a client has not sent any message for this many ms, close it. */
const CLIENT_TIMEOUT_MS = 60_000;
/**
 * Maximum buffered bytes before we skip sending a snapshot to a lagging client.
 * 128 KB gives roughly 2–3 large snapshots worth of buffer before dropping.
 * Higher values allow more queuing but increase per-client memory and latency;
 * lower values drop snapshots more aggressively at the cost of visual stuttering.
 */
const BACKPRESSURE_LIMIT = 128 * 1024; // 128 KB

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  slotIndex: number | null;
  playerName: string;
  isHost: boolean;
  /** Timestamp (ms) of the last message received from this client. */
  lastMessageAt: number;
}

let nextClientNum = 1;
function newClientId(): string {
  return `client_${(nextClientNum++).toString(36)}`;
}

const clients = new Map<string, ConnectedClient>();

let lobbySlots: LobbySlot[] = initSlots();
let hostClientId: string | null = null;
let matchStarted = false;
let matchSeed = 0;
const lobbyId = `lobby_${Math.random().toString(36).slice(2, 10)}`;

function initSlots(): LobbySlot[] {
  const slots: LobbySlot[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    slots.push({ slotIndex: i, type: 'open', ready: false });
  }
  return slots;
}

function getLobbyState(): LobbyState {
  return {
    slots: lobbySlots.map(s => ({ ...s })),
    hostClientId: hostClientId ?? '',
    matchStarted,
  };
}

// ---------------------------------------------------------------------------
// Helpers: send typed messages
// ---------------------------------------------------------------------------

function send<T extends object>(ws: WebSocket, msg: T): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Send a message to a client, but check backpressure first.
 * Returns false and skips the send if the client is lagging.
 */
function sendWithBackpressure<T extends object>(ws: WebSocket, msg: T): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
    // Client cannot keep up — skip this message to avoid queue growth.
    return false;
  }
  ws.send(JSON.stringify(msg));
  return true;
}

function broadcast<T extends object>(msg: T, excludeId?: string): void {
  for (const [id, client] of clients) {
    if (id !== excludeId) send(client.ws, msg);
  }
}

function broadcastLobbyUpdate(): void {
  const update: MsgLobbyUpdate = { type: 'lobby_update', lobby: getLobbyState() };
  broadcast(update);
}

// ---------------------------------------------------------------------------
// Slot management
// ---------------------------------------------------------------------------

function findOpenSlot(): number | null {
  for (const slot of lobbySlots) {
    if (slot.type === 'open' && !slot.clientId) return slot.slotIndex;
  }
  return null;
}

function assignSlot(clientId: string, slotIndex: number, playerName: string): void {
  lobbySlots[slotIndex].type = 'human';
  lobbySlots[slotIndex].clientId = clientId;
  lobbySlots[slotIndex].playerName = playerName;
  lobbySlots[slotIndex].ready = false;
}

function releaseSlot(clientId: string): void {
  for (const slot of lobbySlots) {
    if (slot.clientId === clientId) {
      slot.type = 'open';
      slot.clientId = undefined;
      slot.playerName = undefined;
      slot.ready = false;
      return;
    }
  }
}

function slotIndexForClient(clientId: string): number | null {
  const slot = lobbySlots.find(s => s.clientId === clientId);
  return slot?.slotIndex ?? null;
}

// ---------------------------------------------------------------------------
// Heartbeat / timeout checker
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [clientId, client] of clients) {
    if (now - client.lastMessageAt > CLIENT_TIMEOUT_MS) {
      console.log(`[Gate88 LAN] Client ${clientId} timed out (no message for ${CLIENT_TIMEOUT_MS / 1000}s)`);
      client.ws.terminate();
      handleClientDisconnect(clientId);
    }
  }
}, 15_000);

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

console.log(`[Gate88 LAN] Server listening on ws://0.0.0.0:${PORT}`);

const lanDiscovery = createLanDiscovery({
  lanPort: PORT,
  maxSlots: MAX_SLOTS,
  lobbyId,
  getLobby: () => getLobbyState(),
  isHostActive: () => hostClientId !== null,
});
lanDiscovery.start();

wss.on('connection', (ws: WebSocket) => {
  const clientId = newClientId();
  const now = Date.now();

  // Determine if this is the first connection (host)
  const isHost = clients.size === 0;

  const client: ConnectedClient = {
    id: clientId,
    ws,
    slotIndex: null,
    playerName: isHost ? 'Host' : `Player ${clients.size + 1}`,
    isHost,
    lastMessageAt: now,
  };
  clients.set(clientId, client);

  if (matchStarted && !isHost) {
    // Late-join: reject before adding to client list.
    const reject: MsgJoinRejected = { type: 'join_rejected', reason: 'Match already in progress.' };
    send(ws, reject);
    ws.close();
    clients.delete(clientId);
    console.log(`[Gate88 LAN] Late-join rejected: ${clientId}`);
    return;
  }

  if (isHost) {
    hostClientId = clientId;
    // Slot 0 is auto-assigned to the host immediately.
    assignSlot(clientId, 0, client.playerName);
    client.slotIndex = 0;

    const welcome: MsgWelcome = {
      type: 'welcome',
      clientId,
      isHost: true,
      slotIndex: 0,
      lobby: getLobbyState(),
    };
    send(ws, welcome);
    console.log(`[Gate88 LAN] Host connected: ${clientId}`);
  } else {
    // Non-host clients receive only their clientId first.
    // They must send join_request to get a slot and a welcome.
    const sc: MsgServerConnected = { type: 'server_connected', clientId };
    send(ws, sc);
    console.log(`[Gate88 LAN] Client connected (awaiting join_request): ${clientId}`);
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------
  ws.on('message', (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignore malformed JSON
    }

    const myClient = clients.get(clientId);
    if (!myClient) return;

    // Update last-seen timestamp for heartbeat tracking.
    myClient.lastMessageAt = Date.now();

    switch (msg.type) {
      // -------------------------------------------------------------------
      // join_request – non-host clients send name and request a slot
      // -------------------------------------------------------------------
      case 'join_request': {
        if (myClient.isHost) break; // host already assigned
        if (matchStarted) {
          const reject: MsgJoinRejected = { type: 'join_rejected', reason: 'Match already in progress.' };
          send(ws, reject);
          break;
        }
        const slotIdx = findOpenSlot();
        if (slotIdx === null) {
          const reject: MsgJoinRejected = { type: 'join_rejected', reason: 'Lobby is full.' };
          send(ws, reject);
          break;
        }
        const playerName = (typeof msg.playerName === 'string'
          ? msg.playerName.trim().slice(0, 24)
          : '') || `Player ${clients.size}`;
        myClient.playerName = playerName;
        myClient.slotIndex = slotIdx;
        assignSlot(clientId, slotIdx, playerName);

        const welcome: MsgWelcome = {
          type: 'welcome',
          clientId,
          isHost: false,
          slotIndex: slotIdx,
          lobby: getLobbyState(),
        };
        send(ws, welcome);
        broadcastLobbyUpdate();
        console.log(`[Gate88 LAN] ${playerName} joined slot ${slotIdx}`);
        break;
      }

      // -------------------------------------------------------------------
      // ready_toggle – human players toggle their ready state
      // -------------------------------------------------------------------
      case 'ready_toggle': {
        const si = slotIndexForClient(clientId);
        if (si !== null && lobbySlots[si]) {
          lobbySlots[si].ready = !lobbySlots[si].ready;
          broadcastLobbyUpdate();
        }
        break;
      }

      // -------------------------------------------------------------------
      // leave – client voluntarily leaves the lobby
      // -------------------------------------------------------------------
      case 'leave': {
        handleClientDisconnect(clientId);
        ws.close();
        break;
      }

      // -------------------------------------------------------------------
      // slot_config – host only: configure a non-host slot
      // -------------------------------------------------------------------
      case 'slot_config': {
        if (!myClient.isHost || matchStarted) break;
        const { slotIndex, slotType, aiDifficulty } = msg;
        // Validate inputs.
        if (
          typeof slotIndex !== 'number' ||
          slotIndex < 1 || slotIndex >= MAX_SLOTS
        ) break; // slot 0 = host, cannot reconfigure
        const validTypes: SlotType[] = ['open', 'closed', 'ai'];
        if (!validTypes.includes(slotType)) break;
        const slot = lobbySlots[slotIndex];
        // Don't change a slot that has a live human in it without kicking first.
        if (slot.type === 'human' && slot.clientId) break;
        const validDiffs: AIDifficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
        const diff = validDiffs.includes(aiDifficulty as AIDifficulty)
          ? (aiDifficulty as AIDifficulty)
          : 'normal';
        slot.type = slotType;
        slot.aiDifficulty = slotType === 'ai' ? diff : undefined;
        slot.ready = false;
        slot.clientId = undefined;
        slot.playerName = slotType === 'ai' ? `AI (${diff})` : undefined;
        broadcastLobbyUpdate();
        break;
      }

      // -------------------------------------------------------------------
      // kick_player – host only: remove a player from their slot
      // -------------------------------------------------------------------
      case 'kick_player': {
        if (!myClient.isHost || matchStarted) break;
        const kickSlotIdx = typeof msg.slotIndex === 'number' ? msg.slotIndex : -1;
        if (kickSlotIdx < 1 || kickSlotIdx >= MAX_SLOTS) break;
        const kickSlot = lobbySlots[kickSlotIdx];
        if (!kickSlot || !kickSlot.clientId) break;
        const kickedId = kickSlot.clientId;
        const kickedClient = clients.get(kickedId);
        if (kickedClient) {
          const kicked: MsgKicked = { type: 'kicked' };
          send(kickedClient.ws, kicked);
          kickedClient.ws.close();
        }
        kickSlot.type = 'open';
        kickSlot.clientId = undefined;
        kickSlot.playerName = undefined;
        kickSlot.ready = false;
        clients.delete(kickedId);
        console.log(`[Gate88 LAN] Host kicked client ${kickedId} from slot ${kickSlotIdx}`);
        broadcastLobbyUpdate();
        break;
      }

      // -------------------------------------------------------------------
      // start_match – host initiates the game
      // -------------------------------------------------------------------
      case 'start_match': {
        if (!myClient.isHost || matchStarted) break;

        // Verify all human slots are ready (host slot auto-ready).
        const allReady = lobbySlots.every(slot => {
          if (slot.type !== 'human') return true;
          if (slot.slotIndex === 0) return true; // host is always ready
          return slot.ready;
        });

        if (!allReady) {
          const chat: MsgChat = { type: 'chat', from: 'Server', text: 'Not all players are ready.' };
          send(ws, chat);
          break;
        }

        matchStarted = true;
        matchSeed = Math.floor(Math.random() * 0x7fffffff);

        // Send personalised match_start to each client.
        for (const [, c] of clients) {
          const ms: MsgMatchStart = {
            type: 'match_start',
            lobby: getLobbyState(),
            seed: matchSeed,
            hostSlot: 0,
            mySlot: c.slotIndex ?? -1,
          };
          send(c.ws, ms);
        }
        console.log(`[Gate88 LAN] Match started (seed=${matchSeed})`);
        break;
      }

      // -------------------------------------------------------------------
      // input_snapshot – remote client sends input; relay to host
      // -------------------------------------------------------------------
      case 'input_snapshot': {
        if (myClient.isHost || !hostClientId) break;
        const hostClient = clients.get(hostClientId);
        if (!hostClient) break;
        // Validate numeric inputs.
        const dx = Math.max(-1, Math.min(1, Number(msg.dx) || 0));
        const dy = Math.max(-1, Math.min(1, Number(msg.dy) || 0));
        const relay: MsgRelayedInput = {
          type: 'relayed_input',
          fromSlot: myClient.slotIndex ?? -1,
          input: { ...msg, dx, dy },
        };
        send(hostClient.ws, relay);
        break;
      }

      // -------------------------------------------------------------------
      // game_snapshot – host sends authoritative snapshot; relay to all
      // -------------------------------------------------------------------
      case 'game_snapshot': {
        if (!myClient.isHost) break;
        // Relay to all non-host clients, with backpressure check.
        const snapshot: MsgRelayedSnapshot = { ...msg, type: 'game_snapshot' };
        for (const [cid, c] of clients) {
          if (cid !== clientId) {
            const sent = sendWithBackpressure(c.ws, snapshot);
            if (!sent && c.ws.bufferedAmount > BACKPRESSURE_LIMIT) {
              console.warn(`[Gate88 LAN] Dropping snapshot for lagging client ${cid} (buffered=${c.ws.bufferedAmount})`);
            }
          }
        }
        break;
      }

      // -------------------------------------------------------------------
      // ping – client heartbeat
      // -------------------------------------------------------------------
      case 'ping': {
        const pong: MsgPong = { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0 };
        send(ws, pong);
        break;
      }

      default:
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // Disconnect handler
  // ---------------------------------------------------------------------------
  ws.on('close', () => {
    handleClientDisconnect(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[Gate88 LAN] WS error for ${clientId}:`, err.message);
  });
});

function handleClientDisconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;

  console.log(`[Gate88 LAN] Disconnected: ${clientId} (${client.playerName}, slot ${client.slotIndex})`);
  releaseSlot(clientId);
  clients.delete(clientId);

  if (client.isHost) {
    // Host left — notify all remaining clients and close their sockets cleanly.
    const end: MsgMatchEnd = { type: 'match_end', reason: 'Host disconnected.' };
    for (const [, remaining] of clients) {
      send(remaining.ws, end);
      // Give the close message a moment to flush, then terminate.
      setTimeout(() => remaining.ws.close(), 200);
    }
    // Reset all server state.
    matchStarted = false;
    hostClientId = null;
    lobbySlots = initSlots();
    clients.clear();
    console.log('[Gate88 LAN] Host disconnected — all clients kicked, lobby reset.');
  } else {
    broadcastLobbyUpdate();
    console.log(`[Gate88 LAN] Client removed — lobby updated.`);
  }
}

process.on('SIGINT', () => {
  console.log('\n[Gate88 LAN] Shutting down.');
  lanDiscovery.stop();
  wss.close();
  process.exit(0);
});
