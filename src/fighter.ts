/** AI-controlled fighter and bomber ships for Gate88 */

import { Vec2, wrapAngle, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team, ShipGroup } from './entities.js';
import { TICK_RATE } from './constants.js';
import { Shipyard } from './building.js';
import { Colors, colorToCSS, Color } from './colors.js';
import { ENTITY_RADIUS, SHIP_STATS } from './constants.js';

export type FighterOrder = 'idle' | 'attack' | 'dock' | 'defend' | 'escort' | 'harass';

const GROUP_COLORS: Record<ShipGroup, Color> = {
  [ShipGroup.Red]: Colors.redgroup,
  [ShipGroup.Green]: Colors.greengroup,
  [ShipGroup.Blue]: Colors.bluegroup,
};

const ENGAGE_RANGE = 300;
const DOCK_DISTANCE = 30;

// ---------------------------------------------------------------------------
// FighterShip
// ---------------------------------------------------------------------------

export class FighterShip extends Entity {
  group: ShipGroup;
  docked: boolean = true;
  order: FighterOrder = 'idle';
  targetPos: Vec2 | null = null;
  homeYard: Shipyard | null = null;

  protected turnRate: number;
  protected thrustPower: number;
  protected maxSpeed: number;
  protected friction: number = 1.0;

  // Weapon
  fireTimer: number = 0;
  fireRate: number = 10; // ticks between shots
  weaponRange: number = 250;

  constructor(
    position: Vec2,
    team: Team,
    group: ShipGroup,
    homeYard: Shipyard | null = null,
  ) {
    super(
      EntityType.Fighter,
      team,
      position,
      SHIP_STATS.fighter.health,
      ENTITY_RADIUS.fighter,
    );
    this.group = group;
    this.homeYard = homeYard;
    this.turnRate = SHIP_STATS.fighter.turnRate;
    this.thrustPower = SHIP_STATS.fighter.speed;
    this.maxSpeed = SHIP_STATS.fighter.speed;
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (this.docked) return;

    this.runAI(dt);
    this.applyPhysics(dt);

    if (this.fireTimer > 0) this.fireTimer -= dt;
  }

  /** Override point for AI behaviour. */
  protected runAI(dt: number): void {
    switch (this.order) {
      case 'attack':
      case 'defend':
      case 'escort':
      case 'harass':
        this.aiAttack(dt);
        break;
      case 'dock':
        this.aiDock(dt);
        break;
      case 'idle':
      default:
        this.aiIdle(dt);
        break;
    }
  }

  // --- AI states ---

  private aiIdle(dt: number): void {
    // Drift slowly; slight random wander
    this.angularVel += randomRange(-0.5, 0.5) * dt;
    this.angle = wrapAngle(this.angle + this.angularVel * dt);
    this.angularVel *= 0.95;
  }

  private aiAttack(dt: number): void {
    if (!this.targetPos) {
      this.order = 'idle';
      return;
    }
    this.steerTowards(this.targetPos, dt);
    this.thrustForward(dt);
  }

  private aiDock(dt: number): void {
    if (!this.homeYard || !this.homeYard.alive) {
      this.order = 'idle';
      return;
    }
    const dist = this.position.distanceTo(this.homeYard.position);
    if (dist < DOCK_DISTANCE) {
      this.docked = true;
      this.velocity.set(0, 0);
      this.position = this.homeYard.position.clone();
      return;
    }
    this.steerTowards(this.homeYard.position, dt);
    this.thrustForward(dt);
  }

  // --- Helpers ---

  protected steerTowards(target: Vec2, dt: number): void {
    const desired = this.position.angleTo(target);
    const diff = wrapAngle(desired - this.angle);
    if (Math.abs(diff) < this.turnRate * dt) {
      this.angle = desired;
    } else {
      this.angle = wrapAngle(this.angle + Math.sign(diff) * this.turnRate * dt);
    }
  }

  protected thrustForward(dt: number): void {
    const thrust = new Vec2(Math.cos(this.angle), Math.sin(this.angle)).scale(
      this.thrustPower * dt,
    );
    this.velocity = this.velocity.add(thrust);
  }

  protected applyPhysics(dt: number): void {
    this.velocity = this.velocity.scale(1 / (1 + this.friction * dt));
    const speed = this.velocity.length();
    if (speed > this.maxSpeed) {
      this.velocity = this.velocity.normalize().scale(this.maxSpeed);
    }
    this.position = this.position.add(this.velocity.scale(dt));
  }

  /** Check whether the fighter should engage an enemy at the given position. */
  isInEngageRange(enemyPos: Vec2): boolean {
    return this.position.distanceTo(enemyPos) < ENGAGE_RANGE;
  }

  canFire(): boolean {
    return this.fireTimer <= 0 && !this.docked;
  }

  consumeShot(cooldownTicks: number): void {
    this.fireTimer = cooldownTicks / TICK_RATE;
  }

  /** Undock from shipyard and take off. */
  launch(): void {
    this.docked = false;
    this.angle = randomRange(0, Math.PI * 2);
    this.velocity = new Vec2(Math.cos(this.angle), Math.sin(this.angle)).scale(
      this.maxSpeed * 0.3,
    );
  }

  destroy(): void {
    super.destroy();
    if (this.homeYard) {
      this.homeYard.activeShips = Math.max(0, this.homeYard.activeShips - 1);
    }
  }

  // --- Drawing ---

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive || this.docked) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Ship body: small triangle
    const shipColor = colorToCSS(Colors.fighters);
    ctx.strokeStyle = shipColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.6, -r * 0.6);
    ctx.lineTo(-r * 0.3, 0);
    ctx.lineTo(-r * 0.6, r * 0.6);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    // Group-colored center circle
    const groupCol = colorToCSS(GROUP_COLORS[this.group], 0.6 + 0.4 * this.healthFraction);
    ctx.fillStyle = groupCol;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// BomberShip – slower, more HP, higher damage
// ---------------------------------------------------------------------------

export class BomberShip extends FighterShip {
  constructor(
    position: Vec2,
    team: Team,
    group: ShipGroup,
    homeYard: Shipyard | null = null,
  ) {
    super(position, team, group, homeYard);
    this.type = EntityType.Bomber;
    this.health = SHIP_STATS.bomber.health;
    this.maxHealth = SHIP_STATS.bomber.health;
    this.radius = ENTITY_RADIUS.bomber;
    this.turnRate = SHIP_STATS.bomber.turnRate;
    this.thrustPower = SHIP_STATS.bomber.speed;
    this.maxSpeed = SHIP_STATS.bomber.speed;
    this.fireRate = 20;
    this.weaponRange = 200;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive || this.docked) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Larger diamond shape
    const shipColor = colorToCSS(Colors.fighters);
    ctx.strokeStyle = shipColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 1.0, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(-r * 0.8, 0);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    // Group-colored center circle
    const groupCol = colorToCSS(GROUP_COLORS[this.group], 0.6 + 0.4 * this.healthFraction);
    ctx.fillStyle = groupCol;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
