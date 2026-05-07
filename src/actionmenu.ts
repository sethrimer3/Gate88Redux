/**
 * Phase-2 hold-to-open radial menus for Gate88.
 *
 * Three menus, each opened by holding a key:
 *   Z -> Ship       (ship stats, upgrades, and weapon selection)
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
import { SHIP_WEAPON_OPTIONS, type ShipWeaponId } from './ship.js';
import { worldToCell, cellKey, cellCenter, footprintCenter, footprintOrigin, GRID_CELL_SIZE } from './grid.js';
import { defsByTier, BuildDef, getBuildDef } from './builddefs.js';
import { drawDecodedText } from './decodeText.js';
import { isConfluenceFaction, isSynonymousFaction, CONFLUENCE_PLACEMENT_DISTANCE, CONFLUENCE_PLACEMENT_TOLERANCE, CONFLUENCE_BASE_RADIUS } from './confluence.js';

/** Radius (px) from the menu centre at which items are placed. */
const ITEM_RADIUS = 110;

/** Radius (px) of each item circle. */
const ITEM_CIRCLE_R = 40;

function fillMenuPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, 'rgba(4,21,45,0.94)');
  grad.addColorStop(1, 'rgba(18,7,37,0.94)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

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
  | { action: 'build'; buildingType: string; cell?: { cx: number; cy: number } }
  | { action: 'order'; group: ShipGroup | 'all'; order: string }
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
  orderGroup?: ShipGroup | 'all';
  tacticalOrder?: TacticalOrder;
  /** Leaf: start researching this item. */
  researchItem?: string;
  /** Informational disabled entry that never emits a menu result. */
  infoOnly?: boolean;
  /** Hide from the live-filtered item list when false. */
  condition?: (state: GameState) => boolean;
}

