/**
 * Sign99RTS — Transport-neutral player identity.
 *
 * Gameplay/lobby code must never depend on Steam-specific ID types. A
 * `PlayerIdentity` is the canonical representation of "who a player is" across
 * every backend (Steam, Supabase/WebRTC, LAN).
 *
 *   - `id`   : opaque, stable, unique string. For Steam this is the SteamID64;
 *              for Supabase it is the anonymous user id; for LAN it is the
 *              ws client id. Treat it as an opaque token — never parse it.
 *   - `name` : display name for UI only. NOT unique, NOT stable, never used as
 *              a key. May be empty if the backend has not resolved it yet.
 *   - `kind` : which backend minted the id (useful for diagnostics/telemetry).
 *
 * A player's *slot* (0–7) is a per-match lobby concept and lives in the lobby
 * layer, not here — the same person keeps their `PlayerIdentity` across
 * matches but can be assigned a different slot each time.
 */

export type PlayerIdKind = 'steam' | 'supabase' | 'lan' | 'local';

export interface PlayerIdentity {
  readonly id: string;
  readonly name: string;
  readonly kind: PlayerIdKind;
}

/** Build a `PlayerIdentity`, trimming/clamping the display name for UI safety. */
export function makePlayerIdentity(
  id: string,
  name: string,
  kind: PlayerIdKind,
): PlayerIdentity {
  return {
    id: String(id),
    name: (name ?? '').trim().slice(0, 32),
    kind,
  };
}

/** Identity equality is by `id` only — display names are never compared. */
export function samePlayer(a: PlayerIdentity, b: PlayerIdentity): boolean {
  return a.id === b.id;
}

/** A safe, non-empty label for UI when the backend name is missing. */
export function displayName(p: PlayerIdentity, fallback = 'Player'): string {
  return p.name.length > 0 ? p.name : fallback;
}
