/**
 * Player-team fighter weapon-fire logic extracted from game.ts.
 *
 * Handles the per-tick firing pass for all live, undocked fighters that
 * belong to the local player's team (Team.Player in practice/single-player).
 * Enemy fighter AI is handled inside fighter.ts / practicemode.ts.
 */

import { Audio } from './audio.js';
import { Team } from './entities.js';
import { GameState } from './gamestate.js';
import {
  BomberShip,
  FighterShip,
  SynonymousFighterShip,
  SynonymousNovaBomberShip,
} from './fighter.js';
import {
  Bullet,
  BomberMissile,
  SynonymousDroneLaser,
  SynonymousNovaBomb,
} from './projectile.js';
import { SpaceFluid } from './spacefluid.js';
import { WEAPON_STATS } from './constants.js';
import { damageLaserLineLimited } from './combatUtils.js';

/**
 * For each live, undocked Team.Player fighter: find the nearest enemy in
 * weapon range and fire the appropriate weapon for that fighter type.
 *
 * Fighter references are not mutated beyond standard shot-consumption and
 * nova-charge state; all projectiles are inserted into `state` directly.
 */
export function updateFighterWeaponFire(state: GameState, spaceFluid: SpaceFluid): void {
  for (const f of state.fighters) {
    if (!f.alive || f.docked || f.team !== Team.Player) continue;
    if (!(f instanceof BomberShip) && !(f instanceof SynonymousFighterShip)) {
      f.weaponDamage = state.researchedItems.has('advancedFighters') ? 2 : 1;
    }
    if (!f.canFire()) continue;

    const nearby = state.getEntitiesInRange(f.position, f.weaponRange);
    let target = null;
    let bestDist = Infinity;
    for (const e of nearby) {
      if (!e.alive || e.team !== Team.Enemy) continue;
      const d = f.position.distanceTo(e.position);
      if (d < bestDist) {
        bestDist = d;
        target = e;
      }
    }
    if (!target) continue;
    const angle = f.position.angleTo(target.position);

    if (f instanceof SynonymousNovaBomberShip) {
      const charged = f.consumeChargedNova();
      if (charged) {
        const fireAngle = f.position.angleTo(charged.target);
        state.addEntity(new SynonymousNovaBomb(
          f.team, f.position.clone(), fireAngle,
          charged.aoeRadius, charged.damage, charged.travel, f,
        ));
        Audio.playSound('laser');
      } else {
        f.beginNovaCharge(target.position);
      }
    } else if (f instanceof BomberShip) {
      f.consumeShot(WEAPON_STATS.bigmissile.fireRate);
      state.addEntity(new BomberMissile(f.team, f.position.clone(), angle, f));
      Audio.playSound('missile');
    } else if (f instanceof SynonymousFighterShip) {
      f.markCombatSplit();
      f.consumeShot(f.fireRate);
      for (let i = 0; i < f.droneCount; i++) {
        const start = f.firingOrigin(i);
        const end = target.position.clone();
        state.addEntity(new SynonymousDroneLaser(f.team, start, end, f));
        damageLaserLineLimited(state, spaceFluid, start, end, f.weaponDamage, 3, 2, f);
      }
      Audio.playSound('laser');
    } else {
      f.consumeShot(WEAPON_STATS.fire.fireRate);
      const bullet = new Bullet(f.team, f.position.clone(), angle, f, target);
      bullet.damage = f.weaponDamage;
      state.addEntity(bullet);
    }
  }
}
