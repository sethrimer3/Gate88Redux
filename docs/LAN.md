# Gate 88 — LAN Multiplayer Guide

Gate 88 supports local-area-network (LAN) multiplayer for up to 8 players.
One player runs the **Node LAN helper** on their machine; all players open
the game in a browser and connect to that relay.

## Requirements

- **Node.js** v18+
- Machines on the same LAN (or bridged VPN)
- Modern browser with WebSocket support
- Local Node helper process (for relay + LAN discovery)

## Quick Start (host)

```bash
npm install
npm run dev:lan
```

This starts:
- Vite app server (`http://localhost:5173`)
- LAN relay (`ws://0.0.0.0:8787` by default)
- UDP discovery broadcaster/listener (`LAN_DISCOVERY_PORT`, default `47888`)
- Local discovery HTTP API (`http://localhost:8788/lan/discovered`)

Environment variables:
- `LAN_PORT` (default `8787`)
- `LAN_DISCOVERY_PORT` (default `47888`)
- `LAN_DISCOVERY_HTTP_PORT` (default `8788`)

## Automatic LAN discovery flow

Browser pages cannot reliably receive raw UDP broadcast packets, so discovery is handled by Node:

1. Host helper broadcasts `gate88_lan_advertise` UDP JSON packets on LAN.
2. Joiner helper listens for advertisements and caches recent lobbies.
3. Browser UI calls local endpoint `GET http://localhost:8788/lan/discovered`.
4. **Play → LAN Multiplayer → Find LAN Games** shows discovered lobbies.

If local discovery endpoint is unavailable, UI falls back gracefully:

> Automatic LAN discovery requires running the local Gate88 LAN helper. You can still enter the host URL manually.

## Host / join workflow

- Host: **Play → LAN Multiplayer → Host LAN Lobby**.
- Joiner:
  - Preferred: **Find LAN Games**, click an open lobby.
  - Fallback: **Join Manually**, enter `ws://HOST_IP:8787`.

Manual URL join remains fully supported.

## Firewall and networking notes

- Windows may prompt for Node firewall access; allow private network access.
- Allow inbound UDP on discovery port (`47888` by default).
- Allow inbound TCP on relay port (`8787` by default).
- Allow Vite dev server port (`5173`) if hosting browser page from host machine.

## HTTPS / GitHub Pages limitation

GitHub Pages serves over HTTPS, and browsers block insecure `ws://` from HTTPS pages (mixed content).
For LAN development, use `http://HOST_IP:5173` so browsers can connect to `ws://HOST_IP:8787`.
Use WSS if you need secure WebSockets from HTTPS hosting.
