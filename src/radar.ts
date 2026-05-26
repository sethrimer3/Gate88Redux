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

const RADAR_BACKGROUND = 'rgba(1, 18, 7, 0.84)';
const RADAR_FRIENDLY_FILL = 'rgba(184, 255, 184, 0.86)';
const RADAR_FRIENDLY_STROKE = 'rgba(0, 210, 82, 0.98)';
const RADAR_ENEMY_FILL = 'rgba(255, 185, 185, 0.86)';
const RADAR_ENEMY_STROKE = 'rgba(205, 12, 34, 0.98)';
const RADAR_PLAYER_FILL = 'rgba(208, 255, 208, 0.96)';
const RADAR_PLAYER_STROKE = 'rgba(0, 255, 112, 1)';

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

/**
 * PR7: yellow warning triangle with a central exclamation mark, used for
 * "enemy is building near you" alerts. Drawn at (x, y) world space.
 */
function drawWarningTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size, size * 0.8);
  ctx.lineTo(-size, size * 0.8);
  ctx.closePath();
  ctx.stroke();
  // Exclamation: a vertical bar plus a dot.
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.45);
  ctx.lineTo(0, size * 0.25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, size * 0.5, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRadarSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
): void {
  const half = size * 0.5;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(x - half, y - half, size, size);
  ctx.fill();
  ctx.stroke();
}

function drawRadarCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawRadarShipTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  fill: string,
  stroke: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.72, size * 0.62);
  ctx.lineTo(-size * 0.48, 0);
  ctx.lineTo(-size * 0.72, -size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function velocityAngle(entity: Entity): number {
  return entity.velocity.length() > 1 ? Math.atan2(entity.velocity.y, entity.velocity.x) : entity.angle;
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
    const entity = state.getEntityById(id);
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
  const groupTargets: Array<Vec2 | null> = [null, null, null];
  for (const f of state.fighters) {
    if (!f.alive || f.docked || f.team !== Team.Player || f.order !== 'attack' || !f.targetPos) continue;
    if (!groupTargets[f.group]) groupTargets[f.group] = f.targetPos;
  }
  for (const group of [ShipGroup.Red, ShipGroup.Green, ShipGroup.Blue]) {
    const targetPos = groupTargets[group];
    if (!targetPos) continue;

    const sp = camera.worldToScreen(targetPos);
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

  // PR7: AI warning markers — flashing yellow exclamation at the screen
  // edge for each recent enemy construction within 8s. If the construction
  // is on-screen we drop a transient marker at the world position so the
  // player can see *where* it appeared.
  const WARNING_LIFETIME = 8;
  const cutoff = state.gameTime - WARNING_LIFETIME;
  // Drop expired warnings (mutates the array in place).
  for (let i = state.recentEnemyConstructions.length - 1; i >= 0; i--) {
    if (state.recentEnemyConstructions[i].time < cutoff) {
      state.recentEnemyConstructions.splice(i, 1);
    }
  }
  for (const w of state.recentEnemyConstructions) {
    const age = state.gameTime - w.time;
    const flash = Math.sin(time * 8) > 0;
    if (!flash) continue;
    const alpha = Math.max(0, 1 - age / WARNING_LIFETIME);
    const sp = camera.worldToScreen(w.pos);
    const edge = clampToEdge(sp, screenW, screenH);
    if (edge.offScreen) {
      drawWarningTriangle(
        ctx,
        edge.x,
        edge.y,
        INDICATOR_MAX_SIZE,
        colorToCSS(Colors.alert2, alpha),
      );
    } else {
      // On-screen marker — small triangle above the construction.
      drawWarningTriangle(
        ctx,
        sp.x,
        sp.y - 22,
        INDICATOR_MIN_SIZE + 2,
        colorToCSS(Colors.alert2, alpha),
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
  ctx.fillStyle = RADAR_BACKGROUND;
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
  drawRadarShipTriangle(
    ctx,
    centerX,
    centerY,
    5,
    velocityAngle(state.player),
    RADAR_PLAYER_FILL,
    RADAR_PLAYER_STROKE,
  );

  // Buildings
  for (const b of state.buildings) {
    if (!b.alive || (b.team !== Team.Player && b.team !== Team.Enemy)) continue;
    const dx = (b.position.x - playerPos.x) * scale;
    const dy = (b.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    const friendly = b.team === Team.Player;
    const fill = friendly ? RADAR_FRIENDLY_FILL : RADAR_ENEMY_FILL;
    const stroke = friendly ? RADAR_FRIENDLY_STROKE : RADAR_ENEMY_STROKE;
    if (b.type === EntityType.CommandPost) {
      drawRadarCircle(ctx, rx, ry, 4.5, fill, stroke);
    } else {
      drawRadarSquare(ctx, rx, ry, 4.5, fill, stroke);
    }
  }

  // Ships. Friendly ships use pale green so red group never reads as hostile.
  for (const ship of state.playerShips.values()) {
    if (!ship.alive || ship === state.player || (ship.team !== Team.Player && ship.team !== Team.Enemy)) continue;
    const dx = (ship.position.x - playerPos.x) * scale;
    const dy = (ship.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    const friendly = ship.team === Team.Player;
    drawRadarShipTriangle(
      ctx,
      rx,
      ry,
      4.6,
      velocityAngle(ship),
      friendly ? RADAR_FRIENDLY_FILL : RADAR_ENEMY_FILL,
      friendly ? RADAR_FRIENDLY_STROKE : RADAR_ENEMY_STROKE,
    );
  }

  // Fighters.
  for (const f of state.fighters) {
    if (!f.alive || f.docked || (f.team !== Team.Player && f.team !== Team.Enemy)) continue;
    const dx = (f.position.x - playerPos.x) * scale;
    const dy = (f.position.y - playerPos.y) * scale;
    const rx = centerX + dx;
    const ry = centerY + dy;
    if (rx < 0 || rx > screenW || ry < 0 || ry > screenH) continue;

    const friendly = f.team === Team.Player;
    drawRadarShipTriangle(
      ctx,
      rx,
      ry,
      3.4,
      velocityAngle(f),
      friendly ? RADAR_FRIENDLY_FILL : RADAR_ENEMY_FILL,
      friendly ? RADAR_FRIENDLY_STROKE : RADAR_ENEMY_STROKE,
    );
  }

  // Distance label
  ctx.font = '10px "Poiret One", sans-serif';
  ctx.fillStyle = colorToCSS(Colors.radar_gridlines, 0.6);
  ctx.textAlign = 'left';
  for (let r = gridStep; r <= RADAR_RANGE; r += gridStep) {
    ctx.fillText(`${r}`, centerX + r * scale + 2, centerY - 2);
  }
}

