/** AI-controlled fighter and bomber ships for Gate88 */

import { Vec2, wrapAngle, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team, ShipGroup } from './entities.js';
import { TICK_RATE } from './constants.js';
import { Shipyard } from './building.js';
import { Colors, colorToCSS, Color } from './colors.js';
import { ENTITY_RADIUS, PLAYER_SHIP_SCALE, SHIP_STATS } from './constants.js';

export type FighterOrder = 'idle' | 'attack' | 'dock' | 'defend' | 'escort' | 'harass' | 'protect' | 'waypoint' | 'follow';

const GROUP_COLORS: Record<ShipGroup, Color> = {
  [ShipGroup.Red]: Colors.redgroup,
  [ShipGroup.Green]: Colors.greengroup,
  [ShipGroup.Blue]: Colors.bluegroup,
};

const ENGAGE_RANGE = 300;
const DOCK_DISTANCE = 30;
const SHIELD_MAX = 18;
const SHIELD_REGEN_RATE = 4;
const SHIELD_REGEN_DELAY = 2.0;
const TRAIL_LIFETIME = 0.42;
const TRAIL_MIN_DISTANCE = 3;

interface TrailPoint {
  pos: Vec2;
  age: number;
}

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
  private readonly swarmSeed: number;
  private readonly orbitPhase: number;
  private readonly orbitRadius: number;
  private readonly orbitDrift: number;
  private avoidVelocity: Vec2 = new Vec2(0, 0);
  private trail: TrailPoint[] = [];
  shieldUnlocked = false;
  shield: number = 0;
  maxShield: number = SHIELD_MAX;
  shieldRegenRate: number = SHIELD_REGEN_RATE;
  private shieldRegenDelay = 0;

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
      ENTITY_RADIUS.fighter * (team === Team.Player ? PLAYER_SHIP_SCALE : 1),
    );
    this.group = group;
    this.homeYard = homeYard;
    this.turnRate = SHIP_STATS.fighter.turnRate;
    this.thrustPower = SHIP_STATS.fighter.speed;
    this.maxSpeed = SHIP_STATS.fighter.speed;
    this.swarmSeed = Math.abs(Math.imul(this.id, 2654435761));
    this.orbitPhase = (this.swarmSeed % 6283) / 1000;
    this.orbitRadius = 34 + ((this.swarmSeed >>> 8) % 52);
    this.orbitDrift = 0.7 + ((this.swarmSeed >>> 16) % 70) / 100;
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (this.docked) {
      this.trail.length = 0;
      return;
    }

    this.runAI(dt);
    this.applyPhysics(dt);
    this.updateTrail(dt);
    this.updateShield(dt);

    if (this.fireTimer > 0) this.fireTimer -= dt;
  }

  /** Override point for AI behaviour. */
  protected runAI(dt: number): void {
    switch (this.order) {
      case 'attack':
      case 'defend':
      case 'escort':
      case 'harass':
      case 'protect':
      case 'waypoint':
      case 'follow':
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
    const t = performance.now() * 0.001;
    this.angularVel += (Math.sin(t * this.orbitDrift + this.orbitPhase) * 0.7 + randomRange(-0.18, 0.18)) * dt;
    this.angle = wrapAngle(this.angle + this.angularVel * dt);
    this.angularVel *= 0.95;
    this.thrustForward(dt * 0.12);
  }

  private aiAttack(dt: number): void {
    if (!this.targetPos) {
      this.order = 'idle';
      return;
    }
    const dist = this.position.distanceTo(this.targetPos);
    if (this.order === 'waypoint' || this.order === 'follow' || this.order === 'protect') {
      const organicTarget = this.weaveTarget(this.targetPos, 18);
      this.steerTowards(organicTarget, dt);
      this.thrustForward(dt * (dist < 55 ? 0.35 : 0.85));
      return;
    }
    if (dist < 90) {
      const orbit = new Vec2(
        this.targetPos.x - (this.position.y - this.targetPos.y),
        this.targetPos.y + (this.position.x - this.targetPos.x),
      );
      this.steerTowards(orbit, dt);
      this.thrustForward(dt * 0.45);
      return;
    }
    this.steerTowards(this.weaveTarget(this.targetPos, 14), dt);
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
    this.velocity = this.velocity.add(this.avoidVelocity.scale(dt));
    this.avoidVelocity = this.avoidVelocity.scale(0.65);
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
    this.trail = [{ pos: this.position.clone(), age: 0 }];
  }

  destroy(): void {
    super.destroy();
    if (this.homeYard) {
      this.homeYard.activeShips = Math.max(0, this.homeYard.activeShips - 1);
    }
  }

  enableShield(): void {
    this.shieldUnlocked = true;
    this.shield = Math.max(this.shield, this.maxShield);
    this.shieldRegenDelay = 0;
  }

  override takeDamage(amount: number, source?: Entity): void {
    if (!this.alive || amount <= 0) {
      super.takeDamage(amount, source);
      return;
    }
    if (this.shieldUnlocked && this.shield > 0) {
      const blocked = Math.min(this.shield, amount);
      this.shield -= blocked;
      amount -= blocked;
      this.shieldRegenDelay = SHIELD_REGEN_DELAY;
    }
    if (amount > 0) super.takeDamage(amount, source);
  }

  private updateShield(dt: number): void {
    if (!this.shieldUnlocked) return;
    if (this.shieldRegenDelay > 0) {
      this.shieldRegenDelay -= dt;
      return;
    }
    this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenRate * dt);
  }

  private updateTrail(dt: number): void {
    for (const point of this.trail) point.age += dt;
    this.trail = this.trail.filter((point) => point.age <= TRAIL_LIFETIME);
    const last = this.trail[this.trail.length - 1];
    if (!last || last.pos.distanceTo(this.position) >= TRAIL_MIN_DISTANCE) {
      this.trail.push({ pos: this.position.clone(), age: 0 });
    }
    if (this.trail.length > 20) this.trail.shift();
  }

  protected drawMotionTrail(ctx: CanvasRenderingContext2D, camera: Camera, color: Color): void {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const fade = 1 - Math.max(a.age, b.age) / TRAIL_LIFETIME;
      if (fade <= 0) continue;
      const from = camera.worldToScreen(a.pos);
      const to = camera.worldToScreen(b.pos);
      ctx.strokeStyle = colorToCSS(color, 0.08 + fade * 0.28);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Drawing ---

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive || this.docked) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const coreColor = this.team === Team.Player ? Colors.mainguy : Colors.enemy_status;
    this.drawMotionTrail(ctx, camera, coreColor);

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

    const coreTime = performance.now() * 0.001 + this.orbitPhase;
    const groupColor = GROUP_COLORS[this.group];
    const pulse = 0.5 + 0.5 * Math.sin(coreTime * 2.8);
    const glint = 0.5 + 0.5 * Math.sin(coreTime * 5.3 + 1.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(coreColor, 0.10 + pulse * 0.12);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(groupColor, 0.18 + pulse * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * (0.62 + pulse * 0.08), coreTime, coreTime + Math.PI * 1.35);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = colorToCSS(coreColor, 0.72 + 0.28 * this.healthFraction);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.25 + glint * 0.18);
    ctx.beginPath();
    ctx.arc(screen.x - r * 0.09, screen.y - r * 0.09, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    if (this.shieldUnlocked && this.shield > 0) {
      const shieldFrac = this.shield / this.maxShield;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.radar_allied_status, 0.16 + shieldFrac * 0.34);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * (1.55 + shieldFrac * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  applySeparationFrom(other: FighterShip, dt: number): void {
    if (!this.alive || this.docked || !other.alive || other.docked || other === this) return;
    const dx = this.position.x - other.position.x;
    const dy = this.position.y - other.position.y;
    const distSq = dx * dx + dy * dy;
    const desired = Math.max(20, this.radius + other.radius + 18);
    if (distSq <= 0.0001 || distSq > desired * desired) return;
    const dist = Math.sqrt(distSq);
    const push = (1 - dist / desired) * 210 * dt;
    this.avoidVelocity = this.avoidVelocity.add(new Vec2(dx / dist, dy / dist).scale(push));
  }

  private weaveTarget(base: Vec2, amount: number): Vec2 {
    const t = performance.now() * 0.001;
    const waveA = t * this.orbitDrift + this.orbitPhase;
    const waveB = t * (this.orbitDrift * 0.43 + 0.19) + this.orbitPhase * 1.7;
    const radius = Math.min(this.orbitRadius, amount) * (0.82 + 0.18 * Math.sin(waveB));
    return new Vec2(
      base.x + Math.cos(waveA) * radius + Math.sin(waveB * 1.31) * amount * 0.35,
      base.y + Math.sin(waveA * 0.91) * radius + Math.cos(waveB) * amount * 0.35,
    );
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
    this.radius = ENTITY_RADIUS.bomber * (team === Team.Player ? PLAYER_SHIP_SCALE : 1);
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
    const coreColor = this.team === Team.Player ? Colors.mainguy : Colors.enemy_status;
    this.drawMotionTrail(ctx, camera, coreColor);

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

    const coreTime = performance.now() * 0.001;
    const groupColor = GROUP_COLORS[this.group];
    const pulse = 0.5 + 0.5 * Math.sin(coreTime * 2.3 + this.id);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(coreColor, 0.10 + pulse * 0.12);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorToCSS(groupColor, 0.18 + pulse * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * (0.65 + pulse * 0.08), -coreTime, -coreTime + Math.PI * 1.35);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = colorToCSS(coreColor, 0.72 + 0.28 * this.healthFraction);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorToCSS(Colors.particles_switch, 0.28);
    ctx.beginPath();
    ctx.arc(screen.x - r * 0.1, screen.y - r * 0.1, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    if (this.shieldUnlocked && this.shield > 0) {
      const shieldFrac = this.shield / this.maxShield;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = colorToCSS(Colors.radar_allied_status, 0.16 + shieldFrac * 0.34);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * (1.35 + shieldFrac * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
