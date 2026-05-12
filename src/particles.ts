/** Particle system for Gate88 */

import { Vec2, randomRange } from './math.js';
import { Camera } from './camera.js';
import { Team } from './entities.js';
import { Colors, colorToCSS, Color } from './colors.js';

// ---------------------------------------------------------------------------
// Effect budget constants
// ---------------------------------------------------------------------------

/** Maximum sparks emitted per impact (scaled by particleScale). */
const IMPACT_SPARK_COUNT = 6;
/** Maximum sparks emitted per muzzle flash (scaled by particleScale). */
const MUZZLE_SPARK_COUNT = 3;

// ---------------------------------------------------------------------------
// Single particle
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: Color;
  alpha: number;
  life: number;
  maxLife: number;
  size: number;
  active: boolean;
  /**
   * When true the particle is rendered with additive blending
   * (`globalCompositeOperation = 'lighter'`) so overlapping hot particles
   * bloom into bright white cores — essential for convincing explosions and
   * energy sparks in a space setting.
   */
  additive: boolean;
}

// ---------------------------------------------------------------------------
// Object pool
// ---------------------------------------------------------------------------

const POOL_SIZE = 4096;

function createParticle(): Particle {
  return {
    x: 0, y: 0,
    vx: 0, vy: 0,
    color: Colors.particles_explosion1,
    alpha: 1,
    life: 0,
    maxLife: 1,
    size: 2,
    active: false,
    additive: false,
  };
}

function lightenColor(color: Color, amount: number): Color {
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: color.r + (255 - color.r) * t,
    g: color.g + (255 - color.g) * t,
    b: color.b + (255 - color.b) * t,
    intensity: color.intensity,
  };
}

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

export class ParticleSystem {
  private pool: Particle[];
  private nextIndex: number = 0;
  /**
   * Fraction (0–1) of the full particle budget to emit.  Controlled by the
   * active visual-quality preset via {@link setParticleScale}.
   */
  private _particleScale: number = 1;

  constructor() {
    this.pool = Array.from({ length: POOL_SIZE }, createParticle);
  }

  /**
   * Set the quality scale that governs how many particles are spawned for
   * expensive emitters (explosions, sparks).  1 = full quality; 0.35 = low.
   */
  setParticleScale(scale: number): void {
    this._particleScale = Math.max(0.1, Math.min(1, scale));
  }

  private acquire(): Particle {
    // Find next inactive or reuse oldest
    for (let i = 0; i < POOL_SIZE; i++) {
      const idx = (this.nextIndex + i) % POOL_SIZE;
      if (!this.pool[idx].active) {
        this.nextIndex = (idx + 1) % POOL_SIZE;
        return this.pool[idx];
      }
    }
    // All active – recycle the oldest
    const p = this.pool[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % POOL_SIZE;
    return p;
  }

  // --- Emitters ---

  emitExhaust(
    pos: Vec2,
    angle: number,
    team: Team,
    options: { speedFraction?: number; scaleSizeWithSpeed?: boolean; varyLightness?: boolean } = {},
  ): void {
    const count = 2;
    let color: Color;
    switch (team) {
      case Team.Player:
        color = Colors.particles_friendly_exhaust;
        break;
      case Team.Enemy:
        color = Colors.particles_enemy_exhaust;
        break;
      default:
        color = Colors.particles_neutral_exhaust;
    }
    const speedFraction = Math.min(1, Math.max(0, options.speedFraction ?? 0));
    const spreadRange = 0.06 + 0.24 * (1 - speedFraction);
    const sizeScale = options.scaleSizeWithSpeed ? 0.2 + 0.8 * speedFraction : 1;
    const backAngle = angle + Math.PI;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const spread = randomRange(-spreadRange, spreadRange);
      const spd = randomRange(30, 80);
      p.vx = Math.cos(backAngle + spread) * spd;
      p.vy = Math.sin(backAngle + spread) * spd;
      p.color = options.varyLightness ? lightenColor(color, randomRange(0, 0.34)) : color;
      p.alpha = 1;
      p.life = randomRange(0.2, 0.5);
      p.maxLife = p.life;
      p.size = randomRange(1, 2.5) * sizeScale;
      p.additive = false;
    }
  }

