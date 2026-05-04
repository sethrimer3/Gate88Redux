/**
 * Phase-2 hold-to-open radial menus for Gate88.
 *
 * Three menus, each opened by holding a key:
 *   Z → Build       (general buildings + turrets)
 *   X → Research    (all non-researched items from RESEARCH_COST table)
 *   C → Command     (issue tactical orders to Red / Green / Blue fighter groups)
 *
 * Each menu draws a radial of items centred on the player's screen position.
 * The item closest in angle to the mouse cursor is highlighted.
 * LMB confirms, releasing the hold key closes, RMB goes back one level or closes.
 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS } from './colors.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { GameState } from './gamestate.js';
import { ShipGroup, TacticalOrder, Team } from './entities.js';
import { RESEARCH_COST, CONDUIT_COST, ACTIVE_RESEARCH_ITEMS } from './constants.js';
import { worldToCell, cellKey, cellCenter, GRID_CELL_SIZE } from './grid.js';
import { defsByTier, BuildDef, getBuildDef } from './builddefs.js';

/** Radius (px) from the menu centre at which items are placed. */
const ITEM_RADIUS = 110;

/** Radius (px) of each item circle. */
const ITEM_CIRCLE_R = 40;

/**
 * Minimum distance (px) from the menu centre before any item is considered
 * hovered. Prevents an accidental click when the cursor is right on the ship.
 */
const MIN_SELECT_DIST = 32;

// ---------------------------------------------------------------------------
// Public types (kept compatible with game.ts's handleActionResult)
// ---------------------------------------------------------------------------

export type MenuResult =
  | { action: 'none' }
  | { action: 'build'; buildingType: string }
  | { action: 'order'; group: ShipGroup; order: string }
  | { action: 'research'; item: string };

// Re-export kept for convenience so callers don't need to know the origin
// of TacticalOrder; remove this if the dependency becomes confusing.
export { TacticalOrder };

// ---------------------------------------------------------------------------
// Radial item data
// ---------------------------------------------------------------------------

interface RadialItem {
  /** Display label; '\n' splits into multiple lines inside the circle. */
  label: string;
  /** Small secondary line (e.g. "$120"). */
  sublabel?: string;
  /** Grayed-out; click is ignored. */
  disabled?: boolean;
  /** Drill into sub-menu on confirm. */
  children?: RadialItem[];
  /** Leaf: place a building of this type. */
  buildingType?: string;
  /** Leaf: issue a tactical order to this group. */
  orderGroup?: ShipGroup;
  tacticalOrder?: TacticalOrder;
  /** Leaf: start researching this item. */
  researchItem?: string;
  /** Hide from the live-filtered item list when false. */
  condition?: (state: GameState) => boolean;
}

// ---------------------------------------------------------------------------
// Angle helpers
// ---------------------------------------------------------------------------

/** Angle (radians) for item i out of n, starting from the top (−π/2) clockwise. */
function itemAngle(i: number, n: number): number {
  return -Math.PI / 2 + (Math.PI * 2 / n) * i;
}

/**
 * Return the index of the item whose angle is closest to the mouse direction
 * from the menu centre, or −1 if the cursor is within MIN_SELECT_DIST.
 */
