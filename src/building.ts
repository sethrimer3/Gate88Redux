/** Building types for Gate88 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import {
  ENTITY_RADIUS,
  COMMANDPOST_BUILD_RADIUS,
  POWERGENERATOR_COVERAGE_RADIUS,
} from './constants.js';

// ---------------------------------------------------------------------------
// Base building
// ---------------------------------------------------------------------------

export abstract class BuildingBase extends Entity {
  powered: boolean = false;
  buildProgress: number = 1;

  constructor(
    type: EntityType,
    team: Team,
    position: Vec2,
    health: number,
    radius: number = ENTITY_RADIUS.building,
  ) {
    super(type, team, position, health, radius);
    this.velocity.set(0, 0);
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (this.buildProgress < 1) {
      this.buildProgress = Math.min(1, this.buildProgress + dt * 0.5);
    }
  }

  /** Draw common building ring that indicates health and power status. */
  protected drawBuildingBase(
    ctx: CanvasRenderingContext2D,
    screen: Vec2,
    r: number,
    color: string,
  ): void {
    // PR7: under-construction visual — corner brackets + sweeping scanline.
    // The opacity ramp on the body is preserved (via globalAlpha) so the
    // underlying shape still fades in, but the brackets clearly read as
    // "blueprint, not yet active".
    if (this.buildProgress < 1) {
      const t = this.buildProgress;
      // Four expanding corner brackets in a square just outside `r`.
      const sq = r * 1.1;
      const armLen = sq * 0.55 * (0.6 + 0.4 * t);
      ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.55 + 0.35 * t);
      ctx.lineWidth = 1;
      ctx.beginPath();
      // top-left
      ctx.moveTo(screen.x - sq, screen.y - sq + armLen);
      ctx.lineTo(screen.x - sq, screen.y - sq);
      ctx.lineTo(screen.x - sq + armLen, screen.y - sq);
      // top-right
      ctx.moveTo(screen.x + sq, screen.y - sq + armLen);
      ctx.lineTo(screen.x + sq, screen.y - sq);
      ctx.lineTo(screen.x + sq - armLen, screen.y - sq);
      // bottom-right
      ctx.moveTo(screen.x + sq, screen.y + sq - armLen);
      ctx.lineTo(screen.x + sq, screen.y + sq);
      ctx.lineTo(screen.x + sq - armLen, screen.y + sq);
      // bottom-left
      ctx.moveTo(screen.x - sq, screen.y + sq - armLen);
      ctx.lineTo(screen.x - sq, screen.y + sq);
      ctx.lineTo(screen.x - sq + armLen, screen.y + sq);
      ctx.stroke();

      // Sweeping scanline that rises with build progress.
      const sy = screen.y + sq - sq * 2 * t;
      ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.4);
      ctx.beginPath();
      ctx.moveTo(screen.x - sq, sy);
      ctx.lineTo(screen.x + sq, sy);
      ctx.stroke();
    }

    // Outer ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = this.buildProgress;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Team-colored center dot
    const teamColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendly_status, 0.5 + 0.5 * this.healthFraction)
        : colorToCSS(Colors.enemy_status, 0.5 + 0.5 * this.healthFraction);
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Health arc
    ctx.strokeStyle = colorToCSS(Colors.healthbar, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      screen.x,
      screen.y,
      r * 0.6,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * this.healthFraction,
    );
    ctx.stroke();

    // Power indicator dot (top-left)
    if (this.powered) {
      ctx.fillStyle = colorToCSS(Colors.powergenerator_detail, 0.9);
      ctx.beginPath();
      ctx.arc(screen.x - r * 0.7, screen.y - r * 0.7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// CommandPost
// ---------------------------------------------------------------------------

export class CommandPost extends BuildingBase {
  readonly buildRadius: number = COMMANDPOST_BUILD_RADIUS;

  constructor(position: Vec2, team: Team) {
    super(EntityType.CommandPost, team, position, 2000, ENTITY_RADIUS.commandpost);
    this.powered = true; // always powered
  }

  update(dt: number): void {
    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const baseColor = colorToCSS(Colors.general_building);

    this.drawBuildingBase(ctx, screen, r, baseColor);

    ctx.save();
    ctx.translate(screen.x, screen.y);

    // Inner double-ring pattern
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Cross-hair lines
    const half = r * 0.85;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// PowerGenerator
// ---------------------------------------------------------------------------

export class PowerGenerator extends BuildingBase {
  readonly coverageRadius: number = POWERGENERATOR_COVERAGE_RADIUS;
  private pulsePhase: number = 0;

  constructor(position: Vec2, team: Team) {
    super(EntityType.PowerGenerator, team, position, 100);
    this.powered = true; // self-powered
  }

  update(dt: number): void {
    super.update(dt);
    this.pulsePhase += dt * 3;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detailColor = colorToCSS(Colors.powergenerator_detail);

    this.drawBuildingBase(ctx, screen, r, detailColor);

    // Pulsing coverage circle
    const pulse = 0.5 + 0.2 * Math.sin(this.pulsePhase);
    ctx.strokeStyle = colorToCSS(Colors.powergenerator_coverage, pulse * 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      screen.x,
      screen.y,
      this.coverageRadius * camera.zoom,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    // Inner energy circle
    ctx.strokeStyle = detailColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.5 * (0.8 + 0.2 * Math.sin(this.pulsePhase)), 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Shipyard (FighterYard / BomberYard)
// ---------------------------------------------------------------------------

export class Shipyard extends BuildingBase {
  /** Maximum number of ships this yard can field. */
  shipCapacity: number = 5;
  /** How many ships are currently alive from this yard. */
  activeShips: number = 0;
  /** Timer until next ship build (seconds). */
  buildTimer: number = 0;
  /** Seconds per ship. */
  buildInterval: number = 5;

  constructor(
    type: EntityType.FighterYard | EntityType.BomberYard,
    position: Vec2,
    team: Team,
  ) {
    super(type, team, position, 120);
    this.powered = true; // self-powered
  }

  update(dt: number): void {
    super.update(dt);
    if (this.buildProgress >= 1 && this.activeShips < this.shipCapacity) {
      this.buildTimer -= dt;
    }
  }

  /** Returns true if a new ship should be spawned and resets the timer. */
  shouldSpawnShip(): boolean {
    if (this.buildTimer <= 0 && this.activeShips < this.shipCapacity && this.alive) {
      this.buildTimer = this.buildInterval;
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const isFighter = this.type === EntityType.FighterYard;
    const detailColor = isFighter
      ? colorToCSS(Colors.fighteryard_detail)
      : colorToCSS(Colors.bomberyard_detail);

    this.drawBuildingBase(ctx, screen, r, colorToCSS(Colors.shipyard));

    ctx.save();
    ctx.translate(screen.x, screen.y);

    // Ship silhouettes inside
    ctx.strokeStyle = detailColor;
    ctx.lineWidth = 1;
    const silSize = r * 0.3;
    for (let i = 0; i < Math.min(this.activeShips, this.shipCapacity); i++) {
      const ang = (Math.PI * 2 * i) / this.shipCapacity - Math.PI / 2;
      const sx = Math.cos(ang) * r * 0.5;
      const sy = Math.sin(ang) * r * 0.5;
      ctx.beginPath();
      if (isFighter) {
        // Small triangle
        ctx.moveTo(sx + silSize, sy);
        ctx.lineTo(sx - silSize * 0.5, sy - silSize * 0.5);
        ctx.lineTo(sx - silSize * 0.5, sy + silSize * 0.5);
      } else {
        // Small diamond
        ctx.moveTo(sx + silSize, sy);
        ctx.lineTo(sx, sy - silSize * 0.6);
        ctx.lineTo(sx - silSize, sy);
        ctx.lineTo(sx, sy + silSize * 0.6);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// ResearchLab
// ---------------------------------------------------------------------------

export class ResearchLab extends BuildingBase {
  private spinPhase: number = 0;

  constructor(position: Vec2, team: Team) {
    super(EntityType.ResearchLab, team, position, 100);
  }

  update(dt: number): void {
    super.update(dt);
    this.spinPhase += dt * 2;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detailColor = colorToCSS(Colors.researchlab_detail);

    this.drawBuildingBase(ctx, screen, r, detailColor);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.strokeStyle = detailColor;
    ctx.lineWidth = 1;

    // Spinning atom-like elliptical orbits
    for (let i = 0; i < 3; i++) {
      const orbitAngle = this.spinPhase + (Math.PI * 2 * i) / 3;
      ctx.save();
      ctx.rotate(orbitAngle);
      ctx.scale(1, 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Center nucleus dot
    ctx.fillStyle = detailColor;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class Factory extends BuildingBase {
  private gearPhase: number = 0;

  constructor(position: Vec2, team: Team) {
    super(EntityType.Factory, team, position, 100);
  }

  update(dt: number): void {
    super.update(dt);
    this.gearPhase += dt * 1.5;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const detailColor = colorToCSS(Colors.factory_detail);

    this.drawBuildingBase(ctx, screen, r, detailColor);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.gearPhase);
    ctx.strokeStyle = detailColor;
    ctx.lineWidth = 1.5;

    // Gear / cog teeth
    const teeth = 8;
    const inner = r * 0.4;
    const outer = r * 0.65;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a1 = (Math.PI * 2 * i) / teeth;
      const a2 = a1 + Math.PI / teeth * 0.5;
      const a3 = a1 + Math.PI / teeth;
      ctx.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
      ctx.lineTo(Math.cos(a2) * outer, Math.sin(a2) * outer);
      ctx.lineTo(Math.cos(a3) * inner, Math.sin(a3) * inner);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }
}
