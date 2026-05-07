/**
 * Thin Supabase REST client using native fetch().
 *
 * No npm package is required — all communication goes through the public
 * Supabase PostgREST REST API.  Authentication uses the anon key which is
 * safe to embed in client-side code (row-level security is the guard).
 *
 * Usage:
 *   const client = new SupabaseRestClient(url, anonKey);
 *   const rows = await client.select<LobbyRow>('lobbies', 'match_started=eq.false');
 */

/** Standard Supabase REST request headers. */
function makeHeaders(key: string): Record<string, string> {
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

export class SupabaseRestClient {
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  /**
   * SELECT rows from a table.
   * @param table  PostgREST table name.
   * @param filter Optional PostgREST filter string, e.g. "id=eq.abc&order=created_at.desc".
   * @param select Column list, defaults to '*'.
   */
  async select<T>(
    table: string,
    filter?: string,
    select = '*',
  ): Promise<T[]> {
    let endpoint = `${this.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    if (filter) endpoint += `&${filter}`;
    const resp = await fetch(endpoint, { headers: makeHeaders(this.key) });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Supabase SELECT ${table} ${resp.status}: ${body}`);
    }
    return resp.json() as Promise<T[]>;
  }

  /**
   * INSERT a single row and return it.
   * @param table PostgREST table name.
   * @param row   Partial row object; omit auto-generated fields like id/created_at.
   */
  async insert<T>(table: string, row: Partial<T>): Promise<T> {
    const resp = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: makeHeaders(this.key),
      body: JSON.stringify(row),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Supabase INSERT ${table} ${resp.status}: ${body}`);
    }
    const rows = await resp.json() as T[];
    if (!rows[0]) throw new Error(`Supabase INSERT ${table}: no row returned`);
    return rows[0];
  }

  /**
   * UPDATE rows matching filter.
   * @param table  PostgREST table name.
   * @param filter PostgREST filter string, e.g. "id=eq.abc".
   * @param patch  Fields to update.
   */
  async update(
    table: string,
    filter: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const resp = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: makeHeaders(this.key),
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Supabase UPDATE ${table} ${resp.status}: ${body}`);
    }
  }

  /**
   * DELETE rows matching filter.
   * @param table  PostgREST table name.
   * @param filter PostgREST filter string, e.g. "id=eq.abc".
   */
  async delete(table: string, filter: string): Promise<void> {
    const resp = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: makeHeaders(this.key),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Supabase DELETE ${table} ${resp.status}: ${body}`);
    }
  }
}

/**
 * Build a SupabaseRestClient from Vite environment variables.
 * Returns null if the required env vars are not set.
 */
export function createSupabaseClient(): SupabaseRestClient | null {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = metaEnv['VITE_SUPABASE_URL'];
  const key = metaEnv['VITE_SUPABASE_ANON_KEY'];
  if (!url || !key) return null;
  return new SupabaseRestClient(url, key);
}