function getHoveredIndex(items: RadialItem[], centre: Vec2, mouse: Vec2): number {
  const dx = mouse.x - centre.x;
  const dy = mouse.y - centre.y;
  if (Math.hypot(dx, dy) < MIN_SELECT_DIST) return -1;
  const mouseAngle = Math.atan2(dy, dx);
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < items.length; i++) {
    let diff = mouseAngle - itemAngle(i, items.length);
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const abs = Math.abs(diff);
    if (abs < bestDiff) { bestDiff = abs; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Menu data builders
// ---------------------------------------------------------------------------

/** Convert a BuildDef to a RadialItem, gating affordability against `state`. */
function defToRadialItem(def: BuildDef, state: GameState): RadialItem {
  return {
    label: def.radialLabel ?? def.label,
    sublabel: `$${def.cost}`,
    buildingType: def.key,
    disabled: state.resources < def.cost,
  };
}

function isBuildDefAvailable(def: BuildDef, state: GameState): boolean {
  return !def.researchKey || state.researchedItems.has(def.researchKey);
}

function buildGeneralItems(state: GameState): RadialItem[] {
  const items: RadialItem[] = [];
  for (const def of defsByTier('general')) {
    // Hidden defs (e.g. command post) are only revealed when the player has
    // no command post — they own that placement slot.
    if (def.hidden) {
      if (def.key === 'commandpost' && !state.getPlayerCommandPost()) {
        items.push(defToRadialItem(def, state));
      }
      continue;
    }
    if (isBuildDefAvailable(def, state)) items.push(defToRadialItem(def, state));
  }
  return items;
}

function buildTurretItems(state: GameState): RadialItem[] {
  return defsByTier('turret')
    .filter((d) => isBuildDefAvailable(d, state))
    .map((d) => defToRadialItem(d, state));
}

function buildBuildRoot(state: GameState): RadialItem[] {
  return [
    { label: 'General\nBuildings', children: buildGeneralItems(state) },
    { label: 'Turrets',            children: buildTurretItems(state)   },
  ];
}

function buildResearchRoot(state: GameState): RadialItem[] {
  const items: RadialItem[] = [];
  const keys = ACTIVE_RESEARCH_ITEMS;
  for (const key of keys) {
    if (state.researchedItems.has(key)) continue;
    items.push({
      label: String(key),
      sublabel: `$${RESEARCH_COST[key]}`,
      researchItem: String(key),
      disabled: state.resources < RESEARCH_COST[key],
    });
  }
  return items;
}

function buildGroupOrders(group: ShipGroup): RadialItem[] {
  return [
    { label: 'Attack\nTarget',  tacticalOrder: TacticalOrder.AttackTarget,  orderGroup: group },
    { label: 'Defend\nArea',    tacticalOrder: TacticalOrder.DefendArea,    orderGroup: group },
    { label: 'Dock',            tacticalOrder: TacticalOrder.Dock,          orderGroup: group },
    { label: 'Escort\nPlayer',  tacticalOrder: TacticalOrder.EscortPlayer,  orderGroup: group },
    { label: 'Harass\nPower',   tacticalOrder: TacticalOrder.HarassPower,   orderGroup: group },
  ];
}

function buildCommandRoot(_state: GameState): RadialItem[] {
  return [
    { label: 'Red\nGroup',   children: buildGroupOrders(ShipGroup.Red)   },
    { label: 'Green\nGroup', children: buildGroupOrders(ShipGroup.Green) },
    { label: 'Blue\nGroup',  children: buildGroupOrders(ShipGroup.Blue)  },
  ];
}

// ---------------------------------------------------------------------------
// HoldMenu — one instance per hold key
// ---------------------------------------------------------------------------

class HoldMenu {
  open = false;

  private stack: RadialItem[][] = [];
  private centre: Vec2 = new Vec2(0, 0);
  private hoveredIdx = -1;

  constructor(
    private readonly holdKey: string,
    private readonly rootFactory: (state: GameState) => RadialItem[],
    private readonly title: string,
  ) {}

  private currentItems(state: GameState): RadialItem[] {
    const raw = this.stack[this.stack.length - 1] ?? [];
    return raw.filter((i) => !i.condition || i.condition(state));
  }

  update(state: GameState, camera: Camera): MenuResult {
    // Hold key opens/keeps open; release closes. Input normalization means
    // the Shift-shifted variant is handled automatically.
    const keyDown = Input.isDown(this.holdKey);
    if (keyDown && !this.open) {
      this.open = true;
      this.stack = [this.rootFactory(state)];
      Audio.playSound('menucursor');
    } else if (!keyDown && this.open) {
      this.open = false;
      this.stack = [];
    }

    if (!this.open) return { action: 'none' };

    // Cache the player's screen position for draw().
    this.centre = camera.worldToScreen(state.player.position);

    // RMB → go back one level or close.
    if (Input.mouse2Pressed) {
      Input.consumeMouseButton(2);
      if (this.stack.length > 1) {
        this.stack.pop();
        Audio.playSound('menucursor');
      } else {
        this.open = false;
        this.stack = [];
      }
      return { action: 'none' };
    }

    const items = this.currentItems(state);
    this.hoveredIdx = items.length > 0
      ? getHoveredIndex(items, this.centre, Input.mousePos)
      : -1;

    // LMB confirm (only on fresh press, not hold).
    if (Input.mousePressed && this.hoveredIdx >= 0) {
      const item = items[this.hoveredIdx];
      if (!item.disabled) {
        Input.consumeMouseButton(0);
        return this.confirm(item, state);
      }
    }

    return { action: 'none' };
  }

  private confirm(item: RadialItem, state: GameState): MenuResult {
    Audio.playSound('menuselection');

    if (item.children && item.children.length > 0) {
      const filtered = item.children.filter((i) => !i.condition || i.condition(state));
      if (filtered.length > 0) this.stack.push(filtered);
      return { action: 'none' };
    }

    // Leaf — close the menu and emit the result.
    this.open = false;
    this.stack = [];

    if (item.buildingType) {
      return { action: 'build', buildingType: item.buildingType };
    }
    if (item.orderGroup !== undefined && item.tacticalOrder !== undefined) {
      return { action: 'order', group: item.orderGroup, order: item.tacticalOrder };
    }
    if (item.researchItem) {
      return { action: 'research', item: item.researchItem };
    }
    return { action: 'none' };
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (!this.open) return;

    const items = this.currentItems(state);
    const cx = this.centre.x;
    const cy = this.centre.y;

    // Central hub disc.
    ctx.fillStyle = colorToCSS(Colors.menu_background, 0.78);
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.9);
    ctx.fillText(this.title, cx, cy - (this.stack.length > 1 ? 7 : 0));
    if (this.stack.length > 1) {
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.55);
      ctx.fillText('RMB=back', cx, cy + 9);
    }

    if (items.length === 0) {
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.55);
      ctx.fillText('(nothing available)', cx, cy - 75);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const angle = itemAngle(i, items.length);
      const ix = cx + Math.cos(angle) * ITEM_RADIUS;
      const iy = cy + Math.sin(angle) * ITEM_RADIUS;
      const hovered = i === this.hoveredIdx;

      // Connector line.
      ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, hovered ? 0.45 : 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      // Item circle.
      if (item.disabled) {
        ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.15);
      } else if (hovered) {
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.5);
      } else {
        ctx.fillStyle = colorToCSS(Colors.menu_background, 0.5);
      }
      ctx.beginPath();
      ctx.arc(ix, iy, ITEM_CIRCLE_R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = item.disabled
        ? colorToCSS(Colors.radar_gridlines, 0.25)
        : hovered
          ? colorToCSS(Colors.radar_friendly_status, 0.95)
          : colorToCSS(Colors.radar_gridlines, 0.45);
      ctx.lineWidth = hovered ? 2 : 1;
      ctx.stroke();

      // Label (split on '\n').
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = item.disabled
        ? colorToCSS(Colors.radar_gridlines, 0.35)
        : hovered
          ? colorToCSS(Colors.radar_friendly_status)
          : colorToCSS(Colors.general_building, 0.9);

      const lines = item.label.split('\n');
      const lineH = 11;
      const hasSubLabel = !!item.sublabel;
      // Shift label up slightly when there's a cost sublabel below it.
      const blockTop = hasSubLabel
        ? iy - (lines.length * lineH) / 2 - 5
        : iy - (lines.length * lineH) / 2 + lineH / 2;
      for (let l = 0; l < lines.length; l++) {
        ctx.fillText(lines[l], ix, blockTop + l * lineH);
      }

      if (item.sublabel) {
        ctx.font = '9px "Courier New", monospace';
        ctx.fillStyle = item.disabled
          ? colorToCSS(Colors.radar_gridlines, 0.3)
          : hovered
            ? colorToCSS(Colors.radar_friendly_status, 0.75)
            : colorToCSS(Colors.factory_detail, 0.9);
        ctx.fillText(item.sublabel, ix, blockTop + lines.length * lineH + 2);
      }

      // Sub-menu arrow indicator.
      if (item.children && item.children.length > 0) {
        ctx.font = '10px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.6);
        ctx.fillText('▸', ix + ITEM_CIRCLE_R - 13, iy - ITEM_CIRCLE_R + 15);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PaintMenu — Q-hold conduit paint mode (PR3)
// ---------------------------------------------------------------------------

/**
 * Hold Q to enter conduit paint mode. While active:
 *   - The cell under the mouse cursor is highlighted.
 *   - LMB (or LMB-drag) paints player conduits.
 *   - RMB (or RMB-drag) erases conduits.
 *   - Releasing Q exits paint mode.
 *
 * Paint mode sets `ActionMenu.placementMode = true` so primary fire is
 * suppressed by `Game.updatePlayerFiring()`.
 *
 * Painting is rate-limited to one cell change per (cell, drag) so a single
 * LMB-press can paint a row by dragging without the same cell being touched
 * dozens of times per second.
 */
class PaintMenu {
  open = false;

  /** Cells already touched during the current drag, to avoid spamming Audio. */
  private touchedThisDrag = new Set<string>();
  /** Whether LMB or RMB started the current drag. */
  private dragMode: 'paint' | 'erase' | null = null;

  /**
   * Run paint-mode logic. Returns true if the menu is currently active.
   * Caller is responsible for calling `Input.consumeMouseButton` on the
   * frame the drag begins so the click doesn't fire a special / weapon.
   */
  update(state: GameState, camera: Camera): boolean {
    const keyDown = Input.isDown('q');
    if (keyDown && !this.open) {
      this.open = true;
      this.touchedThisDrag.clear();
      this.dragMode = null;
    } else if (!keyDown && this.open) {
      this.open = false;
      this.touchedThisDrag.clear();
      this.dragMode = null;
      return false;
    }
    if (!this.open) return false;

    // Determine current paint/erase state.
    // Note: fire is already suppressed via placementMode=true, so we do NOT
    // consume the mouse buttons here — doing so would clear mouseDown before
    // the hold-detection block below, preventing any paint from registering.
    if (Input.mousePressed) {
      this.dragMode = 'paint';
      this.touchedThisDrag.clear();
    } else if (Input.mouse2Pressed) {
      this.dragMode = 'erase';
      this.touchedThisDrag.clear();
    }

    if (Input.mouseDown) {
      this.dragMode = 'paint';
    } else if (Input.mouse2Down) {
      this.dragMode = 'erase';
    } else {
      this.dragMode = null;
      this.touchedThisDrag.clear();
    }

    if (this.dragMode !== null) {
      const worldPos = camera.screenToWorld(Input.mousePos);
      const { cx, cy } = worldToCell(worldPos);
      const key = cellKey(cx, cy);
      if (!this.touchedThisDrag.has(key)) {
        this.touchedThisDrag.add(key);
        if (this.dragMode === 'paint') {
          if (!state.grid.hasConduit(cx, cy) && !state.grid.hasPendingConduit(cx, cy)) {
            if (state.resources >= CONDUIT_COST) {
              state.resources -= CONDUIT_COST;
              state.grid.queueConduit(cx, cy, Team.Player);
            }
          }
        } else if (this.dragMode === 'erase') {
          if (state.grid.conduitTeam(cx, cy) === Team.Player) {
            state.grid.removeConduit(cx, cy);
            state.power.markDirty();
            Audio.playSound('menucursor');
          }
        }
      }
    }

    return true;
  }

  /** Highlight the cell currently under the mouse cursor. */
  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
    _screenH: number,
  ): void {
    if (!this.open) return;
    const worldPos = camera.screenToWorld(Input.mousePos);
    const cell = worldToCell(worldPos);
    const mode: 'paint' | 'erase' = this.dragMode === 'erase' ? 'erase' : 'paint';
    state.grid.drawPaintCursor(ctx, camera, cell, mode);

    // Top-of-screen hint banner.
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.85);
    ctx.fillText(
      `[Q] Conduit Paint  •  LMB paint ($${CONDUIT_COST}/cell)  •  RMB erase  •  release Q to exit`,
      screenW * 0.5,
      24,
    );
    // Conduit count for feedback.
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(
      `conduits: ${state.grid.conduitCount()}  •  queued: ${state.grid.pendingConduitCount()}  •  cell ${cell.cx},${cell.cy}  •  resources: $${Math.floor(state.resources)}`,
      screenW * 0.5,
      40,
    );
  }
}

