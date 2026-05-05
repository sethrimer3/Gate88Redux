/**
 * Concentric-ring base planner for the Practice enemy.
 *
 * Owns one Command Post and grows the base outward as a sequence of
 * conduit-and-structure rings. Builder drones travel to each chosen
 * cell and "lay down" the structure; ships only spawn from powered
 * shipyards that the planner has finished constructing.
 *
 * Design notes:
 *
 *   • Rings are planned deterministically using a seeded hash so the
 *     base looks organic but can be reproduced. Lower difficulty leaves
 *     gaps; higher difficulty adds redundant crosslinks and spokes.
 *   • The planner does not run every tick. It re-plans on a timer
 *     scaled by `difficultyTickMul`.
 *   • Only `BuilderDrone` instances perform construction. The planner
 *     never spawns a structure directly except for the initial
 *     conduit network around the Command Post.
 */

import { Vec2 } from './math.js';
import { Team, EntityType } from './entities.js';
import { GameState } from './gamestate.js';
import { BuildingBase, CommandPost, Shipyard, PowerGenerator, ResearchLab, Factory } from './building.js';
import { TurretBase } from './turret.js';
import { GRID_CELL_SIZE, cellCenter, cellKey } from './grid.js';
import { BuildDef, getBuildDef } from './builddefs.js';
import { BuilderDrone, BuildOrder } from './builderdrone.js';
import {
  PracticeConfig,
  difficultyIndex,
  difficultyRedundancy,
  difficultyTickMul,
} from './practiceconfig.js';

/** What a ring of the base contains, in order of planner priority. */
interface RingRecipe {
  /** Approximate radius, in cells, from the Command Post. */
  radius: number;
  /** Building keys to attempt, in priority order. */
  buildings: string[];
  /** How many of each building. */
  counts: Record<string, number>;
}

/**
 * Ring catalogue. Each successive ring adds heavier structures.
 * The planner walks rings 0..N in order and only proceeds to ring k+1
 * after the bulk of ring k is in place. The radius is in conduit cells.
 */
const RING_RECIPES: RingRecipe[] = [
  // Ring 1: early defense / power
  {
    radius: 4,
    buildings: ['powergenerator', 'missileturret', 'factory'],
    counts: { powergenerator: 2, missileturret: 2, factory: 1 },
  },
  // Ring 2: production
  {
    radius: 8,
    buildings: ['powergenerator', 'fighteryard', 'missileturret', 'exciterturret', 'factory'],
    counts: {
      powergenerator: 2, fighteryard: 1,
      missileturret: 2, exciterturret: 1, factory: 1,
    },
  },
  // Ring 3: research + heavier defense
  {
    radius: 12,
    buildings: ['researchlab', 'massdriverturret', 'powergenerator', 'missileturret', 'factory'],
    counts: {
      researchlab: 1, massdriverturret: 2, powergenerator: 2,
      missileturret: 2, factory: 1,
    },
  },
  // Ring 4+: escalation
  {
    radius: 16,
    buildings: ['bomberyard', 'massdriverturret', 'exciterturret', 'powergenerator', 'fighteryard'],
    counts: {
      bomberyard: 1, massdriverturret: 2, exciterturret: 2,
      powergenerator: 2, fighteryard: 1,
    },
  },
];

