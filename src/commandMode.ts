/**
 * Command-mode selection and order-target helpers extracted from game.ts.
 */

import { Vec2 } from './math.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Colors } from './colors.js';
import { Team, Entity, ShipGroup } from './entities.js';
import type { GameState } from './gamestate.js';
import { HUD } from './hud.js';
import { Shipyard } from './building.js';
import { TurretBase } from './turret.js';
import { FighterShip } from './fighter.js';
import type { ShipCommandGroup, WaypointMarker } from './gameRender.js';
import { isHostile } from './teamutils.js';

export interface CommandModeState {
  selectedFighters: Set<number>;
  selectedTurrets: Set<number>;
  dragStart: Vec2 | null;
  dragCurrent: Vec2 | null;
  lastGroupTap: { key: string; count: number; at: number } | null;
}

export interface CommandModeCtx {
  camera: Camera;
  state: GameState;
  hud: HUD;
  waypointMarkers: Map<ShipCommandGroup, WaypointMarker>;
  localTeam: Team;
}

export function createCommandModeState(): CommandModeState {
  return {
    selectedFighters: new Set<number>(),
    selectedTurrets: new Set<number>(),
    dragStart: null,
    dragCurrent: null,
    lastGroupTap: null,
  };
}

export function updateCommandMode(
  ctx: CommandModeCtx,
  commandModeState: CommandModeState,
): void {
  if (Input.mousePressed) {
    commandModeState.dragStart = Input.mousePos.clone();
    commandModeState.dragCurrent = Input.mousePos.clone();
    Input.consumeMouseButton(0);
  }
  if (commandModeState.dragStart && Input.mouseDown) {
    commandModeState.dragCurrent = Input.mousePos.clone();
  }
  if (commandModeState.dragStart && Input.mouseReleased) {
    commandModeState.dragCurrent = Input.mousePos.clone();
    selectCommandUnits(ctx, commandModeState);
    commandModeState.dragStart = null;
    commandModeState.dragCurrent = null;
    Input.consumeMouseButton(0);
  }
  if (Input.mouse2Pressed) {
    issueCommandModeOrder(ctx, commandModeState);
    Input.consumeMouseButton(2);
  }
}

export function updatePlayerFighterOrderTargets(state: GameState): void {
  const cp = state.getPlayerCommandPost();
  for (const f of state.fighters) {
    if (!f.alive || f.team !== Team.Player || f.docked) continue;
    if (f.order === 'follow') {
      f.targetPos = state.player.position.clone();
    } else if (f.order === 'protect') {
      const basePos = cp?.position ?? state.player.position;
      const threat = findNearestEnemyNear(state, basePos, 650);
      f.targetPos = threat?.position.clone() ?? basePos.clone();
    }
  }
}

export function updateNumberGroupHotkeys(
  ctx: CommandModeCtx,
  commandModeState: CommandModeState,
  issueShipOrder: (group: ShipCommandGroup, order: string, targetOverride?: Vec2) => void,
): void {
  updateNumberGroupTapOrders(commandModeState, issueShipOrder);
  const group = groupFromHeldNumber();
  if (group === null) return;

  if (Input.mouse2Pressed) {
    Input.consumeMouseButton(2);
    issueShipOrder(group, 'dock');
    return;
  }

  if (!Input.mousePressed) return;
  Input.consumeMouseButton(0);

  const aimWorld = ctx.camera.screenToWorld(Input.mousePos);
  const yard = findPlayerShipyardAt(ctx.state, aimWorld);
  if (yard && group !== 'all') {
    yard.assignedGroup = group;
    for (const f of ctx.state.fighters) {
      if (f.alive && f.team === Team.Player && f.homeYard === yard) {
        f.group = group;
      }
    }
    ctx.hud.showMessage(`Shipyard assigned to ${group + 1}`, Colors.alert2, 2);
    return;
  }

  issueShipOrder(group, 'waypoint', aimWorld);
}

function selectCommandUnits(
  ctx: CommandModeCtx,
  commandModeState: CommandModeState,
): void {
  const a = commandModeState.dragStart;
  const b = commandModeState.dragCurrent ?? commandModeState.dragStart;
  if (!a || !b) return;
  commandModeState.selectedFighters.clear();
  commandModeState.selectedTurrets.clear();

  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const clickSelect = Math.abs(maxX - minX) < 8 && Math.abs(maxY - minY) < 8;

  if (clickSelect) {
    const world = ctx.camera.screenToWorld(b);
    let best: FighterShip | TurretBase | null = null;
    let bestDist = 90;
    for (const f of ctx.state.fighters) {
      if (!f.alive || f.docked || f.team !== ctx.localTeam) continue;
      const d = f.position.distanceTo(world);
      if (d < bestDist) { best = f; bestDist = d; }
    }
    for (const t of ctx.state.buildings) {
      if (!t.alive || t.team !== ctx.localTeam || !(t instanceof TurretBase)) continue;
      const d = t.position.distanceTo(world);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    if (best instanceof FighterShip) commandModeState.selectedFighters.add(best.id);
    else if (best instanceof TurretBase) commandModeState.selectedTurrets.add(best.id);
    return;
  }

  for (const f of ctx.state.fighters) {
    if (!f.alive || f.docked || f.team !== ctx.localTeam) continue;
    const p = ctx.camera.worldToScreen(f.position);
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) commandModeState.selectedFighters.add(f.id);
  }
  for (const t of ctx.state.buildings) {
    if (!t.alive || t.team !== ctx.localTeam || !(t instanceof TurretBase)) continue;
    const p = ctx.camera.worldToScreen(t.position);
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) commandModeState.selectedTurrets.add(t.id);
  }
}

