/**
 * Cross-Laser Mine — special ability for the default missile weapon slot.
 *
 * Each mine drifts outward from the player, decelerates to a stop, then
 * projects four detection laser beams in a cross/plus pattern.  When an
 * enemy ship crosses any beam the mine is replaced by an extremely fast
 * straight-line trap missile flying in the beam's direction.  After
 * MINE_LIFETIME_SECS without triggering the mine detonates in place.
 *
 * Design notes
 * ────────────
 * • CrossLaserMine stores a GameState reference so it can query enemy
 *   positions and spawn the TrapMissile during its own update().
 * • blastRadius is declared as a mutable field (not readonly) so it can
 *   be zeroed when the mine triggers via laser — preventing the auto-
 *   detonation path in GameState from firing a second blast.
 * • Enemy-detection uses the point-to-segment helper from math.ts so
 *   fast-moving ships cannot slip through the beam between frames.
 */

import { Vec2, randomRange, pointToSegmentDistance } from './math.js';
import { Camera } from './camera.js';
import { Entity, EntityType, Team } from './entities.js';
import { Colors, colorToCSS } from './colors.js';
import {
  ENTITY_RADIUS,
  MINE_LIFETIME_SECS,
  MINE_LASER_RANGE,
  MINE_LASER_THICKNESS,
  MINE_MISSILE_SPEED,
  MINE_BLAST_RADIUS,
  MINE_DAMAGE,
  MINE_DECELERATION,
  MINE_ROTATION_SPEED_MIN,
  MINE_ROTATION_SPEED_MAX,
} from './constants.js';
import { ProjectileBase } from './projectile.js';
import type { GameState } from './gamestate.js';
import { Audio } from './audio.js';

/** Visual body radius of a mine in world units (scaled by camera zoom when drawn). */
const MINE_BODY_RADIUS = 8;

// ---------------------------------------------------------------------------
// TrapMissile — spawned when a CrossLaserMine's beam is crossed
// ---------------------------------------------------------------------------

/**
 * A straight-line, high-speed missile launched when a CrossLaserMine is
 * triggered.  Flies in the exact direction of the intersected laser beam.
 * Carries a blast radius so it deals AOE damage on collision or at its
 * maximum travel distance.
 */
