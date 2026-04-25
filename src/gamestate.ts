/** Central game state manager for Gate88 */

import { Vec2 } from './math.js';
import { Entity, Team, EntityType } from './entities.js';
import { PlayerShip } from './ship.js';
import { BuildingBase, CommandPost, PowerGenerator, Shipyard, ResearchLab, Factory } from './building.js';
import { TurretBase } from './turret.js';
import { ProjectileBase, RegenBullet } from './projectile.js';
import { FighterShip } from './fighter.js';
import { ParticleSystem } from './particles.js';
import { Camera } from './camera.js';
import { Audio } from './audio.js';
import { RESOURCE_GAIN_RATE, BASELINE_RESOURCE_GAIN, POWERGENERATOR_COVERAGE_RADIUS, COMMANDPOST_BUILD_RADIUS } from './constants.js';

export interface ResearchProgress {
  item: string | null;
  progress: number;
  timeNeeded: number;
}

export type GameMode = 'menu' | 'tutorial' | 'practice' | 'playing';

export class GameState {
  player: PlayerShip;
  buildings: BuildingBase[] = [];
  projectiles: ProjectileBase[] = [];
  fighters: FighterShip[] = [];
  particles: ParticleSystem;

  resources: number = 500;
  researchProgress: ResearchProgress = { item: null, progress: 0, timeNeeded: 0 };
  researchedItems: Set<string> = new Set();

  /**
   * The most recently selected building type from the Z-Build menu.
   * Displayed in the HUD near the energy bar. PR 3's Q-hold grid paint mode
   * will use this as the "active" building to lay down along conduit paths.
   */
  selectedBuildType: string | null = null;

  gameMode: GameMode = 'menu';
  gameTime: number = 0;

  /** Entities that took damage this frame, used by radar for flash indicators. */
  recentlyDamaged: Set<number> = new Set();

  constructor(playerStart: Vec2 = new Vec2(0, 0)) {
    this.player = new PlayerShip(playerStart, Team.Player);
    this.particles = new ParticleSystem();
  }

  // -----------------------------------------------------------------------
  // Entity management
  // -----------------------------------------------------------------------

  addEntity(entity: Entity): void {
    if (entity instanceof ProjectileBase) {
      this.projectiles.push(entity);
    } else if (entity instanceof FighterShip) {
      this.fighters.push(entity);
    } else if (entity instanceof BuildingBase) {
      this.buildings.push(entity);
    }
  }

  removeEntity(entity: Entity): void {
    entity.alive = false;
  }

  /** Return all living entities across every list plus the player. */
  allEntities(): Entity[] {
    const result: Entity[] = [];
    if (this.player.alive) result.push(this.player);
    for (const b of this.buildings) if (b.alive) result.push(b);
    for (const f of this.fighters) if (f.alive) result.push(f);
    for (const p of this.projectiles) if (p.alive) result.push(p);
    return result;
  }

  /** Find all living entities within a given range of a world position. */
  getEntitiesInRange(pos: Vec2, range: number): Entity[] {
    const result: Entity[] = [];
    const rSq = range * range;
    for (const e of this.allEntities()) {
      const dx = e.position.x - pos.x;
      const dy = e.position.y - pos.y;
      if (dx * dx + dy * dy <= rSq) {
        result.push(e);
      }
    }
    return result;
  }

  /** All living entities hostile to the given team. */
  getEnemiesOf(team: Team): Entity[] {
    return this.allEntities().filter(
      (e) => e.team !== Team.Neutral && e.team !== team,
    );
  }

  /** All living entities friendly to the given team. */
  getFriendliesOf(team: Team): Entity[] {
    return this.allEntities().filter((e) => e.team === team);
  }

  // -----------------------------------------------------------------------
  // Per-frame update
  // -----------------------------------------------------------------------