const RESEARCH_LABELS: Record<string, string> = {
  shipHp: 'HP',
  shipSpeedEnergy: 'Speed +\nEnergy Regen',
  shipFireSpeed: 'Fire\nSpeed',
  shipShield: 'Shield',
  weaponGatling: 'Gatling',
  weaponLaser: 'Laser',
  weaponGuidedMissile: 'Guided\nMissile',
  missileturret: 'Missile\nTurret',
  exciterturret: 'Exciter\nTurret',
  massdriverturret: 'Mass Driver\nTurret',
  regenturret: 'Regen\nTurret',
  bomberyard: 'Bomber\nYard',
  advancedFighters: 'Advanced\nFighters',
};

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
  for (const def of defsByTier('structure')) {
    // Hidden defs (e.g. command post) are only revealed when the player has
    // no command post — they own that placement slot.
    if (def.hidden) {
      if (def.key === 'commandpost' && !state.getPlayerCommandPost() && state.player.alive) {
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

function buildYardItems(state: GameState): RadialItem[] {
  return defsByTier('yard')
    .filter((d) => isBuildDefAvailable(d, state))
    .map((d) => defToRadialItem(d, state));
}

function availableBuildDefs(state: GameState): BuildDef[] {
  const synonymousKeys = new Set(['commandpost', 'factory', 'researchlab', 'missileturret']);
  return [
    ...defsByTier('structure'),
    ...defsByTier('turret'),
    ...defsByTier('yard'),
  ].filter((def) => {
    if (isSynonymousFaction(state.factionByTeam, Team.Player) && !synonymousKeys.has(def.key)) return false;
    if (def.hidden) return def.key === 'commandpost' && !state.getPlayerCommandPost() && state.player.alive;
    if (def.tier === 'turret') return true;
    return isBuildDefAvailable(def, state);
  });
}

function buildBuildRoot(state: GameState): RadialItem[] {
  return [
    { label: 'Structures', children: buildGeneralItems(state) },
    { label: 'Turrets',            children: buildTurretItems(state)   },
    { label: 'Yards',              children: buildYardItems(state)     },
  ];
}

function buildResearchRoot(state: GameState): RadialItem[] {
  const makeResearchItem = (key: string): RadialItem | null => {
    if (state.researchedItems.has(key)) return null;
    if (!(ACTIVE_RESEARCH_ITEMS as readonly string[]).includes(key)) return null;
    const researchKey = key as keyof typeof RESEARCH_COST;
    return {
      label: RESEARCH_LABELS[key] ?? key,
      sublabel: `$${RESEARCH_COST[researchKey]}`,
      researchItem: key,
      disabled: state.resources < RESEARCH_COST[researchKey],
    };
  };
  const category = (label: string, keys: string[], extras: RadialItem[] = []): RadialItem => ({
    label,
    children: [
      ...extras,
      ...keys.map((key) => makeResearchItem(key)).filter((item): item is RadialItem => item !== null),
    ],
  });
  return [
    category('Structures', ['missileturret', 'exciterturret', 'massdriverturret', 'regenturret', 'bomberyard']),
    category('Ship', ['shipHp', 'shipSpeedEnergy', 'shipFireSpeed', 'shipShield']),
    category('Fighters', ['advancedFighters']),
    category('Weapons', ['weaponGatling', 'weaponLaser', 'weaponGuidedMissile'], [
      { label: 'Cannon', sublabel: 'Ready', disabled: true, infoOnly: true },
    ]),
  ];
}

function buildGroupOrders(group: ShipGroup): RadialItem[] {
  return [
    { label: 'Protect\nBase',   tacticalOrder: TacticalOrder.ProtectBase,  orderGroup: group },
    { label: 'Set\nWaypoint',   tacticalOrder: TacticalOrder.SetWaypoint,  orderGroup: group },
    { label: 'Follow\nPlayer',  tacticalOrder: TacticalOrder.FollowPlayer, orderGroup: group },
    { label: 'Dock',            tacticalOrder: TacticalOrder.Dock,         orderGroup: group },
  ];
}

function buildAllOrders(): RadialItem[] {
  return [
    { label: 'Protect\nBase',   tacticalOrder: TacticalOrder.ProtectBase,  orderGroup: 'all' },
    { label: 'Set\nWaypoint',   tacticalOrder: TacticalOrder.SetWaypoint,  orderGroup: 'all' },
    { label: 'Follow\nPlayer',  tacticalOrder: TacticalOrder.FollowPlayer, orderGroup: 'all' },
    { label: 'Dock',            tacticalOrder: TacticalOrder.Dock,         orderGroup: 'all' },
  ];
}

function buildCommandRoot(_state: GameState): RadialItem[] {
  return [
    { label: '1',   children: buildGroupOrders(ShipGroup.Red)   },
    { label: '2',   children: buildGroupOrders(ShipGroup.Green) },
    { label: '3',   children: buildGroupOrders(ShipGroup.Blue)  },
    { label: 'ALL', children: buildAllOrders() },
  ];
}

function gridLineCells(from: { cx: number; cy: number }, to: { cx: number; cy: number }): Array<{ cx: number; cy: number }> {
  const cells: Array<{ cx: number; cy: number }> = [];
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  let lastKey = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(from.cx + dx * t);
    const cy = Math.round(from.cy + dy * t);
    const key = cellKey(cx, cy);
    if (key === lastKey) continue;
    lastKey = key;
    cells.push({ cx, cy });
  }
  return cells;
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
    ctx.font = '10px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.9);
    ctx.fillText(this.title, cx, cy - (this.stack.length > 1 ? 7 : 0));
    if (this.stack.length > 1) {
      ctx.font = '8px "Poiret One", sans-serif';
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.55);
      ctx.fillText('RMB=back', cx, cy + 9);
    }

    if (items.length === 0) {
      ctx.font = '10px "Poiret One", sans-serif';
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
      ctx.font = '10px "Poiret One", sans-serif';
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
        ctx.font = '9px "Poiret One", sans-serif';
        ctx.fillStyle = item.disabled
          ? colorToCSS(Colors.radar_gridlines, 0.3)
          : hovered
            ? colorToCSS(Colors.radar_friendly_status, 0.75)
            : colorToCSS(Colors.factory_detail, 0.9);
        ctx.fillText(item.sublabel, ix, blockTop + lines.length * lineH + 2);
      }

      // Sub-menu arrow indicator.
      if (item.children && item.children.length > 0) {
        ctx.font = '10px "Poiret One", sans-serif';
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
          if (state.eraseBlueprintAt(worldPos, Team.Player)) {
            Audio.playSound('menucursor');
            return true;
          }
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
    ctx.font = '12px "Poiret One", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.85);
    ctx.fillText(
      `[Q] Conduit Paint  •  LMB paint ($${CONDUIT_COST}/cell)  •  RMB erase  •  release Q to exit`,
      screenW * 0.5,
      24,
    );
    // Conduit count for feedback.
    ctx.font = '10px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(
      `conduits: ${state.grid.conduitCount()}  •  queued: ${state.grid.pendingConduitCount()}  •  cell ${cell.cx},${cell.cy}  •  resources: $${Math.floor(state.resources)}`,
      screenW * 0.5,
      40,
    );
  }
}

class LeftHoldMenu {
  open = false;

