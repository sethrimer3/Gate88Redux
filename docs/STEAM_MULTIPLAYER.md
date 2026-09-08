# Steam-native multiplayer

Sign99RTS multiplayer runs on a **transport abstraction** — the RTS simulation,
commands, slot model, and snapshot protocol never call a networking API
directly. Steam is one backend among several:

| Backend | Lobby / discovery | Gameplay transport | Where it runs |
|---|---|---|---|
| **LAN** | `server/lanServer.ts` (WS relay) + UDP discovery | `LanTransport` (WebSocket) | any build |
| **Online (browser)** | Supabase `lobbies` table | `WebRtcTransport` (DataChannels) | browser + desktop |
| **Steam** | Steam Matchmaking lobbies | `SteamTransport` (Steam P2P) | Electron desktop build only |

All three implement `MultiplayerTransport` (`src/net/transport.ts`) and hand
`game.ts` the identical `{ transport, matchStart }` bundle, so `game.ts`
`startOnlineGame()` is backend-agnostic.

---

## 1. What is implemented in this repository

### Abstraction layer (`src/multiplayer/`)
- **`identity.ts`** — `PlayerIdentity` (`{ id, name, kind }`). `id` is opaque and
  stable (SteamID64 for Steam); `name` is display-only and never used as a key.
- **`lobby/types.ts`** — backend-neutral `Lobby`, `LobbySummary`, `LobbyMember`,
  `LobbyEvent`, `LobbyMetaKeys`.
- **`lobby/LobbyProvider.ts`** — `hostLobby / listLobbies / joinLobby /
  leaveLobby / setLobbyMetadata / openInviteDialog / on / onJoinRequested`.

### Transport interface (`src/net/transport.ts`)
- Added `mode: 'steam'`, an optional **reliable control channel**
  (`sendControl` / `onControl` with `NetControlMessage`) for match-start / ready
  / chat, `onError`, and optional `localPlayer`. LAN and WebRTC are unchanged
  (the new members are optional).

### Electron native bridge (`electron/steam/`)
- **`steamChannels.cjs`** — single source of truth for IPC channel names.
- **`steamworksBridge.cjs`** — the **only** file that `require`s `steamworks.js`.
  Runs in the Electron **main** process. Handles: robust init, identity, lobby
  lifecycle + membership/owner/metadata callbacks, friend invites,
  `GameLobbyJoinRequested`, launch-arg join (`+connect_lobby <id>`), and Steam
  P2P send/receive. Every log line is prefixed `[Steam]`.
- **`preload.cjs`** — exposes a minimal, explicit `window.sign99Steam` surface
  (no generic `invoke`). Channel strings are duplicated verbatim; the vitest
  parity test `src/steam/channels.test.ts` fails if they drift.
- **`main.cjs`** — single-instance lock (so "Join Game" while running is
  delivered via `second-instance` argv), `steamBridge.attach(win)`,
  `electronEnableSteamOverlay()`, cleanup on quit.

### Renderer Steam services (`src/steam/`)
- **`ipc.ts`** — types for `window.sign99Steam`; `isSteamBuild()` /
  `getSteamBridge()`.
- **`SteamClient.ts`** — renderer singleton: one-time init, identity as
  `PlayerIdentity`, fan-out of bridge push events.
- **`SteamLobbyProvider.ts`** — `LobbyProvider` over Steam Matchmaking.
- **`SteamTransport.ts`** — `MultiplayerTransport` over Steam P2P. Star topology,
  host-authoritative, identical to the WebRTC transport's contract. Framing:
  `[1 byte type][utf-8 JSON]`; reliable channel for inputs + control, unreliable
  for host snapshots. A tiny `__steam_hello` handshake establishes `connected`.
  Gameplay code only ever sees **slot indices** — SteamIDs stay inside this file.
- **`slotOrder.ts`** — pure, deterministic member→slot assignment (owner = slot
  0, then ascending SteamID64). Host and every client compute the same map.
- **`SteamMultiplayerController.ts`** — UI-agnostic orchestrator: host / browse /
  join / invite / start. **Match setup travels over Steam lobby metadata**
  (`match_started`, `match_seed`, `match_slots`) — reliable and ordered — so the
  P2P transport only carries in-match traffic. Produces the same pending
  `{ transport, matchStart }` the menu already consumes for WebRTC.

### Tests (`npm test`, vitest — no Steam/Electron/browser needed)
- `src/multiplayer/identity.test.ts`
- `src/steam/slotOrder.test.ts` — deterministic ordering, dedupe, peers map
- `src/steam/framing.test.ts` — packet frame/unframe round-trips, UTF-8, junk
- `src/steam/channels.test.ts` — IPC channel-name parity across the 3 copies

