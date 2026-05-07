/**
 * Online lobby management via Supabase REST.
 *
 * Lobbies table schema (SQL in docs/ONLINE_MULTIPLAYER.md):
 *   id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
 *   room_code   text NOT NULL UNIQUE
 *   host_name   text NOT NULL
 *   player_count int NOT NULL DEFAULT 1
 *   max_players  int NOT NULL DEFAULT 6
 *   match_started bool NOT NULL DEFAULT false
 *   created_at  timestamptz NOT NULL DEFAULT now()
 *   updated_at  timestamptz NOT NULL DEFAULT now()
 */

import type { SupabaseRestClient } from './supabaseClient.js';

export interface OnlineLobbyRow {
  id: string;
  room_code: string;
  host_name: string;
  player_count: number;
  max_players: number;
  match_started: boolean;
  created_at: string;
  updated_at: string;
}

/** Generate a 6-character alphanumeric room code (no ambiguous chars). */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Maximum age (ms) for stale lobbies to display. */
const STALE_LOBBY_AGE_MS = 90_000;

export class OnlineLobbyManager {
  constructor(private readonly client: SupabaseRestClient) {}

  /** Host: create a new lobby row and return it. */
  async createLobby(hostName: string, maxPlayers = 6): Promise<OnlineLobbyRow> {
    return this.client.insert<OnlineLobbyRow>('lobbies', {
      room_code: generateRoomCode(),
      host_name: hostName.trim().slice(0, 32) || 'Host',
      player_count: 1,
      max_players: maxPlayers,
      match_started: false,
    });
  }

  /**
   * List open lobbies (not yet started, updated in the last STALE_LOBBY_AGE_MS).
   * Sorted newest-first.
   */
  async listLobbies(): Promise<OnlineLobbyRow[]> {
    const cutoff = new Date(Date.now() - STALE_LOBBY_AGE_MS).toISOString();
    return this.client.select<OnlineLobbyRow>(
      'lobbies',
      `match_started=eq.false&updated_at=gt.${cutoff}&order=created_at.desc&limit=20`,
    );
  }

  /** Look up a lobby by its 6-character room code. Returns null if not found. */
  async getLobbyByCode(code: string): Promise<OnlineLobbyRow | null> {
    const rows = await this.client.select<OnlineLobbyRow>(
      'lobbies',
      `room_code=eq.${code.trim().toUpperCase()}`,
    );
    return rows[0] ?? null;
  }

  /** Increment the player count when a new player joins. */
  async incrementPlayerCount(id: string): Promise<void> {
    const rows = await this.client.select<OnlineLobbyRow>('lobbies', `id=eq.${id}`);
    const current = rows[0]?.player_count ?? 1;
    await this.client.update('lobbies', `id=eq.${id}`, {
      player_count: current + 1,
      updated_at: new Date().toISOString(),
    });
  }

  /** Host heartbeat — update `updated_at` to prevent stale-lobby cleanup. */
  async heartbeat(id: string): Promise<void> {
    await this.client.update('lobbies', `id=eq.${id}`, {
      updated_at: new Date().toISOString(),
    });
  }

  /** Mark the match as started so it no longer appears in the lobby list. */
  async markStarted(id: string): Promise<void> {
    await this.client.update('lobbies', `id=eq.${id}`, {
      match_started: true,
      updated_at: new Date().toISOString(),
    });
  }

  /** Host: delete the lobby row (called on disconnect or game over). */
  async deleteLobby(id: string): Promise<void> {
    await this.client.delete('lobbies', `id=eq.${id}`);
  }
}
