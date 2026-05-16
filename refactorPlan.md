# Gate88Redux — Refactor Plan

This document tracks monolithic source files and the recommended strategy for
splitting them into more focused modules.  Update this file whenever a
refactor is completed or a new large file is identified.

---

## Files over 2,000 lines (immediate priority)

| File | Lines | Status |
|------|-------|--------|
| `src/game.ts` | ~2,403 | 🔴 in progress |
| `src/menu.ts` | 2,272 | 🔴 planned; online Supabase setup pass added more lobby/auth UI |
| `src/gamestate.ts` | ~1,731 | 🟡 planned |

## Files 1,000–2,000 lines (secondary priority)

| File | Lines | Status |
|------|-------|--------|
| `src/actionmenu.ts` | ~1,586 | 🟡 planned |
| `src/enemybaseplanner.ts` | ~1,463 | 🟡 partially done (see below) |
| `src/projectile.ts` | ~1,178 | 🟡 planned |

---

## Completed splits

### `src/game.ts` — Build 023 part 2 (this PR)

**Extracted → `src/fluidForces.ts`**

- `injectFluidForces(state, spaceFluid)` — pushes per-entity velocity/color
  forces into the SpaceFluid simulation each tick; no longer requires
  `game.ts` to import `Bullet`, `GatlingBullet`, `GuidedMissile`,
  `BomberMissile`, and `Laser` solely for `instanceof` checks.

**Extracted → `src/turretCombat.ts`**

- `fireTurretShots(state, localTeam)` — acquires targets and fires for every
  fully-built turret on `localTeam`; previously `updateLocalPlayerTurrets`.

**Extracted → `src/fighterCombat.ts`**

- `updateFighterWeaponFire(state, spaceFluid)` — per-tick weapon fire for all
  live undocked Team.Player fighters; handles FighterShip, BomberShip,
  SynonymousFighterShip, and SynonymousNovaBomberShip variants.

Lines removed from `game.ts`: ~147 (3,257 → 3,110).
New files: `src/fluidForces.ts` (~95 lines), `src/turretCombat.ts` (~50 lines),
`src/fighterCombat.ts` (~90 lines).

Import cleanup: `SynonymousDroneLaser`, `SynonymousNovaBomb`, `MassDriverBullet`,
`Missile` removed from `game.ts` imports (no longer referenced directly).

### `src/game.ts` — Build 023

**Extracted → `src/combatUtils.ts`**

- `isHomingTarget(entity)` — pure predicate; was a private method on `Game`.
- `findClosestEnemy(state, pos, team, range)` — renamed from the private
  `findClosestEnemyForTeam`; now importable by any module that needs it.
- `damageLaserLine(state, spaceFluid, source, start, end, damage, hitRadius?)`
  — parameterised the previously hard-coded `Team.Player` restriction to use
  `source.team`, making it work for any attacker.
- `damageLaserLineLimited(state, spaceFluid, start, end, damage, hitRadius,
  pierceCount, source)` — pierce-limited variant; `source` is now a required
  argument instead of defaulting to `state.player`.

Lines removed from `game.ts`: ~100.  New file `src/combatUtils.ts`: ~95 lines.

### Previous splits (before Build 023)

| Destination | What was extracted | Source |
|---|---|---|
| `src/gameRender.ts` | `drawWaypointMarkers`, `drawDebugOverlay`, `drawConfluenceTerritory` | `game.ts` |
| `src/buildingfootprint.ts` | `footprintForBuildingType` | `builddefs.ts` |
| `src/aibaseplan.ts` | Ring/spoke geometry, `traceLine`, `assert4Connected` | `enemybaseplanner.ts` |
| `src/aidoctrine.ts` | Doctrine enum + configs (6 doctrines) | `enemybaseplanner.ts` |
| `src/airaids.ts` | `RaidPlanner` class | `enemybaseplanner.ts` |
| `src/teamutils.ts` | Team helpers (`isHostile`, `teamColor`, etc.) | various |
| `src/practiceconfig.ts` | `PracticeConfig` + `cloneDefaultPracticeConfig` | `practicemode.ts` |
| `src/vsaiconfig.ts` | `VsAIConfig` + difficulty helpers | `vsaibot.ts` |
| `src/visualquality.ts` | `VisualQuality` types + presets | `game.ts` |
| `src/synonymousShipRenderer.ts` | Synonymous ship draw logic | `synonymous.ts` |
| `src/synonymousMine.ts` | `SynonymousMineLayer`, `SynonymousDriftMine` | `mine.ts` |
| `src/confluence.ts` | Confluence faction territory logic | `gamestate.ts` + `game.ts` |
| `src/lan/` directory | LAN transport, client, protocol | `game.ts` (setup wired in) |
| `src/online/` directory | WebRTC transport, signalling, lobby | `game.ts` (setup wired in) |

