/**
 * Enemy-side construction drones for Gate 88.
 *
 * These extend FighterShip so they live in `state.fighters` and inherit
 * physics, damage, and rendering hooks for free. Their behaviour is
 * fundamentally different from a combat fighter:
 *
 *   1. The base planner assigns a `BuildOrder { siteCell, def }`.
 *   2. The drone flies to `siteCell`, plays a build animation, and
 *      finally instantiates the structure.
 *   3. After completion it returns idle near the Command Post.
 *
 * Drones are visible, vulnerable, and targetable. Killing them slows
 * enemy growth — a key strategic lever the player has against the base.
 *
 * Repair drones reuse the same class with `mode = 'repair'`; they
 * search for damaged friendly buildings to heal instead of building
 * new structures.
 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { FighterShip } from './fighter.js';
import { Colors, colorToCSS } from './colors.js';
import { GRID_CELL_SIZE, cellCenter, footprintCenter } from './grid.js';
import { GameState } from './gamestate.js';
import { BuildDef, createBuildingFromDef } from './builddefs.js';
import { BuildingBase } from './building.js';

export type BuilderMode = 'build' | 'repair';

export interface BuildOrder {
  /** Snapped grid cell where the structure should appear. */
  cx: number;
  cy: number;
  /** Building to instantiate when construction completes. */
  def: BuildDef;
  /** If true, also paint a conduit tile under the structure. */
  layConduitFirst: boolean;
}

const ARRIVE_DISTANCE = GRID_CELL_SIZE * 0.6;
const BUILD_ANIMATION_SECONDS = 1.6;
const REPAIR_RATE_HP_PER_S = 6;
const REPAIR_RANGE = GRID_CELL_SIZE * 1.5;

export class BuilderDrone extends FighterShip {
  mode: BuilderMode;
  /** Active build order. Cleared once the structure is placed. */
  buildOrder: BuildOrder | null = null;
  /** 0 → animation idle. > 0 → seconds remaining of the build animation. */
  private buildAnim: number = 0;
  /** Optional repair target. */
  repairTarget: BuildingBase | null = null;
  /** Movement-speed multiplier applied by difficulty. */
  speedMul: number = 1.0;
  /** Build-speed multiplier applied by difficulty. */
  buildSpeedMul: number = 1.0;

  constructor(position: Vec2, team: Team, mode: BuilderMode = 'build') {
    // Re-use FighterShip but make builders a bit slower & beefier so they
    // don't feel like fighters. group=Blue is purely cosmetic.
    super(position, team, ShipGroup.Blue, null);
    this.mode = mode;
    // Builders take more punishment than combat fighters.
    this.maxHealth = 60;
    this.health = 60;
    // Slower steering / top speed than fighters; they are utility units.
    this.thrustPower = 160;
    this.maxSpeed = 160;
    this.turnRate = 3.0;
    this.docked = false;
  }

  /** Builders do not fire weapons; they are passive. */
  override canFire(): boolean { return false; }

  override update(dt: number): void {
    if (!this.alive) return;

    // Pure animation tick — prevents the drone from drifting away mid-build.
    if (this.buildAnim > 0) {
      this.buildAnim -= dt * this.buildSpeedMul;
      this.velocity = this.velocity.scale(0.85); // gentle damp
      this.applyPhysicsPublic(dt);
      return;
    }

    if (this.mode === 'build' && this.buildOrder) {
      this.runBuildBehavior(dt);
    } else if (this.mode === 'repair' && this.repairTarget) {
      this.runRepairBehavior(dt);
    } else {
      // Idle drift
      this.angle = wrapAngle(this.angle + 0.4 * dt);
      this.velocity = this.velocity.scale(0.95);
      this.applyPhysicsPublic(dt);
    }
  }

  /** Public adapter for the protected applyPhysics on FighterShip. */
  private applyPhysicsPublic(dt: number): void {
    // FighterShip.applyPhysics is protected; we re-implement the same
    // algorithm rather than reach across access boundaries.
    this.velocity = this.velocity.scale(1 / (1 + 1.0 * dt));
    const speed = this.velocity.length();
    const maxSpeed = this.maxSpeed * this.speedMul;
    if (speed > maxSpeed) {
      this.velocity = this.velocity.normalize().scale(maxSpeed);
    }
    this.position = this.position.add(this.velocity.scale(dt));
  }

