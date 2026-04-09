/** Practice mode game logic for Gate88 */

import { Vec2, randomRange, randomInt } from './math.js';
import { Team, EntityType, ShipGroup } from './entities.js';
import { GameState } from './gamestate.js';
import { CommandPost, Shipyard } from './building.js';
import { MissileTurret, ExciterTurret, MassDriverTurret } from './turret.js';
import { TurretBase } from './turret.js';
import { FighterShip } from './fighter.js';
import { Bullet, Missile } from './projectile.js';
import { HUD } from './hud.js';
import { Colors } from './colors.js';
import { Audio } from './audio.js';
import { WORLD_WIDTH, WORLD_HEIGHT, DT, WEAPON_STATS } from './constants.js';

const BASE_SPAWN_INTERVAL = 90; // seconds between new enemy bases
const MIN_SPAWN_DISTANCE = 1500; // minimum distance from player
const TURRET_FIRE_CHECK_INTERVAL = 0.1; // seconds between turret targeting sweeps
const ENEMY_RESOURCE_RATE = 0.2; // resource ticks per second for enemy

export interface PracticeScore {
  basesDestroyed: number;
  timeSurvived: number;
}

export class PracticeMode {
  private spawnTimer: number = 0;
  private turretCheckTimer: number = 0;
  private basesSpawned: number = 0;
  score: PracticeScore = { basesDestroyed: 0, timeSurvived: 0 };
  gameOver: boolean = false;
  victory: boolean = false;

  /** Initialize practice mode: spawn the first enemy base. */
  init(state: GameState, hud: HUD): void {
    this.spawnTimer = BASE_SPAWN_INTERVAL;
    this.basesSpawned = 0;
    this.score = { basesDestroyed: 0, timeSurvived: 0 };
    this.gameOver = false;
    this.victory = false;

    // Spawn first enemy base away from the player
    this.spawnEnemyBase(state, hud);
    hud.showMessage('Enemy base detected! Destroy it!', Colors.alert1, 5);
  }

  update(state: GameState, hud: HUD, dt: number): void {
    if (this.gameOver) return;

    this.score.timeSurvived = state.gameTime;

    // Check lose condition: player command post destroyed
    const playerCP = state.getPlayerCommandPost();
    if (!playerCP) {
      this.gameOver = true;
      this.victory = false;
      hud.showMessage('Your Command Post has been destroyed!', Colors.alert1, 8);
      hud.showMessage(
        `Score: ${this.score.basesDestroyed} bases destroyed, ${Math.floor(this.score.timeSurvived)}s survived`,
        Colors.general_building,
        10,
      );
      return;
    }

    // Spawn timer for additional enemy bases
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnEnemyBase(state, hud);
      this.spawnTimer = BASE_SPAWN_INTERVAL;
      hud.showMessage('New enemy base has appeared!', Colors.alert2, 5);
    }

    // Warn player when new base is about to spawn
    if (this.spawnTimer <= 10 && this.spawnTimer > 10 - dt) {
      hud.showMessage('Warning: New enemy base incoming in 10 seconds!', Colors.alert2, 4);
    }

    // Check victory: all enemy command posts destroyed
    const enemyCPs = state.buildings.filter(
      (b) => b.alive && b.type === EntityType.CommandPost && b.team === Team.Enemy,
    );
    if (enemyCPs.length === 0 && this.basesSpawned > 0) {
      this.score.basesDestroyed++;
      hud.showMessage('Enemy base destroyed! +1', Colors.friendly_status, 4);
      // Don't declare full victory — more bases will spawn
    }

    // Turret targeting and firing
    this.turretCheckTimer -= dt;
    if (this.turretCheckTimer <= 0) {
      this.turretCheckTimer = TURRET_FIRE_CHECK_INTERVAL;
      this.updateTurrets(state);
    }

    // Fire turrets that are ready
    this.fireTurrets(state);

    // Manage enemy shipyard spawning
    this.updateEnemyShipyards(state);

