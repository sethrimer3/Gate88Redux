/** Projectile types for Gate88 */

import { Vec2, wrapAngle } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, WEAPON_STATS } from './constants.js';

const BULLET_TRAIL_LIFETIME = 0.09;
const BULLET_TRAIL_MIN_DISTANCE = 2;
const GATLING_TRAIL_LIFETIME = 0.0275;

interface TrailPoint {
  pos: Vec2;
  age: number;
}

// ---------------------------------------------------------------------------
// Base projectile
// ---------------------------------------------------------------------------

export interface ProjectileOptions {
  type: EntityType;
  team: Team;
  position: Vec2;
  angle: number;
  damage: number;
  speed: number;
  lifetime: number;
  source?: Entity | null;
}

export abstract class ProjectileBase extends Entity {
  damage: number;
  speed: number;
  lifetime: number;
  maxLifetime: number;
  source: Entity | null;
  protected trail: TrailPoint[] = [];
  /**
   * When true, enemy projectiles can collide with and destroy this projectile.
   * Used by SwarmMissile to make swarm missiles interceptable by enemy bullets.
   */
  interceptable: boolean = false;

  constructor(opts: ProjectileOptions) {
    super(opts.type, opts.team, opts.position, 1, ENTITY_RADIUS.bullet);
    this.angle = opts.angle;
    this.damage = opts.damage;
    this.speed = opts.speed;
    this.lifetime = opts.lifetime;
    this.maxLifetime = opts.lifetime;
    this.source = opts.source ?? null;

    // Initial velocity in the direction of the angle
    this.velocity = new Vec2(
      Math.cos(opts.angle) * opts.speed,
      Math.sin(opts.angle) * opts.speed,
    );
    this.trail.push({ pos: this.position.clone(), age: 0 });
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.position = this.position.add(this.velocity.scale(dt));
    this.updateTrail(dt);
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.destroy();
    }
  }

  protected updateTrail(dt: number): void {
    for (const point of this.trail) point.age += dt;
    this.trail = this.trail.filter((point) => point.age <= BULLET_TRAIL_LIFETIME);
    const last = this.trail[this.trail.length - 1];
    if (!last || last.pos.distanceTo(this.position) >= BULLET_TRAIL_MIN_DISTANCE) {
      this.trail.push({ pos: this.position.clone(), age: 0 });
    }
    if (this.trail.length > 5) this.trail.shift();
  }

  protected drawTrail(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    color: string,
    lifetime: number = BULLET_TRAIL_LIFETIME,
    width: number = 3,
  ): void {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const fade = 1 - Math.max(a.age, b.age) / lifetime;
      if (fade <= 0) continue;
      const from = camera.worldToScreen(a.pos);
      const to = camera.worldToScreen(b.pos);
      ctx.globalAlpha = 0.12 + fade * 0.38;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Bullet – small, fast, straight line
// ---------------------------------------------------------------------------

export class Bullet extends ProjectileBase {
  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.Bullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.fire.damage,
      speed: WEAPON_STATS.fire.speed,
      lifetime: WEAPON_STATS.fire.range / WEAPON_STATS.fire.speed,
      source,
    });
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const fireColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendlyfire)
        : colorToCSS(Colors.enemyfire);
    this.drawTrail(ctx, camera, fireColor);

    // Small bright dot with short tail
    const tail = this.velocity.normalize().scale(-2 * camera.zoom);
    ctx.strokeStyle = fireColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(screen.x + tail.x, screen.y + tail.y);
    ctx.stroke();

    ctx.fillStyle = fireColor;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 2 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class GatlingBullet extends ProjectileBase {
  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.Bullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.gatling.damage,
      speed: WEAPON_STATS.gatling.speed,
      lifetime: WEAPON_STATS.gatling.range / WEAPON_STATS.gatling.speed,
      source,
    });
    this.radius = ENTITY_RADIUS.bullet * 0.75;
  }

  protected override updateTrail(dt: number): void {
    for (const point of this.trail) point.age += dt;
    this.trail = this.trail.filter((point) => point.age <= GATLING_TRAIL_LIFETIME);
    const last = this.trail[this.trail.length - 1];
    if (!last || last.pos.distanceTo(this.position) >= 5) {
      this.trail.push({ pos: this.position.clone(), age: 0 });
    }
    if (this.trail.length > 2) this.trail.shift();
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const fireColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendlyfire, 0.82)
        : colorToCSS(Colors.enemyfire, 0.82);
    this.drawTrail(ctx, camera, fireColor, GATLING_TRAIL_LIFETIME, 1.25);
    ctx.fillStyle = fireColor;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 1.5 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Missile – homing towards target
// ---------------------------------------------------------------------------

