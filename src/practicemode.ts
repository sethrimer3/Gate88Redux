/** Practice mode game logic for Gate 88. */

import { Vec2, randomRange } from './math.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { GameState } from './gamestate.js';
import { BuildingBase, CommandPost, Shipyard } from './building.js';
import { TurretBase } from './turret.js';
import { FighterShip, SynonymousFighterShip, SynonymousNovaBomberShip } from './fighter.js';
import { Bullet, Laser, MassDriverBullet, Missile, SynonymousDroneLaser, SynonymousNovaBomb } from './projectile.js';
import { HUD } from './hud.js';
import { Colors } from './colors.js';
import { Audio } from './audio.js';
import { BASELINE_RESOURCE_GAIN, RESOURCE_GAIN_RATE, WORLD_WIDTH, WORLD_HEIGHT, WEAPON_STATS } from './constants.js';
import { EnemyBasePlanner } from './enemybaseplanner.js';
import {
  PracticeConfig,
  cloneDefaultPracticeConfig,
  difficultyIndex,
} from './practiceconfig.js';
import { BuilderDrone, isBuilderDrone } from './builderdrone.js';
import { isSynonymousFaction } from './confluence.js';

const TURRET_FIRE_CHECK_INTERVAL = 0.1;
const AI_MAIN_SHIP_ORDER_RADIUS = 1000;

export interface PracticeScore {
  basesDestroyed: number;
  timeSurvived: number;
}

export class PracticeMode {
  private turretCheckTimer: number = 0;
  private planner: EnemyBasePlanner | null = null;
  private config: PracticeConfig = cloneDefaultPracticeConfig();
  /**
   * If true, this mode will *also* drive an enemy main ship and a more
   * aggressive raid cadence. PracticeMode itself stays focused on a
   * growing base; the Vs. AI mode wraps PracticeMode and sets this flag
   * via {@link setVsAIMode}.
   */
  vsAIMode: boolean = false;
  /** Income multipliers, applied to the resource baseline. */
  private playerIncomeMul: number = 1.0;
  private enemyIncomeMul: number = 1.0;
  /** Internal enemy resource pool — not currently spent (planner is free) but
   *  surfaced to the HUD and used to gate future expensive actions. */
  enemyResources: number = 0;
  /** Accumulator so the AI raid timer doesn't depend on dt at low FPS. */
  private raidTimer: number = 30;
  private enemyWaveTimer: number = 0;

  score: PracticeScore = { basesDestroyed: 0, timeSurvived: 0 };
  gameOver: boolean = false;
  victory: boolean = false;

  /** Apply the practice configuration before {@link init}. */
  configure(cfg: PracticeConfig): void {
    this.config = cfg;
    this.playerIncomeMul = cfg.playerIncomeMul;
    this.enemyIncomeMul = cfg.enemyIncomeMul;
    this.enemyResources = cfg.enemyStartingResources;
    // Difficulty raises raid cadence floor.
    const idx = difficultyIndex(cfg.difficulty);
    this.raidTimer = [60, 45, 30, 22, 16][idx];
    this.enemyWaveTimer = [0, 0, 34, 28, 22][idx];
  }

  /**
   * Initialize practice: place a single enemy Command Post and let the
   * builder-drone planner grow the base from there. No prebuilt
   * shipyards or turrets — the player should see the base assemble.
   */
  init(state: GameState, hud: HUD): void {
    this.score = { basesDestroyed: 0, timeSurvived: 0 };
    this.gameOver = false;
    this.victory = false;

    state.resources = this.config.playerStartingResources;

    // Position the enemy CP at the configured distance from the player.
    const playerPos = state.player.position;
    const angle = randomRange(0, Math.PI * 2);
    const dist = this.config.startingDistance;
    const basePos = new Vec2(
      Math.max(300, Math.min(WORLD_WIDTH - 300, playerPos.x + Math.cos(angle) * dist)),
      Math.max(300, Math.min(WORLD_HEIGHT - 300, playerPos.y + Math.sin(angle) * dist)),
    );
    const cp = new CommandPost(basePos, Team.Enemy);
    if (isSynonymousFaction(state.factionByTeam, Team.Enemy)) cp.synonymousVisualKind = 'base';
    state.addEntity(cp);
    state.ensureConfluenceSeedCircle(Team.Enemy, basePos);
    state.ensureSynonymousSeedSwarm(Team.Enemy, basePos);

    this.planner = new EnemyBasePlanner(Team.Enemy, this.config, Math.floor(Math.random() * 0xffffff));
    this.planner.init(state, cp);

    hud.showMessage('Enemy base is constructing — destroy it before it grows!',
      Colors.alert1, 5);
    Audio.playSound('enemyhere');
  }

