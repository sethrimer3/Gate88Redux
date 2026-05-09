/**
 * Concentric-ring base planner for the Practice enemy — full architecture upgrade.
 *
 * The planner now operates in three distinct phases:
 *
 *   1. Plan generation (init + ring advance):
 *      Computes explicit conduit ring cells and spoke cells using geometry
 *      utilities from aibaseplan.ts. Assigns building slots within each ring
 *      according to the chosen doctrine. Plans are deterministic and seeded.
 *
 *   2. Build queue management (periodic replan):
 *      Prioritises spoke conduit → inner ring conduit → inner ring buildings →
 *      outer ring conduit → outer ring buildings. Uses AIScore to skip
 *      dangerously exposed building slots on lower difficulties.
 *
 *   3. Adaptive behavior (ongoing tracking):
 *      Records player actions (conduit cuts, builder kills, rushes) and adjusts
 *      spoke redundancy, escort behavior, and repair priority in response.
 *
 * Coordinator interface (used by VsAIDirector):
 *   getHighestPriorityDefensePoint()  — where to defend
 *   getActiveConstructionSites()      — current builder targets
 *   getWeakestRingSegment()           — most incomplete ring zone
 *   getSuggestedHarassTarget()        — best player asset to attack
 *   getCurrentDoctrine()              — active doctrine type
 *   getActiveRaidTarget()             — current raid objective position
 *
 * Performance notes:
 *   • Ring cells are computed once at init; only re-generated on ring advance.
 *   • Queue walk fires on a timer, not every tick.
 *   • AIScore uses lazy per-cell caching; only queried for building slots.
 *   • No grid-wide scans occur during normal play.
 */

import { Vec2 } from './math.js';
import { Team } from './entities.js';
import { GameState } from './gamestate.js';
import { BuildingBase, CommandPost, Shipyard, PowerGenerator, ResearchLab, Factory } from './building.js';
import { TurretBase } from './turret.js';
import { GRID_CELL_SIZE, cellCenter, cellKey } from './grid.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import { buildDefForEntityType, getBuildDef } from './builddefs.js';
import type { BuildDef } from './builddefs.js';
import { BuilderDrone, isBuilderDrone } from './builderdrone.js';
import type { BuildOrder } from './builderdrone.js';
import {
  PracticeConfig,
  difficultyIndex,
  difficultyTickMul,
} from './practiceconfig.js';
import {
  generateRingCells,
  generateRingBuildingSlots,
  generateSpokeCells,
  generateBastionLoop,
  traceLine,
  AI_RING_THICKNESS_CONDUITS,
  AI_RING_SPACING_CONDUITS,
  RingPlan,
  BastionPlan,
} from './aibaseplan.js';
import { DoctrineType, Doctrine, DOCTRINES, pickDoctrine } from './aidoctrine.js';
import { RaidPlanner } from './airaids.js';
import { AIScore, cellOf } from './aiscore.js';
import { isConfluenceFaction } from './confluence.js';
import { footprintForBuildingType } from './buildingfootprint.js';

// ---------------------------------------------------------------------------
// Public snapshot type
// ---------------------------------------------------------------------------

export interface PlannerSnapshot {
  currentRing: number;
  buildsPlaced: number;
  builderCount: number;
  queueSize: number;
  doctrine: DoctrineType;
  ringCount: number;
  /** Fraction of all ring conduit cells queued so far [0,1]. */
  conduitProgress: number;
}

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Maximum number of radial spokes regardless of doctrine or adaptive additions. */
const MAX_SPOKES = 8;
const AI_INNER_RING_RADIUS_CELLS = 7;
const AI_RING_STEP_CELLS = AI_RING_THICKNESS_CONDUITS + AI_RING_SPACING_CONDUITS;

/** 4-connected cardinal neighbour offsets for grid-neighbour operations. */
const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

// ---------------------------------------------------------------------------
// Internal: adaptive-behavior counters
// ---------------------------------------------------------------------------

interface AdaptiveStats {
  conduitCutsObserved: number;
  builderKillsObserved: number;
  commandPostRushes: number;
  lastBuilderKillTime: number;
}

// ---------------------------------------------------------------------------
// EnemyBasePlanner
// ---------------------------------------------------------------------------

export class EnemyBasePlanner {
  readonly team: Team;
  readonly config: PracticeConfig;

  /** Command Post grid cell — center of all ring geometry. */
  private centerCx: number = 0;
  private centerCy: number = 0;
  /** Deterministic seed. Ring geometry is reproducible within a match. */
  private readonly seed: number;

  // -- Doctrine ---------------------------------------------------------------

  private doctrineType: DoctrineType;
  private doctrine: Doctrine;

  // -- Plan state -------------------------------------------------------------

  private rings: RingPlan[] = [];
  /** Spoke paths: one array of cells per spoke, ordered center → outer. */
  private spokes: Array<Array<{ cx: number; cy: number }>> = [];
  /** Per-spoke queue pointer: how many cells have been issued as orders. */
  private spokeQueuePtrs: number[] = [];
  /** Forward bastions (Raider / Adaptive only). */
  private bastions: BastionPlan[] = [];
  /** Ring currently being filled. */
  private currentRing: number = 0;
  /** Total build completions since init. */
  buildsPlaced: number = 0;
  /** Additional spokes added by adaptive behavior. */
  private extraSpokes: number = 0;

  // -- Queue + claimed sets ---------------------------------------------------

  /** Pending build orders to dispatch to idle builders. */
  private queue: BuildOrder[] = [];
  /** Keys of conduit cells that have been queued (avoids double-queuing). */
  private claimedConduitKeys: Set<string> = new Set();
  /** Keys of building cells that have been queued (avoids double-queuing). */
  private claimedBuildingKeys: Set<string> = new Set();
  /** Cells reserved by queued or active AI build orders. */
  private reservedCells: Set<string> = new Set();

