# Gate88Redux — Next Steps

---

## Visual Overhaul Pass 2 — Build 030 — Remaining Work

Build 030 implemented the highest-impact parts of the second-pass visual overhaul. The following items were deferred because they are either complex, require deeper architectural changes, or need more content art direction before implementation.

### High Priority

**1. Per-building layered rendering (building.ts)**
The building draw methods are currently dense one-liners (legacy style). A proper
second-pass overhaul would expand each building class's `draw()` method into
multi-layer rendering:
- `PowerGenerator`: glowing energy orb core with emanating spokes and pulsing outer shell
- `ResearchLab`: multi-ring scanning animation with orbiting node dots
- `Factory`: animated gear with coolant pipes and intake vents
- `Shipyard`: launch bay opening animation; ship silhouettes docking/undocking
- `CommandPost`: satellite dish animation or antenna cross with rotating radar sweep
- `Turrets`: distinct barrel/mount shapes per type (gatling = multi-barrel, missile = launch tubes, exciter = antenna array)

Each building should use the warm color constants added in Build 030
(`building_glow_power`, `building_glow_research`, etc.).

**2. Fighter damage flicker and death breakup (fighter.ts)**
When a fighter takes heavy damage:
- Add a `damageFraction`-based flicker to the outline alpha
- Add a small random "twist" to the angle when near death

When a fighter dies at high speed:
- Emit a short spinning fragment arc from `emitExplosion`
- Already partially handled by `emitExplosion` but could be richer

**3. Player ship visual polish (ship.ts)**
The player ship already has good thruster trails but could benefit from:
- A more elaborate 3-layer silhouette (hull + wing outlines + engine pod)
- Weapon-specific muzzle positions (cannon = bow tip, gatling = side pods)
- Shield hit flash when shield absorbs damage

**4. Synonymous faction visual overhaul (fighter.ts / building.ts)**
The Synonymous faction drones share the same triangle silhouette as standard fighters.
Give them a distinctive swarm-style visual:
- Hexagonal core dot surrounded by small orbiting flecks
- Nova-bomber: larger glowing sphere with drone count indicator arcs

**5. Build placement and command indicator polish (actionmenu.ts / game.ts)**
- Build placement ghost: add a warm pulsing outer ring at `buildRadius` to show influence area
- Invalid placement: red cross-hatch overlay (not just the current red tint)
- Rally point: animated radiating ring at the rally position
- Attack command: briefly draw a crosshair/reticle at the target position

### Medium Priority

**6. Directional conduit energy flow (grid.ts)**
The `drawConduitPulses()` method added in Build 030 draws individual pulses per cell.
A more satisfying version would:
- Precompute energy flow direction per conduit cell using the PowerGraph BFS tree
- Animate pulses traveling FROM generator cells TOWARD powered buildings
- Only recalculate directions when the power graph is invalidated

**7. Selection and hover feedback (commandMode / game.ts)**
- Selected units: draw elegant bracket corners (not just a circle)
- Hovered buildings: draw a subtle warm outline highlight
- Drag selection box: replace the plain rectangle with a polished semi-transparent box
  with corner brackets

**8. Range and targeting indicator polish (turret.ts / gameOverlays.ts)**
- Gatling turret: draw a narrow scanning arc when no target is acquired
- Exciter turret: add a brief targeting bracket animation around the lock-on target
  before firing (currently only has the lock-on circle in High mode)
- Mass driver turret: draw a heavy kinetic reticle with range ring

**9. Warmer background atmosphere (nebula.ts)**
- The current nebula is blue/purple/red. Add a golden/amber mid-section nebula
  centered around the contested border zone