  update(state: GameState, hud: HUD, dt: number): void {
    if (this.gameOver) return;

    this.score.timeSurvived = state.gameTime;

    // Defeat check
    if (this.checkDefeat(state)) {
      this.gameOver = true;
      this.victory = false;
      hud.showMessage('Defeat! Your Command Post has fallen.', Colors.alert1, 8);
      hud.showMessage(
        `Time survived: ${Math.floor(this.score.timeSurvived)}s`,
        Colors.general_building, 10,
      );
      return;
    }

    // Victory check
    if (this.checkVictory(state)) {
      this.gameOver = true;
      this.victory = true;
      hud.showMessage('Victory! Enemy Command Post destroyed.',
        Colors.friendly_status, 10);
      this.score.basesDestroyed++;
      return;
    }

    // Income — apply multipliers (player baseline accumulation lives in
    // GameState; we simulate the multiplier by sprinkling extra resources).
    if (this.playerIncomeMul !== 1.0 && state.player.alive) {
      const extra = (this.playerIncomeMul - 1.0) * 2.0 * dt;
      if (extra > 0) state.resources += extra;
      else if (extra < 0) state.resources = Math.max(0, state.resources + extra);
    }

    const poweredFactories = state.buildings.filter(
      (b) => b.alive &&
        b.team === Team.Enemy &&
        b.type === EntityType.Factory &&
        b.powered &&
        b.buildProgress >= 1,
    ).length;
    const difficultyIncomeMul = [0.55, 0.8, 1.0, 1.2, 1.45][difficultyIndex(this.config.difficulty)];
    this.enemyResources += this.enemyIncomeMul *
      (BASELINE_RESOURCE_GAIN * difficultyIncomeMul + poweredFactories * RESOURCE_GAIN_RATE) *
      dt;

    // Drive the planner — only when there's still a CP.
    const cp = state.getEnemyCommandPost();
    if (cp && this.planner) {
      const spent = this.planner.update(state, cp, dt, this.enemyResources);
      this.enemyResources = Math.max(0, this.enemyResources - spent);
      // Drain planner chat narration and forward to HUD.
      for (const msg of this.planner.drainChats()) {
        hud.showAIChat('BASE', msg, Colors.alert1);
      }
    }

    // Turrets
    this.turretCheckTimer -= dt;
    if (this.turretCheckTimer <= 0) {
      this.turretCheckTimer = TURRET_FIRE_CHECK_INTERVAL;
      this.updateTurrets(state);
    }
    this.fireTurrets(state);

    // Ships only spawn from POWERED, finished shipyards. The CP no longer
    // produces fighters directly.
    this.updateEnemyShipyards(state);

    // Combat AI for already-launched fighters.
    this.updateEnemyFighters(state, dt);
  }

  private checkVictory(state: GameState): boolean {
    const enemyCPs = state.buildings.filter(
      (b) => b.alive && b.type === EntityType.CommandPost && b.team === Team.Enemy,
    );
    return enemyCPs.length === 0;
  }

  private checkDefeat(state: GameState): boolean {
    switch (this.config.defeatCondition) {
      case 'disabled': return false;
      case 'cp_destroyed':
        return state.getPlayerCommandPost() === null;
      case 'ship_and_no_cp':
        return !state.player.alive && state.getPlayerCommandPost() === null;
    }
  }

  // --------------------------------------------------------------------
  // Turrets — unchanged from the previous Practice impl.
  // --------------------------------------------------------------------

  private updateTurrets(state: GameState): void {
    const allEntities = state.allEntities();
    for (const b of state.buildings) {
      if (!b.alive || !(b instanceof TurretBase)) continue;
      if (b.buildProgress < 1) continue;
      b.acquireTarget(allEntities);
    }
  }

