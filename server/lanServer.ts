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
 * Env vars:
 *   LAN_PORT  – listening port (default 8787)
 */

import { WebSocketServer, WebSocket } from 'ws';
import type {
  LobbySlot,
  LobbyState,
  ClientMessage,
  MsgWelcome,
  MsgLobbyUpdate,
  MsgJoinRejected,
  MsgKicked,
  MsgMatchStart,
  MsgRelayedSnapshot,
  MsgRelayedInput,
  MsgMatchEnd,
  MsgChat,
  AIDifficulty,
} from '../src/lan/protocol.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.LAN_PORT ?? '8787', 10);
const MAX_SLOTS = 8;

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  slotIndex: number | null;
  playerName: string;
  isHost: boolean;
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
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

console.log(`[Gate88 LAN] Server listening on ws://0.0.0.0:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  const clientId = newClientId();

  // Determine if this is the first connection (host)
  const isHost = clients.size === 0;

  const client: ConnectedClient = {
    id: clientId,
    ws,
    slotIndex: null,
    playerName: isHost ? 'Host' : `Player ${clients.size + 1}`,
    isHost,
  };
  clients.set(clientId, client);

  if (isHost) {
    hostClientId = clientId;
    // Slot 0 is auto-assigned to the host
    assignSlot(clientId, 0, client.playerName);
    client.slotIndex = 0;
    // Make remaining slots open by default for host config
  }

  console.log(`[Gate88 LAN] ${isHost ? 'Host' : 'Client'} connected: ${clientId}`);

  if (matchStarted && !isHost) {
    // Late-join: reject for now
    const reject: MsgJoinRejected = { type: 'join_rejected', reason: 'Match already in progress.' };
    send(ws, reject);
    ws.close();
    clients.delete(clientId);
    return;
  }

  // Send welcome
  const welcome: MsgWelcome = {
    type: 'welcome',
    clientId,
    isHost,
    slotIndex: client.slotIndex ?? -1,
    lobby: getLobbyState(),
  };
  send(ws, welcome);

  if (!isHost) {
    // Broadcast updated lobby to everyone
    broadcastLobbyUpdate();
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------
  ws.on('message', (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    const myClient = clients.get(clientId);
    if (!myClient) return;

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
        const playerName = msg.playerName?.trim().slice(0, 24) || `Player ${clients.size}`;
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
        if (slotIndex < 1 || slotIndex >= MAX_SLOTS) break; // slot 0 = host
        const slot = lobbySlots[slotIndex];
        // Don't change slot that has a human in it without kicking first
        if (slot.type === 'human' && slot.clientId) break;
        slot.type = slotType;
        slot.aiDifficulty = aiDifficulty as AIDifficulty | undefined;
        slot.ready = false;
        slot.clientId = undefined;
        slot.playerName = slotType === 'ai' ? `AI (${aiDifficulty ?? 'normal'})` : undefined;
        broadcastLobbyUpdate();
        break;
      }

      // -------------------------------------------------------------------
      // kick_player – host only: remove a player from their slot
      // -------------------------------------------------------------------
      case 'kick_player': {
        if (!myClient.isHost || matchStarted) break;
        const kickSlot = lobbySlots[msg.slotIndex];
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
        broadcastLobbyUpdate();
        break;
      }

      // -------------------------------------------------------------------
      // start_match – host initiates the game
      // -------------------------------------------------------------------
      case 'start_match': {
        if (!myClient.isHost || matchStarted) break;

        // Verify all human slots are ready (host slot auto-ready)
        const allReady = lobbySlots.every(slot => {
          if (slot.type !== 'human') return true;
          if (slot.slotIndex === 0) return true; // host is always ready
          return slot.ready;
        });

        if (!allReady) {
          // Only inform host; don't block
          send(ws, { type: 'chat', from: 'Server', text: 'Not all players are ready.' } as MsgChat);
          break;
        }

        matchStarted = true;
        matchSeed = Math.floor(Math.random() * 0x7fffffff);

        // Send personalised match_start to each client
        for (const [cid, c] of clients) {
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
        const relay: MsgRelayedInput = {
          type: 'relayed_input',
          fromSlot: myClient.slotIndex ?? -1,
          input: msg,
        };
        send(hostClient.ws, relay);
        break;
      }

      // -------------------------------------------------------------------
      // game_snapshot – host sends authoritative snapshot; relay to all
      // -------------------------------------------------------------------
      case 'game_snapshot': {
        if (!myClient.isHost) break;
        const snapshot: MsgRelayedSnapshot = { ...msg, type: 'game_snapshot' };
        broadcast(snapshot, clientId);
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

  console.log(`[Gate88 LAN] Disconnected: ${clientId} (slot ${client.slotIndex})`);
  releaseSlot(clientId);
  clients.delete(clientId);

  if (client.isHost) {
    // Host left — end match, notify everyone
    const end: MsgMatchEnd = { type: 'match_end', reason: 'Host disconnected.' };
    broadcast(end);
    // Reset server state
    matchStarted = false;
    hostClientId = null;
    lobbySlots = initSlots();
    clients.clear();
    console.log('[Gate88 LAN] Host disconnected — lobby reset.');
  } else {
    broadcastLobbyUpdate();
  }
}

process.on('SIGINT', () => {
  console.log('\n[Gate88 LAN] Shutting down.');
  wss.close();
  process.exit(0);
});
