/** Central game state manager for Gate88 */

import { pointToSegmentDistance, Vec2 } from './math.js';
import { Entity, Team, EntityType } from './entities.js';
import { PlayerShip } from './ship.js';
import { BuildingBase, CommandPost } from './building.js';
import { Shipyard } from './building.js';
import { SynonymousMineLayer, TurretBase } from './turret.js';
import { ProjectileBase, RegenBullet } from './projectile.js';
import { isSynonymousDriftMine } from './synonymousMine.js';
import { FighterShip } from './fighter.js';
import { ParticleSystem } from './particles.js';
import { RingEffectSystem } from './ringeffects.js';
import { Camera } from './camera.js';
import { Audio } from './audio.js';
import { WorldGrid, GRID_CELL_SIZE, cellKey, footprintOrigin, footprintCenter } from './grid.js';
import { PowerGraph } from './power.js';
import { RESOURCE_GAIN_RATE, BASELINE_RESOURCE_GAIN } from './constants.js';
import { WORLD_WIDTH, WORLD_HEIGHT, ENTITY_RADIUS } from './constants.js';
import { buildCostForBuildingType, buildDefForEntityType, createBuildingFromDef , type BuildDef } from './builddefs.js';
import { Colors, colorToCSS } from './colors.js';
import { footprintForBuildingType } from './buildingfootprint.js';
import { type FactionType, type ConfluenceTerritoryCircle, CONFLUENCE_BASE_RADIUS, CONFLUENCE_PLACEMENT_DISTANCE, CONFLUENCE_PLACEMENT_TOLERANCE, CONFLUENCE_PARENT_EXPAND_DURATION, CONFLUENCE_NEW_CIRCLE_GROW_DURATION, CONFLUENCE_INCLUDE_MARGIN, isConfluenceFaction, isSynonymousFaction } from './confluence.js';
import { SynonymousSwarmSystem, SYNONYMOUS_BASE_PRODUCTION, SYNONYMOUS_BUILD_COST, SYNONYMOUS_CURRENCY_SYMBOL, SYNONYMOUS_FACTORY_PRODUCTION } from './synonymous.js';

export interface DestroyedBuildingRecord {
  type: EntityType;
  team: Team;
  position: Vec2;
  maxHealth: number;
  erased?: boolean;
}

export interface DestroyedConduitRecord {
  cx: number;
  cy: number;
  team: Team;
  erased?: boolean;
}

export interface ResearchProgress {
  item: string | null;
  progress: number;
  timeNeeded: number;
}

export interface ExplosionGlow {
  center: Vec2;
  radius: number;
  lifeSeconds: number;
  totalSeconds: number;
  intensity: number;
}

export type GameMode = 'menu' | 'tutorial' | 'practice' | 'vs_ai' | 'playing' | 'lan_host' | 'lan_client' | 'online_host' | 'online_client';

export class GameState {
  /**
   * Map of slot index → PlayerShip for all active player ships (slots 0–7).
   * Slot 0 is always the local/host player; additional slots are remote
   * human players or AI ships in multiplayer.
   */
  playerShips: Map<number, PlayerShip> = new Map();

  /**
   * Convenience accessor for the slot-0 ship (local player / host).
   * All single-player code continues to use this; new multi-player code
   * should use `playerShips` directly.
   */
  get player(): PlayerShip {
    return this.playerShips.get(0)!;
  }

  buildings: BuildingBase[] = [];
  destroyedBuildings: DestroyedBuildingRecord[] = [];
  destroyedConduits: DestroyedConduitRecord[] = [];
  projectiles: ProjectileBase[] = [];
  fighters: FighterShip[] = [];
  particles: ParticleSystem;
  explosionGlows: ExplosionGlow[] = [];
  /** Ring/blackout pulse effects (PR9). */
  ringEffects: RingEffectSystem = new RingEffectSystem();
  /** PR3: universal world grid storing painted conduits. */
  grid: WorldGrid = new WorldGrid();
  /** PR5: graph-based power network (lazy, dirty-flag cached). */
  power: PowerGraph = new PowerGraph();
  synonymous: SynonymousSwarmSystem = new SynonymousSwarmSystem();
  private synonymousBaseAccumulator: Map<Team, number> = new Map();
  private synonymousFactoryAccumulator: Map<number, number> = new Map();

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
   *
   * In LAN multiplayer this is superseded by `playerShips`; for the
   * legacy Vs. AI mode it remains active so existing code is unchanged.
   */
  get aiPlayerShip(): PlayerShip | null {
    return this.playerShips.get(1) ?? null;
  }
  set aiPlayerShip(ship: PlayerShip | null) {
    if (ship) {
      this.playerShips.set(1, ship);
    } else {
      this.playerShips.delete(1);
    }
  }

  /**
   * The most recently selected building type from the Q build menu.
   * Displayed in the HUD near the energy bar.
   */
  selectedBuildType: string | null = null;

  gameMode: GameMode = 'menu';

