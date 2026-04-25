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
import { ShipGroup, TacticalOrder } from './entities.js';
import { BUILDING_COST, RESEARCH_COST } from './constants.js';

/** Rebuild cost for the command post (not in BUILDING_COST since it starts pre-built). */
const COMMANDPOST_REBUILD_COST = 300;

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

function buildGeneralItems(state: GameState): RadialItem[] {
  const r = state.resources;
  const items: RadialItem[] = [];
  if (!state.getPlayerCommandPost()) {
    items.push({
      label: 'Command\nPost',
      sublabel: `$${COMMANDPOST_REBUILD_COST}`,
      buildingType: 'commandpost',
      disabled: r < COMMANDPOST_REBUILD_COST,
    });
  }
  items.push(
    { label: 'Power\nGenerator', sublabel: `$${BUILDING_COST.powergenerator}`, buildingType: 'powergenerator', disabled: r < BUILDING_COST.powergenerator },
    { label: 'Fighter\nYard',    sublabel: `$${BUILDING_COST.fighteryard}`,    buildingType: 'fighteryard',    disabled: r < BUILDING_COST.fighteryard    },
    { label: 'Bomber\nYard',     sublabel: `$${BUILDING_COST.bomberyard}`,     buildingType: 'bomberyard',     disabled: r < BUILDING_COST.bomberyard     },
    { label: 'Research\nLab',    sublabel: `$${BUILDING_COST.researchlab}`,    buildingType: 'researchlab',    disabled: r < BUILDING_COST.researchlab    },
    { label: 'Factory',          sublabel: `$${BUILDING_COST.factory}`,        buildingType: 'factory',        disabled: r < BUILDING_COST.factory        },
  );
  return items;
}

function buildTurretItems(state: GameState): RadialItem[] {
  const r = state.resources;
  return [
    { label: 'Missile\nTurret', sublabel: `$${BUILDING_COST.missileturret}`,    buildingType: 'missileturret',    disabled: r < BUILDING_COST.missileturret    },
    { label: 'Exciter\nTurret', sublabel: `$${BUILDING_COST.exciterturret}`,    buildingType: 'exciterturret',    disabled: r < BUILDING_COST.exciterturret    },
    { label: 'Mass\nDriver',    sublabel: `$${BUILDING_COST.massdriverturret}`, buildingType: 'massdriverturret', disabled: r < BUILDING_COST.massdriverturret },
    { label: 'Regen\nTurret',   sublabel: `$${BUILDING_COST.regenturret}`,      buildingType: 'regenturret',      disabled: r < BUILDING_COST.regenturret      },
  ];
}

function buildBuildRoot(state: GameState): RadialItem[] {
  return [
    { label: 'General\nBuildings', children: buildGeneralItems(state) },
    { label: 'Turrets',            children: buildTurretItems(state)   },
  ];
}

function buildResearchRoot(state: GameState): RadialItem[] {
  const items: RadialItem[] = [];
  const keys = Object.keys(RESEARCH_COST) as Array<keyof typeof RESEARCH_COST>;
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
    // Hold key (case-insensitive) opens/keeps open; release closes.
    const keyDown = Input.isDown(this.holdKey) || Input.isDown(this.holdKey.toUpperCase());
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
// ActionMenu — public façade, same shape as the original so game.ts is minimal
// ---------------------------------------------------------------------------

export class ActionMenu {
  private buildMenu    = new HoldMenu('z', buildBuildRoot,    '[Z] Build');
  private researchMenu = new HoldMenu('x', buildResearchRoot, '[X] Research');
  private commandMenu  = new HoldMenu('c', buildCommandRoot,  '[C] Command');

  /** True when any of the three hold menus is currently open. */
  open = false;

  /**
   * PR 2: placement mode is always false here.
   * PR 3 will set this flag when Q-hold grid-paint mode is active.
   * Kept so existing game.ts guards compile without changes.
   */
  placementMode = false;
  placementType: string | null = null;

  update(state: GameState, camera: Camera): MenuResult {
    const br = this.buildMenu.update(state, camera);
    const rr = this.researchMenu.update(state, camera);
    const cr = this.commandMenu.update(state, camera);

    this.open =
      this.buildMenu.open || this.researchMenu.open || this.commandMenu.open;

    if (br.action !== 'none') return br;
    if (rr.action !== 'none') return rr;
    if (cr.action !== 'none') return cr;
    return { action: 'none' };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    _camera: Camera,
    _screenW: number,
    _screenH: number,
  ): void {
    this.buildMenu.draw(ctx, state);
    this.researchMenu.draw(ctx, state);
    this.commandMenu.draw(ctx, state);
  }
}