### `src/game.ts` — Build 026 (this PR)

**Extracted → `src/gameOverlays.ts`** (~517 lines)

- `drawGhostSpectator`, `drawLossOverlay`, `drawMergedShipBlockerOutlines`,
  `drawCommandModeOverlay`, `drawBuildingHoverHitpoints`, `buildingEffectRange`,
  `drawGlowLayer` (with `speedGlowFactor`, `fighterMaxSpeed` private helpers),
  `drawScreenOverlays`.
- Introduces `OverlayCache` interface + `createOverlayCache()` to bundle cached
  canvas gradients/patterns; replaces 7 private fields on `Game` with one
  `private overlayCache: OverlayCache`.

**Extracted → `src/weaponFiring.ts`** (~415 lines)

- `updatePlayerFiring`, `updateGuidedMissileControl` (public entry points),
  `fireSelectedPrimary`, `handleWeaponSpecial`, `handleGatlingSpecial`,
  `handleLaserSpecial`, `handleRocketSwarmSpecial`, `handleCannonHomingSpecial`.
- Both public functions return the updated `GuidedMissile | null` reference
  so `Game` can store it in `this.activeGuidedMissile`.

Lines removed from `game.ts`: ~730 (3,110 → ~2,392).
New files: `src/gameOverlays.ts` (~517 lines), `src/weaponFiring.ts` (~415 lines).

Previously completed from `game.ts`:
- ✅ `src/fluidForces.ts` — `injectFluidForces` (Build 023)
- ✅ `src/turretCombat.ts` — `fireTurretShots` (Build 023)
- ✅ `src/fighterCombat.ts` — `updateFighterWeaponFire` (Build 023)
- ✅ `src/combatUtils.ts` — laser damage helpers, `isHomingTarget`, `findClosestEnemy` (Build 023)
- ✅ `src/gameRender.ts` — `drawWaypointMarkers`, `drawDebugOverlay`, `drawConfluenceTerritory`
- ✅ `src/gameOverlays.ts` — overlay/glow drawing helpers (Build 026)
- ✅ `src/weaponFiring.ts` — player weapon firing logic (Build 026)

### `src/game.ts` — Build 044 (this PR)

**Extracted → `src/commandMode.ts`** (~190 lines)

- `createCommandModeState`, `updateCommandMode`, `updatePlayerFighterOrderTargets`.
- Internal command-mode helpers moved with the extracted module:
  `selectCommandUnits`, `issueCommandModeOrder`, `findCommandEnemyAt`,
  `findNearestEnemyNear`.

`Game` now delegates command-drag selection, command-mode right-click orders,
and follow/protect fighter retargeting to `commandMode.ts`.

### `src/game.ts` — Build 044 (continued in this PR)

**Extended extraction → `src/commandMode.ts`** (~280 lines total)

- Added `updateNumberGroupHotkeys` to move number-key hold/tap behavior out of
  `Game` while preserving existing interactions:
  - hold 1–4 + RMB issues dock orders,
  - hold 1–4 + LMB issues waypoint or assigns shipyards,
  - double-tap issues follow, triple-tap issues protect.
- `CommandModeState` now owns tap state (`lastGroupTap`) so command-control
  runtime state is centralized in one module-scoped state object.

Removed from `game.ts`:
- `groupFromHeldNumber`
- `updateNumberGroupHotkeys`
- `updateNumberGroupTapOrders`
- `pressedNumberCommandGroup`
- `findPlayerShipyardAt`

---

## Planned splits (not yet started)

### `src/game.ts` (current ~2,403 lines)

The `Game` class is the largest remaining monolith.  Next extraction:

