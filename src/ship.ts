/** Player ship implementation for Gate88 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, SHIP_STATS } from './constants.js';
import { DEFAULT_SPECIAL_ID } from './special.js';

const BATTERY_MAX = 100;
const BATTERY_REGEN_RATE = 16;
const BATTERY_FIRE_COST = 5;

/**
 * How quickly the visual ship rotation chases the mouse-aim target. Set high
 * enough that aim feels instant but not so high that fast cursor jumps cause
 * visible snaps in the trail of exhaust particles.
 */
const AIM_TURN_RATE = 18.0; // radians per second

/**
 * Cross-product magnitude of (facing × thrustDir) above which we consider the
 * thrust to be perpendicular enough to the ship's facing to count as a "strafe"
 * (which triggers the side-thruster flame visual). Sin(~17°) ≈ 0.3 means
 * thrust within ~17° of straight forward/back is *not* counted as strafing.
 */
const STRAFE_CROSS_THRESHOLD = 0.3;

export class PlayerShip extends Entity {
  turnRate: number;
  thrustPower: number;
  maxSpeed: number;
  friction: number;

  battery: number = BATTERY_MAX;
  maxBattery: number = BATTERY_MAX;

  primaryFireTimer: number = 0;
  specialFireTimer: number = 0;

  /** Accumulated time used for visual effects like the low-battery flash. */
  drawTime: number = 0;

  /**
   * World-space target the ship rotates toward. The game loop updates this
   * each tick from the mouse cursor (via Camera.screenToWorld). Defaults to
   * "directly to the right" so the ship has a sensible angle before any
   * mouse movement.
   */
  aimWorld: Vec2;

  /** Id of the currently equipped special ability (RMB). */
  specialAbilityId: string = DEFAULT_SPECIAL_ID;

  /**
   * Direction of last applied thrust (unit vector). Used by game.ts to emit
   * exhaust particles trailing behind the actual motion direction rather than
   * behind the ship's facing (which is now decoupled from movement).
   */
  thrustDir: Vec2 = new Vec2(0, 0);
  /** True if any movement key was held this tick (used for SFX/exhaust). */
  isThrusting: boolean = false;

  constructor(position: Vec2, team: Team = Team.Player) {
    super(
      EntityType.PlayerShip,
      team,
      position,
      SHIP_STATS.mainguy.health,
      ENTITY_RADIUS.mainguy,
    );
    this.turnRate = SHIP_STATS.mainguy.turnRate;
    this.thrustPower = SHIP_STATS.mainguy.speed;
    this.maxSpeed = SHIP_STATS.mainguy.speed;
    this.friction = 1.0;
    this.aimWorld = new Vec2(position.x + 100, position.y);
  }

  update(dt: number): void {
    if (!this.alive) return;

    this.handleInput(dt);

    // Apply friction (damping). No brake in the new control scheme — releasing
    // all keys naturally decelerates the ship via this friction term.
    this.velocity = this.velocity.scale(1 / (1 + this.friction * dt));

    // Clamp speed
    const speed = this.velocity.length();
    if (speed > this.maxSpeed) {
      this.velocity = this.velocity.normalize().scale(this.maxSpeed);
    }

    // Integrate position
    this.position = this.position.add(this.velocity.scale(dt));

    // Regenerate battery
    this.battery = Math.min(this.maxBattery, this.battery + BATTERY_REGEN_RATE * dt);

    // Accumulate draw time for visual effects
    this.drawTime += dt;

    // Tick fire timers
    if (this.primaryFireTimer > 0) this.primaryFireTimer -= dt;
    if (this.specialFireTimer > 0) this.specialFireTimer -= dt;
  }

  /**
   * Set the world-space point the ship should aim at. Called by the game loop
   * each tick from the current mouse cursor position.
   */
  setAimPoint(world: Vec2): void {
    this.aimWorld = world;
  }