  /** Steer + thrust toward a world target. Mirror of FighterShip helpers. */
  private steerThrust(target: Vec2, dt: number): void {
    const desired = this.position.angleTo(target);
    const diff = wrapAngle(desired - this.angle);
    const turnRate = this.turnRate;
    if (Math.abs(diff) < turnRate * dt) {
      this.angle = desired;
    } else {
      this.angle = wrapAngle(this.angle + Math.sign(diff) * turnRate * dt);
    }
    const thrust = new Vec2(Math.cos(this.angle), Math.sin(this.angle))
      .scale(this.thrustPower * this.speedMul * dt);
    this.velocity = this.velocity.add(thrust);
    this.applyPhysicsPublic(dt);
  }

  private runBuildBehavior(dt: number): void {
    const order = this.buildOrder!;
    const target = cellCenter(order.cx, order.cy);
    const dist = this.position.distanceTo(target);
    if (dist > ARRIVE_DISTANCE) {
      this.steerThrust(target, dt);
      return;
    }
    // Begin construction animation.
    this.position = target.clone();
    this.velocity.set(0, 0);
    this.buildAnim = BUILD_ANIMATION_SECONDS;
  }

  private runRepairBehavior(dt: number): void {
    const target = this.repairTarget!;
    if (!target.alive) {
      this.repairTarget = null;
      return;
    }
    const dist = this.position.distanceTo(target.position);
    if (dist > REPAIR_RANGE) {
      this.steerThrust(target.position, dt);
      return;
    }
    // Heal in place
    this.velocity = this.velocity.scale(0.85);
    if (target.health < target.maxHealth) {
      target.health = Math.min(
        target.maxHealth,
        target.health + REPAIR_RATE_HP_PER_S * this.buildSpeedMul * dt,
      );
    } else {
      // Target fully healed — release.
      this.repairTarget = null;
    }
  }

  /**
   * Called by the base planner each tick. Returns the building entity to
   * spawn (and the conduit cell to paint, if any) once the build animation
   * finishes. Returns null if not yet ready.
   */
  consumeFinishedBuild(): { ent: BuildingBase; cx: number; cy: number; layConduit: boolean } | null {
    if (!this.buildOrder) return null;
    if (this.buildAnim > 0) return null;
    // buildOrder still set, anim done → place the structure.
    const order = this.buildOrder;
    this.buildOrder = null;
    const pos = footprintCenter(order.cx, order.cy, order.def.footprintCells);
    const ent = createBuildingFromDef(order.def, pos, this.team);
    // Newly placed enemy buildings start slightly visible so the player sees them grow in.
    if (ent.buildProgress < 1) ent.buildProgress = 0.05;
    return { ent, cx: order.cx, cy: order.cy, layConduit: order.layConduitFirst };
  }

  /** Convenience flag for renderers / planner. */
  get isBuilding(): boolean {
    return this.buildAnim > 0;
  }

  override draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom * 1.1;

    // Body — diamond silhouette so builders read distinct from fighters.
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);
    const detail = this.team === Team.Player
      ? colorToCSS(Colors.fighters)
      : colorToCSS(Colors.enemyfire);
    ctx.strokeStyle = detail;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(-r * 0.6, 0);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.stroke();
    // Tool/wrench dot
    ctx.fillStyle = detail;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Construction beam: dashed line from drone to target, plus pulse.
    const beamTarget =
      this.mode === 'build' && this.buildOrder
        ? cellCenter(this.buildOrder.cx, this.buildOrder.cy)
        : this.mode === 'repair' && this.repairTarget
          ? this.repairTarget.position
          : null;
    if (beamTarget && (this.isBuilding || this.mode === 'repair')) {
      const t = camera.worldToScreen(beamTarget);
      const beamColor =
        this.mode === 'repair'
          ? colorToCSS(Colors.healthbar, 0.65)
          : colorToCSS(Colors.radar_friendly_status, 0.55);
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Sparks at target during construction
      if (this.isBuilding) {
        const sparkR = 4 + 6 * Math.abs(Math.sin(performance.now() * 0.02));
        ctx.strokeStyle = colorToCSS(Colors.radar_friendly_status, 0.8);
        ctx.beginPath();
        ctx.arc(t.x, t.y, sparkR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Health pip
    if (this.health < this.maxHealth) {
      const w = 16, h = 2;
      const x0 = screen.x - w / 2, y0 = screen.y - r - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = colorToCSS(Colors.healthbar, 0.9);
      ctx.fillRect(x0, y0, w * this.healthFraction, h);
    }
  }
}

/** Type guard. */
export function isBuilderDrone(e: unknown): e is BuilderDrone {
  return e instanceof BuilderDrone;
}