  private stack: RadialItem[][] = [];
  private selectedIdx = 0;
  private hoveredIdx = -1;
  private openedAt = 0;
  private readonly rowRects: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];

  constructor(
    private readonly holdKey: string,
    private readonly rootFactory: (state: GameState) => RadialItem[],
    private readonly title: string,
  ) {}

  private currentItems(state: GameState): RadialItem[] {
    const raw = this.stack[this.stack.length - 1] ?? [];
    return raw.filter((i) => !i.condition || i.condition(state));
  }

  update(state: GameState, _camera: Camera): MenuResult {
    const keyDown = Input.isDown(this.holdKey);
    if (keyDown && !this.open) {
      this.open = true;
      this.stack = [this.rootFactory(state)];
      this.selectedIdx = 0;
      this.openedAt = performance.now() * 0.001;
      Audio.playSound('menucursor');
    } else if (!keyDown && this.open) {
      this.open = false;
      this.stack = [];
    }
    if (!this.open) return { action: 'none' };

    if (Input.mouse2Pressed) {
      Input.consumeMouseButton(2);
      if (this.stack.length > 1) {
        this.stack.pop();
        this.selectedIdx = 0;
        Audio.playSound('menucursor');
      } else {
        this.open = false;
        this.stack = [];
      }
      return { action: 'none' };
    }

    const items = this.currentItems(state);
    this.normalizeSelectedIndex(items);
    if (Input.wheelDelta !== 0 && items.length > 0) {
      this.selectedIdx = this.nextSelectableIndex(items, this.selectedIdx, Input.wheelDelta > 0 ? 1 : -1);
      Audio.playSound('menucursor');
    }

    this.hoveredIdx = -1;
    for (const rect of this.rowRects) {
      if (
        Input.mousePos.x >= rect.x && Input.mousePos.x <= rect.x + rect.w &&
        Input.mousePos.y >= rect.y && Input.mousePos.y <= rect.y + rect.h
      ) {
        this.hoveredIdx = rect.index;
        this.selectedIdx = rect.index;
        break;
      }
    }

    if (Input.mousePressed) {
      const index = this.hoveredIdx >= 0 ? this.hoveredIdx : this.selectedIdx;
      const item = items[index];
      if (item && !item.disabled) {
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
      if (filtered.length > 0) {
        this.stack.push(filtered);
        this.selectedIdx = 0;
      }
      return { action: 'none' };
    }
    this.open = false;
    this.stack = [];
    if (item.buildingType) return { action: 'build', buildingType: item.buildingType };
    if (item.orderGroup !== undefined && item.tacticalOrder !== undefined) {
      return { action: 'order', group: item.orderGroup, order: item.tacticalOrder };
    }
    if (item.researchItem) return { action: 'research', item: item.researchItem };
    return { action: 'none' };
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (!this.open) return;
    const items = this.currentItems(state);
    this.normalizeSelectedIndex(items);
    this.rowRects.length = 0;

    const x = 12;
    const y = 96;
    const w = 230;
    const rowH = 34;
    const gap = 6;
    const headerH = 42;
    const panelH = headerH + Math.max(1, items.length) * (rowH + gap) + 14;

    ctx.save();
    fillMenuPanel(ctx, x, y, w, panelH);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, panelH - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.95);
    drawDecodedText(ctx, this.title, x + 12, y + 24, 14, this.openedAt);
    if (this.stack.length > 1) {
      ctx.font = '10px "Poiret One", sans-serif';
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.55);
      ctx.fillText('RMB back', x + w - 70, y + 15);
    }

    if (items.length === 0) {
      ctx.font = '10px "Poiret One", sans-serif';
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.55);
      ctx.fillText('(nothing available)', x + 12, y + headerH);
      ctx.restore();
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowY = y + headerH + i * (rowH + gap);
      const active = i === this.selectedIdx || i === this.hoveredIdx;
      this.rowRects.push({ index: i, x: x + 10, y: rowY, w: w - 20, h: rowH });
      ctx.fillStyle = item.disabled
        ? colorToCSS(Colors.radar_gridlines, 0.13)
        : active
          ? colorToCSS(Colors.radar_friendly_status, 0.27)
          : colorToCSS(Colors.friendly_background, 0.45);
      ctx.fillRect(x + 10, rowY, w - 20, rowH);
      ctx.strokeStyle = item.disabled
        ? colorToCSS(Colors.radar_gridlines, 0.22)
        : active
          ? colorToCSS(Colors.radar_friendly_status, 0.95)
          : colorToCSS(Colors.radar_gridlines, 0.45);
      ctx.strokeRect(x + 10.5, rowY + 0.5, w - 21, rowH - 1);
      ctx.font = '10px "Poiret One", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = item.disabled
        ? colorToCSS(Colors.radar_gridlines, 0.35)
        : active
          ? colorToCSS(Colors.radar_friendly_status)
          : colorToCSS(Colors.general_building, 0.9);
      drawDecodedText(ctx, item.label.replace(/\n/g, ' '), x + 20, rowY + rowH * 0.5, 10, this.openedAt);
      ctx.textAlign = 'right';
      if (item.sublabel) {
        ctx.fillStyle = item.disabled
          ? colorToCSS(Colors.radar_gridlines, 0.3)
          : active
            ? colorToCSS(Colors.radar_friendly_status, 0.75)
            : colorToCSS(Colors.factory_detail, 0.9);
        ctx.fillText(item.sublabel, x + w - 20, rowY + rowH * 0.5);
      } else if (item.children && item.children.length > 0) {
        ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.6);
        ctx.fillText('>', x + w - 20, rowY + rowH * 0.5);
      }
    }
    ctx.restore();
  }

  private normalizeSelectedIndex(items: RadialItem[]): void {
    if (items.length === 0) {
      this.selectedIdx = 0;
      return;
    }
    if (this.selectedIdx >= items.length) this.selectedIdx = items.length - 1;
    if (items[this.selectedIdx]?.disabled) {
      this.selectedIdx = this.nextSelectableIndex(items, this.selectedIdx, 1);
    }
  }

  private nextSelectableIndex(items: RadialItem[], start: number, dir: number): number {
    let idx = start;
    for (let i = 0; i < items.length; i++) {
      idx = (idx + dir + items.length) % items.length;
      if (!items[idx]?.disabled) return idx;
    }
    return start;
  }
}