  protected handleInput(dt: number): void {
    // --- Movement: WASD as a 4-axis direction, decoupled from facing -----
    let dx = 0;
    let dy = 0;
    if (Input.isDown('w') || Input.isDown('W')) dy -= 1;
    if (Input.isDown('s') || Input.isDown('S')) dy += 1;
    if (Input.isDown('a') || Input.isDown('A')) dx -= 1;
    if (Input.isDown('d') || Input.isDown('D')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      // Normalize so diagonals don't get a sqrt(2) speed boost.
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      this.velocity = this.velocity.add(
        new Vec2(ux * this.thrustPower * dt, uy * this.thrustPower * dt),
      );
      this.thrustDir = new Vec2(ux, uy);
      this.isThrusting = true;
    } else {
      this.isThrusting = false;
    }

    // --- Aiming: rotate toward the world-space mouse cursor ---------------
    const desired = Math.atan2(
      this.aimWorld.y - this.position.y,
      this.aimWorld.x - this.position.x,
    );
    // Smooth turn toward desired angle so rapid cursor flicks don't snap.
    let delta = wrapAngle(desired - this.angle);
    const maxStep = AIM_TURN_RATE * dt;
    if (delta > maxStep) delta = maxStep;
    else if (delta < -maxStep) delta = -maxStep;
    this.angle = wrapAngle(this.angle + delta);
  }

  /**
   * Whether the ship is being side-thrusted. Retained for backward-compatible
   * rendering of the side thruster flames; under WASD-aim, "strafing" is any
   * thrust direction that isn't roughly aligned with the ship's facing.
   */
  get isStrafingLeft(): boolean {
    if (!this.isThrusting) return false;
    // Cross product sign of facing × thrustDir; positive = thrust is to the
    // ship's left (in screen-space where +y is down).
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    return fx * this.thrustDir.y - fy * this.thrustDir.x < -STRAFE_CROSS_THRESHOLD;
  }
  get isStrafingRight(): boolean {
    if (!this.isThrusting) return false;
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    return fx * this.thrustDir.y - fy * this.thrustDir.x > STRAFE_CROSS_THRESHOLD;
  }

  // --- Weapons ---

  canFirePrimary(): boolean {
    return this.primaryFireTimer <= 0 && this.battery >= BATTERY_FIRE_COST;
  }

  consumePrimaryFire(cooldown: number): void {
    this.primaryFireTimer = cooldown;
    this.battery -= BATTERY_FIRE_COST;
  }

  canFireSpecial(): boolean {
    return this.specialFireTimer <= 0 && this.battery >= BATTERY_FIRE_COST * 2;
  }

  consumeSpecialFire(cooldown: number): void {
    this.specialFireTimer = cooldown;
    this.battery -= BATTERY_FIRE_COST * 2;
  }

  // --- Drawing ---

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Side thruster flames when strafing
    if (this.isStrafingLeft || this.isStrafingRight) {
      const side = this.isStrafingLeft ? 1 : -1; // +1 = flame on right side of ship (strafing left)
      ctx.strokeStyle = colorToCSS(Colors.particles_friendly_exhaust, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, side * r * 0.7);
      ctx.lineTo(-r * 0.2, side * (r * 0.7 + r * 0.6));
      ctx.stroke();
      ctx.strokeStyle = colorToCSS(Colors.particles_friendly_exhaust, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 0.3, side * r * 0.55);
      ctx.lineTo(r * 0.3, side * (r * 0.55 + r * 0.45));
      ctx.stroke();
    }

    // Ship body: triangle / arrow shape
    const shipColor =
      this.team === Team.Player
        ? colorToCSS(Colors.mainguy)
        : colorToCSS(Colors.enemy_status);
    ctx.strokeStyle = shipColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r, -r * 0.7);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r, r * 0.7);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    // Center circle showing team
    const teamColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendly_status, 0.5 + 0.5 * this.healthFraction)
        : colorToCSS(Colors.enemy_status, 0.5 + 0.5 * this.healthFraction);
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Battery ring — color shifts green→yellow→red; flashes when critical
    const batteryFrac = this.battery / this.maxBattery;
    if (batteryFrac > 0) {
      let ringColor: string;
      if (batteryFrac > 0.6) {
        ringColor = colorToCSS(Colors.radar_friendly_status, 0.75);
      } else if (batteryFrac > 0.3) {
        ringColor = colorToCSS(Colors.alert2, 0.85);
      } else {
        // Flash at critical level
        const flash = batteryFrac < 0.15 ? 0.5 + 0.5 * Math.sin(this.drawTime * 10) : 1;
        ringColor = colorToCSS(Colors.alert1, 0.9 * flash);
      }
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        r * 0.55,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * batteryFrac,
      );
      ctx.stroke();
    }
  }
}
