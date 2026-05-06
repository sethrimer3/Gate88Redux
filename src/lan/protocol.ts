/**
 * LAN multiplayer protocol message types for Gate88Redux.
 *
 * All messages are JSON-serialised over a WebSocket connection.
 * The Node LAN server (server/lanServer.ts) acts as the relay hub.
 * The host browser client owns the authoritative GameState simulation;
 * remote clients send input and receive periodic state snapshots.
 *
 * Port: 8787 (configurable via LAN_PORT env variable).
 */

// ---------------------------------------------------------------------------
// Lobby slot model
// ---------------------------------------------------------------------------

export type SlotType = 'open' | 'human' | 'ai' | 'closed';
export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface LobbySlot {
  slotIndex: number;       // 0–7
  type: SlotType;
  playerName?: string;     // set when a human occupies it
  clientId?: string;       // ws client id that owns this slot
  ready: boolean;          // for human slots
  aiDifficulty?: AIDifficulty;
}

/** Full lobby state snapshot broadcast to all clients */
export interface LobbyState {
  slots: LobbySlot[];
  hostClientId: string;
  matchStarted: boolean;
}

// ---------------------------------------------------------------------------
// C → S messages (client → server)
// ---------------------------------------------------------------------------

export interface MsgJoinRequest {
  type: 'join_request';
  playerName: string;
}

export interface MsgReadyToggle {
  type: 'ready_toggle';
}

export interface MsgLeave {
  type: 'leave';
}

/** Host-only: reconfigure a slot */
export interface MsgSlotConfig {
  type: 'slot_config';
  slotIndex: number;
  slotType: SlotType;
  aiDifficulty?: AIDifficulty;
}

/** Host-only: kick a human from a slot */
export interface MsgKickPlayer {
  type: 'kick_player';
  slotIndex: number;
}

/** Host-only: start the match */
export interface MsgStartMatch {
  type: 'start_match';
}

/** Remote client input snapshot (sent every tick) */
export interface MsgInputSnapshot {
  type: 'input_snapshot';
  seq: number;
  dx: number;  // -1 | 0 | 1
  dy: number;  // -1 | 0 | 1
  aimX: number;
  aimY: number;
  firePrimary: boolean;
  fireSpecial: boolean;
  boost: boolean;
}

/** Host → server: authoritative game state snapshot to relay to all clients */
export interface MsgGameSnapshot {
  type: 'game_snapshot';
  seq: number;
  gameTime: number;
  ships: SerializedShip[];
  projectiles: SerializedProjectile[];
  fighters: SerializedFighter[];
  resources: number[];    // resources per slot index
  hostSlot: number;
}

export interface SerializedShip {
  slotIndex: number;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  health: number;
  maxHealth: number;
  battery: number;
  shield: number;
  alive: boolean;
}

export interface SerializedProjectile {
  id: number;
  team: number;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
}

export interface SerializedFighter {
  id: number;
  team: number;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  alive: boolean;
}

// ---------------------------------------------------------------------------
// S → C messages (server → client)
// ---------------------------------------------------------------------------

/** Server assigns this client an id and role */
export interface MsgWelcome {
  type: 'welcome';
  clientId: string;
  isHost: boolean;
  slotIndex: number;
  lobby: LobbyState;
}

/** Lobby state changed */
export interface MsgLobbyUpdate {
  type: 'lobby_update';
  lobby: LobbyState;
}

/** Join was rejected */
export interface MsgJoinRejected {
  type: 'join_rejected';
  reason: string;
}

/** You were kicked */
export interface MsgKicked {
  type: 'kicked';
}

/** Broadcast: match is starting */
export interface MsgMatchStart {
  type: 'match_start';
  lobby: LobbyState;
  seed: number;
  hostSlot: number;
  mySlot: number;
}

/** Relayed game snapshot from host */
export interface MsgRelayedSnapshot {
  type: 'game_snapshot';
  seq: number;
  gameTime: number;
  ships: SerializedShip[];
  projectiles: SerializedProjectile[];
  fighters: SerializedFighter[];
  resources: number[];
  hostSlot: number;
}

/** Relayed input from a remote player (host receives this) */
export interface MsgRelayedInput {
  type: 'relayed_input';
  fromSlot: number;
  input: MsgInputSnapshot;
}

/** Match ended (host disconnected or game over) */
export interface MsgMatchEnd {
  type: 'match_end';
  reason: string;
}

/** Chat / system text message */
export interface MsgChat {
  type: 'chat';
  from: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Union type helpers
// ---------------------------------------------------------------------------

export type ClientMessage =
  | MsgJoinRequest
  | MsgReadyToggle
  | MsgLeave
  | MsgSlotConfig
  | MsgKickPlayer
  | MsgStartMatch
  | MsgInputSnapshot
  | MsgGameSnapshot;

export type ServerMessage =
  | MsgWelcome
  | MsgLobbyUpdate
  | MsgJoinRejected
  | MsgKicked
  | MsgMatchStart
  | MsgRelayedSnapshot
  | MsgRelayedInput
  | MsgMatchEnd
  | MsgChat;

export const DEFAULT_LAN_PORT = 8787;