  /**
   * Emit thruster particles from the side of a ship when strafing.
   * @param pos      World position of the ship centre
   * @param angle    Facing angle of the ship (radians)
   * @param sideSign -1 = strafing left (right-side thruster fires, exhaust exits rightward)
   *                 +1 = strafing right (left-side thruster fires, exhaust exits leftward)
   * @param team     Used to select exhaust colour
   */
  emitSideExhaust(
    pos: Vec2,
    angle: number,
    sideSign: number,
    team: Team,
    options: { speedFraction?: number; varyLightness?: boolean } = {},
  ): void {
    const count = 2;
    let color: Color;
    switch (team) {
      case Team.Player:
        color = Colors.particles_friendly_exhaust;
        break;
      case Team.Enemy:
        color = Colors.particles_enemy_exhaust;
        break;
      default:
        color = Colors.particles_neutral_exhaust;
    }
    const speedFraction = Math.min(1, Math.max(0, options.speedFraction ?? 0));
    const spreadRange = 0.06 + 0.24 * (1 - speedFraction);
    // Thruster is on the opposite side from the strafe direction.
    // offsetAngle puts the spawn point on the thruster side.
    // exhaustAngle is opposite to the strafe, matching Newton's 3rd law.
    const thrusterSide = -sideSign; // opposite side from motion
    const offsetAngle = angle + (thrusterSide * Math.PI / 2);
    const exhaustAngle = angle + (thrusterSide * Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      const offsetDist = randomRange(3, 8);
      p.x = pos.x + Math.cos(offsetAngle) * offsetDist;
      p.y = pos.y + Math.sin(offsetAngle) * offsetDist;
      const spread = randomRange(-spreadRange, spreadRange);
      const spd = randomRange(25, 60);
      p.vx = Math.cos(exhaustAngle + spread) * spd;
      p.vy = Math.sin(exhaustAngle + spread) * spd;
      p.color = options.varyLightness ? lightenColor(color, randomRange(0, 0.34)) : color;
      p.alpha = 0.9;
      p.life = randomRange(0.15, 0.35);
      p.maxLife = p.life;
      p.size = randomRange(0.8, 2.0);
      p.additive = false;
    }
  }

  emitExplosion(pos: Vec2, size: number): void {
    const scale = this._particleScale;

    // Central nova flash — warm ivory burst that fades almost instantly.
    // Always emit at least one nova flash regardless of quality.
    {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      p.vx = 0;
      p.vy = 0;
      p.color = Colors.particles_nova;
      p.alpha = 1;
      p.life = 0.07;
      p.maxLife = p.life;
      p.size = Math.max(4, size * 0.65);
      p.additive = true;
    }

    // Primary fireball — large additive particles that bloom together.
    // Warm palette: red → orange → amber → bright yellow → warm white.
    const primaryCount = Math.max(2, Math.floor((18 + size * 2.5) * scale));
    const fireballColors: Color[] = [
      Colors.particles_explosion1,
      Colors.particles_explosion2,
      Colors.alert2,
      Colors.particles_explosion3,
      Colors.particles_ember,
      Colors.particles_nova,
    ];
    for (let i = 0; i < primaryCount; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x + randomRange(-size * 0.25, size * 0.25);
      p.y = pos.y + randomRange(-size * 0.25, size * 0.25);
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(30, 150) * (size / 20);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = fireballColors[i % fireballColors.length];
      p.alpha = 1;
      p.life = randomRange(0.35, 1.1);
      p.maxLife = p.life;
      p.size = randomRange(2.0, 4.5);
      p.additive = true;
    }

    // Secondary debris — mix of normal-blend particles and warm additive embers.
    // Additive embers (60 %) give a glowing warm haze; normal debris (40 %) adds
    // solid scattered chunks so the explosion reads clearly at any zoom level.
    const debrisCount = Math.max(1, Math.floor((8 + size * 1.2) * scale));
    for (let i = 0; i < debrisCount; i++) {
      const useEmber = i % 5 < 3; // 60 % additive embers
      const p = this.acquire();
      p.active = true;
      p.x = pos.x + randomRange(-size * 0.4, size * 0.4);
      p.y = pos.y + randomRange(-size * 0.4, size * 0.4);
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(10, 60) * (size / 20);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = useEmber ? Colors.particles_ember : Colors.particles_explosion2;
      p.alpha = useEmber ? 0.9 : 0.8;
      p.life = randomRange(0.5, 1.5);
      p.maxLife = p.life;
      p.size = randomRange(1.0, 2.5);
      p.additive = useEmber;
    }

    // High-velocity sparks — warm orange/ivory and bright yellow streaks.
    const sparkColors: Color[] = [Colors.alert2, Colors.particles_ember, Colors.particles_nova];
    const sparkCount = Math.max(1, Math.min(10, Math.floor((3 + size * 0.22) * scale)));
    for (let i = 0; i < sparkCount; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(140, 260) * Math.max(0.65, size / 45);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = sparkColors[i % sparkColors.length];
      p.alpha = 1;
      p.life = randomRange(0.10, 0.24);
      p.maxLife = p.life;
      p.size = randomRange(0.9, 1.8);
      p.additive = true;
    }
  }

