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
import { Bullet, ExciterBeam, GatlingTurretBullet } from './projectile.js';
import { MassDriverBullet, Missile } from './projectile.js';
import { TurretBase } from './turret.js';
import { WEAPON_STATS } from './constants.js';
import { damageLaserLine } from './combatUtils.js';
import { aimAngle, recordCombatAimSample } from './targeting.js';
import { Vec2 } from './math.js';

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
    const aim = b.computeAim(target);
    const angle = aimAngle(aim);
    if (b.type !== EntityType.ExciterTurret && angle === null) continue;
    if (angle !== null) b.turretAngle = angle;
    const playerDist = state.player.position.distanceTo(b.position);
    if (b.type === EntityType.RegenTurret) {
      b.consumeShot();
      target.takeDamage(-10, b);
      state.particles.emitHealing(target.position);
      b.showBeam(target.position);
      Audio.playSoundAt('regenbullet', playerDist);
    } else if (b.type === EntityType.MissileTurret) {
      b.consumeShot();
      state.addEntity(new Missile(b.team, b.position.clone(), angle ?? b.turretAngle, b, target));
      Audio.playSoundAt('missile', playerDist);
    } else if (b.type === EntityType.GatlingTurret) {
      b.consumeShot();
      const spread = (Math.random() - 0.5) * WEAPON_STATS.gatlingturret.spread;
      state.addEntity(new GatlingTurretBullet(b.team, b.position.clone(), (angle ?? b.turretAngle) + spread, b));
      Audio.playSoundAt('shortbullet', playerDist);
    } else if (b.type === EntityType.ExciterTurret) {
      const targetPos = target.position.clone();
      const fireAngle = b.position.angleTo(targetPos);
      b.turretAngle = fireAngle;
      const end = b.position.add(new Vec2(Math.cos(fireAngle), Math.sin(fireAngle)).scale(WEAPON_STATS.exciterbeam.range));
      b.consumeShot();
      state.addEntity(new ExciterBeam(b.team, b.position.clone(), end, b));
      damageLaserLine(state, null, b, b.position, end, WEAPON_STATS.exciterbeam.damage, 4);
      Audio.playSoundAt('exciterbeam', playerDist);
    } else if (b.type === EntityType.MassDriverTurret) {
      b.consumeShot();
      state.addEntity(new MassDriverBullet(b.team, b.position.clone(), angle ?? b.turretAngle, b));
      Audio.playSoundAt('massdriverbullet', playerDist);
    } else {
      b.consumeShot();
      state.addEntity(new Bullet(b.team, b.position.clone(), angle ?? b.turretAngle, b));
      Audio.playSoundAt('fire', playerDist);
    }
    recordCombatAimSample({
      shooterId: b.id,
      targetId: target.id,
      shooter: b.position.clone(),
      target: target.position.clone(),
      targetVelocity: target.velocity.clone(),
      aimPoint: aim.aimPoint.clone(),
      spawn: b.position.clone(),
      range: b.range,
      interceptValid: aim.valid && !aim.usedFallback,
      createdAt: state.gameTime,
    });
  }
}