### Connection lifecycle & diagnostics handled in code
Init failure (Steam not running / bad App ID / addon missing), lobby create /
join / leave failure, member join & leave, owner change, `metadata_changed`,
handshake timeout, P2P `SessionRequest` / `SessionConnectFail`, host loss (client
gets `onDisconnect` → menu), Steam servers disconnected, "match already started"
rejection on join, duplicate / stale join requests (idempotent), graceful
`dispose()` back to the menu. All logging uses `[Steam]`, `[Steam][Lobby]`,
`[Steam][Net]`, `[Steam][MP]` prefixes; nothing logs per frame.

### Networking API note (important)
`steamworks.js@0.4.0` only binds the **legacy ISteamNetworking P2P** API
(`sendP2PPacket` / `readP2PPacket`). It does **not** expose the modern
`ISteamNetworkingMessages` / `ISteamNetworkingSockets`. Steam still routes P2P
traffic through its relay backend, and `SendType.Reliable` covers must-arrive
data, so this is a sound base. Moving to NetworkingMessages later is isolated to
`electron/steam/steamworksBridge.cjs` plus the `netSend` / `netPacket` plumbing —
`SteamTransport` and all gameplay code are unaffected. Upgrade paths: submit/track
a PR adding the binding to `steamworks.js`, or vendor a small N-API addon for
just NetworkingMessages behind the same IPC channels.

---

## 2. What **Seth** must configure manually in Steamworks

