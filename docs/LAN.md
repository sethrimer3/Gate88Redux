# Gate 88 — LAN Multiplayer Guide

Gate 88 supports local-area-network (LAN) multiplayer for up to 8 players.
One player runs the **Node relay server** on their machine; all players open
the game in a browser and connect to that server.

---

## Requirements

- **Node.js** v18 or later (for the relay server)
- All machines on the **same LAN** or a VPN that bridges them
- A browser that supports WebSockets (any modern browser)
- The relay server cannot run inside GitHub Pages — you must run it locally

---

## Quick Start (host machine)

```bash
# Install dependencies (first time only)
npm install

# Start both the Vite dev server and the LAN relay server together:
npm run dev:lan

# — or start them separately in two terminals:
npm run dev          # Vite dev server on http://localhost:5173
npm run lan:server   # LAN relay on ws://0.0.0.0:8787
```

The relay server prints:
```
[Gate88 LAN] Server listening on ws://0.0.0.0:8787
```

Windows may pop up a firewall prompt — allow Node to accept LAN connections.

---

## Finding your LAN IP

| OS      | Command                          |
|---------|----------------------------------|
| Windows | `ipconfig`                       |
| macOS   | `ifconfig` or System Preferences |
| Linux   | `ip addr` or `hostname -I`       |

Your LAN IP looks like `192.168.1.25` or `10.0.0.42`.

---

## Hosting a Lobby

1. Open the game at `http://YOUR_IP:5173` (or `http://localhost:5173` for local).
2. Click **Play → LAN Multiplayer → Host LAN Lobby**.
3. The host is auto-assigned slot 1.
4. Configure remaining slots:
   - Click **→ AI** to add an AI opponent (then **Diff** to cycle difficulty).
   - Click **→ Closed** to disable a slot.
   - Slots left as **Open** will accept joining players.
5. Share your LAN IP with other players (e.g. `ws://192.168.1.25:8787`).
6. When all human players are **Ready**, click **Start Match**.

---

## Joining a Lobby

1. Open the game at `http://HOST_IP:5173` (same Vite dev server as the host).
2. Click **Play → LAN Multiplayer → Join LAN Lobby**.
3. Enter the host's WebSocket URL (e.g. `ws://192.168.1.25:8787`).
4. Enter your player name.
5. Click **Connect & Join**.
6. Once in the lobby, click **Ready** when you are ready.
7. The host starts the match.

---

## About HTTPS and Mixed Content

GitHub Pages serves the game over **HTTPS**. Browsers block insecure
`ws://` WebSocket connections from HTTPS pages (mixed-content policy).

**Workaround:** run `npm run dev` on the host machine and have all players
open `http://HOST_IP:5173` instead of the GitHub Pages URL. Plain `http://`
allows plain `ws://` connections.

If you need HTTPS hosting, you would need to also set up WSS (WebSocket
Secure) — not covered here.

---

## Connection Flow

```
Host client:
  connect → server sends welcome(slot=0) → host sees lobby

Non-host client:
  connect → server sends server_connected(clientId)
  client sends join_request(name) → server sends welcome(slotN) or join_rejected
  client sees lobby → user clicks Ready
  host clicks Start Match → all clients receive match_start
```

---

## LAN Architecture

| Component          | Where it runs | Responsibility |
|--------------------|---------------|----------------|
| LAN relay server   | Host machine (Node) | Routes messages, manages lobby |
| Host browser       | Host machine (browser) | Authoritative simulation |
| Client browsers    | Other machines (browser) | Send input, receive snapshots |

The **host browser** runs the full physics/game simulation and broadcasts
state snapshots at ~20 Hz. Remote clients send their input (movement, aim,
fire) every tick and receive snapshots to sync their view.

AI slots are simulated exclusively on the **host** — remote clients never
run AI logic, which prevents desync.

---

## Debug Overlay (F3)

While in a LAN match, press **F3** to open the debug overlay. In LAN mode
it shows:

- `LAN host  slot 1  ping 12ms`
- `snap seq 142  AI dirs 2` (host)
- `snapshot seq 141  age 52ms` (client)
- `⚠ WARNING: No snapshot for >3s` (if connection is lagging)

---

## Manual Test Plan

1. Start `npm run lan:server` (or `npm run dev:lan`).
2. Open host browser at `http://localhost:5173` → Play → LAN Multiplayer → Host LAN Lobby.
3. Confirm slot 1 shows "Ready" and lobby is visible.
4. Open a second browser tab or machine, join at `ws://localhost:8787` (or LAN IP).
5. Second player clicks Ready.
6. Host configures slot 3 as AI (Normal difficulty).
7. Host clicks Start Match.
8. Both players should see the game world.
9. Host moves ship (WASD), aims (mouse), fires (LMB).
10. Client moves and fires — host should see client ship moving.
11. AI ship (slot 3) should appear and move/fight.
12. Press F3 on both clients to verify ping and snapshot stats.
13. Disconnect the client browser — confirm the slot reopens in the host lobby.
14. Disconnect the host server (`Ctrl+C`) — confirm remaining clients receive "Match ended".
15. Try joining after match has started — confirm "Match already in progress" rejection.

---

## Known Limitations (current build)

- **Building sync**: Buildings are synced health/progress only. Full
  create/destroy sync across clients is planned for a future pass.
- **Fighter sync**: Fighter positions are relayed in snapshots but not
  created/destroyed dynamically on clients.
- **Projectile sync**: Projectile data is included in snapshots; clients
  do not yet spawn matching visual projectiles.
- **Resource sync**: Only the local player's resources are synced from the
  host snapshot.
- **No reconnection**: If a client disconnects mid-match, they cannot
  rejoin. Refresh the page to return to the menu.
- **Single lobby**: The relay server supports one lobby at a time. Restart
  the server to start a fresh session.
- **Internet play**: This is LAN only. No STUN/TURN or NAT traversal. For
  internet play, use a VPN (e.g. Tailscale or ZeroTier) to create a virtual LAN.
