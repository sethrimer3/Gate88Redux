/** Central game state manager for Gate88 */

import { Vec2 } from './math.js';
import { Entity, Team, EntityType } from './entities.js';
import { PlayerShip } from './ship.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { TurretBase } from './turret.js';
import { ProjectileBase, RegenBullet } from './projectile.js';
import { FighterShip } from './fighter.js';
import { ParticleSystem } from './particles.js';
import { RingEffectSystem } from './ringeffects.js';
import { Camera } from './camera.js';
import { Audio } from './audio.js';
import { WorldGrid, GRID_CELL_SIZE, cellKey } from './grid.js';
import { PowerGraph } from './power.js';
import { RESOURCE_GAIN_RATE, BASELINE_RESOURCE_GAIN } from './constants.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import type { BuildDef } from './builddefs.js';

export interface ResearchProgress {
  item: string | null;
  progress: number;
  timeNeeded: number;
}

export type GameMode = 'menu' | 'tutorial' | 'practice' | 'vs_ai' | 'playing';

export class GameState {
  player: PlayerShip;
  buildings: BuildingBase[] = [];
  projectiles: ProjectileBase[] = [];
  fighters: FighterShip[] = [];
  particles: ParticleSystem;
  /** Ring/blackout pulse effects (PR9). */
  ringEffects: RingEffectSystem = new RingEffectSystem();
  /** PR3: universal world grid storing painted conduits. */
  grid: WorldGrid = new WorldGrid();
  /** PR5: graph-based power network (lazy, dirty-flag cached). */
  power: PowerGraph = new PowerGraph();

  /**
   * Countdown until the next pending conduit is promoted to the active grid.
   * Conduits queued by the player are built one at a time from the network
   * frontier outward, with a 0.5 s delay between each.
   */
  private conduitBuildTimer: number = 0.5;

  resources: number = 500;
  researchProgress: ResearchProgress = { item: null, progress: 0, timeNeeded: 0 };
  researchedItems: Set<string> = new Set();

  /**
   * Vs. AI bot-player main ship, when the active mode is `vs_ai`.
   * Treated like a second player: physics tick, render, and projectile
   * collisions all flow through the same paths as `player`.
   */
  aiPlayerShip: PlayerShip | null = null;

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