1. **Finish command-order extraction**
   - Remaining command-order helpers in `game.ts`:
     `issueShipOrder`, `getPlayerFightersForCommand`, `groupLabel`,
     `recordWaypointMarker`, `clearWaypointMarker`, `playerShipyardsForCommand`.
   - Move these into `src/commandMode.ts` as order utility functions using
     `state`, `hud`, `camera`, and `waypointMarkers` from context.


### `src/menu.ts` (2,272 lines)

The `MainMenu` class covers setup UI, multiplayer lobby UI, settings, and
all nested sub-menus.  Suggested extractions:

1. **`src/menuPracticeSetup.ts`** — Practice-mode configuration panels.
2. **`src/menuVsAISetup.ts`** — Vs.-AI configuration panels.
3. **`src/menuLanLobby.ts`** — LAN lobby draw/update logic.
4. **`src/menuOnlineLobby.ts`** — Online lobby draw/update logic.
5. **`src/menuSettings.ts`** — Visual-quality / audio settings panel.

Each panel would expose a `draw(ctx, w, h, state): MenuAction | null`
function so `MainMenu` delegates to it.

### `src/gamestate.ts` (~1,731 lines)

`GameState` mixes entity management, territory/faction state, research, and
power state.  Suggested extractions:

1. **`src/researchState.ts`** — `ResearchProgress`, `researchedItems`,
   research-unlock helpers.
2. **`src/entityRegistry.ts`** — `addEntity`, `removeDeadEntities`,
   `allEntities`, `getEntitiesInRange`, indexed entity collections.
3. Move `DestroyedBuildingRecord` / `DestroyedConduitRecord` serialisation
   into `src/lan/protocol.ts` or a new `src/mapState.ts`.

### `src/actionmenu.ts` (~1,586 lines)

Already has clear internal class boundaries (`HoldMenu`, `PaintMenu`,
`LeftHoldMenu`, `ShipMenu`, `QuickBuildMenu`, `ActionMenu`).

1. **`src/quickBuildMenu.ts`** — Extract the `QuickBuildMenu` class (~410 lines).
2. **`src/paintMenu.ts`** — Extract `PaintMenu` (~115 lines).
3. **`src/holdMenu.ts`** — Extract `HoldMenu` and `LeftHoldMenu` (~270 lines).

### `src/enemybaseplanner.ts` (~1,729 lines)

Several AI sub-systems have already been extracted (`aibaseplan.ts`,
`aidoctrine.ts`, `airaids.ts`).  Remaining candidates:

1. **`src/enemyBaseRings.ts`** — Ring/spoke advancement logic
   (`maybeAdvanceRing`, `generateBastions`, ring conduit queuing).
2. **`src/enemyBaseBuilder.ts`** — `nextBuildingSlotOrder`, connector-conduit
   dispatch, `computeConnectorPath`.

3. **`src/enemyBaseDoctrineRuntime.ts`** - smart generator substitution,
   inner-ring backfill, protective wall enqueueing, and power-restoration audits.

### `src/projectile.ts` (~1,178 lines)

Contains ~12 distinct projectile classes.  Could be split by type:

1. **`src/projectileMissile.ts`** — `Missile`, `GuidedMissile`, `BomberMissile`,
   `SwarmMissile`, `SynonymousNovaBomb`.
2. **`src/projectileEnergy.ts`** — `Laser`, `SynonymousDroneLaser`,
   `ExciterBeam`, `ExciterBullet`, `ChargedLaserBurst`.
3. **`src/projectileBullet.ts`** — `Bullet`, `GatlingBullet`, `HomingBullet`,
   `MassDriverBullet`, `RegenBullet`, `FireBomb`.
4. Keep `ProjectileBase` and shared interfaces in `projectile.ts`.

---

## Guiding principles for future splits

- **Never scatter tuning constants** — keep them in `constants.ts` or the
  relevant `*Config` / `*Def` file.
- **Keep the 60 Hz loop clean** — extracted helpers must not add synchronous
  per-tick work beyond what they replaced.
- **Mouse-first UI** — all menus extracted from `menu.ts` must remain fully
  operable with mouse alone.
- **No circular imports** — use the established dependency direction:
  `constants → entities → math → gamestate → combat helpers → game`.
- **One bump per PR** — bump `src/version.ts BUILD_NUMBER` once when the PR
  lands; do not bump inside feature commits.
