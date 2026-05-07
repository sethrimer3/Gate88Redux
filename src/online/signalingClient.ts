/**
 * WebRTC signaling client for Gate88Redux online multiplayer.
 *
 * Uses the Supabase REST API to exchange SDP offers/answers and ICE candidates
 * between peers.  Signaling is done by polling a `signals` table every
 * POLL_INTERVAL_MS milliseconds (no WebSocket/Realtime subscription needed).
 *
 * Signals table schema (SQL in docs/ONLINE_MULTIPLAYER.md):
 *   id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
 *   lobby_id   text NOT NULL
 *   from_slot  int  NOT NULL
 *   to_slot    int  NOT NULL   -- -1 = broadcast to all slots
 *   type       text NOT NULL   -- 'want_connect'|'offer'|'answer'|'ice'|'match_start'
 *   payload    jsonb NOT NULL
 *   created_at timestamptz NOT NULL DEFAULT now()
 *
 * Row-level security: all authenticated (anon key) users can insert/select
 * signals for the same lobby_id.  Rows are cleaned up on disconnect.
 */

import type { SupabaseRestClient } from './supabaseClient.js';

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
  /** Destination slot index, or -1 for broadcast. */
  to_slot: number;
  type: SignalType;
  payload: unknown;
  created_at: string;
}

/** Polling interval for new signals (ms). */
const POLL_INTERVAL_MS = 350;

export class SignalingClient {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Set of signal row ids already processed this session. */
  private readonly seen = new Set<string>();
  /** ISO timestamp of the most recently seen signal (used as gt filter). */
  private sinceTime: string | null = null;

  constructor(
    private readonly client: SupabaseRestClient,
    /** Supabase lobby row id. */
    private readonly lobbyId: string,
    /** Local slot index (used to filter incoming signals and tag outgoing ones). */
    private readonly mySlot: number,
  ) {}

  /**
   * Send a signaling message to a specific slot (or -1 for broadcast).
   */
  async sendSignal(
    toSlot: number,
    type: SignalType,
    payload: unknown,
  ): Promise<void> {
    await this.client.insert<SignalRow>('signals', {
      lobby_id: this.lobbyId,
      from_slot: this.mySlot,
      to_slot: toSlot,
      type,
      payload,
    });
  }

  /**
   * Start polling for incoming signals.
   * @param onSignal Callback invoked for each new signal addressed to mySlot.
   */
  startPolling(onSignal: (signal: SignalRow) => void): void {
    // Capture a tight time baseline so we don't replay old signals from
    // before this session connected.
    this.sinceTime = new Date().toISOString();
    this.pollTimer = setInterval(() => {
      this.poll(onSignal).catch((e) =>
        console.warn('[SignalingClient] poll error:', e),
      );
    }, POLL_INTERVAL_MS);
  }

  /** Stop polling — should be called when the connection is established or on cleanup. */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(onSignal: (signal: SignalRow) => void): Promise<void> {
    const filters: string[] = [
      `lobby_id=eq.${this.lobbyId}`,
      // Receive signals sent directly to us or broadcast to all (-1).
      `to_slot=in.(${this.mySlot},-1)`,
    ];
    if (this.sinceTime) {
      filters.push(`created_at=gt.${encodeURIComponent(this.sinceTime)}`);
    }

    const rows = await this.client.select<SignalRow>(
      'signals',
      filters.join('&') + '&order=created_at.asc',
    );

    for (const row of rows) {
      if (this.seen.has(row.id)) continue;
      this.seen.add(row.id);

      // Never process our own signals.
      if (row.from_slot === this.mySlot) continue;

      // Advance time cursor.
      if (!this.sinceTime || row.created_at > this.sinceTime) {
        this.sinceTime = row.created_at;
      }

      onSignal(row);
    }
  }

  /**
   * Remove all signals for this lobby from the signals table.
   * Called when the host ends the game or all peers have connected.
   */
  async cleanup(): Promise<void> {
    this.stopPolling();
    try {
      await this.client.delete('signals', `lobby_id=eq.${this.lobbyId}`);
    } catch (e) {
      console.warn('[SignalingClient] cleanup error:', e);
    }
  }
}
