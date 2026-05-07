# Gate88Redux — Next Steps

---

## Online Multiplayer — PR 19 Implementation Summary

This PR (Build 019) implemented the following phases of the online multiplayer
plan described in the problem statement.

### What was completed

**Phase 1 — Transport abstraction**
- `src/net/transport.ts`: `MultiplayerTransport` interface + `NET_SNAPSHOT_HZ` / `NET_SNAPSHOT_INTERVAL` constants.
- `src/lan/lanTransport.ts`: `LanTransport` class implementing the interface by wrapping `LanClient`.
- Game code can be migrated to use `MultiplayerTransport` in a future pass without changing any transport-level code.

**Phase 2 — Versioned protocol types**
- `src/net/protocol.ts`: `NetInputSnapshot`, `NetGameSnapshot`, and all sub-types with `protocolVersion`, `seq`, timestamps, `lastProcessedInputSeqBySlot`, and `NetBuildCommand`.
- `validateInputSnapshot` and `validateGameSnapshot` helpers clamp/reject malformed messages.

**Phase 3 — Host snapshot production** *(pre-existing, confirmed working)*
- `broadcastLanSnapshot()` in `src/game.ts` produces snapshots at 20 Hz (`SNAPSHOT_INTERVAL = 1/20`).

**Phase 4 — Remote snapshot application with fighter/projectile reconciliation**
- `applyLanSnapshot()` now reconciles fighters by id:
  - Updates position/velocity/angle of existing fighters.
  - Creates lightweight `FighterShip`/`BomberShip` placeholders for new ids.
  - Destroys fighters absent from the snapshot.
- Projectile positions are nudged toward host state for visible projectiles.
  New projectiles are intentionally not created from snapshots (avoids
  duplicate collision/damage effects on the client).

**Phase 5 — Client-side prediction soft correction**
- When a host snapshot includes the local player's slot:
  - **Large error (>300 px)**: snap immediately to host position.
  - **Small error (4–300 px)**: accumulate a correction offset blended out
    over 0.25 s (`LAN_PREDICTION_BLEND_SECS`) without modifying physics,
    and partially blend velocity (15%) to reduce drift.
  - Health/battery are always synced from host.
- Prediction error magnitude is shown in the F3 debug overlay.

**Phase 6 — Remote input handling on host** *(pre-existing, confirmed working)*
- `applyRemoteLanInputs()` applies buffered per-slot inputs to remote ships.
- `sendLanInput()` sends local input every tick as a non-host client.