- Add very subtle slow-moving dust particles in the background in High mode
  (use the existing StarField's twinkling infrastructure for performance)

### Low Priority / Stretch

**10. Death spin for large ships**
When a large ship (Synonymous nova bomber, player ship) dies, briefly emit a
spinning angular fragment arc before the explosion.

**11. Weapon charge-up feedback for player**
When the laser is charging (RMB hold), add an expanding glow ring around the
player ship that fills in as charge completes. Already has some charge visuals
but could be dramatically improved.

**12. Warm ambient scan-line for buildings**
Add a very slow vertical "scan" highlight that travels up each powered building,
suggesting an active status readout. Should be on a ~4-second cycle and very subtle.

---



This PR (Build 020) addressed the most critical breakage in the Terran enemy AI
base-construction system.

### What was fixed

**1. True 4-connected conduit path generation (`src/aibaseplan.ts`)**

`traceLine()` previously used Bresenham's line algorithm without guarding
against diagonal steps.  When the algorithm's error term crossed zero in both
axes in the same iteration, both x *and* y changed, producing a step where
consecutive cells shared only a corner — not an edge.  Gate88's power graph
propagates energy only through 4-adjacent (orthogonal) neighbours, so these
diagonal steps silently broke power flow through every ring and every spoke.

The fix inserts an intermediate orthogonal cell whenever a diagonal step would
occur: the x-axis step fires first (pushing the intermediate), then the y-axis
step.  The result is a staircase path that is guaranteed 4-connected.

A new `assert4Connected(path, label)` helper is exported from `aibaseplan.ts`.
It logs a console warning on the first violated pair so future regressions are
immediately visible in debug mode.

**2. Building placement adjacent to ring conduit (`src/enemybaseplanner.ts`)**

`findBestBuildingCell()` used `minOffset = ceil(fp/2) + ringThickness + 1`
which placed buildings one cell too far from the ring outer edge.  The
footprint's inner border ended up 2–3 cells from the ring, so the
`isNearPlannedPower` check consistently failed for buildings between spokes.

Changed to `minOffset = floor(fp/2) + ringThickness` so buildings are placed
with their inner footprint border exactly adjacent to the ring outer edge:

- fp=3 building: footprint starts at R+2, inner border at R+1 (ring outer edge) ✓
- fp=4 building: footprint starts at R+2, inner border at R+1 ✓

**3. Connector conduit paths (`src/enemybaseplanner.ts`)**

Added `computeConnectorPath()` which, after a building candidate is locked in,
searches the ring conduit cells and spoke cells for the nearest planned/active
conduit cell and generates a 4-connected traceLine path to the building's inner
border (up to 5 cells max).  The path is stored in `BuildingSlot.connectorCells`
and dispatched as individual conduit orders before the building order itself.

`BuildingSlot` now carries two new fields: `connectorCells` (the path) and
`connectorQueuePtr` (current dispatch index; -1 = candidate not yet locked).

`nextBuildingSlotOrder()` is now a two-phase state machine:
- Phase A: drain pending connector conduit orders for an already-locked slot.
- Phase B: find candidate, compute connectors, lock slot, dispatch first connector
  or building if no connectors are needed.

**4. Ring advancement based on real construction progress (`src/enemybaseplanner.ts`)**

`maybeAdvanceRing()` previously advanced rings when enough building slots were
*queued* (`s.queued || s.placed`), meaning ring 1 could open before a single
conduit or building in ring 0 was actually constructed.

Changed to count:
- `placedConduit / totalConduit` — fraction of ring conduit cells actually in
  the grid (using `state.grid.hasConduit`).
- `placed / slots.length` — fraction of building slots actually constructed.

Thresholds scale with difficulty (Easy: 45% / 20%, Nightmare: 85% / 60%).  A
90-second stuck-safety timer forces advancement if a ring is completely blocked
so the AI never stalls indefinitely on unplaceable slots.

---

## What was NOT implemented (remaining work)

### Connector conduit: relay stuck-slot retry

When a building slot fails `getStructureFootprintStatus` at Phase B dispatch
time (e.g. a player built over the reserved area), `slot.queued` stays false but
`slot.connectorQueuePtr >= 0`, so it will loop back through Phase A (no-op) and
then Phase B indefinitely, skipping each time.  A per-slot "skip cooldown" and
retry counter should be added so the planner eventually gives up on a slot and
resets it.

### F3 / debug overlay for AI construction

The problem statement requested a debug visualization showing:
- planned conduit cells, queued conduit cells, active conduits, energized conduits
- unpowered active conduits
- planned / blocked building slots
- active builder targets
- ring index, ring completion %, connected-to-CP status
- powered vs total buildings

**File to modify:** `src/game.ts` drawDebugOverlay (or create a new
`src/aibasedebug.ts`).  The data is available via `EnemyBasePlanner.snapshot()`
and the new `rings`, `spokes`, `claimedConduitKeys`, and `reservedCells`.
Expose getters for these or pass the planner reference to the debug renderer.

### Bastion back-spoke connection

`generateBastions()` sets `bastion.spokeBackCells = []` and never populates it.
Bastions should have a conduit spoke back to the nearest ring so power actually
reaches them.  Add a `traceLine` from the bastion anchor to the nearest ring
cell, and queue those cells via a new `nextBastionSpokeOrder()` sub-method.

### Adaptive ring-gap topology

Currently, `gapProbability` randomly omits ring segments.  On Easy difficulty,
this can accidentally disconnect an entire ring half from all spokes.  A
post-generation pass should verify each ring arc segment has at least one spoke
touching it and re-join the segment if not.

### `isNearPlannedPower` semantic split

The function checks `claimedConduitKeys` (queued/planned) alongside actual grid
conduits and energized cells.  For placement-time decisions this is correct
(future-looking), but the distinction between "planned" and "actually powered"
is now more important after the ring-advancement fix.  A future pass could
rename the function `hasPowerConnector()` and add a separate
`isActuallyPowered(state, cx, cy)` for diagnostics and more precise validation.

### Player conduit painting vs. AI footprint rejection

`getStructureFootprintStatus` correctly rejects building placements that would
overlap an enemy conduit.  But when the AI generates connector paths, it does
not yet reserve those connector cells in `reservedCells` before calling
`canAIPlaceConduit`.  Two connector orders for adjacent slots could therefore
race for the same cell.  Fix: call `reserveCells([cell])` for all connector
cells when locking the slot, not lazily per-dispatch.

---

## Crystal Nebula — Build 035 — Remaining / Deferred Work

### Wire laser-kill explosions into CrystalNebula

Kills via `damageLaserLine` and `damageLaserLineLimited` in `src/combatUtils.ts` do not yet call `crystalNebula.addExplosion()`.  Wiring them in requires adding an optional `crystalNebula?: CrystalNebula` parameter to both functions and updating their callers in:
- `src/weaponFiring.ts` — update `WeaponFiringCtx` interface and the three call sites
- `src/turretCombat.ts` — add optional parameter to `damageLaserLine` call
- `src/fighterCombat.ts` — add optional parameter to `damageLaserLineLimited` call

### Add more explosion hook sites in mine.ts and combatUtils.ts

`src/mine.ts` calls `this.gameState.particles.emitExplosion(...)` on mine detonation without producing a `pendingCrystalExplosions` entry. Add a `pendingCrystalExplosions.push(...)` alongside the existing `emitExplosion` call.

---


### Online Multiplayer — PR 19 Implementation Summary

**Phase 7 — Full Supabase lobby integration**

**Files to create/modify:**
- `src/online/supabaseLobby.ts` — Supabase client init, lobby CRUD, heartbeat.
- `src/online/onlineClient.ts` — Online transport adapter implementing `MultiplayerTransport`.
- `src/menu.ts` — Wire up `drawOnlineMultiplayer` to real lobby list/create/join flows.

**Phase 8 — WebRTC DataChannel transport**

**Files to create:**
- `src/online/webrtcTransport.ts` — `WebRtcTransport` implementing `MultiplayerTransport`.
- `src/online/signalingClient.ts` — Supabase-based offer/answer/ICE exchange.

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

### Synonymous Fighter Follow-up

- LAN snapshot reconciliation still reconstructs remote fighters as generic `FighterShip`/`BomberShip`; extend the network snapshot with faction/unit-variant metadata before relying on Synonymous fighter visuals in multiplayer clients.
- Nova Bomber sub-drone damage is currently assigned by a conservative adapter in `src/fighter.ts`: incoming damage is applied to one living drone at a time, biased by source angle when available. Future hitbox work could target the nearest visible drone offset directly.

### Ship Pathfinding Follow-up

- Mobile-unit navigation now budgets fighter path resolves, shares nearby fighter route results, caches blocking rects per frame, tries cheap detours before full A*, and uses a heap-backed A* open set. If F3 still shows high mobile pathfinding time in dense-base playtests, add a true building-collision version counter so blocker caches can persist across frames until a collision-enabled structure is added, completed, destroyed, moved, or removed.


## Ship Pathfinding Follow-up

- Manual playtest still recommended: build a wall loop with a bottom opening, command fighters from inside/right side to the left outside target, and confirm they route through the opening without pushing into the left wall.
- Dynamic obstacle handling remains intentionally lightweight: ship routes are cached and throttled, then refreshed on target movement, waypoint progress, stuck detection, or blocked cached waypoints rather than fully replanned every frame.
- Squad path sharing currently shares the next navigation waypoint by nearby start/target buckets. If very large groups still bunch at narrow openings, add a small corridor-slot offset around successive A* waypoints rather than increasing the per-frame path budget.

---
