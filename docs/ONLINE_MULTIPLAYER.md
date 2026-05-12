# Gate88Redux Online Multiplayer

This document covers the setup and current implementation shape for online
multiplayer in Gate88Redux.

## Architecture

Gate88Redux uses a host-authoritative snapshot model for multiplayer. The host
browser owns the simulation. Remote clients send input snapshots and receive
authoritative game snapshots.

Supabase is used only for low-frequency setup traffic:

- lobby discovery
- lobby heartbeat and stale-lobby cleanup
- WebRTC signaling: `want_connect`, `offer`, `answer`, `ice`, optional fallback `match_start`

Supabase is not used for high-frequency gameplay traffic. Gameplay snapshots
and player inputs must go through WebRTC DataChannels.

## Current Status

| Area | Status |
|------|--------|
| LAN multiplayer | Working through the local WebSocket relay |
| Online lobby rows | Implemented through Supabase |
| WebRTC signaling rows | Implemented through Supabase polling |
| Gameplay transport | WebRTC DataChannel implementation exists, still beta |
| TURN support | Not bundled |

## Supabase Setup

1. Create a Supabase project.
2. In the Supabase dashboard, enable Anonymous Sign-Ins under Authentication.
3. Open the SQL editor and run [`supabase/schema.sql`](../supabase/schema.sql).
4. Create `.env.local` at the repo root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Do not commit `.env.local`. Do not expose or add a `service_role` key to any
frontend environment file. The browser uses only the public anon key, then signs
in with Supabase Auth anonymous sessions so RLS policies see the user as
`authenticated`.

## SQL Schema

The real schema lives in [`supabase/schema.sql`](../supabase/schema.sql). It
creates:

- `lobbies`
- `lobby_participants`
- `signals`
- indexes for lobby listing, room-code lookup, signal polling, and cleanup
- check constraints for room codes, slot ranges, player counts, signal types,
  and payload size
- RLS policies for anonymous Auth users
- `join_lobby_by_code(p_room_code text)` for atomic joins that return both
  the lobby row and the caller's assigned slot
- private cleanup functions for stale lobbies and old signals, plus public
  admin/manual wrappers that are not granted to browser anonymous users

Do not use the old embedded sample schema from earlier revisions; it created
only `lobbies` and did not match the TypeScript signaling client.

## Cleanup

Cleanup functions do not run automatically just because they exist.

For manual testing, run:

```sql
select private.clean_stale_lobbies();
select private.clean_old_signals();
```

Cleanup functions do not run automatically and are not executable by anonymous
browser players. For a public prototype, call those functions from a trusted
scheduled job, or use `pg_cron` if your Supabase project supports it. Example
schedule:

```sql
select cron.schedule(
  'gate88-clean-stale-lobbies',
  '* * * * *',
  $$select private.clean_stale_lobbies();$$
);

select cron.schedule(
  'gate88-clean-old-signals',
  '* * * * *',
  $$select private.clean_old_signals();$$
);
```

Enable `pg_cron` only if it is available for the project. Otherwise use manual
SQL calls during testing or an external scheduled job.

## Client Behavior

`src/online/supabaseClient.ts` initializes `@supabase/supabase-js` from:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Before lobby or signaling writes, the client calls `signInAnonymously()` if no
session exists. RLS policies target `authenticated`, not unauthenticated anon
requests.

`OnlineLobbyManager.joinLobbyByCode()` uses the `join_lobby_by_code` RPC rather
than allowing joiners to update `player_count` directly. The RPC returns:

- `lobby`: the current lobby row
- `assigned_slot`: the exact slot inserted in `lobby_participants`

The joiner passes that assigned slot into `SignalingClient` and
`WebRtcTransport`. The client must not infer its slot from `player_count`.
Hosts can heartbeat, mark started, and delete only their own lobby rows.

`SignalingClient` inserts and polls rows in `signals`. Signal traffic is
intended only for WebRTC setup, not gameplay state.

## Connection Readiness

`want_connect` means only that a browser wants an offer. It does not mean the
peer is playable. The online host lobby tracks:

- requested/signaling seen
- offer sent
- answer received
- ICE connected
- control channel open
- inputs channel open
- snapshots channel open

The host Start Match button enables only after at least one remote slot has all
three WebRTC DataChannels open. The lobby screen shows concise status lines so
testers can see whether the flow stopped at Supabase auth, slot assignment,
signaling, ICE, channel open, or match start.

## Match Start

The host creates one authoritative `MsgMatchStart`, stores it locally, and sends
`{ type: 'match_start', matchStart }` over the reliable ordered `control`
DataChannel. Joined clients parse that control message, store their own pending
match start with their assigned slot, and transition into `start_online_client`.

A broadcast Supabase `match_start` signal may also be sent as a fallback for
clients still polling, but gameplay inputs and snapshots remain on WebRTC
DataChannels only.

## Failure Messages

The online menu should show useful errors for:

- missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`
- Anonymous Sign-Ins disabled in Supabase Auth
- missing schema or stale schema cache
- RLS policy failures
- network/API failures

LAN and offline modes do not require Supabase configuration.

## TURN / NAT

The WebRTC transport uses public STUN servers. Some NATs require a TURN server
for reliable peer-to-peer connections. `src/online/webrtcTransport.ts` has an
`ICE_SERVERS` TODO hook for adding project-owned TURN servers later. Do not
hardcode paid or private TURN credentials in committed browser code.

## Testing Checklist

- [ ] `npm install`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Supabase Anonymous Sign-Ins enabled
- [ ] `supabase/schema.sql` runs in the Supabase SQL editor
- [ ] `.env.local` contains only URL and anon key
- [ ] Online screen shows a useful missing-config message with no env vars
- [ ] Host can create a lobby and see a room code
- [ ] Joiner can join by room code through `join_lobby_by_code`
- [ ] Joiner sees its assigned slot from the RPC result
- [ ] Host sees the requested remote slot
- [ ] `signals` rows are created for `want_connect`, offer/answer/ICE, and optional match start
- [ ] WebRTC control, inputs, and snapshots channels open
- [ ] Host Start Match enables only after the channels are open
- [ ] Host starts the match
- [ ] Client receives match start and enters the match
- [ ] Host receives client input snapshots over WebRTC
- [ ] Client receives authoritative snapshots over WebRTC
- [ ] `select private.clean_stale_lobbies();` removes old unstarted lobbies when run by an admin/scheduled job
- [ ] `select private.clean_old_signals();` removes old signaling rows when run by an admin/scheduled job
- [ ] Offline single-player still starts
- [ ] Vs AI still starts
- [ ] LAN hosting and joining still work

## Implementation Summary

- Added a dedicated Supabase setup file at `supabase/schema.sql`.
- Added anonymous Supabase Auth sign-in through `@supabase/supabase-js`.
- Aligned lobby and signal RLS with authenticated anonymous users.
- Replaced direct joiner-side `player_count` updates with an atomic RPC that
  returns the assigned participant slot.
- Gated online match start on real WebRTC DataChannel readiness.
- Sent match start over the reliable WebRTC control channel.
- Kept Supabase scoped to lobby discovery, heartbeat, cleanup, and signaling.

Remaining limitations: online multiplayer is still prototype-grade, TURN is not
configured, and cleanup must be scheduled or called manually by trusted code.
