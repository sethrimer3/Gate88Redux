import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export interface SupabaseOnlineDatabase {
  public: {
    Tables: {
      lobbies: {
        Row: {
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
        };
        Insert: {
          room_code: string;
          host_name: string;
          host_slot?: number;
          player_count?: number;
          max_players?: number;
          match_started?: boolean;
          locked?: boolean;
          expires_at?: string | null;
        };
        Update: {
          room_code?: string;
          host_name?: string;
          host_user_id?: string;
          host_slot?: number;
          player_count?: number;
          max_players?: number;
          match_started?: boolean;
          locked?: boolean;
          expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      signals: {
        Row: {
          id: string;
          lobby_id: string;
          from_slot: number;
          to_slot: number;
          type: 'want_connect' | 'offer' | 'answer' | 'ice' | 'match_start';
          payload: unknown;
          created_at: string;
        };
        Insert: {
          lobby_id: string;
          from_slot: number;
          to_slot: number;
          type: 'want_connect' | 'offer' | 'answer' | 'ice' | 'match_start';
          payload: unknown;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'signals_lobby_id_fkey';
            columns: ['lobby_id'];
            referencedRelation: 'lobbies';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      join_lobby_by_code: {
        Args: { p_room_code: string };
        Returns: SupabaseOnlineDatabase['public']['Tables']['lobbies']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type SupabaseOnlineClient = SupabaseClient<SupabaseOnlineDatabase>;

let sharedClient: SupabaseOnlineClient | null = null;
let sessionPromise: Promise<User> | null = null;

function onlineEnv(): { url?: string; anonKey?: string } {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    url: metaEnv['VITE_SUPABASE_URL'],
    anonKey: metaEnv['VITE_SUPABASE_ANON_KEY'],
  };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = onlineEnv();
  return Boolean(url && anonKey);
}

export function createSupabaseOnlineClient(): SupabaseOnlineClient | null {
  const { url, anonKey } = onlineEnv();
  if (!url || !anonKey) return null;
  return createClient<SupabaseOnlineDatabase>(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabaseOnlineClient(): SupabaseOnlineClient | null {
  if (!sharedClient) {
    sharedClient = createSupabaseOnlineClient();
  }
  return sharedClient;
}

export async function ensureAnonymousSession(client = getSupabaseOnlineClient()): Promise<User> {
  if (!client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.');
  }

  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) {
        throw new Error(`Supabase Auth session check failed: ${sessionError.message}`);
      }
      if (sessionData.session?.user) return sessionData.session.user;

      const { data, error } = await client.auth.signInAnonymously();
      if (error) {
        throw new Error(
          `Supabase anonymous sign-in failed: ${error.message}. Enable Anonymous Sign-Ins in the Supabase dashboard.`,
        );
      }
      if (!data.user) {
        throw new Error('Supabase anonymous sign-in succeeded but did not return a user session.');
      }
      return data.user;
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }

  return sessionPromise;
}

export function describeSupabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('VITE_SUPABASE')) return message;
  if (message.toLowerCase().includes('anonymous')) return message;
  if (message.includes('relation') || message.includes('schema cache')) {
    return 'Supabase schema is missing or out of date. Run supabase/schema.sql in the Supabase SQL editor.';
  }
  if (message.includes('row-level security') || message.includes('permission denied') || message.includes('violates row-level security')) {
    return 'Supabase RLS blocked the request. Confirm Anonymous Auth is enabled and supabase/schema.sql policies were applied.';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Supabase network request failed. Check the project URL, anon key, and network connection.';
  }
  return message;
}

/** Backwards-compatible name for existing menu call sites. */
export const createSupabaseClient = getSupabaseOnlineClient;
