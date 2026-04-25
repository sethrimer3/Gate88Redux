# Gate 88 — TypeScript Port: Planned Features

This document tracks features planned for the Gate 88 TypeScript port.
Items are roughly ordered by priority; checked items are complete.

---

## Multiplayer

### LAN and Peer-to-Peer Network Play
- [ ] LAN / Peer-to-peer network support for **up to 8 players**
- [ ] Players can be on the same team or opposing teams, determined by
  the colour slot they choose at the lobby screen
- [ ] Supported colour/team slots:
  - Friendly Blue (default player team)
  - Enemy Red (default AI opponent team)
  - Allied Teal
  - Allied Purple
  - Enemy Orange
  - Neutral Grey (free-for-all / no team)
  - up to 2 custom colours selectable in the lobby
- [ ] Host/join lobby screen with room code or LAN auto-discovery
- [ ] Authoritative game state sync over WebRTC data channels
  (PeerJS or raw RTCPeerConnection)
- [ ] Late-join spectator mode
- [ ] In-game ping display and lag-compensation rollback for fast
  projectile hits

---

## Graphics — Space-Like Beauty

> Priority: high visual impact and strong performance on mid-range hardware.

### Background & Environment
- [x] **Nebula clouds** — pre-rendered offscreen canvas, eight layered
  radial-gradient blobs per world half (blue/teal on the player side,
  red/orange on the enemy side, purple at the centre divide), drawn at
  a slow parallax depth (0.15× camera movement)
- [x] **Enhanced starfield** — 900 stars across three depth layers with
  per-star twinkling (phase-shifted sine oscillation), three colour
  archetypes (cool blue-white, neutral white, warm yellow-orange),
  rare "giant" bright stars (×3 size), and occasional shooting-star
  streaks that fire across the field every 8–20 seconds
- [x] **Vignette** — radial CSS-gradient overlay that darkens the edges
  of the viewport to focus attention on the battlefield

### Ship & Projectile FX
- [x] **Additive particle blending** — explosion and spark emitters now
  use `globalCompositeOperation = 'lighter'` so overlapping hot
  particles bloom into bright cores, exactly like a real detonation
- [x] **Richer explosions** — increased particle count, varied sizes and
  lifetimes, plus a secondary ring of small debris sparks
- [x] **Particle pool** expanded from 2,048 to 4,096 slots to support
  simultaneous large explosions without recycling

### Buildings & Conduits
- [ ] **Building glow** — powered buildings emit a faint team-coloured
  halo (canvas `shadowBlur`) that brightens with health
- [ ] **Conduit energy flow** — animated dashed-line pattern travelling
  along conduit cells to show power flowing from generators
- [ ] **Command Post pulse** — slow pulsing ring around the CP that
  scales with remaining health

### Post-Processing (future)
- [ ] Optional WebGL renderer path for true HDR bloom and chromatic
  aberration on impacts
- [ ] Full-screen scanline / CRT-glass shader (toggle in options)

---

## Gameplay Additions

- [ ] **Cloaking** ability on the player ship (research-gated, limited
  duration, drains battery while active)
- [ ] **Warp Drive** special — burst of extreme speed with a dramatic
  hyperspace streak effect (short cooldown)
- [ ] **Shield Drone** — purchasable escort unit that orbits the player
  and absorbs hits
- [ ] **Asteroid fields** — destructible asteroid clusters that provide
  cover and drop bonus resources
- [ ] **Nebula zones** — navigable cloud regions that grant stealth but
  reduce weapon range (ties into the nebula background layer)
- [ ] **Victory conditions** — configurable win states beyond "destroy
  enemy command post": score-limit, time-limit, resource-race

---

## Audio

- [ ] Spatial / positional audio: ship and building sounds attenuate with
  distance from the camera
- [ ] Dynamic music system that cross-fades to a more intense layer
  during combat
- [ ] Per-team engine sound variants

---

## Quality of Life

- [ ] Minimap HUD element (persistent, bottom-right corner) with zoom
  controls
- [ ] Rebindable keyboard/mouse controls saved to `localStorage`
- [ ] Pause/resume mid-game settings panel (audio volume, graphics
  quality tier)
- [ ] Save/load game state to `localStorage` (single-player only)
