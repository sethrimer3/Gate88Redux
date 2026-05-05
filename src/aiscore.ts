/**
 * Strategic heat map for the Gate88 AI (PR6).
 *
 * The heat map scores each grid cell by how dangerous it is to be at for an
 * AI-controlled team. Higher score = more threat. The AI uses it to:
 *   • Pick *low*-score cells when expanding its base (place buildings safely).
 *   • Pick *high*-score cells of the *opponent* when issuing offensive orders.
 *
 * Threat sources (for "danger to team T"):
 *   • Enemy turrets within their effective range — scored by inverse distance.
 *   • Enemy CommandPost — large radius soft threat (avoid camping near it).
 *   • Enemy player ship — moderate moving threat.
 *
 * Storage is sparse: only cells the AI actually queries are computed (lazy).
 * A full grid scan would be prohibitive on a large world. We sample on
 * demand and cache the value for `STALE_TIME_S` seconds before recomputing.
 */

import { Vec2 } from './math.js';
import { Team, EntityType } from './entities.js';
import type { GameState } from './gamestate.js';
import { TurretBase } from './turret.js';
import { GRID_CELL_SIZE, cellKey, cellCenter } from './grid.js';

const STALE_TIME_S = 1.0;

interface CachedScore {
  value: number;
  computedAtGameTime: number;
}

export class AIScore {
  /** Per-team cache: cellKey → cached score. */
  private cache = new Map<Team, Map<string, CachedScore>>();

  /**
   * Score for "team `t` standing in cell (cx, cy)". Higher = more dangerous.
   * Result is in roughly [0, 100] but not strictly bounded.
   */
  threatAt(state: GameState, t: Team, cx: number, cy: number): number {
    let bucket = this.cache.get(t);
    if (bucket === undefined) {
      bucket = new Map();
      this.cache.set(t, bucket);
    }
    const k = cellKey(cx, cy);
    const cached = bucket.get(k);
    if (cached !== undefined && state.gameTime - cached.computedAtGameTime < STALE_TIME_S) {
      return cached.value;
    }
    const value = this.computeThreat(state, t, cx, cy);
    bucket.set(k, { value, computedAtGameTime: state.gameTime });
    return value;
  }

  /** Invalidate the cache (call when enemy buildings change). */
  invalidate(): void {
    this.cache.clear();
  }

  private computeThreat(state: GameState, t: Team, cx: number, cy: number): number {
    const cellPos = cellCenter(cx, cy);
    let score = 0;

    for (const b of state.buildings) {
      if (!b.alive || b.team === t || b.team === Team.Neutral) continue;
      const d = b.position.distanceTo(cellPos);
      if (b instanceof TurretBase) {
        // Inverse-distance threat scaled by the turret's nominal range.
        const range = b.range;
        if (d <= range * 1.5) {
          // 1.0 at d=0, drops linearly to 0 at d=1.5×range.
          score += 30 * Math.max(0, 1 - d / (range * 1.5));
        }
      } else if (b.type === EntityType.CommandPost) {
        // Soft "stay away from the enemy capital" threat.
        const r = 600;
        if (d <= r) score += 15 * (1 - d / r);
      } else if (
        b.type === EntityType.FighterYard ||
        b.type === EntityType.BomberYard
      ) {
        const r = 400;
        if (d <= r) score += 8 * (1 - d / r);
      }
    }

    if (state.player.alive && state.player.team !== t) {
      const d = state.player.position.distanceTo(cellPos);
      const r = 350;
      if (d <= r) score += 12 * (1 - d / r);
    }

    return score;
  }

  /**
   * Find the (cx, cy) cell minimising threat among `candidates`. Ties are
   * broken by the order the candidates appear (stable).
   */
  bestSafeCell(
    state: GameState,
    t: Team,
    candidates: Array<{ cx: number; cy: number }>,
  ): { cx: number; cy: number; score: number } | null {
    if (candidates.length === 0) return null;
    let bestIdx = 0;
    let bestScore = this.threatAt(state, t, candidates[0].cx, candidates[0].cy);
    for (let i = 1; i < candidates.length; i++) {
      const s = this.threatAt(state, t, candidates[i].cx, candidates[i].cy);
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    return { ...candidates[bestIdx], score: bestScore };
  }

  /** Best high-threat target cell from a list (for "attack the soft spot"). */
  bestAttackTarget(
    state: GameState,
    t: Team,
    candidates: Array<{ cx: number; cy: number }>,
  ): { cx: number; cy: number; score: number } | null {
    if (candidates.length === 0) return null;
    // Threat for *opponents standing here* — for the AI's own threat map,
    // a HIGH score for enemy team means soft for us; we approximate by
    // querying the opposing team's threat (so a player turret cell scores
    // high against itself, which we want to AVOID; i.e. pick low). Instead,
    // measure how many friendly assets we'd disable: distance to nearest
    // enemy CP / generator. We invert distance to keep the API symmetric.
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = cellCenter(candidates[i].cx, candidates[i].cy);
      const v = this.opportunityValue(state, t, c);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return { ...candidates[bestIdx], score: bestVal };
  }

  private opportunityValue(state: GameState, t: Team, pos: Vec2): number {
    // High value: close to opponent CP / shipyards, far from opponent turrets.
    let v = 0;
    for (const b of state.buildings) {
      if (!b.alive || b.team === t || b.team === Team.Neutral) continue;
      const d = b.position.distanceTo(pos);
      if (b.type === EntityType.CommandPost) v += 100 / (1 + d / 100);
      if (b.type === EntityType.FighterYard || b.type === EntityType.BomberYard)
        v += 60 / (1 + d / 100);
      if (b instanceof TurretBase) v -= 25 / (1 + d / 80);
    }
    return v;
  }
}

/** Convenience: cell coord under a world position. */
export function cellOf(pos: Vec2): { cx: number; cy: number } {
  return {
    cx: Math.floor(pos.x / GRID_CELL_SIZE),
    cy: Math.floor(pos.y / GRID_CELL_SIZE),
  };
}