  // -- Timers -----------------------------------------------------------------

  private tickTimer: number = 0;
  private auditTimer: number = 0;
  private rebuildTimers: number[] = [];
  /** Accumulates time (seconds) since the last ring advancement attempt. */
  private ringAdvanceStuckTimer: number = 0;

  // -- Subsystems -------------------------------------------------------------

  builders: BuilderDrone[] = [];
  private raidPlanner: RaidPlanner = new RaidPlanner();
  private aiScore: AIScore = new AIScore();

  // -- Adaptive state ---------------------------------------------------------

  private adaptive: AdaptiveStats = {
    conduitCutsObserved: 0,
    builderKillsObserved: 0,
    commandPostRushes: 0,
    lastBuilderKillTime: -9999,
  };

  private usesConduits(state: GameState): boolean {
    return !isConfluenceFaction(state.factionByTeam, this.team);
  }

  constructor(team: Team, config: PracticeConfig, seed: number = 1337) {
    this.team = team;
    this.config = config;
    this.seed = seed;
    this.doctrineType = pickDoctrine(seed);
    this.doctrine = DOCTRINES[this.doctrineType];
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  /**
   * Seed the base: plant the initial conduit cross, generate the full ring
   * plan, and spawn the first builder drone.
   */
  init(state: GameState, cp: CommandPost): void {
    const c = cellOf(cp.position);
    this.centerCx = c.cx;
    this.centerCy = c.cy;

    if (this.usesConduits(state)) {
      const initCells: Array<[number, number]> = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of initCells) {
        const cx = this.centerCx + dx;
        const cy = this.centerCy + dy;
        state.grid.addConduit(cx, cy, this.team);
        this.claimedConduitKeys.add(cellKey(cx, cy));
      }
      state.power.markDirty();
    }

    this.generatePlan();
    this.replanQueue(state);
    this.spawnBuilder(state, cp);
  }

  // ---------------------------------------------------------------------------
  // Plan generation
  // ---------------------------------------------------------------------------

  /**
   * Compute ring conduit loops, spoke paths, and building slot positions from
   * the active doctrine and seed. Safe to call again when parameters change
   * (e.g., extra spokes from adaptive behavior).
   */
  private generatePlan(): void {
    const idx  = difficultyIndex(this.config.difficulty);
    const recipes = this.doctrine.ringRecipes;
    const gapProb  = this.doctrine.gapProbPerDifficulty[idx];
    const numSpokes = Math.min(
      this.doctrine.spokesPerDifficulty[idx] + this.extraSpokes,
      MAX_SPOKES,
    );
    const outerRadius = this.ringRadiusForIndex(Math.max(0, recipes.length - 1));

    // --- Rings ---------------------------------------------------------------
    const prevRings = this.rings;
    this.rings = [];
    for (let r = 0; r < recipes.length; r++) {
      const recipe = recipes[r];
      const radiusCells = this.ringRadiusForIndex(r);
      // Use ~π × radius angular slots for a smooth ring.
      const numSlots = Math.max(16, Math.round(Math.PI * radiusCells));
      const conduitCells = generateRingCells(
        this.centerCx, this.centerCy,
        radiusCells, numSlots, gapProb,
        this.seed + r * 100,
        AI_RING_THICKNESS_CONDUITS,
      );
      const rawSlots = generateRingBuildingSlots(
        this.centerCx, this.centerCy,
        radiusCells, recipe, conduitCells,
        this.seed + r * 100 + 50,
      );
      const buildingSlots = rawSlots.map((s) => ({
        ...s,
        queued: false,
        placed: false,
        connectorCells: [] as Array<{ cx: number; cy: number }>,
        connectorQueuePtr: -1, // -1 = candidate not yet found
      }));

      // Preserve queue pointer from a previous plan if this ring already existed.
      const prev = prevRings[r];
      const conduitQueuePtr = prev ? Math.min(prev.conduitQueuePtr, conduitCells.length) : 0;

      this.rings.push({
        ringIndex: r,
        radiusCells,
        role: recipe.role,
        conduitCells,
        conduitQueuePtr,
        buildingSlots,
      });
    }

    // --- Spokes --------------------------------------------------------------
    const prevPtrs = this.spokeQueuePtrs.slice();
    this.spokes = generateSpokeCells(
      this.centerCx, this.centerCy,
      outerRadius, numSpokes, this.seed + 1000,
    );
    this.spokeQueuePtrs = this.spokes.map((_, i) => prevPtrs[i] ?? 0);

    // --- Bastions (Raider / Adaptive doctrine) --------------------------------
    if (this.doctrine.useForwardBastions && this.bastions.length === 0) {
      this.generateBastions(outerRadius);
    }
  }

