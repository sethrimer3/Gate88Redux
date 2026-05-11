/**
 * Local-player turret firing logic extracted from game.ts.
 *
 * In practice/vs-AI modes the enemy base planner manages enemy turrets
 * directly, so this module only handles the local-player-team turrets
 * that the `Game` class drives (single-player and LAN/online local team).
 */

import { Audio } from './audio.js';
import { EntityType, Team } from './entities.js';
import { GameState } from './gamestate.js';
import { Bullet } from './projectile.js';
import { MassDriverBullet, Missile } from './projectile.js';
import { TurretBase } from './turret.js';

/**
 * Acquire targets and fire for every fully-built turret that belongs to
 * `localTeam`.  Uses `state.player.position` for spatial audio distance.
 */
export function fireTurretShots(state: GameState, localTeam: Team): void {
  const allEntities = state.allEntities();
  for (const b of state.buildings) {
    if (!b.alive || b.team !== localTeam || !(b instanceof TurretBase)) continue;
    if (b.buildProgress < 1) continue;
    b.acquireTarget(allEntities);
    if (!b.canFire()) continue;
    const target = b.targetEntity;
    if (!target) continue;
    b.consumeShot();
    const playerDist = state.player.position.distanceTo(b.position);
    if (b.type === EntityType.RegenTurret) {
      target.takeDamage(-10, b);
      state.particles.emitHealing(target.position);
      b.showBeam(target.position);
      Audio.playSoundAt('regenbullet', playerDist);
    } else if (b.type === EntityType.MissileTurret) {
      state.addEntity(new Missile(b.team, b.position.clone(), b.turretAngle, b, target));
      Audio.playSoundAt('missile', playerDist);
    } else if (b.type === EntityType.MassDriverTurret) {
      state.addEntity(new MassDriverBullet(b.team, b.position.clone(), b.turretAngle, b));
      Audio.playSoundAt('massdriverbullet', playerDist);
    } else {
      state.addEntity(new Bullet(b.team, b.position.clone(), b.turretAngle, b));
      Audio.playSoundAt(b.type === EntityType.ExciterTurret ? 'exciterbullet' : 'fire', playerDist);
    }
  }
}