    // Update enemy fighter AI — attack nearest player building
    this.updateEnemyFighters(state);
  }

  private spawnEnemyBase(state: GameState, _hud: HUD): void {
    const basePos = this.findSpawnPosition(state);

    // Command Post
    const cp = new CommandPost(basePos, Team.Enemy);
    state.addEntity(cp);

    // Turrets around the command post (2-3)
    const turretCount = randomInt(2, 3);
    const turretTypes = [MissileTurret, ExciterTurret, MassDriverTurret];
    for (let i = 0; i < turretCount; i++) {
      const angle = (Math.PI * 2 * i) / turretCount + randomRange(-0.3, 0.3);
      const dist = randomRange(80, 150);
      const tPos = new Vec2(
        basePos.x + Math.cos(angle) * dist,
        basePos.y + Math.sin(angle) * dist,
      );
      const TurretClass = turretTypes[i % turretTypes.length];
      const turret = new TurretClass(tPos, Team.Enemy);
      state.addEntity(turret);
    }

    // Shipyard
    const yardAngle = randomRange(0, Math.PI * 2);
    const yardDist = randomRange(120, 200);
    const yardPos = new Vec2(
      basePos.x + Math.cos(yardAngle) * yardDist,
      basePos.y + Math.sin(yardAngle) * yardDist,
    );
    const yard = new Shipyard(EntityType.FighterYard, yardPos, Team.Enemy);
    state.addEntity(yard);

    this.basesSpawned++;
    Audio.playSound('enemyhere');
  }

  private findSpawnPosition(state: GameState): Vec2 {
    const playerPos = state.player.position;
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = randomRange(200, WORLD_WIDTH - 200);
      const y = randomRange(200, WORLD_HEIGHT - 200);
      const pos = new Vec2(x, y);
      if (pos.distanceTo(playerPos) >= MIN_SPAWN_DISTANCE) {
        // Also ensure it's not too close to existing bases
        let tooClose = false;
        for (const b of state.buildings) {
          if (b.alive && b.type === EntityType.CommandPost && b.position.distanceTo(pos) < 800) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) return pos;
      }
    }
    // Fallback: spawn far from player
    const angle = randomRange(0, Math.PI * 2);
    return new Vec2(
      playerPos.x + Math.cos(angle) * MIN_SPAWN_DISTANCE,
      playerPos.y + Math.sin(angle) * MIN_SPAWN_DISTANCE,
    );
  }

  private updateTurrets(state: GameState): void {
    const allEntities = state.allEntities();
    for (const b of state.buildings) {
      if (!b.alive || !(b instanceof TurretBase)) continue;
      b.acquireTarget(allEntities);
    }
  }

  private fireTurrets(state: GameState): void {
    for (const b of state.buildings) {
      if (!b.alive || !(b instanceof TurretBase)) continue;
      if (!b.canFire()) continue;

      const target = b.targetEntity;
      if (!target) continue;

      b.consumeShot();

      // Distance to player for audio culling
      const playerDist = state.player.position.distanceTo(b.position);

      // Create appropriate projectile based on turret type
      if (b.type === EntityType.MissileTurret) {
        const proj = new Missile(
          b.team, b.position.clone(), b.turretAngle, b, target,
        );
        state.addEntity(proj);
        Audio.playSoundAt('missile', playerDist);
      } else if (b.type === EntityType.ExciterTurret) {
        const proj = new Bullet(b.team, b.position.clone(), b.turretAngle, b);
        state.addEntity(proj);
        Audio.playSoundAt('exciterbullet', playerDist);
      } else if (b.type === EntityType.MassDriverTurret) {
        const proj = new Bullet(b.team, b.position.clone(), b.turretAngle, b);
        state.addEntity(proj);
        Audio.playSoundAt('massdriverbullet', playerDist);
      } else if (b.type === EntityType.RegenTurret) {
        const proj = new Bullet(b.team, b.position.clone(), b.turretAngle, b);
        state.addEntity(proj);
        Audio.playSoundAt('regenbullet', playerDist);
      } else {
        const proj = new Bullet(b.team, b.position.clone(), b.turretAngle, b);
        state.addEntity(proj);
        Audio.playSoundAt('fire', playerDist);
      }
    }
  }

  private updateEnemyShipyards(state: GameState): void {
    for (const b of state.buildings) {
      if (!b.alive || b.team !== Team.Enemy) continue;
      if (!(b instanceof Shipyard)) continue;

      if (b.shouldSpawnShip()) {
        const fighter = new FighterShip(
          b.position.clone(), Team.Enemy, ShipGroup.Red, b,
        );
        fighter.launch();
        b.activeShips++;
        state.addEntity(fighter);

        // Set attack order — find nearest player building
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

      // If idle or has no target, find one
      if (f.order === 'idle' || !f.targetPos) {
        const target = this.findNearestPlayerBuilding(state, f.position);
        if (target) {
          f.order = 'attack';
          f.targetPos = target.position.clone();
        }
      }

      // Fire at nearby enemies
      if (f.canFire()) {
        const nearby = state.getEntitiesInRange(f.position, f.weaponRange);
        for (const e of nearby) {
          if (e.team === Team.Player && e.alive) {
            f.consumeShot(WEAPON_STATS.fire.fireRate);
            const proj = new Bullet(f.team, f.position.clone(), f.angle, f);
            state.addEntity(proj);
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
    // Also consider player ship
    if (state.player.alive) {
      const d = state.player.position.distanceTo(pos);
      if (d < bestDist) {
        best = state.player;
      }
    }
    return best;
  }
}