// ---------------------------------------------------------------------------
// ActionMenu — public façade, same shape as the original so game.ts is minimal
// ---------------------------------------------------------------------------

export class ActionMenu {
  private buildMenu    = new HoldMenu('z', buildBuildRoot,    '[Z] Build');
  private researchMenu = new HoldMenu('x', buildResearchRoot, '[X] Research');
  private commandMenu  = new HoldMenu('c', buildCommandRoot,  '[C] Command');
  private paintMenu    = new PaintMenu();

  /** True when any of the four hold menus / paint mode is currently open. */
  open = false;

  /**
   * PR3: when the Q-hold paint mode is active, `placementMode` is true and
   * `placementType` is set to 'conduit'. Game.updatePlayerFiring() already
   * gates fire on `placementMode`, so the LMB used to paint won't fire.
   * Also true during pending building placement so LMB places the building
   * rather than firing a weapon.
   */
  placementMode = false;
  placementType: string | null = null;

  /**
   * When the player selects a building type from the Z menu, it is stored
   * here until they click a valid location to confirm placement. While set,
   * `placementMode` is true and `open` is true so weapon fire is suppressed.
   */
  private pendingBuildType: string | null = null;

  update(state: GameState, camera: Camera): MenuResult {
    // Paint mode runs first so it consumes mouse-down before radial menus see it.
    const paintOpen = this.paintMenu.update(state, camera);

    // --- Pending building placement mode ---
    // When a build type was selected from the Z menu, wait for the player to
    // click a valid cell before finalising the placement.
    if (this.pendingBuildType !== null) {
      this.placementMode = true;
      this.placementType = this.pendingBuildType;
      this.open = true;

      // ESC or RMB cancels placement.
      if (Input.wasPressed('Escape') || Input.mouse2Pressed) {
        if (Input.mouse2Pressed) Input.consumeMouseButton(2);
        this.pendingBuildType = null;
        this.placementMode = false;
        this.placementType = null;
        this.open = false;
        return { action: 'none' };
      }

      // LMB confirms placement at the cell under the cursor.
      if (Input.mousePressed) {
        Input.consumeMouseButton(0);
        const type = this.pendingBuildType;
        this.pendingBuildType = null;
        this.placementMode = false;
        this.placementType = null;
        this.open = false;
        return { action: 'build', buildingType: type };
      }

      return { action: 'none' };
    }

    this.placementMode = paintOpen;
    this.placementType = paintOpen ? 'conduit' : null;

    // Radial menus are mutually exclusive with paint mode.
    let br: MenuResult = { action: 'none' };
    let rr: MenuResult = { action: 'none' };
    let cr: MenuResult = { action: 'none' };
    if (!paintOpen) {
      br = this.buildMenu.update(state, camera);
      rr = this.researchMenu.update(state, camera);
      cr = this.commandMenu.update(state, camera);
    }

    // Intercept build results — enter placement mode instead of placing immediately.
    if (br.action === 'build') {
      this.pendingBuildType = br.buildingType;
      Audio.playSound('menucursor');
      br = { action: 'none' };
    }

    this.open =
      paintOpen ||
      this.buildMenu.open ||
      this.researchMenu.open ||
      this.commandMenu.open ||
      this.pendingBuildType !== null;

    if (br.action !== 'none') return br;
    if (rr.action !== 'none') return rr;
    if (cr.action !== 'none') return cr;
    return { action: 'none' };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    this.buildMenu.draw(ctx, state);
    this.researchMenu.draw(ctx, state);
    this.commandMenu.draw(ctx, state);
    this.paintMenu.draw(ctx, state, camera, screenW, screenH);
    this.drawPlacementCursor(ctx, state, camera, screenW);
  }

