/** Practice mode game logic for Gate 88. */

import { Vec2, randomRange } from './math.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { GameState } from './gamestate.js';
import { BuildingBase, CommandPost, Shipyard } from './building.js';
import { RepairTurret, TurretBase } from './turret.js';
import { FighterShip } from './fighter.js';
import { Bullet, Missile } from './projectile.js';
import { HUD } from './hud.js';
import { Colors } from './colors.js';
import { Audio } from './audio.js';
import { WORLD_WIDTH, WORLD_HEIGHT, WEAPON_STATS } from './constants.js';
import { EnemyBasePlanner } from './enemybaseplanner.js';
import {
  PracticeConfig,
  cloneDefaultPracticeConfig,
  difficultyIndex,
} from './practiceconfig.js';
import { BuilderDrone, isBuilderDrone } from './builderdrone.js';

const TURRET_FIRE_CHECK_INTERVAL = 0.1;

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
    state.addEntity(cp);

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

    // Enemy "resources" tick (used for future spending and HUD)
    this.enemyResources += this.enemyIncomeMul * 1.5 * dt;

    // Drive the planner — only when there's still a CP.
    const cp = state.getEnemyCommandPost();
    if (cp && this.planner) {
      this.planner.update(state, cp, dt);
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
    this.updateEnemyFighters(state);
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
      if (b.type === EntityType.RepairTurret && b instanceof RepairTurret) {
        const repairedPos = state.repairDestroyedBuildingInRange(b, b.range);
        if (repairedPos) {
          b.consumeShot();
          b.showBeam(repairedPos);
          Audio.playSoundAt('regenbullet', playerDist);
        }
        continue;
      }

      const target = b.targetEntity;
      if (!target) continue;
      b.consumeShot();

      if (b.type === EntityType.RegenTurret) {
        let beamTarget = target.position;
        for (const friendly of state.buildings) {
          if (
            friendly instanceof BuildingBase &&
            friendly.alive &&
            friendly.team === b.team &&
            friendly.health < friendly.maxHealth &&
            friendly.position.distanceTo(b.position) <= b.range
          ) {
            friendly.takeDamage(-10, b);
            beamTarget = friendly.position;
          }
        }
        b.showBeam(beamTarget);
        Audio.playSoundAt('regenbullet', playerDist);
      } else if (b.type === EntityType.MissileTurret) {
        state.addEntity(new Missile(b.team, b.position.clone(), b.turretAngle, b, target));
        Audio.playSoundAt('missile', playerDist);
      } else if (b.type === EntityType.ExciterTurret) {
        state.addEntity(new Bullet(b.team, b.position.clone(), b.turretAngle, b));
        Audio.playSoundAt('exciterbullet', playerDist);
      } else if (b.type === EntityType.MassDriverTurret) {
        state.addEntity(new Bullet(b.team, b.position.clone(), b.turretAngle, b));
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
        const fighter = new FighterShip(
          b.position.clone(), Team.Enemy, ShipGroup.Red, b,
        );
        fighter.launch();
        b.activeShips++;
        state.addEntity(fighter);

        const target = this.findNearestPlayerBuilding(state, b.position);
        if (target) {
          fighter.order = 'attack';
          fighter.targetPos = target.position.clone();
        }
      }
    }
  }

  private updateEnemyFighters(state: GameState): void {
    for (const f of state.fighters) {
      if (!f.alive || f.docked || f.team !== Team.Enemy) continue;
      // Skip builder drones — they are utility units, not combatants.
      if (isBuilderDrone(f)) continue;

      if (f.order === 'idle' || !f.targetPos) {
        const target = this.findNearestPlayerBuilding(state, f.position);
        if (target) {
          f.order = 'attack';
          f.targetPos = target.position.clone();
        }
      }

      if (f.canFire()) {
        const nearby = state.getEntitiesInRange(f.position, f.weaponRange);
        for (const e of nearby) {
          if (e.team === Team.Player && e.alive) {
            f.consumeShot(WEAPON_STATS.fire.fireRate);
            state.addEntity(new Bullet(f.team, f.position.clone(), f.angle, f));
            break;
          }
        }
      }
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
}

