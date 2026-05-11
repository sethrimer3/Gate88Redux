import type { SupabaseOnlineClient } from './supabaseClient.js';
import { ensureAnonymousSession } from './supabaseClient.js';

export type SignalType =
  | 'want_connect'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'match_start';

export interface SignalRow {
  id: string;
  lobby_id: string;
  from_slot: number;
  to_slot: number;
  type: SignalType;
  payload: unknown;
  created_at: string;
}

const POLL_INTERVAL_MS = 350;

export class SignalingClient {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly seen = new Set<string>();
  private sinceTime: string | null = null;

  constructor(
    private readonly client: SupabaseOnlineClient,
    private readonly lobbyId: string,
    private readonly mySlot: number,
  ) {}

  async sendSignal(
    toSlot: number,
    type: SignalType,
    payload: unknown,
  ): Promise<void> {
    await ensureAnonymousSession(this.client);
    const { error } = await this.client
      .from('signals')
      .insert({
        lobby_id: this.lobbyId,
        from_slot: this.mySlot,
        to_slot: toSlot,
        type,
        payload,
      });
    if (error) throw new Error(`Supabase send signal failed: ${error.message}`);
  }

  startPolling(onSignal: (signal: SignalRow) => void): void {
    this.sinceTime = new Date().toISOString();
    this.pollTimer = setInterval(() => {
      this.poll(onSignal).catch((e) =>
        console.warn('[SignalingClient] poll error:', e),
      );
    }, POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(onSignal: (signal: SignalRow) => void): Promise<void> {
    await ensureAnonymousSession(this.client);
    let query = this.client
      .from('signals')
      .select()
      .eq('lobby_id', this.lobbyId)
      .in('to_slot', [this.mySlot, -1])
      .order('created_at', { ascending: true });

    if (this.sinceTime) {
      query = query.gt('created_at', this.sinceTime);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase poll signals failed: ${error.message}`);

    for (const row of data ?? []) {
      if (this.seen.has(row.id)) continue;
      this.seen.add(row.id);

      if (row.from_slot === this.mySlot) continue;

      if (!this.sinceTime || row.created_at > this.sinceTime) {
        this.sinceTime = row.created_at;
      }

      onSignal(row);
    }
  }

  async cleanup(): Promise<void> {
    this.stopPolling();
    try {
      await ensureAnonymousSession(this.client);
      const { error } = await this.client
        .from('signals')
        .delete()
        .eq('lobby_id', this.lobbyId);
      if (error) throw new Error(error.message);
    } catch (e) {
      console.warn('[SignalingClient] cleanup error:', e);
    }
  }
}