None of this can be done from the repository — it lives in the Steamworks
Partner site (<https://partner.steamgames.com>) and your local Steam client.

### 2.1 Get an App ID
1. Partner site → **Apps & Packages → Create New App** (requires the $100
   Steam Direct fee to be paid, and the app to be associated with your partner
   account).
2. Note the numeric **App ID**.
3. Put it in `.env` / your shell as `SIGN99_STEAM_APP_ID=<appid>`.
   - Until you have one, leave it blank — the bridge falls back to **480**
     ("Spacewar"), Valve's public test app. Lobbies, invites, overlay and P2P
     all work under 480 with any two Steam accounts. Do **not** ship with 480.

### 2.2 Steamworks settings that must be enabled for the App ID
| Setting | Where | Why |
|---|---|---|
| **Steam Cloud / Stats** | not required | — |
| **Steam Networking** | on by default for all apps | P2P + relay |
| **Steam Matchmaking / Lobbies** | on by default | lobby create/browse/join |
| **In-Game Overlay** enabled | Partner site → *Installation → General* | friend invite dialog, "Join Game" |
| **"Steam must be running to play this game"** (DRM/App requirement) | *Installation → General* | ensures `SteamAPI_Init` succeeds for end users |
| **Launch option** | *Installation → General → Launch Options* | one entry, Executable = your built game exe (see §4) |
| **Rich Presence — "Join Game"** | works automatically once the game sets the `connect` rich-presence key (the bridge does this) | friend right-click → Join Game |
| **Localization token** for the rich-presence display string `#Status_InLobby` | Partner site → *Rich Presence Localization* (optional; only affects the text friends see) | cosmetic |

There is nothing to configure for the lobby **metadata keys** we use
(`game`, `host_name`, `match_started`, `match_seed`, `match_slots`, `mode`) —
lobby data is free-form string key/value at runtime.

### 2.3 Depot / build (only when you actually ship)
- Create a **Depot** for the desktop build, upload via `steamcmd` /
  `steampipe`, set the default branch.
- Copy the Steamworks redistributable `steam_api64.dll` /
  `libsteam_api.so` / `libsteam_api.dylib` next to the packaged app (electron
  packagers miss the `.node` addon's sibling libs — see
  <https://github.com/ceifa/steamworks.js/issues/75>).
- This repo does not yet have an installer/packager step (`npm run desktop`
  runs unpackaged Electron). Adding `electron-builder` / `electron-forge` is a
  separate task.

---

## 3. Join-through-Steam flow (as implemented)

```
Player A: Multiplayer → Host via Steam
          SteamLobbyProvider.hostLobby()  → Steam lobby created, owner = A
          bridge sets rich presence  connect = "+connect_lobby <lobbyId>"

Player A: Invite Friend  → overlay.activateInviteDialog(lobbyId)
Player B: accepts in overlay / friends list
   ├─ B already in-game:  Steam fires GameLobbyJoinRequested
   │                       → EVT.joinRequested → controller.join(lobbyId)
   └─ B not running:       Steam launches the game with "+connect_lobby <id>"
                            → main.cjs ingestLaunchArgs → EVT.joinRequested
                            → (or renderer polls takePendingJoin() on boot)
                            → menu navigates to the Steam lobby, controller.join()

Both in lobby:  host clicks Start
   host writes lobby metadata { match_started:1, match_seed, match_slots(JSON) }
   host builds SteamTransport(peers) + MsgMatchStart, hands it to game.ts
   each client sees metadata_changed → parses same slots/seed
                → builds SteamTransport(peers) + MsgMatchStart → game.ts
   SteamTransport __steam_hello handshake → connected → match runs
```

Stale / duplicate `joinRequested` for the lobby you are already in is ignored.
Joining a lobby whose `match_started` is `1` leaves immediately and surfaces
"That match has already started."

---

## 4. Running the game locally through Steam (development)

You do **not** need a real App ID to test end-to-end; use 480.

### Option A — fastest, no Steam launch plumbing
1. Start Steam and sign in (two accounts on two machines, or Steam +
   a second account via Family/again on another PC).
2. `SIGN99_STEAM_APP_ID=480 npm run desktop` on each machine.
   `steamworks.js` sets `SteamAppId=480` before `SteamAPI_Init`, so Steam
   attaches without a launch entry.
3. Host on machine 1 → **Invite Friend** (Steam overlay, `Shift+Tab`) →
   accept on machine 2. Or machine 2 → **Browse** → join.

### Option B — real "launch the game from Steam" path
1. Steam → **Games → Add a Non-Steam Game** → pick the built game exe
   (or `electron.exe` with the project path as argument during dev).
2. Right-click it → **Properties → Launch Options**: `+connect_lobby %command%`
   is **not** needed — Steam appends the `connect` string automatically when a
   friend joins. Leave launch options empty.
3. With your own App ID: set it in *Installation → Launch Options* on the
   Partner site instead, and install via a depot.
4. Test: quit the game on machine 2, have machine 1 invite, accept from the
   Steam friends list — Steam should start the game and it should land in the
   lobby.

### `steam_appid.txt`
If you run the built `.exe` **directly** (not via `npm run desktop`, which
passes the App ID in-process), drop a `steam_appid.txt` containing just the
number next to the executable.

---

## 5. Manual Steam multiplayer test checklist

### Same machine / development
- [ ] Launch with Steam **not** running → menu shows a clear "Steam client is
      not running" message, LAN/Online still work, no hang.
- [ ] Launch with Steam running, no `SIGN99_STEAM_APP_ID` → `[Steam] initialized.
      appId=480 steamId=… name=…` in the main-process console.
- [ ] Multiplayer menu → **Host via Steam** → `[Steam][Lobby] hosted <id>`.
- [ ] Lobby shows your Steam persona name at slot 0, "owner".
- [ ] `[Steam] hosted lobby … type=friends max=…`; rich presence `connect` set
      (visible to a friend as a "Join Game" option).

### Two Steam accounts / two machines
- [ ] **A hosts**, lobby created.
- [ ] **B → Browse** → A's lobby appears with correct host name & player count →
      **Join** → both clients show 2 members, A = owner.
- [ ] **B joins via friend invite** while B's game is **already open**
      (`GameLobbyJoinRequested` path).
- [ ] **B joins via friend invite** while B's game is **closed**
      (Steam launches it, `+connect_lobby` path, lands in lobby).
- [ ] Duplicate accept (click Join twice) → no second lobby, no error spam.
- [ ] Join a lobby after A has started → "That match has already started."
- [ ] **A starts the match** → both clients enter the match at the same seed;
      slot 0 = A, slot 1 = B.
- [ ] Commands replicate: B builds / moves / fires → A's authoritative sim
      reflects it; A's snapshots move B's view.
- [ ] Both players can play a full skirmish with no desync beyond the existing
      WebRTC/LAN tolerance.
- [ ] **Client disconnect**: B alt-F4 → A sees B's ship go idle / A keeps
      playing; `[Steam][Net]` logs a session fail, no crash.
- [ ] **Host disconnect**: A alt-F4 → B gets "Lost connection to host." and
      returns to the menu cleanly.
- [ ] **Lobby cleanup**: after either exit, `Browse` on a third client no longer
      lists the dead lobby (Steam expires it); rejoining starts fresh.
- [ ] **Steam offline mid-match** (pull network on the host briefly) →
      `[Steam] Steam servers disconnected` → both sides get a graceful
      disconnect, not a freeze.

### Overlay / invites
- [ ] `Shift+Tab` opens the Steam overlay inside the game.
- [ ] **Invite Friend** button opens the Steam invite dialog for the current
      lobby.
- [ ] Accepting from the overlay (not the friends list) also joins.

---

## 6. File map

```
electron/steam/steamChannels.cjs      IPC channel names (source of truth)
electron/steam/steamworksBridge.cjs   main process; only steamworks.js consumer
electron/preload.cjs                  window.sign99Steam surface
electron/main.cjs                     attach bridge, single-instance, overlay

src/multiplayer/identity.ts           PlayerIdentity
src/multiplayer/lobby/types.ts        neutral lobby types
src/multiplayer/lobby/LobbyProvider.ts

src/net/transport.ts                  MultiplayerTransport (+ control channel)

src/steam/ipc.ts                      renderer bridge typing + isSteamBuild()
src/steam/SteamClient.ts              renderer singleton
src/steam/SteamLobbyProvider.ts       LobbyProvider impl
src/steam/SteamTransport.ts           MultiplayerTransport impl (P2P)
src/steam/slotOrder.ts               deterministic slot assignment
src/steam/SteamMultiplayerController.ts  host/browse/join/invite/start flow
src/steam/*.test.ts                    vitest unit tests
```
