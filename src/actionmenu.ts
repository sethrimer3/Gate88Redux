/** Action menu (pie menu system) for Gate88 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS } from './colors.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { GameState } from './gamestate.js';
import { ShipGroup, Team, EntityType } from './entities.js';
import {
  BUILDING_COST,
  RESEARCH_COST,
  RESEARCH_TIME,
  COMMANDPOST_BUILD_RADIUS,
  POWERGENERATOR_COVERAGE_RADIUS,
  TICK_RATE,
} from './constants.js';

/** Rebuild cost for the command post (not in BUILDING_COST since it starts pre-built). */
const COMMANDPOST_REBUILD_COST = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MenuResult =
  | { action: 'none' }
  | { action: 'build'; buildingType: string }
  | { action: 'order'; group: ShipGroup; order: string }
  | { action: 'research'; item: string }
  | { action: 'startPlacement'; buildingType: string };

interface MenuItem {
  label: string;
  direction: 'up' | 'down' | 'left' | 'right';
  shortcut?: string;
  cost?: number;
  /** Sub-menu items if this item opens a deeper level. */
  children?: MenuItem[];
  /** Leaf action to perform. */
  buildingType?: string;
  orderGroup?: ShipGroup;
  orderCommand?: string;
  researchItem?: string;
  /** Condition callback — if returns false the item is hidden. */
  condition?: (state: GameState) => boolean;
}

// ---------------------------------------------------------------------------
// Menu structure
// ---------------------------------------------------------------------------

function buildMenuTree(state: GameState): MenuItem[] {
  return [
    {
      label: 'Build',
      direction: 'up',
      children: [
        {
          label: 'General Buildings',
          direction: 'up',
          shortcut: 'q',
          children: buildGeneralBuildingsMenu(state),
        },
        {
          label: 'Turrets',
          direction: 'down',
          shortcut: 'e',
          children: buildTurretsMenu(),
        },
      ],
    },
    {
      label: 'Ship Orders',
      direction: 'down',
      children: [
        {
          label: 'Red Group',
          direction: 'up',
          shortcut: 'z',
          children: buildGroupOrdersMenu(ShipGroup.Red),
        },
        {
          label: 'Green Group',
          direction: 'down',
          shortcut: 'x',
          children: buildGroupOrdersMenu(ShipGroup.Green),
        },
        {
          label: 'Blue Group',
          direction: 'left',
          shortcut: 'v',
          children: buildGroupOrdersMenu(ShipGroup.Blue),
        },
      ],
    },
    {
      label: 'Research',
      direction: 'left',
      condition: (s) => s.hasResearchLab(),
      children: buildResearchMenu(state),
    },
  ];
}

function buildGeneralBuildingsMenu(state: GameState): MenuItem[] {
  const items: MenuItem[] = [];
  const cpAlive = state.getPlayerCommandPost() !== null;
  if (!cpAlive) {
    items.push({
      label: `Command Post ($${COMMANDPOST_REBUILD_COST})`,
      direction: 'up',
      buildingType: 'commandpost',
      cost: COMMANDPOST_REBUILD_COST,
    });
  }
  items.push(
    {
      label: `Power Generator ($${BUILDING_COST.powergenerator})`,
      direction: cpAlive ? 'up' : 'right',
      buildingType: 'powergenerator',
      cost: BUILDING_COST.powergenerator,
    },
    {
      label: `Fighter Yard ($${BUILDING_COST.fighteryard})`,
      direction: 'down',
      buildingType: 'fighteryard',
      cost: BUILDING_COST.fighteryard,
    },
    {
      label: `Bomber Yard ($${BUILDING_COST.bomberyard})`,
      direction: 'left',
      buildingType: 'bomberyard',
      cost: BUILDING_COST.bomberyard,
    },
    {
      label: `Research Lab ($${BUILDING_COST.researchlab})`,
      direction: 'right',
      buildingType: 'researchlab',
      cost: BUILDING_COST.researchlab,
    },
    {
      label: `Factory ($${BUILDING_COST.factory})`,
      direction: cpAlive ? 'right' : 'left',
      buildingType: 'factory',
      cost: BUILDING_COST.factory,
    },
  );
  return items;
}

function buildTurretsMenu(): MenuItem[] {
  return [
    {
      label: `Missile Turret ($${BUILDING_COST.missileturret})`,
      direction: 'up',
      buildingType: 'missileturret',
      cost: BUILDING_COST.missileturret,
    },
    {
      label: `Exciter Turret ($${BUILDING_COST.exciterturret})`,
      direction: 'down',
      buildingType: 'exciterturret',
      cost: BUILDING_COST.exciterturret,
    },
    {
      label: `Mass Driver ($${BUILDING_COST.massdriverturret})`,
      direction: 'left',
      buildingType: 'massdriverturret',
      cost: BUILDING_COST.massdriverturret,
    },
    {
      label: `Regen Turret ($${BUILDING_COST.regenturret})`,
      direction: 'right',
      buildingType: 'regenturret',
      cost: BUILDING_COST.regenturret,
    },
  ];
}

