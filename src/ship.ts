/** Player ship implementation for Gate88 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, SHIP_STATS } from './constants.js';

const BATTERY_MAX = 100;
const BATTERY_REGEN_RATE = 8;
const BATTERY_FIRE_COST = 5;
const BRAKE_FRICTION = 6.0;
const STRAFE_THRUST_SCALE = 0.8;

export class PlayerShip extends Entity {
  turnRate: number;
  thrustPower: number;
  maxSpeed: number;
  friction: number;

  battery: number = BATTERY_MAX;
  maxBattery: number = BATTERY_MAX;

  primaryFireTimer: number = 0;
  specialFireTimer: number = 0;

  private braking: boolean = false;
  private strafingLeft: boolean = false;
  private strafingRight: boolean = false;

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
  }

  update(dt: number): void {
    if (!this.alive) return;

    this.handleInput(dt);

    // Apply friction / braking
    const fric = this.braking ? BRAKE_FRICTION : this.friction;
    this.velocity = this.velocity.scale(1 / (1 + fric * dt));

    // Clamp speed
    const speed = this.velocity.length();
    if (speed > this.maxSpeed) {
      this.velocity = this.velocity.normalize().scale(this.maxSpeed);
    }

    // Integrate position
    this.position = this.position.add(this.velocity.scale(dt));

    // Regenerate battery
    this.battery = Math.min(this.maxBattery, this.battery + BATTERY_REGEN_RATE * dt);

    // Tick fire timers
    if (this.primaryFireTimer > 0) this.primaryFireTimer -= dt;
    if (this.specialFireTimer > 0) this.specialFireTimer -= dt;
  }

  private handleInput(dt: number): void {
    this.braking = false;

    // Activate strafe on double-tap-then-hold left/right
    if (Input.isDoubleTapDown('ArrowLeft') && Input.isDown('ArrowLeft')) {
      this.strafingLeft = true;
      this.strafingRight = false;
    }
    if (Input.isDoubleTapDown('ArrowRight') && Input.isDown('ArrowRight')) {
      this.strafingRight = true;
      this.strafingLeft = false;
    }

    // Deactivate strafe when the key is released
    if (!Input.isDown('ArrowLeft')) this.strafingLeft = false;
    if (!Input.isDown('ArrowRight')) this.strafingRight = false;

    // Rotation – only when not strafing
    if (!this.strafingLeft && !this.strafingRight) {
      if (Input.isDown('ArrowLeft')) {
        this.angle -= this.turnRate * dt;
      }
      if (Input.isDown('ArrowRight')) {
        this.angle += this.turnRate * dt;
      }
    }
    this.angle = wrapAngle(this.angle);

    // Thrust forward (ArrowUp)
    if (Input.isDown('ArrowUp')) {
      const thrust = new Vec2(Math.cos(this.angle), Math.sin(this.angle)).scale(
        this.thrustPower * dt,
      );
      this.velocity = this.velocity.add(thrust);
    }

    // Reverse thrust (ArrowDown)
    if (Input.isDown('ArrowDown')) {
      const thrust = new Vec2(Math.cos(this.angle), Math.sin(this.angle)).scale(
        -this.thrustPower * 0.5 * dt,
      );
      this.velocity = this.velocity.add(thrust);
    }

    // Strafe thrust (perpendicular to facing direction)
    if (this.strafingLeft) {
      const sideAngle = this.angle - Math.PI / 2;
      const thrust = new Vec2(Math.cos(sideAngle), Math.sin(sideAngle)).scale(
        this.thrustPower * STRAFE_THRUST_SCALE * dt,
      );
      this.velocity = this.velocity.add(thrust);
    }
    if (this.strafingRight) {
      const sideAngle = this.angle + Math.PI / 2;
      const thrust = new Vec2(Math.cos(sideAngle), Math.sin(sideAngle)).scale(
        this.thrustPower * STRAFE_THRUST_SCALE * dt,
      );
      this.velocity = this.velocity.add(thrust);
    }

    // Brake (double-tap down)
    if (Input.isDoubleTapped('ArrowDown')) {
      this.braking = true;
    }
  }

  /** Whether the ship is currently strafing left. */
  get isStrafingLeft(): boolean { return this.strafingLeft; }
  /** Whether the ship is currently strafing right. */
  get isStrafingRight(): boolean { return this.strafingRight; }

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
    if (this.strafingLeft || this.strafingRight) {
      const side = this.strafingLeft ? 1 : -1; // +1 = flame on right side of ship (strafing left)
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
        const flash = batteryFrac < 0.15 ? 0.5 + 0.5 * Math.sin(Date.now() * 0.01) : 1;
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