function issueCommandModeOrder(
  ctx: CommandModeCtx,
  commandModeState: CommandModeState,
): void {
  const targetPos = ctx.camera.screenToWorld(Input.mousePos);
  const enemy = findCommandEnemyAt(ctx.state, targetPos, ctx.localTeam);

  for (const f of ctx.state.fighters) {
    if (!commandModeState.selectedFighters.has(f.id) || !f.alive || f.team !== ctx.localTeam) continue;
    f.order = 'waypoint';
    f.targetPos = targetPos.clone();
    if (f.docked) f.launch();
  }
  if (commandModeState.selectedFighters.size > 0) {
    ctx.waypointMarkers.set('all', { pos: targetPos.clone(), issuedAt: ctx.state.gameTime });
  }

  for (const b of ctx.state.buildings) {
    if (!commandModeState.selectedTurrets.has(b.id) || !b.alive || b.team !== ctx.localTeam || !(b instanceof TurretBase)) continue;
    b.commandTarget = enemy;
    if (enemy) b.targetEntity = enemy;
  }

  if (enemy && commandModeState.selectedTurrets.size > 0) {
    ctx.hud.showMessage(`Focus fire: ${commandModeState.selectedTurrets.size} tower${commandModeState.selectedTurrets.size === 1 ? '' : 's'}`, Colors.alert2, 1.5);
  } else if (commandModeState.selectedFighters.size > 0) {
    ctx.hud.showMessage(`Move order: ${commandModeState.selectedFighters.size} ship${commandModeState.selectedFighters.size === 1 ? '' : 's'}`, Colors.general_building, 1.5);
  }
}

function findCommandEnemyAt(
  state: GameState,
  pos: Vec2,
  localTeam: Team,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = 140;
  for (const e of state.allEntities()) {
    if (!e.alive || !isHostile(localTeam, e.team)) continue;
    const d = e.position.distanceTo(pos);
    if (d <= e.radius + bestDist && d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function findNearestEnemyNear(
  state: GameState,
  pos: Vec2,
  range: number,
): { position: Vec2 } | null {
  let best: { position: Vec2 } | null = null;
  let bestDist = range;
  for (const e of state.allEntities()) {
    if (!e.alive || e.team !== Team.Enemy) continue;
    const d = e.position.distanceTo(pos);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function groupFromHeldNumber(): ShipCommandGroup | null {
  if (Input.isDown('1')) return ShipGroup.Red;
  if (Input.isDown('2')) return ShipGroup.Green;
  if (Input.isDown('3')) return ShipGroup.Blue;
  if (Input.isDown('4')) return 'all';
  return null;
}

function updateNumberGroupTapOrders(
  commandModeState: CommandModeState,
  issueShipOrder: (group: ShipCommandGroup, order: string, targetOverride?: Vec2) => void,
): void {
  const tapped = pressedNumberCommandGroup();
  if (!tapped) return;

  const now = performance.now();
  const previous = commandModeState.lastGroupTap;
  const count = previous && previous.key === tapped.key && now - previous.at <= 300
    ? previous.count + 1
    : 1;
  commandModeState.lastGroupTap = { key: tapped.key, count, at: now };

  if (count === 2) {
    issueShipOrder(tapped.group, 'follow');
  } else if (count >= 3) {
    issueShipOrder(tapped.group, 'protect');
    commandModeState.lastGroupTap = null;
  }
}

function pressedNumberCommandGroup(): { key: string; group: ShipCommandGroup } | null {
  if (Input.wasPressed('1')) return { key: '1', group: ShipGroup.Red };
  if (Input.wasPressed('2')) return { key: '2', group: ShipGroup.Green };
  if (Input.wasPressed('3')) return { key: '3', group: ShipGroup.Blue };
  if (Input.wasPressed('4')) return { key: '4', group: 'all' };
  return null;
}

function findPlayerShipyardAt(state: GameState, pos: Vec2): Shipyard | null {
  let best: Shipyard | null = null;
  let bestDist = Infinity;
  for (const b of state.buildings) {
    if (!b.alive || b.team !== Team.Player || !(b instanceof Shipyard)) continue;
    const d = b.position.distanceTo(pos);
    if (d <= b.radius * 1.8 && d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