  emitSpark(pos: Vec2): void {
    const count = Math.max(1, Math.round(5 * this._particleScale));
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const ang = randomRange(0, Math.PI * 2);
      const spd = randomRange(60, 150);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.color = Colors.particles_spark;
      p.alpha = 1;
      p.life = randomRange(0.1, 0.35);
      p.maxLife = p.life;
      p.size = randomRange(1.2, 2.5);
      p.additive = true;
    }
  }

  emitHealing(pos: Vec2): void {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x + randomRange(-8, 8);
      p.y = pos.y + randomRange(-8, 8);
      p.vx = randomRange(-10, 10);
      p.vy = randomRange(-30, -10); // float upward
      p.color = Colors.particles_healing;
      p.alpha = 1;
      p.life = randomRange(0.4, 0.8);
      p.maxLife = p.life;
      p.size = randomRange(1.5, 3);
      p.additive = false;
    }
  }

  emitBuildEffect(pos: Vec2): void {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      const ang = randomRange(0, Math.PI * 2);
      const dist = randomRange(5, 20);
      p.x = pos.x + Math.cos(ang) * dist;
      p.y = pos.y + Math.sin(ang) * dist;
      p.vx = randomRange(-15, 15);
      p.vy = randomRange(-25, -5);
      p.color = Colors.particles_switch;
      p.alpha = 0.85;
      p.life = randomRange(0.3, 0.7);
      p.maxLife = p.life;
      p.size = randomRange(1, 2.5);
      p.additive = true;
    }
  }

  /**
   * Emit a small burst of directional impact sparks when a non-lethal
   * projectile hit occurs.  Scaled by the quality budget.
   * @param pos   World position of the impact
   * @param angle Angle of the incoming projectile (radians) — sparks scatter
   *              around the reverse (impact-normal) direction.
   */
  emitImpact(pos: Vec2, angle: number): void {
    const count = Math.max(1, Math.round(IMPACT_SPARK_COUNT * this._particleScale));
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      // Scatter sparks roughly away from the projectile direction
      const scatter = (Math.random() - 0.5) * Math.PI * 1.4;
      const backAngle = angle + Math.PI + scatter;
      const spd = randomRange(80, 200);
      p.vx = Math.cos(backAngle) * spd;
      p.vy = Math.sin(backAngle) * spd;
      p.color = Colors.particles_impact;
      p.alpha = 1;
      p.life = randomRange(0.06, 0.18);
      p.maxLife = p.life;
      p.size = randomRange(0.8, 2.2);
      p.additive = true;
    }
  }

  /**
   * Emit a brief bright muzzle flash when a weapon fires.
   * @param pos   World position of the muzzle tip
   * @param angle Firing angle (radians)
   */
  emitMuzzleFlash(pos: Vec2, angle: number): void {
    // Central flash particle
    {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      p.vx = Math.cos(angle) * 20;
      p.vy = Math.sin(angle) * 20;
      p.color = Colors.particles_muzzle;
      p.alpha = 1;
      p.life = 0.055;
      p.maxLife = p.life;
      p.size = randomRange(2.5, 4.5);
      p.additive = true;
    }
    // A few rapid sparks in the forward cone
    const sparkCount = Math.max(1, Math.round(MUZZLE_SPARK_COUNT * this._particleScale));
    for (let i = 0; i < sparkCount; i++) {
      const p = this.acquire();
      p.active = true;
      p.x = pos.x;
      p.y = pos.y;
      const spread = (Math.random() - 0.5) * 0.9;
      const spd = randomRange(120, 280);
      p.vx = Math.cos(angle + spread) * spd;
      p.vy = Math.sin(angle + spread) * spd;
      p.color = Colors.particles_nova;
      p.alpha = 0.9;
      p.life = randomRange(0.04, 0.10);
      p.maxLife = p.life;
      p.size = randomRange(0.6, 1.6);
      p.additive = true;
    }
  }

  // --- Simulation ---

  update(dt: number): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        p.active = false;
      }
    }
  }

  // --- Rendering ---

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    // Two passes: first normal-blend particles, then additive-blend particles.
    // This avoids repeated composite-mode switches on every particle.

    const sw = camera.screenW;
    const sh = camera.screenH;
    /** Small margin so particles right at the edge don't pop. */
    const margin = 10;

    // Pass 1 — normal blend
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active || p.alpha <= 0 || p.additive) continue;

      const sx = camera.screenX(p.x);
      if (sx < -margin || sx > sw + margin) continue;
      const sy = camera.screenY(p.y);
      if (sy < -margin || sy > sh + margin) continue;

      const r = p.size * camera.zoom;

      ctx.fillStyle = colorToCSS(p.color, p.alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.4, r), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pass 2 — additive blend (hot glowing particles)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active || p.alpha <= 0 || !p.additive) continue;

      const sx = camera.screenX(p.x);
      if (sx < -margin || sx > sw + margin) continue;
      const sy = camera.screenY(p.y);
      if (sy < -margin || sy > sh + margin) continue;

      const r = p.size * camera.zoom;

      ctx.fillStyle = colorToCSS(p.color, p.alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.4, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

