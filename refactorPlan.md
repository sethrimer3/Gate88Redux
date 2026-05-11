# Gate88Redux — Refactor Plan

This document tracks monolithic source files and the recommended strategy for
splitting them into more focused modules.  Update this file whenever a
refactor is completed or a new large file is identified.

---

## Files over 2,000 lines (immediate priority)

| File | Lines | Status |
|------|-------|--------|
| `src/game.ts` | ~3,333 | 🔴 in progress |
| `src/menu.ts` | ~2,215 | 🔴 planned |
| `src/gamestate.ts` | ~1,731 | 🟡 planned |

## Files 1 000–2,000 lines (secondary priority)

| File | Lines | Status |
|------|-------|--------|
| `src/actionmenu.ts` | ~1,586 | 🟡 planned |
| `src/enemybaseplanner.ts` | ~1,463 | 🟡 partially done (see below) |
| `src/projectile.ts` | ~1,178 | 🟡 planned |

---

## Completed splits

### `src/game.ts` — Build 023 (this PR)

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

---

## Planned splits (not yet started)

### `src/game.ts` (remaining ~3,230 lines)

The `Game` class is the largest remaining monolith.  Suggested extractions
in rough priority order:

1. **`src/weaponFiring.ts`** (~250 lines)
   - `updatePlayerFiring`, `handleWeaponSpecial`, `handleGatlingSpecial`,
     `handleLaserSpecial`, `handleRocketSwarmSpecial`, `handleCannonHomingSpecial`,
     `fireSelectedPrimary`, `updateGuidedMissileControl`.
   - All need `state: GameState`, `hud: HUD`; a small `WeaponFiringCtx` value
     object can carry these together with `activeGuidedMissile`.
   - `activeGuidedMissile` is a `Game`-level field; the extracted functions
     can return the new missile reference so the `Game` can store it.

2. **`src/turretCombat.ts`** (~35 lines)
   - `updateLocalPlayerTurrets` → `fireTurretShots(state, localTeam)`.
   - Dependencies: `state.buildings`, `Audio.playSoundAt`, `state.addEntity`.

3. **`src/fighterCombat.ts`** (~55 lines)
   - `updatePlayerFighterCombat` →
     `updateFighterWeaponFire(state, spaceFluid)`.
   - Uses `damageLaserLineLimited` from `combatUtils.ts`.

4. **`src/commandMode.ts`** (~260 lines)
   - `updateCommandMode`, `updateNumberGroupHotkeys`,
     `updateNumberGroupTapOrders`, `updatePlayerFighterOrderTargets`.
   - Needs a `CommandModeCtx` carrying `state, camera, hud,
     commandSelectedFighters, commandSelectedTurrets,
     commandDragStart, commandDragCurrent, lastGroupTap`.

5. **`src/gameOverlays.ts`** (~300 lines)
   - `drawMergedWallOutlines`, `drawCommandModeOverlay`,
     `drawBuildingHoverHitpoints`, `drawGlowLayer`, `drawGhostSpectator`,
     `drawLossOverlay`, `drawScreenOverlays`.
   - Add to or extend `src/gameRender.ts`; pass an explicit context struct
     rather than accessing `this.*`.

6. **`src/fluidForces.ts`** (~80 lines)
   - `injectFluidForces` → `injectFluidForces(state, spaceFluid, player)`.

### `src/menu.ts` (~2,215 lines)

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

### `src/enemybaseplanner.ts` (~1,463 lines)

Several AI sub-systems have already been extracted (`aibaseplan.ts`,
`aidoctrine.ts`, `airaids.ts`).  Remaining candidates:

1. **`src/enemyBaseRings.ts`** — Ring/spoke advancement logic
   (`maybeAdvanceRing`, `generateBastions`, ring conduit queuing).
2. **`src/enemyBaseBuilder.ts`** — `nextBuildingSlotOrder`, connector-conduit
   dispatch, `computeConnectorPath`.

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