  private generateBastions(outerRadius: number): void {
    const idx = difficultyIndex(this.config.difficulty);
    const count = 1 + idx; // Easy=1, Nightmare=5
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.seed * 0.001 + i * 0.5;
      const dist  = outerRadius + 5;
      const anchorCx = this.centerCx + Math.round(Math.cos(angle) * dist);
      const anchorCy = this.centerCy + Math.round(Math.sin(angle) * dist);
      const loop  = generateBastionLoop(anchorCx, anchorCy, this.seed + 2000 + i);

      this.bastions.push({
        anchorCx, anchorCy,
        conduitCells: loop,
        conduitQueuePtr: 0,
        generatorSlot: { cx: anchorCx, cy: anchorCy - 2 },
        turretSlots: [
          { cx: anchorCx + 2, cy: anchorCy, queued: false, placed: false },
          { cx: anchorCx - 2, cy: anchorCy, queued: false, placed: false },
        ],
        spokeBackCells: [],
        status: 'planned',
      });
    }
  }

  private ringRadiusForIndex(index: number): number {
    return AI_INNER_RING_RADIUS_CELLS + index * AI_RING_STEP_CELLS;
  }

  // ---------------------------------------------------------------------------
  // Per-tick update
  // ---------------------------------------------------------------------------

  update(state: GameState, cp: CommandPost, dt: number): void {
    // 1. Builder lifecycle.
    this.processBuilderRebuilds(state, cp, dt);
    this.assignRepairTargets(state);
    this.dispatchIdleBuilders();
    this.collectFinishedBuilds(state);

    // 2. Adaptive counters.
    this.updateAdaptive(state);

    // 3. Raid planner.
    this.raidPlanner.update(state, dt, this.doctrineType, this.config.difficulty);

    // 4. Periodic replan.
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = this.basePlannerInterval();
      this.maybeAdvanceRing(state);
      this.replanQueue(state);
    }
  }

  // ---------------------------------------------------------------------------
  // Adaptive behavior
  // ---------------------------------------------------------------------------

  private updateAdaptive(state: GameState): void {
    this.auditTimer -= 1;
    if (this.auditTimer <= 0) {
      this.auditTimer = Math.max(45, 120 - difficultyIndex(this.config.difficulty) * 15);
      this.auditConstructionState(state);
    }

    // Track builder attrition.
    const aliveCount = this.builders.filter((b) => b.alive).length;
    const expected   = this.config.enemyMaxBuilders;
    if (aliveCount < expected - this.adaptive.builderKillsObserved) {
      this.adaptive.builderKillsObserved++;
      this.adaptive.lastBuilderKillTime = state.gameTime;
    }

    // Track Command Post rushes.
    const cp = state.getEnemyCommandPost();
    if (cp && state.player.alive) {
      if (state.player.position.distanceTo(cp.position) < GRID_CELL_SIZE * 10) {
        this.adaptive.commandPostRushes++;
      }
    }

    // Adaptive doctrine: add redundant spokes if player keeps cutting conduits.
    if (this.doctrineType === 'adaptive'
        && this.adaptive.conduitCutsObserved > 3
        && this.extraSpokes < 2) {
      this.extraSpokes++;
      this.generatePlan();
      this.claimedConduitKeys.clear();
      this.claimedBuildingKeys.clear();
    }
  }

  private auditConstructionState(state: GameState): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const order = this.queue[i];
      const valid = order.kind === 'conduit'
        ? state.isConduitPlacementCellClear(order.cx, order.cy).valid || state.grid.hasConduit(order.cx, order.cy)
        : state.getStructureFootprintStatus(order.def, order.cx, order.cy).valid;
      if (!valid) {
        this.releaseOrderReservation(order);
        this.queue.splice(i, 1);
      }
    }
  }

  /** Called by PracticeMode when the player destroys an enemy conduit. */
  notifyConduitDestroyed(pos: Vec2): void {
    this.adaptive.conduitCutsObserved++;
    this.raidPlanner.notifyStructureDestroyed(pos);
  }

  /** Called by PracticeMode when the player destroys an enemy building. */
  notifyBuildingDestroyed(pos: Vec2): void {
    this.raidPlanner.notifyStructureDestroyed(pos);
    // Unclaim the building cell so it can be re-planned.
    const cx = Math.floor(pos.x / GRID_CELL_SIZE);
    const cy = Math.floor(pos.y / GRID_CELL_SIZE);
    this.claimedBuildingKeys.delete(cellKey(cx, cy));
    for (const [dx, dy] of CARDINAL_OFFSETS) {
      this.claimedBuildingKeys.delete(cellKey(cx + dx, cy + dy));
    }
    // Reset queued flags so the slot can be re-issued.
    for (const ring of this.rings) {
      for (const slot of ring.buildingSlots) {
        if (Math.abs(slot.cx - cx) <= 1 && Math.abs(slot.cy - cy) <= 1) {
          slot.queued = false;
          slot.placed = false;
          slot.connectorCells = [];
          slot.connectorQueuePtr = -1;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ring advancement
  // ---------------------------------------------------------------------------

  private maybeAdvanceRing(state: GameState): void {
    if (this.currentRing >= this.rings.length - 1) return;
    const ring = this.rings[this.currentRing];
    const idx = difficultyIndex(this.config.difficulty);
    const interval = this.basePlannerInterval();

    // Count conduit cells that are actually placed in the grid.
    const totalConduit = ring.conduitCells.length;
    if (totalConduit === 0) {
      this.ringAdvanceStuckTimer = 0;
      this.currentRing++;
      return;
    }
    let placedConduit = 0;
    for (const cell of ring.conduitCells) {
      if (state.grid.hasConduit(cell.cx, cell.cy)) placedConduit++;
    }
    const conduitFrac = placedConduit / totalConduit;

    // Count building slots that are actually placed.
    const slots = ring.buildingSlots;
    const buildingFrac = slots.length > 0
      ? slots.filter((s) => s.placed).length / slots.length
      : 1.0;

    // Thresholds scale with difficulty: higher difficulty → more complete ring
    // required before expanding.  Conduit completion is weighted more heavily
    // because unpowered rings waste build effort.
    const reqConduit  = [0.45, 0.55, 0.65, 0.75, 0.85][idx];
    const reqBuilding = [0.20, 0.30, 0.40, 0.50, 0.60][idx];
    const ready = conduitFrac >= reqConduit && buildingFrac >= reqBuilding;

    if (!ready) {
      // Stuck-safety: if the ring is stalling (blocked slots, map edge, etc.)
      // force-advance after ~90 s so the outer rings still get built.
      this.ringAdvanceStuckTimer += interval;
      const STUCK_THRESHOLD = 90;
      if (this.ringAdvanceStuckTimer < STUCK_THRESHOLD) return;
    }

    this.ringAdvanceStuckTimer = 0;
    const center = cellCenter(this.centerCx, this.centerCy);
    const worldR  = ring.radiusCells * GRID_CELL_SIZE;
    state.ringEffects.spawnPowerWave(
      center,
      Math.max(40, worldR - GRID_CELL_SIZE),
      worldR + GRID_CELL_SIZE * 2,
      1.6,
      1.0 + 0.15 * idx,
    );
    this.currentRing++;
  }

  // ---------------------------------------------------------------------------
  // Build queue management
  // ---------------------------------------------------------------------------

  private basePlannerInterval(): number {
    return Math.max(0.6, 4.0 / difficultyTickMul(this.config.difficulty));
  }

  /**
   * Fill the queue with the next highest-priority build orders.
   *
   * Ordering (highest to lowest):
   *   1. Spoke conduit cells (inner → outer), all spokes in parallel.
   *   2. Ring conduit cells for the current ring (inner → outer).
   *   3. Building slots for the current ring.
   *   4. Conduit and buildings for already-completed rings (infill).
   *   5. Bastion construction (Raider / Adaptive, Hard+).
   */
  private replanQueue(state: GameState): void {
    const TARGET = 5 + difficultyIndex(this.config.difficulty);
    while (this.queue.length < TARGET) {
      const order = this.nextBuildOrder(state);
      if (!order) break;
      this.queue.push(order);
    }
  }

  private nextBuildOrder(state: GameState): BuildOrder | null {
    const useConduits = this.usesConduits(state);
    // --- 1. Spoke cells — build inner cells first so power reaches rings early.
    for (let si = 0; useConduits && si < this.spokes.length; si++) {
      const spoke = this.spokes[si];
      let ptr = this.spokeQueuePtrs[si];
      // Advance past cells already laid.
      while (ptr < spoke.length) {
        const cell = spoke[ptr];
        const k = cellKey(cell.cx, cell.cy);
        if (state.grid.hasConduit(cell.cx, cell.cy) || this.claimedConduitKeys.has(k)) {
          this.claimedConduitKeys.add(k);
          ptr++;
        } else {
          break;
        }
      }
      this.spokeQueuePtrs[si] = ptr;

      if (ptr < spoke.length) {
        const cell = spoke[ptr];
        const k = cellKey(cell.cx, cell.cy);
        if (!this.canAIPlaceConduit(state, cell.cx, cell.cy)) {
          this.spokeQueuePtrs[si]++;
          continue;
        }
        this.claimedConduitKeys.add(k);
        this.reserveCells([{ cx: cell.cx, cy: cell.cy }]);
        this.spokeQueuePtrs[si]++;
        return { kind: 'conduit', cx: cell.cx, cy: cell.cy };
      }
    }

    // --- 2 + 4. Ring conduit cells -------------------------------------------
    for (let r = 0; useConduits && r <= this.currentRing && r < this.rings.length; r++) {
      const order = this.nextRingConduitOrder(state, this.rings[r]);
      if (order) return order;
    }

    // --- 3 + 4. Ring building slots ------------------------------------------
    for (let r = 0; r <= this.currentRing && r < this.rings.length; r++) {
      const order = this.nextBuildingSlotOrder(state, this.rings[r]);
      if (order) return order;
    }

    // --- 5. Bastion construction (Hard+) ------------------------------------
    if (this.bastions.length > 0 && difficultyIndex(this.config.difficulty) >= 2) {
      return this.nextBastionOrder(state);
    }

    return null;
  }

  private nextRingConduitOrder(
    state: GameState, ring: RingPlan,
  ): BuildOrder | null {
    while (ring.conduitQueuePtr < ring.conduitCells.length) {
      const cell = ring.conduitCells[ring.conduitQueuePtr];
      ring.conduitQueuePtr++;
      const k = cellKey(cell.cx, cell.cy);
      if (this.claimedConduitKeys.has(k)) continue;
      if (state.grid.hasConduit(cell.cx, cell.cy)) {
        this.claimedConduitKeys.add(k); continue;
      }
      if (!this.canAIPlaceConduit(state, cell.cx, cell.cy)) continue;
      this.claimedConduitKeys.add(k);
      this.reserveCells([{ cx: cell.cx, cy: cell.cy }]);
      return { kind: 'conduit', cx: cell.cx, cy: cell.cy };
    }
    return null;
  }

  private nextBuildingSlotOrder(
    state: GameState, ring: RingPlan,
  ): BuildOrder | null {
    for (const slot of ring.buildingSlots) {
      if (slot.placed) continue;

      const def = getBuildDef(slot.buildingKey);
      if (!def) { slot.queued = true; continue; }

      // --- Phase A: dispatch pending connector conduits first ---
      if (slot.connectorQueuePtr >= 0) {
        while (slot.connectorQueuePtr < slot.connectorCells.length) {
          const cell = slot.connectorCells[slot.connectorQueuePtr];
          slot.connectorQueuePtr++;
          const k = cellKey(cell.cx, cell.cy);
          if (this.claimedConduitKeys.has(k) || state.grid.hasConduit(cell.cx, cell.cy)) {
            this.claimedConduitKeys.add(k);
            continue;
          }
          if (!this.canAIPlaceConduit(state, cell.cx, cell.cy)) continue;
          this.claimedConduitKeys.add(k);
          this.reserveCells([cell]);
          return { kind: 'conduit', cx: cell.cx, cy: cell.cy };
        }
        // All connectors done; fall through to dispatch the building order.
      }

      // --- Phase B: dispatch the building order ---
      if (slot.queued) continue; // already dispatched

      // If candidate position has not been found yet, find it now.
      if (slot.connectorQueuePtr < 0) {
        const candidate = this.findBestBuildingCell(state, slot.cx, slot.cy, def, ring);
        if (!candidate) continue;

        // On lower difficulties, avoid building in hostile fire zones.
        if (difficultyIndex(this.config.difficulty) < 3) {
          const threat = this.aiScore.threatAt(state, this.team, candidate.cx, candidate.cy);
          if (threat > 55) continue;
        }

        // Lock candidate and compute connector path.
        slot.cx = candidate.cx;
        slot.cy = candidate.cy;
        this.claimedBuildingKeys.add(cellKey(candidate.cx, candidate.cy));
        this.reserveBuildingFootprint(def, candidate.cx, candidate.cy);
        slot.connectorCells = this.computeConnectorPath(state, candidate.cx, candidate.cy, def, ring);
        slot.connectorQueuePtr = 0;

        // Dispatch first connector if any (subsequent ones come via Phase A).
        while (slot.connectorQueuePtr < slot.connectorCells.length) {
          const cell = slot.connectorCells[slot.connectorQueuePtr];
          slot.connectorQueuePtr++;
          const k = cellKey(cell.cx, cell.cy);
          if (this.claimedConduitKeys.has(k) || state.grid.hasConduit(cell.cx, cell.cy)) {
            this.claimedConduitKeys.add(k);
            continue;
          }
          if (!this.canAIPlaceConduit(state, cell.cx, cell.cy)) continue;
          this.claimedConduitKeys.add(k);
          this.reserveCells([cell]);
          return { kind: 'conduit', cx: cell.cx, cy: cell.cy };
        }
        // No connectors needed — fall through to building dispatch immediately.
      }

      // Validate footprint one more time before dispatching.
      if (!state.getStructureFootprintStatus(def, slot.cx, slot.cy).valid) continue;

      slot.queued = true;
      return { kind: 'building', cx: slot.cx, cy: slot.cy, def, layConduitFirst: false };
    }
    return null;
  }

  /**
   * Compute a short 4-connected conduit path from the nearest planned or
   * active conduit cell to the building footprint's border.
   *
   * Returns an empty array if the building is already adjacent to power
   * (no gap to bridge), or if the nearest conduit is too far away (> 5 cells).
   * The anchor conduit cell itself is excluded from the result (already
   * planned/built).  Cells that fall inside the building footprint are also
   * excluded.
   */
  private computeConnectorPath(
    state: GameState,
    cx: number, cy: number,
    def: BuildDef,
    ring: RingPlan,
  ): Array<{ cx: number; cy: number }> {
    const fp = def.footprintCells;
    const originCx = cx - Math.floor(fp / 2);
    const originCy = cy - Math.floor(fp / 2);

    // Collect border cells (one cell outside the footprint on every side).
    const borderCells: Array<{ cx: number; cy: number }> = [];
    for (let bx = originCx - 1; bx <= originCx + fp; bx++) {
      borderCells.push({ cx: bx, cy: originCy - 1 });
      borderCells.push({ cx: bx, cy: originCy + fp });
    }
    for (let by = originCy; by < originCy + fp; by++) {
      borderCells.push({ cx: originCx - 1, cy: by });
      borderCells.push({ cx: originCx + fp, cy: by });
    }

    // Find nearest claimed conduit cell to any border cell.
    let nearestConduit: { cx: number; cy: number } | null = null;
    let nearestBorder: { cx: number; cy: number } | null = null;
    let nearestDist = Infinity;

    const searchCells = [...ring.conduitCells, ...this.spokes.flat()];
    for (const rc of searchCells) {
      const k = cellKey(rc.cx, rc.cy);
      if (!this.claimedConduitKeys.has(k) && !state.grid.hasConduit(rc.cx, rc.cy)) continue;
      for (const bc of borderCells) {
        const d = Math.abs(rc.cx - bc.cx) + Math.abs(rc.cy - bc.cy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestConduit = rc;
          nearestBorder = bc;
        }
      }
    }

    // No connector needed if already adjacent or too far to bridge sensibly.
    if (!nearestConduit || !nearestBorder || nearestDist <= 1 || nearestDist > 5) {
      return [];
    }

    // Generate 4-connected path; skip anchor and cells inside footprint.
    const fullPath = traceLine(
      nearestConduit.cx, nearestConduit.cy,
      nearestBorder.cx, nearestBorder.cy,
    );
    const result: Array<{ cx: number; cy: number }> = [];
    for (const cell of fullPath.slice(1)) {
      if (cell.cx >= originCx && cell.cx < originCx + fp &&
          cell.cy >= originCy && cell.cy < originCy + fp) break;
      result.push(cell);
    }
    return result;
  }
  private nextBastionOrder(state: GameState): BuildOrder | null {
    for (const bastion of this.bastions) {
      if (bastion.status === 'abandoned') continue;

      // Conduit loop first.
      if (this.usesConduits(state)) {
        const conduitOrder = this.nextBastionConduitOrder(state, bastion);
        if (conduitOrder) return conduitOrder;
      }

      // Generator.
      if (bastion.generatorSlot) {
        const gs = bastion.generatorSlot;
        const k = cellKey(gs.cx, gs.cy);
        if (!this.claimedBuildingKeys.has(k)) {
          const def = getBuildDef('powergenerator');
          if (def && this.canAIPlaceStructure(state, def, gs.cx, gs.cy)) {
            this.claimedBuildingKeys.add(k);
            this.reserveBuildingFootprint(def, gs.cx, gs.cy);
            if (bastion.status === 'planned') bastion.status = 'constructing';
            return { kind: 'building', cx: gs.cx, cy: gs.cy, def, layConduitFirst: false };
          }
        }
      }

      // Turrets.
      for (const ts of bastion.turretSlots) {
        if (ts.queued || ts.placed) continue;
        const def = getBuildDef('missileturret');
        if (!def) continue;
        const k = cellKey(ts.cx, ts.cy);
        if (this.claimedBuildingKeys.has(k)) continue;
        if (!this.canAIPlaceStructure(state, def, ts.cx, ts.cy)) continue;
        ts.queued = true;
        this.claimedBuildingKeys.add(k);
        this.reserveBuildingFootprint(def, ts.cx, ts.cy);
        return { kind: 'building', cx: ts.cx, cy: ts.cy, def, layConduitFirst: false };
      }
    }
    return null;
  }

  private nextBastionConduitOrder(
    state: GameState, bastion: BastionPlan,
  ): BuildOrder | null {
    while (bastion.conduitQueuePtr < bastion.conduitCells.length) {
      const cell = bastion.conduitCells[bastion.conduitQueuePtr];
      bastion.conduitQueuePtr++;
      const k = cellKey(cell.cx, cell.cy);
      if (this.claimedConduitKeys.has(k)) continue;
      if (state.grid.hasConduit(cell.cx, cell.cy)) {
        this.claimedConduitKeys.add(k); continue;
      }
      if (!this.canAIPlaceConduit(state, cell.cx, cell.cy)) continue;
      this.claimedConduitKeys.add(k);
      this.reserveCells([{ cx: cell.cx, cy: cell.cy }]);
      if (bastion.status === 'planned') bastion.status = 'constructing';
      return { kind: 'conduit', cx: cell.cx, cy: cell.cy };
    }
    return null;
  }

  private isCellInBounds(_state: GameState, cx: number, cy: number): boolean {
    const x = (cx + 0.5) * GRID_CELL_SIZE;
    const y = (cy + 0.5) * GRID_CELL_SIZE;
    return x > 0 && x < WORLD_WIDTH && y > 0 && y < WORLD_HEIGHT;
  }

  private canAIPlaceConduit(state: GameState, cx: number, cy: number): boolean {
    if (this.reservedCells.has(cellKey(cx, cy))) return false;
    return state.isConduitPlacementCellClear(cx, cy).valid;
  }

  private canAIPlaceStructure(state: GameState, def: BuildDef, cx: number, cy: number): boolean {
    const origin = { cx: cx - Math.floor(def.footprintCells / 2), cy: cy - Math.floor(def.footprintCells / 2) };
    for (let y = origin.cy; y < origin.cy + def.footprintCells; y++) {
      for (let x = origin.cx; x < origin.cx + def.footprintCells; x++) {
        if (this.reservedCells.has(cellKey(x, y))) return false;
      }
    }
    if (!state.getStructureFootprintStatus(def, cx, cy).valid) return false;
    if (!this.usesConduits(state)) return true;
    return this.isNearPlannedPower(state, origin.cx, origin.cy, def.footprintCells);
  }

  private findBestBuildingCell(
    state: GameState,
    preferredCx: number,
    preferredCy: number,
    def: BuildDef,
    ring: RingPlan,
  ): { cx: number; cy: number } | null {
    let best: { cx: number; cy: number; score: number } | null = null;
    const angle = Math.atan2(preferredCy - this.centerCy, preferredCx - this.centerCx);
    // Place buildings just outside the ring conduit band so their inner
    // footprint border is adjacent to the ring outer edge.  This guarantees
    // that isNearPlannedPower passes without requiring extra connector cells.
    //   minOffset = floor(fp/2) + ring_thickness
    // For fp=3: minOffset=3  → footprint at R+2..R+4, border at R+1 ✓
    // For fp=4: minOffset=4  → footprint at R+2..R+5, border at R+1 ✓
    const minOffset = Math.floor(def.footprintCells / 2) + AI_RING_THICKNESS_CONDUITS;
    for (let radial = minOffset; radial <= minOffset + 5; radial++) {
      for (let tangent = -6; tangent <= 6; tangent++) {
        const cx = this.centerCx + Math.round(Math.cos(angle) * (ring.radiusCells + radial) - Math.sin(angle) * tangent);
        const cy = this.centerCy + Math.round(Math.sin(angle) * (ring.radiusCells + radial) + Math.cos(angle) * tangent);
        if (this.claimedBuildingKeys.has(cellKey(cx, cy))) continue;
        if (!this.canAIPlaceStructure(state, def, cx, cy)) continue;
        const threat = this.aiScore.threatAt(state, this.team, cx, cy);
        const spacingPenalty = this.nearbyFriendlyBuildingCount(state, cx, cy, 7) * 20;
        const score = -Math.abs(tangent) * 3 - radial - threat - spacingPenalty;
        if (!best || score > best.score) best = { cx, cy, score };
      }
    }
    return best ? { cx: best.cx, cy: best.cy } : null;
  }

  private nearbyFriendlyBuildingCount(state: GameState, cx: number, cy: number, radiusCells: number): number {
    let count = 0;
    const r2 = radiusCells * radiusCells;
    for (const b of state.buildings) {
      if (!b.alive || b.team !== this.team) continue;
      const bx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const by = Math.floor(b.position.y / GRID_CELL_SIZE);
      const dx = bx - cx;
      const dy = by - cy;
      if (dx * dx + dy * dy <= r2) count++;
    }
    return count;
  }

  private isNearPlannedPower(state: GameState, originCx: number, originCy: number, size: number): boolean {
    for (let y = originCy - 1; y <= originCy + size; y++) {
      for (let x = originCx - 1; x <= originCx + size; x++) {
        const border = x === originCx - 1 || x === originCx + size || y === originCy - 1 || y === originCy + size;
        if (!border) continue;
        const k = cellKey(x, y);
        if (this.claimedConduitKeys.has(k)) return true;
        if (state.grid.conduitTeam(x, y) === this.team) return true;
        if (state.power.isCellEnergized(this.team, x, y)) return true;
      }
    }
    return false;
  }

  private reserveBuildingFootprint(def: BuildDef, cx: number, cy: number): void {
    const origin = { cx: cx - Math.floor(def.footprintCells / 2), cy: cy - Math.floor(def.footprintCells / 2) };
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let y = origin.cy; y < origin.cy + def.footprintCells; y++) {
      for (let x = origin.cx; x < origin.cx + def.footprintCells; x++) cells.push({ cx: x, cy: y });
    }
    this.reserveCells(cells);
  }

  private reserveCells(cells: Array<{ cx: number; cy: number }>): void {
    for (const c of cells) this.reservedCells.add(cellKey(c.cx, c.cy));
  }

  private releaseOrderReservation(order: BuildOrder): void {
    if (order.kind === 'conduit') {
      this.reservedCells.delete(cellKey(order.cx, order.cy));
      return;
    }
    const origin = { cx: order.cx - Math.floor(order.def.footprintCells / 2), cy: order.cy - Math.floor(order.def.footprintCells / 2) };
    for (let y = origin.cy; y < origin.cy + order.def.footprintCells; y++) {
      for (let x = origin.cx; x < origin.cx + order.def.footprintCells; x++) {
        this.reservedCells.delete(cellKey(x, y));
      }
    }
  }

  private releasePlacedBuildingReservation(ent: BuildingBase, cx: number, cy: number): void {
    const size = footprintForBuildingType(ent.type);
    const origin = { cx: cx - Math.floor(size / 2), cy: cy - Math.floor(size / 2) };
    for (let y = origin.cy; y < origin.cy + size; y++) {
      for (let x = origin.cx; x < origin.cx + size; x++) {
        this.reservedCells.delete(cellKey(x, y));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Builder management
  // ---------------------------------------------------------------------------

  private assignRepairTargets(state: GameState): void {
    const damaged: BuildingBase[] = [];
    for (const b of state.buildings) {
      if (!b.alive || b.team !== this.team) continue;
      if (b.buildProgress < 1) continue;
      if (b.healthFraction >= 0.99) continue;
      damaged.push(b);
    }

    if (damaged.length === 0) {
      for (const b of this.builders) {
        if (b.mode === 'repair') { b.repairTarget = null; b.mode = 'build'; }
      }
      return;
    }

    const priorityOf = (b: BuildingBase): number => {
      if (b instanceof PowerGenerator) return 0;
      if (b instanceof CommandPost)    return 1;
      if (b instanceof Shipyard)       return 2;
      if (b instanceof TurretBase)     return 3;
      if (b instanceof ResearchLab)    return 4;
      if (b instanceof Factory)        return 4;
      return 5;
    };
    damaged.sort((a, b) => {
      const pa = priorityOf(a), pb = priorityOf(b);
      return pa !== pb ? pa - pb : a.healthFraction - b.healthFraction;
    });

    const claimed = new Set<number>();
    for (const drone of this.builders) {
      if (drone.mode === 'repair' && drone.repairTarget?.alive
          && drone.repairTarget.healthFraction < 0.99) {
        claimed.add(drone.repairTarget.id);
      }
    }

    const idx = difficultyIndex(this.config.difficulty);
    const maxRepairers = Math.max(1, Math.floor(
      this.builders.length * [0.4, 0.5, 0.6, 0.7, 0.8][idx],
    ));
    const currentRepairers = this.builders.filter((b) => b.mode === 'repair' && b.alive).length;

    let promotions = maxRepairers - currentRepairers;
    for (const drone of this.builders) {
      if (promotions <= 0) break;
      if (!drone.alive || drone.isBuilding || drone.mode === 'repair') continue;
      const target = damaged.find((b) => !claimed.has(b.id));
      if (!target) break;
      drone.mode = 'repair';
      drone.repairTarget = target;
      if (drone.buildOrder) {
        this.queue.unshift(drone.buildOrder);
        drone.buildOrder = null;
      }
      claimed.add(target.id);
      promotions--;
    }

    for (const drone of this.builders) {
      if (drone.mode !== 'repair') continue;
      const t = drone.repairTarget;
      if (!t || !t.alive || t.healthFraction >= 0.99) {
        drone.mode = 'build';
        drone.repairTarget = null;
      }
    }
  }

  private dispatchIdleBuilders(): void {
    if (this.queue.length === 0) return;
    for (const b of this.builders) {
      if (!b.alive || b.mode === 'repair' || b.buildOrder || b.isBuilding) continue;
      const order = this.queue.shift();
      if (!order) return;
      b.buildOrder = order;
    }
  }

  private collectFinishedBuilds(state: GameState): void {
    for (const b of this.builders) {
      if (!b.alive) continue;
      const result = b.consumeFinishedBuild();
      if (!result) continue;

      if (result.kind === 'conduit') {
        this.reservedCells.delete(cellKey(result.cx, result.cy));
        if (state.isConduitPlacementCellClear(result.cx, result.cy).valid) {
          state.grid.addConduit(result.cx, result.cy, this.team);
        } else if (!state.grid.hasConduit(result.cx, result.cy)) {
          this.claimedConduitKeys.delete(cellKey(result.cx, result.cy));
        }
        state.power.markDirty();
      } else {
        this.releasePlacedBuildingReservation(result.ent, result.cx, result.cy);
        const def = buildDefForEntityType(result.ent.type);
        if (!def || !state.getStructureFootprintStatus(def, result.cx, result.cy).valid) continue;
        state.addEntity(result.ent);
        state.applyConfluencePlacement(this.team, result.ent.position, String(result.ent.id));
        this.buildsPlaced++;
        state.recentEnemyConstructions.push({
          pos: result.ent.position.clone(),
          time: state.gameTime,
        });
        state.power.markDirty();
        this.markBuildingPlaced(result.cx, result.cy);
      }
    }
  }

  private markBuildingPlaced(cx: number, cy: number): void {
    const k = cellKey(cx, cy);
    for (const ring of this.rings) {
      for (const slot of ring.buildingSlots) {
        if (cellKey(slot.cx, slot.cy) === k) {
          slot.placed = true;
          slot.queued = true;
          return;
        }
      }
    }
    for (const bastion of this.bastions) {
      if (bastion.generatorSlot
          && cellKey(bastion.generatorSlot.cx, bastion.generatorSlot.cy) === k) {
        return;
      }
      for (const ts of bastion.turretSlots) {
        if (cellKey(ts.cx, ts.cy) === k) {
          ts.placed = true;
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Builder lifecycle
  // ---------------------------------------------------------------------------

  livingBuilders(): number {
    this.builders = this.builders.filter((b) => b.alive);
    return this.builders.length;
  }

  private processBuilderRebuilds(state: GameState, cp: CommandPost, dt: number): void {
    for (const b of this.builders) {
      if (!b.alive && b.buildOrder) this.releaseOrderReservation(b.buildOrder);
    }
    this.builders = this.builders.filter((b) => b.alive);
    const wanted = this.config.enemyMaxBuilders - this.builders.length;

    while (this.rebuildTimers.length < wanted) this.rebuildTimers.push(this.config.enemyBuilderRebuildSeconds);
    while (this.rebuildTimers.length > wanted) this.rebuildTimers.pop();

    for (let i = 0; i < this.rebuildTimers.length; i++) {
      this.rebuildTimers[i] -= dt;
      if (this.rebuildTimers[i] <= 0) {
        this.spawnBuilder(state, cp);
        this.rebuildTimers[i] = this.config.enemyBuilderRebuildSeconds;
      }
    }
  }

  private spawnBuilder(state: GameState, cp: CommandPost): void {
    const drone = new BuilderDrone(cp.position.clone(), this.team, 'build');
    const idx   = difficultyIndex(this.config.difficulty);
    drone.speedMul     = [0.85, 1.0, 1.15, 1.30, 1.50][idx] * this.config.enemyBuildSpeedMul;
    drone.buildSpeedMul = drone.speedMul;
    state.addEntity(drone);
    this.builders.push(drone);
  }

  // ---------------------------------------------------------------------------
  // Coordinator interface (used by VsAIDirector)
  // ---------------------------------------------------------------------------

  /** Returns the world position most in need of defense, or null. */
  getHighestPriorityDefensePoint(state: GameState): Vec2 | null {
    let best: Vec2 | null = null;
    let bestScore = 0; // only return if actually damaged
    for (const b of state.buildings) {
      if (!b.alive || b.team !== this.team) continue;
      const p = b instanceof PowerGenerator ? 3
        : b instanceof CommandPost ? 5
        : b instanceof Shipyard    ? 2
        : b instanceof TurretBase  ? 1
        : 0;
      const score = p * (1 - b.healthFraction) * 100;
      if (score > bestScore) { bestScore = score; best = b.position.clone(); }
    }
    return best;
  }

  /** Returns world positions of active construction sites. */
  getActiveConstructionSites(): Vec2[] {
    return this.builders
      .filter((b) => b.alive && b.buildOrder !== null)
      .map((b) => cellCenter(b.buildOrder!.cx, b.buildOrder!.cy));
  }

  /**
   * Returns the center of the innermost ring that still has conduit cells
   * left to queue — indicates where expansion is currently lagging.
   */
  getWeakestRingSegment(): Vec2 | null {
    for (const ring of this.rings) {
      if (ring.conduitQueuePtr < ring.conduitCells.length) {
        return cellCenter(this.centerCx, this.centerCy + ring.radiusCells);
      }
    }
    return null;
  }

  /** Returns the player building most valuable to attack (for VsAIDirector harass). */
  getSuggestedHarassTarget(state: GameState): Vec2 | null {
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      const s = b instanceof PowerGenerator ? 5
        : b instanceof Shipyard   ? 4
        : b instanceof ResearchLab ? 3
        : b instanceof Factory     ? 2
        : b instanceof CommandPost ? 1
        : 0;
      if (s > bestScore) { bestScore = s; best = b.position.clone(); }
    }
    return best;
  }

  getCurrentDoctrine(): DoctrineType { return this.doctrineType; }

  getActiveRaidTarget(): Vec2 | null { return this.raidPlanner.getActiveTarget(); }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  snapshot(): PlannerSnapshot {
    const totalCells  = this.rings.reduce((s, r) => s + r.conduitCells.length, 0);
    const queuedCells = this.rings.reduce((s, r) => s + r.conduitQueuePtr, 0);
    return {
      currentRing:     this.currentRing,
      buildsPlaced:    this.buildsPlaced,
      builderCount:    this.livingBuilders(),
      queueSize:       this.queue.length,
      doctrine:        this.doctrineType,
      ringCount:       this.rings.length,
      conduitProgress: totalCells > 0 ? queuedCells / totalCells : 0,
    };
  }
}