  /**
   * PR7: timestamps of recent enemy construction events (in seconds since
   * gameTime). Used by the HUD to show warning markers near the player CP.
   * Entries older than 8 seconds are dropped on read.
   */
  recentEnemyConstructions: Array<{ pos: Vec2; time: number }> = [];

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
      this.power.markDirty();
    }
  }

  removeEntity(entity: Entity): void {
    entity.alive = false;
  }

  /** Return all living entities across every list plus the player. */
  allEntities(): Entity[] {
    const result: Entity[] = [];
    if (this.player.alive) result.push(this.player);
    if (this.aiPlayerShip && this.aiPlayerShip.alive) result.push(this.aiPlayerShip);
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
    // Vs. AI bot ship — same physics tick path.
    if (this.aiPlayerShip && this.aiPlayerShip.alive) {
      this.aiPlayerShip.update(dt);
    }

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

    // PR3: ship ↔ conduit interaction. Enemy fighters on friendly powered
    // conduits are bounced back and take light damage. Projectiles that hit
    // a powered opposing conduit are destroyed. Unpowered conduits are
    // intangible (pass-through for ships and shots alike).
    this.applyConduitInteraction(dt);

    // Tick the player's pending conduit queue (0.5 s per cell, BFS outward).
    this.tickPendingConduits(dt);

    // Research progress
    this.tickResearch(dt);

    // Particles
    this.particles.update(dt);
    this.ringEffects.update(dt);
    this.ringEffects.prune();

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
        if (this.checkHit(proj, this.player, isRegen)) continue;
      }

      // Check against the Vs. AI bot ship — it's a player-class entity
      // that must be damageable by player projectiles.
      if (this.aiPlayerShip && this.aiPlayerShip.alive) {
        this.checkHit(proj, this.aiPlayerShip, isRegen);
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
  // Building power (PR5: graph-based, see src/power.ts)
  // -----------------------------------------------------------------------

  private updateBuildingPower(): void {
    this.power.recompute(this);
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
  // Conduit interaction (PR3) — powered conduits block ships + shots
  // -----------------------------------------------------------------------

  /**
   * Powered conduits of team T block entities of team ≠ T:
   *   • Ships entering a powered opposing conduit cell are bounced back
   *     (velocity reflected on the penetration axis) and take a small
   *     damage tick so camping is punished.
   *   • Projectiles that enter a powered opposing conduit cell are destroyed
   *     immediately (shots cannot pass through powered conduit walls).
   * Unpowered conduits are fully intangible — ships and shots pass freely.
   */
  private applyConduitInteraction(dt: number): void {
    if (this.grid.conduitCount() === 0) return;

    // --- Ship bounce -------------------------------------------------------
    const CONDUIT_DPS = 0.5; // damage while touching an opposing powered conduit

    const shipsToCheck: Entity[] = [];
    if (this.player.alive) shipsToCheck.push(this.player);
    if (this.aiPlayerShip && this.aiPlayerShip.alive) shipsToCheck.push(this.aiPlayerShip);
    for (const f of this.fighters) {
      if (f.alive && !f.docked) shipsToCheck.push(f);
    }

    for (const ship of shipsToCheck) {
      const cx = Math.floor(ship.position.x / GRID_CELL_SIZE);
      const cy = Math.floor(ship.position.y / GRID_CELL_SIZE);
      const conduitTeam = this.grid.conduitTeam(cx, cy);
      // Only opposing-team powered conduits block ships.
      if (conduitTeam === null || conduitTeam === ship.team) continue;
      if (!this.power.isCellEnergized(conduitTeam, cx, cy)) continue;

      // Find the smallest penetration axis and push the ship out of the cell.
      const cellLeft   = cx * GRID_CELL_SIZE;
      const cellRight  = cellLeft + GRID_CELL_SIZE;
      const cellTop    = cy * GRID_CELL_SIZE;
      const cellBottom = cellTop + GRID_CELL_SIZE;

      const overlapL = ship.position.x - cellLeft;
      const overlapR = cellRight  - ship.position.x;
      const overlapT = ship.position.y - cellTop;
      const overlapB = cellBottom - ship.position.y;

      const minH = Math.min(overlapL, overlapR);
      const minV = Math.min(overlapT, overlapB);

      if (minH <= minV) {
        // Horizontal push
        if (overlapL < overlapR) {
          ship.position.x = cellLeft - ship.radius;
          if (ship.velocity.x > 0) ship.velocity.x *= -0.5;
        } else {
          ship.position.x = cellRight + ship.radius;
          if (ship.velocity.x < 0) ship.velocity.x *= -0.5;
        }
      } else {
        // Vertical push
        if (overlapT < overlapB) {
          ship.position.y = cellTop - ship.radius;
          if (ship.velocity.y > 0) ship.velocity.y *= -0.5;
        } else {
          ship.position.y = cellBottom + ship.radius;
          if (ship.velocity.y < 0) ship.velocity.y *= -0.5;
        }
      }

      // Light damage tick — deters camping against conduit walls.
      ship.takeDamage(CONDUIT_DPS * dt);
      this.recentlyDamaged.add(ship.id);
    }

    // --- Projectile blocking -----------------------------------------------
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      const cx = Math.floor(proj.position.x / GRID_CELL_SIZE);
      const cy = Math.floor(proj.position.y / GRID_CELL_SIZE);
      const conduitTeam = this.grid.conduitTeam(cx, cy);
      // Only opposing-team powered conduits stop shots.
      if (conduitTeam === null || conduitTeam === proj.team) continue;
      if (!this.power.isCellEnergized(conduitTeam, cx, cy)) continue;
      proj.destroy();
      this.particles.emitSpark(proj.position);
    }
  }

  // -----------------------------------------------------------------------
  // Pending conduit build queue (0.5 s per cell, BFS frontier outward)
  // -----------------------------------------------------------------------

  /**
   * Each tick, count down toward the next conduit build event. When the
   * timer fires, promote the first pending conduit that sits on the build
   * frontier (adjacent to an existing conduit or a power-source building).
   */
  private tickPendingConduits(dt: number): void {
    if (this.grid.pendingConduitCount() === 0) return;
    this.conduitBuildTimer -= dt;
    if (this.conduitBuildTimer > 0) return;
    this.conduitBuildTimer = 0.5;

    for (const { cx, cy, team } of this.grid.eachPendingConduit()) {
      if (this.isAtConduitFrontier(cx, cy, team)) {
        this.grid.promotePendingConduit(cx, cy);
        this.power.markDirty();
        Audio.playSound('build');
        break; // one per 0.5 s
      }
    }
  }

  /**
   * True when (cx, cy) is adjacent to an existing conduit of the same team
   * or adjacent to a Command Post / Power Generator cell of the same team.
   */
  private isAtConduitFrontier(cx: number, cy: number, team: Team): boolean {
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (this.grid.hasConduit(nx, ny) && this.grid.conduitTeam(nx, ny) === team) return true;
    }
    // Also count cells adjacent to a power-source building.
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      if (b.type !== EntityType.CommandPost && b.type !== EntityType.PowerGenerator) continue;
      const bx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const by = Math.floor(b.position.y / GRID_CELL_SIZE);
      if (Math.abs(cx - bx) + Math.abs(cy - by) <= 1) return true;
    }
    return false;
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
      if (this.researchProgress.item === 'advancedFighters') {
        for (const b of this.buildings) {
          if (b.alive && b.team === Team.Player && b instanceof Shipyard) {
            b.shipCapacity = 7;
            b.buildInterval = 4;
          }
        }
      }
      this.researchProgress = { item: null, progress: 0, timeNeeded: 0 };
      Audio.playSound('researchcomplete');
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  private cleanupDead(): void {
    const beforeBuildings = this.buildings.length;
    this.buildings = this.buildings.filter((b) => b.alive);
    if (this.buildings.length !== beforeBuildings) {
      this.power.markDirty();
    }
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
    if (this.aiPlayerShip && this.aiPlayerShip.alive) {
      this.aiPlayerShip.draw(ctx, camera);
    }
    this.particles.draw(ctx, camera);
    this.ringEffects.draw(ctx, camera);
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

  getPlacementStatus(def: BuildDef, pos: Vec2, team: Team): { valid: boolean; reason: string } {
    if (this.resources < def.cost && team === Team.Player) {
      return { valid: false, reason: 'Not enough resources' };
    }
    if (
      pos.x < GRID_CELL_SIZE * 0.5 ||
      pos.y < GRID_CELL_SIZE * 0.5 ||
      pos.x > WORLD_WIDTH - GRID_CELL_SIZE * 0.5 ||
      pos.y > WORLD_HEIGHT - GRID_CELL_SIZE * 0.5
    ) {
      return { valid: false, reason: 'Outside world' };
    }
    const cell = { cx: Math.floor(pos.x / GRID_CELL_SIZE), cy: Math.floor(pos.y / GRID_CELL_SIZE) };
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const bc = { cx: Math.floor(b.position.x / GRID_CELL_SIZE), cy: Math.floor(b.position.y / GRID_CELL_SIZE) };
      if (bc.cx === cell.cx && bc.cy === cell.cy) {
        return { valid: false, reason: 'Cell occupied' };
      }
    }
    if (def.key === 'commandpost') return { valid: true, reason: 'OK' };
    if (this.isNearPowerNetwork(cell.cx, cell.cy, team)) return { valid: true, reason: 'OK' };
    return { valid: false, reason: 'Build near command post, generator, or powered conduit' };
  }

  private isNearPowerNetwork(cx: number, cy: number, team: Team): boolean {
    const candidates = [
      [cx, cy], [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
    ];
    for (const [px, py] of candidates) {
      if (this.power.isCellEnergized(team, px, py)) return true;
      if (this.grid.conduitTeam(px, py) === team || this.grid.hasPendingConduit(px, py)) return true;
    }
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      if (b.type !== EntityType.CommandPost && b.type !== EntityType.PowerGenerator) continue;
      const bx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const by = Math.floor(b.position.y / GRID_CELL_SIZE);
      if (Math.abs(cx - bx) + Math.abs(cy - by) <= 1) return true;
    }
    return false;
  }
}