class ShipMenu {
  open = false;
  private readonly weaponRects: Array<{ id: ShipWeaponId; x: number; y: number; w: number; h: number }> = [];

  update(state: GameState): boolean {
    const keyDown = Input.isDown('z');
    if (keyDown && !this.open) {
      this.open = true;
      Audio.playSound('menucursor');
    } else if (!keyDown && this.open) {
      this.open = false;
      return false;
    }
    if (!this.open) return false;

    if (Input.wheelDelta !== 0) {
      // Prevent weapon switching during gatling overheat / overdrive lockdown
      if (state.player.canSwitchWeapon()) {
        state.player.cyclePrimaryWeapon(Input.wheelDelta > 0 ? 1 : -1, (id) => this.weaponUnlocked(state, id));
        Audio.playSound('menucursor');
      }
    }

    if (Input.mousePressed) {
      for (const rect of this.weaponRects) {
        if (
          Input.mousePos.x >= rect.x && Input.mousePos.x <= rect.x + rect.w &&
          Input.mousePos.y >= rect.y && Input.mousePos.y <= rect.y + rect.h
        ) {
          if (this.weaponUnlocked(state, rect.id) && state.player.canSwitchWeapon()) {
            state.player.selectPrimaryWeapon(rect.id);
            Audio.playSound('menuselection');
          } else {
            Audio.playSound('menucursor');
          }
          Input.consumeMouseButton(0);
          break;
        }
      }
    }

    return true;
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState, screenW: number, screenH: number): void {
    if (!this.open) return;
    this.weaponRects.length = 0;
    const panelW = Math.min(360, Math.max(300, screenW - 24));
    const x = 12;
    const panelH = Math.min(screenH - 36, Math.max(560, screenH - 96));
    const y = Math.max(18, Math.min(72, (screenH - panelH) * 0.5));
    ctx.save();
    fillMenuPanel(ctx, x, y, panelW, panelH);
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.55);
    ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '20px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.95);
    ctx.fillText('[Z] Ship', x + 12, y + 12);

    const ship = state.player;
    const statsY = y + 52;
    const shieldText = ship.shieldUnlocked
      ? `${Math.ceil(ship.shield)}/${ship.maxShield}`
      : 'offline';
    const stats = [
      `HP ${Math.ceil(ship.health)}/${ship.maxHealth}`,
      `Shield ${shieldText}`,
      `Speed ${Math.round(ship.maxSpeed)}`,
      `Energy ${Math.floor(ship.battery)}/${ship.maxBattery}`,
      `Energy Regen ${ship.baseBatteryRegenRate.toFixed(1)}/s`,
      `Fire Speed x${(1 / ship.fireCooldownMultiplier).toFixed(2)}`,
      `Resources $${Math.floor(state.resources)}`,
    ];
    ctx.font = '16px "Poiret One", sans-serif';
    for (let i = 0; i < stats.length; i++) {
      ctx.fillStyle = colorToCSS(Colors.general_building, 0.86);
      ctx.fillText(stats[i], x + 12, statsY + i * 21);
    }