**Phase 7 — Online lobby stub**
- `docs/ONLINE_MULTIPLAYER.md`: full architecture + Supabase SQL schema + WebRTC notes.
- `.env.example`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` placeholders.
- Menu gracefully says "not configured" when env vars are absent.

**Phase 9 — Menu/HUD integration**
- "Online Multiplayer" added to the Play menu.
- New `online_multiplayer` menu state with a `drawOnlineMultiplayer()` screen.
- Escape key returns to title from the online screen.
- LAN Multiplayer and all offline modes remain unaffected.

**Phase 10 — Documentation**
- `docs/ONLINE_MULTIPLAYER.md` created.
- `REPOSITORY_GUIDE.md` updated with new files.
- `nextSteps.md` (this file) updated.

---

## What was NOT implemented (remaining work)

### Phase 7 — Full Supabase lobby integration

**Files to create/modify:**
- `src/online/supabaseLobby.ts` — Supabase client init, lobby CRUD, heartbeat.
- `src/online/onlineClient.ts` — Online transport adapter implementing `MultiplayerTransport`.
- `src/menu.ts` — Wire up `drawOnlineMultiplayer` to real lobby list/create/join flows.

**What to do:**
1. `npm install @supabase/supabase-js`
2. Initialize client from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. Create `lobbies` table (SQL in `docs/ONLINE_MULTIPLAYER.md`).
4. Host creates lobby row on "Host Online Game"; other players browse or enter room code.
5. Host sends `updated_at` heartbeat every 15 s; stale lobbies (>60 s) are cleaned up.
6. Non-host sends `join` message → host confirms → both move to signaling phase.

### Phase 8 — WebRTC DataChannel transport

**Files to create:**
- `src/online/webrtcTransport.ts` — `WebRtcTransport` implementing `MultiplayerTransport`.
- `src/online/signalingClient.ts` — Supabase-based offer/answer/ICE exchange.

**What to do:**

1. **Signaling** (via Supabase Realtime or a `signals` table):
   - Host creates an entry in `signals` table with `lobbyId`, `toSlot`, `type: 'offer'`, `sdp`.
   - Remote clients subscribe to rows addressed to them, send `answer` + ICE candidates back.
   - ICE candidates are exchanged through the same table.

2. **Peer connections** (star topology):
   - Host: `new RTCPeerConnection()` per remote client.
   - Remote: one connection to host.
   - Use `{ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }` (free STUN).
   - Document that some symmetric NATs require TURN (paid/self-hosted).

3. **DataChannels**:
   - `control`: `{ ordered: true }` — lobby messages, match start.
   - `snapshots`: `{ ordered: false, maxRetransmits: 0 }` — host game snapshots.
   - `inputs`: `{ ordered: true }` — remote client inputs.

4. **Protocol**:
   - Use `src/net/protocol.ts` types directly.
   - Serialise as JSON for the first pass; switch to MessagePack or a custom
     binary format later if bandwidth becomes a concern.

5. **`WebRtcTransport` adapter**:
   - Implement `MultiplayerTransport` using the DataChannels.
   - Host: `sendAuthoritativeSnapshot` → broadcast over `snapshots` channel.
   - Client: `sendInputSnapshot` → send over `inputs` channel.
   - Callbacks: wire `onInputSnapshot`, `onAuthoritativeSnapshot`, `onDisconnect`.

6. **Fallback**: if `RTCPeerConnection` is not available or ICE fails, show an
   error message and suggest LAN mode.

### Full prediction replay / reconciliation (Phase 5 improvement)

The current prediction correction is a soft blend. Full client-side prediction
would:

1. Store a ring buffer of the last N unacknowledged input snapshots (keyed by `seq`).
2. When a host snapshot arrives with `lastProcessedInputSeqBySlot[mySlot]`:
   - Set local ship state to host's authoritative state for our slot.
   - Reapply all unacknowledged inputs (those with `seq > lastProcessedSeq`).
3. This eliminates the remaining position error from latency-caused input lag.

**Files to modify:** `src/game.ts` — add `lanUnacknowledgedInputs: NetInputSnapshot[]`
ring buffer, update `sendLanInput` to enqueue, update `applyLanSnapshot` to replay.

### Building creation from snapshots (Phase 4 improvement)

Currently, remote clients don't create new buildings from snapshots — they only
sync health/progress of buildings they know about. This means:
- Buildings placed after match start are invisible on remote clients.
- To fix: iterate snapshot buildings and create them if their id is unknown,
  using `buildDefForEntityType` to reconstruct the building type.

**Files to modify:** `src/game.ts` — in `applyLanSnapshot`, check for unknown
building ids, call `createBuildingFromDef` to place them.

### Remote firing (Phase 6 improvement)

Remote clients currently only have their thrust applied by the host. Their firing
is not forwarded — the host does not fire weapons on behalf of remote clients.

**Options:**
1. Forward `firePrimary` / `fireSpecial` in input snapshots → host fires on behalf of remote ship.
2. Client fires locally (for responsiveness) and host validates/reconciles.

Option 1 is simpler and more host-authoritative. Extend `applyRemoteLanInputs`
to check `inp.firePrimary` and call the appropriate weapon fire logic for the
remote ship's slot.

### Disconnect recovery

If the LAN server relay crashes, all clients lose connection. Adding reconnect
logic with a short backoff would improve robustness.

---

## Manual Test Checklist

- [ ] Offline practice mode starts normally.
- [ ] VS AI mode starts normally.
- [ ] LAN host lobby: connect to local server, slot 0 auto-assigned.
- [ ] LAN client lobby: join, receive correct slot, start match.
- [ ] Host can build and fire; remote client sees entities move.
- [ ] Remote client can thrust; host sees remote ship move.
- [ ] Fighter ships appear on remote client from snapshots.
- [ ] Dead fighters are cleaned up on remote client.
- [ ] F3 debug overlay shows ping, snapshot seq, prediction error.
- [ ] Online Multiplayer menu entry opens the stub screen.
- [ ] Stub screen shows env var instructions when Supabase is not configured.
- [ ] ESC from online screen returns to title.
- [ ] Disconnecting host cleanly returns clients to main menu.
- [ ] TypeScript: `npm run typecheck` passes.
- [ ] TypeScript server: `npm run typecheck:server` passes.

---

## Files Relevant to Next Pass

| File | Relevance |
|------|-----------|
| `src/net/transport.ts` | `MultiplayerTransport` interface — entry point for any new transport |
| `src/net/protocol.ts` | `NetInputSnapshot`, `NetGameSnapshot` — versioned canonical types |
| `src/lan/lanTransport.ts` | LAN adapter for the transport interface |
| `src/lan/lanClient.ts` | Raw WebSocket client; used by `LanTransport` |
| `src/lan/protocol.ts` | LAN WebSocket message types (separate from net/protocol.ts) |
| `src/game.ts` | `applyLanSnapshot`, `broadcastLanSnapshot`, `applyRemoteLanInputs`, `sendLanInput` |
| `src/menu.ts` | `drawOnlineMultiplayer`, all LAN lobby draw functions |
| `server/lanServer.ts` | Node relay — also handles input relay and snapshot relay |
| `docs/ONLINE_MULTIPLAYER.md` | Architecture, Supabase SQL, WebRTC notes |

---

## Recommended Next Prompt

> Gate88Redux Build 019. The online multiplayer transport abstraction and LAN
> snapshot improvements are done. Now implement Phase 8: WebRTC DataChannel
> transport. Create `src/online/signalingClient.ts` (Supabase Realtime-based
> SDP/ICE exchange) and `src/online/webrtcTransport.ts` (implementing
> `MultiplayerTransport` from `src/net/transport.ts`). Use a star topology
> (host ↔ each client). Keep existing LAN working. Do not break the build.
> Document anything unfinished in `nextSteps.md`.

---

## Pre-existing Notes (Retained)

### Confluence follow-up work

- Add full save/load + LAN snapshot serialization for `factionByTeam` and `territoryCirclesByTeam` so matches restore in-progress circle growth exactly.
- Branch enemy/practice AI base planner to intentionally use confluence ring-band placement instead of conduit/planner assumptions.
- Add cached offscreen territory compositing + exterior-boundary-only arc extraction to further reduce overdraw with very high circle counts.
- Add faction selection UI in main/practice setup (currently player faction is initialized to Confluence in start flow).
- Add confluence-specific visual polish for building bases (orbital sockets/motes) and optional deterministic boundary motes.

### Synonymous ship notes

- The Synonymous player ship now uses a 50-slot deterministic circle renderer in `src/synonymousShipRenderer.ts`; full health shows 40 particles, or 50 after `synonymousVitality`, and damaged health scales down to 20 visible particles.
- Current Synonymous balance values are in `src/constants.ts`: basic laser damage 11, cooldown 56 ticks, range 760, pierce 4. `synonymousPierce` doubles pierce to 8. `synonymousFireSpeed1..4` add +25% base fire-rate per level by dividing the base cooldown by `1 + 0.25 * level`.
- `synonymousSpeed` currently applies `maxSpeed * 1.16` and `thrustPower * 1.18`; `synonymousVitality` applies `maxHealth * 1.4`, heals to full, unlocks 50 full-health particles, and adds 2.2 HP/s regeneration.
- Manual visual QA still needs an in-browser pass for the morph states: idle pentagon, Q/build circle, movement triangle, firing aperture, and damaged particle-count reduction.

### Synonymous mine layer notes

- `synonymousminelayer` is a Synonymous-only offensive turret that costs 65 nanobots, builds in 210 ticks, and maintains up to 9 drifting mines. Each mine drifts toward a 250 world-unit radius, explodes at that radius, and accelerates toward enemies inside 78 world units.
- Mine balance lives in `src/synonymousMine.ts`: 32 damage, 58 AOE radius, 6 mine HP, 23 initial drift speed, and 175 max chase speed. Mine AOE excludes same-team targets through the existing blast-damage team filter.
- Manual visual QA should confirm the 20-nanobot spinning circle reads clearly and that both friendly and hostile projectiles can detonate mines.

