/**
 * Base plan types and geometric utilities for the enemy AI.
 *
 * Provides:
 *   • `traceLine`               — Bresenham cell-path between two grid cells.
 *   • `generateRingCells`       — conduit cells forming one concentric ring.
 *   • `generateSpokeCells`      — conduit cells for each radial spoke.
 *   • `generateRingBuildingSlots` — building locations within a ring.
 *   • `RingPlan`, `BastionPlan` — structured plan objects used by EnemyBasePlanner.
 *
 * All geometry is deterministic given a fixed seed so the same match always
 * produces the same base shape.
 */

import { cellKey } from './grid.js';

export const AI_RING_THICKNESS_CONDUITS = 2;
export const AI_RING_SPACING_CONDUITS = 3;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Deterministic 32-bit hash → [0,1). */
export function hash01plan(a: number, b: number, seed: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

/**
 * Trace a strictly 4-connected path of grid cells from (x0,y0) to (x1,y1).
 *
 * Uses Bresenham's line algorithm but inserts an intermediate orthogonal cell
 * whenever a step would change both x and y simultaneously (diagonal step).
 * This guarantees that every consecutive pair of returned cells shares an edge
 * (Manhattan distance exactly 1), which is required for Gate88 power-graph
 * propagation where energy only flows through 4-adjacent neighbours.
 *
 * Example — (0,0) → (2,1) without fix:  (0,0)→(1,1)→(2,1)  [diagonal!]
 *           (0,0) → (2,1)   with fix:   (0,0)→(1,0)→(2,0)→(2,1)
 */
export function traceLine(
  x0: number, y0: number,
  x1: number, y1: number,
): Array<{ cx: number; cy: number }> {
  const cells: Array<{ cx: number; cy: number }> = [];
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cells.push({ cx: x, cy: y });
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    const moveX = e2 > -dy;
    const moveY = e2 < dx;
    if (moveX && moveY) {
      // Diagonal step — insert intermediate horizontal cell first, then step
      // vertically.  This converts one corner-touching step into two
      // edge-sharing steps, preserving 4-connectivity.
      err -= dy;
      x += sx;
      cells.push({ cx: x, cy: y }); // intermediate
      err += dx;
      y += sy;
    } else if (moveX) {
      err -= dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/**
 * Debug validator: returns true iff every consecutive pair of cells in `path`
 * has Manhattan distance exactly 1 (strictly 4-connected).
 *
 * Logs a warning on the first violation found so callers can identify the
 * offending cells without silently ignoring the problem.
 */
export function assert4Connected(
  path: ReadonlyArray<{ cx: number; cy: number }>,
  label = 'path',
): boolean {
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].cx - path[i - 1].cx);
    const dy = Math.abs(path[i].cy - path[i - 1].cy);
    if (dx + dy !== 1) {
      console.warn(
        `[AI] assert4Connected FAIL in "${label}" at index ${i}: ` +
        `(${path[i-1].cx},${path[i-1].cy}) → (${path[i].cx},${path[i].cy}) ` +
        `dist=${dx+dy}`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Generate a ring of conduit cells at `radiusCells` from the center.
 *
 * `numSlots` angular samples are placed around the ring with small
 * deterministic jitter so the ring looks organic. Consecutive slots are
 * connected with orthogonal (4-connected) traceLine traces, giving a fully
 * power-propagating loop.
 *
 * `gapProbability` (0..1) controls how many arc segments are left open —
 * higher values create intentional weak points on easier difficulties.
 */
export function generateRingCells(
  centerCx: number, centerCy: number,
  radiusCells: number,
  numSlots: number,
  gapProbability: number,
  seed: number,
  thicknessCells: number = 1,
): Array<{ cx: number; cy: number }> {
  const visited = new Set<string>();
  const cells: Array<{ cx: number; cy: number }> = [];

  for (let band = 0; band < Math.max(1, thicknessCells); band++) {
    const radius = radiusCells + band;
    const points: Array<{ cx: number; cy: number }> = [];
    for (let i = 0; i < numSlots; i++) {
      const baseAngle = (i / numSlots) * Math.PI * 2;
      const angleJitter = (hash01plan(centerCx + i, centerCy + radius, seed + 3) - 0.5) * 0.12;
      const a = baseAngle + angleJitter;
      points.push({
        cx: centerCx + Math.round(Math.cos(a) * radius),
        cy: centerCy + Math.round(Math.sin(a) * radius),
      });
    }

    for (let i = 0; i < numSlots; i++) {
      if (hash01plan(i, radiusCells, seed + 5) < gapProbability) continue;
      const a = points[i];
      const b = points[(i + 1) % numSlots];
      for (const cell of traceLine(a.cx, a.cy, b.cx, b.cy)) {
        const k = cellKey(cell.cx, cell.cy);
        if (!visited.has(k)) {
          visited.add(k);
          cells.push(cell);
        }
      }
    }
  }
  return cells;
}

/**
 * Generate building slot positions for a ring based on a recipe.
 *
 * Each building is placed at an evenly spaced angle, then snapped to the
 * nearest ring conduit cell if one is within reach. Slots are returned in
 * recipe order so priority assignment is stable.
 */
export function generateRingBuildingSlots(
  centerCx: number, centerCy: number,
  radiusCells: number,
  recipe: { buildings: string[]; counts: Record<string, number> },
  ringCells: Array<{ cx: number; cy: number }>,
  seed: number,
): Array<{ cx: number; cy: number; buildingKey: string }> {
  const slots: Array<{ cx: number; cy: number; buildingKey: string }> = [];
  const claimedKeys = new Set<string>();

  // Flatten recipe into an ordered list of buildingKey entries.
  const entries: string[] = [];
  for (const key of recipe.buildings) {
    const n = recipe.counts[key] ?? 0;
    for (let i = 0; i < n; i++) entries.push(key);
  }
  if (entries.length === 0) return slots;

  // Index ring cells by their angle from center for fast nearest-angle lookup.
  const cellsByAngle = ringCells.map((c) => ({
    cx: c.cx, cy: c.cy,
    angle: Math.atan2(c.cy - centerCy, c.cx - centerCx),
  }));

  for (let i = 0; i < entries.length; i++) {
    const targetAngle = (i / entries.length) * Math.PI * 2
      + hash01plan(centerCx + i, centerCy + radiusCells, seed + 6) * 0.3;

    // Find the ring cell closest to this target angle (or a fresh computed cell).
    let best: { cx: number; cy: number } | null = null;
    let bestDist = Infinity;

    for (const c of cellsByAngle) {
      if (claimedKeys.has(cellKey(c.cx, c.cy))) continue;
      // Angular distance (wrap).
      let da = Math.abs(c.angle - targetAngle);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < bestDist) { bestDist = da; best = c; }
    }

    if (!best) {
      // Fallback: place directly at the computed ring position.
      const r = radiusCells + (hash01plan(i, radiusCells, seed + 7) - 0.5) * 0.8;
      best = {
        cx: centerCx + Math.round(Math.cos(targetAngle) * r),
        cy: centerCy + Math.round(Math.sin(targetAngle) * r),
      };
    }

    const k = cellKey(best.cx, best.cy);
    claimedKeys.add(k);
    slots.push({ cx: best.cx, cy: best.cy, buildingKey: entries[i] });
  }
  return slots;
}

/**
 * Generate spokes connecting the base center to the outer ring.
 *
 * Returns an array of spoke paths (one per spoke), each being an ordered
 * array of cells from center → outer ring. Callers should build inner cells
 * first so power flows outward.
 */
export function generateSpokeCells(
  centerCx: number, centerCy: number,
  outerRadius: number,
  numSpokes: number,
  seed: number,
): Array<Array<{ cx: number; cy: number }>> {
  const spokes: Array<Array<{ cx: number; cy: number }>> = [];
  for (let i = 0; i < numSpokes; i++) {
    const angle = (i / numSpokes) * Math.PI * 2
      + (hash01plan(i, centerCx ^ centerCy, seed + 10) - 0.5) * 0.55;
    const endCx = centerCx + Math.round(Math.cos(angle) * outerRadius);
    const endCy = centerCy + Math.round(Math.sin(angle) * outerRadius);
    spokes.push(traceLine(centerCx, centerCy, endCx, endCy));
  }
  return spokes;
}

/**
 * Generate a small local conduit loop for a forward bastion.
 * The loop is a rough hexagonal patch of ~radius 2 cells at `anchorCx/Cy`.
 */
export function generateBastionLoop(
  anchorCx: number, anchorCy: number,
  seed: number,
): Array<{ cx: number; cy: number }> {
  const R = 2;
  const numPts = 6;
  return generateRingCells(anchorCx, anchorCy, R, numPts, 0, seed + 20);
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type RingRole = 'core' | 'innerDefense' | 'production' | 'picket' | 'forward';

export interface BuildingSlot {
  cx: number;
  cy: number;
  buildingKey: string;
  /** True once the building build order itself has been dispatched. */
  queued: boolean;
  /** True once the building is confirmed placed (via planner callback). */
  placed: boolean;
  /**
   * Short conduit path from the nearest ring/spoke cell to this building's
   * footprint border.  Dispatched before the building order so the building
   * is visibly "plugged in" to the base power network.
   *
   * Starts as an empty array; populated when the candidate position is first
   * locked in by the planner.  -1 means the candidate has not yet been found.
   */
  connectorCells: Array<{ cx: number; cy: number }>;
  /** Index of the next connector cell to dispatch as a conduit order. */
  connectorQueuePtr: number;
}

export interface RingPlan {
  ringIndex: number;
  radiusCells: number;
  role: RingRole;
  /** All conduit cells forming the ring loop (may have gaps on easy). */
  conduitCells: Array<{ cx: number; cy: number }>;
  /** Index of next conduit cell to enqueue (walks conduitCells linearly). */
  conduitQueuePtr: number;
  /** Building slots assigned to this ring. */
  buildingSlots: BuildingSlot[];
}

export interface BastionPlan {
  anchorCx: number;
  anchorCy: number;
  /** Cells forming the bastion's local conduit loop. */
  conduitCells: Array<{ cx: number; cy: number }>;
  conduitQueuePtr: number;
  /** The generator slot cell. */
  generatorSlot: { cx: number; cy: number } | null;
  /** Turret cells (claimed after generator slot). */
  turretSlots: Array<{ cx: number; cy: number; queued: boolean; placed: boolean }>;
  /** Optional spoke back to main base. */
  spokeBackCells: Array<{ cx: number; cy: number }>;
  status: 'planned' | 'constructing' | 'online' | 'damaged' | 'abandoned';
}