  private fireTurrets(state: GameState): void {
    for (const b of state.buildings) {
      if (!b.alive || !(b instanceof TurretBase)) continue;
      if (b.buildProgress < 1) continue;
      if (!b.canFire()) continue;

      const playerDist = state.player.position.distanceTo(b.position);

      const target = b.targetEntity;
      if (!target) continue;
      b.consumeShot();

      if (b.type === EntityType.RegenTurret) {
        target.takeDamage(-10, b);
        state.particles.emitHealing(target.position);
        const beamTarget = target.position;
        b.showBeam(beamTarget);
        Audio.playSoundAt('regenbullet', playerDist);
      } else if (b.type === EntityType.MissileTurret) {
        if (isSynonymousFaction(state.factionByTeam, b.team)) {
          const beam = new Laser(b.team, b.position.clone(), target.position.clone(), b);
          beam.damage = 1;
          beam.lifetime = 0.055;
          state.addEntity(beam);
          Audio.playSoundAt('laser', playerDist);
        } else {
          state.addEntity(new Missile(b.team, b.position.clone(), b.turretAngle, b, target));
          Audio.playSoundAt('missile', playerDist);
        }
      } else if (b.type === EntityType.ExciterTurret) {
        state.addEntity(new Bullet(b.team, b.position.clone(), b.turretAngle, b));
        Audio.playSoundAt('exciterbullet', playerDist);
      } else if (b.type === EntityType.MassDriverTurret) {
        state.addEntity(new MassDriverBullet(b.team, b.position.clone(), b.turretAngle, b));
        Audio.playSoundAt('massdriverbullet', playerDist);
      } else {
        state.addEntity(new Bullet(b.team, b.position.clone(), b.turretAngle, b));
        Audio.playSoundAt('fire', playerDist);
      }
    }
  }

  // --------------------------------------------------------------------
  // Enemy ship production — gated on `powered` and finished construction.
  // --------------------------------------------------------------------

  private updateEnemyShipyards(state: GameState): void {
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Enemy) continue;
      if (!(b instanceof Shipyard)) continue;
      if (b.buildProgress < 1) continue;
      // KEY RULE: ships only come from POWERED enemy shipyards.
      if (!b.powered) continue;