    const upgradeY = statsY + stats.length * 21 + 20;
    ctx.font = '18px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.85);
    ctx.fillText('Upgrades', x + 12, upgradeY);
    const upgrades = [
      ['HP', 'shipHp'],
      ['Speed + Energy Regen', 'shipSpeedEnergy'],
      ['Fire Speed', 'shipFireSpeed'],
      ['Shield Aura', 'shipShield'],
    ] as const;
    const unlockedUpgrades = upgrades.filter(([, key]) => state.researchedItems.has(key));
    ctx.font = '16px "Poiret One", sans-serif';
    if (unlockedUpgrades.length === 0) {
      ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.7);
      ctx.fillText('No upgrades unlocked', x + 12, upgradeY + 26);
    } else {
      for (let i = 0; i < unlockedUpgrades.length; i++) {
        const [label] = unlockedUpgrades[i];
        ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.9);
        ctx.fillText(`- ${label}`, x + 12, upgradeY + 26 + i * 20);
      }
    }

    const weaponsY = upgradeY + 42 + Math.max(1, unlockedUpgrades.length) * 20;
    ctx.font = '18px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.alert2, 0.85);
    ctx.fillText('Weapons', x + 12, weaponsY);
    const rowH = Math.max(34, Math.min(62, (y + panelH - weaponsY - 54) / SHIP_WEAPON_OPTIONS.length - 6));
    for (let i = 0; i < SHIP_WEAPON_OPTIONS.length; i++) {
      const weapon = SHIP_WEAPON_OPTIONS[i];
      const wy = weaponsY + 20 + i * (rowH + 6);
      const selected = ship.primaryWeaponId === weapon.id;
      const unlocked = this.weaponUnlocked(state, weapon.id);
      this.weaponRects.push({ id: weapon.id, x: x + 10, y: wy, w: panelW - 20, h: rowH });
      ctx.fillStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.28)
        : unlocked
          ? 'rgba(8,32,58,0.72)'
          : 'rgba(8,18,32,0.58)';
      ctx.fillRect(x + 10, wy, panelW - 20, rowH);
      ctx.strokeStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.9)
        : colorToCSS(Colors.radar_gridlines, unlocked ? 0.42 : 0.22);
      ctx.strokeRect(x + 10.5, wy + 0.5, panelW - 21, rowH - 1);
      ctx.font = '16px "Poiret One", sans-serif';
      ctx.fillStyle = unlocked ? colorToCSS(Colors.general_building, 0.95) : colorToCSS(Colors.radar_gridlines, 0.48);
      ctx.fillText(weapon.label, x + 20, wy + 7);
      if (rowH >= 46) {
        ctx.font = '14px "Poiret One", sans-serif';
        ctx.fillStyle = unlocked ? colorToCSS(Colors.radar_gridlines, 0.78) : colorToCSS(Colors.radar_gridlines, 0.44);
        ctx.fillText(unlocked ? weapon.description : 'Research required', x + 20, wy + 29);
      }
    }

    ctx.font = '14px "Poiret One", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.7);
    ctx.fillText('click or mouse wheel changes weapon', x + panelW * 0.5, y + panelH - 18);
    ctx.restore();
  }

  private weaponUnlocked(state: GameState, id: ShipWeaponId): boolean {
    const weapon = SHIP_WEAPON_OPTIONS.find((item) => item.id === id);
    return !weapon?.researchKey || state.researchedItems.has(weapon.researchKey);
  }
}

type QuickPaletteItem =
  | { type: 'header'; label: string }
  | { type: 'conduit'; label: string; cost: number }
  | { type: 'shape'; label: string; cost: number }
  | { type: 'building'; def: BuildDef };

class QuickBuildMenu {
  open = false;