/** Deterministic 32-bit hash for (a,b,seed). Output in [0,1). */
function hash01(a: number, b: number, seed: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

export interface PlannerSnapshot {
  /** Current ring index the planner is filling. */
  currentRing: number;
  /** How many builds completed since start. */
  buildsPlaced: number;
  /** Live builder drones for this team. */
  builderCount: number;
  /** Pending construction queue size. */
  queueSize: number;
}

export class EnemyBasePlanner {
  readonly team: Team;
  readonly config: PracticeConfig;
  /** Center cell of the base — the Command Post's grid cell. */
  private centerCx: number = 0;
  private centerCy: number = 0;
  /** Hash seed so the same base produces the same layout. */
  private seed: number;
  /** Cells already chosen as build sites (whether finished or in flight). */
  private claimedCells: Set<string> = new Set();
  /** Build queue of (cx,cy,def). */
  private queue: BuildOrder[] = [];
  /** Index of the ring currently being filled. */
  private currentRing: number = 0;
  /** Per-ring count of structures placed, keyed by building key. */
  private ringPlacements: Map<number, Record<string, number>> = new Map();
  /** Repeating planner tick. */
  private tickTimer: number = 0;
  /** Builder rebuild bookkeeping. */
  private rebuildTimers: number[] = [];
  /** Builder drone references. We rely on `state.fighters` truth-of-list. */
  builders: BuilderDrone[] = [];

  buildsPlaced: number = 0;

  constructor(team: Team, config: PracticeConfig, seed: number = 1337) {
    this.team = team;
    this.config = config;
    this.seed = seed;
  }

  /**
   * Initialise the base: place a tiny initial conduit network around the
   * Command Post so the network has somewhere to grow from. Spawn one
   * builder drone immediately so the player sees activity from frame 1.
   */
  init(state: GameState, cp: CommandPost): void {
    const center = state.grid; // alias
    const cell = {
      cx: Math.floor(cp.position.x / GRID_CELL_SIZE),
      cy: Math.floor(cp.position.y / GRID_CELL_SIZE),
    };
    this.centerCx = cell.cx;
    this.centerCy = cell.cy;

    // Seed an initial 5-cell + sign of conduit so builders have somewhere
    // to attach, and so the network starts powered.
    const seedCells: Array<[number, number]> = [
      [0, 0],
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    for (const [dx, dy] of seedCells) {
      center.addConduit(this.centerCx + dx, this.centerCy + dy, this.team);
    }
    state.power.markDirty();

    // Kick off the queue.
    this.replanQueue();

    // Seed one builder so the player sees activity immediately.
    this.spawnBuilder(state, cp);
  }

  /** Live builder count after pruning the dead. */
  livingBuilders(): number {
    this.builders = this.builders.filter((b) => b.alive);
    return this.builders.length;
  }

  /**
   * Per-tick update. Cheap fast path most frames; heavy planner walk
   * only when `tickTimer` fires.
   */
  update(state: GameState, cp: CommandPost, dt: number): void {
    // 1. Builder lifecycle
    this.processBuilderRebuilds(state, cp, dt);
    this.assignRepairTargets(state);
    this.dispatchIdleBuilders(state);
    this.collectFinishedBuilds(state);

    // 2. Replan periodically.
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = this.basePlannerInterval();
      this.maybeAdvanceRing(state);
      this.replanQueue();
    }
  }

  /**
   * Reassign each builder's repair target every tick. A builder switches
   * to repair mode when there is a damaged friendly building that *no*
   * other builder is already heading for, and the builder isn't actively
   * placing a structure.
   *
   * Priorities follow the spec: power-critical generators → command post
   * → shipyards → turrets → factories / labs.
   */
  private assignRepairTargets(state: GameState): void {
    // Collect candidate damaged buildings, grouped by priority.
    const damaged: BuildingBase[] = [];
    for (const b of state.buildings) {
      if (!b.alive || b.team !== this.team) continue;
      if (b.buildProgress < 1) continue;
      if (b.healthFraction >= 0.99) continue;
      damaged.push(b);
    }
    if (damaged.length === 0) {
      // No damage anywhere → release every drone from repair mode.
      for (const b of this.builders) {
        if (b.mode === 'repair') {
          b.repairTarget = null;
          b.mode = 'build';
        }
      }
      return;
    }

    // Stable priority sort.
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
      if (pa !== pb) return pa - pb;
      return a.healthFraction - b.healthFraction; // most damaged first
    });

    // Track buildings already claimed by a repair drone so we don't
    // pile every drone onto the same target.
    const claimed = new Set<number>();
    for (const drone of this.builders) {
      if (drone.mode === 'repair' && drone.repairTarget &&
          drone.repairTarget.alive &&
          drone.repairTarget.healthFraction < 0.99) {
        claimed.add(drone.repairTarget.id);
      }
    }

    // Limit how many drones repair at once: at most floor(builders/2) so
    // expansion never fully stalls. Higher difficulty allows more.
    const idx = difficultyIndex(this.config.difficulty);
    const maxRepairers = Math.max(1, Math.floor(this.builders.length *
      [0.4, 0.5, 0.6, 0.7, 0.8][idx]));
    const currentRepairers = this.builders.filter((b) => b.mode === 'repair' && b.alive).length;

    // Promote idle builders to repair mode if budget allows.
    let promotions = maxRepairers - currentRepairers;
    if (promotions > 0) {
      for (const drone of this.builders) {
        if (promotions <= 0) break;
        if (!drone.alive) continue;
        if (drone.isBuilding) continue;       // mid-construction; leave it
        if (drone.mode === 'repair') continue; // already repairing
        // Find an unclaimed top-priority damaged target.
        const target = damaged.find((b) => !claimed.has(b.id));
        if (!target) break;
        // Switch this drone into repair mode for the next pass.
        drone.mode = 'repair';
        drone.repairTarget = target;
        // If they were carrying a build order, push it back to the queue
        // so it isn't dropped.
        if (drone.buildOrder) {
          this.queue.unshift(drone.buildOrder);
          drone.buildOrder = null;
        }
        claimed.add(target.id);
        promotions--;
      }
    }

    // Demote drones whose target is now healed/dead so they go back to building.
    for (const drone of this.builders) {
      if (drone.mode !== 'repair') continue;
      const t = drone.repairTarget;
      if (!t || !t.alive || t.healthFraction >= 0.99) {
        drone.mode = 'build';
        drone.repairTarget = null;
      }
    }
  }

  private basePlannerInterval(): number {
    // Higher difficulty → faster decisions. Cap at 0.6s so it stays cheap.
    const base = 4.0;
    return Math.max(0.6, base / difficultyTickMul(this.config.difficulty));
  }

  // -----------------------------------------------------------------------
  // Builder rebuild bookkeeping
  // -----------------------------------------------------------------------

  private processBuilderRebuilds(state: GameState, cp: CommandPost, dt: number): void {
    this.builders = this.builders.filter((b) => b.alive);
    const max = this.config.enemyMaxBuilders;
    const wanted = max - this.builders.length;
    // Extend the rebuild-timer list to match `wanted`.
    while (this.rebuildTimers.length < wanted) {
      this.rebuildTimers.push(this.config.enemyBuilderRebuildSeconds);
    }
    // Trim if we have more timers than needed.
    while (this.rebuildTimers.length > wanted) {
      this.rebuildTimers.pop();
    }

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
    // Difficulty-derived speed boosts.
    const idx = difficultyIndex(this.config.difficulty);
    drone.speedMul = [0.85, 1.0, 1.15, 1.30, 1.50][idx] *
      this.config.enemyBuildSpeedMul;
    drone.buildSpeedMul = drone.speedMul;
    state.addEntity(drone);
    this.builders.push(drone);
  }

  // -----------------------------------------------------------------------
  // Build dispatch / completion
  // -----------------------------------------------------------------------

  private dispatchIdleBuilders(state: GameState): void {
    if (this.queue.length === 0) return;
    for (const b of this.builders) {
      if (!b.alive) continue;
      if (b.mode === 'repair') continue; // busy healing
      if (b.buildOrder) continue; // already busy
      if (b.isBuilding) continue;
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
      // Lay conduit first so the new building is on a powered cell.
      if (result.layConduit) {
        state.grid.addConduit(result.cx, result.cy, this.team);
      }
      state.addEntity(result.ent);
      // Make sure newly placed enemy shipyards are NOT pre-spawning ships
      // until they finish construction *and* are powered.
      this.buildsPlaced++;
      state.recentEnemyConstructions.push({
        pos: result.ent.position.clone(),
        time: state.gameTime,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Ring planning
  // -----------------------------------------------------------------------

  private maybeAdvanceRing(state: GameState): void {
    if (this.currentRing >= RING_RECIPES.length - 1) return;
    const recipe = RING_RECIPES[this.currentRing];
    const placed = this.ringPlacements.get(this.currentRing) ?? {};
    let totalNeeded = 0;
    let totalPlaced = 0;
    for (const key of recipe.buildings) {
      totalNeeded += recipe.counts[key];
      totalPlaced += placed[key] ?? 0;
    }
    // Move on once 70% of the ring is complete; higher difficulty advances earlier.
    const advanceFraction = 0.85 - 0.10 * difficultyIndex(this.config.difficulty);
    if (totalPlaced >= totalNeeded * advanceFraction) {
      // Visual feedback — a power-wave pulse sweeping outward across the
      // completed ring tells the player a new defensive layer just came online.
      const center = cellCenter(this.centerCx, this.centerCy);
      const ringWorldR = recipe.radius * GRID_CELL_SIZE;
      state.ringEffects.spawnPowerWave(
        center,
        Math.max(40, ringWorldR - GRID_CELL_SIZE),
        ringWorldR + GRID_CELL_SIZE * 2,
        1.6,
        1.0 + 0.15 * difficultyIndex(this.config.difficulty),
      );
      this.currentRing++;
    }
  }

  /**
   * Refill the build queue up to a small look-ahead so destroyed builders
   * don't permanently stall progress.
   */
  private replanQueue(): void {
    const TARGET_QUEUE = 4 + difficultyIndex(this.config.difficulty);
    while (this.queue.length < TARGET_QUEUE) {
      const order = this.planNextOrder();
      if (!order) break;
      this.queue.push(order);
      this.claimedCells.add(cellKey(order.cx, order.cy));
    }
  }

  /**
   * Choose the next build order based on ring + planner priorities.
   * Priorities (ordered): power → defense → economy → ships → research → expansion.
   */
  private planNextOrder(): BuildOrder | null {
    for (let r = 0; r <= this.currentRing && r < RING_RECIPES.length; r++) {
      const recipe = RING_RECIPES[r];
      const placed = this.ringPlacements.get(r) ?? {};
      // Determine the next building this ring still needs.
      for (const key of recipe.buildings) {
        const have = placed[key] ?? 0;
        const need = recipe.counts[key];
        if (have >= need) continue;
        const def = getBuildDef(key);
        if (!def) continue;
        const cell = this.findRingCell(r);
        if (!cell) continue;
        // Mark intent.
        placed[key] = have + 1;
        this.ringPlacements.set(r, placed);
        return { cx: cell.cx, cy: cell.cy, def, layConduitFirst: true };
      }
    }
    return null;
  }

  /**
   * Pick a cell on (or near) the given ring radius using deterministic
   * hash variation so the result is organic rather than a perfect circle.
   */
  private findRingCell(ringIndex: number): { cx: number; cy: number } | null {
    const recipe = RING_RECIPES[ringIndex];
    const baseR = recipe.radius;
    // Try several candidate angles, deterministically jittered.
    const slots = 16;
    const redundancy = difficultyRedundancy(this.config.difficulty);
    for (let attempt = 0; attempt < slots * 2; attempt++) {
      // Spread across the ring; bias by buildsPlaced so successive
      // builds spiral around rather than clumping at angle 0.
      const slot = (attempt + this.buildsPlaced * 3) % slots;
      const angle = (slot / slots) * Math.PI * 2;
      // Deterministic radius/angle jitter.
      const jr = (hash01(this.centerCx + ringIndex, this.centerCy + slot, this.seed) - 0.5) * 1.5;
      const ja = (hash01(this.centerCx + slot, this.centerCy + ringIndex, this.seed + 1) - 0.5) * 0.4;
      const r = baseR + jr;
      const a = angle + ja;
      const cx = this.centerCx + Math.round(Math.cos(a) * r);
      const cy = this.centerCy + Math.round(Math.sin(a) * r);
      const k = cellKey(cx, cy);
      if (this.claimedCells.has(k)) continue;
      // Higher difficulty allows redundant placements (denser rings).
      // Lower difficulty: skip with some probability so weak points exist.
      const skip = hash01(cx, cy, this.seed + 2);
      if (skip < (0.20 - 0.05 * difficultyIndex(this.config.difficulty))) continue;
      return { cx, cy };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Public diagnostics
  // -----------------------------------------------------------------------

  snapshot(): PlannerSnapshot {
    return {
      currentRing: this.currentRing,
      buildsPlaced: this.buildsPlaced,
      builderCount: this.livingBuilders(),
      queueSize: this.queue.length,
    };
  }
}