function buildGroupOrdersMenu(group: ShipGroup): MenuItem[] {
  return [
    { label: 'Attack', direction: 'up', orderGroup: group, orderCommand: 'attack' },
    { label: 'Set Target', direction: 'right', orderGroup: group, orderCommand: 'settarget' },
    { label: 'Dock', direction: 'down', orderGroup: group, orderCommand: 'dock' },
    { label: 'Assign Shipyard', direction: 'left', orderGroup: group, orderCommand: 'assignyard' },
  ];
}

function buildResearchMenu(state: GameState): MenuItem[] {
  const directions: Array<'up' | 'down' | 'left' | 'right'> = [
    'up', 'down', 'left', 'right',
  ];
  const items: MenuItem[] = [];
  const researchKeys = Object.keys(RESEARCH_COST) as Array<
    keyof typeof RESEARCH_COST
  >;
  let dirIdx = 0;
  for (const key of researchKeys) {
    if (state.researchedItems.has(key)) continue;
    items.push({
      label: `${key} ($${RESEARCH_COST[key]})`,
      direction: directions[dirIdx % directions.length],
      researchItem: key,
      cost: RESEARCH_COST[key],
    });
    dirIdx++;
  }
  return items;
}

// ---------------------------------------------------------------------------
// ActionMenu class
// ---------------------------------------------------------------------------

export class ActionMenu {
  open: boolean = false;
  /** Placement mode: player navigates to a location and confirms. */
  placementMode: boolean = false;
  placementType: string | null = null;

  private menuStack: MenuItem[][] = [];
  private selectedIndex: number = 0;

  /** Process input and return any resulting action. */
  update(state: GameState): MenuResult {
    // Toggle open on 'e' key (was 'a' before WASD movement; PR2 replaces this
    // menu with hold-to-open mouse menus on Z/X/C).
    if (Input.isDown('e') || Input.isDown('E')) {
      if (!this.open && !this.placementMode) {
        this.open = true;
        this.menuStack = [buildMenuTree(state)];
        this.selectedIndex = 0;
      }
    } else {
      if (this.open) {
        this.open = false;
        this.menuStack = [];
      }
    }

    if (!this.open) return { action: 'none' };

    const currentItems = this.currentMenuItems(state);
    if (currentItems.length === 0) return { action: 'none' };

    // Consume all arrow keys so they never reach the player ship
    Input.consumeKey('ArrowUp');
    Input.consumeKey('ArrowDown');
    Input.consumeKey('ArrowLeft');
    Input.consumeKey('ArrowRight');

    // Arrow keys immediately select AND activate the item in that direction
    const dirMap: Array<['up' | 'down' | 'left' | 'right', string]> = [
      ['up', 'ArrowUp'],
      ['down', 'ArrowDown'],
      ['left', 'ArrowLeft'],
      ['right', 'ArrowRight'],
    ];
    for (const [dir, key] of dirMap) {
      if (Input.wasPressed(key)) {
        const idx = currentItems.findIndex((i) => i.direction === dir);
        if (idx >= 0) {
          this.selectedIndex = idx;
          Audio.playSound('menucursor');
          return this.selectItem(currentItems[idx], state);
        }
      }
    }

    // Shortcuts
    for (const item of currentItems) {
      if (item.shortcut && Input.wasPressed(item.shortcut)) {
        const idx = currentItems.indexOf(item);
        if (idx >= 0) {
          this.selectedIndex = idx;
          return this.selectItem(currentItems[idx], state);
        }
      }
    }

    // Confirm selection with Enter / Space
    if (Input.wasPressed('Enter') || Input.wasPressed(' ')) {
      const sel = currentItems[this.selectedIndex];
      if (sel) {
        return this.selectItem(sel, state);
      }
    }

    // Back
    if (Input.wasPressed('Escape') || Input.wasPressed('Backspace')) {
      if (this.menuStack.length > 1) {
        this.menuStack.pop();
        this.selectedIndex = 0;
        Audio.playSound('menucursor');
      }
    }

    return { action: 'none' };
  }

  private currentMenuItems(state: GameState): MenuItem[] {
    const items = this.menuStack[this.menuStack.length - 1] ?? [];
    return items.filter((i) => !i.condition || i.condition(state));
  }

