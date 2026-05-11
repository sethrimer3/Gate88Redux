import type { SupabaseOnlineClient } from './supabaseClient.js';
import { ensureAnonymousSession } from './supabaseClient.js';

export interface OnlineLobbyRow {
  id: string;
  room_code: string;
  host_name: string;
  host_user_id: string;
  host_slot: number;
  player_count: number;
  max_players: number;
  match_started: boolean;
  locked: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const STALE_LOBBY_AGE_MS = 90_000;

export class OnlineLobbyManager {
  constructor(private readonly client: SupabaseOnlineClient) {}

  async createLobby(hostName: string, maxPlayers = 6): Promise<OnlineLobbyRow> {
    await ensureAnonymousSession(this.client);
    const { data, error } = await this.client
      .from('lobbies')
      .insert({
        room_code: generateRoomCode(),
        host_name: hostName.trim().slice(0, 32) || 'Host',
        player_count: 1,
        max_players: Math.max(1, Math.min(8, Math.floor(maxPlayers))),
        match_started: false,
      })
      .select()
      .single();
    if (error) throw new Error(`Supabase create lobby failed: ${error.message}`);
    return data;
  }

  async listLobbies(): Promise<OnlineLobbyRow[]> {
    await ensureAnonymousSession(this.client);
    const cutoff = new Date(Date.now() - STALE_LOBBY_AGE_MS).toISOString();
    const { data, error } = await this.client
      .from('lobbies')
      .select()
      .eq('match_started', false)
      .eq('locked', false)
      .gt('updated_at', cutoff)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(`Supabase list lobbies failed: ${error.message}`);
    return data ?? [];
  }

  async getLobbyByCode(code: string): Promise<OnlineLobbyRow | null> {
    await ensureAnonymousSession(this.client);
    const { data, error } = await this.client
      .from('lobbies')
      .select()
      .eq('room_code', code.trim().toUpperCase())
      .maybeSingle();
    if (error) throw new Error(`Supabase lobby lookup failed: ${error.message}`);
    return data;
  }

  async joinLobbyByCode(code: string): Promise<OnlineLobbyRow> {
    await ensureAnonymousSession(this.client);
    const { data, error } = await this.client.rpc('join_lobby_by_code', {
      p_room_code: code.trim().toUpperCase(),
    });
    if (error) throw new Error(`Supabase join lobby failed: ${error.message}`);
    if (!data) throw new Error('Supabase join lobby failed: no lobby returned');
    return data;
  }

  async heartbeat(id: string): Promise<void> {
    await ensureAnonymousSession(this.client);
    const { error } = await this.client
      .from('lobbies')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`Supabase lobby heartbeat failed: ${error.message}`);
  }

  async markStarted(id: string): Promise<void> {
    await ensureAnonymousSession(this.client);
    const { error } = await this.client
      .from('lobbies')
      .update({
        match_started: true,
        locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`Supabase mark started failed: ${error.message}`);
  }

  async deleteLobby(id: string): Promise<void> {
    await ensureAnonymousSession(this.client);
    const { error } = await this.client
      .from('lobbies')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Supabase delete lobby failed: ${error.message}`);
  }
}