  private touchedThisDrag = new Set<string>();
  private buildingDragCells = new Set<string>();
  private dragMode: 'paint' | 'erase' | null = null;
  private lastDragCell: { cx: number; cy: number } | null = null;
  private selectedIndex = 0;
  private readonly iconRects: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];

  private conduitBrushCells(cx: number, cy: number): Array<{ cx: number; cy: number }> {
    return [
      { cx, cy },
      { cx: cx + 1, cy },
      { cx, cy: cy + 1 },
      { cx: cx + 1, cy: cy + 1 },
    ];
  }

  update(state: GameState, camera: Camera): MenuResult {
    const keyDown = Input.isDown('q');
    if (keyDown && !this.open) {
      this.open = true;
      this.touchedThisDrag.clear();
      this.buildingDragCells.clear();
      this.dragMode = null;
      this.lastDragCell = null;
    } else if (!keyDown && this.open) {
      this.open = false;
      this.touchedThisDrag.clear();
      this.buildingDragCells.clear();
      this.dragMode = null;
      this.lastDragCell = null;
      return { action: 'none' };
    }
    if (!this.open) return { action: 'none' };

    const palette = this.paletteItems(state);
    this.normalizeSelectedIndex(palette);
    if (Input.wheelDelta !== 0 && palette.length > 0) {
      const dir = Input.wheelDelta > 0 ? 1 : -1;
      this.selectedIndex = this.nextSelectableIndex(palette, this.selectedIndex, dir);
      Audio.playSound('menucursor');
    }

    if (Input.mousePressed) {
      for (const r of this.iconRects) {
        if (
          Input.mousePos.x >= r.x && Input.mousePos.x <= r.x + r.w &&
          Input.mousePos.y >= r.y && Input.mousePos.y <= r.y + r.h
        ) {
          if (palette[r.index]?.type !== 'header') this.selectedIndex = r.index;
          Input.consumeMouseButton(0);
          Audio.playSound('menucursor');
          return { action: 'none' };
        }
      }
    }

    const selected = palette[this.selectedIndex];
    if (selected?.type === 'building') {
      this.dragMode = null;
      this.touchedThisDrag.clear();
      if (Input.mouse2Pressed) {
        Input.consumeMouseButton(2);
        this.buildingDragCells.clear();
        const worldPos = camera.screenToWorld(Input.mousePos);
        const deleting = state.startDeletingBuildingAt(worldPos, Team.Player);
        if (deleting) Audio.playSound('menucursor');
        return { action: 'none' };
      }
      if (!Input.mouseDown) {
        this.buildingDragCells.clear();
        this.lastDragCell = null;
        return { action: 'none' };
      }
      if (Input.mousePressed) Input.consumeMouseButton(0);
      const worldPos = camera.screenToWorld(Input.mousePos);
      const cell = worldToCell(worldPos);
      const cells = this.lastDragCell ? gridLineCells(this.lastDragCell, cell) : [cell];
      this.lastDragCell = cell;
      for (const candidate of cells) {
        const origin = footprintOrigin(candidate.cx, candidate.cy, selected.def.footprintCells);
        const key = `${selected.def.key}:${origin.cx},${origin.cy}`;
        if (this.buildingDragCells.has(key)) continue;
        this.buildingDragCells.add(key);
        const status = state.getPlacementStatus(selected.def, candidate.cx, candidate.cy, Team.Player);
        if (status.valid) return { action: 'build', buildingType: selected.def.key, cell: candidate };
      }
      return { action: 'none' };
    }

    if (selected?.type === 'shape') {
      const worldPos = camera.screenToWorld(Input.mousePos);
      if (Input.mouseDown) state.synonymous.shapeLine(Team.Player, worldPos);
      if (Input.mouse2Down) state.synonymous.recallAt(Team.Player, worldPos);
      return { action: 'none' };
    }

    if (Input.mousePressed) {
      this.dragMode = 'paint';
      this.touchedThisDrag.clear();
      this.buildingDragCells.clear();
      this.lastDragCell = null;
    } else if (Input.mouse2Pressed) {
      this.dragMode = 'erase';
      this.touchedThisDrag.clear();
      this.lastDragCell = null;
    }

    if (Input.mouseDown) {
      this.dragMode = 'paint';
    } else if (Input.mouse2Down) {
      this.dragMode = 'erase';
    } else {
      this.dragMode = null;
      this.touchedThisDrag.clear();
      this.lastDragCell = null;
    }

    if (this.dragMode !== null) {
      const worldPos = camera.screenToWorld(Input.mousePos);
      const { cx, cy } = worldToCell(worldPos);
      const currentCell = { cx, cy };
      const dragCells = this.lastDragCell ? gridLineCells(this.lastDragCell, currentCell) : [currentCell];
      this.lastDragCell = currentCell;
      for (const dragCell of dragCells) {
      const key = cellKey(dragCell.cx, dragCell.cy);
      if (this.touchedThisDrag.has(key)) continue;
        this.touchedThisDrag.add(key);
        const brush = this.conduitBrushCells(dragCell.cx, dragCell.cy);
        if (this.dragMode === 'paint') {
          for (const cell of brush) {
            if (state.grid.hasConduit(cell.cx, cell.cy) || state.grid.hasPendingConduit(cell.cx, cell.cy)) {
              continue;
            }
            if (state.resources >= CONDUIT_COST) {
              state.resources -= CONDUIT_COST;
              state.grid.queueConduit(cell.cx, cell.cy, Team.Player);
            }
          }
        } else {
          let removed = false;
          for (const cell of brush) {
            if (state.grid.conduitTeam(cell.cx, cell.cy) === Team.Player || state.grid.hasPendingConduit(cell.cx, cell.cy)) {
              state.grid.removeConduit(cell.cx, cell.cy);
              removed = true;
            }
          }
          if (removed) state.power.markDirty();
          Audio.playSound('menucursor');
        }
      }
    }

    return { action: 'none' };
  }

  private paletteItems(state: GameState): QuickPaletteItem[] {
    const defs = availableBuildDefs(state);
    const byKey = new Map(defs.map((def) => [def.key, def]));
    const items: QuickPaletteItem[] = [];
    const addBuilding = (key: string) => {
      const def = byKey.get(key);
      if (def) items.push({ type: 'building', def });
    };

    items.push({ type: 'header', label: 'Structures' });
    addBuilding('commandpost');
    if (isSynonymousFaction(state.factionByTeam, Team.Player)) {
      items.push({ type: 'shape', label: 'Shape', cost: 0 });
    } else if (!isConfluenceFaction(state.factionByTeam, Team.Player)) {
      items.push({ type: 'conduit', label: 'Conduit', cost: CONDUIT_COST });
    }
    addBuilding('powergenerator');
    addBuilding('factory');
    addBuilding('researchlab');

    items.push({ type: 'header', label: 'Turrets' });
    for (const def of defs.filter((def) => def.tier === 'turret')) {
      items.push({ type: 'building', def });
    }

    items.push({ type: 'header', label: 'Yards' });
    for (const def of defs.filter((def) => def.tier === 'yard')) {
      items.push({ type: 'building', def });
    }
    return items;
  }

  private normalizeSelectedIndex(palette: QuickPaletteItem[]): void {
    if (palette.length === 0) {
      this.selectedIndex = 0;
      return;
    }
    if (this.selectedIndex >= palette.length) this.selectedIndex = palette.length - 1;
    if (palette[this.selectedIndex]?.type === 'header') {
      this.selectedIndex = this.nextSelectableIndex(palette, this.selectedIndex, 1);
    }
  }

  private nextSelectableIndex(palette: QuickPaletteItem[], start: number, dir: number): number {
    if (palette.length === 0) return 0;
    let idx = start;
    for (let i = 0; i < palette.length; i++) {
      idx = (idx + dir + palette.length) % palette.length;
      if (palette[idx]?.type !== 'header') return idx;
    }
    return start;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
    _screenH: number,
  ): void {
    if (!this.open) return;
    const palette = this.paletteItems(state);
    this.normalizeSelectedIndex(palette);
    const worldPos = camera.screenToWorld(Input.mousePos);
    const cell = worldToCell(worldPos);
    const selected = palette[this.selectedIndex];

    if (selected?.type === 'building') {
      this.drawBuildingFootprintCursor(ctx, state, camera, cell, selected.def);
    } else if (selected?.type === 'conduit') {
      const mode: 'paint' | 'erase' = this.dragMode === 'erase' ? 'erase' : 'paint';
      this.drawConduitBrushCursor(ctx, camera, cell, mode);
    }
    this.drawPalette(ctx, state, palette);

    ctx.font = '12px "Poiret One", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.85);
    ctx.fillText(
      selected?.type === 'shape'
        ? '[Q] Synonymous Shape - hold LMB to draw swarm trails - RMB recalls nearby drones'
        : selected?.type === 'building'
        ? '[Q] Quick Build - wheel/click selects - LMB places - RMB deletes building - release Q to exit'
        : `[Q] Quick Build - Conduit 2x2 brush $${CONDUIT_COST}/cell - LMB paint - RMB erase - wheel/click selects`,
      screenW * 0.5,
      24,
    );
    ctx.font = '10px "Poiret One", sans-serif';
    ctx.fillStyle = colorToCSS(Colors.general_building, 0.6);
    ctx.fillText(
      isSynonymousFaction(state.factionByTeam, Team.Player)
        ? `nanobots: ${state.synonymous.droneCount(Team.Player)} free / ${state.synonymous.totalDroneCount(Team.Player)} total - cell ${cell.cx},${cell.cy}`
        : `conduits: ${state.grid.conduitCount()} - queued: ${state.grid.pendingConduitCount()} - cell ${cell.cx},${cell.cy} - resources: $${Math.floor(state.resources)}`,
      screenW * 0.5,
      40,
    );
  }

  private drawConduitBrushCursor(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    cell: { cx: number; cy: number },
    mode: 'paint' | 'erase',
  ): void {
    const topLeft = camera.worldToScreen(cellCenter(cell.cx, cell.cy));
    const cellPx = GRID_CELL_SIZE * camera.zoom;
    const color =
      mode === 'paint'
        ? colorToCSS(Colors.radar_friendly_status, 0.85)
        : colorToCSS(Colors.alert1, 0.85);
    ctx.strokeStyle = color;
    ctx.fillStyle = mode === 'paint'
      ? colorToCSS(Colors.radar_friendly_status, 0.12)
      : colorToCSS(Colors.alert1, 0.10);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(topLeft.x - cellPx / 2, topLeft.y - cellPx / 2, cellPx * 2, cellPx * 2);
    ctx.strokeRect(topLeft.x - cellPx / 2, topLeft.y - cellPx / 2, cellPx * 2, cellPx * 2);
    ctx.setLineDash([]);
  }

  private drawBuildingFootprintCursor(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    cell: { cx: number; cy: number },
    def: BuildDef,
  ): void {
    const center = footprintCenter(cell.cx, cell.cy, def.footprintCells);
    const screen = camera.worldToScreen(center);
    const sizePx = def.footprintCells * GRID_CELL_SIZE * camera.zoom;
    const status = state.getPlacementStatus(def, cell.cx, cell.cy, Team.Player);
    if (isConfluenceFaction(state.factionByTeam, Team.Player)) {
      const circles = state.territoryCirclesByTeam.get(Team.Player) ?? [];
      for (const c of circles) {
        const cc = camera.worldToScreen(new Vec2(c.x, c.y));
        const minR = (c.radius + CONFLUENCE_PLACEMENT_DISTANCE - CONFLUENCE_PLACEMENT_TOLERANCE) * camera.zoom;
        const maxR = (c.radius + CONFLUENCE_PLACEMENT_DISTANCE + CONFLUENCE_PLACEMENT_TOLERANCE) * camera.zoom;
        ctx.fillStyle = 'rgba(120,255,245,0.08)';
        ctx.beginPath(); ctx.arc(cc.x, cc.y, maxR, 0, Math.PI * 2); ctx.arc(cc.x, cc.y, minR, 0, Math.PI * 2, true); ctx.fill();
        ctx.strokeStyle = 'rgba(120,255,245,0.22)'; ctx.beginPath(); ctx.arc(cc.x, cc.y, maxR, 0, Math.PI * 2); ctx.stroke();
      }
      let parent = null as any;
      let best = Infinity;
      for (const c of circles) { const d=Math.hypot(center.x-c.x, center.y-c.y)-c.radius; const ad=Math.abs(d-CONFLUENCE_PLACEMENT_DISTANCE); if(ad<best){best=ad; parent=c;} }
      if (parent) {
        const p = camera.worldToScreen(new Vec2(parent.x, parent.y));
        ctx.strokeStyle = status.valid ? 'rgba(120,255,245,0.45)' : 'rgba(255,90,90,0.45)';
        ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(screen.x,screen.y); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = 'rgba(120,255,245,0.25)'; ctx.beginPath(); ctx.arc(screen.x, screen.y, CONFLUENCE_BASE_RADIUS*camera.zoom, 0, Math.PI*2); ctx.stroke();
    }
    const color = status.valid
      ? colorToCSS(Colors.radar_friendly_status, 0.9)
      : colorToCSS(Colors.alert1, 0.9);

    ctx.fillStyle = status.valid
      ? colorToCSS(Colors.radar_friendly_status, 0.18)
      : colorToCSS(Colors.alert1, 0.12);
    ctx.fillRect(screen.x - sizePx / 2, screen.y - sizePx / 2, sizePx, sizePx);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(screen.x - sizePx / 2, screen.y - sizePx / 2, sizePx, sizePx);
    ctx.setLineDash([]);

    ctx.font = '10px "Poiret One", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(`${def.label} ${def.footprintCells}x${def.footprintCells}`, screen.x, screen.y - sizePx / 2 - 4);
    if (!status.valid) {
      ctx.textBaseline = 'top';
      ctx.fillText(status.reason, screen.x, screen.y + sizePx / 2 + 4);
    }
  }

  private drawPalette(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    palette: QuickPaletteItem[],
  ): void {
    this.iconRects.length = 0;
    const x = 12;
    const y0 = 96;
    const w = 154;
    const h = 30;
    const gap = 6;
    ctx.save();
    ctx.font = '10px "Poiret One", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < palette.length; i++) {
      const y = y0 + i * (h + gap);
      const item = palette[i];
      if (item.type === 'header') {
        ctx.fillStyle = colorToCSS(Colors.alert2, 0.85);
        ctx.fillText(item.label, x + 8, y + h * 0.55);
        continue;
      }
      const selected = i === this.selectedIndex;
      const cost = item.type === 'conduit' || item.type === 'shape' ? item.cost : item.def.cost;
      const label = item.type === 'conduit'
        ? item.label
        : item.type === 'shape'
          ? item.label
        : `${item.def.label} ${item.def.footprintCells}x${item.def.footprintCells}`;
      this.iconRects.push({ index: i, x, y, w, h });
      ctx.fillStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.28)
        : colorToCSS(Colors.menu_background, 0.55);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.95)
        : colorToCSS(Colors.radar_gridlines, 0.45);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = item.type === 'shape' || state.resources >= cost
        ? colorToCSS(Colors.general_building, selected ? 1.0 : 0.82)
        : colorToCSS(Colors.alert1, 0.7);
      ctx.fillText(label, x + 8, y + h * 0.5);
      ctx.textAlign = 'right';
      ctx.fillText(item.type === 'shape' ? 'free' : `$${cost}`, x + w - 8, y + h * 0.5);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// ActionMenu — public façade, same shape as the original so game.ts is minimal