  private selectItem(item: MenuItem, state: GameState): MenuResult {
    Audio.playSound('menuselection');

    if (item.children && item.children.length > 0) {
      this.menuStack.push(item.children);
      this.selectedIndex = 0;
      return { action: 'none' };
    }

    if (item.buildingType) {
      // Place building immediately at the player's current position (camera center)
      this.open = false;
      this.menuStack = [];
      return { action: 'build', buildingType: item.buildingType };
    }

    if (item.orderGroup !== undefined && item.orderCommand) {
      this.open = false;
      this.menuStack = [];
      return {
        action: 'order',
        group: item.orderGroup,
        order: item.orderCommand,
      };
    }

    if (item.researchItem) {
      this.open = false;
      this.menuStack = [];
      return { action: 'research', item: item.researchItem };
    }

    return { action: 'none' };
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    if (this.placementMode) {
      this.drawPlacementOverlay(ctx, state, camera, screenW, screenH);
      return;
    }

    if (!this.open) return;

    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const items = this.currentMenuItems(state);

    // Center hub circle
    ctx.fillStyle = colorToCSS(Colors.menu_background, 0.6);
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw each menu item around center
    const itemRadius = 100;
    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const angle = directionToAngle(item.direction);
      const ix = cx + Math.cos(angle) * itemRadius;
      const iy = cy + Math.sin(angle) * itemRadius;
      const selected = i === this.selectedIndex;

      // Item background circle
      ctx.fillStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.35)
        : colorToCSS(Colors.menu_background, 0.45);
      ctx.beginPath();
      ctx.arc(ix, iy, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = selected
        ? colorToCSS(Colors.radar_friendly_status, 0.8)
        : colorToCSS(Colors.radar_gridlines, 0.4);
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();

      // Line from center to item
      ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      // Label
      ctx.fillStyle = selected
        ? colorToCSS(Colors.radar_friendly_status)
        : colorToCSS(Colors.general_building, 0.8);
      ctx.fillText(item.label, ix, iy);

      // Shortcut hint
      if (item.shortcut) {
        ctx.font = '10px "Courier New", monospace';
        ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.5);
        ctx.fillText(`[${item.shortcut.toUpperCase()}]`, ix, iy + 14);
        ctx.font = '13px "Courier New", monospace';
      }
    }

    // Bottom bar: resources, research, fighter counts
    this.drawStatusBar(ctx, state, screenW, screenH);
  }

  private drawStatusBar(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
  ): void {
    const barY = screenH - 50;
    ctx.fillStyle = colorToCSS(Colors.menu_background, 0.5);
    ctx.fillRect(0, barY, screenW, 50);

    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Resources
    ctx.fillStyle = colorToCSS(Colors.general_building);
    ctx.fillText(`Resources: ${Math.floor(state.resources)}`, 10, barY + 15);

    // Research progress
    if (state.researchProgress.item) {
      const rp = state.researchProgress;
      const fraction = rp.progress / rp.timeNeeded;
      const barW = 120;
      const bx = 200;
      ctx.fillStyle = colorToCSS(Colors.researchlab_detail, 0.4);
      ctx.fillRect(bx, barY + 8, barW, 14);
      ctx.fillStyle = colorToCSS(Colors.researchlab_detail, 0.9);
      ctx.fillRect(bx, barY + 8, barW * fraction, 14);
      ctx.fillStyle = colorToCSS(Colors.general_building);
      ctx.fillText(`Research: ${rp.item}`, bx, barY + 32);
    }

    // Fighter group counts
    const groupNames = ['Red', 'Green', 'Blue'];
    const groupColors = [Colors.redgroup, Colors.greengroup, Colors.bluegroup];
    let gx = 400;
    for (let g = 0; g < 3; g++) {
      const counts = state.getFighterGroupCounts(Team.Player, g);
      ctx.fillStyle = colorToCSS(groupColors[g]);
      ctx.fillText(
        `${groupNames[g]}: ${counts.docked}/${counts.total}`,
        gx,
        barY + 15,
      );
      gx += 120;
    }
  }

  private drawPlacementOverlay(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    screenW: number,
    screenH: number,
  ): void {
    // Draw build zones around command post and power generators
    const isShipyard =
      this.placementType === 'fighteryard' ||
      this.placementType === 'bomberyard';

    if (!isShipyard) {
      const cp = state.getPlayerCommandPost();
      if (cp) {
        const sp = camera.worldToScreen(cp.position);
        ctx.strokeStyle = colorToCSS(Colors.powergenerator_coverage, 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, COMMANDPOST_BUILD_RADIUS * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const b of state.buildings) {
        if (
          b.alive &&
          b.type === EntityType.PowerGenerator &&
          b.team === Team.Player
        ) {
          const sp = camera.worldToScreen(b.position);
          ctx.strokeStyle = colorToCSS(Colors.powergenerator_coverage, 0.35);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(
            sp.x,
            sp.y,
            POWERGENERATOR_COVERAGE_RADIUS * camera.zoom,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Placement prompt
    ctx.font = '14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = colorToCSS(Colors.general_building);
    ctx.fillText(
      `Place ${this.placementType} — navigate & press Enter`,
      screenW * 0.5,
      30,
    );
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.6);
    ctx.fillText('Press Escape to cancel', screenW * 0.5, 50);

    // Crosshair at screen center
    const chSize = 10;
    ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenW * 0.5 - chSize, screenH * 0.5);
    ctx.lineTo(screenW * 0.5 + chSize, screenH * 0.5);
    ctx.moveTo(screenW * 0.5, screenH * 0.5 - chSize);
    ctx.lineTo(screenW * 0.5, screenH * 0.5 + chSize);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function directionToAngle(dir: 'up' | 'down' | 'left' | 'right'): number {
  switch (dir) {
    case 'up':
      return -Math.PI / 2;
    case 'down':
      return Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'right':
      return 0;
  }
}
