/**
 * Universal world grid for Gate88 (PR3).
 *
 * The grid is a coarse Cartesian decomposition of the world into square cells.
 * It backs:
 *
 *   - The conduit-paint system (Q-hold paint mode in actionmenu.ts).
 *   - Snap-to-grid building placement (PR4 reads cell centers via cellCenter()).
 *   - Future power-network propagation (PR5 will walk the conduit graph).
 *   - Future enemy-base migration (PR6 will paint enemy conduits).
 *
 * Conduits are stored as a sparse `Set<string>` keyed by `cellKey(cx, cy)`.
 * Each cell remembers which team painted it so player and enemy networks
 * stay distinct.
 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS } from './colors.js';
import { Team } from './entities.js';

/** Side length of one grid cell in world units. */
export const GRID_CELL_SIZE = 40;

/** Stable string key for a (cx, cy) cell coordinate. */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export interface CellCoord {
  cx: number;
  cy: number;
}

/** Convert a world-space position to its containing cell coordinate. */
export function worldToCell(world: Vec2): CellCoord {
  return {
    cx: Math.floor(world.x / GRID_CELL_SIZE),
    cy: Math.floor(world.y / GRID_CELL_SIZE),
  };
}

/** Centre of the cell at (cx, cy) in world space. */
export function cellCenter(cx: number, cy: number): Vec2 {
  return new Vec2(
    (cx + 0.5) * GRID_CELL_SIZE,
    (cy + 0.5) * GRID_CELL_SIZE,
  );
}

/** True if cells (a) and (b) share an edge (4-neighbour adjacency). */
export function isAdjacent(a: CellCoord, b: CellCoord): boolean {
  const dx = Math.abs(a.cx - b.cx);
  const dy = Math.abs(a.cy - b.cy);
  return dx + dy === 1;
}

// ---------------------------------------------------------------------------
// WorldGrid
// ---------------------------------------------------------------------------

export class WorldGrid {
  /** All conduit cells, keyed by cellKey(); value = team that painted it. */
  private conduits = new Map<string, Team>();

  // -- Conduit accessors ----------------------------------------------------

  hasConduit(cx: number, cy: number): boolean {
    return this.conduits.has(cellKey(cx, cy));
  }

  conduitTeam(cx: number, cy: number): Team | null {
    return this.conduits.get(cellKey(cx, cy)) ?? null;
  }

  addConduit(cx: number, cy: number, team: Team): void {
    this.conduits.set(cellKey(cx, cy), team);
  }

  removeConduit(cx: number, cy: number): void {
    this.conduits.delete(cellKey(cx, cy));
  }

  /** Number of placed conduits — useful for debug/HUD. */
  conduitCount(): number {
    return this.conduits.size;
  }

  /** Iterate every (coord, team) pair. */
  *eachConduit(): IterableIterator<{ cx: number; cy: number; team: Team }> {
    for (const [k, team] of this.conduits) {
      const [sx, sy] = k.split(',');
      yield { cx: parseInt(sx, 10), cy: parseInt(sy, 10), team };
    }
  }

  /** True if (cx,cy) is a conduit OR has at least one 4-adjacent conduit. */
  isOnOrAdjacentToConduit(cx: number, cy: number, team?: Team): boolean {
    const probe = (kx: number, ky: number): boolean => {
      const owner = this.conduits.get(cellKey(kx, ky));
      if (owner === undefined) return false;
      return team === undefined || owner === team;
    };
    return (
      probe(cx, cy) ||
      probe(cx + 1, cy) ||
      probe(cx - 1, cy) ||
      probe(cx, cy + 1) ||
      probe(cx, cy - 1)
    );
  }

  // -- Drawing --------------------------------------------------------------

  /**
   * Render the grid: faint grid lines for cells visible on screen, plus
   * filled conduit tiles coloured by their owning team.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    // Visible cell range (inclusive). Pad by one cell for line continuity.
    const tl = camera.screenToWorld(new Vec2(0, 0));
    const br = camera.screenToWorld(new Vec2(screenW, screenH));
    const cxMin = Math.floor(tl.x / GRID_CELL_SIZE) - 1;
    const cxMax = Math.floor(br.x / GRID_CELL_SIZE) + 1;
    const cyMin = Math.floor(tl.y / GRID_CELL_SIZE) - 1;
    const cyMax = Math.floor(br.y / GRID_CELL_SIZE) + 1;

    // 1. Conduit fills first so grid lines overlay nicely on top.
    const cellPx = GRID_CELL_SIZE * camera.zoom;
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const team = this.conduits.get(cellKey(cx, cy));
        if (team === undefined) continue;
        const c = camera.worldToScreen(cellCenter(cx, cy));
        ctx.fillStyle =
          team === Team.Player
            ? colorToCSS(Colors.powergenerator_coverage, 0.32)
            : colorToCSS(Colors.enemyfire, 0.22);
        ctx.fillRect(c.x - cellPx / 2, c.y - cellPx / 2, cellPx, cellPx);

        // Inner glow square for friendly conduits — gives the network a
        // sense of being "alive" without a heavy particle cost.
        if (team === Team.Player) {
          ctx.strokeStyle = colorToCSS(Colors.particles_friendly_exhaust, 0.55);
          ctx.lineWidth = 1;
          ctx.strokeRect(
            c.x - cellPx / 2 + 2,
            c.y - cellPx / 2 + 2,
            cellPx - 4,
            cellPx - 4,
          );
        }
      }
    }

    // 2. Grid lines — only drawn when sufficiently zoomed in to avoid clutter.
    if (camera.zoom >= 0.5) {
      ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.08);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let cx = cxMin; cx <= cxMax + 1; cx++) {
        const wx = cx * GRID_CELL_SIZE;
        const a = camera.worldToScreen(new Vec2(wx, cyMin * GRID_CELL_SIZE));
        const b = camera.worldToScreen(new Vec2(wx, (cyMax + 1) * GRID_CELL_SIZE));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let cy = cyMin; cy <= cyMax + 1; cy++) {
        const wy = cy * GRID_CELL_SIZE;
        const a = camera.worldToScreen(new Vec2(cxMin * GRID_CELL_SIZE, wy));
        const b = camera.worldToScreen(new Vec2((cxMax + 1) * GRID_CELL_SIZE, wy));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
  }

  /**
   * Draw a paint cursor highlighting the cell the mouse is currently over.
   * `mode` controls the colour (paint = friendly green, erase = red).
   */
  drawPaintCursor(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    cell: CellCoord,
    mode: 'paint' | 'erase',
  ): void {
    const c = camera.worldToScreen(cellCenter(cell.cx, cell.cy));
    const cellPx = GRID_CELL_SIZE * camera.zoom;
    const color =
      mode === 'paint'
        ? colorToCSS(Colors.radar_friendly_status, 0.85)
        : colorToCSS(Colors.alert1, 0.85);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(c.x - cellPx / 2, c.y - cellPx / 2, cellPx, cellPx);
    ctx.setLineDash([]);
  }
}