      if (b.shouldSpawnShip()) {
        const synonymous = isSynonymousFaction(state.factionByTeam, Team.Enemy);
        const fighter = synonymous && b.type === EntityType.BomberYard
          ? new SynonymousNovaBomberShip(b.bayPosition(), Team.Enemy, ShipGroup.Red, b)
          : synonymous
            ? new SynonymousFighterShip(b.bayPosition(), Team.Enemy, ShipGroup.Red, b, state.researchedItems.has('advancedFighters'))
          : new FighterShip(b.position.clone(), Team.Enemy, ShipGroup.Red, b);
        fighter.launch();
        b.activeShips++;
        state.addEntity(fighter);

        if (this.shouldStageEnemyWaves()) {
          fighter.order = 'waypoint';
          fighter.targetPos = this.enemyRallyPoint(state, b.position, b.activeShips);
        } else {
          const target = this.findNearestPlayerBuilding(state, b.position);
          if (target) {
            fighter.order = 'attack';
            fighter.targetPos = target.position.clone();
          }
        }
      }
    }
  }

  private updateEnemyFighters(state: GameState, dt: number): void {
    this.updateEnemyAttackWaves(state, dt);
    // Determine the best strategic target based on the planner's doctrine.
    let doctrineTarget: { position: Vec2 } | null = null;
    if (this.planner) {
      const harassPos = this.planner.getSuggestedHarassTarget(state);
      if (harassPos) doctrineTarget = { position: harassPos };
    }

    for (const f of state.fighters) {
      if (!f.alive || f.docked || f.team !== Team.Enemy) continue;
      // Skip builder drones — they are utility units, not combatants.
      if (isBuilderDrone(f)) continue;

      if (this.shouldStageEnemyWaves() && (f.order === 'waypoint' || f.order === 'follow' || f.order === 'protect')) {
        continue;
      }

      if (f.order === 'idle' || !f.targetPos) {
        // Doctrine-based strategic targets take precedence over opportunistic
        // nearest-building attacks, allowing each doctrine to focus pressure
        // on the most valuable player assets.
        const target = doctrineTarget ?? this.findNearestPlayerBuilding(state, f.position);
        if (target) {
          f.order = 'attack';
          f.targetPos = target.position.clone();
        }
      }

      if (f.canFire()) {
        const nearby = state.getEntitiesInRange(f.position, f.weaponRange);
        for (const e of nearby) {
          if (e.team === Team.Player && e.alive) {
            if (f instanceof SynonymousNovaBomberShip) {
              const charged = f.consumeChargedNova();
              if (charged) {
                const angle = f.position.angleTo(charged.target);
                state.addEntity(new SynonymousNovaBomb(f.team, f.position.clone(), angle, charged.aoeRadius, charged.damage, charged.travel, f));
              } else {
                f.beginNovaCharge(e.position);
              }
            } else if (f instanceof SynonymousFighterShip) {
              f.markCombatSplit();
              f.consumeShot(f.fireRate);
              for (let i = 0; i < f.droneCount; i++) {
                const start = f.firingOrigin(i);
                const laser = new SynonymousDroneLaser(f.team, start, e.position.clone(), f);
                state.addEntity(laser);
                this.damageSynonymousFighterLaser(state, start, e.position, f);
              }
            } else {
              f.consumeShot(WEAPON_STATS.fire.fireRate);
              const bullet = new Bullet(f.team, f.position.clone(), f.angle, f);
              bullet.damage = f.weaponDamage;
              state.addEntity(bullet);
            }
            break;
          }
        }
      }
    }
  }

  private shouldStageEnemyWaves(): boolean {
    return difficultyIndex(this.config.difficulty) >= 2;
  }

  private enemyRallyPoint(state: GameState, fallback: Vec2, salt: number): Vec2 {
    const cp = state.getEnemyCommandPost();
    const mainShip = state.aiPlayerShip?.alive ? state.aiPlayerShip.position : null;
    const center = mainShip ?? cp?.position ?? fallback;
    const angle = salt * 2.399963 + state.gameTime * 0.05;
    const radius = Math.min(AI_MAIN_SHIP_ORDER_RADIUS * 0.35, 120 + (salt % 5) * 18);
    return new Vec2(
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
    );
  }

  private updateEnemyAttackWaves(state: GameState, dt: number): void {
    if (!this.shouldStageEnemyWaves()) return;
    this.enemyWaveTimer -= dt;
    const staged = state.fighters.filter((f) =>
      f.alive &&
      !f.docked &&
      f.team === Team.Enemy &&
      !isBuilderDrone(f) &&
      (f.order === 'waypoint' || f.order === 'follow' || f.order === 'protect')
    );
    const idx = difficultyIndex(this.config.difficulty);
    const threshold = this.enemyWaveLaunchThreshold(state, idx);
    if (staged.length < threshold && this.enemyWaveTimer > 0) return;
    if (staged.length === 0) return;

    const target = this.findNearestPlayerBuilding(state, state.player.position) ?? { position: state.player.position };
    for (const f of staged) {
      f.order = 'attack';
      f.targetPos = target.position.clone();
    }
    this.enemyWaveTimer = [0, 0, 34, 28, 22][idx];
  }

  private enemyWaveLaunchThreshold(state: GameState, idx: number): number {
    if (idx < 4) return [0, 0, 7, 10, 13][idx];
    let nearCapacity = 0;
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Enemy || !(b instanceof Shipyard)) continue;
      if (!b.powered || b.buildProgress < 1) continue;
      nearCapacity += Math.max(1, b.shipCapacity - 1);
    }
    return Math.max(8, nearCapacity);
  }

  private damageSynonymousFighterLaser(state: GameState, start: Vec2, end: Vec2, source: FighterShip): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return;
    const hits: Array<{ target: { position: Vec2; radius: number; alive: boolean; team: Team; takeDamage: (amount: number, source?: FighterShip) => void; id: number }; t: number }> = [];
    for (const target of state.allEntities()) {
      if (!target.alive || target.team === source.team || target.team === Team.Neutral) continue;
      const tx = target.position.x - start.x;
      const ty = target.position.y - start.y;
      const t = Math.max(0, Math.min(1, (tx * dx + ty * dy) / lenSq));
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      if (Math.hypot(target.position.x - px, target.position.y - py) <= target.radius + 3) hits.push({ target, t });
    }
    hits.sort((a, b) => a.t - b.t);
    for (let i = 0; i < Math.min(2, hits.length); i++) {
      const target = hits[i].target;
      target.takeDamage(1, source);
      state.recentlyDamaged.add(target.id);
    }
  }

  private findNearestPlayerBuilding(
    state: GameState, pos: Vec2,
  ): { position: Vec2 } | null {
    let best: { position: Vec2 } | null = null;
    let bestDist = Infinity;
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Player) continue;
      const d = b.position.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    if (state.player.alive) {
      const d = state.player.position.distanceTo(pos);
      if (d < bestDist) best = state.player;
    }
    return best;
  }

  /** Optional: planner snapshot for debug overlays. */
  getPlannerSnapshot() {
    return this.planner?.snapshot() ?? null;
  }

  /** Returns the base planner for coordinator-interface access by VsAIDirector. */
  getPlanner(): EnemyBasePlanner | null {
    return this.planner;
  }
}

