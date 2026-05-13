/**
 * Fluid-force injection helpers extracted from game.ts.
 *
 * Called once per fixed tick to push velocity / color forces into the
 * SpaceFluid simulation from every active ship, fighter, and projectile.
 * Keeping this in its own module prevents game.ts from importing projectile
 * class types solely for instanceof checks.
 */

import { Team } from './entities.js';
import { GameState } from './gamestate.js';
import { Bullet, ProjectileBase } from './projectile.js';
import { BomberMissile, GuidedMissile } from './projectile.js';
import { ChargedLaserBurst, ExciterBeam, GatlingBullet, Laser } from './projectile.js';
import { SpaceFluid } from './spacefluid.js';
import { CrystalNebula } from './crystalnebula.js';

/**
 * Inject per-entity exhaust / impact forces into `spaceFluid` based on the
 * current positions and velocities of all live entities in `state`.
 *
 * Color convention:
 *  - Player ships / fighters: green (r=56 g=132 b=68)
 *  - Enemy ships / fighters: red (r=132 g=56 b=68)
 *  - Player projectiles: teal (r=0 g=176 b=66)
 *  - Enemy projectiles: orange-red (r=228 g=0 b=33)
 */
export function injectFluidForces(state: GameState, spaceFluid: SpaceFluid): void {
  // ── Player ship ──────────────────────────────────────────────────────────
  if (state.player.alive) {
    const pv = state.player.velocity;
    spaceFluid.addForce({
      x: state.player.position.x, y: state.player.position.y,
      vx: pv.x,
      vy: pv.y,
      r: 56, g: 132, b: 68,
      strength: 1.0,
    });
  }

  // ── AI player ship (Vs. AI mode) ─────────────────────────────────────
  if (state.aiPlayerShip?.alive) {
    const ais = state.aiPlayerShip;
    const sv = ais.velocity;
    spaceFluid.addForce({
      x: ais.position.x, y: ais.position.y,
      vx: sv.x,
      vy: sv.y,
      r: 132, g: 56, b: 68,
      strength: 1.0,
    });
  }

  // ── All live fighters (player and enemy) ─────────────────────────────
  for (const f of state.fighters) {
    if (!f.alive || f.docked) continue;
    const fv = f.velocity;
    const isEnemy = f.team === Team.Enemy;
    spaceFluid.addForce({
      x: f.position.x, y: f.position.y,
      vx: fv.x,
      vy: fv.y,
      r: isEnemy ? 132 : 56,
      g: isEnemy ? 56 : 132,
      b: 68,
      strength: 0.6,
    });
  }

  // ── Projectiles ──────────────────────────────────────────────────────
  for (const e of state.allEntities()) {
    if (!e.alive) continue;
    if (
      !(e instanceof Bullet) &&
      !(e instanceof GatlingBullet) &&
      !(e instanceof GuidedMissile) &&
      !(e instanceof BomberMissile) &&
      !(e instanceof Laser)
    ) continue;
    const ev = e.velocity;
    const isEnemy = e.team === Team.Enemy;
    spaceFluid.addForce({
      x: e.position.x, y: e.position.y,
      vx: ev.x,
      vy: ev.y,
      r: isEnemy ? 228 : 0,
      g: isEnemy ? 0 : 176,
      b: isEnemy ? 33 : 66,
      strength: 0.5,
    });
  }
}

/**
 * Inject disturbances into `crystalNebula` from all active ships, fighters,
 * and projectiles so the crystal-mote clouds react to movement and combat.
 *
 * Disturbance sizing / strength rules:
 *  - Player/AI main ships:   radius 150, strength 1.20
 *  - Fighters:               radius 70, strength 0.72
 *  - Cannon/turret bullets:  radius 34, strength 0.72 (thin fast wake)
 *  - Gatling rounds:         radius 24, strength 0.55 (very narrow)
 *  - Guided/bomber missiles: radius 82, strength 0.95 (turbulent)
 *  - Lasers:                 radius 36+, strength 0.75+ (sampled along beam)
 */
export function injectCrystalDisturbances(state: GameState, crystalNebula: CrystalNebula): void {
  // ── Player ship ──────────────────────────────────────────────────────────
  if (state.player.alive) {
    const pv = state.player.velocity;
    crystalNebula.addDisturbance(
      state.player.position.x, state.player.position.y,
      pv.x, pv.y, 150, 1.20,
    );
  }

  // ── AI player ship (Vs. AI mode) ────────────────────────────────────────
  if (state.aiPlayerShip?.alive) {
    const ais = state.aiPlayerShip;
    const sv = ais.velocity;
    crystalNebula.addDisturbance(ais.position.x, ais.position.y, sv.x, sv.y, 150, 1.20);
  }

  // ── All live fighters ────────────────────────────────────────────────────
  for (const f of state.fighters) {
    if (!f.alive || f.docked) continue;
    const fv = f.velocity;
    crystalNebula.addDisturbance(f.position.x, f.position.y, fv.x, fv.y, 70, 0.72);
  }

  // ── Projectiles ──────────────────────────────────────────────────────────
  for (const e of state.allEntities()) {
    if (!e.alive) continue;
    const ev = e.velocity;
    if (e instanceof ChargedLaserBurst) {
      crystalNebula.addBeamDisturbance(
        e.position.x, e.position.y,
        e.targetPos.x, e.targetPos.y,
        58 + e.chargeFraction * 22,
        1.05 + e.chargeFraction * 0.45,
        14,
      );
    } else if (e instanceof Laser) {
      crystalNebula.addBeamDisturbance(
        e.position.x, e.position.y,
        e.targetPos.x, e.targetPos.y,
        36,
        0.75,
        10,
      );
    } else if (e instanceof ExciterBeam) {
      crystalNebula.addBeamDisturbance(
        e.position.x, e.position.y,
        e.targetPos.x, e.targetPos.y,
        42,
        0.82,
        10,
      );
    } else if (e instanceof GuidedMissile || e instanceof BomberMissile) {
      crystalNebula.addDisturbance(e.position.x, e.position.y, ev.x, ev.y, 82, 0.95);
    } else if (e instanceof GatlingBullet) {
      crystalNebula.addDisturbance(e.position.x, e.position.y, ev.x, ev.y, 24, 0.55);
    } else if (e instanceof Bullet) {
      crystalNebula.addDisturbance(e.position.x, e.position.y, ev.x, ev.y, 34, 0.72);
    } else if (e instanceof ProjectileBase) {
      const speed = Math.hypot(ev.x, ev.y);
      if (speed > 1) {
        const speedT = Math.min(1, speed / 650);
        crystalNebula.addDisturbance(e.position.x, e.position.y, ev.x, ev.y, 30 + speedT * 42, 0.58 + speedT * 0.30);
      }
    }
  }
}
