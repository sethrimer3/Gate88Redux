/**
 * Raid planner for the Gate 88 enemy AI.
 *
 * The raid planner assembles groups of fighters from powered enemy shipyards
 * and dispatches them toward strategic objectives. It runs on a cooldown so
 * raids feel like meaningful events rather than a constant trickle.
 *
 * Raid types (ordered by strategic value):
 *   • probe          — small group tests the player's outer defenses.
 *   • conduit_cut    — targets exposed player conduits or Power Generators.
 *   • shipyard_sup   — targets player Fighter/Bomber Yards.
 *   • retaliation    — triggered when the player destroys an enemy structure.
 *   • punishment     — heavy strike on the player Command Post or factories
 *                      when the player appears over-extended.
 *
 * The planner selects idle fighters without overriding defenders. It keeps at
 * least `minDefenderFraction` of fighters near the Command Post.
 */

import { Vec2 } from './math.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import type { GameState } from './gamestate.js';
import { FighterShip } from './fighter.js';
import { BuildingBase, CommandPost, PowerGenerator, Shipyard } from './building.js';
import { isBuilderDrone } from './builderdrone.js';
import type { DoctrineType } from './aidoctrine.js';
import { DOCTRINES } from './aidoctrine.js';
import type { DifficultyName } from './practiceconfig.js';
import { difficultyIndex } from './practiceconfig.js';

export type RaidType =
  | 'probe'
  | 'conduit_cut'
  | 'shipyard_sup'
  | 'retaliation'
  | 'punishment';

export interface RaidObjective {
  type: RaidType;
  targetPos: Vec2;
  /** IDs of fighters assigned to this raid. */
  assignedIds: Set<number>;
  cooldownAfter: number;
}

/** Minimum fraction of fighters kept near the Command Post as defenders. */
const MIN_DEFENDER_FRACTION = 0.25;

export class RaidPlanner {
  private cooldown: number = 20;
  private active: RaidObjective | null = null;
  /** Remembered positions of recently destroyed enemy structures (for retaliation). */
  private retaliationQueue: Vec2[] = [];

  /** Call from EnemyBasePlanner when an enemy structure is destroyed. */
  notifyStructureDestroyed(pos: Vec2): void {
    this.retaliationQueue.push(pos.clone());
    // Keep only the most recent 3 to avoid stale retaliation piles.
    if (this.retaliationQueue.length > 3) {
      this.retaliationQueue.shift();
    }
  }

  update(
    state: GameState,
    dt: number,
    doctrine: DoctrineType,
    difficulty: DifficultyName,
  ): void {
    const doc = DOCTRINES[doctrine];
    const idx = difficultyIndex(difficulty);

    // 1. Tick down cooldown.
    this.cooldown -= dt;

    // 2. Clear finished raids (target unreachable or all fighters dead).
    if (this.active) {
      this.cleanupFinishedRaid(state);
    }

    // 3. Drive active-raid fighters toward their target.
    if (this.active) {
      this.driveRaidFighters(state, this.active);
      return;
    }

    // 4. Launch a new raid when the cooldown expires.
    if (this.cooldown > 0) return;

    // Only raid on Normal+ difficulty by default.
    if (idx < 1) { this.cooldown = 30; return; }

    const objective = this.selectObjective(state, doc.favoredRaidTypes, idx);
    if (!objective) {
      this.cooldown = 10; // retry sooner
      return;
    }

    this.launchRaid(state, objective, doc.raidCooldownMul, difficulty);
  }

  /** Notify the raid planner that a new raid cooldown should begin (e.g., after a raid launches). */
  resetCooldown(baseCooldown: number, mul: number): void {
    this.cooldown = baseCooldown * mul;
  }

  // -------------------------------------------------------------------------
  // Objective selection
  // -------------------------------------------------------------------------

  private selectObjective(
    state: GameState,
    favoredTypes: string[],
    diffIdx: number,
  ): RaidObjective | null {
    // Try each favored type until one yields a valid target.
    for (const typeStr of favoredTypes) {
      const type = typeStr as RaidType;
      const target = this.findTarget(state, type, diffIdx);
      if (!target) continue;
      return {
        type,
        targetPos: target,
        assignedIds: new Set(),
        cooldownAfter: [50, 40, 30, 22, 16][diffIdx],
      };
    }

    // Retaliation from queue.
    if (this.retaliationQueue.length > 0) {
      return {
        type: 'retaliation',
        targetPos: this.retaliationQueue.shift()!,
        assignedIds: new Set(),
        cooldownAfter: [40, 30, 22, 16, 10][diffIdx],
      };
    }

    return null;
  }

