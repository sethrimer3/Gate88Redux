# Gate88Redux — Online Multiplayer

This document covers the architecture, setup, and current status of online
multiplayer in Gate88Redux.

## Architecture Overview

Gate88Redux uses a **host-authoritative snapshot model** for all multiplayer
modes (LAN and future online).

```
Host Browser (authoritative simulation)
    │
    │  NetGameSnapshot (at NET_SNAPSHOT_HZ = 20 Hz)
    ▼
Transport Layer (LAN WebSocket relay or future WebRTC DataChannels)
    │
    │  NetInputSnapshot (every tick, ~60 Hz)
    ▼
Remote Client Browser (receives snapshots, sends inputs)
```

### Key properties

- **Host browser owns the truth.** All damage, projectile creation, resource
  changes, building placement, and win/loss decisions happen on the host.
- **Remote clients are display terminals.** They interpolate entity positions
  between snapshots and locally predict their own ship for responsive controls.
- **Client-side prediction** for the local player ship: inputs are applied
  locally immediately, then a soft correction blends the ship toward the host's
  authoritative position when a snapshot arrives.
- **Entity reconciliation**: fighters and projectiles are reconciled by id
  against each snapshot. Unknown entities are created as lightweight
  placeholders; removed entities are destroyed.
- **No lockstep.** The game does not require deterministic simulation. The host
  is always authoritative over game outcomes.

## Phase Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Transport abstraction (`src/net/transport.ts`, `src/lan/lanTransport.ts`) | ✅ Done |
| 2 | Versioned protocol types (`src/net/protocol.ts`) | ✅ Done |
| 3 | Host snapshot production at 20 Hz (`broadcastLanSnapshot`) | ✅ Done (pre-existing) |
| 4 | Snapshot application with fighter/projectile reconciliation | ✅ Done |
| 5 | Client-side prediction with soft correction | ✅ Done |
| 6 | Remote input handling on host | ✅ Done (pre-existing) |
| 7 | Online lobby with Supabase | 🔲 Stub only (see below) |
| 8 | WebRTC DataChannel transport | 🔲 Not implemented (see nextSteps.md) |
| 9 | Menu/HUD integration | ✅ Online Multiplayer entry added (stub) |
| 10 | Documentation | ✅ This file |

## LAN Multiplayer (Fully Working)

LAN multiplayer is the primary working multiplayer mode. It uses a Node.js
WebSocket relay server running on the host machine.

See [LAN.md](LAN.md) for setup instructions.

## Online Multiplayer (Stub / Not Yet Functional)

Online multiplayer is accessible from **Play → Online Multiplayer** in the
main menu. Currently it shows a configuration message if Supabase environment
variables are not set.

### Supabase Setup (Lobby / Signaling)

Supabase is intended for:
- Online lobby list (host creates a record, joiners browse or enter room code)
- Host heartbeat and stale lobby cleanup
- WebRTC signaling (offer/answer/ICE candidates)

**Supabase is NOT suitable for high-frequency gameplay relay** (20–60 msg/s
per client). WebRTC DataChannels should be used for gameplay traffic.

#### Environment Variables

Add these to your `.env.local` (never commit them):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

See `.env.example` for the template.

#### Recommended Supabase Schema

```sql
-- Lobbies table for online matchmaking
create table if not exists lobbies (
  id           uuid primary key default gen_random_uuid(),
  room_code    text unique not null,
  host_name    text not null,
  player_count int not null default 1,
  max_players  int not null default 6,
  match_started boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Enable Row Level Security (public read, authenticated write)
alter table lobbies enable row level security;

create policy "Anyone can read lobbies"
  on lobbies for select using (true);

create policy "Authenticated users can insert"
  on lobbies for insert to authenticated with check (true);

create policy "Authenticated users can update their lobbies"
  on lobbies for update to authenticated using (true);

-- Auto-clean stale lobbies (no heartbeat for > 60 s)
create or replace function clean_stale_lobbies() returns void as $$
  delete from lobbies where updated_at < now() - interval '60 seconds';
$$ language sql;
```

#### Free Tier Warning

The Supabase Free tier is appropriate for lobby/signaling (infrequent updates).
Do **not** route high-frequency gameplay messages (inputs at 60 Hz, snapshots
at 20 Hz) through Supabase — use WebRTC DataChannels for that. See Phase 8 in
`nextSteps.md`.

## WebRTC DataChannel Transport (Not Implemented)

See `nextSteps.md` for the detailed WebRTC implementation checklist.

**Star topology** (planned):
- Host has one RTCPeerConnection to each remote client.
- Clients connect only to the host.
- `reliable ordered` channel for lobby/control messages.
- `unreliable unordered` channel for snapshots (new snapshot supersedes old).
- `reliable ordered` channel for client inputs (can tolerate small seq gaps).

**Signaling** (planned via Supabase Realtime):
- Host creates a lobby row, remote clients subscribe to that row.
- SDP offer/answer and ICE candidates exchanged through Supabase Realtime
  or a dedicated `signals` table.

## Known Limitations

- LAN mode requires all players to be on the same network or VPN.
- Remote client input only moves the ship (no firing forwarding yet; host
  controls firing for remote ships indirectly via the authoritative simulation).
- Full building sync (create new buildings from snapshots) is not yet
  implemented — clients start from the same seed layout and only sync
  health/progress.
- Prediction reconciliation is soft (blend + snap) but does not replay
  unacknowledged inputs from a correction point (full replay is in nextSteps).
- No TURN server is bundled; some NAT configurations may block WebRTC
  peer-to-peer connections without one.

## Testing Checklist

- [ ] Offline single-player still starts and plays normally.
- [ ] VS AI still starts normally.
- [ ] LAN host lobby opens and connects to local server.
- [ ] LAN client lobby joins and shows correct slot.
- [ ] Host receives remote input and applies it to the remote ship.
- [ ] Host snapshots are produced at ~20 Hz (check debug overlay with F3).
- [ ] Non-host client applies snapshots: remote ships move correctly.
- [ ] Fighter reconciliation: remote fighters appear and disappear correctly.
- [ ] Prediction correction: local ship does not rubber-band badly.
- [ ] Online Multiplayer menu entry opens the stub screen.
- [ ] Stub screen shows "not configured" message when env vars are absent.
- [ ] Disconnect does not crash the game.
- [ ] TypeScript compiles cleanly (`npm run typecheck`).