export class TrapMissile extends ProjectileBase {
  /** AOE blast radius — triggers the detonation path in GameState. */
  readonly blastRadius: number = MINE_BLAST_RADIUS;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    source: Entity | null = null,
  ) {
    // Lifetime = max travel distance / speed.  Range 1.5× laser length so
    // the missile can punish enemies near the far end of the beam.
    const maxTravel = MINE_LASER_RANGE * 1.5;
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: MINE_DAMAGE,
      speed: MINE_MISSILE_SPEED,
      lifetime: maxTravel / MINE_MISSILE_SPEED,
      source,
    });
    this.radius = ENTITY_RADIUS.missile * 1.15;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const r = this.radius * camera.zoom;

    // Bright yellow trail — visually distinct from homing missiles
    this.drawTrail(ctx, camera, colorToCSS(Colors.alert2, 0.9), 0.09, 3);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.angle);

    // Intense radial glow signals danger
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.0);
    glowGrad.addColorStop(0, colorToCSS(Colors.alert2, 0.55));
    glowGrad.addColorStop(1, colorToCSS(Colors.alert2, 0));
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Arrowhead missile body
    ctx.fillStyle = colorToCSS(Colors.alert2);
    ctx.beginPath();
    ctx.moveTo(r * 1.5, 0);
    ctx.lineTo(-r * 0.8, -r * 0.5);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r * 0.8, r * 0.5);
    ctx.closePath();
    ctx.fill();

    // Hot white core
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(r * 0.3, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// CrossLaserMine
// ---------------------------------------------------------------------------

/**
 * State machine:
 *  1. Moving  — coasts outward with initial velocity, decelerating to a stop.
 *  2. Armed   — stationary; rotating, detecting, counting down lifetime.
 *  3. Triggered — spawns a TrapMissile along the triggered beam and self-destructs.
 *  4. Expired — lifetime exhausted; detonates with AOE blast.
 */
export class CrossLaserMine extends ProjectileBase {
  /**
   * AOE blast radius used when the mine expires or is hit directly.
   * Set to 0 before destroy() is called from trigger() so GameState's
   * automatic detonation path does not fire a redundant second blast.
   */
  blastRadius: number = MINE_BLAST_RADIUS;

  private readonly gameState: GameState;

  /** Current visual rotation angle in radians (accumulates each tick). */
  private mineRotation: number;
  /** Per-mine rotation speed (rad/s) — chosen once at spawn, never changed. */
  private readonly rotSpeed: number;
  /** Clockwise (+1) or counter-clockwise (−1) — chosen once at spawn. */
  private readonly rotDir: 1 | -1;

  /** True once the mine has decelerated to a stop and is checking lasers. */
  private armed: boolean = false;

  constructor(
    team: Team,
    position: Vec2,
    angle: number,
    /** Initial outward launch speed (world units/sec). */
    initialSpeed: number,
    source: Entity | null,
    state: GameState,
  ) {
    super({
      type: EntityType.Missile,
      team,
      position,
      angle,
      damage: MINE_DAMAGE,
      speed: initialSpeed,
      lifetime: MINE_LIFETIME_SECS,
      source,
    });
    this.radius = MINE_BODY_RADIUS;
    this.gameState = state;

    // Randomise rotation parameters once; they stay fixed for the mine's life.
    this.mineRotation = Math.random() * Math.PI * 2;
    this.rotDir = Math.random() < 0.5 ? 1 : -1;
    this.rotSpeed = randomRange(MINE_ROTATION_SPEED_MIN, MINE_ROTATION_SPEED_MAX);
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  override update(dt: number): void {
    if (!this.alive) return;

    // ── Phase 1: deceleration ────────────────────────────────────────────
    if (!this.armed) {
      const speed = this.velocity.length();
      if (speed <= 1) {
        // Snap to fully stopped
        this.velocity.set(0, 0);
        this.armed = true;
      } else {
        const newSpeed = Math.max(0, speed - MINE_DECELERATION * dt);
        this.velocity = this.velocity.normalize().scale(newSpeed);
        if (newSpeed <= 1) {
          this.velocity.set(0, 0);
          this.armed = true;
        }
      }
    }

    // Integrate position (zero-cost when armed: velocity is (0,0))
    this.position = this.position.add(this.velocity.scale(dt));

    // ── Visual rotation (always runs) ────────────────────────────────────
    this.mineRotation += this.rotDir * this.rotSpeed * dt;

    // ── Lifetime countdown ────────────────────────────────────────────────
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      // blastRadius is still set → GameState auto-detonation path fires.
      this.destroy();
      return;
    }

    // ── Phase 2: laser trigger checks (armed only) ───────────────────────
    if (this.armed) {
      this.checkLaserTriggers();
    }
  }

  // --------------------------------------------------------------------------
  // Laser intersection
  // --------------------------------------------------------------------------

  private checkLaserTriggers(): void {
    const hostiles = this.gameState.getEnemiesOf(this.team);
    for (const enemy of hostiles) {
      if (!enemy.alive) continue;
      // Only mobile ships/fighters can trigger mines (not buildings or shots).
      if (
        enemy.type !== EntityType.PlayerShip &&
        enemy.type !== EntityType.Fighter &&
        enemy.type !== EntityType.Bomber
      ) continue;

      for (let i = 0; i < 4; i++) {
        const beamAngle = this.mineRotation + i * (Math.PI / 2);
        const beamEnd = new Vec2(
          this.position.x + Math.cos(beamAngle) * MINE_LASER_RANGE,
          this.position.y + Math.sin(beamAngle) * MINE_LASER_RANGE,
        );

        // Circle-vs-segment check: does the enemy's collision circle
        // intersect this beam's "capsule" of thickness MINE_LASER_THICKNESS?
        const dist = pointToSegmentDistance(enemy.position, this.position, beamEnd);
        if (dist <= MINE_LASER_THICKNESS * 0.5 + enemy.radius) {
          this.trigger(beamAngle);
          return; // mine is now dead — stop checking
        }
      }
    }
  }

  private trigger(beamAngle: number): void {
    // Brief ignition flash at the mine's location
    this.gameState.particles.emitSpark(this.position);
    this.gameState.particles.emitExplosion(this.position, MINE_BODY_RADIUS * 1.5);

    // Spawn the trap missile along the triggered beam direction
    const missile = new TrapMissile(
      this.team,
      this.position.clone(),
      beamAngle,
      this.source,
    );
    this.gameState.addEntity(missile);

    Audio.playSound('missile');

    // Zero the blast radius so the game loop does NOT emit a second explosion
    // when it detects the mine has died (only the missile should explode).
    this.blastRadius = 0;
    this.destroy();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  override draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const screen = camera.worldToScreen(this.position);
    const baseColor = this.team === Team.Player ? Colors.alert2 : Colors.alert1;

    // ── 4 laser detection beams (only visible when armed) ────────────────
    if (this.armed) {
      for (let i = 0; i < 4; i++) {
        const beamAngle = this.mineRotation + i * (Math.PI / 2);
        const worldEnd = new Vec2(
          this.position.x + Math.cos(beamAngle) * MINE_LASER_RANGE,
          this.position.y + Math.sin(beamAngle) * MINE_LASER_RANGE,
        );
        const screenEnd = camera.worldToScreen(worldEnd);

        // Wide soft glow — additive blending for the "hot wire" look
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = colorToCSS(baseColor, 0.06);
        ctx.lineWidth = MINE_LASER_THICKNESS * camera.zoom;
        ctx.beginPath();
        ctx.moveTo(screen.x, screen.y);
        ctx.lineTo(screenEnd.x, screenEnd.y);
        ctx.stroke();
        ctx.restore();

        // Thin core line — readable but not overwhelming
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = colorToCSS(baseColor, 0.28);
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(screen.x, screen.y);
        ctx.lineTo(screenEnd.x, screenEnd.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Mine body (rotating 8-pointed star / cross) ───────────────────────
    const r = MINE_BODY_RADIUS * camera.zoom;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(this.mineRotation);

    // Soft glow halo
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colorToCSS(baseColor, 0.20);
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 8-pointed octagon body (alternating inner/outer radii give a star shape)
    ctx.fillStyle = colorToCSS(baseColor, 0.88);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? r * 1.1 : r * 0.55;
      if (i === 0) {
        ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      } else {
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    ctx.closePath();
    ctx.fill();

    // Inner cross detail
    ctx.strokeStyle = colorToCSS(baseColor, 0.95);
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55);
    ctx.stroke();

    // Bright white core dot
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Expiry warning flash (last 5 seconds) ────────────────────────────
    if (this.lifetime < 5 && this.lifetime > 0) {
      // Pulse rate increases as lifetime runs out
      const age = MINE_LIFETIME_SECS - this.lifetime;
      const pulseRate = 1.2 + (5 - this.lifetime) * 0.5;
      const pulse = Math.sin(age * pulseRate * Math.PI * 2) * 0.5 + 0.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = colorToCSS(Colors.alert1, pulse * 0.22);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