// ---------------------------------------------------------------------------

export class ActionMenu {
  private shipMenu     = new ShipMenu();
  private researchMenu = new LeftHoldMenu('x', buildResearchRoot, '[X] Research');
  private commandMenu  = new LeftHoldMenu('c', buildCommandRoot,  '[C] Command');
  private paintMenu    = new QuickBuildMenu();

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

  update(state: GameState, camera: Camera): MenuResult {
    // Paint mode runs first so it consumes mouse-down before radial menus see it.
    const paintResult = this.paintMenu.update(state, camera);
    const paintOpen = this.paintMenu.open;

    this.placementMode = paintOpen;
    this.placementType = paintOpen ? 'conduit' : null;

    // Radial menus are mutually exclusive with paint mode.
    let rr: MenuResult = { action: 'none' };
    let cr: MenuResult = { action: 'none' };
    let shipOpen = false;
    if (!paintOpen) {
      shipOpen = this.shipMenu.update(state);
      rr = this.researchMenu.update(state, camera);
      cr = this.commandMenu.update(state, camera);
    }

    // Intercept build results — enter placement mode instead of placing immediately.
    this.open =
      paintOpen ||
      shipOpen ||
      this.researchMenu.open ||
      this.commandMenu.open;

    if (paintResult.action !== 'none') return paintResult;
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
    this.shipMenu.draw(ctx, state, screenW, screenH);
    this.researchMenu.draw(ctx, state);
    this.commandMenu.draw(ctx, state);
    this.paintMenu.draw(ctx, state, camera, screenW, screenH);
  }

}

