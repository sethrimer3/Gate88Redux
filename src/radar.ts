/** Radar system for Gate88 — edge indicators and full-screen overlay */

import { Vec2, clamp } from './math.js';
import { Camera } from './camera.js';
import { Colors, colorToCSS, Color } from './colors.js';
import { Entity, Team, EntityType, ShipGroup } from './entities.js';
import { GameState } from './gamestate.js';

const EDGE_MARGIN = 20;
const INDICATOR_MIN_SIZE = 4;
const INDICATOR_MAX_SIZE = 10;
const RADAR_RANGE = 4000;

const GROUP_COLORS: Record<ShipGroup, Color> = {
  [ShipGroup.Red]: Colors.redgroup,
  [ShipGroup.Green]: Colors.greengroup,
  [ShipGroup.Blue]: Colors.bluegroup,
};

// ---------------------------------------------------------------------------
// Edge Indicators (always active)
// ---------------------------------------------------------------------------

/** Clamp a world-space entity position to the screen edge for off-screen indicators. */
function clampToEdge(
  screenPos: Vec2,
  screenW: number,
  screenH: number,
): { x: number; y: number; offScreen: boolean } {
  const margin = EDGE_MARGIN;
  const onScreen =
    screenPos.x >= margin &&
    screenPos.x <= screenW - margin &&
    screenPos.y >= margin &&
    screenPos.y <= screenH - margin;

  if (onScreen) return { x: screenPos.x, y: screenPos.y, offScreen: false };

  return {
    x: clamp(screenPos.x, margin, screenW - margin),
    y: clamp(screenPos.y, margin, screenH - margin),
    offScreen: true,
  };
}

function drawCircleIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  filled: boolean = false,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawRotatingT(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  time: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Horizontal bar
  ctx.moveTo(-size, -size * 0.5);
  ctx.lineTo(size, -size * 0.5);
  // Vertical stem
  ctx.moveTo(0, -size * 0.5);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

export function drawEdgeIndicators(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: GameState,
  screenW: number,
  screenH: number,
): void {
  const time = state.gameTime;

  // Player command post
  const playerCP = state.getPlayerCommandPost();
  if (playerCP) {
    const sp = camera.worldToScreen(playerCP.position);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      drawCircleIndicator(
        ctx,
        edge.x,
        edge.y,
        INDICATOR_MAX_SIZE,
        colorToCSS(Colors.radar_friendly_status),
      );
    }
  }

  // Enemy command post
  const enemyCP = state.getEnemyCommandPost();
  if (enemyCP) {
    const sp = camera.worldToScreen(enemyCP.position);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      drawCircleIndicator(
        ctx,
        edge.x,
        edge.y,
        INDICATOR_MAX_SIZE,
        colorToCSS(Colors.radar_enemy_status),
      );
    }
  }

  // Player buildings (small green circles)
  for (const b of state.buildings) {
    if (!b.alive || b.team !== Team.Player || b.type === EntityType.CommandPost)
      continue;
    const sp = camera.worldToScreen(b.position);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      drawCircleIndicator(
        ctx,
        edge.x,
        edge.y,
        INDICATOR_MIN_SIZE,
        colorToCSS(Colors.radar_friendly_status, 0.7),
      );
    }
  }

  // Entities under attack (flashing red)
  for (const id of state.recentlyDamaged) {
    const entity = state.allEntities().find((e) => e.id === id);
    if (!entity || entity.team !== Team.Player) continue;
    const sp = camera.worldToScreen(entity.position);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      const flash = Math.sin(time * 12) > 0;
      if (flash) {
        drawCircleIndicator(
          ctx,
          edge.x,
          edge.y,
          INDICATOR_MAX_SIZE - 2,
          colorToCSS(Colors.alert1),
          true,
        );
      }
    }
  }

  // Fighter group targets (rotating T at edge)
  for (const group of [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue]) {
    const groupFighters = state.getFightersByGroup(Team.Player, group);
    if (groupFighters.length === 0) continue;
    // Show target of first fighter that has one
    const withTarget = groupFighters.find(
      (f) => f.targetPos !== null && f.order === 'attack',
    );
    if (!withTarget || !withTarget.targetPos) continue;

    const sp = camera.worldToScreen(withTarget.targetPos);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      drawRotatingT(
        ctx,
        edge.x,
        edge.y,
        INDICATOR_MIN_SIZE + 2,
        colorToCSS(GROUP_COLORS[group]),
        time,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Full-screen radar overlay (hold W)
// ---------------------------------------------------------------------------

export function drawRadarOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  screenW: number,
  screenH: number,
): void {
  const centerX = screenW * 0.5;
  const centerY = screenH * 0.5;
  const scale = Math.min(screenW, screenH) * 0.45 / RADAR_RANGE;

  // Semi-transparent background tint
  ctx.fillStyle = colorToCSS(Colors.radar_tint, 0.35);
  ctx.fillRect(0, 0, screenW, screenH);

  // Grid lines
  ctx.strokeStyle = colorToCSS(Colors.radar_gridlines, 0.3);
  ctx.lineWidth = 0.5;
  const gridStep = 1000;
  for (let r = gridStep; r <= RADAR_RANGE; r += gridStep) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Cross-hair
  ctx.beginPath();
  ctx.moveTo(centerX - RADAR_RANGE * scale, centerY);
  ctx.lineTo(centerX + RADAR_RANGE * scale, centerY);
  ctx.moveTo(centerX, centerY - RADAR_RANGE * scale);
  ctx.lineTo(centerX, centerY + RADAR_RANGE * scale);
  ctx.stroke();

  const playerPos = state.player.position;

  // Draw player at center
  ctx.fillStyle = colorToCSS(Colors.radar_friendly_status);
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
  ctx.fill();

  // Friendly buildings
  for (const b of state.buildings) {
    if (!b.alive || b.team !== Team.Player) continue;
    const dx = (b.position.x - playerPos.x) * scale;
    const dy = (b.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    const size = b.type === EntityType.CommandPost ? 4 : 2;
    ctx.fillStyle = colorToCSS(Colors.radar_friendly_status, 0.9);
    ctx.beginPath();
    ctx.arc(rx, ry, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemy buildings
  for (const b of state.buildings) {
    if (!b.alive || b.team !== Team.Enemy) continue;
    const dx = (b.position.x - playerPos.x) * scale;
    const dy = (b.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    const size = b.type === EntityType.CommandPost ? 4 : 2;
    ctx.fillStyle = colorToCSS(Colors.radar_enemy_status, 0.9);
    ctx.beginPath();
    ctx.arc(rx, ry, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Friendly fighters – colored by group
  for (const f of state.fighters) {
    if (!f.alive || f.docked || f.team !== Team.Player) continue;
    const dx = (f.position.x - playerPos.x) * scale;
    const dy = (f.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    ctx.fillStyle = colorToCSS(GROUP_COLORS[f.group], 0.8);
    ctx.beginPath();
    ctx.arc(rx, ry, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemy fighters
  for (const f of state.fighters) {
    if (!f.alive || f.docked || f.team !== Team.Enemy) continue;
    const dx = (f.position.x - playerPos.x) * scale;
    const dy = (f.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    ctx.fillStyle = colorToCSS(Colors.radar_enemy_status, 0.6);
    ctx.beginPath();
    ctx.arc(rx, ry, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distance label
  ctx.font = '10px monospace';
  ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.6);
  ctx.textAlign = 'left';
  for (let r = gridStep; r <= RADAR_RANGE; r += gridStep) {
    ctx.fillText(`${r}`, centerX + r * scale + 2, centerY - 2);
  }
}