export class Missile extends ProjectileBase {
  targetEntity: Entity | null = null;
  readonly turnRate: number = 2.5;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
    target: Entity | null = null,
  ) {
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: WEAPON_STATS.missile.damage,
      speed: WEAPON_STATS.missile.speed,
      lifetime: WEAPON_STATS.missile.range / WEAPON_STATS.missile.speed,
      source,
    });
    this.radius = ENTITY_RADIUS.missile;
    this.targetEntity = target;
  }

  update(dt: number): void {
    if (!this.alive) return;

    // Homing behaviour
    if (this.targetEntity && this.targetEntity.alive) {
      const desired = this.position.angleTo(this.targetEntity.position);
      let diff = desired - this.angle;
      // Normalize
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = Math.sign(diff) * Math.min(Math.abs(diff), this.turnRate * dt);
      this.angle += steer;
    }

    this.velocity = new Vec2(
      Math.cos(this.angle) * this.speed,
      Math.sin(this.angle) * this.speed,
    );

    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const fireColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendlyfire)
        : colorToCSS(Colors.enemyfire);
    this.drawTrail(ctx, camera, fireColor);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Small triangle body
    ctx.fillStyle = fireColor;
    ctx.beginPath();
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.6, -r * 0.5);
    ctx.lineTo(-r * 0.6, r * 0.5);
    ctx.closePath();
    ctx.fill();

    // Exhaust trail glow
    ctx.fillStyle = colorToCSS(Colors.particles_neutral_exhaust, 0.6);
    ctx.beginPath();
    ctx.arc(-r * 0.8, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

export class GuidedMissile extends ProjectileBase {
  readonly blastRadius: number = 110;
  readonly releaseLifetime: number = 0.75;
  private readonly minSpeed: number = 110;
  private readonly maxSpeed: number = WEAPON_STATS.guidedmissile.speed;
  private readonly acceleration: number = 520;
  private readonly turnRate: number = 6.5;
  private guided = true;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: WEAPON_STATS.guidedmissile.damage,
      speed: 110,
      lifetime: WEAPON_STATS.guidedmissile.range / WEAPON_STATS.guidedmissile.speed + 1.1,
      source,
    });
    this.radius = ENTITY_RADIUS.missile * 1.7;
  }

  steerToward(target: Vec2): void {
    if (!this.guided || !this.alive) return;
    const desired = this.position.angleTo(target);
    const diff = wrapAngle(desired - this.angle);
    const maxStep = this.turnRate / 60;
    this.angle = wrapAngle(this.angle + Math.sign(diff) * Math.min(Math.abs(diff), maxStep));
  }

  release(): void {
    if (!this.guided) return;
    this.guided = false;
    this.lifetime = Math.min(this.lifetime, this.releaseLifetime);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.speed = Math.min(this.maxSpeed, Math.max(this.minSpeed, this.speed + this.acceleration * dt));
    this.velocity = new Vec2(Math.cos(this.angle) * this.speed, Math.sin(this.angle) * this.speed);
    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    this.drawTrail(ctx, camera, colorToCSS(Colors.alert2, 0.9), 0.14, 4);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.2);
    glow.addColorStop(0, 'rgba(255,255,255,0.65)');
    glow.addColorStop(0.35, colorToCSS(Colors.alert2, 0.36));
    glow.addColorStop(1, colorToCSS(Colors.explosion, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = colorToCSS(Colors.friendlyfire);
    ctx.beginPath();
    ctx.moveTo(r * 1.45, 0);
    ctx.lineTo(-r * 0.85, -r * 0.55);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r * 0.85, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colorToCSS(Colors.particles_neutral_exhaust, 0.75);
    ctx.beginPath();
    ctx.arc(-r, 0, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class BomberMissile extends ProjectileBase {
  readonly blastRadius: number = 48;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: WEAPON_STATS.bigmissile.damage,
      speed: WEAPON_STATS.bigmissile.speed,
      lifetime: WEAPON_STATS.bigmissile.range / WEAPON_STATS.bigmissile.speed,
      source,
    });
    this.radius = ENTITY_RADIUS.missile * 1.25;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    this.drawTrail(ctx, camera, colorToCSS(Colors.explosion, 0.75), 0.14, 2.5);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.team === Team.Player ? colorToCSS(Colors.friendlyfire) : colorToCSS(Colors.enemyfire);
    ctx.beginPath();
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.7, -r * 0.55);
    ctx.lineTo(-r * 0.7, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Laser – instant-hit beam
// ---------------------------------------------------------------------------

export class Laser extends ProjectileBase {
  targetPos: Vec2;

  constructor(
    team: Team,
    startPos: Vec2,
    targetPos: Vec2,
    source: Entity | null = null,
  ) {
    const angle = startPos.angleTo(targetPos);
    super({
      type: EntityType.Laser,
      team,
      position: startPos,
      angle,
      damage: WEAPON_STATS.laser.damage,
      speed: 0,
      lifetime: 0.1,
      source,
    });
    this.targetPos = targetPos.clone();
    this.velocity.set(0, 0);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.destroy();
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const from = camera.worldToScreen(this.position);
    const to = camera.worldToScreen(this.targetPos);
    const fireColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendlyfire, 0.8)
        : colorToCSS(Colors.enemyfire, 0.8);

    ctx.strokeStyle = fireColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Bright core
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// ExciterBullet – fast, small damage
// ---------------------------------------------------------------------------

export class ExciterBullet extends ProjectileBase {
  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.ExciterBullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.exciterbullet.damage,
      speed: WEAPON_STATS.exciterbullet.speed,
      lifetime: WEAPON_STATS.exciterbullet.range / WEAPON_STATS.exciterbullet.speed,
      source,
    });
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    this.drawTrail(ctx, camera, colorToCSS(Colors.exciterturret_detail, 0.9));
    ctx.fillStyle = colorToCSS(Colors.exciterturret_detail);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 1.5 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// ExciterBeam – instant hit beam variant
// ---------------------------------------------------------------------------

export class ExciterBeam extends ProjectileBase {
  targetPos: Vec2;

  constructor(
    team: Team,
    startPos: Vec2,
    targetPos: Vec2,
    source: Entity | null = null,
  ) {
    const angle = startPos.angleTo(targetPos);
    super({
      type: EntityType.ExciterBeam,
      team,
      position: startPos,
      angle,
      damage: WEAPON_STATS.exciterbeam.damage,
      speed: 0,
      lifetime: 0.08,
      source,
    });
    this.targetPos = targetPos.clone();
    this.velocity.set(0, 0);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.destroy();
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const from = camera.worldToScreen(this.position);
    const to = camera.worldToScreen(this.targetPos);
    ctx.strokeStyle = colorToCSS(Colors.exciterturret_detail, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// MassDriverBullet – slow, high damage, penetrating
// ---------------------------------------------------------------------------

export class MassDriverBullet extends ProjectileBase {
  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.MassDriverBullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.massdriverbullet.damage,
      speed: WEAPON_STATS.massdriverbullet.speed,
      lifetime: WEAPON_STATS.massdriverbullet.range / WEAPON_STATS.massdriverbullet.speed,
      source,
    });
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = 3 * camera.zoom;
    this.drawTrail(ctx, camera, colorToCSS(Colors.massdriverturret_detail, 0.85));
    ctx.fillStyle = colorToCSS(Colors.massdriverturret_detail);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// RegenBullet – heals friendly, damages enemy
// ---------------------------------------------------------------------------

export class RegenBullet extends ProjectileBase {
  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.RegenBullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.regenbullet.damage,
      speed: WEAPON_STATS.regenbullet.speed,
      lifetime: WEAPON_STATS.regenbullet.range / WEAPON_STATS.regenbullet.speed,
      source,
    });
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    this.drawTrail(ctx, camera, colorToCSS(Colors.particles_healing, 0.85));
    ctx.fillStyle = colorToCSS(Colors.particles_healing, 0.9);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 2 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// FireBomb – area damage on impact
// ---------------------------------------------------------------------------

export class FireBomb extends ProjectileBase {
  readonly blastRadius: number = 60;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.FireBomb,
      team,
      position,
      angle,
      damage: WEAPON_STATS.firebomb.damage,
      speed: WEAPON_STATS.firebomb.speed,
      lifetime: WEAPON_STATS.firebomb.range / WEAPON_STATS.firebomb.speed,
      source,
    });
    this.radius = ENTITY_RADIUS.missile;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const progress = 1 - this.lifetime / this.maxLifetime;

    // Pulsing glow that grows as it nears detonation
    const glow = r * (1 + progress * 0.5);
    ctx.fillStyle = colorToCSS(Colors.explosion, 0.3 + progress * 0.4);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, glow, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.fillStyle = colorToCSS(Colors.enemyfire);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// HomingBullet – cannon special: blue-tinted homing bullet (3× energy cost)
// ---------------------------------------------------------------------------

/**
 * Homing cannon bullet fired by the player's RMB cannon special.
 * Steers toward the nearest locked enemy at a moderate turn rate — not instant
 * perfect tracking — so skilled enemies can still dodge.  Visually distinct
 * from ordinary cannon rounds by its blue/cyan tint.
 */
export class HomingBullet extends ProjectileBase {
  targetEntity: Entity | null = null;
  /** Radians per second the bullet can turn.  Moderate — not instant. */
  readonly turnRate: number = 2.0;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
    target: Entity | null = null,
  ) {
    super({
      type: EntityType.Bullet,
      team,
      position,
      angle,
      damage: WEAPON_STATS.fire.damage, // same base damage as normal cannon
      speed: WEAPON_STATS.fire.speed,
      lifetime: WEAPON_STATS.fire.range / WEAPON_STATS.fire.speed,
      source,
    });
    this.radius = ENTITY_RADIUS.bullet * 1.15;
    this.targetEntity = target;
  }

  update(dt: number): void {
    if (!this.alive) return;
    // Steer toward target if it is still alive
    if (this.targetEntity && this.targetEntity.alive) {
      const desired = this.position.angleTo(this.targetEntity.position);
      let diff = desired - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = Math.sign(diff) * Math.min(Math.abs(diff), this.turnRate * dt);
      this.angle += steer;
      this.velocity = new Vec2(
        Math.cos(this.angle) * this.speed,
        Math.sin(this.angle) * this.speed,
      );
    }
    super.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    // Blue/cyan trail to distinguish from normal green cannon bullets
    const bulletColor = colorToCSS(Colors.alliedfire, 0.9);
    this.drawTrail(ctx, camera, bulletColor);

    const tail = this.velocity.normalize().scale(-3 * camera.zoom);
    ctx.strokeStyle = bulletColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(screen.x + tail.x, screen.y + tail.y);
    ctx.stroke();

    // Glow core
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(Colors.alliedfire, 0.4);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 3.5 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = bulletColor;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 2 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// SwarmMissile – guided-missile special: small blast-AOE, interceptable
// ---------------------------------------------------------------------------

/**
 * One missile in a rocket swarm (RMB ability for the guided-missile weapon).
 * Smaller than a BomberMissile but carries a blast radius so it deals AOE
 * damage on impact.  Setting `interceptable = true` allows enemy bullets to
 * destroy these missiles mid-flight, reusing the existing conduit-interaction
 * pattern.
 */
export class SwarmMissile extends ProjectileBase {
  /** AOE blast radius — smaller than a BomberMissile (48). */
  readonly blastRadius: number = 35;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: Math.round(WEAPON_STATS.bigmissile.damage * 0.55), // ~19 per missile
      speed: WEAPON_STATS.missile.speed * 1.05,
      lifetime: (WEAPON_STATS.bigmissile.range * 0.65) / (WEAPON_STATS.missile.speed * 1.05),
      source,
    });
    this.radius = ENTITY_RADIUS.missile * 1.1;
    this.interceptable = true; // enemy bullets can destroy swarm missiles
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;
    const missileColor = colorToCSS(Colors.alert2, 0.9);
    this.drawTrail(ctx, camera, missileColor, 0.12, 2);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = missileColor;
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(-r * 0.6, -r * 0.5);
    ctx.lineTo(-r * 0.6, r * 0.5);
    ctx.closePath();
    ctx.fill();
    // Exhaust glow
    ctx.fillStyle = colorToCSS(Colors.particles_neutral_exhaust, 0.55);
    ctx.beginPath();
    ctx.arc(-r * 0.7, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// ChargedLaserBurst – laser special: wide, bright charged energy beam (visual)
// ---------------------------------------------------------------------------

/**
 * Visual entity for the charged laser burst (RMB ability for the laser weapon).
 * Damage is applied immediately by damageLaserLine() in game.ts before this
 * entity is spawned; this class only provides the visual effect that persists
 * for a short time so the burst feels impactful.
 *
 * chargeFraction ∈ [0, 1] controls width and brightness.
 */
export class ChargedLaserBurst extends ProjectileBase {
  targetPos: Vec2;
  readonly chargeFraction: number;

  constructor(
    team: Team,
    startPos: Vec2,
    targetPos: Vec2,
    source: Entity | null = null,
    chargeFraction: number = 1.0,
  ) {
    const angle = startPos.angleTo(targetPos);
    super({
      type: EntityType.Laser,
      team,
      position: startPos,
      angle,
      damage: 0, // damage handled externally by damageLaserLine()
      speed: 0,
      lifetime: 0.28,
      source,
    });
    this.targetPos = targetPos.clone();
    this.velocity.set(0, 0);
    this.chargeFraction = Math.max(0, Math.min(1, chargeFraction));
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.destroy();
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const from = camera.worldToScreen(this.position);
    const to = camera.worldToScreen(this.targetPos);
    const fade = this.lifetime / 0.28; // 1 at spawn, 0 at expiry
    const beamWidth = (3 + this.chargeFraction * 7) * camera.zoom * fade;
    const burstColor = this.team === Team.Player ? Colors.friendlyfire : Colors.enemyfire;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // Outer glow
    ctx.strokeStyle = colorToCSS(burstColor, 0.28 * fade);
    ctx.lineWidth = beamWidth * 3.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Mid beam
    ctx.strokeStyle = colorToCSS(burstColor, 0.8 * fade);
    ctx.lineWidth = beamWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Bright white core
    ctx.strokeStyle = `rgba(255,255,255,${0.65 * fade})`;
    ctx.lineWidth = beamWidth * 0.35;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.restore();
  }
}
