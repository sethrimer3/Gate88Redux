/** Projectile types for Gate88 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import { ENTITY_RADIUS, WEAPON_STATS } from './constants.js';

// ---------------------------------------------------------------------------
// Base projectile
// ---------------------------------------------------------------------------

export abstract class ProjectileBase extends Entity {
  damage: number;
  speed: number;
  lifetime: number;
  maxLifetime: number;
  source: Entity | null;

  constructor(
    type: EntityType,
    team: Team,
    position: Vec2,
    angle: number,
    damage: number,
    speed: number,
    lifetime: number,
    source: Entity | null = null,
  ) {
    super(type, team, position, 1, ENTITY_RADIUS.bullet);
    this.angle = angle;
    this.damage = damage;
    this.speed = speed;
    this.lifetime = lifetime;
    this.maxLifetime = lifetime;
    this.source = source;

    // Initial velocity in the direction of the angle
    this.velocity = new Vec2(
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
    );
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.position = this.position.add(this.velocity.scale(dt));
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.destroy();
    }
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
    super(
      EntityType.Bullet,
      team,
      position,
      angle,
      WEAPON_STATS.fire.damage,
      WEAPON_STATS.fire.speed,
      WEAPON_STATS.fire.range / WEAPON_STATS.fire.speed,
      source,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const fireColor =
      this.team === Team.Player
        ? colorToCSS(Colors.friendlyfire)
        : colorToCSS(Colors.enemyfire);

    // Small bright dot with short tail
    const tail = this.velocity.normalize().scale(-4 * camera.zoom);
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
    super(
      EntityType.Missile,
      team,
      position,
      angle,
      WEAPON_STATS.missile.damage,
      WEAPON_STATS.missile.speed,
      WEAPON_STATS.missile.range / WEAPON_STATS.missile.speed,
      source,
    );
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
    super(
      EntityType.Laser,
      team,
      startPos,
      angle,
      WEAPON_STATS.laser.damage,
      0,
      0.1, // very short lifetime for visual
      source,
    );
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
    super(
      EntityType.ExciterBullet,
      team,
      position,
      angle,
      WEAPON_STATS.exciterbullet.damage,
      WEAPON_STATS.exciterbullet.speed,
      WEAPON_STATS.exciterbullet.range / WEAPON_STATS.exciterbullet.speed,
      source,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
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
    super(EntityType.ExciterBeam, team, startPos, angle, WEAPON_STATS.exciterbeam.damage, 0, 0.08, source);
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
    super(
      EntityType.MassDriverBullet,
      team,
      position,
      angle,
      WEAPON_STATS.massdriverbullet.damage,
      WEAPON_STATS.massdriverbullet.speed,
      WEAPON_STATS.massdriverbullet.range / WEAPON_STATS.massdriverbullet.speed,
      source,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = 3 * camera.zoom;
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
    super(
      EntityType.RegenBullet,
      team,
      position,
      angle,
      WEAPON_STATS.regenbullet.damage, // negative = heals
      WEAPON_STATS.regenbullet.speed,
      WEAPON_STATS.regenbullet.range / WEAPON_STATS.regenbullet.speed,
      source,
    );
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
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
    super(
      EntityType.FireBomb,
      team,
      position,
      angle,
      WEAPON_STATS.firebomb.damage,
      WEAPON_STATS.firebomb.speed,
      WEAPON_STATS.firebomb.range / WEAPON_STATS.firebomb.speed,
      source,
    );
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