  update(dt: number): void {
    if (this.gameMode === 'menu') return;

    this.gameTime += dt;
    this.recentlyDamaged.clear();

    // Update player
    this.player.update(dt);

    // Update buildings and power status
    this.updateBuildingPower();
    for (const b of this.buildings) b.update(dt);

    // Update fighters
    for (const f of this.fighters) f.update(dt);

    // Update projectiles
    for (const p of this.projectiles) p.update(dt);

    // Collision detection
    this.resolveCollisions();

    // Resources from factories
    this.accumulateResources(dt);

    // Research progress
    this.tickResearch(dt);

    // Particles
    this.particles.update(dt);

    // Cleanup dead entities
    this.cleanupDead();
  }

  // -----------------------------------------------------------------------
  // Collision detection
  // -----------------------------------------------------------------------

  private resolveCollisions(): void {
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;

      const isRegen = proj instanceof RegenBullet;

      // Check against buildings
      for (const b of this.buildings) {
        if (!b.alive) continue;
        if (this.checkHit(proj, b, isRegen)) break;
      }
      if (!proj.alive) continue;

      // Check against fighters
      for (const f of this.fighters) {
        if (!f.alive || f.docked) continue;
        if (this.checkHit(proj, f, isRegen)) break;
      }
      if (!proj.alive) continue;

      // Check against player
      if (this.player.alive) {
        this.checkHit(proj, this.player, isRegen);
      }
    }
  }

  /** Returns true if the projectile hit and was consumed. */
  private checkHit(proj: ProjectileBase, target: Entity, isRegen: boolean): boolean {
    // Regen bullets heal same-team, damage other-team
    if (isRegen && proj.team === target.team) {
      if (target.health >= target.maxHealth) return false;
      const dist = proj.position.distanceTo(target.position);
      if (dist < proj.radius + target.radius) {
        target.takeDamage(proj.damage); // negative damage = healing
        this.particles.emitHealing(target.position);
        proj.destroy();
        return true;
      }
      return false;
    }

    // Normal projectile: only hit enemies
    if (proj.team === target.team) return false;

    const dist = proj.position.distanceTo(target.position);
    const combinedRadius = proj.radius + target.radius;
    if (dist < combinedRadius) {
      target.takeDamage(proj.damage, proj);
      this.recentlyDamaged.add(target.id);
      if (!target.alive) {
        this.particles.emitExplosion(target.position, target.radius);
        // Explosion sound — size depends on entity type
        const playerDist = this.player.position.distanceTo(target.position);
        if (
          target.type === EntityType.CommandPost ||
          target.type === EntityType.PowerGenerator ||
          target.type === EntityType.FighterYard ||
          target.type === EntityType.BomberYard ||
          target.type === EntityType.ResearchLab ||
          target.type === EntityType.Factory
        ) {
          Audio.playSoundAt('explode2', playerDist);
        } else if (
          target.type === EntityType.MissileTurret ||
          target.type === EntityType.ExciterTurret ||
          target.type === EntityType.MassDriverTurret ||
          target.type === EntityType.RegenTurret ||
          target.type === EntityType.PlayerShip
        ) {
          Audio.playSoundAt('explode1', playerDist);
        } else {
          Audio.playSoundAt('explode0', playerDist);
        }
      } else {
        // Non-fatal hit — play hit sound and emit spark
        this.particles.emitSpark(target.position);
        const playerDist = this.player.position.distanceTo(target.position);
        Audio.playSoundAt('bhit0', playerDist);
      }
      proj.destroy();
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Building power
  // -----------------------------------------------------------------------

  private updateBuildingPower(): void {
    const commandPosts = this.buildings.filter(
      (b) => b.alive && b.type === EntityType.CommandPost,
    ) as CommandPost[];

    const generators = this.buildings.filter(
      (b) => b.alive && b.type === EntityType.PowerGenerator,
    ) as PowerGenerator[];

    for (const b of this.buildings) {
      if (!b.alive) continue;
      // CommandPosts and PowerGenerators are self-powered; shipyards too
      if (
        b.type === EntityType.CommandPost ||
        b.type === EntityType.PowerGenerator ||
        b.type === EntityType.FighterYard ||
        b.type === EntityType.BomberYard
      ) {
        b.powered = true;
        continue;
      }

      // Others need to be within a command post build radius or power generator coverage
      b.powered = false;
      for (const cp of commandPosts) {
        if (cp.team !== b.team) continue;
        if (cp.position.distanceTo(b.position) <= COMMANDPOST_BUILD_RADIUS) {
          b.powered = true;
          break;
        }
      }
      if (!b.powered) {
        for (const gen of generators) {
          if (gen.team !== b.team) continue;
          if (gen.position.distanceTo(b.position) <= POWERGENERATOR_COVERAGE_RADIUS) {
            b.powered = true;
            break;
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Resources
  // -----------------------------------------------------------------------

  private accumulateResources(dt: number): void {
    // Baseline resource gain — player automatically gains resources over time
    if (this.player.alive) {
      this.resources += BASELINE_RESOURCE_GAIN * dt;
    }

    // Bonus from factories
    for (const b of this.buildings) {
      if (
        b.alive &&
        b.type === EntityType.Factory &&
        b.team === Team.Player &&
        b.powered &&
        b.buildProgress >= 1
      ) {
        this.resources += RESOURCE_GAIN_RATE * dt;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Research
  // -----------------------------------------------------------------------

  private tickResearch(dt: number): void {
    if (!this.researchProgress.item) return;

    // Need a research lab
    const hasLab = this.buildings.some(
      (b) =>
        b.alive &&
        b.type === EntityType.ResearchLab &&
        b.team === Team.Player &&
        b.powered &&
        b.buildProgress >= 1,
    );
    if (!hasLab) return;

    this.researchProgress.progress += dt;
    if (this.researchProgress.progress >= this.researchProgress.timeNeeded) {
      this.researchedItems.add(this.researchProgress.item);
      this.researchProgress = { item: null, progress: 0, timeNeeded: 0 };
      Audio.playSound('researchcomplete');
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  private cleanupDead(): void {
    this.buildings = this.buildings.filter((b) => b.alive);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.fighters = this.fighters.filter((f) => f.alive);
  }

  // -----------------------------------------------------------------------
  // Drawing — calls draw on every entity
  // -----------------------------------------------------------------------

  drawEntities(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const b of this.buildings) b.draw(ctx, camera);
    for (const f of this.fighters) f.draw(ctx, camera);
    for (const p of this.projectiles) p.draw(ctx, camera);
    if (this.player.alive) this.player.draw(ctx, camera);
    this.particles.draw(ctx, camera);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Get the player's command post, if it exists. */
  getPlayerCommandPost(): CommandPost | null {
    return (
      (this.buildings.find(
        (b) => b.alive && b.type === EntityType.CommandPost && b.team === Team.Player,
      ) as CommandPost) ?? null
    );
  }

  /** Get the enemy's command post, if it exists. */
  getEnemyCommandPost(): CommandPost | null {
    return (
      (this.buildings.find(
        (b) => b.alive && b.type === EntityType.CommandPost && b.team === Team.Enemy,
      ) as CommandPost) ?? null
    );
  }

  /** Check if the player has a research lab. */
  hasResearchLab(): boolean {
    return this.buildings.some(
      (b) => b.alive && b.type === EntityType.ResearchLab && b.team === Team.Player,
    );
  }

  /** Get fighters of a specific group and team. */
  getFightersByGroup(team: Team, group: number): FighterShip[] {
    return this.fighters.filter(
      (f) => f.alive && f.team === team && f.group === group,
    );
  }

  /** Count docked and total fighters for a group. */
  getFighterGroupCounts(
    team: Team,
    group: number,
  ): { docked: number; total: number } {
    const groupFighters = this.getFightersByGroup(team, group);
    const docked = groupFighters.filter((f) => f.docked).length;
    return { docked, total: groupFighters.length };
  }
}