  /** Draw placement preview when the player is choosing a build location. */
  private drawPlacementCursor(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
  ): void {
    if (this.pendingBuildType === null) return;

    const worldPos = camera.screenToWorld(Input.mousePos);
    const cell = worldToCell(worldPos);
    const center = cellCenter(cell.cx, cell.cy);
    const screen = camera.worldToScreen(center);
    const cellPx = GRID_CELL_SIZE * camera.zoom;

    const def = getBuildDef(this.pendingBuildType);
    const status = def
      ? state.getPlacementStatus(def, center, Team.Player)
      : { valid: true, reason: 'OK' };
    const cursorColor = status.valid
      ? colorToCSS(Colors.radar_friendly_status, 0.9)
      : colorToCSS(Colors.alert1, 0.9);

    // Cell highlight
    ctx.strokeStyle = cursorColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(screen.x - cellPx / 2, screen.y - cellPx / 2, cellPx, cellPx);
    ctx.setLineDash([]);

    // Ghost dot at center
    ctx.fillStyle = status.valid
      ? colorToCSS(Colors.radar_friendly_status, 0.35)
      : colorToCSS(Colors.alert1, 0.2);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, cellPx * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Top-of-screen hint banner
    const label = def ? `${def.label}  $${def.cost}` : this.pendingBuildType;
    const suffix = status.valid ? '' : ` - ${status.reason}`;
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = cursorColor;
    ctx.fillText(
      `[Placing: ${label}] - LMB to place - RMB / Esc to cancel${suffix}`,
      screenW * 0.5,
      24,
    );
  }
}
