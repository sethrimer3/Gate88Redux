/** Core entity types and base classes for Gate88 */

import { Vec2 } from './math.js';
import { Camera } from './camera.js';

export enum Team {
  Neutral = 0,
  Player = 1,
  Enemy = 2,
}

/**
 * Tactical orders that can be issued to fighter groups via the Command menu.
 *
 * AttackTarget uses the cursor position, DefendArea holds a cursor location,
 * EscortPlayer tracks the player ship, HarassPower prefers enemy generators,
 * and Dock returns ships to their home yard.
 */
export enum TacticalOrder {
  AttackTarget = 'attack',
  DefendArea   = 'defend',
  Dock         = 'dock',
  EscortPlayer = 'escort',
  HarassPower  = 'harass',
}

export enum ShipGroup {
  Red = 0,
  Green = 1,
  Blue = 2,
}

export enum EntityType {
  // Player & AI ships
  PlayerShip,
  Fighter,
  Bomber,
  // Buildings
  CommandPost,
  PowerGenerator,
  FighterYard,
  BomberYard,
  ResearchLab,
  Factory,
  // Turrets
  MissileTurret,
  ExciterTurret,
  MassDriverTurret,
  RegenTurret,
  TimeBomb,
  // Projectiles
  Bullet,
  Missile,
  Laser,
  ExciterBullet,
  ExciterBeam,
  MassDriverBullet,
  RegenBullet,
  FireBomb,
  // Effects
  Explosion,
}

let nextEntityId = 0;

export abstract class Entity {
  readonly id: number;
  type: EntityType;
  team: Team;
  position: Vec2;
  velocity: Vec2;
  angle: number;
  angularVel: number;
  health: number;
  maxHealth: number;
  radius: number;
  alive: boolean;

  constructor(
    type: EntityType,
    team: Team,
    position: Vec2,
    health: number,
    radius: number,
  ) {
    this.id = nextEntityId++;
    this.type = type;
    this.team = team;
    this.position = position.clone();
    this.velocity = new Vec2(0, 0);
    this.angle = 0;
    this.angularVel = 0;
    this.health = health;
    this.maxHealth = health;
    this.radius = radius;
    this.alive = true;
  }

  abstract update(dt: number): void;
  abstract draw(ctx: CanvasRenderingContext2D, camera: Camera): void;

  takeDamage(amount: number, _source?: Entity): void {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.destroy();
    }
    if (this.health > this.maxHealth) {
      this.health = this.maxHealth;
    }
  }

  destroy(): void {
    this.alive = false;
  }

  /** Fraction of health remaining in [0, 1]. */
  get healthFraction(): number {
    return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
  }
}