  factionByTeam: Map<Team, FactionType> = new Map();
  territoryCirclesByTeam: Map<Team, ConfluenceTerritoryCircle[]> = new Map();
  private nextTerritoryCircleId = 1;
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
    this.playerShips.set(0, new PlayerShip(playerStart, Team.Player));
    this.particles = new ParticleSystem();
    this.factionByTeam.set(Team.Player, 'terran');
    this.factionByTeam.set(Team.Enemy, 'terran');
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
      if (isSynonymousFaction(this.factionByTeam, entity.team) && !entity.synonymousVisualKind) {
        if (entity.type === EntityType.CommandPost) entity.synonymousVisualKind = 'base';
        else if (entity.type === EntityType.Factory) entity.synonymousVisualKind = 'factory';
        else if (entity.type === EntityType.ResearchLab) entity.synonymousVisualKind = 'researchlab';
        else if (entity.type === EntityType.MissileTurret) entity.synonymousVisualKind = 'laserturret';
        else if (entity.type === EntityType.TimeBomb) entity.synonymousVisualKind = 'minelayer';
      }
      this.buildings.push(entity);
      if (!isSynonymousFaction(this.factionByTeam, entity.team)) {
        this.addAutomaticBuildingConduits(entity);
      }
      this.power.markDirty();
    }
  }

  removeEntity(entity: Entity): void {
    entity.alive = false;
  }

  repairDestroyedBuildingInRange(source: BuildingBase, range: number): Vec2 | null {
    let bestIndex = -1;
    let bestDist = range;
    for (let i = 0; i < this.destroyedBuildings.length; i++) {
      const wreck = this.destroyedBuildings[i];
      if (wreck.erased || wreck.team !== source.team) continue;
      const d = source.position.distanceTo(wreck.position);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    const wreck = this.destroyedBuildings[bestIndex];
    const def = buildDefForEntityType(wreck.type);
    if (!def) return null;
    const repairCost = def.cost * 0.5;
    if (wreck.team === Team.Player && this.resources < repairCost) return null;
    if (wreck.team === Team.Player) this.resources -= repairCost;
    const building = createBuildingFromDef(def, wreck.position, wreck.team);
    building.buildProgress = 1;
    building.health = building.maxHealth * 0.5;
    this.destroyedBuildings.splice(bestIndex, 1);
    this.addEntity(building);
    return building.position.clone();
  }

  /** Return all living entities across every list plus the player. */
  allEntities(): Entity[] {
    const result: Entity[] = [];
    for (const ship of this.playerShips.values()) {
      if (ship.alive) result.push(ship);
    }
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
    for (const circles of this.territoryCirclesByTeam.values()) {
      for (const c of circles) {
        if (c.radius === c.targetRadius) continue;
        if (c.growthDuration <= 0) { c.radius = c.targetRadius; continue; }
        const t = Math.min(1, (this.gameTime - c.growthStartTime) / c.growthDuration);
        const eased = 1 - (1 - t) * (1 - t);
        c.radius = c.radius + (c.targetRadius - c.radius) * eased;
        if (t >= 1) c.radius = c.targetRadius;
      }
    }
    this.recentlyDamaged.clear();

    // Update all player ships (slot 0 = local player, others = remote/AI)
    for (const ship of this.playerShips.values()) {
      if (ship.alive) ship.update(dt);
    }
    this.synonymous.update(dt, this.gameTime);
    this.updatePlayerShieldAura();

    // Update buildings and power status
    this.updateBuildingPower();
    for (const b of this.buildings) b.update(dt);
    for (const b of this.buildings) {
      if (b instanceof SynonymousMineLayer) b.tickMineLayer(this);
    }
    this.synonymous.updateBuildingIntegrity(this.buildings);

    this.applyFighterSeparation(dt);

    // Update fighters
    for (const f of this.fighters) f.update(dt);

    // Update projectiles
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.update(dt);
      if (!p.alive && this.projectileBlastRadius(p) > 0) {
        this.detonateProjectile(p);
      }
    }

    // Collision detection
    // First let enemy bullets intercept swarm missiles (GOAL 3C)
    this.resolveMineProjectileDamage();
    this.resolveProjectileInterceptions();
    this.resolveCollisions();
    this.synonymous.updateBuildingIntegrity(this.buildings);

    // Resources from factories
    this.accumulateResources(dt);

    // PR3: ship ↔ conduit interaction. Enemy fighters on friendly powered
    // conduits are bounced back and take light damage. Projectiles that hit
    // a powered opposing conduit are destroyed. Unpowered conduits are
    // intangible (pass-through for ships and shots alike).
    this.applyConduitInteraction(dt);

    // Tick pending conduit fronts. Every eligible frontier cell builds together.
    this.tickPendingConduits(dt);

    // Research progress
    this.tickResearch(dt);

    // Particles
    this.particles.update(dt);
    this.updateExplosionGlows(dt);
    this.ringEffects.update(dt);
    this.ringEffects.prune();

    this.completeBuildingDeletions();

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

      // Check against all player ships (slot 0 = local, others = remote/AI)
      for (const ship of this.playerShips.values()) {
        if (!ship.alive) continue;
        if (this.checkHit(proj, ship, isRegen)) break;
      }
    }
  }

  private resolveMineProjectileDamage(): void {
    for (const mine of this.projectiles) {
      if (!mine.alive || !isSynonymousDriftMine(mine)) continue;
      for (const shot of this.projectiles) {
        if (!shot.alive || shot === mine || isSynonymousDriftMine(shot)) continue;
        const dist = 'targetPos' in shot
          ? pointToSegmentDistance(mine.position, shot.position, (shot as ProjectileBase & { targetPos: Vec2 }).targetPos)
          : mine.position.distanceTo(shot.position);
        if (dist <= mine.radius + shot.radius) {
          mine.takeDamage(Math.max(1, Math.abs(shot.damage)), shot);
          shot.destroy();
          this.recentlyDamaged.add(mine.id);
          this.particles.emitSpark(mine.position);
          if (!mine.alive) this.detonateProjectile(mine);
          break;
        }
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

    if (isSynonymousFaction(this.factionByTeam, target.team)) {
      const handled = this.synonymous.damageDroneAt(target.team, proj.position, proj.damage, {
        buildingId: target instanceof BuildingBase ? target.id : undefined,
        fallbackToBuilding: target instanceof BuildingBase,
        time: this.gameTime,
      });
      if (handled) {
        this.recentlyDamaged.add(target.id);
        proj.destroy();
        return true;
      }
    }

    const dist = proj.position.distanceTo(target.position);
    const combinedRadius = proj.radius + target.radius;
    if (dist < combinedRadius) {
      if (this.projectileBlastRadius(proj) > 0) {
        this.applyProjectileDamage(proj, target);
        proj.destroy();
        return true;
      }
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
          target.type === EntityType.TimeBomb ||
          target.type === EntityType.ExciterTurret ||
          target.type === EntityType.MassDriverTurret ||
          target.type === EntityType.RegenTurret ||
          target.type === EntityType.RepairTurret ||
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
    this.accumulateSynonymousDrones(dt);
    if (isSynonymousFaction(this.factionByTeam, Team.Player)) return;

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

  /** Current player income rate (resources per second). */
  getPlayerIncomePerSecond(): number {
    if (isSynonymousFaction(this.factionByTeam, Team.Player)) {
      let income = SYNONYMOUS_BASE_PRODUCTION;
      for (const b of this.buildings) {
        if (
          b.alive &&
          b.type === EntityType.Factory &&
          b.team === Team.Player &&
          b.buildProgress >= 1
        ) {
          income += SYNONYMOUS_FACTORY_PRODUCTION;
        }
      }
      return income;
    }
    let income = this.player.alive ? BASELINE_RESOURCE_GAIN : 0;
    for (const b of this.buildings) {
      if (
        b.alive &&
        b.type === EntityType.Factory &&
        b.team === Team.Player &&
        b.powered &&
        b.buildProgress >= 1
      ) {
        income += RESOURCE_GAIN_RATE;
      }
    }
    return income;
  }

  private accumulateSynonymousDrones(dt: number): void {
    for (const [team, faction] of this.factionByTeam) {
      if (faction !== 'synonymous') continue;
      const cp = this.getCommandPostForTeam(team);
      if (!cp?.alive) continue;
      const next = (this.synonymousBaseAccumulator.get(team) ?? 0) + SYNONYMOUS_BASE_PRODUCTION * dt;
      const whole = Math.floor(next);
      this.synonymousBaseAccumulator.set(team, next - whole);
      if (whole > 0) this.synonymous.produce(team, whole, cp.position, this.gameTime);
    }

    for (const b of this.buildings) {
      if (!b.alive || b.type !== EntityType.Factory || !isSynonymousFaction(this.factionByTeam, b.team)) continue;
      if (b.buildProgress < 1) continue;
      const next = (this.synonymousFactoryAccumulator.get(b.id) ?? 0) + SYNONYMOUS_FACTORY_PRODUCTION * dt;
      const whole = Math.floor(next);
      this.synonymousFactoryAccumulator.set(b.id, next - whole);
      if (whole > 0) this.synonymous.produce(b.team, whole, b.position, this.gameTime);
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
    for (const ship of this.playerShips.values()) {
      if (ship.alive) shipsToCheck.push(ship);
    }
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
      if (this.grid.damageConduit(cx, cy, 1)) {
        this.recordDestroyedConduit(cx, cy, conduitTeam);
      }
      this.power.markDirty();
      proj.destroy();
      if (this.projectileBlastRadius(proj) > 0) {
        this.detonateProjectile(proj);
      } else {
        this.particles.emitSpark(proj.position);
      }
    }
  }

  private applyFighterSeparation(dt: number): void {
    for (let i = 0; i < this.fighters.length; i++) {
      const a = this.fighters[i];
      if (!a.alive || a.docked) continue;
      for (let j = i + 1; j < this.fighters.length; j++) {
        const b = this.fighters[j];
        if (!b.alive || b.docked || a.team !== b.team) continue;
        a.applySeparationFrom(b, dt);
        b.applySeparationFrom(a, dt);
      }
    }
  }

  private updatePlayerShieldAura(): void {
    // Apply shield aura from each player ship to nearby friendly fighters.
    for (const ship of this.playerShips.values()) {
      if (!ship.shieldUnlocked || !ship.alive || ship.shield <= 0) continue;
      const radius = 260;
      for (const f of this.fighters) {
        if (!f.alive || f.docked || f.team !== ship.team) continue;
        if (f.position.distanceTo(ship.position) <= radius) {
          f.enableShield();
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Pending conduit build queue (0.5 s per cell, BFS frontier outward)
  // -----------------------------------------------------------------------

  /**
   * Each tick, count down toward the next conduit build event. When the
   * timer fires, promote every pending conduit orthogonal to the powered
   * network or a finished powered building; placement order does not matter.
   */
  private tickPendingConduits(dt: number): void {
    if (this.grid.pendingConduitCount() === 0) return;
    this.conduitBuildTimer -= dt;
    if (this.conduitBuildTimer > 0) return;
    this.conduitBuildTimer = 0.5;

    const ready: Array<{ cx: number; cy: number; team: Team }> = [];
    for (const { cx, cy, team } of this.grid.eachPendingConduit()) {
      if (this.isAtConduitFrontier(cx, cy, team)) {
        ready.push({ cx, cy, team });
      }
    }
    if (ready.length === 0) return;
    for (const { cx, cy } of ready) this.grid.promotePendingConduit(cx, cy);
    this.power.markDirty();
    if (ready.length > 0) {
      const first = ready[0];
      this.ringEffects.spawn('build_complete_wave', new Vec2((first.cx + 0.5) * GRID_CELL_SIZE, (first.cy + 0.5) * GRID_CELL_SIZE), 8, 70, 0.55, 0.55);
    }
    Audio.playSound('build');
  }

  /**
   * True when (cx, cy) is orthogonally adjacent to an energized conduit of
   * the same team or to the footprint of a finished powered same-team building.
   */
  private isAtConduitFrontier(cx: number, cy: number, team: Team): boolean {
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (
        this.grid.hasConduit(nx, ny) &&
        this.grid.conduitTeam(nx, ny) === team &&
        this.power.isCellEnergized(team, nx, ny)
      ) {
        return true;
      }
    }
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      if (b.buildProgress < 1 || !b.powered) continue;
      const bx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const by = Math.floor(b.position.y / GRID_CELL_SIZE);
      const size = footprintForBuildingType(b.type);
      const origin = footprintOrigin(bx, by, size);
      const endCx = origin.cx + size - 1;
      const endCy = origin.cy + size - 1;
      const orthogonal =
        (cy >= origin.cy && cy <= endCy && (cx === origin.cx - 1 || cx === endCx + 1)) ||
        (cx >= origin.cx && cx <= endCx && (cy === origin.cy - 1 || cy === endCy + 1));
      if (orthogonal) return true;
    }
    return false;
  }

  private applyProjectileDamage(proj: ProjectileBase, target: Entity): void {
    const blastRadius = this.projectileBlastRadius(proj);
    if (blastRadius > 0) {
      this.applyBlastDamage(proj, target, blastRadius);
      this.emitFancyExplosion(proj.position, blastRadius);
      return;
    }

    target.takeDamage(proj.damage, proj);
    this.recentlyDamaged.add(target.id);
    if (!target.alive) {
      this.particles.emitExplosion(target.position, target.radius);
      this.playEntityExplosionSound(target);
    } else {
      this.particles.emitSpark(target.position);
      const playerDist = this.player.position.distanceTo(target.position);
      Audio.playSoundAt('bhit0', playerDist);
    }
  }

  private projectileBlastRadius(proj: ProjectileBase): number {
    const maybeBlast = proj as ProjectileBase & { blastRadius?: number };
    return typeof maybeBlast.blastRadius === 'number' ? maybeBlast.blastRadius : 0;
  }

  private applyBlastDamage(proj: ProjectileBase, directTarget: Entity, blastRadius: number): void {
    for (const e of this.allEntities()) {
      if (!e.alive || e === proj || e.team === Team.Neutral || e.team === proj.team) continue;
      const d = e.position.distanceTo(proj.position);
      if (d > blastRadius + e.radius) continue;
      const falloff = Math.max(0.35, 1 - d / Math.max(1, blastRadius));
      e.takeDamage(e === directTarget ? proj.damage : proj.damage * falloff, proj);
      this.recentlyDamaged.add(e.id);
      if (!e.alive) this.playEntityExplosionSound(e);
    }
  }

  private emitFancyExplosion(pos: Vec2, blastRadius: number): void {
    this.particles.emitExplosion(pos, blastRadius * 0.45);
    this.particles.emitExplosion(pos, blastRadius * 0.22);
    this.spawnExplosionGlow(pos, blastRadius);
    this.ringEffects.spawn('shockwave', pos, blastRadius * 0.08, blastRadius * 1.08, 0.55, 1.35);
    this.ringEffects.spawn('blackout_wave', pos, blastRadius * 0.2, blastRadius * 0.78, 0.36, 0.5);
    const playerDist = this.player.position.distanceTo(pos);
    Audio.playSoundAt(blastRadius > 70 ? 'explode2' : 'explode1', playerDist);
  }

  private spawnExplosionGlow(pos: Vec2, blastRadius: number): void {
    this.explosionGlows.push({
      center: pos.clone(),
      radius: blastRadius,
      lifeSeconds: 0.42,
      totalSeconds: 0.42,
      intensity: blastRadius > 80 ? 1.15 : 0.9,
    });
    if (this.explosionGlows.length > 32) {
      this.explosionGlows.splice(0, this.explosionGlows.length - 32);
    }
  }

  private updateExplosionGlows(dt: number): void {
    for (const glow of this.explosionGlows) glow.lifeSeconds -= dt;
    if (this.explosionGlows.length > 0) {
      this.explosionGlows = this.explosionGlows.filter((glow) => glow.lifeSeconds > 0);
    }
  }

  private detonateProjectile(proj: ProjectileBase): void {
    const blastRadius = this.projectileBlastRadius(proj);
    if (blastRadius <= 0) return;
    this.applyBlastDamage(proj, proj, blastRadius);
    this.emitFancyExplosion(proj.position, blastRadius);
  }

  private playEntityExplosionSound(target: Entity): void {
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
      target.type === EntityType.TimeBomb ||
      target.type === EntityType.ExciterTurret ||
      target.type === EntityType.MassDriverTurret ||
      target.type === EntityType.RegenTurret ||
      target.type === EntityType.RepairTurret ||
      target.type === EntityType.PlayerShip
    ) {
      Audio.playSoundAt('explode1', playerDist);
    } else {
      Audio.playSoundAt('explode0', playerDist);
    }
  }

  private addAutomaticBuildingConduits(building: BuildingBase): void {
    if (!building.alive || building.team === Team.Neutral) return;
    if (isConfluenceFaction(this.factionByTeam, building.team)) return;
    const centerCx = Math.floor(building.position.x / GRID_CELL_SIZE);
    const centerCy = Math.floor(building.position.y / GRID_CELL_SIZE);
    const size = footprintForBuildingType(building.type);
    const origin = footprintOrigin(centerCx, centerCy, size);
    const inside = new Set<string>();
    let placed = 0;

    for (let y = origin.cy; y < origin.cy + size; y++) {
      for (let x = origin.cx; x < origin.cx + size; x++) {
        inside.add(cellKey(x, y));
      }
    }

    const targetOutside = size * size;
    const occupied = this.occupiedBuildingCells();
    for (const key of inside) occupied.add(key);
    let outside = 0;
    let frontier = this.seedBranchFrontier(origin.cx, origin.cy, size, building.type, building.team);
    let guard = 0;
    while (outside < targetOutside && frontier.length > 0 && guard < targetOutside * 80) {
      guard++;
      const pick = Math.floor(this.seeded01(centerCx, centerCy, building.type, guard) * frontier.length);
      const cell = frontier.splice(pick, 1)[0];
      const key = cellKey(cell.cx, cell.cy);
      if (inside.has(key) || occupied.has(key)) continue;
      if (
        cell.cx < 0 ||
        cell.cy < 0 ||
        (cell.cx + 1) * GRID_CELL_SIZE > WORLD_WIDTH ||
        (cell.cy + 1) * GRID_CELL_SIZE > WORLD_HEIGHT
      ) {
        continue;
      }
      occupied.add(key);
      outside += this.planAutomaticConduit(cell.cx, cell.cy, building.team);
      const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const branchBias = this.seeded01(cell.cx, cell.cy, building.type, guard + 0x71);
      for (const [dx, dy] of dirs) {
        if (this.seeded01(cell.cx + dx, cell.cy + dy, building.type, guard + 0x1337) > 0.58 + branchBias * 0.16) {
          frontier.push({ cx: cell.cx + dx, cy: cell.cy + dy });
        }
      }
      if (frontier.length < 3) {
        frontier = frontier.concat(this.seedBranchFrontier(origin.cx, origin.cy, size, building.type, building.team));
      }
    }

    if (placed > 0 || outside > 0) this.power.markDirty();
  }

  private planAutomaticConduit(cx: number, cy: number, team: Team): number {
    if (this.grid.hasConduit(cx, cy) || this.grid.hasPendingConduit(cx, cy)) return 0;
    if (this.isCellOccupiedByBuilding(cx, cy)) return 0;
    this.grid.queueConduit(cx, cy, team);
    return 1;
  }

  private seedBranchFrontier(
    originCx: number,
    originCy: number,
    size: number,
    type: EntityType,
    team: Team,
  ): Array<{ cx: number; cy: number }> {
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let i = 0; i < size; i++) {
      cells.push({ cx: originCx + i, cy: originCy - 1 });
      cells.push({ cx: originCx + i, cy: originCy + size });
      cells.push({ cx: originCx - 1, cy: originCy + i });
      cells.push({ cx: originCx + size, cy: originCy + i });
    }
    return cells.sort((a, b) => {
      const ah = this.seeded01(a.cx, a.cy, type, team * 7919);
      const bh = this.seeded01(b.cx, b.cy, type, team * 7919);
      return ah - bh;
    });
  }

  private occupiedBuildingCells(): Set<string> {
    const occupied = new Set<string>();
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const cx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const cy = Math.floor(b.position.y / GRID_CELL_SIZE);
      const size = footprintForBuildingType(b.type);
      const origin = footprintOrigin(cx, cy, size);
      for (let y = origin.cy; y < origin.cy + size; y++) {
        for (let x = origin.cx; x < origin.cx + size; x++) {
          occupied.add(cellKey(x, y));
        }
      }
    }
    return occupied;
  }

  private seeded01(cx: number, cy: number, type: EntityType, salt: number): number {
    let h = Math.imul(cx | 0, 374761393) ^ Math.imul(cy | 0, 668265263);
    h ^= Math.imul((type + 17) | 0, 2246822519) ^ salt;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }

  startDeletingBuildingAt(pos: Vec2, team: Team): BuildingBase | null {
    const px = Math.floor(pos.x / GRID_CELL_SIZE);
    const py = Math.floor(pos.y / GRID_CELL_SIZE);
    let best: BuildingBase | null = null;
    let bestDist = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      const cx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const cy = Math.floor(b.position.y / GRID_CELL_SIZE);
      const size = footprintForBuildingType(b.type);
      const origin = footprintOrigin(cx, cy, size);
      if (px < origin.cx || px >= origin.cx + size || py < origin.cy || py >= origin.cy + size) {
        continue;
      }
      const d = b.position.distanceTo(pos);
      if (d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    if (!best) return null;
    best.startDeleting();
    return best;
  }

  eraseBlueprintAt(pos: Vec2, team: Team): boolean {
    const px = Math.floor(pos.x / GRID_CELL_SIZE);
    const py = Math.floor(pos.y / GRID_CELL_SIZE);
    let removed = false;
    for (const wreck of this.destroyedBuildings) {
      if (wreck.erased || wreck.team !== team) continue;
      const cx = Math.floor(wreck.position.x / GRID_CELL_SIZE);
      const cy = Math.floor(wreck.position.y / GRID_CELL_SIZE);
      const size = footprintForBuildingType(wreck.type);
      const origin = footprintOrigin(cx, cy, size);
      if (px >= origin.cx && px < origin.cx + size && py >= origin.cy && py < origin.cy + size) {
        wreck.erased = true;
        removed = true;
      }
    }
    for (const conduit of this.destroyedConduits) {
      if (conduit.erased || conduit.team !== team) continue;
      if (conduit.cx === px && conduit.cy === py) {
        conduit.erased = true;
        removed = true;
      }
    }
    if (removed) {
      this.destroyedBuildings = this.destroyedBuildings.filter((w) => !w.erased);
      this.destroyedConduits = this.destroyedConduits.filter((c) => !c.erased);
    }
    return removed;
  }

  private completeBuildingDeletions(): void {
    for (const b of this.buildings) {
      if (!b.alive || !b.deleting || b.deletionProgress < 1) continue;
      if (b.team === Team.Player) {
        if (isSynonymousFaction(this.factionByTeam, b.team)) {
          this.synonymous.releaseBuilding(b.id, this.gameTime, { sold: true });
        } else {
          this.resources += buildCostForBuildingType(b.type) * b.healthFraction;
        }
      }
      b.destroy();
      this.power.markDirty();
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
            (isSynonymousFaction(this.factionByTeam, b.team) || b.powered) &&
            b.buildProgress >= 1,
    );
    if (!hasLab) return;

    this.researchProgress.progress += dt;
    if (this.researchProgress.progress >= this.researchProgress.timeNeeded) {
      const completed = this.researchProgress.item;
      this.researchedItems.add(completed);
      this.player.applyResearchUpgrade(completed);
      if (completed === 'advancedFighters') {
        for (const b of this.buildings) {
          if (b.alive && b.team === Team.Player && b instanceof Shipyard) {
            b.shipCapacity = 7;
            b.buildInterval = 4;
          }
        }
      } else if (completed === 'shipShield') {
        for (const f of this.fighters) {
          if (f.alive && f.team === Team.Player && !f.docked && f.position.distanceTo(this.player.position) <= 260) {
            f.enableShield();
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
    for (const b of this.buildings) {
      if (b.alive || b.deleting) continue;
      // GOAL 1: When a shipyard is destroyed, release its docked fighters so
      // they defend the team's base instead of drifting idle.
      if ((b.type === EntityType.FighterYard || b.type === EntityType.BomberYard) && b instanceof Shipyard) {
        this.releaseDeferredFighters(b);
      }
      this.destroyedBuildings.push({
        type: b.type,
        team: b.team,
        position: b.position.clone(),
        maxHealth: b.maxHealth,
      });
      this.ringEffects.spawn('shockwave', b.position, b.radius * 0.7, b.radius * 5.5, 0.75, b.team === Team.Player ? 0.85 : 1.05);
    }
    this.buildings = this.buildings.filter((b) => b.alive);
    if (this.buildings.length !== beforeBuildings) {
      this.power.markDirty();
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.fighters = this.fighters.filter((f) => f.alive);
  }

  private recordDestroyedConduit(cx: number, cy: number, team: Team): void {
    if (this.destroyedConduits.some((c) => !c.erased && c.cx === cx && c.cy === cy && c.team === team)) return;
    this.destroyedConduits.push({ cx, cy, team });
  }

  // -----------------------------------------------------------------------
  // GOAL 1: Fighter release on shipyard destruction
  // -----------------------------------------------------------------------

  /**
   * When a shipyard is destroyed, launch all docked fighters and redirect any
   * fighters returning to dock so they defend the team's command post instead
   * of drifting idle.  The `fightersReleased` guard prevents this from
   * running more than once per yard.
   */
  private releaseDeferredFighters(yard: Shipyard): void {
    if (yard.fightersReleased) return;
    yard.fightersReleased = true;

    const cp = this.getCommandPostForTeam(yard.team);
    const defendPos = cp?.position ?? null;
    let released = 0;

    for (const f of this.fighters) {
      if (!f.alive || f.homeYard !== yard) continue;
      // Detach so the fighter no longer references a dead yard
      f.homeYard = null;

      if (f.docked) {
        // Fighter was still in the bay — launch it into the world
        f.launch();
        released++;
      } else if (f.order === 'dock') {
        // Fighter was flying back to dock — redirect it instead of idling
        released++;
      } else {
        // Fighter is already active with another order; leave it alone but
        // clear the homeYard reference so it won't try to return later.
        continue;
      }
      // Give the fighter a base-defence order
      f.order = 'protect';
      f.targetPos = defendPos ? defendPos.clone() : null;
    }

    if (released > 0) {
      // Small visual cue — particles burst at the yard position
      this.particles.emitExplosion(yard.position, yard.radius * 0.55);
    }
  }

  // -----------------------------------------------------------------------
  // GOAL 3C: Swarm missile interception by enemy projectiles
  // -----------------------------------------------------------------------

  /**
   * Check whether any non-interceptable enemy projectile hits an
   * interceptable projectile (e.g. SwarmMissile).  When a hit is detected
   * the interceptor is consumed and the swarm missile detonates via its
   * existing blast-radius logic.
   */
  private resolveProjectileInterceptions(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const swarm = this.projectiles[i];
      if (!swarm.alive || !swarm.interceptable) continue;

      for (let j = 0; j < this.projectiles.length; j++) {
        if (i === j) continue;
        const bullet = this.projectiles[j];
        if (!bullet.alive || bullet.team === swarm.team) continue;
        // Interceptable missiles shouldn't intercept each other
        if (bullet.interceptable) continue;

        const dist = swarm.position.distanceTo(bullet.position);
        if (dist < swarm.radius + bullet.radius) {
          bullet.destroy(); // the intercepting bullet is consumed
          // Trigger the swarm missile's blast before marking it dead
          this.detonateProjectile(swarm);
          swarm.destroy();
          break; // this swarm missile is gone; move to the next one
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Drawing — calls draw on every entity
  // -----------------------------------------------------------------------

  drawEntities(ctx: CanvasRenderingContext2D, camera: Camera): void {
    this.drawBlueprintOutlines(ctx, camera);
    for (const b of this.buildings) b.draw(ctx, camera);
    this.synonymous.draw(ctx, camera, this.gameTime);
    for (const f of this.fighters) f.draw(ctx, camera);
    for (const p of this.projectiles) p.draw(ctx, camera);
    for (const ship of this.playerShips.values()) {
      if (ship.alive) ship.draw(ctx, camera);
    }
    this.particles.draw(ctx, camera);
    this.ringEffects.draw(ctx, camera);
  }

  private drawBlueprintOutlines(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const wreck of this.destroyedBuildings) {
      if (wreck.erased) continue;
      const screen = camera.worldToScreen(wreck.position);
      const color = wreck.team === Team.Player
        ? colorToCSS(Colors.radar_friendly_status, 0.23)
        : colorToCSS(Colors.enemyfire, 0.16);
      const r = ENTITY_RADIUS.building * camera.zoom;
      const size = footprintForBuildingType(wreck.type) * GRID_CELL_SIZE * camera.zoom;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
    }
    for (const conduit of this.destroyedConduits) {
      if (conduit.erased) continue;
      const screen = camera.worldToScreen(new Vec2(
        (conduit.cx + 0.5) * GRID_CELL_SIZE,
        (conduit.cy + 0.5) * GRID_CELL_SIZE,
      ));
      const cellPx = GRID_CELL_SIZE * camera.zoom;
      ctx.strokeStyle = conduit.team === Team.Player
        ? colorToCSS(Colors.radar_friendly_status, 0.20)
        : colorToCSS(Colors.enemyfire, 0.14);
      ctx.strokeRect(screen.x - cellPx / 2 + 1, screen.y - cellPx / 2 + 1, cellPx - 2, cellPx - 2);
    }
    ctx.restore();
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

  /** Get the command post for any given team. */
  getCommandPostForTeam(team: Team): CommandPost | null {
    return (
      (this.buildings.find(
        (b) => b.alive && b.type === EntityType.CommandPost && b.team === team,
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


  setFaction(team: Team, faction: FactionType): void {
    this.factionByTeam.set(team, faction);
    for (const ship of this.playerShips.values()) {
      if (ship.team === team) ship.setFaction(faction);
    }
    if (!isConfluenceFaction(this.factionByTeam, team)) {
      this.territoryCirclesByTeam.delete(team);
    }
    if (faction !== 'synonymous') this.synonymous.clearTeam(team);
  }

  ensureSynonymousSeedSwarm(team: Team, center: Vec2): void {
    if (!isSynonymousFaction(this.factionByTeam, team)) return;
    this.synonymous.setBase(team, center);
    if (this.synonymous.totalDroneCount(team) === 0) {
      this.synonymous.spawnAtBase(team, 120, this.gameTime);
    }
  }

  ensureConfluenceSeedCircle(team: Team, center: Vec2): void {
    if (!isConfluenceFaction(this.factionByTeam, team)) return;
    const circles = this.territoryCirclesByTeam.get(team) ?? [];
    if (circles.length > 0) return;
    circles.push({
      id: `c${this.nextTerritoryCircleId++}`,
      x: center.x,
      y: center.y,
      radius: CONFLUENCE_BASE_RADIUS,
      targetRadius: CONFLUENCE_BASE_RADIUS,
      createdAt: this.gameTime,
      growthStartTime: this.gameTime,
      growthDuration: 0,
    });
    this.territoryCirclesByTeam.set(team, circles);
  }

  private findNearestConfluenceCircle(team: Team, x: number, y: number): ConfluenceTerritoryCircle | null {
    const circles = this.territoryCirclesByTeam.get(team) ?? [];
    let best: ConfluenceTerritoryCircle | null = null;
    let bestAbs = Infinity;
    for (const c of circles) {
      const d = Math.hypot(x - c.x, y - c.y) - c.radius;
      const ad = Math.abs(d - CONFLUENCE_PLACEMENT_DISTANCE);
      if (ad < bestAbs) { bestAbs = ad; best = c; }
    }
    return best;
  }

  getPlacementStatus(def: BuildDef, cx: number, cy: number, team: Team): { valid: boolean; reason: string } {
    if (isSynonymousFaction(this.factionByTeam, team)) {
      const cost = SYNONYMOUS_BUILD_COST[def.key] ?? 0;
      if (team === Team.Player && cost > 0 && !this.synonymous.canSpend(team, cost)) {
        return { valid: false, reason: `Need ${cost} ${SYNONYMOUS_CURRENCY_SYMBOL}` };
      }
    } else if (this.resources < def.cost && team === Team.Player) {
      return { valid: false, reason: 'Not enough resources' };
    }
    const footprintStatus = this.getStructureFootprintStatus(def, cx, cy);
    if (!footprintStatus.valid) return footprintStatus;
    const origin = footprintOrigin(cx, cy, def.footprintCells);
    if (def.key === 'commandpost') return { valid: true, reason: 'OK' };
    if (isSynonymousFaction(this.factionByTeam, team)) return { valid: true, reason: 'OK' };
    if (isConfluenceFaction(this.factionByTeam, team)) {
      const center = footprintCenter(cx, cy, def.footprintCells);
      const parent = this.findNearestConfluenceCircle(team, center.x, center.y);
      if (!parent) return { valid: false, reason: 'No territory' };
      const distanceFromCircleEdge = Math.hypot(center.x - parent.x, center.y - parent.y) - parent.radius;
      const minBand = CONFLUENCE_PLACEMENT_DISTANCE - CONFLUENCE_PLACEMENT_TOLERANCE;
      const maxBand = CONFLUENCE_PLACEMENT_DISTANCE + CONFLUENCE_PLACEMENT_TOLERANCE;
      if (distanceFromCircleEdge < minBand || distanceFromCircleEdge > maxBand) return { valid: false, reason: 'Place on Concentroid frontier band' };
      return { valid: true, reason: 'OK' };
    }
    if (this.isNearPowerNetwork(origin.cx, origin.cy, def.footprintCells, team)) return { valid: true, reason: 'OK' };
    return { valid: false, reason: 'Build near command post, generator, or powered conduit' };
  }

  getStructureFootprintStatus(def: BuildDef, cx: number, cy: number): { valid: boolean; reason: string } {
    const origin = footprintOrigin(cx, cy, def.footprintCells);
    const endCx = origin.cx + def.footprintCells - 1;
    const endCy = origin.cy + def.footprintCells - 1;
    if (
      origin.cx < 0 ||
      origin.cy < 0 ||
      (endCx + 1) * GRID_CELL_SIZE > WORLD_WIDTH ||
      (endCy + 1) * GRID_CELL_SIZE > WORLD_HEIGHT
    ) {
      return { valid: false, reason: 'Outside world' };
    }
    for (let y = origin.cy; y <= endCy; y++) {
      for (let x = origin.cx; x <= endCx; x++) {
        if (this.grid.hasConduit(x, y) || this.grid.hasPendingConduit(x, y)) {
          return { valid: false, reason: 'Cell occupied by conduit' };
        }
      }
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const size = footprintForBuildingType(b.type);
      const bc = {
        cx: Math.floor(b.position.x / GRID_CELL_SIZE),
        cy: Math.floor(b.position.y / GRID_CELL_SIZE),
      };
      const bo = footprintOrigin(bc.cx, bc.cy, size);
      const bx2 = bo.cx + size - 1;
      const by2 = bo.cy + size - 1;
      const overlaps = origin.cx <= bx2 && endCx >= bo.cx && origin.cy <= by2 && endCy >= bo.cy;
      if (overlaps) return { valid: false, reason: 'Cell occupied by building' };
    }
    return { valid: true, reason: 'OK' };
  }

  isConduitPlacementCellClear(cx: number, cy: number): { valid: boolean; reason: string } {
    if (
      cx < 0 ||
      cy < 0 ||
      (cx + 1) * GRID_CELL_SIZE > WORLD_WIDTH ||
      (cy + 1) * GRID_CELL_SIZE > WORLD_HEIGHT
    ) {
      return { valid: false, reason: 'Outside world' };
    }
    if (this.grid.hasConduit(cx, cy) || this.grid.hasPendingConduit(cx, cy)) {
      return { valid: false, reason: 'Cell occupied by conduit' };
    }
    if (this.isCellOccupiedByBuilding(cx, cy)) {
      return { valid: false, reason: 'Cell occupied by building' };
    }
    return { valid: true, reason: 'OK' };
  }

  isCellOccupiedByBuilding(cx: number, cy: number): boolean {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const bc = {
        cx: Math.floor(b.position.x / GRID_CELL_SIZE),
        cy: Math.floor(b.position.y / GRID_CELL_SIZE),
      };
      const size = footprintForBuildingType(b.type);
      const origin = footprintOrigin(bc.cx, bc.cy, size);
      if (cx >= origin.cx && cx < origin.cx + size && cy >= origin.cy && cy < origin.cy + size) {
        return true;
      }
    }
    return false;
  }


  applyConfluencePlacement(team: Team, pos: Vec2, sourceBuildingId?: string): void {
    if (!isConfluenceFaction(this.factionByTeam, team)) return;
    const circles = this.territoryCirclesByTeam.get(team) ?? [];
    if (circles.length === 0) return;
    const parent = this.findNearestConfluenceCircle(team, pos.x, pos.y);
    if (parent) {
      parent.targetRadius = Math.max(parent.targetRadius, Math.hypot(pos.x - parent.x, pos.y - parent.y) + CONFLUENCE_INCLUDE_MARGIN);
      parent.growthStartTime = this.gameTime;
      parent.growthDuration = CONFLUENCE_PARENT_EXPAND_DURATION;
    }
    circles.push({
      id: `c${this.nextTerritoryCircleId++}`,
      x: pos.x,
      y: pos.y,
      radius: 2,
      targetRadius: CONFLUENCE_BASE_RADIUS,
      parentCircleId: parent?.id,
      sourceBuildingId,
      createdAt: this.gameTime,
      growthStartTime: this.gameTime,
      growthDuration: CONFLUENCE_NEW_CIRCLE_GROW_DURATION,
    });
    this.territoryCirclesByTeam.set(team, circles);
  }

  private isNearPowerNetwork(originCx: number, originCy: number, size: number, team: Team): boolean {
    for (let y = originCy - 1; y <= originCy + size; y++) {
      for (let x = originCx - 1; x <= originCx + size; x++) {
        const border =
          x === originCx - 1 || x === originCx + size ||
          y === originCy - 1 || y === originCy + size;
        if (!border) continue;
        if (this.power.isCellEnergized(team, x, y)) return true;
        if (this.grid.conduitTeam(x, y) === team || this.grid.hasPendingConduit(x, y)) return true;
      }
    }
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      if (b.type !== EntityType.CommandPost && b.type !== EntityType.PowerGenerator) continue;
      const bx = Math.floor(b.position.x / GRID_CELL_SIZE);
      const by = Math.floor(b.position.y / GRID_CELL_SIZE);
      const sourceSize = footprintForBuildingType(b.type);
      const sourceOrigin = footprintOrigin(bx, by, sourceSize);
      const sourceX2 = sourceOrigin.cx + sourceSize - 1;
      const sourceY2 = sourceOrigin.cy + sourceSize - 1;
      const adjacent =
        originCx <= sourceX2 + 1 &&
        originCx + size - 1 >= sourceOrigin.cx - 1 &&
        originCy <= sourceY2 + 1 &&
        originCy + size - 1 >= sourceOrigin.cy - 1;
      if (adjacent) return true;
    }
    return false;
  }
}