  private findTarget(state: GameState, type: RaidType, diffIdx: number): Vec2 | null {
    switch (type) {
      case 'probe':        return this.findProbeTarget(state);
      case 'conduit_cut':  return this.findConduitCutTarget(state);
      case 'shipyard_sup': return this.findShipyardTarget(state);
      case 'retaliation':  return this.retaliationQueue.length > 0
                             ? this.retaliationQueue[0] : null;
      case 'punishment':   return diffIdx >= 2 ? this.findPunishmentTarget(state) : null;
    }
  }

  private findProbeTarget(state: GameState): Vec2 | null {
    // Target the nearest player building to the enemy CP.
    const cp = this.findEnemyCP(state);
    if (!cp) return null;
    let best: Vec2 | null = null;
    let bestDist = Infinity;
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      const d = b.position.distanceTo(cp.position);
      if (d < bestDist) { bestDist = d; best = b.position; }
    }
    if (!best && state.player.alive) best = state.player.position.clone();
    return best;
  }

  private findConduitCutTarget(state: GameState): Vec2 | null {
    // Target exposed player Power Generators first, then player conduits near the boundary.
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (b instanceof PowerGenerator) return b.position.clone();
    }
    return null;
  }

  private findShipyardTarget(state: GameState): Vec2 | null {
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (b instanceof Shipyard) return b.position.clone();
    }
    return null;
  }

  private findPunishmentTarget(state: GameState): Vec2 | null {
    // Target player CP if we have fighters to spare, else turrets.
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      if (b instanceof CommandPost) return b.position.clone();
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Raid launch
  // -------------------------------------------------------------------------

  private launchRaid(
    state: GameState,
    obj: RaidObjective,
    cooldownMul: number,
    difficulty: DifficultyName,
  ): void {
    const cp = this.findEnemyCP(state);
    if (!cp) return;

    const allFighters = this.gatherIdleFighters(state, cp, difficulty);
    if (allFighters.length === 0) { this.cooldown = 8; return; }

    // Keep a fraction at home as defenders.
    const totalF = allFighters.length;
    const maxRaiders = Math.max(1, Math.floor(totalF * (1 - MIN_DEFENDER_FRACTION)));
    const raiding = allFighters.slice(0, maxRaiders);

    for (const f of raiding) {
      f.order = 'attack';
      f.targetPos = obj.targetPos.clone();
      obj.assignedIds.add(f.id);
    }

    this.cooldown = obj.cooldownAfter * cooldownMul;
    this.active = obj;

    // Visual: trigger a ring flash at the shipyard cluster to signal raid launch.
    state.ringEffects.spawnBlackout(
      obj.targetPos,
      0,
      80,
      0.8,
      0.6,
    );
  }

  private gatherIdleFighters(
    state: GameState,
    cp: CommandPost,
    difficulty: DifficultyName,
  ): FighterShip[] {
    const idx = difficultyIndex(difficulty);
    // Increased raid sizes at higher difficulty — the AI now fields more fighters
    // per raid so it doesn't only trickle units one at a time.
    const maxRaidSize = [3, 5, 7, 10, 14][idx];
    const fighters: FighterShip[] = [];
    for (const f of state.fighters) {
      if (!f.alive || f.docked || f.team !== Team.Enemy) continue;
      if (isBuilderDrone(f)) continue;
      if (f.order !== 'idle' && f.order !== 'protect') continue;
      if (fighters.length >= maxRaidSize) break;
      fighters.push(f as FighterShip);
    }
    return fighters;
  }

  // -------------------------------------------------------------------------
  // Active raid management
  // -------------------------------------------------------------------------

  private driveRaidFighters(_state: GameState, obj: RaidObjective): void {
    // Only ensure assigned fighters maintain their attack target. Actual weapon
    // firing is handled by PracticeMode.updateEnemyFighters to avoid duplication.
    for (const f of _state.fighters) {
      if (!obj.assignedIds.has(f.id)) continue;
      if (!f.alive || f.docked) continue;
      if (f.order !== 'attack' || !f.targetPos) {
        f.order = 'attack';
        f.targetPos = obj.targetPos.clone();
      }
    }
  }

  private cleanupFinishedRaid(state: GameState): void {
    if (!this.active) return;
    // Clear fighters that died or completed the objective.
    for (const id of [...this.active.assignedIds]) {
      const f = state.fighters.find((x) => x.id === id);
      if (!f || !f.alive) this.active.assignedIds.delete(id);
    }
    // Raid is done when no assigned fighters remain.
    if (this.active.assignedIds.size === 0) {
      this.active = null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private findEnemyCP(state: GameState): CommandPost | null {
    for (const b of state.buildings) {
      if (b.alive && b.team === Team.Enemy && b instanceof CommandPost) return b;
    }
    return null;
  }

  /** Current raid target (for VsAIDirector coordination). */
  getActiveTarget(): Vec2 | null {
    return this.active?.targetPos ?? null;
  }

  /** True if a raid is currently in flight. */
  isRaiding(): boolean {
    return this.active !== null;
  }
}
